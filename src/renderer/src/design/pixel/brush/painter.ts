// El pintor (PURO, sin DOM): pasa un tablero de píxeles a ilustración dibujada a mano. Rellenos planos y cálidos (el
// color de cada mancha, sin degradados, con el grano del papel apenas visible) y, encima, la línea a pincel: grosor que
// cambia con la presión y el ángulo, el pincel que se posa y se levanta (inicio y final de trazo visibles, con las cerdas
// que se abren y se secan al final), un temblor leve de la mano y esquinas en las que un trazo se pasa un pelo del otro.
// Los brillos, renglones y letras de un píxel son pinceladas de su color. Con semilla fija: el mismo fotograma sale
// siempre igual. `variant` (0, 1, 2) es «otro dibujo» del mismo fotograma: la mancha y la línea se mueven una pizca (el
// «line boil» de la animación a mano).
import type { Px } from '../anim'
import { createNoise, type Noise } from '../../paint/noise'
import { brushOutline, pressureProfile } from '../../paint/brush'
import { rngFrom, gauss, between } from '../../paint/random'
import { readBoard, resample, smoothPath, type InkPath, type Pt, type Reading } from './trace'
import { IVORY, SUMI, oklch, warm } from './palette'

export interface PaintTarget {
  /** Lado del lienzo en píxeles de dispositivo. */
  W: number
  /** Lado del tablero (sprite + márgenes), en píxeles del dibujo. */
  stride: number
  /** Píxeles de dispositivo por px de CSS (la línea tiene grosor de pincel: no crece sin fin con el dibujo). */
  dpr: number
  /** Papel oscuro: los pigmentos, un punto más luminosos. */
  dark: boolean
  /** Dibujo de la animación (0, 1, 2): la línea hierve un poco entre dibujos. */
  variant: number
}

export interface Painting {
  width: number
  height: number
  /** RGBA sin premultiplicar (lista para ImageData). */
  data: Uint8ClampedArray
}

/** Qué colores de un personaje son línea. */
export interface InkInfo {
  line: Set<string>
  /** Familias de color del personaje (cada color → su tono principal): relleno plano + sombreado suave. */
  family?: Map<string, string>
  /** Pasadas del filtro que ordena el sombreado tramado. */
  tidy?: number
  /** Pinceladas de color: todas (iconos), solo toques sueltos (compañeros) o cualquier línea fina (glifos). */
  strokes?: 'all' | 'dabs' | 'any'
  /** Colores de la interfaz tal cual (sin templar) y la línea en su propio color (los glifos de `Sprite`). */
  plain?: boolean
}

// ——— color ———
const toLin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const LIN8 = new Float32Array(256)
for (let i = 0; i < 256; i++) LIN8[i] = toLin(i)
const SRGB = new Uint8Array(4097)
for (let i = 0; i <= 4096; i++) {
  const v = i / 4096
  SRGB[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))
}
const enc = (v: number) => SRGB[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0]

interface Pigment {
  r: number
  g: number
  b: number
  /** Luminancia (lineal) y luz OKLab del pigmento: para el sombreado suave. */
  Y: number
  L: number
  /** Desfase de la textura (cada color, su propia mano). */
  ox: number
  oy: number
  /** Opacidad propia del color (#rrggbbaa: los colores de la interfaz con transparencia). */
  a: number
}
const pigments = new Map<string, Pigment>()
/** El pigmento de un color: templado como los del pixel art, o tal cual (`plain`: colores de la interfaz). */
function pigmentOf(hex: string, dark: boolean, plain = false): Pigment {
  const key = hex + (dark ? 'd' : '') + (plain ? 'p' : '')
  let p = pigments.get(key)
  if (!p) {
    const w = plain ? hex.slice(0, 7) : warm(hex, dark)
    const n = parseInt(w.slice(1, 7), 16)
    const h = Math.imul(parseInt(hex.slice(1, 7), 16), 2654435761) >>> 0
    const r = LIN8[n >> 16]
    const g = LIN8[(n >> 8) & 255]
    const b = LIN8[n & 255]
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const a = hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1
    p = { r, g, b, Y, L: Math.cbrt(Math.max(1e-6, Y)), ox: h % 23, oy: (h >>> 8) % 19, a }
    pigments.set(key, p)
  }
  return p
}
const linOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return [LIN8[n >> 16], LIN8[(n >> 8) & 255], LIN8[n & 255]]
}
const SUMI_LIN = linOf(SUMI)
const sumiPigment: Pigment = { r: SUMI_LIN[0], g: SUMI_LIN[1], b: SUMI_LIN[2], Y: 0.02, L: 0.27, ox: 0, oy: 0, a: 1 }
const IVORY_LIN = linOf(IVORY)

