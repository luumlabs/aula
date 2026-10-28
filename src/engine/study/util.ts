// Utilidades internas del motor de estudio: habilidades indexadas, fechas, huellas FNV-1a y JSON canónico.
import type { JSONValue } from '@engine/base/json'
import { RawNumber } from '@engine/base/json'
import { swiftDoubleDescription } from '@engine/math/format/swift-double'
import { dayKey as learnDayKey } from '@engine/learn'
import { localTimeZone } from '@engine/calendar/time'
import { hasOwnKey, setOwn, type ISODate, type ItemID, type Skill } from '@shared/schema'
import type { SkillsInput } from './types'

/**
 * Las habilidades indexadas por id (si se repite un id, gana la primera). Sin prototipo: un id como «constructor» o
 * «__proto__» es una habilidad más y uno que no existe no encuentra nada heredado.
 */
export function skillMap(skills: SkillsInput): Record<ItemID, Skill> {
  const out = Object.create(null) as Record<ItemID, Skill>
  if (!Array.isArray(skills)) {
    for (const [k, s] of Object.entries(skills as Record<ItemID, Skill>)) setOwn(out, k, s)
    return out
  }
  for (const s of skills as readonly Skill[]) if (!hasOwnKey(out, s.id)) setOwn(out, s.id, s)
  return out
}

/** Fecha de un ISO (undefined/inválida → null). */
export function toDate(iso: ISODate | undefined | null): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t)
}

export const isoOf = (d: Date): ISODate => new Date(d.getTime()).toISOString()
export const addDaysISO = (d: Date, days: number): ISODate => new Date(d.getTime() + days * 86_400_000).toISOString()

/** «yyyy-MM-dd» en la zona local (como `Recorder.dayKey`). */
export function dayKey(d: Date, timeZone: string = localTimeZone()): string {
  return learnDayKey(d, timeZone)
}

/** Suma sin pasarse de los enteros seguros (un progreso dañado con Int.max cerraba la app). */
export function addInt(a: number, b: number): number {
  const r = a + b
  if (r > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  if (r < Number.MIN_SAFE_INTEGER) return Number.MIN_SAFE_INTEGER
  return r
}

/** Número finito (NaN/∞ → `fallback`). */
export const finite = (x: number | undefined, fallback: number): number => (x !== undefined && Number.isFinite(x) ? x : fallback)

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0)

// MARK: Huellas

const PRIME_LO = 0x1b3, PRIME_HI = 0x100

/**
 * FNV-1a de 64 bits sobre los bytes UTF-8, en hexadecimal sin ceros a la izquierda (como `String(value, radix: 16)`).
 * OJO: la base es la de LearningController.hash de Swift, 1469598103934665603 (0x14650fb0739d0383, no la estándar
 * 0xcbf29ce484222325): con la estándar, las huellas guardadas por la app Swift no coincidían.
 */
export function fnv1a64(text: string): string {
  let hi = 0x14650fb0, lo = 0x739d0383
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0
    // (hi·2^32 + lo) · (0x100·2^32 + 0x1b3) mod 2^64
    const loMul = lo * PRIME_LO
    const carry = Math.floor(loMul / 0x100000000)
    const newLo = loMul >>> 0
    const newHi = (Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI) + carry) >>> 0
    hi = newHi
    lo = newLo
  }
  const big = (BigInt(hi) << 32n) | BigInt(lo)
  return big.toString(16)
}

/** Cadena JSON como la escribe `JSONEncoder` de Swift (escapa «/» como «\/»). */
function swiftString(s: string): string {
  return JSON.stringify(s).replace(/\//g, '\\/')
}

/**
 * Un número como lo escribe `JSONValue.encode` de Swift con `JSONEncoder`: los enteros exactos (|x| < 2^53) como Int64
 * («3», «-0» → «0») y el resto como `Double` (su `description` sin el «.0» final: «0.5», «1e-06», «1.5e+20»).
 * Con `JSON.stringify` salía «0.000001» y las huellas guardadas por la app Swift no coincidían.
 */
export function swiftJSONNumber(x: number): string {
  if (!Number.isFinite(x)) return 'null'
  if (Number.isInteger(x) && Math.abs(x) < 9_007_199_254_740_992) return String(Math.trunc(x) + 0)
  const d = swiftDoubleDescription(x)
  return d.endsWith('.0') ? d.slice(0, -2) : d
}

/** JSON compacto con claves ordenadas, como `JSONEncoder` con `.sortedKeys` (para huellas estables). */
export function canonicalJSON(v: JSONValue | undefined): string {
  if (v === null || v === undefined) return 'null'
  // Swift lee el número como Double y lo vuelve a escribir: el texto original no se conserva
  if (v instanceof RawNumber) { const n = Number(v.text); return Number.isFinite(n) ? swiftJSONNumber(n) : v.text }
  switch (typeof v) {
    case 'string': return swiftString(v)
    case 'number': return swiftJSONNumber(v)
    case 'boolean': return v ? 'true' : 'false'
    default: break
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']'
  const keys = Object.keys(v).filter((k) => (v as Record<string, JSONValue | undefined>)[k] !== undefined).sort()
  return '{' + keys.map((k) => swiftString(k) + ':' + canonicalJSON((v as Record<string, JSONValue>)[k])).join(',') + '}'
}

/** Sin acentos ni mayúsculas y con los espacios seguidos reducidos a uno. */
export function normalizeText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ')
}

/** Valores únicos conservando el orden. */
export function unique<T>(values: readonly T[]): T[] {
  const seen = new Set<T>()
  return values.filter((v) => (seen.has(v) ? false : (seen.add(v), true)))
}

// MARK: Generador de StudyEngine

const MASK64 = (1n << 64n) - 1n

/** Generador determinista mínimo de StudyEngine (`SplitMix` de PracticeQueue.swift: baraja con módulo, no con producto). */
export class StudyMix {
  private state: bigint
  constructor(seed: bigint | number) {
    this.state = typeof seed === 'bigint' ? BigInt.asUintN(64, seed) : BigInt.asUintN(64, BigInt(Math.trunc(Number.isFinite(seed) ? seed : 0)))
  }
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK64
    let z = this.state
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
    return z ^ (z >> 31n)
  }
  shuffled<T>(a: readonly T[]): T[] {
    const r = a.slice()
    if (r.length < 2) return r
    for (let i = r.length - 1; i > 0; i--) {
      const j = Number(this.next() % BigInt(i + 1))
      const t = r[i]; r[i] = r[j]; r[j] = t
    }
    return r
  }
}

/** Semilla UInt64 (bigint) desde lo que dé quien llama; por defecto, los segundos de `now`. */
export function seedOf(seed: bigint | number | undefined, now: Date): bigint {
  if (seed === undefined) return BigInt(Math.max(0, Math.floor(now.getTime() / 1000)))
  return typeof seed === 'bigint' ? BigInt.asUintN(64, seed) : BigInt.asUintN(64, BigInt(Math.trunc(Number.isFinite(seed) ? seed : 0)))
}

/** a &+ b &* c en 64 bits. */
export const u64 = (x: bigint): bigint => x & MASK64
