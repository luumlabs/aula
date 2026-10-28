// Configuración electrónica: regla de Madelung, excepciones reales (Cr, Cu, Pd…), iones y lectura de lo que escribe el alumno.

import { ChemError } from './errors'
import { L } from './l10n'
import { localizedElementNameInSentence, PeriodicTable, type Element, type NobleGasCore } from './elements'
import { chargeText, charCount, chars, isDigit, parseIntStrict, superscripted, SUPERSCRIPT_CHARS, trimAll, isWhitespace } from './text'

const LETTERS = ['s', 'p', 'd', 'f'] as const

/** Subcapa electrónica (1s, 2p, 3d, 4f…). Los objetos son únicos por (n, l): se pueden comparar con `===`. */
export class Subshell {
  private static readonly cache = new Map<string, Subshell>()

  /** Número cuántico principal (1…8) y secundario (0 = s, 1 = p, 2 = d, 3 = f). */
  private constructor(
    readonly n: number,
    readonly l: number,
  ) {}

  /** Subcapa válida o `null` (`l < n`, `l ≤ 3`, `1 ≤ n ≤ 8`). */
  static of(n: number, l: number): Subshell | null {
    if (!Number.isInteger(n) || !Number.isInteger(l) || n < 1 || n > 8 || l < 0 || l >= n || l > 3) return null
    return Subshell.unchecked(n, l)
  }

  private static unchecked(n: number, l: number): Subshell {
    const key = `${n},${l}`
    let s = Subshell.cache.get(key)
    if (!s) {
      s = new Subshell(n, l)
      Subshell.cache.set(key, s)
    }
    return s
  }

  /** Letra de la subcapa. */
  get letter(): string {
    return LETTERS[this.l]
  }
  /** Número de orbitales (2l + 1). */
  get orbitals(): number {
    return 2 * this.l + 1
  }
  /** Electrones que caben (2(2l + 1)). */
  get capacity(): number {
    return 2 * this.orbitals
  }
  toString(): string {
    return `${this.n}${this.letter}`
  }

  /** Orden de llenado (regla de Madelung): primero menor n + l y, a igualdad, menor n. */
  static compareFilling(a: Subshell, b: Subshell): number {
    return a.n + a.l - (b.n + b.l) || a.n - b.n
  }
  /** Orden por capas (como se escribe según la IUPAC: 3d antes que 4s). */
  static compareShell(a: Subshell, b: Subshell): number {
    return a.n - b.n || a.l - b.l
  }

  /** Subcapas en orden de Madelung hasta 7p (suficiente para Z ≤ 118) más 8s. */
  static readonly fillingOrder: readonly Subshell[] = (() => {
    const all: Subshell[] = []
    for (let n = 1; n <= 8; n++) for (let l = 0; l < Math.min(n, 4); l++) all.push(Subshell.unchecked(n, l))
    return all.sort(Subshell.compareFilling).filter((s) => s.n + s.l <= 8)
  })()

  /** Lee «4s», «3d»… */
  static parse(text: string): Subshell | null {
    const c = chars(text)
    if (c.length < 2) return null
    const n = parseIntStrict(c.slice(0, -1).join(''))
    if (n === null) return null
    const l = (LETTERS as readonly string[]).indexOf(c[c.length - 1].toLowerCase())
    if (l < 0) return null
    return Subshell.of(n, l)
  }
}

/** Orden en que se escriben las subcapas: llenado («[Ar] 4s2 3d6», el de clase) o por capas («[Ar] 3d6 4s2», IUPAC/NIST). */
export type ConfigurationOrder = 'filling' | 'shell'
/** Estilo del texto: «1s2 2s2», «1s² 2s²» o LaTeX «1\mathrm{s}^{2}\,2\mathrm{s}^{2}». */
export type ConfigurationNotation = 'plain' | 'unicode' | 'latex'

/** Configuración electrónica: cuántos electrones hay en cada subcapa. */
export class ElectronConfiguration {
  /** Electrones por subcapa (solo las ocupadas). */
  readonly occupancy: ReadonlyMap<Subshell, number>

  constructor(occupancy: ReadonlyMap<Subshell, number> | Iterable<[Subshell, number]>) {
    const m = new Map<Subshell, number>()
    for (const [s, k] of occupancy instanceof Map ? occupancy.entries() : (occupancy as Iterable<[Subshell, number]>)) {
      if (k > 0) m.set(s, k)
    }
    this.occupancy = m
  }

