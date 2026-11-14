// Disposición de los diagramas (flujo, mapa conceptual, árbol, ciclo, capas). Port de DiagramLayout en
// StudyUI/Blocks/DiagramView.swift con dagre para flujo/concepto/árbol (capas por rango, menos cruces y rutas de flecha) y una
// elipse para los ciclos. Lógica pura: la medida del texto se pasa como función (canvas en la interfaz, estimación en pruebas).
// Las flechas de un ciclo van por la pista y se cortan en las cajas, y las puntas abiertas se dibujan a tinta: adaptado de
// Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/templates.ts cycle() y reach(), y
// viewer/src/draw.ts arrowHead().
import dagre from '@dagrejs/dagre'
import { DIAGRAM_MAX_EDGES, DIAGRAM_MAX_NODES } from '@engine/content/diagram-forms'
import type { DiagramBlock, DiagramEdge, DiagramNode } from '@shared/schema/blocks'

export type Pt = [number, number]
/** Ancho en px de un texto con la letra dada (`size` en px, `bold`). */
export type Measure = (text: string, size: number, bold: boolean) => number

export interface NodeBox { id: string; node: DiagramNode; x: number; y: number; w: number; h: number; /** orden de aparición */ order: number }
export interface EdgeRoute {
  key: string
  from: string
  to: string
  /** Camino SVG ya suavizado (acaba antes de la punta rellena, para imprimir). */
  d: string
  /** Punta de flecha (camino SVG) o undefined. */
  head?: string
  /** La curva muestreada (~cada 6 px) hasta la misma punta, para dibujarla a tinta. */
  pts: Pt[]
  /** Punta abierta (barba, punta, barba) o undefined. */
  barbs?: [Pt, Pt, Pt]
  label?: string
  labelAt?: Pt
  dashed: boolean
  order: number
}
export interface DiagramLayout { nodes: NodeBox[]; edges: EdgeRoute[]; width: number; height: number; cycle?: { cx: number; cy: number; rx: number; ry: number } }

export const NODE_FONT = 14
const DETAIL_FONT = 12

/** Ancho aproximado sin medir: ~0,56 em por letra latina y 1 em por ideograma (chino, japonés, coreano). */
export const estimateMeasure: Measure = (text, size) => {
  let ems = 0
  for (const ch of text) {
    const u = ch.codePointAt(0) ?? 0
    const wide = (u >= 0x1100 && u <= 0x115f) || (u >= 0x2e80 && u <= 0xa4cf) || (u >= 0xac00 && u <= 0xd7a3) || (u >= 0xf900 && u <= 0xfaff) || (u >= 0xff00 && u <= 0xff60)
    ems += wide ? 1 : 0.56
  }
  return ems * size
}

/** Texto visible de una etiqueta con fórmulas (sin `$` ni órdenes de LaTeX), para medirla. */
export function plainLabel(s: string): string {
  return s.replace(/\$\$?/g, '').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_]/g, '')
}

/**
 * Ancho de una etiqueta con fórmulas: el texto normal con la medida dada y cada fórmula `$…$` estimada (KaTeX usa letra serif
 * algo más ancha y cada orden — \\ge, \\alpha — ocupa un símbolo).
 */
export function measureLabel(text: string, size: number, bold: boolean, measure: Measure): number {
  let w = 0
  text.split(/(\$\$?[^$]*\$\$?)/).forEach((part) => {
    if (part.startsWith('$')) {
      const body = part.replace(/\$/g, '')
      const cmds = (body.match(/\\[a-zA-Z]+/g) ?? []).length
      const plain = body.replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_\s]/g, '')
      w += (plain.length * 0.62 + cmds * 0.9) * size * 1.05 + 4
    } else if (part) w += measure(part, size, bold)
  })
  return w
}

