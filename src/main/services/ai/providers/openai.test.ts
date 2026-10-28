// Port de Tests/AIKitTests/OpenAIProviderTests.swift y OpenAIErrorTests.swift: flujos reales de cada servicio (troceados de forma
// adversa), variantes, respuestas sin streaming, forma de la petición, claves, errores, reintentos, cancelación, plazos y la
// compatibilidad automática (parámetros que el servidor rechaza).
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { msg, type ChatRequest, type ToolSpec } from '@shared/ai/types'
import type { SecretStore } from '../../secrets'
import { AIError, isCancellation } from '../errors'
import { Fixtures } from '../testing/fixtures'
import { collect, digest, jsonReply, line, mockFetch, netError, sseHeaders, sseReply, testDeps, type MockReply } from '../testing/mocks'
import type { ProviderConfig } from './config'
import { OpenAICompatibleModel, openAIListModels, openAIPing } from './openai'

const TEST_KEY = 'sk-test-1234567890abcdefXYZ'
const BASE = 'https://mock.test/v1'

export function openAIConfig(o: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test', kind: 'openai-compatible', label: 'Proveedor de prueba', baseURL: BASE, model: 'modelo-x', secretRef: 'test-key', extraHeaders: {},
    supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true, ...o
  }
}

const weatherTool: ToolSpec = {
  name: 'get_weather', description: 'Clima de una ciudad',
  inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'Ciudad' } }, required: ['city'] }
}

const simple = (text = 'Hola', o: Partial<ChatRequest> = {}): ChatRequest => ({ model: '', messages: [msg.user(text)], timeoutSec: 20, ...o })
const data = (json: string) => `data: ${json}\n\n`
const DONE = 'data: [DONE]\n\n'

function setup(script: MockReply[] | MockReply, config: Partial<ProviderConfig> = {}, keys: Record<string, string> = { 'test-key': TEST_KEY }, http: object = {}) {
  const mf = mockFetch(Array.isArray(script) ? script : [script])
  const deps = testDeps(mf.fetch, keys, { http: { idleTimeoutSec: 5, ...http } })
  const model = new OpenAICompatibleModel(openAIConfig(config), deps)
  return { mf, deps, model }
}

async function run(script: MockReply[] | MockReply, request = simple(), config: Partial<ProviderConfig> = {}) {
  const s = setup(script, config)
  const r = await collect(s.model, request)
  return { ...s, ...r, lines: r.events.map(line) }
}

async function expectAIError(p: Promise<{ error?: unknown }>, o: { kind?: string; status?: number; code?: string; contains?: string[]; notContains?: string[] }) {
  const { error } = await p
  expect(error, 'se esperaba un AIError').toBeInstanceOf(AIError)
  const e = error as AIError
  if (o.kind) expect(e.kind, e.message).toBe(o.kind)
  if (o.status !== undefined) expect(e.status).toBe(o.status)
  if (o.code) expect(e.code).toBe(o.code)
  for (const c of o.contains ?? []) expect(e.message).toContain(c)
  for (const c of o.notContains ?? []) expect(e.message).not.toContain(c)
  return e
}

beforeEach(() => setAILocale('es'))

describe('flujos de cada proveedor', () => {
  it('texto de OpenAI', async () => {
    const r = await run(sseReply(Fixtures.openAIText))
    expect(r.lines).toEqual(['text:¡Hola', 'text:, ', 'text:mundo! ñandú 👋 日本語', 'usage:14/9/2/4', 'finished:stop'])
  })
  it('troceo adversario: mismo resultado', async () => {
    const expected = (await run(sseReply(Fixtures.openAIText))).lines
    for (const size of [1, 2, 3, 5, 7, 13, 64, 500]) expect((await run(sseReply(Fixtures.openAIText, size))).lines).toEqual(expected)
  })
  it('un carácter multibyte partido en cualquier posición', async () => {
    const short = data('{"choices":[{"index":0,"delta":{"content":"Ñu 👋"},"finish_reason":null}]}') + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE
    const bytes = new TextEncoder().encode(short)
    for (let i = 1; i < bytes.length; i += 3) {
      const r = await run({ status: 200, headers: sseHeaders, chunks: [bytes.slice(0, i), bytes.slice(i)] })
      expect(digest(r.events).text).toBe('Ñu 👋')
    }
  })
  it('DeepSeek: reasoning_content y uso con caché', async () => {
    const r = await run(sseReply(Fixtures.deepseekReasoning, 41))
    expect(r.lines).toEqual(['reasoning:El usuario', 'reasoning: pide la derivada de x^2.', 'text:La derivada', 'text: de $x^2$ es $2x$.', 'usage:18/40/25/12', 'finished:stop'])
  })
  it('OpenRouter: comentarios y finish_reason repetido (uso y fin una sola vez)', async () => {
    const r = await run(sseReply(Fixtures.openRouter))
    expect(r.lines).toEqual(['reasoning:Pienso', 'reasoning: en la respuesta.', 'text:Listo', 'usage:10/12/5/3', 'finished:stop'])
    const d = digest(r.events)
    expect(d.usageCount).toBe(1)
    expect(d.finishCount).toBe(1)
  })
  it('MiMo: una llamada entera sin index', async () => {
    const d = digest((await run(sseReply(Fixtures.mimoToolCall))).events)
    expect(d.reasoning).toBe('Debo crear la lección.')
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0]).toMatchObject({ id: 'call_mimo_01', name: 'crear_leccion', arguments: { titulo: 'Límites', nivel: 2 } })
    expect(d.finish).toBe('toolCalls')
    expect(d.usage).toEqual({ promptTokens: 120, completionTokens: 30, reasoningTokens: 9, cachedTokens: 0, cacheWriteTokens: 0 })
  })
  it('llamadas paralelas con argumentos fragmentados (también troceadas)', async () => {
    for (const size of [0, 1, 23]) {
      const d = digest((await run(sseReply(Fixtures.openAIToolCalls, size))).events)
      expect(d.calls.map((c) => c.id)).toEqual(['call_8Kq2', 'call_Lm5x'])
      expect(d.calls.map((c) => c.name)).toEqual(['get_weather', 'get_time'])
      expect(d.calls[0].arguments).toEqual({ city: 'Bogotá' })
      expect(d.calls[1].arguments).toEqual({ tz: 'America/Bogota' })
      expect(d.finish).toBe('toolCalls')
      expect(d.usage!.promptTokens + d.usage!.completionTokens).toBe(109)
    }
  })
  it('los fragmentos conservan su índice y no repiten el id', async () => {
    const tools = (await run(sseReply(Fixtures.openAIToolCalls))).events.flatMap((e) => (e.type === 'tool_call' ? [e] : []))
    expect(tools[0]).toMatchObject({ index: 0, id: 'call_8Kq2', name: 'get_weather' })
    expect(new Set(tools.map((t) => t.index))).toEqual(new Set([0, 1]))
    expect(tools[1].id).toBeUndefined()
  })
  it('LaTeX con una sola barra en los argumentos', async () => {
    const d = digest((await run(sseReply(Fixtures.openAILatexToolCall, 7))).events)
    expect(d.calls[0].arguments).toEqual({ tex: '\\frac{1}{2} + \\theta \\neq \\sqrt{2}', nota: 'x\ty' })
  })
  it('el uso va antes del fin, que siempre es el último', async () => {
    for (const f of [Fixtures.openAIText, Fixtures.deepseekReasoning, Fixtures.openRouter, Fixtures.mimoToolCall, Fixtures.openAIToolCalls]) {
      const lines = (await run(sseReply(f))).lines
      expect(lines[lines.length - 1].startsWith('finished:')).toBe(true)
      expect(lines[lines.length - 2].startsWith('usage:')).toBe(true)
    }
  })
})

