// Todo lo de los modelos locales de Aula: ficha del ordenador, catálogo con su encaje, descargas verificadas (motor + modelo),
// registro de lo descargado, motor propio (llama.cpp) con apagado por inactividad y Ollama / LM Studio si ya están
// (port de `LocalAIKit/Manager/LocalModelService.swift`).
//
// Carpeta (`root`, normalmente `<datos>/Models`):
//   engine/…                       motor descargado (ver engine.ts)
//   <alias>/<archivo>.gguf         modelos (+ «.<archivo>.sha256» al terminar de comprobarlos)
//   installed.json                 qué hay descargado y con qué contexto (mismo formato que `LocalAI/installed.json` de Swift)
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tr } from '@shared/ai/i18n'
import type {
  DownloadPhase,
  FitEstimate,
  HardwareProfile,
  HardwareSummary,
  InstalledLocalModel,
  LocalCatalog,
  LocalCatalogEntry,
  LocalEngineStatus,
  LocalProgressEvent,
  LocalServerReport,
  ModelCard
} from '@shared/agents'
import { AulaError } from '../errors'
import { readJSON, writeJSONAtomic } from '../fs'
import { log } from '../log'
import { CancelledError, isCancellation } from '../agents/errors'
import { BUILTIN_CATALOG, catalogCard, ggufFileName, hubDownloadURL, modelAlias } from './catalog'
import { Downloader, DownloadError, progressFraction, type FetchLike, type FileDownload, type TransferProgress } from './downloader'
import { AulaEngine, type RunningServer } from './engine'
import { DEFAULT_FIT_POLICY, F16_FIT_POLICY, estimateFit, fitBudget, recommendedModels } from './fit'
import { probeHardware } from './hardware'
import { DEFAULT_ORIGINS, detectLocalServers, type ServerOrigins } from './servers'

export interface LocalAIServiceOptions {
  /** Carpeta de los modelos (`<datos>/Models`). */
  root: string
  /** Carpeta de la app Swift (`<datos>/LocalAI`): sus modelos ya descargados se traen sin volver a bajarlos. */
  legacyRoot?: string
  catalog?: ModelCard[]
  engine?: AulaEngine
  downloader?: Downloader
  fetch?: FetchLike
  hardware?: () => Promise<HardwareProfile>
  serverOrigins?: ServerOrigins
  /** Minutos sin uso tras los que se apaga el motor (libera la memoria del modelo). */
  idleShutdownMs?: number
  hub?: string
}

export type ProgressListener = (event: LocalProgressEvent) => void

export class LocalAIService {
  readonly root: string
  readonly engine: AulaEngine
  readonly catalog: ModelCard[]
  private readonly legacyRoot?: string
  private readonly downloader: Downloader
  private readonly hardwareProbe: () => Promise<HardwareProfile>
  private readonly serverOrigins: ServerOrigins
  private readonly hub: string
  idleShutdownMs: number
  private readonly downloads = new Map<string, { controller: AbortController; promise: Promise<InstalledLocalModel> }>()
  private readonly listeners = new Set<ProgressListener>()
  private startTask?: { key: string; promise: Promise<RunningServer> }
  private activeUses = 0
  private lastUse = Date.now()
  private idleTimer?: NodeJS.Timeout
  private migrated = false

  constructor(options: LocalAIServiceOptions) {
    this.root = options.root
    this.legacyRoot = options.legacyRoot
    this.catalog = options.catalog ?? BUILTIN_CATALOG
    this.downloader = options.downloader ?? new Downloader({ fetch: options.fetch })
    this.hardwareProbe = options.hardware ?? (() => probeHardware(this.root))
    this.engine = options.engine ?? new AulaEngine({ folder: join(this.root, 'engine'), fetch: options.fetch, hardware: () => this.hardwareProbe() })
    this.serverOrigins = options.serverOrigins ?? DEFAULT_ORIGINS
    this.idleShutdownMs = options.idleShutdownMs ?? 10 * 60_000
    this.hub = options.hub ?? 'https://huggingface.co'
  }

  get registryFile(): string {
    return join(this.root, 'installed.json')
  }

