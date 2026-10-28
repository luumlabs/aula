import { E, exprEquals, treeDepth, type Expr } from '../core/expr'
import { FunctionTable, specAccepts, specAllowsMultipleArgs, type FunctionSpec } from '../core/functions'
import { tr } from '../core/i18n'
import { charCount, trimWS } from '../core/text'
import { MathError } from '../core/types'
import { LIST_FUNCTIONS } from '../eval/stat-tables'
import { Fraction } from '../numbers/fraction'
import { GreekLetters } from './greek'
import { Lexer, swiftDouble, type NumberLiteral, type Token } from './lexer'
import { MAX_EXPRESSION_LENGTH, normalizeText, type NormalizedText } from './normalizer'
import { defaultParseOptions, type ParseOptions } from './options'

/** Resultado detallado de analizar un texto. */
export interface ParseResult {
  expr: Expr
  /** Avisos de interpretación («Entendí 1/2x como 1/(2x) …»), en el orden en que aparecen. */
  notes: string[]
  /** Texto normalizado (Unicode → ASCII) que se analizó. */
  normalized: string
}

const MAX_NESTING = 64
const MAX_TREE_DEPTH = 120

function opts(o?: Partial<ParseOptions> | ParseOptions): ParseOptions {
  return o ? defaultParseOptions(o) : defaultParseOptions()
}

/**
 * Analizador de expresiones matemáticas escritas por una persona.
 *
 * Precedencia (de mayor a menor): postfijos `!` `%` `°` · `^` (asociativo por la derecha) · signo unario ·
 * multiplicación implícita · `*` `/` `mod` · `+` `-`.
 * La multiplicación implícita liga MÁS que la división: `1/2x` = `1/(2x)`.
 */
export const MathParser = {
  /** Analiza una expresión. Lanza `MathError` (con un mensaje para el estudiante y la posición) si no es válida. */
  parse(text: string, options?: Partial<ParseOptions>): Expr {
    return MathParser.parseDetailed(text, options).expr
  },

  /** Analiza una ecuación `izquierda = derecha` (un solo signo `=`). */
  parseEquation(text: string, options?: Partial<ParseOptions>): { lhs: Expr; rhs: Expr } {
    const o = opts(options)
    const { norm, tokens } = MathParser.tokenize(text, o)
    let depth = 0
    let splitIndex: number | null = null
    tokens.forEach((t, idx) => {
      const k = t.kind
      if (k.t === 'op' && '([{'.includes(k.c)) depth += 1
      else if (k.t === 'op' && ')]}'.includes(k.c)) depth -= 1
      else if (k.t === 'relation' && depth === 0) {
        if (k.r === '=' || k.r === '==') {
          if (splitIndex !== null) throw new MathError('syntax', tr('Una ecuación lleva un solo signo «=»'), t.start)
          splitIndex = idx
        } else {
          throw new MathError('syntax', tr('Eso es una desigualdad; aquí se espera una ecuación con «=»'), t.start)
        }
      }
    })
    if (splitIndex === null) throw new MathError('syntax', tr('Falta el signo «=» de la ecuación'), norm.originalLength)
    const k: number = splitIndex
    const left = parseTokens(tokens.slice(0, k), norm, o, () => tr('Falta la expresión a la izquierda del «=»')).expr
    const right = parseTokens(tokens.slice(k + 1), norm, o, () => tr('Falta la expresión a la derecha del «=»')).expr
    return { lhs: left, rhs: right }
  },

  /**
   * Aviso para el estudiante (ya localizado) cuando la forma de escribir admite dos lecturas, o `null` si no hay
   * ambigüedad. Ejemplo: `1/2x` → «Entendí 1/2x como 1/(2x); si querías (1/2)x escribe (1/2)x».
   */
  ambiguityNote(text: string, options?: Partial<ParseOptions>): string | null {
    try {
      return MathParser.parseDetailed(text, options).notes[0] ?? null
    } catch {
      return null
    }
  },

  /**
   * Nombre de una variable tal como lo deja el analizador en `freeVariables`: los nombres de letras griegas pasan a su
   * símbolo (`theta` → `θ`, `Delta` → `Δ`, `theta_1` → `θ_1`, `tau` → `τ`); el resto no cambia (`x`, `v_0`).
   */
  canonicalVariableName(name: string): string {
    return GreekLetters.canonical(trimWS(name))
  },

  tokenize(text: string, options: ParseOptions): { norm: NormalizedText; tokens: Token[] } {
    if (charCount(text) > MAX_EXPRESSION_LENGTH || new TextEncoder().encode(text).length > 20_000) {
      throw new MathError('syntax', tr('La expresión es demasiado larga (máximo %@ caracteres)', String(MAX_EXPRESSION_LENGTH)), MAX_EXPRESSION_LENGTH)
    }
    const norm = normalizeText(text)
    const tokens = new Lexer(norm, options).tokenize()
    return { norm, tokens }
  },

  /** Análisis con avisos de ambigüedad y el texto normalizado. */
  parseDetailed(text: string, options?: Partial<ParseOptions>, nesting = 0): ParseResult {
    const o = opts(options)
    const { norm, tokens } = MathParser.tokenize(text, o)
    return parseTokens(tokens, norm, o, () => tr('Escribe una expresión'), nesting)
  },

  /** Relaciones encadenadas (`1 < x <= 5`, `a != b`): operandos y operadores en orden. */
  parseRelation(text: string, options?: Partial<ParseOptions>): { operands: Expr[]; relations: string[] } {
    const o = opts(options)
    const { norm, tokens } = MathParser.tokenize(text, o)
    let depth = 0
    const segments: Token[][] = [[]]
    const relations: string[] = []
    for (const t of tokens) {
      const k = t.kind
      if (k.t === 'end') continue
      if (k.t === 'op' && '([{'.includes(k.c)) depth += 1
      else if (k.t === 'op' && ')]}'.includes(k.c)) depth -= 1
      else if (k.t === 'relation' && depth === 0) {
        relations.push(k.r)
        segments.push([])
        continue
      }
      segments[segments.length - 1].push(t)
    }
    const operands = segments.map((seg) => parseTokens(seg, norm, o, () => tr('Falta una expresión junto al signo de comparación')).expr)
    return { operands, relations }
  },
}

