// Acto I — La noche y la tormenta (0–18 s). Un estudiante diminuto en su mesa, entre torres de apuntes; quedan nueve días.
// El viento levanta el papel, la lámpara se apaga y la ventisca se lo traga.
import { bell, clamp, col, ease, H, hash, lerp, mix, noise1, P, resample, seg, smooth, W, type Pt } from '../engine/core.ts'
import { blob, brush, ellipsePts, glow, paperOver, sheet, sky, temp, title, wash, type Ctx, type Sheet } from '../engine/paint.ts'
import { desk, groundLine, lamp, paperSheet, stack, stackHeight } from '../engine/props.ts'
import { student } from '../engine/figure.ts'

const FLOOR = 800
const BULB: Pt = { x: 1066, y: 548 }
let back: Sheet
let far: Sheet
let mid: Sheet
let near: Sheet

export function initNight(): void {
  // fondo: la noche a la aguada, con nubes de tinta diluida y el suelo
  back = sheet()
  sky(back.ctx, [[0, P.night0], [0.55, P.night1], [0.78, P.night2], [1, P.night0]])
  for (let i = 0; i < 9; i++) {
    const cx = hash(i, 1) * W
    const cy = 150 + hash(i, 2) * 420
    wash(back.ctx, blob(ellipsePts(cx, cy, 260 + hash(i, 3) * 360, 70 + hash(i, 4) * 120, 16), 40, i + 10, 0.004), i % 2 ? P.night3 : P.night0, { alpha: 0.28, bleed: 36, edge: 0.15, grain: 0.7 })
  }
  // suelo: una aguada más oscura y su línea
  const ground = new Path2D()
  ground.rect(-50, FLOOR, W + 100, H)
  wash(back.ctx, ground, P.night0, { alpha: 0.75, bleed: 10, edge: 0.3, grain: 0.6 })

  // torres lejanas: una ciudad de papel, en bruma
  far = sheet()
  for (let i = 0; i < 26; i++) {
    const x = -60 + i * 80 + (hash(i, 5) - 0.5) * 50
    const n = 10 + Math.floor(hash(i, 6) * 38)
    stack(far.ctx, x, FLOOR - 6, 46 + hash(i, 7) * 34, n, 100 + i, 0.86, (hash(i, 8) - 0.5) * 0.5)
  }
  // torres medias
  mid = sheet()
  const mids: [number, number, number][] = [[250, 34, 110], [410, 22, 96], [560, 46, 104], [690, 16, 90], [1330, 30, 108], [1480, 52, 120], [1640, 26, 100], [1790, 40, 112]]
  mids.forEach(([x, n, w], i) => stack(mid.ctx, x, FLOOR + 6, w, n, 300 + i, 0.72, (hash(i, 9) - 0.5) * 0.7))
  groundLine(mid.ctx, 120, 1800, FLOOR + 8, 4, P.night0, 8)

  // primer término: torres enormes, fuera de foco, en los bordes
  near = sheet()
  stack(near.ctx, 70, H + 40, 330, 58, 500, 0.93, -0.5)
  stack(near.ctx, 1860, H + 60, 360, 70, 501, 0.93, 0.4)
  stack(near.ctx, 330, H + 80, 250, 22, 502, 0.95, 0.2)
}

/** Los relámpagos: cuándo caen y dónde. */
const BOLTS: [number, number][] = [[13.25, 430], [15.6, 1420]]
/** Cuánto alumbra el relámpago en este instante (0–1): un fogonazo, un parpadeo y la cola. */
function lightning(t: number): number {
  let f = 0
  for (const [at] of BOLTS) {
    const d = t - at
    if (d < 0 || d > 0.62) continue
    f = Math.max(f, d < 0.07 ? 1 : d < 0.13 ? 0.22 : d < 0.2 ? 0.85 : Math.max(0, 0.85 - (d - 0.2) * 2.1))
  }
  return f
}
function bolt(ctx: Ctx, x: number, seed: number, f: number): void {
  const pts: Pt[] = []
  let px = x
  for (let i = 0; i <= 9; i++) {
    pts.push({ x: px, y: -60 + i * 80 })
    px += (hash(i, seed) - 0.5) * 160
  }
  ctx.save()
  ctx.globalAlpha = f
  glow(ctx, pts[4].x, pts[4].y, 560, '#b9c8ee', 0.55)
  ctx.strokeStyle = '#f3f6ff'
  ctx.lineJoin = 'miter'
  ctx.lineWidth = 5.5
  ctx.beginPath()
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(pts[4].x, pts[4].y)
  ctx.lineTo(pts[4].x + 120, pts[4].y + 86)
  ctx.lineTo(pts[4].x + 96, pts[4].y + 196)
  ctx.lineTo(pts[4].x + 170, pts[4].y + 270)
  ctx.stroke()
  ctx.restore()
}

