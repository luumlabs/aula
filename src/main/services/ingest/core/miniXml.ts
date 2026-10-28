// Lector XML tolerante y con límites, sin dependencias. Los nombres de elementos y atributos van sin prefijo de espacio
// de nombres (`w:p` → `p`, `r:id` → `id`). Rechaza los DTD con entidades («billion laughs», XXE). Si el XML está dañado o
// truncado devuelve el árbol leído hasta el error, como el XMLParser (libxml2) de la app Swift.
import { L } from '../messages'
import { utf8 } from './textDecoding'

export interface XAttribute {
  local: string
  prefix: string | null
  value: string
}

export class XNode {
  children: XNode[] = []
  /** Texto directo del elemento (también los espacios entre hijos). */
  text = ''

  constructor(readonly name: string, readonly attributes: XAttribute[] = []) {}

  child(name: string): XNode | null {
    for (const c of this.children) if (c.name === name) return c
    return null
  }

  childrenNamed(name: string): XNode[] {
    return this.children.filter((c) => c.name === name)
  }

  /** Atributo por nombre local («val», «id»); si varios lo comparten, gana el que no lleva prefijo. Acepta «r:id». */
  attr(name: string): string | null {
    const colon = name.indexOf(':')
    if (colon >= 0) {
      const prefix = name.slice(0, colon), local = name.slice(colon + 1)
      for (const a of this.attributes) if (a.local === local && a.prefix === prefix) return a.value
      return null
    }
    let prefixed: string | null = null
    for (const a of this.attributes) {
      if (a.local !== name) continue
      if (a.prefix === null) return a.value
      if (prefixed === null) prefixed = a.value
    }
    return prefixed
  }

  /** Identificador de relación (`r:id`), con el prefijo que use el archivo. */
  get relationshipID(): string | null {
    const r = this.attr('r:id')
    if (r !== null) return r
    for (const a of this.attributes) if (a.local === 'id' && a.prefix !== null && a.prefix !== 'w' && a.prefix !== 'xml') return a.value
    return null
  }

  /** Primer descendiente con ese nombre (en profundidad, orden del documento). */
  firstDescendant(name: string): XNode | null {
    const stack: XNode[] = [...this.children].reverse()
    while (stack.length) {
      const n = stack.pop() as XNode
      if (n.name === name) return n
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
    }
    return null
  }

  descendants(name: string): XNode[] {
    const out: XNode[] = []
    const stack: XNode[] = [...this.children].reverse()
    while (stack.length) {
      const n = stack.pop() as XNode
      if (n.name === name) out.push(n)
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
    }
    return out
  }

  /** Texto de todo el subárbol. */
  get allText(): string {
    if (this.children.length === 0) return this.text
    const parts = [this.text]
    const stack: XNode[] = [...this.children].reverse()
    while (stack.length) {
      const n = stack.pop() as XNode
      parts.push(n.text)
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
    }
    return parts.join('')
  }
}

export interface XmlResult {
  root: XNode | null
  /** Problema encontrado (en minúscula, localizado). Con `root` no nulo, el árbol es parcial. */
  error: string | null
}

const ENTITY_DECL = Buffer.from('<!ENTITY')

/** ¿El XML declara entidades en un DTD? Se mira TODO el contenido. */
export function declaresEntities(data: Uint8Array): boolean {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).indexOf(ENTITY_DECL) >= 0
}

/** Bytes de una parte XML como texto (UTF-8, o UTF-16 con BOM), con los saltos de línea normalizados. */
export function xmlText(data: Uint8Array): string {
  let s: string
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) s = new TextDecoder('utf-16le').decode(data.subarray(2))
  else if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) s = new TextDecoder('utf-16be').decode(data.subarray(2))
  else s = utf8(data)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return s.includes('\r') ? s.replace(/\r\n?/g, '\n') : s
}

// MARK: SAX

export interface SaxHandler {
  /** Etiqueta de apertura (nombre local). Devolver `false` detiene la lectura sin error. */
  start(local: string, attributes: XAttribute[]): boolean | void
  end(local: string): boolean | void
  text(s: string): void
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function localName(qname: string): string {
  const i = qname.lastIndexOf(':')
  return i >= 0 ? qname.slice(i + 1) : qname
}

function isNameStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58 || c >= 0xc0
}
function isNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 0xb7
}
function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13
}

class XmlSyntaxError extends Error {}