/** Analiza una lista de símbolos (sin el símbolo final: se añade aquí). */
function parseTokens(tokens: Token[], norm: NormalizedText, options: ParseOptions, emptyMessage: () => string, nesting = 0): ParseResult {
  const toks = tokens.filter((t) => t.kind.t !== 'end')
  const endPos = toks.length > 0 ? toks[toks.length - 1].end + 1 : 0
  toks.push({
    kind: { t: 'end' },
    start: Math.min(endPos, norm.originalLength),
    end: Math.min(endPos, norm.originalLength),
    spaceBefore: false,
    charStart: norm.chars.length,
    charEnd: norm.chars.length,
  })
  if (toks.length === 1) throw new MathError('syntax', emptyMessage(), 0)
  const parser = new Parser(toks, norm, options)
  parser.nesting = nesting
  const expr = parser.parseTop()
  if (treeDepth(expr) > MAX_TREE_DEPTH) throw new MathError('overflow', tr('La expresión es demasiado larga o complicada'))
  return { expr, notes: parser.notes, normalized: norm.string }
}

// MARK: - Analizador recursivo

class Parser {
  pos = 0
  nesting = 0
  /** Pila de contextos: ¿estamos dentro de los argumentos de una función con varios argumentos? */
  argContexts: boolean[] = [false]
  /** Barras de valor absoluto abiertas en cada nivel de paréntesis. */
  absOpen: number[] = [0]
  notes: string[] = []
  /** Datos de la última cadena de multiplicación implícita (para el aviso de ambigüedad). */
  lastImplicitCount = 1
  lastImplicitFirstEnd = 0

  constructor(
    readonly tokens: Token[],
    readonly norm: NormalizedText,
    readonly options: ParseOptions,
  ) {}

  // MARK: Utilidades

  peek(k = 0): Token {
    return this.tokens[Math.min(this.pos + k, this.tokens.length - 1)]
  }

  advance(): void {
    if (this.pos < this.tokens.length - 1) this.pos += 1
  }

