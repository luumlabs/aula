// JSON compacto con claves ordenadas (como `JSONValue.compact` de BaseKit) y lectura tolerante de JSON escrito por modelos
// (port de `BaseKit/JSONRepair.swift`). Cuando exista `@engine/base` con su JSON tolerante, este archivo puede delegar en él.
import type { JSONObject } from './types'

export function isObject(v: unknown): v is JSONObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Ordena las claves de los objetos (recursivo). */
export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (isObject(v)) {
    const out: JSONObject = {}
    for (const key of Object.keys(v).sort()) {
      const value = v[key]
      if (value !== undefined) out[key] = sortKeys(value)
    }
    return out
  }
  return v
}

/** JSON compacto con claves ordenadas (estable para comparar y para los resúmenes). */
export function compactJSON(v: unknown): string {
  try {
    return JSON.stringify(sortKeys(v)) ?? 'null'
  } catch {
    return 'null'
  }
}

/** Texto utilizable de un valor: cadena tal cual; número/bool convertidos; null → ''; resto, JSON compacto. */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v === null || v === undefined) return ''
  return compactJSON(v)
}

/** `JSON.parse` que devuelve `undefined` en vez de lanzar. */
export function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Accesores tolerantes para JSON externo (eventos de las CLIs, respuestas de servidores).
export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
/** Entero (como `JSONValue.int`: solo números con valor entero exacto). */
export function int(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined
}
export function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}
export function arr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined
}
export function obj(v: unknown): JSONObject | undefined {
  return isObject(v) ? v : undefined
}
/** `get(o, 'a', 'b')` = `o?.a?.b` sobre JSON desconocido. */
export function get(v: unknown, ...keys: (string | number)[]): unknown {
  let cur: unknown = v
  for (const key of keys) {
    if (typeof key === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[key]
    } else {
      if (!isObject(cur)) return undefined
      cur = cur[key]
    }
  }
  return cur
}

// MARK: Reparación (port de JSONRepair)

export class JSONRepairError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JSONRepairError'
  }
}

/** Interpreta `text` como JSON, reparándolo si hace falta (LaTeX con una sola barra, comas finales, JSON truncado…). */
export function parseLenient(text: string): unknown {
  const direct = tryParseWithFlag(text)
  if (direct.ok && !hasSuspiciousControlChars(direct.value)) return direct.value
  const fixed = repairJSON(extractCandidate(text))
  const repaired = tryParseWithFlag(fixed)
  if (!repaired.ok) throw new JSONRepairError('JSON inválido incluso tras repararlo')
  return repaired.value
}

