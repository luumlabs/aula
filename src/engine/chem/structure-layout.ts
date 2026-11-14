// Disposición 2D de una molécula como en los libros: anillos como polígonos regulares (los fusionados comparten un lado),
// cadenas en zigzag a 120°, sustituyentes hacia fuera de los anillos, enlaces triples y alenos en línea recta y partes
// separadas una al lado de otra. Pura: coordenadas con y hacia arriba y enlaces de longitud 1.
//
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/molecule.ts (rad, angleOf,
// step, layoutMolecule). De Aula: anillos mínimos, espiro desde todos los vecinos, la cadena principal recta y los H a los
// lados, cadenas rectas para las fórmulas semidesarrollada y desarrollada, geometría cis/trans de «/» y «\», orientación
// de libro (enlaces a 30° y 90°, a lo ancho), los sustituyentes de un anillo repartidos en su hueco (gem-dimetilo, el
// metilo angular de un esteroide), sitios libres al colocar (los H de la desarrollada), un repaso que separa las ramas que
// aún se pisan y la medida de calidad.
import type { SmilesMolecule } from './smiles'

export type Pt = [number, number]

export interface LayoutOptions {
  /** Cadenas rectas con las ramas y los H a 90° (semidesarrollada y desarrollada); si no, zigzag a 120°. */
  straight?: boolean
}

export interface StructureLayout {
  /** Posición de cada átomo (y hacia arriba; un enlace mide 1). */
  pos: Pt[]
  rings: number[][]
  /** Partes separadas (moléculas de una SMILES con «.»), cada una con sus átomos. */
  parts: number[][]
}

const rad = (deg: number): number => (deg * Math.PI) / 180
const angleOf = (from: Pt, to: Pt): number => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI
const step = (p: Pt, deg: number, length = 1): Pt => [p[0] + Math.cos(rad(deg)) * length, p[1] + Math.sin(rad(deg)) * length]
const mod = (x: number, m: number): number => ((x % m) + m) % m
/** Diferencia angular en grados, 0…180. */
const angleGap = (a: number, b: number): number => Math.abs(mod(a - b + 180, 360) - 180)
const mean = (pts: Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
const dist = (p: Pt, q: Pt): number => Math.hypot(p[0] - q[0], p[1] - q[1])
/** Gira `p` alrededor de `c`. */
const rotateAbout = (p: Pt, c: Pt, deg: number): Pt => {
  const [cos, sin] = [Math.cos(rad(deg)), Math.sin(rad(deg))]
  const [dx, dy] = [p[0] - c[0], p[1] - c[1]]
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]
}
/** Refleja `p` sobre la recta que pasa por `a` y `b`. */
const reflectAcross = (p: Pt, a: Pt, b: Pt): Pt => {
  const len = dist(a, b) || 1
  const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
  const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]
  return [2 * (a[0] + u[0] * t) - p[0], 2 * (a[1] + u[1] * t) - p[1]]
}

/** Un átomo a menos de esto de otro ya colocado tiene el sitio ocupado (los H de dos carbonos vecinos, ramas que se encuentran). */
const CROWDED = 0.75
/** Ángulo mínimo entre dos enlaces de un átomo cuando se busca otro sitio. */
const MIN_SPREAD = 45
/** En la esquelética, el repaso separa también lo que queda más cerca que esto (sin H, hay sitio para más aire). */
const SNUG = 0.9

