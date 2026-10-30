// V5 (composición keynote): geometría y tiempos puros que comparten el compositor (render.ts) y la hoja de efectos
// (cuesheet.ts): dónde va el panel de la interfaz, dónde el titular y cuándo entra cada palabra.
import { ease } from './ease.ts'
import type { Clip, Layout, Montage, Title } from './types.ts'
import { laptopTitleRect } from './laptop.ts'

/** Cada palabra de un rótulo V5 sube desde detrás de una máscara: tarda WORD_DUR s y la siguiente sale WORD_STAGGER
 *  s después. El subtítulo entra SUB_DELAY s tras la última palabra. */
export const WORD_STAGGER = 0.075
export const WORD_DUR = 0.42
export const SUB_DELAY = 0.12

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Vertical o cuadrado: el titular va arriba y el panel abajo (no cabe una columna al lado). */
const portrait = (m: Montage) => m.size[1] >= m.size[0] * 0.95
const square = (m: Montage) => portrait(m) && m.size[1] < m.size[0] * 1.15

/** El panel de la interfaz de un plano con `layout` (px del vídeo). En vertical el panel va abajo y el titular arriba. */
export function panelRect(m: Montage, layout: Layout): Rect {
  const [W, H] = m.size
  if (layout.kind === 'detail' || layout.kind === 'laptop') return { x: 0, y: 0, w: W, h: H }
  if (portrait(m)) {
    const mx = W * 0.05
    const h = H * (layout.height ?? (square(m) ? 0.6 : 0.52))
    return { x: mx, y: H - h - H * (square(m) ? 0.05 : 0.13), w: W - 2 * mx, h }
  }
  const w = W * (layout.size ?? 0.6)
  const h = H * (layout.height ?? 0.8)
  const mx = W * 0.04
  return { x: layout.side === 'right' ? W - mx - w : mx, y: (H - h) / 2, w, h }
}

/** Zona del titular `keynote`: el hueco al otro lado del panel (o arriba, en vertical). */
export function keynoteTextRect(m: Montage, side: 'left' | 'right'): Rect {
  const [W, H] = m.size
  if (portrait(m)) return square(m) ? { x: W * 0.06, y: H * 0.04, w: W * 0.88, h: H * 0.28 } : { x: W * 0.07, y: H * 0.1, w: W * 0.86, h: H * 0.24 }
  const w = W * 0.3
  return { x: side === 'left' ? W * 0.05 : W - W * 0.05 - w, y: H * 0.12, w, h: H * 0.76 }
}

/** Peso de la serif de los titulares V5 (más que el de la app: tienen que mandar en el cuadro). */
export const TITLE_WEIGHT = 600

/** Cuerpo de letra de cada estilo V5 (px). */
export function titleSize(m: Montage, title: Title): number {
  const [W, H] = m.size
  if (title.size) return title.size
  if (title.style === 'type') return Math.round(Math.min(W * 0.1, H * 0.16) * (portrait(m) ? 1.15 : 1))
  // keynote: el titular pesa (casi un tercio del alto en dos o tres líneas); en vertical, enorme
  return Math.round(portrait(m) ? W * (square(m) ? 0.085 : 0.115) : Math.min(W * 0.058, H * 0.105))
}

/** Palabras de un texto (las de *cursiva* sin asteriscos), como las cuenta el compositor. */
export function titleWords(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/\*/g, ''))
}

/** Instante en que empieza a subir cada palabra de un rótulo V5 (s del vídeo). */
export function wordTimes(title: Title, m?: Montage): number[] {
  const delay = title.instant ? -10 : 0
  const start = m ? titleStart(m, title) : title.start
  return titleWords(title.text).map((_, i) => start + delay + i * (title.stagger ?? WORD_STAGGER))
}

/** Cuánto tarda una entrada en dejar de enseñar el plano viejo (rack focus: cuando el viejo se ha apagado; luz: al
 *  acabar la forma). */
export function transitionClear(kind: string, dur: number): number {
  // cualquier entrada en la que todavía se ve el plano viejo: el titular espera a que deje de verse
  if (kind === 'focus') return dur * 0.85
  if (kind === 'whip') return dur * 0.6
  if (kind === 'shape') return dur * 0.55
  if (kind === 'cut' || kind === 'match') return 0
  return dur
}

/** Cuándo empieza de verdad un rótulo V5: si cae mientras un plano entra con rack focus, luz o barrido, espera a que la
 *  transición deje de enseñar el plano viejo (salvo `overlap`), así nunca se pinta encima de la interfaz anterior. */
