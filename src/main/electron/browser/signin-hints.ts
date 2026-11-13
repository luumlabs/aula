// Avisos de la ventana de inicio de sesión (puro: sin Electron). Explican lo que Aula no puede hacer por el estudiante:
// llaves de acceso que no funcionan en la ventana, pasos de Moodle que tiene que terminar él, bucles de redirecciones,
// errores de Microsoft Entra, pasos que quieren abrir otra app y direcciones que la guarda de destinos corta (con el
// motivo probable: VPN o proxy «fake-IP», DNS del campus, bloqueadores). La guarda no se relaja: solo se explica.
import { tr } from '@shared/ai/i18n'
import { hostMatches, isIdentityHost, sameRegistrableSite } from '@engine/platforms'
import { parseIPv4Literal, parseIPv6 } from '@main/services/ingest/extract/web'

/** Un aviso: `kind` sin espacios (uno de cada por ventana). */
export interface SignInHint {
  kind: string
  title: string
  detail?: string
}

// MARK: Llaves de acceso, pasos, bucles y Entra

/** ¿Toca el aviso de las llaves de acceso? Sin interfaz de passkeys (macOS, Linux) al pedirse; en Windows, si falló. */
export function passkeyHintDue(marker: string | null | undefined, noNativeUI: boolean): boolean {
  return marker === 'failed' || (noNativeUI && marker === 'asked')
}

export function passkeyHint(): SignInHint {
  return {
    kind: 'passkey',
    title: tr(
      'Las llaves de acceso (passkeys) no funcionan en esta ventana de Aula: elige «Otras formas de iniciar sesión» (código de Authenticator, SMS o contraseña).',
      'Passkeys don’t work in this Aula window: choose “Other ways to sign in” (Authenticator code, SMS or password).'
    )
  }
}

export function stepHint(): SignInHint {
  return {
    kind: 'step',
    title: tr(
      'Moodle te pide aceptar su política o completar tu perfil: hazlo aquí y la ventana se cerrará sola.',
      'Moodle asks you to accept its policy or complete your profile: do it here and this window will close by itself.'
    )
  }
}

export function loopHint(): SignInHint {
  return {
    kind: 'loop',
    title: tr(
      'Parece que Moodle te devuelve una y otra vez al inicio de sesión. Prueba en Safari o Chrome: si allí también pasa, es la configuración de tu universidad.',
      'Moodle seems to keep sending you back to sign in. Try it in Safari or Chrome: if it happens there too, it is your university’s setup.'
    )
  }
}

/** Microsoft no deja entrar desde este equipo (acceso condicional: dispositivo registrado, conforme o una app concreta). */
export function devicePolicyHint(code: string): SignInHint {
  const c = /^AADSTS\d+$/i.test(code) ? ` (${code.toUpperCase()})` : ''
  return {
    kind: 'device',
    title: tr(
      `Tu universidad solo deja entrar desde equipos registrados${c}: usa su portal o el navegador que te indiquen.`,
      `Your university only lets you sign in from registered devices${c}: use its portal or the browser they tell you to.`
    )
  }
}

/** Esquemas que no son «otra aplicación» (web, internos, correo y teléfono): no merecen el aviso. */
const NOT_AN_APP = new Set(['http', 'https', 'ws', 'wss', 'about', 'javascript', 'data', 'blob', 'file', 'filesystem', 'mailto', 'tel', 'chrome', 'chrome-error', 'chrome-extension', 'devtools'])

/** El esquema de otra aplicación (`msauth`, `ms-outlook`, `companyportal`…) de una dirección, o null. Nunca la dirección. */
export function externalSchemeOf(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]{0,31}):/i.exec((url ?? '').trim())
  if (!m) return null
  const scheme = m[1].toLowerCase()
  return NOT_AN_APP.has(scheme) ? null : scheme
}

export function externalAppHint(scheme: string): SignInHint {
  return {
    kind: 'app',
    title: tr(
      `Este paso quiere abrir otra aplicación (${scheme}): Aula no la abre desde aquí; elige otro método para iniciar sesión.`,
      `This step wants to open another app (${scheme}): Aula doesn’t open it from here; choose another way to sign in.`
    )
  }
}

// MARK: Direcciones cortadas por la guarda de destinos

/** Por qué apunta un host a la red local: fake-IP (198.18/15), CGNAT (100.64/10), privada, este equipo, nombre local u otro. */
export type BlockedAddressKind = 'fakeIP' | 'cgnat' | 'private' | 'loopback' | 'localName' | 'other'

