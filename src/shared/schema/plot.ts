// Especificación de gráficas (port de StudyModel/Plot.swift): se dibuja de forma nativa; la IA solo escribe datos.
import { IDs } from '@engine/base/ids'
import type { JSONObject } from '@engine/base/json'
import { bool, enumOf, flexStr, isObj, list, num, pickKeys, prune, str, type Obj } from './coding'

/** Nombres de color permitidos (la interfaz los traduce a colores del tema); también se acepta "#RRGGBB". */
export const PLOT_COLORS = ['accent', 'blue', 'red', 'green', 'orange', 'purple', 'pink', 'teal', 'gray', 'ink', 'yellow'] as const

export interface PlotCurve {
  id: string
  /** Expresión en x (y en los parámetros de `explore`): "2*sin(3*x-pi/2)+1". */
  expr: string
  /** Trigonometría en grados; false conserva radianes en los archivos antiguos. */
  degrees: boolean
  label?: string
  color: string
  dashed: boolean
  width: number
  /** Dominio de dibujo (f(x)=√x solo en x ≥ 0, funciones a trozos). */
  domainMin?: number
  domainMax?: number
  domainMinOpen: boolean
  domainMaxOpen: boolean
}

export interface PlotParametric {
  /** Expresiones en t. */
  x: string
  y: string
  tMin: number
  tMax: number
  label?: string
  color: string
  dashed: boolean
}

export interface PlotPolar {
  /** r(theta) */
  r: string
  thetaMin: number
  thetaMax: number
  label?: string
  color: string
}

export const PLOT_POINT_STYLES = ['filled', 'open', 'cross', 'square'] as const
export type PlotPointStyle = (typeof PLOT_POINT_STYLES)[number]

export interface PlotPoint {
  /** x e y pueden ser números o expresiones ("pi/2", "sqrt(3)/2"). */
  x: string
  y: string
  label?: string
  style: PlotPointStyle
  color: string
}

export const PLOT_LINE_KINDS = ['vertical', 'horizontal', 'segment', 'ray', 'line'] as const
export type PlotLineKind = (typeof PLOT_LINE_KINDS)[number]

export interface PlotLine {
  kind: PlotLineKind
  /** vertical: x · horizontal: y · segment/ray/line: (x1,y1)-(x2,y2). Admiten expresiones. */
  x?: string
  y?: string
  x1?: string
  y1?: string
  x2?: string
  y2?: string
  label?: string
  color: string
  dashed: boolean
  arrow: boolean
}

/** Región sombreada: entre dos curvas (o entre una curva y el eje x) en [from, to]. */
export interface PlotRegion {
  upper: string
  lower: string
  from: string
  to: string
  color: string
  opacity: number
  label?: string
}

export interface PlotLabel {
  x: string
  y: string
  /** LaTeX o texto corto. */
  tex: string
  color: string
  /** "center", "left", "right", "top", "bottom" y combinaciones ("topLeft"). */
  anchor: string
}

export interface PlotSpec {
  title?: string
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  xLabel?: string
  yLabel?: string
  /** Marcas del eje x en múltiplos de π, para trigonometría. */
  xPi: boolean
  xTickStep?: number
  yTickStep?: number
  grid: boolean
  axes: boolean
  /** Misma escala en x e y (circunferencias redondas). */
  equalAspect: boolean
  curves: PlotCurve[]
  parametric: PlotParametric[]
  polar: PlotPolar[]
  points: PlotPoint[]
  lines: PlotLine[]
  regions: PlotRegion[]
  labels: PlotLabel[]
  caption?: string
  /** Altura relativa respecto al ancho (por defecto 0.62). */
  aspectRatio?: number
}

/** Parámetro deslizable de un bloque `explore`. */
export interface ExploreParam {
  /** Letra usada en las expresiones: a, b, c, k… */
  name: string
  label?: string
  min: number
  max: number
  step: number
  value: number
}

export function makePlotSpec(p: Partial<PlotSpec> = {}): PlotSpec {
  return prune({
    xPi: false, grid: true, axes: true, equalAspect: false,
    curves: [], parametric: [], polar: [], points: [], lines: [], regions: [], labels: [],
    ...p
  })
}

export function makePlotCurve(p: Partial<PlotCurve> & { expr: string }): PlotCurve {
  return prune({ id: IDs.short(5), degrees: false, color: 'accent', dashed: false, width: 2.2, domainMinOpen: false, domainMaxOpen: false, ...p })
}

export function makePlotLine(p: Partial<PlotLine> & { kind: PlotLineKind }): PlotLine {
  return prune({ color: 'gray', dashed: true, arrow: false, ...p })
}

// MARK: Leer

export function decodePlotCurve(raw: unknown): PlotCurve | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    id: str(c, 'id') ?? IDs.short(5), expr: str(c, 'expr') ?? '', label: str(c, 'label'), color: str(c, 'color') ?? 'accent',
    dashed: bool(c, 'dashed') ?? false, width: num(c, 'width') ?? 2.2, degrees: bool(c, 'degrees') ?? false,
    domainMin: num(c, 'domainMin'), domainMax: num(c, 'domainMax'),
    domainMinOpen: bool(c, 'domainMinOpen') ?? false, domainMaxOpen: bool(c, 'domainMaxOpen') ?? false
  })
}

export function decodePlotParametric(raw: unknown): PlotParametric | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    x: str(c, 'x') ?? 't', y: str(c, 'y') ?? 't', tMin: num(c, 'tMin') ?? 0, tMax: num(c, 'tMax') ?? 6.2831853,
    label: str(c, 'label'), color: str(c, 'color') ?? 'accent', dashed: bool(c, 'dashed') ?? false
  })
}

