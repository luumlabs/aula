// Bloques de contenido (lecciones, explicaciones, enunciados) — port de StudyModel/Blocks.swift.
//
// Cada bloque se guarda como un objeto JSON plano: {"id": "...", "type": "text", ...campos del tipo...}. En memoria es el
// mismo objeto (unión discriminada por `type`), salvo los tipos desconocidos, que se conservan como `type: 'unknown'` con su
// tipo original en `rawType` y el resto del JSON en `raw` (al guardar vuelven a su forma plana).
import { IDs } from '@engine/base/ids'
import type { JSONObject, JSONValue } from '@engine/base/json'
import {
  bool, bounded, fallbackID, flexRow, flexStr, int, isObj, list, nested, num, pickKeys, prune, put, str, strings, tooDeep, uniquifyIDs, vStr,
  type ItemID, type Obj
} from './coding'
import {
  decodeDrawing, decodeFormulaItem, decodeSourceRef, encodeDrawing, encodeFormulaItem, encodeSourceRef,
  type DrawingBlock, type FormulaItem, type SourceRef
} from './common'
import { decodeExercise, encodeExercise, type Exercise } from './exercises'
import { decodeExploreParam, decodePlotSpec, encodeExploreParam, encodePlotSpec, makePlotSpec, type ExploreParam, type PlotSpec } from './plot'
import {
  decodeLabeled, decodeMap, decodeModel3D, decodeSimulation, encodeLabeled, encodeMap, encodeModel3D, encodeSimulation,
  type LabeledBlock, type MapBlock, type Model3DBlock, type SimulationBlock
} from './visual'

// MARK: Tipos de bloque

/** Texto en Markdown ligero con matemáticas: `**negrita**`, `*cursiva*`, listas, `$x^2$`, `$$ … $$`. */
export interface TextBlock { md: string }
export interface MathBlock { tex: string; label?: string; note?: string }

export const CALLOUT_KINDS = ['note', 'tip', 'warning', 'definition', 'theorem', 'remember', 'example', 'examTip', 'mistake', 'question', 'source'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]
export interface CalloutBlock { kind: CalloutKind; title?: string; md: string }

export interface ExampleStep { md: string; note?: string }
/** Problema resuelto paso a paso (el estudiante va descubriendo los pasos). */
export interface ExampleBlock { title?: string; problem: string; steps: ExampleStep[]; answer?: string }

export interface ExploreBlock {
  title?: string
  plot: PlotSpec
  params: ExploreParam[]
  /** Preguntas que guían la exploración. */
  prompts: string[]
}

export interface TableBlock {
  headers: string[]
  rows: string[][]
  /** "left" | "center" | "right" por columna. */
  align: string[]
  caption?: string
  highlightRows: number[]
  firstColumnIsHeader: boolean
}

export const CHART_KINDS = ['bar', 'line', 'area', 'pie', 'scatter', 'histogram'] as const
export type ChartKind = (typeof CHART_KINDS)[number]
export interface ChartPoint { label?: string; x?: number; y: number }
export interface ChartSeries { name: string; color?: string; points: ChartPoint[] }
export interface ChartBlock {
  kind: ChartKind
  title?: string
  xLabel?: string
  yLabel?: string
  series: ChartSeries[]
  stacked: boolean
  unit?: string
  caption?: string
  showValues: boolean
}

export interface NumberLinePoint { value: string; label?: string; open: boolean; color: string }
export interface NumberLineInterval {
  /** undefined = infinito */
  from?: string
  to?: string
  fromOpen: boolean
  toOpen: boolean
  label?: string
  color: string
}
export interface NumberLineBlock {
  min: number
  max: number
  step?: number
  pi: boolean
  points: NumberLinePoint[]
  intervals: NumberLineInterval[]
  caption?: string
}

