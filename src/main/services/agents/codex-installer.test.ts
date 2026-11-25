// El Codex que instala Aula (issue #66): el paquete oficial completo, con el host de Code Mode junto a `codex`; las
// instalaciones de antes (solo `codex`, sin el host) se completan solas antes de usarlas; la huella se comprueba; y los nombres
// de Windows (`.exe`) se prueban simulando el sistema. Paquetes falsos servidos en local.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AulaError } from '../errors'
import { FakeServer, reply } from '../local-ai/__fixtures__/fake-server'
import { DownloadError, Downloader } from '../local-ai/downloader'
import {
  appCodexIdle,
  CODEX_TAG,
  codexPackageName,
  codexRequiredFiles,
  codexTriple,
  ManagedCodex,
  pickCodexAsset,
  pinnedCodexAsset,
  prepareCodexExecutable,
  renameFolder,
  setAppManagedCodex
} from './codex-installer'
import { fakeCodexPackage, sha256, type FakeCodexPackage } from './__fixtures__/codex-package'
import { cleanupTempDirs, makeTempDir, posixIt } from './__fixtures__/support'

const PACKAGE_PATH = '/codex-package-test.tar.gz'
const exe = (name: string, platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? `${name}.exe` : name)

let root: string
let servers: FakeServer[] = []

beforeEach(() => {
  root = makeTempDir('codex-installer')
})
afterEach(async () => {
  setAppManagedCodex(undefined)
  await Promise.all(servers.splice(0).map((s) => s.stop()))
  cleanupTempDirs()
})

/** Sirve un paquete y dice cuántas veces se descargó. */
async function serve(data: Buffer): Promise<{ url: string; downloads: () => number }> {
  const server = new FakeServer((r) => (r.path === PACKAGE_PATH ? reply.file(data, r) : reply.notFound()))
  servers.push(server)
  const origin = await server.start()
  return { url: origin + PACKAGE_PATH, downloads: () => server.requestsTo(PACKAGE_PATH).length }
}

/** Un Codex de Aula que instala `data` (con su huella, o con otra si se pide). */
async function managedWith(
  pkg: FakeCodexPackage = {},
  o: { sha256?: string; data?: Buffer; rename?: (from: string, to: string) => void } = {}
): Promise<{ codex: ManagedCodex; downloads: () => number }> {
  const platform = pkg.platform ?? process.platform
  const data = o.data ?? fakeCodexPackage({ ...pkg, platform })
  const { url, downloads } = await serve(data)
  const codex = new ManagedCodex({
    root,
    platform,
    rename: o.rename,
    asset: { name: 'codex-package-test.tar.gz', url, bytes: data.length, sha256: o.sha256 ?? sha256(data) },
    downloader: new Downloader({ attempts: 1, retryDelayMs: 0, diskMargin: 0, freeSpace: () => 2 ** 40 })
  })
  return { codex, downloads }
}

/** Lo que dejaban las versiones anteriores de Aula: `codex` suelto (sin el host) y el marcador. */
function legacyInstall(codex: ManagedCodex): string {
  mkdirSync(codex.installFolder, { recursive: true })
  const path = join(codex.installFolder, exe('codex', codex.platform))
  writeFileSync(path, '#!/bin/sh\n', { mode: 0o755 })
  writeFileSync(join(codex.installFolder, '.installed'), codex.version)
  return path
}

/** Carpetas temporales que no deben quedar tras instalar (el paquete en `descarga/` se recoge con `tidy()`). */
const workLeftovers = (codex: ManagedCodex): string[] =>
  readdirSync(codex.folder).filter((n) => n.startsWith('desempaquetado-') || n.includes('.nueva-') || n.includes('.anterior-'))

