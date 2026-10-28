// La biblioteca de documentos y la validación de rutas: nada de lo que llegue de la interfaz sale de la carpeta de datos.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPDF } from '../ingest/testing/pdf'
import { setDataRoot } from '../paths'
import { getLibrary } from '../store'
import { DocumentAnnotationStore, makeAnnotation } from './annotations'
import { importFiles, listLibrary, removeDocument, searchLibrary, touchRecent } from './library'
import { locate } from './locate'
import { findInDocument, openDocument } from './service'

const COURSE = 'exam-2-math112'
let home: string
let files: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'aula-docs-lib-'))
  files = mkdtempSync(join(tmpdir(), 'aula-docs-files-'))
  cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
  setDataRoot(home)
})
afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(files, { recursive: true, force: true })
})

describe('Biblioteca', () => {
  it('lista los materiales de cada curso con su curso', () => {
    const lib = listLibrary()
    const course = lib.items.filter((i) => i.courseId === COURSE)
    expect(course.map((i) => i.title)).toContain('Unit 3 lecture notes')
    expect(course.every((i) => i.origin === 'source' && i.mode === 'text')).toBe(true)
    expect(lib.courses.map((c) => c.id)).toContain(COURSE)
  })

  it('abre un material (texto por páginas), lo apunta en recientes y busca dentro', async () => {
    const ref = { kind: 'source' as const, packId: COURSE, sourceId: 'unit-3-notes' }
    const view = await openDocument(ref)
    expect(view.pages.length).toBeGreaterThan(0)
    expect(view.entry.courseTitle).toBe('Exam #2 · MATH 101')
    expect(view.language).toBe('en')
    touchRecent(ref, 3)
    const again = listLibrary().items.find((i) => i.key === view.entry.key)!
    expect(again.opened).toBeTruthy()
    expect(again.lastPage).toBe(3)
    const hits = await findInDocument(ref, 'COSINE')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('importa un PDF y un Markdown a Documentos, los busca y los quita', async () => {
    const pdf = join(files, 'Apuntes de trigonometría.pdf')
    writeFileSync(pdf, buildPDF({ pages: [
      { texts: [{ text: 'Unit circle and the sine function', x: 72, y: 700, size: 20, bold: true }, { text: 'The sine of an angle is the y coordinate on the unit circle.', x: 72, y: 660 }] },
      { texts: [{ text: 'Important: the period of sine is two pi radians.', x: 72, y: 700 }] }
    ] }))
    const md = join(files, 'resumen.md')
    writeFileSync(md, '# Resumen\n\nEl coseno es la coordenada x del círculo unitario.')
    const out = await importFiles([pdf, md, join(files, 'no-existe.pdf')])
    expect(out.imported.map((e) => e.mode)).toEqual(['pdf', 'text'])
    expect(out.failed.map((f) => f.name)).toEqual(['no-existe.pdf'])
    const pdfEntry = out.imported[0]
    expect(pdfEntry.fileUrl).toMatch(/^aula-asset:\/\/doc\/sources\//)
    expect(pdfEntry.pages).toBe(2)
    // otra vez el mismo archivo: no se repite
    const again = await importFiles([pdf])
    expect(again.imported[0].key).toBe(pdfEntry.key)
    expect(listLibrary().items.filter((i) => i.origin === 'import')).toHaveLength(2)
    const view = await openDocument(pdfEntry.ref)
    expect(view.pages[1].text).toContain('period of sine')
    // las marcas de un archivo suelto van en <datos>/Documents/annotations/<clave>.json
    const doc = locate(pdfEntry.ref)
    expect(doc.annotationsFile.startsWith(join(home, 'Documents', 'annotations'))).toBe(true)
    new DocumentAnnotationStore(doc.annotationsFile, doc.title, doc.annotationsKey).upsert(makeAnnotation({ page: 2, text: 'period of sine' }))
    expect(listLibrary().items.find((i) => i.key === pdfEntry.key)?.marks).toBe(1)
    const hits = await searchLibrary('period sine')
    expect(hits.some((h) => h.key === pdfEntry.key && h.page === 1 && h.snippet.includes('**period**'))).toBe(true)
    removeDocument(pdfEntry.ref)
    expect(existsSync(doc.filePath!)).toBe(false)
    expect(existsSync(doc.annotationsFile)).toBe(false)
    expect(listLibrary().items.filter((i) => i.origin === 'import')).toHaveLength(1)
  })

  it('no deja quitar los materiales de un curso desde aquí', () => {
    expect(() => removeDocument({ kind: 'source', packId: COURSE, sourceId: 'unit-3-notes' })).toThrow()
  })
})

describe('Rutas seguras', () => {
  it('rechaza ids que salen de la carpeta', () => {
    expect(() => locate({ kind: 'source', packId: '../..', sourceId: 'x' })).toThrow()
    expect(() => locate({ kind: 'source', packId: COURSE, sourceId: '../../pack.json' })).toThrow()
    expect(() => locate({ kind: 'import', docId: '..' })).toThrow()
    expect(() => locate({ kind: 'import', docId: '../Packs' })).toThrow()
    expect(() => locate({ kind: 'saved', packId: COURSE, savedId: 'nada' })).toThrow()
  })

  it('un material con un nombre de archivo que sale de su carpeta no da archivo', () => {
    const store = getLibrary().openPack(COURSE)!
    const secret = join(home, 'secreto.pdf')
    writeFileSync(secret, '%PDF-1.4 secreto')
    store.updatePack((p) => {
      const s = p.sources.find((x) => x.id === 'unit-3-notes')!
      s.filename = '../../../secreto.pdf'
    })
    const doc = locate({ kind: 'source', packId: COURSE, sourceId: 'unit-3-notes' })
    expect(doc.filePath).toBeUndefined()
    expect(doc.fileUrl).toBeUndefined()
    expect(doc.mode).toBe('text')
  })
})

describe('Herramientas de documentos para la IA', () => {
  it('lista, lee por páginas, busca y resume', async () => {
    const { documentTools } = await import('./tools')
    const [list, read, summarize] = documentTools()
    const ctx = { signal: new AbortController().signal, callId: 'c' }
    const listed = JSON.parse(String(await list.run({}, ctx)))
    const notes = listed.documents.find((d: { title: string }) => d.title === 'Unit 3 lecture notes')
    expect(notes.id).toBe('source:exam-2-math112:unit-3-notes')
    const page = JSON.parse(String(await read.run({ document: notes.id, pages: '2' }, ctx)))
    expect(page.text.startsWith('[p. 2]')).toBe(true)
    const found = JSON.parse(String(await read.run({ document: 'unit 3 lecture notes', query: 'cosine' }, ctx)))
    expect(found.hits.length).toBeGreaterThan(0)
    const sum = JSON.parse(String(await summarize.run({ document: notes.id }, ctx)))
    expect(sum.digest).toContain('Key sentences by page')
    expect(JSON.parse(String(await read.run({ document: 'nada' }, ctx))).ok).toBe(false)
  })
})
