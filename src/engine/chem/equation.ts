// Ecuación química: reactivos, productos, tipo de flecha y condiciones. Análisis y texto (plano, Unicode, LaTeX, mhchem).

import { ChemError } from './errors'
import { L } from './l10n'
import { AtomKey, Formula, type FormulaStyle } from './formula'
import { parseNormalizedFormula } from './parser'
import { Rational } from './rational'
import { charCount, chars, fold, isAsciiLetter, isDigit, isUpper, normalize, trimAll, trimSpaces } from './text'

/** Un término: coeficiente (si se escribió) y especie (sin coeficiente). */
export interface Term {
  /** Coeficiente escrito; `null` = 1 implícito. */
  readonly coefficient: Rational | null
  readonly formula: Formula
}

/** Crea un término (la fórmula se guarda sin coeficiente). */
export function makeTerm(formula: Formula, coefficient: Rational | null = null): Term {
  return { coefficient, formula: formula.withoutCoefficient() }
}

/** Coeficiente efectivo (1 si no se escribió). */
export const effectiveCoefficient = (t: Term): Rational => t.coefficient ?? Rational.ONE

function termsEqual(a: Term, b: Term): boolean {
  const c = a.coefficient === null ? b.coefficient === null : a.coefficient.equals(b.coefficient)
  return c && a.formula.equals(b.formula)
}

/** Tipo de flecha: → o ⇌ (equilibrio). */
export type Arrow = 'forward' | 'reversible'
export type Side = 'reactants' | 'products'

export interface EquationInit {
  reactants: readonly Term[]
  products: readonly Term[]
  arrow?: Arrow
  conditions?: string | null
  notes?: readonly string[]
}

/** Palabras que se ignoran como términos («+ calor», «+ energía», «hν»). */
const ENERGY_WORDS = new Set(['calor', 'energia', 'energía', 'heat', 'energy', 'luz', 'light', 'hv', 'hν', 'Δ', 'q', 'e(luz)'])

/** Longitud máxima de una ecuación. */
export const EQUATION_MAX_LENGTH = 50_000

export class ChemicalEquation {
  readonly reactants: readonly Term[]
  readonly products: readonly Term[]
  readonly arrow: Arrow
  /** Texto sobre la flecha (Δ, catalizador…), si lo había. */
  readonly conditions: string | null
  /** Avisos del análisis (p. ej. «he ignorado "calor"»), en español: acaban en los informes del balanceo para la IA. */
  readonly notes: readonly string[]

  constructor(init: EquationInit) {
    this.reactants = init.reactants
    this.products = init.products
    this.arrow = init.arrow ?? 'forward'
    this.conditions = init.conditions ?? null
    this.notes = init.notes ?? []
  }

  /** Copia con cambios. */
  with(changes: Partial<EquationInit>): ChemicalEquation {
    return new ChemicalEquation({
      reactants: this.reactants,
      products: this.products,
      arrow: this.arrow,
      conditions: this.conditions,
      notes: this.notes,
      ...changes,
    })
  }

  /** Todos los términos: reactivos y luego productos. */
  get terms(): Term[] {
    return [...this.reactants, ...this.products]
  }

  /** Coeficientes efectivos (reactivos y luego productos). */
  get coefficients(): Rational[] {
    return this.terms.map(effectiveCoefficient)
  }

  /** La misma ecuación con otros coeficientes (reactivos y luego productos). Un 1 se guarda como implícito. */
  withCoefficients(coefficients: readonly number[]): ChemicalEquation {
    const nR = this.reactants.length
    const set = (t: Term, c: number | undefined): Term =>
      c === undefined ? t : { coefficient: c === 1 ? null : Rational.int(c), formula: t.formula }
    return this.with({
      reactants: this.reactants.map((t, i) => set(t, coefficients[i])),
      products: this.products.map((t, i) => set(t, coefficients[nR + i])),
    })
  }

  /** Átomos totales de cada tipo en un lado (con los coeficientes). */
  atomTotals(side: Side): Map<AtomKey, Rational> {
    const totals = new Map<AtomKey, Rational>()
    for (const t of side === 'reactants' ? this.reactants : this.products) {
      const c = effectiveCoefficient(t)
      for (const [k, n] of t.formula.composition) totals.set(k, (totals.get(k) ?? Rational.ZERO).add(c.mul(n)))
    }
    return totals
  }

