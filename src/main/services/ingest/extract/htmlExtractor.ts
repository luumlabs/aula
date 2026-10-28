// HTML → Markdown ligero (títulos `#`, listas `- `, tablas `a | b`), sin ejecutar nada. Quita scripts, estilos, navegación,
// pies, anuncios y avisos de cookies, e intenta aislar el contenido principal (`main`, `article`, contenedores típicos).
import { charCount, chars, collapseWhitespace, isLetter, isNumber, prefixChars, trimWS, trimWSNL } from '../text/unicode'
import { Markers } from './markers'
import { HNode, parseHTML } from './htmlParser'

export interface HTMLContent {
  text: string
  title: string | null
  firstHeading: string | null
  metadata: Record<string, string>
  hasFigures: boolean
  /** Se aisló un contenedor principal (`main`, `article`…). */
  isolated: boolean
}

export interface HTMLOptions {
  /** Intentar quedarse solo con el contenido principal de la página. */
  isolateMainContent?: boolean
}

export function extractHTML(html: string, options: HTMLOptions = {}): HTMLContent {
  const isolate = options.isolateMainContent ?? true
  const root = parseHTML(html)
  return extractFromTree(root, isolate)
}

export function extractFromTree(root: HNode, isolate: boolean): HTMLContent {
  const htmlEl = root.firstElement('html')
  const head = root.firstElement('head')
  const body = root.firstElement('body') ?? htmlEl ?? root

  // Metadatos
  const meta: Record<string, string> = {}
  let title: string | null = null
  const t = (head ?? root).firstElement('title') ?? root.firstElement('title')
  if (t) {
    const s = collapse(t.plainText)
    if (s) title = s
  }
  for (const m of (head ?? root).elements('meta')) {
    const name = (m.attr('name') ?? m.attr('property') ?? '').toLowerCase()
    const content = collapse(m.attr('content') ?? '')
    if (!content) continue
    switch (name) {
      case 'author': case 'article:author': if (meta.author === undefined) meta.author = content; break
      case 'description': case 'og:description': if (meta.description === undefined) meta.description = content; break
      case 'og:site_name': meta.siteName = content; break
      case 'og:title': if (title === null) title = content; break
      case 'keywords': meta.keywords = content; break
      case 'article:published_time': case 'date': case 'dc.date': if (meta.created === undefined) meta.created = content; break
      default: break
    }
  }
  const lang = htmlEl?.attr('lang') ?? htmlEl?.attr('xml:lang')
  if (lang) meta.language = lang

  // Contenido principal
  let contentRoot = body
  let isolated = false
  if (isolate) {
    const found = findMainContent(body)
    if (found) { contentRoot = found; isolated = true }
  }
  const renderer = new Renderer(isolated, false)
  renderer.visitChildren(contentRoot)
  renderer.endBlock()
  const text = renderer.output()
  if (!text && isolated) {
    // El contenedor elegido resultó vacío: se vuelve a intentar con toda la página
    const again = new Renderer(false, false)
    again.visitChildren(body)
    again.endBlock()
    return { text: again.output(), title: title ?? again.firstHeading, firstHeading: again.firstHeading, metadata: meta, hasFigures: again.hasFigures, isolated: false }
  }
  return { text, title: title ?? renderer.firstHeading, firstHeading: renderer.firstHeading, metadata: meta, hasFigures: renderer.hasFigures, isolated }
}

/** TeX sin el envoltorio `{\displaystyle …}` que ponen Wikipedia y otros. */
export function cleanTeX(raw: string): string {
  let tex = trimWSNL(raw)
  const cs = chars(tex)
  if (tex.startsWith('{') && tex.endsWith('}') && cs.length > 2) {
    // Solo se quitan las llaves si abren y cierran la expresión entera
    let depth = 0
    let wraps = true
    for (let i = 0; i < cs.length; i++) {
      if (cs[i] === '{') depth++
      else if (cs[i] === '}') { depth--; if (depth === 0 && i < cs.length - 1) { wraps = false; break } }
    }
    if (wraps) tex = cs.slice(1, -1).join('')
  }
  for (const prefix of ['\\displaystyle ', '\\textstyle ', '\\scriptstyle ']) if (tex.startsWith(prefix)) tex = tex.slice(prefix.length)
  return trimWSNL(tex)
}

