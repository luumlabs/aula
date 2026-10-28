// Lector de calendarios iCalendar (RFC 5545), portado de CanvasKit/ICS/ICSParser.swift: el feed de Canvas («Fuente del
// calendario»), Google Calendar, Outlook y Apple Calendar.
//
// - Líneas desdobladas, escapes de texto, `VEVENT` y `VTODO` (con `DUE`).
// - Fechas `VALUE=DATE` (todo el día), `DATE-TIME` local, UTC (`Z`), con desfase y con `TZID` (IANA o nombres de Windows).
//   Una zona desconocida se trata como hora flotante de la zona indicada.
// - `RRULE` (DAILY / WEEKLY / MONTHLY / YEARLY…), `EXDATE`, `RDATE`, `RECURRENCE-ID`; como mucho 200 ocurrencias por evento,
//   las de alrededor de hoy (no se calculan las de antes: solo se cuentan para `COUNT`).
// - Topes de toda la lectura (`ICS_LIMITS`: eventos, fechas y vueltas de las reglas): si se pasan, `ICSLimitError`.
// - Canvas pone el curso entre corchetes al final del título (`Examen 2 [MATH112-12345]`): se separa en `course` (`MATH112`).
import { addDays, daysBetween, fixedOffsetZone, localTimeZone, makeInstant, startOfDay, UTC, wallTime } from '@engine/calendar/time'
import { tr } from '@shared/ai/i18n'
import { CourseCode } from './courseCode'
import { ExamDetector } from './examDetector'
import { stableID, swiftDouble } from './hash'
import { htmlToMarkdown } from './htmlText'
import { parseDateValue, parseLine, unescapeText, unfold, utcSecondsOf, type ICSDateValue, type ICSProperty } from './lexer'
import { ICSBudget, ICSLimitErrors, type ICSLimits } from './limits'
import { icsOccurrenceWindow, parseICSRule } from './recurrence'
import { chronological, clipped, type StudyEvent, type StudyEventKind } from './studyEvent'

/** Máximo de ocurrencias que se generan por evento recurrente. */
export const MAX_OCCURRENCES_PER_EVENT = 200

/** Título de los eventos sin `SUMMARY`, en el idioma de la interfaz al leer el archivo (por eso es una función). */
export function untitledEvent(): string {
  return tr('(Sin título)', '(Untitled)')
}

export interface ICSParseOptions {
  /** Referencia para acotar las series sin fin (se generan hasta ~2 años desde `now`). */
  now?: Date
  /** Zona de las horas flotantes y de la medianoche de los eventos de todo el día (por defecto, la del sistema). */
  timeZone?: string
  /** Topes de la lectura (por defecto, `ICS_LIMITS`). */
  limits?: Partial<ICSLimits>
}

/** Lee un `.ics` (texto o bytes). Los bytes se desdoblan antes de decodificar (recompone UTF-8 partido al plegar) y se
 *  aceptan Windows-1252 y UTF-16. Devuelve los eventos ordenados por fecha; un evento defectuoso se omite sin afectar al resto.
 *  Lanza `ICSLimitError` si el calendario se pasa de los topes (`ICS_LIMITS`). */
export function parseICS(input: string | Uint8Array, opts: ICSParseOptions = {}): StudyEvent[] {
  const ctx = new Context(opts.now ?? new Date(), opts.timeZone ?? localTimeZone(), new ICSBudget(opts.limits))
  const raws = collectComponents(linesOf(input), ctx.budget.limits.maxEvents)
  const events = convert(raws, ctx)
  events.sort(chronological)
  return events
}

function linesOf(input: string | Uint8Array): string[] {
  if (typeof input === 'string') return unfold(input)
  const text = decodeUTF16(input)
  return text !== null ? unfold(text) : unfold(input)
}

/** Un evento del .ics con su regla de repetición tal cual (para importarlo como evento propio que se repite, no como
 *  cientos de copias). Las repeticiones cambiadas (`RECURRENCE-ID`) van en `changed`; las canceladas, en `excluded`. */
