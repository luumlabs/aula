// Zoom y desplazamiento de una figura dentro de su ventana (port de FigureTransform en StudyUI/Blocks/Figure/FigureCanvas.swift).
// La figura a zoom 1 ocupa `fitted`; con zoom, cubre la ventana (o queda centrada si es más pequeña). Lógica pura.

export interface Size { width: number; height: number }
export interface ViewTransform {
  /** Tamaño de la figura a zoom 1 (ajustada a la ventana). */
  fitted: Size
  /** Tamaño de la ventana (lo que se ve). */
  viewport: Size
  scale: number
  /** Esquina superior izquierda de la figura (con zoom) en coordenadas de la ventana. */
  x: number
  y: number
}

export const MAX_SCALE = 6

export function makeTransform(fitted: Size, viewport: Size, scale = 1, origin?: { x: number; y: number }): ViewTransform {
  return clampTransform({ fitted, viewport, scale, x: origin?.x ?? (viewport.width - fitted.width) / 2, y: origin?.y ?? (viewport.height - fitted.height) / 2 })
}

export const scaledSize = (t: ViewTransform): Size => ({ width: t.fitted.width * t.scale, height: t.fitted.height * t.scale })

/** La figura cubre la ventana en cada eje (o queda centrada en él si es más pequeña). */
export function clampTransform(t: ViewTransform, maxScale = MAX_SCALE): ViewTransform {
  const scale = Math.min(Math.max(Number.isFinite(t.scale) ? t.scale : 1, 1), maxScale)
  const w = t.fitted.width * scale, h = t.fitted.height * scale
  const axis = (o: number, content: number, view: number): number => {
    const v = Number.isFinite(o) ? o : 0
    return content <= view ? (view - content) / 2 : Math.min(0, Math.max(view - content, v))
  }
  return { ...t, scale, x: axis(t.x, w, t.viewport.width), y: axis(t.y, h, t.viewport.height) }
}

/** Zoom alrededor de un punto de la ventana (lo que está bajo el cursor se queda quieto). */
export function zoomAround(t: ViewTransform, newScale: number, ax: number, ay: number, maxScale = MAX_SCALE): ViewTransform {
  const s = Math.min(Math.max(newScale, 1), maxScale)
  const k = s / t.scale
  return clampTransform({ ...t, scale: s, x: ax - (ax - t.x) * k, y: ay - (ay - t.y) * k }, maxScale)
}

export function panBy(t: ViewTransform, dx: number, dy: number, from: { x: number; y: number }): ViewTransform {
  return clampTransform({ ...t, x: from.x + dx, y: from.y + dy })
}

export function resetTransform(t: ViewTransform): ViewTransform {
  return makeTransform(t.fitted, t.viewport)
}

/** Punto de la figura (fracciones 0…1) → punto de la ventana. */
export function toView(t: ViewTransform, fx: number, fy: number): { x: number; y: number } {
  const s = scaledSize(t)
  const c = (v: number): number => (Number.isFinite(v) ? Math.min(3, Math.max(-2, v)) : 0.5)
  return { x: t.x + c(fx) * s.width, y: t.y + c(fy) * s.height }
}

/** Punto de la ventana → fracciones de la figura. */
export function toUnit(t: ViewTransform, px: number, py: number): { x: number; y: number } {
  const s = scaledSize(t)
  if (!(s.width > 0) || !(s.height > 0)) return { x: 0.5, y: 0.5 }
  return { x: (px - t.x) / s.width, y: (py - t.y) / s.height }
}

/** Medidas de la figura: ocupa el ancho disponible sin pasar de `maxHeight`. */
export function fittedSize(width: number, aspect: number, maxHeight: number): Size {
  const a = Number.isFinite(aspect) && aspect > 0.05 && aspect < 20 ? aspect : 4 / 3
  let w = Math.max(40, width), h = w / a
  if (h > maxHeight) { h = maxHeight; w = h * a }
  return { width: w, height: h }
}

export const sameSize = (a: Size, b: Size): boolean => Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
