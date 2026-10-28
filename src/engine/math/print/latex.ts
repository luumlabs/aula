import type { Expr } from '../core/expr'
import { StackGuard } from '../core/stack-guard'
import { isLetter, isNumberChar } from '../core/text'
import { MV, type BinaryOp, type UnaryOp } from '../core/types'
import { isStatistical } from '../eval/stat-tables'
import { decimalString } from '../format/decimal-digits'
import { NumberFormat } from '../format/number-format'
import type { Fraction } from '../numbers/fraction'
import { GreekLetters } from '../parse/greek'

const L = {
  sum: 10,
  mul: 30, // producto (pegado o con \cdot)
  unary: 40, // -a
  frac: 50, // \frac{a}{b}: no se puede usar como base de una potencia sin paréntesis
  power: 80,
  atom: 100,
} as const

interface R {
  text: string
  level: number
}

/**
 * TeX mínimo y correcto: `\frac`, `\sqrt`, `\cdot` solo si hace falta, `\sin`, `\ln`, `\left( \right)` solo cuando hace
 * falta. Solo usa comandos que entienden KaTeX y SwiftMath.
 */
export function toLatex(e: Expr): string {
  return render(e, false, 0).text
}

function paren(s: string): string {
  return '\\left(' + s + '\\right)'
}

function wrap(r: R, minLevel: number): string {
  return r.level < minLevel ? paren(r.text) : r.text
}

// MARK: Símbolos

export const LATEX_GREEK: ReadonlyMap<string, string> = new Map([
  ['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\epsilon'], ['ζ', '\\zeta'], ['η', '\\eta'],
  ['θ', '\\theta'], ['ι', '\\iota'], ['κ', '\\kappa'], ['λ', '\\lambda'], ['μ', '\\mu'], ['ν', '\\nu'], ['ξ', '\\xi'],
  ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['υ', '\\upsilon'], ['φ', '\\phi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'],
  ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Ξ', '\\Xi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'],
  ['Ψ', '\\Psi'], ['Ω', '\\Omega'],
])

function symbol(s: string): string {
  if ([...s].length === 1) return LATEX_GREEK.get(s) ?? s
  const g = GreekLetters.symbolForWord(s)
  if (g !== null) {
    const tex = LATEX_GREEK.get(g)
    if (tex) return tex
  }
  return '\\mathrm{' + s + '}'
}

/** Nombre de variable en TeX: `θ` → `\theta`, `theta` → `\theta`, `v_0` → `v_{0}`, `total` → `\mathrm{total}`. */
export function latexVariable(name: string): string {
  const u = name.indexOf('_')
  if (u < 0) return symbol(name)
  const base = name.slice(0, u)
  const sub = name.slice(u + 1)
  if (sub === '') return symbol(base)
  const subText = [...sub].every((c) => isNumberChar(c)) ? sub : symbol(sub)
  return symbol(base) + '_{' + subText + '}'
}

// MARK: Números

function numberText(f: Fraction): R {
  if (f.isInteger) return { text: String(f.num), level: f.num < 0n ? L.unary : L.atom }
  const dec = decimalString(f)
  if (dec !== null) return { text: dec, level: f.isNegative ? L.unary : L.atom }
  return { text: f.latex, level: f.isNegative ? L.unary : L.frac }
}

function isAtomic(e: Expr): boolean {
  switch (e.type) {
    case 'number':
      return e.value.isInteger && !e.value.isNegative
    case 'real':
      return e.value >= 0 && !NumberFormat.texNumber(MV.real(e.value)).includes('\\times')
    case 'variable':
    case 'constant':
      return true
    default:
      return false
  }
}

/** ¿Empieza el texto con un dígito? (para decidir si hace falta \cdot) */
function startsWithDigit(s: string): boolean {
  const cp = s.codePointAt(0)
  return cp !== undefined && isNumberChar(String.fromCodePoint(cp))
}

// MARK: Nodos

