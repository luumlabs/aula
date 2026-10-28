// Canales de líneas JSON entre el cliente MCP y un servidor (port de `AgentKit/MCP/MCPTransport.swift`).
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { tr } from '@shared/ai/i18n'
import { ChildProcessHandle, isExecutableFile } from '../services/agents/child-process'
import { AgentError, AgentL10n } from '../services/agents/errors'
import { LineBuffer, TailBuffer } from '../services/agents/line-buffer'
import { childEnvironment, findExecutable, prepareLocator } from '../services/agents/locator'
import type { MCPServerSpec } from '../services/agents/types'

export interface MCPTransport {
  /** Empieza a recibir: `onLine` por cada línea del servidor; `onClose` cuando el servidor se cierra. */
  start(onLine: (line: string) => void, onClose: () => void): void
  /** Envía una línea. `false` si el canal ya está cerrado. */
  send(line: string): boolean
  /** Diagnóstico (final de stderr del servidor, código de salida…). */
  diagnostics(): Promise<string>
  /** Cierra el canal y detiene al servidor. */
  close(): void
}

const isWindows = process.platform === 'win32'

/** Un nombre con «/» se usa tal cual (con `~` expandido); si no, se busca en el PATH del shell de login y las carpetas habituales. */
export function resolveCommand(command: string): string | undefined {
  const trimmed = command.trim()
  if (!trimmed) return undefined
  if (trimmed.includes('/') || (isWindows && trimmed.includes('\\'))) {
    const expanded = trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
    return isExecutableFile(expanded) ? expanded : undefined
  }
  return findExecutable(trimmed)
}

export const processTransportSettings = {
  /** Espera tras cerrar la entrada antes de enviar SIGTERM (ms). */
  closeGraceMs: 1000,
  /** Espera entre SIGTERM y SIGKILL (ms). */
  terminateGraceMs: 1500
}

/** Servidor MCP lanzado como proceso hijo (stdio). */
export class ProcessMCPTransport implements MCPTransport {
  private readonly tail = new TailBuffer(16 * 1024)
  private pumpsDone = 0

  private constructor(private readonly proc: ChildProcessHandle) {}

  static async create(spec: MCPServerSpec, workingDirectory?: string): Promise<ProcessMCPTransport> {
    await prepareLocator()
    const executable = resolveCommand(spec.command)
    if (!executable) {
      throw new AgentError(
        'notInstalled',
        tr(
          `No encuentro el comando «${spec.command}» del servidor MCP «${spec.name}». Instálalo o indica la ruta completa en la configuración.`,
          `I can’t find the command “${spec.command}” for the MCP server “${spec.name}”. Install it or enter its full path in the configuration.`
        )
      )
    }
    try {
      const proc = await ChildProcessHandle.spawn(executable, spec.args ?? [], { env: childEnvironment(spec.env ?? {}), cwd: workingDirectory ?? homedir() })
      return new ProcessMCPTransport(proc)
    } catch (err) {
      throw new AgentError('other', AgentL10n.mcpCouldNotStart(spec.name, err instanceof Error ? err.message : String(err)))
    }
  }

  get pid(): number {
    return this.proc.pid
  }

  start(onLine: (line: string) => void, onClose: () => void): void {
    const buffer = new LineBuffer(32 * 1024 * 1024)
    this.proc.stdout.on('data', (chunk: Buffer) => {
      for (const l of buffer.append(chunk)) onLine(l)
    })
    let closed = false
    const finish = (): void => {
      if (closed) return
      closed = true
      const rest = buffer.finish()
      if (rest !== undefined) onLine(rest)
      this.pumpsDone += 1
      onClose()
    }
    this.proc.stdout.once('close', finish)
    this.proc.stdout.once('error', finish)
    this.proc.stderr.on('data', (chunk: Buffer) => this.tail.append(chunk))
    this.proc.stderr.once('close', () => (this.pumpsDone += 1))
  }

  send(line: string): boolean {
    if (!this.proc.isRunning) return false
    this.proc.writeStdin(line + '\n')
    return true
  }

  async diagnostics(): Promise<string> {
    // un instante para que un proceso que acaba de fallar termine y tener su stderr completo
    for (let i = 0; i < 8 && this.proc.isRunning; i++) await sleep(25)
    const parts: string[] = []
    if (!this.proc.isRunning) {
      for (let i = 0; i < 50 && this.pumpsDone < 2; i++) await sleep(10)
      const exit = await this.proc.waitForExit()
      parts.push(exit.signal !== undefined ? tr(`terminó con señal ${exit.signal}`, `ended with signal ${exit.signal}`) : tr(`terminó con código ${exit.code}`, `ended with code ${exit.code}`))
    }
    const tail = this.tail.text
    if (tail) parts.push(`stderr: ${Array.from(tail).slice(-1500).join('')}`)
    return parts.join('. ')
  }

  close(): void {
    // cierre ordenado: cerrar stdin, esperar un poco y, si sigue vivo, SIGTERM/SIGKILL al grupo
    this.proc.closeStdin()
    const timer = setTimeout(() => this.proc.terminate(processTransportSettings.terminateGraceMs), processTransportSettings.closeGraceMs)
    timer.unref?.()
  }
}

/** Servidor conectado por dos flujos (en el mismo proceso: pruebas). */
export class StreamMCPTransport implements MCPTransport {
  private closed = false
  constructor(
    private readonly readable: Readable,
    private readonly writable: Writable
  ) {}

  start(onLine: (line: string) => void, onClose: () => void): void {
    const buffer = new LineBuffer(32 * 1024 * 1024)
    this.readable.on('data', (chunk: Buffer | string) => {
      for (const l of buffer.append(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)) onLine(l)
    })
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      const rest = buffer.finish()
      if (rest !== undefined) onLine(rest)
      onClose()
    }
    this.readable.once('end', finish)
    this.readable.once('close', finish)
  }

  send(line: string): boolean {
    if (this.closed || this.writable.writableEnded || this.writable.destroyed) return false
    this.writable.write(line + '\n')
    return true
  }

  async diagnostics(): Promise<string> {
    return tr('el canal se cerró', 'the channel closed')
  }

  close(): void {
    this.closed = true
    this.readable.removeAllListeners('data')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
