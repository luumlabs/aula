// IPC de la capa de IA. La lógica vive en src/main/services/ai/service.ts (sin Electron, con pruebas); aquí solo se conecta.
import { app } from 'electron'
import { handle, emit } from '../rpc'
import { onSettingsChange } from '@main/services/settings'
import { invalidArgs } from '@main/services/errors'
import { log } from '@main/services/log'
import {
  aiCosts, aiProviderViews, aiStatus, ChatStreams, configureAI, createFakeModel, invalidateAvailability, providerModels, registerProviderFactory,
  removeProviderKey, setModelOverride, setProviderKey, testProvider
} from '@main/services/ai'
import { costMeter } from '@main/services/costs'
import { registerCLIProviders } from '@main/services/agents/provider'

function refreshArg(args: unknown): boolean {
  return !!args && typeof args === 'object' && (args as { refresh?: unknown }).refresh === true
}

export function register(): void {
  // pruebas de extremo a extremo y demostraciones: IA simulada, sin red ni claves
  if (process.env.AULA_FAKE_AI === '1') setModelOverride(createFakeModel)
  // los agentes CLI (claude, codex, opencode) se usan a través del registro de proveedores
  try {
    registerCLIProviders(registerProviderFactory)
  } catch (err) {
    log.warn('IA: no se pudieron registrar los agentes CLI', err)
  }

  const streams = new ChatStreams()
  const changed = (reason: 'configure' | 'key' | 'settings') => emit('ai.changed', { reason })

  handle('ai.status', (args) => aiStatus({ refresh: refreshArg(args) }))
  handle('ai.providers', (args) => aiProviderViews({ refresh: refreshArg(args) }))
  handle('ai.setKey', async (args) => {
    if (!args || typeof args !== 'object') throw invalidArgs('Argumentos no válidos')
    const list = await setProviderKey(args.providerId, args.key)
    changed('key')
    return list
  })
  handle('ai.removeKey', async (args) => {
    if (!args || typeof args !== 'object') throw invalidArgs('Argumentos no válidos')
    const list = await removeProviderKey(args.providerId)
    changed('key')
    return list
  })
  // `ai.configure` cambia los ajustes: el aviso 'ai.changed' sale de `onSettingsChange`
  handle('ai.configure', (args) => configureAI(args))
  handle('ai.models', (args) => {
    if (!args || typeof args !== 'object') throw invalidArgs('Argumentos no válidos')
    return providerModels(args.providerId, args.refresh === true)
  })
  handle('ai.test', (args) => {
    if (!args || typeof args !== 'object') throw invalidArgs('Argumentos no válidos')
    return testProvider(args.providerId)
  })
  handle('ai.costs', () => aiCosts())
  handle('ai.chatStream', (args) => streams.start(args, {
    delta: (d) => emit('ai.delta', d),
    done: (d) => emit('ai.done', d),
    error: (e) => emit('ai.error', e)
  }))
  handle('ai.cancel', (args) => ({ cancelled: streams.cancel(args && typeof args === 'object' ? args.requestId : undefined) }))

  onSettingsChange((next, prev) => {
    if (JSON.stringify(next.ai) !== JSON.stringify(prev.ai)) {
      invalidateAvailability()
      changed('settings')
    }
  })

  app.on('before-quit', () => {
    streams.cancelAll()
    costMeter().ledger.flush()
  })
}
