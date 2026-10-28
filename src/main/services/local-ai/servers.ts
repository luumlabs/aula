// Servidores de modelos que ya hay en este ordenador: Ollama (11434), LM Studio (1234) y un `llama-server` propio (8080/9931),
// con sus modelos y capacidades; el cliente de la API nativa de Ollama; y las apps instaladas aunque no estén abiertas
// (port de `LocalAIKit/Engines/{LocalServers,OllamaClient}.swift`, ampliado a Windows y Linux). Nunca lanza al detectar.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InstalledLocalApp, LocalEngineKind, LocalServerModel, LocalServerReport } from '@shared/agents'
import { LoopbackError, LoopbackHTTP } from './loopback'

export const ENGINE_DEFAULT_PORTS: Record<LocalEngineKind, number> = { aula: 39281, ollama: 11434, lmstudio: 1234, llamacpp: 8080 }

export type ServerOrigins = Partial<Record<Exclude<LocalEngineKind, 'aula'>, string>>

export const DEFAULT_ORIGINS: ServerOrigins = {
  ollama: `http://127.0.0.1:${ENGINE_DEFAULT_PORTS.ollama}`,
  lmstudio: `http://127.0.0.1:${ENGINE_DEFAULT_PORTS.lmstudio}`,
  llamacpp: `http://127.0.0.1:${ENGINE_DEFAULT_PORTS.llamacpp}`
}

/** Otros puertos donde mirar si en el principal no hay nadie (el `llama-server` reciente usa el 9931 por defecto). */
export const ALTERNATE_ORIGINS: ServerOrigins = { llamacpp: 'http://127.0.0.1:9931' }

const MAX_MODELS = 64
const MAX_DETAILS = 24

type J = Record<string, unknown>

function isObj(v: unknown): v is J {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function at(v: unknown, ...keys: string[]): unknown {
  let cur = v
  for (const k of keys) {
    if (!isObj(cur)) return undefined
    cur = cur[k]
  }
  return cur
}
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function text(v: unknown, limit = 200): string | undefined {
  return typeof v === 'string' && v ? v.slice(0, limit) : undefined
}
function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined
}
function flag(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/** Tamaño en bytes: solo enteros no negativos que JSON representa exactamente (port de `ModelByteCount`). */
export function parseByteCount(value: unknown, allowZero = false): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
  return allowZero || value > 0 ? value : undefined
}

// MARK: Detección

/** Busca Ollama, LM Studio y llama.cpp en sus puertos y lee sus modelos. Nunca lanza; ordenado por tipo. */
export async function detectLocalServers(origins: ServerOrigins = DEFAULT_ORIGINS, alternates: ServerOrigins = ALTERNATE_ORIGINS): Promise<LocalServerReport[]> {
  const kinds = Object.keys(origins) as (keyof ServerOrigins)[]
  const found = await Promise.all(
    kinds.map(async (kind) => {
      for (const candidate of [origins[kind], alternates[kind]]) {
        if (!candidate) continue
        const http = LoopbackHTTP.create(candidate, 1500)
        if (!http) continue
        try {
          const report = kind === 'ollama' ? await readOllama(http) : kind === 'lmstudio' ? await readLMStudio(http) : await readLlamaCpp(http)
          if (report) return report
        } catch {
          /* ese puerto no es lo que buscamos */
        }
      }
      return undefined
    })
  )
  return found.filter((r): r is LocalServerReport => !!r).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
}

async function tryJSON(http: LoopbackHTTP, path: string, opts: Parameters<LoopbackHTTP['json']>[1] = {}): Promise<unknown> {
  try {
    return await http.json(path, opts)
  } catch {
    return undefined
  }
}