// ——— el perfil de un píxel desenfocado (una caja de 1 px vista con desenfoque gaussiano σ) ———
const SIGMA = 0.42
const G_RES = 512
const G_SPAN = 2
const G = new Float32Array(G_SPAN * 2 * G_RES + 2)
function erf(x: number): number {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a))
}
for (let i = 0; i < G.length; i++) {
  const t = i / G_RES - G_SPAN
  const q = SIGMA * Math.SQRT2
  G[i] = 0.5 * (erf((t + 0.5) / q) - erf((t - 0.5) / q))
}
const gAt = (t: number) => (t <= -G_SPAN || t >= G_SPAN ? 0 : G[((t + G_SPAN) * G_RES) | 0])
/** Pendiente de la pertenencia en un borde (por píxel de dibujo): pasa diferencias de pertenencia a distancias. */
const SLOPE = (2 * 0.3989) / SIGMA

// ——— campos: el papel (por tamaño de lienzo) y el pulso de la mano (también por variante) ———
interface Paper {
  /** Altura del grano del papel (0–1): el pincel seco solo toca las crestas. */
  height: Float32Array
  /** Variación lentísima del valor del relleno (gouache plana, no perfecta). */
  tone: Float32Array
}
interface Hand {
  wx: Float32Array
  wy: Float32Array
  reach: Float32Array
  noise: Noise
}
const paperCache = new Map<string, Paper>()
const handCache = new Map<string, Hand>()
const MAX_FIELDS = 16

function remember<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key)
  if (v) {
    map.delete(key)
    map.set(key, v)
    return v
  }
  v = make()
  map.set(key, v)
  if (map.size > MAX_FIELDS) map.delete(map.keys().next().value as string)
  return v
}

function paperFor(W: number, k: number, dpr: number): Paper {
  return remember(paperCache, `${W}|${k.toFixed(3)}|${dpr}`, () => {
    const n = createNoise(0x41a7)
    const n2 = createNoise(0x2f6b)
    const N = W * W
    const height = new Float32Array(N)
    const tone = new Float32Array(N)
    // el grano va en px de CSS: es el mismo papel para un dibujo grande o pequeño
    const g = dpr
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        height[i] = n2.at(x / (1.1 * g), y / (1.1 * g)) * 0.55 + n.at(x / (3.2 * g) + 7, y / (3.2 * g)) * 0.3 + n.hash(x, y) * 0.15
        tone[i] = n.fbm((x + 0.5) / k / 3, (y + 0.5) / k / 3, 2) - 0.5
      }
    return { height, tone }
  })
}

function handFor(W: number, k: number, variant: number): Hand {
  return remember(handCache, `${W}|${k.toFixed(3)}|${variant}`, () => {
    const still = createNoise(0x7e57)
    const boil = createNoise(0x1b01 + variant * 7919)
    const N = W * W
    const wx = new Float32Array(N)
    const wy = new Float32Array(N)
    const reach = new Float32Array(N)
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const bx = (x + 0.5) / k
        const by = (y + 0.5) / k
        // el pulso de la mano (fijo) y el del dibujo (cambia con la variante: el «hervor»)
        wx[i] = (still.fbm(bx / 1.7, by / 1.7, 2) - 0.5) * 0.15 + (boil.fbm(bx / 1.4 + 5, by / 1.4, 2) - 0.5) * 0.1
        wy[i] = (still.fbm(bx / 1.7 + 31, by / 1.7 - 17, 2) - 0.5) * 0.15 + (boil.fbm(bx / 1.4 - 9, by / 1.4 + 3, 2) - 0.5) * 0.1
        // hasta dónde llega el relleno: suele quedarse en la línea; a ratos se queda corto y asoma el papel
        reach[i] = 0.06 + (still.fbm(bx / 2.2 - 50, by / 2.2 + 20, 2) - 0.5) * 0.3 + (boil.at(bx / 1.8 + 70, by / 1.8) - 0.5) * 0.08
      }
    return { wx, wy, reach, noise: boil }
  })
}

/** Pinta el tablero `px` (de `stride`×`stride`) en un lienzo de `W`×`W`. */
export function paintBoard(px: Px[], info: InkInfo, t: PaintTarget): Painting {
  const { W, stride: S, variant, dpr } = t
  const k = W / S
  const P = paperFor(W, k, dpr)
  const H = handFor(W, k, variant)
  const R = readBoard(px, S, info.line, { family: info.family, tidy: info.tidy, strokes: info.strokes })
  const out = new Uint8ClampedArray(W * W * 4)
  fills(out, R, info, t, k, P, H)
  // en los glifos de la interfaz la línea va en su propio color (una pincelada más), no en tinta
  const paths = info.plain ? R.paths.map((p) => (p.kind === 'ink' ? { ...p, kind: 'color' as const } : p)) : R.paths
  for (const p of paths) if (p.kind === 'color') stroke(out, p, t, k, P, H, info.plain)
  inkLines(out, paths.filter((p) => p.kind === 'ink'), t, k, P, H)
  return { width: W, height: W, data: out }
}

const sstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

