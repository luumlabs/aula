// Tipos de los agentes CLI (port de AICore: AgentTask, AgentEvent, AgentResult, Usage, MCPServerSpec, ToolSpec, ToolOutput).
// La capa de proveedores de API (src/main/services/ai) tiene sus propios tipos; estos son el contrato mínimo que hablan los
// agentes CLI, el servidor/cliente MCP y el relevo de herramientas. Ver `provider.ts` para el adaptador hacia la app.
import type { CLIAgentKind } from '@shared/agents'

export type JSONObject = Record<string, unknown>

/** Imagen en base64 (`image/png`, `image/jpeg`, `image/webp`). */
export interface ImagePart {
  mediaType: string
  base64: string
}

/** Resultado de una herramienta. */
export interface ToolOutput {
  text: string
  images?: ImagePart[]
  isError?: boolean
}

/** Especificación de una herramienta (esquema JSON de entrada, `type: object`). */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: JSONObject
}

/** Contexto de ejecución de una herramienta: `signal` se aborta si el agente cancela la llamada o termina la ejecución. */
export interface ToolRunContext {
  signal: AbortSignal
  [key: string]: unknown
}

/**
 * Herramienta de Aula con la forma de la capa de IA (`{name, description, inputSchema, run(args, ctx)}`).
 * `run` puede devolver texto, un `ToolOutput` o cualquier valor (se serializa como JSON).
 */
export interface RelayableTool {
  name: string
  description: string
  inputSchema: JSONObject
  run(args: JSONObject, ctx: ToolRunContext): unknown
}

/** Quién atiende `tools/list` y `tools/call` (el servidor MCP, el relevo…). */
export interface ToolsProvider {
  list(): Promise<ToolSpec[]> | ToolSpec[]
  call(name: string, args: JSONObject, ctx: ToolRunContext): Promise<ToolOutput>
}

/** Cómo lanzar un servidor MCP por stdio. */
export interface MCPServerSpec {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** Tokens: `promptTokens` INCLUYE los leídos de caché (`cachedTokens`) y los escritos (`cacheWriteTokens`). */
export interface Usage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheWriteTokens: number
}

export function emptyUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens
  }
}

/** Una tarea para un agente CLI. */
export interface AgentTask {
  id?: string
  system: string
  prompt: string
  images?: ImagePart[]
  /** Herramientas en proceso: una CLI no puede usarlas (van por MCP); solo se avisa. */
  inProcessToolCount?: number
  /** Servidores MCP que debe conectar la CLI (el de Aula + los del usuario). */
  mcpServers?: MCPServerSpec[]
  /** Permitir que el agente busque/lea páginas web con sus herramientas propias. */
  allowWeb?: boolean
  model?: string
  maxSteps?: number
  /** Tiempo máximo (ms). */
  timeoutMs?: number
  workingDirectory?: string
  temperature?: number
  maxOutputTokens?: number
  /** Contexto compartido por muchas tareas (va delante del prompt en el mismo mensaje, para la caché). */
  sharedContext?: string
}

export const DEFAULT_MAX_STEPS = 40
export const DEFAULT_TIMEOUT_MS = 1_800_000

/** `sharedContext` con su separador final (una línea en blanco); vacío si no hay. */
export function sharedContextBlock(task: Pick<AgentTask, 'sharedContext' | 'prompt'>): string {
  const shared = task.sharedContext ?? ''
  if (!shared || !task.prompt) return shared
  if (shared.endsWith('\n\n')) return shared
  return shared + (shared.endsWith('\n') ? '\n' : '\n\n')
}

/** `sharedContext` y `prompt` en un solo texto (las CLIs reciben el mensaje entero por stdin). */
export function fullPrompt(task: Pick<AgentTask, 'sharedContext' | 'prompt'>): string {
  return sharedContextBlock(task) + task.prompt
}

export interface AgentResult {
  text: string
  steps: number
  usage: Usage
  /** 'stop' | 'length' | 'max_steps' */
  stopReason: string
  sessionID?: string
}

export type AgentEvent =
  | { type: 'started'; provider: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolStarted'; id: string; name: string; summary: string }
  | { type: 'toolFinished'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'notice'; text: string }
  | { type: 'finished'; result: AgentResult }

/** Configuración mínima de un agente CLI (la misma idea que `AIProviderConfig` de los ajustes). */
export interface CLIAgentConfig {
  id: string
  kind: CLIAgentKind
  displayName: string
  /** Modelo por defecto ('' = el de la CLI). */
  model: string
  /** Ruta propia del ejecutable (si no, se busca). */
  executablePath?: string
  /** Esfuerzo de razonamiento guardado ('auto' o vacío = el de la CLI). */
  reasoningEffort?: string
}

/** Un agente CLI. */
export interface AgentRunner {
  readonly config: CLIAgentConfig
  /** Ejecuta la tarea. Cancelar (`signal` o dejar de iterar) mata al proceso y a sus hijos y termina sin error. */
  run(task: AgentTask, signal?: AbortSignal): AsyncIterableIterator<AgentEvent>
}