/** Decodifica las referencias de XML (predefinidas y numéricas). Una entidad desconocida es un error. */
function decodeXmlRefs(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&([^;&\s<]{0,32});|&/g, (_m, body: string | undefined) => {
    // Un «&» suelto (sin «;») no es XML válido
    if (body === undefined) throw new XmlSyntaxError('&')
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const digits = hex ? body.slice(2) : body.slice(1)
      if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) throw new XmlSyntaxError('ref')
      const v = parseInt(digits, hex ? 16 : 10)
      if (!(v === 9 || v === 10 || v === 13 || (v >= 0x20 && v <= 0xd7ff) || (v >= 0xe000 && v <= 0xfffd) || (v >= 0x10000 && v <= 0x10ffff))) throw new XmlSyntaxError('ref')
      return String.fromCodePoint(v)
    }
    const e = XML_ENTITIES[body]
    if (e === undefined) throw new XmlSyntaxError('entity')
    return e
  })
}

/**
 * Recorre un XML emitiendo eventos. Devuelve el error (localizado) o `null`. Bien formado como libxml2 en lo esencial:
 * etiquetas emparejadas, un solo elemento raíz, atributos entre comillas, sin texto fuera de la raíz.
 */
export function saxParse(source: string, handler: SaxHandler): string | null {
  const s = source
  const n = s.length
  let i = 0
  const open: string[] = []
  let rootSeen = false
  let rootClosed = false
  let textStart = -1
  const malformed = (): string => L('XML mal formado')

  const flushText = (end: number): void => {
    if (textStart < 0) return
    const raw = s.slice(textStart, end)
    textStart = -1
    if (open.length === 0) {
      if (raw.trim().length > 0) throw new XmlSyntaxError('text outside root')
      return
    }
    handler.text(decodeXmlRefs(raw))
  }

  try {
    while (i < n) {
      const c = s.charCodeAt(i)
      if (c !== 60) {
        if (textStart < 0) textStart = i
        const next = s.indexOf('<', i)
        i = next < 0 ? n : next
        continue
      }
      flushText(i)
      const c1 = s.charCodeAt(i + 1)
      if (c1 === 63) {
        // <? … ?>
        const end = s.indexOf('?>', i + 2)
        if (end < 0) return malformed()
        i = end + 2
        continue
      }
      if (c1 === 33) {
        if (s.startsWith('<!--', i)) {
          const end = s.indexOf('-->', i + 4)
          if (end < 0) return malformed()
          i = end + 3
          continue
        }
        if (s.startsWith('<![CDATA[', i)) {
          const end = s.indexOf(']]>', i + 9)
          if (end < 0) return malformed()
          if (open.length === 0) return malformed()
          handler.text(s.slice(i + 9, end))
          i = end + 3
          continue
        }
        if (s.startsWith('<!DOCTYPE', i)) {
          if (rootSeen) return malformed()
          // Salta la declaración, con su subconjunto interno entre corchetes
          let j = i + 9
          let depth = 0
          let quote = 0
          for (; j < n; j++) {
            const d = s.charCodeAt(j)
            if (quote) { if (d === quote) quote = 0; continue }
            if (d === 34 || d === 39) quote = d
            else if (d === 91) depth++
            else if (d === 93) depth--
            else if (d === 62 && depth <= 0) break
          }
          if (j >= n) return malformed()
          i = j + 1
          continue
        }
        return malformed()
      }
      if (c1 === 47) {
        // </nombre>
        let j = i + 2
        const nameStart = j
        while (j < n && isNameChar(s.charCodeAt(j))) j++
        const qname = s.slice(nameStart, j)
        while (j < n && isSpace(s.charCodeAt(j))) j++
        if (j >= n || s.charCodeAt(j) !== 62) return malformed()
        const expected = open.pop()
        if (expected === undefined || expected !== qname) return malformed()
        i = j + 1
        if (open.length === 0) rootClosed = true
        if (handler.end(localName(qname)) === false) return null
        continue
      }
      // Etiqueta de apertura
      if (!isNameStart(c1)) return malformed()
      if (rootClosed) return malformed()
      let j = i + 1
      while (j < n && isNameChar(s.charCodeAt(j))) j++
      const qname = s.slice(i + 1, j)
      const attributes: XAttribute[] = []
      const seen = new Set<string>()
      let selfClosing = false
      for (;;) {
        const hadSpace = j < n && isSpace(s.charCodeAt(j))
        while (j < n && isSpace(s.charCodeAt(j))) j++
        if (j >= n) return malformed()
        const d = s.charCodeAt(j)
        if (d === 62) { j++; break }
        if (d === 47) {
          if (s.charCodeAt(j + 1) !== 62) return malformed()
          selfClosing = true
          j += 2
          break
        }
        if (!hadSpace || !isNameStart(d)) return malformed()
        const aStart = j
        while (j < n && isNameChar(s.charCodeAt(j))) j++
        const aName = s.slice(aStart, j)
        while (j < n && isSpace(s.charCodeAt(j))) j++
        if (s.charCodeAt(j) !== 61) return malformed()
        j++
        while (j < n && isSpace(s.charCodeAt(j))) j++
        const q = s.charCodeAt(j)
        if (q !== 34 && q !== 39) return malformed()
        const vEnd = s.indexOf(q === 34 ? '"' : "'", j + 1)
        if (vEnd < 0) return malformed()
        const rawValue = s.slice(j + 1, vEnd)
        if (rawValue.includes('<')) return malformed()
        j = vEnd + 1
        if (seen.has(aName)) return malformed()
        seen.add(aName)
        if (aName === 'xmlns' || aName.startsWith('xmlns:')) continue
        const value = decodeXmlRefs(rawValue.replace(/[\t\n\r]/g, ' '))
        const colon = aName.lastIndexOf(':')
        attributes.push(colon >= 0 ? { local: aName.slice(colon + 1), prefix: aName.slice(0, colon), value } : { local: aName, prefix: null, value })
      }
      i = j
      if (open.length === 0) {
        if (rootSeen) return malformed()
        rootSeen = true
      }
      // Orden estable de los atributos (como la app Swift, que los ordenaba por nombre)
      attributes.sort((a, b) => {
        const ka = a.prefix ? `${a.prefix}:${a.local}` : a.local
        const kb = b.prefix ? `${b.prefix}:${b.local}` : b.local
        return ka < kb ? -1 : ka > kb ? 1 : 0
      })
      const local = localName(qname)
      if (handler.start(local, attributes) === false) return null
      if (selfClosing) {
        if (open.length === 0) rootClosed = true
        if (handler.end(local) === false) return null
      } else {
        open.push(qname)
      }
    }
    if (textStart >= 0) flushText(n)
  } catch (e) {
    if (e instanceof XmlSyntaxError) return malformed()
    throw e
  }
  if (!rootSeen) return L('XML mal formado')
  if (open.length > 0) return L('XML mal formado')
  return null
}

