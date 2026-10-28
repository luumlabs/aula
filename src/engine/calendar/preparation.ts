// Cursos «en preparación» (CoursePreparation.swift), la parte pura: la IA aún los está creando (o la creación se pausó,
// falló o se cortó) y no tienen sus lecciones escritas. Mientras tanto la interfaz los enseña como «En preparación» con lo que
// ya se sabe del examen. Los registros de las creaciones (`Packs/<id>/runs/run-*.json`) tienen el formato de la app Swift.
import { foldCase } from './model'

/** Lo que importa de un registro de creación (`GenerationRunState` de Swift), ya leído. */
export interface PreparationRun {
  runID: string
  /** «create» o «extend». */
  mode: 'create' | 'extend'
  startedAt: Date
  finishedAt?: Date
  cancelled: boolean
  failure?: string
  /** Estado de la etapa de escribir las lecciones (`stages.author`). */
  authorStatus: string
  request: { title?: string; topics?: string; examNotes?: string; examDate?: Date; gatherFocus?: string }
}

/** Lo que averiguó la etapa de reunir materiales (`GatherFindings`). */
export interface PreparationFindings {
  examTitle?: string
  examDate?: string
  covers?: string
  format?: string
  notes?: string
}

/** Lo que ya se sabe de un curso en preparación (para su tarjeta). */
export interface PreparationSnapshot {
  title: string
  subject: string
  examTitle?: string
  examDate?: Date
  about?: string
  format?: string
  topics: string[]
  materials: number
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function date(v: unknown): Date | undefined {
  if (typeof v !== 'string') return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Lee un registro de creación con la tolerancia de Swift (solo el id y la petición son imprescindibles). */
export function decodePreparationRun(raw: unknown): PreparationRun | null {
  if (!isObj(raw) || typeof raw.runID !== 'string' || !isObj(raw.request)) return null
  const req = raw.request
  const modeRaw = req.mode
  const mode: PreparationRun['mode'] | null =
    modeRaw === 'create' || (isObj(modeRaw) && 'create' in modeRaw) ? 'create' : modeRaw === 'extend' || (isObj(modeRaw) && 'extend' in modeRaw) ? 'extend' : null
  if (!mode || typeof req.packID !== 'string') return null
  const stages = isObj(raw.stages) ? raw.stages : {}
  const gather = isObj(req.gather) ? req.gather : {}
  return {
    runID: raw.runID,
    mode,
    startedAt: date(raw.startedAt) ?? new Date(),
    finishedAt: date(raw.finishedAt),
    cancelled: raw.cancelled === true,
    failure: text(raw.failure),
    authorStatus: text(stages.author) ?? 'pending',
    request: { title: text(req.title), topics: text(req.topics), examNotes: text(req.examNotes), examDate: date(req.examDate), gatherFocus: text(gather.focus) }
  }
}

export function decodePreparationFindings(raw: unknown): PreparationFindings | null {
  if (!isObj(raw)) return null
  return { examTitle: text(raw.examTitle), examDate: text(raw.examDate), covers: text(raw.covers), format: text(raw.format), notes: text(raw.notes) }
}

/** La creación más reciente si aún no terminó y el curso no está listo para estudiar (sin habilidades o sin terminar de
 *  escribirlas). `null` = curso normal. `runs`: los registros del curso; `kept`: los que el estudiante decidió quedarse. */
export function pendingPreparation(runs: PreparationRun[], skillCount: number, kept: (runID: string) => boolean): PreparationRun | null {
  const last = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
  if (!last || last.mode !== 'create') return null
  const finished = last.finishedAt !== undefined && !last.cancelled && last.failure === undefined
  if (finished || kept(last.runID)) return null
  const written = last.authorStatus === 'done' || last.authorStatus === 'skipped'
  return skillCount === 0 || !written ? last : null
}

const clean = (s: string | undefined): string | undefined => {
  const t = s?.trim()
  return t ? t : undefined
}
const clip = (s: string, n: number) => Array.from(s).slice(0, n).join('')

/** Lo que ya se sabe del curso: el examen, lo que averiguó la etapa de reunir materiales y, si ya hay plan, sus temas. */
export function preparationSnapshot(pack: {
  title: string
  subject: string
  exam?: { title?: string; date?: Date; notes?: string }
  skillTitles: string[]
  sourceCount: number
}, run: PreparationRun | null, findings: PreparationFindings | null): PreparationSnapshot {
  const request = run?.request
  const about = clean(findings?.covers) ?? clean(request?.topics) ?? clean(pack.exam?.notes) ?? clean(request?.examNotes) ?? clean(request?.gatherFocus)
  const out: PreparationSnapshot = { title: pack.title, subject: pack.subject, topics: pack.skillTitles, materials: pack.sourceCount }
  const examTitle = clean(findings?.examTitle) ?? clean(pack.exam?.title)
  if (examTitle) out.examTitle = examTitle
  const examDate = pack.exam?.date ?? request?.examDate
  if (examDate) out.examDate = examDate
  if (about) out.about = clip(about, 600)
  const format = clean(findings?.format)
  if (format) out.format = clip(format, 300)
  return out
}

const FORMAT_WORDS = ['minuto', 'minute', ' min', 'hora', 'hour', 'duracion', 'duration', 'pregunta', 'question', 'opcion multiple', 'multiple choice', 'tipo test',
  'test de', 'verdadero', 'true/false', 'true or false', 'desarroll', 'problema', 'problem', 'ejercicio', 'exercise', 'calculadora', 'calculator',
  'formulario', 'hoja de formulas', 'formula sheet', 'cheat sheet', 'notes allowed', 'open book', 'libro abierto', 'closed book', 'puntos', 'points',
  'short answer', 'respuesta corta', 'ensayo', 'essay', 'oral', 'online', 'en linea', 'proctor', 'respondus', 'lockdown']

/** ¿La descripción de un examen ya dice cómo es (duración, tipo de preguntas, ayudas…)? Si no, el asistente lo pregunta. */
export function mentionsFormat(description: string | null | undefined): boolean {
  if (!description) return false
  const t = foldCase(description)
  return t !== '' && FORMAT_WORDS.some((w) => t.includes(w))
}
