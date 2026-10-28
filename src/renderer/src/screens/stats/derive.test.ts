import { describe, expect, it } from 'vitest'
import { heatGrid, heatLevel, nothingToMeasure, rhythm, shiftKey, streak, sumDays, sumLevels, totals, weekdayMonday } from './derive'
import type { StatsCourse, StatsDay } from '@shared/ipc/stats'

const day = (date: string, minutes = 0, attempts = 0, correct = 0): StatsDay => ({ date, minutes, attempts, correct })

function course(id: string, days: StatsDay[], extra: Partial<StatsCourse> = {}): StatsCourse {
  return { id, title: id, icon: 'math', hue: 0.6, expected: null, low: 0, high: 0, coverage: 0, label: 'notStarted', days, topics: [], levels: [], history: [], skillCount: 3, ...extra }
}

describe('streak', () => {
  it('cuenta hasta hoy y la mejor de la ventana', () => {
    const days = [day('2026-10-01', 5), day('2026-10-02', 5), day('2026-10-03', 5), day('2026-10-05', 3), day('2026-10-06', 1)]
    expect(streak(days, '2026-10-06')).toEqual({ current: 2, best: 3 })
  })
  it('si hoy aún no hay estudio, la racha que terminó ayer sigue viva', () => {
    expect(streak([day('2026-10-04', 5), day('2026-10-05', 5), day('2026-10-06', 0)], '2026-10-06')).toEqual({ current: 2, best: 2 })
  })
  it('sin ayer ni hoy, 0', () => {
    expect(streak([day('2026-10-01', 5)], '2026-10-06')).toEqual({ current: 0, best: 1 })
  })
  it('ignora fechas futuras e inválidas y cuenta días con solo ejercicios', () => {
    expect(streak([day('2026-10-07', 9), day('nope', 3), day('2026-10-06', 0, 2)], '2026-10-06')).toEqual({ current: 1, best: 1 })
  })
  it('el horario de verano no rompe la racha', () => {
    expect(streak([day('2026-03-28', 5), day('2026-03-29', 5), day('2026-03-30', 5)], '2026-03-30').current).toBe(3)
  })
})

describe('días y totales', () => {
  it('suma cursos y calcula el acierto', () => {
    const a = course('a', [day('2026-10-01', 10, 4, 3), day('2026-10-02', 0)])
    const b = course('b', [day('2026-10-01', 5, 1, 1), day('2026-10-02', 7, 0, 0)])
    const s = sumDays([a, b])
    expect(s).toEqual([day('2026-10-01', 15, 5, 4), day('2026-10-02', 7, 0, 0)])
    expect(totals(s)).toEqual({ minutes: 22, activeDays: 2, attempts: 5, correct: 4, accuracy: 0.8 })
  })
  it('sin intentos no hay acierto', () => {
    expect(totals([day('2026-10-01', 3)]).accuracy).toBeNull()
  })
  it('limpia valores raros', () => {
    const a = course('a', [day('2026-10-01', Number.NaN, -2, Infinity)])
    expect(sumDays([a])).toEqual([day('2026-10-01', 0, 0, 0)])
  })
})

describe('mapa de calor', () => {
  it('umbrales de la app original', () => {
    expect([0, 1, 9.9, 10, 24, 25, 49, 50, 300].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
  it('semanas con el lunes arriba', () => {
    expect(weekdayMonday('2026-10-26')).toBe(0) // lunes
    expect(weekdayMonday('2026-11-01')).toBe(6) // domingo
    const days = [day('2026-10-28'), day('2026-10-29'), day('2026-10-30'), day('2026-10-31'), day('2026-11-01'), day('2026-11-02')]
    const g = heatGrid(days)
    expect(g.weeks).toBe(2)
    expect(g.cells[0]).toMatchObject({ week: 0, weekday: 2 })
    expect(g.cells[5]).toMatchObject({ week: 1, weekday: 0 })
    expect(g.weekStarts).toEqual(['2026-10-26', '2026-11-02'])
  })
  it('ritmo: promedio, mejor día y semana más larga', () => {
    // la ventana siempre es continua
    const days = Array.from({ length: 9 }, (_, i) => day(shiftKey('2026-10-26', i)))
    days[0].minutes = 30
    days[1].minutes = 10
    days[7].minutes = 50
    const r = rhythm(days)
    expect(r.avgActive).toBe(30)
    expect(r.bestWeekday).toBe(0)
    expect(r.bestWeek).toEqual({ start: '2026-11-02', minutes: 50 })
    expect(rhythm([day('2026-10-26')])).toEqual({ avgActive: null, bestWeekday: null, bestWeek: null, byWeekday: [0, 0, 0, 0, 0, 0, 0] })
    expect(r.byWeekday[0]).toBe(80)
  })
  it('shiftKey cruza meses y años', () => {
    expect(shiftKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('niveles', () => {
  it('suma por semana y empieza una semana antes del primer avance', () => {
    const zero = { unseen: 3, learning: 0, practicing: 0, solid: 0, mastered: 0 }
    const a = course('a', [], {
      levels: [
        { date: '2026-10-01', counts: zero },
        { date: '2026-10-08', counts: zero },
        { date: '2026-10-15', counts: { unseen: 2, learning: 1, practicing: 0, solid: 0, mastered: 0 } }
      ]
    })
    const b = course('b', [], { levels: [{ date: '2026-10-15', counts: { unseen: 0, learning: 0, practicing: 0, solid: 1, mastered: 1 } }] })
    const s = sumLevels([a, b])
    expect(s.map((p) => p.date)).toEqual(['2026-10-08', '2026-10-15'])
    expect(s[1].counts).toEqual({ unseen: 2, learning: 1, practicing: 0, solid: 1, mastered: 1 })
  })
  it('sin avance no hay serie', () => {
    expect(sumLevels([course('a', [], { levels: [{ date: '2026-10-01', counts: { unseen: 4, learning: 0, practicing: 0, solid: 0, mastered: 0 } }] })])).toEqual([])
  })
  it('nada que medir', () => {
    expect(nothingToMeasure([course('a', [day('2026-10-01')])])).toBe(true)
    expect(nothingToMeasure([course('a', [day('2026-10-01', 4)])])).toBe(false)
  })
})
