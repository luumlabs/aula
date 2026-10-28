// Lo que las herramientas de la IA pueden tocar (port de StudyEngine/Tools/ToolContext.swift): el curso, el validador, los
// servicios inyectados (búsqueda, web, calculadora, plataforma de estudio…) y los ayudantes para leer argumentos y construir
// respuestas. Todo se inyecta: así las herramientas se prueban sin red ni IA. Nada de `electron` aquí.
import type { JSONObject, JSONValue } from '@engine/base/json'
import { asBool, asDouble, asInt, asText, compactJSON, isJSONObject, parseJSONValue } from '@engine/base/json'
import { JSONRepair } from '@engine/base/jsonRepair'
import type { ContentValidator } from '@engine/content'
import type { AnswerInput, GradeResult } from '@engine/grading'
import type { GatherPlace } from '@engine/pipeline'
import type { ContentIssue, Exercise, SourceMeta, SourceTrust } from '@shared/schema'
import type { PageRasterizer, SourceHit } from '@shared/ingest'
import type { AgentTool, ToolOutput } from '../ai'
import type { PackStore } from '../store'

// MARK: Servicios que se inyectan

export interface SourceSearching {
  search(query: string, limit: number, sourceIDs?: ReadonlySet<string>): Promise<SourceHit[]>
}

export interface WebResult { title: string; url: string; snippet: string }

/** Una imagen candidata con su licencia y autoría (para citarla en el pie). */
export interface ImageResult {
  title: string
  url: string
  pageURL: string
  width: number
  height: number
  mimeType: string
  license: string
  author: string
  description: string
}

export interface WebAccess {
  search(query: string, limit: number, signal?: AbortSignal): Promise<WebResult[]>
  /** Texto legible de una página pública (HTML o PDF). */
  fetch(url: string, maxChars: number, signal?: AbortSignal): Promise<string>
  /** Descarga binaria (imágenes): datos y tipo MIME. */
  fetchData(url: string, maxBytes: number, signal?: AbortSignal): Promise<{ data: Uint8Array; mimeType: string }>
  /** Imágenes con licencia libre (Wikimedia Commons). */
  searchImages(query: string, limit: number, signal?: AbortSignal): Promise<ImageResult[]>
}

/** Añadir materiales nuevos al curso (una página guardada, un archivo traído de la plataforma). */
export interface SourceImporting {
  importText(text: string, title: string, trust: SourceTrust, opts?: { url?: string; kind?: string; note?: string; signal?: AbortSignal }): Promise<SourceMeta>
  importFile(path: string, trust: SourceTrust, opts?: { title?: string; url?: string; signal?: AbortSignal }): Promise<SourceMeta>
}

/** Una fecha de las plataformas de estudio (calendarios .ics, Canvas). */
export interface CampusEvent {
  title: string
  start: Date
  kind: string
  isExam: boolean
  course?: string
  courseID?: number
  details?: string
}

export interface CanvasOutline {
  courseID: number
  name: string
  syllabus: string
  modules: Array<{ name: string; items: Array<{ title: string; kind: string; page?: string; fileID?: number; url?: string }> }>
  pages: Array<{ title: string; page: string }>
  files: Array<{ id: number; name: string; size?: number }>
  assignments: Array<{ name: string; kind: string; due?: Date; points?: number }>
}

/** Fechas de las plataformas y, si la cuenta es de Canvas, su API (programa, páginas, archivos). */
export interface CampusProviding {
  upcoming(days: number): Promise<CampusEvent[]>
  canvas?: {
    courses(): Promise<Array<{ id: number; name: string; code?: string; term?: string }>>
    outline(courseID: number): Promise<CanvasOutline>
    readPage(courseID: number, page: string): Promise<string>
    /** Descarga un archivo a una carpeta temporal; devuelve su ruta y nombre. */
    downloadFile(courseID: number, fileID: number): Promise<{ path: string; filename: string }>
  }
}

/** Una página abierta en el navegador de Aula. */
export interface BrowserPage {
  url: string
  title: string
  httpStatus?: number
  needsLogin: boolean
  /** Muro anti-robots o CAPTCHA (texto breve). */
  wall?: string
  /** Plataforma reconocida por la dirección (nombre para la IA). */
  platform?: string
}

