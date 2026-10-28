// HTML → Markdown ligero (o texto plano). Port de CanvasKit/Text/HTMLText.swift: pensado para el HTML de Canvas (editor RCE,
// ecuaciones como imagen con LaTeX en el `alt`, MathML…) pero tolerante con cualquier HTML (Moodle, Outlook, Word).
import { decodeEntities } from './entities'
import { mathMLToLatex } from './mathml'
import { isText, parseHTML, rawText, type HTMLNode } from './parser'

/** Máximo de HTML que se procesa (el resto se ignora) para acotar el tiempo con entradas enormes. */
const MAX_INPUT = 4_000_000

const SKIPPED = new Set(['script', 'style', 'iframe', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'object', 'embed', 'svg', 'canvas',
  'select', 'option', 'datalist', 'button', 'input', 'textarea', 'audio', 'video', 'source', 'track', 'map', 'area', 'applet'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure', 'figcaption', 'address', 'blockquote',
  'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'form', 'fieldset', 'details', 'summary', 'center', 'body', 'html', 'legend', 'menu', 'dir'])
const IGNORABLE_CLASSES = ['file_download_btn', 'file_preview_link', 'screenreader-only', 'ui-helper-hidden-accessible', 'accesshide', 'sr-only']

/** HTML → Markdown: títulos, listas, enlaces, tablas, negritas, código, citas, ecuaciones `$…$`. `baseURL` vuelve absolutos los enlaces. */
export function htmlToMarkdown(html: string, baseURL?: string): string {
  return render(html, baseURL, false)
}

/** HTML → texto sin marcas (para descripciones cortas). Los enlaces quedan como «texto (url)». */
export function htmlToPlainText(html: string, baseURL?: string): string {
  return render(html, baseURL, true)
}

/** true si el texto parece contener etiquetas HTML (`<p>`, `</div>`, `<br/>`, `<a href=…>`). */
export function looksLikeHTML(text: string): boolean {
  return /<\/?[A-Za-z!][^<>]{0,300}>/.test(text)
}

function render(input: string, baseURL: string | undefined, plain: boolean): string {
  let html = input ?? ''
  if (html.length > MAX_INPUT) html = html.slice(0, MAX_INPUT)
  if (!looksLikeHTML(html)) return finalize(decodeEntities(html).replace(/\r\n?/g, '\n').replace(/ /g, ' '))
  const r = new Renderer(baseURL, plain)
  return finalize(r.container(parseHTML(html), 0))
}

/** Limpieza final: sin controles, sin espacios al final de línea, máx. una línea en blanco (fuera de bloques de código). */
export function finalize(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  const out: string[] = []
  let inFence = false
  let blank = 0
  for (const rawLine of text.split('\n')) {
    const isFence = rawLine.startsWith('```')
    if (isFence) inFence = !inFence
    const line = inFence && !isFence ? rawLine : rawLine.replace(/[ \t]+$/, '')
    if (!line && !inFence) {
      blank++
      if (blank > 1) continue
    } else blank = 0
    out.push(line)
  }
  return out.join('\n').trim()
}

/** Colapsa espacios (incluye NBSP) a uno solo y quita invisibles. */
function collapse(s: string): string {
  return s.replace(/[​﻿­]/g, '').replace(/[ \t\n\r\f  -   　]+/g, ' ')
}

function flatten(s: string): string {
  return collapse(s.replace(/\n/g, ' ')).trim()
}

function cleanInline(s: string): string {
  if (!s) return ''
  const lines = s.split('\n').map((l) => collapse(l).trim())
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  const out: string[] = []
  let blank = false
  for (const l of lines) {
    if (!l) {
      if (!blank) out.push(l)
      blank = true
    } else {
      out.push(l)
      blank = false
    }
  }
  return out.join('\n')
}

class Renderer {
  constructor(private readonly baseURL: string | undefined, private readonly plain: boolean) {}

  container(n: HTMLNode, depth: number): string {
    if (depth > 120) return flatten(rawText(n))
    let out = ''
    let run = ''
    const flush = (): void => {
      const p = cleanInline(run)
      run = ''
      if (p) out += p + '\n\n'
    }
    for (const child of n.children) {
      if (isText(child)) {
        run += collapse(child.text)
        continue
      }
      if (this.ignored(child)) continue
      if (child.tag === 'br') {
        run += '\n'
        continue
      }
      if (BLOCK.has(child.tag)) {
        flush()
        const b = this.block(child, depth + 1)
        if (b) out += b + '\n\n'
      } else {
        run += this.inline(child, depth + 1)
      }
    }
    flush()
    return out.trim()
  }

  private ignored(n: HTMLNode): boolean {
    if (isText(n)) return false
    if (SKIPPED.has(n.tag)) return true
    if ('hidden' in n.attrs) return true
    if ((n.attrs['aria-hidden'] ?? '').toLowerCase() === 'true') return true
    const style = (n.attrs.style ?? '').toLowerCase().replace(/\s/g, '')
    if (style.includes('display:none') || style.includes('visibility:hidden')) return true
    const cls = n.attrs.class ?? ''
    return !!cls && IGNORABLE_CLASSES.some((c) => cls.includes(c))
  }

  private block(n: HTMLNode, depth: number): string {
    switch (n.tag) {
      case 'p': case 'caption': case 'legend': case 'figcaption': case 'summary': case 'dt': {
        const v = cleanInline(this.inlineChildren(n, depth))
        return n.tag === 'dt' && !this.plain && v ? `**${v}**` : v
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Number(n.tag.slice(1)) || 1
        const v = flatten(this.inlineChildren(n, depth))
        if (!v) return ''
        return this.plain ? v : '#'.repeat(level) + ' ' + v
      }
      case 'hr': return this.plain ? '' : '---'
      case 'blockquote': {
        const inner = this.container(n, depth)
        if (!inner || this.plain) return inner
        return inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')
      }
      case 'pre': return this.codeBlock(n)
      case 'ul': case 'menu': case 'dir': return this.list(n, false, depth)
      case 'ol': return this.list(n, true, depth)
      case 'li': {
        const body = this.container(n, depth).replace(/\n\n/g, '\n')
        return body ? '- ' + body : ''
      }
      case 'dd': {
        const body = this.container(n, depth).replace(/\n\n/g, '\n')
        return body ? (this.plain ? body : ': ' + body) : ''
      }
      case 'table': return this.table(n, depth)
      default: return this.container(n, depth)
    }
  }

  private codeBlock(n: HTMLNode): string {
    const code = rawText(n).replace(/\r\n/g, '\n').replace(/ /g, ' ').replace(/^\n+/, '').replace(/\n+$/, '')
    if (!code) return ''
    if (this.plain) return code
    let lang = ''
    const classes = [n.attrs.class, ...n.children.filter((c) => c.tag === 'code').map((c) => c.attrs.class)]
    for (const c of classes) for (const tok of (c ?? '').split(' ')) if (tok.startsWith('language-')) lang = tok.slice(9)
    return '```' + lang + '\n' + code + '\n```'
  }

  private list(n: HTMLNode, ordered: boolean, depth: number): string {
    const lines: string[] = []
    let index = Number(n.attrs.start) || 1
    for (const child of n.children) {
      if (isText(child)) {
        const v = collapse(child.text).trim()
        if (v) lines.push(v)
        continue
      }
      if (this.ignored(child)) continue
      if (child.tag === 'li') {
        const body = this.container(child, depth + 1).replace(/\n\n/g, '\n')
        if (!body) continue
        const marker = ordered ? `${index}. ` : '- '
        index++
        const pad = ' '.repeat(marker.length)
        body.split('\n').forEach((part, k) => lines.push(k === 0 ? marker + part : part ? pad + part : ''))
      } else if (child.tag === 'ul' || child.tag === 'ol') {
        for (const l of this.list(child, child.tag === 'ol', depth + 1).split('\n')) if (l) lines.push('  ' + l)
      } else {
        const body = BLOCK.has(child.tag) ? this.block(child, depth + 1) : cleanInline(this.inline(child, depth + 1))
        if (body) lines.push(body.replace(/\n\n/g, '\n'))
      }
    }
    return lines.join('\n')
  }

  private table(n: HTMLNode, depth: number): string {
    const rows: string[][] = []
    let headerRows = 0
    const captions: string[] = []
    const collect = (x: HTMLNode): void => {
      for (const c of x.children) {
        if (isText(c) || this.ignored(c)) continue
        if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c)
        else if (c.tag === 'caption') {
          const v = flatten(this.inlineChildren(c, depth + 1))
          if (v) captions.push(v)
        } else if (c.tag === 'tr') {
          const cells: string[] = []
          let allTh = true
          let any = false
          for (const cell of c.children) {
            if (isText(cell) || (cell.tag !== 'td' && cell.tag !== 'th') || this.ignored(cell)) continue
            any = true
            if (cell.tag !== 'th') allTh = false
            cells.push(flatten(this.container(cell, depth + 2)).replace(/\|/g, '\\|'))
            const span = Math.min(20, Math.max(1, Number(cell.attrs.colspan) || 1))
            for (let k = 1; k < span; k++) cells.push('')
          }
          if (any) {
            rows.push(cells)
            if (allTh && rows.length === headerRows + 1) headerRows++
          }
        }
      }
    }
    collect(n)
    const parts: string[] = []
    if (captions[0]) parts.push(captions[0])
    if (!rows.length) return parts.join('\n\n')
    // tabla de maquetación de una sola celda: su contenido tal cual
    if (rows.length === 1 && rows[0].length === 1) {
      const inner = n.children.filter((c) => !isText(c) && c.tag !== 'caption').map((c) => this.container(c, depth + 1)).join('\n\n').trim()
      return [...parts, ...(inner ? [inner] : [])].join('\n\n')
    }
    const cols = Math.max(...rows.map((r) => r.length))
    const padded = rows.map((r) => [...r, ...Array<string>(cols - r.length).fill('')])
    if (this.plain) {
      parts.push(padded.map((r) => r.join(' | ')).join('\n'))
      return parts.join('\n\n')
    }
    const md = ['| ' + padded[0].join(' | ') + ' |', '|' + Array<string>(cols).fill(' --- ').join('|') + '|', ...padded.slice(1).map((r) => '| ' + r.join(' | ') + ' |')]
    parts.push(md.join('\n'))
    return parts.join('\n\n')
  }

  private inlineChildren(n: HTMLNode, depth: number): string {
    if (depth > 150) return collapse(rawText(n))
    let s = ''
    for (const c of n.children) {
      if (isText(c)) s += collapse(c.text)
      else if (!this.ignored(c)) s += this.inline(c, depth + 1)
    }
    return s
  }

  inline(n: HTMLNode, depth: number): string {
    if (this.ignored(n)) return ''
    switch (n.tag) {
      case 'br': return '\n'
      case 'b': case 'strong': return this.wrap(this.inlineChildren(n, depth), '**')
      case 'i': case 'em': case 'cite': case 'dfn': case 'var': return this.wrap(this.inlineChildren(n, depth), '*')
      case 's': case 'strike': case 'del': return this.wrap(this.inlineChildren(n, depth), '~~')
      case 'code': case 'kbd': case 'samp': case 'tt': {
        const inner = flatten(rawText(n))
        if (!inner) return ''
        if (this.plain) return inner
        const fence = inner.includes('`') ? '``' : '`'
        return fence + inner + fence
      }
      case 'a': return this.link(n, depth)
      case 'img': return this.image(n)
      case 'sup': return this.script(this.inlineChildren(n, depth), '^')
      case 'sub': return this.script(this.inlineChildren(n, depth), '_')
      case 'math': {
        const tex = mathMLToLatex(n)
        return tex ? `$${tex}$` : ''
      }
      default:
        if (BLOCK.has(n.tag)) return ' ' + flatten(this.block(n, depth)) + ' '
        return this.inlineChildren(n, depth)
    }
  }

  /** Envuelve con marcadores dejando los espacios de los bordes fuera (`** x **` no es negrita válida). */
  private wrap(inner: string, marker: string): string {
    if (this.plain) return inner
    const core = inner.trim()
    if (!core) return /[ \n]/.test(inner) ? ' ' : ''
    const lead = /^\s*/.exec(inner)?.[0] ?? ''
    const trail = /\s*$/.exec(inner)?.[0] ?? ''
    const already = marker === '*'
      ? core.length > 2 && core.startsWith('*') && !core.startsWith('**') && core.endsWith('*') && !core.endsWith('**')
      : core.length > marker.length * 2 && core.startsWith(marker) && core.endsWith(marker)
    if (already) return inner
    return lead + marker + core + marker + trail
  }

  private script(inner: string, marker: string): string {
    const v = flatten(inner)
    if (!v) return ''
    // ordinales («1st», «2nd», «1º»): como texto
    if (['st', 'nd', 'rd', 'th', 'o', 'a', 'º', 'ª'].includes(v.toLowerCase())) return v
    const simple = [...v].length === 1 || ([...v].length <= 3 && /^[\p{L}\p{N}]+$/u.test(v))
    return simple ? marker + v : `${marker}(${v})`
  }

  private resolve(raw: string | undefined): string | null {
    let href = (raw ?? '').trim()
    if (!href) return null
    const lower = href.toLowerCase()
    if (/^(javascript|data|vbscript|blob):/.test(lower) || href.startsWith('#')) return null
    if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return href
    if (this.baseURL && !/^https?:\/\//.test(lower)) {
      try {
        href = new URL(href, this.baseURL).toString()
      } catch { /* se queda */ }
    }
    return href
  }

  private escapeURL(u: string): string {
    return u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
  }

  private link(n: HTMLNode, depth: number): string {
    const inner = this.inlineChildren(n, depth)
    const text = flatten(inner)
    const lead = /^\s/.test(inner) ? ' ' : ''
    const trail = /\s$/.test(inner) && text ? ' ' : ''
    const href = this.resolve(n.attrs.href)
    if (!href) return inner
    if (!text) {
      const title = n.attrs.title
      if (title && !this.plain) return `[${title}](${this.escapeURL(href)})`
      return href
    }
    if (text === href || text === href.replace('mailto:', '')) return lead + href + trail
    if (this.plain) return `${lead}${text} (${href})${trail}`
    return `${lead}[${text}](${this.escapeURL(href)})${trail}`
  }

  private image(n: HTMLNode): string {
    const a = n.attrs
    const cls = (a.class ?? '').toLowerCase()
    // Ecuaciones de Canvas: el LaTeX viene en `data-equation-content`, en `alt="LaTeX: …"` o en `title`
    const eq = (a['data-equation-content'] ?? '').trim()
    if (eq) return `$${eq}$`
    const alt = (a.alt ?? '').trim()
    if (alt.toLowerCase().startsWith('latex:')) {
      const tex = alt.slice(6).trim()
      if (tex) return `$${tex}$`
    }
    if (cls.includes('equation_image')) {
      const title = (a.title ?? '').trim()
      if (title) return `$${title}$`
      const tex = a.src ? latexFromEquationSrc(a.src) : null
      if (tex) return `$${tex}$`
    }
    const rawSrc = (a.src ?? '').trim()
    if (!rawSrc) return alt
    const lowerSrc = rawSrc.toLowerCase()
    // adornos: datos incrustados, iconos SVG de Canvas, emoticonos
    if (lowerSrc.startsWith('data:') || lowerSrc.includes('/images/svg-icons/') || lowerSrc.includes('/images/emoji') || cls.includes('emoji') || 'data-emoji' in a) {
      return alt
    }
    if (this.plain) return alt
    const src = this.resolve(rawSrc)
    if (!src) return alt
    return `![${alt.replace(/\n/g, ' ')}](${this.escapeURL(src)})`
  }
}

/** `/equation_images/%255Csin%2528x%2529?scale=1` → `\sin(x)` (el LaTeX viene codificado dos veces). */
export function latexFromEquationSrc(src: string): string | null {
  const i = src.indexOf('/equation_images/')
  if (i < 0) return null
  let tail = src.slice(i + '/equation_images/'.length)
  const q = tail.indexOf('?')
  if (q >= 0) tail = tail.slice(0, q)
  const dec = (s: string): string => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  const v = dec(dec(tail)).trim()
  return v || null
}
