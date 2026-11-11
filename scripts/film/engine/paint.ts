// Pintura por código para el corto: papel, aguadas de acuarela con el pigmento acumulado en el borde, trazos de pincel
// con pulso y pincel seco, resplandores y el acabado de película (grano, viñeta, temblor de ventanilla).
import { clamp, hash, lerp, noise1, noise2, rgb, css, col, smoothPath, wobble, resample, rng, type Pt, W, H } from './core.ts'

export type Ctx = OffscreenCanvasRenderingContext2D
export interface Sheet { canvas: OffscreenCanvas; ctx: Ctx }

export function sheet(w = W, h = H): Sheet {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx }
}

const scratch: Sheet[] = []
/** Lienzos de trabajo reutilizables del tamaño del máster. */
export function temp(i: number): Sheet {
  while (scratch.length <= i) scratch.push(sheet())
  const s = scratch[i]
  s.ctx.setTransform(1, 0, 0, 1, 0, 0)
  s.ctx.globalAlpha = 1
  s.ctx.globalCompositeOperation = 'source-over'
  s.ctx.filter = 'none'
  s.ctx.clearRect(0, 0, W, H)
  return s
}

/** Textura de papel en grises (grano fino + nubes + fibras): se multiplica sobre la imagen. */
export function paperTexture(w: number, h: number, seed: number): OffscreenCanvas {
  const s = sheet(w, h)
  const img = s.ctx.createImageData(w, h)
  const r = rng(seed)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cloud = noise2(x / 190, y / 190, seed) * 9 + noise2(x / 47, y / 47, seed + 3) * 6
      const tooth = (r() - 0.5) * 26
      const v = clamp(243 + cloud * 0.8 + tooth * 0.8, 0, 255)
      const i = (y * w + x) * 4
      img.data[i] = v
      img.data[i + 1] = v - 1
      img.data[i + 2] = v - 4
      img.data[i + 3] = 255
    }
  }
  s.ctx.putImageData(img, 0, 0)
  // fibras
  s.ctx.strokeStyle = 'rgba(120,100,70,0.05)'
  for (let k = 0; k < 900; k++) {
    const x = r() * w
    const y = r() * h
    const a = r() * Math.PI
    const len = 8 + r() * 30
    s.ctx.lineWidth = 0.6 + r() * 0.8
    s.ctx.beginPath()
    s.ctx.moveTo(x, y)
    s.ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 6, x + Math.cos(a) * len, y + Math.sin(a) * len)
    s.ctx.stroke()
  }
  return s.canvas
}

/** Ruido con transparencia: la granulación del pigmento (se usa para «comerse» la aguada a motas). */
export function grainMask(w: number, h: number, seed: number, scale = 2.2): OffscreenCanvas {
  const s = sheet(w, h)
  const img = s.ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise2(x / scale, y / scale, seed) * 0.5 + noise2(x / (scale * 9), y / (scale * 9), seed + 9) * 0.5
      const i = (y * w + x) * 4
      img.data[i + 3] = clamp((n + 0.15) * 150, 0, 255)
    }
  }
  s.ctx.putImageData(img, 0, 0)
  return s.canvas
}

let GRAIN: OffscreenCanvas | null = null
const granulation = (): OffscreenCanvas => (GRAIN ??= grainMask(W, H, 77))

export interface WashOptions {
  alpha?: number
  /** Cuánto se corre el borde (px). */
  bleed?: number
  /** Pigmento acumulado en el borde (0–1). */
  edge?: number
  /** Motas de granulación (0–1). */
  grain?: number
  /** Degradado dentro de la mancha: de `color` a `to`, en vertical. */
  to?: string
  fromY?: number
  toY?: number
}

/**
 * Una aguada: la forma rellena con el borde corrido, el pigmento más cargado en el contorno y granulación. Se pinta en
 * un lienzo de trabajo y se vuelca sobre `ctx`. `path` va en coordenadas del lienzo de destino.
 */
