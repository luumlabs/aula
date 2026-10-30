import { describe, expect, it } from 'vitest'
import { barAt, barTime, fromMontage, parseSheet, snap16, thin, type CueSheet, type MontageSheet, type SheetEvent } from './sheet.ts'

const base = (over: Partial<CueSheet> = {}): CueSheet => ({ version: 1, duration: 10, bpm: 120, sections: [{ bar: 1, kind: 'day' }], events: [], ...over })

describe('hoja de efectos', () => {
  it('pone los valores por defecto y ordena', () => {
    const s = parseSheet(base({ events: [{ t: 2, type: 'click' }, { t: 1, type: 'word' }], sections: [{ bar: 3, kind: 'night' }, { bar: 1, kind: 'intro' }] }))
    expect(s.key).toBe(2)
    expect(s.mode).toBe('film')
    expect(s.beat).toBeCloseTo(0.5)
    expect(s.bar).toBeCloseTo(2)
    expect(s.events.map((e) => e.t)).toEqual([1, 2])
    expect(s.events[0].intensity).toBe(0.7)
    expect(s.sections.map((x) => x.kind)).toEqual(['intro', 'night'])
  })

  it('dice qué está mal y dónde', () => {
    expect(() => parseSheet({ ...base(), version: 2 })).toThrow(/version/)
    expect(() => parseSheet(base({ events: [{ t: 1, type: 'boing' as never }] }))).toThrow(/events\[0\].*type/)
    expect(() => parseSheet(base({ events: [{ t: 1, type: 'light', dur: 1 }] }))).toThrow(/to: 'dark'/)
    expect(() => parseSheet(base({ events: [{ t: 1, type: 'rise' }] }))).toThrow(/dur > 0/)
    expect(() => parseSheet(base({ sections: [{ bar: 0, kind: 'day' }] }))).toThrow(/bar/)
    expect(() => parseSheet(base({ events: [{ t: 99, type: 'click' }] }))).toThrow(/fuera del vídeo/)
  })

  it('rejilla: compás y pulso, con anacrusa', () => {
    const s = parseSheet(base({ downbeat: 0.5 }))
    expect(barTime(s, 1)).toBeCloseTo(0.5)
    expect(barTime(s, 2, 3)).toBeCloseTo(0.5 + 2 + 1)
    expect(barAt(s, 0.2)).toBe(0)
    expect(barAt(s, 2.6)).toBe(2)
  })

  it('a tempo: encaja en la semicorchea solo dentro de −30 / +60 ms', () => {
    const s = parseSheet(base()) // semicorchea = 0,125 s
    expect(snap16(s, 1.02)).toBeCloseTo(1.0) // 20 ms tarde → se adelanta 20 ms (dentro de 30)
    expect(snap16(s, 0.96)).toBeCloseTo(1.0) // 40 ms antes → se retrasa 40 ms (dentro de 60)
    expect(snap16(s, 1.05)).toBeCloseTo(1.05) // habría que adelantarlo 50 ms: se queda
    expect(snap16(s, 1.0625)).toBeCloseTo(1.0625) // en medio de dos semicorcheas: se queda
  })
})

describe('la hoja del montaje (cueSheet5)', () => {
  const m: MontageSheet = {
    name: 'aula-v5-film',
    duration: 30,
    bpm: 104,
    offset: 0,
    sections: [
      { t: 0, name: 'Hook', mood: 'intro' },
      { t: 4.6154, name: 'Meet Aula', mood: 'drop' },
      { t: 6.9231, name: 'Plan', mood: 'day' },
      { t: 16.1538, name: 'Learn', mood: 'night' },
      { t: 25.3846, name: 'Outro', mood: 'outro' }
    ],
    events: [
      { t: 2.308, type: 'rise', intensity: 0.8, pan: 0 },
      { t: 4.615, type: 'flash', intensity: 1, pan: 0 },
      { t: 6.923, type: 'whoosh', intensity: 0.35, pan: 0, note: 'cut' },
      { t: 12.0, type: 'whoosh', intensity: 0.55, pan: 0.4, note: 'focus' },
      { t: 13.846, type: 'card', intensity: 0.9, pan: 0, note: '02 · Learn' },
      { t: 16.154, type: 'light', intensity: 0.9, pan: 0, note: 'arch' },
      { t: 17, type: 'icon', intensity: 0.4, pan: 0 },
      { t: 18, type: 'type', intensity: 0.3, pan: 0 },
      { t: 20, type: 'word', intensity: 0.65, pan: 0, note: 'Study' },
      { t: 21, type: 'word', intensity: 0.45, pan: 0.4, note: 'Your' },
      { t: 21.075, type: 'word', intensity: 0.45, pan: 0.4, note: 'day' },
      { t: 21.15, type: 'word', intensity: 0.45, pan: 0.4, note: 'glance.' },
      { t: 22, type: 'whoosh', intensity: 0.2, pan: 0, note: 'camera' },
      { t: 19, type: 'mystery', intensity: 0.3, pan: 0 }
    ]
  }

  it('moods → secciones, y la cartela ocupa su compás', () => {
    const c = fromMontage(m)
    expect(c.mode).toBe('film')
    expect(c.sections).toEqual([
      { bar: 1, kind: 'intro' },
      { bar: 3, kind: 'drop' },
      { bar: 4, kind: 'day' },
      { bar: 7, kind: 'card' },
      { bar: 8, kind: 'night' },
      { bar: 12, kind: 'end' }
    ])
  })

  it('da a cada gesto su duración y su luz', () => {
    const c = fromMontage(m)
    const by = (type: string) => c.events.filter((e) => e.type === type)
    expect(by('rise')[0].dur).toBeCloseTo(4.615 - 2.308) // hasta el destello
    expect(by('whoosh')[0].dur).toBe(0) // corte seco
    expect(by('whoosh')[1].dur).toBeGreaterThan(0)
    expect(by('light')[0].to).toBe('dark') // «arch» hacia la noche que viene
    expect(by('card')[0]).toMatchObject({ n: 2, dark: true })
    expect(c.events.some((e) => (e.type as string) === 'mystery')).toBe(false)
    // palabras: tic solo en las de 'type'; el titular keynote da un único acento al empezar su subrayado
    expect(by('word').map((e) => e.label)).toEqual(['Study'])
    expect(by('underline')).toHaveLength(1)
    expect(by('underline')[0].t).toBeCloseTo(21.15 + 0.46, 3)
    // un movimiento de cámara pequeño no suena
    expect(by('whoosh').some((e) => e.label === 'camera')).toBe(false)
    // parseSheet la reconoce sola
    expect(parseSheet(m).sections.length).toBe(6)
    expect(parseSheet({ ...m, bpm: 120, name: 'aula-v5-short' }).mode).toBe('short')
  })
})

