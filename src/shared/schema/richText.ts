// Markdown ligero con matemáticas (port de StudyModel/RichText.swift).
//
// Subconjunto pensado para lecciones: títulos, párrafos, listas (anidadas), citas, código, tablas, regla, énfasis
// (**negrita**, *cursiva*, ~~tachado~~, ==resaltado==), código en línea, enlaces y LaTeX: en línea `$x^2$` o `\(x^2\)`;
// en pantalla `$$ … $$` o `\[ … \]`. Regla del dólar (como Pandoc): el `$` de apertura no va seguido de espacio, el de
// cierre no va precedido de espacio ni seguido de un dígito → "cuesta $5 y $6" NO es matemática.
// La interfaz dibuja con react-markdown; esto sirve para texto plano, búsquedas, voz y comprobaciones.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'strike'; children: Inline[] }
  | { kind: 'highlight'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'math'; tex: string }
  | { kind: 'link'; children: Inline[]; url: string }
  | { kind: 'lineBreak' }

export type TableAlign = 'left' | 'center' | 'right'

export type RichBlock =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: RichBlock[][] }
  | { kind: 'quote'; blocks: RichBlock[] }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'displayMath'; tex: string }
  | { kind: 'rule' }
  | { kind: 'table'; header: Inline[][]; align: TableAlign[]; rows: Inline[][][] }

const isWS = (ch: string | undefined): boolean => ch === undefined || /^\s$/u.test(ch)
const isLetterOrNumber = (ch: string | undefined): boolean => ch !== undefined && /^[\p{L}\p{N}]$/u.test(ch)
const isNumberChar = (ch: string | undefined): boolean => ch !== undefined && /^\p{N}$/u.test(ch)
/** Espacio horizontal (tabulador o separador Unicode `Zs`, todos en el plano básico), como `.whitespaces` de Swift. */
const isHSpace = (code: number): boolean =>
  code === 9 || code === 0x20 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x202f || code === 0x205f || code === 0x3000
/** Quita los espacios de los extremos recorriendo a mano: con una expresión regular `…+$` era cuadrático (50 000 espacios = segundos). */
const trimWS = (s: string): string => {
  let a = 0, b = s.length
  while (a < b && isHSpace(s.charCodeAt(a))) a++
  while (b > a && isHSpace(s.charCodeAt(b - 1))) b--
  return a === 0 && b === s.length ? s : s.slice(a, b)
}
const trimAllWS = (s: string): string => s.trim()

// MARK: Bloques

const MAX_BLOCK_DEPTH = 16

/** Elemento de lista: sangría, marcador («-», «*», «+», «12.» o «3)») y el resto. */
function listItem(s: string): { indent: number; marker: string; rest: string } | undefined {
  const c = Array.from(s)
  let i = 0
  while (i < c.length && c[i] === ' ') i++
  const indent = i
  if (i >= c.length) return undefined
  const start = i
  if (c[i] === '-' || c[i] === '*' || c[i] === '+') i++
  else {
    let digits = 0
    while (i < c.length && c[i] >= '0' && c[i] <= '9') { digits++; i++ }
    if (digits < 1 || digits > 9 || i >= c.length || (c[i] !== '.' && c[i] !== ')')) return undefined
    i++
  }
  const marker = c.slice(start, i).join('')
  if (i >= c.length || !isWS(c[i])) return undefined
  while (i < c.length && isWS(c[i])) i++
  return { indent, marker, rest: c.slice(i).join('') }
}

/** Título: `^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$`. */
function heading(s: string): { level: number; text: string } | undefined {
  const c = Array.from(s)
  let i = 0, spaces = 0
  while (i < c.length && c[i] === ' ') { spaces++; if (spaces > 3) return undefined; i++ }
  let level = 0
  while (i < c.length && c[i] === '#') { level++; i++ }
  if (level < 1 || level > 6 || i >= c.length || !isWS(c[i])) return undefined
  let rest = c.slice(i)
  while (rest.length && isWS(rest[0])) rest.shift()
  while (rest.length && isWS(rest[rest.length - 1])) rest.pop()
  while (rest.length && rest[rest.length - 1] === '#') rest.pop()
  while (rest.length && isWS(rest[rest.length - 1])) rest.pop()
  return { level, text: rest.join('') }
}

