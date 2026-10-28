// Calendario civil (gregoriano proléptico, sin zona) con el algoritmo de Howard Hinnant. Rápido, determinista e isomorfo.

export const SECONDS_PER_DAY = 86_400
export const MS_PER_DAY = 86_400_000

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31
    case 4: case 6: case 9: case 11: return 30
    case 2: return isLeap(y) ? 29 : 28
    default: return 0
  }
}

/** División entera hacia abajo (como en el algoritmo original con enteros con signo). */
function idiv(a: number, b: number): number {
  return Math.trunc(a / b)
}

/** Días desde 1970-01-01 de una fecha civil (puede ser negativo). Lineal en `day` (admite días fuera de rango). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = idiv(y >= 0 ? y : y - 399, 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = idiv(153 * mp + 2, 5) + day - 1
  const doe = yoe * 365 + idiv(yoe, 4) - idiv(yoe, 100) + doy
  return era * 146_097 + doe - 719_468
}

/** Inversa de `daysFromCivil`. */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719_468
  const era = idiv(z >= 0 ? z : z - 146_096, 146_097)
  const doe = z - era * 146_097
  const yoe = idiv(doe - idiv(doe, 1460) + idiv(doe, 36_524) - idiv(doe, 146_096), 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + idiv(yoe, 4) - idiv(yoe, 100))
  const mp = idiv(5 * doy + 2, 153)
  const d = doy - idiv(153 * mp + 2, 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { year: m <= 2 ? y + 1 : y, month: m, day: d }
}

/** Día de la semana ISO (1 = lunes … 7 = domingo). */
export function isoWeekday(year: number, month: number, day: number): number {
  const days = daysFromCivil(year, month, day)
  return ((((days % 7) + 7 + 3) % 7) + 1)
}

/** Día de la semana como `Calendar` de Swift (1 = domingo … 7 = sábado) para un número de día civil. */
export function weekdayOfEpochDay(days: number): number {
  return ((((days + 4) % 7) + 7) % 7) + 1
}

/** Normaliza (año, mes) con meses fuera de 1…12. */
export function normalizeMonth(year: number, month: number): { year: number; month: number } {
  const total = year * 12 + (month - 1)
  const y = Math.floor(total / 12)
  return { year: y, month: total - y * 12 + 1 }
}

/** Segundos desde 1970 de una fecha y hora civiles leídas como UTC (admite valores fuera de rango, lineales). */
export function civilSeconds(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const n = normalizeMonth(year, month)
  return daysFromCivil(n.year, n.month, day) * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second
}

export function pad(v: number, width: number): string {
  const s = String(Math.abs(Math.trunc(v)))
  const body = s.length >= width ? s : '0'.repeat(width - s.length) + s
  return v < 0 ? '-' + body : body
}