describe('variantes de los proveedores', () => {
  const calls = async (s: string) => digest((await run(sseReply(s))).events)
  it('llamadas sin index, una entera por trozo', async () => {
    const d = await calls(data('{"choices":[{"index":0,"delta":{"tool_calls":[{"id":"a1","type":"function","function":{"name":"uno","arguments":"{\\"x\\":1}"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{"tool_calls":[{"id":"a2","type":"function","function":{"name":"dos","arguments":"{\\"y\\":2}"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}') + DONE)
    expect(d.calls.map((c) => c.name)).toEqual(['uno', 'dos'])
    expect(d.calls.map((c) => c.arguments)).toEqual([{ x: 1 }, { y: 2 }])
  })
  it('el mismo index reutilizado para otra llamada se separa por id', async () => {
    const d = await calls(data('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"g1","type":"function","function":{"name":"uno","arguments":"{\\"x\\":1}"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"g2","type":"function","function":{"name":"dos","arguments":"{\\"y\\":2}"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE)
    expect(d.calls.map((c) => c.id)).toEqual(['g1', 'g2'])
    expect(d.finish).toBe('toolCalls')
  })
  it('fragmentos sin index ni id van a la última llamada', async () => {
    const d = await calls(data('{"choices":[{"index":0,"delta":{"tool_calls":[{"id":"z","function":{"name":"uno","arguments":"{\\"a\\":"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":"[1,2]}"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}') + DONE)
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].arguments).toEqual({ a: [1, 2] })
  })
  it('argumentos como objeto, function_call antiguo y argumentos vacíos', async () => {
    expect((await calls(data('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"o1","function":{"name":"uno","arguments":{"k":"v"}}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}') + DONE)).calls[0].arguments).toEqual({ k: 'v' })
    const legacy = await calls(data('{"choices":[{"index":0,"delta":{"function_call":{"name":"viejo","arguments":"{\\"a\\":1}"}}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"function_call"}]}') + DONE)
    expect(legacy.calls[0].name).toBe('viejo')
    expect(legacy.finish).toBe('toolCalls')
    expect((await calls(data('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"e1","function":{"name":"sin_args","arguments":""}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}') + DONE)).calls[0].arguments).toEqual({})
  })
  it('contenido como lista de partes, negativa como texto y solo la primera opción', async () => {
    expect((await calls(data('{"choices":[{"index":0,"delta":{"content":[{"type":"text","text":"Ho"},{"type":"text","text":"la"}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE)).text).toBe('Hola')
    expect((await calls(data('{"choices":[{"index":0,"delta":{"refusal":"No puedo ayudar con eso."}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE)).text).toBe('No puedo ayudar con eso.')
    expect((await calls(data('{"choices":[{"index":1,"delta":{"content":"B"}},{"index":0,"delta":{"content":"A"}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE)).text).toBe('A')
  })
  it('motivos de fin', async () => {
    for (const [raw, expected] of [['stop', 'stop'], ['length', 'length'], ['tool_calls', 'toolCalls'], ['content_filter', 'contentFilter'], ['algo_nuevo', 'other']]) {
      expect((await calls(data(`{"choices":[{"index":0,"delta":{"content":"x"},"finish_reason":"${raw}"}]}`) + DONE)).finish).toBe(expected)
    }
  })
  it('líneas que no son JSON y campos desconocidos se ignoran', async () => {
    expect((await calls('data: PROCESSING\n\n' + data('{"choices":[{"index":0,"delta":{"content":"ok"}}]}') + 'data: {roto\n\n'
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE)).text).toBe('ok')
    const d = await calls(data('{"id":"x","novedad":{"a":1},"choices":[{"index":0,"delta":{"content":"hi","extra":[1,2,3]},"finish_reason":null,"nuevo":true}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"campo_raro":9}}') + DONE)
    expect(d.text).toBe('hi')
    expect(d.usage!.promptTokens + d.usage!.completionTokens).toBe(3)
  })
  it('el uso no retrocede y uno a cero no pisa el real', async () => {
    const d = await calls(data('{"choices":[{"index":0,"delta":{"content":"a"}}],"usage":{"prompt_tokens":0,"completion_tokens":0}}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}')
      + data('{"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0}}') + DONE)
    expect(d.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 })
    expect(d.usageCount).toBe(1)
  })
  it('sin uso, solo [DONE], fin sin [DONE], evento final sin línea en blanco y CRLF', async () => {
    expect((await run(sseReply(data('{"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"}]}') + DONE))).lines).toEqual(['text:a', 'finished:stop'])
    expect((await run(sseReply(DONE))).lines).toEqual(['finished:stop'])
    expect((await run(sseReply(data('{"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"}]}')))).lines).toEqual(['text:a', 'finished:stop'])
    expect((await run(sseReply(data('{"choices":[{"index":0,"delta":{"content":"a"}}]}') + 'data: [DONE]'))).lines).toEqual(['text:a', 'finished:stop'])
    const crlf = Fixtures.openAIText.replaceAll('\n', '\r\n')
    expect(digest((await run(sseReply(crlf))).events).text).toBe('¡Hola, mundo! ñandú 👋 日本語')
  })
  it('etiquetas <think> de los modelos locales', async () => {
    const r = await run(sseReply(data('{"choices":[{"index":0,"delta":{"content":"<thi"}}]}') + data('{"choices":[{"index":0,"delta":{"content":"nk>pienso</th"}}]}')
      + data('{"choices":[{"index":0,"delta":{"content":"ink>\\n\\nHola"},"finish_reason":"stop"}]}') + DONE))
    const d = digest(r.events)
    expect(d.reasoning).toBe('pienso')
    expect(d.text).toBe('Hola')
  })
})

describe('respuestas sin streaming', () => {
  it('un servidor que ignora stream: true y responde JSON', async () => {
    const r = await run(jsonReply('{"id":"c1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"Hola completa","reasoning_content":"pienso"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}'))
    expect(r.lines).toEqual(['reasoning:pienso', 'text:Hola completa', 'usage:3/4/0/0', 'finished:stop'])
  })
  it('JSON detectado por el primer byte aunque el tipo sea otro', async () => {
    const r = await run({ status: 200, headers: { 'content-type': 'text/plain' }, body: '\n  {"choices":[{"index":0,"message":{"role":"assistant","content":"Hola"},"finish_reason":"stop"}]}' })
    expect(digest(r.events).text).toBe('Hola')
  })
  it('modo sin streaming: stream false y todo leído', async () => {
    const r = await run(jsonReply('{"id":"c1","choices":[{"index":0,"message":{"role":"assistant","content":null,"reasoning":"hmm","tool_calls":[{"id":"call_9","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Quito\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":8,"completion_tokens_details":{"reasoning_tokens":3},"prompt_tokens_details":{"cached_tokens":5}}}'),
      simple('Hola', { tools: [weatherTool] }), { supportsStreaming: false })
    const d = digest(r.events)
    expect(d.reasoning).toBe('hmm')
    expect(d.calls[0].arguments).toEqual({ city: 'Quito' })
    expect(d.finish).toBe('toolCalls')
    expect(d.usage).toEqual({ promptTokens: 20, completionTokens: 8, reasoningTokens: 3, cachedTokens: 5, cacheWriteTokens: 0 })
    const sent = r.mf.requests[0]
    expect((sent.body as Record<string, unknown>).stream).toBe(false)
    expect((sent.body as Record<string, unknown>).stream_options).toBeUndefined()
    expect(sent.headers.accept).toBe('application/json')
  })
  it('sin finish_reason se da por terminada', async () => {
    const r = await run(jsonReply('{"choices":[{"index":0,"message":{"role":"assistant","content":"x"}}]}'), simple(), { supportsStreaming: false })
    expect(digest(r.events).finish).toBe('stop')
  })
  it('sin streaming no hay vigilancia de inactividad', async () => {
    const json = '{"choices":[{"index":0,"message":{"role":"assistant","content":"tarde pero llegó"},"finish_reason":"stop"}]}'
    const s = setup({ status: 200, headers: { 'content-type': 'application/json' }, chunks: [json.slice(0, 10), json.slice(10)], chunkDelayMs: 300 }, { supportsStreaming: false }, undefined, { idleTimeoutSec: 0.15 })
    const r = await collect(s.model, simple())
    expect(r.error).toBeUndefined()
    expect(digest(r.events).text).toBe('tarde pero llegó')
  })
  it('complete arma el mensaje final', async () => {
    const { response } = await run(sseReply(Fixtures.mimoToolCall), simple('x', { tools: [weatherTool] }))
    expect(response!.finish).toBe('toolCalls')
    expect(response!.message.toolCalls![0].name).toBe('crear_leccion')
    expect(response!.message.reasoning).toBe('Debo crear la lección.')
  })
})

describe('forma de la petición y claves', () => {
  it('cabeceras, ruta y cuerpo', async () => {
    const r = await run(sseReply(Fixtures.openAIText), { model: 'otro-modelo', messages: [msg.system('S'), msg.user('U')], temperature: 0.3 },
      { extraHeaders: { 'HTTP-Referer': 'https://aula.local', 'X-Title': 'Aula' } })
    const q = r.mf.requests[0]
    expect(q.method).toBe('POST')
    expect(q.url).toBe('https://mock.test/v1/chat/completions')
    expect(q.headers.authorization).toBe(`Bearer ${TEST_KEY}`)
    expect(q.headers['content-type']).toBe('application/json')
    expect(q.headers.accept).toBe('text/event-stream')
    expect(q.headers['http-referer']).toBe('https://aula.local')
    expect(q.headers['x-title']).toBe('Aula')
    expect(q.body).toMatchObject({ model: 'otro-modelo', temperature: 0.3, stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] })
  })
  it('las opciones locales nunca salen a la red', async () => {
    const r = await run(sseReply(Fixtures.openAIText), simple(), { extraHeaders: { useMaxCompletionTokens: 'true', 'x-aula-idle-timeout': '240', 'X-Real': '1' } })
    const h = r.mf.requests[0].headers
    expect(h['x-real']).toBe('1')
    expect(h.usemaxcompletiontokens).toBeUndefined()
    expect(h['x-aula-idle-timeout']).toBeUndefined()
  })
  it('cabecera propia de la clave (Azure: api-key)', async () => {
    const s = setup([sseReply(Fixtures.openAIText), jsonReply('{"data":[{"id":"gpt"}]}')], { extraHeaders: { 'x-aula-auth-header': 'api-key' } })
    await collect(s.model, simple())
    expect(s.mf.requests[0].headers['api-key']).toBe(TEST_KEY)
    expect(s.mf.requests[0].headers.authorization).toBeUndefined()
    await openAIListModels(openAIConfig({ extraHeaders: { 'x-aula-auth-header': 'api-key' } }), s.deps)
    expect(s.mf.requests[1].headers['api-key']).toBe(TEST_KEY)
    expect(s.mf.requests[1].headers.authorization).toBeUndefined()
  })
  it('la consulta de la URL base llega a la petición; sin clave no hay Authorization', async () => {
    const r = await run(sseReply(Fixtures.openAIText), simple(), { baseURL: 'https://mock.test/openai/deployments/gpt/chat/completions?api-version=2025-01-01' })
    expect(r.mf.requests[0].url).toBe('https://mock.test/openai/deployments/gpt/chat/completions?api-version=2025-01-01')
    const s = setup(sseReply(Fixtures.openAIText), { secretRef: null })
    await collect(s.model, simple())
    expect(s.mf.requests[0].headers.authorization).toBeUndefined()
  })
  it('la clave se limpia antes de enviarla', async () => {
    for (const stored of [`  ${TEST_KEY}\n`, `"${TEST_KEY}"`, `Bearer ${TEST_KEY}`, `“${TEST_KEY}”`]) {
      const s = setup(sseReply(Fixtures.openAIText), {}, { 'test-key': stored })
      await collect(s.model, simple())
      expect(s.mf.requests[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`)
    }
  })
  it('caracteres no válidos o clave vacía: error antes de llamar', async () => {
    const bad = setup(sseReply(Fixtures.openAIText), {}, { 'test-key': 'sk-abc…def' })
    await expectAIError(collect(bad.model, simple()), { kind: 'missingKey', code: 'ai_missing_key', contains: ['no válidos'] })
    expect(bad.mf.requests).toHaveLength(0)
    const none = setup(sseReply(Fixtures.openAIText), { label: 'DeepSeek' }, {})
    await expectAIError(collect(none.model, simple()), { kind: 'missingKey', contains: ['Falta la clave de API de DeepSeek', 'ajustes de IA'] })
    expect(none.mf.requests).toHaveLength(0)
    const empty = setup(sseReply(Fixtures.openAIText), {}, { 'test-key': '   ' })
    await expectAIError(collect(empty.model, simple()), { kind: 'missingKey' })
  })
  it('un servidor local sin clave guardada no la necesita', async () => {
    const s = setup(sseReply(Fixtures.openAIText), { baseURL: 'http://localhost:1234/v1' }, {})
    const r = await collect(s.model, simple())
    expect(r.error).toBeUndefined()
    expect(s.mf.requests[0].headers.authorization).toBeUndefined()
  })
  it('si el almacén de claves falla, se dice (no es «falta la clave»)', async () => {
    const broken: SecretStore = { get: () => { throw new Error('El almacén está bloqueado.') }, set: () => {}, delete: () => {}, keys: () => [] }
    const mf = mockFetch([sseReply(Fixtures.openAIText)])
    const model = new OpenAICompatibleModel(openAIConfig(), { ...testDeps(mf.fetch), secrets: broken })
    await expectAIError(collect(model, simple()), { kind: 'other', code: 'ai_secrets', contains: ['No pude leer el almacén de claves', 'almacén está bloqueado'] })
  })
  it('las imágenes sin visión dan error, nunca se descartan en silencio', async () => {
    const s = setup(sseReply(Fixtures.openAIText))
    await expectAIError(collect(s.model, { messages: [msg.user('mira', [{ mediaType: 'image/png', base64: 'AAAA' }])] }), { kind: 'unsupported', contains: ['imágenes'] })
    expect(s.mf.requests).toHaveLength(0)
  })
})

describe('errores HTTP', () => {
  it('401, 402, 403 y 404', async () => {
    const e401 = await run(jsonReply(Fixtures.openAI401, 401))
    await expectAIError(Promise.resolve(e401), { kind: 'missingKey', status: 401, code: 'ai_auth', contains: ['clave de API', 'ajustes de IA'], notContains: [TEST_KEY] })
    expect(e401.mf.requests).toHaveLength(1)
    await expectAIError(run(jsonReply(Fixtures.deepseek402, 402)), { kind: 'http', status: 402, contains: ['saldo', 'Insufficient Balance'] })
    await expectAIError(run(jsonReply('{"error":{"message":"Country, region, or territory not supported"}}', 403)), { status: 403, contains: ['denegó', 'Country, region'] })
    await expectAIError(run(jsonReply(Fixtures.openAI404Model, 404)), { status: 404, contains: ['modelo-x', 'Actualizar modelos', 'does not exist'] })
  })
  it('429 con Retry-After no se reintenta y lleva la espera', async () => {
    const r = await run(jsonReply(Fixtures.openAI429, 429, { 'Retry-After': '7' }))
    const e = await expectAIError(Promise.resolve(r), { kind: 'rateLimited', status: 429, contains: ['7 s'] })
    expect(e.retryAfter).toBe(7)
    expect(r.mf.requests).toHaveLength(1)
    expect(r.deps.sleeps).toEqual([])
    const reset = await expectAIError(run(jsonReply(Fixtures.openAI429, 429, { 'x-ratelimit-reset-requests': '1m30s', 'x-ratelimit-reset-tokens': '3s' })), { kind: 'rateLimited' })
    expect(reset.retryAfter).toBe(3)
    await expectAIError(run(jsonReply(Fixtures.openAIQuota429, 429)), { kind: 'http', status: 429, code: 'ai_quota', contains: ['cuota'] })
  })
  it('400 con el detalle del proveedor, páginas HTML y cuerpos enormes', async () => {
    const r = await run(jsonReply('{"error":{"message":"messages.2: contenido vacío no permitido","type":"invalid_request_error"}}', 400))
    await expectAIError(Promise.resolve(r), { status: 400, contains: ['rechazó la petición', 'contenido vacío no permitido'] })
    expect(r.mf.requests).toHaveLength(1)
    await expectAIError(run({ status: 502, headers: { 'content-type': 'text/html' }, body: '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>' }), { status: 502, contains: ['502 Bad Gateway'] })
    await expectAIError(run(jsonReply('x'.repeat(2_000_000), 400)), { status: 400 })
  })
  it('formas de error de otros proveedores', async () => {
    for (const [body, status, needle] of [[Fixtures.mimo401, 401, 'Invalid API Key'], [Fixtures.deepseek401, 401, 'Authentication Fails'],
      [Fixtures.openRouter402, 402, 'Insufficient credits'], [Fixtures.ollamaNoTools400, 400, 'does not support tools']] as const) {
      await expectAIError(run(jsonReply(body, status)), { contains: [needle] })
    }
  })
  it('MiMo: pista si la clave no es del plan de la dirección', async () => {
    const s = setup(jsonReply(Fixtures.mimo401, 401), { baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1', label: 'Xiaomi MiMo' }, { 'test-key': 'sk-1234567890abcdef' })
    await expectAIError(collect(s.model, simple()), { kind: 'missingKey', contains: ['pago por uso', 'https://api.xiaomimimo.com/v1'] })
  })
})

describe('reintentos', () => {
  it('500 y 503 y después bien: retroceso exponencial', async () => {
    const r = await run([jsonReply('{"error":{"message":"boom"}}', 500), jsonReply('', 503), sseReply(Fixtures.openAIText)])
    expect(r.lines[r.lines.length - 1]).toBe('finished:stop')
    expect(r.mf.requests).toHaveLength(3)
    expect(r.deps.sleeps).toEqual([1, 2])
  })
  it('5xx agota los 4 reintentos', async () => {
    const r = await run(jsonReply('{"error":{"message":"caído"}}', 503))
    await expectAIError(Promise.resolve(r), { status: 503, code: 'ai_server', contains: ['no está disponible', 'caído'] })
    expect(r.mf.requests).toHaveLength(5)
    expect(r.deps.sleeps).toEqual([1, 2, 4, 8])
  })
  it('Retry-After en un 503 se respeta', async () => {
    const r = await run([jsonReply('', 503, { 'Retry-After': '3' }), sseReply(Fixtures.openAIText)])
    expect(r.deps.sleeps).toEqual([3])
  })
  it('fallos de red antes del primer byte se reintentan', async () => {
    const r = await run([{ networkError: netError('ECONNRESET') }, { networkError: netError('ECONNREFUSED') }, sseReply(Fixtures.openAIText)])
    expect(r.lines[r.lines.length - 1]).toBe('finished:stop')
    expect(r.mf.requests).toHaveLength(3)
    expect(r.deps.sleeps).toHaveLength(2)
    const down = await run({ networkError: netError('ENETUNREACH') })
    await expectAIError(Promise.resolve(down), { kind: 'network', code: 'ai_network', contains: ['internet'] })
    expect(down.mf.requests).toHaveLength(5)
    const tls = await run({ networkError: netError('CERT_HAS_EXPIRED') })
    await expectAIError(Promise.resolve(tls), { kind: 'network', contains: ['TLS'] })
    expect(tls.mf.requests).toHaveLength(1)
  })
  it('un 200 vacío se reintenta y después se informa', async () => {
    const r = await run({ status: 200, headers: sseHeaders, chunks: [] })
    await expectAIError(Promise.resolve(r), { kind: 'badResponse', contains: ['respuesta vacía'] })
    expect(r.mf.requests).toHaveLength(5)
  })
  it('maxRetries 0 desactiva los reintentos', async () => {
    const s = setup(jsonReply('', 500), {}, undefined, { maxRetries: 0 })
    await expectAIError(collect(s.model, simple()), { status: 500 })
    expect(s.mf.requests).toHaveLength(1)
  })
  it('sin reintento tras el primer byte: lo recibido se entrega', async () => {
    const r = await run({ status: 200, headers: sseHeaders, chunks: [data('{"choices":[{"index":0,"delta":{"content":"Hola a med"}}]}')], cutAfterChunks: netError('ECONNRESET', 'terminated') })
    await expectAIError(Promise.resolve(r), { kind: 'network', contains: ['incompleta'] })
    expect(r.lines).toEqual(['text:Hola a med'])
    expect(r.mf.requests).toHaveLength(1)
  })
  it('un flujo cortado sin terminador es un error', async () => {
    const r = await run(sseReply(data('{"choices":[{"index":0,"delta":{"content":"Hola"}}]}')))
    await expectAIError(Promise.resolve(r), { kind: 'network', contains: ['se cortó antes de que terminara'] })
    expect(r.mf.requests).toHaveLength(1)
  })
})

describe('errores dentro del flujo', () => {
  it('objeto de error en el flujo (no se reintenta) y el texto previo se entrega', async () => {
    const r = await run(sseReply(data('{"choices":[{"index":0,"delta":{"content":"Antes del fallo"}}]}') + data('{"error":{"message":"Internal error while generating","type":"server_error","code":"server_error"}}')))
    await expectAIError(Promise.resolve(r), { kind: 'badResponse', contains: ['Internal error while generating'] })
    expect(r.mf.requests).toHaveLength(1)
    expect(r.lines).toEqual(['text:Antes del fallo'])
  })
  it('OpenRouter a mitad del flujo, 429 dentro del flujo y evento «error»', async () => {
    await expectAIError(run(sseReply(Fixtures.openRouterMidStreamError)), { kind: 'badResponse', contains: ['Provider disconnected unexpectedly'] })
    await expectAIError(run(sseReply(data('{"error":{"code":429,"message":"Rate limited upstream"}}'))), { kind: 'rateLimited', status: 429 })
    await expectAIError(run(sseReply('event: error\ndata: {"error":{"message":"modelo caído"}}\n\n')), { kind: 'badResponse', contains: ['modelo caído'] })
  })
  it('la clave en un error del flujo se oculta', async () => {
    await expectAIError(run(sseReply(data('{"error":{"message":"bad key sk-test-1234567890abcdefXYZ"}}'))), { notContains: [TEST_KEY] })
  })
  it('error dentro de un JSON con 200 y finish_reason «error» sin detalle', async () => {
    await expectAIError(run(jsonReply('{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day"}}')), { kind: 'rateLimited', contains: ['Rate limit exceeded'] })
    await expectAIError(run(jsonReply('{"error":"el modelo se está cargando"}')), { kind: 'badResponse', contains: ['el modelo se está cargando'] })
    await expectAIError(run(sseReply(data('{"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}') + DONE)), { kind: 'badResponse', contains: ['terminó la respuesta con un error'] })
  })
})

describe('cancelación y plazos', () => {
  it('cancelar a mitad corta la petición y entrega lo recibido', async () => {
    const s = setup({ status: 200, headers: sseHeaders, chunks: [data('{"choices":[{"index":0,"delta":{"content":"Hola"}}]}')], hang: true })
    const ctl = new AbortController()
    const events: string[] = []
    const p = s.model.complete(simple('x', { timeoutSec: 60 }), { signal: ctl.signal, onDelta: (e) => {
      events.push(line(e))
      ctl.abort()
    } })
    const err = await p.catch((e) => e)
    expect(isCancellation(err)).toBe(true)
    expect((err as AIError).code).toBe('cancelled')
    expect(events).toEqual(['text:Hola'])
  })
  it('cancelar esperando las cabeceras o durante la espera de un reintento', async () => {
    const s = setup({ hangBeforeHeaders: true })
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 30)
    expect(isCancellation(await s.model.complete(simple(), { signal: ctl.signal }).catch((e) => e))).toBe(true)
    const ctl2 = new AbortController()
    setTimeout(() => ctl2.abort(), 50)
    const mf = mockFetch([jsonReply('', 503)])
    const model = new OpenAICompatibleModel(openAIConfig(), { ...testDeps(mf.fetch, { 'test-key': TEST_KEY }), http: { fetch: mf.fetch, baseBackoffSec: 30, maxBackoffSec: 30 } })
    expect(isCancellation(await model.complete(simple(), { signal: ctl2.signal }).catch((e) => e))).toBe(true)
    expect(mf.requests).toHaveLength(1)
  })
  it('inactividad tras algunos datos (no se reintenta) y antes de las cabeceras', async () => {
    const s = setup({ status: 200, headers: sseHeaders, chunks: [data('{"choices":[{"index":0,"delta":{"content":"Hola"}}]}')], hang: true }, {}, undefined, { idleTimeoutSec: 0.3 })
    const t0 = Date.now()
    await expectAIError(collect(s.model, simple('x', { timeoutSec: 60 })), { kind: 'timeout', code: 'ai_timeout', contains: ['ningún dato'] })
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(s.mf.requests).toHaveLength(1)
    const h = setup({ hangBeforeHeaders: true }, {}, undefined, { idleTimeoutSec: 0.3 })
    await expectAIError(collect(h.model, simple('x', { timeoutSec: 60 })), { kind: 'timeout' })
  })
  it('los comentarios keep-alive mantienen viva la conexión', async () => {
    const chunks = [...Array(6).fill(': keep-alive\n\n'), data('{"choices":[{"index":0,"delta":{"content":"tarde"},"finish_reason":"stop"}]}') + DONE]
    const s = setup({ status: 200, headers: sseHeaders, chunks, chunkDelayMs: 120 }, {}, undefined, { idleTimeoutSec: 0.5 })
    const r = await collect(s.model, simple('x', { timeoutSec: 60 }))
    expect(r.error).toBeUndefined()
    expect(digest(r.events).text).toBe('tarde')
  })
  it('plazo total de la petición', async () => {
    const chunk = data('{"choices":[{"index":0,"delta":{"content":"."}}]}')
    const s = setup({ status: 200, headers: sseHeaders, chunks: Array(200).fill(chunk), chunkDelayMs: 30 })
    const t0 = Date.now()
    await expectAIError(collect(s.model, simple('x', { timeoutSec: 0.4 })), { kind: 'timeout', contains: ['no terminó de responder'] })
    expect(Date.now() - t0).toBeLessThan(4000)
  })
})

describe('compatibilidad automática', () => {
  const ok = sseReply(Fixtures.openAIText)
  const body = (r: { mf: { requests: { body: unknown }[] } }, i: number) => r.mf.requests[i].body as Record<string, unknown>

  it('temperature rechazada: se quita y se reintenta (no cuenta como reintento de red)', async () => {
    const reject = jsonReply('{"error":{"message":"Unsupported value: \'temperature\' does not support 0.3 with this model. Only the default (1) value is supported.","type":"invalid_request_error","param":"temperature","code":"unsupported_value"}}', 400)
    const r = await run([reject, ok], { model: 'm', messages: [msg.user('x')], temperature: 0.3 })
    expect(r.lines[r.lines.length - 1]).toBe('finished:stop')
    expect(r.mf.requests).toHaveLength(2)
    expect(body(r, 0).temperature).toBe(0.3)
    expect(body(r, 1).temperature).toBeUndefined()
    expect(r.deps.sleeps).toEqual([])
  })
  it('max_tokens ↔ max_completion_tokens', async () => {
    const r = await run([jsonReply('{"error":{"message":"Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.","type":"invalid_request_error"}}', 400), ok],
      { model: 'm', messages: [msg.user('x')], maxTokens: 256 })
    expect(body(r, 0).max_tokens).toBe(256)
    expect(body(r, 1).max_tokens).toBeUndefined()
    expect(body(r, 1).max_completion_tokens).toBe(256)
    const back = await run([jsonReply('{"error":{"message":"Unrecognized request argument supplied: max_completion_tokens"}}', 400), ok],
      { model: 'm', messages: [msg.user('x')], maxTokens: 64 }, { extraHeaders: { useMaxCompletionTokens: 'true' } })
    expect(body(back, 1).max_tokens).toBe(64)
    expect(body(back, 1).max_completion_tokens).toBeUndefined()
  })
  it('stream_options rechazado', async () => {
    const r = await run([jsonReply('{"error":{"message":"Unrecognized request argument supplied: stream_options"}}', 400), ok])
    expect(body(r, 1).stream_options).toBeUndefined()
    expect(body(r, 1).stream).toBe(true)
  })
  it('varios parámetros seguidos', async () => {
    const r = await run([jsonReply('{"error":{"message":"Unsupported parameter: temperature"}}', 400), jsonReply('{"error":{"message":"response_format is not supported by this model"}}', 422),
      jsonReply('{"error":{"message":"reasoning_effort: unknown field"}}', 400), ok],
    { model: 'm', messages: [msg.user('x')], temperature: 0.1, jsonMode: true, reasoningEffort: 'high' }, { supportsJSONMode: true })
    expect(r.mf.requests).toHaveLength(4)
    const last = body(r, 3)
    expect(last.temperature).toBeUndefined()
    expect(last.response_format).toBeUndefined()
    expect(last.reasoning_effort).toBeUndefined()
  })
  it('el mismo rechazo dos veces se informa', async () => {
    const r = await run(jsonReply('{"error":{"message":"Unsupported parameter: temperature"}}', 400), { model: 'm', messages: [msg.user('x')], temperature: 0.1 })
    await expectAIError(Promise.resolve(r), { status: 400, contains: ['temperature'] })
    expect(r.mf.requests).toHaveLength(2)
  })
  it('un error de contexto que nombra max_tokens no es un parámetro mal puesto', async () => {
    const r = await run(jsonReply('{"error":{"message":"max_tokens (64000) plus the prompt exceeds the model context window of 65536 tokens"}}', 400), { model: 'm', messages: [msg.user('x')], maxTokens: 64000 })
    await expectAIError(Promise.resolve(r), { status: 400, code: 'ai_context_length', contains: ['context window'] })
    expect(r.mf.requests).toHaveLength(1)
  })
  it('falta reasoning_content: se rellena y se reintenta', async () => {
    const call = { id: 'c', name: 'get_weather', arguments: { city: 'Lima' } }
    const r = await run([jsonReply('{"error":{"message":"Missing reasoning_content in assistant message: reasoning_content must be passed back","type":"invalid_request_error"}}', 400), ok],
      { model: 'm', messages: [msg.user('x'), msg.assistant('', [call]), msg.toolResult('c', 'get_weather', 'ok')], tools: [weatherTool] })
    expect(r.mf.requests).toHaveLength(2)
    expect((body(r, 0).messages as Record<string, unknown>[])[1].reasoning_content).toBeUndefined()
    expect((body(r, 1).messages as Record<string, unknown>[])[1].reasoning_content).toBe('')
  })
  it('lo rechazado se recuerda para la petición siguiente', async () => {
    const s = setup([jsonReply('{"error":{"message":"Unsupported parameter: temperature"}}', 400), ok, ok])
    await collect(s.model, { model: 'm', messages: [msg.user('x')], temperature: 0.2 })
    await collect(s.model, { model: 'm', messages: [msg.user('y')], temperature: 0.2 })
    expect(s.mf.requests).toHaveLength(3)
    expect((s.mf.requests[2].body as Record<string, unknown>).temperature).toBeUndefined()
  })
  it('un 400 sin arreglo y el rechazo de las herramientas no se reintentan', async () => {
    const r = await run(jsonReply('{"error":{"message":"invalid request: messages must not be empty"}}', 400))
    expect(r.mf.requests).toHaveLength(1)
    const t = await run(jsonReply(Fixtures.ollamaNoTools400, 400), simple('x', { tools: [weatherTool] }))
    await expectAIError(Promise.resolve(t), { status: 400, contains: ['does not support tools'] })
    expect(t.mf.requests).toHaveLength(1)
  })
})

describe('lista de modelos y prueba de conexión', () => {
  const list = async (reply: MockReply | MockReply[], config: Partial<ProviderConfig> = {}, keys: Record<string, string> = { 'test-key': TEST_KEY }) => {
    const mf = mockFetch(Array.isArray(reply) ? reply : [reply])
    const deps = testDeps(mf.fetch, keys)
    try {
      return { mf, ids: await openAIListModels(openAIConfig(config), deps) }
    } catch (error) {
      return { mf, error }
    }
  }
  it('ordenados y sin repetir', async () => {
    const r = await list(jsonReply('{"object":"list","data":[{"id":"gpt-6-sol","object":"model"},{"id":"gpt-6-luna"},{"id":"GPT-5"},{"id":"gpt-6-luna"},{"id":"gpt-10"},{"id":"gpt-9"}]}'))
    expect(r.ids).toEqual(['GPT-5', 'gpt-6-luna', 'gpt-6-sol', 'gpt-9', 'gpt-10'])
    expect(r.mf.requests[0].method).toBe('GET')
    expect(r.mf.requests[0].url).toBe('https://mock.test/v1/models')
    expect(r.mf.requests[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`)
  })
  it('estilo Ollama sin clave y otras formas', async () => {
    const r = await list(jsonReply('{"object":"list","data":[{"id":"qwen3:8b","object":"model"},{"id":"gpt-oss:20b"}]}'), { secretRef: null }, {})
    expect(r.ids).toEqual(['gpt-oss:20b', 'qwen3:8b'])
    expect(r.mf.requests[0].headers.authorization).toBeUndefined()
    for (const b of ['{"models":[{"name":"b"},{"id":"a"},{"model":"c"}]}', '["c","a","b"]', '{"data":["b","a","c"]}', '[{"id":"b"},{"id":"a"},{"id":"c"}]']) {
      expect((await list(jsonReply(b))).ids).toEqual(['a', 'b', 'c'])
    }
  })
  it('quita los modelos que no son de chat', async () => {
    const r = await list(jsonReply('{"data":[{"id":"gpt-6-sol"},{"id":"text-embedding-3-large"},{"id":"whisper-1"},{"id":"tts-1"},{"id":"dall-e-3"}]}'))
    expect(r.ids).toEqual(['gpt-6-sol'])
  })
  it('errores: 401, 404, vacía, HTML y sin clave (sin petición)', async () => {
    expect((await list(jsonReply(Fixtures.openAI401, 401))).error).toMatchObject({ kind: 'missingKey', status: 401 })
    expect(((await list(jsonReply('{}', 404))).error as AIError).message).toContain('no permite listar los modelos')
    expect(((await list(jsonReply('{"data":[]}'))).error as AIError).message).toContain('no devolvió ningún modelo')
    expect(((await list({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>login</html>' })).error as AIError).message).toContain('no es JSON')
    const missing = await list(jsonReply('{}'), {}, {})
    expect(missing.error).toMatchObject({ kind: 'missingKey' })
    expect(missing.mf.requests).toHaveLength(0)
  })
  it('reintenta los fallos pasajeros', async () => {
    const r = await list([jsonReply('', 503), { networkError: netError('ETIMEDOUT') }, jsonReply('{"data":[{"id":"ok"}]}')])
    expect(r.ids).toEqual(['ok'])
    expect(r.mf.requests).toHaveLength(3)
  })
  it('la prueba devuelve la respuesta del modelo', async () => {
    const mf = mockFetch([sseReply(data('{"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}') + DONE)])
    expect(await openAIPing(openAIConfig({ model: 'modelo-ping' }), testDeps(mf.fetch, { 'test-key': TEST_KEY }))).toBe('OK')
    const b = mf.requests[0].body as Record<string, unknown>
    expect(b.model).toBe('modelo-ping')
    expect(b.messages).toEqual([{ role: 'user', content: 'Responde solo: OK' }])
    expect(b.tools).toBeUndefined()
  })
  it('respuesta solo con razonamiento, vacía, errores y sin modelo', async () => {
    const reasoning = mockFetch([sseReply(data('{"choices":[{"index":0,"delta":{"reasoning_content":"pienso"},"finish_reason":"length"}]}') + DONE)])
    expect(await openAIPing(openAIConfig(), testDeps(reasoning.fetch, { 'test-key': TEST_KEY }))).toContain('conexión correcta')
    const empty = mockFetch([sseReply(data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE)])
    expect(await openAIPing(openAIConfig(), testDeps(empty.fetch, { 'test-key': TEST_KEY }))).toContain('no devolvió texto')
    const e401 = mockFetch([jsonReply(Fixtures.openAI401, 401)])
    await expect(openAIPing(openAIConfig(), testDeps(e401.fetch, { 'test-key': TEST_KEY }))).rejects.toMatchObject({ kind: 'missingKey' })
    await expect(openAIPing(openAIConfig({ model: '' }), testDeps(e401.fetch, { 'test-key': TEST_KEY }))).rejects.toThrow('Elige un modelo')
  })
})