/** Regla horizontal: `^ {0,3}([-*_])( *\1){2,} *$`. */
function isRule(s: string): boolean {
  const c = Array.from(s)
  let i = 0, spaces = 0
  while (i < c.length && c[i] === ' ') { spaces++; if (spaces > 3) return false; i++ }
  if (i >= c.length || !['-', '*', '_'].includes(c[i])) return false
  const mark = c[i]
  let count = 0
  for (const ch of c.slice(i)) { if (ch === mark) count++; else if (ch !== ' ') return false }
  return count >= 3
}

/** Fila separadora de una tabla (`| --- | :-: |`). */
function isTableSeparator(s: string): boolean {
  let t = trimAllWS(s)
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  if (!t) return false
  for (const cell of t.split('|')) {
    let c = trimAllWS(cell)
    if (c.startsWith(':')) c = c.slice(1)
    if (c.endsWith(':')) c = c.slice(0, -1)
    if (!c || !/^-+$/.test(c)) return false
  }
  return true
}

const isBlank = (s: string): boolean => trimWS(s) === ''
const indentOf = (s: string): number => s.length - s.replace(/^ +/, '').length

class BlockParser {
  i = 0
  constructor(private lines: string[], private depth = 0) {}

  parseAll(): RichBlock[] {
    const out: RichBlock[] = []
    while (this.i < this.lines.length) {
      const b = this.parseNext()
      if (b) out.push(b)
    }
    return out
  }

  startsBlock(line: string, allowList = true): boolean {
    const t = trimWS(line)
    if (t.startsWith('```') || t.startsWith('~~~') || t.startsWith('$$') || t.startsWith('\\[') || t.startsWith('>')) return true
    if (heading(line) || isRule(line)) return true
    if (allowList) {
      const m = listItem(line)
      if (m) {
        // una lista numerada solo interrumpe un párrafo si empieza en 1
        const n = /^\d+$/.test(m.marker.slice(0, -1)) ? Number(m.marker.slice(0, -1)) : undefined
        if (n !== undefined && n !== 1) return false
        return true
      }
    }
    return false
  }

  private displayMath(open: string, close: string, t: string): RichBlock {
    const rest = t.slice(open.length)
    const end = rest.indexOf(close)
    if (end >= 0) { this.i++; return { kind: 'displayMath', tex: rest.slice(0, end).trim() } }
    const body = [rest]
    this.i++
    while (this.i < this.lines.length) {
      const r = this.lines[this.i].indexOf(close)
      if (r >= 0) { body.push(this.lines[this.i].slice(0, r)); this.i++; break }
      body.push(this.lines[this.i]); this.i++
    }
    return { kind: 'displayMath', tex: body.join('\n').trim() }
  }

