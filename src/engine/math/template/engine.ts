import { simplify } from '../algebra/simplify'
import { E, containsNode, freeVariables, substitute, type Expr } from '../core/expr'
import { tr } from '../core/i18n'
import { chars as toChars, isLetter, isNumberChar, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MathError, MV, type MathErrorKind, type MathValue } from '../core/types'
import { evaluate as evaluateExpr, tryEvaluate } from '../eval/evaluate'
import { ValueMatch } from '../check/value-match'
import { DecimalDigits } from '../format/decimal-digits'
import { NumberFormat } from '../format/number-format'
import { Fraction } from '../numbers/fraction'
import { INT_MAX } from '../numbers/int64'
import { GreekLetters } from '../parse/greek'
import { NumberInput } from '../parse/number-input'
import type { ParseOptions } from '../parse/options'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { DeterministicRNG, type Seed } from '../random/rng'
import { makeTemplateContext, type TemplateContext, type TemplateVar } from './types'

/** En plantillas las palabras de varias letras son variables (`total`), `%` es el módulo y no hay porcentajes. */
export const TEMPLATE_PARSE_OPTIONS: Partial<ParseOptions> = { wordVariables: true, percent: false }

const RESERVED_NAMES = new Set(['e', 'pi', 'inf', 'infinity', 'mod'])

function templateError(message: string, kind: MathErrorKind = 'domain'): MathError {
  return new MathError(kind, message)
}

/**
 * Generación determinista de ejercicios paramétricos.
 *
 * El algoritmo de muestreo es estable: la misma semilla y las mismas variables dan siempre el mismo resultado
 * (el mismo que en la app Swift).
 */
export const TemplateEngine = {
  templateOptions: TEMPLATE_PARSE_OPTIONS,

  // MARK: Muestreo

  /**
   * Muestrea las variables en orden, reintentando hasta cumplir todas las `constraints`
   * (`"a != b"`, `"gcd(a,b) == 1"`, `"a*b < 100"`, `"a > 0 && b > 0"`). Lanza `MathError` si no lo logra en `maxTries`.
   */
  sample(vars: readonly TemplateVar[], constraints: readonly string[], seed: Seed, maxTries = 400): TemplateContext {
    // Nombres válidos y únicos
    const seen = new Set<string>()
    for (const v of vars) {
      const name = v.name
      const cs = toChars(name)
      if (cs.length === 0 || !(isLetter(cs[0]) || cs[0] === '_') || !cs.every((c) => isLetter(c) || isNumberChar(c) || c === '_')) {
        throw templateError(tr('El nombre de variable «%@» no es válido: usa letras, números y guion bajo, sin empezar por número.', name), 'syntax')
      }
      if (RESERVED_NAMES.has(name.toLowerCase())) {
        throw templateError(tr('El nombre «%@» está reservado (es una constante o un operador): elige otro nombre de variable.', name), 'syntax')
      }
      if (seen.has(name)) throw templateError(tr('La variable «%@» está definida dos veces.', name), 'syntax')
      seen.add(name)
    }
    // Restricciones: se comprueba la sintaxis antes de muestrear
    const compiled: Condition[] = []
    for (const c of constraints) {
      try {
        compiled.push(parseCondition(c))
      } catch (e) {
        if (e instanceof MathError) throw new MathError(e.kind, tr('En la restricción «%@»: %@', c, e.message), e.position)
        throw e
      }
    }

    const rng = new DeterministicRNG(seed)
    const tries = Math.max(maxTries, 1)
    for (let i = 0; i < tries; i++) {
      const ctx = makeTemplateContext()
      for (const v of vars) sampleOne(v, ctx, rng)
      if (compiled.every((c) => conditionHolds(c, ctx))) return ctx
    }
    const list = constraints.join('; ')
    throw templateError(tr('No se pudo cumplir las restricciones (%@) tras %lld intentos: revisa que los rangos de las variables las permitan.', list, tries))
  },

  // MARK: Evaluación

  /** Evalúa una expresión usando los valores del contexto. */
  evaluate(expression: string, context: TemplateContext): MathValue {
    const e = MathParser.parse(expression, TEMPLATE_PARSE_OPTIONS)
    return evaluateInContext(e, context)
  },

  /** Evalúa una expresión ya analizada usando los valores del contexto. */
  evaluateExpr(e: Expr, context: TemplateContext): MathValue {
    return evaluateInContext(e, context)
  },

  // MARK: Sustitución de {{...}}

  /**
   * Sustituye `{{...}}` en un texto. Formatos:
   * `{{expr}}` valor limpio · `{{tex:expr}}` LaTeX · `{{frac:expr}}` `\frac{p}{q}` · `{{signed:expr}}` `+3`/`-3` ·
   * `{{dec(2):expr}}` 2 decimales · `{{sig(3):expr}}` cifras significativas · `{{sci:expr}}` científica TeX ·
   * `{{pct:expr}}` porcentaje de una proporción: multiplica por 100 (`p` = 3/8 → `37.5\%`; si la expresión ya es
   * `algo*100` o `100*algo`, no se vuelve a multiplicar) · `{{abs:expr}}` valor absoluto · `{{str:var}}` texto literal.
   * Para escribir llaves seguidas de una plantilla, p. ej. `x^{{{n}}}` → `x^{3}`, las llaves de más se dejan tal cual.
   * Lanza `MathError` si una directiva no se puede rellenar.
   */
  render(text: string, context: TemplateContext): string {
    const cs = toChars(text)
    let out = ''
    let i = 0
    while (i < cs.length) {
      const c = cs[i]
      if (c !== '{') {
        out += c
        i += 1
        continue
      }
      let j = i
      while (j < cs.length && cs[j] === '{') j += 1
      const run = j - i
      if (run < 2) {
        out += c
        i = j
        continue
      }
      out += '{'.repeat(run - 2)
      // buscar el cierre "}}"
      let close = j
      let found = false
      while (close + 1 < cs.length) {
        if (cs[close] === '}' && cs[close + 1] === '}') {
          found = true
          break
        }
        close += 1
      }
      if (!found) {
        const snippet = cs.slice(i + run - 2, i + run - 2 + 40).join('')
        throw new MathError('syntax', tr('Falta cerrar «}}» en la plantilla: «%@»', snippet))
      }
      const content = cs.slice(j, close).join('')
      out += renderDirective(content, context)
      let k = close
      while (k < cs.length && cs[k] === '}') k += 1
      out += '}'.repeat(k - close - 2)
      i = k
    }
    return out
  },
}

