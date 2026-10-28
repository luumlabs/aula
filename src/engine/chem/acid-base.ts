// pH y pOH de ácidos y bases (a 25 °C, Kw = 1.0 × 10⁻¹⁴), con los pasos en español.

import { ChemError } from './errors'
import { L } from './l10n'
import { parseFormula } from './parser'
import { parseUnit, unitDimension, unitFactor, type ChemUnit } from './quantity'
import { parseWrittenNumber, readNumber } from './sigfigs'
import { capitalizeFirst, charCount, chars, fixed, scientific, trimAll, trimChars, trimmed } from './text'

/** Resultado de un cálculo de pH. */
export interface PHResult {
  readonly pH: number
  readonly pOH: number
  /** [H₃O⁺] en mol/L. */
  readonly hydronium: number
  /** [OH⁻] en mol/L. */
  readonly hydroxide: number
  /** Porcentaje de ionización (ácidos y bases débiles). */
  readonly percentIonization: number | null
  /** Para ácidos y bases débiles: `true` si la aproximación x ≪ C es válida (ionización ≤ 5 %). */
  readonly approximationValid: boolean | null
  /** pH que se obtendría con la aproximación (ácidos y bases débiles). */
  readonly approximatePH: number | null
  /** Decimales con los que tiene sentido dar el pH (= cifras significativas de la concentración). */
  readonly decimals: number
  readonly steps: readonly string[]
  /** pH redondeado: «2.87». */
  readonly formattedPH: string
}

/** Producto iónico del agua a 25 °C. */
const KW = 1.0e-14
/** Ka₂ del H₂SO₄ (HSO₄⁻ ⇌ H⁺ + SO₄²⁻) usado en el cálculo exacto. */
const SULFURIC_KA2 = 1.2e-2

/** Ácidos fuertes reconocidos (fórmula → protones que cede del todo). */
const STRONG_ACIDS: Readonly<Record<string, number>> = { HCl: 1, HBr: 1, HI: 1, HNO3: 1, HClO4: 1, HClO3: 1, H2SO4: 1 }
/** Bases fuertes reconocidas (fórmula → OH⁻ por fórmula). */
const STRONG_BASES: Readonly<Record<string, number>> = { LiOH: 1, NaOH: 1, KOH: 1, RbOH: 1, CsOH: 1, 'Ca(OH)2': 2, 'Sr(OH)2': 2, 'Ba(OH)2': 2 }
/** Constantes muy estándar que se usan si no se da ninguna (se avisa). */
const TABULATED_WEAK: Readonly<Record<string, { isAcid: boolean; k: number; name: string }>> = {
  CH3COOH: { isAcid: true, k: 1.8e-5, name: 'ácido acético' },
  HC2H3O2: { isAcid: true, k: 1.8e-5, name: 'ácido acético' },
  NH3: { isAcid: false, k: 1.8e-5, name: 'amoníaco' },
}

const pDecimals = (sigFigs: number | null | undefined): number => Math.max(1, Math.min(4, sigFigs ?? 2))

function makeResult(h: number, decimals: number, steps: string[], extra: { percent?: number; approxValid?: boolean; approxPH?: number } = {}): PHResult {
  if (!(Number.isFinite(h) && h > 0)) throw ChemError.calculation(L('La concentración de H₃O⁺ tiene que ser positiva.'))
  const pH = -Math.log10(h)
  return {
    pH,
    pOH: 14 - pH,
    hydronium: h,
    hydroxide: KW / h,
    percentIonization: extra.percent ?? null,
    approximationValid: extra.approxValid ?? null,
    approximatePH: extra.approxPH ?? null,
    decimals,
    steps,
    formattedPH: fixed(pH, decimals),
  }
}

function character(pH: number): string {
  if (Math.abs(pH - 7) < 0.005) return 'La disolución es neutra (pH = 7 a 25 °C).'
  return pH < 7 ? 'La disolución es ácida (pH < 7).' : 'La disolución es básica (pH > 7).'
}

/** Raíz de una función creciente por bisección (en escala logarítmica, para concentraciones). */
function bisect(lower: number, upper: number, f: (x: number) => number): number {
  let lo = Math.log10(lower)
  let hi = Math.log10(upper)
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (f(Math.pow(10, mid)) > 0) hi = mid
    else lo = mid
  }
  return Math.pow(10, (lo + hi) / 2)
}

