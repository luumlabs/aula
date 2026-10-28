// API pública de la lectura (index.ts) y guardado en un curso; integración de todos los tipos (port de IngestIntegrationTests.swift).
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullText, locationLabel, type IngestInput, type SourceKind } from '@shared/ingest'
import { searchCourse } from '../search/course'
import { SearchIndex } from '../search/searchIndex'
import {
  chunkDocument, defaultOptions, detectKind, EmptySourceError, importSourceIntoPack, ingest, ingestFile, ingestText, ingestURL, isIngestError, loadChunks,
  loadSourcePages, moveSourceToPack, readDocument, removeSourceFromPack, setIngestLanguage, type HttpTransport
} from './index'
import { IngestError } from './errors'
import { ProgressLog, tempDir, type TempDir } from './testing/files'
import { cell, docx, epub, HEADING_STYLES, p, pptx, row, sp, xhtml, xlsx } from './testing/office'
import { buildPDF, LOREM, paragraph } from './testing/pdf'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => { tmp.cleanup(); setIngestLanguage('es') })

function samples(): Array<[string, SourceKind, string]> {
  const pdf = buildPDF({ info: { Title: 'Apuntes PDF' }, pages: [1, 2, 3].map((i) => ({ texts: [{ text: `Contenido de la página ${i} del PDF de ejemplo con texto suficiente.`, x: 72, y: 700 }] })) })
  return [
    ['pdf', 'pdf', tmp.write('a.pdf', pdf)],
    ['docx', 'docx', tmp.write('b.docx', docx({ body: p('Capítulo de Word', 'Heading1') + p('Texto del documento de Word con acentos: canción.'), title: 'Apuntes Word', styles: HEADING_STYLES }))],
    ['pptx', 'pptx', tmp.write('c.pptx', pptx([{ shapes: sp(['Diapositiva uno'], 'title') + sp(['Punto A', 'Punto B'], 'body', true) }]))],
    ['xlsx', 'xlsx', tmp.write('d.xlsx', xlsx([{ name: 'Datos', rowsXML: row(1, cell('A1', '1') + cell('B1', '2')) }]))],
    ['epub', 'epub', tmp.write('e.epub', epub({ chapters: [{ file: 'c.xhtml', html: xhtml('<h1>Capítulo del libro</h1><p>Texto del libro electrónico de ejemplo.</p>') }] }))],
    ['html', 'html', tmp.write('f.html', '<html><head><title>Página</title></head><body><p>Texto de la página HTML de ejemplo.</p></body></html>')],
    ['markdown', 'markdown', tmp.write('g.md', '# Apuntes\n\nTexto en Markdown con **negrita**.')],
    ['text', 'text', tmp.write('h.txt', 'Texto plano de ejemplo.')],
    ['rtf', 'rtf', tmp.write('i.rtf', '{\\rtf1\\ansi Texto en RTF de ejemplo.\\par}')]
  ]
}

function makePack(name = 'curso'): string {
  const dir = join(tmp.path, 'Packs', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({ schema: 1, id: name, title: 'Curso de prueba', subject: 'Matemáticas', sources: [] }))
  return dir
}
const packSources = (dir: string): Array<Record<string, unknown>> => (JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as { sources: Array<Record<string, unknown>> }).sources

