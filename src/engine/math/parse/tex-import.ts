import { isLetter, isNumberChar } from '../core/text'

/** Caracteres convertidos con el índice original de cada uno. */
export interface CharsWithOrigin {
  chars: string[]
  origin: number[]
}

/** Profundidad máxima de grupos anidados que se convierten (más allá se ignora el contenido). */
const MAX_DEPTH = 40

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  rho: 'ρ', varrho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const SIMPLE: Readonly<Record<string, string>> = {
  cdot: '*', times: '*', ast: '*', div: '/', pm: '±', mp: '∓',
  pi: 'pi', infty: 'inf', circ: '°', degree: '°',
  le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', ne: '!=', neq: '!=',
  cup: '∪', cap: '∩', in: '∈', emptyset: '∅', varnothing: '∅',
  lfloor: 'floor(', rfloor: ')', lceil: 'ceil(', rceil: ')', langle: '(', rangle: ')',
  left: '', right: '', big: '', Big: '', bigg: '', Bigg: '', displaystyle: '', textstyle: '',
  quad: ' ', qquad: ' ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '\\': ' ',
  ldots: '...', cdots: '...', dots: '...',
  '%': '%', '{': '{', '}': '}', $: '', '#': '', '&': ' ', _: '_',
  '(': '', ')': '', '[': '', ']': '',
  bmod: ' mod ', mod: ' mod ', pmod: ' mod ',
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  ln: 'ln', log: 'log', exp: 'exp', min: 'min', max: 'max', gcd: 'gcd',
}

const WRAPPERS = new Set([
  'text', 'textrm', 'textbf', 'textit', 'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathbb', 'mathcal',
  'operatorname', 'boldsymbol', 'overline', 'bar', 'vec', 'hat', 'tilde', 'underline', 'mbox', 'hbox',
])