export function titleStart(m: Montage, title: Title): number {
  if (title.overlap || title.instant || (title.style !== 'keynote' && title.style !== 'type')) return title.start
  for (const c of m.clips) {
    const k = c.enter?.kind
    if (!k || !c.enter) continue
    const clear = transitionClear(k, c.enter.dur)
    if (clear > 0 && title.start >= c.start - 0.08 && title.start < c.start + clear) return Math.min(title.start + title.dur - 0.6, c.start + clear)
  }
  return title.start
}

/** ¿Es un montaje V5? (composición keynote, papel con luz que respira). */
export function isV5(m: Montage): boolean {
  return !!(m.chapters || m.hook || m.iconWave || m.music?.wav || m.clips.some((c) => c.layout))
}

/** Saca un material (centro x, y y semitamaño hw, hh) fuera del claro R por el lado más cercano. */
export function avoidRect(x: number, y: number, hw: number, hh: number, R: Rect, frame?: { W: number; H: number }): [number, number] {
  const l = R.x - hw
  const r = R.x + R.w + hw
  const t = R.y - hh
  const b = R.y + R.h + hh
  if (x <= l || x >= r || y <= t || y >= b) return [x, y]
  const moves: [number, number, number][] = [
    [x - l, l, y],
    [r - x, r, y],
    [y - t, x, t],
    [b - y, x, b]
  ]
  // la salida más corta que deja el material DENTRO del cuadro (si hay alguna): el gancho no se queda vacío
  const fits = (m: [number, number, number]) => !frame || (m[1] - hw >= -hw * 0.3 && m[1] + hw <= frame.W + hw * 0.3 && m[2] - hh >= -hh * 0.3 && m[2] + hh <= frame.H + hh * 0.3)
  moves.sort((a, c) => a[0] - c[0])
  const best = moves.find(fits) ?? moves[0]
  return [best[1], best[2]]
}

/** Adónde convergen los materiales del gancho: al centro si no hay rótulo; si lo hay, al lado más cercano del claro. */
export function convergeTarget(x: number, y: number, W: number, H: number, R: Rect | null): [number, number] {
  if (!R) return [W / 2, H * 0.48]
  const cy = R.y + R.h / 2
  return x < R.x + R.w / 2 ? [Math.max(W * 0.04, R.x - W * 0.04), cy] : [Math.min(W * 0.96, R.x + R.w + W * 0.04), cy]
}

/** El claro que dejan los materiales alrededor de una caja de texto: la caja más un margen del 8 % del cuadro. */
export function clearRect(box: Rect, W: number, H: number, margin = 0.08): Rect {
  const mx = W * margin
  const my = H * margin
  return { x: box.x - mx, y: box.y - my, w: box.w + 2 * mx, h: box.h + 2 * my }
}