describe('secciones a mitad de compás', () => {
  it('mandan desde el compás siguiente y no pisan un drop', () => {
    const c = fromMontage({ name: 'aula-v5-short', duration: 28, bpm: 120, offset: 0, sections: [{ t: 0, mood: 'intro' }, { t: 2, mood: 'drop' }, { t: 3, mood: 'day' }, { t: 12, mood: 'night' }, { t: 17, mood: 'build' }, { t: 22, mood: 'outro' }], events: [] })
    expect(c.mode).toBe('short')
    expect(c.sections.map((s) => `${s.bar}:${s.kind}`)).toEqual(['1:intro', '2:drop', '3:day', '7:night', '10:rise', '12:end'])
  })
})

describe('palabras con estilo y subrayado (cueSheet5 desde las 08:4x)', () => {
  it('tic solo en las de type; el acento del keynote cae en su subrayado exacto; el subrayado de un type no suena', () => {
    const c = fromMontage({
      name: 'aula-v5-film',
      duration: 20,
      bpm: 104,
      offset: 0,
      sections: [{ t: 0, mood: 'day' }],
      events: [
        { t: 1, type: 'word', intensity: 0.65, note: 'And', style: 'type', italic: false },
        { t: 1.5, type: 'word', intensity: 0.75, note: 'nine', style: 'type', italic: true },
        { t: 2.1, type: 'underline', intensity: 0.5, note: 'nine', style: 'type' },
        { t: 5, type: 'word', intensity: 0.45, pan: -0.45, note: 'Your', style: 'keynote', italic: false },
        { t: 5.075, type: 'word', intensity: 0.55, pan: -0.45, note: 'glance.', style: 'keynote', italic: true },
        { t: 5.62, type: 'underline', intensity: 0.5, pan: -0.45, note: 'glance.', style: 'keynote' },
        { t: 8, type: 'word', intensity: 0.45, note: 'Hello', style: 'caption', italic: false }
      ]
    })
    expect(c.events.filter((e) => e.type === 'word').map((e) => e.label)).toEqual(['And', 'nine'])
    const u = c.events.filter((e) => e.type === 'underline')
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ t: 5.62, label: 'glance.', pan: -0.45 })
  })
})

describe('densidad como la del v3', () => {
  it('quita el aire de las entradas que van solas (uno cada dos compases) y los empujones pequeños; deja lo demás', () => {
    const bar = 2.3
    const w = (t: number, label: string, size = 0.35): SheetEvent => ({ t, type: 'whoosh', label, size, dur: 0 })
    const ev: SheetEvent[] = [
      w(1, 'cut'),
      w(2.2, 'cut'), // solo y a menos de dos compases: fuera
      { t: 3.0, type: 'click' },
      w(3.05, 'cut'), // cae con el clic: es el mismo instante, se queda
      w(4, 'shape'), // coincidencia de forma: gesto con carácter propio, se queda
      w(4.4, 'camera', 0.45), // empujón pequeño: fuera
      w(5.8, 'cut'), // ya pasaron dos compases desde el último solo: se queda
      w(6.0, 'camera', 0.8) // empujón grande, pero a 0,2 s de una entrada: fuera
    ]
    expect(thin(ev, bar).map((e) => `${e.type}@${e.t}`)).toEqual(['whoosh@1', 'click@3', 'whoosh@3.05', 'whoosh@4', 'whoosh@5.8'])
  })
})
