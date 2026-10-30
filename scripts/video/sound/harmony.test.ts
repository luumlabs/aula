import { describe, expect, it } from 'vitest'
import { parseChord } from '../audio/chords.ts'
import { harmonize, safeScale, transpose } from './harmony.ts'
import { parseSheet, type SheetSection } from './sheet.ts'

const sheet = (sections: SheetSection[], bars = 40, key = 'D') => parseSheet({ version: 1, duration: bars * 2 + 0.5, bpm: 120, key, sections, events: [] })

describe('armonía', () => {
  it('transporta fundamental y bajo', () => {
    expect(transpose('A/C#', 2)).toBe('B/D#')
    expect(transpose('Bm7', -2)).toBe('Am7')
    expect(transpose('Gadd9/D', 5)).toBe('Cadd9/G')
  })

  it('forma de canción: la intro acaba en la dominante, el drop cae en re y el final cierra plagal en re', () => {
    const H = harmonize(sheet([{ bar: 1, kind: 'intro' }, { bar: 5, kind: 'drop' }, { bar: 6, kind: 'day' }, { bar: 10, kind: 'rise' }, { bar: 12, kind: 'end' }], 15))
    const sym = (b: number) => H[b - 1].symbol
    expect([1, 2, 3, 4].map(sym)).toEqual(['Bm', 'G', 'Em7', 'A'])
    expect(sym(5)).toBe('Dadd9')
    expect([10, 11].map(sym)).toEqual(['G', 'A'])
    expect([12, 13, 14].map(sym)).toEqual(['Dadd9', 'Gadd9/D', 'Dadd9'])
  })

  it('cada tanda de día o de noche es otra variante, y la cartela prepara lo que viene', () => {
    const H = harmonize(
      sheet([
        { bar: 1, kind: 'day' },
        { bar: 5, kind: 'card' },
        { bar: 6, kind: 'night' },
        { bar: 10, kind: 'card' },
        { bar: 11, kind: 'day' },
        { bar: 15, kind: 'card' },
        { bar: 16, kind: 'night' }
      ], 20)
    )
    const sym = (b: number) => H[b - 1].symbol
    expect(sym(1)).toBe('Dadd9') // día A
    expect(sym(6)).toBe('Bm9') // noche A
    expect(sym(11)).toBe('Bm7') // día B (vi–IV–I–V)
    expect(sym(16)).toBe('Em9') // noche B
    expect(sym(5)).toBe('Em9') // cartela antes de si menor
    expect(sym(10)).toBe('Em9') // antes de si menor
    expect(sym(15)).toBe('Asus4') // antes de mi menor
    expect(H[15].variant).toBe(1)
  })

  it('dos secciones de día seguidas (aunque haya cartela) son la misma variante', () => {
    const H = harmonize(sheet([{ bar: 1, kind: 'day' }, { bar: 3, kind: 'card' }, { bar: 4, kind: 'day' }], 8))
    expect(H[0].variant).toBe(0)
    expect(H[4].variant).toBe(0)
  })

  it('en otra tonalidad, todo se transporta', () => {
    const H = harmonize(sheet([{ bar: 1, kind: 'day' }], 4, 'F'))
    expect(H.map((h) => h.symbol).slice(0, 4)).toEqual(['Fadd9', 'C/E', 'Dm7', 'Bbadd9'.replace('Bb', 'A#')])
  })

  it('la escala segura nunca roza (un semitono por encima de una nota del acorde)', () => {
    for (const sym of ['Dadd9', 'A/C#', 'Bm7', 'Gadd9', 'Em9', 'Gmaj7', 'Asus4', 'Bm9']) {
      const c = parseChord(sym)
      const pcs = c.intervals.map((iv) => (c.root + iv) % 12)
      for (const m of safeScale(2, pcs, 60, 100)) expect(pcs.includes((m + 11) % 12)).toBe(false)
    }
  })
})
