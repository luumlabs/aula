// Analizador HTML tolerante (no es un validador). Port de CanvasKit/Text/HTMLParser.swift: maneja etiquetas sin cerrar,
// atributos sin comillas, comentarios, CDATA, `<script>`/`<style>` y texto con `<` suelto. Nunca lanza ni se cuelga.
import { decodeEntities } from './entities'

export interface HTMLNode {
  /** Etiqueta en minúsculas; '' para texto; '#root' para la raíz. */
  tag: string
  attrs: Record<string, string>
  text: string
  children: HTMLNode[]
}

export function isText(n: HTMLNode): boolean {
  return n.tag === ''
}

/** Texto de todos los descendientes, sin formato (para `pre`, MathML…). */
export function rawText(n: HTMLNode): string {
  if (isText(n)) return n.text
  let s = ''
  for (const c of n.children) s += c.tag === 'br' ? '\n' : rawText(c)
  return s
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'command', 'keygen'])
/** Elementos cuyo contenido se descarta sin analizar (puede contener `<` sin ser etiquetas). */
const RAW_SKIP = new Set(['script', 'style', 'textarea', 'title'])
/** Etiquetas que cierran implícitamente un `<p>` abierto. */
const CLOSES_P = new Set(['p', 'div', 'ul', 'ol', 'dl', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'hr', 'section', 'article',
  'aside', 'header', 'footer', 'nav', 'main', 'form', 'fieldset', 'figure', 'address', 'details', 'center'])
const MAX_DEPTH = 200

function node(tag: string, attrs: Record<string, string> = {}, text = ''): HTMLNode {
  return { tag, attrs, text, children: [] }
}

const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13 || c === 12

