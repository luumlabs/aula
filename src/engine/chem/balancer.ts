// Balanceo exacto por el método algebraico: espacio nulo de la matriz de composición (con la carga como fila extra) en
// aritmética racional exacta, y coeficientes enteros mínimos. Los mensajes y pasos van en español (los lee la IA).

import { errorMessage } from './errors'
import { ChemicalEquation, effectiveCoefficient, makeTerm, type Term } from './equation'
import { AtomKey, Formula } from './formula'
import { parseFormula } from './parser'
import { nullSpace, Rational } from './rational'
import { spectatorRows } from './redox'
import { gcd, subscripted } from './text'

/** Medio para completar ecuaciones redox iónicas: solo lo escrito, o añadir H⁺/OH⁻ y H₂O donde haga falta. */
export type BalanceMedium = 'none' | 'acidic' | 'basic'

/**
 * - `balanced`: con los coeficientes enteros mínimos.
 * - `alreadyBalanced`: ya lo estaba con los coeficientes escritos (ver `notes` si no eran los mínimos).
 * - `multipleSolutions`: hay varias soluciones independientes (reacciones mezcladas): ver `alternatives`.
 * - `impossible`: no se puede balancear (elemento en un solo lado, especie sobrante…): ver `message`.
 * - `invalid`: la ecuación no se pudo leer.
 */
export type BalanceStatus = 'balanced' | 'alreadyBalanced' | 'multipleSolutions' | 'impossible' | 'invalid'

/** Resultado de balancear una ecuación. */
export interface BalanceResult {
  readonly status: BalanceStatus
  /** Ecuación balanceada (coeficientes enteros mínimos) cuando la hay. */
  readonly equation: ChemicalEquation | null
  /** Coeficientes de `equation` (reactivos y luego productos). */
  readonly coefficients: readonly number[]
  /** Soluciones independientes (`multipleSolutions`) o propuestas de arreglo (`impossible`). */
  readonly alternatives: readonly ChemicalEquation[]
  /** Resumen en español. */
  readonly message: string
  /** Pasos explicados en español. */
  readonly steps: readonly string[]
  /** Avisos adicionales. */
  readonly notes: readonly string[]
  /** `true` si hay una ecuación balanceada válida. */
  readonly isBalanced: boolean
}

function result(r: Omit<BalanceResult, 'isBalanced'>): BalanceResult {
  return { ...r, isBalanced: r.status === 'balanced' || r.status === 'alreadyBalanced' }
}

/** Balancea una ecuación ya leída. Con `acidic`/`basic` se pueden añadir H₂O y H⁺/OH⁻ en el lado que haga falta. */
export function balanceEquation(equation: ChemicalEquation, medium: BalanceMedium = 'none'): BalanceResult {
  return new Balancer(equation, medium).run()
}

/** Analiza y balancea un texto. Si no se puede leer, devuelve `status === 'invalid'` con el motivo. */
export function balance(text: string, medium: BalanceMedium = 'none'): BalanceResult {
  let eq: ChemicalEquation
  try {
    eq = ChemicalEquation.parse(text)
  } catch (e) {
    return result({ status: 'invalid', equation: null, coefficients: [], alternatives: [], message: errorMessage(e, 'No pude leer la ecuación.'), steps: [], notes: [] })
  }
  return balanceEquation(eq, medium)
}

/** Atajos con el nombre de la app Swift. */
export const EquationBalancer = { balance }

const unicodeName = (f: Formula): string => f.text('unicode', false, false)
const termOf = (c: number, f: Formula): Term => makeTerm(f, Math.abs(c) === 1 ? null : Rational.int(Math.abs(c)))

/** Nombre de la incógnita j: a, b, c… (x₂₇… si hay muchas). */
export function unknownName(j: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return j < letters.length ? letters[j] : 'x' + subscripted(String(j + 1))
}