export const AcidBase = {
  kw: KW,
  sulfuricKa2: SULFURIC_KA2,
  strongAcids: STRONG_ACIDS,
  strongBases: STRONG_BASES,

  /** pH a partir de [H₃O⁺]. */
  fromHydronium(h: number, sigFigs: number | null = null): PHResult {
    const d = pDecimals(sigFigs)
    if (!(h > 0)) throw ChemError.calculation(L('[H₃O⁺] tiene que ser positiva.'))
    const pH = -Math.log10(h)
    return makeResult(h, d, [
      `pH = −log[H₃O⁺] = −log(${scientific(h, sigFigs ?? 3)}) = ${fixed(pH, d)}`,
      `pOH = 14 − pH = ${fixed(14 - pH, d)}; [OH⁻] = Kw / [H₃O⁺] = ${scientific(KW / h, sigFigs ?? 3)} M`,
      character(pH),
    ])
  },

  /** pH a partir de [OH⁻]. */
  fromHydroxide(oh: number, sigFigs: number | null = null): PHResult {
    const d = pDecimals(sigFigs)
    if (!(oh > 0)) throw ChemError.calculation(L('[OH⁻] tiene que ser positiva.'))
    const pOH = -Math.log10(oh)
    const pH = 14 - pOH
    return makeResult(KW / oh, d, [
      `pOH = −log[OH⁻] = −log(${scientific(oh, sigFigs ?? 3)}) = ${fixed(pOH, d)}`,
      `pH = 14 − pOH = ${fixed(pH, d)}`,
      character(pH),
    ])
  },

  /** [H₃O⁺] y [OH⁻] a partir del pH. */
  fromPH(pH: number, decimals = 2): PHResult {
    if (!Number.isFinite(pH)) throw ChemError.calculation(L('El pH tiene que ser un número.'))
    const h = Math.pow(10, -pH)
    const sig = Math.max(1, decimals)
    return makeResult(h, Math.max(1, decimals), [
      `[H₃O⁺] = 10^(−pH) = 10^(−${fixed(pH, decimals)}) = ${scientific(h, sig)} M`,
      `pOH = 14 − pH = ${fixed(14 - pH, decimals)}; [OH⁻] = ${scientific(KW / h, sig)} M`,
      character(pH),
    ])
  },

  /** [H₃O⁺] y [OH⁻] a partir del pOH. */
  fromPOH(pOH: number, decimals = 2): PHResult {
    if (!Number.isFinite(pOH)) throw ChemError.calculation(L('El pOH tiene que ser un número.'))
    const r = AcidBase.fromPH(14 - pOH, decimals)
    return {
      ...r,
      pOH,
      percentIonization: null,
      approximationValid: null,
      approximatePH: null,
      steps: [`pH = 14 − pOH = 14 − ${fixed(pOH, decimals)} = ${fixed(14 - pOH, decimals)}`, ...r.steps],
    }
  },

  /** Ácido fuerte: se disocia por completo. Si es muy diluido (< 10⁻⁶ M) se tiene en cuenta el agua. */
  strongAcid(c: number, protons = 1, name = 'el ácido', sigFigs: number | null = null): PHResult {
    if (!(Number.isFinite(c) && c > 0)) throw ChemError.calculation(L('La concentración tiene que ser positiva.'))
    const d = pDecimals(sigFigs)
    const steps = [`${capitalizeFirst(name)} es un ácido fuerte: se disocia por completo.`]
    let h = protons * c
    steps.push(protons === 1 ? `[H₃O⁺] = C = ${scientific(c, sigFigs ?? 3)} M` : `[H₃O⁺] = ${protons} × C = ${scientific(h, sigFigs ?? 3)} M`)
    if (h < 1e-6) {
      const exact = (h + Math.sqrt(h * h + 4 * KW)) / 2
      steps.push(`Como es muy diluido, el agua también aporta H₃O⁺: [H₃O⁺] = (C + √(C² + 4Kw)) / 2 = ${scientific(exact, 3)} M`)
      h = exact
    }
    const pH = -Math.log10(h)
    steps.push(`pH = −log[H₃O⁺] = ${fixed(pH, d)}`)
    steps.push(character(pH))
    return makeResult(h, d, steps)
  },

  /** Base fuerte: se disocia por completo. */
  strongBase(c: number, hydroxides = 1, name = 'la base', sigFigs: number | null = null): PHResult {
    if (!(Number.isFinite(c) && c > 0)) throw ChemError.calculation(L('La concentración tiene que ser positiva.'))
    const d = pDecimals(sigFigs)
    const steps = [`${capitalizeFirst(name)} es una base fuerte: se disocia por completo.`]
    let oh = hydroxides * c
    steps.push(hydroxides === 1 ? `[OH⁻] = C = ${scientific(c, sigFigs ?? 3)} M` : `[OH⁻] = ${hydroxides} × C = ${scientific(oh, sigFigs ?? 3)} M`)
    if (oh < 1e-6) {
      const exact = (oh + Math.sqrt(oh * oh + 4 * KW)) / 2
      steps.push(`Como es muy diluida, el agua también aporta OH⁻: [OH⁻] = (C + √(C² + 4Kw)) / 2 = ${scientific(exact, 3)} M`)
      oh = exact
    }
    const pOH = -Math.log10(oh)
    const pH = 14 - pOH
    steps.push(`pOH = −log[OH⁻] = ${fixed(pOH, d)}; pH = 14 − pOH = ${fixed(pH, d)}`)
    steps.push(character(pH))
    return makeResult(KW / oh, d, steps)
  },

  /** H₂SO₄: el primer protón se cede por completo y el segundo con Ka₂ = 1.2 × 10⁻². */
  sulfuricAcid(c: number, sigFigs: number | null = null): PHResult {
    if (!(Number.isFinite(c) && c > 0)) throw ChemError.calculation(L('La concentración tiene que ser positiva.'))
    const d = pDecimals(sigFigs)
    const k = SULFURIC_KA2
    const x = (-(c + k) + Math.sqrt((c + k) * (c + k) + 4 * k * c)) / 2
    const h = c + x
    const simple = -Math.log10(2 * c)
    return makeResult(h, d, [
      `El H₂SO₄ cede el primer protón por completo: [H₃O⁺] = C = ${scientific(c, sigFigs ?? 3)} M (y queda HSO₄⁻).`,
      `El segundo protón no se cede del todo (Ka₂ = 1.2 × 10⁻²): x² / (C − x) … resolviendo x² + (C + Ka₂)x − Ka₂·C = 0 → x = ${scientific(x, 3)} M.`,
      `[H₃O⁺] = C + x = ${scientific(h, 3)} M → pH = ${fixed(-Math.log10(h), d)}`,
      `Si tu curso considera que cede los dos protones del todo ([H₃O⁺] = 2C), sale pH = ${fixed(simple, d)}.`,
    ])
  },

  /** Ácido débil con Ka: resuelve la cuadrática exacta y compara con la aproximación √(Ka·C). */
  weakAcid(c: number, ka: number, name = 'el ácido', sigFigs: number | null = null): PHResult {
    if (!(Number.isFinite(c) && c > 0 && Number.isFinite(ka) && ka > 0)) throw ChemError.calculation(L('La concentración y Ka tienen que ser positivas.'))
    const d = pDecimals(sigFigs)
    const exact = (-ka + Math.sqrt(ka * ka + 4 * ka * c)) / 2
    const approx = Math.sqrt(ka * c)
    const percent = (exact / c) * 100
    const valid = approx / c <= 0.05
    const steps = [
      `${capitalizeFirst(name)} es débil: HA ⇌ H⁺ + A⁻, con Ka = x² / (C − x).`,
      `Aproximación (si x ≪ C): x ≈ √(Ka·C) = √(${scientific(ka, 2)} × ${scientific(c, sigFigs ?? 3)}) = ${scientific(approx, 3)} M → pH ≈ ${fixed(-Math.log10(approx), d)}.`,
      valid
        ? `La aproximación vale: x/C = ${fixed((approx / c) * 100, 2)} % ≤ 5 %.`
        : `La aproximación NO vale: x/C = ${fixed((approx / c) * 100, 1)} % > 5 %. Hay que resolver la ecuación de segundo grado.`,
      `Exacto: x² + Ka·x − Ka·C = 0 → x = (−Ka + √(Ka² + 4Ka·C)) / 2 = ${scientific(exact, 3)} M → pH = ${fixed(-Math.log10(exact), d)}.`,
      `Porcentaje de ionización: ${fixed(percent, 2)} %.`,
    ]
    let h = exact
    if (exact < 1e-6) {
      // Balance de cargas con el agua: [H⁺] = C·Ka/(Ka + [H⁺]) + Kw/[H⁺] (función creciente: bisección).
      h = bisect(1e-14, Math.max(c, 1e-6) + 1e-6, (x) => x - (c * ka) / (ka + x) - KW / x)
      steps.push(`Ojo: el ácido aporta tan pocos H₃O⁺ que el agua también cuenta; incluyéndola, [H₃O⁺] = ${scientific(h, 3)} M y pH = ${fixed(-Math.log10(h), d)}.`)
    }
    steps.push(character(-Math.log10(h)))
    return makeResult(h, d, steps, { percent, approxValid: valid, approxPH: -Math.log10(approx) })
  },

  /** Base débil con Kb. */
  weakBase(c: number, kb: number, name = 'la base', sigFigs: number | null = null): PHResult {
    if (!(Number.isFinite(c) && c > 0 && Number.isFinite(kb) && kb > 0)) throw ChemError.calculation(L('La concentración y Kb tienen que ser positivas.'))
    const d = pDecimals(sigFigs)
    const exact = (-kb + Math.sqrt(kb * kb + 4 * kb * c)) / 2
    const approx = Math.sqrt(kb * c)
    const percent = (exact / c) * 100
    const valid = approx / c <= 0.05
    const pOH = -Math.log10(exact)
    const steps = [
      `${capitalizeFirst(name)} es débil: B + H₂O ⇌ BH⁺ + OH⁻, con Kb = x² / (C − x).`,
      `Aproximación (si x ≪ C): [OH⁻] ≈ √(Kb·C) = ${scientific(approx, 3)} M → pH ≈ ${fixed(14 + Math.log10(approx), d)}.`,
      valid
        ? `La aproximación vale: x/C = ${fixed((approx / c) * 100, 2)} % ≤ 5 %.`
        : `La aproximación NO vale: x/C = ${fixed((approx / c) * 100, 1)} % > 5 %. Hay que resolver la ecuación de segundo grado.`,
      `Exacto: [OH⁻] = (−Kb + √(Kb² + 4Kb·C)) / 2 = ${scientific(exact, 3)} M → pOH = ${fixed(pOH, d)} → pH = ${fixed(14 - pOH, d)}.`,
      `Porcentaje de ionización: ${fixed(percent, 2)} %.`,
    ]
    let oh = exact
    if (exact < 1e-6) {
      oh = bisect(1e-14, Math.max(c, 1e-6) + 1e-6, (x) => x - (c * kb) / (kb + x) - KW / x)
      steps.push(`Ojo: la base aporta tan pocos OH⁻ que el agua también cuenta; incluyéndola, [OH⁻] = ${scientific(oh, 3)} M y pH = ${fixed(14 + Math.log10(oh), d)}.`)
    }
    steps.push(character(14 + Math.log10(oh)))
    return makeResult(KW / oh, d, steps, { percent, approxValid: valid, approxPH: 14 + Math.log10(approx) })
  },

  /**
   * Resuelve una descripción sencilla: «HCl 0.01 M», «0.01 M HCl», «CH3COOH 0.1 M Ka=1.8e-5», «HF 0.10 M pKa=3.17»,
   * «NH3 0.1 M Kb=1.8e-5», «NaOH 0.05 M», «Ba(OH)2 0.01 M», «[H+] = 1e-3», «[OH-]=2.5e-4», «pH = 3.5», «pOH 4.2».
   */
  solve(description: string): PHResult {
    const raw = trimAll(description)
    if (!raw) throw ChemError.empty('La descripción')
    if (charCount(raw) > 200) throw ChemError.tooLong(200)
    const s = raw.split('−').join('-')
    const lower = s.toLowerCase()
    // pH / pOH directos.
    for (const [key, isPOH] of [['poh', true], ['ph', false]] as const) {
      if (!lower.startsWith(key)) continue
      const rest = trimChars(s.slice(key.length), ' =:')
      const n = parseWrittenNumber(rest)
      if (!n) throw ChemError.calculation(isPOH ? L('No entiendo el valor de pOH en «%@».', raw) : L('No entiendo el valor de pH en «%@».', raw))
      const dec = Math.max(1, n.decimals)
      return isPOH ? AcidBase.fromPOH(n.value, dec) : AcidBase.fromPH(n.value, dec)
    }
    // Concentraciones de iones.
    const ionKeys: readonly (readonly [readonly string[], boolean])[] = [
      [['[oh-]', '[oh^-]', '[oh⁻]', 'oh-'], true],
      [['[h3o+]', '[h+]', '[h3o^+]', '[h^+]', '[h₃o⁺]', '[h⁺]', 'h3o+', 'h+'], false],
    ]
    for (const [keys, isOH] of ionKeys) {
      for (const key of keys) {
        if (!lower.startsWith(key)) continue
        let rest = trimChars(s.slice(key.length), ' =:')
        for (const unit of [' mol/l', ' m', 'mol/l', 'm']) {
          if (rest.toLowerCase().endsWith(unit)) {
            rest = rest.slice(0, rest.length - unit.length)
            break
          }
        }
        const n = parseWrittenNumber(rest.trim())
        if (!n) throw ChemError.calculation(L('No entiendo la concentración en «%@».', raw))
        return isOH ? AcidBase.fromHydroxide(n.value, n.sigFigs.maximum) : AcidBase.fromHydronium(n.value, n.sigFigs.maximum)
      }
    }
    // Constantes: Ka, Kb, pKa, pKb.
    let ka: number | null = null
    let kb: number | null = null
    let text = s
    const pattern = /\b(pka|pkb|ka|kb)\s*[=:]?\s*([0-9.,]+(?:\s*(?:e|E|[x×*·]\s*10\^?)\s*[-+]?\d+)?)/gi
    const matches = [...text.matchAll(pattern)]
    for (const m of matches.reverse()) {
      const key = m[1].toLowerCase()
      const v = parseWrittenNumber(m[2])?.value
      if (v === undefined) continue
      if (key === 'ka') ka = v
      else if (key === 'kb') kb = v
      else if (key === 'pka') ka = Math.pow(10, -v)
      else if (key === 'pkb') kb = Math.pow(10, -v)
      const at = m.index ?? 0
      text = text.slice(0, at) + ' ' + text.slice(at + m[0].length)
    }
    // Concentración: número seguido de M, mol/L o mM.
    let concentration: number | null = null
    let concSig: number | null = null
    // Se separa por espacios; una coma entre dígitos es decimal («0,05»), si no, se quita.
    const tokens = text
      .split(' ')
      .map((t) => trimChars(t, ',;'))
      .filter((t) => t.length > 0)
    const leftovers: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      const n = parseWrittenNumber(t)
      if (n) {
        let unit: ChemUnit | null = null
        const nextUnit = i + 1 < tokens.length ? parseUnit(tokens[i + 1]) : null
        if (nextUnit && unitDimension(nextUnit) === 'molarity') {
          unit = nextUnit
          i++
        }
        concentration = n.value * (unit ? unitFactor(unit) : 1)
        concSig = n.sigFigs.maximum
        continue
      }
      const tc = chars(t)
      const read = readNumber(tc, 0)
      const u = read ? parseUnit(tc.slice(read[1]).join('')) : null
      if (read && u && unitDimension(u) === 'molarity') {
        concentration = read[0].value * unitFactor(u)
        concSig = read[0].sigFigs.maximum
      } else if (!['de', 'a', 'y', 'en', 'of', 'con'].includes(t.toLowerCase())) {
        leftovers.push(t)
      }
    }
    const formulaText = leftovers.join('')
    if (concentration === null) {
      throw ChemError.missingData(L('Necesito la concentración, por ejemplo «HCl 0.01 M» o «CH3COOH 0.1 M Ka=1.8e-5».'))
    }
    const c = concentration
    if (!formulaText) {
      if (ka !== null) return AcidBase.weakAcid(c, ka, undefined, concSig)
      if (kb !== null) return AcidBase.weakBase(c, kb, undefined, concSig)
      throw ChemError.missingData(L('¿De qué sustancia? Escribe la fórmula, por ejemplo «HCl 0.01 M».'))
    }
    const f = parseFormula(formulaText)
    const key = f.withoutState().text('plain', false, false)
    const display = f.withoutState().unicodeText
    if (key === 'H2SO4') return AcidBase.sulfuricAcid(c, concSig)
    const p = STRONG_ACIDS[key]
    if (p !== undefined) return AcidBase.strongAcid(c, p, `el ${display}`, concSig)
    const o = STRONG_BASES[key]
    if (o !== undefined) return AcidBase.strongBase(c, o, `el ${display}`, concSig)
    if (ka !== null) return AcidBase.weakAcid(c, ka, `el ${display}`, concSig)
    if (kb !== null) return AcidBase.weakBase(c, kb, `el ${display}`, concSig)
    const tab = TABULATED_WEAK[key]
    if (tab) {
      const r = tab.isAcid ? AcidBase.weakAcid(c, tab.k, `el ${tab.name}`, concSig) : AcidBase.weakBase(c, tab.k, `el ${tab.name}`, concSig)
      const note = `No me diste ${tab.isAcid ? 'Ka' : 'Kb'}: uso el valor de tablas ${scientific(tab.k, 2)}; si tu libro da otro, indícalo.`
      return { ...r, steps: [note, ...r.steps] }
    }
    const looksAcid = key.startsWith('H') || key.includes('COOH')
    const concentrationText = trimmed(c)
    throw ChemError.missingData(
      looksAcid
        ? L('No sé si %@ es fuerte o débil. Si es débil, dame su constante: «%@ %@ M Ka=…».', display, key, concentrationText)
        : L('No sé si %@ es fuerte o débil. Si es débil, dame su constante: «%@ %@ M Kb=…».', display, key, concentrationText),
    )
  },
}
