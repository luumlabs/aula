// El bucle de agente para modelos de API: «el modelo pide herramientas → se ejecutan → se le devuelven los resultados» hasta que
// responde sin pedir más (port de ToolLoopRunner.swift).
//  - Herramientas nativas en paralelo (4 a la vez) con los resultados en orden; un fallo de herramienta no aborta: el modelo recibe
//    «Error: …» y se corrige.
//  - Termina sin llamadas («stop»), al llegar a `maxSteps` («max_steps», tras pedir un resumen sin herramientas), por tiempo
//    («timeout») o por cancelación («cancelled»): esos finales NO son errores y el resultado lo dice en `stopReason`.
//  - Contexto: estima tokens (≈ caracteres/3,5) y por encima del 75 % de la ventana recorta resultados antiguos, argumentos largos
//    y, si hace falta, pasos enteros; ante «context length exceeded» recorta más y reintenta una vez.
//  - Si el proveedor rechaza `tools` (o el modelo no las admite) pasa al modo de texto (TextToolProtocol).
//  - Tras un 429 espera `retryAfter` (máx. 60 s) y reintenta el paso hasta 3 veces, avisando.
//  - Una llamada cortada por el límite de longitud no se ejecuta: se pide al modelo que la reenvíe en partes.
//  - `usage` lleva siempre el ACUMULADO: tras cada llamada al modelo (si cambió), antes de un error y antes de `finished`.
import type { JSONObject } from '@shared/ai/json'
import type { AgentEvent, AgentResult, ChatMessage, ChatRequest, FinishReason, ImagePart, ToolCall, ToolSpec, Usage } from '@shared/ai/types'
import { addUsage, emptyUsage, fingerprint, messageImages, messageText, msg, sameUsage, usageTotal } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { AIError, isCancellation, isContextLengthError, looksLikeToolRejection } from '../errors'
import { canonicalJSON } from '../core/json'
import { abortableSleep, type SleepFn } from '../http/options'
import { waitText, wholeSeconds } from '../http/providerErrors'
import type { AgentTool, ChatModel } from '../model'
import { droppedNote, estimateMessage, estimateMessages, estimateTools, fitTurns, reportChanged, reportSummary, turnMessages, type ResultItem, type Turn } from './contextManager'
import { parseTextTools, textToolInstructions, TextToolStreamFilter } from './textToolProtocol'
import { ToolExecutor } from './toolExecutor'

export interface ToolLoopOptions {
  model: ChatModel
  system?: string
  /** Conversación previa (o el mensaje del usuario). Va detrás del sistema y no se recorta. */
  messages?: ChatMessage[]
  /** Atajo: un mensaje del usuario al final (con `sharedContext` delante y `images`). */
  prompt?: string
  /** Contexto que comparten muchas tareas (p. ej. el del curso): va delante de `prompt`, en su propio fragmento (caché). */
  sharedContext?: string
  images?: ImagePart[]
  tools?: AgentTool[]
  /** Cancela la tarea (y las herramientas en curso). El resultado llega con `stopReason: 'cancelled'`. */
  signal?: AbortSignal
  onEvent?: (e: AgentEvent) => void
  /** Pasos máximos (por defecto 40). */
  maxSteps?: number
  /** Tiempo máximo de la tarea en segundos (por defecto 1800; 0 = sin límite). */
  timeoutSec?: number
  temperature?: number
  maxOutputTokens?: number
  /** Nivel de razonamiento de cada llamada (sin valor = la elección guardada del proveedor). */
  reasoningEffort?: string
  /** Solo agentes CLI: ¿pueden usar su web propia? Por defecto no (A2-P1-2; la web va por las herramientas de Aula). */
  allowWeb?: boolean
  extraBody?: JSONObject
  /** Clave de caché de prompts (por defecto, la huella del modelo, el sistema y las herramientas). */
  cacheKey?: string
  /** Herramientas a la vez (4). */
  maxParallelTools?: number
  /** Esperas y reintentos de un paso tras un 429 (3). */
  maxRateLimitRetries?: number
  /** Un resultado de herramienta más largo se recorta (100 000 caracteres). */
  maxToolResultChars?: number
  /** Fracción de la ventana a partir de la cual se recorta el historial (0,75). */
  contextThreshold?: number
  /** Pausa cancelable para las esperas por límite de uso (las pruebas la sustituyen). */
  sleep?: SleepFn
}

