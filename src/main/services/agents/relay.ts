// Relevo de herramientas entre el ayudante MCP (`aula-mcp`, otro proceso que lanza la CLI) y la app de Aula
// (idea de `StudyEngine/Pipeline/ToolRelay.swift`, ahora por HTTP local con clave en vez de archivos).
//
// La app arranca un servidor HTTP en 127.0.0.1 (puerto libre) con una clave aleatoria por ejecución; el ayudante recibe la
// dirección y la clave por variables de entorno y reenvía cada `tools/list` y `tools/call`. Así los secretos (claves de API,
// sesiones de las plataformas, permisos del sistema) NUNCA salen de la app: el ayudante solo transporta peticiones.
// Si la CLI cancela una llamada, el ayudante corta su petición HTTP y la herramienta recibe la cancelación (`ctx.signal`):
// una tarjeta de permiso que aún espera se da por no contestada y aprobarla tarde nunca hace la acción a espaldas de la IA.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { toolOutputFromResult } from '../../mcp/protocol'
import { log } from '../log'
import { arr, compactJSON, isObject, str, tryParse } from './json'
import type { ImagePart, JSONObject, RelayableTool, ToolOutput, ToolRunContext, ToolSpec, ToolsProvider } from './types'

export const RELAY_URL_ENV = 'AULA_RELAY_URL'
export const RELAY_TOKEN_ENV = 'AULA_RELAY_TOKEN'

export interface ToolRelayServer {
  /** `http://127.0.0.1:<puerto>` */
  readonly url: string
  readonly token: string
  /** Variables de entorno para el ayudante (dirección y clave del relevo). */
  readonly env: Record<string, string>
  /** Llamadas en curso. */
  readonly activeCalls: number
  /** Deja de atender: las llamadas en curso se cancelan y responden «Aula dejó de atender». */
  close(): Promise<void>
}

export interface RelayServerOptions {
  /** Tamaño máximo del cuerpo de una petición. */
  maxBodyBytes?: number
}

/** Texto (en inglés: lo lee el modelo) cuando la app deja de atender a mitad de una llamada. */
export const RELAY_STOPPED_TEXT = 'Aula stopped serving this tool (the run or the chat ended).'

/** Convierte lo que devuelva `run` (texto, `ToolOutput`, resultado MCP o cualquier valor) en un `ToolOutput`. */
export function normalizeToolResult(value: unknown): ToolOutput {
  if (value === undefined || value === null) return { text: '' }
  if (typeof value === 'string') return { text: value }
  if (isObject(value)) {
    if (typeof value.text === 'string') {
      const images = (arr(value.images) ?? []).filter((i): i is ImagePart => isObject(i) && typeof i.base64 === 'string' && typeof i.mediaType === 'string')
      return { text: value.text, ...(images.length ? { images } : {}), ...(value.isError === true ? { isError: true } : {}) }
    }
    if (Array.isArray(value.content)) return toolOutputFromResult(value)
  }
  return { text: compactJSON(value) }
}

/** Un `ToolsProvider` a partir de herramientas con la forma de la capa de IA. */
export function toolsProviderFrom(tools: RelayableTool[], extraContext: Record<string, unknown> = {}): ToolsProvider {
  const byName = new Map<string, RelayableTool>()
  for (const tool of tools) if (!byName.has(tool.name)) byName.set(tool.name, tool)
  return {
    list: () => Array.from(byName.values()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    call: async (name, args, ctx) => {
      const tool = byName.get(name)
      if (!tool) return { text: `Unknown tool «${name}».`, isError: true }
      try {
        return normalizeToolResult(await tool.run(args, { ...extraContext, ...ctx }))
      } catch (err) {
        if (ctx.signal.aborted) return { text: 'Cancelled.', isError: true }
        return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
      }
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const parts: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) tooBig = true
      else parts.push(chunk)
    })
    req.on('end', () => resolve(tooBig ? undefined : Buffer.concat(parts).toString('utf8')))
    req.on('error', () => resolve(undefined))
  })
}

/**
 * Arranca el relevo en 127.0.0.1 con una clave aleatoria. Rutas (POST, JSON, `Authorization: Bearer <clave>`):
 *  - `/v1/tools/list` → `{tools:[{name, description, inputSchema}]}`
 *  - `/v1/tools/call` `{name, arguments}` → `{text, images?, isError?}`
 *  - `/v1/ping` → `{ok:true}`
 * Se rechaza cualquier petición con cabecera `Origin` (navegadores) o con un `Host` que no sea el del propio relevo.
 */
