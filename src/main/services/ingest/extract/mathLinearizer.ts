// Ecuaciones de Office (OMML: `m:oMath`) → texto lineal legible y buscable: `(a+b)/(c)`, `x^2`, `x_1`, `√(…)`, `∑_(i=1)^(n) …`.
import type { XNode } from '../core/miniXml'
import { charCount, isLetter, isNumber, trimWS, trimWSNL } from '../text/unicode'

/** Texto de un nodo `oMath` / `oMathPara`. */
export function ommlText(node: XNode): string {
  const s = lin(node)
  return trimWSNL(s.split(/[\n\t]/).filter((x) => x.length > 0).join(' '))
}

const isProperties = (name: string): boolean => name.endsWith('Pr')

function content(n: XNode): string {
  let out = ''
  for (const c of n.children) if (!isProperties(c.name)) out += lin(c)
  return out
}

function part(n: XNode, name: string): string {
  const c = n.child(name)
  return c ? content(c) : ''
}

/** Entre paréntesis salvo que sea un solo símbolo o ya esté entre paréntesis. */
function wrap(s: string): string {
  const t = trimWS(s)
  const count = charCount(t)
  if (count <= 1) return t
  if (count <= 3 && Array.from(t).every((c) => isLetter(c) || isNumber(c) || c === '.')) return t
  if (t.startsWith('(') && t.endsWith(')') && balanced(t)) return t
  return `(${t})`
}

function balanced(s: string): boolean {
  let depth = 0
  const cs = Array.from(s)
  for (let i = 0; i < cs.length; i++) {
    if (cs[i] === '(') depth++
    if (cs[i] === ')') { depth--; if (depth === 0 && i < cs.length - 1) return false }
    if (depth < 0) return false
  }
  return depth === 0
}

function lin(n: XNode): string {
  switch (n.name) {
    case 't':
      return foldMath(n.text)
    case 'r':
      return n.children.filter((c) => c.name === 't').map((c) => foldMath(c.text)).join('')
    case 'oMathPara':
      return n.children.filter((c) => c.name === 'oMath').map(lin).join(' ')
    case 'f': {
      const type = n.child('fPr')?.child('type')?.attr('val') ?? 'bar'
      const num = part(n, 'num'), den = part(n, 'den')
      if (type === 'noBar') return `binom(${num},${den})`
      return wrap(num) + '/' + wrap(den)
    }
    case 'sSup':
      return wrap(part(n, 'e')) + '^' + wrap(part(n, 'sup'))
    case 'sSub':
      return wrap(part(n, 'e')) + '_' + wrap(part(n, 'sub'))
    case 'sSubSup':
      return wrap(part(n, 'e')) + '_' + wrap(part(n, 'sub')) + '^' + wrap(part(n, 'sup'))
    case 'sPre':
      return '_' + wrap(part(n, 'sub')) + '^' + wrap(part(n, 'sup')) + part(n, 'e')
    case 'rad': {
      const deg = trimWS(part(n, 'deg'))
      const hide = n.child('radPr')?.child('degHide')?.attr('val')
      const e = part(n, 'e')
      if (!deg || hide === '1' || hide === 'on' || hide === 'true') return '√' + wrap(e)
      return `√[${deg}]` + wrap(e)
    }
    case 'nary': {
      const chr = n.child('naryPr')?.child('chr')?.attr('val') ?? '∫'
      let s = chr
      const sub = part(n, 'sub'), sup = part(n, 'sup')
      if (sub) s += '_' + wrap(sub)
      if (sup) s += '^' + wrap(sup)
      return s + ' ' + part(n, 'e')
    }
    case 'd': {
      const pr = n.child('dPr')
      const open = pr?.child('begChr')?.attr('val') ?? '('
      const close = pr?.child('endChr')?.attr('val') ?? ')'
      const sep = pr?.child('sepChr')?.attr('val') ?? '|'
      return open + n.childrenNamed('e').map(content).join(sep) + close
    }
    case 'func': {
      const fn = trimWS(part(n, 'fName'))
      const arg = trimWS(part(n, 'e'))
      return arg.startsWith('(') ? fn + arg : fn + ' ' + arg
    }
    case 'limLow':
      return part(n, 'e') + '_' + wrap(part(n, 'lim'))
    case 'limUpp':
      return part(n, 'e') + '^' + wrap(part(n, 'lim'))
    case 'm': {
      const rows = n.childrenNamed('mr').map((row) => row.childrenNamed('e').map(content).join(', '))
      return '[' + rows.join('; ') + ']'
    }
    case 'eqArr':
      return n.childrenNamed('e').map(content).join('; ')
    default:
      if (isProperties(n.name)) return ''
      return content(n)
  }
}

/** Pliega los «alfanuméricos matemáticos» de Unicode (𝑥, 𝐀, 𝟐…) a letras y cifras normales. */
export function foldMath(s: string): string {
  if (!/[\u{1D400}-\u{1D7FF}ℎ]/u.test(s)) return s
  let out = ''
  for (const ch of s) out += String.fromCodePoint(foldMathScalar(ch.codePointAt(0) ?? 0))
  return out
}

export function foldMathScalar(v: number): number {
  if (v === 0x210e) return 0x68
  if (v < 0x1d400 || v > 0x1d7ff) return v
  if (v >= 0x1d7ce) return 48 + ((v - 0x1d7ce) % 10)
  // Letras: bloques de 52 (A–Z, a–z) a partir de 0x1D400
  if (v < 0x1d6a4) {
    const idx = (v - 0x1d400) % 52
    return idx < 26 ? 65 + idx : 97 + idx - 26
  }
  return v
}
