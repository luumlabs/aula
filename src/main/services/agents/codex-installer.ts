// El Codex que gestiona Aula: el paquete OFICIAL de OpenAI (releases de GitHub, versión fijada) en `<datos>/tools/codex/<versión>/`
// y su carpeta de sesión `<datos>/tools/codex/home` (port de `LocalAIKit/Engines/ToolInstaller.swift` + `ManagedCodex`).
// Se instala el paquete completo tal cual lo dejan los instaladores de OpenAI (`codex-package-<triple>.tar.gz`): `bin/codex` y, a
// su lado, `bin/codex-code-mode-host` (desde Codex 0.147 su «modo código» no arranca sin él), más `codex-resources/` (bwrap en
// Linux, los ayudantes del sandbox en Windows…), `codex-path/rg` y `codex-package.json`, con el que Codex reconoce la estructura.
// SHA-256 fijado (nada se ejecuta sin comprobarlo), descompresión en una carpeta nueva sin enlaces que salgan, y solo entonces a
// su sitio. Nada de npm ni Homebrew.
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { readJSON, writeFileAtomic, writeJSONAtomic } from '../fs'
import { ArchiveError, extractArchive } from '../local-ai/archive'
import { DownloadError, Downloader, sha256OfFile, type FetchLike, type TransferProgress } from '../local-ai/downloader'
import { type EngineAsset, type GitHubAsset } from '../local-ai/engine'
import { CancelledError, isCancellation } from './errors'

/** Codex CLI oficial (Apache-2.0), la versión estable fijada (`rust-v0.162.1`, 2026-10-09). */
export const CODEX_VERSION = '0.162.1'
export const CODEX_TAG = `rust-v${CODEX_VERSION}`

/**
 * Paquetes completos de rust-v0.162.1 para los seis sistemas de Aula: tamaño y SHA-256 del `digest` de GitHub, el mismo que
 * publica su `codex-package_SHA256SUMS`. (Los `codex-<triple>.tar.gz` sueltos de macOS y Linux solo traen `codex`, sin el host de
 * Code Mode; del `.exe.zip` de Windows, que sí lo trae, Aula solo copiaba `codex.exe`: por eso las instalaciones de antes no lo tienen.)
 */
export const PINNED_CODEX_PACKAGES: Readonly<Record<string, { bytes: number; sha256: string }>> = {
  'codex-package-aarch64-apple-darwin.tar.gz': { bytes: 132_224_844, sha256: '88e37ccddf5a0f4ea9dc1be13c66a2a94f9c2d1a04f3ace9053d71b3939e885d' },
  'codex-package-x86_64-apple-darwin.tar.gz': { bytes: 143_687_717, sha256: '894ac20afe819d4fa2a4be8cd27c54fd606338b86036e8ed9b6c9978c2dc7aed' },
  'codex-package-aarch64-pc-windows-msvc.tar.gz': { bytes: 147_962_319, sha256: '513db87ad85a52acb76e552e97caed87813e8ca3b861a1d69c9d5b1638bdb74b' },
  'codex-package-x86_64-pc-windows-msvc.tar.gz': { bytes: 159_746_536, sha256: '3e993a82ff393f4530558dcaadb36bb4f0fd1ea7243e621348e40b469f900f6a' },
  'codex-package-aarch64-unknown-linux-musl.tar.gz': { bytes: 153_057_922, sha256: '53a9ce0b94beb27a63fdeb2f7704d95199e17b3898aa33b60461a1a93ac0d88b' },
  'codex-package-x86_64-unknown-linux-musl.tar.gz': { bytes: 162_905_879, sha256: 'a676f5722aae0d86cbe3764332f08eab1fdd89dc0a300b3ad4ffbf48611fa3e3' }
}

