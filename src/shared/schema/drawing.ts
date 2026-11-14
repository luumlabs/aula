// Partes nuevas del dibujo vectorial (`drawing`): elementos con nombre, marcas de geometría, objetos hechos, curvas suaves,
// rayado, movimiento (deslizadores y reloj) y pasos. Todo opcional: un curso antiguo se lee y se guarda igual que antes, y
// una versión antigua de la app ignora estas claves (ve el dibujo en reposo). Lo que una versión antigua no sabe pintar se
// guarda además de una forma que entiende (ver `withOldVersionFallbacks`).
import type { JSONObject } from '@engine/base/json'
import { bool, enumOf, flexNum, flexStr, isObj, list, nested, num, pickKeys, prune, str, strictNumbers, vFlexNum, type Obj } from './coding'
import type { DrawItem } from './common'
import type { SimParam, SimTime } from './visual'

export const DRAW_STYLES = ['clean', 'hand'] as const
export type DrawStyle = (typeof DRAW_STYLES)[number]

export const DRAW_FILL_STYLES = ['solid', 'hatch'] as const
export type DrawFillStyle = (typeof DRAW_FILL_STYLES)[number]

/**
 * Movimiento de un elemento (expresiones con los deslizadores y el reloj del dibujo). Lo escrito en el elemento es la
 * imagen en REPOSO; esto solo la desplaza o la gira.
 */
export interface DrawMotion {
  /** Desplazamiento rígido (unidades del lienzo). */
  dx?: string
  dy?: string
  /** Giro en grados, antihorario, alrededor de `pivot` (por defecto, el centro del elemento). */
  turn?: string
  pivot?: number[]
  /** Id de otro elemento: el centro de este recorre su contorno… */
  along?: string
  /** …en la fracción `at` (0–1; en contornos cerrados da la vuelta). */
  at?: string
  /** Gira con la tangente del recorrido. */
  orient?: boolean
}

/** Un paso de un dibujo que se construye poco a poco. */
export interface DrawingStep {
  title?: string
  md: string
  /** Se ven los elementos con `stage` ≤ show (se arrastra de los pasos anteriores). */
  show?: number
  /** Valores de los deslizadores en este paso (se deslizan hasta ellos). */
  params?: Record<string, number>
  /** Ids de los elementos que se rodean en ladrillo (el resto se atenúa). */
  highlight?: string[]
}

/** Campos nuevos de `DrawItem` (todos opcionales). */
export interface DrawItemMore {
  /** Nombre estable del elemento (lo usan `along`, los pasos y «marcar y preguntar»). */
  id?: string
  /** Cómo lo ve y lo nombra el estudiante («fuerza normal»). */
  name?: string
  /** measure: separación del segmento; brace: profundidad; axes/grid: paso; object: giro (grados, antihorario). */
  offset?: number
  depth?: number
  step?: number
  rotate?: number
  /** Nombres de los ejes (axes). */
  xLabel?: string
  yLabel?: string
  /** axes: los ejes se cruzan en el origen y siguen también hacia el otro lado. */
  full?: boolean
  /** Objeto hecho (person, car, tree…). */
  object?: string
  flip?: boolean
  /** polyline/polygon: curva suave por los puntos. */
  smooth?: boolean
  fillStyle?: DrawFillStyle
  motion?: DrawMotion
  /** Paso desde el que aparece (0 = desde el principio). */
  stage?: number
}

/** Campos nuevos de `DrawingBlock` (todos opcionales). */
export interface DrawingMore {
  /** Deslizadores (como los de una simulación; como mucho 6). */
  params?: SimParam[]
  /** Reloj de la animación. */
  time?: SimTime
  steps?: DrawingStep[]
  /** 'hand': todo el dibujo a mano alzada (las marcas de geometría siguen exactas). */
  style?: DrawStyle
}

export const DRAW_MAX_PARAMS = 6
export const DRAW_MAX_STEPS = 12
const MOTION_EXPRS = ['dx', 'dy', 'turn', 'along', 'at'] as const
const MORE_NUMBERS = ['offset', 'depth', 'step', 'rotate'] as const

// MARK: Papel y ángulos de tres puntos

/** ¿Es el color del papel («paper» o «papel»)? Un relleno de papel tapa lo que queda detrás. */
export const isPaperColor = (name: string | undefined): boolean => !!name && /^(paper|papel)$/i.test(name.trim())

/** Radio por defecto del ángulo de tres puntos. */
export const ANGLE_RADIUS = 22

type XY = [number, number]

