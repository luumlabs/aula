// Modelos de las formas ya hechas de los diagramas (puro): niveles de una pirámide o un embudo, conjuntos y regiones de un
// diagrama de Venn, el árbol de un mapa mental y lo que ya se ve en cada paso cuando los pasos construyen la figura. Lo usan
// la interfaz (para dibujar), el validador y la exportación a Markdown.
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/templates.ts venn() (regiones por
// pertenencia) y mindmap() (ramas), y src/scene/builder.ts (reglas de las plantillas).
import type { DiagramBlock, DiagramEdge, DiagramNode } from '@shared/schema'

/** Lo que se dibuja de un diagrama como mucho (con miles, la disposición tardaría segundos); el validador avisa de lo que sobra. */
export const DIAGRAM_MAX_NODES = 60
export const DIAGRAM_MAX_EDGES = 200

// MARK: Pirámide y embudo

/** Los niveles de arriba abajo (el primero es la cúspide de la pirámide o la boca del embudo). */
export const pyramidLevels = (b: DiagramBlock): DiagramNode[] => b.nodes

// MARK: Venn

export interface VennItem { node: DiagramNode; /** Ids de sus conjuntos, en el orden de los conjuntos. */ sets: string[] }
export interface VennModel {
  /** Los conjuntos: los nodos con `shape: "circle"` (los 3 primeros). */
  sets: DiagramNode[]
  items: VennItem[]
  /** Flechas que no unen un elemento con un conjunto (se ignoran al dibujar). */
  stray: DiagramEdge[]
}

export function vennModel(b: DiagramBlock): VennModel {
  const sets = b.nodes.filter((n) => n.shape === 'circle').slice(0, 3)
  const setIds = new Set(sets.map((s) => s.id))
  const order = new Map(sets.map((s, i) => [s.id, i]))
  const member = new Map<string, Set<string>>()
  const stray: DiagramEdge[] = []
  const nodeIds = new Set(b.nodes.map((n) => n.id))
  for (const e of b.edges) {
    // elemento → conjunto (y, por tolerancia, conjunto → elemento)
    const [item, set] = setIds.has(e.to) && !setIds.has(e.from) ? [e.from, e.to] : setIds.has(e.from) && !setIds.has(e.to) ? [e.to, e.from] : [undefined, undefined]
    if (item === undefined || set === undefined || !nodeIds.has(item)) { stray.push(e); continue }
    const m = member.get(item) ?? new Set<string>()
    m.add(set)
    member.set(item, m)
  }
  const items = b.nodes
    .filter((n) => !setIds.has(n.id))
    .map((node) => ({ node, sets: [...(member.get(node.id) ?? [])].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0)) }))
  return { sets, items, stray }
}

/** Clave de una región: los ids de sus conjuntos unidos por «&» («» = fuera de todos). */
export const regionKey = (sets: readonly string[]): string => sets.join('&')

export interface VennRegion { key: string; sets: string[]; items: VennItem[] }

/** Las regiones con algo dentro: primero las de un conjunto, luego las intersecciones y al final lo de fuera. */
export function vennRegions(m: VennModel): VennRegion[] {
  const by = new Map<string, VennRegion>()
  for (const it of m.items) {
    const key = regionKey(it.sets)
    const r = by.get(key) ?? { key, sets: it.sets, items: [] }
    r.items.push(it)
    by.set(key, r)
  }
  const rank = (r: VennRegion): number => (r.sets.length === 0 ? 99 : r.sets.length)
  return [...by.values()].sort((a, b) => rank(a) - rank(b))
}

// MARK: Mapa mental

export interface MindNode { node: DiagramNode; depth: number; children: MindNode[]; parent?: string }
export interface MindTree {
  root: MindNode
  /** Cuántos nodos no tienen flecha de entrada (debería haber una sola raíz). */
  roots: number
  /** Flechas que sobran para un árbol (segundo padre, vuelta atrás o hacia sí mismo). */
  extra: DiagramEdge[]
  /** ¿Alguna flecha vuelve hacia un antepasado? */
  cyclic: boolean
  /** Nivel más hondo (la raíz es 0). */
  depth: number
}

