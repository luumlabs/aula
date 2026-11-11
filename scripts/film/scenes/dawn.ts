// Acto III — Al otro lado (31,6–49,6 s). La noche se vuelve amanecer de acuarela. Las hojas se ordenan solas en una
// escalera; por el camino flotan las cosas que antes eran apuntes; el sol cuenta los nueve días. Arriba, el examen: listo.
import { bell, clamp, col, ease, H, hash, lerp, mix, noise1, P, seg, smooth, W, type Pt } from '../engine/core.ts'
import { blob, brush, ellipsePts, glow, paperOver, pen, rays, sheet, sky, title, wash, type Ctx, type Sheet } from '../engine/paint.ts'
import { arch, desk, groundLine, paperSheet, stack } from '../engine/props.ts'
import { student } from '../engine/figure.ts'
import { subtitle } from './night.ts'

let back: Sheet
let hills: Sheet
let room: Sheet
const T0 = 31.6
const STEPS = 26
const SUN: Pt = { x: 1500, y: 300 }

/** La escalera: de abajo a la izquierda hasta el sol. */
function stepAt(i: number): Pt {
  const s = i / (STEPS - 1)
  return { x: lerp(170, 1310, s) + Math.sin(s * Math.PI) * 60, y: lerp(1010, 470, Math.pow(s, 0.92)) + Math.sin(s * Math.PI * 2) * 16 }
}

export function initDawn(): void {
  back = sheet()
  sky(back.ctx, [[0, P.dawn4], [0.3, P.dawn3], [0.55, P.sky], [0.78, P.dawn0], [1, P.dawn1]])
  // nubes a la aguada, mojado sobre mojado
  for (let i = 0; i < 16; i++) {
    const c = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? P.dawn1 : P.dawn2
    wash(back.ctx, blob(ellipsePts(hash(i, 61) * (W + 300) - 150, 90 + hash(i, 62) * 520, 180 + hash(i, 63) * 340, 34 + hash(i, 64) * 70, 16), 26, i + 110, 0.005), c, { alpha: i % 3 === 0 ? 0.5 : 0.3, bleed: 30, edge: 0.18, grain: 0.5 })
  }
  hills = sheet()
  const ridge = (y: number, amp: number, seed: number): Path2D => {
    const pts: Pt[] = [{ x: -80, y: H + 60 }]
    for (let i = 0; i <= 24; i++) pts.push({ x: -80 + (i / 24) * (W + 160), y: y + noise1(i * 0.42, seed) * amp + noise1(i * 1.3, seed + 1) * amp * 0.3 })
    pts.push({ x: W + 80, y: H + 60 })
    return blob(pts, 0, 1)
  }
  wash(hills.ctx, ridge(760, 60, 201), P.dawn3, { alpha: 0.6, bleed: 10, edge: 0.4, grain: 0.6 })
  wash(hills.ctx, ridge(850, 46, 202), P.sea, { alpha: 0.42, bleed: 10, edge: 0.4, grain: 0.6 })
  wash(hills.ctx, ridge(940, 40, 203), P.leaf, { alpha: 0.5, bleed: 9, edge: 0.4, grain: 0.6 })
  wash(hills.ctx, ridge(1020, 26, 204), P.dawn2, { alpha: 0.5, bleed: 8, edge: 0.4, grain: 0.6 })

  // la sala del examen: una pared de papel con una ventana en arco por la que entra la mañana
  room = sheet()
  sky(room.ctx, [[0, P.dawn0], [0.7, P.paper], [1, P.paper2]])
  for (let i = 0; i < 8; i++) {
    wash(room.ctx, blob(ellipsePts(hash(i, 71) * W, hash(i, 72) * H, 300 + hash(i, 73) * 300, 120 + hash(i, 74) * 160, 14), 30, i + 130, 0.004), i % 2 ? P.dawn1 : P.paperShade, { alpha: 0.2, bleed: 40, edge: 0.1, grain: 0.6 })
  }
  const floor = new Path2D()
  floor.rect(-50, 838, W + 100, H)
  wash(room.ctx, floor, P.paperShade, { alpha: 0.55, bleed: 8, edge: 0.35, grain: 0.6 })
}

