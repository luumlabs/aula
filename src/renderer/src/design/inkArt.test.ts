import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archLightFor } from './InkArt'
import { isViolet } from './colorGuard'

const css = readFileSync(join(__dirname, 'inkArt.css'), 'utf8')

describe('dibujos a tinta', () => {
  it('la luz del arco sigue la hora', () => {
    expect([5, 6, 10, 11, 16, 17, 20, 21, 23, 0].map(archLightFor)).toEqual(['night', 'dawn', 'dawn', 'noon', 'noon', 'dusk', 'dusk', 'night', 'night', 'night'])
  })
  it('se dibujan una vez y se quedan quietos', () => {
    expect(css).not.toMatch(/infinite|alternate/)
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    expect(css).not.toMatch(/gradient\(/)
  })
  it('sin tonos violetas, en claro ni en oscuro', () => {
    const hexes = css.match(/#[0-9a-f]{6}/gi) ?? []
    expect(hexes.length).toBeGreaterThanOrEqual(20)
    for (const h of hexes) expect(isViolet(h), h).toBe(false)
  })
})