/** Enteros de un vector (`null` si alguno pasa de 10⁹: demasiado grande para mostrarlo). */
function toInts(v: readonly bigint[]): number[] | null {
  const out: number[] = []
  for (const x of v) {
    if (x > 1_000_000_000n || x < -1_000_000_000n) return null
    out.push(Number(x))
  }
  return out
}

class Balancer {
  constructor(
    private readonly original: ChemicalEquation,
    private readonly medium: BalanceMedium,
  ) {}

  private fail(message: string, steps: string[] = [], alternatives: ChemicalEquation[] = [], notes: string[] = []): BalanceResult {
    return result({ status: 'impossible', equation: null, coefficients: [], alternatives, message, steps, notes: [...this.original.notes, ...notes] })
  }

  run(): BalanceResult {
    const original = this.original
    // Especies repetidas.
    const dupR = duplicate(original.reactants)
    if (dupR) return this.fail(`El ${dupR} aparece dos veces en los reactivos: escríbelo una sola vez.`)
    const dupP = duplicate(original.products)
    if (dupP) return this.fail(`El ${dupP} aparece dos veces en los productos: escríbelo una sola vez.`)
    const leftKeys = new Set(original.reactants.map((t) => t.formula.identityKey))
    const both = original.products.find((t) => leftKeys.has(t.formula.identityKey))
    if (both) {
      return this.fail(
        `El ${unicodeName(both.formula)} aparece a los dos lados de la flecha: así hay infinitas soluciones. Quítalo de un lado (o simplifica la ecuación) y vuelve a balancear.`,
      )
    }

    // Especies del medio (H₂O, H⁺/OH⁻) con signo libre: van al final de los reactivos.
    let eq = original
    const flexible = new Set<number>()
    const addedNames: string[] = []
    if (this.medium !== 'none') {
      const extra = this.medium === 'acidic' ? ['H2O', 'H^+'] : ['H2O', 'OH^-']
      for (const text of extra) {
        const f = parseFormula(text)
        if (!eq.terms.some((t) => t.formula.identityKey === f.identityKey)) {
          eq = eq.with({ reactants: [...eq.reactants, makeTerm(f)] })
          flexible.add(eq.reactants.length - 1)
          addedNames.push(f.unicodeText)
        }
      }
    }
    const nR = eq.reactants.length
    const species = eq.terms.map((t) => t.formula)
    const n = species.length

    // Matriz de composición: reactivos positivos, productos negativos. Elementos en orden de aparición.
    const atoms: AtomKey[] = []
    for (const f of species) for (const k of Formula.conventionalOrder([...f.composition.keys()])) if (!atoms.includes(k)) atoms.push(k)
    const rows: number[][] = []
    const rowNames: string[] = []
    for (const a of atoms) {
      rows.push(species.map((f, j) => (f.composition.get(a) ?? 0) * (j < nR ? 1 : -1)))
      rowNames.push(a.symbol)
    }
    const hasCharge = species.some((f) => f.charge !== 0)
    if (hasCharge) {
      rows.push(species.map((f, j) => f.charge * (j < nR ? 1 : -1)))
      rowNames.push('carga')
    }

    // Elemento en un solo lado (sin contar las especies añadidas, que pueden ir a cualquier lado).
    for (let r = 0; r < atoms.length; r++) {
      const idx = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k)
      const inLeft = idx(0, nR).some((j) => rows[r][j] !== 0 && !flexible.has(j))
      const inRight = idx(nR, n).some((j) => rows[r][j] !== 0)
      const inFlexible = [...flexible].some((j) => rows[r][j] !== 0)
      if (inFlexible) continue
      if (inLeft && !inRight) {
        return this.fail(
          `No se puede balancear: el ${atoms[r].symbol} solo aparece en los reactivos. Falta algún producto que lo contenga (o sobra un reactivo).`,
          setupSteps(eq, rows, rowNames),
        )
      }
      if (inRight && !inLeft) {
        return this.fail(
          `No se puede balancear: el ${atoms[r].symbol} solo aparece en los productos. Falta algún reactivo que lo contenga (o sobra un producto).`,
          setupSteps(eq, rows, rowNames),
        )
      }
    }