async function readOllama(http: LoopbackHTTP): Promise<LocalServerReport | undefined> {
  const tags = await tryJSON(http, '/api/tags')
  const models = at(tags, 'models')
  if (!Array.isArray(models)) return undefined
  const client = new OllamaClient(http)
  const running = await tryJSON(http, '/api/ps')
  const loaded = new Map<string, J>()
  for (const m of list(at(running, 'models'))) {
    const name = text(at(m, 'model')) ?? text(at(m, 'name'))
    if (name && isObj(m)) loaded.set(name, m)
  }
  const version = text(at(await tryJSON(http, '/api/version'), 'version'), 40)
  // los modelos que Ollama ejecuta en su nube (`remote_host`) no son de este ordenador
  const local = models
    .filter((m) => (text(at(m, 'model')) ?? text(at(m, 'name'))) !== undefined && at(m, 'remote_host') === undefined && at(m, 'remote_model') === undefined)
    .slice(0, MAX_MODELS)
  const rows: LocalServerModel[] = []
  for (const [i, m] of local.entries()) {
    const name = text(at(m, 'model')) ?? text(at(m, 'name')) ?? ''
    const details = i < MAX_DETAILS ? await client.details(name) : undefined
    const now = loaded.get(name)
    const caps = details?.capabilities
    rows.push(
      compact({
        id: name,
        label: name,
        loaded: running === undefined ? undefined : now !== undefined,
        context: positive(now?.context_length) ?? details?.numCtx,
        contextMax: details?.contextLength,
        tools: caps ? caps.includes('tools') : undefined,
        vision: caps ? caps.includes('vision') : undefined,
        thinking: caps ? caps.includes('thinking') : undefined,
        parameters: text(at(m, 'details', 'parameter_size'), 40),
        quantization: text(at(m, 'details', 'quantization_level'), 40),
        sizeBytes: parseByteCount(at(m, 'size')),
        isChat: caps ? caps.includes('completion') : true
      })
    )
  }
  return compact<LocalServerReport>({ kind: 'ollama', baseURL: http.origin + '/v1', version, models: rows, needsKey: false })
}

async function readLMStudio(http: LoopbackHTTP): Promise<LocalServerReport | undefined> {
  const baseURL = http.origin + '/v1'
  try {
    const v1 = await http.json('/api/v1/models')
    const models = at(v1, 'models')
    if (Array.isArray(models)) return { kind: 'lmstudio', baseURL, models: lmStudioV1(models), needsKey: false }
  } catch (err) {
    if (err instanceof LoopbackError && err.kind === 'unreachable') return undefined
    if (err instanceof LoopbackError && err.kind === 'status' && (err.status === 401 || err.status === 403)) return { kind: 'lmstudio', baseURL, models: [], needsKey: true }
  }
  // versiones antiguas: /api/v0/models
  const v0 = await tryJSON(http, '/api/v0/models')
  const data = at(v0, 'data')
  if (!Array.isArray(data)) return undefined
  const rows = data.slice(0, MAX_MODELS).flatMap((m): LocalServerModel[] => {
    const id = text(at(m, 'id'))
    if (!id) return []
    const type = at(m, 'type')
    const caps = list(at(m, 'capabilities')).filter((c): c is string => typeof c === 'string')
    const state = at(m, 'state')
    return [
      compact({
        id,
        label: id,
        loaded: state === 'loaded' ? true : state === 'not-loaded' ? false : undefined,
        context: positive(at(m, 'loaded_context_length')),
        contextMax: positive(at(m, 'max_context_length')),
        tools: Array.isArray(at(m, 'capabilities')) ? caps.includes('tool_use') : undefined,
        vision: type === 'vlm' ? true : undefined,
        quantization: text(at(m, 'quantization'), 40),
        isChat: type === 'llm' || type === 'vlm'
      })
    ]
  })
  return { kind: 'lmstudio', baseURL, models: rows, needsKey: false }
}

/** Modelos de `/api/v1/models` de LM Studio. */
export function lmStudioV1(models: unknown[]): LocalServerModel[] {
  return models.slice(0, MAX_MODELS).flatMap((m): LocalServerModel[] => {
    const key = text(at(m, 'key'))
    if (!key) return []
    const instances = list(at(m, 'loaded_instances'))
    const ctx = instances.map((i) => positive(at(i, 'config', 'context_length'))).find((c) => c !== undefined)
    return [
      compact({
        id: key,
        label: text(at(m, 'display_name')) ?? key,
        loaded: instances.length > 0,
        context: ctx,
        contextMax: positive(at(m, 'max_context_length')),
        tools: flag(at(m, 'capabilities', 'trained_for_tool_use')),
        vision: flag(at(m, 'capabilities', 'vision')),
        thinking: isObj(at(m, 'capabilities', 'reasoning')) ? true : undefined,
        parameters: text(at(m, 'params_string'), 40),
        quantization: text(at(m, 'quantization', 'name'), 40),
        sizeBytes: parseByteCount(at(m, 'size_bytes')),
        isChat: at(m, 'type') === 'llm'
      })
    ]
  })
}