function render(e: Expr, trailing: boolean, depth: number): R {
  if (StackGuard.exhausted(depth)) return { text: '\\ldots ', level: L.atom }
  switch (e.type) {
    case 'number':
      return numberText(e.value)
    case 'real': {
      const t = NumberFormat.texNumber(MV.real(e.value))
      return { text: t, level: t.startsWith('-') ? L.unary : t.includes('\\times') ? L.mul : L.atom }
    }
    case 'variable':
      return { text: latexVariable(e.name), level: L.atom }
    case 'constant':
      switch (e.name) {
        case 'pi':
          return { text: '\\pi', level: L.atom }
        case 'e':
          return { text: 'e', level: L.atom }
        case 'tau':
          return { text: '\\tau', level: L.atom }
        case 'inf':
          return { text: '\\infty', level: L.atom }
      }
      break
    case 'unary':
      return renderUnary(e.op, e.arg, trailing, depth)
    case 'binary':
      return renderBinary(e.op, e.left, e.right, trailing, depth)
    case 'call':
      return renderCall(e.name, e.args, trailing, depth)
  }
  return { text: '', level: L.atom }
}

function isNegative(e: Expr): boolean {
  switch (e.type) {
    case 'unary':
      return e.op === 'neg'
    case 'number':
      return e.value.isNegative
    case 'real':
      return e.value < 0
    default:
      return false
  }
}

function renderUnary(op: UnaryOp, a: Expr, trailing: boolean, depth: number): R {
  const r = render(a, false, depth + 1)
  switch (op) {
    case 'plus':
      return r
    case 'neg':
      if (isNegative(a)) return { text: '-' + paren(r.text), level: L.unary }
      return { text: '-' + wrap(render(a, trailing, depth + 1), L.mul), level: L.unary }
    case 'factorial':
      return { text: wrap(r, L.atom) + '!', level: L.atom }
    case 'percent':
      return { text: wrap(r, L.atom) + '\\%', level: L.atom }
    case 'degree':
      return { text: wrap(r, L.atom) + '^{\\circ}', level: L.atom }
  }
}

function renderBinary(op: BinaryOp, a: Expr, b: Expr, trailing: boolean, depth: number): R {
  switch (op) {
    case 'add': {
      const lr = render(a, false, depth + 1)
      if (b.type === 'unary' && b.op === 'neg' && !isNegative(b.arg)) {
        const rr = render(b.arg, false, depth + 1)
        return { text: wrap(lr, L.sum) + '-' + wrap(rr, L.mul), level: L.sum }
      }
      if (b.type === 'number' && b.value.isNegative) {
        const pos = b.value.negated()
        if (pos) return { text: wrap(lr, L.sum) + '-' + numberText(pos).text, level: L.sum }
      }
      const rr = render(b, false, depth + 1)
      return { text: wrap(lr, L.sum) + '+' + wrap(rr, L.sum), level: L.sum }
    }
    case 'sub': {
      const lr = render(a, false, depth + 1)
      const rr = render(b, false, depth + 1)
      const right = isNegative(b) ? paren(rr.text) : wrap(rr, L.mul)
      return { text: wrap(lr, L.sum) + '-' + right, level: L.sum }
    }
    case 'mul':
      return renderProduct(a, b, trailing, depth)
    case 'div': {
      // el signo del numerador sale de la fracción: -\frac{1}{2} y no \frac{-1}{2}
      let numerator = a
      let negative = false
      if (a.type === 'unary' && a.op === 'neg' && !isNegative(a.arg)) {
        numerator = a.arg
        negative = true
      } else if (a.type === 'number' && a.value.isNegative) {
        const positive = a.value.negated()
        if (positive) {
          numerator = { type: 'number', value: positive }
          negative = true
        }
      }
      const lr = render(numerator, false, depth + 1)
      const rr = render(b, false, depth + 1)
      const body = '\\frac{' + lr.text + '}{' + rr.text + '}'
      return { text: negative ? '-' + body : body, level: negative ? L.unary : L.frac }
    }
    case 'mod': {
      const lr = render(a, true, depth + 1)
      const rr = render(b, trailing, depth + 1)
      return { text: wrap(lr, L.mul) + '\\;\\operatorname{mod}\\;' + wrap(rr, L.mul), level: L.mul }
    }
    case 'pow':
      return renderPower(a, b, trailing, depth)
  }
}

