// V6 · personajes que se dibujan a pincel: el orden de los trazos y su tiempo (puro). El pintor de la app dice qué piezas
// tiene el dibujo (`scenePieces`/`boardPieces`: líneas de tinta de la silueta y de dentro, aguadas, pinceladas de color,
// manchas de tinta); aquí se decide el orden natural de un ilustrador — el contorno primero (la línea más larga, luego
// las demás en su orden), las aguadas de mayor a menor y al final los detalles (ojos, boca, brillos, líneas de dentro) —
// y cuánto dura cada trazo (según su largo, con curva suave: el pincel acelera y frena). Lo usan el compositor (cuánto
// lleva cada pieza en cada fotograma) y la hoja de efectos (un evento de pincel por trazo para SOUND).
import { warp } from './ramp.ts'
import { laptopSweptBox, laptopTitleRect } from './laptop.ts'
import { avoidRect, type Rect } from './v5.ts'
import type { Drawing, Montage } from './types.ts'

/** Lo que el plan necesita de cada pieza del pintor. */
export interface PieceLike {
  kind: 'fill' | 'blot' | 'color' | 'ink'
  edge: boolean
  size: number
  box: [number, number, number, number]
  group: number
}

export type Phase = 'outline' | 'fill' | 'detail'

export interface DrawPlan {
  /** Inicio y fin (s desde que empieza el dibujo) de cada pieza, por su índice. */
  start: number[]
  end: number[]
  phase: Phase[]
  /** Las piezas en el orden en que se dibujan. */
  order: number[]
}

/** Lo que tarda el dibujo si no se dice. */
export const DRAW_DUR = 1.8

const phaseOf = (p: PieceLike): Phase => (p.kind === 'ink' && p.edge ? 'outline' : p.kind === 'fill' ? 'fill' : 'detail')

/** El plan de un dibujo de `dur` s. */
export function drawPlan(pieces: PieceLike[], dur = DRAW_DUR): DrawPlan {
  const n = pieces.length
  const phase = pieces.map(phaseOf)
  const idx = (ph: Phase) => pieces.map((_, i) => i).filter((i) => phase[i] === ph)
  // el contorno: la línea más larga primero (la silueta), luego las demás en el orden del dibujo
  const outline = idx('outline')
  if (outline.length > 1) {
    const first = outline.reduce((a, b) => (pieces[b].size > pieces[a].size ? b : a))
    outline.splice(outline.indexOf(first), 1)
    outline.unshift(first)
  }
  // las aguadas, de la más grande a la más pequeña (y en su orden si empatan)
  const fills = idx('fill').sort((a, b) => pieces[b].size - pieces[a].size || a - b)
  const details = idx('detail')
  const start = new Array<number>(n).fill(0)
  const end = new Array<number>(n).fill(0)
  // tiempos crudos: cada trazo según su largo (en unidades del dibujo, ~24 de lado), con un poco de solape
  let cur = 0
  let outlineEnd = 0
  for (const i of outline) {
    const d = Math.min(0.55, Math.max(0.16, 0.12 + pieces[i].size * 0.022))
    start[i] = cur
    end[i] = cur + d
    outlineEnd = Math.max(outlineEnd, end[i])
    cur += d * 0.82
  }
  // las aguadas empiezan cuando el contorno lleva dos tercios
  cur = outline.length ? outlineEnd * 0.66 : 0
  let fillsEnd = cur
  for (const i of fills) {
    start[i] = cur
    end[i] = cur + 0.34
    fillsEnd = Math.max(fillsEnd, end[i])
    cur += 0.09
  }
  cur = fills.length ? Math.max(outlineEnd, fillsEnd - 0.18) : outlineEnd
  for (const i of details) {
    const d = pieces[i].kind === 'blot' ? 0.12 : Math.min(0.3, Math.max(0.08, 0.06 + pieces[i].size * 0.02))
    start[i] = cur
    end[i] = cur + d
    cur += d * 0.7
  }
  const total = Math.max(1e-6, ...end)
  const k = dur / total
  for (let i = 0; i < n; i++) {
    start[i] *= k
    end[i] *= k
  }
  return { start, end, phase, order: [...outline, ...fills, ...details] }
}

/** Cuánto lleva cada pieza (0–1) a `local` s del dibujo: dentro de su trazo, el pincel acelera y frena. */
export function drawProgress(plan: DrawPlan, local: number): number[] {
  return plan.start.map((s, i) => {
    const e = plan.end[i]
    const x = Math.min(1, Math.max(0, (local - s) / Math.max(1e-6, e - s)))
    return x * x * (3 - 2 * x)
  })
}

/** El tiempo del dibujo (s desde que empieza) en el instante `t` del vídeo, con sus rampas. */
export function drawingLocal(d: Drawing, t: number): number {
  return warp(d.ramps, t) - d.t
}

/** Los trazos como eventos de la hoja de efectos: uno por trazo (su fase y lo que dura) y un acento al empezar y al
 *  acabar el dibujo (los que convierte en destello de marimba la banda del v3). */
