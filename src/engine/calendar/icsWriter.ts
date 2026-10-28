// Exportar el calendario a .ics (ICSWriter.swift), escrito desde el RFC 5545 sin librerías. Un VCALENDAR con:
//   · un VEVENT por evento; los que se repiten, con su RRULE (no copiados uno a uno), sus EXDATE y, para las repeticiones
//     cambiadas solo una vez, un VEVENT con RECURRENCE-ID;
//   · las horas de las repeticiones con TZID y su VTIMEZONE (con los cambios de hora reales de esa zona en el periodo que
//     cubre el archivo); lo que no se repite, en UTC; lo de todo el día, como fecha;
//   · los avisos como VALARM (no en las tareas ya hechas);
//   · líneas de 75 octetos como mucho (plegadas sin partir caracteres), fin de línea CRLF y texto escapado.
import { addDays, isDaylightSaving, localTimeZone, offsetSeconds, offsetTransitions, pad, startOfDay, UTC, wallTime, zoneAbbreviation } from '@engine/calendar/time'
import { eventZone, isDone, isNamedTimeZone, isTask, kindTitle, type CalendarEvent } from './model'
import { formatRRule } from './rrule'
import { aiLocale } from '@shared/ai/i18n'
import { instantForKey, occurrence } from './series'

export interface ICSWriterOptions {
  calendarName?: string
  includeCourseExams?: boolean
  includePlatformDates?: boolean
  alarms?: boolean
  /** Zona de los eventos sin zona propia (por defecto, la del sistema). */
  timeZone?: string
}

const DAY_MS = 86_400_000

/** El archivo .ics de estos eventos (eventos de la serie, no repeticiones ya expandidas). */
export function writeICS(events: CalendarEvent[], options: ICSWriterOptions = {}, now: Date = new Date()): string {
  const defaultZone = options.timeZone ?? localTimeZone()
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aula//Calendario//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + escapeICSText(options.calendarName ?? 'Aula')]
  // zonas de las repeticiones (con hora): cada una con sus cambios de hora entre el primer evento y el último que cubre
  const zones = new Map<string, { from: number; to: number }>()
  for (const e of events) {
    if (!e.recurrence || e.allDay) continue
    const tz = eventZone(e, defaultZone)
    // sin final: hasta dos años después de HOY (una serie de hace años también necesita los cambios de hora de ahora)
    const last = e.recurrence.until?.getTime() ?? Math.max(e.start.getTime(), now.getTime()) + 2 * 365 * DAY_MS
    const span = zones.get(tz) ?? { from: e.start.getTime(), to: last }
    zones.set(tz, { from: Math.min(span.from, e.start.getTime()), to: Math.max(span.to, last) })
  }
  for (const id of [...zones.keys()].sort()) {
    const span = zones.get(id)!
    if (isNamedTimeZone(id) || id === UTC) lines.push(...vtimezone(id, span.from, span.to))
  }
  const stamp = utcStamp(new Date(now.getTime()))
  for (const e of events) {
    if (e.id.includes('#')) continue
    lines.push(...vevent(e, stamp, options, defaultZone))
    // repeticiones cambiadas una sola vez
    if (!e.recurrence) continue
    for (const key of Object.keys(e.overrides).sort()) {
      if (e.overrides[key].cancelled) continue
      const tz = eventZone(e, defaultZone)
      const i = occurrence(e, key, defaultZone)
      const original = instantForKey(key, tz)
      if (!i || !original) continue
      const single: CalendarEvent = { ...i, recurrence: undefined }
      lines.push(...vevent(single, stamp, options, defaultZone, icsUID(e), { original, series: e }))
    }
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldICSLine).join('\r\n') + '\r\n'
}

export function icsUID(e: CalendarEvent): string {
  return e.id.replace(/:/g, '-') + '@aula.app'
}