async function readLlamaCpp(http: LoopbackHTTP): Promise<LocalServerReport | undefined> {
  const listed = await tryJSON(http, '/v1/models')
  if (listed === undefined) return undefined
  const props = (await tryJSON(http, '/props')) ?? {}
  const rows = list(at(listed, 'data'))
  // el 8080 lo usan muchos servidores: solo cuenta si dice ser llama.cpp
  const isLlama = at(props, 'default_generation_settings') !== undefined || at(props, 'build_info') !== undefined || rows.some((m) => at(m, 'owned_by') === 'llamacpp')
  if (!isLlama) return undefined
  const ctx = positive(at(props, 'default_generation_settings', 'n_ctx')) ?? positive(at(props, 'n_ctx'))
  const tools = flag(at(props, 'chat_template_caps', 'supports_tool_calls'))
  const vision = flag(at(props, 'modalities', 'vision'))
  const models = rows.slice(0, MAX_MODELS).flatMap((m): LocalServerModel[] => {
    const id = text(at(m, 'id'))
    if (!id) return []
    const params = at(m, 'meta', 'n_params')
    return [
      compact({
        id,
        label: id,
        loaded: true,
        context: ctx,
        contextMax: positive(at(m, 'meta', 'n_ctx_train')),
        tools,
        vision,
        parameters: typeof params === 'number' ? `${(params / 1e9).toFixed(1)}B` : undefined,
        sizeBytes: parseByteCount(at(m, 'meta', 'size')),
        isChat: true
      })
    ]
  })
  return compact<LocalServerReport>({ kind: 'llamacpp', baseURL: http.origin + '/v1', version: text(at(props, 'build_info'), 80), models, needsKey: false })
}

/** Quita las claves `undefined` (para comparar y serializar limpio). */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key]
  return value
}

// MARK: Ollama

export interface OllamaDetails {
  /** `completion`, `tools`, `thinking`, `vision`, `embedding`… */
  capabilities?: string[]
  /** Contexto de entrenamiento (`<arquitectura>.context_length`). */
  contextLength?: number
  /** `num_ctx` fijado en el modelo (Modelfile). */
  numCtx?: number
  architecture?: string
}

/** Cliente de la API nativa de Ollama (`/api/*`), solo contra este ordenador. El chat va por su API compatible con OpenAI. */
export class OllamaClient {
  constructor(readonly http: LoopbackHTTP) {}

  static create(baseURL = DEFAULT_ORIGINS.ollama!): OllamaClient | undefined {
    const http = LoopbackHTTP.create(baseURL, 4000)
    return http ? new OllamaClient(http) : undefined
  }

  async version(): Promise<string> {
    return text(at(await this.http.json('/api/version'), 'version')) ?? ''
  }

  async details(model: string): Promise<OllamaDetails | undefined> {
    const show = await tryJSON(this.http, '/api/show', { method: 'POST', body: { model }, timeoutMs: 4000 })
    return show === undefined ? undefined : parseOllamaDetails(show)
  }

  /** Descarga (`/api/pull` en streaming); `progress(hechos, total, estado)` suma las capas por `digest`. */
  async pull(model: string, progress: (done: number, total: number, status: string) => void, signal?: AbortSignal): Promise<void> {
    const layers = new Map<string, { done: number; total: number }>()
    let failure: string | undefined
    await this.http.lines('/api/pull', { body: { model, stream: true }, idleTimeoutMs: 300_000, signal }, (line) => {
      const error = text(at(line, 'error'), 2000)
      if (error) {
        failure = error
        return
      }
      const digest = text(at(line, 'digest'))
      if (digest && at(line, 'total') !== undefined) {
        const total = parseByteCount(at(line, 'total'), true)
        const done = parseByteCount(at(line, 'completed') ?? 0, true)
        if (total === undefined || done === undefined || done > total) throw new LoopbackError('badResponse')
        layers.set(digest, { done, total })
      }
      let done = 0
      let total = 0
      for (const layer of layers.values()) {
        done += layer.done
        total += layer.total
      }
      if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total)) throw new LoopbackError('badResponse')
      progress(done, total, text(at(line, 'status')) ?? '')
    })
    if (failure) throw new LoopbackError('status', 500, failure)
  }

  async delete(model: string): Promise<void> {
    await this.http.data('/api/delete', { method: 'DELETE', body: { model } })
  }

  /** Variante de `base` con un contexto fijo (la API compatible con OpenAI de Ollama no acepta `num_ctx`). */
  async createVariant(base: string, contextTokens: number, name?: string): Promise<string> {
    const variant = name ?? ollamaVariantName(base, contextTokens)
    await this.http.lines('/api/create', { body: { model: variant, from: base, parameters: { num_ctx: contextTokens }, stream: true }, idleTimeoutMs: 120_000 }, (line) => {
      const error = text(at(line, 'error'), 2000)
      if (error) throw new LoopbackError('status', 500, error)
    })
    return variant
  }

  /** Modelos cargados ahora (`/api/ps`). */
  async running(): Promise<{ name: string; context?: number }[]> {
    const v = await this.http.json('/api/ps')
    return list(at(v, 'models')).flatMap((m) => {
      const name = text(at(m, 'model')) ?? text(at(m, 'name'))
      return name ? [{ name, context: positive(at(m, 'context_length')) }] : []
    })
  }
}

