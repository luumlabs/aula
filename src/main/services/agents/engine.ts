// Motor común de los agentes CLI: lanza la CLI, trocea su salida en líneas JSON, se las pasa al analizador de esa CLI y
// emite los eventos; aplica el plazo, la cancelación, el periodo de gracia tras el resultado y las violaciones de seguridad
// (port de `AgentKit/CLI/CLIEngine.swift`).
import { tr } from '@shared/ai/i18n'
import { log } from '../log'
import { ChildProcessHandle, SpawnError, exitSucceeded, type ChildExit } from './child-process'
import { AgentError, AgentL10n, CancelledError, humanDuration, isCancellation, type AgentErrorKind, type CLIErrorClassifier } from './errors'
import { compactJSON } from './json'
import { LineBuffer, TailBuffer } from './line-buffer'
import type { AgentEvent, AgentResult } from './types'

// MARK: Contratos entre el motor y los analizadores

export interface CLIInvocation {
  executable: string
  arguments: string[]
  environment: Record<string, string>
  workingDirectory: string
  /** Lo que se escribe en stdin (y luego se cierra). */
  stdin?: string | Uint8Array
}

export interface CLIParseStep {
  events: AgentEvent[]
  /** El agente hizo (o pudo hacer) algo que viola la política de seguridad: se detiene y se informa. */
  violation?: string
  /** Fue el evento final de la ejecución (empieza la gracia para que el proceso salga solo). */
  isTerminal?: boolean
  /** El analizador decidió cortar (p. ej. límite de pasos). */
  stopNow?: boolean
}

export interface CLIFailure {
  message: string
  kind?: AgentErrorKind
  retryAfter?: number
}

export type CLIConclusion = { type: 'finished'; result: AgentResult } | { type: 'failed'; failure: CLIFailure } | { type: 'noResult' }

/** Traduce la salida de una CLI (un JSON por línea) a eventos. */
export interface CLIEventParser {
  consume(line: string): CLIParseStep
  conclude(): CLIConclusion
  /** Muestra de líneas que no eran eventos válidos (para mensajes de error). */
  readonly unparsedSample: string
  /** Por qué la CLI no avanza (reintentos por 429…): explica un tiempo agotado. */
  stallFailure?(): CLIFailure | undefined
}

export function step(events: AgentEvent[] = []): CLIParseStep {
  return { events }
}

// MARK: Flujo de eventos

/**
 * Crea un flujo de eventos: el cuerpo empieza al pedir el primer evento y se cancela (abortando su `signal`, lo que mata al
 * proceso hijo) si quien consume deja de iterar o aborta `outer`. La cancelación termina el flujo sin error.
 */
export function eventStream<E>(body: (emit: (e: E) => void, signal: AbortSignal) => Promise<void>, outer?: AbortSignal): AsyncIterableIterator<E> {
  const controller = new AbortController()
  const onOuter = (): void => controller.abort()
  if (outer) {
    if (outer.aborted) controller.abort()
    else outer.addEventListener('abort', onOuter, { once: true })
  }
  const queue: E[] = []
  let waiter: { resolve: (r: IteratorResult<E>) => void; reject: (e: unknown) => void } | undefined
  let started = false
  let finished = false
  let failure: unknown

  const end = (err?: unknown): void => {
    if (finished) return
    finished = true
    outer?.removeEventListener('abort', onOuter)
    if (waiter) {
      const w = waiter
      waiter = undefined
      if (err !== undefined) w.reject(err)
      else w.resolve({ value: undefined, done: true })
    } else {
      failure = err
    }
  }
  const emit = (e: E): void => {
    if (finished) return
    if (waiter) {
      const w = waiter
      waiter = undefined
      w.resolve({ value: e, done: false })
    } else {
      queue.push(e)
    }
  }
  const start = (): void => {
    started = true
    let promise: Promise<void>
    try {
      promise = body(emit, controller.signal)
    } catch (err) {
      promise = Promise.reject(err)
    }
    promise.then(
      () => end(),
      (err: unknown) => end(isCancellation(err) || controller.signal.aborted ? undefined : wrapUnexpected(err))
    )
  }

  const iterator: AsyncIterableIterator<E> = {
    next(): Promise<IteratorResult<E>> {
      if (!started) start()
      if (queue.length > 0) return Promise.resolve({ value: queue.shift() as E, done: false })
      if (finished) {
        if (failure !== undefined) {
          const f = failure
          failure = undefined
          return Promise.reject(f)
        }
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject }
      })
    },
    return(): Promise<IteratorResult<E>> {
      controller.abort()
      queue.length = 0
      failure = undefined
      end()
      return Promise.resolve({ value: undefined, done: true })
    },
    [Symbol.asyncIterator]() {
      return iterator
    }
  }
  return iterator
}

