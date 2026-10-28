// Lo puro del calendario de Aula (StudyCalendar.swift): añadir, cambiar y quitar eventos propios en un `CalendarFile` en
// memoria (también una repetición, esta y las siguientes o toda la serie), tareas hechas, avisos, vínculos examen → curso y
// la mezcla de las fechas de las plataformas, los exámenes de los cursos y los propios. El servicio del proceso principal
// pone el archivo, el cerrojo, las plataformas y los cursos.
import { IDs } from '@engine/base/ids'
import { addDays, localTimeZone, isSameDay, startOfDay } from '@engine/calendar/time'
import {
  CalendarError, CalendarMessages, chronologicalEvents, cleanText, cloneEvent, effectiveEnd, eventZone, isAssessment, isDone, isNamedTimeZone, isTask,
  kindFromCampus, kindTitle, makeCalendarEvent, normalizeCourse, prefixChars, type CalendarAuthor, type CalendarEditScope, type CalendarEvent,
  type CalendarEventDraft, type CalendarEventPatch, type CalendarFile, type CalendarOccurrenceOverride, type CalendarReminder, type CampusEvent
} from './model'
import { rulesEqual } from './rrule'
import {
  applyPatch, applyToSeries, cleanReminders, endFor, endSeries, expandEvent, instantForKey, keyInstantOr, newTask, occurrence, occurrenceKey,
  overrideIsEmpty, seriesOnlyChange, splitOccurrence, isOccurrence
} from './series'

/** Reloj, zona y generador de ids (inyectables en las pruebas). */
export interface CalendarCoreOptions {
  now?: () => Date
  /** Zona del sistema (la de los eventos sin zona propia). */
  timeZone?: string
  newID?: () => string
}

interface Ctx { now: () => Date; tz: string; newID: () => string }

function ctx(o: CalendarCoreOptions = {}): Ctx {
  return { now: o.now ?? (() => new Date()), tz: o.timeZone ?? localTimeZone(), newID: o.newID ?? (() => 'own:' + IDs.short(10)) }
}

function indexOf(f: CalendarFile, id: string): number {
  return f.events.findIndex((e) => e.id === id)
}

// MARK: - Añadir

/** Añade un evento propio. Devuelve el evento guardado (con su id `own:…`). */
export function addOwnEvent(f: CalendarFile, draft: CalendarEventDraft, author: CalendarAuthor = 'student', opts?: CalendarCoreOptions): CalendarEvent {
  const c = ctx(opts)
  const title = draft.title.trim()
  if (!title) throw CalendarError.invalid(CalendarMessages.missingTitle)
  if (draft.end && draft.end.getTime() < draft.start.getTime()) throw CalendarError.invalid(CalendarMessages.endBeforeStart)
  if (draft.recurrence?.until && draft.recurrence.until.getTime() < draft.start.getTime()) throw CalendarError.invalid(CalendarMessages.untilBeforeStart)
  const zone = draft.timeZone && isNamedTimeZone(draft.timeZone) ? draft.timeZone : draft.recurrence ? c.tz : undefined
  const now = c.now()
  const kind = draft.kind ?? 'event'
  const ev = makeCalendarEvent({
    id: c.newID(), title: prefixChars(title, 200), kind, start: draft.start, end: draft.end, allDay: draft.allDay ?? false,
    course: cleanText(draft.course), notes: cleanText(draft.notes), location: cleanText(draft.location), url: cleanText(draft.url), origin: 'own',
    packID: draft.packID, createdBy: author, created: now, updated: now, recurrence: draft.recurrence, timeZone: zone,
    reminders: cleanReminders(draft.reminders ?? []), task: draft.isTask || kind === 'assignment' ? newTask() : undefined
  })
  dropUndefined(ev)
  f.events.push(ev)
  return cloneEvent(ev)
}

function dropUndefined(e: CalendarEvent): void {
  for (const k of Object.keys(e) as (keyof CalendarEvent)[]) if (e[k] === undefined) delete e[k]
}

// MARK: - Cambiar

/** Cambia un evento propio (cualquier campo). Una repetición sola: solo esa (para más, `updateOwnEventScoped`). */
export function updateOwnEvent(f: CalendarFile, id: string, patch: CalendarEventPatch, opts?: CalendarCoreOptions): CalendarEvent {
  if (splitOccurrence(id)) return updateOwnEventScoped(f, id, patch, 'thisOccurrence', opts)
  const c = ctx(opts)
  const i = indexOf(f, id)
  if (i < 0) throw CalendarError.notFound(id)
  const e = cloneEvent(f.events[i])
  applyPatch(patch, e, c.tz)
  if (e.end && e.end.getTime() < e.start.getTime()) throw CalendarError.invalid(CalendarMessages.endBeforeStart)
  e.updated = c.now()
  dropUndefined(e)
  f.events[i] = e
  return cloneEvent(e)
}

