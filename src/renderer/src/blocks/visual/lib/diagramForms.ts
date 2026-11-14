// Disposición de las formas ya hechas de los diagramas (puro): pirámide y embudo (filas en trapecio con la explicación al
// lado), diagrama de Venn de 2 o 3 conjuntos (cada elemento en su región, sin tocar los círculos a los que no pertenece) y
// mapa mental a dos lados equilibrados (ramas con su etiqueta sobre un trazo). La medida del texto se pasa como función.
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/templates.ts stacked(), venn() y
// mindmap(), src/layout/callouts.ts stack() y src/figures/common.ts bounds()/shift(). Diferencias: las etiquetas se parten
// en líneas y la figura crece para que quepan (Sketchy deja que el texto se salga), cada región del Venn prueba varios anchos
// y posiciones antes de agrandar los círculos, y se dibujan todos los nodos (sin topes por forma).
import { mindmapTree, vennModel, type MindNode } from '@engine/content/diagram-forms'
import type { DiagramBlock, DiagramNode } from '@shared/schema/blocks'
import { measureLabel, plainLabel, wrapLines, type Measure, type Pt } from './diagramLayout'

export interface Box { x: number; y: number; w: number; h: number }
interface TextFit { w: number; h: number; lines: number }

const PAD = 18
/** La serif de los títulos es algo más ancha que la letra con la que se mide. */
const SERIF = 1.08

/**
 * Medidas de un texto partido a un ancho máximo: ancho real (o el máximo), alto y líneas. Todas las líneas: las formas no
 * recortan el texto, así que la caja tiene que medir lo que ocupa (si no, pisaría la fila o la rama de al lado).
 */
export function fitText(text: string, maxW: number, size: number, lineH: number, bold: boolean, measure: Measure, widen = 1): TextFit {
  const natural = measureLabel(text, size, bold, measure) * widen
  if (natural <= maxW) return { w: Math.ceil(natural) + 2, h: lineH, lines: 1 }
  const lines = wrapLines(text, maxW / widen, size, bold, measure, Infinity)
  return { w: maxW, h: lines * lineH, lines }
}

/**
 * Coloca cajas sobre un eje lo más cerca posible de su centro deseado sin solaparse (en el orden dado). Devuelve el
 * principio de cada caja. Copiado de Sketchy src/layout/callouts.ts stack().
 */
export function stack(items: { center: number; size: number }[], gap: number): number[] {
  const tops = items.map((i) => i.center - i.size / 2)
  for (let i = 1; i < tops.length; i++) {
    const minTop = tops[i - 1] + items[i - 1].size + gap
    if (tops[i] < minTop) tops[i] = minTop
  }
  // empujar hacia abajo descentra la columna: se recentra sobre los centros deseados, solo hacia arriba
  if (tops.length > 1) {
    const desired = items.reduce((s, i) => s + i.center, 0) / items.length
    const actual = tops.reduce((s, t, i) => s + t + items[i].size / 2, 0) / tops.length
    const shift = Math.min(0, desired - actual)
    for (let i = 0; i < tops.length; i++) tops[i] += shift
  }
  return tops
}

/** Caja que encierra todo lo dado. */
function boundsOf(boxes: Box[], pts: Pt[] = []): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h) }
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
const moveBox = (b: Box, dx: number, dy: number): Box => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h })
const movePt = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy]

// MARK: Pirámide y embudo

export interface PyramidRow {
  id: string
  node: DiagramNode
  index: number
  /** Trapecio de la fila: arriba a la izquierda, arriba a la derecha, abajo a la derecha, abajo a la izquierda. */
  points: Pt[]
  y: number
  h: number
  /** Etiqueta (y, si no cabe al lado, la explicación debajo). */
  label: Box
  /** Alto de la etiqueta dentro de `label` (lo de debajo es la explicación). */
  labelH: number
  inlineDetail: boolean
  /** Explicación en la columna de la derecha, con su línea guía. */
  detail?: Box
  leader?: [Pt, Pt]
}
export interface PyramidLayout { form: 'pyramid' | 'funnel'; rows: PyramidRow[]; outline: Pt[]; cx: number; width: number; height: number }

