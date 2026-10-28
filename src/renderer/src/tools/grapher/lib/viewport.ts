// Vista de la gráfica: centro y escala (unidades por píxel, la misma en x e y salvo que se estire), con zoom que deja
// quieto el punto bajo el ratón.

export interface Viewport {
  cx: number
  cy: number
  /** Unidades de x por píxel. */
  ux: number
  /** Unidades de y por píxel. */
  uy: number
}

export const DEFAULT_SPAN = 16

export function defaultViewport(width: number): Viewport {
  const u = DEFAULT_SPAN / Math.max(10, width)
  return { cx: 0, cy: 0, ux: u, uy: u }
}

export function rangeOf(v: Viewport, w: number, h: number): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const hw = (v.ux * w) / 2
  const hh = (v.uy * h) / 2
  return { xMin: v.cx - hw, xMax: v.cx + hw, yMin: v.cy - hh, yMax: v.cy + hh }
}

/** Coordenadas de la gráfica de un punto de la vista (origen arriba a la izquierda). */
export function toWorld(v: Viewport, w: number, h: number, px: number, py: number): [number, number] {
  return [v.cx + (px - w / 2) * v.ux, v.cy - (py - h / 2) * v.uy]
}

export function toScreen(v: Viewport, w: number, h: number, x: number, y: number): [number, number] {
  return [w / 2 + (x - v.cx) / v.ux, h / 2 - (y - v.cy) / v.uy]
}

export function panned(v: Viewport, dxPx: number, dyPx: number): Viewport {
  return { ...v, cx: v.cx - dxPx * v.ux, cy: v.cy + dyPx * v.uy }
}

/** Acerca (factor < 1) o aleja (> 1) dejando quieto el punto `anchor` (coordenadas de la gráfica). */
export function zoomed(v: Viewport, factor: number, anchor?: [number, number]): Viewport {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  const ux = Math.min(1e5, Math.max(1e-7, v.ux * f))
  const uy = Math.min(1e5, Math.max(1e-7, v.uy * f))
  const [ax, ay] = anchor ?? [v.cx, v.cy]
  return { cx: ax - ((ax - v.cx) * ux) / v.ux, cy: ay - ((ay - v.cy) * uy) / v.uy, ux, uy }
}
