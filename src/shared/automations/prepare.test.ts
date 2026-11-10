import { describe, expect, it } from 'vitest'
import { PREPARE_RULES, prepareCandidates, type PreparableEvent } from './prepare'

const NOW = Date.parse('2026-11-10T16:00:00Z')
const H = 3_600_000
const ev = (id: string, kind: string, hours: number, extra: Partial<PreparableEvent> = {}): PreparableEvent => ({ id, title: id, kind, start: new Date(NOW + hours * H), allDay: false, ...extra })
const inAula = (e: PreparableEvent): string | undefined => e.packID

describe('qué adelanta Aula por su cuenta', () => {
  it('un examen o una prueba cercanos con curso en Aula piden un repaso; una entrega cercana, una guía', () => {
    const got = prepareCandidates([
      ev('prueba', 'quiz', 20, { packID: 'calculo' }),
      ev('examen', 'exam', 60, { packID: 'fisica' }),
      ev('entrega', 'assignment', 40),
      ev('clase', 'lecture', 5, { packID: 'calculo' })
    ], new Set(), inAula, NOW, { ...PREPARE_RULES, max: 10 })
    expect(got.map((c) => [c.event.id, c.kind, c.packID])).toEqual([['prueba', 'review', 'calculo'], ['entrega', 'guide', undefined], ['examen', 'review', 'fisica']])
    expect(got[0].hoursLeft).toBeCloseTo(20)
  })

  it('ni demasiado pronto, ni cuando ya es tarde, ni dos veces, ni un examen sin curso', () => {
    const none = prepareCandidates([
      ev('lejos', 'exam', 24 * 6, { packID: 'c' }),
      ev('ya', 'quiz', 1, { packID: 'c' }),
      ev('pasado', 'assignment', -5),
      ev('hecho', 'quiz', 30, { packID: 'c' }),
      ev('sin-curso', 'exam', 30),
      ev('entrega-lejos', 'assignment', 24 * 5)
    ], new Set(['hecho']), inAula, NOW)
    expect(none).toEqual([])
  })

  it('lo más cercano primero y sin pasar de lo que cabe en una pasada', () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, 'assignment', 80 - i * 10))
    const got = prepareCandidates(many, new Set(), inAula, NOW)
    expect(got.map((c) => c.event.id)).toEqual(['e5', 'e4'])
    expect(prepareCandidates(many, new Set(), inAula, NOW, { ...PREPARE_RULES, max: 0 })).toEqual([])
  })
})
