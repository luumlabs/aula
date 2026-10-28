// El calendario de Aula en el proceso principal (StudyCalendar.swift): junta las fechas de TODAS las plataformas (solo
// lectura), las fechas de examen de los cursos de Aula y los eventos propios de `<datos>/calendar.json`. Lo usan la
// pantalla Calendario (por IPC), el planificador y el chat (`forAssistant`, `toolHandlers`).
//
//   listar ........ events(from, to, refresh) → CalendarSnapshot (ordenados + aviso si alguna plataforma falló)
//   buscar ........ search(texto, from?, to?), event(id), upcomingExams(días)
//   añadir ........ add(borrador, autor) → evento propio nuevo
//   cambiar ....... update(id, cambio, alcance?) — propios: todo; de un curso: fecha y título del examen; de una plataforma: error
//   borrar ........ delete(id, alcance?) — propios; en un examen de curso quita la fecha del examen
//   vincular ...... link(evento, curso), packID(evento)
//   tareas ........ setDone, toggleDone, tasks, pendingReminders
//   exportar ...... exportICS(opciones) → texto .ics
//   importar ...... importICS(bytes) → eventos propios nuevos (sin duplicar lo ya importado, por UID)
//   suscripciones . sus eventos (de la copia guardada) se juntan con los de las plataformas, también de solo lectura
import { join } from 'node:path'
import type { CalendarChange, CalendarFeedStatus, CalendarRefreshResult } from '@shared/calendar'
import {
  addOwnEvent, CalendarError, importICSInto, type ICSImportSummary, deleteOwnEvent, deleteOwnEventScoped, exportList, findOwnEvent, isDone, isTask, isTaskDoneIn, linkEvent,
  makeAssistantCalendar, makeCalendarToolHandlers, mapCampusEvent, mergeCalendar, ownEventsSorted, parseQuickEvent, pendingReminders, quickEventDraft,
  searchEvents, setTaskDone, splitOccurrence, updateOwnEvent, updateOwnEventScoped, upcomingAssessments, upcomingRange, writeICS,
  type AssistantCalendar, type CalendarAuthor, type CalendarBackend, type CalendarCoreOptions, type CalendarEditScope, type CalendarEvent,
  type CalendarEventDraft, type CalendarEventPatch, type CalendarReminder, type CalendarSnapshot, type CalendarToolHandlers, type CalendarToolOptions,
  type CampusEvent, type ICSWriterOptions, type QuickEventResult
} from '@engine/calendar'
import { localTimeZone } from '@engine/calendar/time'
import { IDs } from '@engine/base/ids'
import { Library } from '../store/library'
import type { ChangeHistory } from '../store/history/changeHistory'
import { log } from '../log'
import { clearCourseExamDate, courseExamEvents, updateCourseExam } from './courses'
import type { PlatformEventSource } from './sources'
import { CalendarStore } from './store'
import { mergeFeedEvents, type SubscriptionEventSource } from './subscriptions'

export interface CalendarServiceOptions {
  /** Carpeta de datos de Aula (donde está `calendar.json`, junto a `settings.json`). */
  root: string
  /** Biblioteca de cursos (para las fechas de examen). Por defecto, la de `root`; `null` = sin cursos. */
  library?: Library | null
  /** Fechas de las plataformas (`null` = ninguna). */
  platforms?: PlatformEventSource | null
  /** Calendarios a los que te suscribiste (`null` = ninguno). */
  subscriptions?: SubscriptionEventSource | null
  /** Historial de lo que cambia Aula. Por defecto, el de la biblioteca. */
  history?: ChangeHistory | null
  /** Zona del estudiante (por defecto, la del sistema). */
  timeZone?: string
  now?: () => Date
  newID?: () => string
  /** Avisa de cada cambio (la interfaz vuelve a pedir lo que muestra). */
  onChange?: (change: CalendarChange) => void
}

interface PlatformCache { from: number; to: number; events: CampusEvent[]; fetched: Date; error?: string; status: CalendarFeedStatus[] }

const DAY = 86_400_000
/** Copia de lo leído de las plataformas, compartida por carpeta de datos (la interfaz y el chat no descargan dos veces). */
const platformCaches = new Map<string, PlatformCache>()
const inflight = new Map<string, Promise<PlatformCache | { failure: string }>>()

export class StudyCalendarService implements CalendarBackend {
  /** Cuánto vale lo leído de las plataformas antes de volver a pedirlo. */
  static platformCacheLifetimeMs = 15 * 60_000