export async function startToolRelayServer(source: ToolsProvider | RelayableTool[], options: RelayServerOptions = {}): Promise<ToolRelayServer> {
  const provider = Array.isArray(source) ? toolsProviderFrom(source) : source
  const token = randomBytes(32).toString('hex')
  const maxBody = options.maxBodyBytes ?? 32 * 1024 * 1024
  const inflight = new Set<AbortController>()
  let closing = false
  let port = 0

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'forbidden' })
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: 'forbidden' })
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), token)) return send(res, 401, { error: 'unauthorized' })
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'unsupported_media_type' })
    const body = await readBody(req, maxBody)
    if (body === undefined) return send(res, 413, { error: 'too_large' })
    if (closing) return send(res, 200, { text: RELAY_STOPPED_TEXT, isError: true })
    const url = req.url ?? ''
    if (url === '/v1/ping') return send(res, 200, { ok: true })
    if (url === '/v1/tools/list') {
      try {
        const tools = await provider.list()
        return send(res, 200, { tools: tools.map((t: ToolSpec) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
      } catch (err) {
        return send(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (url === '/v1/tools/call') {
      const json = tryParse(body)
      const name = isObject(json) ? str(json.name) : undefined
      if (!name) return send(res, 400, { error: 'missing_name' })
      const args = isObject(json) && isObject(json.arguments) ? json.arguments : {}
      const controller = new AbortController()
      inflight.add(controller)
      // el ayudante cortó la petición (la CLI canceló la llamada o se le acabó su plazo): se cancela también aquí
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })
      let output: ToolOutput
      try {
        output = await provider.call(name, args, { signal: controller.signal })
      } catch (err) {
        output = { text: controller.signal.aborted ? 'Cancelled.' : `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
      } finally {
        inflight.delete(controller)
      }
      if (closing && controller.signal.aborted) output = { text: RELAY_STOPPED_TEXT, isError: true }
      return send(res, 200, output)
    }
    return send(res, 404, { error: 'not_found' })
  }

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      log.warn('[relay] petición fallida', err)
      send(res, 500, { error: 'internal' })
    })
  })
  server.requestTimeout = 0 // las herramientas pueden esperar a que el estudiante conteste
  server.headersTimeout = 30_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`
  return {
    url,
    token,
    env: { [RELAY_URL_ENV]: url, [RELAY_TOKEN_ENV]: token },
    get activeCalls() {
      return inflight.size
    },
    close: async () => {
      if (closing) return
      closing = true
      for (const controller of inflight) controller.abort()
      // dar un instante a que las llamadas canceladas respondan «Aula dejó de atender»
      for (let i = 0; i < 20 && inflight.size > 0; i++) await new Promise((r) => setTimeout(r, 25))
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    }
  }
}

// MARK: Lado del ayudante

export interface RelayClientOptions {
  /** Plazo de cada llamada (ms). Las herramientas pueden esperar a una tarjeta de permiso. */
  callTimeoutMs?: number
  listTimeoutMs?: number
}

interface RelayResponse {
  status: number
  body: string
}

function post(url: string, token: string, path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<RelayResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(path, url)
    const data = JSON.stringify(body)
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
        agent: false
      },
      (res) => {
        const parts: Buffer[] = []
        res.on('data', (c: Buffer) => parts.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }))
        res.on('error', reject)
      }
    )
    const timer = setTimeout(() => req.destroy(new Error('timeout')), Math.max(1, timeoutMs))
    const onAbort = (): void => {
      req.destroy(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('error', (err) => reject(err))
    req.on('close', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    })
    req.end(data)
  })
}

/** Proveedor de herramientas que reenvía todo a la app por el relevo (lo usa `aula-mcp`). */
export function createRelayToolsProvider(url: string, token: string, options: RelayClientOptions = {}): ToolsProvider {
  const callTimeout = options.callTimeoutMs ?? 900_000
  const listTimeout = options.listTimeoutMs ?? 30_000
  return {
    list: async (): Promise<ToolSpec[]> => {
      const res = await post(url, token, '/v1/tools/list', {}, listTimeout)
      if (res.status !== 200) throw new Error(`Aula respondió ${res.status} al listar las herramientas`)
      const json = tryParse(res.body)
      return (arr(isObject(json) ? json.tools : undefined) ?? [])
        .filter(isObject)
        .map((t) => ({ name: str(t.name) ?? '', description: str(t.description) ?? '', inputSchema: isObject(t.inputSchema) ? t.inputSchema : {} }))
        .filter((t) => t.name)
    },
    call: async (name: string, args: JSONObject, ctx: ToolRunContext): Promise<ToolOutput> => {
      try {
        const res = await post(url, token, '/v1/tools/call', { name, arguments: args }, callTimeout, ctx.signal)
        if (res.status !== 200) return { text: `Aula could not run this tool (HTTP ${res.status}).`, isError: true }
        return normalizeToolResult(tryParse(res.body) ?? { text: res.body })
      } catch (err) {
        if (ctx.signal.aborted) return { text: 'Cancelled.', isError: true }
        if (err instanceof Error && err.message === 'timeout') return { text: 'Aula did not answer in time. Continue without this tool.', isError: true }
        return { text: 'Aula is not reachable (the run or the chat ended). Continue without this tool.', isError: true }
      }
    }
  }
}
