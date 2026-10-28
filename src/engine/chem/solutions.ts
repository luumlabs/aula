// Disoluciones (molaridad, dilución, molalidad, % m/m, % m/v, ppm) y gases ideales. Cada cálculo devuelve los pasos en español.

import { ChemError } from './errors'
import { L } from './l10n'
import { Formula } from './formula'
import {
  ChemQuantity, fromBase, localizedDimensionTitle, localizedUnitSymbol, makeCalculation, unitDimension, unitSymbol,
  type ChemCalculation, type ChemDimension, type ChemUnit,
} from './quantity'
import { ChemConstants, molesOf } from './stoichiometry'
import { compact, trimmed } from './text'

/** Dato de un cálculo de disoluciones, con sus frases de error completas (sujeto, género y magnitud fijos). */
type Datum = 'solutionVolume' | 'concentration' | 'volume' | 'solventMass' | 'soluteMass' | 'solutionMass' | 'solutionVolumeShort'

const DATUM_DIMENSION: Readonly<Record<Datum, ChemDimension>> = {
  solutionVolume: 'volume', volume: 'volume', solutionVolumeShort: 'volume', concentration: 'molarity',
  solventMass: 'mass', soluteMass: 'mass', solutionMass: 'mass',
}

function wrongDimension(d: Datum, given: string): string {
  switch (d) {
    case 'solutionVolume':
      return L('El volumen de la disolución tiene que ser un volumen (me has dado %@).', given)
    case 'concentration':
      return L('La concentración tiene que ser una molaridad (me has dado %@).', given)
    case 'volume':
      return L('El volumen tiene que ser un volumen (me has dado %@).', given)
    case 'solventMass':
      return L('La masa de disolvente tiene que ser una masa (me has dado %@).', given)
    case 'soluteMass':
      return L('La masa de soluto tiene que ser una masa (me has dado %@).', given)
    case 'solutionMass':
      return L('La masa de disolución tiene que ser una masa (me has dado %@).', given)
    case 'solutionVolumeShort':
      return L('El volumen de disolución tiene que ser un volumen (me has dado %@).', given)
  }
}

function notPositive(d: Datum): string {
  switch (d) {
    case 'solutionVolume':
      return L('El volumen de la disolución tiene que ser positivo.')
    case 'concentration':
      return L('La concentración tiene que ser positiva.')
    case 'volume':
      return L('El volumen tiene que ser positivo.')
    case 'solventMass':
      return L('La masa de disolvente tiene que ser positiva.')
    case 'soluteMass':
      return L('La masa de soluto tiene que ser positiva.')
    case 'solutionMass':
      return L('La masa de disolución tiene que ser positiva.')
    case 'solutionVolumeShort':
      return L('El volumen de disolución tiene que ser positivo.')
  }
}

function requireDimension(q: ChemQuantity, d: Datum): void {
  if (q.dimension !== DATUM_DIMENSION[d]) throw ChemError.calculation(wrongDimension(d, q.localizedText))
  if (!(Number.isFinite(q.value) && q.value > 0)) throw ChemError.calculation(notPositive(d))
}

/** Moles de soluto a partir de masa (con fórmula), moles o partículas. Un soluto negativo o nulo se rechaza. */
function soluteMoles(q: ChemQuantity, formula: Formula | null, steps: string[]): number {
  if (!(Number.isFinite(q.value) && q.value > 0)) throw ChemError.calculation(L('La cantidad de soluto tiene que ser positiva.'))
  switch (q.dimension) {
    case 'amount':
      return q.baseValue
    case 'mass':
    case 'particles': {
      if (!formula) throw ChemError.missingData(L('Para pasar %@ a moles necesito la fórmula del soluto.', q.localizedText))
      const r = molesOf(formula, { kind: 'quantity', quantity: q })
      steps.push(...r.steps)
      return r.moles
    }
    default:
      throw ChemError.calculation(L('La cantidad de soluto tiene que ser una masa, unos moles o un número de partículas.'))
  }
}

const minSig = (...qs: (ChemQuantity | null | undefined)[]): number | null => {
  const v = qs.filter((q): q is ChemQuantity => !!q).map((q) => q.sigFigs.maximum)
  return v.length === 0 ? null : Math.min(...v)
}

