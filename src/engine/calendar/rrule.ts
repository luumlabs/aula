// Reglas de repetición de los eventos propios (RRULE, RFC 5545 §3.3.10), portado de StudyEngine/Calendar/Recurrence.swift.
// Admite FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, COUNT, UNTIL, BYDAY (con ordinal: 2TU, -1FR), BYMONTHDAY (también
// negativos), BYMONTH, BYSETPOS y WKST. En `calendar.json` se guarda como el texto RRULE (UNTIL siempre en UTC).
// Ojo: aquí los días de la semana van como `Calendar` de Swift (1 = domingo … 7 = sábado); WKST por defecto, lunes (2).
import { localTimeZone, makeInstant, pad, UTC, wallTime } from '@engine/calendar/time'
import { tr } from '@shared/ai/i18n'

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']

/** Un día de la semana con ordinal opcional (2 = el segundo del mes; −1 = el último). */
export interface WeekdayNum {
  /** 1 = domingo … 7 = sábado. */
  weekday: number
  ordinal?: number
}

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval: number
  /** Cuántas veces en total (contando la primera). */
  count?: number
  /** Hasta cuándo (incluido). */
  until?: Date
  byDay: WeekdayNum[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  /** Primer día de la semana (2 = lunes). */
  weekStart: number
}

/** Límite de la app: evita intervalos sin utilidad para un horario y aritmética no representable. */
export const MAX_RECURRENCE_INTERVAL = 10_000

const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi

/** Regla normalizada (como el `init` de Swift: descarta lo que no tiene sentido en vez de fallar). */
export function makeRecurrenceRule(p: Partial<RecurrenceRule> & { frequency: RecurrenceFrequency }): RecurrenceRule {
  const interval = Number.isFinite(p.interval) ? Math.trunc(p.interval as number) : 1
  const rule: RecurrenceRule = {
    frequency: p.frequency,
    interval: Math.min(MAX_RECURRENCE_INTERVAL, Math.max(1, interval)),
    byDay: (p.byDay ?? []).filter((d) => inRange(d.weekday, 1, 7) && (d.ordinal === undefined || (d.ordinal !== 0 && inRange(d.ordinal, -53, 53)))).map(
      (d) => (d.ordinal === undefined ? { weekday: d.weekday } : { weekday: d.weekday, ordinal: d.ordinal })
    ),
    byMonthDay: (p.byMonthDay ?? []).filter((n) => n !== 0 && inRange(n, -31, 31)),
    byMonth: (p.byMonth ?? []).filter((n) => inRange(n, 1, 12)),
    bySetPos: (p.bySetPos ?? []).filter((n) => n !== 0 && inRange(n, -366, 366)),
    weekStart: p.weekStart !== undefined && inRange(p.weekStart, 1, 7) ? p.weekStart : 2
  }
  if (p.count !== undefined && p.count !== null) rule.count = Math.max(1, Math.trunc(p.count))
  if (p.until) rule.until = p.until
  return rule
}

/** Semanal en unos días («L y X»): 2 = lunes … 6 = viernes. */
export function weeklyRule(weekdays: number[], opts: { interval?: number; until?: Date; count?: number } = {}): RecurrenceRule {
  return makeRecurrenceRule({ frequency: 'WEEKLY', interval: opts.interval ?? 1, count: opts.count, until: opts.until, byDay: [...weekdays].sort((a, b) => a - b).map((w) => ({ weekday: w })) })
}

/** ¿Son la misma regla? (como `==` de Swift: también el orden de las listas) */
export function rulesEqual(a: RecurrenceRule | null | undefined, b: RecurrenceRule | null | undefined): boolean {
  if (!a || !b) return !a && !b
  const list = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i])
  return (
    a.frequency === b.frequency && a.interval === b.interval && (a.count ?? null) === (b.count ?? null) &&
    (a.until?.getTime() ?? null) === (b.until?.getTime() ?? null) && a.weekStart === b.weekStart &&
    a.byDay.length === b.byDay.length && a.byDay.every((d, i) => d.weekday === b.byDay[i].weekday && (d.ordinal ?? null) === (b.byDay[i].ordinal ?? null)) &&
    list(a.byMonthDay, b.byMonthDay) && list(a.byMonth, b.byMonth) && list(a.bySetPos, b.bySetPos)
  )
}

