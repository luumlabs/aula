// Registro de proveedores, disponibilidad y elección del modelo activo (resolveActiveModel).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setAILocale } from '@shared/ai/i18n'
import { defaultAISettings, type AISettings } from '@shared/settings/ai'
import { msg } from '@shared/ai/types'
import { setDataRoot } from '../paths'
import { CostLedger, CostMeter, PriceBook, setCostMeter, defaultSpending } from '../costs'
import { clearCatalogMemory } from './catalog/cache'
import type { ChatModel } from './model'
import { AIError } from './errors'
import {
  invalidateAvailability, isKindSupported, listAvailableProviders, pickAutomatic, providerEntries, providerEntry, registerProviderFactory,
  resolveActiveModel, resolveActiveProvider
} from './registry'
import { jsonReply, mockFetch, MockChatModel, sseReply, step, testDeps, type MockReply, type RecordedRequest } from './testing/mocks'

const KEY = 'sk-test-1234567890abcdefXYZ'
const settings = (o: Partial<AISettings> = {}): AISettings => ({ ...defaultAISettings(), ...o })
const chatOK = 'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n'

/** `fetch` que responde a los servidores locales (o los da por apagados) y a todo lo demás con `other`. */
function net(o: { ollama?: string[]; lmstudio?: string[]; other?: (r: RecordedRequest) => MockReply } = {}) {
  return mockFetch((r) => {
    if (r.method === 'POST' && (r.url.startsWith('http://localhost:11434') || r.url.startsWith('http://localhost:1234'))) return sseReply(chatOK)
    if (r.url.startsWith('http://localhost:11434')) return o.ollama ? jsonReply({ data: o.ollama.map((id) => ({ id })) }) : { networkError: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }
    if (r.url.startsWith('http://localhost:1234')) return o.lmstudio ? jsonReply({ data: o.lmstudio.map((id) => ({ id })) }) : { networkError: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }
    return o.other ? o.other(r) : sseReply(chatOK)
  })
}

let root: string
let unregister: (() => void)[] = []
beforeEach(() => {
  setAILocale('es')
  root = mkdtempSync(join(tmpdir(), 'aula-registry-'))
  setDataRoot(root)
  clearCatalogMemory()
  invalidateAvailability()
  setCostMeter(new CostMeter({ ledger: new CostLedger(null), prices: new PriceBook(null), settings: defaultSpending }))
})
afterEach(() => {
  for (const u of unregister) u()
  unregister = []
  setCostMeter(null)
  rmSync(root, { recursive: true, force: true })
})

function fakeCLI(id: string, text = 'hecho por la CLI'): MockChatModel {
  const m = new MockChatModel([step({ text })])
  m.providerId = id
  m.providerName = 'CLI'
  return m
}

describe('proveedores', () => {
  it('presets y personalizados, con clave enmascarada y nombre en el idioma actual', () => {
    const mf = net()
    const deps = testDeps(mf.fetch, { 'ai.key.deepseek': KEY })
    const s = settings({ providers: [{ id: 'custom-1', kind: 'openai-compatible', label: 'Mi pasarela', baseURL: 'https://gw.example.com/v1', model: 'm1' },
      { id: 'deepseek', kind: 'openai-compatible', label: 'DeepSeek', model: 'deepseek-chat' }] })
    const list = providerEntries(s, deps)
    expect(list.map((e) => e.id)).toContain('custom-1')
    expect(list.map((e) => e.id)).toContain('aula-local')
    const ds = list.find((e) => e.id === 'deepseek')!
    expect(ds.hasKey).toBe(true)
    expect(ds.keyHint).toBe('sk-…fXYZ')
    expect(JSON.stringify(ds)).not.toContain(KEY)
    expect(ds.provider.model).toBe('deepseek-flash') // un modelo retirado se pone al día
    expect(ds.needsKey).toBe(true)
    const custom = list.find((e) => e.id === 'custom-1')!
    expect(custom).toMatchObject({ label: 'Mi pasarela', group: 'custom', kind: 'openai-compatible' })
    expect(custom.provider).toMatchObject({ baseURL: 'https://gw.example.com/v1', model: 'm1', secretRef: 'ai.key.custom-1' })
    expect(providerEntry('ollama', s, deps)!.needsKey).toBe(false)
    expect(providerEntry('lmstudio', s, deps)!.needsKey).toBe(false)
    setAILocale('en')
    expect(providerEntry('ollama', s, deps)!.label).toBe('Ollama (on this computer)')
  })
  it('qué tipos tienen implementación', () => {
    expect(isKindSupported('openai-compatible')).toBe(true)
    expect(isKindSupported('anthropic')).toBe(true)
    expect(isKindSupported('claude-cli')).toBe(false)
    unregister.push(registerProviderFactory('claude-cli', () => fakeCLI('claude-cli')))
    expect(isKindSupported('claude-cli')).toBe(true)
  })
})

