// Pruebas de las escalas de los gráficos y de la línea de tiempo.
import { describe, expect, it } from 'vitest'
import { arcPath, bands, categoryLabels, foldSlices, isCategoricalX, niceDomain, pieSlices, safeSeries, smoothPath, valueExtent, xExtent } from './scale'
import { axisTicks, isProportional, lanes, periodItems, periodLanes, timelineItems, timelineSpan } from '../timeline/layout'

describe('datos de los gráficos', () => {
  it('nombres únicos y valores acotados', () => {
    const s = safeSeries([
      { name: 'A', points: [{ y: Number.POSITIVE_INFINITY }, { y: 1e20 }] },
      { name: 'A', points: [{ y: 1 }] }
    ])
    expect(s.map((x) => x.name)).toEqual(['A', 'A (2)'])
    expect(s[0].points.map((p) => p.y)).toEqual([0, 1e12])
  })
  it('detecta el eje de categorías', () => {
    expect(isCategoricalX([{ name: 's', points: [{ label: 'Ene', y: 1 }] }])).toBe(true)
    expect(isCategoricalX([{ name: 's', points: [{ label: 'a', x: 1, y: 1 }] }])).toBe(false)
    expect(isCategoricalX([{ name: 's', points: [{ y: 5 }] }])).toBe(false)
    expect(categoryLabels([{ name: 's', points: [{ y: 1 }, { label: 'B', y: 2 }] }])).toEqual(['1', 'B'])
  })
  it('dominio con marcas limpias que incluye el cero', () => {
    const d = niceDomain(3, 87, 5)
    expect(d.lo).toBe(0)
    expect(d.hi).toBe(100)
    expect(d.ticks).toEqual([0, 20, 40, 60, 80, 100])
    const neg = niceDomain(-12, 30, 4)
    expect(neg.lo).toBeLessThanOrEqual(-12)
    expect(neg.ticks).toContain(0)
    const flat = niceDomain(0, 0, 4)
    expect(flat.hi).toBeGreaterThan(flat.lo)
    const free = niceDomain(98, 102, 4, false)
    expect(free.lo).toBeGreaterThan(90)
  })
  it('apila positivos y negativos por separado', () => {
    const series = [
      { name: 'a', points: [{ y: 3 }, { y: -2 }] },
      { name: 'b', points: [{ y: 4 }, { y: -1 }] }
    ]
    expect(valueExtent(series, true)).toEqual([-3, 7])
    expect(valueExtent(series, false)).toEqual([-2, 4])
    expect(xExtent([{ name: 'a', points: [{ y: 1, x: 5 }] }])).toEqual([4, 6])
  })
  it('las barras no llenan la banda y el histograma sí', () => {
    const b = bands(4, 2, 400)
    expect(b.length).toBe(4)
    expect(b[0].bar).toBeLessThanOrEqual(28)
    expect(b[1].start).toBeGreaterThan(b[0].start + b[0].bar * 2)
    const h = bands(5, 1, 500, { histogram: true })
    expect(h[0].bar).toBeCloseTo(98)
  })
  it('sectores con los valores positivos', () => {
    const s = pieSlices([1, 0, -3, 3])
    expect(s.map((x) => x.index)).toEqual([0, 3])
    expect(s[0].share).toBeCloseTo(0.25)
    expect(s[1].a1).toBeCloseTo(Math.PI * 2)
    expect(pieSlices([0, -1])).toEqual([])
    expect(arcPath(50, 50, 20, 40, 0, Math.PI / 2)).toMatch(/^M .* A 40 40 0 0 1 .* A 20 20 0 0 0 .* Z$/)
    expect(arcPath(0, 0, 0, 10, 0, 0)).toBe('')
  })
})

describe('línea de tiempo', () => {
  const events = [
    { when: '1789', title: 'Revolución' },
    { when: '1799', title: 'Golpe de Brumario' },
    { when: '1804', title: 'Imperio', end: '1815' },
    { when: 'un día', title: 'Sin fecha' }
  ]
  it('lee las fechas y deja fuera las ilegibles', () => {
    const items = timelineItems(events)
    expect(items.map((i) => i.index)).toEqual([0, 1, 2])
    expect(items[2].end).toBe(1815)
    expect(isProportional('auto', 4, 3)).toBe(true)
    expect(isProportional('vertical', 4, 4)).toBe(false)
    expect(isProportional('auto', 4, 2)).toBe(false)
  })
  it('reparte los hechos en carriles sin solapes', () => {
    const items = timelineItems(events)
    const [lo, hi] = timelineSpan(items, [])
    const l = lanes(items, lo, hi, 300, (s) => s)
    expect(new Set(l.values()).size).toBeGreaterThan(1)
    const wide = lanes(items, lo, hi, 4000, (s) => s)
    expect(Math.max(...wide.values())).toBe(0)
  })
  it('apila solo los periodos que se solapan', () => {
    const ps = periodItems([
      { from: '1789', to: '1799', title: 'Revolución' },
      { from: '1799', to: '1815', title: 'Napoleón' },
      { from: '1792', to: '1804', title: 'República' }
    ])
    const { lane, count } = periodLanes(ps)
    expect(count).toBe(2)
    expect(lane.get(0)).toBe(lane.get(1))
  })
  it('el eje nunca repite años y usa meses en periodos cortos', () => {
    const t = axisTicks(1787.9, 1816.1, 5000)
    expect(t.every((x) => x.value === Math.round(x.value))).toBe(true)
    expect(new Set(t.map((x) => x.value)).size).toBe(t.length)
    const short = axisTicks(1789.4, 1789.9, 800)
    expect(short.length).toBeGreaterThan(1)
    expect(short.every((x) => x.kind === 'month')).toBe(true)
  })
})

describe('caminos y sectores agrupados', () => {
  it('la curva suave pasa por los puntos', () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 }, { x: 30, y: 0 }])
    expect(d.startsWith('M0 0')).toBe(true)
    expect(d).toContain(' 10 5C')
    expect(d.endsWith(' 30 0')).toBe(true)
    expect(smoothPath([])).toBe('')
  })
  it('junta los sectores pequeños en «Otros»', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ label: `s${i}`, value: 10 - i }))
    const out = foldSlices(items, 8, 'Otros')
    expect(out.length).toBe(8)
    expect(out[7]).toEqual({ label: 'Otros', value: 3 + 2 + 1, other: true })
    expect(foldSlices([{ label: 'a', value: 1 }, { label: 'b', value: -1 }], 8, 'O')).toEqual([{ label: 'a', value: 1 }])
  })
})
