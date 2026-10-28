// Relevo de herramientas de punta a punta (app ↔ ayudante `aula-mcp` ↔ CLI) con un proveedor de herramientas falso, y el canal
// de preguntas al estudiante (idea de `StudyEngine/Pipeline/{ToolRelay,QuestionBroker}.swift`).
import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { NO_ANSWER, QuestionBroker } from './questions'
import { createRelayToolsProvider, normalizeToolResult, RELAY_STOPPED_TEXT, RELAY_TOKEN_ENV, RELAY_URL_ENV, startToolRelayServer, toolsProviderFrom } from './relay'
import type { RelayableTool, ToolRunContext } from './types'

const ctx = (signal: AbortSignal = new AbortController().signal): ToolRunContext => ({ signal })

function tools(log: string[] = []): RelayableTool[] {
  return [
    { name: 'suma', description: 'Suma', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } }, run: (a) => String(Number(a.a) + Number(a.b)) },
    { name: 'imagen', description: '', inputSchema: {}, run: () => ({ text: 'foto', images: [{ mediaType: 'image/png', base64: 'QUJD' }] }) },
    { name: 'objeto', description: '', inputSchema: {}, run: () => ({ curso: 'Cálculo', n: 3 }) },
    { name: 'falla', description: '', inputSchema: {}, run: () => { throw new Error('explotó') } },
    { name: 'contexto', description: '', inputSchema: {}, run: (_a, c) => String(c.packID ?? 'sin') },
    {
      name: 'espera', description: '', inputSchema: {},
      run: (_a, c) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve('tarde'), 10_000)
          c.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            log.push('cancelada')
            resolve('cancelada')
          })
        })
    }
  ]
}

/** Petición HTTP cruda al relevo (para comprobar sus defensas). */
function raw(url: string, o: { path?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  const target = new URL(o.path ?? '/v1/tools/list', url)
  return new Promise((resolve, reject) => {
    const req = request({ host: target.hostname, port: target.port, path: target.pathname, method: o.method ?? 'POST', headers: o.headers ?? {}, agent: false }, (res) => {
      const parts: Buffer[] = []
      res.on('data', (c: Buffer) => parts.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString() }))
    })
    req.on('error', reject)
    req.end(o.body)
  })
}

