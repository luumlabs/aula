// Port de Tests/AIKitTests/AIProvidersFixTests.swift (AIP-03…AIP-15): razonamiento de Claude, capacidades de la API, historial
// recortado, OpenRouter sin clave y sin proveedores, esfuerzo rechazado, escrituras de caché, niveles de GPT-5.5 y claves.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { knownReasoningCapabilities, supportsAdaptiveThinking } from '@shared/ai/reasoning'
import { validateAPIKey, maskAPIKey, cleanAPIKey } from '@shared/ai/apiKey'
import { msg, normalizeUsage, addUsage, emptyUsage, fingerprint } from '@shared/ai/types'
import { parseModelInfos, fetchModelCatalog } from '../catalog/catalogs'
import { runToolLoop } from '../loop/toolLoop'
import { MockChatModel, jsonReply, mockFetch, sseReply, step, testDeps } from '../testing/mocks'
import { AnthropicStreamDecoder } from './anthropicDecoder'
import { anthropicBody, checksReplayPrefix } from './anthropicRequest'
import { AnthropicModel } from './anthropic'
import type { ProviderConfig } from './config'
import { ThinkingVault } from './memory'
import { OpenAICompatibleModel } from './openai'
import { parseOpenAIUsage } from './openaiDecoder'
import { chatBody, detectQuirks } from './openaiRequest'
import { configFromPreset, presetById } from '../presets'

const KEY = 'sk-test-1234567890abcdefXYZ'
const ev = (name: string, json: string) => `event: ${name}\ndata: ${json}\n\n`
const anthropicOK = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}')
  + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
  + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}')
  + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}') + ev('message_stop', '{"type":"message_stop"}')
const chatOK = 'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

const claude = (model: string, o: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'anthropic', kind: 'anthropic', label: 'Claude', baseURL: 'https://api.anthropic.com', model, secretRef: 'k', extraHeaders: {},
  supportsTools: true, supportsVision: true, supportsStreaming: true, supportsJSONMode: false, enabled: true, ...o
})
const preset = (id: string) => configFromPreset(presetById(id)!, presetById(id)!.label.es)

beforeEach(() => setAILocale('es'))

describe('Claude: pensar de verdad y ver el resumen (AIP-03)', () => {
  const body = (model: string, reasoning?: string, temperature?: number) =>
    anthropicBody(claude(model, reasoning ? { reasoning } : {}), { model: '', messages: [msg.user('Hola')], temperature }, { stream: true, vault: new ThinkingVault() })
  it('razonamiento adaptativo con resumen donde el modelo lo acepta', () => {
    for (const m of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      const b = body(m)
      expect(b.thinking, m).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(b.output_config, m).toBeUndefined()
    }
    const max = body('claude-opus-4-8', 'max')
    expect(max.thinking).toMatchObject({ type: 'adaptive' })
    expect(max.output_config).toEqual({ effort: 'max' })
    expect(body('claude-opus-4-5').thinking).toBeUndefined()
    expect(body('claude-3-7-desconocido').thinking).toBeUndefined()
    expect(body('claude-sonnet-4-6', undefined, 0.4).temperature).toBeUndefined()
  })
  it('si el servidor rechaza el modo adaptativo, se repite sin thinking y sin tocar el esfuerzo', async () => {
    const mf = mockFetch([jsonReply('{"type":"error","error":{"type":"invalid_request_error","message":"adaptive thinking is not supported on this model. Use \\"thinking.type.enabled\\" and \\"output_config.effort\\"."}}', 400), sseReply(anthropicOK)])
    const cfg = claude('claude-opus-4-8', { reasoning: 'high', reasoningCapabilitiesByModel: { 'claude-opus-4-8': { efforts: ['low', 'high'], thinkingTypes: ['adaptive'] } } })
    await new AnthropicModel(cfg, testDeps(mf.fetch, { k: KEY })).complete({ messages: [msg.user('Hola')] })
    expect(mf.requests).toHaveLength(2)
    expect((mf.requests[0].body as Record<string, unknown>).thinking).toBeDefined()
    expect((mf.requests[1].body as Record<string, unknown>).thinking).toBeUndefined()
    expect((mf.requests[1].body as Record<string, unknown>).output_config).toEqual({ effort: 'high' })
  })
  it('el resumen del razonamiento llega al bucle como «reasoning»', async () => {
    const s = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Primero factorizo."}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}')
      + ev('content_block_start', '{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"21"}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}') + ev('message_stop', '{"type":"message_stop"}')
    const mf = mockFetch([sseReply(s)])
    let reasoning = ''
    const r = await runToolLoop({ model: new AnthropicModel(claude('claude-opus-4-8'), testDeps(mf.fetch, { k: KEY })), prompt: '¿mcd de 1071 y 462?', timeoutSec: 10,
      onEvent: (e) => e.type === 'reasoning' && (reasoning += e.text) })
    expect(reasoning).toBe('Primero factorizo.')
    expect(r.text).toBe('21')
  })
})

