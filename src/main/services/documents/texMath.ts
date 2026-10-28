// LaTeX → ecuaciones nativas de Word (OMML con el paquete `docx`). La app Swift ponía cada fórmula como imagen (SwiftMath);
// aquí van como ecuaciones de verdad, editables en Word: fracciones, potencias y subíndices, raíces, sumas e integrales, letras
// griegas, operadores y funciones. Lo que no se entiende sale como texto (nunca se pierde la fórmula).
import {
  MathFraction, MathIntegral, MathRadical, MathRoundBrackets, MathRun, MathSubScript, MathSubSuperScript, MathSum, MathSuperScript,
  type MathComponent
} from 'docx'

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼',
  simeq: '≃', cong: '≅', propto: '∝', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
  Leftrightarrow: '⇔', iff: '⇔', implies: '⇒', mapsto: '↦', circ: '∘', degree: '°', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  land: '∧', lor: '∨', neg: '¬', angle: '∠', perp: '⊥', parallel: '∥', triangle: '△', therefore: '∴', because: '∵', ldots: '…', cdots: '⋯',
  dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', star: '⋆', ast: '∗', bullet: '•',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', mid: '|', Vert: '‖', '|': '‖', uparrow: '↑', downarrow: '↓',
  checkmark: '✓', ohm: 'Ω', AA: 'Å', lbrack: '[', rbrack: ']', lbrace: '{', rbrace: '}',
  '%': '%', $: '$', '&': '&', '#': '#', _: '_', '{': '{', '}': '}', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '\\': ' '
}

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim',
  'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'gcd', 'deg', 'arg', 'mod', 'bmod', 'Pr'])
const SPACES = new Set(['quad', 'qquad', 'enspace', 'thinspace', 'medspace', 'thickspace'])
const TEXT_COMMANDS = new Set(['text', 'textrm', 'textit', 'textbf', 'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'operatorname', 'mbox', 'textnormal', 'ce', 'pu', 'mathbb', 'mathcal', 'mathfrak', 'unit'])
const WRAPPERS = new Set(['boxed', 'overline', 'underline', 'bar', 'hat', 'vec', 'tilde', 'dot', 'ddot', 'widehat', 'widetilde', 'overrightarrow', 'mathstrut', 'cancel', 'phantom'])
const IGNORED = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits'])
const MAX_DEPTH = 40

type Tok = { t: 'cmd'; v: string } | { t: 'ch'; v: string } | { t: 'open' } | { t: 'close' } | { t: 'sup' } | { t: 'sub' }

export function tokenizeTeX(tex: string): Tok[] {
  const out: Tok[] = []
  const chars = Array.from(tex)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '\\') {
      const next = chars[i + 1]
      if (next === undefined) break
      if (/[a-zA-Z]/.test(next)) {
        let j = i + 1, name = ''
        while (j < chars.length && /[a-zA-Z]/.test(chars[j])) name += chars[j++]
        out.push({ t: 'cmd', v: name })
        i = j - 1
      } else {
        out.push({ t: 'cmd', v: next })
        i++
      }
    } else if (c === '{') out.push({ t: 'open' })
    else if (c === '}') out.push({ t: 'close' })
    else if (c === '^') out.push({ t: 'sup' })
    else if (c === '_') out.push({ t: 'sub' })
    else if (c === '~') out.push({ t: 'ch', v: ' ' })
    else if (!/\s/.test(c)) out.push({ t: 'ch', v: c })
  }
  return out
}

/** Un trozo de la ecuación antes de pasarlo a `docx`: texto (se unen los seguidos) o un componente ya hecho. */
type Piece = { text: string } | { node: MathComponent }

function toComponents(ps: Piece[]): MathComponent[] {
  const out: MathComponent[] = []
  let buf = ''
  for (const p of ps) {
    if ('text' in p) buf += p.text
    else {
      if (buf) { out.push(new MathRun(buf)); buf = '' }
      out.push(p.node)
    }
  }
  if (buf) out.push(new MathRun(buf))
  return out
}

class TeXParser {
  private i = 0
  private depth = 0
  constructor(private readonly toks: Tok[]) {}

  /** Una lista de trozos hasta el cierre del grupo (o el final). */
  list(): Piece[] {
    const out: Piece[] = []
    this.depth++
    while (this.i < this.toks.length) {
      const tok = this.toks[this.i]
      if (tok.t === 'close') { this.i++; break }
      if (tok.t === 'sup' || tok.t === 'sub') { this.scripts(out); continue }
      out.push(...this.atom())
    }
    this.depth--
    return out
  }

  private group(): Piece[] {
    return this.depth > MAX_DEPTH ? [] : this.list()
  }

  /** «x^2», «x_i», «x_i^2»: se aplican al último trozo (la última letra si era texto). */
  private scripts(out: Piece[]): void {
    let sup: Piece[] | undefined
    let sub: Piece[] | undefined
    while (this.i < this.toks.length && (this.toks[this.i].t === 'sup' || this.toks[this.i].t === 'sub')) {
      const kind = this.toks[this.i].t
      this.i++
      const arg = this.argument()
      if (kind === 'sup') sup = arg
      else sub = arg
    }
    // «^\circ» y «^{\circ}» son el signo de grados
    if (sup && !sub && sup.length === 1 && 'text' in sup[0] && sup[0].text === '∘') { out.push({ text: '°' }); return }
    let base: MathComponent[] = [new MathRun('')]
    const last = out.pop()
    if (last && 'text' in last) {
      const chars = Array.from(last.text)
      const tail = chars.pop() ?? ''
      if (chars.length) out.push({ text: chars.join('') })
      base = [new MathRun(tail)]
    } else if (last) base = [last.node]
    const s = sup ? toComponents(sup) : undefined
    const b = sub ? toComponents(sub) : undefined
    if (s && b) out.push({ node: new MathSubSuperScript({ children: base, subScript: b, superScript: s }) })
    else if (s) out.push({ node: new MathSuperScript({ children: base, superScript: s }) })
    else if (b) out.push({ node: new MathSubScript({ children: base, subScript: b }) })
  }

