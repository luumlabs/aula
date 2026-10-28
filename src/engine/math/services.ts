// Puente entre MathKit y el resto de Aula (port de StudyEngine/Math/MathServices.swift): validación matemática del contenido
// que escribe la IA, instanciación de plantillas con una semilla y la calculadora exacta de la IA y de la app.
//
// La corrección de ejercicios completos (`selfCheck`, `canonicalInput`, previsualizaciones) vive en `@engine/grading`, que
// usa estas piezas: así MathKit no depende del modelo de ejercicios.

import { simplify } from './algebra/simplify'
import { E, freeVariables, substitute, type Expr } from './core/expr'
import { chars as toChars, charCount, sortedStrings, trimWS, trimWSNL } from './core/text'
import { MathError } from './core/types'
import { evaluate, evaluateDouble } from './eval/evaluate'
import { AnswerVocabulary } from './check/answer-words'
import { NumberFormat } from './format/number-format'
import { MathParser } from './parse/parser'
import { toLatex } from './print/latex'
import { toPlain } from './print/plain'
import { TemplateEngine } from './template/engine'
import type { TemplateContext, TemplateVar, VarKind } from './template/types'

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

// MARK: - Validación matemática del contenido que escribe la IA

/** Validación de expresiones y valores del contenido (los mensajes van en español, como en la app Swift). */
export const MathKitChecker = {
  /** Comparaciones (`<`, `<=`, `==`, `!=`, `=`) se comprueban lado por lado. */
  sides(text: string): string[] {
    let t = text
    for (const op of ['<=', '>=', '!=', '==', '≤', '≥', '≠']) t = t.split(op).join('\u0001')
    for (const op of ['<', '>', '=']) t = t.split(op).join('\u0001')
    return t.split('\u0001').map(trimWS).filter((s) => s !== '')
  },

  /** Antes cambiaba `theta` por `θ`; MathKit ya lee los nombres griegos, así que devuelve el texto tal cual. */
  sidesFix(s: string): string {
    return s
  },

  /** `null` = válida; si no, un mensaje de error (en español) con la causa. */
  checkExpression(text: string, variables: Iterable<string> | null = null): string | null {
    // nombres declarados en su forma canónica (theta → θ, alpha → α…), la misma que da `freeVariables`
    const allowed = variables ? new Set([...variables].map((v) => MathParser.canonicalVariableName(v))) : null
    const parts = MathKitChecker.sides(text)
    if (parts.length === 0) return 'está vacía'
    for (const p of parts) {
      try {
        const e = MathParser.parse(p)
        if (allowed) {
          const extra = sortedStrings([...freeVariables(e)].filter((v) => !allowed.has(v)))
          if (extra.length > 0) {
            return `usa «${extra.join(', ')}», que no está definida` + (allowed.size === 0 ? '' : ` (disponibles: ${sortedStrings(allowed).join(', ')})`)
          }
        }
      } catch (e) {
        return e instanceof MathError ? e.message : 'no se pudo interpretar'
      }
    }
    return null
  },

  /** `null` = un valor numérico válido (o «no existe» / «ninguno» en los 12 idiomas); si no, el motivo. */
  checkNumericValue(text: string): string | null {
    const t = trimWSNL(text)
    if (t === '') return 'está vacío'
    if (AnswerVocabulary.saysUndefined(t) || AnswerVocabulary.saysEmpty(t)) return null
    try {
      const e = MathParser.parse(t)
      const free = freeVariables(e)
      if (free.size > 0) return `contiene variables (${sortedStrings(free).join(', ')}); debe ser un número`
      evaluate(e)
      return null
    } catch (e) {
      return e instanceof MathError ? e.message : 'no se pudo interpretar'
    }
  },

  /**
   * La clave numérica como la escribiría el estudiante: el valor (con la unidad si es obligatoria) o, si se piden
   * decimales o una forma que el valor no cumple tal cual (científica, porcentaje, número mixto), el decimal redondeado.
   * `null` si no se puede construir de forma fiable. La usa la autocomprobación de las claves (`canonicalInput`).
   */
  canonicalNumericInput(n: NumericKeyLike): string | null {
    const form = n.form ?? 'any'
    if ((n.decimals !== undefined && n.decimals !== null) || !['any', 'fraction', 'reducedFraction', 'integer', 'decimal'].includes(form)) {
      return MathKitChecker.numericRoundedInput(n)
    }
    let s = n.value
    if (n.unitMode === 'required' && n.unit) s += ` ${n.unit}`
    return s
  },

  /** La clave redondeada a los decimales pedidos (acotados a 0…15), con la unidad si es obligatoria; `null` si no se puede. */
  numericRoundedInput(n: NumericKeyLike): string | null {
    const d = n.decimals
    if (d === undefined || d === null) return null
    let v: number
    try {
      v = evaluateDouble(MathParser.parse(n.value))
    } catch {
      return null
    }
    if (!Number.isFinite(v)) return null
    // decimales acotados: con un valor enorme el formateo tardaba minutos (o desbordaba al redondear)
    let s = NumberFormat.decimal(v, Math.min(Math.max(d, 0), 15), false)
    if (n.unitMode === 'required' && n.unit) s += ` ${n.unit}`
    return s
  },
}

