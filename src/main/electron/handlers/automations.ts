// IPC de las automatizaciones, «Aula siempre activa» y la bandeja «Novedades». La lógica vive en
// src/main/services/automations; aquí se validan los argumentos (estrictos: nada sin comprobar llega al centro) y se avisa a la
// interfaz con 'automations.changed' y 'automations.inboxChanged'.
import {
  AUTOMATION_CAPABILITIES, NOTIFY_POLICIES, PROACTIVE_STYLE_PRESETS, SCHEDULE_KINDS, parseTime, AutomationPlanner, scheduleIsValid,
  type AutomationDraft, type AutomationSchedule, type ProactiveSettings
} from '@shared/automations'
import { localTimeZone } from '@engine/calendar/time'
import type { CalendarEventKind } from '@shared/calendar'
import { AutomationLimitError, automationCenter } from '@main/services/automations'
import { AulaError, invalidArgs } from '@main/services/errors'
import { emit, handle } from '../rpc'
import { tr } from '@shared/ai/i18n'

type Obj = Record<string, unknown>

function obj(v: unknown, what = 'Argumentos'): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalidArgs(`${what} no válidos`)
  return v as Obj
}

function text(v: unknown, what: string, max: number, allowEmpty = true): string {
  if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim())) throw invalidArgs(`«${what}» no es válido`)
  return v
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw invalidArgs(`«${what}» debe ser sí o no`)
  return v
}

function int(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw invalidArgs(`«${what}» debe estar entre ${lo} y ${hi}`)
  return v
}

function num(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw invalidArgs(`«${what}» debe estar entre ${lo} y ${hi}`)
  return v
}

function time(v: unknown, what: string): string {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw invalidArgs(`«${what}» debe ser una hora HH:mm`)
  return parseTime(v)!
}

function isoDate(v: unknown, what: string): string {
  const t = typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN
  if (Number.isNaN(t)) throw invalidArgs(`«${what}» no es una fecha válida`)
  return new Date(t).toISOString()
}

function oneOf<T extends string>(v: unknown, what: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw invalidArgs(`«${what}» no es válido`)
  return v as T
}

function list<T>(v: unknown, what: string, max: number, item: (x: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) throw invalidArgs(`«${what}» no es válido`)
  return v.map(item)
}

function ids(v: unknown): string[] {
  return list(v, 'ids', 2000, (x) => text(x, 'id', 200, false))
}

const EVENT_KINDS: readonly CalendarEventKind[] = ['assignment', 'exam', 'quiz']

function schedule(v: unknown): AutomationSchedule {
  const o = obj(v, 'Horario')
  const s: AutomationSchedule = {
    kind: oneOf(o.kind, 'tipo de horario', SCHEDULE_KINDS),
    times: o.times === undefined ? [] : [...new Set(list(o.times, 'horas', 12, (x) => time(x, 'hora')))],
    weekdays: o.weekdays === undefined ? [] : [...new Set(list(o.weekdays, 'días', 7, (x) => int(x, 'día', 1, 7)))].sort((a, b) => a - b),
    everyHours: o.everyHours === undefined ? 8 : num(o.everyHours, 'cada cuántas horas', 1, 24),
    windowStart: o.windowStart === undefined ? '08:00' : time(o.windowStart, 'desde'),
    windowEnd: o.windowEnd === undefined ? '22:00' : time(o.windowEnd, 'hasta'),
    hoursBefore: o.hoursBefore === undefined ? [] : [...new Set(list(o.hoursBefore, 'horas antes', 10, (x) => num(x, 'horas antes', 0.25, 24 * 14)))],
    eventKinds: o.eventKinds === undefined ? [] : [...new Set(list(o.eventKinds, 'eventos', 3, (x) => oneOf(x, 'evento', EVENT_KINDS)))]
  }
  if (o.date !== undefined && o.date !== null) s.date = isoDate(o.date, 'fecha')
  if (!scheduleIsValid(s)) throw invalidArgs(tr('El horario no está completo: falta la hora, la fecha o la antelación.', 'The schedule is incomplete: the time, the date or how far ahead is missing.'))
  return s
}

