// Hasta dónde llega el navegador en vivo cuando lo maneja un dispositivo: las plataformas del estudiante y su inicio de
// sesión, nada más (App Store: sin acceso web sin restricciones). Puro: sin Node ni DOM.
import type { PlatformAccount } from '@shared/settings/platforms'
import { KNOWN_PLATFORM_KINDS, hostMatches, hostOf, platformInfo } from '@engine/platforms/model'
import { isIdentityHost, isListedIdentityHost } from '@engine/platforms/identity'
import { isSharedHosting, registrableSite } from '@engine/platforms/site'

type Account = Pick<PlatformAccount, 'kind' | 'baseURL'>

/** Lo que un dispositivo puede abrir: `hosts` (patrones de hostMatches) y `sites` (sitios propios, uni.es) los pide él
 *  mismo; `linked` (la nube de su plataforma y sus archivos: `*.instructure.com`, `*.sharepoint.com`…), solo si lleva a
 *  ellos la propia página: ahí cualquiera abre su inquilino. */
export interface DeviceReach {
  hosts: string[]
  linked: string[]
  sites: string[]
}

/** 'typed': la dirección la pide el dispositivo (abrir, ir a); 'page': la abre la propia página (enlace, formulario,
 *  redirección, emergente). */
export type ReachSource = 'typed' | 'page'

/** Pasos del acceso fuera de los hosts de identidad: Microsoft (doble factor, contraseña olvidada, aka.ms), Google (avisos
 *  de recuperación) y centros de federaciones académicas (SIR, SeamlessAccess, SURFconext, RENATER). */
const SIGNIN_HOSTS: ReadonlySet<string> = new Set([
  'device.login.microsoftonline.com', 'mysignins.microsoft.com', 'account.activedirectory.windowsazure.com', 'passwordreset.microsoftonline.com', 'aka.ms',
  'gds.google.com', 'sir.rediris.es', 'sir2.rediris.es', 'service.seamlessaccess.org', 'engine.surfconext.nl', 'connect.surfconext.nl', 'discovery.renater.fr'
])

/** Rutas de acceso en un host ajeno (SAML, CAS, ADFS, OAuth, Shibboleth, SimpleSAMLphp, Keycloak…), ancladas al principio:
 *  «/wiki/SSO» o «/c/SSO» no son un inicio de sesión. */
const SIGNIN_PATHS: readonly RegExp[] = [
  /^\/log[-_]?(in|on)(\/|$|\.|\?)/, /^\/sign[-_]?(in|on)(\/|$)/, /^\/auth(\/|$)/, /^\/sso(\/|$)/, /^\/saml2?(\/|$)/, /^\/cas\/login/, /^\/idp\//,
  /^\/adfs\/ls/, /^\/simplesaml(php)?\//, /^\/oauth2?\/(v2\.0\/)?(authorize|auth)/, /^\/realms\/[^/]+\/protocol\/(openid-connect|saml)(\/|$)/,
  /^\/shibboleth\.sso\//, /^\/profile\/saml2\//,
  // los pasos siguientes de Keycloak (el formulario, otro proveedor), WSO2, Gluu/Janssen y PingFederate
  /^\/realms\/[^/]+\/(login-actions|broker)\//, /^\/authenticationendpoint\//, /^\/commonauth(\/|$)/, /^\/samlsso(\/|$)/, /^\/(oxauth|jans-auth)\//,
  /^\/as\/(authorization|token)\.oauth2/
]

/** Comodines de una nube que es de una sola organización (todos los subdominios de edx.org son de edX): no son inquilinos. */
const SINGLE_ORG_CLOUDS: ReadonlySet<string> = new Set(['*.edx.org'])

/** Destinos de la propia plataforma fuera de su nube, solo desde la página: los cuestionarios de Microsoft Forms que se
 *  enlazan en Teams y el acortador de Google Forms de Classroom (lleva a docs.google.com/forms). */
const LINKED_EXTRA: Readonly<Partial<Record<Account['kind'], readonly string[]>>> = {
  teams: ['forms.office.com', 'forms.cloud.microsoft'],
  classroom: ['forms.gle']
}

/** Portales generales: compartir sitio con una plataforma no los abre enteros (google.com no es Classroom). */
const PORTAL_SITES: ReadonlySet<string> = new Set([
  'google.com', 'youtube.com', 'microsoft.com', 'microsoftonline.com', 'live.com', 'office.com', 'cloud.microsoft', 'apple.com', 'icloud.com',
  'bing.com', 'yahoo.com', 'duckduckgo.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'reddit.com',
  'wikipedia.org', 'amazon.com', 'github.com'
])