export const DIAGRAM_KINDS = ['flow', 'concept', 'tree', 'cycle', 'layers'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]
export const DIAGRAM_SHAPES = ['box', 'round', 'diamond', 'circle', 'note'] as const
export type DiagramShape = (typeof DIAGRAM_SHAPES)[number]
export interface DiagramNode { id: string; label: string; shape: DiagramShape; color?: string; detail?: string }
export interface DiagramEdge { from: string; to: string; label?: string; dashed: boolean; arrow: boolean }
/** Paso de un proceso animado: resalta nodos y flechas y explica qué pasa. */
export interface DiagramStep {
  title?: string
  md: string
  /** Ids de los nodos que se resaltan en este paso. */
  nodes: string[]
  /** Flechas que se resaltan: [["a", "b"], …] (de → a). */
  edges: string[][]
}
export interface DiagramBlock {
  kind: DiagramKind
  title?: string
  /** "lr" (izquierda→derecha) | "tb" (arriba→abajo) */
  direction: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  caption?: string
  /** Pasos animados (opcional). */
  steps: DiagramStep[]
}

export interface TimelineEvent {
  when: string
  title: string
  md?: string
  /** Fin (para hechos que duran: guerras, reinados, eras). */
  end?: string
  /** Carril o tema: cada uno con su color. */
  category?: string
  /** Imagen del curso que se ve al elegir el hecho. */
  asset?: string
  color?: string
}
/** Periodo o era de fondo. */
export interface TimelinePeriod { from: string; to: string; title: string; color?: string }
export interface TimelineBlock {
  title?: string
  events: TimelineEvent[]
  periods: TimelinePeriod[]
  /** "auto" | "horizontal" | "vertical" */
  layout: string
  caption?: string
}

export interface ImageHotspot { x: number; y: number; label: string }
export interface ImageBlock {
  /** Id de un archivo del curso (carpeta `assets/`). Si falta, se usa `source`. */
  asset?: string
  source?: SourceRef
  alt: string
  caption?: string
  hotspots: ImageHotspot[]
  /** Autor, licencia y procedencia. */
  credit?: string
}

export interface StepItem { title?: string; md: string }
export interface StepsBlock { title?: string; steps: StepItem[] }

export interface CompareRow { label?: string; left: string; right: string }
export interface CompareBlock { title?: string; leftTitle: string; rightTitle: string; rows: CompareRow[] }

export interface FormulasBlock { title?: string; items: FormulaItem[] }

export interface PredictOption { md: string; correct: boolean; why?: string }
/** Pregunta rápida antes de explicar («¿qué crees que pasa?»). */
export interface PredictBlock { question: string; options: PredictOption[]; explanation?: string }

/** «Encuentra el error»: líneas de un desarrollo; una tiene el fallo. */
export interface SpotBlock { intro: string; lines: string[]; wrongIndex: number; explanation: string }

/** Ejercicios dentro de la lección. Referencia ejercicios del curso por id o los trae incrustados. */
export interface TryItBlock { title?: string; exerciseIDs: ItemID[]; inline: Exercise[] }

export interface RecapBlock { title?: string; points: string[] }
export interface CodeBlock { language?: string; code: string; caption?: string; output?: string }
export interface QuoteBlock { md: string; source?: SourceRef; author?: string }

/** Tipo no reconocido (de una versión futura o con un fallo): se conserva el JSON para no perder datos. */
export interface UnknownBlock {
  /** Tipo con el que se leyó (canónico: minúsculas, sin «_», «-» ni espacios). */
  rawType: string
  /** El resto del objeto (sin `id` ni `type`); null si se cortó por anidamiento. */
  raw: JSONObject | null
}

/** Tipo que recibe un bloque cortado por estar anidado a demasiada profundidad. */
export const TOO_DEEP_TYPE = 'demasiado-anidado'

export type BlockBody =
  | ({ type: 'text' } & TextBlock)
  | ({ type: 'math' } & MathBlock)
  | ({ type: 'callout' } & CalloutBlock)
  | ({ type: 'example' } & ExampleBlock)
  | ({ type: 'plot' } & PlotSpec)
  | ({ type: 'explore' } & ExploreBlock)
  | ({ type: 'table' } & TableBlock)
  | ({ type: 'chart' } & ChartBlock)
  | ({ type: 'numberline' } & NumberLineBlock)
  | ({ type: 'diagram' } & DiagramBlock)
  | ({ type: 'drawing' } & DrawingBlock)
  | ({ type: 'timeline' } & TimelineBlock)
  | ({ type: 'image' } & ImageBlock)
  | ({ type: 'steps' } & StepsBlock)
  | ({ type: 'compare' } & CompareBlock)
  | ({ type: 'formulas' } & FormulasBlock)
  | ({ type: 'predict' } & PredictBlock)
  | ({ type: 'spot' } & SpotBlock)
  | ({ type: 'tryit' } & TryItBlock)
  | ({ type: 'recap' } & RecapBlock)
  | ({ type: 'code' } & CodeBlock)
  | ({ type: 'quote' } & QuoteBlock)
  | ({ type: 'labeled' } & LabeledBlock)
  | ({ type: 'model3d' } & Model3DBlock)
  | ({ type: 'simulation' } & SimulationBlock)
  | ({ type: 'map' } & MapBlock)
  | ({ type: 'unknown' } & UnknownBlock)