export function parseOllamaDetails(show: unknown): OllamaDetails {
  const capsRaw = at(show, 'capabilities')
  const capabilities = Array.isArray(capsRaw) ? capsRaw.filter((c): c is string => typeof c === 'string') : undefined
  const info = at(show, 'model_info')
  const architecture = text(at(info, 'general.architecture'))
  const trained = architecture ? positive(at(info, `${architecture}.context_length`)) : undefined
  let numCtx: number | undefined
  for (const line of String(at(show, 'parameters') ?? '').split('\n')) {
    const parts = line.split(/[ \t]+/).filter(Boolean)
    if (parts.length >= 2 && parts[0] === 'num_ctx' && /^\d+$/.test(parts[parts.length - 1])) numCtx = Number(parts[parts.length - 1])
  }
  return compact({ capabilities, contextLength: trained, numCtx, architecture })
}

/** «qwen3:8b» → «qwen3-aula32k:8b» (misma familia, etiqueta reconocible). */
export function ollamaVariantName(base: string, contextTokens: number): string {
  const k = `aula${Math.trunc(contextTokens / 1024)}k`
  const colon = base.indexOf(':')
  return colon >= 0 ? `${base.slice(0, colon)}-${k}:${base.slice(colon + 1)}` : `${base}-${k}`
}

// MARK: Apps instaladas

/** Dónde suelen estar Ollama y LM Studio (solo mira el disco). */
export function findInstalledLocalApps(home = homedir(), platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): InstalledLocalApp[] {
  const first = (paths: string[]): string | undefined => paths.find((p) => existsSync(p))
  const out: InstalledLocalApp[] = []
  let ollamaApp: string | undefined
  let ollamaCLI: string | undefined
  let lmApp: string | undefined
  let lms: string | undefined
  if (platform === 'darwin') {
    ollamaApp = first(['/Applications/Ollama.app', join(home, 'Applications/Ollama.app')])
    ollamaCLI = first(['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'])
    lmApp = first(['/Applications/LM Studio.app', join(home, 'Applications/LM Studio.app')])
    lms = first([join(home, '.lmstudio/bin/lms'), join(home, '.cache/lm-studio/bin/lms')])
  } else if (platform === 'win32') {
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    ollamaApp = first([join(local, 'Programs', 'Ollama', 'ollama app.exe')])
    ollamaCLI = first([join(local, 'Programs', 'Ollama', 'ollama.exe')])
    lmApp = first([join(local, 'Programs', 'LM Studio', 'LM Studio.exe'), join(local, 'Programs', 'lm-studio', 'LM Studio.exe')])
    lms = first([join(home, '.lmstudio', 'bin', 'lms.exe'), join(home, '.cache', 'lm-studio', 'bin', 'lms.exe')])
  } else {
    ollamaCLI = first(['/usr/local/bin/ollama', '/usr/bin/ollama', join(home, '.local/bin/ollama')])
    lmApp = first([join(home, 'Applications/LM-Studio.AppImage'), join(home, '.local/share/applications/lm-studio.desktop')])
    lms = first([join(home, '.lmstudio/bin/lms'), join(home, '.cache/lm-studio/bin/lms')])
  }
  if (ollamaApp || ollamaCLI) out.push(compact({ kind: 'ollama', app: ollamaApp, cli: ollamaCLI }))
  if (lmApp || lms) out.push(compact({ kind: 'lmstudio', app: lmApp, cli: lms }))
  return out
}
