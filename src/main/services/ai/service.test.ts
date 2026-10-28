// Lo que la interfaz pide por IPC (ai.status, ai.providers, ai.setKey, ai.configure, ai.models, ai.test, ai.chatStream…), sin Electron.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setAILocale } from '@shared/ai/i18n'
import type { AIChatDone } from '@shared/ai/views'
import { setDataRoot } from '../paths'
import { getSettings, resetSettingsCache, updateSettings } from '../settings'
import { CostLedger, CostMeter, PriceBook, setCostMeter, defaultSpending } from '../costs'
import { clearCatalogMemory } from './catalog/cache'
import { invalidateAvailability } from './registry'
import { aiProviderViews, aiStatus, ChatStreams, configureAI, providerModels, removeProviderKey, sanitizeChatMessages, setProviderKey, testProvider, type ChatDelta } from './service'
import { jsonReply, mockFetch, MockChatModel, sseReply, step, testDeps, type MockReply, type RecordedRequest } from './testing/mocks'
import type { RpcErrorInfo } from '@shared/ipc'

const KEY = 'sk-test-1234567890abcdefXYZ'
const chatOK = 'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n'
const offline = { networkError: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }

function net(other: (r: RecordedRequest) => MockReply = () => sseReply(chatOK)) {
  return mockFetch((r) => (r.url.startsWith('http://localhost') && r.method === 'GET' ? offline : other(r)))
}

let root: string
let meter: CostMeter
beforeEach(() => {
  setAILocale('es')
  root = mkdtempSync(join(tmpdir(), 'aula-ai-service-'))
  setDataRoot(root)
  resetSettingsCache()
  clearCatalogMemory()
  invalidateAvailability()
  meter = new CostMeter({ ledger: new CostLedger(null), prices: new PriceBook(null), settings: defaultSpending })
  setCostMeter(meter)
})
afterEach(() => {
  setCostMeter(null)
  resetSettingsCache()
  rmSync(root, { recursive: true, force: true })
})

describe('estado y lista', () => {
  it('sin nada: no está lista y dice por qué', async () => {
    const st = await aiStatus({ deps: testDeps(net().fetch) })
    expect(st).toMatchObject({ activeProvider: null, auto: true, resolved: null, ready: false })
    expect(st.problem?.code).toBe('ai_no_provider')
  })
  it('las vistas nunca llevan la clave', async () => {
    const deps = testDeps(net().fetch, { 'ai.key.deepseek': KEY })
    const views = await aiProviderViews({ deps })
    expect(JSON.stringify(views)).not.toContain(KEY)
    const ds = views.find((v) => v.id === 'deepseek')!
    expect(ds).toMatchObject({ hasKey: true, keyHint: 'sk-…fXYZ', needsKey: true, available: true, active: true, billing: 'perToken', configured: true, group: 'api' })
    expect(ds.help).toContain('platform.deepseek.com')
    expect(ds.reasoningOptions.map((o) => o.value)).toEqual(['auto', 'none', 'low', 'high', 'max'])
    expect(views.find((v) => v.id === 'ollama')).toMatchObject({ billing: 'local', needsKey: false, available: false })
    expect(views.find((v) => v.id === 'claude-cli')).toMatchObject({ supported: false, billing: 'subscription' })
    const st = await aiStatus({ deps })
    expect(st).toMatchObject({ ready: true, resolved: { providerId: 'deepseek', model: 'deepseek-flash', kind: 'openai-compatible' } })
  })
})

