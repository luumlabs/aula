// Mismo sitio registrable (uni.edu, uni.ac.uk, unam.edu.mx…) y el Moodle de la cuenta en otro host de ese sitio (la
// dirección guardada era un alias o un portal). Aproximado y prudente, sin la lista completa de sufijos públicos: ante la
// duda NO une, y nunca une hosts de identidad. Puro: sin Node ni DOM.
import type { PlatformAccount } from '@shared/settings/platforms'
import { isIdentityHost } from './identity'
import { accountContains, hostOf } from './model'
import { extractMoodleConfig } from './moodle'

/** Segundas etiquetas que, bajo un dominio de país, son sufijo público (ac.uk, edu.mx, com.ar, gob.es, org.co, co.jp…). */
const SECOND_LEVEL = new Set([
  'ac', 'edu', 'com', 'gob', 'gov', 'gub', 'org', 'co', 'net', 'mil', 'nic', 'int', 'sch', 'go', 'or', 'ne', 'ed', 'gv', 'govt', 'school', 'k12'
])
/** Estados de Australia: `<estado>.edu.au` es sufijo público (cada colegio es `x.<estado>.edu.au`). */
const AU_STATES = new Set(['act', 'nsw', 'nt', 'qld', 'sa', 'tas', 'vic', 'wa'])
/**
 * Dominios de país con sufijos públicos geográficos que no caben en una lista (lodz.pl, tokyo.jp, chiyoda.tokyo.jp,
 * milano.it, msk.ru, oslo.no…): bajo ellos, con una segunda etiqueta desconocida, cada host es su propio sitio.
 */
const GEOGRAPHIC_CCTLDS = new Set(['jp', 'pl', 'it', 'ru', 'ua', 'no', 'br', 'kr', 'cn', 'hu', 'tr'])
/** Sufijos públicos propios de algunos países (provincias de Canadá, condados de Suecia, estados de Australia, gouv.fr…). */
const COUNTRY_SLDS: Readonly<Record<string, ReadonlySet<string>>> = {
  ca: new Set(['ab', 'bc', 'mb', 'nb', 'nf', 'nl', 'ns', 'nt', 'nu', 'on', 'pe', 'qc', 'sk', 'yk']),
  se: new Set([
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'w', 'x', 'y', 'z', 'bd', 'fh', 'fhsk', 'fhv',
    'komforb', 'kommunalforbund', 'komvux', 'lanbib', 'naturbruksgymn', 'parti', 'pp', 'press', 'tm', 'brand'
  ]),
  au: AU_STATES,
  fr: new Set(['gouv', 'asso', 'nom', 'prd', 'tm', 'cci', 'greta', 'port', 'presse'])
}
/** Bajo `<estado>.us`, estas etiquetas también son sufijo público (`distrito.k12.ca.us`). */
const US_LOCALITY = new Set(['k12', 'cc', 'lib', 'tec', 'gen', 'state', 'dst', 'cog', 'mus', 'pvt', 'ci', 'co'])
/** Alojamientos compartidos: cada host es de un cliente distinto (dos colegios en MoodleCloud no son el mismo sitio). */
const SHARED_HOSTING = new Set([
  'moodlecloud.com', 'gnomio.com', 'mrooms.net', 'mrooms3.net', 'github.io', 'gitlab.io', 'herokuapp.com', 'azurewebsites.net',
  'cloudfront.net', 'amazonaws.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'netlify.app', 'vercel.app', 'pages.dev',
  'onrender.com', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'blogspot.com', 'wordpress.com', 'wixsite.com'
])

