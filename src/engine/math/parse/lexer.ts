import { FunctionTable } from '../core/functions'
import { tr } from '../core/i18n'
import { foldedLower, isDigit, isLetter, isUppercase, trimWS } from '../core/text'
import { MathError, type MathConstant, type MathErrorKind } from '../core/types'
import { Fraction, vulgarFractions } from '../numbers/fraction'
import { GreekLetters } from './greek'
import type { NormalizedText } from './normalizer'
import { splitLetters, type ParseOptions } from './options'

/** Literal numérico leído del texto. */
export interface NumberLiteral {
  /** Valor exacto, si cabe en una `Fraction`. */
  fraction: Fraction | null
  /** Valor aproximado. */
  double: number
  /** Texto tal como se escribió (en ASCII). */
  text: string
  /** `true` si no lleva punto decimal ni exponente. */
  isPlainInteger: boolean
}

export type TokenKind =
  | { t: 'number'; lit: NumberLiteral }
  | { t: 'ident'; name: string }
  | { t: 'function'; name: string } // nombre canónico
  | { t: 'logBase'; base: string } // log_b( … ) / log2( … ): texto de la base
  | { t: 'constant'; c: MathConstant }
  | { t: 'op'; c: string } // + - * / ^ ! % ° , ; ( ) [ ] { } |
  | { t: 'word'; w: string } // "mod"
  | { t: 'relation'; r: string } // = == < > <= >= !=
  | { t: 'unknownFunction'; name: string; suggestion: string | null }
  | { t: 'end' }

export interface Token {
  kind: TokenKind
  /** Índice (original) del primer carácter. */
  start: number
  /** Índice (original) del último carácter. */
  end: number
  /** Había espacios justo antes. */
  spaceBefore: boolean
  /** Rango en el arreglo de caracteres normalizados `[charStart, charEnd)`. */
  charStart: number
  charEnd: number
}

interface Piece {
  kind: TokenKind
  from: number
  to: number
  isFunction: boolean
  isNamed: boolean
}

const CONSTANT_NAMES: ReadonlyArray<[string, MathConstant]> = [['infinity', 'inf'], ['pi', 'pi'], ['inf', 'inf']]

/** Divide el texto normalizado en símbolos. */
export class Lexer {
  private readonly chars: readonly string[]
  private i = 0
  private tokens: Token[] = []
  private pendingSpace = false

  constructor(
    readonly text: NormalizedText,
    readonly options: ParseOptions,
  ) {
    this.chars = text.chars
  }

  private get n(): number {
    return this.chars.length
  }

  private err(message: string, index: number, kind: MathErrorKind = 'syntax'): MathError {
    return new MathError(kind, message, this.text.position(index))
  }

  private push(kind: TokenKind, from: number, to: number): void {
    this.tokens.push({
      kind,
      start: this.text.position(from),
      end: this.text.position(Math.max(from, to - 1)),
      spaceBefore: this.pendingSpace,
      charStart: from,
      charEnd: to,
    })
    this.pendingSpace = false
  }

  /** Primer carácter no blanco desde `index`. */
  private nextNonSpace(index: number): string | undefined {
    let k = index
    while (k < this.n && this.chars[k] === ' ') k += 1
    return k < this.n ? this.chars[k] : undefined
  }

  private slice(from: number, to: number): string {
    return this.chars.slice(from, to).join('')
  }

  // MARK: Bucle principal

  tokenize(): Token[] {
    while (this.i < this.n) {
      const c = this.chars[this.i]
      if (c === ' ') {
        this.pendingSpace = true
        this.i += 1
        continue
      }
      if (isDigit(c) || (c === '.' && this.i + 1 < this.n && isDigit(this.chars[this.i + 1]))) this.lexNumber()
      else if (vulgarFractions.has(c)) this.lexVulgar(vulgarFractions.get(c) as string)
      else if (isLetter(c)) this.lexWord()
      else this.lexOperator(c)
    }
    const endIndex = this.n
    this.tokens.push({
      kind: { t: 'end' },
      start: this.text.originalLength,
      end: this.text.originalLength,
      spaceBefore: this.pendingSpace,
      charStart: endIndex,
      charEnd: endIndex,
    })
    return this.tokens
  }

