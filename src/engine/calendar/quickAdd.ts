// «Añadir rápido» del calendario (QuickEventParser.swift): entiende frases como «Prueba de inglés el lunes a las 10»,
// «entrega de la práctica mañana 23:59», «estudiar química hoy de 17 a 19», «Parcial 2 el 20/10 a las 8», «Cálculo L y X de
// 10 a 11 todo el cuatrimestre» o «English test next Monday at 10am» y devuelve un evento propio (título, tipo, asignatura,
// inicio, fin, todo el día y repetición). En español e inglés; en los otros idiomas de la app, lo básico (hoy/mañana/pasado
// mañana, días de la semana, meses y la hora más común). Sin red ni IA.
import { addDays, addMonths, addYears, endOfDay, localTimeZone, makeInstant, settingTime, startOfDay, wallTime } from '@engine/calendar/time'
import { isAssessmentKind, type CalendarEventDraft, type CalendarEventKind } from './model'
import { makeRecurrenceRule, type RecurrenceFrequency, type RecurrenceRule } from './rrule'

export interface QuickEventResult {
  title: string
  kind: CalendarEventKind
  course?: string
  start: Date
  end?: Date
  allDay: boolean
  /** ¿Se reconoció una fecha? (si no, es hoy y conviene que el estudiante lo revise) */
  hasDate: boolean
  /** Se repite («L y X», «todos los martes», «cada día hasta el 20 de diciembre», «todo el cuatrimestre»). */
  recurrence?: RecurrenceRule
  /** Zona con la que se entendió la frase. */
  timeZone: string
}

/** El borrador para guardarlo (las repeticiones, con la zona en la que se entendieron). */
export function quickEventDraft(r: QuickEventResult): CalendarEventDraft {
  return {
    title: r.title, kind: r.kind, start: r.start, end: r.end, allDay: r.allDay, course: r.course, recurrence: r.recurrence,
    timeZone: r.recurrence ? r.timeZone : undefined, isTask: r.kind === 'assignment'
  }
}

type Groups = string[]
interface Match { index: number; length: number; groups: Groups }