function isMultiLetterVariable(e: Expr): boolean {
  return e.type === 'variable' && [...e.name].length > 1 && !e.name.includes('_')
}

function renderProduct(a: Expr, b: Expr, trailing: boolean, depth: number): R {
  const lr = render(a, true, depth + 1)
  const rr = render(b, trailing, depth + 1)
  const left = wrap(lr, L.mul)
  const chain = b.type === 'binary' && b.op === 'mul'
  // Un factor derecho que empieza por «−» siempre va entre paréntesis: x·(−2y) pegado se leería x − 2y.
  const right = !rr.text.startsWith('-') && (chain || (rr.level >= L.mul && rr.level !== L.unary)) ? rr.text : paren(rr.text)

  // ¿hace falta \cdot? Sí si se leería como otro número (2·3, 2·\frac{1}{2}), si el factor derecho empieza con un dígito,
  // o si interviene una palabra de varias letras.
  const leftNumeric = (a.type === 'number' || a.type === 'real') && (lr.level >= L.frac || lr.level === L.atom || lr.level === L.mul)
  const rightNumeric = b.type === 'number' || b.type === 'real'
  const needCdot = startsWithDigit(right) || (leftNumeric && rightNumeric) || isMultiLetterVariable(a) || isMultiLetterVariable(b) ||
    (right.startsWith('\\frac') && (leftNumeric || lr.level === L.frac))
  if (needCdot) return { text: left + '\\cdot ' + right, level: L.mul }
  // (x+1)(x-1), 2x, xy, 2\sin x, \pi r  (tras un comando como \pi hace falta un espacio antes de una letra)
  return { text: latexJoin(left, right), level: L.mul }
}

/** Une dos fragmentos TeX; añade un espacio si el primero termina en un comando (`\pi`) y el segundo empieza con letra. */
export function latexJoin(left: string, right: string): string {
  const cp = right.codePointAt(0)
  const first = cp === undefined ? undefined : String.fromCodePoint(cp)
  const slash = left.lastIndexOf('\\')
  if (first === undefined || !isLetter(first) || slash < 0) return left + right
  const tail = left.slice(slash + 1)
  if (tail !== '' && [...tail].every((c) => isLetter(c))) return left + ' ' + right
  return left + right
}

const POWERED_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'ln', 'log'])

function renderPower(a: Expr, b: Expr, trailing: boolean, depth: number): R {
  const exponent = render(b, false, depth + 1).text
  // e^{x}
  if (a.type === 'constant' && a.name === 'e') return { text: 'e^{' + exponent + '}', level: L.power }
  // sin^{2}\left(x\right): potencia de una función trigonométrica o logarítmica
  if (a.type === 'call' && a.args.length === 1 && POWERED_FUNCTIONS.has(a.name) && b.type === 'number' && b.value.isInteger && b.value.num > 0n) {
    const fn = latexFunctionName(a.name)
    const arg = render(a.args[0], false, depth + 1)
    const argText = isAtomic(a.args[0]) && !trailing ? ' ' + arg.text : paren(arg.text)
    return { text: fn + '^{' + exponent + '}' + argText, level: L.mul }
  }
  const lr = render(a, false, depth + 1)
  let bare = isAtomic(a)
  if (a.type === 'call' && a.name === 'abs') bare = true
  const base = bare ? lr.text : paren(lr.text)
  return { text: base + '^{' + exponent + '}', level: L.power }
}

// MARK: Funciones

