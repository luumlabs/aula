// El motor propio de Aula como proveedor de la capa de IA (`aula-local`): un `ChatModel` compatible con OpenAI que enciende
// `llama-server` al primer uso (con el modelo descargado elegido), le pasa su clave de esta sesión y lo marca en uso mientras
// dura cada petición (así el apagado por inactividad nunca corta una respuesta). Ollama y LM Studio ya son compatibles con
// OpenAI y los atiende la capa de IA con sus presets; aquí solo se aporta su detección (servers.ts).
import type { AIProviderConfig, AIProviderKind } from '@shared/settings/ai'
import type { ChatRequest, ChatResponse } from '@shared/ai/types'
import type { InstalledLocalModel } from '@shared/agents'
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import { AulaError } from '../errors'
import { MemorySecretStore } from '../secrets'
import { AIError } from '../ai/errors'
import type { ChatModel, CompleteOptions, ModelCapabilities } from '../ai/model'
import { OpenAICompatibleModel } from '../ai/providers/openai'
import type { ProviderConfig } from '../ai/providers/config'
import type { ProviderDeps } from '../ai/providers/base'
import { EngineError, type RunningServer } from './engine'
import type { LocalAIService } from './service'

const KEY_REF = 'aula-local.session'

/** El modelo descargado que se usará: el configurado (id o alias), el que ya está en marcha o el primero descargado. */
export function pickInstalledModel(service: LocalAIService, wanted?: string): InstalledLocalModel | undefined {
  const installed = service.installed()
  const id = wanted?.trim()
  if (id) return installed.find((m) => m.id === id || m.alias === id)
  const running = service.engine.running
  return (running && installed.find((m) => m.alias === running.alias)) ?? [...installed].sort((a, b) => (a.card.rank ?? 50) - (b.card.rank ?? 50))[0]
}

export function localCapabilities(model: InstalledLocalModel | undefined): ModelCapabilities {
  const caps = model?.card.capabilities ?? ['tools']
  return {
    tools: caps.includes('tools'),
    vision: caps.includes('vision') && !!model?.projector,
    streaming: true,
    jsonMode: true,
    contextWindow: model?.contextTokens ?? 32_768,
    maxOutputTokens: 8_192,
    reasoning: null
  }
}

function noModelError(): AIError {
  return new AIError(
    'other',
    tr(
      `Aún no has descargado ningún modelo para el motor de Aula. Ve a ${settingsPath('ai', 'es')} y pulsa «Descargar y usar».`,
      `You haven’t downloaded a model for Aula’s engine yet. Go to ${settingsPath('ai', 'en')} and click “Download and use”.`
    ),
    { code: 'ai_no_model' }
  )
}

/** Errores del motor con los códigos de la capa de IA. */
function toAIError(err: unknown): AIError {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof EngineError) {
    if (err.kind === 'notInstalled') return new AIError('other', message, { code: 'ai_not_installed' })
    if (err.kind === 'modelMissing') return new AIError('other', message, { code: 'ai_no_model' })
    return new AIError('other', message, { code: 'ai_server' })
  }
  if (err instanceof AulaError && err.code === 'not_found') return new AIError('other', message, { code: 'ai_no_model' })
  return new AIError('other', message, { code: 'ai_error' })
}

/** Configuración HTTP del servidor en marcha (la clave va en un almacén propio de esta llamada, nunca en los ajustes). */
export function serverProviderConfig(config: AIProviderConfig, server: RunningServer, model: InstalledLocalModel): ProviderConfig {
  const caps = localCapabilities(model)
  return {
    id: config.id,
    kind: 'aula-local',
    label: config.label || 'Aula',
    baseURL: server.baseURL,
    model: server.alias,
    secretRef: KEY_REF,
    extraHeaders: { ...(config.headers ?? {}) },
    supportsTools: caps.tools,
    supportsVision: caps.vision,
    supportsStreaming: true,
    supportsJSONMode: true,
    contextWindow: caps.contextWindow,
    maxOutputTokens: caps.maxOutputTokens,
    enabled: true
  }
}

/** Un `ChatModel` sobre el motor de Aula (arranque perezoso, uso marcado, mismos errores que cualquier proveedor compatible). */
export function createAulaLocalChatModel(config: AIProviderConfig, service: LocalAIService, deps: ProviderDeps = {}): ChatModel {
  const chosen = pickInstalledModel(service, config.model)
  const complete = async (request: ChatRequest, options: CompleteOptions = {}): Promise<ChatResponse> => {
    const model = pickInstalledModel(service, request.model || config.model)
    if (!model) throw noModelError()
    service.beginUse()
    try {
      const server = await service.ensureServer(model.id, undefined, options.signal)
      const secrets = new MemorySecretStore()
      secrets.set(KEY_REF, server.apiKey)
      const inner = new OpenAICompatibleModel(serverProviderConfig(config, server, model), { ...deps, secrets })
      return await inner.complete({ ...request, model: server.alias }, options)
    } catch (err) {
      if (err instanceof AIError) throw err
      if (options.signal?.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
      throw toAIError(err)
    } finally {
      service.endUse()
    }
  }
  return {
    providerId: config.id,
    providerName: config.label || 'Aula',
    kind: 'aula-local',
    model: chosen?.alias ?? '',
    capabilities: localCapabilities(chosen),
    complete
  }
}

/** ¿Hay algún modelo descargado? (para elegir solo el mejor proveedor disponible). */
export function probeAulaLocal(service: LocalAIService): { available: boolean; reason?: string; models?: string[] } {
  const installed = service.installed()
  if (installed.length === 0) return { available: false, reason: tr('Aún no has descargado ningún modelo para el motor de Aula.', 'You haven’t downloaded a model for Aula’s engine yet.') }
  return { available: true, models: installed.map((m) => m.alias) }
}

export type LocalProviderRegistrar = (
  kind: AIProviderKind,
  factory: (config: AIProviderConfig, ctx: { deps: ProviderDeps }) => ChatModel,
  options?: { probe?: (config: AIProviderConfig) => { available: boolean; reason?: string; models?: string[] }; probeTTLms?: number }
) => unknown

/** Registra el motor de Aula en el registro de la capa de IA: `registerLocalProviders(registerProviderFactory, servicio)`. */
export function registerLocalProviders(register: LocalProviderRegistrar, service: LocalAIService): void {
  register('aula-local', (config, ctx) => createAulaLocalChatModel(config, service, ctx?.deps), { probe: () => probeAulaLocal(service), probeTTLms: 10_000 })
}
