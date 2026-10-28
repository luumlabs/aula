// Port de `Tests/LocalAIKitTests/{LocalServersTests,MetadataByteSafetyTests,LoopbackOriginRequestTests}.swift`: detección de
// Ollama, LM Studio y llama.cpp contra servidores falsos en 127.0.0.1, el cliente de Ollama y las defensas del HTTP local.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTempDirs, makeTempDir } from '../agents/__fixtures__/support'
import { FakeServer, reply, type FakeRequest, type FakeResponse } from './__fixtures__/fake-server'
import { LoopbackError, LoopbackHTTP, loopbackHost } from './loopback'
import { detectLocalServers, findInstalledLocalApps, lmStudioV1, OllamaClient, ollamaVariantName, parseByteCount, parseOllamaDetails } from './servers'

const servers: FakeServer[] = []

/** El error con el que falla `promise` (la prueba falla si no falla). */
function failure(promise: Promise<unknown>): Promise<LoopbackError> {
  return promise.then(
    () => {
      throw new Error('debía fallar')
    },
    (e: LoopbackError) => e
  )
}
async function serve(handler: (r: FakeRequest) => FakeResponse | Promise<FakeResponse>): Promise<{ origin: string; server: FakeServer }> {
  const server = new FakeServer(handler)
  servers.push(server)
  return { origin: await server.start(), server }
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()))
  cleanupTempDirs()
})

