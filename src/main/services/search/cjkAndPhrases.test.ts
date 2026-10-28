// MTH-03, MTH-11, MTH-12, MJ-ING-001 y los alias de superíndices (port de las pruebas Swift de búsqueda CJK y frases).
import { describe, expect, it } from 'vitest'
import type { SourceChunk } from '@shared/ingest'
import { isAllCaps, parseHeading } from '../ingest/text/headingDetector'
import { SearchIndex } from './searchIndex'
import { terms, withoutScripts, withoutSuperscripts } from './text'

const chunk = (id: string, text: string, heading?: string): SourceChunk => ({ id, sourceID: 's', ordinal: 0, page: 1, text, ...(heading ? { heading } : {}) })

describe('Frases y preguntas CJK', () => {
  const index = new SearchIndex([
    chunk('zh1', '光合作用是植物利用光能把二氧化碳和水转化为葡萄糖的过程。'), chunk('zh2', '细胞呼吸释放能量。'), chunk('ja1', '光合成は植物が光エネルギーを使って糖を作る過程です。'),
    chunk('ko1', '광합성은 식물이 빛 에너지를 이용하는 과정이다.'), chunk('en1', 'Photosynthesis converts light energy. The cell membrane controls transport.'),
    chunk('en2', 'Membrane proteins and their role in the cell.'), chunk('en3', 'The cell membrane has a key function: it decides what enters the cell.')
  ])
  const ids = (q: string): string[] => index.search(q, { limit: 20 }).map((h) => h.chunk.id)

  it('la frase filtra; las demás palabras solo puntúan', () => {
    expect(new Set(ids('"cell membrane"'))).toEqual(new Set(['en1', 'en3']))
    expect(ids('"cell membrane" function')).toEqual(['en3', 'en1'])
    expect(new Set(ids('"cell membrane" role'))).toEqual(new Set(['en1', 'en3']))
    expect(ids('"cell membrane" transport')[0]).toBe('en1')
    expect(ids('"membrane cell"')).toEqual([])
    expect(ids('"plasma membrane" function')).toEqual([])
  })

  it('preguntas naturales en chino, japonés y coreano', () => {
    expect(ids('光合作用')[0]).toBe('zh1')
    expect(ids('光合作用的过程')[0]).toBe('zh1')
    expect(ids('植物的光合作用')[0]).toBe('zh1')
    expect(ids('什么是光合作用')[0]).toBe('zh1')
    expect(ids('光合成とは')[0]).toBe('ja1')
    expect(ids('光合成の過程')[0]).toBe('ja1')
    expect(ids('식물의 광합성')[0]).toBe('ko1')
    expect(ids('细胞呼吸是什么')[0]).toBe('zh2')
    const mixed = new Set(ids('photosynthesis 光合作用'))
    expect(mixed.has('zh1') && mixed.has('en1')).toBe(true)
    expect(ids('日本語')).toEqual([])
  })

  it('la frase CJK estricta gana cuando encuentra algo', () => {
    const idx = new SearchIndex([chunk('a', 'Curso de Python入門 para principiantes'), chunk('c', 'El kanji 入 aparece solo'), chunk('f', '入 está lejos de 門 en este fragmento'), chunk('i', 'Solo 入門 por aquí, sin lenguajes')])
    expect(new Set(idx.search('入門').map((h) => h.chunk.id))).toEqual(new Set(['a', 'i']))
    expect(idx.search('python 入門').map((h) => h.chunk.id)).toEqual(['a'])
    expect(idx.search('入門入門').length).toBeGreaterThan(0)
  })

  it('el resaltado CJK respeta la secuencia', () => {
    const hit = index.search('光合作用')[0]
    expect(hit.snippet).toContain('**光合作用**')
    for (const bad of ['**用光**', '**光**能', '利**用']) expect(hit.snippet).not.toContain(bad)
    expect(index.search('植物的光合作用')[0].snippet).toContain('**光合作用')
    expect(index.search('光')[0].snippet).toContain('**光')
  })

  it('un ion se encuentra sin su carga', () => {
    const idx = new SearchIndex([chunk('ion', 'El ion sulfato SO_4^{2−} y el hierro Fe^{3+} en disolución.'), chunk('acid', 'El ácido sulfúrico H_2SO_4 es fuerte.'), chunk('poly', 'La función x^2-3 tiene dos raíces.')])
    expect(idx.search('SO4')[0].chunk.id).toBe('ion')
    expect(idx.search('H2SO4').map((h) => h.chunk.id)).toEqual(['acid'])
    expect(idx.search('Fe').map((h) => h.chunk.id)).toEqual(['ion'])
    expect(idx.search('x3')).toEqual([])
    expect(withoutSuperscripts('SO_4^{2−}')).toBe('SO4')
    expect(withoutSuperscripts('SO_4^2-')).toBe('SO4')
    expect(withoutSuperscripts('x^2-3')).toBe('x-3')
    expect(idx.search('SO4')[0].snippet).toContain('**SO_4')
  })
})

