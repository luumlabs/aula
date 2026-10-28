// Curvas de animación compartidas por el capturador (cursor) y el compositor (cámara, titulares, sol).
import type { Ease } from './types.ts'

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Muelle críticamente amortiguado normalizado (llega a 1 sin rebote visible, con la salida suave de motion). */
function spring(t: number): number {
  const w = 9
  return 1 - (1 + w * t) * Math.exp(-w * t)
}

export function ease(kind: Ease | undefined, t: number): number {
  const x = clamp01(t)
  switch (kind ?? 'inOut') {
    case 'linear':
      return x
    case 'in':
      return x * x * x
    case 'out':
      return 1 - Math.pow(1 - x, 3)
    case 'smooth':
      // la curva única de la cámara: «smootherstep» (velocidad y aceleración nulas en los dos extremos, sin rebote)
      return x * x * x * (x * (x * 6 - 15) + 10)
    case 'spring': {
      // normaliza para que spring(1) = 1 exacto
      return spring(x) / spring(1)
    }
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
  }
}
