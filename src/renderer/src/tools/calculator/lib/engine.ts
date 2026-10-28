// Cuaderno de la calculadora (puro, solo lo propio de la interfaz). El cálculo lo hace el motor: `LiveCalculator`
// (src/engine/math/services.ts: exacto, comparaciones y listas) y, si la cuenta usa variables o `ans`, `evaluate`.
// Aquí queda lo del cuaderno de la app Swift (CalculatorView.swift: CalcEngine y CalcFormat): asignaciones (`a = 5`),
// `ans`, cerrar los paréntesis que falten, la coma decimal suelta del español, la vista previa con el hueco que falta y
// cómo se enseña el resultado (fracción, π, √, desarrollo periódico, sin ruido de coma flotante).
import { LiveCalculator } from '@engine/math/services'
import { MathParser } from '@engine/math/parse/parser'
import { evaluate } from '@engine/math/eval/evaluate'
import { toLatex } from '@engine/math/print/latex'
import { freeVariables, type Expr } from '@engine/math/core/expr'
import { MathError, MV, type MathErrorKind, type MathValue } from '@engine/math/core/types'
import { Fraction } from '@engine/math/numbers/fraction'
import { NumberFormat } from '@engine/math/format/number-format'

/** `ans` se leería como a·n·s: se cambia por esta letra (que nadie escribe) antes de analizar. */
export const ANS_TOKEN = 'ϙ'
/** Hueco que falta mientras se escribe («3 + ▢»). */
const HOLE_TOKEN = 'ϗ'

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'atan2', 'asec', 'acsc', 'acot'])
const DIRECT_TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])

export interface CalcContext {
  vars: Readonly<Record<string, MathValue>>
  ans: MathValue | null
  degrees: boolean
}

/** Por qué no se pudo calcular (la interfaz lo explica en su idioma). */
export type CalcIssue =
  | { code: 'empty' }
  | { code: 'engine'; kind: MathErrorKind; message: string; position?: number }
  | { code: 'noAns' }
  | { code: 'unknown'; names: string[] }
  | { code: 'wordSplit'; word: string; letters: string }
  | { code: 'missingName' }
  | { code: 'ansName' }
  | { code: 'constantName'; name: string }
  | { code: 'multiLetter'; name: string; letters: string }
  | { code: 'missingValue'; name: string }
  | { code: 'equation' }
  | { code: 'notFinite' }
  | { code: 'ansInList' }

export interface CalcSuccess {
  ok: true
  /** `value`: un número; `bool`: una comparación («sin(π/6) = 1/2»); `list`: varias cuentas («1/2; 1/3»). */
  kind: 'value' | 'bool' | 'list'
  /** Número (en `bool`, 1 o 0). */
  value: MathValue
  /** Texto del motor para las listas (una línea por cuenta). */
  text?: string
  /** Forma cerrada que da el motor (3 + √2) cuando el resultado es real y no hay otra exacta mejor. */
  closedTex?: string
  /** LaTeX de lo escrito («a = \frac{1}{2}»). */
  tex: string
  /** Nombre de la variable guardada, si era una asignación. */
  assigned: string | null
  usesTrig: boolean
  /** En radianes, ¿parece pensado en grados? («sin(30)»). */
  looksLikeDegrees: boolean
  /** Texto que de verdad se calculó (con los paréntesis que faltaban). */
  input: string
}

export type CalcResult = CalcSuccess | { ok: false; issue: CalcIssue }

// MARK: Asignación

/** Divide «nombre = expresión» por el primer «=» que no forma parte de «==», «<=», «>=» o «!=». */
export function splitAssignment(text: string): { name: string; expr: string } | null {
  const c = Array.from(text)
  for (let i = 0; i < c.length; i++) {
    if (c[i] !== '=') continue
    const prev = i > 0 ? c[i - 1] : ''
    const next = i + 1 < c.length ? c[i + 1] : ''
    if (prev && '<>!='.includes(prev)) continue
    if (next === '=') continue
    return { name: c.slice(0, i).join(''), expr: c.slice(i + 1).join('') }
  }
  return null
}