function sampleOne(v: TemplateVar, ctx: TemplateContext, rng: DeterministicRNG): void {
  const name = v.name
  const kind = v.kind
  switch (kind.type) {
    case 'int': {
      const lo = Math.trunc(kind.min)
      const hi = Math.trunc(kind.max)
      if (!(lo <= hi)) {
        throw templateError(tr('La variable «%@» tiene el rango al revés (min %@ > max %@).', name, String(lo), String(hi)))
      }
      const size = hi - lo
      if (!Number.isFinite(size) || !(size < 5_000_000) || !Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) {
        throw templateError(tr('El rango de la variable «%@» es demasiado grande.', name))
      }
      const excluded = new Set(kind.exclude.filter((x) => x >= lo && x <= hi))
      const total = size + 1
      if (!(total > excluded.size)) throw templateError(tr('La variable «%@» no tiene ningún valor posible: el rango excluye todo.', name))
      let x: number
      if (total <= 10_000) {
        // rangos normales: lista explícita (mismo resultado que siempre para cada semilla)
        const candidates: number[] = []
        for (let k = lo; k <= hi; k++) if (!excluded.has(k)) candidates.push(k)
        x = candidates[rng.int(0, candidates.length - 1)]
      } else {
        // rangos enormes: sin construir millones de candidatos en cada intento (muestreo por rechazo, acotado)
        let pick = lo + rng.int(0, total - 1)
        let tries = 0
        while (excluded.has(pick) && tries < 1000) {
          pick = lo + rng.int(0, total - 1)
          tries += 1
        }
        while (excluded.has(pick)) pick = pick === hi ? lo : pick + 1
        x = pick
      }
      ctx.values[name] = MV.int(x)
      ctx.strings[name] = String(x)
      return
    }
    case 'real': {
      const lo = kind.min
      const hi = kind.max
      if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi)) throw templateError(tr('La variable «%@» tiene un rango real no válido.', name))
      const d = Math.min(Math.max(Math.trunc(kind.decimals), 0), 12)
      const scale = Math.pow(10, d)
      const lowInt = Math.ceil(lo * scale - 1e-9)
      const highInt = Math.floor(hi * scale + 1e-9)
      if (!(lowInt <= highInt && Math.abs(lowInt) < 9e15 && Math.abs(highInt) < 9e15)) {
        const from = NumberInput.shown(lo)
        const to = NumberInput.shown(hi)
        throw templateError(tr('La variable «%@» no tiene ningún valor posible con %lld decimales entre %@ y %@.', name, d, from, to))
      }
      const n = rng.int(lowInt, highInt)
      const denominator = Math.round(scale)
      const f = Fraction.of(n, denominator)
      if (f) {
        ctx.values[name] = MV.rational(f)
        ctx.strings[name] = NumberFormat.plain(MV.rational(f))
      } else {
        const x = n / scale
        ctx.values[name] = MV.real(x)
        ctx.strings[name] = NumberFormat.decimal(x)
      }
      return
    }
    case 'pick': {
      const options = kind.values
      if (options.length === 0) throw templateError(tr('La variable «%@» no tiene opciones para elegir.', name))
      const literal = options[rng.int(0, options.length - 1)]
      ctx.strings[name] = literal
      const f = Fraction.parse(literal)
      if (f) {
        ctx.values[name] = MV.rational(f)
      } else {
        try {
          const e = MathParser.parse(literal, TEMPLATE_PARSE_OPTIONS)
          if (freeVariables(e).size === 0) {
            const value = tryEvaluate(e)
            if (value) ctx.values[name] = value
          }
        } catch {
          // texto literal
        }
      }
      return
    }
    case 'fraction': {
      const lowDen = Math.max(Math.trunc(kind.minDen), 1)
      const highDen = Math.max(Math.trunc(kind.maxDen), lowDen)
      const highNum = Math.max(Math.trunc(kind.maxNum), 1)
      let result: Fraction | null = null
      for (let i = 0; i < 200; i++) {
        const den = rng.int(lowDen, highDen)
        const num = rng.int(1, highNum)
        if (kind.proper && num >= den) continue
        const f = Fraction.of(num, den)
        if (!f || f.den < BigInt(lowDen)) continue
        result = f
        break
      }
      if (!result) throw templateError(tr('La variable «%@» no encontró ninguna fracción con esos límites.', name))
      ctx.values[name] = MV.rational(result)
      ctx.strings[name] = result.plain
      return
    }
    case 'expr': {
      const value = TemplateEngine.evaluate(kind.expr, ctx)
      ctx.values[name] = value
      ctx.strings[name] = NumberFormat.plain(value)
      return
    }
  }
}

