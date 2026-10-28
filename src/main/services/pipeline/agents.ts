// Quién entrega los agentes de la tubería (la idea de `AgentProvisioning` de Swift). La app usa el modelo activo con el bucle de
// herramientas de la capa de IA (los agentes CLI lo llevan dentro y reciben las herramientas por el relevo MCP); las pruebas, un
// guion que llama a las herramientas reales.
import type { AgentEvent, AgentResult } from '@shared/ai/types'
import type { PipelineRole } from '@engine/pipeline'
import { tr } from '@shared/ai/i18n'
import { AIError, costMeter, runToolLoop, type AgentTool, type ChatModel } from '../ai'
import { isMetered } from '../costs'

/** Una tarea para un agente. */
export interface AgentTask {
  role: PipelineRole
  system: string
  prompt: string
  /** Contexto que comparten muchas tareas (va delante, para la caché de prompts). */
  sharedContext?: string
  tools: AgentTool[]
  maxSteps: number
  timeoutSec: number
  signal: AbortSignal
  onEvent(e: AgentEvent): void
}

export interface PipelineAgents {
  /** «Claude Code · sonnet» (lo que se ve en el monitor). */
  provider(): string
  /** Tope de agentes a la vez que aguanta el proveedor (p. ej. un modelo local). */
  readonly maxConcurrency?: number
  run(task: AgentTask): Promise<AgentResult>
  /** ¿Se llegó al tope de gasto de hoy? Lanza `BudgetError` (se mira entre etapas). */
  checkBudget?(): void
}

const LOCAL_KINDS = new Set(['ollama', 'lmstudio', 'aula-local'])

/** Los agentes con un modelo de la capa de IA. */
export function modelAgents(model: ChatModel): PipelineAgents {
  return {
    provider: () => `${model.providerName} · ${model.model || tr('modelo predeterminado', 'default model')}`,
    // un modelo en este equipo no aguanta muchos agentes a la vez
    maxConcurrency: LOCAL_KINDS.has(model.kind) ? 2 : undefined,
    async run(task) {
      const result = await runToolLoop({
        model, system: task.system, prompt: task.prompt, sharedContext: task.sharedContext || undefined, tools: task.tools, maxSteps: task.maxSteps,
        timeoutSec: task.timeoutSec, signal: task.signal, onEvent: task.onEvent
      })
      if (task.signal.aborted || result.stopReason === 'cancelled') throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
      return result
    },
    checkBudget() {
      // solo si la IA está medida y cobra por uso (un proveedor gratis nunca se para)
      if (!isMetered(model)) return
      costMeter().checkBudget({ id: model.providerId, kind: model.kind, label: model.providerName, model: model.model }, model.model)
    }
  }
}

/** Un guion de prueba: «actúa» llamando a las herramientas reales con contenido preparado (como `FakeAgents` de Swift). */
export type AgentScript = (task: AgentTask, call: (name: string, args: unknown) => Promise<unknown>) => Promise<string>

/** Agentes de prueba: cada tarea la resuelve `script` llamando a las herramientas que recibió. */
export function scriptedAgents(script: AgentScript, opts: { provider?: string; usage?: { promptTokens: number; completionTokens: number } } = {}): PipelineAgents {
  return {
    provider: () => opts.provider ?? 'Falso · fake-1',
    async run(task) {
      task.onEvent({ type: 'started', provider: 'Falso', model: 'fake-1' })
      let steps = 0
      const call = async (name: string, args: unknown): Promise<unknown> => {
        if (task.signal.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
        const tool = task.tools.find((t) => t.name === name)
        if (!tool) throw new Error(`tool ${name} not offered`)
        const id = `call-${++steps}`
        task.onEvent({ type: 'toolStarted', id, name, summary: `${name} ${JSON.stringify(args).slice(0, 60)}` })
        const out = await tool.run(args as never, { signal: task.signal, callId: id })
        const o = typeof out === 'string' ? { text: out } : out
        task.onEvent({ type: 'toolFinished', id, name, ok: !o.isError, summary: o.text.slice(0, 80) })
        try { return JSON.parse(o.text) } catch { return o.text }
      }
      const text = await script(task, call)
      if (task.signal.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
      task.onEvent({ type: 'text', text })
      const usage = { promptTokens: opts.usage?.promptTokens ?? 1000, completionTokens: opts.usage?.completionTokens ?? 200, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
      const result: AgentResult = { text, steps, usage, stopReason: 'stop' }
      task.onEvent({ type: 'usage', usage })
      task.onEvent({ type: 'finished', result })
      return result
    }
  }
}