/** El navegador de plataformas de Aula, visto por las herramientas (lo implementa la capa de Electron). */
export interface PlatformAccess {
  /** Las plataformas de la ejecución (dónde busca «Reunir materiales»). */
  places: GatherPlace[]
  open(url: string, signal?: AbortSignal): Promise<BrowserPage>
  read(offset: number, maxCharacters: number, signal?: AbortSignal): Promise<{ page: BrowserPage; text: string; nextOffset?: number }>
  links(signal?: AbortSignal): Promise<Array<{ text: string; url: string }>>
  /** Pulsa un control por su referencia («e12») de la última lectura. */
  click(target: string, signal?: AbortSignal): Promise<BrowserPage>
  screenshot(signal?: AbortSignal): Promise<{ base64: string; mediaType: string }>
  /** Pide al estudiante que inicie sesión en una ventana visible; true si al final hay sesión. */
  signIn(url: string, reason: string, signal?: AbortSignal): Promise<boolean>
  /** Descarga un archivo con la sesión (a una carpeta temporal). */
  download(url: string, signal?: AbortSignal): Promise<{ path: string; filename: string }>
  /** Toda la página actual como texto limpio. */
  readAll(signal?: AbortSignal): Promise<{ page: BrowserPage; text: string }>
}

/** Calculadora exacta (`LiveCalculator` del motor). */
export interface Calculating {
  calculate(expression: string, degrees: boolean): { text: string; decimal?: number; latex?: string; error?: string }
}

/** Eventos que las herramientas notifican a la tubería (cronología de la generación). */
export type ToolEvent =
  | { kind: 'note'; text: string }
  | { kind: 'planSet'; units: number; skills: number }
  | { kind: 'skillWritten'; skill: string; what: string; count: number }
  | { kind: 'finished'; summary: string }

/** Todo lo que una herramienta puede tocar. Los permisos de escritura se limitan con `assignedSkill`. */
export interface ToolContext {
  store: PackStore
  /** Validador ligado al curso (comprueba de verdad las imágenes y las páginas de los materiales). */
  validator(): ContentValidator
  /** Si existe, solo se pueden modificar los contenidos de esta habilidad. */
  assignedSkill?: string
  search?: SourceSearching
  web?: WebAccess
  calc?: Calculating
  /** Corrector del verificador independiente (por defecto, el del motor). */
  grade?: (exercise: Exercise, input: AnswerInput) => GradeResult
  /** Ejecución en curso (para el registro de verificación y lo que averigua «Reunir materiales»). */
  runID?: string
  notify(e: ToolEvent): void
  /** Pregunta al estudiante (espera la respuesta). undefined = no hay nadie (modo desatendido). */
  askUser?(text: string, options: string[], signal?: AbortSignal): Promise<string>
  campus?: CampusProviding
  importer?: SourceImporting
  browser?: PlatformAccess
  /** Dibuja una página de un PDF para `view_source_page` (lo da la capa de Electron). */
  rasterizer?: PageRasterizer
  /** Ejecuta cada herramienta dentro del contexto de la ejecución (historial de cambios y coste del curso). */
  bind?<T>(fn: () => T): T
  /** Equipo que crea cursos: qué direcciones se pueden abrir (A2-P1-1). Sin ella (el chat lleva su propia puerta), todas. */
  webGate?: WebGate
}

/** La puerta de la web de una ejecución (la implementa `RunWebGate`). */
export interface WebGate {
  noteFound(urls: Iterable<string>): void
  check(url: string): { ok: true } | { ok: false; error: string; hint: string }
}

// MARK: Argumentos

/** Lectura tolerante de los argumentos que manda la IA (port de `ToolArgs`). */
export class ToolArgs {
  readonly v: JSONObject

  constructor(raw: unknown) {
    let v: unknown = raw
    if (typeof raw === 'string') { try { v = JSONRepair.parse(raw) } catch { v = {} } }
    this.v = isJSONObject(v) ? (v as JSONObject) : {}
  }

  private first(keys: string[]): JSONValue | undefined {
    for (const k of keys) { const x = this.v[k]; if (x !== undefined && x !== null) return x }
    return undefined
  }

  string(key: string, alt: string[] = []): string | undefined {
    for (const k of [key, ...alt]) {
      const x = this.v[k]
      if (typeof x === 'string') return x
      if (typeof x === 'number' && Number.isFinite(x)) return asText(x)
    }
    return undefined
  }

  required(key: string, alt: string[] = []): string {
    const s = this.string(key, alt)
    if (!s) throw new ToolFailure(`Missing required argument '${key}'.`)
    return s
  }

  int(key: string, alt: string[] = []): number | undefined {
    for (const k of [key, ...alt]) { const i = asInt(this.v[k]); if (i !== undefined) return i }
    return undefined
  }

