// La cola de cometa del cursor-sol y la onda al pulsar: qué puntos se guardan y cómo se dibujan. Puro (sin DOM), para probarlo.

export interface TrailPoint {
  x: number
  y: number
  /** Milisegundos (el `timeStamp` del evento o `performance.now()`). */
  t: number
}

/** Cuánto vive cada punto de la cola: un movimiento rápido deja una cola larga; uno lento, casi nada. */
export const TRAIL_MS = 280
/** Grosor de la cola junto al sol (px, casi su diámetro); se afina hasta 0 en la punta. */
export const TRAIL_HEAD = 9
export const RIPPLE_MS = 450

/** Añade un punto y olvida los que ya se apagaron. Dos puntos casi en el mismo sitio no alargan la cola. */
export function addPoint(points: TrailPoint[], p: TrailPoint): TrailPoint[] {
  const last = points[points.length - 1]
  const out = last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5 ? points.slice(0, -1) : points.slice()
  out.push(p)
  return prune(out, p.t)
}

/** Los puntos que aún brillan en el instante `now`. */
export function prune(points: TrailPoint[], now: number): TrailPoint[] {
  let i = 0
  while (i < points.length && now - points[i].t > TRAIL_MS) i++
  return i ? points.slice(i) : points
}

/** La cola como una sola cinta que se afina: su contorno (un lado y vuelta por el otro) y sus dos extremos, para pintarla
 *  con un degradado de la punta vieja (transparente) al sol (cálida). null si no hay cola que pintar. */
export interface Ribbon {
  outline: [number, number][]
  tail: TrailPoint
  head: TrailPoint
  /** Opacidad junto al sol: baja cuando el cursor se queda quieto y la cola se recoge. */
  alpha: number
}

export function ribbon(points: TrailPoint[], now: number, head = TRAIL_HEAD): Ribbon | null {
  const n = points.length
  if (n < 2) return null
  const life = (p: TrailPoint): number => 1 - Math.min(1, Math.max(0, (now - p.t) / TRAIL_MS))
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    // normal a la dirección del movimiento en ese punto
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    // ancho: se afina hacia la punta vieja y se apaga con la edad
    const w = (head * life(points[i]) * (i / (n - 1))) / 2
    left.push([points[i].x + nx * w, points[i].y + ny * w])
    right.push([points[i].x - nx * w, points[i].y - ny * w])
  }
  const last = life(points[n - 1])
  if (last <= 0) return null
  return { outline: [...left, ...right.reverse()], tail: points[0], head: points[n - 1], alpha: 0.85 * last * last }
}

/** La onda de color ladrillo que abre al pulsar: radio y opacidad, o null si ya acabó. */
export function ripple(start: number, now: number): { r: number; alpha: number } | null {
  const k = (now - start) / RIPPLE_MS
  if (k < 0 || k >= 1) return null
  const out = 1 - (1 - k) ** 3
  return { r: 6 + 20 * out, alpha: 0.55 * (1 - k) }
}