/** - text: lo que escribió el estudiante; - now: referencia para «hoy», «mañana», «el lunes»…; - timeZone: la del estudiante. */
export function parseQuickEvent(text: string, opts: { now?: Date; timeZone?: string } = {}): QuickEventResult | null {
  const original = text.trim()
  if (!original) return null
  const now = opts.now ?? new Date()
  const tz = opts.timeZone ?? localTimeZone()
  // se trabaja sobre el texto sin tildes ni mayúsculas (mismas posiciones que el original); lo reconocido se borra con
  // espacios en los dos, y lo que queda del original es el título
  let work = ' ' + fold(original) + ' '
  let titleBuffer = ' ' + original + ' '
  const aligned = work.length === titleBuffer.length
  const consume = (m: Match) => {
    const blank = ' '.repeat(m.length)
    work = work.slice(0, m.index) + blank + work.slice(m.index + m.length)
    if (aligned) titleBuffer = titleBuffer.slice(0, m.index) + blank + titleBuffer.slice(m.index + m.length)
  }
  const match = (pattern: string): Match | null => firstMatch(pattern, work)

  // MARK: repetición (antes que la fecha: «los lunes» no es «el lunes»)
  const today = startOfDay(now, tz)
  let repeatDays: number[] = []
  let frequency: RecurrenceFrequency | null = null
  let interval = 1
  let until: Date | null = null
  const letters: Record<string, number> = { l: 2, m: 3, x: 4, j: 5, v: 6, s: 7, d: 1 }
  // «L y X», «L, X y V», «M-J» (un guion es un intervalo: «L-V» es de lunes a viernes)
  {
    const m = match(String.raw`\s([lmxjvsd](?:\s*(?:,|y|e|-)\s*[lmxjvsd])+)\s`)
    if (m) {
      const week = [2, 3, 4, 5, 6, 7, 1] // de lunes a domingo
      const found: number[] = []
      let dash = false
      for (const ch of m.groups[1]) {
        if (ch === '-') { dash = true; continue }
        const n = letters[ch]
        if (n === undefined) continue
        const last = found[found.length - 1]
        const a = last !== undefined ? week.indexOf(last) : -1, b = week.indexOf(n)
        if (dash && last !== undefined && a >= 0 && b > a) found.push(...week.slice(a + 1, b + 1))
        else found.push(n)
        dash = false
      }
      if (found.length >= 2) { repeatDays = found; consume(m) }
    }
  }
  // «todos los lunes», «cada martes», «lunes y miércoles», «every Monday», «on Mondays and Wednesdays» («el lunes» es una vez)
  if (!repeatDays.length) {
    const wd = WEEKDAYS.map(([w]) => w).sort((a, b) => b.length - a.length).map(escapeRegex).join('|')
    const m = match(String.raw`\s((?:todos los|todas las|cada|los|every)\s+)?((?:` + wd + String.raw`)s?(?:\s*(?:,|y|e|and|&)\s*(?:` + wd + String.raw`)s?)*)\s`)
    if (m) {
      const names = m.groups[2].split(/[ ,&]/).filter((n) => n !== '' && n !== 'y' && n !== 'e' && n !== 'and')
      const days = names.map((n) => weekdayNumber(n) ?? weekdayNumber(n.slice(0, -1))).filter((d): d is number => d !== null)
      const plural = names.some((n) => n.endsWith('s') && weekdayNumber(n) === null) // «mondays»
      if (days.length && (m.groups[1] !== '' || days.length >= 2 || plural)) { repeatDays = days; consume(m) }
    }
  }
  // «diario» o «semanal» sueltos son un periódico o un informe, no una repetición
  if (!repeatDays.length) {
    const m = match(String.raw`\s(?:todos los dias|cada dia|a diario|diariamente|every day|daily)\s`)
    if (m) { frequency = 'DAILY'; consume(m) }
  }
  if (!repeatDays.length && frequency === null) {
    const m = match(String.raw`\s(cada semana|semanalmente|every week|weekly|cada dos semanas|cada 2 semanas|every other week|every 2 weeks|biweekly)\s`)
    if (m) {
      const g = m.groups[1]
      frequency = 'WEEKLY'
      interval = g.includes('2') || g.includes('dos') || g.includes('other') || g.includes('bi') ? 2 : 1
      consume(m)
    }
  }
  if (repeatDays.length) frequency = 'WEEKLY'
  if (frequency !== null) until = parseUntilPhrase(match, consume, today, tz)

  // MARK: día
  const found: { day: Date | null } = { day: null }
  const take = (pattern: string, handle: (g: Groups) => Date | null) => {
    if (found.day !== null) return
    const m = match(pattern)
    if (!m) return
    const d = handle(m.groups)
    if (!d) return
    found.day = d
    consume(m)
  }
  take(String.raw`\s(pasado manana|day after tomorrow)\s`, () => addDays(today, 2, tz))
  take(String.raw`\s(hoy|today|esta (?:tarde|noche|manana)|tonight|this (?:afternoon|evening|morning))\s`, () => today)
  take(String.raw`(?<!la)(?<!el)\s(manana|tomorrow)\s`, () => addDays(today, 1, tz))
  // los otros idiomas de la app (lo básico); en japonés, chino y coreano no hay espacios entre palabras
  for (const [offset, spaced, joined] of RELATIVE_DAYS) {
    take(String.raw`\s(` + spaced + String.raw`)\s`, () => addDays(today, offset, tz))
    take('(' + joined + ')', () => addDays(today, offset, tz))
  }
  take(String.raw`\s(?:dentro de|en|in)\s+(\d{1,3})\s+(?:dias|days)\s`, (g) => addDays(today, Number(g[1]), tz))
  take(String.raw`\s(?:el\s+|on\s+)?(\d{4})-(\d{1,2})-(\d{1,2})\s`, (g) => civilDate(Number(g[1]), Number(g[2]), Number(g[3]), tz))
  take(String.raw`\s(?:el\s+|on\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\s`, (g) => {
    const d = Number(g[1]), m = Number(g[2])
    // día/mes (como en español); si no puede ser (13/25 no; 10/25 sí: mes/día), se da la vuelta
    const [dd, mm] = m > 12 && d <= 12 ? [m, d] : [d, m]
    return futureDate(dd, mm, yearOf(g[3]), today, tz)
  })
  take(String.raw`\s(?:el\s+|on\s+)?(\d{1,2})\s+(?:de\s+)?(` + monthPattern() + String.raw`)(?:\s+(?:de\s+)?(\d{4}))?\s`, (g) => {
    const m = monthNumber(g[2])
    return m === null ? null : futureDate(Number(g[1]), m, g[3] ? Number(g[3]) : null, today, tz)
  })
  take(String.raw`\s(?:on\s+)?(` + monthPattern() + String.raw`)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s`, (g) => {
    const m = monthNumber(g[1])
    return m === null ? null : futureDate(Number(g[2]), m, g[3] ? Number(g[3]) : null, today, tz)
  })
  take(String.raw`\s(?:el\s+|este\s+|esta\s+|on\s+|this\s+)?(?:proximo\s+|next\s+)?(` + weekdayPattern() + String.raw`)(?:\s+que viene|\s+proximo)?\s`, (g) => {
    const wd = weekdayNumber(g[1])
    return wd === null ? null : nextWeekday(wd, today, tz)
  })
  take(String.raw`\s(?:el\s+|el dia\s+|on the\s+)(\d{1,2})(?:st|nd|rd|th)?\s`, (g) => {
    const d = Number(g[1])
    if (d < 1 || d > 31) return null
    return futureDate(d, wallTime(today, tz).month, null, today, tz, true)
  })

  // MARK: hora
  let startTime: HourMinute | null = null
  let endTime: HourMinute | null = null
  {
    const m = match(String.raw`\s(?:de|desde|from)\s+(?:las\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\s+(?:a|hasta|to|-)\s+(?:las\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\s`) ??
      match(String.raw`\s(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\s`)
    if (m) {
      const q = qualifierAfter(m, work)
      const a = hour(m.groups[1], m.groups[2], m.groups[3], q), b = hour(m.groups[4], m.groups[5], m.groups[6], q)
      if (a && b) {
        startTime = a
        endTime = b.h * 60 + b.m > a.h * 60 + a.m ? b : { h: Math.min(23, b.h + 12), m: b.m }
        consume(m)
      }
    }
  }
  if (!startTime) {
    const m = match(String.raw`\s(?:a las|a la|at|@)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\s`) ?? match(String.raw`\s(\d{1,2}):(\d{2})\s*(am|pm|h)?\s`) ??
      match(String.raw`\s(\d{1,2})()\s*(am|pm)\s`)
    if (m) {
      const t = hour(m.groups[1], m.groups[2], m.groups[3], qualifierAfter(m, work))
      if (t) { startTime = t; consume(m) }
    }
  }
  if (!startTime) {
    const m = match(String.raw`\s(?:a\s+)?(?:mediodia|noon)\s`)
    if (m) { startTime = { h: 12, m: 0 }; consume(m) }
  }
  // otros idiomas: «à 10 h», «às 10h30» (con la h: «a 3» suelto es español), «um 10 Uhr», «alle 10», «в 10», «10時», «10点», «10시»
  if (!startTime) {
    const m = match(String.raw`\s(?:a|as|vers)\s+(\d{1,2})\s*h\s*(\d{2})?\s`) ?? match(String.raw`\s(?:um|alle|ore|в)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|ч)?\s`) ??
      match(String.raw`(\d{1,2})\s*(?:時|时|点|點|시)(?:\s*(\d{1,2})\s*(?:分|분))?`)
    if (m) {
      const t = hour(m.groups[1], m.groups[2], 'h', '')
      if (t) { startTime = t; consume(m) }
    }
  }
  // «de la mañana / tarde / noche» sueltos (ya contaron para la hora)
  {
    const m = match(String.raw`\s(?:de la|por la|in the)\s+(?:manana|tarde|noche|morning|afternoon|evening)\s`)
    if (m) consume(m)
  }

  // MARK: título
  let titleText = cleanTitle(aligned ? titleBuffer : work)
  if (!titleText) titleText = original
  const kind = detectKind(fold(titleText))
  const course = detectCourse(titleText)
  const allDay = startTime === null
  const day = found.day
  const base: Date = day ?? today
  const st = startTime as HourMinute | null
  let start = st ? settingTime(base, st.h, st.m, 0, tz) : base
  // sin fecha y la hora ya pasó hoy: mañana
  if (day === null && st && start.getTime() < now.getTime()) start = addDays(start, 1, tz)
  let end: Date | undefined
  const et = endTime as HourMinute | null
  if (et) end = settingTime(startOfDay(start, tz), et.h, et.m, 0, tz)
  else if (!allDay) end = new Date(start.getTime() + (kind === 'assignment' ? 0 : isAssessmentKind(kind) ? 2 * 3_600_000 : 3_600_000))
  if (kind === 'assignment') end = undefined
  let recurrence: RecurrenceRule | undefined
  if (frequency !== null) {
    // la primera vez: el primer día de los pedidos desde hoy (hoy mismo si aún no pasó la hora)
    if (repeatDays.length && day === null) {
      const duration = end ? end.getTime() - start.getTime() : undefined
      for (let offset = 0; offset < 8; offset++) {
        const d = addDays(today, offset, tz)
        if (!repeatDays.includes(wallTime(d, tz).weekday)) continue
        const candidate = st ? settingTime(d, st.h, st.m, 0, tz) : d
        if (candidate.getTime() < now.getTime() && offset === 0 && st) continue
        start = candidate
        end = duration !== undefined ? new Date(candidate.getTime() + duration) : undefined
        break
      }
    }
    const u = until as Date | null
    recurrence = makeRecurrenceRule({
      frequency, interval, until: u ? new Date(Math.max(u.getTime(), start.getTime())) : undefined,
      byDay: [...new Set(repeatDays)].sort((a, b) => a - b).map((w) => ({ weekday: w }))
    })
  }
  // algo que se repite cada semana a una hora y no dice qué es: una clase («Cálculo L y X de 10 a 11»)
  const finalKind: CalendarEventKind = recurrence && kind === 'event' && !allDay && frequency === 'WEEKLY' ? 'lecture' : kind
  const out: QuickEventResult = { title: titleText, kind: finalKind, start, allDay, hasDate: day !== null || recurrence !== undefined, timeZone: tz }
  if (course) out.course = course
  if (end) out.end = end
  if (recurrence) out.recurrence = recurrence
  return out
}

