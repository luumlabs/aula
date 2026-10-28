// Bloques visuales e interactivos (port de StudyModel/VisualBlocks.swift): diagrama etiquetado (`labeled`), visor 3D
// (`model3d`), simulación con deslizadores (`simulation`) y mapa (`map`), más la geometría común de las figuras y las fechas
// históricas de las líneas de tiempo.
import { IDs } from '@engine/base/ids'
import type { JSONObject } from '@engine/base/json'
import {
  bool, flexNum, flexNums, flexStr, int, isObj, list, nested, num, pickKeys, points, prune, put, str, strings, uniquifyIDs, type Obj
} from './coding'
import {
  decodeDrawing, decodeDrawItem, decodeFormulaItem, decodeSourceRef, encodeDrawing, encodeDrawItem, encodeFormulaItem, encodeSourceRef,
  type DrawingBlock, type DrawItem, type FormulaItem, type SourceRef
} from './common'
import { decodePlotSpec, encodePlotSpec, makePlotSpec, type PlotSpec } from './plot'
import { SimulationPresets } from './simulationPresets'

// MARK: Figuras con partes

/** Una parte de una figura. Coordenadas relativas: x de 0 (izquierda) a 1 (derecha), y de 0 (arriba) a 1 (abajo). */
export interface FigurePart {
  id: string
  name: string
  /** Otros nombres que también valen al nombrarla. */
  aliases: string[]
  /** Punto de anclaje (donde va el marcador y la línea de la etiqueta). */
  x: number
  y: number
  /** Zona circular: radio como fracción del ANCHO de la figura. */
  r?: number
  /** Zona rectangular [x, y, ancho, alto] en fracciones. */
  rect?: number[]
  /** Contorno preciso [[x, y], …] en fracciones. */
  polygon?: number[][]
  /** Capa a la que pertenece (id de `FigureLayer`). */
  layer?: string
  /** Explicación (Markdown) que aparece al pasar o pulsar. */
  detail?: string
  color?: string
  labelX?: number
  labelY?: number
}

export function decodeFigurePart(raw: unknown): FigurePart | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const name = flexStr(c, 'name') ?? flexStr(c, 'label') ?? flexStr(c, 'title') ?? ''
  return prune({
    id: flexStr(c, 'id') ?? IDs.slug(name === '' ? IDs.short(4) : name, 32), name, aliases: strings(c, 'aliases'),
    x: flexNum(c, 'x') ?? 0.5, y: flexNum(c, 'y') ?? 0.5, r: flexNum(c, 'r'), rect: flexNums(c, 'rect'), polygon: points(c, 'polygon'),
    layer: flexStr(c, 'layer'), detail: str(c, 'detail') ?? str(c, 'md'), color: str(c, 'color'), labelX: flexNum(c, 'labelX'), labelY: flexNum(c, 'labelY')
  })
}

export function encodeFigurePart(v: FigurePart): JSONObject {
  const out = pickKeys(v, ['id', 'name'])
  if (v.aliases.length) out.aliases = [...v.aliases]
  Object.assign(out, pickKeys(v, ['x', 'y', 'r', 'rect', 'polygon', 'layer', 'detail', 'color', 'labelX', 'labelY']))
  return out
}

/** Todos los nombres aceptados (el principal primero). */
export const figurePartNames = (p: FigurePart): string[] => [p.name, ...p.aliases.filter((a) => a !== '')]

/** Capa que se enciende y se apaga (huesos, músculos, órganos…). */
export interface FigureLayer {
  id: string
  name: string
  color?: string
  /** Imagen superpuesta (mismo encuadre que la base, con transparencia). */
  asset?: string
  /** Dibujo vectorial superpuesto. */
  items: DrawItem[]
  /** ¿Encendida al principio? */
  visible: boolean
  opacity?: number
}

export function decodeFigureLayer(raw: unknown, d = 0): FigureLayer | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const name = flexStr(c, 'name') ?? flexStr(c, 'title') ?? ''
  return prune({
    id: flexStr(c, 'id') ?? IDs.slug(name === '' ? IDs.short(4) : name, 32), name, color: str(c, 'color'), asset: str(c, 'asset'),
    items: list(c, 'items', decodeDrawItem, d), visible: bool(c, 'visible') ?? true, opacity: flexNum(c, 'opacity')
  })
}

export function encodeFigureLayer(v: FigureLayer): JSONObject {
  const out = pickKeys(v, ['id', 'name', 'color', 'asset'])
  if (v.items.length) out.items = v.items.map(encodeDrawItem)
  out.visible = v.visible
  put(out, 'opacity', v.opacity)
  return out
}

/** Diagrama etiquetado interactivo: imagen o dibujo con partes marcadas, capas y modos de práctica. */
export interface LabeledBlock {
  title?: string
  asset?: string
  drawing?: DrawingBlock
  /** Página de un material del estudiante (si no hay `asset` ni `drawing`). */
  source?: SourceRef
  alt: string
  caption?: string
  /** Autor, licencia y procedencia. Obligatorio para imágenes ajenas. */
  credit?: string
  /** Ancho / alto de la figura. */
  aspect?: number
  layers: FigureLayer[]
  parts: FigurePart[]
  /** Ofrece los modos de práctica (señalar y arrastrar). */
  practice: boolean
  /** "auto" | "names" | "numbers" | "hidden" */
  labels: string
}

