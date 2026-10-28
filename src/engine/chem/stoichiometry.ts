// Estequiometría: conversiones gramos ↔ moles ↔ partículas, reactivo limitante y rendimientos. Pasos en español.

import { balanceEquation } from './balancer'
import { ChemError } from './errors'
import { L } from './l10n'
import { ChemicalEquation, effectiveCoefficient } from './equation'
import { Formula } from './formula'
import { parseFormula } from './parser'
import {
  ChemQuantity, fromBase, localizedDimensionTitle, makeCalculation, parseQuantityList, parseUnit, unitDimension, unitFactor,
  unitSymbol, type ChemCalculation, type ChemUnit,
} from './quantity'
import { Rational } from './rational'
import { parseWrittenNumber } from './sigfigs'
import { compact, exponentOf, fold, roundToSignificant, scientific, significant, trimmed, trimSpaces } from './text'

/** Constantes físicas (valores exactos del SI de 2019 cuando lo son). */
export const ChemConstants = {
  /** Número de Avogadro (exacto): 6.02214076 × 10²³ mol⁻¹. */
  avogadro: 6.02214076e23,
  /** R en J/(mol·K). */
  gasConstantSI: 8.314462618,
  /** R en L·atm/(mol·K) = 8.314462618 / 101.325. */
  gasConstantLatm: 8.314462618 / 101.325,
  /** Volumen molar en condiciones normales clásicas (0 °C, 1 atm): 22.414 L/mol. */
  molarVolumeSTP: 22.414,
  /** Volumen molar en las condiciones estándar actuales de la IUPAC (0 °C, 1 bar): 22.711 L/mol. */
  molarVolumeIUPAC: 22.711,
} as const

/** Cómo se da la cantidad de una especie en un problema. */
export type AmountInput =
  /** Masa, moles o número de partículas. */
  | { kind: 'quantity'; quantity: ChemQuantity }
  /** Volumen de una disolución con su molaridad. */
  | { kind: 'solution'; volume: ChemQuantity; molarity: ChemQuantity }
  /** Volumen de un gas con su temperatura y presión (o en condiciones normales si `stp`). */
  | { kind: 'gas'; volume: ChemQuantity; temperature: ChemQuantity | null; pressure: ChemQuantity | null; stp: boolean }

/** Lee «10 g», «0.5 mol», «3.01e23 moléculas», «25 mL 0.10 M», «5.6 L CN», «5.0 L a 25 °C y 1 atm». */
export function parseAmountInput(text: string): AmountInput {
  const { quantities: qs, keywords } = parseQuantityList(text)
  const of = (d: string): ChemQuantity[] => qs.filter((q) => q.dimension === d)
  const volumes = of('volume')
  const molarities = of('molarity')
  const temps = of('temperature')
  const pressures = of('pressure')
  if (qs.length === 1 && ['mass', 'amount', 'particles'].includes(qs[0].dimension)) return { kind: 'quantity', quantity: qs[0] }
  if (volumes.length === 1 && molarities.length === 1 && qs.length === 2) return { kind: 'solution', volume: volumes[0], molarity: molarities[0] }
  if (volumes.length === 1) {
    const v = volumes[0]
    if (keywords.has('stp') && qs.length === 1) return { kind: 'gas', volume: v, temperature: null, pressure: null, stp: true }
    if (temps.length === 1 && pressures.length === 1 && qs.length === 3) return { kind: 'gas', volume: v, temperature: temps[0], pressure: pressures[0], stp: false }
    throw ChemError.missingData(
      L('Con solo un volumen no puedo saber los moles: añade la concentración si es una disolución («25 mL 0.10 M») o, si es un gas, las condiciones («5.6 L CN» o «5.0 L a 25 °C y 1 atm»).'),
    )
  }
  if (molarities.length === 1 && qs.length === 1) {
    throw ChemError.missingData(L('Una concentración sola no basta: dime también el volumen de la disolución («25 mL 0.10 M»).'))
  }
  throw ChemError.invalidQuantity(text)
}

