// Actualizaciones de Windows y Linux simuladas con el código REAL: src/main/electron/updates.ts + NsisUpdater / AppImageUpdater /
// DebUpdater de electron-updater, contra scripts/dev/fake-github-releases.mjs (basado en el ensayo del juez A1).
//   · la firma Ed25519 se exige ANTES de dar la versión por lista y antes de instalar al salir;
//   · A1-P1-8: una AppImage en una carpeta sin permiso no descarga nada, y si el cambio falla al «Reiniciar», se dice;
//   · A1-P2-18d: la .deb busca, pero solo ofrece la descarga;
//   · A1-P2-10: una prerelease publicada sin marcar no se ofrece;
//   · A1-P1-6: las notas solo llegan a la interfaz con su firma;
//   · A1-P2-9: una versión fallida vuelta a subir corregida se intenta sola;
//   · A1-P2-15: sin identificador por instalación (.updaterId).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { UpdateState } from '@shared/ipc/updates'

const require = createRequire(import.meta.url)
const root = join(__dirname, '../../..')
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor')
const { configureRequestUrl, configureRequestOptions } = require('builder-util-runtime')
const PORT = 19765 + Math.floor(Math.random() * 300)
const keys = generateKeyPairSync('ed25519')
const NOTES = '<!-- lang:en -->\n# Aula 0.1.1\n\n## What’s new\n\n- Something nice'
let feed: string
let server: ChildProcess
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const realResources = (process as unknown as { resourcesPath?: string }).resourcesPath

/** Descarga con el http de Node (el de Electron no está en las pruebas). */
class TestExecutor extends NodeHttpExecutor {
  async download(url: URL, destination: string, options: { cancellationToken: { createPromise: Function }; headers?: unknown }) {
    return await options.cancellationToken.createPromise((resolve: (v: string) => void, reject: (e: unknown) => void, onCancel: unknown) => {
      const requestOptions = { headers: options.headers || undefined }
      configureRequestUrl(url, requestOptions)
      configureRequestOptions(requestOptions)
      ;(this as unknown as { doDownload: Function }).doDownload(requestOptions, { destination, options, onCancel, callback: (e: unknown) => (e == null ? resolve(destination) : reject(e)), responseHandler: null }, 0)
    })
  }
}

interface ReleaseOptions { signed: boolean; tamper?: boolean; notes?: 'signed' | 'unsigned'; body?: string }

/** Publica en el servidor falso la versión `v` con su latest*.yml (firmada o no). */
function release(v: string, file: string, ymlName: string, o: ReleaseOptions) {
  const d = join(feed, `v${v}`)
  mkdirSync(d, { recursive: true })
  const body = Buffer.from(`fake installer ${v} ${o.body ?? ''} ${'x'.repeat(200000)}`)
  writeFileSync(join(d, file), body)
  const sha = createHash('sha512').update(body).digest('base64')
  const sig = sign(null, Buffer.from(`aula-update-v1\n${file}\n${o.tamper ? '9.9.9' : v}\n${sha}`), keys.privateKey).toString('base64')
  const entry = `  - url: ${file}\n    sha512: ${sha}\n    size: ${body.length}\n` + (o.signed ? `    aulaSignature: ${sig}\n` : '')
  let notes = ''
  if (o.notes) {
    const notesSha = createHash('sha512').update(NOTES, 'utf8').digest('base64')
    const notesSig = sign(null, Buffer.from(`aula-notes-v1\n${v}\n${notesSha}`), keys.privateKey).toString('base64')
    notes = `releaseNotes: ${JSON.stringify(NOTES)}\n` + (o.notes === 'signed' ? `aulaNotesSignature: ${notesSig}\n` : '')
  }
  writeFileSync(join(d, ymlName), `version: ${v}\nfiles:\n${entry}path: ${file}\nsha512: ${sha}\nreleaseDate: '2026-10-27T00:00:00.000Z'\n${notes}`)
  writeFileSync(join(feed, 'releases.json'), JSON.stringify([{ tag: `v${v}` }, { tag: 'v0.1.0' }]))
}