  // MARK: Números

  private lexNumber(): void {
    const chars = this.chars
    const n = this.n
    const start = this.i
    let j = this.i
    while (j < n && isDigit(chars[j])) j += 1
    const intDigits = j - this.i
    let hasPoint = false
    if (j < n && chars[j] === '.') {
      hasPoint = true
      j += 1
      const fs = j
      while (j < n && isDigit(chars[j])) j += 1
      const fracDigits = j - fs
      if (intDigits === 0 && fracDigits === 0) throw this.err(tr('Número mal escrito'), start)
      if (j < n && chars[j] === '.' && j + 1 < n && isDigit(chars[j + 1])) {
        throw this.err(tr('Número mal escrito: tiene dos puntos decimales'), start)
      }
    }
    let hasExponent = false
    if (this.options.scientificNotation && j < n && (chars[j] === 'e' || chars[j] === 'E')) {
      let k = j + 1
      if (k < n && (chars[k] === '+' || chars[k] === '-')) k += 1
      if (k < n && isDigit(chars[k])) {
        while (k < n && isDigit(chars[k])) k += 1
        hasExponent = true
        j = k
      }
    }
    const literalText = this.slice(start, j)
    const exact = Fraction.parseDecimal(literalText)
    const value = exact ? exact.doubleValue : swiftDouble(literalText)
    if (!Number.isFinite(value)) throw this.err(tr('El número es demasiado grande para escribirlo así'), start, 'overflow')
    if (hasExponent && Math.abs(value) > 1e300) throw this.err(tr('El número es demasiado grande'), start, 'overflow')
    this.push({ t: 'number', lit: { fraction: exact, double: value, text: literalText, isPlainInteger: !hasPoint && !hasExponent } }, start, j)
    this.i = j
  }

  /** `½`, `¾`… y números mixtos pegados (`2½` = 5/2). */
  private lexVulgar(str: string): void {
    const start = this.i
    const frac = Fraction.parse(str)
    if (!frac) throw this.err(tr('Fracción no válida'), this.i)
    this.i += 1
    const last = this.tokens[this.tokens.length - 1]
    if (last && last.kind.t === 'number' && last.kind.lit.isPlainInteger && last.kind.lit.fraction) {
      const whole = last.kind.lit.fraction
      const sum = whole.adding(frac)
      if (sum) {
        // número mixto: se fusiona con el entero anterior
        const text = `${whole.plain} ${str}`
        this.tokens[this.tokens.length - 1] = {
          ...last,
          kind: { t: 'number', lit: { fraction: sum, double: sum.doubleValue, text, isPlainInteger: false } },
          end: this.text.position(start),
          charEnd: this.i,
        }
        this.pendingSpace = false
        return
      }
    }
    this.push({ t: 'number', lit: { fraction: frac, double: frac.doubleValue, text: str, isPlainInteger: false } }, start, this.i)
  }

  // MARK: Palabras (variables, funciones, constantes)

