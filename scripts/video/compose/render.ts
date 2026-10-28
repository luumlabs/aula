// Dibuja un fotograma del montaje en un lienzo 2D, función pura del tiempo (determinista):
// papel del fondo (por tema o por claves de hora, en OKLab) con grano y viñeta suave · la ventana real de Aula (captura
// con alfa, vidrio tras la barra lateral, sombra sepia, marco mac/windows/linux) · cámara con deriva viva · cursor de
// macOS o cursor-sol con onda al pulsar · el sol de Aula como guía · titulares serif (*cursiva en ladrillo*) · sello de
// hora que rueda · transiciones (corte, fundido, subida, amanecer, iris).
import type { CameraKey, Clip, Focus, Montage, Notice, SunKey, TakeMeta, Title, WindowFrame } from '../montage/types.ts'
import { ICON, STROKES, doorPath, pathLength, type IconAssets } from './icon.ts'
import { clamp01, ease, lerp } from '../montage/ease.ts'

export const MAX_ZOOM = 2

/** Trazados SVG como Path2D, creados al usarlos (así el cálculo de planos se puede probar sin lienzo). */
const path2d = new Map<string, Path2D>()
function P(d: string): Path2D {
  let p = path2d.get(d)
  if (!p) path2d.set(d, (p = new Path2D(d)))
  return p
}

type Ctx2D = OffscreenCanvasRenderingContext2D
export type Theme = 'light' | 'dark'

export const PALETTE = {
  light: { stage: '#ebe5da', glass: '#e7e1d7', text: '#201e1a', text2: '#585550', surface: '#fffdf9', accent: '#b4502f', sun: '#e2a03e', sunGlow: '239,181,93', shadow: '70,46,24', border: 'rgba(32,30,26,0.14)', fill: 'rgba(32,30,26,0.06)' },
  dark: { stage: '#0e0c0a', glass: '#1c1a17', text: '#f0eae3', text2: '#b7afa5', surface: '#22201c', accent: '#ea9a6c', sun: '#f2c275', sunGlow: '242,194,117', shadow: '0,0,0', border: 'rgba(255,255,255,0.10)', fill: 'rgba(255,255,255,0.08)' }
} as const

export interface FrameSource {
  /** Imagen de la toma (ya decodificada al tamaño pedido o mayor). */
  image: ImageBitmap
  /** La app está en oscuro en este fotograma (medido en la propia captura): manda sobre el tema declarado de la toma,
   *  que puede cambiar dentro de la toma. */
  dark?: boolean
}

export interface ClipView {
  clip: Clip
  meta: TakeMeta
  theme: Theme
  /** Índice del fotograma de la toma. */
  frame: number
  /** Segundos desde el inicio del plano. */
  local: number
  zoom: number
  /** Esquina superior izquierda de la ventana en px del vídeo. */
  x: number
  y: number
  alpha: number
  /** Desplazamiento vertical extra (transición «rise»). */
  dy: number
  scale: number
  /** Máscara circular de la transición «iris» (px del vídeo). */
  iris?: { x: number; y: number; r: number }
  /** Máscara con la forma de la puerta del arco (transición «door»): centro de la puerta y escala (px por unidad del arte). */
  door?: { x: number; y: number; k: number }
  /** Transición «content»: cuánto se ve ya este contenido (0…1) dentro de la ventana del plano anterior. */
  content?: number
  /** Transición «theme»: cuánto ha llegado ya el papel del fondo al tema de este plano (0…1); va más lento que la ventana. */
  paper?: number
  /** Solo cuenta para el papel (el tema de su fotograma): no se dibuja. */
  ghost?: boolean
}

// ───────────── color ─────────────

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function fromOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return '#' + rgb.map((c) => Math.round(clamp01(toSrgb(c)) * 255).toString(16).padStart(2, '0')).join('')
}

function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex).map((v) => Math.round(v * 255))
  return `rgba(${r},${g},${b},${a})`
}

function mixOklab(a: string, b: string, t: number): string {
  const A = oklab(a)
  const B = oklab(b)
  return fromOklab([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)])
}

/** Colores de lo que va encima del papel (titulares, sello, marca), mezclados según lo oscuro que esté el papel: al pasar
 *  del día a la noche, el texto cambia de color con el fondo, sin saltos. Se fija en cada fotograma (drawFrame). */
type Pal = { [K in keyof (typeof PALETTE)['light']]: string }
let overlayPal: Pal | null = null
function overlay(theme: Theme): Pal {
  return overlayPal ?? PALETTE[theme]
}
function setOverlay(stage: string): void {
  const L = oklab(stage)[0]
  const d = clamp01((0.66 - L) / 0.3)
  const e = d * d * (3 - 2 * d)
  const a = PALETTE.light
  const b = PALETTE.dark
  overlayPal = { ...(e < 0.5 ? a : b), text: mixOklab(a.text, b.text, e), text2: mixOklab(a.text2, b.text2, e), accent: mixOklab(a.accent, b.accent, e), sun: mixOklab(a.sun, b.sun, e), surface: mixOklab(a.surface, b.surface, e) }
}

// ───────────── cámara y planos ─────────────

/** Margen de arriba de la ventana cuando hay banda de rótulos. */
const BAND_TOP_MARGIN = 40

/** Zoom de «ventana entera»: con banda de rótulos, la ventana cabe entre 40 px y la banda (con 20 px de aire). */
export function fitZoom(m: Montage, vw: number, vh: number): number {
  if (m.captionBand) return Math.min((m.size[0] * 0.84) / vw, (m.captionBand - 20 - BAND_TOP_MARGIN) / vh)
  return Math.min((m.size[0] * 0.84) / vw, (m.size[1] * 0.84) / vh)
}

/** Dónde cae, por defecto, el centro enfocado: el centro del cuadro o, con banda, el centro del hueco sobre ella. */
function defaultScreen(m: Montage): [number, number] {
  return m.captionBand ? [0.5, (BAND_TOP_MARGIN + m.captionBand - 20) / 2 / m.size[1]] : [0.5, 0.5]
}

function markCenter(meta: TakeMeta, name: string, frame: number): [number, number] | null {
  const r = meta.marks[name]?.[Math.min(frame, meta.frames - 1)]
  return r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null
}

/** Centro de una marca suavizado hacia atrás en el tiempo (media exponencial de `lag` s): la cámara sigue al elemento
 *  sin temblar con él. Determinista: solo depende de los fotogramas de la toma. */
function markCenterSmooth(meta: TakeMeta, name: string, frame: number, lag: number): [number, number] | null {
  const now = markCenter(meta, name, frame)
  if (!now || lag <= 0) return now
  const tau = lag * meta.fps
  let wx = 0
  let wy = 0
  let ws = 0
  for (let k = 0; k <= Math.ceil(tau * 4) && frame - k >= 0; k++) {
    const c = markCenter(meta, name, frame - k)
    if (!c) break
    const w = Math.exp(-k / tau)
    wx += c[0] * w
    wy += c[1] * w
    ws += w
  }
  return ws ? [wx / ws, wy / ws] : now
}

function resolveFocus(f: Focus | undefined, meta: TakeMeta, frame: number, lag = 0.2): [number, number] {
  const [vw, vh] = meta.viewport
  if (!f) return [vw / 2, vh / 2]
  if (typeof f === 'string') return markCenterSmooth(meta, f.slice(5), frame, lag) ?? [vw / 2, vh / 2]
  return f
}

/** Caja de una marca en pt (sin suavizar), para los cortes por coincidencia. */
function markRect(meta: TakeMeta, f: Focus | undefined, frame: number): [number, number, number, number] | null {
  if (typeof f !== 'string') return null
  return meta.marks[f.slice(5)]?.[Math.min(frame, meta.frames - 1)] ?? null
}

/** Cámara en un instante: zoom (px/pt), punto enfocado (pt) y dónde cae en el vídeo (fracción). */
export function cameraAt(m: Montage, keys: CameraKey[] | undefined, t: number, meta: TakeMeta, frame: number): { zoom: number; focus: [number, number]; screen: [number, number] } {
  const [vw, vh] = meta.viewport
  const fit = fitZoom(m, vw, vh)
  const z = (k: CameraKey) => Math.min(MAX_ZOOM, k.zoom === 'fit' ? fit : k.zoom)
  if (!keys?.length) return { zoom: fit, focus: [vw / 2, vh / 2], screen: defaultScreen(m) }
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  let i = sorted.findIndex((k) => k.t > t)
  if (i === -1) i = sorted.length
  const k1 = sorted[Math.min(i, sorted.length - 1)]
  const k0 = sorted[Math.max(0, i - 1)]
  const e = k0 === k1 ? 1 : ease(k1.ease ?? m.cameraEase ?? 'smooth', (t - k0.t) / (k1.t - k0.t))
  const f0 = resolveFocus(k0.focus, meta, frame, k0.lag)
  const f1 = resolveFocus(k1.focus, meta, frame, k1.lag)
  const s0 = k0.screen ?? defaultScreen(m)
  const s1 = k1.screen ?? defaultScreen(m)
  return {
    zoom: Math.exp(lerp(Math.log(z(k0)), Math.log(z(k1)), e)),
    focus: [lerp(f0[0], f1[0], e), lerp(f0[1], f1[1], e)],
    screen: [lerp(s0[0], s1[0], e), lerp(s0[1], s1[1], e)]
  }
}

