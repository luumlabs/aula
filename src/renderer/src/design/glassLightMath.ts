// Cuánto se acerca la luz tras el cristal al puntero: una fracción del camino, sin salirse de la tarjeta.

export interface Point {
  x: number
  y: number
}

/**
 * Desplazamiento (px) que hay que aplicar a la luz, cuyo centro en reposo es `center`, para acercarse al puntero `pointer`
 * (ambos relativos a la tarjeta). Recorre `pull` del camino y su centro no pasa de un margen de la tarjeta.
 */
export function lightOffset(pointer: Point, box: { width: number; height: number }, center: Point, pull = 0.55): Point {
  if (!(box.width > 0) || !(box.height > 0)) return { x: 0, y: 0 }
  const fin = (v: number) => (Number.isFinite(v) ? v : 0)
  const p = { x: clamp(fin(pointer.x), 0, box.width), y: clamp(fin(pointer.y), 0, box.height) }
  const c = { x: fin(center.x), y: fin(center.y) }
  const k = clamp(fin(pull), 0, 1)
  // el centro de la luz se queda dentro de la tarjeta, con un margen del 8 %
  const tx = clamp(c.x + (p.x - c.x) * k, box.width * 0.08, box.width * 0.92)
  const ty = clamp(c.y + (p.y - c.y) * k, box.height * 0.08, box.height * 0.92)
  return { x: tx - c.x, y: ty - c.y }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
