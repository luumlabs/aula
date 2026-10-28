// Detección de codificación y decodificación tolerante de texto (UTF-8, UTF-16, UTF-32, Windows-1252, Latin-1…).

export interface Decoded {
  text: string
  /** Nombre legible de la codificación detectada («UTF-8», «UTF-16LE», «Windows-1252»…). */
  encodingName: string
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const utf8Lenient = new TextDecoder('utf-8', { ignoreBOM: true })

function tryDecode(label: string, data: Uint8Array, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal, ignoreBOM: true }).decode(data)
  } catch {
    return null
  }
}

function startsWith(data: Uint8Array, prefix: number[]): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false
  return true
}

/** Bytes UTF-8 como texto, sin fallar (los inválidos pasan a U+FFFD). */
export function utf8(data: Uint8Array): string {
  return utf8Lenient.decode(data)
}

/** UTF-8 estricto, o `null` si no es UTF-8 válido. */
export function strictUTF8(data: Uint8Array): string | null {
  try {
    return utf8Strict.decode(data)
  } catch {
    return null
  }
}

function utf32(data: Uint8Array, littleEndian: boolean): string | null {
  if (data.length % 4 !== 0) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let out = ''
  const parts: string[] = []
  for (let i = 0; i < data.length; i += 4) {
    const cp = view.getUint32(i, littleEndian)
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null
    out += String.fromCodePoint(cp)
    if (out.length > 8192) { parts.push(out); out = '' }
  }
  parts.push(out)
  return parts.join('')
}

const CP1252_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d])

function latin1(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('latin1')
}

/** Caracteres de Windows-1252 en 0x80…0x9F (el `TextDecoder` de Node los decodifica como Latin-1: no se usa). */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ'

function windows1252(data: Uint8Array): string | null {
  for (const b of data) if (CP1252_UNDEFINED.has(b)) return null
  const parts: string[] = []
  let chunk = ''
  for (let i = 0; i < data.length; i++) {
    const b = data[i]
    chunk += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b)
    if (chunk.length >= 8192) { parts.push(chunk); chunk = '' }
  }
  parts.push(chunk)
  return parts.join('')
}

/** Decodifica bytes de texto detectando la codificación. Nunca falla: en el peor caso usa Latin-1. */
export function decodeText(data: Uint8Array, preferred?: string): Decoded {
  if (data.length === 0) return { text: '', encodingName: 'UTF-8' }

  // 1. Marcas de orden de bytes (BOM)
  if (startsWith(data, [0xff, 0xfe, 0x00, 0x00])) {
    const s = utf32(data.subarray(4), true)
    if (s !== null) return { text: finish(s), encodingName: 'UTF-32LE' }
  }
  if (startsWith(data, [0x00, 0x00, 0xfe, 0xff])) {
    const s = utf32(data.subarray(4), false)
    if (s !== null) return { text: finish(s), encodingName: 'UTF-32BE' }
  }
  if (startsWith(data, [0xef, 0xbb, 0xbf])) return { text: finish(utf8(data.subarray(3))), encodingName: 'UTF-8' }
  if (startsWith(data, [0xff, 0xfe])) {
    const s = tryDecode('utf-16le', data.subarray(2), false)
    if (s !== null) return { text: finish(s), encodingName: 'UTF-16LE' }
  }
  if (startsWith(data, [0xfe, 0xff])) {
    const s = tryDecode('utf-16be', data.subarray(2), false)
    if (s !== null) return { text: finish(s), encodingName: 'UTF-16BE' }
  }

  // 2. UTF-16 sin BOM: muchos bytes nulos alternados
  const u16 = guessUTF16WithoutBOM(data)
  if (u16) {
    const s = tryDecode(u16.label, data, true) ?? tryDecode(u16.label, data, false)
    if (s !== null) return { text: finish(s), encodingName: u16.name }
  }

  // 3. UTF-8 estricto (el texto Latin-1 con tildes no suele ser UTF-8 válido por casualidad)
  const s8 = strictUTF8(data)
  if (s8 !== null) return { text: finish(s8), encodingName: 'UTF-8' }
  // 3b. UTF-8 con un corte al final (archivo truncado a mitad de un carácter)
  if (data.length > 8) {
    const prefix = truncatedUTF8Prefix(data)
    if (prefix) {
      const s = strictUTF8(prefix)
      if (s !== null) return { text: finish(s), encodingName: 'UTF-8' }
    }
  }

  // 4. Codificación indicada por quien llama (cabecera HTTP, meta charset…)
  if (preferred) {
    const label = encodingLabel(preferred)
    if (label && label !== 'utf-8') {
      const s = label === 'windows-1252' ? windows1252(data) : tryDecode(label, data, true)
      if (s !== null) return { text: finish(s), encodingName: label === 'windows-1252' ? 'Windows-1252' : label.toUpperCase() }
    }
  }

  // 5. Windows-1252 (superconjunto práctico de Latin-1) y, si no, Latin-1 puro
  const w = windows1252(data)
  if (w !== null) return { text: finish(w), encodingName: 'Windows-1252' }
  return { text: finish(latin1(data)), encodingName: 'ISO-8859-1' }
}

