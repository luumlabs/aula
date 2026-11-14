// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/draw.ts (drawAll: las reglas del
// movimiento) y src/figures/plot.ts (sliderEnv: los deslizadores acotados).
// Dibujos que se mueven: con los deslizadores y el reloj del dibujo, cada elemento con `motion` se desplaza (dx, dy), gira
// (turn, alrededor de `pivot`) o recorre el contorno de otro elemento (along/at, girando con la tangente si `orient`). Lo
// escrito es la imagen en reposo; esto solo calcula el transform de cada elemento. Las expresiones las evalúa el motor de las
// simulaciones (nombres de varias letras, theta → θ, trigonometría en radianes: rad(30)).
import type { DrawItem } from '@shared/schema/common'
import type { DrawingMore } from '@shared/schema/drawing'
import { makeSimulation, type SimParam } from '@shared/schema/visual'
import { SimulationEngine } from '@engine/content/simulation'
import { pointAlong, rotatePoint, type Pt } from './geometry'
import type { DrawShape } from './shapes'

/** Transform de un elemento en un fotograma: gira `deg` (antihorario) alrededor de (px, py) y después se desplaza (dx, dy). */
export interface ItemFrame { dx: number; dy: number; deg: number; px: number; py: number }

export type Env = Record<string, number>

/** Tipos de elemento por cuyo contorno se puede viajar (`along`). */
export const PATH_KINDS: ReadonlySet<string> = new Set(['line', 'arrow', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'arc', 'curve'])

/** Motor de expresiones del dibujo (sus deslizadores y su reloj). */
export function drawingEngine(d: DrawingMore): SimulationEngine {
  return new SimulationEngine(makeSimulation({ params: d.params ?? [], time: d.time }))
}

/** Deslizadores con valores seguros (min < max, paso > 0, valor dentro), como los de las simulaciones. */
export function saneDrawParams(ps: readonly SimParam[]): SimParam[] {
  const seen = new Set<string>()
  return ps.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true))).map((p) => {
    let min = Number.isFinite(p.min) ? p.min : 0
    let max = Number.isFinite(p.max) ? p.max : min + 10
    if (!(max > min)) [min, max] = max < min ? [max, min] : [min, min + 1]
    let step = Number.isFinite(p.step) && p.step > 0 ? p.step : (max - min) / 100
    if (step > max - min) step = (max - min) / 10
    const value = Math.min(max, Math.max(min, Number.isFinite(p.value) ? p.value : min))
    return { ...p, min, max, step, value }
  })
}

/** Valores de los deslizadores acotados a su rango (los que faltan, en su valor inicial). */
export function clampParams(params: readonly SimParam[], values: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of params) {
    const v = Object.hasOwn(values, p.name) ? values[p.name] : p.value
    out[p.name] = Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.value
  }
  return out
}

/** ¿Algo del dibujo se mueve? (elementos con `motion` y deslizadores o reloj con los que moverlos) */
export function drawingMoves(d: DrawingMore & { items: readonly DrawItem[] }): boolean {
  return (!!d.params?.length || !!d.time) && d.items.some((it) => !!it.motion)
}

/** Aplica el transform de un fotograma a un punto. */
export function applyFrame(p: Pt, fr: ItemFrame | undefined): Pt {
  if (!fr) return [p[0], p[1]]
  const r = rotatePoint(p, fr.deg, [fr.px, fr.py])
  return [r[0] + fr.dx, r[1] + fr.dy]
}

/** Centro de un elemento (el de su forma o el de su contorno). */
export function shapeCenter(s: DrawShape | undefined): Pt {
  if (!s) return [0, 0]
  if (s.center) return s.center
  if (s.around) return [s.around.x + s.around.w / 2, s.around.y + s.around.h / 2]
  if (s.outline.length) {
    const xs = s.outline.map((p) => p[0]), ys = s.outline.map((p) => p[1])
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  }
  return [0, 0]
}

const isIdentity = (fr: ItemFrame): boolean => Math.abs(fr.dx) < 1e-9 && Math.abs(fr.dy) < 1e-9 && Math.abs(fr.deg) < 1e-9

/**
 * El transform de cada elemento para unos valores (undefined = quieto). Primero los desplazamientos y giros; después los que
 * viajan por el contorno (ya movido) de un elemento que no viaja a su vez. Un valor que no se puede calcular deja el
 * elemento quieto en ese fotograma.
 */
export function resolveFrame(items: readonly DrawItem[], shapes: readonly DrawShape[], engine: SimulationEngine, env: Env): Array<ItemFrame | undefined> {
  const n = Math.min(items.length, shapes.length)
  const frames: Array<ItemFrame | undefined> = new Array(n).fill(undefined)
  const value = (text: string | undefined, def: number): number | undefined => (text === undefined ? def : engine.value(text, env))
  const rigid = (i: number): ItemFrame | undefined => {
    const m = items[i].motion
    if (!m) return undefined
    const dx = value(m.dx, 0), dy = value(m.dy, 0), turn = value(m.turn, 0)
    if (dx === undefined || dy === undefined || turn === undefined) return undefined
    const c = m.pivot && m.pivot.length >= 2 && m.pivot.every(Number.isFinite) ? ([m.pivot[0], m.pivot[1]] as Pt) : shapeCenter(shapes[i])
    return { dx, dy, deg: turn, px: c[0], py: c[1] }
  }
  // 1. desplazamientos y giros rígidos
  for (let i = 0; i < n; i++) if (!items[i].motion?.along) frames[i] = rigid(i)
  // 2. los que viajan: el centro va al punto del contorno del elemento nombrado (que no viaja)
  const byId = new Map<string, number>()
  for (let i = 0; i < n; i++) { const id = items[i].id; if (id && !items[i].motion?.along && !byId.has(id)) byId.set(id, i) }
  for (let i = 0; i < n; i++) {
    const m = items[i].motion
    if (!m?.along) continue
    const t = byId.get(m.along)
    const base = rigid(i)
    if (!base) continue
    // sin un recorrido válido (no existe, no es una línea o viaja a su vez) se queda con su movimiento rígido
    if (t === undefined || t === i || !PATH_KINDS.has(items[t].kind)) { frames[i] = base; continue }
    const target = shapes[t]
    const fraction = value(m.at, 0)
    if (target.outline.length < 2 || fraction === undefined) { frames[i] = base; continue }
    const outline = frames[t] ? target.outline.map((p) => applyFrame(p, frames[t])) : target.outline
    const { at, deg: heading } = pointAlong(outline, fraction, target.closed)
    const center = shapeCenter(shapes[i])
    const deg = base.deg + (m.orient ? heading : 0)
    const pivot: Pt = m.pivot && m.pivot.length >= 2 ? [base.px, base.py] : center
    const turned = rotatePoint(center, deg, pivot)
    frames[i] = { dx: at[0] - turned[0] + base.dx, dy: at[1] - turned[1] + base.dy, deg, px: pivot[0], py: pivot[1] }
  }
  return frames.map((fr) => (fr && !isIdentity(fr) ? fr : undefined))
}

/** Entorno de las expresiones para unos valores de los deslizadores y un instante del reloj. */
export function drawingEnv(engine: SimulationEngine, values: Readonly<Record<string, number>>, time: number | undefined): Env {
  return engine.environment(values, engine.block.time ? time : undefined)
}

/** Intervalo del reloj del dibujo (undefined sin reloj). */
export function drawingTimeBounds(engine: SimulationEngine, values: Readonly<Record<string, number>>): [number, number] | undefined {
  return engine.timeBounds(values)
}
