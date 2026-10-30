// Dibuja un fotograma del montaje en un lienzo 2D, función pura del tiempo (determinista):
// papel del fondo (por tema o por claves de hora, en OKLab) con grano y viñeta suave · la ventana real de Aula (captura
// con alfa, vidrio tras la barra lateral, sombra sepia, marco mac/windows/linux) · cámara con deriva viva · cursor de
// macOS o cursor-sol con onda al pulsar · el sol de Aula como guía · titulares serif (*cursiva en ladrillo*) · sello de
// hora que rueda · transiciones (corte, fundido, subida, amanecer, iris).
import type { CameraKey, Clip, Drawing, Focus, Montage, Notice, PaintMark, SunKey, TakeMeta, Title, WindowFrame } from '../montage/types.ts'
import { ICON, STROKES, doorPath, pathLength, type IconAssets } from './icon.ts'
import type { PaintKit, Splash, Stroke, Wipe } from './paint.ts'
import type { Cast } from './cast.ts'
import type { DrawnKit } from './drawn.ts'
import { EDGE, buildMatte, matteAt, type Matte } from './matte.ts'
import { cardLayout, cardTextRects, finaleTextRects } from '../montage/v5.ts'
import { balanceBreaks, cleanBreaks, keynoteFit, setWordMeasure, whipBlur, SUB_DELAY, TITLE_WEIGHT, UNDERLINE_DELAY, WORD_DUR, WORD_STAGGER, clipPanelRect, fitTitleSize, keynoteColumn, titleStart, titleWordInfo, avoidRect, clearRect, convergeTarget, isV5, keynoteTextRect, panelRect, titleSize, type Rect } from '../montage/v5.ts'
import { clamp01, ease, lerp } from '../montage/ease.ts'
import { SCREEN_PX, iconWindow, laptopCameraAt, screenCornersPx, screenToFrame, type LaptopCamera } from '../montage/laptop.ts'
import { clipSource, warp } from '../montage/ramp.ts'
import { clearOfText, drawingPlace } from '../montage/draw.ts'

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
  /** V6 · cámara lenta: el fotograma siguiente y cuánto pesa (la imagen es la mezcla de los dos: sin tirones a velocidad
   *  baja). Solo en planos con `speed` o `ramps`. */
  frameB?: number
  mix?: number
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
  /** Transición «brush»: fracción de tiempo (0…1) de la pincelada que barre el cuadro y descubre este plano. */
  brush?: number
  /** V5 · rack focus: desenfoque (px) con el que se dibuja este plano. */
  blur?: number
  /** V5 · transición «light»: avance (0…1) de la forma con la que entra el plano nuevo. */
  light?: number
  /** V5 · corte por coincidencia de forma: avance (0…1). */
  shapeP?: number
  /** V5 · barrido rápido (whip pan): desplazamiento horizontal o vertical del plano (px) y largo del desenfoque de
   *  movimiento (px). */
  shift?: [number, number]
  motion?: number
  /** V5 · el plano entra desde una cartela (la que acaba justo cuando él empieza): lo viejo es la cartela, no el último
   *  plano del capítulo anterior. */
  fromCard?: number
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
  overlayPal = palFor(stage)
}

/** Paleta de lo que va encima (rótulos, sello) para un papel dado. */
function palFor(stage: string): Pal {
  const L = oklab(stage)[0]
  const d = clamp01((0.66 - L) / 0.3)
  const e = d * d * (3 - 2 * d)
  const a = PALETTE.light
  const b = PALETTE.dark
  return { ...(e < 0.5 ? a : b), text: mixOklab(a.text, b.text, e), text2: mixOklab(a.text2, b.text2, e), accent: mixOklab(a.accent, b.accent, e), sun: mixOklab(a.sun, b.sun, e), surface: mixOklab(a.surface, b.surface, e) }
}

// ───────────── cámara y planos ─────────────

/** Margen de arriba de la ventana cuando hay banda de rótulos. */
const BAND_TOP_MARGIN = 40

/** Zoom de «ventana entera»: con banda de rótulos, la ventana cabe entre 40 px y la banda (con 20 px de aire). */
export function fitZoom(m: Montage, vw: number, vh: number): number {
  if (m.bands) {
    // con bandas (vertical, cuadrado): la ventana llena el hueco entre ellas (`fill`, puede salirse por los lados) o cabe
    const gap = m.size[1] - m.bands.top - m.bands.bottom - 24
    return m.bands.fill ? gap / vh : Math.min((m.size[0] * 0.92) / vw, gap / vh)
  }
  if (m.captionBand) return Math.min((m.size[0] * 0.84) / vw, (m.captionBand - 20 - BAND_TOP_MARGIN) / vh)
  return Math.min((m.size[0] * 0.84) / vw, (m.size[1] * 0.84) / vh)
}