function validateName(raw: string): { ok: true; name: string } | { ok: false; issue: CalcIssue } {
  const name = raw.trim()
  if (!name) return { ok: false, issue: { code: 'missingName' } }
  if (name.toLowerCase() === 'ans') return { ok: false, issue: { code: 'ansName' } }
  try {
    const e = MathParser.parse(name)
    if (e.type === 'variable') return { ok: true, name: e.name }
    if (e.type === 'constant') return { ok: false, issue: { code: 'constantName', name } }
  } catch {
    /* se explica abajo */
  }
  if (Array.from(name).length > 1 && /^\p{L}+$/u.test(name)) return { ok: false, issue: { code: 'multiLetter', name, letters: Array.from(name).join('·') } }
  return { ok: false, issue: { code: 'equation' } }
}

// MARK: ans y paréntesis

/** Cambia cada «ans» suelto por la letra reservada. */
export function replacingAns(s: string): string {
  return s.replace(/(^|[^\p{L}])ans(?![\p{L}])/giu, (_m, pre: string) => pre + ANS_TOKEN)
}

/** Paréntesis (y barras de valor absoluto) que faltan por cerrar al final. */
export function missingClosers(s: string): string {
  let depth = 0
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
  }
  return ')'.repeat(depth)
}

function texOf(e: Expr): string {
  return toLatex(e)
    .split(ANS_TOKEN)
    .join('\\mathrm{ans}')
    .split(HOLE_TOKEN)
    .join('\\square')
}

// MARK: Cálculo

/** Cambia la coma decimal suelta («3,5») por un punto fuera de paréntesis: el motor separa cuentas por comas. */
export function engineInput(s: string): string {
  const c = Array.from(s)
  let depth = 0
  let out = ''
  c.forEach((ch, i) => {
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    out += depth === 0 && ch === ',' && /\d/.test(c[i - 1] ?? '') && /\d/.test(c[i + 1] ?? '') ? '.' : ch
  })
  return out
}

/** Valor del resultado del motor: racional exacto si su texto lo es («7/12  ≈ 0,58…»), si no, real. */
function engineValue(text: string, decimal: number): MathValue {
  const head = text.split('  ≈')[0].trim()
  const f = /^-?\d+(\/\d+)?$/.test(head) ? Fraction.parse(head) : null
  return f && Math.abs(f.doubleValue - decimal) <= 1e-9 * Math.max(1, Math.abs(decimal)) ? MV.rational(f) : MV.real(decimal)
}

/** El LaTeX del motor, si es una forma cerrada con números, raíces y π (3 + √2, 11√2/12); `null` si repite la cuenta. */
export function closedForm(tex: string | undefined): string | null {
  if (!tex || !/\\(sqrt|pi)/.test(tex)) return null
  const rest = tex.replace(/\\(frac|sqrt|pi|cdot|left|right)/g, '')
  return /^[0-9{}()+\-\s.,]*$/.test(rest) ? tex : null
}

