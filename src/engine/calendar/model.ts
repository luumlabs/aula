// El modelo del calendario de Aula (StudyEngine/Calendar/StudyCalendar.swift y StudyCalendar+Series.swift), con `Date`.
// Junta las fechas de las plataformas (solo lectura, `origin = 'platform'`), las fechas de examen de los cursos de Aula
// (`origin = 'course'`) y los eventos propios (`origin = 'own'`, guardados en `<datos>/calendar.json`).
// Ids estables: `own:<id>`, `own:<id>#<clave de la repetición>`, `course:<id del curso>`, `platform:<plataforma>:<uid>`.
import type { CalendarAuthor, CalendarEditScope, CalendarEventKind, CalendarEventOrigin } from '@shared/calendar'
import { addDays, isValidTimeZone, localTimeZone, startOfDay, isSameDay } from '@engine/calendar/time'
import type { RecurrenceRule, CalendarLanguage } from './rrule'
import { tr } from '@shared/ai/i18n'

export type { CalendarAuthor, CalendarEditScope, CalendarEventKind, CalendarEventOrigin } from '@shared/calendar'
export { CALENDAR_EVENT_KINDS, CALENDAR_EDIT_SCOPES } from '@shared/calendar'

/** Una tarea del calendario («Entregar la práctica 3»). */
export interface CalendarTask {
  done: boolean
  completedAt?: Date
  /** En una tarea que se repite: las repeticiones hechas (clave → cuándo). */
  doneOccurrences: Record<string, Date>
}

/** Lo que cambia en UNA repetición: otra hora, otro título, otra aula… o que esa vez no hay. */
export interface CalendarOccurrenceOverride {
  start?: Date
  end?: Date
  title?: string
  notes?: string
  location?: string
  kind?: CalendarEventKind
  allDay?: boolean
  course?: string
  url?: string
  cancelled: boolean
}

/** Un campo de `calendar.json` que esta versión no entiende: su JSON tal cual y cómo lo escribiría esta versión. */
export interface PreservedField {
  raw: unknown
  /** JSON canónico de lo que esta versión escribiría (`undefined` = nada). */
  fallback?: string
  unknown: boolean
}

/** Un evento del calendario de Aula. */
export interface CalendarEvent {
  id: string
  title: string
  kind: CalendarEventKind
  start: Date
  /** Fin (exclusivo en los de todo el día). Sin valor = sin duración. */
  end?: Date
  allDay: boolean
  /** Asignatura o curso tal como lo llama la plataforma o el estudiante («MATH112», «Inglés»). */
  course?: string
  notes?: string
  location?: string
  url?: string
  origin: CalendarEventOrigin
  /** Plataforma de la que viene (id de la cuenta). */
  platformID?: string
  /** Nombre de la plataforma (no se guarda). */
  platformLabel?: string
  /** Id del curso en Canvas. */
  platformCourseID?: number
  /** Curso de Aula vinculado. */
  packID?: string
  createdBy?: CalendarAuthor
  created?: Date
  updated?: Date
  /** Se repite (clases, tareas semanales). */
  recurrence?: RecurrenceRule
  /** Zona de la hora de pared de las repeticiones («Europe/Madrid»). */
  timeZone?: string
  /** Repeticiones quitadas (por su inicio original). */
  exceptions: Date[]
  /** Repeticiones cambiadas solo esa vez (clave = `occurrenceKey`). */
  overrides: Record<string, CalendarOccurrenceOverride>
  /** Avisos: minutos antes del inicio. */
  reminders: number[]
  /** Es una tarea que se marca como hecha (las entregas lo son siempre). */
  task?: CalendarTask
  /** En una repetición: el evento que se repite y la clave de esta repetición (no se guardan). */
  seriesID?: string
  occurrenceKey?: string
  /** Lo del archivo que esta versión no entiende (se vuelve a escribir tal cual). */
  preserved?: Record<string, PreservedField>
}

/** Lo que hace falta para añadir un evento propio. */
export interface CalendarEventDraft {
  title: string
  kind?: CalendarEventKind
  start: Date
  end?: Date
  allDay?: boolean
  course?: string
  notes?: string
  location?: string
  url?: string
  packID?: string
  recurrence?: RecurrenceRule
  /** Zona de la hora de pared (sin valor = la del sistema si se repite). */
  timeZone?: string
  reminders?: number[]
  isTask?: boolean
}