function isIPHost(h: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[')
}

/** Cuántas etiquetas finales forman el sitio registrable. */
function siteLabelCount(labels: string[]): number {
  if (labels.length === 1) return 1
  const tld = labels[labels.length - 1]
  const second = labels[labels.length - 2]
  const third = labels[labels.length - 3] ?? ''
  // en un alojamiento compartido solo se une el mismo host
  if (SHARED_HOSTING.has(`${second}.${tld}`)) return labels.length
  if (tld === 'us' && second.length === 2) return US_LOCALITY.has(third) ? 4 : 3
  if (tld === 'au' && second === 'edu' && AU_STATES.has(third)) return 4
  if (tld.length === 2 && (SECOND_LEVEL.has(second) || COUNTRY_SLDS[tld]?.has(second))) return 3
  // ante la duda no se une: «uni.lodz.pl» y «evil.lodz.pl» no son el mismo sitio
  if (GEOGRAPHIC_CCTLDS.has(tld)) return labels.length
  return 2
}

/** Sitio registrable de un host («ev.uni.ac.uk» → «uni.ac.uk»); una IP es su propio sitio; null si el host es un sufijo público. */
export function registrableSite(host: string): string | null {
  const h = (host ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!h) return null
  if (isIPHost(h)) return h
  const labels = h.split('.')
  if (labels.some((l) => !l)) return null
  const n = siteLabelCount(labels)
  if (labels.length < n) return null
  return labels.slice(-n).join('.')
}

function asHost(s: string): string {
  const t = (s ?? '').trim()
  return (t.includes('://') ? hostOf(t) ?? '' : t).toLowerCase()
}

/** ¿Dos hosts (o direcciones) son del mismo sitio registrable? Nunca une hosts de identidad (el SSO no es la plataforma). */
export function sameRegistrableSite(a: string, b: string): boolean {
  const ha = asHost(a)
  const hb = asHost(b)
  if (!ha || !hb || isIdentityHost(ha) || isIdentityHost(hb)) return false
  const sa = registrableSite(ha)
  return !!sa && sa === registrableSite(hb)
}

/** Raíz `https://host[/carpeta]` (sin barra final) a partir del `wwwroot` de Moodle, si es del mismo host que la página. */
export function moodleRootFromWwwroot(wwwroot: string, pageURL: string): string | null {
  let w: URL
  let p: URL
  try {
    w = new URL(wwwroot)
    p = new URL(pageURL)
  } catch {
    return null
  }
  if ((w.protocol !== 'https:' && w.protocol !== 'http:') || w.username || w.password) return null
  if (w.hostname.toLowerCase() !== p.hostname.toLowerCase()) return null
  // nunca se baja a http si la página llegó por https
  const origin = w.protocol === 'http:' && p.protocol === 'https:' ? p.origin : w.origin
  return origin.toLowerCase() + w.pathname.replace(/\/+$/, '')
}

/** ¿Pasar de `from` a `to` bajaría de https a http? (nunca se hace: la sesión y la sesskey irían sin cifrar). */
export function downgradesToHttp(from: string, to: string): boolean {
  return /^https:/i.test(from) && !/^https:/i.test(to)
}

/**
 * Raíz del Moodle de la cuenta en OTRO host del mismo sitio: la página no es de la cuenta ni de un proveedor de identidad,
 * su `M.cfg.wwwroot` tiene el host de la propia página y ese host comparte el sitio registrable con el de la cuenta.
 * Nunca una raíz http para una cuenta https. Null en cualquier otro caso (y siempre para lo que no es Moodle).
 */
export function moodleAliasRoot(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, pageURL: string, html: string | null | undefined): string | null {
  if (account.kind !== 'moodle' || !html) return null
  const page = hostOf(pageURL)
  const mine = hostOf(account.baseURL)
  if (!page || !mine || !/^https?:/i.test(pageURL) || accountContains(account, pageURL)) return null
  if (isIdentityHost(page) || !sameRegistrableSite(page, mine)) return null
  const www = extractMoodleConfig(html).wwwroot
  const root = www ? moodleRootFromWwwroot(www, pageURL) : null
  return root && !downgradesToHttp(account.baseURL, root) ? root : null
}