export function decodeLabeled(raw: unknown, d = 0): LabeledBlock | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    title: str(c, 'title'), asset: str(c, 'asset'), drawing: nested(c, 'drawing', decodeDrawing, d), source: nested(c, 'source', decodeSourceRef, d),
    alt: flexStr(c, 'alt') ?? '', caption: str(c, 'caption'), credit: str(c, 'credit'), aspect: flexNum(c, 'aspect'),
    layers: list(c, 'layers', decodeFigureLayer, d),
    // ids de parte repetidos: la interfaz y la corrección las identifican por id
    parts: uniquifyIDs(list(c, 'parts', decodeFigurePart, d)),
    practice: bool(c, 'practice') ?? true, labels: str(c, 'labels')?.toLowerCase() ?? 'auto'
  })
}

export function encodeLabeled(v: LabeledBlock): JSONObject {
  const out = pickKeys(v, ['title', 'asset'])
  if (v.drawing) out.drawing = encodeDrawing(v.drawing)
  if (v.source) out.source = encodeSourceRef(v.source)
  Object.assign(out, pickKeys(v, ['alt', 'caption', 'credit', 'aspect']))
  out.layers = v.layers.map((l) => encodeFigureLayer(l))
  out.parts = v.parts.map(encodeFigurePart)
  out.practice = v.practice
  out.labels = v.labels
  return out
}

/** Ancho / alto efectivo (dibujo → sus medidas; imagen → `aspect`; si no, 4:3). */
export function effectiveAspect(v: { drawing?: DrawingBlock; aspect?: number }): number {
  const d = v.drawing
  if (d && Number.isFinite(d.width) && Number.isFinite(d.height) && d.width > 0 && d.height > 0) return d.width / d.height
  const a = v.aspect
  if (a !== undefined && Number.isFinite(a) && a > 0.05 && a < 20) return a
  return 4 / 3
}

/** Geometría de las partes: qué parte señala un clic. La usan la interfaz y el corrector (deben coincidir). */
export const FigureGeometry = {
  /** Margen para clics que caen justo fuera de una zona dibujada (fracción del ancho). */
  edgeTolerance: 0.012,
  /** Distancia máxima al punto de anclaje de una parte SIN zona dibujada. */
  pointSnap: 0.085,
  /** Distancia máxima al anclaje de una parte CON zona, cuando el clic cae fuera de ella. */
  regionSnap: 0.04,

  /** Distancia en unidades del ancho de la figura (x ya está en anchos; y se pasa de altos a anchos). */
  distance(ax: number, ay: number, bx: number, by: number, aspect: number): number {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
    const dx = ax - bx, dy = (ay - by) / a
    return Math.sqrt(dx * dx + dy * dy)
  },
  /** ¿La parte tiene una zona dibujada (círculo, rectángulo o contorno)? */
  hasRegion(p: FigurePart): boolean {
    return (p.polygon?.length ?? 0) >= 3 || (p.rect?.length ?? 0) >= 4 || (p.r ?? 0) > 0
  },
  /** ¿El punto está dentro de la zona de la parte (con un pequeño margen)? */
  contains(p: FigurePart, x: number, y: number, aspect: number, tolerance = 0.012): boolean {
    if (p.polygon && p.polygon.length >= 3) {
      const pts = p.polygon.filter((q) => q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1])).map((q) => [q[0], q[1]] as [number, number])
      if (pts.length >= 3) {
        if (pointInPolygon(x, y, pts)) return true
        return tolerance > 0 && distanceToPolygon(x, y, pts, aspect) <= tolerance
      }
    }
    const r = p.rect
    if (r && r.length >= 4 && r.every(Number.isFinite)) {
      const x0 = Math.min(r[0], r[0] + r[2]), x1 = Math.max(r[0], r[0] + r[2]), y0 = Math.min(r[1], r[1] + r[3]), y1 = Math.max(r[1], r[1] + r[3])
      const t = tolerance, ty = tolerance * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1)
      return x >= x0 - t && x <= x1 + t && y >= y0 - ty && y <= y1 + ty
    }
    if (p.r !== undefined && p.r > 0 && Number.isFinite(p.r)) return FigureGeometry.distance(x, y, p.x, p.y, aspect) <= p.r + tolerance
    return false
  },
  /** Área aproximada de la zona (para preferir la más concreta cuando se solapan). */
  area(p: FigurePart, aspect: number): number {
    if (p.polygon && p.polygon.length >= 3) {
      let s = 0
      p.polygon.forEach((a, i) => {
        const b = p.polygon![(i + 1) % p.polygon!.length]
        if (a.length >= 2 && b.length >= 2) s += a[0] * b[1] - b[0] * a[1]
      })
      return Math.abs(s) / 2
    }
    if (p.rect && p.rect.length >= 4) return Math.abs(p.rect[2] * p.rect[3])
    if (p.r !== undefined) return Math.PI * p.r * p.r * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1)
    return Infinity
  },
  /** Índice de la parte que señala el punto (x, y en 0…1), o undefined: zonas que lo contienen (gana la menor), luego el anclaje más cercano. */
  hit(x: number, y: number, parts: FigurePart[], aspect: number): number | undefined {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    let best: [number, number] | undefined
    parts.forEach((p, i) => {
      if (FigureGeometry.hasRegion(p) && FigureGeometry.contains(p, x, y, aspect, 0)) {
        const a = FigureGeometry.area(p, aspect)
        if (!best || a < best[1]) best = [i, a]
      }
    })
    if (best) return best[0]
    parts.forEach((p, i) => {
      if (FigureGeometry.hasRegion(p) && FigureGeometry.contains(p, x, y, aspect)) {
        const a = FigureGeometry.area(p, aspect)
        if (!best || a < best[1]) best = [i, a]
      }
    })
    if (best) return best[0]
    let near: [number, number] | undefined
    parts.forEach((p, i) => {
      const dd = FigureGeometry.distance(x, y, p.x, p.y, aspect)
      const snap = FigureGeometry.hasRegion(p) ? FigureGeometry.regionSnap : FigureGeometry.pointSnap
      if (dd <= snap && (!near || dd < near[1])) near = [i, dd]
    })
    return near?.[0]
  },
  /** Lee un clic guardado como «x,y» (lo que guarda el ejercicio de señalar). */
  parsePoint(s: string): [number, number] | undefined {
    const parts = s.split(',').map((t) => t.trim())
    if (parts.length !== 2 || parts.some((t) => !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t))) return undefined
    const x = Number(parts[0]), y = Number(parts[1])
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined
  },
  /** Texto «x,y» con 4 decimales (estable y comparable). */
  format(x: number, y: number): string {
    return `${x.toFixed(4)},${y.toFixed(4)}`
  }
}

