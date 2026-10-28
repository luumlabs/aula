import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addDays, civilDaysBetween, daysFrom, startOfDay } from './civil'

// Node aplica TZ al vuelo: cada prueba fija una zona con cambio de hora y la restaura al terminar
let saved: string | undefined
beforeEach(() => {
  saved = process.env.TZ
})
afterEach(() => {
  if (saved === undefined) delete process.env.TZ
  else process.env.TZ = saved
})

const label = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

describe('fechas civiles con cambio de hora', () => {
  it('la semana del 27/10/2026 en Nueva York no repite el domingo 1 (J2-1)', () => {
    process.env.TZ = 'America/New_York'
    const days = daysFrom(new Date(2026, 9, 27, 15, 30), 7)
    expect(days.map(label)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-1', '2026-11-2'])
    expect(days.every((d) => d.getHours() === 0)).toBe(true)
    // el error de antes: medianoche + 6 × 24 h caía el domingo a las 23:00
    expect(new Date(startOfDay(new Date(2026, 9, 27)).getTime() + 6 * 86_400_000).getDate()).toBe(1)
  })

  it('también en Europa (25/10) y al adelantar la hora (marzo)', () => {
    process.env.TZ = 'Europe/Madrid'
    expect(daysFrom(new Date(2026, 9, 22), 5).map(label)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])
    expect(label(addDays(new Date(2026, 2, 28), 2))).toBe('2026-3-30')
    process.env.TZ = 'America/Santiago'
    expect(daysFrom(new Date(2026, 3, 3), 3).map(label)).toEqual(['2026-4-3', '2026-4-4', '2026-4-5'])
  })

  it('addDays conserva la hora del reloj y cuenta hacia atrás', () => {
    process.env.TZ = 'America/New_York'
    const d = addDays(new Date(2026, 9, 31, 9, 15), 2)
    expect([label(d), d.getHours(), d.getMinutes()]).toEqual(['2026-11-2', 9, 15])
    expect(label(addDays(new Date(2026, 10, 2), -1))).toBe('2026-11-1')
  })

  it('civilDaysBetween cuenta días naturales aunque uno dure 25 h', () => {
    process.env.TZ = 'America/New_York'
    expect(civilDaysBetween(new Date(2026, 9, 31, 23), new Date(2026, 10, 2, 1))).toBe(2)
    expect(civilDaysBetween(new Date(2026, 10, 2), new Date(2026, 10, 1, 23, 59))).toBe(-1)
  })
})
