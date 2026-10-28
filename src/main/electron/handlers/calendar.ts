// IPC del calendario: lista, añade, cambia y borra eventos (con alcance en las series), «Añadir rápido», tareas, vínculos,
// lectura de los calendarios de las plataformas, suscripciones a calendarios .ics (con su lectura periódica), importar un
// .ics (con el diálogo de abrir) y exportar a .ics (con el diálogo de guardar). Valida los argumentos.
import { app, BrowserWindow, dialog, type WebContents } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { CALENDAR_EDIT_SCOPES, isSubscriptionID, type CalendarEditScope, type CalendarExportOptions, type CalendarImportResult } from '@shared/calendar'
import { calendarLanguage, draftFromInput, patchFromInput, quickSummary, toEventView, toReminderView, toSnapshotView, type ViewOptions } from '@engine/calendar'
import { looksLikeCalendar } from '@engine/calendar/ics'
import {
  announceCalendarChange, calendarService, calendarSubscriptions, ICS_MAX_BYTES, onCalendarChange, startSubscriptionRefresh, toCalendarAulaError,
  watchCalendarFile
} from '@main/services/calendar'
import { AulaError, invalidArgs } from '@main/services/errors'
import { log } from '@main/services/log'
import { writeFileAtomic } from '@main/services/fs'
import { getSettings, onSettingsChange } from '@main/services/settings'
import { emit, handle } from '../rpc'
import { tr } from '@shared/ai/i18n'

const MAX_RANGE_MS = 800 * 86_400_000

function viewOptions(): ViewOptions {
  const lang = getSettings().general.language
  return { language: calendarLanguage(lang === 'system' ? app.getLocale() : lang), timeZone: calendarService().timeZone }
}

// Nombre de cada dato en los mensajes de validación: en inglés y si es femenino en español («no válida»)
const FIELDS: Record<string, { en: string; fem?: boolean }> = {
  Borrado: { en: 'deletion' }, Búsqueda: { en: 'search', fem: true }, Cambio: { en: 'change' }, Consulta: { en: 'query', fem: true },
  Curso: { en: 'course' }, Enlace: { en: 'link' }, Evento: { en: 'event' }, 'Fecha de fin': { en: 'end date', fem: true },
  'Fecha de inicio': { en: 'start date', fem: true }, Frase: { en: 'phrase', fem: true }, Id: { en: 'id' }, Nombre: { en: 'name' },
  Repetición: { en: 'occurrence', fem: true }, Suscripción: { en: 'subscription', fem: true }, Tarea: { en: 'task', fem: true },
  Vínculo: { en: 'link' }
}

function invalidField(what: string): AulaError {
  const f = FIELDS[what]
  return invalidArgs(tr(`${what} no ${f?.fem ? 'válida' : 'válido'}`, `Invalid ${f?.en ?? what.toLowerCase()}`))
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalidField(what)
  return v as Record<string, unknown>
}

function text(v: unknown, what: string, max = 2000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw invalidField(what)
  return v
}

function optText(v: unknown, what: string, max = 2000): string | undefined {
  return v === undefined || v === null ? undefined : text(v, what, max)
}

function date(v: unknown, what: string): Date {
  const d = typeof v === 'string' ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) throw invalidField(what)
  return d
}

function range(a: Record<string, unknown>): { from: Date; to: Date } {
  const from = date(a.from, 'Fecha de inicio'), to = date(a.to, 'Fecha de fin')
  if (to.getTime() < from.getTime() || to.getTime() - from.getTime() > MAX_RANGE_MS) throw invalidArgs(tr('Intervalo de fechas no válido', 'Invalid date range'))
  return { from, to }
}

function scopeOf(v: unknown): CalendarEditScope | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !(CALENDAR_EDIT_SCOPES as readonly string[]).includes(v)) throw invalidArgs(tr('Alcance no válido', 'Invalid scope'))
  return v as CalendarEditScope
}

function subscriptionID(v: unknown): string {
  if (typeof v !== 'string' || v.length > 64 || !isSubscriptionID(v)) throw invalidArgs(tr('Suscripción no válida', 'Invalid subscription'))
  return v
}

/** La ventana desde la que se pidió (para que el diálogo salga encima). */
function windowOf(sender: WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(sender) ?? undefined
}

