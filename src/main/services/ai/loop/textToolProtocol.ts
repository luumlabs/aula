// «Modo de texto» para modelos sin llamadas a herramientas nativas (port de TextToolProtocol.swift).
//
// El modelo pide una herramienta con un bloque de código etiquetado `tool` que contiene un objeto JSON:
//
//     ```tool
//     {"name": "crear_leccion", "arguments": {"titulo": "Límites"}}
//     ```
//
// Puede escribir varios bloques (o varios objetos en un bloque). Los resultados vuelven en un mensaje de usuario con
// `<tool_result name="…" ok="true">…</tool_result>`. El análisis es tolerante (LaTeX con una barra, comas finales, comillas
// tipográficas…); las llaves se emparejan respetando las cadenas, así que una valla dentro de un argumento no corta la llamada;
// un bloque cuyo JSON quedó incompleto NO se ejecuta: se informa como problema.
import type { JSONValue } from '@shared/ai/json'
import { isJSONObject } from '@shared/ai/json'
import type { ToolCall, ToolSpec } from '@shared/ai/types'
import { canonicalJSON, objectSchema } from '../core/json'
import { fixLaTeXInValue, parseLenientJSON, repairJSON } from '../core/repair'
import { shortId } from '../core/toolCalls'

/** Etiquetas aceptadas tras las tres comillas invertidas de apertura. */
export const FENCE_NAMES = ['tool', 'tool_call', 'tool-call', 'toolcall', 'tool_use']

export interface ParsedTextTools {
  /** Texto sin los bloques de herramienta (lo que se muestra). */
  visibleText: string
  calls: ToolCall[]
  /** Bloques que no se pudieron interpretar (se le comunican al modelo para que los reenvíe). */
  problems: string[]
}

/** Texto que se añade al prompt del sistema para enseñar el protocolo, con el catálogo de herramientas. */
export function textToolInstructions(tools: ToolSpec[]): string {
  let s = `## Uso de herramientas (modo de texto)

En esta conversación no tienes llamadas a herramientas nativas. Para usar una herramienta escribe un bloque de código con la etiqueta \`tool\` que contenga UN objeto JSON con \`name\` (el nombre exacto de la herramienta) y \`arguments\` (un objeto con los argumentos), así:

\`\`\`tool
{"name": "nombre_de_la_herramienta", "arguments": {"parametro": "valor"}}
\`\`\`

Reglas:
- Escribe la etiqueta en una línea propia. Puedes poner varios bloques \`tool\` seguidos para pedir varias acciones a la vez.
- Después de los bloques, DETENTE: no escribas nada más ni inventes resultados. Recibirás un mensaje de usuario con los resultados en la forma \`<tool_result name="..." ok="true">...</tool_result>\` (con \`ok="false"\` si falló) y entonces continúas.
- El JSON debe ser válido: comillas dobles, sin comentarios ni comas finales. Dentro de las cadenas duplica cada barra invertida (p. ej. \\\\frac{1}{2}, \\\\sqrt{x}) y escribe los saltos de línea como \\n.
- Cuando ya no necesites más herramientas, responde normalmente, sin bloques \`tool\`.
`
  if (!tools.length) s += '\nNo hay herramientas disponibles en este momento.\n'
  else {
    s += '\nHerramientas disponibles:\n'
    for (const t of tools) s += `\n### ${t.name}\n${t.description}\nParámetros (JSON Schema): ${canonicalJSON(objectSchema(t.inputSchema))}\n`
  }
  return s
}

/** `<tool_result name="…" ok="true">…</tool_result>`. Se neutraliza cualquier `</tool_result` dentro del texto. */
export function formatToolResult(name: string, ok: boolean, text: string): string {
  const safeName = name.replaceAll('"', "'").replaceAll('<', '').replaceAll('>', '')
  const safeText = text.replaceAll('</tool_result', '<\\/tool_result')
  return `<tool_result name="${safeName}" ok="${ok ? 'true' : 'false'}">\n${safeText}\n</tool_result>`
}

/** Bloque `tool` equivalente a una llamada (para reescribir en modo texto un historial con llamadas nativas). */
export function formatToolCall(call: ToolCall): string {
  return '```tool\n' + canonicalJSON({ name: call.name, arguments: call.arguments }) + '\n```'
}

/** Quita saltos de línea sobrantes que dejan los bloques eliminados. */
export function normalizeVisible(s: string): string {
  let t = s.replaceAll('\r\n', '\n')
  while (t.includes('\n\n\n')) t = t.replaceAll('\n\n\n', '\n\n')
  return t.trim()
}

