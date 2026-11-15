import { describe, expect, it } from 'vitest'
import type { DrawItem } from '@shared/schema/common'
import { drawingLayout, glideValues, type ItemFrame, type ShapeContext } from '@renderer/blocks/visual/lib/drawing'
import { prepareDrawingLayout } from '@renderer/blocks/visual/shared/drawingPreparation'
import { projectDrawingScene, type DrawingCommittedState } from './drawingState'

const context: ShapeContext = { measure: (text, size) => text.length * size * 0.55, unitsPerPx: 0.8 }
const palette = { paper: '#fcfaf5', text: '#201e1a', text2: '#585550', text3: '#6c6862', brick: '#b4502f', accent: '#029791', link: '#9c4527' }
const appearance = { theme: 'light' as const, language: 'es', direction: 'ltr' as const, palette }
const resolve = (value: string) => value.startsWith('#') ? value : palette.text
function committed(items: DrawItem[], extra: Partial<DrawingCommittedState> = {}): DrawingCommittedState {
  return { items, W: 400, H: 300, pixelWidth: 600, textK: 1.15, unitsPerPx: 0.8, prepared: prepareDrawingLayout(items, 400, 300, context, true, 'private-block-id'), seed: 'private-block-id', dark: false, animate: true, measureCtx: context, ...extra }
}
const freeze = (state: DrawingCommittedState) => projectDrawingScene(state, appearance, 18, resolve)

describe('instantánea Drawing del render comprometido', () => {
  it('congela el ancho CSS lógico sin recalcular etiquetas, texto ni rodeados preparados', () => {
    const state = committed([{ kind: 'circle', cx: 100, cy: 70, r: 30, label: 'A $x_1$' }], { focus: new Set([0]) })
    const original = freeze(state)
    const nested = projectDrawingScene(state, appearance, 18, resolve, { bodyFont: 'serif', bodyItalic: true, cssZoom: 1.75 }, 460.5)
    expect(original.metrics.layoutWidth).toBe(state.pixelWidth)
    expect(nested.metrics).toMatchObject({ pixelWidth: 600, layoutWidth: 460.5, textK: 1.15, unitsPerPx: .8, cssZoom: 1.75 })
    expect(nested.items).toEqual(original.items)
    expect(nested.items[0].labels[0].size).toBe(original.items[0].labels[0].size)
    expect(nested.items[0].rings[0]).toEqual(original.items[0].rings[0])
  })
  it('congela la tipografía heredada sin referencias ni CSS del contexto', () => {
    const state = committed([{ kind: 'text', x: 20, y: 30, text: 'Inherited serif typography' }])
    const typography = { bodyFont: 'serif' as const, bodyItalic: true, cssZoom: 1.8 }
    const scene = projectDrawingScene(state, appearance, 16, resolve, typography)
    typography.bodyItalic = false; typography.cssZoom = 2
    expect(scene.metrics).toMatchObject({ bodyFont: 'serif', bodyItalic: true, cssZoom: 1.8 })
    expect(JSON.stringify(scene)).not.toMatch(/font-family|font-style|ui-serif|Newsreader/)
    expect(freeze(state).metrics).toMatchObject({ bodyFont: 'sans', bodyItalic: false, cssZoom: 1 })
  })
  it('conserva el frame interpolado al pulsar y no retiene parámetros ni objetos mutables', () => {
    const values = glideValues({ x: 0 }, { x: 100 }, 0.5)
    const frame: ItemFrame = { dx: values.x, dy: -12, deg: 30.1234, px: 10, py: 20 }
    const state = committed([{ kind: 'text', x: 10, y: 20, text: '$x_1$' }], { frame: [frame] })
    const scene = freeze(state)
    expect(scene.items[0].transform).toEqual({ dx: 50, dy: -12, deg: 30.12, px: 10, py: 20 })
    expect(scene.items[0].labels[0]).toMatchObject({ x: 60, y: 8 })
    frame.dx = 100
    state.items[0].name = 'HIDDEN ANSWER'
    expect(scene.items[0].transform.dx).toBe(50)
    expect(JSON.stringify(scene)).not.toMatch(/private-block-id|HIDDEN|motion|params|stage|name/)
    expect(scene.metrics).toMatchObject({ pixelWidth: 600, textK: 1.15, unitsPerPx: 0.8, rootFontPx: 18 })
  })

  it('prepara todas las formas antes de filtrar, conserva índices y el trazo hand original', () => {
    const items: DrawItem[] = [{ kind: 'circle', cx: 40, cy: 40, r: 30, stage: 3, label: 'HIDDEN LABEL', name: 'HIDDEN NAME' }, { kind: 'line', x1: 50, y1: 40, x2: 150, y2: 40, label: 'visible', stage: 0 }]
    const state = committed(items, { show: 0 })
    const scene = freeze(state)
    expect(scene.items.map((item) => item.sourceIndex)).toEqual([1])
    expect(scene.items[0].paths[0].d).toBe(state.prepared.handD[1][0])
    expect(scene.items[0].labels.map(({ x, y }) => ({ x, y }))).toEqual(drawingLayout(items, 400, 300, context)[1].labels.map(({ x, y }) => ({ x, y })))
    expect(scene.items[0].paths[0].d).not.toBe(prepareDrawingLayout([items[1]], 400, 300, context, true, 'private-block-id').handD[0][0])
    expect(JSON.stringify(scene)).not.toContain('HIDDEN')
  })

  it('conserva atenuación, rayado, papel, guías y máscara seca de Ink', () => {
    const items: DrawItem[] = [{ kind: 'rect', x: -40, y: 20, w: 80, h: 30, fill: 'blue', fillStyle: 'hatch', label: 'A' }, { kind: 'circle', cx: 150, cy: 40, r: 20, label: 'B' }]
    const state = committed(items, { focus: new Set([1]) })
    const scene = freeze(state)
    expect(scene.items[0].opacity).toBe(0.3)
    expect(scene.items[0].paths.some((path) => path.fill.kind === 'hatch')).toBe(true)
    expect(scene.items[0].paths.some((path) => path.fill.kind === 'solid' && path.fill.color === palette.paper)).toBe(true)
    expect(scene.items[1].rings[0].strokes[0].dry.length).toBeGreaterThan(0)
    expect(scene.items[1].rings[0].strokes[0].spine.length).toBeGreaterThan(0)
    expect(scene.items[1].opacity).toBe(1)
    const hiddenItems = [...items, { kind: 'circle' as const, cx: 0, cy: 0, r: 1, stage: 3 }]
    const hiddenFocus = freeze(committed(hiddenItems, { show: 0, focus: new Set([2]) }))
    expect(hiddenFocus.items.every((item) => item.opacity === 1)).toBe(true)
  })

  it('preserva el desplazamiento de aguada de la rama viva animada, incluida la alternativa quieta', () => {
    const state = committed([{ kind: 'circle', cx: 80, cy: 80, r: 20 }])
    const path = state.prepared.shapes[0].paths[0]
    Object.assign(path, { hand: true, paper: true, fill: { color: 'blue', opacity: 0.2 } })
    const animated = freeze(state).items[0].paths
    expect(animated.map((path) => path.offset)).toEqual([{ x: 0.7, y: 0.9 }, { x: 0.7, y: 0.9 }, { x: 0, y: 0 }])
    const still = freeze({ ...state, animate: false }).items[0].paths
    expect(still.map((path) => path.offset)).toEqual([{ x: 0.7, y: 0.9 }, { x: 0, y: 0 }])
  })
})