/** Los rellenos: cada color, su mancha plana, hasta la línea (más o menos: lo pinta una mano). */
function fills(out: Uint8ClampedArray, R: Reading, info: InkInfo, t: PaintTarget, k: number, P: Paper, H: Hand): void {
  const { W, stride: S, dark } = t
  // la tinta en masa (ojos, pupilas) es la misma tinta de las líneas
  const pig = R.colors.map((c) => (c ? (info.line.has(c) && !info.plain ? sumiPigment : pigmentOf(c, dark, info.plain)) : null))
  const ids = new Int16Array(27)
  const ws = new Float32Array(27)
  const aa = k / SLOPE
  const acc = new Float32Array(4)
  const soft = softShade(R, S)
  const shade = (id: number, i: number, x: number, y: number, bx: number, by: number, cover: number) => {
    const p = pig[id]!
    const j = Math.min(W - 1, y + p.oy) * W + Math.min(W - 1, x + p.ox)
    // gouache plana: el valor apenas respira; donde el grano del papel es hondo, el pigmento casi no llega
    let v = 1 + 0.045 * P.tone[j]
    let r = p.r
    let g = p.g
    let b = p.b
    // la luz y la sombra del pixel art, como una veladura suave del mismo pigmento
    const sh = soft ? shadeAt(soft, R, S, id, bx, by) : 0
    if (sh) {
      const L2 = Math.max(0.08, Math.min(0.99, p.L + sh * 0.7))
      const Y2 = L2 * L2 * L2
      if (Y2 < p.Y) v *= Y2 / p.Y
      else {
        const tt = (Y2 - p.Y) / Math.max(1e-4, 1 - p.Y)
        r += (1 - r) * tt
        g += (1 - g) * tt
        b += (1 - b) * tt
      }
    }
    const a = cover * p.a * (0.985 - 0.2 * sstep(0.18, 0.04, P.height[i]))
    acc[0] += r * v * a
    acc[1] += g * v * a
    acc[2] += b * v * a
    acc[3] += a
  }
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const bx = (x + 0.5) / k + H.wx[i]
      const by = (y + 0.5) / k + H.wy[i]
      const cx = Math.floor(bx)
      const cy = Math.floor(by)
      let n = 0
      for (let dj = -1; dj <= 1; dj++) {
        const yy = cy + dj
        const gy = gAt(by - yy - 0.5)
        if (gy < 1e-4) continue
        for (let di = -1; di <= 1; di++) {
          const xx = cx + di
          const w = gAt(bx - xx - 0.5) * gy
          if (w < 1e-5) continue
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) {
            let m = 0
            while (m < n && ids[m] !== 0) m++
            if (m === n) {
              ids[n] = 0
              ws[n++] = 0
            }
            ws[m] += w
            continue
          }
          const c = (yy * S + xx) * 3
          for (let q = 0; q < 3; q++) {
            const f = R.wt[c + q]
            if (f <= 0) break
            const id = R.lab[c + q]
            let m = 0
            while (m < n && ids[m] !== id) m++
            if (m === n) {
              ids[n] = id
              ws[n++] = 0
            }
            ws[m] += w * f
          }
        }
      }
      // los dos colores que más pesan aquí (el papel lleva además el «alcance» del relleno)
      let a = -1
      let wa = -1e9
      let b = -1
      let wb = -1e9
      let hasPaper = false
      for (let m = 0; m <= n; m++) {
        let id: number
        let w: number
        if (m === n) {
          if (hasPaper) break
          id = 0
          w = H.reach[i]
        } else {
          id = ids[m]
          w = id === 0 ? ws[m] + H.reach[i] : ws[m]
          if (id === 0) hasPaper = true
        }
        if (w > wa) {
          b = a
          wb = wa
          a = id
          wa = w
        } else if (w > wb) {
          b = id
          wb = w
        }
      }
      if (a <= 0 && b <= 0) continue
      const cover = Math.min(1, 0.5 + (wa - wb) * aa)
      acc.fill(0)
      if (a > 0) shade(a, i, x, y, bx, by, cover)
      if (b > 0 && cover < 1) shade(b, i, x, y, bx, by, 1 - cover)
      let A = acc[3]
      if (A <= 0.002) continue
      // dos rellenos lejanos que se tocan (rosa y azul): sin mezcla violeta en la costura, se queda el que más pesa
      if (a > 0 && b > 0 && cover < 1 && cover > 0 && isViolet(acc[0] / A, acc[1] / A, acc[2] / A)) {
        acc.fill(0)
        shade(cover >= 0.5 ? a : b, i, x, y, bx, by, 1)
        A = acc[3]
      }
      const o = i * 4
      out[o] = enc(acc[0] / A)
      out[o + 1] = enc(acc[1] / A)
      out[o + 2] = enc(acc[2] / A)
      out[o + 3] = Math.round(Math.min(1, A) * 255)
    }
  }
}

/** El sombreado de cada celda, desenfocado entre celdas de su mismo relleno (sombras suaves, sin escalones). */
function softShade(R: Reading, S: number): Float32Array | null {
  let any = false
  for (let i = 0; i < S * S; i++) if (R.shade[i]) any = true
  if (!any) return null
  const out = new Float32Array(S * S)
  const g = [0.4, 0.75, 1, 0.75, 0.4]
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const id = R.wt[i * 3] === 1 ? R.lab[i * 3] : -1
      if (id <= 0) continue
      let sum = 0
      let wsum = 0
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue
          const j = ny * S + nx
          if (R.wt[j * 3] !== 1 || R.lab[j * 3] !== id) continue
          const w = g[dx + 2] * g[dy + 2]
          sum += R.shade[j] * w
          wsum += w
        }
      out[i] = wsum ? sum / wsum : 0
    }
  return out
}