/** Cambia una repetición: solo esa (`thisOccurrence`), esa y las siguientes (`thisAndFollowing`, parte la serie en dos) o
 *  todas (`allOccurrences`; si cambia el inicio, se mueve toda la serie lo mismo). */
export function updateOwnEventScoped(f: CalendarFile, id: string, patch: CalendarEventPatch, scope: CalendarEditScope, opts?: CalendarCoreOptions): CalendarEvent {
  const split = splitOccurrence(id)
  if (!split) return updateOwnEvent(f, id, patch, opts)
  const c = ctx(opts)
  const [seriesID, key] = split
  const i = indexOf(f, seriesID)
  if (i < 0) throw CalendarError.notFound(id)
  const e = cloneEvent(f.events[i])
  const current = occurrence(e, key, c.tz)
  if (!current) throw CalendarError.notFound(id)
  const zone = eventZone(e, c.tz)
  switch (scope) {
    case 'thisOccurrence': {
      // lo que es de toda la serie no puede cambiar en una sola vez (si llega igual que estaba, no es un cambio)
      const blocked = seriesOnlyChange(patch, e)
      if (blocked) throw CalendarError.invalid(CalendarMessages.seriesOnly(blocked))
      const o: CalendarOccurrenceOverride = { ...(e.overrides[key] ?? { cancelled: false }) }
      if (patch.start && (patch.start.getTime() !== current.start.getTime() || o.start !== undefined)) {
        o.start = patch.start
        if (patch.end === undefined && current.end) o.end = new Date(patch.start.getTime() + (current.end.getTime() - current.start.getTime()))
      }
      if (patch.end && (patch.end.getTime() !== current.end?.getTime() || o.end !== undefined)) o.end = patch.end
      if (patch.clearEnd === true && current.end) o.end = o.start ?? current.start
      // cada campo solo se guarda si es distinto del de la serie
      const t = cleanText(patch.title)
      if (t !== undefined) { const v = prefixChars(t, 200); o.title = v === e.title ? undefined : v }
      if (patch.notes !== undefined) { const v = cleanText(patch.notes); o.notes = v === e.notes ? undefined : v ?? '' }
      if (patch.location !== undefined) { const v = cleanText(patch.location); o.location = v === e.location ? undefined : v ?? '' }
      if (patch.kind !== undefined) o.kind = patch.kind === e.kind ? undefined : patch.kind
      if (patch.allDay !== undefined) o.allDay = patch.allDay === e.allDay ? undefined : patch.allDay
      if (patch.course !== undefined) { const v = cleanText(patch.course); o.course = v === e.course ? undefined : v ?? '' }
      if (patch.url !== undefined) { const v = cleanText(patch.url); o.url = v === e.url ? undefined : v ?? '' }
      for (const k of Object.keys(o) as (keyof CalendarOccurrenceOverride)[]) if (o[k] === undefined) delete o[k]
      if (o.end && o.end.getTime() < (o.start ?? current.start).getTime()) throw CalendarError.invalid(CalendarMessages.endBeforeStart)
      if (overrideIsEmpty(o)) delete e.overrides[key]
      else e.overrides[key] = o
      e.updated = c.now()
      f.events[i] = e
      return occurrence(e, key, c.tz) ?? current
    }
    case 'allOccurrences': {
      applyToSeries(patch, e, current, key, c.tz)
      e.updated = c.now()
      dropUndefined(e)
      f.events[i] = e
      return occurrence(e, occurrenceKey(e.start, eventZone(e, c.tz), e.allDay), c.tz) ?? cloneEvent(e)
    }
    case 'thisAndFollowing': {
      const original = instantForKey(key, zone)
      if (!original) throw CalendarError.notFound(id)
      if (original.getTime() <= e.start.getTime()) {
        applyToSeries(patch, e, current, current.occurrenceKey ?? occurrenceKey(e.start, zone, e.allDay), c.tz)
        e.updated = c.now()
        dropUndefined(e)
        f.events[i] = e
        return occurrence(e, occurrenceKey(e.start, eventZone(e, c.tz), e.allDay), c.tz) ?? cloneEvent(e)
      }
      const tail = cloneEvent(e)
      tail.id = c.newID()
      tail.start = original
      tail.end = endFor(e, original, c.tz)
      tail.created = c.now()
      // lo de las repeticiones de aquí en adelante pasa a la serie nueva
      const cut = original.getTime()
      tail.exceptions = e.exceptions.filter((x) => x.getTime() >= cut)
      e.exceptions = e.exceptions.filter((x) => x.getTime() < cut)
      const after = (k: string) => keyInstantOr(k, zone) >= cut
      tail.overrides = Object.fromEntries(Object.entries(e.overrides).filter(([k]) => after(k)))
      e.overrides = Object.fromEntries(Object.entries(e.overrides).filter(([k]) => !after(k)))
      if (e.task) {
        const done = e.task.doneOccurrences
        if (tail.task) tail.task.doneOccurrences = Object.fromEntries(Object.entries(done).filter(([k]) => after(k)))
        e.task.doneOccurrences = Object.fromEntries(Object.entries(done).filter(([k]) => !after(k)))
      }
      const rule = e.recurrence
      endSeries(e, original, tail, c.tz)
      const p: CalendarEventPatch = { ...patch }
      // la misma regla que ya tenía (la interfaz la manda siempre): la cola sigue con lo que le quedaba
      if (p.recurrence && rulesEqual(p.recurrence, rule)) delete p.recurrence
      // la cola parte del inicio ORIGINAL de esta repetición y solo se mueve si cambió la hora
      applyToSeries(p, tail, current, key, c.tz)
      const now = c.now()
      e.updated = now
      tail.updated = now
      dropUndefined(e)
      dropUndefined(tail)
      f.events[i] = e
      f.events.push(tail)
      return occurrence(tail, occurrenceKey(tail.start, eventZone(tail, c.tz), tail.allDay), c.tz) ?? cloneEvent(tail)
    }
  }
}

