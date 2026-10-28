// Contrato IPC de los agentes CLI y los modelos locales.
import type {
  AgentsDetection,
  CodexLoginEvent,
  CodexLoginResult,
  InstalledLocalModel,
  LocalCatalog,
  LocalEngineStatus,
  LocalProgressEvent
} from '../agents'

declare module './contract' {
  interface RpcMethods {
    /** CLIs instaladas y con sesión, Ollama/LM Studio en marcha, ficha del ordenador y modelo local recomendado. */
    'agents.detect': { args: { refresh?: boolean } | void; result: AgentsDetection }
    /** «Conectar con ChatGPT»: lanza `codex login` (la página se abre en el navegador). Termina al iniciar sesión. */
    'agents.codexLogin': { args: { deviceAuth?: boolean } | void; result: CodexLoginResult }
    'agents.codexLoginCancel': { args: void; result: void }
    /** Cierra solo la sesión de ChatGPT propia de Aula. */
    'agents.codexLogout': { args: void; result: void }
    'local.catalog': { args: void; result: LocalCatalog }
    /** Descarga (motor si falta + modelo, verificado). El progreso llega por 'local.progress'. */
    'local.download': { args: { modelId: string }; result: InstalledLocalModel }
    'local.cancel': { args: { modelId: string }; result: void }
    'local.delete': { args: { modelId: string }; result: void }
    'local.start': { args: { modelId: string; contextTokens?: number }; result: LocalEngineStatus }
    'local.stop': { args: void; result: void }
  }
  interface RpcEvents {
    'local.progress': LocalProgressEvent
    'agents.codexLogin': CodexLoginEvent
  }
}
export {}