describe('Paquetes oficiales fijados', () => {
  it('los seis sistemas de Aula tienen su paquete completo fijado (tamaño y SHA-256), sin pasar por la API de GitHub', () => {
    const systems: [NodeJS.Platform, string, string][] = [
      ['darwin', 'arm64', 'aarch64-apple-darwin'],
      ['darwin', 'x64', 'x86_64-apple-darwin'],
      ['win32', 'x64', 'x86_64-pc-windows-msvc'],
      ['win32', 'arm64', 'aarch64-pc-windows-msvc'],
      ['linux', 'x64', 'x86_64-unknown-linux-musl'],
      ['linux', 'arm64', 'aarch64-unknown-linux-musl']
    ]
    for (const [platform, arch, triple] of systems) {
      expect(codexTriple(platform, arch)).toBe(triple)
      const asset = pinnedCodexAsset(triple)
      expect(asset?.name).toBe(`codex-package-${triple}.tar.gz`)
      expect(asset?.url).toBe(`https://github.com/openai/codex/releases/download/${CODEX_TAG}/codex-package-${triple}.tar.gz`)
      expect(asset?.bytes).toBeGreaterThan(100_000_000)
      expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(new Set(systems.map(([, , t]) => pinnedCodexAsset(t)?.sha256)).size).toBe(6)
    expect(codexTriple('linux', 'ia32')).toBeUndefined()
    expect(codexTriple('freebsd', 'x64')).toBeUndefined()
  })

  it('otra versión: el paquete completo, solo desde github.com y con su huella publicada', () => {
    const triple = 'x86_64-pc-windows-msvc'
    const url = `https://github.com/openai/codex/releases/download/rust-v9.9.9/${codexPackageName(triple)}`
    const assets = [
      { name: `codex-${triple}.exe.zip`, size: 10, browser_download_url: url.replace('codex-package-', 'codex-'), digest: 'sha256:' + 'a'.repeat(64) },
      { name: codexPackageName(triple), size: 10, browser_download_url: url, digest: 'sha256:' + 'B'.repeat(64) }
    ]
    expect(pickCodexAsset(assets, triple)).toEqual({ name: codexPackageName(triple), url, bytes: 10, sha256: 'b'.repeat(64) })
    expect(pickCodexAsset([{ ...assets[1], digest: null }], triple)?.sha256).toBeUndefined() // sin huella: no se instalará
    expect(pickCodexAsset([{ ...assets[1], browser_download_url: 'https://evil.example/x.tar.gz' }], triple)).toBeUndefined()
    expect(pickCodexAsset(assets.slice(0, 1), triple)).toBeUndefined() // el .exe.zip suelto no vale
  })

  it('lo que tiene que estar junto a codex: el host de Code Mode (con .exe en Windows)', () => {
    expect(codexRequiredFiles('win32')).toEqual(['codex-package.json', 'bin/codex.exe', 'bin/codex-code-mode-host.exe'])
    expect(codexRequiredFiles('darwin')).toEqual(['codex-package.json', 'bin/codex', 'bin/codex-code-mode-host'])
    expect(codexRequiredFiles('linux')).toEqual(codexRequiredFiles('darwin'))
  })
})

describe('Instalar', () => {
  it('instalación nueva: el paquete entero, con el host de Code Mode junto a codex', async () => {
    const { codex } = await managedWith()
    mkdirSync(join(codex.folder, '0.150.0'), { recursive: true }) // una versión vieja: fuera
    mkdirSync(codex.sessionFolder, { recursive: true }) // la sesión de ChatGPT: se respeta
    const binary = await codex.install()
    expect(binary).toBe(join(root, 'tools', 'codex', '0.162.1', 'bin', exe('codex')))
    expect(codex.binary).toBe(binary)
    for (const rel of [...codexRequiredFiles(), `codex-path/${exe('rg')}`, 'codex-resources/voice/NOTICE.md', '.installed']) {
      expect(existsSync(join(codex.installFolder, ...rel.split('/'))), rel).toBe(true)
    }
    expect(existsSync(join(codex.folder, '0.150.0'))).toBe(false)
    expect(existsSync(codex.sessionFolder)).toBe(true)
    expect(workLeftovers(codex)).toEqual([])
    // `descarga/` se guarda hasta el próximo arranque (`tidy()`), y entonces desaparece con Codex entero
    expect(existsSync(join(codex.folder, 'descarga'))).toBe(true)
    await codex.tidy()
    expect(existsSync(join(codex.folder, 'descarga'))).toBe(false)
    expect(existsSync(codex.sessionFolder)).toBe(true)
  })

  posixIt('en macOS y Linux codex y el host quedan ejecutables aunque el tar no lo diga', async () => {
    const { codex } = await managedWith({ mode: 0o644 })
    await codex.install()
    for (const rel of ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg']) {
      expect(statSync(join(codex.installFolder, ...rel.split('/'))).mode & 0o777, rel).toBe(0o755)
    }
  })

  it('Windows (simulado): bin\\codex.exe y, a su lado, bin\\codex-code-mode-host.exe', async () => {
    const { codex } = await managedWith({ platform: 'win32' })
    expect(await codex.install()).toBe(join(codex.installFolder, 'bin', 'codex.exe'))
    expect(existsSync(join(codex.binFolder, 'codex-code-mode-host.exe'))).toBe(true)
  })

  it('Windows (simulado): un host sin .exe no cuenta', async () => {
    const { codex } = await managedWith({ platform: 'win32', hostName: 'codex-code-mode-host' })
    const err = await codex.install().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AulaError)
    expect((err as AulaError).message).toContain('bin/codex-code-mode-host.exe')
    expect(codex.binary).toBeUndefined()
  })

  it('un paquete sin el host no se instala y no toca lo que había', async () => {
    const { codex } = await managedWith({ host: false })
    const legacy = legacyInstall(codex)
    const err = await codex.install().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AulaError)
    expect((err as AulaError).code).toBe('ai_not_installed')
    expect((err as AulaError).message).toContain(`bin/${exe('codex-code-mode-host')}`)
    expect(existsSync(legacy)).toBe(true) // la instalación anterior sigue ahí
    expect(codex.binary).toBeUndefined()
    expect(readdirSync(codex.folder).filter((n) => n.startsWith('desempaquetado-'))).toEqual([])
  })

  it('un sistema sin paquete oficial: se dice, sin descargar nada', async () => {
    const codex = new ManagedCodex({ root, platform: 'freebsd', arch: 'x64', fetch: () => Promise.reject(new Error('sin red en esta prueba')) })
    const err = await codex.install().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AulaError)
    expect((err as AulaError).code).toBe('ai_not_installed')
    expect((err as AulaError).message).toContain('freebsd x64')
  })

  it('verificación que falla: con otra huella no se instala nada', async () => {
    const { codex } = await managedWith({}, { sha256: 'f'.repeat(64) })
    const err = await codex.install().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DownloadError)
    expect((err as DownloadError).kind).toBe('integrity')
    expect(existsSync(codex.installFolder)).toBe(false)
    expect(codex.binary).toBeUndefined()
    const staging = join(codex.folder, 'descarga')
    expect(existsSync(staging) ? readdirSync(staging).filter((n) => !n.startsWith('.')) : []).toEqual([]) // ni el paquete ni el .part
  })

  it('un paquete con la huella fijada que no se puede abrir se conserva (volver a bajarlo daría lo mismo)', async () => {
    const data = gzipSync(Buffer.from('esto no es un tar'.repeat(64)))
    const { codex } = await managedWith({}, { data })
    await expect(codex.install()).rejects.toThrow()
    expect(existsSync(join(codex.folder, 'descarga', 'codex-package-test.tar.gz'))).toBe(true)
    expect(codex.binary).toBeUndefined()
  })

  it('dos peticiones a la vez: una sola descarga', async () => {
    const { codex, downloads } = await managedWith()
    const [a, b] = await Promise.all([codex.install(), codex.install()])
    expect(a).toBe(b)
    expect(downloads()).toBe(1)
  })

  it('Windows: si el antivirus retiene un momento la carpeta nueva, se reintenta el cambio de nombre (sin bloquear)', async () => {
    const busy = (code: string) => Object.assign(new Error(code), { code })
    let calls = 0
    const flaky = (): void => {
      calls += 1
      if (calls < 3) throw busy('EPERM')
    }
    await renameFolder('a', 'b', { platform: 'win32', rename: flaky })
    expect(calls).toBe(3)
    // fuera de Windows, u otro error, u otro plazo agotado: se informa enseguida
    await expect(renameFolder('a', 'b', { platform: 'darwin', rename: () => { throw busy('EPERM') } })).rejects.toThrow('EPERM')
    await expect(renameFolder('a', 'b', { platform: 'win32', rename: () => { throw busy('ENOENT') } })).rejects.toThrow('ENOENT')
    await expect(renameFolder('a', 'b', { platform: 'win32', maxWaitMs: 120, rename: () => { throw busy('EBUSY') } })).rejects.toThrow('EBUSY')
  })

  it('cancelar mientras espera a otra instalación no la estropea', async () => {
    const { codex, downloads } = await managedWith()
    const first = codex.install()
    const controller = new AbortController()
    const second = codex.install(undefined, controller.signal)
    controller.abort()
    const err = await second.catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(await first).toBe(codex.binary)
    expect(downloads()).toBe(1)
  })
})