export const Solutions = {
  /** Molaridad: M = n(soluto) / V(disolución, L). */
  molarity(solute: ChemQuantity, formula: Formula | null, volume: ChemQuantity): ChemCalculation {
    requireDimension(volume, 'solutionVolume')
    const steps: string[] = []
    const n = soluteMoles(solute, formula, steps)
    const liters = volume.baseValue
    if (volume.unit !== 'liter') steps.push(`V = ${volume} = ${compact(liters)} L`)
    const m = n / liters
    steps.push(`M = n / V = ${compact(n)} mol ÷ ${compact(liters)} L = ${compact(m)} mol/L`)
    return makeCalculation({ value: m, unit: 'M', significantFigures: minSig(solute, volume), steps })
  },

  /** Masa de soluto necesaria para preparar un volumen de cierta molaridad: m = M · V · M_molar. */
  soluteMass(molarity: ChemQuantity, volume: ChemQuantity, formula: Formula): ChemCalculation {
    requireDimension(molarity, 'concentration')
    requireDimension(volume, 'volume')
    const liters = volume.baseValue
    const n = molarity.baseValue * liters
    const mm = formula.molarMassDetails()
    const g = n * mm.value
    const steps = [
      `n = M · V = ${compact(molarity.baseValue)} mol/L × ${compact(liters)} L = ${compact(n)} mol`,
      `m = n · M = ${compact(n)} mol × ${mm.formatted} = ${compact(g)} g`,
    ]
    return makeCalculation({ value: g, unit: 'g', significantFigures: minSig(molarity, volume), steps })
  },

  /** Dilución: C₁V₁ = C₂V₂. Deja en `null` exactamente el dato que quieres calcular. */
  dilution(c1: ChemQuantity | null, v1: ChemQuantity | null, c2: ChemQuantity | null, v2: ChemQuantity | null): ChemCalculation {
    const missing = [c1, v1, c2, v2].filter((x) => x === null).length
    if (missing !== 1) throw ChemError.missingData(L('En C₁V₁ = C₂V₂ tiene que faltar exactamente un dato (faltan %lld).', missing))
    for (const c of [c1, c2]) if (c) requireDimension(c, 'concentration')
    for (const v of [v1, v2]) if (v) requireDimension(v, 'volume')
    const sig = minSig(c1, v1, c2, v2)
    const steps = ['En una dilución los moles de soluto no cambian: C₁·V₁ = C₂·V₂.']
    if (!c1 && v1 && c2 && v2) {
      const x = (c2.baseValue * v2.baseValue) / v1.baseValue
      steps.push(`C₁ = C₂·V₂ / V₁ = ${c2} × ${v2} ÷ ${v1} = ${compact(x)} M`)
      return makeCalculation({ value: x, unit: 'M', significantFigures: sig, steps })
    }
    if (!c2 && c1 && v1 && v2) {
      const x = (c1.baseValue * v1.baseValue) / v2.baseValue
      steps.push(`C₂ = C₁·V₁ / V₂ = ${c1} × ${v1} ÷ ${v2} = ${compact(x)} M`)
      if (x > c1.baseValue) steps.push('Ojo: la concentración final sale mayor que la inicial; al diluir debería bajar.')
      return makeCalculation({ value: x, unit: 'M', significantFigures: sig, steps })
    }
    if (!v1 && c1 && c2 && v2) {
      const liters = (c2.baseValue * v2.baseValue) / c1.baseValue
      const out = fromBase(v2.unit, liters)
      steps.push(`V₁ = C₂·V₂ / C₁ = ${c2} × ${v2} ÷ ${c1} = ${compact(out)} ${unitSymbol(v2.unit)}`)
      steps.push(`Se toman ${compact(out)} ${unitSymbol(v2.unit)} de la disolución concentrada y se añade agua hasta ${v2}.`)
      return makeCalculation({ value: out, unit: unitSymbol(v2.unit), significantFigures: sig, steps })
    }
    if (c1 && v1 && c2) {
      const liters = (c1.baseValue * v1.baseValue) / c2.baseValue
      const out = fromBase(v1.unit, liters)
      steps.push(`V₂ = C₁·V₁ / C₂ = ${c1} × ${v1} ÷ ${c2} = ${compact(out)} ${unitSymbol(v1.unit)}`)
      return makeCalculation({ value: out, unit: unitSymbol(v1.unit), significantFigures: sig, steps })
    }
    throw ChemError.missingData(L('Faltan datos para la dilución.'))
  },

  /** Molalidad: m = n(soluto) / kg de disolvente. */
  molality(solute: ChemQuantity, formula: Formula | null, solventMass: ChemQuantity): ChemCalculation {
    requireDimension(solventMass, 'solventMass')
    const steps: string[] = []
    const n = soluteMoles(solute, formula, steps)
    const kg = solventMass.baseValue / 1000
    const m = n / kg
    steps.push(`m = n / kg de disolvente = ${compact(n)} mol ÷ ${compact(kg)} kg = ${compact(m)} mol/kg`)
    return makeCalculation({ value: m, unit: 'mol/kg', significantFigures: minSig(solute, solventMass), steps })
  },

  /** Porcentaje en masa: % m/m = m(soluto) / m(disolución) × 100. */
  massPercent(soluteMass: ChemQuantity, solutionMass: ChemQuantity): ChemCalculation {
    requireDimension(soluteMass, 'soluteMass')
    requireDimension(solutionMass, 'solutionMass')
    const p = (soluteMass.baseValue / solutionMass.baseValue) * 100
    const steps = [
      `% m/m = m(soluto) / m(disolución) × 100 = ${compact(soluteMass.baseValue)} g ÷ ${compact(solutionMass.baseValue)} g × 100 = ${compact(p)} %`,
    ]
    if (p > 100) steps.push('Ojo: sale más del 100 %: ¿has puesto la masa de disolvente en lugar de la de disolución?')
    return makeCalculation({ value: p, unit: '%', significantFigures: minSig(soluteMass, solutionMass), steps })
  },

  /** Porcentaje en masa con la masa de disolvente (la disolución es soluto + disolvente). */
  massPercentWithSolvent(soluteMass: ChemQuantity, solventMass: ChemQuantity): ChemCalculation {
    requireDimension(soluteMass, 'soluteMass')
    requireDimension(solventMass, 'solventMass')
    const total = soluteMass.baseValue + solventMass.baseValue
    const r = Solutions.massPercent(soluteMass, new ChemQuantity(total, 'gram'))
    return makeCalculation({
      value: r.value,
      unit: '%',
      significantFigures: minSig(soluteMass, solventMass),
      steps: [`m(disolución) = m(soluto) + m(disolvente) = ${compact(total)} g`, ...r.steps],
    })
  },

  /** Porcentaje masa/volumen: % m/v = g de soluto / mL de disolución × 100. */
  massVolumePercent(soluteMass: ChemQuantity, solutionVolume: ChemQuantity): ChemCalculation {
    requireDimension(soluteMass, 'soluteMass')
    requireDimension(solutionVolume, 'solutionVolumeShort')
    const ml = solutionVolume.baseValue * 1000
    const p = (soluteMass.baseValue / ml) * 100
    const steps = [`% m/v = g de soluto / mL de disolución × 100 = ${compact(soluteMass.baseValue)} g ÷ ${compact(ml)} mL × 100 = ${compact(p)} %`]
    return makeCalculation({ value: p, unit: '% m/v', significantFigures: minSig(soluteMass, solutionVolume), steps })
  },

  /** Partes por millón en masa: ppm = m(soluto) / m(disolución) × 10⁶ (= mg/kg). */
  ppm(soluteMass: ChemQuantity, solutionMass: ChemQuantity): ChemCalculation {
    requireDimension(soluteMass, 'soluteMass')
    requireDimension(solutionMass, 'solutionMass')
    const v = (soluteMass.baseValue / solutionMass.baseValue) * 1e6
    const steps = [
      `ppm = m(soluto) / m(disolución) × 10⁶ = ${compact(soluteMass.baseValue)} g ÷ ${compact(solutionMass.baseValue)} g × 10⁶ = ${compact(v)} ppm (mg/kg)`,
    ]
    return makeCalculation({ value: v, unit: 'ppm', significantFigures: minSig(soluteMass, solutionMass), steps })
  },

  /** ppm en disoluciones acuosas diluidas: mg de soluto por litro (se supone densidad 1 g/mL). */
  ppmByVolume(soluteMass: ChemQuantity, solutionVolume: ChemQuantity): ChemCalculation {
    requireDimension(soluteMass, 'soluteMass')
    requireDimension(solutionVolume, 'solutionVolumeShort')
    const mg = soluteMass.baseValue * 1000
    const v = mg / solutionVolume.baseValue
    return makeCalculation({
      value: v,
      unit: 'ppm',
      significantFigures: minSig(soluteMass, solutionVolume),
      steps: [
        'En disoluciones acuosas diluidas 1 L pesa ≈ 1 kg, así que ppm ≈ mg/L.',
        `ppm = ${compact(mg)} mg ÷ ${compact(solutionVolume.baseValue)} L = ${compact(v)} ppm`,
      ],
    })
  },
}

