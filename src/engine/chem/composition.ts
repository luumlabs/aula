// Masa molar con su desglose, composición porcentual y fórmulas empírica y molecular.

import { ChemError } from './errors'
import { L } from './l10n'
import { localizedElementNameInSentence, PeriodicTable, type Element } from './elements'
import { AtomKey, Formula } from './formula'
import { compact, fixed, roundHalfAway, trimmed, trimSpaces } from './text'

/** Aportación de un tipo de átomo a la masa molar. */
export interface MolarMassContribution {
  readonly atom: AtomKey
  readonly count: number
  /** Masa atómica usada (g/mol). */
  readonly atomicMass: number
  /** Texto de la masa atómica («15.999», «[98]»). */
  readonly atomicMassText: string
  /** count × atomicMass. */
  readonly subtotal: number
  /** Porcentaje en masa de este elemento en el compuesto. */
  readonly massPercent: number
}

/** Masa molar con su desglose por elemento. */
export interface MolarMassResult {
  readonly formula: Formula
  /** Masa molar en g/mol (sin redondear). */
  readonly value: number
  /** Decimales justificados por las masas atómicas (regla de la suma: los de la menos precisa). */
  readonly decimalPlaces: number
  readonly contributions: readonly MolarMassContribution[]
  /** `true` si se usó algún número másico en lugar de una masa atómica estándar. */
  readonly isApproximate: boolean
  /** Valor redondeado como texto: «58.44 g/mol». */
  readonly formatted: string
  /** Pasos explicados en español. */
  readonly steps: readonly string[]
}

/** Masa molar con desglose y porcentajes en masa (la masa de los electrones de los iones se desprecia). */
export function molarMassDetails(formula: Formula): MolarMassResult {
  if (formula.isElectron) {
    const value = 5.48579909e-4
    return finish(formula, value, 7, [], false)
  }
  const keys = Formula.conventionalOrder([...formula.composition.keys()])
  let total = 0
  let minDecimals = Infinity
  let approximate = false
  const partial: [AtomKey, number, number][] = []
  for (const k of keys) {
    const n = formula.composition.get(k) ?? 0
    const sub = n * k.mass
    total += sub
    minDecimals = Math.min(minDecimals, k.massDecimals)
    approximate = approximate || k.massIsApproximate
    partial.push([k, n, sub])
  }
  const contributions = partial.map(([k, n, sub]) => ({
    atom: k,
    count: n,
    atomicMass: k.mass,
    atomicMassText: k.massText,
    subtotal: sub,
    massPercent: total > 0 ? (sub / total) * 100 : 0,
  }))
  return finish(formula, total, minDecimals === Infinity ? 3 : minDecimals, contributions, approximate)
}

function finish(formula: Formula, value: number, decimalPlaces: number, contributions: MolarMassContribution[], isApproximate: boolean): MolarMassResult {
  const formatted = `${fixed(value, decimalPlaces)} g/mol`
  const steps = ['Multiplico la masa atómica de cada elemento por el número de átomos y sumo:']
  for (const c of contributions) {
    steps.push(`• ${c.atom.symbol}: ${c.count} × ${c.atomicMassText} g/mol = ${fixed(c.subtotal, Math.max(c.atom.massDecimals, 0))} g/mol`)
  }
  steps.push(`M(${formula.text('unicode', false, false)}) = ${formatted}`)
  if (isApproximate) {
    steps.push('Ojo: algún elemento no tiene masa atómica estándar; uso el número másico de su isótopo más estable, así que el valor es aproximado.')
  }
  return { formula, value, decimalPlaces, contributions, isApproximate, formatted, steps }
}

/** Masa molar en g/mol. */
export const molarMass = (formula: Formula): number => molarMassDetails(formula).value

/** Porcentaje en masa de cada elemento (isótopos juntos con su elemento), en orden convencional. */
export function percentComposition(formula: Formula): { element: Element; percent: number }[] {
  const details = molarMassDetails(formula)
  const byElement = new Map<number, number>()
  for (const c of details.contributions) byElement.set(c.atom.atomicNumber, (byElement.get(c.atom.atomicNumber) ?? 0) + c.massPercent)
  return formula.elements.map((e) => ({ element: e, percent: byElement.get(e.atomicNumber) ?? 0 }))
}

// MARK: Fórmula empírica y molecular

export interface EmpiricalRow {
  readonly element: Element
  readonly mass: number
  readonly moles: number
  /** moles / moles del elemento con menos moles. */
  readonly ratio: number
  readonly subscriptValue: number
}

export interface EmpiricalResult {
  readonly formula: Formula
  readonly rows: readonly EmpiricalRow[]
  /** Factor por el que se multiplicaron las proporciones (1 si ya eran casi enteras). */
  readonly multiplier: number
  /** `true` si las proporciones no quedaron cerca de enteros con factores 1–6 (resultado dudoso). */
  readonly isApproximate: boolean
  readonly steps: readonly string[]
}

export interface MolecularResult {
  readonly formula: Formula
  readonly factor: number
  readonly steps: readonly string[]
}

