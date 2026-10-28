// Actualizaciones con electron-updater (releases de GitHub, ver electron-builder.yml → publish): busca al arrancar y cada
// 6 horas si «Actualizar sola» está encendido, descarga en segundo plano y se instala al pulsar «Reiniciar» o al salir.
//
// - Todas: antes de instalar se exige la FIRMA PROPIA de Aula (Ed25519, ../services/updates/signature.ts) del archivo
//   descargado; sin ella no se instala nada (el SHA-512 del .yml viene del mismo sitio que el instalador).
// - Windows (NSIS) y Linux (AppImage): el instalador de electron-updater, tras comprobar la firma.
// - macOS: electron-updater busca y descarga (con su SHA-512), pero NO se usa Squirrel.Mac para instalar: con la firma ad
//   hoc rechaza toda versión nueva («code failed to satisfy specified code requirement(s)», comprobado). La instalación
//   la hace ../services/updates/mac-install.ts: comprueba la app nueva, la cambia por la actual al salir y, si la nueva no
//   llega a abrirse, un vigilante devuelve la anterior. Ver docs/PUBLISHING.md.
// - Una versión que no se pudo instalar queda apuntada (con la huella de lo publicado) y no se reintenta sola (sin bucles):
//   la barra lateral lo avisa y Ajustes → Acerca de explica qué hacer.
// - Linux: la AppImage se actualiza sola; la .deb (y rpm/pacman) busca igual, pero solo ofrece la descarga.
// - Las notas de la versión solo se enseñan si llevan la firma de Aula (`aulaNotesSignature`).
import { app, powerMonitor, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import electronUpdater, { type AppUpdater, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import type { UpdateBlock, UpdateState } from '@shared/ipc/updates'
import { releaseNotesText } from '@shared/release-notes'
import { getSettings } from '@main/services/settings'
import { log } from '@main/services/log'
import { dataRoot } from '@main/services/paths'
import { readJSON, writeJSONAtomic } from '@main/services/fs'
import { classifyUpdateError } from '@main/services/updates/errors'
import { blocksAutoRetry, errorOfFailure, fingerprintOf, readFailed, recordFailure } from '@main/services/updates/failed'
import { entryForFile, signedReleaseNotes, verifyDownloadedUpdate, type SignedFileEntry } from '@main/services/updates/signature'
import { compareVersions, isPrerelease } from '@main/services/updates/version'
import {
  appBundleOf,
  cleanupAfterUpdate,
  executableIn,
  MacInstallError,
  selfUpdateBlocker,
  stageDirFor,
  stageMacUpdate,
  swapMacBundle,
  watchdogScript,
  type InstallJournal
} from '@main/services/updates/mac-install'
import { emit } from './rpc'
import { getMainWindow } from './window'

/** Página de descargas (instalar a mano). */
export const DOWNLOAD_PAGE = 'https://github.com/luumlabs/aula/releases/latest'
const BUNDLE_ID = 'com.luumlabs.aula'
const EVERY_MS = 6 * 60 * 60 * 1000
/** Tras una búsqueda sin conexión (o con un fallo raro), la siguiente va antes (A1-P2-13). */
const RETRY_MS = Number(process.env.AULA_UPDATE_RETRY_MS) || 30 * 60 * 1000
const FIRST_DELAY_MS = Number(process.env.AULA_UPDATE_CHECK_DELAY_MS) || 45 * 1000
/** electron-updater manda a GitHub un identificador por instalación (`x-user-staging-id`, para despliegues escalonados,
 *  que Aula no usa): va el mismo para todos (A1-P2-15). */
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

let state: UpdateState = { status: 'idle' }
let updater: AppUpdater | null = null
let timer: NodeJS.Timeout | null = null
/** La búsqueda en curso la pidió el estudiante (entonces sí se reintenta una versión que falló). */
let manual = false
/** macOS: la versión nueva ya comprobada, lista para ocupar el sitio de la actual. */
let macPending: { version: string; staged: string; stageDir: string } | null = null
let relaunchAfterInstall = false
let shuttingDown = false
/** Windows y Linux: se pulsó «Reiniciar y actualizar» y el instalador está en marcha (si falla, se dice: A1-P1-8). */
let installing = false
/** La versión que se ofrece ahora y su huella (para apuntar un fallo de ESO que se publicó). */
let offered: { version: string; fingerprint?: string } | null = null
let lastCheckAt = 0

function set(next: UpdateState): void {
  state = next
  emit('updates.changed', state)
}

export function updateState(): UpdateState {
  return state
}

const updatesDir = () => join(dataRoot(), 'Updates')
const journalFile = () => join(updatesDir(), 'install.json')
const failedFile = () => join(updatesDir(), 'failed.json')
const startedMarker = (version: string) => join(updatesDir(), `started-${version}`)

const fingerprintFor = (version: string) => (offered?.version === version ? offered.fingerprint : undefined)

function rememberFailed(version: string, reason: string): void {
  try {
    recordFailure(failedFile(), version, reason, fingerprintFor(version))
  } catch (e) {
    log.warn('[updates] no se pudo apuntar el fallo', e)
  }
}

/** Las notas de una versión, solo si llevan la firma de Aula (A1-P1-6: se pintan como Markdown con enlaces). */
function verifiedNotes(info: UpdateInfo): string | undefined {
  return releaseNotesText(signedReleaseNotes(info as unknown as Parameters<typeof signedReleaseNotes>[0]))
}

/** La app de macOS que está abierta (/…/Aula.app). */
function macBundle(): string | null {
  return process.platform === 'darwin' ? appBundleOf(process.execPath) : null
}

/** Linux instalada con un paquete del sistema (electron-builder deja resources/package-type: deb, rpm, pacman). */
function linuxPackage(): string | null {
  if (process.platform !== 'linux' || process.env.APPIMAGE) return null
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim() || null
  } catch {
    return null
  }
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** null = se actualiza sola; si no, por qué no (el estado queda 'unsupported'). */
function unsupportedReason(): UpdateBlock | null {
  if (!app.isPackaged || process.env.AULA_NO_UPDATES) return 'dev'
  // Linux sin AppImage ni paquete conocido (carpeta suelta, snap…): no hay con qué buscar
  if (process.platform === 'linux' && !process.env.APPIMAGE && !linuxPackage()) return 'package'
  if (process.platform === 'darwin' && !macBundle()) return 'dev'
  return null
}

/** Aunque busque, ¿puede instalarla? (macOS desde Descargas / el .dmg, carpeta sin permiso de escritura, una .deb). */
function installBlocker(): UpdateBlock | null {
  if (process.platform === 'linux') {
    if (linuxPackage()) return 'package' // la .deb la instala el estudiante (A1-P2-18d): se ofrece la descarga
    const image = process.env.APPIMAGE
    // la AppImage se cambia por la nueva en su carpeta: sin permiso, ni se descarga (A1-P1-8)
    return image && (!writable(dirname(image)) || !writable(image)) ? 'readOnly' : null
  }
  const bundle = macBundle()
  if (!bundle) return null
  const b = selfUpdateBlocker(bundle)
  return b === 'translocated' ? 'translocated' : b ? 'readOnly' : null
}

function getUpdater(): AppUpdater {
  if (updater) return updater
  const u = electronUpdater.autoUpdater
  // descargamos nosotros tras decidir (versión que ya falló, copia que no puede instalarse…)
  u.autoDownload = false
  u.autoInstallOnAppQuit = true
  u.allowPrerelease = false
  u.allowDowngrade = false
  u.logger = { info: (m: unknown) => log.info('[updates]', m), warn: (m: unknown) => log.warn('[updates]', m), error: (m: unknown) => log.error('[updates]', m), debug: () => {} }
  // sin identificador por instalación (y se borra el que dejaron las versiones anteriores)
  ;(u as unknown as { getOrCreateStagingUserId: () => Promise<string> }).getOrCreateStagingUserId = async () => NIL_UUID
  try { rmSync(join(dataRoot(), '.updaterId'), { force: true }) } catch { /* nada */ }
  ensureUpdateConfig(u)
  if (process.platform === 'darwin') useOwnMacInstaller(u)
  else requireOwnSignature(u)
  u.on('checking-for-update', () => set({ ...state, status: 'checking', error: undefined, errorStage: undefined }))
  u.on('update-not-available', () => set({ status: 'upToDate', checkedAt: new Date().toISOString(), updatedFrom: state.updatedFrom }))
  u.on('update-available', (info: UpdateInfo) => onAvailable(u, info))
  u.on('download-progress', (p: { percent: number }) => {
    if (state.status === 'downloading') set({ ...state, progress: Math.max(0, Math.min(0.99, p.percent / 100)) })
  })
  u.on('update-downloaded', (info: UpdateInfo) => set({ status: 'ready', version: info.version, notes: verifiedNotes(info) ?? state.notes, checkedAt: new Date().toISOString() }))
  u.on('error', (err: unknown) => onError(err))
  updater = u
  return u
}

function onAvailable(u: AppUpdater, info: UpdateInfo): void {
  // una prerelease publicada sin marcar como tal no se ofrece (A1-P2-10)
  if (isPrerelease(info.version)) {
    log.warn(`[updates] la ${info.version} es una prerelease: no se ofrece`)
    set({ status: 'upToDate', checkedAt: new Date().toISOString(), updatedFrom: state.updatedFrom })
    return
  }
  const fingerprint = fingerprintOf(info)
  offered = { version: info.version, fingerprint }
  const base = { version: info.version, notes: verifiedNotes(info), checkedAt: new Date().toISOString() }
  const failed = readFailed(failedFile())
  const blocked = installBlocker() ?? (!manual && blocksAutoRetry(failed, info.version, fingerprint) ? 'failedBefore' : null)
  if (blocked) {
    set({ status: 'available', blocked, ...base, ...(blocked === 'failedBefore' && failed ? { error: errorOfFailure(failed.reason) } : {}) })
    return
  }
  set({ status: 'downloading', progress: 0, ...base })
  u.downloadUpdate().catch(() => {
    /* llega también como 'error' */
  })
}

function onError(err: unknown): void {
  const code = classifyUpdateError(err)
  if (state.status === 'ready') {
    // una versión ya lista no se pierde por un fallo de una búsqueda posterior; pero si lo que falló es INSTALARLA
    // (Windows/Linux, «Reiniciar y actualizar»), se dice y no se reintenta sola (A1-P1-8)
    if (!installing) return
    installing = false
    log.warn(`[updates] no se pudo instalar la ${state.version ?? '?'} (${code})`, err)
    const error = code === 'permission' || code === 'disk' ? code : 'install'
    if (state.version) rememberFailed(state.version, error)
    set({ ...state, status: 'error', error, errorStage: 'install', progress: undefined })
    return
  }
  const errorStage = state.status === 'downloading' ? 'download' : 'check'
  log.warn(`[updates] error (${errorStage}: ${code})`, err)
  if (errorStage === 'download' && state.version && (err instanceof MacInstallError || code === 'signature' || code === 'corrupt')) {
    // la versión publicada no se puede instalar: no se vuelve a descargar sola cada 6 horas
    rememberFailed(state.version, code)
  }
  set({ ...state, status: 'error', error: code, errorStage, progress: undefined })
}

/**
 * Las copias hechas con `electron-builder --dir` no traen app-update.yml (y electron-updater lo necesita para buscar y
 * para su caché): se usa el de GitHub de electron-builder.yml.
 */
function ensureUpdateConfig(u: AppUpdater): void {
  if (existsSync(join(process.resourcesPath, 'app-update.yml'))) return
  try {
    mkdirSync(updatesDir(), { recursive: true })
    const file = join(updatesDir(), 'app-update.yml')
    writeFileSync(file, 'provider: github\nowner: luumlabs\nrepo: aula\nupdaterCacheDirName: aula-updater\n')
    u.updateConfigPath = file
  } catch (e) {
    log.warn('[updates] app-update.yml', e)
  }
}

// ── macOS ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que MacUpdater hace tras descargar (pasárselo a Squirrel.Mac) se cambia por comprobar y preparar la app nueva. */
interface MacUpdaterInternals {
  updateDownloaded: (zip: { info: SignedFileEntry }, event: UpdateDownloadedEvent) => Promise<string[]>
  dispatchUpdateDownloaded: (event: UpdateDownloadedEvent) => void
  quitAndInstall: () => void
  downloadedUpdateHelper?: { cacheDir: string; clear(): Promise<void> } | null
}

/** Una descarga rechazada no se queda en la caché: ni en pending/ ni como update.zip (la base de la próxima descarga parcial). */
async function discardMacDownload(m: MacUpdaterInternals): Promise<void> {
  const helper = m.downloadedUpdateHelper
  if (!helper) return
  try { rmSync(join(helper.cacheDir, 'update.zip'), { force: true }) } catch { /* nada */ }
  try { await helper.clear() } catch { /* nada */ }
}

function useOwnMacInstaller(u: AppUpdater): void {
  const m = u as unknown as MacUpdaterInternals
  m.updateDownloaded = async (zip, event) => {
    const target = macBundle()
    if (!target) throw new MacInstallError('install', 'No se encuentra la app abierta')
    if (state.status === 'downloading') set({ ...state, progress: 1 })
    const stageDir = stageDirFor(target, join(event.downloadedFile, '..', '..'))
    let staged: string
    try {
      staged = await stageMacUpdate({
        zip: event.downloadedFile, sha512: zip.info.sha512, version: event.version, bundleId: BUNDLE_ID, stageDir, current: target,
        signature: { entry: zip.info }, systemVersion: process.getSystemVersion()
      })
    } catch (e) {
      rmSync(stageDir, { recursive: true, force: true }) // nada a medias en la caché
      await discardMacDownload(m)
      throw e
    }
    macPending = { version: event.version, staged, stageDir }
    log.info(`[updates] ${event.version} comprobada y lista en ${staged}`)
    m.dispatchUpdateDownloaded(event)
    return [event.downloadedFile]
  }
  m.quitAndInstall = () => installUpdate()
}

// ── Windows y Linux ────────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que BaseUpdater (NSIS, AppImage) hace al terminar la descarga. */
interface BaseUpdaterInternals {
  dispatchUpdateDownloaded: (event: UpdateDownloadedEvent) => void
  dispatchError: (e: Error) => void
  addQuitHandler?: () => void
  downloadedUpdateHelper?: { clear(): Promise<void> } | null
}

/**
 * La versión descargada solo se da por «lista» (y solo se instala al salir) si lleva la firma de Aula. Hasta entonces
 * `autoInstallOnAppQuit` está apagado: salir mientras se comprueba no instala nada. Si la firma falla, se borra la descarga.
 */
function requireOwnSignature(u: AppUpdater): void {
  const m = u as unknown as BaseUpdaterInternals
  const dispatch = m.dispatchUpdateDownloaded.bind(u)
  u.autoInstallOnAppQuit = false
  m.dispatchUpdateDownloaded = (event) => {
    u.autoInstallOnAppQuit = false // otra descarga: nada se instala al salir hasta comprobarla
    verifyDownloadedUpdate({ file: event.downloadedFile, entry: entryForFile(event.files, event.downloadedFile), version: event.version })
      .then(() => {
        log.info(`[updates] ${event.version}: firma de Aula comprobada`)
        u.autoInstallOnAppQuit = true
        m.addQuitHandler?.call(u)
        dispatch(event)
      })
      .catch(async (e: unknown) => {
        log.warn(`[updates] ${event.version} descartada: ${e instanceof Error ? e.message : String(e)}`)
        try { await m.downloadedUpdateHelper?.clear() } catch { /* nada */ }
        m.dispatchError(e instanceof Error ? e : new Error(String(e)))
      })
  }
}

/** Al salir (o al pulsar «Reiniciar», o al apagar el Mac): la app nueva ocupa el sitio de la actual. */
function installMacOnQuit(): void {
  const target = macBundle()
  if (!macPending || !target) return
  if (!relaunchAfterInstall && !updater?.autoInstallOnAppQuit) return
  const pending = macPending
  macPending = null
  try {
    // al apagar o cerrar sesión también (A1-P2-12), pero solo con `rename` instantáneos (nunca una copia larga)
    const { backup } = swapMacBundle(target, pending.staged, { allowCopy: !shuttingDown })
    const journal: InstallJournal = { from: app.getVersion(), to: pending.version, target, backup, stageDir: pending.stageDir, at: new Date().toISOString() }
    mkdirSync(updatesDir(), { recursive: true })
    writeJSONAtomic(journalFile(), journal)
    log.info(`[updates] instalada la ${pending.version} en ${target} (copia anterior: ${backup})`)
    if (relaunchAfterInstall) startWatchdog(journal)
  } catch (e) {
    log.error('[updates] no se pudo instalar', e)
    rememberFailed(pending.version, 'install')
  }
  // con «Reiniciar», la app vuelve a abrirse: la nueva o, si falló, la de siempre (que explica el fallo)
  if (relaunchAfterInstall) app.relaunch()
}

function startWatchdog(j: InstallJournal): void {
  try {
    const script = join(updatesDir(), 'watchdog.sh')
    writeFileSync(
      script,
      watchdogScript({
        target: j.target, executable: executableIn(j.target, process.execPath), backup: j.backup, marker: startedMarker(j.to), failedFile: failedFile(),
        version: j.to, pid: process.pid, fingerprint: fingerprintFor(j.to), args: process.argv.slice(1)
      }),
      { mode: 0o700 }
    )
    rmSync(startedMarker(j.to), { force: true })
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    log.warn('[updates] vigilante', e)
  }
}

/** macOS: la descarga ya usada (~230 MB en pending/). update.zip se queda: es la base de la próxima descarga parcial (A1-P2-14). */
function dropPendingDownload(): void {
  if (process.platform !== 'darwin') return
  try { rmSync(join(homedir(), 'Library', 'Caches', 'aula-updater', 'pending'), { recursive: true, force: true }) } catch { /* nada */ }
}

/** Al arrancar: si venimos de una actualización, confirmarla cuando la ventana carga (o recoger lo que quedó). */
function settleLastInstall(): void {
  const j = readJSON<InstallJournal>(journalFile())
  const failed = readFailed(failedFile())
  if (failed && failed.version === app.getVersion()) rmSync(failedFile(), { force: true }) // esa versión ya está: olvidar el fallo
  if (!j || typeof j.to !== 'string') return
  if (j.to !== app.getVersion()) {
    // el vigilante devolvió la versión anterior (o no llegó a instalarse): limpiar y contarlo
    log.warn(`[updates] la ${j.to} no llegó a abrirse; sigue la ${app.getVersion()}`)
    cleanupAfterUpdate({ backup: '', stageDir: j.stageDir })
    dropPendingDownload()
    rmSync(journalFile(), { force: true })
    if (readFailed(failedFile())?.version === j.to) state = { status: 'error', error: 'install', errorStage: 'install', version: j.to }
    return
  }
  let confirmed = false
  const confirm = () => {
    if (confirmed) return
    confirmed = true
    try {
      writeFileSync(startedMarker(j.to), new Date().toISOString())
      cleanupAfterUpdate(j)
      rmSync(journalFile(), { force: true })
      dropPendingDownload()
      log.info(`[updates] actualizada de la ${j.from} a la ${j.to}`)
    } catch (e) {
      log.warn('[updates] al confirmar la actualización', e)
    }
  }
  state = { ...state, updatedFrom: j.from }
  // solo cuando carga la ventana PRINCIPAL (no la oculta de migrate-storage ni otra), A1-P2-17
  app.on('browser-window-created', (_e, win: BrowserWindow) => win.webContents.once('did-finish-load', () => { if (win === getMainWindow()) confirm() }))
}

/** Al abrir: si una versión más nueva ya falló (se volvió atrás, firma mala…), se avisa desde el principio (A1-P1-3). */
function rememberedFailure(): void {
  if (state.status !== 'idle') return
  const f = readFailed(failedFile())
  if (!f || compareVersions(f.version, app.getVersion()) <= 0 || !blocksAutoRetry(f, f.version)) return
  state = { ...state, status: 'available', blocked: 'failedBefore', version: f.version, error: errorOfFailure(f.reason) }
}

// ── Acciones ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function checkForUpdates(byUser = true): Promise<UpdateState> {
  const reason = unsupportedReason()
  if (reason) {
    set({ status: 'unsupported', blocked: reason })
    return state
  }
  if (state.status === 'ready' || state.status === 'downloading' || state.status === 'checking') return state
  manual = byUser
  lastCheckAt = Date.now()
  try {
    await getUpdater().checkForUpdates()
  } catch (err) {
    log.warn('[updates] check', err)
  } finally {
    manual = false
  }
  return state
}

export function installUpdate(): void {
  if (state.status !== 'ready' || !updater) return
  if (process.platform === 'darwin') {
    relaunchAfterInstall = true
    setImmediate(() => app.quit())
    return
  }
  // cierra las ventanas, ejecuta el instalador y abre la versión nueva (si falla, onError lo cuenta)
  const u = updater
  installing = true
  setImmediate(() => u.quitAndInstall(false, true))
}

export function openDownloadPage(): void {
  void shell.openExternal(DOWNLOAD_PAGE)
}

/** La próxima búsqueda automática: en 6 horas, o en 30 minutos si la última se quedó sin conexión. */
function schedule(ms: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void tick(), ms)
}

