// El Codex que gestiona Aula: el binario OFICIAL de OpenAI (releases de GitHub, versión fijada) en `<datos>/tools/codex/<versión>/`
// y su carpeta de sesión `<datos>/tools/codex/home` (port de `LocalAIKit/Engines/ToolInstaller.swift` + `ManagedCodex`).
// SHA-256 comprobado (nada se ejecuta sin comprobarlo), descompresión en una carpeta nueva sin enlaces que salgan, y solo
// entonces a su sitio. Nada de npm ni Homebrew.
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, join } from 'node:path'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { readJSON, writeFileAtomic, writeJSONAtomic } from '../fs'
import { extractArchive } from '../local-ai/archive'
import { Downloader, type FetchLike, type TransferProgress } from '../local-ai/downloader'
import { type EngineAsset, type GitHubAsset } from '../local-ai/engine'
import { CancelledError } from './errors'

/** Codex CLI oficial (Apache-2.0), la versión estable que fijó la app Swift (`rust-v0.162.1`, 2026-10-09). */
export const CODEX_VERSION = '0.162.1'
export const CODEX_TAG = `rust-v${CODEX_VERSION}`

/** Paquetes fijados de macOS (tamaño y SHA-256 del `digest` de GitHub, copiados de la app Swift). */
export const PINNED_CODEX_MAC: Record<'arm64' | 'x64', EngineAsset> = {
  arm64: {
    name: 'codex-aarch64-apple-darwin.tar.gz',
    url: 'https://github.com/openai/codex/releases/download/rust-v0.162.1/codex-aarch64-apple-darwin.tar.gz',
    bytes: 98_104_184,
    sha256: 'b293a0fcdd871900a44c0a4f40a1aa401b31e02854f790ebdb8bd5d1177fd1fe'
  },
  x64: {
    name: 'codex-x86_64-apple-darwin.tar.gz',
    url: 'https://github.com/openai/codex/releases/download/rust-v0.162.1/codex-x86_64-apple-darwin.tar.gz',
    bytes: 107_055_460,
    sha256: 'd68e39d8f62639f33f7d00656554cb9c3ef7809e664a3827e62ab3ace3c21b21'
  }
}

