// Teclas de símbolos de cada tipo de respuesta (port de StudyUI/Exercise/AnswerKeyboard.swift): lo que se ve, lo que se
// escribe y cuánto retrocede el cursor (para quedar dentro de «()»). `help` es la clave de i18n (study:keys.*).
import type { Answer, ChemMode } from '@shared/schema/exercises'

export interface AnswerKey {
  label: string
  insert: string
  caretBack?: number
  help: string
  /** Variables y nombres de función: texto normal (no serif matemática). */
  plain?: boolean
}

const K = (label: string, insert: string, help: string, caretBack = 0, plain = false): AnswerKey => ({ label, insert, help, caretBack, plain })

export const KEYS = {
  pi: K('π', 'π', 'pi'),
  sqrt: K('√', '√()', 'sqrt', 1),
  square: K('x²', '^2', 'square'),
  power: K('xⁿ', '^()', 'power', 1),
  fraction: K('a⁄b', '/', 'fraction'),
  parens: K('( )', '()', 'parens', 1),
  abs: K('|x|', '||', 'abs', 1),
  degree: K('°', '°', 'degree'),
  infinity: K('∞', '∞', 'infinity'),
  minusInfinity: K('−∞', '-∞', 'minusInfinity'),
  union: K('∪', ' ∪ ', 'union'),
  le: K('≤', '≤', 'le'),
  ge: K('≥', '≥', 'ge'),
  lt: K('<', '<', 'lt'),
  gt: K('>', '>', 'gt'),
  comma: K(',', ', ', 'comma'),
  equals: K('=', ' = ', 'equals'),
  plusMinus: K('±', '±', 'plusMinus'),
  sci: K('×10ⁿ', '*10^()', 'sci', 1),
  percent: K('%', '%', 'percent')
} satisfies Record<string, AnswerKey>

const RESERVED = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp', 'sqrt', 'abs', 'pi', 'e', 'inf', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan'])
const GREEK: Record<string, string> = { theta: 'θ', alpha: 'α', beta: 'β', phi: 'φ', lambda: 'λ', mu: 'μ', omega: 'ω' }
const FUNCTIONS = ['sin', 'cos', 'tan', 'ln', 'log', 'exp', 'arcsin', 'arccos', 'arctan']

/** Variables de una expresión esperada (letras sueltas y letras griegas, sin funciones ni constantes), en orden. */
export function variablesIn(expr: string): string[] {
  const out: string[] = []
  const add = (v: string): void => {
    if (!out.includes(v)) out.push(v)
  }
  for (const m of expr.matchAll(/[A-Za-zθαβφλμω]+/g)) {
    const w = m[0]
    if (RESERVED.has(w.toLowerCase())) continue
    if (GREEK[w]) add(GREEK[w])
    else if (/^[θαβφλμω]$/.test(w)) add(w)
    else if (w.length === 1) add(w)
    else for (const ch of w) if (!RESERVED.has(ch)) add(ch)
  }
  return out.filter((v) => v !== 'e')
}

/** Funciones que aparecen en la respuesta esperada (para ofrecer sus teclas). */
export function functionsIn(expr: string): string[] {
  const low = expr.toLowerCase()
  return FUNCTIONS.filter((f) => new RegExp(`(^|[^a-z])${f}\\s*\\(`).test(low) || new RegExp(`(^|[^a-z])${f}(?=[^a-z]|$)`).test(low)).slice(0, 4)
}

const fn = (name: string): AnswerKey => K(name, `${name}()`, 'function', 1, true)
const variable = (v: string): AnswerKey => K(v, v, 'variable')

export function chemKeys(mode: ChemMode): AnswerKey[][] {
  const charges = [K('X⁺', '^+', 'chargePlus', 0, true), K('X⁻', '^-', 'chargeMinus', 0, true), K('X²⁺', '^2+', 'charge2Plus', 0, true), K('X²⁻', '^2-', 'charge2Minus', 0, true)]
  const group = [K('( )', '()', 'group', 1, true), K('·', '·', 'hydrate', 0, true)]
  switch (mode) {
    case 'formula':
      return [group, charges]
    case 'equation':
      return [[K('→', ' → ', 'arrow', 0, true), K('⇌', ' ⇌ ', 'equilibrium', 0, true), K('+', ' + ', 'plus', 0, true)], group, charges, ['aq', 's', 'l', 'g'].map((s) => K(`(${s})`, `(${s})`, 'state', 0, true))]
    case 'configuration':
      return [['He', 'Ne', 'Ar', 'Kr', 'Xe'].map((g) => K(`[${g}]`, `[${g}] `, 'core', 0, true)), ['s', 'p', 'd', 'f'].map((o) => K(o, o, 'orbital', 0, true))]
    default:
      return []
  }
}

/** Teclas para una respuesta, en grupos (vacío = sin teclado). */
export function keysFor(answer: Answer): AnswerKey[][] {
  const basics = [KEYS.pi, KEYS.sqrt, KEYS.square, KEYS.power, KEYS.fraction, KEYS.parens, KEYS.abs]
  switch (answer.kind) {
    case 'numeric': {
      const extra: AnswerKey[] = []
      if (answer.angle === 'degrees' || answer.suffix === '°' || answer.unit === '°') extra.push(KEYS.degree)
      if (answer.form === 'scientific') extra.push(KEYS.sci)
      if (answer.form === 'percent') extra.push(KEYS.percent)
      return extra.length ? [basics, extra] : [basics]
    }
    case 'expression': {
      const vars = (answer.variables ?? variablesIn(answer.expected)).slice(0, 3).map(variable)
      const groups = [vars, basics].filter((g) => g.length)
      const f = functionsIn(answer.expected)
      if (f.length) groups.push(f.map(fn))
      return groups
    }
    case 'equation': {
      const vars = (answer.variables ?? variablesIn(answer.expected)).slice(0, 3).map(variable)
      const groups = [[KEYS.equals, ...vars], basics]
      const f = functionsIn(answer.expected)
      if (f.length) groups.push(f.map(fn))
      return groups
    }
    case 'set':
      return [[KEYS.comma, KEYS.plusMinus], [KEYS.pi, KEYS.sqrt, KEYS.square, KEYS.fraction, KEYS.parens]]
    case 'interval':
      return [[K('(', '(', 'openEnd'), K('[', '[', 'closedEnd'), K(')', ')', 'openEnd'), K(']', ']', 'closedEnd'), KEYS.comma], [KEYS.infinity, KEYS.minusInfinity, KEYS.union], [KEYS.le, KEYS.ge, KEYS.lt, KEYS.gt], [KEYS.pi, KEYS.sqrt, KEYS.fraction]]
    case 'point':
      return [[K('( , )', '(, )', 'point', 3), KEYS.comma], [KEYS.pi, KEYS.sqrt, KEYS.square, KEYS.fraction]]
    case 'chem':
      return chemKeys(answer.mode)
    default:
      return []
  }
}
