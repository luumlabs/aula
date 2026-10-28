// El motor propio de Aula: el `llama-server` OFICIAL de llama.cpp (releases de GitHub), que Aula descarga (verificado),
// arranca con el modelo elegido en 127.0.0.1 con una clave aleatoria y apaga cuando deja de usarse
// (port de `LocalAIKit/Engines/{AulaEngine,EngineReleases}.swift`, ampliado a Windows y Linux).
//
// Carpeta (`folder`, normalmente `<datos>/Models/engine`):
//   <build>/…/llama-server[.exe]   motor descargado (+ `.installed` con la ruta relativa del ejecutable)
//   release-<build>.json           lista de paquetes de esa versión (de la API de GitHub), en caché
//   server.pid · .server-key · llama-server.log
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { HardwareProfile } from '@shared/agents'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { readJSON, writeFileAtomic, writeJSONAtomic } from '../fs'
import { log } from '../log'
import { captureCommand } from '../agents/child-process'
import { CancelledError } from '../agents/errors'
import { ArchiveError, extractArchive, readMarker } from './archive'
import { Downloader, type FetchLike, type TransferProgress } from './downloader'
import { LoopbackHTTP } from './loopback'
import { ENGINE_DEFAULT_PORTS } from './servers'

export type EngineErrorKind = 'notInstalled' | 'unsupported' | 'badArchive' | 'signature' | 'startFailed' | 'modelMissing'

export class EngineError extends AulaError {
  constructor(
    readonly kind: EngineErrorKind,
    message: string
  ) {
    super(`local_engine_${kind}`, message)
    this.name = 'EngineError'
  }
  static notInstalled(): EngineError {
    return new EngineError('notInstalled', tr('El motor de Aula todavía no está instalado.', 'Aula’s engine isn’t installed yet.'))
  }
  static unsupported(what: string): EngineError {
    return new EngineError('unsupported', tr(`No hay motor de llama.cpp para este ordenador (${what}). Usa Ollama o LM Studio.`, `There’s no llama.cpp engine for this computer (${what}). Use Ollama or LM Studio.`))
  }
  static badArchive(why: string): EngineError {
    return new EngineError('badArchive', tr(`El paquete del motor no es válido: ${why}`, `The engine package isn’t valid: ${why}`))
  }
  static signature(why: string): EngineError {
    return new EngineError('signature', tr(`La firma del motor no es válida: ${why}`, `The engine’s signature isn’t valid: ${why}`))
  }
  static startFailed(why: string): EngineError {
    return new EngineError('startFailed', tr(`El motor no arrancó: ${why}`, `The engine didn’t start: ${why}`))
  }
  static modelMissing(name: string): EngineError {
    return new EngineError('modelMissing', tr(`Falta el archivo del modelo «${name}». Vuelve a descargarlo.`, `The model file “${name}” is missing. Download it again.`))
  }
}

// MARK: Versión fijada

/** Un paquete publicado de llama.cpp. `sha256` es el `digest` que publica GitHub (o el fijado en Aula). */
export interface EngineAsset {
  name: string
  url: string
  bytes: number
  sha256?: string
}

/**
 * La versión de llama.cpp que usa Aula, fijada (la misma que la app Swift): b11429. En macOS los paquetes y sus SHA-256 están
 * fijados aquí; en Windows y Linux la lista sale de la API de GitHub para esa misma etiqueta, pero sus SHA-256 también están
 * fijados (`PINNED_ENGINE_SHA256`).
 */
export const ENGINE_BUILD = 'b11429'

export const PINNED_MAC_ASSETS: Record<'arm64' | 'x64', EngineAsset> = {
  arm64: {
    name: 'llama-b11429-bin-macos-arm64.tar.gz',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11429/llama-b11429-bin-macos-arm64.tar.gz',
    bytes: 11_971_406,
    sha256: '740288ec6887be94280a5dfa25b5e23a78285cab104519e6c7e218904ee82459'
  },
  x64: {
    name: 'llama-b11429-bin-macos-x64.tar.gz',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11429/llama-b11429-bin-macos-x64.tar.gz',
    bytes: 11_487_431,
    sha256: '29ac3ea02be6bd143e824973f2cc5fa74bc4094393a9eaab0ff6814f19dd8522'
  }
}

