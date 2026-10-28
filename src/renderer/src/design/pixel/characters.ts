// Personajes animados: une cada sprite (icono 16×16 o compañero 24×24) con su historia (iconAnims / companionAnims),
// la compila una vez por tono y la guarda en caché. Puro: sin DOM.
import { SPRITES, type PixelSprite } from './sprites'
import { COMPANIONS, type CompanionData } from './companions'
import { accentRamp, type CourseTone } from './tones'
import { boardFromRows, compileAnim, compileCels, compileFrame, diffCel, parseLegend, type AnimSpec, type Board, type CompiledAnim, type FrameContext, type Px } from './anim'
import { FX } from './fx'
import { ICON_ANIMS } from './iconAnims'
import { COMPANION_ANIMS } from './companionAnims'

export const ICON_MARGIN = 3
export const COMPANION_MARGIN = 3
/** Letra de cada color de la paleta de un compañero en sus filas de texto (índice 0 → '0', 10 → 'A'…). */
export const COMPANION_CHARS = '0123456789ABCDEFGHIJ'

/** Añade el personaje al mensaje de error (para encontrar rápido el fotograma roto). */
function withId<T>(id: string, fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    throw new Error(`${id}: ${(e as Error).message}`)
  }
}

const spriteById = new Map<string, PixelSprite>(SPRITES.map((s) => [s.id, s]))
const companionById = new Map<string, CompanionData>(COMPANIONS.map((c) => [c.id, c]))

/** Si a un sprite le faltara historia, al menos guiña: un destello en una esquina. */
const FALLBACK: AnimSpec = { hover: { ms: 90, frames: ['tw1@14,1', 'tw3@13,0', 'tw1@14,1', ''] } }

export function iconContext(sprite: PixelSprite, tone: CourseTone, spec: AnimSpec = ICON_ANIMS[sprite.id] ?? FALLBACK): FrameContext {
  const ramp = accentRamp(tone)
  const spriteLegend = parseLegend(sprite.legend, ramp)
  const base = boardFromRows(sprite.rows, spriteLegend, 16, ICON_MARGIN)
  const legend = parseLegend(spec.legend, ramp, undefined, new Map(spriteLegend))
  return { base, legend, cels: compileCels(spec.cels, FX, legend, ramp) }
}

const iconCache = new Map<string, CompiledAnim>()
/** La animación compilada de un icono de curso con la rampa de su tono. */
export function iconAnim(id: string, tone: CourseTone): CompiledAnim {
  const key = `${id}|${tone.name}`
  let a = iconCache.get(key)
  if (!a) {
    const sprite = spriteById.get(id) ?? spriteById.get('study')!
    const spec = ICON_ANIMS[sprite.id] ?? FALLBACK
    a = withId(sprite.id, () => compileAnim(spec, iconContext(sprite, tone, spec)))
    a.look = { id: `icon:${sprite.id}`, strokes: 'all' }
    iconCache.set(key, a)
  }
  return a
}

/** Las capas de un compañero (tramos [x, y, ancho, color]) a filas de texto con su letra de paleta. */
export function companionRows(c: CompanionData, layers: ('base' | 'eyesOpen' | 'eyesClosed' | 'poseA' | 'poseB')[]): string[] {
  const grid = Array.from({ length: 24 }, () => Array<string>(24).fill('.'))
  for (const l of layers) {
    const a = c[l]
    for (let i = 0; i + 3 < a.length; i += 4) {
      const [x, y, w, col] = [a[i], a[i + 1], a[i + 2], a[i + 3]]
      for (let k = 0; k < w; k++) if (y < 24 && x + k < 24) grid[y][x + k] = COMPANION_CHARS[col]
    }
  }
  return grid.map((r) => r.join(''))
}

function companionLegend(c: CompanionData): string {
  return c.palette.map((_, i) => `${COMPANION_CHARS[i]}:p${i}`).join(' ')
}

export function companionContext(c: CompanionData, spec: AnimSpec = COMPANION_ANIMS[c.id] ?? FALLBACK): FrameContext {
  const pl = parseLegend(companionLegend(c), undefined, c.palette)
  const board = (layers: Parameters<typeof companionRows>[1]) => boardFromRows(companionRows(c, layers), pl, 24, COMPANION_MARGIN)
  const base = board(['base', 'eyesOpen', 'poseA'])
  // parches automáticos: los ojos cerrados y la otra pose de la animación original
  const auto = new Map([
    ['blink', diffCel(base, board(['base', 'eyesClosed', 'poseA']))],
    ['pose', diffCel(base, board(['base', 'eyesOpen', 'poseB']))]
  ])
  // ojos felices (^ ^) y guiño, dibujados a partir de dónde están los ojos (la capa de ojos cerrados)
  const eyes = eyeBoxes(c)
  if (eyes.length) {
    const happy = happyEyes(base, c.palette)
    auto.set('happy', diffCel(base, happy(eyes)))
    auto.set('wink', diffCel(base, happy(eyes.slice(0, 1))))
  }
  const legend = parseLegend(spec.legend, undefined, c.palette, new Map(pl))
  return { base, legend, cels: compileCels(spec.cels, FX, legend, undefined, c.palette, auto) }
}

