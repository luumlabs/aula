// Siluetas cortadas a mano: un polígono base que se deforma por subdivisión (cada punto medio se desplaza con azar
// gaussiano proporcional al lado, cada vez menos): el borde ondula como el de un papel recortado o una losa pintada.
import { gauss, type Rng } from './random'

/** Vértice con su propia «humedad» (`v`): cuánto se deforma el borde en esa zona (borde nítido o derramado). */
export interface Vertex {
  x: number
  y: number
  v: number
}

/** Elipse de `n` vértices con humedad variable alrededor. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, n: number, rng: Rng, wet: [number, number] = [0.08, 0.2], tilt = 0): Vertex[] {
  const out: Vertex[] = []
  const start = rng() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2
    const r = 1 + gauss(rng) * 0.05
    const x = Math.cos(a) * rx * r
    const y = Math.sin(a) * ry * r
    out.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt), v: wet[0] + (wet[1] - wet[0]) * rng() })
  }
  return out
}

/** Cuadrado de puntas redondas (superelipse de exponente `n`): la huella de un pincel plano. */
export function superellipse(cx: number, cy: number, rx: number, ry: number, n: number, count: number, rng: Rng, wet: [number, number], tilt = 0): Vertex[] {
  const out: Vertex[] = []
  const e = 2 / n
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count
    const c = Math.cos(a)
    const s = Math.sin(a)
    const x = Math.sign(c) * Math.abs(c) ** e * rx * (1 + gauss(rng) * 0.02)
    const y = Math.sign(s) * Math.abs(s) ** e * ry * (1 + gauss(rng) * 0.02)
    out.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt), v: wet[0] + (wet[1] - wet[0]) * rng() })
  }
  return out
}

/**
 * Deforma `depth` veces: cada lado gana un punto medio desplazado ~N(0, lado·humedad·spread). `decay` < 1 calma los rasgos
 * pequeños (borde que ondula sin parecer papel rasgado).
 */
export function deform(poly: Vertex[], depth: number, rng: Rng, spread = 1, decay = 0.78): Vertex[] {
  let p = poly
  for (let d = 0; d < depth; d++) {
    const out: Vertex[] = []
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      out.push(a)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const v = (a.v + b.v) / 2
      const sd = len * v * spread
      out.push({ x: (a.x + b.x) / 2 + gauss(rng) * sd, y: (a.y + b.y) / 2 + gauss(rng) * sd, v: v * decay * (0.82 + rng() * 0.36) })
    }
    p = out
  }
  return p
}

/** Área (con signo) del polígono: sirve a las pruebas para comprobar que la deformación no lo destroza. */
export function area(poly: { x: number; y: number }[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function trace(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, poly: Vertex[]): void {
  ctx.beginPath()
  ctx.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
  ctx.closePath()
}
