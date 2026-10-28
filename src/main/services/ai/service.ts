// Lo que la interfaz pide a la capa de IA (lo usa src/main/electron/handlers/ai.ts; aquí no se importa Electron para poder
// probarlo). Las claves nunca salen de aquí: la interfaz recibe `hasKey` y una pista enmascarada.
import { aiKeyRef, type AIProviderConfig, type AIReasoningChoice, type AISettings } from '@shared/settings/ai'
import type { AIChatDone, AIModelChoice, AIProviderView, AIReasoningOption, AIStatus, AITestResult, ModelCatalogView } from '@shared/ai/views'
import type { ChatMessage, ContentPart, Usage } from '@shared/ai/types'
import { emptyUsage, messageText } from '@shared/ai/types'
import { invalidKeyCharactersMessage, validateAPIKey } from '@shared/ai/apiKey'
import { checkCustomBaseURL } from '@shared/ai/customProvider'
import { pick, tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import { reasoningLevelName } from '@shared/ai/reasoning'
import type { RpcErrorInfo } from '@shared/ipc'
import { getSettings, updateSettings } from '../settings'
import { invalidArgs, toErrorInfo } from '../errors'
import { billingFor, costMeter, costsView, withAIUse, isAIUsePurpose, type AIUsePurpose } from '../costs'
import { AIError, isCancellation } from './errors'
import type { ChatModel } from './model'
import { resolveDeps, type ProviderDeps } from './providers/base'
import { describePing, PING_PROMPT } from './providers/common'
import { missingKeyError, unreadableSecretError } from './providers/keys'
import { openAIListModels, openAIPing } from './providers/openai'
import { anthropicListModels, anthropicPing } from './providers/anthropic'
import { baseURLParts } from './http/endpoints'
import { providerCatalog } from './catalog/cache'
import { KNOWN_MODELS } from './catalog/catalogs'
import { presetById } from './presets'
import {
  createModelFor, invalidateAvailability, isKindSupported, isRegisteredKind, listAvailableProviders, modelOverride, noProviderError, pickAutomatic, providerEntry,
  reasoningFor, resolveActiveModel, type ProviderState
} from './registry'

export interface ServiceOptions {
  deps?: ProviderDeps
  /** Volver a comprobar la disponibilidad. */
  refresh?: boolean
}

const aiSettings = (): AISettings => getSettings().ai

// MARK: Estado y lista

function modelShown(s: ProviderState): string {
  if (s.provider.model) {
    if (s.models?.length && !s.models.includes(s.provider.model) && (s.kind === 'ollama' || s.kind === 'lmstudio')) return s.models[0]
    return s.provider.model
  }
  return s.models?.[0] ?? ''
}

export async function aiStatus(opts: ServiceOptions = {}): Promise<AIStatus> {
  const settings = aiSettings()
  const fake = modelOverride()
  if (fake) {
    return { activeProvider: settings.activeProvider, auto: !settings.activeProvider, ready: true,
      resolved: { providerId: fake.providerId, label: fake.providerName, kind: fake.kind, model: fake.model } }
  }
  const states = await listAvailableProviders(settings, { deps: opts.deps, refresh: opts.refresh })
  const chosen = settings.activeProvider
  const target = chosen ? states.find((s) => s.id === chosen) : pickAutomatic(states)
  const status: AIStatus = { activeProvider: chosen, auto: !chosen, resolved: null, ready: false }
  if (!target) {
    const e = chosen
      ? new AIError('other', tr(`El proveedor de IA «${chosen}» no existe. Elige otro en ${settingsPath('ai', 'es')}.`, `The AI provider “${chosen}” doesn’t exist. Choose another one in ${settingsPath('ai', 'en')}.`), { code: 'ai_no_provider' })
      : noProviderError()
    status.problem = { code: e.code, message: e.message }
    return status
  }
  status.resolved = { providerId: target.id, label: target.label, kind: target.kind, model: modelShown(target) }
  status.ready = target.available && target.enabled && target.supported
  if (!status.ready) {
    const code = !target.supported ? 'ai_unsupported' : target.needsKey && !target.hasKey ? 'ai_missing_key' : 'ai_no_provider'
    status.problem = { code, message: target.availability ?? noProviderError().message }
  }
  return status
}

function reasoningOptions(s: ProviderState): AIReasoningOption[] {
  const caps = reasoningFor(s, modelShown(s))
  if (!caps.efforts.length) return []
  return [{ value: 'auto', label: reasoningLevelName('auto') }, ...caps.efforts.map((v) => ({ value: v, label: reasoningLevelName(v) }))]
}

/** Los modelos conocidos de un preset con clave para elegir: el recomendado primero y el elegido aunque no esté en la lista. */
function modelChoices(s: ProviderState, current: string): { defaultModel: string; models: AIModelChoice[] } | undefined {
  if (s.group !== 'api') return undefined
  const known = KNOWN_MODELS[s.id] ?? []
  if (known.length < 2) return undefined
  const defaultModel = s.preset?.model || known[0].id
  const models = [...known]
    .sort((a, b) => (a.id === defaultModel ? -1 : b.id === defaultModel ? 1 : 0))
    .map((m) => ({ id: m.id, label: m.displayName ?? m.id }))
  if (current && !models.some((m) => m.id === current)) models.push({ id: current, label: current })
  return { defaultModel, models }
}

function providerView(s: ProviderState, activeId: string | undefined): AIProviderView {
  const v: AIProviderView = {
    id: s.id,
    kind: s.kind,
    label: s.label,
    group: s.group,
    help: s.preset ? pick(s.preset.help) : '',
    reasoningOptions: reasoningOptions(s),
    needsKey: s.needsKey,
    hasKey: s.hasKey,
    configured: !!s.stored || s.hasKey,
    enabled: s.enabled,
    active: s.id === activeId,
    available: s.available,
    billing: billingFor({ id: s.id, kind: s.kind, baseURL: s.provider.baseURL }),
    supported: s.supported
  }
  if (s.preset?.keyURL) v.keyURL = s.preset.keyURL
  if (s.provider.baseURL) v.baseURL = s.provider.baseURL
  const model = modelShown(s)
  if (model) v.model = model
  const choices = modelChoices(s, model)
  if (choices) Object.assign(v, choices)
  if (s.provider.reasoning) v.reasoning = s.provider.reasoning as AIReasoningChoice
  if (s.keyHint) v.keyHint = s.keyHint
  if (s.availability && !s.available) v.availability = s.availability
  return v
}

export async function aiProviderViews(opts: ServiceOptions = {}): Promise<AIProviderView[]> {
  const settings = aiSettings()
  const states = await listAvailableProviders(settings, { deps: opts.deps, refresh: opts.refresh })
  const active = settings.activeProvider ? states.find((s) => s.id === settings.activeProvider) : pickAutomatic(states)
  return states.map((s) => providerView(s, active?.id))
}

// MARK: Claves

function entryOrThrow(providerId: unknown, opts: ServiceOptions) {
  if (typeof providerId !== 'string' || !providerId.trim()) throw invalidArgs(tr('Falta el proveedor.', 'The provider is missing.'))
  const e = providerEntry(providerId, aiSettings(), opts.deps)
  if (!e) throw invalidArgs(tr(`No existe el proveedor «${providerId}».`, `The provider “${providerId}” doesn't exist.`))
  return e
}

/** Guarda la clave (limpia y validada) en el almacén de secretos. */
export async function setProviderKey(providerId: unknown, key: unknown, opts: ServiceOptions = {}): Promise<AIProviderView[]> {
  const e = entryOrThrow(providerId, opts)
  const ref = e.provider.secretRef
  if (!ref) throw invalidArgs(tr(`${e.label} no usa clave de API.`, `${e.label} doesn't use an API key.`))
  if (typeof key !== 'string') throw invalidArgs(tr('La clave no es válida.', "The key isn't valid."))
  const v = validateAPIKey(key)
  if (!v.ok) {
    throw new AIError('missingKey', v.problem === 'empty' ? tr('La clave está vacía.', 'The key is empty.') : invalidKeyCharactersMessage(e.label), { code: 'ai_missing_key' })
  }
  try {
    resolveDeps(opts.deps).secrets.set(ref, v.key)
  } catch (err) {
    throw unreadableSecretError(e.provider, err)
  }
  invalidateAvailability(e.id)
  return aiProviderViews(opts)
}

export async function removeProviderKey(providerId: unknown, opts: ServiceOptions = {}): Promise<AIProviderView[]> {
  const e = entryOrThrow(providerId, opts)
  if (e.provider.secretRef) {
    try {
      resolveDeps(opts.deps).secrets.delete(e.provider.secretRef)
    } catch (err) {
      throw unreadableSecretError(e.provider, err)
    }
  }
  invalidateAvailability(e.id)
  return aiProviderViews(opts)
}

// MARK: Configurar

const REASONING_CHOICES: readonly string[] = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'enabled']