  /** Un argumento: un grupo `{…}` o un solo símbolo. */
  private argument(): Piece[] {
    const tok = this.toks[this.i]
    if (!tok) return []
    if (tok.t === 'open') { this.i++; return this.group() }
    return this.atom()
  }

  /** El texto literal de un grupo `{…}` (para \text y compañía). */
  private rawGroup(): string {
    const tok = this.toks[this.i]
    if (!tok) return ''
    if (tok.t !== 'open') { this.i++; return tok.t === 'ch' ? tok.v : '' }
    this.i++
    let depth = 1, s = ''
    while (this.i < this.toks.length && depth > 0) {
      const t = this.toks[this.i++]
      if (t.t === 'open') { depth++; s += '{' }
      else if (t.t === 'close') { depth--; if (depth > 0) s += '}' }
      else if (t.t === 'ch') s += t.v
      else if (t.t === 'cmd') s += SYMBOLS[t.v] ?? (SPACES.has(t.v) ? ' ' : t.v)
      else s += t.t === 'sup' ? '^' : '_'
    }
    return s
  }

  private atom(): Piece[] {
    const tok = this.toks[this.i++]
    if (!tok) return []
    switch (tok.t) {
      case 'ch': return [{ text: tok.v }]
      case 'open': return this.group()
      case 'cmd': return this.command(tok.v)
      default: return []
    }
  }

  private command(name: string): Piece[] {
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const numerator = toComponents(this.argument()), denominator = toComponents(this.argument())
      return [{ node: new MathFraction({ numerator, denominator }) }]
    }
    if (name === 'binom' || name === 'tbinom' || name === 'dbinom') {
      const a = toComponents(this.argument()), b = toComponents(this.argument())
      return [{ node: new MathRoundBrackets({ children: [new MathFraction({ numerator: a, denominator: b, type: 'noBar' })] }) }]
    }
    if (name === 'sqrt') {
      let degree: MathComponent[] | undefined
      const t = this.toks[this.i]
      if (t && t.t === 'ch' && t.v === '[') {
        this.i++
        const inner: Tok[] = []
        while (this.i < this.toks.length) {
          const x = this.toks[this.i++]
          if (x.t === 'ch' && x.v === ']') break
          inner.push(x)
        }
        degree = toComponents(new TeXParser(inner).list())
      }
      const children = toComponents(this.argument())
      return [{ node: new MathRadical(degree?.length ? { children, degree } : { children }) }]
    }
    if (name === 'sum' || name === 'int') return this.bigOperator(name)
    if (TEXT_COMMANDS.has(name)) return [{ text: this.rawGroup() }]
    if (name === 'color') { this.rawGroup(); return [] }
    if (name === 'textcolor') { this.rawGroup(); return this.argument() }
    if (WRAPPERS.has(name)) return this.argument()
    if (IGNORED.has(name)) return []
    if (SPACES.has(name)) return [{ text: ' ' }]
    if (name === 'begin' || name === 'end') { this.rawGroup(); return [] }
    if (FUNCTIONS.has(name)) return [{ text: name === 'bmod' ? 'mod' : name }]
    const sym = SYMBOLS[name]
    if (sym !== undefined) return [{ text: sym }]
    return [{ text: name }]
  }

  /** ∑ y ∫ con sus límites (lo que venga detrás con ^ y _) y lo que sigue como cuerpo. */
  private bigOperator(name: 'sum' | 'int'): Piece[] {
    let sup: MathComponent[] | undefined
    let sub: MathComponent[] | undefined
    while (this.i < this.toks.length && (this.toks[this.i].t === 'sup' || this.toks[this.i].t === 'sub')) {
      const kind = this.toks[this.i].t
      this.i++
      const arg = toComponents(this.argument())
      if (kind === 'sup') sup = arg
      else sub = arg
    }
    const children = toComponents(this.argument())
    const opts = { children, ...(sub ? { subScript: sub } : {}), ...(sup ? { superScript: sup } : {}) }
    return [{ node: name === 'sum' ? new MathSum(opts) : new MathIntegral(opts) }]
  }
}

/** Componentes de una ecuación de Word a partir de LaTeX (nunca lanza: lo que no se entiende queda como texto). */
export function texToMath(tex: string): MathComponent[] {
  try {
    const out = toComponents(new TeXParser(tokenizeTeX(tex)).list())
    return out.length ? out : [new MathRun(tex)]
  } catch {
    return [new MathRun(tex)]
  }
}

/** El texto de una fórmula con símbolos Unicode (para lo que no admite ecuaciones: títulos, pies). */
export function texToPlain(tex: string): string {
  const out: string[] = []
  for (const t of tokenizeTeX(tex)) {
    if (t.t === 'ch') out.push(t.v)
    else if (t.t === 'cmd') out.push(SYMBOLS[t.v] ?? (FUNCTIONS.has(t.v) ? t.v : TEXT_COMMANDS.has(t.v) || WRAPPERS.has(t.v) || IGNORED.has(t.v) ? '' : t.v === 'frac' || t.v === 'dfrac' ? '' : t.v))
    else if (t.t === 'sup') out.push('^')
    else if (t.t === 'sub') out.push('_')
  }
  return out.join('').replace(/\^∘/g, '°')
}
