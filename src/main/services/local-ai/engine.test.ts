// Port de `Tests/LocalAIKitTests/EngineTests.swift`: el motor de Aula con un paquete falso servido en 127.0.0.1 (instalación
// verificada) y un `llama-server` falso que solo contesta con la clave (arranque, reutilización, parada, fallos, vigilante).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupTempDirs, makeTempDir, processExists, waitUntil, writeExecutable } from '../agents/__fixtures__/support'
import { FakeServer, reply } from './__fixtures__/fake-server'
import { tar, tarEntry } from './__fixtures__/tar'
import { Downloader } from './downloader'
import { AulaEngine, ENGINE_BUILD, EngineError, engineVariants, freePort, pickEngineAsset, PINNED_ENGINE_SHA256, PINNED_MAC_ASSETS, startWatchdog, variantUsesGPU, type EngineAsset } from './engine'

const FAKE = join(__dirname, '__fixtures__', 'fake-llama-server.cjs')
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
// el `llama-server` falso es un guion (#!/bin/sh): en Windows haría falta un .exe de verdad, así que esas pruebas no corren allí
const windows = process.platform === 'win32'
const EXE = windows ? 'llama-server.exe' : 'llama-server'

let folder: string
let servers: FakeServer[] = []
const envKeys = ['FAKE_LLAMA_ARGS', 'FAKE_LLAMA_FAIL', 'FAKE_LLAMA_CACHE_FAIL', 'FAKE_LLAMA_LOAD_MS']
const engines: AulaEngine[] = []

beforeEach(() => {
  folder = makeTempDir('engine')
})
afterEach(async () => {
  for (const e of engines.splice(0)) e.stop()
  for (const k of envKeys) delete process.env[k]
  await Promise.all(servers.splice(0).map((s) => s.stop()))
  cleanupTempDirs()
})

/** Un motor «instalado» cuyo `llama-server` es el guion falso. */
function installedEngine(variant = 'macos-arm64'): { engine: AulaEngine; model: string } {
  const engine = new AulaEngine({ folder: join(folder, 'engine'), build: 'b9999', variant, preferredPort: 0, pollIntervalMs: 50, verifySignature: false })
  engines.push(engine)
  const dir = join(engine.installFolder, 'llama-b9999')
  mkdirSync(dir, { recursive: true })
  writeExecutable(join(dir, 'llama-server'), `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`)
  writeFileSync(join(engine.installFolder, '.installed'), 'llama-b9999/llama-server')
  const model = join(folder, 'm.gguf')
  writeFileSync(model, 'GGUF')
  return { engine, model }
}