// MARK: - Texto RRULE

export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** La regla no se puede leer (la parte que falla en `what`). */
export class RecurrenceParseError extends Error {
  constructor(readonly what: string) {
    super(tr(`La regla de repetición no es válida (${what}).`, `The repetition rule isn’t valid (${what}).`))
    this.name = 'RecurrenceParseError'
  }
}

const INT_RE = /^[+-]?\d+$/

function toInt(s: string): number | null {
  return INT_RE.test(s) ? Number(s) : null
}

/** Lee «FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261220T225959Z» (con o sin «RRULE:» delante). Un UNTIL sin zona («20261220» o
 *  «20261220T235959») se lee en `timeZone` (una fecha sola = hasta el final de ese día). Lanza `RecurrenceParseError`. */
export function parseRRule(text: string, timeZone: string = localTimeZone()): RecurrenceRule {
  let raw = text.trim()
  if (raw.toUpperCase().startsWith('RRULE:')) raw = raw.slice(6)
  const parts: Record<string, string> = {}
  for (const p of raw.split(';')) {
    if (p === '') continue
    const eq = p.indexOf('=')
    const key = (eq < 0 ? p : p.slice(0, eq)).trim().toUpperCase()
    const value = eq < 0 ? '' : p.slice(eq + 1).trim().toUpperCase()
    if (eq < 0 || eq === p.length - 1 || eq === 0 || !key) throw new RecurrenceParseError(p)
    parts[key] = value
  }
  const f = parts.FREQ as RecurrenceFrequency | undefined
  if (!f || !RECURRENCE_FREQUENCIES.includes(f)) throw new RecurrenceParseError('FREQ')
  const ints = (key: string): number[] => {
    const v = parts[key]
    if (v === undefined) return []
    return v.split(',').filter((s) => s !== '').map((s) => {
      const n = toInt(s)
      if (n === null) throw new RecurrenceParseError(key)
      return n
    })
  }
  const days: WeekdayNum[] = []
  if (parts.BYDAY !== undefined) {
    for (const s of parts.BYDAY.split(',').filter((x) => x !== '')) {
      const idx = s.length >= 2 ? DAY_CODES.indexOf(s.slice(-2)) : -1
      if (idx < 0) throw new RecurrenceParseError('BYDAY')
      const ord = s.slice(0, -2)
      if (ord === '' || ord === '+') days.push({ weekday: idx + 1 })
      else {
        const n = toInt(ord.replace(/\+/g, ''))
        if (n !== null && n !== 0 && inRange(n, -53, 53)) days.push({ weekday: idx + 1, ordinal: n })
        else throw new RecurrenceParseError('BYDAY')
      }
    }
  }
  let interval = 1
  if (parts.INTERVAL !== undefined) {
    const n = toInt(parts.INTERVAL)
    if (n === null || !inRange(n, 1, MAX_RECURRENCE_INTERVAL)) throw new RecurrenceParseError('INTERVAL')
    interval = n
  }
  let count: number | undefined
  if (parts.COUNT !== undefined) {
    const n = toInt(parts.COUNT)
    if (n === null || n <= 0 || !Number.isSafeInteger(n)) throw new RecurrenceParseError('COUNT')
    count = n
  }
  let until: Date | undefined
  if (parts.UNTIL !== undefined) {
    const d = parseUntil(parts.UNTIL, timeZone)
    if (!d) throw new RecurrenceParseError('UNTIL')
    until = d
  }
  if (count !== undefined && until !== undefined) throw new RecurrenceParseError('COUNT + UNTIL')
  let wkst = 2
  if (parts.WKST !== undefined) {
    const i = DAY_CODES.indexOf(parts.WKST)
    if (i < 0) throw new RecurrenceParseError('WKST')
    wkst = i + 1
  }
  const monthDays = ints('BYMONTHDAY'), months = ints('BYMONTH'), positions = ints('BYSETPOS')
  if (!monthDays.every((n) => n !== 0 && inRange(n, -31, 31))) throw new RecurrenceParseError('BYMONTHDAY')
  if (!months.every((n) => inRange(n, 1, 12))) throw new RecurrenceParseError('BYMONTH')
  if (!positions.every((n) => n !== 0 && inRange(n, -366, 366))) throw new RecurrenceParseError('BYSETPOS')
  const rule = makeRecurrenceRule({ frequency: f, interval, count, until, byDay: days, byMonthDay: monthDays, byMonth: months, bySetPos: positions, weekStart: wkst })
  if (f !== 'MONTHLY' && f !== 'YEARLY' && rule.byDay.some((d) => d.ordinal !== undefined)) throw new RecurrenceParseError('BYDAY')
  return rule
}

