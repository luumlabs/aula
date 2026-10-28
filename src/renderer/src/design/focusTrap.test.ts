import { describe, expect, it } from 'vitest'
import { nextTrapIndex } from './focusTrap'

describe('A4-P2-11 · nextTrapIndex (Tab dentro de una capa modal)', () => {
  it('desde el último, Tab vuelve al primero; desde el primero, Mayús+Tab va al último', () => {
    expect(nextTrapIndex(3, 4, false)).toBe(0)
    expect(nextTrapIndex(0, 4, true)).toBe(3)
  })
  it('con el foco fuera de la capa, entra por el principio (o por el final con Mayús)', () => {
    expect(nextTrapIndex(-1, 4, false)).toBe(0)
    expect(nextTrapIndex(-1, 4, true)).toBe(3)
  })
  it('en medio, lo hace el navegador', () => {
    expect(nextTrapIndex(1, 4, false)).toBeNull()
    expect(nextTrapIndex(2, 4, true)).toBeNull()
  })
  it('un solo elemento se queda enfocado; sin ninguno, nada', () => {
    expect(nextTrapIndex(0, 1, false)).toBe(0)
    expect(nextTrapIndex(0, 1, true)).toBe(0)
    expect(nextTrapIndex(-1, 0, false)).toBeNull()
  })
})
