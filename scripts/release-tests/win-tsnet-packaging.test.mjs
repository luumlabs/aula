// Comprueba que Windows empaqueta aula-tsnet.exe (x64 y arm64) sin alterar macOS ni Linux,
// y que los guiones y flujos de CI/publicación compilan y verifican el sidecar antes de empaquetar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  const packagingWf = readFileSync(join(ROOT, '.github/workflows/packaging.yml'), 'utf8')
  assert.match(packagingWf, /Build the Windows sidecars/)
  assert.match(packagingWf, /native\/tsnet\/build\.sh windows/)
  assert.match(packagingWf, /packaging-ci\/\$dir\/resources\/bin\/aula-tsnet\.exe/)

  const ciWf = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ciWf, /native\/tsnet\/build\.sh windows/)
  assert.match(ciWf, /GOOS=windows GOARCH=amd64 go vet \./)
  assert.match(ciWf, /GOOS=windows GOARCH=arm64 go vet \./)
})