export interface ConfigureArgs {
  /** `null` = elegir solo el mejor disponible. */
  providerId: string | null
  model?: string
  reasoning?: string
  /** Solo personalizados (o para cambiar la dirección de un preset). https, o http solo en este ordenador. */
  baseURL?: string
  /** La clave para esa dirección (si cambia de servidor, la guardada se borra). */
  key?: string
  label?: string
  enabled?: boolean
  /** Usarlo desde ahora (por defecto, sí). */
  activate?: boolean
}

function optionalString(v: unknown, name: string, max = 500): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || v.length > max) throw invalidArgs(tr(`«${name}» no es válido.`, `“${name}” isn't valid.`))
  return v.trim()
}

function customURLError(problem: 'empty' | 'invalid' | 'insecure'): AIError {
  const message = problem === 'insecure'
    ? tr('Usa una dirección https://. Solo se admite http:// para un servidor en este ordenador (localhost).', 'Use an https:// address. http:// is only allowed for a server on this computer (localhost).')
    : tr('La URL base no es válida. Debe parecerse a https://api.ejemplo.com/v1.', 'The base URL isn’t valid. It should look like https://api.example.com/v1.')
  return new AIError('other', message, { code: 'ai_bad_url' })
}

/** Servidor (esquema, host y puerto) de una dirección; '' si no hay o no es válida. */
function originOf(url: string | undefined | null): string {
  if (!url) return ''
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return ''
  }
}