/** Coloca la molécula. Determinista: la misma SMILES da siempre el mismo dibujo. */
export function layoutStructure(mol: SmilesMolecule, opts: LayoutOptions = {}): StructureLayout {
  const n = mol.atoms.length
  const straight = !!opts.straight
  const neighbours: number[][] = Array.from({ length: n }, () => [])
  for (const b of mol.bonds) (neighbours[b.a].push(b.b), neighbours[b.b].push(b.a))
  const rings = mol.rings
  const pos: (Pt | undefined)[] = new Array(n)
  const incoming: number[] = new Array(n).fill(straight ? 0 : 30)
  const turn: number[] = new Array(n).fill(1)
  const placedRings = new Set<number>()
  const centre = (ring: number[]): Pt => mean(ring.map((a) => pos[a]!))
  const linear = (a: number): boolean => {
    const orders = mol.bonds.filter((b) => b.a === a || b.b === a).map((b) => b.order)
    return orders.includes(3) || orders.filter((o) => o === 2).length >= 2
  }
  const isH = (i: number): boolean => mol.atoms[i].element === 'H'
  // átomos pesados de la rama que cuelga de v (sin volver por u): la rama mayor sigue la cadena principal
  const branchSize = (u: number, v: number): number => {
    const seen = new Set([u, v])
    const stack = [v]
    let count = 0
    while (stack.length && count < 200) {
      const x = stack.pop()!
      if (!isH(x)) count++
      for (const y of neighbours[x]) if (!seen.has(y)) (seen.add(y), stack.push(y))
    }
    return count
  }

  /** Coloca un anillo como polígono regular desde un átomo colocado o un lado colocado. Adaptado de Sketchy (placeRing). */
  const placeRing = (index: number, queue: number[], seed?: number): void => {
    const ring = rings[index]
    const k = ring.length
    const radius = 1 / (2 * Math.sin(Math.PI / k))
    const placed = ring.map((a) => pos[a] !== undefined)
    let start = placed.findIndex((p, i) => p && placed[(i + 1) % k])
    let c: Pt
    if (start >= 0) {
      // fusionado: comparte el lado y se pone del lado contrario a lo ya dibujado
      const [p, q] = [pos[ring[start]]!, pos[ring[(start + 1) % k]]!]
      const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
      const others = ring.filter((a, i) => placed[i] && a !== ring[start] && a !== ring[(start + 1) % k])
      const near = rings
        .filter((r, ri) => placedRings.has(ri) && r.includes(ring[start]) && r.includes(ring[(start + 1) % k]))
        .map(centre)
      const away: Pt = near[0] ?? (others.length ? pos[others[0]]! : [mid[0] + 1e-3, mid[1]])
      const normal = angleOf(p, q) + 90
      const apothem = radius * Math.cos(Math.PI / k)
      const a1 = step(mid, normal, apothem)
      const a2 = step(mid, normal + 180, apothem)
      const d = (x: Pt): number => Math.hypot(x[0] - away[0], x[1] - away[1])
      c = d(a1) > d(a2) ? a1 : a2
    } else {
      start = placed.findIndex(Boolean)
      const anchor = start >= 0 ? ring[start] : seed !== undefined && ring.includes(seed) ? seed : ring[0]
      if (start < 0) {
        pos[anchor] = [0, 0]
        start = ring.indexOf(anchor)
      }
      const at = pos[anchor]!
      // espiro o anillo sustituyente: hacia fuera del centro de TODOS los vecinos ya colocados
      const from = neighbours[anchor].filter((v) => pos[v] !== undefined && !ring.includes(v))
      const outward = from.length ? angleOf(mean(from.map((v) => pos[v]!)), at) : 90
      c = step(at, outward, radius)
    }
    // recorre el anillo desde el átomo compartido, en el sentido que casa con lo colocado
    const base = angleOf(c, pos[ring[start]]!)
    const next = pos[ring[(start + 1) % k]]
    const turnTo = next ? mod(angleOf(c, next) - base + 540, 360) - 180 : 0
    const direction = next && Math.abs(turnTo) > 1e-6 ? Math.sign(turnTo) : 1
    ring.forEach((atom, i) => {
      if (pos[atom] !== undefined) return
      const offset = (i - start + k) % k
      pos[atom] = step(c, base + (direction * 360 * offset) / k, radius)
      queue.push(atom)
    })
    placedRings.add(index)
  }

  /**
   * Direcciones para `count` sustituyentes de un átomo de anillo: a 60° entre sí (hasta 90° en las cadenas rectas, donde
   * cada uno lleva sus H) en el hueco más ancho entre sus enlaces de anillo que no mira hacia dentro de ninguno (en la
   * unión de dos anillos de 6 los tres huecos miden lo mismo).
   */
  const ringSlots = (u: number, inRings: number[][], count: number): number[] => {
    const here = pos[u]!
    const members = new Set(inRings.flat())
    const bonds = neighbours[u].filter((v) => members.has(v) && pos[v] !== undefined).map((v) => mod(angleOf(here, pos[v]!), 360)).sort((a, b) => a - b)
    const centres = inRings.map((r) => mod(angleOf(here, centre(r)), 360))
    let best: { start: number; gap: number } | undefined
    bonds.forEach((start, i) => {
      const gap = i + 1 < bonds.length ? bonds[i + 1] - start : bonds[0] + 360 - start
      const inside = centres.some((c) => mod(c - start, 360) > 1e-6 && mod(c - start, 360) < gap - 1e-6)
      if (!inside && gap > 1e-6 && (!best || gap > best.gap + 1e-6)) best = { start, gap }
    })
    const away = angleOf(mean(inRings.map(centre)), here)
    const mid = best ? best.start + best.gap / 2 : away
    const spacing = Math.min(straight ? 90 : 60, (best?.gap ?? 240) / (count + 1))
    return Array.from({ length: count }, (_, i) => mid + (i - (count - 1) / 2) * spacing)
  }

  /**
   * Un sustituyente colocado antes que su anillo (la SMILES empieza por él: CC1(C)CCCCC1, el metilo angular de un
   * esteroide) se gira, con todo lo que cuelga de él, a su sitio en el hueco que dejan los anillos y los demás sustituyentes.
   */
  const settleParent = (u: number): void => {
    const inRings = rings.filter((r, ri) => placedRings.has(ri) && r.includes(u))
    if (!inRings.length) return
    const members = new Set(inRings.flat())
    const outside = neighbours[u].filter((v) => pos[v] !== undefined && !members.has(v))
    if (outside.length !== 1) return
    const side = subtree(neighbours, outside[0], u)
    if ([...side].some((a) => members.has(a))) return
    const here = pos[u]!
    const now = angleOf(here, pos[outside[0]]!)
    const slots = ringSlots(u, inRings, 1 + neighbours[u].filter((v) => pos[v] === undefined).length)
    const target = slots.reduce((b, s) => (angleGap(s, now) < angleGap(b, now) - 1e-6 ? s : b), slots[0])
    const delta = mod(target - now + 180, 360) - 180
    if (Math.abs(delta) < 1e-6) return
    for (const a of side) {
      if (pos[a] === undefined) continue
      pos[a] = rotateAbout(pos[a]!, here, delta)
      incoming[a] += delta
    }
  }

  // los átomos de las partes ya terminadas (están en el origen hasta ponerlas en fila: no estorban a la parte que se dibuja)
  const finished = new Set<number>()

  /** Distancia de `q` al átomo colocado más cercano de su parte (sin contar `skip`); 0 si cae dentro de un anillo ya dibujado. */
  const room = (q: Pt, skip: number): number => {
    for (const ri of placedRings) if (!finished.has(rings[ri][0]) && insideRing(q, rings[ri].map((a) => pos[a]!))) return 0
    let best = Infinity
    for (let a = 0; a < n; a++) if (a !== skip && !finished.has(a) && pos[a] !== undefined) best = Math.min(best, dist(q, pos[a]!))
    return best
  }

  /** La dirección pedida o, si su sitio ya está ocupado, la libre más cercana que no pise otro enlace del átomo. */
  const freeDirection = (u: number, want: number, taken: readonly number[]): number => {
    const here = pos[u]!
    const wanted = room(step(here, want), u)
    if (wanted >= CROWDED) return want
    let best = want
    let bestRoom = wanted
    // primero los giros de la retícula (30° en zigzag; 45° en las cadenas rectas, como los H de un CH₃ apretado), luego más finos
    for (const turn of straight ? [45, 90, 135, 30, 60, 120, 150, 15, 75, 105, 165, 180] : [30, 60, 90, 120, 150, 15, 45, 75, 105, 135, 165, 180]) {
      const tries = (turn === 180 ? [want + 180] : [want + turn, want - turn])
        .filter((d) => taken.every((t) => angleGap(t, d) >= MIN_SPREAD))
        .map((d) => ({ d, r: room(step(here, d), u) }))
        .sort((x, y) => y.r - x.r)
      if (tries[0] && tries[0].r >= CROWDED) return tries[0].d
      if (tries[0] && tries[0].r > bestRoom + 0.05) (best = tries[0].d, bestRoom = tries[0].r)
    }
    return best
  }

  /** Direcciones para los vecinos sin colocar de `u` y la principal (la de la rama mayor). */
  const directionsFor = (u: number, fresh: number[]): { dirs: number[]; main: number } => {
    const here = pos[u]!
    const placedAround = neighbours[u].filter((v) => pos[v] !== undefined).map((v) => angleOf(here, pos[v]!))
    const inRings = rings.filter((r, ri) => placedRings.has(ri) && r.includes(u))
    const k = fresh.length
    if (inRings.length) {
      const members = new Set(inRings.flat())
      const outside = neighbours[u].filter((v) => pos[v] !== undefined && !members.has(v)).map((v) => angleOf(here, pos[v]!))
      if (outside.length) {
        // ya cuelga otro de este átomo (gem-dimetilo, un OH terciario): los nuevos, en los sitios que quedan libres
        const slots = ringSlots(u, inRings, outside.length + k)
        for (const o of outside) slots.splice(slots.reduce((bi, s, i) => (angleGap(s, o) < angleGap(slots[bi], o) - 1e-6 ? i : bi), 0), 1)
        return { dirs: slots, main: slots[0] }
      }
      // los sustituyentes salen del anillo
      const away = angleOf(mean(inRings.map(centre)), here)
      return { dirs: k === 1 ? [away] : fresh.map((_, i) => away + (i - (k - 1) / 2) * 60), main: away }
    }
    if (!placedAround.length) {
      const first = straight ? 0 : 30
      return { dirs: fresh.map((_, i) => first + (i * 360) / k), main: first }
    }
    if (placedAround.length === 1) {
      const dirIn = incoming[u]
      if (straight) {
        const dirs = [dirIn, dirIn + 90 * turn[u], dirIn - 90 * turn[u]].slice(0, k)
        return { dirs: k <= 3 ? dirs : fresh.map((_, i) => dirIn - 90 + (i * 180) / (k - 1)), main: dirIn }
      }
      if (k === 1) return { dirs: [linear(u) ? dirIn : dirIn + 60 * turn[u]], main: linear(u) ? dirIn : dirIn + 60 * turn[u] }
      if (k === 2) return { dirs: [dirIn + 60 * turn[u], dirIn - 60 * turn[u]], main: dirIn + 60 * turn[u] }
      return { dirs: fresh.map((_, i) => dirIn - 90 + (i * 180) / (k - 1)), main: dirIn }
    }
    // el resto, repartido en el hueco libre más ancho
    const sorted = placedAround.map((a) => mod(a, 360)).sort((a, b) => a - b)
    let gapStart = sorted[sorted.length - 1]
    let gap = sorted[0] + 360 - gapStart
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > gap) {
        gap = sorted[i] - sorted[i - 1]
        gapStart = sorted[i - 1]
      }
    }
    return { dirs: fresh.map((_, i) => gapStart + (gap * (i + 1)) / (k + 1)), main: gapStart + gap / 2 }
  }

  const parts: number[][] = []
  for (let root = 0; root < n; root++) {
    if (pos[root] !== undefined) continue
    const queue: number[] = []
    const ringOfRoot = rings.findIndex((r) => r.includes(root))
    if (ringOfRoot >= 0) placeRing(ringOfRoot, queue, root)
    else pos[root] = [0, 0]
    queue.unshift(root)
    const component: number[] = []
    while (queue.length) {
      const u = queue.shift()!
      component.push(u)
      for (let ri = 0; ri < rings.length; ri++) if (!placedRings.has(ri) && rings[ri].includes(u)) placeRing(ri, queue)
      settleParent(u)
      const fresh = neighbours[u].filter((v) => pos[v] === undefined)
      if (!fresh.length) continue
      // la rama mayor primero (en empate, la que va después en la SMILES: la cadena principal); los H al final
      const ranked = fresh
        .map((v) => ({ v, size: isH(v) ? -1 : branchSize(u, v) }))
        .sort((x, y) => y.size - x.size || y.v - x.v)
        .map((x) => x.v)
      const { dirs, main } = directionsFor(u, fresh)
      // la dirección principal para la rama mayor; las de los lados, para las pequeñas y los H
      const order = dirs.map((d, i) => ({ d, i })).sort((x, y) => angleGap(x.d, main) - angleGap(y.d, main) || x.i - y.i)
      const taken = neighbours[u].filter((v) => pos[v] !== undefined).map((v) => angleOf(pos[u]!, pos[v]!))
      ranked.forEach((v, i) => {
        // si el sitio está ocupado, el libre más cercano (sin quitárselo a los que faltan por colocar)
        const d = freeDirection(u, order[i].d, [...taken, ...order.slice(i + 1).map((o) => o.d)])
        taken.push(d)
        pos[v] = step(pos[u]!, d)
        incoming[v] = d
        turn[v] = -turn[u]
        queue.push(v)
      })
    }
    const placedPos = pos as Pt[]
    fixDoubleBonds(mol, placedPos, component, neighbours)
    relax(mol, placedPos, component, neighbours, straight)
    orient(mol, placedPos, component, straight)
    parts.push(component.sort((a, b) => a - b))
    for (const a of component) finished.add(a)
  }
  // las partes separadas, una al lado de otra y centradas en altura
  const done = pos as Pt[]
  let shiftX = 0
  for (const part of parts) {
    const xs = part.map((a) => done[a][0])
    const ys = part.map((a) => done[a][1])
    const dx = shiftX - Math.min(...xs)
    const dy = -(Math.min(...ys) + Math.max(...ys)) / 2
    for (const a of part) done[a] = [done[a][0] + dx, done[a][1] + dy]
    shiftX = Math.max(...part.map((a) => done[a][0])) + 1.6
  }
  return { pos: done, rings, parts }
}

