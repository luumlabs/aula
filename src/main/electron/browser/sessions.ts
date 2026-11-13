// Una sesión de Chromium persistente por cuenta de plataforma: `persist:platform-<id>` (cookies, localStorage e IndexedDB en
// disco, dentro de «Browser Data»). Agente de usuario de Chrome normal (sin «Electron/x» ni «Aula/x», para que Google o
// Microsoft no bloqueen el inicio de sesión), sin corrector, sin cámara ni micrófono ni ningún otro permiso, descargas
// desviadas al gestor de Aula y un contador de peticiones por pestaña (para esperar a que la red quede quieta). También apunta,
// por pestaña o ventana, lo que la guarda de destinos corta y las otras apps que una página quiso abrir (la ventana de
// inicio de sesión lo explica al estudiante): solo el host o el esquema, nunca direcciones completas ni valores.
import { app, powerMonitor, session as electronSession, type Session, type DownloadItem, type WebContents } from 'electron'
import { acceptLanguages, chromeUserAgent, hostOf } from '@engine/platforms'
import { log } from '@main/services/log'
import { accountIsOnLocalNetwork, createDestinationGuard, privateAllowedFor, type DestinationGuard } from '@main/services/platforms/destinations'
import { tr } from '@shared/ai/i18n'
import { blockedAddressKind, externalSchemeOf, type BlockedAddressKind } from './signin-hints'

/** Partición de una cuenta; null = navegación sin cuenta (sesión en memoria, sin cookies de ninguna plataforma). */
export function partitionFor(accountId: string | null): string {
  if (accountId == null) return 'platform-web'
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) throw new Error(tr('Id de cuenta no válido', 'Invalid account id'))
  return `persist:platform-${accountId}`
}

/** Permisos que una página de plataforma puede tener (inocuos). Todo lo demás, denegado: cámara, micrófono, ubicación… */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

type DownloadRouter = (accountId: string | null, item: DownloadItem, wc: WebContents | undefined) => void
type RequestGuard = (url: string, method: string, resourceType: string, body?: string) => boolean

const configured = new Set<string>()
const inflight = new Map<number, Set<number>>()
const lastActivity = new Map<number, number>()
const guards = new Map<number, RequestGuard>()
let downloadRouter: DownloadRouter | null = null
/** Dirección base de una cuenta (para saber si su plataforma está en la red local). */
let accountBase: (accountId: string) => string | null = () => null
const guardsBySession = new Map<string, DestinationGuard>()
/** ¿La plataforma de la cuenta está en la red local? Caduca (la red cambia: VPN, otra wifi) y se olvida al despertar. */
const localAccounts = new Map<string, { answer: Promise<boolean>; at: number }>()
const LOCAL_ACCOUNT_TTL_MS = 5 * 60_000
let resumeHooked = false

/** Una petición cortada por la guarda de destinos (solo el host: nunca la dirección ni su consulta). */
export interface BlockedDestination {
  host: string
  /** Por qué (texto de la guarda, que solo nombra el host). */
  reason: string
  /** Era la página entera (la ventana se queda en blanco) y no un recurso suyo. */
  mainFrame: boolean
  /** Motivo probable según las direcciones a las que resuelve. */
  kind: BlockedAddressKind
  at: number
}
const blockedByWc = new Map<number, BlockedDestination[]>()
const externalByWc = new Map<number, string[]>()
const MAX_NOTES_PER_WC = 30

/** Quién dice la dirección de cada cuenta (el navegador de plataformas). */
export function setAccountBaseResolver(fn: (accountId: string) => string | null): void {
  accountBase = fn
  localAccounts.clear()
}

function resolverFor(ses: Session) {
  return (host: string): Promise<string[]> => ses.resolveHost(host).then((r) => r.endpoints.map((e) => e.address)).catch(() => [])
}

/** ¿Esta dirección, con la sesión de esta cuenta, puede llegar a la red local? Solo si su propia plataforma está ahí, y solo a
 * los servidores de esa plataforma (A2-P2-10). */