function fakeOllama(r: FakeRequest): FakeResponse {
  switch (r.path) {
    case '/api/version':
      return reply.json({ version: '0.40.3' })
    case '/api/tags':
      return reply.json({ models: [
        { name: 'qwen3:8b', model: 'qwen3:8b', size: 5_225_388_164, details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M' } },
        { name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud', remote_host: 'https://ollama.com:443', size: 384 },
        { name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest', size: 274_302_450, details: { parameter_size: '137M' } }
      ] })
    case '/api/ps':
      return reply.json({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b', context_length: 4096 }] })
    case '/api/show': {
      const model = String((r.json as { model?: string })?.model ?? '')
      if (model.startsWith('nomic')) return reply.json({ capabilities: ['embedding'], model_info: { 'general.architecture': 'nomic-bert', 'nomic-bert.context_length': 2048 } })
      return reply.json({ capabilities: ['completion', 'tools', 'thinking'], parameters: 'temperature 0.6\nnum_ctx                        4096', model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } })
    }
    default:
      return reply.notFound()
  }
}

describe('Detección de servidores locales', () => {
  it('Ollama: modelos y capacidades (sin los de su nube)', async () => {
    const { origin } = await serve(fakeOllama)
    const [r] = await detectLocalServers({ ollama: origin }, {})
    expect(r.kind).toBe('ollama')
    expect(r.version).toBe('0.40.3')
    expect(r.baseURL).toBe(origin + '/v1')
    expect(r.models.map((m) => m.id)).toEqual(['qwen3:8b', 'nomic-embed-text:latest'])
    expect(r.models[0]).toEqual({ id: 'qwen3:8b', label: 'qwen3:8b', loaded: true, context: 4096, contextMax: 40960, tools: true, vision: false, thinking: true, parameters: '8.2B', quantization: 'Q4_K_M', sizeBytes: 5_225_388_164, isChat: true })
    expect(r.models[1].isChat).toBe(false) // un modelo de embeddings no es de chat
  })

  it('LM Studio (API v1) y con clave', async () => {
    const { origin } = await serve((r) =>
      r.path === '/api/v1/models'
        ? reply.json({ models: [
          { type: 'llm', key: 'qwen/qwen3-8b', display_name: 'Qwen3 8B', size_bytes: 5_000_000_000, max_context_length: 40960, params_string: '8B', quantization: { name: 'Q4_K_M' }, capabilities: { vision: false, trained_for_tool_use: true }, loaded_instances: [{ id: 'x', config: { context_length: 32768 } }] },
          { type: 'embedding', key: 'text-embedding-nomic', capabilities: {}, loaded_instances: [] }
        ] })
        : reply.notFound()
    )
    const [r] = await detectLocalServers({ lmstudio: origin }, {})
    expect(r.kind).toBe('lmstudio')
    expect(r.models[0].label).toBe('Qwen3 8B')
    expect(r.models[0].tools).toBe(true)
    expect(r.models[0].context).toBe(32768)
    expect(r.models[0].loaded).toBe(true)
    expect(r.models[1].isChat).toBe(false)
    const locked = await serve(() => reply.json({ error: 'unauthorized' }, 401))
    const [l] = await detectLocalServers({ lmstudio: locked.origin }, {})
    expect(l.needsKey).toBe(true)
  })

  it('LM Studio antiguo (API v0)', async () => {
    const { origin } = await serve((r) => (r.path === '/api/v0/models' ? reply.json({ data: [{ id: 'm', type: 'vlm', state: 'loaded', capabilities: ['tool_use'], loaded_context_length: 8192, max_context_length: 32768, quantization: 'Q4' }] }) : reply.notFound()))
    const [r] = await detectLocalServers({ lmstudio: origin }, {})
    expect(r.models).toEqual([{ id: 'm', label: 'm', loaded: true, context: 8192, contextMax: 32768, tools: true, vision: true, quantization: 'Q4', isChat: true }])
  })

  it('llama.cpp solo si dice serlo', async () => {
    const llama = await serve((r) => {
      if (r.path === '/v1/models') return reply.json({ data: [{ id: 'qwen3-8b', owned_by: 'llamacpp', meta: { n_ctx_train: 40960, n_params: 8_190_000_000, size: 5_000_000_000 } }] })
      if (r.path === '/props') return reply.json({ default_generation_settings: { n_ctx: 32768 }, build_info: 'b11429-d81235049', chat_template_caps: { supports_tool_calls: true }, modalities: { vision: false } })
      return reply.notFound()
    })
    const [r] = await detectLocalServers({ llamacpp: llama.origin }, {})
    expect(r.version).toBe('b11429-d81235049')
    expect(r.models[0].context).toBe(32768)
    expect(r.models[0].tools).toBe(true)
    expect(r.models[0].parameters).toBe('8.2B')
    // otro servidor cualquiera en ese puerto no es llama.cpp
    const other = await serve((q) => (q.path === '/v1/models' ? reply.json({ data: [{ id: 'x', owned_by: 'vllm' }] }) : reply.notFound()))
    expect(await detectLocalServers({ llamacpp: other.origin }, {})).toEqual([])
  })

  it('se mira el puerto alternativo de llama-server', async () => {
    const llama = await serve((r) => (r.path === '/v1/models' ? reply.json({ data: [{ id: 'x', owned_by: 'llamacpp' }] }) : r.path === '/props' ? reply.json({ build_info: 'b1' }) : reply.notFound()))
    const reports = await detectLocalServers({ llamacpp: 'http://127.0.0.1:1' }, { llamacpp: llama.origin })
    expect(reports.map((r) => r.kind)).toEqual(['llamacpp'])
  })

  it('sin servidores compatibles: vacío y rápido', async () => {
    const { origin } = await serve(() => reply.notFound())
    const started = Date.now()
    expect(await detectLocalServers({ ollama: origin, lmstudio: origin, llamacpp: origin }, {})).toEqual([])
    expect(await detectLocalServers({ ollama: 'http://127.0.0.1:1', lmstudio: 'http://127.0.0.1:2' }, {})).toEqual([]) // nadie escuchando
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('tamaños no válidos se ignoran sin romper nada', async () => {
    expect(parseByteCount(5)).toBe(5)
    expect(parseByteCount(0)).toBeUndefined()
    expect(parseByteCount(0, true)).toBe(0)
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, '12', null, true]) expect(parseByteCount(bad)).toBeUndefined()
    expect(lmStudioV1([{ key: 'k', type: 'llm', size_bytes: -5 }])[0].sizeBytes).toBeUndefined()
    const { origin } = await serve((r) => (r.path === '/api/tags' ? reply.json({ models: [{ name: 'a', model: 'a', size: 1e300 }] }) : reply.notFound()))
    const [o] = await detectLocalServers({ ollama: origin }, {})
    expect(o.models[0].sizeBytes).toBeUndefined()
  })
})

describe('Cliente de Ollama', () => {
  it('descarga con progreso que no retrocede, variante con contexto y borrado', async () => {
    const { origin, server } = await serve((r) => {
      switch (r.path) {
        case '/api/pull':
          return reply.ndjson([
            { status: 'pulling manifest' },
            { status: 'pulling a1b2', digest: 'sha256:a1b2', total: 1000, completed: 0 },
            { status: 'pulling a1b2', digest: 'sha256:a1b2', total: 1000, completed: 600 },
            { status: 'pulling c3d4', digest: 'sha256:c3d4', total: 200, completed: 200 },
            { status: 'pulling a1b2', digest: 'sha256:a1b2', total: 1000, completed: 1000 },
            { status: 'verifying sha256 digest' }, { status: 'success' }
          ], 10)
        case '/api/create':
          return reply.ndjson([{ status: 'using existing layer' }, { status: 'success' }])
        case '/api/delete':
          return reply.text('')
        default:
          return reply.notFound()
      }
    })
    const client = OllamaClient.create(origin)!
    const seen: [number, number][] = []
    await client.pull('qwen3:8b', (done, total) => seen.push([done, total]))
    expect(seen[seen.length - 1]).toEqual([1200, 1200])
    const dones = seen.map((s) => s[0])
    expect(dones).toEqual([...dones].sort((a, b) => a - b))
    expect(await client.createVariant('qwen3:8b', 32768)).toBe('qwen3-aula32k:8b')
    const body = server.requestsTo('/api/create').pop()?.json as { from: string; parameters: { num_ctx: number } }
    expect(body.from).toBe('qwen3:8b')
    expect(body.parameters.num_ctx).toBe(32768)
    await client.delete('qwen3:8b')
    expect(server.requestsTo('/api/delete')[0].method).toBe('DELETE')
  })

  it('una línea de error en la descarga es un error', async () => {
    const { origin } = await serve((r) => (r.path === '/api/pull' ? reply.ndjson([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]) : reply.notFound()))
    const err = await failure(OllamaClient.create(origin)!.pull('nope:1b', () => undefined))
    expect(err).toBeInstanceOf(LoopbackError)
    expect(err.message).toContain('does not exist')
  })

  it('cifras de descarga mal formadas o que desbordan se rechazan', async () => {
    const make = async (lines: unknown[]) => OllamaClient.create((await serve((r) => (r.path === '/api/pull' ? reply.ndjson(lines) : reply.notFound()))).origin)!
    const bad = await make([{ digest: 'a', total: 100, completed: 200 }])
    expect((await failure(bad.pull('x', () => undefined))).kind).toBe('badResponse')
    const overflow = await make([{ digest: 'a', total: Number.MAX_SAFE_INTEGER, completed: 0 }, { digest: 'b', total: Number.MAX_SAFE_INTEGER, completed: 0 }])
    expect((await failure(overflow.pull('x', () => undefined))).kind).toBe('badResponse')
    const empty = await make([{ digest: 'a', total: 0 }, { status: 'success' }])
    await expect(empty.pull('x', () => undefined)).resolves.toBeUndefined()
  })

  it('nombres de variante y detalles', () => {
    expect(ollamaVariantName('gpt-oss:20b', 65536)).toBe('gpt-oss-aula64k:20b')
    expect(ollamaVariantName('mistral', 16384)).toBe('mistral-aula16k')
    const d = parseOllamaDetails({ capabilities: ['completion', 'vision'], parameters: 'num_ctx 8192', model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 131072 } })
    expect(d.numCtx).toBe(8192)
    expect(d.contextLength).toBe(131072)
    expect(d.capabilities).toEqual(['completion', 'vision'])
  })
})

describe('HTTP solo de este ordenador', () => {
  it('solo direcciones de bucle local', () => {
    expect(LoopbackHTTP.create('http://192.168.1.10:11434')).toBeUndefined()
    expect(LoopbackHTTP.create('http://ollama.example.com:11434')).toBeUndefined()
    expect(LoopbackHTTP.create('http://user:pw@127.0.0.1:11434')).toBeUndefined()
    expect(LoopbackHTTP.create('https://127.0.0.1:11434')).toBeUndefined()
    expect(LoopbackHTTP.create('file:///etc/passwd')).toBeUndefined()
    expect(LoopbackHTTP.create('http://localhost:11434/v1')?.origin).toBe('http://127.0.0.1:11434')
    expect(LoopbackHTTP.create('http://[::1]:1234')?.origin).toBe('http://[::1]:1234')
    expect(LoopbackHTTP.create('http://127.0.0.5:1234')?.origin).toBe('http://127.0.0.5:1234')
    expect(loopbackHost(new URL('http://[::1]:1234'))).toBe('::1')
    expect(loopbackHost(new URL('http://127.0.0.5:1234'))).toBe('127.0.0.5')
    expect(loopbackHost(new URL('http://127.0.0.1.evil.com'))).toBeUndefined()
  })

  it('las rutas no salen del origen', async () => {
    const { origin, server } = await serve(() => reply.json({ ok: true }))
    const http = LoopbackHTTP.create(origin)!
    await http.json('/api/x?y=1')
    expect(server.requests[0].path).toBe('/api/x')
    for (const evil of ['http://example.com/steal', '//example.com/steal', 'http://127.0.0.1:1/otro-puerto', 'http://user@127.0.0.1/x']) {
      await expect(http.json(evil)).rejects.toMatchObject({ kind: 'notLoopback' })
    }
    expect(server.requests).toHaveLength(1)
  })

  it('no sigue redirecciones fuera del ordenador', async () => {
    const { origin } = await serve(() => ({ status: 302, headers: { location: 'https://example.com/steal' } }))
    const err = await failure(LoopbackHTTP.create(origin)!.json('/api/tags'))
    expect(err.kind).toBe('status')
    expect(err.status).toBe(302)
  })

  it('tope de tamaño, JSON roto y servidor ausente', async () => {
    const { origin } = await serve((r) => (r.path === '/grande' ? reply.text('x'.repeat(5000)) : reply.text('{roto')))
    const http = LoopbackHTTP.create(origin, 2000, 1000)!
    expect((await failure(http.data('/grande'))).kind).toBe('badResponse')
    expect((await failure(http.json('/roto'))).kind).toBe('badResponse')
    expect((await failure(LoopbackHTTP.create('http://127.0.0.1:1')!.json('/'))).kind).toBe('unreachable')
  })
})

describe('Apps instaladas', () => {
  it('encuentra Ollama y LM Studio en Linux y macOS', () => {
    const home = makeTempDir()
    mkdirSync(join(home, '.lmstudio/bin'), { recursive: true })
    writeFileSync(join(home, '.lmstudio/bin/lms'), '')
    expect(findInstalledLocalApps(home, 'linux').find((a) => a.kind === 'lmstudio')).toEqual({ kind: 'lmstudio', cli: join(home, '.lmstudio/bin/lms') })
    mkdirSync(join(home, 'Applications/Ollama.app'), { recursive: true })
    expect(findInstalledLocalApps(home, 'darwin').find((a) => a.kind === 'ollama')?.app).toBe(join(home, 'Applications/Ollama.app'))
    const local = join(home, 'AppData', 'Local')
    mkdirSync(join(local, 'Programs', 'Ollama'), { recursive: true })
    writeFileSync(join(local, 'Programs', 'Ollama', 'ollama.exe'), '')
    expect(findInstalledLocalApps(home, 'win32', { LOCALAPPDATA: local }).find((a) => a.kind === 'ollama')?.cli).toBe(join(local, 'Programs', 'Ollama', 'ollama.exe'))
  })
})