/** Número de una lista (`<ol start>`, `<li value>`) acotado. */
export function clampListNumber(v: number): number {
  return Math.min(Math.max(v, -999_999), 999_999_999)
}

/** `Int(…)` de Swift: entero de 64 bits o `null`. */
function parseIntOrNull(s: string | undefined): number | null {
  if (s === undefined || !/^[+-]?\d+$/.test(s)) return null
  const v = Number(s)
  return Math.abs(v) > 9.223372036854776e18 ? null : v
}

export function collapse(s: string): string {
  return collapseWhitespace(s)
}

// MARK: Reglas de poda

/** Etiquetas que nunca aportan texto de estudio. */
export const SKIPPED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'audio', 'video', 'select', 'option',
  'optgroup', 'datalist', 'button', 'input', 'textarea', 'head', 'meta', 'link', 'title', 'base', 'map', 'area', 'dialog',
  'frameset', 'frame', 'applet', 'param', 'source', 'track', 'nav', 'menu', 'label'
])
/** Palabras de clase/id que delatan elementos que no son contenido (palabras completas). */
const BOILERPLATE_WORDS = new Set([
  'nav', 'navbar', 'navigation', 'navbox', 'menu', 'sidebar', 'footer', 'cookie', 'cookies', 'consent', 'gdpr', 'banner', 'popup', 'modal',
  'advert', 'advertisement', 'ads', 'adsbygoogle', 'social', 'share', 'sharing', 'newsletter', 'subscribe', 'breadcrumb', 'breadcrumbs',
  'comments', 'related', 'recommended', 'toolbar', 'skiplink', 'sr-only', 'visually-hidden', 'screen-reader-text', 'noprint', 'toc-toggle'
])
/** Palabras que solo son boilerplate fuera del contenido principal. */
const OUTSIDE_ONLY_WORDS = new Set(['header', 'widget', 'masthead', 'topbar', 'search'])
const CONTAINER_TAGS = new Set(['div', 'section', 'aside', 'ul', 'ol', 'nav', 'header', 'footer', 'form', 'span', 'p', 'table'])

export function classWords(n: HNode): Set<string> {
  const words = new Set<string>()
  for (const c of n.classAndID.split(/\p{White_Space}+/u)) {
    if (!c) continue
    words.add(c)
    for (const piece of c.split(/[^\p{Alphabetic}\p{N}]+/u)) if (piece) words.add(piece)
  }
  return words
}

export function isHidden(n: HNode): boolean {
  if (n.attr('hidden') !== undefined) return true
  if ((n.attr('aria-hidden') ?? '').toLowerCase() === 'true') return true
  const style = (n.attr('style') ?? '').toLowerCase().replace(/ /g, '')
  if (style && (style.includes('display:none') || style.includes('visibility:hidden'))) return true
  return false
}

/** Longitud del texto visible (sin elementos descartados), con tope; con `maxNodes`, más nodos cuentan como largo. */
export function visibleTextLength(n: HNode, cap = Number.MAX_SAFE_INTEGER, maxNodes = Number.MAX_SAFE_INTEGER): number {
  let total = 0
  let visited = 0
  const stack: HNode[] = [n]
  while (stack.length) {
    const cur = stack.pop() as HNode
    visited++
    if (visited > maxNodes) return Math.max(total, cap)
    if (cur.isText) {
      total += visibleCount(cur.text)
      if (total >= cap) return total
      continue
    }
    if (cur !== n && (SKIPPED_TAGS.has(cur.tag) || isHidden(cur))) continue
    for (const c of cur.children) stack.push(c)
  }
  return total
}