/** Cifras significativas de los datos (las del dato menos preciso, contando los ceros finales dudosos). */
export function amountSignificantFigures(input: AmountInput): number {
  switch (input.kind) {
    case 'quantity':
      return input.quantity.sigFigs.maximum
    case 'solution':
      return Math.min(input.volume.sigFigs.maximum, input.molarity.sigFigs.maximum)
    case 'gas': {
      let s = input.volume.sigFigs.maximum
      if (input.pressure) s = Math.min(s, input.pressure.sigFigs.maximum)
      if (input.temperature && input.temperature.unit === 'kelvin') s = Math.min(s, input.temperature.sigFigs.maximum)
      return s
    }
  }
}

/** Moles de una especie a partir de cómo se da su cantidad, con los pasos. */
export function molesOf(formula: Formula, input: AmountInput): { moles: number; steps: string[] } {
  const name = formula.text('unicode', false, false)
  switch (input.kind) {
    case 'quantity': {
      const q = input.quantity
      switch (q.dimension) {
        case 'mass': {
          const g = q.baseValue
          const mm = formula.molarMassDetails()
          if (!(mm.value > 0)) throw ChemError.calculation(L('No puedo calcular la masa molar de %@.', name))
          const steps: string[] = []
          if (q.unit !== 'gram') steps.push(`${q} = ${compact(g)} g`)
          const n = g / mm.value
          const massText = q.unit === 'gram' ? q.numberText : compact(g)
          steps.push(`n(${name}) = m / M = ${massText} g ÷ ${mm.formatted} = ${compact(n)} mol`)
          return { moles: n, steps }
        }
        case 'amount': {
          const n = q.baseValue
          return { moles: n, steps: q.unit === 'mole' ? [`n(${name}) = ${q}`] : [`n(${name}) = ${q} = ${compact(n)} mol`] }
        }
        case 'particles': {
          const n = q.value / ChemConstants.avogadro
          return { moles: n, steps: [`n(${name}) = N / Nₐ = ${compact(q.value)} ÷ 6.022 × 10²³ = ${compact(n)} mol`] }
        }
        default:
          throw ChemError.incompatibleUnits(unitSymbol(q.unit), L('moles'))
      }
    }
    case 'solution': {
      const liters = input.volume.baseValue
      const molarity = input.molarity.baseValue
      const n = liters * molarity
      const steps: string[] = []
      if (input.volume.unit !== 'liter') steps.push(`${input.volume} = ${compact(liters)} L`)
      steps.push(`n(${name}) = M · V = ${compact(molarity)} mol/L × ${compact(liters)} L = ${compact(n)} mol`)
      return { moles: n, steps }
    }
    case 'gas': {
      const liters = input.volume.baseValue
      if (input.stp) {
        const n = liters / ChemConstants.molarVolumeSTP
        return {
          moles: n,
          steps: [
            'En condiciones normales (0 °C y 1 atm) 1 mol de gas ideal ocupa 22.414 L.',
            `n(${name}) = ${compact(liters)} L ÷ 22.414 L/mol = ${compact(n)} mol`,
          ],
        }
      }
      const t = input.temperature
      const p = input.pressure
      if (!t || !p) throw ChemError.missingData(L('Faltan la temperatura y la presión del gas.'))
      const kelvin = t.baseValue
      if (!(kelvin > 0)) throw ChemError.calculation(L('La temperatura absoluta tiene que ser mayor que 0 K.'))
      const atm = p.baseValue / 101_325
      const n = (atm * liters) / (ChemConstants.gasConstantLatm * kelvin)
      const steps: string[] = []
      if (t.unit !== 'kelvin') steps.push(`T = ${t} = ${trimmed(kelvin, 2)} K`)
      if (p.unit !== 'atmosphere') steps.push(`P = ${p} = ${compact(atm)} atm`)
      steps.push(
        `n(${name}) = PV / RT = (${compact(atm)} atm × ${compact(liters)} L) ÷ (0.082057 L·atm/(mol·K) × ${trimmed(kelvin, 2)} K) = ${compact(n)} mol`,
      )
      return { moles: n, steps }
    }
  }
}

function temperatureSteps(q: ChemQuantity, target: ChemUnit, result: number): string[] {
  const r = trimmed(result, 4)
  if (q.unit === 'celsius' && target === 'kelvin') return [`T(K) = T(°C) + 273.15 = ${q.numberText} + 273.15 = ${r} K`]
  if (q.unit === 'kelvin' && target === 'celsius') return [`T(°C) = T(K) − 273.15 = ${q.numberText} − 273.15 = ${r} °C`]
  if (q.unit === 'fahrenheit' && target === 'celsius') return [`T(°C) = (T(°F) − 32) × 5/9 = (${q.numberText} − 32) × 5/9 = ${r} °C`]
  if (q.unit === 'celsius' && target === 'fahrenheit') return [`T(°F) = T(°C) × 9/5 + 32 = ${q.numberText} × 9/5 + 32 = ${r} °F`]
  return [`${q} = ${r} ${unitSymbol(target)}`]
}

