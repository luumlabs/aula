// Ajustes de IA. Dueño: dominio «ai» (src/main/services/ai). Por defecto, Aula elige sola la mejor IA disponible.
// Las claves NUNCA van aquí: están en el almacén de secretos con la referencia `secretRef` (por defecto `ai.key.<id>`).
export type AIProviderKind = 'auto' | 'openai-compatible' | 'anthropic' | 'claude-cli' | 'codex-cli' | 'opencode-cli' | 'ollama' | 'lmstudio' | 'aula-local'

/** Nivel de razonamiento elegido ('auto' = el del proveedor; solo se envía si el modelo lo admite). */
export type AIReasoningChoice = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'enabled'

export interface AIProviderConfig {
  /** Id estable (p. ej. 'deepseek', 'openrouter', 'claude-cli', 'custom-1'). */
  id: string
  kind: AIProviderKind
  label: string
  baseURL?: string
  model?: string
  /** Nivel de razonamiento ('auto' = el del proveedor). */
  reasoning?: AIReasoningChoice
  /** Ruta propia del ejecutable (CLIs). */
  executable?: string
  /** La clave va en el almacén de secretos con esta referencia (nunca aquí). */
  secretRef?: string
  /** `false` = Aula no lo usa (tampoco al elegir solo). Por defecto, activado. */
  enabled?: boolean
  /** Solo proveedores personalizados: cabeceras HTTP extra y opciones locales `x-aula-…` (no salen a la red). */
  headers?: Record<string, string>
  /** Solo proveedores personalizados: capacidades declaradas (por defecto, las del preset). */
  supportsTools?: boolean
  supportsVision?: boolean
  contextWindow?: number
  maxOutputTokens?: number
}

/** Precio propio de un modelo en USD por millón de tokens (manda sobre la tabla de Aula). */
export interface AIUserPrice {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface AISettings {
  /** Proveedor activo (id de `providers` o de un preset), o null = elegir solo el mejor que haya. */
  activeProvider: string | null
  providers: AIProviderConfig[]
  /** Agentes a la vez al crear un curso. */
  maxParallel: number
  /** Tope diario de gasto en USD para proveedores de pago (0 = sin tope). Las suscripciones y los modelos locales no cuentan. */
  dailyBudgetUSD: number
  /** Precios propios por «modelo» o «proveedor:modelo» (opcional). */
  userPrices?: Record<string, AIUserPrice>
  /** Con tope: avisar a partir de esta fracción (0,1…1; por defecto 0,8). */
  warnFraction?: number
  /** Con tope: no usar modelos de precio desconocido (por defecto, sí se bloquean: no se podría garantizar el tope). */
  blockUnknownPrices?: boolean
}

export function defaultAISettings(): AISettings {
  return { activeProvider: null, providers: [], maxParallel: 4, dailyBudgetUSD: 0 }
}

/** El tope diario que escribe la persona («1,5», «1.5 $») → 1.5; `null` si no es un tope posible (más de 0 y hasta 10 000 US$). */
export function parseDailyBudget(raw: string): number | null {
  const s = raw.trim().replace(/\s|\$|US\$|USD/gi, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null
  const v = Number(s)
  return Number.isFinite(v) && v > 0 && v <= 10_000 ? Math.round(v * 100) / 100 : null
}

/** Referencia de la clave de un proveedor en el almacén de secretos. */
export function aiKeyRef(providerId: string): string {
  return `ai.key.${providerId}`
}
