// Port de Tests/AIKitTests/AnthropicTests.swift: cuerpo de `POST /v1/messages`, razonamiento firmado (ThinkingVault), streaming,
// errores, compatibilidad automática, lista de modelos y prueba de conexión.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { msg, type ChatMessage, type ChatRequest, type ToolCall, type ToolSpec } from '@shared/ai/types'
import type { JSONObject, JSONValue } from '@shared/ai/json'
import { AIError, isContextLengthError } from '../errors'
import { canonicalJSON } from '../core/json'
import { Fixtures } from '../testing/fixtures'
import { collect, digest, jsonReply, line, mockFetch, sseHeaders, sseReply, testDeps, type MockReply } from '../testing/mocks'
import type { ProviderConfig } from './config'
import { ThinkingVault } from './memory'
import { anthropicBody, sanitizeToolID } from './anthropicRequest'
import { CACHEABLE_PREFIX_MIN_CHARS } from './openaiRequest'
import { AnthropicModel, anthropicListModels, anthropicPing } from './anthropic'

const TEST_KEY = 'sk-test-1234567890abcdefXYZ'

function config(o: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'anthropic-test', kind: 'anthropic', label: 'Anthropic de prueba', baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', secretRef: 'test-key',
    extraHeaders: {}, supportsTools: true, supportsVision: true, supportsStreaming: true, supportsJSONMode: false, enabled: true, ...o
  }
}

const weatherTool: ToolSpec = {
  name: 'get_weather', description: 'Clima de una ciudad',
  inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'Ciudad' } }, required: ['city'], additionalProperties: false }
}
const simple = (o: Partial<ChatRequest> = {}): ChatRequest => ({ model: '', messages: [msg.user('Hola')], timeoutSec: 20, ...o })
const ev = (name: string, json: string) => `event: ${name}\ndata: ${json}\n\n`

