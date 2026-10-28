import { describe, expect, it } from 'vitest'
import { decodeFigurePart, type FigurePart } from '@shared/schema/visual'
import { activeParts, dragChips, dragScore, gutterFits, labelsAsNumbers, locateCorrect, nameMatches, partAt, placeGutterLabels, regionPath, shuffle } from './figure'
import { clampTransform, fittedSize, makeTransform, panBy, toUnit, toView, zoomAround } from './viewTransform'

const part = (raw: Record<string, unknown>): FigurePart => decodeFigurePart(raw)!

// Una figura de 4:3 con un núcleo (círculo), un nucléolo dentro (círculo menor), un orgánulo rectangular, uno poligonal y un punto.
const parts = [
  part({ id: 'nuc', name: 'Núcleo', x: 0.5, y: 0.5, r: 0.15 }),
  part({ id: 'nuo', name: 'Nucléolo', x: 0.52, y: 0.48, r: 0.03 }),
  part({ id: 'mit', name: 'Mitocondria', aliases: ['mitocondrias'], x: 0.15, y: 0.2, rect: [0.1, 0.15, 0.1, 0.1] }),
  part({ id: 'gol', name: 'Golgi', x: 0.8, y: 0.8, polygon: [[0.75, 0.75], [0.9, 0.75], [0.9, 0.9], [0.75, 0.9]] }),
  part({ id: 'mem', name: 'Membrana', x: 0.02, y: 0.6 })
]
const aspect = 4 / 3

describe('señalar: geometría exacta del clic', () => {
  const t = makeTransform({ width: 400, height: 300 }, { width: 400, height: 300 })
  const at = (fx: number, fy: number) => { const p = toView(t, fx, fy); return partAt(parts, t, p.x, p.y, aspect)?.id }

  it('gana la zona más pequeña que contiene el punto', () => {
    expect(at(0.52, 0.48)).toBe('nuo')
    expect(at(0.42, 0.5)).toBe('nuc')
  })
  it('rectángulos y polígonos', () => {
    expect(at(0.12, 0.17)).toBe('mit')
    expect(at(0.85, 0.85)).toBe('gol')
    expect(at(0.7, 0.85)).toBeUndefined()
  })
  it('un punto sin zona se acepta cerca de su anclaje', () => {
    expect(at(0.05, 0.6)).toBe('mem')
    expect(at(0.3, 0.9)).toBeUndefined()
  })
  it('fuera de la figura no señala nada', () => {
    expect(partAt(parts, t, -50, 10, aspect)).toBeUndefined()
  })
  it('acierta con el mismo nombre aunque sea otra parte', () => {
    const twin = part({ id: 'nuc2', name: 'núcleo', x: 0.1, y: 0.1 })
    expect(locateCorrect(parts[0], twin)).toBe(true)
    expect(locateCorrect(parts[0], parts[1])).toBe(false)
    expect(locateCorrect(parts[0], undefined)).toBe(false)
  })
  it('con zoom, el clic se convierte a la figura', () => {
    const z = zoomAround(t, 3, 200, 150)
    const p = toView(z, 0.52, 0.48)
    expect(partAt(parts, z, p.x, p.y, aspect)?.id).toBe('nuo')
    const u = toUnit(z, p.x, p.y)
    expect(u.x).toBeCloseTo(0.52, 9)
    expect(u.y).toBeCloseTo(0.48, 9)
  })
})

