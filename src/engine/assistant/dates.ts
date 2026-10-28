// Fechas para la IA y desde la IA (port de AssistantDates): ISO 8601 en la zona horaria del equipo; se aceptan formas cortas.

const pad = (n: number, w = 2): string => String(Math.abs(Math.trunc(n))).padStart(w, '0')

function offsetText(d: Date, colon = true): string {
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? '-' : '+'
  return `${sign}${pad(Math.floor(Math.abs(off) / 60))}${colon ? ':' : ''}${pad(Math.abs(off) % 60)}`
}

/** «2026-10-19T09:00:00-04:00» (hora local con su desfase). */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetText(d)}`
}

/** «2026-10-19» (día local). */
export function dayLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** «2026-10-19T09:00», «2026-10-19 09:00», «2026-10-19T09:00:00-04:00», «2026-10-19» (todo el día, a medianoche local). */
export function parseDate(raw: string): Date | undefined {
  const s = raw.trim().replace(/ /g, 'T')
  // con zona (Z o ±hh:mm): lo entiende Date
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.\d+)?)?)?)?$/.exec(s)
  if (!m) return undefined
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const h = m[4] ? Number(m[4]) : 0, mi = m[5] ? Number(m[5]) : 0, se = m[6] ? Number(m[6]) : 0
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59 || se > 59) return undefined
  const d = new Date(y, mo - 1, da, h, mi, se)
  // 2026-02-31 no existe (Date lo pasaría a marzo)
  if (d.getMonth() !== mo - 1 || d.getDate() !== da) return undefined
  return d
}

/** ¿La fecha vino sin hora? («2026-10-19») */
export function isDateOnly(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  } catch {
    return 'local'
  }
}

/** Contexto de fecha para el modelo: «Now: Monday 2026-10-12 19:20 (America/New_York, UTC-04:00). Next days: …». */
export function dateContext(now: Date = new Date()): string {
  let s = `Now: ${WEEKDAYS[now.getDay()]} ${dayLocal(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} (${localZone()}, UTC${offsetText(now)}).`
  const next: string[] = []
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12)
    next.push(`${WEEKDAYS[d.getDay()]} ${dayLocal(d)}`)
  }
  s += ' Next days: ' + next.join('; ') + '.'
  return s
}

/** Días de calendario desde hoy hasta `d` (negativo si ya pasó). */
export function daysUntil(d: Date, now: Date = new Date()): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

export const AssistantDates = { iso: isoLocal, day: dayLocal, parse: parseDate, isDateOnly, context: dateContext, daysUntil }
