import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceDocument } from '@shared/ingest'
import { chunkDocument, chunkID, sentences } from './chunker'
import { documentFromText } from './pipeline'
import { charCount } from './text/unicode'

const doc = (pages: string[], headings?: Array<string | undefined>): Pick<SourceDocument, 'pages'> => ({
  pages: pages.map((text, i) => ({ number: i + 1, text, usedOCR: false, hasFigures: false, ...(headings?.[i] ? { heading: headings[i] } : {}) }))
})
const paragraph = (n: number, count = 3): string =>
  Array.from({ length: count }, (_, k) => `Esta es la frase ${k + 1} del párrafo número ${n} y habla de triángulos, ángulos y funciones.`).join(' ')
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const normalized = (s: string): string => s.split(/\s+/).filter(Boolean).join(' ')

describe('Chunker: casos límite', () => {
  it('documentos vacíos', () => {
    expect(chunkDocument(doc([]), 's')).toEqual([])
    expect(chunkDocument(doc(['']), 's')).toEqual([])
    expect(chunkDocument(doc(['   \n\n  \n', '\n']), 's')).toEqual([])
  })

  it('un documento corto', () => {
    const chunks = chunkDocument(doc(['Hola mundo.']), 'fuente-1')
    expect(chunks).toEqual([{ id: chunkID('fuente-1', 0, 'Hola mundo.'), sourceID: 'fuente-1', ordinal: 0, page: 1, text: 'Hola mundo.' }])
    // El id es el de Swift: 16 hex de sha256("<fuente>\u001F<ordinal>\u001F<texto>")
    expect(chunks[0].id).toBe(createHash('sha256').update('fuente-1\u001F0\u001FHola mundo.').digest('hex').slice(0, 16))
    expect(chunks[0].id).toHaveLength(16)
    expect(chunkDocument(doc(['x']), 's').map((c) => c.text)).toEqual(['x'])
  })
})

describe('Chunker: cobertura y tamaños', () => {
  it('cubre todos los párrafos', () => {
    const paragraphs = range(1, 60).map((n) => paragraph(n))
    const chunks = chunkDocument(doc([paragraphs.join('\n\n')]), 's', { target: 500, maxChars: 800, overlap: 60 })
    expect(chunks.length).toBeGreaterThan(10)
    for (const p of paragraphs) expect(chunks.some((c) => normalized(c.text).includes(normalized(p)))).toBe(true)
  })

  it('respeta el máximo y nada queda vacío', () => {
    let seed = 7
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const paragraphs = range(1, 80).map((n) => paragraph(n, 1 + Math.floor(random() * 9)))
    for (const [target, maxChars, overlap] of [[1400, 2200, 120], [300, 450, 40], [120, 200, 20], [60, 90, 10]]) {
      const chunks = chunkDocument(doc([paragraphs.join('\n\n')]), 's', { target, maxChars, overlap })
      expect(chunks.length).toBeGreaterThan(0)
      for (const c of chunks) {
        expect(c.text.trim()).not.toBe('')
        expect(charCount(c.text)).toBeLessThanOrEqual(maxChars)
        expect(c.text).toBe(c.text.trim())
      }
    }
  })

  it('los trozos se acercan al tamaño buscado', () => {
    const chunks = chunkDocument(doc([range(1, 100).map((n) => paragraph(n, 2)).join('\n\n')]), 's')
    const body = chunks.slice(0, -1)
    expect(body.length).toBeGreaterThan(3)
    for (const c of body) { expect(c.text.length).toBeGreaterThanOrEqual(700); expect(c.text.length).toBeLessThanOrEqual(2200) }
    const avg = body.reduce((a, c) => a + c.text.length, 0) / body.length
    expect(avg).toBeGreaterThanOrEqual(1000)
    expect(avg).toBeLessThanOrEqual(1700)
  })

  it('ordinales seguidos, ids únicos, estable y determinista', () => {
    const chunks = chunkDocument(doc([range(1, 50).map((n) => paragraph(n)).join('\n\n')]), 's', { target: 400, maxChars: 700 })
    expect(chunks.map((c) => c.ordinal)).toEqual(range(0, chunks.length - 1))
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length)
    const d = doc([range(1, 40).map((n) => paragraph(n)).join('\n\n')])
    const a = chunkDocument(d, 's'), b = chunkDocument(d, 's'), other = chunkDocument(d, 'otra')
    expect(a).toEqual(b)
    expect(a.map((c) => c.text)).toEqual(other.map((c) => c.text))
    expect(a.every((c, i) => c.id !== other[i].id)).toBe(true)
  })

  it('parámetros saneados', () => {
    const d = doc([range(1, 10).map((n) => paragraph(n)).join('\n\n')])
    for (const [target, maxChars, overlap] of [[0, 0, 0], [-5, -5, -5], [10, 5, 100], [100, 100, 100], [1, 1, 1], [NaN, Infinity, -Infinity]]) {
      const chunks = chunkDocument(d, 's', { target, maxChars, overlap })
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.every((c) => c.text.length > 0)).toBe(true)
    }
  })
})