/**
 * Convierte una cantidad a otra unidad. Para pasar entre masa, moles, partículas o volumen de gas en condiciones normales
 * hace falta la fórmula: («10 g», «mol», «H2O»), («2 mol», «moléculas», «CO2»), («25 °C», «K», null).
 */
export function convertQuantity(quantityText: string, targetText: string, formulaText?: string | null): ChemCalculation {
  let input: AmountInput | null = null
  try {
    input = parseAmountInput(quantityText)
  } catch {
    input = null
  }
  const targetFolded = fold(targetText)
  let targetGasSTP = false
  let targetUnitText = targetText
  for (const k of [' cn', ' c.n.', ' stp', ' tpn', ' en condiciones normales']) {
    if (targetFolded.endsWith(k)) {
      targetGasSTP = true
      targetUnitText = targetFolded.slice(0, targetFolded.length - k.length)
    }
  }
  const target = parseUnit(targetUnitText)
  if (!target) {
    throw ChemError.calculation(L('No conozco la unidad «%@». Usa, por ejemplo: g, mol, moléculas, L, mL, atm, kPa, mmHg, K, °C.', targetText))
  }
  const formula = formulaText && trimSpaces(formulaText) ? parseFormula(formulaText) : null
  const targetDim = unitDimension(target)

  // Misma magnitud: conversión directa.
  let direct: ChemQuantity | null = null
  if (!targetGasSTP) {
    try {
      direct = ChemQuantity.parse(quantityText)
    } catch {
      direct = null
    }
  }
  if (direct && direct.dimension === targetDim) {
    const q = direct
    const r = q.convertedTo(target)
    if (q.dimension === 'temperature') {
      // Sumar 273.15 es una suma: se conservan los decimales del dato (25 °C → 298 K; 25.0 °C → 298.2 K).
      const decimals = parseWrittenNumber(q.numberText)?.decimals ?? 0
      const sig = Math.max(1, exponentOf(r.value) + 1 + decimals)
      return makeCalculation({ value: r.value, unit: unitSymbol(target), significantFigures: sig, steps: temperatureSteps(q, target, r.value), displaySigFigs: sig })
    }
    const factor = unitFactor(q.unit) / unitFactor(target)
    const clean = (x: number): string => trimmed(roundToSignificant(x, 10), 12)
    const steps = [`${q} × (${clean(factor)} ${unitSymbol(target)}/${unitSymbol(q.unit)}) = ${clean(r.value)} ${unitSymbol(target)}`]
    if (q.dimension === 'pressure') steps.push('Equivalencias: 1 atm = 101.325 kPa = 760 mmHg = 760 torr = 1.01325 bar.')
    return makeCalculation({ value: r.value, unit: unitSymbol(target), significantFigures: q.sigFigs.maximum, steps })
  }
  // Conversiones químicas: pasan por los moles.
  if (!input) throw ChemError.invalidQuantity(quantityText)
  if (!formula) {
    // Una frase completa por magnitud.
    switch (targetDim) {
      case 'mass':
        throw ChemError.missingData(L('Para pasar a masa necesito la fórmula de la sustancia (por ejemplo «H2O»).'))
      case 'amount':
        throw ChemError.missingData(L('Para pasar a cantidad de sustancia necesito la fórmula de la sustancia (por ejemplo «H2O»).'))
      case 'particles':
        throw ChemError.missingData(L('Para pasar a número de partículas necesito la fórmula de la sustancia (por ejemplo «H2O»).'))
      case 'volume':
        throw ChemError.missingData(L('Para pasar a volumen necesito la fórmula de la sustancia (por ejemplo «H2O»).'))
      default:
        throw ChemError.missingData(L('Para pasar a %@ necesito la fórmula de la sustancia (por ejemplo «H2O»).', localizedDimensionTitle(targetDim)))
    }
  }
  const f = formula
  const name = f.text('unicode', false, false)
  const mol = molesOf(f, input)
  let n = mol.moles
  const steps = mol.steps
  const sig = amountSignificantFigures(input)
  if (input.kind === 'quantity' && input.quantity.dimension === 'amount' && targetDim === 'amount') n = input.quantity.baseValue
  let value: number
  switch (targetDim) {
    case 'amount':
      value = fromBase(target, n)
      if (target !== 'mole') steps.push(`${compact(n)} mol = ${compact(value)} ${unitSymbol(target)}`)
      break
    case 'mass': {
      const mm = f.molarMassDetails()
      const g = n * mm.value
      value = fromBase(target, g)
      steps.push(`m(${name}) = n · M = ${compact(n)} mol × ${mm.formatted} = ${compact(g)} g`)
      if (target !== 'gram') steps.push(`${compact(g)} g = ${compact(value)} ${unitSymbol(target)}`)
      break
    }
    case 'particles': {
      value = n * ChemConstants.avogadro
      let nText = compact(n)
      if (input.kind === 'quantity' && input.quantity.unit === 'mole') nText = input.quantity.numberText
      steps.push(`N = n · Nₐ = ${nText} mol × 6.022 × 10²³ mol⁻¹ = ${scientific(value, 4)}`)
      break
    }
    case 'volume': {
      if (!targetGasSTP) {
        throw ChemError.missingData(
          L('Para pasar a volumen necesito saber si es un gas en condiciones normales (escribe «L CN») o usa la ley de los gases con P y T.'),
        )
      }
      const liters = n * ChemConstants.molarVolumeSTP
      value = fromBase(target, liters)
      steps.push(`En condiciones normales (0 °C, 1 atm): V = n × 22.414 L/mol = ${compact(n)} × 22.414 = ${compact(liters)} L`)
      break
    }
    default:
      throw ChemError.incompatibleUnits(L('la cantidad dada'), unitSymbol(target))
  }
  const unit = targetDim === 'particles' ? 'partículas' : unitSymbol(target)
  return makeCalculation({ value, unit, significantFigures: sig, steps })
}

