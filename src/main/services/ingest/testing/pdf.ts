// Solo para pruebas: PDF mínimos y válidos escritos a mano (Helvetica estándar, WinAnsi), con texto colocado, imágenes,
// rotación, metadatos y, opcionalmente, un diccionario de cifrado que pide contraseña.
import * as zlib from 'node:zlib'

export interface PdfText { text: string; x: number; y: number; size?: number; bold?: boolean }
export interface PdfImage { x: number; y: number; w: number; h: number; pixelsW: number; pixelsH: number }
export interface PdfPageSpec {
  width?: number
  height?: number
  rotate?: number
  texts?: PdfText[]
  images?: PdfImage[]
}
export interface PdfSpec {
  pages: PdfPageSpec[]
  info?: Record<string, string>
  /** Añade un diccionario /Encrypt que no se abre con la contraseña vacía. */
  encrypted?: boolean
}

const WIN_ANSI: Record<string, number> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 }

/** Texto → cadena literal de PDF en WinAnsi (los caracteres que no caben pasan a «?»). */
function pdfString(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63
    let b = WIN_ANSI[ch] ?? (cp >= 0x20 && cp <= 0x7e ? cp : cp >= 0xa0 && cp <= 0xff ? cp : 63)
    if (b === 0x28 || b === 0x29 || b === 0x5c) { out += '\\' + String.fromCharCode(b); continue }
    if (b < 0x20) b = 63
    out += String.fromCharCode(b)
  }
  return '(' + out + ')'
}

export function buildPDF(spec: PdfSpec): Uint8Array {
  const objects: Buffer[] = []
  const add = (b: Buffer | null): number => { objects.push(b ?? Buffer.alloc(0)); return objects.length }
  const set = (n: number, s: string | Buffer): void => { objects[n - 1] = typeof s === 'string' ? Buffer.from(s, 'latin1') : s }
  const catalog = add(null)
  const pagesObj = add(null)
  const regular = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  const bold = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'))
  const kids: number[] = []
  for (const page of spec.pages) {
    const w = page.width ?? 612, h = page.height ?? 792
    let content = ''
    let xobjects = ''
    for (const t of page.texts ?? []) content += `BT /${t.bold ? 'F2' : 'F1'} ${t.size ?? 12} Tf ${t.x} ${t.y} Td ${pdfString(t.text)} Tj ET\n`
    ;(page.images ?? []).forEach((img, k) => {
      const raw = Buffer.alloc(img.pixelsW * img.pixelsH, 200)
      const packed = zlib.deflateSync(raw)
      const id = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.pixelsW} /Height ${img.pixelsH} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`), packed, Buffer.from('\nendstream')]))
      xobjects += ` /Im${k} ${id} 0 R`
      content += `q ${img.w} 0 0 ${img.h} ${img.x} ${img.y} cm /Im${k} Do Q\n`
    })
    const stream = Buffer.from(content, 'latin1')
    const c = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('endstream')]))
    const resources = `<< /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${xobjects ? ` /XObject <<${xobjects} >>` : ''} >>`
    const rotate = page.rotate ? ` /Rotate ${page.rotate}` : ''
    kids.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w} ${h}]${rotate} /Resources ${resources} /Contents ${c} 0 R >>`)))
  }
  set(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`)
  set(pagesObj, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`)
  let info = 0
  if (spec.info) info = add(Buffer.from('<< ' + Object.entries(spec.info).map(([k, v]) => `/${k} ${pdfString(v)}`).join(' ') + ' >>', 'latin1'))
  let encrypt = 0
  if (spec.encrypted) {
    const fake = '<' + 'ab'.repeat(32) + '>'
    encrypt = add(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O ${fake} /U ${fake} /P -44 >>`))
  }
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  let offset = parts[0].length
  const offsets: number[] = []
  objects.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')])
    offsets.push(offset)
    offset += b.length
    parts.push(b)
  })
  let trailer = `<< /Size ${objects.length + 1} /Root ${catalog} 0 R`
  if (info) trailer += ` /Info ${info} 0 R`
  if (encrypt) trailer += ` /Encrypt ${encrypt} 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]`
  trailer += ' >>'
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n${trailer}\nstartxref\n${offset}\n%%EOF\n`
  parts.push(Buffer.from(xref, 'latin1'))
  return new Uint8Array(Buffer.concat(parts))
}

// Anchos de Helvetica (AFM, milésimas de em) de los caracteres 32…126; las letras acentuadas miden como su base.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667,
  944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const SPECIAL_WIDTHS: Record<string, number> = { '•': 350, '—': 1000, '–': 556, '…': 1000, '¿': 611, '¡': 333, '²': 333, '³': 333, '€': 556, '“': 333, '”': 333, '‘': 222, '’': 222 }

/** Ancho aproximado de un texto en Helvetica, en puntos. */
export function textWidth(text: string, size: number): number {
  let w = 0
  for (const ch of text) {
    const base = ch.normalize('NFD')[0] ?? ch
    const cp = base.codePointAt(0) ?? 63
    w += SPECIAL_WIDTHS[ch] ?? (cp >= 32 && cp <= 126 ? HELVETICA[cp - 32] : 556)
  }
  return (w * size) / 1000
}

/** Párrafo partido en líneas que caben en `width` puntos (como un maquetador: cada línea lo más llena posible). */
export function wrapToWidth(text: string, width: number, size: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? line + ' ' + word : word
    if (line && textWidth(candidate, size) > width) { out.push(line); line = word } else line = candidate
  }
  if (line) out.push(line)
  return out
}

/** Párrafo de prosa partido en líneas de como mucho `width` caracteres (para simular un PDF con texto real). */
export function wrapLines(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) { out.push(line); line = word } else line = line ? line + ' ' + word : word
  }
  if (line) out.push(line)
  return out
}

/** Líneas de texto colocadas de arriba abajo desde `top`. */
export function placeLines(lines: string[], x: number, top: number, size = 11, leading = 14): PdfText[] {
  return lines.map((text, i) => ({ text, x, y: top - i * leading, size }))
}

/** Párrafo maquetado en un rectángulo (borde superior `top`, ancho `width`), con interlineado de 1,2. */
export function paragraph(text: string, x: number, top: number, width: number, size = 12): PdfText[] {
  return placeLines(wrapToWidth(text, width, size), x, top - size, size, size * 1.2)
}

export const LOREM = 'La trigonometría estudia las relaciones entre los lados y los ángulos de los triángulos. El teorema de Pitágoras establece que en todo triángulo rectángulo el cuadrado de la hipotenusa es igual a la suma de los cuadrados de los catetos. Las funciones seno, coseno y tangente se definen sobre la circunferencia unitaria y permiten resolver problemas de ondas, oscilaciones y navegación.'