export type BlockType = BlockBody['type']
export type Block = { id: string } & BlockBody
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>

/** Nombres canónicos de tipo (los que usa el JSON y los que ve la IA). */
export const BLOCK_TYPES = ['text', 'math', 'callout', 'example', 'plot', 'explore', 'table', 'chart', 'numberline', 'diagram', 'drawing',
  'timeline', 'image', 'steps', 'compare', 'formulas', 'predict', 'spot', 'tryit', 'recap', 'code', 'quote',
  'labeled', 'model3d', 'simulation', 'map'] as const

/** Nombre del tipo como se guarda (el original en los desconocidos). */
export const blockTypeName = (b: Block): string => (b.type === 'unknown' ? b.rawType : b.type)

/** Tipo canónico a partir de lo que escriba la IA («paragraph», «worked_example», «bar-chart»…). */
export function canonicalBlockType(raw: string): string {
  const t = raw.toLowerCase().replace(/[_\- ]/g, '')
  switch (t) {
    case 'paragraph': case 'markdown': case 'md': case 'p': case 'prose': return 'text'
    case 'equation': case 'formula': case 'latex': case 'displaymath': case 'eq': return 'math'
    case 'note': case 'tip': case 'warning': case 'definition': case 'theorem': case 'remember': case 'examtip': case 'mistake': case 'question': case 'info': case 'important': return 'callout'
    case 'workedexample': case 'solvedexample': case 'worked': return 'example'
    case 'graph': case 'functionplot': case 'plot2d': case 'figure2d': return 'plot'
    case 'interactive': case 'slider': case 'sliders': case 'interactiveplot': return 'explore'
    case 'numberline': case 'line': case 'numline': return 'numberline'
    case 'flow': case 'flowchart': case 'conceptmap': case 'mindmap': case 'graphdiagram': case 'tree': case 'cycle': return 'diagram'
    case 'svg': case 'figure': case 'canvas': case 'sketch': case 'illustration': return 'drawing'
    case 'try': case 'tryit': case 'practice': case 'exercise': case 'exercises': case 'checkpoint': return 'tryit'
    case 'summary': case 'keypoints': case 'recap': case 'takeaways': return 'recap'
    case 'chartdata': case 'barchart': case 'linechart': case 'piechart': case 'histogram': case 'scatter': return 'chart'
    case 'formulalist': case 'formulas': case 'formulasheet': case 'cheatsheet': return 'formulas'
    case 'spotthemistake': case 'spotmistake': case 'findtheerror': case 'errorhunt': case 'spot': return 'spot'
    case 'predict': case 'prediction': case 'think': case 'quickquestion': case 'mcq': return 'predict'
    case 'steps': case 'procedure': case 'process': case 'stepbystep': return 'steps'
    case 'compare': case 'comparison': case 'versus': case 'vs': case 'twocolumns': return 'compare'
    case 'code': case 'codeblock': case 'snippet': return 'code'
    case 'quote': case 'excerpt': case 'source': case 'citation': return 'quote'
    case 'image': case 'picture': case 'photo': case 'img': return 'image'
    case 'table': case 'grid': return 'table'
    case 'timeline': case 'chronology': return 'timeline'
    case 'diagram': return 'diagram'
    case 'drawing': return 'drawing'
    case 'callout': return 'callout'
    case 'example': return 'example'
    case 'text': return 'text'
    case 'math': return 'math'
    case 'chart': return 'chart'
    case 'labeled': case 'labelled': case 'labeleddiagram': case 'labelleddiagram': case 'labeledimage': case 'labelledimage': case 'interactivediagram':
    case 'interactiveimage': case 'hotspotimage': case 'anatomy': case 'atlas': return 'labeled'
    case 'model3d': case '3d': case '3dmodel': case 'model3': case 'molecule': case 'molecule3d': case 'molecular': case 'viewer3d': case 'scene3d':
    case 'solid': case 'solid3d': case 'geometry3d': return 'model3d'
    case 'simulation': case 'sim': case 'simulate': case 'simulator': case 'manipulable': case 'physicssim': return 'simulation'
    case 'map': case 'geomap': case 'worldmap': case 'mapa': return 'map'
    default: return t
  }
}