/**
 * SHA-256 de los paquetes de Windows y Linux de b11429, fijados aquí (A2-P2-21): antes se leían de la API de GitHub en el
 * momento, del mismo sitio que el paquete (quien pudiera cambiar el archivo cambiaba también su `digest`). Copiados del
 * `digest` que publicó GitHub para esa etiqueta (los de macOS coinciden con los fijados arriba).
 */
export const PINNED_ENGINE_SHA256: Readonly<Record<string, string>> = {
  'llama-b11429-bin-ubuntu-arm64.tar.gz': 'ed44c0f79c3d02424f62bdc87e106318b0b89f49050e2e80c5f352723d14e00b',
  'llama-b11429-bin-ubuntu-vulkan-x64.tar.gz': '632c4e98feba2b94407a2130e3133e0c3aefb0ea1ab41337e926d8bfafdd0b74',
  'llama-b11429-bin-ubuntu-x64.tar.gz': 'f6d25dde8f51133143d1453da4fd5f73b145127177612a283bf7995957af3392',
  'llama-b11429-bin-win-cpu-arm64.zip': 'ee0f631a9e58b146ff50714099d9cb498906af3143a773b580093a9214a8d1e5',
  'llama-b11429-bin-win-cpu-x64.zip': '1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe',
  'llama-b11429-bin-win-vulkan-x64.zip': '1bfe78ad9168b79fa02bf67f6af9f5e17a966d824d77238517f7bef12ac73b36'
}

export interface PlatformTarget {
  platform: NodeJS.Platform
  arch: string
  /** GPU dedicada con memoria propia (NVIDIA, AMD…). */
  dedicatedGPU: boolean
  /** Hay cargador de Vulkan en el sistema (`vulkan-1.dll`, `libvulkan.so.1`). */
  vulkan: boolean
}

/** Variantes de los paquetes de llama.cpp para este ordenador, de la preferida a la de reserva. */
export function engineVariants(t: PlatformTarget): string[] {
  const gpu = t.dedicatedGPU && t.vulkan
  if (t.platform === 'darwin') return t.arch === 'arm64' ? ['macos-arm64'] : ['macos-x64']
  if (t.platform === 'win32') {
    if (t.arch === 'arm64') return ['win-cpu-arm64']
    return gpu ? ['win-vulkan-x64', 'win-cpu-x64'] : ['win-cpu-x64']
  }
  if (t.platform === 'linux') {
    if (t.arch === 'arm64') return ['ubuntu-arm64']
    return gpu ? ['ubuntu-vulkan-x64', 'ubuntu-x64'] : ['ubuntu-x64']
  }
  return []
}

/** ¿Lleva la variante aceleración por GPU? (si no, `--n-gpu-layers 0`). */
export function variantUsesGPU(variant: string): boolean {
  return variant === 'macos-arm64' || /vulkan|cuda|hip|sycl/.test(variant)
}

export interface GitHubAsset {
  name: string
  size: number
  browser_download_url: string
  digest?: string | null
}