/** Lectura tolerante de JSON escrito por un modelo (repara y lee; si falla, la reparación con extracción). */
export function parseModelJSON(raw: string): JSONValue | undefined {
  try {
    return JSON.parse(repairJSON(raw)) as JSONValue
  } catch {
    try {
      return parseLenientJSON(raw)
    } catch {
      return undefined
    }
  }
}

/** Argumentos de una llamada nativa que no se pudieron leer (`{"_unparsed": "…"}`): segundo intento más tolerante. */
export function recoverArguments(call: ToolCall): ToolCall {
  const a = call.arguments
  if (!isJSONObject(a) || Object.keys(a).length !== 1 || typeof a._unparsed !== 'string') return call
  const v = parseModelJSON(a._unparsed)
  if (!isJSONObject(v)) return call
  return { ...call, arguments: fixLaTeXInValue(v) }
}

/** Interpreta la respuesta completa del modelo. */
export function parseTextTools(text: string): ParsedTextTools {
  const s = Array.from(text)
  const cursor: CursorBox = { value: undefined }
  const scan = scanToolBlocks(s, 0, true, cursor)
  let visible = ''
  const calls: ToolCall[] = []
  const problems: string[] = []
  const counter = { n: 0 }
  for (const piece of scan.pieces) {
    if (piece.type === 'text') {
      visible += s.slice(piece.start, piece.end).join('')
      continue
    }
    const block = piece.block
    if (!block.objects.length && !block.incomplete) {
      problems.push('Escribiste un bloque ```tool vacío o sin terminar. Escribe un objeto JSON con «name» y «arguments».')
    }
    for (const r of block.objects) {
      const raw = s.slice(r.start, r.end).join('')
      const { found, problem } = interpret(raw, counter)
      calls.push(...found)
      if (problem) problems.push(problem)
    }
    if (block.incomplete) {
      const raw = s.slice(block.incomplete.start, block.incomplete.end).join('')
      const head = Array.from(raw).slice(0, 120).join('').replaceAll('\n', ' ')
      problems.push(`Un bloque \`\`\`tool quedó incompleto (la respuesta se cortó o falta cerrar llaves): «${head}…». No se ejecutó; reenvíalo completo.`)
    }
  }
  return { visibleText: normalizeVisible(visible), calls, problems }
}

/** Texto JSON de un objeto (o arreglo de objetos) → llamadas. */
function interpret(raw: string, counter: { n: number }): { found: ToolCall[]; problem?: string } {
  const value = parseModelJSON(raw)
  if (value === undefined) {
    const head = Array.from(raw).slice(0, 120).join('').replaceAll('\n', ' ')
    return { found: [], problem: `No pude interpretar un bloque \`\`\`tool como JSON: «${head}». Reenvíalo con JSON válido (comillas dobles y barras invertidas de LaTeX duplicadas).` }
  }
  const items = Array.isArray(value) ? value : [value]
  const found: ToolCall[] = []
  let problem: string | undefined
  for (const item of items) {
    if (!isJSONObject(item)) {
      problem = 'Un bloque ```tool debe contener un objeto JSON con «name» y «arguments».'
      continue
    }
    let nameValue: JSONValue | undefined = item.name ?? item.tool ?? item.tool_name ?? item.function
    let argsValue: JSONValue | undefined = item.arguments ?? item.parameters ?? item.args ?? item.input
    if (isJSONObject(nameValue)) {
      // {"function": {"name": …, "arguments": …}}
      argsValue = argsValue ?? nameValue.arguments ?? nameValue.parameters
      nameValue = nameValue.name
    }
    const name = typeof nameValue === 'string' ? nameValue.trim() : ''
    if (!name) {
      problem = 'Un bloque ```tool no trae «name» (el nombre de la herramienta).'
      continue
    }
    let rawArguments: string | undefined
    let args: JSONValue = argsValue ?? {}
    if (typeof args === 'string') {
      // «arguments» como cadena JSON
      rawArguments = args
      try {
        args = parseLenientJSON(args)
      } catch {
        args = { _unparsed: args }
      }
    }
    if (args === null) args = {}
    counter.n += 1
    const fixed = fixLaTeXInValue(args)
    found.push({ id: `texto_${counter.n}_${shortId(6)}`, name, arguments: fixed, rawArguments: rawArguments ?? canonicalJSON(fixed) })
  }
  return { found, problem }
}

// MARK: Explorador de bloques ```tool (sobre puntos de código, para índices baratos)

interface Range {
  start: number
  end: number
}
interface Block {
  range: Range
  objects: Range[]
  incomplete?: Range
  closed: boolean
}
type Piece = { type: 'text'; start: number; end: number } | { type: 'block'; block: Block }

/** Estado de una exploración de llaves a medias (sigue donde se quedó cuando llega más texto). */
interface BalanceCursor {
  start: number
  pos: number
  depth: number
  inString: boolean
  escaped: boolean
}
interface CursorBox {
  value: BalanceCursor | undefined
}