  private lexWord(): void {
    const chars = this.chars
    const n = this.n
    const start = this.i
    let j = this.i
    while (j < n && isLetter(chars[j])) j += 1
    // En plantillas (palabras completas) un nombre puede llevar cifras: x1, a2b, log2, chi2cdf
    if (this.options.wordVariables) {
      while (j < n && (isLetter(chars[j]) || isDigit(chars[j]))) j += 1
    }
    // Nombres de función que llevan cifras: chi2cdf(…)
    if (j < n && isDigit(chars[j])) {
      let m = j
      while (m < n && isDigit(chars[m])) m += 1
      let q = m
      while (q < n && isLetter(chars[q])) q += 1
      if (FunctionTable.digitNames.has(foldedLower(this.slice(start, q)))) j = q
    }
    let run = chars.slice(start, j)
    /** Posición en `chars` de cada letra de `run` (puede saltar espacios: «arc sen»). */
    let index = Array.from({ length: j - start }, (_, k) => start + k)
    // «arc sen x», «arc tan(x)»: «arc» separado por espacios de la función trigonométrica es una sola palabra.
    if (foldedLower(run.join('')) === 'arc') {
      let k = j
      while (k < n && chars[k] === ' ') k += 1
      let m = k
      while (m < n && isLetter(chars[m])) m += 1
      const joined = 'arc' + foldedLower(this.slice(k, Math.max(k, m)))
      if (k > j && m > k && FunctionTable.namesLongestFirst.some((nm) => nm.length > 3 && nm.startsWith('arc') && joined.startsWith(nm))) {
        run = run.concat(chars.slice(k, m))
        index = index.concat(Array.from({ length: m - k }, (_, q) => k + q))
        j = m
      }
    }
    const runString = run.join('')
    const lower = foldedLower(runString)
    const nextCh = this.nextNonSpace(j)
    const nextIsParen = nextCh === '('

    // "mod" como operador entre operandos
    if (lower === 'mod') {
      this.push({ t: 'word', w: 'mod' }, start, j)
      this.i = j
      return
    }

    if (!splitLetters(this.options)) {
      this.lexWholeWord(start, j, run, lower)
      return
    }

    // Cortes: constante, función conocida, nombre de letra griega o letra suelta.
    // `isNamed`: constante de varias letras (pi, inf) o letra griega escrita con su nombre (theta).
    const pieces: Piece[] = []
    const folded: string[] = run.map((ch) => {
      const f = foldedLower(ch)
      return [...f].length === 1 ? f : '\u0000' // no coincide con ningún nombre
    })
    const matchesAt = (p: number, name: string): boolean => {
      for (let k = 0; k < name.length; k++) if (folded[p + k] !== name[k]) return false
      return true
    }
    let p = 0
    while (p < run.length) {
      let matched: { kind: TokenKind; len: number; isFunction: boolean } | null = null
      const remaining = run.length - p
      // constantes con nombre
      for (const [name, c] of CONSTANT_NAMES) {
        if (name.length <= remaining && matchesAt(p, name)) {
          matched = { kind: { t: 'constant', c }, len: name.length, isFunction: false }
          break
        }
      }
      if (!matched) {
        for (const name of FunctionTable.namesLongestFirst) {
          if (name.length > remaining || !matchesAt(p, name)) continue
          const canon = FunctionTable.aliases.get(name)
          if (canon === undefined) continue
          const whole = p === 0 && name.length === run.length
          const atEndBeforeParen = p + name.length === run.length && nextIsParen
          if (FunctionTable.glueable.has(canon) || whole || atEndBeforeParen) {
            matched = { kind: { t: 'function', name: canon }, len: name.length, isFunction: true }
            break
          }
        }
      }
      if (!matched) {
        // letras griegas por su nombre: theta → θ, Delta → Δ (siempre un solo símbolo)
        for (const name of GreekLetters.namesLongestFirst) {
          if (name.length > remaining || !matchesAt(p, name)) continue
          const symbol = GreekLetters.symbol(name, isUppercase(run[p]))
          if (symbol === null) continue
          matched = { kind: { t: 'ident', name: symbol }, len: name.length, isFunction: false }
          break
        }
      }
      if (matched) {
        pieces.push({ kind: matched.kind, from: p, to: p + matched.len, isFunction: matched.isFunction, isNamed: !matched.isFunction && matched.len > 1 })
        p += matched.len
      } else {
        const ch = run[p]
        pieces.push({ kind: ch === 'e' ? { t: 'constant', c: 'e' } : { t: 'ident', name: ch }, from: p, to: p + 1, isFunction: false, isNamed: false })
        p += 1
      }
    }

    // Función desconocida (errata o nombre largo) justo antes de un paréntesis.
    // No lo es si la palabra contiene una constante o una letra griega con nombre (`pit(x)` = π·t·x, `theta(t)` = θ·t).
    const lastPiece = pieces[pieces.length - 1]
    if (nextIsParen && run.length >= 3 && lastPiece && !lastPiece.isFunction && !pieces.some((x) => x.isNamed)) {
      const suggestion = FunctionTable.suggestion(runString)
      if (suggestion !== undefined) {
        this.push({ t: 'unknownFunction', name: runString, suggestion }, start, j)
        this.i = j
        return
      }
      if (run.length >= 4 && !pieces.some((x) => x.isFunction)) {
        this.push({ t: 'unknownFunction', name: runString, suggestion: null }, start, j)
        this.i = j
        return
      }
    }

    // ¿Subíndice (x_1) o base de logaritmo (log_2, log2( )?
    let end = j
    let lastKind = pieces[pieces.length - 1].kind
    if (end < n && chars[end] === '_') {
      const isLog = lastKind.t === 'function' && lastKind.name === 'log'
      const r = this.lexSubscript(end, isLog)
      if (r === null) throw this.err(tr('Subíndice no válido'), end)
      end = r.index
      const sub = r.content
      if (isLog) lastKind = { t: 'logBase', base: sub }
      else if (lastKind.t === 'ident') lastKind = { t: 'ident', name: lastKind.name + '_' + sub }
      else if (lastKind.t === 'constant' && lastKind.c === 'e') lastKind = { t: 'ident', name: 'e_' + sub }
      else throw this.err(tr('Esa palabra no admite subíndice'), j)
    } else if (end < n && isDigit(chars[end]) && lastKind.t === 'function' && lastKind.name === 'log') {
      let k = end
      while (k < n && isDigit(chars[k])) k += 1
      if (k < n && chars[k] === '(') {
        lastKind = { t: 'logBase', base: this.slice(end, k) }
        end = k
      }
    } else if (end + 1 < n && chars[end] === '2' && chars[end + 1] === '(' && lastKind.t === 'function' && lastKind.name === 'atan') {
      lastKind = { t: 'function', name: 'atan2' } // atan2(y, x): el nombre lleva un dígito
      end += 1
    }
    pieces.forEach((piece, idx) => {
      const isLast = idx === pieces.length - 1
      const kind = isLast ? lastKind : piece.kind
      this.push(kind, index[piece.from], isLast ? end : index[piece.to - 1] + 1)
    })
    this.i = end
  }