/** El paquete de la primera variante disponible en la lista de una versión. */
export function pickEngineAsset(assets: GitHubAsset[], build: string, variants: string[]): { asset: EngineAsset; variant: string } | undefined {
  for (const variant of variants) {
    for (const ext of ['.zip', '.tar.gz']) {
      const found = assets.find((a) => a.name === `llama-${build}-bin-${variant}${ext}`)
      if (!found || !/^https:\/\/github\.com\//.test(found.browser_download_url) || !(found.size > 0)) continue
      const digest = typeof found.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(found.digest) ? found.digest.slice(7).toLowerCase() : undefined
      // la huella fijada manda; si GitHub publica otra para el mismo nombre, el archivo cambió: no se usa
      const pinned = PINNED_ENGINE_SHA256[found.name]
      if (pinned && digest && digest !== pinned) continue
      return { asset: { name: found.name, url: found.browser_download_url, bytes: found.size, sha256: pinned ?? digest }, variant }
    }
  }
  return undefined
}

function hasVulkanLoader(platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return existsSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll'))
  if (platform === 'linux') {
    return ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1', '/usr/lib/aarch64-linux-gnu/libvulkan.so.1', '/usr/lib64/libvulkan.so.1', '/usr/lib/libvulkan.so.1'].some((p) => existsSync(p))
  }
  return false
}

export function platformTarget(hw?: HardwareProfile): PlatformTarget {
  const platform = process.platform
  return { platform, arch: process.arch, dedicatedGPU: !!hw?.gpu?.vramBytes && hw.gpu.vendor !== 'apple', vulkan: hasVulkanLoader(platform) }
}

// MARK: Servidor en marcha

export interface RunningServer {
  port: number
  /** Clave aleatoria de esta sesión: sin ella el servidor no atiende (ninguna otra app ni página web del ordenador puede usarlo). */
  apiKey: string
  alias: string
  modelId: string
  contextTokens: number
  pid: number
  baseURL: string
}

export interface StartOptions {
  model: string
  projector?: string
  alias: string
  modelId?: string
  context: number
  parallel?: number
  loadTimeoutMs?: number
}

export interface EngineServerProps {
  supportsToolCalls?: boolean
  context?: number
  build?: string
}

export interface AulaEngineOptions {
  folder: string
  build?: string
  /** Paquete a usar (pruebas, o una compilación propia). Si no, el fijado (macOS) o el de la API de GitHub. */
  asset?: EngineAsset
  /** Variante del paquete fijado (para decidir `--n-gpu-layers`). */
  variant?: string
  hardware?: () => Promise<HardwareProfile | undefined>
  downloader?: Downloader
  fetch?: FetchLike
  preferredPort?: number
  /** Comprobar la firma del ejecutable en macOS (por defecto, en Apple Silicon). */
  verifySignature?: boolean
  pollIntervalMs?: number
}

const isWindows = process.platform === 'win32'
const liveEngines = new Set<AulaEngine>()
let exitHookInstalled = false
const EXE = isWindows ? 'llama-server.exe' : 'llama-server'

export class AulaEngine {
  readonly folder: string
  readonly build: string
  readonly preferredPort: number
  private readonly downloader: Downloader
  private readonly fetchImpl: FetchLike
  private readonly hardware: () => Promise<HardwareProfile | undefined>
  private readonly assetOverride?: EngineAsset
  private variant?: string
  private readonly verify: boolean
  private readonly pollMs: number
  private current?: { server: RunningServer; child: ChildProcess; watchdog?: ChildProcess }
  private generation = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(options: AulaEngineOptions) {
    this.folder = options.folder
    this.build = options.build ?? ENGINE_BUILD
    this.preferredPort = options.preferredPort ?? ENGINE_DEFAULT_PORTS.aula
    this.downloader = options.downloader ?? new Downloader({ diskMargin: 512 * 1_048_576, fetch: options.fetch })
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.hardware = options.hardware ?? (async () => undefined)
    this.assetOverride = options.asset
    this.variant = options.variant
    this.verify = options.verifySignature ?? (process.platform === 'darwin' && process.arch === 'arm64')
    this.pollMs = options.pollIntervalMs ?? 300
  }

  get installFolder(): string {
    return join(this.folder, this.build)
  }
  get pidFile(): string {
    return join(this.folder, 'server.pid')
  }
  /** La clave de la sesión, solo mientras arranca (0600): por la línea de órdenes la vería cualquiera con `ps`. */
  get keyFile(): string {
    return join(this.folder, '.server-key')
  }
  get logFile(): string {
    return join(this.folder, 'llama-server.log')
  }

  /** El ejecutable instalado (dentro de su carpeta, esté donde esté), o `undefined`. */
  get binary(): string | undefined {
    const rel = readMarker(this.installFolder)
    if (!rel) return undefined
    const path = join(this.installFolder, ...rel.split('/'))
    try {
      return statSync(path).isFile() ? path : undefined
    } catch {
      return undefined
    }
  }

  get isInstalled(): boolean {
    return this.binary !== undefined
  }

  get running(): RunningServer | undefined {
    return this.current?.server
  }

  // MARK: Instalar

  private async resolveAsset(): Promise<EngineAsset> {
    if (this.assetOverride) return this.assetOverride
    const hw = await this.hardware().catch(() => undefined)
    const target = platformTarget(hw)
    if (target.platform === 'darwin' && this.build === ENGINE_BUILD) {
      this.variant = target.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
      return PINNED_MAC_ASSETS[target.arch === 'arm64' ? 'arm64' : 'x64']
    }
    const variants = engineVariants(target)
    if (variants.length === 0) throw EngineError.unsupported(`${target.platform} ${target.arch}`)
    const assets = await this.releaseAssets()
    const picked = pickEngineAsset(assets, this.build, variants)
    if (!picked) throw EngineError.unsupported(`${target.platform} ${target.arch}`)
    this.variant = picked.variant
    writeFileAtomic(join(this.folder, 'variant'), picked.variant)
    return picked.asset
  }

  /** Paquetes de la versión fijada (API de GitHub, con caché en disco: el límite sin cuenta es de 60 peticiones por hora). */
  private async releaseAssets(): Promise<GitHubAsset[]> {
    const cacheFile = join(this.folder, `release-${this.build}.json`)
    const cached = readJSON<{ assets?: GitHubAsset[] }>(cacheFile)
    if (cached?.assets?.length) return cached.assets
    let res: Response
    try {
      res = await this.fetchImpl(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${encodeURIComponent(this.build)}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Aula/2.0', 'x-github-api-version': '2022-11-28' }
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new AulaError('local_network', tr(`No pude consultar las versiones de llama.cpp: ${reason}`, `I couldn’t check the llama.cpp versions: ${reason}`))
    }
    if (!res.ok) {
      throw new AulaError(
        'local_network',
        tr(`GitHub respondió ${res.status} al pedir la versión ${this.build} de llama.cpp.`, `GitHub answered ${res.status} when asked for llama.cpp version ${this.build}.`)
      )
    }
    const json = (await res.json().catch(() => undefined)) as { assets?: unknown } | undefined
    const assets = (Array.isArray(json?.assets) ? json.assets : []).filter(
      (a): a is GitHubAsset => typeof a === 'object' && a !== null && typeof (a as GitHubAsset).name === 'string' && typeof (a as GitHubAsset).browser_download_url === 'string' && typeof (a as GitHubAsset).size === 'number'
    )
    mkdirSync(this.folder, { recursive: true })
    writeJSONAtomic(cacheFile, { assets: assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url, digest: a.digest ?? null })) })
    return assets
  }

  /**
   * Descarga el paquete oficial, comprueba su SHA-256, lo descomprime aparte (sin rutas ni enlaces que salgan), comprueba la
   * firma del ejecutable en macOS y solo entonces lo deja en su sitio. Nada se ejecuta antes de esas comprobaciones.
   */
  async install(progress: (p: TransferProgress) => void = () => undefined, signal?: AbortSignal): Promise<void> {
    if (this.isInstalled) return
    mkdirSync(this.folder, { recursive: true })
    const asset = await this.resolveAsset()
    // nunca se ejecuta un motor sin comprobar su huella (GitHub publica el SHA-256 de cada archivo de la versión)
    if (!asset.sha256) {
      throw new Error(
        tr(
          `No se pudo comprobar la descarga del motor (${asset.name} no tiene SHA-256 publicado). Prueba más tarde.`,
          `Couldn’t verify the engine download (${asset.name} has no published SHA-256). Try again later.`
        )
      )
    }
    const staging = join(this.folder, 'descarga')
    mkdirSync(staging, { recursive: true })
    const archive = join(staging, basename(asset.name))
    await this.downloader.run([{ url: asset.url, destination: archive, bytes: asset.bytes, sha256: asset.sha256 }], progress, signal)
    if (signal?.aborted) throw new CancelledError()
    const unpack = join(this.folder, `desempaquetado-${randomBytes(4).toString('hex')}`)
    rmSync(unpack, { recursive: true, force: true })
    try {
      try {
        await extractArchive(archive, unpack)
      } catch (err) {
        rmSync(archive, { force: true }) // un paquete que no se puede abrir no sirve para reanudar
        throw err instanceof ArchiveError ? EngineError.badArchive(err.message.replace(/^El paquete del motor no es válido: /, '')) : err
      }
      const server = findFile(unpack, EXE)
      if (!server) throw EngineError.badArchive(tr('no trae llama-server', 'it doesn’t include llama-server'))
      pruneFolder(dirname(server), basename(server))
      if (!isWindows) chmodSync(server, 0o755)
      if (this.verify) await verifyMacSignature(server)
      const rel = relative(unpack, server).split(sep).join('/')
      rmSync(this.installFolder, { recursive: true, force: true })
      renameSync(unpack, this.installFolder)
      writeFileAtomic(join(this.installFolder, '.installed'), rel)
    } finally {
      rmSync(unpack, { recursive: true, force: true })
    }
    rmSync(staging, { recursive: true, force: true })
    // versiones anteriores del motor: fuera
    for (const old of safeList(this.folder)) {
      if (/^b\d+$/.test(old) && old !== this.build) rmSync(join(this.folder, old), { recursive: true, force: true })
    }
  }

  // MARK: Arrancar y apagar

  /** ¿Lleva la instalación aceleración por GPU? */
  private usesGPU(): boolean {
    const variant = this.variant ?? (existsSync(join(this.folder, 'variant')) ? readFileSync(join(this.folder, 'variant'), 'utf8').trim() : undefined)
    if (variant) return variantUsesGPU(variant)
    return process.platform === 'darwin' && process.arch === 'arm64'
  }

  /**
   * Argumentos de `llama-server` (los de la app Swift, comprobados con `llama-server --help` de b11429):
   * `--host 127.0.0.1 --port <libre> --api-key-file <0600>` (solo este ordenador y solo Aula; la clave nunca en la línea de órdenes),
   * `--alias`, `--jinja` (herramientas nativas con la plantilla del GGUF), `--ctx-size` + `--parallel 2` + `--kv-unified`,
   * `--flash-attn on` + caché KV q8_0, `--no-webui --offline`; sin GPU, `--n-gpu-layers 0`.
   */
  serverArguments(o: { model: string; projector?: string; alias: string; context: number; parallel: number; port: number; keyFile: string; cacheType?: string }): string[] {
    const cache = o.cacheType ?? 'q8_0'
    const args = [
      '--model', o.model, '--alias', o.alias, '--host', '127.0.0.1', '--port', String(o.port), '--api-key-file', o.keyFile,
      '--ctx-size', String(o.context), '--parallel', String(Math.max(1, o.parallel)), '--kv-unified',
      '--jinja', '--flash-attn', 'on', '--cache-type-k', cache, '--cache-type-v', cache,
      '--no-webui', '--offline'
    ]
    if (!this.usesGPU()) args.push('--n-gpu-layers', '0')
    if (o.projector) args.push('--mmproj', o.projector)
    return args
  }

  /** Arranca (o reutiliza) el servidor con este modelo y contexto; si hay otro modelo, lo cambia. Los arranques van en fila. */
  start(options: StartOptions, signal?: AbortSignal): Promise<RunningServer> {
    const run = this.chain.then(
      () => this.startNow(options, signal),
      () => this.startNow(options, signal)
    )
    this.chain = run.catch(() => undefined)
    return run
  }

  private async startNow(o: StartOptions, signal?: AbortSignal): Promise<RunningServer> {
    if (signal?.aborted) throw new CancelledError()
    const generation = this.generation
    const check = (): void => {
      if (signal?.aborted || generation !== this.generation) throw new CancelledError()
    }
    const now = this.current
    if (now && now.server.alias === o.alias && now.server.contextTokens === o.context && now.child.exitCode === null && now.child.signalCode === null) {
      if (await this.healthy(now.server)) {
        check()
        return now.server
      }
    }
    let cacheType = 'q8_0'
    let randomPort = false
    for (let attempt = 0; attempt < 3; attempt++) {
      check()
      try {
        return await this.launch(o, cacheType, randomPort, check)
      } catch (err) {
        if (!(err instanceof EngineError) || err.kind !== 'startFailed' || attempt >= 2) throw err
        if (/cache type|cache_type/i.test(err.message) && cacheType !== 'f16') cacheType = 'f16'
        else if (/bind|address already in use/i.test(err.message) && !randomPort) randomPort = true
        else throw err
      }
    }
    throw EngineError.startFailed(this.logTail())
  }

  private async launch(o: StartOptions, cacheType: string, randomPort: boolean, check: () => void): Promise<RunningServer> {
    const exe = this.binary
    if (!exe) throw EngineError.notInstalled()
    if (!existsSync(o.model)) throw EngineError.modelMissing(basename(o.model))
    mkdirSync(this.folder, { recursive: true })
    this.stopProcess()
    await sweepOrphan(this.pidFile)
    check()
    const port = await freePort(randomPort ? 0 : this.preferredPort)
    check()
    const key = 'aula-' + randomBytes(24).toString('hex')
    rmSync(this.keyFile, { force: true })
    writeFileSync(this.keyFile, key + '\n', { mode: 0o600 })
    rotateLog(this.logFile)
    const fd = openSync(this.logFile, 'a')
    let child: ChildProcess
    try {
      child = spawn(exe, this.serverArguments({ model: o.model, projector: o.projector, alias: o.alias, context: o.context, parallel: o.parallel ?? 2, port, keyFile: this.keyFile, cacheType }), {
        cwd: dirname(exe),
        env: engineEnvironment(),
        stdio: ['ignore', fd, fd],
        windowsHide: true
      })
    } catch (err) {
      closeSync(fd)
      rmSync(this.keyFile, { force: true })
      throw EngineError.startFailed(err instanceof Error ? err.message : String(err))
    }
    closeSync(fd)
    let spawnError: Error | undefined
    child.once('error', (err) => (spawnError = err))
    const server: RunningServer = { port, apiKey: key, alias: o.alias, modelId: o.modelId ?? o.alias, contextTokens: o.context, pid: child.pid ?? -1, baseURL: `http://127.0.0.1:${port}/v1` }
    const watchdog = startWatchdog(server.pid)
    this.current = { server, child, watchdog }
    this.installExitHook()
    if (child.pid) writeFileAtomic(this.pidFile, `${child.pid}\n${exe}`)
    const deadline = Date.now() + (o.loadTimeoutMs ?? 240_000)
    try {
      while (Date.now() < deadline) {
        check()
        if (spawnError) throw EngineError.startFailed(spawnError.message)
        if (child.exitCode !== null || child.signalCode !== null) throw EngineError.startFailed(this.logTail() || tr(`terminó con ${child.exitCode ?? child.signalCode}`, `ended with ${child.exitCode ?? child.signalCode}`))
        if (await this.healthy(server)) {
          check()
          rmSync(this.keyFile, { force: true })
          return server
        }
        await new Promise((r) => setTimeout(r, this.pollMs))
      }
      throw EngineError.startFailed(tr('tardó demasiado en cargar el modelo', 'it took too long to load the model'))
    } catch (err) {
      if (this.current?.child === child) this.stopProcess()
      else killChild(child)
      rmSync(this.keyFile, { force: true })
      throw err
    }
  }

  /** Apaga el servidor (y cancela un arranque en curso). */
  stop(): void {
    this.generation += 1
    this.stopProcess()
  }

  private stopProcess(): void {
    const current = this.current
    this.current = undefined
    if (!current) return
    killChild(current.child)
    current.watchdog?.kill()
    rmSync(this.pidFile, { force: true })
    rmSync(this.keyFile, { force: true })
  }

  private installExitHook(): void {
    liveEngines.add(this)
    if (exitHookInstalled) return
    exitHookInstalled = true
    // al salir la app (también de golpe por un error), ningún `llama-server` se queda gastando memoria
    process.once('exit', () => {
      for (const engine of liveEngines) engine.killNow()
    })
  }

  /** SIGKILL inmediato al servidor (solo al salir del proceso). */
  private killNow(): void {
    const pid = this.current?.child.pid
    if (!pid) return
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ya no está */
    }
  }

  /** `/health` con la clave (200 = modelo cargado; 503 mientras carga). */
  async healthy(s: Pick<RunningServer, 'port' | 'apiKey'>): Promise<boolean> {
    const http = LoopbackHTTP.create(`http://127.0.0.1:${s.port}`, 1500)
    if (!http) return false
    try {
      await http.data('/health', { headers: { authorization: `Bearer ${s.apiKey}` } })
      return true
    } catch {
      return false
    }
  }

  /** Lo que publica el servidor en `/props`: si la plantilla admite herramientas y el contexto real por petición. */
  async props(s: RunningServer): Promise<EngineServerProps | undefined> {
    const http = LoopbackHTTP.create(`http://127.0.0.1:${s.port}`, 3000)
    if (!http) return undefined
    try {
      const v = (await http.json('/props', { headers: { authorization: `Bearer ${s.apiKey}` } })) as Record<string, unknown>
      const caps = v.chat_template_caps as Record<string, unknown> | undefined
      const gen = v.default_generation_settings as Record<string, unknown> | undefined
      return {
        supportsToolCalls: typeof caps?.supports_tool_calls === 'boolean' ? caps.supports_tool_calls : undefined,
        context: typeof gen?.n_ctx === 'number' ? gen.n_ctx : typeof v.n_ctx === 'number' ? v.n_ctx : undefined,
        build: typeof v.build_info === 'string' ? v.build_info : undefined
      }
    } catch {
      return undefined
    }
  }

  /** Las últimas líneas útiles del registro (errores primero). */
  logTail(maxChars = 600): string {
    let text: string
    try {
      const buf = readFileSync(this.logFile)
      text = buf.subarray(Math.max(0, buf.length - 64 * 1024)).toString('utf8')
    } catch {
      return ''
    }
    const all = text.split('\n').filter((l) => l.trim())
    const errors = all.filter((l) => l.includes(' E ') || l.toLowerCase().includes('error'))
    const lines = (errors.length > 0 ? errors.slice(0, 4) : all.slice(-8)).join('\n')
    return lines.slice(-maxChars)
  }
}

