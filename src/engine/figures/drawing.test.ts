import { describe, expect, it } from 'vitest'
import type { DrawingRenderSceneV1 } from '@shared/figuresDrawing'
import { validateDrawingRenderScene as validate } from './drawing'

function fixture(): DrawingRenderSceneV1 {
  return { version: 1, canvas: { width: 100, height: 80 }, metrics: { pixelWidth: 200, textK: 1, unitsPerPx: .5, rootFontPx: 16 }, appearance: { theme: 'light', language: 'es', direction: 'ltr', palette: { paper: '#ffffff', text: '#000000', text2: '#111111', text3: '#222222', brick: '#aa2211', accent: '#aa2211', link: '#aa2211' } }, output: { scale: 2 }, items: [{ sourceIndex: 8, opacity: 1, transform: { dx: 0, dy: 0, deg: 0, px: 0, py: 0 }, paths: [{ d: 'M0 0 L50 40', fill: { kind: 'hatch', color: '#112233' }, stroke: '#223344', width: 2, fillOpacity: .2, strokeOpacity: 1, dashed: false, offset: { x: 0, y: 0 } }], labels: [{ x: -4, y: 2, size: 16, anchor: 'center', text: '$x<y$ [visible](https://example.invalid)', color: '#112233' }], rings: [] }] }
}
describe('DTO cerrado de Drawing', () => {
  it('copia presentación visible, índices estables y enlaces inertes como texto', () => {
    const source = fixture(), result = validate(source)
    expect(result).toEqual(source); expect(result.items[0]).not.toBe(source.items[0])
    source.items[0].paths[0].d = 'M99 99'
    expect(result.items[0].paths[0].d).toBe('M0 0 L50 40')
  })
  it('rechaza campos ocultos, propiedades activas, prototipos y arrays dispersos', () => {
    const hidden = fixture(); Object.assign(hidden.items[0], { name: 'HIDDEN' })
    const getter = fixture(); Object.defineProperty(getter.canvas, 'width', { get: () => { throw new Error('getter ran') }, enumerable: true })
    const sparse = fixture(); sparse.items = new Array(3)
    const prototype = Object.assign(Object.create({}), fixture())
    const symbol = fixture(); Object.assign(symbol, { [Symbol('hidden')]: true })
    for (const value of [hidden, getter, sparse, prototype, symbol]) expect(() => validate(value)).toThrow('Invalid figure export')
  })
  it('rechaza infinitos, métricas incoherentes, índices repetidos y recursos activos', () => {
    const badNumber = fixture(); badNumber.items[0].opacity = Infinity
    const metrics = fixture(); metrics.metrics.unitsPerPx = 7
    const duplicate = fixture(); duplicate.items.push(structuredClone(duplicate.items[0]))
    const color = fixture(); color.items[0].paths[0].stroke = 'url(file:///private)'
    for (const value of [badNumber, metrics, duplicate, color]) expect(() => validate(value)).toThrow()
  })
  it.each(['M0 0 L', 'M0,,0L10 10', 'M,0 0', 'M0 0,', 'M0 0L1', 'M0 0 A1 2 0 8 0 3 4', 'M0 0L1e999 1', 'M0 0<script>', 'M0 0l900000 0 900000 0', 'M0 0 A0.000001 100 0 0 1 10 0'])('rechaza path inválido o acumulativo %s', path => {
    const value = fixture(); value.items[0].paths[0].d = path
    expect(() => validate(value)).toThrow()
  })
  it('acota geometría física antes de montar, incluyendo offset, rotación y grosor', () => {
    for (const change of [
      (v: DrawingRenderSceneV1) => { v.items[0].paths[0].d = 'M0 0L1000000 1000000' },
      (v: DrawingRenderSceneV1) => { v.items[0].paths[0].offset.x = 1000000 },
      (v: DrawingRenderSceneV1) => { v.items[0].transform.px = 1000000 }
    ]) { const value = fixture(); change(value); expect(() => validate(value)).toThrow('exceeds export limits') }
  })
  it('no trunca texto ni payload agregado al exceder presupuestos', () => {
    const label = fixture(); label.items[0].labels[0].text = 'x'.repeat(8193)
    expect(() => validate(label)).toThrow('exceeds export limits')
    const total = fixture(); total.items[0].labels = Array.from({ length: 10 }, () => ({ ...total.items[0].labels[0], text: 'x'.repeat(8192) }))
    expect(() => validate(total)).toThrow('exceeds export limits')
    const paths = fixture(); paths.items[0].paths = Array.from({ length: 30 }, () => ({ ...paths.items[0].paths[0], d: `M0 0 ${'L0 0 '.repeat(20000)}` }))
    expect(() => validate(paths)).toThrow('exceeds export limits')
  })
})