    const steps = setupSteps(eq, rows, rowNames)
    if (addedNames.length > 0) {
      steps.unshift(`Medio ${this.medium === 'acidic' ? 'ácido' : 'básico'}: añado ${addedNames.join(' y ')} como especies que pueden ir a cualquier lado.`)
    }
    let ns = nullSpace(rows, n)
    const notes = [...original.notes]
    let ambiguityNote: string | null = null

    if (ns.basis.length === 0) {
      if (hasCharge && nullSpace(rows.slice(0, -1), n).basis.length > 0) {
        return this.fail('No se puede balancear: los átomos cuadran, pero la carga total no se puede conservar. Revisa las cargas o añade electrones (e⁻).', steps)
      }
      return this.fail('No hay coeficientes que conserven todos los átomos a la vez: revisa las fórmulas (puede faltar o sobrar alguna especie).', steps)
    }

    if (ns.basis.length > 1) {
      // Intenta deshacer la ambigüedad con los números de oxidación (método de las semirreacciones).
      const extra = spectatorRows(species, nR, flexible)
      if (extra && extra.length > 0) {
        const refined = nullSpace([...rows, ...extra], n)
        if (refined.basis.length === 1 && signsOK(refined.basis[0], flexible)) {
          ns = refined
          ambiguityNote =
            'Ojo: con solo contar átomos esta ecuación admite varias soluciones (hay una reacción secundaria posible). Te doy la del método de las semirreacciones, que es la que piden los libros.'
        }
      }
    }

    if (ns.basis.length > 1) return this.multiple(eq, ns.basis, flexible, steps)

    // Solución única (salvo múltiplos).
    let v = ns.basis[0]
    const fixedIdx = Array.from({ length: n }, (_, j) => j).filter((j) => !flexible.has(j))
    const positives = fixedIdx.filter((j) => v[j] > 0n).length
    const negatives = fixedIdx.filter((j) => v[j] < 0n).length
    if (negatives > positives || (positives === 0 && negatives > 0)) v = v.map((x) => -x)
    const zeros = fixedIdx.filter((j) => v[j] === 0n)
    const wrong = fixedIdx.filter((j) => v[j] < 0n)
    const names = species.map(unicodeName)
    const ints = toInts(v)
    if (!ints) return this.fail('Los coeficientes salen demasiado grandes para mostrarlos: revisa la ecuación.', steps)
    if (zeros.length > 0) {
      const z = zeros.map((j) => names[j]).join(', ')
      const fixedEq = eq.with({
        reactants: eq.reactants.filter((_, j) => !zeros.includes(j)),
        products: eq.products.filter((_, j) => !zeros.includes(nR + j)),
      })
      const alternatives: ChemicalEquation[] = []
      if (fixedEq.reactants.length > 0 && fixedEq.products.length > 0) {
        const r = new Balancer(fixedEq, 'none').run()
        if (r.isBalanced && r.equation) alternatives.push(r.equation)
      }
      const verb = zeros.length === 1 ? 'sobra: su coeficiente tendría que ser 0' : 'sobran: sus coeficientes tendrían que ser 0'
      return this.fail(`No se puede balancear tal cual: ${z} ${verb}. Quítal${zeros.length === 1 ? 'o' : 'os'} de la ecuación.`, steps, alternatives)
    }
    if (wrong.length > 0) {
      const w = wrong.map((j) => names[j]).join(', ')
      // Propuesta: mover esas especies al otro lado (las que se quedan van primero; las que cambian, al final).
      const movedR: Term[] = []
      const movedP: Term[] = []
      const toLeft: Term[] = []
      const toRight: Term[] = []
      for (let j = 0; j < n; j++) {
        const c = ints[j]
        if (c === 0) continue
        const onLeft = j < nR === c > 0
        const term = termOf(c, species[j])
        if (onLeft) (j < nR ? movedR : toLeft).push(term)
        else (j >= nR ? movedP : toRight).push(term)
      }
      const moved = new ChemicalEquation({ reactants: [...movedR, ...toLeft], products: [...movedP, ...toRight], arrow: eq.arrow, conditions: eq.conditions })
      const side = wrong.every((j) => j < nR) ? 'en los productos' : wrong.every((j) => j >= nR) ? 'en los reactivos' : 'al otro lado'
      return this.fail(
        `No se puede balancear con coeficientes positivos: ${w} tendría que estar ${side}.`,
        steps,
        moved.reactants.length === 0 || moved.products.length === 0 ? [] : [moved],
      )
    }