function draft(v: unknown): AutomationDraft {
  const o = obj(v, 'Automatización')
  const d: AutomationDraft = {
    title: text(o.title ?? '', 'nombre', 200),
    instruction: text(o.instruction ?? '', 'instrucción', 4000),
    schedule: schedule(o.schedule),
    capabilities: [...new Set(list(o.capabilities ?? [], 'qué mira', 5, (x) => oneOf(x, 'qué mira', AUTOMATION_CAPABILITIES)))],
    notify: oneOf(o.notify ?? 'news', 'avisos', NOTIFY_POLICIES),
    untilFound: o.untilFound === undefined ? false : bool(o.untilFound, 'hasta encontrarlo')
  }
  if (!d.title.trim() && !d.instruction.trim()) throw invalidArgs(tr('Escribe qué tiene que hacer Aula.', 'Write what Aula should do.'))
  if (o.id !== undefined && o.id !== null) d.id = text(o.id, 'id', 200, false)
  if (o.maxRuns !== undefined) d.maxRuns = o.maxRuns === null ? null : int(o.maxRuns, 'veces', 1, 500)
  if (o.expiresAt !== undefined) d.expiresAt = o.expiresAt === null ? null : isoDate(o.expiresAt, 'hasta')
  if (o.enabled !== undefined) d.enabled = bool(o.enabled, 'activa')
  if (o.courseID !== undefined) d.courseID = o.courseID === null ? null : text(o.courseID, 'curso', 200, false)
  if (o.platformIDs !== undefined) d.platformIDs = list(o.platformIDs, 'plataformas', 20, (x) => text(x, 'plataforma', 200, false))
  return d
}

type Checker = (v: unknown, k: string) => unknown
const BOOL: Checker = (v, k) => bool(v, k)
const TIME: Checker = (v, k) => time(v, k)

/** Lo que la interfaz puede cambiar de «Aula siempre activa» (la pausa va por 'automations.pause'). */
const PROACTIVE_FIELDS: Record<string, Checker> = {
  enabled: BOOL, morningBrief: BOOL, platformCheck: BOOL, deadlineReminders: BOOL, examOffers: BOOL, weeklySummary: BOOL, followups: BOOL, notifications: BOOL, dockBadge: BOOL,
  morningTime: TIME, platformCheckTime: TIME, weeklyTime: TIME,
  platformCheckDays: (v, k) => [...new Set(list(v, k, 7, (x) => int(x, k, 1, 7)))].sort((a, b) => a - b),
  reminderHours: (v, k) => [...new Set(list(v, k, 8, (x) => num(x, k, 0.25, 24 * 14)))].sort((a, b) => b - a),
  examOfferDays: (v, k) => int(v, k, 3, 60),
  weeklyDay: (v, k) => int(v, k, 1, 7),
  maxFollowupsPerDay: (v, k) => int(v, k, 0, 20),
  noticesPerHour: (v, k) => int(v, k, 1, 20),
  dailyTokenLimit: (v, k) => int(v, k, 10_000, 5_000_000),
  style: (v, k) => oneOf(v, k, [...PROACTIVE_STYLE_PRESETS, 'custom'] as const),
  quiet: (v, k) => {
    const q = obj(v, k)
    return { enabled: bool(q.enabled, `${k}.enabled`), from: time(q.from, `${k}.from`), to: time(q.to, `${k}.to`) }
  }
}

function proactivePatch(v: unknown): Partial<ProactiveSettings> {
  const o = obj(v, 'Cambio')
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(o)) {
    const check = PROACTIVE_FIELDS[k]
    if (!check) throw invalidArgs(`«${k}» no se puede cambiar aquí`)
    out[k] = check(x, k)
  }
  return out as Partial<ProactiveSettings>
}

/** Los errores de límite («ya tienes 40») llegan a la interfaz con su texto. */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AutomationLimitError) throw new AulaError('automation_limit', err.message)
    throw err
  }
}

const MAX_SNOOZE = 60 * 86_400_000

