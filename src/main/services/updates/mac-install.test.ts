import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appBundleOf,
  cleanupAfterUpdate,
  developerRequirement,
  executableIn,
  MacInstallError,
  selfUpdateBlocker,
  sha512Base64,
  siblings,
  stageMacUpdate,
  swapMacBundle,
  watchdogScript
} from './mac-install'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aula-upd-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Un .app mínimo con Info.plist y un ejecutable que dice su versión (y, si se pide, deja una marca al abrirse). */
function fakeApp(at: string, version: string, id = 'com.luumlabs.aula', o: { minimumSystem?: string; touch?: string } = {}): string {
  mkdirSync(join(at, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(
    join(at, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>` +
      `<key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string>` +
      (o.minimumSystem ? `<key>LSMinimumSystemVersion</key><string>${o.minimumSystem}</string>` : '') +
      `<key>CFBundleExecutable</key><string>Aula</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
  )
  const exe = join(at, 'Contents', 'MacOS', 'Aula')
  writeFileSync(exe, `#!/bin/sh\necho ${version}\n${o.touch ? `touch '${o.touch}'\n` : ''}`)
  chmodSync(exe, 0o755)
  return at
}

const version = (app: string) => readFileSync(join(app, 'Contents', 'MacOS', 'Aula'), 'utf8').match(/echo (\S+)/)?.[1]

describe('rutas', () => {
  it('encuentra el .app desde el ejecutable', () => {
    expect(appBundleOf('/Applications/Aula.app/Contents/MacOS/Aula')).toBe('/Applications/Aula.app')
    expect(appBundleOf('/Users/a/Mis cosas/Aula 2.app/Contents/MacOS/Aula')).toBe('/Users/a/Mis cosas/Aula 2.app')
    expect(appBundleOf('/usr/lib/electron/electron')).toBeNull()
  })
  it('las copias de trabajo van junto a la app, ocultas', () => {
    expect(siblings('/Applications/Aula.app')).toEqual({ backup: '/Applications/.Aula-previous.app', incoming: '/Applications/.Aula-incoming.app' })
  })
  it('una app abierta desde Descargas (App Translocation) no puede reemplazarse', () => {
    expect(selfUpdateBlocker('/private/var/folders/x/T/AppTranslocation/ABC/d/Aula.app')).toBe('translocated')
    expect(selfUpdateBlocker('/no/existe/Aula.app')).toBe('readOnly')
    const app = fakeApp(join(dir, 'Aula.app'), '2.0.0')
    expect(selfUpdateBlocker(app)).toBeNull()
  })
  it('A1-P2-18c · abierta desde el .dmg (/Volumes de solo lectura): «muévela a Aplicaciones», no «instálala a mano»', () => {
    expect(selfUpdateBlocker('/Volumes/Aula 0.1.0-universal/Aula.app')).toBe('translocated')
  })
  it('A1-P2-16 · el ejecutable va con la ruta de la app, aunque se llame distinto («Aula 2.app»)', () => {
    expect(executableIn('/Applications/Aula 2.app', '/Applications/Aula 2.app/Contents/MacOS/Aula')).toBe('/Applications/Aula 2.app/Contents/MacOS/Aula')
  })
})

describe('swapMacBundle', () => {
  it('cambia la app y guarda la anterior al lado', () => {
    const target = fakeApp(join(dir, 'Aula.app'), '2.0.0')
    const staged = fakeApp(join(dir, 'cache', 'staged', 'Aula.app'), '2.0.1')
    const { backup } = swapMacBundle(target, staged)
    expect(version(target)).toBe('2.0.1')
    expect(version(backup)).toBe('2.0.0')
    expect(existsSync(staged)).toBe(false)
    cleanupAfterUpdate({ backup, stageDir: join(dir, 'cache', 'staged') })
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(target)).toBe(true)
  })
  it('si la nueva no está, la actual no se toca', () => {
    const target = fakeApp(join(dir, 'Aula.app'), '2.0.0')
    expect(() => swapMacBundle(target, join(dir, 'nada', 'Aula.app'))).toThrow(MacInstallError)
    expect(version(target)).toBe('2.0.0')
    expect(existsSync(siblings(target).backup)).toBe(false)
  })
  it('una copia anterior de otra vez no estorba', () => {
    const target = fakeApp(join(dir, 'Aula.app'), '2.0.1')
    fakeApp(siblings(target).backup, '1.9.0')
    const staged = fakeApp(join(dir, 'stage', 'Aula.app'), '2.0.2')
    const { backup } = swapMacBundle(target, staged)
    expect(version(target)).toBe('2.0.2')
    expect(version(backup)).toBe('2.0.1')
  })
})

describe('vigilante', () => {
  const opts = (marker: string) => ({
    target: join(dir, 'Aula.app'),
    executable: join(dir, 'Aula.app', 'Contents', 'MacOS', 'Aula'),
    backup: join(dir, '.Aula-previous.app'),
    marker,
    failedFile: join(dir, 'Updates', 'failed.json'),
    version: '2.0.1',
    pid: 999999, // ya salió
    graceSeconds: 5
  })
  it('si la nueva se abre (marca), no hace nada', () => {
    fakeApp(join(dir, 'Aula.app'), '2.0.1')
    fakeApp(join(dir, '.Aula-previous.app'), '2.0.0')
    const marker = join(dir, 'started')
    writeFileSync(marker, 'ok')
    const script = join(dir, 'w.sh')
    writeFileSync(script, watchdogScript(opts(marker)))
    expect(spawnSync('/bin/sh', [script]).status).toBe(0)
    expect(version(join(dir, 'Aula.app'))).toBe('2.0.1')
    expect(existsSync(join(dir, 'Updates', 'failed.json'))).toBe(false)
  })
  it("si la nueva no llega a abrirse, vuelve la anterior y apunta el fallo", { timeout: 20000 }, () => {
    fakeApp(join(dir, 'Aula.app'), '2.0.1')
    fakeApp(join(dir, '.Aula-previous.app'), '2.0.0')
    const script = join(dir, 'w.sh')
    writeFileSync(script, watchdogScript(opts(join(dir, 'nunca'))))
    expect(spawnSync('/bin/sh', [script]).status).toBe(0)
    expect(version(join(dir, 'Aula.app'))).toBe('2.0.0')
    expect(existsSync(join(dir, '.Aula-previous.app'))).toBe(false)
    expect(existsSync(join(dir, '.Aula-failed.app'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'Updates', 'failed.json'), 'utf8'))).toMatchObject({ version: '2.0.1', reason: 'start' })
  })
  it('A1-P2-16 · «Aula (2)+.app»: vuelve la anterior y la REABRE por su ejecutable; apunta la huella', { timeout: 20000 }, async () => {
    const target = join(dir, 'Aula (2)+.app')
    const backup = join(dir, '.Aula (2)+-previous.app')
    const reopened = join(dir, 'reabierta')
    fakeApp(target, '2.0.1')
    fakeApp(backup, '2.0.0', undefined, { touch: reopened })
    const script = join(dir, 'w.sh')
    const script0 = watchdogScript({ ...opts(join(dir, 'nunca')), target, backup, executable: executableIn(target, '/x/Aula.app/Contents/MacOS/Aula'), fingerprint: 'AAA+/=,BBB', args: ['--use-mock-keychain', "--x=it's"] })
    // se reabre con los mismos argumentos que la vieja (como app.relaunch), bien entrecomillados
    expect(script0).toContain(`"$EXEC" '--use-mock-keychain' '--x=it'\\''s' >/dev/null`)
    writeFileSync(script, script0)
    expect(spawnSync('/bin/sh', [script]).status).toBe(0)
    expect(version(target)).toBe('2.0.0')
    for (let i = 0; i < 40 && !existsSync(reopened); i++) await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(reopened)).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'Updates', 'failed.json'), 'utf8'))).toMatchObject({ version: '2.0.1', reason: 'start', fingerprint: 'AAA+/=,BBB' })
  })
  it.skipIf(process.platform !== 'darwin')('A1-P2-16 · si la nueva sigue abierta (lenta), no se toca, aunque la ruta tenga paréntesis y «+»', { timeout: 20000 }, async () => {
    const target = join(dir, 'Aula (2)+.app')
    const backup = join(dir, '.Aula (2)+-previous.app')
    fakeApp(target, '2.0.1')
    fakeApp(backup, '2.0.0')
    // un proceso cuyo ejecutable es el de la app nueva (como si siguiera abriéndose): una copia de node (los binarios
    // del sistema no arrancan copiados fuera de su sitio)
    const exe = join(target, 'Contents', 'MacOS', 'Aula')
    execFileSync('/bin/cp', ['-c', process.execPath, exe])
    const alive = spawn(exe, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 700))
    try {
      const script = join(dir, 'w.sh')
      writeFileSync(script, watchdogScript({ ...opts(join(dir, 'nunca')), target, backup, executable: exe }))
      expect(spawnSync('/bin/sh', [script]).status).toBe(0)
      expect(existsSync(backup)).toBe(true) // no hubo vuelta atrás
      expect(existsSync(join(dir, 'Updates', 'failed.json'))).toBe(false)
    } finally {
      alive.kill()
    }
  })
  it('rutas con comillas y espacios', () => {
    const s = watchdogScript({ ...opts('/tmp/x'), target: "/Users/a/Mis 'apps'/Aula.app" })
    expect(s).toContain(`TARGET='/Users/a/Mis '\\''apps'\\''/Aula.app'`)
  })
})