/** Hasta cuándo se repite (y lo borra del texto). */
function parseUntilPhrase(match: (p: string) => Match | null, consume: (m: Match) => void, today: Date, tz: string): Date | null {
  // «todo el cuatrimestre», «the whole semester»
  let m = match(String.raw`\s(?:todo el|durante el|all|the whole)\s+(cuatrimestre|semestre|trimestre|term|semester|quarter)\s`)
  if (m) {
    const months = ({ cuatrimestre: 4, semestre: 6, trimestre: 3, term: 4, semester: 6, quarter: 3 } as Record<string, number>)[m.groups[1]] ?? 4
    consume(m)
    return endOfDay(addMonths(today, months, tz), tz)
  }
  m = match(String.raw`\s(?:durante|for)\s+(\d{1,2})\s+(?:semanas|weeks)\s`)
  if (m) {
    consume(m)
    return new Date(addDays(today, 7 * Number(m.groups[1]), tz).getTime() - 1000)
  }
  m = match(String.raw`\s(?:hasta el|hasta|until)\s+(\d{1,2})\s+(?:de\s+)?(` + monthPattern() + String.raw`)(?:\s+(?:de\s+)?(\d{4}))?\s`)
  if (m) {
    const mo = monthNumber(m.groups[2])
    const date = mo !== null ? futureDate(Number(m.groups[1]), mo, m.groups[3] ? Number(m.groups[3]) : null, today, tz) : null
    if (date) { consume(m); return endOfDay(date, tz) }
  }
  m = match(String.raw`\s(?:until)\s+(` + monthPattern() + String.raw`)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s`)
  if (m) {
    const mo = monthNumber(m.groups[1])
    const date = mo !== null ? futureDate(Number(m.groups[2]), mo, m.groups[3] ? Number(m.groups[3]) : null, today, tz) : null
    if (date) { consume(m); return endOfDay(date, tz) }
  }
  m = match(String.raw`\s(?:hasta el|hasta|until)\s+(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\s`)
  if (m) {
    const d = Number(m.groups[1]), mo = Number(m.groups[2])
    const [dd, mm] = mo > 12 && d <= 12 ? [mo, d] : [d, mo]
    const date = futureDate(dd, mm, yearOf(m.groups[3]), today, tz)
    if (date) { consume(m); return endOfDay(date, tz) }
    return null
  }
  m = match(String.raw`\s(?:hasta el|hasta|until)\s+(?:el\s+|next\s+|proximo\s+)?(` + weekdayPattern() + String.raw`)\s`)
  if (m) {
    const wd = weekdayNumber(m.groups[1])
    const date = wd !== null ? nextWeekday(wd, today, tz) : null
    // «hasta el viernes»: el final, no el día en que empieza
    if (date) { consume(m); return endOfDay(date, tz) }
  }
  m = match(String.raw`\s(?:hasta|until)\s+(?:(?:el\s+)?(?:final|fin)\s+de\s+|the end of\s+|end of\s+)?(` + monthPattern() + String.raw`)(?:\s+(?:de\s+)?(\d{4}))?\s`)
  if (m) {
    const mo = monthNumber(m.groups[1])
    const last = mo !== null ? lastDayOfMonth(mo, m.groups[2] ? Number(m.groups[2]) : null, today, tz) : null
    // «hasta diciembre»: hasta el último día de ese mes (el de este año, o el del que viene si ya pasó)
    if (last) { consume(m); return endOfDay(last, tz) }
  }
  return null
}