async function tick(): Promise<void> {
  if (getSettings().data.autoUpdate) await checkForUpdates(false)
  const retrySoon = state.status === 'error' && (state.error === 'offline' || state.error === 'unknown')
  schedule(retrySoon ? RETRY_MS : EVERY_MS)
}

/** Programa las búsquedas automáticas (respeta «Actualizar sola» en cada vuelta). */
export function startUpdates(): void {
  const reason = unsupportedReason()
  if (reason) {
    state = { status: 'unsupported', blocked: reason }
    return
  }
  try {
    settleLastInstall()
    rememberedFailure()
  } catch (e) {
    log.warn('[updates] al revisar la última instalación', e)
  }
  if (process.platform === 'darwin') {
    powerMonitor.on('shutdown', () => { shuttingDown = true })
    app.on('will-quit', installMacOnQuit)
  }
  schedule(FIRST_DELAY_MS)
  // los temporizadores no cuentan con el ordenador dormido: al despertar, si toca, se busca enseguida (A1-P2-13)
  powerMonitor.on('resume', () => {
    if (Date.now() - lastCheckAt > EVERY_MS) schedule(60 * 1000)
  })
  app.once('before-quit', () => timer && clearTimeout(timer))
  // ensayos: «Reiniciar» (o salir) en cuanto la versión nueva está lista
  const auto = process.env.AULA_UPDATE_AUTO_INSTALL
  if (auto) {
    getUpdater().on('update-downloaded', () => setTimeout(() => (auto === 'quit' ? app.quit() : installUpdate()), 1500))
  }
}