// MARK: cis/trans

/** Dirección de un enlace marcado («/» o «\») vista desde el átomo `from`. */
function dirFrom(b: { a: number; dir?: 'up' | 'down' }, from: number): 'up' | 'down' | undefined {
  if (!b.dir) return undefined
  return b.a === from ? b.dir : b.dir === 'up' ? 'down' : 'up'
}

/** Átomos que cuelgan de `start` sin pasar por `stop`. */
function subtree(neighbours: number[][], start: number, stop: number): Set<number> {
  const seen = new Set([start])
  const stack = [start]
  while (stack.length) {
    const x = stack.pop()!
    for (const y of neighbours[x]) if (y !== stop && !seen.has(y)) (seen.add(y), stack.push(y))
  }
  return seen
}

/** Un doble enlace fuera de anillo con «/» o «\» a cada lado: sus átomos, el vecino marcado de cada uno y si lo pide cis. */
interface MarkedDouble {
  a: number
  b: number
  x1: number
  x2: number
  cis: boolean
}

/** Los dobles enlaces marcados de una parte. */
function markedDoubles(mol: SmilesMolecule, component: number[]): MarkedDouble[] {
  const inPart = new Set(component)
  const out: MarkedDouble[] = []
  for (const db of mol.bonds) {
    if (db.order !== 2 || !inPart.has(db.a)) continue
    const inRing = mol.rings.some((r) => r.some((a, k) => (a === db.a && r[(k + 1) % r.length] === db.b) || (a === db.b && r[(k + 1) % r.length] === db.a)))
    if (inRing) continue
    const marked = (c: number, other: number): { x: number; s: 'up' | 'down' } | undefined => {
      for (const b of mol.bonds) {
        if ((b.a !== c && b.b !== c) || b === db) continue
        const x = b.a === c ? b.b : b.a
        const s = dirFrom(b, c)
        if (x !== other && s) return { x, s }
      }
      return undefined
    }
    const m1 = marked(db.a, db.b)
    const m2 = marked(db.b, db.a)
    if (m1 && m2) out.push({ a: db.a, b: db.b, x1: m1.x, x2: m2.x, cis: m1.s === m2.s })
  }
  return out
}