/** Cambios a un evento: solo se aplican los campos que vienen (`clearEnd`, etc. para quitar uno opcional). */
export interface CalendarEventPatch {
  title?: string
  kind?: CalendarEventKind
  start?: Date
  end?: Date
  allDay?: boolean
  course?: string
  notes?: string
  location?: string
  url?: string
  packID?: string
  clearEnd?: boolean
  clearPack?: boolean
  recurrence?: RecurrenceRule
  clearRecurrence?: boolean
  reminders?: number[]
  isTask?: boolean
}

export function isPatchEmpty(p: CalendarEventPatch): boolean {
  return p.title === undefined && p.kind === undefined && p.start === undefined && p.end === undefined && p.allDay === undefined && p.course === undefined &&
    p.notes === undefined && p.location === undefined && p.url === undefined && p.packID === undefined && p.clearEnd !== true && p.clearPack !== true &&
    p.recurrence === undefined && p.clearRecurrence !== true && p.reminders === undefined && p.isTask === undefined
}

/** Lo que devuelve una consulta del calendario. */
export interface CalendarSnapshot {
  events: CalendarEvent[]
  /** Alguna plataforma no se pudo leer (frase para el estudiante); los demás eventos sí están. */
  platformError?: string
  /** `calendar.json` no se pudo leer ni recuperar de su copia (frase para el estudiante). */
  fileProblem?: string
  /** Cuándo se leyeron las plataformas (sin valor = no hay ninguna conectada). */
  fetchedAt?: Date
}

/** Un aviso que hay que programar. */
export interface CalendarReminder {
  /** Estable: el mismo aviso tiene el mismo id. */
  id: string
  eventID: string
  title: string
  kind: CalendarEventKind
  eventStart: Date
  fireAt: Date
  minutesBefore: number
}

/** Una fecha de una plataforma (CampusEvent de Swift): de un .ics o de la API de Canvas. */
export interface CampusEvent {
  id: string
  title: string
  course?: string
  start: Date
  end?: Date
  allDay: boolean
  isExam: boolean
  /** exam · quiz · assignment · event… */
  kind: string
  url?: string
  location?: string
  details?: string
  courseID?: number
  /** Cuenta de la que viene. */
  platformID?: string
  platformLabel?: string
}

/** `calendar.json` (eventos propios, vínculos examen → curso y tareas de plataformas marcadas como hechas). */
export interface CalendarFile {
  /** 1 = hasta octubre de 2026; 2 = con repeticiones, avisos y tareas. */
  schema: number
  events: CalendarEvent[]
  /** Evento de plataforma → curso de Aula creado para él. */
  links: Record<string, string>
  /** Tareas de las plataformas o de los cursos marcadas como hechas (id → cuándo). */
  completed: Record<string, Date>
}

export const CALENDAR_FILE_SCHEMA = 2

export function emptyCalendarFile(): CalendarFile {
  return { schema: CALENDAR_FILE_SCHEMA, events: [], links: {}, completed: {} }
}

/** Error del calendario con código estable (`not_found`, `read_only`, `invalid`). */
export class CalendarError extends Error {
  constructor(readonly code: 'not_found' | 'read_only' | 'invalid', message: string, readonly detail?: string) {
    super(message)
    this.name = 'CalendarError'
  }

  static notFound(id: string): CalendarError {
    return new CalendarError('not_found', tr(`No encuentro ese evento en el calendario (${id}).`, `I can’t find that event in the calendar (${id}).`), id)
  }

  static readOnly(title: string): CalendarError {
    return new CalendarError(
      'read_only',
      tr(
        `«${title}» viene de tu plataforma de estudio: Aula no puede cambiarlo. Puedes añadir un evento propio con tus notas.`,
        `“${title}” comes from your study platform: Aula can’t change it. You can add your own event with your notes.`
      ),
      title
    )
  }

  static invalid(why: string): CalendarError {
    return new CalendarError('invalid', why)
  }
}