  text(t: Token): string {
    if (!(t.charStart < t.charEnd) || t.charEnd > this.norm.chars.length) return ''
    return this.norm.chars.slice(t.charStart, t.charEnd).join('')
  }

  slice(a: number, b: number): string {
    if (!(a < b) || a >= this.tokens.length) return ''
    const from = this.tokens[a].charStart
    const to = this.tokens[Math.min(b, this.tokens.length) - 1].charEnd
    if (!(from < to) || to > this.norm.chars.length) return ''
    return trimWS(this.norm.chars.slice(from, to).join(''))
  }

  enter(): void {
    this.nesting += 1
    if (this.nesting > MAX_NESTING) {
      throw new MathError('overflow', tr('La expresión tiene demasiados niveles anidados'), this.peek().start)
    }
  }

  leave(): void {
    this.nesting -= 1
  }

  isOp(c: string, k = 0): boolean {
    const kind = this.peek(k).kind
    return kind.t === 'op' && kind.c === c
  }

  isOpenBracket(t: Token): boolean {
    return t.kind.t === 'op' && (t.kind.c === '(' || t.kind.c === '[' || t.kind.c === '{')
  }

  isCloseBracket(t: Token): boolean {
    return t.kind.t === 'op' && (t.kind.c === ')' || t.kind.c === ']' || t.kind.c === '}')
  }

  isSeparator(t: Token): boolean {
    return t.kind.t === 'op' && (t.kind.c === ',' || t.kind.c === ';')
  }

  // MARK: Gramática

  parseTop(): Expr {
    const e = this.parseExpression()
    const t = this.peek()
    if (t.kind.t === 'end') return e
    throw this.unexpected(t)
  }

  unexpected(t: Token): MathError {
    const s = this.text(t)
    const k = t.kind
    if (k.t === 'op' && (k.c === ')' || k.c === ']' || k.c === '}')) {
      return new MathError('syntax', tr('Sobra un paréntesis de cierre «%@»', k.c), t.start)
    }
    if (k.t === 'op' && (k.c === ',' || k.c === ';')) {
      return new MathError('syntax', tr('Sobra una coma o punto y coma: aquí no se admiten listas'), t.start)
    }
    if (k.t === 'relation') {
      const msg = k.r === '=' || k.r === '=='
        ? tr('Hay un «=» donde no corresponde: aquí se espera solo una expresión')
        : tr('Hay una desigualdad («%@») donde no corresponde: aquí se espera solo una expresión', s)
      return new MathError('syntax', msg, t.start)
    }
    if (k.t === 'op' && k.c === '|') return new MathError('syntax', tr('Sobra una barra de valor absoluto «|»'), t.start)
    return new MathError('syntax', tr('No entiendo «%@» en este lugar', s), t.start)
  }

  parseExpression(): Expr {
    let left = this.parseMulDiv()
    for (;;) {
      const k = this.peek().kind
      if (k.t === 'op' && (k.c === '+' || k.c === '-')) {
        this.advance()
        const right = this.parseMulDiv()
        left = E.binary(k.c === '+' ? 'add' : 'sub', left, right)
      } else break
    }
    return left
  }

  parseMulDiv(): Expr {
    const leftStart = this.pos
    let left = this.parseUnaryTerm()
    for (;;) {
      const k = this.peek().kind
      if (k.t === 'op' && k.c === '*') {
        this.advance()
        left = E.binary('mul', left, this.parseUnaryTerm())
      } else if (k.t === 'op' && k.c === '/') {
        const slashPos = this.pos
        this.advance()
        const denomStart = this.pos
        this.lastImplicitCount = 1
        const right = this.parseUnaryTerm()
        if (this.lastImplicitCount >= 2) this.recordAmbiguity(leftStart, slashPos, denomStart, this.pos, this.lastImplicitFirstEnd)
        left = E.binary('div', left, right)
      } else if (k.t === 'word' && k.w === 'mod') {
        this.advance()
        left = E.binary('mod', left, this.parseUnaryTerm())
      } else if (k.t === 'op' && k.c === '%' && !this.options.percent) {
        this.advance()
        left = E.binary('mod', left, this.parseUnaryTerm())
      } else {
        return left
      }
    }
  }