/** SHA-256 de los paquetes de Windows y Linux de rust-v0.162.1, fijados (A2-P2-21; copiados del `digest` de GitHub). */
export const PINNED_CODEX_SHA256: Readonly<Record<string, string>> = {
  'codex-aarch64-pc-windows-msvc.exe.zip': 'b1dee1f092e13be97ccc1ed67cc73d9e113e5d72e04ef26ef5ed8025f55165d8',
  'codex-x86_64-pc-windows-msvc.exe.zip': '4b17206ed3045de64064b2016627d51fba3bde386d03838312054882a64d781d',
  'codex-aarch64-unknown-linux-musl.tar.gz': 'bf3ca2719f1143b1440fbd85c149379e696c782c50ad7991f8bfcec60b2600c1',
  'codex-x86_64-unknown-linux-musl.tar.gz': '86f268d81b898f3e144c5ecff2ad2fda2c5802e042d6195b72538fe0fa125057'
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

/** El paquete de Codex para este sistema en la lista de una versión de GitHub. */
export function pickCodexAsset(assets: GitHubAsset[], triple: string): EngineAsset | undefined {
  const names = triple.endsWith('windows-msvc') ? [`codex-${triple}.exe.zip`, `codex-${triple}.zip`] : [`codex-${triple}.tar.gz`, `codex-${triple}.zip`]
  for (const name of names) {
    const a = assets.find((x) => x.name === name)
    if (!a || !(a.size > 0) || !/^https:\/\/github\.com\//.test(a.browser_download_url)) continue
    const sha = typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(a.digest) ? a.digest.slice(7).toLowerCase() : undefined
    // la huella fijada manda; otra distinta en GitHub para el mismo nombre = el archivo cambió: no se usa
    const pinned = PINNED_CODEX_SHA256[a.name]
    if (pinned && sha && sha !== pinned) continue
    return { name: a.name, url: a.browser_download_url, bytes: a.size, sha256: pinned ?? sha }
  }
  return undefined
}

export interface ManagedCodexOptions {
  /** Carpeta de datos de Aula. */
  root: string
  version?: string
  /** Paquete propio (pruebas). */
  asset?: EngineAsset
  downloader?: Downloader
  fetch?: FetchLike
}

const isWindows = process.platform === 'win32'

export class ManagedCodex {
  readonly folder: string
  readonly version: string
  private readonly assetOverride?: EngineAsset
  private readonly downloader: Downloader
  private readonly fetchImpl: FetchLike

  constructor(options: ManagedCodexOptions) {
    this.folder = join(options.root, 'tools', 'codex')
    this.version = options.version ?? CODEX_VERSION
    this.assetOverride = options.asset
    this.downloader = options.downloader ?? new Downloader({ diskMargin: 512 * 1_048_576, fetch: options.fetch })
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
  }

  /** `CODEX_HOME` de Aula. */
  get sessionFolder(): string {
    return join(this.folder, 'home')
  }
  get installFolder(): string {
    return join(this.folder, this.version)
  }

  /** El ejecutable instalado de la versión fijada, o `undefined`. */
  get binary(): string | undefined {
    const path = join(this.installFolder, isWindows ? 'codex.exe' : 'codex')
    try {
      return existsSync(join(this.installFolder, '.installed')) && statSync(path).isFile() ? path : undefined
    } catch {
      return undefined
    }
  }

  /** ¿Es esta ruta el Codex de Aula? */
  isManaged(executable: string | undefined): boolean {
    return !!executable && executable.startsWith(this.folder + (isWindows ? '\\' : '/'))
  }

  private async resolveAsset(): Promise<EngineAsset> {
    if (this.assetOverride) return this.assetOverride
    if (process.platform === 'darwin' && this.version === CODEX_VERSION) return PINNED_CODEX_MAC[process.arch === 'arm64' ? 'arm64' : 'x64']
    const triple = codexTriple()
    if (!triple) {
      const system = `${process.platform} ${process.arch}`
      throw new AulaError('ai_not_installed', tr(`No hay Codex oficial para ${system}.`, `There’s no official Codex for ${system}.`))
    }
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

  /** Instala (si falta) y devuelve el ejecutable. Cancelar deja la descarga a medias para continuarla después. */
  async install(progress: (p: TransferProgress) => void = () => undefined, signal?: AbortSignal): Promise<string> {
    const ready = this.binary
    if (ready) return ready
    mkdirSync(this.folder, { recursive: true })
    const asset = await this.resolveAsset()
    if (!asset.sha256) {
      throw new AulaError(
        'ai_not_installed',
        tr(`«${asset.name}» no publica su huella SHA-256: no lo instalo por seguridad.`, `“${asset.name}” doesn’t publish its SHA-256 fingerprint, so I won’t install it, for security.`)
      )
    }
    const staging = join(this.folder, 'descarga')
    const archive = join(staging, basename(asset.name))
    await this.downloader.run([{ url: asset.url, destination: archive, bytes: asset.bytes, sha256: asset.sha256 }], progress, signal)
    if (signal?.aborted) throw new CancelledError()
    const unpack = join(this.folder, `desempaquetado-${randomBytes(4).toString('hex')}`)
    try {
      await extractArchive(archive, unpack)
      const triple = codexTriple() ?? ''
      const names = isWindows ? ['codex.exe', `codex-${triple}.exe`] : ['codex', `codex-${triple}`]
      const exe = findFirst(unpack, names)
      if (!exe) throw new AulaError('ai_not_installed', tr('El paquete de Codex no trae el programa «codex».', 'The Codex package doesn’t include the “codex” program.'))
      rmSync(this.installFolder, { recursive: true, force: true })
      mkdirSync(this.installFolder, { recursive: true })
      const target = join(this.installFolder, isWindows ? 'codex.exe' : 'codex')
      renameSync(exe, target)
      if (!isWindows) chmodSync(target, 0o755)
      writeFileAtomic(join(this.installFolder, '.installed'), this.version)
    } finally {
      rmSync(unpack, { recursive: true, force: true })
    }
    rmSync(staging, { recursive: true, force: true })
    // versiones anteriores fuera (la carpeta de sesión y lo demás que no sea una versión se respeta)
    for (const old of safeList(this.folder)) if (old !== this.version && /^\d+\.\d+/.test(old)) rmSync(join(this.folder, old), { recursive: true, force: true })
    return join(this.installFolder, isWindows ? 'codex.exe' : 'codex')
  }
}

function safeList(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}

function findFirst(root: string, names: string[]): string | undefined {
  for (const name of names) {
    const stack = [root]
    while (stack.length > 0) {
      const dir = stack.pop()!
      for (const entry of safeList(dir)) {
        const path = join(dir, entry)
        try {
          const st = lstatSync(path)
          if (st.isDirectory()) stack.push(path)
          else if (st.isFile() && entry === name) return path
        } catch {
          /* nada */
        }
      }
    }
  }
  return undefined
}
