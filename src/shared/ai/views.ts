// Lo que la interfaz recibe de la capa de IA por IPC. Nunca lleva claves: solo si hay una (`hasKey`) y una pista enmascarada.
import type { AIProviderKind, AIReasoningChoice } from '../settings/ai'
import type { ModelCatalog, Usage } from './types'

export type AIProviderGroup = 'subscription' | 'api' | 'local' | 'custom'
export type AIBilling = 'perToken' | 'subscription' | 'local' | 'unknown'

export interface AIReasoningOption {
  value: AIReasoningChoice | string
  label: string
}

export interface AIModelChoice {
  id: string
  label: string
}

export interface AIProviderView {
  id: string
  kind: AIProviderKind
  label: string
  group: AIProviderGroup
  /** Ayuda breve: dónde conseguir la clave, qué modelo conviene… (en el idioma de la app). */
  help: string
  /** Página donde se crea la clave (si la hay). */
  keyURL?: string
  baseURL?: string
  model?: string
  /** El modelo recomendado del preset (el que se usa si no se elige otro). */
  defaultModel?: string
  /** Modelos conocidos del preset para elegir (solo si hay más de uno; el recomendado primero). */
  models?: AIModelChoice[]
  reasoning?: AIReasoningChoice
  /** Niveles de razonamiento del modelo elegido (vacío = no se puede elegir). */
  reasoningOptions: AIReasoningOption[]
  /** ¿Necesita clave de API? */
  needsKey: boolean
  hasKey: boolean
  /** «sk-…a1b2» (nunca la clave). */
  keyHint?: string
  /** Está en los ajustes o tiene clave. */
  configured: boolean
  enabled: boolean
  /** Es el proveedor que se usa ahora (el elegido o, en automático, el mejor disponible). */
  active: boolean
  /** Se puede usar ya (clave, CLI instalada y con sesión, servidor local en marcha…). */
  available: boolean
  /** Por qué no está disponible (frase corta). */
  availability?: string
  billing: AIBilling
  /** Hay una implementación registrada para su tipo (las CLIs y los modelos locales los registra otro módulo). */
  supported: boolean
}

export interface AIStatus {
  /** Lo que eligió la persona (null = automático). */
  activeProvider: string | null
  auto: boolean
  /** El proveedor y el modelo que se usarán ahora mismo. */
  resolved: { providerId: string; label: string; kind: AIProviderKind; model: string } | null
  /** ¿Hay alguna IA lista para usar? */
  ready: boolean
  /** Si no está lista, por qué (código estable y frase). */
  problem?: { code: string; message: string }
}

export interface AITestResult {
  state: 'ready' | 'needsKey' | 'error'
  message: string
  /** Modelos que lista el proveedor (si se pudo). */
  models: string[]
  /** Respuesta del modelo a «Responde solo: OK». */
  answer?: string
}

export type ModelCatalogView = ModelCatalog

export interface CostSummaryView {
  usd: number
  calls: number
  unknownCalls: number
  inexactCalls: number
  freeCalls: number
  tokens: number
  /** «≈ 0,41 US$», «1,20 US$ + 3 llamadas de coste desconocido». */
  text: string
}

export interface AICostsView {
  today: CostSummaryView
  month: CostSummaryView
  /** Tope diario (null = sin tope). */
  limitUSD: number | null
  level: 'noLimit' | 'ok' | 'warning' | 'reached' | 'invalid'
  /** Lo gastado hoy más lo que llevan las llamadas en curso. */
  committedUSD: number
  remainingUSD: number | null
  /** Cuándo vuelve a empezar el tope (medianoche local, ms). */
  resetsAt: number
  /** «0,41 US$ de 2,00 US$ hoy». */
  statusText: string
  /** Lo de hoy por uso (chat, curso, tutor…). */
  byPurpose: Record<string, CostSummaryView>
  /** Lo del mes por curso ('' = sin curso). */
  byCourse: Record<string, CostSummaryView>
}

export interface AIChatDone {
  requestId: string
  text: string
  reasoning?: string
  usage: Usage
  finish: string
  cancelled?: boolean
}