// Getters y funciones (no constantes): cada texto sale en el idioma de la interfaz en el momento del error
export const CalendarMessages = {
  get missingTitle(): string { return tr('Ponle un nombre al evento.', 'Give the event a name.') },
  get endBeforeStart(): string { return tr('El evento no puede terminar antes de empezar.', 'The event can’t end before it starts.') },
  get untilBeforeStart(): string { return tr('La repetición termina antes de la primera vez.', 'The repetition ends before the first time.') },
  damaged: (copy: string) => tr(
    `Tu calendario no se podía leer. Aula guardó una copia («${copy}», en la carpeta de Aula) y empieza uno vacío: vuelve a intentarlo.`,
    `Your calendar couldn’t be read. Aula saved a copy (“${copy}”, in Aula’s folder) and is starting an empty one: try again.`
  ),
  /** Al leer (A3-P2-9): ni el archivo ni su copia anterior se pueden leer. */
  unreadable: (copy: string) => tr(
    `Aula guardó una copia («${copy}», en la carpeta de Aula). Lo que añadas ahora irá a un calendario nuevo.`,
    `Aula kept a copy (“${copy}”, in Aula’s folder). Anything you add now goes into a new calendar.`
  ),
  get newerVersion(): string {
    return tr(
      'Este calendario lo guardó una versión más nueva de Aula. Actualiza Aula para cambiarlo; mientras tanto se puede consultar.',
      'A newer version of Aula saved this calendar. Update Aula to change it; meanwhile you can still view it.'
    )
  },
  seriesOnly: (what: string) => tr(
    `«Solo esta vez» no puede cambiar ${what}: elige «Esta y las siguientes» o «Toda la serie».`,
    `“Only this one” can’t change ${what}: choose “This and following” or “All of them”.`
  )
}

// MARK: - Tipos

export function isAssessmentKind(k: CalendarEventKind): boolean {
  return k === 'exam' || k === 'quiz'
}

const KIND_TITLES: Record<CalendarLanguage, Record<CalendarEventKind, string>> = {
  es: { exam: 'Examen', quiz: 'Prueba corta', assignment: 'Entrega', lecture: 'Clase', study: 'Estudio', event: 'Evento' },
  en: { exam: 'Exam', quiz: 'Quiz', assignment: 'Due date', lecture: 'Class', study: 'Study', event: 'Event' }
}

/** Nombre del tipo («Examen», «Prueba corta»…). */
export function kindTitle(k: CalendarEventKind, lang: CalendarLanguage = 'es'): string {
  return KIND_TITLES[lang][k]
}

/** Un tipo desconocido (de una versión futura) se lee como `event`. */
export function decodeKind(raw: unknown): CalendarEventKind {
  return typeof raw === 'string' && (KIND_TITLES.es as Record<string, string>)[raw] !== undefined ? (raw as CalendarEventKind) : 'event'
}