function pointInPolygon(x: number, y: number, pts: Array<[number, number]>): boolean {
  let inside = false
  let j = pts.length - 1
  for (let i = 0; i < pts.length; i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi === 0 ? 1e-12 : yj - yi) + xi) inside = !inside
    j = i
  }
  return inside
}

function distanceToPolygon(x: number, y: number, pts: Array<[number, number]>, aspect: number): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
    const px = x, py = y / a, ax = x1, ay = y1 / a, bx = x2, by = y2 / a
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0
    const dx = px - (ax + t * vx), dy = py - (ay + t * vy)
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy))
  }
  return best
}

// MARK: Visor 3D

/** Átomo de una molécula: elemento y coordenadas en ángstroms. */
export interface Atom3D { element: string; x: number; y: number; z: number; label?: string; charge?: number }
/** Enlace entre dos átomos (índices desde 0). `order`: 1, 2, 3 o 1.5 (aromático). */
export interface Bond3D { a: number; b: number; order: number }
/** Etiqueta anclada a un punto del espacio. */
export interface Label3D { x: number; y: number; z: number; text: string }

export const SOLID_SHAPES = ['cube', 'box', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism', 'tetrahedron', 'octahedron', 'icosahedron', 'dodecahedron', 'torus', 'capsule'] as const

/** Sólido geométrico. */
export interface Solid3D {
  shape: string
  /** a = arista, w/h/d = ancho/alto/fondo, r = radio, r2 = radio superior (cono truncado) o del tubo (toro). */
  a?: number; w?: number; h?: number; d?: number; r?: number; r2?: number
  /** Lados de la base del prisma o de la pirámide. */
  sides?: number
  color?: string
  opacity?: number
  wireframe: boolean
  /** Marca las aristas. */
  edges: boolean
  /** Etiquetas de las medidas. */
  dims: boolean
  label?: string
  /** Posición del centro. */
  x: number; y: number; z: number
}

/** Visor 3D: una molécula, sólidos geométricos o un modelo del curso (USDZ, OBJ, STL…). */
export interface Model3DBlock {
  title?: string
  /** Fórmula o nombre de una molécula de la biblioteca de Aula. Si hay `atoms`, mandan los átomos. */
  formula?: string
  atoms: Atom3D[]
  bonds: Bond3D[]
  /** "ballstick" | "spacefill" | "stick" */
  style: string
  /** Muestra los pares de electrones libres (VSEPR). */
  lonePairs: boolean
  solids: Solid3D[]
  /** Modelo del curso: .usdz, .usda, .usdc, .scn, .obj, .stl, .ply, .dae. */
  asset?: string
  credit?: string
  labels: Label3D[]
  caption?: string
  alt: string
  autoRotate: boolean
  /** Muestra los nombres de los átomos. */
  atomLabels: boolean
}

/** Extensiones de modelo que el visor sabe abrir. */
export const MODEL_EXTENSIONS: ReadonlySet<string> = new Set(['usdz', 'usd', 'usda', 'usdc', 'scn', 'obj', 'stl', 'ply', 'dae', 'abc'])

export function decodeAtom3D(raw: unknown): Atom3D | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    element: flexStr(c, 'element') ?? flexStr(c, 'el') ?? flexStr(c, 'symbol') ?? 'C',
    x: flexNum(c, 'x') ?? 0, y: flexNum(c, 'y') ?? 0, z: flexNum(c, 'z') ?? 0, label: str(c, 'label'), charge: int(c, 'charge')
  })
}
export const encodeAtom3D = (v: Atom3D): JSONObject => pickKeys(v, ['element', 'x', 'y', 'z', 'label', 'charge'])

