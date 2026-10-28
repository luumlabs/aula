// Ejecuta las llamadas a herramientas de un paso del agente: en paralelo (con un máximo) y con los resultados en el orden de las
// llamadas (port de ToolExecutor.swift). Un fallo (excepción, nombre desconocido, argumentos ilegibles) nunca aborta el agente:
// se convierte en un resultado de error que el modelo puede leer y corregir.
import type { AgentEvent, ImagePart, ToolCall } from '@shared/ai/types'
import type { JSONObject } from '@shared/ai/json'
import { isJSONObject } from '@shared/ai/json'
import { tr } from '@shared/ai/i18n'
import { canonicalJSON } from '../core/json'
import type { AgentTool, ToolOutput } from '../model'
import type { ResultItem } from './contextManager'
import { recoverArguments } from './textToolProtocol'

/** Una sola línea, recortada a `limit` caracteres. */
export function oneLine(s: string, limit: number): string {
  const collapsed = s.replace(/\s+/g, ' ')
  const chars = Array.from(collapsed)
  return chars.length <= limit ? collapsed : chars.slice(0, limit).join('') + '…'
}

/** «nombre {primeros 80 caracteres de los argumentos}». */
export function startedSummary(call: ToolCall): string {
  return `${call.name} ${oneLine(canonicalJSON(call.arguments), 80)}`
}

/** Primeras líneas del resultado (máx. 3 líneas y 200 caracteres). */
export function resultSummary(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l)
  if (!lines.length) return '(sin salida)'
  const cut = oneLine(lines.slice(0, 3).join(' ⏎ '), 200)
  return lines.length > 3 && !cut.endsWith('…') ? cut + ' …' : cut
}

export interface ToolExecutorOptions {
  maxParallel?: number
  maxResultCharacters?: number
  supportsVision?: boolean
}

export class ToolExecutor {
  readonly tools: Map<string, AgentTool>
  private readonly maxParallel: number
  private readonly maxResultCharacters: number
  private readonly supportsVision: boolean

  constructor(tools: Map<string, AgentTool>, opts: ToolExecutorOptions = {}) {
    this.tools = tools
    this.maxParallel = Math.max(1, opts.maxParallel ?? 4)
    this.maxResultCharacters = opts.maxResultCharacters ?? 100_000
    this.supportsVision = opts.supportsVision ?? false
  }