/** Molécula que gira: bolas y varillas a tinta y acuarela. */
function molecule(ctx: Ctx, x: number, y: number, s: number, t: number, appear: number): void {
  if (appear <= 0) return
  const k = ease.outBack(appear)
  const atoms: { p: [number, number, number]; r: number; c: string }[] = [
    { p: [0, 0, 0], r: 30, c: P.brick }, { p: [1, 0.25, 0], r: 21, c: P.sea }, { p: [-0.6, 0.75, 0.55], r: 21, c: P.sea },
    { p: [-0.4, -0.2, -0.95], r: 21, c: P.leaf }, { p: [0.1, -1, 0.3], r: 21, c: P.sun }, { p: [1.75, 0.75, 0.35], r: 15, c: P.paper2 }
  ]
  const a = t * 0.7
  const proj = atoms.map((at) => {
    const x3 = at.p[0] * Math.cos(a) + at.p[2] * Math.sin(a)
    const z3 = -at.p[0] * Math.sin(a) + at.p[2] * Math.cos(a)
    const y3 = at.p[1] * Math.cos(0.4) - z3 * Math.sin(0.4)
    return { x: x + x3 * 92 * s * k, y: y + y3 * 92 * s * k, z: z3, r: at.r * s * k * (1 + z3 * 0.18), c: at.c }
  })
  const bonds: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5]]
  ctx.save()
  ctx.globalAlpha *= clamp(appear * 2)
  for (const [i, j] of bonds) pen(ctx, [{ x: proj[i].x, y: proj[i].y }, { x: proj[j].x, y: proj[j].y }], P.ink, 5 * s, 300 + i * 7 + j, 1.5)
  for (const q of [...proj].sort((m, n) => m.z - n.z)) {
    const disc = blob(ellipsePts(q.x, q.y, q.r, q.r, 16), 1.5, 310, 0.03)
    ctx.fillStyle = P.paper
    ctx.fill(disc)
    wash(ctx, disc, q.c, { alpha: 0.92, bleed: 2, edge: 0.45, grain: 0.35 })
    pen(ctx, [...ellipsePts(q.x, q.y, q.r, q.r, 18), { x: q.x + q.r, y: q.y }], P.ink, 3.4 * s, 320, 1)
  }
  ctx.restore()
}

