// Port de `Tests/LocalAIKitTests/ServiceTests.swift`: «Descargar y usar» de punta a punta (modelo servido en 127.0.0.1, motor
// falso), registro, progreso, cancelación, borrado, apagado por inactividad, los modelos de la app Swift y el proveedor
// `aula-local` contestando de verdad por la API compatible con OpenAI.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HardwareProfile, LocalProgressEvent, ModelCard } from '@shared/agents'
import { cleanupTempDirs, makeTempDir, processExists, waitUntil, writeExecutable } from '../agents/__fixtures__/support'
import { FakeServer, reply } from './__fixtures__/fake-server'
import { Downloader } from './downloader'
import { AulaEngine } from './engine'
import { createAulaLocalChatModel, pickInstalledModel, probeAulaLocal, registerLocalProviders } from './provider'
import { LocalAIService } from './service'

const FAKE = join(__dirname, '__fixtures__', 'fake-llama-server.cjs')
const GB = 1_073_741_824
const weights = Buffer.alloc(200_000, 7)
const projector = Buffer.alloc(50_000, 9)
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

function cardFor(id: string, o: { vision?: boolean } = {}): ModelCard {
  return {
    id, name: `Modelo ${id}`, publisher: 'Pruebas', parametersB: 4, contextLength: 131_072, capabilities: o.vision ? ['tools', 'vision'] : ['tools'], multilingual: true, rank: 1,
    gguf: {
      repo: 'pruebas/Modelo-GGUF', path: `${id}-Q4_K_M.gguf`, bytes: weights.length, sha256: sha(weights), quantization: 'Q4_K_M', revision: '0123456789abcdef0123456789abcdef01234567',
      ...(o.vision ? { visionProjector: { path: 'mmproj-F16.gguf', bytes: projector.length, sha256: sha(projector) } } : {})
    }
  }
}

const M4PRO: HardwareProfile = {
  platform: 'darwin', arch: 'arm64', chip: 'Apple M4 Pro', isAppleSilicon: true, performanceCores: 10, efficiencyCores: 4, logicalCores: 14, gpuCores: 16,
  memoryBytes: 24 * GB, gpuWorkingSetBytes: 19_069_670_000, freeDiskBytes: 200 * GB, osVersion: '27.0'
}

let folder: string
let hub: FakeServer
let slow = false
let services: LocalAIService[] = []

beforeEach(async () => {
  folder = makeTempDir('local-ai')
  slow = false
  hub = new FakeServer((r) => {
    if (r.path.endsWith('mmproj-F16.gguf')) return reply.file(projector, r)
    if (r.path.endsWith('.gguf')) return reply.file(weights, r, slow ? { chunkSize: 2048, delayMs: 20 } : {})
    return reply.notFound()
  })
  await hub.start()
})
afterEach(async () => {
  for (const s of services.splice(0)) s.shutdown()
  for (const k of ['FAKE_LLAMA_REQUESTS', 'FAKE_LLAMA_LOAD_MS']) delete process.env[k]
  await hub.stop()
  cleanupTempDirs()
})

/** Un servicio con el motor ya «instalado» (el `llama-server` falso) y el Hub falso. */
function makeService(cards: ModelCard[] = [cardFor('m1'), cardFor('m2', { vision: true })], o: { legacyRoot?: string; idleShutdownMs?: number } = {}): LocalAIService {
  const root = join(folder, 'Models')
  const engine = new AulaEngine({ folder: join(root, 'engine'), build: 'b9999', variant: 'macos-arm64', preferredPort: 0, pollIntervalMs: 50, verifySignature: false })
  const dir = join(engine.installFolder, 'llama-b9999')
  mkdirSync(dir, { recursive: true })
  writeExecutable(join(dir, 'llama-server'), `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`)
  writeFileSync(join(engine.installFolder, '.installed'), 'llama-b9999/llama-server')
  const service = new LocalAIService({
    root, legacyRoot: o.legacyRoot, catalog: cards, engine, hub: hub.origin, hardware: async () => M4PRO, idleShutdownMs: o.idleShutdownMs,
    downloader: new Downloader({ attempts: 2, retryDelayMs: 0, idleTimeoutMs: 5000, diskMargin: 0, freeSpace: () => 2 ** 40 })
  })
  services.push(service)
  return service
}

