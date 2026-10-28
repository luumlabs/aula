// Proveedor para cualquier servicio con API compatible con OpenAI (port de OpenAICompatibleProvider.swift): OpenAI (por la
// Responses API), DeepSeek, MiMo, OpenRouter, OpenCode Zen, Groq, Gemini, Mistral, Ollama, LM Studio, vLLM…
//  - Streaming SSE (o una petición normal con `supportsStreaming: false`), razonamiento, herramientas fragmentadas, uso y fin.
//  - Errores claros; hasta 4 reintentos con retroceso SOLO antes del primer byte; cancelación con AbortSignal.
//  - Compatibilidad automática: si el servidor rechaza (400/422) un parámetro opcional, se quita o se renombra y se reintenta
//    (sin contar como reintento de red) y se recuerda para los pasos siguientes.
import type { JSONObject, JSONValue } from '@shared/ai/json'
import type { ChatEvent, ChatRequest, ChatResponse } from '@shared/ai/types'
import { msg } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { log } from '../../log'
import { AIError, classificationText } from '../errors'
import { obj, str, tryParseJSON } from '../core/json'
import { hostOf, openAIChatURL, openAIModelsURL, openAIResponsesURL } from '../http/endpoints'
import { sanitizedExtraHeaders } from '../http/localFlags'
import { ParameterRejected, withRetry } from '../http/options'
import { effortRejected, wholeSeconds, withProviderDetail, type ErrorContext } from '../http/providerErrors'
import { likelyChatModels, modelIDs, requestData, sortedUnique } from '../http/requester'
import type { ChatModel, CompleteOptions, ModelCapabilities } from '../model'
import type { ProviderConfig } from './config'
import { modelOrDefault, reasoningEffortFor } from './config'
import { describePing, modelsEmpty, modelsNotJSON, modelsNotListable, PING_PROMPT, pingNoModelError } from './common'
import { baseHeaders, capabilitiesFor, completeFromStream, mergeHeaders, resolveDeps, streamingAttempt, USER_AGENT, withDeadline, type ProviderDeps, type ResolvedDeps } from './base'
import { mimoMismatchHint, resolveKey } from './keys'
import { FixupMemory } from './memory'
import { applyOpenAIFixup, chatBody, detectQuirks, OPENAI_MEMORABLE, preapplyOpenAIFixups, type OpenAIQuirks } from './openaiRequest'
import { OpenAIStreamDecoder } from './openaiDecoder'
import { OpenAIResponsesDecoder, responsesBody } from './openaiResponses'

const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)))

/** `Authorization: Bearer <clave>`, o la cabecera de `x-aula-auth-header` (p. ej. `api-key` en Azure) con la clave sola. */
export function applyKey(h: Headers, key: string, authHeader?: string): void {
  if (authHeader && authHeader.toLowerCase() !== 'authorization') h.set(authHeader, key)
  else h.set('Authorization', `Bearer ${key}`)
}

/** OpenRouter responde 404 «No endpoints found…» cuando ningún proveedor del modelo acepta la petición. */
export function isOpenRouterNoEndpoints(e: AIError, host: string | undefined): boolean {
  if (host !== 'openrouter.ai') return false
  const t = classificationText(e).toLowerCase()
  return t.includes('no endpoints') || t.includes('no allowed providers')
}

function openRouterNoEndpoints(original: AIError, p: string, model: string): AIError {
  const base = tr(`${p} no tiene ahora ningún proveedor que sirva «${model}» con esta petición (404). Suele pasar con modelos que ofrece un solo proveedor: prueba con otro modelo o con el razonamiento en «Automático».`,
    `${p} doesn't have a provider that currently serves “${model}” with this request (404). This usually happens with models offered by a single provider: try another model or set reasoning to “Automatic”.`)
  const detail = original.providerMessage ?? ''
  return new AIError('http', detail ? withProviderDetail(base, detail) : base, { status: 404, providerMessage: original.providerMessage })
}