/** La gran ola de apuntes que se levanta detrás de él y se curva sobre su cabeza. `r` (0–1): cuánto ha crecido. */
function paperWave(ctx: Ctx, t: number, r: number): void {
  if (r <= 0) return
  const h = lerp(260, 800, r)
  const xb = lerp(W + 560, 1300, r)
  const g = FLOOR + 20
  const sway = Math.sin(t * 2.3) * 12
  const pts: Pt[] = [
    { x: xb + 950, y: g + 460 }, { x: xb + 540, y: g - 0.42 * h }, { x: xb + 180, y: g - 0.88 * h }, { x: xb - 0.2 * h, y: g - 1.0 * h },
    { x: xb - 0.5 * h + sway, y: g - 0.93 * h }, { x: xb - 0.65 * h + sway, y: g - 0.73 * h }, { x: xb - 0.53 * h + sway, y: g - 0.72 * h },
    { x: xb - 0.33 * h, y: g - 0.6 * h }, { x: xb - 0.25 * h, y: g - 0.3 * h }, { x: xb - 0.4 * h, y: g + 460 }
  ]
  const path = blob(pts, 9, 3 + Math.floor(t * 8), 0.004)
  wash(ctx, path, '#a3aecb', { alpha: 0.97, bleed: 4, edge: 0.5, grain: 0.35, to: P.night2, fromY: g - h, toY: g + 60 })
  // el filo de la cresta, que coge la poca luz que queda
  ctx.save()
  ctx.filter = 'blur(2px)'
  ctx.strokeStyle = col('#e4eaf8', 0.55)
  ctx.lineWidth = 7
  ctx.stroke(path)
  ctx.restore()
  // está hecha de hojas: por dentro, arrastradas hacia la cresta
  ctx.save()
  ctx.clip(path)
  for (let i = 0; i < 170; i++) {
    const drift = (t * (70 + hash(i, 703) * 130) + hash(i, 708) * 320) % 320
    paperSheet(ctx, {
      x: xb - 0.62 * h + hash(i, 701) * (0.62 * h + 980) - drift, y: g + 40 - hash(i, 702) * (h + 40) - drift * 0.45, w: 28 + hash(i, 704) * 34,
      rot: hash(i, 705) * 6 + t * 0.7, flip: hash(i, 706) * 6 + t * 1.6, seed: 2000 + i, shade: 0.42 + hash(i, 707) * 0.3, lines: false
    })
  }
  ctx.restore()
  // la espuma: hojas que saltan de la cresta
  resample([pts[1], pts[2], pts[3], pts[4], pts[5]], 54).forEach((q, i) => {
    const fly = (t * 1.6 + hash(i, 711) * 3) % 1
    paperSheet(ctx, {
      x: q.x - fly * 170 + (hash(i, 712) - 0.5) * 46, y: q.y - 14 - fly * 80 * hash(i, 713) + (hash(i, 714) - 0.5) * 34, w: 30 + hash(i, 715) * 30,
      rot: t * 2 + i, flip: t * 3.2 + i * 1.3, seed: 2200 + i, shade: 0.22 + hash(i, 716) * 0.25, alpha: 1 - fly * 0.6
    })
  })
}

