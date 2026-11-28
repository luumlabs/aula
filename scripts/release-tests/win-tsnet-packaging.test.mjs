// Comprueba que Windows empaqueta aula-tsnet.exe (x64 y arm64) sin alterar macOS ni Linux,
// y que los guiones y flujos de CI/publicación compilan y verifican el sidecar antes de empaquetar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { ROOT } from '../release-common.mjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

test('electron-builder.yml empaqueta aula-tsnet.exe en Windows y conserva macOS y Linux', () => {
  const cfg = yaml.load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8'))
  assert.deepEqual(cfg.win.extraResources, [
    { from: 'native/tsnet/bin/win-${arch}', to: 'bin', filter: ['aula-tsnet.exe'] }
  ])
  assert.deepEqual(cfg.win.target, [{ target: 'nsis', arch: ['x64', 'arm64'] }])
  // macOS y Linux permanecen intactos
  assert.ok(cfg.mac.extraResources.some(r => r.from === 'native/tsnet/bin' && r.to === 'bin' && r.filter?.includes('aula-tsnet')))
  assert.deepEqual(cfg.linux.extraResources, [
    { from: 'native/tsnet/bin/linux-${arch}', to: 'bin', filter: ['aula-tsnet'] }
  ])
})

test('build.sh, release-local.sh y los flujos de GitHub compilan y comprueban el sidecar de Windows', () => {
  const buildSh = readFileSync(join(ROOT, 'native/tsnet/build.sh'), 'utf8')
  assert.match(buildSh, /build_windows\(\)/)
  assert.match(buildSh, /GOOS=windows GOARCH=\$\{pair##\*:\} CGO_ENABLED=0 go build .* -o "bin\/win-\$\{pair%%:\*\}\/aula-tsnet\.exe" \./)
  assert.match(buildSh, /windows\|win\) build_windows ;;/)

  const releaseLocal = readFileSync(join(ROOT, 'scripts/release-local.sh'), 'utf8')
  assert.match(releaseLocal, /case "\$p" in mac\|win\|linux\) need_go ;; esac/)
  assert.match(releaseLocal, /native\/tsnet\/build\.sh windows/)
  assert.match(releaseLocal, /win-unpacked win-arm64-unpacked/)
  assert.match(releaseLocal, /resources\/bin\/aula-tsnet\.exe/)

  const releaseWf = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')
  assert.match(releaseWf, /Build the Tailscale sidecar for Windows/)
  assert.match(releaseWf, /native\/tsnet\/build\.sh windows/)
  assert.match(releaseWf, /native\/tsnet\/bin\/win-\$a\/aula-tsnet\.exe/)
  // Step 1 verifica SHA-512 de todos los feeds aunque aún no tengan firma Ed25519; Step 2 sigue exigiendo la firma
  assert.match(releaseWf, /node scripts\/release-verify\.mjs --no-signatures "\$RUNNER_TEMP\/draft" "\$V"/)
  assert.match(releaseWf, /node scripts\/release-sign\.mjs --verify "\$RUNNER_TEMP\/draft"/)

  const packagingWf = readFileSync(join(ROOT, '.github/workflows/packaging.yml'), 'utf8')
  assert.match(packagingWf, /Build the Windows sidecars/)
  assert.match(packagingWf, /native\/tsnet\/build\.sh windows/)
  assert.match(packagingWf, /packaging-ci\/\$dir\/resources\/bin\/aula-tsnet\.exe/)

  const ciWf = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ciWf, /native\/tsnet\/build\.sh windows/)
  assert.match(ciWf, /GOOS=windows GOARCH=amd64 go vet \./)
  assert.match(ciWf, /GOOS=windows GOARCH=arm64 go vet \./)
})

test('release-verify.mjs exige firmas por defecto y comprueba todos los SHA-512 con --no-signatures', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aula-verify-nosig-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const makeFeed = (feed, file, content) => {
    const bytes = Buffer.from(content)
    writeFileSync(join(dir, file), bytes)
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    writeFileSync(join(dir, feed), yaml.dump({
      version: '0.2.9',
      path: file,
      sha512,
      releaseNotes: 'Notes',
      files: [{ url: file, sha512, size: bytes.length }]
    }))
  }
  makeFeed('latest.yml', 'Aula-Setup-0.2.9.exe', 'win-installer-bytes')
  makeFeed('latest-linux.yml', 'Aula-0.2.9-linux-x86_64.AppImage', 'linux-x64-bytes')
  makeFeed('latest-linux-arm64.yml', 'Aula-0.2.9-linux-arm64.AppImage', 'linux-arm64-bytes')

  const strict = spawnSync(process.execPath, [join(ROOT, 'scripts/release-verify.mjs'), dir, '0.2.9'], { encoding: 'utf8' })
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /sin firma válida de Aula/)

  const hashesOnly = spawnSync(process.execPath, [join(ROOT, 'scripts/release-verify.mjs'), '--no-signatures', dir, '0.2.9'], { encoding: 'utf8' })
  assert.equal(hashesOnly.status, 0, hashesOnly.stderr)
  assert.match(hashesOnly.stdout, /latest\.yml: archivos y hashes válidos/)
  assert.match(hashesOnly.stdout, /latest-linux\.yml: archivos y hashes válidos/)
  assert.match(hashesOnly.stdout, /latest-linux-arm64\.yml: archivos y hashes válidos/)

  // un SHA-512 corrupto sigue fallando incluso con --no-signatures
  writeFileSync(join(dir, 'Aula-Setup-0.2.9.exe'), 'tampered-bytes')
  const tampered = spawnSync(process.execPath, [join(ROOT, 'scripts/release-verify.mjs'), '--no-signatures', dir, '0.2.9'], { encoding: 'utf8' })
  assert.equal(tampered.status, 1)
  assert.match(tampered.stderr, /SHA-512 incorrecto/)
})