describe('capacidades publicadas y razonamiento reenviado (AIP-09, AIP-11)', () => {
  it('las capacidades de GET /v1/models mandan y se usan al enviar', () => {
    const infos = parseModelInfos(JSON.parse(`{"data":[{"id":"claude-nuevo-6","display_name":"Claude Nuevo 6","capabilities":{
      "effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":null,"max":{"supported":true}},
      "thinking":{"supported":true,"types":{"adaptive":{"supported":true},"enabled":{"supported":false},"disabled":{"supported":true}}},
      "image_input":{"supported":true}}},
      {"id":"claude-sin-esfuerzo","capabilities":{"effort":{"supported":false},"thinking":{"supported":false,"types":{}}}}]}`))
    expect(infos[0].reasoningCapabilities).toEqual({ efforts: ['low', 'medium', 'high', 'max'], thinkingTypes: ['adaptive', 'disabled'] })
    expect(infos[1].reasoningCapabilities?.efforts).toEqual([])
    expect(supportsAdaptiveThinking(infos[1].reasoningCapabilities)).toBe(false)
    const cfg = claude('claude-nuevo-6', { reasoning: 'max', reasoningCapabilitiesByModel: { 'claude-nuevo-6': infos[0].reasoningCapabilities! } })
    const b = anthropicBody(cfg, { model: '', messages: [msg.user('Hola')] }, { stream: true, vault: new ThinkingVault() })
    expect(b.thinking).toMatchObject({ type: 'adaptive' })
    expect(b.output_config).toEqual({ effort: 'max' })
  })
  it('al recortar el historial solo se olvida el razonamiento donde fallaría', () => {
    const vault = new ThinkingVault()
    vault.store([{ type: 'thinking', text: 't', signature: 's' }, { type: 'toolUse', id: 'toolu_1' }])
    const model = new AnthropicModel(claude('claude-opus-4-8'), { vault, secrets: testDeps(mockFetch([]).fetch).secrets })
    model.historyWasEdited(['toolu_1'], 'claude-opus-4-8')
    expect(vault.lookup('toolu_1')).toBeDefined()
    model.historyWasEdited(['toolu_1'], 'claude-opus-5-5')
    expect(vault.lookup('toolu_1')).toBeUndefined()
    expect(checksReplayPrefix('claude-sonnet-5-5-20260901')).toBe(true)
    expect(checksReplayPrefix('claude-sonnet-5')).toBe(false)
  })
  it('el bucle avisa al proveedor cuando recorta', async () => {
    const big = 'dato '.repeat(4000)
    const m = new MockChatModel([step({ calls: [{ id: 'c1', name: 'eco', args: '{}' }] }), step({ calls: [{ id: 'c2', name: 'eco', args: '{}' }] }),
      step({ calls: [{ id: 'c3', name: 'eco', args: '{}' }] }), step({ text: 'Listo' })], { contextWindow: 8000 })
    await runToolLoop({ model: m, prompt: 'x', timeoutSec: 10, sleep: async () => {}, tools: [{ name: 'eco', description: 'x', inputSchema: {}, run: () => big }] })
    expect(m.edited.length).toBeGreaterThan(0)
  })
})

describe('OpenRouter (AIP-04, AIP-05)', () => {
  const models = '{"data":[{"id":"z-ai/glm-5.3","name":"GLM 5.3","supported_parameters":["tools"],"pricing":{"prompt":"0.000001","completion":"0.000002"}},{"id":"qwen/qwen3.8:free","name":"Qwen3.8 (free)","supported_parameters":["tools"],"pricing":{"prompt":"0","completion":"0"}}]}'
  it('la lista y los Top 10 se ven sin clave', async () => {
    const mf = mockFetch([jsonReply(models)])
    const c = await fetchModelCatalog(preset('openrouter'), testDeps(mf.fetch))
    expect(c.source).toBe('api')
    expect(c.free).not.toEqual([])
    expect(c.popular).not.toEqual([])
    expect(mf.requests.every((r) => r.headers.authorization === undefined)).toBe(true)
  })
  it('elegir esfuerzo no exige que el proveedor admita todos los parámetros', () => {
    const router = { ...preset('openrouter'), reasoning: 'high' }
    router.reasoningCapabilitiesByModel = { [router.model]: { efforts: ['low', 'high'] } }
    const b = chatBody(router, { model: '', messages: [msg.user('Hola')] }, true, detectQuirks(router))
    expect(b.reasoning).toEqual({ effort: 'high' })
    expect(b.provider).toBeUndefined()
  })
  it('404 «No endpoints found»: se repite sin `provider`; si sigue, un mensaje propio', async () => {
    const noEndpoints = jsonReply('{"error":{"message":"No endpoints found that support the requested parameters","code":404}}', 404)
    const cfg = { ...preset('openrouter'), model: 'solo/un-proveedor' }
    const mf = mockFetch([noEndpoints, sseReply(chatOK)])
    await new OpenAICompatibleModel(cfg, testDeps(mf.fetch, { [cfg.secretRef!]: KEY })).complete({ messages: [msg.user('Hola')], timeoutSec: 10, extraBody: { provider: { only: ['x'] } } })
    expect(mf.requests).toHaveLength(2)
    expect((mf.requests[1].body as Record<string, unknown>).provider).toBeUndefined()
    const always = mockFetch([noEndpoints])
    const e = await new OpenAICompatibleModel(cfg, testDeps(always.fetch, { [cfg.secretRef!]: KEY })).complete({ messages: [msg.user('Hola')], timeoutSec: 10 }).catch((x) => x)
    expect(e.status).toBe(404)
    expect(e.message).toContain('ningún proveedor')
    expect(e.message).not.toContain('Revisa el nombre del modelo')
  })
})

