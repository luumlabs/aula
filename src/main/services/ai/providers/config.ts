// Configuración completa de un proveedor (la de los ajustes + los valores del preset), como `ProviderConfig` de Swift.
import type { AIProviderKind } from '@shared/settings/ai'
import type { ReasoningCapabilities } from '@shared/ai/reasoning'
import { AUTOMATIC_EFFORT, knownReasoningCapabilities, validatedEffort } from '@shared/ai/reasoning'

export interface ProviderConfig {
  id: string
  kind: AIProviderKind
  /** Nombre visible («DeepSeek»). */
  label: string
  baseURL?: string
  model: string
  /** Referencia de la clave en el almacén de secretos; `null` = no usa clave (servidores locales). */
  secretRef: string | null
  /** Cabeceras HTTP extra y opciones locales `x-aula-…` (estas nunca salen a la red). */
  extraHeaders: Record<string, string>
  supportsTools: boolean
  supportsVision: boolean
  supportsStreaming: boolean
  supportsJSONMode: boolean
  /** Ventana de trabajo que respeta el bucle al recortar el historial (no el máximo del modelo). */
  contextWindow?: number
  maxOutputTokens?: number
  enabled: boolean
  /** Elección de razonamiento ('auto' o ausente = el del proveedor). */
  reasoning?: string
  /** Niveles publicados por el catálogo de la API, por modelo (mandan sobre la lista conocida). */
  reasoningCapabilitiesByModel?: Record<string, ReasoningCapabilities>
  /** Ruta propia del ejecutable (CLIs). */
  executable?: string
}

/** Niveles que admite un modelo: el catálogo manda; sin él, solo capacidades comprobadas de endpoints oficiales. */
export function reasoningCapabilitiesFor(config: ProviderConfig, model?: string): ReasoningCapabilities | undefined {
  const m = model || config.model
  return config.reasoningCapabilitiesByModel?.[m] ?? knownReasoningCapabilities(m, { kind: config.kind, baseURL: config.baseURL })
}

/** El esfuerzo guardado si el modelo lo admite (`undefined` = automático o no compatible: no se envía). */
export function reasoningEffortFor(config: ProviderConfig, model?: string): string | undefined {
  const raw = config.reasoning
  if (!raw || raw === 'auto' || raw === AUTOMATIC_EFFORT) return undefined
  return validatedEffort(reasoningCapabilitiesFor(config, model), raw)
}

export function modelOrDefault(requestModel: string | undefined, config: ProviderConfig): string {
  return requestModel ? requestModel : config.model
}
