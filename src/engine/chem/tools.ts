// Funciones de alto nivel (texto → texto con explicación) para exponer como herramientas de la IA, de modo que nunca
// tenga que inventarse un número. Las respuestas van en español (es salida para la IA); las descripciones, en inglés.

import { balance as balanceText, type BalanceMedium } from './balancer'
import { checkElectronConfiguration, checkEquation, checkFormula, checkName, checkNumber } from './checker'
import { EmpiricalFormula } from './composition'
import { ElectronConfiguration } from './electron-config'
import { categoryTitle, PeriodicTable, stateTitle, type Element } from './elements'
import { ChemicalEquation } from './equation'
import { errorMessage } from './errors'
import { Formula } from './formula'
import { formulaForName, nameOf } from './nomenclature'
import { parseFormula } from './parser'
import { OxidationStates, redoxAnalysis } from './redox'
import { parseWrittenNumber } from './sigfigs'
import { convertQuantity, solveStoichiometry } from './stoichiometry'
import { AcidBase } from './acid-base'
import { capitalizeFirst, chargeText, fixed, fold, scientific, significant, superscripted, trimAll, trimmed, trimSpaces } from './text'
import type { ChemToolResult } from './types'

const failure = (text: string): ChemToolResult => ({ ok: false, text })
const failureOf = (error: unknown): ChemToolResult => failure(errorMessage(error, 'No se pudo calcular.'))

const tryParse = (text: string): Formula | null => {
  try {
    return parseFormula(text)
  } catch {
    return null
  }
}

/** Elemento de un ion monoatómico escrito («Fe3+» → Fe, +3). */
function monatomic(q: string): { element: Element; charge: number } | null {
  const f = tryParse(q)
  const e = f && f.composition.size === 1 && f.atomCount === 1 ? f.elements[0] : null
  return f && e ? { element: e, charge: f.charge } : null
}

// MARK: Elementos

/** Datos de un elemento: «Fe», «hierro», «iron», «26». Con un ion («Fe3+») añade su configuración. */
export function elementInfo(query: string): ChemToolResult {
  const q = trimAll(query)
  let element = PeriodicTable.search(q)
  let ionCharge = 0
  if (!element) {
    const m = monatomic(q)
    if (m) {
      element = m.element
      ionCharge = m.charge
    }
  }
  if (!element) return failure(`No encuentro el elemento «${q}». Prueba con el símbolo (Fe), el nombre (hierro) o el número atómico (26).`)
  const e = element
  const config = ElectronConfiguration.groundState(e)
  const lines = [`${e.name} (${e.symbol}) — número atómico ${e.atomicNumber}`]
  if (e.atomicWeight.isStandard) lines.push(`• Masa atómica: ${e.atomicWeight.text} (masa molar ${e.atomicWeight.text} g/mol)`)
  else lines.push(`• Sin masa atómica estándar (es radiactivo): número másico del isótopo más estable [${e.atomicWeight.massNumber}]`)
  const groupText =
    e.group !== null ? `grupo ${e.group}` : `sin número de grupo (serie de los ${e.category === 'lanthanide' ? 'lantánidos' : 'actínidos'}, que se dibuja aparte)`
  lines.push(`• ${capitalizeFirst(groupText)}, periodo ${e.period}, bloque ${e.block} — ${categoryTitle(e.category)}`)
  lines.push(`• Estado a 25 °C y 1 atm: ${stateTitle(e.standardState).toLowerCase()}`)
  let configLine = `• Configuración electrónica: ${config.text({ abbreviated: true, notation: 'unicode' })} (completa: ${config.text({ notation: 'unicode' })})`
  if (ElectronConfiguration.isException(e)) {
    configLine += `. Ojo: es una excepción a la regla de Madelung (predicción: ${ElectronConfiguration.aufbau(e.atomicNumber).text({ abbreviated: true, notation: 'unicode' })})`
  }
  if (e.isConfigurationPredicted) configLine += '. Es una predicción teórica'
  lines.push(configLine)
  lines.push(`• Electrones por capa: ${config.shells.join(', ')}`)
  lines.push(`• Electronegatividad (Pauling): ${e.electronegativity !== null ? trimmed(e.electronegativity, 2) : 'no tiene valor de referencia'}`)
  const ox = e.commonOxidationStates.map((x) => (x > 0 ? `+${x}` : `${x}`))
  lines.push(`• Estados de oxidación comunes: ${ox.length === 0 ? 'ninguno habitual' : ox.join(', ')}`)
  if (e.firstIonizationEnergy !== null) lines.push(`• Primera energía de ionización: ${trimmed(e.firstIonizationEnergy, 1)} kJ/mol`)
  lines.push(`• En inglés: ${e.englishName}`)
  let latex = config.text({ abbreviated: true, notation: 'latex' })
  if (ionCharge !== 0) {
    try {
      const ionConfig = ElectronConfiguration.ion(e, ionCharge)
      const ionName = `${e.symbol}${superscripted(chargeText(ionCharge))}`
      let s = `• Ion ${ionName}: ${ionConfig.text({ abbreviated: true, notation: 'unicode' })}`
      if (ionCharge > 0) s += ' (pierde primero los electrones de la capa más externa)'
      const gas = PeriodicTable.nobleGasCores.find((g) => g.electrons === ionConfig.electronCount)
      if (gas) s += `; es isoelectrónico con el ${PeriodicTable.bySymbol(gas.symbol)?.name.toLowerCase() ?? gas.symbol} ([${gas.symbol}])`
      lines.push(s)
      latex = ionConfig.text({ abbreviated: true, notation: 'latex' })
    } catch (error) {
      lines.push(`• ${errorMessage(error, '')}`)
    }
  }
  return { ok: true, text: lines.join('\n'), value: e.molarMass, unit: 'g/mol', latex }
}