/** Caracteres visibles (escalares que no son espacios ni controles; los espacios Unicode habituales no cuentan). */
export function visibleCount(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) { if (c > 0x20 && c !== 0x7f) n++; continue }
    if (c >= 0xdc00 && c <= 0xdfff) continue
    if (c === 0xa0 || (c >= 0x2000 && c <= 0x200b) || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) continue
    n++
  }
  return n
}

/** Longitud visible de cada elemento en un solo recorrido (postorden). */
class VisibleLengths {
  private readonly map = new Map<HNode, number>()

  constructor(root: HNode) {
    const stack: Array<[HNode, boolean]> = [[root, false]]
    while (stack.length) {
      const [node, visited] = stack.pop() as [HNode, boolean]
      if (visited) {
        let total = 0
        for (const c of node.children) total += c.isText ? visibleCount(c.text) : this.map.get(c) ?? 0
        this.map.set(node, total)
      } else {
        stack.push([node, true])
        for (const c of node.children) if (!c.isText && !SKIPPED_TAGS.has(c.tag) && !isHidden(c)) stack.push([c, false])
      }
    }
  }

  length(n: HNode): number {
    return this.map.get(n) ?? visibleTextLength(n)
  }
}

// MARK: Contenido principal

const PATTERN_IDS = ['mw-content-text', 'bodycontent', 'article-body', 'articlebody', 'post-content', 'entry-content', 'post-body', 'article-content', 'story-body', 'content-body', 'main-content', 'maincontent', 'page-content', 'markdown-body', 'docs-content', 'content', 'main']

export function findMainContent(body: HNode): HNode | null {
  const lengths = new VisibleLengths(body)
  const total = Math.max(1, lengths.length(body))
  // 1. <main> o role="main"
  const mains = body.elements('main')
  const stack: HNode[] = [...body.children].reverse()
  while (stack.length) {
    const n = stack.pop() as HNode
    if (n.isText) continue
    if ((n.attr('role') ?? '').toLowerCase() === 'main' && n.tag !== 'main') mains.push(n)
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
  }
  const bestMain = largest(mains, lengths)
  if (bestMain && lengths.length(bestMain) >= 200) return bestMain
  // 2. <article>
  const articles = body.elements('article')
  const bestArticle = largest(articles, lengths)
  if (bestArticle) {
    const len = lengths.length(bestArticle)
    if (len >= 200 && (len >= 0.5 * total || (articles.length === 1 && len >= 0.3 * total))) return bestArticle
  }
  // 3. Contenedores típicos por id/clase
  const candidates: HNode[] = []
  const stack2: HNode[] = [...body.children].reverse()
  while (stack2.length) {
    const n = stack2.pop() as HNode
    if (n.isText) continue
    const id = (n.attr('id') ?? '').toLowerCase()
    const words = classWords(n)
    if (PATTERN_IDS.includes(id) || [...words].some((w) => w.length > 7 && PATTERN_IDS.includes(w))) candidates.push(n)
    for (let i = n.children.length - 1; i >= 0; i--) stack2.push(n.children[i])
  }
  const best = largest(candidates, lengths)
  if (best) {
    const len = lengths.length(best)
    if (len >= 300 && len >= 0.4 * total) return best
  }
  return null
}

function largest(nodes: HNode[], lengths: VisibleLengths): HNode | null {
  let best: HNode | null = null
  let bestLen = -1
  for (const n of nodes) {
    const l = lengths.length(n)
    if (l > bestLen) { best = n; bestLen = l }
  }
  return best
}

// MARK: Renderizado

interface ListState { ordered: boolean; counter: number }

const SPACE_CODES = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c, 0xa0, 0x202f, 0x205f, 0x3000])

/**
 * Línea en construcción. Se guarda en trozos y se recuerda el último carácter: `endsWith` sobre una cadena hecha a base de
 * `+=` obliga a V8 a aplanarla cada vez (cuadrático en un texto de megas).
 */
class LineBuffer {
  private parts: string[] = []
  length = 0
  last = ''