function mayReachLocalNetwork(ses: Session, accountId: string | null, url: string): Promise<boolean> {
  if (accountId == null) return Promise.resolve(false)
  const base = accountBase(accountId)
  if (!base) return Promise.resolve(false)
  if (!privateAllowedFor(base, url)) return Promise.resolve(false)
  const key = `${accountId}\u0000${base}`
  const hit = localAccounts.get(key)
  if (hit && Date.now() - hit.at < LOCAL_ACCOUNT_TTL_MS) return hit.answer
  const answer = accountIsOnLocalNetwork(base, resolverFor(ses)).catch(() => false)
  localAccounts.set(key, { answer, at: Date.now() })
  return answer
}

/** Al despertar el equipo la red puede ser otra: se vuelve a mirar si cada plataforma está en la red local. */
function hookResume(): void {
  if (resumeHooked) return
  resumeHooked = true
  try {
    powerMonitor.on('resume', () => localAccounts.clear())
  } catch {
    // sin powerMonitor (pruebas): basta la caducidad
  }
}

/** Apunta un corte de la guarda para la pestaña o ventana que lo pidió (con el motivo probable, sin la dirección). */
function noteBlocked(ses: Session, wcId: number | undefined, url: string, reason: string, mainFrame: boolean): void {
  const host = hostOf(url)
  if (wcId == null || !host) return
  const known = blockedByWc.get(wcId)
  if (known?.some((b) => b.host === host && b.mainFrame === mainFrame)) return
  void resolverFor(ses)(host)
    .then((addresses) => blockedAddressKind(host, addresses), () => blockedAddressKind(host, []))
    .then((kind) => {
      let list = blockedByWc.get(wcId)
      if (!list) blockedByWc.set(wcId, (list = []))
      if (list.some((b) => b.host === host && b.mainFrame === mainFrame)) return
      if (list.length >= MAX_NOTES_PER_WC) list.shift()
      list.push({ host, reason, mainFrame, kind, at: Date.now() })
    })
}

/** Lo que la guarda cortó en una pestaña o ventana (la ventana de acceso lo explica). */
export function blockedDestinations(webContentsId: number): BlockedDestination[] {
  return [...(blockedByWc.get(webContentsId) ?? [])]
}

/** Una página quiso abrir otra aplicación (msauth:, ms-outlook:…): se apunta solo el esquema. */
export function noteExternalScheme(webContentsId: number, url: string | undefined): void {
  const scheme = externalSchemeOf(url ?? '')
  if (!scheme) return
  let list = externalByWc.get(webContentsId)
  if (!list) externalByWc.set(webContentsId, (list = []))
  if (!list.includes(scheme) && list.length < MAX_NOTES_PER_WC) list.push(scheme)
}

/** Los esquemas de otras apps que pidió una pestaña o ventana (en el orden en que aparecieron). */
export function externalSchemes(webContentsId: number): string[] {
  return [...(externalByWc.get(webContentsId) ?? [])]
}

/**
 * Por qué no se puede abrir esta dirección con la sesión de la cuenta (este equipo o la red local), o null. Lo comprueba
 * cada petición (también las redirecciones); el navegador lo pregunta antes para dar un error claro.
 */
export async function destinationProblem(accountId: string | null, url: string): Promise<string | null> {
  const ses = platformSession(accountId)
  const guard = guardsBySession.get(partitionFor(accountId))
  if (!guard) return null
  return guard.check(url, await mayReachLocalNetwork(ses, accountId, url))
}

/** Quién decide qué hacer con cada descarga (el gestor de descargas del navegador de Aula). */
export function setDownloadRouter(fn: DownloadRouter): void {
  downloadRouter = fn
}

/** Guarda de red para una pestaña de automatización: false = la petición se corta (p. ej. una dirección que entrega). */
export function setRequestGuard(webContentsId: number, guard: RequestGuard | null): void {
  if (guard) guards.set(webContentsId, guard)
  else guards.delete(webContentsId)
}

/** Peticiones en vuelo de una pestaña y última actividad de red (ms). */
export function networkState(webContentsId: number): { inflight: number; lastActivity: number } {
  return { inflight: inflight.get(webContentsId)?.size ?? 0, lastActivity: lastActivity.get(webContentsId) ?? 0 }
}

export function forgetWebContents(webContentsId: number): void {
  inflight.delete(webContentsId)
  lastActivity.delete(webContentsId)
  guards.delete(webContentsId)
  blockedByWc.delete(webContentsId)
  externalByWc.delete(webContentsId)
}