/** El sombreado suave en un punto del tablero, para el relleno `id` (interpolado entre las celdas de ese relleno). */
function shadeAt(soft: Float32Array, R: Reading, S: number, id: number, bx: number, by: number): number {
  const fx = bx - 0.5
  const fy = by - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  let sum = 0
  let wsum = 0
  for (let dy = 0; dy <= 1; dy++)
    for (let dx = 0; dx <= 1; dx++) {
      const x = x0 + dx
      const y = y0 + dy
      if (x < 0 || y < 0 || x >= S || y >= S) continue
      const j = y * S + x
      if (R.wt[j * 3] !== 1 || R.lab[j * 3] !== id) continue
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) + 1e-4
      sum += soft[j] * w
      wsum += w
    }
  return wsum ? sum / wsum : 0
}

// ——— el pincel ———

/** Grosor (px de dispositivo) de la línea de tinta o de una pincelada de color, para el tamaño del dibujo. */
function lineWidth(kind: InkPath['kind'], k: number, dpr: number): number {
  const kc = k / dpr
  const css = kind === 'ink' ? Math.min(Math.max(0.88 * kc, 0.95), 0.95 + 0.24 * kc) : Math.min(Math.max(0.92 * kc, 0.9), 1.2 + 0.45 * kc)
  return css * dpr
}

/** Un trazo listo para pintar: puntos (px de dispositivo), normal, grosor y carga de pintura a lo largo. */
interface Sweep {
  x: Float32Array
  y: Float32Array
  nx: Float32Array
  ny: Float32Array
  w: Float32Array
  /** Posición a lo largo (0–1). */
  t: Float32Array
  n: number
  len: number
  /** Extremos libres (el pincel se posa / se levanta aquí). */
  freeStart: boolean
  freeEnd: boolean
  seed: number
}

const stillHand = createNoise(0x5a17)

/** La mano: el pulso fijo y, mezclado, el del dibujo de cada fotograma (el «hervor» de la línea). */
function handNoise(boil: Noise): Noise {
  const still = stillHand
  return {
    at: (x, y) => still.at(x, y) * 0.72 + boil.at(x, y) * 0.28,
    fbm: (x, y, o) => still.fbm(x, y, o) * 0.72 + boil.fbm(x, y, o) * 0.28,
    hash: (x, y) => still.hash(x, y)
  }
}

/**
 * El recorrido del pincel por un trazo, con EL PINCEL DE PAINT-UI (`brushOutline`: presión, temblor de la mano y variación
 * del grosor; la misma mano que la marca de Aula y el icono sumi-e). Aquí se decide la presión: el pincel se posa romo y se
 * levanta afilándose en las puntas libres; en las esquinas, el trazo se pasa un pelo del otro.
 */
