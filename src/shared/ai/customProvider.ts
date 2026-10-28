// Proveedor personalizado (compatible con OpenAI): la URL base que escribe la persona. La misma regla en la interfaz (para
// avisar donde se escribe) y en el proceso principal (que no da nada por bueno): https, o http solo para este ordenador.
import { defaultScheme } from './urlScheme'

/** Id del preset «Personalizado (compatible con OpenAI)». */
export const CUSTOM_PROVIDER_ID = 'custom'

export type CustomURLProblem = 'empty' | 'invalid' | 'insecure'

/** ¿Es el preset personalizado o uno de los `custom-…`? */
export function isCustomProviderID(id: string): boolean {
  return id === CUSTOM_PROVIDER_ID || /^custom-[A-Za-z0-9_-]{1,40}$/.test(id)
}

/** ¿El host es este mismo ordenador? (localhost, *.localhost, 127.0.0.0/8, ::1). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
  const octets = h.split('.')
  return octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255) && octets[0] === '127'
}

/**
 * Comprueba la URL base de un servicio personalizado. Sin esquema se supone https (http si es localhost). Devuelve la URL
 * limpia (sin espacios ni barras finales) o el problema: vacía, no válida (o con usuario y contraseña) o http fuera de este
 * ordenador.
 */
export function checkCustomBaseURL(raw: string): { ok: true; url: string } | { ok: false; problem: CustomURLProblem } {
  let s = raw.trim()
  if (!s) return { ok: false, problem: 'empty' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `${defaultScheme(s)}://${s}`
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return { ok: false, problem: 'invalid' }
  }
  const scheme = url.protocol.toLowerCase()
  if ((scheme !== 'http:' && scheme !== 'https:') || !url.hostname || url.username || url.password || /\s/.test(s)) return { ok: false, problem: 'invalid' }
  if (scheme === 'http:' && !isLoopbackHost(url.hostname)) return { ok: false, problem: 'insecure' }
  let path = url.pathname
  while (path.endsWith('/')) path = path.slice(0, -1)
  return { ok: true, url: `${url.protocol}//${url.host}${path}${url.search}` }
}