export function decodePlotPolar(raw: unknown): PlotPolar | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({ r: str(c, 'r') ?? '1', thetaMin: num(c, 'thetaMin') ?? 0, thetaMax: num(c, 'thetaMax') ?? 6.2831853, label: str(c, 'label'), color: str(c, 'color') ?? 'accent' })
}

export function decodePlotPoint(raw: unknown): PlotPoint | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    x: flexStr(c, 'x') ?? '0', y: flexStr(c, 'y') ?? '0', label: str(c, 'label'),
    style: enumOf(c, 'style', PLOT_POINT_STYLES) ?? 'filled', color: str(c, 'color') ?? 'accent'
  })
}

export function decodePlotLine(raw: unknown): PlotLine | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    kind: enumOf(c, 'kind', PLOT_LINE_KINDS) ?? 'segment',
    x: flexStr(c, 'x'), y: flexStr(c, 'y'), x1: flexStr(c, 'x1'), y1: flexStr(c, 'y1'), x2: flexStr(c, 'x2'), y2: flexStr(c, 'y2'),
    label: str(c, 'label'), color: str(c, 'color') ?? 'gray', dashed: bool(c, 'dashed') ?? true, arrow: bool(c, 'arrow') ?? false
  })
}

export function decodePlotRegion(raw: unknown): PlotRegion | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    upper: flexStr(c, 'upper') ?? '0', lower: flexStr(c, 'lower') ?? '0', from: flexStr(c, 'from') ?? '0', to: flexStr(c, 'to') ?? '0',
    color: str(c, 'color') ?? 'accent', opacity: num(c, 'opacity') ?? 0.18, label: str(c, 'label')
  })
}

export function decodePlotLabel(raw: unknown): PlotLabel | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return { x: flexStr(c, 'x') ?? '0', y: flexStr(c, 'y') ?? '0', tex: str(c, 'tex') ?? '', color: str(c, 'color') ?? 'ink', anchor: str(c, 'anchor') ?? 'center' }
}

export function decodePlotSpec(raw: unknown, d = 0): PlotSpec | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    title: str(c, 'title'), xMin: num(c, 'xMin'), xMax: num(c, 'xMax'), yMin: num(c, 'yMin'), yMax: num(c, 'yMax'),
    xLabel: str(c, 'xLabel'), yLabel: str(c, 'yLabel'), xPi: bool(c, 'xPi') ?? false,
    xTickStep: num(c, 'xTickStep'), yTickStep: num(c, 'yTickStep'),
    grid: bool(c, 'grid') ?? true, axes: bool(c, 'axes') ?? true, equalAspect: bool(c, 'equalAspect') ?? false,
    curves: list(c, 'curves', decodePlotCurve, d), parametric: list(c, 'parametric', decodePlotParametric, d), polar: list(c, 'polar', decodePlotPolar, d),
    points: list(c, 'points', decodePlotPoint, d), lines: list(c, 'lines', decodePlotLine, d), regions: list(c, 'regions', decodePlotRegion, d),
    labels: list(c, 'labels', decodePlotLabel, d), caption: str(c, 'caption'), aspectRatio: num(c, 'aspectRatio')
  })
}

export function decodeExploreParam(raw: unknown): ExploreParam | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  const mn = num(c, 'min') ?? -5
  const mx = num(c, 'max') ?? 5
  return prune({ name: str(c, 'name') ?? 'a', label: str(c, 'label'), min: mn, max: mx, step: num(c, 'step') ?? 1, value: num(c, 'value') ?? mn })
}

// MARK: Escribir (todas las claves; los opcionales solo si están)

const pick = pickKeys

export const encodePlotCurve = (v: PlotCurve): JSONObject =>
  pick(v, ['id', 'expr', 'degrees', 'label', 'color', 'dashed', 'width', 'domainMin', 'domainMax', 'domainMinOpen', 'domainMaxOpen'])
export const encodePlotParametric = (v: PlotParametric): JSONObject => pick(v, ['x', 'y', 'tMin', 'tMax', 'label', 'color', 'dashed'])
export const encodePlotPolar = (v: PlotPolar): JSONObject => pick(v, ['r', 'thetaMin', 'thetaMax', 'label', 'color'])
export const encodePlotPoint = (v: PlotPoint): JSONObject => pick(v, ['x', 'y', 'label', 'style', 'color'])
export const encodePlotLine = (v: PlotLine): JSONObject => pick(v, ['kind', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'label', 'color', 'dashed', 'arrow'])
export const encodePlotRegion = (v: PlotRegion): JSONObject => pick(v, ['upper', 'lower', 'from', 'to', 'color', 'opacity', 'label'])
export const encodePlotLabel = (v: PlotLabel): JSONObject => pick(v, ['x', 'y', 'tex', 'color', 'anchor'])
export const encodeExploreParam = (v: ExploreParam): JSONObject => pick(v, ['name', 'label', 'min', 'max', 'step', 'value'])

export function encodePlotSpec(v: PlotSpec): JSONObject {
  const out = pick(v, ['title', 'xMin', 'xMax', 'yMin', 'yMax', 'xLabel', 'yLabel', 'xPi', 'xTickStep', 'yTickStep', 'grid', 'axes', 'equalAspect', 'caption', 'aspectRatio'])
  out.curves = v.curves.map(encodePlotCurve)
  out.parametric = v.parametric.map(encodePlotParametric)
  out.polar = v.polar.map(encodePlotPolar)
  out.points = v.points.map(encodePlotPoint)
  out.lines = v.lines.map(encodePlotLine)
  out.regions = v.regions.map(encodePlotRegion)
  out.labels = v.labels.map(encodePlotLabel)
  return out
}