/** LaTeX de una comparación o de una lista (para el historial). */
function relationTex(text: string): string {
  const rel: Record<string, string> = { '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '==': '=', '=': '=', '!=': '\\ne', '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx' }
  try {
    const { operands, relations } = MathParser.parseRelation(text)
    return operands.map((o, i) => (i ? `${rel[relations[i - 1]] ?? relations[i - 1]} ` : '') + texOf(o)).join(' ')
  } catch {
    return `\\text{${text.replace(/[{}\\]/g, '')}}`
  }
}

function listTex(items: string[]): string {
  return items
    .map((it) => {
      try {
        return texOf(MathParser.parse(it))
      } catch {
        return `\\text{${it.replace(/[{}\\]/g, '')}}`
      }
    })
    .join(';\\quad ')
}

const engineIssue = (message: string): { ok: false; issue: CalcIssue } => ({ ok: false, issue: { code: 'engine', kind: 'domain', message: message.split(ANS_TOKEN).join('ans') } })

/** Calcula lo escrito (cerrando los paréntesis que falten). */
export function runCalc(raw: string, ctx: CalcContext): CalcResult {
  const text = raw.trim()
  if (!text) return { ok: false, issue: { code: 'empty' } }
  let exprText = text
  let assigned: string | null = null
  let nameIssue: CalcIssue | null = null
  const split = splitAssignment(text)
  if (split) {
    const v = validateName(split.name)
    if (v.ok) {
      assigned = v.name
      exprText = split.expr
      if (!exprText.trim()) return { ok: false, issue: { code: 'missingValue', name: split.name.trim() } }
    } else if (v.issue.code === 'equation') nameIssue = v.issue // quizá es una comparación («1/2 = 0,5»)
    else return { ok: false, issue: v.issue }
  }
  const closed = exprText + missingClosers(exprText)
  const prepared = replacingAns(closed)

  // comparaciones y listas: las resuelve la calculadora del motor
  if (!assigned) {
    const engineText = engineInput(prepared)
    const chain = LiveCalculator.comparisonChain(engineText)
    const items = LiveCalculator.topLevelSplit(engineText, [';', ','])
    if (chain || items.length > 1) {
      if (engineText.includes(ANS_TOKEN)) return { ok: false, issue: { code: 'ansInList' } }
      const r = LiveCalculator.calculate(engineText, ctx.degrees)
      if (r.error !== undefined) return nameIssue ? { ok: false, issue: nameIssue } : engineIssue(r.error)
      if (items.length > 1) return { ok: true, kind: 'list', value: MV.int(0), text: r.text, tex: listTex(items), assigned: null, usesTrig: false, looksLikeDegrees: false, input: closed }
      const holds = r.decimal === 1
      return { ok: true, kind: 'bool', value: MV.int(holds ? 1 : 0), tex: relationTex(engineText), assigned: null, usesTrig: false, looksLikeDegrees: false, input: closed }
    }
    if (nameIssue) return { ok: false, issue: nameIssue }
  }

  let expr: Expr
  try {
    expr = MathParser.parse(prepared)
  } catch (e) {
    if (e instanceof MathError) {
      const atEquals = e.position !== undefined && Array.from(prepared)[e.position] === '='
      if (atEquals || e.message.includes('«=»')) return { ok: false, issue: { code: 'equation' } }
      return { ok: false, issue: { code: 'engine', kind: e.kind, message: e.message.split(ANS_TOKEN).join('ans'), position: e.position } }
    }
    return { ok: false, issue: { code: 'engine', kind: 'syntax', message: '' } }
  }
  const env: Record<string, MathValue> = { ...ctx.vars }
  if (ctx.ans) env[ANS_TOKEN] = ctx.ans
  const free = [...freeVariables(expr)]
  const unknown = free.filter((n) => !(n in env))
  if (unknown.length) return { ok: false, issue: unknownIssue(unknown, exprText) }
  let value: MathValue
  let closedTex: string | undefined
  if (free.length === 0) {
    // sin variables: la calculadora exacta del motor
    const r = LiveCalculator.calculate(engineInput(prepared), ctx.degrees)
    if (r.error !== undefined || r.decimal === undefined) return engineIssue(r.error ?? '')
    value = engineValue(r.text, r.decimal)
    closedTex = closedForm(r.latex) ?? undefined
  } else {
    // con variables del cuaderno o `ans`: la evaluación exacta del motor con su entorno
    try {
      value = evaluate(expr, env, ctx.degrees ? 'degrees' : 'radians')
    } catch (e) {
      if (e instanceof MathError) return { ok: false, issue: { code: 'engine', kind: e.kind, message: e.message.split(ANS_TOKEN).join('ans') } }
      return { ok: false, issue: { code: 'engine', kind: 'domain', message: '' } }
    }
  }
  if (value.kind === 'real' && !Number.isFinite(value.value)) return { ok: false, issue: { code: 'notFinite' } }
  let tex = texOf(expr)
  if (assigned) tex = `${texOf({ type: 'variable', name: assigned })} = ${tex}`
  const input = split ? `${split.name.trim()} = ${closed.trim()}` : closed
  return { ok: true, kind: 'value', value, closedTex, tex, assigned, usesTrig: usesTrig(expr), looksLikeDegrees: !ctx.degrees && looksLikeDegrees(expr), input }
}

function unknownIssue(unknown: string[], text: string): CalcIssue {
  if (unknown.includes(ANS_TOKEN)) return { code: 'noAns' }
  // ¿una palabra de varias letras que se partió en letras sueltas? («area» = a·r·e·a)
  const words = text.split(/[^\p{L}]+/u).filter((w) => Array.from(w).length > 1 && w.toLowerCase() !== 'ans')
  for (const w of words) {
    try {
      const e = MathParser.parse(w)
      if (e.type === 'binary' && e.op === 'mul' && [...freeVariables(e)].some((v) => unknown.includes(v))) {
        return { code: 'wordSplit', word: w, letters: Array.from(w).join('·') }
      }
    } catch {
      /* no era una palabra de letras */
    }
  }
  return { code: 'unknown', names: [...unknown].sort() }
}

/** Vista previa mientras se escribe: LaTeX (con paréntesis cerrados y el hueco marcado) y, si ya se puede, el valor. */
export function previewCalc(raw: string, ctx: CalcContext): { tex: string; result: CalcSuccess | null; partial: boolean } | null {
  const text = raw.trim()
  if (!text) return null
  const done = runCalc(text, ctx)
  if (done.ok) return { tex: done.tex, result: done, partial: false }
  let prefix = ''
  let body = text
  const split = splitAssignment(text)
  if (split) {
    const v = validateName(split.name)
    if (!v.ok) return null
    prefix = `${texOf({ type: 'variable', name: v.name })} = `
    body = split.expr
  }
  const trimmed = body.trimEnd()
  const needsHole = trimmed === '' || /[+\-−*/×÷^·(,=√∛]$/.test(trimmed)
  const candidates = [body + missingClosers(body), (needsHole ? body + HOLE_TOKEN : body) + missingClosers(body)]
  for (const c of candidates) {
    try {
      const e = MathParser.parse(replacingAns(c))
      return { tex: prefix + texOf(e), result: null, partial: true }
    } catch {
      /* siguiente */
    }
  }
  return null
}

export function usesTrig(e: Expr): boolean {
  return someNode(e, (x) => x.type === 'call' && TRIG.has(x.name))
}

/** En radianes, `sin(30)`, `cos(45)`…: un argumento entero, múltiplo de 15 y de 15 en adelante es casi seguro en grados. */
export function looksLikeDegrees(e: Expr): boolean {
  const degreeLike = (a: Expr): boolean => {
    if (a.type === 'number') return a.value.isInteger && Math.abs(a.value.numerator) >= 15 && a.value.numerator % 15 === 0
    if (a.type === 'unary' && (a.op === 'neg' || a.op === 'plus')) return degreeLike(a.arg)
    return false
  }
  return someNode(e, (x) => x.type === 'call' && DIRECT_TRIG.has(x.name) && x.args.length === 1 && degreeLike(x.args[0]))
}

function someNode(e: Expr, pred: (x: Expr) => boolean): boolean {
  const stack: Expr[] = [e]
  let seen = 0
  while (stack.length && seen < 20000) {
    const x = stack.pop() as Expr
    seen++
    if (pred(x)) return true
    if (x.type === 'call') stack.push(...x.args)
    else if (x.type === 'unary') stack.push(x.arg)
    else if (x.type === 'binary') stack.push(x.left, x.right)
  }
  return false
}

// MARK: Cómo se muestra un resultado

export interface CalcDisplay {
  /** LaTeX del resultado principal (entero, fracción, π/k, √n o decimal). */
  tex: string
  /** `true` si el principal es aproximado (se muestra con ≈). */
  approx: boolean
  /** Desarrollo decimal de la forma exacta (finito, periódico o aproximado). */
  detailTex: string | null
  detailExact: boolean
  /** Número mixto (7/4 = 1 ¾). */
  mixedTex: string | null
  /** Texto que se copia («7/12», «3π/4»). */
  copy: string
  /** Decimal para copiar. */
  decimal: string
}

const sepTeX = (comma: boolean): string => (comma ? '{,}' : '.')

/** Entero con grupos de miles (espacio fino de LaTeX desde 5 cifras). */
export function groupTeX(digits: string): string {
  const neg = digits.startsWith('-')
  const d = neg ? digits.slice(1) : digits
  const g = d.length >= 5 ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '\\,') : d
  return (neg ? '-' : '') + g
}

function decimalTeX(s: string, comma: boolean): string {
  const [int, frac] = s.split('.')
  return groupTeX(int) + (frac !== undefined ? sepTeX(comma) + frac : '')
}

/** Decimal limpio (12 cifras) o notación científica para magnitudes extremas. */
export function realTeX(x: number, comma: boolean): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  const a = Math.abs(x)
  if (a !== 0 && (a >= 1e12 || a < 1e-6)) return NumberFormat.scientificTeX(x, 10).replace('.', sepTeX(comma))
  return decimalTeX(NumberFormat.decimal(x), comma)
}

