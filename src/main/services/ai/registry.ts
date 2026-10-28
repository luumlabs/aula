// Registro de proveedores y elección del modelo activo.
//
// Los proveedores por API (compatibles con OpenAI —también Ollama y LM Studio— y Anthropic) vienen de serie. Los demás tipos los
// registra su módulo con `registerProviderFactory(kind, factory, { probe })`:
//   - agentes CLI (claude-cli, codex-cli, opencode-cli): src/main/services/agents (`registerCLIProviders(registerProviderFactory)`);
//   - motor local de Aula (aula-local) u otros servidores locales con detección propia.
// Un registro sustituye al anterior del mismo tipo (también a los de serie: un módulo local puede mejorar Ollama/LM Studio).
//
// `resolveActiveModel(settings)` devuelve el `ChatModel` que hay que usar: el proveedor elegido o, en automático
// (`activeProvider: null`), el mejor disponible por prioridad (suscripciones → APIs con clave → modelos de este ordenador).
// Por defecto viene MEDIDO (costes y tope diario, ver src/main/services/costs).
import type { AIProviderConfig, AIProviderKind, AISettings } from '@shared/settings/ai'
import { aiKeyRef } from '@shared/settings/ai'
import { maskAPIKey } from '@shared/ai/apiKey'
import { pick, tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import type { AIProviderGroup } from '@shared/ai/views'
import type { ModelInfo } from '@shared/ai/types'
import { reasoningCaps, type ReasoningCapabilities } from '@shared/ai/reasoning'
import { getSettings } from '../settings'
import { log } from '../log'
import { costMeter, meteredModel, type CostMeter } from '../costs'
import { AIError } from './errors'
import type { ChatModel } from './model'
import { reasoningCapabilitiesFor, type ProviderConfig } from './providers/config'
import { resolveDeps, type ProviderDeps } from './providers/base'
import { hasStoredKey, missingKeyError, needsKey as configNeedsKey } from './providers/keys'
import { noModelError } from './providers/common'
import { OpenAICompatibleModel } from './providers/openai'
import { AnthropicModel } from './providers/anthropic'
import { baseURLParts, hostOf, isLocalOrPrivateHost, openAIModelsURL } from './http/endpoints'
import { likelyChatModels, modelIDs, sortedUnique } from './http/requester'
import { tryParseJSON } from './core/json'
import { configFromPreset, modernized, PROVIDER_PRESETS, presetById, type ProviderPreset } from './presets'
import { cachedCatalog, providerCatalog } from './catalog/cache'

// MARK: Registro

/** ¿Se puede usar ya? (`models`: los que tiene, si se saben). */
export interface ProviderAvailability {
  available: boolean
  /** Por qué no (frase corta para la persona). */
  reason?: string
  models?: string[]
}

export interface ProviderFactoryContext {
  /** Configuración completa (preset + ajustes) en el formato de los proveedores HTTP. */
  provider: ProviderConfig
  deps: ProviderDeps
}

/** Crea el modelo de un proveedor a partir de su configuración ya completa (preset + ajustes). */
export type ProviderFactory = (config: AIProviderConfig, ctx: ProviderFactoryContext) => ChatModel

/** Comprueba si el proveedor se puede usar (CLI instalada y con sesión, servidor en marcha…). Se guarda en caché. */
export type ProviderProbe = (config: AIProviderConfig, ctx: ProviderFactoryContext) => ProviderAvailability | Promise<ProviderAvailability>

export interface ProviderRegistrationOptions {
  probe?: ProviderProbe
  /** Cuánto vale un resultado de `probe` (ms): 60 s si está disponible, 15 s si no. */
  probeTTLms?: number
}

interface Registration {
  factory: ProviderFactory
  probe?: ProviderProbe
  probeTTLms?: number
}

const BUILTIN_KINDS: readonly AIProviderKind[] = ['openai-compatible', 'anthropic', 'ollama', 'lmstudio']
const registry = new Map<AIProviderKind, Registration>()

/** Registra (o sustituye) la fábrica de un tipo de proveedor. Devuelve la función que lo quita. */
export function registerProviderFactory(kind: AIProviderKind, factory: ProviderFactory, options: ProviderRegistrationOptions = {}): () => void {
  const reg: Registration = { factory, probe: options.probe, probeTTLms: options.probeTTLms }
  registry.set(kind, reg)
  invalidateAvailability()
  return () => {
    if (registry.get(kind) === reg) {
      registry.delete(kind)
      invalidateAvailability()
    }
  }
}

export function unregisterProviderFactory(kind: AIProviderKind): void {
  registry.delete(kind)
  invalidateAvailability()
}

/** ¿Lo implementa un módulo registrado (y no la API de serie)? */
export function isRegisteredKind(kind: AIProviderKind): boolean {
  return registry.has(kind)
}

/** ¿Hay implementación para este tipo (de serie o registrada)? */
export function isKindSupported(kind: AIProviderKind): boolean {
  return registry.has(kind) || BUILTIN_KINDS.includes(kind)
}

/** El modelo de API de serie para una configuración (OpenAI compatible o Anthropic). */
export function createAPIModel(provider: ProviderConfig, deps: ProviderDeps = {}): ChatModel {
  if (provider.kind === 'anthropic') return new AnthropicModel(provider, deps)
  if (provider.kind === 'openai-compatible' || provider.kind === 'ollama' || provider.kind === 'lmstudio') return new OpenAICompatibleModel(provider, deps)
  throw new AIError('unsupported', tr(`«${provider.label}» no es una API: necesita su módulo (agentes o modelo local).`,
    `“${provider.label}” isn't an API: it needs its module (agents or local model).`))
}

// MARK: Proveedores (presets + ajustes)

/** Un proveedor tal como lo ve Aula: preset y ajustes ya combinados. */
export interface ProviderEntry {
  id: string
  kind: AIProviderKind
  label: string
  group: AIProviderGroup
  priority: number
  preset?: ProviderPreset
  /** Lo guardado en los ajustes (si hay). */
  stored?: AIProviderConfig
  /** Configuración completa en el formato de los ajustes (la que reciben las fábricas). */
  config: AIProviderConfig
  /** Configuración completa en el formato de los proveedores HTTP. */
  provider: ProviderConfig
  enabled: boolean
  needsKey: boolean
  hasKey: boolean
  keyHint?: string
  supported: boolean
}

function storedFor(settings: AISettings, id: string): AIProviderConfig | undefined {
  return (settings.providers ?? []).find((p) => p && p.id === id)
}

/** Nombre visible: el del preset en el idioma actual, salvo que la persona lo cambiara. */
function labelFor(preset: ProviderPreset | undefined, stored: AIProviderConfig | undefined): string {
  const own = stored?.label?.trim()
  if (preset && (!own || own === preset.label.es || own === preset.label.en)) return pick(preset.label)
  return own || stored?.id || preset?.id || ''
}

/** Niveles de razonamiento por modelo del catálogo guardado (los publica la API y mandan sobre la lista conocida). */
function catalogReasoning(provider: ProviderConfig): Record<string, ReasoningCapabilities> | undefined {
  const catalog = cachedCatalog(provider)
  if (!catalog || catalog.source !== 'api') return undefined
  const out: Record<string, ReasoningCapabilities> = {}
  for (const m of [...catalog.models, ...catalog.popular, ...catalog.free]) if (m.reasoningCapabilities) out[m.id] = m.reasoningCapabilities
  return Object.keys(out).length ? out : undefined
}

function buildProvider(id: string, kind: AIProviderKind, label: string, preset: ProviderPreset | undefined, stored: AIProviderConfig | undefined): ProviderConfig {
  const base: ProviderConfig = preset
    ? configFromPreset(preset, label)
    : {
      id, kind, label, model: '', secretRef: aiKeyRef(id), extraHeaders: {}, supportsTools: true, supportsVision: false,
      supportsStreaming: true, supportsJSONMode: false, enabled: true
    }
  const c: ProviderConfig = { ...base, label, kind }
  if (stored) {
    if (stored.baseURL?.trim()) c.baseURL = stored.baseURL.trim()
    if (stored.model?.trim()) c.model = stored.model.trim()
    if (stored.reasoning) c.reasoning = stored.reasoning
    if (stored.executable) c.executable = stored.executable
    if (stored.secretRef) c.secretRef = stored.secretRef
    if (stored.headers) c.extraHeaders = { ...c.extraHeaders, ...stored.headers }
    if (typeof stored.supportsTools === 'boolean') c.supportsTools = stored.supportsTools
    if (typeof stored.supportsVision === 'boolean') c.supportsVision = stored.supportsVision
    if (typeof stored.contextWindow === 'number' && stored.contextWindow > 0) c.contextWindow = stored.contextWindow
    if (typeof stored.maxOutputTokens === 'number' && stored.maxOutputTokens > 0) c.maxOutputTokens = stored.maxOutputTokens
    c.enabled = stored.enabled !== false
  }
  const modern = modernized(c)
  const reasoning = catalogReasoning(modern)
  return reasoning ? { ...modern, reasoningCapabilitiesByModel: reasoning } : modern
}

function entryFor(id: string, settings: AISettings, deps: ProviderDeps): ProviderEntry | undefined {
  const preset = presetById(id)
  const stored = storedFor(settings, id)
  if (!preset && !stored) return undefined
  const kind: AIProviderKind = preset?.kind ?? (stored!.kind === 'auto' ? 'openai-compatible' : stored!.kind)
  const label = labelFor(preset, stored)
  const provider = buildProvider(id, kind, label, preset, stored)
  const secrets = resolveDeps(deps).secrets
  const usesKey = provider.secretRef !== null
  const hasKey = usesKey && hasStoredKey(provider, secrets)
  let keyHint: string | undefined
  if (hasKey && provider.secretRef) {
    try {
      keyHint = maskAPIKey(secrets.get(provider.secretRef) ?? '')
    } catch {
      keyHint = undefined
    }
  }
  const config: AIProviderConfig = {
    ...(stored ?? {}),
    id, kind, label,
    model: provider.model,
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(provider.reasoning ? { reasoning: provider.reasoning as AIProviderConfig['reasoning'] } : {}),
    ...(provider.executable ? { executable: provider.executable } : {}),
    ...(provider.secretRef ? { secretRef: provider.secretRef } : {}),
    enabled: provider.enabled
  }
  const group: AIProviderGroup = preset?.group ?? 'custom'
  return {
    id, kind, label, group,
    priority: preset?.priority ?? 30,
    preset, stored, config, provider,
    enabled: provider.enabled,
    needsKey: usesKey && kind !== 'aula-local' && configNeedsKey(provider),
    hasKey,
    ...(keyHint ? { keyHint } : {}),
    supported: isKindSupported(kind)
  }
}

/** Todos los proveedores: los presets (con lo que haya cambiado la persona) y los personalizados de los ajustes. */
export function providerEntries(settings: AISettings = getSettings().ai, deps: ProviderDeps = {}): ProviderEntry[] {
  const ids: string[] = PROVIDER_PRESETS.map((p) => p.id)
  for (const p of settings.providers ?? []) if (p?.id && !ids.includes(p.id)) ids.push(p.id)
  return ids.map((id) => entryFor(id, settings, deps)).filter((e): e is ProviderEntry => !!e)
}

export function providerEntry(id: string, settings: AISettings = getSettings().ai, deps: ProviderDeps = {}): ProviderEntry | undefined {
  return entryFor(id, settings, deps)
}

// MARK: Disponibilidad

export interface ProviderState extends ProviderEntry {
  available: boolean
  availability?: string
  /** Modelos que dijo tener (servidores locales, CLIs), si se sabe. */
  models?: string[]
}

interface CacheItem {
  at: number
  ttl: number
  value?: ProviderAvailability
  pending?: Promise<ProviderAvailability>
}

const availabilityCache = new Map<string, CacheItem>()

/** Olvida las comprobaciones guardadas (de un proveedor o de todos). */
export function invalidateAvailability(providerId?: string): void {
  if (!providerId) availabilityCache.clear()
  else for (const k of [...availabilityCache.keys()]) if (k.startsWith(providerId + '|')) availabilityCache.delete(k)
}

const cacheKey = (e: ProviderEntry) => [e.id, e.kind, e.provider.baseURL ?? '', e.provider.executable ?? '', e.hasKey ? 'k' : ''].join('|')

/** ¿Responde un servidor local compatible con OpenAI? (GET /models, 1,5 s). */
async function probeLocalServer(entry: ProviderEntry, deps: ProviderDeps): Promise<ProviderAvailability> {
  const http = resolveDeps(deps).http
  let url: string
  try {
    url = openAIModelsURL(entry.provider.baseURL)
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) }
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 1500)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (entry.hasKey && entry.provider.secretRef) {
      const key = resolveDeps(deps).secrets.get(entry.provider.secretRef)
      if (key) headers.Authorization = `Bearer ${key.trim()}`
    }
    const res = await http.fetch(url, { method: 'GET', headers, signal: ctl.signal })
    if (res.status === 401 || res.status === 403) {
      return { available: false, reason: tr('El servidor pide una clave: pégala en los ajustes de IA.', 'The server asks for a key: paste it in AI settings.') }
    }
    if (res.status < 200 || res.status >= 300) return { available: false, reason: tr(`El servidor respondió ${res.status}.`, `The server responded ${res.status}.`) }
    const json = tryParseJSON(await res.text())
    const models = json === undefined ? [] : likelyChatModels(sortedUnique(modelIDs(json)))
    if (!models.length) return { available: false, reason: tr('El servidor está en marcha pero no tiene ningún modelo cargado.', 'The server is running but has no model loaded.'), models }
    return { available: true, models }
  } catch {
    return { available: false, reason: tr(`${entry.label} no está en marcha en este ordenador.`, `${entry.label} isn't running on this computer.`) }
  } finally {
    clearTimeout(timer)
  }
}

