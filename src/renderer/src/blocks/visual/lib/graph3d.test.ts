import { describe, expect, it } from 'vitest'
import { decodeModel3D, encodeModel3D, type Graph3D } from '@shared/schema/visual'
import { ContentValidator } from '@engine/content/validator'
import { checkGraph3D } from '@engine/content/visual-validation'
import { FLOOR, MAX_HEIGHT, SAMPLES, axisNumber, layoutGraph, zRange, type OfT, type XY } from './graph3d'

const graph = (over: Partial<Graph3D> = {}): Graph3D => ({ xMin: -2, xMax: 2, yMin: -2, yMax: 2, surfaces: [], curves: [], vectors: [], points: [], axes: true, ...over })
// evaluadores de prueba: una tabla de funciones conocidas
const XYS: Record<string, XY> = { paraboloid: (x, y) => x * x + y * y, plane: () => 1, pole: (x) => (x === 0 ? null : 1 / x), dome: (x, y) => (x * x + y * y > 1 ? null : Math.sqrt(1 - x * x - y * y)) }
const TS: Record<string, OfT> = { cos: Math.cos, sin: Math.sin, t: (t) => t }
const surface = (e: string): XY | null => XYS[e] ?? null
const curve = (e: string): OfT | null => TS[e] ?? null

describe('gráfica en ejes 3D', () => {
  it('malla una superficie: z hacia arriba, x e y con la misma escala, dentro del tamaño de la escena', () => {
    const l = layoutGraph(graph({ surfaces: [{ expr: 'paraboloid' }] }), surface, curve)
    const m = l.surfaces[0]!
    expect(m.positions.length).toBe(SAMPLES * SAMPLES * 3)
    expect(m.indices.length).toBe((SAMPLES - 1) * (SAMPLES - 1) * 6)
    expect(l.zMin).toBe(0)
    expect(l.zMax).toBeCloseTo(8)
    // el suelo mide FLOOR; la altura se aplasta hasta MAX_HEIGHT
    expect(l.toScene(2, 0, 0)[0] - l.toScene(-2, 0, 0)[0]).toBeCloseTo(FLOOR)
    expect(l.toScene(0, 0, 8)[1]).toBeCloseTo(MAX_HEIGHT)
    // y positiva se aleja (z de la escena negativa): los ejes quedan a derechas
    expect(l.toScene(0, 2, 0)[2]).toBeLessThan(0)
    for (const v of m.positions) expect(Number.isFinite(v)).toBe(true)
    expect(m.grid.length % 6).toBe(0)
  })

  it('deja huecos donde la función no existe y corta limpio en zMin y zMax', () => {
    const dome = layoutGraph(graph({ surfaces: [{ expr: 'dome' }] }), surface, curve).surfaces[0]!
    expect(dome.indices.length).toBeGreaterThan(0)
    expect(dome.indices.length).toBeLessThan((SAMPLES - 1) * (SAMPLES - 1) * 6)
    const cut = layoutGraph(graph({ surfaces: [{ expr: 'paraboloid' }], zMin: 0, zMax: 2 }), surface, curve)
    const top = cut.toScene(0, 0, 2)[1]
    for (let i = 1; i < cut.surfaces[0]!.positions.length; i += 3) expect(cut.surfaces[0]!.positions[i]).toBeLessThanOrEqual(top + 1e-6)
    expect(cut.surfaces[0]!.indices.length).toBeLessThan((SAMPLES - 1) * (SAMPLES - 1) * 6)
  })

  it('una asíntota no aplasta el resto; una expresión que no compila deja su hueco y lo demás se dibuja', () => {
    const l = layoutGraph(graph({ surfaces: [{ expr: 'pole' }, { expr: 'nope' }, { expr: 'plane' }] }), surface, curve)
    expect(l.zMax - l.zMin).toBeLessThan(60)
    expect(l.surfaces[1]).toBeNull()
    expect(l.surfaces[2]).not.toBeNull()
  })

  it('curvas, vectores y puntos entran en el rango; los ejes pasan por el origen si cae dentro', () => {
    const l = layoutGraph(graph({ curves: [{ x: 'cos', y: 'sin', z: 't', tMin: 0, tMax: 6 }], vectors: [{ from: [0, 0, 0], to: [1, 1, 9] }], points: [{ x: 0, y: 0, z: -3 }] }), surface, curve)
    expect(l.curves[0].length).toBe(241)
    expect(l.zMin).toBe(-3)
    expect(l.zMax).toBe(9)
    expect(l.origin).toEqual([0, 0, 0])
    expect(layoutGraph(graph({ xMin: 1, xMax: 3, points: [{ x: 2, y: 0, z: 1 }] }), surface, curve).origin[0]).toBe(1)
    expect(zRange(graph(), [])).toEqual([-1, 1])
    expect(zRange(graph({ zMin: -2 }), [1, 5])).toEqual([-2, 5])
    expect(axisNumber(-0.004, String)).toBe('0')
    expect(axisNumber(3.14159, String)).toBe('3.14')
  })
})

describe('gráfica 3D en el formato del curso', () => {
  it('lee las formas que escribe un modelo y las guarda igual', () => {
    const b = decodeModel3D({ title: 'Plano', alt: 'a', graph: { surfaces: ['x + y', { z: 'x^2' }], vectors: [[1, 2, 3], { from: [1, 0, 0], to: { x: 0, y: 1, z: 0 }, label: 'v' }], points: [[0, 0, 1], { x: 1, y: 1, z: 1, label: 'P' }], curves: [{ x: 'cos(t)', y: 'sin(t)', z: 't' }] } })!
    expect(b.graph!.surfaces.map((s) => s.expr)).toEqual(['x + y', 'x^2'])
    expect(b.graph!.vectors[0]).toEqual({ from: [0, 0, 0], to: [1, 2, 3] })
    expect(b.graph!.vectors[1]).toMatchObject({ from: [1, 0, 0], to: [0, 1, 0], label: 'v' })
    expect(b.graph!.curves[0]).toMatchObject({ tMin: 0, tMax: 2 * Math.PI })
    expect(b.graph).toMatchObject({ xMin: -3, xMax: 3, axes: true })
    expect(decodeModel3D(encodeModel3D(b))!.graph).toEqual(b.graph)
    // las piezas sueltas en el propio bloque también valen; un bloque sin gráfica no gana una vacía
    expect(decodeModel3D({ surfaces: [{ expr: 'x*y' }] })!.graph!.surfaces).toHaveLength(1)
    expect(decodeModel3D({ formula: 'H2O' })!.graph).toBeUndefined()
    expect(encodeModel3D(decodeModel3D({ formula: 'H2O' })!)).not.toHaveProperty('graph')
  })

  it('el validador explica qué arreglar', () => {
    const v = ContentValidator.withMath()
    expect(checkGraph3D(v, graph({ surfaces: [{ expr: 'x^2 + y^2' }, { expr: 'sin(x)*cos(y)' }], curves: [{ x: 'cos(t)', y: 'sin(t)', z: 't/3', tMin: 0, tMax: 12 }] }), 'g')).toEqual([])
    const bad = checkGraph3D(v, graph({ xMin: 2, xMax: 1, surfaces: [{ expr: 'x^2 +' }], curves: [{ x: 'u', y: 't', z: 't', tMin: 3, tMax: 1 }], vectors: [{ from: [1, 1, 1], to: [1, 1, 1] }] }), 'g').map((i) => i.path)
    expect(bad).toEqual(expect.arrayContaining(['g', 'g.surfaces[0].expr', 'g.curves[0].x', 'g.curves[0]', 'g.vectors[0]']))
  })
})
