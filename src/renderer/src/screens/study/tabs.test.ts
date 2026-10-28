import { describe, expect, it } from 'vitest'
import type { Attempt, CardProgress } from '@shared/schema'
import { attemptStats, cardState, promptText, searchKey } from './tabs'

describe('cuentas de las pestañas', () => {
  it('precisión media de los intentos', () => {
    expect(attemptStats([])).toEqual({ count: 0, accuracy: 0 })
    const a = [{ credit: 1 }, { credit: 0.5 }, { credit: Number.NaN }] as Attempt[]
    expect(attemptStats(a)).toEqual({ count: 3, accuracy: 0.5 })
  })
  it('el enunciado en una línea', () => {
    expect(promptText({ id: 'e1', prompt: [{ type: 'text', md: '## Halla\n  el valor' }, { type: 'math', tex: 'x^2' }] } as never)).toBe('Halla el valor $x^2$')
    expect(promptText({ id: 'e2', prompt: [] })).toBe('e2')
    expect(promptText({ id: 'e3', prompt: [{ type: 'text', md: 'Un [[1]] aquí' }] } as never)).toBe('Un ___ aquí')
  })
  it('estado de una tarjeta y días que faltan', () => {
    const now = new Date('2026-03-01T10:00:00Z')
    expect(cardState(undefined, now)).toEqual({ state: 'new', inDays: 0 })
    const p = { reps: 2, phase: 'review', due: '2026-03-04T09:00:00Z' } as CardProgress
    expect(cardState(p, now)).toEqual({ state: 'review', inDays: 3 })
    expect(cardState({ ...p, due: '2026-02-20T00:00:00Z' }, now).inDays).toBe(0)
  })
  it('buscar sin tildes, mayúsculas ni LaTeX', () => {
    expect(searchKey('Ángulo de **referencia** $\\theta$')).toBe('angulo de referencia')
  })
})