/** Elige un .ics con el diálogo de abrir y lo importa como eventos propios. */
async function importFromDialog(sender: WebContents): Promise<CalendarImportResult | null> {
  const win = windowOf(sender)
  const open = { title: tr('Importar un calendario', 'Import a calendar'), properties: ['openFile' as const], filters: [{ name: 'iCalendar', extensions: ['ics', 'ical', 'ifb', 'icalendar'] }] }
  const res = win ? await dialog.showOpenDialog(win, open) : await dialog.showOpenDialog(open)
  const path = res.canceled ? undefined : res.filePaths[0]
  if (!path) return null
  if ((await stat(path)).size > ICS_MAX_BYTES) throw new AulaError('too_large', tr(`El archivo pesa demasiado (más de ${Math.round(ICS_MAX_BYTES / 1_048_576)} MB).`, `The file is too big (over ${Math.round(ICS_MAX_BYTES / 1_048_576)} MB).`))
  const data = new Uint8Array(await readFile(path))
  if (!looksLikeCalendar(data)) throw new AulaError('not_a_calendar', tr('Ese archivo no es un calendario .ics.', 'That file isn’t an .ics calendar.'))
  const r = calendarService().importICS(data)
  const out: CalendarImportResult = { added: r.added.length, recurring: r.recurring, skipped: r.skipped, fileName: basename(path) }
  const first = r.added.reduce<Date | null>((min, e) => (!min || e.start.getTime() < min.getTime() ? e.start : min), null)
  if (first) out.firstStart = first.toISOString()
  return out
}

/** Ejecuta y traduce los errores del calendario a `AulaError`. */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toCalendarAulaError(err)
  }
}