/** Dónde cae, por defecto, el centro enfocado: el centro del cuadro o, con banda, el centro del hueco sobre ella. */
function defaultScreen(m: Montage): [number, number] {
  if (m.bands) return [((m.safe?.left ?? 0) + (m.size[0] - (m.safe?.right ?? 0))) / 2 / m.size[0], (m.bands.top + m.size[1] - m.bands.bottom) / 2 / m.size[1]]
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

/** Lo que tarda una cartela en tapar el plano de debajo (s). */
const CARD_FADE = 0.22

/** La cartela que acaba justo en `t` (índice), o −1. */
export function cardEndingAt(m: Montage, t: number): number {
  return (m.chapters?.cards ?? []).findIndex((c) => Math.abs(c.t + c.dur - t) < 0.03)
}

/** ¿Lo que sigue a la cartela entra con una transición que parte de ella (rack focus, luz o forma)? */
function cardHandsOff(m: Montage, card: { t: number; dur: number }): boolean {
  const end = card.t + card.dur
  return m.clips.some((c) => Math.abs(c.start - end) < 0.03 && !!c.enter && ['focus', 'light', 'shape'].includes(c.enter.kind))
}

/** Desenfoque máximo del rack focus (px a 1080 de alto). */
const RACK_BLUR = 26

const barSeconds = (m: Montage) => (m.music ? 240 / m.music.bpm : 2.4)

/** Planos visibles en el instante t, con su geometría y su transición. */
/** Con bandas: la ventana vive en el hueco entre ellas. Si cabe, no se mete en las bandas; si es más alta o más ancha que
 *  el hueco, lo cubre entero (nada de papel en medio): la cámara solo elige qué parte se ve. */
export function clampToBands(m: Montage, x: number, y: number, w: number, h: number): [number, number] {
  const b = m.bands!
  const [W, H] = m.size
  const top = b.top + 12
  const bottom = H - b.bottom - 12
  const ny = h <= bottom - top ? Math.min(Math.max(y, top), bottom - h) : Math.min(Math.max(y, bottom - h), top)
  const nx = w <= W ? Math.min(Math.max(x, 0), W - w) : Math.min(Math.max(x, W - w), 0)
  return [nx, ny]
}

/** Un plano en el instante t, con su propia cámara (sin transición). */
function viewOf(m: Montage, takes: Record<string, TakeMeta>, clip: Clip, t: number): ClipView {
  const meta = takes[clip.take]
  if (!meta) throw new Error(`falta la toma ${clip.take}`)
  const local = t - clip.start
  // V6: con velocidad o rampas, el segundo de la toma sale de su curva y la imagen mezcla los dos fotogramas vecinos
  const src = clipSource(clip, local) * meta.fps
  const slowed = (clip.speed ?? 1) !== 1 || !!clip.ramps?.length
  const f0 = slowed ? Math.floor(src + 1e-6) : Math.round(src)
  const frame = Math.max(0, Math.min(meta.frames - 1, f0))
  const mix = slowed ? src - f0 : 0
  const blend = slowed && mix > 0.02 && mix < 0.98 && f0 + 1 < meta.frames && f0 >= 0 ? { frameB: f0 + 1, mix } : {}
  // V6: en el portátil, la ventana entera llena su pantalla a la resolución de la captura (la cámara es la del portátil)
  if (clip.layout?.kind === 'laptop') return { clip, meta, theme: (m.takes[clip.take].theme ?? 'light') as Theme, frame, ...blend, local, zoom: SCREEN_PX, x: 0, y: 0, alpha: 1, dy: 0, scale: 1 }
  const cam0 = clip.camera ? cameraAt(m, clip.camera, local, meta, frame) : cameraAt(m, m.camera, t, meta, frame)
  // V5: empujón y paneo a lo largo del plano (una sola curva suave de principio a fin)
  const kp = clip.push || clip.pan ? ease('smooth', clamp01(local / Math.max(0.01, clip.dur))) : 0
  const cam = kp ? { ...cam0, zoom: cam0.zoom * (1 + (clip.push ?? 0) * kp), focus: [cam0.focus[0] + (clip.pan?.[0] ?? 0) * kp, cam0.focus[1] + (clip.pan?.[1] ?? 0) * kp] as [number, number] } : cam0
  // deriva viva: el plano nunca está muerto del todo (acercamiento lentísimo alrededor del punto enfocado)
  const drift = clip.drift ?? m.drift ?? 0
  const zoom = Math.min(MAX_ZOOM, cam.zoom * (1 + (drift * local) / barSeconds(m)))
  const [W, H] = m.size
  const x = W * cam.screen[0] - cam.focus[0] * zoom
  let y = H * cam.screen[1] - cam.focus[1] * zoom
  // con banda de rótulos, la ventana nunca baja de ella: los rótulos van en el papel y no tapan nada de la app
  if (m.captionBand) {
    const h = meta.viewport[1] * zoom
    y = Math.min(y, m.captionBand - 12 - h)
    // captionPin: si la ventana no cabe sobre la banda (primer plano), su borde de abajo se apoya en ella: nunca flota
    // sobre papel vacío con la parte de arriba cortada
    if (m.captionPin && h > m.captionBand - 12 - BAND_TOP_MARGIN) y = m.captionBand - 12 - h
  }
  let xx = x
  if (m.bands) [xx, y] = clampToBands(m, xx, y, meta.viewport[0] * zoom, meta.viewport[1] * zoom)
  if (clip.layout) {
    // V5: la cámara encuadra DENTRO del panel (screen en fracciones del panel) y la ventana lo cubre entero
    const P = clipPanelRect(m, clip)
    const w = meta.viewport[0] * zoom
    const h = meta.viewport[1] * zoom
    xx = P.x + P.w * cam.screen[0] - cam.focus[0] * zoom
    y = P.y + P.h * cam.screen[1] - cam.focus[1] * zoom
    if (w >= P.w) xx = Math.min(P.x, Math.max(P.x + P.w - w, xx))
    if (h >= P.h) y = Math.min(P.y, Math.max(P.y + P.h - h, y))
  }
  return { clip, meta, theme: (m.takes[clip.take].theme ?? 'light') as Theme, frame, ...blend, local, zoom, x: xx, y, alpha: 1, dy: 0, scale: 1 }
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
      if (enter.kind === 'whip' && prev) {
        // whip pan: el plano viejo sale disparado hacia `dir` y el nuevo entra por el otro lado, con desenfoque de movimiento
        const pv = viewOf(m, takes, prev, Math.min(t, prev.start + prev.dur - 1e-6))
        const shown = out.find((o) => o.clip === prev)
        if (!shown) out.push(pv)
        const pvv = shown ?? pv
        const [W2, H2] = m.size
        const dir = enter.dir ?? 'left'
        const vec: [number, number] = dir === 'left' ? [-W2, 0] : dir === 'right' ? [W2, 0] : dir === 'up' ? [0, -H2] : [0, H2]
        const e = ease('inOut', clamp01(p))
        pvv.shift = [vec[0] * e, vec[1] * e]
        view.shift = [-vec[0] * (1 - e), -vec[1] * (1 - e)]
        // desenfoque de movimiento = lo que se mueve el plano con el obturador abierto (180°: medio fotograma)
        const mo = whipBlur(Math.hypot(vec[0], vec[1]), enter.dur, p, m.fps)
        pvv.motion = mo
        view.motion = mo
      }
      if ((enter.kind === 'focus' || enter.kind === 'light' || enter.kind === 'shape') && prev) {
        // el plano anterior sigue debajo (quieto en su último fotograma si ya acabó); si entre los dos hubo una cartela,
        // lo viejo es la cartela (la dibuja drawFrame) y el plano anterior no vuelve a aparecer
        const card = cardEndingAt(m, clip.start)
        const pv = viewOf(m, takes, prev, Math.min(t, prev.start + prev.dur - 1e-6))
        const shown = out.find((o) => o.clip === prev)
        if (card >= 0) {
          view.fromCard = card
          if (shown) shown.ghost = true
        } else if (!shown) out.push(pv)
        const prevView = card >= 0 ? { ...pv } : (shown ?? pv)
        const q = clamp01(p)
        if (enter.kind === 'focus') {
          // rack focus: el que sale se desenfoca y se apaga; el que entra llega desenfocado y se enfoca
          const e = ease('smooth', q)
          prevView.blur = RACK_BLUR * e
          prevView.alpha = 1 - ease('smooth', clamp01((q - 0.15) / 0.7))
          view.blur = RACK_BLUR * (1 - e)
          view.alpha = ease('smooth', clamp01((q - 0.15) / 0.7))
        } else if (enter.kind === 'light') {
          view.light = q
          view.paper = 0
        } else {
          view.shapeP = q
          // corte seco a mitad del gesto, tapado por la forma
          if (q < 0.5) view.alpha = 0
          else prevView.ghost = true
        }
      }
      if (enter.kind === 'brush' && prev) {
        // pincelada que barre el cuadro: el plano anterior sigue debajo (quieto en su último fotograma si ya acabó) y este
        // aparece donde ya pasó el pincel; el papel cambia con la misma curva
        const pv = viewOf(m, takes, prev, Math.min(t, prev.start + prev.dur - 1e-6))
        if (!out.some((o) => o.clip === prev)) out.push(pv)
        view.brush = clamp01(p)
        // el papel nuevo va DENTRO de la pincelada: fuera de ella sigue el viejo hasta que acaba (sin fundido gris)
        view.paper = 0
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
    // prologue.morph: la losa va a parar al encuadre del final del gesto (un solo movimiento suave, no a una cámara que
    // se mueve mientras tanto)
    const pr = m.prologue
    if (pr?.morph && prologueMorph(m, t) && clip === [...m.clips].sort((a, b) => a.start - b.start)[0]) {
      const end = viewOf(m, takes, clip, Math.max(clip.start, pr.end - 1e-3))
      view.x = end.x
      view.y = end.y
      view.zoom = end.zoom
    }
    out.push(view)
  }
  // V5: una cartela que entra sin plano debajo funde DESDE el último plano (quieto en su último fotograma), no desde
  // el papel vacío
  if (!out.length && m.chapters) {
    const card = m.chapters.cards.find((c) => t >= c.t && t < c.t + CARD_FADE + 0.05)
    const before = card ? clips.filter((c) => c.start + c.dur <= card.t + 1e-3).sort((a, b) => b.start + b.dur - (a.start + a.dur))[0] : undefined
    if (card && before) out.push(viewOf(m, takes, before, before.start + before.dur - 1e-6))
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

/** Instante del fotograma que se compone (la luz del papel V5 respira con él). */
let stageTime = 0

/** V5 · «Papel y luz»: detrás de la interfaz, una luz crema cálida que se mueve muy despacio y un resplandor ladrillo
 *  que respira; de noche, una lámpara cálida y una brasa. Solo crema y ladrillo (ningún otro color). */
function drawPaperLight(ctx: Ctx2D, m: Montage, theme: Theme, area?: [number, number, number, number]): void {
  const [W, H] = m.size
  const [ax, ay, aw, ah] = area ?? [0, 0, W, H]
  const t = stageTime
  const glow = (x: number, y: number, r: number, rgb: string, a: number, op: GlobalCompositeOperation) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${rgb},${a})`)
    g.addColorStop(0.55, `rgba(${rgb},${a * 0.35})`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.save()
    ctx.globalCompositeOperation = op
    ctx.fillStyle = g
    ctx.fillRect(ax, ay, aw, ah)
    ctx.restore()
  }
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.45)
  if (theme === 'dark') {
    glow(W * (0.3 + 0.05 * Math.sin(t * 0.11)), H * (0.12 + 0.04 * Math.cos(t * 0.09)), Math.max(W, H) * 0.75, '233,170,96', 0.1 + 0.035 * breathe, 'screen')
    glow(W * (0.82 + 0.04 * Math.cos(t * 0.13)), H * 0.95, Math.max(W, H) * 0.6, '180,80,47', 0.12 + 0.04 * (1 - breathe), 'screen')
  } else {
    glow(W * (0.24 + 0.06 * Math.sin(t * 0.12)), H * (0.16 + 0.05 * Math.cos(t * 0.1)), Math.max(W, H) * 0.85, '255,250,240', 0.55 + 0.15 * breathe, 'source-over')
    glow(W * (0.84 + 0.05 * Math.cos(t * 0.14)), H * (0.9 + 0.03 * Math.sin(t * 0.2)), Math.max(W, H) * 0.7, '196,110,72', 0.13 + 0.05 * (1 - breathe), 'multiply')
  }
}

/** El papel del fondo. `area` (px del cuadro): lo que se pinta, si es más que el cuadro (el papel que sigue fuera de él:
 *  la pantalla del portátil en la revelación y el cierre). */
function drawStage(ctx: Ctx2D, m: Montage, stage: string, theme: Theme, area?: [number, number, number, number]): void {
  const [W, H] = m.size
  const [ax, ay, aw, ah] = area ?? [0, 0, W, H]
  ctx.save()
  ctx.fillStyle = stage
  ctx.fillRect(ax, ay, aw, ah)
  ctx.globalCompositeOperation = theme === 'dark' ? 'screen' : 'multiply'
  ctx.fillStyle = ctx.createPattern(grainTexture(), 'repeat')!
  ctx.fillRect(ax, ay, aw, ah)
  ctx.restore()
  if (isV5(m)) return drawPaperLight(ctx, m, theme, area)
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
/** Recursos dibujados que no salen de la captura: el icono y el kit de pintura (lo pone el compositor). */
export type Assets = IconAssets & { paint?: PaintKit; cast?: Cast; laptop?: LaptopKit; drawn?: DrawnKit }

/** V6 · el portátil en 3D (lo pone el compositor: three solo vive en la página). */
export interface LaptopKit {
  /** El lienzo de la pantalla, que es su textura: px = pt de la toma × SCREEN_PX. */
  screen: OffscreenCanvas
  /** Dibuja el portátil (fondo transparente, tamaño del cuadro × supermuestreo) con la pantalla tal como esté ahora. */
  render(cam: LaptopCamera, look: { night: number; gloss?: number }): OffscreenCanvas
}

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

// ───────────── rótulos y adornos pintados (versión corta) ─────────────

const titleStrokes = new Map<string, Stroke>()
function cachedStroke(key: string, make: () => Stroke): Stroke {
  let st = titleStrokes.get(key)
  if (!st) {
    st = make()
    if (titleStrokes.size > 600) titleStrokes.clear()
    titleStrokes.set(key, st)
  }
  return st
}

/** Lo que tarda en revelarse cada palabra a pincel (s), según su largo. */
const wordDur = (w: number, size: number) => Math.min(0.4, Math.max(0.2, 0.16 + (w / size) * 0.05))

/** Colocación de un rótulo `paint`: cuerpo, líneas y la caja de cada palabra (px del vídeo). */
export interface PaintLayout {
  size: number
  words: { text: string; italic: boolean; x: number; y: number; w: number }[]
}

export function paintTitleLayout(ctx: Ctx2D, m: Montage, title: Title): PaintLayout {
  const [W, H] = m.size
  const size = title.size ?? Math.round(Math.min(W, H) * 0.075)
  const sw = W - (m.safe?.left ?? 0) - (m.safe?.right ?? 0)
  const t = typeset(ctx, title.text, size, 500, SERIF, Math.min(W * 0.86, sw * 0.94))
  const lh = size * 1.12
  const b = m.bands
  // zonas seguras (la interfaz de TikTok/Reels/Shorts): el rótulo va en la parte VISIBLE de su banda y lejos del borde
  const sf = { top: 0, bottom: 0, left: 0, right: 0, ...m.safe }
  const cy = title.band && b ? (title.band === 'top' ? (sf.top + b.top) / 2 : (H - b.bottom + H - sf.bottom) / 2) : H * (title.at?.[1] ?? 0.85)
  const cx = title.at && !title.band ? W * title.at[0] : sf.left + (W - sf.left - sf.right) / 2
  // el bloque centrado en el ancla (la línea base, a 0,35 del cuerpo por debajo del centro de cada línea)
  const y0 = cy - ((t.lines.length - 1) * lh) / 2 + size * 0.35
  const words: PaintLayout['words'] = []
  t.lines.forEach((line, li) => {
    const widths = measure(ctx, t, line)
    let x = cx - widths.reduce((a, c) => a + c, 0) / 2
    line.forEach((w, wi) => {
      ctx.font = font(t, w)
      words.push({ text: w.text, italic: w.italic, x, y: y0 + li * lh, w: ctx.measureText(w.text).width })
      x += widths[wi]
    })
  })
  return { size, words }
}

/** Rótulo `paint`: grande, en el papel (o en su banda), sin píldora. Con `gesture: 'brush'` cada palabra se revela con
 *  una pincelada; sale con el gesto calmado. Subrayado y rodeo a pincel en ladrillo, en su instante. */
function drawPaintTitle(ctx: Ctx2D, m: Montage, title: Title, t: number, theme: Theme, assets?: Assets): void {
  const pal = overlay(theme)
  const kit = assets?.paint
  const L = paintTitleLayout(ctx, m, title)
  const brush = title.gesture === 'brush' && kit && !title.instant
  const stagger = title.stagger ?? 0.16
  const closing = title.start + title.dur >= m.duration - 1e-6
  const aOut = closing ? 1 : 1 - ease('in', clamp01((t - (title.start + title.dur - 0.35)) / 0.35))
  const aIn = brush || title.start <= 0 || title.instant ? 1 : ease('out', clamp01((t - title.start) / 0.35))
  const local = t - title.start
  ctx.save()
  ctx.globalAlpha = aOut * aIn
  ctx.translate(0, -(1 - aOut) * 8 + (1 - aIn) * 8)
  ctx.textBaseline = 'alphabetic'
  let revealed = 0
  L.words.forEach((w, i) => {
    const f = `${w.italic ? 'italic ' : ''}500 ${L.size}px ${SERIF}`
    // durante un barrido, la tinta de cada palabra es la que se lee sobre el papel que tiene detrás en este fotograma
    const wp = wipeInk ? (wipeInk.at(w.x + w.w / 2, w.y - L.size * 0.35) > 0.5 ? wipeInk.neu : wipeInk.old) : pal
    const color = w.italic ? wp.accent : wp.text
    const paint = (c: Ctx2D) => {
      c.font = f
      c.fillStyle = color
      c.fillText(w.text, w.x, w.y)
    }
    if (!brush) return paint(ctx)
    const t0 = i * stagger
    const d = wordDur(w.w, L.size)
    revealed = Math.max(revealed, t0 + d)
    const p = (local - t0) / d
    if (p >= 1) return paint(ctx)
    const st = cachedStroke(`w:${title.text}:${i}:${w.x.toFixed(1)}:${w.y.toFixed(1)}:${L.size}`, () => kit!.wordStroke(w.x, w.y, w.w, L.size, `${title.text}:${i}`))
    kit!.drawThroughStroke(ctx, st, p, (l) => paint(l))
  })
  if (!brush) revealed = 0.35
  // subrayado y rodeo a pincel
  if (kit) {
    for (const [kind, spec] of [['u', title.underline || undefined], ['r', title.ring]] as const) {
      if (!spec) continue
      const wi = spec.word ?? Math.max(0, L.words.findIndex((x) => x.italic))
      const w = L.words[Math.min(L.words.length - 1, Math.max(0, wi))]
      if (!w) continue
      const at = spec.t ?? title.start + revealed + 0.05
      const p = (t - at) / (kind === 'u' ? 0.4 : 0.55)
      if (p <= 0) continue
      const st =
        kind === 'u'
          ? cachedStroke(`u:${title.text}:${wi}:${w.x.toFixed(1)}:${w.y.toFixed(1)}`, () => kit.underlineStroke(w.x, w.y, w.w, L.size, `${title.text}:u`))
          : cachedStroke(`r:${title.text}:${wi}:${w.x.toFixed(1)}:${w.y.toFixed(1)}`, () => kit.ringStroke(w.x - L.size * 0.12, w.y - L.size * 0.78, w.w + L.size * 0.24, L.size * 1.02, Math.max(4, L.size * 0.07), `${title.text}:r`))
      const under = wipeInk ? (wipeInk.at(w.x + w.w / 2, w.y) > 0.5 ? wipeInk.newTheme : wipeInk.oldTheme) : theme
      kit.drawStroke(ctx, st, Math.min(1, p), spec.color ?? BRICK[under])
    }
  }
  ctx.restore()
}

const markSplashes = new Map<string, Splash>()

/** La caja (px del vídeo) de una marca del plano activo. */
function markBox(views: ClipView[], name: string): [number, number, number, number] | null {
  const v = views[views.length - 1]
  const r = v?.meta.marks[name]?.[Math.min(v.frame, v.meta.frames - 1)]
  return v && r ? [v.x + r[0] * v.zoom, v.y + r[1] * v.zoom, r[2] * v.zoom, r[3] * v.zoom] : null
}

/** Un adorno de pintura (salpicadura, subrayado, rodeo o trazo) en su instante: se pinta, se queda y se apaga. */
function drawPaintMark(ctx: Ctx2D, m: Montage, mk: PaintMark, t: number, views: ClipView[], theme: Theme, kit: PaintKit): void {
  const [W, H] = m.size
  const dur = mk.dur ?? 1.2
  const local = t - mk.t
  if (local < 0 || local >= dur) return
  const fade = 1 - clamp01((local - (dur - 0.25)) / 0.25)
  const color = mk.color ?? BRICK[theme]
  const seed = `${mk.seed ?? mk.t}:${mk.kind}`
  const box: [number, number, number, number] | null =
    typeof mk.at === 'string' ? markBox(views, mk.at.slice(5)) : (() => {
      const w = mk.size ?? Math.min(W, H) * 0.2
      return [W * mk.at[0] - w / 2, H * mk.at[1] - w * 0.15, w, w * 0.3]
    })()
  if (!box) return
  const [bx, by, bw, bh] = box
  const p = local / (mk.draw ?? 0.35)
  const k = `${seed}:${Math.round(bx)}:${Math.round(by)}:${Math.round(bw)}:${Math.round(bh)}:${W}`
  if (mk.kind === 'splash') {
    const r = mk.size ?? Math.min(W, H) * 0.035
    let sp = markSplashes.get(seed + r)
    if (!sp) {
      sp = kit.splash(r, seed)
      markSplashes.set(seed + r, sp)
    }
    const [cx, cy] = typeof mk.at === 'string' ? [bx + bw / 2, by + bh / 2] : [W * mk.at[0], H * mk.at[1]]
    kit.drawSplash(ctx, sp, cx, cy, local, color, 0.92 * fade)
  } else if (mk.kind === 'underline') {
    const size = Math.max(24, bh)
    const st = cachedStroke(`mu:${k}`, () => kit.underlineStroke(bx, by + bh, bw, size, seed))
    kit.drawStroke(ctx, st, Math.min(1, p), color, fade)
  } else if (mk.kind === 'ring') {
    const line = mk.size ?? Math.max(5, Math.min(W, H) * 0.008)
    const st = cachedStroke(`mr:${k}`, () => kit.ringStroke(bx, by, bw, bh, line, seed))
    kit.drawStroke(ctx, st, Math.min(1, p), color, fade)
  } else {
    const to = mk.to ?? [0.6, 0.5]
    const from = typeof mk.at === 'string' ? { x: bx, y: by + bh / 2 } : { x: W * mk.at[0], y: H * mk.at[1] }
    const st = cachedStroke(`ms:${k}`, () => kit.freeStroke(from, { x: W * to[0], y: H * to[1] }, mk.size ?? Math.min(W, H) * 0.018, seed))
    kit.drawStroke(ctx, st, Math.min(1, p), color, fade)
  }
}

export function drawTitle(ctx: Ctx2D, m: Montage, title: Title, t: number, theme: Theme, stage: string, assets?: Assets): void {
  if (t < title.start || t >= title.start + title.dur) return
  if (title.style === 'paint') return drawPaintTitle(ctx, m, title, t, theme, assets)
  if (title.style === 'keynote' || title.style === 'type') return drawV5Title(ctx, m, title, t, theme, assets)
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
    // el arco solo descubre lo que está por encima del horizonte: su remate (donde se posa el pincel) no se lleva un
    // pegote del pincelazo del horizonte; eso lo descubre el horizonte
    l.save()
    if (key === 'arch') {
      l.beginPath()
      l.rect(-50, -50, ICON.art + 100, ICON.door.bottom - 14 + 50)
      l.clip()
    }
    l.lineWidth = STROKES[key].w
    l.setLineDash(p >= 1 ? [] : [strokeLen[key] * p, strokeLen[key] * 3])
    l.beginPath()
    l.moveTo(pts[0][0], pts[0][1])
    for (const q of pts.slice(1)) l.lineTo(q[0], q[1])
    l.stroke()
    l.restore()
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
export const FINALE_STEPS = { content: [0.3, 0.85], arch: [0.38, 0.78], horizon: [0.74, 0.88], icon: [0.86, 1] } as const
/** Avance (0…1) de un tramo [a, b] de un gesto en la fracción q, con la curva suave (la misma que miden las pruebas). */
export const span = (q: number, [a, b]: readonly [number, number]) => ease('smooth', clamp01((q - a) / (b - a)))

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
  if (f.title && isV5(m)) drawFinaleTitleV5(ctx, m, f, t, W * ax, iy + S, pal)
  else if (f.title) {
    const local = t - Math.max(r1 - 0.2, f.start + f.dur * 0.72)
    if (local > 0) {
      const main = typeset(ctx, f.title, 88, 500, SERIF, W * 0.6)
      const n = drawTypeset(ctx, main, W * ax, iy + S + 96, 96, 'center', local, 1, pal.text, pal.accent)
      if (f.sub) drawTypeset(ctx, typeset(ctx, f.sub, 30, 400, SANS, W * 0.6), W * ax, iy + S + 96 + main.lines.length * 96 - 30, 40, 'center', local - 0.2, 1, pal.text2, pal.accent, n)
    }
  }
  void stage
}

/** V5 · «Aula» del cierre: grande (≈ 12 % del alto), letra a letra en el golpe del logo (`finale.titleAt`, por defecto
 *  el comienzo de la salida del sol), cada letra subiendo desde detrás de su máscara; el lema debajo, más pequeño. */
function drawFinaleTitleV5(ctx: Ctx2D, m: Montage, f: NonNullable<Montage['finale']>, t: number, cx: number, below: number, pal: Pal): void {
  const [W, H] = m.size
  const at = f.titleAt ?? f.rise?.[0] ?? f.start + f.dur * 0.55
  const local = t - at
  if (local < -0.05) return
  const size = Math.round(H * (H >= W * 0.95 ? 0.085 : 0.12))
  ctx.save()
  ctx.font = `${TITLE_WEIGHT} ${size}px ${SERIF}`
  ctx.textBaseline = 'alphabetic'
  const letters = [...f.title!]
  const widths = letters.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0)
  let x = cx - total / 2
  const y = below + size * 1.05
  letters.forEach((ch, i) => {
    const p = ease('out', clamp01((local - i * 0.06) / 0.38))
    if (p > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x - size * 0.1, y - size * 1.0, widths[i] + size * 0.2, size * 1.3)
      ctx.clip()
      ctx.fillStyle = pal.text
      ctx.fillText(ch, x, y + (1 - p) * size * 1.05)
      ctx.restore()
    }
    x += widths[i]
  })
  if (f.sub) {
    const p = ease('out', clamp01((local - letters.length * 0.06 - 0.15) / 0.4))
    if (p > 0) {
      const ss = Math.round(size * 0.3)
      ctx.font = `450 ${ss}px ${SANS}`
      ctx.globalAlpha = p
      ctx.fillStyle = pal.text2
      ctx.textAlign = 'center'
      ctx.fillText(f.sub, cx, y + ss * 1.9 + (1 - p) * ss * 0.4)
    }
  }
  ctx.restore()
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
  // `spring`: el icono entra con muelle (de 0,55 a 1, con un rebote) en sus primeros 0,7 s
  const spring = pr.spring ? 0.55 + 0.45 * ease('spring', clamp01((t - Math.max(0, pr.start)) / 0.7)) : 1
  const r = iconRect(m, (pr.size ?? 360) * g * spring, pr.at)
  // por defecto, el icono ya está en el primer fotograma (nada de papel vacío)
  const fadeIn = pr.fadeIn ? clamp01((t - pr.start) / pr.fadeIn) : 1
  const rise = ease('out', clamp01((t - pr.rise[0]) / Math.max(0.01, pr.rise[1] - pr.rise[0])))
  const pal = overlay(theme)
  ctx.save()
  ctx.shadowColor = `rgba(${pal.shadow},${theme === 'dark' ? 0.5 : 0.24})`
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  // entra subiendo un poco, como las tarjetas de Aula
  const iy = r.y + (1 - ease('out', fadeIn)) * 24
  // `draw`: el arco se pinta de un trazo sobre la losa de papel y luego el horizonte; el icono real funde al final
  const drawn = pr.draw ? clamp01((t - pr.draw[0]) / Math.max(0.05, pr.draw[1] - pr.draw[0])) : 1
  if (drawn < 1) {
    const side = ICON.art * r.k
    const ay = iy + (ICON.boxAt * r.S) / ICON.canvas
    roundRect(ctx, r.ox, ay, side, side, (ICON.radius / ICON.art) * side)
    ctx.globalAlpha = ease('out', fadeIn)
    ctx.fillStyle = assets.slab
    ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = ease('out', fadeIn)
    drawInk(ctx, assets, r.ox, ay, side, ease('inOut', clamp01(drawn / 0.78)), ease('inOut', clamp01((drawn - 0.74) / 0.22)))
  }
  if (drawn > 0.86) drawIcon(ctx, assets, r.x, iy, r.S, rise, ease('out', fadeIn) * (drawn < 1 ? (drawn - 0.86) / 0.14 : 1), theme)
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
export function prologueMorph(m: Montage, t: number): { local: number; dur: number } | null {
  const pr = m.prologue
  if (!pr?.morph) return null
  // el gesto necesita el primer plano: si empieza más tarde que end − morph, el gesto empieza con él (y dura menos);
  // mientras tanto el icono del prólogo sigue a la vista (nunca un cuadro vacío)
  const first = Math.min(...m.clips.map((c) => c.start))
  const start = Math.max(pr.end - pr.morph, first)
  if (t < start || t >= pr.end || pr.end - start < 0.05) return null
  return { local: t - start, dur: pr.end - start }
}

/** prologue.morph: tramo del gesto (fracción 0…1) en que la ventana de la app funde sobre la losa. */
/** Tramos (fracción del gesto) del prólogo: el canto del icono se va y la tinta se FUNDE dentro de la losa (primero el
 *  horizonte, luego el arco) mientras la app entra: un fundido cruzado dentro de la losa, nunca un trazo suelto encima
 *  de la interfaz ni una losa vacía. */
export const PROLOGUE_STEPS = { edge: [0, 0.15], sun: [0.1, 0.44], app: [0.14, 0.6], horizon: [0.02, 0.2], arch: [0.1, 0.44] } as const

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
    // si el sol aún estaba saliendo cuando empezó el gesto, sigue a la altura a la que iba
    const pr0 = m.prologue
    const t0 = v.clip.start + v.local
    const rise = pr0 ? ease('out', clamp01((t0 - pr0.rise[0]) / Math.max(0.01, pr0.rise[1] - pr0.rise[0]))) : 1
    ctx.globalAlpha = sun
    drawSunSprite(ctx, assets, cx, cy, cs, rise)
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
  // el icono pintado no se «rebobina»: se funde dentro de la losa que crece (el horizonte algo antes que el arco), y está
  // del todo apagado antes de que entre la app
  const archLeft = 1 - span(q, PROLOGUE_STEPS.arch)
  const horLeft = 1 - span(q, PROLOGUE_STEPS.horizon)
  if (horLeft > 0) drawInk(ctx, assets, ax, ay, side, 0, 1, horLeft)
  if (archLeft > 0) drawInk(ctx, assets, ax, ay, side, 1, 0, archLeft)
  ctx.restore()
  if (appIn > 0.5) drawControls(ctx, 'mac', x, y, w, v.zoom, v.theme, appIn)
}

// ───────────── aviso del sistema (banner de notificación de macOS) ─────────────

function drawNotice(ctx: Ctx2D, m: Montage, n: Notice, t: number, assets: Assets | undefined, fallback: Theme, u = 1.6): void {
  if (t < n.start || t >= n.start + n.dur) return
  const [W] = m.size
  const theme = n.theme ?? fallback
  // u: px del lienzo por pt de pantalla (1,6 en el cuadro; en la pantalla del portátil, los de la captura)
  const s = u / 1.6
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
  const x = W - 22 * s - w + (1 - enter + exit) * (w + 60 * s)
  const y = 22 * s
  const light = theme === 'light'
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = 30 * s
  ctx.shadowOffsetY = 8 * s
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

// ───────────── V6 · personajes que se dibujan ─────────────

const drawingSpots = new WeakMap<Drawing, { key: string; at: { x: number; y: number; size: number } }>()

/** Dónde va un dibujo durante toda su vida (fijo: no salta), fuera del texto que se ve mientras tanto: el de las
 *  cartelas, el del final (icono, «Aula» y lema) y los titulares keynote/type. */
function drawingSpot(ctx: Ctx2D, m: Montage, d: Drawing): { x: number; y: number; size: number } {
  const [W, H] = m.size
  const key = `${W}x${H}`
  const hit = drawingSpots.get(d)
  if (hit?.key === key) return hit.at
  const t0 = d.t
  const t1 = d.until ?? m.duration
  const measure = (text: string, size: number) => {
    ctx.save()
    ctx.font = `500 ${size}px ${SERIF}`
    const w = ctx.measureText(text).width
    ctx.restore()
    return w
  }
  const rects: Rect[] = []
  for (const c of m.chapters?.cards ?? []) if (c.t < t1 && c.t + c.dur > t0) rects.push(...cardTextRects(m, c, measure))
  if (m.finale && m.finale.start < t1) rects.push(...finaleTextRects(m, measure))
  for (const title of m.titles ?? []) if ((title.style === 'keynote' || title.style === 'type') && title.start < t1 && title.start + title.dur > t0) rects.push(v5TitleBlock(ctx, m, title))
  const at = clearOfText(drawingPlace(m, d), rects, { W, H })
  drawingSpots.set(d, { key, at })
  return at
}

function drawDrawings(ctx: Ctx2D, m: Montage, t: number, theme: Theme, kit: DrawnKit): void {
  for (const d of m.drawings ?? []) {
    const p = drawingSpot(ctx, m, d)
    const f = kit.frame(p.size === d.size ? d : { ...d, size: p.size }, t, theme === 'dark')
    if (!f || f.alpha <= 0) continue
    ctx.save()
    ctx.globalAlpha = f.alpha
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(f.image, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    ctx.restore()
  }
}

// ───────────── V6 · el portátil ─────────────

const isLaptop = (v: ClipView) => v.clip.layout?.kind === 'laptop'

/** Un punto del cursor de un plano en px del cuadro (en el portátil, proyectado desde su pantalla). */
export function viewCursorPx(m: Montage, v: ClipView): [number, number] | null {
  const c = v.meta.cursor[v.frame]
  if (!c) return null
  if (isLaptop(v) && m.laptop) return screenToFrame(m, m.laptop, v.clip.start + v.local, [c[0], c[1]], v.meta.viewport)
  return [v.x + c[0] * v.zoom, v.y + c[1] * v.zoom + v.dy]
}

/** La ventana de un plano dentro de la pantalla (px de su lienzo): la llena entera; con el marco de Windows o de Linux,
 *  su barra va arriba y la ventana se encoge lo justo (el escritorio, en papel). */
function screenView(m: Montage, t: number, v: ClipView, S: OffscreenCanvas): ClipView {
  const [vw, vh] = v.meta.viewport
  const fr = frameAt(m, t)
  const barPt = lerp(BAR_PT[fr.prev], BAR_PT[fr.kind], ease('inOut', fr.mix))
  const z = Math.min(S.width / vw, S.height / (vh + barPt))
  return { ...v, zoom: z, x: (S.width - vw * z) / 2, y: (S.height - (vh + barPt) * z) / 2 + barPt * z, dy: 0, scale: 1, alpha: 1 }
}

let screenFade: OffscreenCanvas | null = null

/** La ventana en la pantalla: vidrio de su tema, la captura y el marco (sin sombra ni esquinas: es la pantalla). Con
 *  `alpha` < 1 (transición «content»), vidrio y captura funden juntos encima de lo que ya hay. */
function drawScreenWindow(s: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets: Assets | undefined, alpha = 1): void {
  const [vw, vh] = v.meta.viewport
  const w = vw * v.zoom
  const h = vh * v.zoom
  let target = s
  if (alpha < 1) {
    screenFade = fullLayer(screenFade, s.canvas.width, s.canvas.height)
    target = screenFade.getContext('2d')!
    target.setTransform(1, 0, 0, 1, 0, 0)
    target.clearRect(0, 0, s.canvas.width, s.canvas.height)
  }
  target.fillStyle = PALETTE[v.theme].glass
  target.fillRect(v.x, v.y, w, h)
  if (src) {
    target.imageSmoothingEnabled = true
    target.imageSmoothingQuality = 'high'
    target.drawImage(src.image, v.x, v.y, w, h)
  }
  if (alpha < 1) {
    s.save()
    s.globalAlpha = alpha
    s.drawImage(screenFade!, 0, 0)
    s.restore()
  }
  const fr = frameAt(m, t)
  const k = ease('inOut', fr.mix)
  if (fr.prev !== fr.kind) drawControls(s, fr.prev, v.x, v.y, w, v.zoom, v.theme, 1 - k, assets)
  drawControls(s, fr.kind, v.x, v.y, w, v.zoom, v.theme, fr.prev !== fr.kind ? k : 1, assets)
}

/** V6 · el portátil: compone su pantalla (la ventana del plano, el que entra encima, el cursor y los avisos de macOS; en
 *  la revelación y el cierre, el icono sobre el papel) y lo dibuja en 3D con la cámara del instante y la luz del cuarto
 *  (`stage`: día o noche), encima del papel. */
function drawLaptop(ctx: Ctx2D, m: Montage, t: number, shown: { v: ClipView; src: FrameSource | null }[], assets: Assets, stage: string): void {
  if (!shown.length) return
  const [W, H] = m.size
  const kit = assets.laptop!
  const S = kit.screen
  const s = S.getContext('2d')!
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.globalAlpha = 1
  s.globalCompositeOperation = 'source-over'
  s.filter = 'none'
  // el escritorio (solo se ve con los marcos que añaden barra)
  s.fillStyle = PALETTE[shown[0].v.theme].stage
  s.fillRect(0, 0, S.width, S.height)
  shown.forEach(({ v, src }, j) => drawScreenWindow(s, m, t, screenView(m, t, v, S), src, assets, j > 0 && v.content !== undefined ? v.content : 1))
  // el cursor del plano de arriba (en un fundido de contenido, el de abajo se apaga mientras entra el nuevo)
  const sm: Montage = { ...m, size: [S.width, S.height], bands: undefined, captionBand: undefined }
  shown.forEach(({ v }, j) => {
    const next = shown[j + 1]
    const a = next ? (next.v.content !== undefined ? 1 - next.v.content : 0) : j > 0 && v.content !== undefined ? v.content : 1
    if (a > 0) drawCursor(s, sm, { ...screenView(m, t, v, S), alpha: a })
  })
  // el aviso de macOS, dentro de la pantalla (a la escala de la captura)
  const top = shown[shown.length - 1].v
  for (const n of m.notices ?? []) drawNotice(s, sm, n, t, assets, top.theme, screenView(m, t, top, S).zoom)
  const vp = shown[0].v.meta.viewport
  const iw = iconWindow(m.laptop!, t)
  if (iw && iw.icon > 0) drawIconOnScreen(s, m, t, iw, stage, assets, vp[0] / vp[1])
  const cam = laptopCameraAt(m, m.laptop!, t, vp[0] / vp[1])
  const night = clamp01((0.8 - oklab(stage)[0]) / 0.5)
  const gl = kit.render(cam, { night, gloss: iw ? 1 - iw.icon : 1 })
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(gl, 0, 0, W, H)
  ctx.restore()
}

let iconSceneLayer: OffscreenCanvas | null = null

/** La revelación y el cierre: el cuadro del final del prólogo (o del comienzo del final) — el papel con el icono — llevado
 *  a la pantalla con la cámara del instante de anclaje, cuando la pantalla ES el cuadro; luego se aleja (o se acerca)
 *  con ella. Así el icono se convierte en la pantalla del portátil sin corte. */
function drawIconOnScreen(s: Ctx2D, m: Montage, t: number, iw: { icon: number; anchor: number; kind: 'reveal' | 'close' }, stage: string, assets: Assets, aspect: number): void {
  const [W, H] = m.size
  // el cuadro → la pantalla: dónde cae la pantalla en el cuadro en el instante de anclaje (de frente: un rectángulo,
  // mayor que el cuadro); la escena se pinta en px del cuadro con esa transformación, y el papel sigue fuera del cuadro
  const c = screenCornersPx(m, laptopCameraAt(m, m.laptop!, iw.anchor, aspect), aspect)
  const [x0, y0] = c[0]
  const [x1, y1] = c[2]
  iconSceneLayer = fullLayer(iconSceneLayer, s.canvas.width, s.canvas.height)
  const B = iconSceneLayer.getContext('2d')!
  const sx = s.canvas.width / Math.max(1, x1 - x0)
  const sy = s.canvas.height / Math.max(1, y1 - y0)
  B.setTransform(sx, 0, 0, sy, -x0 * sx, -y0 * sy)
  B.globalAlpha = 1
  B.globalCompositeOperation = 'source-over'
  B.filter = 'none'
  const theme: Theme = oklab(stage)[0] < 0.5 ? 'dark' : 'light'
  drawStage(B, m, stage, theme, [x0, y0, x1 - x0, y1 - y0])
  const pal = overlay(theme)
  let x: number, y: number, S: number, rise: number
  if (iw.kind === 'reveal' && m.prologue) {
    const pr = m.prologue
    const r = iconRect(m, pr.size ?? 360, pr.at)
    ;[x, y, S] = [r.x, r.y, r.S]
    rise = ease('out', clamp01((iw.anchor - pr.rise[0]) / Math.max(0.01, pr.rise[1] - pr.rise[0])))
  } else {
    const f = m.finale
    S = f?.size ?? 360
    const [ax, ay] = f?.at ?? [0.5, 0.42]
    ;[x, y] = [W * ax - S / 2, H * ay - S / 2]
    const [r0, r1] = f?.rise ?? [(f?.start ?? 0) + (f?.dur ?? 1) * 0.55, (f?.start ?? 0) + (f?.dur ?? 1) * 0.95]
    rise = ease('out', clamp01((iw.anchor - r0) / Math.max(0.01, r1 - r0)))
  }
  B.save()
  B.shadowColor = `rgba(${pal.shadow},${theme === 'dark' ? 0.5 : 0.24})`
  // la sombra va en px del lienzo: se escala con la transformación
  B.shadowBlur = 40 * sx
  B.shadowOffsetY = 16 * sy
  drawIcon(B, assets, x, y, S, rise, 1, theme)
  B.restore()
  if (rise > 0) {
    const k = (S / ICON.canvas) * (ICON.boxSize / ICON.art)
    drawSun(B, x + (ICON.boxAt * S) / ICON.canvas + ICON.cx * k, y + (ICON.boxAt * S) / ICON.canvas + ICON.door.bottom * k * 0.98, 26, theme, rise * 0.35, true)
  }
  s.save()
  s.globalAlpha = iw.icon
  s.drawImage(iconSceneLayer, 0, 0)
  s.restore()
}

// ───────────── composición ─────────────

let irisLayer: OffscreenCanvas | null = null
let wipeScene: OffscreenCanvas | null = null
const wipes = new Map<string, Wipe>()

/** Pigmento ladrillo de la app (design/paint/paint.css), claro y oscuro. */
export const BRICK = { light: '#B4502F', dark: '#EE9F72' }
/** Brasa: el ladrillo de una pincelada que va de oscuro a oscuro (no un fogonazo claro en mitad de la noche). */
export const EMBER = '#7C3220'

const mattes = new Map<string, Matte>()
let matteSmall: { paint: OffscreenCanvas; scene: OffscreenCanvas; pd: ImageData; sd: ImageData } | null = null

/** Durante un barrido: qué papel hay detrás de cada punto del cuadro en este fotograma (0 = el viejo, 1 = el nuevo), y
 *  las paletas de los dos, para que los rótulos se pinten con la tinta que se lee sobre lo que tienen detrás. */
let wipeInk: { at: (x: number, y: number) => number; old: Pal; neu: Pal; oldTheme: Theme; newTheme: Theme } | null = null

/** Avance (0…1) de cada trazo del barrido en la fracción `p` (la misma curva que el matte). */
export function wipeProgress(w: Wipe, p: number): number[] {
  return w.strokes.map((s) => ease('smooth', clamp01((p - s.span[0]) / (s.span[1] - s.span[0]))))
}

/** Transición «brush» como matte: 3–5 pinceladas de pincel seco cruzan el cuadro y lo cubren ENTERO de ladrillo; detrás de
 *  cada una, la pintura se levanta a tirones (por cerdas) y deja ver el plano nuevo con su papel. Cada píxel pasa de
 *  viejo a ladrillo y de ladrillo a nuevo, en ese orden: ni dos escenas mezcladas, ni pintura translúcida, ni saltos
 *  fuera de la pintura. */
function drawBrushWipe(ctx: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets: Assets, newStage: string, oldStage: string, oldTheme: Theme): void {
  const kit = assets.paint!
  const [W, H] = m.size
  const dir = v.clip.enter?.dir ?? 'right'
  const key = `${v.clip.enter?.seed ?? `${v.clip.take}@${v.clip.start.toFixed(3)}`}:${dir}:${W}x${H}`
  let wipe = wipes.get(key)
  if (!wipe) {
    wipe = kit.wipeStrokes(W, H, dir, key)
    wipes.set(key, wipe)
  }
  let matte = mattes.get(key)
  if (!matte) {
    matte = buildMatte(wipe, W, H)
    mattes.set(key, matte)
  }
  const p = v.brush ?? 1
  const { gw, gh } = matte
  if (!matteSmall || matteSmall.paint.width !== gw || matteSmall.paint.height !== gh) {
    const mk = () => new OffscreenCanvas(gw, gh)
    const pd = new ImageData(gw, gh)
    const sd = new ImageData(gw, gh)
    matteSmall = { paint: mk(), scene: mk(), pd, sd }
  }
  const brick = hexRgb(oldTheme === 'dark' && v.theme === 'dark' ? EMBER : BRICK[v.theme]).map((c) => Math.round(c * 255))
  const { pd, sd } = matteSmall
  for (let i = 0; i < gw * gh; i++) {
    pd.data[i * 4] = brick[0]
    pd.data[i * 4 + 1] = brick[1]
    pd.data[i * 4 + 2] = brick[2]
  }
  matteAt(matte, p, pd.data, sd.data)
  matteSmall.paint.getContext('2d')!.putImageData(pd, 0, 0)
  matteSmall.scene.getContext('2d')!.putImageData(sd, 0, 0)
  if (!wipeScene || wipeScene.width !== W || wipeScene.height !== H) wipeScene = new OffscreenCanvas(W, H)
  // la escena nueva (con su papel), entera en su capa, solo donde la pintura ya se levantó
  const B = wipeScene.getContext('2d')!
  B.setTransform(1, 0, 0, 1, 0, 0)
  B.globalCompositeOperation = 'source-over'
  B.globalAlpha = 1
  B.clearRect(0, 0, W, H)
  drawStage(B, m, newStage, v.theme)
  drawViewInto(B, m, t, v, src, assets, newStage)
  B.globalCompositeOperation = 'destination-in'
  B.imageSmoothingEnabled = true
  B.imageSmoothingQuality = 'high'
  B.drawImage(matteSmall.scene, 0, 0, W, H)
  B.globalCompositeOperation = 'source-over'
  ctx.drawImage(wipeScene, 0, 0)
  // encima, la pintura que aún no se ha levantado
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(matteSmall.paint, 0, 0, W, H)
  ctx.restore()
  const mt = matte
  wipeInk = { at: (x, y) => matteNewAt(mt, p, x, y), old: palFor(oldStage), neu: palFor(newStage), oldTheme, newTheme: v.theme }
}

/** Cuánto se ve ya el papel nuevo en (x, y) durante el barrido `matte` en `p` (0…1). */
function matteNewAt(matte: Matte, p: number, x: number, y: number): number {
  const cx = Math.min(matte.gw - 1, Math.max(0, Math.floor(x / matte.scale)))
  const cy = Math.min(matte.gh - 1, Math.max(0, Math.floor(y / matte.scale)))
  return clamp01((p - matte.L[cy * matte.gw + cx] + EDGE) / (2 * EDGE))
}

// ───────────── V5: composición keynote ─────────────

let whipLayer: OffscreenCanvas | null = null

/** V5 · un plano en pleno whip pan: se dibuja en su capa y se pega desplazado varias veces a lo largo del movimiento
 *  (desenfoque de movimiento de verdad, solo en la dirección del barrido). */
function drawWhipped(ctx: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets?: Assets): void {
  const [W, H] = m.size
  whipLayer = fullLayer(whipLayer, W, H)
  const L = whipLayer.getContext('2d')!
  L.setTransform(1, 0, 0, 1, 0, 0)
  L.globalAlpha = 1
  L.filter = 'none'
  L.clearRect(0, 0, W, H)
  drawViewInto(L, m, t, { ...v, shift: undefined }, src, assets)
  const [dx, dy] = v.shift!
  const len = v.motion ?? 0
  const n = len > 4 ? 17 : 1
  const ux = Math.hypot(dx, dy) > 0 ? dx / Math.hypot(dx, dy) : 1
  const uy = Math.hypot(dx, dy) > 0 ? dy / Math.hypot(dx, dy) : 0
  ctx.save()
  for (let k = 0; k < n; k++) {
    const o = n === 1 ? 0 : (k / (n - 1) - 0.5) * len
    ctx.globalAlpha = 1 / (k + 1)
    ctx.drawImage(whipLayer, dx + ux * o, dy + uy * o)
  }
  ctx.restore()
}

/** Paralaje V5: el panel deriva despacio hacia un lado a lo largo del plano y el titular, hacia el otro (px). */
export function parallax(m: Montage, clip: Clip, local: number): number {
  if (clip.layout?.kind !== 'keynote') return 0
  const k = clamp01(local / Math.max(0.01, clip.dur)) - 0.5
  return k * m.size[0] * 0.014 * (clip.layout.side === 'right' ? -1 : 1)
}

/** Dibuja un plano entero (ventana o panel, con su cursor) en `target`, respetando las bandas. */
function drawViewInto(target: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets?: Assets, stage?: string): void {
  const [W, H] = m.size
  // V6: el portátil entero (con la luz de su cuarto), con este plano en su pantalla
  if (v.clip.layout?.kind === 'laptop') {
    if (assets?.laptop && m.laptop) drawLaptop(target, m, t, [{ v, src }], assets, stage ?? PALETTE[v.theme].stage)
    return
  }
  if (v.clip.layout) return drawPanel(target, m, t, { ...v, alpha: 1, blur: 0 }, src, assets)
  if (m.bands) {
    target.save()
    target.beginPath()
    target.rect(0, m.bands.top, W, H - m.bands.top - m.bands.bottom)
    target.clip()
  }
  drawWindow(target, m, t, { ...v, alpha: 1 }, src, assets)
  drawCursor(target, m, { ...v, alpha: 1 })
  if (m.bands) target.restore()
}

let panelLayer: OffscreenCanvas | null = null
let tiltLayer: OffscreenCanvas | null = null
const fullLayer = (c: OffscreenCanvas | null, W: number, H: number): OffscreenCanvas => (c && c.width === W && c.height === H ? c : new OffscreenCanvas(W, H))

/** Inclinación 3D del panel en el instante (grados): hacia el titular, y se mueve despacio. */
export function panelTilt(layout: NonNullable<Clip['layout']>, local: number): number {
  if (layout.kind === 'laptop') return 0
  const max = layout.tilt ?? (layout.kind === 'detail' ? 0 : 6)
  const sign = layout.kind === 'keynote' && layout.side === 'right' ? -1 : 1
  return sign * max * (0.6 + 0.4 * Math.sin(local * 0.55 + 0.8))
}

/** V5 · el panel: la interfaz recortada en lo que importa, flotando con sombra suave y una leve inclinación 3D
 *  (perspectiva de verdad, en franjas), con su desenfoque y su opacidad (rack focus). */
function drawPanel(ctx: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets?: Assets): void {
  const layout = v.clip.layout!
  const [W, H] = m.size
  const P = clipPanelRect(m, v.clip)
  const detail = layout.kind === 'detail'
  const r = detail ? 0 : Math.min(W, H) * 0.024
  const float = !detail && (layout.kind !== 'keynote' || layout.float !== false) ? Math.sin(v.local * 0.8 + v.clip.start) * H * 0.006 : 0
  // 1) la interfaz entera en su capa, recortada al panel
  panelLayer = fullLayer(panelLayer, W, H)
  const L = panelLayer.getContext('2d')!
  L.setTransform(1, 0, 0, 1, 0, 0)
  L.globalCompositeOperation = 'source-over'
  L.globalAlpha = 1
  L.filter = 'none'
  L.clearRect(0, 0, W, H)
  L.fillStyle = PALETTE[v.theme].glass
  L.fillRect(P.x, P.y, P.w, P.h)
  drawWindow(L, m, t, { ...v, alpha: 1 }, src, assets)
  drawCursor(L, m, { ...v, alpha: 1 })
  L.globalCompositeOperation = 'destination-in'
  roundRect(L, P.x, P.y, P.w, P.h, r)
  L.fillStyle = '#000'
  L.fill()
  L.globalCompositeOperation = 'source-over'
  // 2) inclinado (perspectiva en franjas verticales) en otra capa, con su sombra
  tiltLayer = fullLayer(tiltLayer, W, H)
  const T = tiltLayer.getContext('2d')!
  T.setTransform(1, 0, 0, 1, 0, 0)
  T.globalAlpha = 1
  T.filter = 'none'
  T.clearRect(0, 0, W, H)
  const a = (panelTilt(layout, v.local) * Math.PI) / 180
  const cx = P.x + P.w / 2
  const cy = P.y + P.h / 2 + float
  const f = P.w * 2.4
  const N = Math.abs(a) < 0.002 ? 1 : 48
  const edge = (u: number) => {
    // u en −0,5…0,5 del ancho: posición proyectada y escala vertical
    const z = u * P.w * Math.sin(a)
    const k = f / (f + z)
    return { x: cx + u * P.w * Math.cos(a) * k, k }
  }
  const pal = PALETTE[v.theme]
  if (!detail) {
    // sombra: el contorno inclinado, desenfocado
    const l0 = edge(-0.5)
    const r0 = edge(0.5)
    T.save()
    T.shadowColor = `rgba(${pal.shadow},${v.theme === 'dark' ? 0.55 : 0.2})`
    T.shadowBlur = H * 0.06
    T.shadowOffsetY = H * 0.028
    T.beginPath()
    T.moveTo(l0.x, cy - (P.h / 2) * l0.k)
    T.lineTo(r0.x, cy - (P.h / 2) * r0.k)
    T.lineTo(r0.x, cy + (P.h / 2) * r0.k)
    T.lineTo(l0.x, cy + (P.h / 2) * l0.k)
    T.closePath()
    T.fillStyle = pal.glass
    T.fill()
    T.restore()
  }
  T.imageSmoothingEnabled = true
  T.imageSmoothingQuality = 'high'
  for (let j = 0; j < N; j++) {
    const u0 = j / N - 0.5
    const u1 = (j + 1) / N - 0.5
    const e0 = edge(u0)
    const e1 = edge(u1)
    const k = (e0.k + e1.k) / 2
    const sx = P.x + (j / N) * P.w
    T.drawImage(panelLayer, sx, P.y, P.w / N + 0.5, P.h, e0.x, cy - (P.h / 2) * k, e1.x - e0.x + 0.6, P.h * k)
  }
  // 3) al cuadro, con el desenfoque y la opacidad del rack focus (y su paralaje)
  ctx.save()
  ctx.translate(parallax(m, v.clip, v.local), 0)
  ctx.globalAlpha = v.alpha
  if (v.blur && v.blur > 0.3) ctx.filter = `blur(${((v.blur * H) / 1080).toFixed(1)}px)`
  ctx.drawImage(tiltLayer, 0, 0)
  ctx.restore()
}

/** V5 · rótulos `keynote` (al lado del panel) y `type` (tipografía a pantalla completa): las palabras suben una a una
 *  desde detrás de una máscara; la de *cursiva* va en ladrillo y, al acabar, un subrayado a pincel discreto; el
 *  subtítulo entra después. Salen subiendo un poco y apagándose. */
/** Las mismas palabras que typeset, en el mismo número de líneas pero equilibradas (sin palabra sola al final). */
function balanced(ctx: Ctx2D, t: Typeset, maxWidth: number): Typeset {
  const k = t.lines.length
  if (k <= 1) return t
  const all = t.lines.flat()
  const widths = all.map((w) => {
    ctx.font = font(t, w)
    return ctx.measureText(w.text).width
  })
  ctx.font = font(t, all[0])
  const space = ctx.measureText(' ').width
  const breaks = balanceBreaks(widths, space, k, maxWidth)
  const ends = [...breaks.slice(1), all.length]
  return { ...t, lines: breaks.map((b, i) => all.slice(b, ends[i])) }
}

// en el compositor, el estrechado del panel keynote mide con la serif de verdad (en Node, con la estimación)
if (typeof OffscreenCanvas !== 'undefined') {
  const mctx = new OffscreenCanvas(8, 8).getContext('2d')
  if (mctx) {
    setWordMeasure((word, italic, size) => {
      mctx.font = `${italic ? 'italic ' : ''}${TITLE_WEIGHT} ${size}px ${SERIF}`
      return mctx.measureText(word).width
    })
  }
}

/** Cuerpo de un rótulo V5 que cabe en su columna (la palabra más larga entera). */
function v5FitSize(ctx: Ctx2D, m: Montage, title: Title, width: number): number {
  const info = titleWordInfo(title.text)
  // keynote: nunca por debajo del cuerpo mínimo (si no cabe, ya se estrechó el panel)
  const keynote = title.style === 'keynote' && m.size[1] < m.size[0] * 0.95
  const fit = keynoteFit(m)
  const floor = keynote ? Math.round(m.size[1] * fit.min) : 0
  const fitted = Math.max(floor, fitTitleSize(titleSize(m, title), width, info.map((w) => (w.italic ? '\u0000' : '') + w.text), (w, size) => {
    const italic = w.startsWith('\u0000')
    ctx.font = `${italic ? 'italic ' : ''}${TITLE_WEIGHT} ${size}px ${SERIF}`
    return ctx.measureText(italic ? w.slice(1) : w).width
  }))
  if (!keynote) return fitted
  // keynote: el cuerpo más grande (hasta el mínimo) al que el titular parte limpio, sin «Filled / in.»
  // si no hay, el más grande al que cabe en tres líneas; si tampoco, el mínimo
  const ws = words(title.text)
  const sizes: number[] = []
  for (let size = fitted; size >= floor; size = Math.min(size - 1, Math.floor(size * 0.97))) sizes.push(size)
  if (sizes[sizes.length - 1] !== floor && fitted >= floor) sizes.push(floor) // el mínimo siempre se prueba (con él se estrechó el panel)
  const ok = (size: number, strict: boolean) => {
    const t: Typeset = { lines: [ws], size, weight: TITLE_WEIGHT, family: SERIF }
    const widths = ws.map((w) => {
      ctx.font = font(t, w)
      return ctx.measureText(w.text).width
    })
    ctx.font = font(t, ws[0])
    return cleanBreaks(widths, ctx.measureText(' ').width, width, fit.maxLines, strict)
  }
  return sizes.find((sz) => ok(sz, true)) ?? sizes.find((sz) => ok(sz, false)) ?? floor
}

/** La caja que ocupa el texto de un rótulo V5 (titular y subtítulo), con la misma colocación que drawV5Title. */
export function v5TitleBlock(ctx: Ctx2D, m: Montage, title: Title): Rect {
  const [W, H] = m.size
  const type = title.style === 'type'
  const box: Rect = type ? { x: W * 0.08, y: H * 0.15, w: W * 0.84, h: H * 0.7 } : keynoteColumn(m, title)
  const size = v5FitSize(ctx, m, title, box.w)
  const ts = balanced(ctx, typeset(ctx, title.text, size, TITLE_WEIGHT, SERIF, box.w), box.w)
  const lh = size * 1.04
  const sub = title.sub ? typeset(ctx, title.sub, Math.round(size * (type ? 0.24 : 0.3)), 450, SANS, box.w) : null
  const subLh = sub ? sub.size * 1.4 : 0
  const blockH = ts.lines.length * lh + (sub ? sub.lines.length * subLh + size * 0.35 : 0)
  const portraitTop = m.size[1] >= m.size[0] * 0.95 && !type
  const y0 = (portraitTop ? box.y + size : box.y + (box.h - blockH) / 2 + size * 0.82) + (title.at ? (title.at[1] - 0.5) * H : 0)
  const center = type || portraitTop
  const w = Math.min(box.w, Math.max(...ts.lines.map((l) => measure(ctx, ts, l).reduce((a, b) => a + b, 0))))
  return { x: center ? box.x + (box.w - w) / 2 : box.x, y: y0 - size * 0.86, w, h: blockH + size * 0.2 }
}

function drawV5Title(ctx: Ctx2D, m: Montage, title: Title, t: number, theme: Theme, assets?: Assets): void {
  const [W, H] = m.size
  const pal = overlay(theme)
  const type = title.style === 'type'
  // el titular keynote se ajusta a su hueco junto al panel y baja el cuerpo lo justo para que quepa la palabra más larga
  const box: Rect = type ? { x: W * 0.08, y: H * 0.15, w: W * 0.84, h: H * 0.7 } : keynoteColumn(m, title)
  const size = v5FitSize(ctx, m, title, box.w)
  const ts = balanced(ctx, typeset(ctx, title.text, size, TITLE_WEIGHT, SERIF, box.w), box.w)
  const lh = size * 1.04
  const sub = title.sub ? typeset(ctx, title.sub, Math.round(size * (type ? 0.24 : 0.3)), 450, SANS, box.w) : null
  const subLh = sub ? sub.size * 1.4 : 0
  const blockH = ts.lines.length * lh + (sub ? sub.lines.length * subLh + size * 0.35 : 0)
  const portraitTop = m.size[1] >= m.size[0] * 0.95 && !type
  const y0 = (portraitTop ? box.y + size : box.y + (box.h - blockH) / 2 + size * 0.82) + (title.at ? (title.at[1] - 0.5) * H : 0)
  const align: 'left' | 'center' = type || portraitTop ? 'center' : 'left'
  const stagger = title.stagger ?? WORD_STAGGER
  // espera a que la transición del plano deje de enseñar el plano viejo (salvo `overlap`)
  const local = t - titleStart(m, title) + (title.instant ? 10 : 0)
  if (local < 0) return
  const out = 1 - ease('in', clamp01((t - (title.start + title.dur - 0.32)) / 0.32))
  if (out <= 0) return
  ctx.save()
  ctx.globalAlpha = out
  const host = !type ? m.clips.find((c) => c.layout?.kind === 'keynote' && t >= c.start && t < c.start + c.dur) : undefined
  ctx.translate(host ? -parallax(m, host, t - host.start) * 0.8 : 0, -(1 - out) * size * 0.25)
  ctx.textBaseline = 'alphabetic'
  let index = 0
  let italic: { x: number; y: number; w: number } | null = null
  let lastIn = 0
  ts.lines.forEach((line, li) => {
    const widths = measure(ctx, ts, line)
    const full = widths.reduce((a, b) => a + b, 0)
    let x = align === 'center' ? box.x + (box.w - full) / 2 : box.x
    const y = y0 + li * lh
    line.forEach((w, wi) => {
      const t0 = index * stagger
      lastIn = Math.max(lastIn, t0 + WORD_DUR)
      const p = clamp01((local - t0) / WORD_DUR)
      ctx.font = font(ts, w)
      const ww = ctx.measureText(w.text).width
      if (w.italic && !italic) italic = { x, y, w: ww }
      if (p > 0) {
        // la palabra sube desde detrás de la línea (máscara a la altura de la línea)
        const e = ease('out', p)
        ctx.save()
        ctx.beginPath()
        ctx.rect(x - size * 0.1, y - size * 1.0, ww + size * 0.3, size * 1.28)
        ctx.clip()
        const wp = wipeInk ? (wipeInk.at(x + ww / 2, y - size * 0.35) > 0.5 ? wipeInk.neu : wipeInk.old) : pal
        ctx.fillStyle = w.italic ? wp.accent : wp.text
        ctx.fillText(w.text, x, y + (1 - e) * size * 1.05)
        ctx.restore()
      }
      x += widths[wi]
      index++
    })
  })
  // subrayado a pincel de la palabra en cursiva, al acabar de entrar el titular (salvo underline: false)
  const it = italic as { x: number; y: number; w: number } | null
  if (it && assets?.paint && title.underline) {
    const p = (local - lastIn - UNDERLINE_DELAY) / 0.38
    if (p > 0) {
      const st = cachedStroke(`v5u:${title.text}:${it.x.toFixed(1)}:${it.y.toFixed(1)}:${size}`, () => assets.paint!.underlineStroke(it.x, it.y, it.w, size * 0.62, `${title.text}:v5`))
      assets.paint.drawStroke(ctx, st, Math.min(1, p), BRICK[theme], 0.9)
    }
  }
  // subtítulo
  if (sub) {
    const p = ease('out', clamp01((local - lastIn - SUB_DELAY) / 0.4))
    if (p > 0) {
      ctx.save()
      ctx.globalAlpha *= p
      const sy = y0 + ts.lines.length * lh + size * 0.12 + (1 - p) * size * 0.2
      sub.lines.forEach((line, li) => {
        const widths = measure(ctx, sub, line)
        const full = widths.reduce((a, b) => a + b, 0)
        let x = align === 'center' ? box.x + (box.w - full) / 2 : box.x
        line.forEach((w, wi) => {
          ctx.font = font(sub, w)
          ctx.fillStyle = pal.text2
          ctx.fillText(w.text, x, sy + li * subLh)
          x += widths[wi]
        })
      })
      ctx.restore()
    }
  }
  ctx.restore()
}

/** V5 · cartela de capítulo: número, título y subtítulo grandes sobre el papel, y abajo la fila de capítulos con el
 *  actual en ladrillo. Entra con las palabras subiendo y sale con un rack focus. */
function drawChapterCard(ctx: Ctx2D, m: Montage, t: number, theme: Theme, stage: string, assets?: Assets, frozen?: { index: number; blur: number; alpha: number }): void {
  const ch = m.chapters!
  const card = frozen ? ch.cards[frozen.index] : ch.cards.find((c) => t >= c.t && t < c.t + c.dur)
  if (!card) return
  const [W, H] = m.size
  // congelada: tal como acaba (la transición del plano siguiente se encarga de quitarla)
  const local = frozen ? card.dur : t - card.t
  const pin = ease('out', clamp01(local / CARD_FADE))
  // si el plano siguiente parte de la cartela, ella no se va por su cuenta
  const pout = frozen ? clamp01(frozen.blur / RACK_BLUR) : cardHandsOff(m, card) ? 0 : ease('in', clamp01((local - (card.dur - 0.3)) / 0.3))
  const pal = overlay(theme)
  ctx.save()
  // el papel tapa el plano (el que sale se desenfoca bajo él)
  // el papel tapa el plano de debajo; al salir, el texto se desenfoca (rack focus) sin dejar el cuadro vacío
  ctx.globalAlpha = pin * (frozen?.alpha ?? 1)
  ctx.fillStyle = stage
  ctx.fillRect(0, 0, W, H)
  // vida sutil: la luz del papel respira detrás de la cartela
  if (isV5(m)) drawPaperLight(ctx, m, theme)
  ctx.globalAlpha = pin * (1 - pout * 0.5) * (frozen?.alpha ?? 1)
  // paralaje: el número y el título derivan muy despacio en sentidos contrarios; la fila avanza un poco
  const span01 = clamp01(local / Math.max(0.01, card.dur)) - 0.5
  const drift = span01 * W * 0.014
  if (pout > 0) ctx.filter = `blur(${((pout * RACK_BLUR * H) / 1080).toFixed(1)}px)`
  const name = ch.names[card.n - 1] ?? ''
  // la misma disposición que usan los dibujos para no pisar el texto (montage/v5.ts)
  const { big, cy, rowY, fs, portrait: portraitM } = cardLayout(m)
  const word = (text: string, x: number, y: number, sizePx: number, weight: number, family: string, color: string, delay: number, italic = false) => {
    const p = ease('out', clamp01((local - delay) / WORD_DUR))
    if (p <= 0) return
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${sizePx}px ${family}`
    const w = ctx.measureText(text).width
    ctx.save()
    ctx.beginPath()
    ctx.rect(x - w / 2 - sizePx * 0.2, y - sizePx * 1.05, w + sizePx * 0.4, sizePx * 1.35)
    ctx.clip()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(text, x, y + (1 - p) * sizePx * 1.05)
    ctx.restore()
  }
  // el texto entra ya a medias (sin fotograma vacío al principio)
  word(String(card.n).padStart(2, '0'), W / 2 + drift * 0.8, cy - big * 1.05, Math.round(big * 0.42), 500, SERIF, pal.accent, -0.2, true)
  word(name, W / 2 - drift * 0.5, cy + big * 0.3, big, 500, SERIF, pal.text, -0.16)
  if (card.sub) word(card.sub, W / 2 - drift * 0.25, cy + big * 0.3 + big * 0.62, Math.round(big * 0.26), 400, SANS, pal.text2, 0.12)
  // la fila de capítulos
  ctx.font = `500 ${fs}px ${SANS}`
  const items = ch.names.map((n, i) => `${String(i + 1).padStart(2, '0')}  ${n}`)
  const gap = fs * 2.2
  const widths = items.map((s) => ctx.measureText(s).width)
  const rows = portraitM ? [items.slice(0, 4), items.slice(4)] : [items]
  let k = 0
  rows.forEach((row, ri) => {
    const rw = row.reduce((a, s) => a + ctx.measureText(s).width, 0) + gap * (row.length - 1)
    let x = (W - rw) / 2 - span01 * W * 0.008
    row.forEach((s) => {
      const i = k++
      const p = clamp01((local - 0.18 - i * 0.03) / 0.3)
      // el capítulo actual se ilumina poco a poco (y respira); los demás quedan atenuados
      const cur = i === card.n - 1
      const lit = cur ? 0.6 + 0.4 * ease('out', clamp01((local - 0.3) / 0.8)) - 0.06 * (0.5 + 0.5 * Math.sin(local * 3)) : 0.42
      ctx.globalAlpha = pin * (1 - pout * 0.5) * (frozen?.alpha ?? 1) * p * lit
      ctx.fillStyle = i === card.n - 1 ? pal.accent : pal.text2
      ctx.textAlign = 'left'
      ctx.fillText(s, x, rowY + ri * fs * 2)
      if (i === card.n - 1) ctx.fillRect(x, rowY + ri * fs * 2 + fs * 0.45, widths[i], Math.max(1.5, fs * 0.09))
      x += widths[i] + gap
    })
  })
  ctx.restore()
  void assets
}

/** V5 · destello del drop: un estallido de luz cálida que nace del sol del icono (si el prólogo empieza ahí; si no, del
 *  centro), llena el cuadro de crema luminosa en 0,18 s y se abre despacio al papel de día: un amanecer, no un gris. */
function drawFlashes(ctx: Ctx2D, m: Montage, t: number, stage: string): void {
  const [W, H] = m.size
  for (const f of m.flashes ?? []) {
    const d = t - f
    if (d < -0.1 || d > 0.95) continue
    const pr = m.prologue
    let ox = W / 2
    let oy = H / 2
    if (pr && Math.abs(pr.start - f) < 0.6) {
      const r = iconRect(m, pr.size, pr.at)
      ox = r.ox + ICON.sun.x * r.k
      oy = r.oy + ICON.sun.y * r.k
    }
    const far = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy)) * 1.1
    ctx.save()
    if (d < 0) {
      // un punto de luz que se enciende en el sol justo antes
      const a = (d + 0.1) / 0.1
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, H * 0.12 * a + 1)
      g.addColorStop(0, `rgba(255,253,246,${0.9 * a})`)
      g.addColorStop(1, 'rgba(246,199,127,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    } else {
      // el estallido: crece desde el sol y llena el cuadro de luz cálida; luego se abre (se apaga hacia fuera)
      const grow = ease('out', clamp01(d / 0.18))
      const R = Math.max(1, far * grow)
      const fade = d < 0.18 ? 1 : Math.exp(-(d - 0.18) * 4.2)
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R)
      g.addColorStop(0, `rgba(255,253,247,${fade})`)
      g.addColorStop(0.5, `rgba(252,236,206,${0.96 * fade})`)
      g.addColorStop(0.85, `rgba(246,199,127,${0.6 * fade})`)
      g.addColorStop(1, 'rgba(246,199,127,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      // el resplandor del sol se queda un poco más
      const halo = ctx.createRadialGradient(ox, oy, 0, ox, oy, H * 0.35)
      halo.addColorStop(0, `rgba(255,236,190,${0.55 * Math.exp(-d * 2.2)})`)
      halo.addColorStop(1, 'rgba(255,236,190,0)')
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, W, H)
    }
    ctx.restore()
  }
  void stage
}

