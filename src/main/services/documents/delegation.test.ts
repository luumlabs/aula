// A2-P1-3: abrir un documento sin páginas guardadas (un material de un curso importado) y leer un PDF de la web (`fetch_url`,
// guardar una página) ya no leen en el proceso principal: van al lector aparte (`setIngestRunner`), como el resto de materiales.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IngestInput, SourceDocument } from '@shared/ingest'
import { setIngestRunner, type IngestOptions } from '../ingest'
import { LiveWebAccess } from '../tools/web'
import { clearPagesCache, loadPages } from './reading'
import type { LocatedDocument } from './locate'

const calls: Array<{ input: IngestInput; options: Partial<IngestOptions> }> = []
const fakeRunner = {
  read: async (input: IngestInput, options: Partial<IngestOptions>): Promise<SourceDocument> => {
    calls.push({ input, options })
    return { title: 'Leído aparte', kind: 'pdf', pages: [{ number: 1, text: 'texto del lector aparte', usedOCR: false, hasFigures: false }], metadata: {}, warnings: [] }
  }
}
let dir = ''
afterEach(() => { setIngestRunner(null); calls.length = 0; clearPagesCache(); if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('A2-P1-3 · lecturas al lector aparte', () => {
  it('abrir un documento sin páginas guardadas: lo lee el lector aparte, sin OCR', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aula-doc-'))
    const file = join(dir, 'notes.pdf')
    writeFileSync(file, '%PDF-1.4 hostil')
    setIngestRunner(fakeRunner)
    const doc = { ref: { kind: 'file' }, key: 'k1', title: 'Notas', kind: 'pdf', mode: 'text', filePath: file } as unknown as LocatedDocument
    const pages = await loadPages(doc)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toEqual({ type: 'file', path: file })
    expect(calls[0].options.ocr).toBe(false)
    expect(pages.pages[0]).toContain('texto del lector aparte')
  })

  it('fetch_url de un PDF: lo lee el lector aparte (60 páginas como mucho)', async () => {
    setIngestRunner(fakeRunner)
    const web = new LiveWebAccess({
      validate: async (u) => new URL(u),
      fetch: async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
    const text = await web.fetch('https://example.org/bomb.pdf', 5000)
    expect(calls).toHaveLength(1)
    expect(calls[0].input.type).toBe('file')
    expect(calls[0].options).toMatchObject({ ocr: false, maxPages: 60 })
    expect(text).toContain('texto del lector aparte')
  })
})