/** Elige el proveedor (o el modo automático) y, si se dan, su modelo, razonamiento y dirección. La dirección de CUALQUIER
 *  proveedor es https (o http en este ordenador) y, si cambia de servidor, la clave guardada se borra (la clave es de ese
 *  servidor: la interfaz no puede mandarla a otro); la nueva puede venir en `key`. */
export async function configureAI(raw: unknown, opts: ServiceOptions = {}): Promise<AIStatus> {
  if (!raw || typeof raw !== 'object') throw invalidArgs(tr('Ajustes de IA no válidos.', 'Invalid AI settings.'))
  const a = raw as Record<string, unknown>
  if (a.providerId !== null && typeof a.providerId !== 'string') throw invalidArgs(tr('Falta el proveedor.', 'The provider is missing.'))
  const providerId = a.providerId === null ? null : (a.providerId as string).trim()
  const model = optionalString(a.model, 'model')
  const reasoning = optionalString(a.reasoning, 'reasoning', 20)?.toLowerCase()
  const baseURL = optionalString(a.baseURL, 'baseURL', 2000)
  const label = optionalString(a.label, 'label', 120)
  if (reasoning !== undefined && reasoning !== '' && !REASONING_CHOICES.includes(reasoning)) throw invalidArgs(tr('Nivel de razonamiento no válido.', 'Invalid reasoning level.'))
  if (a.enabled !== undefined && typeof a.enabled !== 'boolean') throw invalidArgs(tr('«enabled» no es válido.', '“enabled” isn’t valid.'))
  if (baseURL) baseURLParts(baseURL) // lanza `ai_bad_url` con un mensaje claro
  // cualquier proveedor: https, o http solo en este ordenador (ni la clave ni lo que se estudia viajan sin cifrar por la red)
  const checkedURL = baseURL ? checkCustomBaseURL(baseURL) : undefined
  if (checkedURL && !checkedURL.ok) throw customURLError(checkedURL.problem)
  let key: string | undefined
  if (a.key !== undefined) {
    const v = typeof a.key === 'string' ? validateAPIKey(a.key) : null
    if (!v?.ok) throw new AIError('missingKey', tr('La clave no es válida.', "The key isn't valid."), { code: 'ai_missing_key' })
    key = v.key
  }
  if (providerId === null) {
    updateSettings((s) => {
      s.ai.activeProvider = null
      return s
    })
    invalidateAvailability()
    return aiStatus(opts)
  }
  if (!providerId) throw invalidArgs(tr('Falta el proveedor.', 'The provider is missing.'))
  const preset = presetById(providerId)
  const existing = (aiSettings().providers ?? []).find((p) => p.id === providerId)
  const isCustom = !preset && !existing
  if (isCustom && !/^custom-[A-Za-z0-9_-]{1,40}$/.test(providerId)) {
    throw invalidArgs(tr(`No existe el proveedor «${providerId}».`, `The provider “${providerId}” doesn't exist.`))
  }
  // la clave guardada es del servidor de ahora: si la dirección cambia de servidor, se borra antes de cambiarla
  const before = providerEntry(providerId, aiSettings(), opts.deps)
  const keyRef = before ? before.provider.secretRef : preset ? (preset.usesKey ? aiKeyRef(providerId) : null) : aiKeyRef(providerId)
  if (key !== undefined && !keyRef) throw invalidArgs(tr('Este proveedor no usa clave de API.', "This provider doesn't use an API key."))
  const nextURL = baseURL === undefined ? undefined : checkedURL?.ok ? checkedURL.url : (preset?.baseURL ?? '')
  const movesServer = nextURL !== undefined && originOf(nextURL) !== originOf(before?.provider.baseURL)
  const secrets = resolveDeps(opts.deps).secrets
  if (movesServer && keyRef) {
    try {
      secrets.delete(keyRef)
    } catch (err) {
      throw unreadableSecretError(before?.provider ?? { label: providerId }, err)
    }
  }
  const touchesEntry = model !== undefined || reasoning !== undefined || baseURL !== undefined || label !== undefined || a.enabled !== undefined || isCustom
  updateSettings((s) => {
    if (touchesEntry) {
      const list = [...(s.ai.providers ?? [])]
      const i = list.findIndex((p) => p.id === providerId)
      const entry: AIProviderConfig = i >= 0 ? { ...list[i] } : {
        id: providerId,
        kind: preset?.kind ?? 'openai-compatible',
        label: preset ? pick(preset.label) : label || tr('Personalizado', 'Custom')
      }
      if (model !== undefined) {
        if (model) entry.model = model
        else delete entry.model
      }
      if (reasoning !== undefined) {
        if (reasoning) entry.reasoning = reasoning as AIReasoningChoice
        else delete entry.reasoning
      }
      if (baseURL !== undefined) {
        if (checkedURL?.ok) entry.baseURL = checkedURL.url
        else delete entry.baseURL
      }
      if (label) entry.label = label
      if (typeof a.enabled === 'boolean') entry.enabled = a.enabled
      if (i >= 0) list[i] = entry
      else list.push(entry)
      s.ai.providers = list
    }
    if (a.activate !== false) s.ai.activeProvider = providerId
    return s
  })
  if (key !== undefined && keyRef) {
    try {
      secrets.set(keyRef, key)
    } catch (err) {
      throw unreadableSecretError(before?.provider ?? { label: providerId }, err)
    }
  }
  invalidateAvailability(providerId)
  return aiStatus(opts)
}

