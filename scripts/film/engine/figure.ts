// El estudiante: una silueta a tinta con una bufanda color ladrillo (la única luz cálida de la noche). Se dibuja con
// formas llenas y pulso de mano; el contorno «hierve» de dos en dos fotogramas, como la animación tradicional.
import { clamp, lerp, noise1, P, smoothPath, wobble, type Pt } from './core.ts'
import { brush, type Ctx } from './paint.ts'

export interface Pose {
  x: number
  y: number
  /** Altura de la figura en px (de pie). */
  size: number
  /** 1 mira a la derecha, -1 a la izquierda. */
  facing?: number
  kind?: 'stand' | 'walk' | 'sit' | 'climb'
  /** Fase del paso (0–1, cíclica). */
  phase?: number
  /** Inclinación del cuerpo hacia delante (0–1). */
  lean?: number
  /** Brazo en alto, cubriéndose la cara (0–1). */
  shield?: number
  /** Brazo extendido hacia delante/arriba (0–1): tocar, alcanzar. */
  reach?: number
  /** Fuerza del viento en la bufanda (0–1.5) y su sentido (1 = hacia atrás). */
  wind?: number
  time: number
  frame: number
  ink?: string
  scarf?: string
  alpha?: number
}

/** Dibuja al estudiante con los pies en (x, y). */
export function student(ctx: Ctx, p: Pose): void {
  const { x, y, size, facing = 1, kind = 'stand', phase = 0, lean = 0, shield = 0, reach = 0, wind = 0.4, time, frame, ink = P.ink, scarf = P.brick, alpha = 1 } = p
  const u = size / 200
  const boil = Math.floor(frame / 2)
  const sit = kind === 'sit'
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(facing * u, u)
  ctx.globalAlpha *= alpha
  const cyc = phase * Math.PI * 2
  const walking = kind === 'walk' || kind === 'climb'
  const bob = walking ? Math.abs(Math.sin(cyc)) * -5 : 0
  const hipY = (sit ? -62 : -92) + bob
  const lx = lean * 26
  const shoulderY = hipY - (sit ? 62 : 70)
  const headY = shoulderY - 26
  const pts = (list: [number, number][]): Pt[] => list.map(([a, b]) => ({ x: a, y: b }))
  const W = (list: [number, number][], amp = 1.6, seed = 1): Path2D => smoothPath(wobble(pts(list), amp, 0.05, seed + boil), true)

  // piernas
  if (sit) {
    brush(ctx, pts([[-4, hipY], [30, hipY + 6], [34, -6]]), { width: 17, color: ink, seed: 3 + boil, taper: 0.25 })
    brush(ctx, pts([[4, hipY + 2], [40, hipY + 10], [46, -4]]), { width: 16, color: ink, seed: 4 + boil, taper: 0.25 })
    brush(ctx, pts([[30, -6], [50, -3]]), { width: 11, color: ink, seed: 5, taper: 0.4 })
  } else {
    const stride = walking ? 30 : 7
    const a = Math.sin(cyc)
    const b = Math.sin(cyc + Math.PI)
    const lift = (s: number): number => Math.max(0, Math.cos(cyc + (s > 0 ? 0 : Math.PI))) * (kind === 'climb' ? -20 : -10)
    const foot = (s: number, k: number): [number, number] => [s * stride, walking ? lift(k) : 0]
    const f1 = foot(a, 1)
    const f2 = foot(b, -1)
    brush(ctx, pts([[-5, hipY], [f1[0] * 0.45 - 3, hipY * 0.5 + f1[1] * 0.4], [f1[0], f1[1] - 2]]), { width: 18, color: ink, seed: 3 + boil, taper: 0.3 })
    brush(ctx, pts([[5, hipY], [f2[0] * 0.45 + 3, hipY * 0.5 + f2[1] * 0.4], [f2[0], f2[1] - 2]]), { width: 17, color: ink, seed: 4 + boil, taper: 0.3 })
    brush(ctx, pts([[f1[0] - 2, f1[1] - 1], [f1[0] + 15, f1[1]]]), { width: 10, color: ink, seed: 5, taper: 0.4 })
    brush(ctx, pts([[f2[0] - 2, f2[1] - 1], [f2[0] + 15, f2[1]]]), { width: 10, color: ink, seed: 6, taper: 0.4 })
  }

  // mochila
  ctx.fillStyle = ink
  ctx.fill(W([[-30 + lx * 0.6, shoulderY + 6], [-16 + lx * 0.7, shoulderY + 2], [-14 + lx * 0.3, hipY - 12], [-32 + lx * 0.2, hipY - 10]], 1.4, 21))

  // abrigo
  ctx.fill(W([
    [-17 + lx, shoulderY], [-4 + lx, shoulderY - 7], [12 + lx, shoulderY - 4], [20 + lx * 0.9, shoulderY + 12],
    [24 + lx * 0.3, hipY - 6], [27, hipY + (sit ? 10 : 20)], [0, hipY + (sit ? 14 : 26)], [-25, hipY + (sit ? 8 : 18)], [-20 + lx * 0.3, hipY - 20]
  ], 1.8, 31))

  // brazo
  const sh: [number, number] = [8 + lx, shoulderY + 6]
  let elbow: [number, number]
  let hand: [number, number]
  if (shield > 0.01) {
    elbow = [lerp(14, 34, shield) + lx, lerp(shoulderY + 44, shoulderY + 8, shield)]
    hand = [lerp(12, 30, shield) + lx, lerp(hipY + 4, headY - 12, shield)]
  } else if (reach > 0.01) {
    elbow = [lerp(14, 36, reach) + lx, lerp(shoulderY + 44, shoulderY + 4, reach)]
    hand = [lerp(12, 66, reach) + lx, lerp(hipY + 4, shoulderY - 30, reach)]
  } else if (sit) {
    elbow = [26 + lx, shoulderY + 40]
    hand = [58 + lx * 0.6, shoulderY + 44]
  } else {
    const swing = walking ? Math.sin(cyc + Math.PI) * 16 : 0
    elbow = [10 + lx + swing * 0.5, shoulderY + 42]
    hand = [10 + lx * 0.5 + swing, hipY + 6]
  }
  brush(ctx, pts([sh, elbow, hand]), { width: 13, color: ink, seed: 41 + boil, taper: 0.3 })

  // cabeza
  const hx = lx * 1.25 + (sit ? 6 : 2)
  ctx.beginPath()
  ctx.fill(W([[hx - 15, headY - 2], [hx - 9, headY - 16], [hx + 6, headY - 17], [hx + 16, headY - 6], [hx + 14, headY + 9], [hx + 2, headY + 15], [hx - 11, headY + 10]], 1.2, 51))
  // mechón
  brush(ctx, pts([[hx - 2, headY - 15], [hx + 10, headY - 22], [hx + 19, headY - 15]]), { width: 7, color: ink, seed: 52 + boil, taper: 0.7 })

  // bufanda: una cinta que ondea hacia atrás
  const neck: Pt = { x: hx - 6, y: shoulderY - 3 }
  const tail: Pt[] = [neck]
  const len = 70 + wind * 62
  for (let i = 1; i <= 9; i++) {
    const s = i / 9
    const wave = Math.sin(time * (3.2 + wind * 2.4) - s * 4.6) * (6 + wind * 16) * s + noise1(time * 1.7 + s * 3, 9) * 9 * s
    const droop = (1 - clamp(wind)) * 46 * s * s
    tail.push({ x: neck.x - s * len * (0.35 + clamp(wind) * 0.65), y: neck.y + 6 * s + wave + droop })
  }
  brush(ctx, tail, { width: 15, color: scarf, seed: 61, taper: 0.55, shake: 0.5 })
  // vuelta de la bufanda al cuello
  brush(ctx, [{ x: hx - 12, y: shoulderY - 1 }, { x: hx + 2, y: shoulderY + 4 }, { x: hx + 14, y: shoulderY - 2 }], { width: 13, color: scarf, seed: 62, taper: 0.3, shake: 0.4 })
  ctx.restore()
}