interface ScanOutput {
  pieces: Piece[]
  /** A partir de aquí no se puede decidir todavía (solo si `final === false`). */
  undecidedFrom?: number
}

function lineEnd(s: string[], from: number): number {
  let i = from
  while (i < s.length && s[i] !== '\n') i++
  return i
}

const isWS = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t'
const isWordChar = (c: string) => /^[0-9A-Za-z_-]$/.test(c)

/** Separa una línea de valla en (etiqueta, resto). `null` si no empieza por ``` tras ≤ 3 espacios. */
function fenceParts(s: string[], start: number, end: number): { info: string; rest: number } | null {
  let k = start
  let spaces = 0
  while (k < end && s[k] === ' ') {
    k++
    spaces++
  }
  if (spaces > 3) return null
  let ticks = 0
  while (k < end && s[k] === '`') {
    k++
    ticks++
  }
  if (ticks < 3) return null
  while (k < end && (s[k] === ' ' || s[k] === '\t')) k++
  let info = ''
  while (k < end && isWordChar(s[k])) info += s[k++]
  return { info, rest: k }
}

const restIsBlank = (s: string[], from: number, end: number) => {
  for (let k = from; k < end; k++) if (s[k] !== ' ' && s[k] !== '\t' && s[k] !== '\r') return false
  return true
}

/** ```tool (o una variante) y nada más en la línea. Admite hasta 3 espacios de sangría. */
function isOpeningFence(s: string[], start: number, end: number): boolean {
  const p = fenceParts(s, start, end)
  return !!p && FENCE_NAMES.includes(p.info.toLowerCase()) && restIsBlank(s, p.rest, end)
}

/** Línea que solo contiene ``` (con sangría y espacios finales). */
function isClosingFence(s: string[], start: number, end: number): boolean {
  const p = fenceParts(s, start, end)
  return !!p && p.info === '' && restIsBlank(s, p.rest, end)
}

/** Línea incompleta que todavía podría convertirse en una apertura ```tool cuando llegue el resto. */
function couldBecomeOpeningFence(s: string[], start: number, end: number): boolean {
  let k = start
  let spaces = 0
  while (k < end && s[k] === ' ') {
    k++
    spaces++
  }
  if (spaces > 3) return false
  if (k >= end) return true
  if (s[k] !== '`') return false
  let ticks = 0
  while (k < end && s[k] === '`') {
    k++
    ticks++
  }
  if (k >= end) return true
  if (ticks < 3) return false
  while (k < end && (s[k] === ' ' || s[k] === '\t')) k++
  let word = ''
  while (k < end && isWordChar(s[k])) word += s[k++]
  if (!restIsBlank(s, k, end)) return false
  const w = word.toLowerCase()
  return !w || FENCE_NAMES.some((f) => f.startsWith(w))
}

/** Índice de la llave/corchete que cierra el que abre en `start` (respeta cadenas y escapes), o null si no cierra. */
function balancedEnd(s: string[], start: number, cursor: CursorBox): number | null {
  let depth = 0
  let inString = false
  let escaped = false
  let i = start
  const c0 = cursor.value
  if (c0 && c0.start === start && c0.pos <= s.length) {
    depth = c0.depth
    inString = c0.inString
    escaped = c0.escaped
    i = c0.pos
  }
  while (i < s.length) {
    const c = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        cursor.value = undefined
        return i
      }
      if (depth < 0) {
        cursor.value = undefined
        return null
      }
    }
    i++
  }
  cursor.value = { start, pos: s.length, depth, inString, escaped }
  return null
}

interface Body {
  objects: Range[]
  incomplete?: Range
  end: number
  closed: boolean
  needMore: boolean
}

/** Primera línea (posterior a la de `index`) que solo contiene ```. */
function nextClosingFenceLine(s: string[], index: number): { start: number; end: number } | null {
  let i = lineEnd(s, index)
  while (i < s.length) {
    const start = i + 1
    if (start >= s.length) return null
    const end = lineEnd(s, start)
    if (isClosingFence(s, start, end)) return { start, end: end < s.length ? end + 1 : end }
    i = end
  }
  return null
}

/** Contenido que no es JSON claro: el cuerpo llega hasta la siguiente línea de cierre y se repara después. */
function fallbackBody(s: string[], bodyStart: number, final: boolean): Body {
  let i = bodyStart
  while (i < s.length) {
    const end = lineEnd(s, i)
    // una línea de cierre solo cuenta si ya está completa: «```» podría ser el principio de «```json»
    if ((end < s.length || final) && isClosingFence(s, i, end)) {
      return { objects: bodyStart < i ? [{ start: bodyStart, end: i }] : [], end: end < s.length ? end + 1 : end, closed: true, needMore: false }
    }
    i = end < s.length ? end + 1 : end
    if (end >= s.length) break
  }
  if (!final) return { objects: [], end: bodyStart, closed: false, needMore: true }
  return { objects: bodyStart < s.length ? [{ start: bodyStart, end: s.length }] : [], end: s.length, closed: false, needMore: false }
}

