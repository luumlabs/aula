// La línea a mano alzada de los dibujos: un trazo recto o una curva exacta pasa a una línea que tiembla un poco, con el ruido
// suave del kit de pintura de Aula (sin rough.js). Determinista: la misma semilla da el mismo trazo en cada arranque. Las
// marcas de geometría (ángulos, cotas, ejes, rejilla) no pasan por aquí: se quedan exactas. Puro.
import { smoothPath, type Pt } from '@engine/drawing'
import { createNoise } from '@renderer/design/paint/noise'
import { resample } from '@renderer/design/paint/brush'

/** Cuánto tiembla la línea de un lienzo (unidades): un 0,35 % del lado más largo. */
export const handAmplitude = (W: number, H: number): number => Math.max(0.6, Math.min(4, Math.max(W, H) * 0.0035))

/**
 * Camino SVG a mano por unos puntos: se remuestrea cada ~6 unidades, cada punto se aparta un poco a lo largo de la normal
 * (ruido suave, periódico en las formas cerradas para que cierren sin salto) y las líneas abiertas se pasan un poco por
 * los extremos, como cuando la mano no frena del todo.
 */
export function handPath(points: readonly Pt[], closed: boolean, seed: number, amp: number): string {
  if (points.length < 2 || !(amp > 0)) return ''
  const src = points.map(([x, y]) => ({ x, y }))
  if (closed) src.push({ ...src[0] })
  let total = 0
  for (let i = 1; i < src.length; i++) total += Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y)
  if (total < 1e-6) return ''
  // las formas pequeñas tiemblan menos (un círculo de r < 8 no debe parecer una patata)
  const k = Math.min(1, total / 50)
  const a = amp * (0.35 + 0.65 * k)
  const step = Math.max(2.5, Math.min(6, total / 12))
  const pts = resample(src, step)
  if (closed && pts.length > 2) {
    const last = pts[pts.length - 1]
    if (Math.hypot(last.x - pts[0].x, last.y - pts[0].y) < step * 0.5) pts.pop()
  }
  const noise = createNoise(seed)
  const n = pts.length
  const scale = 46 // unidades por «ola» del temblor
  const R = total / (2 * Math.PI * scale)
  const out: Pt[] = []
  let s = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const tx = next.x - prev.x, ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len, ny = tx / len
    // en una forma cerrada el ruido se lee en un círculo: el final coincide con el principio
    const v = closed ? noise.at(R * Math.cos((2 * Math.PI * s) / total) + 50, R * Math.sin((2 * Math.PI * s) / total) + 50) : noise.at(s / scale + 7, 3.3)
    const off = (v - 0.5) * 2 * a
    out.push([pts[i].x + nx * off, pts[i].y + ny * off])
  }
  if (!closed && out.length >= 2) {
    // un poco de más en los extremos
    const over = a * 1.1
    const [x0, y0] = out[0], [x1, y1] = out[1]
    const l0 = Math.hypot(x0 - x1, y0 - y1) || 1
    out[0] = [x0 + ((x0 - x1) / l0) * over, y0 + ((y0 - y1) / l0) * over]
    const [xa, ya] = out[out.length - 1], [xb, yb] = out[out.length - 2]
    const l1 = Math.hypot(xa - xb, ya - yb) || 1
    out[out.length - 1] = [xa + ((xa - xb) / l1) * over * 0.6, ya + ((ya - yb) / l1) * over * 0.6]
  }
  return smoothPath(out, closed)
}
