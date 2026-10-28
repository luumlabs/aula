// «¿Qué plataforma es esta dirección?» sin sesión (port de StudyPlatformProbe.swift): las piezas puras. La petición (sin
// cookies, apuntando cada redirección) la hace src/main/services/platforms/probe.ts.
import { detectPlatform, type PlatformDetection } from './detector'
import { isIdentityHost } from './login'
import { hostOf } from './model'

const RANK = { low: 1, medium: 2, high: 3 } as const

/** La mejor detección entre los saltos (sin los del inicio de sesión único) y el HTML final. */
export function detectFromHops(hops: string[], html: string | null, title: string | null): PlatformDetection | null {
  let best: PlatformDetection | null = null
  hops.forEach((hop, i) => {
    if (isIdentityHost(hostOf(hop) ?? '')) return
    const isLast = i === hops.length - 1
    const d = detectPlatform({ url: hop, html: isLast ? html : null, title: isLast ? title : null })
    if (d && (!best || RANK[d.confidence] > RANK[best.confidence])) best = d
  })
  // si el último salto es el del SSO, el HTML es el del proveedor de identidad: no dice nada de la plataforma
  const last = hops[hops.length - 1]
  if (!best && last && !isIdentityHost(hostOf(last) ?? '') && html) best = detectPlatform({ html, title })
  return best
}

const ENTITIES: [string, string][] = [['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&#039;', "'"],
  ['&nbsp;', ' '], ['&ndash;', '–'], ['&mdash;', '—']]

function decodeBasicEntities(s: string): string {
  let out = s
  for (const [e, c] of ENTITIES) out = out.split(e).join(c)
  return out.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Math.min(0x10ffff, Number(d)) || 0xfffd))
}

/** Título de la página (para proponer un nombre), ≤ 160 caracteres. */
export function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return null
  const t = decodeBasicEntities(m[1]).replace(/\s+/g, ' ').trim()
  return t ? [...t].slice(0, 160).join('') : null
}

/** Iconos que declara la página (`apple-touch-icon` primero) y, al final, `/favicon.ico` de su sitio (máx. 4). */
export function iconLinks(html: string, base: string): string[] {
  const found: [number, string][] = []
  const re = /<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[0]
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    if (!rel.includes('icon')) continue
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const raw = href?.[1] ?? href?.[2] ?? href?.[3]
    if (!raw) continue
    try {
      const u = new URL(decodeBasicEntities(raw), base)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
      found.push([rel.includes('apple-touch') ? 0 : u.pathname.toLowerCase().endsWith('.svg') ? 2 : 1, u.toString()])
    } catch { /* sigue */ }
  }
  const out = found.sort((a, b) => a[0] - b[0]).map(([, u]) => u)
  try {
    const fav = new URL('/favicon.ico', base).toString()
    if (!out.includes(fav)) out.push(fav)
  } catch { /* nada */ }
  return [...new Set(out)].slice(0, 4)
}
