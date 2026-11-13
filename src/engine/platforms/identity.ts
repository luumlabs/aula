// Proveedores de identidad (SSO): reconocer sus hosts y leer los códigos de error de Microsoft Entra que explican por qué
// no se puede entrar (política de dispositivo, bucle de peticiones). Puro: sin Node ni DOM.

/** Hosts exactos o dominios (`*.x`) de proveedores de identidad. */
const IDENTITY_HOSTS = [
  'login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'login.live.com', 'account.live.com', 'sts.windows.net',
  'accounts.google.com', 'accounts.youtube.com', 'appleid.apple.com', 'idmsa.apple.com',
  '*.okta.com', '*.oktapreview.com', '*.okta-emea.com', '*.auth0.com', '*.duosecurity.com', '*.onelogin.com', '*.pingone.com', '*.pingidentity.com',
  '*.clever.com', 'clever.com', 'launchpad.classlink.com', '*.classlink.com', '*.cirrusidentity.com', 'wayf.surfnet.nl', '*.eduroam.org',
  'idp.rediris.es', '*.gakunin.jp', '*.ukfederation.org.uk', '*.incommon.org', '*.b2clogin.com', '*.ciamlogin.com', 'authn.edx.org'
]
/** Primeras etiquetas del host típicas de un servidor de identidad propio (sso.uni.edu, idp.uni.edu, cas.uni.edu…). */
const IDENTITY_PREFIXES = ['sso', 'idp', 'cas', 'shibboleth', 'shib', 'adfs', 'fs', 'sts', 'login', 'auth', 'weblogin', 'websso', 'wayf', 'signin', 'secure-login', 'identity', 'iam', 'accounts', 'passport']

/** ¿Es el host de un proveedor de inicio de sesión único (Microsoft, Google, Okta, Shibboleth, CAS, ADFS…)? */
export function isIdentityHost(host: string): boolean {
  const h = host.toLowerCase()
  if (!h) return false
  for (const p of IDENTITY_HOSTS) {
    if (p.startsWith('*.')) {
      const base = p.slice(2)
      if (h === base || h.endsWith('.' + base)) return true
    } else if (h === p) return true
  }
  const first = h.split('.')[0] ?? ''
  if (h.split('.').length >= 3 && IDENTITY_PREFIXES.includes(first)) return true
  return h.includes('shibboleth') || /(^|[.-])(sso|idp|adfs)([.-]|$)/.test(h)
}

// MARK: Errores de Microsoft Entra

/** `devicePolicy`: la universidad solo deja entrar desde equipos registrados; `requestLoop`: Microsoft cortó un bucle. */
export type EntraErrorKind = 'devicePolicy' | 'requestLoop'

/** Códigos de acceso condicional que piden un dispositivo registrado, conforme o con una app concreta. */
const DEVICE_POLICY_CODES = new Set(['53000', '53001', '53002', '53003', '50097', '50155', '530032'])
const REQUEST_LOOP_CODES = new Set(['50196'])

/**
 * ¿Qué error de Entra muestra el texto? Solo mira los códigos `AADSTS<número>` (el número entero: 530032 no es 53003);
 * el primero conocido decide. Null si no hay ninguno conocido (contraseña mal, etc. ya los explica Microsoft).
 */
export function entraErrorKind(text: string): EntraErrorKind | null {
  for (const m of (text ?? '').matchAll(/AADSTS(\d+)/gi)) {
    const code = m[1] ?? ''
    if (DEVICE_POLICY_CODES.has(code)) return 'devicePolicy'
    if (REQUEST_LOOP_CODES.has(code)) return 'requestLoop'
  }
  return null
}