const LOCAL_NAME = /(^localhost$|\.(localhost|local|internal|lan|home|home\.arpa|corp|intranet|private|localdomain)$)/

function ipv4Kind(v: number): BlockedAddressKind | null {
  const a = (v >>> 24) & 255
  const b = (v >>> 16) & 255
  if (a === 198 && (b === 18 || b === 19)) return 'fakeIP'
  if (a === 0 || a === 127) return 'loopback'
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'private'
  return null
}

function addressKind(address: string): BlockedAddressKind | null {
  const v4 = parseIPv4Literal(address)
  if (v4 !== null) return ipv4Kind(v4)
  const v6 = parseIPv6(address.replace(/%.*$/, ''))
  if (!v6) return null
  const zero = (from: number, to: number): boolean => v6.slice(from, to).every((x) => x === 0)
  if (zero(0, 10) && v6[10] === 0xff && v6[11] === 0xff) return ipv4Kind(((v6[12] << 24) | (v6[13] << 16) | (v6[14] << 8) | v6[15]) >>> 0)
  if (zero(0, 15) && (v6[15] === 0 || v6[15] === 1)) return 'loopback'
  if (v6[0] === 0xfc || v6[0] === 0xfd || (v6[0] === 0xfe && (v6[1] & 0xc0) === 0x80)) return 'private'
  return null
}

/** El motivo probable de un corte, por el nombre y las direcciones a las que resuelve (el más revelador primero). */
export function blockedAddressKind(host: string, addresses: readonly string[]): BlockedAddressKind {
  const h = (host ?? '').toLowerCase().replace(/\.+$/, '')
  if (LOCAL_NAME.test(h) || (!!h && !h.includes('.') && !h.includes(':'))) return 'localName'
  const kinds = new Set<BlockedAddressKind>()
  for (const a of [h, ...addresses]) {
    const k = addressKind(a)
    if (k) kinds.add(k)
  }
  for (const k of ['fakeIP', 'loopback', 'cgnat', 'private'] as const) if (kinds.has(k)) return k
  return 'other'
}

/** Recursos de las páginas de inicio de sesión (Microsoft, Google) que viven fuera de los hosts de identidad. */
const IDENTITY_ASSET_HOSTS = ['*.msauth.net', '*.msftauth.net', '*.msauthimages.net', '*.msftauthimages.net', '*.microsoftonline.com', '*.microsoftonline-p.com', '*.live.com', '*.gstatic.com']

/**
 * ¿Merece aviso este corte? Siempre si era la página (la ventana se queda en blanco). De lo que carga una página, solo lo
 * del inicio de sesión (identidad y sus recursos) y lo de la propia plataforma: un rastreador cortado por un bloqueador de
 * DNS no es cosa de Aula.
 */
export function blockedHintRelevant(input: { host: string; mainFrame: boolean; kind: BlockedAddressKind; platformHosts: readonly string[] }): boolean {
  if (input.mainFrame) return true
  const h = input.host.toLowerCase()
  if (isIdentityHost(h) || IDENTITY_ASSET_HOSTS.some((p) => hostMatches(h, p))) return true
  if (input.kind === 'loopback') return false
  return input.platformHosts.some((p) => !!p && (p.toLowerCase() === h || sameRegistrableSite(p, h)))
}