/** Rectángulo del icono (lienzo de 1024 escalado a `size`) centrado en `at` (fracción del cuadro). */
function iconRect(m: Montage, size = 360, at: [number, number] = [0.5, 0.42]): { x: number; y: number; S: number; k: number; ox: number; oy: number } {
  const [W, H] = m.size
  const x = W * at[0] - size / 2
  const y = H * at[1] - size / 2
  const k = (size / ICON.canvas) * (ICON.boxSize / ICON.art)
  return { x, y, S: size, k, ox: x + (ICON.boxAt * size) / ICON.canvas, oy: y + (ICON.boxAt * size) / ICON.canvas }
}

/** De dónde se abre la puerta: la del icono del prólogo, o una pequeña en el centro. */
function doorOrigin(m: Montage): { x: number; y: number; k: number } {
  const midY = (ICON.door.top + ICON.door.bottom) / 2
  if (m.prologue) {
    const r = iconRect(m, m.prologue.size, m.prologue.at)
    return { x: r.ox + ICON.cx * r.k, y: r.oy + midY * r.k, k: r.k }
  }
  return { x: m.size[0] / 2, y: m.size[1] / 2, k: 0.2 }
}

const barSeconds = (m: Montage) => (m.music ? 240 / m.music.bpm : 2.4)

/** Planos visibles en el instante t, con su geometría y su transición. */
/** Un plano en el instante t, con su propia cámara (sin transición). */
function viewOf(m: Montage, takes: Record<string, TakeMeta>, clip: Clip, t: number): ClipView {
  const meta = takes[clip.take]
  if (!meta) throw new Error(`falta la toma ${clip.take}`)
  const local = t - clip.start
  const frame = Math.max(0, Math.min(meta.frames - 1, Math.round((local + (clip.from ?? 0)) * meta.fps)))
  const cam = clip.camera ? cameraAt(m, clip.camera, local, meta, frame) : cameraAt(m, m.camera, t, meta, frame)
  // deriva viva: el plano nunca está muerto del todo (acercamiento lentísimo alrededor del punto enfocado)
  const drift = clip.drift ?? m.drift ?? 0
  const zoom = Math.min(MAX_ZOOM, cam.zoom * (1 + (drift * local) / barSeconds(m)))
  const [W, H] = m.size
  const x = W * cam.screen[0] - cam.focus[0] * zoom
  let y = H * cam.screen[1] - cam.focus[1] * zoom
  // con banda de rótulos, la ventana nunca baja de ella: los rótulos van en el papel y no tapan nada de la app
  if (m.captionBand) y = Math.min(y, m.captionBand - 12 - meta.viewport[1] * zoom)
  return { clip, meta, theme: (m.takes[clip.take].theme ?? 'light') as Theme, frame, local, zoom, x, y, alpha: 1, dy: 0, scale: 1 }
}

/** El plano anterior en la línea de tiempo (el que «sale» cuando entra `clip`). */
function previousClip(m: Montage, clip: Clip): Clip | null {
  let prev: Clip | null = null
  for (const c of m.clips) if (c !== clip && c.start < clip.start && (!prev || c.start > prev.start)) prev = c
  return prev
}

/** Planos visibles en el instante t, con su geometría y su transición. */
/** «theme»: fotogramas que tarda la ventana en cambiar de tema si el plano no pone `enter.window`. */
export const THEME_WINDOW_FRAMES = 5

export function clipViews(m: Montage, takes: Record<string, TakeMeta>, t: number): ClipView[] {
  const out: ClipView[] = []
  const [W, H] = m.size
  const clips = [...m.clips].sort((a, b) => a.start - b.start)
  for (const clip of clips) {
    if (t < clip.start || t >= clip.start + clip.dur) continue
    const view = viewOf(m, takes, clip, t)
    const { meta, frame, local } = view
    const enter = clip.enter
    if (enter && enter.kind !== 'cut' && local < enter.dur) {
      const p = local / enter.dur
      const cam = ease(m.cameraEase ?? 'smooth', p)
      if (enter.kind === 'fade') view.alpha = ease('inOut', p)
      if (enter.kind === 'rise') {
        const e = ease('spring', p)
        view.alpha = ease('out', p * 1.6)
        view.dy = (1 - e) * 70
        view.scale = 0.97 + 0.03 * e
      }
      if (enter.kind === 'sunrise') view.alpha = p < 0.5 ? 0 : 1
      if (enter.kind === 'door') {
        const from = doorOrigin(m)
        const k1 = (Math.max(W, H) * 3.2) / ICON.door.w
        const e = ease('in', p)
        view.door = { x: lerp(from.x, W / 2, e), y: lerp(from.y, H / 2, e), k: Math.exp(lerp(Math.log(from.k), Math.log(k1), e)) }
      }
      if (enter.kind === 'iris') {
        const c = resolveFocus(enter.at, meta, frame)
        const cx = view.x + c[0] * view.zoom
        const cy = view.y + c[1] * view.zoom
        const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy))
        view.iris = { x: cx, y: cy, r: (far + 30) * ease('inOut', p) }
      }
      const prev = previousClip(m, clip)
      // «theme»: el papel del fondo (y los rótulos) cambia de tema en `dur` (2 pulsos), pero la VENTANA entera cambia en
      // `window` (por defecto 5 fotogramas) en el pulso fuerte: nunca dos contenidos a medio mezclar durante 2 pulsos
      if ((enter.kind === 'content' || enter.kind === 'theme') && prev) {
        // fundido del contenido dentro de una ventana quieta: la ventana arranca donde estaba la del plano anterior y,
        // si la cámara de este plano es otra, llega a ella con la curva única
        // si el plano anterior ya acabó, sigue debajo durante el fundido QUIETO en su último fotograma: así un fundido puede
        // tapar una transición de la app (se corta la toma en el clic y el plano siguiente arranca cuando la app ya cambió)
        const pv = viewOf(m, takes, prev, Math.min(t, prev.start + prev.dur - 1e-6))
        const shown = out.find((o) => o.clip === prev)
        if (!shown) out.push(pv)
        if (enter.kind === 'theme') {
          const win = Math.min(enter.dur, enter.window ?? THEME_WINDOW_FRAMES / m.fps)
          view.paper = ease('smooth', clamp01(p))
          // pasada la ventana, el plano anterior ya no se ve: queda solo para el papel y este plano es una ventana normal
          if (local < win) view.content = ease('smooth', clamp01(local / win))
          else (shown ?? pv).ghost = true
        } else view.content = ease('smooth', clamp01(p))
        view.zoom = Math.exp(lerp(Math.log(pv.zoom), Math.log(view.zoom), cam))
        view.x = lerp(pv.x, view.x, cam)
        view.y = lerp(pv.y, view.y, cam)
      }
      if (enter.kind === 'match' && prev) {
        // corte por coincidencia: el elemento de este plano arranca con la caja que tenía el del plano anterior en el corte
        const pv = viewOf(m, takes, prev, Math.min(clip.start, prev.start + prev.dur - 1e-6))
        const a = markRect(pv.meta, enter.from, pv.frame)
        const b = markRect(meta, enter.to, frame)
        if (a && b) {
          // misma escala que el elemento de antes, pero sin pasar de ×1,6 ni de ÷1,6 la de este plano: si los dos
          // elementos tienen tamaños muy distintos (un nombre en la barra lateral → el título), manda la posición
          const zoomM = Math.min(MAX_ZOOM, view.zoom * 1.6, Math.max(view.zoom / 1.6, (a[2] * pv.zoom) / b[2]))
          const sm: [number, number] = [pv.x + (a[0] + a[2] / 2) * pv.zoom, pv.y + (a[1] + a[3] / 2) * pv.zoom]
          const bc: [number, number] = [b[0] + b[2] / 2, b[1] + b[3] / 2]
          const so: [number, number] = [view.x + bc[0] * view.zoom, view.y + bc[1] * view.zoom]
          const zoom = Math.exp(lerp(Math.log(zoomM), Math.log(view.zoom), cam))
          const sx = lerp(sm[0], so[0], cam)
          const sy = lerp(sm[1], so[1], cam)
          view.zoom = zoom
          view.x = sx - bc[0] * zoom
          view.y = sy - bc[1] * zoom
        }
      }
    }
    out.push(view)
  }
  // el final parte de la ventana del último plano aunque ese plano ya haya acabado (su toma sigue o se queda quieta)
  if (!out.length && m.finale && t >= m.finale.start) {
    const before = clips.filter((c) => c.start <= t).pop()
    if (before) out.push(viewOf(m, takes, before, t))
  }
  // con «sunrise», el plano que sale se ve hasta la mitad de la transición
  const last = out[out.length - 1]
  if (last?.clip.enter?.kind === 'sunrise' && last.local < last.clip.enter.dur && last.local / last.clip.enter.dur >= 0.5) return [last]
  // con «match» y «cut», solo el plano que entra
  if (last && (last.clip.enter?.kind === 'match' || !last.clip.enter || last.clip.enter.kind === 'cut') && out.length > 1) return [last]
  return out
}

// ───────────── fondo ─────────────