/** Triple de Rust del paquete para este sistema (`undefined` = no hay binario oficial). */
export function codexTriple(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined {
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : undefined
  if (!cpu) return undefined
  if (platform === 'darwin') return `${cpu}-apple-darwin`
  if (platform === 'linux') return `${cpu}-unknown-linux-musl`
  if (platform === 'win32') return `${cpu}-pc-windows-msvc`
  return undefined
}

/** Nombre del paquete completo de un sistema en las releases de OpenAI. */
export function codexPackageName(triple: string): string {
  return `codex-package-${triple}.tar.gz`
}

/** El paquete fijado de la versión de Aula para un sistema (sin consultar la API de GitHub). */
export function pinnedCodexAsset(triple: string): EngineAsset | undefined {
  const name = codexPackageName(triple)
  const pin = PINNED_CODEX_PACKAGES[name]
  return pin ? { name, url: `https://github.com/openai/codex/releases/download/${CODEX_TAG}/${name}`, bytes: pin.bytes, sha256: pin.sha256 } : undefined
}

/** El paquete de Codex para este sistema en la lista de una versión de GitHub (otra versión que la fijada: con su huella publicada). */
export function pickCodexAsset(assets: GitHubAsset[], triple: string): EngineAsset | undefined {
  const a = assets.find((x) => x.name === codexPackageName(triple))
  if (!a || !(a.size > 0) || !/^https:\/\/github\.com\//.test(a.browser_download_url)) return undefined
  const sha = typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(a.digest) ? a.digest.slice(7).toLowerCase() : undefined
  return { name: a.name, url: a.browser_download_url, bytes: a.size, sha256: sha }
}

/** `codex` o `codex.exe`. */
function executableName(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

/** Lo que tiene que haber en la carpeta instalada (rutas relativas): sin el host de Code Mode, Codex no trabaja. */
export function codexRequiredFiles(platform: NodeJS.Platform = process.platform): string[] {
  return ['codex-package.json', `bin/${executableName('codex', platform)}`, `bin/${executableName('codex-code-mode-host', platform)}`]
}

/** Programas del paquete que en macOS y Linux tienen que quedar ejecutables (como hace `install.sh` de OpenAI). */
const POSIX_EXECUTABLES = ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg', 'codex-resources/bwrap']

/** Carpetas de trabajo en `tools/codex`: la descarga, lo recién descomprimido y, junto a la versión, la nueva y la de antes. */
const STAGING = 'descarga'
const UNPACKED = 'desempaquetado-'
const FRESH = '.nueva-'
const PREVIOUS = '.anterior-'

/** ¿Es una carpeta de trabajo que dejó una instalación (de esta versión o de otra)? */
function isWorkFolder(name: string): boolean {
  return name.startsWith(UNPACKED) || /^\d+\.\d+.*\.(?:nueva|anterior)-[0-9a-f]+$/.test(name)
}

export interface ManagedCodexOptions {
  /** Carpeta de datos de Aula. */
  root: string
  version?: string
  /** Paquete propio (pruebas). */
  asset?: EngineAsset
  downloader?: Downloader
  fetch?: FetchLike
  /** Sistema y procesador del paquete (por defecto, los de este ordenador; las pruebas simulan Windows). */
  platform?: NodeJS.Platform
  arch?: string
  /** Cambio de nombre de las carpetas (pruebas: simular el antivirus de Windows, que retiene un rato lo recién escrito). */
  rename?: (from: string, to: string) => void
}

export class ManagedCodex {
  readonly folder: string
  readonly version: string
  readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly assetOverride?: EngineAsset
  private readonly downloader: Downloader
  private readonly fetchImpl: FetchLike
  private readonly renameImpl?: (from: string, to: string) => void
  /** Una cosa cada vez (instalar, completar, recoger): «Conectar con ChatGPT» y una creación de curso pueden pedirla juntas. */
  private chain: Promise<unknown> = Promise.resolve()
  /**
   * Ya se intentó completar sola en esta sesión (bien, o mal después de tener el paquete entero): no se vuelve a intentar sola
   * hasta que Aula se abra otra vez, para no descomprimir ni descargar en bucle si algo (¿un antivirus?) quita una pieza.
   */
  private autoRepaired = false

  constructor(options: ManagedCodexOptions) {
    this.folder = join(options.root, 'tools', 'codex')
    this.version = options.version ?? CODEX_VERSION
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.assetOverride = options.asset
    this.downloader = options.downloader ?? new Downloader({ diskMargin: 512 * 1_048_576, fetch: options.fetch })
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.renameImpl = options.rename
  }

  /** `CODEX_HOME` de Aula. */
  get sessionFolder(): string {
    return join(this.folder, 'home')
  }
  get installFolder(): string {
    return join(this.folder, this.version)
  }
  /** Carpeta del ejecutable y del host de Code Mode (`bin/` del paquete). */
  get binFolder(): string {
    return join(this.installFolder, 'bin')
  }

  /** El ejecutable de la versión fijada, solo si la instalación está completa (con el host de Code Mode a su lado). */
  get binary(): string | undefined {
    return this.missingIn(this.installFolder).length === 0 ? join(this.binFolder, executableName('codex', this.platform)) : undefined
  }

  /** Lo que le falta a una carpeta para ser una instalación entera: el marcador de terminada y lo que Codex necesita a su lado. */
  private missingIn(folder: string): string[] {
    return ['.installed', ...codexRequiredFiles(this.platform)].filter((rel) => !isFile(join(folder, ...rel.split('/'))))
  }

  /** ¿Es esta ruta el Codex de Aula? (Sin distinguir mayúsculas en Windows.) */
  isManaged(executable: string | undefined): boolean {
    if (!executable) return false
    const rel = relative(this.folder, executable)
    return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..'
  }

  private async resolveAsset(): Promise<EngineAsset> {
    if (this.assetOverride) return this.assetOverride
    const triple = codexTriple(this.platform, this.arch)
    if (!triple) {
      const system = `${this.platform} ${this.arch}`
      throw new AulaError('ai_not_installed', tr(`No hay Codex oficial para ${system}.`, `There’s no official Codex for ${system}.`))
    }
    const pinned = this.version === CODEX_VERSION ? pinnedCodexAsset(triple) : undefined
    if (pinned) return pinned
    const cacheFile = join(this.folder, `release-${this.version}.json`)
    let assets = readJSON<{ assets?: GitHubAsset[] }>(cacheFile)?.assets
    if (!assets?.length) {
      let res: Response
      try {
        res = await this.fetchImpl(`https://api.github.com/repos/openai/codex/releases/tags/rust-v${encodeURIComponent(this.version)}`, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'Aula/2.0', 'x-github-api-version': '2022-11-28' }
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new AulaError('local_network', tr(`No pude consultar las versiones de Codex: ${reason}`, `I couldn’t check the Codex versions: ${reason}`))
      }
      if (!res.ok) {
        throw new AulaError('local_network', tr(`GitHub respondió ${res.status} al pedir Codex ${this.version}.`, `GitHub answered ${res.status} when asked for Codex ${this.version}.`))
      }
      const json = (await res.json().catch(() => undefined)) as { assets?: unknown } | undefined
      assets = (Array.isArray(json?.assets) ? json.assets : []).filter(
        (a): a is GitHubAsset => typeof a === 'object' && a !== null && typeof (a as GitHubAsset).name === 'string' && typeof (a as GitHubAsset).size === 'number'
      )
      mkdirSync(this.folder, { recursive: true })
      writeJSONAtomic(cacheFile, { assets: assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url, digest: a.digest ?? null })) })
    }
    const asset = pickCodexAsset(assets, triple)
    // sin huella publicada no se instala: es un programa que recibirá la sesión de ChatGPT
    if (!asset?.sha256) {
      throw new AulaError(
        'ai_not_installed',
        tr(
          `No encuentro un paquete verificable de Codex ${this.version} para este ordenador. Instálalo tú (npm i -g @openai/codex) y vuelve a intentarlo.`,
          `I can’t find a verifiable Codex ${this.version} package for this computer. Install it yourself (npm i -g @openai/codex) and try again.`
        )
      )
    }
    return asset
  }

  /**
   * Instala (o completa, si a la de antes le falta algo) y devuelve el ejecutable. De una en una: quien llega mientras otra
   * instala espera a que acabe y usa lo instalado. Cancelar deja la descarga a medias para continuarla después.
   */
  install(progress: (p: TransferProgress) => void = () => undefined, signal?: AbortSignal): Promise<string> {
    return this.serial(() => this.installNow(progress, signal), signal)
  }

  /**
   * Antes de lanzar `executable`: si es el Codex de Aula y su instalación está a medias (p. ej. una de antes, sin el host de
   * Code Mode), la completa sin preguntar y devuelve el ejecutable bueno; cualquier otro Codex se usa tal cual. Una vez por
   * sesión (ver `autoRepaired`): después se lanza tal cual y el error de Codex explica qué hacer.
   */
  async prepare(executable: string, progress?: (p: TransferProgress) => void, signal?: AbortSignal): Promise<string> {
    if (!this.isManaged(executable)) return executable
    const ready = this.binary
    if (ready) return ready
    if (this.autoRepaired) return executable
    return this.serial(() => this.repairNow(executable, progress ?? (() => undefined), signal), signal)
  }

  /** Cuando acabe lo que esté en marcha (instalar, completar o recoger), si hay algo. */
  whenIdle(signal?: AbortSignal): Promise<void> {
    return untilCancelled(this.chain.then(() => undefined), signal)
  }

  /** Recoge lo que dejó una instalación interrumpida (lo hace la app al arrancar; ver `tidyNow`). */
  tidy(): Promise<void> {
    return this.serial(() => this.tidyNow())
  }

  /** De una en una: `work` empieza cuando acaba lo anterior. Cancelar devuelve el control enseguida (lo empezado sigue). */
  private serial<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const turn = this.chain.then(work)
    this.chain = turn.catch(() => undefined)
    return untilCancelled(turn, signal)
  }

  private async repairNow(executable: string, progress: (p: TransferProgress) => void, signal?: AbortSignal): Promise<string> {
    // mientras esperaba su turno, otra pudo completarla (o intentarlo ya)
    const ready = this.binary
    if (ready) return ready
    if (this.autoRepaired) return executable
    try {
      const installed = await this.installNow(progress, signal)
      this.autoRepaired = true
      return installed
    } catch (err) {
      if (!retryableSoon(err)) this.autoRepaired = true
      throw err
    }
  }

  private async installNow(progress: (p: TransferProgress) => void, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new CancelledError()
    const ready = this.binary
    if (ready) return ready
    // si Aula se cerró a medias de otra instalación, lo que dejó puede bastar (y lo que sobra, fuera)
    await this.tidyNow()
    const recovered = this.binary
    if (recovered) return recovered
    mkdirSync(this.folder, { recursive: true })
    const asset = await this.resolveAsset()
    const sha256 = asset.sha256
    if (!sha256) {
      throw new AulaError(
        'ai_not_installed',
        tr(`«${asset.name}» no publica su huella SHA-256: no lo instalo por seguridad.`, `“${asset.name}” doesn’t publish its SHA-256 fingerprint, so I won’t install it, for security.`)
      )
    }
    const archive = join(this.folder, STAGING, basename(asset.name))
    await this.downloader.run([{ url: asset.url, destination: archive, bytes: asset.bytes, sha256 }], progress, signal)
    if (signal?.aborted) throw new CancelledError()
    const unpack = join(this.folder, `${UNPACKED}${randomBytes(4).toString('hex')}`)
    try {
      try {
        await extractArchive(archive, unpack)
      } catch (err) {
        // con la huella buena, volver a bajarlo daría los mismos bytes: se guarda; si se dañó en el disco, fuera
        if (err instanceof ArchiveError && !(await hasFingerprint(archive, sha256))) rmSync(archive, { force: true })
        throw err
      }
      this.checkPackage(unpack)
      // el marcador va dentro antes de moverla: la carpeta aparece completa de una vez (o no aparece)
      writeFileAtomic(join(unpack, '.installed'), this.version)
      await this.moveIntoPlace(unpack)
    } finally {
      await removeQuietly(unpack)
    }
    // ya en su sitio, otra vez: un antivirus puede quitar una pieza justo al moverla
    const missing = this.missingIn(this.installFolder)
    if (missing.length > 0) {
      const list = missing.join(', ')
      throw new AulaError(
        'ai_not_installed',
        tr(
          `Codex no quedó entero: falta ${list} justo después de instalarlo. Suele ser un antivirus que lo pone en cuarentena: permítelo en el antivirus y vuelve a abrir Aula.`,
          `Codex wasn’t left complete: ${list} is missing right after installing it. That’s usually an antivirus quarantining it: allow it in your antivirus and open Aula again.`
        )
      )
    }
    // versiones anteriores fuera (la carpeta de sesión y lo demás que no sea una versión se respeta). El paquete descargado se
    // queda hasta el próximo arranque (`tidy`): si antes desaparece una pieza, se completa sin volver a descargarlo
    for (const old of safeList(this.folder)) if (old !== this.version && /^\d+\.\d+/.test(old)) await removeQuietly(join(this.folder, old))
    return join(this.binFolder, executableName('codex', this.platform))
  }

  /**
   * La carpeta nueva, ya comprobada, a su sitio. Primero el cambio de nombre que en Windows retiene un rato el antivirus (el de
   * lo recién escrito), con la instalación de antes aún en su sitio; después, los dos rápidos: así casi nunca hay un momento
   * sin Codex. La de antes se aparta (no se borra) hasta que la nueva está colocada: si algo falla, vuelve.
   */
  private async moveIntoPlace(unpack: string): Promise<void> {
    const tag = randomBytes(4).toString('hex')
    const fresh = `${this.installFolder}${FRESH}${tag}`
    await this.rename(unpack, fresh)
    const previous = existsSync(this.installFolder) ? `${this.installFolder}${PREVIOUS}${tag}` : undefined
    try {
      if (previous) await this.rename(this.installFolder, previous)
      try {
        await this.rename(fresh, this.installFolder)
      } catch (err) {
        if (previous) await this.rename(previous, this.installFolder).catch(() => undefined)
        throw err
      }
    } catch (err) {
      // la nueva solo sobra si quedó una en su sitio; si no, la coloca `tidy` la próxima vez
      if (existsSync(this.installFolder)) await removeQuietly(fresh)
      throw err
    }
    if (previous) await removeQuietly(previous)
  }

  private rename(from: string, to: string): Promise<void> {
    return renameFolder(from, to, { platform: this.platform, rename: this.renameImpl })
  }

  /**
   * Lo que deja una instalación interrumpida (Aula se cerró a medias) o que Windows no dejó borrar: si falta la carpeta de la
   * versión, vuelve a su sitio la nueva si ya estaba comprobada entera o, si no, la de antes; las carpetas de trabajo, fuera; y
   * con Codex entero, también el paquete descargado. La carpeta de sesión (`home`) nunca se toca.
   */
  private async tidyNow(): Promise<void> {
    if (!existsSync(this.installFolder)) await this.restoreInterrupted()
    for (const name of safeList(this.folder)) if (isWorkFolder(name)) await removeQuietly(join(this.folder, name))
    if (this.binary) await removeQuietly(join(this.folder, STAGING))
  }

  private async restoreInterrupted(): Promise<void> {
    const names = safeList(this.folder)
    const fresh = names.filter((n) => (n.startsWith(UNPACKED) || n.startsWith(this.version + FRESH)) && this.missingIn(join(this.folder, n)).length === 0)
    const previous = names.filter((n) => n.startsWith(this.version + PREVIOUS) && isFile(join(this.folder, n, '.installed')))
    for (const name of [...fresh, ...previous]) {
      try {
        await this.rename(join(this.folder, name), this.installFolder)
        return
      } catch {
        /* la siguiente */
      }
    }
  }

  /** El paquete trae todo lo que Codex necesita a su lado; en macOS y Linux, sus programas quedan ejecutables. */
  private checkPackage(folder: string): void {
    const missing = codexRequiredFiles(this.platform).filter((rel) => !isFile(join(folder, ...rel.split('/'))))
    if (missing.length > 0) {
      const list = missing.join(', ')
      throw new AulaError(
        'ai_not_installed',
        tr(
          `Al descomprimir Codex falta lo que necesita para funcionar (${list}). Si un antivirus lo ha puesto en cuarentena, permítelo y vuelve a abrir Aula.`,
          `After unpacking Codex, what it needs to work is missing (${list}). If an antivirus quarantined it, allow it and open Aula again.`
        )
      )
    }
    if (this.platform === 'win32') return
    for (const rel of POSIX_EXECUTABLES) {
      const path = join(folder, ...rel.split('/'))
      if (isFile(path)) chmodSync(path, 0o755)
    }
  }
}