describe.skipIf(process.platform !== 'darwin')('stageMacUpdate (macOS: ditto, plutil, codesign)', () => {
  function zipOf(version: string, id?: string, sign = true): string {
    const src = join(dir, `src-${version}`)
    const app = fakeApp(join(src, 'Aula.app'), version, id)
    if (sign) execFileSync('/usr/bin/codesign', ['-s', '-', '--force', app])
    const zip = join(dir, `Aula-${version}-mac.zip`)
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
    return zip
  }

  it('descomprime y comprueba la versión nueva (firma ad hoc válida)', async () => {
    const zip = zipOf('2.0.1')
    const app = await stageMacUpdate({ zip, sha512: await sha512Base64(zip), version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir: join(dir, 'stage') })
    expect(version(app)).toBe('2.0.1')
  })
  it('rechaza un zip cuyo SHA-512 no coincide', async () => {
    const zip = zipOf('2.0.1')
    await expect(stageMacUpdate({ zip, sha512: 'AAAA', version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir: join(dir, 'stage') })).rejects.toMatchObject({ code: 'corrupt' })
  })
  it('rechaza otra app, otra versión o una firma rota', async () => {
    const stageDir = join(dir, 'stage')
    await expect(stageMacUpdate({ zip: zipOf('2.0.1', 'com.otra.app'), version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir })).rejects.toMatchObject({ code: 'verify' })
    await expect(stageMacUpdate({ zip: zipOf('2.0.2'), version: '2.0.3', bundleId: 'com.luumlabs.aula', stageDir })).rejects.toMatchObject({ code: 'verify' })
    // firmada y luego tocada: codesign --verify la rechaza
    const src = join(dir, 'tampered')
    const app = fakeApp(join(src, 'Aula.app'), '2.0.4')
    execFileSync('/usr/bin/codesign', ['-s', '-', '--force', app])
    writeFileSync(join(app, 'Contents', 'MacOS', 'Aula'), '#!/bin/sh\necho malo\n')
    const zip = join(dir, 'tampered.zip')
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
    await expect(stageMacUpdate({ zip, version: '2.0.4', bundleId: 'com.luumlabs.aula', stageDir })).rejects.toMatchObject({ code: 'verify' })
  })
  // J3-4: la app exige la firma propia de Aula (Ed25519) antes de descomprimir nada
  it('exige la firma de Aula del zip: sin ella, o de otra clave, no se instala', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto')
    const { signedMessage, SIGNATURE_FIELD } = await import('./signature')
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const zip = zipOf('2.0.1')
    const sha512 = await sha512Base64(zip)
    const base = { zip, sha512, version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir: join(dir, 'stage') }
    const url = 'Aula-2.0.1-mac.zip'
    await expect(stageMacUpdate({ ...base, signature: { entry: { url, sha512 }, publicKey } })).rejects.toMatchObject({ code: 'verify' })
    const forged = sign(null, signedMessage(url, '2.0.1', sha512), generateKeyPairSync('ed25519').privateKey).toString('base64')
    await expect(stageMacUpdate({ ...base, signature: { entry: { url, sha512, [SIGNATURE_FIELD]: forged }, publicKey } })).rejects.toMatchObject({ code: 'verify' })
    // con la clave de la app de verdad (la embebida), una firma de usar y tirar tampoco vale
    await expect(stageMacUpdate({ ...base, signature: { entry: { url, sha512, [SIGNATURE_FIELD]: forged } } })).rejects.toMatchObject({ code: 'verify' })
    const good = sign(null, signedMessage(url, '2.0.1', sha512), privateKey).toString('base64')
    const app = await stageMacUpdate({ ...base, signature: { entry: { url, sha512, [SIGNATURE_FIELD]: good }, publicKey } })
    expect(version(app)).toBe('2.0.1')
  })
  it('A1-P2-10 · una versión que pide un macOS más nuevo no se prepara («system»)', async () => {
    const src = join(dir, 'min')
    const app = fakeApp(join(src, 'Aula.app'), '2.0.1', undefined, { minimumSystem: '14.0' })
    execFileSync('/usr/bin/codesign', ['-s', '-', '--force', app])
    const zip = join(dir, 'min.zip')
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
    const base = { zip, version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir: join(dir, 'stage') }
    await expect(stageMacUpdate({ ...base, systemVersion: '13.6.1' })).rejects.toMatchObject({ code: 'system' })
    expect(version(await stageMacUpdate({ ...base, systemVersion: '14.0' }))).toBe('2.0.1')
    expect(version(await stageMacUpdate({ ...base, systemVersion: '26.1' }))).toBe('2.0.1')
  })
  it('A1-P2-19 · sin espacio al descomprimir: «disk», no «llegó dañada»', async () => {
    const zip = zipOf('2.0.1')
    const run = async (cmd: string, args: string[]) => {
      if (cmd.endsWith('ditto')) throw new Error('ditto -x: Couldn\'t write: No space left on device')
      return ''
    }
    await expect(stageMacUpdate({ zip, version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir: join(dir, 'stage'), run })).rejects.toMatchObject({ code: 'disk' })
  })
  it('una firma ad hoc no impone requisito de desarrollador', async () => {
    const src = join(dir, 'adhoc')
    const app = fakeApp(join(src, 'Aula.app'), '2.0.0')
    execFileSync('/usr/bin/codesign', ['-s', '-', '--force', app])
    expect(await developerRequirement(app)).toBeNull()
  })
  it('con firma de desarrollador, la nueva debe cumplir el mismo requisito', async () => {
    const zip = zipOf('2.0.1')
    const run = async (cmd: string, args: string[]) => {
      if (args[0] === '-d') return 'designated => identifier "com.luumlabs.aula" and anchor apple generic and certificate leaf[subject.OU] = "TEAM123456"'
      return new Promise<string>((resolve, reject) => {
        const r = spawnSync(cmd, args, { encoding: 'utf8' })
        if (r.status === 0) resolve(r.stdout + r.stderr)
        else reject(new Error(r.stderr))
      })
    }
    await expect(
      stageMacUpdate({ zip, version: '2.0.1', bundleId: 'com.luumlabs.aula', stageDir: join(dir, 'stage'), current: '/Applications/Aula.app', run })
    ).rejects.toMatchObject({ code: 'verify' })
  })
})
