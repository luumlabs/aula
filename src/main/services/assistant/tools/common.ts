// Utilidades de las herramientas del chat (port de las de AssistantTools.swift): encontrar un curso (por id o por título, que la
// IA a veces manda), pedir permiso con una tarjeta, completar referencias y fechas legibles.
import { foldPlain } from '@engine/assistant'
import { IDs } from '@engine/base/ids'
import { aiLocale, tr } from '@shared/ai/i18n'
import type { JSONObject } from '@shared/ai/json'
import type { AssistantFact, AssistantRef } from '@shared/assistant/types'
import type { Pack, Skill } from '@shared/schema'
import type { ToolOutput } from '../../ai/model'
import type { PackStore } from '../../store/packStore'
import { isApproval } from '../broker'
import type { ToolEnv } from '../host'
import { newCard } from '../models'
import { outError, outJSON, type ToolArgs } from '../toolkit'

export interface OpenCourse { store: PackStore; pack: Pack }

/** El curso por id o, si la IA mandó el título, por título. */
export function findCourse(env: ToolEnv, id: string | undefined): OpenCourse | undefined {
  if (!id) return undefined
  const store = env.library.openPack(id)
  if (store) {
    try { return { store, pack: store.loadPack() } } catch { /* sigue por título */ }
  }
  const f = foldPlain(id).trim()
  for (const sum of env.library.listPacks()) {
    if (foldPlain(sum.title).trim() === f || IDs.slug(sum.title) === IDs.slug(id)) {
      const s = env.library.openPack(sum.id)
      if (s) {
        try { return { store: s, pack: s.loadPack() } } catch { /* siguiente */ }
      }
    }
  }
  return undefined
}

/** El curso de los argumentos o, en el tutor, el suyo. */
export function courseArg(env: ToolEnv, a: ToolArgs, alt: string[] = []): string | undefined {
  return a.string('course_id', alt) ?? env.defaultCourseID
}

export function unknownCourse(env: ToolEnv, id: string | undefined): ToolOutput {
  const ids = env.library.listPacks().map((p) => `${p.id} («${p.title}»)`).join(', ')
  return outError(`Unknown course '${id ?? ''}'. Courses: ${ids || 'none yet'}. Use list_courses or find_items.`)
}

export function pct(v: number | undefined): number | null {
  return v === undefined ? null : Math.round(v * 100)
}

/** «lunes, 19 de octubre, 9:00» (o sin hora si es de todo el día). */
export function when(d: Date, allDay = false): string {
  const locale = aiLocale() === 'en' ? 'en' : 'es'
  const opts: Intl.DateTimeFormatOptions = allDay ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }
  try {
    return new Intl.DateTimeFormat(locale, opts).format(d)
  } catch {
    return d.toISOString()
  }
}

export const fact = (label: string, value: string): AssistantFact => ({ label, value })

/** Pide permiso con una tarjeta. undefined si se aprobó; si no, la respuesta para la IA. */
export async function approval(env: ToolEnv, title: string, facts: AssistantFact[], action: string, icon: string, detail?: string): Promise<ToolOutput | undefined> {
  const card = newCard('approval', title, { facts, actionLabel: action, icon, ...(detail ? { detail } : {}) })
  const answer = await env.io.ask(card)
  if (isApproval(answer)) return undefined
  if (answer.kind === 'typed') {
    return outJSON({ ok: false, approved: false, student_wrote: answer.text, note: 'The student answered in writing instead of approving. Read what they wrote and act on it (adjust and propose again, or drop it).' })
  }
  if (answer.kind === 'expired') return outJSON({ ok: false, approved: false, note: 'No answer from the student. Do not retry now; end your turn telling them it is waiting for their OK.' })
  return outJSON({ ok: false, approved: false, note: "The student said no. Ask briefly what they would like instead (don't insist)." })
}

/** Busca una lección en un curso, o en todos si no se dice cuál (en el tutor, primero su curso). Por id o por título. */
export function findSkill(env: ToolEnv, courseID: string | undefined, skillID: string): { store: PackStore; pack: Pack; skill: Skill } | undefined {
  let candidates: OpenCourse[]
  if (courseID) {
    const c = findCourse(env, courseID)
    candidates = c ? [c] : []
  } else {
    candidates = env.library.packIDs().flatMap((id) => {
      const s = env.library.openPack(id)
      if (!s) return []
      try { return [{ store: s, pack: s.loadPack() }] } catch { return [] }
    })
    const d = env.defaultCourseID
    const i = d ? candidates.findIndex((c) => c.pack.id === d) : -1
    if (i > 0) candidates.unshift(...candidates.splice(i, 1))
  }
  const f = foldPlain(skillID).trim()
  for (const { store, pack } of candidates) {
    const ref = pack.skills.find((s) => s.id === skillID) ?? pack.skills.find((s) => foldPlain(s.title).trim() === f)
    if (!ref || !store.hasSkill(ref.id)) continue
    try { return { store, pack, skill: store.loadSkill(ref.id) } } catch { /* siguiente */ }
  }
  return undefined
}

/** Completa icono, tono y subtítulo de una referencia con lo que hay en disco. */
export function enrichRef(env: ToolEnv, r: AssistantRef): AssistantRef {
  const out = { ...r }
  if (!out.courseID) return out
  const c = findCourse(env, out.courseID)
  if (!c) return out
  const p = c.pack
  out.courseID = p.id
  out.icon = out.icon ?? p.icon
  out.hue = out.hue ?? p.hue
  switch (out.kind) {
    case 'course':
      if (!out.title) out.title = p.title
      if (out.subtitle === undefined && p.subject) out.subtitle = p.subject
      if (!out.date && p.exam?.date) out.date = p.exam.date
      break
    case 'lesson': {
      const s = out.itemID ? p.skills.find((x) => x.id === out.itemID) : undefined
      if (s) {
        if (!out.title) out.title = s.title
        if (out.subtitle === undefined) out.subtitle = p.title
      }
      break
    }
    case 'material': {
      const m = out.itemID ? p.sources.find((x) => x.id === out.itemID) : undefined
      if (m) {
        if (!out.title) out.title = m.title
        if (out.subtitle === undefined) out.subtitle = p.title
      }
      break
    }
    case 'exercise':
      if (!out.skillID && out.itemID) {
        for (const sid of c.store.skillIDs()) {
          try {
            if (c.store.loadSkill(sid).exercises.some((e) => e.id === out.itemID)) { out.skillID = sid; break }
          } catch { /* siguiente */ }
        }
      }
      if (out.subtitle === undefined) out.subtitle = p.title
      break
    case 'event': break
  }
  return out
}

/** Tarjeta de «Abrir» con lo que se acaba de tocar. */
export function showItems(env: ToolEnv, title: string, items: AssistantRef[], icon?: string): void {
  env.io.show(newCard('items', title, { items, state: 'done', allowsOther: false, ...(icon ? { icon } : {}) }))
}

export function langCode(): string {
  return tr('es', 'en')
}

/** Reenvía los argumentos a otra herramienta sin `course_id`. */
export function forward(a: ToolArgs): JSONObject {
  return a.without('course_id')
}
