// Motor PURO de las animaciones pixel-art por personaje (sin DOM): convierte la descripción en texto de cada animación
// (parches dibujados + fotogramas) en tableros de colores listos para pintar. El formato está en ./README.md.
import { PALETTE } from './sprites'

/** Color de un píxel: '#rrggbb' o null (transparente). */
export type Px = string | null
/** Los tres estados de cada personaje. */
export type ClipName = 'idle' | 'hover' | 'celebrate'
export const CLIP_NAMES: ClipName[] = ['idle', 'hover', 'celebrate']

/** Parche dibujado: un trozo de pixel-art que se pega sobre el dibujo. '.' deja ver lo de debajo; '_' borra. */
export interface CelSpec {
  /** Esquina superior izquierda en coordenadas del sprite (puede ser negativa: hay margen alrededor). */
  at: [number, number]
  rows: string[]
  /** Colores propios del parche (se suman a la leyenda del personaje). */
  legend?: string
}

/** Una pista: fotogramas (cada uno, una lista de operaciones separadas por espacios) a `ms` por paso. */
export interface ClipSpec {
  ms?: number
  frames: string[]
  /** Con «Reducir movimiento», el único fotograma que se enseña al pasar el ratón (índice en `frames`). */
  still?: number
}

/** La historia de un personaje: parches + reposo, ratón y celebración. */
export interface AnimSpec {
  /** Colores extra para los parches ("x:gold1 y:a2 z:#ffffff"); se suman a la leyenda del sprite. */
  legend?: string
  cels?: Record<string, CelSpec>
  idle?: ClipSpec
  hover: ClipSpec
  celebrate?: ClipSpec
}

/** Tablero: el sprite de `size`×`size` con `margin` píxeles libres alrededor (para chispas y saltos). */
export interface Board {
  size: number
  margin: number
  stride: number
  px: Px[]
}

export interface CompiledFrame {
  px: Px[]
  ticks: number
}
export interface CompiledClip {
  ms: number
  frames: CompiledFrame[]
  ticks: number
  still: number
}
export interface CompiledAnim {
  size: number
  margin: number
  stride: number
  base: Px[]
  clips: Partial<Record<ClipName, CompiledClip>>
  /** Cómo se dibuja a mano (lo pone characters.ts): ver ./brush/frames.ts. */
  look?: AnimLook
}

/** Cómo se dibuja a mano un personaje. */
export interface AnimLook {
  /** Quién es (clave de caché y de su dibujo hecho a mano, si lo tiene). */
  id: string
  /** El color de su silueta en el pixel art (el contorno de los compañeros): también es línea. */
  outline?: string
  /** Líneas de color de 1 px como pinceladas: todas (iconos), solo los toques sueltos (compañeros) o cualquiera (glifos). */
  strokes?: 'all' | 'dabs' | 'any'
  /** Glifo de la interfaz: sus colores (los de la interfaz) van tal cual y su línea, en su propio color. */
  plain?: boolean
  /** Colores que son línea (si no, se deducen). */
  line?: string[]
}

/** El texto de operaciones de cada tablero compilado (para los personajes dibujados a mano, que no se pintan del pixel). */
const opsOfBoard = new WeakMap<Px[], string>()
/** Las operaciones con las que se compiló un tablero ('' = el dibujo base; undefined = no salió de compileFrame). */
export function opsOf(px: Px[]): string | undefined {
  return opsOfBoard.get(px)
}

/** Parche ya resuelto: undefined = deja lo de debajo, null = borra. */
interface Cel {
  x: number
  y: number
  w: number
  h: number
  px: (Px | undefined)[]
}

