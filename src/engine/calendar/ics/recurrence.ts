// Reglas RRULE de los calendarios que se leen (subconjunto útil para estudiar), portado de CanvasKit/ICS/ICSRecurrence.swift:
// FREQ = DAILY / WEEKLY / MONTHLY / YEARLY con INTERVAL, COUNT, UNTIL, BYDAY (con ordinales), BYMONTHDAY, BYMONTH, BYSETPOS y
// WKST. Las frecuencias menores a un día no se expanden.
import { civilFromDays, daysFromCivil, daysInMonth, isoWeekday, makeInstant } from '@engine/calendar/time'

export type ICSFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface ICSDay {
  /** null = todos los de ese tipo; 2 = el segundo; −1 = el último. */
  ordinal: number | null
  /** 1 = lunes … 7 = domingo. */
  weekday: number
}

export interface ICSRule {
  freq: ICSFreq
  interval: number
  count: number | null
  until: string | null
  byDay: ICSDay[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  weekStart: number
}

const WEEKDAYS: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }
const toInt = (s: string): number | null => (/^[+-]?\d+$/.test(s.trim()) ? Number(s.trim()) : null)
const unique = (list: number[]): number[] => [...new Set(list)]

/** Lee el valor de RRULE. `null` si la frecuencia no es compatible o es ilegible. */
export function parseICSRule(value: string): ICSRule | null {
  let freq: ICSFreq | null = null
  let interval = 1
  let count: number | null = null
  let until: string | null = null
  const byDay: ICSDay[] = []
  let byMonthDay: number[] = [], byMonth: number[] = [], bySetPos: number[] = []
  let wkst = 1
  for (const part of value.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim().toUpperCase()
    const val = part.slice(eq + 1).trim()
    switch (key) {
      case 'FREQ':
        switch (val.toUpperCase()) {
          case 'DAILY': freq = 'daily'; break
          case 'WEEKLY': freq = 'weekly'; break
          case 'MONTHLY': freq = 'monthly'; break
          case 'YEARLY': freq = 'yearly'; break
          default: return null
        }
        break
      case 'INTERVAL': { const n = toInt(val); if (n !== null && n >= 1) interval = Math.min(n, 1000); break }
      case 'COUNT': { const n = toInt(val); if (n !== null && n >= 1) count = n; break }
      case 'UNTIL': until = val; break
      case 'BYDAY':
        for (const item of val.split(',')) {
          const s = item.trim().toUpperCase()
          if (s.length < 2) continue
          const wd = WEEKDAYS[s.slice(-2)]
          if (!wd) continue
          const prefix = s.slice(0, -2)
          if (!prefix) byDay.push({ ordinal: null, weekday: wd })
          else {
            const n = toInt(prefix.startsWith('+') ? prefix.slice(1) : prefix)
            if (n !== null && n !== 0 && Math.abs(n) <= 53) byDay.push({ ordinal: n, weekday: wd })
          }
        }
        break
      case 'BYMONTHDAY': byMonthDay = unique(val.split(',').map(toInt).filter((n): n is number => n !== null && n !== 0 && Math.abs(n) <= 31)); break
      case 'BYMONTH': byMonth = unique(val.split(',').map(toInt).filter((n): n is number => n !== null && n >= 1 && n <= 12)); break
      case 'BYSETPOS': bySetPos = unique(val.split(',').map(toInt).filter((n): n is number => n !== null && n !== 0 && Math.abs(n) <= 366)); break
      case 'WKST': { const w = WEEKDAYS[val.toUpperCase()]; if (w) wkst = w; break }
    }
  }
  if (!freq) return null
  // sin repetidos (una lista con miles de «MO» no multiplica el trabajo de cada periodo)
  const days = [...new Map(byDay.map((d) => [`${d.ordinal ?? ''}${d.weekday}`, d])).values()]
  return { freq, interval, count, until, byDay: days, byMonthDay, byMonth, bySetPos, weekStart: wkst }
}

export interface Civil { year: number; month: number; day: number }

