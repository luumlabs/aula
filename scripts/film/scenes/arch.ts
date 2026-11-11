// Acto II — El arco (18–31,6 s). A lo lejos, una luz cálida: un arco con el sol detrás. El estudiante camina hacia él
// contra el papel y, al cruzarlo, la noche se rompe.
import { clamp, col, ease, H, hash, lerp, mix, noise1, P, seg, smooth, W, type Pt } from '../engine/core.ts'
import { blob, ellipsePts, glow, paperOver, rays, sheet, sky, temp, wash, type Ctx, type Sheet } from '../engine/paint.ts'
import { arch, groundLine } from '../engine/props.ts'
import { student } from '../engine/figure.ts'
import { storm } from './night.ts'

const HORIZON = 652
const FAR: Pt = { x: 1430, y: HORIZON }
let wide: Sheet
let close: Sheet

export function initArch(): void {
  // el llano de noche: cielo, el resplandor del horizonte y dunas de papel
  wide = sheet()
  sky(wide.ctx, [[0, P.night0], [0.42, P.night1], [0.6, P.night2], [0.62, P.night1], [1, P.night0]])
  for (let i = 0; i < 7; i++) {
    wash(wide.ctx, blob(ellipsePts(hash(i, 41) * W, 120 + hash(i, 42) * 330, 300 + hash(i, 43) * 300, 60 + hash(i, 44) * 90, 16), 40, i + 60, 0.004), i % 2 ? P.night3 : P.night0, { alpha: 0.26, bleed: 40, edge: 0.12, grain: 0.7 })
  }
  // dunas de apuntes: lomas pálidas hasta el horizonte
  for (let i = 0; i < 12; i++) {
    const y = HORIZON + 14 + Math.pow(i / 11, 1.5) * 330
    const w = 280 + i * 60 + hash(i, 45) * 200
    const x = hash(i, 46) * (W + 400) - 200
    wash(wide.ctx, blob(ellipsePts(x, y + 40, w, 26 + i * 5, 14), 12, i + 80, 0.006), mix(P.mist, P.paper2, 0.25 + hash(i, 47) * 0.3), { alpha: 0.2 + i * 0.012, bleed: 12, edge: 0.3, grain: 0.6 })
  }
  groundLine(wide.ctx, -40, W + 40, HORIZON + 2, 31, P.night0, 7)

  // la noche de cerca, para el umbral
  close = sheet()
  sky(close.ctx, [[0, P.night0], [0.6, P.night1], [0.82, P.night2], [1, P.night0]])
  for (let i = 0; i < 6; i++) {
    wash(close.ctx, blob(ellipsePts(hash(i, 51) * W, 200 + hash(i, 52) * 400, 320 + hash(i, 53) * 280, 80 + hash(i, 54) * 100, 16), 40, i + 90, 0.004), P.night3, { alpha: 0.22, bleed: 40, edge: 0.12, grain: 0.7 })
  }
  const floor = new Path2D()
  floor.rect(-50, 868, W + 100, H)
  wash(close.ctx, floor, P.night0, { alpha: 0.8, bleed: 8, edge: 0.3, grain: 0.6 })
}