type Body = Record<string, JSONValue>
function body(r: ChatRequest, c: ProviderConfig = config({ model: 'm' }), o: { stream?: boolean; replay?: boolean; caching?: boolean; vault?: ThinkingVault } = {}): Body {
  const req = { ...r, cache: { ...(r.cache ?? {}), reuseTail: o.caching ?? false } }
  return anthropicBody(c, req, { stream: o.stream ?? true, replayThinking: o.replay ?? true, vault: o.vault ?? new ThinkingVault() }) as Body
}
const at = (v: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((cur, p) => (cur as Record<string | number, unknown> | undefined)?.[p], v)

beforeEach(() => setAILocale('es'))

describe('cuerpo de la petición', () => {
  it('mínimo (con razonamiento adaptativo visible en Sonnet 5.5)', () => {
    expect(body({ model: '', messages: [msg.system('Eres tutor.'), msg.user('Hola')] }, config())).toEqual({
      model: 'claude-sonnet-5-5', max_tokens: 8192, stream: true, system: 'Eres tutor.', thinking: { type: 'adaptive', display: 'summarized' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hola' }] }]
    })
  })
  it('cadena «golden» determinista', () => {
    expect(canonicalJSON(body({ model: 'm', messages: [msg.user('U')], tools: [weatherTool], temperature: 0.5, maxTokens: 1000 })))
      .toBe('{"max_tokens":1000,"messages":[{"content":[{"text":"U","type":"text"}],"role":"user"}],"model":"m","stream":true,"temperature":0.5,"tools":[{"description":"Clima de una ciudad","input_schema":{"additionalProperties":false,"properties":{"city":{"description":"Ciudad","type":"string"}},"required":["city"],"type":"object"},"name":"get_weather"}]}')
  })
  it('max_tokens: petición > configuración > 8192', () => {
    expect(body(simple()).max_tokens).toBe(8192)
    expect(body(simple(), config({ model: 'm', maxOutputTokens: 32000 })).max_tokens).toBe(32000)
    expect(body({ model: 'm', messages: [msg.user('x')], maxTokens: 99 }, config({ model: 'm', maxOutputTokens: 32000 })).max_tokens).toBe(99)
  })
  it('sistemas unidos; los largos (y las herramientas) se cachean', () => {
    expect(body({ model: 'm', messages: [msg.system('A'), msg.system(''), msg.system('B'), msg.user('x')] }).system).toBe('A\n\nB')
    const long = 'x'.repeat(CACHEABLE_PREFIX_MIN_CHARS)
    expect(body({ model: 'm', messages: [msg.system(long), msg.user('x')] }).system).toEqual([{ type: 'text', text: long, cache_control: { type: 'ephemeral' } }])
    expect(typeof body({ model: 'm', messages: [msg.system('x'.repeat(CACHEABLE_PREFIX_MIN_CHARS - 1)), msg.user('x')] }).system).toBe('string')
    expect(body(simple()).system).toBeUndefined()
    const bigTool: ToolSpec = { name: 't', description: 'd'.repeat(CACHEABLE_PREFIX_MIN_CHARS), inputSchema: { type: 'object' } }
    const d = body({ model: 'm', messages: [msg.system('S'), msg.user('x')], tools: [bigTool] })
    expect(at(d, 'system', 0, 'cache_control')).toEqual({ type: 'ephemeral' })
    expect(at(d, 'tools', 0, 'cache_control')).toBeUndefined()
    const e = body({ model: 'm', messages: [msg.user('x')], tools: [weatherTool, bigTool] })
    expect(at(e, 'tools', 1, 'cache_control')).toEqual({ type: 'ephemeral' })
    expect(at(e, 'tools', 0, 'cache_control')).toBeUndefined()
  })
  it('tool_choice', () => {
    const t = [weatherTool]
    expect(body({ model: 'm', messages: [msg.user('x')], tools: t }).tool_choice).toBeUndefined()
    expect(body({ model: 'm', messages: [msg.user('x')], tools: t, toolChoice: 'none' }).tool_choice).toEqual({ type: 'none' })
    expect(body({ model: 'm', messages: [msg.user('x')], tools: t, toolChoice: 'required' }).tool_choice).toEqual({ type: 'any' })
    expect(body({ model: 'm', messages: [msg.user('x')], tools: t, toolChoice: { name: 'get_weather' } }).tool_choice).toEqual({ type: 'tool', name: 'get_weather' })
  })
  it('tool_use y tool_result se fusionan', () => {
    const c1: ToolCall = { id: 'toolu_1', name: 'get_weather', arguments: { city: 'Lima' } }
    const c2: ToolCall = { id: 'toolu_2', name: 'get_time', arguments: { tz: 'UTC' } }
    const b = body({ model: 'm', messages: [msg.user('¿Clima y hora?'), msg.assistant('Consulto.', [c1, c2]), msg.toolResult('toolu_1', 'get_weather', '18 °C'), msg.toolResult('toolu_2', 'get_time', '12:00')], tools: [weatherTool] })
    expect(b.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '¿Clima y hora?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Consulto.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Lima' } },
        { type: 'tool_use', id: 'toolu_2', name: 'get_time', input: { tz: 'UTC' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '18 °C' }, { type: 'tool_result', tool_use_id: 'toolu_2', content: '12:00' }] }
    ])
  })
  it('los resultados van antes del texto; mismos roles seguidos se fusionan; empieza por el usuario', () => {
    const c: ToolCall = { id: 't1', name: 'x', arguments: {} }
    const b = body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [c]), msg.toolResult('t1', 'x', 'ok'), msg.user('Resume ahora.')], tools: [weatherTool] })
    const msgs = b.messages as JSONObject[]
    expect(msgs).toHaveLength(3)
    expect(at(msgs[2], 'content', 0, 'type')).toBe('tool_result')
    expect(at(msgs[2], 'content', 1)).toEqual({ type: 'text', text: 'Resume ahora.' })
    const merged = body({ model: 'm', messages: [msg.user('a'), msg.user('b'), msg.assistant('c'), msg.assistant('d'), msg.user('e')] })
    expect((merged.messages as JSONObject[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect((at(merged, 'messages', 0, 'content') as unknown[]).length).toBe(2)
    expect((body({ model: 'm', messages: [msg.assistant('Hola, soy yo'), msg.user('ok')] }).messages as JSONObject[]).map((m) => m.role).slice(0, 2)).toEqual(['user', 'assistant'])
  })
  it('bloques de texto vacíos se saltan; sin mensajes útiles es un error', () => {
    const b = body({ model: 'm', messages: [msg.user('a'), msg.assistant(''), msg.user('')] })
    for (const m of b.messages as JSONObject[]) for (const blk of m.content as JSONObject[]) if (blk.type === 'text') expect(blk.text).not.toBe('')
    expect(() => body({ model: 'm', messages: [msg.system('solo sistema')] })).toThrow(AIError)
    expect(() => body({ model: 'm', messages: [] })).toThrow(AIError)
  })
  it('imágenes, también en resultados de herramientas; sin visión, error', () => {
    const img = { mediaType: 'image/jpeg', base64: 'QUJD' }
    expect(at(body({ model: 'm', messages: [msg.user('¿Qué ves?', [img])] }), 'messages', 0, 'content')).toEqual([{ type: 'text', text: '¿Qué ves?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }])
    expect(() => body({ model: 'm', messages: [msg.user('x', [img])] }, config({ model: 'm', supportsVision: false }))).toThrow(/imágenes/)
    const c: ToolCall = { id: 't1', name: 'captura', arguments: {} }
    const toolMsg: ChatMessage = msg.toolResult('t1', 'captura', 'hecho', [{ mediaType: 'image/png', base64: 'QUJD' }])
    expect(at(body({ model: 'm', messages: [msg.user('x'), msg.assistant('', [c]), toolMsg], tools: [weatherTool] }), 'messages', 2, 'content', 0, 'content'))
      .toEqual([{ type: 'text', text: 'hecho' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }])
  })
  it('resultados de error marcados; ids saneados igual en llamada y resultado', () => {
    const c: ToolCall = { id: 't1', name: 'x', arguments: {} }
    expect(at(body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [c]), msg.toolResult('t1', 'x', 'Error: no existe')], tools: [weatherTool] }), 'messages', 2, 'content', 0, 'is_error')).toBe(true)
    expect(at(body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [c]), msg.toolResult('t1', 'x', 'bien')], tools: [weatherTool] }), 'messages', 2, 'content', 0, 'is_error')).toBeUndefined()
    const odd: ToolCall = { id: 'call.1/ñ:x', name: 'x', arguments: {} }
    const b = body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [odd]), msg.toolResult('call.1/ñ:x', 'x', 'ok')], tools: [weatherTool] })
    expect(at(b, 'messages', 1, 'content', 0, 'id')).toBe('call_1___x')
    expect(at(b, 'messages', 2, 'content', 0, 'tool_use_id')).toBe('call_1___x')
    expect(sanitizeToolID('')).toBe('toolu_sin_id')
    expect(sanitizeToolID('toolu_01A-b')).toBe('toolu_01A-b')
  })
  it('un resultado que falta se sintetiza; las herramientas usadas se declaran aunque no se ofrezcan', () => {
    const c: ToolCall = { id: 't1', name: 'x', arguments: {} }
    const blocks = at(body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [c]), msg.toolResult('zzz', 'x', 'ajeno')], tools: [weatherTool] }), 'messages', 2, 'content') as JSONObject[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ tool_use_id: 't1', is_error: true })
    const b = body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [{ id: 't1', name: 'zeta', arguments: {} }, { id: 't2', name: 'alfa', arguments: {} }]),
      msg.toolResult('t1', 'zeta', 'ok'), msg.toolResult('t2', 'alfa', 'ok'), msg.user('Resume.')] })
    expect((b.tools as JSONObject[]).map((t) => t.name)).toEqual(['alfa', 'zeta'])
    expect(b.tool_choice).toEqual({ type: 'none' })
    expect(body(simple()).tools).toBeUndefined()
  })
  it('muestreo y esfuerzo', () => {
    const b = body({ model: 'm', messages: [msg.user('x')], temperature: 0, topP: 0.8, reasoningEffort: 'high' })
    expect(b.temperature).toBe(0)
    expect(b.top_p).toBe(0.8)
    expect(b.output_config).toEqual({ effort: 'high' })
    expect(body({ model: 'm', messages: [msg.user('x')], reasoningEffort: 'minimal' }).output_config).toEqual({ effort: 'low' })
    expect(body({ model: 'm', messages: [msg.user('x')], reasoningEffort: 'XHigh' }).output_config).toEqual({ effort: 'xhigh' })
    expect(body({ model: 'm', messages: [msg.user('x')], reasoningEffort: 'none' }).output_config).toBeUndefined()
    expect(body(simple()).output_config).toBeUndefined()
  })
  it('caché de la cola: marcador en el último bloque (nunca el automático de nivel superior)', () => {
    const marked = body(simple(), undefined, { caching: true })
    expect(marked.cache_control).toBeUndefined()
    const last = (marked.messages as JSONObject[]).at(-1)!.content as JSONObject[]
    expect(last.at(-1)!.cache_control).toEqual({ type: 'ephemeral' })
    const plain = body(simple(), undefined, { caching: false })
    expect(((plain.messages as JSONObject[]).at(-1)!.content as JSONObject[]).at(-1)!.cache_control).toBeUndefined()
  })
  it('extraBody puede activar el razonamiento; argumentos que no son objeto se envuelven', () => {
    const b = body({ model: 'm', messages: [msg.user('x')], extraBody: { thinking: { type: 'adaptive', display: 'summarized' }, top_k: 5 } })
    expect(b.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(b.top_k).toBe(5)
    const arr = body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [{ id: 't1', name: 'x', arguments: [1, 2, 3] }]), msg.toolResult('t1', 'x', 'ok')], tools: [weatherTool] })
    expect(at(arr, 'messages', 1, 'content', 0, 'input')).toEqual({ _valor: [1, 2, 3] })
    const nul = body({ model: 'm', messages: [msg.user('a'), msg.assistant('', [{ id: 't2', name: 'x', arguments: null }]), msg.toolResult('t2', 'x', 'ok')], tools: [weatherTool] })
    expect(at(nul, 'messages', 1, 'content', 0, 'input')).toEqual({})
  })
  it('con el razonamiento activo no va temperature (Sonnet 5.5)', () => {
    const b = body({ model: '', messages: [msg.user('x')], temperature: 0.3, topP: 0.5 }, config())
    expect(b.thinking).toBeDefined()
    expect(b.temperature).toBeUndefined()
    expect(b.top_p).toBeUndefined()
  })
})