describe('LocalAIService', () => {
  it('descarga, registra, arranca y borra', async () => {
    const service = makeService()
    const events: LocalProgressEvent[] = []
    service.onProgress((e) => events.push(e))
    const model = await service.download('m2')
    expect(model.alias).toBe('m2')
    expect(model.file).toBe('m2/m2-Q4_K_M.gguf')
    expect(model.projector).toBe('m2/mmproj-F16.gguf')
    expect(model.contextTokens).toBeGreaterThanOrEqual(16_384)
    expect(readFileSync(join(service.root, 'm2', 'm2-Q4_K_M.gguf')).equals(weights)).toBe(true)
    expect(hub.requests[0].path).toBe('/pruebas/Modelo-GGUF/resolve/0123456789abcdef0123456789abcdef01234567/m2-Q4_K_M.gguf') // fijado a la revisión
    expect(events[events.length - 1]).toMatchObject({ modelId: 'm2', phase: 'preparing', state: 'done', fraction: 1 })
    expect(events.some((e) => e.phase === 'model' && e.state === 'running')).toBe(true)
    expect(service.installed().map((m) => m.id)).toEqual(['m2'])
    // el registro es el mismo formato que el de la app Swift
    const registry = JSON.parse(readFileSync(service.registryFile, 'utf8'))
    expect(Object.keys(registry[0]).sort()).toEqual(['alias', 'card', 'contextTokens', 'file', 'id', 'installedAt', 'projector'])

    const catalog = await service.localCatalog()
    expect(catalog.entries.find((e) => e.card.id === 'm2')?.installed).toBe(true)
    expect(catalog.engine.installed).toBe(true)
    expect(catalog.hardware.budgetBytes).toBeGreaterThan(0)

    const server = await service.ensureServer('m2')
    expect(await service.engine.healthy(server)).toBe(true)
    expect(service.engineStatus().running).toMatchObject({ modelId: 'm2', alias: 'm2', contextTokens: model.contextTokens })
    // dos arranques a la vez comparten uno
    const [a, b] = await Promise.all([service.ensureServer('m2'), service.ensureServer('m2')])
    expect(a.pid).toBe(server.pid)
    expect(b.pid).toBe(server.pid)

    service.delete('m2')
    expect(await waitUntil(() => !processExists(server.pid), 5000)).toBe(true)
    expect(existsSync(join(service.root, 'm2'))).toBe(false)
    expect(service.installed()).toEqual([])
  })

  it('dos descargas del mismo modelo comparten una; cancelar deja lo bajado', async () => {
    const service = makeService()
    slow = true
    const events: LocalProgressEvent[] = []
    service.onProgress((e) => events.push(e))
    const first = service.download('m1')
    expect(service.download('m1')).toBe(first)
    expect(service.isDownloading('m1')).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    service.cancel('m1')
    const err = await first.catch((e) => e)
    expect(err?.name).toBe('AbortError')
    expect(events[events.length - 1].state).toBe('cancelled')
    expect(service.isDownloading('m1')).toBe(false)
    expect(existsSync(join(service.root, 'm1', 'm1-Q4_K_M.gguf.part'))).toBe(true)
    slow = false
    await service.download('m1')
    expect(hub.requests.pop()?.headers.range).toMatch(/^bytes=\d+-$/) // se reanudó
  })

  it('un modelo que no está en el catálogo o un id raro se rechaza', async () => {
    const service = makeService()
    await expect(service.download('no-existe')).rejects.toMatchObject({ code: 'not_found' })
    expect(() => service.delete('no-existe')).toThrow()
    await expect(service.ensureServer('m1')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('un registro sin su archivo no cuenta', async () => {
    const service = makeService()
    await service.download('m1')
    writeFileSync(service.registryFile, JSON.stringify([...JSON.parse(readFileSync(service.registryFile, 'utf8')), { id: 'fantasma', alias: 'fantasma', card: cardFor('fantasma'), file: 'fantasma/x.gguf', contextTokens: 16384, installedAt: '2026-01-01T00:00:00Z' }, { id: 'malo', alias: '../x', card: {}, file: '../../etc/passwd', contextTokens: 1, installedAt: '' }]))
    expect(service.installed().map((m) => m.id)).toEqual(['m1'])
  })

  it('trae los modelos ya descargados por la app Swift (<datos>/LocalAI)', () => {
    const legacy = join(folder, 'LocalAI')
    mkdirSync(join(legacy, 'models', 'viejo'), { recursive: true })
    writeFileSync(join(legacy, 'models', 'viejo', 'viejo.gguf'), 'GGUF')
    writeFileSync(join(legacy, 'installed.json'), JSON.stringify([{ id: 'viejo', alias: 'viejo', card: cardFor('viejo'), file: 'viejo/viejo.gguf', contextTokens: 32768, installedAt: '2026-10-01T10:00:00Z' }]))
    const service = makeService(undefined, { legacyRoot: legacy })
    expect(service.installed().map((m) => m.id)).toEqual(['viejo'])
    expect(existsSync(join(service.root, 'viejo', 'viejo.gguf'))).toBe(true)
    expect(existsSync(join(legacy, 'models', 'viejo'))).toBe(false) // se movió (mismo disco), no se copió
  })

  it('se apaga solo tras un rato sin uso (pero no mientras se usa)', async () => {
    const service = makeService(undefined, { idleShutdownMs: 300 })
    await service.download('m1')
    service.beginUse()
    const server = await service.ensureServer('m1')
    await new Promise((r) => setTimeout(r, 600))
    expect(service.engine.running).toBeDefined() // en uso: no se apaga
    service.endUse()
    expect(await waitUntil(() => service.engine.running === undefined, 3000)).toBe(true)
    expect(await waitUntil(() => !processExists(server.pid), 5000)).toBe(true)
  })

  it('recomienda un modelo para este ordenador', async () => {
    const service = makeService()
    expect((await service.recommended())?.id).toBe('m1')
  })
})

describe('Proveedor «aula-local»', () => {
  it('enciende el motor al primer uso y contesta por la API compatible con OpenAI (con su clave)', async () => {
    const service = makeService()
    await service.download('m1')
    const requests = join(folder, 'requests.jsonl')
    process.env.FAKE_LLAMA_REQUESTS = requests
    const model = createAulaLocalChatModel({ id: 'aula-local', kind: 'aula-local', label: 'Aula', model: '' }, service)
    expect(model.model).toBe('m1')
    expect(model.capabilities.tools).toBe(true)
    expect(model.capabilities.contextWindow).toBe(service.installedModel('m1')!.contextTokens)
    expect(service.engine.running).toBeUndefined()
    const deltas: string[] = []
    const response = await model.complete({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Hola' }] }] }, { onDelta: (e) => e.type === 'text' && deltas.push(e.text) })
    expect(response.message.content).toEqual([{ type: 'text', text: 'Hola desde m1' }])
    expect(deltas.join('')).toBe('Hola desde m1')
    expect(response.usage.completionTokens).toBe(3)
    expect(service.engine.running?.alias).toBe('m1')
    expect(JSON.parse(readFileSync(requests, 'utf8').split('\n')[0]).model).toBe('m1')
  })

  it('sin modelos descargados: no disponible y un error claro', async () => {
    const service = makeService()
    expect(probeAulaLocal(service)).toMatchObject({ available: false })
    const err = await createAulaLocalChatModel({ id: 'aula-local', kind: 'aula-local', label: 'Aula' }, service).complete({ messages: [] }).catch((e) => e)
    expect(err.code).toBe('ai_no_model')
    await service.download('m1')
    expect(probeAulaLocal(service)).toEqual({ available: true, models: ['m1'] })
    expect(pickInstalledModel(service, 'm1')?.id).toBe('m1')
    expect(pickInstalledModel(service, 'otro')).toBeUndefined()
  })

  it('se registra en la capa de IA', () => {
    const registered: string[] = []
    registerLocalProviders((kind, _factory, options) => {
      registered.push(kind)
      expect(typeof options?.probe).toBe('function')
    }, makeService())
    expect(registered).toEqual(['aula-local'])
  })
})