/** Lo que hace falta de una respuesta numérica del contenido para escribir su clave. */
export interface NumericKeyLike {
  value: string
  decimals?: number | null
  form?: string
  unit?: string | null
  unitMode?: string
}

// MARK: - Plantillas: instanciar con una semilla

/** Variable de plantilla tal como la escribe el contenido (`TemplateVarSpec` del modelo de ejercicios). */
export interface TemplateVarSpecLike {
  name: string
  /** int | real | pick | fraction | expr (y sinónimos). */
  kind: string
  min?: number
  max?: number
  decimals?: number
  exclude?: readonly number[]
  values?: readonly string[]
  minDen?: number
  maxDen?: number
  maxNum?: number
  proper?: boolean
  expr?: string
}

/** Lo que hace falta de una plantilla para muestrearla (`ExerciseTemplate` del modelo cumple esta forma). */
export interface TemplateSourceLike {
  id: string
  vars: readonly TemplateVarSpecLike[]
  constraints: readonly string[]
}

/** Tipo de error al instanciar una plantilla. */
export type TemplateFailureKind = 'badVar' | 'sampling' | 'render' | 'decode'

/** Error al instanciar una plantilla (mensaje en español, para el autor o la IA). */
export class TemplateFailure extends Error {
  readonly kind: TemplateFailureKind
  constructor(kind: TemplateFailureKind, message: string) {
    super(message)
    this.name = 'TemplateFailure'
    this.kind = kind
  }
}

type JSONLike = null | boolean | number | string | JSONLike[] | { [key: string]: JSONLike }