// MARK: Ayudantes

function safeList(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}

function findFile(root: string, name: string): string | undefined {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of safeList(dir)) {
      const path = join(dir, entry)
      let st
      try {
        st = lstatSync(path)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(path)
      else if (st.isFile() && entry === name) return path
    }
  }
  return undefined
}

/** Deja solo lo que el servidor necesita (el ejecutable, sus bibliotecas y la licencia): el paquete trae ~30 herramientas más. */
export function pruneFolder(dir: string, keep: string): void {
  for (const name of safeList(dir)) {
    if (name === keep || /\.(dylib|dll|metallib)$/i.test(name) || /\.so(\.\d+)*$/.test(name) || name.startsWith('LICENSE')) continue
    const path = join(dir, name)
    try {
      if (lstatSync(path).isDirectory()) continue
    } catch {
      continue
    }
    rmSync(path, { force: true })
  }
}

async function verifyMacSignature(exe: string): Promise<void> {
  const codesign = '/usr/bin/codesign'
  if (!existsSync(codesign)) return
  const out = await captureCommand(codesign, ['--verify', '--all-architectures', exe], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 30_000 })
  if (!out?.exit || out.exit.code !== 0) throw EngineError.signature((out?.stderr.toString('utf8') ?? '').trim().slice(0, 200) || tr('codesign falló', 'codesign failed'))
}

function engineEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('DYLD_') || k.startsWith('LLAMA_') || k === 'ELECTRON_RUN_AS_NODE') continue
    env[k] = v
  }
  env.LLAMA_LOG_COLORS = '0'
  return env
}

function rotateLog(path: string): void {
  try {
    if (statSync(path).size > 4 * 1_048_576) rmSync(path, { force: true })
  } catch {
    /* no hay registro */
  }
}

function killChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000)
  timer.unref?.()
  child.once('exit', () => clearTimeout(timer))
}

/** El puerto preferido si está libre; si no (o con 0), uno libre cualquiera de 127.0.0.1. */
export async function freePort(preferred: number): Promise<number> {
  const tryListen = (port: number): Promise<number | undefined> =>
    new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(undefined))
      server.listen(port, '127.0.0.1', () => {
        const address = server.address()
        const got = typeof address === 'object' && address ? address.port : undefined
        server.close(() => resolve(got))
      })
    })
  if (preferred > 0) {
    const ok = await tryListen(preferred)
    if (ok) return ok
  }
  const any = await tryListen(0)
  if (!any) throw EngineError.startFailed(tr('no hay ningún puerto libre en 127.0.0.1', 'there’s no free port on 127.0.0.1'))
  return any
}

/**
 * Vigilante (macOS/Linux): un `sh` que apaga el servidor si Aula desaparece (cierre forzado, cuelgue), para no dejar procesos
 * huérfanos gastando memoria. Solo mata si el servidor sigue vivo (si ya terminó, su PID podría ser de otro proceso).
 */