describe('Opciones y errores', () => {
  it('valores por defecto del contrato', () => {
    expect(defaultOptions()).toMatchObject({ ocrWhenTextShorterThan: 40, maxPages: 2000, includeSpeakerNotes: true, allowPrivate: false, maxArchiveBytes: 200 * 1024 * 1024, maxArchiveEntries: 5000, maxWebBytes: 15 * 1024 * 1024 })
  })

  it('mensajes en español, con código estable', () => {
    for (const e of [new IngestError('fileNotFound', 'a.pdf'), new IngestError('unreadable', 'x'), new IngestError('unsupportedType', 'x'), new IngestError('passwordProtected', 'a.pdf'),
      new IngestError('corrupt', 'x'), new IngestError('tooLarge', 'x'), new IngestError('archiveLimit', 'x'), new IngestError('blockedURL', 'x'), new IngestError('network', 'x')]) {
      expect(e.message).toMatch(/[áéíóúñ]|archivo|página|pdf|dirección|seguridad|grande|dañado|contraseña|soportado|leer|descargar/)
      expect(e.code).toBe(`ingest_${e.kind}`)
    }
    expect(new IngestError('fileNotFound', 'apuntes.pdf').message).toBe('No se encontró el archivo «apuntes.pdf».')
    expect(new IngestError('tooLarge', 'el PDF ocupa más de 2 GB').message).toBe('El archivo es demasiado grande: el PDF ocupa más de 2 GB')
    expect(new IngestError('network', 'no hay conexión a internet').message).toBe('No se pudo descargar la página: no hay conexión a internet')
  })

  it('en inglés, con el catálogo de la app Swift', async () => {
    setIngestLanguage('en')
    expect(new IngestError('fileNotFound', 'notes.pdf').message).toBe('The file "notes.pdf" wasn\'t found.')
    const doc = await readDocument(tmp.write('vacio.md', '   '))
    expect(doc.warnings).toEqual(['The file doesn\'t contain any text.'])
    expect(locationLabel('pptx', 3, 'en')).toBe('slide 3')
  })
})

describe('Todos los tipos por la misma puerta', () => {
  it('cada tipo da un documento con progreso monótono', async () => {
    for (const [name, kind, path] of samples()) {
      const log = new ProgressLog()
      const doc = await readDocument(path, { onProgress: log.callback, ocr: false })
      expect(doc.kind, name).toBe(kind)
      expect(doc.title, name).not.toBe('')
      expect(fullText(doc).length, name).toBeGreaterThan(10)
      expect(doc.pages.map((x) => x.number), name).toEqual(doc.pages.map((_, i) => i + 1))
      expect(doc.metadata.sourceFile, name).toBe(path.split('/').pop())
      expect(log.fractions[0], name).toBe(0)
      expect(log.fractions[log.fractions.length - 1], name).toBe(1)
      expect(log.fractions, name).toEqual([...log.fractions].sort((a, b) => a - b))
      expect(log.messages.every((m) => m.length > 0), name).toBe(true)
      expect(detectKind(path), name).toBe(kind)
    }
  })

  it('a la vez da lo mismo que de uno en uno, y repetir es determinista', async () => {
    const files = samples()
    const sequential = []
    for (const [, , path] of files) sequential.push(await readDocument(path))
    const concurrent = await Promise.all(files.map(([, , path]) => readDocument(path)))
    expect(concurrent.map(fullText)).toEqual(sequential.map(fullText))
    expect(concurrent.map((d) => d.title)).toEqual(sequential.map((d) => d.title))
    for (const [, , path] of files) {
      const [a, b] = [await readDocument(path), await readDocument(path)]
      expect(a.pages).toEqual(b.pages)
      expect(a.metadata).toEqual(b.metadata)
    }
  })
})