// MARK: Problemas con ecuación

/** Línea de la tabla de un problema de estequiometría. */
export interface SpeciesLine {
  readonly formula: Formula
  readonly coefficient: Rational
  readonly molarMass: number
  readonly isReactant: boolean
  /** Moles dados en el enunciado (si se dieron). */
  readonly givenMoles: number | null
  /** Moles que reaccionan (reactivos) o se forman (productos). */
  readonly changeMoles: number
  /** Moles que sobran al final (solo reactivos dados). */
  readonly remainingMoles: number | null
}

/** Resultado de un problema de estequiometría. */
export interface StoichiometryReport {
  /** Ecuación balanceada usada. */
  readonly equation: ChemicalEquation
  /** Reactivo limitante (si se dieron varios reactivos). */
  readonly limitingReagent: Formula | null
  /** Avance de la reacción ξ (moles del limitante ÷ su coeficiente), en la escala de `equation`. */
  readonly extent: number
  readonly lines: readonly SpeciesLine[]
  /** Especie buscada. */
  readonly target: Formula | null
  readonly targetMoles: number | null
  readonly targetGrams: number | null
  /** Rendimiento porcentual (si se dio el real). */
  readonly percentYield: number | null
  /** Cifras significativas que justifican los datos. */
  readonly significantFigures: number
  readonly steps: readonly string[]
  readonly summary: string
}

/**
 * Resuelve un problema típico: con las cantidades dadas (de reactivos, o de un producto) calcula el reactivo limitante, lo
 * que sobra de los demás y la cantidad de la especie buscada; con `actualYield`, el rendimiento porcentual.
 * `given`: fórmula → cantidad («10 g», «0.5 mol», «25 mL 0.10 M», «5.6 L CN»).
 */
