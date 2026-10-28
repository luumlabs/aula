// El detalle de un paso que ve el estudiante («Buscando en tus materiales · “regla de la cadena”», «Preparando las tarjetas · 5»):
// lo que buscó, el título de lo que crea, la web que lee o la expresión que calcula, sacado de los argumentos de la herramienta.
// Nunca ids ni JSON: si no hay nada legible, no hay detalle.
import { redactSecrets } from '@engine/assistant'
import type { AssistantStep } from '@shared/assistant/types'

const MAX = 80

/** Claves legibles por orden de preferencia (las mismas que leen las herramientas con sus nombres alternativos). */
const TEXT_KEYS = ['query', 'q', 'search', 'topic', 'title', 'name', 'expression', 'expr', 'equation', 'function', 'formula', 'question', 'text'] as const
/** Listas cuyo tamaño es lo que se crea (tarjetas, preguntas, lecciones). */
const COUNT_KEYS = ['cards', 'flashcards', 'exercises', 'questions', 'items', 'lessons', 'events'] as const

function short(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  const chars = Array.from(one)
  return chars.length > MAX ? chars.slice(0, MAX - 1).join('').trimEnd() + '…' : one
}

/** «https://es.wikipedia.org/wiki/Parábola?x=1» → «es.wikipedia.org/wiki/Parábola». */
export function shortURL(raw: string): string | undefined {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '')
    return short(u.host.replace(/^www\./, '') + path)
  } catch {
    return undefined
  }
}

const looksLikeId = (s: string): boolean => /^[a-z0-9]+([-_][a-z0-9]+)*$/i.test(s) && !/\s/.test(s) && /\d/.test(s)

/** El detalle y la cuenta de un paso según los argumentos con los que se llamó a la herramienta. */
export function stepDetail(args: unknown): Pick<AssistantStep, 'detail' | 'count'> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {}
  const a = args as Record<string, unknown>
  const out: Pick<AssistantStep, 'detail' | 'count'> = {}
  const url = typeof a.url === 'string' ? shortURL(a.url) : undefined
  if (url) out.detail = url
  else {
    for (const k of TEXT_KEYS) {
      const v = a[k]
      if (typeof v !== 'string' || !v.trim() || looksLikeId(v.trim())) continue
      const text = redactSecrets(v).text
      out.detail = short(text)
      break
    }
  }
  for (const k of COUNT_KEYS) {
    const v = a[k]
    if (Array.isArray(v) && v.length) {
      out.count = v.length
      break
    }
  }
  return out
}