function plainDecimal(x: number, comma: boolean): string {
  const s = NumberFormat.decimal(x)
  return comma ? s.replace('.', ',') : s
}

/** Desarrollo decimal exacto de una fracción: finito («0,25»), periódico («0,8\overline{3}») o aproximado. */
export function expansion(f: Fraction, comma: boolean): { tex: string; exact: boolean } {
  const n = f.num < 0n ? -f.num : f.num
  const d = f.den
  const sign = f.num < 0n ? '-' : ''
  const intPart = n / d
  let r = n % d
  const digits: bigint[] = []
  const seen = new Map<bigint, number>()
  let repeatStart: number | null = null
  while (r !== 0n && digits.length < 60) {
    const s = seen.get(r)
    if (s !== undefined) {
      repeatStart = s
      break
    }
    seen.set(r, digits.length)
    const m = r * 10n
    digits.push(m / d)
    r = m % d
  }
  const head = sign + groupTeX(String(intPart)) + sepTeX(comma)
  if (r === 0n) {
    if (digits.length <= 15) return { tex: head + digits.join(''), exact: true }
    return { tex: realTeX(f.doubleValue, comma), exact: false }
  }
  if (repeatStart !== null && repeatStart <= 10 && digits.length - repeatStart <= 12) {
    const pre = digits.slice(0, repeatStart).join('')
    const rep = digits.slice(repeatStart).join('')
    return { tex: `${head}${pre}\\overline{${rep}}`, exact: true }
  }
  return { tex: realTeX(f.doubleValue, comma), exact: false }
}