  /** Avisos de progreso de las descargas. Devuelve la función para dejar de escuchar. */
  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: LocalProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        log.warn('[local-ai] aviso de progreso', err)
      }
    }
  }

  // MARK: Ordenador

  async hardware(): Promise<HardwareSummary> {
    const hw = await this.hardwareProbe()
    return { ...hw, budgetBytes: fitBudget(hw) }
  }

  estimate(card: ModelCard, hw: HardwareProfile, engine: 'aula' | 'other' = 'aula'): FitEstimate {
    return estimateFit(card, hw, engine === 'aula' ? DEFAULT_FIT_POLICY : F16_FIT_POLICY)
  }

  // MARK: Registro

  /** Lo descargado (un registro sin su archivo no cuenta: lo borraron a mano). */
  installed(): InstalledLocalModel[] {
    this.migrateLegacy()
    const list = readJSON<unknown>(this.registryFile)
    if (!Array.isArray(list)) return []
    return list.filter((m): m is InstalledLocalModel => isInstalledModel(m) && existsSync(join(this.root, ...m.file.split('/'))))
  }

  private saveRegistry(list: InstalledLocalModel[]): void {
    mkdirSync(this.root, { recursive: true })
    writeJSONAtomic(this.registryFile, [...list].sort((a, b) => (a.installedAt < b.installedAt ? -1 : a.installedAt > b.installedAt ? 1 : 0)))
  }

  installedModel(idOrAlias: string): InstalledLocalModel | undefined {
    return this.installed().find((m) => m.alias === idOrAlias || m.id === idOrAlias)
  }

  /** Trae una vez los modelos de la app Swift (`<datos>/LocalAI/models/<alias>`) a la carpeta nueva (mismo disco: renombrar). */
  private migrateLegacy(): void {
    if (this.migrated || !this.legacyRoot) return
    this.migrated = true
    const legacyRegistry = readJSON<unknown>(join(this.legacyRoot, 'installed.json'))
    if (!Array.isArray(legacyRegistry) || legacyRegistry.length === 0) return
    try {
      const current = (readJSON<unknown[]>(this.registryFile) ?? []).filter(isInstalledModel)
      const known = new Set(current.map((m) => m.alias))
      let changed = false
      for (const m of legacyRegistry.filter(isInstalledModel)) {
        if (known.has(m.alias)) continue
        const from = join(this.legacyRoot, 'models', m.alias)
        const to = join(this.root, m.alias)
        if (!existsSync(join(this.legacyRoot, 'models', ...m.file.split('/')))) continue
        mkdirSync(this.root, { recursive: true })
        if (!existsSync(to)) renameSync(from, to)
        current.push(m)
        changed = true
      }
      if (changed) this.saveRegistry(current)
    } catch (err) {
      log.warn('[local-ai] no pude traer los modelos de la versión anterior', err)
    }
  }

  // MARK: Catálogo

  async localCatalog(): Promise<LocalCatalog> {
    const hardware = await this.hardware()
    const installed = new Set(this.installed().map((m) => m.id))
    const recommended = recommendedModels(this.catalog, hardware).map((c) => c.id)
    const entries: LocalCatalogEntry[] = this.catalog.map((card) => ({
      card,
      fit: this.estimate(card, hardware),
      installed: installed.has(card.id),
      downloading: this.downloads.has(card.id),
      recommended: recommended.includes(card.id)
    }))
    return { hardware, entries, recommended, engine: this.engineStatus() }
  }

  engineStatus(): LocalEngineStatus {
    const running = this.engine.running
    return {
      installed: this.engine.isInstalled,
      build: this.engine.build,
      ...(running ? { running: { modelId: running.modelId, alias: running.alias, port: running.port, contextTokens: running.contextTokens, baseURL: running.baseURL } } : {})
    }
  }

  // MARK: Descargas

  /** Descarga un modelo (y el motor si falta), lo comprueba y lo registra. Dos llamadas para el mismo modelo comparten descarga. */
  download(modelId: string): Promise<InstalledLocalModel> {
    const existing = this.downloads.get(modelId)
    if (existing) return existing.promise
    const card = catalogCard(modelId, this.catalog)
    if (!card) return Promise.reject(new AulaError('not_found', tr(`No conozco el modelo «${modelId}».`, `I don’t know the model “${modelId}”.`)))
    const controller = new AbortController()
    const promise = this.runDownload(card, controller.signal).finally(() => this.downloads.delete(modelId))
    this.downloads.set(modelId, { controller, promise })
    return promise
  }

  /** Cancela una descarga (lo bajado se queda para continuar). */
  cancel(modelId: string): void {
    this.downloads.get(modelId)?.controller.abort()
  }

  cancelAll(): void {
    for (const d of this.downloads.values()) d.controller.abort()
  }

  isDownloading(modelId: string): boolean {
    return this.downloads.has(modelId)
  }

  /** Archivos que forman el modelo (GGUF + proyector de visión). */
  modelFiles(card: ModelCard): FileDownload[] {
    const gguf = card.gguf
    if (!gguf) throw DownloadError.missingChecksum(card.name)
    const alias = modelAlias(card)
    const folder = join(this.root, alias)
    const files: FileDownload[] = [
      { url: hubDownloadURL(gguf.repo, gguf.path, gguf.revision, this.hub), destination: join(folder, ggufFileName(gguf.path)), bytes: gguf.bytes, sha256: gguf.sha256 }
    ]
    const p = gguf.visionProjector
    if (p) files.push({ url: hubDownloadURL(gguf.repo, p.path, gguf.revision, this.hub), destination: join(folder, ggufFileName(p.path)), bytes: p.bytes, sha256: p.sha256 })
    return files
  }

  private async runDownload(card: ModelCard, signal: AbortSignal): Promise<InstalledLocalModel> {
    const report = (phase: DownloadPhase, state: LocalProgressEvent['state'], p?: TransferProgress, error?: string): void => {
      this.emit({
        modelId: card.id,
        phase,
        state,
        bytesDone: p?.bytesDone ?? 0,
        bytesTotal: p?.bytesTotal ?? 0,
        fraction: p ? progressFraction(p) : state === 'done' ? 1 : 0,
        ...(p?.currentFile ? { currentFile: p.currentFile } : {}),
        ...(error ? { error } : {})
      })
    }
    let phase: DownloadPhase = 'engine'
    let last: TransferProgress | undefined
    try {
      if (!this.engine.isInstalled) {
        await this.engine.install((p) => {
          last = p
          report('engine', 'running', p)
        }, signal)
      }
      phase = 'model'
      const files = this.modelFiles(card)
      await this.downloader.run(files, (p) => {
        last = p
        phase = progressFraction(p) >= 1 ? 'verifying' : 'model'
        report(phase, 'running', p)
      }, signal)
      phase = 'preparing'
      report('preparing', 'running', last)
      const hw = await this.hardwareProbe()
      const fit = this.estimate(card, hw)
      const alias = modelAlias(card)
      const model: InstalledLocalModel = {
        id: card.id,
        alias,
        card,
        file: `${alias}/${ggufFileName(card.gguf!.path)}`,
        ...(files.length > 1 ? { projector: `${alias}/${ggufFileName(card.gguf!.visionProjector!.path)}` } : {}),
        contextTokens: fit.contextTokens,
        installedAt: new Date().toISOString()
      }
      this.saveRegistry([...this.installed().filter((m) => m.alias !== alias), model])
      report('preparing', 'done', last ? { ...last, bytesDone: last.bytesTotal } : undefined)
      return model
    } catch (err) {
      if (isCancellation(err) || signal.aborted) {
        report(phase, 'cancelled', last)
        throw new CancelledError()
      }
      report(phase, 'error', last, err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  /** Borra un modelo (apaga el motor si lo estaba usando). */
  delete(idOrAlias: string): void {
    const model = this.installedModel(idOrAlias)
    const card = catalogCard(idOrAlias, this.catalog)
    const alias = model?.alias ?? (card ? modelAlias(card) : undefined)
    if (!alias || !/^[a-z0-9._-]+$/.test(alias) || alias === 'engine') throw new AulaError('not_found', tr(`No conozco el modelo «${idOrAlias}».`, `I don’t know the model “${idOrAlias}”.`))
    this.cancel(model?.id ?? idOrAlias)
    if (this.engine.running?.alias === alias) this.engine.stop()
    rmSync(join(this.root, alias), { recursive: true, force: true })
    this.saveRegistry(this.installed().filter((m) => m.alias !== alias))
  }

  // MARK: Motor

  /**
   * Enciende (o reutiliza) el motor con un modelo descargado. `context` = el elegido al descargarlo si no se da. Las llamadas a
   * la vez comparten un solo arranque: nunca se lanzan dos servidores.
   */
  async ensureServer(idOrAlias: string, context?: number, signal?: AbortSignal): Promise<RunningServer> {
    const m = this.installedModel(idOrAlias)
    if (!m) throw new AulaError('not_found', tr(`El modelo «${idOrAlias}» no está descargado.`, `The model “${idOrAlias}” isn’t downloaded.`))
    const ctx = context && context > 0 ? Math.min(Math.trunc(context), m.card.contextLength || context) : m.contextTokens
    const key = `${m.alias}#${ctx}`
    if (this.startTask?.key !== key) {
      const bytes = (m.card.gguf?.bytes ?? 0) + (m.card.gguf?.visionProjector?.bytes ?? 0)
      // un modelo grande tarda en leerse del disco y subir a la GPU (≈ 150 MB/s como peor caso + margen)
      const loadTimeoutMs = Math.max(240_000, (bytes / 150e6 + 60) * 1000)
      const promise = this.engine.start({
        model: join(this.root, ...m.file.split('/')),
        projector: m.projector ? join(this.root, ...m.projector.split('/')) : undefined,
        alias: m.alias,
        modelId: m.id,
        context: ctx,
        loadTimeoutMs
      })
      const task = { key, promise }
      this.startTask = task
      promise.then(
        () => {
          if (this.startTask === task) this.startTask = undefined
        },
        () => {
          if (this.startTask === task) this.startTask = undefined
        }
      )
    }
    const pending = this.startTask!.promise
    const server = signal
      ? await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(new CancelledError())
            signal.addEventListener('abort', () => reject(new CancelledError()), { once: true })
          })
        ])
      : await pending
    this.touch()
    this.startIdleWatcher()
    return server
  }

  /** Marca uso (el motor no se apaga mientras haya peticiones en curso). */
  beginUse(): void {
    this.activeUses += 1
    this.lastUse = Date.now()
  }
  endUse(): void {
    this.activeUses = Math.max(0, this.activeUses - 1)
    this.lastUse = Date.now()
  }
  touch(): void {
    this.lastUse = Date.now()
  }

  private startIdleWatcher(): void {
    if (this.idleTimer) return
    const interval = Math.min(20_000, Math.max(50, this.idleShutdownMs / 4))
    this.idleTimer = setInterval(() => {
      if (!this.engine.running) return this.stopIdleWatcher()
      if (this.activeUses === 0 && Date.now() - this.lastUse > this.idleShutdownMs) {
        log.info('[local-ai] motor apagado por inactividad')
        this.engine.stop()
        this.stopIdleWatcher()
      }
    }, interval)
    this.idleTimer.unref?.()
  }

  private stopIdleWatcher(): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = undefined
  }

  stopEngine(): void {
    this.startTask = undefined
    this.engine.stop()
    this.stopIdleWatcher()
  }

  /** Apaga todo al salir de la app. */
  shutdown(): void {
    this.cancelAll()
    this.stopEngine()
  }

  // MARK: Otros motores

  detectServers(): Promise<LocalServerReport[]> {
    return detectLocalServers(this.serverOrigins)
  }

  /** El recomendado para este ordenador (el primero de la lista), con su encaje. */
  async recommended(): Promise<{ id: string; name: string; fit: FitEstimate } | undefined> {
    const hw = await this.hardwareProbe()
    const card = recommendedModels(this.catalog, hw)[0]
    return card ? { id: card.id, name: card.name, fit: this.estimate(card, hw) } : undefined
  }
}

function isInstalledModel(m: unknown): m is InstalledLocalModel {
  if (typeof m !== 'object' || m === null) return false
  const v = m as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.alias === 'string' &&
    /^[a-z0-9._-]+$/.test(v.alias) &&
    typeof v.file === 'string' &&
    !v.file.split('/').includes('..') &&
    !v.file.startsWith('/') &&
    (v.projector === undefined || v.projector === null || (typeof v.projector === 'string' && !v.projector.split('/').includes('..') && !v.projector.startsWith('/'))) &&
    typeof v.contextTokens === 'number' &&
    typeof v.card === 'object' &&
    v.card !== null
  )
}