function wrapUnexpected(err: unknown): unknown {
  if (err instanceof AgentError) return err
  const reason = err instanceof Error ? err.message : String(err)
  return new AgentError('other', tr(`Error inesperado al ejecutar el agente: ${reason}`, `Unexpected error while running the agent: ${reason}`))
}

// MARK: Motor

export const engineSettings = {
  /** Tiempo que se deja a la CLI para salir sola tras emitir su evento final antes de terminarla (ms). */
  postResultGraceMs: 10_000
}

export interface RunCLIOptions {
  timeoutMs: number
  postResultGraceMs?: number
  signal?: AbortSignal
  emit: (event: AgentEvent) => void
}

/**
 * Lanza la CLI, interpreta su salida y emite los eventos. Lanza `AgentError` si algo falla y `CancelledError` si se canceló
 * (después de matar al proceso y a sus hijos).
 */
export async function runCLI(invocation: CLIInvocation, parser: CLIEventParser, classifier: CLIErrorClassifier, options: RunCLIOptions): Promise<void> {
  const { emit, signal } = options
  if (signal?.aborted) throw new CancelledError()
  log.info(`[agents] ${classifier.executableName} ${describeArguments(invocation.arguments)}`)
  let proc: ChildProcessHandle
  try {
    proc = await ChildProcessHandle.spawn(invocation.executable, invocation.arguments, { env: invocation.environment, cwd: invocation.workingDirectory })
  } catch (err) {
    const reason = err instanceof SpawnError || err instanceof Error ? err.message : String(err)
    throw new AgentError('other', tr(`No pude iniciar ${classifier.cliName}: ${reason}`, `I couldn’t start ${classifier.cliName}: ${reason}`))
  }

  let timedOut = false
  let cancelled = false
  let violation: string | undefined
  let stoppedByParser = false
  let sawTerminal = false
  let graceTimer: NodeJS.Timeout | undefined
  const postResultGrace = options.postResultGraceMs ?? engineSettings.postResultGraceMs

  if (invocation.stdin !== undefined && invocation.stdin.length > 0) proc.writeStdin(invocation.stdin, true)
  else proc.closeStdin()

  const tail = new TailBuffer(32 * 1024)
  const stderrDone = new Promise<void>((resolve) => {
    proc.stderr.on('data', (chunk: Buffer) => tail.append(chunk))
    proc.stderr.once('close', () => resolve())
    proc.stderr.once('error', () => resolve())
  })
  const timer = setTimeout(() => {
    timedOut = true
    proc.terminate(2000)
  }, Math.max(10, options.timeoutMs))
  const onAbort = (): void => {
    cancelled = true
    proc.terminate(1000)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const handle = (line: string): void => {
    if (violation !== undefined || stoppedByParser) return // tras una violación o un corte se descarta todo lo demás
    const result = parser.consume(line)
    for (const event of result.events) emit(event)
    if (result.violation !== undefined) {
      violation = result.violation
      proc.terminate(1000)
      return
    }
    if (result.stopNow) {
      stoppedByParser = true
      proc.terminate(2000)
      return
    }
    if (result.isTerminal) {
      sawTerminal = true
      if (!graceTimer) graceTimer = setTimeout(() => proc.terminate(2000), postResultGrace)
    }
  }

  const lines = new LineBuffer()
  let announcedDropped = 0
  try {
    for await (const chunk of proc.stdout) {
      for (const line of lines.append(chunk as Buffer)) handle(line)
      if (lines.droppedLines > announcedDropped) {
        announcedDropped = lines.droppedLines
        emit({ type: 'notice', text: tr(`Se descartó una línea de salida de ${classifier.cliName} por ser demasiado larga.`, `A line of output from ${classifier.cliName} was dropped because it was too long.`) })
      }
    }
  } catch {
    /* la tubería se cortó (rezagado que la mantenía abierta) */
  }
  const rest = lines.finish()
  if (rest !== undefined) handle(rest)
  const exit = await proc.waitForExit()
  clearTimeout(timer)
  if (graceTimer) clearTimeout(graceTimer)
  signal?.removeEventListener('abort', onAbort)
  await Promise.race([stderrDone, new Promise((r) => setTimeout(r, 2500))])
  const stderrText = tail.text

  if (cancelled || signal?.aborted) throw new CancelledError()
  if (violation !== undefined) throw new AgentError('other', violation)
  // si el plazo venció con el resultado final ya llegado (el proceso solo se estaba apagando), el resultado vale
  if (timedOut && !sawTerminal) {
    const stall = parser.stallFailure?.()
    if (stall) {
      const classified = classifier.classify(stall.message, stall.kind, stall.retryAfter)
      if (classified.kind === 'rateLimited' || classified.kind === 'notLoggedIn') throw classified
    }
    const took = humanDuration(options.timeoutMs / 1000)
    let message = tr(`${classifier.cliName} tardó más de ${took} y se detuvo.`, `${classifier.cliName} took longer than ${took} and was stopped.`)
    if (stall?.message) message += ' ' + AgentL10n.detail(stall.message.slice(0, 300))
    throw new AgentError('timeout', message)
  }

  const conclusion = parser.conclude()
  if (conclusion.type === 'finished') {
    emit({ type: 'usage', usage: conclusion.result.usage })
    emit({ type: 'finished', result: conclusion.result })
    return
  }
  if (conclusion.type === 'failed') {
    throw classifier.classify(conclusion.failure.message, conclusion.failure.kind, conclusion.failure.retryAfter)
  }
  throw noResultError(classifier, exit, stderrText, parser.unparsedSample)
}

function noResultError(classifier: CLIErrorClassifier, exit: ChildExit, stderr: string, unparsed: string): AgentError {
  const detail = [stderr, unparsed].map((t) => t.trim()).filter(Boolean).join('\n')
  if (detail) {
    const classified = classifier.classify(detail)
    if (classified.kind !== 'other' || !exitSucceeded(exit)) return classified
  }
  if (exitSucceeded(exit)) {
    const cli = classifier.cliName
    if (unparsed) {
      const sample = unparsed.slice(0, 300)
      return new AgentError('badResponse', tr(`${cli} devolvió una salida que no entiendo: ${sample}`, `${cli} returned output I don’t understand: ${sample}`))
    }
    return new AgentError('badResponse', tr(`${cli} terminó sin dar ninguna respuesta (la salida se cortó antes de tiempo).`, `${cli} ended without giving any answer (the output was cut off early).`))
  }
  if (exit.signal !== undefined) {
    return new AgentError('other', tr(`${classifier.cliName} terminó con señal ${exit.signal} sin dar respuesta.`, `${classifier.cliName} ended with signal ${exit.signal} without answering.`))
  }
  return new AgentError('other', tr(`${classifier.cliName} terminó con código ${exit.code} sin dar respuesta.`, `${classifier.cliName} ended with code ${exit.code} without answering.`))
}

/** Descripción para el registro: recorta valores y oculta prompts y argumentos/entorno de servidores MCP. */
export function describeArguments(args: string[]): string {
  let previousIsSecret = false
  return args
    .map((argument) => {
      const hide = previousIsSecret
      previousIsSecret = argument === '--system-prompt'
      if (hide) return '<oculto>'
      if (argument.startsWith('developer_instructions=')) return 'developer_instructions=<oculto>'
      if (argument.startsWith('mcp_servers.')) {
        const eq = argument.indexOf('=')
        if (eq >= 0 && argument.slice(0, eq).endsWith('.args')) return argument.slice(0, eq + 1) + '<oculto>'
      }
      const env = argument.indexOf('.env=')
      if (env >= 0) return argument.slice(0, env + 5) + '<oculto>'
      return truncate(argument, 70)
    })
    .join(' ')
}

// MARK: Resúmenes cortos para la interfaz

/** Los primeros `limit` caracteres (sin puntos suspensivos). */
export function prefixChars(text: string, limit: number): string {
  const chars = Array.from(text)
  return chars.length > limit ? chars.slice(0, limit).join('') : text
}

export function truncate(text: string, limit: number): string {
  const chars = Array.from(text)
  return chars.length > limit ? chars.slice(0, limit).join('') + '…' : text
}

/** Primeros `limit` caracteres de los argumentos (JSON compacto). */
export function summarizeArguments(value: unknown, limit = 80): string {
  const text = value === null || value === undefined ? '' : compactJSON(value)
  return truncate(text === '{}' ? '' : text, limit)
}

/** Primeras líneas del resultado de una herramienta, en una sola línea. */
export function summarizeResult(text: string, limit = 160): string {
  const collapsed = text.split(/\r\n|[\n\r\u2028\u2029\u0085\u000B\u000C]/).filter((l) => l.length > 0).slice(0, 3).join(' ⏎ ')
  return truncate(collapsed.trim(), limit)
}

/** Quita `mcp__servidor__` del nombre de una herramienta MCP (Claude Code). `servers` son los nombres ya normalizados. */
export function stripMCPPrefix(name: string, servers: string[]): string {
  if (!name.startsWith('mcp__')) return name
  for (const server of [...servers].sort((a, b) => b.length - a.length)) {
    const prefix = `mcp__${server}__`
    if (name.startsWith(prefix)) return name.slice(prefix.length)
  }
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  return sep >= 0 ? rest.slice(sep + 2) : name
}