function sweepOf(p: InkPath, k: number, dpr: number, boil: Noise): Sweep {
  const base = lineWidth(p.kind, k, dpr) * (p.weight ?? 1)
  const seed = Math.round(p.pts[0].x * 131 + p.pts[0].y * 977 + p.pts.length * 7)
  let pts = p.pts
  // un anillo también es una pincelada: se posa en un punto y acaba pasándose un poco del inicio
  if (p.closed && pts.length > 2) {
    const s = seed % pts.length
    const m = pts.length
    // …y al cerrar se pasa un poco, ya algo abierto hacia fuera (se ve dónde empezó y dónde acabó)
    const cx = pts.reduce((a, q) => a + q.x, 0) / m
    const cy = pts.reduce((a, q) => a + q.y, 0) / m
    const tail = [0, 1, 2].map((j) => {
      const q = pts[(s + j) % m]
      const d = Math.hypot(q.x - cx, q.y - cy) || 1
      const o = 0.12 * (j + 1)
      return { x: q.x + ((q.x - cx) / d) * o, y: q.y + ((q.y - cy) / d) * o }
    })
    pts = [...pts.slice(s), ...pts.slice(0, s), ...tail]
  }
  let sm = pts.length === 1 ? [pts[0], { x: pts[0].x + 0.02, y: pts[0].y + 0.04 }] : smoothPath(pts, false, p.kind === 'color' ? 0.55 : 0.85, p.kind === 'color' ? 1 : 2)
  const over = Math.min(0.24, (1.6 * dpr) / k)
  const extend = (a: Pt, b: Pt) => {
    const l = Math.hypot(a.x - b.x, a.y - b.y) || 1
    return { x: a.x + ((a.x - b.x) / l) * over, y: a.y + ((a.y - b.y) / l) * over }
  }
  if (sm.length > 1 && p.start === 'corner') sm = [extend(sm[0], sm[1]), ...sm]
  if (sm.length > 1 && p.end === 'corner') sm = [...sm, extend(sm[sm.length - 1], sm[sm.length - 2])]
  // a px de dispositivo, suave (Catmull-Rom) y con paso regular
  const dense = resample(sm, false, Math.min(0.2, 0.8 / k)).map((q) => ({ x: q.x * k, y: q.y * k }))
  const len = dense.reduce((s, q, i) => (i ? s + Math.hypot(q.x - dense[i - 1].x, q.y - dense[i - 1].y) : 0), 0)
  const freeStart = p.start === 'free' || p.closed
  const freeEnd = p.end === 'free' || p.closed
  const lenB = len / k
  // presión: la de PAINT-UI en las puntas libres (se posa al 55 %, se levanta hasta el 18 %), escalada a lo que mide el trazo
  const attack = Math.min(0.3, 0.55 / Math.max(0.3, lenB))
  const liftAt = Math.max(0.45, 1 - 1.25 / Math.max(0.3, lenB))
  const soft = p.kind === 'color' ? 0.4 : 0
  // en una punta libre se posa (romo, al 55 %) o se levanta (hasta el 18 %); unida a otro trazo, ni lo uno ni lo otro
  const prof = pressureProfile(freeStart ? 0.55 + soft : 1, attack, freeEnd ? liftAt : 1, 0.18 + soft)
  const corner = (d: number) => 0.6 + 0.4 * sstep(0, (over * 2 + 0.02) / Math.max(0.3, lenB), d)
  // y la mano no aprieta igual todo el rato: el trazo engorda y adelgaza despacio
  const swell = (t: number) => 1 + 0.5 * (stillHand.fbm((t * lenB) / 2.2 + seed * 0.01, 4.4, 2) - 0.5)
  const pressure = (t: number) => prof(t) * swell(t) * (p.start === 'corner' ? corner(t) : 1) * (p.end === 'corner' ? corner(1 - t) : 1)
  const step = Math.max(0.5, Math.min(1.2, k * 0.12))
  const { spine } = brushOutline(dense, { width: base, pressure, tremor: Math.max(0.12, k * 0.045), tremorScale: k * 1.7, jitter: 0.16, step }, handNoise(boil))
  const n = spine.c.length
  const sw: Sweep = { x: new Float32Array(n), y: new Float32Array(n), nx: new Float32Array(n), ny: new Float32Array(n), w: new Float32Array(n), t: new Float32Array(n), n, len, freeStart, freeEnd, seed }
  for (let i = 0; i < n; i++) {
    sw.x[i] = spine.c[i].x
    sw.y[i] = spine.c[i].y
    sw.nx[i] = spine.n[i].x
    sw.ny[i] = spine.n[i].y
    sw.w[i] = Math.max(0.9, spine.w[i])
    sw.t[i] = n > 1 ? i / (n - 1) : 0
  }
  if (n === 1 || !n) {
    // un toque suelto
    const q = dense[0]
    return { x: Float32Array.of(q.x), y: Float32Array.of(q.y), nx: Float32Array.of(0), ny: Float32Array.of(1), w: Float32Array.of(base * 1.15), t: Float32Array.of(0), n: 1, len: 0, freeStart, freeEnd, seed }
  }
  return sw
}

/** Cuánto se seca el pincel al final (las cerdas de PAINT-UI abren huecos de papel); el trazo fino no se nota. */
interface BrushLook {
  dry: number
  tooth: number
  lo: number
  hi: number
}
const INK_LOOK: BrushLook = { dry: 0.42, tooth: 0.26, lo: 0.2, hi: 0.42 }
const COLOR_LOOK: BrushLook = { dry: 0.3, tooth: 0.22, lo: 0.18, hi: 0.4 }

interface Coverage {
  cov: Float32Array
  x0: number
  y0: number
  w: number
  h: number
}

/**
 * Cobertura de un trazo: la silueta de la pincelada (la unión de discos a lo largo del eje, igual que el polígono de
 * `brushOutline`) y, si es ancha y acaba suelta, las cerdas de PAINT-UI: rayas finas de papel que casi no se ven al
 * principio y se abren al final, donde se acaba la tinta.
 */
