// Rachas, tendencia y formato de tiempos (de StudyStatsTests.swift).
import { describe, expect, it } from 'vitest'
import { dayKey, StudyStats, type DayStat } from './studyStats'
import { addDays, UTC } from '@engine/calendar/time'
import { INT_MAX } from './support'
import { date, TestRNG, Zones } from './testSupport.testutil'

const day = (s: string, minutes = 20, attempts = 5, correct = 4): DayStat => ({ day: s, minutes, attempts, correct })
const streak = (days: DayStat[], today: Date, tz: string = UTC) => StudyStats.streak(days, today, tz)

describe('StudyStats · calendario', () => {
  it('números de día de referencia', () => {
    const known: [number, number, number, number][] = [
      [1970, 1, 1, 0], [1969, 12, 31, -1], [2000, 1, 1, 10_957], [2000, 2, 29, 11_016], [2000, 3, 1, 11_017], [2024, 2, 29, 19_782], [2026, 3, 8, 20_520],
      [2026, 10, 7, 20_733], [2026, 12, 31, 20_818], [2027, 1, 1, 20_819], [1900, 3, 1, -25_508], [1, 1, 1, -719_162], [9999, 12, 31, 2_932_896]
    ]
    for (const [y, m, d, n] of known) expect(StudyStats.dayNumber(y, m, d), `${y}-${m}-${d}`).toBe(n)
  })

  it('días consecutivos difieren en uno', () => {
    let previous = StudyStats.dayNumber(1999, 1, 1) as number
    let d = date(1999, 1, 1)
    for (let i = 0; i < 366 * 30; i++) {
      d = addDays(d, 1, UTC)
      const n = StudyStats.dayNumberFrom(dayKey(d, UTC)) as number
      expect(n).toBe(previous + 1)
      previous = n
    }
  })

  it('fechas inválidas', () => {
    expect(StudyStats.dayNumber(2023, 2, 29)).toBeNull(); expect(StudyStats.dayNumber(1900, 2, 29)).toBeNull()
    expect(StudyStats.dayNumber(2000, 2, 29)).not.toBeNull(); expect(StudyStats.dayNumber(2024, 2, 29)).not.toBeNull()
    expect(StudyStats.dayNumber(2026, 13, 1)).toBeNull(); expect(StudyStats.dayNumber(2026, 0, 1)).toBeNull()
    expect(StudyStats.dayNumber(2026, 4, 31)).toBeNull(); expect(StudyStats.dayNumber(2026, 4, 0)).toBeNull()
    expect(StudyStats.dayNumber(0, 4, 1)).toBeNull(); expect(StudyStats.dayNumber(10_000, 4, 1)).toBeNull()
  })

  it('lectura de `yyyy-MM-dd`', () => {
    expect(StudyStats.dayNumberFrom('2026-10-07')).toBe(20_733)
    expect(StudyStats.dayNumberFrom('2026-1-5')).toBe(StudyStats.dayNumber(2026, 1, 5))
    for (const bad of ['', '2026', '2026-10', '2026-10-07-01', '26-10-07', '2026/10/07', '2026-10-07x', ' 2026-10-07', '2026-10-7 ', 'abcd-ef-gh',
      '2026-13-01', '2026-02-30', '２０２６-10-07', '2026-١٠-07', '-2026-10-07', '2026--10-07', '2026-100-07', '2026-10-007', '٢٠٢٦-10-07']) {
      expect(StudyStats.dayNumberFrom(bad), `'${bad}'`).toBeNull()
    }
  })
})