const PYR = { font: 14, lh: 19, dFont: 12, dLh: 16, padX: 16, padY: 12, gap: 6, minH: 52, labelMax: 230, detailMax: 190, side: 42 }

/**
 * Pirámide (`inverted` = embudo): filas en trapecio de un mismo contorno, la base la más ancha (o la boca, en el embudo).
 * La cúspide no llega a cerrarse y la figura se ensancha hasta que la etiqueta de cada fila cabe en su trapecio.
 */
export function layoutPyramid(b: DiagramBlock, measure: Measure, inverted: boolean, detailsBeside: boolean): PyramidLayout {
  // todos los niveles (el diagrama ya llega con el tope general de nodos; el validador avisa de los que sobran)
  const nodes = b.nodes
  const n = nodes.length
  const content = nodes.map((nd) => {
    const lab = fitText(nd.label, PYR.labelMax, PYR.font, PYR.lh, true, measure)
    const text = nd.detail?.trim()
    const det = text ? fitText(text, detailsBeside ? PYR.detailMax : PYR.labelMax, PYR.dFont, PYR.dLh, false, measure) : undefined
    const inline = det !== undefined && !detailsBeside
    return { lab, det, inline, w: Math.max(lab.w, inline && det ? det.w : 0), h: lab.h + (inline && det ? 3 + det.h : 0) }
  })
  const heights = content.map((c) => Math.max(PYR.minH, c.h + 2 * PYR.padY))
  const ys: number[] = []
  let acc = 0
  for (const h of heights) { ys.push(acc); acc += h + PYR.gap }
  const H = acc - PYR.gap
  let W = Math.max(380, Math.min(110 * n, 720), ...content.map((c) => (c.w + 2 * PYR.padX) / 0.86))
  // distancia del borde estrecho de cada etiqueta al lado de la punta (arriba en la pirámide, abajo en el embudo)
  const tight = (i: number): number => {
    const mid = ys[i] + heights[i] / 2
    return inverted ? H - (mid + content[i].h / 2) : mid - content[i].h / 2
  }
  // la punta no se cierra (como Sketchy, media fila) y se aleja lo que haga falta para que quepa cada etiqueta
  let apex = 0
  for (let iter = 0; iter < 16; iter++) {
    apex = Math.max(heights[inverted ? n - 1 : 0] * 0.5, ...content.map((c, i) => {
      const r = (c.w + 2 * PYR.padX) / W
      return (r * H - tight(i)) / (1 - r)
    }))
    if (apex <= H * 1.1) break
    W *= 1.12
  }
  const cx = W / 2
  const half = (y: number): number => (((inverted ? H - y : y) + apex) / (H + apex)) * (W / 2)
  const rows: PyramidRow[] = nodes.map((node, i) => {
    const y = ys[i], h = heights[i], c = content[i]
    const top = half(y), bottom = half(y + h)
    return {
      id: node.id, node, index: i, y, h,
      points: [[cx - top, y], [cx + top, y], [cx + bottom, y + h], [cx - bottom, y + h]],
      label: { x: cx - c.w / 2, y: y + (h - c.h) / 2, w: c.w, h: c.h },
      labelH: c.lab.h,
      inlineDetail: c.inline
    }
  })
  // explicaciones al lado, sin solaparse (stack de Sketchy) y con su línea guía desde el borde de la fila
  if (detailsBeside) {
    const withDetail = rows.filter((r) => content[r.index].det && !content[r.index].inline)
    const tops = stack(withDetail.map((r) => ({ center: r.y + r.h / 2, size: content[r.index].det!.h })), 8)
    const textX = cx + W / 2 + PYR.side
    withDetail.forEach((r, k) => {
      const det = content[r.index].det!
      r.detail = { x: textX, y: tops[k], w: det.w, h: det.h }
      const edge = (half(r.y) + half(r.y + r.h)) / 2
      r.leader = [[cx + edge + 6, r.y + r.h / 2], [textX - 8, tops[k] + Math.min(det.h / 2, PYR.dLh / 2 + 1)]]
    })
  }
  const outline: Pt[] = [[cx - half(0), 0], [cx + half(0), 0], [cx + half(H), H], [cx - half(H), H]]
  const box = boundsOf([{ x: 0, y: 0, w: W, h: H }, ...rows.flatMap((r) => (r.detail ? [r.detail] : []))])
  const dx = PAD - box.x, dy = PAD - box.y
  for (const r of rows) {
    r.points = r.points.map((p) => movePt(p, dx, dy))
    r.label = moveBox(r.label, dx, dy)
    r.y += dy
    if (r.detail) r.detail = moveBox(r.detail, dx, dy)
    if (r.leader) r.leader = [movePt(r.leader[0], dx, dy), movePt(r.leader[1], dx, dy)]
  }
  return { form: inverted ? 'funnel' : 'pyramid', rows, outline: outline.map((p) => movePt(p, dx, dy)), cx: cx + dx, width: Math.ceil(box.w + 2 * PAD), height: Math.ceil(box.h + 2 * PAD) }
}