const DIGITS_HINT_RE = /(dec|sig)\s*\(\s*\d{3,}/i
const DIGITS_RE = /(?<![\p{L}\p{N}_])(dec|sig)(\s*\(\s*)(\d+)/giu

/** Instanciación de plantillas de ejercicio con una semilla (muestreo, `{{…}}` y sustitución en las respuestas). */
export const TemplateInstantiator = {
  /** Tamaño máximo de una plantilla (JSON): una normal ocupa unos pocos KB. */
  maxTemplateBytes: 150_000,

  /** Entero a partir de un número del contenido (`Int(1e300)` cerraba la app): se acota a ±1e15 y se trunca. */
  safeInt(x: number): number {
    return Number.isFinite(x) ? Math.trunc(Math.max(-1e15, Math.min(1e15, x))) : 0
  },

  /** Tipo de la variable (`null` si es desconocido). */
  varKind(v: TemplateVarSpecLike): VarKind | null {
    const safeInt = TemplateInstantiator.safeInt
    switch (v.kind.toLowerCase()) {
      case 'int':
      case 'integer':
        return { type: 'int', min: safeInt(v.min ?? 1), max: safeInt(v.max ?? 10), exclude: (v.exclude ?? []).map(safeInt) }
      case 'real':
      case 'double':
      case 'float':
      case 'decimal':
        return { type: 'real', min: v.min ?? 0, max: v.max ?? 10, decimals: v.decimals ?? 1 }
      case 'pick':
      case 'choice':
      case 'oneof':
        return { type: 'pick', values: [...(v.values ?? [])] }
      case 'fraction':
      case 'frac':
      case 'rational':
        return { type: 'fraction', minDen: v.minDen ?? 2, maxDen: v.maxDen ?? 9, maxNum: v.maxNum ?? 9, proper: v.proper ?? true }
      case 'expr':
      case 'expression':
      case 'derived':
        return v.expr !== undefined ? { type: 'expr', expr: v.expr } : null
      default:
        return null
    }
  },

  /** Valores de las variables de la plantilla para una semilla. Lanza `TemplateFailure`. */
  context(t: TemplateSourceLike, seed: bigint | number): TemplateContext {
    // cientos de variables o restricciones no son una plantilla de ejercicio (y cada intento de muestreo las evalúa todas)
    if (t.vars.length > 60) throw new TemplateFailure('badVar', `La plantilla tiene ${t.vars.length} variables; usa como mucho 60.`)
    if (t.constraints.length > 60) throw new TemplateFailure('sampling', `La plantilla tiene ${t.constraints.length} restricciones; usa como mucho 60.`)
    const vars: TemplateVar[] = []
    for (const v of t.vars) {
      const k = TemplateInstantiator.varKind(v)
      if (!k) throw new TemplateFailure('badVar', `La variable «${v.name}» tiene un tipo desconocido («${v.kind}»).`)
      vars.push({ name: v.name, kind: k })
    }
    try {
      return TemplateEngine.sample(vars, t.constraints, seed, TemplateInstantiator.maxTries(vars, t.constraints))
    } catch (e) {
      throw new TemplateFailure('sampling', `No se pudieron elegir valores que cumplan las restricciones: ${errorMessage(e)}`)
    }
  },

  /**
   * Intentos de muestreo según el coste de cada uno: con rangos de millones y restricciones imposibles, 400 intentos
   * tardaban decenas de segundos. Con plantillas normales (rangos pequeños) se conservan los 400 intentos de siempre.
   */
  maxTries(vars: readonly TemplateVar[], constraints: readonly string[]): number {
    let cost = 1
    for (const v of vars) {
      const k = v.kind
      switch (k.type) {
        case 'int': {
          const span = k.max - k.min
          cost += Number.isSafeInteger(span) ? Math.min(Math.max(span, 0), 5_000_000) : 5_000_000
          break
        }
        case 'expr':
          cost += 20 * Math.min(charCount(k.expr), 2000)
          break
        case 'pick':
          cost += Math.min(k.values.length, 100_000)
          break
        default:
          cost += 10
      }
    }
    for (const c of constraints) cost += 20 * Math.min(charCount(c), 2000)
    return Math.max(1, Math.min(400, Math.floor(2_000_000 / cost)))
  },

  /** `{{dec(N):…}}` / `{{sig(N):…}}` con N enorme escribía millones de ceros (cuelgue): se acota N a 15. */
  clampDirectiveDigits(text: string): string {
    if (!text.includes('(') || !DIGITS_HINT_RE.test(text)) return text
    return text.replace(DIGITS_RE, (_m: string, name: string, open: string, digits: string) => name + open + (Number(digits) > 15 ? '15' : digits))
  },

  /**
   * Sustituye las variables de la plantilla por sus valores dentro de una expresión (deja libres las demás, p. ej. `x`).
   * Intervalos, listas y ecuaciones `a = b` se tratan por partes.
   */
  substitute(text: string, ctx: TemplateContext): string {
    // las claves en forma canónica (una variable de plantilla llamada `theta` o `alpha` es θ / α para `freeVariables`)
    const values = new Map<string, Expr>()
    for (const [k, v] of Object.entries(ctx.values)) values.set(MathParser.canonicalVariableName(k), v.kind === 'rational' ? E.num(v.value) : E.real(v.value))
    if (values.size === 0) return text
    const one = (part: string): string => {
      let e: Expr
      try {
        e = MathParser.parse(part)
      } catch {
        return part
      }
      const free = sortedStrings([...freeVariables(e)].filter((n) => values.has(n)))
      if (free.length === 0) return part
      for (const n of free) e = substitute(e, n, values.get(n) as Expr)
      return toPlain(simplify(e))
    }
    if (text.includes('=') && !text.includes('<') && !text.includes('>')) {
      const p = text.split('=')
      if (p.length === 2) return one(p[0]) + ' = ' + one(p[1])
    }
    return one(text)
  },

  /**
   * Instancia el JSON de una plantilla (`encodeTemplate`) con una semilla: quita `vars` y `constraints`, pone
   * `id = "<id>#<semilla>"`, `templateID` y `seed`, rellena todos los `{{…}}` y sustituye las variables en los campos de
   * la respuesta que son expresiones (`value`, `alternatives`, `expected`). Devuelve el JSON del ejercicio (sin validar:
   * quien llama lo decodifica). Lanza `TemplateFailure`.
   */
  instantiateJSON(t: TemplateSourceLike, templateJSON: Readonly<Record<string, unknown>>, seed: bigint | number): Record<string, unknown> {
    const text = JSON.stringify(templateJSON)
    const bytes = new TextEncoder().encode(text).length
    if (bytes > TemplateInstantiator.maxTemplateBytes) {
      throw new TemplateFailure('decode', `La plantilla es demasiado grande (${Math.floor(bytes / 1000)} KB); divídela en plantillas más pequeñas.`)
    }
    const s = BigInt.asUintN(64, typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed)))
    const ctx = TemplateInstantiator.context(t, s)
    const o: Record<string, JSONLike> = { ...(JSON.parse(text) as Record<string, JSONLike>) }
    delete o.vars
    delete o.constraints
    o.id = `${t.id}#${s}`
    o.templateID = t.id
    o.seed = Number(s & 0x1f_ffff_ffff_ffffn)
    return process(o, ctx, []) as Record<string, unknown>
  },
}

