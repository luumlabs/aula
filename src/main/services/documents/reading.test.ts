// Leer por páginas, el resumen sin IA (frases clave y pistas de examen), extractos marcados «[p. N]» y las citas.
import { describe, expect, it } from 'vitest'
import { citedPages, parseCards, parseDocKey, parsePages, docKey, splitCitations, parseDocRef } from '@shared/documents'
import { makeDigest, digestSentences } from './digest'
import { chapterContaining, excerpt, foldSameLength, pagesFromChunks, pagesFromText, searchPages, type DocumentPages } from './pages'

function doc(pages: string[], outline: DocumentPages['outline'] = []): DocumentPages {
  return { title: 'Funciones', pages, headings: pages.map(() => undefined), outline, ocrPages: new Set() }
}

const BOOK = doc([
  'Las funciones cuadráticas tienen la forma f(x) = ax² + bx + c. Su gráfica es una parábola que abre hacia arriba si a es positivo.',
  'Importante: el vértice está en x = -b/2a. Esto entra en el examen parcial. La parábola es simétrica respecto de su eje.',
  'Se define el discriminante como Δ = b² − 4ac. Dice cuántas raíces reales tiene la ecuación cuadrática del ejemplo.',
  'Ejercicios de práctica para casa sobre parábolas, vértices y raíces de las funciones cuadráticas del capítulo.'
], [
  { title: 'Parábolas', page: 1, endPage: 2, level: 0 },
  { title: 'Discriminante', page: 3, endPage: 4, level: 0 }
])

describe('DocumentPages', () => {
  it('marca cada página en los extractos y recorta sin pasarse', () => {
    const e = excerpt(BOOK, 1, 2)
    expect(e.text).toContain('[p. 1]\n')
    expect(e.text).toContain('[p. 2]\n')
    expect(e.lastPage).toBe(2)
    expect(e.truncated).toBe(false)
    const short = excerpt(BOOK, 1, 4, 200)
    expect(short.truncated).toBe(true)
    expect(short.text.length).toBeLessThanOrEqual(200)
    expect(excerpt(BOOK, 9, 12).text).toBe('')
  })

  it('busca sin acentos ni mayúsculas y da la página', () => {
    const hits = searchPages(BOOK, 'VERTICE')
    expect(hits.map((h) => h.page)).toContain(2)
    expect(hits[0].snippet.toLowerCase()).toContain('vértice')
    // todas las palabras aunque no estén seguidas
    expect(searchPages(BOOK, 'raices discriminante').map((h) => h.page)).toEqual([3])
    expect(searchPages(BOOK, 'x')).toEqual([])
  })

  it('pliega sin cambiar la longitud', () => {
    const s = 'Árbol ÉNFASIS ñandú'
    expect(foldSameLength(s)).toHaveLength(s.length)
    expect(foldSameLength(s)).toBe('arbol enfasis nandu')
  })

  it('encuentra el capítulo de una página', () => {
    expect(chapterContaining(BOOK, 2)?.title).toBe('Parábolas')
    expect(chapterContaining(BOOK, 4)?.title).toBe('Discriminante')
  })

  it('agrupa los fragmentos por página (y aguanta páginas dañadas)', () => {
    const p = pagesFromChunks('T', [
      { id: 'a', sourceID: 's', ordinal: 0, page: 1, heading: 'Uno', text: 'Primera' },
      { id: 'b', sourceID: 's', ordinal: 1, page: 1, text: 'sigue' },
      { id: 'c', sourceID: 's', ordinal: 2, page: 3, heading: 'Tres', text: 'Tercera' },
      { id: 'd', sourceID: 's', ordinal: 3, page: -4, text: 'rota' }
    ])!
    expect(p.pages).toEqual(['Primera\n\nsigue\n\nrota', '', 'Tercera'])
    expect(p.outline.map((o) => [o.title, o.page, o.endPage])).toEqual([['Uno', 1, 2], ['Tres', 3, 3]])
    const words = pagesFromChunks('W', Array.from({ length: 5 }, (_, i) => ({ id: String(i), sourceID: 's', ordinal: i, text: 'x'.repeat(1400) })))!
    expect(words.pages.length).toBe(3)
    expect(pagesFromText('L', 'y'.repeat(7000)).pages.map((x) => x.length)).toEqual([3000, 3000, 1000])
  })
})

describe('DocumentDigest', () => {
  it('saca las frases clave por página y las pistas de examen', () => {
    const d = makeDigest(BOOK)
    expect(d.pages.map((p) => p.page)).toEqual([1, 2, 3, 4])
    const signals = d.examSignals.map((s) => s.page)
    expect(signals).toContain(2)          // «Importante… entra en el examen»
    expect(signals).toContain(3)          // «Se define…»
    expect(d.keywords).toContain('funciones')
    // por página, en el orden en que aparecen
    for (const p of d.pages) expect(p.lines.length).toBeLessThanOrEqual(2)
    expect(makeDigest(BOOK, [3, 3]).pages.map((p) => p.page)).toEqual([3])
    expect(makeDigest(BOOK, [7, 9]).pages).toEqual([])
  })

  it('parte en frases también en chino y japonés', () => {
    expect(digestSentences('二次函数的图像是抛物线。顶点公式在考试中很重要！')).toHaveLength(2)
  })
})

describe('Citas, tarjetas y claves', () => {
  it('lee las páginas citadas dentro del documento', () => {
    expect(citedPages('Ver (p. 12) y pp. 3–4, también p. 7, 9 y [p. 50].', 20)).toEqual([3, 4, 7, 9, 12])
    expect(splitCitations('El vértice (p. 2) importa.', 4)).toEqual([{ text: 'El vértice ' }, { text: '(p. 2)', page: 2 }, { text: ' importa.' }])
  })

  it('lee tarjetas aunque el JSON venga sucio', () => {
    const cards = parseCards('Aquí tienes:\n```json\n[{"front": "¿Qué es $\\frac{a}{b}$?", "back": "Una fracción"}, {"question": "Δ", "answer": "b²−4ac",}]\n```')
    expect(cards).toHaveLength(2)
    expect(cards[0].front).toContain('\\frac')
    expect(cards[1]).toEqual({ front: 'Δ', back: 'b²−4ac' })
    expect(parseCards('sin tarjetas')).toEqual([])
  })

  it('entiende rangos de páginas acotados', () => {
    expect(parsePages('3', 10)).toEqual([3])
    expect(parsePages('3-5, 9', 10)).toEqual([3, 4, 5, 9])
    expect(parsePages('8–', 10)).toEqual([8, 9, 10])
    expect(parsePages('9223372036854775800-', 10)).toBeUndefined()
    expect(parsePages('a-b', 10)).toBeUndefined()
  })

  it('las claves de documento van y vuelven (con página)', () => {
    const ref = { kind: 'source' as const, packId: 'math', sourceId: 'notas:raras/1' }
    const key = docKey(ref)
    expect(parseDocKey(key)?.ref).toEqual(ref)
    expect(parseDocKey(`${key}@12`)).toEqual({ ref, page: 12 })
    expect(parseDocKey('import:')).toBeUndefined()
    expect(parseDocKey('otra:cosa')).toBeUndefined()
    expect(parseDocRef({ kind: 'import', docId: '' })).toBeUndefined()
    expect(parseDocRef({ kind: 'saved', packId: 'a', savedId: 'b' })).toEqual({ kind: 'saved', packId: 'a', savedId: 'b' })
  })
})