// MARK: Venn

export interface VennCircle { id: string; node: DiagramNode; index: number; cx: number; cy: number; r: number; title: Box; below: boolean }
export interface VennItemBox { id: string; node: DiagramNode; box: Box; sets: string[]; region: string }
export interface VennRegionBox { key: string; sets: string[]; box: Box; center: Pt }
export interface VennLayout {
  form: 'venn'
  circles: VennCircle[]
  items: VennItemBox[]
  regions: VennRegionBox[]
  /** Lo que no está en ningún conjunto: debajo, con su rótulo. */
  outside?: { label: Box; items: VennItemBox[] }
  width: number
  height: number
}

const VENN = { r: 135, font: 13, lh: 17, gap: 2, titleFont: 16, titleLh: 21, titleMax: 190, chipH: 26 }

/** Centros de los conjuntos (Sketchy: d = 1,15 r; con tres, en triángulo). */
function vennCenters(k: number, r: number): Pt[] {
  const d = r * 1.15
  return k === 3 ? [[-d / 2, -d * 0.29], [d / 2, -d * 0.29], [0, d * 0.58]] : [[-d / 2, 0], [d / 2, 0]]
}

/** Eje de una región: del centro de la figura hacia la media de sus conjuntos (la de todos, en vertical). */
function regionAxis(members: number[], centers: Pt[]): Pt {
  if (members.length === centers.length) return [0, 1]
  const mx = members.reduce((s, m) => s + centers[m][0], 0) / members.length
  const my = members.reduce((s, m) => s + centers[m][1], 0) / members.length
  const ax = centers.reduce((s, c) => s + c[0], 0) / centers.length
  const ay = centers.reduce((s, c) => s + c[1], 0) / centers.length
  const l = Math.hypot(mx - ax, my - ay) || 1
  return [(mx - ax) / l, (my - ay) / l]
}

/** Centro de una región: la media de sus conjuntos, apartada de los que no la forman (Sketchy regionCenter). */
function regionCenter(members: number[], centers: Pt[], r: number): Pt {
  const mx = members.reduce((s, m) => s + centers[m][0], 0) / members.length
  const my = members.reduce((s, m) => s + centers[m][1], 0) / members.length
  if (members.length === centers.length) return [mx, my]
  const [ux, uy] = regionAxis(members, centers)
  const push = ((members.length === 1 ? (centers.length === 3 ? 48 : 66) : 34) / VENN.r) * r
  return [mx + ux * push, my + uy * push]
}

/** Ancho de texto de una región (Sketchy: 112, 84 o 66 px con r = 135). */
const regionRoom = (members: number, three: boolean, r: number): number => ((members === 1 ? 112 : three && members === 2 ? 66 : 84) / VENN.r) * r

/**
 * Lo que se prueba en cada región antes de agrandar los círculos: anchos de columna (por el de Sketchy; con tres conjuntos,
 * las lentes de dos se quedan en 66 px y una palabra larga ya no cabría) y desplazamientos a lo largo de su eje (× r).
 */
