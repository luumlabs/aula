import { describe, expect, it, vi } from 'vitest'
import { dropSelection } from './reading'

describe('Escape con texto seleccionado', () => {
  it('lo suelta (y no sale)', () => {
    const removeAllRanges = vi.fn()
    expect(dropSelection({ isCollapsed: false, removeAllRanges })).toBe(true)
    expect(removeAllRanges).toHaveBeenCalledOnce()
  })
  it('sin selección no hace nada (y sale)', () => {
    const removeAllRanges = vi.fn()
    expect(dropSelection({ isCollapsed: true, removeAllRanges })).toBe(false)
    expect(dropSelection(null)).toBe(false)
    expect(removeAllRanges).not.toHaveBeenCalled()
  })
})