/** Fracción sencilla (denominador ≤ 12) a la que `x` es igual salvo ruido de coma flotante (cos 60° = 0,5000000000000001). */
export function nearFraction(x: number): Fraction | null {
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 1e6) return null
  for (let q = 2; q <= 12; q++) {
    const p = Math.round(x * q)
    if (p !== 0 && Math.abs(p) <= 1e7 && Math.abs(x - p / q) <= 1e-12 * Math.abs(x)) {
      const f = Fraction.of(p, q)
      if (f && !f.isInteger) return f
    }
  }
  return null
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))

/** Parte cuadrada de n: n = a²·m con m libre de cuadrados. */
export function squareFree(n: number): { a: number; m: number } {
  let a = 1
  let m = n
  for (let k = 2; k * k <= m; k++) {
    while (m % (k * k) === 0) {
      m /= k * k
      a *= k
    }
  }
  return { a, m }
}

/**
 * Forma exacta de un real si es un múltiplo sencillo de π (3π/4) o una raíz (√2/2, 2√3) salvo ruido de coma flotante
 * (error relativo ≤ `tolerance`). `null` si no se parece a ninguna.
 */
export function exactForm(x: number, tolerance = 1e-12): { tex: string; plain: string } | null {
  if (!Number.isFinite(x) || x === 0) return null
  const sign = x < 0 ? '-' : ''
  // múltiplos de π
  const t = x / Math.PI
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(t * q)
    if (p !== 0 && Math.abs(p) <= 48 && Math.abs(t - p / q) <= tolerance * Math.max(1, Math.abs(t))) {
      const g = gcd(Math.abs(p), q)
      const num = Math.abs(p) / g
      const den = q / g
      const numTex = num === 1 ? '\\pi' : `${num}\\pi`
      const numPlain = num === 1 ? 'π' : `${num}π`
      return { tex: sign + (den === 1 ? numTex : `\\frac{${numTex}}{${den}}`), plain: sign + (den === 1 ? numPlain : `${numPlain}/${den}`) }
    }
  }
  // raíces cuadradas: x = a·√m / den
  for (let den = 1; den <= 12; den++) {
    const s = Math.abs(x) * den
    const n = Math.round(s * s)
    if (n < 2 || n > 100000) continue
    const root = Math.sqrt(n)
    if (Number.isInteger(root)) continue
    if (Math.abs(s - root) > tolerance * Math.max(1, s) * 4) continue
    const { a, m } = squareFree(n)
    const g = gcd(a, den)
    const aa = a / g
    const dd = den / g
    const rootTex = `${aa === 1 ? '' : aa}\\sqrt{${m}}`
    const rootPlain = `${aa === 1 ? '' : aa}√${m}`
    return { tex: sign + (dd === 1 ? rootTex : `\\frac{${rootTex}}{${dd}}`), plain: sign + (dd === 1 ? rootPlain : `${rootPlain}/${dd}`) }
  }
  return null
}

