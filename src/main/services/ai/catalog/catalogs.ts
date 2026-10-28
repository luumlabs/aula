// Listas de modelos de cada proveedor (port de ModelCatalogs.swift y OpenRouterRanking.swift): se piden EN ESE MOMENTO a la API
// (`GET /models` o el equivalente) con todo lo que diga de cada modelo (nombre, contexto, herramientas, imágenes, precio, niveles
// de razonamiento); si la API no da lista, se usan los modelos conocidos que trae Aula.
import type { JSONValue } from '@shared/ai/json'
import type { ModelCatalog, ModelInfo } from '@shared/ai/types'
import { knownReasoningCapabilities, reasoningCaps, type ReasoningCapabilities } from '@shared/ai/reasoning'
import { AIError } from '../errors'
import { arr, at, bool, int, num, obj, str, tryParseJSON } from '../core/json'
import { hostOf } from '../http/endpoints'
import { likelyChatModels } from '../http/requester'
import type { ProviderConfig } from '../providers/config'
import { resolveDeps, USER_AGENT, type ProviderDeps } from '../providers/base'
import { modelsEmpty } from '../providers/common'
import { openAIModelsJSON } from '../providers/openai'
import { anthropicModelsJSON } from '../providers/anthropic'
import { presetById } from '../presets'

const m = (id: string, displayName: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, displayName, isFree: false, ...extra })

/** Modelos conocidos (respaldo) por id de preset; el primero de cada lista es el recomendado. Comprobados en octubre de 2026. */
export const KNOWN_MODELS: Record<string, ModelInfo[]> = {
  deepseek: [m('deepseek-flash', 'DeepSeek V4.1 Flash', { contextLength: 1_000_000, supportsTools: true, supportsVision: true }),
    m('deepseek-v4-pro', 'DeepSeek V4 Pro', { contextLength: 1_000_000, supportsTools: true, supportsVision: false })],
  mimo: [m('mimo-v2.6-flash', 'MiMo V2.6 Flash', { contextLength: 1_000_000, maxOutputTokens: 131_072, supportsTools: true, supportsVision: true }),
    m('mimo-v2.6-pro', 'MiMo V2.6 Pro', { contextLength: 1_000_000, maxOutputTokens: 131_072, supportsTools: true, supportsVision: true }),
    m('mimo-v2.6-pro-ultraspeed', 'MiMo V2.6 Pro Ultraspeed', { contextLength: 1_000_000, supportsTools: true })],
  openai: [m('gpt-6-sol', 'GPT-6 Sol', { contextLength: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true }),
    m('gpt-6.1-sol', 'GPT-6.1 Sol', { contextLength: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true }),
    m('gpt-6-luna', 'GPT-6 Luna', { contextLength: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true }),
    m('gpt-6-astra', 'GPT-6 Astra', { contextLength: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true })],
  anthropic: [m('claude-sonnet-5-5', 'Claude Sonnet 5.5', { contextLength: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true }),
    m('claude-opus-5-5', 'Claude Opus 5.5', { contextLength: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true }),
    m('claude-haiku-5-5', 'Claude Haiku 5.5', { contextLength: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true }),
    m('claude-fable-5-1', 'Claude Fable 5.1', { contextLength: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true })],
  openrouter: [m('deepseek/deepseek-v4.1-flash', 'DeepSeek: DeepSeek V4.1 Flash', { supportsTools: true }),
    m('anthropic/claude-sonnet-5.5', 'Anthropic: Claude Sonnet 5.5', { supportsTools: true, supportsVision: true })],
  'opencode-zen': [m('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', { supportsTools: true }), m('glm-5.3', 'GLM 5.3', { supportsTools: true }),
    m('kimi-k3', 'Kimi K3', { supportsTools: true }), m('qwen3.8-max', 'Qwen3.8 Max', { supportsTools: true }),
    m('mimo-v2.6-flash-free', 'MiMo V2.6 Flash (gratis)', { supportsTools: true, isFree: true })],
  gemini: [m('gemini-flash-latest', 'Gemini Flash', { supportsTools: true, supportsVision: true }),
    m('gemini-pro-latest', 'Gemini Pro', { supportsTools: true, supportsVision: true })],
  mistral: [m('mistral-medium-latest', 'Mistral Medium', { supportsTools: true, supportsVision: true }),
    m('mistral-large-latest', 'Mistral Large', { supportsTools: true, supportsVision: true }),
    m('mistral-small-latest', 'Mistral Small', { supportsTools: true, supportsVision: true })],
  groq: [m('openai/gpt-oss-120b', 'gpt-oss 120B', { supportsTools: true }), m('openai/gpt-oss-20b', 'gpt-oss 20B', { supportsTools: true })],
  ollama: [m('qwen3.5:9b', 'Qwen3.5 9B', { supportsTools: true }), m('gpt-oss:20b', 'gpt-oss 20B', { supportsTools: true })]
}

/** El modelo recomendado de un proveedor: el del preset o el primero conocido. */
export function recommendedModel(config: Pick<ProviderConfig, 'id'>): string | undefined {
  const p = presetById(config.id)
  if (p?.model) return p.model
  return KNOWN_MODELS[config.id]?.[0]?.id
}

