// Logros: se calculan con el progreso y se celebran una sola vez.
import { describe, expect, it } from 'vitest'
import { makePack, decodeProgress, type StudyProgress } from '@shared/schema'
import { ACHIEVEMENTS, achievementMeasures, achievementViews, newlyEarned } from './achievements'

const now = new Date(2026, 9, 26, 18)
const day = (offset: number): string => {
  const d = new Date(now)
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function progress(extra: Record<string, unknown> = {}): StudyProgress {
  return decodeProgress({ days: [0, 1, 2, 3, 4, 5, 6].map((o) => ({ day: day(o), minutes: 20, attempts: 10, correct: 8 })), ...extra })
}

describe('logros', () => {
  it('suma lo de todos los cursos: racha, minutos, aciertos y tarjetas', () => {
    const a = { pack: makePack({ id: 'a', title: 'A' }), progress: progress({ cards: { c1: { phase: 'review', due: now.toISOString(), stability: 3, difficulty: 5, reps: 60, lapses: 2, step: 0 } } }) }
    const b = { pack: makePack({ id: 'b', title: 'B' }), progress: progress() }
    const m = achievementMeasures([a, b], now, { sampleIds: ['b'] })
    expect(m.streak7).toBe(7)
    expect(m.hour1).toBe(280)
    expect(m.correct100).toBe(112)
    expect(m.cards100).toBe(62)
    expect(m.firstAnswer).toBe(140)
    // los cursos de ejemplo no cuentan como propios
    expect(m.creator).toBe(1)
  })

  it('la estantería marca lo conseguido y lo que falta, sin pasar de la meta', () => {
    const m = achievementMeasures([{ pack: makePack({ id: 'a', title: 'A' }), progress: progress() }], now)
    const v = achievementViews(m, {})
    expect(v.map((x) => x.id)).toEqual(ACHIEVEMENTS.map((x) => x.id))
    const byId = Object.fromEntries(v.map((x) => [x.id, x]))
    expect(byId.streak3).toMatchObject({ earned: true, value: 3, goal: 3 })
    expect(byId.streak30).toMatchObject({ earned: false, value: 7, goal: 30 })
    expect(byId.hour1.earned).toBe(true)
    expect(byId.hours10.earned).toBe(false)
  })

  it('solo lo nuevo se celebra, y lo ya apuntado sigue conseguido aunque baje la medida', () => {
    const m = achievementMeasures([{ pack: makePack({ id: 'a', title: 'A' }), progress: progress() }], now)
    const earned = { streak3: '2026-10-01T10:00:00.000Z', streak30: '2026-09-01T10:00:00.000Z' }
    const v = achievementViews(m, earned)
    const fresh = newlyEarned(v, earned)
    expect(fresh).toContain('streak7')
    expect(fresh).not.toContain('streak3')
    expect(v.find((x) => x.id === 'streak30')).toMatchObject({ earned: true, earnedAt: '2026-09-01T10:00:00.000Z' })
    expect(newlyEarned(achievementViews(m, {}), {})).not.toContain('streak30')
  })

  it('sin progreso no hay nada conseguido', () => {
    const v = achievementViews(achievementMeasures([], now), {})
    expect(v.every((x) => !x.earned && x.value === 0)).toBe(true)
  })
})
