// Geometría de dibujo para los muñecos (puro): formas que un ilustrador repite (tubos que se afilan, losas redondeadas,
// franjas dentro de un óvalo, giros). Todo en coordenadas del sprite (0–24).
import type { P } from '../rigs'
export { arc, ellipse, move, star } from '../rigs'

/** Gira unos puntos `a` rad alrededor de (cx, cy). */
export function rot(pts: P[], cx: number, cy: number, a: number): P[] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c])
}

/** Losa de esquinas redondeadas (de x0,y0 a x1,y1, radio r). */
export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): P[] {
  const out: P[] = []
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2)
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
    }
  }
  corner(x1 - rr, y0 + rr, -Math.PI / 2)
  corner(x1 - rr, y1 - rr, 0)
  corner(x0 + rr, y1 - rr, Math.PI / 2)
  corner(x0 + rr, y0 + rr, Math.PI)
  return out
}

/** Interpola una polilínea en `n` puntos (para tubos y ondas). */
function along(pts: P[], n: number): { p: P; t: P }[] {
  const L: number[] = [0]
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = L[L.length - 1] || 1
  const out: { p: P; t: P }[] = []
  let j = 0
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * total
    while (j < pts.length - 2 && L[j + 1] < d) j++
    const seg = L[j + 1] - L[j] || 1
    const u = (d - L[j]) / seg
    const a = pts[j]
    const b = pts[j + 1]
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const tl = Math.hypot(tx, ty) || 1
    out.push({ p: [a[0] + tx * u, a[1] + ty * u], t: [tx / tl, ty / tl] })
  }
  return out
}

/** Contorno de un tubo que va de grosor w0 a w1 por un camino (una cola, un tentáculo, un tallo); punta redonda. */
export function tube(pts: P[], w0: number, w1: number, n = 18): P[] {
  const s = along(pts, n)
  const left: P[] = []
  const right: P[] = []
  s.forEach(({ p, t }, i) => {
    const w = (w0 + (w1 - w0) * (i / n)) / 2
    left.push([p[0] - t[1] * w, p[1] + t[0] * w])
    right.push([p[0] + t[1] * w, p[1] - t[0] * w])
  })
  const end = s[n]
  const cap: P[] = []
  const r1 = w1 / 2
  const a0 = Math.atan2(-end.t[0], end.t[1])
  for (let k = 1; k < 5; k++) {
    const a = a0 - (k / 5) * Math.PI
    cap.push([end.p[0] + Math.cos(a) * r1, end.p[1] + Math.sin(a) * r1])
  }
  return [...left, ...cap, ...right.reverse()]
}

/** La franja de un óvalo entre dos alturas (las rayas de la abeja, la banda del gorro). */
export function band(cx: number, cy: number, rx: number, ry: number, y0: number, y1: number, n = 8): P[] {
  const xAt = (y: number) => rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2))
  const left: P[] = []
  const right: P[] = []
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n
    const w = xAt(y)
    left.push([cx - w, y])
    right.push([cx + w, y])
  }
  return [...right, ...left.reverse()]
}

/** Una onda (de x0 a x1 a la altura y): para hilos de vapor, tentáculos, olas. */
export function wave(x0: number, y0: number, x1: number, y1: number, amp: number, waves: number, phase = 0, n = 16): P[] {
  const out: P[] = []
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const o = Math.sin(t * waves * Math.PI * 2 + phase) * amp
    out.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o])
  }
  return out
}
