// Parser HTML tolerante: etiquetas sin cerrar, atributos sin comillas, comentarios, CDATA, texto crudo (`script`, `style`),
// cierres implícitos de `p`, `li`, `td`… y entidades. No ejecuta nada ni carga recursos. Límites de profundidad y nodos.
import { decodeEntities } from '../core/htmlEntities'

export class HNode {
  children: HNode[] = []

  /** `tag` en minúsculas; "" para texto. */
  constructor(readonly tag: string, public attrs: Record<string, string> = {}, public text = '') {}

  get isText(): boolean {
    return this.tag === ''
  }

  /** Atributos `class` e `id` en minúsculas (para heurísticas). */
  get classAndID(): string {
    return ((this.attrs.class ?? '') + ' ' + (this.attrs.id ?? '')).toLowerCase()
  }

  attr(name: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : undefined
  }

  firstElement(name: string): HNode | null {
    const stack: HNode[] = [...this.children].reverse()
    while (stack.length) {
      const n = stack.pop() as HNode
      if (n.tag === name) return n
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
    }
    return null
  }

  elements(name: string): HNode[] {
    const out: HNode[] = []
    const stack: HNode[] = [...this.children].reverse()
    while (stack.length) {
      const n = stack.pop() as HNode
      if (n.tag === name) out.push(n)
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
    }
    return out
  }

  /** Texto plano de todo el subárbol, sin interpretar nada. */
  get plainText(): string {
    if (this.isText) return this.text
    const parts: string[] = []
    const stack: HNode[] = [...this.children].reverse()
    while (stack.length) {
      const n = stack.pop() as HNode
      if (n.isText) parts.push(n.text)
      else for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
    }
    return parts.join('')
  }
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'command', 'keygen', 'frame', 'basefont', 'bgsound'])
const RAW_TEXT_TAGS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])
const RCDATA_TAGS = new Set(['title', 'textarea'])
/** Etiquetas que cierran un `<p>` abierto. */
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul', 'li', 'dd', 'dt'])
const SCOPE_BOUNDARY = new Set(['table', 'td', 'th', 'caption', 'html', 'body', 'template', 'object', 'button', 'marquee', 'applet'])
const LIST_BOUNDARY = new Set([...SCOPE_BOUNDARY, 'ul', 'ol', 'menu', 'dir'])
const DEFINITION_BOUNDARY = new Set([...SCOPE_BOUNDARY, 'dl'])
const MAX_DEPTH = 220
const MAX_NODES = 3_000_000

function isNameChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c === 58 || c === 46
}
function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12
}