const bondIndex = (x: number): number => Math.trunc(Math.max(-1, Math.min(1e6, x)))

export function decodeBond3D(raw: unknown): Bond3D | undefined {
  if (Array.isArray(raw)) {
    // [0, 1] o [0, 1, 2]
    const v = raw.filter((x): x is number => typeof x === 'number')
    return { a: v.length > 0 ? bondIndex(v[0]) : 0, b: v.length > 1 ? bondIndex(v[1]) : 0, order: v.length > 2 ? v[2] : 1 }
  }
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return { a: bondIndex(flexNum(c, 'a') ?? flexNum(c, 'from') ?? 0), b: bondIndex(flexNum(c, 'b') ?? flexNum(c, 'to') ?? 0), order: flexNum(c, 'order') ?? 1 }
}
export const encodeBond3D = (v: Bond3D): JSONObject => pickKeys(v, ['a', 'b', 'order'])

export function decodeLabel3D(raw: unknown): Label3D | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return { x: flexNum(c, 'x') ?? 0, y: flexNum(c, 'y') ?? 0, z: flexNum(c, 'z') ?? 0, text: flexStr(c, 'text') ?? flexStr(c, 'label') ?? '' }
}
export const encodeLabel3D = (v: Label3D): JSONObject => pickKeys(v, ['x', 'y', 'z', 'text'])

export function decodeSolid3D(raw: unknown): Solid3D | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const sides = flexNum(c, 'sides')
  return prune({
    shape: (flexStr(c, 'shape') ?? flexStr(c, 'kind') ?? 'cube').toLowerCase(),
    a: flexNum(c, 'a') ?? flexNum(c, 'side') ?? flexNum(c, 'edge'), w: flexNum(c, 'w') ?? flexNum(c, 'width'), h: flexNum(c, 'h') ?? flexNum(c, 'height'),
    d: flexNum(c, 'd') ?? flexNum(c, 'depth'), r: flexNum(c, 'r') ?? flexNum(c, 'radius'), r2: flexNum(c, 'r2'),
    sides: sides === undefined ? undefined : Math.trunc(Math.max(3, Math.min(24, sides))), color: str(c, 'color'), opacity: flexNum(c, 'opacity'),
    wireframe: bool(c, 'wireframe') ?? false, edges: bool(c, 'edges') ?? true, dims: bool(c, 'dims') ?? false, label: str(c, 'label'),
    x: flexNum(c, 'x') ?? 0, y: flexNum(c, 'y') ?? 0, z: flexNum(c, 'z') ?? 0
  })
}

export function encodeSolid3D(v: Solid3D): JSONObject {
  const out = pickKeys(v, ['shape', 'a', 'w', 'h', 'd', 'r', 'r2', 'opacity', 'sides', 'color', 'wireframe', 'edges', 'dims', 'label'])
  if (v.x !== 0 || v.y !== 0 || v.z !== 0) Object.assign(out, { x: v.x, y: v.y, z: v.z })
  return out
}

export function decodeModel3D(raw: unknown, d = 0): Model3DBlock | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const solids = list(c, 'solids', decodeSolid3D, d)
  const one = nested(c, 'solid', decodeSolid3D, d)
  if (one) solids.unshift(one)
  return prune({
    title: str(c, 'title'), formula: flexStr(c, 'formula') ?? flexStr(c, 'molecule'),
    atoms: list(c, 'atoms', decodeAtom3D, d).slice(0, 2000), bonds: list(c, 'bonds', decodeBond3D, d).slice(0, 4000),
    style: str(c, 'style')?.toLowerCase().replace(/[-_]/g, '') ?? 'ballstick', lonePairs: bool(c, 'lonePairs') ?? false,
    solids: solids.slice(0, 40), asset: str(c, 'asset'), credit: str(c, 'credit'), labels: list(c, 'labels', decodeLabel3D, d).slice(0, 100),
    caption: str(c, 'caption'), alt: flexStr(c, 'alt') ?? '', autoRotate: bool(c, 'autoRotate') ?? true, atomLabels: bool(c, 'atomLabels') ?? false
  })
}

