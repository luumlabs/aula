import { describe, expect, it } from 'vitest'
import { SimulationPresets } from '@shared/schema/simulationPresets'
import { makeSimObject, makeSimParam, makeSimTime, makeSimulation } from '@shared/schema/visual'
import { SimulationClock, SimulationEngine, decimalsFor, formatSimValue, saneParams, simKey, snapToStep } from './simulation'
import { chooseTrace, isTimePlot, niceStep, simulationRange, ticks } from './simPlot'

const preset = (name: string): SimulationEngine => new SimulationEngine(SimulationPresets.make(name)!)

describe('SimulationEngine', () => {
  it('calcula las magnitudes del tiro parabólico', () => {
    const e = preset('projectile')
    const env = e.environment(e.initialParams, 0)
    // v0 = 25, 45°, h0 = 0 → T = 2·v0·sin45/g, R = v0²/g
    expect(env.T).toBeCloseTo((2 * 25 * Math.sin(Math.PI / 4)) / 9.81, 6)
    expect(env.R).toBeCloseTo((25 * 25) / 9.81, 4)
    expect(env.H).toBeCloseTo((25 * 25) / (4 * 9.81), 4)
  })

  it('usa nombres de varias letras y letras griegas (theta, lambda, tau)', () => {
    const e = preset('wave')
    const env = e.environment({ A: 1, lambda: 4, f: 0.5 }, 0)
    expect(env[simKey('lambda')]).toBe(4)
    expect(env.v).toBeCloseTo(2)
    const rc = preset('rc')
    const r = rc.environment(rc.initialParams, 2)
    expect(r[simKey('tau')]).toBeCloseTo(2) // 10 kΩ · 200 µF / 1000
    expect(r.Vc).toBeCloseTo(9 * (1 - Math.exp(-1)), 6)
  })

  it('el reloj del proyectil termina en el tiempo de vuelo', () => {
    const e = preset('projectile')
    const [lo, hi] = e.timeBounds(e.initialParams)!
    expect(lo).toBe(0)
    expect(hi).toBeCloseTo((2 * 25 * Math.sin(Math.PI / 4)) / 9.81, 6)
  })

  it('resuelve los objetos del instante: punto, rastro y vector', () => {
    const e = preset('projectile')
    const objs = e.resolve(e.initialParams, 1)
    const point = objs.find((o) => o.kind === 'point')
    expect(point).toBeDefined()
    if (point?.kind === 'point') {
      const vx = 25 * Math.cos(Math.PI / 4)
      expect(point.x).toBeCloseTo(vx, 6)
      expect(point.y).toBeCloseTo(vx - 9.81 / 2, 6)
    }
    expect(objs.some((o) => o.kind === 'polyline' && o.trail)).toBe(true)
    expect(objs.some((o) => o.kind === 'segment' && o.arrow)).toBe(true)
    // en el primer instante no hay rastro
    expect(e.resolve(e.initialParams, 0).some((o) => o.kind === 'polyline' && o.trail)).toBe(false)
  })

  it('el péndulo oscila con su periodo', () => {
    const e = preset('pendulum')
    const p = e.initialParams
    const T = e.environment(p, 0).T
    const at = (t: number) => e.resolve(p, t).filter((o) => o.kind === 'point')[0]
    const a = at(0), b = at(T)
    if (a.kind === 'point' && b.kind === 'point') {
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.y).toBeCloseTo(a.y, 6)
    }
  })

  it('todas las simulaciones de la biblioteca calculan sus magnitudes y objetos', () => {
    for (const name of SimulationPresets.names) {
      const e = preset(name)
      const env = e.environment(e.initialParams, undefined)
      for (const d of e.block.derived) expect(Number.isFinite(env[simKey(d.name)]), `${name}.${d.name}`).toBe(true)
      expect(e.resolve(e.initialParams, undefined).length, name).toBeGreaterThan(0)
      const r = simulationRange(e, e.initialParams)
      expect(r.xMax > r.xMin && r.yMax > r.yMin, name).toBe(true)
    }
  })

  it('ignora lo que no se puede calcular', () => {
    const b = makeSimulation({ params: [makeSimParam('a', undefined, 0, 1, 0.1, 0.5)], objects: [makeSimObject('point', { x: 'sqrt(-1-a)', y: '1' }), makeSimObject('point', { x: 'a', y: '2*' })] })
    const e = new SimulationEngine(b)
    expect(e.resolve(e.initialParams, undefined)).toEqual([])
    expect(e.value('1/0', {})).toBeUndefined()
  })

  it('el reloj empieza en su límite inferior', () => {
    const b = makeSimulation({ time: makeSimTime({ min: '2', max: '5' }), params: [] })
    const e = new SimulationEngine(b)
    const [lo] = e.timeBounds({})!
    expect(SimulationClock.initial(lo)).toBe(2)
    expect(e.environment({}, undefined).t).toBe(2)
  })
})