/** Lectura tolerante del tipo de aviso («exam_tip» → «examTip»). */
export function parseCalloutKind(s: string): CalloutKind | undefined {
  const t = s.toLowerCase().replace(/[_-]/g, '')
  if (t === 'examtip') return 'examTip'
  return (CALLOUT_KINDS as readonly string[]).includes(t) ? (t as CalloutKind) : undefined
}

// MARK: Leer

const mdOf = (c: Obj): string => flexStr(c, 'md') ?? flexStr(c, 'text') ?? ''

function decodeExampleStep(raw: unknown): ExampleStep | undefined {
  if (typeof raw === 'string') return { md: raw }
  if (!isObj(raw)) return undefined
  return prune({ md: mdOf(raw), note: str(raw, 'note') })
}

function decodeChartPoint(raw: unknown): ChartPoint | undefined {
  if (!isObj(raw)) return undefined
  return prune({ label: flexStr(raw, 'label'), x: num(raw, 'x'), y: num(raw, 'y') ?? 0 })
}
function decodeChartSeries(raw: unknown, d: number): ChartSeries | undefined {
  if (!isObj(raw)) return undefined
  return prune({ name: flexStr(raw, 'name') ?? '', color: str(raw, 'color'), points: list(raw, 'points', decodeChartPoint, d) })
}
function chartKind(c: Obj): ChartKind {
  const s = str(c, 'kind')?.toLowerCase()
  if (s === undefined) return 'bar'
  return (CHART_KINDS as readonly string[]).includes(s) ? (s as ChartKind) : s === 'donut' ? 'pie' : 'bar'
}

function decodeNumberLinePoint(raw: unknown): NumberLinePoint | undefined {
  if (!isObj(raw)) return undefined
  return prune({ value: flexStr(raw, 'value') ?? '0', label: str(raw, 'label'), open: bool(raw, 'open') ?? false, color: str(raw, 'color') ?? 'accent' })
}
function decodeNumberLineInterval(raw: unknown): NumberLineInterval | undefined {
  if (!isObj(raw)) return undefined
  return prune({
    from: flexStr(raw, 'from'), to: flexStr(raw, 'to'), fromOpen: bool(raw, 'fromOpen') ?? false, toOpen: bool(raw, 'toOpen') ?? false,
    label: str(raw, 'label'), color: str(raw, 'color') ?? 'accent'
  })
}

const lowerEnum = <T extends string>(c: Obj, k: string, values: readonly T[], def: T): T => {
  const s = str(c, k)?.toLowerCase()
  return s !== undefined && (values as readonly string[]).includes(s) ? (s as T) : def
}

function decodeDiagramNode(raw: unknown): DiagramNode | undefined {
  if (!isObj(raw)) return undefined
  const id = flexStr(raw, 'id') ?? IDs.short(4)
  return prune({ id, label: flexStr(raw, 'label') ?? id, shape: lowerEnum(raw, 'shape', DIAGRAM_SHAPES, 'box'), color: str(raw, 'color'), detail: str(raw, 'detail') })
}
function decodeDiagramEdge(raw: unknown): DiagramEdge | undefined {
  if (!isObj(raw)) return undefined
  return prune({ from: flexStr(raw, 'from') ?? '', to: flexStr(raw, 'to') ?? '', label: str(raw, 'label'), dashed: bool(raw, 'dashed') ?? false, arrow: bool(raw, 'arrow') ?? true })
}
function decodeDiagramStep(raw: unknown, d: number): DiagramStep | undefined {
  if (typeof raw === 'string') return { md: raw, nodes: [], edges: [] }
  if (!isObj(raw)) return undefined
  const nodes = strings(raw, 'nodes')
  const one = flexStr(raw, 'node')
  if (one !== undefined) nodes.unshift(one)
  return prune({ title: str(raw, 'title'), md: mdOf(raw), nodes, edges: list(raw, 'edges', flexRow, d).filter((e) => e.length === 2) })
}

