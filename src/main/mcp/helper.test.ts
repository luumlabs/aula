// El ayudante `aula-mcp` de punta a punta: la CLI le habla MCP por stdio y él reenvía cada `tools/list` y `tools/call` a la app
// por el relevo local. En el mismo proceso (flujos) y, si ya está empaquetado, el script real `out/main/aula-mcp.js` como hijo.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { startToolRelayServer, RELAY_TOKEN_ENV, RELAY_URL_ENV } from '../services/agents/relay'
import type { RelayableTool } from '../services/agents/types'
import { HELPER_INSTRUCTIONS_ENV, HELPER_NAME_ENV, isLoopbackRelayURL, runAulaMCP } from './helper'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const TOOLS: RelayableTool[] = [
  { name: 'crear_leccion', description: 'Crea una lección', inputSchema: { type: 'object', properties: { titulo: { type: 'string' } } }, run: (a) => `Lección «${a.titulo}» creada` },
  { name: 'ver_pantalla', description: '', inputSchema: {}, run: () => ({ text: 'captura', images: [{ mediaType: 'image/png', base64: 'QUJD' }] }) }
]

const REQUESTS = [
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"2"}}}',
  '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"crear_leccion","arguments":{"titulo":"Círculo unidad"}}}',
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"ver_pantalla","arguments":{}}}'
]

async function runHelper(env: Record<string, string | undefined>, lines: string[]): Promise<{ code: number; replies: Json[]; errors: string[] }> {
  const stdin = new PassThrough()
  const out: string[] = []
  const errors: string[] = []
  const done = runAulaMCP({ env, stdin, writeProtocol: (t) => out.push(t), logError: (t) => errors.push(t) })
  stdin.end(lines.join('\n') + '\n')
  const code = await done
  return { code, replies: out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)), errors }
}

const byID = (replies: Json[]): Record<number, Json> => Object.fromEntries(replies.map((r) => [r.id, r]))

describe('aula-mcp', () => {
  it('solo habla con un relevo de este ordenador', () => {
    expect(isLoopbackRelayURL('http://127.0.0.1:4100')).toBe(true)
    expect(isLoopbackRelayURL('http://[::1]:4100')).toBe(true)
    expect(isLoopbackRelayURL('https://127.0.0.1:4100')).toBe(false)
    expect(isLoopbackRelayURL('http://192.168.1.4:4100')).toBe(false)
    expect(isLoopbackRelayURL('http://localhost.evil.com:4100')).toBe(false)
    expect(isLoopbackRelayURL('http://user:pw@127.0.0.1:4100')).toBe(false)
    expect(isLoopbackRelayURL('no es una url')).toBe(false)
  })

  it('sin dirección y clave del relevo (o con una dirección ajena) no arranca', async () => {
    expect((await runHelper({}, [])).code).toBe(2)
    const remote = await runHelper({ [RELAY_URL_ENV]: 'http://10.0.0.2:4000', [RELAY_TOKEN_ENV]: 'x' }, [])
    expect(remote.code).toBe(2)
    expect(remote.errors.join('')).toContain('Este programa lo lanza Aula')
  })

  it('reenvía tools/list y tools/call a la app', async () => {
    const relay = await startToolRelayServer(TOOLS)
    try {
      const { code, replies } = await runHelper({ ...relay.env, [HELPER_NAME_ENV]: 'aula', [HELPER_INSTRUCTIONS_ENV]: 'Usa las herramientas de Aula.' }, REQUESTS)
      expect(code).toBe(0)
      expect(replies).toHaveLength(4)
      const r = byID(replies)
      expect(r[1].result.serverInfo.name).toBe('aula')
      expect(r[1].result.instructions).toBe('Usa las herramientas de Aula.')
      expect(r[2].result.tools.map((t: Json) => t.name)).toEqual(['crear_leccion', 'ver_pantalla'])
      expect(r[2].result.tools[1].inputSchema).toEqual({ type: 'object', properties: {} })
      expect(r[3].result).toEqual({ content: [{ type: 'text', text: 'Lección «Círculo unidad» creada' }], isError: false })
      expect(r[4].result.content[1]).toEqual({ type: 'image', data: 'QUJD', mimeType: 'image/png' })
    } finally {
      await relay.close()
    }
  })

  it('si la app no responde, el agente se queda sin herramientas pero sigue', async () => {
    const relay = await startToolRelayServer(TOOLS)
    await relay.close() // la ejecución terminó: nadie escucha en esa dirección
    const { code, replies, errors } = await runHelper(relay.env, REQUESTS)
    expect(code).toBe(0)
    const r = byID(replies)
    expect(r[2].result.tools).toEqual([])
    expect(r[3].result.isError).toBe(true)
    expect(r[3].result.content[0].text).toContain('not reachable')
    expect(errors.join('')).toContain('no pude pedir las herramientas')
  })

  const BUNDLE = join(__dirname, '..', '..', '..', 'out', 'main', 'aula-mcp.js')
  it.skipIf(!existsSync(BUNDLE))('el script empaquetado, lanzado como lo lanza la CLI, habla MCP por stdout y nada más', async () => {
    const relay = await startToolRelayServer(TOOLS)
    try {
      const child = spawn(process.execPath, [BUNDLE], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...relay.env }, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
      child.stdin.end(REQUESTS.join('\n') + '\n')
      const code = await new Promise<number | null>((resolve) => child.on('exit', resolve))
      expect(code).toBe(0)
      const replies = stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)) // cada línea de stdout es JSON-RPC
      expect(replies).toHaveLength(4)
      expect(byID(replies)[3].result.content[0].text).toBe('Lección «Círculo unidad» creada')
    } finally {
      await relay.close()
    }
  })
})