/**
 * ¿Vale la pena que se vuelva a intentar sola en esta sesión? Solo si no llegó a tener el paquete entero: cancelada, sin red o
 * sin sitio (la próxima vez sigue donde lo dejó). Lo demás (otra huella, un paquete que no se abre, una pieza que desaparece…)
 * se repetiría igual.
 */
function retryableSoon(err: unknown): boolean {
  if (isCancellation(err)) return true
  if (err instanceof DownloadError) return err.kind === 'network' || err.kind === 'noSpace' || err.transient
  return err instanceof AulaError && err.code === 'local_network' // la lista de GitHub (otra versión que la fijada)
}

/** ¿El archivo sigue teniendo esta huella SHA-256? */
async function hasFingerprint(path: string, sha256: string): Promise<boolean> {
  try {
    return (await sha256OfFile(path)) === sha256.toLowerCase()
  } catch {
    return false
  }
}

// MARK: El Codex de Aula de la app

let appCodex: ManagedCodex | undefined

/** Fija el Codex de Aula que revisa `prepareCodexExecutable` (lo hace el servicio de agentes de la app al crearse). */
export function setAppManagedCodex(codex: ManagedCodex | undefined): void {
  appCodex = codex
}

/** Antes de lanzar Codex: el de Aula, completo (ver `ManagedCodex.prepare`); cualquier otro, tal cual. */
export function prepareCodexExecutable(executable: string, progress?: (p: TransferProgress) => void, signal?: AbortSignal): Promise<string> {
  return appCodex ? appCodex.prepare(executable, progress, signal) : Promise.resolve(executable)
}

