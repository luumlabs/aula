import { describe, expect, it } from 'vitest'
import { cueSheet5 } from './cuesheet.ts'
import { WORD_DUR, wordTimes } from './v5.ts'
import type { Montage } from './types.ts'

const m: Montage = {
  name: 'v5', fps: 60, size: [1920, 1080], theme: 'light', duration: 20,
  takes: { a: { duration: 10, actions: [{ at: 1, do: 'click', to: '#x', dur: 0.5 }, { at: 2, do: 'type', text: 'ab c', cps: 10 }] } },
  clips: [
    { take: 'a', start: 0, dur: 5, layout: { kind: 'keynote', side: 'right' } },
    { take: 'a', start: 5, dur: 5, enter: { kind: 'focus', dur: 0.5 }, layout: { kind: 'keynote', side: 'left' } },
    { take: 'a', start: 10, dur: 5, enter: { kind: 'light', dur: 1, style: 'dusk' } }
  ],
  titles: [{ start: 1, dur: 3, text: 'Exercises that explain your *mistake.*', style: 'keynote', side: 'left', underline: {} }],
  chapters: { names: ['Plan', 'Learn'], cards: [{ t: 15, dur: 2.4, n: 2, sub: 'x' }] },
  flashes: [3],
  sections: [{ t: 0, name: 'intro', mood: 'intro' }],
  sfx: [{ t: 12, type: 'count', intensity: 0.5 }],
  music: { bpm: 100, root: 62, cues: [], offset: 0.5, wav: 'x.wav' }
}

describe('hoja de efectos V5', () => {
  const s = cueSheet5(m, { cursorX: () => 1920 })
  const of = (type: string) => s.events.filter((e) => e.type === type)
  it('rejilla, secciones y orden', () => {
    expect(s.bpm).toBe(100)
    expect(s.beat).toBeCloseTo(0.6)
    expect(s.offset).toBe(0.5)
    expect(s.sections).toHaveLength(1)
    for (let i = 1; i < s.events.length; i++) expect(s.events[i].t).toBeGreaterThanOrEqual(s.events[i - 1].t)
  })
  it('clics (con paneo del cursor), teclas por carácter, entradas, luces, palabras, cartelas, destellos y lo marcado a mano', () => {
    expect(of('click')).toEqual([1.5, 6.5, 11.5].map((t) => ({ t, type: 'click', intensity: 0.6, pan: 1 })))
    expect(of('type').map((e) => e.t).slice(0, 3)).toEqual([2, 2.1, 2.3])
    expect(of('whoosh').map((e) => e.note)).toEqual(['focus', 'light'])
    expect(of('light')[0].note).toBe('dusk')
    expect(of('word').map((e) => e.t)).toEqual(wordTimes(m.titles![0]).map((t) => +t.toFixed(3)))
    expect(of('word')[0].pan).toBeLessThan(0)
    expect(of('card')[0].note).toBe('02 · Learn')
    expect(of('flash')).toHaveLength(1)
    expect(of('rise')[0].t).toBeCloseTo(1.8)
    expect(of('count')).toHaveLength(1)
  })
  it('cada palabra lleva el estilo del rótulo y si es la cursiva; el subrayado tiene su propio evento', () => {
    const w = of('word')
    expect(w.every((e) => e.style === 'keynote')).toBe(true)
    expect(w.map((e) => e.italic)).toEqual([false, false, false, false, true])
    const u = of('underline')
    expect(u).toHaveLength(1)
    const times = wordTimes(m.titles![0])
    expect(u[0].t).toBeCloseTo(times[times.length - 1] + WORD_DUR + 0.04, 3)
    expect(u[0].note).toBe('mistake.')
    expect(u[0].style).toBe('keynote')
  })
})
