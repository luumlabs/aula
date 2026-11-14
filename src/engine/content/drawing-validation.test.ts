// Validación del dibujo: un caso por cada fallo nuevo que la IA debe corregir, y que lo de siempre siga sin avisos.
import { describe, expect, it } from 'vitest'
import { decodeBlock, type Block } from '@shared/schema'
import { ContentValidator } from './validator'
import { ContentNormalizer } from './normalizer'

const v = ContentValidator.withMath()
const block = (o: unknown): Block => decodeBlock(ContentNormalizer.block(JSON.parse(JSON.stringify(o))))!
const issues = (o: unknown): Array<{ severity: string; path: string; message: string }> => v.checkBlock(block(o), 'b')
const errors = (o: unknown): string[] => issues(o).filter((i) => i.severity === 'error').map((i) => i.message)
const warnings = (o: unknown): string[] => issues(o).filter((i) => i.severity === 'warning').map((i) => i.message)
const drawing = (items: unknown[], more: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'drawing', width: 400, height: 300, items, ...more })

describe('validación del dibujo', () => {
  it('lo de siempre sigue igual (el ejemplo de Pitágoras no da avisos)', () => {
    const d = drawing([
      { kind: 'polygon', points: [[70, 240], [330, 240], [70, 70]], fill: 'blue', opacity: 0.1 },
      { kind: 'rightAngle', cx: 70, cy: 240, r: 16 },
      { kind: 'angle', cx: 330, cy: 240, r: 42, start: 147, end: 180, label: '$\\alpha$' },
      { kind: 'text', x: 200, y: 262, text: '$b$', size: 17 }
    ])
    expect(issues(d)).toEqual([])
    expect(errors(drawing([]))).toContain('El dibujo está vacío.')
  })

  it('campos que faltan en los tipos nuevos', () => {
    expect(errors(drawing([{ kind: 'measure', x1: 0, y1: 0 }]))).toEqual(['«measure» necesita x1,y1,x2,y2 (los extremos de lo que mide).'])
    expect(errors(drawing([{ kind: 'brace', x2: 0, y2: 0 }]))[0]).toMatch(/brace/)
    expect(errors(drawing([{ kind: 'axes', x: 10, y: 10 }]))[0]).toMatch(/w y h mayores que 0/)
    expect(errors(drawing([{ kind: 'grid', x: 0, y: 0, w: 0, h: 10 }]))[0]).toMatch(/grid necesita/)
    expect(errors(drawing([{ kind: 'angle', points: [[1, 1], [2, 2]] }]))[0]).toMatch(/exactamente 3 puntos/)
    expect(errors(drawing([{ kind: 'angle', points: [[300, 100], [200, 100], [200, 0]] }]))).toEqual([])
  })

  it('objetos: desconocidos y demasiados', () => {
    expect(errors(drawing([{ kind: 'object', object: 'unicornio', x: 100, y: 100 }]))[0]).toMatch(/^Objeto «unicornio» desconocido\. Objetos: person, tree/)
    const many = Array.from({ length: 7 }, (_, i) => ({ kind: 'object', object: 'tree', x: 30 + i * 50, y: 150, w: 40 }))
    expect(warnings(drawing(many)).some((m) => m.includes('7 objetos son demasiados'))).toBe(true)
    // el normalizador entiende un objeto escrito como tipo
    expect(errors(drawing([{ kind: 'car', x: 200, y: 150, size: 80 }]))).toEqual([])
    // lo que se guarda para las versiones antiguas se lee como lo nuevo, sin avisos
    expect(issues(drawing([
      { kind: 'text', object: 'car', x: 200, y: 150, w: 80, label: 'Coche' },
      { kind: 'angle', points: [[300, 100], [200, 100], [200, 50]], cx: 200, cy: 100, start: 0, end: 90, r: 22 },
      { kind: 'rect', x: 10, y: 10, w: 40, h: 20, fillStyle: 'paper' }
    ]))).toEqual([])
  })

  it('ids repetidos', () => {
    expect(errors(drawing([{ kind: 'dot', id: 'a', cx: 1, cy: 1 }, { kind: 'dot', id: 'a', cx: 2, cy: 2 }]))[0]).toMatch(/id «a» está repetido/)
  })

  it('movimiento: expresiones con nombres conocidos y recorridos válidos', () => {
    const params = [{ name: 'v', min: 0, max: 10, step: 1, value: 0 }]
    expect(errors(drawing([{ kind: 'dot', cx: 10, cy: 10, motion: { dx: '3*v' } }], { params }))).toEqual([])
    expect(errors(drawing([{ kind: 'dot', cx: 10, cy: 10, motion: { dx: '3*w' } }], { params }))[0]).toMatch(/usa «w», que no está definido/)
    expect(errors(drawing([{ kind: 'dot', cx: 10, cy: 10, motion: { dx: '3*(v' } }], { params }))[0]).toMatch(/no válida/)
    expect(errors(drawing([{ kind: 'dot', cx: 10, cy: 10, motion: { along: 'nada', at: 'v/10' } }], { params }))[0]).toMatch(/no hay ningún elemento con id «nada»/)
    expect(errors(drawing([{ kind: 'text', id: 'tx', x: 1, y: 1, text: 'a' }, { kind: 'dot', cx: 10, cy: 10, motion: { along: 'tx', at: 'v/10' } }], { params }))[0]).toMatch(/solo se recorren/)
    expect(errors(drawing([
      { kind: 'circle', id: 'o', cx: 200, cy: 150, r: 50 },
      { kind: 'circle', id: 'm', cx: 250, cy: 150, r: 10, motion: { along: 'o', at: 'v/10' } },
      { kind: 'dot', cx: 260, cy: 150, motion: { along: 'm', at: 'v/10' } }
    ], { params }))[0]).toMatch(/viaja a su vez/)
    expect(warnings(drawing([{ kind: 'dot', cx: 10, cy: 10, motion: { dx: '3' } }])).some((m) => m.includes('nada que los mueva'))).toBe(true)
  })

  it('pasos: etapas, deslizadores y elementos rodeados', () => {
    const params = [{ name: 'v', min: 0, max: 10, step: 1, value: 0 }]
    const items = [{ kind: 'dot', id: 'p', cx: 10, cy: 10, stage: 1, motion: { dx: 'v' } }]
    expect(errors(drawing(items, { params, steps: [{ md: 'a', show: 1, params: { w: 2 } }, { md: 'b', highlight: ['zz'] }] }))).toEqual([
      'El deslizador «w» no existe (v).',
      'highlight: no hay ningún elemento con id «zz». Pon `id` al elemento que quieres rodear.'
    ])
    const w = warnings(drawing(items, { params, steps: [{ md: 'a' }, { md: 'b', show: 5, params: { v: 20 } }] }))
    expect(w.some((m) => m.includes('El primer paso no fija `show`'))).toBe(true)
    expect(w.some((m) => m.includes('show=5'))).toBe(true)
    expect(w.some((m) => m.includes('v=20 está fuera de su rango'))).toBe(true)
    expect(warnings(drawing([{ kind: 'dot', cx: 1, cy: 1, stage: 2 }])).some((m) => m.includes('`stage` solo sirve con `steps`'))).toBe(true)
  })

  it('un paso que rodea algo que todavía no se ve avisa (el estudiante vería todo atenuado y nada rodeado)', () => {
    const items = [
      { kind: 'circle', cx: 200, cy: 150, r: 100 },
      { kind: 'dot', id: 'A', cx: 100, cy: 150, label: 'A', anchor: 'auto' },
      { kind: 'dot', id: 'P', cx: 200, cy: 50, label: 'P', anchor: 'auto', stage: 2 }
    ]
    const steps = [{ md: 'El arco', show: 1, highlight: ['A'] }, { md: 'El punto', show: 1, highlight: ['P'] }, { md: 'Ya está', show: 2, highlight: ['P'] }]
    const all = issues(drawing(items, { steps }))
    const late = all.filter((i) => i.message.includes('todavía no se ve'))
    expect(late).toEqual([{ severity: 'warning', path: 'b.steps[1].highlight', message: 'highlight: «P» todavía no se ve en este paso (su stage es 2 y el paso enseña hasta show=1): sube `show` o baja su `stage`, o no se rodea nada.' }])
    // el `show` se arrastra de los pasos anteriores
    const carried = [{ md: 'a', show: 2 }, { md: 'b', highlight: ['P'] }]
    expect(issues(drawing(items, { steps: carried })).some((i) => i.message.includes('todavía no se ve'))).toBe(false)
  })

  it('solapes y formas fuera del lienzo, con la ruta del elemento', () => {
    const all = issues(drawing([{ kind: 'text', x: 100, y: 100, text: 'Fuerza' }, { kind: 'text', x: 103, y: 101, text: 'Peso' }, { kind: 'circle', cx: 395, cy: 100, r: 40 }]))
    expect(all.some((i) => i.message.includes('«Fuerza» y «Peso» se pisan'))).toBe(true)
    expect(all.find((i) => i.message.includes('se sale del lienzo'))?.path).toBe('b.items[2]')
  })

  it('dentro de una figura etiquetada el dibujo es fijo: el movimiento se ignora con un aviso', () => {
    const l = { type: 'labeled', alt: 'a', drawing: { width: 400, height: 300, items: [{ kind: 'circle', cx: 200, cy: 150, r: 50, motion: { dx: 'v' } }], params: [{ name: 'v', min: 0, max: 1, value: 0 }] }, parts: [{ id: 'a', name: 'A', x: 0.5, y: 0.5 }] }
    const all = issues(l)
    expect(all.some((i) => i.severity === 'warning' && i.message.includes('aquí el dibujo es fijo'.replace('aquí', 'Aquí')))).toBe(true)
    expect(all.filter((i) => i.severity === 'error')).toEqual([])
  })
})

describe('los ejemplos de la referencia del dibujo', () => {
  it('se leen y no dan errores ni avisos', async () => {
    const { DRAWING_REFERENCE } = await import('@engine/pipeline/drawingReference')
    const examples = DRAWING_REFERENCE.split('\n').filter((l) => l.startsWith('- ') && l.includes('{"type":"drawing"')).map((l) => l.slice(l.indexOf('{')))
    expect(examples.length).toBe(4)
    for (const json of examples) expect(issues(JSON.parse(json)), json.slice(0, 60)).toEqual([])
  })
})