/** Cuando el Codex de Aula de la app acabe lo que esté haciendo (instalar, completar o recoger), si hace algo. */
export function appCodexIdle(signal?: AbortSignal): Promise<void> {
  return appCodex ? appCodex.whenIdle(signal) : Promise.resolve()
}

// MARK: Utilidades

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function safeList(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}

/** Borra lo que sobra sin hacer fallar la instalación (en Windows, un archivo retenido se reintenta y, si no, queda para la próxima). */
async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
}

const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Cambia de nombre una carpeta. En Windows, el antivirus revisa los `.exe` recién descomprimidos y mientras tanto el cambio de
 * nombre falla con EPERM/EACCES/EBUSY aunque nada esté mal: se reintenta sin bloquear, hasta `maxWaitMs`.
 */
export async function renameFolder(from: string, to: string, o: { platform?: NodeJS.Platform; maxWaitMs?: number; rename?: (from: string, to: string) => void } = {}): Promise<void> {
  const rename = o.rename ?? renameSync
  const until = Date.now() + (o.maxWaitMs ?? 30_000)
  for (let pause = 50; ; pause = Math.min(pause * 2, 1000)) {
    try {
      return rename(from, to)
    } catch (err) {
      const busy = BUSY.has((err as NodeJS.ErrnoException).code ?? '')
      if ((o.platform ?? process.platform) !== 'win32' || !busy || Date.now() >= until) throw err
      await new Promise((resolve) => setTimeout(resolve, pause))
    }
  }
}

/** Lo que dé `promise`, salvo que `signal` se cancele antes: entonces, `CancelledError` sin esperar más. */
function untilCancelled<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new CancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new CancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}
