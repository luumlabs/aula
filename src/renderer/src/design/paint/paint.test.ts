import { describe, expect, it } from 'vitest'
import { gauss, rngFrom, seedOf } from './random'
import { createNoise, fbmField } from './noise'
import { area, deform, ellipse, superellipse } from './shapes'
import { brushOutline, dryBrush, handLoop, handRoundRect, pathLength, pressureProfile, resample, toPathData } from './brush'
import { markPaths } from './markPaths'
import { arrowInk, borderInk, burstInk, checkInk, coverLineInk, handPace, raysInk, ringInk, strikeInk, tileInk, underlineInk } from './drawings'

describe('azar con semilla', () => {
  it('la misma semilla da siempre la misma serie (mismo dibujo en cada arranque)', () => {
    const a = rngFrom(seedOf('curso-1'))
    const b = rngFrom(seedOf('curso-1'))
    const xs = Array.from({ length: 50 }, () => a())
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })
  it('semillas distintas, series distintas', () => {
    expect(rngFrom(seedOf('a'))()).not.toBe(rngFrom(seedOf('b'))())
  })
  it('la normal queda acotada a ±3σ', () => {
    const r = rngFrom(7)
    for (let i = 0; i < 2000; i++) expect(Math.abs(gauss(r))).toBeLessThanOrEqual(3)
  })
})

describe('ruido', () => {
  it('se queda en [0, 1] y es estable', () => {
    const n = createNoise(42)
    const m = createNoise(42)
    for (let i = 0; i < 300; i++) {
      const x = i * 0.731
      const y = i * 0.377
      const v = n.fbm(x, y)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(m.fbm(x, y)).toBe(v)
      expect(n.hash(i, i * 3)).toBe(m.hash(i, i * 3))
    }
  })
  it('el campo interpolado cubre todo el lienzo', () => {
    const f = fbmField(createNoise(3), 37, 21, 10)
    expect(f.length).toBe(37 * 21)
    expect(f.every((v) => v >= 0 && v <= 1)).toBe(true)
  })
})

describe('siluetas', () => {
  const r = () => rngFrom(9)
  it('deformar multiplica los vértices y no destroza la forma', () => {
    const base = ellipse(100, 100, 60, 40, 10, r())
    const d = deform(base, 3, r())
    expect(d.length).toBe(10 * 8)
    const ratio = Math.abs(area(d)) / Math.abs(area(base))
    expect(ratio).toBeGreaterThan(0.7)
    expect(ratio).toBeLessThan(1.4)
  })
  it('la losa es un polígono cerrado con área (más que un círculo del mismo radio)', () => {
    expect(Math.abs(area(superellipse(50, 50, 40, 40, 4, 16, r(), [0.01, 0.03])))).toBeGreaterThan(Math.PI * 40 * 40)
  })
})

describe('pincel', () => {
  const noise = createNoise(5)
  const line = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }))
  it('remuestrea a pasos iguales', () => {
    const r = resample(line, 2.5)
    expect(r.length).toBe(41)
    for (let i = 1; i < r.length; i++) expect(Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y)).toBeCloseTo(2.5, 5)
  })
  it('la pincelada es más ancha donde aprieta la mano y se afila al levantarse', () => {
    const { outline, spine } = brushOutline(line, { width: 8, pressure: pressureProfile(0.6, 0.05, 0.6, 0.1), tremor: 0, tremorScale: 30, jitter: 0 }, noise)
    expect(outline.length).toBeGreaterThan(spine.c.length * 2)
    const mid = spine.w[Math.floor(spine.w.length * 0.4)]
    expect(mid).toBeCloseTo(8, 5)
    expect(spine.w[0]).toBeLessThan(mid)
    expect(spine.w[spine.w.length - 1]).toBeLessThan(mid * 0.2)
  })
  it('el círculo a mano da algo más de una vuelta y no cierra donde empezó', () => {
    const loop = handLoop(50, 50, 20, 18, rngFrom(3), 1.1)
    expect(pathLength(loop)).toBeGreaterThan(2 * Math.PI * 18 * 1.05)
    expect(Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].y - loop[loop.length - 1].y)).toBeGreaterThan(0.5)
  })
  it('el contorno a mano rodea la losa y se pasa un poco al cerrar', () => {
    const p = handRoundRect(0, 0, 100, 60, 12, rngFrom(4), 0.05)
    const perimeter = 2 * (100 + 60) - (8 - 2 * Math.PI) * 12
    expect(pathLength(p)).toBeGreaterThan(perimeter * 1.02)
    expect(p.every((q) => q.x > -3 && q.x < 103 && q.y > -3 && q.y < 63)).toBe(true)
  })
  it('el pincel seco se abre en hebras', () => {
    const polys = dryBrush(line, { width: 6, pressure: pressureProfile(), tremor: 0.2, tremorScale: 20, jitter: 0.05, step: 0.5 }, noise, rngFrom(8), 0.75, 4)
    expect(polys.length).toBe(5)
    expect(toPathData(polys).match(/M/g)?.length).toBe(5)
  })
})