function own(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

class Converter {
  pos = 0
  out: string[] = []
  org: number[] = []

  constructor(private readonly src: readonly string[]) {}

  emit(s: string, o: number): void {
    for (const ch of s) {
      this.out.push(ch)
      this.org.push(o)
    }
  }

  emitChar(c: string, o: number): void {
    this.out.push(c)
    this.org.push(o)
  }

  skipSpaces(): void {
    while (this.pos < this.src.length && this.src[this.pos] === ' ') this.pos += 1
  }

  /** Convierte hasta el final (o hasta la llave que cierra el grupo actual, sin consumirla). */
  run(stopAtCloseBrace: boolean, depth: number): void {
    const src = this.src
    while (this.pos < src.length) {
      const c = src[this.pos]
      switch (c) {
        case '}':
          if (stopAtCloseBrace) return
          this.pos += 1 // llave suelta: se ignora
          break
        case '{': {
          const o = this.pos
          this.pos += 1
          this.emit('(', o)
          if (depth < MAX_DEPTH) this.run(true, depth + 1)
          else this.skipGroup()
          if (this.pos < src.length && src[this.pos] === '}') this.pos += 1
          this.emit(')', o)
          break
        }
        case '$':
          this.pos += 1
          break
        case '~':
          this.emit(' ', this.pos)
          this.pos += 1
          break
        case '\\':
          this.command(depth)
          break
        case '^':
          this.superscript()
          break
        case '_': {
          const o = this.pos
          this.pos += 1
          this.emit('_', o)
          // El subíndice conserva las llaves: x_{12}, log_{2}
          if (this.pos < src.length && src[this.pos] === '{') {
            const ob = this.pos
            this.pos += 1
            this.emit('{', ob)
            if (depth < MAX_DEPTH) this.run(true, depth + 1)
            else this.skipGroup()
            if (this.pos < src.length && src[this.pos] === '}') this.pos += 1
            this.emit('}', ob)
          }
          break
        }
        default:
          this.emitChar(c, this.pos)
          this.pos += 1
      }
    }
  }

  /** Salta un grupo `{...}` ya abierto (cuando se supera la profundidad máxima). */
  skipGroup(): void {
    let d = 1
    while (this.pos < this.src.length && d > 0) {
      if (this.src[this.pos] === '{') d += 1
      else if (this.src[this.pos] === '}') {
        d -= 1
        if (d === 0) return
      }
      this.pos += 1
    }
  }

  /** `^{...}`, `^x`, `^\circ`, `^{\circ}`. */
  superscript(): void {
    const src = this.src
    const o = this.pos
    this.pos += 1
    this.skipSpaces()
    if (this.matchAt(this.pos, '\\circ')) {
      this.pos += 5
      this.emit('°', o)
      return
    }
    if (this.pos < src.length && src[this.pos] === '{') {
      // ¿Es exactamente {\circ}?
      let j = this.pos + 1
      while (j < src.length && src[j] === ' ') j += 1
      if (this.matchAt(j, '\\circ')) {
        j += 5
        while (j < src.length && src[j] === ' ') j += 1
        if (j < src.length && src[j] === '}') {
          this.pos = j + 1
          this.emit('°', o)
          return
        }
      }
    }
    this.emit('^', o)
  }

  matchAt(start: number, s: string): boolean {
    const cs = [...s]
    if (start + cs.length > this.src.length) return false
    for (let k = 0; k < cs.length; k++) if (this.src[start + k] !== cs[k]) return false
    // un comando debe terminar ahí (no seguir con otra letra)
    const last = cs[cs.length - 1]
    if (isLetter(last) && start + cs.length < this.src.length && isLetter(this.src[start + cs.length])) return false
    return true
  }

  /** Convierte un argumento de comando: `{...}` completo o un único símbolo. */
  argument(depth: number): CharsWithOrigin {
    this.skipSpaces()
    const saveOut = this.out
    const saveOrg = this.org
    this.out = []
    this.org = []
    const src = this.src
    if (this.pos < src.length && src[this.pos] === '{') {
      this.pos += 1
      if (depth < MAX_DEPTH) this.run(true, depth + 1)
      else this.skipGroup()
      if (this.pos < src.length && src[this.pos] === '}') this.pos += 1
    } else if (this.pos < src.length) {
      if (src[this.pos] === '\\') this.command(depth + 1)
      else {
        this.emitChar(src[this.pos], this.pos)
        this.pos += 1
      }
    }
    const result = { chars: this.out, origin: this.org }
    this.out = saveOut
    this.org = saveOrg
    return result
  }

  append(part: CharsWithOrigin): void {
    this.out.push(...part.chars)
    this.org.push(...part.origin)
  }

  command(depth: number): void {
    const src = this.src
    const o = this.pos
    this.pos += 1 // la barra invertida
    if (this.pos >= src.length) return
    let name = ''
    if (isLetter(src[this.pos])) {
      while (this.pos < src.length && isLetter(src[this.pos])) {
        name += src[this.pos]
        this.pos += 1
      }
    } else {
      name = src[this.pos]
      this.pos += 1
    }

    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const a = this.argument(depth)
        const b = this.argument(depth)
        this.emit('((', o)
        this.append(a)
        this.emit(')/(', o)
        this.append(b)
        this.emit('))', o)
        return
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        const a = this.argument(depth)
        const b = this.argument(depth)
        this.emit('nCr(', o)
        this.append(a)
        this.emit(',', o)
        this.append(b)
        this.emit(')', o)
        return
      }
      case 'sqrt': {
        this.skipSpaces()
        if (this.pos < src.length && src[this.pos] === '[') {
          let j = this.pos + 1
          let idx = ''
          while (j < src.length && src[j] !== ']') {
            idx += src[j]
            j += 1
          }
          this.pos = Math.min(j + 1, src.length)
          const a = this.argument(depth)
          this.emit('root(', o)
          this.emit(idx, o)
          this.emit(',', o)
          this.append(a)
          this.emit(')', o)
        } else {
          const a = this.argument(depth)
          this.emit('sqrt(', o)
          this.append(a)
          this.emit(')', o)
        }
        return
      }
      case 'left':
      case 'right':
        this.skipSpaces()
        if (this.pos < src.length && src[this.pos] === '.') this.pos += 1 // \left. \right. = sin delimitador
        return
      case ',':
      case ';':
      case ':': {
        // "1\,000": el espacio fino entre cifras es un separador de miles; en el resto es un espacio
        const last = this.out[this.out.length - 1]
        if (last !== undefined && isNumberChar(last) && this.pos < src.length && isNumberChar(src[this.pos])) return
        this.emit(' ', o)
        return
      }
      default:
        break
    }
    if (WRAPPERS.has(name)) {
      this.append(this.argument(depth))
      return
    }
    const g = own(GREEK, name)
    if (g !== undefined) {
      this.emit(g, o)
      return
    }
    const s = own(SIMPLE, name)
    if (s !== undefined) {
      this.emit(s, o)
      return
    }
    // Comando desconocido: se deja el nombre para que el analizador lo rechace con un mensaje claro.
    this.emit(name, o)
  }
}

/**
 * Convierte el subconjunto de LaTeX que una persona (o una IA) suele escribir en una respuesta matemática al texto plano
 * que entiende el analizador: `\frac{\sqrt{3}}{2}` → `((sqrt(3))/(2))`.
 *
 * Cada carácter de salida conserva el índice del carácter original que lo produjo (para mensajes de error con posición).
 */
export function convertTeX(src: readonly string[]): CharsWithOrigin {
  const c = new Converter(src)
  c.run(false, 0)
  return { chars: c.out, origin: c.org }
}