// MARK: Gases ideales

type GasQuantity = 'pressure' | 'volume' | 'temperature'

/** Comprueba la magnitud de un dato. `symbol` es su nombre en las fórmulas («P₁», «V₂»…); sin él, se nombra con palabras. */
function checkGas(q: ChemQuantity | null | undefined, kind: GasQuantity, symbol: string | null = null): void {
  if (!q || q.dimension === kind) return
  const given = q.localizedText
  let message: string
  if (kind === 'pressure') {
    message = symbol ? L('%@ tiene que ser una presión (me has dado %@).', symbol, given) : L('La presión tiene que ser una presión (me has dado %@).', given)
  } else if (kind === 'volume') {
    message = symbol ? L('%@ tiene que ser un volumen (me has dado %@).', symbol, given) : L('El volumen tiene que ser un volumen (me has dado %@).', given)
  } else {
    message = symbol
      ? L('%@ tiene que ser una temperatura (me has dado %@).', symbol, given)
      : L('La temperatura tiene que ser una temperatura (me has dado %@).', given)
  }
  throw ChemError.calculation(message)
}

/** Un dato de los gases tiene que ser positivo y finito (un cero sería además un divisor cero en PV = nRT). */
function requirePositive(q: ChemQuantity | null | undefined, kind: GasQuantity): void {
  if (!q) return
  if (Number.isFinite(q.value) && q.value > 0) return
  const message =
    kind === 'pressure'
      ? L('La presión tiene que ser positiva.')
      : kind === 'volume'
        ? L('El volumen tiene que ser positivo.')
        : L('La temperatura absoluta tiene que ser mayor que 0 K.')
  throw ChemError.calculation(message)
}