/** Configuración electrónica de un elemento o ion: «Fe», «Fe3+», «Cl-», «26». */
export function electronConfigurationInfo(query: string): ChemToolResult {
  const q = trimAll(query)
  let element = PeriodicTable.search(q)
  let charge = 0
  if (!element) {
    const m = monatomic(q)
    if (m) {
      element = m.element
      charge = m.charge
    }
  }
  if (!element) return failure(`No reconozco «${q}» como elemento o ion monoatómico (ejemplos: Fe, Fe3+, Cl-).`)
  const e = element
  try {
    const c = charge === 0 ? ElectronConfiguration.groundState(e) : ElectronConfiguration.ion(e, charge)
    const label = charge === 0 ? `${e.name} (${e.symbol})` : `${e.symbol}${superscripted(chargeText(charge))}`
    const lines = [
      `${label}: ${c.text({ abbreviated: true, notation: 'unicode' })}`,
      `Completa: ${c.text({ notation: 'unicode' })}`,
      `Por capas (orden de la IUPAC): ${c.text({ abbreviated: true, order: 'shell', notation: 'unicode' })}`,
      `Electrones: ${c.electronCount}; desapareados: ${c.unpairedElectrons} (${c.unpairedElectrons === 0 ? 'diamagnético' : 'paramagnético'})`,
    ]
    if (charge === 0 && ElectronConfiguration.isException(e)) {
      lines.push(
        `Es una excepción: por la regla de Madelung sería ${ElectronConfiguration.aufbau(e.atomicNumber).text({ abbreviated: true, notation: 'unicode' })}, pero es más estable así.`,
      )
    }
    if (charge > 0) lines.push('Los cationes pierden primero los electrones de la capa más externa (los ns antes que los (n−1)d).')
    if (charge < 0) lines.push('Los aniones ganan electrones en el siguiente hueco según la regla de Madelung.')
    return { ok: true, text: lines.join('\n'), latex: c.text({ abbreviated: true, notation: 'latex' }) }
  } catch (error) {
    return failureOf(error)
  }
}

// MARK: Fórmulas