  /** Número total de electrones. */
  get electronCount(): number {
    let t = 0
    for (const k of this.occupancy.values()) t += k
    return t
  }

  /** Electrones de una subcapa (0 si está vacía). */
  get(s: Subshell): number {
    return this.occupancy.get(s) ?? 0
  }

  equals(o: ElectronConfiguration): boolean {
    if (o.occupancy.size !== this.occupancy.size) return false
    for (const [s, k] of this.occupancy) if (o.occupancy.get(s) !== k) return false
    return true
  }

  /** Configuración por la regla de Madelung (sin excepciones) para `electrons` electrones. */
  static aufbau(electrons: number): ElectronConfiguration {
    let remaining = Math.max(0, electrons)
    const occ = new Map<Subshell, number>()
    for (const s of Subshell.fillingOrder) {
      if (remaining <= 0) break
      const k = Math.min(s.capacity, remaining)
      occ.set(s, k)
      remaining -= k
    }
    return new ElectronConfiguration(occ)
  }

  /** Excepciones reales a la regla de Madelung (estado fundamental, NIST). Para Z ≥ 104, las predicciones habituales. */
  static readonly exceptions: Readonly<Record<number, string>> = {
    24: '[Ar] 3d5 4s1', // Cr
    29: '[Ar] 3d10 4s1', // Cu
    41: '[Kr] 4d4 5s1', // Nb
    42: '[Kr] 4d5 5s1', // Mo
    44: '[Kr] 4d7 5s1', // Ru
    45: '[Kr] 4d8 5s1', // Rh
    46: '[Kr] 4d10', // Pd
    47: '[Kr] 4d10 5s1', // Ag
    57: '[Xe] 5d1 6s2', // La
    58: '[Xe] 4f1 5d1 6s2', // Ce
    64: '[Xe] 4f7 5d1 6s2', // Gd
    78: '[Xe] 4f14 5d9 6s1', // Pt
    79: '[Xe] 4f14 5d10 6s1', // Au
    89: '[Rn] 6d1 7s2', // Ac
    90: '[Rn] 6d2 7s2', // Th
    91: '[Rn] 5f2 6d1 7s2', // Pa
    92: '[Rn] 5f3 6d1 7s2', // U
    93: '[Rn] 5f4 6d1 7s2', // Np
    96: '[Rn] 5f7 6d1 7s2', // Cm
    103: '[Rn] 5f14 7s2 7p1', // Lr
  }

  private static readonly groundCache = new Map<number, ElectronConfiguration>()

  /** Configuración del estado fundamental del átomo neutro, con sus excepciones. */
  static groundState(element: Element): ElectronConfiguration {
    const z = element.atomicNumber
    const cached = ElectronConfiguration.groundCache.get(z)
    if (cached) return cached
    let result = ElectronConfiguration.aufbau(z)
    const text = ElectronConfiguration.exceptions[z]
    if (text) {
      try {
        const c = ElectronConfiguration.parse(text)
        if (c.electronCount === z) result = c
      } catch {
        // la tabla de excepciones siempre se lee; si no, queda la de Madelung
      }
    }
    ElectronConfiguration.groundCache.set(z, result)
    return result
  }

  /** `true` si el elemento no sigue la regla de Madelung (Cr, Cu, Pd, Gd…). */
  static isException(element: Element): boolean {
    return ElectronConfiguration.exceptions[element.atomicNumber] !== undefined
  }

