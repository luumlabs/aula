import { describe, expect, it } from 'vitest'
import { calendarDays, examStatus } from './examStatus'

// Hoy: lunes 26 de octubre de 2026, 18:30 (hora local)
const now = new Date(2026, 9, 26, 18, 30)

describe('examStatus', () => {
  it('sin fecha o con una fecha rota no hay estado', () => {
    expect(examStatus(undefined, now)).toBeNull()
    expect(examStatus('', now)).toBeNull()
    expect(examStatus('no es una fecha', now)).toBeNull()
  })
  it('un examen futuro cuenta los días que faltan', () => {
    expect(examStatus(new Date(2026, 9, 27, 9, 0), now)).toEqual({ phase: 'upcoming', days: 1 })
    expect(examStatus(new Date(2026, 10, 4, 9, 0).toISOString(), now)).toEqual({ phase: 'upcoming', days: 9 })
  })
  it('hoy, antes de la hora del examen: es hoy', () => {
    expect(examStatus(new Date(2026, 9, 26, 20, 0), now)).toEqual({ phase: 'today' })
  })
  it('hoy, pasada la hora: ya fue (hace 0 días)', () => {
    expect(examStatus(new Date(2026, 9, 26, 8, 0), now)).toEqual({ phase: 'past', daysAgo: 0 })
  })
  it('el caso del dueño: el examen fue el lunes 19 y hoy es 26 → hace 7 días (no «0 días para el examen»)', () => {
    expect(examStatus(new Date(2026, 9, 19, 8, 0).toISOString(), now)).toEqual({ phase: 'past', daysAgo: 7 })
  })
  it('los días naturales no se tuercen con el cambio de hora (25 de octubre de 2026 en Europa)', () => {
    expect(calendarDays(new Date(2026, 9, 24, 23, 0), new Date(2026, 9, 26, 0, 30))).toBe(2)
    expect(calendarDays(new Date(2026, 9, 26, 0, 30), new Date(2026, 9, 24, 23, 0))).toBe(-2)
  })
})