/** Masa molar con desglose por elemento y composición porcentual. */
export function molarMassInfo(formulaText: string): ChemToolResult {
  try {
    const f = parseFormula(formulaText).withoutCoefficient()
    const d = f.molarMassDetails()
    const name = f.text('unicode', false, false)
    const lines = [`Masa molar de ${name} = ${d.formatted}`, 'Multiplico la masa atómica de cada elemento por el número de átomos y sumo:']
    for (const c of d.contributions) {
      lines.push(
        `• ${c.atom.symbol}: ${c.count} × ${c.atomicMassText} g/mol = ${fixed(c.subtotal, c.atom.massDecimals)} g/mol (${fixed(c.massPercent, 2)} % en masa)`,
      )
    }
    lines.push(`Suma: ${fixed(d.value, d.decimalPlaces)} g/mol`)
    if (f.charge !== 0) lines.push('Es un ion: la masa de los electrones ganados o perdidos es despreciable.')
    if (d.isApproximate) lines.push('Ojo: algún elemento no tiene masa atómica estándar; uso el número másico de su isótopo más estable (valor aproximado).')
    const latex = `M(${f.text('latex', false, false)}) = ${fixed(d.value, d.decimalPlaces)}\\ \\mathrm{g/mol}`
    return { ok: true, text: lines.join('\n'), value: d.value, unit: 'g/mol', latex }
  } catch (error) {
    return failureOf(error)
  }
}

/** Fórmula empírica (y molecular, si se da la masa molar) a partir de porcentajes o masas. */
export function empiricalFormulaInfo(data: string, molarMassText: string | null = null): ChemToolResult {
  const pieces = data
    .split(/[,;\n]/)
    .map(trimSpaces)
    .filter((p) => p.length > 0)
  const pairs: [string, number][] = []
  let percentages = data.includes('%')
  const clean = (w: string): string => w.split('%').join('')
  for (const p of pieces) {
    const words = p.split(':').join(' ').split('=').join(' ').split(' ').filter((w) => w.length > 0)
    const symbolIndex = words.findIndex((w) => parseWrittenNumber(clean(w)) === null)
    const numberWord = words.find((w) => parseWrittenNumber(clean(w).split('g').join('')) !== null)
    const n = numberWord !== undefined ? parseWrittenNumber(clean(numberWord).split('g').join('')) : null
    if (symbolIndex < 0 || !n) return failure(`No entiendo «${p}». Escribe cada elemento con su porcentaje o masa: «C 40%, H 6.7%, O 53.3%».`)
    pairs.push([words[symbolIndex], n.value])
    if (p.includes('%')) percentages = true
  }
  try {
    const r = percentages ? EmpiricalFormula.fromPercentages(pairs) : EmpiricalFormula.fromMasses(pairs)
    const lines = [...r.steps]
    let value: number | undefined
    let latex = r.formula.latex
    const mm = molarMassText ? parseWrittenNumber(trimSpaces(molarMassText.split('g/mol').join('')))?.value : undefined
    if (mm !== undefined) {
      const mol = EmpiricalFormula.molecularFormula(r.formula, mm)
      lines.push(...mol.steps)
      latex = mol.formula.latex
      value = mol.formula.molarMass
    }
    const out: ChemToolResult = { ok: !r.isApproximate, text: lines.join('\n'), latex }
    if (value !== undefined) {
      out.value = value
      out.unit = 'g/mol'
    }
    return out
  } catch (error) {
    return failureOf(error)
  }
}

// MARK: Ecuaciones

const MEDIUM_KEYS: readonly (readonly [string, BalanceMedium])[] = [
  ['en medio ácido', 'acidic'], ['medio ácido', 'acidic'], ['en medio básico', 'basic'], ['medio básico', 'basic'],
  ['in acidic solution', 'acidic'], ['acidic', 'acidic'], ['in basic solution', 'basic'], ['basic', 'basic'],
]

/** Balancea una ecuación («Fe + O2 -> Fe2O3»). Admite «medio ácido»/«medio básico» al final para añadir H⁺/OH⁻ y H₂O. */
export function balanceInfo(equation: string): ChemToolResult {
  let text = equation
  let medium: BalanceMedium = 'none'
  // Búsqueda sin mayúsculas ni acentos, de atrás adelante (la clave tiene que estar en la segunda mitad).
  const folded = Array.from(equation).map((ch) => fold(ch) || ch)
  const foldedText = folded.join('')
  const count = folded.length
  for (const [key, m] of MEDIUM_KEYS) {
    const k = fold(key)
    const at = foldedText.lastIndexOf(k)
    if (at < 0) continue
    const charIndex = Array.from(foldedText.slice(0, at)).length
    if (charIndex > Math.floor(count / 2)) {
      medium = m
      text = Array.from(equation).slice(0, charIndex).join('')
      text = text.replace(/^[ ,;()[\]]+|[ ,;()[\]]+$/g, '')
      break
    }
  }
  const r = balanceText(text, medium)
  const lines = [r.message]
  if (r.steps.length > 0) {
    lines.push('Pasos:')
    lines.push(...r.steps.map((s) => '  ' + s))
  }
  lines.push(...r.notes)
  if (r.status === 'impossible' && r.alternatives.length > 0) lines.push('Quizá querías: ' + r.alternatives.map((a) => a.unicodeText).join(' ; '))
  const out: ChemToolResult = { ok: r.isBalanced, text: lines.join('\n') }
  if (r.isBalanced && r.equation) out.latex = r.equation.latex
  return out
}

