// Proveedor de la API de Anthropic (`POST {base}/v1/messages`, con clave). Port de AnthropicProvider.swift:
//  - cabeceras `x-api-key` y `anthropic-version: 2023-06-01`; sistema aparte; `max_tokens` obligatorio (8192 si no hay otro);
//  - streaming SSE (texto, razonamiento, herramientas fragmentadas, uso con caché y fin);
//  - caché de prompts con `cache_control: ephemeral` (prefijo estable, contexto compartido y, en los bucles, el final);
//  - el razonamiento firmado se reenvía intacto durante el bucle de herramientas (ThinkingVault); si la API lo rechaza, sin él;
//  - `reasoningEffort` → `output_config.effort` y, donde se admite, `thinking: {type: adaptive, display: summarized}`.
import type { JSONObject, JSONValue } from '@shared/ai/json'
import type { ChatEvent, ChatRequest, ChatResponse } from '@shared/ai/types'
import { msg } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { log } from '../../log'
import { AIError, classificationText } from '../errors'
import { at, bool, obj, str, tryParseJSON } from '../core/json'
import { anthropicMessagesURL, anthropicModelsURL, hostOf } from '../http/endpoints'
import { LocalFlags, sanitizedExtraHeaders } from '../http/localFlags'
import { ParameterRejected, withRetry } from '../http/options'
import { effortRejected, wholeSeconds, type ErrorContext } from '../http/providerErrors'
import { modelIDs, requestData, sortedUnique } from '../http/requester'
import type { ChatModel, CompleteOptions, ModelCapabilities } from '../model'
import type { ProviderConfig } from './config'
import { modelOrDefault, reasoningEffortFor } from './config'
import { describePing, modelsEmpty, modelsNotJSON, modelsNotListable, PING_PROMPT, pingNoModelError } from './common'
import { baseHeaders, capabilitiesFor, completeFromStream, mergeHeaders, resolveDeps, streamingAttempt, USER_AGENT, withDeadline, type ProviderDeps, type ResolvedDeps } from './base'
import { missingKeyError, resolveKey } from './keys'
import { FixupMemory } from './memory'
import { ANTHROPIC_MEMORABLE, anthropicBody, applyAnthropicFixup, checksReplayPrefix, preapplyAnthropicFixups } from './anthropicRequest'
import { AnthropicStreamDecoder } from './anthropicDecoder'

export const ANTHROPIC_VERSION = '2023-06-01'

const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)))

export class AnthropicModel implements ChatModel {
  readonly config: ProviderConfig
  private readonly deps: ResolvedDeps

  constructor(config: ProviderConfig, deps: ProviderDeps = {}) {
    this.config = config
    this.deps = resolveDeps(deps)
  }

  get providerId(): string {
    return this.config.id
  }
  get providerName(): string {
    return this.config.label
  }
  get kind() {
    return this.config.kind
  }
  get model(): string {
    return this.config.model
  }
  get capabilities(): ModelCapabilities {
    return capabilitiesFor(this.config)
  }

  /** El bucle recortó el historial: en los modelos que comprueban el prefijo, el razonamiento de esos pasos ya no vale. */
  historyWasEdited(toolUseIDs: string[], model: string): void {
    const m = model || this.config.model
    if (!checksReplayPrefix(m)) return
    this.deps.vault.purge(toolUseIDs)
  }

  complete(request: ChatRequest, options: CompleteOptions = {}): Promise<ChatResponse> {
    return completeFromStream((r, emit, signal) => this.stream(r, emit, signal), request, options)
  }