describe('SimulationClock', () => {
  it('avanza, da la vuelta y se para al final', () => {
    expect(SimulationClock.time(0, 2, 1, 0, 10, true)).toBe(2)
    expect(SimulationClock.time(0, 12, 1, 0, 10, true)).toBeCloseTo(2)
    expect(SimulationClock.time(0, 12, 1, 0, 10, false)).toBe(10)
    expect(SimulationClock.time(4, 1, 2, 0, 10, false)).toBe(6)
  })
  it('recorta un inicio fuera del intervalo y aguanta valores absurdos', () => {
    expect(SimulationClock.time(20, 0, 1, 0, 10, true)).toBe(10)
    expect(SimulationClock.time(-5, 0, 1, 0, 10, true)).toBe(0)
    expect(SimulationClock.time(Number.NaN, 1, 1, 0, 10, true)).toBe(0)
    expect(SimulationClock.time(0, 1, 1, 5, 5, true)).toBe(5)
  })
})

describe('formato y deslizadores', () => {
  it('escribe las magnitudes con coma decimal y sin ceros sobrantes', () => {
    expect(formatSimValue(3.5, undefined)).toBe('3,5')
    expect(formatSimValue(2, 2)).toBe('2,00')
    expect(formatSimValue(-0.25, undefined, '.')).toBe('−0.25')
    expect(formatSimValue(Number.NaN, 1)).toBe('—')
  })
  it('cuenta los decimales de la rejilla', () => {
    expect(decimalsFor(0.25)).toBe(2)
    expect(decimalsFor(2.5)).toBe(1)
    expect(decimalsFor(5)).toBe(0)
  })
  it('arregla deslizadores imposibles y ajusta a la rejilla', () => {
    const [p] = saneParams([makeSimParam('k', undefined, 10, 1, -1, 50)])
    expect(p.min).toBe(1)
    expect(p.max).toBe(10)
    expect(p.step).toBeGreaterThan(0)
    expect(p.value).toBe(10)
    expect(snapToStep(0.33, makeSimParam('a', undefined, 0, 1, 0.1, 0))).toBeCloseTo(0.3)
  })
})

describe('gráfica', () => {
  it('pasos y marcas bonitas', () => {
    expect(niceStep(10, 5)).toBe(2)
    expect(niceStep(200, 5)).toBe(50)
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
  })
  it('distingue gráficas contra el tiempo y elige qué registrar', () => {
    expect(isTimePlot(preset('spring'))).toBe(true)
    expect(isTimePlot(preset('projectile'))).toBe(false)
    const pend = preset('pendulum')
    expect(chooseTrace(pend, pend.initialParams)?.point?.axis).toBe('x')
    const proj = preset('projectile')
    expect(chooseTrace(proj, proj.initialParams)?.point?.axis).toBe('y')
  })
  it('el rango de la farmacocinética incluye las líneas tóxica y eficaz', () => {
    const e = preset('pharmacokinetics')
    const r = simulationRange(e, e.initialParams)
    expect(r.yMin).toBe(0)
    expect(r.yMax).toBeGreaterThan(40)
  })
})
