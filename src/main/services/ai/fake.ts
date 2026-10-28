// IA simulada para las pruebas de extremo a extremo y las demostraciones (`AULA_FAKE_AI=1`): responde al instante, sin red ni
// claves. Por defecto devuelve un texto fijo (o `{}` si se pide JSON); un módulo puede poner su propio guion con `setFakeAIScript`.
import { tr } from '@shared/ai/i18n'
import type { ChatEvent, ChatRequest, ChatResponse } from '@shared/ai/types'
import { emptyUsage, messageText } from '@shared/ai/types'
import { responseFromEvents } from './core/toolCalls'
import { cancelledError } from './errors'
import type { ChatModel, CompleteOptions } from './model'

/** Lo que responde la IA simulada a una petición (texto o eventos completos). */
export type FakeAIScript = (request: ChatRequest) => string | ChatEvent[]

const defaultScript: FakeAIScript = (request) => (request.jsonMode ? '{}' : tr('Respuesta simulada de Aula.', 'Simulated reply from Aula.'))
let script: FakeAIScript = defaultScript

export function setFakeAIScript(fn: FakeAIScript | null): void {
  script = fn ?? defaultScript
}

/** ¿Hay un guion propio (pruebas)? Entonces manda él, también sobre las respuestas simuladas de cada módulo. */
export function hasFakeAIScript(): boolean {
  return script !== defaultScript
}

export const FAKE_PROVIDER_ID = 'fake'

/** Cómo se presenta: en el modo demostración (`AULA_DEMO=1`, capturas y vídeo) como Claude, que es lo que vería quien lo usa;
 * en las pruebas, como lo que es, en el idioma de la interfaz. */
function fakeIdentity(): { providerName: string; model: string } {
  if (process.env.AULA_DEMO) return { providerName: 'Claude', model: '' }
  return { providerName: tr('IA simulada', 'Simulated AI'), model: 'aula-fake' }
}

export function createFakeModel(): ChatModel {
  return {
    providerId: FAKE_PROVIDER_ID,
    ...fakeIdentity(),
    kind: 'openai-compatible',
    capabilities: { tools: true, vision: true, streaming: true, jsonMode: true, contextWindow: 100_000, reasoning: null },
    async complete(request: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> {
      if (opts.signal?.aborted) throw cancelledError()
      const out = script(request)
      const events: ChatEvent[] = typeof out === 'string'
        ? [{ type: 'text', text: out }, { type: 'usage', usage: { ...emptyUsage(), promptTokens: request.messages.map(messageText).join('').length, completionTokens: out.length } },
            { type: 'finished', finish: 'stop' }]
        : out
      for (const e of events) opts.onDelta?.(e)
      return responseFromEvents(events)
    }
  }
}