interface Cam { x: number; y: number; zoom: number }
function plane(ctx: Ctx, cam: Cam, depth: number, draw: () => void, shake: Pt = { x: 0, y: 0 }): void {
  const k = 0.25 + depth * 0.75
  const z = 1 + (cam.zoom - 1) * k
  ctx.save()
  ctx.translate(W / 2 + shake.x * depth, H / 2 + shake.y * depth)
  ctx.scale(z, z)
  ctx.translate(-(W / 2 + (cam.x - W / 2) * k), -(H / 2 + (cam.y - H / 2) * k))
  draw()
  ctx.restore()
}

/** La ventisca de apuntes. `density` (0–1) cuántas hojas vuelan; `calm` las frena. */
export function storm(ctx: Ctx, t: number, density: number, o: { seed?: number; light?: Pt | null; lightOn?: number; speed?: number; from?: number; to?: number; count?: number; warm?: number } = {}): void {
  const { seed = 1, light = null, lightOn = 0, speed = 1, from = 0, to = 9, count = 520, warm = 0 } = o
  for (let i = 0; i < count; i++) {
    const z = 0.28 + hash(i, seed) * 1.9
    if (z < from || z >= to) continue
    const on = clamp((density - i / count) * 14)
    if (on <= 0) continue
    const v = (300 + hash(i, seed + 1) * 520) * z * speed
    const span = W * 1.5
    const x = W * 1.25 - ((hash(i, seed + 2) * span + v * t) % span)
    const y0 = hash(i, seed + 3) * (H + 200) - 100
    const y = y0 + Math.sin(t * (0.7 + hash(i, seed + 4) * 1.6) + i) * 60 * z - ((t * 30 * z * (hash(i, seed + 5) - 0.3)) % 200)
    const w = 30 * Math.pow(z, 1.25)
    let shade = clamp(0.78 - z * 0.12)
    if (light && lightOn > 0) {
      const d = Math.hypot(x - light.x, y - light.y)
      shade = lerp(shade, 0.1, lightOn * clamp(1 - d / 520))
    }
    paperSheet(ctx, {
      x, y, w, rot: t * (1.2 + hash(i, seed + 6) * 3) * speed + i, flip: t * (2 + hash(i, seed + 7) * 4.5) * speed + i * 2,
      seed: i, shade, tint: warm > 0 ? mix(P.paper, P.dawn1, warm * 0.6) : P.paper, alpha: on * (z > 1.7 ? 0.82 : 1), lines: z > 0.9, blurX: v * 0.03, blurY: 0
    })
  }
}

/** Rótulo al pie, dentro de la imagen panorámica. */
export function subtitle(ctx: Ctx, text: string, t: number, a: number, b: number, color = P.paper, y = H - 138 - 78, size = 46): void {
  const k = bell(t, a, a + 0.7, b - 0.7, b)
  if (k <= 0) return
  title(ctx, text, W / 2, y + (1 - ease.out(seg(t, a, a + 0.9))) * 14, size, color, k * 0.94, 1.5, 500, true)
}