// MARK: - Piezas

interface HourMinute { h: number; m: number }

function yearOf(g: string | undefined): number | null {
  if (!g) return null
  const n = Number(g)
  return n < 100 ? 2000 + n : n
}

/** El último día de un mes: el de `year` o, sin año, el próximo que no haya terminado. */
export function lastDayOfMonth(month: number, year: number | null, today: Date, tz: string): Date | null {
  if (month < 1 || month > 12) return null
  const last = (y: number) => new Date(makeInstant(y, month + 1, 0, 0, 0, 0, tz))
  const y = year ?? wallTime(today, tz).year
  const d = last(y)
  return year === null && d.getTime() < today.getTime() ? last(y + 1) : d
}

/** Meses (es/en, con abreviaturas). */
export const MONTHS: [string, number][] = [
  ['enero', 1], ['febrero', 2], ['marzo', 3], ['abril', 4], ['mayo', 5], ['junio', 6], ['julio', 7], ['agosto', 8], ['septiembre', 9], ['setiembre', 9],
  ['octubre', 10], ['noviembre', 11], ['diciembre', 12],
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6], ['july', 7], ['august', 8], ['september', 9], ['october', 10],
  ['november', 11], ['december', 12],
  ['ene', 1], ['feb', 2], ['mar', 3], ['abr', 4], ['jun', 6], ['jul', 7], ['ago', 8], ['sep', 9], ['sept', 9], ['oct', 10], ['nov', 11], ['dic', 12],
  ['jan', 1], ['apr', 4], ['aug', 8], ['dec', 12]
]