export function register(): void {
  handle('calendar.list', (args) => guard(async () => {
    const a = obj(args, 'Consulta')
    const { from, to } = range(a)
    const snap = await calendarService().events(from, to, a.refresh === true)
    const opts = viewOptions()
    return snap.events.map((e) => toEventView(e, opts))
  }))

  handle('calendar.snapshot', (args) => guard(async () => {
    const a = obj(args, 'Consulta')
    const { from, to } = range(a)
    return toSnapshotView(await calendarService().events(from, to, a.refresh === true), viewOptions())
  }))

  handle('calendar.get', (args) => guard(async () => {
    const id = text(obj(args, 'Consulta').id, 'Id', 600)
    const e = await calendarService().event(id)
    return e ? toEventView(e, viewOptions()) : null
  }))

  handle('calendar.search', (args) => guard(async () => {
    const a = obj(args, 'Búsqueda')
    const query = text(a.query, 'Búsqueda', 500)
    const from = a.from !== undefined ? date(a.from, 'Fecha de inicio') : undefined
    const to = a.to !== undefined ? date(a.to, 'Fecha de fin') : undefined
    const opts = viewOptions()
    return (await calendarService().search(query, from, to)).map((e) => toEventView(e, opts))
  }))

  handle('calendar.upcomingExams', (args) => guard(async () => {
    const a = args === undefined || args === null ? {} : obj(args, 'Consulta')
    const days = typeof a.days === 'number' && Number.isFinite(a.days) ? Math.min(365, Math.max(1, Math.trunc(a.days))) : 60
    const opts = viewOptions()
    return (await calendarService().upcomingExams(days)).map((e) => toEventView(e, opts))
  }))

  handle('calendar.add', (args) => guard(() => {
    const s = calendarService()
    return toEventView(s.add(draftFromInput(obj(args, 'Evento'), s.timeZone), 'student'), viewOptions())
  }))

  handle('calendar.update', (args) => guard(() => {
    const a = obj(args, 'Cambio')
    const s = calendarService()
    const id = text(a.id, 'Id', 600)
    return toEventView(s.update(id, patchFromInput(obj(a.patch, 'Cambio'), s.timeZone), scopeOf(a.scope)), viewOptions())
  }))

  handle('calendar.delete', (args) => guard(() => {
    const a = obj(args, 'Borrado')
    calendarService().delete(text(a.id, 'Id', 600), scopeOf(a.scope))
  }))

  handle('calendar.quickAdd', (args) => guard(() => {
    const a = obj(args, 'Frase')
    if (typeof a.text !== 'string' || a.text.length > 500) throw invalidArgs(tr('Frase no válida', 'Invalid phrase'))
    const r = calendarService().quickAdd(a.text, { commit: a.commit === true })
    if (!r) return null
    const opts = viewOptions()
    const summary = quickSummary(r.parsed, opts.language)
    if (r.event) return { summary, hasDate: r.parsed.hasDate, event: toEventView(r.event, opts) }
    // vista previa: lo entendido como un evento propio sin guardar (sin id)
    const { hasDate: _hasDate, timeZone, ...parsed } = r.parsed
    const preview = { ...parsed, id: '', exceptions: [], overrides: {}, reminders: [], origin: 'own' as const, ...(parsed.recurrence ? { timeZone } : {}) }
    return { summary, hasDate: r.parsed.hasDate, event: toEventView(preview, opts) }
  }))

  handle('calendar.toggleTask', (args) => guard(() => {
    const a = obj(args, 'Tarea')
    const id = text(a.id, 'Id', 600)
    const occurrence = optText(a.occurrence, 'Repetición', 40)
    const full = occurrence ? `${id}#${occurrence}` : id
    const s = calendarService()
    const done = typeof a.done === 'boolean' ? s.setDone(full, a.done) : s.toggleDone(full)
    return { done }
  }))

  handle('calendar.link', (args) => guard(() => {
    const a = obj(args, 'Vínculo')
    const packID = a.packID === null || a.packID === undefined ? null : text(a.packID, 'Curso', 200)
    calendarService().link(text(a.eventID, 'Id', 600), packID)
  }))

  handle('calendar.refreshFeeds', () => guard(() => calendarService().refreshFeeds()))

  handle('calendar.exportICS', (args, ctx) => guard(async () => {
    const a = args && typeof args === 'object' ? (args as CalendarExportOptions) : {}
    const options: CalendarExportOptions = {
      calendarName: typeof a.calendarName === 'string' && a.calendarName.trim() ? a.calendarName.slice(0, 120) : 'Aula',
      includeCourseExams: a.includeCourseExams !== false,
      includePlatformDates: a.includePlatformDates === true,
      alarms: a.alarms !== false
    }
    const win = windowOf(ctx.sender)
    const save = { title: tr('Exportar el calendario', 'Export the calendar'), defaultPath: join(app.getPath('documents'), 'Aula.ics'), filters: [{ name: 'iCalendar', extensions: ['ics'] }] }
    const res = win ? await dialog.showSaveDialog(win, save) : await dialog.showSaveDialog(save)
    if (res.canceled || !res.filePath) return { saved: false }
    const ics = await calendarService().exportICS(options)
    const path = res.filePath.toLowerCase().endsWith('.ics') ? res.filePath : res.filePath + '.ics'
    writeFileAtomic(path, ics)
    return { saved: true, path }
  }))

  // suscripciones (los enlaces no salen nunca del proceso principal)
  handle('calendar.subscriptions', () => guard(() => calendarSubscriptions().list()))

  handle('calendar.subscribe', (args) => guard(async () => {
    const a = obj(args, 'Suscripción')
    const v = await calendarSubscriptions().add({ url: text(a.url, 'Enlace', 4000), name: optText(a.name, 'Nombre', 200) })
    announceCalendarChange({ reason: 'subscriptions' })
    return v
  }))

  handle('calendar.renameSubscription', (args) => guard(() => {
    const a = obj(args, 'Suscripción')
    const v = calendarSubscriptions().rename(subscriptionID(a.id), text(a.name, 'Nombre', 200))
    announceCalendarChange({ reason: 'subscriptions' })
    return v
  }))

  handle('calendar.unsubscribe', (args) => guard(() => {
    calendarSubscriptions().remove(subscriptionID(obj(args, 'Suscripción').id))
    announceCalendarChange({ reason: 'subscriptions' })
  }))

  handle('calendar.refreshSubscription', (args) => guard(async () => {
    const v = await calendarSubscriptions().refresh(subscriptionID(obj(args, 'Suscripción').id))
    announceCalendarChange({ reason: 'subscriptions' })
    return v
  }))

  handle('calendar.importICS', (_args, ctx) => guard(() => importFromDialog(ctx.sender)))

  handle('calendar.reminders', (args) => guard(() => {
    const { from, to } = range(obj(args, 'Consulta'))
    return calendarService().pendingReminders(from, to).map(toReminderView)
  }))

  // avisos a la interfaz: cambios de este proceso, de otros (el ayudante MCP) y de las cuentas con calendario
  onCalendarChange((c) => emit('calendar.changed', c))
  try {
    watchCalendarFile(calendarService())
  } catch (err) {
    log.warn('Calendario: no se puede vigilar calendar.json', err)
  }
  // las suscripciones se vuelven a leer solas (cada cuarto de hora, las que lleven una hora sin leerse)
  startSubscriptionRefresh(calendarSubscriptions(), { onRefreshed: () => announceCalendarChange({ reason: 'subscriptions' }) })
  onSettingsChange((next, prev) => {
    const key = (s: typeof next) => s.platforms.accounts.map((x) => `${x.id}|${x.label}|${x.calendarSecretRef ?? ''}`).join(',')
    if (key(next) === key(prev)) return
    calendarService().invalidatePlatformCache()
    emit('calendar.changed', { reason: 'feeds' })
  })
}