/** Forma de una transición «light» en el avance e (0…1): dibuja el trazado de la zona donde ya está el plano nuevo. */
function lightPath(c: Ctx2D, m: Montage, style: NonNullable<NonNullable<Clip['enter']>['style']>, e: number, at: [number, number]): void {
  const [W, H] = m.size
  c.beginPath()
  if (style === 'dusk') c.rect(-20, -20, W + 40, (H + 80) * e - 20)
  else if (style === 'horizon') c.rect(-20, H + 20 - (H + 80) * e, W + 40, H + 80)
  else if (style === 'diagonal') {
    const d = (W + H) * 1.1 * e - 40
    c.moveTo(-40, -40)
    c.lineTo(d, -40)
    c.lineTo(-40, d)
    c.closePath()
  } else if (style === 'dawn') {
    // el área crece al mismo ritmo (radio ∝ √e): sin acelerón al final
    const R = Math.hypot(Math.max(at[0], W - at[0]), Math.max(at[1], H - at[1])) + 40
    c.arc(at[0], at[1], Math.max(0.1, R * Math.sqrt(e)), 0, Math.PI * 2)
  } else {
    // el arco de Aula: puerta con medio punto que crece desde el centro hasta cubrir el cuadro (área ∝ e)
    const k = Math.max(0.001, Math.sqrt(e) * (Math.max(W, H) * 1.3) / ICON.door.w)
    c.save()
    c.translate(at[0], at[1])
    c.scale(k, k)
    c.translate(-ICON.cx, -(ICON.door.top + ICON.door.bottom) / 2)
    const p2 = P(ICON_DOOR)
    c.restore()
    // un Path2D no se suma a beginPath: se dibuja con fill(p2) más abajo
    lightArch = { p2, k, at }
  }
}
let lightArch: { p2: Path2D; k: number; at: [number, number] } | null = null