  /** Carga total de un lado. */
  chargeTotal(side: Side): Rational {
    let total = Rational.ZERO
    for (const t of side === 'reactants' ? this.reactants : this.products) total = total.add(effectiveCoefficient(t).mul(t.formula.charge))
    return total
  }

  /** `true` si, con los coeficientes escritos, se conservan todos los átomos y la carga. */
  get isBalanced(): boolean {
    const l = this.atomTotals('reactants')
    const r = this.atomTotals('products')
    for (const k of new Set([...l.keys(), ...r.keys()])) {
      if (!(l.get(k) ?? Rational.ZERO).equals(r.get(k) ?? Rational.ZERO)) return false
    }
    return this.chargeTotal('reactants').equals(this.chargeTotal('products'))
  }

  equals(o: ChemicalEquation): boolean {
    return (
      this.arrow === o.arrow &&
      this.conditions === o.conditions &&
      this.reactants.length === o.reactants.length &&
      this.products.length === o.products.length &&
      this.reactants.every((t, i) => termsEqual(t, o.reactants[i])) &&
      this.products.every((t, i) => termsEqual(t, o.products[i])) &&
      this.notes.length === o.notes.length &&
      this.notes.every((n, i) => n === o.notes[i])
    )
  }

  // MARK: Texto

  /** «4 Fe + 3 O2 -> 2 Fe2O3» (se puede volver a analizar). */
  get plainText(): string {
    return this.render('plain')
  }
  /** «4 Fe + 3 O₂ → 2 Fe₂O₃». */
  get unicodeText(): string {
    return this.render('unicode')
  }
  /** «4\,\mathrm{Fe} + 3\,\mathrm{O_{2}} \longrightarrow 2\,\mathrm{Fe_{2}O_{3}}» (sin condiciones). */
  get latex(): string {
    return this.render('latex')
  }
  /** mhchem para KaTeX: «\ce{4 Fe + 3 O2 -> 2 Fe2O3}», con las condiciones sobre la flecha («->[\Delta]»). */
  get ce(): string {
    const side = (terms: readonly Term[]): string => terms.map((t) => t.formula.ceBody(true, t.coefficient)).join(' + ')
    const cond = this.conditions ? `[${this.conditions.split('Δ').join('\\Delta')}]` : ''
    const arrow = this.arrow === 'reversible' ? '<=>' + cond : '->' + cond
    return `\\ce{${side(this.reactants)} ${arrow} ${side(this.products)}}`
  }
  toString(): string {
    return this.unicodeText
  }
  /** Se guarda como texto plano, como la app Swift. */
  toJSON(): string {
    return this.plainText
  }
  static fromJSON(text: string): ChemicalEquation {
    return ChemicalEquation.parse(text)
  }

  render(style: FormulaStyle): string {
    let arrowText: string
    if (style === 'plain') arrowText = this.arrow === 'reversible' ? '<=>' : this.conditions !== null ? `->[${this.conditions}]` : '->'
    else if (style === 'unicode') arrowText = this.arrow === 'reversible' ? '⇌' : this.conditions !== null ? `→[${this.conditions}]` : '→'
    else arrowText = this.arrow === 'reversible' ? '\\rightleftharpoons' : '\\longrightarrow'
    if (style === 'plain') {
      // En texto plano, los coeficientes van separados por un espacio para que se lean bien.
      const spaced = (terms: readonly Term[]): string =>
        terms
          .map((t) => {
            const f = t.formula.text('plain', false, true)
            const c = t.coefficient
            return !c || c.equals(Rational.ONE) ? f : `${c.toString()} ${f}`
          })
          .join(' + ')
      return `${spaced(this.reactants)} ${arrowText} ${spaced(this.products)}`
    }
    const side = (terms: readonly Term[]): string =>
      terms.map((t) => t.formula.withCoefficient(t.coefficient).text(style, true, true)).join(' + ')
    return `${side(this.reactants)} ${arrowText} ${side(this.products)}`
  }