/** Estequiometría: reactivo limitante, moles y gramos de la especie buscada, sobrantes y rendimiento. */
export function stoichiometryInfo(equation: string, given: Readonly<Record<string, string>>, find: string, actualYield: string | null = null): ChemToolResult {
  try {
    const r = solveStoichiometry(equation, given, find, actualYield)
    const lines = [r.summary, 'Pasos:', ...r.steps.map((s) => '  ' + s)]
    const value = r.targetGrams ?? r.extent
    const unit = r.targetGrams === null ? 'mol' : 'g'
    const out: ChemToolResult = { ok: true, text: lines.join('\n'), value, unit }
    if (r.target && r.targetGrams !== null) {
      out.latex = `m(${r.target.text('latex', false, false)}) = ${significant(r.targetGrams, Math.max(3, r.significantFigures), 'latex')}\\ \\mathrm{g}`
    }
    return out
  } catch (error) {
    return failureOf(error)
  }
}

/** Números de oxidación de una especie («KMnO4», «Cr2O7^2-»). Si recibe una ecuación, hace el análisis redox. */
export function oxidationStatesInfo(species: string): ChemToolResult {
  let eq: ChemicalEquation | null = null
  try {
    eq = ChemicalEquation.parse(species)
  } catch {
    eq = null
  }
  if (eq) return redoxOf(eq)
  try {
    const r = OxidationStates.analyze(species)
    const name = r.formula.text('unicode', false, false)
    const lines = [`Números de oxidación en ${name}: ${r.summary}`, 'Pasos:', ...r.steps.map((s) => '  ' + s), ...r.warnings]
    return { ok: true, text: lines.join('\n') }
  } catch (error) {
    return failureOf(error)
  }
}

/** Análisis redox de una ecuación: qué se oxida y qué se reduce, agentes y electrones transferidos. */
export function redoxInfo(equation: string): ChemToolResult {
  try {
    return redoxOf(ChemicalEquation.parse(equation))
  } catch (error) {
    return failureOf(error)
  }
}

function redoxOf(eq: ChemicalEquation): ChemToolResult {
  try {
    const a = redoxAnalysis(eq)
    const lines = [a.summary, 'Pasos:', ...a.steps.slice(0, -1).map((s) => '  ' + s)]
    const out: ChemToolResult = { ok: true, text: lines.join('\n') }
    if (a.electronsTransferred !== null) {
      out.value = a.electronsTransferred
      out.unit = 'e⁻'
    }
    return out
  } catch (error) {
    return failureOf(error)
  }
}

// MARK: Cálculos

/** Convierte una cantidad: («10 g», «mol», «H2O»), («25 °C», «K», null), («5.6 L CN», «g», «O2»), («2 mol», «L CN», «N2»). */
export function convertInfo(quantity: string, unit: string, formula: string | null = null): ChemToolResult {
  try {
    const r = convertQuantity(quantity, unit, formula)
    const shown = r.unit === 'partículas' ? scientific(r.value, r.displaySigFigs) + ' partículas' : r.formatted
    const parsed = formula ? tryParse(formula) : null
    const of = parsed ? ` de ${parsed.text('unicode', false, false)}` : ''
    const lines = [`${trimSpaces(quantity)}${of} = ${shown}`, ...r.steps]
    if (r.sigFigsNote) lines.push(r.sigFigsNote)
    return { ok: true, text: lines.join('\n'), value: r.value, unit: r.unit }
  } catch (error) {
    return failureOf(error)
  }
}