/** Rellena en `c` la forma de una transición de luz en el avance e (también el arco, que va con su Path2D). */
function fillLightShape(c: Ctx2D, m: Montage, style: NonNullable<NonNullable<Clip['enter']>['style']>, e: number, at: [number, number]): void {
  lightArch = null
  lightPath(c, m, style, e, at)
  if (style === 'arch' && lightArch) {
    const la = lightArch as { p2: Path2D; k: number; at: [number, number] }
    c.save()
    c.translate(la.at[0], la.at[1])
    c.scale(la.k, la.k)
    c.translate(-ICON.cx, -(ICON.door.top + ICON.door.bottom) / 2)
    c.fill(la.p2)
    c.restore()
  } else c.fill()
}

/** De dónde viene la luz de cada forma en el avance e: el sol (amanecer, arco), el filo que baja (anochecer), el
 *  horizonte que sube o la esquina del barrido diagonal. */
function lightSource(m: Montage, style: string, e: number, at: [number, number]): [number, number] {
  const [W, H] = m.size
  if (style === 'dusk') return [W * 0.5, (H + 80) * e - 20]
  if (style === 'horizon') return [W * 0.5, H + 20 - (H + 80) * e]
  if (style === 'diagonal') return [((W + H) * 1.1 * e) / 2, ((W + H) * 1.1 * e) / 2]
  return at
}