export function parseHTML(html: string): HTMLNode {
  const s = html
  const n = s.length
  const root = node('#root')
  const stack: HTMLNode[] = [root]
  let i = 0
  let textStart = 0
  const top = (): HTMLNode => stack[stack.length - 1]

  const appendText = (raw: string, decode = true): void => {
    if (!raw) return
    const t = decode ? decodeEntities(raw) : raw
    const kids = top().children
    const last = kids[kids.length - 1]
    if (last && isText(last)) last.text += t
    else kids.push(node('', {}, t))
  }
  const flushText = (end: number): void => {
    if (end > textStart) appendText(s.slice(textStart, end))
  }
  const closeUntil = (targets: Set<string>, boundaries: Set<string>): void => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag
      if (targets.has(t)) {
        stack.length = k
        return
      }
      if (boundaries.has(t)) return
    }
  }
  const open = (tag: string, attrs: Record<string, string>, selfClosing: boolean): void => {
    switch (tag) {
      case 'li': closeUntil(new Set(['li']), new Set(['ul', 'ol'])); break
      case 'dt': case 'dd': closeUntil(new Set(['dt', 'dd']), new Set(['dl'])); break
      case 'td': case 'th': closeUntil(new Set(['td', 'th']), new Set(['tr', 'table'])); break
      case 'tr': closeUntil(new Set(['tr']), new Set(['table', 'thead', 'tbody', 'tfoot'])); break
      case 'thead': case 'tbody': case 'tfoot': closeUntil(new Set(['thead', 'tbody', 'tfoot']), new Set(['table'])); break
    }
    if (CLOSES_P.has(tag)) while (stack.length > 1 && top().tag === 'p') stack.pop()
    const el = node(tag, attrs)
    top().children.push(el)
    if (VOID.has(tag) || selfClosing) return
    if (stack.length < MAX_DEPTH) stack.push(el)
  }
  const close = (tag: string): void => {
    if (tag === 'br') {
      open('br', {}, true)
      return
    }
    if (VOID.has(tag)) return
    const bounded = new Set(['td', 'th', 'tr', 'li', 'dd', 'dt', 'p'])
    const boundaries = bounded.has(tag) ? new Set(['table', 'ul', 'ol', 'dl']) : new Set<string>()
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag
      if (t === tag) {
        stack.length = k
        return
      }
      if (boundaries.has(t)) return
    }
  }
  const lowerAt = (pos: number, str: string): boolean => s.slice(pos, pos + str.length).toLowerCase() === str

  while (i < n) {
    if (s.charCodeAt(i) !== 60) { // '<'
      i++
      continue
    }
    if (i + 1 >= n) break
    const next = s.charCodeAt(i + 1)
    if (next === 33 || next === 63) { // <! o <?
      flushText(i)
      if (next === 33 && lowerAt(i, '<!--')) {
        const end = s.indexOf('-->', i + 4)
        i = end < 0 ? n : end + 3
      } else if (next === 33 && lowerAt(i, '<![cdata[')) {
        const start = i + 9
        const end = s.indexOf(']]>', start)
        if (end < 0) i = n
        else {
          appendText(s.slice(start, end), false)
          i = end + 3
        }
      } else {
        const end = s.indexOf('>', i + 2)
        i = end < 0 ? n : end + 1
      }
      textStart = i
      continue
    }
    if (next === 47) { // '</'
      if (!(i + 2 < n && isLetter(s.charCodeAt(i + 2)))) {
        i++
        continue
      }
      flushText(i)
      let j = i + 2
      const nameStart = j
      while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 62 && s.charCodeAt(j) !== 47) j++
      const name = s.slice(nameStart, j).toLowerCase()
      while (j < n && s.charCodeAt(j) !== 62) j++
      i = Math.min(n, j + 1)
      textStart = i
      close(name)
      continue
    }
    if (!isLetter(next)) { // '<' suelto («x < 5») = texto
      i++
      continue
    }
    flushText(i)
    let j = i + 1
    const nameStart = j
    while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 62 && s.charCodeAt(j) !== 47) j++
    const name = s.slice(nameStart, j).toLowerCase()
    const attrs: Record<string, string> = {}
    let selfClosing = false
    let terminated = false
    while (j < n) {
      while (j < n && isSpace(s.charCodeAt(j))) j++
      if (j >= n) break
      const c = s.charCodeAt(j)
      if (c === 62) {
        j++
        terminated = true
        break
      }
      if (c === 47) {
        if (j + 1 < n && s.charCodeAt(j + 1) === 62) {
          selfClosing = true
          j += 2
          terminated = true
          break
        }
        j++
        continue
      }
      const aStart = j
      while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 61 && s.charCodeAt(j) !== 62 && s.charCodeAt(j) !== 47) j++
      if (j === aStart) {
        j++
        continue
      }
      const aName = s.slice(aStart, j).toLowerCase()
      while (j < n && isSpace(s.charCodeAt(j))) j++
      let value = ''
      if (j < n && s.charCodeAt(j) === 61) {
        j++
        while (j < n && isSpace(s.charCodeAt(j))) j++
        const q = s.charCodeAt(j)
        if (j < n && (q === 34 || q === 39)) {
          j++
          const vStart = j
          while (j < n && s.charCodeAt(j) !== q) j++
          value = s.slice(vStart, Math.min(j, n))
          if (j < n) j++
        } else {
          const vStart = j
          while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 62) j++
          value = s.slice(vStart, j)
        }
      }
      if (!(aName in attrs)) attrs[aName] = decodeEntities(value)
    }
    if (!terminated) {
      i = n
      textStart = n
      break
    }
    i = j
    textStart = i
    if (RAW_SKIP.has(name) && !selfClosing) {
      const closeRe = new RegExp(`</${name}`, 'gi')
      closeRe.lastIndex = i
      const end = closeRe.exec(s)?.index ?? -1
      const gt = end < 0 ? -1 : s.indexOf('>', end)
      i = gt < 0 ? n : gt + 1
      textStart = i
      continue
    }
    open(name, attrs, selfClosing)
  }
  flushText(n)
  return root
}