  parseNext(): RichBlock | undefined {
    const lines = this.lines
    const line = lines[this.i]
    if (isBlank(line)) { this.i++; return undefined }
    const t = trimWS(line)
    // código con vallas
    if (t.startsWith('```') || t.startsWith('~~~')) {
      const fence = t.slice(0, 3)
      const lang = trimWS(t.slice(3))
      this.i++
      const body: string[] = []
      while (this.i < lines.length && !trimWS(lines[this.i]).startsWith(fence)) { body.push(lines[this.i]); this.i++ }
      if (this.i < lines.length) this.i++
      return lang ? { kind: 'code', language: lang, text: body.join('\n') } : { kind: 'code', text: body.join('\n') }
    }
    // matemáticas en pantalla
    if (t.startsWith('$$')) return this.displayMath('$$', '$$', t)
    if (t.startsWith('\\[')) return this.displayMath('\\[', '\\]', t)
    // título
    const h = heading(line)
    if (h) { this.i++; return { kind: 'heading', level: h.level, inlines: parseInline(h.text) } }
    // tabla
    if (line.includes('|') && this.i + 1 < lines.length && lines[this.i + 1].includes('-') && isTableSeparator(lines[this.i + 1])) return this.parseTable()
    // regla
    if (isRule(line)) { this.i++; return { kind: 'rule' } }
    // cita (sin anidar más allá de `MAX_BLOCK_DEPTH`: lo que sobra se lee como párrafo)
    if (t.startsWith('>') && this.depth < MAX_BLOCK_DEPTH) {
      const inner: string[] = []
      while (this.i < lines.length) {
        const l = trimWS(lines[this.i])
        if (l.startsWith('>')) { const rest = l.slice(1); inner.push(rest.startsWith(' ') ? rest.slice(1) : rest); this.i++ }
        else if (!isBlank(lines[this.i]) && !this.startsBlock(lines[this.i]) && inner.length) { inner.push(lines[this.i]); this.i++ }
        else break
      }
      return { kind: 'quote', blocks: new BlockParser(inner, this.depth + 1).parseAll() }
    }
    // lista
    if (this.depth < MAX_BLOCK_DEPTH && listItem(line)) return this.parseList()
    // párrafo
    const para = [line]
    this.i++
    while (this.i < lines.length && !isBlank(lines[this.i]) && !this.startsBlock(lines[this.i])) {
      if (lines[this.i].includes('|') && this.i + 1 < lines.length && lines[this.i + 1].includes('-') && isTableSeparator(lines[this.i + 1])) break
      para.push(lines[this.i]); this.i++
    }
    const parts = para.map((l, k) => (k < para.length - 1 && l.endsWith('  ') ? l.slice(0, -2) + '\\' : l))
    return { kind: 'paragraph', inlines: parseInline(trimWS(parts.join('\n'))) }
  }

  parseTable(): RichBlock {
    const cells = (row: string): string[] => {
      let r = trimWS(row)
      if (r.startsWith('|')) r = r.slice(1)
      if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1)
      // dividir por | sin escapar y fuera de $…$
      const out: string[] = []
      let cur = ''
      let inMath = false
      let prev = ' '
      for (const ch of r) {
        if (ch === '$' && prev !== '\\') inMath = !inMath
        if (ch === '|' && !inMath && prev !== '\\') { out.push(cur); cur = '' } else cur += ch
        prev = ch
      }
      out.push(cur)
      return out.map((c) => trimWS(c).replace(/\\\|/g, '|'))
    }
    const header = cells(this.lines[this.i])
    const align: TableAlign[] = cells(this.lines[this.i + 1]).map((c) => {
      const l = c.startsWith(':'), r = c.endsWith(':')
      return l && r ? 'center' : r ? 'right' : 'left'
    })
    this.i += 2
    const rows: Inline[][][] = []
    while (this.i < this.lines.length && !isBlank(this.lines[this.i]) && this.lines[this.i].includes('|')) {
      const cs = cells(this.lines[this.i])
      while (cs.length < header.length) cs.push('')
      rows.push(cs.slice(0, Math.max(header.length, 1)).map(parseInline))
      this.i++
    }
    return { kind: 'table', header: header.map(parseInline), align, rows }
  }

  parseList(): RichBlock {
    const lines = this.lines
    const first = listItem(lines[this.i])
    if (!first) { this.i++; return { kind: 'paragraph', inlines: [] } }
    const baseIndent = first.indent
    const ordered = isNumberChar(first.marker[0])
    const start = ordered ? Number(first.marker.slice(0, -1)) || 1 : 1
    const items: string[][] = []
    let cur: string[] = []
    let contentIndent = 0
    const flush = (): void => { if (cur.length) { items.push(cur); cur = [] } }
    while (this.i < lines.length) {
      const line = lines[this.i]
      if (isBlank(line)) {
        // línea en blanco: la lista sigue si lo siguiente es otro elemento o contenido sangrado
        let j = this.i + 1
        while (j < lines.length && isBlank(lines[j])) j++
        if (j >= lines.length) break
        const nxt = lines[j]
        const m = listItem(nxt)
        if (m && m.indent >= baseIndent) { cur.push(''); this.i++; continue }
        if (indentOf(nxt) > baseIndent) { cur.push(''); this.i++; continue }
        break
      }
      const m = listItem(line)
      if (m) {
        const ind = m.indent
        if (ind === baseIndent && isNumberChar(m.marker[0]) === ordered) {
          flush()
          contentIndent = ind + Array.from(m.marker).length + 1
          cur = [m.rest]; this.i++; continue
        }
        if (ind < baseIndent) break
        if (ind === baseIndent) break // otro tipo de lista al mismo nivel: termina esta
        // anidada: conservar con su sangría relativa
        cur.push(line.slice(Math.min(contentIndent, indentOf(line)))); this.i++; continue
      }
      if (indentOf(line) > baseIndent || (cur.length && !this.startsBlock(line, false) && indentOf(line) >= baseIndent)) {
        if (indentOf(line) >= contentIndent || indentOf(line) > baseIndent) { cur.push(line.slice(Math.min(contentIndent, indentOf(line)))); this.i++; continue }
      }
      if (cur.length && !this.startsBlock(line)) { cur.push(trimWS(line)); this.i++; continue } // continuación perezosa
      break
    }
    flush()
    return { kind: 'list', ordered, start, items: items.map((itemLines) => new BlockParser(itemLines, this.depth + 1).parseAll()) }
  }
}