const VENN_WIDTHS = [1, 1.25, 1.5, 1.8, 0.8]
const VENN_SHIFTS = [0, -0.06, 0.06, -0.12, 0.12, -0.18, 0.18]
/** Margen (px) entre la caja de un elemento y el borde de los círculos. */
const VENN_TOL = 3
/** Hasta este tamaño, los círculos crecen antes que partir una palabra por dentro; más allá, se parte (la figura no se dispara). */
const VENN_WORD_SCALE = 1.6

interface VennFit extends TextFit { /** ¿Alguna palabra es más ancha que la columna (se partiría por dentro)? */ broken: boolean }
interface RegionPlace { boxes: Box[]; center: Pt; ok: boolean; /** ¿Parte alguna palabra? */ broken: boolean }

/** Cajas de los elementos de una región, apiladas y centradas en `center`. */
function stackRegion(fits: VennFit[], center: Pt): Box[] {
  const total = fits.reduce((s, f) => s + f.h + 4, 0) + VENN.gap * (fits.length - 1)
  let y = center[1] - total / 2
  return fits.map((f) => {
    const box = { x: center[0] - f.w / 2 - 4, y, w: f.w + 8, h: f.h + 4 }
    y += box.h + VENN.gap
    return box
  })
}

/** Orden lexicográfico de dos puntuaciones (menor = mejor). */
const better = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/**
 * Coloca los elementos de una región: de los anchos y posiciones que caben en ella (dentro de sus círculos y fuera de los
 * demás), el que no parte palabras, ocupa menos alto, se aparta menos de su centro y es más estrecho. `ok` = falso si no
 * cabe ninguno (entonces se agranda la figura).
 */
function placeRegion(labels: string[], members: number[], centers: Pt[], r: number, room: number, fit: (text: string, w: number) => VennFit): RegionPlace {
  const base = regionCenter(members, centers, r)
  const [ux, uy] = regionAxis(members, centers)
  const inRegion = (b: Box): boolean => centers.every((c, i) => (members.includes(i) ? boxInCircle(b, c[0], c[1], r, VENN_TOL) : boxOutCircle(b, c[0], c[1], r, VENN_TOL)))
  let best: { boxes: Box[]; center: Pt; score: number[] } | undefined
  let fallback: { boxes: Box[]; center: Pt } | undefined
  for (const f of VENN_WIDTHS) {
    const fits = labels.map((t) => fit(t, room * f))
    const height = fits.reduce((s, x) => s + x.h, 0)
    const broken = fits.filter((x) => x.broken).length
    for (const sh of VENN_SHIFTS) {
      const center: Pt = [base[0] + ux * sh * r, base[1] + uy * sh * r]
      const boxes = stackRegion(fits, center)
      fallback ??= { boxes, center }
      if (!boxes.every(inRegion)) continue
      const score = [broken, height, Math.abs(sh), f]
      if (!best || better(score, best.score)) best = { boxes, center, score }
    }
  }
  return best ? { boxes: best.boxes, center: best.center, ok: true, broken: best.score[0] > 0 } : { ...fallback!, ok: false, broken: true }
}

/** ¿La caja está dentro del círculo (todas sus esquinas)? */
export function boxInCircle(b: Box, cx: number, cy: number, r: number, tol = 0): boolean {
  return [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= r - tol)
}
/** ¿La caja queda fuera del círculo (su punto más cercano al centro)? */
export function boxOutCircle(b: Box, cx: number, cy: number, r: number, tol = 0): boolean {
  const px = Math.max(b.x, Math.min(cx, b.x + b.w)), py = Math.max(b.y, Math.min(cy, b.y + b.h))
  return Math.hypot(px - cx, py - cy) >= r + tol
}

