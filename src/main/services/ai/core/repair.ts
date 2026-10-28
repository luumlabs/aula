// Lectura tolerante de JSON generado por modelos (port de BaseKit/JSONRepair.swift). Arregla, sobre todo:
//  - LaTeX con una sola barra invertida dentro de cadenas («\frac» se leería como salto de página + «rac», «\theta» como
//    tabulador + «heta»…) y escapes inválidos como «\sqrt», «\pi», «\cdot»;
//  - saltos de línea / tabuladores sin escapar dentro de cadenas;
//  - comas finales, comentarios, True/False/None, texto antes/después del JSON, bloques ```json;
//  - JSON truncado (se cierran cadenas, arreglos y objetos abiertos).
// Trabaja sobre puntos de código (como los escalares Unicode de Swift).
import type { JSONValue } from '@shared/ai/json'

export class JSONRepairFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JSONRepairFailure'
  }
}

/** Interpreta `text` como JSON, reparándolo si hace falta. Lanza `JSONRepairFailure` si ni así. */
export function parseLenientJSON(text: string): JSONValue {
  try {
    const v = JSON.parse(text) as JSONValue
    if (!hasSuspiciousControlChars(v)) return v
  } catch {
    /* se repara */
  }
  const fixed = repairJSON(extractCandidate(text))
  try {
    return JSON.parse(fixed) as JSONValue
  } catch (err) {
    throw new JSONRepairFailure(`JSON inválido incluso tras repararlo: ${(err as Error).message}`)
  }
}

export function tryParseLenientJSON(text: string): JSONValue | undefined {
  try {
    return parseLenientJSON(text)
  } catch {
    return undefined
  }
}

const isLetter = (c: string | undefined): boolean => !!c && c.length === 1 && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))
const isHex = (c: string | undefined): boolean => !!c && /^[0-9A-Fa-f]$/.test(c)
const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r'