const positive = (v: JSONValue | undefined): number | undefined => {
  const n = int(v)
  return n !== undefined && n > 0 ? n : undefined
}

/** Precio de OpenRouter: cadena («0.000002») o número; `-1` (variable) no cuenta. */
const price = (v: JSONValue | undefined): number | undefined => {
  const d = num(v)
  return d !== undefined && d >= 0 ? d : undefined
}

/** Capacidades de razonamiento de Anthropic `GET /v1/models` (`capabilities.effort`, `capabilities.thinking.types`). */
export function anthropicReasoning(caps: JSONValue | undefined): ReasoningCapabilities | undefined {
  const c = obj(caps)
  const effort = obj(c?.effort)
  if (!c || !effort) return undefined
  const levels = bool(effort.supported) === true ? ['low', 'medium', 'high', 'xhigh', 'max'].filter((l) => bool(at(effort, l, 'supported')) === true) : []
  let types: string[] | undefined
  const thinking = obj(c.thinking)
  if (thinking) {
    types = bool(thinking.supported) === true ? ['adaptive', 'enabled', 'disabled'].filter((t) => bool(at(thinking, 'types', t, 'supported')) === true) : []
  }
  return reasoningCaps(levels, undefined, types)
}

/**
 * Lee los modelos de cualquiera de los formatos conocidos: OpenAI/MiMo/Ollama/LM Studio `{"data":[{"id"}]}`, OpenRouter
 * (`pricing`, `supported_parameters`, `architecture.input_modalities`, `top_provider`), DeepSeek (`context_window`,
 * `input_modalities`, `effort`), Anthropic (`display_name`, `max_input_tokens`, `capabilities`) y Ollama nativo `{"models":[…]}`.
 */
export function parseModelInfos(json: JSONValue): ModelInfo[] {
  const list = arr(json) ?? arr(obj(json)?.data) ?? arr(obj(json)?.models)
  if (!list) return []
  const seen = new Set<string>()
  const out: ModelInfo[] = []
  for (const item of list) {
    const o = obj(item)
    const id = (str(item) ?? str(o?.id) ?? str(o?.model) ?? str(o?.name))?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const info: ModelInfo = { id, isFree: false }
    if (o) {
      const levels = arr(at(o, 'effort', 'supported_levels'))
      const reasoning = obj(o.reasoning)
      if (levels) {
        // DeepSeek publica los niveles activos; «none» se envía como thinking.type=disabled
        info.reasoningCapabilities = reasoningCaps(['none', ...levels.map((l) => str(l)).filter((x): x is string => !!x)], str(at(o, 'effort', 'default_level')))
      } else if (reasoning && reasoning.supported_efforts !== undefined) {
        const supported = reasoning.supported_efforts
        let lv = supported === null ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : (arr(supported) ?? []).map((l) => str(l)).filter((x): x is string => !!x)
        if (bool(reasoning.mandatory) === true) lv = lv.filter((l) => l !== 'none')
        info.reasoningCapabilities = reasoningCaps(lv, str(reasoning.default_effort))
      } else if (arr(o.supported_reasoning_levels)) {
        const lv = arr(o.supported_reasoning_levels)!.map((l) => str(l) ?? str(obj(l)?.effort)).filter((x): x is string => !!x)
        info.reasoningCapabilities = reasoningCaps(lv, str(o.default_reasoning_level))
      } else {
        const caps = anthropicReasoning(o.capabilities)
        if (caps) info.reasoningCapabilities = caps
      }
      const display = str(o.display_name) ?? (o.id !== undefined ? str(o.name) : undefined)
      if (display && display !== id) info.displayName = display
      info.contextLength = positive(o.context_length) ?? positive(o.context_window) ?? positive(o.max_input_tokens) ?? positive(o.max_context_length)
      info.maxOutputTokens = positive(o.max_output_tokens) ?? positive(o.max_tokens) ?? positive(at(o, 'top_provider', 'max_completion_tokens'))
      const params = arr(o.supported_parameters)
      if (params) info.supportsTools = params.some((x) => x === 'tools')
      const modalities = arr(at(o, 'architecture', 'input_modalities')) ?? arr(o.input_modalities)
      if (modalities) info.supportsVision = modalities.some((x) => x === 'image')
      const image = bool(at(o, 'capabilities', 'image_input', 'supported'))
      if (image !== undefined) info.supportsVision = image
      const capList = arr(o.capabilities)
      if (capList) {
        // Ollama `/api/show`, LM Studio
        const names = capList.map((x) => str(x)).filter((x): x is string => !!x)
        info.supportsTools = names.includes('tools') || names.includes('tool_use')
        info.supportsVision = names.includes('vision')
      }
      const pricing = obj(o.pricing)
      if (pricing) {
        const pIn = price(pricing.prompt)
        const pOut = price(pricing.completion)
        if (pIn !== undefined) info.inputPricePerMillion = pIn * 1_000_000
        if (pOut !== undefined) info.outputPricePerMillion = pOut * 1_000_000
        info.isFree = pIn === 0 && pOut === 0
      }
      const created = num(o.created)
      if (created !== undefined && created > 0) info.created = created * 1000
      else if (typeof o.created_at === 'string') {
        const t = Date.parse(o.created_at)
        if (!Number.isNaN(t)) info.created = t
      }
    }
    if (id.endsWith(':free')) info.isFree = true
    // sin claves `undefined` (el catálogo viaja por IPC y se guarda en disco)
    for (const k of Object.keys(info) as (keyof ModelInfo)[]) if (info[k] === undefined) delete info[k]
    out.push(info)
  }
  return out
}