let bloomLayer: OffscreenCanvas | null = null

/** El brillo de una transición de luz: una franja ancha y suave de luz cálida (crema y ámbar) que va DELANTE del borde
 *  de la forma, y en el amanecer y el arco, el sol que florece en la fuente. Se suma con «screen»: ilumina, no tapa. */
function drawLightBloom(ctx: Ctx2D, m: Montage, style: NonNullable<NonNullable<Clip['enter']>['style']>, e: number, at: [number, number], a: number): void {
  const [W, H] = m.size
  bloomLayer = fullLayer(bloomLayer, W, H)
  const G = bloomLayer.getContext('2d')!
  G.setTransform(1, 0, 0, 1, 0, 0)
  G.globalCompositeOperation = 'source-over'
  G.globalAlpha = 1
  G.filter = 'none'
  G.clearRect(0, 0, W, H)
  // la franja: la forma un poco más grande menos la forma un poco más pequeña, muy desenfocada
  const band = style === 'dawn' || style === 'arch' ? 0.1 : 0.07
  G.filter = `blur(${(H * 0.03).toFixed(1)}px)`
  G.fillStyle = '#000'
  fillLightShape(G, m, style, Math.min(1, e + band), at)
  G.globalCompositeOperation = 'destination-out'
  fillLightShape(G, m, style, Math.max(0, e - band * 0.5), at)
  G.filter = 'none'
  G.globalCompositeOperation = 'source-in'
  const [sx, sy] = lightSource(m, style, e, at)
  const tint = G.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H))
  tint.addColorStop(0, 'rgba(255,248,232,1)')
  tint.addColorStop(0.45, 'rgba(250,214,160,1)')
  tint.addColorStop(1, 'rgba(232,160,110,1)')
  G.fillStyle = tint
  G.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = 0.85 * a
  ctx.drawImage(bloomLayer, 0, 0)
  // el sol que florece en la fuente (amanecer y arco)
  if (style === 'dawn' || style === 'arch') {
    const r = H * (0.08 + 0.42 * e)
    const sun = ctx.createRadialGradient(at[0], at[1], 0, at[0], at[1], r)
    sun.addColorStop(0, 'rgba(255,252,240,1)')
    sun.addColorStop(0.25, 'rgba(252,226,172,0.9)')
    sun.addColorStop(0.6, 'rgba(246,199,127,0.35)')
    sun.addColorStop(1, 'rgba(246,199,127,0)')
    ctx.globalAlpha = a
    ctx.fillStyle = sun
    ctx.fillRect(at[0] - r, at[1] - r, 2 * r, 2 * r)
  }
  ctx.restore()
}