function coverage(sw: Sweep, W: number, look: BrushLook, noise: Noise): Coverage | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let wMax = 0
  for (let i = 0; i < sw.n; i++) {
    const r = sw.w[i] * 0.6 + 2
    x0 = Math.min(x0, sw.x[i] - r)
    y0 = Math.min(y0, sw.y[i] - r)
    x1 = Math.max(x1, sw.x[i] + r)
    y1 = Math.max(y1, sw.y[i] + r)
    wMax = Math.max(wMax, sw.w[i])
  }
  x0 = Math.max(0, Math.floor(x0))
  y0 = Math.max(0, Math.floor(y0))
  x1 = Math.min(W - 1, Math.ceil(x1))
  y1 = Math.min(W - 1, Math.ceil(y1))
  if (x1 < x0 || y1 < y0) return null
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const cov = new Float32Array(bw * bh)
  const disc = (cx: number, cy: number, r: number, val: number, into: Float32Array) => {
    const ax = Math.max(x0, Math.floor(cx - r - 1))
    const bx = Math.min(x1, Math.ceil(cx + r + 1))
    const ay = Math.max(y0, Math.floor(cy - r - 1))
    const by = Math.min(y1, Math.ceil(cy + r + 1))
    for (let y = ay; y <= by; y++) {
      const dy = y + 0.5 - cy
      for (let x = ax; x <= bx; x++) {
        const dx = x + 0.5 - cx
        const c = Math.min(1, Math.max(0, r - Math.sqrt(dx * dx + dy * dy) + 0.5)) * val
        const j = (y - y0) * bw + (x - x0)
        if (c > into[j]) into[j] = c
      }
    }
  }
  for (let i = 0; i < sw.n; i++) disc(sw.x[i], sw.y[i], sw.w[i] / 2, 1, cov)
  // las cerdas (como `bristles` de PAINT-UI): solo en trazos anchos con final suelto
  if (sw.freeEnd && wMax >= 3.2 && sw.n > 8) {
    const gaps = new Float32Array(bw * bh)
    const r = rngFrom(sw.seed * 2654435761)
    const count = Math.max(4, Math.round(wMax * 1.4))
    for (let kk = 0; kk < count; kk++) {
      const v = (kk + 0.5) / count - 0.5 + gauss(r) * 0.03
      const thick = between(r, 0.35, 0.8)
      for (let i = 1; i < sw.n; i++) {
        const t = sw.t[i]
        const gap = noise.at(i / 4 + kk * 11.3, kk * 2.7) + Math.pow(t, 2.2) * look.dry * 1.1 - 0.95 + Math.abs(v) * 0.5 * look.dry
        if (gap <= 0) continue
        disc(sw.x[i] + sw.nx[i] * v * sw.w[i], sw.y[i] + sw.ny[i] * v * sw.w[i], thick / 2 + 0.15, Math.min(1, gap * 2.2), gaps)
      }
    }
    for (let j = 0; j < cov.length; j++) cov[j] *= 1 - gaps[j]
  }
  return { cov, x0, y0, w: bw, h: bh }
}

/** Pinta `color` (lineal) con opacidad `ia` sobre el píxel `i` del lienzo. */
function over(out: Uint8ClampedArray, i: number, r: number, g: number, b: number, ia: number): void {
  if (ia <= 0.002) return
  const o = i * 4
  const da = out[o + 3] / 255
  const A = ia + da * (1 - ia)
  const k = da * (1 - ia)
  const dr = LIN8[out[o]]
  const dg = LIN8[out[o + 1]]
  const db = LIN8[out[o + 2]]
  let R = (r * ia + dr * k) / A
  let G = (g * ia + dg * k) / A
  let B = (b * ia + db * k) / A
  // en el borde entre dos colores lejanos (un rosa sobre un azul) la mezcla daría violeta: se queda el que más pesa
  if (k > 0.02 && ia < 0.98 && isViolet(R, G, B)) {
    if (ia >= k) [R, G, B] = [r, g, b]
    else [R, G, B] = [dr, dg, db]
  }
  out[o] = enc(R)
  out[o + 1] = enc(G)
  out[o + 2] = enc(B)
  out[o + 3] = Math.round(A * 255)
}

/** ¿Un color (lineal) cae en los violetas? (tono OKLCH entre el azul y el rosa, con color de verdad). Nada violeta. */
export function isViolet(r: number, g: number, b: number): boolean {
  // descarte rápido: sin azul por encima del verde no hay violeta
  if (b <= g * 1.05 || r <= g * 1.02) return false
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, Bb)
  if (C < 0.04) return false
  const h = ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360
  return h > 280 && h < 336
}

/** La cobertura a opacidad: donde hay poca pintura, solo agarra en las crestas del papel (pincel seco). */
function alphaOf(c: number, h: number, look: BrushLook): number {
  return sstep(look.lo, look.hi, c + look.tooth * (h - 0.5))
}

/** Una pincelada de color (brillo, renglón, letra): plana, del color templado. */
function stroke(out: Uint8ClampedArray, p: InkPath, t: PaintTarget, k: number, P: Paper, H: Hand, plain = false): void {
  const { W, dpr, dark } = t
  const c = coverage(sweepOf(p, k, dpr, H.noise), W, COLOR_LOOK, stillHand)
  if (!c) return
  const pg = pigmentOf(p.color, dark, plain)
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const v = c.cov[y * c.w + x]
      if (v <= 0) continue
      const i = (y + c.y0) * W + x + c.x0
      over(out, i, pg.r, pg.g, pg.b, 0.97 * pg.a * (p.alpha ?? 1) * alphaOf(v, P.height[i], COLOR_LOOK))
    }
}

/** La línea de tinta, encima de todo (una sola tinta: la misma mano y el mismo tintero para todo). */
function inkLines(out: Uint8ClampedArray, paths: InkPath[], t: PaintTarget, k: number, P: Paper, H: Hand): void {
  if (!paths.length) return
  const { W, dpr, dark } = t
  const cov = new Float32Array(W * W)
  const light = new Uint8Array(W * W)
  const amul = new Float32Array(W * W)
  for (const p of paths) {
    const c = coverage(sweepOf(p, k, dpr, H.noise), W, INK_LOOK, stillHand)
    if (!c) continue
    const ivory = dark && p.edge ? 1 : 0
    const pa = p.alpha ?? 1
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const v = c.cov[y * c.w + x]
        const i = (y + c.y0) * W + x + c.x0
        if (v > cov[i]) {
          cov[i] = v
          light[i] = ivory
          amul[i] = pa
        }
      }
  }
  for (let i = 0; i < W * W; i++) {
    if (cov[i] <= 0) continue
    const [r, g, b] = light[i] ? IVORY_LIN : SUMI_LIN
    over(out, i, r, g, b, amul[i] * (light[i] ? 0.9 : 0.97) * alphaOf(cov[i], P.height[i], INK_LOOK))
  }
}

