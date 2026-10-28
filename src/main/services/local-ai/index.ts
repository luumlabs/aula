// Modelos locales: API pública del dominio y el servicio compartido del proceso principal.
import { join } from 'node:path'
import { paths } from '../paths'
import type { FetchLike } from './downloader'
import { LocalAIService } from './service'

export * from './archive'
export * from './catalog'
export * from './downloader'
export * from './engine'
export * from './fit'
export * from './hardware'
export * from './loopback'
export * from './provider'
export * from './servers'
export * from './service'

let shared: LocalAIService | undefined
let sharedFetch: FetchLike | undefined

/** La red con la que descargar (el proceso principal pasa la de Electron, que respeta el proxy del sistema). Antes del primer uso. */
export function configureLocalAI(options: { fetch?: FetchLike }): void {
  sharedFetch = options.fetch
}

/** El servicio de modelos locales de la app: `<datos>/Models` (y los modelos de la app Swift en `<datos>/LocalAI`). */
export function localAI(): LocalAIService {
  if (!shared) shared = new LocalAIService({ root: paths.models(), legacyRoot: join(paths.root(), 'LocalAI'), fetch: sharedFetch })
  return shared
}