// MARK: - Quitar

/** Borra un evento propio (una repetición sola: solo esa). */
export function deleteOwnEvent(f: CalendarFile, id: string, opts?: CalendarCoreOptions): void {
  if (splitOccurrence(id)) { deleteOwnEventScoped(f, id, 'thisOccurrence', opts); return }
  const i = indexOf(f, id)
  if (i < 0) throw CalendarError.notFound(id)
  f.events = f.events.filter((e) => e.id !== id)
}

/** Quita una repetición (`thisOccurrence`), esa y las siguientes (`thisAndFollowing`) o todo el evento (`allOccurrences`). */
export function deleteOwnEventScoped(f: CalendarFile, id: string, scope: CalendarEditScope, opts?: CalendarCoreOptions): void {
  const split = splitOccurrence(id)
  if (!split) { deleteOwnEvent(f, id, opts); return }
  const c = ctx(opts)
  const [seriesID, key] = split
  const i = indexOf(f, seriesID)
  if (i < 0) throw CalendarError.notFound(id)
  const e = cloneEvent(f.events[i])
  const zone = eventZone(e, c.tz)
  const original = instantForKey(key, zone)
  if (!original || !isOccurrence(e, original, c.tz)) throw CalendarError.notFound(id)
  switch (scope) {
    case 'allOccurrences':
      f.events.splice(i, 1)
      return
    case 'thisOccurrence':
      if (!e.exceptions.some((x) => x.getTime() === original.getTime())) e.exceptions.push(original)
      delete e.overrides[key]
      e.updated = c.now()
      f.events[i] = e
      return
    case 'thisAndFollowing': {
      if (original.getTime() <= e.start.getTime()) { f.events.splice(i, 1); return }
      const unused = cloneEvent(e)
      endSeries(e, original, unused, c.tz)
      const cut = original.getTime()
      e.exceptions = e.exceptions.filter((x) => x.getTime() < cut)
      e.overrides = Object.fromEntries(Object.entries(e.overrides).filter(([k]) => keyInstantOr(k, zone) < cut))
      e.updated = c.now()
      f.events[i] = e
    }
  }
}

// MARK: - Tareas