export type Legend = Map<string, Px>

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** Resuelve un nombre de color: de PALETTE, a1…a4 (rampa del curso), pN (paleta del compañero) o #rrggbb. */
export function resolveColor(name: string, ramp?: string[], palette?: string[]): string | undefined {
  if (PALETTE[name] != null) return hex(PALETTE[name])
  const a = /^a([1-4])$/.exec(name)
  if (a) return ramp?.[Number(a[1]) - 1]
  const p = /^p(\d+)$/.exec(name)
  if (p) return palette?.[Number(p[1])]
  if (/^#[0-9a-f]{6}$/i.test(name)) return name.toLowerCase()
  return undefined
}

/** Lee una leyenda "X:nombre Y:nombre". Lanza si un color no existe (para que las pruebas lo cacen). */
export function parseLegend(legend: string | undefined, ramp?: string[], palette?: string[], into: Legend = new Map()): Legend {
  if (!legend) return into
  for (const token of legend.trim().split(/\s+/)) {
    const i = token.indexOf(':')
    const ch = token.slice(0, i)
    const name = token.slice(i + 1)
    if (i !== 1 || ch === '.' || ch === '_') throw new Error(`leyenda: «${token}» no es «X:color»`)
    const c = resolveColor(name, ramp, palette)
    if (!c) throw new Error(`leyenda: color desconocido «${name}»`)
    into.set(ch, c)
  }
  return into
}

export function emptyBoard(size: number, margin: number): Board {
  const stride = size + margin * 2
  return { size, margin, stride, px: new Array<Px>(stride * stride).fill(null) }
}

/** El dibujo base (filas de texto con su leyenda) en un tablero con margen. */
export function boardFromRows(rows: string[], legend: Legend, size: number, margin: number): Board {
  const b = emptyBoard(size, margin)
  rows.forEach((row, y) => {
    Array.from(row).forEach((ch, x) => {
      if (ch === '.' || x >= size || y >= size) return
      const c = legend.get(ch)
      if (c === undefined) throw new Error(`sprite: carácter «${ch}» sin color`)
      b.px[(y + margin) * b.stride + x + margin] = c
    })
  })
  return b
}

function compileCel(spec: CelSpec, legend: Legend, ramp?: string[], palette?: string[]): Cel {
  const lg = spec.legend ? parseLegend(spec.legend, ramp, palette, new Map(legend)) : legend
  const h = spec.rows.length
  const w = Math.max(0, ...spec.rows.map((r) => r.length))
  const px: (Px | undefined)[] = new Array(w * h).fill(undefined)
  spec.rows.forEach((row, y) => {
    Array.from(row).forEach((ch, x) => {
      if (ch === '.') return
      if (ch === '_') {
        px[y * w + x] = null
        return
      }
      const c = lg.get(ch)
      if (c === undefined) throw new Error(`parche: carácter «${ch}» sin color`)
      px[y * w + x] = c
    })
  })
  return { x: spec.at[0], y: spec.at[1], w, h, px }
}

/** Parche que convierte el tablero `from` en `to` (solo los píxeles que cambian). */
export function diffCel(from: Board, to: Board): Cel {
  const s = from.stride
  const px: (Px | undefined)[] = from.px.map((v, i) => (to.px[i] === v ? undefined : to.px[i]))
  return { x: -from.margin, y: -from.margin, w: s, h: s, px }
}

function paste(b: Board, cel: Cel, dx: number, dy: number): void {
  for (let y = 0; y < cel.h; y++) {
    for (let x = 0; x < cel.w; x++) {
      const v = cel.px[y * cel.w + x]
      if (v === undefined) continue
      const bx = cel.x + dx + x + b.margin
      const by = cel.y + dy + y + b.margin
      if (bx < 0 || by < 0 || bx >= b.stride || by >= b.stride) continue
      b.px[by * b.stride + bx] = v
    }
  }
}

function shift(b: Board, dx: number, dy: number): void {
  const s = b.stride
  const out = new Array<Px>(s * s).fill(null)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue
      out[ny * s + nx] = b.px[y * s + x]
    }
  }
  b.px = out
}

function mirror(b: Board): void {
  const s = b.stride
  const out = new Array<Px>(s * s)
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) out[y * s + x] = b.px[y * s + (s - 1 - x)]
  b.px = out
}

/** Contexto para compilar los fotogramas de un personaje. */
export interface FrameContext {
  base: Board
  legend: Legend
  cels: Map<string, Cel>
}

const SHIFT = /^@(-?\d+),(-?\d+)$/
const CEL = /^([A-Za-z][\w-]*)(?:@(-?\d+),(-?\d+))?$/
const HOLD = /^\*(\d+)$/
const RECOLOR = /^%(.)(.)$/