  append(s: string): void {
    if (!s) return
    this.parts.push(s)
    this.length += s.length
    this.last = s[s.length - 1]
  }

  /** ¿Hay texto y no acaba en salto de línea? */
  get open(): boolean {
    return this.length > 0 && this.last !== '\n'
  }

  take(): string {
    const text = this.parts.join('')
    this.parts = []
    this.length = 0
    this.last = ''
    return text
  }
}

class Renderer {
  private lines: string[] = []
  private cur = new LineBuffer()
  private pendingSpace = false
  private prefixFirst: string | null = null
  private listStack: ListState[] = []
  private quoteDepth = 0
  hasFigures = false
  firstHeading: string | null = null
  private depth = 0

  constructor(private readonly isolated: boolean, private readonly flatten: boolean) {}

  output(): string {
    const result: string[] = []
    let blank = false
    for (const l of this.lines) {
      if (!l) {
        if (!blank && result.length) result.push('')
        blank = true
      } else {
        result.push(l)
        blank = false
      }
    }
    while (result.length && result[result.length - 1] === '') result.pop()
    return result.join('\n')
  }

  /** Texto de una sola línea (celdas, títulos…). */
  inlineOutput(): string {
    this.endBlock()
    return collapse(this.lines.join(' '))
  }

  private appendText(s: string): void {
    let chunk = ''
    for (const ch of s) {
      const v = ch.codePointAt(0) ?? 0
      if (SPACE_CODES.has(v) || (v >= 0x2000 && v <= 0x200a)) { this.flushChunk(chunk); chunk = ''; this.pendingSpace = true; continue }
      if ((v >= 0x200b && v <= 0x200d) || v === 0xfeff || v === 0xad) continue
      if (this.pendingSpace) {
        this.flushChunk(chunk)
        chunk = ''
        if (this.cur.open) this.cur.append(' ')
        this.pendingSpace = false
      }
      chunk += ch
    }
    this.flushChunk(chunk)
  }

  private flushChunk(chunk: string): void {
    this.cur.append(chunk)
  }

  /** Texto ya formado (fórmulas, figuras…) con un espacio a cada lado si lo traía, sin duplicar espacios. */
  private appendRaw(s: string): void {
    const core = trimWS(s)
    if (!core) return
    if (s.startsWith(' ')) this.pendingSpace = true
    if (this.pendingSpace && this.cur.open) this.cur.append(' ')
    this.pendingSpace = s.endsWith(' ')
    this.cur.append(core)
  }

  endBlock(): void {
    const text = trimWSNL(this.cur.take())
    this.pendingSpace = false
    if (this.flatten) {
      if (text) this.lines.push(text)
      return
    }
    if (!text) { this.prefixFirst = null; return }
    const quote = '> '.repeat(this.quoteDepth)
    const indent = '  '.repeat(this.listStack.length)
    let first = true
    for (const raw of text.split('\n')) {
      if (!raw) continue
      const line = trimWS(raw)
      if (!line) continue
      if (first) {
        this.lines.push(quote + (this.prefixFirst ?? indent) + line)
        first = false
      } else {
        this.lines.push(quote + indent + line)
      }
    }
    this.prefixFirst = null
  }

  private blankLine(): void {
    if (this.flatten) return
    const last = this.lines[this.lines.length - 1]
    if (last !== undefined && last !== '') this.lines.push('')
  }

  private emitRaw(line: string): void {
    if (this.flatten) { this.lines.push(line); return }
    this.lines.push('> '.repeat(this.quoteDepth) + line)
  }

  visitChildren(n: HNode): void {
    for (const c of n.children) this.visit(c)
  }