// MARK: Modelos y prueba

/** Catálogo de modelos de un proveedor (de la API, de la copia guardada o los conocidos). Aprende los precios publicados. */
export async function providerModels(providerId: unknown, refresh = false, opts: ServiceOptions = {}): Promise<ModelCatalogView> {
  const e = entryOrThrow(providerId, opts)
  if (isRegisteredKind(e.kind) || !isKindSupported(e.kind)) {
    const states = await listAvailableProviders(aiSettings(), { deps: opts.deps, refresh })
    const s = states.find((x) => x.id === e.id)
    const ids = s?.models ?? []
    const catalog: ModelCatalogView = {
      models: ids.map((id) => ({ id, isFree: false })), popular: [], free: [], fetchedAt: Date.now(), source: ids.length ? 'cli' : 'known'
    }
    if (!ids.length) catalog.models = KNOWN_MODELS[e.id] ?? []
    if (s?.availability && !s.available) catalog.problem = s.availability
    return catalog
  }
  const catalog = await providerCatalog(e.provider, { refresh, deps: opts.deps })
  try {
    costMeter().prices.learn(catalog, { id: e.id })
  } catch {
    /* aprender precios es opcional */
  }
  return catalog
}

function testError(err: unknown, models: string[] = []): AITestResult {
  if (err instanceof AIError) return { state: err.kind === 'missingKey' ? 'needsKey' : 'error', message: err.message, models }
  return { state: 'error', message: err instanceof Error ? err.message : String(err), models }
}