/** Días de la semana (es/en): 1 = domingo … 7 = sábado. */
export const WEEKDAYS: [string, number][] = [
  ['domingo', 1], ['lunes', 2], ['martes', 3], ['miercoles', 4], ['jueves', 5], ['viernes', 6], ['sabado', 7],
  ['sunday', 1], ['monday', 2], ['tuesday', 3], ['wednesday', 4], ['thursday', 5], ['friday', 6], ['saturday', 7]
]

/** Los 12 idiomas de la app. */
const APP_LANGUAGES = ['es', 'en', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'ja', 'zh-Hans', 'ko']

let localeSymbolsCache: { weekdays: [string, number][]; months: [string, number][] } | null = null

/** Días y meses de todos los idiomas de la app (formas sueltas y dentro de una fecha), sin tildes ni mayúsculas. */
function localeSymbols(): { weekdays: [string, number][]; months: [string, number][] } {
  if (localeSymbolsCache) return localeSymbolsCache
  const wd: [string, number][] = [], mo: [string, number][] = []
  const seenW = new Set<string>(), seenM = new Set<string>()
  const add = (list: [string, number][], seen: Set<string>, raw: string | undefined, n: number) => {
    if (!raw) return
    const f = fold(raw).trim()
    if (Array.from(f).length >= 2 && !seen.has(f)) { seen.add(f); list.push([f, n]) }
  }
  for (const code of APP_LANGUAGES) {
    try {
      const wFmt = new Intl.DateTimeFormat(code, { weekday: 'long', timeZone: 'UTC' })
      const wInDate = new Intl.DateTimeFormat(code, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      for (const fmt of [wInDate, wFmt]) {
        for (let i = 1; i <= 7; i++) {
          const date = new Date(Date.UTC(1970, 0, 3 + i)) // 4-ene-1970: domingo
          add(wd, seenW, fmt.formatToParts(date).find((p) => p.type === 'weekday')?.value, i)
        }
      }
      const mInDate = new Intl.DateTimeFormat(code, { day: 'numeric', month: 'long', timeZone: 'UTC' })
      const mFmt = new Intl.DateTimeFormat(code, { month: 'long', timeZone: 'UTC' })
      for (const fmt of [mInDate, mFmt]) {
        for (let m = 1; m <= 12; m++) {
          const date = new Date(Date.UTC(2001, m - 1, 15))
          add(mo, seenM, fmt.formatToParts(date).find((p) => p.type === 'month')?.value, m)
        }
      }
    } catch {
      /* idioma no disponible */
    }
  }
  localeSymbolsCache = { weekdays: wd, months: mo }
  return localeSymbolsCache
}

let allWeekdaysCache: [string, number][] | null = null
let allMonthsCache: [string, number][] | null = null
function allWeekdays(): [string, number][] {
  if (!allWeekdaysCache) allWeekdaysCache = [...WEEKDAYS, ...localeSymbols().weekdays.filter(([w]) => !WEEKDAYS.some(([x]) => x === w))]
  return allWeekdaysCache
}
function allMonths(): [string, number][] {
  if (!allMonthsCache) allMonthsCache = [...MONTHS, ...localeSymbols().months.filter(([m]) => !MONTHS.some(([x]) => x === m))]
  return allMonthsCache
}

let monthPatternCache: string | null = null
let weekdayPatternCache: string | null = null
function monthPattern(): string {
  if (!monthPatternCache) monthPatternCache = allMonths().map(([m]) => m).sort((a, b) => b.length - a.length).map(escapeRegex).join('|')
  return monthPatternCache
}
function weekdayPattern(): string {
  if (!weekdayPatternCache) weekdayPatternCache = allWeekdays().map(([w]) => w).sort((a, b) => b.length - a.length).map(escapeRegex).join('|')
  return weekdayPatternCache
}
function monthNumber(s: string): number | null {
  return allMonths().find(([m]) => m === s)?.[1] ?? null
}
function weekdayNumber(s: string): number | null {
  return allWeekdays().find(([w]) => w === s)?.[1] ?? null
}

/** «Hoy», «mañana» y «pasado mañana» en los otros idiomas: (días, palabras entre espacios, palabras sin espacios).
 *  Pasado mañana va primero («depois de amanhã» lleva dentro «amanhã»). */
const RELATIVE_DAYS: [number, string, string][] = (() => {
  const alt = (words: string[]) => words.map((w) => escapeRegex(fold(w))).join('|')
  return [
    [2, alt(['après-demain', 'übermorgen', 'dopodomani', 'depois de amanhã', 'послезавтра', 'بعد غد', 'परसों']), alt(['明後日', 'あさって', '后天', '後天', '모레'])],
    [0, alt(["aujourd'hui", 'aujourd’hui', 'heute', 'oggi', 'hoje', 'сегодня', 'اليوم', 'आज']), alt(['今日', 'きょう', '今天', '오늘'])],
    [1, alt(['demain', 'morgen', 'domani', 'amanhã', 'завтра', 'غدا', 'غدًا', 'कल']), alt(['明日', 'あした', '明天', '내일'])]
  ]
})()

/** Sin tildes ni mayúsculas, carácter a carácter (para que las posiciones coincidan con las del original). */
export function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === ' ') { out += ' '; continue }
    if (/\p{M}/u.test(ch)) continue // una marca suelta se va (como en Swift: el texto ya no está alineado)
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
    const lower = base.toLowerCase()
    if (lower.length === ch.length) out += lower
    else if (ch.toLowerCase().length === ch.length) out += ch.toLowerCase()
    else out += ch
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