function vevent(e: CalendarEvent, stamp: string, options: ICSWriterOptions, defaultZone: string, explicitUID?: string,
  recurrenceID?: { original: Date; series: CalendarEvent }): string[] {
  const l = ['BEGIN:VEVENT', 'UID:' + (explicitUID ?? icsUID(e)), 'DTSTAMP:' + stamp]
  const tz = eventZone(e, defaultZone)
  const floating = e.recurrence !== undefined || recurrenceID?.series.recurrence !== undefined
  if (recurrenceID) {
    const sz = eventZone(recurrenceID.series, defaultZone)
    l.push(recurrenceID.series.allDay ? 'RECURRENCE-ID;VALUE=DATE:' + dateStamp(recurrenceID.original, tz) : `RECURRENCE-ID;TZID=${sz}:` + localStamp(recurrenceID.original, sz))
  }
  if (e.allDay) {
    l.push('DTSTART;VALUE=DATE:' + dateStamp(e.start, tz))
    const end = e.end ? (e.end.getTime() > e.start.getTime() ? e.end : new Date(e.start.getTime() + DAY_MS)) : addDays(startOfDay(e.start, tz), 1, tz)
    l.push('DTEND;VALUE=DATE:' + dateStamp(end, tz))
  } else if (floating) {
    l.push(`DTSTART;TZID=${tz}:` + localStamp(e.start, tz))
    if (e.end && e.end.getTime() >= e.start.getTime()) l.push(`DTEND;TZID=${tz}:` + localStamp(e.end, tz))
  } else {
    l.push('DTSTART:' + utcStamp(e.start))
    if (e.end && e.end.getTime() >= e.start.getTime()) l.push('DTEND:' + utcStamp(e.end))
  }
  if (e.recurrence) {
    l.push('RRULE:' + formatRRule(e.recurrence, { allDay: e.allDay, timeZone: tz }))
    const exdate = (x: Date) => (e.allDay ? 'EXDATE;VALUE=DATE:' + dateStamp(x, tz) : `EXDATE;TZID=${tz}:` + localStamp(x, tz))
    for (const x of [...e.exceptions].sort((a, b) => a.getTime() - b.getTime())) l.push(exdate(x))
    // las cambiadas «esta vez no hay» se guardan como excepciones
    for (const [key, o] of Object.entries(e.overrides)) {
      if (!o.cancelled) continue
      const x = instantForKey(key, tz)
      if (x) l.push(exdate(x))
    }
  }
  l.push('SUMMARY:' + escapeICSText(e.title))
  let description = e.notes ?? ''
  if (e.course) description = description ? e.course + '\n\n' + description : e.course
  if (description) l.push('DESCRIPTION:' + escapeICSText(description))
  if (e.location) l.push('LOCATION:' + escapeICSText(e.location))
  if (e.url && /^https?:\/\//i.test(e.url)) l.push('URL:' + e.url)
  // el tipo en el idioma de la interfaz (solo informativo: al importar no se lee)
  l.push('CATEGORIES:' + escapeICSText(kindTitle(e.kind, aiLocale())))
  l.push('STATUS:CONFIRMED')
  l.push('TRANSP:' + (e.kind === 'assignment' || e.kind === 'study' ? 'TRANSPARENT' : 'OPAQUE'))
  if (isTask(e)) {
    l.push('X-AULA-TASK:TRUE')
    if (isDone(e)) l.push('X-AULA-DONE:TRUE')
  }
  if ((options.alarms ?? true) && !(isTask(e) && isDone(e))) {
    for (const m of e.reminders) l.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escapeICSText(e.title), `TRIGGER:-PT${m}M`, 'END:VALARM')
  }
  l.push('END:VEVENT')
  return l
}

// MARK: - Zonas horarias

/** VTIMEZONE con los cambios de hora de `tz` entre dos fechas (cada uno, su STANDARD o DAYLIGHT con DTSTART en la hora local
 *  de antes del cambio, como pide el RFC). Una zona sin cambios: un solo STANDARD. */
