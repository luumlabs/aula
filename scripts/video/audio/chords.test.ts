import { describe, expect, it } from 'vitest'
import { bassNote, parseChord, voice } from './chords.ts'

describe('cifrado', () => {
  it('lee mayores, menores, sus, add9 y barras', () => {
    expect(parseChord('D')).toMatchObject({ root: 2, bass: 2, intervals: [0, 4, 7], minor: false })
    expect(parseChord('F#m')).toMatchObject({ root: 6, intervals: [0, 3, 7], minor: true })
    expect(parseChord('A/C#')).toMatchObject({ root: 9, bass: 1 })
    expect(parseChord('Dsus2').intervals).toEqual([0, 2, 7])
    expect(parseChord('Dadd9').intervals).toEqual([0, 4, 7, 14])
    expect(parseChord('Cmaj7').intervals).toEqual([0, 4, 7, 11])
  })
  it('conduce las voces sin saltos grandes', () => {
    const d = voice(parseChord('D'), 64)
    const a = voice(parseChord('A'), 64, d)
    expect(Math.max(...a.map((n, i) => Math.abs(n - d[i])))).toBeLessThanOrEqual(5)
    expect(bassNote(parseChord('A/C#'), 36)).toBe(37)
  })
})