/** Papel del fondo y tema de lo que va encima (titulares, sello) en el instante t. */
function stageAt(m: Montage, views: ClipView[], t: number): { stage: string; theme: Theme } {
  const keys = [...(m.paper ?? [])].sort((a, b) => a.t - b.t)
  if (keys.length) {
    let i = keys.findIndex((k) => k.t > t)
    if (i === -1) i = keys.length
    const k1 = keys[Math.min(i, keys.length - 1)]
    const k0 = keys[Math.max(0, i - 1)]
    const stage = k0 === k1 ? k0.color : mixOklab(k0.color, k1.color, ease('inOut', (t - k0.t) / (k1.t - k0.t)))
    return { stage, theme: oklab(stage)[0] < 0.5 ? 'dark' : 'light' }
  }
  let d = m.theme === 'dark' ? 1 : 0
  if (views.length) {
    d = views[0].theme === 'dark' ? 1 : 0
    for (const v of views.slice(1)) d = lerp(d, v.theme === 'dark' ? 1 : 0, v.iris ? clamp01(v.iris.r / 900) : (v.paper ?? v.content ?? v.alpha))
  }
  return { stage: mixOklab(PALETTE.light.stage, PALETTE.dark.stage, d), theme: d > 0.5 ? 'dark' : 'light' }
}

let grain: OffscreenCanvas | null = null
function grainTexture(): OffscreenCanvas {
  if (grain) return grain
  grain = new OffscreenCanvas(256, 256)
  const g = grain.getContext('2d')!
  const img = g.createImageData(256, 256)
  let a = 12345
  for (let i = 0; i < img.data.length; i += 4) {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0
    const v = (a >>> 24) & 0xff
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 14
  }
  g.putImageData(img, 0, 0)
  return grain
}

function drawStage(ctx: Ctx2D, m: Montage, stage: string, theme: Theme): void {
  const [W, H] = m.size
  ctx.save()
  ctx.fillStyle = stage
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = theme === 'dark' ? 'screen' : 'multiply'
  ctx.fillStyle = ctx.createPattern(grainTexture(), 'repeat')!
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  // luz cálida muy suave desde arriba a la izquierda (un único color que se desvanece)
  const pal = PALETTE[theme]
  const light = ctx.createRadialGradient(W * 0.18, -H * 0.1, 0, W * 0.18, -H * 0.1, W * 0.9)
  light.addColorStop(0, `rgba(${pal.sunGlow},${theme === 'dark' ? 0.08 : 0.2})`)
  light.addColorStop(1, `rgba(${pal.sunGlow},0)`)
  ctx.fillStyle = light
  ctx.fillRect(0, 0, W, H)
}

/** Viñeta del 4 % como mucho, del mismo tono (negro muy transparente hacia los bordes). */
function drawVignette(ctx: Ctx2D, m: Montage): void {
  const [W, H] = m.size
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, Math.hypot(W, H) / 2)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.04)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

// ───────────── ventana ─────────────

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Marco activo y el anterior (para el fundido de 6 fotogramas). */
function frameAt(m: Montage, t: number): { kind: WindowFrame; prev: WindowFrame; mix: number } {
  const keys = [...(m.frames ?? [])].sort((a, b) => a.t - b.t)
  let kind: WindowFrame = 'mac'
  let prev: WindowFrame = 'mac'
  let since = Infinity
  for (const k of keys)
    if (k.t <= t) {
      prev = kind
      kind = k.frame
      since = t - k.t
    }
  return { kind, prev, mix: clamp01(since / (6 / m.fps)) }
}

/** Altura (pt) de la barra que el marco añade encima de la captura (Windows 11: 32; cabecera de libadwaita: 46). */
const BAR_PT: Record<WindowFrame, number> = { mac: 0, windows: 32, linux: 46 }
/** Radio de las esquinas de cada sistema (pt). */
const RADIUS_PT: Record<WindowFrame, number> = { mac: 12, windows: 8, linux: 12 }

/** Recursos dibujados que no salen de la captura (el icono de la app). */
export type Assets = IconAssets

const BAR_COLOR = {
  windows: { light: '#f3f3f3', dark: '#202020' },
  linux: { light: '#ebebeb', dark: '#2e2e32' }
} as const