  /** Por nombre exacto o tolerando vicios de los modelos: espacios, `functions.`/`default_api.` y mayúsculas (si no hay ambigüedad). */
  resolve(rawName: string): AgentTool | undefined {
    const exact = this.tools.get(rawName)
    if (exact) return exact
    let name = rawName.trim().replace(/^[`"']+|[`"']+$/g, '')
    for (const prefix of ['functions.', 'functions/', 'function.', 'default_api.', 'tools.', 'tool.']) {
      if (name.toLowerCase().startsWith(prefix)) {
        name = name.slice(prefix.length)
        break
      }
    }
    const t = this.tools.get(name)
    if (t) return t
    const matches = [...this.tools.entries()].filter(([k]) => k.toLowerCase() === name.toLowerCase())
    return matches.length === 1 ? matches[0][1] : undefined
  }

  get availableNames(): string[] {
    return [...this.tools.keys()].sort()
  }

  /**
   * Ejecuta `calls`. `truncatedIndex` marca una llamada cuyos argumentos quedaron cortados por el límite de longitud (no se
   * ejecuta). Si `signal` se aborta, no empieza ninguna más y devuelve enseguida (las que sigan en marcha ven el aborto).
   */
  async run(calls: ToolCall[], signal: AbortSignal, emit: (e: AgentEvent) => void, truncatedIndex?: number): Promise<ResultItem[]> {
    const results: (ResultItem | undefined)[] = new Array(calls.length).fill(undefined)
    let next = 0
    const worker = async () => {
      while (next < calls.length && !signal.aborted) {
        const i = next++
        results[i] = await this.runOne(calls[i], i === truncatedIndex, signal, emit)
      }
    }
    const workers = Array.from({ length: Math.min(this.maxParallel, calls.length) }, () => worker())
    if (signal.aborted) {
      // nada que esperar
    } else {
      await new Promise<void>((resolve) => {
        const onAbort = () => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
        Promise.all(workers).then(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, () => resolve())
      })
    }
    return calls.map((c, i) => results[i] ?? {
      callID: c.id,
      name: c.name,
      text: signal.aborted ? 'Error: la llamada fue cancelada antes de ejecutarse.' : 'Error: la llamada no llegó a ejecutarse.',
      images: [],
      ok: false
    })
  }

  private async runOne(original: ToolCall, truncated: boolean, signal: AbortSignal, emit: (e: AgentEvent) => void): Promise<ResultItem> {
    const call = recoverArguments(original) // segundo intento con los argumentos que no se pudieron leer
    emit({ type: 'toolStarted', id: call.id, name: call.name, summary: startedSummary(call) })
    let text: string // para la IA (resultado de la herramienta): no se traduce
    let shown: string | undefined // para la persona (resumen de `toolFinished`) cuando el error lo redacta este ejecutor
    let images: ImagePart[] = []
    let ok = true
    let name = call.name
    const args = call.arguments
    if (truncated) {
      text = `Error: tu respuesta se cortó por el límite de longitud en mitad de esta llamada a «${call.name}», así que no se ejecutó. Vuelve a enviarla dividiendo el contenido en partes más pequeñas (varias llamadas) o con menos texto.`
      shown = tr(`tu respuesta se cortó por el límite de longitud en mitad de esta llamada a «${call.name}», así que no se ejecutó.`,
        `your response was cut off by the length limit partway through this call to “${call.name}”, so it wasn't executed.`)
      ok = false
    } else if (isJSONObject(args) && Object.keys(args).length === 1 && typeof args._unparsed === 'string') {
      const raw = args._unparsed
      const chars = Array.from(raw)
      const head = chars.length > 300 ? chars.slice(0, 300).join('') + '…' : raw
      text = `Error: no pude interpretar los argumentos de la llamada a «${call.name}» como JSON válido. Reenvía la llamada con JSON válido, con las barras invertidas de LaTeX duplicadas (\\\\frac, \\\\sqrt, \\\\theta) y los saltos de línea escritos como \\n. Recibí: ${head}`
      shown = tr(`no pude interpretar los argumentos de la llamada a «${call.name}» como JSON válido.`,
        `I couldn't parse the arguments of the call to “${call.name}” as valid JSON.`)
      ok = false
    } else {
      const tool = this.resolve(call.name)
      if (tool) {
        name = tool.name
        try {
          if (signal.aborted) throw signal.reason ?? new Error('cancelled')
          const out = await tool.run((isJSONObject(args) ? args : {}) as JSONObject, { signal, callId: call.id })
          const o: ToolOutput = typeof out === 'string' ? { text: out } : (out ?? { text: '' })
          text = typeof o.text === 'string' ? o.text : String(o.text ?? '')
          images = o.images ?? []
          ok = !o.isError
          if (!ok && !text.startsWith('Error')) text = 'Error: ' + text
        } catch (err) {
          if (signal.aborted) {
            text = `Error: la herramienta «${call.name}» fue cancelada.`
            shown = tr(`la herramienta «${call.name}» fue cancelada.`, `the “${call.name}” tool was canceled.`)
          } else {
            const reason = err instanceof Error ? err.message || err.name : String(err)
            text = `Error: la herramienta «${call.name}» falló: ${reason}`
            shown = tr(`la herramienta «${call.name}» falló: ${reason}`, `the “${call.name}” tool failed: ${reason}`)
          }
          ok = false
        }
      } else {
        const names = this.availableNames
        text = `Error: No existe la herramienta ${call.name}. Disponibles: ${names.length ? names.join(', ') : '(ninguna)'}`
        shown = tr(`No existe la herramienta ${call.name}.`, `The ${call.name} tool doesn't exist.`)
        ok = false
      }
    }
    const chars = Array.from(text)
    if (chars.length > this.maxResultCharacters) {
      text = chars.slice(0, this.maxResultCharacters).join('') + `\n[resultado recortado: era demasiado largo (${chars.length} caracteres)]`
    }
    if (images.length && !this.supportsVision) {
      text += `\n[${images.length} imagen(es) omitida(s): el modelo no admite imágenes]`
      images = []
    }
    if (!text.trim()) text = '(sin salida)'
    emit({ type: 'toolFinished', id: call.id, name, ok, summary: resultSummary(shown ?? text) })
    return { callID: call.id, name, text, images, ok }
  }
}