export function wash(ctx: Ctx, path: Path2D, color: string, o: WashOptions = {}): void {
  const { alpha = 0.6, bleed = 8, edge = 0.35, grain = 0.5 } = o
  const t = temp(7)
  const c = t.ctx
  c.setTransform(ctx.getTransform())
  c.filter = bleed > 0 ? `blur(${bleed}px)` : 'none'
  if (o.to) {
    const g = c.createLinearGradient(0, o.fromY ?? 0, 0, o.toY ?? H)
    g.addColorStop(0, color)
    g.addColorStop(1, o.to)
    c.fillStyle = g
  } else c.fillStyle = color
  c.fill(path)
  if (edge > 0) {
    c.filter = `blur(${Math.max(1, bleed * 0.35)}px)`
    c.globalAlpha = edge
    c.strokeStyle = color
    c.lineWidth = Math.max(2, bleed * 0.9)
    c.stroke(path)
    c.globalAlpha = 1
  }
  c.filter = 'none'
  if (grain > 0) {
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'destination-out'
    c.globalAlpha = grain * 0.5
    c.drawImage(granulation(), 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha *= alpha
  ctx.drawImage(t.canvas, 0, 0)
  ctx.restore()
}

/** Contorno cerrado y tembloroso a partir de puntos. */
export const blob = (pts: Pt[], amp = 6, seed = 1, freq = 0.012): Path2D => smoothPath(wobble(pts, amp, freq, seed), true)

/** Elipse como lista de puntos (para darle pulso). */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 28, rot = 0): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    out.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) })
  }
  return out
}

export interface BrushOptions {
  width: number
  color: string
  seed?: number
  alpha?: number
  /** Cuánto se afina en las puntas (0 = nada, 1 = del todo). */
  taper?: number
  /** Pincel seco: huecos a lo largo del trazo (0–1). */
  dry?: number
  /** Fracción dibujada del trazo (0–1), para que se trace solo. */
  progress?: number
  /** Temblor del pulso (px). */
  shake?: number
}