describe('Chunker: solapamiento', () => {
  it('repite el final del trozo anterior, empezando en una frase', () => {
    const ss = range(1, 120).map((n) => `Frase numerada ${n} que forma parte de un único párrafo largo sin saltos.`)
    const chunks = chunkDocument(doc([ss.join(' ')]), 's', { target: 500, maxChars: 800, overlap: 120 })
    expect(chunks.length).toBeGreaterThan(4)
    for (let i = 1; i < chunks.length; i++) {
      const head = chunks[i].text.split('\n\n').filter(Boolean)[0] ?? ''
      const shared = head.split(' ').slice(0, 4).join(' ')
      expect(chunks[i - 1].text).toContain(shared)
      expect(chunks[i].text.startsWith('Frase')).toBe(true)
    }
  })

  it('no hay solapamiento entre secciones', () => {
    const text = '# Uno\n\n' + range(1, 30).map((n) => paragraph(n)).join('\n\n') + '\n\n# Dos\n\n' + range(31, 60).map((n) => paragraph(n)).join('\n\n')
    const start = chunkDocument(doc([text]), 's', { target: 500, maxChars: 800, overlap: 100 }).find((c) => c.text.startsWith('# Dos'))
    expect(start?.heading).toBe('Dos')
  })

  it('se puede desactivar', () => {
    const chunks = chunkDocument(doc([range(1, 40).map((n) => paragraph(n)).join('\n\n')]), 's', { target: 500, maxChars: 800, overlap: 0 })
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].text.endsWith(chunks[i].text.slice(0, 60))).toBe(false)
      expect(chunks[i].text.startsWith('Esta es la frase')).toBe(true)
    }
  })
})

describe('Chunker: títulos', () => {
  it('propaga los títulos', () => {
    const text = `# Capítulo 1\n\n${range(1, 6).map((n) => paragraph(n)).join('\n\n')}\n\n## Funciones seno y coseno\n\n${range(7, 25).map((n) => paragraph(n)).join('\n\n')}\n\n## Identidades\n\n${range(26, 30).map((n) => paragraph(n)).join('\n\n')}`
    const chunks = chunkDocument(doc([text]), 's', { target: 600, maxChars: 900, overlap: 50 })
    expect(chunks[0].heading).toBe('Capítulo 1')
    const mid = chunks.filter((c) => c.text.includes('número 15'))
    expect(mid.length).toBeGreaterThan(0)
    expect(mid.every((c) => c.heading === 'Funciones seno y coseno')).toBe(true)
    expect(chunks.filter((c) => c.heading === 'Funciones seno y coseno').length).toBeGreaterThan(2)
    expect(chunks[chunks.length - 1].heading).toBe('Identidades')
    expect(chunks.some((c) => c.text.includes('## Identidades'))).toBe(true)
  })

  it('títulos en mayúsculas, numerados y con palabra clave', () => {
    const text = `INTRODUCCIÓN\n\n${paragraph(1)}\n\n3.2 Círculo unidad\n\n${paragraph(2)}\n\nCapítulo 4: Límites\n\n${paragraph(3)}\n\nUn párrafo normal que menciona el capítulo 4. Y sigue con más texto de relleno para completar.`
    const headings = chunkDocument(doc([text]), 's', { target: 130, maxChars: 400, overlap: 0 }).map((c) => c.heading).filter(Boolean)
    expect(headings).toContain('INTRODUCCIÓN')
    expect(headings).toContain('3.2 Círculo unidad')
    expect(headings).toContain('Capítulo 4: Límites')
    expect(headings.some((h) => h?.startsWith('Un párrafo normal'))).toBe(false)
    const nasa = chunkDocument(doc(['La agencia NASA\nPROBÓ\nun cohete y aterrizó con éxito en el mar durante la mañana.\n\nSiguiente párrafo.']), 's')
    expect(nasa).toHaveLength(1)
    expect(nasa[0].heading).toBeUndefined()
  })

  it('títulos declarados por la página', () => {
    const slides = chunkDocument(doc(['Contenido de la primera diapositiva sin línea de título.', 'Segunda diapositiva con su texto.'], ['Funciones', 'Límites']), 's', { target: 40, maxChars: 80, overlap: 0 })
    expect(slides[0].heading).toBe('Funciones')
    const d = doc(['Texto de la introducción, sin ninguna línea de título dentro de la página.', 'Texto de los métodos, también sin línea de título en el cuerpo de la página.', 'Texto de los resultados con su propia página y su propio título declarado.'], ['Introducción', 'Métodos', 'Resultados'])
    const chunks = chunkDocument(d, 's', { target: 40, maxChars: 120, overlap: 0 })
    expect(chunks.map((c) => c.heading)).toEqual(['Introducción', 'Métodos', 'Resultados'])
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3])
    expect(chunks.some((c) => c.text.includes('Introducción\n'))).toBe(false)
    const same = chunkDocument(doc(['# Funciones\n\nTexto de la primera sección con contenido suficiente para existir.', 'Continúa el texto de la misma sección en la segunda página del documento.'], ['Funciones', 'Funciones']), 's')
    expect(same).toHaveLength(1)
    expect(same[0].heading).toBe('Funciones')
    expect(same[0].text.split('Funciones')).toHaveLength(2)
  })

  it('un título nunca queda solo al final de un trozo', () => {
    const parts: string[] = []
    for (const i of range(1, 40)) parts.push(`## Sección ${i}`, paragraph(i, 2))
    const chunks = chunkDocument(doc([parts.join('\n\n')]), 's', { target: 500, maxChars: 700, overlap: 0 })
    for (const c of chunks.slice(0, -1)) expect((c.text.split('\n').pop() ?? '').startsWith('## ')).toBe(false)
  })
})