/** Barra y botones del marco. `y` es el borde superior de la captura; la barra va encima. */
function drawControls(ctx: Ctx2D, kind: WindowFrame, x: number, y: number, w: number, z: number, theme: Theme, alpha: number, assets?: Assets): void {
  if (alpha <= 0) return
  const pal = PALETTE[theme]
  const ink = theme === 'dark' ? '#ffffff' : '#1b1b1b'
  ctx.save()
  ctx.globalAlpha *= alpha
  if (kind === 'mac') {
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.beginPath()
      ctx.arc(x + (28 + 20 * i) * z, y + 28 * z, 6 * z, 0, Math.PI * 2)
      ctx.fillStyle = c
      ctx.fill()
      ctx.lineWidth = 0.5 * z
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'
      ctx.stroke()
    })
  } else if (kind === 'windows') {
    // Windows 11: barra de 32 pt con el icono y el nombre a la izquierda; — ☐ ✕ de 46 × 32 pt a la derecha (trazo fino)
    const h = BAR_PT.windows * z
    const by = y - h
    ctx.fillStyle = BAR_COLOR.windows[theme]
    ctx.fillRect(x, by, w, h)
    if (assets) ctx.drawImage(assets.icon, x + 10 * z, by + 8 * z, 16 * z, 16 * z)
    ctx.font = `400 ${12 * z}px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = ink
    ctx.textBaseline = 'middle'
    ctx.fillText('Aula', x + 34 * z, by + h / 2 + 0.5 * z)
    ctx.strokeStyle = ink
    ctx.lineWidth = Math.max(1, 1 * z)
    const cx = (i: number) => x + w - (46 * (3 - i) - 23) * z
    const cy = by + h / 2
    const g = 5 * z
    ctx.beginPath()
    ctx.moveTo(cx(0) - g, cy)
    ctx.lineTo(cx(0) + g, cy)
    ctx.stroke()
    roundRect(ctx, cx(1) - g, cy - g, 2 * g, 2 * g, 1.5 * z)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx(2) - g, cy - g)
    ctx.lineTo(cx(2) + g, cy + g)
    ctx.moveTo(cx(2) + g, cy - g)
    ctx.lineTo(cx(2) - g, cy + g)
    ctx.stroke()
  } else {
    // GNOME (libadwaita): cabecera de 46 pt, título centrado en negrita y el botón de cerrar redondo a la derecha
    const h = BAR_PT.linux * z
    const by = y - h
    ctx.fillStyle = BAR_COLOR.linux[theme]
    ctx.fillRect(x, by, w, h)
    ctx.font = `700 ${13 * z}px Cantarell, "Inter Variable", system-ui, sans-serif`
    ctx.fillStyle = theme === 'dark' ? '#ffffff' : '#2e3436'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Aula', x + w / 2, by + h / 2)
    const cx = x + w - 23 * z
    const cy = by + h / 2
    ctx.beginPath()
    ctx.arc(cx, cy, 12 * z, 0, Math.PI * 2)
    ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'
    ctx.fill()
    ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#2e3436'
    ctx.lineWidth = 1.4 * z
    ctx.lineCap = 'round'
    const g = 3.6 * z
    ctx.beginPath()
    ctx.moveTo(cx - g, cy - g)
    ctx.lineTo(cx + g, cy + g)
    ctx.moveTo(cx + g, cy - g)
    ctx.lineTo(cx - g, cy + g)
    ctx.stroke()
  }
  void pal
  ctx.restore()
}

/** Solo el contenido de un plano (vidrio de su tema y su captura) dentro de la ventana, con opacidad `alpha`: la ventana,
 *  su sombra y su marco son los del plano anterior y no se mueven. */
let contentLayer: OffscreenCanvas | null = null

function drawContent(ctx: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, alpha: number): void {
  if (alpha <= 0) return
  const [W, H] = m.size
  const [vw, vh] = v.meta.viewport
  const fr = frameAt(m, t)
  const r = RADIUS_PT[fr.kind] * v.zoom
  // el contenido nuevo se compone entero (vidrio + captura) en su capa y la capa funde de una vez: si vidrio y captura
  // fundieran cada uno por su lado, el vidrio se vería a través de la captura a medio fundido (un velo)
  if (!contentLayer || contentLayer.width !== W || contentLayer.height !== H) contentLayer = new OffscreenCanvas(W, H)
  const l = contentLayer.getContext('2d')!
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.clearRect(0, 0, W, H)
  l.save()
  roundRect(l, v.x, v.y, vw * v.zoom, vh * v.zoom, [fr.kind === 'mac' ? r : 0, fr.kind === 'mac' ? r : 0, r, r])
  l.clip()
  l.fillStyle = PALETTE[v.theme].glass
  l.fillRect(v.x, v.y, vw * v.zoom, vh * v.zoom)
  if (src) {
    l.imageSmoothingEnabled = true
    l.imageSmoothingQuality = 'high'
    l.drawImage(src.image, v.x, v.y, vw * v.zoom, vh * v.zoom)
  }
  l.restore()
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(contentLayer, 0, 0)
  ctx.restore()
  // los semáforos quedan encima (el contenido nuevo no los tapa)
  if (fr.kind === 'mac') drawControls(ctx, 'mac', v.x, v.y, vw * v.zoom, v.zoom, v.theme, 1)
}

/** La ventana: sombra, vidrio, la captura recortada con esquinas redondas, borde fino y el marco. */
function drawWindow(ctx: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets?: Assets): void {
  const [vw, vh] = v.meta.viewport
  const pal = PALETTE[v.theme]
  const fr = frameAt(m, t)
  const k = ease('inOut', fr.mix)
  const barPt = lerp(BAR_PT[fr.prev], BAR_PT[fr.kind], k)
  const radiusPt = lerp(RADIUS_PT[fr.prev], RADIUS_PT[fr.kind], k)
  ctx.save()
  ctx.globalAlpha = v.alpha
  const cx = v.x + (vw * v.zoom) / 2
  const cy = v.y + (vh * v.zoom) / 2
  ctx.translate(cx, cy + v.dy)
  ctx.scale(v.scale, v.scale)
  ctx.translate(-cx, -cy)
  const z = v.zoom
  const w = vw * z
  const h = vh * z
  const bar = barPt * z
  const r = radiusPt * z
  const top = v.y - bar
  // sombra de cada sistema: macOS amplia y cálida; Windows 11 más difusa y centrada; GNOME corta
  const shadow = fr.kind === 'windows' ? { blur: 60, y: 18, a: 0.26 } : fr.kind === 'linux' ? { blur: 40, y: 14, a: 0.24 } : { blur: 80, y: 30, a: 0.22 }
  ctx.save()
  ctx.shadowColor = `rgba(${pal.shadow},${v.theme === 'dark' ? 0.5 : shadow.a})`
  ctx.shadowBlur = shadow.blur * z
  ctx.shadowOffsetY = shadow.y * z
  roundRect(ctx, v.x, top, w, h + bar, r)
  ctx.fillStyle = pal.glass
  ctx.fill()
  ctx.shadowColor = `rgba(${pal.shadow},${v.theme === 'dark' ? 0.45 : 0.14})`
  ctx.shadowBlur = 4 * z
  ctx.shadowOffsetY = 1.5 * z
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, v.x, top, w, h + bar, r)
  ctx.clip()
  ctx.fillStyle = pal.glass
  ctx.fillRect(v.x, top, w, h + bar)
  if (src) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src.image, v.x, v.y, w, h)
  }
  if (fr.prev !== fr.kind) drawControls(ctx, fr.prev, v.x, v.y, w, z, v.theme, 1 - k, assets)
  drawControls(ctx, fr.kind, v.x, v.y, w, z, v.theme, fr.prev !== fr.kind ? k : 1, assets)
  if (bar > 0.5) {
    ctx.fillStyle = pal.border
    ctx.fillRect(v.x, v.y - Math.max(1, 0.5 * z), w, Math.max(1, 0.5 * z))
  }
  ctx.restore()
  roundRect(ctx, v.x + 0.25, top + 0.25, w - 0.5, h + bar - 0.5, r)
  ctx.lineWidth = Math.max(1, 0.5 * z)
  ctx.strokeStyle = fr.kind === 'windows' ? (v.theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.14)') : pal.border
  ctx.stroke()
  ctx.restore()
}

// ───────────── cursor ─────────────

const ARROW = 'M0 0 L0 16.2 L3.9 12.6 L6.4 18.4 L9.1 17.3 L6.6 11.5 L11.9 11.5 Z'

function cursorPoint(v: ClipView, frame: number): [number, number] | null {
  const c = v.meta.cursor[frame]
  return c ? [v.x + c[0] * v.zoom, v.y + c[1] * v.zoom + v.dy] : null
}

/** Cursor en la posición registrada, con onda de color ladrillo al pulsar. `sun`: el cursor-sol de Aula. */
function drawCursor(ctx: Ctx2D, m: Montage, v: ClipView): void {
  const c = v.meta.cursor[v.frame]
  const p = cursorPoint(v, v.frame)
  if (!c || !p) return
  const [x, y] = p
  const pal = PALETTE[v.theme]
  const sun = m.cursor === 'sun'
  // tamaño en pantalla: el cursor-sol no crece con el zoom (1:1, y 0,8 en los primeros planos)
  const unit = sun ? (v.zoom > 1.4 ? 0.8 : 1) : v.zoom
  let pressAt = -1
  for (let f = v.frame; f >= Math.max(0, v.frame - 40); f--) {
    const q = v.meta.cursor[f]
    if (q && q[2] && !(v.meta.cursor[f - 1]?.[2] ?? 0)) {
      pressAt = f
      break
    }
  }
  ctx.save()
  ctx.globalAlpha = v.alpha
  if (pressAt >= 0) {
    const k = (v.frame - pressAt) / v.meta.fps / 0.45
    if (k < 1) {
      ctx.beginPath()
      ctx.arc(x, y, (6 + 20 * ease('out', k)) * unit, 0, Math.PI * 2)
      ctx.strokeStyle = pal.accent
      ctx.globalAlpha = v.alpha * 0.55 * (1 - k)
      ctx.lineWidth = 2.2 * unit
      ctx.stroke()
      ctx.globalAlpha = v.alpha
    }
  }
  const pressed = c[2] === 1
  if (sun) {
    // estela de 3 px solo en movimientos rápidos (> 600 px/s)
    const prev = cursorPoint(v, Math.max(0, v.frame - 1))
    if (prev) {
      const speed = Math.hypot(x - prev[0], y - prev[1]) * v.meta.fps
      if (speed > 600) {
        const tail = cursorPoint(v, Math.max(0, v.frame - 4)) ?? prev
        const g = ctx.createLinearGradient(tail[0], tail[1], x, y)
        g.addColorStop(0, `rgba(${pal.sunGlow},0)`)
        g.addColorStop(1, `rgba(${pal.sunGlow},${clamp01((speed - 600) / 600) * 0.8})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tail[0], tail[1])
        ctx.lineTo(x, y)
        ctx.stroke()
      }
    }
    drawSun(ctx, x, y, 7 * unit * (pressed ? 0.85 : 1), v.theme, v.alpha, false, 4)
    ctx.restore()
    return
  }
  const s = unit * (pressed ? 0.92 : 1)
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * s
  ctx.shadowOffsetY = 1 * s
  ctx.fillStyle = '#111'
  ctx.fill(P(ARROW))
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 1.3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#fff'
  ctx.stroke(P(ARROW))
  ctx.restore()
}

// ───────────── el sol ─────────────