  recordAmbiguity(leftStart: number, slash: number, denomStart: number, denomEnd: number, firstEnd: number): void {
    const numerator = this.slice(leftStart, slash)
    const denominator = this.slice(denomStart, denomEnd)
    const first = this.slice(denomStart, firstEnd)
    const rest = this.slice(firstEnd, denomEnd)
    if (numerator === '' || denominator === '' || first === '' || rest === '') return
    const written = `${numerator}/${denominator}`
    const understood = `${numerator}/(${denominator})`
    const intended = `(${numerator}/${first})${rest}`
    const note = tr('Entendí %@ como %@; si querías %@ escribe %@', written, understood, intended, intended)
    if (!this.notes.includes(note)) this.notes.push(note)
  }

  /**
   * `log(a, b)` es el logaritmo en base `a` de `b` (como GeoGebra o Wolfram), pero Python, Excel o la TI-Nspire usan
   * `log(x, base)`: con dos números se avisa de cómo se entendió y de cómo escribir la otra lectura (`log_b(a)`).
   */
  noteLogArguments(args: Expr[]): void {
    const a0 = args[0]
    const a1 = args[1]
    if (a0.type !== 'number' || a1.type !== 'number') return
    const b = a0.value
    const x = a1.value
    if (!b.isInteger || !x.isInteger || b.equals(x)) return
    const base = String(b.num)
    const argument = String(x.num)
    const note = tr(
      'Entendí log(%@, %@) como el logaritmo en base %@ de %@; si querías el logaritmo de %@ en base %@, escribe log_%@(%@)',
      base, argument, base, argument, base, argument, argument, base,
    )
    if (!this.notes.includes(note)) this.notes.push(note)
  }

  parseUnaryTerm(): Expr {
    const k = this.peek().kind
    if (k.t === 'op' && (k.c === '-' || k.c === '+')) {
      this.enter()
      try {
        this.advance()
        const operand = this.parseUnaryTerm()
        return k.c === '-' ? E.unary('neg', operand) : operand
      } finally {
        this.leave()
      }
    }
    return this.parseImplicit()
  }

  /**
   * ¿El siguiente símbolo empieza un factor pegado al anterior (multiplicación implícita)?
   * Lanza un error claro si es un número pegado a otro factor.
   */
  startsImplicitFactor(allowFunctions: boolean): boolean {
    const t = this.peek()
    const k = t.kind
    switch (k.t) {
      case 'number': {
        const prev = this.tokens[Math.max(this.pos - 1, 0)]
        // 2!4! es (2!)(4!): tras un factorial no hay riesgo de confundir dos números
        if (prev.kind.t === 'op' && prev.kind.c === '!') return true
        const here = this.text(t)
        const before = this.text(prev)
        let message: string
        const pk = prev.kind
        if (pk.t === 'ident' && !t.spaceBefore) {
          // «x1», «v0»: casi siempre es un subíndice
          message = tr('Falta un operador antes de «%@»: para un subíndice escribe «%@»; para multiplicar, «%@»', here, `${before}_${here}`, `${before}*${here}`)
        } else if (pk.t === 'number' || pk.t === 'ident' || pk.t === 'constant') {
          message = tr('Falta un operador antes de «%@»: escribe «%@» o usa paréntesis', here, `${before}*${here}`)
        } else if (pk.t === 'op' && (pk.c === ')' || pk.c === ']' || pk.c === '}')) {
          message = tr('Falta un operador antes de «%@»: escribe «*» entre los dos factores', here)
        } else {
          message = tr('Falta un operador antes de «%@»', here)
        }
        throw new MathError('syntax', message, t.start)
      }
      case 'ident':
      case 'constant':
        return true
      case 'function':
      case 'logBase':
      case 'unknownFunction':
        return allowFunctions
      case 'op':
        if (k.c === '(' || k.c === '[' || k.c === '{') return true
        if (k.c === '|') return (this.absOpen[this.absOpen.length - 1] ?? 0) === 0
        return false
      default:
        return false
    }
  }