export function encodeModel3D(v: Model3DBlock): JSONObject {
  const out = pickKeys(v, ['title', 'formula'])
  if (v.atoms.length) out.atoms = v.atoms.map(encodeAtom3D)
  if (v.bonds.length) out.bonds = v.bonds.map(encodeBond3D)
  out.style = v.style
  if (v.lonePairs) out.lonePairs = true
  if (v.solids.length) out.solids = v.solids.map(encodeSolid3D)
  Object.assign(out, pickKeys(v, ['asset', 'credit']))
  if (v.labels.length) out.labels = v.labels.map(encodeLabel3D)
  Object.assign(out, pickKeys(v, ['caption', 'alt', 'autoRotate']))
  if (v.atomLabels) out.atomLabels = true
  return out
}

// MARK: Simulación

/** Parámetro con deslizador (admite nombres de varias letras: v0, theta, k, Vmax). */
export interface SimParam { name: string; label?: string; min: number; max: number; step: number; value: number; unit?: string }
/** Constante con nombre (g = 9.81 m/s²). */
export interface SimConstant { name: string; value: number; label?: string; unit?: string }
/** Magnitud calculada con una fórmula de los parámetros (y del tiempo): se muestra en vivo. */
export interface SimDerived {
  name: string
  /** Expresión de calculadora: "v0^2*sin(2*theta*pi/180)/g". */
  expr: string
  label?: string
  unit?: string
  decimals?: number
  /** La fórmula en LaTeX para mostrarla. */
  tex?: string
  /** false = solo se usa en otros cálculos, no se muestra. */
  show: boolean
}
/** Reloj de la animación: la variable `name` (t) va de `min` a `max` (expresiones) a `speed` unidades por segundo. */
export interface SimTime { name: string; min: string; max: string; speed: number; loop: boolean; autoplay: boolean; label?: string; unit?: string }

export const SIM_OBJECT_KINDS = ['point', 'vector', 'segment', 'path', 'function', 'label'] as const

/** Objeto que se mueve sobre la gráfica (coordenadas = expresiones). */
export interface SimObject {
  kind: string
  x?: string; y?: string; dx?: string; dy?: string
  x1?: string; y1?: string; x2?: string; y2?: string
  from?: string; to?: string
  variable?: string
  text?: string
  color?: string
  dashed: boolean
  /** point: deja el rastro desde el inicio del reloj. */
  trail: boolean
}

/** Simulación o manipulable. `preset` rellena un modelo probado (projectile, pendulum, spring…). */
export interface SimulationBlock {
  title?: string
  intro?: string
  preset?: string
  params: SimParam[]
  constants: SimConstant[]
  derived: SimDerived[]
  time?: SimTime
  plot: PlotSpec
  objects: SimObject[]
  formulas: FormulaItem[]
  prompts: string[]
  caption?: string
}

export function makeSimulation(p: Partial<SimulationBlock> = {}): SimulationBlock {
  return prune({ params: [], constants: [], derived: [], plot: makePlotSpec(), objects: [], formulas: [], prompts: [], ...p })
}
export const makeSimParam = (name: string, label: string | undefined, min: number, max: number, step: number, value: number, unit?: string): SimParam =>
  prune({ name, label, min, max, step, value, unit })
export const makeSimDerived = (name: string, expr: string, more: Partial<SimDerived> = {}): SimDerived => prune({ name, expr, show: true, ...more })
export const makeSimTime = (p: Partial<SimTime> = {}): SimTime => prune({ name: 't', min: '0', max: '10', speed: 1, loop: true, autoplay: false, ...p })
export const makeSimObject = (kind: string, p: Partial<SimObject> = {}): SimObject => prune({ kind, dashed: false, trail: false, ...p })

export function decodeSimParam(raw: unknown): SimParam | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const min = flexNum(c, 'min') ?? 0
  return prune({ name: flexStr(c, 'name') ?? 'a', label: str(c, 'label'), min, max: flexNum(c, 'max') ?? 10, step: flexNum(c, 'step') ?? 1, value: flexNum(c, 'value') ?? min, unit: str(c, 'unit') })
}
export const encodeSimParam = (v: SimParam): JSONObject => pickKeys(v, ['name', 'label', 'min', 'max', 'step', 'value', 'unit'])

export function decodeSimConstant(raw: unknown): SimConstant | undefined {
  if (!isObj(raw)) return undefined
  return prune({ name: flexStr(raw, 'name') ?? 'k', value: flexNum(raw, 'value') ?? 0, label: str(raw, 'label'), unit: str(raw, 'unit') })
}
export const encodeSimConstant = (v: SimConstant): JSONObject => pickKeys(v, ['name', 'value', 'label', 'unit'])

export function decodeSimDerived(raw: unknown): SimDerived | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const dec = flexNum(c, 'decimals')
  return prune({
    name: flexStr(c, 'name') ?? 'q', expr: flexStr(c, 'expr') ?? flexStr(c, 'formula') ?? '0', label: str(c, 'label'), unit: str(c, 'unit'),
    decimals: dec === undefined ? undefined : Math.trunc(Math.max(0, Math.min(8, dec))), tex: str(c, 'tex'), show: bool(c, 'show') ?? true
  })
}
export function encodeSimDerived(v: SimDerived): JSONObject {
  const out = pickKeys(v, ['name', 'expr', 'label', 'unit', 'decimals', 'tex'])
  if (!v.show) out.show = false
  return out
}