  readonly root: string
  readonly store: CalendarStore
  readonly library: Library | null
  private readonly platforms: PlatformEventSource | null
  private readonly subscriptions: SubscriptionEventSource | null
  private readonly tz: string
  private readonly now: () => Date
  private readonly newID: () => string
  onChange?: (change: CalendarChange) => void

  constructor(opts: CalendarServiceOptions) {
    this.root = opts.root
    this.library = opts.library === undefined ? new Library(opts.root) : opts.library
    this.platforms = opts.platforms ?? null
    this.subscriptions = opts.subscriptions ?? null
    this.tz = opts.timeZone ?? localTimeZone()
    this.now = opts.now ?? (() => new Date())
    this.newID = opts.newID ?? (() => 'own:' + IDs.short(10))
    this.onChange = opts.onChange
    const history = opts.history
    this.store = new CalendarStore(opts.root, { history: () => (history === undefined ? this.library?.history : history ?? undefined), now: this.now })
  }

  get fileURL(): string { return join(this.root, 'calendar.json') }
  get timeZone(): string { return this.tz }

  private get core(): CalendarCoreOptions {
    return { now: this.now, timeZone: this.tz, newID: this.newID }
  }

  private changed(reason: CalendarChange['reason']): void {
    try { this.onChange?.({ reason }) } catch (err) { log.warn('Aviso de cambio del calendario', err) }
  }

  // MARK: Plataformas

  private get cacheKey(): string { return this.root }

  /** Olvida lo leído de las plataformas (p. ej. tras conectar un calendario nuevo). */
  invalidatePlatformCache(): void {
    platformCaches.delete(this.cacheKey)
  }

  private async platformEvents(from: Date, to: Date, refresh: boolean): Promise<{ events: CampusEvent[]; error?: string; fetched?: Date }> {
    if (!this.platforms || !this.platforms.isConfigured()) return { events: [] }
    const key = this.cacheKey
    const inRange = (list: CampusEvent[]) => list.filter((e) => e.start.getTime() >= from.getTime() && e.start.getTime() <= to.getTime())
    const now = this.now()
    const cached = platformCaches.get(key)
    if (!refresh && cached && cached.from <= from.getTime() && cached.to >= to.getTime() && now.getTime() - cached.fetched.getTime() < StudyCalendarService.platformCacheLifetimeMs) {
      return { events: inRange(cached.events), error: cached.error, fetched: cached.fetched }
    }
    // una ventana amplia de una vez (cambiar de mes no vuelve a descargar)
    const wideFrom = Math.min(from.getTime(), now.getTime() - 62 * DAY)
    const wideTo = Math.max(to.getTime(), now.getTime() + 210 * DAY)
    const flightKey = `${key}|${wideFrom}|${wideTo}`
    let pending = inflight.get(flightKey)
    if (!pending) {
      const source = this.platforms
      pending = (async () => {
        try {
          const events = await source.events(new Date(wideFrom), new Date(wideTo))
          return { from: wideFrom, to: wideTo, events, fetched: this.now(), status: source.lastStatus?.() ?? [] }
        } catch (err) {
          return { failure: err instanceof Error ? err.message : String(err) }
        }
      })()
      inflight.set(flightKey, pending)
      void pending.finally(() => inflight.delete(flightKey))
    }
    const got = await pending
    if (!('failure' in got)) {
      platformCaches.set(key, got)
      return { events: inRange(got.events), fetched: got.fetched }
    }
    const old = platformCaches.get(key)
    // sin conexión: lo último que se leyó, con el aviso
    if (old) return { events: inRange(old.events), error: got.failure, fetched: old.fetched }
    return { events: [], error: got.failure, fetched: this.now() }
  }

  /** Vuelve a leer los calendarios de las plataformas (y las suscripciones) ahora. */
  async refreshFeeds(): Promise<CalendarRefreshResult> {
    const now = this.now()
    const [snap] = await Promise.all([
      this.platformEvents(new Date(now.getTime() - 62 * DAY), new Date(now.getTime() + 210 * DAY), true),
      this.subscriptions?.refreshAll?.().catch((err) => log.warn('Calendario: no se pudieron leer las suscripciones', err))
    ])
    this.changed('feeds')
    const out: CalendarRefreshResult = { feeds: this.platforms?.lastStatus?.() ?? [] }
    if (snap.fetched) out.fetchedAt = snap.fetched.toISOString()
    if (snap.error) out.platformError = snap.error
    return out
  }

  private platformTitle(id: string): string | undefined {
    return platformCaches.get(this.cacheKey)?.events.map(mapCampusEvent).find((e) => e.id === id)?.title ?? this.subscribedEvents().find((e) => mapCampusEvent(e).id === id)?.title
  }

