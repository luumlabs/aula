// Lo que la interfaz pide de los agentes CLI y los modelos locales (lo usa src/main/electron/handlers/agents.ts; aquí no se
// importa Electron para poder probarlo): detección de todo lo que ya hay en el ordenador y «Conectar con ChatGPT».
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CLI_AGENT_KINDS, type AgentsDetection, type CodexLoginEvent, type CodexLoginResult } from '@shared/agents'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { log } from '../log'
import type { LocalAIService } from '../local-ai/service'
import { findInstalledLocalApps } from '../local-ai/servers'
import { codexIsLoggedIn, codexLogin, codexLogout } from './codex-account'
import { ManagedCodex } from './codex-installer'
import { AgentError, CancelledError } from './errors'
import { addToolDirectory, findExecutable, prepareLocator } from './locator'
import { probeCLI } from './probe'

export interface AgentsServiceOptions {
  local: LocalAIService
  codex: ManagedCodex
  /** Cuánto vale una detección (ms). */
  cacheMs?: number
}

export class AgentsService {
  readonly local: LocalAIService
  readonly codex: ManagedCodex
  private readonly cacheMs: number
  private cached?: { at: number; value: AgentsDetection }
  private pending?: Promise<AgentsDetection>
  private login?: AbortController

  constructor(options: AgentsServiceOptions) {
    this.local = options.local
    this.codex = options.codex
    this.cacheMs = options.cacheMs ?? 30_000
    // el Codex que instaló Aula se encuentra aunque no esté en el PATH
    addToolDirectory(this.codex.installFolder)
  }

  /** CLIs instaladas y con sesión, Ollama/LM Studio en marcha, ficha del ordenador y modelo local recomendado. */
  detect(refresh = false): Promise<AgentsDetection> {
    if (!refresh && this.cached && Date.now() - this.cached.at < this.cacheMs) return Promise.resolve(this.cached.value)
    if (this.pending) return this.pending
    const run = this.detectNow()
      .then((value) => {
        this.cached = { at: Date.now(), value }
        return value
      })
      .finally(() => {
        this.pending = undefined
      })
    this.pending = run
    return run
  }

  invalidate(): void {
    this.cached = undefined
  }

  private async detectNow(): Promise<AgentsDetection> {
    await prepareLocator()
    const [clis, servers, hardware, recommendedModel, codexManagedLoggedIn] = await Promise.all([
      Promise.all(CLI_AGENT_KINDS.map((kind) => probeCLI(kind))),
      this.local.detectServers(),
      this.local.hardware(),
      this.local.recommended().catch((err) => {
        log.warn('[agents] no pude elegir un modelo local', err)
        return undefined
      }),
      this.managedLoggedIn()
    ])
    return {
      clis,
      servers,
      installedApps: findInstalledLocalApps(),
      hardware,
      ...(recommendedModel ? { recommendedModel } : {}),
      engine: this.local.engineStatus(),
      codexManagedLoggedIn
    }
  }

  /** ¿La sesión de ChatGPT propia de Aula está iniciada? */
  private async managedLoggedIn(): Promise<boolean> {
    const home = this.codex.sessionFolder
    if (!existsSync(join(home, 'auth.json'))) return false
    const exe = this.codex.binary ?? findExecutable('codex')
    if (!exe) return false
    return (await codexIsLoggedIn(exe, home)) === true
  }

  // MARK: Conectar con ChatGPT

  /**
   * «Conectar con ChatGPT»: (1) si este ordenador ya tiene Codex con la sesión iniciada (`~/.codex`), se usa tal cual; (2) si no,
   * Aula descarga el binario OFICIAL fijado a su carpeta y (3) lanza su inicio de sesión oficial (`codex login`, que abre la página
   * de ChatGPT en el navegador) con la carpeta de sesión propia de Aula. Nunca se toca `~/.codex`.
   */
  async connectChatGPT(options: { deviceAuth?: boolean; onEvent?: (e: CodexLoginEvent) => void } = {}): Promise<CodexLoginResult> {
    this.login?.abort()
    const controller = new AbortController()
    this.login = controller
    const signal = controller.signal
    try {
      await prepareLocator()
      const system = findExecutable('codex')
      if (system && !this.codex.isManaged(system) && (await codexIsLoggedIn(system, undefined)) === true) {
        return { connected: true, executable: system, managedHome: false }
      }
      let exe: string
      try {
        exe = await this.codex.install((p) => options.onEvent?.({ type: 'downloading', bytesDone: p.bytesDone, bytesTotal: p.bytesTotal }), signal)
      } catch (err) {
        if (signal.aborted) throw new CancelledError()
        // sin binario oficial para este sistema: el Codex del usuario, con la carpeta de sesión de Aula
        if (!system || this.codex.isManaged(system)) throw err
        log.warn('[agents] no pude instalar Codex; uso el del sistema', err)
        exe = system
      }
      const home = this.codex.sessionFolder
      if ((await codexIsLoggedIn(exe, home)) !== true) {
        // `codex login` abre el navegador por su cuenta; la dirección va en el evento por si no se abrió
        for await (const event of codexLogin(exe, { home, deviceAuth: options.deviceAuth, signal })) options.onEvent?.(event)
        if (signal.aborted) throw new CancelledError()
      }
      this.invalidate()
      return { connected: true, executable: exe, managedHome: true }
    } finally {
      if (this.login === controller) this.login = undefined
    }
  }

  cancelChatGPTLogin(): void {
    this.login?.abort()
  }

  /** Cierra solo la sesión de ChatGPT propia de Aula. */
  async logoutChatGPT(): Promise<void> {
    const exe = this.codex.binary ?? findExecutable('codex')
    if (!exe) throw new AgentError('notInstalled', tr('Codex no está instalado.', 'Codex isn’t installed.'))
    if (!existsSync(this.codex.sessionFolder)) return
    try {
      await codexLogout(exe, this.codex.sessionFolder)
    } finally {
      this.invalidate()
    }
  }
}

/** Valida `{ modelId }` de la interfaz. */
export function modelIdArg(args: unknown): string {
  const id = typeof args === 'object' && args !== null ? (args as { modelId?: unknown }).modelId : undefined
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:/-]{1,200}$/.test(id)) throw new AulaError('invalid_args', tr('Modelo no válido', 'Invalid model'))
  return id
}
