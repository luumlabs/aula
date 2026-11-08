// IPC de la capa de IA. La lógica vive en src/main/services/ai/service.ts (sin Electron, con pruebas); aquí solo se conecta.
import { app, BrowserWindow, dialog } from 'electron'
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
import { installAIConsentPrompt } from '@main/services/ai/consent'
import { tr } from '@shared/ai/i18n'

function refreshArg(args: unknown): boolean {
  return !!args && typeof args === 'object' && (args as { refresh?: unknown }).refresh === true
}

export function register(): void {
  if (process.mas === true) installAIConsentPrompt(async ({ provider, origin }) => {
    const window = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.isVisible())
    // A background task cannot grant permission on the student's behalf.
    if (!window) return false
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: tr('Compartir con IA', 'Share with AI'),
      message: tr(`¿Permites compartir información con ${provider}?`, `Allow sharing information with ${provider}?`),
      detail: tr(
        `Destino: ${origin}\n\nAula puede enviar tus preguntas, materiales, progreso y comunicaciones de plataformas educativas para ayudarte. Este proveedor puede enviar información a otros servicios; se aplican sus propias políticas.\n\nEl permiso dura hasta que cierres Aula. Puedes retirarlo en Ajustes → Privacidad y datos.`,
        `Destination: ${origin}\n\nAula may send your questions, materials, progress and learning-platform communications to help you. This provider may share information with other services; its own policies apply.\n\nPermission lasts until you quit Aula. You can revoke it in Settings → Privacy and data.`
      ),
      buttons: [tr('Ahora no', 'Not now'), tr('Permitir durante esta sesión', 'Allow for this session')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return answer.response === 1
  })
  // pruebas de extremo a extremo y demostraciones: IA simulada, sin red ni claves
  if (process.env.AULA_FAKE_AI === '1') setModelOverride(createFakeModel)
  // los agentes CLI (claude, codex, opencode) se usan a través del registro de proveedores
  try {
    if (process.mas !== true) registerCLIProviders(registerProviderFactory)
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