/** Devuelve el texto JSON reparado (sin interpretarlo). */
export function repairJSON(text: string): string {
  const s = Array.from(text)
  const out: string[] = []
  const emit = (str: string) => {
    for (const ch of str) out.push(ch)
  }
  let i = 0
  let inString = false
  const stack: string[] = []
  let stringEvidence = false // la cadena actual trae LaTeX con una sola barra sin dudas
  let inlineMath = false // hay una fórmula `$…$` abierta en la línea actual de la cadena

  while (i < s.length) {
    const c = s[i]
    if (inString) {
      if (c === '\\') {
        if (i + 1 >= s.length) {
          emit('\\\\')
          i += 1
          continue
        }
        const n = s[i + 1]
        switch (n) {
          case '"':
          case '\\':
          case '/':
            out.push(c, n)
            i += 2
            break
          case 'u':
            if (i + 5 < s.length && isHex(s[i + 2]) && isHex(s[i + 3]) && isHex(s[i + 4]) && isHex(s[i + 5])) {
              out.push(c, n) // \uXXXX legítimo
              i += 2
            } else {
              emit('\\\\') // \underline, \upsilon… → LaTeX
              i += 1
            }
            break
          case 'b':
          case 'f':
          case 'n':
          case 'r':
          case 't': {
            // ¿la secuencia de letras que sigue a la barra es un comando LaTeX conocido? (\frac, \theta, \neq…)
            let j = i + 1
            let word = ''
            while (j < s.length && isLetter(s[j])) {
              word += s[j]
              j += 1
            }
            let isCommand = LATEX_COMMANDS.has(word)
            if (isCommand && AMBIGUOUS_AFTER_NEWLINE.has(word)) {
              // `\n` + «u = …», «e) …», «i) …» suele ser un salto de línea de verdad: solo es LaTeX con pistas
              let next: string | null = j < s.length ? s[j] : null
              if (next === '\\' && j + 1 < s.length && 'nrt"'.includes(s[j + 1])) next = null // otro escape JSON
              isCommand = ambiguousIsCommand(i > 0 ? s[i - 1] : null, next, inlineMath, stringEvidence)
            }
            if (isCommand) {
              emit('\\\\')
              i += 1
            } else {
              out.push(c, n)
              i += 2
              if (n === 'n') inlineMath = false
            }
            break
          }
          default:
            emit('\\\\') // escape inválido (\sqrt, \pi, \(, \, …) → barra literal
            i += 1
        }
        continue
      }
      if (c === '"') {
        inString = false
        out.push(c)
        i += 1
        continue
      }
      if (c === '$') {
        if (i + 1 < s.length && s[i + 1] === '$') {
          out.push(c, c) // `$$`: fórmula aparte
          i += 2
          continue
        }
        if (!(i > 0 && s[i - 1] === '\\')) inlineMath = !inlineMath
        out.push(c)
        i += 1
        continue
      }
      if (c === '\n') {
        emit('\\n')
        inlineMath = false
        i += 1
        continue
      }
      if (c === '\r') {
        emit('\\r')
        i += 1
        continue
      }
      if (c === '\t') {
        emit('\\t')
        i += 1
        continue
      }
      if ((c.codePointAt(0) ?? 0) < 0x20) {
        i += 1 // otros caracteres de control: se descartan
        continue
      }
      out.push(c)
      i += 1
      continue
    }
    // fuera de cadena
    switch (c) {
      case '"':
        inString = true
        out.push(c)
        i += 1
        stringEvidence = rawStringHasMangledLaTeX(s, i)
        inlineMath = false
        break
      case '{':
      case '[':
        stack.push(c)
        out.push(c)
        i += 1
        break
      case '}':
      case ']':
        trimTrailingComma(out) // quitar coma final
        if (stack.length) stack.pop()
        out.push(c)
        i += 1
        break
      case '/':
        if (i + 1 < s.length && s[i + 1] === '/') {
          while (i < s.length && s[i] !== '\n') i += 1
        } else if (i + 1 < s.length && s[i + 1] === '*') {
          i += 2
          while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1
          i += 2
        } else {
          out.push(c)
          i += 1
        }
        break
      default:
        if (isLetter(c)) {
          let j = i
          let word = ''
          while (j < s.length && isLetter(s[j])) {
            word += s[j]
            j += 1
          }
          switch (word) {
            case 'True':
              emit('true')
              break
            case 'False':
              emit('false')
              break
            case 'None':
            case 'undefined':
            case 'NaN':
              emit('null')
              break
            default:
              emit(word)
          }
          i = j
        } else {
          out.push(c)
          i += 1
        }
    }
  }
  // JSON truncado: cerrar lo que quedó abierto
  if (inString) out.push('"')
  const last = lastNonSpace(out)
  if (last === ':') emit('null')
  else if (last === ',') trimTrailingComma(out)
  for (let k = stack.length - 1; k >= 0; k--) out.push(stack[k] === '{' ? '}' : ']')
  return out.join('')
}