describe('StudyStats · rachas', () => {
  it('básica, vacía y que sobrevive hasta que acaba el día', () => {
    expect(streak([day('2026-10-05'), day('2026-10-06'), day('2026-10-07')], date(2026, 10, 7, 12))).toEqual({ current: 3, best: 3 })
    expect(streak([], date(2026, 10, 7, 12))).toEqual({ current: 0, best: 0 })
    expect(streak([day('basura')], date(2026, 10, 7, 12))).toEqual({ current: 0, best: 0 })
    expect(streak([day('2026-10-05'), day('2026-10-06')], date(2026, 10, 7, 8))).toEqual({ current: 2, best: 2 })
    expect(streak([day('2026-10-04'), day('2026-10-05')], date(2026, 10, 7, 8))).toEqual({ current: 0, best: 2 })
  })

  it('mejor frente a actual; huecos', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-20', '2026-10-06', '2026-10-07'].map((d) => day(d))
    expect(streak(days, date(2026, 10, 7, 20))).toEqual({ current: 2, best: 5 })
    expect(streak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'].map((d) => day(d)), date(2026, 10, 7, 20))).toEqual({ current: 4, best: 4 })
  })

  it('ignora inactivos, futuros, inválidos y repetidos', () => {
    const today = date(2026, 10, 7, 20)
    const days = [day('2026-10-07'), day('2026-10-07', 5, 0, 0), day('2026-10-06', 0, 0, 0), day('2026-10-05'), day('2026-10-08'), day('2026-10-09'),
      day('2026-13-40'), day('hoy'), day(''), day('2026-10-04', NaN, 0, 0)]
    expect(streak(days, today)).toEqual({ current: 1, best: 1 })
    expect(streak([day('2026-10-07', 3, 0, 0)], today)).toEqual({ current: 1, best: 1 })
    expect(streak([day('2026-10-07', 0, 2, 1)], today)).toEqual({ current: 1, best: 1 })
  })

  it('fin de mes, de año y bisiestos', () => {
    expect(streak(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map((d) => day(d)), date(2027, 1, 2, 9))).toEqual({ current: 4, best: 4 })
    expect(streak(['2024-02-28', '2024-02-29', '2024-03-01'].map((d) => day(d)), date(2024, 3, 1, 9))).toEqual({ current: 3, best: 3 })
    expect(streak(['2023-02-28', '2023-03-01'].map((d) => day(d)), date(2023, 3, 1, 9))).toEqual({ current: 2, best: 2 })
  })

  it('usa la zona del calendario para «hoy»', () => {
    const instant = date(2026, 3, 9, 2, 0, 0)
    const days = [day('2026-03-07'), day('2026-03-08')]
    expect(streak(days, instant, Zones.newYork)).toEqual({ current: 2, best: 2 })
    expect(streak(days, instant, UTC)).toEqual({ current: 2, best: 2 })
    const old = [day('2026-03-06'), day('2026-03-07')]
    expect(streak(old, instant, UTC)).toEqual({ current: 0, best: 2 })
    expect(streak(old, instant, Zones.newYork)).toEqual({ current: 2, best: 2 })
  })

  it('cambios de hora; historial grande', () => {
    expect(streak(['2026-10-31', '2026-11-01', '2026-11-02'].map((d) => day(d)), date(2026, 11, 2, 9, 0, 0, Zones.newYork), Zones.newYork)).toEqual({ current: 3, best: 3 })
    expect(streak(['2026-03-07', '2026-03-08', '2026-03-09'].map((d) => day(d)), date(2026, 3, 9, 9, 0, 0, Zones.newYork), Zones.newYork)).toEqual({ current: 3, best: 3 })
    const days: DayStat[] = []
    let d = date(2020, 1, 1)
    for (let i = 0; i < 3000; i++) {
      if (i % 17 !== 0) days.push(day(dayKey(d, UTC)))
      d = addDays(d, 1, UTC)
    }
    const s = streak(days, addDays(date(2020, 1, 1), 2999, UTC))
    expect(s.best).toBeGreaterThanOrEqual(s.current)
    expect(s.best).toBe(16)
  })

  it('clave de día', () => {
    const instant = date(2026, 3, 9, 2, 30, 0)
    expect(dayKey(instant, UTC)).toBe('2026-03-09')
    expect(dayKey(instant, Zones.newYork)).toBe('2026-03-08')
    expect(dayKey(instant, Zones.madrid)).toBe('2026-03-09')
    expect(dayKey(date(2026, 1, 5, 9), UTC)).toBe('2026-01-05')
    expect(StudyStats.dayNumberFrom(dayKey(instant, Zones.newYork))).toBe(20_520)
  })
})

