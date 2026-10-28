// Pruebas de ids y huellas (port de FileIOTests en la app Swift anterior: Tests/BaseKitTests/BaseKitTests.swift).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { foldDiacritics, Hashing, IDs } from './ids'

describe('IDs', () => {
  it('slug y unique', () => {
    expect(IDs.slug('Examen #2: Círculo unidad')).toBe('examen-2-circulo-unidad')
    expect(IDs.unique('x', ['x', 'x-2'])).toBe('x-3')
    expect(IDs.unique('y', new Set(['x']))).toBe('y')
  })

  it('slug acota la longitud y nunca queda vacío', () => {
    expect(IDs.slug('¿¡!?')).toBe('item')
    expect(IDs.slug('a'.repeat(100), 10)).toBe('a'.repeat(10))
    expect(IDs.slug('uno dos tres', 8)).toBe('uno-dos')
    expect(IDs.slug('Straße')).toBe('strasse')
  })

  it('short da letras minúsculas y cifras', () => {
    for (let i = 0; i < 50; i++) expect(IDs.short()).toMatch(/^[a-z0-9]{8}$/)
    expect(IDs.short(4)).toHaveLength(4)
  })

  it('quita los diacríticos', () => {
    expect(foldDiacritics('Círculo ñandú')).toBe('Circulo nandu')
  })
})

describe('Hashing', () => {
  it('SHA-256 coincide con el de Node', () => {
    for (const s of ['', 'abc', 'ñandú — 数学', 'x'.repeat(1000)]) {
      expect(Hashing.sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
    const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256))
    expect(Hashing.sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('stableID es corto y estable', () => {
    expect(Hashing.stableID('../..')).toHaveLength(10)
    expect(Hashing.stableID('../..')).toBe(Hashing.stableID('../..'))
    expect(Hashing.stableID('a')).not.toBe(Hashing.stableID('b'))
  })
})