let lightScene: OffscreenCanvas | null = null
let lightMask: OffscreenCanvas | null = null

/** V5 · transición «light»: el plano nuevo (con su tema y su papel) entra dentro de una forma con borde suave y un filo
 *  de luz cálida. La forma se elige por capítulo: anochecer, amanecer desde el sol, portal del arco, horizonte, diagonal. */
function drawLightWipe(ctx: Ctx2D, m: Montage, t: number, v: ClipView, src: FrameSource | null, assets: Assets | undefined, newStage: string, oldStage: string, oldTheme: Theme): void {
  const [W, H] = m.size
  const enter = v.clip.enter!
  const style = enter.style ?? 'dusk'
  const e = ease('smooth', v.light ?? 1)
  const at: [number, number] = Array.isArray(enter.at) ? [W * enter.at[0], H * enter.at[1]] : [W / 2, H * (style === 'dawn' ? 0.62 : 0.55)]
  lightScene = fullLayer(lightScene, W, H)
  lightMask = fullLayer(lightMask, W, H)
  const B = lightScene.getContext('2d')!
  B.setTransform(1, 0, 0, 1, 0, 0)
  B.globalCompositeOperation = 'source-over'
  B.globalAlpha = 1
  B.filter = 'none'
  B.clearRect(0, 0, W, H)
  drawStage(B, m, newStage, v.theme)
  drawViewInto(B, m, t, v, src, assets)
  const M = lightMask.getContext('2d')!
  M.setTransform(1, 0, 0, 1, 0, 0)
  M.globalCompositeOperation = 'source-over'
  M.clearRect(0, 0, W, H)
  // borde muy difuminado (≈ 8–10 % del cuadro): luz, no cortinilla
  M.filter = `blur(${(H * 0.045).toFixed(1)}px)`
  M.fillStyle = '#000'
  fillLightShape(M, m, style, e, at)
  M.filter = 'none'
  // la escena nueva, iluminada desde la fuente (un velo de luz cálida que se retira cuando la forma termina)
  const glowA = Math.sin(Math.PI * clamp01(v.light ?? 1))
  if (glowA > 0.01) {
    const [sx, sy] = lightSource(m, style, e, at)
    const lit = B.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.9)
    // en una escena oscura, la luz es más tenue (de noche la fuente alumbra, no vela)
    const lk = v.theme === 'dark' ? 0.4 : 1
    lit.addColorStop(0, `rgba(255,236,200,${0.45 * glowA * lk})`)
    lit.addColorStop(0.5, `rgba(246,199,127,${0.18 * glowA * lk})`)
    lit.addColorStop(1, 'rgba(246,199,127,0)')
    B.save()
    B.globalCompositeOperation = 'screen'
    B.fillStyle = lit
    B.fillRect(0, 0, W, H)
    B.restore()
  }
  B.globalCompositeOperation = 'destination-in'
  B.drawImage(lightMask, 0, 0)
  B.globalCompositeOperation = 'source-over'
  ctx.drawImage(lightScene, 0, 0)
  if (glowA > 0.01) drawLightBloom(ctx, m, style, e, at, glowA)
  // la tinta de los rótulos sigue al papel que tienen detrás
  const inside = (x: number, y: number): number => {
    if (style === 'dusk') return y < (H + 80) * e - 20 ? 1 : 0
    if (style === 'horizon') return y > H + 20 - (H + 80) * e ? 1 : 0
    if (style === 'diagonal') return x + y < (W + H) * 1.1 * e - 80 ? 1 : 0
    const R = Math.hypot(Math.max(at[0], W - at[0]), Math.max(at[1], H - at[1])) + 40
    return Math.hypot(x - at[0], y - at[1]) < R * Math.sqrt(e) * (style === 'arch' ? 0.8 : 1) ? 1 : 0
  }
  wipeInk = { at: inside, old: palFor(oldStage), neu: palFor(newStage), oldTheme, newTheme: v.theme }
}