/** Un trazo de pincel: cinta de grosor variable con pulso, puntas afinadas y, si se pide, pincel seco. */
export function brush(ctx: Ctx, pts: Pt[], o: BrushOptions): void {
  const { width, color, seed = 1, alpha = 1, taper = 0.75, dry = 0, progress = 1, shake = width * 0.12 } = o
  if (progress <= 0 || pts.length < 2) return
  const n = Math.max(12, Math.min(160, Math.round(pathLength(pts) / 9)))
  const base = resample(pts, n)
  const upto = Math.max(2, Math.round(n * clamp(progress)))
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < upto; i++) {
    const s = i / (n - 1)
    const a = base[Math.max(0, i - 1)]
    const b = base[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const tip = Math.sin(Math.PI * clamp(s * (1 - 0.02) + 0.01))
    const end = i / Math.max(1, upto - 1)
    const live = progress < 1 ? Math.min(1, (1 - end) * 6 + 0.25) : 1
    const w = (width / 2) * (1 - taper + taper * Math.pow(tip, 0.6)) * (0.82 + 0.3 * noise1(s * 9, seed)) * live
    const jx = noise1(s * 13 + 3, seed + 1) * shake
    const jy = noise1(s * 13 + 9, seed + 2) * shake
    left.push({ x: base[i].x + jx + nx * w, y: base[i].y + jy + ny * w })
    right.push({ x: base[i].x + jx - nx * w, y: base[i].y + jy - ny * w })
  }
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  const outline = smoothPath([...left, ...right.reverse()], true)
  ctx.fill(outline)
  if (dry > 0) {
    // pincel seco: rayas del color del papel a lo largo del trazo
    ctx.globalCompositeOperation = 'destination-out'
    const r = rng(seed * 31 + 7)
    const streaks = Math.round(3 + dry * 7)
    for (let k = 0; k < streaks; k++) {
      const off = (r() - 0.5) * 0.9
      const from = Math.floor(r() * upto * 0.7)
      const to = Math.min(upto - 1, from + Math.floor(4 + r() * upto * 0.5))
      ctx.globalAlpha = 0.25 + dry * 0.5
      ctx.lineWidth = Math.max(0.6, width * 0.05 * (0.5 + r()))
      ctx.beginPath()
      for (let i = from; i <= to; i++) {
        const x = lerp(left[i].x, right[right.length - 1 - i]?.x ?? left[i].x, 0.5 + off * 0.5)
        const y = lerp(left[i].y, right[right.length - 1 - i]?.y ?? left[i].y, 0.5 + off * 0.5)
        if (i === from) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function pathLength(pts: Pt[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return d
}

/** Línea fina de plumilla con pulso. */
export function pen(ctx: Ctx, pts: Pt[], color: string, width = 2, seed = 1, shake = 1.2, progress = 1): void {
  brush(ctx, pts, { width, color, seed, taper: 0.35, shake, progress })
}

/** Resplandor: un disco de luz que se suma a la imagen. */
export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, strength = 1, core = 0): void {
  const c = rgb(color)
  const g = ctx.createRadialGradient(x, y, r * core, x, y, r)
  g.addColorStop(0, css(c, 0.9 * strength))
  g.addColorStop(0.35, css(c, 0.38 * strength))
  g.addColorStop(1, css(c, 0))
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Rayos de luz que salen de un punto (abanico de cuñas difuminadas). */
export function rays(ctx: Ctx, x: number, y: number, len: number, color: string, strength: number, seed: number, from = -Math.PI, to = 0, count = 14, turn = 0): void {
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.filter = 'blur(14px)'
  for (let i = 0; i < count; i++) {
    const a = lerp(from, to, (i + 0.5) / count) + (hash(i, seed) - 0.5) * 0.12 + turn
    const w = 0.012 + hash(i, seed + 3) * 0.03
    const l = len * (0.55 + hash(i, seed + 5) * 0.45)
    const g = ctx.createLinearGradient(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.addColorStop(0, col(color, 0.5 * strength))
    g.addColorStop(1, col(color, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a - w) * l, y + Math.sin(a - w) * l)
    ctx.lineTo(x + Math.cos(a + w) * l, y + Math.sin(a + w) * l)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Degradado vertical de fondo (el cielo). */
export function sky(ctx: Ctx, stops: [number, string][], y0 = 0, y1 = H): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  for (const [at, c] of stops) g.addColorStop(at, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

// ── Acabado de película ──────────────────────────────────────────────────────────────────────────────────────────────
let PAPER: OffscreenCanvas | null = null
let FILM_GRAIN: OffscreenCanvas[] = []

export function finishKit(): void {
  PAPER = paperTexture(W, H, 5)
  FILM_GRAIN = [0, 1, 2, 3].map((k) => {
    const s = sheet(512, 512)
    const img = s.ctx.createImageData(512, 512)
    const r = rng(900 + k)
    for (let i = 0; i < 512 * 512; i++) {
      const v = 128 + (r() + r() + r() - 1.5) * 70
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    s.ctx.putImageData(img, 0, 0)
    return s.canvas
  })
}

/** El papel sobre la imagen (multiplicado): todo el corto está «pintado sobre papel». */
export function paperOver(ctx: Ctx, strength = 1): void {
  if (!PAPER) return
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = strength
  ctx.drawImage(PAPER, 0, 0)
  ctx.restore()
}

export interface FinishOptions {
  frame: number
  /** Altura de cada franja negra (0 = pantalla completa). */
  bars: number
  vignette?: number
  grain?: number
}

/** Viñeta, grano que cambia en cada fotograma y las franjas del formato panorámico. */
export function finish(ctx: Ctx, o: FinishOptions): void {
  const { frame, bars, vignette = 0.55, grain = 0.085 } = o
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, `rgba(8,6,10,${vignette})`)
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
  if (FILM_GRAIN.length) {
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = grain
    const g = FILM_GRAIN[frame % FILM_GRAIN.length]
    const ox = Math.floor(hash(frame, 11) * 512)
    const oy = Math.floor(hash(frame, 12) * 512)
    for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) ctx.drawImage(g, x, y)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (bars > 0.5) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, bars)
    ctx.fillRect(0, H - bars, W, bars)
  }
  ctx.restore()
}

/** Texto de rótulo (serif, espaciado), centrado en x. */
export function title(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, alpha = 1, spacing = 0, weight = 500, italic = false): void {
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px "New York", ui-serif, "Iowan Old Style", Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`
  ctx.fillStyle = color
  ctx.fillText(text, x + spacing / 2, y)
  ctx.restore()
}
