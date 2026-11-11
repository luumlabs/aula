// Epílogo — Aula (49,6–72 s). El arco y el sol se dibujan como el icono; debajo, la app de verdad, en grande; y el
// estudiante vuelve a aparecer, pequeño, bajo el arco.
import { bell, clamp, col, ease, H, hash, lerp, P, seg, smooth, W } from '../engine/core.ts'
import { blob, brush, ellipsePts, glow, paperOver, sheet, sky, title, wash, type Ctx, type Sheet } from '../engine/paint.ts'
import { arch, groundLine } from '../engine/props.ts'
import { student } from '../engine/figure.ts'

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
  await Promise.all(['today.png', 'course.png', 'lesson.png', 'cards.png', 'calendar.png', 'ipad.jpg', 'iphone.jpg'].map(load))
  return Object.keys(shots)
}

/** Una pantalla de la app como una lámina sobre el papel: esquinas redondas, sombra suave y un leve vuelco. */
function card(ctx: Ctx, img: ImageBitmap | undefined, x: number, y: number, w: number, tilt: number, alpha: number, radius = 22, bezel = 0): void {
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
  ctx.restore()
  ctx.strokeStyle = col(P.ink, 0.16)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** Rótulo de dos líneas a la izquierda; la segunda, en cursiva ladrillo. */
function caption(ctx: Ctx, a: string, b: string, x: number, y: number, k: number, size = 82): void {
  if (k <= 0) return
  const font = (italic: boolean): string => `${italic ? 'italic ' : ''}500 ${size}px "New York", ui-serif, "Iowan Old Style", Georgia, serif`
  ctx.save()
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
  { img: 'lesson', a: 'It teaches', b: 'before it asks.' },
  { img: 'calendar', a: 'It studies with you,', b: 'every day.' },
  { img: 'devices', a: 'On your Mac,', b: 'your iPad, your iPhone.' }
]
const S0 = 54.4
const LEN = 2.95

export function drawAula(ctx: Ctx, t: number, frame: number): void {
  ctx.drawImage(back.canvas, 0, 0)
  const product = t >= S0 - 0.5 && t < S0 + SHOTS.length * LEN + 0.4
  const end = smooth(seg(t, S0 + SHOTS.length * LEN - 0.2, S0 + SHOTS.length * LEN + 1.0))
  // el logo: grande al nacer, pequeño arriba a la izquierda durante las pantallas, y grande otra vez al final
  const small = smooth(seg(t, S0 - 0.7, S0 + 0.2)) * (1 - end)
  const cx = lerp(W / 2, 150, small)
  const ground = lerp(600, 150, small)
  const width = lerp(330, 74, small)
  const draw = ease.io(seg(t, 49.9, 51.7))
  const rise = ease.out(seg(t, 50.9, 52.3))
  glow(ctx, cx, ground - width * 0.3, width * 2.6, P.glow, 0.38 * rise * (1 - small * 0.6))
  arch(ctx, { cx, ground, width, seed: 21, sun: rise, light: 0, draw })
  groundLine(ctx, cx - width * 0.82, cx + width * 0.82, ground + 3 * (width / 420), 61, P.ink, 9 * (width / 330) + 2, ease.io(seg(t, 49.7, 50.6)))
  // el nombre
  const name = ease.out(seg(t, 51.8, 52.7))
  if (small < 1) {
    title(ctx, 'Aula', W / 2, 742 + (1 - name) * 18, 168, P.ink, name * (1 - small), 0, 500)
    const u = ease.io(seg(t, 52.3, 53.1))
    ctx.save()
    ctx.globalAlpha = 1 - small
    brush(ctx, [{ x: W / 2 - 150, y: 832 }, { x: W / 2 - 20, y: 826 }, { x: W / 2 + 155, y: 834 }], { width: 13, color: P.brick, seed: 23, taper: 0.8, dry: 0.5, progress: u })
    ctx.restore()
    const line = end > 0 ? 'Turns your notes into a course, and studies it with you.' : 'Your study companion.'
    title(ctx, line, W / 2, 902, 40, P.inkSoft, ease.out(seg(t, 52.9, 53.7)) * (1 - small) * 0.86, 0.5, 400, true)
  }
  if (small > 0.02) title(ctx, 'Aula', 262, 118, 56, P.ink, small, 0, 500)
  // el papel va debajo de las pantallas: la app se ve limpia, sin velo
  paperOver(ctx, 0.7)

  // las pantallas de la app
  if (product) {
    SHOTS.forEach((s, i) => {
      const a = S0 + i * LEN
      const k = bell(t, a, a + 0.55, a + LEN - 0.3, a + LEN + 0.12)
      if (k <= 0) return
      const enter = ease.outExpo(seg(t, a, a + 0.9))
      const leave = ease.in(seg(t, a + LEN - 0.35, a + LEN + 0.12))
      const drift = (t - a) * 9
      const x = 1275 + (1 - enter) * 520 - leave * 240 - drift
      const y = 590 + (1 - enter) * 30
      if (s.img === 'devices') {
        card(ctx, shots.ipad, x - 190, y + 6, 560, -0.012, k, 30, 14)
        card(ctx, shots.iphone, x + 300, y + 70, 236, 0.014, clamp(k * 1.4 - 0.3), 36, 10)
      } else card(ctx, shots[s.img], x, y, 1130, -0.012 + enter * 0.004, k)
      caption(ctx, s.a, s.b, 120, 520, bell(t, a + 0.15, a + 0.8, a + LEN - 0.35, a + LEN))
    })
  }

  // el final: el estudiante llega, pequeño, y se queda mirando el sol bajo el arco
  if (end > 0) {
    const walk = seg(t, 66.4, 69.2)
    const x = lerp(W / 2 - 520, W / 2 - 58, ease.out(walk))
    student(ctx, { x, y: 603, size: 104, kind: walk < 1 ? 'walk' : 'stand', phase: (t - 66.4) * 1.6, lean: 0.08, wind: 0.3, time: t, frame, alpha: smooth(seg(t, 66.3, 67)) })
    const info = ease.out(seg(t, 67.2, 68.2))
    title(ctx, 'Free and open source  ·  Mac, Windows, Linux  ·  iPad and iPhone', W / 2, 962, 30, P.inkSoft, info * 0.8, 1, 400)
    title(ctx, 'github.com/luumlabs/aula', W / 2, 1010, 30, P.brick, ease.out(seg(t, 67.8, 68.8)), 1, 500)
  }
  const inn = 1 - ease.out(seg(t, 49.6, 50.3))
  if (inn > 0) {
    ctx.fillStyle = col(P.paper, inn)
    ctx.fillRect(0, 0, W, H)
  }
  const out = seg(t, 71.3, 72)
  if (out > 0) {
    ctx.fillStyle = `rgba(0,0,0,${out})`
    ctx.fillRect(0, 0, W, H)
  }
}