function process(v: JSONLike, ctx: TemplateContext, path: readonly string[]): JSONLike {
  if (typeof v === 'string') return processString(v, ctx, path)
  if (Array.isArray(v)) return v.map((x) => process(x, ctx, [...path, '[]']))
  if (v !== null && typeof v === 'object') {
    const out: Record<string, JSONLike> = {}
    for (const [k, x] of Object.entries(v)) out[k] = process(x, ctx, [...path, k])
    return out
  }
  return v
}

function processString(s: string, ctx: TemplateContext, path: readonly string[]): string {
  let t = s
  if (t.includes('{{')) {
    try {
      t = TemplateEngine.render(TemplateInstantiator.clampDirectiveDigits(t), ctx)
    } catch (e) {
      throw new TemplateFailure('render', `No se pudo rellenar «${toChars(s).slice(0, 60).join('')}»: ${errorMessage(e)}`)
    }
  }
  // campos de respuesta que son expresiones de las variables
  if (path[0] !== 'answer') return t
  const last = path[path.length - 1]
  const key = last === '[]' ? (path[path.length - 2] ?? '') : (last ?? '')
  if (['value', 'alternatives', 'expected'].includes(key) && !path.includes('options')) return TemplateInstantiator.substitute(t, ctx)
  return t
}

// MARK: - Calculadora exacta para la IA y la app

/** Resultado de la calculadora: texto para mostrar, valor decimal, LaTeX y error (si lo hubo). */
export interface CalcResult {
  text: string
  decimal?: number
  latex?: string
  error?: string
}

function calcResult(text: string, more: Omit<CalcResult, 'text'> = {}): CalcResult {
  const r: CalcResult = { text }
  if (more.decimal !== undefined) r.decimal = more.decimal
  if (more.latex !== undefined) r.latex = more.latex
  if (more.error !== undefined) r.error = more.error
  return r
}

function hasPrefixAt(cs: readonly string[], i: number, sep: readonly string[]): boolean {
  if (i + sep.length > cs.length) return false
  for (let k = 0; k < sep.length; k++) if (cs[i + k] !== sep[k]) return false
  return true
}

/** Calculadora exacta (racionales exactos cuando se puede) con varias cuentas, comparaciones y condiciones. */
export const LiveCalculator = {
  calculate(expression: string, degrees = false): CalcResult {
    // varias cuentas a la vez («sin(pi/6), cos(pi/6); tan(pi/6)»): una por una (las comas dentro de gcd(4,6) no cuentan)
    const items = LiveCalculator.topLevelSplit(expression, [';', ','])
    if (items.length > 1) {
      const lines: string[] = []
      for (const item of items.slice(0, 40)) {
        const r = LiveCalculator.calculate(item, degrees)
        lines.push(`${item} → ` + (r.error !== undefined ? `error: ${r.error}` : r.text))
      }
      return calcResult(lines.join('\n'))
    }
    // condiciones encadenadas: «a == b && c < d» (también «and», «||», «or»)
    const any = LiveCalculator.topLevelSplit(expression, ['||', ' or '])
    if (any.length > 1) return combine(any, degrees, false)
    const all = LiveCalculator.topLevelSplit(expression, ['&&', ' and '])
    if (all.length > 1) return combine(all, degrees, true)
    const chain = LiveCalculator.comparisonChain(expression)
    if (chain) return compareChain(chain, degrees)
    try {
      const e = MathParser.parse(expression)
      const free = freeVariables(e)
      if (free.size > 0) {
        return calcResult('', { error: `La expresión tiene variables (${sortedStrings(free).join(', ')}); la calculadora solo evalúa números.` })
      }
      const v = evaluate(e, {}, degrees ? 'degrees' : 'radians')
      if (v.kind === 'rational') {
        const f = v.value
        return calcResult(f.plain + (f.isInteger ? '' : `  ≈ ${NumberFormat.significant(f.doubleValue, 12)}`), { decimal: f.doubleValue, latex: f.latex })
      }
      return calcResult(NumberFormat.significant(v.value, 14), { decimal: v.value, latex: toLatex(simplify(e)) })
    } catch (e) {
      return calcResult('', { error: errorMessage(e) })
    }
  },

  /** Parte el texto por separadores que estén fuera de paréntesis, corchetes y llaves (si alguna parte queda vacía, no parte). */
  topLevelSplit(s: string, separators: readonly string[]): string[] {
    const cs = toChars(s)
    const seps = separators.map((x) => toChars(x))
    const parts: string[] = []
    let current = ''
    let depth = 0
    let i = 0
    scan: while (i < cs.length) {
      const c = cs[i]
      if ('([{'.includes(c)) depth += 1
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
      if (depth === 0) {
        for (const sep of seps) {
          if (hasPrefixAt(cs, i, sep)) {
            parts.push(current)
            current = ''
            i += sep.length
            continue scan
          }
        }
      }
      current += c
      i += 1
    }
    parts.push(current)
    const trimmed = parts.map(trimWS)
    return trimmed.length > 1 && trimmed.every((p) => p !== '') ? trimmed : [s]
  },

  /** `a < b`, `a <= b < c`, `a == b`, `a != b`, `a ≈ b`… con los operadores fuera de paréntesis. `null` si no hay comparación. */
  comparisonChain(s: string): { operands: string[]; ops: string[] } | null {
    const ops = ['<=', '>=', '==', '!=', '≤', '≥', '≠', '≈', '<', '>', '=']
    const opChars = ops.map((o) => toChars(o))
    const cs = toChars(s)
    let operands: string[] = []
    const found: string[] = []
    let depth = 0
    let current = ''
    let i = 0
    scan: while (i < cs.length) {
      const c = cs[i]
      if ('([{'.includes(c)) depth += 1
      else if (')]}'.includes(c)) depth -= 1
      if (depth === 0) {
        for (let k = 0; k < ops.length; k++) {
          if (hasPrefixAt(cs, i, opChars[k])) {
            operands.push(current)
            found.push(ops[k])
            current = ''
            i += opChars[k].length
            continue scan
          }
        }
      }
      current += c
      i += 1
    }
    operands.push(current)
    operands = operands.map(trimWS)
    if (found.length === 0 || operands.some((o) => o === '')) return null
    return { operands, ops: found }
  },
}