/** Los tres primeros puntos válidos de un ángulo (brazo, vértice, brazo), o undefined si no llegan a tres. */
export function anglePoints(points: readonly (readonly number[])[] | undefined): [XY, XY, XY] | undefined {
  const out: XY[] = []
  for (const q of (points ?? []).slice(0, 2000)) {
    if (q.length < 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue
    out.push([q[0], q[1]])
    if (out.length === 3) return [out[0], out[1], out[2]]
  }
  return undefined
}

/** Grados (antihorario desde la derecha, como los arcos) de `p` visto desde `v`; el lienzo va con y hacia abajo. */
const degFrom = (v: readonly number[], p: readonly number[]): number => (Math.atan2(-(p[1] - v[1]), p[0] - v[0]) * 180) / Math.PI

/** Barrido con signo de un ángulo de tres puntos, siempre el menor (−180…180), desde el primer brazo. */
export function angleSweep(a: readonly number[], v: readonly number[], b: readonly number[]): { from: number; sweep: number } {
  const from = degFrom(v, a)
  return { from, sweep: ((degFrom(v, b) - from + 540) % 360) - 180 }
}

// (+ 0: nunca −0 en el JSON)
const round2 = (n: number): number => Math.round(n * 100) / 100 + 0

// MARK: Versiones antiguas

/**
 * Al guardar, lo que una versión antigua de Aula (0.2.4) sabe pintar, junto a lo nuevo (la nueva lo deshace al leer, en
 * `settleDrawItem`):
 * - un ángulo de tres puntos lleva también cx, cy, start y end (y r si falta, con el radio de ahora): la antigua pinta el
 *   mismo arco en el vértice; un rightAngle, cx y cy (su cuadradito va en el vértice, aunque siempre hacia la derecha y
 *   arriba). La nueva pinta siempre con los puntos; estos números se recalculan en cada guardado.
 * - un objeto se guarda como `text` con su `object`: la antigua escribe su etiqueta donde está el objeto (y nada si no
 *   tiene) en lugar de una línea y la etiqueta en la esquina; la nueva ve `object` y lo dibuja.
 * - un relleno de papel (no rayado) va en `fillStyle: "paper"`, sin `fill`: la antigua lo deja sin relleno en lugar de una
 *   aguada ladrillo, que se leería como algo destacado.
 */
export function withOldVersionFallbacks(v: DrawItem, out: JSONObject): JSONObject {
  if (v.kind === 'angle' || v.kind === 'rightAngle') {
    const arms = anglePoints(v.points)
    if (arms) {
      const [a, vertex, b] = arms
      out.cx = vertex[0]
      out.cy = vertex[1]
      if (v.kind === 'angle') {
        const { from, sweep } = angleSweep(a, vertex, b)
        out.start = round2(from)
        out.end = round2(from + sweep)
        if (v.r === undefined) out.r = ANGLE_RADIUS
      }
    }
  }
  if (v.kind === 'object' && v.object !== undefined) {
    out.kind = 'text'
    // la antigua escribe el texto en x, y (un objeto también se puede situar con cx, cy)
    if (v.x === undefined && v.cx !== undefined) out.x = v.cx
    if (v.y === undefined && v.cy !== undefined) out.y = v.cy
  }
  if (isPaperColor(v.fill) && v.fillStyle !== 'hatch') {
    delete out.fill
    out.fillStyle = 'paper'
  }
  return out
}

/** Al leer: deshace lo que se escribió para las versiones antiguas (ver `withOldVersionFallbacks`). `c` es el JSON leído. */
export function settleDrawItem(c: Obj, it: DrawItem): void {
  // un objeto guardado como texto; la x, y copiadas de cx, cy para la antigua sobran (si no, una cx, cy cambiada después
  // no movería el objeto: manda x, y)
  if (it.kind === 'text' && it.object !== undefined) {
    it.kind = 'object'
    if (it.cx !== undefined && it.x === it.cx) delete it.x
    if (it.cy !== undefined && it.y === it.cy) delete it.y
  }
  // con tres puntos mandan los puntos: el centro y los grados eran para las versiones antiguas
  if ((it.kind === 'angle' || it.kind === 'rightAngle') && anglePoints(it.points)) {
    delete it.cx
    delete it.cy
    delete it.start
    delete it.end
  }
  // el papel guardado como estilo de relleno
  if (it.fill === undefined && isPaperColor(str(c, 'fillStyle'))) it.fill = 'paper'
}

// MARK: Movimiento

export function decodeDrawMotion(raw: unknown): DrawMotion | undefined {
  if (!isObj(raw)) return undefined
  const out: DrawMotion = {}
  for (const k of MOTION_EXPRS) { const v = flexStr(raw, k); if (v !== undefined && v.trim()) out[k] = v.slice(0, 400) }
  const pivot = strictNumbers(raw, 'pivot'); if (pivot && pivot.length >= 2) out.pivot = pivot.slice(0, 2)
  const orient = bool(raw, 'orient'); if (orient !== undefined) out.orient = orient
  return Object.keys(out).length ? out : undefined
}

export const encodeDrawMotion = (v: DrawMotion): JSONObject => pickKeys(v, ['dx', 'dy', 'turn', 'pivot', 'along', 'at', 'orient'])

// MARK: Pasos

export function decodeDrawingStep(raw: unknown): DrawingStep | undefined {
  if (typeof raw === 'string') return { md: raw }
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const show = flexNum(c, 'show')
  const params: Record<string, number> = {}
  if (isObj(c.params)) {
    for (const [k, v] of Object.entries(c.params).slice(0, DRAW_MAX_PARAMS * 2)) {
      const n = vFlexNum(v)
      if (n !== undefined && Number.isFinite(n) && k !== '__proto__') params[k] = n
    }
  }
  // `items` es el nombre que usa el recorrido guiado de otras figuras: vale lo mismo que `highlight`
  const ids = (Array.isArray(c.highlight) ? c.highlight : Array.isArray(c.items) ? c.items : [])
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : undefined))
    .filter((x): x is string => !!x)
    .slice(0, 8)
  return prune({
    title: str(c, 'title'),
    md: flexStr(c, 'md') ?? flexStr(c, 'text') ?? '',
    show: show !== undefined && Number.isFinite(show) ? Math.max(0, Math.min(99, Math.round(show))) : undefined,
    params: Object.keys(params).length ? params : undefined,
    highlight: ids.length ? ids : undefined
  })
}

