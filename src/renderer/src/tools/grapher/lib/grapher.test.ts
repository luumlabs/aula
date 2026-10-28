import { describe, expect, it } from 'vitest'
import { derivative } from '@engine/math/algebra/derivative'
import { compileFn, sampleFx, sampleParam, toClosure } from './compile'
import { notablePoints, roots } from './notable'
import { defaultViewport, panned, rangeOf, toScreen, toWorld, zoomed } from './viewport'

describe('compileFn', () => {
  it('lee y = …, f(x) = … y detecta los parámetros', () => {
    const c = compileFn('fx', 'y = a*sin(b*x)')
    expect(c.error).toBeNull()
    expect(c.params).toEqual(['a', 'b'])
    expect(compileFn('fx', 'f(x) = x^2').params).toEqual([])
  })
  it('reconoce rectas verticales y pide despejar y', () => {
    expect(compileFn('fx', 'x = 2').kind).toBe('vertical')
    expect(compileFn('fx', 'x + y = 2').error?.key).toBe('rightSide')
    expect(compileFn('fx', 'x^2 + y').error?.key).toBe('solveY')
  })
  it('analiza paramétricas y polares', () => {
    const p = compileFn('param', 'cos(t)', 'sin(t)')
    expect(p.exprs).toHaveLength(2)
    expect(compileFn('param', 'cos(t)', '').error?.key).toBe('paramBoth')
    const r = compileFn('polar', 'r = 1 + cos(theta)')
    expect(r.error).toBeNull()
    expect(r.params).toEqual([])
  })
  it('limita los parámetros a cuatro', () => {
    expect(compileFn('fx', 'a+b+c+d+k*x').error?.key).toBe('tooMany')
  })
  it('vacío no es un error', () => {
    expect(compileFn('fx', '   ').empty).toBe(true)
  })
})

describe('toClosure', () => {
  it('evalúa rápido y da NaN fuera del dominio', () => {
    const c = compileFn('fx', 'sqrt(x) + a')
    const f = toClosure(c.exprs[0])
    expect(f({ x: 4, a: 1 })).toBe(3)
    expect(f({ x: -1, a: 1 })).toBeNaN()
    expect(toClosure(compileFn('fx', '1/x').exprs[0])({ x: 0 })).toBeNaN()
    expect(toClosure(compileFn('fx', 'x^(1/3)').exprs[0])({ x: -8 })).toBeCloseTo(-2)
  })
})

describe('muestreo', () => {
  const range = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }
  it('corta en las asíntotas', () => {
    const segs = sampleFx((x) => 1 / x, range, 200)
    expect(segs.length).toBe(2)
  })
  it('una curva cerrada es un solo trozo', () => {
    const segs = sampleParam(Math.cos, Math.sin, 0, 2 * Math.PI, 100, range)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toHaveLength(101)
  })
})

describe('puntos notables', () => {
  it('encuentra raíces, extremos y cortes de una parábola', () => {
    const c = compileFn('fx', 'x^2 - 2x - 3')
    const f = toClosure(c.exprs[0])
    const d = derivative(c.exprs[0], 'x')
    const df = d ? toClosure(d) : null
    const pts = notablePoints((x) => f({ x }), df ? (x) => df({ x }) : null, [{ name: 'g', g: (x) => x + 1 }], { xMin: -8, xMax: 8, yMin: -6, yMax: 6 })
    const rs = pts.filter((p) => p.kind === 'root').map((p) => p.x)
    expect(rs[0]).toBeCloseTo(-1, 6)
    expect(rs[1]).toBeCloseTo(3, 6)
    const min = pts.find((p) => p.kind === 'minimum')
    expect(min?.x).toBeCloseTo(1, 6)
    expect(min?.y).toBeCloseTo(-4, 6)
    expect(pts.find((p) => p.kind === 'yIntercept')?.y).toBe(-3)
    expect(pts.filter((p) => p.kind === 'intersection')).toHaveLength(2)
  })
  it('no confunde una asíntota con una raíz y ve la tangencia', () => {
    expect(roots((x) => 1 / x, -2, 2, 4)).toEqual([])
    const r = roots((x) => x * x, -2, 2, 4)
    expect(r).toHaveLength(1)
    expect(r[0]).toBeCloseTo(0, 4)
  })
})

describe('viewport', () => {
  it('ida y vuelta entre pantalla y gráfica', () => {
    const v = defaultViewport(800)
    const [x, y] = toWorld(v, 800, 600, 600, 100)
    const [px, py] = toScreen(v, 800, 600, x, y)
    expect(px).toBeCloseTo(600)
    expect(py).toBeCloseTo(100)
    expect(rangeOf(v, 800, 600).xMax).toBeCloseTo(8)
  })
  it('el zoom deja quieto el ancla y el arrastre mueve el centro', () => {
    const v = zoomed(defaultViewport(800), 0.5, [4, 0])
    expect(toWorld(v, 800, 600, 600, 300)[0]).toBeCloseTo(4)
    expect(rangeOf(v, 800, 600).xMax).toBeCloseTo(6)
    expect(panned(defaultViewport(800), 100, 0).cx).toBeCloseTo(-2)
  })
})

import { niceValue } from './nice'

describe('niceValue', () => {
  it('da formas exactas', () => {
    expect(niceValue(3.0000000001, false).tex).toBe('3')
    expect(niceValue(-0.5, false).tex).toBe('-\\frac{1}{2}')
    expect(niceValue(Math.PI / 2, false).tex).toBe('\\frac{\\pi}{2}')
    expect(niceValue(Math.sqrt(3), false).tex).toBe('\\sqrt{3}')
  })
  it('o el decimal con coma', () => {
    expect(niceValue(1.23456789, true).plain).toBe('1,2346')
    expect(niceValue(1.23456789, true).tex).toBe('1{,}2346')
  })
})
