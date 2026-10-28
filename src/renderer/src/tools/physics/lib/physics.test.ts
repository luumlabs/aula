import { describe, expect, it } from 'vitest'
import { collide, ellipticK, pendulumDeriv, pendulumPeriod, projectile, rk4, springDeriv, springInfo, waveInfo, waveY, willCollide } from './physics'

describe('tiro parabólico', () => {
  it('a 45° desde el suelo da el alcance máximo v²/g', () => {
    const p = projectile(20, 45, 9.8)
    expect(p.range).toBeCloseTo(400 / 9.8, 9)
    expect(p.maxHeight).toBeCloseTo(p.range / 4, 9)
    expect(p.at(p.flightTime).y).toBeCloseTo(0, 9)
  })
  it('desde una altura vuela más', () => {
    expect(projectile(10, 0, 9.8, 20).flightTime).toBeCloseTo(Math.sqrt(40 / 9.8), 9)
  })
})

describe('integración', () => {
  it('RK4 conserva la energía del muelle sin rozamiento', () => {
    const f = springDeriv(4, 1, 0)
    let y = [1, 0]
    for (let i = 0; i < 1000; i++) y = rk4(f, y, i * 0.01, 0.01)
    const e = 0.5 * 4 * y[0] ** 2 + 0.5 * y[1] ** 2
    expect(e).toBeCloseTo(2, 6)
  })
  it('el péndulo vuelve a su amplitud tras un periodo exacto', () => {
    const { exact, small } = pendulumPeriod(1, 9.8, 60)
    expect(exact).toBeGreaterThan(small)
    const f = pendulumDeriv(9.8, 1, 0)
    let y = [Math.PI / 3, 0]
    const n = 2000
    for (let i = 0; i < n; i++) y = rk4(f, y, 0, exact / n)
    expect(y[0]).toBeCloseTo(Math.PI / 3, 5)
  })
  it('K(0) = π/2', () => {
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 12)
  })
  it('clasifica el amortiguamiento', () => {
    expect(springInfo(4, 1, 4).regime).toBe('critical')
    expect(springInfo(4, 1, 1).regime).toBe('under')
    expect(springInfo(4, 1, 10).regime).toBe('over')
    expect(springInfo(4, 1, 0).period).toBeCloseTo(Math.PI, 12)
  })
})

describe('ondas y choques', () => {
  it('v = λ·f y la estacionaria tiene nodos', () => {
    expect(waveInfo(2, 3).speed).toBe(6)
    expect(waveY(0, 0.37, 1, 2, 1, true)).toBeCloseTo(0, 12)
    expect(waveY(1, 0.21, 1, 2, 1, true)).toBeCloseTo(0, 12)
  })
  it('el choque elástico de masas iguales intercambia velocidades', () => {
    const c = collide(1, 2, 1, 0, 1)
    expect(c.v1).toBeCloseTo(0)
    expect(c.v2).toBeCloseTo(2)
    expect(c.keAfter).toBeCloseTo(c.keBefore)
  })
  it('el perfectamente inelástico conserva el momento y pierde energía', () => {
    const c = collide(2, 3, 1, 0, 0)
    expect(c.v1).toBeCloseTo(2)
    expect(c.v2).toBeCloseTo(2)
    expect(c.pAfter).toBeCloseTo(c.pBefore)
    expect(c.keAfter).toBeLessThan(c.keBefore)
    expect(willCollide(1, 2)).toBe(false)
  })
})
