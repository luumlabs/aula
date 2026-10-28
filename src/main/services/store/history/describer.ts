// Lo que cambió un archivo, en frases cortas para la lista «Cambios de Aula» (port de StudyModel/History/ChangeDescriber.swift).
// Lee el JSON de forma tolerante: si un archivo no se entiende, dice solo que cambió. En el idioma de la interfaz (`tr`).
import { basename } from 'node:path'
import { isJSONObject, parseJSON } from '@engine/base/json'
import { tr } from '@shared/ai/i18n'
import type { ChangeDomain, ChangeLine } from '@shared/schema/history'
import { same } from './jsonMerge'

type V = unknown
const get = (v: V, k: string): V => (isJSONObject(v) ? v[k] : undefined)
const text = (v: V): string | undefined => (typeof v === 'string' ? v : undefined)
const arr = (v: V): V[] => (Array.isArray(v) ? v : [])

function parse(data: Buffer | null): V {
  if (!data) return undefined
  try {
    return parseJSON(data.toString('utf8'))
  } catch {
    return undefined
  }
}

function byID(v: V): Map<string, V> {
  const out = new Map<string, V>()
  for (const e of arr(v)) { const id = text(get(e, 'id')); if (id !== undefined) out.set(id, e) }
  return out
}

function diff(b: V, a: V): { added: number; removed: number; changed: number } {
  const B = byID(b), A = byID(a)
  const d = { added: 0, removed: 0, changed: 0 }
  for (const [id, v] of A) { const old = B.get(id); if (old !== undefined) { if (!same(old, v)) d.changed++ } else d.added++ }
  d.removed = [...B.keys()].filter((k) => !A.has(k)).length
  return d
}

function keyed(b: V, a: V, title: (e: V) => string, added: (t: string) => string, removed: (t: string) => string, changed?: (t: string) => string): string[] {
  const B = byID(b), A = byID(a)
  const out: string[] = []
  for (const e of arr(a)) {
    const id = text(get(e, 'id'))
    if (id === undefined) continue
    const old = B.get(id)
    if (old !== undefined) { if (changed && !same(old, e)) out.push(changed(title(e))) } else out.push(added(title(e)))
  }
  for (const e of arr(b)) { const id = text(get(e, 'id')); if (id !== undefined && !A.has(id)) out.push(removed(title(e))) }
  return out.slice(0, 12)
}

function pack(b: V, a: V): string[] {
  const out: string[] = []
  const bt = text(get(b, 'title')), at = text(get(a, 'title'))
  if (bt !== undefined && at !== undefined && bt !== at) out.push(tr(`Título del curso: «${bt}» → «${at}»`, `Course title: “${bt}” → “${at}”`))
  out.push(...keyed(get(b, 'skills'), get(a, 'skills'), (e) => text(get(e, 'title')) ?? text(get(e, 'id')) ?? '',
    (t) => tr(`Lección nueva en el plan: «${t}»`, `New lesson in the plan: “${t}”`), (t) => tr(`Lección quitada del plan: «${t}»`, `Lesson removed from the plan: “${t}”`)))
  if (!same(get(b, 'exam') ?? null, get(a, 'exam') ?? null)) out.push(tr('Datos del examen cambiados', 'Exam details changed'))
  const gb = arr(get(b, 'glossary')).length, ga = arr(get(a, 'glossary')).length
  if (gb !== ga) out.push(tr(`Glosario: ${gb} → ${ga} términos`, `Glossary: ${gb} → ${ga} terms`))
  if (!out.length && b !== undefined && a !== undefined && !same(b, a)) out.push(tr('Datos del curso cambiados', 'Course details changed'))
  return out
}

const NOUNS = (): Array<[string, { added: string; removed: string; changed: string }]> => [
  ['exercises', { added: tr('ejercicios nuevos', 'new exercises'), removed: tr('ejercicios quitados', 'exercises removed'), changed: tr('ejercicios cambiados', 'exercises changed') }],
  ['templates', { added: tr('plantillas nuevas', 'new templates'), removed: tr('plantillas quitadas', 'templates removed'), changed: tr('plantillas cambiadas', 'templates changed') }],
  ['cards', { added: tr('tarjetas nuevas', 'new flashcards'), removed: tr('tarjetas quitadas', 'flashcards removed'), changed: tr('tarjetas cambiadas', 'flashcards changed') }]
]

function skill(b: V, a: V, created: boolean, deleted: boolean): string[] {
  const title = text(get(a, 'title')) ?? text(get(b, 'title')) ?? ''
  if (created) return [tr(`Lección nueva: «${title}»`, `New lesson: “${title}”`)]
  if (deleted) return [tr(`Lección borrada: «${title}»`, `Lesson deleted: “${title}”`)]
  const parts: string[] = []
  if (!same(get(b, 'lesson') ?? null, get(a, 'lesson') ?? null)) parts.push(tr('texto de la lección cambiado', 'lesson text changed'))
  for (const [key, w] of NOUNS()) {
    const d = diff(get(b, key), get(a, key))
    if (d.added > 0) parts.push(`${d.added} ${w.added}`)
    if (d.removed > 0) parts.push(`${d.removed} ${w.removed}`)
    if (d.changed > 0) parts.push(`${d.changed} ${w.changed}`)
  }
  if (!parts.length) return [tr(`Lección «${title}» cambiada`, `Lesson “${title}” changed`)]
  return [tr(`Lección «${title}»: ${parts.join(', ')}`, `Lesson “${title}”: ${parts.join(', ')}`)]
}

/** Frases de lo que cambió `path` entre `before` y `after` (null = no existía / se borró). */
export function describeChange(path: string, domain: ChangeDomain, before: Buffer | null, after: Buffer | null): ChangeLine[] {
  const b = parse(before), a = parse(after)
  let out: string[] = []
  if (path.endsWith('/pack.json') || path === 'pack.json') out = pack(b, a)
  else if (path.includes('/skills/')) out = skill(b, a, before === null, after === null)
  else if (domain === 'calendar') {
    out = keyed(get(b, 'events'), get(a, 'events'), (e) => text(get(e, 'title')) ?? '',
      (t) => tr(`Evento nuevo: «${t}»`, `New event: “${t}”`), (t) => tr(`Evento quitado: «${t}»`, `Event removed: “${t}”`), (t) => tr(`Evento cambiado: «${t}»`, `Event changed: “${t}”`))
  } else if (domain === 'memory') {
    out = keyed(get(b, 'records'), get(a, 'records'), (e) => Array.from(text(get(e, 'text')) ?? '').slice(0, 80).join(''),
      (t) => tr(`Aula recordó: «${t}»`, `Aula remembered: “${t}”`), (t) => tr(`Aula olvidó: «${t}»`, `Aula forgot: “${t}”`), (t) => tr(`Recuerdo cambiado: «${t}»`, `Memory changed: “${t}”`))
  }
  if (!out.length) out = [tr(`Cambió «${basename(path)}»`, `Changed “${basename(path)}”`)]
  return out.map((t) => ({ path, text: t }))
}