const regexCache = new Map<string, RegExp>()

/** Primera coincidencia (sin el espacio final, que se deja para el patrón siguiente) y sus grupos («» si no participan). */
function firstMatch(pattern: string, text: string): Match | null {
  let re = regexCache.get(pattern)
  if (!re) {
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      return null
    }
    if (regexCache.size > 200) regexCache.clear()
    regexCache.set(pattern, re)
  }
  const m = re.exec(text)
  if (!m) return null
  let length = m[0].length
  if (length > 1 && m[0].endsWith(' ')) length -= 1
  return { index: m.index, length, groups: Array.from(m, (g) => g ?? '') }
}

/** Una fecha civil (00:00 en la zona). */
function civilDate(y: number, m: number, d: number, tz: string): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return new Date(makeInstant(y, m, d, 0, 0, 0, tz))
}

/** La próxima vez que cae ese día y mes (este año o el siguiente; o el mes siguiente con `rollMonth`). */
function futureDate(day: number, month: number, year: number | null, today: Date, tz: string, rollMonth = false): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const y = year ?? wallTime(today, tz).year
  let d = civilDate(y, month, day, tz)
  if (!d || wallTime(d, tz).day !== day) return null
  if (year === null && d.getTime() < today.getTime()) d = rollMonth ? addMonths(d, 1, tz) : addYears(d, 1, tz)
  return d
}