/** Un ojo: columnas x0…x1, filas y0…y1, y el color del párpado (el de la capa de ojos cerrados). */
export interface EyeBox {
  x0: number
  x1: number
  y0: number
  y1: number
  lid: number
}

/** Los ojos de un compañero, deducidos de su capa de ojos cerrados (tramos con las mismas columnas = un ojo). */
export function eyeBoxes(c: CompanionData): EyeBox[] {
  const out: EyeBox[] = []
  const a = c.eyesClosed
  for (let i = 0; i + 3 < a.length; i += 4) {
    const [x, y, w, col] = [a[i], a[i + 1], a[i + 2], a[i + 3]]
    const same = out.find((e) => Math.abs(e.x0 - x) <= 1 && Math.abs(e.x1 - (x + w - 1)) <= 1 && y - e.y1 <= 2)
    if (same) {
      same.y1 = Math.max(same.y1, y)
      same.x0 = Math.min(same.x0, x)
      same.x1 = Math.max(same.x1, x + w - 1)
    } else out.push({ x0: x, x1: x + w - 1, y0: y, y1: y, lid: col })
  }
  for (const e of out) e.y1 = Math.max(e.y1, e.y0 + 1)
  return out.sort((p, q) => p.x0 - q.x0)
}

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

/** Dibuja ojos felices (^): rellena el ojo con el color del párpado y traza el arco con la tinta del propio ojo. */
function happyEyes(base: Board, palette: string[]): (eyes: EyeBox[]) => Board {
  const m = base.margin
  const s = base.stride
  return (eyes) => {
    const b: Board = { ...base, px: base.px.slice() }
    const set = (x: number, y: number, v: string) => {
      if (x >= -m && y >= -m && x < s - m && y < s - m) b.px[(y + m) * s + x + m] = v
    }
    for (const e of eyes) {
      const lid = palette[e.lid]
      // la tinta: el color más oscuro del ojo que no sea el párpado
      let ink = '#22172b'
      let best = Infinity
      for (let y = e.y0; y <= e.y1; y++)
        for (let x = e.x0; x <= e.x1; x++) {
          const v = base.px[(y + m) * s + x + m]
          if (v && v !== lid && luminance(v) < best) {
            best = luminance(v)
            ink = v
          }
        }
      for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) set(x, y, lid)
      for (let x = e.x0; x <= e.x1; x++) set(x, e.y0, ink)
      set(e.x0 - 1, e.y0 + 1, ink)
      set(e.x1 + 1, e.y0 + 1, ink)
    }
    return b
  }
}

export interface CompanionAnim extends CompiledAnim {
  /** Los 8 fotogramas del bucle «trabajando» (parpadeo × pose × flotar), indexados por bits. */
  working: Px[][]
  data: CompanionData
}

const companionCache = new Map<string, CompanionAnim>()
export function companionAnim(id: string): CompanionAnim {
  let a = companionCache.get(id)
  if (!a) {
    const c = companionById.get(id) ?? COMPANIONS[0]
    const spec = COMPANION_ANIMS[c.id] ?? FALLBACK
    const ctx = withId(c.id, () => companionContext(c, spec))
    const working = Array.from({ length: 8 }, (_, bits) => compileFrame(`${bits & 1 ? 'blink' : ''} ${bits & 2 ? 'pose' : ''} ${bits & 4 ? '@0,-1' : ''}`, ctx).px)
    a = { ...withId(c.id, () => compileAnim(spec, ctx)), working, data: c, look: { id: c.id, outline: c.palette[0], strokes: 'dabs' } }
    companionCache.set(id, a)
  }
  return a
}

/** El estado del bucle «trabajando» en el instante `time` (segundos), como índice de `working` (la animación de Luna). */
export function workingIndex(c: CompanionData, time: number): number {
  const pos = (period: number, offset = 0) => {
    if (period <= 0) return 0
    const v = ((time + offset) % period) / period
    return v < 0 ? v + 1 : v
  }
  const b = c.blinkPeriod > 0 ? pos(c.blinkPeriod, c.blinkOffset) : 0
  const blink = c.blinkPeriod > 0 && b >= 0.93 && b < 0.96
  const p = pos(c.posePeriod)
  const alt = c.pose === 'flip' ? p >= 0.5 : c.pose === 'twitch' ? (p >= 0.7 && p < 0.76) || (p >= 0.82 && p < 0.88) : false
  const lift = c.bob && pos(2.4, c.bobOffset) >= 0.5
  return (blink ? 1 : 0) | (alt ? 2 : 0) | (lift ? 4 : 0)
}
