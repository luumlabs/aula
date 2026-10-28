// Calendario de Aula: los tipos que ven la interfaz y el proceso principal (JSON puro: fechas en ISO 8601).
// El motor (src/engine/calendar) trabaja con `Date`; esto es lo que cruza el IPC.

/** Qué es un evento. */
export type CalendarEventKind = 'exam' | 'quiz' | 'assignment' | 'lecture' | 'study' | 'event'
export const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[] = ['exam', 'quiz', 'assignment', 'lecture', 'study', 'event']

/** De dónde viene: de una plataforma (solo lectura), la fecha de examen de un curso de Aula o propio. */
export type CalendarEventOrigin = 'platform' | 'course' | 'own'
/** Quién añadió un evento propio. */
export type CalendarAuthor = 'student' | 'ai'
/** A qué repeticiones afecta un cambio: solo esta, esta y las siguientes, o toda la serie. */
export type CalendarEditScope = 'thisOccurrence' | 'thisAndFollowing' | 'allOccurrences'
export const CALENDAR_EDIT_SCOPES: readonly CalendarEditScope[] = ['thisOccurrence', 'thisAndFollowing', 'allOccurrences']

export interface CalendarTaskView {
  done: boolean
  completedAt?: string
}

/**
 * Un evento tal como lo recibe la interfaz.
 * Ids estables: `own:<id>`, `course:<curso>`, `platform:<plataforma>:<uid>`. En una repetición de un evento propio, `id` es el
 * de la serie y `occurrenceKey` la clave de la repetición: el id completo es `${id}#${occurrenceKey}` (ver `fullEventID`).
 */
export interface CalendarEventView {
  id: string
  occurrenceKey?: string
  title: string
  kind: CalendarEventKind
  start: string
  /** Fin (exclusivo en los de todo el día). */
  end: string | null
  allDay: boolean
  course?: string
  notes?: string
  location?: string
  url?: string
  origin: CalendarEventOrigin
  platformID?: string
  /** Nombre de la plataforma para mostrar («Canvas · Universidad X»). */
  platformLabel?: string
  platformCourseID?: number
  /** Curso de Aula vinculado. */
  packID?: string
  createdBy?: CalendarAuthor
  created?: string
  updated?: string
  /** Regla RRULE («FREQ=WEEKLY;BYDAY=MO,WE»). */
  recurrence?: string
  /** La regla en palabras («Cada semana: lunes y miércoles»). */
  recurrenceText?: string
  timeZone?: string
  /** Avisos: minutos antes. */
  reminders: number[]
  /** Solo en las tareas. */
  task?: CalendarTaskView
  isTask: boolean
  editable: boolean
  /** Viene de un calendario al que te suscribiste (su id); entonces `platformLabel` es el nombre de la suscripción. */
  subscriptionID?: string
}

/** El id completo de un evento de la interfaz. */
export function fullEventID(e: Pick<CalendarEventView, 'id' | 'occurrenceKey'>): string {
  return e.occurrenceKey ? `${e.id}#${e.occurrenceKey}` : e.id
}

/** Un evento propio nuevo. Fechas ISO 8601 (instantes). */
export interface CalendarDraftInput {
  title: string
  kind?: CalendarEventKind
  start: string
  end?: string | null
  allDay?: boolean
  course?: string
  notes?: string
  location?: string
  url?: string
  packID?: string
  /** RRULE (o vacío: una sola vez). */
  recurrence?: string | null
  /** Zona de la hora de pared de las repeticiones («Europe/Madrid»). */
  timeZone?: string
  reminders?: number[]
  isTask?: boolean
}

/** Cambios a un evento: solo se aplican los campos que vienen. Texto vacío = quitar ese campo. */
export interface CalendarPatchInput {
  title?: string
  kind?: CalendarEventKind
  start?: string
  end?: string
  allDay?: boolean
  course?: string
  notes?: string
  location?: string
  url?: string
  packID?: string
  clearEnd?: boolean
  clearPack?: boolean
  recurrence?: string
  clearRecurrence?: boolean
  reminders?: number[]
  isTask?: boolean
}

/** Lo que devuelve una consulta con detalles. */
export interface CalendarSnapshotView {
  events: CalendarEventView[]
  /** Alguna plataforma no se pudo leer (frase para el estudiante); los demás eventos sí están. */
  platformError?: string
  /** Tu calendario (`calendar.json`) no se pudo leer ni recuperar de su copia (frase para el estudiante). */
  fileProblem?: string
  /** Cuándo se leyeron las plataformas (sin valor si no hay ninguna conectada). */
  fetchedAt?: string
}

/** Un aviso que hay que programar como notificación. */
export interface CalendarReminderView {
  id: string
  eventID: string
  title: string
  kind: CalendarEventKind
  eventStart: string
  fireAt: string
  minutesBefore: number
}

/** «Añadir rápido»: la frase entendida y el evento (de vista previa, o el guardado si `commit`). */
export interface CalendarQuickAddResult {
  summary: string
  /** ¿Se reconoció una fecha? (si no, es hoy y conviene revisarlo) */
  hasDate: boolean
  event?: CalendarEventView
}

export interface CalendarExportOptions {
  calendarName?: string
  includeCourseExams?: boolean
  includePlatformDates?: boolean
  alarms?: boolean
}

/** Estado de los calendarios de las plataformas tras leerlos. */
export interface CalendarFeedStatus {
  accountId: string
  label: string
  ok: boolean
  error?: string
  events: number
}

export interface CalendarRefreshResult {
  fetchedAt?: string
  platformError?: string
  feeds: CalendarFeedStatus[]
}

/** Aviso de que el calendario cambió (la interfaz vuelve a pedir lo que muestra). */
export interface CalendarChange {
  reason: 'events' | 'tasks' | 'links' | 'feeds' | 'course' | 'subscriptions'
}

// MARK: - Suscripciones e importar

/** Las suscripciones usan como «plataforma» su id, que empieza así (`sub-ab12cd34`). */
export const CALENDAR_SUBSCRIPTION_PREFIX = 'sub-'

/** ¿Es el id de una suscripción? (también el `platformID` de sus eventos) */
export function isSubscriptionID(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CALENDAR_SUBSCRIPTION_PREFIX) && id.length > CALENDAR_SUBSCRIPTION_PREFIX.length
}

/** Un calendario .ics al que te suscribiste (el enlace es secreto: aquí solo su servidor). */
export interface CalendarSubscriptionView {
  id: string
  name: string
  /** Servidor del enlace («calendar.google.com»). */
  host: string
  added: string
  /** Última lectura buena. */
  refreshedAt?: string
  /** Último intento (bueno o no). */
  attemptedAt?: string
  /** La última lectura falló (frase para el estudiante); siguen los eventos de la última buena. */
  error?: string
  /** Código estable del fallo (`calendar_private`, `offline`…), para decirlo en el idioma de la interfaz. */
  errorCode?: string
  /** Eventos de la última lectura buena. */
  events: number
}

/** Suscribirse: el enlace (webcal:// o https://) y, si se quiere, un nombre. */
export interface CalendarSubscribeInput {
  url: string
  name?: string
}

/** Cómo fue importar un .ics. */
export interface CalendarImportResult {
  /** Eventos (o series) nuevos. */
  added: number
  /** De ellos, los que se repiten. */
  recurring: number
  /** Ya estaban (mismo UID): no se repiten. */
  skipped: number
  /** Inicio del primero añadido (para ir a verlo). */
  firstStart?: string
  /** Nombre del archivo. */
  fileName?: string
}
