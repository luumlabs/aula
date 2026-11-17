// A quién mandaría Aula los datos: la IA activa y la que transcribe, unidas por empresa.
import { describe, expect, it } from 'vitest'
import type { AIStatus } from '@shared/ai/views'
import { currentAIRecipients, type RecipientDeps } from './recipients'
import type { ProviderEntry } from './registry'

const entry = (id: string, kind: ProviderEntry['kind'], baseURL?: string, presetBaseURL?: string): ProviderEntry =>
  ({ id, kind, label: id, provider: { baseURL }, preset: presetBaseURL ? { baseURL: presetBaseURL } : undefined }) as unknown as ProviderEntry

const ENTRIES: Record<string, ProviderEntry> = {
  'claude-cli': entry('claude-cli', 'claude-cli'),
  openai: entry('openai', 'openai-compatible', 'https://api.openai.com/v1', 'https://api.openai.com/v1'),
  ollama: entry('ollama', 'ollama', 'http://localhost:11434/v1', 'http://localhost:11434/v1')
}

const ready = (providerId: string, kind: ProviderEntry['kind']): AIStatus => ({ activeProvider: null, auto: true, ready: true, resolved: { providerId, label: providerId, kind, model: 'm' } })

function deps(over: Partial<RecipientDeps>): RecipientDeps {
  return { status: async () => ready('claude-cli', 'claude-cli'), entry: (id) => ENTRIES[id], transcriptionId: () => undefined, simulated: () => false, ...over }
}

describe('currentAIRecipients', () => {
  it('con la IA simulada, nadie', async () => {
    expect(await currentAIRecipients(deps({ simulated: () => true, transcriptionId: () => 'openai' }))).toEqual([])
  })

  it('sin IA lista, solo quien transcribe (si hay)', async () => {
    const off: AIStatus = { activeProvider: null, auto: true, ready: false, resolved: null }
    expect(await currentAIRecipients(deps({ status: async () => off }))).toEqual([])
    expect((await currentAIRecipients(deps({ status: async () => off, transcriptionId: () => 'openai' }))).map((r) => r.id)).toEqual(['openai'])
  })

  it('Claude responde y OpenAI transcribe: dos empresas', async () => {
    expect(await currentAIRecipients(deps({ transcriptionId: () => 'openai' }))).toEqual([
      { id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] },
      { id: 'openai', name: 'OpenAI', uses: ['recordings'] }
    ])
  })

  it('OpenAI responde y transcribe: una, con los dos usos', async () => {
    expect(await currentAIRecipients(deps({ status: async () => ready('openai', 'openai-compatible'), transcriptionId: () => 'openai' }))).toEqual([
      { id: 'openai', name: 'OpenAI', uses: ['answers', 'recordings'] }
    ])
  })

  it('OpenCode con un modelo de Anthropic: Anthropic, no OpenCode', async () => {
    const opencode: AIStatus = { activeProvider: null, auto: false, ready: true, resolved: { providerId: 'opencode-cli', label: 'OpenCode', kind: 'opencode-cli', model: 'anthropic/claude-sonnet-5-5' } }
    expect(await currentAIRecipients(deps({ status: async () => opencode, entry: () => undefined }))).toEqual([{ id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] }])
  })

  it('Ollama en este ordenador y sin transcripción: nadie', async () => {
    expect(await currentAIRecipients(deps({ status: async () => ready('ollama', 'ollama') }))).toEqual([])
  })
})