export class OpenAICompatibleModel implements ChatModel {
  readonly config: ProviderConfig
  private readonly deps: ResolvedDeps
  private readonly quirks: OpenAIQuirks

  constructor(config: ProviderConfig, deps: ProviderDeps = {}) {
    this.config = config
    this.deps = resolveDeps(deps)
    this.quirks = detectQuirks(config)
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

  complete(request: ChatRequest, options: CompleteOptions = {}): Promise<ChatResponse> {
    return completeFromStream((r, emit, signal) => this.stream(r, emit, signal), request, options)
  }

  /** Envía la petición y entrega los eventos a medida que llegan. */
  async stream(request: ChatRequest, emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const { config, quirks } = this
    const { http, vault, fixups } = this.deps
    const key = resolveKey(config, this.deps.secrets)
    const model = modelOrDefault(request.model, config)
    const host = hostOf(config.baseURL)
    const context: ErrorContext = { provider: config.label, model, host, secrets: key ? [key] : [], unauthorizedHint: mimoMismatchHint(host, key) }
    const responses = quirks.useResponsesAPI
    const url = responses ? openAIResponsesURL(config.baseURL) : openAIChatURL(config.baseURL)
    const streaming = config.supportsStreaming
    const initialBody = responses ? responsesBody(config, request, streaming, true, vault) : chatBody(config, request, streaming, quirks)
    const toolCallIDs = request.messages.flatMap((m) => (m.toolCalls ?? []).map((c) => c.id))
    const idleSec = streaming ? quirks.idleTimeoutSec ?? http.idleTimeoutSec : 0
    const extra = sanitizedExtraHeaders(config.extraHeaders)
    const p = config.label
    const timeoutSec = request.timeoutSec ?? 300
    const headers = (): Headers => {
      const h = baseHeaders(streaming, {})
      if (key) applyKey(h, key, quirks.authHeader)
      return mergeHeaders(h, extra)
    }
    const deadlineError = () => new AIError('timeout', tr(`${p} no terminó de responder en ${wholeSeconds(timeoutSec)} s. Prueba con un modelo más rápido o una petición más corta.`,
      `${p} didn’t finish responding in ${wholeSeconds(timeoutSec)} s. Try a faster model or a shorter request.`))
    const idleError = () => new AIError('timeout', tr(`${p} no envió ningún dato durante ${wholeSeconds(idleSec)} s, así que se canceló la petición. Inténtalo de nuevo o prueba otro modelo.`,
      `${p} didn’t send any data for ${wholeSeconds(idleSec)} s, so the request was canceled. Try again or use another model.`))

    await withDeadline(timeoutSec, deadlineError, signal, async (exec) => {
      let body: JSONObject = initialBody
      let applied = new Set<string>()
      let replay = true
      // lo que este servidor y modelo ya rechazaron antes: aplicado desde la primera petición
      const memoKey = FixupMemory.key(config.baseURL, model)
      const selectedEffort = request.reasoningEffort === undefined && reasoningEffortFor(config, model) !== undefined
      const learned = fixups.tags(memoKey)
      if (selectedEffort) {
        learned.delete('reasoning')
        learned.delete('reasoning_effort')
      }
      body = preapplyOpenAIFixups(body, learned, applied)
      for (;;) {
        try {
          await withRetry(http, p, () => streamingAttempt({
            url, headers: headers(), body, http, idleSec, idleError, context, signal: exec, emit,
            decoder: responses ? new OpenAIResponsesDecoder(context, vault) : new OpenAIStreamDecoder(context)
          }), exec)
          return
        } catch (err) {
          if (err instanceof AIError && err.status === 404 && isOpenRouterNoEndpoints(err, host)) {
            // OpenRouter: ningún proveedor sirve el modelo con esta petición. Si se elegía proveedor (`provider`), una vez sin él
            if (body.provider !== undefined && !applied.has('provider')) {
              body = { ...body }
              delete body.provider
              applied.add('provider')
              log.info(`${p}: OpenRouter no encontró proveedores con esa selección; se reintenta sin \`provider\``)
              continue
            }
            throw openRouterNoEndpoints(err, p, model)
          }
          if (!(err instanceof ParameterRejected)) throw err
          const text = classificationText(err.error).toLowerCase()
          // Responses: el razonamiento cifrado reenviado ya no vale (otra clave u organización): se reintenta sin él
          if (responses && replay && (text.includes('encrypted') || (text.includes('reasoning') && text.includes('item')))) {
            replay = false
            vault.purge(toolCallIDs)
            const reapplied = new Set<string>()
            body = preapplyOpenAIFixups(responsesBody(config, request, streaming, false, vault), intersect(applied, OPENAI_MEMORABLE), reapplied)
            applied = reapplied
            log.info(`${p}: la API rechazó el razonamiento reenviado; se reintenta sin él`)
            continue
          }
          const before = body
          const effortSent = str(before.reasoning_effort) ?? str(obj(before.reasoning)?.effort)
          const fixed = applyOpenAIFixup(classificationText(err.error), body, applied)
          if (!fixed) {
            if (selectedEffort && effortSent && text.includes('reasoning')) throw effortRejected(err.error, p, model, effortSent)
            throw err.error
          }
          body = fixed
          if (selectedEffort && effortSent && ((before.reasoning_effort !== undefined && body.reasoning_effort === undefined) ||
              (obj(before.reasoning)?.effort !== undefined && obj(body.reasoning)?.effort === undefined))) {
            throw effortRejected(err.error, p, model, effortSent)
          }
          fixups.learn(memoKey, intersect(applied, OPENAI_MEMORABLE))
          log.info(`${p}: parámetro no admitido, se reintenta sin él (${[...applied].sort().join(', ')})`)
        }
      }
    })
  }
}

/** La respuesta de `GET {base}/models` tal cual (para leer también nombres, contexto, precios… en los catálogos). */
export async function openAIModelsJSON(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal): Promise<JSONValue> {
  const d = resolveDeps(deps)
  const host = hostOf(config.baseURL)
  let key: string | null
  try {
    key = resolveKey(config, d.secrets)
  } catch (err) {
    // la lista de OpenRouter es pública: sin clave se ve igual (también sus Top 10)
    if (host !== 'openrouter.ai') throw err
    key = null
  }
  const url = openAIModelsURL(config.baseURL)
  const h = new Headers({ Accept: 'application/json', 'User-Agent': USER_AGENT })
  if (key) applyKey(h, key, detectQuirks(config).authHeader)
  mergeHeaders(h, sanitizedExtraHeaders(config.extraHeaders))
  const context: ErrorContext = { provider: config.label, model: config.model, host, secrets: key ? [key] : [], unauthorizedHint: mimoMismatchHint(host, key) }
  let body: Uint8Array
  try {
    body = (await requestData(url, { method: 'GET', headers: h }, d.http, context, 45, signal)).body
  } catch (err) {
    if (err instanceof AIError && err.status === 404) throw modelsNotListable(config)
    throw err
  }
  const json = tryParseJSON(new TextDecoder().decode(body))
  if (json === undefined) throw modelsNotJSON(config)
  return json
}

/** Modelos del servicio (`GET {base}/models`), ordenados, sin repetir y sin los que no son de chat. */
export async function openAIListModels(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal): Promise<string[]> {
  const json = await openAIModelsJSON(config, deps, signal)
  const ids = likelyChatModels(sortedUnique(modelIDs(json)))
  if (!ids.length) throw modelsEmpty(config)
  return ids
}

/** «Probar conexión»: pide «Responde solo: OK» y devuelve la respuesta del modelo. */
export async function openAIPing(config: ProviderConfig, deps: ProviderDeps = {}, signal?: AbortSignal): Promise<string> {
  if (!config.model) throw pingNoModelError(config)
  const model = new OpenAICompatibleModel(config, deps)
  const response = await model.complete({ model: config.model, messages: [msg.user(PING_PROMPT)], timeoutSec: 60 }, { signal })
  return describePing(response)
}
