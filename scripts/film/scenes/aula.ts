// Epílogo — Aula (49,6–72 s). El arco y el sol se dibujan como el icono; debajo, la app de verdad, en grande; y el
// estudiante vuelve a aparecer, pequeño, bajo el arco.
import { bell, clamp, col, ease, H, hash, lerp, mix, P, seg, smooth, W } from '../engine/core.ts'
import { blob, brush, ellipsePts, glow, paperOver, sheet, sky, title, wash, type Ctx, type Sheet } from '../engine/paint.ts'
import { arch, groundLine, paperSheet } from '../engine/props.ts'
import { student } from '../engine/figure.ts'
import { END, LEN, N_SHOTS, S0 } from '../timing.ts'

let back: Sheet
const shots: Record<string, ImageBitmap> = {}

async function load(name: string): Promise<void> {
  try {
    const res = await fetch(`vt://work/${name}`)
    if (!res.ok) return
    shots[name.replace(/\.\w+$/, '')] = await createImageBitmap(await res.blob())
  } catch {
    // sin la captura, ese plano sale sin imagen (render.ts avisa)
  }
}

export async function initAula(): Promise<string[]> {
  back = sheet()
  sky(back.ctx, [[0, P.paper], [0.6, P.paper], [1, P.paper2]])
  for (let i = 0; i < 10; i++) {
    wash(back.ctx, blob(ellipsePts(hash(i, 151) * W, hash(i, 152) * H, 300 + hash(i, 153) * 380, 110 + hash(i, 154) * 170, 14), 30, i + 160, 0.004), i % 3 === 0 ? P.dawn1 : i % 3 === 1 ? P.paperShade : P.dawn0, { alpha: 0.22, bleed: 46, edge: 0.08, grain: 0.6 })
  }
  TILES = layTiles()
  const names = [...new Set(SHOTS.map((s) => s.img))].filter((n) => n !== 'devices').map((n) => `${n}.png`)
  const mol = Array.from({ length: MOL_FRAMES }, (_, i) => `mol-${String(i).padStart(2, '0')}.jpg`)
  await Promise.all([...names, ...mol, 'ipad.jpg', 'iphone.jpg'].map(load))
  return Object.keys(shots)
}

/** Fotogramas de la molécula girando y su recuadro dentro de la captura de 1440×900 (scripts/film/shots.mjs → MOL). */
const MOL_FRAMES = 36
const MOL = { x: 300, y: 118, w: 730, h: 580 }

/** Una pantalla de la app como una lámina sobre el papel: esquinas redondas, sombra suave y un leve vuelco. `over` pinta
 *  encima un recorte animado (la molécula que gira). */
function card(ctx: Ctx, img: ImageBitmap | undefined, x: number, y: number, w: number, tilt: number, alpha: number, radius = 22, bezel = 0, over?: ImageBitmap): void {
  if (!img || alpha <= 0) return
  const h = (w * img.height) / img.width
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(x, y)
  ctx.transform(1, tilt, 0, 1, 0, 0)
  // sombra
  ctx.save()
  ctx.filter = 'blur(34px)'
  ctx.fillStyle = col(P.brickDeep, 0.26)
  ctx.beginPath()
  ctx.roundRect(-w / 2 + 16, -h / 2 + 46, w, h, radius)
  ctx.fill()
  ctx.restore()
  if (bezel > 0) {
    ctx.fillStyle = '#15130f'
    ctx.beginPath()
    ctx.roundRect(-w / 2 - bezel, -h / 2 - bezel, w + bezel * 2, h + bezel * 2, radius + bezel)
    ctx.fill()
  }
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, radius)
  ctx.save()
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  if (over) {
    const k = w / 1440
    ctx.drawImage(over, -w / 2 + MOL.x * k, -h / 2 + MOL.y * k, MOL.w * k, MOL.h * k)
  }
  ctx.restore()
  ctx.strokeStyle = col(P.ink, 0.16)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** Rótulo de dos líneas a la izquierda; la segunda, en cursiva ladrillo. */
function caption(ctx: Ctx, a: string, b: string, x: number, y: number, k: number, size = 82): void {
  if (k <= 0) return
  const face = (italic: boolean, px: number): string => `${italic ? 'italic ' : ''}500 ${px}px "New York", ui-serif, "Iowan Old Style", Georgia, serif`
  ctx.save()
  // que el rótulo nunca pise la pantalla: si no cabe en su columna, se encoge
  ctx.font = face(false, size)
  const wide = Math.max(ctx.measureText(a).width, ctx.measureText(b).width * 1.02)
  if (wide > 600) size = Math.floor((size * 600) / wide)
  const font = (italic: boolean): string => face(italic, size)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = clamp(k * 1.6)
  ctx.font = font(false)
  ctx.fillStyle = P.ink
  ctx.fillText(a, x - (1 - ease.out(k)) * 40, y)
  ctx.globalAlpha = clamp(k * 1.6 - 0.4)
  ctx.font = font(true)
  ctx.fillStyle = P.brick
  ctx.fillText(b, x - (1 - ease.out(clamp(k * 1.3 - 0.3))) * 40, y + size * 1.16)
  ctx.restore()
}

