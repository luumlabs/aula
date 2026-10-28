// Planificador (AutomationPlanner.swift). Puro: calcula horas, no ejecuta nada.
//
// Cada hora que toca es un «hueco» con una clave estable. El centro guarda hasta dónde revisó el horario de cada automatización
// (`state.lastChecked`); en cada vuelta mira los huecos que pasaron desde entonces y decide:
//   · a su hora (≤ 90 s tarde) → se ejecuta;
//   · tarde, pero aún con sentido (el ordenador dormía o la app estaba cerrada) → se recupera UNA vez;
//   · demasiado tarde → se salta y queda anotado;
//   · en horas de silencio (solo la IA y las rutinas) → se aplaza al final del silencio;
//   · un reintento o un aplazamiento pendientes que ya tocan → se ejecutan.
// Los avisos antes de eventos son un hueco por evento y antelación («event:<id>@<min>m:<inicio>»).
import { makeInstant, wallTime, civilFromDays, weekdayOfEpochDay, settingTime } from '@engine/calendar/time'
import type { Automation, AutomationSchedule, AutomationState, AutomationTrigger, QuietHours } from './types'
import { quietContains, quietEnd, timeMinutes } from './time'

/** Lo mínimo de un evento del calendario que necesita el planificador (lo cumple `CalendarEvent`). */
export interface PlannerEvent {
  id: string
  title: string
  kind: string
  start: Date
  allDay: boolean
}

/** Una hora en que toca una automatización (instantes en ms). */
export interface AutomationSlot {
  at: number
  /** «2026-10-12T20:00» o «event:<id>@1440m:<inicio>». */
  key: string
  eventID?: string
  eventTitle?: string
  eventStart?: number
  hoursBefore?: number
}

export type PlannerAction =
  | { type: 'none' }
  | { type: 'run'; trigger: AutomationTrigger; slots: AutomationSlot[] }
  | { type: 'defer'; until: number; slot: AutomationSlot }

export interface PlannerDecision {
  action: PlannerAction
  /** Huecos que se saltan por llegar demasiado tarde. */
  missed: AutomationSlot[]
  /** Claves de eventos que ya no hay que mirar. */
  expiredKeys: string[]
}

const HOUR = 3_600_000
const DAY = 86_400_000
const NONE: PlannerDecision = { action: { type: 'none' }, missed: [], expiredKeys: [] }