/** Líneas de un texto partido por palabras a un ancho máximo (como mucho `cap`: las cajas de los nodos cortan el resto). */
export function wrapLines(text: string, maxW: number, size: number, bold: boolean, measure: Measure, cap = 8): number {
  const words = plainLabel(text).split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  let lines = 1, cur = 0
  const space = measure(' ', size, bold)
  for (const w of words) {
    const ww = measure(w, size, bold)
    if (cur === 0) cur = ww
    else if (cur + space + ww <= maxW) cur += space + ww
    else { lines++; cur = ww }
    // una palabra más larga que la línea ocupa varias
    if (ww > maxW) { lines += Math.floor(ww / maxW); cur = ww % maxW }
  }
  return Math.min(lines, cap)
}

/** Medidas de un nodo: ancho según su etiqueta (entre 104 y 230 px) y alto por líneas, más la explicación si la tiene. */
export function nodeSize(n: DiagramNode, measure: Measure): { w: number; h: number } {
  const pad = 34
  const natural = measureLabel(n.label, NODE_FONT, true, measure)
  let w = Math.min(230, Math.max(104, natural + pad))
  const detail = n.detail?.trim() ? n.detail : undefined
  if (detail) w = Math.max(w, Math.min(230, measureLabel(detail, DETAIL_FONT, false, measure) * 0.6 + pad))
  const lines = wrapLines(n.label, w - pad + 2, NODE_FONT, true, measure)
  const dLines = detail ? Math.min(3, wrapLines(detail, w - pad, DETAIL_FONT, false, measure)) : 0
  let h = lines * 19 + (dLines ? 4 + dLines * 16 : 0) + 20
  if (n.shape === 'diamond') { w = w * 1.42; h = h * 1.5 }
  if (n.shape === 'circle') { const s = Math.max(w * 0.82, h * 1.3); w = Math.max(w, s); h = Math.max(h, Math.min(s, w * 0.8)) }
  return { w: Math.round(w), h: Math.round(Math.max(h, 40)) }
}

/** Como mucho 60 nodos (sin ids repetidos) y 200 flechas: con miles, la disposición tardaría segundos (el validador lo avisa). */
export function cappedDiagram(b: DiagramBlock): DiagramBlock {
  const seen = new Set<string>()
  const nodes = b.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).slice(0, DIAGRAM_MAX_NODES)
  return { ...b, nodes, edges: b.edges.slice(0, DIAGRAM_MAX_EDGES) }
}

/** Flechas efectivas: un ciclo sin flechas escritas une cada nodo con el siguiente. */
export function effectiveEdges(b: DiagramBlock): DiagramEdge[] {
  if (b.kind === 'cycle' && b.edges.length === 0 && b.nodes.length > 1) {
    return b.nodes.map((n, i) => ({ from: n.id, to: b.nodes[(i + 1) % b.nodes.length].id, dashed: false, arrow: true }))
  }
  return b.edges
}

export const edgeKey = (from: string, to: string): string => `${from}>${to}`

export interface StepLight {
  /** Lo que sigue encendido (lo rodeado y los extremos de las flechas del paso). */
  nodes: Set<string>
  edges: Set<string>
  /** Lo que el paso rodea a pluma (sus `nodes`). */
  focus: Set<string>
}

/**
 * Nodos y flechas resaltados en el paso k: los `nodes` del paso se rodean; los extremos de sus `edges` siguen encendidos sin
 * rodearse; las flechas entre dos nodos encendidos también (sin flechas escritas, la que llega del paso anterior). Un paso
 * que no señala nada (la vista general o el repaso) no apaga nada: undefined, como sin paso.
 */