function blockedDetail(host: string, kind: BlockedAddressKind, reason: string): string {
  switch (kind) {
    case 'fakeIP': return tr(
      `${host} apunta a una dirección «fake-IP» (198.18.x.x): un VPN o proxy en modo fake-IP o TUN (Clash, Surge, Stash, Shadowrocket…) se interpone. Apágalo mientras usas Aula o excluye de él los dominios de inicio de sesión (login.microsoftonline.com, *.msauth.net, *.msftauth.net).`,
      `${host} points to a “fake-IP” address (198.18.x.x): a VPN or proxy in fake-IP or TUN mode (Clash, Surge, Stash, Shadowrocket…) is in the way. Turn it off while you use Aula, or exclude the sign-in domains from it (login.microsoftonline.com, *.msauth.net, *.msftauth.net).`
    )
    case 'cgnat': return tr(
      `${host} apunta a una dirección 100.64–127.x.x, la de un VPN o de la red de tu operadora. Apaga el VPN mientras usas Aula o prueba desde otra red.`,
      `${host} points to a 100.64–127.x.x address, used by VPNs or your carrier’s network. Turn the VPN off while you use Aula, or try another network.`
    )
    case 'private': return tr(
      `${host} apunta a una dirección privada (10.x, 172.16–31.x o 192.168.x): suele ser el DNS del campus o de un VPN. Prueba con el VPN apagado o desde otra red (por ejemplo, los datos del móvil).`,
      `${host} points to a private address (10.x, 172.16–31.x or 192.168.x): usually the campus or VPN DNS. Try with the VPN off or from another network (for example, your phone’s data).`
    )
    case 'loopback': return tr(
      `${host} apunta a este mismo equipo (0.0.0.0 o 127.x): lo corta un bloqueador de anuncios o de DNS (Pi-hole, AdGuard, NextDNS…), y en Safari o Chrome tampoco cargaría. Permite ese dominio en el bloqueador.`,
      `${host} points to this computer (0.0.0.0 or 127.x): an ad or DNS blocker (Pi-hole, AdGuard, NextDNS…) is cutting it, and it wouldn’t load in Safari or Chrome either. Allow that domain in the blocker.`
    )
    case 'localName': return tr(`${host} es un nombre de la red local.`, `${host} is a local network name.`)
    default: return reason ? `${reason}.` : ''
  }
}

/** Aviso de un corte de la guarda: nombra el host y el motivo, con el consejo. */
export function blockedHint(host: string, kind: BlockedAddressKind, reason: string): SignInHint {
  return {
    kind: `blocked:${host.toLowerCase()}`,
    title: tr(
      `Aula no ha abierto ${host}: por seguridad no abre direcciones de este equipo ni de la red local.`,
      `Aula didn’t open ${host}: for your safety it doesn’t open addresses on this computer or the local network.`
    ),
    detail: blockedDetail(host, kind, reason)
  }
}

const escapeHTML = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Página local (data:) que explica un corte cuando era la página entera (la ventana se quedaría en blanco). */
export function blockedPageURL(hint: SignInHint, lang: 'es' | 'en'): string {
  const next = tr(
    'Cuando lo hayas cambiado, cierra esta ventana y vuelve a pulsar «Iniciar sesión» en Aula.',
    'Once you’ve changed it, close this window and click Sign in again in Aula.'
  )
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>Aula</title><style>
html,body{margin:0;min-height:100%;background:#f4efe6;color:#201e1a;font:500 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{box-sizing:border-box;max-width:600px;margin:0 auto;padding:12vh 24px 24px}
.card{display:flex;gap:14px;align-items:flex-start;padding:22px 24px;border-radius:22px;background:#fcfaf5;box-shadow:0 18px 50px rgba(43,37,34,.16),0 0 0 1px rgba(43,37,34,.06)}
.k{flex:none;width:36px;height:36px;border-radius:12px;background:#b4502f;color:#fff;display:flex;align-items:center;justify-content:center;font:700 20px/1 Georgia,serif}
h1{margin:0;font:600 20px/1.35 Georgia,"Times New Roman",serif}
p{margin:10px 0 0;color:#585550}
</style></head><body><main><div class="card" role="alert"><div class="k" aria-hidden="true">!</div><div><h1>${escapeHTML(hint.title)}</h1>${hint.detail ? `<p>${escapeHTML(hint.detail)}</p>` : ''}<p>${escapeHTML(next)}</p></div></div></main></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

// MARK: Registro

/**
 * Ruta para el registro: sin parámetros `;jsessionid=…` y con los tramos que parecen claves o identificadores largos
 * (tokens, GUID de inquilino) cambiados por «…». Como mucho 120 caracteres.
 */
export function pathForLog(path: string): string {
  const clean = path
    .replace(/;[^/]*/g, '')
    .split('/')
    .map((seg) => (/^[A-Za-z0-9_.~%-]{32,}$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? '…' : seg))
    .join('/')
  return clean.length > 120 ? clean.slice(0, 120) + '…' : clean
}

/** Un salto `host/ruta` (como los da SignInWatch.recentHops) listo para el registro. */
export function hopKeyForLog(hop: string): string {
  const i = hop.indexOf('/')
  return i < 0 ? hop : hop.slice(0, i) + pathForLog(hop.slice(i))
}

/** Host y ruta (sin consulta ni fragmento) para el registro; null si no es una dirección web. */
export function hopForLog(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return { host: u.host.toLowerCase(), path: pathForLog(u.pathname) }
  } catch {
    return null
  }
}
