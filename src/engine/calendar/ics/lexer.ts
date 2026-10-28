// Nivel léxico de iCalendar (RFC 5545), portado de CanvasKit/ICS/ICSLexer.swift: desdoblado de líneas, propiedades con
// parámetros, escapes de texto, valores DATE / DATE-TIME y zonas horarias (IANA, Windows, Mozilla, «(UTC-05:00) …»).
import { civilSeconds, daysInMonth, fixedOffsetZone, isValidTimeZone } from '@engine/calendar/time'

/** `NOMBRE;PARAM=VALOR:valor` (nombre y claves en mayúsculas, valores sin comillas). */
export interface ICSProperty {
  name: string
  params: Record<string, string>
  value: string
}

const UTF8_STRICT = (() => {
  try {
    return new TextDecoder('utf-8', { fatal: true })
  } catch {
    return null
  }
})()
const CP1252 = (() => {
  try {
    return new TextDecoder('windows-1252')
  } catch {
    return null
  }
})()
const UTF8_LOOSE = new TextDecoder('utf-8')

/** UTF-8 estricto y, si falla, Windows-1252 (los calendarios antiguos de Outlook). */
function decodeLine(bytes: Uint8Array): string {
  if (UTF8_STRICT) {
    try {
      return UTF8_STRICT.decode(bytes)
    } catch {
      /* no es UTF-8 */
    }
  }
  return CP1252 ? CP1252.decode(bytes) : UTF8_LOOSE.decode(bytes)
}

/** Desdobla las líneas (CRLF + espacio/tab = continuación). Acepta CRLF, LF y CR sueltos y un BOM inicial.
 *  Con bytes, recompone los caracteres UTF-8 que algún generador partió al plegar y acepta Windows-1252 por línea. */
export function unfold(input: string | Uint8Array): string[] {
  return typeof input === 'string' ? unfoldText(input) : unfoldBytes(input)
}

function unfoldText(text: string): string[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines: string[] = []
  // trozos de la línea lógica (sin los pliegues ni los NUL): con `slice`, no carácter a carácter (líneas de cientos de KB)
  let parts: string[] = []
  let from = 0
  const cut = (end: number) => { if (end > from) parts.push(s.slice(from, end)) }
  const flush = () => {
    const line = parts.join('')
    if (line) lines.push(line)
    parts = []
  }
  const n = s.length
  let i = 0
  while (i < n) {
    const c = s.charCodeAt(i)
    if (c === 13 || c === 10) {
      cut(i)
      let j = i + 1
      if (c === 13 && j < n && s.charCodeAt(j) === 10) j++
      if (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) {
        i = j + 1
        from = i
        continue
      }
      flush()
      i = j
      from = i
      continue
    }
    if (c === 0) {
      cut(i)
      from = i + 1
    }
    i++
  }
  cut(n)
  flush()
  return lines
}

function unfoldBytes(input: Uint8Array): string[] {
  let bytes = input
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3)
  const lines: string[] = []
  // trozos (vistas, sin copiar) de la línea lógica; se juntan solo si hubo pliegues o NUL
  let parts: Uint8Array[] = []
  let size = 0
  let from = 0
  const cut = (end: number) => {
    if (end <= from) return
    parts.push(bytes.subarray(from, end))
    size += end - from
  }
  const flush = () => {
    if (parts.length === 1) lines.push(decodeLine(parts[0]))
    else if (parts.length) {
      const line = new Uint8Array(size)
      let at = 0
      for (const p of parts) { line.set(p, at); at += p.length }
      lines.push(decodeLine(line))
    }
    parts = []
    size = 0
  }
  const n = bytes.length
  let i = 0
  while (i < n) {
    const b = bytes[i]
    if (b === 13 || b === 10) {
      cut(i)
      let j = i + 1
      if (b === 13 && j < n && bytes[j] === 10) j++
      if (j < n && (bytes[j] === 32 || bytes[j] === 9)) {
        i = j + 1
        from = i
        continue
      }
      flush()
      i = j
      from = i
      continue
    }
    if (b === 0) {
      cut(i)
      from = i + 1
    }
    i++
  }
  cut(n)
  flush()
  return lines
}