/** «Probar conexión»: dirección, clave, lista de modelos y una petición mínima («Responde solo: OK»). Nunca lanza. */
export async function testProvider(providerId: unknown, opts: ServiceOptions & { signal?: AbortSignal } = {}): Promise<AITestResult> {
  const e = entryOrThrow(providerId, opts)
  if (!e.supported) return { state: 'error', message: tr(`Esta versión de Aula aún no puede usar «${e.label}».`, `This version of Aula can't use “${e.label}” yet.`), models: [] }
  invalidateAvailability(e.id)
  if (isRegisteredKind(e.kind)) {
    // CLIs y motores locales: su comprobación y, si está listo, una respuesta corta
    const states = await listAvailableProviders(aiSettings(), { deps: opts.deps, refresh: true })
    const s = states.find((x) => x.id === e.id)
    if (!s?.available) return { state: 'error', message: s?.availability ?? tr('No está disponible.', "It isn't available."), models: s?.models ?? [] }
    try {
      const model = await createModelFor(s, { deps: opts.deps, metered: false, signal: opts.signal })
      const res = await model.complete({ messages: [{ role: 'user', content: [{ type: 'text', text: PING_PROMPT }] }], timeoutSec: 120 }, { signal: opts.signal })
      return { state: 'ready', message: tr('Conexión correcta.', 'Connection successful.'), models: s.models ?? [], answer: describePing(res) }
    } catch (err) {
      return testError(err, s.models ?? [])
    }
  }
  const config = e.provider
  try {
    baseURLParts(config.baseURL)
    if (e.needsKey && !e.hasKey) throw missingKeyError(config)
  } catch (err) {
    return testError(err)
  }
  let models: string[] = []
  try {
    models = config.kind === 'anthropic' ? await anthropicListModels(config, opts.deps, opts.signal) : await openAIListModels(config, opts.deps, opts.signal)
  } catch (err) {
    // algunos servicios no permiten listar los modelos (404): no impide usarlos
    if (!(err instanceof AIError) || err.status !== 404) return testError(err)
  }
  let modelName = config.model
  if (!modelName && (config.kind === 'ollama' || config.kind === 'lmstudio') && models.length) modelName = models[0]
  if (!modelName) {
    return { state: 'ready', message: models.length ? tr('Conexión correcta. Elige un modelo de la lista.', 'Connection successful. Choose a model from the list.')
      : tr('Conexión correcta. Elige un modelo.', 'Connection successful. Choose a model.'), models }
  }
  try {
    const target = { ...config, model: modelName }
    const answer = config.kind === 'anthropic' ? await anthropicPing(target, opts.deps, opts.signal) : await openAIPing(target, opts.deps, opts.signal)
    return { state: 'ready', message: tr(`Conexión correcta con «${modelName}».`, `Connection successful with “${modelName}”.`), models, answer }
  } catch (err) {
    return testError(err, models)
  } finally {
    invalidateAvailability(e.id)
  }
}