/** Varias condiciones unidas por «y» (todas) u «o» (alguna). */
function combine(conditions: readonly string[], degrees: boolean, all: boolean): CalcResult {
  const results: boolean[] = []
  const lines: string[] = []
  for (const cond of conditions) {
    const r = LiveCalculator.calculate(cond, degrees)
    if (r.error !== undefined) return calcResult('', { error: `En «${cond}»: ${r.error}` })
    if (LiveCalculator.comparisonChain(cond) === null && LiveCalculator.topLevelSplit(cond, ['&&', ' and ', '||', ' or ']).length <= 1) {
      return calcResult('', { error: `«${cond}» no es una condición: usa comparaciones como a == b o a < b a cada lado de && / ||.` })
    }
    results.push(r.decimal === 1)
    lines.push(`${cond} → ${r.decimal === 1 ? 'true' : 'false'}`)
  }
  const holds = all ? !results.includes(false) : results.includes(true)
  return calcResult((holds ? 'true' : 'false') + '  (' + lines.join('; ') + ')', { decimal: holds ? 1 : 0 })
}

/** Evalúa cada lado y comprueba la cadena; la igualdad tolera el error de redondeo (≈1e-12 relativo). */
function compareChain(chain: { operands: string[]; ops: string[] }, degrees: boolean): CalcResult {
  const values: number[] = []
  const shown: string[] = []
  for (const side of chain.operands) {
    const r = LiveCalculator.calculate(side, degrees)
    if (r.error !== undefined) return calcResult('', { error: `En «${side}»: ${r.error}` })
    if (r.decimal === undefined) return calcResult('', { error: `«${side}» no da un número.` })
    values.push(r.decimal)
    shown.push(r.text)
  }
  let holds = true
  chain.ops.forEach((op, k) => {
    const a = values[k]
    const b = values[k + 1]
    // solo absorbe el error de redondeo (sin(π/4) frente a √2/2); 0 < 1e-9 sigue siendo cierto
    const close = Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) + 1e-14
    switch (op) {
      case '<': holds = holds && a < b && !close; break
      case '>': holds = holds && a > b && !close; break
      case '<=':
      case '≤': holds = holds && (a < b || close); break
      case '>=':
      case '≥': holds = holds && (a > b || close); break
      case '!=':
      case '≠': holds = holds && !close; break
      default: holds = holds && close // =, ==, ≈
    }
  })
  const text = (holds ? 'true' : 'false') + '  (' + chain.operands.map((o, i) => `${o} → ${shown[i]}`).join('; ') + ')'
  return calcResult(text, { decimal: holds ? 1 : 0 })
}
