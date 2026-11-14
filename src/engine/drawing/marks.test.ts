import { describe, expect, it } from 'vitest'
import { drawItemShape } from './shapes'
import { angleSweep, gridLineCount } from './marks'
import { placeAutoLabels } from './labels'

/** Los números de un camino SVG. */
const nums = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('marcas: ángulo de tres puntos', () => {
  it('un ángulo recto en cualquier orientación dibuja el cuadradito con sus brazos', () => {
    // brazos a la derecha y hacia arriba (y de pantalla hacia abajo)
    const s = drawItemShape({ kind: 'angle', points: [[110, 100], [100, 100], [100, 90]], r: 20 })
    const stroke = s.paths.find((p) => !p.fillOnly)!
    expect(stroke.d).not.toContain('A')
    expect(stroke.pts).toEqual([[114, 100], [114, 86], [100, 86]])
    // brazos girados 45°: (1,1) y (−1,1)
    const t = drawItemShape({ kind: 'angle', points: [[110, 110], [100, 100], [90, 110]], r: 20 })
    const q = t.paths.find((p) => !p.fillOnly)!.pts!
    expect(q[1][0]).toBeCloseTo(100)
    expect(q[1][1]).toBeCloseTo(100 + 14 * Math.SQRT2)
  })
  it('rightAngle con tres puntos usa los brazos; sin puntos es el de siempre', () => {
    const s = drawItemShape({ kind: 'rightAngle', points: [[0, 50], [0, 0], [50, 0]] })
    expect(s.paths.find((p) => !p.fillOnly)!.pts).toEqual([[0, 12], [12, 12], [12, 0]])
    expect(drawItemShape({ kind: 'rightAngle', cx: 0, cy: 0, r: 10 }).paths[0].d).toBe('M10 0L10 -10L0 -10')
  })
  it('60°: arco del menor ángulo con el signo correcto en un lienzo con y hacia abajo', () => {
    const { from, sweep } = angleSweep([200, 100], [100, 100], [100 + 100 * Math.cos(Math.PI / 3), 100 - 100 * Math.sin(Math.PI / 3)])
    expect(from).toBeCloseTo(0)
    expect(sweep).toBeCloseTo(60)
    // al revés, el barrido cambia de signo y sigue siendo el menor
    expect(angleSweep([100 + 50, 100 - 86.6], [100, 100], [200, 100]).sweep).toBeCloseTo(-60, 0)
    expect(Math.abs(angleSweep([200, 100], [100, 100], [0, 99]).sweep)).toBeLessThanOrEqual(180)
    const s = drawItemShape({ kind: 'angle', points: [[200, 100], [100, 100], [150, 13.4]], r: 30 })
    const arc = s.paths.find((p) => !p.fillOnly)!
    // antihorario en pantalla = sweep-flag 0
    expect(arc.d).toMatch(/A30 30 0 0 0 /)
  })
  it('la etiqueta va en la bisectriz, por fuera del arco', () => {
    const s = drawItemShape({ kind: 'angle', points: [[200, 100], [100, 100], [100, 0]], label: '$\\theta$', r: 20 })
    const l = s.labels[0]
    // ángulo recto: la bisectriz va a 45° (arriba a la derecha)
    expect(l.x - 100).toBeCloseTo(100 - l.y, 5)
    expect(Math.hypot(l.x - 100, l.y - 100)).toBeGreaterThan(20)
    const narrow = drawItemShape({ kind: 'angle', points: [[200, 100], [100, 100], [200, 90]], label: 'α', r: 20 }).labels[0]
    expect(Math.hypot(narrow.x - 100, narrow.y - 100)).toBeGreaterThan(40)
  })
})

describe('marcas: cota, llave, ejes y rejilla', () => {
  it('cota: flechas en los dos extremos y líneas de referencia del lado de la separación', () => {
    const s = drawItemShape({ kind: 'measure', x1: 0, y1: 100, x2: 100, y2: 100, offset: 20, label: '4 cm' })
    expect(s.heads).toHaveLength(2)
    const ext = s.paths.filter((p) => p.stroke === 'gray')
    expect(ext).toHaveLength(2)
    // de izquierda a derecha, la derecha del sentido es abajo
    for (const p of ext) for (const [, y] of p.pts!) expect(y).toBeGreaterThan(100)
    const main = s.paths.find((p) => p.stroke !== 'gray')!
    expect(main.pts).toEqual([[0, 120], [100, 120]])
    expect(s.auto?.prefer?.[0]).toBe('bottom')
  })
  it('llave: simétrica respecto a su centro y abombada a la derecha de 1 → 2', () => {
    const s = drawItemShape({ kind: 'brace', x1: 0, y1: 0, x2: 0, y2: 100 })
    const pts = s.paths[0].pts!
    // de arriba abajo, la derecha del sentido es la izquierda de la pantalla (x < 0)
    for (const [x] of pts) expect(x).toBeLessThan(0.001)
    const mid = pts.reduce((a, b) => (b[0] < a[0] ? b : a))
    expect(mid[1]).toBeCloseTo(50, 0)
    const first = pts[0], last = pts[pts.length - 1]
    expect(first[0]).toBeCloseTo(last[0])
    expect(first[1] + last[1]).toBeCloseTo(100)
  })
  it('ejes: dos flechas, marcas como mucho 100 por eje y nombres en las puntas', () => {
    const s = drawItemShape({ kind: 'axes', x: 50, y: 250, w: 300, h: 200, step: 0.5, xLabel: 't', yLabel: 'v' })
    expect(s.heads).toHaveLength(2)
    const ticks = s.paths.find((p) => p.fade)!
    expect(gridLineCount(ticks.d)).toBe(200)
    expect(s.labels.map((l) => l.text)).toEqual(['t', 'v'])
    expect(s.paths.every((p) => p.crisp)).toBe(true)
  })
  it('rejilla: como mucho 200 líneas por dirección, siempre exacta y de fondo', () => {
    const s = drawItemShape({ kind: 'grid', x: 0, y: 0, w: 4000, h: 40, step: 1 })
    expect(gridLineCount(s.paths[0].d)).toBe(201 + 41)
    expect(s.outline).toHaveLength(0)
    expect(drawItemShape({ kind: 'grid', x: 0, y: 0, w: 100, h: 100 }).paths[0].d.match(/M/g)).toHaveLength(12)
  })
  it('la etiqueta de una cota se coloca fuera de la línea', () => {
    const [s] = placeAutoLabels([drawItemShape({ kind: 'measure', x1: 50, y1: 100, x2: 250, y2: 100, offset: 16, label: '4 cm' })], 300, 200)
    const l = s.labels[0]
    expect(l.y).toBeGreaterThan(116)
    expect(nums(s.paths[0].d).every(Number.isFinite)).toBe(true)
  })
})