function decodeTimelineEvent(raw: unknown): TimelineEvent | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    when: flexStr(c, 'when') ?? flexStr(c, 'date') ?? flexStr(c, 'year') ?? '', title: flexStr(c, 'title') ?? flexStr(c, 'name') ?? '',
    md: str(c, 'md') ?? str(c, 'detail'), end: flexStr(c, 'end'), category: flexStr(c, 'category'), asset: str(c, 'asset'), color: str(c, 'color')
  })
}
function decodeTimelinePeriod(raw: unknown): TimelinePeriod | undefined {
  if (!isObj(raw)) return undefined
  const c = raw
  return prune({
    from: flexStr(c, 'from') ?? flexStr(c, 'start') ?? '', to: flexStr(c, 'to') ?? flexStr(c, 'end') ?? '',
    title: flexStr(c, 'title') ?? flexStr(c, 'name') ?? '', color: str(c, 'color')
  })
}

function decodeImageHotspot(raw: unknown): ImageHotspot | undefined {
  if (!isObj(raw)) return undefined
  return { x: num(raw, 'x') ?? 0.5, y: num(raw, 'y') ?? 0.5, label: flexStr(raw, 'label') ?? '' }
}

function decodeStepItem(raw: unknown): StepItem | undefined {
  if (typeof raw === 'string') return { md: raw }
  if (!isObj(raw)) return undefined
  return prune({ title: str(raw, 'title'), md: mdOf(raw) })
}

function decodeCompareRow(raw: unknown): CompareRow | undefined {
  if (!isObj(raw)) return undefined
  return prune({ label: str(raw, 'label'), left: flexStr(raw, 'left') ?? '', right: flexStr(raw, 'right') ?? '' })
}

function decodePredictOption(raw: unknown): PredictOption | undefined {
  if (!isObj(raw)) return undefined
  return prune({ md: mdOf(raw), correct: bool(raw, 'correct') ?? false, why: str(raw, 'why') })
}

function decodeTryIt(c: Obj, d: number): TryItBlock {
  // ids repetidos («e1», «e1») o un ejercicio incrustado con el id de otro: la interfaz los identifica por id
  const seen = new Set<string>()
  const exerciseIDs = strings(c, 'exerciseIDs').filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
  const inline = uniquifyIDs(list(c, 'inline', decodeExercise, d), seen)
  return prune({ title: str(c, 'title'), exerciseIDs, inline })
}

