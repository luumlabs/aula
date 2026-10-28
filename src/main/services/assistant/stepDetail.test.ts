import { describe, expect, it } from 'vitest'
import { shortURL, stepDetail } from './stepDetail'

describe('stepDetail', () => {
  it('saca lo que se buscó, el título o la expresión', () => {
    expect(stepDetail({ query: '  regla de   la cadena ' })).toEqual({ detail: 'regla de la cadena' })
    expect(stepDetail({ title: 'Parábolas · 3 tarjetas', cards: [{}, {}, {}] })).toEqual({ detail: 'Parábolas · 3 tarjetas', count: 3 })
    expect(stepDetail({ expression: '2^2 - 4' })).toEqual({ detail: '2^2 - 4' })
  })

  it('nunca enseña ids ni lo que no es texto', () => {
    expect(stepDetail({ source_id: 'src-3f9a', name: 'src-3f9a2' })).toEqual({})
    expect(stepDetail({ query: 42 })).toEqual({})
    expect(stepDetail(null)).toEqual({})
    expect(stepDetail(['a'])).toEqual({})
  })

  it('acorta las direcciones web y los textos largos', () => {
    expect(shortURL('https://www.es.wikipedia.org/wiki/Par%C3%A1bola?x=1')).toBe('es.wikipedia.org/wiki/Parábola')
    expect(shortURL('file:///etc/passwd')).toBeUndefined()
    expect(stepDetail({ url: 'https://example.com/' })).toEqual({ detail: 'example.com' })
    const long = stepDetail({ query: 'a '.repeat(80) }).detail!
    expect(Array.from(long).length).toBeLessThanOrEqual(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('oculta las claves que se cuelen en una búsqueda', () => {
    expect(stepDetail({ query: 'mi clave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }).detail).not.toContain('sk-ant')
  })
})
