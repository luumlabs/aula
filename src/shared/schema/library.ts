// Lo que la biblioteca cuenta de cada curso (para la pantalla de inicio) y los cambios de metadatos que pide la interfaz.
import type { ExamInfo, Pack } from './pack'
import { clamp, prune, vDate, type ISODate, type ItemID } from './coding'
import { CourseIconCatalog } from './courseIcons'

/** Resumen de un curso (lo que necesita la lista sin cargar las lecciones). */
export interface PackSummary {
  id: ItemID
  title: string
  subject: string
  icon: string
  hue: number
  updated: ISODate
  examDate?: ISODate
  skillCount: number
  /** Ejercicios y plantillas. */
  exerciseCount: number
  cardCount: number
  courseCode?: string
  language: string
  /** ¿Hay un examen al que apuntar? (con fecha, o un curso que no es «a su ritmo»). */
  hasExam: boolean
  examTitle?: string
}

/** Campos del examen que cambian: `null` quita un dato opcional (la fecha, la duración…). */
export type ExamInfoPatch = { title?: string } & { [K in Exclude<keyof ExamInfo, 'title'>]?: ExamInfo[K] | null }

/** Cambios de los metadatos de un curso: título, icono, color y examen. `exam: null` quita el examen. */
export interface CourseMetaPatch {
  title?: string
  subject?: string
  courseCode?: string | null
  icon?: string
  hue?: number
  guidance?: string | null
  selfPaced?: boolean | null
  /** Campos del examen que cambian (`date: null` quita la fecha). */
  exam?: ExamInfoPatch | null
}

const EXAM_TEXT_KEYS = ['aids', 'notes', 'location'] as const
const MAX_TEXT = 20_000

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Valida un `CourseMetaPatch` que llega de fuera (IPC): devuelve el cambio normalizado o un mensaje de error.
 * Las fechas se aceptan en ISO-8601 y se guardan con milisegundos en UTC, como el resto del curso.
 */
export function parseCourseMetaPatch(raw: unknown): { ok: true; patch: CourseMetaPatch } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: 'Cambios no válidos' }
  const out: CourseMetaPatch = {}
  const text = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)
  for (const k of ['title', 'subject', 'icon'] as const) {
    if (raw[k] === undefined) continue
    const v = text(raw[k], 500)
    if (v === undefined) return { ok: false, error: `«${k}» no es válido` }
    out[k] = v
  }
  for (const k of ['courseCode', 'guidance'] as const) {
    if (raw[k] === undefined) continue
    if (raw[k] === null) { out[k] = null; continue }
    const v = text(raw[k], k === 'guidance' ? MAX_TEXT : 200)
    if (v === undefined) return { ok: false, error: `«${k}» no es válido` }
    out[k] = v
  }
  if (raw.hue !== undefined) {
    if (typeof raw.hue !== 'number' || !Number.isFinite(raw.hue)) return { ok: false, error: '«hue» no es válido' }
    out.hue = raw.hue
  }
  if (raw.selfPaced !== undefined) {
    if (raw.selfPaced !== null && typeof raw.selfPaced !== 'boolean') return { ok: false, error: '«selfPaced» no es válido' }
    out.selfPaced = raw.selfPaced
  }
  if (raw.exam !== undefined) {
    if (raw.exam === null) out.exam = null
    else {
      const exam = parseExamPatch(raw.exam)
      if (!exam) return { ok: false, error: '«exam» no es válido' }
      out.exam = exam
    }
  }
  return { ok: true, patch: out }
}

function parseExamPatch(raw: unknown): ExamInfoPatch | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: ExamInfoPatch = {}
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string' || raw.title.length > 500) return undefined
    out.title = raw.title
  }
  if (raw.date !== undefined) {
    if (raw.date === null) out.date = null
    else {
      const d = vDate(raw.date)
      if (d === undefined) return undefined
      out.date = d
    }
  }
  for (const k of ['durationMinutes', 'totalPoints'] as const) {
    const v = raw[k]
    if (v === undefined) continue
    if (v === null) { out[k] = null; continue }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
    out[k] = k === 'durationMinutes' ? Math.min(Math.round(v), 10_000) : Math.min(v, 1e9)
  }
  for (const k of EXAM_TEXT_KEYS) {
    const v = raw[k]
    if (v === undefined) continue
    if (v === null) { out[k] = null; continue }
    if (typeof v !== 'string' || v.length > MAX_TEXT) return undefined
    out[k] = v
  }
  return out
}

/** Aplica los cambios de metadatos a un curso (en su sitio) y lo devuelve. El icono siempre queda dentro del catálogo. */
export function applyCourseMetaPatch(pack: Pack, patch: CourseMetaPatch): Pack {
  if (patch.title !== undefined) pack.title = patch.title.trim() || pack.title
  if (patch.subject !== undefined) pack.subject = patch.subject.trim()
  if (patch.courseCode !== undefined) {
    const code = patch.courseCode?.trim()
    if (code) pack.courseCode = code
    else delete pack.courseCode
  }
  if (patch.icon !== undefined) pack.icon = CourseIconCatalog.resolve(patch.icon, pack.subject, pack.title)
  if (patch.hue !== undefined) pack.hue = clamp(patch.hue, 0, 1, pack.hue)
  if (patch.guidance !== undefined) {
    if (patch.guidance === null || patch.guidance.trim() === '') delete pack.guidance
    else pack.guidance = patch.guidance
  }
  if (patch.selfPaced !== undefined) {
    if (patch.selfPaced === null) delete pack.selfPaced
    else pack.selfPaced = patch.selfPaced
  }
  if (patch.exam === null) delete pack.exam
  else if (patch.exam !== undefined) pack.exam = applyExamPatch(pack.exam, patch.exam)
  return pack
}

function applyExamPatch(current: ExamInfo | undefined, patch: ExamInfoPatch): ExamInfo {
  const exam: ExamInfo = { ...(current ?? { title: 'Examen' }) }
  if (patch.title !== undefined) exam.title = patch.title.trim() || exam.title
  for (const k of ['date', 'durationMinutes', 'totalPoints', ...EXAM_TEXT_KEYS] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null) delete exam[k]
    else (exam as unknown as Record<string, unknown>)[k] = v
  }
  return prune(exam)
}