/** Fórmulas empírica y molecular a partir de datos de análisis. */
export const EmpiricalFormula = {
  /** A partir de porcentajes en masa (se supone una muestra de 100 g). El elemento puede darse por símbolo o por nombre. */
  fromPercentages(data: readonly (readonly [string, number])[], tolerance = 0.1): EmpiricalResult {
    const sum = data.reduce((a, [, v]) => a + v, 0)
    const extra = ['Supongo 100 g de muestra: cada porcentaje pasa a ser una masa en gramos.']
    if (Math.abs(sum - 100) > 1.5) {
      extra.push(`Ojo: los porcentajes suman ${trimmed(sum, 2)} %, no 100 %. Revisa si falta algún elemento (a veces el oxígeno se calcula por diferencia).`)
    }
    return computeEmpirical(data, tolerance, extra)
  },

  /** A partir de masas (g) de cada elemento. */
  fromMasses(data: readonly (readonly [string, number])[], tolerance = 0.1): EmpiricalResult {
    return computeEmpirical(data, tolerance, [])
  },

  /** Fórmula molecular a partir de la empírica y la masa molar (g/mol). */
  molecularFormula(empirical: Formula, molarMassValue: number, tolerance = 0.05): MolecularResult {
    if (!(Number.isFinite(molarMassValue) && molarMassValue > 0)) throw ChemError.calculation(L('La masa molar tiene que ser un número positivo.'))
    const base = empirical.condensed
    const me = molarMass(base)
    if (!(me > 0)) throw ChemError.calculation(L('La fórmula empírica no tiene masa.'))
    const n = molarMassValue / me
    if (!(Number.isFinite(n) && n < 10_000)) {
      throw ChemError.calculation(L('La masa molar no encaja con la fórmula empírica %@: revisa los datos.', base.unicodeText))
    }
    const k = roundHalfAway(n)
    const steps = [
      `Masa de la fórmula empírica ${base.unicodeText}: ${fixed(me, 3)} g/mol.`,
      `n = M / M(empírica) = ${trimmed(molarMassValue, 3)} ÷ ${fixed(me, 3)} = ${fixed(n, 3)} ≈ ${k}`,
    ]
    if (!(k >= 1 && Math.abs(n - k) <= tolerance * Math.max(k, 1) + 0.05)) {
      throw ChemError.calculation(
        L(
          'La masa molar (%@ g/mol) no es un múltiplo entero de la masa de %@ (%@ g/mol): n = %@. Revisa los datos.',
          trimmed(molarMassValue, 3),
          base.unicodeText,
          fixed(me, 3),
          fixed(n, 2),
        ),
      )
    }
    const comp = new Map<AtomKey, number>()
    for (const [key, v] of base.composition) comp.set(key, v * k)
    const molecular = Formula.fromComposition(comp, base.charge)
    steps.push(`Multiplico los subíndices por ${k}: fórmula molecular ${molecular.unicodeText}.`)
    return { formula: molecular, factor: k, steps }
  },
}

function computeEmpirical(data: readonly (readonly [string, number])[], tolerance: number, intro: string[]): EmpiricalResult {
  if (data.length === 0) throw ChemError.missingData(L('Necesito al menos un elemento con su masa o porcentaje.'))
  const items: [Element, number][] = []
  for (const [name, value] of data) {
    const e = PeriodicTable.bySymbol(trimSpaces(name)) ?? PeriodicTable.byName(name)
    if (!e) throw ChemError.unknownSymbol(name, null)
    if (!(Number.isFinite(value) && value > 0)) {
      throw ChemError.calculation(L('La cantidad de %@ tiene que ser un número positivo.', localizedElementNameInSentence(e)))
    }
    const i = items.findIndex(([x]) => x === e)
    if (i >= 0) items[i][1] += value
    else items.push([e, value])
  }
  const steps = [...intro, 'Paso los gramos a moles dividiendo entre la masa atómica:']
  const moles = items.map(([e, m]) => m / e.molarMass)
  items.forEach(([e, m], i) => {
    steps.push(`• ${e.symbol}: ${trimmed(m, 4)} g ÷ ${e.atomicWeight.text} g/mol = ${compact(moles[i])} mol`)
  })
  const smallest = Math.min(...moles)
  if (!(smallest > 0)) throw ChemError.calculation(L('No se pueden calcular los moles.'))
  const ratios = moles.map((x) => x / smallest)
  if (!ratios.every((r) => Number.isFinite(r) && r <= 1000)) {
    throw ChemError.calculation(L('Las proporciones entre elementos salen desorbitadas (más de 1000 a 1): revisa los datos.'))
  }
  steps.push(`Divido entre el menor número de moles (${compact(smallest)}):`)
  items.forEach(([e], i) => steps.push(`• ${e.symbol}: ${fixed(ratios[i], 3)}`))
  // Busca el menor factor 1…6 que deje todas las proporciones cerca de enteros.
  const offBy = (m: number): number => Math.max(0, ...ratios.map((r) => Math.abs(r * m - roundHalfAway(r * m))))
  let chosen: number | null = null
  for (let m = 1; m <= 6 && chosen === null; m++) {
    if (ratios.every((r) => Math.abs(r * m - roundHalfAway(r * m)) <= tolerance)) chosen = m
  }
  let approximate = false
  let multiplier: number
  if (chosen !== null) {
    multiplier = chosen
  } else {
    // El que más se acerca.
    approximate = true
    multiplier = 1
    for (let m = 2; m <= 6; m++) if (offBy(m) < offBy(multiplier)) multiplier = m
  }
  if (multiplier > 1) steps.push(`Las proporciones no son enteras: multiplico todas por ${multiplier}.`)
  const subscripts = ratios.map((r) => Math.max(1, roundHalfAway(r * multiplier)))
  const comp = new Map<AtomKey, number>()
  items.forEach(([e], i) => comp.set(AtomKey.ofElement(e), subscripts[i]))
  const formula = Formula.fromComposition(comp)
  steps.push(`Fórmula empírica: ${formula.unicodeText}`)
  if (approximate) steps.push('Aviso: las proporciones no salen limpias con factores del 1 al 6; revisa los datos (o el redondeo).')
  const rows = items.map(([e, m], i) => ({ element: e, mass: m, moles: moles[i], ratio: ratios[i], subscriptValue: subscripts[i] }))
  return { formula, rows, multiplier, isApproximate: approximate, steps }
}
