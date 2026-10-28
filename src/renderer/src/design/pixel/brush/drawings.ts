// Piezas pequeñas de Aula que no salen de un personaje (la medalla y la llama de los logros, el sol y la luna del saludo):
// redibujadas a mano como dibujos (manchas + líneas en un tablero de 28 con 2 de margen), con la misma mano que los
// personajes. Cada una recibe sus colores (ya resueltos: los de la interfaz cambian con el tema) y su fotograma. Puro.
import type { Drawing } from './painter'

type P = [number, number]

const circle = (cx: number, cy: number, r: number, n = 18, rot = 0): P[] =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 10): P[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
  })
const sparkle = (cx: number, cy: number, r: number): P[] =>
  Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 4
    const rr = i % 2 ? r * 0.3 : r
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]
  })

/** Medalla de logro (simulacro aprobado): cinta en V, disco dorado con una estrella de cuatro puntas; `frame` mueve el brillo. */
export function medal(c: Record<string, string>, frame = 0): Drawing {
  const cx = 14
  const cy = 18.2
  return {
    stride: 28,
    shapes: [
      { fill: c.ribbon, pts: [[5.6, 3.4], [10.4, 3], [15.6, 13.4], [12, 14.8]], sharp: true },
      { fill: c.ribbonDark, pts: [[17.6, 3], [22.4, 3.4], [16, 14.8], [12.4, 13.4]], sharp: true },
      { fill: c.gold, pts: circle(cx, cy, 6.4, 18, 0.2) },
      { fill: c.goldLight, pts: circle(cx + 0.15, cy - 0.1, 4.5, 16, 0.5) },
      { fill: c.star, pts: [[14, 15.1], [14.85, 17.35], [17.1, 18.2], [14.85, 19.05], [14, 21.3], [13.15, 19.05], [10.9, 18.2], [13.15, 17.35]] }
    ],
    lines: [
      { pts: [[5.6, 3.4], [8, 8.1], [10.5, 12.6]], edge: true },
      { pts: [[10.4, 3], [12.5, 7.3], [13.9, 10.2]], weight: 0.8, edge: true },
      { pts: [[22.4, 3.4], [20, 8.1], [17.5, 12.6]], edge: true },
      { pts: [[17.6, 3], [15.6, 7.2], [14.6, 9.2]], weight: 0.8, edge: true },
      { pts: [[5.4, 3.5], [10.6, 2.9]], weight: 0.7, edge: true },
      { pts: [[17.4, 2.9], [22.6, 3.5]], weight: 0.7, edge: true },
      { pts: circle(cx, cy, 6.4, 22, 2.2), closed: true, edge: true },
      { pts: arc(cx + 0.15, cy - 0.1, 4.5, 4.5, 2.6, 5.9, 12), weight: 0.55 },
      { pts: arc(cx - 0.6, cy - 0.7, 3.3, 3.3, frame ? 3.5 : 3.0, frame ? 4.3 : 3.8, 5), color: c.star, weight: 0.9 }
    ]
  }
}