function evaluateInContext(e: Expr, context: TemplateContext): MathValue {
  // las letras griegas valen con su nombre o con su símbolo (theta ↔ θ)
  for (const name of sortedStrings(freeVariables(e))) {
    if (GreekLetters.lookup(name, context.values) !== undefined) continue
    const text = GreekLetters.lookup(name, context.strings)
    if (text !== undefined) {
      throw templateError(tr('«%@» es un texto (%@), no un número: no se puede usar en una cuenta.', name, text), 'unknownVariable')
    }
    const known = sortedStrings(Object.keys(context.values)).join(', ')
    const message = known === ''
      ? tr('La plantilla usa «%@», pero esa variable no está definida.', name)
      : tr('La plantilla usa «%@», pero esa variable no está definida (variables: %@).', name, known)
    throw templateError(message, 'unknownVariable')
  }
  return evaluateExpr(e, context.values, 'radians')
}

const DIRECTIVE_RE = /^(tex|frac|signed|dec|sig|sci|pct|abs|str)\s*(?:\(\s*(\d+)\s*\))?\s*:\s*(.+)$/iu

function renderDirective(content: string, context: TemplateContext): string {
  const trimmed = trimWSNL(content)
  if (trimmed === '') throw new MathError('syntax', tr('Hay un «{{ }}» vacío en la plantilla.'))
  let format = 'plain'
  let argument = trimmed
  let digits = 0
  const g = DIRECTIVE_RE.exec(trimmed)
  if (g) {
    format = g[1].toLowerCase()
    const raw = g[2] ?? ''
    const big = raw === '' ? 0n : BigInt(raw)
    digits = big > INT_MAX ? 0 : Number(big)
    argument = trimWS(g[3])
    if ((format === 'dec' || format === 'sig') && raw === '') {
      throw new MathError('syntax', tr('«%@» necesita el número de cifras entre paréntesis: por ejemplo {{%@(2):x}}.', format, format))
    }
  }

  if (format === 'str') {
    const s = GreekLetters.lookup(argument, context.strings)
    if (s !== undefined) return s
    const v = GreekLetters.lookup(argument, context.values)
    if (v !== undefined) return NumberFormat.plain(v)
    throw new MathError('unknownVariable', tr('La plantilla usa «%@», pero esa variable no está definida.', argument))
  }
  // `{{u}}`, `{{f}}`: una variable sola se escribe tal como se generó (texto de un pick, fracción 1/8, decimal 5.7)
  if (format === 'plain') {
    const s = GreekLetters.lookup(argument, context.strings)
    if (s !== undefined) return s
  }

  const expr = MathParser.parse(argument, TEMPLATE_PARSE_OPTIONS)

  if (format === 'tex') {
    // variables conocidas se sustituyen; las desconocidas (p. ej. la x del álgebra) se dejan como letras
    let e = expr
    for (const name of freeVariables(expr)) {
      const v = GreekLetters.lookup(name, context.values)
      if (v === undefined) continue
      if (v.kind === 'rational') {
        const f = v.value
        e = substitute(e, name, f.isNegative ? E.neg(E.num(f.negated() ?? f)) : E.num(f))
      } else {
        const d = v.value
        e = substitute(e, name, d < 0 ? E.neg(E.real(-d)) : E.real(d))
      }
    }
    const simplified = simplify(e)
    if (freeVariables(simplified).size === 0) {
      const v = tryEvaluate(simplified)
      if (v && v.kind === 'real' && !containsExactStructure(simplified)) return NumberFormat.texNumber(MV.real(v.value))
    }
    return toLatex(simplified)
  }

  const value = evaluateInContext(expr, context)
  switch (format) {
    case 'plain':
      return NumberFormat.plain(value)
    case 'abs': {
      if (value.kind === 'rational') {
        const a = value.value.absolute()
        if (a) return NumberFormat.plain(MV.rational(a))
      }
      return NumberFormat.plain(MV.real(Math.abs(MV.double(value))))
    }
    case 'frac':
      if (value.kind === 'rational') return value.value.latex
      return NumberFormat.texNumber(value)
    case 'signed': {
      const t = NumberFormat.plain(value)
      return t.startsWith('-') ? t : '+' + t
    }
    case 'dec':
      return fixedDecimals(value, digits)
    case 'sig':
      return significantFigures(value, Math.max(digits, 1))
    case 'sci':
      return NumberFormat.scientificTeX(MV.double(value), 3)
    case 'pct': {
      // Formato porcentaje (como en las hojas de cálculo): la proporción 0.375 se escribe 37.5 %. Si la expresión ya
      // multiplica por 100 ({{pct:p*100}}), se respeta tal cual.
      if (isTimesHundred(expr)) return NumberFormat.plain(value) + '\\%'
      let percent: MathValue
      const r = value.kind === 'rational' ? value.value.multiplied(Fraction.int(100)) : null
      if (r) percent = MV.rational(r)
      else percent = MV.real(MV.double(value) * 100)
      return NumberFormat.plain(percent) + '\\%'
    }
    default:
      return NumberFormat.plain(value)
  }
}

