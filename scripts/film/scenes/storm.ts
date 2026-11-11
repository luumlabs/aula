// Acto I, segunda parte — La tormenta (9,4–18 s), plano a plano y animada «a doses» (12 dibujos por segundo, como la
// animación tradicional): formas diseñadas, perfiladas a tinta, sin desenfoques.
//    9,4   el calendario, de cerca: el viento lo levanta y lo arranca
//   10,7   el flexo: tiembla, parpadea, las hojas se van de la mesa, el lápiz rueda… y se apaga (12,5)
//   13,25  relámpago · plano general: las torres se vencen hacia una ola que se levanta y se traga las hojas
//   15,6   relámpago · contrapicado: la gran ola (una pila de hojas doblada, con garras de papel) sobre él
//   17,05  rompe
import { clamp, col, ease, H, hash, lerp, mix, P, seg, smooth, W, type Pt } from '../engine/core.ts'
import { blob, brush, ellipsePts, glow, paperOver, sheet, temp, type Ctx, type Sheet } from '../engine/paint.ts'
import { desk, groundLine, lamp, stack } from '../engine/props.ts'
import { student } from '../engine/figure.ts'

export const STORM_AT = 9.4
const T_LAMP = 10.7
const T_DARK = 12.5
const T_WIDE = 13.25
const T_WAVE = 15.6
const T_CRASH = 17.05
const T_HIT = 17.25
const FLOOR = 800
const INK = '#05070e'

/** El tiempo «a doses»: el dibujo cambia doce veces por segundo. */
export const twos = (t: number): number => Math.floor(t * 12) / 12
const drawing = (t: number): number => Math.floor(t * 12)

export interface Leaf {
  x: number; y: number; s: number; yaw: number; pitch: number; roll: number; curl?: number; seed: number; tone?: number; warm?: number; alpha?: number
  /** Hacia dónde estaba en el dibujo anterior: deja una estela, como los barridos de la animación a mano. */
  smear?: Pt
}

/** Una hoja en el aire, con cuerpo: combada, a dos tonos (luz y sombra), con sus renglones y perfilada a tinta fina. */
export function leaf(ctx: Ctx, o: Leaf): void {
  const { x, y, s, yaw, pitch, roll, curl = 0.18, seed, tone = 0.5, warm = 0, alpha = 1, smear } = o
  if (alpha <= 0.01) return
  const w = s
  const h = s * 1.38
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const at = (u: number, v: number): Pt => {
    const z0 = curl * w * (1 - 4 * v * v)
    const x1 = u * w * cr + z0 * sr
    const z1 = -u * w * sr + z0 * cr
    const y1 = v * h * cp - z1 * sp
    return { x: x + x1 * cy - y1 * sy, y: y + x1 * sy + y1 * cy }
  }
  const front = cr * cp > 0
  const N = 5
  const trace = (u0: number, u1: number, dx = 0, dy = 0): void => {
    ctx.beginPath()
    for (let i = 0; i <= N; i++) {
      const q = at(u0, -0.5 + i / N)
      if (i) ctx.lineTo(q.x + dx, q.y + dy)
      else ctx.moveTo(q.x + dx, q.y + dy)
    }
    for (let i = N; i >= 0; i--) {
      const q = at(u1, -0.5 + i / N)
      ctx.lineTo(q.x + dx, q.y + dy)
    }
    ctx.closePath()
  }
  const base = front ? mix('#eceef5', '#5d6886', tone) : mix('#c3cadb', '#3a4563', tone)
  const fill = warm > 0 ? mix(base, P.glow, warm * 0.6) : base
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineJoin = 'round'
  if (smear) {
    ctx.fillStyle = fill
    const keep = ctx.globalAlpha
    ;[0.7, 0.36].forEach((k, i) => {
      ctx.globalAlpha = keep * (i ? 0.34 : 0.16)
      trace(-0.5, 0.5, smear.x * k, smear.y * k)
      ctx.fill()
    })
    ctx.globalAlpha = keep
  }
  trace(-0.5, 0.5)
  ctx.fillStyle = fill
  ctx.fill()
  // la mitad que se aleja de la luz, un tono más abajo
  const side = sr * cp > 0 ? 1 : -1
  trace(0.06 * side, 0.5 * side)
  ctx.fillStyle = col('#0a1026', front ? 0.14 : 0.2)
  ctx.fill()
  if (s > 30) {
    // los renglones (por el envés se transparentan apenas) y, en las grandes, la raya del margen
    ctx.strokeStyle = col('#1f2a44', front ? 0.42 : 0.12)
    ctx.lineWidth = clamp(s * 0.016, 1, 3)
    for (let r = 0; r < 6; r++) {
      const v = -0.3 + r * 0.13
      const a = at(-0.34, v)
      const b = at(-0.04 + hash(seed, r) * 0.38, v)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    if (front && s > 90) {
      const a = at(-0.34, -0.41)
      const b = at(0.02 + hash(seed, 9) * 0.2, -0.41)
      ctx.strokeStyle = col(P.brick, 0.75)
      ctx.lineWidth = clamp(s * 0.03, 2, 6)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }
  trace(-0.5, 0.5)
  ctx.lineWidth = clamp(s * 0.028, 1.1, 3.2)
  ctx.strokeStyle = col('#0b0f1c', 0.82)
  ctx.stroke()
  ctx.restore()
}

/** Una tira de papel vista casi de canto (un dedo de la cresta): la cara, una franja de envés y el perfil a tinta. */
function ribbon(ctx: Ctx, pts: Pt[], w0: number, w1: number, fill: string, under: string, line: number): void {
  const n = pts.length - 1
  const Lf: Pt[] = []
  const Rt: Pt[] = []
  const Md: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n, i + 1)]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const w = lerp(w0, w1, Math.pow(i / n, 1.4)) / 2
    Lf.push({ x: pts[i].x + nx * w, y: pts[i].y + ny * w })
    Rt.push({ x: pts[i].x - nx * w, y: pts[i].y - ny * w })
    Md.push({ x: pts[i].x - nx * w * 0.25, y: pts[i].y - ny * w * 0.25 })
  }
  const shape = (A: Pt[], B: Pt[]): void => {
    ctx.beginPath()
    A.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    for (let i = n; i >= 0; i--) ctx.lineTo(B[i].x, B[i].y)
    ctx.closePath()
  }
  ctx.lineJoin = 'round'
  shape(Lf, Rt)
  ctx.fillStyle = fill
  ctx.fill()
  shape(Md, Rt)
  ctx.fillStyle = under
  ctx.fill()
  shape(Lf, Rt)
  ctx.lineWidth = line
  ctx.strokeStyle = '#0b0f1c'
  ctx.stroke()
}