/** Dominios de la nube de las plataformas, donde cada host es de un cliente distinto (x.instructure.com, x.sharepoint.com…). */
const TENANT_SITES: ReadonlySet<string> = new Set(
  KNOWN_PLATFORM_KINDS.flatMap((k) => [...platformInfo(k).hostPatterns, ...platformInfo(k).relatedHostPatterns])
    .filter((p) => p.startsWith('*.') && !SINGLE_ORG_CLOUDS.has(p.toLowerCase()))
    .map((p) => p.slice(2).toLowerCase())
)

/** El sitio de un host para unir hosts: el registrable, salvo en un portal general o una nube de plataformas (el propio host). */
function siteKey(host: string): string | null {
  const site = registrableSite(host)
  if (!site) return null
  return PORTAL_SITES.has(site) || TENANT_SITES.has(site) ? host.toLowerCase().replace(/\.$/, '') : site
}

/** Lo que abre un dispositivo con estas cuentas: el host de cada una y los hosts exactos de su plataforma (classroom,
 *  teams…) los puede pedir; los comodines de su nube (solo si la cuenta está en ella) y los de sus archivos, solo si lleva a
 *  ellos la página; y si es una plataforma propia, su sitio entero (el SSO, la web y la biblioteca de la universidad). */
export function deviceReach(accounts: readonly Account[]): DeviceReach {
  const hosts = new Set<string>()
  const linked = new Set<string>()
  const sites = new Set<string>()
  for (const a of accounts) {
    const info = platformInfo(a.kind)
    const host = hostOf(a.baseURL)
    const cloud = !!host && info.hostPatterns.some((p) => hostMatches(host, p))
    for (const p of info.hostPatterns.map((x) => x.toLowerCase())) {
      if (!p.startsWith('*.')) hosts.add(p)
      // un Moodle en campus.uni.es no abre MoodleCloud; un inquilino de Canvas, la nube de Canvas solo desde la página; la
      // nube de una sola organización (edX), entera
      else if (cloud) (SINGLE_ORG_CLOUDS.has(p) ? hosts : linked).add(p)
    }
    for (const p of [...info.relatedHostPatterns, ...(LINKED_EXTRA[a.kind] ?? [])]) linked.add(p.toLowerCase())
    if (!host) continue
    hosts.add(host)
    // inquilino en la nube (x.instructure.com, classroom.google.com…): solo sus hosts; una plataforma propia: su sitio
    if (cloud) continue
    const site = registrableSite(host)
    if (site && !PORTAL_SITES.has(site) && !TENANT_SITES.has(site)) sites.add(site)
  }
  return { hosts: [...hosts], linked: [...linked], sites: [...sites] }
}

/** ¿Parece un paso de acceso en un host ajeno (por el nombre del host o por la ruta)? No en un alojamiento compartido, donde
 *  cualquiera se pone «mi-sso.netlify.app», ni por la ruta en un portal general (youtube.com/signin no es la universidad). */
function looksLikeSignIn(u: URL, h: string): boolean {
  if (isSharedHosting(h)) return false
  if (isIdentityHost(h)) return true
  const site = registrableSite(h)
  if (!site || PORTAL_SITES.has(site)) return false
  const path = u.pathname.toLowerCase()
  return SIGNIN_PATHS.some((r) => r.test(path))
}

/** ¿Puede un dispositivo abrir esta dirección? Solo http(s) sin usuario ni contraseña, de sus plataformas o de un inicio de
 *  sesión. Pedida por el dispositivo ('typed'), solo sus plataformas y los proveedores de la lista; la nube de su plataforma
 *  (otro inquilino), los inquilinos de identidad (x.okta.com) y lo que solo lo parece por el nombre o la ruta (sso.uni.edu,
 *  /idp/…), solo si lleva a ello la propia página. */
export function deviceMayOpen(url: string, reach: DeviceReach, source: ReachSource): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return false
  const h = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!h) return false
  if (reach.hosts.some((p) => hostMatches(h, p))) return true
  const site = registrableSite(h)
  if (site && reach.sites.includes(site)) return true
  if (isListedIdentityHost(h, true) || SIGNIN_HOSTS.has(h)) return true
  if (source === 'typed') return false
  if (reach.linked.some((p) => hostMatches(h, p))) return true
  return isListedIdentityHost(h) || looksLikeSignIn(u, h)
}

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

/** El origen de una dirección web («https://sso.uni.edu»), o null. */
export function originKey(url: string): string | null {
  if (!isWeb(url)) return null
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return null
  }
}

const NONE: ReadonlySet<string> = new Set()

/** ¿Se puede enseñar en un dispositivo esta página? En blanco, sí. Si no, lo que podría pedir él mismo ('typed') o un paso
 *  que la propia página dio desde algo que ya se podía ver (`reached`: los orígenes a los que se llegó así) y que sigue
 *  siendo un paso permitido. Lo que abre el ordenador o Aula fuera de 'typed' no se enseña. */