/** La unidad pedida para el resultado tiene que medir la misma magnitud que éste: si no, no se puede etiquetar. */
function requireResultUnit(unit: ChemUnit | null | undefined, dimension: ChemDimension): void {
  if (!unit || unitDimension(unit) === dimension) return
  throw ChemError.incompatibleUnits(`${localizedUnitSymbol(unit)} (${localizedDimensionTitle(unitDimension(unit))})`, localizedDimensionTitle(dimension))
}

const TOO_LARGE = (): ChemError => ChemError.calculation(L('El resultado es demasiado grande'))

export const Gases = {
  /** Explicación de las condiciones normales (en español: va en los pasos, que son para la IA). */
  standardConditionsNote:
    'Condiciones normales: la definición clásica (STP, la de muchos libros) es 0 °C y 1 atm, donde 1 mol de gas ideal ocupa 22.414 L. La IUPAC usa desde 1982 0 °C y 1 bar (100 kPa), donde ocupa 22.711 L. Comprueba cuál usa tu libro.',

  /**
   * Ley de los gases ideales PV = nRT. Deja en `null` exactamente la magnitud que quieres calcular. La cantidad de gas puede
   * darse en moles o, con `formula`, en masa.
   */
  idealGas(o: {
    pressure: ChemQuantity | null
    volume: ChemQuantity | null
    amount: ChemQuantity | null
    temperature: ChemQuantity | null
    formula?: Formula | null
    resultUnit?: ChemUnit | null
  }): ChemCalculation {
    const { pressure, volume, amount, temperature } = o
    const formula = o.formula ?? null
    const resultUnit = o.resultUnit ?? null
    const missing = [pressure, volume, amount, temperature].filter((x) => x === null).length
    if (missing !== 1) throw ChemError.missingData(L('En PV = nRT tiene que faltar exactamente una magnitud (faltan %lld).', missing))
    checkGas(pressure, 'pressure')
    checkGas(volume, 'volume')
    checkGas(temperature, 'temperature')
    requirePositive(pressure, 'pressure')
    requirePositive(volume, 'volume')
    const steps = ['Uso PV = nRT con R = 0.082057 L·atm/(mol·K) (P en atm, V en L, T en K).']
    const sig = minSig(pressure, volume, amount)
    let P = pressure ? pressure.baseValue / 101_325 : null
    let V = volume ? volume.baseValue : null
    const T = temperature ? temperature.baseValue : null
    let n: number | null = null
    if (amount) {
      switch (amount.dimension) {
        case 'amount':
          n = amount.baseValue
          break
        case 'mass':
        case 'particles': {
          if (!formula) throw ChemError.missingData(L('Para usar la masa del gas necesito su fórmula.'))
          const r = molesOf(formula, { kind: 'quantity', quantity: amount })
          n = r.moles
          steps.push(...r.steps)
          break
        }
        default:
          throw ChemError.calculation(L('La cantidad de gas tiene que darse en moles o en gramos.'))
      }
    }
    if (n !== null && !(Number.isFinite(n) && n > 0)) throw ChemError.calculation(L('La cantidad de gas tiene que ser positiva.'))
    if (temperature && temperature.unit !== 'kelvin' && T !== null) steps.push(`T = ${temperature} = ${trimmed(T, 2)} K`)
    if (pressure && pressure.unit !== 'atmosphere' && P !== null) steps.push(`P = ${pressure} = ${compact(P)} atm`)
    if (volume && volume.unit !== 'liter' && V !== null) steps.push(`V = ${volume} = ${compact(V)} L`)
    if (T !== null && T <= 0) throw ChemError.calculation(L('La temperatura absoluta tiene que ser mayor que 0 K.'))
    const R = ChemConstants.gasConstantLatm
    let value: number
    let unit: ChemUnit
    if (P === null && V !== null && n !== null && T !== null) {
      requireResultUnit(resultUnit, 'pressure')
      const p = (n * R * T) / V
      P = p
      unit = resultUnit ?? 'atmosphere'
      value = fromBase(unit, p * 101_325)
      steps.push(`P = nRT / V = ${compact(n)} × 0.082057 × ${trimmed(T, 2)} ÷ ${compact(V)} = ${compact(p)} atm`)
    } else if (V === null && P !== null && n !== null && T !== null) {
      requireResultUnit(resultUnit, 'volume')
      const v = (n * R * T) / P
      V = v
      unit = resultUnit ?? 'liter'
      value = fromBase(unit, v)
      steps.push(`V = nRT / P = ${compact(n)} × 0.082057 × ${trimmed(T, 2)} ÷ ${compact(P)} = ${compact(v)} L`)
    } else if (n === null && P !== null && V !== null && T !== null) {
      const moles = (P * V) / (R * T)
      if (resultUnit && unitDimension(resultUnit) === 'mass') {
        if (!formula) throw ChemError.missingData(L('Para usar la masa del gas necesito su fórmula.'))
        const g = moles * formula.molarMass
        unit = resultUnit
        value = fromBase(resultUnit, g)
        steps.push(`n = PV / RT = ${compact(P)} × ${compact(V)} ÷ (0.082057 × ${trimmed(T, 2)}) = ${compact(moles)} mol`)
        steps.push(`m = n · M = ${compact(moles)} mol × ${formula.molarMassDetails().formatted} = ${compact(g)} g`)
      } else {
        requireResultUnit(resultUnit, 'amount')
        unit = resultUnit ?? 'mole'
        value = fromBase(unit, moles)
        steps.push(`n = PV / RT = ${compact(P)} × ${compact(V)} ÷ (0.082057 × ${trimmed(T, 2)}) = ${compact(moles)} mol`)
      }
    } else if (T === null && P !== null && V !== null && n !== null) {
      requireResultUnit(resultUnit, 'temperature')
      const t = (P * V) / (n * R)
      unit = resultUnit ?? 'kelvin'
      value = fromBase(unit, t)
      steps.push(`T = PV / nR = ${compact(P)} × ${compact(V)} ÷ (${compact(n)} × 0.082057) = ${compact(t)} K`)
      if (unit === 'celsius') steps.push(`En °C: ${compact(t)} − 273.15 = ${compact(value)} °C`)
    } else {
      throw ChemError.missingData(L('Faltan datos para la ley de los gases.'))
    }
    // Datos finitos pero extremos (o una temperatura no finita) pueden desbordar a inf o NaN.
    if (!Number.isFinite(value)) throw TOO_LARGE()
    return makeCalculation({ value, unit: unitSymbol(unit), significantFigures: sig, steps })
  },

  /** Ley combinada P₁V₁/T₁ = P₂V₂/T₂ (cantidad de gas constante). Deja en `null` el dato buscado. */
  combined(
    p1: ChemQuantity | null, v1: ChemQuantity | null, t1: ChemQuantity | null,
    p2: ChemQuantity | null, v2: ChemQuantity | null, t2: ChemQuantity | null,
  ): ChemCalculation {
    const all = [p1, v1, t1, p2, v2, t2]
    if (all.filter((x) => x === null).length !== 1) throw ChemError.missingData(L('En P₁V₁/T₁ = P₂V₂/T₂ tiene que faltar exactamente un dato.'))
    checkGas(p1, 'pressure', 'P₁')
    checkGas(p2, 'pressure', 'P₂')
    checkGas(v1, 'volume', 'V₁')
    checkGas(v2, 'volume', 'V₂')
    checkGas(t1, 'temperature', 'T₁')
    checkGas(t2, 'temperature', 'T₂')
    requirePositive(p1, 'pressure')
    requirePositive(p2, 'pressure')
    requirePositive(v1, 'volume')
    requirePositive(v2, 'volume')
    const P1 = p1?.baseValue ?? null
    const P2 = p2?.baseValue ?? null
    const V1 = v1?.baseValue ?? null
    const V2 = v2?.baseValue ?? null
    const T1 = t1?.baseValue ?? null
    const T2 = t2?.baseValue ?? null
    for (const t of [T1, T2]) if (t !== null && !(Number.isFinite(t) && t > 0)) throw ChemError.calculation(L('La temperatura absoluta tiene que ser mayor que 0 K.'))
    const steps = ['Con la misma cantidad de gas: P₁V₁/T₁ = P₂V₂/T₂ (temperaturas siempre en kelvin).']
    const sig = minSig(...all.filter((q) => q && q.dimension !== 'temperature'))
    /** Un dato extremo puede desbordar a inf o por abajo a 0: no se devuelve un resultado que no sea una magnitud física. */
    const make = (base: number, unit: ChemUnit): ChemCalculation => {
      if (!Number.isFinite(base)) throw TOO_LARGE()
      if (!(base > 0)) {
        const d = unitDimension(unit)
        throw ChemError.calculation(
          d === 'pressure'
            ? L('La presión tiene que ser positiva.')
            : d === 'volume'
              ? L('El volumen tiene que ser positivo.')
              : d === 'temperature'
                ? L('La temperatura absoluta tiene que ser mayor que 0 K.')
                : L('El resultado es demasiado grande'),
        )
      }
      return makeCalculation({ value: fromBase(unit, base), unit: unitSymbol(unit), significantFigures: sig, steps })
    }
    if (P1 !== null && V1 !== null && T1 !== null && V2 !== null && T2 !== null && !p2 && p1) {
      const u = p1.unit
      const x = (P1 * V1 * T2) / (T1 * V2)
      steps.push(`P₂ = P₁V₁T₂ / (T₁V₂) = ${compact(fromBase(u, x))} ${unitSymbol(u)}`)
      return make(x, u)
    }
    if (P1 !== null && V1 !== null && T1 !== null && P2 !== null && T2 !== null && !v2 && v1) {
      const u = v1.unit
      const x = (P1 * V1 * T2) / (T1 * P2)
      steps.push(`V₂ = P₁V₁T₂ / (T₁P₂) = ${compact(fromBase(u, x))} ${unitSymbol(u)}`)
      return make(x, u)
    }
    if (P1 !== null && V1 !== null && T1 !== null && P2 !== null && V2 !== null && !t2 && t1) {
      const u = t1.unit
      const x = (P2 * V2 * T1) / (P1 * V1)
      steps.push(`T₂ = P₂V₂T₁ / (P₁V₁) = ${trimmed(x, 2)} K` + (u === 'kelvin' ? '' : ` = ${compact(fromBase(u, x))} ${unitSymbol(u)}`))
      return make(x, u)
    }
    if (V1 !== null && T1 !== null && P2 !== null && V2 !== null && T2 !== null && !p1 && p2) {
      const u = p2.unit
      const x = (P2 * V2 * T1) / (T2 * V1)
      steps.push(`P₁ = P₂V₂T₁ / (T₂V₁) = ${compact(fromBase(u, x))} ${unitSymbol(u)}`)
      return make(x, u)
    }
    if (P1 !== null && T1 !== null && P2 !== null && V2 !== null && T2 !== null && !v1 && v2) {
      const u = v2.unit
      const x = (P2 * V2 * T1) / (T2 * P1)
      steps.push(`V₁ = P₂V₂T₁ / (T₂P₁) = ${compact(fromBase(u, x))} ${unitSymbol(u)}`)
      return make(x, u)
    }
    if (P1 !== null && V1 !== null && P2 !== null && V2 !== null && T2 !== null && !t1 && t2) {
      const u = t2.unit
      const x = (P1 * V1 * T2) / (P2 * V2)
      steps.push(`T₁ = P₁V₁T₂ / (P₂V₂) = ${trimmed(x, 2)} K` + (u === 'kelvin' ? '' : ` = ${compact(fromBase(u, x))} ${unitSymbol(u)}`))
      return make(x, u)
    }
    throw ChemError.missingData(L('Faltan datos para la ley combinada.'))
  },

  /** Volumen molar de un gas ideal a una temperatura y presión dadas. */
  molarVolume(temperature: ChemQuantity, pressure: ChemQuantity): ChemCalculation {
    checkGas(temperature, 'temperature')
    checkGas(pressure, 'pressure')
    const T = temperature.baseValue
    const P = pressure.baseValue / 101_325
    if (!(Number.isFinite(T) && Number.isFinite(P) && T > 0 && P > 0)) throw ChemError.calculation(L('La temperatura y la presión tienen que ser positivas.'))
    const v = (ChemConstants.gasConstantLatm * T) / P
    if (!Number.isFinite(v)) throw TOO_LARGE()
    return makeCalculation({
      value: v,
      unit: 'L/mol',
      significantFigures: null,
      steps: [`Vm = RT / P = 0.082057 × ${trimmed(T, 2)} ÷ ${compact(P)} = ${compact(v, 5)} L/mol`, Gases.standardConditionsNote],
    })
  },

  /** Densidad de un gas ideal: d = PM / RT (g/L). */
  density(formula: Formula, pressure: ChemQuantity, temperature: ChemQuantity): ChemCalculation {
    checkGas(temperature, 'temperature')
    checkGas(pressure, 'pressure')
    requirePositive(pressure, 'pressure')
    const T = temperature.baseValue
    const P = pressure.baseValue / 101_325
    const M = formula.molarMass
    if (!(Number.isFinite(T) && T > 0)) throw ChemError.calculation(L('La temperatura absoluta tiene que ser mayor que 0 K.'))
    const d = (P * M) / (ChemConstants.gasConstantLatm * T)
    if (!Number.isFinite(d)) throw TOO_LARGE()
    return makeCalculation({
      value: d,
      unit: 'g/L',
      significantFigures: pressure.sigFigs.maximum,
      steps: [`d = PM / RT = ${compact(P)} atm × ${compact(M, 5)} g/mol ÷ (0.082057 × ${trimmed(T, 2)} K) = ${compact(d)} g/L`],
    })
  },
}
