import { describe, expect, it } from 'vitest'
import type { FigureLayer, FigurePart } from '@shared/schema/visual'
import { fittedTransform, partBox, tourFocus, tourLayers } from './figureTour'
import { encircleInk } from './tourInk'

const t = fittedTransform({ width: 400, height: 200 })
const part = (p: Partial<FigurePart> & { id: string }): FigurePart => ({ name: p.id, aliases: [], x: 0.5, y: 0.5, ...p })

describe('la caja de la zona de una parte', () => {
  it('círculo (radio en anchos), rectángulo, polígono y sin zona', () => {
    expect(partBox(part({ id: 'c', x: 0.5, y: 0.5, r: 0.1 }), t)).toEqual({ x: 160, y: 60, width: 80, height: 80 })
    expect(partBox(part({ id: 'r', rect: [0.1, 0.2, 0.25, 0.5] }), t)).toEqual({ x: 40, y: 40, width: 100, height: 100 })
    expect(partBox(part({ id: 'p', polygon: [[0.1, 0.1], [0.3, 0.1], [0.2, 0.6]] }), t)).toEqual({ x: 40, y: 20, width: 80, height: 100 })
    expect(partBox(part({ id: 'n', x: 0.25, y: 0.5 }), t, 13)).toEqual({ x: 87, y: 87, width: 26, height: 26 })
  })
})

describe('las partes y capas de un paso', () => {
  const parts = [part({ id: 'a', layer: 'L' }), part({ id: 'b' })]
  const layers: FigureLayer[] = [{ id: 'L', name: 'Capa', items: [], visible: false }]

  it('ignora ids desconocidos y repetidos', () => {
    expect(tourFocus({ md: '', parts: ['b', 'x', 'b', 'a'] }, parts).map((p) => p.id)).toEqual(['b', 'a'])
    expect(tourFocus(undefined, parts)).toEqual([])
  })

  it('enciende la capa apagada de una parte del paso', () => {
    expect(tourLayers({ md: '', parts: ['a'] }, parts, layers, new Set())).toEqual(['L'])
    expect(tourLayers({ md: '', parts: ['a'] }, parts, layers, new Set(['L']))).toEqual([])
    expect(tourLayers({ md: '', parts: ['b'] }, parts, layers, new Set())).toEqual([])
  })
})

describe('el lazo a pluma', () => {
  it('es el mismo para la misma semilla, distinto para otra, un trazo y rodea la caja', () => {
    const a = encircleInk(120, 40, 'cell:nuc')
    expect(encircleInk(120, 40, 'cell:nuc')).toBe(a)
    expect(encircleInk(120, 40, 'cell:mit').strokes[0].d).not.toBe(a.strokes[0].d)
    expect(a.strokes).toHaveLength(1)
    // el lienzo es mayor que la caja (cabe el lazo con su vuelta de más) y tarda lo que una mano
    expect(a.w).toBeGreaterThan(120)
    expect(a.h).toBeGreaterThan(40)
    expect(a.ms).toBeGreaterThanOrEqual(380)
    expect(a.ms).toBeLessThanOrEqual(640)
    // el eje no se sale del lienzo
    const nums = (a.strokes[0].spine.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(a.w)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(a.h)
  })
})