describe('zoom y desplazamiento', () => {
  it('la figura cubre la ventana y no se escapa al moverla', () => {
    const t = zoomAround(makeTransform({ width: 400, height: 300 }, { width: 400, height: 300 }), 2, 0, 0)
    expect(t.x).toBe(0)
    const moved = panBy(t, -10000, 50, { x: t.x, y: t.y })
    expect(moved.x).toBe(400 - 800)
    expect(moved.y).toBe(0)
  })
  it('una figura más pequeña que la ventana queda centrada; el zoom tiene límites', () => {
    const t = makeTransform({ width: 200, height: 150 }, { width: 400, height: 150 })
    expect(t.x).toBe(100)
    expect(clampTransform({ ...t, scale: 99 }).scale).toBe(6)
    expect(clampTransform({ ...t, scale: 0.2 }).scale).toBe(1)
  })
  it('ajuste al ancho con alto máximo', () => {
    expect(fittedSize(800, 2, 520)).toEqual({ width: 800, height: 400 })
    expect(fittedSize(800, 1, 520)).toEqual({ width: 520, height: 520 })
    expect(fittedSize(800, Number.NaN, 2000).height).toBeCloseTo(600)
  })
})

describe('etiquetas y capas', () => {
  it('números en vez de nombres con muchas partes o figura estrecha', () => {
    expect(labelsAsNumbers('auto', 15, 900, false)).toBe(true)
    expect(labelsAsNumbers('auto', 8, 500, false)).toBe(true)
    expect(labelsAsNumbers('auto', 8, 800, false)).toBe(false)
    expect(labelsAsNumbers('hidden', 3, 800, true)).toBe(true)
    expect(labelsAsNumbers('names', 30, 300, false)).toBe(false)
  })
  it('las etiquetas de los márgenes no se solapan ni se salen', () => {
    const many = Array.from({ length: 6 }, (_, i) => part({ id: `p${i}`, name: `Parte ${i}`, x: 0.2, y: 0.5 }))
    const t = makeTransform({ width: 400, height: 300 }, { width: 400, height: 300 })
    const placed = placeGutterLabels(many, t, 140).filter((p) => p.left).sort((a, b) => a.y - b.y)
    for (let i = 1; i < placed.length; i++) expect(placed[i].y - placed[i - 1].y).toBeGreaterThanOrEqual((placed[i].h + placed[i - 1].h) / 2)
    expect(placed[0].y).toBeGreaterThanOrEqual(placed[0].h / 2)
    expect(placed[placed.length - 1].y).toBeLessThanOrEqual(300 - placed[placed.length - 1].h / 2)
    expect(gutterFits(many, 140, 300)).toBe(true)
    expect(gutterFits(Array.from({ length: 20 }, (_, i) => part({ id: `q${i}`, name: 'x', x: 0.1, y: 0.5 })), 140, 300)).toBe(false)
  })
  it('las partes de una capa apagada no se ven ni se preguntan', () => {
    const ps = [part({ id: 'a', name: 'A', layer: 'huesos' }), part({ id: 'b', name: 'B', layer: 'musculos' }), part({ id: 'c', name: 'C', layer: 'otra' })]
    const layers = [{ id: 'huesos', name: 'Huesos', items: [], visible: true }, { id: 'musculos', name: 'Músculos', items: [], visible: false }]
    expect(activeParts(ps, layers, new Set(['huesos'])).map((p) => p.id)).toEqual(['a', 'c'])
  })
  it('contornos de las zonas en la ventana', () => {
    const t = makeTransform({ width: 400, height: 300 }, { width: 400, height: 300 })
    expect(regionPath(parts[3], t)).toMatch(/^M300 225L360 225L360 270L300 270Z$/)
    expect(regionPath(parts[4], t)).toContain('A13 13')
  })
})

describe('arrastrar', () => {
  it('nombres sin repetidos, barajados igual con la misma semilla', () => {
    const dup = [...parts, part({ id: 'x', name: 'núcleo', x: 0.3, y: 0.3 })]
    const a = dragChips(dup, 'blk')
    expect(a).toHaveLength(5)
    expect(dragChips(dup, 'blk')).toEqual(a)
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 'semilla')).toEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 'semilla'))
  })
  it('cuenta los nombres en su sitio (alias valen)', () => {
    expect(nameMatches(parts[2], 'Mitocondrias')).toBe(true)
    expect(dragScore(parts, { nuc: 'Núcleo', mit: 'mitocondrias', gol: 'Membrana' })).toBe(2)
  })
})