  parseImplicit(): Expr {
    let left = this.parsePower()
    let count = 1
    const firstEnd = this.pos
    while (this.startsImplicitFactor(true)) {
      if (!this.options.implicitMultiplication) {
        const t = this.peek()
        throw new MathError('syntax', tr('Falta el operador «*» antes de «%@»', this.text(t)), t.start)
      }
      left = E.binary('mul', left, this.parsePower())
      count += 1
    }
    this.lastImplicitCount = count
    this.lastImplicitFirstEnd = firstEnd
    return left
  }

  parsePower(): Expr {
    const base = this.parsePostfix()
    if (this.isOp('^')) {
      this.advance()
      return E.binary('pow', base, this.parseExponent())
    }
    return base
  }

  parseExponent(): Expr {
    this.enter()
    try {
      const k = this.peek().kind
      if (k.t === 'op' && (k.c === '-' || k.c === '+')) {
        this.advance()
        const e = this.parseExponent()
        return k.c === '-' ? E.unary('neg', e) : e
      }
      return this.parsePower()
    } finally {
      this.leave()
    }
  }

  parsePostfix(): Expr {
    let e = this.parseAtom()
    for (;;) {
      const t = this.peek()
      const k = t.kind
      if (k.t !== 'op') break
      if (k.c === '!') {
        this.advance()
        e = E.unary('factorial', e)
      } else if (k.c === '%' && this.options.percent) {
        this.advance()
        e = E.unary('percent', e)
      } else if (k.c === '°') {
        if (!this.options.degreeSymbol) {
          throw new MathError('syntax', tr('El símbolo de grados «°» no está permitido aquí'), t.start)
        }
        this.advance()
        e = E.unary('degree', e)
      } else break
    }
    return e
  }

  // MARK: Átomos

  parseAtom(): Expr {
    const t = this.peek()
    const k = t.kind
    switch (k.t) {
      case 'number':
        this.advance()
        return this.numberExpr(k.lit, t)
      case 'constant':
        this.advance()
        return E.constant(k.c)
      case 'ident':
        this.advance()
        return E.variable(k.name)
      case 'function':
        this.advance()
        return this.parseFunction(k.name, t)
      case 'logBase':
        this.advance()
        return this.parseLogBase(k.base, t)
      case 'word':
        if (k.w === 'mod') {
          if (this.isOpenBracket(this.peek(1))) {
            this.advance()
            return this.parseFunction('mod', t)
          }
          throw new MathError('syntax', tr('«mod» necesita un número a cada lado (por ejemplo 7 mod 3)'), t.start)
        }
        throw this.unexpected(t)
      case 'unknownFunction': {
        const msg = k.suggestion !== null
          ? tr('No conozco la función «%@». ¿Quisiste decir «%@»?', k.name, k.suggestion)
          : tr('No conozco la función «%@»', k.name)
        throw new MathError('unknownFunction', msg, t.start)
      }
      case 'op':
        if (k.c === '(' || k.c === '[' || k.c === '{') return this.parseGroup(t)
        if (k.c === '|') return this.parseAbsBars(t)
        if (this.pos > 0) throw new MathError('syntax', tr('Falta un número o expresión antes de «%@»', k.c), t.start)
        throw new MathError('syntax', tr('La expresión no puede empezar con «%@»', k.c), t.start)
      case 'end': {
        const prev = this.pos > 0 ? this.tokens[this.pos - 1] : t
        if (this.pos === 0) throw new MathError('syntax', tr('Escribe una expresión'), 0)
        throw new MathError('syntax', tr('La expresión está incompleta: falta algo después de «%@»', this.text(prev)), t.start)
      }
      case 'relation':
        throw this.unexpected(t)
    }
  }

  numberExpr(lit: NumberLiteral, t: Token): Expr {
    let literal = lit
    // Coma decimal: "1,5" (pegada, entre cifras) salvo dentro de los argumentos de una función con varios argumentos.
    if (this.options.decimalComma && lit.isPlainInteger && !(this.argContexts[this.argContexts.length - 1] ?? false) && this.isOp(',') && !this.peek().spaceBefore) {
      const next = this.peek(1)
      if (next.kind.t === 'number') {
        const frac = next.kind.lit
        if (!frac.text.includes('.') && !frac.text.includes(' ') && !frac.text.includes('/') && !next.spaceBefore) {
          this.advance()
          this.advance()
          const combined = lit.text + '.' + frac.text
          const exact = Fraction.parseDecimal(combined)
          const value = exact ? exact.doubleValue : swiftDouble(combined)
          literal = { fraction: exact, double: value, text: combined, isPlainInteger: false }
        }
      }
    }
    if (literal.fraction) return E.num(literal.fraction)
    if (!Number.isFinite(literal.double)) throw new MathError('overflow', tr('El número es demasiado grande'), t.start)
    return E.real(literal.double)
  }