export function solveStoichiometry(
  equation: string,
  given: Readonly<Record<string, string>>,
  find?: string | null,
  actualYield?: string | null,
): StoichiometryReport {
  const parsed = ChemicalEquation.parse(equation)
  const bal = balanceEquation(parsed)
  // El motivo es el resumen del balanceo (en español, como los informes para la IA).
  if (!bal.isBalanced || !bal.equation) throw ChemError.calculation(bal.message)
  const eq = bal.equation
  const keys = Object.keys(given).sort()
  if (keys.length === 0) throw ChemError.missingData(L('Dime la cantidad de al menos una especie (por ejemplo «Fe: 10 g»).'))
  const inputs: { index: number; input: AmountInput }[] = []
  const terms = eq.terms
  for (const key of keys) {
    const value = given[key]
    if (value === undefined) continue
    const f = parseFormula(key)
    const idx = terms.findIndex((t) => t.formula.isSameSpecies(f))
    if (idx < 0) throw ChemError.calculation(L('«%@» no aparece en la ecuación %@.', key, eq.unicodeText))
    inputs.push({ index: idx, input: parseAmountInput(value) })
  }
  let targetIndex: number | null = null
  if (find && trimSpaces(find)) {
    const f = parseFormula(find)
    const idx = terms.findIndex((t) => t.formula.isSameSpecies(f))
    if (idx < 0) throw ChemError.calculation(L('«%@» no aparece en la ecuación %@.', find, eq.unicodeText))
    targetIndex = idx
  }
  return solveBalanced(eq, inputs, targetIndex, actualYield ?? null)
}