// MARK: Árbol

export interface ParseOptions {
  /** Máximo de elementos (≈ memoria). */
  maxNodes?: number
  /** Máximo de niveles de anidamiento. */
  maxDepth?: number
  /** Nombres locales de elementos cuyos subárboles se descartan sin crear nodos (`rPr`, `sectPr`…). */
  skipping?: ReadonlySet<string>
}

/** Analiza un XML. Si se superan los límites, devuelve el árbol leído hasta ahí con un error. */
export function parseXml(data: Uint8Array | string, options: ParseOptions = {}): XmlResult {
  const maxNodes = options.maxNodes ?? 4_000_000
  const maxDepth = options.maxDepth ?? 256
  const skipping = options.skipping ?? new Set<string>()
  if (data.length === 0) return { root: null, error: L('el contenido está vacío') }
  if (typeof data !== 'string' && declaresEntities(data)) {
    return { root: null, error: L('contiene definiciones de entidades, que no se permiten por seguridad') }
  }
  const source = typeof data === 'string' ? data : xmlText(data)
  if (typeof data === 'string' && source.includes('<!ENTITY')) {
    return { root: null, error: L('contiene definiciones de entidades, que no se permiten por seguridad') }
  }
  const stack: XNode[] = []
  let root: XNode | null = null
  let count = 0
  let skipDepth = 0
  let overflow = false

  const error = saxParse(source, {
    start(local, attributes) {
      if (stack.length + skipDepth >= maxDepth) { overflow = true; return false }
      if (skipDepth > 0) { skipDepth++; return }
      if (stack.length > 0 && skipping.has(local)) { skipDepth = 1; return }
      count++
      if (count > maxNodes) { overflow = true; return false }
      const node = new XNode(local, attributes)
      const top = stack[stack.length - 1]
      if (top) top.children.push(node)
      else if (root === null) root = node
      stack.push(node)
    },
    end() {
      if (skipDepth > 0) { skipDepth--; return }
      stack.pop()
    },
    text(s) {
      if (skipDepth > 0) return
      const top = stack[stack.length - 1]
      if (top) top.text += s
    }
  })
  if (overflow) return { root, error: L('el XML es demasiado grande o profundo') }
  return { root, error }
}
