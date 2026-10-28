// MathML (el que genera el editor de Canvas) → LaTeX aproximado. Port de CanvasKit/Text/MathML.swift: fracciones, potencias,
// índices, raíces, paréntesis, funciones, griegas y matrices. Lo desconocido se concatena sin fallar.
import { isText, rawText, type HTMLNode } from './parser'

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'lim', 'exp',
  'max', 'min', 'det', 'gcd', 'sup', 'inf', 'arg', 'deg', 'dim', 'ker'])

const GREEK: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma',
  'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta',
  'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega'
}

const OPERATORS: Record<string, string> = {
  '−': '-', '–': '-', '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq',
  '≈': '\\approx', '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '∞': '\\infty',
  '·': '\\cdot', '⋅': '\\cdot', '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∂': '\\partial', '∈': '\\in', '∉': '\\notin',
  '∪': '\\cup', '∩': '\\cap', '⊂': '\\subset', '⊆': '\\subseteq', '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists',
  '°': '^\\circ', '′': "'", '∠': '\\angle', '∥': '\\parallel', '⊥': '\\perp', '≡': '\\equiv', '∼': '\\sim', '∝': '\\propto',
  '⁡': '', '⁢': '', '⁣': '', '⁤': '',
  '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_'
}

const elements = (n: HTMLNode): HTMLNode[] => n.children.filter((c) => !isText(c))
const t = (s: string): string => s.trim()

function mapText(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const g = GREEK[ch]
    if (g) {
      out += g + ' '
      continue
    }
    const o = OPERATORS[ch]
    if (o != null) {
      out += o + (o.startsWith('\\') ? ' ' : '')
      continue
    }
    out += ch
  }
  return out
}

function group(s: string): string {
  const v = s.trim()
  return [...v].length === 1 ? v : `{${v}}`
}

function delim(s: string): string {
  switch (s) {
    case '(': case ')': case '[': case ']': case '|': return s
    case '{': return '\\{'
    case '}': return '\\}'
    case '⟨': return '\\langle'
    case '⟩': return '\\rangle'
    case '⌈': return '\\lceil'
    case '⌉': return '\\rceil'
    case '⌊': return '\\lfloor'
    case '⌋': return '\\rfloor'
    default: return '.'
  }
}

function concat(n: HTMLNode): string {
  let out = ''
  for (const c of n.children) {
    const piece = convert(c)
    if (!piece) continue
    // separa palabras consecutivas («\sin x»), pero «2x» se queda junto
    if (/\p{L}$/u.test(out) && /^\p{L}/u.test(piece) && !out.endsWith(' ')) out += ' '
    out += piece
  }
  return out
}

function convert(n: HTMLNode): string {
  if (isText(n)) {
    const v = n.text.trim()
    return v ? mapText(v) : ''
  }
  const kids = elements(n)
  switch (n.tag) {
    case 'annotation': case 'annotation-xml': return ''
    case 'mi': {
      const v = rawText(n).trim()
      return FUNCTIONS.has(v) ? `\\${v} ` : mapText(v)
    }
    case 'mn': return rawText(n).trim()
    case 'mo': return mapText(rawText(n).trim())
    case 'mtext': case 'ms': {
      const v = rawText(n).trim()
      return v ? `\\text{${v}} ` : ''
    }
    case 'mspace': return '\\ '
    case 'mfrac': return kids.length >= 2 ? `\\frac{${t(convert(kids[0]))}}{${t(convert(kids[1]))}}` : concat(n)
    case 'msqrt': return `\\sqrt{${t(concat(n))}}`
    case 'mroot': return kids.length >= 2 ? `\\sqrt[${t(convert(kids[1]))}]{${t(convert(kids[0]))}}` : concat(n)
    case 'msup': return kids.length >= 2 ? `${group(convert(kids[0]))}^{${t(convert(kids[1]))}}` : concat(n)
    case 'msub': return kids.length >= 2 ? `${group(convert(kids[0]))}_{${t(convert(kids[1]))}}` : concat(n)
    case 'msubsup': return kids.length >= 3 ? `${group(convert(kids[0]))}_{${t(convert(kids[1]))}}^{${t(convert(kids[2]))}}` : concat(n)
    case 'munder': return kids.length >= 2 ? `${t(convert(kids[0]))}_{${t(convert(kids[1]))}}` : concat(n)
    case 'mover': {
      if (kids.length < 2) return concat(n)
      const over = t(convert(kids[1]))
      const base = t(convert(kids[0]))
      if (over === '-' || over === '¯' || over === '‾') return `\\overline{${base}}`
      if (over === '^' || over === 'ˆ') return `\\hat{${base}}`
      if (over === '→' || over === '\\to') return `\\vec{${base}}`
      return `${base}^{${over}}`
    }
    case 'munderover': return kids.length >= 3 ? `${t(convert(kids[0]))}_{${t(convert(kids[1]))}}^{${t(convert(kids[2]))}}` : concat(n)
    case 'mfenced': {
      const open = n.attrs.open ?? '('
      const close = n.attrs.close ?? ')'
      const sep = [...(n.attrs.separators ?? ',')][0] ?? ','
      const inner = kids.map((k) => t(convert(k))).join(sep + ' ')
      return `\\left${delim(open)} ${inner} \\right${delim(close)}`
    }
    case 'mtable': {
      const rows = kids.filter((k) => k.tag === 'mtr' || k.tag === 'mlabeledtr')
      const body = rows.map((r) => elements(r).filter((c) => c.tag === 'mtd').map((c) => t(concat(c))).join(' & ')).join(' \\\\ ')
      return `\\begin{matrix} ${body} \\end{matrix}`
    }
    case 'semantics': {
      const first = kids.find((k) => k.tag !== 'annotation' && k.tag !== 'annotation-xml')
      return first ? convert(first) : ''
    }
    default: return concat(n)
  }
}

function annotationTeX(n: HTMLNode): string | null {
  for (const c of n.children) {
    if (isText(c)) continue
    if (c.tag === 'annotation') {
      const enc = (c.attrs.encoding ?? '').toLowerCase()
      if (enc.includes('tex') || enc.includes('latex')) {
        const v = rawText(c).trim()
        if (v) return v
      }
    } else {
      const inner = annotationTeX(c)
      if (inner) return inner
    }
  }
  return null
}

/** LaTeX de un elemento `<math>` ('' si no hay contenido útil). */
export function mathMLToLatex(math: HTMLNode): string {
  const tex = annotationTeX(math)
  if (tex) return tex
  const converted = convert(math).trim()
  if (converted) return converted
  return (math.attrs.alttext ?? '').trim()
}
