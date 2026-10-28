// Pruebas de la lógica de las gráficas: marcas, múltiplos de π, números, el adaptador de expresiones, el rango, los tramos
// (asíntotas y bordes del dominio) y el recorte de rectas. Portadas de ToolsFixTests, GraphDegreeModeTests y
// AuditPlotClippingTests de la app Swift.
import { describe, expect, it } from 'vitest'
import { makePlotCurve, makePlotSpec } from '@shared/schema/plot'
import { compileFn, evalNumber, parseExpr } from './evaluate'
import { clip, panRange, plotRange, saneParams, stableRange, trace, zoomRange } from './compile'
import { formatNumber, niceStep, numberTicks, piLabel, piStep, piText, piTicks, sane, ticks } from './ticks'

describe('marcas de los ejes', () => {
  it('elige pasos 1, 2, 5 × 10^k', () => {
    expect(niceStep(10, 5)).toBe(2)
    expect(niceStep(1, 4)).toBe(0.2)
    expect(niceStep(100, 4)).toBe(20)
    expect(niceStep(13, 4)).toBe(2)
    expect(niceStep(26, 4)).toBe(5)
    expect(niceStep(0, 4)).toBe(1)
    expect(niceStep(Number.NaN, 4)).toBe(1)
  })
  it('da múltiplos limpios del paso dentro del intervalo', () => {
    expect(ticks(-1, 1, 0.5)).toEqual([-1, -0.5, 0, 0.5, 1])
    expect(ticks(0.1, 0.35, 0.1)).toEqual([0.1, 0.2, 0.3])
    expect(ticks(0, -1, 1)).toEqual([])
    expect(ticks(0, 1e9, 1).length).toBe(400)
  })
  it('respeta un paso propio razonable y descarta uno diminuto', () => {
    expect(numberTicks(0, 10, 5, 'en', 2.5).map((t) => t.value)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(numberTicks(0, 10, 5, 'en', 0.001).map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10])
  })
})

describe('marcas en múltiplos de π', () => {
  it('elige el paso según el ancho', () => {
    expect(piStep(2 * Math.PI, 8)).toEqual({ numerator: 1, denominator: 4 })
    expect(piStep(2 * Math.PI, 4)).toEqual({ numerator: 1, denominator: 2 })
    expect(piStep(100, 4)).toEqual({ numerator: 8, denominator: 1 })
  })
  it('simplifica las fracciones', () => {
    expect(piLabel(0, 2)).toBe('0')
    expect(piLabel(2, 2)).toBe('\\pi')
    expect(piLabel(3, 2)).toBe('\\frac{3\\pi}{2}')
    expect(piLabel(-2, 4)).toBe('-\\frac{\\pi}{2}')
    expect(piText(3, 2)).toBe('3π/2')
    expect(piText(-4, 2)).toBe('−2π')
    expect(piText(1, 6)).toBe('π/6')
  })
  it('cubre [0, 2π] con marcas de π/2', () => {
    const t = piTicks(0, 2 * Math.PI, 4)
    expect(t.map((x) => x.label)).toEqual(['0', 'π/2', 'π', '3π/2', '2π'])
    expect(t[2].value).toBeCloseTo(Math.PI)
  })
})

describe('números', () => {
  it('usa el separador del idioma y el menos tipográfico', () => {
    expect(formatNumber(2.5, 'es')).toBe('2,5')
    expect(formatNumber(0.0005, 'es')).toBe('0,0005')
    expect(formatNumber(2.5, 'en')).toBe('2.5')
    expect(formatNumber(-3, 'en')).toBe('−3')
    expect(formatNumber(0, 'en')).toBe('0')
    expect(formatNumber(123456, 'en')).toBe('123,456')
  })
  it('pasa a notación científica fuera de [10⁻⁶, 10⁹)', () => {
    expect(formatNumber(2.5e9, 'en')).toContain('10⁹')
    expect(formatNumber(1.2e-7, 'en')).toContain('10⁻⁷')
    expect(formatNumber(1.5e-7, 'es')).not.toContain('.')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞')
  })
  it('deja intervalos seguros', () => {
    expect(sane(1, 1, [-1, 1])).toEqual([1, 2])
    expect(sane(Number.NaN, 1, [-1, 1])).toEqual([-1, 1])
    expect(sane(-1e308, 1e308, [-1, 1])).toEqual([-1e12, 1e12])
  })
})

describe('adaptador de expresiones', () => {
  it('evalúa funciones de x con multiplicación implícita y constantes', () => {
    const f = compileFn('2sin(3x - pi/2) + 1')!
    expect(f(0)).toBeCloseTo(2 * Math.sin(-Math.PI / 2) + 1)
    expect(f(1)).toBeCloseTo(2 * Math.sin(3 - Math.PI / 2) + 1)
  })
  it('devuelve null donde la función no está definida', () => {
    const f = compileFn('sqrt(x)')!
    expect(f(-1)).toBeNull()
    expect(f(4)).toBe(2)
    expect(compileFn('1/x')!(0)).toBeNull()
  })
  it('usa los parámetros y los nombres griegos', () => {
    const f = compileFn('a*sin(b*x)', 'x', { a: 2, b: 3 })!
    expect(f(0.5)).toBeCloseTo(2 * Math.sin(1.5))
    const r = compileFn('1 + cos(theta)', 'theta')!
    expect(r(Math.PI)).toBeCloseTo(0)
  })
  it('respeta los grados por curva y deja los números en radianes', () => {
    expect(compileFn('sin(x)', 'x', {}, { degrees: true })!(90)).toBeCloseTo(1)
    expect(compileFn('sin(x)')!(90)).toBeCloseTo(Math.sin(90))
    expect(evalNumber('asin(1/2)')).toBeCloseTo(Math.PI / 6)
    expect(evalNumber('90°')).toBeCloseTo(Math.PI / 2)
  })
  it('lee números escritos como expresiones', () => {
    expect(evalNumber('pi/2')).toBeCloseTo(Math.PI / 2)
    expect(evalNumber('sqrt(3)/2')).toBeCloseTo(Math.sqrt(3) / 2)
    expect(evalNumber('2k', { k: 3 })).toBe(6)
    expect(evalNumber('')).toBeUndefined()
    expect(evalNumber('2 +')).toBeUndefined()
    expect(parseExpr('((')).toBeNull()
  })
})