type Kind = 'win32' | 'linux' | 'deb'

async function scenario(kind: Kind, o: { home?: string; appImageDirReadOnly?: boolean } = {}) {
  vi.resetModules()
  const platform = kind === 'deb' ? 'linux' : kind
  const home = o.home ?? mkdtempSync(join(tmpdir(), 'aula-upd-sim-'))
  const res = join(home, 'resources')
  mkdirSync(res, { recursive: true })
  const cfg = join(res, 'app-update.yml')
  writeFileSync(cfg, `provider: github\nowner: luumlabs\nrepo: aula\nhost: 127.0.0.1:${PORT}\nprotocol: http\nupdaterCacheDirName: aula-updater\n`)
  ;(process as unknown as { resourcesPath: string }).resourcesPath = res
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  delete process.env.APPIMAGE
  rmSync(join(res, 'package-type'), { force: true })
  if (kind === 'linux') {
    process.env.TEST_UPDATER_ARCH = 'x64'
    const appDir = join(home, 'apps')
    mkdirSync(appDir, { recursive: true })
    process.env.APPIMAGE = join(appDir, 'Aula-0.1.0-linux-x86_64.AppImage')
    if (!existsSync(process.env.APPIMAGE)) writeFileSync(process.env.APPIMAGE, 'old')
    if (o.appImageDirReadOnly) chmodSync(appDir, 0o555)
  }
  if (kind === 'deb') {
    process.env.TEST_UPDATER_ARCH = 'x64'
    writeFileSync(join(res, 'package-type'), 'deb')
  }
  const quitHandlers: Array<(code: number) => void> = []
  const installs: unknown[] = []
  const quits: number[] = []
  const adapter = {
    version: '0.1.0', name: 'Aula', isPackaged: true, appUpdateConfigPath: cfg, userDataPath: home, baseCachePath: join(home, 'cache'),
    whenReady: () => Promise.resolve(), relaunch() {}, quit: () => quits.push(1), onQuit: (h: (c: number) => void) => quitHandlers.push(h)
  }
  const { NsisUpdater } = require('electron-updater/out/NsisUpdater')
  const { AppImageUpdater } = require('electron-updater/out/AppImageUpdater')
  const { DebUpdater } = require('electron-updater/out/DebUpdater')
  const u = kind === 'win32' ? new NsisUpdater(null, adapter) : kind === 'deb' ? new DebUpdater(null, adapter) : new AppImageUpdater(null, adapter)
  u.httpExecutor = new TestExecutor()
  u._testOnlyOptions = { platform, isUseDifferentialDownload: false }
  u.disableDifferentialDownload = true
  // el instalador «de verdad» no se ejecuta (salvo en la prueba de la carpeta sin permiso, que usa el de AppImageUpdater)
  const realDoInstall = u.doInstall.bind(u)
  u.doInstall = (opts: unknown) => { installs.push({ opts, file: u.installerPath }); return true }
  vi.doMock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.1.0', on() {}, once() {}, quit() {}, relaunch() {} }, powerMonitor: { on() {} }, shell: { openExternal() {} } }))
  vi.doMock('electron-updater', () => ({ default: { autoUpdater: u } }))
  vi.doMock('./rpc', () => ({ emit: () => undefined }))
  vi.doMock('./window', () => ({ getMainWindow: () => null }))
  vi.doMock('@main/services/settings', () => ({ getSettings: () => ({ data: { autoUpdate: true } }) }))
  vi.doMock('@main/services/updates/signature', async () => {
    const real = await vi.importActual<typeof import('@main/services/updates/signature')>('@main/services/updates/signature')
    return {
      ...real,
      verifyDownloadedUpdate: (v: Parameters<typeof real.verifyDownloadedUpdate>[0]) => real.verifyDownloadedUpdate({ ...v, publicKey: keys.publicKey }),
      signedReleaseNotes: (info: Parameters<typeof real.signedReleaseNotes>[0]) => real.signedReleaseNotes(info, keys.publicKey)
    }
  })
  const paths = await import('@main/services/paths')
  paths.setDataRoot(join(home, 'data'))
  const upd = await import('./updates')
  const settle = async (done: (s: UpdateState) => boolean) => {
    for (let i = 0; i < 200 && !done(upd.updateState()); i++) await new Promise((r) => setTimeout(r, 25))
    return upd.updateState()
  }
  const check = async (byUser = true) => {
    await upd.checkForUpdates(byUser)
    return settle((s) => !['checking', 'downloading'].includes(s.status))
  }
  const failed = () => JSON.parse(readFileSync(join(home, 'data', 'Updates', 'failed.json'), 'utf8')) as Record<string, unknown>
  return { home, u, upd, check, quitHandlers, installs, quits, failed, realDoInstall }
}

