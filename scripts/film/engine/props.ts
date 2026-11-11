// Las cosas del corto: hojas de papel que vuelan, el arco de Aula con su sol, la mesa, la lámpara y las torres de apuntes.
import { clamp, hash, lerp, noise1, P, col, mix, type Pt } from './core.ts'
import { blob, brush, ellipsePts, glow, pen, wash, type Ctx } from './paint.ts'

export interface SheetOptions {
  x: number
  y: number
  /** Ancho en px (la hoja es un A4 en vertical). */
  w: number
  /** Giro en el plano. */
  rot: number
  /** Vuelco en profundidad (0 = de frente, π/2 = de canto). */
  flip: number
  seed: number
  /** Tono del papel y sombra (0 = a plena luz, 1 = en sombra). */
  shade?: number
  tint?: string
  alpha?: number
  /** Renglones de apuntes. */
  lines?: boolean
  /** Hacia qué color se va la hoja en sombra (de noche, el azul; de día, el papel viejo). */
  toward?: string
  /** Rastro de movimiento (px, en el sentido de `vx`,`vy`). */
  blurX?: number
  blurY?: number
}

/** Una hoja de apuntes en el aire. */
export function paperSheet(ctx: Ctx, o: SheetOptions): void {
  const { x, y, w, rot, flip, seed, shade = 0, tint = P.paper, alpha = 1, lines = true, blurX = 0, blurY = 0, toward = P.night2 } = o
  const h = w * 1.36
  const sy = Math.cos(flip)
  const back = sy < 0
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.scale(1, Math.max(0.06, Math.abs(sy)))
  ctx.globalAlpha *= alpha
  const base = mix(tint, toward, clamp(shade + (back ? 0.18 : 0)))
  if (blurX || blurY) {
    // rastro: copias cada vez más tenues hacia atrás
    for (let k = 3; k >= 1; k--) {
      ctx.globalAlpha = alpha * 0.16
      ctx.fillStyle = base
      ctx.fillRect(-w / 2 - (blurX * k) / 3, -h / 2 - (blurY * k) / 3, w, h)
    }
    ctx.globalAlpha = alpha
  }
  ctx.fillStyle = base
  ctx.beginPath()
  const c = w * 0.03
  ctx.moveTo(-w / 2 + c, -h / 2)
  ctx.lineTo(w / 2 - c, -h / 2 + hash(seed, 1) * 3)
  ctx.lineTo(w / 2, h / 2 - c)
  ctx.lineTo(-w / 2 + hash(seed, 2) * 3, h / 2)
  ctx.closePath()
  ctx.fill()
  if (lines && !back && w > 16) {
    ctx.strokeStyle = mix(P.night3, P.ink, 0.3, 0.32 * (1 - shade * 0.5))
    ctx.lineWidth = Math.max(0.6, w * 0.012)
    const rows = 9
    for (let i = 0; i < rows; i++) {
      const yy = -h / 2 + h * (0.14 + (i / rows) * 0.74)
      const len = w * (0.42 + hash(seed, 10 + i) * 0.4)
      ctx.beginPath()
      ctx.moveTo(-w * 0.38, yy)
      ctx.lineTo(-w * 0.38 + len, yy)
      ctx.stroke()
    }
    // un subrayado ladrillo, de vez en cuando
    if (hash(seed, 40) > 0.6) {
      ctx.strokeStyle = col(P.brick, 0.5)
      ctx.lineWidth = Math.max(1, w * 0.02)
      ctx.beginPath()
      ctx.moveTo(-w * 0.38, -h * 0.36)
      ctx.lineTo(w * 0.05, -h * 0.36)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export interface ArchOptions {
  cx: number
  /** y del suelo. */
  ground: number
  /** Ancho exterior del arco. */
  width: number
  seed?: number
  /** Cuánto ha salido el sol (0 = bajo el horizonte, 1 = medio sol). */
  sun?: number
  /** Luz que irradia (0–1). */
  light?: number
  /** Trazado de la tinta (0–1), para que se dibuje solo. */
  draw?: number
  ink?: string
  brick?: string
  /** Solo la silueta llena (para verlo de lejos, a contraluz). */
  silhouette?: boolean
  alpha?: number
}

const archPts = (cx: number, top: number, w: number, bottom: number, n = 22): Pt[] => {
  const r = w / 2
  const out: Pt[] = [{ x: cx - r, y: bottom }]
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI
    out.push({ x: cx + Math.cos(a) * r, y: top + r + Math.sin(a) * r })
  }
  out.push({ x: cx + r, y: bottom })
  return out
}

/** El arco de Aula con su sol: banda de ladrillo a la aguada, tinta con pulso y el sol asomando por la línea del suelo. */
export function arch(ctx: Ctx, o: ArchOptions): void {
  const { cx, ground, width, seed = 1, sun = 1, light = 0, draw = 1, ink = P.ink, brick = P.brick, silhouette = false, alpha = 1 } = o
  const k = width / 420
  const top = ground - 504 * k
  const band = 96 * k
  ctx.save()
  ctx.globalAlpha *= alpha
  if (light > 0) {
    glow(ctx, cx, ground - 40 * k, 620 * k, P.glow, 0.5 * light)
    glow(ctx, cx, ground - 20 * k, 300 * k, P.sunCore, 0.6 * light)
  }
  const outer = archPts(cx, top, width, ground)
  const inner = archPts(cx, top + band, width - band * 2, ground).reverse()
  const bandPath = new Path2D()
  ;[...outer, ...inner].forEach((q, i) => (i ? bandPath.lineTo(q.x, q.y) : bandPath.moveTo(q.x, q.y)))
  bandPath.closePath()
  if (silhouette) {
    ctx.fillStyle = ink
    ctx.fill(bandPath)
  } else {
    wash(ctx, bandPath, brick, { alpha: 0.9 * clamp(draw * 1.6 - 0.3), bleed: 5 * k + 1, edge: 0.4, grain: 0.55 })
  }
  // el sol
  const sr = 84 * k
  if (sun > 0) {
    const sy = ground + sr * (1 - sun) * 1.05
    ctx.save()
    ctx.beginPath()
    ctx.rect(cx - width, ground - sr * 3, width * 2, sr * 3)
    ctx.clip()
    const disc = blob(ellipsePts(cx, sy, sr, sr, 20), 2 * k, seed + 3, 0.03)
    wash(ctx, disc, P.sun, { alpha: 0.96, bleed: 3 * k + 0.5, edge: 0.3, grain: 0.25 })
    if (!silhouette) pen(ctx, ellipsePts(cx, sy, sr - 2 * k, sr - 2 * k, 26).slice(13, 27), ink, 7 * k, seed + 4, 2 * k, draw)
    ctx.restore()
  }
  if (!silhouette) {
    brush(ctx, outer, { width: 13 * k, color: ink, seed, taper: 0.35, shake: 3 * k, progress: draw, alpha: 0.92 })
    brush(ctx, archPts(cx, top + band + 2 * k, width - band * 2 - 4 * k, ground), { width: 12 * k, color: ink, seed: seed + 1, taper: 0.35, shake: 3 * k, progress: clamp(draw * 1.25 - 0.25), alpha: 0.92 })
  }
  ctx.restore()
}

/** Línea del suelo, a tinta. */
export function groundLine(ctx: Ctx, x0: number, x1: number, y: number, seed: number, color = P.ink, width = 9, progress = 1): void {
  const pts: Pt[] = []
  for (let i = 0; i <= 14; i++) {
    const s = i / 14
    pts.push({ x: lerp(x0, x1, s), y: y + noise1(s * 5, seed) * 7 })
  }
  brush(ctx, pts, { width, color, seed, taper: 0.8, dry: 0.35, progress })
}

/** Una torre de apuntes apilados (de canto): hojas finas, torcidas, con lomos. */
export function stack(ctx: Ctx, x: number, base: number, w: number, sheets: number, seed: number, shade = 0.5, lean = 0): void {
  let y = base
  for (let i = 0; i < sheets; i++) {
    const th = 5 + hash(seed, i) * 9
    const dx = (hash(seed, i + 100) - 0.5) * w * 0.16 + lean * i
    const ww = w * (0.8 + hash(seed, i + 200) * 0.28)
    const tone = mix(P.paper2, P.night2, clamp(shade + (hash(seed, i + 300) - 0.5) * 0.25))
    ctx.fillStyle = tone
    ctx.beginPath()
    ctx.moveTo(x - ww / 2 + dx, y)
    ctx.lineTo(x + ww / 2 + dx, y - (hash(seed, i + 400) - 0.5) * 3)
    ctx.lineTo(x + ww / 2 + dx + 2, y - th)
    ctx.lineTo(x - ww / 2 + dx - 1, y - th + (hash(seed, i + 500) - 0.5) * 3)
    ctx.closePath()
    ctx.fill()
    if (hash(seed, i + 600) > 0.82) {
      ctx.fillStyle = col(P.brick, 0.55 * (1 - shade * 0.6))
      ctx.fillRect(x - ww / 2 + dx + ww * 0.1, y - th, ww * 0.12, th)
    }
    y -= th + 0.6
  }
}

/** Altura de una torre (para colocar cosas encima). */
export function stackHeight(sheets: number, seed: number): number {
  let h = 0
  for (let i = 0; i < sheets; i++) h += 5 + hash(seed, i) * 9 + 0.6
  return h
}

/** La mesa: tablero y patas a tinta. */
export function desk(ctx: Ctx, x: number, y: number, w: number, seed: number, color = P.ink): void {
  brush(ctx, [{ x: x - w / 2, y }, { x: x + w / 2, y: y - 2 }], { width: 13, color, seed, taper: 0.25, dry: 0.2 })
  brush(ctx, [{ x: x - w / 2 + 26, y: y + 4 }, { x: x - w / 2 + 18, y: y + 150 }], { width: 9, color, seed: seed + 1, taper: 0.3 })
  brush(ctx, [{ x: x + w / 2 - 26, y: y + 4 }, { x: x + w / 2 - 16, y: y + 150 }], { width: 9, color, seed: seed + 2, taper: 0.3 })
}

/** El flexo: base, brazo articulado y pantalla; devuelve dónde está la bombilla. */
export function lamp(ctx: Ctx, x: number, y: number, s: number, seed: number, color = P.ink): Pt {
  const base: Pt = { x, y }
  const elbow: Pt = { x: x - 46 * s, y: y - 120 * s }
  const head: Pt = { x: x + 34 * s, y: y - 178 * s }
  brush(ctx, [{ x: x - 30 * s, y }, { x: x + 30 * s, y }], { width: 12 * s, color, seed, taper: 0.3 })
  brush(ctx, [base, elbow], { width: 7 * s, color, seed: seed + 1, taper: 0.2 })
  brush(ctx, [elbow, head], { width: 7 * s, color, seed: seed + 2, taper: 0.2 })
  // pantalla (un cono volcado hacia la mesa)
  ctx.fillStyle = color
  const p = blob([
    { x: head.x - 16 * s, y: head.y - 16 * s }, { x: head.x + 12 * s, y: head.y - 22 * s },
    { x: head.x + 62 * s, y: head.y + 26 * s }, { x: head.x + 16 * s, y: head.y + 46 * s }
  ], 1.5 * s, seed + 3, 0.05)
  ctx.fill(p)
  return { x: head.x + 40 * s, y: head.y + 38 * s }
}