/** El cuerpo de un bloque por su tipo (ya canónico); undefined si el tipo no se conoce. */
function decodeBody(type: string, rawType: string, c: Obj, d: number): BlockBody | undefined {
  switch (type) {
    case 'text': return { type, md: mdOf(c) }
    case 'math': return prune({ type, tex: flexStr(c, 'tex') ?? flexStr(c, 'latex') ?? '', label: str(c, 'label'), note: str(c, 'note') })
    case 'callout': {
      const kindRaw = str(c, 'kind')
      let kind: CalloutKind = kindRaw === undefined ? 'note' : parseCalloutKind(kindRaw) ?? 'note'
      // «"type": "warning"» es un aviso de ese tipo
      const r = rawType.toLowerCase().replace(/[_-]/g, '')
      if (['note', 'tip', 'warning', 'definition', 'theorem', 'remember', 'examtip', 'mistake', 'question'].includes(r)) kind = parseCalloutKind(rawType) ?? kind
      return prune({ type, kind, title: str(c, 'title'), md: mdOf(c) })
    }
    case 'example': return prune({ type, title: str(c, 'title'), problem: flexStr(c, 'problem') ?? '', steps: list(c, 'steps', decodeExampleStep, d), answer: flexStr(c, 'answer') })
    case 'plot': return { type, ...decodePlotSpec(c, d)! }
    case 'explore':
      return prune({ type, title: str(c, 'title'), plot: nested(c, 'plot', decodePlotSpec, d) ?? makePlotSpec(), params: list(c, 'params', decodeExploreParam, d), prompts: strings(c, 'prompts') })
    case 'table':
      return prune({
        type, headers: strings(c, 'headers'), rows: list(c, 'rows', flexRow, d), align: strings(c, 'align'), caption: str(c, 'caption'),
        highlightRows: list(c, 'highlightRows', (v) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined), d),
        firstColumnIsHeader: bool(c, 'firstColumnIsHeader') ?? false
      })
    case 'chart':
      return prune({
        type, kind: chartKind(c), title: str(c, 'title'), xLabel: str(c, 'xLabel'), yLabel: str(c, 'yLabel'), series: list(c, 'series', decodeChartSeries, d),
        stacked: bool(c, 'stacked') ?? false, unit: str(c, 'unit'), caption: str(c, 'caption'), showValues: bool(c, 'showValues') ?? true
      })
    case 'numberline':
      return prune({
        type, min: num(c, 'min') ?? -5, max: num(c, 'max') ?? 5, step: num(c, 'step'), pi: bool(c, 'pi') ?? false,
        points: list(c, 'points', decodeNumberLinePoint, d), intervals: list(c, 'intervals', decodeNumberLineInterval, d), caption: str(c, 'caption')
      })
    case 'diagram':
      return prune({
        type, kind: lowerEnum(c, 'kind', DIAGRAM_KINDS, 'flow'), title: str(c, 'title'), direction: str(c, 'direction') ?? 'tb',
        nodes: list(c, 'nodes', decodeDiagramNode, d), edges: list(c, 'edges', decodeDiagramEdge, d), caption: str(c, 'caption'),
        steps: list(c, 'steps', decodeDiagramStep, d).slice(0, 60)
      })
    case 'drawing': return { type, ...decodeDrawing(c, d)! }
    case 'timeline':
      return prune({
        type, title: str(c, 'title'), events: list(c, 'events', decodeTimelineEvent, d), periods: list(c, 'periods', decodeTimelinePeriod, d).slice(0, 40),
        layout: str(c, 'layout')?.toLowerCase() ?? 'auto', caption: str(c, 'caption')
      })
    case 'image':
      return prune({
        type, asset: str(c, 'asset'), source: nested(c, 'source', decodeSourceRef, d), alt: flexStr(c, 'alt') ?? '', caption: str(c, 'caption'),
        hotspots: list(c, 'hotspots', decodeImageHotspot, d), credit: str(c, 'credit')
      })
    case 'steps': return prune({ type, title: str(c, 'title'), steps: list(c, 'steps', decodeStepItem, d) })
    case 'compare':
      return prune({ type, title: str(c, 'title'), leftTitle: flexStr(c, 'leftTitle') ?? 'A', rightTitle: flexStr(c, 'rightTitle') ?? 'B', rows: list(c, 'rows', decodeCompareRow, d) })
    case 'formulas': return prune({ type, title: str(c, 'title'), items: list(c, 'items', decodeFormulaItem, d) })
    case 'predict': return prune({ type, question: flexStr(c, 'question') ?? '', options: list(c, 'options', decodePredictOption, d), explanation: str(c, 'explanation') })
    case 'spot':
      return { type, intro: flexStr(c, 'intro') ?? '', lines: strings(c, 'lines'), wrongIndex: int(c, 'wrongIndex') ?? 0, explanation: flexStr(c, 'explanation') ?? '' }
    case 'tryit': return { type, ...decodeTryIt(c, d) }
    case 'recap': return prune({ type, title: str(c, 'title'), points: strings(c, 'points') })
    case 'code': return prune({ type, language: str(c, 'language'), code: flexStr(c, 'code') ?? '', caption: str(c, 'caption'), output: str(c, 'output') })
    case 'quote': return prune({ type, md: mdOf(c), source: nested(c, 'source', decodeSourceRef, d), author: str(c, 'author') })
    case 'labeled': return { type, ...decodeLabeled(c, d)! }
    case 'model3d': return { type, ...decodeModel3D(c, d)! }
    case 'simulation': return { type, ...decodeSimulation(c, d)! }
    case 'map': return { type, ...decodeMap(c, d)! }
    default: return undefined
  }
}

