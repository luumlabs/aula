// Qué direcciones abre el navegador de Aula (port de BrowserKit/Policy/URLPolicy.swift): solo http y https. `file:`,
// `javascript:`, `data:`, `chrome:`, `about:`, `mailto:`… y las direcciones con usuario:contraseña se rechazan ANTES de abrir nada.

export type URLPolicyError = 'invalid_url' | 'forbidden_scheme' | 'credentials_in_url'

export type NormalizedURL = { ok: true; url: string } | { ok: false; error: URLPolicyError; detail: string }

/** «example.com/x» → «https://example.com/x»; «http:example.com» → «http://example.com»; «localhost:8080/x» es un puerto. */
export function normalizeBrowserURL(raw: string): NormalizedURL {
  const s = (raw ?? '').trim()
  if (!s) return { ok: false, error: 'invalid_url', detail: '' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: 'invalid_url', detail: s.slice(0, 200) }
  let candidate = s
  const sep = s.indexOf('://')
  if (sep >= 0) {
    const scheme = s.slice(0, sep).toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, error: 'forbidden_scheme', detail: scheme.slice(0, 24) }
  } else {
    const colon = s.indexOf(':')
    if (colon > 0) {
      const scheme = s.slice(0, colon)
      const after = s.slice(colon + 1)
      const isPort = /^\d/.test(after)
      if (/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme) && !isPort) {
        const lower = scheme.toLowerCase()
        if (lower !== 'http' && lower !== 'https') return { ok: false, error: 'forbidden_scheme', detail: lower.slice(0, 24) }
        candidate = `${lower}://${after.replace(/^\/+/, '')}`
      } else {
        candidate = 'https://' + s
      }
    } else {
      candidate = 'https://' + s
    }
  }
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return { ok: false, error: 'invalid_url', detail: s.slice(0, 200) }
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return { ok: false, error: 'invalid_url', detail: s.slice(0, 200) }
  if (u.username || u.password) return { ok: false, error: 'credentials_in_url', detail: u.hostname }
  return { ok: true, url: u.toString() }
}

/** ¿Es un destino de bucle local (127.0.0.1, ::1, localhost)? */
export function isLoopbackURL(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === 'localhost' || h.endsWith('.localhost')
  } catch {
    return false
  }
}

/** Patrón de sitio: «https://x.edu» (origen exacto), «x.edu» (host), «*.x.edu» (dominio y subdominios), «x:8080» o «*». */
export function sitePatternMatches(pattern: string, url: string): boolean {
  const p = pattern.trim().toLowerCase()
  if (!p) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const scheme = u.protocol.replace(':', '')
  if (scheme !== 'http' && scheme !== 'https') return false
  if (p === '*') return true
  let rest = p
  let wantScheme: string | null = null
  const sep = p.indexOf('://')
  if (sep >= 0) {
    wantScheme = p.slice(0, sep)
    if (wantScheme !== 'http' && wantScheme !== 'https') return false
    rest = p.slice(sep + 3)
  }
  const slash = rest.indexOf('/')
  if (slash >= 0) rest = rest.slice(0, slash)
  let hostPart = rest
  let port: number | null = null
  const colon = rest.lastIndexOf(':')
  if (colon >= 0 && !rest.startsWith('[')) {
    port = Number(rest.slice(colon + 1))
    if (!Number.isInteger(port)) return false
    hostPart = rest.slice(0, colon)
  }
  let wildcard = false
  if (hostPart.startsWith('*.')) {
    wildcard = true
    hostPart = hostPart.slice(2)
  }
  if (!hostPart || hostPart.includes('*')) return false
  if (wantScheme && wantScheme !== scheme) return false
  if (wantScheme && port == null && !wildcard) port = wantScheme === 'https' ? 443 : 80
  if (port != null) {
    const actual = u.port ? Number(u.port) : scheme === 'https' ? 443 : 80
    if (actual !== port) return false
  }
  const h = u.hostname.toLowerCase()
  return wildcard ? h === hostPart || h.endsWith('.' + hostPart) : h === hostPart
}