export function drawNight(ctx: Ctx, t: number, frame: number): void {
  // cámara: nace en la bombilla y se aleja; en la tormenta, empuja hacia el estudiante y tiembla
  const pull = ease.io(seg(t, 1.0, 6.6))
  const push = ease.io(seg(t, 9.5, 15))
  // con el segundo relámpago, el plano se abre de golpe: él, diminuto, y la ola entera encima
  const wide = t >= BOLTS[1][0] - 0.02
  const cam: Cam = wide
    ? { x: W / 2, y: 548, zoom: lerp(1.0, 1.07, seg(t, BOLTS[1][0], 17.8)) }
    : { x: lerp(lerp(BULB.x, W / 2, pull), 900, push), y: lerp(lerp(BULB.y + 30, 560, pull), 600, push), zoom: lerp(lerp(3.1, 1, pull), 1.34, push) }
  const gust = smooth(seg(t, 7, 16))
  const shake: Pt = { x: noise1(t * 9, 3) * 7 * gust, y: noise1(t * 11, 4) * 5 * gust }
  // la luz de la lámpara: parpadea y muere
  const flick = t < 10.4 ? 1 : t < 12.5 ? clamp(0.55 + noise1(t * 23, 8) * 0.6 - seg(t, 11.6, 12.5) * 0.5) : 0
  const lightOn = flick * (1 - seg(t, 12.45, 12.6))
  const density = t < 6.8 ? 0 : lerp(0, 0.08, seg(t, 6.8, 9)) + Math.pow(seg(t, 9, 16), 1.6) * 0.92

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.drawImage(back.canvas, 0, 0)
  const flash = lightning(t)
  if (flash > 0.2) plane(ctx, cam, 0.15, () => BOLTS.forEach(([at, x], i) => t >= at && t < at + 0.62 && bolt(ctx, x, 40 + i, flash)), shake)

  // la ciudad de papel, en bruma
  plane(ctx, cam, 0.2, () => {
    ctx.filter = 'blur(2.5px)'
    ctx.globalAlpha = 0.5
    ctx.drawImage(far.canvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
  }, shake)
  // hojas lejanas
  plane(ctx, cam, 0.3, () => storm(ctx, t, density, { seed: 1, from: 0, to: 0.8 }), shake)
  plane(ctx, cam, 0.6, () => ctx.drawImage(mid.canvas, 0, 0), shake)
  // la ola
  plane(ctx, cam, 0.7, () => paperWave(ctx, t, ease.out(seg(t, 14.4, 17.0))), shake)

  // el rincón: mesa, flexo, estudiante, calendario
  plane(ctx, cam, 0.8, () => {
    // taburete
    brush(ctx, [{ x: 812, y: 728 }, { x: 900, y: 727 }], { width: 9, color: P.ink, seed: 71, taper: 0.3 })
    brush(ctx, [{ x: 826, y: 730 }, { x: 818, y: FLOOR }], { width: 6, color: P.ink, seed: 72, taper: 0.3 })
    brush(ctx, [{ x: 888, y: 730 }, { x: 896, y: FLOOR }], { width: 6, color: P.ink, seed: 73, taper: 0.3 })
    desk(ctx, 1050, 694, 440, 80)
    // apuntes sobre la mesa
    stack(ctx, 1180, 688, 96, 9, 601, 0.35)
    paperSheet(ctx, { x: 1000, y: 684, w: 92, rot: -0.08, flip: 1.38, seed: 9, shade: lerp(0.5, 0.05, lightOn) })
    paperSheet(ctx, { x: 1052, y: 686, w: 86, rot: 0.1, flip: 1.4, seed: 10, shade: lerp(0.55, 0.1, lightOn) })
    // el flexo (volcado hacia el estudiante)
    ctx.save()
    ctx.translate(1150, 688)
    ctx.scale(-1, 1)
    lamp(ctx, 0, 0, 1.05, 90)
    ctx.restore()
    // calendario sobre la torre de la derecha: el examen, rodeado
    const top = FLOOR + 6 - stackHeight(30, 304)
    const cx = 1330
    const cy = top - 84
    const lit = lerp(0.55, 0.12, lightOn)
    paperSheet(ctx, { x: cx, y: cy, w: 118, rot: 0.05, flip: 0.12, seed: 77, shade: lit, lines: false })
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(0.05)
    ctx.strokeStyle = mix(P.night3, P.ink, 0.4, 0.5)
    ctx.lineWidth = 1.2
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) ctx.strokeRect(-46 + c * 15.5, -40 + r * 19, 12, 14)
    ctx.fillStyle = col(P.brick, 0.75)
    ctx.fillRect(-46, -66, 93, 12)
    const circ = ellipsePts(-46 + 4 * 15.5 + 6, -40 + 3 * 19 + 7, 15, 14, 18, 0.3)
    brush(ctx, [...circ, circ[0], circ[1]], { width: 4.5, color: P.brick, seed: 78, taper: 0.5, progress: ease.io(seg(t, 5.0, 6.4)) })
    ctx.restore()

    // el estudiante: sentado, encorvado; cuando se va la luz se levanta y se cubre
    const up = smooth(seg(t, 11.0, 11.9))
    const wind = lerp(0.12, 1.35, smooth(seg(t, 7.5, 12)))
    if (up < 1) student(ctx, { x: 858, y: FLOOR, size: 262, kind: 'sit', lean: lerp(0.62, 0.3, seg(t, 9.5, 11)), wind, time: t, frame, alpha: 1 - up })
    if (up > 0) student(ctx, { x: 858, y: FLOOR, size: 262, kind: 'stand', lean: 0.18 + gust * 0.18, shield: smooth(seg(t, 11.8, 12.8)), wind, time: t, frame, alpha: up })
    // hojas que se levantan de las torres
    storm(ctx, t, density * (wide ? 0.55 : 1), { seed: 1, from: 0.8, to: 1.5, light: BULB, lightOn })
  }, shake)

  // la luz: cono sobre la mesa, halo y motas
  if (lightOn > 0) {
    plane(ctx, cam, 0.8, () => {
      const cone = temp(3)
      const c = cone.ctx
      c.setTransform(ctx.getTransform())
      c.filter = 'blur(22px)'
      const g = c.createLinearGradient(BULB.x, BULB.y, BULB.x - 80, FLOOR)
      g.addColorStop(0, col(P.glow, 0.55 * lightOn))
      g.addColorStop(0.5, col(P.glow, 0.2 * lightOn))
      g.addColorStop(1, col(P.glow, 0))
      c.fillStyle = g
      c.beginPath()
      c.moveTo(BULB.x - 6, BULB.y - 8)
      c.lineTo(BULB.x + 190, FLOOR + 30)
      c.lineTo(BULB.x - 430, FLOOR + 30)
      c.closePath()
      c.fill()
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'screen'
      ctx.drawImage(cone.canvas, 0, 0)
      ctx.restore()
      glow(ctx, BULB.x, BULB.y, 560, P.glow, 0.5 * lightOn)
      glow(ctx, BULB.x, BULB.y, 120, P.sunCore, 0.95 * lightOn)
      // motas de polvo en la luz
      for (let i = 0; i < 46; i++) {
        const x = BULB.x - 300 + hash(i, 31) * 520 + Math.sin(t * 0.3 + i) * 14
        const y = BULB.y + 20 + ((hash(i, 32) * 260 + t * (6 + hash(i, 33) * 9)) % 250)
        ctx.fillStyle = col(P.sunCore, 0.5 * lightOn * (0.3 + hash(i, 34) * 0.7))
        ctx.fillRect(x, y, 1.6, 1.6)
      }
    }, shake)
  }

  // primer término desenfocado y la ventisca cercana
  plane(ctx, cam, 1.5, () => {
    const n = temp(2)
    n.ctx.drawImage(near.canvas, 0, 0)
    n.ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'blur(9px)'
    ctx.drawImage(n.canvas, 0, 0)
    ctx.filter = 'none'
  }, shake)
  const nearStorm = temp(4)
  storm(nearStorm.ctx, t, density * (wide ? 0.3 : 1), { seed: 1, from: 1.5, to: 9, light: BULB, lightOn })
  ctx.save()
  ctx.filter = 'blur(5px)'
  ctx.drawImage(nearStorm.canvas, shake.x * 2, shake.y * 2)
  ctx.restore()

  // el frío que queda cuando se apaga la luz
  const cold = smooth(seg(t, 12.4, 14))
  if (cold > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = mix('#ffffff', '#8fa0c8', cold * 0.55)
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
  if (flash > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = col('#aebfe8', 0.5 * flash)
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
  paperOver(ctx, 0.9)
  // arranque desde negro y fundido final a papel (la ola rompe y lo cubre todo)
  const fadeIn = 1 - seg(t, 0.05, 0.9)
  if (fadeIn > 0) {
    ctx.fillStyle = `rgba(0,0,0,${fadeIn})`
    ctx.fillRect(0, 0, W, H)
  }
  subtitle(ctx, 'Nine days.', t, 5.9, 9.0)
  const white = ease.in(seg(t, 17.1, 18))
  if (white > 0) {
    ctx.fillStyle = mix(P.night3, '#c9d0de', white, white)
    ctx.fillRect(0, 0, W, H)
  }
}