/** `algo*100` o `100*algo` (la expresión ya está en tanto por ciento). */
function isTimesHundred(e: Expr): boolean {
  if (!(e.type === 'binary' && e.op === 'mul')) return false
  if (e.left.type === 'number' && e.left.value.isInt(100)) return true
  if (e.right.type === 'number' && e.right.value.isInt(100)) return true
  return false
}

/** ¿La expresión simplificada conserva una forma simbólica (raíz, π…) que no conviene reemplazar por un decimal? */
function containsExactStructure(e: Expr): boolean {
  return containsNode(e, (node) => node.type === 'call' || node.type === 'constant')
}

function digitsOf(value: MathValue): DecimalDigits | null {
  if (value.kind === 'rational') {
    const d = DecimalDigits.fromFraction(value.value, 30)
    if (d) return d
  }
  return DecimalDigits.fromDouble(MV.double(value))
}

function fixedDecimals(value: MathValue, places: number): string {
  const p = NumberFormat.clampDigits(places, 0)
  const d = digitsOf(value)
  if (!d) return NumberFormat.decimal(MV.double(value), p, false)
  d.roundToPlaces(p)
  return d.fixed(p, false)
}

function significantFigures(value: MathValue, figures: number): string {
  const f = NumberFormat.clampDigits(figures, 1)
  const d = digitsOf(value)
  if (!d) return NumberFormat.significant(MV.double(value), f)
  d.roundToSignificant(f)
  return d.significant(f)
}