    // Construye la ecuación balanceada (las especies añadidas van al lado que diga su signo).
    const resR: Term[] = []
    const resP: Term[] = []
    const movedToProducts: Term[] = []
    for (let j = 0; j < n; j++) {
      const c = ints[j]
      if (c === 0) continue
      const term = termOf(c, species[j])
      if (flexible.has(j)) (c > 0 ? resR : movedToProducts).push(term)
      else if (j < nR) resR.push(term)
      else resP.push(term)
    }
    const res = new ChemicalEquation({ reactants: resR, products: [...resP, ...movedToProducts], arrow: eq.arrow, conditions: eq.conditions })
    const coefficients = res.terms.map((t) => effectiveCoefficient(t).intValue ?? 1)

    steps.push(solutionStep(ints))
    steps.push(...verificationSteps(res))
    if (ambiguityNote) notes.push(ambiguityNote)

    // ¿Ya estaba balanceada con los coeficientes escritos?
    if ((this.medium === 'none' || flexible.size === 0) && original.isBalanced) {
      const given = original.coefficients
      const minimal = coefficients.map((c) => Rational.int(c))
      if (given.length === minimal.length && given.every((g, i) => g.equals(minimal[i]))) {
        return result({
          status: 'alreadyBalanced', equation: res, coefficients, alternatives: [],
          message: `La ecuación ya estaba balanceada: ${res.unicodeText}`, steps, notes,
        })
      }
      const hasFractions = given.some((g) => !g.isInteger)
      const note = hasFractions
        ? `Tus coeficientes ya la balanceaban, pero con fracciones; con enteros mínimos queda: ${res.unicodeText}`
        : `Tus coeficientes ya la balanceaban, pero no son los mínimos; simplificando queda: ${res.unicodeText}`
      return result({
        status: 'alreadyBalanced', equation: res, coefficients, alternatives: [],
        message: 'La ecuación ya estaba balanceada. ' + note, steps, notes: [...notes, note],
      })
    }
    return result({ status: 'balanced', equation: res, coefficients, alternatives: [], message: `Ecuación balanceada: ${res.unicodeText}`, steps, notes })
  }

  // MARK: Varias soluciones

  private multiple(eq: ChemicalEquation, basis: bigint[][], flexible: Set<number>, steps: string[]): BalanceResult {
    const original = this.original
    const nR = eq.reactants.length
    const species = eq.terms.map((t) => t.formula)
    const alternatives: ChemicalEquation[] = []
    for (const v of basis) {
      const ints = toInts(v)
      if (!ints) continue
      // Orienta cada solución para que tenga más términos positivos.
      const pos = ints.filter((x) => x > 0).length
      const neg = ints.filter((x) => x < 0).length
      const oriented = neg > pos ? ints.map((x) => -x) : ints
      const r: Term[] = []
      const p: Term[] = []
      oriented.forEach((c, j) => {
        if (c === 0) return
        ;(j < nR === c > 0 ? r : p).push(termOf(c, species[j]))
      })
      if (r.length > 0 && p.length > 0) alternatives.push(new ChemicalEquation({ reactants: r, products: p, arrow: eq.arrow }))
    }
    // Una combinación con todos los coeficientes positivos, si existe con pesos pequeños.
    let example: [ChemicalEquation, number[]] | null = null
    const intBasis = basis.map(toInts)
    if (basis.length <= 3 && intBasis.every((x) => x !== null)) {
      const ib = intBasis as number[][]
      const n = species.length
      let best: number[] | null = null
      const weightOf = (a: number[]): number => a.reduce((s, x) => s + Math.abs(x), 0)
      const search = (k: number, acc: number[]): void => {
        if (k === ib.length) {
          const fixedOK = acc.every((x, j) => flexible.has(j) || x > 0)
          if (fixedOK && (best === null || weightOf(acc) < weightOf(best))) best = acc
          return
        }
        for (const w of [1, 2, 3, 4]) for (const s of [1, -1]) search(k + 1, acc.map((x, j) => x + s * w * ib[k][j]))
      }
      search(0, new Array(n).fill(0))
      if (best) {
        const b: number[] = best
        const g = b.reduce((acc, x) => gcd(acc, x), 0)
        const reduced = g > 1 ? b.map((x) => x / g) : b
        const r: Term[] = []
        const p: Term[] = []
        reduced.forEach((c, j) => {
          if (c === 0) return
          const onLeft = flexible.has(j) ? c > 0 : j < nR
          ;(onLeft ? r : p).push(termOf(c, species[j]))
        })
        const e = new ChemicalEquation({ reactants: r, products: p, arrow: eq.arrow })
        example = [e, e.terms.map((t) => effectiveCoefficient(t).intValue ?? 1)]
      }
    }
    // Si los coeficientes escritos ya la balanceaban, se respetan; si son fraccionarios se escalan a enteros primitivos,
    // para que `coefficients` y `equation` digan lo mismo (nunca se sustituyen por 1 o por 0).
    if (flexible.size === 0 && original.isBalanced) {
      let scale = 1n
      for (const t of original.terms) {
        const d = effectiveCoefficient(t).den
        let a = scale
        let b = d
        while (b !== 0n) [a, b] = [b, a % b]
        scale = (scale / a) * d
      }
      const scaled = (terms: readonly Term[]): Term[] | null => {
        const out: Term[] = []
        for (const t of terms) {
          const v = effectiveCoefficient(t).mul(Rational.int(scale)).intValue
          if (v === null) return null
          out.push(makeTerm(t.formula, v === 1 ? null : Rational.int(v)))
        }
        return out
      }
      const sr = scaled(original.reactants)
      const sp = scaled(original.products)
      if (!sr || !sp) return this.fail('Los coeficientes son demasiado grandes para escalarlos a enteros.', steps)
      let equation = new ChemicalEquation({ reactants: sr, products: sp, arrow: original.arrow, conditions: original.conditions, notes: original.notes })
      // Enteros primitivos: el mcm de los denominadores no basta (4.5/3/3/1.5 da 9/6/6/3, que todavía tiene mcd 3).
      const ints = equation.terms.map((t) => effectiveCoefficient(t).intValue).filter((x): x is number => x !== null)
      const common = ints.reduce((acc, x) => gcd(acc, x), 0)
      if (common > 1) {
        const reduced = equation.terms.map((t) => {
          const v = effectiveCoefficient(t).intValue
          if (v === null) return t
          const r = v / common
          return makeTerm(t.formula, r === 1 ? null : Rational.int(r))
        })
        equation = new ChemicalEquation({
          reactants: reduced.slice(0, equation.reactants.length),
          products: reduced.slice(equation.reactants.length),
          arrow: equation.arrow,
          conditions: equation.conditions,
          notes: original.notes,
        })
      }
      const coefficients = equation.terms.map((t) => effectiveCoefficient(t).intValue ?? 0)
      if (!coefficients.every((c) => c > 0)) return this.fail('El coeficiente no puede ser 0.', steps)
      const note = `Ojo: esta ecuación admite otras combinaciones válidas (mezcla ${basis.length} reacciones independientes).`
      const head = equation.equals(original)
        ? `La ecuación ya estaba balanceada: ${original.unicodeText}.`
        : `La ecuación ya estaba balanceada: ${original.unicodeText}. Con enteros primitivos: ${equation.unicodeText}.`
      return result({
        status: 'alreadyBalanced', equation, coefficients, alternatives,
        message: head + ' ' + note, steps, notes: [...original.notes, note],
      })
    }
    let message = `Esta ecuación admite ${basis.length} soluciones independientes: en realidad mezcla ${basis.length} reacciones distintas, así que no hay un único balanceo.`
    if (alternatives.length > 0) message += ' Reacciones independientes: ' + alternatives.map((a) => a.unicodeText).join(' ; ') + '.'
    const ex = example as [ChemicalEquation, number[]] | null
    if (ex) message += ` Una combinación válida es ${ex[0].unicodeText}, pero no es la única.`
    return result({
      status: 'multipleSolutions', equation: ex ? ex[0] : null, coefficients: ex ? ex[1] : [], alternatives,
      message, steps, notes: original.notes,
    })
  }
}

