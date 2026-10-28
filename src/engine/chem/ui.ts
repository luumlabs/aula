// API sencilla para la interfaz (tabla periódica, herramientas de química) y para el corrector de ejercicios: datos
// simples (aptos para JSON e IPC), sin clases ni excepciones. Los textos que ve el alumno salen en el idioma de
// `setChemLanguage`; los pasos explicados siguen en español, como en la app Swift.

import { balance, type BalanceMedium, type BalanceStatus } from './balancer'
import { checkElectronConfiguration, checkEquation, checkFormula, checkName, checkNumber } from './checker'
import { molarMassDetails } from './composition'
import { effectiveCoefficient } from './equation'
import { ChemError, type ChemErrorKind } from './errors'
import {
  ALL_ELEMENTS, ELEMENT_CATEGORIES, PeriodicTable, categoryIsMetal, localizedCategoryTitle, localizedElementName,
  type Element, type ElementCategory,
} from './elements'
import { L } from './l10n'
import { parseFormula } from './parser'
import { Rational } from './rational'
import { parseWrittenNumber } from './sigfigs'
import { charCount, fold, trimAll } from './text'
import type { ChemCheck } from './types'

/** Fallo explicado: el código estable del motivo y el mensaje para el alumno. */
export interface ChemFailure {
  readonly ok: false
  readonly code: ChemErrorKind['type'] | 'unknown'
  readonly message: string
}

/** Fallo a partir de una excepción (las de ChemKit traen su motivo; las demás, un mensaje genérico). */
export function chemFailure(error: unknown): ChemFailure {
  if (error instanceof ChemError) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'unknown', message: L('No pude leer tu respuesta.') }
}

// MARK: Elementos

/**
 * Busca elementos para una casilla de búsqueda: símbolo exacto, número atómico («26», «Z=26»), nombre completo (en el
 * idioma pedido, español, inglés o alternativo, sin acentos ni mayúsculas), símbolo sin distinguir mayúsculas y, por
 * último, nombres que empiezan por o contienen el texto. Sin repetir, de más a menos parecido.
 */
export function searchElements(query: string, options: { lang?: string; limit?: number } = {}): Element[] {
  const limit = Math.max(0, options.limit ?? 10)
  const q = trimAll(query)
  if (!q || charCount(q) > 60 || limit === 0) return []
  const scored = new Map<number, number>()
  const add = (e: Element | null, score: number): void => {
    if (!e) return
    const prev = scored.get(e.atomicNumber)
    if (prev === undefined || score < prev) scored.set(e.atomicNumber, score)
  }
  add(PeriodicTable.bySymbol(q), 0)
  add(PeriodicTable.search(q), 1)
  const fq = fold(q)
  for (const e of ALL_ELEMENTS) {
    if (e.symbol.toLowerCase() === q.toLowerCase()) add(e, 2)
    const names = [localizedElementName(e, options.lang), e.name, e.englishName, ...e.alternativeNames].map(fold)
    if (names.includes(fq)) add(e, 1)
    else if (names.some((n) => n.startsWith(fq))) add(e, 3)
    else if (fq.length >= 2 && names.some((n) => n.includes(fq))) add(e, 4)
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([z]) => ALL_ELEMENTS[z - 1])
}

/** Una familia de la tabla periódica para la leyenda: clave estable (la interfaz elige el color), título y elementos. */
export interface ElementCategoryInfo {
  readonly key: ElementCategory
  /** Nombre en el idioma pedido (o el de la interfaz). */
  readonly title: string
  /** `true` si es metálica (`null` si se desconoce). */
  readonly isMetal: boolean | null
  /** Números atómicos de sus elementos, en orden. */
  readonly atomicNumbers: readonly number[]
}

/** Las 11 familias con su título localizado y sus elementos. */
export function elementCategories(lang?: string): ElementCategoryInfo[] {
  return ELEMENT_CATEGORIES.map((key) => ({
    key,
    title: localizedCategoryTitle(key, lang),
    isMetal: categoryIsMetal(key),
    atomicNumbers: ALL_ELEMENTS.filter((e) => e.category === key).map((e) => e.atomicNumber),
  }))
}