/** El próximo día de la semana `wd` (sin contar hoy: «el lunes» dicho un lunes es el de la semana que viene). */
function nextWeekday(wd: number, today: Date, tz: string): Date | null {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i, tz)
    if (wallTime(d, tz).weekday === wd) return d
  }
  return null
}

/** «de la mañana/tarde/noche» o «in the morning/afternoon/evening» justo después de la hora. */
function qualifierAfter(m: Match, text: string): string {
  const rest = text.slice(Math.min(text.length, m.index + m.length)).replace(/^[ \t]+|[ \t]+$/g, '')
  const table: [string, string][] = [
    ['de la manana', 'am'], ['por la manana', 'am'], ['in the morning', 'am'], ['de la tarde', 'pm'], ['por la tarde', 'pm'], ['in the afternoon', 'pm'],
    ['de la noche', 'pm'], ['por la noche', 'pm'], ['in the evening', 'pm'], ['at night', 'pm']
  ]
  for (const [k, v] of table) if (rest.startsWith(k)) return v
  return ''
}

function hour(h: string, m: string, suffix: string, qualifier: string): HourMinute | null {
  if (!/^\d+$/.test(h)) return null
  let hh = Number(h)
  if (hh < 0 || hh > 24) return null
  const mm = /^\d+$/.test(m) ? Number(m) : 0
  if (mm < 0 || mm > 59) return null
  const s = suffix.toLowerCase() === '' ? qualifier : suffix.toLowerCase()
  if (s === 'pm') { if (hh < 12) hh += 12 }
  else if (s === 'am') { if (hh === 12) hh = 0 }
  else if (s !== 'h') {
    // «a las 5» sin más: por la tarde (nadie tiene clase a las 5 de la madrugada)
    if (hh >= 1 && hh <= 7 && m === '') hh += 12
  }
  return { h: Math.min(hh, 23), m: mm }
}