function signsOK(v: readonly bigint[], flexible: Set<number>): boolean {
  const fixed = v.map((x, j) => [x, j] as const).filter(([, j]) => !flexible.has(j))
  return fixed.every(([x]) => x > 0n) || fixed.every(([x]) => x < 0n)
}

function duplicate(terms: readonly Term[]): string | null {
  const seen = new Set<string>()
  for (const t of terms) {
    const k = t.formula.identityKey
    if (seen.has(k)) return unicodeName(t.formula)
    seen.add(k)
  }
  return null
}

function setupSteps(eq: ChemicalEquation, rows: number[][], rowNames: string[]): string[] {
  const nR = eq.reactants.length
  const species = eq.terms.map((t) => t.formula)
  const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k)
  const sideText = (r: number[]): string => r.map((j) => `${unknownName(j)} ${unicodeName(species[j])}`).join(' + ')
  const steps = [`Pongo un coeficiente desconocido a cada especie: ${sideText(range(0, nR))} → ${sideText(range(nR, species.length))}`]
  if (species.length > 26) return steps
  steps.push(`Igualo, para cada elemento${rowNames.includes('carga') ? ' y para la carga' : ''}, lo que hay a la izquierda y a la derecha:`)
  rowNames.forEach((name, r) => {
    const terms = (idx: number[], sign: number): string => {
      const parts: string[] = []
      for (const j of idx) {
        const k = rows[r][j] * sign
        if (k === 0) continue
        const u = unknownName(j)
        parts.push(k === 1 ? u : k === -1 ? `-${u}` : `${k}${u}`)
      }
      return parts.length === 0 ? '0' : parts.join(' + ').split('+ -').join('- ')
    }
    const label = name === 'carga' ? 'Carga' : name
    steps.push(`• ${label}: ${terms(range(0, nR), 1)} = ${terms(range(nR, species.length), -1)}`)
  })
  return steps
}

function solutionStep(ints: readonly number[]): string {
  const pairs = ints.map((x, j) => `${unknownName(j)} = ${Math.abs(x)}`).join(', ')
  return `Resuelvo el sistema con fracciones exactas y multiplico por el mínimo común múltiplo para tener los enteros más pequeños: ${pairs}.`
}

function verificationSteps(e: ChemicalEquation): string[] {
  const l = e.atomTotals('reactants')
  const r = e.atomTotals('products')
  const keys = Formula.conventionalOrder([...new Set([...l.keys(), ...r.keys()])])
  const parts = keys.map((k) => `${k.symbol}: ${(l.get(k) ?? Rational.ZERO).toString()} = ${(r.get(k) ?? Rational.ZERO).toString()}`)
  if (e.terms.some((t) => t.formula.charge !== 0)) {
    parts.push(`carga: ${e.chargeTotal('reactants').signedString()} = ${e.chargeTotal('products').signedString()}`)
  }
  return ['Compruebo (izquierda = derecha): ' + parts.join('; ') + '.', `Resultado: ${e.unicodeText}`]
}