describe('De la fuente a la búsqueda', () => {
  it('un PDF con capítulos: fragmento, página, título y cita', async () => {
    const topics = [['Triángulos', 'el teorema de Pitágoras relaciona los catetos con la hipotenusa'], ['Círculo unidad', 'las coordenadas de un punto del círculo son el coseno y el seno del ángulo'],
      ['Identidades', 'la identidad fundamental dice que seno al cuadrado más coseno al cuadrado vale uno'], ['Gráficas', 'la amplitud y el periodo describen la gráfica de la función seno']]
    const pdf = buildPDF({ pages: topics.map(([title, body], i) => ({ texts: [{ text: `Capítulo ${i + 1}: ${title}`, x: 72, y: 720, size: 22 }, ...paragraph(`En esta sección se explica que ${body}. ` + LOREM, 72, 680, 420, 11)] })) })
    const result = await ingestFile(tmp.write('libro.pdf', pdf), { sourceID: 'libro', chunk: { target: 300, maxChars: 500, overlap: 30 } })
    expect(result.sourceID).toBe('libro')
    expect(result.chunks.length).toBeGreaterThan(4)
    const index = new SearchIndex(result.chunks)
    const hit = index.search('hipotenusa catetos')[0]
    expect(hit.chunk.page).toBe(1)
    expect(hit.chunk.heading).toBe('Capítulo 1: Triángulos')
    expect(hit.snippet.includes('**hipotenusa**') || hit.snippet.includes('**catetos**')).toBe(true)
    const periodo = index.search('amplitud periodo')[0]
    expect(periodo.chunk.page).toBe(4)
    expect(periodo.chunk.heading).toBe('Capítulo 4: Gráficas')
    expect(locationLabel('pdf', periodo.chunk.page ?? 0)).toBe('p. 4')
    expect(SearchIndex.load(index.data()).search('amplitud periodo')[0].chunk.id).toBe(periodo.chunk.id)
  })

  it('texto pegado y bajas del índice', async () => {
    const pasted = ingestText('Primera idea sobre límites y continuidad.\n\nSegunda idea: la derivada es una razón de cambio.', 'Apuntes de clase', { sourceID: 'pegado' })
    expect(pasted.title).toBe('Apuntes de clase')
    const index = new SearchIndex(pasted.chunks)
    expect(index.search('razón de cambio')[0].chunk.sourceID).toBe('pegado')
    expect(index.search('derivada')).toHaveLength(1)
    const a = await ingestFile(tmp.write('a.txt', 'Documento A sobre el teorema del valor medio.'), { sourceID: 'A' })
    const b = await ingestFile(tmp.write('b.txt', 'Documento B sobre integrales impropias.'), { sourceID: 'B' })
    const both = new SearchIndex([...a.chunks, ...b.chunks])
    expect(both.search('teorema').map((h) => h.chunk.sourceID)).toEqual(['A'])
    both.remove('A')
    expect(both.search('teorema')).toHaveLength(0)
    expect(both.search('integrales').map((h) => h.chunk.sourceID)).toEqual(['B'])
  })

  it('el id de fuente por defecto es el de Swift y los fragmentos lo llevan', () => {
    const r = ingestText('Un texto cualquiera.', 'Mis apuntes de Álgebra')
    expect(r.sourceID).toMatch(/^mis-apuntes-de-algebra-[a-z0-9]{4}$/)
    expect(r.chunks.every((c) => c.sourceID === r.sourceID)).toBe(true)
    expect(r.text).toBe('Un texto cualquiera.')
    expect(r.pagesNeedingOCR).toEqual([])
  })
})