export function layoutVenn(b: DiagramBlock, measure: Measure): VennLayout | undefined {
  const m = vennModel(b)
  const k = m.sets.length
  if (k < 2) return undefined
  const three = k === 3
  const index = new Map(m.sets.map((s, i) => [s.id, i]))
  const regions = new Map<string, { sets: string[]; members: number[]; items: typeof m.items }>()
  const outsideItems = m.items.filter((it) => !it.sets.length)
  for (const it of m.items) {
    if (!it.sets.length) continue
    const key = it.sets.join('&')
    const r = regions.get(key) ?? { sets: it.sets, members: it.sets.map((s) => index.get(s)!).sort(), items: [] }
    r.items.push(it)
    regions.set(key, r)
  }
  // medidas de cada etiqueta por ancho (se prueban varios anchos en cada tamaño)
  const memo = new Map<string, VennFit>()
  const fit = (text: string, w: number): VennFit => {
    const key = `${Math.round(w * 4)}|${text}`
    let f = memo.get(key)
    if (!f) {
      const longest = Math.max(0, ...plainLabel(text).split(/\s+/).filter(Boolean).map((x) => measure(x, VENN.font, false)))
      f = { ...fitText(text, w, VENN.font, VENN.lh, false, measure), broken: longest > w }
      memo.set(key, f)
    }
    return f
  }
  // cada región busca dónde caben sus elementos; si alguna no cabe, los círculos crecen (como mucho 2,6 veces)
  let scale = 1
  let placed: { items: VennItemBox[]; centers: Pt[]; r: number; regionBoxes: VennRegionBox[] } | undefined
  for (let iter = 0; iter < 16; iter++) {
    const r = VENN.r * scale
    const centers = vennCenters(k, r)
    const items: VennItemBox[] = []
    const regionBoxes: VennRegionBox[] = []
    let ok = true
    for (const [key, reg] of regions) {
      const room = regionRoom(reg.members.length, three, r)
      const place = placeRegion(reg.items.map((it) => it.node.label), reg.members, centers, r, room, fit)
      if (!place.ok || (place.broken && scale < VENN_WORD_SCALE)) ok = false
      reg.items.forEach((it, i) => items.push({ id: it.node.id, node: it.node, box: place.boxes[i], sets: reg.sets, region: key }))
      const rb = boundsOf(place.boxes)
      regionBoxes.push({ key, sets: reg.sets, box: { x: rb.x - 4, y: rb.y - 4, w: rb.w + 8, h: rb.h + 8 }, center: place.center })
    }
    placed = { items, centers, r, regionBoxes }
    if (ok || scale > 2.6) break
    scale *= 1.07
  }
  const { items, centers, r, regionBoxes } = placed!
  // títulos: arriba de los círculos de arriba (hacia fuera) y debajo del tercero
  const circles: VennCircle[] = m.sets.map((node, i) => {
    const f = fitText(node.label, VENN.titleMax, VENN.titleFont, VENN.titleLh, true, measure, SERIF)
    const [cx, cy] = centers[i]
    const below = three && i === 2
    const off = three ? (i === 2 ? 0 : i ? 60 : -60) : i ? 40 : -40
    const tx = cx + off * Math.min(scale, 1.4)
    const title = below ? { x: tx - f.w / 2, y: cy + r + 8, w: f.w, h: f.h } : { x: tx - f.w / 2, y: cy - r - 8 - f.h, w: f.w, h: f.h }
    return { id: node.id, node, index: i, cx, cy, r, title, below }
  })
  // los dos títulos de arriba no se pisan
  const [t0, t1] = [circles[0].title, circles[1].title]
  const overlap = t0.x + t0.w + 14 - t1.x
  if (overlap > 0 && Math.abs(t0.y - t1.y) < Math.max(t0.h, t1.h)) {
    t0.x -= overlap / 2
    t1.x += overlap / 2
  }
  // lo de fuera: un rótulo y fichas en filas debajo
  const shapes = boundsOf(circles.map((c) => c.title), circles.flatMap((c) => [[c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]] as Pt[]))
  let outside: VennLayout['outside']
  if (outsideItems.length) {
    const rowW = Math.max(360, shapes.w)
    const label: Box = { x: shapes.x, y: shapes.y + shapes.h + 22, w: rowW, h: 18 }
    let x = shapes.x, y = label.y + label.h + 8, rowH = 0
    const chips: VennItemBox[] = []
    for (const it of outsideItems) {
      const f = fitText(it.node.label, 200, VENN.font, VENN.lh, false, measure)
      const w = f.w + 22, h = Math.max(VENN.chipH, f.h + 9)
      if (x > shapes.x && x + w > shapes.x + rowW) { x = shapes.x; y += rowH + 8; rowH = 0 }
      chips.push({ id: it.node.id, node: it.node, box: { x, y, w, h }, sets: [], region: '' })
      x += w + 8
      rowH = Math.max(rowH, h)
    }
    outside = { label, items: chips }
  }
  const all = boundsOf([shapes, ...items.map((i) => i.box), ...(outside ? [outside.label, ...outside.items.map((i) => i.box)] : [])])
  const dx = PAD - all.x, dy = PAD - all.y
  return {
    form: 'venn',
    circles: circles.map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy, title: moveBox(c.title, dx, dy) })),
    items: items.map((i) => ({ ...i, box: moveBox(i.box, dx, dy) })),
    regions: regionBoxes.map((g) => ({ ...g, box: moveBox(g.box, dx, dy), center: movePt(g.center, dx, dy) })),
    outside: outside ? { label: moveBox(outside.label, dx, dy), items: outside.items.map((i) => ({ ...i, box: moveBox(i.box, dx, dy) })) } : undefined,
    width: Math.ceil(all.w + 2 * PAD),
    height: Math.ceil(all.h + 2 * PAD)
  }
}