function track(wcId: number | undefined, reqId: number, start: boolean): void {
  if (wcId == null) return
  let set = inflight.get(wcId)
  if (!set) inflight.set(wcId, (set = new Set()))
  if (start) {
    if (set.size > 2000) set.clear()
    set.add(reqId)
  } else set.delete(reqId)
  lastActivity.set(wcId, Date.now())
}

/** La sesión de una cuenta, configurada una sola vez. */
export function platformSession(accountId: string | null): Session {
  const partition = partitionFor(accountId)
  const ses = electronSession.fromPartition(partition, { cache: accountId != null })
  if (configured.has(partition)) return ses
  configured.add(partition)
  hookResume()

  ses.setUserAgent(chromeUserAgent(ses.getUserAgent(), [app.getName(), 'Aula']), acceptLanguages(app.getLocale()))
  ses.setSpellCheckerEnabled(false)
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    // abrir otra app (msauth:, ms-outlook:…): nunca; se apunta el esquema para explicarlo en la ventana de acceso
    if (permission === 'openExternal' && wc && 'externalURL' in details) noteExternalScheme(wc.id, details.externalURL)
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler((_req, callback) => callback(null))
  ses.on('select-hid-device', (e, _d, cb) => { e.preventDefault(); cb('') })
  ses.on('select-serial-port', (e, _p, _wc, cb) => { e.preventDefault(); cb('') })
  ses.on('select-usb-device', (e, _d, cb) => { e.preventDefault(); cb('') })

  const destinations = createDestinationGuard({ resolver: resolverFor(ses) })
  guardsBySession.set(partition, destinations)
  ses.webRequest.onBeforeRequest((details, callback) => {
    const wcId = details.webContentsId
    const guard = wcId != null ? guards.get(wcId) : undefined
    if (guard && !guard(details.url, details.method, details.resourceType, requestBody(details))) {
      log.info(`[platforms] petición bloqueada por seguridad (${details.method} ${safeOrigin(details.url)})`)
      callback({ cancel: true })
      return
    }
    // solo http(s) (y los internos de Chromium); nada de file: ni esquemas de otras apps
    if (!/^(https?|wss?|data|blob|chrome-extension|devtools):/i.test(details.url)) {
      if (wcId != null) noteExternalScheme(wcId, details.url)
      callback({ cancel: true })
      return
    }
    // ni este equipo ni la red local (el nombre se resuelve antes de conectar; cada redirección vuelve a pasar por aquí)
    void mayReachLocalNetwork(ses, accountId, details.url)
      .then((allowPrivate) => destinations.check(details.url, allowPrivate))
      .then((why) => {
        if (why) {
          log.info(`[platforms] dirección local o privada bloqueada (${safeOrigin(details.url)}): ${why}`)
          noteBlocked(ses, wcId, details.url, why, details.resourceType === 'mainFrame')
          callback({ cancel: true })
          return
        }
        track(wcId, details.id, true)
        callback({})
      })
      .catch(() => callback({ cancel: true }))
  })
  ses.webRequest.onCompleted((details) => track(details.webContentsId, details.id, false))
  ses.webRequest.onErrorOccurred((details) => track(details.webContentsId, details.id, false))

  ses.on('will-download', (_e, item, wc) => {
    if (downloadRouter) downloadRouter(accountId, item, wc)
    else item.cancel()
  })
  return ses
}

/** Primeros 16 KB del cuerpo de una petición que no es GET (para reconocer entregas por AJAX); nunca se registra. */
function requestBody(details: { method: string; uploadData?: { bytes?: Buffer }[] }): string | undefined {
  const m = details.method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || !details.uploadData?.length) return undefined
  let out = ''
  for (const part of details.uploadData) {
    if (!part.bytes) continue
    out += part.bytes.subarray(0, 16_384 - out.length).toString('utf8')
    if (out.length >= 16_384) break
  }
  return out
}

export function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '?'
  }
}

/** Borra todo lo que guarda la sesión de una cuenta (cookies, almacenamiento, caché). */
export async function clearPlatformSession(accountId: string): Promise<void> {
  const ses = platformSession(accountId)
  await ses.clearStorageData()
  await ses.clearCache()
  try {
    await ses.cookies.flushStore()
  } catch { /* nada */ }
}
