import { cpSync, existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadChunks, searchIndexPath, sourceIDs } from '../ingest/packFiles'
import { tempDir, type TempDir } from '../ingest/testing/files'
import { invalidateCourseIndex, loadCourseIndex, plainSnippet, rebuildCourseIndex, searchCourse } from './course'
import { decodeIndexChunks } from './searchIndex'

const DEMO = resolve(__dirname, '../../../../tests/fixtures/demo-course/exam-2-math112')

let tmp: TempDir
let pack = ''
beforeEach(() => {
  tmp = tempDir()
  pack = join(tmp.path, 'exam-2-math112')
  cpSync(DEMO, pack, { recursive: true })
  invalidateCourseIndex()
})
afterEach(() => tmp.cleanup())

describe('Búsqueda en un curso (curso de demostración de la app Swift)', () => {
  it('lee los chunks.json de la app Swift tal cual', () => {
    expect(sourceIDs(pack)).toEqual(['unit-3-notes', 'exam-2-review', 'textbook-4-2'])
    const chunks = loadChunks(pack, 'unit-3-notes')
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toMatchObject({ id: '54fc2d8c5a9eb18e', sourceID: 'unit-3-notes', ordinal: 0, page: 1 })
  })

  it('busca con fuente, página y fragmento resaltado; guarda sources/index.json', async () => {
    const hits = await searchCourse(pack, 'unit circle cosine', { limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toMatchObject({ sourceID: expect.any(String), page: expect.any(Number) })
    expect(hits[0].sourceTitle).toBeDefined()
    expect(hits[0].snippet).toMatch(/\*\*[^*]+\*\*/)
    expect(plainSnippet(hits[0].snippet)).not.toContain('**')
    expect(existsSync(searchIndexPath(pack))).toBe(true)
    const stored = decodeIndexChunks(readFileSync(searchIndexPath(pack)))
    expect(stored).toHaveLength(7)
    const only = await searchCourse(pack, 'quadrant', { sourceIDs: ['unit-3-notes'] })
    expect(only.every((h) => h.sourceID === 'unit-3-notes')).toBe(true)
    expect(await searchCourse(pack, 'quadrant', { limit: 0 })).toEqual([])
  })

  it('el índice se reutiliza y se rehace cuando cambian los chunks.json', async () => {
    const a = loadCourseIndex(pack)
    expect(loadCourseIndex(pack)).toBe(a)
    const file = join(pack, 'sources', 'unit-3-notes', 'chunks.json')
    writeFileSync(file, JSON.stringify([{ id: 'x1', sourceID: 'unit-3-notes', ordinal: 0, page: 2, text: 'Una palabra rarísima: zarzaparrilla.' }]))
    const future = new Date(Date.now() + 5000)
    utimesSync(file, future, future)
    const hits = await searchCourse(pack, 'zarzaparrilla')
    expect(hits.map((h) => h.chunkID)).toEqual(['x1'])
    // Un índice guardado dañado se rehace solo
    invalidateCourseIndex(pack)
    writeFileSync(searchIndexPath(pack), 'basura')
    utimesSync(searchIndexPath(pack), new Date(Date.now() + 10_000), new Date(Date.now() + 10_000))
    expect((await searchCourse(pack, 'zarzaparrilla')).map((h) => h.chunkID)).toEqual(['x1'])
    expect(statSync(searchIndexPath(pack)).size).toBeGreaterThan(10)
    expect(rebuildCourseIndex(pack).count).toBe(5)
  })

  it('con vectores, fusiona con RRF; si fallan, se queda con BM25', async () => {
    const vectors = { search: async () => [{ id: 'cbefb2ee0bc3f8fd', sourceID: 'unit-3-notes', score: 0.8 }] }
    const fused = await searchCourse(pack, 'zzqqxxw', { vectors })
    expect(fused.map((h) => h.chunkID)).toEqual(['cbefb2ee0bc3f8fd'])
    expect(fused[0].page).toBe(2)
    const broken = { search: async () => { throw new Error('modelo no disponible') } }
    const lexical = await searchCourse(pack, 'quadrant', { vectors: broken })
    expect(lexical.length).toBeGreaterThan(0)
  })
})