// MARK: Mapa mental

export interface MindBranch {
  id: string
  node: DiagramNode
  parent: string
  depth: number
  /** 1 = a la derecha de la idea central; −1 = a la izquierda. */
  side: 1 | -1
  /** El color con nombre de la rama principal (lo heredan sus subramas); undefined = tinta del curso. */
  color?: string
  /** Curva desde el final del trazo del padre (o la idea central) hasta el principio de su trazo. */
  curve: Pt[]
  /** Trazo sobre el que se apoya la etiqueta. */
  underline: [Pt, Pt]
  label: Box
  detail?: Box
  /** Orden de aparición (s). */
  order: number
}
export interface MindmapLayout {
  form: 'mindmap'
  root: { id: string; node: DiagramNode; cx: number; cy: number; rx: number; ry: number; label: Box }
  branches: MindBranch[]
  width: number
  height: number
}

export const MIND = { font1: 15, lh1: 20, font: 14, lh: 19, dFont: 12, dLh: 16, rootFont: 17, rootLh: 22, labelMax: 180, rootMax: 200, rowGap: 12 }

interface Measured { m: MindNode; lab: TextFit; det?: TextFit; own: number; height: number; children: Measured[] }

/**
 * Mapa mental a dos lados: la idea central en un óvalo y cada rama principal a la derecha o a la izquierda, llenando antes el
 * lado más corto. Cada rama ocupa una banda vertical con sus subramas dentro, así que dos etiquetas nunca se pisan.
 */