describe('razonamiento firmado (ThinkingVault)', () => {
  const vaultWith = (blocks: Parameters<ThinkingVault['store']>[0]) => {
    const v = new ThinkingVault()
    v.store(blocks)
    return v
  }
  it('se reenvía en el orden original', () => {
    const vault = vaultWith([{ type: 'thinking', text: 'Debo consultar.', signature: 'SIG1' }, { type: 'text', text: 'Consulto.' }, { type: 'redacted', data: 'RED==' }, { type: 'toolUse', id: 'toolu_a' }])
    const c: ToolCall = { id: 'toolu_a', name: 'get_weather', arguments: { city: 'Lima' } }
    const b = body({ model: 'm', messages: [msg.user('x'), msg.assistant('Consulto.', [c]), msg.toolResult('toolu_a', 'get_weather', 'ok')], tools: [weatherTool] }, undefined, { vault })
    expect(at(b, 'messages', 1, 'content')).toEqual([
      { type: 'thinking', thinking: 'Debo consultar.', signature: 'SIG1' }, { type: 'text', text: 'Consulto.' }, { type: 'redacted_thinking', data: 'RED==' },
      { type: 'tool_use', id: 'toolu_a', name: 'get_weather', input: { city: 'Lima' } }
    ])
  })
  it('con el texto omitido se reenvía la firma', () => {
    const vault = vaultWith([{ type: 'thinking', text: '', signature: 'SIGONLY' }, { type: 'toolUse', id: 'toolu_a' }])
    const b = body({ model: 'm', messages: [msg.user('x'), msg.assistant('', [{ id: 'toolu_a', name: 'x', arguments: {} }]), msg.toolResult('toolu_a', 'x', 'ok')], tools: [weatherTool] }, undefined, { vault })
    expect(at(b, 'messages', 1, 'content', 0)).toEqual({ type: 'thinking', thinking: '', signature: 'SIGONLY' })
  })
  it('no se reenvía si el mensaje cambió o se desactiva', () => {
    const vault = vaultWith([{ type: 'thinking', text: 't', signature: 'S' }, { type: 'text', text: 'Original' }, { type: 'toolUse', id: 'toolu_a' }])
    const c: ToolCall = { id: 'toolu_a', name: 'x', arguments: {} }
    const changed = body({ model: 'm', messages: [msg.user('x'), msg.assistant('Otro texto', [c]), msg.toolResult('toolu_a', 'x', 'ok')], tools: [weatherTool] }, undefined, { vault })
    expect((at(changed, 'messages', 1, 'content') as JSONObject[]).map((b) => b.type)).toEqual(['text', 'tool_use'])
    const other = body({ model: 'm', messages: [msg.user('x'), msg.assistant('Original', [c, { id: 'toolu_b', name: 'y', arguments: {} }]), msg.toolResult('toolu_a', 'x', 'ok'), msg.toolResult('toolu_b', 'y', 'ok')], tools: [weatherTool] }, undefined, { vault })
    expect((at(other, 'messages', 1, 'content') as JSONObject[]).some((b) => b.type === 'thinking')).toBe(false)
    const off = body({ model: 'm', messages: [msg.user('x'), msg.assistant('Original', [c]), msg.toolResult('toolu_a', 'x', 'ok')], tools: [weatherTool] }, undefined, { vault, replay: false })
    expect((at(off, 'messages', 1, 'content') as JSONObject[]).map((b) => b.type)).toEqual(['text', 'tool_use'])
  })
  it('expulsa lo antiguo (por número y por bytes)', () => {
    const v = new ThinkingVault(3, 1_000_000)
    for (let i = 0; i < 6; i++) v.store([{ type: 'thinking', text: 't', signature: `s${i}` }, { type: 'toolUse', id: `id${i}` }])
    expect(v.count).toBe(3)
    expect(v.lookup('id0')).toBeUndefined()
    expect(v.lookup('id5')).toBeDefined()
    const small = new ThinkingVault(100, 300)
    for (let i = 0; i < 10; i++) small.store([{ type: 'thinking', text: 'x'.repeat(100), signature: 's' }, { type: 'toolUse', id: `b${i}` }])
    expect(small.count).toBeLessThan(10)
    small.purge(['b9'])
    expect(small.lookup('b9')).toBeUndefined()
    small.removeAll()
    expect(small.count).toBe(0)
  })
})