/**
 * Compila un fotograma. Operaciones (en orden, separadas por espacios):
 *   nombre / nombre@dx,dy   pega un parche (desplazado)        @dx,dy   mueve todo lo pintado
 *   -                       vacía el tablero                    <>       espejo horizontal
 *   %XY                     el color X pasa a ser el color Y (Y = '_' lo borra)
 *   *n                      el fotograma dura n pasos
 * Un fotograma vacío ('') es el dibujo base.
 */
export function compileFrame(spec: string, ctx: FrameContext): CompiledFrame {
  const b: Board = { ...ctx.base, px: ctx.base.px.slice() }
  let ticks = 1
  for (const tok of spec.trim().split(/\s+/).filter(Boolean)) {
    let m: RegExpExecArray | null
    if (tok === '-') b.px.fill(null)
    else if (tok === '<>') mirror(b)
    else if ((m = HOLD.exec(tok))) ticks = Math.max(1, Number(m[1]))
    else if ((m = SHIFT.exec(tok))) shift(b, Number(m[1]), Number(m[2]))
    else if ((m = RECOLOR.exec(tok))) {
      const from = ctx.legend.get(m[1])
      const to = m[2] === '_' ? null : ctx.legend.get(m[2])
      if (from == null || to === undefined) throw new Error(`fotograma: recoloreado «${tok}» con colores desconocidos`)
      for (let i = 0; i < b.px.length; i++) if (b.px[i] === from) b.px[i] = to
    } else if ((m = CEL.exec(tok))) {
      const cel = ctx.cels.get(m[1])
      if (!cel) throw new Error(`fotograma: parche desconocido «${m[1]}»`)
      paste(b, cel, Number(m[2] ?? 0), Number(m[3] ?? 0))
    } else throw new Error(`fotograma: operación desconocida «${tok}»`)
  }
  opsOfBoard.set(b.px, spec)
  return { px: b.px, ticks }
}

export function compileClip(spec: ClipSpec, ctx: FrameContext): CompiledClip {
  const frames = spec.frames.map((f) => compileFrame(f, ctx))
  return { ms: spec.ms ?? 100, frames, ticks: frames.reduce((n, f) => n + f.ticks, 0), still: Math.min(spec.still ?? frames.length - 1, frames.length - 1) }
}

/** Compila los parches de una animación (los propios y los efectos compartidos). */
export function compileCels(specs: Record<string, CelSpec> | undefined, shared: Record<string, CelSpec>, legend: Legend, ramp?: string[], palette?: string[], extra?: Map<string, Cel>): Map<string, Cel> {
  const out = new Map<string, Cel>(extra ?? [])
  for (const [name, s] of Object.entries(shared)) out.set(name, compileCel(s, legend, ramp, palette))
  for (const [name, s] of Object.entries(specs ?? {})) out.set(name, compileCel(s, legend, ramp, palette))
  return out
}

export function compileAnim(spec: AnimSpec, ctx: FrameContext): CompiledAnim {
  const clips: Partial<Record<ClipName, CompiledClip>> = {}
  for (const name of CLIP_NAMES) {
    const c = spec[name]
    if (c) clips[name] = compileClip(c, ctx)
  }
  opsOfBoard.set(ctx.base.px, '')
  return { size: ctx.base.size, margin: ctx.base.margin, stride: ctx.base.stride, base: ctx.base.px, clips }
}

/** El fotograma de una pista en el paso `tick` (o null si ya terminó). */
export function frameAt(clip: CompiledClip, tick: number): number | null {
  if (tick < 0) return 0
  let n = tick
  for (let i = 0; i < clip.frames.length; i++) {
    n -= clip.frames[i].ticks
    if (n < 0) return i
  }
  return null
}

/** Tramos horizontales de un mismo color (para pintar rápido). */
export function runsOf(px: Px[], stride: number): [number, number, number, string][] {
  const out: [number, number, number, string][] = []
  for (let y = 0; y < stride; y++) {
    let x = 0
    while (x < stride) {
      const c = px[y * stride + x]
      if (!c) {
        x++
        continue
      }
      let e = x + 1
      while (e < stride && px[y * stride + e] === c) e++
      out.push([x, y, e - x, c])
      x = e
    }
  }
  return out
}

/** Pseudoaleatorio estable por celda (orden de la disolución). */
export function cellHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Repite una lista de fotogramas n veces (ayuda para escribir pistas). */
export function rep(n: number, ...frames: string[]): string[] {
  return Array.from({ length: n }, () => frames).flat()
}
