// Búsqueda de la paleta (⌘K) en toda la biblioteca, con el curso de ejemplo real (resources/demo-course).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setDataRoot } from '../paths'
import { getLibrary } from '../store'
import { invalidateCourseIndex } from './course'
import { LibrarySearch, lessonChunks, plainContent } from './library'

const DEMO = resolve(__dirname, '../../../../resources/demo-course/Packs/exam-2-math112')
let root: string
/** Sin prisa: las pruebas que no miden el presupuesto indexan todo en la misma consulta. */
const ALL = { budgetMs: 60_000 }

function addCourse(id: string, title?: string): void {
  const dir = join(root, 'Packs', id)
  cpSync(DEMO, dir, { recursive: true })
  if (title) {
    const p = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as { id: string; title: string }
    p.id = id
    p.title = title
    writeFileSync(join(dir, 'pack.json'), JSON.stringify(p))
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-library-search-'))
  setDataRoot(root)
  invalidateCourseIndex()
  addCourse('exam-2-math112')
})
afterEach(() => {
  invalidateCourseIndex()
  rmSync(root, { recursive: true, force: true })
})

describe('texto del contenido', () => {
  it('sin Markdown y con el LaTeX común como símbolos', () => {
    expect(plainContent('# Título\n\nCon $\\dfrac{\\pi}{3}$ y **negrita**, ver [la guía](https://x.y/z) `code`')).toBe('Título Con π/3 y negrita, ver la guía code')
    expect(plainContent('$225^\\circ$, $v = r\\omega$, $180^{\\circ} = \\pi\\text{ rad}$')).toBe('225°, v = rω, 180° = π rad')
  })
  it('la lección en trozos con el título y los objetivos delante', () => {
    const long = 'palabra '.repeat(400)
    const chunks = lessonChunks({ title: 'Derivadas', summary: 'La pendiente', objectives: ['Derivar'], lesson: [{ id: 'a', type: 'text', md: long }, { id: 'b', type: 'math', tex: 'f\'(x)' }] })
    expect(chunks[0].startsWith('Derivadas. La pendiente. Derivar')).toBe(true)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((c) => c.length <= 1400)).toBe(true)
  })
})

describe('buscar en la biblioteca', () => {
  it('encuentra el término del glosario, la lección, la fórmula y el material con su página', () => {
    const s = new LibrarySearch()
    const r = s.query('reference angle', ALL)
    expect(r.pending).toBe(0)
    const kinds = new Set(r.hits.map((h) => h.kind))
    for (const k of ['glossary', 'lesson', 'material', 'exercise'] as const) expect(kinds.has(k)).toBe(true)
    expect(r.hits[0]).toMatchObject({ kind: 'glossary', title: 'Reference angle', courseID: 'exam-2-math112', courseTitle: 'Exam #2 · MATH 101' })
    expect(r.hits.find((h) => h.kind === 'lesson')).toMatchObject({ skillID: 'reference-angles', title: 'Reference angles and degrees-minutes' })
    expect(r.hits.find((h) => h.kind === 'material')).toMatchObject({ sourceID: 'unit-3-notes', page: 3, title: 'Unit 3 lecture notes' })
    expect(r.hits.slice(0, 5).every((h) => h.snippet.includes('**'))).toBe(true)
    expect(new Set(r.hits.map((h) => h.id)).size).toBe(r.hits.length)
    const unit = s.query('unit circle', ALL).hits
    expect(unit.some((h) => h.kind === 'formula' && h.title === 'Unit circle')).toBe(true)
    expect(unit.some((h) => h.kind === 'material' && h.sourceID === 'textbook-4-2')).toBe(true)
  })
  it('los ejercicios llevan a su tema; una lección sale una sola vez', () => {
    const r = new LibrarySearch().query('sprinkler', ALL)
    expect(r.hits[0]).toMatchObject({ kind: 'exercise', skillID: 'arc-length-sector-area', id: 'exam-2-math112/exercise/arc-length-sector-area/als-e4' })
    const radians = new LibrarySearch().query('radians', ALL).hits.filter((h) => h.kind === 'lesson')
    expect(new Set(radians.map((h) => h.skillID)).size).toBe(radians.length)
  })
  it('consultas vacías o de una letra no buscan; respeta el límite', () => {
    const s = new LibrarySearch()
    expect(s.query('').hits).toEqual([])
    expect(s.query(' a ').hits).toEqual([])
    expect(s.query('angle', { ...ALL, limit: 3 }).hits).toHaveLength(3)
    expect(s.query('zanahoria').hits).toEqual([])
  })
  it('se pone al día cuando cambia el curso (y olvida los borrados)', async () => {
    const s = new LibrarySearch()
    expect(s.query('zanahoria cuántica', ALL).hits).toEqual([])
    const store = getLibrary().openPack('exam-2-math112')!
    const pack = store.loadPack()
    pack.glossary.push({ term: 'Zanahoria cuántica', definition: 'Una hortaliza que está y no está.', aliases: [] })
    await new Promise((r) => setTimeout(r, 15))
    store.savePack(pack)
    expect(s.query('zanahoria', ALL).hits[0]).toMatchObject({ kind: 'glossary', title: 'Zanahoria cuántica' })
    rmSync(join(root, 'Packs', 'exam-2-math112'), { recursive: true, force: true })
    expect(s.query('zanahoria').hits).toEqual([])
  })
  it('una biblioteca grande: con poco tiempo devuelve lo que tiene, termina en segundo plano y luego va rápido', async () => {
    for (let i = 0; i < 40; i++) addCourse(`copia-${i}`, `Trigonometría ${i}`)
    const s = new LibrarySearch()
    const first = s.query('reference angle', { budgetMs: 0 })
    expect(first.pending).toBeGreaterThan(0)
    expect(first.hits.length).toBeGreaterThan(0)
    await s.warm()
    const t0 = performance.now()
    const all = s.query('reference angle', { limit: 50 })
    const ms = performance.now() - t0
    expect(all.pending).toBe(0)
    expect(new Set(all.hits.map((h) => h.courseID)).size).toBeGreaterThan(5)
    expect(all.hits).toHaveLength(50)
    // 41 cursos ya indexados: más rápido que indexarlos de cero (comparado en la misma máquina y con la misma carga, no con
    // milisegundos fijos: con la máquina ocupada una cifra absoluta fallaba sin motivo, J4-6)
    const cold = new LibrarySearch()
    const c0 = performance.now()
    const coldAll = cold.query('reference angle', { limit: 50, budgetMs: 1e9 })
    const coldMs = performance.now() - c0
    expect(coldAll.pending).toBe(0)
    expect(ms).toBeLessThan(coldMs)
  })
})