  // MARK: Análisis

  /**
   * Analiza una ecuación: flechas `->`, `→`, `⟶`, `=`, `⇌`, `<=>`, `<->`, `⇄` (y `\rightarrow`, `\rightleftharpoons`…),
   * condiciones sobre la flecha (`->[Δ]`, `\xrightarrow{Δ}`), coeficientes enteros o fraccionarios (`1/2 O2`), estados,
   * y «+» como separador sin confundirlo con las cargas (`Fe3+ + e- -> Fe2+`, incluso `Fe3++e-->Fe2+`).
   */
  static parse(text: string): ChemicalEquation {
    const t = trimAll(text)
    if (!t) throw ChemError.empty('La ecuación')
    if (charCount(t) > EQUATION_MAX_LENGTH) throw ChemError.tooLong(EQUATION_MAX_LENGTH)
    const s = normalize(t)
    const [left, right, arrow, conditions] = splitArrow(s)
    const notes: string[] = []
    if (!trimSpaces(left)) throw ChemError.emptySide('reactivos')
    if (!trimSpaces(right)) throw ChemError.emptySide('productos')
    const parseSide = (texts: string[], side: Side): Term[] => {
      const terms: Term[] = []
      for (const raw of texts) {
        const term = trimSpaces(raw)
        if (!term) {
          throw ChemError.calculation(
            side === 'reactants' ? L('Sobra un «+» en los reactivos: falta una especie.') : L('Sobra un «+» en los productos: falta una especie.'),
          )
        }
        if (ENERGY_WORDS.has(fold(term)) || ENERGY_WORDS.has(term)) {
          // Aviso para los informes de la IA: no se localiza.
          notes.push(`He ignorado «${term}»: no es una especie química.`)
          continue
        }
        let f: Formula
        try {
          f = parseNormalizedFormula(term)
        } catch (e) {
          if (e instanceof ChemError) throw ChemError.calculation(L('En «%@»: %@', term, e.message))
          throw e
        }
        terms.push(makeTerm(f, f.coefficient))
      }
      return terms
    }
    const reactants = parseSide(splitTerms(left), 'reactants')
    const products = parseSide(splitTerms(right), 'products')
    if (reactants.length === 0) throw ChemError.emptySide('reactivos')
    if (products.length === 0) throw ChemError.emptySide('productos')
    return new ChemicalEquation({ reactants, products, arrow, conditions, notes })
  }
}

const ARROWS: readonly (readonly [string, Arrow])[] = [
  ['<==>', 'reversible'], ['<-->', 'reversible'], ['<=>', 'reversible'], ['<->', 'reversible'],
  ['-->', 'forward'], ['==>', 'forward'], ['->', 'forward'], ['=>', 'forward'], ['==', 'forward'],
  ['⇌', 'reversible'], ['→', 'forward'], ['=', 'forward'],
]