export function decodeSimTime(raw: unknown): SimTime | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    name: flexStr(c, 'name') ?? 't', min: flexStr(c, 'min') ?? '0', max: flexStr(c, 'max') ?? '10', speed: flexNum(c, 'speed') ?? 1,
    loop: bool(c, 'loop') ?? true, autoplay: bool(c, 'autoplay') ?? false, label: str(c, 'label'), unit: str(c, 'unit')
  })
}
export const encodeSimTime = (v: SimTime): JSONObject => pickKeys(v, ['name', 'min', 'max', 'speed', 'loop', 'autoplay', 'label', 'unit'])

const SIM_OBJECT_STRINGS = ['x', 'y', 'dx', 'dy', 'x1', 'y1', 'x2', 'y2', 'from', 'to', 'variable'] as const

export function decodeSimObject(raw: unknown): SimObject | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const out: SimObject = { kind: (flexStr(c, 'kind') ?? flexStr(c, 'type') ?? 'point').toLowerCase(), dashed: bool(c, 'dashed') ?? false, trail: bool(c, 'trail') ?? false }
  for (const k of SIM_OBJECT_STRINGS) { const v = flexStr(c, k); if (v !== undefined) out[k] = v }
  const text = flexStr(c, 'text') ?? flexStr(c, 'label'); if (text !== undefined) out.text = text
  const color = str(c, 'color'); if (color !== undefined) out.color = color
  return out
}
export function encodeSimObject(v: SimObject): JSONObject {
  const out = pickKeys(v, ['kind', ...SIM_OBJECT_STRINGS, 'text', 'color'])
  if (v.dashed) out.dashed = true
  if (v.trail) out.trail = true
  return out
}
/** Todas las expresiones del objeto (para validarlas). */
export const simObjectExpressions = (o: SimObject): Array<[string, string]> =>
  (['x', 'y', 'dx', 'dy', 'x1', 'y1', 'x2', 'y2', 'from', 'to'] as const).flatMap((k) => (o[k] !== undefined ? [[k, o[k]!] as [string, string]] : []))

export function decodeSimulation(raw: unknown, d = 0): SimulationBlock | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const presetRaw = flexStr(c, 'preset')
  const self: SimulationBlock = prune({
    title: str(c, 'title'), intro: str(c, 'intro'), preset: presetRaw === undefined ? undefined : SimulationPresets.canonical(presetRaw),
    params: list(c, 'params', decodeSimParam, d).slice(0, 12), constants: list(c, 'constants', decodeSimConstant, d).slice(0, 30),
    derived: list(c, 'derived', decodeSimDerived, d).slice(0, 30), time: nested(c, 'time', decodeSimTime, d),
    plot: nested(c, 'plot', decodePlotSpec, d) ?? makePlotSpec(), objects: list(c, 'objects', decodeSimObject, d).slice(0, 60),
    formulas: list(c, 'formulas', decodeFormulaItem, d), prompts: strings(c, 'prompts'), caption: str(c, 'caption')
  })
  // un modelo de la biblioteca: lo que la IA no escribió lo pone el modelo
  const base = self.preset !== undefined ? SimulationPresets.make(self.preset) : undefined
  return base ? mergeSimulation(base, self) : self
}

/** Lo escrito encima del modelo de la biblioteca (los arreglos no vacíos sustituyen a los del modelo). */
export function mergeSimulation(base: SimulationBlock, o: SimulationBlock): SimulationBlock {
  const r: SimulationBlock = { ...base }
  r.preset = o.preset
  if (r.preset === undefined) delete r.preset
  if (o.title) r.title = o.title
  if (o.intro) r.intro = o.intro
  if (o.caption !== undefined) r.caption = o.caption
  const byName = <T extends { name: string }>(baseList: T[], over: T[]): T[] => {
    if (!over.length) return baseList
    const out = baseList.slice()
    for (const p of over) {
      const k = out.findIndex((x) => x.name === p.name)
      if (k >= 0) out[k] = p
      else out.push(p)
    }
    return out
  }
  // los nombres que no están en el modelo se ignorarían al calcular: se ajustan los del modelo con lo escrito
  r.params = byName(r.params, o.params)
  r.constants = byName(r.constants, o.constants)
  r.derived = byName(r.derived, o.derived)
  if (o.time) r.time = o.time
  const p = o.plot
  if (p.curves.length || p.points.length || p.lines.length || p.xMin !== undefined || p.yMin !== undefined || p.title !== undefined) r.plot = p
  if (o.objects.length) r.objects = o.objects
  if (o.formulas.length) r.formulas = o.formulas
  if (o.prompts.length) r.prompts = o.prompts
  return r
}