const SHOTS: { img: string; a: string; b: string }[] = [
  { img: 'today', a: 'Your notes', b: 'become a course.' },
  { img: 'create', a: 'PDFs, slides, photos,', b: 'recordings: all of it.' },
  { img: 'materials', a: 'Built from', b: 'your own sources.' },
  { img: 'lesson', a: 'It teaches', b: 'before it asks.' },
  { img: 'molecules', a: 'Molecules in 3D', b: 'you can turn.' },
  { img: 'grapher', a: 'Graphs', b: 'you can play with.' },
  { img: 'physics', a: 'Simulations', b: 'to see why.' },
  { img: 'tutor', a: 'Stuck? It knows', b: "what you're doing." },
  { img: 'mistakes', a: 'Your mistakes,', b: 'kept and reviewed.' },
  { img: 'reader', a: 'Ask about a document,', b: 'get the page cited.' },
  { img: 'chat', a: 'Ask Aula', b: 'anything.' },
  { img: 'chat-course', a: 'Make or change a course', b: 'just by asking.' },
  { img: 'quiz', a: 'A quiz on the spot,', b: 'graded instantly.' },
  { img: 'exam', a: 'Mock exams,', b: 'like the real one.' },
  { img: 'calendar', a: 'It studies with you,', b: 'every day.' },
  { img: 'inbox', a: 'Always on: it checks', b: 'your school platform.' },
  { img: 'periodic', a: 'Every tool', b: 'a student needs.' },
  { img: 'stats', a: 'Watch yourself', b: 'get better.' },
  { img: 'settings', a: 'Your own AI,', b: 'even offline.' },
  { img: 'devices', a: 'On your Mac,', b: 'your iPad, your iPhone.' }
]
if (SHOTS.length !== N_SHOTS) throw new Error('timing.ts → N_SHOTS no coincide con las pantallas')

interface Tile { x: number; y: number; rot: number; fx: number; fy: number; delay: number; seed: number }
let TILES: Tile[] = []
/** El arco del final, en grande. */
const LOGO = { cx: W / 2, ground: 600, width: 330 }

/** Dónde se posa cada hoja para formar el arco (los dos pilares y el medio punto) y de dónde viene volando. */
function layTiles(): Tile[] {
  const k = LOGO.width / 420
  const r = LOGO.width / 2
  const band = 96 * k
  const top = LOGO.ground - 504 * k
  const at: { x: number; y: number; rot: number }[] = []
  for (const side of [-1, 1]) {
    for (let c = 0; c < 3; c++) {
      for (let y = LOGO.ground - 14; y > top + r; y -= 21) at.push({ x: LOGO.cx + side * (r - (band * (c + 0.5)) / 3), y, rot: (hash(at.length, 61) - 0.5) * 0.18 })
    }
  }
  for (let c = 0; c < 3; c++) {
    const rho = r - (band * (c + 0.5)) / 3
    const n = Math.floor((Math.PI * rho) / 22)
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI
      at.push({ x: LOGO.cx + Math.cos(a) * rho, y: top + r + Math.sin(a) * rho, rot: a + Math.PI / 2 + (hash(at.length, 62) - 0.5) * 0.18 })
    }
  }
  return at.map((q, i) => {
    const a = hash(i, 63) * Math.PI * 2
    const d = 1250 + hash(i, 64) * 520
    return { ...q, fx: W / 2 + Math.cos(a) * d, fy: H / 2 + Math.sin(a) * d * 0.7, delay: hash(i, 65) * 1.3, seed: 4000 + i }
  })
}

