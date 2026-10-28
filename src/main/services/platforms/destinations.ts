// ¿A dónde puede conectarse el navegador de Aula (pestañas de lectura de la IA, ventana de inicio de sesión, descargas)?
// Nunca a este ordenador ni a la red local: 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16 (metadatos de la nube),
// ::1, fc00::/7, fe80::/10, «localhost», *.local, *.internal, nombres de una sola palabra («router»)… El nombre se resuelve
// ANTES de conectar (y en cada redirección, porque cada salto vuelve a pasar por aquí), y si alguna de sus direcciones es
// privada, se corta. Así una página o un PDF con instrucciones no puede llevar a la IA al router, a Ollama ni a los
// metadatos de la nube (J3-3).
//
// Única excepción: la cuenta de una plataforma que el propio estudiante configuró EN su red local (un Moodle de la
// intranet del centro): esa sesión sí llega a la red local (es donde vive su plataforma y su inicio de sesión).
import { verdictForHost, type Resolver } from '../ingest/extract/web'
import { hostOf } from '@engine/platforms'

export interface DestinationGuardOptions {
  resolver: Resolver
  /** Cuánto se recuerda el veredicto de cada nombre (por defecto, 60 s). */
  ttlMs?: number
  now?: () => number
}

export interface DestinationGuard {
  /** null = se puede conectar; si no, por qué no. `allowPrivate` = la sesión de una plataforma de la red local. */
  check(url: string, allowPrivate: boolean): Promise<string | null>
}

export function createDestinationGuard(opts: DestinationGuardOptions): DestinationGuard {
  const ttl = opts.ttlMs ?? 60_000
  const now = opts.now ?? Date.now
  const cache = new Map<string, { reason: string | null; at: number }>()
  return {
    async check(url, allowPrivate) {
      let u: URL
      try {
        u = new URL(url)
      } catch {
        return 'invalid address'
      }
      // solo las direcciones de red; data:, blob: y las internas de Chromium no salen del equipo
      if (!/^(https?|wss?):$/.test(u.protocol)) return null
      if (allowPrivate) return null
      const host = u.hostname.toLowerCase()
      const hit = cache.get(host)
      if (hit && now() - hit.at < ttl) return hit.reason
      const v = await verdictForHost(host, opts.resolver)
      const reason = v.allowed ? null : v.reason
      if (cache.size > 2000) cache.clear()
      cache.set(host, { reason, at: now() })
      return reason
    }
  }
}

/** ¿La plataforma de esta cuenta está en la red local (su dirección es local o privada)? Entonces su sesión puede llegar. */
export async function accountIsOnLocalNetwork(baseURL: string, resolver: Resolver): Promise<boolean> {
  const host = hostOf(baseURL)
  if (!host) return false
  const v = await verdictForHost(host, resolver)
  return !v.allowed
}

/** Segundos niveles de los dominios de país («uni.edu.ar», «uni.ac.uk»). */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'gob', 'gouv', 'ac', 'mil', 'nom', 'sch', 'or', 'ne', 'go', 'ed'])

/** El «sitio» de un nombre: sus dos últimas partes («moodle.uni.local» → «uni.local»), o tres con un segundo nivel de país
 * («campus.uni.edu.ar» → «uni.edu.ar»). Un nombre de una sola palabra es su propio sitio. */
function siteOf(host: string): string {
  const parts = host.toLowerCase().replace(/\.+$/, '').split('.').filter(Boolean)
  // «*.localhost» (pruebas y desarrollo): todo es el mismo sitio, como si «localhost» fuera el dominio
  if (parts[parts.length - 1] === 'localhost') return 'localhost'
  if (parts.length <= 2) return parts.join('.')
  const take = SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2
  return parts.slice(-take).join('.')
}

const isIPLiteral = (host: string): boolean => /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')

/**
 * Con una plataforma de la red local, ¿puede esta dirección usar la red local? Solo los servidores de la propia plataforma
 * (su nombre o los de su mismo sitio: su CAS o su SSO de la intranet), nunca el resto de la red (A2-P2-10: antes la sesión
 * entera llegaba al router, a 127.0.0.1:11434…).
 */
export function privateAllowedFor(baseURL: string, url: string): boolean {
  const base = hostOf(baseURL)?.toLowerCase()
  const host = hostOf(url)?.toLowerCase()
  if (!base || !host) return false
  if (host === base) return true
  if (isIPLiteral(base) || isIPLiteral(host)) return false
  return siteOf(host) === siteOf(base)
}