describe('StudyStats · tendencia y minutos', () => {
  it('ventana 1 y ventana móvil ponderada por intentos', () => {
    expect(StudyStats.accuracyTrend([day('2026-10-01', 20, 10, 5), day('2026-10-02', 20, 4, 4), day('2026-10-03', 20, 5, 1)], 1)).toEqual([0.5, 1.0, 0.2])
    const days = [day('2026-10-01', 20, 10, 5), day('2026-10-02', 20, 4, 4), day('2026-10-03', 20, 6, 3)]
    const t = StudyStats.accuracyTrend(days, 2)
    expect(t.length).toBe(3)
    expect(t[0]).toBeCloseTo(0.5, 12); expect(t[1]).toBeCloseTo(9 / 14, 12); expect(t[2]).toBeCloseTo(7 / 10, 12)
    expect(StudyStats.accuracyTrend(days, 99)[2]).toBeCloseTo(12 / 20, 12)
  })

  it('ordena, descarta y fusiona', () => {
    const t = StudyStats.accuracyTrend([day('2026-10-03', 20, 2, 2), day('2026-10-01', 20, 4, 1), day('2026-10-02', 30, 0, 0), day('2026-10-01', 20, 4, 3), day('basura', 20, 5, 5)], 1)
    expect(t.length).toBe(2); expect(t[0]).toBeCloseTo(0.5, 12); expect(t[1]).toBeCloseTo(1, 12)
  })

  it('casos límite', () => {
    expect(StudyStats.accuracyTrend([], 7)).toEqual([])
    expect(StudyStats.accuracyTrend([day('2026-10-01', 20, 0, 0)], 7)).toEqual([])
    const one = [day('2026-10-01', 20, 3, 3)]
    expect(StudyStats.accuracyTrend(one, 0)).toEqual([1]); expect(StudyStats.accuracyTrend(one, -5)).toEqual([1])
    expect(StudyStats.accuracyTrend([day('2026-10-01', 20, 2, 9), day('2026-10-02', 20, 2, -4), day('2026-10-03', 20, 2, NaN)], 1)).toEqual([1, 0, 0])
    expect(StudyStats.accuracyTrend(one, INT_MAX)).toEqual([1])
    expect(StudyStats.accuracyTrend([day('2026-10-01', 20, 2, 2), day('2026-10-02', 20, 2, NaN)], 2)).toEqual([1, 0.5])
    expect(StudyStats.accuracyTrend([day('2026-10-01', 20, 2, 2), day('2026-10-02', 20, 2, Infinity)], 2)).toEqual([1, 0.5])
  })

  it('valores siempre en [0, 1]', () => {
    const rng = new TestRNG(3)
    const days: DayStat[] = []
    for (let i = 1; i <= 200; i++) {
      const attempts = rng.int(12)
      const mm = String(1 + (Math.trunc((i - 1) / 28) % 12)).padStart(2, '0'), dd = String(1 + ((i - 1) % 28)).padStart(2, '0')
      days.push(day(`2026-${mm}-${dd}`, 20, attempts, attempts * rng.unit()))
    }
    for (const w of [1, 3, 7, 30]) for (const v of StudyStats.accuracyTrend(days, w)) expect(v >= 0 && v <= 1).toBe(true)
  })

  it('formato de minutos', () => {
    const cases: [number, string][] = [[0, '0 min'], [-5, '0 min'], [NaN, '0 min'], [Infinity, '0 min'], [0.2, '<1 min'], [0.5, '1 min'], [1, '1 min'],
      [44.4, '44 min'], [59.4, '59 min'], [59.6, '1 h'], [60, '1 h'], [80, '1 h 20 min'], [125.5, '2 h 6 min'], [600, '10 h'], [1500, '25 h']]
    for (const [m, text] of cases) expect(StudyStats.formatMinutes(m), `${m}`).toBe(text)
    expect(StudyStats.formatMinutes(1e18)).toContain(' h')
    expect(StudyStats.formatMinutes(Number.MAX_VALUE)).toContain(' h')
  })
})
