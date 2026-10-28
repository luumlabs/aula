import { describe, expect, it } from 'vitest'
import { circleMeasures, shapeMeasures, solveTriangle, triangleVertices } from './geometry'

const one = (r: ReturnType<typeof solveTriangle>) => {
  if (!r.ok) throw new Error(r.error)
  return r.solutions[0]
}

describe('triángulos', () => {
  it('LLL: el 3-4-5 es rectángulo', () => {
    const t = one(solveTriangle('SSS', { a: 3, b: 4, c: 5 }))
    expect(t.C).toBeCloseTo(90, 9)
    expect(t.area).toBeCloseTo(6, 9)
    expect(t.byAngles).toBe('right')
    expect(t.bySides).toBe('scalene')
    expect(t.r).toBeCloseTo(1, 9)
    expect(t.R).toBeCloseTo(2.5, 9)
  })
  it('rechaza la desigualdad triangular', () => {
    expect(solveTriangle('SSS', { a: 1, b: 2, c: 3 })).toEqual({ ok: false, error: 'inequality' })
    expect(solveTriangle('SSS', { a: 1, b: 2 })).toEqual({ ok: false, error: 'missing' })
  })
  it('LAL, ALA y AAL', () => {
    const sas = one(solveTriangle('SAS', { b: 2, c: 2, A: 60 }))
    expect(sas.a).toBeCloseTo(2, 9)
    expect(sas.bySides).toBe('equilateral')
    const asa = one(solveTriangle('ASA', { B: 45, a: 10, C: 45 }))
    expect(asa.A).toBeCloseTo(90)
    expect(asa.b).toBeCloseTo(10 / Math.SQRT2, 9)
    const aas = one(solveTriangle('AAS', { A: 30, B: 60, a: 1 }))
    expect(aas.c).toBeCloseTo(2, 9)
    expect(solveTriangle('AAS', { A: 100, B: 90, a: 1 })).toEqual({ ok: false, error: 'angleSum' })
  })
  it('LLA: el caso ambiguo da 0, 1 o 2 triángulos', () => {
    const two = solveTriangle('SSA', { a: 6, b: 8, A: 35 })
    expect(two.ok && two.solutions.length).toBe(2)
    if (two.ok) {
      expect(two.solutions[0].B + two.solutions[1].B).toBeCloseTo(180, 9)
    }
    const oneSol = solveTriangle('SSA', { a: 10, b: 8, A: 35 })
    expect(oneSol.ok && oneSol.solutions.length).toBe(1)
    expect(solveTriangle('SSA', { a: 2, b: 8, A: 35 })).toEqual({ ok: false, error: 'noSolution' })
    const right = solveTriangle('SSA', { a: 4, b: 8, A: 30 })
    expect(right.ok && right.solutions.length).toBe(1)
    expect(right.ok && right.solutions[0].B).toBeCloseTo(90, 6)
  })
  it('coloca los vértices', () => {
    const t = one(solveTriangle('SSS', { a: 3, b: 4, c: 5 }))
    const v = triangleVertices(t)
    expect(Math.hypot(v.C[0] - v.B[0], v.C[1] - v.B[1])).toBeCloseTo(3, 9)
  })
})

describe('figuras y círculo', () => {
  it('áreas y perímetros', () => {
    expect(shapeMeasures('rectangle', { b: 3, h: 4 })?.area).toBe(12)
    expect(shapeMeasures('trapezoid', { B: 10, b: 4, h: 4 })?.perimeter).toBeCloseTo(24, 9)
    expect(shapeMeasures('polygon', { n: 6, l: 2 })?.area).toBeCloseTo(6 * Math.sqrt(3), 9)
    expect(shapeMeasures('ellipse', { a: 2, b: 2 })?.perimeter).toBeCloseTo(4 * Math.PI, 9)
    expect(shapeMeasures('square', { l: -1 })).toBeNull()
    expect(shapeMeasures('parallelogram', { b: 3, h: 5, s: 4 })).toBeNull()
  })
  it('sector y segmento', () => {
    const c = circleMeasures(2, 90)!
    expect(c.arc).toBeCloseTo(Math.PI, 9)
    expect(c.sector).toBeCloseTo(Math.PI, 9)
    expect(c.chord).toBeCloseTo(2 * Math.SQRT2, 9)
    expect(c.segment).toBeCloseTo(Math.PI - 2, 9)
    expect(circleMeasures(0, 10)).toBeNull()
  })
})