function setup(script: MockReply[] | MockReply, cfg: Partial<ProviderConfig> = {}, keys: Record<string, string> = { 'test-key': TEST_KEY }, http: object = {}) {
  const mf = mockFetch(Array.isArray(script) ? script : [script])
  const vault = new ThinkingVault()
  const deps = testDeps(mf.fetch, keys, { vault, http: { idleTimeoutSec: 5, ...http } })
  return { mf, deps, vault, model: new AnthropicModel(config(cfg), deps) }
}
async function run(script: MockReply[] | MockReply, request = simple(), cfg: Partial<ProviderConfig> = {}) {
  const s = setup(script, cfg)
  const r = await collect(s.model, request)
  return { ...s, ...r, lines: r.events.map(line) }
}
const okStream = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}')
  + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
  + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hace sol."}}')
  + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}') + ev('message_stop', '{"type":"message_stop"}')

describe('streaming', () => {
  it('texto y dos herramientas (uso con caché leída y escrita aparte)', async () => {
    const r = await run(sseReply(Fixtures.anthropicTextAndTools), simple({ tools: [weatherTool] }))
    const d = digest(r.events)
    expect(d.text).toBe('Voy a consultar el clima de Bogotá ☀️.')
    expect(d.calls.map((c) => c.id)).toEqual(['toolu_01T1x1', 'toolu_02Y2y2'])
    expect(d.calls.map((c) => c.name)).toEqual(['get_weather', 'get_time'])
    expect(d.calls[0].arguments).toEqual({ city: 'Bogotá' })
    expect(d.calls[1].arguments).toEqual({ tz: 'America/Bogota' })
    expect(d.finish).toBe('toolCalls')
    expect(d.usage).toEqual({ promptTokens: 872, completionTokens: 89, reasoningTokens: 0, cachedTokens: 300, cacheWriteTokens: 100 })
    expect(d.usageCount).toBe(1)
    expect(d.finishCount).toBe(1)
    expect(r.lines.at(-1)!.startsWith('finished:')).toBe(true)
    expect(r.lines.at(-2)!.startsWith('usage:')).toBe(true)
  })
  it('troceo adversario e índices de herramienta seguidos', async () => {
    const expected = (await run(sseReply(Fixtures.anthropicTextAndTools))).lines
    for (const size of [1, 2, 3, 7, 31, 200]) expect((await run(sseReply(Fixtures.anthropicTextAndTools, size))).lines).toEqual(expected)
    const idx = (await run(sseReply(Fixtures.anthropicTextAndTools))).events.flatMap((e) => (e.type === 'tool_call' ? [e.index] : []))
    expect(new Set(idx)).toEqual(new Set([0, 1]))
  })
  it('razonamiento con firma: se guarda en el baúl', async () => {
    const r = await run(sseReply(Fixtures.anthropicThinkingTool), simple({ tools: [weatherTool] }))
    const d = digest(r.events)
    expect(d.reasoning).toBe('Debo consultar el clima.')
    expect(d.text).toBe('Consulto.')
    expect(d.calls[0].arguments).toEqual({ city: 'Lima' })
    expect(d.usage).toEqual({ promptTokens: 50, completionTokens: 42, reasoningTokens: 30, cachedTokens: 0, cacheWriteTokens: 0 })
    expect(r.vault.lookup('toolu_01Think1')).toEqual([{ type: 'thinking', text: 'Debo consultar el clima.', signature: 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkz' },
      { type: 'text', text: 'Consulto.' }, { type: 'toolUse', id: 'toolu_01Think1' }])
  })
  it('ida y vuelta: la petición siguiente reenvía el razonamiento firmado', async () => {
    const s = setup([sseReply(Fixtures.anthropicThinkingTool), sseReply(okStream)])
    const first = await s.model.complete({ model: '', messages: [msg.user('¿Clima en Lima?')], tools: [weatherTool] })
    expect(first.finish).toBe('toolCalls')
    const call = first.message.toolCalls![0]
    const final = await s.model.complete({ model: '', messages: [msg.user('¿Clima en Lima?'), first.message, msg.toolResult(call.id, call.name, 'Soleado')], tools: [weatherTool] })
    expect(final.message.content).toEqual([{ type: 'text', text: 'Hace sol.' }])
    const sent = s.mf.requests[1].body
    expect((at(sent, 'messages', 1, 'content') as JSONObject[]).map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use'])
    expect(at(sent, 'messages', 1, 'content', 0, 'signature')).toBe('EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkz')
    expect(at(sent, 'messages', 2, 'content', 0, 'type')).toBe('tool_result')
  })
  it('firma rechazada: se reintenta sin razonamiento y se olvida', async () => {
    const s = setup([jsonReply(Fixtures.anthropicThinkingSig400, 400), sseReply(okStream)])
    s.vault.store([{ type: 'thinking', text: 't', signature: 'SIG' }, { type: 'toolUse', id: 'toolu_x' }])
    const c: ToolCall = { id: 'toolu_x', name: 'get_weather', arguments: { city: 'Lima' } }
    await s.model.complete({ model: '', messages: [msg.user('a'), msg.assistant('', [c]), msg.toolResult('toolu_x', 'get_weather', 'ok')], tools: [weatherTool] })
    expect(s.mf.requests).toHaveLength(2)
    expect(at(s.mf.requests[0].body, 'messages', 1, 'content', 0, 'type')).toBe('thinking')
    expect(at(s.mf.requests[1].body, 'messages', 1, 'content', 0, 'type')).toBe('tool_use')
    expect(s.vault.lookup('toolu_x')).toBeUndefined()
  })
  it('bloques desconocidos impiden guardar el razonamiento; las herramientas del servidor no son nuestras', async () => {
    const s = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"S"}}')
      + ev('content_block_start', '{"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{}}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"x\\"}"}}')
      + ev('content_block_start', '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_z","name":"get_weather","input":{}}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}') + ev('message_stop', '{"type":"message_stop"}')
    const r = await run(sseReply(s))
    expect(r.vault.lookup('toolu_z')).toBeUndefined()
    expect(digest(r.events).calls.map((c) => c.id)).toEqual(['toolu_z'])
  })
  it('motivos de fin', async () => {
    for (const [raw, expected] of [['end_turn', 'stop'], ['stop_sequence', 'stop'], ['max_tokens', 'length'], ['tool_use', 'toolCalls'], ['refusal', 'contentFilter'],
      ['pause_turn', 'other'], ['model_context_window_exceeded', 'length'], ['algo_futuro', 'other']]) {
      const s = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}')
        + ev('message_delta', `{"type":"message_delta","delta":{"stop_reason":"${raw}"},"usage":{"output_tokens":2}}`) + ev('message_stop', '{"type":"message_stop"}')
      expect(digest((await run(sseReply(s))).events).finish).toBe(expected)
    }
  })
  it('sin message_stop vale; cortado antes del final es un error; lo desconocido se ignora', async () => {
    const start = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}')
    expect(digest((await run(sseReply(start + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}')))).events).finish).toBe('stop')
    const cut = await run(sseReply(start + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hola"}}')))
    expect(cut.error).toMatchObject({ kind: 'network' })
    expect((cut.error as AIError).message).toContain('se cortó antes de que terminara')
    const unknown = start + ev('evento_del_futuro', '{"type":"evento_del_futuro","x":1}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":{"cited_text":"x"}}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}') + ev('message_stop', '{"type":"message_stop"}')
    expect(digest((await run(sseReply(unknown))).events).text).toBe('ok')
  })
  it('error a mitad del flujo (saturado, sin reintento) y límite dentro del flujo', async () => {
    const r = await run(sseReply(Fixtures.anthropicOverloadedMidStream))
    expect(r.error).toMatchObject({ kind: 'http', status: 529 })
    expect((r.error as AIError).message).toContain('saturado')
    expect(r.lines).toEqual(['text:Empiezo'])
    expect(r.mf.requests).toHaveLength(1)
    const rl = await run(sseReply(ev('error', '{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}')))
    expect(rl.error).toMatchObject({ kind: 'rateLimited', status: 429 })
  })
})

describe('petición y errores', () => {
  it('forma: cabeceras, ruta y cuerpo', async () => {
    const r = await run(sseReply(Fixtures.anthropicTextAndTools), { model: '', messages: [msg.system('S'), msg.user('U')], tools: [weatherTool], maxTokens: 123 },
      { extraHeaders: { 'anthropic-beta': 'algo-2026-01-01', 'x-aula-idle-timeout': '10' } })
    const q = r.mf.requests[0]
    expect(q.method).toBe('POST')
    expect(q.url).toBe('https://api.anthropic.com/v1/messages')
    expect(q.headers['x-api-key']).toBe(TEST_KEY)
    expect(q.headers['anthropic-version']).toBe('2023-06-01')
    expect(q.headers.authorization).toBeUndefined()
    expect(q.headers['anthropic-beta']).toBe('algo-2026-01-01')
    expect(q.headers['x-aula-idle-timeout']).toBeUndefined()
    expect(q.headers.accept).toBe('text/event-stream')
    expect(q.body).toMatchObject({ max_tokens: 123, model: 'claude-sonnet-5-5', stream: true, system: 'S' })
  })
  it('direcciones propias', async () => {
    expect((await run(sseReply(Fixtures.anthropicTextAndTools), simple(), { baseURL: 'https://mock.test/anthropic' })).mf.requests[0].url).toBe('https://mock.test/anthropic/v1/messages')
    expect((await run(sseReply(Fixtures.anthropicTextAndTools), simple(), { baseURL: 'https://mock.test/zen/v1' })).mf.requests[0].url).toBe('https://mock.test/zen/v1/messages')
  })
  it('un historial con resultados cachea hasta el final', async () => {
    const c: ToolCall = { id: 'toolu_1', name: 'x', arguments: {} }
    const r = await run(sseReply(Fixtures.anthropicTextAndTools), { model: '', messages: [msg.user('a'), msg.assistant('', [c]), msg.toolResult('toolu_1', 'x', 'ok')], tools: [weatherTool] })
    const sent = r.mf.requests[0].body as Body
    expect(sent.cache_control).toBeUndefined()
    const last = ((sent.messages as JSONObject[]).at(-1)!.content as JSONObject[]).at(-1)!
    expect(last.type).toBe('tool_result')
    expect(last.cache_control).toEqual({ type: 'ephemeral' })
  })
  it('sin clave: error claro y sin red', async () => {
    const s = setup(sseReply(Fixtures.anthropicTextAndTools), {}, {})
    const r = await collect(s.model, simple())
    expect(r.error).toMatchObject({ kind: 'missingKey' })
    expect((r.error as AIError).message).toContain('Falta la clave de API de Anthropic de prueba')
    const noRef = setup(sseReply(Fixtures.anthropicTextAndTools), { secretRef: null })
    expect((await collect(noRef.model, simple())).error).toMatchObject({ kind: 'missingKey' })
    expect(s.mf.requests.length + noRef.mf.requests.length).toBe(0)
  })
  it('401, 429 con espera, 529 reintentado y agotado', async () => {
    const e401 = await run(jsonReply(Fixtures.anthropic401, 401))
    expect(e401.error).toMatchObject({ kind: 'missingKey', status: 401 })
    expect((e401.error as AIError).message).toContain('invalid x-api-key')
    expect(e401.mf.requests).toHaveLength(1)
    const e429 = await run(jsonReply(Fixtures.anthropic429, 429, { 'retry-after': '30' }))
    expect(e429.error).toMatchObject({ kind: 'rateLimited', retryAfter: 30 })
    expect(e429.mf.requests).toHaveLength(1)
    const flaky = await run([jsonReply(Fixtures.anthropic529, 529), jsonReply(Fixtures.anthropic529, 529), sseReply(Fixtures.anthropicTextAndTools)])
    expect(flaky.lines.at(-1)).toBe('finished:toolCalls')
    expect(flaky.mf.requests).toHaveLength(3)
    expect(flaky.deps.sleeps).toEqual([1, 2])
    const down = await run(jsonReply(Fixtures.anthropic529, 529))
    expect(down.error).toMatchObject({ kind: 'http', status: 529 })
    expect((down.error as AIError).message).toContain('saturado')
    expect((down.error as AIError).message).toContain('Overloaded')
    expect(down.mf.requests).toHaveLength(5)
  })
  it('«prompt is too long» conserva el texto para detectar el contexto', async () => {
    const r = await run(jsonReply(Fixtures.anthropicTooLong400, 400))
    expect((r.error as AIError).message).toContain('prompt is too long')
    expect(isContextLengthError(r.error as AIError)).toBe(true)
    expect((r.error as AIError).code).toBe('ai_context_length')
  })
  it('parámetros opcionales rechazados se quitan', async () => {
    const r = await run([jsonReply('{"type":"error","error":{"type":"invalid_request_error","message":"`temperature` may only be set to 1 when thinking is enabled."}}', 400),
      jsonReply('{"type":"error","error":{"type":"invalid_request_error","message":"output_config.effort: Extra inputs are not permitted"}}', 400), sseReply(Fixtures.anthropicTextAndTools)],
    { model: '', messages: [msg.user('x')], temperature: 0.2, reasoningEffort: 'high' }, { model: 'claude-de-prueba' })
    expect(r.mf.requests).toHaveLength(3)
    const last = r.mf.requests[2].body as Body
    expect(last.temperature).toBeUndefined()
    expect(last.output_config).toBeUndefined()
  })
  it('cancelación e inactividad', async () => {
    const start = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}')
    const s = setup({ status: 200, headers: sseHeaders, chunks: [start], hang: true })
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 50)
    expect((await collect(s.model, simple({ timeoutSec: 60 }), ctl.signal)).error).toMatchObject({ code: 'cancelled' })
    const idle = setup({ status: 200, headers: sseHeaders, chunks: [start], hang: true }, {}, undefined, { idleTimeoutSec: 0.3 })
    expect((await collect(idle.model, simple({ timeoutSec: 60 }))).error).toMatchObject({ kind: 'timeout' })
  })
  it('sin streaming', async () => {
    const r = await run(jsonReply('{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-5-5","content":[{"type":"thinking","thinking":"hmm","signature":"SIGNON"},{"type":"text","text":"Voy."},{"type":"tool_use","id":"toolu_ns","name":"get_weather","input":{"city":"Quito"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":10,"cache_read_input_tokens":4,"output_tokens":7}}'),
      simple({ tools: [weatherTool] }), { supportsStreaming: false })
    const d = digest(r.events)
    expect(d.reasoning).toBe('hmm')
    expect(d.text).toBe('Voy.')
    expect(d.calls[0].arguments).toEqual({ city: 'Quito' })
    expect(d.usage).toEqual({ promptTokens: 14, completionTokens: 7, reasoningTokens: 0, cachedTokens: 4, cacheWriteTokens: 0 })
    expect(d.finish).toBe('toolCalls')
    expect((r.mf.requests[0].body as Body).stream).toBe(false)
    expect(r.vault.lookup('toolu_ns')).toBeDefined()
    const err = await run(jsonReply('{"type":"error","error":{"type":"api_error","message":"fallo interno"}}'), simple(), { supportsStreaming: false })
    expect((err.error as AIError).message).toContain('fallo interno')
  })
})

describe('lista de modelos y prueba', () => {
  it('con paginación', async () => {
    const mf = mockFetch([jsonReply('{"data":[{"type":"model","id":"claude-sonnet-5-5","display_name":"Sonnet 5.5"},{"type":"model","id":"claude-haiku-5-5"}],"has_more":true,"first_id":"claude-sonnet-5-5","last_id":"claude-haiku-5-5"}'),
      jsonReply('{"data":[{"type":"model","id":"claude-opus-5-5"}],"has_more":false,"first_id":"claude-opus-5-5","last_id":"claude-opus-5-5"}')])
    const ids = await anthropicListModels(config(), testDeps(mf.fetch, { 'test-key': TEST_KEY }))
    expect(ids).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(mf.requests[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(mf.requests[1].url).toContain('after_id=claude-haiku-5-5')
    expect(mf.requests[0].headers['x-api-key']).toBe(TEST_KEY)
  })
  it('errores y un cursor que no avanza', async () => {
    await expect(anthropicListModels(config(), testDeps(mockFetch([jsonReply(Fixtures.anthropic401, 401)]).fetch, { 'test-key': TEST_KEY }))).rejects.toMatchObject({ kind: 'missingKey' })
    await expect(anthropicListModels(config(), testDeps(mockFetch([jsonReply('{}')]).fetch, {}))).rejects.toMatchObject({ kind: 'missingKey' })
    await expect(anthropicListModels(config(), testDeps(mockFetch([jsonReply('{"data":[],"has_more":false}')]).fetch, { 'test-key': TEST_KEY }))).rejects.toMatchObject({ kind: 'badResponse' })
    const loop = mockFetch([jsonReply('{"data":[{"id":"a"}],"has_more":true,"last_id":"a"}')])
    expect(await anthropicListModels(config(), testDeps(loop.fetch, { 'test-key': TEST_KEY }))).toEqual(['a'])
    expect(loop.requests.length).toBeLessThanOrEqual(3)
  })
  it('prueba de conexión', async () => {
    const s = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":8,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}') + ev('message_stop', '{"type":"message_stop"}')
    const mf = mockFetch([sseReply(s)])
    expect(await anthropicPing(config(), testDeps(mf.fetch, { 'test-key': TEST_KEY }))).toBe('OK')
    expect(at(mf.requests[0].body, 'messages', 0, 'content', 0, 'text')).toBe('Responde solo: OK')
    await expect(anthropicPing(config({ model: '' }), testDeps(mf.fetch, { 'test-key': TEST_KEY }))).rejects.toMatchObject({ kind: 'other' })
  })
})
