// Cliente de la capa de IA para la interfaz (un solo sitio con los nombres de los métodos de IPC).
import type { AIProviderView, AIStatus, AITestResult, AICostsView } from '@shared/ai/views'
import type { AgentsDetection } from '@shared/agents'
import { api } from './api'

const invoke = api.invoke as unknown as (m: string, a?: unknown) => Promise<unknown>

export const aiClient = {
  status: () => invoke('ai.status') as Promise<AIStatus>,
  providers: () => invoke('ai.providers') as Promise<AIProviderView[]>,
  setKey: (providerId: string, key: string) => invoke('ai.setKey', { providerId, key }) as Promise<AIProviderView[]>,
  removeKey: (providerId: string) => invoke('ai.removeKey', { providerId }) as Promise<AIProviderView[]>,
  configure: (args: { providerId: string | null; model?: string; reasoning?: string; baseURL?: string; key?: string; activate?: boolean }) => invoke('ai.configure', args) as Promise<AIStatus>,
  models: (providerId: string) => invoke('ai.models', { providerId }) as Promise<unknown>,
  test: (providerId: string) => invoke('ai.test', { providerId }) as Promise<AITestResult>,
  costs: () => invoke('ai.costs') as Promise<AICostsView>,
  detect: (refresh = false) => api.invoke('agents.detect', { refresh }) as Promise<AgentsDetection>
}

/** Proveedor probable a partir del prefijo de una clave pegada (para no preguntar). */
export function guessProviderFromKey(key: string): string | null {
  const k = key.trim()
  if (k.startsWith('sk-ant-')) return 'anthropic'
  if (k.startsWith('sk-or-')) return 'openrouter'
  if (k.startsWith('gsk_')) return 'groq'
  if (k.startsWith('AIza')) return 'gemini'
  if (k.startsWith('xai-')) return 'xai'
  if (k.startsWith('sk-proj-') || k.startsWith('sk-svcacct-')) return 'openai'
  if (/^sk-[a-f0-9]{32}$/.test(k)) return 'deepseek'
  if (k.startsWith('sk-')) return 'openai'
  return null
}