export function drawingStrokes(plan: DrawPlan, d: Drawing): { t: number; dur: number; phase: Phase | 'done'; accent: boolean }[] {
  const at = (local: number) => {
    // el instante del vídeo en que el dibujo llega a `local` (inversa de las rampas)
    let lo = d.t - 1
    let hi = d.t + local + 30
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if (drawingLocal(d, mid) < local) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const out = plan.order.map((i, k) => ({ t: at(plan.start[i]), dur: at(plan.end[i]) - at(plan.start[i]), phase: plan.phase[i] as Phase | 'done', accent: k === 0 }))
  out.push({ t: at(Math.max(...plan.end)), dur: 0, phase: 'done', accent: true })
  return out
}

/** Varios personajes que se dibujan escalonados (en grupo): uno tras otro cada `stagger` s, cada uno en su sitio (o
 *  `at: 'gap'`: en fila en el hueco libre del portátil, del lado `side`). */
export function drawGroup(o: { t: number; who: string[]; at: [number, number][] | 'gap'; side?: 'left' | 'right'; size: number; stagger?: number; dur?: number; until?: number; after?: Drawing['after'] }): Drawing[] {
  const n = o.who.length
  return o.who.map((who, i) => ({
    who,
    t: +(o.t + i * (o.stagger ?? 0.3)).toFixed(4),
    dur: o.dur ?? 1.2,
    until: o.until,
    at: o.at === 'gap' ? 'gap' : o.at[i % o.at.length],
    side: o.side,
    slot: o.at === 'gap' ? ([i, n] as [number, number]) : undefined,
    size: o.size,
    after: o.after
  }))
}

/** Dónde va un dibujo en el cuadro (centro y lado, px). Con `at: 'gap'`, en el hueco libre que deja el portátil durante
 *  todo el dibujo: la columna del titular de su lado (apaisado; bajo el titular) o la banda de arriba (vertical). */
const places = new WeakMap<Drawing, { key: string; at: { x: number; y: number; size: number } }>()
export function drawingPlace(m: Montage, d: Drawing): { x: number; y: number; size: number } {
  const [W, H] = m.size
  if (d.at !== 'gap') return { x: W * d.at[0], y: H * d.at[1], size: d.size }
  const key = `${W}x${H}:${d.t}:${d.until}:${d.side}:${d.slot}:${d.size}`
  const hit = places.get(d)
  if (hit?.key === key) return hit.at
  const at = gapPlace(m, d)
  places.set(d, { key, at })
  return at
}

function gapPlace(m: Montage, d: Drawing): { x: number; y: number; size: number } {
  const [W, H] = m.size
  const t1 = d.until ?? m.duration
  if (!m.laptop) return { x: W / 2, y: H * 0.75, size: d.size }
  const box = laptopSweptBox(m, m.laptop, d.t, t1)
  const side = d.side ?? (box.x > W - (box.x + box.w) ? 'left' : 'right')
  const col = laptopTitleRect(m, m.laptop, d.t, t1, side)
  const [i, n] = d.slot ?? [0, 1]
  const cell = col.w / n
  const size = Math.min(d.size, cell * 0.92, col.h * 0.42)
  const portrait = H >= W * 0.95
  return { x: col.x + cell * (i + 0.5), y: portrait ? col.y + col.h - size / 2 : col.y + col.h * 0.84 - size / 2, size }
}

/** Un dibujo que no pisa el texto: si su caja (con aire) toca alguna de las cajas de texto, va al sitio libre más cercano
 *  (fuera de TODAS las cajas y dentro del cuadro), probando las salidas de cada caja y, desde ellas, las de las demás. */
export function clearOfText(p: { x: number; y: number; size: number }, rects: Rect[], frame: { W: number; H: number }): { x: number; y: number; size: number } {
  const air = Math.min(frame.W, frame.H) * 0.02
  const half = p.size / 2 + air
  const hits = (x: number, y: number, R: Rect) => x > R.x - half && x < R.x + R.w + half && y > R.y - half && y < R.y + R.h + half
  const inFrame = (x: number, y: number) => x - p.size / 2 >= 0 && x + p.size / 2 <= frame.W && y - p.size / 2 >= 0 && y + p.size / 2 <= frame.H
  const clear = (x: number, y: number) => rects.every((R) => !hits(x, y, R))
  if (clear(p.x, p.y)) return p
  const exits = (x: number, y: number): [number, number][] =>
    rects.filter((R) => hits(x, y, R)).flatMap((R) => [[R.x - half, y], [R.x + R.w + half, y], [x, R.y - half], [x, R.y + R.h + half]] as [number, number][])
  let level: [number, number][] = [[p.x, p.y]]
  const seen: [number, number][] = []
  for (let depth = 0; depth < 3; depth++) {
    level = level.flatMap(([x, y]) => exits(x, y))
    seen.push(...level)
  }
  const ok = seen.filter(([x, y]) => clear(x, y) && inFrame(x, y))
  const best = (ok.length ? ok : seen.filter(([x, y]) => clear(x, y))).sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.y) - Math.hypot(b[0] - p.x, b[1] - p.y))[0]
  if (best) return { x: best[0], y: best[1], size: p.size }
  const [x, y] = rects.reduce<[number, number]>((q, R) => avoidRect(q[0], q[1], half, half, R, frame), [p.x, p.y])
  return { x, y, size: p.size }
}