  parseGroup(open: Token): Expr {
    this.enter()
    try {
      this.advance()
      this.argContexts.push(false)
      this.absOpen.push(0)
      try {
        const inner = this.parseExpression()
        const t = this.peek()
        if (!this.isCloseBracket(t)) {
          if (this.isSeparator(t)) throw this.unexpected(t)
          throw new MathError('syntax', tr('Falta cerrar un paréntesis'), open.start)
        }
        this.advance()
        return inner
      } finally {
        this.argContexts.pop()
        this.absOpen.pop()
      }
    } finally {
      this.leave()
    }
  }

  parseAbsBars(open: Token): Expr {
    this.enter()
    try {
      this.advance()
      this.absOpen[this.absOpen.length - 1] += 1
      const inner = this.parseExpression()
      if (!this.isOp('|')) throw new MathError('syntax', tr('Falta cerrar el valor absoluto con otra barra «|»'), open.start)
      this.advance()
      this.absOpen[this.absOpen.length - 1] -= 1
      return E.call('abs', [inner])
    } finally {
      this.leave()
    }
  }

  // MARK: Funciones

  /** `sin^-1` / `sin^(-1)` / `sin^{-1}` justo después del nombre: ¿función inversa? */
  consumeMinusOne(): boolean {
    const p1 = this.peek(1).kind
    // -1
    if (this.isOp('-') && p1.t === 'number' && p1.lit.text === '1') {
      this.advance()
      this.advance()
      return true
    }
    // (-1) / {-1} / [-1]
    const p2 = this.peek(2).kind
    if (this.isOpenBracket(this.peek()) && this.isOp('-', 1) && p2.t === 'number' && p2.lit.text === '1' && this.isCloseBracket(this.peek(3))) {
      this.advance()
      this.advance()
      this.advance()
      this.advance()
      return true
    }
    return false
  }

  parseFunction(name: string, token: Token): Expr {
    this.enter()
    try {
      let funcName = name
      let outerPower: Expr | null = null
      if (this.isOp('^')) {
        this.advance()
        const inverse = FunctionTable.invertible.get(name)
        if (inverse !== undefined && this.consumeMinusOne()) funcName = inverse
        else outerPower = this.parseFunctionExponent()
      }
      const call = this.parseFunctionArguments(funcName, token)
      if (outerPower) return E.binary('pow', call, outerPower)
      return call
    } finally {
      this.leave()
    }
  }

  /** Exponente colocado entre el nombre y el argumento: `sin^2(x)`, `sin^2 x`. */
  parseFunctionExponent(): Expr {
    const k = this.peek().kind
    if (k.t === 'op' && (k.c === '-' || k.c === '+')) {
      this.enter()
      try {
        this.advance()
        const e = this.parseFunctionExponent()
        return k.c === '-' ? E.unary('neg', e) : e
      } finally {
        this.leave()
      }
    }
    return this.parsePostfix()
  }