// MARK: Masa molar

/** Aportación de un elemento (o isótopo) a la masa molar. */
export interface MolarMassPart {
  /** Símbolo para mostrar («Fe», «D», «¹⁴C»). */
  readonly symbol: string
  readonly atomicNumber: number
  /** Nombre del elemento en el idioma pedido. */
  readonly name: string
  readonly count: number
  /** Masa atómica usada (g/mol) y su texto («15.999», «[98]»). */
  readonly atomicMass: number
  readonly atomicMassText: string
  readonly subtotal: number
  /** Porcentaje en masa. */
  readonly percent: number
}

/** Masa molar con su desglose, lista para dibujar. */
export interface MolarMassBreakdown {
  readonly ok: true
  /** La fórmula en texto plano (se vuelve a leer), Unicode, LaTeX y mhchem (`\ce{…}`). */
  readonly plain: string
  readonly unicode: string
  readonly latex: string
  readonly ce: string
  /** Fórmula de Hill («C6H12O6», «ClNa»). */
  readonly hill: string
  readonly charge: number
  /** g/mol sin redondear; `formatted` con los decimales de las masas atómicas («58.44 g/mol»). */
  readonly value: number
  readonly formatted: string
  readonly decimalPlaces: number
  /** `true` si se usó el número másico de algún elemento sin masa estándar. */
  readonly isApproximate: boolean
  readonly parts: readonly MolarMassPart[]
  /** Pasos explicados (en español). */
  readonly steps: readonly string[]
}

/** Masa molar de una fórmula escrita («Ca(OH)2», «CuSO4·5H2O», «\ce{SO4^2-}»), o el motivo si no se puede leer. */
export function molarMassBreakdown(text: string, options: { lang?: string } = {}): MolarMassBreakdown | ChemFailure {
  try {
    const f = parseFormula(text).withoutCoefficient()
    const d = molarMassDetails(f)
    return {
      ok: true,
      plain: f.plainText,
      unicode: f.unicodeText,
      latex: f.latex,
      ce: f.ce,
      hill: f.hillFormula,
      charge: f.charge,
      value: d.value,
      formatted: d.formatted,
      decimalPlaces: d.decimalPlaces,
      isApproximate: d.isApproximate,
      parts: d.contributions.map((c) => ({
        symbol: c.atom.symbol,
        atomicNumber: c.atom.atomicNumber,
        name: localizedElementName(c.atom.element, options.lang),
        count: c.count,
        atomicMass: c.atomicMass,
        atomicMassText: c.atomicMassText,
        subtotal: c.subtotal,
        percent: c.massPercent,
      })),
      steps: d.steps,
    }
  } catch (error) {
    return chemFailure(error)
  }
}

// MARK: Balanceo

/** Una especie de la ecuación balanceada. */
export interface BalancedSpecies {
  readonly side: 'reactants' | 'products'
  /** Coeficiente entero (los mínimos, salvo que el texto ya estuviera balanceado con otros). */
  readonly coefficient: number
  /** Coeficiente como texto exacto («2», «1/2»). */
  readonly coefficientText: string
  /** Fórmula sin coeficiente: texto plano (la entiende el analizador), Unicode y mhchem sin `\ce{}`. */
  readonly plain: string
  readonly unicode: string
  readonly ce: string
}

/** Resultado del balanceo como datos simples. */
export interface BalanceSummary {
  /** `true` si hay una ecuación balanceada válida (`balanced` o `alreadyBalanced`). */
  readonly ok: boolean
  readonly status: BalanceStatus
  /** Coeficientes en el orden de las especies (reactivos y luego productos); vacío si no se pudo. */
  readonly coefficients: readonly number[]
  readonly species: readonly BalancedSpecies[]
  /** La ecuación balanceada (o una combinación válida si hay varias): «4 Fe + 3 O₂ → 2 Fe₂O₃». */
  readonly text: string | null
  readonly plain: string | null
  readonly latex: string | null
  /** mhchem: «\ce{4 Fe + 3 O2 -> 2 Fe2O3}». */
  readonly ce: string | null
  readonly reversible: boolean
  /** Resumen y pasos (en español, como los informes para la IA). */
  readonly message: string
  readonly steps: readonly string[]
  readonly notes: readonly string[]
  /** Soluciones independientes o propuestas de arreglo, en Unicode. */
  readonly alternatives: readonly string[]
}