/** Palabras con su cursiva, igual que las lee el compositor (`*palabra*` o `*varias palabras.*`). */
export function titleWordInfo(text: string): { text: string; italic: boolean }[] {
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

/** Cuándo empieza a dibujarse el subrayado a pincel de un rótulo V5 (keynote o type): al acabar de subir su última
 *  palabra (+40 ms). null si no tiene palabra en cursiva. */
export function underlineTime(title: Title, m?: Montage): number | null {
  const ws = titleWordInfo(title.text)
  // opt-in: solo los rótulos que traen `underline: {}`
  if (!title.underline || !ws.some((w) => w.italic)) return null
  const times = wordTimes(title, m)
  return times[times.length - 1] + WORD_DUR + UNDERLINE_DELAY
}

/** Pausa entre la última palabra y el subrayado (s). */
export const UNDERLINE_DELAY = 0.04

/** Cuerpo mínimo de un titular keynote (fracción del alto): por debajo no manda en el cuadro. */
export const KEYNOTE_MIN = 0.08
/** Cuerpo mínimo (fracción del alto) y líneas máximas de los titulares keynote de un montaje. */
export function keynoteFit(m: Montage): { min: number; maxLines: number } {
  return { min: m.keynote?.min ?? KEYNOTE_MIN, maxLines: m.keynote?.maxLines ?? 3 }
}

/** El panel keynote más estrecho al que se puede llegar para que quepa el titular (fracción del ancho). */
export const PANEL_MIN = 0.52

/** Ancho aproximado de una palabra en la serif de los titulares (sin lienzo: para la geometría pura). */
export function estimateWidth(word: string, size: number): number {
  let w = 0
  for (const ch of word) w += /[ilj.,;:'!|ft]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.88 : /[A-Z]/.test(ch) ? 0.7 : 0.56
  // calibrado con la serif real del compositor (New York, 600): sale ~1,12 veces más ancha que estos factores
  return w * size * 1.12
}

/** Medida real de una palabra del titular (la pone el compositor con su lienzo); sin ella, `estimateWidth`. */
type WordMeasure = (word: string, italic: boolean, size: number) => number
let wordMeasure: WordMeasure | null = null
let panelCache = new WeakMap<Montage, WeakMap<Clip, Rect>>()
export function setWordMeasure(fn: WordMeasure | null): void {
  wordMeasure = fn
  panelCache = new WeakMap()
}

function overlaps(t: Title, c: Clip): boolean {
  return t.start < c.start + c.dur - 0.05 && t.start + t.dur > c.start + 0.05
}

/** El plano al que pertenece un titular: el último que ha empezado cuando empieza el titular (con 0,1 s de margen);
 *  no el anterior que acaba justo en ese instante (los redondeos de los tiempos en pulsos no deciden la columna). */
export function titleHost(m: Montage, title: Title): Clip | undefined {
  let best: Clip | undefined
  for (const c of m.clips) {
    if (title.start >= c.start - 0.1 && title.start < c.start + c.dur - 0.05 && (!best || c.start > best.start)) best = c
  }
  return best
}

/** El panel de un plano keynote, estrechado (hasta PANEL_MIN) si hace falta para que su titular quepa a cuerpo mínimo:
 *  primero se estrecha el panel, nunca se encoge el texto por debajo de KEYNOTE_MIN. */
export function clipPanelRect(m: Montage, clip: Clip): Rect {
  const layout = clip.layout!
  if (layout.kind !== 'keynote' || portrait(m)) return panelRect(m, layout)
  const [W, H] = m.size
  // los titulares que se ven durante el plano (el suyo y el que viene de un plano anterior y sigue en pantalla)
  const titles = (m.titles ?? []).filter((t) => t.style === 'keynote' && (titleHost(m, t) === clip || overlaps(t, clip)))
  if (!titles.length) return panelRect(m, layout)
  let cache = panelCache.get(m)
  if (!cache) panelCache.set(m, (cache = new WeakMap()))
  const cached = cache.get(clip)
  if (cached) return cached
  const fit = keynoteFit(m)
  const body = Math.round(H * fit.min)
  const est = titles.map((t) => titleWordInfo(t.text).map((w) => (wordMeasure ? wordMeasure(w.text, w.italic, body) : estimateWidth(w.text, body) * 1.04)))
  const space = wordMeasure ? wordMeasure(' ', false, body) : body * 0.26
  // columna = ancho − panel − márgenes (5 % de borde + 3,5 % de aire)
  const col = (size: number) => W - W * size - W * 0.04 - W * 0.05 - W * 0.035
  // a cuerpo mínimo, cada titular cabe en tres líneas como mucho y sin palabra corta suelta
  const fits = (size: number) => est.every((ws) => cleanBreaks(ws, space, col(size), fit.maxLines))
  const start = layout.size ?? 0.6
  let size = start
  while (!fits(size) && size > PANEL_MIN + 1e-9) size = Math.max(PANEL_MIN, size - 0.01)
  // si ni en el panel más estrecho parte limpio: lo justo para tres líneas, o si no para la palabra más larga
  // si no, lo justo para que quepa en tres líneas aunque sea con una palabra suelta (mejor que cuatro)
  if (!fits(size)) {
    const three = (sz: number) => est.every((ws) => cleanBreaks(ws, space, col(sz), fit.maxLines, false))
    const word = (sz: number) => est.every((ws) => ws.every((w) => w <= col(sz)))
    size = start
    while (!three(size) && size > PANEL_MIN + 1e-9) size = Math.max(PANEL_MIN, size - 0.01)
    if (!three(size)) {
      size = start
      while (!word(size) && size > PANEL_MIN + 1e-9) size = Math.max(PANEL_MIN, size - 0.01)
    }
  }
  const rect = panelRect(m, { ...layout, size })
  cache.set(clip, rect)
  return rect
}

/** La columna del titular keynote: el hueco entre el borde del cuadro y el panel del plano que lo acompaña (el keynote
 *  activo cuando empieza el titular), con aire a los dos lados. Sin plano, la columna por defecto. */
export function keynoteColumn(m: Montage, title: Title): Rect {
  const side = title.side ?? 'left'
  const host = titleHost(m, title)
  // V6: junto al portátil, el hueco que deja libre durante todo el titular (nunca encima de la pantalla)
  if (host?.layout?.kind === 'laptop' && m.laptop) return laptopColumn(m, title, side, host)
  const base = keynoteTextRect(m, side)
  if (portrait(m)) return base
  const [W] = m.size
  if (!host || host.layout?.kind !== 'keynote') return base
  // si el titular sigue en pantalla en planos siguientes (mismo lado), la columna es la que cabe en todos
  const side0 = host.layout.side
  const P = m.clips
    .filter((c) => c === host || (c.layout?.kind === 'keynote' && c.layout.side === side0 && overlaps(title, c)))
    .map((c) => clipPanelRect(m, c))
    .reduce((a, b) => (b.w > a.w ? b : a))
  const air = W * 0.035
  const x0 = side === 'left' ? W * 0.05 : P.x + P.w + air
  const x1 = side === 'left' ? P.x - air : W - W * 0.05
  return { x: x0, y: base.y, w: Math.max(W * 0.12, x1 - x0), h: base.h }
}

const laptopColumns = new WeakMap<Title, { key: string; rect: Rect }>()
function laptopColumn(m: Montage, title: Title, side: 'left' | 'right', host: Clip): Rect {
  const vp = m.takes[host.take]?.viewport ?? [1440, 900]
  const key = `${m.size.join('x')}:${title.start}:${title.dur}:${side}`
  const hit = laptopColumns.get(title)
  if (hit?.key === key) return hit.rect
  const rect = laptopTitleRect(m, m.laptop!, title.start, title.start + title.dur, side, vp[0] / vp[1])
  laptopColumns.set(title, { key, rect })
  return rect
}

/** El cuerpo que cabe: el de su estilo, rebajado lo justo para que la palabra más larga quepa en `width`.
 *  `measure(word, size)` da el ancho de una palabra a ese cuerpo. */
export function fitTitleSize(size: number, width: number, words: string[], measure: (w: string, size: number) => number): number {
  const widest = Math.max(1, ...words.map((w) => measure(w, size)))
  return widest > width ? Math.floor(size * (width / widest) * 0.98) : size
}

/** Una línea de una sola palabra corta en un titular de varias: «Filled / in.», «It knows / your / exams.».
 *  Arriba o en medio cuenta como suelta por debajo del 60 % de la columna; al final, por debajo del 45 % (la palabra
 *  de acento sola al final, «Mistakes, / explained.», es un recurso; «in.» no). */
function lonely(count: number, width: number, max: number, n: number, last: boolean): boolean {
  return n >= 2 && count === 1 && width < max * (last ? 0.45 : 0.6)
}

function bestBreaks(widths: number[], space: number, k: number, max: number): { breaks: number[]; cost: number; clean: boolean; fits: boolean } | null {
  const n = widths.length
  if (k < 1 || k > n) return null
  const lineW = (a: number, b: number) => widths.slice(a, b).reduce((x, y) => x + y, 0) + space * (b - a - 1)
  let best: { breaks: number[]; cost: number; clean: boolean; fits: boolean } | null = null
  const rec = (start: number, left: number, acc: number[]) => {
    if (left === 1) {
      const breaks = [...acc, start]
      const ends = [...breaks.slice(1), n]
      const ws = breaks.map((b, i) => lineW(b, ends[i]))
      const top = Math.max(...ws)
      const over = ws.reduce((o, w) => o + Math.max(0, w - max), 0)
      // líneas parejas (poco hueco respecto a la más larga) y castigo fuerte a la palabra corta sola, más aún al final
      let cost = ws.reduce((c, w) => c + ((top - w) / max) ** 2, 0) + top / max * 0.2
      let clean = over <= 1e-6
      // si no hay reparto que quepa, el que menos se sale (nunca el reparto a ciegas)
      if (!clean) cost += 100 + (over / max) * 20
      breaks.forEach((b, i) => {
        if (lonely(ends[i] - b, ws[i], max, n, i === breaks.length - 1)) {
          clean = false
          cost += i === breaks.length - 1 ? 3 : 2
        }
      })
      if (!best || cost < best.cost) best = { breaks, cost, clean, fits: over <= 1e-6 }
      return
    }
    for (let e = start + 1; e <= n - (left - 1); e++) rec(e, left - 1, [...acc, start])
  }
  rec(0, k, [])
  return best
}

/** Reparte palabras (con sus anchos) en `k` líneas que caben en `max`: líneas equilibradas y sin una palabra corta
 *  sola en una línea («Filled / in.») si se puede evitar. Devuelve los índices donde empieza cada línea. */
export function balanceBreaks(widths: number[], space: number, k: number, max: number): number[] {
  const n = widths.length
  if (k <= 1 || n <= k) return Array.from({ length: Math.min(k, n) }, (_, i) => i)
  return bestBreaks(widths, space, k, max)?.breaks ?? Array.from({ length: k }, (_, i) => i)
}

/** ¿Se puede partir el titular en `maxLines` líneas o menos, todas dentro de `max` y sin palabras cortas sueltas? */
export function cleanBreaks(widths: number[], space: number, max: number, maxLines = 3, strict = true): boolean {
  if (widths.some((w) => w > max + 1e-6)) return false
  for (let k = 1; k <= Math.min(maxLines, widths.length); k++) {
    const r = bestBreaks(widths, space, k, max)
    const fitsAll = k === 1 ? widths.reduce((a, b) => a + b, 0) + space * (widths.length - 1) <= max : !!r && r.fits
    // strict: sin palabras sueltas; si no, basta con que quepa en maxLines líneas
    if (r && (k === 1 ? fitsAll : strict ? r.clean : fitsAll)) return true
  }
  return false
}

/** Largo del desenfoque de movimiento de un whip pan (px) en el avance `p`: el desplazamiento del plano mientras el
 *  obturador está abierto (`shutter` en grados; 180° = medio fotograma), con la curva `inOut` del barrido. */
export function whipBlur(distance: number, dur: number, p: number, fps: number, shutter = 180): number {
  if (dur <= 0) return 0
  const h = 1e-3
  const a = Math.max(0, p - h)
  const b = Math.min(1, p + h)
  const speed = (distance * (ease('inOut', b) - ease('inOut', a))) / ((b - a) * dur) // px/s
  return speed * (shutter / 360) / fps
}

/** Medida del ancho de un texto (px) a un cuerpo, peso y familia: el compositor mide con su lienzo; en Node, estimado. */
export type TextMeasure = (text: string, size: number) => number
const measured: TextMeasure = (text, size) => text.split(/\s+/).reduce((a, w) => a + estimateWidth(w, size), 0) + size * 0.26 * Math.max(0, text.split(/\s+/).length - 1)

/** Cómo va el texto de una cartela de capítulo (lo usan el compositor y el hueco de los dibujos). */
export function cardLayout(m: Montage): { big: number; cy: number; rowY: number; fs: number; portrait: boolean } {
  const [W, H] = m.size
  const p = H >= W * 0.95
  return { big: Math.round(Math.min(W * (p ? 0.15 : 0.085), H * 0.15)), cy: H * (p ? 0.42 : 0.46), rowY: H * (p ? 0.8 : 0.86), fs: Math.round(Math.min(W, H) * 0.024), portrait: p }
}

/** Lo que ocupa el texto de una cartela (número, título y subtítulo, y la fila de capítulos): un dibujo no lo pisa. */
export function cardTextRects(m: Montage, card: { n: number; sub?: string }, measure: TextMeasure = measured): Rect[] {
  const [W] = m.size
  const L = cardLayout(m)
  const name = m.chapters?.names[card.n - 1] ?? ''
  const w = Math.max(measure(name, L.big), card.sub ? measure(card.sub, Math.round(L.big * 0.26)) : 0, measure('00', Math.round(L.big * 0.42)))
  const top = L.cy - L.big * 1.05 - L.big * 0.42
  const bottom = L.cy + L.big * 0.3 + (card.sub ? L.big * 0.62 + L.big * 0.1 : L.big * 0.3)
  const rows = L.portrait ? 2 : 1
  return [
    { x: W / 2 - w / 2, y: top, w, h: bottom - top },
    { x: W * 0.04, y: L.rowY - L.fs * 1.1, w: W * 0.92, h: L.fs * (1.6 + 2 * (rows - 1)) }
  ]
}

/** Lo que ocupan el icono del final y su «Aula» con el lema (V5: ≈ 12 % del alto, bajo el icono). */
export function finaleTextRects(m: Montage, measure: TextMeasure = measured): Rect[] {
  const f = m.finale
  if (!f) return []
  const [W, H] = m.size
  const S = f.size ?? 360
  const [ax, ay] = f.at ?? [0.5, 0.42]
  const ix = W * ax - S / 2
  const iy = H * ay - S / 2
  const out: Rect[] = [{ x: ix, y: iy, w: S, h: S }]
  if (f.title) {
    const size = Math.round(H * (H >= W * 0.95 ? 0.085 : 0.12))
    const ss = Math.round(size * 0.3)
    const w = Math.max(measure(f.title, size), f.sub ? measure(f.sub, ss) : 0)
    const base = iy + S + size * 1.05
    out.push({ x: W * ax - w / 2, y: base - size * 0.95, w, h: size * 0.95 + (f.sub ? ss * 2.3 : size * 0.3) })
  }
  return out
}