export function deviceMayShow(url: string, reach: DeviceReach, reached: ReadonlySet<string> = NONE): boolean {
  if (!url || url === 'about:blank') return true
  if (deviceMayOpen(url, reach, 'typed')) return true
  const o = originKey(url)
  return !!o && reached.has(o) && deviceMayOpen(url, reach, 'page')
}

/** Lo que se apunta de un marco que llegó a un sitio (y lo que cuenta como «el mismo sitio»): el sitio registrable, o el
 *  host en un portal general, una nube de plataformas o un alojamiento compartido. */
export function frameKey(url: string): string | null {
  if (!isWeb(url)) return null
  const h = hostOf(url)
  return h ? siteKey(h) : null
}

/** De dónde sale el paso de un marco: lo que tiene ahora, quién lo pide, qué se puede ver y a qué sitios llegaron ya los marcos
 *  de esta página. */
export interface FrameStep {
  /** La dirección que tiene cargada ahora el marco ('' o about:blank si es nuevo; about:srcdoc si lo escribió la página). */
  current: string
  /** La del marco que lo pide (un enlace dentro del marco: el propio marco; el src que pone la página: la página). */
  initiator: string
  /** ¿Lo pide el propio marco (un enlace, un formulario o un script suyo)? */
  self?: boolean
  /** La dirección web del marco que lo contiene (el más cercano con una): de él es un documento en blanco o srcdoc. */
  parent?: string
  shown(url: string): boolean
  reached: ReadonlySet<string>
}

const isBlank = (url: string): boolean => !url || url === 'about:blank' || url === 'about:srcdoc'

/** ¿Puede ir a `url` un marco de una página que maneja el dispositivo (un enlace, un formulario o una redirección dentro
 *  del marco)? Sí: su primera carga (un vídeo o una herramienta que inserta la página), lo que empieza algo que el
 *  dispositivo puede ver (el lanzamiento LTI desde la plataforma), dentro del mismo sitio, de vuelta a un sitio al que ya
 *  llegó un marco de la página (la herramienta tras su inicio de sesión) y un paso permitido ('page'). Saltar desde un
 *  marco ajeno a otro sitio, no. Un documento en blanco o srcdoc que navega solo no es una primera carga: es del origen de
 *  quien lo contiene, y se mira como él. */
export function deviceFrameMayGo(url: string, step: FrameStep, reach: DeviceReach): boolean {
  let cur = step.current
  if (isBlank(cur)) {
    // lo carga quien lo contiene u otro marco (su src, location): su primera carga
    if (!step.self) return true
    cur = step.parent ?? ''
  }
  if ((isWeb(cur) && step.shown(cur)) || (isWeb(step.initiator) && step.shown(step.initiator))) return true
  const key = frameKey(url)
  if (key && (key === frameKey(cur) || step.reached.has(key))) return true
  return deviceMayOpen(url, reach, 'page')
}

/** Rutas de una plataforma que lanzan una herramienta externa (LTI) en la ventana entera: Moodle (launch.php y la vuelta de
 *  auth.php en LTI 1.3), Canvas, Brightspace y Blackboard. */
const LTI_LAUNCH_PATHS: readonly RegExp[] = [
  /^\/mod\/lti\/(launch|auth)\.php/, /\/external_tools\//, /^\/api\/lti\/authorize/, /^\/d2l\/le\/lti\//, /^\/d2l\/lti\//,
  /^\/webapps\/blackboard\/execute\/blti\//, /^\/learn\/api\/v1\/lti\//
]

/** Si la página de la plataforma `from` (una que el dispositivo puede pedir) lanza una herramienta LTI en la ventana entera y
 *  va a `to`, el sitio de la herramienta (como frameKey): la propia página puede seguir por él. Si no, null. */
export function ltiToolSite(from: string, to: string, reach: DeviceReach): string | null {
  if (!isWeb(from) || !isWeb(to) || !deviceMayOpen(from, reach, 'typed') || deviceMayOpen(to, reach, 'typed')) return null
  let path: string
  let target: URL
  try {
    path = new URL(from).pathname.toLowerCase()
    target = new URL(to)
  } catch {
    return null
  }
  if (target.username || target.password || !LTI_LAUNCH_PATHS.some((r) => r.test(path))) return null
  // un proveedor de identidad nunca es «la herramienta» (sus pasos ya valen; su sitio entero, no)
  if (isIdentityHost(target.hostname.toLowerCase().replace(/\.$/, ''))) return null
  return frameKey(to)
}

/** El alcance con los sitios de las herramientas que lanzó la plataforma (solo desde la página, como su nube). */
export function withToolSites(reach: DeviceReach, tools: ReadonlySet<string>): DeviceReach {
  return tools.size ? { ...reach, linked: [...reach.linked, ...[...tools].map((s) => `*.${s}`)] } : reach
}