  /**
   * Configuración de un ion monoatómico. Los cationes pierden primero los electrones de la capa más externa (ns antes que
   * (n−1)d: Fe²⁺ = [Ar] 3d⁶); los aniones ganan electrones según la regla de Madelung (Cl⁻ = [Ne] 3s² 3p⁶).
   */
  static ion(element: Element, charge: number): ElectronConfiguration {
    const neutral = ElectronConfiguration.groundState(element)
    const electrons = element.atomicNumber - charge
    if (electrons < 0) {
      throw ChemError.calculation(
        L('Un átomo de %@ solo tiene %lld electrones: no puede tener carga %@.', localizedElementNameInSentence(element), element.atomicNumber, chargeText(charge)),
      )
    }
    if (Math.abs(charge) > 8) {
      throw ChemError.calculation(L('Una carga de %@ no es realista para un ion monoatómico.', chargeText(charge)))
    }
    const occ = new Map(neutral.occupancy)
    if (charge > 0) {
      // Núcleo de gas noble del átomo neutro: sus subcapas se vacían al final.
      const core = neutral.core
      const coreSubshells = new Set(core ? ElectronConfiguration.aufbau(core.electrons).occupancy.keys() : [])
      let toRemove = charge
      while (toRemove > 0) {
        const candidates = [...occ.keys()].filter((s) => (occ.get(s) ?? 0) > 0)
        const valence = candidates.filter((s) => !coreSubshells.has(s))
        const pool = valence.length > 0 ? valence : candidates
        if (pool.length === 0) break
        const target = pool.reduce((best, s) => (Subshell.compareShell(best, s) < 0 ? s : best))
        const left = (occ.get(target) ?? 0) - 1
        if (left === 0) occ.delete(target)
        else occ.set(target, left)
        toRemove--
      }
    } else if (charge < 0) {
      let toAdd = -charge
      for (const s of Subshell.fillingOrder) {
        if (toAdd <= 0) break
        const free = s.capacity - (occ.get(s) ?? 0)
        if (free > 0) {
          const k = Math.min(free, toAdd)
          occ.set(s, (occ.get(s) ?? 0) + k)
          toAdd -= k
        }
      }
    }
    return new ElectronConfiguration(occ)
  }

  // MARK: Texto

  /** Gas noble más grande (con menos electrones que el total) cuyas subcapas están todas llenas. */
  get core(): NobleGasCore | null {
    const total = this.electronCount
    for (const core of [...PeriodicTable.nobleGasCores].reverse()) {
      if (core.electrons >= total) continue
      const coreOcc = ElectronConfiguration.aufbau(core.electrons).occupancy
      let ok = true
      for (const [s, k] of coreOcc) if (this.occupancy.get(s) !== k) ok = false
      if (ok) return core
    }
    return null
  }

  /**
   * Texto de la configuración. Sin electrones (H⁺) da «(sin electrones)», en español fijo como los informes para la IA.
   */
  text(options: { abbreviated?: boolean; order?: ConfigurationOrder; notation?: ConfigurationNotation } = {}): string {
    const { abbreviated = false, order = 'filling', notation = 'plain' } = options
    if (this.occupancy.size === 0) return notation === 'latex' ? '\\mathrm{(sin\\ electrones)}' : '(sin electrones)'
    let subshells = [...this.occupancy.keys()].sort(order === 'filling' ? Subshell.compareFilling : Subshell.compareShell)
    let prefix: string | null = null
    const core = abbreviated ? this.core : null
    if (core) {
      const coreKeys = new Set(ElectronConfiguration.aufbau(core.electrons).occupancy.keys())
      subshells = subshells.filter((s) => !coreKeys.has(s))
      prefix = core.symbol
    }
    const parts: string[] = []
    if (prefix) parts.push(notation === 'latex' ? `[\\mathrm{${prefix}}]` : `[${prefix}]`)
    for (const s of subshells) {
      const k = this.occupancy.get(s) ?? 0
      switch (notation) {
        case 'plain':
          parts.push(`${s}${k}`)
          break
        case 'unicode':
          parts.push(`${s}${superscripted(String(k))}`)
          break
        case 'latex':
          parts.push(`${s.n}\\mathrm{${s.letter}}^{${k}}`)
          break
      }
    }
    return parts.join(notation === 'latex' ? '\\,' : ' ')
  }

  /** Completa en orden de llenado: «1s2 2s2 2p6 3s2 3p6 4s2 3d6». */
  get full(): string {
    return this.text()
  }
  /** Abreviada en orden de llenado: «[Ar] 4s2 3d6». */
  get abbreviated(): string {
    return this.text({ abbreviated: true })
  }
  toString(): string {
    return this.text({ abbreviated: true, notation: 'unicode' })
  }

  /** Electrones por capa (n = 1, 2, 3…): Fe → [2, 8, 14, 2]. */
  get shells(): number[] {
    let maxN = 0
    for (const s of this.occupancy.keys()) maxN = Math.max(maxN, s.n)
    const out: number[] = []
    for (let n = 1; n <= maxN; n++) {
      let t = 0
      for (const [s, k] of this.occupancy) if (s.n === n) t += k
      out.push(t)
    }
    return out
  }