// MARK: En línea

const INLINE_MAX_DEPTH = 12
/** Distancia máxima (en caracteres) a la que se busca el cierre de un énfasis, fórmula, código o enlace. */
const MAX_SPAN = 4000
const ESCAPABLE = new Set(Array.from('\\`*_{}[]()#+-.!$<>|~=^"\'&%:;,/?@'))

/**
 * Analizador en línea. Las búsquedas de cierre comparten un presupuesto de pasos proporcional al texto (contra entradas
 * hostiles cuadráticas); al agotarse, lo que queda se lee como texto literal. El anidamiento también tiene un tope.
 */
class InlineParser {
  private budget: number
  constructor(n: number) {
    this.budget = 100_000 + 8 * n
  }

  /** Gasta `n` pasos de búsqueda; false = presupuesto agotado. */
  private spend(n = 1): boolean {
    this.budget -= n
    return this.budget >= 0
  }

  parseChars(c: string[], depth: number): Inline[] {
    const out: Inline[] = []
    let buf = ''
    const flush = (): void => { if (buf) { out.push({ kind: 'text', text: buf }); buf = '' } }
    let i = 0
    const n = c.length
    const nest = depth < INLINE_MAX_DEPTH
    while (i < n) {
      const ch = c[i]
      switch (ch) {
        case '\\': {
          if (i + 1 < n) {
            const nx = c[i + 1]
            if (nx === '\n') { flush(); out.push({ kind: 'lineBreak' }); i += 2; continue }
            if (nx === '(') {
              const end = this.findSeq(c, i + 2, ['\\', ')'])
              if (end !== undefined) { flush(); out.push({ kind: 'math', tex: trimWS(c.slice(i + 2, end).join('')) }); i = end + 2; continue }
            }
            if (nx === '[') {
              const end = this.findSeq(c, i + 2, ['\\', ']'])
              if (end !== undefined) { flush(); out.push({ kind: 'math', tex: trimWS(c.slice(i + 2, end).join('')) }); i = end + 2; continue }
            }
            if (ESCAPABLE.has(nx)) { buf += nx; i += 2; continue }
          }
          buf += ch; i++
          break
        }
        case '`': {
          let run = 1
          while (i + run < n && c[i + run] === '`') run++
          const fence = Array(run).fill('`') as string[]
          const end = this.findSeq(c, i + run, fence)
          if (end !== undefined) {
            flush()
            let code = c.slice(i + run, end).join('')
            if (code.startsWith(' ') && code.endsWith(' ') && Array.from(code).length > 1) code = code.slice(1, -1)
            out.push({ kind: 'code', text: code }); i = end + run
          } else { buf += fence.join(''); i += run }
          break
        }
        case '$': {
          // $$…$$ en línea
          if (i + 1 < n && c[i + 1] === '$') {
            const end = this.findSeq(c, i + 2, ['$', '$'])
            if (end !== undefined) { flush(); out.push({ kind: 'math', tex: trimWS(c.slice(i + 2, end).join('')) }); i = end + 2; continue }
          }
          const end = this.mathEnd(c, i)
          if (end !== undefined) { flush(); out.push({ kind: 'math', tex: c.slice(i + 1, end).join('') }); i = end + 1 }
          else { buf += ch; i++ }
          break
        }
        case '[': {
          const r = nest ? this.linkRange(c, i) : undefined
          if (r) {
            flush()
            const [textEnd, urlEnd] = r
            const url = trimWS(c.slice(textEnd + 2, urlEnd).join(''))
            out.push({ kind: 'link', children: this.parseChars(c.slice(i + 1, textEnd), depth + 1), url }); i = urlEnd + 1
          } else { buf += ch; i++ }
          break
        }
        case '*': case '_': {
          let run = 1
          while (i + run < n && c[i + run] === ch) run++
          const before = i > 0 ? c[i - 1] : undefined
          const after = i + run < n ? c[i + run] : undefined
          const canOpen = nest && !isWS(after) && (ch === '*' || !isLetterOrNumber(before))
          const close = canOpen && run <= 3 ? this.findCloser(c, i + run, ch, run) : undefined
          if (close !== undefined) {
            flush()
            const kids = this.parseChars(c.slice(i + run, close), depth + 1)
            if (run === 1) out.push({ kind: 'italic', children: kids })
            else if (run === 2) out.push({ kind: 'bold', children: kids })
            else out.push({ kind: 'bold', children: [{ kind: 'italic', children: kids }] })
            i = close + run
          } else { buf += ch.repeat(run); i += run }
          break
        }
        case '~': case '=': {
          if (nest && i + 1 < n && c[i + 1] === ch && !isWS(i + 2 < n ? c[i + 2] : undefined)) {
            const close = this.findSeq(c, i + 2, [ch, ch])
            if (close !== undefined && close > i + 2) {
              flush()
              const kids = this.parseChars(c.slice(i + 2, close), depth + 1)
              out.push(ch === '~' ? { kind: 'strike', children: kids } : { kind: 'highlight', children: kids })
              i = close + 2
              continue
            }
          }
          buf += ch; i++
          break
        }
        case '\n':
          // salto simple = espacio
          if (!buf.endsWith(' ') && (buf || out.length)) buf += ' '
          i++
          break
        default:
          buf += ch; i++
      }
    }
    flush()
    return out
  }

