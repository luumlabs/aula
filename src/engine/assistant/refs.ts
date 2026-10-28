// Referencias a cosas de la app (port de AssistantRef de AssistantModels.swift): cursos, lecciones, ejercicios, materiales y
// eventos. Las usan las menciones con «@», las opciones «¿Te refieres a esto?» y las tarjetas con «Abrir».
import type { AssistantRef, AssistantRefKind } from '@shared/assistant/types'
import type { JSONObject, JSONValue } from '@engine/base/json'
import { isoLocal, parseDate } from './dates'

export const REF_KINDS: readonly AssistantRefKind[] = ['course', 'lesson', 'exercise', 'material', 'event']

/** Identidad estable («lesson:curso:habilidad»). */
export function refID(r: AssistantRef): string {
  return `${r.kind}:${r.courseID ?? '-'}:${r.itemID ?? '-'}`
}

/** Clave del id del elemento según su tipo (la misma que aceptan las herramientas). */
export function refIDKey(k: AssistantRefKind): string {
  switch (k) {
    case 'course': return 'course_id'
    case 'lesson': return 'skill_id'
    case 'exercise': return 'exercise_id'
    case 'material': return 'source_id'
    case 'event': return 'event_id'
  }
}

/** Forma compacta para la IA (`{"kind":"lesson","course_id":…}`). */
export function refJSON(r: AssistantRef): JSONObject {
  const o: JSONObject = { kind: r.kind, title: r.title }
  if (r.courseID) o.course_id = r.courseID
  if (r.itemID) o[refIDKey(r.kind)] = r.itemID
  if (r.skillID && r.kind === 'exercise') o.skill_id = r.skillID
  if (r.subtitle) o.subtitle = r.subtitle
  if (r.date) {
    const d = new Date(r.date)
    if (!Number.isNaN(d.getTime())) o.date = isoLocal(d)
  }
  return o
}

const str = (v: JSONValue | undefined): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** Lee una referencia que escribió la IA (`{"kind":"lesson","course_id":"x","skill_id":"y","title":"…"}`). */
export function parseRef(v: JSONValue | undefined): AssistantRef | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as JSONObject
  const rawKind = (str(o.kind) ?? str(o.type) ?? '').toLowerCase()
  let kind: AssistantRefKind
  switch (rawKind) {
    case 'course': case 'curso': kind = 'course'; break
    case 'lesson': case 'skill': case 'leccion': case 'lección': case 'tema': kind = 'lesson'; break
    case 'exercise': case 'ejercicio': kind = 'exercise'; break
    case 'material': case 'source': case 'file': case 'document': kind = 'material'; break
    case 'event': case 'evento': case 'exam': case 'calendar': kind = 'event'; break
    default:
      if (o.exercise_id !== undefined) kind = 'exercise'
      else if (o.skill_id !== undefined) kind = 'lesson'
      else if (o.source_id !== undefined) kind = 'material'
      else if (o.event_id !== undefined) kind = 'event'
      else if (o.course_id !== undefined) kind = 'course'
      else return undefined
  }
  const item = str(o[refIDKey(kind)]) ?? str(o.item_id) ?? str(o.id)
  const ref: AssistantRef = { kind, title: str(o.title) ?? str(o.label) ?? item ?? '' }
  const course = str(o.course_id) ?? (kind === 'course' ? item : undefined)
  if (course) ref.courseID = course
  if (kind !== 'course' && item) ref.itemID = item
  const skill = str(o.skill_id)
  if (skill) ref.skillID = skill
  const sub = str(o.subtitle)
  if (sub) ref.subtitle = sub
  const date = str(o.date) ? parseDate(str(o.date)!) : undefined
  if (date) ref.date = date.toISOString()
  return ref
}