const iso = (v: string | undefined): number | undefined => {
  if (!v) return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

/** Tipos de evento que cuenta `beforeEvents` (vacío = entregas, exámenes y pruebas). */
export function effectiveEventKinds(s: AutomationSchedule): Set<string> {
  return new Set(s.eventKinds.length ? s.eventKinds : ['assignment', 'exam', 'quiz'])
}

/** Intervalo efectivo (nunca menos de 1 h: cuida el gasto de IA y la plataforma). */
export function effectiveInterval(s: AutomationSchedule): number {
  return Math.max(1, Number.isFinite(s.everyHours) ? s.everyHours : 8)
}

/** ¿Tiene lo mínimo para funcionar? */
export function scheduleIsValid(s: AutomationSchedule): boolean {
  switch (s.kind) {
    case 'daily': return s.times.length > 0
    case 'interval': return Number.isFinite(s.everyHours) && s.everyHours > 0
    case 'once': return iso(s.date) !== undefined
    case 'beforeEvents': return s.hoursBefore.some((h) => h > 0)
  }
}

/** La IA y las rutinas no hacen nada en las horas de silencio; lo que programa el estudiante a una hora, sí. */
export function respectsQuietHours(a: Automation): boolean {
  return a.origin !== 'student'
}

export class AutomationPlanner {
  /** Margen para contar como «a su hora». */
  readonly onTimeGrace: number

  constructor(readonly tz: string, onTimeGraceMs = 90_000) {
    this.onTimeGrace = onTimeGraceMs
  }

  // MARK: Huecos

  /** Los huecos en (from, to], en orden (como mucho `limit`). */
  slots(s: AutomationSchedule, from: number, to: number, events: readonly PlannerEvent[] = [], limit = 200): AutomationSlot[] {
    if (!(to > from)) return []
    let out: AutomationSlot[] = []
    switch (s.kind) {
      case 'daily':
      case 'interval': {
        const first = wallTime(from, this.tz).epochDay
        const last = wallTime(to, this.tz).epochDay
        const times = this.times(s)
        for (let day = first, guard = 0; day <= last && out.length < limit && guard < 800; day++, guard++) {
          if (!this.dayAllowed(day, s.weekdays)) continue
          const c = civilFromDays(day)
          for (const m of times) {
            const at = makeInstant(c.year, c.month, c.day, Math.floor(m / 60), m % 60, 0, this.tz)
            if (at > from && at <= to) out.push({ at, key: this.key(at) })
          }
        }
        break
      }
      case 'once': {
        const at = iso(s.date)
        if (at !== undefined && at > from && at <= to) out.push({ at, key: this.key(at) })
        break
      }
      case 'beforeEvents':
        out = this.eventSlots(s, events).filter((x) => x.at > from && x.at <= to)
        break
    }
    return out.sort((a, b) => a.at - b.at).slice(0, limit)
  }

  /** El siguiente hueco después de `after` (`undefined` = ya no hay más). */
  next(s: AutomationSchedule, after: number, events: readonly PlannerEvent[] = []): AutomationSlot | undefined {
    switch (s.kind) {
      case 'once': {
        const at = iso(s.date)
        return at !== undefined && at > after ? { at, key: this.key(at) } : undefined
      }
      case 'beforeEvents':
        return this.eventSlots(s, events).filter((x) => x.at > after).sort((a, b) => a.at - b.at)[0]
      default:
        // en 8 días hay como mucho una semana entera de huecos
        return this.slots(s, after, after + 8 * DAY, [], 1)[0]
    }
  }

  /** Las horas del día (minutos) de un horario diario o por intervalo. */
  times(s: AutomationSchedule): number[] {
    if (s.kind === 'daily') return [...new Set(s.times.map(timeMinutes))].sort((a, b) => a - b)
    if (s.kind !== 'interval') return []
    // la franja es de menos de un día: pasos mayores solo dan su primer hueco
    const step = Math.round(Math.min(24, effectiveInterval(s)) * 60)
    const start = timeMinutes(s.windowStart)
    const wEnd = timeMinutes(s.windowEnd)
    // una franja que cruza la medianoche se corta en las 23:59
    const end = wEnd > start ? wEnd : 24 * 60 - 1
    const out: number[] = []
    for (let m = start; m <= end; m += Math.max(60, step)) out.push(m)
    return out
  }

  dayAllowed(epochDay: number, weekdays: readonly number[]): boolean {
    return weekdays.length === 0 || weekdays.includes(weekdayOfEpochDay(epochDay))
  }

  /** Clave estable de un hueco en la zona («2026-10-12T08:00»). */
  key(at: number): string {
    const w = wallTime(at, this.tz)
    const p = (n: number, l = 2) => String(n).padStart(l, '0')
    return `${p(w.year, 4)}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`
  }

  /** Un hueco por evento y antelación (los eventos sin hora cuentan a las 23:59 del día: así se suelen poner las entregas). */
  eventSlots(s: AutomationSchedule, events: readonly PlannerEvent[]): AutomationSlot[] {
    const kinds = effectiveEventKinds(s)
    const hours = [...new Set(s.hoursBefore.filter((h) => h > 0))]
    const out: AutomationSlot[] = []
    for (const e of events) {
      if (!kinds.has(e.kind)) continue
      const start = effectiveStart(e, this.tz)
      for (const h of hours) {
        out.push({ at: start - h * HOUR, key: eventKey(e.id, h, start), eventID: e.id, eventTitle: e.title, eventStart: start, hoursBefore: h })
      }
    }
    return out.sort((a, b) => a.at - b.at)
  }

  // MARK: Decidir

  /** Cuánto tarde todavía tiene sentido recuperar un hueco perdido. */
  catchUpWindow(a: Automation): number {
    switch (a.schedule.kind) {
      case 'once': return 12 * HOUR
      case 'interval': return Math.max(HOUR, effectiveInterval(a.schedule) * HOUR)
      case 'beforeEvents': return 24 * HOUR
      case 'daily':
        if (a.routine === 'morningBrief') return 4 * HOUR
        if (a.routine === 'weeklySummary') return 24 * HOUR
        return 6 * HOUR
    }
  }

  /** Qué hacer ahora con `a`. `quiet` solo cuenta para lo que respeta las horas de silencio. */
  decide(a: Automation, state: AutomationState, now: number, events: readonly PlannerEvent[] = [], quiet?: QuietHours): PlannerDecision {
    if (!a.enabled || state.completed) return NONE
    const exp = iso(a.expiresAt)
    if (exp !== undefined && exp <= now) return NONE

    // 1) reintento o aplazamiento que ya tocan
    const retry = iso(state.retryAt)
    if (retry !== undefined && retry <= now) {
      return { action: { type: 'run', trigger: 'retry', slots: [{ at: retry, key: 'retry:' + this.key(retry) }] }, missed: [], expiredKeys: [] }
    }
    const deferred = iso(state.deferredUntil)
    if (deferred !== undefined && deferred <= now) {
      const slot = iso(state.deferredSlot) ?? deferred
      return { action: { type: 'run', trigger: 'catchUp', slots: [{ at: slot, key: this.key(slot) }] }, missed: [], expiredKeys: [] }
    }
    if (deferred !== undefined) return NONE // sigue aplazada

    // 2) huecos pasados desde la última revisión
    const since = iso(state.lastChecked) ?? iso(a.created) ?? now
    let due = this.slots(a.schedule, since, now, events)
    if (a.schedule.kind === 'beforeEvents') due = due.filter((s) => !state.firedKeys.includes(s.key))
    if (due.length === 0) return NONE

    const window = this.catchUpWindow(a)
    let missed: AutomationSlot[] = []
    let run: AutomationSlot[] = []
    const expired: string[] = []
    if (a.schedule.kind === 'beforeEvents') {
      // un aviso por evento: el más reciente de los que tocan (24 h y 2 h a la vez → solo el de 2 h)
      const byEvent = new Map<string, AutomationSlot>()
      for (const s of due) {
        if (s.eventStart === undefined || s.eventStart <= now) { expired.push(s.key); continue } // el evento ya empezó
        if (now - s.at > window) { missed.push(s); continue }
        const id = s.eventID ?? s.key
        const prev = byEvent.get(id)
        if (prev && prev.at >= s.at) { expired.push(s.key); continue }
        if (prev) expired.push(prev.key)
        byEvent.set(id, s)
      }
      run = [...byEvent.values()].sort((x, y) => x.at - y.at)
    } else {
      const latest = due[due.length - 1]
      if (now - latest.at <= window) {
        run = [latest]
        missed = due.slice(0, -1)
      } else missed = due
    }
    if (run.length === 0) return { action: { type: 'none' }, missed, expiredKeys: expired }
    const late = now - Math.max(...run.map((s) => s.at)) > this.onTimeGrace
    // 3) horas de silencio (la IA y las rutinas): se aplaza; los avisos de algo que vence antes de que acabe el silencio, no
    if (respectsQuietHours(a) && quiet && quietContains(quiet, now, this.tz)) {
      const end = quietEnd(quiet, now, this.tz)
      const urgent = run.some((s) => (s.eventStart ?? Infinity) <= end)
      if (!urgent) return { action: { type: 'defer', until: end, slot: run[run.length - 1] }, missed, expiredKeys: expired }
    }
    return { action: { type: 'run', trigger: late ? 'catchUp' : 'scheduled', slots: run }, missed, expiredKeys: expired }
  }

  /** Cuándo hay que volver a mirar: el siguiente hueco, reintento o fin de aplazamiento. */
  wakeDate(a: Automation, state: AutomationState, now: number, events: readonly PlannerEvent[] = []): number | undefined {
    if (!a.enabled || state.completed) return undefined
    const out: number[] = []
    const retry = iso(state.retryAt)
    const deferred = iso(state.deferredUntil)
    if (retry !== undefined) out.push(retry)
    if (deferred !== undefined) out.push(deferred)
    else {
      const n = this.next(a.schedule, Math.max(now, iso(state.lastChecked) ?? now), events)
      if (n) out.push(n.at)
    }
    return out.length ? Math.min(...out) : undefined
  }

  /** La próxima vez que se ejecutará (para la interfaz). */
  nextRun(a: Automation, state: AutomationState, now: number, events: readonly PlannerEvent[] = []): number | undefined {
    if (!a.enabled || state.completed) return undefined
    const exp = iso(a.expiresAt)
    if (exp !== undefined && exp <= now) return undefined
    const deferred = iso(state.deferredUntil)
    if (deferred !== undefined) return deferred
    let after = Math.max(now, iso(state.lastChecked) ?? now)
    let n = this.next(a.schedule, after, events)
    if (a.schedule.kind === 'beforeEvents') {
      for (let guard = 0; n && state.firedKeys.includes(n.key) && guard < 500; guard++) {
        after = n.at
        n = this.next(a.schedule, after, events)
      }
    }
    const candidates = [n?.at, iso(state.retryAt)].filter((v): v is number => v !== undefined)
    return candidates.length ? Math.min(...candidates) : undefined
  }
}

/** Inicio que cuenta: los eventos de todo el día, a las 23:59 de ese día. */
export function effectiveStart(e: PlannerEvent, tz: string): number {
  if (!e.allDay) return e.start.getTime()
  return settingTime(e.start, 23, 59, 0, tz).getTime()
}

/** «event:<id>@<minutos>m:<inicio en segundos>». */
export function eventKey(id: string, hours: number, start: number): string {
  return `event:${id}@${Math.round(hours * 60)}m:${Math.floor(start / 1000)}`
}