const DAY_MS = 86_400_000

/** Lo que devuelve `icsOccurrences` con ventana: las de antes de `from` (las últimas) y las de después (las primeras). */
export interface ICSOccurrenceWindow {
  /** Las últimas (como mucho `keep`) antes de `from`, en orden. Se calculan al pedirlas (muchas veces no hacen falta). */
  before(): number[]
  /** Las primeras (como mucho `keep`) desde `from`, en orden. */
  inside: number[]
}

export interface ICSOccurrenceArgs {
  rule: ICSRule
  start: Civil
  time: { hour: number; minute: number; second: number }
  zone: string
  until: number | null
  horizon: number
  maxPeriods?: number
  maxOccurrences?: number
  /** Desde cuándo interesan (ms). Las de antes se cuentan (para `COUNT`) sin calcularlas, salvo las últimas `keep`. */
  from?: number
  /** Cuántas se calculan como mucho a cada lado de `from` (por defecto, todas). */
  keep?: number
  /** Lo gastado en toda la lectura (vueltas y fechas). */
  budget?: { step(n?: number): void; occurrence(n?: number): void }
}

/** Ocurrencias (ms) de la serie; la primera siempre es DTSTART. `zone`: la de la hora de pared del evento. */
export function icsOccurrences(args: ICSOccurrenceArgs): number[] {
  const w = icsOccurrenceWindow(args)
  return [...w.before(), ...w.inside]
}

/**
 * Las ocurrencias de la serie alrededor de `from`: no se recorre más de lo necesario (una serie diaria sin filtros salta
 * directamente cerca de `from`) ni se calcula el instante de las que quedan antes (solo se cuentan, para `COUNT`).
 */
