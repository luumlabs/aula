import { describe, expect, it } from 'vitest'
import type { DrawItem } from '@shared/schema/common'
import { makeSimParam, makeSimTime } from '@shared/schema/visual'
import { drawingLayout } from './labels'
import { applyFrame, drawingEngine, drawingEnv, drawingMoves, resolveFrame, shapeCenter } from './motion'
import type { Pt } from './geometry'

function frames(items: DrawItem[], values: Record<string, number>, time?: number, withTime = false) {
  const params = [makeSimParam('a', undefined, -360, 360, 1, 0), makeSimParam('theta', undefined, -90, 90, 1, 0)]
  const engine = drawingEngine({ params, time: withTime ? makeSimTime({ min: '0', max: '10' }) : undefined })
  const shapes = drawingLayout(items, 400, 300)
  return { fr: resolveFrame(items, shapes, engine, drawingEnv(engine, values, time)), shapes }
}

describe('movimiento', () => {
  it('dx/dy desplazan el elemento entero', () => {
    const { fr } = frames([{ kind: 'circle', cx: 50, cy: 50, r: 5, motion: { dx: '2*a', dy: '-a' } }], { a: 10 })
    expect(fr[0]).toMatchObject({ dx: 20, dy: -10, deg: 0 })
  })
  it('turn gira alrededor del pivote (el centro se mueve como debe)', () => {
    const items: DrawItem[] = [{ kind: 'circle', cx: 100, cy: 50, r: 5, motion: { turn: 'a', pivot: [50, 50] } }]
    const { fr } = frames(items, { a: 90 })
    const moved = applyFrame([100, 50], fr[0])
    // 90° antihorario en pantalla: de la derecha del pivote a encima
    expect(moved[0]).toBeCloseTo(50)
    expect(moved[1]).toBeCloseTo(0)
  })
  it('theta y rad() funcionan (trigonometría en radianes)', () => {
    const { fr } = frames([{ kind: 'dot', cx: 0, cy: 0, motion: { dx: '10*cos(rad(theta))', dy: '10*sin(rad(theta))' } }], { theta: 90 })
    expect(fr[0]!.dx).toBeCloseTo(0)
    expect(fr[0]!.dy).toBeCloseTo(10)
  })
  it('un valor que no se puede calcular o un nombre desconocido deja el elemento quieto', () => {
    const { fr } = frames([{ kind: 'dot', cx: 0, cy: 0, motion: { dx: '1/0' } }, { kind: 'dot', cx: 0, cy: 0, motion: { dx: 'zeta*2' } }], { a: 1 })
    expect(fr).toEqual([undefined, undefined])
  })
  it('along: el centro recorre el contorno de otro elemento (circunferencia: empieza a la derecha, antihorario)', () => {
    const items: DrawItem[] = [
      { kind: 'circle', id: 'orbit', cx: 200, cy: 150, r: 100 },
      { kind: 'dot', cx: 300, cy: 150, r: 4, motion: { along: 'orbit', at: 't/10' } }
    ]
    const at0 = frames(items, {}, 0, true)
    expect(at0.fr[1]).toBeUndefined()
    const quarter = frames(items, {}, 2.5, true)
    const c = applyFrame(shapeCenter(quarter.shapes[1]), quarter.fr[1])
    expect(c[0]).toBeCloseTo(200, 0)
    expect(c[1]).toBeCloseTo(50, 0)
  })
  it('along con orient gira con la tangente', () => {
    const items: DrawItem[] = [
      { kind: 'circle', id: 'o', cx: 0, cy: 0, r: 50 },
      { kind: 'object', object: 'car', x: 50, y: 0, w: 20, motion: { along: 'o', at: '0.25', orient: true } }
    ]
    const { fr } = frames(items, {})
    expect(Math.abs(fr[1]!.deg)).toBeGreaterThan(170)
  })
  it('no se viaja por un elemento que viaja a su vez', () => {
    const items: DrawItem[] = [
      { kind: 'circle', id: 'a1', cx: 0, cy: 0, r: 50 },
      { kind: 'circle', id: 'b1', cx: 50, cy: 0, r: 10, motion: { along: 'a1', at: '0.5' } },
      { kind: 'dot', cx: 60, cy: 0, motion: { along: 'b1', at: '0.5' } }
    ]
    const { fr } = frames(items, {})
    expect(fr[1]).toBeDefined()
    expect(fr[2]).toBeUndefined()
  })
  it('en reposo (expresiones que valen 0) el dibujo es el estático', () => {
    const items: DrawItem[] = [{ kind: 'rect', x: 0, y: 0, w: 10, h: 10, motion: { dx: 'a', turn: '3*a' } }]
    expect(frames(items, { a: 0 }).fr).toEqual([undefined])
    expect(applyFrame([3, 4] as Pt, undefined)).toEqual([3, 4])
  })
  it('drawingMoves: hace falta motion y algo que lo mueva', () => {
    expect(drawingMoves({ items: [{ kind: 'dot', motion: { dx: 'a' } }] })).toBe(false)
    expect(drawingMoves({ items: [{ kind: 'dot', motion: { dx: 'a' } }], params: [makeSimParam('a', undefined, 0, 1, 0.1, 0)] })).toBe(true)
  })
})