/** Balancea un texto («Fe + O2 -> Fe2O3»; con `acidic`/`basic` añade H⁺/OH⁻ y H₂O). Nunca lanza. */
export function balanceSummary(text: string, medium: BalanceMedium = 'none'): BalanceSummary {
  const r = balance(text, medium)
  const eq = r.equation
  const species: BalancedSpecies[] = eq
    ? eq.terms.map((t, i) => {
        const c = effectiveCoefficient(t)
        return {
          side: i < eq.reactants.length ? 'reactants' : 'products',
          coefficient: r.coefficients[i] ?? c.toNumber(),
          coefficientText: c.toString(),
          plain: t.formula.plainText,
          unicode: t.formula.unicodeText,
          ce: t.formula.ceBody(true),
        }
      })
    : []
  return {
    ok: r.isBalanced,
    status: r.status,
    coefficients: r.coefficients,
    species,
    text: eq?.unicodeText ?? null,
    plain: eq?.plainText ?? null,
    latex: eq?.latex ?? null,
    ce: eq?.ce ?? null,
    reversible: eq?.arrow === 'reversible',
    message: r.message,
    steps: r.steps,
    notes: r.notes,
    alternatives: r.alternatives.map((a) => a.unicodeText),
  }
}

// MARK: Corrector de ejercicios

/** Qué se pide en un ejercicio de química (los modos del modelo de curso). */
export type ChemAnswerMode = 'formula' | 'equation' | 'name' | 'number' | 'configuration'

/** Clave de un ejercicio de química (la misma forma que `ChemAnswer` del modelo de curso). */
export interface ChemAnswerKey {
  readonly mode: ChemAnswerMode
  /** «Fe2O3», «4 Fe + 3 O2 -> 2 Fe2O3», «sulfato de cobre(II)», «0.250», «[Ar] 4s2 3d6». */
  readonly expected: string
  /** number: cifras significativas exigidas. */
  readonly sigFigs?: number | null
  /** number: tolerancia relativa (por defecto 1 %). */
  readonly tolerance?: number | null
}

/** Valor de una clave numérica: «0.250», «2,5e-3», «6.02×10^23», «3/4». `null` si no es un número. */
export function chemKeyNumber(text: string): number | null {
  const t = trimAll(text)
  if (!t) return null
  const plain = Number(t.split(',').join('.'))
  if (Number.isFinite(plain) && /\d/.test(t)) return plain
  const written = parseWrittenNumber(t)
  if (written && Number.isFinite(written.value)) return written.value
  const r = Rational.parse(t)
  return r ? r.toNumber() : null
}

/**
 * Corrige la respuesta de un alumno a un ejercicio de química con el corrector que corresponde a su modo (como el
 * `ExerciseGrader` de la app Swift). El estado `invalid` significa que no se pudo leer la respuesta (o la clave).
 */
export function checkChemAnswer(key: ChemAnswerKey, student: string): ChemCheck {
  const s = trimAll(student)
  if (!s) return { status: 'invalid', feedback: L('Escribe tu respuesta primero.') }
  switch (key.mode) {
    case 'formula':
      return checkFormula(s, key.expected)
    case 'equation':
      return checkEquation(s, key.expected)
    case 'name':
      return checkName(s, key.expected)
    case 'configuration':
      return checkElectronConfiguration(s, key.expected)
    case 'number': {
      const want = chemKeyNumber(key.expected)
      if (want === null) return { status: 'invalid', feedback: L('La clave de este ejercicio no es un número válido.') }
      return checkNumber(s, want, key.sigFigs ?? null, key.tolerance ?? 0.01)
    }
  }
}