export function encodeDrawingStep(v: DrawingStep): JSONObject {
  const out = pickKeys(v, ['title', 'md', 'show', 'highlight'])
  if (v.params && Object.keys(v.params).length) out.params = { ...v.params }
  return out
}

// MARK: Deslizadores y reloj (mismo formato que los de la simulación; aquí sin importar visual.ts para no crear un ciclo)

export function decodeDrawParam(raw: unknown): SimParam | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const min = flexNum(c, 'min') ?? 0
  return prune({ name: flexStr(c, 'name') ?? 'a', label: str(c, 'label'), min, max: flexNum(c, 'max') ?? 10, step: flexNum(c, 'step') ?? 1, value: flexNum(c, 'value') ?? min, unit: str(c, 'unit') })
}

export const encodeDrawParam = (v: SimParam): JSONObject => pickKeys(v, ['name', 'label', 'min', 'max', 'step', 'value', 'unit'])

export function decodeDrawTime(raw: unknown): SimTime | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    name: flexStr(c, 'name') ?? 't', min: flexStr(c, 'min') ?? '0', max: flexStr(c, 'max') ?? '10', speed: flexNum(c, 'speed') ?? 1,
    loop: bool(c, 'loop') ?? true, autoplay: bool(c, 'autoplay') ?? false, label: str(c, 'label'), unit: str(c, 'unit')
  })
}

export const encodeDrawTime = (v: SimTime): JSONObject => pickKeys(v, ['name', 'min', 'max', 'speed', 'loop', 'autoplay', 'label', 'unit'])

// MARK: Elemento y dibujo

/** Lee los campos nuevos de un elemento sobre `out`. */
export function decodeDrawItemMore(c: Obj, out: DrawItemMore): void {
  const id = flexStr(c, 'id'); if (id !== undefined && id.trim()) out.id = id.trim().slice(0, 80)
  const name = flexStr(c, 'name'); if (name !== undefined && name.trim()) out.name = name.slice(0, 200)
  for (const k of MORE_NUMBERS) { const v = num(c, k); if (v !== undefined) out[k] = v }
  for (const k of ['xLabel', 'yLabel'] as const) { const v = flexStr(c, k); if (v !== undefined) out[k] = v.slice(0, 200) }
  const object = str(c, 'object'); if (object !== undefined && object.trim()) out.object = object.trim().toLowerCase().slice(0, 40)
  for (const k of ['full', 'flip', 'smooth'] as const) { const v = bool(c, k); if (v !== undefined) out[k] = v }
  const fillStyle = enumOf(c, 'fillStyle', DRAW_FILL_STYLES); if (fillStyle) out.fillStyle = fillStyle
  const motion = nested(c, 'motion', (x) => decodeDrawMotion(x), 0); if (motion) out.motion = motion
  const stage = flexNum(c, 'stage'); if (stage !== undefined && Number.isFinite(stage)) out.stage = Math.max(0, Math.min(99, Math.round(stage)))
}

/** Escribe los campos nuevos de un elemento (solo los presentes). */
export function encodeDrawItemMore(v: DrawItemMore): JSONObject {
  const out = pickKeys(v, ['id', 'name', ...MORE_NUMBERS, 'xLabel', 'yLabel', 'full', 'object', 'flip', 'smooth', 'fillStyle', 'stage'])
  if (v.motion) out.motion = encodeDrawMotion(v.motion)
  return out
}

/** Lee los campos nuevos de un dibujo (undefined los que no están: el JSON de un curso antiguo sale idéntico). */
export function decodeDrawingMore(raw: Obj, d: number): DrawingMore {
  const params = list(raw, 'params', decodeDrawParam, d).slice(0, DRAW_MAX_PARAMS)
  const steps = list(raw, 'steps', decodeDrawingStep, d).slice(0, DRAW_MAX_STEPS)
  return prune({
    params: params.length ? params : undefined,
    time: nested(raw, 'time', decodeDrawTime, d),
    steps: steps.length ? steps : undefined,
    style: enumOf(raw, 'style', DRAW_STYLES)
  })
}

export function encodeDrawingMore(v: DrawingMore): JSONObject {
  const out: JSONObject = {}
  if (v.params?.length) out.params = v.params.map(encodeDrawParam)
  if (v.time) out.time = encodeDrawTime(v.time)
  if (v.steps?.length) out.steps = v.steps.map(encodeDrawingStep)
  if (v.style) out.style = v.style
  return out
}