/** Separa nombre, parámetros y valor respetando comillas. `null` si no tiene `:` o no tiene nombre. */
export function parseLine(line: string): ICSProperty | null {
  const n = line.length
  let i = 0
  while (i < n && line[i] !== ';' && line[i] !== ':') i++
  if (i >= n) return null
  const name = line.slice(0, i).trim().toUpperCase()
  if (!name) return null
  const params: Record<string, string> = {}
  while (i < n && line[i] === ';') {
    i++
    const ks = i
    while (i < n && line[i] !== '=' && line[i] !== ';' && line[i] !== ':') i++
    const key = line.slice(ks, i).trim().toUpperCase()
    if (!(i < n && line[i] === '=')) continue
    i++
    let value = ''
    if (line[i] === '"') {
      i++
      const vs = i
      while (i < n && line[i] !== '"') i++
      value = line.slice(vs, i)
      if (i < n) i++
      // más valores tras las comillas: se ignoran
      while (i < n && line[i] !== ';' && line[i] !== ':') i++
    } else {
      const vs = i
      while (i < n && line[i] !== ';' && line[i] !== ':') i++
      value = line.slice(vs, i)
    }
    if (key) params[key] = value
  }
  if (!(i < n && line[i] === ':')) return null
  return { name, params, value: line.slice(i + 1) }
}

/** Desescapa un valor TEXT: `\n`/`\N` → salto, `\,` → coma, `\;` → punto y coma, `\\` → barra. */
export function unescapeText(s: string): string {
  if (!s.includes('\\')) return s
  let out = ''
  const cps = Array.from(s)
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]
    if (c !== '\\') { out += c; continue }
    const next = cps[i + 1]
    if (next === undefined) { out += c; break }
    i++
    out += next === 'n' || next === 'N' ? '\n' : next
  }
  return out
}

// MARK: - Fechas

/** Zona de un valor: UTC (`Z`), desfase fijo, zona con nombre (IANA) o flotante (hora local del calendario). */
export type ICSZone = { t: 'utc' } | { t: 'offset'; seconds: number } | { t: 'zone'; id: string } | { t: 'floating' }