/** El sol de Aula: disco cálido con su halo, siempre de un solo color. `halo`: solo la luz. */
export function drawSun(ctx: Ctx2D, x: number, y: number, r: number, theme: Theme, alpha = 1, halo = false, spread = 7): void {
  if (r <= 0.2 || alpha <= 0) return
  const pal = PALETTE[theme]
  ctx.save()
  ctx.globalAlpha = alpha
  if (halo) {
    ctx.globalCompositeOperation = theme === 'dark' ? 'screen' : 'multiply'
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 9)
    g.addColorStop(0, `rgba(${pal.sunGlow},0.55)`)
    g.addColorStop(0.45, `rgba(${pal.sunGlow},0.18)`)
    g.addColorStop(1, `rgba(${pal.sunGlow},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - r * 9, y - r * 9, r * 18, r * 18)
    ctx.restore()
    return
  }
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * spread)
  glow.addColorStop(0, `rgba(${pal.sunGlow},0.42)`)
  glow.addColorStop(0.35, `rgba(${pal.sunGlow},0.14)`)
  glow.addColorStop(1, `rgba(${pal.sunGlow},0)`)
  ctx.fillStyle = glow
  ctx.fillRect(x - r * spread, y - r * spread, r * spread * 2, r * spread * 2)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = pal.sun
  ctx.fill()
  ctx.restore()
}

function sunAt(m: Montage, views: ClipView[], t: number): { x: number; y: number; r: number; halo: boolean } | null {
  const keys = [...(m.sun ?? [])].sort((a, b) => a.t - b.t)
  if (!keys.length) return null
  const pos = (k: SunKey): [number, number] => {
    if (Array.isArray(k.at)) return k.at
    const v = views[views.length - 1]
    const c = v ? markCenter(v.meta, k.at.slice(5), v.frame) : null
    return v && c ? [v.x + c[0] * v.zoom, v.y + c[1] * v.zoom] : [m.size[0] / 2, m.size[1] / 2]
  }
  let i = keys.findIndex((k) => k.t > t)
  if (i === -1) i = keys.length
  const k1 = keys[Math.min(i, keys.length - 1)]
  const k0 = keys[Math.max(0, i - 1)]
  const e = k0 === k1 ? 1 : ease(k1.ease, (t - k0.t) / (k1.t - k0.t))
  const p0 = pos(k0)
  const p1 = pos(k1)
  return { x: lerp(p0[0], p1[0], e), y: lerp(p0[1], p1[1], e), r: lerp(k0.r, k1.r, e), halo: (e < 0.5 ? k0 : k1).style === 'halo' }
}

/** La marca de Aula (el arco y el sol que sale por la puerta), con la geometría exacta de AulaMark.tsx. */
const ARCH = 'M5 20.5V10.5a7 7 0 0 1 14 0v10'
const DOOR = 'M8.4 20.5V12.8a3.6 3.6 0 0 1 7.2 0v7.7z'
const HALF_SUN = 'M8.4 20.5a3.6 3.6 0 0 1 7.2 0z'
export function drawMark(ctx: Ctx2D, x: number, y: number, size: number, theme: Theme, rise: number, alpha: number): void {
  const pal = overlay(theme)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(size / 24, size / 24)
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = pal.text
  ctx.stroke(P(ARCH))
  ctx.clip(P(DOOR))
  ctx.translate(0, (1 - rise) * 4)
  ctx.fillStyle = pal.sun
  ctx.fill(P(HALF_SUN))
  ctx.restore()
}

// ───────────── titulares ─────────────

const SERIF = 'ui-serif, "New York", "Newsreader Variable", Georgia, serif'
const SANS = 'system-ui, -apple-system, "Inter Variable", sans-serif'

interface Word {
  text: string
  italic: boolean
}

/** «Study *anything*.» → palabras con su estilo (las de entre asteriscos, en cursiva y ladrillo). */
function words(text: string): Word[] {
  let italic = false
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      let w = raw
      const opens = w.startsWith('*')
      if (opens) w = w.slice(1)
      const closes = /\*[.,;:!?»”]*$/.test(w)
      if (closes) w = w.replace(/\*([.,;:!?»”]*)$/, '$1')
      const word = { text: w, italic: italic || opens }
      if (opens) italic = true
      if (closes) italic = false
      return word
    })
}

interface Typeset {
  lines: Word[][]
  size: number
  weight: number
  family: string
}

const font = (t: Typeset, w: Word) => `${w.italic ? 'italic ' : ''}${t.weight} ${t.size}px ${t.family}`

function measure(ctx: Ctx2D, t: Typeset, line: Word[]): number[] {
  return line.map((w, i) => {
    ctx.font = font(t, w)
    return ctx.measureText(w.text + (i < line.length - 1 ? ' ' : '')).width
  })
}

function typeset(ctx: Ctx2D, text: string, size: number, weight: number, family: string, maxWidth: number): Typeset {
  const t: Typeset = { lines: [[]], size, weight, family }
  for (const w of words(text)) {
    const line = t.lines[t.lines.length - 1]
    const width = measure(ctx, t, [...line, w]).reduce((a, b) => a + b, 0)
    if (line.length && width > maxWidth) t.lines.push([w])
    else line.push(w)
  }
  return t
}

function widthOf(ctx: Ctx2D, t: Typeset): number {
  return Math.max(...t.lines.map((l) => measure(ctx, t, l).reduce((a, b) => a + b, 0)))
}

/** Texto que entra palabra a palabra (40 ms de escalonado, sube 10 px, `out` 0,35 s) y se va con un fundido. */
function drawTypeset(ctx: Ctx2D, t: Typeset, x: number, y: number, lineHeight: number, align: 'center' | 'left', local: number, fade: number, color: string, accent: string, startIndex = 0): number {
  let index = startIndex
  t.lines.forEach((line, li) => {
    const widths = measure(ctx, t, line)
    const full = widths.reduce((a, b) => a + b, 0)
    let cx = align === 'center' ? x - full / 2 : x
    line.forEach((w, wi) => {
      const p = ease('out', clamp01((local - index * 0.04) / 0.35))
      if (p > 0) {
        ctx.save()
        ctx.globalAlpha = p * fade
        ctx.font = font(t, w)
        ctx.fillStyle = w.italic ? accent : color
        ctx.fillText(w.text, cx, y + li * lineHeight + (1 - p) * 10)
        ctx.restore()
      }
      cx += widths[wi]
      index++
    })
  })
  return index
}

export function drawTitle(ctx: Ctx2D, m: Montage, title: Title, t: number, theme: Theme, stage: string): void {
  if (t < title.start || t >= title.start + title.dur) return
  const pal = overlay(theme)
  const [W, H] = m.size
  const opening = title.start <= 0 || title.instant
  const closing = title.start + title.dur >= m.duration - 1e-6
  const calm = (title.gesture ?? 'calm') === 'calm'
  // «calm»: entra y sale con el mismo gesto (350 ms, fundido y 8 px hacia arriba); «words»: palabra a palabra
  const aIn = opening ? 1 : ease('out', clamp01((t - title.start) / 0.35))
  const aOut = closing ? 1 : 1 - ease('in', clamp01((t - (title.start + title.dur - 0.35)) / 0.35))
  const local = calm ? 99 : (title.instant ? 10 : 0) + t - title.start
  const fade = calm ? aIn * aOut : closing ? 1 : clamp01((title.start + title.dur - t) / 0.25)
  ctx.save()
  if (calm) ctx.translate(0, (1 - aIn) * 8 - (1 - aOut) * 8)
  ctx.textBaseline = 'alphabetic'
  if (title.style === 'hero') {
    // velo de papel sobre la ventana para que el titular respire
    ctx.globalAlpha = 0.9 * (calm ? fade : Math.min(opening ? 1 : clamp01(local / 0.35), fade))
    ctx.fillStyle = stage
    ctx.fillRect(-10, -10, W + 20, H + 20)
    ctx.globalAlpha = 1
    const [ax, ay] = title.at ?? [0.5, 0.53]
    drawMark(ctx, W * ax, H * (ay - 0.23), 132, theme, calm ? aIn : ease('out', clamp01(local / 1.1)), calm ? fade : Math.min(clamp01(local / 0.4), fade))
    const main = typeset(ctx, title.text, 96, 500, SERIF, W * 0.72)
    drawTypeset(ctx, main, W * ax, H * ay, 106, 'center', local - 0.25, fade, pal.text, pal.accent)
    if (title.sub) drawTypeset(ctx, typeset(ctx, title.sub, 32, 400, SANS, W * 0.6), W * ax, H * ay + main.lines.length * 106 - 22, 44, 'center', local - 0.6, fade, pal.text2, pal.accent)
  } else if (title.style === 'side') {
    const [ax, ay] = title.at ?? [0.065, 0.5]
    const main = typeset(ctx, title.text, 54, 500, SERIF, W * 0.3)
    const lh = 54 * 1.1
    const y0 = H * ay - ((main.lines.length - 1) * lh) / 2 + (title.sub ? -16 : 0)
    const n = drawTypeset(ctx, main, W * ax, y0, lh, 'left', local, fade, pal.text, pal.accent)
    if (title.sub) drawTypeset(ctx, typeset(ctx, title.sub, 22, 400, SANS, W * 0.28), W * ax, y0 + main.lines.length * lh - 8, 30, 'left', local, fade, pal.text2, pal.accent, n)
  } else {
    // pie: píldora de papel al 92 %, radio 16, sombra e1 (sin desenfoque de fondo)
    const [ax, ay] = title.at ?? (m.captionBand ? [0.5, (m.captionBand + H) / 2 / H] : [0.5, 0.86])
    const main = typeset(ctx, title.text, 44, 500, SERIF, W * 0.7)
    const sub = title.sub ? typeset(ctx, title.sub, 20, 400, SANS, W * 0.6) : null
    const lh = 44 * 1.1
    const bw = Math.max(widthOf(ctx, main), sub ? widthOf(ctx, sub) : 0) + 64
    const bh = main.lines.length * lh + (sub ? sub.lines.length * 28 + 6 : 0) + 36
    const e = calm ? 1 : ease('out', clamp01(local / 0.35))
    const bx = W * ax - bw / 2
    const by = H * ay - bh / 2 + (1 - e) * 10
    ctx.save()
    ctx.globalAlpha = e * fade
    ctx.shadowColor = `rgba(${pal.shadow},0.10)`
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 2
    roundRect(ctx, bx, by, bw, bh, 16)
    ctx.fillStyle = withAlpha(pal.surface, 0.92)
    ctx.fill()
    ctx.restore()
    const n = drawTypeset(ctx, main, W * ax, by + 18 + 44 * 0.82, lh, 'center', local, fade, pal.text, pal.accent)
    if (sub) drawTypeset(ctx, sub, W * ax, by + 18 + main.lines.length * lh + 22, 28, 'center', local, fade, pal.text2, pal.accent, n)
  }
  ctx.restore()
}

// ───────────── sello de hora ─────────────

function drawStamp(ctx: Ctx2D, m: Montage, t: number, theme: Theme): void {
  const keys = [...(m.stamps ?? [])].sort((a, b) => a.t - b.t)
  let cur = -1
  for (let i = 0; i < keys.length; i++) if (keys[i].t <= t) cur = i
  if (cur < 0) return
  const now = keys[cur].text.toUpperCase()
  const before = cur > 0 ? keys[cur - 1].text.toUpperCase() : ''
  const since = t - keys[cur].t
  const pal = overlay(theme)
  const size = 20
  ctx.save()
  ctx.font = `600 ${size}px ${SANS}`
  ctx.letterSpacing = '0.08em'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = pal.text2
  const x0 = 40
  const y0 = 40 + size
  ctx.globalAlpha = cur === 0 ? clamp01(since / 0.4) : 1
  // cada carácter que cambia rueda: el viejo sube y se va, el nuevo llega desde abajo (escalonados)
  let x = x0
  const n = Math.max(now.length, before.length)
  for (let i = 0; i < n; i++) {
    const a = before[i] ?? ''
    const b = now[i] ?? ''
    const p = cur === 0 || a === b ? 1 : ease('out', clamp01((since - i * 0.02) / 0.35))
    ctx.save()
    ctx.beginPath()
    ctx.rect(x - 2, y0 - size - 4, size, size + 10)
    ctx.clip()
    if (p < 1 && a) {
      ctx.globalAlpha *= 1 - p
      ctx.fillText(a, x, y0 - p * size)
      ctx.globalAlpha = cur === 0 ? clamp01(since / 0.4) : 1
    }
    if (b) {
      ctx.globalAlpha *= p
      ctx.fillText(b, x, y0 + (1 - p) * size)
    }
    ctx.restore()
    x += ctx.measureText(b || a).width
  }
  ctx.restore()
}

// ───────────── final: la ventana se vuelve el icono y su sol sale ─────────────

const ICON_DOOR = doorPath()

/** Progreso del final en t (0…1) o null si aún no empezó. */
function finaleProgress(m: Montage, t: number): number | null {
  const f = m.finale
  if (!f || t < f.start) return null
  return clamp01((t - f.start) / f.dur)
}

let sunLayer: OffscreenCanvas | null = null

/** El sol pintado del icono (lienzo de 1024 en (x, y, S)), `rise` 0…1: baja (1 − rise) de su sitio y solo se ve por
 *  encima del pincelazo del horizonte. */
function drawSunSprite(ctx: Ctx2D, assets: Assets, x: number, y: number, S: number, rise: number): void {
  if (rise <= 0) return
  const sun = assets.sun
  const { width: w, height: h } = sun.image
  if (!sunLayer || sunLayer.width !== w || sunLayer.height !== h) sunLayer = new OffscreenCanvas(w, h)
  const l = sunLayer.getContext('2d')!
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.globalCompositeOperation = 'source-over'
  l.clearRect(0, 0, w, h)
  l.drawImage(sun.image, 0, (1 - rise) * (sun.r + 6))
  l.globalCompositeOperation = 'destination-in'
  l.drawImage(sun.mask, 0, 0)
  const s = S / ICON.canvas
  ctx.drawImage(sunLayer, x + sun.x * s, y + sun.y * s, w * s, h * s)
}

let inkLayer: OffscreenCanvas | null = null
const strokePts = { arch: STROKES.arch.pts(), horizon: STROKES.horizon.pts() }
const strokeLen = { arch: pathLength(strokePts.arch), horizon: pathLength(strokePts.horizon) }

/** La tinta del icono (arco y horizonte) descubierta a lo largo de sus trazos, como un pincel que avanza: `arch` y
 *  `horizon` (0…1) son cuánto de cada trazo está ya pintado. (x, y, s): la caja del arte (824) en px del vídeo. */
function drawInk(ctx: Ctx2D, assets: Assets, x: number, y: number, s: number, arch: number, horizon: number, alpha = 1): void {
  if ((arch <= 0 && horizon <= 0) || alpha <= 0 || s < 2) return
  const n = Math.ceil(s) + 2
  if (!inkLayer || inkLayer.width < n || inkLayer.height < n) inkLayer = new OffscreenCanvas(Math.max(n, inkLayer?.width ?? 0), Math.max(n, inkLayer?.height ?? 0))
  const l = inkLayer.getContext('2d')!
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.globalCompositeOperation = 'source-over'
  l.clearRect(0, 0, n, n)
  const k = s / ICON.art
  // la máscara: el trazo hasta donde ha llegado el pincel, con la punta redonda y el borde blando
  l.save()
  l.filter = `blur(${(5 * k).toFixed(2)}px)`
  l.scale(k, k)
  l.lineCap = 'round'
  l.lineJoin = 'round'
  l.strokeStyle = '#000'
  for (const key of ['arch', 'horizon'] as const) {
    const p = key === 'arch' ? arch : horizon
    if (p <= 0) continue
    const pts = strokePts[key]
    l.lineWidth = STROKES[key].w
    l.setLineDash(p >= 1 ? [] : [strokeLen[key] * p, strokeLen[key] * 3])
    l.beginPath()
    l.moveTo(pts[0][0], pts[0][1])
    for (const q of pts.slice(1)) l.lineTo(q[0], q[1])
    l.stroke()
  }
  l.restore()
  l.globalCompositeOperation = 'source-in'
  l.drawImage(assets.ink, ICON.boxAt, ICON.boxAt, ICON.boxSize, ICON.boxSize, 0, 0, s, s)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.drawImage(inkLayer, 0, 0, n, n, x, y, n, n)
  ctx.restore()
}

/** El icono en el rectángulo cuadrado (x, y, S): sin sol, el sol pintado subiendo por detrás del horizonte y, al final,
 *  el icono real exacto. */
function drawIcon(ctx: Ctx2D, assets: Assets, x: number, y: number, S: number, rise: number, alpha: number, theme: Theme): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(assets.iconNoSun, x, y, S, S)
  drawSunSprite(ctx, assets, x, y, S, rise)
  // al final, el icono real exacto
  if (rise > 0.96) {
    ctx.globalAlpha = alpha * clamp01((rise - 0.96) / 0.04)
    ctx.drawImage(assets.icon, x, y, S, S)
  }
  ctx.restore()
  void theme
}

/** Tramos (fracción del gesto) del final: el contenido se apaga, el arco se pinta a pincel encima mientras tanto, luego
 *  el horizonte, y el icono real (con su canto) funde al final. */
export const FINALE_STEPS = { content: [0.25, 0.8], arch: [0.45, 0.8], horizon: [0.78, 0.9], icon: [0.88, 1] } as const
const span = (q: number, [a, b]: readonly [number, number]) => ease('inOut', clamp01((q - a) / (b - a)))

/** El final: la ventana del último plano se encoge y se redondea hasta la losa del icono; luego sale el sol. */
function drawFinale(ctx: Ctx2D, m: Montage, t: number, v: ClipView | undefined, src: FrameSource | null, assets: Assets, theme: Theme, stage: string): void {
  const f = m.finale!
  const p = finaleProgress(m, t)!
  const [W, H] = m.size
  const S = f.size ?? 360
  const [ax, ay] = f.at ?? [0.5, 0.42]
  const ix = W * ax - S / 2
  const iy = H * ay - S / 2
  // la losa del icono dentro de su lienzo
  const slab = { x: ix + (ICON.boxAt * S) / ICON.canvas, y: iy + (ICON.boxAt * S) / ICON.canvas, s: (ICON.boxSize * S) / ICON.canvas }
  const slabR = (ICON.radius / ICON.art) * slab.s
  // la reducción ventana → losa dura `morph` s (por defecto el 55 % del final) con la curva única: un solo gesto continuo
  const q = clamp01((t - f.start) / Math.max(0.05, f.morph ?? f.dur * 0.55))
  const morph = ease(m.cameraEase ?? 'smooth', q)
  const [r0, r1] = f.rise ?? [f.start + f.dur * 0.55, f.start + f.dur * 0.95]
  const rise = ease('out', clamp01((t - r0) / Math.max(0.01, r1 - r0)))
  const pal = overlay(theme)
  if (v && morph < 1) {
    const [vw, vh] = v.meta.viewport
    const x = lerp(v.x, slab.x, morph)
    const y = lerp(v.y, slab.y, morph)
    const w = lerp(vw * v.zoom, slab.s, morph)
    const h = lerp(vh * v.zoom, slab.s, morph)
    const r = lerp(12 * v.zoom, slabR, morph)
    ctx.save()
    ctx.shadowColor = `rgba(${pal.shadow},${theme === 'dark' ? 0.5 : 0.24})`
    ctx.shadowBlur = lerp(80 * v.zoom, 40, morph)
    ctx.shadowOffsetY = lerp(30 * v.zoom, 16, morph)
    roundRect(ctx, x, y, w, h, r)
    ctx.fillStyle = assets.slab
    ctx.fill()
    ctx.restore()
    ctx.save()
    roundRect(ctx, x, y, w, h, r)
    ctx.clip()
    ctx.fillStyle = assets.slab
    ctx.fillRect(x, y, w, h)
    // la captura se queda centrada (como «cubrir») y se apaga mientras el papel de la losa del icono toma su sitio
    const content = 1 - span(q, FINALE_STEPS.content)
    if (src && content > 0) {
      // la ventana tal cual (su vidrio y su captura) se apaga de una vez sobre la losa: sin el vidrio debajo, la barra
      // lateral (translúcida) dejaría ver la losa desde el primer fotograma
      const scale = Math.max(w / vw, h / vh)
      ctx.globalAlpha = content
      ctx.fillStyle = PALETTE[v.theme].glass
      ctx.fillRect(x, y, w, h)
      ctx.drawImage(src.image, x + w / 2 - (vw * scale) / 2, y + h / 2 - (vh * scale) / 2, vw * scale, vh * scale)
    }
    ctx.restore()
    // mientras se apaga, el arco se pinta a pincel encima (y luego el horizonte), ya del tamaño del icono y centrado en
    // la ventana que se encoge hacia él
    const side = slab.s
    drawInk(ctx, assets, x + w / 2 - side / 2, y + h / 2 - side / 2, side, span(q, FINALE_STEPS.arch), span(q, FINALE_STEPS.horizon))
  }
  // el icono real (su canto y su sol) funde cuando la tinta ya está entera
  const iconIn = v ? span(q, FINALE_STEPS.icon) : 1
  if (iconIn > 0) {
    ctx.save()
    if (iconIn >= 1) {
      ctx.shadowColor = `rgba(${pal.shadow},${theme === 'dark' ? 0.5 : 0.24})`
      ctx.shadowBlur = 40
      ctx.shadowOffsetY = 16
    }
    drawIcon(ctx, assets, ix, iy, S, rise, iconIn, theme)
    ctx.restore()
  }
  // el sol (el cursor-sol o el que se diga) vuela hasta la puerta y se mete en ella antes de salir
  if (f.sunFrom && t < r0 + 0.2) {
    const c = f.sunFrom === 'cursor' ? (v ? cursorPoint(v, v.frame) : null) : f.sunFrom
    if (c) {
      const tx = slab.x + (ICON.cx / ICON.art) * slab.s
      const ty = slab.y + (ICON.door.bottom / ICON.art) * slab.s
      const q = ease('inOut', clamp01((t - f.start) / Math.max(0.01, r0 - f.start)))
      const arc = Math.sin(Math.PI * q) * 80
      drawSun(ctx, lerp(c[0], tx, q), lerp(c[1], ty, q) - arc, lerp(9, 5, q), theme, 1 - clamp01((t - r0) / 0.2), false, 5)
    }
  }
  // el sol del icono también ilumina el papel de alrededor
  const shine = rise
  if (shine > 0) drawSun(ctx, W * ax, slab.y + slab.s * (ICON.sun.y / ICON.art), 26, theme, shine * 0.35, true)
  if (f.title) {
    const local = t - Math.max(r1 - 0.2, f.start + f.dur * 0.72)
    if (local > 0) {
      const main = typeset(ctx, f.title, 88, 500, SERIF, W * 0.6)
      const n = drawTypeset(ctx, main, W * ax, iy + S + 96, 96, 'center', local, 1, pal.text, pal.accent)
      if (f.sub) drawTypeset(ctx, typeset(ctx, f.sub, 30, 400, SANS, W * 0.6), W * ax, iy + S + 96 + main.lines.length * 96 - 30, 40, 'center', local - 0.2, 1, pal.text2, pal.accent, n)
    }
  }
  void stage
}

/** Prólogo: el icono por capas sobre el papel; la losa entra y el sol sale por la puerta en su ventana de tiempo. */
function drawPrologue(ctx: Ctx2D, m: Montage, t: number, assets: Assets, theme: Theme): void {
  const pr = m.prologue
  if (!pr || t < pr.start || t >= pr.end) return
  // si un plano ya está naciendo del icono (enter «icon» o prologue.morph), la losa es la suya
  if (m.clips.some((c) => c.enter?.kind === 'icon' && t >= c.start && t < c.start + c.enter.dur)) return
  if (prologueMorph(m, t)) return
  // crece un poco (de `grow` a 1) mientras sale el sol
  const g = lerp(pr.grow ?? 1, 1, ease(m.cameraEase ?? 'smooth', clamp01((t - pr.start) / Math.max(0.01, pr.rise[1] - pr.start))))
  const r = iconRect(m, (pr.size ?? 360) * g, pr.at)
  // por defecto, el icono ya está en el primer fotograma (nada de papel vacío)
  const fadeIn = pr.fadeIn ? clamp01((t - pr.start) / pr.fadeIn) : 1
  const rise = ease('out', clamp01((t - pr.rise[0]) / Math.max(0.01, pr.rise[1] - pr.rise[0])))
  const pal = overlay(theme)
  ctx.save()
  ctx.shadowColor = `rgba(${pal.shadow},${theme === 'dark' ? 0.5 : 0.24})`
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  // entra subiendo un poco, como las tarjetas de Aula
  drawIcon(ctx, assets, r.x, r.y + (1 - ease('out', fadeIn)) * 24, r.S, rise, ease('out', fadeIn), theme)
  ctx.restore()
  if (rise > 0) drawSun(ctx, r.ox + ICON.cx * r.k, r.oy + ICON.door.bottom * r.k * 0.98, 26, theme, rise * 0.35, true)
  if (pr.title) {
    const local = t - (pr.titleAt ?? pr.rise[1])
    if (local > 0) {
      const main = typeset(ctx, pr.title, 88, 500, SERIF, m.size[0] * 0.6)
      const n = drawTypeset(ctx, main, r.x + r.S / 2, r.y + r.S + 96, 96, 'center', local, 1, pal.text, pal.accent)
      if (pr.sub) drawTypeset(ctx, typeset(ctx, pr.sub, 30, 400, SANS, m.size[0] * 0.6), r.x + r.S / 2, r.y + r.S + 96 + main.lines.length * 96 - 30, 40, 'center', local - 0.2, 1, pal.text2, pal.accent, n)
    }
  }
}

/** Si el prólogo está en su tramo de transformación (prologue.morph), cuánto lleva y cuánto dura. */
function prologueMorph(m: Montage, t: number): { local: number; dur: number } | null {
  const pr = m.prologue
  if (!pr?.morph || t < pr.end - pr.morph || t >= pr.end) return null
  return { local: t - (pr.end - pr.morph), dur: pr.morph }
}

/** prologue.morph: tramo del gesto (fracción 0…1) en que la ventana de la app funde sobre la losa. */
/** Tramos (fracción del gesto) del prólogo, el final al revés: el canto del icono se va, la app entra mientras el sol se
 *  apaga, y la tinta se despinta encima (primero el horizonte, luego el arco, desde su cola seca hasta donde se posó). */
export const PROLOGUE_STEPS = { edge: [0, 0.15], sun: [0.25, 0.5], app: [0.3, 0.8], horizon: [0.35, 0.55], arch: [0.45, 0.85] } as const

/** Principio (el mismo gesto que el final, al revés): la losa del icono del prólogo crece y se convierte en la ventana
 *  del primer plano; la app funde dentro mientras el icono ya pintado se despinta encima. Nunca hay una losa lisa. */
function drawIconToWindow(ctx: Ctx2D, m: Montage, v: ClipView, src: FrameSource | null, assets: Assets, dur: number): void {
  const q = clamp01(v.local / dur)
  const e = ease(m.cameraEase ?? 'smooth', q)
  const pr = m.prologue
  const r0 = iconRect(m, pr?.size, pr?.at)
  const slab = { x: r0.ox, y: r0.oy, s: ICON.art * r0.k }
  const [vw, vh] = v.meta.viewport
  const w1 = vw * v.zoom
  const h1 = vh * v.zoom
  const x = lerp(slab.x, v.x, e)
  const y = lerp(slab.y, v.y, e)
  const w = lerp(slab.s, w1, e)
  const h = lerp(slab.s, h1, e)
  const rad = lerp((ICON.radius / ICON.art) * slab.s, 12 * v.zoom, e)
  const pal = PALETTE[v.theme]
  ctx.save()
  ctx.shadowColor = `rgba(${pal.shadow},${v.theme === 'dark' ? 0.5 : 0.22})`
  ctx.shadowBlur = lerp(40, 80 * v.zoom, e)
  ctx.shadowOffsetY = lerp(16, 30 * v.zoom, e)
  roundRect(ctx, x, y, w, h, rad)
  ctx.fillStyle = assets.slab
  ctx.fill()
  ctx.restore()
  // el arte se queda del tamaño del icono, centrado en la losa que crece (al principio, la caja del icono exacta)
  const side = slab.s
  const ax = x + w / 2 - side / 2
  const ay = y + h / 2 - side / 2
  const cs = (side * ICON.canvas) / ICON.boxSize
  const cx = ax - (ICON.boxAt * cs) / ICON.canvas
  const cy = ay - (ICON.boxAt * cs) / ICON.canvas
  ctx.save()
  roundRect(ctx, x, y, w, h, rad)
  ctx.clip()
  // el canto del icono (su squircle) se va al empezar a crecer; el sol se apaga mientras entra la app
  const edge = 1 - span(q, PROLOGUE_STEPS.edge)
  if (edge > 0) {
    ctx.globalAlpha = edge
    ctx.drawImage(assets.iconNoSun, cx, cy, cs, cs)
  }
  const sun = 1 - span(q, PROLOGUE_STEPS.sun)
  if (sun > 0) {
    ctx.globalAlpha = sun
    drawSunSprite(ctx, assets, cx, cy, cs, 1)
  }
  // la ventana (su vidrio y su captura, centrada como «cubrir») funde de una vez sobre la losa mientras se ensancha
  const appIn = span(q, PROLOGUE_STEPS.app)
  if (src && appIn > 0) {
    const scale = Math.max(w / vw, h / vh)
    ctx.globalAlpha = appIn
    ctx.fillStyle = pal.glass
    ctx.fillRect(x, y, w, h)
    ctx.drawImage(src.image, x + w / 2 - (vw * scale) / 2, y + h / 2 - (vh * scale) / 2, vw * scale, vh * scale)
  }
  ctx.globalAlpha = 1
  // la tinta se despinta encima de la app: el pincel vuelve sobre sus pasos
  drawInk(ctx, assets, ax, ay, side, 1 - span(q, PROLOGUE_STEPS.arch), 1 - span(q, PROLOGUE_STEPS.horizon))
  ctx.restore()
  if (appIn > 0.5) drawControls(ctx, 'mac', x, y, w, v.zoom, v.theme, appIn)
}

// ───────────── aviso del sistema (banner de notificación de macOS) ─────────────

function drawNotice(ctx: Ctx2D, m: Montage, n: Notice, t: number, assets: Assets | undefined, fallback: Theme): void {
  if (t < n.start || t >= n.start + n.dur) return
  const [W] = m.size
  const theme = n.theme ?? fallback
  const u = 1.6 // px del vídeo por pt de pantalla
  const w = 344 * u
  const pad = 14 * u
  const icon = 36 * u
  const local = t - n.start
  const enter = ease('spring', clamp01(local / 0.55))
  const exit = ease('in', clamp01((local - (n.dur - 0.35)) / 0.35))
  ctx.save()
  ctx.font = `600 ${13 * u}px system-ui, -apple-system, sans-serif`
  // dos líneas de cuerpo como mucho
  const bodyFont = `400 ${13 * u}px system-ui, -apple-system, sans-serif`
  const textW = w - pad * 3 - icon
  ctx.font = bodyFont
  const lines: string[] = []
  for (const word of n.body.split(/\s+/)) {
    const cur = lines[lines.length - 1]
    if (cur !== undefined && ctx.measureText(cur + ' ' + word).width <= textW) lines[lines.length - 1] = cur + ' ' + word
    else lines.push(word)
  }
  const body = lines.slice(0, 2)
  if (lines.length > 2) body[1] = body[1].replace(/\s*\S*$/, '…')
  const h = pad * 2 + 17 * u + body.length * 17 * u
  const x = W - 22 - w + (1 - enter + exit) * (w + 60)
  const y = 22
  const light = theme === 'light'
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 8
  roundRect(ctx, x, y, w, h, 18 * u)
  ctx.fillStyle = light ? 'rgba(246,246,248,0.95)' : 'rgba(44,44,46,0.95)'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 1
  ctx.strokeStyle = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.14)'
  ctx.stroke()
  if (assets) ctx.drawImage(assets.icon, x + pad - 2 * u, y + (h - icon) / 2, icon, icon)
  const tx = x + pad * 2 + icon - 6 * u
  ctx.textBaseline = 'alphabetic'
  // la hora a la derecha y el título recortado con «…» para que no la pise
  ctx.font = `400 ${11 * u}px system-ui, -apple-system, sans-serif`
  const time = n.time ?? 'now'
  const timeW = ctx.measureText(time).width
  ctx.fillStyle = '#8e8e93'
  ctx.textAlign = 'right'
  ctx.fillText(time, x + w - pad, y + pad + 12 * u)
  ctx.textAlign = 'left'
  ctx.fillStyle = light ? '#1d1d1f' : '#f5f5f7'
  ctx.font = `600 ${13 * u}px system-ui, -apple-system, sans-serif`
  const maxTitle = x + w - pad - timeW - 10 * u - tx
  let title = n.title
  if (ctx.measureText(title).width > maxTitle) {
    while (title.length > 1 && ctx.measureText(title + '…').width > maxTitle) title = title.slice(0, -1)
    title = title.trimEnd() + '…'
  }
  ctx.fillText(title, tx, y + pad + 13 * u)
  ctx.textAlign = 'left'
  ctx.fillStyle = light ? 'rgba(60,60,67,0.92)' : 'rgba(235,235,245,0.86)'
  ctx.font = bodyFont
  body.forEach((l, i) => ctx.fillText(l, tx, y + pad + 13 * u + (i + 1) * 17 * u))
  ctx.restore()
}

// ───────────── composición ─────────────

let irisLayer: OffscreenCanvas | null = null

/** Composición completa de un fotograma. `sources` trae la imagen de cada plano visible (mismo orden que views). */
export function drawFrame(ctx: Ctx2D, m: Montage, t: number, viewsIn: ClipView[], sources: (FrameSource | null)[], assets?: Assets): void {
  const [W, H] = m.size
  // el tema de cada plano es el que se ve en su fotograma (una toma puede pasar de claro a oscuro por dentro)
  const views = viewsIn.map((v, i) => (sources[i]?.dark === undefined ? v : { ...v, theme: (sources[i]!.dark ? 'dark' : 'light') as Theme }))
  const { stage, theme } = stageAt(m, views, t)
  setOverlay(stage)
  drawStage(ctx, m, stage, theme)
  for (const title of m.titles ?? []) if (title.layer === 'under') drawTitle(ctx, m, title, t, theme, stage)
  if (assets) drawPrologue(ctx, m, t, assets, theme)
  const sun = sunAt(m, views, t)
  const finale = finaleProgress(m, t)
  if (finale !== null && assets) {
    // el final sustituye a la ventana (sin cursor ni sol guía)
    drawFinale(ctx, m, t, views[views.length - 1], sources[sources.length - 1] ?? null, assets, theme, stage)
    drawVignette(ctx, m)
    drawStamp(ctx, m, t, theme)
    for (const n of m.notices ?? []) drawNotice(ctx, m, n, t, assets, theme)
    for (const title of m.titles ?? []) if (title.layer !== 'under') drawTitle(ctx, m, title, t, theme, stage)
    return
  }
  // prologue.morph: en sus últimos `morph` s, la losa del icono se convierte en la ventana del primer plano (el mismo
  // gesto que el final, al revés); mientras tanto no se dibuja ni el icono del prólogo ni ese plano por su cuenta
  const pm = prologueMorph(m, t)
  if (pm && assets) {
    const first = [...m.clips].sort((a, b) => a.start - b.start)[0]
    const i = views.findIndex((v) => v.clip === first)
    if (i >= 0) drawIconToWindow(ctx, m, { ...views[i], local: pm.local }, sources[i], assets, pm.dur)
  }
  views.forEach((v, i) => {
    if (pm || v.ghost) return
    // «icon»: el primer plano nace del icono del prólogo
    if (v.clip.enter?.kind === 'icon' && v.local < v.clip.enter.dur && assets) {
      drawIconToWindow(ctx, m, v, sources[i], assets, v.clip.enter.dur)
      return
    }
    // «content»: este plano solo pone su contenido encima de la ventana del anterior (que ya está dibujada)
    if (v.content !== undefined && i > 0) {
      drawContent(ctx, m, t, v, sources[i], v.content)
      drawCursor(ctx, m, { ...v, alpha: v.content })
      return
    }
    const incoming = views[i + 1]
    const fadingOut = incoming?.content !== undefined ? 1 - incoming.content : 1
    const target = v.iris || v.door ? (() => {
      if (!irisLayer || irisLayer.width !== W || irisLayer.height !== H) irisLayer = new OffscreenCanvas(W, H)
      const l = irisLayer.getContext('2d')!
      l.setTransform(1, 0, 0, 1, 0, 0)
      l.clearRect(0, 0, W, H)
      drawStage(l, m, stage, v.theme)
      return l
    })() : ctx
    drawWindow(target, m, t, v, sources[i], assets)
    if (sun?.halo && i === views.length - 1) drawSun(target, sun.x, sun.y, sun.r, v.theme, 1, true)
    drawCursor(target, m, fadingOut < 1 ? { ...v, alpha: v.alpha * fadingOut } : v)
    if (v.iris && irisLayer) {
      // máscara circular con borde suave de 24 px
      const l = target
      l.globalCompositeOperation = 'destination-in'
      const g = l.createRadialGradient(v.iris.x, v.iris.y, Math.max(0, v.iris.r - 12), v.iris.x, v.iris.y, v.iris.r + 12)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      l.fillStyle = g
      l.fillRect(0, 0, W, H)
      l.globalCompositeOperation = 'source-over'
      ctx.drawImage(irisLayer, 0, 0)
    } else if (v.door && irisLayer) {
      // máscara con la forma de la puerta del arco del icono
      const l = target
      l.save()
      l.globalCompositeOperation = 'destination-in'
      l.translate(v.door.x, v.door.y)
      l.scale(v.door.k, v.door.k)
      l.translate(-ICON.cx, -(ICON.door.top + ICON.door.bottom) / 2)
      l.fillStyle = '#000'
      l.fill(P(ICON_DOOR))
      l.restore()
      ctx.drawImage(irisLayer, 0, 0)
    }
    // el plano que sale se apaga bajo el papel mientras sube el siguiente
    const next = views[i + 1]
    if (next?.clip.enter?.kind === 'rise' && next.local < next.clip.enter.dur) {
      ctx.save()
      ctx.globalAlpha = 0.65 * ease('inOut', next.local / next.clip.enter.dur)
      ctx.fillStyle = stage
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }
  })
  // transición «sunrise»: el sol sale por abajo y su luz baña el cuadro en el cambio de plano
  for (const v of views) {
    const enter = v.clip.enter
    if (enter?.kind !== 'sunrise' || v.local >= enter.dur) continue
    const p = v.local / enter.dur
    const wash = Math.sin(Math.PI * p)
    ctx.save()
    ctx.globalAlpha = wash * 0.96
    ctx.fillStyle = stage
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
    drawSun(ctx, W / 2, H * (1.05 - 0.6 * ease('inOut', p)), 18 + 30 * wash, theme, wash)
  }
  if (sun && !sun.halo) drawSun(ctx, sun.x, sun.y, sun.r, theme)
  drawVignette(ctx, m)
  drawStamp(ctx, m, t, theme)
  for (const n of m.notices ?? []) drawNotice(ctx, m, n, t, assets, theme)
  for (const title of m.titles ?? []) if (title.layer !== 'under') drawTitle(ctx, m, title, t, theme, stage)
}