/**
 * Árbol de un mapa mental: la raíz es el primer nodo sin flecha de entrada (o el primero) y cada nodo cuelga del primer
 * padre que lo alcanza. Lo que no se alcanza desde la raíz cuelga de ella (no se pierde nada).
 */
export function mindmapTree(b: DiagramBlock): MindTree | undefined {
  if (!b.nodes.length) return undefined
  const ids = new Set(b.nodes.map((n) => n.id))
  const byId = new Map(b.nodes.map((n) => [n.id, n]))
  const valid = b.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  const indeg = new Map<string, number>()
  for (const e of valid) if (e.from !== e.to) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const sources = b.nodes.filter((n) => !indeg.get(n.id))
  const rootNode = sources[0] ?? b.nodes[0]
  const succ = new Map<string, DiagramEdge[]>()
  for (const e of valid) succ.set(e.from, [...(succ.get(e.from) ?? []), e])
  const placed = new Map<string, MindNode>()
  const used = new Set<DiagramEdge>()
  const root: MindNode = { node: rootNode, depth: 0, children: [] }
  placed.set(rootNode.id, root)
  const grow = (start: MindNode): void => {
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()!
      for (const e of succ.get(cur.node.id) ?? []) {
        if (placed.has(e.to)) continue
        const child: MindNode = { node: byId.get(e.to)!, depth: cur.depth + 1, children: [], parent: cur.node.id }
        cur.children.push(child)
        placed.set(e.to, child)
        used.add(e)
        queue.push(child)
      }
    }
  }
  grow(root)
  // lo suelto (otra raíz, un nodo sin flechas): rama de la raíz
  for (const n of b.nodes) {
    if (placed.has(n.id)) continue
    const branch: MindNode = { node: n, depth: 1, children: [], parent: root.node.id }
    root.children.push(branch)
    placed.set(n.id, branch)
    grow(branch)
  }
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>()
    let p = placed.get(id)?.parent
    while (p !== undefined && !out.has(p)) { out.add(p); p = placed.get(p)?.parent }
    return out
  }
  const extra = valid.filter((e) => !used.has(e))
  const cyclic = extra.some((e) => e.from === e.to || ancestors(e.from).has(e.to))
  let depth = 0
  for (const m of placed.values()) depth = Math.max(depth, m.depth)
  return { root, roots: sources.length, extra, cyclic, depth }
}

/** Todos los nodos del árbol en orden (primero en profundidad). */
export function mindNodes(t: MindTree): MindNode[] {
  const out: MindNode[] = []
  const walk = (m: MindNode): void => { out.push(m); m.children.forEach(walk) }
  walk(t.root)
  return out
}

// MARK: Construir paso a paso

/**
 * Lo que ya se ve en el paso k cuando los pasos construyen la figura (`build`): lo nombrado en los pasos 0…k (nodos y extremos
 * de flechas), más lo que necesita para no quedar suelto (los conjuntos de un elemento de Venn, los antepasados de una rama).
 * undefined = todo (sin `build`, sin pasos o viendo la figura entera).
 */
export function revealedAt(b: DiagramBlock, k: number | null): Set<string> | undefined {
  if (!b.build || k === null || !b.steps.length) return undefined
  const out = new Set<string>()
  b.steps.slice(0, Math.max(0, Math.min(k, b.steps.length - 1)) + 1).forEach((s) => {
    s.nodes.forEach((id) => out.add(id))
    s.edges.forEach((e) => e.forEach((id) => out.add(id)))
  })
  if (b.form === 'venn') {
    for (const it of vennModel(b).items) if (out.has(it.node.id)) it.sets.forEach((s) => out.add(s))
  } else if (b.form === 'mindmap') {
    const t = mindmapTree(b)
    if (t) {
      const parent = new Map(mindNodes(t).map((m) => [m.node.id, m.parent]))
      for (const id of [...out]) {
        let p = parent.get(id)
        while (p !== undefined && !out.has(p)) { out.add(p); p = parent.get(p) }
      }
      // la idea central se ve siempre
      out.add(t.root.node.id)
    }
  }
  return out
}