/** La llamita de la racha: llama exterior con una lengua, llama de dentro y corazón claro; `frame` inclina la punta. */
export function flame(c: Record<string, string>, frame = 0): Drawing {
  const t = frame ? -1.3 : 0.5
  const u = frame ? 0.7 : 0
  const outer: P[] = [
    [13.4 + t, 2.6],
    [16.4 + t * 0.4, 6.4],
    [19.2, 9.8],
    [21.2, 14],
    [21.6, 18.2],
    [20.2, 22],
    [17.2, 24.8],
    [14, 25.5],
    [10.6, 24.9],
    [7.8, 22.4],
    [6.6, 18.6],
    [7.2, 14.6],
    [8.4, 12.4],
    [7.9 - u, 8.6],
    [10.9, 10.9],
    [12.3 + t * 0.5, 6.8]
  ]
  const inner: P[] = [[14.6 + t * 0.5, 10.4], [16.9, 14], [17.9, 18.2], [16.9, 21.8], [14, 23.2], [11.2, 21.8], [10.3, 18.6], [11, 15.2], [12.6, 13.4]]
  return {
    stride: 28,
    shapes: [
      { fill: c.outer, pts: outer },
      { fill: c.inner, pts: inner },
      { fill: c.core, pts: circle(14, 20.2, 2.3, 12).map(([x, y]) => [x, 20.2 + (y - 20.2) * 1.2]) }
    ],
    lines: [
      // el contorno, de pinceladas que no llegan a cerrar abajo
      { pts: [[10.4, 24.8], [7.8, 22.4], [6.6, 18.6], [7.2, 14.6], [8.4, 12.4], [7.9 - u, 8.6]], edge: true },
      { pts: [[7.9 - u, 8.6], [10.9, 10.9], [12.3 + t * 0.5, 6.8], [13.4 + t, 2.6]], edge: true, weight: 0.9 },
      { pts: [[13.4 + t, 2.6], [16.4 + t * 0.4, 6.4], [19.2, 9.8], [21.2, 14], [21.6, 18.2], [20.2, 22], [17.2, 24.8], [14, 25.5], [12, 25.3]], edge: true },
      { pts: [[11.3, 21.4], [10.4, 18.6], [11.1, 15.3], [12.7, 13.4]], weight: 0.55 }
    ]
  }
}

/** El sol del saludo: disco con su luz y rayos que se alternan (largos y cortos) con el fotograma. */
export function sun(c: Record<string, string>, frame = 0): Drawing {
  const lines: Drawing['lines'] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const long = (i % 2 === 0) !== !!frame
    const r0 = 7.6
    const r1 = long ? 11.6 : 9.8
    lines.push({ pts: [[14 + Math.cos(a) * r0, 14 + Math.sin(a) * r0], [14 + Math.cos(a) * r1, 14 + Math.sin(a) * r1]], color: c.sun, weight: long ? 1.3 : 1 })
  }
  return {
    stride: 28,
    shapes: [
      { fill: c.sun, pts: circle(14, 14, 5.4, 18) },
      { fill: c.light, pts: circle(12.8, 12.8, 2.4, 12), alpha: 0.9 }
    ],
    lines: [...lines, { pts: circle(14, 14, 5.4, 20, 1), closed: true, edge: true, weight: 0.85 }]
  }
}

/** La luna del saludo: cuarto creciente con sus sombras y dos estrellitas que titilan (se turnan con el fotograma). */
export function moon(c: Record<string, string>, frame = 0): Drawing {
  const crescent: P[] = [...arc(12.6, 14, 8.4, 8.4, Math.PI * 0.42, Math.PI * 1.58, 16), ...arc(16.4, 12.8, 6.6, 6.8, Math.PI * 1.36, Math.PI * 0.62, 14)]
  const big: [number, number] = frame ? [21.6, 7.4] : [21.8, 19.4]
  const small: [number, number] = frame ? [21.4, 19.8] : [21.2, 7]
  return {
    stride: 28,
    shapes: [
      { fill: c.moon, pts: crescent },
      { fill: c.shade, pts: [...arc(12.6, 14, 8.4, 8.4, Math.PI * 0.62, Math.PI * 1.1, 8), ...arc(13.4, 14.4, 6.8, 7, Math.PI * 1.1, Math.PI * 0.66, 8)], alpha: 0.85 },
      { fill: c.star, pts: sparkle(big[0], big[1], 2.4) },
      { fill: c.star, pts: sparkle(small[0], small[1], 1.3), alpha: 0.7 }
    ],
    lines: [{ pts: crescent, closed: true, edge: true, weight: 0.85 }]
  }
}

export const DRAWINGS = { medal, flame, sun, moon }
export type DrawingName = keyof typeof DRAWINGS