beforeAll(async () => {
  feed = mkdtempSync(join(tmpdir(), 'aula-upd-feed-'))
  server = spawn(process.execPath, [join(root, 'scripts/dev/fake-github-releases.mjs'), feed, String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>((resolve) => server.stdout!.once('data', () => resolve()))
})
afterAll(() => {
  server?.kill()
  rmSync(feed, { recursive: true, force: true })
  delete process.env.APPIMAGE
  delete process.env.TEST_UPDATER_ARCH
  Object.defineProperty(process, 'platform', realPlatform)
  ;(process as unknown as { resourcesPath?: string }).resourcesPath = realResources
})

const FILES = { win32: ['Aula-Setup-0.1.1.exe', 'latest.yml'], linux: ['Aula-0.1.1-linux-x86_64.AppImage', 'latest-linux.yml'] } as const

for (const platform of ['win32', 'linux'] as const) {
  const [file, yml] = FILES[platform]
  describe(`${platform}: firma antes de instalar`, () => {
    it('firmada: queda lista con sus notas firmadas, se instala al salir el archivo comprobado', async () => {
      release('0.1.1', file, yml, { signed: true, notes: 'signed' })
      const s = await scenario(platform)
      expect(await s.check()).toMatchObject({ status: 'ready', version: '0.1.1', notes: NOTES })
      expect(s.quitHandlers.length).toBe(1)
      s.quitHandlers[0](0)
      expect(s.installs.length).toBe(1)
      expect(String((s.installs[0] as { file: string }).file)).toContain(file)
      // A1-P2-15: ningún identificador por instalación
      expect(existsSync(join(s.home, '.updaterId'))).toBe(false)
    })
    it('A1-P1-6 · notas sin firma: no llegan a la interfaz', async () => {
      release('0.1.1', file, yml, { signed: true, notes: 'unsigned' })
      const s = await scenario(platform)
      const st = await s.check()
      expect(st.status).toBe('ready')
      expect(st.notes).toBeUndefined()
    })
    it('sin firma: error «signature», nada se instala al salir, se apunta (con su huella) y se borra la descarga', async () => {
      release('0.1.1', file, yml, { signed: false })
      const s = await scenario(platform)
      expect(await s.check()).toMatchObject({ status: 'error', error: 'signature', errorStage: 'download' })
      for (const h of s.quitHandlers) h(0)
      expect(s.installs.length).toBe(0)
      expect(s.u.autoInstallOnAppQuit).toBe(false)
      expect(s.failed()).toMatchObject({ version: '0.1.1', reason: 'signature' })
      expect(typeof s.failed().fingerprint).toBe('string')
      const pending = join(s.home, 'cache', 'aula-updater', 'pending')
      expect(existsSync(pending) ? readdirSync(pending) : []).toEqual([])
      s.upd.installUpdate()
      expect(s.installs.length).toBe(0)
    })
    it('firma de otra versión (reutilizada): rechazada', async () => {
      release('0.1.1', file, yml, { signed: true, tamper: true })
      const s = await scenario(platform)
      expect(await s.check()).toMatchObject({ status: 'error', error: 'signature' })
      for (const h of s.quitHandlers) h(0)
      expect(s.installs.length).toBe(0)
    })
  })
}

describe('A1-P2-9 · una versión fallida', () => {
  it('no se reintenta sola con lo mismo, pero sí si se vuelve a subir corregida; al abrir, ya se avisa', async () => {
    const [file, yml] = FILES.win32
    release('0.1.1', file, yml, { signed: false })
    const first = await scenario('win32')
    expect(await first.check(false)).toMatchObject({ status: 'error', error: 'signature' })
    // otra vez lo mismo (búsqueda automática): no se descarga, se avisa con el motivo
    const again = await scenario('win32', { home: first.home })
    expect(again.upd.updateState()).toMatchObject({ status: 'idle' })
    again.upd.startUpdates()
    expect(again.upd.updateState()).toMatchObject({ status: 'available', blocked: 'failedBefore', version: '0.1.1', error: 'signature' })
    expect(await again.check(false)).toMatchObject({ status: 'available', blocked: 'failedBefore', error: 'signature' })
    // la misma versión, subida otra vez bien firmada (otra huella): se intenta sola
    release('0.1.1', file, yml, { signed: true, body: 'corregida' })
    const fixed = await scenario('win32', { home: first.home })
    expect(await fixed.check(false)).toMatchObject({ status: 'ready', version: '0.1.1' })
  })
})

// la carpeta de solo lectura se hace con chmod, que en Windows no quita el permiso de escritura
describe.skipIf(process.platform === 'win32')('A1-P1-8 · Linux: AppImage en una carpeta sin permiso de escritura', () => {
  it('ni se descarga: «available» con «readOnly»', async () => {
    const [file, yml] = FILES.linux
    release('0.1.1', file, yml, { signed: true })
    const s = await scenario('linux', { appImageDirReadOnly: true })
    try {
      expect(await s.check()).toMatchObject({ status: 'available', blocked: 'readOnly', version: '0.1.1' })
    } finally {
      chmodSync(dirname(process.env.APPIMAGE!), 0o755)
    }
  })
  it('si el cambio falla al «Reiniciar y actualizar», pasa a error (no se queda «lista» para siempre) y se apunta', async () => {
    const [file, yml] = FILES.linux
    release('0.1.1', file, yml, { signed: true })
    const s = await scenario('linux')
    expect((await s.check()).status).toBe('ready')
    // como en /opt después de descargar: el AppImage no se puede borrar ni sustituir (el doInstall REAL)
    s.u.doInstall = s.realDoInstall
    const appDir = dirname(process.env.APPIMAGE!)
    chmodSync(appDir, 0o555)
    try {
      s.upd.installUpdate()
      await new Promise((r) => setTimeout(r, 100))
    } finally {
      chmodSync(appDir, 0o755)
    }
    expect(s.upd.updateState()).toMatchObject({ status: 'error', errorStage: 'install', version: '0.1.1' })
    expect(['permission', 'install']).toContain(s.upd.updateState().error)
    expect(s.quits.length).toBe(0)
    expect(s.failed()).toMatchObject({ version: '0.1.1' })
  })
})

describe('A1-P2-18d · Linux .deb', () => {
  it('busca y ofrece la descarga (nunca descarga ni instala)', async () => {
    const [file, yml] = FILES.linux
    release('0.1.1', file, yml, { signed: true })
    const s = await scenario('deb')
    expect(await s.check()).toMatchObject({ status: 'available', blocked: 'package', version: '0.1.1' })
    expect(s.installs.length).toBe(0)
  })
})

describe('A1-P2-10 · prerelease sin marcar', () => {
  it('no se ofrece', async () => {
    const [file, yml] = FILES.win32
    release('0.2.0-beta.1', file.replace('0.1.1', '0.2.0-beta.1'), yml, { signed: true })
    const s = await scenario('win32')
    expect(await s.check()).toMatchObject({ status: 'upToDate' })
    expect(s.installs.length).toBe(0)
  })
})
