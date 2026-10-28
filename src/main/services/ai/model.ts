// La interfaz única que usa el resto de la app: un modelo de chat (`ChatModel`) y las herramientas del bucle de agente.
// Los proveedores de API (este dominio), los agentes CLI y los modelos locales (otros módulos) la implementan y se registran
// con `registerProviderFactory` (ver registry.ts).
import type { AIProviderKind } from '@shared/settings/ai'
import type { JSONObject, JSONSchema } from '@shared/ai/json'
import type { ReasoningCapabilities } from '@shared/ai/reasoning'
import type { AgentEvent, AgentResult, ChatEvent, ChatMessage, ChatRequest, ChatResponse, ImagePart } from '@shared/ai/types'

export interface ModelCapabilities {
  /** Herramientas nativas (si no, el bucle usa el modo de texto). */
  tools: boolean
  vision: boolean
  streaming: boolean
  jsonMode: boolean
  /** Ventana de trabajo (tokens) que el bucle respeta al recortar el historial. */
  contextWindow: number
  maxOutputTokens?: number
  /** Niveles de razonamiento del modelo (null = no se puede elegir). */
  reasoning: ReasoningCapabilities | null
}

export interface CompleteOptions {
  /** Cancela la petición (la promesa se rechaza con un AIError de código 'cancelled' o con el motivo del aborto). */
  signal?: AbortSignal
  /** Cada fragmento a medida que llega: texto, razonamiento, llamadas a herramientas, uso y fin. */
  onDelta?: (event: ChatEvent) => void
}

/** Un modelo listo para usar (proveedor + modelo concretos). */
export interface ChatModel {
  /** Id del proveedor ('deepseek', 'anthropic', 'claude-cli'…). */
  readonly providerId: string
  /** Nombre visible del proveedor («DeepSeek»). */
  readonly providerName: string
  readonly kind: AIProviderKind
  /** Modelo que se envía a la API ('' = el predeterminado del proveedor o de la CLI). */
  readonly model: string
  readonly capabilities: ModelCapabilities
  /** Una petición completa (con streaming si el proveedor lo admite). */
  complete(request: ChatRequest, options?: CompleteOptions): Promise<ChatResponse>
  /** Opcional: el bucle recortó el historial (algunos proveedores dejan de reenviar el razonamiento firmado). */
  historyWasEdited?(toolUseIDs: string[], model: string): void
  /**
   * Opcional: agentes que llevan su propio bucle (las CLIs claude/codex/opencode, que reciben las herramientas por MCP).
   * Si existe, `runToolLoop` le delega la tarea entera.
   */
  runAgent?(task: AgentTaskSpec, options: { signal?: AbortSignal; onEvent?: (e: AgentEvent) => void }): Promise<AgentResult>
}

// MARK: Herramientas

export interface ToolOutput {
  text: string
  images?: ImagePart[]
  isError?: boolean
}

export interface ToolContext {
  /** Se aborta si se cancela o se agota el tiempo de la tarea: una herramienta larga debe mirarlo. */
  signal: AbortSignal
  /** Id de la llamada (para relacionar avisos). */
  callId: string
}

/**
 * Una herramienta que el agente puede usar. `inputSchema` es un JSON Schema `type: object`. `run` recibe los argumentos ya
 * leídos (reparados si el modelo escribió JSON imperfecto) y devuelve texto o un `ToolOutput`. Un error lanzado no rompe el
 * bucle: el modelo recibe «Error: …» y se corrige.
 */
export interface AgentTool<Args = JSONObject> {
  name: string
  description: string
  inputSchema: JSONSchema
  run(args: Args, ctx: ToolContext): Promise<string | ToolOutput> | string | ToolOutput
}

/** Lo que recibe un agente con bucle propio (`ChatModel.runAgent`). */
export interface AgentTaskSpec {
  system: string
  messages: ChatMessage[]
  /** El último mensaje del usuario como texto (las CLIs lo reciben por stdin). */
  prompt: string
  sharedContext?: string
  images?: ImagePart[]
  tools: AgentTool[]
  maxSteps: number
  timeoutSec: number
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: string
  /** Web PROPIA de la CLI (WebSearch/WebFetch de Claude, `web_search` de Codex, `webfetch` de OpenCode). Por defecto, no
   * (A2-P1-2): la web llega por las herramientas de Aula (`web_search`, `fetch_url`), que llevan sus puertas y sus tarjetas. */
  allowWeb?: boolean
}