/** pH de una disolución: «HCl 0.01 M», «CH3COOH 0.1 M Ka=1.8e-5», «NaOH 0.05 M», «[H+] = 1e-3», «pOH = 4». */
export function pHInfo(description: string): ChemToolResult {
  try {
    const r = AcidBase.solve(description)
    const lines = [
      `pH = ${r.formattedPH} (pOH = ${fixed(r.pOH, r.decimals)}; [H₃O⁺] = ${scientific(r.hydronium, 3)} M; [OH⁻] = ${scientific(r.hydroxide, 3)} M)`,
      'Pasos:',
      ...r.steps.map((s) => '  ' + s),
      'Kw = 1.0 × 10⁻¹⁴ a 25 °C. El pH se da con tantos decimales como cifras significativas tiene la concentración.',
    ]
    return { ok: true, text: lines.join('\n'), value: r.pH, latex: `\\mathrm{pH} = ${r.formattedPH}` }
  } catch (error) {
    return failureOf(error)
  }
}

/** Cifras significativas de un número escrito. */
export function significantFiguresInfo(number: string): ChemToolResult {
  const n = parseWrittenNumber(number)
  if (!n) return failure(`«${number}» no es un número.`)
  let text = `«${trimSpaces(number)}» tiene ${n.sigFigs} cifras significativas.`
  if (n.sigFigs.isAmbiguous) {
    text += ` Es ambiguo: los ceros finales de un entero sin punto decimal pueden ser o no significativos. Para dejarlo claro, usa notación científica (${scientific(n.value, n.sigFigs.maximum)} para ${n.sigFigs.maximum} cifras) o un punto final («${trimmed(n.value, 0)}.»).`
  }
  return { ok: true, text, value: n.sigFigs.maximum }
}

// MARK: Nomenclatura

/** Nombre ↔ fórmula: «NaCl» → «cloruro de sodio»; «sulfato de hierro(III)» → Fe2(SO4)3. */
export function nameInfo(formulaOrName: string): ChemToolResult {
  const q = trimAll(formulaOrName)
  const f = tryParse(q)
  if (f) {
    const n = nameOf(f)
    if (!n) {
      return failure(
        `No puedo nombrar ${f.unicodeText} con seguridad: ChemKit solo cubre iones comunes, compuestos inorgánicos sencillos, ácidos comunes y algunos nombres comunes.`,
      )
    }
    const lines = [`${f.withoutCoefficient().unicodeText}: ${n.name}`]
    if (n.stock && n.stock !== n.name) lines.push(`• Stock: ${n.stock}`)
    if (n.traditional && n.traditional !== n.name) lines.push(`• Tradicional: ${n.traditional}`)
    if (n.systematic && n.systematic !== n.name) lines.push(`• Sistemática (prefijos): ${n.systematic}`)
    if (n.common && n.common !== n.name) lines.push(`• También: ${n.common}`)
    lines.push(...n.notes)
    return { ok: true, text: lines.join('\n'), latex: f.withoutCoefficient().latex }
  }
  const g = formulaForName(q)
  if (!g) {
    return failure(`No reconozco «${q}» ni como fórmula ni como nombre. Ejemplos: «NaCl», «cloruro de sodio», «sulfato de hierro(III)», «ácido sulfúrico».`)
  }
  const lines = [`${q}: ${g.unicodeText}`]
  const n = nameOf(g)
  if (n) {
    const others = n.allNames.filter((x) => fold(x) !== fold(q))
    if (others.length > 0) lines.push('Otros nombres: ' + others.join('; '))
  }
  return { ok: true, text: lines.join('\n'), latex: g.latex }
}

// MARK: Registro para la IA

/** Descripción de una herramienta para registrarla en la IA (nombre, descripción y esquema JSON de parámetros). */
export interface ChemToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchemaObject
}

export interface JsonSchemaObject {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly required?: readonly string[]
  readonly additionalProperties: boolean
  readonly description?: string
}

const str = (description?: string, values?: readonly string[]): Record<string, unknown> => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...(values ? { enum: values } : {}),
})
const obj = (properties: Record<string, Readonly<Record<string, unknown>>>, required: string[] = [], description?: string, additional = false): JsonSchemaObject => ({
  type: 'object',
  properties,
  additionalProperties: additional,
  ...(required.length > 0 ? { required } : {}),
  ...(description ? { description } : {}),
})