export function stepHighlight(b: DiagramBlock, k: number | null): StepLight | undefined {
  if (k === null || k < 0 || k >= b.steps.length) return undefined
  const st = b.steps[k]
  if (!st.nodes.length && !st.edges.some((e) => e.length === 2)) return undefined
  const focus = new Set(st.nodes)
  const nodes = new Set(st.nodes)
  const pairs = st.edges.filter((e) => e.length === 2)
  for (const [a, z] of pairs) { nodes.add(a); nodes.add(z) }
  const edges = new Set(pairs.map((e) => edgeKey(e[0], e[1])))
  const eff = effectiveEdges(b)
  for (const e of eff) if (nodes.has(e.from) && nodes.has(e.to)) edges.add(edgeKey(e.from, e.to))
  if (st.edges.length === 0 && k > 0) {
    const prev = new Set(b.steps[k - 1].nodes)
    for (const e of eff) if (prev.has(e.from) && nodes.has(e.to)) edges.add(edgeKey(e.from, e.to))
  }
  return { nodes, edges, focus }
}

// MARK: Caminos

const r2 = (v: number): string => (Math.round(v * 10) / 10).toString()

/** Curva B-spline uniforme por los puntos (pasa por el primero y el último), como `d3.curveBasis`. */
export function basisPath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${r2(pts[0][0])} ${r2(pts[0][1])}`
  if (pts.length === 2) return `M${r2(pts[0][0])} ${r2(pts[0][1])}L${r2(pts[1][0])} ${r2(pts[1][1])}`
  let out = `M${r2(pts[0][0])} ${r2(pts[0][1])}`
  let [x0, y0] = pts[0], [x1, y1] = pts[1]
  out += `L${r2((5 * x0 + x1) / 6)} ${r2((5 * y0 + y1) / 6)}`
  const bez = (x: number, y: number): void => {
    out += `C${r2((2 * x0 + x1) / 3)} ${r2((2 * y0 + y1) / 3)} ${r2((x0 + 2 * x1) / 3)} ${r2((y0 + 2 * y1) / 3)} ${r2((x0 + 4 * x1 + x) / 6)} ${r2((y0 + 4 * y1 + y) / 6)}`
  }
  for (let i = 2; i < pts.length; i++) {
    const [x, y] = pts[i]
    bez(x, y)
    x0 = x1; y0 = y1; x1 = x; y1 = y
  }
  bez(x1, y1)
  out += `L${r2(x1)} ${r2(y1)}`
  return out
}

/** Puntos de la misma curva que `basisPath`, uno cada ~`step` px (para la tinta). */
export function basisPoints(pts: Pt[], step = 6): Pt[] {
  if (pts.length < 3) return pts.length === 2 ? lineSamples(pts[0], pts[1], step) : pts.slice()
  const out: Pt[] = [pts[0]]
  const lineTo = (p: Pt): void => { out.push(...lineSamples(out[out.length - 1], p, step).slice(1)) }
  const cubic = (p0: Pt, c1: Pt, c2: Pt, p3: Pt): void => {
    const len = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p3[0] - c2[0], p3[1] - c2[1])
    const n = Math.max(2, Math.ceil(len / step))
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t
      out.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]])
    }
  }
  let [x0, y0] = pts[0], [x1, y1] = pts[1]
  lineTo([(5 * x0 + x1) / 6, (5 * y0 + y1) / 6])
  const bez = (x: number, y: number): void => {
    cubic(out[out.length - 1], [(2 * x0 + x1) / 3, (2 * y0 + y1) / 3], [(x0 + 2 * x1) / 3, (y0 + 2 * y1) / 3], [(x0 + 4 * x1 + x) / 6, (y0 + 4 * y1 + y) / 6])
  }
  for (let i = 2; i < pts.length; i++) {
    const [x, y] = pts[i]
    bez(x, y)
    x0 = x1; y0 = y1; x1 = x; y1 = y
  }
  bez(x1, y1)
  lineTo([x1, y1])
  return out
}

function lineSamples(a: Pt, b: Pt, step: number): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt)
}

/** Punta abierta (barba, punta, barba) en `tip`, llegando desde `from` (como Sketchy: dos trazos, sin relleno). */
export function openHead(from: Pt, tip: Pt, len = 11, spread = 0.45): [Pt, Pt, Pt] {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  return [[tip[0] - len * Math.cos(a - spread), tip[1] - len * Math.sin(a - spread)], tip, [tip[0] - len * Math.cos(a + spread), tip[1] - len * Math.sin(a + spread)]]
}

/** El punto de una polilínea a `back` px de su final (para orientar la punta). */
function pointBack(pts: Pt[], back: number): Pt {
  let left = back
  for (let i = pts.length - 1; i > 0; i--) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (d >= left) {
      const k = left / (d || 1)
      return [pts[i][0] + (pts[i - 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i - 1][1] - pts[i][1]) * k]
    }
    left -= d
  }
  return pts[0]
}

/** Punta de flecha (triángulo de 9 px) en `tip`, llegando desde `from`. */
export function headPath(from: Pt, tip: Pt, len = 9, spread = 0.42): string {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  const p1: Pt = [tip[0] - len * Math.cos(a - spread), tip[1] - len * Math.sin(a - spread)]
  const p2: Pt = [tip[0] - len * Math.cos(a + spread), tip[1] - len * Math.sin(a + spread)]
  return `M${r2(tip[0])} ${r2(tip[1])}L${r2(p1[0])} ${r2(p1[1])}L${r2(p2[0])} ${r2(p2[1])}Z`
}

/** Punto del borde de la figura del nodo en la dirección de `toward` (rectángulo, elipse o rombo). */
export function clipToNode(b: NodeBox, toward: Pt, gap = 0): Pt {
  const cx = b.x, cy = b.y
  const dx = toward[0] - cx, dy = toward[1] - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const hw = b.w / 2 + gap, hh = b.h / 2 + gap
  let s: number
  switch (b.node.shape) {
    case 'circle': s = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh)); break
    case 'diamond': s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh); break
    default: s = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy))
  }
  return [cx + dx * s, cy + dy * s]
}

/** Recorta el final de un camino `len` px (para que la línea no asome por la punta). */
function pullBack(from: Pt, tip: Pt, len: number): Pt {
  const dx = tip[0] - from[0], dy = tip[1] - from[1], l = Math.hypot(dx, dy)
  if (l < 1e-6) return tip
  const k = Math.max(0, l - len) / l
  return [from[0] + dx * k, from[1] + dy * k]
}

// MARK: Disposición

export function layoutDiagram(raw: DiagramBlock, measure: Measure = estimateMeasure): DiagramLayout {
  const b = cappedDiagram(raw)
  if (!b.nodes.length) return { nodes: [], edges: [], width: 0, height: 0 }
  const sizes = new Map(b.nodes.map((n) => [n.id, nodeSize(n, measure)]))
  switch (b.kind) {
    case 'cycle': return layoutCycle(b, sizes)
    case 'layers': return layoutLayers(b, sizes)
    default: return layoutGraph(b, sizes, measure)
  }
}

const PAD = 16

function layoutGraph(b: DiagramBlock, sizes: Map<string, { w: number; h: number }>, measure: Measure): DiagramLayout {
  const lr = b.direction.toLowerCase() === 'lr'
  const g = new dagre.graphlib.Graph({ multigraph: false })
  g.setGraph({ rankdir: lr ? 'LR' : 'TB', nodesep: lr ? 22 : 30, ranksep: lr ? 62 : 50, edgesep: 14, marginx: PAD, marginy: PAD, ranker: b.kind === 'tree' ? 'longest-path' : 'network-simplex' })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of b.nodes) {
    const s = sizes.get(n.id)!
    g.setNode(n.id, { width: s.w, height: s.h })
  }
  const ids = new Set(b.nodes.map((n) => n.id))
  const edges: DiagramEdge[] = []
  const seen = new Set<string>()
  for (const e of effectiveEdges(b)) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue
    const k = edgeKey(e.from, e.to)
    if (seen.has(k)) continue
    seen.add(k)
    edges.push(e)
    const label = e.label?.trim() ? e.label.slice(0, 200) : undefined
    const lw = label ? Math.min(180, measureLabel(label, 12, false, measure) + 16) : 0
    g.setEdge(e.from, e.to, label ? { width: lw, height: 22, labelpos: 'c', minlen: 1 } : { minlen: 1 })
  }
  dagre.layout(g)
  const order = rankOrder(b, edges)
  const nodes: NodeBox[] = b.nodes.map((n) => {
    const v = g.node(n.id)
    const s = sizes.get(n.id)!
    return { id: n.id, node: n, x: v.x, y: v.y, w: s.w, h: s.h, order: order.get(n.id) ?? 0 }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const routes: EdgeRoute[] = edges.map((e, i) => {
    const ge = g.edge(e.from, e.to)
    const pts: Pt[] = (ge?.points ?? []).map((p) => [p.x, p.y] as Pt)
    const a = byId.get(e.from)!, z = byId.get(e.to)!
    if (pts.length < 2) pts.splice(0, pts.length, [a.x, a.y], [z.x, z.y])
    // los extremos, sobre el borde real de la figura (dagre recorta con el rectángulo)
    pts[0] = clipToNode(a, pts[1])
    pts[pts.length - 1] = clipToNode(z, pts[pts.length - 2], e.arrow ? 1.5 : 0)
    const tip = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const ink = basisPoints(pts)
    const barbs = e.arrow ? openHead(pointBack(ink, 8), tip) : undefined
    if (e.arrow) pts[pts.length - 1] = pullBack(prev, tip, 7)
    const label = e.label?.trim() ? e.label.slice(0, 200) : undefined
    const at: Pt | undefined = label ? (ge && Number.isFinite(ge.x) ? [ge.x as number, ge.y as number] : midOf(pts)) : undefined
    return { key: edgeKey(e.from, e.to), from: e.from, to: e.to, d: basisPath(pts), head: e.arrow ? headPath(prev, tip) : undefined, pts: ink, barbs, label, labelAt: at, dashed: e.dashed, order: Math.max(order.get(e.from) ?? 0, 0) + i * 0.001 }
  })
  const gl = g.graph()
  return { nodes, edges: routes, width: Math.ceil(gl.width ?? 0), height: Math.ceil(gl.height ?? 0) }
}

function midOf(pts: Pt[]): Pt {
  const k = Math.floor((pts.length - 1) / 2)
  if (pts.length % 2 === 1) return pts[k]
  return [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2]
}

/** Orden de aparición: por niveles desde las fuentes (BFS), para que el diagrama «crezca» siguiendo las flechas. */
export function rankOrder(b: DiagramBlock, edges: DiagramEdge[]): Map<string, number> {
  const out = new Map<string, number>()
  const succ = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of b.nodes) { succ.set(n.id, []); indeg.set(n.id, 0) }
  for (const e of edges) {
    if (!succ.has(e.from) || !succ.has(e.to)) continue
    succ.get(e.from)!.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }
  let frontier = b.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  if (!frontier.length && b.nodes.length) frontier = [b.nodes[0].id]
  let level = 0
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      if (out.has(id)) continue
      out.set(id, level)
      for (const s of succ.get(id) ?? []) if (!out.has(s)) next.push(s)
    }
    frontier = next
    level++
    if (!frontier.length) {
      const rest = b.nodes.find((n) => !out.has(n.id))
      if (rest) frontier = [rest.id]
    }
  }
  return out
}

/** Hueco entre la caja y el principio o la punta de una flecha del ciclo (px). */
const CYCLE_GAP = 6
/** Lo mínimo que tiene que quedar de pista entre dos vecinos para que se lea la flecha (px). */
const CYCLE_MIN_ARC = 30

const insideBox = (p: Pt, n: NodeBox, gap: number): boolean => Math.abs(p[0] - n.x) <= n.w / 2 + gap && Math.abs(p[1] - n.y) <= n.h / 2 + gap

/**
 * Arco de la pista de un nodo al siguiente (en el sentido del ciclo), cortado donde sale de una caja y donde entra en la
 * otra. `dir` 1 avanza el ángulo; −1 vuelve atrás (va un poco por dentro para no pisar la flecha de ida).
 */
function cycleArc(c: { cx: number; cy: number; rx: number; ry: number }, a: NodeBox, z: NodeBox, a0: number, a1: number, inset = 0): Pt[] {
  const rx = c.rx - inset, ry = c.ry - inset
  const span = a1 - a0
  const n = Math.max(24, Math.ceil((Math.abs(span) * Math.max(rx, ry)) / 3))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = a0 + (span * i) / n
    const p: Pt = [c.cx + rx * Math.cos(t), c.cy + ry * Math.sin(t)]
    if (insideBox(p, a, CYCLE_GAP) || insideBox(p, z, CYCLE_GAP)) {
      if (out.length) break
      continue
    }
    out.push(p)
  }
  return out
}

const arcLength = (pts: Pt[]): number => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)

function layoutCycle(b: DiagramBlock, sizes: Map<string, { w: number; h: number }>): DiagramLayout {
  const n = b.nodes.length
  const maxW = Math.max(...[...sizes.values()].map((s) => s.w)), maxH = Math.max(...[...sizes.values()].map((s) => s.h))
  const r = Math.max(120, (n * (maxW + 26)) / (2 * Math.PI))
  let rx = Math.max(r, 160), ry = Math.max(r * 0.72, 118)
  const angle = (i: number): number => -Math.PI / 2 + (2 * Math.PI * i) / n
  const place = (): { nodes: NodeBox[]; c: { cx: number; cy: number; rx: number; ry: number } } => {
    const cx = rx + maxW / 2 + PAD, cy = ry + maxH / 2 + PAD
    const nodes = b.nodes.map((node, i) => {
      const s = sizes.get(node.id)!
      return { id: node.id, node, x: cx + rx * Math.cos(angle(i)), y: cy + ry * Math.sin(angle(i)), w: s.w, h: s.h, order: i }
    })
    return { nodes, c: { cx, cy, rx, ry } }
  }
  // la pista crece hasta que ningún par de vecinos se toca y entre ellos queda sitio para la flecha
  let placed = place()
  for (let iter = 0; iter < 40 && n > 1; iter++) {
    const ok = placed.nodes.every((a, i) => {
      const z = placed.nodes[(i + 1) % n]
      const crowd = Math.abs(a.x - z.x) * 2 < a.w + z.w + 2 * CYCLE_GAP && Math.abs(a.y - z.y) * 2 < a.h + z.h + 2 * CYCLE_GAP
      return !crowd && arcLength(cycleArc(placed.c, a, z, angle(i), angle(i) + (2 * Math.PI) / n)) >= CYCLE_MIN_ARC
    })
    if (ok) break
    rx *= 1.07
    ry = Math.max(ry * 1.07, rx * 0.72)
    placed = place()
  }
  const { nodes, c } = placed
  const { cx, cy } = c
  const byId = new Map(nodes.map((x) => [x.id, x]))
  const index = new Map(nodes.map((x, i) => [x.id, i]))
  const edges: EdgeRoute[] = []
  const seen = new Set<string>()
  effectiveEdges(b).forEach((e, i) => {
    const a = byId.get(e.from), z = byId.get(e.to)
    if (!a || !z || e.from === e.to || seen.has(edgeKey(e.from, e.to))) return
    seen.add(edgeKey(e.from, e.to))
    const ia = index.get(e.from)!, iz = index.get(e.to)!
    const label = e.label?.trim() ? e.label.slice(0, 200) : undefined
    const order = (byId.get(e.from)?.order ?? i) + 0.5
    // vecinos: la flecha va por la pista (la de vuelta, un poco por dentro)
    const forward = (ia + 1) % n === iz
    const backward = !forward && (iz + 1) % n === ia
    if (forward || backward) {
      const a0 = angle(ia), a1 = forward ? angle(ia) + (2 * Math.PI) / n : angle(ia) - (2 * Math.PI) / n
      const arc = cycleArc(c, a, z, a0, a1, backward ? 14 : 0)
      if (arc.length >= 2) {
        const tip = arc[arc.length - 1]
        const body = e.arrow ? cutEnd(arc, 7) : arc
        const mid = arc[Math.floor(arc.length / 2)]
        const out = Math.hypot(mid[0] - cx, mid[1] - cy) || 1
        const at: Pt = [mid[0] + ((mid[0] - cx) / out) * 16, mid[1] + ((mid[1] - cy) / out) * 16]
        edges.push({
          key: edgeKey(e.from, e.to), from: e.from, to: e.to, d: polyPath(body), head: e.arrow ? headPath(pointBack(arc, 9), tip) : undefined,
          pts: thin(arc, 6), barbs: e.arrow ? openHead(pointBack(arc, 8), tip) : undefined, label, labelAt: label ? at : undefined, dashed: e.dashed, order
        })
        return
      }
    }
    // arco hacia fuera: el punto de control se aleja del centro del ciclo
    const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2
    let ox = mx - cx, oy = my - cy
    const ol = Math.hypot(ox, oy) || 1
    ox /= ol; oy /= ol
    const chord = Math.hypot(z.x - a.x, z.y - a.y)
    const ctrl: Pt = [mx + ox * chord * 0.22, my + oy * chord * 0.22]
    const p0 = clipToNode(a, ctrl, 3)
    const tip = clipToNode(z, ctrl, 4)
    const end = e.arrow ? pullBack(ctrl, tip, 7) : tip
    const d = `M${r2(p0[0])} ${r2(p0[1])}Q${r2(ctrl[0])} ${r2(ctrl[1])} ${r2(end[0])} ${r2(end[1])}`
    const at: Pt = [0.25 * p0[0] + 0.5 * ctrl[0] + 0.25 * tip[0], 0.25 * p0[1] + 0.5 * ctrl[1] + 0.25 * tip[1]]
    const ink = quadPoints(p0, ctrl, tip)
    edges.push({ key: edgeKey(e.from, e.to), from: e.from, to: e.to, d, head: e.arrow ? headPath(ctrl, tip) : undefined, pts: ink, barbs: e.arrow ? openHead(pointBack(ink, 8), tip) : undefined, label, labelAt: label ? at : undefined, dashed: e.dashed, order })
  })
  return { nodes, edges, width: Math.ceil(2 * cx), height: Math.ceil(2 * cy), cycle: c }
}

/** Quita `len` px del final de una polilínea. */
function cutEnd(pts: Pt[], len: number): Pt[] {
  const end = pointBack(pts, len)
  let left = len
  let i = pts.length - 1
  while (i > 0) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (d >= left) break
    left -= d
    i--
  }
  return [...pts.slice(0, i), end]
}

/** Uno de cada pocos puntos (la tinta no necesita más de uno cada ~`step` px). */
function thin(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= step) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
}

const polyPath = (pts: Pt[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${r2(p[0])} ${r2(p[1])}`).join('')

function quadPoints(p0: Pt, c: Pt, p1: Pt, n = 24): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t
    return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]] as Pt
  })
}

function layoutLayers(b: DiagramBlock, sizes: Map<string, { w: number; h: number }>): DiagramLayout {
  const w = Math.min(560, Math.max(...[...sizes.values()].map((s) => s.w)) + 140)
  let y = PAD
  const nodes: NodeBox[] = b.nodes.map((node, i) => {
    const h = Math.max(48, sizes.get(node.id)!.h)
    const box: NodeBox = { id: node.id, node, x: PAD + w / 2, y: y + h / 2, w, h, order: i }
    y += h + 12
    return box
  })
  return { nodes, edges: [], width: Math.ceil(w + 2 * PAD), height: Math.ceil(y - 12 + PAD) }
}