describe('MJ-ING-001: frases CJK', () => {
  const index = new SearchIndex([
    chunk('a', 'Curso de Python入門 para principiantes'), chunk('b', '入門 y Python en el mismo texto'), chunk('c', 'El kanji 入 aparece solo'), chunk('d', 'El kanji 門 aparece solo'),
    chunk('e', 'Solo Python por aquí'), chunk('f', '入 está lejos de 門 en este fragmento'), chunk('k1', '안녕하세요 es un saludo'), chunk('k2', '안녕 es otro saludo'),
    chunk('h1', 'Curso de idiomas', 'Python入門'), chunk('g', '入、門 sin inglés en este texto'), chunk('l', 'Programación 入門 para empezar'), chunk('i', 'Solo 入門 por aquí, sin lenguajes')
  ])
  const ids = (q: string): Set<string> => new Set(index.search(q, { limit: 20 }).map((h) => h.chunk.id))

  it('dos ideogramas deben ir juntos; uno solo se encuentra', () => {
    expect(ids('入門')).toEqual(new Set(['a', 'b', 'g', 'h1', 'i', 'l']))
    expect(ids('入')).toEqual(new Set(['a', 'b', 'c', 'f', 'g', 'h1', 'i', 'l']))
    expect(ids('門')).toEqual(new Set(['a', 'b', 'd', 'f', 'g', 'h1', 'i', 'l']))
  })

  it('con palabras latinas, prefijos, título y asterisco', () => {
    expect(ids('python 入門')).toEqual(new Set(['a', 'b', 'h1']))
    expect(ids('入門').has('h1')).toBe(true)
    expect(ids('日本').size).toBe(0)
    expect(ids('prog* 入門')).toEqual(new Set(['l']))
    expect(ids('prog 入門')).toEqual(new Set(['l']))
    expect(ids('python* 入門')).toEqual(new Set(['a', 'b', 'h1']))
    expect(ids('入門*')).toEqual(new Set(['a', 'b', 'g', 'h1', 'i', 'l']))
    expect(ids('안녕하세요')).toEqual(new Set(['k1']))
  })

  it('los ideogramas pegados a una palabra latina son términos propios', () => {
    expect(terms('Python入門')).toEqual(['python', '入', '門'])
    expect(terms('HTML基础')).toEqual(['html', '基', '础'])
    expect(terms('Python入門')).toEqual(terms('Python 入門'))
    expect(terms('入門Python')).toEqual(['入', '門', 'python'])
    expect(terms('Pythonｱｲ')).toEqual(['python', 'ｱ', 'ｲ'])
    expect(terms('Python𠀀')).toEqual(['python', '𠀀'])
    expect(terms('Python々')).toEqual(['python', '々'])
    const idx = new SearchIndex([{ id: 'py', sourceID: 's1', ordinal: 0, page: 1, text: 'Curso de Python入門 para principiantes' }])
    const snippet = idx.search('入門')[0]?.snippet ?? ''
    expect(snippet).toContain('**入門**')
    expect(snippet).not.toContain('****')
    expect(idx.search('入門').map((h) => h.chunk.id)).toEqual(['py'])
    expect(idx.search('python').map((h) => h.chunk.id)).toEqual(['py'])
  })
})

describe('Alias sin marcas de superíndice y subíndice', () => {
  it('las consultas planas encuentran y resaltan las formas marcadas', () => {
    const index = new SearchIndex([{ id: 'c', sourceID: 's', ordinal: 0, page: 1, text: 'El agua es H_2O y el volumen se mide en cm^3; el carbono-14 es 14C.' }])
    for (const q of ['H2O', 'cm3', '14C', 'H_2O', 'cm^3']) expect(index.search(q).map((h) => h.chunk.id), q).toEqual(['c'])
    const small = new SearchIndex([{ id: 'c', sourceID: 's', ordinal: 0, page: 1, text: 'El agua es H_2O y el volumen se mide en cm^3.' }])
    expect(small.search('H2O')[0].snippet).toContain('**H_2O**')
    expect(small.search('cm3')[0].snippet).toContain('**cm^3**')
    expect(withoutScripts('H_2O y cm^3')).toBe('H2O y cm3')
    expect(withoutScripts('10^{4} mol')).toBe('104 mol')
    expect(withoutScripts('snake_case')).toBe('snakecase')
    expect(isAllCaps('VOLUMEN EN CM^3')).toBe(true)
    expect(parseHeading('VOLUMEN EN CM^3')).not.toBeNull()
  })
})