  /**
   * Palabras completas (sin multiplicación implícita o en plantillas): las funciones, las constantes y los nombres de
   * letras griegas se reconocen; el resto es una variable.
   */
  private lexWholeWord(start: number, j: number, run: string[], lower: string): void {
    const chars = this.chars
    const n = this.n
    let end = j
    let kind: TokenKind
    // En modo «palabras completas» (plantillas) un nombre como `min` o `rad` solo es función si lleva paréntesis.
    const followedByParen = this.nextNonSpace(j) === '('
    const canon = FunctionTable.aliases.get(lower)
    const runString = run.join('')
    if (canon !== undefined && (followedByParen || !this.options.wordVariables)) kind = { t: 'function', name: canon }
    else if (lower === 'pi') kind = { t: 'constant', c: 'pi' }
    else if (lower === 'inf' || lower === 'infinity' || lower === 'infinito') kind = { t: 'constant', c: 'inf' }
    else if (run.length === 1 && run[0] === 'e') kind = { t: 'constant', c: 'e' }
    else {
      const greek = GreekLetters.symbolForWord(runString)
      kind = greek !== null ? { t: 'ident', name: greek } : { t: 'ident', name: runString }
    }
    if (end < n && chars[end] === '_') {
      const isLog = kind.t === 'function' && kind.name === 'log'
      const r = this.lexSubscript(end, isLog)
      if (r === null) throw this.err(tr('Subíndice no válido'), end)
      end = r.index
      const sub = r.content
      if (isLog) kind = { t: 'logBase', base: sub }
      else if (kind.t === 'ident') kind = { t: 'ident', name: kind.name + '_' + sub }
      else if (kind.t === 'constant' && kind.c === 'e') kind = { t: 'ident', name: 'e_' + sub }
      else throw this.err(tr('Esa palabra no admite subíndice'), j)
    } else if (end < n && isDigit(chars[end]) && kind.t === 'function' && kind.name === 'log') {
      let k = end
      while (k < n && isDigit(chars[k])) k += 1
      if (k < n && chars[k] === '(') {
        kind = { t: 'logBase', base: this.slice(end, k) }
        end = k
      }
    } else if (end + 1 < n && chars[end] === '2' && chars[end + 1] === '(' && kind.t === 'function' && kind.name === 'atan') {
      kind = { t: 'function', name: 'atan2' }
      end += 1
    }
    this.push(kind, start, end)
    this.i = end
  }