describe('AulaEngine · arrancar y apagar', () => {
  it.skipIf(windows)('arranca, atiende solo con la clave, reutiliza y se apaga', async () => {
    const { engine, model } = installedEngine()
    const argsFile = join(folder, 'args.json')
    process.env.FAKE_LLAMA_ARGS = argsFile
    const s = await engine.start({ model, alias: 'qwen3.5-9b', modelId: 'qwen3.5-9b', context: 32_768, loadTimeoutMs: 30_000 })
    expect(processExists(s.pid)).toBe(true)
    expect(await engine.healthy(s)).toBe(true)
    expect(s.apiKey.startsWith('aula-') && s.apiKey.length > 40).toBe(true)
    expect(s.baseURL).toBe(`http://127.0.0.1:${s.port}/v1`)
    expect(await engine.healthy({ port: s.port, apiKey: 'otra' })).toBe(false) // sin la clave no atiende
    const res = await fetch(`http://127.0.0.1:${s.port}/health`)
    expect(res.status).toBe(401)
    const args: string[] = JSON.parse(readFileSync(argsFile, 'utf8'))
    for (const flag of ['--jinja', '--kv-unified', '--no-webui', '--offline']) expect(args).toContain(flag)
    const after = (flag: string): string => args[args.indexOf(flag) + 1]
    expect(after('--host')).toBe('127.0.0.1')
    expect(after('--ctx-size')).toBe('32768')
    expect(after('--cache-type-k')).toBe('q8_0')
    expect(after('--parallel')).toBe('2')
    expect(after('--alias')).toBe('qwen3.5-9b')
    expect(args).not.toContain('--n-gpu-layers') // con GPU, capas automáticas
    // la clave nunca va en la línea de órdenes (la vería `ps`): va en un archivo 0600 que se borra al arrancar
    expect(args).not.toContain('--api-key')
    expect(args).not.toContain(s.apiKey)
    expect(after('--api-key-file')).toBe(engine.keyFile)
    expect(existsSync(engine.keyFile)).toBe(false)
    expect(existsSync(engine.pidFile)).toBe(true)
    expect((await engine.props(s))?.context).toBe(32_768)
    expect((await engine.props(s))?.supportsToolCalls).toBe(true)
    // el mismo modelo y contexto: reutiliza
    expect((await engine.start({ model, alias: 'qwen3.5-9b', context: 32_768 })).pid).toBe(s.pid)
    engine.stop()
    expect(await waitUntil(() => !processExists(s.pid), 5000)).toBe(true)
    expect(engine.running).toBeUndefined()
    expect(existsSync(engine.pidFile)).toBe(false)
  })

  it('sin GPU, --n-gpu-layers 0 (y el proyector de visión con --mmproj)', () => {
    const cpu = new AulaEngine({ folder, variant: 'ubuntu-x64' })
    const args = cpu.serverArguments({ model: '/m.gguf', projector: '/p.gguf', alias: 'x', context: 16_384, parallel: 2, port: 1, keyFile: '/k' })
    expect(args[args.indexOf('--n-gpu-layers') + 1]).toBe('0')
    expect(args[args.indexOf('--mmproj') + 1]).toBe('/p.gguf')
    expect(variantUsesGPU('win-vulkan-x64')).toBe(true)
    expect(variantUsesGPU('win-cpu-x64')).toBe(false)
  })

  it.skipIf(windows)('cambiar de modelo apaga el anterior', async () => {
    const { engine, model } = installedEngine()
    const a = await engine.start({ model, alias: 'a', context: 16_384 })
    const b = await engine.start({ model, alias: 'b', context: 16_384 })
    expect(b.pid).not.toBe(a.pid)
    expect(await waitUntil(() => !processExists(a.pid), 5000)).toBe(true)
    expect(engine.running?.alias).toBe('b')
  })

  it.skipIf(windows)('si no arranca, dice por qué', async () => {
    const { engine, model } = installedEngine()
    process.env.FAKE_LLAMA_FAIL = '1'
    const err = await engine.start({ model, alias: 'x', context: 16_384, loadTimeoutMs: 20_000 }).catch((e) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err.kind).toBe('startFailed')
    expect(err.message).toContain('unknown argument')
    expect(existsSync(engine.keyFile)).toBe(false)
  })

  it.skipIf(windows)('si el modelo no admite la caché q8_0, reintenta con f16', async () => {
    const { engine, model } = installedEngine()
    process.env.FAKE_LLAMA_CACHE_FAIL = '1'
    const argsFile = join(folder, 'args.json')
    process.env.FAKE_LLAMA_ARGS = argsFile
    const s = await engine.start({ model, alias: 'x', context: 16_384 })
    expect(await engine.healthy(s)).toBe(true)
    const args: string[] = JSON.parse(readFileSync(argsFile, 'utf8'))
    expect(args[args.indexOf('--cache-type-k') + 1]).toBe('f16')
  })

  it('apagar mientras carga cancela el arranque y no deja el proceso', async () => {
    const { engine, model } = installedEngine()
    process.env.FAKE_LLAMA_LOAD_MS = '10000'
    const start = engine.start({ model, alias: 'x', context: 16_384 })
    await waitUntil(() => engine.running !== undefined)
    const pid = engine.running!.pid
    engine.stop()
    const err = await start.catch((e) => e)
    expect(err?.name).toBe('AbortError')
    expect(await waitUntil(() => !processExists(pid), 5000)).toBe(true)
  })

  it('sin instalar o sin modelo, errores claros', async () => {
    const none = new AulaEngine({ folder: join(folder, 'vacio') })
    expect(none.isInstalled).toBe(false)
    expect((await none.start({ model: join(folder, 'no.gguf'), alias: 'x', context: 16_384 }).catch((e) => e)).kind).toBe('notInstalled')
    const { engine } = installedEngine()
    const missing = await engine.start({ model: join(folder, 'no.gguf'), alias: 'x', context: 16_384 }).catch((e) => e)
    expect(missing.kind).toBe('modelMissing')
    expect(missing.message).toContain('no.gguf')
  })
})