  async stream(request: ChatRequest, emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const { config } = this
    const { http, vault, fixups } = this.deps
    const apiKey = resolveKey(config, this.deps.secrets)
    if (!apiKey) throw missingKeyError(config)
    const model = modelOrDefault(request.model, config)
    const context: ErrorContext = { provider: config.label, model, host: hostOf(config.baseURL), secrets: [apiKey] }
    const url = anthropicMessagesURL(config.baseURL)
    const streaming = config.supportsStreaming
    const flags = new LocalFlags(config.extraHeaders)
    const idleSec = streaming ? flags.number('x-aula-idle-timeout') ?? http.idleTimeoutSec : 0
    const extra = sanitizedExtraHeaders(config.extraHeaders)
    const p = config.label
    const timeoutSec = request.timeoutSec ?? 300
    const toolUseIDs = request.messages.flatMap((m) => (m.toolCalls ?? []).map((c) => c.id))
    const headers = (): Headers => {
      const h = baseHeaders(streaming, {})
      h.set('x-api-key', apiKey)
      h.set('anthropic-version', ANTHROPIC_VERSION)
      return mergeHeaders(h, extra)
    }
    const deadlineError = () => new AIError('timeout', tr(`${p} no terminó de responder en ${wholeSeconds(timeoutSec)} s. Prueba con una petición más corta.`,
      `${p} didn’t finish responding in ${wholeSeconds(timeoutSec)} s. Try a shorter request.`))
    const idleError = () => new AIError('timeout', tr(`${p} no envió ningún dato durante ${wholeSeconds(idleSec)} s, así que se canceló la petición. Inténtalo de nuevo.`,
      `${p} didn’t send any data for ${wholeSeconds(idleSec)} s, so the request was canceled. Try again.`))

    await withDeadline(timeoutSec, deadlineError, signal, async (exec) => {
      let replay = true
      let applied = new Set<string>()
      // lo que este servidor y modelo ya rechazaron antes (y el muestreo en los modelos que nunca lo admiten): fuera desde el principio
      const memoKey = FixupMemory.key(config.baseURL, model)
      const selectedEffort = request.reasoningEffort === undefined && reasoningEffortFor(config, model) !== undefined
      const learned = fixups.tags(memoKey)
      if (selectedEffort) learned.delete('output_config')
      let body: JSONObject = preapplyAnthropicFixups(anthropicBody(config, request, { stream: streaming, replayThinking: replay, vault }), model, learned, applied)
      for (;;) {
        try {
          await withRetry(http, p, () => streamingAttempt({
            url, headers: headers(), body, http, idleSec, idleError, context, signal: exec, emit,
            decoder: new AnthropicStreamDecoder(context, vault)
          }), exec)
          return
        } catch (err) {
          if (!(err instanceof ParameterRejected)) throw err
          const before = body
          const effortSent = str(obj(before.output_config)?.effort)
          const text = classificationText(err.error)
          const r = applyAnthropicFixup(text, body, applied)
          if (r.action === 'none') {
            if (selectedEffort && effortSent && text.toLowerCase().includes('effort')) throw effortRejected(err.error, p, model, effortSent)
            throw err.error
          }
          if (r.action === 'changedBody') {
            body = r.body
            if (selectedEffort && effortSent && obj(body.output_config)?.effort === undefined) throw effortRejected(err.error, p, model, effortSent)
            fixups.learn(memoKey, intersect(applied, ANTHROPIC_MEMORABLE))
            log.info(`${p}: parámetro no admitido, se reintenta sin él (${[...applied].sort().join(', ')})`)
            continue
          }
          // stripThinking
          if (!replay) throw err.error
          replay = false
          vault.purge(toolUseIDs) // esas firmas ya no valen: que no se reenvíen en pasos siguientes
          const reapplied = new Set(applied)
          body = preapplyAnthropicFixups(anthropicBody(config, request, { stream: streaming, replayThinking: false, vault }), model, intersect(applied, ANTHROPIC_MEMORABLE), reapplied)
          applied = reapplied
          log.info(`${p}: la API rechazó el razonamiento previo; se reintenta sin reenviarlo`)
        }
      }
    })
  }
}

/** Las páginas de `GET {base}/v1/models` tal cual (con paginación), para leer nombres, contexto y capacidades. */
export async function anthropicModelsJSON(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal): Promise<JSONValue[]> {
  const d = resolveDeps(deps)
  const apiKey = resolveKey(config, d.secrets)
  if (!apiKey) throw missingKeyError(config)
  const context: ErrorContext = { provider: config.label, model: config.model, host: hostOf(config.baseURL), secrets: [apiKey] }
  const pages: JSONValue[] = []
  let after: string | undefined
  for (let i = 0; i < 20; i++) {
    const url = anthropicModelsURL(config.baseURL, 1000, after)
    const h = new Headers({ 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, Accept: 'application/json', 'User-Agent': USER_AGENT })
    mergeHeaders(h, sanitizedExtraHeaders(config.extraHeaders))
    let body: Uint8Array
    try {
      body = (await requestData(url, { method: 'GET', headers: h }, d.http, context, 45, signal)).body
    } catch (err) {
      if (err instanceof AIError && err.status === 404) throw modelsNotListable(config)
      throw err
    }
    const json = tryParseJSON(new TextDecoder().decode(body))
    if (json === undefined) throw modelsNotJSON(config)
    pages.push(json)
    const last = str(at(json, 'last_id'))
    if (bool(at(json, 'has_more')) === true && last && last !== after) after = last
    else break
  }
  return pages
}

export async function anthropicListModels(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal): Promise<string[]> {
  const pages = await anthropicModelsJSON(config, deps, signal)
  const ids = sortedUnique(pages.flatMap(modelIDs))
  if (!ids.length) throw modelsEmpty(config)
  return ids
}

export async function anthropicPing(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal): Promise<string> {
  if (!config.model) throw pingNoModelError(config)
  const model = new AnthropicModel(config, deps)
  const response = await model.complete({ model: config.model, messages: [msg.user(PING_PROMPT)], maxTokens: 2048, timeoutSec: 60 }, { signal })
  return describePing(response)
}