describe('Opciones, cancelación y rutas', () => {
  it('las opciones llegan a los extractores', async () => {
    const pdf = buildPDF({ pages: [1, 2, 3, 4, 5, 6].map((i) => ({ texts: [{ text: `Texto de la página ${i} del documento largo de pruebas.`, x: 72, y: 700 }] })) })
    expect((await readDocument(tmp.write('largo.pdf', pdf), { maxPages: 2 })).pages).toHaveLength(2)
    const slides = pptx([1, 2, 3, 4, 5].map((i) => ({ shapes: sp([`S${i}`], 'title'), notes: `nota ${i}` })))
    expect((await readDocument(tmp.write('n.pptx', slides))).pages[0].text).toContain('nota 1')
    const limited = await readDocument(tmp.write('n2.pptx', slides), { maxPages: 3, includeSpeakerNotes: false })
    expect(limited.pages).toHaveLength(3)
    expect(limited.pages[0].text).not.toContain('nota')
  })

  it('cancelada antes de empezar', async () => {
    const c = new AbortController()
    c.abort()
    await expect(ingestFile(tmp.write('x.txt', 'texto'), { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(ingest({ type: 'text', text: 'hola' }, { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rutas con espacios y acentos, enlaces, permisos y esquemas raros', async () => {
    const doc = await readDocument(tmp.write('mi carpeta/Apuntes ñandú (copia).txt', 'Texto en una ruta con espacios y acentos.'))
    expect(doc.title).toBe('Apuntes ñandú (copia)')
    expect(doc.pages[0].text).toBe('Texto en una ruta con espacios y acentos.')
    const target = tmp.write('real.txt', 'Contenido enlazado.')
    symlinkSync(target, join(tmp.path, 'enlace.txt'))
    expect((await readDocument(join(tmp.path, 'enlace.txt'))).pages[0].text).toBe('Contenido enlazado.')
    const secret = tmp.write('privado.txt', 'secreto')
    chmodSync(secret, 0o000)
    try {
      const e = await readDocument(secret).then(() => null, (x: unknown) => x)
      if (e !== null) expect(isIngestError(e, 'unreadable'), String(e)).toBe(true)        // como administrador, 000 no impide leer
    } finally { chmodSync(secret, 0o644) }
    const ftp = await readDocument('ftp://example.com/x.pdf').then(() => null, (x: unknown) => x)
    expect(isIngestError(ftp, 'unsupportedType')).toBe(true)
  })
})

describe('Guardar en un curso (importSourceIntoPack)', () => {
  it('un archivo: original, chunks.json, pages.json, pack.json e índice', async () => {
    const pack = makePack()
    const file = tmp.write('Tema_3 límites.pdf', buildPDF({ info: { Title: 'Límites y continuidad' }, pages: [
      { texts: [{ text: 'Límites laterales', x: 72, y: 720, size: 20 }, ...paragraph('El límite lateral por la izquierda se acerca al punto desde valores menores. ' + LOREM, 72, 690, 420, 11)] },
      { images: [{ x: 0, y: 0, w: 612, h: 792, pixelsW: 850, pixelsH: 1100 }] }
    ] }))
    const log = new ProgressLog()
    const imported = await importSourceIntoPack(pack, { type: 'file', path: file }, { trust: 'notes', onProgress: log.callback })
    const { meta, result } = imported
    expect(meta.id).toMatch(/^limites-y-continuidad-[a-z0-9]{4}$/)
    expect(meta).toMatchObject({ title: 'Límites y continuidad', kind: 'pdf', filename: 'Tema_3 límites.pdf', pages: 2, status: 'ready', trust: 'notes' })
    expect(meta.characters).toBeGreaterThan(100)
    expect(result.pagesNeedingOCR).toEqual([2])
    const dir = join(pack, 'sources', meta.id)
    expect(imported.directory).toBe(dir)
    expect(readdirSync(dir).sort()).toEqual(['Tema_3 límites.pdf', 'chunks.json', 'pages.json'].sort())
    // chunks.json como lo escribe Swift: claves ordenadas, sin sangría
    const raw = readFileSync(join(dir, 'chunks.json'), 'utf8')
    expect(raw.startsWith('[{"heading":')).toBe(true)
    expect(raw).not.toContain('\n ')
    expect(loadChunks(pack, meta.id)).toEqual(result.chunks)
    expect(result.chunks.every((c) => c.sourceID === meta.id)).toBe(true)
    const pages = loadSourcePages(pack, meta.id)
    expect(pages?.pages[1].needsOCR).toBe(true)
    expect(pages?.pagesNeedingOCR).toEqual([2])
    expect(packSources(pack).map((s) => s.id)).toEqual([meta.id])
    expect(existsSync(join(pack, 'sources', 'index.json'))).toBe(true)
    const hits = await searchCourse(pack, 'límite lateral izquierda')
    expect(hits[0]).toMatchObject({ sourceID: meta.id, sourceTitle: 'Límites y continuidad', page: 1 })
    expect(log.fractions[log.fractions.length - 1]).toBe(1)
    expect(log.fractions).toEqual([...log.fractions].sort((a, b) => a - b))
    expect(log.messages).toContain('Preparando para buscar…')
  })

  it('texto pegado y página web; ids distintos aunque el título se repita', async () => {
    const pack = makePack()
    const a = await importSourceIntoPack(pack, { type: 'text', text: 'Las derivadas parciales miden el cambio en una dirección.', title: 'Apuntes' })
    const b = await importSourceIntoPack(pack, { type: 'text', text: 'Otro texto sobre integrales dobles.', title: 'Apuntes' }, { sourceID: undefined, note: 'de la pizarra' })
    expect(a.meta.id).not.toBe(b.meta.id)
    expect(b.meta.note).toBe('de la pizarra')
    expect(a.meta.filename).toBeUndefined()
    const transport: HttpTransport = {
      request: async (req) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, remoteAddress: '93.184.216.34', abort: () => undefined,
        body: (async function* () { yield new Uint8Array(Buffer.from('<html><head><title>Wiki de cálculo</title></head><body><article><h1>Regla de la cadena</h1><p>La regla de la cadena deriva funciones compuestas.</p></article></body></html>')) })() })
    }
    const w = await importSourceIntoPack(pack, { type: 'url', url: 'http://93.184.216.34/cadena' }, { transport, trust: 'web' })
    expect(w.meta).toMatchObject({ kind: 'web', url: 'http://93.184.216.34/cadena', trust: 'web', title: 'Wiki de cálculo' })
    expect(packSources(pack).map((s) => s.id)).toEqual([a.meta.id, b.meta.id, w.meta.id])
    expect((await searchCourse(pack, 'regla cadena'))[0].sourceID).toBe(w.meta.id)
    expect((await ingestURL('http://93.184.216.34/cadena', { transport })).title).toBe('Wiki de cálculo')
  })

  it('sin texto no se guarda; con título propio sí cambia el id', async () => {
    const pack = makePack()
    await expect(importSourceIntoPack(pack, { type: 'file', path: tmp.write('vacio.md', '   \n') })).rejects.toBeInstanceOf(EmptySourceError)
    expect(packSources(pack)).toEqual([])
    const named = await importSourceIntoPack(pack, { type: 'file', path: tmp.write('x.txt', 'Contenido del material.'), title: 'Guía oficial del examen' } as IngestInput, { trust: 'official' })
    expect(named.meta.id.startsWith('guia-oficial-del-examen-')).toBe(true)
    expect(named.meta.title).toBe('Guía oficial del examen')
  })

  it('borrar un material y pasarlo de un área de preparación a un curso', async () => {
    const draft = join(tmp.path, 'Borradores', 'd1')
    mkdirSync(draft, { recursive: true })
    const staged = await importSourceIntoPack(draft, { type: 'text', text: 'Teoría de grafos: caminos y ciclos.', title: 'Grafos' })
    expect(existsSync(join(draft, 'pack.json'))).toBe(false)
    expect((await searchCourse(draft, 'grafos'))[0].sourceID).toBe(staged.meta.id)
    const pack = makePack()
    moveSourceToPack(draft, staged.meta, pack)
    expect(existsSync(join(draft, 'sources', staged.meta.id))).toBe(false)
    expect(packSources(pack).map((s) => s.id)).toEqual([staged.meta.id])
    expect((await searchCourse(pack, 'ciclos'))[0].sourceID).toBe(staged.meta.id)
    removeSourceFromPack(pack, staged.meta.id)
    expect(packSources(pack)).toEqual([])
    expect(existsSync(join(pack, 'sources', staged.meta.id))).toBe(false)
    expect(await searchCourse(pack, 'ciclos')).toEqual([])
    removeSourceFromPack(pack, '../../..')                 // un id hostil no sale de sources/
    expect(existsSync(pack)).toBe(true)
  })

  it('el troceado de un documento ya guardado se puede rehacer igual', async () => {
    const pack = makePack()
    const { meta, result } = await importSourceIntoPack(pack, { type: 'file', path: tmp.write('n.md', '# Tema\n\n' + LOREM + '\n\n## Sub\n\n' + LOREM) })
    const pages = loadSourcePages(pack, meta.id)
    expect(chunkDocument({ pages: pages?.pages ?? [] }, meta.id)).toEqual(result.chunks)
  })
})