export interface ICSSeries {
  /** UID del archivo (o uno estable si no lo trae). */
  uid: string
  /** La primera vez: título, curso, tipo, fechas… (con `id` = `uid`). */
  event: StudyEvent
  isTodo: boolean
  /** Una tarea (`VTODO`) marcada como completada. */
  completed: boolean
  /** El valor de `RRULE` tal cual (o `null`). */
  rule: string | null
  /** Zona de la hora de pared del inicio (IANA, «UTC» o desfase fijo «+02:00»). */
  zone: string
  /** Lleva `RDATE` (fechas sueltas que una regla no recoge). */
  hasExtraDates: boolean
  /** Todas las veces ya expandidas (sin las quitadas ni las cambiadas), por si la regla no se puede guardar tal cual. */
  occurrences: Date[]
  /** Inicios originales quitados (`EXDATE` o una repetición cancelada). */
  excluded: Date[]
  /** Repeticiones cambiadas solo esa vez: su inicio original y cómo quedan. */
  changed: { original: Date; event: StudyEvent }[]
}

/** Lee un `.ics` como series (una por `UID`), sin expandirlas en eventos sueltos. Para importar un archivo. Lanza
 *  `ICSLimitError` si se pasa de los topes. */
export function parseICSSeries(input: string | Uint8Array, opts: ICSParseOptions = {}): ICSSeries[] {
  const ctx = new Context(opts.now ?? new Date(), opts.timeZone ?? localTimeZone(), new ICSBudget(opts.limits))
  const raws = collectComponents(linesOf(input), ctx.budget.limits.maxEvents)
  const masters = new Map<string, ICSSeries>()
  const out: ICSSeries[] = []
  const pendingChanges: RawEvent[] = []
  let counter = 0
  for (const r of raws) {
    if (r.recurrenceID) { pendingChanges.push(r); continue }
    if (r.status === 'CANCELLED') continue
    const base = baseEvent(r, ctx)
    if (!base) continue
    counter += 1
    const uid = r.uid ? r.uid : 'evento-' + stableID(`${base.event.title}|${swiftDouble(base.start / 1000)}|${counter}`)
    if (masters.has(uid)) continue
    const repeats = r.rrule !== null || r.rdates.length > 0
    if (!repeats) ctx.budget.occurrence()
    const dates = repeats ? seriesDates(r, base, ctx, new Set()) : null
    const kept = dates ? dates.kept() : [base.start]
    const all = dates ? dates.all() : [base.start]
    const keptSet = new Set(kept)
    const last = kept.length ? kept[kept.length - 1] : Number.NEGATIVE_INFINITY
    const s: ICSSeries = {
      uid, event: { ...base.event, id: uid }, isTodo: r.isTodo, completed: r.isTodo && r.status === 'COMPLETED', rule: r.rrule?.trim() || null,
      zone: base.allDay ? ctx.display : ctx.zone(base.startValue), hasExtraDates: r.rdates.length > 0,
      occurrences: kept.map((d) => new Date(d)), excluded: all.filter((d) => !keptSet.has(d) && d <= last).map((d) => new Date(d)), changed: []
    }
    masters.set(uid, s)
    out.push(s)
  }
  // las repeticiones cambiadas van con su serie; sin serie, son eventos sueltos
  for (const r of pendingChanges) {
    const v = parseProp(r.recurrenceID)
    const base = baseEvent(r, ctx)
    if (!v || !base) continue
    const original = new Date(ctx.instant(v))
    const master = r.uid ? masters.get(r.uid) : undefined
    if (master) {
      if (r.status === 'CANCELLED') master.excluded.push(original)
      else master.changed.push({ original, event: { ...base.event, id: `${master.uid}#${compactStamp(original.getTime())}` } })
      master.occurrences = master.occurrences.filter((d) => d.getTime() !== original.getTime())
      continue
    }
    if (r.status === 'CANCELLED') continue
    const uid = `${r.uid ?? 'evento'}#${compactStamp(original.getTime())}`
    if (masters.has(uid)) continue
    const s: ICSSeries = {
      uid, event: { ...base.event, id: uid }, isTodo: r.isTodo, completed: r.isTodo && r.status === 'COMPLETED', rule: null,
      zone: base.allDay ? ctx.display : ctx.zone(base.startValue), hasExtraDates: false, occurrences: [new Date(base.start)], excluded: [], changed: []
    }
    masters.set(uid, s)
    out.push(s)
  }
  for (const s of out) s.excluded.sort((a, b) => a.getTime() - b.getTime())
  return out.sort((a, b) => chronological(a.event, b.event))
}