describe('la marca a pincel', () => {
  it('es la misma en cada arranque y trae arco, horizonte, sol y puerta', () => {
    const a = markPaths(2.5)
    const b = markPaths(2.5)
    expect(b).toBe(a)
    for (const d of [a.arch, a.horizon, a.sun, a.door]) expect(d).toMatch(/^M[\d.\- ]+/)
    expect(a.arch).not.toMatch(/NaN|Infinity/)
  })
  it('sin conexión, el arco va partido en dos trazos', () => {
    const whole = markPaths(2.5).arch.match(/M/g)?.length ?? 0
    const gap = markPaths(2.5, true).arch.match(/M/g)?.length ?? 0
    expect(gap).toBe(whole + 1)
  })
  it('el arco se queda dentro del dibujo (sin salirse del viewBox)', () => {
    const nums = markPaths(2.9).arch.match(/-?\d+\.\d+/g)!.map(Number)
    expect(Math.min(...nums)).toBeGreaterThan(1.5)
    expect(Math.max(...nums)).toBeLessThan(23)
  })
})

describe('dibujos a mano (vectores que se dibujan)', () => {
  it('el ritmo de la mano avanza siempre y frena en las esquinas', () => {
    const corner = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
    const pace = handPace(corner, 20)
    expect(pace[0]).toEqual([0, 0])
    expect(pace[pace.length - 1]).toEqual([1, 1])
    for (let i = 1; i < pace.length; i++) {
      expect(pace[i][0]).toBeGreaterThanOrEqual(pace[i - 1][0])
      expect(pace[i][1]).toBeGreaterThanOrEqual(pace[i - 1][1])
    }
    // a mitad de recorrido (la esquina) se tarda más que en un tramo recto igual de largo
    const straight = handPace([{ x: 0, y: 0 }, { x: 200, y: 0 }], 20)
    const at = (p: [number, number][], q: number) => p.find(([, r]) => r >= q)![0]
    expect(at(pace, 0.6) - at(pace, 0.4)).toBeGreaterThan(at(straight, 0.6) - at(straight, 0.4))
  })
  it('cada dibujo es el mismo con la misma semilla y trae silueta, eje y ritmo', () => {
    const a = underlineInk(300, 14, 'x')
    expect(underlineInk(300, 14, 'x')).toBe(a)
    expect(a.strokes.length).toBe(1)
    const s = a.strokes[0]
    expect(s.d).toMatch(/^M/)
    expect(s.spine).toMatch(/^M/)
    expect(s.dry.length).toBeGreaterThan(0)
    expect(s.ms).toBeGreaterThanOrEqual(220)
    expect(a.ms).toBe(s.at + s.ms)
  })
  it('el borde de una tarjeta son dos trazos, uno detrás del otro', () => {
    const b = borderInk(300, 200, 22, 1.3, 'card')
    expect(b.strokes.length).toBe(2)
    expect(b.strokes[1].at).toBeGreaterThanOrEqual(b.strokes[0].ms)
  })
  it('las rayitas de alegría salen una tras otra; los rayos a lápiz repasan alguno', () => {
    const burst = burstInk(96, 96, 'logro', 6)
    expect(burst.strokes.length).toBe(6)
    for (let i = 1; i < 6; i++) expect(burst.strokes[i].at).toBeGreaterThan(burst.strokes[i - 1].at)
    expect(raysInk(106, 106, 'vacío', 53, 70, 5).strokes.length).toBe(6)
  })
  it('la flecha: el cuerpo y luego las dos alas de la punta', () => {
    const a = arrowInk(96, 64, 'flecha', { x: 88, y: 6 }, { x: 10, y: 44 })
    expect(a.strokes.length).toBe(3)
    expect(a.strokes[1].at).toBeGreaterThanOrEqual(a.strokes[0].ms)
  })
  it('nada de NaN en los caminos', () => {
    for (const d of [ringInk(32, 'hoy'), strikeInk(180, 22, 't'), checkInk(20, 'k'), tileInk(84, 27, 1.8, 'tile'), coverLineInk(270, 104, 'curso')])
      for (const s of d.strokes) expect(s.d + s.spine + s.dry).not.toMatch(/NaN|Infinity/)
  })
})

describe('la marca hierve', () => {
  it('cada dibujo del «line boil» es el mismo gesto con otro temblor', () => {
    const a = markPaths(2.3, false, 0)
    const b = markPaths(2.3, false, 1)
    expect(b.arch).not.toBe(a.arch)
    expect(b.sun).toBe(a.sun)
    expect(b.door).toBe(a.door)
    expect(a.archPace.length).toBe(1)
    expect(a.horizonPace[a.horizonPace.length - 1]).toEqual([1, 1])
  })
})