/** Nombre TeX de una función. */
export function latexFunctionName(name: string): string {
  switch (name) {
    case 'sin': return '\\sin'
    case 'cos': return '\\cos'
    case 'tan': return '\\tan'
    case 'sec': return '\\sec'
    case 'csc': return '\\csc'
    case 'cot': return '\\cot'
    case 'sinh': return '\\sinh'
    case 'cosh': return '\\cosh'
    case 'tanh': return '\\tanh'
    case 'asin': return '\\arcsin'
    case 'acos': return '\\arccos'
    case 'atan': return '\\arctan'
    case 'asec': return '\\operatorname{arcsec}'
    case 'acsc': return '\\operatorname{arccsc}'
    case 'acot': return '\\operatorname{arccot}'
    case 'asinh': return '\\operatorname{arsinh}'
    case 'acosh': return '\\operatorname{arcosh}'
    case 'atanh': return '\\operatorname{artanh}'
    case 'ln': return '\\ln'
    case 'log': return '\\log'
    case 'min': return '\\min'
    case 'max': return '\\max'
    case 'gcd': return '\\gcd'
    case 'invnorm': return '\\operatorname{invNorm}'
    case 'invt': return '\\operatorname{invT}'
    case 'chi2cdf': return '\\chi^{2}\\operatorname{cdf}'
    case 'chi2pdf': return '\\chi^{2}\\operatorname{pdf}'
    default: return '\\operatorname{' + name + '}'
  }
}

function renderCall(name: string, args: readonly Expr[], trailing: boolean, depth: number): R {
  const arg = (i: number): R => render(args[i], false, depth + 1)
  const listArgs = (): string => paren(args.map((x) => render(x, false, depth + 1).text).join(','))
  const simpleArgument = (e: Expr): string => {
    const r = render(e, false, depth + 1)
    // sin x (átomo, sin nada detrás) o sin\left(2x\right)
    if (isAtomic(e) && !trailing) return ' ' + r.text
    if (e.type === 'call' && e.name === 'abs') return r.text // \ln\left|x\right|
    return paren(r.text)
  }
  const n = args.length
  if (name === 'sqrt' && n === 1) return { text: '\\sqrt{' + arg(0).text + '}', level: L.atom }
  if (name === 'cbrt' && n === 1) return { text: '\\sqrt[3]{' + arg(0).text + '}', level: L.atom }
  if (name === 'root' && n === 2) return { text: '\\sqrt[' + arg(0).text + ']{' + arg(1).text + '}', level: L.atom }
  if (name === 'abs' && n === 1) return { text: '\\left|' + arg(0).text + '\\right|', level: L.atom }
  if (name === 'exp' && n === 1) return { text: 'e^{' + arg(0).text + '}', level: L.power }
  if (name === 'floor' && n === 1) return { text: '\\left\\lfloor ' + arg(0).text + '\\right\\rfloor', level: L.atom }
  if (name === 'ceil' && n === 1) return { text: '\\left\\lceil ' + arg(0).text + '\\right\\rceil', level: L.atom }
  if (name === 'fact' && n === 1) return { text: wrap(arg(0), L.atom) + '!', level: L.atom }
  if (name === 'nCr' && n === 2) return { text: '\\binom{' + arg(0).text + '}{' + arg(1).text + '}', level: L.atom }
  if (name === 'nPr' && n === 2) return { text: 'P' + listArgs(), level: L.atom }
  if (name === 'mod' && n === 2) return { text: wrap(arg(0), L.mul) + '\\;\\operatorname{mod}\\;' + wrap(arg(1), L.mul), level: L.mul }
  if (name === 'pow' && n === 2) return renderPower(args[0], args[1], trailing, depth)
  if (name === 'log' && n === 2) return { text: '\\log_{' + arg(0).text + '}' + simpleArgument(args[1]), level: L.mul }
  if (name === 'log2' && n === 1) return { text: '\\log_{2}' + simpleArgument(args[0]), level: L.mul }
  if (name === 'log10' && n === 1) return { text: '\\log' + simpleArgument(args[0]), level: L.mul }
  if (name === 'sign' && n === 1) return { text: '\\operatorname{sgn}' + paren(arg(0).text), level: L.atom }
  if (['min', 'max', 'gcd', 'lcm', 'atan2', 'round', 'trunc', 'rad', 'deg'].includes(name)) {
    return { text: latexFunctionName(name) + listArgs(), level: L.atom }
  }
  if (isStatistical(name)) return { text: latexFunctionName(name) + listArgs(), level: L.atom }
  if (n === 1) return { text: latexFunctionName(name) + simpleArgument(args[0]), level: L.mul }
  return { text: latexFunctionName(name) + listArgs(), level: L.atom }
}