  private shouldSkip(n: HNode): boolean {
    const tag = n.tag
    if (SKIPPED_TAGS.has(tag)) return true
    if (isHidden(n)) return true
    if (tag === 'footer') return true
    // Dentro del contenido principal, un aside/header puede ser contenido (notas, título del artículo)
    if ((tag === 'aside' || tag === 'header') && !this.isolated) return true
    const role = (n.attr('role') ?? '').toLowerCase()
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return !this.isolated || tag !== 'header'
    if (CONTAINER_TAGS.has(tag)) {
      const words = classWords(n)
      if (words.size) {
        let hit = [...words].some((w) => BOILERPLATE_WORDS.has(w))
        if (!hit && !this.isolated) hit = [...words].some((w) => OUTSIDE_ONLY_WORDS.has(w))
        // Con tope de nodos: contenedores «share» anidados sobre muchos nodos vacíos no deben tardar
        if (hit && visibleTextLength(n, 1500, 20_000) < 1500) return true
      }
      if (tag === 'form' && role === 'search') return true
    }
    return false
  }

  visit(n: HNode): void {
    if (n.isText) { this.appendText(n.text); return }
    if (this.shouldSkip(n)) {
      if (n.tag === 'script') this.visitMathScript(n)
      return
    }
    this.depth++
    try {
      if (this.depth > 400) return
      const tag = n.tag
      switch (tag) {
        case 'br':
          if (this.flatten) this.pendingSpace = true
          else { this.cur.append('\n'); this.pendingSpace = false }
          break
        case 'hr':
          this.endBlock(); this.blankLine()
          break
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          this.heading(n, Number(tag.slice(1)) || 2)
          break
        case 'p': case 'section': case 'article': case 'main': case 'figure': case 'figcaption': case 'details': case 'summary':
        case 'address': case 'center': case 'fieldset': case 'legend': case 'caption':
          this.endBlock(); this.visitChildren(n); this.endBlock(); this.blankLine()
          break
        case 'div': case 'dl': case 'dt': case 'header': case 'form': case 'hgroup': case 'body': case 'html':
          this.endBlock(); this.visitChildren(n); this.endBlock()
          break
        case 'dd':
          this.endBlock()
          this.prefixFirst = '  '
          this.visitChildren(n)
          this.endBlock()
          break
        case 'ul': case 'ol': this.list(n); break
        case 'li': this.listItem(n); break
        case 'table': this.table(n); break
        case 'pre': this.preformatted(n); break
        case 'blockquote':
          this.endBlock(); this.blankLine()
          this.quoteDepth++
          this.visitChildren(n)
          this.endBlock()
          this.quoteDepth--
          this.blankLine()
          break
        case 'img': this.image(n); break
        case 'math': this.appendRaw(' ' + mathMLText(n) + ' '); break
        case 'sup': this.script(n, '^'); break
        case 'sub': this.script(n, '_'); break
        case 'q': this.appendRaw('“'); this.visitChildren(n); this.appendRaw('”'); break
        case 'wbr': break
        default: this.visitChildren(n)
      }
    } finally {
      this.depth--
    }
  }

  private heading(n: HNode, level: number): void {
    this.endBlock(); this.blankLine()
    const sub = new Renderer(this.isolated, true)
    for (const c of n.children) sub.visit(c)
    const text = sub.inlineOutput()
    if (text) {
      if (this.firstHeading === null) this.firstHeading = text
      if (this.flatten) this.lines.push(text)
      else this.lines.push('> '.repeat(this.quoteDepth) + '#'.repeat(Math.min(Math.max(level, 1), 6)) + ' ' + text)
      if (sub.hasFigures) this.hasFigures = true
    }
    this.blankLine()
  }

  private list(n: HNode): void {
    this.endBlock()
    const ordered = n.tag === 'ol'
    let start = 0
    if (ordered) {
      const v = parseIntOrNull(n.attr('start'))
      if (v !== null) start = clampListNumber(v) - 1
    }
    this.listStack.push({ ordered, counter: start })
    this.visitChildren(n)
    this.endBlock()
    this.listStack.pop()
    if (this.listStack.length === 0) this.blankLine()
  }