/** Texto de unos bytes con BOM de UTF-16 (o `null` si no lo llevan). */
export function decodeUTF16(bytes: Uint8Array): string | null {
  if (bytes.length < 2) return null
  const le = bytes[0] === 0xff && bytes[1] === 0xfe
  const be = bytes[0] === 0xfe && bytes[1] === 0xff
  if (!le && !be) return null
  try {
    return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(2))
  } catch {
    return null
  }
}

// MARK: - Componentes

interface RawEvent {
  isTodo: boolean
  uid: string | null
  summary: string | null
  description: string | null
  altDescription: string | null
  url: string | null
  location: string | null
  categories: string[]
  dtstart: ICSProperty | null
  dtend: ICSProperty | null
  due: ICSProperty | null
  duration: string | null
  status: string | null
  rrule: string | null
  exdates: ICSProperty[]
  rdates: ICSProperty[]
  recurrenceID: ICSProperty | null
}

interface Frame {
  name: string
  props: ICSProperty[]
}

function collectComponents(lines: string[], maxEvents: number): RawEvent[] {
  const stack: Frame[] = []
  const out: RawEvent[] = []
  const add = (frame: Frame, isTodo: boolean) => {
    if (out.length >= maxEvents) throw ICSLimitErrors.tooManyEvents(maxEvents)
    out.push(makeRaw(frame, isTodo))
  }
  for (const line of lines) {
    const prop = parseLine(line)
    if (!prop) continue
    if (prop.name === 'BEGIN') {
      stack.push({ name: prop.value.trim().toUpperCase(), props: [] })
    } else if (prop.name === 'END') {
      const name = prop.value.trim().toUpperCase()
      let idx = -1
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { idx = i; break }
      if (idx < 0) continue
      const frame = stack[idx]
      stack.splice(idx)
      if (name === 'VEVENT' || name === 'VTODO') add(frame, name === 'VTODO')
    } else if (stack.length) {
      stack[stack.length - 1].props.push(prop)
    }
  }
  // componentes sin cerrar al final (archivo truncado): se aprovechan los eventos completos
  for (const frame of stack) if (frame.name === 'VEVENT' || frame.name === 'VTODO') add(frame, frame.name === 'VTODO')
  return out
}

function makeRaw(frame: Frame, isTodo: boolean): RawEvent {
  const r: RawEvent = {
    isTodo, uid: null, summary: null, description: null, altDescription: null, url: null, location: null, categories: [], dtstart: null,
    dtend: null, due: null, duration: null, status: null, rrule: null, exdates: [], rdates: [], recurrenceID: null
  }
  for (const p of frame.props) {
    switch (p.name) {
      case 'UID': r.uid = p.value.trim(); break
      case 'SUMMARY': r.summary = unescapeText(p.value); break
      case 'DESCRIPTION': r.description = unescapeText(p.value); break
      case 'X-ALT-DESC': r.altDescription = unescapeText(p.value); break
      case 'URL': r.url = p.value.trim(); break
      case 'LOCATION': r.location = unescapeText(p.value); break
      case 'CATEGORIES':
        r.categories.push(...unescapeText(p.value).split(',').map((s) => s.trim()).filter((s) => s !== ''))
        break
      case 'DTSTART': r.dtstart = r.dtstart ?? p; break
      case 'DTEND': r.dtend = r.dtend ?? p; break
      case 'DUE': r.due = r.due ?? p; break
      case 'DURATION': r.duration = p.value.trim(); break
      case 'STATUS': r.status = p.value.trim().toUpperCase(); break
      case 'RRULE': r.rrule = r.rrule ?? p.value; break
      case 'EXDATE': r.exdates.push(p); break
      case 'RDATE': r.rdates.push(p); break
      case 'RECURRENCE-ID': r.recurrenceID = p; break
    }
  }
  return r
}

// MARK: - Contexto de conversión

class Context {
  constructor(readonly now: Date, readonly display: string, readonly budget: ICSBudget) {}

  /** Zona en la que se interpreta el valor (para expandir recurrencias conservando la hora local). */
  zone(v: ICSDateValue): string {
    switch (v.zone.t) {
      case 'utc': return UTC
      case 'offset': return fixedOffsetZone(v.zone.seconds)
      case 'zone': return v.zone.id
      case 'floating': return this.display
    }
  }