/** El final: las hojas de la tormenta vuelven volando y forman el arco; amanece detrás, y él llega. */
function finale(ctx: Ctx, t: number, fin: number, frame: number): void {
  const { cx, ground, width } = LOGO
  const settle = smooth(seg(fin, 2.35, 3.05))
  const rise = ease.out(seg(fin, 2.5, 4.1))
  if (rise > 0) {
    // el amanecer: un halo cálido y rayos que se abren detrás del arco
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    const g = ctx.createRadialGradient(cx, ground - 40, 40, cx, ground - 40, 1180)
    g.addColorStop(0, col(P.sun, 0.55 * rise))
    g.addColorStop(0.32, col(P.dawn2, 0.3 * rise))
    g.addColorStop(1, col(P.dawn1, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.filter = 'blur(9px)'
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI + ((i + 0.5) / 24) * Math.PI + Math.sin(t * 0.25 + i) * 0.02
      const wd = 0.014 + hash(i, 71) * 0.03
      const len = (640 + hash(i, 72) * 760) * rise
      const lg = ctx.createLinearGradient(cx, ground, cx + Math.cos(a) * len, ground + Math.sin(a) * len)
      lg.addColorStop(0, col(P.sun, 0.36 * rise))
      lg.addColorStop(1, col(P.sun, 0))
      ctx.fillStyle = lg
      ctx.beginPath()
      ctx.moveTo(cx, ground - 6)
      ctx.lineTo(cx + Math.cos(a - wd) * len, ground + Math.sin(a - wd) * len)
      ctx.lineTo(cx + Math.cos(a + wd) * len, ground + Math.sin(a + wd) * len)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    glow(ctx, cx, ground - width * 0.3, width * 2.2, P.sunCore, 0.5 * rise)
  }
  if (settle < 1) {
    ctx.save()
    ctx.globalAlpha = 1 - settle
    for (const q of TILES) {
      const p = seg(fin, 0.1 + q.delay, 1.15 + q.delay)
      if (p <= 0) continue
      const e = ease.outExpo(p)
      const sw = Math.sin(p * Math.PI) * 90 * (1 - e)
      paperSheet(ctx, {
        x: lerp(q.fx, q.x, e) + Math.cos(q.seed) * sw, y: lerp(q.fy, q.y, e) + Math.sin(q.seed) * sw, w: lerp(56, 23, e), rot: lerp((q.seed % 6) + t * 2, q.rot, e),
        flip: lerp((q.seed % 5) + t * 4, 0.12, e), seed: q.seed, shade: 0, tint: mix('#fffaf0', P.brick, clamp((p - 0.8) * 5) * 0.92), toward: P.paperShade,
        outline: col(P.ink, 0.3), lines: p < 0.78
      })
    }
    ctx.restore()
  }
  if (settle > 0) arch(ctx, { cx, ground, width, seed: 21, sun: ease.out(seg(fin, 2.7, 4.1)), light: 0, alpha: settle })
  groundLine(ctx, cx - width * 0.82, cx + width * 0.82, ground + 3, 61, P.ink, 11, ease.io(seg(fin, 1.9, 2.9)))
  // pájaros de papel que salen del arco
  for (let i = 0; i < 12; i++) {
    const p = seg(fin, 3.2 + i * 0.13, 8.8 + i * 0.13)
    if (p <= 0 || p >= 1) continue
    const a = -Math.PI * (0.16 + 0.68 * hash(i, 81))
    const d = 70 + p * 1200
    const flap = Math.sin(t * 9 + i * 1.7)
    paperSheet(ctx, {
      x: cx + Math.cos(a) * d + Math.sin(t + i) * 14, y: ground - 150 + Math.sin(a) * d * 0.62 - p * 60, w: 14 + p * 28, rot: a + Math.PI / 2 + flap * 0.12, flip: 1.05 + flap * 0.42,
      seed: 5000 + i, shade: 0, tint: '#fffaf0', toward: P.paperShade, outline: col(P.ink, 0.35), alpha: Math.min(1, p * 8) * (1 - seg(p, 0.85, 1))
    })
  }
  if (fin > 3.1) {
    const walk = seg(fin, 3.2, 6.0)
    student(ctx, { x: lerp(W / 2 - 520, W / 2 - 58, ease.out(walk)), y: 603, size: 104, kind: walk < 1 ? 'walk' : 'stand', phase: fin * 1.6, lean: 0.08, wind: 0.3, time: t, frame, alpha: smooth(seg(fin, 3.1, 3.8)) })
  }
  const name = ease.out(seg(fin, 3.0, 3.9))
  title(ctx, 'Aula', W / 2, 742 + (1 - name) * 18, 168, P.ink, name, 0, 500)
  brush(ctx, [{ x: W / 2 - 150, y: 832 }, { x: W / 2 - 20, y: 826 }, { x: W / 2 + 155, y: 834 }], { width: 13, color: P.brick, seed: 23, taper: 0.8, dry: 0.5, progress: ease.io(seg(fin, 3.6, 4.4)) })
  title(ctx, 'Turns your notes into a course, and studies it with you.', W / 2, 902, 40, P.inkSoft, ease.out(seg(fin, 4.0, 4.9)) * 0.86, 0.5, 400, true)
  title(ctx, 'Free and open source  ·  Mac, Windows, Linux  ·  iPad and iPhone', W / 2, 962, 30, P.inkSoft, ease.out(seg(fin, 4.7, 5.6)) * 0.8, 1, 400)
  title(ctx, 'github.com/luumlabs/aula', W / 2, 1010, 30, P.brick, ease.out(seg(fin, 5.3, 6.2)), 1, 500)
}

export function drawAula(ctx: Ctx, t: number, frame: number): void {
  ctx.drawImage(back.canvas, 0, 0)
  const fin = t - END
  // el logo que nace y se queda pequeño, arriba, mientras pasan las pantallas
  const small = smooth(seg(t, S0 - 0.7, S0 + 0.2))
  const intro = 1 - smooth(seg(fin, -0.3, 0.4))
  if (intro > 0) {
    ctx.save()
    ctx.globalAlpha = intro
    const cx = lerp(W / 2, 150, small)
    const ground = lerp(600, 150, small)
    const width = lerp(330, 74, small)
    const rise = ease.out(seg(t, 50.9, 52.3))
    glow(ctx, cx, ground - width * 0.3, width * 2.6, P.glow, 0.38 * rise * (1 - small * 0.6))
    arch(ctx, { cx, ground, width, seed: 21, sun: rise, light: 0, draw: ease.io(seg(t, 49.9, 51.7)) })
    groundLine(ctx, cx - width * 0.82, cx + width * 0.82, ground + 3 * (width / 420), 61, P.ink, 9 * (width / 330) + 2, ease.io(seg(t, 49.7, 50.6)))
    if (small < 1) {
      const name = ease.out(seg(t, 51.8, 52.7))
      title(ctx, 'Aula', W / 2, 742 + (1 - name) * 18, 168, P.ink, name * (1 - small), 0, 500)
      ctx.save()
      ctx.globalAlpha = intro * (1 - small)
      brush(ctx, [{ x: W / 2 - 150, y: 832 }, { x: W / 2 - 20, y: 826 }, { x: W / 2 + 155, y: 834 }], { width: 13, color: P.brick, seed: 23, taper: 0.8, dry: 0.5, progress: ease.io(seg(t, 52.3, 53.1)) })
      ctx.restore()
      title(ctx, 'Your study companion.', W / 2, 902, 40, P.inkSoft, ease.out(seg(t, 52.9, 53.7)) * (1 - small) * 0.86, 0.5, 400, true)
    }
    if (small > 0.02) title(ctx, 'Aula', 262, 118, 56, P.ink, small, 0, 500)
    ctx.restore()
  }
  // el papel va debajo de las pantallas: la app se ve limpia, sin velo
  paperOver(ctx, 0.7)

  // las pantallas de la app
  if (t >= S0 - 0.5 && fin < 0.5) {
    SHOTS.forEach((s, i) => {
      const a = S0 + i * LEN
      // cada pantalla entra mientras la anterior aún se va: sin huecos en blanco entre una y otra
      const k = bell(t, a - 0.08, a + 0.3, a + LEN - 0.14, a + LEN + 0.24)
      if (k <= 0) return
      const enter = ease.outExpo(seg(t, a - 0.08, a + 0.8))
      const leave = ease.in(seg(t, a + LEN - 0.3, a + LEN + 0.24))
      const x = 1318 + (1 - enter) * 520 - leave * 240 - (t - a) * 11
      const y = 590 + (1 - enter) * 30
      if (s.img === 'devices') {
        card(ctx, shots.ipad, x - 190, y + 6, 560, -0.012, k, 30, 14)
        card(ctx, shots.iphone, x + 300, y + 70, 236, 0.014, clamp(k * 1.4 - 0.3), 36, 10)
      } else if (s.img === 'molecules') {
        // la molécula gira de verdad: fotogramas de la app, de ida y vuelta
        const f = Math.floor((t - a) * 12) % (MOL_FRAMES * 2 - 2)
        const n = f < MOL_FRAMES ? f : MOL_FRAMES * 2 - 2 - f
        card(ctx, shots.molecules, x, y, 1090, -0.012 + enter * 0.004, k, 22, 0, shots[`mol-${String(n).padStart(2, '0')}`])
      } else card(ctx, shots[s.img], x, y, 1090, -0.012 + enter * 0.004, k)
      caption(ctx, s.a, s.b, 120, 520, bell(t, a + 0.12, a + 0.65, a + LEN - 0.32, a + LEN))
    })
  }
  if (fin > -0.1) finale(ctx, t, fin, frame)

  const inn = 1 - ease.out(seg(t, 49.6, 50.3))
  if (inn > 0) {
    ctx.fillStyle = col(P.paper, inn)
    ctx.fillRect(0, 0, W, H)
  }
  const out = seg(fin, 8.7, 9.4)
  if (out > 0) {
    ctx.fillStyle = `rgba(0,0,0,${out})`
    ctx.fillRect(0, 0, W, H)
  }
}