export function encodeSimulation(v: SimulationBlock): JSONObject {
  const out = pickKeys(v, ['title', 'intro', 'preset'])
  out.params = v.params.map(encodeSimParam)
  out.constants = v.constants.map(encodeSimConstant)
  out.derived = v.derived.map(encodeSimDerived)
  if (v.time) out.time = encodeSimTime(v.time)
  out.plot = encodePlotSpec(v.plot)
  out.objects = v.objects.map(encodeSimObject)
  out.formulas = v.formulas.map(encodeFormulaItem)
  out.prompts = [...v.prompts]
  put(out, 'caption', v.caption)
  return out
}

/** Todos los nombres que pueden usar las expresiones (parámetros, constantes, magnitudes y el reloj). */
export const simulationSymbolNames = (s: SimulationBlock): string[] =>
  [...s.params.map((p) => p.name), ...s.constants.map((p) => p.name), ...s.derived.map((p) => p.name), ...(s.time ? [s.time.name] : [])]

// MARK: Mapa

export interface MapMarker { lat: number; lon: number; title: string; md?: string; color?: string }
/** Región (país, imperio, cuenca…): contorno [[lat, lon], …]. */
export interface MapRegion { name: string; points: number[][]; color?: string; md?: string }
/** Ruta o frontera: línea [[lat, lon], …]. */
export interface MapRoute { points: number[][]; label?: string; color?: string; dashed: boolean }

/** Mapa con marcadores, regiones y rutas. */
export interface MapBlock {
  title?: string
  caption?: string
  /** Centro y extensión (grados de latitud visibles). Si faltan, se encuadra todo el contenido. */
  lat?: number
  lon?: number
  span?: number
  /** "standard" | "muted" | "satellite" | "hybrid" */
  style: string
  markers: MapMarker[]
  regions: MapRegion[]
  routes: MapRoute[]
  /** Práctica «¿dónde está…?». */
  practice: boolean
}

export function decodeMapMarker(raw: unknown): MapMarker | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    lat: flexNum(c, 'lat') ?? flexNum(c, 'latitude') ?? 0, lon: flexNum(c, 'lon') ?? flexNum(c, 'lng') ?? flexNum(c, 'longitude') ?? 0,
    title: flexStr(c, 'title') ?? flexStr(c, 'name') ?? flexStr(c, 'label') ?? '', md: str(c, 'md') ?? str(c, 'detail'), color: str(c, 'color')
  })
}
export const encodeMapMarker = (v: MapMarker): JSONObject => pickKeys(v, ['lat', 'lon', 'title', 'md', 'color'])

export function decodeMapRegion(raw: unknown): MapRegion | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({ name: flexStr(c, 'name') ?? flexStr(c, 'title') ?? '', points: points(c, 'points') ?? points(c, 'polygon') ?? [], color: str(c, 'color'), md: str(c, 'md') ?? str(c, 'detail') })
}
export const encodeMapRegion = (v: MapRegion): JSONObject => pickKeys(v, ['name', 'points', 'color', 'md'])

export function decodeMapRoute(raw: unknown): MapRoute | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({ points: points(c, 'points') ?? [], label: str(c, 'label') ?? str(c, 'name'), color: str(c, 'color'), dashed: bool(c, 'dashed') ?? false })
}
export function encodeMapRoute(v: MapRoute): JSONObject {
  const out = pickKeys(v, ['points', 'label', 'color'])
  if (v.dashed) out.dashed = true
  return out
}

export function decodeMap(raw: unknown, d = 0): MapBlock | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  let lat: number | undefined, lon: number | undefined
  const center = flexNums(c, 'center')
  const centerMarker = center ? undefined : nested(c, 'center', decodeMapMarker, d)
  if (center && center.length >= 2) { lat = center[0]; lon = center[1] }
  else if (centerMarker) { lat = centerMarker.lat; lon = centerMarker.lon }
  else { lat = flexNum(c, 'lat'); lon = flexNum(c, 'lon') }
  return prune({
    title: str(c, 'title'), caption: str(c, 'caption'), lat, lon, span: flexNum(c, 'span'), style: str(c, 'style')?.toLowerCase() ?? 'muted',
    markers: list(c, 'markers', decodeMapMarker, d).slice(0, 300), regions: list(c, 'regions', decodeMapRegion, d).slice(0, 60),
    routes: list(c, 'routes', decodeMapRoute, d).slice(0, 60), practice: bool(c, 'practice') ?? false
  })
}

export function encodeMap(v: MapBlock): JSONObject {
  const out = pickKeys(v, ['title', 'caption', 'lat', 'lon', 'span', 'style'])
  if (v.markers.length) out.markers = v.markers.map(encodeMapMarker)
  if (v.regions.length) out.regions = v.regions.map(encodeMapRegion)
  if (v.routes.length) out.routes = v.routes.map(encodeMapRoute)
  if (v.practice) out.practice = true
  return out
}

/** Todos los puntos [lat, lon] del mapa (para encuadrarlo). */
export const mapCoordinates = (m: MapBlock): Array<[number, number]> => [
  ...m.markers.map((k) => [k.lat, k.lon] as [number, number]),
  ...m.regions.flatMap((r) => r.points.filter((p) => p.length >= 2).map((p) => [p[0], p[1]] as [number, number])),
  ...m.routes.flatMap((r) => r.points.filter((p) => p.length >= 2).map((p) => [p[0], p[1]] as [number, number]))
]

