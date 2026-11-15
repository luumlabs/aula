// Presentación cerrada del dibujo visible: no contiene el bloque, expresiones ni nombres ocultos.
export interface DrawingRenderBounds { x: number; y: number; width: number; height: number }
export interface DrawingRenderTransform { dx: number; dy: number; deg: number; px: number; py: number }
export type DrawingRenderFill = { kind: 'none' } | { kind: 'solid' | 'hatch'; color: string }
export interface PreparedDrawingPath {
  d: string
  fill: DrawingRenderFill
  stroke: string
  width: number
  strokeOpacity: number
  fillOpacity: number
  dashed: boolean
  offset: { x: number; y: number }
}
// Posición en unidades del lienzo, ya movida; tamaño de letra en píxeles CSS del layout congelado.
export interface PreparedDrawingLabel {
  x: number
  y: number
  size: number
  anchor: 'left' | 'right' | 'center'
  text: string
  color: string
}
// Caja en píxeles CSS ya movida; viewWidth/viewHeight son las unidades propias del SVG de Ink.
export interface PreparedDrawingRing {
  x: number
  y: number
  width: number
  height: number
  viewWidth: number
  viewHeight: number
  color: string
  strokes: Array<{ d: string; spine: string; reach: number; dry: string; dryWidth: number }>
}
export interface PreparedVisibleItem {
  sourceIndex: number
  opacity: number
  /** Sólo transforma los paths; las etiquetas y los rodeados ya incorporan el frame. */
  transform: DrawingRenderTransform
  paths: PreparedDrawingPath[]
  labels: PreparedDrawingLabel[]
  rings: PreparedDrawingRing[]
}
export interface DrawingRenderSceneV1 {
  version: 1
  canvas: { width: number; height: number }
  metrics: { pixelWidth: number; textK: number; unitsPerPx: number; rootFontPx: number }
  appearance: {
    theme: 'light' | 'dark'
    language: string
    direction: 'ltr' | 'rtl'
    palette: { paper: string; text: string; text2: string; text3: string; brick: string; accent: string; link: string }
  }
  items: PreparedVisibleItem[]
  output: { scale: 1 | 2 }
}
/** Contrato privado main→renderer; no forma parte del puente de la aplicación. */
export interface DrawingRenderApi {
  render(scene: DrawingRenderSceneV1): Promise<{ bounds: DrawingRenderBounds; layoutWidth: number; layoutHeight: number }>
  resize(view: { width: number; height: number; scale: number; offsetX: number; offsetY: number }): Promise<{ width: number; height: number }>
  normalize(input: { data: string; width: number; height: number }): Promise<{ data: string; width: number; height: number }>
  cancel(): void
}