describe('Las instalaciones de antes (sin el host) se completan solas', () => {
  it('la de antes no cuenta como instalada', async () => {
    const { codex } = await managedWith()
    legacyInstall(codex)
    expect(codex.binary).toBeUndefined()
  })

  it('antes de usarla se completa sin preguntar y se usa la buena', async () => {
    const { codex, downloads } = await managedWith()
    const legacy = legacyInstall(codex)
    const progress: number[] = []
    const ready = await codex.prepare(legacy, (p) => progress.push(p.bytesDone))
    expect(ready).toBe(join(codex.binFolder, exe('codex')))
    expect(existsSync(join(codex.binFolder, exe('codex-code-mode-host')))).toBe(true)
    expect(existsSync(legacy)).toBe(false) // la carpeta vieja se sustituyó entera
    expect(workLeftovers(codex)).toEqual([])
    expect(progress.length).toBeGreaterThan(0)
    expect(await codex.prepare(ready)).toBe(ready)
    expect(downloads()).toBe(1)
  })

  it('Windows (simulado): codex.exe suelto, como en el issue #66, se completa', async () => {
    const { codex } = await managedWith({ platform: 'win32' })
    const legacy = legacyInstall(codex)
    expect(legacy.endsWith('codex.exe')).toBe(true)
    expect(await codex.prepare(legacy)).toBe(join(codex.installFolder, 'bin', 'codex.exe'))
    expect(existsSync(join(codex.installFolder, 'bin', 'codex-code-mode-host.exe'))).toBe(true)
  })

  it('a otro Codex (el del usuario) no se le toca', async () => {
    const { codex, downloads } = await managedWith()
    const own = join(root, 'npm', exe('codex'))
    expect(await codex.prepare(own)).toBe(own)
    expect(downloads()).toBe(0)
  })

  it('una vez por sesión: si después vuelve a faltar el host, no se descarga otra vez', async () => {
    const { codex, downloads } = await managedWith()
    const ready = await codex.prepare(legacyInstall(codex))
    rmSync(join(codex.binFolder, exe('codex-code-mode-host')))
    expect(codex.binary).toBeUndefined()
    expect(await codex.prepare(ready)).toBe(ready) // se lanza tal cual: el error de Codex lo explicará
    expect(downloads()).toBe(1)
  })

  it('si falla por red o cancelación, se reintenta la próxima vez; si falla por huella o antivirus, no entra en bucle', async () => {
    // fallo de red / pasajero (503): retryableSoon = true, vuelve a intentar
    let failNetwork = true
    const data = fakeCodexPackage({ platform: process.platform })
    const server = new FakeServer((r) => {
      if (r.path !== PACKAGE_PATH) return reply.notFound()
      return failNetwork ? reply.text('busy', 503) : reply.file(data, r)
    })
    servers.push(server)
    const origin = await server.start()
    const netCodex = new ManagedCodex({
      root: makeTempDir('codex-net'),
      platform: process.platform,
      asset: { name: 'codex-package-test.tar.gz', url: origin + PACKAGE_PATH, bytes: data.length, sha256: sha256(data) },
      downloader: new Downloader({ attempts: 1, retryDelayMs: 0, diskMargin: 0, freeSpace: () => 2 ** 40 })
    })
    const netLegacy = legacyInstall(netCodex)
    await expect(netCodex.prepare(netLegacy)).rejects.toThrow()
    failNetwork = false
    expect(await netCodex.prepare(netLegacy)).toBe(netCodex.binary)

    // huella distinta: no se reintenta en bucle en la misma sesión
    const { codex, downloads } = await managedWith({}, { sha256: 'f'.repeat(64) })
    const legacy = legacyInstall(codex)
    await expect(codex.prepare(legacy)).rejects.toThrow()
    expect(await codex.prepare(legacy)).toBe(legacy)
    expect(downloads()).toBe(1)
    expect(existsSync(legacy)).toBe(true)
  })

  it('si un antivirus quita el host justo al colocar la carpeta: avisa, conserva el paquete y no descarga en bucle', async () => {
    const { codex, downloads } = await managedWith({}, {
      rename: (from, to) => {
        renameSync(from, to)
        // simula el antivirus poniendo en cuarentena el host justo cuando la carpeta llega a su sitio final
        if (to === codex.installFolder) rmSync(join(to, 'bin', exe('codex-code-mode-host')), { force: true })
      }
    })
    const legacy = legacyInstall(codex)
    const err = await codex.prepare(legacy).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AulaError)
    expect((err as AulaError).message).toContain('antivirus')
    expect(existsSync(join(codex.folder, 'descarga', 'codex-package-test.tar.gz'))).toBe(true)
    // siguiente llamada en la misma sesión: no vuelve a descargar
    expect(await codex.prepare(legacy)).toBe(legacy)
    expect(downloads()).toBe(1)
  })

  it('tidy() recoge carpetas de una instalación interrumpida y restaura la versión (nueva completa o anterior)', async () => {
    const { codex } = await managedWith()
    await codex.install()
    mkdirSync(codex.sessionFolder, { recursive: true })
    // simula cierre a medias: la carpeta de versión no está, pero quedó `.nueva-deadbeef` completa y `.anterior-cafe1234` vieja
    const fresh = `${codex.installFolder}.nueva-deadbeef`
    renameSync(codex.installFolder, fresh)
    const previous = `${codex.installFolder}.anterior-cafe1234`
    mkdirSync(previous, { recursive: true })
    writeFileSync(join(previous, '.installed'), codex.version)
    mkdirSync(join(codex.folder, 'desempaquetado-12345678'), { recursive: true })
    expect(codex.binary).toBeUndefined()

    await codex.tidy()
    expect(codex.binary).toBe(join(codex.binFolder, exe('codex')))
    expect(workLeftovers(codex)).toEqual([])
    expect(existsSync(join(codex.folder, 'descarga'))).toBe(false)
    expect(existsSync(codex.sessionFolder)).toBe(true)

    // si solo queda `.anterior-*` (no había nueva entera), la restaura para no dejar a Aula sin Codex
    renameSync(codex.installFolder, `${codex.installFolder}.anterior-11223344`)
    expect(existsSync(codex.installFolder)).toBe(false)
    await codex.tidy()
    expect(existsSync(codex.installFolder)).toBe(true)
    expect(workLeftovers(codex)).toEqual([])
  })

  it('whenIdle() y appCodexIdle() esperan a una instalación en curso (y respetan la cancelación)', async () => {
    const { codex } = await managedWith()
    setAppManagedCodex(codex)
    const installing = codex.install()
    await appCodexIdle()
    expect(codex.binary).toBe(await installing)
    const c = new AbortController()
    c.abort()
    await expect(appCodexIdle(c.signal)).rejects.toThrow()
  })

  it('prepareCodexExecutable revisa el Codex de la app (y sin él, nada)', async () => {
    const { codex, downloads } = await managedWith()
    const legacy = legacyInstall(codex)
    expect(await prepareCodexExecutable(legacy)).toBe(legacy)
    setAppManagedCodex(codex)
    expect(await prepareCodexExecutable(legacy)).toBe(codex.binary)
    expect(downloads()).toBe(1)
  })

  it('qué rutas son del Codex de Aula', async () => {
    const { codex } = await managedWith()
    expect(codex.isManaged(join(codex.installFolder, 'codex'))).toBe(true)
    expect(codex.isManaged(join(codex.binFolder, 'codex'))).toBe(true)
    expect(codex.isManaged(join(root, 'tools', 'codexx', 'codex'))).toBe(false)
    expect(codex.isManaged(codex.folder)).toBe(false)
    expect(codex.isManaged(undefined)).toBe(false)
  })
})
