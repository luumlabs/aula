// IPC de los agentes CLI y los modelos locales (dominio «agents»). La lógica vive en `@main/services/agents` y
// `@main/services/local-ai`; aquí se validan los argumentos, se registran los proveedores en la capa de IA, se avisa del
// progreso y se apaga todo al salir.
import { app, net } from 'electron'
import { AulaError, invalidArgs } from '@main/services/errors'
import { log } from '@main/services/log'
import { agentsService, configureAgents, killAllLive, modelIdArg } from '@main/services/agents'
import { configureLocalAI, localAI, registerLocalProviders, type FetchLike } from '@main/services/local-ai'
import { invalidateAvailability, registerProviderFactory } from '@main/services/ai/registry'
import { emit, handle } from '../rpc'
import { tr } from '@shared/ai/i18n'

function flagArg(args: unknown, key: string): boolean {
  return typeof args === 'object' && args !== null && (args as Record<string, unknown>)[key] === true
}

function contextArg(args: unknown): number | undefined {
  const raw = typeof args === 'object' && args !== null ? (args as { contextTokens?: unknown }).contextTokens : undefined
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 2048 || raw > 1_048_576) throw invalidArgs(tr('Contexto no válido', 'Invalid context size'))
  return raw
}

export function register(): void {
  // la red de Electron respeta el proxy y los certificados del sistema
  const fetchImpl: FetchLike = (input, init) => net.fetch(input, init)
  configureLocalAI({ fetch: fetchImpl })
  configureAgents({ fetch: fetchImpl })
  const local = localAI()
  const agents = agentsService()

  // los agentes CLI los registra el dominio «ai» (`registerCLIProviders`); el motor de Aula, aquí
  registerLocalProviders(registerProviderFactory, local)
  local.onProgress((event) => emit('local.progress', event))

  const changed = (): void => {
    agents.invalidate()
    invalidateAvailability()
  }

  handle('agents.detect', (args) => agents.detect(flagArg(args, 'refresh')))
  handle('agents.codexLogin', async (args) => {
    const result = await agents.connectChatGPT({ deviceAuth: flagArg(args, 'deviceAuth'), onEvent: (event) => emit('agents.codexLogin', event) })
    changed()
    return result
  })
  handle('agents.codexLoginCancel', () => agents.cancelChatGPTLogin())
  handle('agents.codexLogout', async () => {
    await agents.logoutChatGPT()
    changed()
  })

  handle('local.catalog', () => local.localCatalog())
  handle('local.download', async (args) => {
    const model = await local.download(modelIdArg(args))
    changed()
    return model
  })
  handle('local.cancel', (args) => local.cancel(modelIdArg(args)))
  handle('local.delete', (args) => {
    local.delete(modelIdArg(args))
    changed()
  })
  handle('local.start', async (args) => {
    const id = modelIdArg(args)
    if (!local.installedModel(id)) throw new AulaError('not_found', tr('Ese modelo no está descargado.', 'That model isn’t downloaded.'))
    await local.ensureServer(id, contextArg(args))
    return local.engineStatus()
  })
  handle('local.stop', () => local.stopEngine())

  // al salir: descargas canceladas (lo bajado se queda), motor apagado y ningún agente huérfano
  app.on('will-quit', () => {
    try {
      local.shutdown()
      killAllLive()
    } catch (err) {
      log.warn('[agents] apagado', err)
    }
  })
}
