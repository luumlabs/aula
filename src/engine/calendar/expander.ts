// Las repeticiones de un evento propio (RecurrenceExpander de StudyEngine/Calendar/Recurrence.swift). Se calculan con la HORA
// DE PARED de la zona del evento: la clase de las 10:00 sigue a las 10:00 tras el cambio de hora. Una hora que no existe (salto
// de primavera) se lee con el desfase de antes del salto (02:30 → 03:30) y una que existe dos veces (otoño) es la primera.
import { civilFromDays, daysFromCivil, daysInMonth, isLeap, makeInstant, MS_PER_DAY, normalizeMonth, offsetSeconds, wallTime, weekdayOfEpochDay } from '@engine/calendar/time'
import { MAX_RECURRENCE_INTERVAL, type RecurrenceFrequency, type RecurrenceRule, type WeekdayNum } from './rrule'

/** Tope de repeticiones que se devuelven en una consulta. */
export const MAX_EXPANDED_OCCURRENCES = 5_000
/** Tope de periodos que se recorren (para que una regla rara no cuelgue). */
const MAX_PERIODS = 200_000
/** Más allá de esto no hay fechas representables (±1 000 000 de años). */
const MAX_DAY = 365_000_000

/** Los inicios de las repeticiones entre `from` y `to` (incluidos), en orden. `start` (DTSTART) es siempre la primera. */
export function expandOccurrences(start: Date, rule: RecurrenceRule, timeZone: string, from: Date, to: Date, limit = MAX_EXPANDED_OCCURRENCES): Date[] {
  const startMs = start.getTime(), fromMs = from.getTime(), toMs = to.getTime()
  if (!(toMs >= fromMs) || !(rule.interval >= 1 && rule.interval <= MAX_RECURRENCE_INTERVAL) || limit <= 0 || !Number.isFinite(startMs)) return []
  const wall = wallTime(startMs, timeZone)
  const civilStart = wall.epochDay
  const out: Date[] = []
  let produced = 0 // cuenta para COUNT (desde el principio)
  const maxCount = rule.count ?? Number.POSITIVE_INFINITY
  const untilMs = rule.until?.getTime()
  const emit = (d: number): boolean => {
    if (untilMs !== undefined && d > untilMs) return false
    produced += 1
    if (d >= fromMs && d <= toMs) out.push(new Date(d))
    return !(produced >= maxCount || d > toMs || out.length >= limit)
  }
  // DTSTART es siempre la primera
  if (!emit(startMs)) return out
  // sin COUNT se puede saltar directamente cerca de `from`
  let period = 0
  if (rule.count === undefined && fromMs > startMs) {
    const fromDay = Math.floor((fromMs + offsetSeconds(fromMs, timeZone) * 1000) / MS_PER_DAY)
    const gap = unitsBetween(rule.frequency, civilStart, fromDay)
    period = Math.max(0, Math.floor(gap / rule.interval) - 1)
  }
  for (let steps = 0; steps < MAX_PERIODS; steps++) {
    const days = candidates(rule, period, civilStart)
    period += 1
    if (!days.length) {
      if (beyond(rule, period, civilStart, toMs)) break
      continue
    }
    for (const day of days) {
      const c = civilFromDays(day)
      const instant = makeInstant(c.year, c.month, c.day, wall.hour, wall.minute, wall.second, timeZone)
      if (instant <= startMs) continue
      if (!emit(instant)) return out
    }
  }
  return out
}

/** Unidades completas (días, semanas, meses o años) entre dos días civiles. */
function unitsBetween(f: RecurrenceFrequency, a: number, b: number): number {
  if (f === 'DAILY') return b - a
  if (f === 'WEEKLY') return Math.trunc((b - a) / 7)
  const x = civilFromDays(a), y = civilFromDays(b)
  if (f === 'MONTHLY') {
    let m = (y.year * 12 + y.month) - (x.year * 12 + x.month)
    if (m > 0 && y.day < x.day) m -= 1
    else if (m < 0 && y.day > x.day) m += 1
    return m
  }
  let years = y.year - x.year
  const later = y.month > x.month || (y.month === x.month && y.day >= x.day)
  if (years > 0 && !later) years -= 1
  return years
}

/** El día civil `n` meses después (el día se recorta al último del mes, como `Calendar.date(byAdding:)`). */
function addMonthsDay(day: number, n: number): number | null {
  const c = civilFromDays(day)
  const t = normalizeMonth(c.year, c.month + n)
  if (Math.abs(t.year) > 1_000_000) return null
  return daysFromCivil(t.year, t.month, Math.min(c.day, daysInMonth(t.year, t.month)))
}

/** ¿Este periodo ya empieza después de `to`? (para no dar vueltas cuando una regla no produce nada) */
function beyond(rule: RecurrenceRule, period: number, civilStart: number, toMs: number): boolean {
  const n = period * rule.interval
  if (!Number.isSafeInteger(n)) return true
  let p: number | null
  switch (rule.frequency) {
    case 'DAILY': p = civilStart + n; break
    case 'WEEKLY': p = civilStart + 7 * n; break
    case 'MONTHLY': p = addMonthsDay(civilStart, n); break
    case 'YEARLY': p = n > 2_000_000 ? null : addMonthsDay(civilStart, 12 * n); break
  }
  if (p === null || Math.abs(p) > MAX_DAY) return true
  const pm = p * MS_PER_DAY
  return pm > toMs + 2 * MS_PER_DAY || (rule.until !== undefined && pm > rule.until.getTime() + 2 * MS_PER_DAY)
}