/** Rachas de viento: trazos largos y finos que viven tres dibujos y se van, como los efectos dibujados a mano. */
function gusts(ctx: Ctx, tq: number, n: number, seed: number, path: (id: number, u: number) => Pt, color = '#b9c6e4'): void {
  const d = drawing(tq)
  for (let i = 0; i < n; i++) {
    const off = Math.floor(hash(i, seed) * 8)
    const age = (d + off) % 8
    if (age > 2) continue
    const id = i + Math.floor((d + off) / 8) * 53
    const u0 = hash(id, seed + 1) * 0.5 + age * 0.1
    const pts: Pt[] = []
    for (let m = 0; m <= 8; m++) pts.push(path(id, u0 + (m / 8) * (0.2 + hash(id, seed + 2) * 0.16)))
    brush(ctx, pts, { width: 6.5 - age * 1.6, color, seed: id, alpha: 0.6 - age * 0.17, taper: 0.95, shake: 0 })
  }
}

/** Puntos de una curva suave (Catmull-Rom) que pasa por `pts`. */
function curve(pts: Pt[], n: number): Pt[] {
  const out: Pt[] = []
  const m = pts.length - 1
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * m
    const k = Math.min(m - 1, Math.floor(s))
    const f = s - k
    const p0 = pts[Math.max(0, k - 1)]
    const p1 = pts[k]
    const p2 = pts[k + 1]
    const p3 = pts[Math.min(m, k + 2)]
    const f2 = f * f
    const f3 = f2 * f
    out.push({
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3)
    })
  }
  return out
}

let cal: Sheet
let sky: Sheet

export function initStorm(): void {
  // el calendario: los días tachados y el examen, rodeado, nueve días después
  cal = sheet(560, 700)
  const c = cal.ctx
  c.fillStyle = '#e9e4d6'
  c.fillRect(0, 0, 560, 700)
  c.fillStyle = P.brick
  c.fillRect(0, 0, 560, 96)
  c.fillStyle = '#e9e4d6'
  for (let i = 0; i < 7; i++) {
    c.beginPath()
    c.arc(60 + i * 73, 32, 10, 0, Math.PI * 2)
    c.fill()
  }
  c.strokeStyle = col(P.night3, 0.55)
  c.lineWidth = 3
  for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) c.strokeRect(38 + k * 83, 140 + r * 104, 66, 80)
  c.strokeStyle = col(P.night3, 0.6)
  c.lineWidth = 4
  for (let n = 0; n < 13; n++) {
    const x = 38 + (n % 6) * 83
    const y = 140 + Math.floor(n / 6) * 104
    c.beginPath()
    c.moveTo(x + 12, y + 14)
    c.lineTo(x + 54, y + 66)
    c.moveTo(x + 54, y + 14)
    c.lineTo(x + 12, y + 66)
    c.stroke()
  }
  const circ: Pt[] = []
  for (let i = 0; i <= 23; i++) {
    const a = -1.2 + (i / 20) * Math.PI * 2
    circ.push({ x: 403 + Math.cos(a) * 54, y: 492 + Math.sin(a) * 48 })
  }
  brush(c, circ, { width: 12, color: P.brick, seed: 78, taper: 0.5 })

  // el cielo de la tormenta: plano, con nubarrones recortados
  sky = sheet()
  const s = sky.ctx
  const g = s.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#070a14')
  g.addColorStop(0.5, '#172038')
  g.addColorStop(0.78, '#2d3a5a')
  g.addColorStop(1, '#0c1020')
  s.fillStyle = g
  s.fillRect(0, 0, W, H)
  for (let i = 0; i < 12; i++) {
    s.fillStyle = col(i % 2 ? '#0a0e1b' : '#232e4b', 0.75)
    s.fill(blob(ellipsePts(hash(i, 501) * W, 60 + hash(i, 502) * 440, 240 + hash(i, 503) * 340, 50 + hash(i, 504) * 90, 14), 26, 510 + i, 0.006))
  }
}

// ── La gran ola ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Dos contornos que nacen en la punta del labio: el lomo (por arriba, hasta atrás) y la cara (por debajo del labio, la
// pared y el pie). Entre los dos, las capas: es una pila de hojas doblada en ola. Tres dibujos clave: el bulto que se
// levanta (0), la ola hecha (1) y el labio que se desploma (2).
type Key = [number, number][]
const LOMO: Key[] = [
  [[-300, -150], [-260, -190], [-150, -230], [0, -250], [200, -220], [450, -160], [700, -100], [980, -50], [1300, 40]],
  [[-560, -610], [-520, -760], [-380, -900], [-120, -980], [160, -900], [430, -700], [700, -420], [980, -160], [1300, 40]],
  [[-760, -240], [-700, -470], [-520, -760], [-200, -900], [120, -850], [420, -680], [700, -420], [980, -160], [1300, 40]]
]
// La cara no nace en la misma punta que el lomo: el labio acaba en un canto (el corte de la pila), y de ese canto salen los dedos.
const CARA: Key[] = [
  [[-256, -106], [-258, -96], [-264, -86], [-275, -76], [-292, -62], [-330, -45], [-420, -20], [-600, 10], [-900, 40]],
  [[-392, -566], [-350, -655], [-268, -702], [-185, -620], [-150, -440], [-200, -230], [-330, -70], [-560, 10], [-900, 40]],
  [[-594, -196], [-578, -330], [-468, -520], [-300, -560], [-190, -430], [-210, -230], [-330, -70], [-560, 10], [-900, 40]]
]