  /** Instante (ms) de un valor. Los de solo fecha son la medianoche local de la zona de visualización. */
  instant(v: ICSDateValue): number {
    if (!v.hasTime || v.zone.t === 'floating') return localInstant(v, this.display)
    switch (v.zone.t) {
      case 'utc': return utcSecondsOf(v, 0) * 1000
      case 'offset': return utcSecondsOf(v, v.zone.seconds) * 1000
      case 'zone': return localInstant(v, v.zone.id)
    }
  }
}

function localInstant(v: ICSDateValue, tz: string): number {
  return v.hasTime ? makeInstant(v.year, v.month, v.day, v.hour, v.minute, v.second, tz) : makeInstant(v.year, v.month, v.day, 0, 0, 0, tz)
}

function parseProp(p: ICSProperty | null): ICSDateValue | null {
  return p ? parseDateValue(p.value, p.params) : null
}

// MARK: - Conversión a StudyEvent

interface Base {
  event: StudyEvent
  start: number
  /** Duración en ms (eventos con hora). `null` si no hay fin. */
  length: number | null
  allDay: boolean
  /** Días de duración (eventos de todo el día). */
  allDayDays: number
  startValue: ICSDateValue
}

function convert(raws: RawEvent[], ctx: Context): StudyEvent[] {
  // instancias modificadas de una serie: se excluyen de la expansión de su serie
  const overridden = new Map<string, Set<number>>()
  for (const r of raws) {
    if (!r.recurrenceID || !r.uid) continue
    const v = parseProp(r.recurrenceID)
    if (!v) continue
    const set = overridden.get(r.uid) ?? new Set<number>()
    set.add(ctx.instant(v))
    overridden.set(r.uid, set)
  }

  const out: StudyEvent[] = []
  const usedIDs = new Set<string>()
  let counter = 0
  for (const r of raws) {
    if (r.status === 'CANCELLED') continue
    const base = baseEvent(r, ctx)
    if (!base) continue
    counter += 1
    const uid = r.uid ? r.uid : 'evento-' + stableID(`${base.event.title}|${swiftDouble(base.start / 1000)}|${counter}`)

    let starts = [base.start]
    if (r.recurrenceID === null && (r.rrule !== null || r.rdates.length > 0)) {
      starts = seriesDates(r, base, ctx, overridden.get(uid) ?? new Set()).kept()
    } else {
      ctx.budget.occurrence()
    }
    const recurring = starts.length > 1 || (r.rrule !== null && r.recurrenceID === null)
    for (const s of starts) {
      const event: StudyEvent = { ...base.event, start: new Date(s) }
      if (base.length !== null) event.end = base.allDay ? addDays(s, base.allDayDays, ctx.display) : new Date(s + base.length)
      let id = uid
      if (recurring || r.recurrenceID !== null) id += '#' + compactStamp(s)
      if (usedIDs.has(id)) {
        let n = 2
        while (usedIDs.has(`${id}~${n}`)) n += 1
        id = `${id}~${n}`
      }
      usedIDs.add(id)
      event.id = id
      out.push(event)
    }
  }
  return out
}

const CANVAS_UID_PREFIXES = ['event-assignment', 'event-calendar-event', 'event-quiz', 'event-discussion']
const hasLetter = (s: string) => /\p{L}/u.test(s)
const hasNumber = (s: string) => /\p{N}/u.test(s)

