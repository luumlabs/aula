// La tarjeta final del monitor: curso nuevo frente a «Pedir cambios».
import { describe, expect, it } from 'vitest'
import type { RunReport } from '@shared/generation/types'
import { doneSummary, shownSkillStatus } from './summary'

const report = (o: Partial<RunReport> = {}): RunReport => ({
  skillsReady: 2, skillsNeedingReview: 0, skillsFailed: 0, lessonBlocks: 30, exercises: 21, cards: 12, decks: 0, verified: 18, fixed: 0, flagged: 0, minutes: 9, notes: [], ...o
})

describe('doneSummary', () => {
  it('un curso nuevo cuenta lo que tiene', () => {
    expect(doneSummary(report(), 'create')).toEqual({ kind: 'created', items: [{ key: 'topics', count: 2 }, { key: 'exercises', count: 21 }, { key: 'cards', count: 12 }], verified: 18 })
  })

  it('«Pedir cambios» cuenta lo añadido y los temas modificados, no el curso entero', () => {
    // el caso del juez: un curso de 2 temas al que se añadió 1 tema y 4 ejercicios
    const s = doneSummary(report({ skillsReady: 1, added: { skills: 1, exercises: 4, cards: 0, lessonBlocks: 12 }, changedSkills: 1 }), 'extend')
    expect(s).toEqual({ kind: 'extended', added: [{ key: 'topics', count: 1 }, { key: 'exercises', count: 4 }], changed: 0, verified: 18 })
    const more = doneSummary(report({ added: { skills: 0, exercises: 3, cards: 0, lessonBlocks: 0 }, changedSkills: 1 }), 'extend')
    expect(more).toMatchObject({ added: [{ key: 'exercises', count: 3 }], changed: 1 })
    // ejecuciones antiguas sin lo que había al empezar: solo los temas tocados
    expect(doneSummary(report({ skillsReady: 1 }), 'extend')).toEqual({ kind: 'touched', count: 1, verified: 18 })
    expect(doneSummary(report({ added: { skills: 0, exercises: 0, cards: 0, lessonBlocks: 0 }, changedSkills: 0 }), 'extend')).toMatchObject({ added: [], changed: 0 })
  })

  it('un tema sin tocar en una ampliación terminada sale «sin cambios», no «en espera»', () => {
    expect(shownSkillStatus('pending', 'extend', false)).toBe('unchanged')
    expect(shownSkillStatus('pending', 'extend', true)).toBe('pending')
    expect(shownSkillStatus('pending', 'create', false)).toBe('pending')
    expect(shownSkillStatus('done', 'extend', false)).toBe('done')
  })
})