export function register(): void {
  const center = automationCenter()
  let lastUnread = -1
  center.onChange((reason) => {
    emit('automations.changed', { reason })
    const unread = center.unread()
    if (unread !== lastUnread || reason === 'inbox') {
      lastUnread = unread
      emit('automations.inboxChanged', { unread })
    }
  })

  handle('automations.snapshot', () => center.snapshot())
  handle('automations.inbox', () => {
    const focus = center.pendingFocus
    center.pendingFocus = undefined
    return { entries: center.inboxEntries(), unread: center.unread(), ...(focus ? { focus } : {}) }
  })
  handle('automations.inboxCount', () => ({ unread: center.unread() }))
  handle('automations.markRead', (args) => {
    const a = obj(args)
    return { changed: center.markRead(ids(a.ids), a.read === undefined ? true : bool(a.read, 'leída')) }
  })
  handle('automations.markAllRead', (args) => {
    const a = args === undefined || args === null ? {} : obj(args)
    return { changed: center.markAllRead(a.filter === undefined ? 'all' : oneOf(a.filter, 'filtro', ['all', 'unread', 'platform', 'dates', 'summaries', 'aula'] as const)) }
  })
  handle('automations.archive', (args) => {
    const a = obj(args)
    return { changed: center.archive(ids(a.ids), a.archived === undefined ? true : bool(a.archived, 'archivada')) }
  })
  handle('automations.archiveRead', () => ({ changed: center.archiveRead() }))
  handle('automations.snooze', (args) => {
    const a = obj(args)
    if (a.until === null) return { changed: center.snooze(ids(a.ids), null) }
    const until = Date.parse(isoDate(a.until, 'hasta'))
    if (until <= Date.now() || until > Date.now() + MAX_SNOOZE) throw invalidArgs(tr('Elige una hora futura (como mucho dentro de 60 días).', 'Pick a future time (at most 60 days ahead).'))
    return { changed: center.snooze(ids(a.ids), until) }
  })
  handle('automations.runs', (args) => {
    const a = obj(args)
    if (a.id === undefined || a.id === null) return center.store.recentRuns(a.limit === undefined ? 30 : int(a.limit, 'límite', 1, 100))
    return center.runs(text(a.id, 'id', 200, false))
  })
  handle('automations.save', (args) => guard(async () => {
    const d = draft(obj(args).automation)
    if (d.id) {
      const existing = center.automations().find((x) => x.id === d.id)
      if (!existing) throw invalidArgs(tr('No encuentro esa automatización.', 'I can’t find that automation.'))
      if (existing.routine) throw invalidArgs(tr('Las rutinas se ajustan en «Aula siempre activa».', 'Routines are set in “Aula always on”.'))
    }
    return center.save(d)
  }))
  handle('automations.setEnabled', (args) => guard(() => {
    const a = obj(args)
    return center.setEnabled(text(a.id, 'id', 200, false), bool(a.enabled, 'activa'))
  }))
  handle('automations.remove', (args) => guard(() => center.remove(text(obj(args).id, 'id', 200, false))))
  handle('automations.runNow', (args) => ({ started: center.runNow(text(obj(args).id, 'id', 200, false)) }))
  handle('automations.setProactive', (args) => guard(async () => {
    await center.patchProactive(proactivePatch(obj(args).patch))
    return center.snapshot()
  }))
  handle('automations.pause', (args) => guard(async () => {
    const a = obj(args)
    if (a.until === null) await center.pause(null)
    else {
      const until = Date.parse(isoDate(a.until, 'hasta'))
      if (until <= Date.now() || until > Date.now() + 3660 * 86_400_000) throw invalidArgs(tr('Fecha de pausa no válida.', 'Invalid pause date.'))
      await center.pause(until)
    }
    return center.snapshot()
  }))
  handle('automations.nextRun', (args) => {
    const s = schedule(obj(args).schedule)
    const n = new AutomationPlanner(localTimeZone()).next(s, Date.now())
    return { next: n ? new Date(n.at).toISOString() : null }
  })
  handle('automations.dismissOffer', (args) => {
    const a = obj(args)
    center.dismissOffer(text(a.eventID, 'evento', 600, false), a.entryID === undefined ? undefined : text(a.entryID, 'entrada', 200, false))
  })
}