  number(key: string, alt: string[] = []): number | undefined {
    for (const k of [key, ...alt]) { const d = asDouble(this.v[k]); if (d !== undefined && Number.isFinite(d)) return d }
    return undefined
  }

  bool(key: string, alt: string[] = []): boolean | undefined {
    for (const k of [key, ...alt]) { const b = asBool(this.v[k]); if (b !== undefined) return b }
    return undefined
  }

  /** Un arreglo (o un objeto suelto, o el arreglo mandado como texto JSON: «"exercises": "[{…}]"»). */
  array(key: string, alt: string[] = []): JSONValue[] | undefined {
    for (const k of [key, ...alt]) {
      const x = this.v[k]
      if (Array.isArray(x)) return x
      if (isJSONObject(x)) return [x]
      if (typeof x === 'string') {
        try {
          const p = JSONRepair.parse(x)
          if (Array.isArray(p)) return p
          if (isJSONObject(p)) return [p]
        } catch { /* no es JSON */ }
      }
    }
    return undefined
  }

  value(key: string, alt: string[] = []): JSONValue | undefined {
    return this.first([key, ...alt])
  }

  strings(key: string): string[] | undefined {
    const x = this.v[key]
    if (Array.isArray(x)) return x.filter((s): s is string => typeof s === 'string')
    return undefined
  }

  /** Por qué no se pudo leer un arreglo (en inglés, para la IA). */
  diagnoseArray(key: string): string {
    const x = this.v[key]
    if (x === undefined || x === null) {
      const keys = Object.keys(this.v).sort().join(', ')
      return 'It was not in your call' + (keys ? ` (you sent: ${keys}).` : '.')
    }
    if (typeof x === 'string') {
      let detail = ''
      try { parseJSONValue(x) } catch (e) { detail = ` Parser: ${Array.from(e instanceof Error ? e.message : String(e)).slice(0, 160).join('')}.` }
      const head = Array.from(x).slice(0, 90).join('').replace(/\n/g, '⏎')
      return `You sent it as a STRING containing text that is not valid JSON${detail} It starts: «${head}». Send a real JSON array (not a string). Inside strings, escape every LaTeX backslash as \\\\ (\\\\frac, \\\\pi) and never put raw line breaks.`
    }
    return `You sent a ${isJSONObject(x) ? 'single object' : 'value of another type'} instead of an array.`
  }
}

/** Argumento que falta o no sirve (el mensaje lo lee la IA). */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolFailure'
  }
}

// MARK: Respuestas

export const ToolOut = {
  json(o: Record<string, unknown>): ToolOutput {
    return { text: compactJSON(o) }
  },
  error(message: string, hint?: string): ToolOutput {
    const o: Record<string, unknown> = { ok: false, error: message }
    if (hint) o.hint = hint
    return { text: compactJSON(o), isError: true }
  },
  /** Los problemas ordenados por gravedad (error, aviso, información), como mucho `limit`. */
  issues(issues: readonly ContentIssue[], limit = 25): Array<{ severity: string; path: string; message: string }> {
    const rank = (s: string): number => (s === 'error' ? 0 : s === 'warning' ? 1 : 2)
    return [...issues].sort((a, b) => rank(a.severity) - rank(b.severity)).slice(0, limit).map((i) => ({ severity: i.severity, path: i.path, message: i.message }))
  },
  clip(s: string, n: number): string {
    const a = Array.from(s)
    return a.length <= n ? s : a.slice(0, n).join('') + '…'
  }
}

/** Crea una herramienta: lee los argumentos con `ToolArgs`, convierte los fallos en un error legible para la IA. */
export function defineTool(
  ctx: Pick<ToolContext, 'bind'>,
  name: string,
  description: string,
  inputSchema: JSONObject,
  handler: (a: ToolArgs, signal: AbortSignal, raw: JSONObject) => Promise<ToolOutput> | ToolOutput
): AgentTool {
  return {
    name,
    description,
    inputSchema,
    run: async (args, tctx) => {
      const exec = async (): Promise<ToolOutput> => {
        try {
          const a = new ToolArgs(args)
          return await handler(a, tctx.signal, a.v)
        } catch (err) {
          if (tctx.signal.aborted) return ToolOut.error('Cancelled.')
          return ToolOut.error(err instanceof Error ? err.message : String(err))
        }
      }
      return ctx.bind ? ctx.bind(exec) : exec()
    }
  }
}