/** Recorta el texto alrededor del primer objeto/arreglo JSON (quita ```json y prosa). */
export function extractCandidate(text: string): string {
  let t = text.trim()
  // valla de apertura (```json …): solo cuenta si aparece antes del primer { o [ (las vallas dentro de cadenas no se tocan)
  const r = t.indexOf('```')
  if (r >= 0 && !/[{[]/.test(t.slice(0, r))) {
    let rest = t.slice(r + 3)
    const nl = rest.indexOf('\n')
    if (nl >= 0 && /^[\p{L}\p{N} ]*$/u.test(rest.slice(0, nl))) rest = rest.slice(nl + 1)
    t = rest.trim()
  }
  const start = t.search(/[{[]/)
  if (start < 0) return t
  let tail = t.slice(start)
  const end = balancedEnd(tail)
  if (end !== null) return tail.slice(0, end + 1)
  // sin cierre balanceado (respuesta cortada): quitar una valla de cierre suelta al final
  if (tail.endsWith('```')) tail = tail.slice(0, -3).trim()
  return tail
}

function balancedEnd(s: string): number | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return null
}

function trimTrailingComma(out: string[]): void {
  let idx = out.length
  while (idx > 0) {
    const ch = out[idx - 1]
    if (isSpace(ch)) {
      idx -= 1
      continue
    }
    if (ch === ',') out.splice(idx - 1)
    return
  }
}

function lastNonSpace(out: string[]): string | null {
  for (let k = out.length - 1; k >= 0; k--) if (!isSpace(out[k])) return out[k]
  return null
}

/** ¿Alguna cadena trae caracteres de control que casi seguro son LaTeX mal escapado (\f+rac, \b+eta, \t+heta)? */
export function hasSuspiciousControlChars(v: JSONValue): boolean {
  if (typeof v === 'string') return v.includes('\f') || v.includes('\b') || decodedCommandStarts(Array.from(v)).size > 0
  if (Array.isArray(v)) return v.some(hasSuspiciousControlChars)
  if (v && typeof v === 'object') return Object.values(v).some(hasSuspiciousControlChars)
  return false
}

/**
 * Si ya se decodificó el JSON y quedaron caracteres de control por LaTeX mal escapado, los devuelve a su forma `\comando`.
 * Un salto de línea de verdad seguido de «u = …», «e^{…}», «i) …» o «e) …» se respeta.
 */
export function fixDecodedLaTeX(s: string): string {
  const u = Array.from(s)
  const starts = decodedCommandStarts(u)
  if (starts.size === 0 && !u.some((c) => c === '\f' || c === '\b')) return s
  let out = ''
  for (let i = 0; i < u.length; i++) {
    const c = u[i]
    if (starts.has(i)) {
      // tabulador, retorno o salto que era la barra de un comando
      out += '\\' + (c === '\t' ? 't' : c === '\n' ? 'n' : 'r')
      continue
    }
    if (c === '\f') out += '\\f'
    else if (c === '\b') out += '\\b'
    else out += c
  }
  return out
}

/** Comandos que, detrás de un salto de línea, también pueden ser texto normal (`\nu` frente a «u = v₀ + at»…). */
export const AMBIGUOUS_AFTER_NEWLINE = new Set(['ne', 'ni', 'nu', 'nless', 'nsubset', 'nexists', 'napprox', 'nparallel', 'nmid', 'nsim'])

/** Pistas de que un salto de línea seguido de un comando ambiguo es LaTeX al que le falta una barra. */
export function ambiguousIsCommand(prev: string | null, next: string | null, inInlineMath: boolean, mangledElsewhere: boolean): boolean {
  if (next !== null && '{}$\\'.includes(next)) return true
  if (prev !== null && '{_^'.includes(prev)) return true
  if (inInlineMath) return true
  if (mangledElsewhere && prev !== null && ' =+-*/(,&|<>'.includes(prev)) return true
  return false
}

function asciiWord(u: string[], from: number): string {
  let w = ''
  let j = from
  while (j < u.length && isLetter(u[j])) {
    w += u[j]
    j += 1
  }
  return w
}

/** Posiciones de tabuladores, retornos y saltos de una cadena ya decodificada que en realidad son la barra de un comando LaTeX. */
function decodedCommandStarts(u: string[]): Set<number> {
  const sure = new Set<number>()
  const doubtful: { index: number; inInlineMath: boolean }[] = []
  let evidence = false
  let inlineMath = false
  let i = 0
  while (i < u.length) {
    const c = u[i]
    if (c === '\f' || c === '\b') {
      evidence = true // \f y \b nunca son texto: \frac, \beta…
    } else if (c === '$') {
      if (i + 1 < u.length && u[i + 1] === '$') i += 1 // `$$`: fórmula aparte, no cuenta
      else if (!(i > 0 && u[i - 1] === '\\')) inlineMath = !inlineMath
    } else if (c === '\t' || c === '\n' || c === '\r') {
      const letter = c === '\t' ? 't' : c === '\n' ? 'n' : 'r'
      const word = asciiWord(u, i + 1)
      // «\r\n» es un fin de línea de Windows, no `\n` + comando
      if (word && LATEX_COMMANDS.has(letter + word) && !(c === '\n' && i > 0 && u[i - 1] === '\r')) {
        if (c === '\n' && AMBIGUOUS_AFTER_NEWLINE.has(letter + word)) doubtful.push({ index: i, inInlineMath: inlineMath })
        else {
          sure.add(i)
          evidence = true
        }
      }
      // un salto de verdad cierra la línea (y con ella cualquier `$` suelto); uno dudoso dentro de `$…$` será comando
      if (c === '\n' && !sure.has(i) && doubtful[doubtful.length - 1]?.index !== i) inlineMath = false
    }
    i += 1
  }
  for (const d of doubtful) {
    const end = d.index + 1 + asciiWord(u, d.index + 1).length
    if (ambiguousIsCommand(d.index > 0 ? u[d.index - 1] : null, end < u.length ? u[end] : null, d.inInlineMath, evidence)) sure.add(d.index)
  }
  return sure
}

/** ¿La cadena JSON en bruto que empieza en `start` (tras la comilla) trae LaTeX con una sola barra sin dudas? */
function rawStringHasMangledLaTeX(s: string[], start: number): boolean {
  let k = start
  while (k < s.length && s[k] !== '"') {
    if (s[k] !== '\\' || k + 1 >= s.length) {
      k += 1
      continue
    }
    const n = s[k + 1]
    switch (n) {
      case '"':
      case '\\':
      case '/':
        break
      case 'u':
        if (!(k + 5 < s.length && isHex(s[k + 2]) && isHex(s[k + 3]) && isHex(s[k + 4]) && isHex(s[k + 5]))) return true
        break
      case 'b':
      case 'f':
      case 'n':
      case 'r':
      case 't': {
        const word = asciiWord(s, k + 1)
        if (LATEX_COMMANDS.has(word) && !AMBIGUOUS_AFTER_NEWLINE.has(word)) return true
        break
      }
      default:
        return true
    }
    k += 2
  }
  return false
}

/** Comandos LaTeX cuyo nombre empieza por b, f, n, r o t (los que JSON confunde con \b \f \n \r \t). */
export const LATEX_COMMANDS = new Set([
  // b
  'beta', 'bar', 'begin', 'bf', 'big', 'bigg', 'bigcap', 'bigcup', 'bigoplus', 'bigotimes', 'bigvee', 'bigwedge', 'binom', 'bmod',
  'boldsymbol', 'bot', 'bowtie', 'box', 'bullet', 'because', 'backslash', 'breve', 'bbox', 'bm', 'beth', 'backsim', 'between', 'blacksquare',
  'bigl', 'bigr', 'biggl', 'biggr', 'bigodot', 'bigsqcup', 'biguplus', 'bigstar', 'bmatrix',
  // f
  'frac', 'forall', 'flat', 'fbox', 'footnotesize', 'fallingdotseq', 'fcolorbox', 'fint', 'frown',
  // n
  'neq', 'ne', 'neg', 'nu', 'nabla', 'not', 'notin', 'ni', 'nmid', 'nleq', 'ngeq', 'nless', 'ngtr', 'newline', 'normalsize', 'nolimits',
  'nexists', 'natural', 'nsubseteq', 'nsupseteq', 'nparallel', 'nrightarrow', 'nleftarrow', 'nwarrow', 'nearrow', 'nsim', 'ncong', 'napprox',
  'nvdash', 'nVdash', 'nonumber', 'nleqslant', 'ngeqslant', 'nprec', 'nsucc', 'nsubset', 'nsupset', 'nLeftarrow', 'nRightarrow',
  // r
  'rho', 'right', 'rightarrow', 'rangle', 'rbrace', 'rbrack', 'rceil', 'rfloor', 'rm', 'ref', 'renewcommand', 'rightleftharpoons',
  'rightharpoonup', 'rvert', 'rVert', 'rightrightarrows', 'rhd', 'rtimes', 'radius',
  // t
  'theta', 'times', 'text', 'textbf', 'textit', 'textrm', 'textsf', 'texttt', 'textnormal', 'tan', 'tanh', 'tau', 'to', 'top', 'triangle',
  'tilde', 'tfrac', 'therefore', 'tag', 'thinspace', 'thickspace', 'tiny', 'textstyle', 'triangleq', 'trianglelefteq', 'trianglerighteq',
  'thicksim', 'thickapprox', 'tbinom', 'theorem', 'textcolor'
])

/** Repara el LaTeX con barra simple que quedó como caracteres de control en todas las cadenas de un valor. */
export function fixLaTeXInValue(v: JSONValue): JSONValue {
  if (typeof v === 'string') return fixDecodedLaTeX(v)
  if (Array.isArray(v)) return v.map(fixLaTeXInValue)
  if (v && typeof v === 'object') {
    const out: Record<string, JSONValue> = {}
    for (const [k, x] of Object.entries(v)) out[k] = fixLaTeXInValue(x)
    return out
  }
  return v
}
