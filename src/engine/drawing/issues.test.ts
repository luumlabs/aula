import { describe, expect, it } from 'vitest'
import type { DrawingBlock } from '@shared/schema/common'
import { makeSimParam } from '@shared/schema/visual'
import { LEGACY_ITEMS } from './fixtures/legacy'
import { drawingIssues } from './issues'
import { normalizeDrawingJSON, normalizeDrawItem } from './normalize'

describe('avisos del dibujo', () => {
  it('dos etiquetas en el mismo sitio se pisan', () => {
    const d: DrawingBlock = { width: 400, height: 300, items: [{ kind: 'text', x: 100, y: 100, text: 'Fuerza' }, { kind: 'text', x: 104, y: 102, text: 'Peso' }] }
    expect(drawingIssues(d).map((i) => i.message).join('\n')).toMatch(/«Fuerza» y «Peso» se pisan en reposo/)
  })
  it('una forma fuera del lienzo', () => {
    const d: DrawingBlock = { width: 400, height: 300, items: [{ kind: 'circle', cx: 390, cy: 150, r: 40 }] }
    const [i] = drawingIssues(d)
    expect(i.item).toBe(0)
    expect(i.message).toMatch(/se sale del lienzo de 400×300 en reposo/)
  })
  it('también en cada paso (un deslizador que lleva algo fuera)', () => {
    const d: DrawingBlock = {
      width: 400, height: 300, params: [makeSimParam('x', undefined, 0, 600, 1, 0)],
      items: [{ kind: 'object', id: 'car', object: 'car', x: 50, y: 150, w: 60, motion: { dx: 'x' } }],
      steps: [{ md: 'sale', params: { x: 600 } }]
    }
    expect(drawingIssues(d).map((i) => i.message)).toEqual(['El elemento «car» se sale del lienzo de 400×300 en el paso 1: muévelo dentro o agranda el lienzo.'])
  })
  it('el ejemplo de Pitágoras de la galería no da avisos', () => {
    expect(drawingIssues({ width: 420, height: 300, items: LEGACY_ITEMS.slice(0, 11) })).toEqual([])
  })
})

describe('normalizador del dibujo', () => {
  it('blob y shape pasan a polygon (blob suave)', () => {
    expect(normalizeDrawItem({ kind: 'blob', points: [] })).toMatchObject({ kind: 'polygon', smooth: true })
    expect(normalizeDrawItem({ kind: 'shape', points: [] })).toMatchObject({ kind: 'polygon' })
    expect(normalizeDrawItem({ kind: 'shape', points: [] })).not.toHaveProperty('smooth')
  })
  it('una curva de más de 3 puntos es una polilínea suave; la de 3 se queda', () => {
    expect(normalizeDrawItem({ kind: 'curve', points: [[0, 0], [1, 1], [2, 0], [3, 1]] })).toMatchObject({ kind: 'polyline', smooth: true })
    expect(normalizeDrawItem({ kind: 'curve', points: [[0, 0], [1, 1], [2, 0]] })).toMatchObject({ kind: 'curve' })
  })
  it('un objeto escrito como tipo y su tamaño', () => {
    expect(normalizeDrawItem({ kind: 'Car', x: 1, y: 2, size: 80 })).toEqual({ kind: 'object', object: 'car', x: 1, y: 2, w: 80 })
    expect(normalizeDrawItem({ kind: 'object', object: 'tree', size: 14 })).toMatchObject({ size: 14 })
    // como lo guarda Aula para las versiones antiguas (un texto con su objeto), igual
    expect(normalizeDrawItem({ kind: 'text', object: ' Car ', x: 1, y: 2, size: 80 })).toEqual({ kind: 'text', object: 'car', x: 1, y: 2, w: 80 })
    expect(normalizeDrawItem({ kind: 'text', x: 1, y: 2, text: 'a', size: 80 })).toEqual({ kind: 'text', x: 1, y: 2, text: 'a', size: 80 })
    // un `object` vacío no lo hace objeto (el decodificador lo descarta): el texto conserva su tamaño de letra
    expect(normalizeDrawItem({ kind: 'text', object: ' ', x: 1, y: 2, text: 'a', size: 30 })).toEqual({ kind: 'text', object: ' ', x: 1, y: 2, text: 'a', size: 30 })
  })
  it('deslizadores y reloj con otros nombres; pasos como texto', () => {
    const o = normalizeDrawingJSON({ items: [], sliders: [{ symbol: 'v', range: [0, 5], default: 1 }], clock: { max: '4' }, steps: ['uno'] })
    expect(o.params).toEqual([{ name: 'v', min: 0, max: 5, value: 1 }])
    expect(o.time).toEqual({ max: '4' })
    expect(o.steps).toEqual([{ md: 'uno' }])
  })
  it('movimiento escrito suelto', () => {
    expect(normalizeDrawItem({ kind: 'dot', along: 'orbit', at: 't/4' })).toEqual({ kind: 'dot', motion: { along: 'orbit', at: 't/4' } })
    expect(normalizeDrawItem({ kind: 'dot', move: { dx: 'a' } })).toEqual({ kind: 'dot', motion: { dx: 'a' } })
  })
})
