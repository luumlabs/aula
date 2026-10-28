// API pública de la capa de IA. El resto de la app importa SOLO de aquí (`@main/services/ai`); los nombres son estables.
//
//     const model = await resolveActiveModel()                       // el proveedor elegido o el mejor disponible (medido)
//     const { text } = await completeText(model, { system, prompt })
//     const { value } = await completeJSON(model, { system, prompt, validate })
//     const result = await withAIUse({ purpose: 'course', courseID }, () =>
//       runToolLoop({ model, system, prompt, tools, signal, onEvent }))
//
// Un módulo con otro tipo de proveedor (CLIs, motor local) lo enchufa con `registerProviderFactory(kind, factory, { probe })`.

// Interfaz de los modelos y las herramientas
export type { ChatModel, ModelCapabilities, CompleteOptions, AgentTool, ToolOutput, ToolContext, AgentTaskSpec } from './model'
export type {
  ChatMessage, ChatRequest, ChatResponse, ChatEvent, ContentPart, ImagePart, ToolCall, ToolSpec, ToolChoice, Usage, FinishReason,
  PromptCacheHint, AgentEvent, AgentResult, ModelInfo, ModelCatalog
} from '@shared/ai/types'
export { msg, messageText, messageImages, emptyUsage, addUsage, usageTotal } from '@shared/ai/types'
export type { JSONValue, JSONObject, JSONSchema } from '@shared/ai/json'

// Errores (códigos estables en `AIError.code`, ver @shared/ai/errors)
export { AIError, cancelledError, isCancellation, isContextLengthError, looksLikeToolRejection } from './errors'
export type { AIErrorKind, AIErrorOptions } from './errors'

// Registro de proveedores y modelo activo
export {
  registerProviderFactory, unregisterProviderFactory, isKindSupported, isRegisteredKind, createAPIModel, providerEntries, providerEntry,
  listAvailableProviders, pickAutomatic, resolveActiveModel, resolveActiveProvider, createModelFor, invalidateAvailability, noProviderError,
  reasoningFor, setModelOverride, modelOverride
} from './registry'
export { createFakeModel, setFakeAIScript, FAKE_PROVIDER_ID } from './fake'
export type { FakeAIScript } from './fake'
export type {
  ProviderAvailability, ProviderFactory, ProviderFactoryContext, ProviderProbe, ProviderRegistrationOptions, ProviderEntry, ProviderState,
  ResolveOptions, AvailabilityOptions
} from './registry'
export { PROVIDER_PRESETS, presetById, configFromPreset } from './presets'
export type { ProviderPreset } from './presets'
export type { ProviderConfig } from './providers/config'
export type { ProviderDeps } from './providers/base'

// Bucle de agente
export { runToolLoop, toolLoopCacheKey } from './loop/toolLoop'
export type { ToolLoopOptions } from './loop/toolLoop'

// Atajos: texto, streaming y JSON con reparación
export { buildRequest, completeText, streamText, completeJSON, parseJSONReply, jsonInstructions } from './helpers'
export type { TextInput, TextResult, StreamCallbacks, JSONInput, JSONResult, JSONValidation } from './helpers'
export { parseLenientJSON, tryParseLenientJSON, repairJSON, fixLaTeXInValue } from './core/repair'

// Proveedores HTTP (casos especiales y pruebas)
export { OpenAICompatibleModel, openAIListModels, openAIPing } from './providers/openai'
export { AnthropicModel, anthropicListModels, anthropicPing } from './providers/anthropic'
export { ThinkingVault, FixupMemory } from './providers/memory'

// Catálogos de modelos
export { providerCatalog, cachedCatalog, CATALOG_TTL_MS } from './catalog/cache'
export { fetchModelCatalog, KNOWN_MODELS, recommendedModel } from './catalog/catalogs'

// Servicio de la interfaz (lo usa el IPC)
export {
  aiStatus, aiProviderViews, setProviderKey, removeProviderKey, configureAI, providerModels, testProvider, aiCosts, ChatStreams,
  sanitizeChatMessages
} from './service'
export type { ConfigureArgs, ChatStreamArgs, ChatDelta, ChatStreamSink } from './service'

// Costes: atribución del gasto y tope (atajos; el resto en @main/services/costs)
export { withAIUse, currentAIUse, costMeter, meteredModel, BudgetError } from '../costs'
export type { AIUseScope, AIUsePurpose } from '../costs'
