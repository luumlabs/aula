import { describe, expect, it } from 'vitest'
import { noticeNeeded } from './power'

describe('A5-P1-2 · noticeNeeded (el temporizador avisa si no lo estás viendo)', () => {
  it('minimizada, oculta o detrás de otra app: avisa', () => {
    for (const window of ['minimized', 'hidden', 'inactive'] as const) expect(noticeNeeded({ window, locked: false }), window).toBe(true)
  })
  it('a la vista y con el foco: no hace falta (ya lo ve en la app)', () => {
    expect(noticeNeeded({ window: 'active', locked: false })).toBe(false)
  })
  it('con la pantalla bloqueada, siempre', () => {
    expect(noticeNeeded({ window: 'active', locked: true })).toBe(true)
  })
})