const firstOfMonth = (day: number) => { const c = civilFromDays(day); return daysFromCivil(c.year, c.month, 1) }
const firstOfYear = (day: number) => daysFromCivil(civilFromDays(day).year, 1, 1)
const dayOfMonth = (day: number) => civilFromDays(day).day
const monthOf = (day: number) => civilFromDays(day).month

function matchesMonthDay(day: number, list: number[]): boolean {
  const c = civilFromDays(day)
  const count = daysInMonth(c.year, c.month)
  return list.some((k) => (k > 0 ? k === c.day : count + k + 1 === c.day))
}

/** Los días (civiles, ordenados) del periodo `period` que cumplen la regla. */
export function candidates(rule: RecurrenceRule, period: number, civilStart: number): number[] {
  const n = period * rule.interval
  if (!Number.isSafeInteger(n)) return []
  let days: number[]
  switch (rule.frequency) {
    case 'DAILY': {
      const d = civilStart + n
      days = [d]
      if (rule.byDay.length && !rule.byDay.some((w) => w.weekday === weekdayOfEpochDay(d))) days = []
      if (rule.byMonthDay.length && !matchesMonthDay(d, rule.byMonthDay)) days = []
      break
    }
    case 'WEEKLY': {
      // la semana que empieza en WKST y contiene el inicio, más n semanas
      const startWD = weekdayOfEpochDay(civilStart)
      const back = (startWD - rule.weekStart + 7) % 7
      const week = civilStart - back + 7 * n
      if (!Number.isSafeInteger(week) || Math.abs(week) > MAX_DAY) return []
      const wanted = rule.byDay.length ? rule.byDay.map((w) => w.weekday) : [startWD]
      days = [...new Set(wanted)].map((wd) => week + ((wd - rule.weekStart + 7) % 7))
      if (rule.byMonthDay.length) days = days.filter((d) => matchesMonthDay(d, rule.byMonthDay))
      break
    }
    case 'MONTHLY': {
      const month = addMonthsDay(firstOfMonth(civilStart), n)
      if (month === null) return []
      days = monthDays(month, rule, dayOfMonth(civilStart))
      break
    }
    case 'YEARLY': {
      if (n > 2_000_000) return []
      const year = addMonthsDay(firstOfYear(civilStart), 12 * n)
      if (year === null) return []
      if (!rule.byMonth.length && !rule.byMonthDay.length && rule.byDay.length) {
        days = yearWeekdays(year, rule.byDay) // «el 20.º lunes del año»: ordinales dentro del año
      } else {
        // RFC 5545: BYMONTHDAY sin BYMONTH en una regla anual vale para todos los meses
        const months = rule.byMonth.length ? [...rule.byMonth].sort((a, b) => a - b) : rule.byMonthDay.length ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [monthOf(civilStart)]
        const y = civilFromDays(year).year
        days = months.flatMap((m) => monthDays(daysFromCivil(y, m, 1), rule, dayOfMonth(civilStart)))
      }
      break
    }
  }
  if (rule.byMonth.length) days = days.filter((d) => rule.byMonth.includes(monthOf(d)))
  days = [...new Set(days)].sort((a, b) => a - b)
  if (rule.bySetPos.length) {
    const picked: number[] = []
    for (const pos of rule.bySetPos) {
      const i = pos > 0 ? pos - 1 : days.length + pos
      if (i >= 0 && i < days.length) picked.push(days[i])
    }
    days = [...new Set(picked)].sort((a, b) => a - b)
  }
  return days
}

/** Los días de un mes según BYMONTHDAY / BYDAY (o el mismo día del inicio, si existe en ese mes). */
function monthDays(first: number, rule: RecurrenceRule, defaultDay: number): number[] {
  const c = civilFromDays(first)
  const count = daysInMonth(c.year, c.month)
  const day = (k: number): number | null => (k >= 1 && k <= count ? first + k - 1 : null)
  let byMD: number[] | null = null
  if (rule.byMonthDay.length) byMD = rule.byMonthDay.map((k) => day(k > 0 ? k : count + k + 1)).filter((d): d is number => d !== null)
  let byD: number[] | null = null
  if (rule.byDay.length) {
    byD = rule.byDay.flatMap((w) => {
      const all: number[] = []
      for (let k = 1; k <= count; k++) if (weekdayOfEpochDay(first + k - 1) === w.weekday) all.push(first + k - 1)
      return pick(all, w)
    })
  }
  if (byMD && byD) { const set = new Set(byD); return byMD.filter((d) => set.has(d)) }
  if (byMD) return byMD
  if (byD) return byD
  const d = day(defaultDay)
  return d === null ? [] : [d] // el 31 no existe en abril: ese mes no hay
}

function yearWeekdays(firstOfYearDay: number, byDay: WeekdayNum[]): number[] {
  const n = isLeap(civilFromDays(firstOfYearDay).year) ? 366 : 365
  return byDay.flatMap((w) => {
    const these: number[] = []
    for (let k = 0; k < n; k++) if (weekdayOfEpochDay(firstOfYearDay + k) === w.weekday) these.push(firstOfYearDay + k)
    return pick(these, w)
  })
}

function pick(all: number[], w: WeekdayNum): number[] {
  if (w.ordinal === undefined) return all
  const i = w.ordinal > 0 ? w.ordinal - 1 : all.length + w.ordinal
  return i >= 0 && i < all.length ? [all[i]] : []
}