describe('disponibilidad y elección automática', () => {
  it('sin nada configurado no hay ninguna IA', async () => {
    const deps = testDeps(net().fetch)
    const states = await listAvailableProviders(settings(), { deps })
    expect(pickAutomatic(states)).toBeUndefined()
    expect(states.find((s) => s.id === 'deepseek')!.availability).toContain('clave')
    expect(states.find((s) => s.id === 'ollama')!.availability).toContain('no está en marcha')
    expect(states.find((s) => s.id === 'claude-cli')!.supported).toBe(false)
    await expect(resolveActiveModel(settings(), { deps })).rejects.toMatchObject({ code: 'ai_no_provider' })
  })
  it('con una clave se usa esa API; gana la de más prioridad', async () => {
    const deps = testDeps(net().fetch, { 'ai.key.deepseek': KEY })
    expect((await resolveActiveProvider(settings(), { deps }))?.id).toBe('deepseek')
    deps.secretsStore.set('ai.key.anthropic', 'sk-ant-1234567890abcdef')
    invalidateAvailability()
    expect((await resolveActiveProvider(settings(), { deps }))?.id).toBe('anthropic')
    // un proveedor desactivado no se elige
    const s = settings({ providers: [{ id: 'anthropic', kind: 'anthropic', label: '', enabled: false }] })
    expect((await resolveActiveProvider(s, { deps }))?.id).toBe('deepseek')
  })
  it('un servidor local en marcha con modelos se usa (y su modelo, si el del preset no está)', async () => {
    const mf = net({ ollama: ['llama3.2:latest', 'gemma4'] })
    const deps = testDeps(mf.fetch)
    const best = await resolveActiveProvider(settings(), { deps })
    expect(best?.id).toBe('ollama')
    expect(best?.models).toEqual(['gemma4', 'llama3.2:latest'])
    const model = await resolveActiveModel(settings(), { deps, metered: false })
    expect(model.providerId).toBe('ollama')
    const res = await model.complete({ messages: [msg.user('hola')] })
    expect(res.message.content).toEqual([{ type: 'text', text: 'OK' }])
    const sent = mf.requests.find((r) => r.url.endsWith('/chat/completions'))!
    expect((sent.body as { model: string }).model).toBe('gemma4')
  })
  it('las CLIs registradas con su comprobación ganan (y se guarda en caché)', async () => {
    let probes = 0
    unregister.push(registerProviderFactory('claude-cli', (config) => {
      const m = fakeCLI(config.id)
      m.model = config.model ?? ''
      return m
    }, { probe: () => (probes++, { available: true }) }))
    const deps = testDeps(net().fetch, { 'ai.key.deepseek': KEY })
    const model = await resolveActiveModel(settings(), { deps })
    expect(model.providerId).toBe('claude-cli')
    await listAvailableProviders(settings(), { deps })
    expect(probes).toBe(1)
    await listAvailableProviders(settings(), { deps, refresh: true })
    expect(probes).toBe(2)
    invalidateAvailability()
    await listAvailableProviders(settings(), { deps })
    expect(probes).toBe(3)
  })
  it('una CLI registrada que no está lista no se elige', async () => {
    unregister.push(registerProviderFactory('codex-cli', () => fakeCLI('codex-cli'), { probe: async () => ({ available: false, reason: 'Codex no está instalado.' }) }))
    const deps = testDeps(net().fetch, { 'ai.key.deepseek': KEY })
    const states = await listAvailableProviders(settings(), { deps })
    expect(states.find((s) => s.id === 'codex-cli')).toMatchObject({ supported: true, available: false, availability: 'Codex no está instalado.' })
    expect(pickAutomatic(states)?.id).toBe('deepseek')
  })
})