  /** Electrones desapareados según la regla de Hund. */
  get unpairedElectrons(): number {
    let t = 0
    for (const [s, k] of this.occupancy) t += k <= s.orbitals ? k : s.capacity - k
    return t
  }

  /** Capa de valencia (n más alto ocupado). */
  get outermostShell(): number {
    let m = 0
    for (const s of this.occupancy.keys()) m = Math.max(m, s.n)
    return m
  }

  // MARK: Lectura

  /**
   * Lee una configuración escrita por un alumno: «[Ar] 4s2 3d6», «1s² 2s² 2p⁶», «1s^2 2s^2 2p^6», «[Ar]3d^{6}4s^{2}»
   * o incluso sin espacios («1s22s22p6»).
   */
  static parse(text: string): ElectronConfiguration {
    let s = trimAll(text)
    if (charCount(s) > 300) throw ChemError.tooLong(300)
    for (const [sup, digit] of Object.entries(SUPERSCRIPT_CHARS)) s = s.split(sup).join(digit)
    s = s
      .split('^').join('')
      .split('{').join('')
      .split('}').join('')
      .split('\\,').join(' ')
      .split('\\mathrm').join('')
      .split(',').join(' ')
      .split('.').join(' ')
    if (!s) throw ChemError.empty('La configuración electrónica')
    const occ = new Map<Subshell, number>()
    // Núcleo de gas noble.
    if (s.startsWith('[')) {
      const close = s.indexOf(']')
      if (close < 0) throw ChemError.unclosedBracket('[')
      const symbol = s.slice(1, close).trim()
      const core = PeriodicTable.nobleGasCores.find((c) => c.symbol === symbol)
      if (!core) {
        throw ChemError.calculation(
          L('«[%@]» no es un gas noble: el núcleo abreviado tiene que ser [He], [Ne], [Ar], [Kr], [Xe] o [Rn].', symbol),
        )
      }
      for (const [sub, k] of ElectronConfiguration.aufbau(core.electrons).occupancy) occ.set(sub, k)
      s = s.slice(close + 1)
    }
    const c = chars(s).filter((ch) => !isWhitespace(ch))
    const parsed = parseTerms(c, 0)
    if (!parsed) {
      throw ChemError.calculation(L('No entiendo la configuración «%@». Escríbela así: «1s2 2s2 2p6» o «[Ne] 3s1».', text))
    }
    for (const [sub, k] of parsed) {
      if (occ.has(sub)) throw ChemError.calculation(L('La subcapa %@ aparece dos veces.', sub.toString()))
      if (k > sub.capacity) {
        throw ChemError.calculation(L('En la subcapa %@ caben como mucho %lld electrones, no %lld.', sub.toString(), sub.capacity, k))
      }
      occ.set(sub, k)
    }
    return new ElectronConfiguration(occ)
  }
}

/** Analiza términos «4s2» seguidos, con vuelta atrás para el caso sin espacios («3d104s2»). */
function parseTerms(c: string[], start: number): [Subshell, number][] | null {
  if (start === c.length) return []
  // n (1 dígito) + letra + electrones (1–2 dígitos)
  if (!(start + 2 < c.length) || !isDigit(c[start])) return null
  const sub = Subshell.parse(`${c[start]}${c[start + 1]}`)
  if (!sub) return null
  let digits = ''
  let k = start + 2
  while (k < c.length && isDigit(c[k]) && digits.length < 2) digits += c[k++]
  if (!digits) return null
  // Primero el número largo (p. ej. «10»); si lo que sigue no cuadra, el corto.
  let lengths = digits.length === 2 ? [2, 1] : [1]
  if (digits.length === 2 && Number(digits) > sub.capacity) lengths = [1]
  for (const len of lengths) {
    const count = Number(digits.slice(0, len))
    if (!(count > 0)) continue
    const rest = parseTerms(c, start + 2 + len)
    if (rest) return [[sub, count], ...rest]
  }
  return null
}

/** Configuración del estado fundamental de un elemento (atajo). */
export const electronConfiguration = (e: Element): ElectronConfiguration => ElectronConfiguration.groundState(e)