/** 18–27 s: el plano general. Un punto de luz en el horizonte y un caminante. */
export function drawFar(ctx: Ctx, t: number, frame: number): void {
  const k = seg(t, 18, 27)
  const zoom = lerp(1, 1.32, ease.io(k))
  const cx = lerp(W / 2, 1130, ease.io(k))
  const cy = lerp(H / 2, 610, ease.io(k))
  const pulse = 0.82 + 0.18 * Math.sin(t * 1.7) + noise1(t * 3, 5) * 0.05
  const view = (depth: number, draw: () => void): void => {
    const z = 1 + (zoom - 1) * (0.3 + depth * 0.7)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(z, z)
    ctx.translate(-(W / 2 + (cx - W / 2) * (0.3 + depth * 0.7)), -(H / 2 + (cy - H / 2) * (0.3 + depth * 0.7)))
    draw()
    ctx.restore()
  }
  ctx.drawImage(wide.canvas, 0, 0)
  view(0.2, () => {
    // el resplandor del horizonte y el arco, pequeño y encendido
    glow(ctx, FAR.x, FAR.y - 10, 760, P.brickLight, 0.26 * pulse)
    glow(ctx, FAR.x, FAR.y - 16, 330, P.glow, 0.62 * pulse)
    rays(ctx, FAR.x, FAR.y - 6, 520, P.glow, 0.42 * pulse, 7, -Math.PI * 0.94, -Math.PI * 0.06, 16, Math.sin(t * 0.25) * 0.03)
    arch(ctx, { cx: FAR.x, ground: FAR.y, width: 92, seed: 5, sun: 1, light: 0.9 * pulse, ink: P.night0, brick: P.brickLight })
    glow(ctx, FAR.x, FAR.y - 12, 62, P.sunCore, 0.95)
    // la luz tendida sobre el llano
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.filter = 'blur(26px)'
    const g = ctx.createRadialGradient(FAR.x, FAR.y + 40, 10, FAR.x, FAR.y + 40, 700)
    g.addColorStop(0, col(P.glow, 0.5 * pulse))
    g.addColorStop(1, col(P.glow, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(FAR.x, FAR.y + 60, 780, 74, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  })
  view(0.35, () => storm(ctx, t, lerp(0.42, 0.16, k), { seed: 3, from: 0, to: 0.9, speed: lerp(0.7, 0.35, k), light: FAR, lightOn: 0.6, warm: 0.5 }))
  view(0.7, () => {
    // el caminante y sus huellas
    const speed = 74
    const x = 250 + (t - 18) * speed
    const y = 806
    const phase = (t - 18) * 1.55
    for (let i = 0; i < Math.floor(phase * 2); i++) {
      const fx = 250 + ((i / 2 / 1.55) * speed) - 6
      const age = (phase * 2 - i) / 26
      if (age > 1) continue
      ctx.fillStyle = col(P.night0, 0.5 * (1 - age))
      ctx.beginPath()
      ctx.ellipse(fx, y + 4 + (i % 2) * 5, 9, 3, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    student(ctx, { x, y, size: 132, kind: 'walk', phase, lean: 0.34, shield: lerp(0.75, 0, smooth(seg(t, 19.5, 23))), wind: lerp(1.25, 0.7, k), time: t, frame, ink: P.night0 })
    // el filo de luz que le llega del arco
    glow(ctx, x + 14, y - 96, 46, P.glow, 0.22 * pulse * smooth(seg(t, 20, 26)))
  })
  const st = temp(4)
  storm(st.ctx, t, lerp(0.5, 0.2, k), { seed: 3, from: 0.9, to: 9, speed: lerp(0.7, 0.35, k), light: FAR, lightOn: 0.35, warm: 0.4, count: 200 })
  ctx.save()
  ctx.filter = 'blur(4px)'
  ctx.drawImage(st.canvas, 0, 0)
  ctx.restore()
  paperOver(ctx, 0.9)
  const open = 1 - ease.out(seg(t, 18, 19))
  if (open > 0) {
    ctx.fillStyle = mix(P.night3, '#c9d0de', open, open)
    ctx.fillRect(0, 0, W, H)
  }
}

export const GATE = { cx: 1190, ground: 868, width: 560 }

/** 27–31,6 s: el umbral. A contraluz, entra en el arco. */
export function drawGate(ctx: Ctx, t: number, frame: number): void {
  const k = seg(t, 27, 31.2)
  const zoom = lerp(1, 1.18, ease.io(k))
  const pulse = 0.9 + 0.1 * Math.sin(t * 2.1)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(zoom, zoom)
  ctx.translate(-lerp(W / 2, GATE.cx - 120, ease.io(k)), -lerp(H / 2, 600, ease.io(k)))
  ctx.drawImage(close.canvas, -200, -120, W + 400, H + 240)
  glow(ctx, GATE.cx, GATE.ground - 150, 1300, P.brickLight, 0.3 * pulse)
  rays(ctx, GATE.cx, GATE.ground - 60, 1500, P.glow, 0.5 * pulse, 21, -Math.PI * 0.98, -Math.PI * 0.02, 22, Math.sin(t * 0.3) * 0.02)
  // el vano: luz pura
  const r = GATE.width / 2 - 96 * (GATE.width / 420)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(GATE.cx - r, GATE.ground)
  ctx.lineTo(GATE.cx - r, GATE.ground - 504 * (GATE.width / 420) + 96 * (GATE.width / 420) + r)
  ctx.arc(GATE.cx, GATE.ground - 504 * (GATE.width / 420) + 96 * (GATE.width / 420) + r, r, Math.PI, 0)
  ctx.lineTo(GATE.cx + r, GATE.ground)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, GATE.ground - 520, 0, GATE.ground)
  g.addColorStop(0, col(P.dawn0, 0.95))
  g.addColorStop(0.6, col(P.sunCore, 1))
  g.addColorStop(1, col(P.glow, 1))
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
  arch(ctx, { cx: GATE.cx, ground: GATE.ground, width: GATE.width, seed: 9, sun: 1, light: 1, ink: P.night0, brick: P.brick })
  glow(ctx, GATE.cx, GATE.ground - 120, 520, P.sunCore, 0.5 * pulse)
  groundLine(ctx, -100, W + 200, GATE.ground + 3, 33, P.night0, 12)
  // su sombra, larga, hacia la cámara
  const x = lerp(430, GATE.cx - 6, ease.io(seg(t, 27, 30.5)))
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.filter = 'blur(6px)'
  ctx.fillStyle = P.night0
  ctx.beginPath()
  ctx.moveTo(x - 26, GATE.ground + 4)
  ctx.lineTo(x + 26, GATE.ground + 4)
  ctx.lineTo(x - (GATE.cx - x) * 0.9 + 40, GATE.ground + 210)
  ctx.lineTo(x - (GATE.cx - x) * 0.9 - 90, GATE.ground + 210)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  const into = seg(t, 30.0, 30.9)
  student(ctx, { x, y: GATE.ground + 2, size: lerp(318, 280, into), kind: 'walk', phase: (t - 27) * 1.5, lean: 0.12, reach: smooth(seg(t, 29.2, 30.2)) * 0.8, wind: lerp(0.7, 0.25, k), time: t, frame, ink: P.night0, alpha: 1 - into * 0.85 })
  ctx.restore()
  const st = temp(4)
  storm(st.ctx, t, lerp(0.3, 0.12, k), { seed: 5, from: 0.5, to: 9, speed: lerp(0.4, 0.12, k), light: { x: GATE.cx, y: GATE.ground - 200 }, lightOn: 0.9, warm: 0.8, count: 180 })
  ctx.save()
  ctx.filter = 'blur(3px)'
  ctx.drawImage(st.canvas, 0, 0)
  ctx.restore()
  paperOver(ctx, 0.9)
}

/** Centro de la floración de color (en pantalla) cuando cruza. */
export const BLOOM: Pt = { x: W / 2 + (GATE.cx - (GATE.cx - 120)) * 1.18, y: H / 2 + (GATE.ground - 260 - 600) * 1.18 }

/** Máscara de la floración: un círculo de borde irregular que crece desde el arco. Devuelve el Path2D en pantalla. */
export function bloomMask(t: number): Path2D | null {
  const k = ease.io(seg(t, 30.35, 31.75))
  if (k <= 0) return null
  const r = k * 2300
  const pts: Pt[] = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const rr = r * (1 + noise1(i * 0.9, 77) * 0.16 + noise1(i * 2.7 + t * 2, 78) * 0.05)
    pts.push({ x: BLOOM.x + Math.cos(a) * rr, y: BLOOM.y + Math.sin(a) * rr })
  }
  return blob(pts, 0, 1)
}

export const clampUnit = clamp