/** Marca una tarea como hecha (o no): propia, una repetición de una propia, o una de una plataforma o un curso. */
export function setTaskDone(f: CalendarFile, id: string, done: boolean, at: Date, opts?: CalendarCoreOptions): boolean {
  const c = ctx(opts)
  const split = splitOccurrence(id)
  if (split) {
    const i = indexOf(f, split[0])
    if (i < 0 || !occurrence(f.events[i], split[1], c.tz)) throw CalendarError.notFound(id)
    const e = cloneEvent(f.events[i])
    const t = e.task ?? newTask()
    if (done) t.doneOccurrences[split[1]] = at
    else delete t.doneOccurrences[split[1]]
    e.task = t
    f.events[i] = e
    return done
  }
  if (id.startsWith('own:')) {
    const i = indexOf(f, id)
    if (i < 0) throw CalendarError.notFound(id)
    const e = cloneEvent(f.events[i])
    const t = e.task ?? newTask()
    t.done = done
    if (done) t.completedAt = at
    else delete t.completedAt
    e.task = t
    f.events[i] = e
    return done
  }
  // de una plataforma o de un curso: se apunta aparte (no se pueden cambiar)
  if (done) f.completed[id] = at
  else delete f.completed[id]
  return done
}

/** ¿Está hecha esa tarea ahora? (para «marcar / desmarcar» desde la interfaz) */
export function isTaskDoneIn(f: CalendarFile, id: string, opts?: CalendarCoreOptions): boolean {
  const c = ctx(opts)
  const split = splitOccurrence(id)
  if (split) {
    const e = f.events.find((x) => x.id === split[0])
    if (!e || !occurrence(e, split[1], c.tz)) throw CalendarError.notFound(id)
    return e.task?.doneOccurrences[split[1]] !== undefined
  }
  if (id.startsWith('own:')) {
    const e = f.events.find((x) => x.id === id)
    if (!e) throw CalendarError.notFound(id)
    return e.task?.done ?? false
  }
  return f.completed[id] !== undefined
}

