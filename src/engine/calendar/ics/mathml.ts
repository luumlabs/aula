// MathML → LaTeX aproximado (CanvasKit/Text/MathML.swift): fracciones, potencias, índices, raíces, paréntesis, funciones
// trigonométricas, letras griegas y matrices. Lo desconocido se concatena sin fallar.

/** Lo mínimo de un nodo HTML que hace falta aquí (el árbol de `htmlText`). */
export interface MathNode {
  tag: string
  attrs: Record<string, string>
  text: string
  children: MathNode[]
}

const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'lim', 'exp',
  'max', 'min', 'det', 'gcd', 'sup', 'inf', 'arg', 'deg', 'dim', 'ker'])

const GREEK: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi', 'χ': '\\chi',
  'ψ': '\\psi', 'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi',
  'Ψ': '\\Psi', 'Ω': '\\Omega'
}

const OPERATORS: Record<string, string> = {
  '−': '-', '–': '-', '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '→': '\\to',
  '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '∞': '\\infty', '·': '\\cdot', '⋅': '\\cdot', '∑': '\\sum', '∏': '\\prod', '∫': '\\int',
  '∂': '\\partial', '∈': '\\in', '∉': '\\notin', '∪': '\\cup', '∩': '\\cap', '⊂': '\\subset', '⊆': '\\subseteq', '∅': '\\emptyset', '∀': '\\forall',
  '∃': '\\exists', '°': '^\\circ', '′': "'", '∠': '\\angle', '∥': '\\parallel', '⊥': '\\perp', '≡': '\\equiv', '∼': '\\sim', '∝': '\\propto',
  '⁡': '', '⁢': '', '⁣': '', '⁤': '', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_'
}

const isText = (n: MathNode) => n.tag === ''
const trimmed = (s: string) => s.trim()

function rawText(n: MathNode): string {
  if (isText(n)) return n.text
  let s = ''
  for (const c of n.children) s += rawText(c)
  return s
}

/** LaTeX de un elemento `<math>` (cadena vacía si no hay contenido útil). */
export function mathMLToLatex(math: MathNode): string {
  const tex = annotationTeX(math)
  if (tex) return tex
  const converted = convert(math, 0).trim()
  if (converted) return converted
  return math.attrs.alttext?.trim() ?? ''
}

function annotationTeX(node: MathNode): string | null {
  for (const c of node.children) {
    if (isText(c)) continue
    if (c.tag === 'annotation') {
      const enc = (c.attrs.encoding ?? '').toLowerCase()
      if (enc.includes('tex') || enc.includes('latex')) {
        const t = rawText(c).trim()
        if (t) return t
      }
    } else {
      const inner = annotationTeX(c)
      if (inner) return inner
    }
  }
  return null
}

const elements = (n: MathNode) => n.children.filter((c) => !isText(c))

function group(s: string): string {
  const t = s.replace(/^[ \t]+|[ \t]+$/g, '')
  return Array.from(t).length === 1 ? t : `{${t}}`
}

function mapText(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const g = GREEK[ch]
    if (g) { out += g + ' '; continue }
    const o = OPERATORS[ch]
    if (o !== undefined) { out += o + (o.startsWith('\\') ? ' ' : ''); continue }
    out += ch
  }
  return out
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

const MAX_DEPTH = 200

function convert(node: MathNode, depth: number): string {
  if (depth > MAX_DEPTH) return ''
  if (isText(node)) {
    const t = node.text.trim()
    return t ? mapText(t) : ''
  }
  const kids = elements(node)
  const c = (i: number) => trimmed(convert(kids[i], depth + 1))
  switch (node.tag) {
    case 'annotation': case 'annotation-xml': return ''
    case 'mi': {
      const t = rawText(node).trim()
      return FUNCTION_NAMES.has(t) ? `\\${t} ` : mapText(t)
    }
    case 'mn': return rawText(node).trim()
    case 'mo': return mapText(rawText(node).trim())
    case 'mtext': case 'ms': {
      const t = rawText(node).trim()
      return t ? `\\text{${t}} ` : ''
    }
    case 'mspace': return '\\ '
    case 'mfrac': return kids.length >= 2 ? `\\frac{${c(0)}}{${c(1)}}` : concat(node, depth)
    case 'msqrt': return `\\sqrt{${trimmed(concat(node, depth))}}`
    case 'mroot': return kids.length >= 2 ? `\\sqrt[${c(1)}]{${c(0)}}` : concat(node, depth)
    case 'msup': return kids.length >= 2 ? `${group(convert(kids[0], depth + 1))}^{${c(1)}}` : concat(node, depth)
    case 'msub': return kids.length >= 2 ? `${group(convert(kids[0], depth + 1))}_{${c(1)}}` : concat(node, depth)
    case 'msubsup': return kids.length >= 3 ? `${group(convert(kids[0], depth + 1))}_{${c(1)}}^{${c(2)}}` : concat(node, depth)
    case 'munder': return kids.length >= 2 ? `${c(0)}_{${c(1)}}` : concat(node, depth)
    case 'mover': {
      if (kids.length < 2) return concat(node, depth)
      const over = c(1)
      if (over === '-' || over === '¯' || over === '‾') return `\\overline{${c(0)}}`
      if (over === '^' || over === 'ˆ') return `\\hat{${c(0)}}`
      if (over === '→' || over === '\\to') return `\\vec{${c(0)}}`
      return `${c(0)}^{${over}}`
    }
    case 'munderover': return kids.length >= 3 ? `${c(0)}_{${c(1)}}^{${c(2)}}` : concat(node, depth)
    case 'mfenced': {
      const open = node.attrs.open ?? '(', close = node.attrs.close ?? ')'
      const sep = Array.from(node.attrs.separators ?? ',')[0] ?? ','
      const inner = kids.map((k) => trimmed(convert(k, depth + 1))).join(sep + ' ')
      return `\\left${delim(open)} ${inner} \\right${delim(close)}`
    }
    case 'mtable': {
      const rows = kids.filter((k) => k.tag === 'mtr' || k.tag === 'mlabeledtr')
      const body = rows.map((row) => elements(row).filter((k) => k.tag === 'mtd').map((k) => trimmed(concat(k, depth + 1))).join(' & ')).join(' \\\\ ')
      return `\\begin{matrix} ${body} \\end{matrix}`
    }
    case 'semantics': {
      // primer hijo = presentación; el resto son anotaciones
      const first = kids.find((k) => k.tag !== 'annotation' && k.tag !== 'annotation-xml')
      return first ? convert(first, depth + 1) : ''
    }
    default: return concat(node, depth)
  }
}

const LETTER = /\p{L}/u

function concat(node: MathNode, depth: number): string {
  let out = ''
  for (const ch of node.children) {
    const piece = convert(ch, depth + 1)
    if (!piece) continue
    // separa palabras consecutivas para no pegarlas («2x» sí, «\sin x» con espacio)
    const last = Array.from(out).pop(), first = Array.from(piece)[0]
    if (last && first && LETTER.test(last) && LETTER.test(first) && !out.endsWith(' ')) out += ' '
    out += piece
  }
  return out
}