  /** Posición del `$` de cierre si en `open` empieza una fórmula válida. */
  private mathEnd(c: string[], open: number): number | undefined {
    const n = c.length
    if (open + 1 >= n) return undefined
    const first = c[open + 1]
    if (isWS(first) || first === '$') return undefined
    let j = open + 1
    const limit = Math.min(n, open + MAX_SPAN)
    while (j < limit) {
      if (!this.spend()) return undefined
      const ch = c[j]
      if (ch === '\\') { j += 2; continue }
      if (ch === '$') {
        const prev = c[j - 1]
        if (isWS(prev) || j === open + 1) return undefined
        if (j + 1 < n && isNumberChar(c[j + 1])) { j++; continue }
        return j
      }
      j++
    }
    return undefined
  }

  private linkRange(c: string[], open: number): [number, number] | undefined {
    const n = c.length
    let depth = 0
    let j = open
    let closed = false
    const limit = Math.min(n, open + MAX_SPAN)
    while (j < limit) {
      if (!this.spend()) return undefined
      const ch = c[j]
      if (ch === '\\') { j += 2; continue }
      if (ch === '$') {
        const e = this.mathEnd(c, j)
        if (e !== undefined) { j = e + 1; continue }
      }
      if (ch === '[') depth++
      if (ch === ']') { depth--; if (depth === 0) { closed = true; break } }
      j++
    }
    if (!closed || j >= n || c[j] !== ']' || j + 1 >= n || c[j + 1] !== '(') return undefined
    let k = j + 2
    let pd = 1
    const urlLimit = Math.min(n, k + MAX_SPAN)
    while (k < urlLimit) {
      if (!this.spend()) return undefined
      if (c[k] === '(') pd++
      else if (c[k] === ')') { pd--; if (pd === 0) return [j, k] }
      k++
    }
    return undefined
  }

