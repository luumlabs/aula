// Detección de novedades (AutomationNovelty.swift). La IA informa de lo que encuentra con una clave estable por cosa
// (idealmente la dirección o el id de la plataforma) y aquí se compara con lo ya visto para avisar SOLO de lo nuevo:
//   · misma identidad (dirección normalizada, o clave/título normalizados) → ya se conocía;
//   · si no, mismo tipo y título casi igual (Jaccard de palabras ≥ 0,8, al menos 2 palabras) → ya se conocía;
//   · ya se conocía pero cambió la fecha de entrega → «cambió»;
//   · lo demás → nuevo. En la primera revisión lo que había se aprende sin avisar, salvo lo que la IA marca como reciente.
import { foldDiacritics } from '@engine/base/ids'
import type { AutomationFinding, AutomationSeenItem, ISODate } from './types'

export interface NoveltyResult {
  new: AutomationFinding[]
  changed: AutomationFinding[]
  known: AutomationFinding[]
  /** Lo visto actualizado (para guardar). */
  seen: AutomationSeenItem[]
}

/** Cuántas cosas vistas se recuerdan como mucho por automatización. */
export const NOVELTY_MEMORY = 400

const ms = (v: ISODate | undefined): number | undefined => {
  if (!v) return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

export function compareFindings(found: readonly AutomationFinding[], seenIn: readonly AutomationSeenItem[], baseline: boolean, now: Date = new Date()): NoveltyResult {
  const seen = seenIn.map((s) => ({ ...s }))
  const out: NoveltyResult = { new: [], changed: [], known: [], seen }
  const stamp = now.toISOString()
  const thisRun = new Set<string>()
  for (const f of found) {
    if (!f.title.trim() && !f.key) continue
    const id = findingIdentity(f)
    if (thisRun.has(id)) continue // la IA lo repitió en la misma revisión
    thisRun.add(id)
    const i = matchSeen(f, id, seen)
    if (i !== undefined) {
      const s = seen[i]
      const a = ms(s.due), b = ms(f.due)
      if (a !== undefined && b !== undefined && Math.abs(a - b) > 60_000) out.changed.push(f)
      else out.known.push(f)
      s.lastSeen = stamp
      if (f.due) s.due = f.due
      if (f.title) s.title = f.title
    } else {
      // primera revisión: solo cuenta como nuevo lo que la IA ve reciente
      if (baseline && !f.fresh) out.known.push(f)
      else out.new.push(f)
      seen.push({ identity: id, title: f.title, kind: f.kind, ...(f.due ? { due: f.due } : {}), firstSeen: stamp, lastSeen: stamp })
    }
  }
  if (seen.length > NOVELTY_MEMORY) {
    out.seen = [...seen].sort((x, y) => (ms(y.lastSeen) ?? 0) - (ms(x.lastSeen) ?? 0)).slice(0, NOVELTY_MEMORY)
  }
  return out
}

/** Índice de lo visto que es la misma cosa. */
function matchSeen(f: AutomationFinding, id: string, seen: readonly AutomationSeenItem[]): number | undefined {
  const direct = seen.findIndex((s) => s.identity === id)
  if (direct >= 0) return direct
  // dos cosas con dirección propia y distinta son distintas aunque se llamen igual («Anuncio semanal»)
  const byURL = id.startsWith('u:')
  const candidates = seen.map((_, i) => i).filter((i) => !(byURL && seen[i].identity.startsWith('u:')) && compatibleKinds(seen[i].kind, f.kind))
  const titleID = foldText(f.title)
  if (titleID) {
    const same = candidates.find((i) => foldText(seen[i].title) === titleID)
    if (same !== undefined) return same
  }
  const words = titleTokens(f.title)
  if (words.size < 2) return undefined
  let best: [number, number] | undefined
  for (const i of candidates) {
    const j = jaccard(words, titleTokens(seen[i].title))
    if (j >= 0.8 && j > (best?.[1] ?? 0)) best = [i, j]
  }
  return best?.[0]
}

function compatibleKinds(a: string, b: string): boolean {
  return a === b || a === 'other' || b === 'other'
}

/** Identidad estable: la dirección sin esquema ni adornos (conservando los ids de la consulta), o la clave, o el título. */
export function findingIdentity(f: AutomationFinding): string {
  const u = (f.url ? normalizedURL(f.url) : null) ?? normalizedURL(f.key)
  if (u) return 'u:' + u
  const k = foldText(f.key)
  if (k) return `k:${f.kind}:${k}`
  return 't:' + foldText(f.title)
}

const KEEP_QUERY = new Set(['id', 'cmid', 'a', 'd', 'assignment', 'discussion', 'ou', 'itemid', 'courseid', 'f', 'q'])

/** «https://x.instructure.com/courses/1/assignments/55?module_item_id=9#a» → «x.instructure.com/courses/1/assignments/55». */
export function normalizedURL(raw: string): string | null {
  const s = raw.trim()
  if (!s.includes('/') || /\s/.test(s)) return null
  let u: URL
  try {
    u = new URL(/^https?:/i.test(s) ? s : 'https://' + s)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') && host !== 'localhost') return null
  let path = u.pathname
  try { path = decodeURIComponent(path) } catch { /* tal cual */ }
  path = path.replace(/\/+$/, '')
  const q = [...u.searchParams.entries()]
    .filter(([k]) => KEEP_QUERY.has(k.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
  const port = u.port ? ':' + u.port : ''
  return host + port + path.toLowerCase() + (q.length ? '?' + q.join('&') : '')
}

/** Minúsculas, sin acentos, solo letras y números separados por un espacio. */
export function foldText(s: string): string {
  const f = foldDiacritics(s.normalize('NFKC')).toLowerCase()
  let out = ''
  let space = false
  for (const ch of f) {
    if (/[\p{L}\p{N}]/u.test(ch)) { out += ch; space = false }
    else if (!space && out) { out += ' '; space = true }
  }
  return out.trim()
}

const STOPWORDS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'y', 'en', 'a', 'un', 'una', 'the', 'of', 'and', 'to', 'for', 'in', 'on', 'con', 'por', 'para'])

export function titleTokens(s: string): Set<string> {
  return new Set(foldText(s).split(' ').filter((w) => w && !STOPWORDS.has(w)))
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