/** Centro y radio (px) de un foco para el corte por forma: una marca del plano o un punto (fracción del cuadro). */
function shapeAnchor(m: Montage, v: ClipView | undefined, f: Focus | undefined, fallback: [number, number]): { x: number; y: number; r: number } {
  const [W, H] = m.size
  if (Array.isArray(f)) return { x: W * f[0], y: H * f[1], r: Math.min(W, H) * 0.06 }
  if (typeof f === 'string' && f.startsWith('mark:') && v) {
    const rr = v.meta.marks[f.slice(5)]?.[Math.min(v.frame, v.meta.frames - 1)]
    if (rr) return { x: v.x + (rr[0] + rr[2] / 2) * v.zoom, y: v.y + (rr[1] + rr[3] / 2) * v.zoom, r: (Math.max(rr[2], rr[3]) * v.zoom) / 2 }
  }
  return { x: W * fallback[0], y: H * fallback[1], r: Math.min(W, H) * 0.06 }
}

/** V5 · corte por coincidencia de forma: una forma (círculo, sol o arco) nace sobre el elemento del plano que sale,
 *  viaja y cambia de tamaño hasta el del plano que entra; el corte cae a mitad, bajo ella. */
function drawShapeMatch(ctx: Ctx2D, m: Montage, v: ClipView, views: ClipView[], theme: Theme): void {
  const enter = v.clip.enter!
  const q = v.shapeP ?? 1
  const prev = views.find((o) => o !== v)
  const a = shapeAnchor(m, prev, enter.from, [0.5, 0.5])
  const b = shapeAnchor(m, v, enter.to, [0.5, 0.5])
  const e = ease('smooth', q)
  const x = lerp(a.x, b.x, e)
  const y = lerp(a.y, b.y, e)
  const r = Math.exp(lerp(Math.log(a.r), Math.log(b.r), e)) * (1 + 0.35 * Math.sin(Math.PI * q))
  const alpha = Math.sin(Math.PI * Math.min(1, q * 1.15))
  const shape = enter.shape ?? 'circle'
  ctx.save()
  ctx.globalAlpha = alpha * 0.92
  ctx.fillStyle = BRICK[theme]
  if (shape === 'arch' && q > 0.5) {
    const k = (r * 2) / ICON.door.w
    ctx.translate(x, y)
    ctx.scale(k, k)
    ctx.translate(-ICON.cx, -(ICON.door.top + ICON.door.bottom) / 2)
    ctx.fill(P(ICON_DOOR))
  } else if (shape === 'sun') {
    drawSun(ctx, x, y, r, theme, alpha)
  } else {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** V5 · el gancho: materiales dibujados (hojas con apuntes, diapositivas, páginas de PDF, fotos de pizarra y fichas de
 *  colores de los iconos) que flotan a distintas profundidades y convergen hacia el centro en `converge`. */
function drawHook(ctx: Ctx2D, m: Montage, t: number, theme: Theme, assets?: Assets): void {
  const hk = m.hook!
  if (t < hk.start || t >= hk.end) return
  const [W, H] = m.size
  const items = hookItems(hk.seed ?? 7, hk.count ?? 26)
  const [c0, c1] = hk.converge
  const conv = ease('in', clamp01((t - c0) / Math.max(0.01, c1 - c0)))
  const local = t - hk.start
  const pal = PALETTE[theme]
  const unit = Math.min(W, H)
  // el claro: la caja del rótulo `type` activo (o el que se diga) con un margen del 8 %; los materiales no entran. Cuando
  // cambia (entra o sale un rótulo), los materiales se deslizan a su sitio nuevo en 0,45 s con la curva suave
  const clear = hookClearAt(ctx, m, t)
  const change = hookClearChange(m, t)
  const prevClear = change ? hookClearAt(ctx, m, change.at - 1e-3) : clear
  const slide = change ? ease('smooth', change.k) : 1
  for (const it of [...items].sort((a, b) => a.z - b.z)) {
    // profundidad: los lejanos son pequeños, lentos y desenfocados (paralaje)
    const depth = 0.45 + it.z * 0.75
    const drift = local * (14 + it.z * 26)
    const x0 = W * it.x + Math.cos(it.a) * drift
    const y0 = H * it.y + Math.sin(it.a) * drift * 0.6
    const s = depth * (1 - conv * 0.92)
    const w = unit * it.w * s
    const h = unit * it.h * s
    const half = Math.hypot(w, h) / 2
    const place = (R: Rect | null): [number, number] => {
      const [ax, ay] = R ? avoidRect(x0, y0, half, half, R, { W, H }) : [x0, y0]
      // convergen por los lados del claro (o al centro si no hay rótulo), desenfocándose mucho
      const [tx, ty] = convergeTarget(ax, ay, W, H, R)
      return [lerp(ax, tx, conv), lerp(ay, ty, conv)]
    }
    const [bx, by] = place(clear)
    const [px, py] = slide < 1 ? place(prevClear) : [bx, by]
    const x = lerp(px, bx, slide)
    const y = lerp(py, by, slide)
    const rot = it.rot + local * it.spin * 0.2
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    const blur = (it.z < 0.35 ? (0.35 - it.z) * 10 : 0) + (clear ? conv * 14 : 0)
    if (blur > 0.3) ctx.filter = `blur(${((blur * H) / 1080).toFixed(1)}px)`
    ctx.globalAlpha = 1 - conv * conv
    ctx.shadowColor = `rgba(${pal.shadow},0.16)`
    ctx.shadowBlur = 24 * s
    ctx.shadowOffsetY = 10 * s
    const cast = assets?.cast
    if (cast && (it.kind === 'tile' || it.kind === 'buddy')) {
      // los dibujos de verdad de la app: un icono de curso pintado o un compañero
      const list = it.kind === 'tile' || !cast.companions.length ? cast.icons : cast.companions
      const img = list[it.seed % list.length]
      ctx.shadowColor = 'transparent'
      const side = Math.max(w, h) * 1.25
      ctx.drawImage(img, -side / 2, -side / 2, side, side)
    } else drawMaterial(ctx, it.kind === 'buddy' ? 'tile' : it.kind, w, h, it.seed)
    ctx.restore()
  }
  // un claro de luz de lámpara detrás del rótulo: el papel se ilumina cálido y lo que flota cerca se apaga
  if (clear) {
    const cx = clear.x + clear.w / 2
    const cy = clear.y + clear.h / 2
    const r = Math.max(clear.w, clear.h) * 0.62
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    const lamp = theme === 'dark' ? '58,44,34' : '255,250,240'
    g.addColorStop(0, `rgba(${lamp},${theme === 'dark' ? 0.75 : 0.85})`)
    g.addColorStop(0.6, `rgba(${lamp},${theme === 'dark' ? 0.4 : 0.5})`)
    g.addColorStop(1, `rgba(${lamp},0)`)
    ctx.save()
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
}

/** El claro del gancho en el instante t: `hook.clear`, o la caja de los rótulos `type` activos (±0,3 s) + 8 %. */
function hookClearAt(ctx: Ctx2D, m: Montage, t: number): Rect | null {
  const [W, H] = m.size
  const hk = m.hook!
  if (hk.clear) return { x: W * hk.clear[0], y: H * hk.clear[1], w: W * hk.clear[2], h: H * hk.clear[3] }
  const boxes = (m.titles ?? []).filter((x) => x.style === 'type' && t >= x.start - 0.3 && t < x.start + x.dur + 0.3).map((x) => v5TitleBlock(ctx, m, x))
  if (!boxes.length) return null
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  return clearRect({ x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 }, W, H)
}

/** Si el claro del gancho cambió hace menos de HOOK_SLIDE s: cuándo y cuánto lleva (0…1). */
export function hookClearChange(m: Montage, t: number): { at: number; k: number } | null {
  if (m.hook?.clear) return null
  const marks = (m.titles ?? []).filter((x) => x.style === 'type').flatMap((x) => [x.start - 0.3, x.start + x.dur + 0.3])
  const last = Math.max(-Infinity, ...marks.filter((b) => b <= t && b > (m.hook?.start ?? 0)))
  if (!Number.isFinite(last) || t - last >= HOOK_SLIDE) return null
  return { at: last, k: (t - last) / HOOK_SLIDE }
}

/** Lo que tardan los materiales del gancho en deslizarse cuando cambia el claro (s). */
export const HOOK_SLIDE = 0.45

interface HookItem {
  kind: 'note' | 'slide' | 'pdf' | 'photo' | 'sticky' | 'tile' | 'buddy'
  x: number
  y: number
  z: number
  a: number
  w: number
  h: number
  rot: number
  spin: number
  seed: number
}
const hookCache = new Map<string, HookItem[]>()
function hookItems(seed: number, count: number): HookItem[] {
  const key = `${seed}:${count}`
  let items = hookCache.get(key)
  if (items) return items
  let st = seed * 9301 + 49297
  const rnd = () => ((st = (st * 233280 + 49297) % 2147483647) / 2147483647 + 1) % 1
  const kinds: HookItem['kind'][] = ['note', 'slide', 'tile', 'pdf', 'photo', 'buddy', 'sticky', 'tile', 'note', 'pdf']
  items = Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length]
    const ar = kind === 'slide' || kind === 'photo' ? 0.62 : kind === 'sticky' || kind === 'tile' || kind === 'buddy' ? 1 : 1.32
    const w = kind === 'tile' || kind === 'buddy' ? 0.085 : kind === 'sticky' ? 0.1 : 0.16 + rnd() * 0.05
    // repartidos por el cuadro, algo más densos hacia los bordes (el centro queda para el titular)
    const ang = rnd() * Math.PI * 2
    const rad = 0.22 + rnd() * 0.32
    return { kind, x: 0.5 + Math.cos(ang) * rad * 1.15, y: 0.5 + Math.sin(ang) * rad, z: rnd(), a: rnd() * Math.PI * 2, w, h: w * ar, rot: (rnd() - 0.5) * 0.5, spin: rnd() - 0.5, seed: Math.floor(rnd() * 1e6) }
  })
  hookCache.set(key, items)
  return items
}