describe('Chunker: páginas', () => {
  it('rangos de páginas', () => {
    const pages = range(1, 6).map((n) => [1, 2, 3].map((k) => paragraph(n * 10 + k)).join('\n\n'))
    const chunks = chunkDocument(doc(pages), 's', { target: 700, maxChars: 1100, overlap: 0 })
    expect(chunks[0].page).toBe(1)
    const last = chunks[chunks.length - 1]
    expect(last.pageEnd ?? last.page).toBe(6)
    for (const c of chunks) { expect(c.page).toBeDefined(); if (c.pageEnd !== undefined) expect(c.pageEnd).toBeGreaterThan(c.page as number) }
    const p4 = chunks.find((c) => c.text.includes('número 41'))
    expect(p4).toBeDefined()
    expect((p4?.page ?? 0) <= 4 && 4 <= (p4?.pageEnd ?? p4?.page ?? 0)).toBe(true)
    expect(chunks.some((c) => c.pageEnd !== undefined)).toBe(true)
    expect(chunks.some((c) => c.pageEnd === undefined)).toBe(true)
    const values = chunks.map((c) => c.page ?? 0)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('un trozo que abarca varias páginas', () => {
    const chunks = chunkDocument(doc(['Primera página corta.', 'Segunda página corta.', 'Tercera.']), 's')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ page: 1, pageEnd: 3, text: 'Primera página corta.\n\nSegunda página corta.\n\nTercera.' })
  })

  it('las páginas vacías se saltan sin perder los números', () => {
    const uno = 'Texto de la primera página con contenido suficiente.', cuatro = 'Texto de la cuarta página con contenido suficiente.'
    const chunks = chunkDocument(doc([uno, '', '   ', cuatro]), 's', { target: 40, maxChars: 60, overlap: 0 })
    expect(chunks.map((c) => c.page)).toEqual([1, 4])
    expect(chunks.map((c) => c.text)).toEqual([uno, cuatro])
  })
})

