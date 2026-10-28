// Índice de todo lo que se puede mencionar en el chat (port de AssistantCatalog.swift): cursos, lecciones, ejercicios,
// materiales y eventos. Lo usan el selector de «@» de la interfaz y la herramienta `find_items` de la IA.
import type { AssistantRef, AssistantRefKind } from '@shared/assistant/types'
import { orderedSkills, type Pack, type Skill } from '@shared/schema/pack'
import { aiLocale, tr } from '@shared/ai/i18n'
import { foldPlain } from './fold'
import { oneLine, readable, textOfBlocks } from './text'

export interface CatalogEntry {
  ref: AssistantRef
  /** Título y texto de búsqueda ya normalizados (sin acentos ni mayúsculas). */
  title: string
  text: string
}

/** Un curso para el índice: el curso y (si se quieren los ejercicios) sus lecciones completas. */
export interface CatalogCourse {
  pack: Pack
  skills?: ReadonlyMap<string, Skill> | Readonly<Record<string, Skill>>
}

/** Un evento del calendario tal como lo necesita el índice. */
export interface CatalogEvent {
  id: string
  title: string
  start: Date
  allDay: boolean
  kind: string
  notes?: string
  courseID?: string
}

function skillOf(c: CatalogCourse, id: string): Skill | undefined {
  const s = c.skills
  if (!s) return undefined
  return s instanceof Map ? s.get(id) : (s as Readonly<Record<string, Skill>>)[id]
}

/** Fecha corta para un subtítulo («lunes 19 oct, 9:00»). */
export function shortWhen(d: Date, allDay: boolean): string {
  const locale = aiLocale() === 'en' ? 'en' : 'es'
  try {
    return new Intl.DateTimeFormat(locale, allDay ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

export function buildCatalog(courses: readonly CatalogCourse[], events: readonly CatalogEvent[] = [], opts: { exercises?: boolean } = {}): AssistantCatalog {
  const out: CatalogEntry[] = []
  const withExercises = opts.exercises ?? true
  for (const c of courses) {
    const pack = c.pack
    const courseLine = [pack.title, pack.subject, pack.courseCode ?? '', pack.exam?.title ?? ''].filter((x) => x).join(' ')
    const sub: string[] = []
    if (pack.subject) sub.push(pack.subject)
    sub.push(tr(`${pack.skills.length} lecciones`, `${pack.skills.length} lessons`))
    const courseRef: AssistantRef = { kind: 'course', courseID: pack.id, title: pack.title, subtitle: sub.join(' · '), icon: pack.icon, hue: pack.hue }
    if (pack.exam?.date) courseRef.date = pack.exam.date
    out.push({ ref: courseRef, title: foldPlain(pack.title), text: foldPlain(courseLine) })
    orderedSkills(pack).forEach((s, i) => {
      out.push({
        ref: { kind: 'lesson', courseID: pack.id, itemID: s.id, title: s.title, subtitle: tr(`${pack.title} · Lección ${i + 1}`, `${pack.title} · Lesson ${i + 1}`), icon: pack.icon, hue: pack.hue },
        title: foldPlain(s.title), text: foldPlain([s.title, s.summary ?? '', s.objectives.join(' ')].join(' '))
      })
      const skill = withExercises ? skillOf(c, s.id) : undefined
      skill?.exercises.forEach((e, k) => {
        const prompt = textOfBlocks(e.prompt)
        if (!prompt) return
        const title = oneLine(readable(prompt), 90)
        out.push({
          ref: { kind: 'exercise', courseID: pack.id, itemID: e.id, skillID: s.id, title, subtitle: tr(`${s.title} · Ejercicio ${k + 1}`, `${s.title} · Exercise ${k + 1}`), icon: pack.icon, hue: pack.hue },
          title: foldPlain(title), text: foldPlain(prompt + ' ' + s.title)
        })
      })
    })
    for (const m of pack.sources) {
      out.push({
        ref: { kind: 'material', courseID: pack.id, itemID: m.id, title: m.title, subtitle: tr(`${pack.title} · Material`, `${pack.title} · Material`), icon: pack.icon, hue: pack.hue },
        title: foldPlain(m.title), text: foldPlain(m.title + ' ' + (m.note ?? ''))
      })
    }
  }
  for (const e of events) {
    const ref: AssistantRef = { kind: 'event', itemID: e.id, title: e.title, subtitle: shortWhen(e.start, e.allDay), date: e.start.toISOString() }
    if (e.courseID) ref.courseID = e.courseID
    out.push({ ref, title: foldPlain(e.title), text: foldPlain(e.title + ' ' + (e.notes ?? '') + ' ' + e.kind) })
  }
  return new AssistantCatalog(out)
}

function kindBonus(k: AssistantRefKind): number {
  switch (k) {
    case 'course': return 0.6
    case 'lesson': return 0.45
    case 'event': return 0.4
    case 'material': return 0.3
    case 'exercise': return 0
  }
}

const ORDER: AssistantRefKind[] = ['course', 'event', 'lesson', 'material', 'exercise']

export class AssistantCatalog {
  constructor(readonly entries: CatalogEntry[] = []) {}

  /** Busca. Sin texto devuelve lo más útil para empezar (cursos y sus primeras lecciones). */
  search(query: string, opts: { kinds?: ReadonlySet<AssistantRefKind>; courseID?: string; limit?: number } = {}): AssistantRef[] {
    const limit = opts.limit ?? 12
    const pool = this.entries.filter((e) => (!opts.kinds || opts.kinds.has(e.ref.kind)) && (!opts.courseID || e.ref.courseID === opts.courseID))
    const q = foldPlain(query).trim()
    if (!q) {
      return pool.map((e, i) => ({ e, i })).sort((a, b) => (ORDER.indexOf(a.e.ref.kind) - ORDER.indexOf(b.e.ref.kind)) || a.i - b.i).slice(0, limit).map((x) => x.e.ref)
    }
    const tokens = q.split(/[^\p{L}\p{N}]+/u).filter((t) => t)
    if (!tokens.length) return []
    const scored: Array<{ score: number; i: number; e: CatalogEntry }> = []
    pool.forEach((e, i) => {
      let score = 0, matched = 0
      for (const t of tokens) {
        if (e.title.startsWith(t)) { score += 4; matched++ }
        else if (e.title.includes(t)) { score += e.title.includes(' ' + t) ? 3 : 2; matched++ }
        else if (e.text.includes(t)) { score += 1; matched++ }
        else if (Array.from(t).length >= 5 && e.text.includes(t.slice(0, -1))) { score += 0.5; matched++ } // plurales y erratas al final
      }
      if (!matched) return
      // todas las palabras cuentan mucho más que algunas; el título exacto, más aún
      score *= matched / tokens.length
      if (matched === tokens.length) score += 2
      if (e.title === q) score += 6
      score += kindBonus(e.ref.kind)
      scored.push({ score, i, e })
    })
    return scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.i - b.i)).slice(0, limit).map((x) => x.e.ref)
  }
}