/** Igual que `parseRRule` pero `null` en vez de lanzar. */
export function tryParseRRule(text: string, timeZone?: string): RecurrenceRule | null {
  try {
    return parseRRule(text, timeZone)
  } catch {
    return null
  }
}

const UTC_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
const LOCAL_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/

function validParts(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return d <= dim && y >= 1
}

/** UNTIL: «…Z» en UTC; «yyyyMMdd» = el último segundo de ese día en `tz`; «yyyyMMddTHHmmss» = esa hora de pared en `tz`. */
export function parseUntil(s: string, tz: string): Date | null {
  let m = UTC_RE.exec(s)
  if (m) {
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
    if (!validParts(y, mo, d, h, mi, se)) return null
    return new Date(makeInstant(y, mo, d, h, mi, se, UTC))
  }
  m = DATE_RE.exec(s)
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number)
    if (!validParts(y, mo, d)) return null
    return new Date(makeInstant(y, mo, d + 1, 0, 0, 0, tz) - 1000)
  }
  m = LOCAL_RE.exec(s)
  if (m) {
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
    if (!validParts(y, mo, d, h, mi, se)) return null
    return new Date(makeInstant(y, mo, d, h, mi, se, tz))
  }
  return null
}

function formatStamp(date: Date, tz: string, withTime: boolean): string {
  const w = wallTime(date, tz)
  const day = `${pad(w.year, 4)}${pad(w.month, 2)}${pad(w.day, 2)}`
  return withTime ? `${day}T${pad(w.hour, 2)}${pad(w.minute, 2)}${pad(w.second, 2)}` : day
}

/** El texto RRULE (sin «RRULE:»). UNTIL en UTC; para un evento de todo el día, como fecha en su zona (lo pide el RFC). */
export function formatRRule(rule: RecurrenceRule, opts: { allDay?: boolean; timeZone?: string } = {}): string {
  const p = [`FREQ=${rule.frequency}`]
  if (rule.interval > 1) p.push(`INTERVAL=${rule.interval}`)
  if (rule.count !== undefined) p.push(`COUNT=${rule.count}`)
  if (rule.until) p.push('UNTIL=' + (opts.allDay ? formatStamp(rule.until, opts.timeZone ?? localTimeZone(), false) : formatStamp(rule.until, UTC, true) + 'Z'))
  if (rule.byMonth.length) p.push('BYMONTH=' + rule.byMonth.join(','))
  if (rule.byMonthDay.length) p.push('BYMONTHDAY=' + rule.byMonthDay.join(','))
  if (rule.byDay.length) p.push('BYDAY=' + rule.byDay.map((d) => (d.ordinal !== undefined ? String(d.ordinal) : '') + DAY_CODES[d.weekday - 1]).join(','))
  if (rule.bySetPos.length) p.push('BYSETPOS=' + rule.bySetPos.join(','))
  if (rule.weekStart !== 2) p.push('WKST=' + DAY_CODES[rule.weekStart - 1])
  return p.join(';')
}