export function aiCosts() {
  return costsView()
}

// MARK: Chat sencillo con streaming

export interface ChatStreamArgs {
  requestId: string
  messages: ChatMessage[]
  system?: string
  providerId?: string
  model?: string
  reasoning?: string
  purpose?: AIUsePurpose
  courseID?: string
}

export interface ChatDelta {
  requestId: string
  text?: string
  reasoning?: string
}

export interface ChatStreamSink {
  delta(d: ChatDelta): void
  done(d: AIChatDone): void
  error(e: { requestId: string; error: RpcErrorInfo }): void
}

const MAX_MESSAGES = 400
const MAX_TEXT = 2_000_000
const MAX_IMAGES = 16
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Valida los mensajes que llegan de la interfaz (texto e imágenes; sin herramientas). */
export function sanitizeChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) throw invalidArgs(tr('Mensajes no válidos.', 'Invalid messages.'))
  let total = 0
  let images = 0
  const out: ChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') throw invalidArgs(tr('Mensaje no válido.', 'Invalid message.'))
    const o = m as Record<string, unknown>
    if (o.role !== 'user' && o.role !== 'assistant' && o.role !== 'system') throw invalidArgs(tr('Rol de mensaje no válido.', 'Invalid message role.'))
    const parts: ContentPart[] = []
    const content = typeof o.content === 'string' ? [{ type: 'text', text: o.content }] : o.content
    if (!Array.isArray(content)) throw invalidArgs(tr('Contenido de mensaje no válido.', 'Invalid message content.'))
    for (const p of content) {
      const part = p as Record<string, unknown> | null
      if (part?.type === 'text' && typeof part.text === 'string') {
        total += part.text.length
        parts.push({ type: 'text', text: part.text })
      } else if (part?.type === 'image' && part.image && typeof part.image === 'object') {
        const img = part.image as Record<string, unknown>
        if (typeof img.mediaType !== 'string' || !IMAGE_TYPES.includes(img.mediaType) || typeof img.base64 !== 'string') {
          throw invalidArgs(tr('Imagen no válida.', 'Invalid image.'))
        }
        images += 1
        total += img.base64.length / 4
        parts.push({ type: 'image', image: { mediaType: img.mediaType, base64: img.base64 } })
      } else throw invalidArgs(tr('Contenido de mensaje no válido.', 'Invalid message content.'))
    }
    out.push({ role: o.role, content: parts })
  }
  if (total > MAX_TEXT || images > MAX_IMAGES) throw invalidArgs(tr('La conversación es demasiado grande.', 'The conversation is too large.'))
  return out
}

/** Las conversaciones en curso (una por `requestId`), con los fragmentos agrupados (~30 ms) para no saturar el IPC. */
export class ChatStreams {
  private active = new Map<string, AbortController>()

  constructor(private readonly resolveModel: (args: ChatStreamArgs) => Promise<ChatModel> = (args) =>
    resolveActiveModel(aiSettings(), { providerId: args.providerId, model: args.model, reasoning: args.reasoning })) {}

  get size(): number {
    return this.active.size
  }