export function startWatchdog(pid: number, parent: number = process.pid): ChildProcess | undefined {
  if (isWindows || pid <= 0 || !existsSync('/bin/sh')) return undefined
  const me = parent
  const script =
    `while kill -0 ${me} 2>/dev/null && kill -0 ${pid} 2>/dev/null; do sleep 2; done; ` +
    `kill -0 ${pid} 2>/dev/null && { kill ${pid} 2>/dev/null; sleep 3; kill -0 ${pid} 2>/dev/null && kill -9 ${pid} 2>/dev/null; }; exit 0`
  try {
    const w = spawn('/bin/sh', ['-c', script], { stdio: 'ignore', detached: true })
    w.on('error', () => undefined)
    w.unref()
    return w
  } catch {
    return undefined
  }
}

function isAlive(pid: number): boolean {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Ejecutable de un proceso (para no matar a otro que reutilizó el PID). */
async function executableOf(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try {
      return readlinkSync(`/proc/${pid}/exe`)
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    const out = await captureCommand('/bin/ps', ['-p', String(pid), '-o', 'comm='], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 3000 })
    return out?.stdout.toString('utf8').trim() || undefined
  }
  const tasklist = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe')
  const out = await captureCommand(tasklist, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { env: { ...(process.env as Record<string, string>) }, timeoutMs: 5000 })
  const name = /^"([^"]+)"/.exec(out?.stdout.toString('utf8').trim() ?? '')?.[1]
  return name
}

/** Un servidor que dejó una sesión anterior (Aula se cerró de golpe): si sigue vivo y es nuestro `llama-server`, se apaga. */
async function sweepOrphan(pidFile: string): Promise<void> {
  let lines: string[]
  try {
    lines = readFileSync(pidFile, 'utf8').split('\n')
  } catch {
    return
  }
  const pid = Number(lines[0])
  const exe = lines[1]?.trim()
  if (Number.isInteger(pid) && pid > 0 && exe && isAlive(pid)) {
    const actual = await executableOf(pid)
    const matches = actual !== undefined && (actual === exe || (isWindows && basename(exe).toLowerCase() === actual.toLowerCase()))
    if (matches) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* nada */
      }
      await new Promise((r) => setTimeout(r, 300))
      if (isAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* nada */
        }
      }
    }
  }
  rmSync(pidFile, { force: true })
}