// ——— dibujos (lo que no sale de un sprite: los personajes dibujados desde cero, la medalla, la llama…) ———

/** Una mancha de color plana: curva cerrada suave por sus puntos (en unidades del dibujo). */
export interface DrawShape {
  /** Color (se templa como los del pixel art) o 'ink' (la tinta de las líneas: ojos, pupilas). */
  fill: string
  pts: [number, number][]
  /** Polígono de esquinas vivas (una cinta cortada) en vez de curva suave. */
  sharp?: boolean
  /** Opacidad (0–1): un cristal, un brillo, un fantasma que se desvanece. */
  alpha?: number
  /** Sin desplazamiento respecto a la línea (detalles pequeños que tienen que caer justo). */
  exact?: boolean
}
/** Una línea a pincel por sus puntos (abierta salvo `closed`). */
export interface DrawLine {
  pts: [number, number][]
  closed?: boolean
  /** Grosor relativo (1 = la línea de siempre). */
  weight?: number
  /** Sin color: tinta. Con color: pincelada de ese color. */
  color?: string
  /** Va por la silueta (en papel oscuro, en marfil, salvo que el cuerpo sea claro). */
  edge?: boolean
  /** Opacidad de la pincelada (0–1). */
  alpha?: number
  /** Esquinas vivas: cada lado es su pincelada (y se pasa un pelo en la esquina), como al dibujar un cristal o un rayo. */
  corners?: boolean
}
/** Un grupo del dibujo (el personaje, un efecto): sus manchas y, encima, sus líneas; con su sitio y su espejo. */
export interface DrawGroup {
  shapes: DrawShape[]
  lines: DrawLine[]
  dx?: number
  dy?: number
  /** Espejo horizontal respecto al centro del sprite. */
  flip?: boolean
  /** Cuerpo claro (una cara crema, un fantasma): en papel oscuro su silueta se queda en tinta. */
  light?: boolean
  /** Opacidad de todo el grupo. */
  alpha?: number
}
/** Un dibujo en un tablero de `stride` unidades: manchas (en orden) y, encima, líneas. */
export interface Drawing {
  stride: number
  shapes: DrawShape[]
  lines: DrawLine[]
}

/** Pinta un dibujo suelto (la medalla, la llama). */
export function paintDrawing(d: Drawing, t: PaintTarget): Painting {
  return paintScene([{ shapes: d.shapes, lines: d.lines }], { size: d.stride - 4, margin: 2 }, t)
}

/**
 * Pinta una escena: grupos en orden (cada uno, manchas y luego líneas), en un sprite de `size` unidades con `margin` de
 * aire alrededor. Misma mano que los sprites: rellenos planos cortados a mano, un pelo fuera de registro, papel y pincel.
 */
export function paintScene(groups: DrawGroup[], box: { size: number; margin: number }, t: PaintTarget): Painting {
  const { W, variant, dpr, dark } = t
  const stride = box.size + box.margin * 2
  const k = W / stride
  const P = paperFor(W, k, dpr)
  const H = handFor(W, k, variant)
  const out = new Uint8ClampedArray(W * W * 4)
  const boil = H.noise
  for (const g of groups) {
    const map = (x: number, y: number): [number, number] => [(g.flip ? box.size - x : x) + (g.dx ?? 0) + box.margin, y + (g.dy ?? 0) + box.margin]
    const ga = g.alpha ?? 1
    // ¿cuerpo claro? (lo dice el grupo o su mancha más grande): en papel oscuro, su silueta se queda en tinta
    const light = g.light ?? lightBody(g.shapes)
    for (const sh of g.shapes) shapeFill(out, sh, sh.pts.map(([x, y]) => map(x, y)), W, k, dark, P, boil, ga)
    const toPaths = (l: DrawLine, kind: InkPath['kind']): InkPath[] => {
      const pts = l.pts.map(([x, y]) => map(x, y)).map(([x, y]) => ({ x, y }))
      const base = { color: l.color ?? SUMI, kind, edge: l.edge && !light, weight: l.weight, alpha: (l.alpha ?? 1) * ga }
      if (l.corners && pts.length > 2) {
        // un lado, una pincelada
        const sides: InkPath[] = []
        const n = l.closed ? pts.length : pts.length - 1
        for (let i = 0; i < n; i++) sides.push({ ...base, pts: resample([pts[i], pts[(i + 1) % pts.length]], false, 0.45), closed: false, start: 'corner', end: 'corner' })
        return sides
      }
      // densa antes de suavizar: el suavizado de la mano no debe encoger la curva
      return [{ ...base, pts: resample(pts, !!l.closed, 0.45), closed: !!l.closed, start: 'free', end: 'free' }]
    }
    for (const l of g.lines) if (l.color) for (const p of toPaths(l, 'color')) stroke(out, p, t, k, P, H)
    inkLines(out, g.lines.filter((l) => !l.color).flatMap((l) => toPaths(l, 'ink')), t, k, P, H)
  }
  return { width: W, height: W, data: out }
}