  private listItem(n: HNode): void {
    this.endBlock()
    if (this.listStack.length === 0) {
      // <li> suelto, sin lista: viñeta
      this.prefixFirst = '- '
    } else {
      const state = this.listStack[this.listStack.length - 1]
      if (state.ordered) {
        const v = parseIntOrNull(n.attr('value'))
        state.counter = v !== null ? clampListNumber(v) : state.counter + 1
        this.prefixFirst = '  '.repeat(this.listStack.length - 1) + `${state.counter}. `
      } else {
        this.prefixFirst = '  '.repeat(this.listStack.length - 1) + '- '
      }
    }
    if (this.flatten) { this.prefixFirst = null; this.pendingSpace = true }
    this.visitChildren(n)
    this.endBlock()
  }

  private preformatted(n: HNode): void {
    this.endBlock(); this.blankLine()
    let raw = n.plainText
    if (raw.startsWith('\n')) raw = raw.slice(1)
    for (const r of raw.replace(/\r\n/g, '\n').split('\n')) {
      this.emitRaw(r.replace(/[ \t]+$/, '').replace(/ /g, ' '))
    }
    while (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop()
    this.blankLine()
  }

  private script(n: HNode, marker: string): void {
    const sub = new Renderer(this.isolated, true)
    for (const c of n.children) sub.visit(c)
    const text = sub.inlineOutput()
    if (!text) return
    const body = text.startsWith('-') || text.startsWith('−') || text.startsWith('+') ? text.slice(1) : text
    const simple = charCount(text) <= 4 && body.length > 0 && Array.from(body).every((c) => isLetter(c) || isNumber(c))
    if (simple) this.cur.append(marker + text)
    else if (text.startsWith('(') && text.endsWith(')')) this.cur.append(marker + text)
    else this.cur.append(marker + '(' + text + ')')
    this.pendingSpace = false
  }

  private image(n: HNode): void {
    const alt = collapse(n.attr('alt') ?? '')
    const src = (n.attr('src') ?? '').toLowerCase()
    const words = classWords(n)
    const dim = (s: string | undefined): number => {
      const digits = (s ?? '').replace(/\D/g, '')
      return digits ? Number(digits) : Number.MAX_SAFE_INTEGER
    }
    const tiny = Math.min(dim(n.attr('width')), dim(n.attr('height'))) < 48
    const decorative = ['icon', 'logo', 'avatar', 'emoji', 'sprite', 'badge', 'pixel', 'spacer', 'bullet'].some((w) => words.has(w)) ||
      ['icon', 'logo', 'sprite', 'emoji', 'spacer'].some((w) => src.includes(w))
    // Ecuaciones como imagen (aunque sean pequeñas): el alt suele ser el TeX
    if (alt.includes('\\') || alt.includes('^') || alt.includes('_{')) {
      const tex = cleanTeX(alt)
      if (tex) this.appendRaw(' $' + tex + '$ ')
      return
    }
    if (tiny || decorative) return
    this.hasFigures = true
    if (charCount(alt) < 3) return
    const lower = alt.toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].some((e) => lower.endsWith(e))) return
    this.appendRaw(' ' + Markers.figure(alt) + ' ')
  }

  private visitMathScript(n: HNode): void {
    const type = (n.attr('type') ?? '').toLowerCase()
    if (!(type.startsWith('math/tex') || type === 'application/x-tex')) return
    const tex = trimWSNL(n.plainText)
    if (!tex) return
    if (type.includes('mode=display')) { this.endBlock(); this.emitRaw('$$' + tex + '$$'); this.blankLine() }
    else this.appendRaw(' $' + tex + '$ ')
  }

  // Tablas

  private table(t: HNode): void {
    this.endBlock(); this.blankLine()
    const rows: HNode[][] = []
    const captions: HNode[] = []
    let hasNested = false
    const collect = (node: HNode): void => {
      for (const c of node.children) {
        if (c.isText) continue
        switch (c.tag) {
          case 'tr': rows.push(c.children.filter((x) => x.tag === 'td' || x.tag === 'th')); break
          case 'thead': case 'tbody': case 'tfoot': case 'colgroup': case 'form': collect(c); break
          case 'caption': captions.push(c); break
          case 'table': hasNested = true; break
          default:
            // Algunos HTML sucios ponen td directamente bajo table
            if (c.tag === 'td' || c.tag === 'th') rows.push([c])
        }
      }
    }
    collect(t)
    for (const c of captions) this.visit(c)
    if (rows.length === 0) { this.blankLine(); return }

    let layout = hasNested || (t.attr('role') ?? '').toLowerCase() === 'presentation'
    if (!layout) {
      outer: for (const row of rows) {
        for (const cell of row) {
          for (const d of cell.children) {
            if (!d.isText && ['table', 'ul', 'ol', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(d.tag)) { layout = true; break outer }
          }
          if (visibleTextLength(cell, 500) > 450) { layout = true; break outer }
        }
      }
    }
    if (layout) {
      for (const row of rows) for (const cell of row) { this.endBlock(); this.visitChildren(cell); this.endBlock() }
    } else {
      for (const row of rows) {
        const cells: string[] = []
        for (const cell of row) {
          const sub = new Renderer(this.isolated, true)
          for (const c of cell.children) sub.visit(c)
          if (sub.hasFigures) this.hasFigures = true
          cells.push(sub.inlineOutput().replace(/\|/g, '¦'))
          const span = parseIntOrNull(cell.attr('colspan'))
          if (span !== null && span > 1 && span < 30) for (let k = 1; k < span; k++) cells.push('')
        }
        while (cells.length && cells[cells.length - 1] === '') cells.pop()
        if (cells.length === 0 || cells.every((c) => c === '')) continue
        this.emitRaw(cells.join(' | '))
      }
    }
    this.blankLine()
  }
}

