// Herramienta única «chemistry» para la IA (como `calculate` en matemáticas): datos de elementos, masas molares, balanceo,
// estequiometría, estados de oxidación, conversiones, pH y nomenclatura. Una sola herramienta con `action` para no llenar
// el contexto de herramientas. Función pura: el marco de herramientas de la IA la conecta después.

import {
  balanceInfo, convertInfo, electronConfigurationInfo, elementInfo, empiricalFormulaInfo, jsonAsText, molarMassInfo, nameInfo,
  oxidationStatesInfo, parseGiven, pHInfo, redoxInfo, significantFiguresInfo, stoichiometryInfo, type JsonSchemaObject,
} from './tools'
import type { ChemToolResult } from './types'

export const CHEMISTRY_ACTIONS = [
  'element', 'electron_configuration', 'molar_mass', 'empirical_formula', 'balance', 'stoichiometry', 'oxidation_states', 'redox',
  'convert', 'ph', 'sig_figs', 'name',
] as const

export type ChemistryAction = (typeof CHEMISTRY_ACTIONS)[number]

/** Descripción de la herramienta (nombre, descripción en inglés y esquema JSON de los parámetros). */
export const CHEMISTRY_TOOL: { readonly name: 'chemistry'; readonly description: string; readonly parameters: JsonSchemaObject } = {
  name: 'chemistry',
  description:
    'Exact chemistry engine. Use it to verify every chemistry number/formula/equation you write (never compute molar masses or balance by hand). ' +
    'Actions: element (input: "Fe" | "hierro" | "26") · electron_configuration (input: "Fe" | "Fe3+") · molar_mass (input: formula, e.g. "Ca(OH)2", "CuSO4·5H2O") · ' +
    'empirical_formula (input: "C 40%, H 6.7%, O 53.3%" or masses "C: 2.4 g; H: 0.4 g", optional molar_mass: "180 g/mol") · ' +
    'balance (input: "Fe + O2 -> Fe2O3"; ionic ok: "MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O"; write charges with ^) · ' +
    'stoichiometry (input: equation, given: {"Fe":"10 g","O2":"0.5 mol"}, find: "Fe2O3", optional actual_yield: "12 g" → limiting reactant, moles, grams, % yield) · ' +
    'oxidation_states (input: species) · redox (input: equation → what is oxidized/reduced) · convert (input: "10 g", to: "mol", formula: "H2O") · ' +
    'ph (input: "HCl 0.01 M" | "CH3COOH 0.1 M Ka=1.8e-5" | "NaOH 0.05 M") · sig_figs (input: "0.00450") · name (input: "NaCl" → name, or "sulfato de hierro(III)" → formula). ' +
    'Results include the steps explained in Spanish and LaTeX.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'One of: ' + CHEMISTRY_ACTIONS.join(', '), enum: [...CHEMISTRY_ACTIONS] },
      input: { type: 'string', description: 'Formula, equation, element, quantity or description (see actions)' },
      given: {
        type: 'object',
        properties: {},
        additionalProperties: true,
        description: 'stoichiometry: known amounts by species, e.g. {"Fe":"10 g"}',
      },
      find: { type: 'string', description: 'stoichiometry: species to compute' },
      to: { type: 'string', description: 'convert: target unit (mol, g, particles, L…)' },
      formula: { type: 'string', description: "convert: the substance's formula" },
      molar_mass: { type: 'string', description: 'empirical_formula: molar mass to get the molecular formula' },
      actual_yield: { type: 'string', description: 'stoichiometry: measured amount of product for % yield' },
    },
    required: ['action', 'input'],
    additionalProperties: false,
  },
}

/** Salida de la herramienta: el objeto JSON para la IA, su texto compacto y si es un error. */
export interface ChemistryToolOutput {
  readonly isError: boolean
  /** `{ ok, result, value?, unit?, latex? }` o, si faltan argumentos o la acción no existe, `{ ok: false, error }`. */
  readonly json: Readonly<Record<string, unknown>>
  /** JSON compacto con las claves ordenadas (lo que se devuelve a la IA). */
  readonly text: string
}

function compactJson(o: Readonly<Record<string, unknown>>): string {
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) sorted[k] = o[k]
  return JSON.stringify(sorted)
}

function errorOut(message: string): ChemistryToolOutput {
  const json = { ok: false, error: message }
  return { isError: true, json, text: compactJson(json) }
}

/** Lee un argumento de texto (un número también vale, como en la app Swift). */
function stringArg(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const v = args[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return jsonAsText(v)
  return null
}

/** Argumentos que puede mandar la IA (objeto JSON o texto JSON). */
function normalizeArgs(raw: unknown): Readonly<Record<string, unknown>> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // no es JSON
    }
  }
  return {}
}

/** Ejecuta la herramienta «chemistry» con los argumentos que manda la IA. Nunca lanza: los fallos son `isError`. */
export function runChemistryTool(rawArgs: unknown): ChemistryToolOutput {
  const a = normalizeArgs(rawArgs)
  const action = stringArg(a, 'action')?.toLowerCase()
  const input = stringArg(a, 'input')
  if (!action || input === null || !input.trim()) return errorOut("Missing required arguments 'action' and 'input'.")
  let r: ChemToolResult
  switch (action) {
    case 'element':
      r = elementInfo(input)
      break
    case 'electron_configuration':
    case 'configuration':
      r = electronConfigurationInfo(input)
      break
    case 'molar_mass':
    case 'molarmass':
    case 'mass':
      r = molarMassInfo(input)
      break
    case 'empirical_formula':
    case 'empirical':
      r = empiricalFormulaInfo(input, stringArg(a, 'molar_mass'))
      break
    case 'redox':
      r = redoxInfo(input)
      break
    case 'sig_figs':
    case 'significant_figures':
      r = significantFiguresInfo(input)
      break
    case 'balance':
      r = balanceInfo(input)
      break
    case 'stoichiometry': {
      const find = stringArg(a, 'find')
      if (find === null) return errorOut("stoichiometry needs 'find' (the species to compute).")
      r = stoichiometryInfo(input, parseGiven(a.given), find, stringArg(a, 'actual_yield'))
      break
    }
    case 'oxidation_states':
    case 'oxidation':
      r = oxidationStatesInfo(input)
      break
    case 'convert': {
      const to = stringArg(a, 'to')
      if (to === null) return errorOut("convert needs 'to' (target unit).")
      r = convertInfo(input, to, stringArg(a, 'formula'))
      break
    }
    case 'ph':
      r = pHInfo(input)
      break
    case 'name':
      r = nameInfo(input)
      break
    default:
      return errorOut(`Unknown action '${action}'. Use one of: ${CHEMISTRY_ACTIONS.join(', ')}.`)
  }
  const json: Record<string, unknown> = { ok: r.ok, result: r.text }
  if (r.value !== undefined) json.value = r.value
  if (r.unit !== undefined) json.unit = r.unit
  if (r.latex !== undefined) json.latex = r.latex
  return { isError: !r.ok, json, text: compactJson(json) }
}