/** Los avisos que tocan entre `from` y `to` (de los propios con avisos; nunca de una tarea hecha ni de una repetición quitada). */
export function pendingReminders(f: CalendarFile, from: Date, to: Date, opts?: CalendarCoreOptions): CalendarReminder[] {
  const c = ctx(opts)
  const out: CalendarReminder[] = []
  for (const e of f.events) {
    if (!e.reminders.length) continue
    const maxLead = Math.max(...e.reminders) * 60_000
    for (const i of expandEvent(e, from, new Date(to.getTime() + maxLead), c.tz)) {
      if (isTask(i) && isDone(i)) continue
      for (const m of e.reminders) {
        const fire = i.start.getTime() - m * 60_000
        if (fire < from.getTime() || fire > to.getTime()) continue
        out.push({ id: `${i.id}|${m}`, eventID: i.id, title: i.title, kind: i.kind, eventStart: i.start, fireAt: new Date(fire), minutesBefore: m })
      }
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}

// MARK: - Vínculos

/** Recuerda (o olvida, sin `packID`) qué curso de Aula se creó para un evento de plataforma. */
export function linkEvent(f: CalendarFile, eventID: string, packID: string | undefined): void {
  if (packID) f.links[eventID] = packID
  else delete f.links[eventID]
}

// MARK: - Leer

/** Una fecha de plataforma como evento del calendario. */
export function mapCampusEvent(e: CampusEvent): CalendarEvent {
  const ev = makeCalendarEvent({
    id: `platform:${e.platformID ?? 'ics'}:${e.id}`, title: e.title, kind: kindFromCampus(e.kind, e.isExam, e.title), start: e.start, end: e.end,
    allDay: e.allDay, course: e.course, notes: cleanText(e.details), location: cleanText(e.location), url: e.url, origin: 'platform',
    platformID: e.platformID, platformLabel: e.platformLabel, platformCourseID: e.courseID
  })
  dropUndefined(ev)
  return ev
}

/** ¿Es el examen de alguno de tus cursos? (mismo día y el curso o el título coinciden) */
export function guessPack(e: CalendarEvent, courses: CalendarEvent[], tz: string = localTimeZone()): string | undefined {
  if (!isAssessment(e)) return undefined
  const title = normalizeCourse(e.title), course = e.course ? normalizeCourse(e.course) : ''
  return courses.find((c) => {
    if (!isSameDay(c.start, e.start, tz)) return false
    const ct = normalizeCourse(c.title), cc = c.course ? normalizeCourse(c.course) : ''
    return (course !== '' && (cc === course || ct.includes(course))) || (title !== '' && (ct.includes(title) || title.includes(ct)))
  })?.packID
}

/** Todo junto entre `from` y `to`: las fechas de las plataformas (con su curso de Aula), los exámenes de los cursos que no
 *  salen ya como fecha de plataforma y los propios (repetición a repetición), ordenados. */
export function mergeCalendar(args: { file: CalendarFile; platform: CampusEvent[]; courses: CalendarEvent[]; from: Date; to: Date; timeZone?: string }): CalendarEvent[] {
  const { file, courses, from, to } = args
  const tz = args.timeZone ?? localTimeZone()
  const out: CalendarEvent[] = []
  const linked = new Set<string>()
  for (const p of args.platform) {
    const ev = mapCampusEvent(p)
    const pack = file.links[ev.id] ?? guessPack(ev, courses, tz)
    if (pack) { ev.packID = pack; linked.add(pack) }
    out.push(ev)
  }
  // el examen de un curso que ya sale como fecha de la plataforma no se repite
  for (const c of courses) {
    if (c.packID && linked.has(c.packID)) continue
    if (c.start.getTime() >= from.getTime() && c.start.getTime() <= to.getTime()) out.push(c)
  }
  for (const e of file.events) {
    for (const i of expandEvent(e, from, to, tz)) {
      if (effectiveEnd(i, tz).getTime() >= from.getTime() && i.start.getTime() <= to.getTime()) out.push(i.seriesID ? i : cloneEvent(i))
    }
  }
  // las entregas son tareas: las de las plataformas y los cursos se marcan en `completed`
  const marked = out.map((e) => {
    if (!isTask(e) || e.origin === 'own') return e
    const at = file.completed[e.id]
    return { ...e, task: { done: at !== undefined, doneOccurrences: {}, ...(at ? { completedAt: at } : {}) } }
  })
  return marked.sort(chronologicalEvents)
}

/** Exámenes y quizzes que aún no pasaron (los de hoy cuentan con 2 h de margen; los de todo el día, el día entero). */
export function upcomingAssessments(events: CalendarEvent[], now: Date, tz: string = localTimeZone()): CalendarEvent[] {
  return events.filter((e) => isAssessment(e) && (e.allDay ? effectiveEnd(e, tz).getTime() > now.getTime() : e.start.getTime() + 2 * 3_600_000 > now.getTime()))
}

/** El intervalo de `upcomingAssessments`: de hoy a dentro de `days` días. */
export function upcomingRange(days: number, now: Date, tz: string = localTimeZone()): { from: Date; to: Date } {
  return { from: startOfDay(now, tz), to: new Date(now.getTime() + Math.max(1, days) * 86_400_000) }
}

/** Busca por título, asignatura, notas o tipo (sin importar tildes ni mayúsculas): todas las palabras deben estar. */
export function searchEvents(events: CalendarEvent[], text: string): CalendarEvent[] {
  const q = normalizeCourse(text)
  if (!q) return []
  const words = q.split(' ')
  return events.filter((e) => {
    const hay = normalizeCourse([e.title, e.course ?? '', e.notes ?? '', kindTitle(e.kind, 'es'), kindTitle(e.kind, 'en')].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

/** Un evento propio (o una de sus repeticiones) por su id. */
export function findOwnEvent(f: CalendarFile, id: string, opts?: CalendarCoreOptions): CalendarEvent | null {
  const c = ctx(opts)
  const split = splitOccurrence(id)
  if (split) {
    const e = f.events.find((x) => x.id === split[0])
    return e ? occurrence(e, split[1], c.tz) : null
  }
  const e = f.events.find((x) => x.id === id)
  return e ? cloneEvent(e) : null
}

/** Los propios ordenados por fecha. */
export function ownEventsSorted(f: CalendarFile): CalendarEvent[] {
  return [...f.events].sort((a, b) => a.start.getTime() - b.start.getTime()).map(cloneEvent)
}

/** La lista para exportar: los propios (con su regla), los exámenes de los cursos y, si se pide, las fechas de plataforma;
 *  las tareas de plataformas y cursos llevan si están hechas. */
export function exportList(f: CalendarFile, extra: CalendarEvent[]): CalendarEvent[] {
  return [...f.events.map(cloneEvent), ...extra].map((e) => {
    if (e.origin === 'own' || !isTask(e)) return e
    const at = f.completed[e.id]
    return { ...e, task: { done: at !== undefined, doneOccurrences: {}, ...(at ? { completedAt: at } : {}) } }
  })
}

/** El fin de una ventana de días desde un instante (atajo). */
export function daysAfter(d: Date, n: number, tz: string = localTimeZone()): Date {
  return addDays(d, n, tz)
}