describe('esfuerzo, uso y niveles (AIP-07, AIP-08, AIP-10, AIP-15)', () => {
  it('un esfuerzo rechazado se explica con el nivel, el modelo y dónde cambiarlo', async () => {
    const cfg = { ...preset('anthropic'), reasoning: 'high' }
    const mf = mockFetch([jsonReply('{"error":{"message":"output_config.effort: unsupported value"}}', 400)])
    const e = await new AnthropicModel(cfg, testDeps(mf.fetch, { [cfg.secretRef!]: KEY })).complete({ messages: [msg.user('Hola')], timeoutSec: 10 }).catch((x) => x)
    expect(mf.requests).toHaveLength(1)
    expect(e.message).toContain('«Alto»')
    expect(e.message).toContain('Ajustes → Tu IA')
    expect(e.status).toBe(400)
  })
  it('escrituras de caché aparte, compatibles con los datos viejos', () => {
    const old = normalizeUsage({ promptTokens: 10, completionTokens: 2, reasoningTokens: 0, cachedTokens: 4 })
    expect(old.cacheWriteTokens).toBe(0)
    expect(addUsage({ ...emptyUsage(), cacheWriteTokens: 2 }, { ...emptyUsage(), cacheWriteTokens: 5 }).cacheWriteTokens).toBe(7)
    expect(parseOpenAIUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 } })?.cacheWriteTokens).toBe(30)
    const d = new AnthropicStreamDecoder({ provider: 'Claude', model: 'm' }, new ThinkingVault())
    d.handle({ event: 'message_start', data: '{"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":40,"cache_creation_input_tokens":50,"output_tokens":1}}}' })
    d.handle({ event: 'message_stop', data: '{"type":"message_stop"}' })
    const usage = d.finishStream().flatMap((e) => (e.type === 'usage' ? [e.usage] : []))[0]
    expect(usage).toMatchObject({ promptTokens: 100, cachedTokens: 40, cacheWriteTokens: 50 })
  })
  it('GPT-5.5: «Sin razonamiento» y «medio» por defecto; capacidades conocidas por host', () => {
    expect(knownReasoningCapabilities('gpt-5.5', { kind: 'openai-compatible', baseURL: 'https://api.openai.com/v1' })).toEqual({ efforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' })
    expect(knownReasoningCapabilities('gpt-5.5', { kind: 'openai-compatible', baseURL: 'https://gw.example.com/v1' })).toBeUndefined()
    expect(knownReasoningCapabilities('deepseek-flash', { kind: 'openai-compatible', baseURL: 'https://api.deepseek.com' })?.efforts).toEqual(['none', 'low', 'high', 'max'])
    expect(knownReasoningCapabilities('mimo-v2.6-flash', { kind: 'openai-compatible', baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1' })?.efforts).toEqual(['none', 'enabled'])
    expect(knownReasoningCapabilities('sonnet', { kind: 'claude-cli' })?.efforts).toContain('max')
    expect(knownReasoningCapabilities('gpt-6-sol', { kind: 'codex-cli' })).toBeUndefined()
    expect(knownReasoningCapabilities('claude-opus-5-5-20260901', { kind: 'anthropic', baseURL: 'https://api.anthropic.com' })?.defaultEffort).toBe('medium')
    expect(knownReasoningCapabilities('claude-opus-5-5x', { kind: 'anthropic', baseURL: 'https://api.anthropic.com' })).toBeUndefined()
  })
  it('la misma limpieza y validación de la clave al guardar y al usarla', () => {
    expect(validateAPIKey('  "Bearer sk-abc123"\n')).toEqual({ ok: true, key: 'sk-abc123' })
    expect(validateAPIKey('“sk-abc”')).toEqual({ ok: true, key: 'sk-abc' })
    expect(validateAPIKey('sk-abc 123')).toEqual({ ok: false, problem: 'invalidCharacters' })
    expect(validateAPIKey('sk-abc…')).toEqual({ ok: false, problem: 'invalidCharacters' })
    expect(validateAPIKey('  "" ')).toEqual({ ok: false, problem: 'empty' })
    expect(cleanAPIKey('bearer  xyz ')).toBe('xyz')
    expect(maskAPIKey(KEY)).toBe('sk-…fXYZ')
    expect(maskAPIKey('corta')).toBe('••••')
    expect(maskAPIKey('AIzaSyA-1234567890abcdefghijk')).toBe('…hijk')
  })
  it('huella estable de los textos (clave de caché sin enviar el contenido)', () => {
    expect(fingerprint(['a', 'b'])).toBe(fingerprint(['a', 'b']))
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']))
    expect(fingerprint(['x'])).toMatch(/^[0-9a-f]+$/)
  })
})