describe('Chunker: listas, tablas y frases', () => {
  it('listas y tablas cortas quedan enteras; las largas se parten entre elementos', () => {
    const list = range(1, 8).map((n) => `- elemento número ${n} de la lista`).join('\n')
    const table = range(1, 6).map((n) => `fila ${n} | valor ${n * 3} | dato`).join('\n')
    const chunks = chunkDocument(doc([`Intro del tema.\n\n${list}\n\nTexto intermedio.\n\n${table}\n\nFin.`]), 's')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain(list)
    expect(chunks[0].text).toContain(table)
    const items = range(1, 120).map((n) => `- elemento número ${n} con una descripción algo más larga para ocupar espacio`)
    const long = chunkDocument(doc([items.join('\n')]), 's', { target: 500, maxChars: 800, overlap: 0 })
    expect(long.length).toBeGreaterThan(5)
    const seen = long.flatMap((c) => c.text.split('\n'))
    expect(seen.every((l) => l.startsWith('- elemento'))).toBe(true)
    expect(seen).toEqual(items)
  })

  it('los párrafos largos se parten entre frases', () => {
    const ss = range(1, 90).map((n) => `La frase ${n} cuenta algo importante sobre el círculo unidad.`)
    const chunks = chunkDocument(doc([ss.join(' ')]), 's', { target: 400, maxChars: 600, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) expect(c.text.endsWith('.')).toBe(true)
    expect(normalized(chunks.map((c) => c.text).join(' '))).toBe(ss.join(' '))
  })

  it('abreviaturas y decimales no cortan frases', () => {
    expect(sentences('El Dr. García mide 3.14 metros. J. Smith vive en EE. UU. y trabaja hoy. Ver fig. 3 y p. ej. el caso 2. Fin.').map((s) => s.trim()))
      .toEqual(['El Dr. García mide 3.14 metros.', 'J. Smith vive en EE. UU. y trabaja hoy.', 'Ver fig. 3 y p. ej. el caso 2.', 'Fin.'])
    expect(sentences('¿Qué es esto? ¡Es un seno! Sí... Claro.')).toHaveLength(4)
    expect(sentences('sin punto final')).toHaveLength(1)
    expect(sentences('')).toHaveLength(0)
    expect(sentences('これは文です。次の文です。')).toHaveLength(2)
  })

  it('una palabra gigante sin espacios', () => {
    const blob = 'a'.repeat(12_000)
    const chunks = chunkDocument(doc(['Antes. ' + blob + ' Después.']), 's', { target: 500, maxChars: 800, overlap: 0 })
    expect(chunks.every((c) => c.text.length <= 800)).toBe(true)
    expect(chunks.map((c) => c.text).join('').split('a').length - 1).toBe(12_000)
    expect(chunks[0].text.startsWith('Antes.')).toBe(true)
    expect(chunks[chunks.length - 1].text.endsWith('Después.')).toBe(true)
  })

  it('texto sin ninguna línea en blanco', () => {
    const text = range(1, 300).map((n) => `Línea ${n} de un texto pegado sin ninguna línea en blanco entre medias.`).join('\n')
    const chunks = chunkDocument(doc([text]), 's', { target: 600, maxChars: 900, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every((c) => c.text.length <= 900)).toBe(true)
    expect(chunks.map((c) => c.text).join(' ').split(/\s+/).length).toBe(text.split(/\s+/).length)
  })

  it('nunca corta dentro de un carácter', () => {
    const text = range(1, 300).map((n) => `Emoji 👩‍👩‍👧‍👦 y acentos combinados éà línea ${n}. `).join('')
    const chunks = chunkDocument(doc([text]), 's', { target: 100, maxChars: 150, overlap: 10 })
    expect(chunks.length).toBeGreaterThan(0)
    for (const c of chunks) {
      expect(c.text.endsWith('‍')).toBe(false)
      expect(c.text.startsWith('́') || c.text.startsWith('̀')).toBe(false)
      expect(/[\uD800-\uDBFF]$/.test(c.text) || /^[\uDC00-\uDFFF]/.test(c.text)).toBe(false)
    }
  })
})

describe('Chunker: integración', () => {
  it('un Markdown de principio a fin', () => {
    let md = '# Guía de estudio\n\n'
    for (const i of range(1, 12)) md += `## Tema ${i}\n\n` + paragraph(i, 4) + '\n\n- punto uno\n- punto dos\n\n'
    const chunks = chunkDocument(documentFromText(md, 'Guía'), 'guia', { target: 700, maxChars: 1100, overlap: 80 })
    expect(chunks.length).toBeGreaterThan(4)
    expect(chunks[0].heading).toBe('Guía de estudio')
    expect(chunks.every((c) => c.page === 1 && c.pageEnd === undefined)).toBe(true)
    expect(chunks.some((c) => c.heading === 'Tema 7')).toBe(true)
  })

  it('un documento grande es rápido', () => {
    const page = range(1, 40).map((n) => paragraph(n)).join('\n\n')
    const t0 = performance.now()
    const chunks = chunkDocument(doc(Array(250).fill(page)), 's')
    expect(performance.now() - t0).toBeLessThan(8000)
    expect(chunks.length).toBeGreaterThan(1500)
  })
})