// MARK: - En palabras

export type CalendarLanguage = 'es' | 'en'

/** «es» salvo que el idioma empiece por «en». */
export function calendarLanguage(locale: string | undefined | null): CalendarLanguage {
  return locale && locale.toLowerCase().startsWith('en') ? 'en' : 'es'
}

const WORDS = {
  es: {
    daily: (n: number) => (n === 1 ? 'Cada día' : `Cada ${n} días`),
    weekly: (n: number) => (n === 1 ? 'Cada semana' : `Cada ${n} semanas`),
    monthly: (n: number) => (n === 1 ? 'Cada mes' : `Cada ${n} meses`),
    yearly: (n: number) => (n === 1 ? 'Cada año' : `Cada ${n} años`),
    until: (d: string) => `hasta el ${d}`,
    times: (n: number) => `${n} veces`,
    noEnd: 'sin final'
  },
  en: {
    daily: (n: number) => (n === 1 ? 'Every day' : `Every ${n} days`),
    weekly: (n: number) => (n === 1 ? 'Every week' : `Every ${n} weeks`),
    monthly: (n: number) => (n === 1 ? 'Every month' : `Every ${n} months`),
    yearly: (n: number) => (n === 1 ? 'Every year' : `Every ${n} years`),
    until: (d: string) => `until ${d}`,
    times: (n: number) => `${n} times`,
    noEnd: 'no end'
  }
}

/** Nombre del día (1 = domingo … 7 = sábado) en el idioma pedido. */
export function weekdayName(weekday: number, lang: CalendarLanguage): string {
  // el 4-ene-1970 fue domingo
  const date = new Date(Date.UTC(1970, 0, 3 + weekday))
  return new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: UTC }).format(date)
}

function joinList(items: string[], lang: CalendarLanguage): string {
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

function base(rule: RecurrenceRule, lang: CalendarLanguage, always: boolean): string {
  const w = WORDS[lang]
  const n = Math.max(1, rule.interval)
  switch (rule.frequency) {
    case 'DAILY': return w.daily(n)
    case 'WEEKLY': return w.weekly(n)
    case 'MONTHLY': return w.monthly(n)
    case 'YEARLY': return always ? w.yearly(n) : w.yearly(1)
  }
}

/** «Cada semana: lunes y miércoles · hasta el 20 de diciembre» (para la interfaz). */
export function recurrenceSummary(rule: RecurrenceRule, opts: { language?: CalendarLanguage; timeZone?: string } = {}): string {
  const lang = opts.language ?? 'es'
  const tz = opts.timeZone ?? localTimeZone()
  let text = base(rule, lang, false)
  if (rule.frequency === 'WEEKLY' && rule.byDay.length) text += ': ' + joinList(rule.byDay.map((d) => weekdayName(d.weekday, lang)), lang)
  if (rule.until) {
    const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: tz }).format(rule.until)
    return text + ' · ' + WORDS[lang].until(day)
  }
  if (rule.count !== undefined) return text + ' · ' + WORDS[lang].times(rule.count)
  return text
}

/** La regla en una frase para las tarjetas de permiso («Cada semana: lunes y miércoles, hasta el 20 dic 2026»). */
export function readableRecurrence(rule: RecurrenceRule, opts: { language?: CalendarLanguage; timeZone?: string } = {}): string {
  const lang = opts.language ?? 'es'
  const tz = opts.timeZone ?? localTimeZone()
  let text = base(rule, lang, true)
  if (rule.byDay.length) {
    const order = [2, 3, 4, 5, 6, 7, 1]
    const days = [...rule.byDay].sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday)).map((d) => weekdayName(d.weekday, lang))
    if (days.length) text += ': ' + joinList(days, lang)
  }
  if (rule.until) text += ', ' + WORDS[lang].until(new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: tz }).format(rule.until))
  else if (rule.count !== undefined) text += ', ' + WORDS[lang].times(rule.count)
  else text += ', ' + WORDS[lang].noEnd
  return text
}