/** Herramientas listas para registrar en la IA (descripciones en inglés; las respuestas salen en español). */
export const CHEM_TOOL_SPECS: readonly ChemToolSpec[] = [
  {
    name: 'chem_element',
    description:
      'Periodic-table data for one element (or a monatomic ion like Fe3+): IUPAC atomic weight, group, period, block, category, state, electron configuration (with real exceptions), Pauling electronegativity, common oxidation states, first ionization energy. Query by symbol (case-sensitive: Co ≠ CO), Spanish/English name or atomic number.',
    parameters: obj({ query: str('"Fe", "hierro", "iron", "26" or "Fe3+"') }, ['query']),
  },
  {
    name: 'chem_molar_mass',
    description:
      'Exact molar mass (g/mol) of a formula with the per-element breakdown and mass percentages. Accepts H2O, Ca(OH)2, CuSO4·5H2O, [Fe(CN)6]3-, SO4^2-, LaTeX like \\mathrm{H_2O}.',
    parameters: obj({ formula: str() }, ['formula']),
  },
  {
    name: 'chem_balance',
    description:
      'Balances a chemical equation exactly (rational null-space method, smallest integer coefficients) and explains the steps. Arrows: -> → = ⇌ <=>. Ions and electrons allowed (Fe3+ + e- -> Fe2+). Append "medio ácido" or "medio básico" to let it add H+/OH- and H2O. Reports impossible or ambiguous equations instead of guessing.',
    parameters: obj({ equation: str('e.g. "Fe + O2 -> Fe2O3"') }, ['equation']),
  },
  {
    name: 'chem_stoichiometry',
    description:
      'Solves a stoichiometry problem: balances the equation, converts the given amounts to moles, finds the limiting reagent, the excess left over, the moles and grams of the target species and (optionally) the percent yield. Amounts: "10 g", "0.5 mol", "3.01e23 moléculas", "25 mL 0.10 M" (solution), "5.6 L CN" (gas at STP), "5.0 L a 25 °C y 1 atm".',
    parameters: obj(
      {
        equation: str(),
        given: { description: 'Object formula → amount, e.g. {"Fe": "10 g", "O2": "0.5 mol"} (or a string "Fe=10 g; O2=0.5 mol")' },
        find: str('species to compute, e.g. "Fe2O3"'),
        actual_yield: str('optional: amount actually obtained of `find`, for the percent yield'),
      },
      ['equation', 'given', 'find'],
    ),
  },
  {
    name: 'chem_oxidation_states',
    description:
      'Oxidation numbers of every element in a species (KMnO4, Cr2O7^2-, NH4NO3, Fe3O4 → +8/3) with the rules applied. If given an equation, says what is oxidized/reduced, the oxidizing and reducing agents and the electrons transferred.',
    parameters: obj({ species: str('formula or equation') }, ['species']),
  },
  {
    name: 'chem_convert',
    description:
      'Converts quantities: grams ↔ moles ↔ particles (needs the formula), gas volume at STP ("L CN"), and plain units (°C ↔ K, atm ↔ kPa ↔ mmHg ↔ torr ↔ bar, mL ↔ L, mg ↔ g…). Explains the steps and rounds to the data\'s significant figures.',
    parameters: obj(
      {
        quantity: str('e.g. "10 g", "2 mol", "25 °C"'),
        to: str('target unit: "mol", "g", "moléculas", "K", "mmHg", "L CN"…'),
        formula: str('substance formula when converting between mass, moles and particles'),
      },
      ['quantity', 'to'],
    ),
  },
  {
    name: 'chem_ph',
    description:
      'pH, pOH, [H3O+] and [OH-] with explained steps. Formats: "HCl 0.01 M", "NaOH 0.05 M", "Ba(OH)2 0.01 M", "CH3COOH 0.1 M Ka=1.8e-5" (weak: exact quadratic and the 5 % approximation check), "NH3 0.1 M Kb=1.8e-5", "HF 0.1 M pKa=3.17", "[H+] = 1e-3", "pOH = 4".',
    parameters: obj({ description: str() }, ['description']),
  },
  {
    name: 'chem_name',
    description:
      'Spanish inorganic nomenclature both ways: formula → name (Stock, traditional -oso/-ico, systematic prefixes) or name → formula ("sulfato de hierro(III)" → Fe2(SO4)3). Covers ~75 common ions, simple binary/ternary ionic compounds, binary molecular compounds, common acids and a few common names. Returns ok=false instead of inventing.',
    parameters: obj({ text: str('formula or Spanish name') }, ['text']),
  },
  {
    name: 'chem_electron_configuration',
    description: 'Electron configuration of an element or monatomic ion ("Fe", "Fe3+", "Cl-"): abbreviated and full, filling and shell order, unpaired electrons.',
    parameters: obj({ query: str() }, ['query']),
  },
  {
    name: 'chem_empirical_formula',
    description: 'Empirical formula from mass percentages or masses ("C 40%, H 6.7%, O 53.3%"), and the molecular formula if the molar mass is given.',
    parameters: obj({ data: str(), molar_mass: str('optional, g/mol') }, ['data']),
  },
  {
    name: 'chem_sig_figs',
    description: 'Counts the significant figures of a written number ("0.00450" → 3, "1.200e3" → 4, "1,20" → 3, "1200" → ambiguous 2–4).',
    parameters: obj({ number: str() }, ['number']),
  },
]

