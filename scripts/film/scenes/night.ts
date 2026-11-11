// Acto I — La noche y la tormenta (0–18 s). Un estudiante diminuto en su mesa, entre torres de apuntes; quedan nueve días.
// El viento levanta el papel, la lámpara se apaga y la ventisca se lo traga.
import { bell, clamp, col, ease, H, hash, lerp, mix, noise1, P, seg, smooth, W, type Pt } from '../engine/core.ts'
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
  const push = ease.io(seg(t, 9.5, 17.5))
  const cam: Cam = {
    x: lerp(lerp(BULB.x, W / 2, pull), 900, push),
    y: lerp(lerp(BULB.y + 30, 560, pull), 600, push),
    zoom: lerp(lerp(3.1, 1, pull), 1.5, push)
  }
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
    storm(ctx, t, density, { seed: 1, from: 0.8, to: 1.5, light: BULB, lightOn })
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
  storm(nearStorm.ctx, t, density, { seed: 1, from: 1.5, to: 9, light: BULB, lightOn })
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
  paperOver(ctx, 0.9)
  // arranque desde negro y fundido final a papel (la ventisca lo cubre todo)
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