/** Separa reactivos, flecha y productos. */
export function splitArrow(s: string): [string, string, Arrow, string | null] {
  const c = chars(s)
  const found: { start: number; end: number; arrow: Arrow }[] = []
  let i = 0
  let braceDepth = 0
  let squareDepth = 0
  while (i < c.length) {
    if (c[i] === '{') braceDepth++
    if (c[i] === '}') braceDepth = Math.max(0, braceDepth - 1)
    if (c[i] === '[') squareDepth++
    if (c[i] === ']') squareDepth = Math.max(0, squareDepth - 1)
    // Dentro de llaves o corchetes no hay flechas («->[T = 450 °C]»).
    if (braceDepth > 0 || squareDepth > 0) {
      i++
      continue
    }
    let matched = false
    for (const [token, kind] of ARROWS) {
      const tc = chars(token)
      if (i + tc.length > c.length) continue
      let same = true
      for (let k = 0; k < tc.length; k++) if (c[i + k] !== tc[k]) same = false
      if (!same) continue
      let start = i
      if (token === '-->' && i >= 1) {
        // «e-->»: el primer «-» es la carga del electrón; «SO4^2-->»: es la carga escrita con «^».
        const electron = c[i - 1] === 'e' && (i === 1 || !isAsciiLetter(c[i - 2]))
        let k = i - 1
        while (k >= 0 && isDigit(c[k])) k--
        const caretCharge = k >= 0 && c[k] === '^'
        if (electron || caretCharge) start = i + 1
      }
      found.push({ start, end: i + tc.length, arrow: kind })
      i += tc.length
      matched = true
      break
    }
    if (!matched) i++
  }
  const first = found[0]
  if (!first) throw ChemError.missingArrow()
  if (found.length !== 1) throw ChemError.multipleArrows()
  const left = trimSpaces(c.slice(0, first.start).join(''))
  let rightChars = chars(trimSpaces(c.slice(first.end).join('')))
  // Condiciones estilo mhchem: «->[Δ]» o «->[cat][T]» justo detrás de la flecha.
  const conditions: string[] = []
  while (rightChars[0] === '[') {
    let depth = 0
    let k = 0
    let inner = ''
    while (k < rightChars.length) {
      if (rightChars[k] === '[') {
        depth++
        if (depth === 1) {
          k++
          continue
        }
      }
      if (rightChars[k] === ']') {
        depth--
        if (depth === 0) break
      }
      inner += rightChars[k++]
    }
    if (k >= rightChars.length) break
    const after = rightChars.slice(k + 1)
    // «->[Fe(CN)6]3-» es una especie, no una condición: tras el corchete viene un número, signo o fórmula.
    const next = after[0]
    if (next !== undefined && (isDigit(next) || next === '+' || next === '-' || next === '^' || isUpper(next) || next === '(')) break
    const rest = trimSpaces(after.join(''))
    if (!rest) break // «->[Ni(CO)4]» sin más: es el producto.
    conditions.push(trimSpaces(inner))
    rightChars = chars(rest)
  }
  const cond = conditions.filter((x) => x.length > 0).join(', ')
  return [left, rightChars.join(''), first.arrow, cond ? cond : null]
}

/** Separa los términos de un lado por los «+» que son separadores (no cargas). */
export function splitTerms(side: string): string[] {
  const c = chars(side)
  const terms: string[] = []
  let current = ''
  let braceDepth = 0
  let i = 0
  const nextNonSpace = (j: number): number | null => {
    let k = j
    while (k < c.length && c[k] === ' ') k++
    return k < c.length ? k : null
  }
  const isStateAt = (k: number): boolean => {
    const rest = c.slice(k).join('')
    return ['(aq)', '(ac)', '(s)', '(l)', '(g)'].some((p) => rest.startsWith(p))
  }
  while (i < c.length) {
    const ch = c[i]
    if (ch === '{') braceDepth++
    if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
    if (!(ch === '+' && braceDepth === 0 && !(i > 0 && c[i - 1] === '^'))) {
      current += ch
      i++
      continue
    }
    // ¿Es separador?
    let separator = true
    const spaceBefore = i > 0 && c[i - 1] === ' '
    const n = nextNonSpace(i + 1)
    if (n !== null) {
      if (spaceBefore) {
        separator = true // las cargas van pegadas a la fórmula: « + » con espacio delante separa
      } else if (c[n] === '(' && isStateAt(n)) {
        separator = false // «Ag+(aq)»: carga seguida del estado
      } else if (c[n] === '+') {
        separator = false // el siguiente «+» es el separador; este es una carga
      } else if (isDigit(c[n])) {
        // «+3» detrás de una especie: carga si después de los dígitos no empieza otra especie.
        let k = n
        while (k < c.length && isDigit(c[k])) k++
        if (n === i + 1) {
          if (k >= c.length) separator = false
          else if (c[k] === '+') separator = false
          else if (c[k] === ' ') {
            const m = nextNonSpace(k)
            if (m !== null && c[m] === '+') separator = false
            if (m === null) separator = false
          } else if (c[k] === '(' && isStateAt(k)) separator = false
        }
      }
      if (!trimSpaces(current)) separator = true
    } else {
      separator = false // «+» final: carga
    }
    if (separator) {
      terms.push(current)
      current = ''
    } else {
      current += ch
    }
    i++
  }
  terms.push(current)
  return terms
}
