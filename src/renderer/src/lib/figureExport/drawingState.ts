// Congelación síncrona del render comprometido; sólo la presentación visible cruza IPC.
import type { DrawItem } from '@shared/schema/common'
import type { DrawingRenderSceneV1, PreparedDrawingPath, PreparedVisibleItem } from '@shared/figuresDrawing'
import type { FigureTypography } from '@shared/figuresTypography'
import { applyFrame, type ItemFrame, type ShapeContext } from '@renderer/blocks/visual/lib/drawing'
import { prepareDrawingRing, type PreparedDrawingLayout } from '@renderer/blocks/visual/shared/drawingPreparation'
import { assertDrawingFontsReady } from './drawingFonts'
import { figureTypography } from './figureTypography'
import { PAPER, vizColor } from '@renderer/blocks/visual/shared/colors'

export interface DrawingCaptureHandle { freeze(language: string, direction: 'ltr' | 'rtl'): DrawingRenderSceneV1 }
export interface DrawingCommittedState {
  items: DrawItem[]
  W: number
  H: number
  pixelWidth: number
  textK: number
  unitsPerPx: number
  prepared: PreparedDrawingLayout
  frame?: ReadonlyArray<ItemFrame | undefined>
  show?: number
  focus?: ReadonlySet<number>
  seed: string
  dark: boolean
  animate: boolean
  measureCtx: ShapeContext
}

type Palette = DrawingRenderSceneV1['appearance']['palette']
/** Proyección explícita: ni el nombre del elemento ni una etapa oculta entran en el resultado. */
export function projectDrawingScene(state: DrawingCommittedState, appearance: DrawingRenderSceneV1['appearance'], rootFontPx: number, resolve: (css: string) => string, typography: FigureTypography = { bodyFont: 'sans', bodyItalic: false, cssZoom: 1 }, layoutWidth = state.pixelWidth): DrawingRenderSceneV1 {
  const { W, H, pixelWidth, textK, unitsPerPx, prepared, frame, show, focus, dark, seed, measureCtx } = state
  const k = pixelWidth / W
  const visible = (i: number): boolean => show === undefined || (state.items[i].stage ?? 0) <= show
  const lit = !!focus && [...focus].some(visible)
  const color = (value: string | undefined, fallback = 'var(--text)'): string => resolve(vizColor(value, fallback))
  const path = (d: string, fields: Partial<PreparedDrawingPath>): PreparedDrawingPath => ({ d, fill: { kind: 'none' }, stroke: 'none', width: 0, strokeOpacity: 1, fillOpacity: 1, dashed: false, offset: { x: 0, y: 0 }, ...fields })
  const items: PreparedVisibleItem[] = prepared.order.filter(visible).map((i) => {
    const shape = prepared.shapes[i]
    const fr = frame?.[i]
    const paths: PreparedDrawingPath[] = []
    shape.paths.forEach((p, j) => {
      const d = prepared.handD[i][j] || p.d
      const fill = p.fill ? { kind: p.fill.hatch ? 'hatch' as const : 'solid' as const, color: color(p.fill.color, p.fill.hatch ? 'var(--text2)' : 'var(--viz-accent, var(--accent))') } : { kind: 'none' as const }
      const base = p.fill?.opacity ?? 0
      const fillOpacity = dark && p.hand && p.paper && !p.fill?.hatch && base < 0.6 ? Math.min(0.85, base * 1.6) : base
      const shifted = p.hand && !p.fill?.hatch ? { x: 0.7, y: 0.9 } : { x: 0, y: 0 }
      const fades = p.dashed || p.fillOnly || p.fade
      const paper = !!p.paper && fill.kind !== 'none' && !p.fillOnly
      if (paper) paths.push(path(d, { fill: { kind: 'solid', color: appearance.palette.paper }, offset: state.animate && fades ? { x: 0, y: 0 } : shifted }))
      // La rama viva animada desplaza sólo la aguada; en movimiento reducido conserva la rama estática original.
      if (state.animate && !fades) {
        if (fill.kind !== 'none') paths.push(path(d, { fill, fillOpacity, offset: shifted }))
        if (!p.fillOnly && p.width > 0) paths.push(path(d, { stroke: color(p.stroke), width: p.width, strokeOpacity: p.alpha ?? 1, dashed: p.dashed }))
      } else paths.push(path(d, { fill, fillOpacity, stroke: p.fillOnly || p.width <= 0 ? 'none' : color(p.stroke), width: p.width, strokeOpacity: p.alpha ?? 1, dashed: p.dashed }))
    })
    for (const head of shape.heads) paths.push(path(head.d, { fill: { kind: 'solid', color: color(head.color) } }))
    for (const label of shape.labels) if (label.leader) {
      const [x1, y1, x2, y2] = label.leader
      paths.push(path(`M${x1} ${y1}L${x2} ${y2}`, { stroke: appearance.palette.text3, width: 0.9, strokeOpacity: 0.7 }))
    }
    const labels = shape.labels.map((label) => {
      const [x, y] = fr ? applyFrame([label.x, label.y], fr) : [label.x, label.y]
      return { x, y, text: label.text, size: label.size * textK, anchor: label.anchor, color: color(label.color) }
    })
    const ring = focus?.has(i) ? prepareDrawingRing(shape, fr, measureCtx, k, seed, i) : undefined
    return {
      sourceIndex: i,
      opacity: lit && !focus?.has(i) ? dark ? 0.42 : 0.3 : 1,
      // SVG vivo redondea su transform a centésimas; las etiquetas usan el frame exacto.
      transform: fr ? { dx: +fr.dx.toFixed(2), dy: +fr.dy.toFixed(2), deg: +fr.deg.toFixed(2), px: +fr.px.toFixed(2), py: +fr.py.toFixed(2) } : { dx: 0, dy: 0, deg: 0, px: 0, py: 0 },
      paths, labels,
      rings: ring ? [{ x: ring.x, y: ring.y, width: ring.width, height: ring.height, viewWidth: ring.drawing.w, viewHeight: ring.drawing.h, color: appearance.palette.brick, strokes: ring.drawing.strokes.map(({ d, spine, reach, dry, dryWidth }) => ({ d, spine, reach, dry, dryWidth })) }] : []
    }
  })
  return { version: 1, canvas: { width: W, height: H }, metrics: { pixelWidth, layoutWidth, textK, unitsPerPx, rootFontPx, bodyFont: typography.bodyFont, bodyItalic: typography.bodyItalic, cssZoom: typography.cssZoom }, appearance: { ...appearance, palette: { ...appearance.palette } }, items, output: { scale: 2 } }
}