describe('Relevo de herramientas', () => {
  it('lista y llama de punta a punta (texto, imagen, objetos y errores)', async () => {
    const relay = await startToolRelayServer(tools())
    try {
      expect(relay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(relay.token).toMatch(/^[0-9a-f]{64}$/)
      expect(relay.env).toEqual({ [RELAY_URL_ENV]: relay.url, [RELAY_TOKEN_ENV]: relay.token })
      const client = createRelayToolsProvider(relay.url, relay.token)
      expect((await client.list()).map((t) => t.name)).toEqual(['suma', 'imagen', 'objeto', 'falla', 'contexto', 'espera'])
      expect(await client.call('suma', { a: 2, b: 3 }, ctx())).toEqual({ text: '5' })
      expect(await client.call('imagen', {}, ctx())).toEqual({ text: 'foto', images: [{ mediaType: 'image/png', base64: 'QUJD' }] })
      expect(JSON.parse((await client.call('objeto', {}, ctx())).text)).toEqual({ curso: 'Cálculo', n: 3 })
      expect(await client.call('falla', {}, ctx())).toEqual({ text: 'Error: explotó', isError: true })
      expect((await client.call('no-existe', {}, ctx())).isError).toBe(true)
    } finally {
      await relay.close()
    }
  })

  it('el contexto propio de la app llega a las herramientas', async () => {
    const relay = await startToolRelayServer(toolsProviderFrom(tools(), { packID: 'curso-1' }))
    try {
      expect((await createRelayToolsProvider(relay.url, relay.token).call('contexto', {}, ctx())).text).toBe('curso-1')
    } finally {
      await relay.close()
    }
  })

  it('rechaza peticiones sin la clave, desde un navegador o con otro Host', async () => {
    const relay = await startToolRelayServer(tools())
    try {
      const json = { 'content-type': 'application/json' }
      expect((await raw(relay.url, { headers: json, body: '{}' })).status).toBe(401)
      expect((await raw(relay.url, { headers: { ...json, authorization: 'Bearer otra' }, body: '{}' })).status).toBe(401)
      const auth = { ...json, authorization: `Bearer ${relay.token}` }
      expect((await raw(relay.url, { headers: { ...auth, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
      expect((await raw(relay.url, { headers: { ...auth, host: 'evil.example' }, body: '{}' })).status).toBe(403)
      expect((await raw(relay.url, { method: 'GET', headers: auth })).status).toBe(405)
      expect((await raw(relay.url, { headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
      expect((await raw(relay.url, { path: '/v1/otra-cosa', headers: auth, body: '{}' })).status).toBe(404)
      expect((await raw(relay.url, { path: '/v1/ping', headers: auth, body: '{}' })).body).toBe('{"ok":true}')
      expect((await raw(relay.url, { path: '/v1/tools/call', headers: auth, body: '{}' })).status).toBe(400)
    } finally {
      await relay.close()
    }
  })

  it('un cuerpo demasiado grande se rechaza', async () => {
    const relay = await startToolRelayServer(tools(), { maxBodyBytes: 1000 })
    try {
      const res = await raw(relay.url, { path: '/v1/tools/call', headers: { 'content-type': 'application/json', authorization: `Bearer ${relay.token}` }, body: JSON.stringify({ name: 'suma', arguments: { x: 'y'.repeat(5000) } }) })
      expect(res.status).toBe(413)
    } finally {
      await relay.close()
    }
  })

  it('si la CLI cancela la llamada, la herramienta recibe la cancelación', async () => {
    const log: string[] = []
    const relay = await startToolRelayServer(tools(log))
    try {
      const controller = new AbortController()
      const call = createRelayToolsProvider(relay.url, relay.token).call('espera', {}, ctx(controller.signal))
      await new Promise((r) => setTimeout(r, 150))
      expect(relay.activeCalls).toBe(1)
      controller.abort()
      expect(await call).toEqual({ text: 'Cancelled.', isError: true })
      await new Promise((r) => setTimeout(r, 100))
      expect(log).toEqual(['cancelada'])
      expect(relay.activeCalls).toBe(0)
    } finally {
      await relay.close()
    }
  })

  it('al cerrar, las llamadas en curso responden «Aula dejó de atender» y luego no hay relevo', async () => {
    const relay = await startToolRelayServer(tools())
    const client = createRelayToolsProvider(relay.url, relay.token)
    const call = client.call('espera', {}, ctx())
    await new Promise((r) => setTimeout(r, 150))
    await relay.close()
    expect(await call).toEqual({ text: RELAY_STOPPED_TEXT, isError: true })
    const after = await client.call('suma', { a: 1, b: 1 }, ctx())
    expect(after.isError).toBe(true)
    expect(after.text).toContain('not reachable')
    await expect(client.list()).rejects.toThrow()
  })

  it('un plazo en el ayudante da un error que el modelo entiende', async () => {
    const relay = await startToolRelayServer(tools())
    try {
      const out = await createRelayToolsProvider(relay.url, relay.token, { callTimeoutMs: 200 }).call('espera', {}, ctx())
      expect(out.isError).toBe(true)
      expect(out.text).toContain('did not answer in time')
    } finally {
      await relay.close()
    }
  })

  it('normaliza lo que devuelve una herramienta', () => {
    expect(normalizeToolResult(undefined)).toEqual({ text: '' })
    expect(normalizeToolResult('hola')).toEqual({ text: 'hola' })
    expect(normalizeToolResult({ text: 'x', isError: true })).toEqual({ text: 'x', isError: true })
    expect(normalizeToolResult({ content: [{ type: 'text', text: 'de MCP' }], isError: false })).toEqual({ text: 'de MCP', images: [], isError: false })
    expect(normalizeToolResult([1, 2])).toEqual({ text: '[1,2]' })
    expect(normalizeToolResult({ text: 'x', images: [{ nada: 1 }, { mediaType: 'image/png', base64: 'A' }] })).toEqual({ text: 'x', images: [{ mediaType: 'image/png', base64: 'A' }] })
  })
})

describe('QuestionBroker', () => {
  it('publica la pregunta, avisa y devuelve la respuesta', async () => {
    const broker = new QuestionBroker()
    const seen: number[] = []
    const off = broker.onChange((p) => seen.push(p.length))
    const answer = broker.ask('¿Qué tema prefieres?', ['Derivadas', 'Integrales'])
    const [pending] = broker.pending()
    expect(pending.text).toBe('¿Qué tema prefieres?')
    expect(pending.options).toEqual(['Derivadas', 'Integrales'])
    expect(broker.answer(pending.id, 'Integrales')).toBe(true)
    expect(await answer).toBe('Integrales')
    expect(broker.answer(pending.id, 'otra')).toBe(false) // ya no esperaba
    expect(broker.pending()).toEqual([])
    expect(seen).toEqual([1, 0])
    off()
  })

  it('sin respuesta (plazo, cancelación o respuesta vacía) la IA decide sola', async () => {
    const broker = new QuestionBroker()
    expect(await broker.ask('¿?', [], { timeoutMs: 20 })).toBe(NO_ANSWER)
    const controller = new AbortController()
    const asked = broker.ask('¿?', [], { signal: controller.signal })
    controller.abort()
    expect(await asked).toBe(NO_ANSWER)
    const blank = broker.ask('¿?')
    broker.answer(broker.pending()[0].id, '   ')
    expect(await blank).toBe(NO_ANSWER)
    expect(await broker.ask('¿?', [], { signal: AbortSignal.abort() })).toBe(NO_ANSWER)
  })
})