/** Cómo se enseña un valor: forma exacta y decimal (con `closedTex`, la forma cerrada del motor si no hay otra). */
export function displayValue(v: MathValue, comma: boolean, closedTex?: string | null): CalcDisplay {
  if (v.kind === 'rational') {
    const f = v.value
    if (f.isInteger) {
      const s = String(f.num)
      return { tex: groupTeX(s), approx: false, detailTex: null, detailExact: true, mixedTex: null, copy: s, decimal: s }
    }
    const dec = expansion(f, comma)
    const absNum = f.num < 0n ? -f.num : f.num
    const whole = absNum / f.den
    const mixedTex = whole > 0n ? `${f.num < 0n ? '-' : ''}${whole}\\tfrac{${absNum % f.den}}{${f.den}}` : null
    return { tex: f.latex, approx: false, detailTex: dec.tex, detailExact: dec.exact, mixedTex, copy: f.plain, decimal: plainDecimal(f.doubleValue, comma) }
  }
  const x = v.value
  // ruido de coma flotante sobre un valor exacto: asin(0,5) en grados da 30,000000000000004
  const r = Math.round(x)
  if (Math.abs(x) < 1e15 && (x === r || (r !== 0 && Math.abs(x - r) <= 1e-12 * Math.abs(x)))) return displayValue(MV.int(r), comma)
  const nf = nearFraction(x)
  if (nf) return displayValue(MV.rational(nf), comma)
  const exact = exactForm(x)
  if (exact) return { tex: exact.tex, approx: false, detailTex: realTeX(x, comma), detailExact: false, mixedTex: null, copy: exact.plain, decimal: plainDecimal(x, comma) }
  if (closedTex) return { tex: closedTex.replace(/(\d)\.(\d)/g, comma ? '$1{,}$2' : '$1.$2'), approx: false, detailTex: realTeX(x, comma), detailExact: false, mixedTex: null, copy: plainDecimal(x, comma), decimal: plainDecimal(x, comma) }
  return { tex: realTeX(x, comma), approx: true, detailTex: null, detailExact: true, mixedTex: null, copy: plainDecimal(x, comma), decimal: plainDecimal(x, comma) }
}

// MARK: Guardar valores

export type StoredValue = { k: 'q'; n: string; d: string } | { k: 'r'; v: number }

export function storeValue(v: MathValue): StoredValue {
  return v.kind === 'rational' ? { k: 'q', n: String(v.value.num), d: String(v.value.den) } : { k: 'r', v: v.value }
}

export function loadValue(s: unknown): MathValue | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  if (o.k === 'q' && typeof o.n === 'string' && typeof o.d === 'string') {
    try {
      const f = Fraction.of(BigInt(o.n), BigInt(o.d))
      return f ? MV.rational(f) : null
    } catch {
      return null
    }
  }
  if (o.k === 'r' && typeof o.v === 'number' && Number.isFinite(o.v)) return MV.real(o.v)
  return null
}
