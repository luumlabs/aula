// El enganche de los costes con la IA (port de MeteredAI.swift): un `ChatModel` envuelto pide paso al tope antes de cada llamada,
// suma lo que informa el proveedor, corta la llamada si se pasa del tope y la deja apuntada con su curso y su uso (también si
// falla o se cancela). El curso y el uso salen de `withAIUse(…)` (si no hay, se apunta como «Otros»).
//
// Diferencia con Swift: si la respuesta YA terminó cuando el uso final pasa del tope, se entrega (el dinero ya se gastó); la
// puerta para la llamada siguiente.
import type { AgentEvent, AgentResult, ChatEvent, ChatRequest, ChatResponse, Usage } from '@shared/ai/types'
import { emptyUsage, usageTotal } from '@shared/ai/types'
import type { AgentTaskSpec, ChatModel, CompleteOptions } from '../ai/model'
import { isCancellation } from '../ai/errors'
import type { CostOutcome } from './ledger'
import { BudgetError, type CostMeter } from './meter'
import type { BillingProvider } from './priceBook'
import { currentAIUse } from './scope'

const METERED = Symbol.for('aula.metered')

/** ¿Ya está envuelto? (no se cuenta dos veces). */
export function isMetered(model: ChatModel): boolean {
  return (model as unknown as Record<symbol, unknown>)[METERED] === true
}

function outcomeOf(err: unknown, signal: AbortSignal | undefined): CostOutcome {
  if (err instanceof BudgetError) return 'cut'
  return isCancellation(err) || signal?.aborted ? 'cancelled' : 'failed'
}

/** Un AbortController enlazado con el de quien llama. */
function linked(parent: AbortSignal | undefined): { ctl: AbortController; dispose: () => void } {
  const ctl = new AbortController()
  if (!parent) return { ctl, dispose: () => {} }
  if (parent.aborted) ctl.abort(parent.reason)
  const onAbort = () => ctl.abort(parent.reason)
  parent.addEventListener('abort', onAbort, { once: true })
  return { ctl, dispose: () => parent.removeEventListener('abort', onAbort) }
}

/**
 * Envuelve un modelo para que cada llamada pase por el tope y quede apuntada. `provider` describe cómo cobra (id, tipo, URL);
 * `meter` puede ser una función para leer siempre el contador actual.
 */
export function meteredModel(inner: ChatModel, provider: BillingProvider, meter: CostMeter | (() => CostMeter)): ChatModel {
  if (isMetered(inner)) return inner
  const getMeter = typeof meter === 'function' ? meter : () => meter
  const billing = (model: string): BillingProvider => ({ ...provider, label: provider.label ?? inner.providerName, model })

  const complete = async (request: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> => {
    const model = request.model || inner.model
    const ticket = getMeter().begin(billing(model), model, currentAIUse())
    const { ctl, dispose } = linked(opts.signal)
    let usage: Usage = emptyUsage()
    let cut: BudgetError | undefined
    const onDelta = (e: ChatEvent) => {
      if (e.type === 'usage') {
        usage = e.usage
        const over = ticket.update(e.usage, e.usage.promptTokens)
        if (over && !cut) {
          cut = over
          ctl.abort(over)
        }
      }
      opts.onDelta?.(e)
    }
    try {
      const res = await inner.complete(request, { signal: ctl.signal, onDelta })
      if (usageTotal(res.usage) >= usageTotal(usage)) usage = res.usage
      ticket.finish(usage, 'ok', usage.promptTokens)
      return res
    } catch (err) {
      const error = cut ?? err
      ticket.finish(usage, outcomeOf(error, opts.signal), usage.promptTokens)
      throw error
    } finally {
      dispose()
    }
  }

  const runAgent = inner.runAgent
    ? async (task: AgentTaskSpec, opts: { signal?: AbortSignal; onEvent?: (e: AgentEvent) => void }): Promise<AgentResult> => {
      const model = inner.model
      const ticket = getMeter().begin(billing(model), model, currentAIUse())
      const { ctl, dispose } = linked(opts.signal)
      let usage: Usage = emptyUsage()
      let cut: BudgetError | undefined
      const onEvent = (e: AgentEvent) => {
        // las CLIs informan el uso ACUMULADO
        const u = e.type === 'usage' ? e.usage : e.type === 'finished' ? e.result.usage : undefined
        if (u && usageTotal(u) >= usageTotal(usage)) {
          usage = u
          if (e.type === 'usage') {
            const over = ticket.update(u)
            if (over && !cut) {
              cut = over
              ctl.abort(over)
            }
          }
        }
        opts.onEvent?.(e)
      }
      try {
        const result = await inner.runAgent!(task, { signal: ctl.signal, onEvent })
        if (usageTotal(result.usage) >= usageTotal(usage)) usage = result.usage
        if (cut) throw cut
        ticket.finish(usage, result.stopReason === 'cancelled' ? 'cancelled' : 'ok')
        return result
      } catch (err) {
        const error = cut ?? err
        ticket.finish(usage, outcomeOf(error, opts.signal))
        throw error
      } finally {
        dispose()
      }
    }
    : undefined

  const wrapped: ChatModel = {
    get providerId() {
      return inner.providerId
    },
    get providerName() {
      return inner.providerName
    },
    get kind() {
      return inner.kind
    },
    get model() {
      return inner.model
    },
    get capabilities() {
      return inner.capabilities
    },
    complete,
    ...(inner.historyWasEdited ? { historyWasEdited: (ids: string[], m: string) => inner.historyWasEdited!(ids, m) } : {}),
    ...(runAgent ? { runAgent } : {})
  }
  Object.defineProperty(wrapped, METERED, { value: true })
  return wrapped
}
