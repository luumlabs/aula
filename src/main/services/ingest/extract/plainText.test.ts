import { mkdirSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullText } from '@shared/ingest'
import { isIngestError, type IngestErrorKind } from '../errors'
import { documentFromText, readDocument } from '../pipeline'
import { tempDir, type TempDir } from '../testing/files'
import { charCount } from '../text/unicode'
import { rtfText } from './plainText'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

async function rejectsKind(promise: Promise<unknown>, kind: IngestErrorKind, check?: (e: Error) => boolean): Promise<void> {
  const e = await promise.then(() => null, (x: unknown) => x)
  expect(isIngestError(e, kind), String(e)).toBe(true)
  if (check) expect(check(e as Error), (e as Error).message).toBe(true)
}
const cp1252 = (s: string): Uint8Array => {
  const map: Record<string, number> = { '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '—': 0x97, '…': 0x85, '€': 0x80 }
  return new Uint8Array(Array.from(s, (c) => map[c] ?? c.charCodeAt(0)))
}
const sample = 'Teorema de Pitágoras\n\nEn un triángulo rectángulo, a² + b² = c².\nCanción, año, niño: ¿qué tal?'

describe('Texto: codificaciones', () => {
  it('UTF-8', async () => {
    const doc = await readDocument(tmp.write('notas.txt', sample))
    expect(doc.kind).toBe('text')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].text).toBe(sample)
    expect(doc.title).toBe('notas')
    expect(doc.metadata.encoding).toBe('UTF-8')
    expect(doc.pages[0].usedOCR).toBe(false)
  })

  it('UTF-8 con BOM y CRLF; UTF-16', async () => {
    expect((await readDocument(tmp.write('windows.txt', new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(sample.replace(/\n/g, '\r\n'))])))).pages[0].text).toBe(sample)
    const le = new Uint8Array([0xff, 0xfe, ...Buffer.from(sample, 'utf16le')])
    expect((await readDocument(tmp.write('le.txt', le))).pages[0].text).toBe(sample)
  })

  it('Latin-1 y Windows-1252', async () => {
    const plain = sample.replace(/²/g, '2')
    expect((await readDocument(tmp.write('viejo.txt', new Uint8Array(Buffer.from(plain, 'latin1'))))).pages[0].text).toBe(plain)
    expect((await readDocument(tmp.write('comillas.txt', cp1252('“Hola” — ‘mundo’ … €5')))).pages[0].text).toBe('“Hola” — ‘mundo’ … €5')
  })
})

describe('Texto plano y Markdown', () => {
  it('ordena los espacios', async () => {
    expect((await readDocument(tmp.write('sucio.txt', '  Línea con espacios al final   \n\n\n\n\nOtra línea\t\t\n\u0007control\n\n\n'))).pages[0].text).toBe('Línea con espacios al final\n\nOtra línea\ncontrol')
  })

  it('título y cabecera YAML del Markdown', async () => {
    const md = '---\ntitle: "Apuntes de Cálculo"\nauthor: Ana Pérez\ntags: derivadas, límites\n---\n\n# Capítulo 1\n\nTexto con una imagen ![gráfica](g.png) y una lista:\n\n- uno\n- dos\n```python\n# esto no es un título\n```'
    const doc = await readDocument(tmp.write('calculo.md', md))
    expect(doc.kind).toBe('markdown')
    expect(doc.title).toBe('Apuntes de Cálculo')
    expect(doc.metadata.author).toBe('Ana Pérez')
    expect(doc.metadata.keywords).toBe('derivadas, límites')
    expect(doc.pages[0].text).not.toContain('title:')
    expect(doc.pages[0].text.startsWith('# Capítulo 1')).toBe(true)
    expect(doc.pages[0].heading).toBe('Capítulo 1')
    expect(doc.pages[0].hasFigures).toBe(true)
    expect((await readDocument(tmp.write('a.md', 'Introducción\n\n## Sub\n\n# Principal\n\ntexto'))).title).toBe('Sub')
    expect((await readDocument(tmp.write('sin_titulos.md', 'solo texto sin títulos'))).title).toBe('sin titulos')
  })

  it('CSV y código son texto', async () => {
    const csv = await readDocument(tmp.write('notas.csv', 'nombre,nota\nAna,9.5\nLuis,7'))
    expect(csv.kind).toBe('text')
    expect(csv.pages[0].text).toBe('nombre,nota\nAna,9.5\nLuis,7')
    expect((await readDocument(tmp.write('f.py', 'def f(x):\n    return x**2'))).kind).toBe('text')
  })

  it('archivos vacíos', async () => {
    await rejectsKind(readDocument(tmp.write('vacio.txt', '')), 'corrupt', (e) => e.message.includes('vacío'))
    const blank = await readDocument(tmp.write('espacios.txt', '   \n\n  \n'))
    expect(blank.pages[0].text).toBe('')
    expect(blank.warnings.some((w) => w.includes('no contiene texto'))).toBe(true)
  })

  it('un texto enorme se rechaza; uno grande es rápido', async () => {
    const huge = join(tmp.path, 'enorme.txt')
    writeFileSync(huge, '')
    truncateSync(huge, 51 * 1024 * 1024)
    await rejectsKind(readDocument(huge), 'tooLarge')
    const line = 'Esta es una línea de texto de prueba con acentos: canción, año, niño, camión y fórmulas x² + y² = z².\n'
    const t0 = performance.now()
    const doc = await readDocument(tmp.write('grande.txt', line.repeat(80_000)))
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(charCount(fullText(doc))).toBeGreaterThan(2_500_000)
  })

  it('carpetas, archivos que no existen y binarios', async () => {
    await rejectsKind(readDocument(join(tmp.path, 'no-existe.txt')), 'fileNotFound', (e) => e.message.includes('no-existe.txt'))
    const dir = join(tmp.path, 'carpeta')
    mkdirSync(dir)
    await rejectsKind(readDocument(dir), 'unsupportedType', (e) => e.message.includes('carpeta'))
    await rejectsKind(readDocument(tmp.write('datos.bin', new Uint8Array(Array.from({ length: 500 }, (_, i) => (i * 7) % 251)))), 'unsupportedType')
    await rejectsKind(readDocument(tmp.write('viejo.ppt', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(700).fill(0)]))), 'unsupportedType', (e) => e.message.includes('.ppt'))
    await rejectsKind(readDocument(tmp.write('algo.pages', new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(100).fill(0)]))), 'unsupportedType', (e) => e.message.includes('iWork'))
  })

  it('texto pegado', () => {
    const doc = documentFromText('Hola\r\n\r\n\r\n\r\nmundo  \n# Título', '  Mi nota  ')
    expect(doc.title).toBe('Mi nota')
    expect(doc.kind).toBe('text')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0]).toMatchObject({ number: 1, text: 'Hola\n\nmundo\n# Título', heading: 'Título' })
    expect(doc.warnings).toEqual([])
    const empty = documentFromText('   ', '')
    expect(empty.title).toBe('Texto pegado')
    expect(empty.warnings.some((w) => w.includes('vacío'))).toBe(true)
    expect(empty.pages).toHaveLength(1)
    expect(fullText(empty)).toBe('')
  })
})