  /** Los eventos de las suscripciones (de la copia guardada, sin red). */
  private subscribedEvents(from?: Date, to?: Date): CampusEvent[] {
    if (!this.subscriptions) return []
    const now = this.now()
    try {
      return this.subscriptions.events(from ?? new Date(now.getTime() - 200 * DAY), to ?? new Date(now.getTime() + 400 * DAY))
    } catch (err) {
      log.warn('Calendario: no se pudieron leer las suscripciones', err)
      return []
    }
  }

  // MARK: Cursos

  private courseExams(): CalendarEvent[] {
    if (!this.library) return []
    try {
      return courseExamEvents(this.library)
    } catch (err) {
      log.warn('Calendario: no se pudieron leer las fechas de los cursos', err)
      return []
    }
  }

  // MARK: Leer

  /** Tus eventos propios (todos, ordenados por fecha). */
  ownEvents(): CalendarEvent[] {
    return ownEventsSorted(this.store.read())
  }

  /** Todos los eventos entre `from` y `to` (plataformas + exámenes de tus cursos + propios), ordenados por fecha. */
  async events(from: Date, to: Date, refresh = false): Promise<CalendarSnapshot> {
    const file = this.store.read()
    const problem = this.store.problem
    const platform = await this.platformEvents(from, to, refresh)
    const feeds = mergeFeedEvents(platform.events, this.subscribedEvents(from, to))
    const events = mergeCalendar({ file, platform: feeds, courses: this.courseExams(), from, to, timeZone: this.tz })
    const snap: CalendarSnapshot = { events }
    if (platform.error) snap.platformError = platform.error
    if (problem) snap.fileProblem = problem
    if (platform.fetched) snap.fetchedAt = platform.fetched
    return snap
  }

  /** Exámenes y quizzes de los próximos `days` días (de plataformas, cursos y propios), del más cercano al más lejano. */
  async upcomingExams(days = 60, now: Date = this.now(), refresh = false): Promise<CalendarEvent[]> {
    const r = upcomingRange(days, now, this.tz)
    return upcomingAssessments((await this.events(r.from, r.to, refresh)).events, now, this.tz)
  }

  /** Busca por título, asignatura o notas (sin importar tildes ni mayúsculas). Por defecto, de hace un mes a dentro de un año. */
  async search(text: string, from?: Date, to?: Date): Promise<CalendarEvent[]> {
    const now = this.now()
    const all = (await this.events(from ?? new Date(now.getTime() - 31 * DAY), to ?? new Date(now.getTime() + 366 * DAY))).events
    return searchEvents(all, text)
  }

  /** Un evento por su id (busca en un año alrededor de hoy). */
  async event(id: string): Promise<CalendarEvent | null> {
    if (id.startsWith('own:')) return findOwnEvent(this.store.read(), id, this.core)
    if (id.startsWith('course:')) return this.courseExams().find((e) => e.id === id) ?? null
    const now = this.now()
    return (await this.events(new Date(now.getTime() - 200 * DAY), new Date(now.getTime() + 400 * DAY))).events.find((e) => e.id === id) ?? null
  }

  /** El evento propio (la serie) de un id. */
  ownSeries(id: string): CalendarEvent | null {
    const seriesID = splitOccurrence(id)?.[0] ?? id
    return this.store.read().events.find((e) => e.id === seriesID) ?? null
  }

  /** Las tareas (propias y entregas) entre dos fechas. `includeDone`: también las hechas. */
  async tasks(from: Date, to: Date, includeDone = false): Promise<CalendarEvent[]> {
    return (await this.events(from, to)).events.filter((e) => isTask(e) && (includeDone || !isDone(e)))
  }

  /** Los avisos que tocan entre `from` y `to` (para programar las notificaciones). */
  pendingReminders(from: Date, to: Date): CalendarReminder[] {
    return pendingReminders(this.store.read(), from, to, this.core)
  }

  /** El curso de Aula vinculado a un evento de plataforma (si lo hay). */
  packID(forEvent: string): string | undefined {
    return this.store.read().links[forEvent]
  }

  // MARK: Escribir

  /** Añade un evento propio. Devuelve el evento guardado (con su id `own:…`). */
  add(draft: CalendarEventDraft, author: CalendarAuthor = 'student'): CalendarEvent {
    const ev = this.store.modify((f) => addOwnEvent(f, draft, author, this.core))
    this.changed('events')
    return ev
  }

