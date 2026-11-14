import { describe, expect, it } from 'vitest'
import { boundsOf, type Pt } from './geometry'
import { OBJECTS, OBJECT_NAMES, isObjectName } from './objects'
import { drawItemShape } from './shapes'

const pointsOf = (s: ReturnType<typeof drawItemShape>): Pt[] => s.paths.flatMap((p) => p.pts ?? [])

describe('objetos hechos', () => {
  it('están todos los de Sketchy y los de las lecciones', () => {
    for (const n of ['person', 'tree', 'cloud', 'house', 'car', 'bike', 'gear', 'sun', 'bulb', 'battery', 'laptop', 'phone', 'server', 'book', 'heart', 'drop', 'flame', 'mountain', 'flask', 'rocket', 'lock', 'key', 'ground', 'wall', 'block', 'ball', 'pulley', 'magnet', 'beaker', 'thermometer', 'planet', 'spring']) {
      expect(OBJECT_NAMES).toContain(n)
    }
    expect(isObjectName('Car')).toBe(true)
    expect(isObjectName('toString')).toBe(false)
  })

  it('cada objeto da caminos y no pasa de ±52 con w = 100', () => {
    for (const name of OBJECT_NAMES) {
      const s = drawItemShape({ kind: 'object', object: name, x: 0, y: 0, w: 100 })
      expect(s.paths.length, name).toBeGreaterThan(0)
      const b = boundsOf(pointsOf(s))!
      expect(b.x, name).toBeGreaterThanOrEqual(-52)
      expect(b.y, name).toBeGreaterThanOrEqual(-52)
      expect(b.x + b.w, name).toBeLessThanOrEqual(52)
      expect(b.y + b.h, name).toBeLessThanOrEqual(52)
      // siempre a mano y con papel bajo los rellenos
      expect(s.paths.every((p) => p.hand), name).toBe(true)
      expect(s.paths.filter((p) => p.fill && !p.fillOnly).every((p) => p.paper), name).toBe(true)
    }
  })

  it('girar 90° intercambia el ancho y el alto de su caja', () => {
    const flat = boundsOf(pointsOf(drawItemShape({ kind: 'object', object: 'car', x: 0, y: 0, w: 100 })))!
    const turned = boundsOf(pointsOf(drawItemShape({ kind: 'object', object: 'car', x: 0, y: 0, w: 100, rotate: 90 })))!
    expect(turned.w).toBeCloseTo(flat.h, 0)
    expect(turned.h).toBeCloseTo(flat.w, 0)
  })

  it('voltear refleja las x', () => {
    const a = drawItemShape({ kind: 'object', object: 'car', x: 0, y: 0, w: 100 }).paths[0].pts!
    const b = drawItemShape({ kind: 'object', object: 'car', x: 0, y: 0, w: 100, flip: true }).paths[0].pts!
    a.forEach((p, i) => {
      expect(b[i][0]).toBeCloseTo(-p[0])
      expect(b[i][1]).toBeCloseTo(p[1])
    })
  })

  it('un relleno elegido solo colorea las partes del color del objeto', () => {
    const s = drawItemShape({ kind: 'object', object: 'car', x: 0, y: 0, fill: 'green' })
    const fills = s.paths.map((p) => p.fill?.color)
    expect(fills.filter((f) => f === 'green')).toHaveLength(OBJECTS.car.filter((p) => p.tint).length)
    expect(fills).toContain('blue')
    expect(fills).toContain('paper')
    // un trazo elegido colorea todas las partes
    expect(drawItemShape({ kind: 'object', object: 'car', x: 0, y: 0, stroke: 'blue' }).paths.every((p) => p.stroke === 'blue')).toBe(true)
  })

  it('un objeto desconocido no dibuja nada', () => {
    expect(drawItemShape({ kind: 'object', object: 'unicorn', x: 0, y: 0 }).paths).toHaveLength(0)
    expect(drawItemShape({ kind: 'object', object: 'constructor', x: 0, y: 0 }).paths).toHaveLength(0)
  })

  it('x,y es el centro y la etiqueta se pide debajo', () => {
    const s = drawItemShape({ kind: 'object', object: 'person', x: 200, y: 100, w: 80, label: 'Observador' })
    expect(s.center).toEqual([200, 100])
    expect(s.auto?.prefer?.[0]).toBe('bottom')
  })
})