describe('rango de la gráfica', () => {
  it('encuadra la curva cuando falta el rango de y', () => {
    const r = plotRange(makePlotSpec({ xMin: 0, xMax: 1, curves: [makePlotCurve({ expr: 'asin(1/2)' })] }))
    expect((r.yMin + r.yMax) / 2).toBeCloseTo(Math.PI / 6, 6)
  })
  it('los grados de una curva no afectan a las demás', () => {
    const r = plotRange(makePlotSpec({ xMin: 0, xMax: 1, curves: [makePlotCurve({ expr: 'asin(1/2)', degrees: true }), makePlotCurve({ expr: 'asin(1/2)' })] }))
    expect(r.yMin).toBeLessThan(Math.PI / 6)
    expect(r.yMax).toBeGreaterThan(30)
  })
  it('usa [−2π, 2π] por defecto con marcas de π e ignora las asíntotas', () => {
    const r = plotRange(makePlotSpec({ xPi: true, curves: [makePlotCurve({ expr: 'tan(x)' })] }))
    expect(r.xMin).toBeCloseTo(-2 * Math.PI)
    expect(r.yMax).toBeLessThan(1e4)
  })
  it('explore: el rango contiene los extremos de los parámetros', () => {
    const spec = makePlotSpec({ xMin: -3, xMax: 3, curves: [makePlotCurve({ expr: 'a*x' })] })
    const params = saneParams([{ name: 'a', min: -2, max: 2, step: 0.5, value: 1 }])
    const r = stableRange(spec, params)
    expect(r.yMax).toBeGreaterThanOrEqual(5.9)
    expect(r.yMin).toBeLessThanOrEqual(-5.9)
  })
  it('sanea los deslizadores', () => {
    const [p] = saneParams([{ name: 'k', min: 5, max: -5, step: 0, value: 99 }, { name: 'k', min: 0, max: 1, step: 1, value: 0 }])
    expect(p).toMatchObject({ min: -5, max: 5, value: 5 })
    expect(p.step).toBeGreaterThan(0)
    expect(saneParams([{ name: 'k', min: 0, max: 1, step: 1, value: 0 }, { name: 'k', min: 0, max: 1, step: 1, value: 0 }]).length).toBe(1)
  })
  it('acerca y desplaza alrededor de un punto', () => {
    const r = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }
    const z = zoomRange(r, 0.5, 0, 0)
    expect(z).toEqual({ xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 })
    expect(panRange(r, 1, -1)).toEqual({ xMin: -4, xMax: 6, yMin: -6, yMax: 4 })
  })
})

describe('tramos de una función', () => {
  it('la tangente no dibuja rayas verticales falsas', () => {
    const segs = trace((x) => {
      const y = Math.tan(x)
      return Number.isFinite(y) ? y : null
    }, -60, 60, 960, -45, 45)
    for (const s of segs) for (let i = 1; i < s.length; i++) expect((s[i - 1].y > 5 && s[i].y < -5) || (s[i - 1].y < -5 && s[i].y > 5)).toBe(false)
    expect(segs.length).toBeGreaterThanOrEqual(Math.round(120 / Math.PI))
  })
  it('afina los bordes del dominio', () => {
    const ln = trace((x) => (x > 0 ? Math.log(x) : null), -8, 8, 960, -5.7, 5.7)
    expect(ln.length).toBe(1)
    expect(ln[0][0].y).toBeLessThan(-10)
    const sq = trace((x) => (x >= 0 ? Math.sqrt(x) : null), -8, 8, 961, -5, 5)
    expect(sq.length).toBe(1)
    expect(sq[0][0].x).toBeLessThan(1e-6)
    expect(trace((x) => (x === 0 ? null : 1 / x), -8, 8, 960, -5, 5).length).toBe(2)
  })
  it('no corta curvas continuas empinadas u oscilantes', () => {
    expect(trace((x) => 50 * x, -8, 8, 960, -5, 5).length).toBe(1)
    expect(trace(Math.sin, -300, 300, 400, -1.2, 1.2).length).toBe(1)
  })
})

describe('recorte de rectas', () => {
  const view = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }
  it('una recta con puntos lejanos atraviesa la vista de esquina a esquina', () => {
    const t = clip(100, 100, 1, 1, view)!
    expect(100 + t[0]).toBeCloseTo(-5)
    expect(100 + t[1]).toBeCloseTo(5)
  })
  it('una semirrecta que se aleja no se dibuja', () => {
    expect(clip(100, 100, 1, 1, view, 0)).toBeNull()
    const toward = clip(100, 100, -1, -1, view, 0)!
    expect(100 - toward[0]).toBeCloseTo(5)
  })
  it('un trazo sin dirección no corta nada', () => {
    expect(clip(0, 0, 0, 0, view)).toBeNull()
  })
})