/** Una onda que se dibuja sola sobre sus ejes, con un punto que la recorre. */
function wave(ctx: Ctx, x: number, y: number, w: number, h: number, t: number, start: number): void {
  const ax = ease.out(seg(t, start, start + 0.7))
  if (ax <= 0) return
  pen(ctx, [{ x, y }, { x: x + w, y }], P.ink, 4, 401, 1.4, ax)
  pen(ctx, [{ x: x + 8, y: y + h * 0.62 }, { x: x + 8, y: y - h * 0.62 }], P.ink, 4, 402, 1.4, ax)
  const p = ease.io(seg(t, start + 0.5, start + 2.3))
  const pts: Pt[] = []
  for (let i = 0; i <= 60; i++) {
    const s = i / 60
    pts.push({ x: x + 8 + s * (w - 16), y: y - Math.sin(s * Math.PI * 3.2 + t * 0.9) * h * 0.46 * (1 - s * 0.25) })
  }
  brush(ctx, pts, { width: 9, color: P.brick, seed: 403, taper: 0.5, progress: p, shake: 1.2 })
  if (p > 0.05) {
    const q = pts[Math.min(60, Math.floor(p * 60))]
    glow(ctx, q.x, q.y, 34, P.sun, 0.7)
    ctx.fillStyle = P.sun
    ctx.beginPath()
    ctx.arc(q.x, q.y, 9, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Un planeta con su órbita y su luna. */
function planet(ctx: Ctx, x: number, y: number, r: number, t: number, appear: number): void {
  if (appear <= 0) return
  const k = ease.outBack(appear)
  ctx.save()
  ctx.globalAlpha *= clamp(appear * 2)
  const orbit = ellipsePts(x, y, r * 2.2 * k, r * 0.7 * k, 30, -0.35)
  pen(ctx, [...orbit.slice(15), ...orbit.slice(0, 1)], P.ink, 3, 501, 1.2)
  const disc = blob(ellipsePts(x, y, r * k, r * k, 18), 2, 502, 0.02)
  ctx.fillStyle = P.paper
  ctx.fill(disc)
  wash(ctx, disc, P.sea, { alpha: 0.9, bleed: 3, edge: 0.5, grain: 0.5 })
  wash(ctx, blob(ellipsePts(x - r * 0.25, y - r * 0.2, r * 0.45 * k, r * 0.3 * k, 10), 3, 503, 0.05), P.leaf, { alpha: 0.8, bleed: 2, edge: 0.4, grain: 0.3 })
  pen(ctx, [...ellipsePts(x, y, r * k, r * k, 20), { x: x + r * k, y }], P.ink, 3.6, 504, 1)
  pen(ctx, [...orbit.slice(0, 16)], P.ink, 3, 505, 1.2)
  const a = t * 1.3
  const mx = x + Math.cos(a) * r * 2.2 * k * Math.cos(-0.35) - Math.sin(a) * r * 0.7 * k * Math.sin(-0.35)
  const my = y + Math.cos(a) * r * 2.2 * k * Math.sin(-0.35) + Math.sin(a) * r * 0.7 * k * Math.cos(-0.35)
  ctx.fillStyle = P.sun
  ctx.beginPath()
  ctx.arc(mx, my, 9 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Una ballena de papel que cruza el cielo: acuarela azul, renglones de cuaderno y un surtidor de hojas. Mira a la izquierda. */
function whale(ctx: Ctx, x: number, y: number, s: number, t: number, frame: number): void {
  const flap = Math.sin(t * 1.5) * 0.24
  const tail = (px: number, py: number): Pt => {
    const dx = px - 330
    return { x: 330 + dx * Math.cos(flap) - py * Math.sin(flap), y: dx * Math.sin(flap) + py * Math.cos(flap) }
  }
  const body: Pt[] = [
    { x: -360, y: 14 }, { x: -338, y: -34 }, { x: -250, y: -76 }, { x: -110, y: -96 }, { x: 40, y: -88 }, { x: 190, y: -54 }, { x: 290, y: -22 },
    tail(360, -12), tail(420, -62), tail(472, -94), tail(452, -34), tail(430, -4), tail(462, 40), tail(490, 80), tail(424, 56), tail(360, 16),
    { x: 290, y: 24 }, { x: 180, y: 56 }, { x: 30, y: 84 }, { x: -120, y: 86 }, { x: -260, y: 62 }, { x: -340, y: 40 }
  ]
  ctx.save()
  ctx.translate(x, y + Math.sin(t * 0.8) * 12)
  ctx.rotate(Math.sin(t * 0.5) * 0.04 - 0.05)
  ctx.scale(s, s)
  // la aleta de atrás, antes que el cuerpo
  const fin = blob([{ x: -170, y: 62 }, { x: -128, y: 150 + flap * 70 }, { x: -70, y: 166 + flap * 70 }, { x: -84, y: 80 }], 2, 47, 0.03)
  wash(ctx, fin, P.dawn4, { alpha: 0.85, bleed: 3, edge: 0.5, grain: 0.4 })
  const path = blob(body, 2.4, 41 + Math.floor(frame / 3), 0.02)
  ctx.fillStyle = P.paper
  ctx.fill(path)
  wash(ctx, path, P.dawn4, { alpha: 0.92, bleed: 4, edge: 0.6, grain: 0.5, to: '#cfdbe8', fromY: -96, toY: 96 })
  ctx.save()
  ctx.clip(path)
  // el vientre claro y los renglones: es una hoja de cuaderno
  ctx.fillStyle = col(P.paper, 0.6)
  ctx.fill(blob([{ x: -372, y: 34 }, { x: -200, y: 44 }, { x: 0, y: 62 }, { x: 170, y: 46 }, { x: 190, y: 110 }, { x: -100, y: 120 }, { x: -360, y: 90 }], 2, 43, 0.02))
  ctx.strokeStyle = col('#ffffff', 0.42)
  ctx.lineWidth = 2
  for (let i = -5; i <= 2; i++) {
    ctx.beginPath()
    ctx.moveTo(-380, i * 17)
    ctx.lineTo(520, i * 17 + 5)
    ctx.stroke()
  }
  ctx.strokeStyle = col(P.brick, 0.5)
  ctx.beginPath()
  ctx.moveTo(-300, -110)
  ctx.lineTo(-296, 110)
  ctx.stroke()
  ctx.restore()
  for (let j = 0; j < 4; j++) pen(ctx, [{ x: -326, y: 46 + j * 9 }, { x: -200, y: 58 + j * 8 }, { x: -70, y: 70 + j * 6 }], col(P.ink, 0.5), 2, 480 + j, 1)
  brush(ctx, [...body, body[0], body[1]], { width: 5, color: P.ink, seed: 44 + Math.floor(frame / 3), taper: 0.2, shake: 1.6, alpha: 0.9 })
  pen(ctx, [{ x: -358, y: 12 }, { x: -306, y: 24 }, { x: -262, y: 16 }], P.ink, 3, 49, 1)
  ctx.fillStyle = P.ink
  ctx.beginPath()
  ctx.arc(-292, -8, 5.5, 0, Math.PI * 2)
  ctx.fill()
  // el surtidor
  for (let i = 0; i < 9; i++) {
    const ph = (t * 0.8 + i / 9) % 1
    paperSheet(ctx, {
      x: -232 + (i - 4) * 16 * ph, y: -98 - ph * 150 + ph * ph * 70, w: 13 + ph * 9, rot: t * 3 + i, flip: t * 4 + i, seed: 6000 + i, shade: 0,
      tint: '#fffaf0', toward: P.paperShade, outline: col(P.ink, 0.3), alpha: 1 - ph, lines: false
    })
  }
  ctx.restore()
}

/** Tarjetas que vuelan como pájaros, en formación. */
function flock(ctx: Ctx, t: number, start: number): void {
  const k = seg(t, start, start + 7.5)
  if (k <= 0 || k >= 1) return
  const lead: Pt = { x: lerp(-160, W + 260, k), y: 300 - Math.sin(k * Math.PI) * 120 + Math.sin(t * 1.3) * 12 }
  for (let i = 0; i < 11; i++) {
    const row = Math.ceil(i / 2)
    const side = i % 2 ? 1 : -1
    const x = lead.x - row * 46 + noise1(t * 0.8 + i, 600) * 8
    const y = lead.y + side * row * 30 + Math.sin(t * 2 + i) * 6
    const flap = Math.sin(t * 9 + i * 1.7)
    paperSheet(ctx, { x, y, w: 38, rot: -0.25 + flap * 0.12, flip: 1.05 + flap * 0.42, seed: 700 + i, shade: 0.02, tint: i % 3 === 0 ? P.dawn1 : P.paper, lines: true, toward: P.paperShade })
  }
}

/** 31,6–41,6 s: la escalera. */
export function drawStairs(ctx: Ctx, t: number, frame: number): void {
  const k = seg(t, T0, 41.6)
  const climb = clamp((t - 32.7) / 0.305, 0, STEPS - 1.001)
  const here = stepAt(Math.floor(climb))
  const next = stepAt(Math.floor(climb) + 1)
  const f = climb - Math.floor(climb)
  const sx = lerp(here.x, next.x, ease.io(f))
  const sy = lerp(here.y, next.y, ease.io(f)) - Math.sin(f * Math.PI) * 16
  // la cámara sube con él
  const zoom = lerp(1.28, 1.12, ease.io(k))
  const cx = lerp(560, 1120, ease.io(seg(t, 32.2, 41)))
  const cy = lerp(800, 500, ease.io(seg(t, 32.2, 41)))
  const view = (depth: number, draw: () => void): void => {
    const d = 0.3 + depth * 0.7
    const z = 1 + (zoom - 1) * d
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(z, z)
    ctx.translate(-(W / 2 + (cx - W / 2) * d), -(H / 2 + (cy - H / 2) * d))
    draw()
    ctx.restore()
  }
  ctx.drawImage(back.canvas, 0, 0)
  // el sol, que cuenta los días que quedan
  const day = Math.min(8, Math.floor(seg(t, 32.0, 41.3) * 9))
  const tick = seg(t, 32.0, 41.3) * 9 - day
  const beat = 1 + Math.sin(Math.min(1, tick * 3) * Math.PI) * 0.07
  view(0.1, () => {
    rays(ctx, SUN.x, SUN.y, 1500, P.sunCore, 0.34, 9, 0, Math.PI * 2, 30, t * 0.05)
    glow(ctx, SUN.x, SUN.y, 620, P.glow, 0.55)
    const disc = blob(ellipsePts(SUN.x, SUN.y, 132 * beat, 132 * beat, 24), 3, 11, 0.02)
    wash(ctx, disc, P.sun, { alpha: 0.95, bleed: 6, edge: 0.3, grain: 0.3 })
    glow(ctx, SUN.x, SUN.y, 190, P.sunCore, 0.5)
    title(ctx, String(9 - day), SUN.x, SUN.y + 6, 150, P.brickDeep, 0.62 * Math.min(1, tick * 4 + 0.15) * smooth(seg(t, 31.9, 32.5)), 0, 500)
  })
  view(0.25, () => ctx.drawImage(hills.canvas, -120, 40, W + 240, H + 60))
  view(0.32, () => whale(ctx, lerp(W + 700, 420, seg(t, 33.0, 41.8)), 700 + Math.sin(t * 0.7) * 22, 1.08, t, frame))
  view(0.4, () => flock(ctx, t, 33.6))
  view(0.55, () => {
    molecule(ctx, 520, 500, 1, t, seg(t, 33.2, 34.0))
    planet(ctx, 880, 300, 46, t, seg(t, 36.2, 37.0))
    wave(ctx, 1010, 900, 430, 150, t, 35.0)
  })
  view(0.8, () => {
    // los peldaños: hojas que llegan volando y se posan
    for (let i = 0; i < STEPS; i++) {
      const land = ease.out(seg(t, 30.9 + i * 0.21, 31.7 + i * 0.21))
      if (land <= 0) continue
      const p = stepAt(i)
      const ox = (hash(i, 801) - 0.5) * 700 * (1 - land)
      const oy = (-260 - hash(i, 802) * 240) * (1 - land)
      // su sombra en el aire
      ctx.fillStyle = col(P.brickDeep, 0.1 * land)
      ctx.beginPath()
      ctx.ellipse(p.x + 6, p.y + 13, 60, 9, 0, 0, Math.PI * 2)
      ctx.fill()
      const pressed = i === Math.floor(climb) ? Math.sin(f * Math.PI) * 4 : 0
      paperSheet(ctx, { x: p.x + ox, y: p.y + oy + pressed, w: 118, rot: lerp(hash(i, 803) * 5, -0.1 + (hash(i, 804) - 0.5) * 0.08, land), flip: lerp(hash(i, 805) * 6, 1.3, land), seed: 900 + i, shade: 0.02 + (1 - land) * 0.1, tint: '#fffaf0', toward: P.paperShade, outline: col(P.ink, 0.22) })
    }
    const reach = bell(t, 33.3, 33.9, 34.6, 35.2) * 0.9 + bell(t, 36.6, 37.1, 37.8, 38.4) * 0.9
    student(ctx, { x: sx, y: sy - 2, size: 158, kind: 'climb', phase: climb * 0.5, lean: 0.16, reach, wind: 0.45, time: t, frame })
  })
  // el día y la noche pasan: un velo azul que va y viene
  const night = Math.pow(Math.sin(Math.min(1, tick) * Math.PI), 4) * 0.16 * smooth(seg(t, 32, 33))
  if (night > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = mix('#ffffff', P.dawn4, night * 2.4)
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
  paperOver(ctx, 1)
  subtitle(ctx, 'Day by day.', t, 35.4, 39.2, P.ink, H - 96, 50)
  // el último día: el sol lo llena todo
  const flare = ease.in(seg(t, 40.9, 41.6))
  if (flare > 0) {
    ctx.fillStyle = col(P.sunCore, flare)
    ctx.fillRect(0, 0, W, H)
  }
}

/** 41,6–49,6 s: el día del examen. */
export function drawExam(ctx: Ctx, t: number, frame: number): void {
  const closeUp = ease.io(seg(t, 45.3, 46.2))
  ctx.drawImage(room.canvas, 0, 0)
  const zoom = lerp(1.06, 1.16, ease.io(seg(t, 41.6, 45.6)))
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(zoom, zoom)
  ctx.translate(-W / 2, -H / 2 - 10)
  // la ventana: el arco de Aula, lleno de mañana
  const win = { cx: 1310, ground: 838, width: 420 }
  glow(ctx, win.cx, win.ground - 250, 760, P.sunCore, 0.75)
  const r = win.width / 2 - 96
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(win.cx - r, win.ground)
  ctx.lineTo(win.cx - r, win.ground - 504 + 96 + r)
  ctx.arc(win.cx, win.ground - 504 + 96 + r, r, Math.PI, 0)
  ctx.lineTo(win.cx + r, win.ground)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, win.ground - 420, 0, win.ground)
  g.addColorStop(0, P.dawn3)
  g.addColorStop(0.55, P.dawn0)
  g.addColorStop(1, P.sunCore)
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
  arch(ctx, { cx: win.cx, ground: win.ground, width: win.width, seed: 13, sun: 1, light: 0.4 })
  // el haz de luz por el suelo, hasta la mesa
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.filter = 'blur(18px)'
  const beam = ctx.createLinearGradient(win.cx, win.ground, 620, 1000)
  beam.addColorStop(0, col(P.sunCore, 0.85))
  beam.addColorStop(1, col(P.glow, 0))
  ctx.fillStyle = beam
  ctx.beginPath()
  ctx.moveTo(win.cx - r, win.ground - 380)
  ctx.lineTo(win.cx + r, win.ground - 380)
  ctx.lineTo(1060, H + 40)
  ctx.lineTo(300, H + 40)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  groundLine(ctx, 60, W - 60, 842, 51, P.ink, 9)
  // motas de polvo en el haz de luz
  for (let i = 0; i < 70; i++) {
    const s = hash(i, 301)
    const mx = lerp(win.cx, 500, s) + Math.sin(t * 0.4 + i) * 22 + (hash(i, 302) - 0.5) * 300 * s
    const my = lerp(win.ground - 330, 980, s) - ((t * (5 + hash(i, 303) * 8) + hash(i, 304) * 200) % 200) + 100
    ctx.fillStyle = col(P.sunCore, 0.75 * (0.3 + hash(i, 305) * 0.7))
    ctx.beginPath()
    ctx.arc(mx, my, 1.3 + hash(i, 306) * 1.6, 0, Math.PI * 2)
    ctx.fill()
  }
  // unas pocas hojas, ya en orden, apiladas junto a la mesa; y la sombra de la mesa en el suelo
  stack(ctx, 1010, 840, 96, 7, 811, 0.08)
  ctx.save()
  ctx.filter = 'blur(10px)'
  ctx.fillStyle = col(P.brickDeep, 0.14)
  ctx.beginPath()
  ctx.ellipse(700, 850, 330, 16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // la mesa y el estudiante, erguido, tranquilo
  brush(ctx, [{ x: 552, y: 768 }, { x: 640, y: 767 }], { width: 9, color: P.ink, seed: 71, taper: 0.3 })
  brush(ctx, [{ x: 566, y: 770 }, { x: 558, y: 840 }], { width: 6, color: P.ink, seed: 72, taper: 0.3 })
  brush(ctx, [{ x: 628, y: 770 }, { x: 636, y: 840 }], { width: 6, color: P.ink, seed: 73, taper: 0.3 })
  desk(ctx, 800, 732, 440, 81)
  student(ctx, { x: 598, y: 840, size: 266, kind: 'sit', lean: 0.1 + Math.sin(t * 1.1) * 0.015, wind: 0.08, time: t, frame })
  // la hoja del examen baja meciéndose y se posa
  const fall = ease.io(seg(t, 41.9, 45.0))
  const sway = Math.sin(fall * Math.PI * 3) * 130 * (1 - fall)
  paperSheet(ctx, { x: 790 + sway, y: lerp(120, 724, fall), w: 104, rot: lerp(0.9, -0.05, fall) + sway * 0.002, flip: lerp(0.4, 1.38, fall) + Math.sin(fall * 9) * 0.25 * (1 - fall), seed: 5, shade: 0, tint: '#fffaf0', toward: P.paperShade, outline: col(P.ink, 0.55) })
  ctx.restore()
  paperOver(ctx, 1)
  // inserto: la hoja de cerca, y la marca
  if (closeUp > 0) {
    ctx.save()
    ctx.globalAlpha = closeUp
    ctx.fillStyle = P.paper
    ctx.fillRect(0, 0, W, H)
    wash(ctx, blob(ellipsePts(W * 0.78, H * 0.2, 760, 360, 14), 30, 140, 0.004), P.dawn1, { alpha: 0.5, bleed: 60, edge: 0.05, grain: 0.5 })
    wash(ctx, blob(ellipsePts(W * 0.1, H * 0.9, 700, 300, 14), 30, 141, 0.004), P.paperShade, { alpha: 0.45, bleed: 60, edge: 0.05, grain: 0.5 })
    // renglones del examen, ya respondidos
    ctx.strokeStyle = col(P.night3, 0.22)
    ctx.lineWidth = 3
    for (let i = 0; i < 9; i++) {
      const y = 250 + i * 76
      ctx.beginPath()
      ctx.moveTo(250, y)
      ctx.lineTo(250 + 380 + hash(i, 91) * 360, y)
      ctx.stroke()
    }
    const draw = ease.io(seg(t, 46.0, 46.8))
    brush(ctx, [{ x: 1020, y: 560 }, { x: 1110, y: 680 }, { x: 1150, y: 700 }, { x: 1250, y: 520 }, { x: 1420, y: 330 }], { width: 78, color: P.brick, seed: 95, taper: 0.45, dry: 0.6, progress: draw, shake: 5 })
    title(ctx, 'Ready.', 1180, 840, 132, P.ink, ease.out(seg(t, 46.7, 47.5)), 0, 500, true)
    paperOver(ctx, 1)
    ctx.restore()
  }
  const out = ease.in(seg(t, 48.9, 49.6))
  const inn = 1 - ease.out(seg(t, 41.6, 42.5))
  if (inn > 0) {
    ctx.fillStyle = col(P.sunCore, inn)
    ctx.fillRect(0, 0, W, H)
  }
  if (out > 0) {
    ctx.fillStyle = col(P.paper, out)
    ctx.fillRect(0, 0, W, H)
  }
}