const TITLE_TAILS = ['el', 'la', 'los', 'las', 'a', 'a las', 'de', 'del', 'para', 'para el', 'on', 'at', 'the', 'for', 'y', 'and', ',', '-', '·', 'le', 'à', 'am', 'um', 'il', 'às', 'в']

/** Quita los espacios de más y las palabras sueltas que quedan al quitar la fecha («… el», «… a las», «para el»). */
export function cleanTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim()
  let changed = true
  while (changed) {
    changed = false
    for (const w of TITLE_TAILS) {
      const lower = t.toLowerCase()
      if (lower.endsWith(' ' + w)) { t = t.slice(0, t.length - (w.length + 1)).trim(); changed = true }
      if (lower === w) { t = ''; changed = true }
    }
  }
  t = t.replace(/^[ ,.\-·:]+|[ ,.\-·:]+$/g, '')
  const first = Array.from(t)[0]
  return first ? first.toUpperCase() + t.slice(first.length) : t
}

const hasWord = (t: string, words: string[]) => words.some((w) => new RegExp('\\b' + w).test(t))

/** El tipo por las palabras del título (ya sin tildes ni mayúsculas). */
export function detectKind(t: string): CalendarEventKind {
  if (hasWord(t, ['quiz', 'cuestionario', 'control de lectura'])) return 'quiz'
  if (hasWord(t, ['examen', 'parcial', 'final', 'prueba', 'test', 'exam', 'midterm', 'certamen', 'evaluacion'])) return 'exam'
  if (hasWord(t, ['entrega', 'entregar', 'tarea', 'deadline', 'due', 'homework', 'assignment', 'trabajo', 'proyecto', 'informe'])) return 'assignment'
  if (hasWord(t, ['clase', 'laboratorio', 'lab', 'tutoria', 'seminario', 'class', 'lecture', 'seminar'])) return 'lecture'
  if (hasWord(t, ['estudiar', 'repasar', 'study', 'review', 'repaso'])) return 'study'
  return 'event'
}

const COURSE_STARTS = ['examen', 'parcial', 'final', 'prueba', 'quiz', 'cuestionario', 'entrega', 'tarea', 'clase', 'laboratorio', 'estudiar', 'repasar', 'repaso', 'control', 'trabajo']

/** «Prueba de inglés» → «Inglés»; «Parcial 2 de Física I» → «Física I». */
export function detectCourse(title: string): string | undefined {
  const folded = fold(title)
  if (!COURSE_STARTS.some((w) => folded.startsWith(w) || folded.includes(' ' + w))) return undefined
  const m = /\s(?:de|del|of)\s+(.+)$/i.exec(title)
  if (!m) return undefined
  const c = m[0].replace(/^\s(?:de|del|of)\s+/i, '').trim()
  if (!c || Array.from(c).length > 40) return undefined
  // «la práctica 3» no es una asignatura
  if (['la ', 'el ', 'los ', 'las ', 'mi ', 'the '].some((p) => fold(c).startsWith(p))) return undefined
  const first = Array.from(c)[0]
  return first.toUpperCase() + c.slice(first.length)
}