/** 1 si los dos vecinos marcados quedan del mismo lado del enlace (cis), −1 si a lados opuestos, 0 si uno queda en línea. */
function cisSense(d: MarkedDouble, p: (a: number) => Pt): number {
  const [p1, p2] = [p(d.a), p(d.b)]
  const ax: Pt = [p2[0] - p1[0], p2[1] - p1[1]]
  const side = (o: Pt, q: Pt): number => {
    const c = ax[0] * (q[1] - o[1]) - ax[1] * (q[0] - o[0])
    return Math.abs(c) < 1e-6 ? 0 : Math.sign(c)
  }
  return side(p1, p(d.x1)) * side(p2, p(d.x2))
}

/** Cada doble enlace marcado con «/» y «\» queda cis o trans como pide la SMILES (refleja un lado sobre el eje del enlace). */
function fixDoubleBonds(mol: SmilesMolecule, pos: Pt[], component: number[], neighbours: number[][]): void {
  const ringAtoms = new Set(mol.rings.flat())
  for (const db of markedDoubles(mol, component)) {
    const [p1, p2] = [pos[db.a], pos[db.b]]
    const ax: Pt = [p2[0] - p1[0], p2[1] - p1[1]]
    const cross = (o: Pt, q: Pt): number => ax[0] * (q[1] - o[1]) - ax[1] * (q[0] - o[0])
    const isCis = cross(p1, pos[db.x1]) * cross(p2, pos[db.x2]) > 0
    if (isCis === db.cis) continue
    // se refleja el lado sin anillos; con anillos a los dos lados (cis-estilbeno), el menor, entero (un espejo no los deforma)
    const sideB = subtree(neighbours, db.b, db.a)
    const sideA = subtree(neighbours, db.a, db.b)
    const ringFree = (side: Set<number>): boolean => ![...side].some((a) => ringAtoms.has(a))
    const apart = ![...sideB].some((a) => sideA.has(a))
    const flip = ringFree(sideB) ? sideB : ringFree(sideA) ? sideA : apart ? (sideB.size <= sideA.size ? sideB : sideA) : undefined
    if (!flip) continue
    const len = Math.hypot(ax[0], ax[1]) || 1
    const d: Pt = [ax[0] / len, ax[1] / len]
    for (const a of flip) {
      const q = pos[a]
      const t = (q[0] - p1[0]) * d[0] + (q[1] - p1[1]) * d[1]
      const proj: Pt = [p1[0] + d[0] * t, p1[1] + d[1] * t]
      pos[a] = [2 * proj[0] - q[0], 2 * proj[1] - q[1]]
    }
  }
}