export function solveBalanced(
  eq: ChemicalEquation,
  inputs: readonly { index: number; input: AmountInput }[],
  targetIndex: number | null,
  actualYield: string | null,
): StoichiometryReport {
  const nR = eq.reactants.length
  const terms = eq.terms
  const coefs = terms.map(effectiveCoefficient)
  const steps = [`Ecuación balanceada: ${eq.unicodeText}`]
  const givenMoles = new Map<number, number>()
  steps.push('Paso cada dato a moles:')
  for (const { index, input } of inputs) {
    const { moles: n, steps: s } = molesOf(terms[index].formula, input)
    if (!(Number.isFinite(n) && n > 0)) throw ChemError.calculation(L('La cantidad de %@ tiene que ser positiva.', terms[index].formula.unicodeText))
    givenMoles.set(index, n)
    steps.push(...s.map((x) => '• ' + x))
  }
  const minSig = inputs.length === 0 ? 3 : Math.min(...inputs.map((x) => amountSignificantFigures(x.input)))
  const sig = Math.max(1, Math.min(6, minSig))
  // Se muestra con al menos 3 cifras (para no esconder el valor) y se avisa del redondeo estricto.
  const shown = Math.max(sig, 3)
  const givenIdx = [...givenMoles.keys()]
  const reactantGiven = givenIdx.filter((j) => j < nR)
  const productGiven = givenIdx.filter((j) => j >= nR)
  if (reactantGiven.length > 0 && productGiven.length > 0) {
    throw ChemError.calculation(
      L('Dame solo reactivos (para calcular lo que se forma) o solo un producto (para calcular lo que hace falta). Si tienes la cantidad obtenida, pásala como rendimiento real.'),
    )
  }
  if (productGiven.length > 1) throw ChemError.calculation(L('Con un solo producto conocido basta: los demás se deducen de la ecuación.'))
  let extent: number
  let limiting: number | null = null
  if (reactantGiven.length === 0 && productGiven.length > 0) {
    const p = productGiven[0]
    extent = (givenMoles.get(p) ?? 0) / coefs[p].toNumber()
    steps.push(
      `Con la ecuación, por cada ${coefs[p]} mol de ${terms[p].formula.unicodeText} reaccionan los coeficientes de los demás: avance ξ = ${compact(givenMoles.get(p) ?? 0)} ÷ ${coefs[p]} = ${compact(extent)} mol.`,
    )
  } else {
    const ratios = [...reactantGiven].sort((a, b) => a - b).map((j) => [j, (givenMoles.get(j) ?? 0) / coefs[j].toNumber()] as const)
    if (ratios.length === 0) throw ChemError.missingData(L('Faltan datos.'))
    const minPair = ratios.reduce((best, x) => (x[1] < best[1] ? x : best))
    extent = minPair[1]
    if (ratios.length > 1) {
      limiting = minPair[0]
      steps.push('Para encontrar el reactivo limitante divido los moles de cada reactivo entre su coeficiente:')
      for (const [i, r] of ratios) steps.push(`• ${terms[i].formula.unicodeText}: ${compact(givenMoles.get(i) ?? 0)} ÷ ${coefs[i]} = ${compact(r)}`)
      steps.push(`El menor es el de ${terms[minPair[0]].formula.unicodeText}: es el reactivo limitante (se acaba primero).`)
    } else {
      steps.push(`Solo hay un reactivo con cantidad conocida (${terms[ratios[0][0]].formula.unicodeText}); supongo que los demás están en exceso.`)
    }
  }
  const lines: SpeciesLine[] = terms.map((t, j) => {
    const change = extent * coefs[j].toNumber()
    const g = givenMoles.get(j) ?? null
    return {
      formula: t.formula,
      coefficient: coefs[j],
      molarMass: t.formula.molarMass,
      isReactant: j < nR,
      givenMoles: g,
      changeMoles: change,
      remainingMoles: j < nR && g !== null ? Math.max(0, g - change) : null,
    }
  })
  // Sobrantes.
  if (limiting !== null) {
    for (const j of [...reactantGiven].sort((a, b) => a - b)) {
      if (j === limiting) continue
      const line = lines[j]
      const left = line.remainingMoles ?? 0
      steps.push(
        `Sobra ${line.formula.unicodeText}: ${compact(line.givenMoles ?? 0)} − ${compact(extent)} × ${coefs[j]} = ${compact(left)} mol (${compact(left * line.molarMass)} g).`,
      )
    }
  }
  let targetMoles: number | null = null
  let targetGrams: number | null = null
  let percent: number | null = null
  let summary = ''
  if (targetIndex !== null) {
    const ti = targetIndex
    const line = lines[ti]
    const n = line.changeMoles
    const g = n * line.molarMass
    targetMoles = n
    targetGrams = g
    const mm = line.formula.molarMassDetails()
    const verb = ti < nR ? 'reaccionan (hacen falta)' : 'se forman'
    steps.push(`${line.formula.unicodeText}: n = ξ × ${coefs[ti]} = ${compact(extent)} × ${coefs[ti]} = ${compact(n)} mol, que ${verb}.`)
    steps.push(`Masa: ${compact(n)} mol × ${mm.formatted} = ${compact(g)} g`)
    summary = `${line.formula.unicodeText}: ${significant(n, shown)} mol = ${significant(g, shown)} g`
    if (ti >= nR) summary = 'Rendimiento teórico de ' + summary
    if (actualYield !== null) {
      const actualInput = parseAmountInput(actualYield)
      const { moles: actualMoles } = molesOf(line.formula, actualInput)
      if (!(Number.isFinite(actualMoles) && actualMoles >= 0)) throw ChemError.calculation(L('El rendimiento real no puede ser negativo.'))
      if (!(n > 0)) throw ChemError.calculation(L('El rendimiento teórico es 0.'))
      const p = (actualMoles / n) * 100
      percent = p
      const pSig = Math.max(3, Math.min(sig, amountSignificantFigures(actualInput)))
      steps.push(
        `Rendimiento porcentual = real ÷ teórico × 100 = ${compact(actualMoles * line.molarMass)} g ÷ ${compact(g)} g × 100 = ${significant(p, pSig)} %`,
      )
      summary += `; rendimiento ${significant(p, pSig)} %`
      if (p > 100.5) steps.push('Ojo: un rendimiento mayor del 100 % suele indicar que el producto estaba húmedo o impuro, o un error en los datos.')
    }
  }
  if (limiting !== null) {
    const limText = `Reactivo limitante: ${terms[limiting].formula.unicodeText}`
    summary = summary ? limText + '. ' + summary : limText
  }
  if (!summary) summary = `Avance de la reacción: ${compact(extent)} mol.`
  steps.push(`Resultado: ${summary}`)
  if (sig < shown && targetGrams !== null) {
    steps.push(`Con las cifras significativas de los datos (${sig} ${sig === 1 ? 'cifra' : 'cifras'}) habría que dar ${significant(targetGrams, sig)} g.`)
  } else if (targetGrams !== null) {
    steps.push(`(${sig} cifras significativas, como los datos.)`)
  }
  return {
    equation: eq,
    limitingReagent: limiting !== null ? terms[limiting].formula : null,
    extent,
    lines,
    target: targetIndex !== null ? terms[targetIndex].formula : null,
    targetMoles,
    targetGrams,
    percentYield: percent,
    significantFigures: sig,
    steps,
    summary,
  }
}

/** API con los nombres de la app Swift. */
export const Stoichiometry = {
  moles: molesOf,
  convert: convertQuantity,
  solve: solveStoichiometry,
}