/** Valor JSON como texto (números enteros sin decimales; objetos en JSON compacto con claves ordenadas). */
export function jsonAsText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return stableStringify(v)
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
  }
  return JSON.stringify(v) ?? 'null'
}

/** Lee `given` como objeto ({"Fe": "10 g"}) o como texto («Fe=10 g; O2: 0.5 mol»). */
export function parseGiven(v: unknown): Record<string, string> {
  const given: Record<string, string> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) given[k] = jsonAsText(x)
  } else if (typeof v === 'string') {
    for (const part of v.split(/[;\n]/)) {
      const eq = part.indexOf('=')
      if (eq >= 0) {
        given[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
        continue
      }
      const colon = part.indexOf(':')
      if (colon >= 0) given[part.slice(0, colon).trim()] = part.slice(colon + 1).trim()
    }
  }
  return given
}

/** Ejecuta una herramienta por nombre con sus argumentos JSON. Si el nombre no existe, `ok === false`. */
export function runChemTool(name: string, args: Readonly<Record<string, unknown>> | null | undefined): ChemToolResult {
  const a = args ?? {}
  const s = (key: string): string => jsonAsText(a[key])
  const opt = (key: string): string | null => {
    const v = jsonAsText(a[key])
    return v ? v : null
  }
  switch (name) {
    case 'chem_element':
      return elementInfo(s('query'))
    case 'chem_molar_mass':
      return molarMassInfo(s('formula'))
    case 'chem_balance':
      return balanceInfo(s('equation'))
    case 'chem_stoichiometry':
      return stoichiometryInfo(s('equation'), parseGiven(a.given), s('find'), opt('actual_yield'))
    case 'chem_oxidation_states':
      return oxidationStatesInfo(s('species'))
    case 'chem_convert':
      return convertInfo(s('quantity'), s('to'), opt('formula'))
    case 'chem_ph':
      return pHInfo(s('description'))
    case 'chem_name':
      return nameInfo(s('text'))
    case 'chem_electron_configuration':
      return electronConfigurationInfo(s('query'))
    case 'chem_empirical_formula':
      return empiricalFormulaInfo(s('data'), opt('molar_mass'))
    case 'chem_sig_figs':
      return significantFiguresInfo(s('number'))
    default:
      return failure(`No existe la herramienta «${name}».`)
  }
}

/** API con los nombres de la app Swift. */
export const ChemTools = {
  elementInfo,
  electronConfiguration: electronConfigurationInfo,
  molarMass: molarMassInfo,
  empiricalFormula: empiricalFormulaInfo,
  balance: balanceInfo,
  stoichiometry: stoichiometryInfo,
  oxidationStates: oxidationStatesInfo,
  redox: redoxInfo,
  convert: convertInfo,
  pH: pHInfo,
  significantFigures: significantFiguresInfo,
  name: nameInfo,
  checkFormula,
  checkName,
  checkEquation,
  checkNumber,
  checkElectronConfiguration,
  specs: CHEM_TOOL_SPECS,
  run: runChemTool,
}
