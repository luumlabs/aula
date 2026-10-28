// Lectura tolerante de JSON generado por modelos de lenguaje (port de BaseKit/JSONRepair.swift).
//
// Problemas que arregla (los más comunes en la práctica):
//  - LaTeX con una sola barra invertida dentro de cadenas: `"\frac{1}{2}"` (JSON lo leería como salto de página + "rac"),
//    `"\theta"` (tabulador + "heta"), `"\beta"`, `"\neq"`, `"\right"`… y escapes inválidos como `"\sqrt"`, `"\pi"`, `"\cdot"`.
//  - Saltos de línea / tabuladores sin escapar dentro de cadenas.
//  - Comas finales, comentarios, `True/False/None`, texto antes/después del JSON, bloques ```json.
//  - JSON truncado (se cierran cadenas, arreglos y objetos abiertos).
import { isJSONObject, parseJSONValue, type JSONValue } from './json'

export class JSONRepairFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JSONRepairFailure'
  }
}

const isLetter = (c: string | undefined): boolean => !!c && c.length === 1 && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))
const isHex = (c: string | undefined): boolean => !!c && /^[0-9A-Fa-f]$/.test(c)
const isWS = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r'

/** Comandos LaTeX cuyo nombre empieza por b, f, n, r o t (los que JSON confunde con \b \f \n \r \t). */
export const LATEX_COMMANDS: ReadonlySet<string> = new Set([
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

/**
 * Comandos que, detrás de un salto de línea, también pueden ser texto normal: `\nu` frente a un salto + «u = v₀ + at»,
 * `\ne` frente a «e^{iπ} + 1 = 0» o «e) cinco», `\ni` frente a «i) primera opción»; y palabras corrientes («less»,
 * «subset», «approx»…). Solo se toman por LaTeX con alguna pista (`ambiguousIsCommand`).
 */
export const AMBIGUOUS_AFTER_NEWLINE: ReadonlySet<string> = new Set(['ne', 'ni', 'nu', 'nless', 'nsubset', 'nexists', 'napprox', 'nparallel', 'nmid', 'nsim'])

/**
 * Pistas de que un salto de línea seguido de un comando ambiguo es LaTeX al que le falta una barra:
 *  - justo detrás va `{`, `}`, `$` o `\`, o justo delante `{`, `_` o `^`;
 *  - está dentro de una fórmula en línea `$…$` abierta en la misma línea;
 *  - la misma cadena trae otros comandos con una sola barra sin dudas y delante va un espacio o un operador.
 */
export function ambiguousIsCommand(prev: string | undefined, next: string | undefined, inInlineMath: boolean, mangledElsewhere: boolean): boolean {
  if (next !== undefined && '{}$\\'.includes(next)) return true
  if (prev !== undefined && '{_^'.includes(prev)) return true
  if (inInlineMath) return true
  if (mangledElsewhere && prev !== undefined && ' =+-*/(,&|<>'.includes(prev)) return true
  return false
}

/** Letras ASCII seguidas a partir de `k`. */
function asciiWord(u: string[], k: number): string {
  let w = ''
  for (let j = k; j < u.length && isLetter(u[j]); j++) w += u[j]
  return w
}

/** Interpreta `text` como JSON, reparándolo si hace falta. */
export function repairParse(text: string): JSONValue {
  try {
    const v = parseJSONValue(text)
    if (!hasSuspiciousControlChars(v)) return v
  } catch {
    /* se repara abajo */
  }
  const fixed = repairJSON(extractCandidate(text))
  try {
    return parseJSONValue(fixed)
  } catch (err) {
    throw new JSONRepairFailure(`JSON inválido incluso tras repararlo: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Devuelve el texto JSON reparado (sin interpretarlo). */
export function repairJSON(text: string): string {
  const s = Array.from(text)
  const out: string[] = []
  let i = 0
  let inString = false
  const stack: string[] = []
  let stringEvidence = false // la cadena actual trae LaTeX con una sola barra sin dudas (\frac, \beta, \pi…)
  let inlineMath = false // hay una fórmula `$…$` abierta en la línea actual de la cadena

  while (i < s.length) {
    const c = s[i]
    if (inString) {
      if (c === '\\') {
        if (i + 1 >= s.length) { out.push('\\\\'); i += 1; continue }
        const n = s[i + 1]
        switch (n) {
          case '"': case '\\': case '/':
            out.push(c, n); i += 2
            break
          case 'u':
            if (i + 5 < s.length && isHex(s[i + 2]) && isHex(s[i + 3]) && isHex(s[i + 4]) && isHex(s[i + 5])) { out.push(c, n); i += 2 } // \uXXXX legítimo
            else { out.push('\\\\'); i += 1 } // \underline, \upsilon… → LaTeX
            break
          case 'b': case 'f': case 'n': case 'r': case 't': {
            // ¿La secuencia de letras que sigue a la barra es un comando LaTeX conocido? (\frac, \theta, \neq…)
            let j = i + 1
            let word = ''
            while (j < s.length && isLetter(s[j])) { word += s[j]; j++ }
            let isCommand = LATEX_COMMANDS.has(word)
            if (isCommand && AMBIGUOUS_AFTER_NEWLINE.has(word)) {
              // `\n` + «u = …», «e) …», «i) …» suele ser un salto de línea de verdad: solo es LaTeX con pistas
              let next: string | undefined = j < s.length ? s[j] : undefined
              if (next === '\\' && j + 1 < s.length && 'nrt"'.includes(s[j + 1])) next = undefined // otro escape JSON
              isCommand = ambiguousIsCommand(i > 0 ? s[i - 1] : undefined, next, inlineMath, stringEvidence)
            }
            if (isCommand) { out.push('\\\\'); i += 1 }
            else {
              out.push(c, n); i += 2
              if (n === 'n') inlineMath = false
            }
            break
          }
          default:
            out.push('\\\\'); i += 1 // escape inválido (\sqrt, \pi, \(, \, …) → barra literal
        }
        continue
      }
      if (c === '"') { inString = false; out.push(c); i += 1; continue }
      if (c === '$') {
        if (i + 1 < s.length && s[i + 1] === '$') { out.push(c, c); i += 2; continue } // `$$`: fórmula aparte
        if (!(i > 0 && s[i - 1] === '\\')) inlineMath = !inlineMath
        out.push(c); i += 1; continue
      }
      if (c === '\n') { out.push('\\n'); inlineMath = false; i += 1; continue }
      if (c === '\r') { out.push('\\r'); i += 1; continue }
      if (c === '\t') { out.push('\\t'); i += 1; continue }
      if (c.codePointAt(0)! < 0x20) { i += 1; continue } // otros caracteres de control: se descartan
      out.push(c); i += 1; continue
    }
    // fuera de cadena
    switch (c) {
      case '"':
        inString = true; out.push(c); i += 1
        stringEvidence = rawStringHasMangledLaTeX(s, i); inlineMath = false
        break
      case '{': case '[':
        stack.push(c); out.push(c); i += 1
        break
      case '}': case ']':
        trimTrailingComma(out) // quitar coma final
        if (stack.length) stack.pop()
        out.push(c); i += 1
        break
      case '/':
        if (i + 1 < s.length && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i += 1 }
        else if (i + 1 < s.length && s[i + 1] === '*') { i += 2; while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1; i += 2 }
        else { out.push(c); i += 1 }
        break
      default:
        if (isLetter(c)) {
          let j = i
          let word = ''
          while (j < s.length && isLetter(s[j])) { word += s[j]; j++ }
          switch (word) {
            case 'True': out.push('true'); break
            case 'False': out.push('false'); break
            case 'None': case 'undefined': case 'NaN': out.push('null'); break
            default: out.push(word)
          }
          i = j
        } else { out.push(c); i += 1 }
    }
  }
  // JSON truncado: cerrar lo que quedó abierto
  if (inString) out.push('"')
  const last = lastNonSpace(out)
  if (last === ':') out.push('null')
  else if (last === ',') trimTrailingComma(out)
  for (let k = stack.length - 1; k >= 0; k--) out.push(stack[k] === '{' ? '}' : ']')
  return out.join('')
}

/** Recorta el texto alrededor del primer objeto/arreglo JSON (quita ```json y prosa). */
export function extractCandidate(text: string): string {
  let t = text.trim()
  // Valla de apertura (```json …): solo cuenta si aparece antes del primer { o [. Las vallas dentro de cadenas no se tocan.
  const fence = t.indexOf('```')
  if (fence >= 0 && !/[{[]/.test(t.slice(0, fence))) {
    let rest = t.slice(fence + 3)
    const nl = rest.indexOf('\n')
    // etiqueta de lenguaje («json», «JSON5»…) hasta el fin de línea
    if (nl >= 0 && /^[\p{L}\p{N} ]*$/u.test(rest.slice(0, nl))) rest = rest.slice(nl + 1)
    t = rest.trim()
  }
  const start = t.search(/[{[]/)
  if (start < 0) return t
  let tail = t.slice(start)
  // Si hay un cierre balanceado, recortar lo que sobre después (incluida la valla de cierre).
  const end = balancedEnd(tail)
  if (end >= 0) return tail.slice(0, end + 1)
  // Sin cierre balanceado (respuesta cortada): quitar una valla de cierre suelta al final.
  if (tail.endsWith('```')) tail = tail.slice(0, -3).trim()
  return tail
}

function balancedEnd(s: string): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') { depth -= 1; if (depth === 0) return idx }
  }
  return -1
}

function trimTrailingComma(out: string[]): void {
  let idx = out.length
  while (idx > 0) {
    const ch = out[idx - 1]
    if (isWS(ch)) { idx -= 1; continue }
    if (ch === ',') out.splice(idx - 1)
    return
  }
}

function lastNonSpace(out: string[]): string | undefined {
  for (let idx = out.length - 1; idx >= 0; idx--) {
    const piece = out[idx]
    for (let k = piece.length - 1; k >= 0; k--) if (!isWS(piece[k])) return piece[k]
  }
  return undefined
}

/** ¿Alguna cadena trae caracteres de control que casi seguro son LaTeX mal escapado (\f rac, \b eta, \t en \theta)? */
export function hasSuspiciousControlChars(v: unknown): boolean {
  if (typeof v === 'string') return /[\u000C\u0008]/.test(v) || decodedCommandStarts(Array.from(v)).size > 0
  if (Array.isArray(v)) return v.some(hasSuspiciousControlChars)
  if (isJSONObject(v)) return Object.values(v).some(hasSuspiciousControlChars)
  return false
}

/**
 * Si ya se decodificó el JSON y quedaron caracteres de control por LaTeX mal escapado, los devuelve a su forma `\comando`.
 * Un salto de línea de verdad seguido de «u = …», «e^{…}», «i) …» o «e) …» se respeta.
 */
export function fixDecodedLaTeX(s: string): string {
  const u = Array.from(s)
  const starts = decodedCommandStarts(u)
  if (starts.size === 0 && !/[\u000C\u0008]/.test(s)) return s
  const out: string[] = []
  u.forEach((c, i) => {
    if (starts.has(i)) { out.push('\\' + (c === '\t' ? 't' : c === '\n' ? 'n' : 'r')); return }
    if (c === '\u000C') out.push('\\f')
    else if (c === '\u0008') out.push('\\b')
    else out.push(c)
  })
  return out.join('')
}

/**
 * Posiciones de los tabuladores, retornos de carro y saltos de línea de una cadena ya decodificada que en realidad son la
 * barra de un comando LaTeX. Dos pasadas: primero los seguros; luego los ambiguos, con esas pistas.
 */
function decodedCommandStarts(u: string[]): Set<number> {
  const sure = new Set<number>()
  const doubtful: Array<{ index: number; inInlineMath: boolean }> = []
  let evidence = false
  let inlineMath = false
  for (let i = 0; i < u.length; i++) {
    const c = u[i]
    if (c === '\u000C' || c === '\u0008') {
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
        else { sure.add(i); evidence = true }
      }
      // un salto de verdad cierra la línea (y con ella cualquier `$` suelto); uno dudoso dentro de `$…$` será comando
      if (c === '\n' && !sure.has(i) && doubtful[doubtful.length - 1]?.index !== i) inlineMath = false
    }
  }
  for (const d of doubtful) {
    const end = d.index + 1 + asciiWord(u, d.index + 1).length
    if (ambiguousIsCommand(d.index > 0 ? u[d.index - 1] : undefined, end < u.length ? u[end] : undefined, d.inInlineMath, evidence)) sure.add(d.index)
  }
  return sure
}

/** ¿La cadena JSON en bruto que empieza en `start` (tras la comilla) trae LaTeX con una sola barra sin dudas? */
function rawStringHasMangledLaTeX(s: string[], start: number): boolean {
  let k = start
  while (k < s.length && s[k] !== '"') {
    if (s[k] !== '\\' || k + 1 >= s.length) { k += 1; continue }
    const n = s[k + 1]
    switch (n) {
      case '"': case '\\': case '/':
        break
      case 'u':
        if (!(k + 5 < s.length && isHex(s[k + 2]) && isHex(s[k + 3]) && isHex(s[k + 4]) && isHex(s[k + 5]))) return true
        break
      case 'b': case 'f': case 'n': case 'r': case 't': {
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

/** API agrupada como en Swift (`JSONRepair.parse`, `JSONRepair.repair`…). */
export const JSONRepair = {
  parse: repairParse,
  repair: repairJSON,
  extractCandidate,
  fixDecodedLaTeX,
  hasSuspiciousControlChars
}