  private findSeq(c: string[], from: number, seq: string[]): number | undefined {
    if (!seq.length || from < 0) return undefined
    let j = from
    const end = Math.min(c.length, from + MAX_SPAN + seq.length)
    while (j + seq.length <= end) {
      if (!this.spend()) return undefined
      if (c[j] === '\\' && seq[0] !== '\\') { j += 2; continue }
      let k = 0
      while (k < seq.length && c[j + k] === seq[k]) k++
      if (k === seq.length) return j
      if (k > 1 && !this.spend(k)) return undefined
      j++
    }
    return undefined
  }

  /** Busca el cierre de un énfasis saltando código y matemáticas. */
  private findCloser(c: string[], from: number, delim: string, run: number): number | undefined {
    const n = c.length
    let j = from
    const limit = Math.min(n, from + MAX_SPAN)
    while (j < limit) {
      if (!this.spend()) return undefined
      const ch = c[j]
      if (ch === '\\') { j += 2; continue }
      if (ch === '`') {
        let r = 1
        while (j + r < n && c[j + r] === '`') r++
        if (!this.spend(r)) return undefined
        const e = this.findSeq(c, j + r, Array(r).fill('`') as string[])
        if (e !== undefined) { j = e + r; continue }
        j += r
        continue
      }
      if (ch === '$') {
        const e = this.mathEnd(c, j)
        if (e !== undefined) { j = e + 1; continue }
      }
      if (ch === delim) {
        let r = 1
        while (j + r < n && c[j + r] === delim) r++
        if (!this.spend(r)) return undefined
        const before = c[j - 1]
        const after = j + r < n ? c[j + r] : undefined
        const wordAfter = isLetterOrNumber(after)
        if (r === run && !isWS(before) && !(delim === '_' && wordAfter)) return j
        j += r
        continue
      }
      j++
    }
    return undefined
  }
}

// MARK: API

export function parseInline(text: string): Inline[] {
  const chars = Array.from(text)
  return new InlineParser(chars.length).parseChars(chars, 0)
}

export function parseRichText(markdown: string): RichBlock[] {
  const text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ')
  return new BlockParser(text.split('\n')).parseAll()
}

/**
 * Para textos cortos junto a una respuesta («$\theta = $», «$ x =$»): quita los espacios de dentro de la única fórmula,
 * que la regla del dólar dejaría sin dibujar. Solo actúa si hay exactamente dos «$».
 */
export function tightMathAffix(text: string): string {
  if ((text.match(/\$/g) ?? []).length !== 2) return text
  const open = text.indexOf('$')
  const close = text.indexOf('$', open + 1)
  const inner = trimWS(text.slice(open + 1, close))
  if (!inner) return text
  return text.slice(0, open) + '$' + inner + '$' + text.slice(close + 1)
}

export function inlinePlainText(inlines: Inline[]): string {
  return inlines.map((i): string => {
    switch (i.kind) {
      case 'text': return i.text
      case 'bold': case 'italic': case 'strike': case 'highlight': case 'link': return inlinePlainText(i.children)
      case 'code': return i.text
      case 'math': return i.tex
      case 'lineBreak': return '\n'
    }
  }).join('')
}

export function richPlainText(blocks: RichBlock[]): string {
  return blocks.map((b): string => {
    switch (b.kind) {
      case 'heading': case 'paragraph': return inlinePlainText(b.inlines)
      case 'list': return b.items.map(richPlainText).join('\n')
      case 'quote': return richPlainText(b.blocks)
      case 'code': return b.text
      case 'displayMath': return b.tex
      case 'rule': return ''
      case 'table': return [b.header, ...b.rows].map((r) => r.map(inlinePlainText).join(' ')).join('\n')
    }
  }).join('\n')
}

/** ¿Contiene matemáticas? (para decidir cómo dibujar un texto corto) */
export function inlineHasMath(inlines: Inline[]): boolean {
  return inlines.some((i) => i.kind === 'math' || ((i.kind === 'bold' || i.kind === 'italic' || i.kind === 'strike' || i.kind === 'highlight' || i.kind === 'link') && inlineHasMath(i.children)))
}

export const RichText = {
  parse: parseRichText,
  parseInline,
  tightMathAffix,
  /** Texto plano de una lista de bloques. */
  plainText: richPlainText,
  /** Texto plano de un texto en línea. */
  inlineText: inlinePlainText,
  hasMath: inlineHasMath,
  maxBlockDepth: MAX_BLOCK_DEPTH
}