// MARK: - Restricciones lógicas

/** Condición booleana de una plantilla: comparaciones encadenadas combinadas con `&&`, `||`, `and`, `or`, `!`. */
export type Condition =
  | { t: 'compare'; operands: Expr[]; relations: string[] }
  | { t: 'and'; items: Condition[] }
  | { t: 'or'; items: Condition[] }
  | { t: 'not'; item: Condition }
  | { t: 'truthy'; expr: Expr }

/** Analiza una restricción (`"a != b && gcd(a,b) == 1"`). Lanza `MathError` si no es válida. */
export function parseCondition(text: string): Condition {
  const t = trimWS(text)
  if (t === '') throw new MathError('syntax', tr('La restricción está vacía'))
  // o / y lógicos fuera de paréntesis
  const orParts = splitTop(t, ['||', ' or '])
  if (orParts.length > 1) return { t: 'or', items: orParts.map(parseCondition) }
  const andParts = splitTop(t, ['&&', ' and '])
  if (andParts.length > 1) return { t: 'and', items: andParts.map(parseCondition) }
  const lower = t.toLowerCase()
  if (t.startsWith('!(') || lower.startsWith('not ') || lower.startsWith('not(')) {
    const rest = t.startsWith('!') ? t.slice(1) : t.slice(3)
    return { t: 'not', item: parseCondition(rest) }
  }
  if (isWrapped(t)) return parseCondition(t.slice(1, -1))
  const rel = MathParser.parseRelation(t, TEMPLATE_PARSE_OPTIONS)
  if (rel.relations.length === 0) return { t: 'truthy', expr: rel.operands[0] }
  return { t: 'compare', operands: rel.operands, relations: rel.relations }
}

function isWrapped(t: string): boolean {
  const cs = toChars(t)
  if (cs.length < 2 || cs[0] !== '(' || cs[cs.length - 1] !== ')') return false
  let depth = 0
  for (let i = 0; i < cs.length; i++) {
    if (cs[i] === '(') depth += 1
    else if (cs[i] === ')') depth -= 1
    if (depth === 0 && i < cs.length - 1) return false
  }
  return true
}

/** Parte `s` por cualquiera de los símbolos, solo fuera de paréntesis. */
function splitTop(s: string, symbols: readonly string[]): string[] {
  const cs = toChars(s)
  const lowerChars = toChars(s.toLowerCase())
  const parts: string[] = []
  let current = ''
  let depth = 0
  let i = 0
  outer: while (i < cs.length) {
    const c = cs[i]
    if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth -= 1
    if (depth === 0) {
      for (const sym of symbols) {
        const sc = toChars(sym)
        if (i + sc.length <= lowerChars.length && sc.every((x, k) => lowerChars[i + k] === x)) {
          parts.push(current)
          current = ''
          i += sc.length
          continue outer
        }
      }
    }
    current += c
    i += 1
  }
  parts.push(current)
  return parts.map(trimWS).filter((p) => p !== '')
}

/** ¿Se cumple la condición con estos valores? (un error de evaluación cuenta como «no») */
export function conditionHolds(c: Condition, ctx: TemplateContext): boolean {
  switch (c.t) {
    case 'and':
      return c.items.every((x) => conditionHolds(x, ctx))
    case 'or':
      return c.items.some((x) => conditionHolds(x, ctx))
    case 'not':
      return !conditionHolds(c.item, ctx)
    case 'truthy': {
      try {
        return MV.double(evaluateInContext(c.expr, ctx)) !== 0
      } catch {
        return false
      }
    }
    case 'compare': {
      const values: MathValue[] = []
      for (const e of c.operands) {
        try {
          values.push(evaluateInContext(e, ctx))
        } catch {
          return false
        }
      }
      for (let k = 0; k < c.relations.length; k++) if (!compareValues(values[k], c.relations[k], values[k + 1])) return false
      return true
    }
  }
}

function compareValues(a: MathValue, relation: string, b: MathValue): boolean {
  const equal = ValueMatch.same(a, b)
  const less = (): boolean => {
    if (a.kind === 'rational' && b.kind === 'rational') return a.value.lt(b.value)
    return MV.double(a) < MV.double(b)
  }
  switch (relation) {
    case '=':
    case '==':
      return equal
    case '!=':
      return !equal
    case '<':
      return !equal && less()
    case '<=':
      return equal || less()
    case '>':
      return !equal && !less()
    case '>=':
      return equal || !less()
    default:
      return false
  }
}