  parseFunctionArguments(name: string, token: Token): Expr {
    const spec = FunctionTable.specs.get(name)
    if (!spec) throw new MathError('unknownFunction', tr('No conozco la función «%@»', name), token.start)
    const next = this.peek()
    // Lista de datos entre llaves o corchetes, como en las calculadoras: mean({1, 2, 3}), stdev([4; 5,5; 6])
    if (LIST_FUNCTIONS.has(name) && this.isOp('(') && (this.isOp('{', 1) || this.isOp('[', 1))) {
      this.advance()
      const args = this.parseArgumentList(spec, this.peek())
      if (!this.isOp(')')) {
        throw new MathError('syntax', tr('Después de la lista de datos falta cerrar el paréntesis de «%@»', this.text(token)), next.start)
      }
      this.advance()
      if (!specAccepts(spec, args.length)) throw this.arityError(spec, args.length, token)
      return E.call(name, args)
    }
    if (this.isOpenBracket(next)) {
      const args = this.parseArgumentList(spec, next)
      if (!specAccepts(spec, args.length)) throw this.arityError(spec, args.length, token)
      if (name === 'log' && args.length === 2) this.noteLogArguments(args)
      return E.call(name, args)
    }
    // Sin paréntesis: solo para funciones de un argumento.
    if (spec.minArgs > 1) {
      throw new MathError('syntax', tr('«%@» necesita paréntesis: por ejemplo %@', this.text(token), this.example(spec)), token.start)
    }
    if (next.kind.t === 'end') {
      throw new MathError('syntax', tr('Falta el argumento de «%@»: por ejemplo %@', this.text(token), this.example(spec)), token.start)
    }
    const arg = FunctionTable.tightArgument.has(name) ? this.parseTightArgument() : this.parseLooseArgument()
    return E.call(name, [arg])
  }

  /**
   * Ejemplo de uso para los mensajes. Los nombres de función y la sintaxis no se traducen (son lo que hay que escribir);
   * solo las palabras de enlace («o», «por ejemplo») y la abreviatura «gl» (grados de libertad).
   */
  example(spec: FunctionSpec): string {
    const name = spec.name
    switch (name) {
      case 'root': return 'root(3, x)'
      case 'atan2': return 'atan2(y, x)'
      case 'nCr': case 'nPr': case 'gcd': case 'lcm': case 'min': case 'max': case 'mod': case 'pow': return `${name}(a, b)`
      case 'sum': case 'mean': case 'median': case 'mode': case 'var': case 'stdev': case 'pvar': case 'pstdev': return `${name}(2, 4, 4, 5)`
      case 'normalcdf': return tr('normalcdf(-1.96, 1.96) o normalcdf(a, b, μ, σ)')
      case 'normalpdf': return 'normalpdf(x, μ, σ)'
      case 'invnorm': return tr('invnorm(0.975) o invnorm(p, μ, σ)')
      case 'zscore': return 'zscore(x, μ, σ)'
      case 'binompdf': case 'binomcdf': return tr('%@(n, p, k), por ejemplo %@(10, 0.5, 3)', name, name)
      case 'poissonpdf': case 'poissoncdf': return tr('%@(λ, k), por ejemplo %@(3, 2)', name, name)
      case 'tcdf': return tr('tcdf(a, b, gl), por ejemplo tcdf(-2, 2, 10)')
      case 'invt': return tr('invt(p, gl), por ejemplo invt(0.975, 10)')
      case 'chi2cdf': return tr('chi2cdf(a, b, gl), por ejemplo chi2cdf(0, 3.84, 1)')
      case 'chi2pdf': return tr('chi2pdf(x, gl)')
      default: return `${name}(x)`
    }
  }

  arityError(spec: FunctionSpec, count: number, token: Token): MathError {
    const name = spec.name
    const lo = spec.minArgs
    const usage = this.example(spec)
    let message: string
    if (spec.maxArgs !== null && lo === spec.maxArgs) {
      const hi = spec.maxArgs
      message = hi === 1
        ? tr('«%@» necesita 1 argumento y recibió %lld: por ejemplo %@', name, count, usage)
        : tr('«%@» necesita %lld argumentos y recibió %lld: por ejemplo %@', name, hi, count, usage)
    } else if (spec.maxArgs !== null) {
      message = tr('«%@» necesita entre %lld y %lld argumentos y recibió %lld: por ejemplo %@', name, lo, spec.maxArgs, count, usage)
    } else {
      message = lo === 1
        ? tr('«%@» necesita al menos 1 argumento y recibió %lld: por ejemplo %@', name, count, usage)
        : tr('«%@» necesita al menos %lld argumentos y recibió %lld: por ejemplo %@', name, lo, count, usage)
    }
    return new MathError('syntax', message, token.start)
  }

  /** ¿Hay un `;` al nivel superior entre el paréntesis que se abre en `index` y su cierre? (estilo `max(1,5; 2,5)`) */
  hasTopLevelSemicolon(index: number): boolean {
    let depth = 0
    for (let k = index + 1; k < this.tokens.length; k++) {
      const kind = this.tokens[k].kind
      if (kind.t !== 'op') continue
      if ('([{'.includes(kind.c)) depth += 1
      else if (')]}'.includes(kind.c)) {
        if (depth === 0) return false
        depth -= 1
      } else if (kind.c === ';' && depth === 0) return true
    }
    return false
  }