/** Quita el BOM residual, normaliza los saltos de línea y elimina los nulos. */
export function finish(s: string): string {
  let text = s
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return normalizeNewlines(text)
}

/** `\r\n` y `\r` → `\n`; elimina `\0`. */
export function normalizeNewlines(s: string): string {
  if (!/[\r\0]/.test(s)) return s
  return s.replace(/\r\n?/g, '\n').replace(/\0/g, '')
}

function guessUTF16WithoutBOM(data: Uint8Array): { label: string; name: string } | null {
  const sample = data.subarray(0, 4096)
  if (sample.length < 16) return null
  let evenZeros = 0, oddZeros = 0, evenText = 0, oddText = 0
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]
    const isText = (b >= 0x20 && b < 0x7f) || b === 9 || b === 10 || b === 13 || b >= 0xa0
    if (i % 2 === 0) { if (b === 0) evenZeros++; else if (isText) evenText++ }
    else { if (b === 0) oddZeros++; else if (isText) oddText++ }
  }
  const half = Math.max(1, Math.floor(sample.length / 2))
  if (oddZeros / half > 0.3 && evenZeros * 10 < oddZeros && evenText * 10 >= (half - oddZeros) * 9) return { label: 'utf-16le', name: 'UTF-16LE' }
  if (evenZeros / half > 0.3 && oddZeros * 10 < evenZeros && oddText * 10 >= (half - evenZeros) * 9) return { label: 'utf-16be', name: 'UTF-16BE' }
  return null
}

/** Si el archivo acaba con una secuencia UTF-8 incompleta, los bytes sin ese final. */
function truncatedUTF8Prefix(data: Uint8Array): Uint8Array | null {
  const n = data.length
  for (let back = 1; back <= 3 && n - back >= 0; back++) {
    const idx = n - back
    const b = data[idx]
    if ((b & 0xc0) === 0x80) continue
    const needed = (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 1
    return needed > back ? data.subarray(0, idx) : null
  }
  return null
}

/** ¿Estos bytes parecen texto (y no un binario)? */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return true
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff]) || startsWith(head, [0xef, 0xbb, 0xbf])) return true
  if (guessUTF16WithoutBOM(head)) return true
  let control = 0
  const n = Math.min(head.length, 4096)
  for (let i = 0; i < n; i++) {
    const byte = head[i]
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) control++
  }
  return control * 100 <= Math.max(1, n) * 2
}

// MARK: HTML

/** Busca `<meta charset>`, `<meta http-equiv … charset=…>` o la declaración XML en los primeros bytes. */
export function sniffHTMLCharset(data: Uint8Array): string | null {
  const head = Array.from(data.subarray(0, 4096), (b) => String.fromCharCode(b < 0x80 ? b : 0x20)).join('')
  const patterns = [/<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)/i, /<\?xml[^>]+encoding\s*=\s*["']([A-Za-z0-9_\-:.]+)/i]
  for (const p of patterns) {
    const m = p.exec(head)
    if (m) return m[1]
  }
  return null
}

/** Etiqueta de `TextDecoder` para un nombre IANA («utf-8», «windows-1252», «latin1»…), o `null` si no se conoce. */
export function encodingLabel(ianaName: string): string | null {
  const name = ianaName.trim().toLowerCase()
  if (!name) return null
  try {
    return new TextDecoder(name).encoding
  } catch {
    return null
  }
}

/** Decodifica HTML respetando la codificación declarada (cabecera o meta); si falla, la detecta. */
export function decodeHTML(data: Uint8Array, headerCharset?: string | null): Decoded {
  let declared: string | undefined
  if (headerCharset && encodingLabel(headerCharset)) declared = headerCharset
  else {
    const meta = sniffHTMLCharset(data)
    if (meta && encodingLabel(meta)) declared = meta
  }
  return decodeText(data, declared)
}