describe('proveedor elegido', () => {
  it('el elegido se usa aunque haya otros; con su modelo y razonamiento', async () => {
    const mf = net()
    const deps = testDeps(mf.fetch, { 'ai.key.deepseek': KEY, 'ai.key.anthropic': 'sk-ant-1234567890abcdef' })
    const s = settings({ activeProvider: 'deepseek', providers: [{ id: 'deepseek', kind: 'openai-compatible', label: '', model: 'deepseek-v4-pro', reasoning: 'max' }] })
    const model = await resolveActiveModel(s, { deps, metered: false })
    expect(model.providerId).toBe('deepseek')
    expect(model.model).toBe('deepseek-v4-pro')
    await model.complete({ messages: [msg.user('x')] })
    expect(mf.requests[0].body).toMatchObject({ model: 'deepseek-v4-pro', reasoning_effort: 'max', thinking: { type: 'enabled' } })
    const other = await resolveActiveModel(s, { deps, metered: false, model: 'deepseek-flash', reasoning: 'none' })
    await other.complete({ messages: [msg.user('x')] })
    expect(mf.requests[1].body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' } })
  })
  it('errores claros: sin clave, id desconocido, tipo sin implementación', async () => {
    const deps = testDeps(net().fetch)
    await expect(resolveActiveModel(settings({ activeProvider: 'openai' }), { deps })).rejects.toMatchObject({ code: 'ai_missing_key' })
    await expect(resolveActiveModel(settings({ activeProvider: 'no-existe' }), { deps })).rejects.toMatchObject({ code: 'ai_no_provider' })
    const e = await resolveActiveModel(settings({ activeProvider: 'claude-cli' }), { deps }).catch((x) => x)
    expect(e).toBeInstanceOf(AIError)
    expect(e.code).toBe('ai_unsupported')
  })
  it('sin modelo configurado se elige el primero del catálogo que admite herramientas', async () => {
    const mf = net({ other: (r) => (r.url.endsWith('/models') ? jsonReply({ data: [{ id: 'grok-voz-tts' }, { id: 'grok-9' }, { id: 'grok-9-mini' }] }) : sseReply(chatOK)) })
    const deps = testDeps(mf.fetch, { 'ai.key.xai': 'xai-1234567890abcdef' })
    const model = await resolveActiveModel(settings({ activeProvider: 'xai' }), { deps, metered: false })
    expect(model.model).toBe('grok-9')
    expect(mf.requests[0].url).toBe('https://api.x.ai/v1/models')
  })
  it('por defecto el modelo viene medido (cada llamada queda en el libro)', async () => {
    const meter = new CostMeter({ ledger: new CostLedger(null), prices: new PriceBook(null), settings: defaultSpending })
    setCostMeter(meter)
    const deps = testDeps(net().fetch, { 'ai.key.deepseek': KEY })
    const model = await resolveActiveModel(settings({ activeProvider: 'deepseek' }), { deps })
    await model.complete({ messages: [msg.user('x')] })
    const e = meter.ledger.recent(1)[0]
    expect(e).toMatchObject({ providerID: 'deepseek', model: 'deepseek-flash', billing: 'perToken', priceSource: 'list', promptTokens: 3, completionTokens: 1 })
    expect(e.usd).toBeGreaterThan(0)
  })
})

describe('IA simulada (AULA_FAKE_AI)', () => {
  it('sustituye al modelo de toda la app y responde sin red', async () => {
    const { createFakeModel, setFakeAIScript } = await import('./fake')
    const { setModelOverride } = await import('./registry')
    setModelOverride(createFakeModel)
    try {
      const model = await resolveActiveModel(settings())
      expect(model.providerId).toBe('fake')
      expect((await model.complete({ messages: [msg.user('hola')] })).message.content).toEqual([{ type: 'text', text: 'Respuesta simulada de Aula.' }])
      expect((await model.complete({ messages: [msg.user('hola')], jsonMode: true })).message.content).toEqual([{ type: 'text', text: '{}' }])
      setFakeAIScript(() => 'guion propio')
      expect((await model.complete({ messages: [msg.user('x')] })).message.content).toEqual([{ type: 'text', text: 'guion propio' }])
    } finally {
      setFakeAIScript(null)
      setModelOverride(null)
    }
  })
})