function isLocalEntry(e: ProviderEntry): boolean {
  return e.kind === 'ollama' || e.kind === 'lmstudio' || (e.kind === 'openai-compatible' && isLocalOrPrivateHost(hostOf(e.provider.baseURL)))
}

/** Comprobación sin red de un proveedor por API remoto. */
function apiAvailability(e: ProviderEntry): ProviderAvailability {
  try {
    baseURLParts(e.provider.baseURL)
  } catch (err) {
    return { available: false, reason: err instanceof AIError ? err.message : tr('Falta la dirección del servicio.', 'The service address is missing.') }
  }
  if (e.needsKey && !e.hasKey) return { available: false, reason: tr('Falta la clave de API.', 'The API key is missing.') }
  return { available: true }
}

async function probeEntry(e: ProviderEntry, deps: ProviderDeps, refresh: boolean): Promise<ProviderAvailability> {
  if (!e.enabled) return { available: false, reason: tr('Desactivado en los ajustes.', 'Disabled in settings.') }
  if (!e.supported) return { available: false, reason: tr('Esta versión de Aula aún no lo puede usar.', "This version of Aula can't use it yet.") }
  const reg = registry.get(e.kind)
  const remoteAPI = !reg && !isLocalEntry(e)
  if (remoteAPI) return apiAvailability(e)
  const key = cacheKey(e)
  const now = Date.now()
  const cached = availabilityCache.get(key)
  if (!refresh && cached) {
    if (cached.pending) return cached.pending
    if (cached.value && now - cached.at < cached.ttl) return cached.value
  }
  const run = async (): Promise<ProviderAvailability> => {
    try {
      if (reg?.probe) return await reg.probe(e.config, { provider: e.provider, deps })
      if (reg) return { available: true } // registrado sin comprobación: se da por bueno
      return await probeLocalServer(e, deps)
    } catch (err) {
      log.warn(`IA: no se pudo comprobar ${e.label}`, err)
      return { available: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }
  const pending = run()
  availabilityCache.set(key, { at: now, ttl: 0, pending })
  const value = await pending
  const ttl = reg?.probeTTLms ?? (value.available ? 60_000 : 15_000)
  availabilityCache.set(key, { at: Date.now(), ttl, value })
  return value
}

export interface AvailabilityOptions {
  /** Volver a comprobar aunque haya un resultado reciente. */
  refresh?: boolean
  deps?: ProviderDeps
}

/** Todos los proveedores con su disponibilidad, del más preferido al menos (por prioridad). */
export async function listAvailableProviders(settings: AISettings = getSettings().ai, opts: AvailabilityOptions = {}): Promise<ProviderState[]> {
  const deps = opts.deps ?? {}
  const entries = providerEntries(settings, deps)
  const states = await Promise.all(entries.map(async (e): Promise<ProviderState> => {
    const a = await probeEntry(e, deps, opts.refresh === true)
    const s: ProviderState = { ...e, available: a.available }
    if (a.reason && !a.available) s.availability = a.reason
    if (a.models) s.models = a.models
    return s
  }))
  return states.sort((a, b) => b.priority - a.priority)
}

/** El que se usaría en automático: el primero disponible por prioridad (el personalizado vacío nunca). */
export function pickAutomatic(states: ProviderState[]): ProviderState | undefined {
  return states.find((s) => s.available && s.enabled && s.supported)
}

// MARK: Modelo activo

export interface ResolveOptions {
  /** Usar este proveedor (si no, el de los ajustes o el automático). */
  providerId?: string
  /** Otro modelo del proveedor. */
  model?: string
  /** Otro nivel de razonamiento ('auto' = el del proveedor). */
  reasoning?: string
  deps?: ProviderDeps
  /** Medir costes y aplicar el tope diario (por defecto, sí). */
  metered?: boolean
  meter?: CostMeter
  signal?: AbortSignal
}

export function noProviderError(): AIError {
  return new AIError('other', tr(
    `No hay ninguna IA lista para usar. Ve a ${settingsPath('ai', 'es')}: conecta tu suscripción de Claude o ChatGPT, pega una clave de API o usa un modelo en este ordenador.`,
    `No AI is ready to use. Go to ${settingsPath('ai', 'en')}: connect your Claude or ChatGPT subscription, paste an API key, or use a model on this computer.`
  ), { code: 'ai_no_provider' })
}

function unknownProviderError(id: string): AIError {
  return new AIError('other', tr(`El proveedor de IA «${id}» no existe. Elige otro en ${settingsPath('ai', 'es')}.`,
    `The AI provider “${id}” doesn’t exist. Choose another one in ${settingsPath('ai', 'en')}.`), { code: 'ai_no_provider' })
}

function unsupportedError(e: ProviderEntry): AIError {
  return new AIError('unsupported', tr(`Esta versión de Aula aún no puede usar «${e.label}». Elige otro proveedor en ${settingsPath('ai', 'es')}.`,
    `This version of Aula can’t use “${e.label}” yet. Choose another provider in ${settingsPath('ai', 'en')}.`))
}

/** Primer modelo de chat de un catálogo (los que admiten herramientas van primero). */
function firstUsable(models: ModelInfo[]): string | undefined {
  return models.find((m) => m.supportsTools !== false)?.id ?? models[0]?.id
}

/** El modelo que se enviará: el pedido, el configurado o, si no hay, el primero que ofrezca el proveedor. */
async function modelFor(state: ProviderEntry & { models?: string[] }, options: ResolveOptions): Promise<string> {
  const explicit = options.model?.trim()
  if (explicit) return explicit
  const configured = state.provider.model
  const isAPI = BUILTIN_KINDS.includes(state.kind) && !registry.has(state.kind)
  if (!isAPI) return configured
  // servidor local: si el modelo del preset no está, el primero que tenga cargado
  if (state.models?.length && (!configured || (isLocalEntry(state) && !state.models.includes(configured)))) return state.models[0]
  if (configured) return configured
  const cached = cachedCatalog(state.provider)
  const fromCache = cached ? firstUsable(cached.models) : undefined
  if (fromCache) return fromCache
  const catalog = await providerCatalog(state.provider, { deps: options.deps, signal: options.signal })
  const fromAPI = firstUsable(catalog.models)
  if (fromAPI) return fromAPI
  throw noModelError(state.provider)
}

/** Crea el modelo de un proveedor ya elegido. */
export async function createModelFor(state: ProviderEntry & { models?: string[] }, options: ResolveOptions = {}): Promise<ChatModel> {
  if (!state.supported) throw unsupportedError(state)
  if (state.needsKey && !state.hasKey) throw missingKeyError(state.provider)
  const deps = options.deps ?? {}
  const model = await modelFor(state, options)
  const reasoning = options.reasoning?.trim()
  const provider: ProviderConfig = { ...state.provider, model, ...(reasoning ? { reasoning } : {}) }
  const config: AIProviderConfig = { ...state.config, model, ...(reasoning ? { reasoning: reasoning as AIProviderConfig['reasoning'] } : {}) }
  const reg = registry.get(state.kind)
  const base = reg ? reg.factory(config, { provider, deps }) : createAPIModel(provider, deps)
  if (options.metered === false) return base
  const meter = options.meter
  return meteredModel(base, { id: state.id, kind: state.kind, label: state.label, baseURL: provider.baseURL, model }, meter ?? (() => costMeter()))
}

let override: (() => ChatModel) | null = null

/** Sustituye el modelo de toda la app (IA simulada de las pruebas: `AULA_FAKE_AI=1`). `null` lo quita. */
export function setModelOverride(factory: (() => ChatModel) | null): void {
  override = factory
}

/** El modelo que sustituye a todos, si hay uno. */
export function modelOverride(): ChatModel | undefined {
  return override ? override() : undefined
}

/**
 * El modelo que hay que usar ahora: el proveedor elegido en los ajustes (o `options.providerId`) o, en automático, el mejor
 * disponible. Lanza un `AIError` con código estable si no hay ninguno (`ai_no_provider`), falta la clave (`ai_missing_key`), no
 * hay modelo (`ai_no_model`) o el tipo no tiene implementación (`ai_unsupported`).
 */
export async function resolveActiveModel(settings: AISettings = getSettings().ai, options: ResolveOptions = {}): Promise<ChatModel> {
  if (override) return override()
  const id = options.providerId ?? settings.activeProvider
  if (id) {
    const entry = providerEntry(id, settings, options.deps)
    if (!entry) throw unknownProviderError(id)
    // un servidor local: se mira qué modelos tiene (rápido y en caché) para no pedir uno que no está
    const local = isLocalEntry(entry) && !registry.has(entry.kind) ? await probeEntry(entry, options.deps ?? {}, false) : undefined
    return createModelFor({ ...entry, ...(local?.models ? { models: local.models } : {}) }, options)
  }
  const states = await listAvailableProviders(settings, { deps: options.deps })
  const best = pickAutomatic(states)
  if (!best) throw noProviderError()
  return createModelFor(best, options)
}

/** Lo que se usaría ahora (sin crear el modelo): el proveedor y su estado, o `undefined`. */
export async function resolveActiveProvider(settings: AISettings = getSettings().ai, opts: AvailabilityOptions = {}): Promise<ProviderState | undefined> {
  const states = await listAvailableProviders(settings, opts)
  if (settings.activeProvider) return states.find((s) => s.id === settings.activeProvider)
  return pickAutomatic(states)
}

/** Niveles de razonamiento conocidos de un proveedor y modelo (vacío = no se puede elegir). */
export function reasoningFor(entry: ProviderEntry, model?: string): ReasoningCapabilities {
  return reasoningCapabilitiesFor(entry.provider, model) ?? reasoningCaps([])
}