  /** Argumentos entre paréntesis separados por `,` o `;`. */
  parseArgumentList(spec: FunctionSpec, open: Token): Expr[] {
    // con punto y coma como separador, las comas son decimales
    const semicolonMode = this.hasTopLevelSemicolon(this.pos)
    this.advance()
    this.argContexts.push(specAllowsMultipleArgs(spec) && !semicolonMode)
    this.absOpen.push(0)
    try {
      const args: Expr[] = []
      if (this.isCloseBracket(this.peek())) {
        throw new MathError('syntax', tr('Falta el argumento dentro de los paréntesis de «%@»', spec.name), open.start)
      }
      for (;;) {
        args.push(this.parseExpression())
        if (this.isSeparator(this.peek()) && !(semicolonMode && this.isOp(','))) {
          if (!specAllowsMultipleArgs(spec) || (spec.maxArgs !== null && args.length >= spec.maxArgs)) {
            throw new MathError('syntax', tr('«%@» recibe demasiados argumentos', spec.name), this.peek().start)
          }
          this.advance()
          continue
        }
        break
      }
      if (!this.isCloseBracket(this.peek())) throw new MathError('syntax', tr('Falta cerrar un paréntesis'), open.start)
      this.advance()
      return args
    } finally {
      this.argContexts.pop()
      this.absOpen.pop()
    }
  }

  /** Argumento «ajustado» (raíces): un solo factor con su potencia: `sqrt 2 x` = √2·x, `sqrt x^2` = √(x²). */
  parseTightArgument(): Expr {
    const k = this.peek().kind
    if (k.t === 'op' && (k.c === '-' || k.c === '+')) {
      this.enter()
      try {
        this.advance()
        const e = this.parseTightArgument()
        return k.c === '-' ? E.unary('neg', e) : e
      } finally {
        this.leave()
      }
    }
    return this.parsePower()
  }

  /**
   * Argumento «amplio» (trigonometría, logaritmos…): producto de factores pegados, que se detiene antes de otra función:
   * `sin 2x` = sin(2x), `sin x cos x` = sin(x)·cos(x), `sin x^2` = sin(x²).
   */
  parseLooseArgument(): Expr {
    const k = this.peek().kind
    if (k.t === 'op' && (k.c === '-' || k.c === '+')) {
      this.enter()
      try {
        this.advance()
        const e = this.parseLooseArgument()
        return k.c === '-' ? E.unary('neg', e) : e
      } finally {
        this.leave()
      }
    }
    let result = this.parsePower()
    while (this.startsImplicitFactor(false)) result = E.binary('mul', result, this.parsePower())
    return result
  }

  /** `log_b(x)`, `log_{b}(x)`, `log2(x)`. */
  parseLogBase(baseText: string, token: Token): Expr {
    this.enter()
    try {
      let base: Expr
      try {
        base = MathParser.parseDetailed(baseText, { ...this.options, decimalComma: true }, this.nesting).expr
      } catch (e) {
        if (e instanceof MathError) throw new MathError('syntax', tr('La base del logaritmo no es válida (%@)', e.message), token.start)
        throw e
      }
      let arg: Expr
      const next = this.peek()
      const logSpec: FunctionSpec = { name: 'log', minArgs: 1, maxArgs: 1 }
      if (this.isOpenBracket(next)) {
        const args = this.parseArgumentList(logSpec, next)
        if (args.length !== 1) throw this.arityError(logSpec, args.length, token)
        arg = args[0]
      } else {
        if (next.kind.t === 'end') throw new MathError('syntax', tr('Falta el argumento del logaritmo'), token.start)
        arg = this.parseLooseArgument()
      }
      if (exprEquals(base, E.int(10))) return E.call('log', [arg])
      if (exprEquals(base, E.constant('e'))) return E.call('ln', [arg])
      return E.call('log', [base, arg])
    } finally {
      this.leave()
    }
  }
}
