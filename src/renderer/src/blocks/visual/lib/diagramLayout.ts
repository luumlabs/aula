// Disposición de los diagramas (flujo, mapa conceptual, árbol, ciclo, capas). Port de DiagramLayout en
// StudyUI/Blocks/DiagramView.swift con dagre para flujo/concepto/árbol (capas por rango, menos cruces y rutas de flecha) y una
// elipse para los ciclos. Lógica pura: la medida del texto se pasa como función (canvas en la interfaz, estimación en pruebas).
import dagre from '@dagrejs/dagre'
import type { DiagramBlock, DiagramEdge, DiagramNode } from '@shared/schema/blocks'

export type Pt = [number, number]
/** Ancho en px de un texto con la letra dada (`size` en px, `bold`). */
export type Measure = (text: string, size: number, bold: boolean) => number

export interface NodeBox { id: string; node: DiagramNode; x: number; y: number; w: number; h: number; /** orden de aparición */ order: number }
export interface EdgeRoute {
  key: string
  from: string
  to: string
  /** Camino SVG ya suavizado. */
  d: string
  /** Punta de flecha (camino SVG) o undefined. */
  head?: string
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

/** Líneas de un texto partido por palabras a un ancho máximo. */
export function wrapLines(text: string, maxW: number, size: number, bold: boolean, measure: Measure): number {
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
  return Math.min(lines, 8)
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

/** Como mucho 60 nodos (sin ids repetidos) y 200 flechas: con miles, la disposición tardaría segundos. */
export function cappedDiagram(b: DiagramBlock): DiagramBlock {
  const seen = new Set<string>()
  const nodes = b.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).slice(0, 60)
  return { ...b, nodes, edges: b.edges.slice(0, 200) }
}

/** Flechas efectivas: un ciclo sin flechas escritas une cada nodo con el siguiente. */
export function effectiveEdges(b: DiagramBlock): DiagramEdge[] {
  if (b.kind === 'cycle' && b.edges.length === 0 && b.nodes.length > 1) {
    return b.nodes.map((n, i) => ({ from: n.id, to: b.nodes[(i + 1) % b.nodes.length].id, dashed: false, arrow: true }))
  }
  return b.edges
}

export const edgeKey = (from: string, to: string): string => `${from}>${to}`

/** Nodos y flechas resaltados en el paso k (las flechas entre dos nodos resaltados también; sin flechas escritas, la que llega). */
export function stepHighlight(b: DiagramBlock, k: number | null): { nodes: Set<string>; edges: Set<string> } | undefined {
  if (k === null || k < 0 || k >= b.steps.length) return undefined
  const st = b.steps[k]
  const nodes = new Set(st.nodes)
  const edges = new Set(st.edges.filter((e) => e.length === 2).map((e) => edgeKey(e[0], e[1])))
  const eff = effectiveEdges(b)
  for (const e of eff) if (nodes.has(e.from) && nodes.has(e.to)) edges.add(edgeKey(e.from, e.to))
  if (st.edges.length === 0 && k > 0) {
    const prev = new Set(b.steps[k - 1].nodes)
    for (const e of eff) if (prev.has(e.from) && nodes.has(e.to)) edges.add(edgeKey(e.from, e.to))
  }
  return { nodes, edges }
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
    if (e.arrow) pts[pts.length - 1] = pullBack(prev, tip, 7)
    const label = e.label?.trim() ? e.label.slice(0, 200) : undefined
    const at: Pt | undefined = label ? (ge && Number.isFinite(ge.x) ? [ge.x as number, ge.y as number] : midOf(pts)) : undefined
    return { key: edgeKey(e.from, e.to), from: e.from, to: e.to, d: basisPath(pts), head: e.arrow ? headPath(prev, tip) : undefined, label, labelAt: at, dashed: e.dashed, order: Math.max(order.get(e.from) ?? 0, 0) + i * 0.001 }
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

function layoutCycle(b: DiagramBlock, sizes: Map<string, { w: number; h: number }>): DiagramLayout {
  const n = b.nodes.length
  const maxW = Math.max(...[...sizes.values()].map((s) => s.w)), maxH = Math.max(...[...sizes.values()].map((s) => s.h))
  const r = Math.max(120, (n * (maxW + 26)) / (2 * Math.PI))
  const rx = Math.max(r, 160), ry = Math.max(r * 0.72, 118)
  const cx = rx + maxW / 2 + PAD, cy = ry + maxH / 2 + PAD
  const nodes: NodeBox[] = b.nodes.map((node, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    const s = sizes.get(node.id)!
    return { id: node.id, node, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), w: s.w, h: s.h, order: i }
  })
  const byId = new Map(nodes.map((x) => [x.id, x]))
  const edges: EdgeRoute[] = []
  const seen = new Set<string>()
  effectiveEdges(b).forEach((e, i) => {
    const a = byId.get(e.from), z = byId.get(e.to)
    if (!a || !z || e.from === e.to || seen.has(edgeKey(e.from, e.to))) return
    seen.add(edgeKey(e.from, e.to))
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
    const label = e.label?.trim() ? e.label.slice(0, 200) : undefined
    const at: Pt = [0.25 * p0[0] + 0.5 * ctrl[0] + 0.25 * tip[0], 0.25 * p0[1] + 0.5 * ctrl[1] + 0.25 * tip[1]]
    edges.push({ key: edgeKey(e.from, e.to), from: e.from, to: e.to, d, head: e.arrow ? headPath(ctrl, tip) : undefined, label, labelAt: label ? at : undefined, dashed: e.dashed, order: (byId.get(e.from)?.order ?? i) + 0.5 })
  })
  return { nodes, edges, width: Math.ceil(2 * cx), height: Math.ceil(2 * cy), cycle: { cx, cy, rx, ry } }
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
