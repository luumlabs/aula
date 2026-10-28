// Port de `Tests/AgentKitTests/MCPRunLoopTests.swift`: el bucle stdio de `MCPServer.run` conectado por flujos.
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { MCPServer, type MCPServerOptions } from './server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** Un servidor corriendo contra dos flujos, con ayudas para hablarle. */
class Harness {
  readonly toServer = new PassThrough()
  readonly fromServer = new PassThrough()
  private readonly replies: Json[] = []
  private waiters: ((v: Json) => void)[] = []
  private pending = ''
  returned = false
  private readonly controller = new AbortController()
  readonly running: Promise<void>

  constructor(server: MCPServer) {
    this.fromServer.on('data', (chunk: Buffer) => {
      this.pending += chunk.toString('utf8')
      let nl: number
      while ((nl = this.pending.indexOf('\n')) >= 0) {
        const line = this.pending.slice(0, nl)
        this.pending = this.pending.slice(nl + 1)
        const value = JSON.parse(line)
        const w = this.waiters.shift()
        if (w) w(value)
        else this.replies.push(value)
      }
    })
    this.running = server.run(this.toServer, this.fromServer, this.controller.signal).then(() => {
      this.returned = true
    })
  }
  send(line: string): void {
    this.toServer.write(line + '\n')
  }
  closeInput(): void {
    this.toServer.end()
  }
  cancel(): void {
    this.controller.abort()
  }
  nextReply(timeoutMs = 5000): Promise<Json | undefined> {
    const ready = this.replies.shift()
    if (ready !== undefined) return Promise.resolve(ready)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        resolve(undefined)
      }, timeoutMs)
      const waiter = (v: Json): void => {
        clearTimeout(timer)
        resolve(v)
      }
      this.waiters.push(waiter)
    })
  }
  async waitForRunToReturn(timeoutMs = 5000): Promise<boolean> {
    await Promise.race([this.running, new Promise((r) => setTimeout(r, timeoutMs))])
    return this.returned
  }
}

function makeServer(options: Partial<MCPServerOptions> = {}): MCPServer {
  const server = new MCPServer({ name: 'run-loop', version: '1', ...options })
  server.addTool({ name: 'espera', description: '', inputSchema: { type: 'object', properties: { ms: { type: 'integer' } } } }, (args, ctx) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ text: 'listo' }), Number(args.ms ?? 0))
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('cancelada'))
      })
    })
  )
  server.addTool({ name: 'suma', description: '', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } }, (a) => ({ text: String(Number(a.a) + Number(a.b)) }))
  return server
}

describe('MCPServer.run (bucle stdio)', () => {
  it('responde y termina con el EOF', async () => {
    const h = new Harness(makeServer())
    h.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}')
    h.send('{"jsonrpc":"2.0","method":"notifications/initialized"}')
    h.send('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"suma","arguments":{"a":40,"b":2}}}')
    const replies = [await h.nextReply(), await h.nextReply()].filter(Boolean)
    expect(replies).toHaveLength(2)
    const byID = Object.fromEntries(replies.map((r: Json) => [r.id, r]))
    expect(byID[1].result.serverInfo.name).toBe('run-loop')
    expect(byID[2].result.content[0].text).toBe('42')
    h.closeInput()
    expect(await h.waitForRunToReturn()).toBe(true)
  })

  it('una llamada lenta no bloquea a las demás y cada respuesta lleva su id', async () => {
    const h = new Harness(makeServer())
    h.send('{"jsonrpc":"2.0","id":"lenta","method":"tools/call","params":{"name":"espera","arguments":{"ms":600}}}')
    h.send('{"jsonrpc":"2.0","id":"rapida","method":"ping"}')
    expect((await h.nextReply()).id).toBe('rapida')
    expect((await h.nextReply()).id).toBe('lenta')
    h.closeInput()
  })

  it('las llamadas pendientes terminan aunque se cierre la entrada', async () => {
    const h = new Harness(makeServer())
    h.send('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"espera","arguments":{"ms":300}}}')
    h.closeInput()
    expect((await h.nextReply()).result.content[0].text).toBe('listo')
    expect(await h.waitForRunToReturn()).toBe(true)
  })

  it('la basura no rompe el bucle', async () => {
    const h = new Harness(makeServer())
    h.send('basura que no es json')
    h.send('')
    h.send('{"jsonrpc":"2.0","id":1,"method":"ping"}')
    const replies = [await h.nextReply(), await h.nextReply()].filter(Boolean)
    expect(replies).toHaveLength(2)
    expect(replies.some((r: Json) => r.error?.code === -32700 && r.id === null)).toBe(true)
    expect(replies.some((r: Json) => r.id === 1 && r.result !== undefined)).toBe(true)
    h.closeInput()
  })

  it('una línea demasiado grande se rechaza y el bucle sigue', async () => {
    const h = new Harness(makeServer({ maxLineBytes: 2000 }))
    h.send('x'.repeat(50_000))
    h.send('{"jsonrpc":"2.0","id":7,"method":"ping"}')
    h.closeInput()
    const replies: Json[] = []
    for (let r = await h.nextReply(600); r !== undefined; r = await h.nextReply(600)) replies.push(r)
    expect(replies.some((r) => r.id === 7)).toBe(true)
    expect(replies.some((r) => r.error?.code === -32600)).toBe(true)
  })

  it('notifications/cancelled suprime la respuesta y no hace esperar al cierre', async () => {
    const h = new Harness(makeServer())
    h.send('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"espera","arguments":{"ms":3000}}}')
    await new Promise((r) => setTimeout(r, 150))
    h.send('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":5,"reason":"user"}}')
    h.send('{"jsonrpc":"2.0","id":6,"method":"ping"}')
    const started = Date.now()
    expect((await h.nextReply(2000)).id).toBe(6)
    expect(Date.now() - started).toBeLessThan(2000)
    h.closeInput()
    expect(await h.waitForRunToReturn(4000)).toBe(true)
  })

  it('abortar el bucle lo detiene', async () => {
    const h = new Harness(makeServer())
    h.send('{"jsonrpc":"2.0","id":1,"method":"ping"}')
    await h.nextReply()
    h.cancel()
    expect(await h.waitForRunToReturn(3000)).toBe(true)
  })

  it('muchas peticiones seguidas', async () => {
    const h = new Harness(makeServer())
    for (let i = 0; i < 300; i++) h.send(`{"jsonrpc":"2.0","id":${i},"method":"tools/call","params":{"name":"suma","arguments":{"a":${i},"b":1}}}`)
    const seen = new Set<number>()
    for (let i = 0; i < 300; i++) {
      const r = await h.nextReply()
      if (!r) break
      expect(r.result.content[0].text).toBe(String(r.id + 1))
      seen.add(r.id)
    }
    expect(seen.size).toBe(300)
    h.closeInput()
  })
})