// MARK: Repaso

/** Lo que estorban dos átomos no enlazados a distancia d (nada desde 0,95 de enlace; mucho si se pisan). */
const crowding = (d: number): number => (d >= 0.95 ? 0 : (0.95 - d) ** 2 + (d < 0.55 ? 1 : 0))
const CROSSING_COST = 1.5
const RELAX_BUDGET = 1_500_000

/** ¿Cae `q` dentro del polígono de un anillo (con un margen junto a los lados)? */
function insideRing(q: Pt, ring: readonly Pt[]): boolean {
  const c = mean([...ring])
  const inradius = 1 / (2 * Math.tan(Math.PI / ring.length))
  return dist(q, c) < inradius * 0.9
}

/**
 * Último repaso, por si aún se pisan dos ramas (dos anillos unidos por un O, las ramas del EDTA) o se cruzan dos enlaces:
 * la parte menor a un lado de un enlace que no es de anillo se refleja sobre él o se gira a su alrededor, lo que más los
 * separe. Mover una parte entera, rígida, no deforma los anillos; un movimiento que pasaría un doble enlace marcado de
 * cis a trans (o lo dejaría en línea) se descarta.
 */
function relax(mol: SmilesMolecule, pos: Pt[], component: number[], neighbours: number[][], straight: boolean): void {
  if (component.length < 3) return
  const key = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`
  const inPart = new Set(component)
  const bonds = mol.bonds.filter((b) => inPart.has(b.a))
  const bonded = (a: number, b: number): boolean => neighbours[a].includes(b)
  const ringEdge = new Set<string>()
  for (const r of mol.rings) r.forEach((a, k) => ringEdge.add(key(a, r[(k + 1) % r.length])))
  const partRings = mol.rings.filter((r) => inPart.has(r[0]))
  const turns = straight ? [90, -90, 180, 45, -45, 135, -135, 30, -30, 60, -60, 120, -120, 150, -150] : [60, -60, 120, -120, 180, 30, -30, 90, -90, 150, -150]
  // tope de trabajo (pares medidos): una molécula sin arreglo en plano (un dendrímero) no congela la pantalla
  let budget = RELAX_BUDGET
  // girar o reflejar junto a un doble enlace marcado puede pasarlo de cis a trans (cis-di-terc-butileteno): no se acepta
  const doubles = markedDoubles(mol, component)
  const keepsStereo = (moved: Set<number>, at: Map<number, Pt>): boolean =>
    doubles.every((d) => {
      if (![d.a, d.b, d.x1, d.x2].some((a) => moved.has(a))) return true
      const after = cisSense(d, (a) => at.get(a) ?? pos[a])
      return after === (d.cis ? 1 : -1) || after === cisSense(d, (a) => pos[a])
    })

  /** Lo que estorban los átomos de `moved` (en `at`, o donde están) con los demás, y los cruces de sus enlaces. */
  const cost = (moved: Set<number>, at?: Map<number, Pt>): number => {
    const p = (a: number): Pt => at?.get(a) ?? pos[a]
    budget -= moved.size * (component.length + bonds.length)
    let total = 0
    for (const a of moved) {
      for (const b of component) if (!moved.has(b) && !bonded(a, b)) total += crowding(dist(p(a), p(b)))
    }
    for (const e of bonds) {
      if (!moved.has(e.a) && !moved.has(e.b)) continue
      for (const f of bonds) {
        if (f === e || (moved.has(f.a) && moved.has(f.b)) || f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue
        if (segmentsCross(p(e.a), p(e.b), p(f.a), p(f.b))) total += CROSSING_COST
      }
    }
    // nada dentro de un anillo (un anillo se mueve entero o no se mueve)
    for (const r of partRings) {
      const ringMoved = moved.has(r[0])
      const pts = r.map(p)
      for (const a of component) if (moved.has(a) !== ringMoved && !r.includes(a) && insideRing(p(a), pts)) total += CROSSING_COST
    }
    return total
  }

  /** Los átomos que se pisan o los extremos de dos enlaces que se cruzan, lo peor primero. */
  const problems = (): [number, number][] => {
    const near: { a: number; b: number; d: number }[] = []
    for (let i = 0; i < component.length; i++) {
      for (let j = i + 1; j < component.length; j++) {
        const [a, b] = [component[i], component[j]]
        const d = dist(pos[a], pos[b])
        if (d < (straight ? CROWDED : SNUG) && !bonded(a, b)) near.push({ a, b, d })
      }
    }
    const out: [number, number][] = near.sort((x, y) => x.d - y.d).map((x) => [x.a, x.b])
    for (let i = 0; i < bonds.length; i++) {
      for (let j = i + 1; j < bonds.length; j++) {
        const [e, f] = [bonds[i], bonds[j]]
        if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue
        if (segmentsCross(pos[e.a], pos[e.b], pos[f.a], pos[f.b])) out.push([e.a, f.b])
      }
    }
    return out
  }

  /** Enlaces del camino más corto entre dos átomos. */
  const pathBonds = (from: number, to: number): [number, number][] => {
    const back = new Map<number, number>([[from, -1]])
    const queue = [from]
    while (queue.length && !back.has(to)) {
      const x = queue.shift()!
      for (const y of neighbours[x]) if (!back.has(y)) (back.set(y, x), queue.push(y))
    }
    const out: [number, number][] = []
    for (let x = to; back.has(x) && back.get(x)! >= 0; x = back.get(x)!) out.push([back.get(x)!, x])
    return out
  }

  /** El mejor movimiento de la parte menor al otro lado de un enlace de ese camino, si mejora algo. */
  const bestMove = (a: number, b: number): Map<number, Pt> | undefined => {
    let best: Map<number, Pt> | undefined
    let bestChange = -1e-3
    for (const [x, y] of pathBonds(a, b)) {
      if (ringEdge.has(key(x, y))) continue
      const sideY = subtree(neighbours, y, x)
      const sideX = subtree(neighbours, x, y)
      // un enlace de un ciclo que no está entre los anillos mínimos (un puente): no hay lado que mover
      if (sideY.size + sideX.size > component.length) continue
      const [moved, pivot, root] = sideY.size <= sideX.size ? [sideY, x, y] : [sideX, y, x]
      const before = cost(moved)
      const tries: { at: Map<number, Pt>; extra: number }[] = [{ at: new Map([...moved].map((m) => [m, reflectAcross(pos[m], pos[pivot], pos[root])])), extra: 0.001 }]
      for (const t of turns) tries.push({ at: new Map([...moved].map((m) => [m, rotateAbout(pos[m], pos[pivot], t)])), extra: 0.002 * (Math.abs(t) / 30) })
      // el que más baja el estorbo; a igualdad, el giro menor
      for (const t of tries) {
        if (budget < 0) return best
        if (!keepsStereo(moved, t.at)) continue
        const change = cost(moved, t.at) + t.extra - before
        if (change < bestChange) (bestChange = change, best = t.at)
      }
    }
    return best
  }

  for (let round = 0; round < 40 && budget > 0; round++) {
    let moved = false
    for (const [a, b] of problems()) {
      if (budget < 0) break
      const move = bestMove(a, b)
      if (!move) continue
      for (const [m, p] of move) pos[m] = p
      moved = true
      break
    }
    if (!moved) return
  }
}

// MARK: Orientación

/**
 * Gira la parte como en los libros: el mayor número de enlaces a 30°/90° (o a 0°/90° en las cadenas rectas), a lo ancho
 * y, a igualdad, con el primer átomo de la SMILES a la izquierda (CCO: el OH a la derecha).
 */
function orient(mol: SmilesMolecule, pos: Pt[], part: number[], straight: boolean): void {
  if (part.length < 2) return
  const inPart = new Set(part)
  const angles = mol.bonds.filter((b) => inPart.has(b.a)).map((b) => angleOf(pos[b.a], pos[b.b]))
  if (!angles.length) return
  // una molécula lineal (C=C, HC≡CH, O=C=O), tumbada: de izquierda a derecha
  const first = pos[part[0]]
  const far = part.reduce((best, a) => (Math.hypot(pos[a][0] - first[0], pos[a][1] - first[1]) > Math.hypot(pos[best][0] - first[0], pos[best][1] - first[1]) ? a : best), part[0])
  const axis = angleOf(first, pos[far])
  const offAxis = (a: number): number => Math.abs(Math.sin(rad(angleOf(first, pos[a]) - axis)) * Math.hypot(pos[a][0] - first[0], pos[a][1] - first[1]))
  const grid = part.every((a) => a === part[0] || offAxis(a) < 0.02) ? 360 : straight ? 90 : 60
  const offset = grid === 360 ? 0 : straight ? 0 : 30
  let delta = 0
  let bestScore = -1
  for (const a of angles) {
    const d = grid === 360 ? mod(-axis, 360) : mod(offset - a, grid)
    const score = angles.filter((x) => angleGap(mod(x + d - offset, grid), 0) < 2.5 || angleGap(mod(x + d - offset, grid), grid) < 2.5).length
    if (score > bestScore + 0.5) (bestScore = score, delta = d)
  }
  const c = mean(part.map((a) => pos[a]))
  const rotated = (theta: number): Pt[] => {
    const [cos, sin] = [Math.cos(rad(theta)), Math.sin(rad(theta))]
    return part.map((a) => {
      const [dx, dy] = [pos[a][0] - c[0], pos[a][1] - c[1]]
      return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos] as Pt
    })
  }
  let best: Pt[] | undefined
  let bestKey: [number, number, number] | undefined
  for (let k = 0; k < 360 / grid; k++) {
    const pts = rotated(delta + grid * k)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const wide = Math.max(...xs) - Math.min(...xs) - (Math.max(...ys) - Math.min(...ys))
    const key: [number, number, number] = [Math.round(wide * 20), -Math.round(pts[0][0] * 20), Math.round(pts[0][1] * 20)]
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      best = pts
      bestKey = key
    }
  }
  part.forEach((a, i) => (pos[a] = best![i]))
}

// MARK: Calidad

export interface LayoutQuality {
  /** Distancia mínima entre dos átomos no enlazados (en enlaces). */
  minAtomDistance: number
  /** Lo que más se estira o encoge un enlace respecto a 1. */
  worstBondStretch: number
  /** Enlaces que se cruzan. */
  crossings: number
  /** Sistema con puentes (dos anillos que comparten más de un lado): el dibujo plano sale deformado. */
  bridged: boolean
  /** El dibujo tiene átomos encima de otros, enlaces estirados o cruces. */
  deformed: boolean
}

/** Mide si la disposición se lee bien (para avisar a la IA de las moléculas que no se dibujan bien en plano). */
export function layoutQuality(mol: SmilesMolecule, layout: StructureLayout): LayoutQuality {
  const { pos } = layout
  const bonded = new Set(mol.bonds.map((b) => `${Math.min(b.a, b.b)}-${Math.max(b.a, b.b)}`))
  let minAtomDistance = Infinity
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      if (bonded.has(`${i}-${j}`)) continue
      minAtomDistance = Math.min(minAtomDistance, Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]))
    }
  }
  let worstBondStretch = 0
  for (const b of mol.bonds) worstBondStretch = Math.max(worstBondStretch, Math.abs(Math.hypot(pos[b.a][0] - pos[b.b][0], pos[b.a][1] - pos[b.b][1]) - 1))
  let crossings = 0
  for (let i = 0; i < mol.bonds.length; i++) {
    for (let j = i + 1; j < mol.bonds.length; j++) {
      const [p, q] = [mol.bonds[i], mol.bonds[j]]
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue
      if (segmentsCross(pos[p.a], pos[p.b], pos[q.a], pos[q.b])) crossings++
    }
  }
  const bridged = mol.rings.some((r, i) => mol.rings.some((s, j) => j > i && r.filter((a) => s.includes(a)).length >= 3))
  if (!Number.isFinite(minAtomDistance)) minAtomDistance = Infinity
  return { minAtomDistance, worstBondStretch, crossings, bridged, deformed: minAtomDistance < 0.55 || worstBondStretch > 0.15 || crossings > 0 }
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
}
