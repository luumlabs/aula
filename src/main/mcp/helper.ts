// Lógica del ayudante MCP de Aula (`aula-mcp`): habla MCP por stdio con la CLI (Claude Code, Codex, OpenCode) y reenvía cada
// `tools/list` y `tools/call` a la app por el relevo local autenticado. No tiene secretos: solo la dirección y la clave del
// relevo de ESTA ejecución (variables AULA_RELAY_URL y AULA_RELAY_TOKEN).
import { Writable, type Readable } from 'node:stream'
import { format } from 'node:util'
import { createRelayToolsProvider, RELAY_TOKEN_ENV, RELAY_URL_ENV } from '../services/agents/relay'
import type { ToolsProvider } from '../services/agents/types'
import { MCPServer } from './server'

export const HELPER_NAME_ENV = 'AULA_MCP_NAME'
export const HELPER_INSTRUCTIONS_ENV = 'AULA_MCP_INSTRUCTIONS'
export const HELPER_TIMEOUT_ENV = 'AULA_MCP_TOOL_TIMEOUT_MS'

/** Solo se habla con un relevo en el bucle local (nunca con otra máquina). */
export function isLoopbackRelayURL(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]') && !url.username && !url.password
  } catch {
    return false
  }
}

export interface HelperIO {
  env: Record<string, string | undefined>
  stdin: Readable
  /** Escritura del protocolo (en el proceso real, una copia de stdout que no tocan los `console.log`). */
  writeProtocol: (text: string) => void
  logError: (text: string) => void
}

/** Atiende MCP hasta que la CLI cierre la entrada. Devuelve el código de salida. */
export async function runAulaMCP(io: HelperIO): Promise<number> {
  const url = io.env[RELAY_URL_ENV]
  const token = io.env[RELAY_TOKEN_ENV]
  if (!url || !token || !isLoopbackRelayURL(url)) {
    io.logError(`aula-mcp: faltan ${RELAY_URL_ENV} y ${RELAY_TOKEN_ENV} (o la dirección no es local). Este programa lo lanza Aula.`)
    return 2
  }
  const timeout = Number(io.env[HELPER_TIMEOUT_ENV])
  const relay = createRelayToolsProvider(url, token, { callTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined })
  // si la app no responde al listar, el agente se queda sin herramientas pero la conversación sigue
  const provider: ToolsProvider = {
    list: async () => {
      try {
        return await relay.list()
      } catch (err) {
        io.logError(`aula-mcp: no pude pedir las herramientas a Aula: ${err instanceof Error ? err.message : String(err)}`)
        return []
      }
    },
    call: (name, args, ctx) => relay.call(name, args, ctx)
  }
  const server = new MCPServer({
    name: io.env[HELPER_NAME_ENV] || 'aula',
    version: '2.0',
    instructions: io.env[HELPER_INSTRUCTIONS_ENV] || undefined,
    provider
  })
  const output = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      io.writeProtocol(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
      cb()
    }
  })
  await server.run(io.stdin, output)
  return 0
}

/** Punto de entrada real: protege stdout (todo `console.*` va a stderr) y sale al terminar. */
export function mainAulaMCP(): void {
  const stdout = process.stdout
  const rawWrite = stdout.write.bind(stdout) as (chunk: string) => boolean
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(format(...args) + '\n')
  }
  console.log = toStderr
  console.info = toStderr
  console.debug = toStderr
  console.warn = toStderr
  // un `process.stdout.write` perdido en cualquier módulo no debe corromper el protocolo
  stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    process.stderr.write(chunk as string)
    const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined
    cb?.()
    return true
  }) as typeof stdout.write
  stdout.on('error', () => process.exit(0)) // la CLI cerró la tubería
  runAulaMCP({
    env: process.env,
    stdin: process.stdin,
    writeProtocol: (text) => {
      rawWrite(text)
    },
    logError: (text) => process.stderr.write(text + '\n')
  }).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`aula-mcp: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
      process.exit(1)
    }
  )
}