describe('RTF', () => {
  const RTF = '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761 {\\fonttbl\\f0\\fswiss Helvetica;} {\\colortbl;\\red255\\green255\\blue255;} \\f0\\fs24 Hola \\b mundo\\b0 : f\\\'f3rmula \\\'e1\\\'e9 y m\\\'e1s.\\par Segunda l\\\'ednea con \\u241?o (\\u241\\\'f1) y \\u960? \\u8805? 0.\\par {\\info{\\title Mi t\\\'edtulo}{\\author Ana}}}'

  it('archivo RTF', async () => {
    const doc = await readDocument(tmp.write('nota.rtf', RTF))
    expect(doc.kind).toBe('rtf')
    expect(doc.title).toBe('Mi título')
    expect(doc.metadata.author).toBe('Ana')
    expect(doc.pages[0].text).toContain('Hola mundo: fórmula áé y más.')
    expect(doc.pages[0].text).toContain('Segunda línea con ño (ñ) y π ≥ 0.')
  })

  it('analizador propio', () => {
    const r = rtfText(new Uint8Array(Buffer.from(RTF)))
    expect(r.text).toContain('Hola mundo: fórmula áé y más.')
    expect(r.text).toContain('Segunda línea con ño (ñ) y π ≥ 0.')
    expect(r.title).toBe('Mi título')
    expect(r.author).toBe('Ana')
    expect(r.text).not.toContain('Helvetica')
    expect(r.text).not.toContain('cocoartf')
    const dest = rtfText(new Uint8Array(Buffer.from('{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\stylesheet{\\s1 Normal;}}{\\*\\generator Word;}{\\pict\\pngblip 89504e470d0a1a0a}Texto {\\b visible}\\tab con tab\\line y salto\\par}')))
    expect(dest.text.trim()).toBe('Texto visible\tcon tab\ny salto')
    expect(rtfText(new Uint8Array(Buffer.from('{\\rtf1 a \\{llaves\\} \\\\ barra \\emdash\\endash\\bullet\\lquote x\\rquote\\~nbsp \\\'93hola\\\'94}'))).text).toBe('a {llaves} \\ barra —–•‘x’ nbsp “hola”')
  })

  it('RTF roto no rompe nada; bytes UTF-8 sin escapar', async () => {
    for (const junk of ['{\\rtf1', '{\\rtf1 {{{{', '{\\rtf1 \\u', "{\\rtf1 \\'", '{\\rtf1 \\u99999999999?}', '}}}}\\par']) rtfText(new Uint8Array(Buffer.from(junk)))
    expect((await readDocument(tmp.write('roto.rtf', '{\\rtf1\\ansi texto sin cerrar \\par mas texto'))).pages[0].text).toContain('texto sin cerrar')
    const r = rtfText(new Uint8Array([...Buffer.from("{\\rtf1\\ansi Párrafo con ñ, ángulo y 日本 en UTF-8 sin escapar.\\par Windows: \\'e1}"), 0x20, 0xe9, 0x20]))
    expect(r.text.startsWith('Párrafo con ñ, ángulo y 日本 en UTF-8 sin escapar.')).toBe(true)
    expect(r.text.endsWith('Windows: á é ')).toBe(true)
  })

  it('un RTF grande es rápido', async () => {
    const body = "Párrafo de prueba largo con acentos \\'e1\\'e9 y mas texto de relleno.\\par ".repeat(15_000)
    const t0 = performance.now()
    const doc = await readDocument(tmp.write('grande.rtf', '{\\rtf1\\ansi\\ansicpg1252 ' + body + '}'))
    expect(performance.now() - t0).toBeLessThan(8000)
    expect(doc.pages[0].text.startsWith('Párrafo de prueba largo con acentos áé')).toBe(true)
    expect(doc.pages[0].text.endsWith('mas texto de relleno.')).toBe(true)
  })
})