/** Valor DATE / DATE-TIME aún sin resolver a un instante. */
export interface ICSDateValue {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  hasTime: boolean
  zone: ICSZone
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

/** `20241020`, `20241020T235900`, `20241020T235900Z` y las variantes extendidas `2024-10-20T23:59:00-05:00`. */
export function parseDateValue(raw: string, params: Record<string, string>): ICSDateValue | null {
  const b = raw.trim()
  const n = b.length
  let i = 0
  const digits = (k: number): number | null => {
    if (i + k > n) return null
    let v = 0
    for (let j = 0; j < k; j++) {
      const c = b[i + j]
      if (!isDigit(c)) return null
      v = v * 10 + (c.charCodeAt(0) - 48)
    }
    i += k
    return v
  }
  const y = digits(4)
  if (y === null) return null
  let extended = false
  if (b[i] === '-') { extended = true; i++ }
  const mo = digits(2)
  if (mo === null) return null
  if (extended) { if (b[i] !== '-') return null; i++ }
  const d = digits(2)
  if (d === null) return null
  if (!(mo >= 1 && mo <= 12) || d < 1 || d > daysInMonth(y, mo) || y < 1 || y > 9999) return null
  const value: ICSDateValue = { year: y, month: mo, day: d, hour: 0, minute: 0, second: 0, hasTime: false, zone: { t: 'floating' } }
  const declaresDate = params.VALUE?.toUpperCase() === 'DATE'
  if (i >= n) return value
  if (!(b[i] === 'T' || b[i] === 't' || b[i] === ' ')) return declaresDate ? value : null
  i++
  const h = digits(2)
  if (h === null) return null
  if (b[i] === ':') i++
  const mi = digits(2)
  if (mi === null) return null
  let s = 0
  if (i < n && (b[i] === ':' || isDigit(b[i]))) {
    if (b[i] === ':') i++
    const se = digits(2)
    if (se === null) return null
    s = se
  }
  if (!(h <= 24 && mi <= 59 && s <= 60)) return null
  if (b[i] === '.' || b[i] === ',') {
    i++
    while (i < n && isDigit(b[i])) i++
  }
  value.hour = Math.min(h, 23)
  value.minute = mi
  value.second = Math.min(s, 59)
  value.hasTime = true
  if (h === 24) { value.hour = 23; value.minute = 59; value.second = 59 }
  if (i < n) {
    if (b[i] === 'Z' || b[i] === 'z') value.zone = { t: 'utc' }
    else if (b[i] === '+' || b[i] === '-') {
      const sign = b[i] === '-' ? -1 : 1
      i++
      const oh = digits(2)
      if (oh !== null) {
        if (b[i] === ':') i++
        const om = digits(2) ?? 0
        value.zone = { t: 'offset', seconds: sign * (oh * 3600 + om * 60) }
      }
    }
  } else if (params.TZID !== undefined) {
    const tz = resolveTimeZone(params.TZID)
    if (tz) value.zone = { t: 'zone', id: tz }
  }
  return value
}

/** Segundos desde 1970 de un valor leído como UTC con un desfase. */
export function utcSecondsOf(v: ICSDateValue, offset: number): number {
  return civilSeconds(v.year, v.month, v.day, v.hour, v.minute, v.second) - offset
}

// MARK: - Zonas horarias

/** Nombres de zona de Windows (Outlook) → IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  'eastern standard time': 'America/New_York', 'eastern daylight time': 'America/New_York',
  'central standard time': 'America/Chicago', 'central daylight time': 'America/Chicago',
  'mountain standard time': 'America/Denver', 'mountain daylight time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix', 'pacific standard time': 'America/Los_Angeles',
  'pacific daylight time': 'America/Los_Angeles', 'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu', 'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns', 'canada central standard time': 'America/Regina',
  'us eastern standard time': 'America/Indiana/Indianapolis', 'central america standard time': 'America/Guatemala',
  'mexico standard time': 'America/Mexico_City', 'sa pacific standard time': 'America/Bogota',
  'sa eastern standard time': 'America/Cayenne', 'sa western standard time': 'America/La_Paz',
  'pacific sa standard time': 'America/Santiago', 'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Argentina/Buenos_Aires', 'venezuela standard time': 'America/Caracas',
  'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik', utc: 'UTC',
  'w. europe standard time': 'Europe/Berlin', 'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw', 'romance standard time': 'Europe/Paris',
  'e. europe standard time': 'Europe/Bucharest', 'gtb standard time': 'Europe/Bucharest',
  'fle standard time': 'Europe/Kiev', 'russian standard time': 'Europe/Moscow', 'turkey standard time': 'Europe/Istanbul',
  'israel standard time': 'Asia/Jerusalem', 'egypt standard time': 'Africa/Cairo', 'south africa standard time': 'Africa/Johannesburg',
  'arab standard time': 'Asia/Riyadh', 'arabian standard time': 'Asia/Dubai', 'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai', 'tokyo standard time': 'Asia/Tokyo', 'korea standard time': 'Asia/Seoul',
  'singapore standard time': 'Asia/Singapore', 'se asia standard time': 'Asia/Bangkok', 'aus eastern standard time': 'Australia/Sydney',
  'e. australia standard time': 'Australia/Brisbane', 'new zealand standard time': 'Pacific/Auckland'
}

const zoneCache = new Map<string, string | null>()

/** `TZID` → zona (IANA o desfase fijo). Acepta IANA, nombres de Windows, prefijos tipo `/mozilla.org/20070129_1/Europe/Berlin`
 *  y «(UTC-05:00) Eastern Time (US & Canada)». `null` si no se reconoce (el llamador usará hora flotante). */
export function resolveTimeZone(tzid: string): string | null {
  const raw = tzid.replace(/^[\s"]+|[\s"]+$/g, '')
  if (!raw) return null
  if (zoneCache.has(raw)) return zoneCache.get(raw) ?? null
  let found: string | null = null
  if (isNamedZone(raw)) found = raw
  else if (WINDOWS_ZONES[raw.toLowerCase()] && isNamedZone(WINDOWS_ZONES[raw.toLowerCase()])) found = WINDOWS_ZONES[raw.toLowerCase()]
  else if (raw.startsWith('/')) {
    const parts = raw.split('/').filter((p) => p !== '')
    for (const take of [3, 2, 1]) {
      if (parts.length < take) continue
      const candidate = parts.slice(-take).join('/')
      if (isNamedZone(candidate)) { found = candidate; break }
    }
  }
  if (!found) {
    const m = /\(UTC([^)]*)\)/.exec(raw)
    if (m) {
      const off = parseOffset(m[1])
      if (off !== null) found = fixedOffsetZone(off)
    }
  }
  if (zoneCache.size > 256) zoneCache.clear()
  zoneCache.set(raw, found)
  return found
}

function isNamedZone(id: string): boolean {
  // como `TimeZone(identifier:)`: nombres IANA (no desfases sueltos)
  return /^[A-Za-z]/.test(id) && isValidTimeZone(id) && !/\s/.test(id)
}

function parseOffset(s: string): number | null {
  const t = s.replace(/:/g, '')
  const sign = t[0]
  if (sign !== '+' && sign !== '-') return null
  const digits = t.slice(1)
  if (!/^\d{4}$/.test(digits)) return null
  return (sign === '-' ? -1 : 1) * (Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2)) * 60)
}