/** Dibuja la ola en (ox, oy) a escala `s`. `r`: de bulto (0) a ola (1). `c`: cuánto ha roto. Devuelve las puntas de sus garras. */
function greatWave(ctx: Ctx, tq: number, r: number, c: number, ox: number, oy: number, s: number): Pt[] {
  const d = drawing(tq)
  const key = (k: Key[], seed: number): Pt[] =>
    k[0].map((p, i) => {
      const end = i === 0 || i === k[0].length - 1
      return {
        x: ox + s * (lerp(lerp(p[0], k[1][i][0], r), k[2][i][0], c) + (end ? 0 : (hash(i + d * 7, seed) - 0.5) * 14)),
        y: oy + s * (lerp(lerp(p[1], k[1][i][1], r), k[2][i][1], c) + (end ? 0 : (hash(i + d * 7, seed + 1) - 0.5) * 14))
      }
    })
  const n = 56
  const back = curve(key(LOMO, 11), n)
  const face = curve(key(CARA, 13), n)
  const lay = (i: number, a: number): Pt => ({ x: lerp(face[i].x, back[i].x, a), y: lerp(face[i].y, back[i].y, a) })
  // el cuerpo
  ctx.beginPath()
  back.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
  ctx.lineTo(back[n].x, oy + 600 * s)
  ctx.lineTo(face[n].x, oy + 600 * s)
  for (let i = n; i >= 0; i--) ctx.lineTo(face[i].x, face[i].y)
  ctx.closePath()
  ctx.fillStyle = '#1b2440'
  ctx.fill()
  // las capas, cada una de un tono de papel, como en las torres
  const K = 18
  for (let k = 0; k < K; k++) {
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const q = lay(i, k / K)
      if (i) ctx.lineTo(q.x, q.y)
      else ctx.moveTo(q.x, q.y)
    }
    for (let i = n; i >= 0; i--) {
      const q = lay(i, (k + 1) / K)
      ctx.lineTo(q.x, q.y)
    }
    ctx.closePath()
    ctx.fillStyle = mix('#d3d8e6', '#2a3554', 0.22 + hash(k, 21) * 0.52)
    ctx.fill()
    ctx.strokeStyle = col('#0b0f1c', 0.5)
    ctx.lineWidth = 1.6 * s
    ctx.stroke()
  }
  // las hojas corren por las capas hacia el labio: rayas que suben
  ctx.lineCap = 'round'
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < 6; j++) {
      const v = 1 - ((tq * (0.24 + hash(k, 31) * 0.22) + j / 6 + hash(k, 32)) % 1)
      const i = Math.min(n, Math.max(2, Math.floor(v * n)))
      const a = lay(i, (k + 0.1) / K)
      const b = lay(i, (k + 0.9) / K)
      const mark = hash(k * 7 + j, 33) > 0.84
      ctx.strokeStyle = mark ? col(P.brick, 0.9) : col('#0b0f1c', 0.6)
      ctx.lineWidth = (mark ? 7 : 2.4) * s
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }
  // la sombra del hueco: bajo el labio, la pared queda a oscuras
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i <= 34; i++) {
    const q = lay(i, 0)
    if (i) ctx.lineTo(q.x, q.y)
    else ctx.moveTo(q.x, q.y)
  }
  for (let i = 34; i >= 0; i--) {
    const q = lay(i, 0.34 * Math.sin((i / 34) * Math.PI))
    ctx.lineTo(q.x, q.y)
  }
  ctx.closePath()
  ctx.fillStyle = col('#070b1c', 0.42)
  ctx.fill()
  ctx.restore()
  // esquinas de hojas que asoman del lomo: la pila no es una curva perfecta
  for (let i = 5; i < n - 8; i += 2) {
    if (hash(i, 44) < 0.35) continue
    const q = back[i]
    const p = back[i - 1]
    const th = Math.atan2(p.y - q.y, p.x - q.x)
    const flap = Math.sin(tq * (6 + hash(i, 45) * 5) + i)
    leaf(ctx, { x: q.x + Math.sin(th) * 9 * s, y: q.y - Math.cos(th) * 9 * s, s: (30 + hash(i, 46) * 34) * s, yaw: th + Math.PI / 2 + flap * 0.12, pitch: 0.95 + flap * 0.35, roll: 0.3, seed: i, tone: 0.2 + hash(i, 47) * 0.4, curl: 0.3 })
  }
  // el perfil, a tinta, y el filo de luz del lomo
  brush(ctx, back.slice(0, n - 4), { width: 9 * s, color: '#0b0f1c', seed: 5 + d, taper: 0.25, shake: 2 * s })
  brush(ctx, face, { width: 8 * s, color: '#0b0f1c', seed: 6 + d, taper: 0.25, shake: 2 * s })
  ctx.strokeStyle = col('#eef2fb', 0.8)
  ctx.lineWidth = 3.5 * s
  ctx.beginPath()
  for (let i = 1; i < 30; i++) {
    const q = lay(i, 0.95)
    if (i === 1) ctx.moveTo(q.x, q.y)
    else ctx.lineTo(q.x, q.y)
  }
  ctx.stroke()
  // las garras: del canto del labio sale cada capa hecha un dedo de papel, que se abre en abanico y se engancha hacia dentro
  const tips: Pt[] = []
  const th0 = Math.atan2(back[0].y - back[3].y, back[0].x - back[3].x)
  const edge = Math.hypot(back[0].x - face[0].x, back[0].y - face[0].y)
  const F = 9
  const finger = (j: number, a: number, base: number, len: number, wide: number, dark: number): Pt => {
    const grow = 0.25 + 0.75 * r
    const L = (150 + hash(j, 41) * 110 + a * 150) * s * grow * len
    const wig = Math.sin(tq * 6 + j * 1.7)
    const pts: Pt[] = [lay(base, a)]
    // los de fuera se abren hacia delante; los de dentro caen antes
    let th = th0 + (a - 0.5) * 1.15 + wig * 0.05
    const hook = (0.09 + (1 - a) * 0.06 + hash(j, 43) * 0.04) * (1 + c * 0.5)
    const M = 12
    for (let m = 1; m <= M; m++) {
      th -= hook * Math.pow(m / M, 1.6) * 2.4 + wig * 0.012
      const q = pts[m - 1]
      pts.push({ x: q.x + (Math.cos(th) * L) / M, y: q.y + (Math.sin(th) * L) / M })
    }
    const tint = hash(j, 42)
    ribbon(ctx, pts, (edge / F) * wide, (edge / F) * 0.5, mix(mix('#f1f3f9', '#b4bdd3', tint * 0.6), '#56617f', dark), mix(mix('#8c97b4', '#56617f', tint), '#2a3554', dark), 2.6 * Math.sqrt(s))
    return pts[M]
  }
  // una fila de atrás, más corta y en sombra, y la de delante, cada dedo naciendo a una altura distinta del labio
  for (let j = 0; j < 8; j++) finger(20 + j, (j + 1) / 9, 3, 0.55, 2, 0.55)
  for (const j of [4, 3, 5, 2, 6, 1, 7, 0, 8]) tips.push(finger(j, (j + 0.5) / F, Math.floor(hash(j, 48) * 3), 0.82 + hash(j, 49) * 0.2, 2.3, 0))
  return tips
}

