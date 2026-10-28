import { describe, expect, it } from 'vitest'
import { isNearBottom } from './scroll'

describe('isNearBottom', () => {
  it('pegado al final con un margen', () => {
    expect(isNearBottom(500, 400, 900)).toBe(true)
    expect(isNearBottom(470, 400, 900)).toBe(true)
    expect(isNearBottom(300, 400, 900)).toBe(false)
    expect(isNearBottom(0, 400, 300)).toBe(true)
  })
})