/** Orden de la ola: cada celda de la rejilla y cuándo entra (fracción de la ola, en diagonal). */
export function waveLayout(n: number, W: number, H: number, area: [number, number, number, number] = [0.05, 0.1, 0.9, 0.8]): { cols: number; rows: number; cell: number; at: (i: number) => { x: number; y: number; k: number } } {
  const aw = W * area[2]
  const ah = H * area[3]
  const cols = Math.max(1, Math.round(Math.sqrt((n * aw) / ah)))
  const rows = Math.ceil(n / cols)
  const cell = Math.min(aw / cols, ah / rows)
  const x0 = W * area[0] + (aw - cols * cell) / 2
  const y0 = H * area[1] + (ah - rows * cell) / 2
  return {
    cols,
    rows,
    cell,
    at: (i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      return { x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell, k: (c + r) / Math.max(1, cols + rows - 2) }
    }
  }
}

/** V5 · la ola de iconos: los 58 iconos de curso pintados de la app (y los compañeros) entran en diagonal con muelle,
 *  respiran un poco y salen todos juntos. */
function drawIconWave(ctx: Ctx2D, m: Montage, t: number, cast: Cast): void {
  const wv = m.iconWave!
  if (t < wv.t || t >= wv.end) return
  const [W, H] = m.size
  const list = wv.companions === false ? cast.icons : cast.icons.flatMap((ic, i) => (i % 4 === 3 && cast.companions[i >> 2] ? [ic, cast.companions[i >> 2]] : [ic]))
  const L = waveLayout(list.length, W, H, wv.area)
  const dur = wv.dur ?? 1.2
  const out = ease('in', clamp01((t - (wv.end - 0.35)) / 0.35))
  list.forEach((img, i) => {
    const c = L.at(i)
    const p = clamp01((t - wv.t - c.k * dur) / 0.5)
    if (p <= 0) return
    const s = ease('spring', p) * (1 - out * 0.4) * (1 + 0.025 * Math.sin((t - wv.t) * 2 + i))
    const side = L.cell * 0.86 * s
    ctx.save()
    ctx.globalAlpha = (1 - out) * Math.min(1, p * 3)
    ctx.drawImage(img, c.x - side / 2, c.y - side / 2 - out * L.cell * 0.3, side, side)
    ctx.restore()
  })
}

/** Un material dibujado, centrado en el origen. Trazos a mano con temblor (semilla fija). */
function drawMaterial(ctx: Ctx2D, kind: HookItem['kind'], w: number, h: number, seed: number): void {
  let st = seed
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647)
  const paperC = kind === 'sticky' ? '#F7E7A6' : kind === 'photo' ? '#F2F0EA' : '#FCFAF5'
  ctx.fillStyle = paperC
  roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.04)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  const ink = '#4A423B'
  const line = (x0: number, y0: number, x1: number, y1: number, lw: number, color = ink) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    const n = 6
    for (let i = 1; i <= n; i++) ctx.lineTo(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n + (rnd() - 0.5) * lw * 0.8)
    ctx.stroke()
  }
  const pad = w * 0.1
  if (kind === 'note' || kind === 'pdf') {
    if (kind === 'pdf') {
      ctx.fillStyle = '#B4502F'
      ctx.fillRect(-w / 2 + pad, -h / 2 + pad, w * 0.35, h * 0.035)
    }
    const rows = 9
    for (let i = 0; i < rows; i++) {
      const y = -h / 2 + pad * 1.8 + (i * (h - pad * 3)) / rows
      line(-w / 2 + pad, y, -w / 2 + pad + (w - 2 * pad) * (0.55 + rnd() * 0.45), y, Math.max(1, w * 0.012), kind === 'note' ? '#5C6E8A' : ink)
    }
  } else if (kind === 'slide') {
    ctx.fillStyle = '#B4502F'
    ctx.fillRect(-w / 2, -h / 2, w, h * 0.16)
    line(-w / 2 + pad, -h / 2 + h * 0.34, w * 0.1, -h / 2 + h * 0.34, Math.max(1.2, w * 0.018))
    ctx.strokeStyle = '#E99E3E'
    ctx.lineWidth = Math.max(1.5, w * 0.02)
    ctx.beginPath()
    ctx.arc(w * 0.22, h * 0.12, h * 0.18, Math.PI, 0)
    ctx.stroke()
  } else if (kind === 'photo') {
    ctx.fillStyle = '#E7E9E4'
    ctx.fillRect(-w / 2 + pad * 0.5, -h / 2 + pad * 0.5, w - pad, h - pad)
    for (let i = 0; i < 4; i++) {
      const y = -h / 2 + h * (0.25 + i * 0.17)
      line(-w * 0.38, y, -w * 0.38 + w * (0.3 + rnd() * 0.45), y + (rnd() - 0.5) * h * 0.05, Math.max(1.2, w * 0.016), i % 2 ? '#2F6F5E' : '#2B3A55')
    }
  } else if (kind === 'sticky') {
    for (let i = 0; i < 3; i++) line(-w * 0.32, -h * 0.2 + i * h * 0.2, w * 0.3, -h * 0.2 + i * h * 0.2, Math.max(1.2, w * 0.03))
  } else {
    // ficha de icono: el pigmento de un curso con su marca
    const colors = ['#B4502F', '#E99E3E', '#2F6F5E', '#2B3A55', '#C77B4A']
    ctx.fillStyle = colors[seed % colors.length]
    roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.22)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(0, h * 0.06, w * 0.18, Math.PI, 0)
    ctx.fill()
  }
}

/** Composición completa de un fotograma. `sources` trae la imagen de cada plano visible (mismo orden que views). */
export function drawFrame(ctx: Ctx2D, m: Montage, t: number, viewsIn: ClipView[], sources: (FrameSource | null)[], assets?: Assets): void {
  const [W, H] = m.size
  // el tema de cada plano es el que se ve en su fotograma (una toma puede pasar de claro a oscuro por dentro)
  const views = viewsIn.map((v, i) => (sources[i]?.dark === undefined ? v : { ...v, theme: (sources[i]!.dark ? 'dark' : 'light') as Theme }))
  wipeInk = null
  stageTime = t
  // con una pincelada en curso, fuera de ella sigue el papel viejo y dentro va el nuevo (el de cuando acaba)
  const brushing = views.find((v) => (v.brush !== undefined || v.light !== undefined) && v.clip.enter)
  const { stage, theme } = brushing ? stageAt(m, views, Math.min(t, brushing.clip.start - 1e-3)) : stageAt(m, views, t)
  const newStage = brushing ? stageAt(m, [{ ...brushing, paper: 1 }], brushing.clip.start + brushing.clip.enter!.dur + 1e-3).stage : stage
  setOverlay(stage)
  drawStage(ctx, m, stage, theme)
  for (const title of m.titles ?? []) if (title.layer === 'under') drawTitle(ctx, m, title, t, theme, stage, assets)
  // V6 · cámara lenta de los efectos del compositor (gancho, sol del prólogo, ola de iconos): su propio reloj
  const ft = warp(m.slowmo, t)
  if (m.hook) drawHook(ctx, m, ft, theme, assets)
  if (assets && !(m.laptop?.reveal && t >= m.laptop.reveal.t)) drawPrologue(ctx, m, ft, assets, theme)
  const sun = sunAt(m, views, t)
  const finale = finaleProgress(m, t)
  if (finale !== null && assets) {
    // el final sustituye a la ventana (sin cursor ni sol guía)
    // V6: si el cierre fue el del portátil (laptop.close), el icono ya está en su sitio: el final sigue desde él. Sin
    // close, la ventana que se encoge parte de donde está la pantalla 3D en ese instante y el portátil se apaga debajo
    const last = views[views.length - 1]
    let from = last
    if (last && isLaptop(last) && m.laptop && !m.laptop.close) {
      const vp = last.meta.viewport
      const t0 = m.finale!.start
      const c = screenCornersPx(m, laptopCameraAt(m, m.laptop, t0, vp[0] / vp[1]), vp[0] / vp[1])
      const xs = c.map((p) => p[0])
      const ys = c.map((p) => p[1])
      from = { ...last, x: Math.min(...xs), y: Math.min(...ys), zoom: (Math.max(...xs) - Math.min(...xs)) / vp[0], dy: 0, scale: 1 }
      const fade = 1 - clamp01((t - t0) / 0.35)
      if (fade > 0 && assets.laptop) {
        ctx.save()
        ctx.globalAlpha = fade
        drawLaptop(ctx, m, Math.min(t, t0), [{ v: last, src: sources[sources.length - 1] ?? null }], assets, stage)
        ctx.restore()
      }
    }
    drawFinale(ctx, m, t, last && isLaptop(last) && m.laptop?.close ? undefined : from, sources[sources.length - 1] ?? null, assets, theme, stage)
    drawVignette(ctx, m)
    drawStamp(ctx, m, t, theme)
    for (const n of m.notices ?? []) drawNotice(ctx, m, n, t, assets, theme)
    // los dibujos, también sobre el final (la luna y el gato junto al icono)
    if (assets.drawn) drawDrawings(ctx, m, warp(m.slowmo, t), theme, assets.drawn)
    for (const title of m.titles ?? []) if (title.layer !== 'under') drawTitle(ctx, m, title, t, theme, stage, assets)
    return
  }
  // prologue.morph: en sus últimos `morph` s, la losa del icono se convierte en la ventana del primer plano (el mismo
  // gesto que el final, al revés); mientras tanto no se dibuja ni el icono del prólogo ni ese plano por su cuenta
  const pm = prologueMorph(m, t)
  if (pm && assets) {
    const first = [...m.clips].sort((a, b) => a.start - b.start)[0]
    const i = views.findIndex((v) => v.clip === first)
    // con bandas, la losa que crece tampoco entra en ellas (los rótulos nunca quedan encima de la app)
    if (m.bands && pm.local / pm.dur > PROLOGUE_STEPS.edge[1]) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, m.bands.top, W, H - m.bands.top - m.bands.bottom)
      ctx.clip()
    }
    if (i >= 0) drawIconToWindow(ctx, m, { ...views[i], local: pm.local }, sources[i], assets, pm.dur)
    if (m.bands && pm.local / pm.dur > PROLOGUE_STEPS.edge[1]) ctx.restore()
  }
  // la pincelada se pinta después, sobre el cuadro entero (también las bandas: lleva el papel nuevo)
  let deferred: (() => void) | null = null
  // con bandas, las ventanas viven en el hueco entre ellas (los rótulos de las bandas nunca tapan la app)
  if (m.bands) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, m.bands.top, W, H - m.bands.top - m.bands.bottom)
    ctx.clip()
  }
  // V5 · un plano que entra desde una cartela: lo viejo es la cartela (congelada, y en el rack focus, desenfocándose)
  const fromCard = views.find((v) => v.fromCard !== undefined && v.clip.enter && v.local < v.clip.enter.dur)
  if (fromCard && m.chapters) {
    const q = clamp01(fromCard.local / fromCard.clip.enter!.dur)
    const focus = fromCard.clip.enter!.kind === 'focus'
    drawChapterCard(ctx, m, t, theme, stage, assets, { index: fromCard.fromCard!, blur: focus ? RACK_BLUR * ease('smooth', q) : 0, alpha: focus ? 1 - ease('smooth', clamp01((q - 0.15) / 0.7)) : 1 })
  }
  // V6 · el portátil: una sola escena para todos sus planos (la pantalla compone el plano y el que entra)
  // (el que entra con luz va dentro de la forma, en su cuarto: lo dibuja la luz)
  const onLaptop = views.map((v, i) => ({ v, src: sources[i] })).filter((x) => isLaptop(x.v) && !x.v.ghost && x.v.light === undefined)
  if (assets?.laptop && m.laptop && onLaptop.length) drawLaptop(ctx, m, t, onLaptop, assets, stage)
  views.forEach((v, i) => {
    // el portátil va en su propia pasada (drawLaptop); el que entra con luz, dentro de la forma
    if (pm || v.ghost || (isLaptop(v) && v.light === undefined)) return
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
    // «brush»: una pincelada barre el cuadro y descubre este plano detrás de su cabeza de ladrillo
    if (v.brush !== undefined && i > 0 && assets?.paint) {
      deferred = () => drawBrushWipe(ctx, m, t, v, sources[i], assets, newStage, stage, theme)
      return
    }
    // V5 · «light»: el plano nuevo entra con su papel dentro de una forma (anochecer, amanecer, arco, horizonte, diagonal)
    if (v.light !== undefined && (i > 0 || v.fromCard !== undefined)) {
      deferred = () => drawLightWipe(ctx, m, t, v, sources[i], assets, newStage, stage, theme)
      return
    }
    if (isLaptop(v)) return
    // V5 · whip pan: el plano desplazado y con desenfoque de movimiento en la dirección del barrido
    if (v.shift) {
      drawWhipped(ctx, m, t, v, sources[i], assets)
      return
    }
    // V5 · panel keynote o primer plano (con su desenfoque de rack focus)
    if (v.clip.layout) {
      drawPanel(ctx, m, t, v, sources[i], assets)
      return
    }
    if (v.blur && v.blur > 0.3) {
      ctx.save()
      ctx.filter = `blur(${((v.blur * H) / 1080).toFixed(1)}px)`
      drawWindow(ctx, m, t, v, sources[i], assets)
      drawCursor(ctx, m, v)
      ctx.restore()
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
  if (m.bands) ctx.restore()
  ;(deferred as (() => void) | null)?.()
  for (const v of views) if (v.shapeP !== undefined) drawShapeMatch(ctx, m, v, views, theme)
  if (assets?.paint) for (const mk of m.paint ?? []) drawPaintMark(ctx, m, mk, t, views, theme, assets.paint)
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
  // con el portátil, el aviso sale dentro de su pantalla (lo dibuja drawLaptop)
  if (!(m.laptop && views.some(isLaptop))) for (const n of m.notices ?? []) drawNotice(ctx, m, n, t, assets, theme)
  if (m.iconWave && assets?.cast) drawIconWave(ctx, m, ft, assets.cast)
  if (m.chapters) drawChapterCard(ctx, m, t, theme, stage, assets)
  // V6 · personajes que se dibujan a pincel: su propia capa, sobre el papel, las cartelas y el final, bajo los titulares
  if (assets?.drawn) drawDrawings(ctx, m, ft, theme, assets.drawn)
  for (const title of m.titles ?? []) if (title.layer !== 'under') drawTitle(ctx, m, title, t, theme, stage, assets)
  drawFlashes(ctx, m, t, stage)
}