export function icsOccurrenceWindow(args: ICSOccurrenceArgs): ICSOccurrenceWindow {
  const { rule, start, time, zone } = args
  const maxPeriods = args.maxPeriods ?? 20_000
  const maxOccurrences = args.maxOccurrences ?? 20_000
  const from = args.from ?? Number.NEGATIVE_INFINITY
  const keep = Math.max(1, args.keep ?? Number.MAX_SAFE_INTEGER)
  const budget = args.budget
  const startDay = daysFromCivil(start.year, start.month, start.day)
  const startWeekday = isoWeekday(start.year, start.month, start.day)
  const instant = (epochDay: number) => {
    const c = civilFromDays(epochDay)
    return makeInstant(c.year, c.month, c.day, time.hour, time.minute, time.second, zone)
  }
  // la hora del día y el desfase de la zona mueven el instante menos de ±2 días respecto a la medianoche UTC del día civil
  const surelyBefore = (epochDay: number, ms: number) => (epochDay + 2) * DAY_MS < ms
  const isAfter = (epochDay: number, ms: number) => ((epochDay - 2) * DAY_MS > ms ? true : surelyBefore(epochDay, ms) ? false : instant(epochDay) > ms)
  const limit = rule.count ?? Number.MAX_SAFE_INTEGER
  // lo que cuesta un periodo (los BYDAY de un mes o de un año se buscan día a día)
  const periodCost = rule.freq === 'monthly' ? 1 + rule.byDay.length : rule.freq === 'yearly' ? 1 + rule.byDay.length * Math.max(1, rule.byMonth.length) : 1
  const bounded = rule.count !== null || rule.until !== null
  // con COUNT/UNTIL puede ir más allá del horizonte de las abiertas, pero no sin fin (30 años más)
  const horizon = bounded ? args.horizon + 30 * 365 * 86_400_000 : args.horizon
  let emitted = 0
  let firstSeen = false
  // antes de `from`: un anillo con los días de las últimas `keep` (su instante se calcula al final)
  const ring: number[] = []
  let ringAt = 0
  const inside: number[] = []
  const remember = (epochDay: number) => {
    if (ring.length < keep) ring.push(epochDay)
    else { ring[ringAt] = epochDay; ringAt = (ringAt + 1) % keep }
  }

  // una fecha de la serie (ya en orden y desde DTSTART); false = se acabó
  const take = (epochDay: number): boolean => {
    if (surelyBefore(epochDay, from) && (args.until === null || surelyBefore(epochDay, args.until)) && surelyBefore(epochDay, horizon)) {
      remember(epochDay)
    } else {
      const inst = instant(epochDay)
      if (args.until !== null && inst > args.until) return false
      if (inst > horizon) return false
      if (inst < from) remember(epochDay)
      else {
        budget?.occurrence()
        inside.push(inst)
      }
    }
    emitted++
    return emitted < limit && emitted < maxOccurrences && inside.length < keep
  }

  const emit = (epochDay: number): boolean => {
    if (epochDay < startDay) return true
    if (!firstSeen) {
      firstSeen = true
      // DTSTART no encaja con la regla: igualmente es la primera
      if (epochDay !== startDay && !take(startDay)) return false
    }
    return take(epochDay)
  }

  const finish = (): ICSOccurrenceWindow => {
    // si no salió ninguna (regla incompatible), al menos DTSTART
    if (!ring.length && !inside.length) {
      const first = instant(startDay)
      if (first < from) remember(startDay)
      else inside.push(first)
    }
    let before: number[] | null = null
    return {
      inside,
      before: () => {
        if (before) return before
        const days = ring.length < keep ? ring : [...ring.slice(ringAt), ...ring.slice(0, ringAt)]
        budget?.occurrence(days.length)
        before = days.map(instant)
        return before
      }
    }
  }

  // Salto de golpe en las reglas sin filtros, donde cada periodo da siempre `n` fechas (el primero, `first`): esas se cuentan
  // (para COUNT) sin recorrerlas, dejando `keep` antes de `from` y de UNTIL. `lastDay0`: último día del periodo 0; `span`:
  // días entre periodos. Devuelve el periodo desde el que seguir.
  const jump = (n: number, first: number, lastDay0: number, span: number): number => {
    if (keep >= Number.MAX_SAFE_INTEGER || !Number.isFinite(from) || n < 1) return 0
    // periodos enteros cuyo último día queda, seguro, antes de `ms`
    const wholeBefore = (ms: number) => Math.floor((Math.floor(ms / DAY_MS) - 3 - lastDay0) / span) + 1
    const back = Math.ceil(keep / n) + 1
    let skip = wholeBefore(from) - back
    if (args.until !== null) skip = Math.min(skip, wholeBefore(args.until) - back)
    const cap = Math.min(limit, maxOccurrences) - keep
    if (cap < first) return 0
    skip = Math.min(skip, Math.floor((cap - first) / n) + 1, maxPeriods - back)
    if (skip < 2) return 0
    emitted = first + (skip - 1) * n
    firstSeen = true
    return skip
  }

  const passesFilters = (epochDay: number) => {
    const c = civilFromDays(epochDay)
    if (rule.byMonth.length && !rule.byMonth.includes(c.month)) return false
    if (rule.byMonthDay.length) {
      const dim = daysInMonth(c.year, c.month)
      if (!rule.byMonthDay.some((d) => (d > 0 ? d : dim + d + 1) === c.day)) return false
    }
    return true
  }

  const applySetPos = (days: number[]): number[] => {
    if (!rule.bySetPos.length || !days.length) return days
    const picked: number[] = []
    for (const p of rule.bySetPos) {
      const idx = p > 0 ? p - 1 : days.length + p
      if (idx >= 0 && idx < days.length) picked.push(days[idx])
    }
    return [...new Set(picked)].sort((a, b) => a - b)
  }

  const monthDays = (y: number, m: number): number[] => {
    const dim = daysInMonth(y, m)
    const byMD = new Set<number>()
    for (const md of rule.byMonthDay) {
      const d = md > 0 ? md : dim + md + 1
      if (d >= 1 && d <= dim) byMD.add(d)
    }
    const byWD = new Set<number>()
    const firstWeekday = rule.byDay.length ? isoWeekday(y, m, 1) : 0
    for (const bd of rule.byDay) {
      const matches: number[] = []
      for (let d = 1 + ((bd.weekday - firstWeekday + 7) % 7); d <= dim; d += 7) matches.push(d)
      if (bd.ordinal !== null) {
        const idx = bd.ordinal > 0 ? bd.ordinal - 1 : matches.length + bd.ordinal
        if (idx >= 0 && idx < matches.length) byWD.add(matches[idx])
      } else matches.forEach((d) => byWD.add(d))
    }
    let days: Set<number>
    if (rule.byMonthDay.length && rule.byDay.length) days = new Set([...byMD].filter((d) => byWD.has(d)))
    else if (rule.byMonthDay.length) days = byMD
    else if (rule.byDay.length) days = byWD
    else days = start.day <= dim ? new Set([start.day]) : new Set()
    return [...days].sort((a, b) => a - b).map((d) => daysFromCivil(y, m, d))
  }

  if (rule.freq === 'daily') {
    // sin filtros, cada día de la serie es una fecha (el primero, DTSTART)
    const plain = !rule.byMonth.length && !rule.byMonthDay.length && !rule.byDay.length
    for (let p = plain ? jump(1, 1, startDay, rule.interval) : 0; p < maxPeriods; p++) {
      budget?.step()
      const day = startDay + p * rule.interval
      if (!passesFilters(day)) {
        if (isAfter(day, horizon)) break
        continue
      }
      if (rule.byDay.length) {
        const c = civilFromDays(day)
        const wd = isoWeekday(c.year, c.month, c.day)
        if (!rule.byDay.some((d) => d.weekday === wd)) continue
      }
      if (!emit(day)) break
    }
  } else if (rule.freq === 'weekly') {
    const shift = (startWeekday - rule.weekStart + 7) % 7
    const week0 = startDay - shift
    const weekdays = rule.byDay.length ? [...new Set(rule.byDay.map((d) => d.weekday))] : [startWeekday]
    let stop = false
    // sin filtros, cada semana da todos sus días; la primera, los que caen desde DTSTART (y DTSTART si no encaja con la regla)
    const plain = !rule.byMonth.length && !rule.byMonthDay.length && !rule.bySetPos.length
    const firstWeek = weekdays.filter((w) => week0 + ((w - rule.weekStart + 7) % 7) >= startDay).length + (weekdays.includes(startWeekday) ? 0 : 1)
    for (let p = plain ? jump(weekdays.length, firstWeek, week0 + 6, 7 * rule.interval) : 0; p < maxPeriods && !stop; p++) {
      budget?.step(weekdays.length)
      const begin = week0 + p * 7 * rule.interval
      let days = weekdays.map((w) => begin + ((w - rule.weekStart + 7) % 7)).sort((a, b) => a - b).filter(passesFilters)
      days = applySetPos(days)
      if (!days.length && isAfter(begin, horizon)) break
      for (const d of days) {
        if (d < startDay) continue
        if (!emit(d)) { stop = true; break }
      }
    }
  } else {
    let stop = false
    for (let p = 0; p < maxPeriods && !stop; p++) {
      budget?.step(periodCost)
      let days: number[] = []
      let periodStart: number
      if (rule.freq === 'monthly') {
        const total = start.year * 12 + (start.month - 1) + p * rule.interval
        const y = Math.floor(total / 12), m = (total % 12) + 1
        days = monthDays(y, m)
        periodStart = daysFromCivil(y, m, 1)
      } else {
        const y = start.year + p * rule.interval
        const months = rule.byMonth.length ? [...rule.byMonth].sort((a, b) => a - b) : [start.month]
        for (const m of months) days.push(...monthDays(y, m))
        periodStart = daysFromCivil(y, 1, 1)
      }
      days = applySetPos(days.sort((a, b) => a - b))
      if (!days.length && isAfter(periodStart, horizon)) break
      for (const d of days) {
        if (d < startDay) continue
        if (!emit(d)) { stop = true; break }
      }
    }
  }
  return finish()
}
