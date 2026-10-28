import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locationLabel } from '@shared/ingest'
import { detectKind, kindForExtension } from './kind'
import { png, tempDir, type TempDir } from './testing/files'
import { docx, epub, p, pptx, sp, xhtml, xlsx } from './testing/office'
import { buildPDF } from './testing/pdf'
import { ZipForge } from './testing/zipForge'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const bytes = (...parts: Array<number[] | string>): Uint8Array => {
  const out: number[] = []
  for (const part of parts) out.push(...(typeof part === 'string' ? Array.from(Buffer.from(part, 'latin1')) : part))
  return new Uint8Array(out)
}

describe('detectKind', () => {
  it('extensiones conocidas sin archivo', () => {
    const cases: Array<[string, string]> = [
      ['a.pdf', 'pdf'], ['a.PDF', 'pdf'], ['a.docx', 'docx'], ['a.docm', 'docx'], ['a.pptx', 'pptx'], ['a.ppsx', 'pptx'], ['a.xlsx', 'xlsx'], ['a.xlsm', 'xlsx'],
      ['a.epub', 'epub'], ['a.html', 'html'], ['a.htm', 'html'], ['a.xhtml', 'html'], ['a.md', 'markdown'], ['a.markdown', 'markdown'], ['a.txt', 'text'],
      ['a.csv', 'text'], ['a.tex', 'text'], ['a.rtf', 'rtf'], ['a.png', 'image'], ['a.jpg', 'image'], ['a.JPEG', 'image'], ['a.heic', 'image'], ['a.tiff', 'image'],
      ['a.tif', 'image'], ['a.webp', 'image'], ['a.gif', 'image'], ['a.bmp', 'image'], ['a.zzz', 'unknown'], ['sinextension', 'unknown']
    ]
    for (const [name, kind] of cases) expect(detectKind(join(tmp.path, name)), name).toBe(kind)
  })

  it('direcciones web', () => {
    expect(detectKind('https://example.com/a.pdf')).toBe('web')
    expect(detectKind('http://example.com')).toBe('web')
    expect(detectKind('HTTPS://EXAMPLE.COM')).toBe('web')
    expect(detectKind('ftp://example.com/a.pdf')).toBe('unknown')
    expect(detectKind('mailto:a@b.c')).toBe('unknown')
  })

  it('la firma de bytes manda sobre la extensión', () => {
    const image = png(8, 8)
    expect(detectKind(tmp.write('foto.pdf', image))).toBe('image')
    expect(detectKind(tmp.write('foto.txt', image))).toBe('image')
    expect(detectKind(tmp.write('foto', image))).toBe('image')
    const pdf = buildPDF({ pages: [{ texts: [{ text: 'Hola', x: 72, y: 700 }] }] })
    expect(detectKind(tmp.write('documento.png', pdf))).toBe('pdf')
    expect(detectKind(tmp.write('documento', pdf))).toBe('pdf')
    expect(detectKind(tmp.write('nota.txt', '{\\rtf1\\ansi Hola}'))).toBe('rtf')
  })

  it('cabecera de PDF tras basura', () => {
    expect(detectKind(tmp.write('raro.dat', bytes(' '.repeat(200), '%PDF-1.4\n', 'A'.repeat(100))))).toBe('pdf')
  })

  it('formatos de imagen por su firma', () => {
    expect(detectKind(tmp.write('a', bytes([0xff, 0xd8, 0xff, 0xe0], 'x'.repeat(40))))).toBe('image')
    expect(detectKind(tmp.write('b', bytes([0x49, 0x49, 0x2a, 0], 'x'.repeat(40))))).toBe('image')
    expect(detectKind(tmp.write('c', bytes('GIF89a', 'x'.repeat(40))))).toBe('image')
    expect(detectKind(tmp.write('d', bytes('BM', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0, 0, 0], 'x'.repeat(40))))).toBe('image')
    expect(detectKind(tmp.write('e', bytes('RIFF', [0x10, 0, 0, 0], 'WEBPVP8 ', Array(32).fill(0))))).toBe('image')
    expect(detectKind(tmp.write('f', bytes([0, 0, 0, 0x18], 'ftypheic', Array(32).fill(0))))).toBe('image')
    expect(detectKind(tmp.write('g', bytes([0, 0, 0, 0x18], 'ftypisom', Array(32).fill(0))))).toBe('unknown')
  })

  it('los Office antiguos (OLE) no se reconocen', () => {
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], Array(100).fill(0))
    expect(detectKind(tmp.write('viejo.doc', ole))).toBe('unknown')
    expect(detectKind(tmp.write('viejo.xls', ole))).toBe('unknown')
  })

  it('paquetes ZIP por su contenido y no por el nombre', () => {
    const d = docx({ body: p('Hola') })
    const s = pptx([{ shapes: sp(['T'], 'title') }])
    const x = xlsx([{ name: 'H', rowsXML: '' }])
    const e = epub({ chapters: [{ file: 'c1.xhtml', html: xhtml('<p>Hola</p>') }] })
    expect(detectKind(tmp.write('a.docx', d))).toBe('docx')
    expect(detectKind(tmp.write('a.zip', d))).toBe('docx')
    expect(detectKind(tmp.write('a.pptx', d))).toBe('docx')
    expect(detectKind(tmp.write('b.docx', s))).toBe('pptx')
    expect(detectKind(tmp.write('c.pdf', x))).toBe('xlsx')
    expect(detectKind(tmp.write('d.zip', e))).toBe('epub')
    expect(detectKind(tmp.write('d.epub', e))).toBe('epub')
  })

  it('un ZIP cualquiera usa la extensión', () => {
    const zip = new ZipForge({ 'a.txt': 'hola' }).build()
    expect(detectKind(tmp.write('x.docx', zip))).toBe('docx')
    expect(detectKind(tmp.write('x.zip', zip))).toBe('unknown')
    expect(detectKind(tmp.write('x', zip))).toBe('unknown')
  })

  it('un ZIP roto no rompe nada', () => {
    const junk = bytes('PK', [3, 4], Array(500).fill(0x55))
    expect(detectKind(tmp.write('roto.docx', junk))).toBe('docx')
    expect(detectKind(tmp.write('roto.bin', junk))).toBe('unknown')
  })

  it('HTML y texto por su contenido', () => {
    expect(detectKind(tmp.write('pagina', '<!DOCTYPE html><html><body>Hola</body></html>'))).toBe('html')
    expect(detectKind(tmp.write('pagina2', '  \n<html lang="es"><head></head></html>'))).toBe('html')
    expect(detectKind(tmp.write('notas', 'Hola, esto es un texto normal con acentos: canción.'))).toBe('text')
    expect(detectKind(tmp.write('vacio', new Uint8Array()))).toBe('unknown')
    expect(detectKind(tmp.write('binario', new Uint8Array(Array.from({ length: 400 }, (_, i) => i % 7))))).toBe('unknown')
  })

  it('una extensión de texto con HTML dentro sigue siendo texto', () => {
    expect(detectKind(tmp.write('pagina.txt', '<html><body>x</body></html>'))).toBe('text')
  })

  it('un archivo vacío usa la extensión', () => {
    expect(detectKind(tmp.write('vacio.pdf', new Uint8Array()))).toBe('pdf')
    expect(detectKind(tmp.write('vacio.md', new Uint8Array()))).toBe('markdown')
  })

  it('extensiones de texto que conoce el sistema', () => {
    expect(detectKind(tmp.write('datos.vcf', 'hola'))).toBe('text')
    expect(kindForExtension('yaml')).toBe('text')
  })

  it('una carpeta no es un archivo', () => {
    const dir = join(tmp.path, 'carpeta')
    mkdirSync(dir)
    expect(detectKind(dir)).toBe('unknown')
  })

  it('etiquetas de ubicación', () => {
    expect(locationLabel('pdf', 3)).toBe('p. 3')
    expect(locationLabel('pptx', 3)).toBe('diapositiva 3')
    expect(locationLabel('xlsx', 2)).toBe('hoja 2')
    expect(locationLabel('epub', 5)).toBe('cap. 5')
    expect(locationLabel('epub', 1234, 'en')).toBe('ch. 1234')
  })
})