export function freezeDrawingExportState(state: DrawingCommittedState, element: HTMLElement, language: string, direction: 'ltr' | 'rtl'): DrawingRenderSceneV1 {
  assertDrawingFontsReady(element)
  const document = element.ownerDocument
  const probe = document.createElement('span')
  probe.style.display = 'none'
  element.appendChild(probe)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) { probe.remove(); throw new Error('Canvas is unavailable') }
  const cache = new Map<string, string>()
  const resolve = (value: string): string => {
    const cached = cache.get(value)
    if (cached) return cached
    probe.style.color = value
    const css = getComputedStyle(probe).color
    if (!css || !CSS.supports('color', css)) throw new Error('Unresolved drawing color')
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const rgba = context.getImageData(0, 0, 1, 1).data
    if (rgba[3] !== 255) throw new Error('Drawing colors must be opaque')
    const hex = `#${[...rgba].slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`
    cache.set(value, hex)
    return hex
  }
  try {
    // El SVG vivo y los porcentajes HTML ocupan el ancho CSS; la preparación conserva su medida comprometida original.
    const layoutWidth = parseFloat(getComputedStyle(element).width)
    if (!Number.isFinite(layoutWidth) || layoutWidth <= 0) throw new Error('Drawing layout is unavailable')
    const palette: Palette = { paper: resolve(PAPER), text: resolve('var(--text)'), text2: resolve('var(--text2)'), text3: resolve('var(--text3)'), brick: resolve('var(--pigment-brick)'), accent: resolve('var(--viz-accent, var(--accent))'), link: resolve('var(--accent-text)') }
    return projectDrawingScene(state, { theme: state.dark ? 'dark' : 'light', language, direction, palette }, parseFloat(getComputedStyle(document.documentElement).fontSize), resolve, figureTypography(element), layoutWidth)
  } finally { probe.remove(); canvas.width = canvas.height = 0 }
}
