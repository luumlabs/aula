import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archLightFor, leanFrom } from './InkArt'
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
  it('el arco vivo solo se mueve con el ratón encima, despacio y sin bucles, y nunca con «Reducir movimiento»', () => {
    // todo lo que cambia cuelga de `data-live`; fuera de ahí, las láminas no llevan ni subida ni aumento
    const live = css.match(/[^{}]*\{[^{}]*--(?:grow|rise):[^{}]*\}/g) ?? []
    expect(live.length).toBeGreaterThanOrEqual(5)
    for (const rule of live) expect(rule, rule).toMatch(/\[data-live\]/)
    // cámara lenta: transiciones de más de dos segundos, solo de `transform`
    const ms = [...css.matchAll(/transition(?:-duration)?:[^;]*?(\d+)ms/g)].map((m) => Number(m[1]))
    expect(ms.length).toBeGreaterThanOrEqual(2)
    for (const d of ms) expect(d).toBeGreaterThanOrEqual(2000)
    expect(css).toMatch(/\.reduce-motion \.ink-live > \.ink-live-layer \{ transition: none; transform: none; \}/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^@]*\.ink-live > \.ink-live-layer \{ transition: none; transform: none; \}/)
  })
  it('el puntero inclina el dibujo de -1 a 1, sin salirse', () => {
    const box = { left: 100, top: 50, width: 200, height: 100 }
    expect(leanFrom(box, 200, 100)).toEqual({ x: 0, y: 0 })
    expect(leanFrom(box, 100, 50)).toEqual({ x: -1, y: -1 })
    expect(leanFrom(box, 300, 150)).toEqual({ x: 1, y: 1 })
    expect(leanFrom(box, 250, 75)).toEqual({ x: 0.5, y: -0.5 })
    expect(leanFrom(box, 900, -900)).toEqual({ x: 1, y: -1 })
    expect(leanFrom({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ x: 0, y: 0 })
  })
  it('sin tonos violetas, en claro ni en oscuro', () => {
    const hexes = css.match(/#[0-9a-f]{6}/gi) ?? []
    expect(hexes.length).toBeGreaterThanOrEqual(20)
    for (const h of hexes) expect(isViolet(h), h).toBe(false)
  })
})