  /**
   * Lee `_{…}`, `_(…)`, `_2` o `_k` y devuelve su contenido. `index` apunta al guion bajo; devuelve también la posición
   * tras el subíndice. Con `allowDecimal` (base de un logaritmo) acepta también un decimal: `log_0.5(x)`.
   */
  private lexSubscript(index: number, allowDecimal = false): { content: string; index: number } | null {
    const chars = this.chars
    const n = this.n
    let k = index + 1
    if (k >= n) return null
    if (chars[k] === '{' || chars[k] === '(') {
      const open = chars[k]
      const close = open === '{' ? '}' : ')'
      let depth = 0
      let m = k
      while (m < n) {
        if (chars[m] === open) depth += 1
        if (chars[m] === close) {
          depth -= 1
          if (depth === 0) break
        }
        m += 1
      }
      if (m >= n) throw this.err(tr('Falta cerrar el subíndice'), k)
      const content = trimWS(this.slice(k + 1, m))
      return content === '' ? null : { content, index: m + 1 }
    }
    if (isDigit(chars[k])) {
      while (k < n && isDigit(chars[k])) k += 1
      if (allowDecimal && k + 1 < n && (chars[k] === '.' || chars[k] === ',') && isDigit(chars[k + 1])) {
        k += 1
        while (k < n && isDigit(chars[k])) k += 1
      }
    } else if (isLetter(chars[k])) {
      while (k < n && isLetter(chars[k])) k += 1
    } else {
      return null
    }
    return { content: this.slice(index + 1, k), index: k }
  }

  // MARK: Operadores

  private lexOperator(c: string): void {
    const start = this.i
    const peek = (d = 1): string | undefined => (start + d < this.n ? this.chars[start + d] : undefined)
    switch (c) {
      case '+': case '-': case '/': case '%': case '°': case ',': case ';':
      case '(': case ')': case '[': case ']': case '{': case '}': case '|': case '^':
        this.push({ t: 'op', c }, start, start + 1)
        this.i += 1
        return
      case '*':
        if (peek() === '*') {
          this.push({ t: 'op', c: '^' }, start, start + 2)
          this.i += 2
        } else {
          this.push({ t: 'op', c: '*' }, start, start + 1)
          this.i += 1
        }
        return
      case '!':
        if (peek() === '=') this.pushRelation('!=', start, 2)
        else {
          this.push({ t: 'op', c: '!' }, start, start + 1)
          this.i += 1
        }
        return
      case '=':
        if (peek() === '=') this.pushRelation('==', start, 2)
        else this.pushRelation('=', start, 1)
        return
      case '<':
        if (peek() === '=') this.pushRelation('<=', start, 2)
        else this.pushRelation('<', start, 1)
        return
      case '>':
        if (peek() === '=') this.pushRelation('>=', start, 2)
        else this.pushRelation('>', start, 1)
        return
      case "'":
        throw this.err(tr("El apóstrofo «'» no se usa en una expresión: para una derivada escribe solo la expresión (2x, no f'(x))"), start)
      default:
        throw this.err(tr('No reconozco el símbolo «%@»', c), start)
    }
  }

  private pushRelation(r: string, start: number, len: number): void {
    this.push({ t: 'relation', r }, start, start + len)
    this.i += len
  }
}

/** `Double(text)` de Swift para un literal ASCII (NaN si no es un número). */
export function swiftDouble(text: string): number {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return NaN
  return Number(text)
}