/**
 * Lee un bloque (como `Block.init(from:)`): tipo canónico, campos tolerantes y, si el tipo no se conoce, el JSON tal cual.
 * undefined si no es un objeto. `d` es su profundidad (claves e índices desde la raíz del archivo).
 */
export function decodeBlock(raw: unknown, d = 0, index?: number): Block | undefined {
  if (!isObj(raw)) return undefined
  // sin id, uno estable: el id de un bloque es el del concepto guiado y el de sus respuestas guardadas
  const id = vStr(raw.id) ?? fallbackID(raw, index)
  // anidamiento absurdo (tryit → ejercicio → tryit → …): se corta aquí en vez de desbordar la pila
  if (tooDeep(d)) return { id, type: 'unknown', rawType: TOO_DEEP_TYPE, raw: null }
  const rawType = vStr(raw.type) ?? 'text'
  const type = canonicalBlockType(rawType)
  const body = decodeBody(type, rawType, raw, d)
  if (body) return { id, ...body } as Block
  // tipo desconocido: conservar el JSON tal cual (con la profundidad acotada) para no perder datos
  const all = bounded(raw, d)
  const rest: JSONObject = {}
  if (isObj(all)) for (const [k, v] of Object.entries(all as JSONObject)) if (k !== 'id' && k !== 'type') rest[k] = v
  return { id, type: 'unknown', rawType: type, raw: rest }
}

/**
 * Bloques de contenido: acepta un arreglo de bloques o una cadena Markdown (un bloque de texto). Un elemento ilegible se
 * salta; una cadena suelta dentro del arreglo es un bloque de texto.
 */
export function decodeBlocks(v: unknown, d: number): Block[] {
  if (Array.isArray(v)) {
    const out: Block[] = []
    v.forEach((x, i) => {
      const b = decodeBlock(x, d + 1, i)
      if (b) out.push(b)
      else if (typeof x === 'string' && x !== '') out.push(textBlock(x, fallbackID(x, i)))
    })
    return out
  }
  if (typeof v === 'string' && v !== '') return [textBlock(v, fallbackID(v, 0))]
  return []
}

/** Campo de bloques de un objeto (`c.blocks(.k)`). */
export function blocksField(o: Obj, k: string, d: number): Block[] {
  return decodeBlocks(o[k], d + 1)
}

export function textBlock(md: string, id: string = IDs.short(6)): Block {
  return { id, type: 'text', md }
}

/** Crea un bloque con id nuevo. */
export function makeBlock<B extends BlockBody>(body: B, id: string = IDs.short(6)): { id: string } & B {
  return { id, ...body }
}

// MARK: Escribir

const encodeExampleStep = (v: ExampleStep): JSONObject => pickKeys(v, ['md', 'note'])

function encodeDiagramStep(v: DiagramStep): JSONObject {
  const out = pickKeys(v, ['title', 'md'])
  if (v.nodes.length) out.nodes = [...v.nodes]
  if (v.edges.length) out.edges = v.edges.map((e) => [...e])
  return out
}