// MARK: MathML

/** Texto de una fórmula MathML: la anotación TeX si existe y, si no, una linealización simple. */
export function mathMLText(math: HNode): string {
  for (const a of math.elements('annotation')) {
    const enc = (a.attr('encoding') ?? '').toLowerCase()
    if (enc.includes('tex')) {
      const tex = cleanTeX(a.plainText)
      if (tex) return '$' + tex + '$'
    }
  }
  return linearize(math, 0)
}

function linearize(n: HNode, depth: number): string {
  if (n.isText) return trimWSNL(n.text)
  if (depth > 400) return ''
  const kids = n.children.filter((c) => !c.isText || trimWSNL(c.text).length > 0)
  const lin = (i: number): string => (i < kids.length ? linearize(kids[i], depth + 1) : '')
  const wrap = (s: string): string => (charCount(s) > 1 && !(s.startsWith('(') && s.endsWith(')')) ? `(${s})` : s)
  const all = (sep = ''): string => kids.map((k) => linearize(k, depth + 1)).join(sep)
  switch (n.tag) {
    case 'semantics': return lin(0)
    case 'annotation': case 'annotation-xml': return ''
    case 'msup': return wrap(lin(0)) + '^' + wrap(lin(1))
    case 'msub': return wrap(lin(0)) + '_' + wrap(lin(1))
    case 'msubsup': return wrap(lin(0)) + '_' + wrap(lin(1)) + '^' + wrap(lin(2))
    case 'mfrac': return wrap(lin(0)) + '/' + wrap(lin(1))
    case 'msqrt': return '√' + wrap(all())
    case 'mroot': return 'root(' + lin(1) + ')(' + lin(0) + ')'
    case 'mfenced': return (n.attr('open') ?? '(') + all(n.attr('separators') ?? ',') + (n.attr('close') ?? ')')
    case 'mtable': return all('; ')
    case 'mtr': case 'mlabeledtr': return all(' ')
    case 'mover': case 'munder': case 'munderover': return all()
    case 'mspace': return ' '
    case 'mo': return trimWSNL(n.plainText)
    default: return all()
  }
}

/** Primeros caracteres de un texto (para títulos enormes). */
export function headChars(s: string, n: number): string {
  return prefixChars(s, n)
}