function enriched(model: ModelInfo, config: ProviderConfig): ModelInfo {
  const info: ModelInfo = { ...model }
  const known = knownReasoningCapabilities(info.id, config)
  if (!info.reasoningCapabilities) {
    info.reasoningCapabilities = hostOf(config.baseURL) === 'openrouter.ai' ? reasoningCaps([]) : (known ?? reasoningCaps([]))
  } else if (!info.reasoningCapabilities.defaultEffort && known?.defaultEffort && info.reasoningCapabilities.efforts.includes(known.defaultEffort)) {
    info.reasoningCapabilities = { ...info.reasoningCapabilities, defaultEffort: known.defaultEffort } // la API no dice el predeterminado; la doc sí
  }
  return info
}

/** El recomendado primero; después los que admiten herramientas (Aula las necesita); el resto, por nombre. */
export function sortModels(models: ModelInfo[], config: ProviderConfig): ModelInfo[] {
  const rec = recommendedModel(config)
  return [...models].sort((a, b) => {
    if ((a.id === rec) !== (b.id === rec)) return a.id === rec ? -1 : 1
    const ta = a.supportsTools !== false
    const tb = b.supportsTools !== false
    if (ta !== tb) return ta ? -1 : 1
    return a.id.localeCompare(b.id, 'en', { numeric: true, sensitivity: 'base' })
  })
}

export const OPENROUTER_RANKING_URL = 'https://openrouter.ai/api/v1/models?sort=top-weekly'

/** «Top 10 más populares» (con herramientas y de pago) y «Top 10 gratis» de OpenRouter, por su orden oficial (público, sin clave). */
export async function openRouterSections(models: ModelInfo[], deps: ProviderDeps, signal?: AbortSignal): Promise<{ popular: ModelInfo[]; free: ModelInfo[] }> {
  const ranked = await openRouterRanked(deps, signal)
  const order = ranked.length ? ranked : models
  const popular = ranked.length ? order.filter((x) => x.supportsTools === true && !x.isFree).slice(0, 10) : []
  const free = order.filter((x) => x.isFree)
  const freeSorted = [...free.filter((x) => x.supportsTools === true), ...free.filter((x) => x.supportsTools !== true)]
  return { popular, free: freeSorted.slice(0, 10) }
}

async function openRouterRanked(deps: ProviderDeps, signal?: AbortSignal): Promise<ModelInfo[]> {
  const d = resolveDeps(deps)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20_000)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await d.http.fetch(OPENROUTER_RANKING_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, 'HTTP-Referer': 'https://aula.local', 'X-OpenRouter-Title': 'Aula' },
      signal: ctl.signal
    })
    if (res.status !== 200) return []
    const json = tryParseJSON(await res.text())
    return json === undefined ? [] : parseModelInfos(json)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Pide la lista al proveedor. Nunca lanza: si la API falla (sin clave, 401, 404, sin red…) devuelve los modelos conocidos con
 * `source: 'known'` y el motivo en `problem`.
 */
export async function fetchModelCatalog(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal, nowMs = Date.now()): Promise<ModelCatalog> {
  const fallback = (KNOWN_MODELS[config.id] ?? []).map((x) => enriched(x, config))
  const known = (problem?: string): ModelCatalog => ({ models: fallback, popular: [], free: [], fetchedAt: nowMs, source: 'known', ...(problem ? { problem } : {}) })
  try {
    let models: ModelInfo[]
    let popular: ModelInfo[] = []
    let free: ModelInfo[] = []
    if (config.kind === 'anthropic') {
      models = (await anthropicModelsJSON(config, deps, signal)).flatMap(parseModelInfos)
    } else if (config.kind === 'openai-compatible' || config.kind === 'ollama' || config.kind === 'lmstudio') {
      const infos = parseModelInfos(await openAIModelsJSON(config, deps, signal))
      const chat = new Set(likelyChatModels(infos.map((x) => x.id)))
      models = infos.filter((x) => chat.has(x.id))
      if (hostOf(config.baseURL) === 'openrouter.ai') ({ popular, free } = await openRouterSections(models, deps, signal))
    } else {
      return known()
    }
    models = models.map((x) => enriched(x, config))
    popular = popular.map((x) => enriched(x, config))
    free = free.map((x) => enriched(x, config))
    if (!models.length) return known(modelsEmpty(config).message)
    return { models: sortModels(models, config), popular, free, fetchedAt: nowMs, source: 'api' }
  } catch (err) {
    return known(err instanceof AIError ? err.message : err instanceof Error ? err.message : String(err))
  }
}
