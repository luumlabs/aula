import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { washSceneFor } from './Wash'

describe('aguadas', () => {
  it('el cielo del saludo sigue la hora', () => {
    expect([5, 6, 10, 11, 16, 17, 20, 21, 23, 0].map(washSceneFor)).toEqual(['night', 'dawn', 'dawn', 'noon', 'noon', 'dusk', 'dusk', 'night', 'night', 'night'])
  })
  it('se quedan quietas: se abren una vez y no hay nada que se repita', () => {
    const css = readFileSync(join(__dirname, 'wash.css'), 'utf8')
    expect(css).not.toMatch(/infinite|alternate/)
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    // los degradados solo como máscara
    for (const line of css.split('\n').filter((l) => l.includes('gradient('))) expect(line).toMatch(/mask-image/)
  })
  it('sin tonos violetas ni fríos vivos', () => {
    const css = readFileSync(join(__dirname, 'wash.css'), 'utf8')
    const hexes = css.match(/#[0-9a-f]{6}/gi) ?? []
    expect(hexes.length).toBeGreaterThanOrEqual(8)
    for (const h of hexes) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
      // ni azul dominante intenso ni morado (rojo y azul por encima del verde)
      expect(b - Math.max(r, g), h).toBeLessThan(40)
      expect(r > g + 20 && b > g + 20, h).toBe(false)
    }
  })
})