  /** Valida, elige el modelo (los errores de configuración rechazan aquí) y empieza en segundo plano. */
  async start(raw: unknown, sink: ChatStreamSink): Promise<{ requestId: string }> {
    const args = this.validate(raw)
    if (this.active.has(args.requestId)) throw invalidArgs(tr('Ya hay una respuesta en curso con ese id.', 'There is already a response in progress with that id.'))
    const ctl = new AbortController()
    this.active.set(args.requestId, ctl)
    let model: ChatModel
    try {
      model = await this.resolveModel(args)
    } catch (err) {
      this.active.delete(args.requestId)
      throw err
    }
    void this.run(args, model, ctl, sink)
    return { requestId: args.requestId }
  }

  cancel(requestId: unknown): boolean {
    if (typeof requestId !== 'string') return false
    const ctl = this.active.get(requestId)
    if (!ctl) return false
    ctl.abort()
    return true
  }

  cancelAll(): void {
    for (const ctl of this.active.values()) ctl.abort()
  }

  private validate(raw: unknown): ChatStreamArgs {
    if (!raw || typeof raw !== 'object') throw invalidArgs(tr('Petición no válida.', 'Invalid request.'))
    const a = raw as Record<string, unknown>
    if (typeof a.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(a.requestId)) throw invalidArgs(tr('Falta el id de la petición.', 'The request id is missing.'))
    const args: ChatStreamArgs = { requestId: a.requestId, messages: sanitizeChatMessages(a.messages) }
    const system = optionalString(a.system, 'system', MAX_TEXT)
    if (system) args.system = system
    const providerId = optionalString(a.providerId, 'providerId', 100)
    if (providerId) args.providerId = providerId
    const model = optionalString(a.model, 'model')
    if (model) args.model = model
    const reasoning = optionalString(a.reasoning, 'reasoning', 20)
    if (reasoning) args.reasoning = reasoning
    if (a.purpose !== undefined) {
      if (!isAIUsePurpose(a.purpose)) throw invalidArgs(tr('Uso no válido.', 'Invalid purpose.'))
      args.purpose = a.purpose
    }
    const courseID = optionalString(a.courseID, 'courseID', 200)
    if (courseID) args.courseID = courseID
    return args
  }

  private async run(args: ChatStreamArgs, model: ChatModel, ctl: AbortController, sink: ChatStreamSink): Promise<void> {
    const { requestId } = args
    let text = ''
    let reasoning = ''
    let pendingText = ''
    let pendingReasoning = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let usage: Usage = emptyUsage()
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (!pendingText && !pendingReasoning) return
      const d: ChatDelta = { requestId }
      if (pendingText) d.text = pendingText
      if (pendingReasoning) d.reasoning = pendingReasoning
      pendingText = ''
      pendingReasoning = ''
      sink.delta(d)
    }
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, 30)
    }
    const messages: ChatMessage[] = []
    if (args.system) messages.push({ role: 'system', content: [{ type: 'text', text: args.system }] })
    messages.push(...args.messages)
    try {
      const res = await withAIUse({ purpose: args.purpose ?? 'chat', ...(args.courseID ? { courseID: args.courseID } : {}) }, () =>
        model.complete({ messages }, {
          signal: ctl.signal,
          onDelta: (e) => {
            if (e.type === 'text' && e.text) {
              text += e.text
              pendingText += e.text
              schedule()
            } else if (e.type === 'reasoning' && e.text) {
              reasoning += e.text
              pendingReasoning += e.text
              schedule()
            } else if (e.type === 'usage') usage = e.usage
          }
        }))
      flush()
      const finalText = messageText(res.message) || text
      const done: AIChatDone = { requestId, text: finalText, usage: res.usage, finish: res.finish }
      const r = res.message.reasoning ?? reasoning
      if (r) done.reasoning = r
      sink.done(done)
    } catch (err) {
      flush()
      if (ctl.signal.aborted || isCancellation(err)) {
        const done: AIChatDone = { requestId, text, usage, finish: 'stop', cancelled: true }
        if (reasoning) done.reasoning = reasoning
        sink.done(done)
      } else sink.error({ requestId, error: toErrorInfo(err) })
    } finally {
      if (timer) clearTimeout(timer)
      this.active.delete(requestId)
    }
  }
}