  /** Cambia un evento. Propios: cualquier campo (en una repetición, según `scope`; sin él, solo esa vez). Examen de un curso:
   *  fecha, título, notas y lugar. De una plataforma: error `read_only`. */
  update(id: string, patch: CalendarEventPatch, scope?: CalendarEditScope): CalendarEvent {
    if (id.startsWith('course:')) {
      if (!this.library) throw CalendarError.notFound(id)
      const ev = updateCourseExam(this.library, id.slice('course:'.length), patch)
      this.changed('course')
      return ev
    }
    if (!id.startsWith('own:')) throw CalendarError.readOnly(this.platformTitle(id) ?? id)
    const ev = this.store.modify((f) => (scope && splitOccurrence(id) ? updateOwnEventScoped(f, id, patch, scope, this.core) : updateOwnEvent(f, id, patch, this.core)))
    this.changed('events')
    return ev
  }

  /** Borra un evento propio (o la fecha del examen de un curso). Los de las plataformas no se pueden borrar. */
  delete(id: string, scope?: CalendarEditScope): void {
    if (id.startsWith('course:')) {
      if (!this.library) throw CalendarError.notFound(id)
      clearCourseExamDate(this.library, id.slice('course:'.length))
      this.changed('course')
      return
    }
    if (!id.startsWith('own:')) throw CalendarError.readOnly(this.platformTitle(id) ?? id)
    this.store.modify((f) => (scope && splitOccurrence(id) ? deleteOwnEventScoped(f, id, scope, this.core) : deleteOwnEvent(f, id, this.core)))
    this.changed('events')
  }

  /** Recuerda qué curso de Aula se creó para un examen del calendario (sin curso, lo olvida). */
  link(eventID: string, packID: string | null | undefined): void {
    if (eventID.startsWith('own:')) {
      this.update(eventID, packID ? { packID } : { clearPack: true })
      return
    }
    this.store.modify((f) => linkEvent(f, eventID, packID ?? undefined))
    this.changed('links')
  }

  /** Marca una tarea como hecha (o no): propia, una repetición de una propia, o una entrega de una plataforma o un curso. */
  setDone(id: string, done: boolean, at: Date = this.now()): boolean {
    const out = this.store.modify((f) => setTaskDone(f, id, done, at, this.core))
    this.changed('tasks')
    return out
  }

  /** Cambia una tarea de hecha a pendiente o al revés. Devuelve cómo queda. */
  toggleDone(id: string, at: Date = this.now()): boolean {
    const out = this.store.modify((f) => setTaskDone(f, id, !isTaskDoneIn(f, id, this.core), at, this.core))
    this.changed('tasks')
    return out
  }

  // MARK: Añadir rápido y exportar

  /** Entiende una frase («Prueba de inglés el lunes a las 10»). Con `commit`, la guarda como evento propio. */
  quickAdd(text: string, opts: { commit?: boolean; now?: Date; author?: CalendarAuthor } = {}): { parsed: QuickEventResult; event?: CalendarEvent } | null {
    const parsed = parseQuickEvent(text, { now: opts.now ?? this.now(), timeZone: this.tz })
    if (!parsed) return null
    if (!opts.commit) return { parsed }
    return { parsed, event: this.add(quickEventDraft(parsed), opts.author ?? 'student') }
  }

  /** Importa un .ics como eventos propios (una vez). Lo que ya se importó (mismo UID) no se repite. */
  importICS(data: string | Uint8Array): ICSImportSummary {
    const r = this.store.modify((f) => importICSInto(f, data, { now: this.now(), timeZone: this.tz }))
    if (r.added.length) this.changed('events')
    return r
  }

  /** El calendario en .ics: los propios (con sus repeticiones como reglas), los exámenes de los cursos y, si se pide, las
   *  fechas de las plataformas. */
  async exportICS(options: ICSWriterOptions = {}, now: Date = this.now()): Promise<string> {
    const file = this.store.read()
    const extra: CalendarEvent[] = []
    if (options.includeCourseExams ?? true) extra.push(...this.courseExams())
    if (options.includePlatformDates) {
      const snap = await this.events(new Date(now.getTime() - 62 * DAY), new Date(now.getTime() + 400 * DAY))
      extra.push(...snap.events.filter((e) => e.origin === 'platform'))
    }
    return writeICS(exportList(file, extra), { ...options, timeZone: this.tz }, now)
  }

  // MARK: Para la IA

  /** El calendario para el chat «Aula». */
  forAssistant(): AssistantCalendar {
    return makeAssistantCalendar(this, { timeZone: this.tz })
  }

  /** Las herramientas del calendario para la IA (las escrituras piden permiso con `approve`). */
  toolHandlers(opts: Omit<CalendarToolOptions, 'timeZone' | 'now'> = {}): CalendarToolHandlers {
    return makeCalendarToolHandlers(this, { ...opts, timeZone: this.tz, now: this.now })
  }
}