/** El cuerpo del bloque como lo escribe Swift (sin `id` ni `type`). */
function encodeBody(b: BlockBody): JSONObject {
  switch (b.type) {
    case 'text': return { md: b.md }
    case 'math': return pickKeys(b, ['tex', 'label', 'note'])
    case 'callout': return pickKeys(b, ['kind', 'title', 'md'])
    case 'example': {
      const out = pickKeys(b, ['title', 'problem', 'answer'])
      out.steps = b.steps.map(encodeExampleStep)
      return out
    }
    case 'plot': return encodePlotSpec(b)
    case 'explore': {
      const out = pickKeys(b, ['title', 'prompts'])
      out.plot = encodePlotSpec(b.plot)
      out.params = b.params.map(encodeExploreParam)
      return out
    }
    case 'table': return pickKeys(b, ['headers', 'rows', 'align', 'caption', 'highlightRows', 'firstColumnIsHeader'])
    case 'chart': {
      const out = pickKeys(b, ['kind', 'title', 'xLabel', 'yLabel', 'stacked', 'unit', 'caption', 'showValues'])
      out.series = b.series.map((s) => {
        const o = pickKeys(s, ['name', 'color'])
        o.points = s.points.map((p) => pickKeys(p, ['label', 'x', 'y']))
        return o
      })
      return out
    }
    case 'numberline': {
      const out = pickKeys(b, ['min', 'max', 'step', 'pi', 'caption'])
      out.points = b.points.map((p) => pickKeys(p, ['value', 'label', 'open', 'color']))
      out.intervals = b.intervals.map((p) => pickKeys(p, ['from', 'to', 'fromOpen', 'toOpen', 'label', 'color']))
      return out
    }
    case 'diagram': {
      const out = pickKeys(b, ['kind', 'title', 'direction'])
      out.nodes = b.nodes.map((n) => pickKeys(n, ['id', 'label', 'shape', 'color', 'detail']))
      out.edges = b.edges.map((e) => pickKeys(e, ['from', 'to', 'label', 'dashed', 'arrow']))
      put(out, 'caption', b.caption)
      if (b.steps.length) out.steps = b.steps.map(encodeDiagramStep)
      return out
    }
    case 'drawing': return encodeDrawing(b)
    case 'timeline': {
      const out = pickKeys(b, ['title'])
      out.events = b.events.map((e) => pickKeys(e, ['when', 'title', 'md', 'end', 'category', 'asset', 'color']))
      if (b.periods.length) out.periods = b.periods.map((p) => pickKeys(p, ['from', 'to', 'title', 'color']))
      if (b.layout !== 'auto') out.layout = b.layout
      put(out, 'caption', b.caption)
      return out
    }
    case 'image': {
      const out = pickKeys(b, ['asset', 'alt', 'caption', 'credit'])
      if (b.source) out.source = encodeSourceRef(b.source)
      out.hotspots = b.hotspots.map((h) => pickKeys(h, ['x', 'y', 'label']))
      return out
    }
    case 'steps': {
      const out = pickKeys(b, ['title'])
      out.steps = b.steps.map((s) => pickKeys(s, ['title', 'md']))
      return out
    }
    case 'compare': {
      const out = pickKeys(b, ['title', 'leftTitle', 'rightTitle'])
      out.rows = b.rows.map((r) => pickKeys(r, ['label', 'left', 'right']))
      return out
    }
    case 'formulas': {
      const out = pickKeys(b, ['title'])
      out.items = b.items.map(encodeFormulaItem)
      return out
    }
    case 'predict': {
      const out = pickKeys(b, ['question', 'explanation'])
      out.options = b.options.map((o) => pickKeys(o, ['md', 'correct', 'why']))
      return out
    }
    case 'spot': return pickKeys(b, ['intro', 'lines', 'wrongIndex', 'explanation'])
    case 'tryit': {
      const out = pickKeys(b, ['title', 'exerciseIDs'])
      out.inline = b.inline.map(encodeExercise)
      return out
    }
    case 'recap': return pickKeys(b, ['title', 'points'])
    case 'code': return pickKeys(b, ['language', 'code', 'caption', 'output'])
    case 'quote': {
      const out = pickKeys(b, ['md', 'author'])
      if (b.source) out.source = encodeSourceRef(b.source)
      return out
    }
    case 'labeled': return encodeLabeled(b)
    case 'model3d': return encodeModel3D(b)
    case 'simulation': return encodeSimulation(b)
    case 'map': return encodeMap(b)
    case 'unknown': return b.raw ? { ...b.raw } : {}
  }
}

/** El bloque como objeto JSON plano: {"id", "type", ...campos}. */
export function encodeBlock(b: Block): JSONObject {
  const body = encodeBody(b)
  const out: JSONObject = { ...body }
  out.id = b.id
  out.type = blockTypeName(b)
  return out
}

export const encodeBlocks = (blocks: Block[]): JSONValue[] => blocks.map(encodeBlock)

/** Aplica `change` a cada «Pruébalo» de una lista de bloques (los cambia en su sitio). */
export function updateTryIts(blocks: Block[], change: (t: BlockOf<'tryit'>) => void): void {
  for (const b of blocks) if (b.type === 'tryit') change(b)
}