describe('claves', () => {
  it('se guardan limpias en el almacén de secretos y se pueden quitar', async () => {
    const deps = testDeps(net().fetch)
    const views = await setProviderKey('openai', `  "Bearer ${KEY}"\n`, { deps })
    expect(deps.secretsStore.get('ai.key.openai')).toBe(KEY)
    expect(views.find((v) => v.id === 'openai')).toMatchObject({ hasKey: true, keyHint: 'sk-…fXYZ' })
    const after = await removeProviderKey('openai', { deps })
    expect(deps.secretsStore.get('ai.key.openai')).toBeNull()
    expect(after.find((v) => v.id === 'openai')!.hasKey).toBe(false)
  })
  it('valida: proveedor desconocido, sin clave propia, vacía o con caracteres no válidos', async () => {
    const deps = testDeps(net().fetch)
    await expect(setProviderKey('no-existe', KEY, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(setProviderKey('claude-cli', KEY, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(setProviderKey('openai', '   ', { deps })).rejects.toMatchObject({ code: 'ai_missing_key' })
    await expect(setProviderKey('openai', 'sk-abc def', { deps })).rejects.toThrow(/no válidos/)
    await expect(setProviderKey('openai', 42, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
  })
})

describe('configurar', () => {
  it('elegir proveedor, modelo y razonamiento; volver a automático', async () => {
    const deps = testDeps(net().fetch, { 'ai.key.deepseek': KEY, 'ai.key.anthropic': 'sk-ant-1234567890abcdef' })
    let st = await configureAI({ providerId: 'deepseek', model: 'deepseek-v4-pro', reasoning: 'high' }, { deps })
    expect(st).toMatchObject({ activeProvider: 'deepseek', auto: false, ready: true, resolved: { providerId: 'deepseek', model: 'deepseek-v4-pro' } })
    expect(getSettings().ai.providers).toEqual([{ id: 'deepseek', kind: 'openai-compatible', label: 'DeepSeek', model: 'deepseek-v4-pro', reasoning: 'high' }])
    st = await configureAI({ providerId: 'deepseek', model: '' }, { deps })
    expect(st.resolved?.model).toBe('deepseek-flash')
    st = await configureAI({ providerId: null }, { deps })
    expect(st).toMatchObject({ activeProvider: null, auto: true, resolved: { providerId: 'anthropic' } })
  })
  it('proveedores personalizados (custom-…) con su dirección', async () => {
    const deps = testDeps(net().fetch)
    const st = await configureAI({ providerId: 'custom-mio', baseURL: 'http://localhost:8080/v1', model: 'qwen3', label: 'Mi servidor' }, { deps })
    expect(st.resolved).toMatchObject({ providerId: 'custom-mio', label: 'Mi servidor', model: 'qwen3' })
    expect(getSettings().ai.providers[0]).toMatchObject({ id: 'custom-mio', kind: 'openai-compatible', baseURL: 'http://localhost:8080/v1' })
  })
  it('valida los argumentos', async () => {
    const deps = testDeps(net().fetch)
    await expect(configureAI(null, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(configureAI({ providerId: 'inventado' }, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(configureAI({ providerId: 'deepseek', reasoning: 'muchísimo' }, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(configureAI({ providerId: 'custom-x', baseURL: 'ftp://nada' }, { deps })).rejects.toMatchObject({ code: 'ai_bad_url' })
    await expect(configureAI({ providerId: 'deepseek', enabled: 'sí' }, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
  })
  it('activate: false cambia el modelo sin cambiar el proveedor activo', async () => {
    const deps = testDeps(net().fetch)
    updateSettings({ ai: { activeProvider: 'openai' } })
    await configureAI({ providerId: 'deepseek', model: 'deepseek-v4-pro', activate: false }, { deps })
    expect(getSettings().ai.activeProvider).toBe('openai')
  })
  it('el preset personalizado: https, o http solo en este ordenador; la URL se guarda limpia', async () => {
    const deps = testDeps(net().fetch)
    await expect(configureAI({ providerId: 'custom', baseURL: 'http://api.example.com/v1', model: 'm' }, { deps })).rejects.toMatchObject({ code: 'ai_bad_url' })
    await expect(configureAI({ providerId: 'custom-x', baseURL: 'http://192.168.1.5:8000/v1' }, { deps })).rejects.toMatchObject({ code: 'ai_bad_url' })
    await expect(configureAI({ providerId: 'custom', baseURL: 'https://u:p@api.example.com/v1' }, { deps })).rejects.toMatchObject({ code: 'ai_bad_url' })
    expect(getSettings().ai.activeProvider).toBeNull()
    const st = await configureAI({ providerId: 'custom', baseURL: 'https://api.together.xyz/v1/', model: 'meta-llama/Llama-4', key: KEY }, { deps })
    expect(deps.secretsStore.get('ai.key.custom')).toBe(KEY)
    expect(st).toMatchObject({ activeProvider: 'custom', ready: true, resolved: { providerId: 'custom', model: 'meta-llama/Llama-4' } })
    expect(getSettings().ai.providers[0]).toMatchObject({ id: 'custom', baseURL: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-4' })
    const view = (await aiProviderViews({ deps })).find((v) => v.id === 'custom')!
    expect(view).toMatchObject({ baseURL: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-4', hasKey: true, available: true, billing: 'perToken' })
    expect(view.models).toBeUndefined()
  })
})

describe('configurar · la dirección y la clave', () => {
  it('ningún proveedor acepta http:// fuera de este ordenador (la clave guardada no sale sin cifrar)', async () => {
    const deps = testDeps(net().fetch, { 'ai.key.anthropic': 'sk-ant-1234567890abcdef' })
    for (const providerId of ['anthropic', 'openai', 'deepseek', 'ollama', 'lmstudio', 'custom-x']) {
      await expect(configureAI({ providerId, baseURL: 'http://evil.example/v1', activate: false }, { deps })).rejects.toMatchObject({ code: 'ai_bad_url' })
    }
    await expect(configureAI({ providerId: 'ollama', baseURL: 'http://192.168.1.5:11434/v1', activate: false }, { deps })).rejects.toMatchObject({ code: 'ai_bad_url' })
    expect(getSettings().ai.providers).toEqual([])
    expect(deps.secretsStore.get('ai.key.anthropic')).toBe('sk-ant-1234567890abcdef')
    // en este ordenador, sí
    await configureAI({ providerId: 'ollama', baseURL: 'http://127.0.0.1:11500/v1', activate: false }, { deps })
    expect(getSettings().ai.providers[0]).toMatchObject({ id: 'ollama', baseURL: 'http://127.0.0.1:11500/v1' })
  })

  it('si la dirección cambia de servidor, la clave guardada se borra (la nueva puede venir en la misma llamada)', async () => {
    const ANT = 'sk-ant-1234567890abcdef'
    const deps = testDeps(net().fetch, { 'ai.key.anthropic': ANT })
    // mismo servidor (otra ruta): la clave sigue
    await configureAI({ providerId: 'anthropic', baseURL: 'https://api.anthropic.com/v1', activate: false }, { deps })
    expect(deps.secretsStore.get('ai.key.anthropic')).toBe(ANT)
    // otro servidor: se borra antes de guardar la dirección
    await configureAI({ providerId: 'anthropic', baseURL: 'https://evil.example/v1', activate: false }, { deps })
    expect(deps.secretsStore.get('ai.key.anthropic')).toBeNull()
    expect((await aiProviderViews({ deps })).find((v) => v.id === 'anthropic')).toMatchObject({ hasKey: false, baseURL: 'https://evil.example/v1' })
    // volver a la del preset también es otro servidor; con la clave en la misma llamada queda guardada
    await configureAI({ providerId: 'anthropic', baseURL: '', key: ANT, activate: false }, { deps })
    expect(deps.secretsStore.get('ai.key.anthropic')).toBe(ANT)
    expect(getSettings().ai.providers[0].baseURL).toBeUndefined()
    // cambiar solo el modelo no toca la clave
    await configureAI({ providerId: 'anthropic', model: 'claude-x', activate: false }, { deps })
    expect(deps.secretsStore.get('ai.key.anthropic')).toBe(ANT)
  })

  it('la clave de la misma llamada se valida y solo vale para proveedores con clave', async () => {
    const deps = testDeps(net().fetch)
    await expect(configureAI({ providerId: 'custom', baseURL: 'https://api.example.com/v1', key: 'sk-abc def' }, { deps })).rejects.toMatchObject({ code: 'ai_missing_key' })
    await expect(configureAI({ providerId: 'custom', baseURL: 'https://api.example.com/v1', key: 42 }, { deps })).rejects.toMatchObject({ code: 'ai_missing_key' })
    expect(getSettings().ai.providers).toEqual([])
    await expect(configureAI({ providerId: 'ollama', key: KEY }, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
  })
})

describe('modelos para elegir', () => {
  it('los presets con varios modelos conocidos los ofrecen, con el recomendado primero', async () => {
    const deps = testDeps(net().fetch, { 'ai.key.openai': KEY })
    const views = await aiProviderViews({ deps })
    const openai = views.find((v) => v.id === 'openai')!
    expect(openai.defaultModel).toBe('gpt-6-sol')
    expect(openai.model).toBe('gpt-6-sol')
    expect(openai.models?.[0]).toEqual({ id: 'gpt-6-sol', label: 'GPT-6 Sol' })
    expect(openai.models?.map((m) => m.id)).toContain('gpt-6-astra')
    // un solo modelo o sin lista (xAI, las CLIs, los locales): nada que elegir aquí
    expect(views.find((v) => v.id === 'xai')?.models).toBeUndefined()
    expect(views.find((v) => v.id === 'claude-cli')?.models).toBeUndefined()
    expect(views.find((v) => v.id === 'ollama')?.models).toBeUndefined()
  })
  it('el modelo elegido aparece aunque no sea de la lista', async () => {
    const deps = testDeps(net().fetch, { 'ai.key.mistral': KEY })
    await configureAI({ providerId: 'mistral', model: 'codestral-latest', activate: false }, { deps })
    const mistral = (await aiProviderViews({ deps })).find((v) => v.id === 'mistral')!
    expect(mistral.model).toBe('codestral-latest')
    expect(mistral.models?.at(-1)).toEqual({ id: 'codestral-latest', label: 'codestral-latest' })
    expect(mistral.models?.[0].id).toBe('mistral-medium-latest')
  })
})

describe('modelos y prueba de conexión', () => {
  it('ai.models: el catálogo en vivo y aprende los precios publicados', async () => {
    const mf = net((r) => (r.url.endsWith('/models') || r.url.includes('/models?')
      ? jsonReply({ data: [{ id: 'deepseek/deepseek-v4.1-flash', pricing: { prompt: '0.0000002', completion: '0.0000008' }, supported_parameters: ['tools'] }] })
      : sseReply(chatOK)))
    const deps = testDeps(mf.fetch, { 'ai.key.openrouter': 'sk-or-1234567890abcdef' })
    const c = await providerModels('openrouter', false, { deps })
    expect(c.source).toBe('api')
    expect(c.models[0].id).toBe('deepseek/deepseek-v4.1-flash')
    const q = meter.quote({ id: 'openrouter', kind: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1' }, 'deepseek/deepseek-v4.1-flash')
    expect(q.source).toBe('live')
    await expect(providerModels('nada', false, { deps })).rejects.toMatchObject({ code: 'invalid_args' })
  })
  it('ai.test: lista, prueba y responde; sin clave, needsKey; con 401, needsKey con el motivo', async () => {
    const mf = net((r) => (r.method === 'GET' ? jsonReply({ data: [{ id: 'deepseek-flash' }] }) : sseReply(chatOK)))
    const ok = await testProvider('deepseek', { deps: testDeps(mf.fetch, { 'ai.key.deepseek': KEY }) })
    expect(ok).toMatchObject({ state: 'ready', models: ['deepseek-flash'], answer: 'OK' })
    expect(ok.message).toContain('deepseek-flash')
    expect((await testProvider('deepseek', { deps: testDeps(mf.fetch) })).state).toBe('needsKey')
    const bad = await testProvider('deepseek', { deps: testDeps(mockFetch([jsonReply('{"error":{"message":"Authentication Fails"}}', 401)]).fetch, { 'ai.key.deepseek': KEY }) })
    expect(bad.state).toBe('needsKey')
    expect(bad.message).toContain('Authentication Fails')
    const unsupported = await testProvider('claude-cli', { deps: testDeps(mf.fetch) })
    expect(unsupported.state).toBe('error')
  })
  it('ai.test: un servicio que no lista modelos (404) se prueba igual', async () => {
    const mf = mockFetch((r) => (r.method === 'GET' ? jsonReply('{}', 404) : sseReply(chatOK)))
    const r = await testProvider('deepseek', { deps: testDeps(mf.fetch, { 'ai.key.deepseek': KEY }) })
    expect(r).toMatchObject({ state: 'ready', models: [], answer: 'OK' })
  })
})

describe('chat con streaming', () => {
  interface Sink { deltas: ChatDelta[]; done: AIChatDone[]; errors: { requestId: string; error: RpcErrorInfo }[] }
  const sink = (): Sink & { delta: (d: ChatDelta) => void; doneFn: (d: AIChatDone) => void } => {
    const s: Sink = { deltas: [], done: [], errors: [] }
    return Object.assign(s, { delta: (d: ChatDelta) => s.deltas.push(d), doneFn: (d: AIChatDone) => s.done.push(d) })
  }
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  }

  it('fragmentos agrupados y fin con el texto, el razonamiento y el uso', async () => {
    const model = new MockChatModel([step({ text: 'Hola, ¿qué tal?', reasoning: 'saludo', chunk: 3 })])
    const streams = new ChatStreams(async () => model)
    const s = sink()
    const r = await streams.start({ requestId: 'r1', system: 'Eres Aula.', messages: [{ role: 'user', content: 'hola' }] }, { delta: s.delta, done: s.doneFn, error: (e) => s.errors.push(e) })
    expect(r).toEqual({ requestId: 'r1' })
    await waitFor(() => s.done.length > 0)
    expect(s.done[0]).toMatchObject({ requestId: 'r1', text: 'Hola, ¿qué tal?', reasoning: 'saludo', finish: 'stop', usage: { promptTokens: 10, completionTokens: 5 } })
    expect(s.deltas.map((d) => d.text ?? '').join('')).toBe('Hola, ¿qué tal?')
    expect(s.deltas.length).toBeLessThan(6)
    expect(model.requests[0].messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(streams.size).toBe(0)
  })
  it('cancelar termina con cancelled: true (no es un error)', async () => {
    const model = new MockChatModel([{ hang: true }])
    const streams = new ChatStreams(async () => model)
    const s = sink()
    await streams.start({ requestId: 'r2', messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }] }, { delta: s.delta, done: s.doneFn, error: (e) => s.errors.push(e) })
    expect(streams.cancel('r2')).toBe(true)
    await waitFor(() => s.done.length > 0)
    expect(s.done[0]).toMatchObject({ requestId: 'r2', cancelled: true })
    expect(s.errors).toEqual([])
    expect(streams.cancel('r2')).toBe(false)
  })
  it('los errores del proveedor llegan por ai.error con su código; los de configuración rechazan al empezar', async () => {
    const { AIError } = await import('./errors')
    const failing = new ChatStreams(async () => new MockChatModel([{ fail: new AIError('rateLimited', 'Espera un poco.', { status: 429, retryAfter: 5 }) }]))
    const s = sink()
    await failing.start({ requestId: 'r3', messages: [{ role: 'user', content: 'x' }] }, { delta: s.delta, done: s.doneFn, error: (e) => s.errors.push(e) })
    await waitFor(() => s.errors.length > 0)
    expect(s.errors[0]).toMatchObject({ requestId: 'r3', error: { code: 'ai_rate_limit', message: 'Espera un poco.', details: { retryAfter: 5 } } })
    const noAI = new ChatStreams(async () => {
      throw new AIError('other', 'No hay ninguna IA.', { code: 'ai_no_provider' })
    })
    await expect(noAI.start({ requestId: 'r4', messages: [{ role: 'user', content: 'x' }] }, { delta: s.delta, done: s.doneFn, error: () => {} })).rejects.toMatchObject({ code: 'ai_no_provider' })
    expect(noAI.size).toBe(0)
  })
  it('el uso se atribuye al chat (o al uso indicado) en el libro de costes', async () => {
    const { meteredModel } = await import('../costs')
    const streams = new ChatStreams(async () => meteredModel(new MockChatModel([step({ text: 'ok' })]), { id: 'deepseek', kind: 'openai-compatible', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash' }, meter))
    const s = sink()
    await streams.start({ requestId: 'r5', purpose: 'tutor', courseID: 'bio', messages: [{ role: 'user', content: 'x' }] }, { delta: s.delta, done: s.doneFn, error: () => {} })
    await waitFor(() => s.done.length > 0)
    expect(meter.ledger.recent(1)[0]).toMatchObject({ purpose: 'tutor', courseID: 'bio' })
  })
  it('valida la petición y los mensajes', async () => {
    const streams = new ChatStreams(async () => new MockChatModel([step({ text: 'ok' })]))
    const noop = { delta: () => {}, done: () => {}, error: () => {} }
    await expect(streams.start({ messages: [{ role: 'user', content: 'x' }] }, noop)).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(streams.start({ requestId: 'a b', messages: [{ role: 'user', content: 'x' }] }, noop)).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(streams.start({ requestId: 'ok', messages: [] }, noop)).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(streams.start({ requestId: 'ok', messages: [{ role: 'tool', content: 'x' }] }, noop)).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(streams.start({ requestId: 'ok', purpose: 'raro', messages: [{ role: 'user', content: 'x' }] }, noop)).rejects.toMatchObject({ code: 'invalid_args' })
    expect(() => sanitizeChatMessages([{ role: 'user', content: [{ type: 'image', image: { mediaType: 'image/svg+xml', base64: 'x' } }] }])).toThrow()
    expect(sanitizeChatMessages([{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image', image: { mediaType: 'image/png', base64: 'QQ==' } }], toolCalls: [{ id: 'x' }] }]))
      .toEqual([{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image', image: { mediaType: 'image/png', base64: 'QQ==' } }] }])
  })
})
