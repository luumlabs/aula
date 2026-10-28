// Port de `Tests/AgentKitTests/MCPClientLifecycleTests.swift`: el ciclo de vida del cliente MCP (parar a mitad del arranque,
// reconectar, compartir una conexión) con transportes en memoria propios. Sin procesos, red ni credenciales.
import { describe, expect, it } from 'vitest'
import { isCancellation } from '../services/agents/errors'
import { MCPClient } from './client'
import { LATEST_VERSION, rpcError, rpcResponse } from './protocol'
import type { MCPTransport } from './transport'

class MemoryTransport implements MCPTransport {
  closeCount = 0
  readonly methods: string[] = []
  private closed = false
  private onLine?: (line: string) => void
  private initializeID?: unknown
  initializedHook?: () => void
  private initializeSeenResolve!: () => void
  readonly initializeSeen = new Promise<void>((r) => (this.initializeSeenResolve = r))

  constructor(
    readonly label: string,
    readonly autoInitialize = true,
    readonly initializeError = false
  ) {}

  start(onLine: (line: string) => void): void {
    this.onLine = onLine
  }
  private push(value: unknown): void {
    const l = JSON.stringify(value)
    setImmediate(() => !this.closed && this.onLine?.(l))
  }
  send(line: string): boolean {
    if (this.closed) return false
    const m = JSON.parse(line)
    if (m.method) this.methods.push(m.method)
    if (m.method === 'initialize') {
      this.initializeID = m.id
      this.initializeSeenResolve()
      if (this.autoInitialize) this.respondToInitialize()
    } else if (m.method === 'notifications/initialized') {
      this.initializedHook?.()
    } else if (m.method === 'tools/list' && m.id !== undefined) {
      this.push(rpcResponse(m.id, { tools: [{ name: 'tool_' + this.label, description: 'Synthetic tool', inputSchema: { type: 'object', properties: {} } }] }))
    }
    return !this.closed
  }
  respondToInitialize(): void {
    if (this.initializeID === undefined) return
    const id = this.initializeID as number
    if (this.initializeError) this.push(rpcError(id, -32603, 'synthetic initialization failure'))
    else this.push(rpcResponse(id, { protocolVersion: LATEST_VERSION, capabilities: {}, serverInfo: { name: this.label, version: '1' } }))
  }
  async diagnostics(): Promise<string> {
    return 'owned synthetic diagnostics'
  }
  close(): void {
    this.closeCount += 1
    this.closed = true
  }
}

function makeClient(transports: MemoryTransport[]): { client: MCPClient; made: () => number } {
  let calls = 0
  const client = new MCPClient({ name: 'owned-lifecycle', command: 'never-executed' }, {
    startupTimeoutMs: 2000,
    callTimeoutMs: 2000,
    transport: () => {
      if (calls >= transports.length) throw new Error('Synthetic factory exhausted')
      return transports[calls++]
    }
  })
  return { client, made: () => calls }
}

async function outcome<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await promise }
  } catch (error) {
    return { error }
  }
}

describe('MCPClient · ciclo de vida', () => {
  it('parar dentro de «initialized» retira la sesión y el siguiente uso reconecta', async () => {
    const old = new MemoryTransport('retired')
    const fresh = new MemoryTransport('fresh')
    const { client, made } = makeClient([old, fresh])
    old.initializedHook = () => client.stop()
    const r = await outcome(client.start())
    expect(isCancellation(r.error)).toBe(true)
    expect(old.closeCount).toBe(1)
    expect(old.methods).not.toContain('tools/list')
    expect((await client.tools()).map((t) => t.name)).toEqual(['tool_fresh'])
    expect(made()).toBe(2)
    expect(fresh.closeCount).toBe(0)
    client.stop()
  })

  it('parar con el initialize pendiente cierra solo el transporte viejo y permite arrancar otra vez', async () => {
    const old = new MemoryTransport('pending-old', false)
    const fresh = new MemoryTransport('fresh')
    const { client, made } = makeClient([old, fresh])
    const first = outcome(client.start())
    await old.initializeSeen
    client.stop()
    const stopped = await first
    expect(stopped.error).toBeDefined()
    expect(old.closeCount).toBe(1)
    expect(old.methods).not.toContain('notifications/initialized')
    expect((await client.tools()).map((t) => t.name)).toEqual(['tool_fresh'])
    expect(made()).toBe(2)
    expect(fresh.closeCount).toBe(0)
    client.stop()
  })

  it('quienes esperan a la vez comparten una sola conexión sana', async () => {
    const transport = new MemoryTransport('shared', false)
    const { client, made } = makeClient([transport])
    const operations = Array.from({ length: 20 }, () => outcome(client.tools()))
    await transport.initializeSeen
    transport.respondToInitialize()
    for (const r of await Promise.all(operations)) {
      expect(r.error).toBeUndefined()
      expect(r.value?.map((t) => t.name)).toEqual(['tool_shared'])
    }
    expect(made()).toBe(1)
    expect(transport.closeCount).toBe(0)
    expect(transport.methods.filter((m) => m === 'initialize')).toHaveLength(1)
    client.stop()
  })

  it('cancelar una llamada durante el arranque compartido no cancela la otra', async () => {
    const transport = new MemoryTransport('shared', false)
    const { client, made } = makeClient([transport])
    const controller = new AbortController()
    const cancelled = outcome(client.tools(controller.signal))
    await transport.initializeSeen
    controller.abort()
    const healthy = outcome(client.tools())
    transport.respondToInitialize()
    expect(isCancellation((await cancelled).error)).toBe(true)
    const ok = await healthy
    expect(ok.error).toBeUndefined()
    expect(ok.value?.map((t) => t.name)).toEqual(['tool_shared'])
    expect(made()).toBe(1)
    expect(transport.closeCount).toBe(0)
    client.stop()
  })

  it('un error normal en initialize cierra su transporte y permite reintentar', async () => {
    const broken = new MemoryTransport('broken', true, true)
    const fresh = new MemoryTransport('fresh')
    const { client, made } = makeClient([broken, fresh])
    const r = await outcome(client.start())
    expect(String((r.error as Error).message)).toContain('synthetic initialization failure')
    expect(isCancellation(r.error)).toBe(false)
    expect(broken.closeCount).toBe(1)
    expect((await client.tools()).map((t) => t.name)).toEqual(['tool_fresh'])
    expect(made()).toBe(2)
    expect(fresh.closeCount).toBe(0)
    client.stop()
  })

  it('parar varias veces y reutilizar nunca cierra una sesión más nueva', async () => {
    const first = new MemoryTransport('first')
    const second = new MemoryTransport('second')
    const third = new MemoryTransport('third')
    const { client, made } = makeClient([first, second, third])
    expect((await client.tools()).map((t) => t.name)).toEqual(['tool_first'])
    client.stop()
    client.stop()
    expect(first.closeCount).toBe(1)
    expect((await client.tools()).map((t) => t.name)).toEqual(['tool_second'])
    expect(second.closeCount).toBe(0)
    client.stop()
    client.stop()
    expect(second.closeCount).toBe(1)
    expect((await client.tools()).map((t) => t.name)).toEqual(['tool_third'])
    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(1)
    expect(third.closeCount).toBe(0)
    expect(made()).toBe(3)
    client.stop()
  })
})