function scanBody(s: string[], bodyStart: number, final: boolean, cursor: CursorBox): Body {
  let j = bodyStart
  const objects: Range[] = []
  for (;;) {
    while (j < s.length && isWS(s[j])) j++
    if (j >= s.length) {
      return final ? { objects, end: s.length, closed: false, needMore: false } : { objects, end: j, closed: false, needMore: true }
    }
    if (s[j] === '`') {
      let k = j
      while (k < s.length && s[k] === '`') k++
      if (k - j >= 3) {
        let e = k
        while (e < s.length && (s[e] === ' ' || s[e] === '\t' || s[e] === '\r')) e++
        if (e < s.length) {
          if (s[e] === '\n') e++
        } else if (!final) {
          return { objects, end: j, closed: false, needMore: true } // quizá falte el salto de línea (o más comillas)
        }
        return { objects, end: e, closed: true, needMore: false }
      }
      if (k >= s.length && !final) return { objects, end: j, closed: false, needMore: true }
    } else if (s[j] === '{' || s[j] === '[') {
      const close = balancedEnd(s, j, cursor)
      if (close !== null) {
        objects.push({ start: j, end: close + 1 })
        j = close + 1
        continue
      }
      if (!final) return { objects, end: j, closed: false, needMore: true }
      // JSON sin cerrar: nunca se ejecuta (podría estar cortado). Si más adelante hay una línea de cierre, el bloque llega hasta ella
      const fence = nextClosingFenceLine(s, j)
      if (fence) return { objects, incomplete: { start: j, end: fence.start }, end: fence.end, closed: true, needMore: false }
      return { objects, incomplete: { start: j, end: s.length }, end: s.length, closed: false, needMore: false }
    }
    return fallbackBody(s, bodyStart, final)
  }
}

function scanToolBlocks(s: string[], start: number, final: boolean, cursor: CursorBox): ScanOutput {
  const pieces: Piece[] = []
  let textStart = start
  let i = start
  let atLineStart = start === 0 || s[start - 1] === '\n'
  const flushText = (end: number) => {
    if (end > textStart) pieces.push({ type: 'text', start: textStart, end })
  }
  while (i < s.length) {
    const end = lineEnd(s, i)
    const hasNewline = end < s.length
    if (atLineStart) {
      if (isOpeningFence(s, i, end)) {
        if (!hasNewline && !final) {
          flushText(i)
          return { pieces, undecidedFrom: i }
        }
        const bodyStart = hasNewline ? end + 1 : end
        const body = scanBody(s, bodyStart, final, cursor)
        if (body.needMore) {
          flushText(i)
          return { pieces, undecidedFrom: i }
        }
        flushText(i)
        pieces.push({ type: 'block', block: { range: { start: i, end: body.end }, objects: body.objects, incomplete: body.incomplete, closed: body.closed } })
        textStart = body.end
        i = body.end
        atLineStart = i === 0 || s[i - 1] === '\n'
        continue
      }
      if (!hasNewline && !final && couldBecomeOpeningFence(s, i, end)) {
        flushText(i)
        return { pieces, undecidedFrom: i }
      }
    }
    if (hasNewline) {
      i = end + 1
      atLineStart = true
    } else {
      i = end
      atLineStart = false
    }
  }
  flushText(s.length)
  return { pieces }
}

/**
 * Oculta los bloques ```tool mientras llega la respuesta en streaming: solo deja pasar el texto «normal». Reanaliza desde el
 * último punto ya decidido, así que da lo mismo cómo se parta el texto.
 */
export class TextToolStreamFilter {
  private raw: string[] = []
  private stable = 0
  private cursor: CursorBox = { value: undefined }

  /** Añade un trozo y devuelve el texto nuevo que ya se puede mostrar. */
  push(chunk: string): string {
    for (const ch of chunk) this.raw.push(ch)
    return this.advance(false)
  }

  /** Fin de la respuesta: lo que quedaba retenido (un bloque sin terminar se descarta). */
  finish(): string {
    return this.advance(true)
  }

  private advance(final: boolean): string {
    const out = scanToolBlocks(this.raw, this.stable, final, this.cursor)
    let visible = ''
    for (const p of out.pieces) if (p.type === 'text') visible += this.raw.slice(p.start, p.end).join('')
    this.stable = out.undecidedFrom ?? this.raw.length
    return visible
  }
}
