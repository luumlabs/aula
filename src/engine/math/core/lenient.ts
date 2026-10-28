// Lectura tolerante de JSON (las especificaciones suelen venir de una IA y pueden traer números donde se esperan textos).

import { NumberFormat } from '../format/number-format'
import { trimWS } from './text'

/** Objeto JSON (o `null` si no lo es). */
export function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function has(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined && o[key] !== null
}

/** `Double(texto)` de Swift: decimal o científico, `inf`/`infinity`/`nan` (sin espacios alrededor). */
export function parseSwiftDouble(s: string): number | null {
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s)
  const t = s.toLowerCase()
  if (/^[+-]?(inf|infinity)$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity
  if (/^[+-]?nan$/.test(t)) return NaN
  return null
}

/** Texto de un valor JSON suelto: texto, entero, decimal o booleano. */
function stringOf(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 63) return String(v)
    return NumberFormat.decimal(v)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return null
}

/** Texto, número o booleano → texto. `null` si la clave no está. */
export function lenientString(o: Record<string, unknown>, key: string): string | null {
  if (!has(o, key)) return null
  return stringOf(o[key])
}

/** Lista de textos (o un único texto/número) → `string[]`. */
export function lenientStrings(o: Record<string, unknown>, key: string): string[] | null {
  if (!has(o, key)) return null
  const v = o[key]
  if (Array.isArray(v)) {
    const out: string[] = []
    for (const x of v) {
      if (typeof x === 'string') out.push(x)
      else if (typeof x === 'number') out.push(Number.isInteger(x) && Math.abs(x) < 2 ** 63 ? String(x) : NumberFormat.decimal(x))
    }
    return out
  }
  const one = stringOf(v)
  return one === null ? null : [one]
}

/** Número (o texto con un número, con coma o punto decimal). */
export function lenientDouble(o: Record<string, unknown>, key: string): number | null {
  if (!has(o, key)) return null
  const v = o[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseSwiftDouble(trimWS(v).split(',').join('.'))
  return null
}

/** Entero (o número redondeado, o texto con un número). */
export function lenientInt(o: Record<string, unknown>, key: string): number | null {
  if (!has(o, key)) return null
  const v = o[key]
  if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 2 ** 63) return v
  const d = lenientDouble(o, key)
  if (d !== null && Number.isFinite(d) && Math.abs(d) < 9e15) return roundHalfAway(d)
  return null
}

/** Booleano (o `"true"`, `"sí"`, `"no"`, `1`, `0`…). */
export function lenientBool(o: Record<string, unknown>, key: string): boolean | null {
  if (!has(o, key)) return null
  const v = o[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    switch (v.toLowerCase()) {
      case 'true': case 'yes': case 'si': case 'sí': case '1': return true
      case 'false': case 'no': case '0': return false
      default: return null
    }
  }
  if (typeof v === 'number' && Number.isInteger(v)) return v !== 0
  return null
}

function roundHalfAway(x: number): number {
  const v = Math.round(Math.abs(x))
  return x < 0 ? -v : v
}
