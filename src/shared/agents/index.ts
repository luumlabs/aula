// Tipos isomorfos de los agentes CLI (Claude Code, Codex, OpenCode) y de los modelos locales (Ollama, LM Studio, motor de Aula).
// Sin Node ni DOM: los usan el proceso principal y la interfaz (vía IPC).

/** CLIs de agente que Aula sabe usar con la suscripción del estudiante (sin clave de API). */
export type CLIAgentKind = 'claude' | 'codex' | 'opencode'

export const CLI_AGENT_KINDS: readonly CLIAgentKind[] = ['claude', 'codex', 'opencode']

/** Estado de una CLI en este ordenador. */
export interface CLIStatus {
  kind: CLIAgentKind
  /** ¿Se encontró un ejecutable utilizable? */
  installed: boolean
  path?: string
  version?: string
  /** `null` = no se pudo saber sin intervenir. */
  loggedIn: boolean | null
  /** Frase corta para la interfaz (en español; el código estable va en `kind`/`installed`/`loggedIn`). */
  detail: string
}

/** Motores de modelos locales. */
export type LocalEngineKind = 'aula' | 'ollama' | 'lmstudio' | 'llamacpp'

/** Un modelo que ya tiene un servidor local. */
export interface LocalServerModel {
  id: string
  label: string
  loaded?: boolean
  context?: number
  contextMax?: number
  tools?: boolean
  vision?: boolean
  thinking?: boolean
  parameters?: string
  quantization?: string
  sizeBytes?: number
  /** Modelo de chat (no de embeddings). */
  isChat: boolean
}

/** Lo que contestó un servidor local (compatible con OpenAI en `baseURL`). */
export interface LocalServerReport {
  kind: LocalEngineKind
  baseURL: string
  version?: string
  models: LocalServerModel[]
  /** El servidor pide una clave (LM Studio con autenticación). */
  needsKey: boolean
}

export interface GPUInfo {
  vendor: 'apple' | 'nvidia' | 'amd' | 'intel' | 'other'
  name: string
  /** Memoria propia de la GPU (gráfica dedicada). En Apple Silicon la memoria es unificada y no se pone aquí. */
  vramBytes?: number
}

/** Ficha del ordenador para mover un modelo local. */
export interface HardwareProfile {
  platform: string
  arch: string
  /** «Apple M4 Pro», «Intel Core i7-9750H», «AMD Ryzen 7 7840U». */
  chip: string
  isAppleSilicon: boolean
  performanceCores: number
  efficiencyCores: number
  logicalCores: number
  /** Núcleos de la GPU de Apple (IOKit `gpu-core-count`), si se sabe. */
  gpuCores?: number
  memoryBytes: number
  /** Lo que macOS deja usar a la GPU (si se sabe). */
  gpuWorkingSetBytes?: number
  freeDiskBytes?: number
  gpu?: GPUInfo
  osVersion: string
}

export interface HardwareSummary extends HardwareProfile {
  /** Memoria que el ordenador puede dedicar a un modelo. */
  budgetBytes: number
}

export type ModelCapability = 'tools' | 'thinking' | 'vision'

/** Forma de la caché KV: capas, cabezas K/V y su dimensión (las capas con ventana deslizante guardan pocos tokens). */
export interface KVShape {
  layers: number
  kvHeads: number
  headDim: number
  slidingLayers?: number
  slidingWindow?: number
}

export interface GGUFFileRef {
  path: string
  bytes: number
  sha256: string
}

/** Un archivo GGUF publicado en Hugging Face, con tamaño y SHA-256 exactos y la revisión (commit) fijada. */
export interface GGUFFile {
  repo: string
  path: string
  bytes: number
  sha256: string
  quantization: string
  visionProjector?: GGUFFileRef
  revision: string
}

/** Ficha de un modelo del catálogo. */
export interface ModelCard {
  id: string
  name: string
  publisher: string
  license?: string
  released?: string
  parametersB: number
  activeParametersB?: number
  contextLength: number
  capabilities: ModelCapability[]
  multilingual: boolean
  /** Frase corta (español). */
  blurb?: string
  /** La misma frase en inglés. */
  blurbEn?: string
  kv?: KVShape
  gguf?: GGUFFile
  ollamaTag?: string
  mlxRepo?: string
  downloads?: number
  likes?: number
  /** Orden de recomendación (menor = mejor para Aula). */
  rank?: number
}

export type FitLevel = 'tooBig' | 'tight' | 'works' | 'ideal'
export type FitReason =
  | 'comfortable'
  | 'fits'
  | 'shortContextOnly'
  | 'closeOtherApps'
  | 'slow'
  | 'needsMoreMemory'
  | 'intelCPU'
  | 'cpuOnly'

export interface FitEstimate {
  level: FitLevel
  reason: FitReason
  contextTokens: number
  memoryBytes: number
  budgetBytes: number
  tokensPerSecond?: number
  promptTokensPerSecond?: number
  diskOK: boolean
}

/** Un modelo descargado por Aula para su motor propio. */
export interface InstalledLocalModel {
  id: string
  /** Nombre que publica el motor (`--alias`). */
  alias: string
  card: ModelCard
  /** Ruta del GGUF relativa a la carpeta de modelos. */
  file: string
  projector?: string
  contextTokens: number
  installedAt: string
}

export interface LocalEngineStatus {
  installed: boolean
  build: string
  running?: { modelId: string; alias: string; port: number; contextTokens: number; baseURL: string }
}

export interface LocalCatalogEntry {
  card: ModelCard
  fit: FitEstimate
  installed: boolean
  downloading: boolean
  recommended: boolean
}

export interface LocalCatalog {
  hardware: HardwareSummary
  entries: LocalCatalogEntry[]
  /** Ids recomendados para este ordenador, en orden. */
  recommended: string[]
  engine: LocalEngineStatus
}

export type DownloadPhase = 'engine' | 'model' | 'verifying' | 'preparing'

export interface LocalProgressEvent {
  modelId: string
  phase: DownloadPhase
  state: 'running' | 'done' | 'error' | 'cancelled'
  bytesDone: number
  bytesTotal: number
  fraction: number
  currentFile?: string
  error?: string
}

/** ¿Hay Ollama o LM Studio instalados aunque no estén abiertos? */
export interface InstalledLocalApp {
  kind: 'ollama' | 'lmstudio'
  app?: string
  cli?: string
}

export interface AgentsDetection {
  clis: CLIStatus[]
  servers: LocalServerReport[]
  installedApps: InstalledLocalApp[]
  hardware: HardwareSummary
  recommendedModel?: { id: string; name: string; fit: FitEstimate }
  engine: LocalEngineStatus
  /** ¿La sesión de ChatGPT propia de Aula (CODEX_HOME de Aula) está iniciada? */
  codexManagedLoggedIn: boolean
}

/** Lo que va pasando al «Conectar con ChatGPT». */
export type CodexLoginEvent =
  | { type: 'downloading'; bytesDone: number; bytesTotal: number }
  | { type: 'waitingForBrowser'; url?: string }
  | { type: 'deviceCode'; url: string; code: string }
  | { type: 'finished' }

export interface CodexLoginResult {
  connected: boolean
  executable?: string
  /** La sesión quedó en la carpeta propia de Aula (no en ~/.codex). */
  managedHome: boolean
}