export function vtimezone(tz: string, from: number, to: number): string[] {
  const l = ['BEGIN:VTIMEZONE', 'TZID:' + tz]
  const start = from - 366 * DAY_MS
  const end = Math.min(to, from + 40 * 366 * DAY_MS) + 366 * DAY_MS
  const transitions = offsetTransitions(tz, start, end, 100).map((d) => d.getTime())
  if (!transitions.length) {
    const off = formatOffset(offsetSeconds(from, tz))
    l.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:' + off, 'TZOFFSETTO:' + off, 'TZNAME:' + zoneAbbreviation(from, tz), 'END:STANDARD')
  } else {
    // la regla en vigor al principio (por si un evento cae antes del primer cambio)
    const before0 = transitions[0] - 1000
    const firstFrom = offsetSeconds(before0, tz)
    const begin = isDaylightSaving(before0, tz) ? 'DAYLIGHT' : 'STANDARD'
    l.push(`BEGIN:${begin}`, 'DTSTART:19700101T000000', 'TZOFFSETFROM:' + formatOffset(firstFrom), 'TZOFFSETTO:' + formatOffset(firstFrom),
      'TZNAME:' + zoneAbbreviation(before0, tz), `END:${begin}`)
    for (const tr of transitions) {
      const before = offsetSeconds(tr - 1000, tz), after = offsetSeconds(tr, tz)
      const kind = isDaylightSaving(tr, tz) ? 'DAYLIGHT' : 'STANDARD'
      // hora local de pared de ANTES del cambio
      l.push(`BEGIN:${kind}`, 'DTSTART:' + localStamp(new Date(tr + before * 1000), UTC), 'TZOFFSETFROM:' + formatOffset(before), 'TZOFFSETTO:' + formatOffset(after),
        'TZNAME:' + zoneAbbreviation(tr, tz), `END:${kind}`)
    }
  }
  l.push('END:VTIMEZONE')
  return l
}

/** «+0200», «-0530», «+053045». */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const a = Math.abs(seconds)
  const s = `${sign}${pad(Math.floor(a / 3600), 2)}${pad(Math.floor((a % 3600) / 60), 2)}`
  return a % 60 === 0 ? s : s + pad(a % 60, 2)
}

// MARK: - Formato

function stampOf(d: Date, tz: string, withTime: boolean): string {
  const w = wallTime(d, tz)
  const day = `${pad(w.year, 4)}${pad(w.month, 2)}${pad(w.day, 2)}`
  return withTime ? `${day}T${pad(w.hour, 2)}${pad(w.minute, 2)}${pad(w.second, 2)}` : day
}

export function utcStamp(d: Date): string {
  return stampOf(d, UTC, true) + 'Z'
}
export function localStamp(d: Date, tz: string): string {
  return stampOf(d, tz, true)
}
export function dateStamp(d: Date, tz: string): string {
  return stampOf(d, tz, false)
}

/** Texto de una propiedad (RFC 5545 §3.3.11): «\», «;», «,» y saltos de línea escapados. */
export function escapeICSText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n')
}

const encoder = new TextEncoder()
const segmenter: { segment(s: string): Iterable<{ segment: string }> } | null = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  } catch {
    return null
  }
})()

function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s)
}

/** Pliega una línea en trozos de 75 octetos como mucho (el resto empieza con un espacio), sin partir un carácter. */
export function foldICSLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let size = 0
  let limit = 75
  for (const ch of graphemes(line)) {
    const n = encoder.encode(ch).length
    if (size + n > limit && current) {
      out.push(current)
      current = ''
      size = 0
      limit = 74 // las siguientes llevan un espacio delante
    }
    current += ch
    size += n
  }
  if (current) out.push(current)
  return out.map((p, i) => (i === 0 ? p : ' ' + p)).join('\r\n')
}