// MARK: Fechas históricas (línea de tiempo proporcional)

const decimalNum = (s: string): number | undefined => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : undefined)

/**
 * Lee fechas como las escriben los libros: «1789», «1789-07-14», «500 a. C.», «44 BC», «c. 1450», «1914–1918», «siglo XV»,
 * «65 Ma». Devuelve años decimales (negativos antes de Cristo).
 */
export const HistoricalDate = {
  parse(raw: string): { start: number; end?: number } | undefined {
    let s = raw.trim().toLowerCase()
    if (!s || Array.from(s).length >= 60) return undefined
    for (const p of ['c. ', 'ca. ', 'c.', 'ca.', 'circa ', 'hacia ', 'h. ', 'aprox. ', '~', '≈']) if (s.startsWith(p)) s = s.slice(p.length).trim()
    // rangos «1914–1918», «1914 - 1918», «1914 a 1918», «1914 to 1918»
    for (const sep of ['–', '—', ' - ', ' a ', ' to ', ' al ', ' hasta ']) {
      const at = s.indexOf(sep)
      if (at >= 0) {
        const a = s.slice(0, at), b = s.slice(at + sep.length)
        let x = HistoricalDate.single(a)
        const y = HistoricalDate.single(b)
        if (x !== undefined && y !== undefined) {
          // «500–400 a. C.»: el sufijo de era del final vale para los dos
          if (y < 0 && x > 0 && !HistoricalDate.hasEra(a)) x = -x
          return { start: x, end: y }
        }
      }
    }
    // «1914-1918» (dos años de 3-4 cifras con guion) no es una fecha ISO
    const m = /^(\d{3,4})-(\d{3,4})$/.exec(s)
    if (m && Number(m[2]) > Number(m[1])) return { start: Number(m[1]), end: Number(m[2]) }
    const one = HistoricalDate.single(s)
    return one === undefined ? undefined : { start: one }
  },
  hasEra(s: string): boolean {
    return ['a. c', 'a.c', 'ac', 'bc', 'bce', 'd. c', 'd.c', 'dc', 'ad', 'ce', 'ma', 'ka'].some((e) => s.includes(e))
  },
  single(raw: string): number | undefined {
    let s = raw.trim()
    if (!s) return undefined
    // millones / miles de años
    for (const [suf, k] of [[' ma', 1e6], ['ma', 1e6], [' millones de años', 1e6], [' mya', 1e6], [' ka', 1e3], [' mil años', 1e3]] as Array<[string, number]>) {
      if (s.endsWith(suf)) {
        const v = decimalNum(s.slice(0, -suf.length).trim().replace(/,/g, '.'))
        if (v !== undefined) return -v * k
      }
    }
    // siglo XV / s. XV
    const romans: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21 }
    for (const p of ['siglo ', 's. ', 's.']) {
      if (!s.startsWith(p)) continue
      let rest = s.slice(p.length).trim()
      let bc = false
      for (const e of [' a. c.', ' a.c.', ' ac', ' bc']) if (rest.endsWith(e)) { rest = rest.slice(0, -e.length); bc = true }
      // siglos razonables: «siglo -9223372036854775808» desbordaba y cerraba la app
      const n = romans[rest] ?? (/^[+-]?\d+$/.test(rest) ? Number(rest) : undefined)
      if (n !== undefined && n >= 1 && n <= 100) { const mid = (n - 1) * 100 + 50; return bc ? -mid : mid }
    }
    let sign = 1
    for (const e of ['a. c.', 'a.c.', 'a. c', 'a.c', 'ac', 'a.n.e.', 'bce', 'bc']) if (s.endsWith(e)) { s = s.slice(0, -e.length).trim(); sign = -1; break }
    if (sign > 0) for (const e of ['d. c.', 'd.c.', 'dc', 'ad', 'ce', 'n.e.']) if (s.endsWith(e)) { s = s.slice(0, -e.length).trim(); break }
    if (sign > 0 && s.startsWith('ad ')) s = s.slice(3)
    // fecha ISO 1789-07-14 o 1789-07
    const iso = s.split('-').filter((x) => x !== '')
    if (iso.length >= 2 && iso.length <= 3) {
      const y = decimalNum(iso[0]), mo = decimalNum(iso[1])
      if (y !== undefined && iso[0].length >= 3 && mo !== undefined && mo >= 1 && mo <= 12) {
        const day = iso.length === 3 ? decimalNum(iso[2]) ?? 1 : 1
        return sign * y + (mo - 1) / 12 + (day - 1) / 365
      }
    }
    // década «1960s»
    if (s.endsWith('s')) { const v = decimalNum(s.slice(0, -1)); if (v !== undefined) return sign * v + 5 }
    const v = decimalNum(s.replace(/,/g, '.'))
    if (v !== undefined && Number.isFinite(v) && Math.abs(v) < 1e10) return sign * v
    return undefined
  }
}
