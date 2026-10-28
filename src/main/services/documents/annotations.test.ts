// Subrayados y notas: ida y vuelta en disco, lectura tolerante (formato de la app Swift) y cerrojo.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeAnnotation } from '@shared/documents'
import { DocumentAnnotationStore, decodeAnnotationFile, makeAnnotation } from './annotations'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aula-annot-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('DocumentAnnotationStore', () => {
  it('guarda, sustituye y borra marcas (ida y vuelta)', () => {
    const file = join(dir, 'annotations', 'apuntes.json')
    const store = new DocumentAnnotationStore(file, 'Apuntes', 'curso/apuntes')
    expect(store.load()).toEqual([])
    const a = makeAnnotation({ page: 3, text: 'La derivada es una pendiente', rects: [[72, 600.5, 210, 12]], color: 'green' })
    const b = makeAnnotation({ page: 1, text: 'Definición', kind: 'underline', note: 'Repasar' })
    store.upsert(a)
    const all = store.upsert(b)
    // ordenadas por página
    expect(all.map((x) => x.page)).toEqual([1, 3])
    const again = new DocumentAnnotationStore(file, 'Apuntes', 'curso/apuntes').load()
    expect(again).toEqual(all)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    expect(raw).toMatchObject({ version: 1, title: 'Apuntes', key: 'curso/apuntes' })
    expect(raw.items[0].rects ?? raw.items[1].rects).toBeDefined()
    // sustituir conserva la fecha de creación
    const edited = store.upsert({ ...a, note: 'Ojo con el signo', color: 'pink' })
    const got = edited.find((x) => x.id === a.id)!
    expect(got.note).toBe('Ojo con el signo')
    expect(got.color).toBe('pink')
    expect(got.created).toBe(a.created)
    expect(store.remove(a.id).map((x) => x.id)).toEqual([b.id])
    // sin marcas, el archivo desaparece
    store.remove(b.id)
    expect(existsSync(file)).toBe(false)
  })

  it('lee el formato de la app Swift y salta las marcas dañadas', () => {
    const file = join(dir, 'a.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify({
      version: 1, title: 'Libro', key: 'p/s',
      items: [
        { id: 'k1', page: 2, kind: 'highlight', color: 'yellow', rects: [[10, 20, 30, 8], [1, 2, 3]], text: 'Hola', author: 'student', created: '2026-01-02T10:00:00Z', updated: '2026-01-02T10:00:00Z' },
        { id: 'k2', page: 0, kind: 'comentario', color: 'rosa', rects: 'no', text: 42, author: 'aula' },
        'basura',
        null
      ]
    }))
    const items = new DocumentAnnotationStore(file, 'Libro', 'p/s').load()
    expect(items).toHaveLength(2)
    const k1 = items.find((x) => x.id === 'k1')!
    expect(k1.rects).toEqual([[10, 20, 30, 8]])
    const k2 = items.find((x) => x.id === 'k2')!
    expect(k2).toMatchObject({ page: 1, kind: 'note', color: 'pink', rects: [], text: '', author: 'aula' })
  })

  it('un archivo ilegible no rompe nada', () => {
    const file = join(dir, 'roto.json')
    writeFileSync(file, '{ no es json')
    expect(new DocumentAnnotationStore(file, 'x', 'x').load()).toEqual([])
    expect(decodeAnnotationFile([1, 2]).items).toEqual([])
  })

  it('acota textos y páginas como Swift', () => {
    const a = decodeAnnotation({ page: 10_000_000, text: 'x'.repeat(5000), note: 'n'.repeat(30_000) }, () => 'id')!
    expect(a.page).toBe(100_000)
    expect(a.text.length).toBe(2000)
    expect(a.note?.length).toBe(20_000)
    expect(decodeAnnotation('nada', () => 'id')).toBeUndefined()
  })
})