describe('AulaEngine · instalación', () => {
  function makeTarball(evilLink = false): Buffer {
    const entries = [
      tarEntry('llama-b9999/', { type: '5', mode: 0o755 }),
      tarEntry(`llama-b9999/${EXE}`, { data: '#!/bin/sh\nexit 0\n', mode: 0o755 }),
      tarEntry('llama-b9999/llama-cli', { data: '#!/bin/sh\nexit 0\n', mode: 0o755 }),
      tarEntry('llama-b9999/libllama.0.6.0.dylib', { data: 'dylib' }),
      tarEntry('llama-b9999/libllama.dylib', { type: '2', link: 'libllama.0.6.0.dylib' }),
      tarEntry('llama-b9999/libggml.so.1', { data: 'so' }),
      tarEntry('llama-b9999/LICENSE', { data: 'MIT' })
    ]
    if (evilLink) entries.push(tarEntry('llama-b9999/libevil.dylib', { type: '2', link: '/etc/passwd' }))
    return gzipSync(tar(...entries))
  }

  async function engineFor(data: Buffer, sha?: string): Promise<{ engine: AulaEngine; server: FakeServer }> {
    const server = new FakeServer((r) => (r.path.endsWith('.tar.gz') ? reply.file(data, r) : reply.notFound()))
    servers.push(server)
    const origin = await server.start()
    const asset: EngineAsset = { name: 'llama-b9999-bin-macos-arm64.tar.gz', url: `${origin}/b9999/llama-b9999-bin-macos-arm64.tar.gz`, bytes: data.length, sha256: sha ?? sha256(data) }
    const engine = new AulaEngine({ folder: join(folder, 'engine'), build: 'b9999', asset, variant: 'macos-arm64', verifySignature: false, downloader: new Downloader({ attempts: 1, retryDelayMs: 0, idleTimeoutMs: 5000, diskMargin: 0, freeSpace: () => 2 ** 40 }) })
    return { engine, server }
  }

  it('verifica, poda y deja el ejecutable en su sitio (una segunda vez no hace nada)', async () => {
    const { engine, server } = await engineFor(makeTarball())
    mkdirSync(join(folder, 'engine', 'b1000'), { recursive: true }) // una versión anterior
    let fraction = 0
    await engine.install((p) => (fraction = p.bytesTotal ? p.bytesDone / p.bytesTotal : 0))
    expect(fraction).toBe(1)
    const bin = engine.binary!
    expect(bin.endsWith(join('b9999', 'llama-b9999', EXE))).toBe(true)
    const dir = join(engine.installFolder, 'llama-b9999')
    for (const kept of ['libllama.0.6.0.dylib', 'libllama.dylib', 'libggml.so.1', 'LICENSE']) expect(existsSync(join(dir, kept)), kept).toBe(true)
    expect(existsSync(join(dir, 'llama-cli'))).toBe(false) // lo que no hace falta se quita
    expect(existsSync(join(folder, 'engine', 'descarga'))).toBe(false)
    expect(existsSync(join(folder, 'engine', 'b1000'))).toBe(false)
    expect(readdirSync(join(folder, 'engine')).some((n) => n.startsWith('desempaquetado'))).toBe(false)
    const before = server.requests.length
    await engine.install()
    expect(server.requests.length).toBe(before)
  })

  it('una huella equivocada no instala nada', async () => {
    const { engine } = await engineFor(makeTarball(), '0'.repeat(64))
    expect(await engine.install().catch((e) => e)).toBeDefined()
    expect(engine.isInstalled).toBe(false)
  })

  it('rechaza enlaces que salen del paquete', async () => {
    const { engine } = await engineFor(makeTarball(true))
    const err = await engine.install().catch((e) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect(err.kind).toBe('badArchive')
    expect(err.message).toContain('libevil')
    expect(engine.isInstalled).toBe(false)
  })

  it('en Windows y Linux el paquete sale de la API de GitHub (en caché) para la versión fijada', async () => {
    let calls = 0
    const fakeFetch = async (url: string): Promise<Response> => {
      calls++
      expect(url).toBe(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${ENGINE_BUILD}`)
      return new Response(JSON.stringify({ assets: [
        { name: `llama-${ENGINE_BUILD}-bin-ubuntu-x64.tar.gz`, size: 30_000_000, browser_download_url: `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_BUILD}/llama-${ENGINE_BUILD}-bin-ubuntu-x64.tar.gz`, digest: 'sha256:' + 'c'.repeat(64) },
        { name: `llama-${ENGINE_BUILD}-bin-win-vulkan-x64.zip`, size: 40_000_000, browser_download_url: `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_BUILD}/llama-${ENGINE_BUILD}-bin-win-vulkan-x64.zip`, digest: null }
      ] }), { status: 200 })
    }
    const engine = new AulaEngine({ folder: join(folder, 'engine'), fetch: fakeFetch })
    const assets = await (engine as unknown as { releaseAssets(): Promise<{ name: string }[]> }).releaseAssets()
    expect(assets.map((a) => a.name)).toHaveLength(2)
    await (engine as unknown as { releaseAssets(): Promise<unknown> }).releaseAssets()
    expect(calls).toBe(1) // la segunda vez, de la caché en disco
    // A2-P2-21: la huella fijada manda: un `digest` distinto en GitHub para ese nombre = el paquete cambió y no se usa;
    // sin `digest`, vale la fijada
    expect(pickEngineAsset(assets as never, ENGINE_BUILD, ['ubuntu-vulkan-x64', 'ubuntu-x64'])).toBeUndefined()
    const pinned = PINNED_ENGINE_SHA256[`llama-${ENGINE_BUILD}-bin-ubuntu-x64.tar.gz`]
    const real = (assets as Array<Record<string, unknown>>).map((a) => (String(a.name).includes('ubuntu-x64') ? { ...a, digest: 'sha256:' + pinned } : a))
    const picked = pickEngineAsset(real as never, ENGINE_BUILD, ['ubuntu-vulkan-x64', 'ubuntu-x64'])
    expect(picked?.variant).toBe('ubuntu-x64')
    expect(picked?.asset.sha256).toBe(pinned)
    expect(pickEngineAsset(assets as never, ENGINE_BUILD, ['win-vulkan-x64'])?.asset.sha256).toBe(PINNED_ENGINE_SHA256[`llama-${ENGINE_BUILD}-bin-win-vulkan-x64.zip`])
    expect(pickEngineAsset([{ name: `llama-${ENGINE_BUILD}-bin-ubuntu-x64.tar.gz`, size: 1, browser_download_url: 'https://evil.example/x' }], ENGINE_BUILD, ['ubuntu-x64'])).toBeUndefined()
  })
})

describe('AulaEngine · versión fijada, variantes, vigilante y puertos', () => {
  it('la versión fijada de macOS tiene buena pinta', () => {
    expect(ENGINE_BUILD).toMatch(/^b\d+$/)
    for (const a of Object.values(PINNED_MAC_ASSETS)) {
      const url = new URL(a.url)
      expect(url.hostname).toBe('github.com')
      expect(url.pathname.startsWith(`/ggml-org/llama.cpp/releases/download/${ENGINE_BUILD}/`)).toBe(true)
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(a.bytes).toBeGreaterThan(5_000_000)
    }
    expect(PINNED_MAC_ASSETS.arm64.name).toContain('macos-arm64')
    expect(PINNED_MAC_ASSETS.x64.name).toContain('macos-x64')
  })

  it('variantes por sistema', () => {
    expect(engineVariants({ platform: 'darwin', arch: 'arm64', dedicatedGPU: false, vulkan: false })).toEqual(['macos-arm64'])
    expect(engineVariants({ platform: 'win32', arch: 'x64', dedicatedGPU: true, vulkan: true })).toEqual(['win-vulkan-x64', 'win-cpu-x64'])
    expect(engineVariants({ platform: 'win32', arch: 'x64', dedicatedGPU: true, vulkan: false })).toEqual(['win-cpu-x64'])
    expect(engineVariants({ platform: 'linux', arch: 'x64', dedicatedGPU: false, vulkan: true })).toEqual(['ubuntu-x64'])
    expect(engineVariants({ platform: 'linux', arch: 'arm64', dedicatedGPU: false, vulkan: false })).toEqual(['ubuntu-arm64'])
    expect(engineVariants({ platform: 'freebsd', arch: 'x64', dedicatedGPU: false, vulkan: false })).toEqual([])
  })

  // en Windows no hay vigilante: el servidor que quede se apaga al volver a abrir Aula (sweepOrphan)
  it.skipIf(windows)('el vigilante apaga el servidor si Aula desaparece (y luego termina)', async () => {
    const server = spawn('/bin/sleep', ['60'])
    const parent = spawn('/bin/sleep', ['60'])
    const watchdog = startWatchdog(server.pid!, parent.pid!)
    expect(watchdog).toBeDefined()
    await new Promise((r) => setTimeout(r, 500))
    expect(processExists(server.pid!)).toBe(true)
    parent.kill()
    expect(await waitUntil(() => server.exitCode !== null || server.signalCode !== null, 8000)).toBe(true)
    expect(await waitUntil(() => !processExists(watchdog!.pid!), 5000)).toBe(true)
  })

  it('puertos libres', async () => {
    const any = await freePort(0)
    expect(any).toBeGreaterThan(0)
    expect(await freePort(any)).toBe(any)
  })
})