export function parseHTML(html: string): HNode {
  const s = html
  const n = s.length
  const root = new HNode('#root')
  const stack: HNode[] = [root]
  let nodeCount = 0
  /** Cuántos elementos de cada etiqueta hay abiertos: los cierres sin pareja no recorren la pila entera. */
  const openCount = new Map<string, number>()

  const push = (node: HNode): void => {
    stack.push(node)
    openCount.set(node.tag, (openCount.get(node.tag) ?? 0) + 1)
  }
  const popFrom = (idx: number): void => {
    for (let k = idx; k < stack.length; k++) openCount.set(stack[k].tag, (openCount.get(stack[k].tag) ?? 1) - 1)
    stack.length = idx
  }
  const appendText = (t: string): void => {
    if (!t) return
    const parent = stack[stack.length - 1]
    const last = parent.children[parent.children.length - 1]
    if (last && last.isText) { last.text += t; return }
    nodeCount++
    parent.children.push(new HNode('', {}, t))
  }
  const closeIfOpen = (names: string[], boundaries: Set<string>): void => {
    if (!names.some((x) => (openCount.get(x) ?? 0) > 0)) return
    for (let idx = stack.length - 1; idx > 0; idx--) {
      const t = stack[idx].tag
      if (names.includes(t)) { popFrom(idx); return }
      if (boundaries.has(t)) return
    }
  }
  const startElement = (name: string, attrs: Record<string, string>, selfClosing: boolean): void => {
    if (nodeCount >= MAX_NODES) return
    if (CLOSES_P.has(name)) closeIfOpen(['p'], SCOPE_BOUNDARY)
    switch (name) {
      case 'li': closeIfOpen(['li'], LIST_BOUNDARY); break
      case 'dt': case 'dd': closeIfOpen(['dt', 'dd'], DEFINITION_BOUNDARY); break
      case 'tr': closeIfOpen(['tr'], new Set(['table'])); break
      case 'td': case 'th': closeIfOpen(['td', 'th'], new Set(['tr', 'table'])); break
      case 'thead': case 'tbody': case 'tfoot': closeIfOpen(['thead', 'tbody', 'tfoot'], new Set(['table'])); break
      case 'option': closeIfOpen(['option'], new Set(['select', 'datalist'])); break
      case 'optgroup': closeIfOpen(['option', 'optgroup'], new Set(['select'])); break
      default: break
    }
    nodeCount++
    const node = new HNode(name, attrs)
    stack[stack.length - 1].children.push(node)
    if (!VOID_TAGS.has(name) && !selfClosing && stack.length < MAX_DEPTH) push(node)
  }
  const endElement = (name: string): void => {
    if ((openCount.get(name) ?? 0) <= 0) return
    for (let idx = stack.length - 1; idx > 0; idx--) {
      if (stack[idx].tag === name) { popFrom(idx); return }
    }
  }
  const findCI = (needle: string, from: number): number => {
    // Búsqueda sin distinguir mayúsculas (la aguja ya va en minúsculas)
    const lower = needle.toLowerCase()
    let i = from
    for (;;) {
      const j = s.indexOf('<', i)
      if (j < 0 || j > n - lower.length) return -1
      if (s.slice(j, j + lower.length).toLowerCase() === lower) return j
      i = j + 1
    }
  }

  let i = 0
  while (i < n) {
    if (s.charCodeAt(i) !== 60) {
      let j = s.indexOf('<', i)
      if (j < 0) j = n
      appendText(decodeEntities(s.slice(i, j)))
      i = j
      continue
    }
    if (i + 1 >= n) { appendText('<'); break }
    const c = s.charCodeAt(i + 1)
    if (c === 33) {
      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4)
        i = end < 0 ? n : end + 3
      } else if (s.startsWith('<![CDATA[', i)) {
        const start = i + 9
        const end = s.indexOf(']]>', start)
        if (end < 0) { appendText(s.slice(start)); i = n } else { appendText(s.slice(start, end)); i = end + 3 }
      } else {
        const end = s.indexOf('>', i)
        i = end < 0 ? n : end + 1
      }
      continue
    }
    if (c === 63) {
      const end = s.indexOf('>', i)
      i = end < 0 ? n : end + 1
      continue
    }
    if (c === 47) {
      let j = i + 2
      const nameStart = j
      while (j < n && isNameChar(s.charCodeAt(j))) j++
      if (j > nameStart) endElement(s.slice(nameStart, j).toLowerCase())
      const end = s.indexOf('>', j)
      i = end < 0 ? n : end + 1
      continue
    }
    if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90))) { appendText('<'); i++; continue }

    // Etiqueta de apertura
    let j = i + 1
    while (j < n && isNameChar(s.charCodeAt(j))) j++
    const name = s.slice(i + 1, j).toLowerCase()
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>
    let selfClosing = false
    while (j < n) {
      while (j < n && isSpace(s.charCodeAt(j))) j++
      if (j >= n) break
      const d = s.charCodeAt(j)
      if (d === 62) { j++; break }
      if (d === 47) {
        if (j + 1 < n && s.charCodeAt(j + 1) === 62) { selfClosing = true; j += 2; break }
        j++
        continue
      }
      const aStart = j
      while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 61 && s.charCodeAt(j) !== 62 && s.charCodeAt(j) !== 47) j++
      if (j === aStart) { j++; continue }
      const aName = s.slice(aStart, j).toLowerCase()
      while (j < n && isSpace(s.charCodeAt(j))) j++
      let value = ''
      if (j < n && s.charCodeAt(j) === 61) {
        j++
        while (j < n && isSpace(s.charCodeAt(j))) j++
        const q = s.charCodeAt(j)
        if (j < n && (q === 34 || q === 39)) {
          const vStart = j + 1
          const vEnd = s.indexOf(q === 34 ? '"' : "'", vStart)
          if (vEnd < 0) { value = s.slice(vStart); j = n } else { value = s.slice(vStart, vEnd); j = vEnd + 1 }
        } else {
          const vStart = j
          while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 62) j++
          value = s.slice(vStart, j)
        }
      }
      if (!Object.prototype.hasOwnProperty.call(attrs, aName)) attrs[aName] = decodeEntities(value)
    }
    i = j
    startElement(name, attrs, selfClosing)

    // Texto crudo: el contenido llega hasta la etiqueta de cierre
    if (!selfClosing && (RAW_TEXT_TAGS.has(name) || RCDATA_TAGS.has(name))) {
      const found = findCI('</' + name, i)
      const end = found < 0 ? n : found
      const content = s.slice(i, end)
      const node = stack[stack.length - 1]
      if (node.tag === name) {
        const decoded = RCDATA_TAGS.has(name) ? decodeEntities(content) : content
        if (decoded) node.children.push(new HNode('', {}, decoded))
        popFrom(stack.length - 1)
      }
      if (end < n) {
        const gt = s.indexOf('>', end)
        i = gt < 0 ? n : gt + 1
      } else i = n
    }
  }
  return root
}
