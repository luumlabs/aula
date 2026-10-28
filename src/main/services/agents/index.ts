// Agentes CLI (Claude Code, Codex, OpenCode), relevo de herramientas y preguntas: API pública y el servicio compartido.
import { paths } from '../paths'
import { localAI } from '../local-ai'
import type { FetchLike } from '../local-ai/downloader'
import { ManagedCodex } from './codex-installer'
import { QuestionBroker } from './questions'
import { AgentsService } from './service'

export * from './catalogs'
export * from './child-process'
export * from './claude'
export * from './codex'
export * from './codex-account'
export * from './codex-installer'
export * from './engine'
export * from './errors'
export * from './locator'
export * from './mcp-config'
export * from './opencode'
export * from './probe'
export * from './provider'
export * from './questions'
export * from './relay'
export * from './sandbox'
export * from './service'
export * from './types'

let shared: AgentsService | undefined
let sharedFetch: FetchLike | undefined
let broker: QuestionBroker | undefined

export function configureAgents(options: { fetch?: FetchLike }): void {
  sharedFetch = options.fetch
}

/** El servicio de agentes de la app (detección, «Conectar con ChatGPT»). */
export function agentsService(): AgentsService {
  if (!shared) shared = new AgentsService({ local: localAI(), codex: new ManagedCodex({ root: paths.root(), fetch: sharedFetch }) })
  return shared
}

/** El canal de preguntas de la IA al estudiante (`ask_user`), compartido por proveedores de API y agentes CLI. */
export function questionBroker(): QuestionBroker {
  if (!broker) broker = new QuestionBroker()
  return broker
}