function tryParseWithFlag(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

const isLetter = (c: string | undefined): boolean => !!c && /^[A-Za-z]$/.test(c)
const isHex = (c: string | undefined): boolean => !!c && /^[0-9A-Fa-f]$/.test(c)
const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r'

/** Devuelve el texto JSON reparado (sin interpretarlo). */
export function repairJSON(text: string): string {
  const s = Array.from(text)
  const out: string[] = []
  let i = 0
  let inString = false
  const stack: string[] = []
  let stringEvidence = false
  let inlineMath = false

  while (i < s.length) {
    const c = s[i]
    if (inString) {
      if (c === '\\') {
        if (i + 1 >= s.length) {
          out.push('\\\\')
          i += 1
          continue
        }
        const n = s[i + 1]
        if (n === '"' || n === '\\' || n === '/') {
          out.push(c, n)
          i += 2
        } else if (n === 'u') {
          if (i + 5 < s.length && isHex(s[i + 2]) && isHex(s[i + 3]) && isHex(s[i + 4]) && isHex(s[i + 5])) {
            out.push(c, n)
            i += 2
          } else {
            out.push('\\\\')
            i += 1
          }
        } else if (n === 'b' || n === 'f' || n === 'n' || n === 'r' || n === 't') {
          let j = i + 1
          let word = ''
          while (j < s.length && isLetter(s[j])) word += s[j++]
          let isCommand = LATEX_COMMANDS.has(word)
          if (isCommand && AMBIGUOUS_AFTER_NEWLINE.has(word)) {
            let next: string | undefined = j < s.length ? s[j] : undefined
            if (next === '\\' && j + 1 < s.length && 'nrt"'.includes(s[j + 1])) next = undefined
            isCommand = ambiguousIsCommand(i > 0 ? s[i - 1] : undefined, next, inlineMath, stringEvidence)
          }
          if (isCommand) {
            out.push('\\\\')
            i += 1
          } else {
            out.push(c, n)
            i += 2
            if (n === 'n') inlineMath = false
          }
        } else {
          out.push('\\\\')
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
          out.push('$$')
          i += 2
          continue
        }
        if (!(i > 0 && s[i - 1] === '\\')) inlineMath = !inlineMath
        out.push(c)
        i += 1
        continue
      }
      if (c === '\n') {
        out.push('\\n')
        inlineMath = false
        i += 1
        continue
      }
      if (c === '\r') {
        out.push('\\r')
        i += 1
        continue
      }
      if (c === '\t') {
        out.push('\\t')
        i += 1
        continue
      }
      if (c.codePointAt(0)! < 0x20) {
        i += 1
        continue
      }
      out.push(c)
      i += 1
      continue
    }
    // fuera de cadena
    if (c === '"') {
      inString = true
      out.push(c)
      i += 1
      stringEvidence = rawStringHasMangledLaTeX(s, i)
      inlineMath = false
    } else if (c === '{' || c === '[') {
      stack.push(c)
      out.push(c)
      i += 1
    } else if (c === '}' || c === ']') {
      trimTrailingComma(out)
      stack.pop()
      out.push(c)
      i += 1
    } else if (c === '/') {
      if (s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i += 1
      } else if (s[i + 1] === '*') {
        i += 2
        while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1
        i += 2
      } else {
        out.push(c)
        i += 1
      }
    } else if (isLetter(c)) {
      let j = i
      let word = ''
      while (j < s.length && isLetter(s[j])) word += s[j++]
      if (word === 'True') out.push('true')
      else if (word === 'False') out.push('false')
      else if (word === 'None' || word === 'undefined' || word === 'NaN') out.push('null')
      else out.push(word)
      i = j
    } else {
      out.push(c)
      i += 1
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

function trimTrailingComma(out: string[]): void {
  let idx = out.length
  while (idx > 0) {
    const ch = out[idx - 1]
    if (ch.length === 1 && isSpace(ch)) {
      idx -= 1
      continue
    }
    if (ch === ',') out.splice(idx - 1)
    return
  }
}

function lastNonSpace(out: string[]): string | undefined {
  for (let idx = out.length - 1; idx >= 0; idx--) {
    const piece = out[idx]
    for (let k = piece.length - 1; k >= 0; k--) {
      if (!isSpace(piece[k])) return piece[k]
    }
  }
  return undefined
}

/** Recorta el texto alrededor del primer objeto/arreglo JSON (quita ```json y prosa). */
export function extractCandidate(text: string): string {
  let t = text.trim()
  const fence = t.indexOf('```')
  if (fence >= 0 && !/[{[]/.test(t.slice(0, fence))) {
    let rest = t.slice(fence + 3)
    const nl = rest.indexOf('\n')
    if (nl >= 0 && /^[\p{L}\p{N} ]*$/u.test(rest.slice(0, nl))) rest = rest.slice(nl + 1)
    t = rest.trim()
  }
  const start = t.search(/[{[]/)
  if (start < 0) return t
  let tail = t.slice(start)
  const end = balancedEnd(tail)
  if (end !== undefined) return tail.slice(0, end + 1)
  if (tail.endsWith('```')) tail = tail.slice(0, -3).trim()
  return tail
}

function balancedEnd(s: string): number | undefined {
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
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return idx
    }
  }
  return undefined
}

/** ¿Alguna cadena trae caracteres de control que casi seguro son LaTeX mal escapado (\f+rac, \b+eta, \t+heta)? */
export function hasSuspiciousControlChars(v: unknown): boolean {
  if (typeof v === 'string') return /[\u000C\u0008]/.test(v) || decodedCommandStarts(Array.from(v)).size > 0
  if (Array.isArray(v)) return v.some(hasSuspiciousControlChars)
  if (isObject(v)) return Object.values(v).some(hasSuspiciousControlChars)
  return false
}

/** Si ya se decodificó el JSON y quedaron caracteres de control por LaTeX mal escapado, los devuelve a su forma `\comando`. */
export function fixDecodedLaTeX(s: string): string {
  const u = Array.from(s)
  const starts = decodedCommandStarts(u)
  if (starts.size === 0 && !/[\u000C\u0008]/.test(s)) return s
  let out = ''
  u.forEach((c, i) => {
    if (starts.has(i)) {
      out += '\\' + (c === '\t' ? 't' : c === '\n' ? 'n' : 'r')
      return
    }
    if (c === '\u000C') out += '\\f'
    else if (c === '\u0008') out += '\\b'
    else out += c
  })
  return out
}

/** Aplica `fixDecodedLaTeX` a todas las cadenas de un valor (argumentos de herramientas ya decodificados). */
export function repairStrings(v: unknown): unknown {
  if (typeof v === 'string') return fixDecodedLaTeX(v)
  if (Array.isArray(v)) return v.map(repairStrings)
  if (isObject(v)) {
    const out: JSONObject = {}
    for (const [k, value] of Object.entries(v)) out[k] = repairStrings(value)
    return out
  }
  return v
}

/** Comandos que, detrás de un salto de línea, también pueden ser texto normal (`\nu` frente a «u = v₀ + at»). */
const AMBIGUOUS_AFTER_NEWLINE = new Set(['ne', 'ni', 'nu', 'nless', 'nsubset', 'nexists', 'napprox', 'nparallel', 'nmid', 'nsim'])

function ambiguousIsCommand(prev: string | undefined, next: string | undefined, inInlineMath: boolean, mangledElsewhere: boolean): boolean {
  if (next !== undefined && '{}$\\'.includes(next)) return true
  if (prev !== undefined && '{_^'.includes(prev)) return true
  if (inInlineMath) return true
  if (mangledElsewhere && prev !== undefined && ' =+-*/(,&|<>'.includes(prev)) return true
  return false
}

function asciiWord(u: string[], from: number): string {
  let w = ''
  for (let j = from; j < u.length && isLetter(u[j]); j++) w += u[j]
  return w
}

function decodedCommandStarts(u: string[]): Set<number> {
  const sure = new Set<number>()
  const doubtful: { index: number; inInlineMath: boolean }[] = []
  let evidence = false
  let inlineMath = false
  for (let i = 0; i < u.length; i++) {
    const c = u[i]
    if (c === '\u000C' || c === '\u0008') {
      evidence = true
    } else if (c === '$') {
      if (u[i + 1] === '$') i += 1
      else if (!(i > 0 && u[i - 1] === '\\')) inlineMath = !inlineMath
    } else if (c === '\t' || c === '\n' || c === '\r') {
      const letter = c === '\t' ? 't' : c === '\n' ? 'n' : 'r'
      const word = asciiWord(u, i + 1)
      if (word && LATEX_COMMANDS.has(letter + word) && !(c === '\n' && i > 0 && u[i - 1] === '\r')) {
        if (c === '\n' && AMBIGUOUS_AFTER_NEWLINE.has(letter + word)) doubtful.push({ index: i, inInlineMath: inlineMath })
        else {
          sure.add(i)
          evidence = true
        }
      }
      if (c === '\n' && !sure.has(i) && doubtful[doubtful.length - 1]?.index !== i) inlineMath = false
    }
  }
  for (const d of doubtful) {
    const end = d.index + 1 + asciiWord(u, d.index + 1).length
    if (ambiguousIsCommand(d.index > 0 ? u[d.index - 1] : undefined, end < u.length ? u[end] : undefined, d.inInlineMath, evidence)) sure.add(d.index)
  }
  return sure
}

function rawStringHasMangledLaTeX(s: string[], start: number): boolean {
  let k = start
  while (k < s.length && s[k] !== '"') {
    if (s[k] !== '\\' || k + 1 >= s.length) {
      k += 1
      continue
    }
    const n = s[k + 1]
    if (n === '"' || n === '\\' || n === '/') {
      // escape normal
    } else if (n === 'u') {
      if (!(k + 5 < s.length && isHex(s[k + 2]) && isHex(s[k + 3]) && isHex(s[k + 4]) && isHex(s[k + 5]))) return true
    } else if (n === 'b' || n === 'f' || n === 'n' || n === 'r' || n === 't') {
      const word = asciiWord(s, k + 1)
      if (LATEX_COMMANDS.has(word) && !AMBIGUOUS_AFTER_NEWLINE.has(word)) return true
    } else {
      return true
    }
    k += 2
  }
  return false
}

/** Comandos LaTeX cuyo nombre empieza por b, f, n, r o t (los que JSON confunde con \b \f \n \r \t). */
const LATEX_COMMANDS = new Set([
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