/** Pinta el triángulo (s0,s1,s2) de `img` sobre el triángulo (d0,d1,d2): con tiras finas, una hoja se dobla sin costuras. */
function texTri(ctx: Ctx, img: OffscreenCanvas, s0: Pt, s1: Pt, s2: Pt, d0: Pt, d1: Pt, d2: Pt): void {
  const ux = s1.x - s0.x
  const uy = s1.y - s0.y
  const vx = s2.x - s0.x
  const vy = s2.y - s0.y
  const den = ux * vy - vx * uy
  if (Math.abs(den) < 1e-6) return
  const a = ((d1.x - d0.x) * vy - (d2.x - d0.x) * uy) / den
  const c = ((d2.x - d0.x) * ux - (d1.x - d0.x) * vx) / den
  const b = ((d1.y - d0.y) * vy - (d2.y - d0.y) * uy) / den
  const e = ((d2.y - d0.y) * ux - (d1.y - d0.y) * vx) / den
  // el recorte se ensancha un pelo desde el centro para que no se vean las costuras
  const mx = (d0.x + d1.x + d2.x) / 3
  const my = (d0.y + d1.y + d2.y) / 3
  const out = (q: Pt): Pt => {
    const l = Math.hypot(q.x - mx, q.y - my) || 1
    return { x: q.x + ((q.x - mx) / l) * 1.2, y: q.y + ((q.y - my) / l) * 1.2 }
  }
  const o0 = out(d0)
  const o1 = out(d1)
  const o2 = out(d2)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(o0.x, o0.y)
  ctx.lineTo(o1.x, o1.y)
  ctx.lineTo(o2.x, o2.y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, b, c, e, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - e * s0.y)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

/** El rayo: un trazo quebrado, blanco, con su rama. */
function bolt(ctx: Ctx, x: number, seed: number): void {
  const pts: Pt[] = []
  let px = x
  for (let i = 0; i <= 8; i++) {
    pts.push({ x: px, y: -60 + i * 96 })
    px += (hash(i, seed) - 0.5) * 200
  }
  ctx.save()
  ctx.lineJoin = 'miter'
  ctx.strokeStyle = '#ffffff'
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 34
  ctx.lineWidth = 12
  ctx.beginPath()
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
  ctx.stroke()
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(pts[3].x, pts[3].y)
  ctx.lineTo(pts[3].x + 130, pts[3].y + 90)
  ctx.lineTo(pts[3].x + 100, pts[3].y + 210)
  ctx.lineTo(pts[3].x + 190, pts[3].y + 300)
  ctx.stroke()
  ctx.restore()
}

interface Cam { x: number; y: number; zoom: number }
/** Cielo + figuras, con la cámara temblando a doses; en el relámpago, dos dibujos de cielo blanco con todo en silueta. */
function compose(ctx: Ctx, t: number, fg: Sheet, boltAt: number, boltX: number, cam: Cam, hit?: { at: number; x: number; y: number }): void {
  const d = drawing(t)
  ctx.save()
  ctx.translate(W / 2 + (hash(d, 71) - 0.5) * 7, H / 2 + (hash(d, 72) - 0.5) * 5)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)
  ctx.drawImage(sky.canvas, -80, -60, W + 160, H + 120)
  ctx.drawImage(fg.canvas, 0, 0)
  const dt = t - boltAt
  const fl = dt < 0 ? 0 : dt < 1 / 12 ? 1 : dt < 2 / 12 ? 0.12 : dt < 3 / 12 ? 0.85 : Math.max(0, 0.6 - (dt - 0.25) * 2.2)
  if (fl > 0) {
    ctx.globalAlpha = Math.min(1, fl * 1.1)
    ctx.fillStyle = '#c9d6f4'
    ctx.fillRect(-80, -60, W + 160, H + 120)
    if (dt < 0.3) bolt(ctx, boltX, 40 + Math.floor(boltAt))
    ctx.filter = 'brightness(0.1)'
    ctx.drawImage(fg.canvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
  }
  // el golpe: dos dibujos a contraste total (blanco con todo en negro, y al revés) con líneas de impacto
  const k = hit ? Math.floor((t - hit.at) * 12 + 1e-6) : -1
  if (hit && t >= hit.at && k < 2) {
    const dark = k === 1
    ctx.fillStyle = dark ? '#05070e' : '#f2f4fa'
    ctx.fillRect(-80, -60, W + 160, H + 120)
    ctx.filter = dark ? 'brightness(0) invert(1)' : 'brightness(0)'
    ctx.drawImage(fg.canvas, 0, 0)
    ctx.filter = 'none'
    ctx.fillStyle = dark ? '#f2f4fa' : '#05070e'
    for (let i = 0; i < 34; i++) {
      const q = (i / 34) * Math.PI * 2 + hash(i, 87 + k) * 0.16
      const r0 = 330 + hash(i, 88 + k) * 300
      const wd = 0.012 + hash(i, 89 + k) * 0.022
      ctx.beginPath()
      ctx.moveTo(hit.x + Math.cos(q) * r0, hit.y + Math.sin(q) * r0 * 0.8)
      ctx.lineTo(hit.x + Math.cos(q - wd) * 2400, hit.y + Math.sin(q - wd) * 2400)
      ctx.lineTo(hit.x + Math.cos(q + wd) * 2400, hit.y + Math.sin(q + wd) * 2400)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
  paperOver(ctx, 0.9)
}

// ── Plano 1 · el calendario ──────────────────────────────────────────────────────────────────────────────────────────
function shotCalendar(ctx: Ctx, t: number, L: { far: Sheet; mid: Sheet }): void {
  const tq = twos(t)
  const lift = ease.in(seg(t, STORM_AT, 10.45))
  const tear = seg(tq, 10.42, T_LAMP)
  ctx.fillStyle = '#080b16'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.filter = 'blur(18px)'
  ctx.globalAlpha = 0.6
  ctx.drawImage(L.mid.canvas, 1150, 300, 640, 360, -200, -150, 2400, 1350)
  ctx.restore()
  // la luz del flexo llega desde la izquierda, fuera de cuadro
  glow(ctx, 260, 760, 1000, P.glow, 0.34)
  const z = lerp(1, 1.06, seg(t, STORM_AT, T_LAMP))
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(z, z)
  ctx.translate(-W / 2, -H / 2)
  // la torre de la que cuelga, con las esquinas de sus hojas levantándose
  ctx.save()
  ctx.translate(1010, 1150)
  ctx.scale(3.3, 3.3)
  stack(ctx, 0, 0, 300, 16, 311, 0.4)
  ctx.restore()
  for (let i = 0; i < 6; i++) {
    const flap = Math.max(0, Math.sin(tq * 10 + i * 1.9)) * lift
    leaf(ctx, { x: 1400 - i * 150 + flap * 30, y: 1010 - i * 6 - flap * 46, s: 150, yaw: 1.57 + flap * 0.25, pitch: 1.44 - flap * 0.9, roll: 0, seed: i, tone: 0.45, warm: 0.25 })
  }
  // la hoja del calendario: cuelga de su chincheta; el viento la levanta de abajo arriba, como una bandera, hasta enseñar el envés
  const cw = 560
  const sh = 35
  const S = 20
  ctx.save()
  ctx.translate(990 - tear * tear * 2700, 130 - tear * 380)
  ctx.rotate(-0.04 + Math.sin(tq * 3.1) * 0.02 * (1 + lift * 4) - tear * 1.5)
  ctx.fillStyle = col('#000000', 0.35 * (1 - tear))
  ctx.fillRect(-cw / 2 + 26, 30, cw, 700 * (1 - lift * 0.45))
  const Lp: Pt[] = []
  const Rp: Pt[] = []
  const turn: number[] = []
  let px = 0
  let py = 0
  for (let i = 0; i <= S; i++) {
    const k = i / S
    const wave = Math.sin(tq * 9 - i * 0.45)
    const phi = lift * Math.pow(k, 1.5) * (1.55 + 0.55 * wave) + tear * k * 0.6
    const psi = lift * 0.16 * k * Math.sin(tq * 7 - i * 0.3)
    Lp.push({ x: px - Math.cos(psi) * (cw / 2), y: py - Math.sin(psi) * (cw / 2) })
    Rp.push({ x: px + Math.cos(psi) * (cw / 2), y: py + Math.sin(psi) * (cw / 2) })
    turn.push(phi)
    px -= Math.sin(phi) * sh * 0.92
    py += Math.cos(phi) * sh
  }
  for (let i = 0; i < S; i++) {
    const seen = Math.cos(turn[i]) > 0
    if (seen) {
      texTri(ctx, cal.canvas, { x: 0, y: i * sh }, { x: cw, y: i * sh }, { x: 0, y: (i + 1) * sh }, Lp[i], Rp[i], Lp[i + 1])
      texTri(ctx, cal.canvas, { x: cw, y: i * sh }, { x: cw, y: (i + 1) * sh }, { x: 0, y: (i + 1) * sh }, Rp[i], Rp[i + 1], Lp[i + 1])
    }
    ctx.beginPath()
    ctx.moveTo(Lp[i].x, Lp[i].y)
    ctx.lineTo(Rp[i].x, Rp[i].y)
    ctx.lineTo(Rp[i + 1].x, Rp[i + 1].y)
    ctx.lineTo(Lp[i + 1].x, Lp[i + 1].y)
    ctx.closePath()
    // el envés, liso; y cuanto más se tumba la hoja, menos luz le da
    ctx.fillStyle = seen ? col('#1a1410', 0.3 * Math.sin(Math.min(Math.PI / 2, turn[i]))) : '#c9c1ad'
    ctx.fill()
    if (!seen) {
      ctx.strokeStyle = '#c9c1ad'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
  ctx.strokeStyle = col('#0b0f1c', 0.85)
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.beginPath()
  Lp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
  for (let i = S; i >= 0; i--) ctx.lineTo(Rp[i].x, Rp[i].y)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
  if (tear <= 0) {
    ctx.fillStyle = P.brickDeep
    ctx.beginPath()
    ctx.arc(990, 148, 13, 0, Math.PI * 2)
    ctx.fill()
  }
  // hojas que cruzan por delante
  for (let i = 0; i < 5; i++) {
    const tau = (tq - (STORM_AT + 0.15 + i * 0.24)) / 0.55
    if (tau < 0 || tau > 1) continue
    leaf(ctx, { x: lerp(W + 380, -380, tau), y: 240 + hash(i, 15) * 620 + Math.sin(tau * 7) * 40, s: 190 + hash(i, 16) * 150, yaw: tau * 2 + i, pitch: Math.sin(tau * 9 + i) * 1.2, roll: tau * 7 + i * 2, seed: 100 + i, tone: 0.5, warm: 0.3, smear: { x: 300, y: -14 } })
  }
  ctx.restore()
  paperOver(ctx, 0.9)
}

// ── Plano 2 · el flexo ───────────────────────────────────────────────────────────────────────────────────────────────
function shotLamp(ctx: Ctx, t: number, L: { far: Sheet; mid: Sheet }): void {
  const tq = twos(t)
  const d = drawing(t)
  const dead = t >= T_DARK
  // firme, luego tartamudea, luego muere
  const stut = hash(d, 77)
  const I = t < 11.3 ? 0.94 + 0.06 * Math.sin(t * 40) : t < 12.15 ? (stut > 0.3 ? 1 : 0.32) : dead ? 0 : stut > 0.55 ? 0.9 : 0.1
  const ember = dead ? 1 - seg(t, T_DARK, 13.15) : 0
  const amp = lerp(0.012, 0.075, seg(t, T_LAMP, T_DARK))
  const th = (hash(d, 81) - 0.5) * 2 * amp + Math.sin(tq * 5) * amp
  // un relámpago lejano avisa, un instante antes del grande
  const pre = t > 12.92 && t < 13.0 ? 1 : 0
  const boil = d % 3
  const DESK = 836
  ctx.fillStyle = pre ? '#1c2644' : '#090d1a'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.filter = 'blur(16px)'
  ctx.globalAlpha = 0.55 + pre * 0.4
  ctx.drawImage(L.far.canvas, 420, 330, 760, 428, -120, -260, 2300, 1294)
  ctx.restore()
  const z = lerp(1, 1.07, seg(t, T_LAMP, T_WIDE))
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(z, z)
  ctx.translate(-W / 2 + 26 * seg(t, T_LAMP, T_WIDE), -H / 2)
  // la cabeza del flexo gira un poco alrededor de su articulación
  const J: Pt = { x: 1360, y: 590 }
  const hx = 1040 - J.x
  const hy = 350 - J.y
  const Hd: Pt = { x: J.x + hx * Math.cos(th) - hy * Math.sin(th), y: J.y + hx * Math.sin(th) + hy * Math.cos(th) }
  const ang = 2.12 + th * 2
  const a = { x: Math.cos(ang), y: Math.sin(ang) }
  const b = { x: -a.y, y: a.x }
  const at = (u: number, v: number): Pt => ({ x: Hd.x + a.x * u + b.x * v, y: Hd.y + a.y * u + b.y * v })
  const poly = (pts: Pt[]): void => {
    ctx.beginPath()
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    ctx.closePath()
  }
  const rimL = at(250, 200)
  const rimR = at(250, -200)
  const reach = (p: Pt, q: Pt): Pt => {
    const k = (DESK + 6 - p.y) / (p.y - q.y)
    return { x: p.x + (p.x - q.x) * k, y: DESK + 6 }
  }
  const footL = reach(rimL, at(-40, 30))
  const footR = reach(rimR, at(-40, -30))
  // la luz: tiñe el aire, y el haz cae sobre la mesa
  if (I > 0.02) {
    glow(ctx, 780, 740, 1200, P.glow, 0.3 * I)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.filter = 'blur(10px)'
    const g = ctx.createLinearGradient(Hd.x, Hd.y, Hd.x - 420, DESK)
    g.addColorStop(0, col(P.glow, 0.66 * I))
    g.addColorStop(1, col(P.glow, 0.24 * I))
    ctx.fillStyle = g
    poly([rimL, footL, footR, rimR])
    ctx.fill()
    ctx.restore()
  }
  // la mesa y el charco de luz, color madera
  ctx.fillStyle = '#0b0a10'
  ctx.fillRect(-200, DESK, W + 400, 500)
  if (I > 0.02) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(-200, DESK, W + 400, 500)
    ctx.clip()
    ctx.filter = 'blur(12px)'
    ctx.fillStyle = mix('#5a3618', '#f0b86a', 0.6, 0.95 * I)
    ctx.beginPath()
    ctx.ellipse((footL.x + footR.x) / 2, DESK + 10, (footR.x - footL.x) / 2, 84, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  brush(ctx, [{ x: -200, y: DESK }, { x: W + 200, y: DESK }], { width: 7, color: INK, seed: 21 + boil, taper: 0, shake: 1.2 })
  ctx.strokeStyle = col('#7f90bd', 0.45)
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(-200, DESK + 5)
  ctx.lineTo(W + 200, DESK + 5)
  ctx.stroke()
  // las hojas de la mesa: dos se van, una detrás de otra
  const lit = lerp(0.78, 0.06, I)
  ;[[940, 11.0], [770, 11.45]].forEach(([x0, t0], i) => {
    const tau = Math.max(0, tq - t0)
    const go = Math.min(1, tau * 3)
    leaf(ctx, {
      x: x0 - 1500 * tau * tau - 380 * tau, y: DESK - 10 - 520 * tau + 240 * tau * tau, s: 250, yaw: (i - 0.5) * 0.2 + tau * 2.4, pitch: lerp(1.38, 0.2, go) + Math.sin(tau * 14) * 0.9 * go,
      roll: tau * 5, seed: 20 + i, tone: lit, warm: I * 0.7, curl: 0.05 + go * 0.2, smear: tau > 0.1 ? { x: 170, y: 40 } : undefined
    })
  })
  // la tercera se levanta… y una mano llega a tiempo y la planta contra la mesa
  const slam = seg(tq, 11.98, 12.1)
  const up = seg(tq, 11.76, 11.98) * (1 - seg(tq, 11.98, 12.06))
  leaf(ctx, {
    x: 590 - up * 34, y: DESK - 10 - up * 52, s: 250, yaw: -0.1 - up * 0.3, pitch: 1.38 - up * 0.75 + (slam >= 1 ? Math.sin(tq * 16) * 0.03 : 0), roll: 0, seed: 22, tone: lit, warm: I * 0.7,
    curl: 0.05 + up * 0.22
  })
  // el lápiz: rueda con el viento
  const roll = ease.in(seg(t, 11.4, 12.45))
  ctx.save()
  ctx.translate(1120 - roll * 280, DESK - 9)
  ctx.rotate(-0.03)
  ctx.fillStyle = mix('#d7a53c', '#3b3a40', 1 - I * 0.9)
  ctx.fillRect(-95, -8, 160, 16)
  ctx.fillStyle = mix(P.brick, '#2a2630', 1 - I * 0.9)
  ctx.fillRect(65, -8, 26, 16)
  ctx.fillStyle = mix('#e8dcc4', '#2a2f45', 1 - I * 0.9)
  ctx.beginPath()
  ctx.moveTo(-95, -8)
  ctx.lineTo(-128, 0)
  ctx.lineTo(-95, 8)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = col('#000000', 0.35)
  ctx.fillRect(-95, -8 + ((d * 5) % 14), 160, 3)
  ctx.strokeStyle = col('#0b0f1c', 0.9)
  ctx.lineWidth = 2.5
  ctx.strokeRect(-95, -8, 186, 16)
  ctx.restore()
  // el flexo: el brazo, con su filo de luz fría del cielo
  brush(ctx, [{ x: 1620, y: 1150 }, J], { width: 30, color: INK, seed: 31 + boil, taper: 0.1, shake: 1.4 })
  brush(ctx, [J, Hd], { width: 27, color: INK, seed: 34 + boil, taper: 0.1, shake: 1.4 })
  brush(ctx, [{ x: 1606, y: 1140 }, { x: J.x - 8, y: J.y + 8 }], { width: 5, color: '#5568a0', seed: 37, alpha: 0.9, taper: 0.7, shake: 0 })
  brush(ctx, [{ x: J.x + 2, y: J.y - 16 }, { x: Hd.x + 12, y: Hd.y - 4 }], { width: 5, color: '#5568a0', seed: 38, alpha: 0.9, taper: 0.7, shake: 0 })
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(J.x, J.y, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = col('#5568a0', 0.9)
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(J.x, J.y, 22, Math.PI * 1.05, Math.PI * 1.7)
  ctx.stroke()
  // la pantalla: sombra, el plano que mira al cielo, un brillo, y el rebote cálido junto a la boca
  const s1 = at(-34, 66)
  const s2 = at(-34, -66)
  poly([s1, s2, rimR, rimL])
  ctx.fillStyle = '#121930'
  ctx.fill()
  poly([s1, at(-34, 24), at(250, 96), rimL])
  ctx.fillStyle = '#2f3b63'
  ctx.fill()
  poly([at(-6, 56), at(-6, 44), at(232, 150), at(232, 176)])
  ctx.fillStyle = col('#8496c9', 0.75)
  ctx.fill()
  if (I > 0.02) {
    poly([at(184, 168), at(184, -168), rimR, rimL])
    ctx.fillStyle = col(P.glow, 0.42 * I)
    ctx.fill()
  }
  brush(ctx, [s1, rimL], { width: 7, color: INK, seed: 41 + boil, taper: 0.3, shake: 1.2 })
  brush(ctx, [s2, rimR], { width: 8, color: INK, seed: 44 + boil, taper: 0.3, shake: 1.2 })
  brush(ctx, [s1, s2], { width: 7, color: INK, seed: 47 + boil, taper: 0.2, shake: 0.8 })
  // la boca de la pantalla y la bombilla
  const rim = at(250, 0)
  ctx.fillStyle = mix('#141a2c', '#f3c478', I * 0.95)
  ctx.beginPath()
  ctx.ellipse(rim.x, rim.y, 200, 52, Math.atan2(b.y, b.x), 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 6
  ctx.stroke()
  const bulb = at(238, 0)
  ctx.fillStyle = mix('#2b3149', P.sunCore, I)
  ctx.beginPath()
  ctx.arc(bulb.x, bulb.y, 50, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = col('#0b0f1c', 0.75)
  ctx.lineWidth = 3
  ctx.stroke()
  if (I > 0.02) glow(ctx, bulb.x, bulb.y, 380, P.sunCore, 0.95 * I)
  // cada vez que vuelve la luz, salta un chispazo de rayitas alrededor de la bombilla
  if (t >= 11.3 && I > 0.8) {
    ctx.strokeStyle = col(P.sunCore, 0.9)
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    for (let i = 0; i < 9; i++) {
      const q = (i / 9) * Math.PI * 2 + d * 0.7
      const r0 = 96 + hash(i + d, 83) * 26
      const r1 = r0 + 26 + hash(i + d, 84) * 34
      ctx.beginPath()
      ctx.moveTo(bulb.x + Math.cos(q) * r0, bulb.y + Math.sin(q) * r0)
      ctx.lineTo(bulb.x + Math.cos(q) * r1, bulb.y + Math.sin(q) * r1)
      ctx.stroke()
    }
  }
  if (ember > 0) {
    ctx.strokeStyle = col('#ff8a3c', ember)
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(bulb.x, bulb.y + 6, 20, Math.PI * 1.1, Math.PI * 1.9)
    ctx.stroke()
    glow(ctx, bulb.x, bulb.y, 130, '#ff8a3c', 0.55 * ember)
  }
  // motas de polvo en el haz, arrastradas por el viento
  if (I > 0.2) {
    for (let i = 0; i < 46; i++) {
      const x = footL.x + ((hash(i, 91) * 1100 - tq * (260 + hash(i, 92) * 300)) % 1100 + 1100) % 1100
      const y = 500 + hash(i, 93) * 320
      ctx.fillStyle = col(P.sunCore, 0.7 * I * hash(i, 94))
      ctx.fillRect(x, y, 4, 4)
    }
  }
  // la mano y el antebrazo, en silueta contra el haz
  if (slam > 0) {
    const k = ease.outBack(slam)
    const mx = lerp(-320, 592, k)
    const my = lerp(DESK - 210, DESK - 22, k)
    brush(ctx, [{ x: mx - 900, y: my - 250 }, { x: mx - 420, y: my - 132 }, { x: mx - 50, y: my - 10 }], { width: 104, color: INK, seed: 51, taper: 0.3, shake: 0 })
    ctx.fillStyle = INK
    ctx.save()
    ctx.translate(mx, my)
    ctx.rotate(0.1)
    ctx.beginPath()
    ctx.ellipse(6, 2, 84, 27, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(-22, -24, 34, 13, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // el golpe: rayitas que duran dos dibujos
    if (tq < 12.1 + 2.5 / 12 && slam >= 1) {
      ctx.strokeStyle = col(I > 0.5 ? '#fff3d6' : '#aebbd9', 0.9)
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      for (let i = 0; i < 7; i++) {
        const q = -Math.PI * (0.08 + (i / 6) * 0.84)
        const r0 = 120 + hash(i + d, 85) * 20
        const r1 = r0 + 40 + hash(i + d, 86) * 40
        ctx.beginPath()
        ctx.moveTo(mx + Math.cos(q) * r0, my + Math.sin(q) * r0 * 0.7)
        ctx.lineTo(mx + Math.cos(q) * r1, my + Math.sin(q) * r1 * 0.7)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
  paperOver(ctx, 0.9)
}

// ── Plano 3 · la ola se levanta ──────────────────────────────────────────────────────────────────────────────────────
function shotGather(ctx: Ctx, t: number, frame: number, L: { far: Sheet; mid: Sheet }): void {
  const tq = twos(t)
  const fg = temp(1)
  const c = fg.ctx
  c.save()
  c.globalAlpha = 0.5
  c.drawImage(L.far.canvas, 0, 0)
  c.restore()
  // las torres de la izquierda aguantan; las de la derecha se vencen hacia la ola y se deshojan
  c.save()
  c.beginPath()
  c.rect(0, 0, 1010, H)
  c.clip()
  c.drawImage(L.mid.canvas, 0, 0)
  c.restore()
  const eat = ease.in(seg(t, T_WIDE, T_WAVE))
  ;[[1090, 30, 104], [1240, 44, 112], [1400, 26, 100]].forEach(([x, n, w], i) => stack(c, x + eat * 70, FLOOR + 6, w, Math.max(2, Math.round(n * (1 - eat * (0.5 + i * 0.2)))), 340 + i, 0.72, 0.5 + eat * (2 + i)))
  const r = ease.io(seg(t, 13.35, T_WAVE)) * 0.62
  greatWave(c, tq, r, 0, 1770, FLOOR + 22, 0.66)
  c.fillStyle = '#0b0e1a'
  c.fillRect(0, FLOOR + 8, W, H)
  groundLine(c, 0, W, FLOOR + 8, 4, INK, 8)
  desk(c, 1050, 694, 440, 80)
  c.save()
  c.translate(1150, 688)
  c.scale(-1, 1)
  lamp(c, 0, 0, 1.05, 90)
  c.restore()
  // él: de pie, retrocede y se cubre
  const back = ease.out(seg(t, 13.5, 15.2))
  student(c, { x: 858 - back * 130, y: FLOOR, size: 262, kind: back > 0 && back < 1 ? 'walk' : 'stand', phase: -(tq - 13.5) * 1.5, lean: -0.22, shield: smooth(seg(t, 14.3, 15.2)), wind: 1.3, time: tq, frame })
  // las hojas, aspiradas en arcos hacia la ola
  const active = seg(t, T_WIDE, 14.5)
  for (let i = 0; i < 84; i++) {
    if (i / 84 > active) continue
    const tau = (tq * (0.5 + hash(i, 91) * 0.25) + hash(i, 92)) % 1
    const sx = 40 + hash(i, 93) * 1000
    const sy = FLOOR - 110 - hash(i, 94) * 430
    const dx = 1480 + hash(i, 95) * 190
    const dy = FLOOR - 50 - hash(i, 96) * 200 * (0.3 + r)
    const mx = (sx + dx) / 2
    const my = Math.min(sy, dy) - 150 - hash(i, 97) * 250
    const u = 1 - tau
    leaf(c, {
      x: u * u * sx + 2 * u * tau * mx + tau * tau * dx, y: u * u * sy + 2 * u * tau * my + tau * tau * dy, s: lerp(48, 18, tau), yaw: tq * 1.4 + i,
      pitch: Math.sin(tq * (5 + hash(i, 98) * 4) + i) * 1.25, roll: tq * 3 + i * 1.7, seed: i, tone: 0.45 + hash(i, 99) * 0.25, alpha: Math.min(1, tau * 7) * (1 - seg(tau, 0.88, 1))
    })
  }
  gusts(c, tq, 16, 301, (id, u) => {
    const sx = -120 + hash(id, 1) * 760
    const sy = 250 + hash(id, 2) * 460
    const dx = 1560
    const dy = FLOOR - 120 - hash(id, 3) * 170
    const my = Math.min(sy, dy) - 110 - hash(id, 4) * 170
    const v = 1 - u
    return { x: v * v * sx + 2 * v * u * ((sx + dx) / 2) + u * u * dx, y: v * v * sy + 2 * v * u * my + u * u * dy }
  })
  compose(ctx, t, fg, T_WIDE, 520, { x: W / 2, y: 545, zoom: lerp(1.0, 1.05, seg(t, T_WIDE, T_WAVE)) })
}

// ── Planos 4 y 5 · la gran ola, y rompe ──────────────────────────────────────────────────────────────────────────────
function shotWave(ctx: Ctx, t: number, frame: number): void {
  const tq = twos(t)
  const fg = temp(1)
  const c = fg.ctx
  const r = lerp(0.8, 1, ease.out(seg(t, T_WAVE, 16.7)))
  const crash = ease.in(seg(t, 16.8, 17.7))
  const tips = greatWave(c, tq, r, crash, lerp(1510, 1400, seg(t, T_WAVE, 18)), 1170, 1.14)
  // la espuma: hojas que saltan de las garras
  for (let i = 0; i < 42; i++) {
    const tip = tips[i % tips.length]
    const tau = (tq * (0.9 + hash(i, 51) * 0.5) + hash(i, 52)) % 1
    leaf(c, {
      x: tip.x - (140 + hash(i, 53) * 300) * tau, y: tip.y + (-80 + hash(i, 54) * 60) * tau + 420 * tau * tau, s: 34 + hash(i, 55) * 30, yaw: tq * 2 + i, pitch: Math.sin(tq * 8 + i) * 1.3,
      roll: tq * 4 + i * 1.3, seed: i, tone: 0.28 + hash(i, 56) * 0.3, alpha: Math.min(1, tau * 7) * (1 - seg(tau, 0.75, 1))
    })
  }
  // y el confeti: trocitos que saltan más lejos, como los puntos de espuma de las estampas
  for (let i = 0; i < 80; i++) {
    const tip = tips[(i * 3) % tips.length]
    const tau = (tq * (0.7 + hash(i, 151) * 0.5) + hash(i, 152)) % 1
    leaf(c, {
      x: tip.x - (60 + hash(i, 153) * 520) * tau + (hash(i, 157) - 0.5) * 90, y: tip.y + (-190 + hash(i, 154) * 150) * tau + 520 * tau * tau, s: 9 + hash(i, 155) * 12, yaw: tq * 3 + i,
      pitch: Math.sin(tq * 9 + i) * 1.2, roll: tq * 5 + i, seed: i, tone: 0.12 + hash(i, 156) * 0.3, alpha: Math.min(1, tau * 7) * (1 - seg(tau, 0.8, 1))
    })
  }
  // el viento sube por la pared de la ola
  gusts(c, tq, 14, 401, (id, u) => {
    const x0 = 120 + hash(id, 1) * 480
    const y0 = 930 - hash(id, 2) * 260
    const x1 = 1010 + hash(id, 3) * 150
    const x2 = 1130 + hash(id, 4) * 130
    const y2 = 380 + hash(id, 5) * 220
    const v = 1 - u
    return { x: v * v * x0 + 2 * v * u * x1 + u * u * x2, y: v * v * y0 + 2 * v * u * 915 + u * u * y2 }
  })
  // el suelo, y él: pequeño, clavado, con el brazo en alto
  c.fillStyle = '#070a13'
  c.fillRect(0, 1000, W, 200)
  groundLine(c, 0, W, 1000, 6, INK, 10)
  const brace = smooth(seg(t, T_WAVE, 16.3))
  student(c, { x: 390 - brace * 40, y: 1004, size: 330, kind: 'stand', lean: -0.3 * brace, shield: brace, wind: 1.5, time: tq, frame })
  // rompe: las hojas vienen hacia la cámara
  const burst = seg(t, T_CRASH, 17.9)
  if (burst > 0) {
    for (let i = 0; i < 46; i++) {
      const a = hash(i, 71) * Math.PI * 2
      const tau = clamp(burst * (0.7 + hash(i, 72) * 0.9))
      const dist = tau * tau * 1500
      leaf(c, { x: 820 + Math.cos(a) * dist, y: 520 + Math.sin(a) * dist * 0.75, s: 30 + tau * tau * 560, yaw: a + tq, pitch: Math.sin(tq * 9 + i) * 1.2, roll: tq * 5 + i, seed: 300 + i, tone: 0.35 })
    }
  }
  // y las últimas se plantan contra el objetivo, hasta taparlo todo: de ahí sale el blanco
  for (let i = 0; i < 15; i++) {
    const tau = ease.out(seg(t, 17.42 + (i % 7) * 0.045, 17.9))
    if (tau <= 0) continue
    const tx = 190 + (i % 5) * 385 + (hash(i, 161) - 0.5) * 120
    const ty = 190 + Math.floor(i / 5) * 350 + (hash(i, 162) - 0.5) * 100
    leaf(c, { x: lerp(820, tx, tau), y: lerp(520, ty, tau), s: lerp(50, 720, tau), yaw: (hash(i, 163) - 0.5) * 1.6 + (1 - tau) * 2, pitch: (1 - tau) * 0.9, roll: (1 - tau) * 1.2, seed: 400 + i, tone: 0.08 + hash(i, 164) * 0.14, curl: 0.06 })
  }
  compose(ctx, t, fg, T_WAVE, 1500, { x: W / 2 - 20 * seg(t, T_WAVE, 18), y: H / 2 + 14, zoom: lerp(1.02, 1.1, seg(t, T_WAVE, 18)) }, { at: T_HIT, x: 760, y: 560 })
  const white = ease.in(seg(t, 17.35, 18))
  if (white > 0) {
    ctx.fillStyle = mix(P.night3, '#c9d0de', white, white)
    ctx.fillRect(0, 0, W, H)
  }
}

export function drawStorm(ctx: Ctx, t: number, frame: number, L: { far: Sheet; mid: Sheet }): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  if (t < T_LAMP) shotCalendar(ctx, t, L)
  else if (t < T_WIDE) shotLamp(ctx, t, L)
  else if (t < T_WAVE) shotGather(ctx, t, frame, L)
  else shotWave(ctx, t, frame)
}
