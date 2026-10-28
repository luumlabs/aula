import type { Expr } from '../core/expr'
import { StackGuard } from '../core/stack-guard'
import { isLetter, isNumberChar } from '../core/text'
import type { BinaryOp, UnaryOp } from '../core/types'
import { decimalString } from '../format/decimal-digits'
import { swiftDoubleDescription } from '../format/swift-double'

/** Niveles de precedencia al imprimir. */
const L = {
  sum: 10, // a+b, a-b
  explicitMul: 20, // a*b, a/b, a mod b, y fracciones "3/4" como número
  implicitMul: 30, // 2x
  unary: 40, // -a
  power: 80, // a^b
  atom: 100, // 5, x, f(x), n!, 30°
} as const

interface R {
  text: string
  level: number
}

/**
 * Texto normalizado de la expresión: `sqrt(3)/2`, `2x+1`, `1/(2x)`.
 * Se puede volver a analizar con `MathParser.parse` y da la misma expresión (`plain → parse → plain` es estable).
 */
export function toPlain(e: Expr): string {
  return render(e, 0).text
}

/** Texto de un número real (`realText` de Swift). */
export function realText(d: number): string {
  if (Number.isNaN(d)) return 'nan'
  if (!Number.isFinite(d)) return d < 0 ? '-inf' : 'inf'
  if (d === Math.round(d) && Math.abs(d) < 1e15) return String(d === 0 ? 0 : d)
  return swiftDoubleDescription(d)
}

function wrap(r: R, minLevel: number): string {
  return r.level < minLevel ? '(' + r.text + ')' : r.text
}

function render(e: Expr, depth: number): R {
  if (StackGuard.exhausted(depth)) return { text: '…', level: L.atom }
  switch (e.type) {
    case 'number': {
      const f = e.value
      if (f.isInteger) return { text: String(f.num), level: f.num < 0n ? L.unary : L.atom }
      const dec = decimalString(f)
      if (dec !== null) return { text: dec, level: f.isNegative ? L.unary : L.atom }
      return { text: f.plain, level: f.isNegative ? L.unary : L.explicitMul }
    }
    case 'real': {
      const t = realText(e.value)
      return { text: t, level: t.startsWith('-') ? L.unary : L.atom }
    }
    case 'variable':
      return { text: e.name, level: L.atom }
    case 'constant':
      return { text: e.name, level: L.atom }
    case 'unary':
      return renderUnary(e.op, e.arg, depth)
    case 'binary':
      return renderBinary(e.op, e.left, e.right, depth)
    case 'call':
      return { text: e.name + '(' + e.args.map((a) => render(a, depth + 1).text).join(', ') + ')', level: L.atom }
  }
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

function renderUnary(op: UnaryOp, a: Expr, depth: number): R {
  const r = render(a, depth + 1)
  switch (op) {
    case 'plus':
      return r
    case 'neg':
      // el opuesto de un opuesto se pone entre paréntesis: -(-x)
      if (isNegative(a)) return { text: '-(' + r.text + ')', level: L.unary }
      // -(a/b) y -(a*b) se escriben -a/b y -a*b (mismo valor) salvo que el texto ya empiece por signo. Su nivel es el de
      // la operación sin paréntesis (un cociente «-1/(2x)» no se puede pegar a otro factor).
      if (a.type === 'binary' && (a.op === 'div' || a.op === 'mul') && !r.text.startsWith('-')) {
        return { text: '-' + r.text, level: r.level < L.implicitMul ? r.level : L.unary }
      }
      return { text: '-' + wrap(r, L.implicitMul), level: L.unary }
    case 'factorial':
      if (a.type === 'unary' && a.op === 'factorial') return { text: '(' + r.text + ')!', level: L.atom }
      return { text: wrap(r, L.atom) + '!', level: L.atom }
    case 'percent':
      return { text: wrap(r, L.atom) + '%', level: L.atom }
    case 'degree':
      return { text: wrap(r, L.atom) + '°', level: L.atom }
  }
}

function isNumericLiteral(e: Expr, r: R): boolean {
  if (e.type === 'number' || e.type === 'real') return r.level === L.atom && isNumberChar(firstChar(r.text))
  return false
}

function firstChar(s: string): string | undefined {
  const cp = s.codePointAt(0)
  return cp === undefined ? undefined : String.fromCodePoint(cp)
}

function startsWithLetterOrParen(s: string): boolean {
  const c = firstChar(s)
  if (c === undefined) return false
  return isLetter(c) || c === '('
}

function renderBinary(op: BinaryOp, a: Expr, b: Expr, depth: number): R {
  const lr = render(a, depth + 1)
  switch (op) {
    case 'add': {
      // a + (-b) se escribe a-b
      if (b.type === 'unary' && b.op === 'neg' && !isNegative(b.arg)) {
        const rr = render(b.arg, depth + 1)
        return { text: wrap(lr, L.sum) + '-' + wrap(rr, L.explicitMul), level: L.sum }
      }
      if (b.type === 'number' && b.value.isNegative) {
        const pos = b.value.negated()
        if (pos) {
          const rr = render({ type: 'number', value: pos }, depth + 1)
          return { text: wrap(lr, L.sum) + '-' + wrap(rr, L.explicitMul), level: L.sum }
        }
      }
      const rr = render(b, depth + 1)
      return { text: wrap(lr, L.sum) + '+' + wrap(rr, L.sum), level: L.sum }
    }
    case 'sub': {
      const rr = render(b, depth + 1)
      const right = isNegative(b) ? '(' + rr.text + ')' : wrap(rr, L.explicitMul)
      return { text: wrap(lr, L.sum) + '-' + right, level: L.sum }
    }
    case 'mul': {
      const rr = render(b, depth + 1)
      const left = wrap(lr, L.explicitMul)
      const isChain = b.type === 'binary' && b.op === 'mul'
      const right = isChain || (rr.level >= L.implicitMul && rr.level !== L.unary) ? rr.text : '(' + rr.text + ')'
      let juxtapose = false
      if (isNumericLiteral(a, lr) && !isNumericLiteral(b, rr) && startsWithLetterOrParen(right)) juxtapose = true
      // (x+1)(x-1); pero no tras un cociente o un módulo: «1/(2x)(x+1)» se leería 1/((2x)(x+1))
      // (si `lr` es una suma, `left` ya va entre paréntesis y se puede pegar)
      else if (left.endsWith(')') && right.startsWith('(') && (lr.level < L.explicitMul || lr.level >= L.implicitMul)) juxtapose = true
      // 2x, 2(x+1), (x+1)(x-1)
      if (juxtapose) return { text: left + right, level: L.implicitMul }
      return { text: left + '*' + right, level: L.explicitMul }
    }
    case 'div': {
      const rr = render(b, depth + 1)
      return { text: wrap(lr, L.explicitMul) + '/' + wrap(rr, L.power), level: L.explicitMul }
    }
    case 'mod': {
      const rr = render(b, depth + 1)
      return { text: wrap(lr, L.explicitMul) + ' mod ' + wrap(rr, L.power), level: L.explicitMul }
    }
    case 'pow': {
      const rr = render(b, depth + 1)
      const base = wrap(lr, L.power + 1)
      // exponente: átomo o potencia sin paréntesis; el resto, entre paréntesis
      const exponent = rr.level >= L.power ? rr.text : '(' + rr.text + ')'
      return { text: base + '^' + exponent, level: L.power }
    }
  }
}