/** ¿Es claro el cuerpo de un grupo? (la luz OKLab de su mancha más grande, ya templada). */
function lightBody(shapes: DrawShape[]): boolean {
  let best: DrawShape | null = null
  let bestA = 0
  for (const sh of shapes) {
    if (sh.fill === 'ink' || (sh.alpha ?? 1) < 0.6) continue
    let a = 0
    for (let i = 0; i < sh.pts.length; i++) {
      const [x0, y0] = sh.pts[i]
      const [x1, y1] = sh.pts[(i + 1) % sh.pts.length]
      a += x0 * y1 - x1 * y0
    }
    if (Math.abs(a) > bestA) [best, bestA] = [sh, Math.abs(a)]
  }
  return !!best && oklch(warm(best.fill))[0] > 0.8
}

/**
 * Rellena una mancha (barrido por filas con antialias: rápido aunque el polígono tenga muchos puntos). El borde lo corta
 * una mano: los puntos tiemblan (fijo + el hervor del dibujo) y la mancha va un pelo desplazada de su línea.
 */
function shapeFill(out: Uint8ClampedArray, sh: DrawShape, pts0: [number, number][], W: number, k: number, dark: boolean, P: Paper, boil: Noise, groupAlpha: number): void {
  const pts = pts0.map(([x, y]) => ({ x, y }))
  let poly: Pt[] = sh.sharp
    ? pts.flatMap((a, i) => {
        const b = pts[(i + 1) % pts.length]
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.35))
        return Array.from({ length: n }, (_, j) => ({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n }))
      })
    : resample(pts, true, 0.35)
  // la mano: el borde ondula un poco (fijo) y hierve con el dibujo; fuera de registro, un pelo abajo a la derecha
  const off = sh.exact ? 0 : 1
  poly = poly.map((q) => ({
    x: q.x + off * (0.1 + (stillHand.at(q.x * 0.7 + 3, q.y * 0.7) - 0.5) * 0.22 + (boil.at(q.x * 0.9, q.y * 0.9 + 9) - 0.5) * 0.12),
    y: q.y + off * (0.07 + (stillHand.at(q.x * 0.7 - 5, q.y * 0.7 + 11) - 0.5) * 0.22 + (boil.at(q.x * 0.9 + 4, q.y * 0.9 - 2) - 0.5) * 0.12)
  }))
  const n = poly.length
  if (n < 3) return
  let y0 = Infinity
  let y1 = -Infinity
  for (const q of poly) {
    y0 = Math.min(y0, q.y)
    y1 = Math.max(y1, q.y)
  }
  const ink = sh.fill === 'ink'
  const pg = ink ? sumiPigment : pigmentOf(sh.fill, dark)
  const alpha = (sh.alpha ?? 1) * groupAlpha
  const row = new Float32Array(W)
  const xs: number[] = []
  const SUB = 3
  const ay = Math.max(0, Math.floor(y0 * k))
  const by = Math.min(W - 1, Math.ceil(y1 * k))
  for (let y = ay; y <= by; y++) {
    row.fill(0)
    let minX = W
    let maxX = -1
    for (let s = 0; s < SUB; s++) {
      const py = (y + (s + 0.5) / SUB) / k
      xs.length = 0
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const A = poly[a]
        const B = poly[b]
        if (A.y > py !== B.y > py) xs.push(((B.x - A.x) * (py - A.y)) / (B.y - A.y) + A.x)
      }
      xs.sort((p, q) => p - q)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        // el tramo [xa, xb) en px de pantalla, con cobertura parcial en sus dos puntas
        const xa = Math.max(0, xs[i] * k)
        const xb = Math.min(W, xs[i + 1] * k)
        if (xb <= xa) continue
        const ia = Math.floor(xa)
        const ib = Math.min(W - 1, Math.floor(xb))
        minX = Math.min(minX, ia)
        maxX = Math.max(maxX, ib)
        if (ia === ib) {
          row[ia] += (xb - xa) / SUB
          continue
        }
        row[ia] += (ia + 1 - xa) / SUB
        for (let x = ia + 1; x < ib; x++) row[x] += 1 / SUB
        if (ib < W) row[ib] += (xb - ib) / SUB
      }
    }
    for (let x = minX; x <= maxX; x++) {
      const c = Math.min(1, row[x])
      if (c <= 0) continue
      const i = y * W + x
      const j = Math.min(W - 1, y + pg.oy) * W + Math.min(W - 1, x + pg.ox)
      const v = ink ? 1 : 1 + 0.045 * P.tone[j]
      over(out, i, pg.r * v, pg.g * v, pg.b * v, c * alpha * pg.a * (0.985 - 0.2 * sstep(0.18, 0.04, P.height[i])))
    }
  }
}
