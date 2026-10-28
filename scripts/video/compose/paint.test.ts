import { describe, expect, it } from 'vitest'
import { reach, splash, wipeLayout, wipeStrokes, wordStroke } from './paint.ts'

/** Distancia de un punto al eje de la pincelada. */
const near = (spine: { x: number; y: number }[], x: number, y: number) => Math.min(...spine.map((p) => Math.hypot(p.x - x, p.y - y)))

describe('pintura del vídeo', () => {
  it('el barrido: 3–5 pinceladas largas que cubren casi todo el cuadro (el resto lo completa el final) y salen iguales con la misma semilla', () => {
    const inside = (poly: { x: number; y: number }[], x: number, y: number) => {
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]
        const b = poly[j]
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c
      }
      return c
    }
    for (const [W, H, dir] of [[1920, 1080, 'right'], [1080, 1920, 'down'], [1080, 1920, 'left'], [1080, 1080, 'up']] as const) {
      const w = wipeStrokes(W, H, dir, 'x')
      expect(w.strokes.length).toBeGreaterThanOrEqual(3)
      expect(w.strokes.length).toBeLessThanOrEqual(5)
      let hit = 0
      let all = 0
      for (let y = H * 0.04; y < H; y += H / 24)
        for (let x = W * 0.04; x < W; x += W / 24) {
          all++
          if (w.strokes.some((s) => s.polys.some((p) => inside(p, x, y)))) hit++
        }
      expect(hit / all).toBeGreaterThan(0.9)
      expect(JSON.stringify(wipeStrokes(W, H, dir, 'x').strokes[0].polys)).toBe(JSON.stringify(w.strokes[0].polys))
      // cada trazo cruza el cuadro en la mitad del barrido (≥ 0,5 s con 2 pulsos), escalonados, y el último acaba en el
      // 70 % (después la pintura se levanta)
      for (const s of w.strokes) expect(s.span[1] - s.span[0]).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(Math.max(...w.strokes.map((s) => s.span[1]))).toBeLessThanOrEqual(0.7 + 1e-9)
    }
  })
  it('la primera pasada va hacia donde se pide; las proporciones dan 3 trazos en 16:9 y en vertical hacia abajo', () => {
    expect(wipeStrokes(1920, 1080, 'right', 's').strokes[0].dir).toEqual({ x: 1, y: 0 })
    expect(wipeStrokes(1920, 1080, 'left', 's').strokes[0].dir).toEqual({ x: -1, y: 0 })
    expect(wipeStrokes(1080, 1920, 'down', 's').strokes[0].dir).toEqual({ x: 0, y: 1 })
    expect(wipeLayout(1920, 1080).n).toBe(3)
    expect(wipeLayout(1920, 1080).n).toBe(wipeLayout(1920, 1080).n)
    expect(wipeLayout(1080, 1920).n).toBe(5)
  })
  it('el ritmo de la mano: de 0 a 1, sin volver atrás', () => {
    const s = wordStroke(100, 200, 300, 80, 'w')
    expect(reach(s, 0)).toBe(0)
    expect(reach(s, 1)).toBe(1)
    let last = 0
    for (let p = 0; p <= 1; p += 0.02) {
      const q = reach(s, p)
      expect(q).toBeGreaterThanOrEqual(last - 1e-9)
      last = q
    }
  })
  it('la pincelada de una palabra la tapa entera (de la primera a la última letra, a la altura de la letra)', () => {
    const s = wordStroke(100, 200, 300, 80, 'w')
    for (let x = 100; x <= 400; x += 25) {
      expect(near(s.spine, x, 200 - 80 * 0.7)).toBeLessThan(s.ink.reach / 2)
      expect(near(s.spine, x, 200 + 80 * 0.1)).toBeLessThan(s.ink.reach / 2)
    }
  })
  it('salpicadura con semilla: misma forma, gotas fuera de la mancha', () => {
    const a = splash(40, 'a')
    expect(JSON.stringify(splash(40, 'a'))).toBe(JSON.stringify(a))
    for (const d of a.drops) expect(Math.hypot(d.x, d.y)).toBeGreaterThan(40)
  })
})