function baseEvent(r: RawEvent, ctx: Context): Base | null {
  // --- Fechas
  const startProp = r.isTodo ? r.due ?? r.dtstart : r.dtstart ?? r.due
  const sv = parseProp(startProp)
  if (!sv || sv.year < 1 || sv.year > 9999) return null
  const start = ctx.instant(sv)
  if (!Number.isFinite(start)) return null
  const allDay = !sv.hasTime

  let end: number | null = null
  let length: number | null = null
  let days = 1
  if (!r.isTodo) {
    const ev = parseProp(r.dtend)
    const e = ev ? ctx.instant(ev) : null
    const seconds = r.duration !== null ? parseICSDuration(r.duration) : null
    if (e !== null && e >= start) {
      end = e
    } else if (seconds !== null) {
      if (allDay) days = Math.max(1, Math.ceil(seconds / 86_400))
      end = allDay ? addDays(start, days, ctx.display).getTime() : start + seconds * 1000
    } else if (allDay) {
      end = addDays(start, 1, ctx.display).getTime() // RFC 5545: sin DTEND, un día
    }
  }
  if (end !== null) {
    if (allDay) days = Math.max(1, daysBetween(startOfDay(start, ctx.display), startOfDay(end, ctx.display), ctx.display))
    length = end - start
    if (length === 0) { end = null; length = null }
  }

  // --- Texto
  let title = (r.summary ?? '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim()
  let course: string | null = null
  const uid = r.uid ?? ''
  const isCanvasUID = CANVAS_UID_PREFIXES.some((p) => uid.startsWith(p))
  const split = CourseCode.splitTrailingBracket(title)
  if (split.bracket !== null) {
    const short = CourseCode.short(split.bracket)
    const looksLikeCode = hasNumber(short) && hasLetter(short)
    if (isCanvasUID || looksLikeCode) {
      title = split.title
      course = short
    }
  }
  if (!title) title = untitledEvent()

  let descriptionText: string | null = null
  let rawDescription = (r.description ?? '').trim()
  if (!rawDescription && r.altDescription !== null) rawDescription = r.altDescription.trim()
  if (rawDescription) descriptionText = clipped(htmlToMarkdown(rawDescription))

  // sin curso entre corchetes, un CATEGORIES con forma de código sirve
  if (course === null) {
    for (const c of r.categories) {
      const short = CourseCode.short(c)
      if (hasNumber(short) && hasLetter(short) && Array.from(short).length <= 12) { course = short; break }
    }
  }

  // --- Clasificación
  const verdict = ExamDetector.classify(title, descriptionText)
  let kind: StudyEventKind = verdict.kind
  if (kind === 'other') kind = r.isTodo || uid.startsWith('event-assignment') ? 'assignment' : 'event'

  const url = r.url ? r.url : null
  const loc = r.location?.trim() ?? null
  const event: StudyEvent = {
    id: uid, title, course, start: new Date(start), end: end !== null ? new Date(end) : null, allDay, kind, isExam: verdict.isExam, url,
    descriptionText, location: loc ? loc : null, source: 'ics', courseID: null
  }
  return { event, start, length, allDay, allDayDays: days, startValue: sv }
}

// MARK: - Recurrencia

const DAY_MS = 86_400_000

/** Las fechas de una serie (regla + `RDATE`) alrededor de hoy: `kept()` sin las quitadas (`EXDATE`) ni las cambiadas
 *  (`overriddenInstants`), `all()` con ellas; como mucho `MAX_OCCURRENCES_PER_EVENT` cada una. */
function seriesDates(r: RawEvent, base: Base, ctx: Context, overriddenInstants: Set<number>): { kept(): number[]; all(): number[] } {
  const sv = base.startValue
  const zone = ctx.zone(sv)
  const zoneTz = sv.hasTime ? zone : ctx.display
  const windowStart = ctx.now.getTime() - 60 * DAY_MS
  const zoneParam = sv.zone.t === 'zone' ? sv.zone.id : null
  const withZone = (params: Record<string, string>): Record<string, string> =>
    params.TZID === undefined && zoneParam !== null ? { ...params, TZID: zoneParam } : params

  // EXDATE y excepciones
  const excludedInstants = new Set(overriddenInstants)
  const excludedDays = new Set<number>()
  let exclusions = overriddenInstants.size
  for (const p of r.exdates) {
    for (const piece of p.value.split(',')) {
      const v = parseDateValue(piece, withZone(p.params))
      if (!v) continue
      ctx.budget.occurrence()
      exclusions++
      if (!v.hasTime && sv.hasTime) excludedDays.add(Math.floor(utcSecondsOf(v, 0) / 86_400))
      else excludedInstants.add(ctx.instant(v))
    }
  }
  const excluded = (d: number) => excludedInstants.has(d) || (excludedDays.size > 0 && excludedDays.has(wallTime(d, zoneTz).epochDay))

  // la regla: se calculan las primeras desde el inicio de la ventana y, por si la serie ya terminó, las últimas de antes
  // (las suficientes para que el recorte de abajo dé lo mismo que con la serie entera, también quitando las excluidas)
  const keep = MAX_OCCURRENCES_PER_EVENT + exclusions + 1
  let inside: number[] = [base.start]
  let before: () => number[] = () => []
  const rule = r.rrule !== null ? parseICSRule(r.rrule) : null
  if (rule) {
    let untilDate: number | null = null
    const uv = rule.until !== null ? parseDateValue(rule.until, {}) : null
    if (uv) {
      if (!uv.hasTime) {
        untilDate = makeInstant(uv.year, uv.month, uv.day + 1, 0, 0, 0, zoneTz) - 1000
      } else if (uv.zone.t === 'floating') {
        untilDate = makeInstant(uv.year, uv.month, uv.day, uv.hour, uv.minute, uv.second, zoneTz)
      } else {
        untilDate = ctx.instant(uv)
      }
    }
    const horizon = ctx.now.getTime() + 800 * DAY_MS
    const w = icsOccurrenceWindow({
      rule,
      start: { year: sv.year, month: sv.month, day: sv.day },
      time: { hour: sv.hasTime ? sv.hour : 0, minute: sv.hasTime ? sv.minute : 0, second: sv.hasTime ? sv.second : 0 },
      zone: zoneTz,
      until: untilDate,
      horizon,
      from: windowStart,
      keep,
      budget: ctx.budget
    })
    inside = w.inside
    before = w.before
  } else if (base.start < windowStart) {
    inside = []
    before = () => [base.start]
  }

  // RDATE: fechas adicionales
  const extra: number[] = []
  for (const p of r.rdates) {
    for (const piece of p.value.split(',')) {
      const text = piece.trim()
      if (text.includes('/')) continue // PERIOD: no se admite
      const v = parseDateValue(text, withZone(p.params))
      if (!v) continue
      ctx.budget.occurrence()
      extra.push(ctx.instant(v))
    }
  }

  // únicas y ordenadas; tope de ocurrencias: desde 60 días atrás o, si la serie ya terminó, las últimas
  const pick = (drop: (d: number) => boolean): number[] => {
    const recent = unique([...inside, ...extra.filter((d) => d >= windowStart)].filter((d) => !drop(d)))
    // con tantas desde la ventana, las de antes no cambian el resultado (y ni se calculan)
    if (recent.length >= MAX_OCCURRENCES_PER_EVENT) return recent.slice(0, MAX_OCCURRENCES_PER_EVENT)
    const dates = unique([...before(), ...extra.filter((d) => d < windowStart), ...recent].filter((d) => !drop(d)))
    if (dates.length <= MAX_OCCURRENCES_PER_EVENT) return dates
    return recent.length ? recent.slice(0, MAX_OCCURRENCES_PER_EVENT) : dates.slice(-MAX_OCCURRENCES_PER_EVENT)
  }
  const none = () => false
  return { kept: () => pick(excluded), all: () => pick(none) }
}

function unique(dates: number[]): number[] {
  return [...new Set(dates)].sort((a, b) => a - b)
}

// MARK: - Utilidades

/** `P1D`, `PT1H30M`, `P1W`, `-PT15M` → segundos (`null` si no es una duración). */
export function parseICSDuration(text: string): number | null {
  let s = text.trim().toUpperCase()
  let sign = 1
  if (s.startsWith('-')) { sign = -1; s = s.slice(1) } else if (s.startsWith('+')) s = s.slice(1)
  if (!s.startsWith('P')) return null
  s = s.slice(1)
  let total = 0
  let number = ''
  let inTime = false
  let any = false
  for (const ch of s) {
    if (ch === 'T') { inTime = true; continue }
    if ((ch >= '0' && ch <= '9') || ch === '.') { number += ch; continue }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(number)) return null
    const n = Number(number)
    number = ''
    if (ch === 'W') total += n * 7 * 86_400
    else if (ch === 'D') total += n * 86_400
    else if (ch === 'H' && inTime) total += n * 3600
    else if (ch === 'M' && inTime) total += n * 60
    else if (ch === 'S' && inTime) total += n
    else return null
    any = true
  }
  return any && number === '' ? sign * total : null
}

/** `20241020T235900Z` (para los identificadores de las ocurrencias). */
export function compactStamp(ms: number): string {
  const iso = new Date(ms).toISOString() // 2024-10-20T23:59:00.000Z
  return iso.slice(0, 19).replace(/[-:]/g, '') + 'Z'
}