export function layoutMindmap(b: DiagramBlock, measure: Measure): MindmapLayout | undefined {
  const tree = mindmapTree(b)
  if (!tree) return undefined
  const measureNode = (m: MindNode): Measured => {
    const deep = m.depth > 1
    const lab = fitText(m.node.label, MIND.labelMax, deep ? MIND.font : MIND.font1, deep ? MIND.lh : MIND.lh1, !deep, measure)
    const text = m.node.detail?.trim()
    const det = text ? fitText(text, MIND.labelMax, MIND.dFont, MIND.dLh, false, measure) : undefined
    const own = lab.h + 3 + (det ? 3 + det.h : 0) + MIND.rowGap
    const children = m.children.map(measureNode)
    return { m, lab, det, own, height: Math.max(own, children.reduce((s, c) => s + c.height, 0)), children }
  }
  const rootFit = fitText(tree.root.node.label, MIND.rootMax, MIND.rootFont, MIND.rootLh, true, measure, SERIF)
  const rx = Math.max(70, rootFit.w / 2 + 28), ry = Math.max(38, rootFit.h / 2 + 18)
  const branches: MindBranch[] = []
  let seq = 0
  const place = (x0: Measured, side: 1 | -1, fromX: number, fromY: number, top: number, color: string | undefined, depth: number): void => {
    const { lab, det } = x0
    const contentTop = top + (x0.height - (x0.own - MIND.rowGap)) / 2
    const y = contentTop + lab.h + 3
    const x = fromX + side * (depth === 1 ? 62 : 44)
    const textW = Math.max(lab.w, det?.w ?? 0)
    const endX = x + side * (textW + 10)
    const mid = (fromX + x) / 2
    const curve: Pt[] = Array.from({ length: 19 }, (_, i) => {
      const t = i / 18, u = 1 - t
      return [u * u * u * fromX + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * x, u * u * u * fromY + 3 * u * u * t * fromY + 3 * u * t * t * y + t * t * t * y] as Pt
    })
    const own = x0.m.node.color?.trim() ? x0.m.node.color : color
    branches.push({
      id: x0.m.node.id, node: x0.m.node, parent: x0.m.parent ?? tree.root.node.id, depth, side, color: own, curve,
      underline: [[x, y], [endX, y]],
      label: { x: side > 0 ? x + 4 : x - 4 - lab.w, y: contentTop, w: lab.w, h: lab.h },
      detail: det ? { x: side > 0 ? x + 4 : x - 4 - det.w, y: y + 3, w: det.w, h: det.h } : undefined,
      order: depth * 0.22 + seq++ * 0.04
    })
    let childTop = top + (x0.height - x0.children.reduce((s, c) => s + c.height, 0)) / 2
    for (const c of x0.children) {
      place(c, side, endX, y, childTop, own, depth + 1)
      childTop += c.height
    }
  }
  // llena antes el lado más corto (las dos mitades se equilibran)
  const main = tree.root.children.map(measureNode)
  const sides: Measured[][] = [[], []]
  const heights = [0, 0]
  for (const c of main) {
    const s = heights[0] <= heights[1] ? 0 : 1
    sides[s].push(c)
    heights[s] += c.height
  }
  sides.forEach((list, s) => {
    const side = s === 0 ? 1 : -1
    let top = -heights[s] / 2
    for (const c of list) {
      place(c, side, side * rx * 0.85, 0, top, undefined, 1)
      top += c.height
    }
  })
  const rootLabel: Box = { x: -rootFit.w / 2, y: -rootFit.h / 2, w: rootFit.w, h: rootFit.h }
  const all = boundsOf([{ x: -rx, y: -ry, w: 2 * rx, h: 2 * ry }, ...branches.flatMap((x) => [x.label, ...(x.detail ? [x.detail] : [])])], branches.flatMap((x) => [...x.underline, ...x.curve]))
  const dx = PAD - all.x, dy = PAD - all.y
  return {
    form: 'mindmap',
    root: { id: tree.root.node.id, node: tree.root.node, cx: dx, cy: dy, rx, ry, label: moveBox(rootLabel, dx, dy) },
    branches: branches.map((x) => ({
      ...x,
      curve: x.curve.map((p) => movePt(p, dx, dy)),
      underline: [movePt(x.underline[0], dx, dy), movePt(x.underline[1], dx, dy)],
      label: moveBox(x.label, dx, dy),
      detail: x.detail ? moveBox(x.detail, dx, dy) : undefined
    })),
    width: Math.ceil(all.w + 2 * PAD),
    height: Math.ceil(all.h + 2 * PAD)
  }
}

// MARK: Entrada

export type FormLayout = PyramidLayout | VennLayout | MindmapLayout

/**
 * La disposición de la forma del diagrama; undefined si no tiene forma o no se puede dibujar como tal (un Venn sin dos
 * conjuntos): entonces se dibuja con su `kind` de base, como en una versión anterior.
 */
export function layoutForm(b: DiagramBlock, measure: Measure, opts: { detailsBeside?: boolean } = {}): FormLayout | undefined {
  if (!b.nodes.length) return undefined
  switch (b.form) {
    case 'pyramid': return layoutPyramid(b, measure, false, opts.detailsBeside ?? true)
    case 'funnel': return layoutPyramid(b, measure, true, opts.detailsBeside ?? true)
    case 'venn': return layoutVenn(b, measure)
    case 'mindmap': return layoutMindmap(b, measure)
    default: return undefined
  }
}