/** Sin tildes ni mayúsculas. */
export function foldCase(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const CLASS_WORDS = ['clase', 'class', 'lecture', 'seminario', 'seminar', 'laboratorio', 'lab ', 'tutoria', 'tutorial', 'sesion', 'session', 'aula ', 'practica de laboratorio']

/** El tipo de una fecha de plataforma (su `kind` + `isExam`, y el título para reconocer las clases). */
export function kindFromCampus(kind: string, isExam: boolean, title: string): CalendarEventKind {
  switch (kind.toLowerCase()) {
    case 'exam': return isExam ? 'exam' : 'event'
    case 'quiz': return isExam ? 'quiz' : 'event'
    case 'assignment': return 'assignment'
    default: {
      const t = foldCase(title)
      return CLASS_WORDS.some((w) => t.startsWith(w) || t.includes(' ' + w)) ? 'lecture' : 'event'
    }
  }
}

// MARK: - Evento

export function isAssessment(e: CalendarEvent): boolean {
  return isAssessmentKind(e.kind)
}

/** ¿Es una tarea? (las entregas siempre) */
export function isTask(e: CalendarEvent): boolean {
  return e.task !== undefined || e.kind === 'assignment'
}

export function isDone(e: CalendarEvent): boolean {
  return e.task?.done ?? false
}

export function isRecurring(e: CalendarEvent): boolean {
  return e.recurrence !== undefined
}

/** ¿Se puede cambiar desde Aula? (los propios del todo; los de un curso, su fecha y título) */
export function isEditable(e: CalendarEvent): boolean {
  return e.origin !== 'platform'
}

/** ¿Es una zona con nombre que entiende el sistema? («Europe/Madrid»; no «+05:00») */
export function isNamedTimeZone(tz: unknown): tz is string {
  return typeof tz === 'string' && /^[A-Za-z]/.test(tz) && !/\s/.test(tz) && isValidTimeZone(tz)
}

/** La zona de sus horas de pared (la suya o la del sistema). */
export function eventZone(e: Pick<CalendarEvent, 'timeZone'>, fallback: string = localTimeZone()): string {
  return e.timeZone && isNamedTimeZone(e.timeZone) ? e.timeZone : fallback
}

/** Fin efectivo para dibujarlo (1 h si no tiene; el día entero si es de todo el día). */
export function effectiveEnd(e: CalendarEvent, tz: string = localTimeZone()): Date {
  if (e.end && e.end.getTime() > e.start.getTime()) return e.end
  return e.allDay ? addDays(startOfDay(e.start, tz), 1, tz) : new Date(e.start.getTime() + 3_600_000)
}

/** ¿Ocurre (todo o parte) en ese día? */
export function occursOn(e: CalendarEvent, day: Date, tz: string = localTimeZone()): boolean {
  if (!e.end && !e.allDay) return isSameDay(e.start, day, tz)
  const d0 = startOfDay(day, tz)
  const d1 = addDays(d0, 1, tz)
  return (e.start.getTime() < d1.getTime() && effectiveEnd(e, tz).getTime() > d0.getTime()) || isSameDay(e.start, day, tz)
}

/** «math112», «quimica general i» (sin tildes ni mayúsculas ni espacios de más). */
export function normalizeCourse(s: string): string {
  return foldCase(s).split(/\s+/).filter((w) => w !== '').join(' ')
}

/** Clave para elegir su color: el curso de Aula, o la asignatura (normalizada), o la plataforma. */
export function colorKey(e: CalendarEvent): string {
  if (e.packID) return 'pack:' + e.packID
  const c = e.course ? normalizeCourse(e.course) : ''
  if (c) return 'course:' + c
  if (e.platformID) return 'platform:' + e.platformID
  return 'kind:' + e.kind
}

/** Texto limpio (sin espacios a los lados, como mucho 4000 caracteres) o `undefined` si queda vacío. */
export function cleanText(s: string | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined
  const t = s.trim()
  return t ? Array.from(t).slice(0, 4000).join('') : undefined
}

/** Los primeros `n` caracteres. */
export function prefixChars(s: string, n: number): string {
  const chars = Array.from(s)
  return chars.length <= n ? s : chars.slice(0, n).join('')
}

const titleCollator = new Intl.Collator(undefined, { sensitivity: 'accent' })

/** Orden del calendario: por inicio; a igualdad, los de todo el día, luego las evaluaciones y por título. */
export function chronologicalEvents(a: CalendarEvent, b: CalendarEvent): number {
  const d = a.start.getTime() - b.start.getTime()
  if (d !== 0) return d
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  const aa = isAssessment(a), ba = isAssessment(b)
  if (aa !== ba) return aa ? -1 : 1
  return titleCollator.compare(a.title, b.title)
}

/** Un evento con los valores por defecto (propio, sin fin, sin repetición…). */
export function makeCalendarEvent(p: Partial<CalendarEvent> & { id: string; title: string; start: Date }): CalendarEvent {
  return { kind: 'event', allDay: false, origin: 'own', exceptions: [], overrides: {}, reminders: [], ...p }
}

/** Una copia que se puede modificar sin tocar el original. */
export function cloneEvent(e: CalendarEvent): CalendarEvent {
  const overrides: Record<string, CalendarOccurrenceOverride> = {}
  for (const [k, o] of Object.entries(e.overrides)) overrides[k] = { ...o }
  return {
    ...e,
    exceptions: [...e.exceptions],
    overrides,
    reminders: [...e.reminders],
    task: e.task ? { ...e.task, doneOccurrences: { ...e.task.doneOccurrences } } : undefined,
    recurrence: e.recurrence ? { ...e.recurrence, byDay: e.recurrence.byDay.map((d) => ({ ...d })), byMonthDay: [...e.recurrence.byMonthDay], byMonth: [...e.recurrence.byMonth], bySetPos: [...e.recurrence.bySetPos] } : undefined,
    preserved: e.preserved ? { ...e.preserved } : undefined
  }
}

/** Ámbito por defecto de un cambio. */
export const DEFAULT_SCOPE: CalendarEditScope = 'thisOccurrence'