export function textModeNotice(): string {
  return tr('Este modelo no admite herramientas nativas; uso el modo de texto', "This model doesn't support native tools; I'm using text mode")
}

/** `aula-<huella>` del modelo, el sistema y las herramientas: lo que forma el prefijo estable. */
export function toolLoopCacheKey(model: string, system: string, tools: ToolSpec[]): string {
  return 'aula-' + fingerprint([model, system, ...tools.flatMap((t) => [t.name, t.description, canonicalJSON(t.inputSchema)])])
}

/** `sharedContext` con su separador final (una línea en blanco). */
export function sharedContextBlock(shared: string | undefined, prompt: string | undefined): string {
  const s = shared ?? ''
  if (!s || !prompt) return s
  if (s.endsWith('\n\n')) return s
  return s + (s.endsWith('\n') ? '\n' : '\n\n')
}

const TIMEOUT = Symbol('timeout')

interface ModelTurn {
  raw: string
  visibleText: string
  reasoning: string
  calls: ToolCall[]
  problems: string[]
  finish: FinishReason
  usage: Usage
}

class StopLoop extends Error {}

export async function runToolLoop(opts: ToolLoopOptions): Promise<AgentResult> {
  const { model } = opts
  if (model.runAgent) return runDelegated(opts)
  const closed = { value: false }
  const emit = (e: AgentEvent) => {
    if (closed.value) return
    try {
      opts.onEvent?.(e)
    } catch {
      /* un oyente que falla no rompe el bucle */
    }
  }
  const caps = model.capabilities
  const modelName = model.model
  emit({ type: 'started', provider: model.providerName, model: modelName })

  // cancelación de quien llama + tiempo máximo de la tarea
  const loop = new AbortController()
  const onParentAbort = () => loop.abort(opts.signal?.reason)
  if (opts.signal?.aborted) loop.abort(opts.signal.reason)
  else opts.signal?.addEventListener('abort', onParentAbort, { once: true })
  const timeoutSec = opts.timeoutSec ?? 1800
  const started = Date.now()
  const deadline = timeoutSec > 0 && Number.isFinite(timeoutSec) ? started + timeoutSec * 1000 : undefined
  let timedOut = false
  const timer = deadline !== undefined ? setTimeout(() => {
    timedOut = true
    loop.abort(TIMEOUT)
  }, Math.min(timeoutSec, 86_400 * 30) * 1000) : undefined
  const sleep = opts.sleep ?? abortableSleep

  const toolMap = new Map<string, AgentTool>()
  const specs: ToolSpec[] = []
  for (const t of opts.tools ?? []) {
    if (toolMap.has(t.name)) continue
    toolMap.set(t.name, t)
    specs.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
  }
  const state = {
    textMode: specs.length > 0 && !caps.tools,
    turns: [] as Turn[],
    droppedTotal: 0,
    steps: 0,
    aggressiveNext: false,
    usage: emptyUsage(),
    lastText: '',
    nudged: false,
    pendingTail: [] as ChatMessage[],
    reported: undefined as Usage | undefined
  }
  if (state.textMode) emit({ type: 'notice', text: textModeNotice() })
  const reportUsage = () => {
    if (state.reported && sameUsage(state.reported, state.usage)) return
    state.reported = { ...state.usage }
    emit({ type: 'usage', usage: state.usage })
  }

  let images = opts.images ?? []
  if (images.length && !caps.vision) {
    emit({ type: 'notice', text: tr(`Este modelo no admite imágenes; se omiten las ${images.length} imagen(es) adjunta(s).`,
      `This model doesn't support images; the ${images.length} attached image(s) are left out.`) })
    images = []
  }
  const executor = new ToolExecutor(toolMap, { maxParallel: opts.maxParallelTools ?? 4, maxResultCharacters: opts.maxToolResultChars ?? 100_000, supportsVision: caps.vision })
  const maxSteps = Math.max(1, opts.maxSteps ?? 40)
  let stopReason = 'stop'

  const checkCancelled = () => {
    if (deadline !== undefined && Date.now() >= deadline) {
      timedOut = true
      loop.abort(TIMEOUT)
    }
    if (loop.signal.aborted) throw new StopLoop()
  }

  // MARK: petición

  const buildRequest = (allowTools: boolean, tail: ChatMessage[]): ChatRequest => {
    const useNativeTools = allowTools && !state.textMode && specs.length > 0
    const withTextProtocol = state.textMode && specs.length > 0
    let systemText = opts.system ?? ''
    if (withTextProtocol) systemText += (systemText ? '\n\n' : '') + textToolInstructions(specs)
    const head: ChatMessage[] = []
    if (systemText) head.push(msg.system(systemText))
    head.push(...(opts.messages ?? []))
    // el contexto compartido va delante y en su propio fragmento: los proveedores con marcadores lo cachean aparte
    const prompt = opts.prompt
    const shared = sharedContextBlock(opts.sharedContext, prompt)
    const sharedPart = !!shared && !!prompt
    if (prompt !== undefined) {
      if (sharedPart) head.push({ role: 'user', content: [{ type: 'text', text: shared }, { type: 'text', text: prompt }, ...images.map((image) => ({ type: 'image' as const, image }))] })
      else head.push(msg.user(shared + prompt, images))
    }
    // recorte de contexto
    const window = caps.contextWindow || 100_000
    const budget = Math.max(1, Math.floor(window * (opts.contextThreshold ?? 0.75)))
    const notePart = state.droppedTotal > 0 ? estimateMessage(droppedNote(state.droppedTotal)) : 0
    const fixed = estimateMessages(head) + estimateMessages(tail) + notePart + (useNativeTools ? estimateTools(specs) : 0)
    const report = fitTurns(state.turns, fixed, budget, state.textMode, state.aggressiveNext)
    state.aggressiveNext = false
    state.droppedTotal += report.droppedTurns
    if (reportChanged(report)) {
      emit({ type: 'notice', text: reportSummary(report) })
      // el historial ya no es el que se envió: el razonamiento firmado de esos pasos deja de valer en algunos modelos
      model.historyWasEdited?.(state.turns.flatMap((t) => t.calls.map((c) => c.id)), modelName)
    }
    const messages = [...head]
    if (state.droppedTotal > 0) messages.push(droppedNote(state.droppedTotal))
    for (const t of state.turns) messages.push(...turnMessages(t, state.textMode))
    messages.push(...tail)
    const remaining = deadline !== undefined ? Math.max(5, (deadline - Date.now()) / 1000) : 900
    // caché: con herramientas habrá otro paso que repite esta petición y añade al final → se cachea hasta el final
    const tools = useNativeTools ? specs : []
    return {
      model: modelName,
      messages,
      tools,
      toolChoice: useNativeTools ? 'auto' : 'none',
      temperature: opts.temperature,
      maxTokens: opts.maxOutputTokens ?? caps.maxOutputTokens,
      reasoningEffort: opts.reasoningEffort,
      timeoutSec: Math.min(remaining, 900),
      extraBody: opts.extraBody,
      cache: {
        key: opts.cacheKey ?? toolLoopCacheKey(modelName, systemText, tools),
        reuseTail: allowTools && (useNativeTools || withTextProtocol),
        sharedFirstUserPart: sharedPart
      }
    }
  }

  // MARK: una llamada al modelo (con esperas por 429, recorte por contexto y paso al modo de texto)

  const callModel = async (allowTools: boolean): Promise<ModelTurn> => {
    let rateLimitRetries = 0
    let contextRetried = false
    const tail = state.pendingTail
    state.pendingTail = []
    for (;;) {
      checkCancelled()
      const request = buildRequest(allowTools, tail)
      const textMode = state.textMode
      const filter = new TextToolStreamFilter()
      let streamedRaw = ''
      let hasOutput = false
      try {
        const res = await model.complete(request, {
          signal: loop.signal,
          onDelta: (e) => {
            if (e.type === 'text') {
              streamedRaw += e.text
              if (e.text) hasOutput = true
              if (textMode) {
                const visible = filter.push(e.text)
                if (visible) emit({ type: 'text', text: visible })
              } else if (e.text) emit({ type: 'text', text: e.text })
            } else if (e.type === 'reasoning') {
              if (e.text) {
                hasOutput = true
                emit({ type: 'reasoning', text: e.text })
              }
            } else if (e.type === 'tool_call') hasOutput = true
          }
        })
        if (loop.signal.aborted) throw new StopLoop()
        const raw = messageText(res.message)
        // un modelo que no emite fragmentos: se enseña todo al final
        if (!streamedRaw && raw) {
          if (textMode) {
            const visible = filter.push(raw)
            if (visible) emit({ type: 'text', text: visible })
          } else emit({ type: 'text', text: raw })
        }
        if (!hasOutput && res.message.reasoning) emit({ type: 'reasoning', text: res.message.reasoning })
        let visibleText = raw
        let calls: ToolCall[] = res.message.toolCalls ?? []
        let problems: string[] = []
        if (textMode) {
          const tailText = filter.finish()
          if (tailText) emit({ type: 'text', text: tailText })
          const parsed = parseTextTools(raw)
          visibleText = parsed.visibleText
          calls = parsed.calls
          problems = parsed.problems
        }
        let finish: FinishReason = res.finish
        if (calls.length && finish === 'stop') finish = 'toolCalls'
        return { raw, visibleText, reasoning: res.message.reasoning ?? '', calls, problems, finish, usage: res.usage }
      } catch (err) {
        if (err instanceof StopLoop || loop.signal.aborted) throw new StopLoop()
        if (!(err instanceof AIError)) throw err
        if (err.kind === 'cancelled') throw err
        if (hasOutput) throw err // ya se mostró contenido: no se puede repetir sin duplicarlo
        if (err.kind === 'rateLimited' && rateLimitRetries < (opts.maxRateLimitRetries ?? 3)) {
          rateLimitRetries++
          const wait = Math.min(err.retryAfter ?? 5 * rateLimitRetries * rateLimitRetries, 60)
          const max = opts.maxRateLimitRetries ?? 3
          emit({ type: 'notice', text: tr(`Límite de uso de ${model.providerName}: espero ${waitText(wait)} y reintento (${rateLimitRetries}/${max}).`,
            `Rate limit for ${model.providerName}: waiting ${waitText(wait)} and retrying (${rateLimitRetries}/${max}).`) })
          try {
            await sleep(wait, loop.signal)
          } catch (e) {
            if (loop.signal.aborted) throw new StopLoop()
            throw e
          }
          continue
        }
        if (isContextLengthError(err) && !contextRetried) {
          contextRetried = true
          state.aggressiveNext = true
          emit({ type: 'notice', text: tr(`${model.providerName} dice que el contexto no cabe; recorto más el historial y reintento.`,
            `${model.providerName} says the context doesn't fit; I'll trim the history further and retry.`) })
          continue
        }
        // también en el resumen final: algunos servicios rechazan un historial con mensajes `tool` si no se declaran herramientas
        if (!state.textMode && specs.length && looksLikeToolRejection(err)) {
          state.textMode = true
          emit({ type: 'notice', text: textModeNotice() })
          continue
        }
        throw err
      }
    }
  }

  try {
    try {
      for (;;) {
        checkCancelled()
        if (state.steps >= maxSteps) {
          stopReason = 'max_steps'
          break
        }
        state.steps++
        const turn = await callModel(true)
        state.usage = addUsage(state.usage, turn.usage)
        reportUsage()
        if (turn.visibleText) state.lastText = turn.visibleText

        // una negativa del filtro del proveedor puede cortar una llamada a medias: las llamadas de ese turno no se ejecutan
        if (turn.finish === 'contentFilter') {
          stopReason = 'content_filter'
          emit({ type: 'notice', text: tr('El proveedor bloqueó la respuesta con su filtro de contenido.', 'The provider blocked the response with its content filter.') })
          break
        }
        if (!turn.calls.length && !turn.problems.length) {
          // sin llamadas: o es la respuesta final o el modelo se quedó callado
          if (!turn.visibleText && turn.finish !== 'length' && state.steps > 1 && !state.nudged) {
            state.nudged = true
            state.pendingTail = [msg.user('Continúa: si ya terminaste, resume el resultado final; si no, sigue con el siguiente paso.')]
            continue
          }
          if (turn.finish === 'length') {
            stopReason = 'length'
            emit({ type: 'notice', text: tr('La respuesta se cortó por el límite de longitud del modelo.', "The answer was cut off by the model's length limit.") })
          }
          break
        }
        let truncated: number | undefined
        if (turn.finish === 'length' && turn.calls.length) {
          truncated = turn.calls.length - 1
          emit({ type: 'notice', text: tr('La última llamada a herramienta quedó cortada por el límite de longitud; se le pide al modelo que la reenvíe en partes más pequeñas.',
            'The last tool call was cut off by the length limit; the model is asked to resend it in smaller parts.') })
        }
        // nombres canónicos en el historial
        const calls = turn.calls.map((c) => {
          const t = executor.resolve(c.name)
          return t ? { ...c, name: t.name } : c
        })
        const items: ResultItem[] = await executor.run(calls, loop.signal, emit, truncated)
        turn.problems.forEach((p, k) => items.push({ callID: `problema_${k + 1}`, name: 'tool', text: `Error: ${p}`, images: [], ok: false }))
        state.turns.push({ text: turn.visibleText, rawText: state.textMode ? turn.raw : undefined, reasoning: turn.reasoning || undefined, calls, items })
      }
      if (stopReason === 'max_steps') {
        emit({ type: 'notice', text: tr(`Se alcanzó el límite de ${maxSteps} pasos; pido un resumen final.`, `Reached the limit of ${maxSteps} steps; asking for a final summary.`) })
        state.pendingTail = [msg.user('Has llegado al límite de pasos permitido. No uses más herramientas ni bloques de herramienta: escribe ahora un resumen breve de lo que hiciste, de lo que quedó pendiente y del resultado final.')]
        const summary = await callModel(false)
        state.usage = addUsage(state.usage, summary.usage)
        reportUsage()
        if (summary.visibleText) state.lastText = summary.visibleText
      }
    } catch (err) {
      if (err instanceof StopLoop || loop.signal.aborted || isCancellation(err)) {
        stopReason = timedOut ? 'timeout' : 'cancelled'
      } else {
        // el agente falla: lo gastado hasta ahora se informa antes del error
        if (usageTotal(state.usage) > 0) emit({ type: 'usage', usage: state.usage })
        closed.value = true
        throw err
      }
    }
    if (stopReason === 'timeout') {
      emit({ type: 'notice', text: tr(`Se agotó el tiempo máximo de la tarea (${wholeSeconds(timeoutSec)} s).`, `The task's time limit ran out (${wholeSeconds(timeoutSec)} s).`) })
    }
    if (state.reported === undefined) emit({ type: 'usage', usage: state.usage })
    else reportUsage()
    const result: AgentResult = { text: state.lastText, steps: state.steps, usage: state.usage, stopReason }
    emit({ type: 'finished', result })
    closed.value = true
    return result
  } finally {
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onParentAbort)
    if (!loop.signal.aborted) loop.abort(new StopLoop()) // las herramientas que sigan en marcha ven que se acabó
  }
}

/** Agentes con bucle propio (CLIs): se les pasa la tarea entera. */
async function runDelegated(opts: ToolLoopOptions): Promise<AgentResult> {
  const messages = [...(opts.messages ?? [])]
  let prompt = opts.prompt
  if (prompt === undefined) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    prompt = lastUser ? messageText(lastUser) : ''
  }
  const images = opts.images ?? (messages.length ? messageImages(messages[messages.length - 1]) : [])
  return opts.model.runAgent!({
    system: opts.system ?? '',
    messages,
    prompt,
    sharedContext: opts.sharedContext,
    images,
    tools: opts.tools ?? [],
    maxSteps: Math.max(1, opts.maxSteps ?? 40),
    timeoutSec: opts.timeoutSec ?? 1800,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    reasoningEffort: opts.reasoningEffort,
    allowWeb: opts.allowWeb === true
  }, { signal: opts.signal, onEvent: opts.onEvent })
}
