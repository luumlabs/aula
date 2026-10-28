// Lo que sale por la red, de punta a punta (port de OpenAIRequestTests, ProviderWireTests, ReasoningSelectionWireTests y
// PromptCacheWireTests): cada preset con su host real contra un `fetch` simulado, el cuerpo de `chat/completions`, la Responses
// API de OpenAI, el razonamiento elegido y la caché de prompts con el bucle de herramientas real.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { msg, type ChatMessage, type ChatRequest, type ToolCall, type ToolSpec } from '@shared/ai/types'
import type { JSONObject, JSONValue } from '@shared/ai/json'
import type { AgentTool, ChatModel } from '../model'
import { AIError } from '../errors'
import { canonicalJSON } from '../core/json'
import { runToolLoop, type ToolLoopOptions } from '../loop/toolLoop'
import { configFromPreset, modernized, presetById } from '../presets'
import { Fixtures } from '../testing/fixtures'
import { jsonReply, mockFetch, sseReply, testDeps, type MockReply } from '../testing/mocks'
import { AnthropicModel } from './anthropic'
import type { ProviderConfig } from './config'
import { FixupMemory, ThinkingVault } from './memory'
import { OpenAICompatibleModel, openAIListModels } from './openai'
import { chatBody, detectQuirks } from './openaiRequest'
import { responsesBody } from './openaiResponses'
import { likelyChatModels } from '../http/requester'
import { mimoMismatchHint } from './keys'
import { parseOpenAIUsage } from './openaiDecoder'
import { USER_AGENT } from './base'

const TEST_KEY = 'sk-test-1234567890abcdefXYZ'
const data = (json: string) => `data: ${json}\n\n`
const ev = (name: string, json: string) => `event: ${name}\ndata: ${json}\n\n`
const DONE = 'data: [DONE]\n\n'
const at = (v: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((cur, p) => (cur as Record<string | number, unknown> | undefined)?.[p], v)
type Body = Record<string, JSONValue>

const weatherTool: ToolSpec = {
  name: 'get_weather', description: 'Clima de una ciudad',
  inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'Ciudad' } }, required: ['city'], additionalProperties: false }
}

function preset(id: string): ProviderConfig {
  const p = presetById(id)
  if (!p) throw new Error(`sin preset ${id}`)
  return configFromPreset(p, p.label.es)
}

function modelFor(cfg: ProviderConfig, fetchScript: MockReply[], keys: Record<string, string> = { [cfg.secretRef ?? 'none']: TEST_KEY }) {
  const mf = mockFetch(fetchScript)
  const vault = new ThinkingVault()
  const fixups = new FixupMemory()
  const deps = testDeps(mf.fetch, keys, { vault, fixups })
  const model: ChatModel = cfg.kind === 'anthropic' ? new AnthropicModel(cfg, deps) : new OpenAICompatibleModel(cfg, deps)
  return { mf, model, vault, fixups, deps }
}

const chatOK = data('{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"O"}}]}')
  + data('{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"K"},"finish_reason":"stop"}]}')
  + data('{"id":"c1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}') + DONE
const responsesOK = ev('response.created', '{"type":"response.created","response":{"id":"resp_1","status":"in_progress","output":[]},"sequence_number":0}')
  + ev('response.output_item.added', '{"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message","status":"in_progress","role":"assistant","content":[]},"sequence_number":1}')
  + ev('response.output_text.delta', '{"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"O","sequence_number":2}')
  + ev('response.output_text.delta', '{"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"K","sequence_number":3}')
  + ev('response.completed', '{"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[],"usage":{"input_tokens":12,"output_tokens":2,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":4}}},"sequence_number":4}')
const anthropicOK = ev('message_start', '{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"usage":{"input_tokens":12,"output_tokens":1}}}')
  + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
  + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}')
  + ev('content_block_stop', '{"type":"content_block_stop","index":0}')
  + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}')
  + ev('message_stop', '{"type":"message_stop"}')

const hostOf = (cfg: ProviderConfig) => new URL(cfg.baseURL!).hostname
const okReply = (cfg: ProviderConfig): MockReply => sseReply(cfg.kind === 'anthropic' ? anthropicOK : hostOf(cfg) === 'api.openai.com' ? responsesOK : chatOK)
const fullRequest: ChatRequest = { model: '', messages: [msg.system('Eres breve.'), msg.user('Hola')], tools: [weatherTool], temperature: 0.3, reasoningEffort: 'low', timeoutSec: 20 }
const textOf = (m: ChatMessage) => m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')

beforeEach(() => setAILocale('es'))

describe('cada preset habla su protocolo', () => {
  it('ruta, cabeceras, cuerpo y respuesta', async () => {
    for (const id of ['deepseek', 'mimo', 'openrouter', 'openai', 'anthropic', 'opencode-zen', 'ollama']) {
      const cfg = preset(id)
      const { mf, model } = modelFor(cfg, [okReply(cfg)])
      const res = await model.complete(fullRequest)
      expect(textOf(res.message), id).toBe('OK')
      const r = mf.requests[0]
      const b = r.body as Body
      expect(r.method).toBe('POST')
      expect(b.model, id).toBe(cfg.model)
      expect(b.stream, id).toBe(true)
      expect(Object.keys(r.headers).some((k) => k.startsWith('x-aula-')), id).toBe(false)
      expect(r.headers['user-agent']).toBe(USER_AGENT)
      switch (id) {
        case 'deepseek':
          expect(r.url).toBe('https://api.deepseek.com/v1/chat/completions')
          expect(r.headers.authorization).toBe(`Bearer ${TEST_KEY}`)
          expect(b.max_tokens).toBe(64_000)
          expect(b.thinking).toEqual({ type: 'enabled' })
          expect(b.reasoning_effort).toBe('low')
          expect(at(b, 'stream_options', 'include_usage')).toBe(true)
          expect(at(b, 'tools', 0, 'function', 'name')).toBe('get_weather')
          break
        case 'mimo':
          expect(r.url).toBe('https://token-plan-sgp.xiaomimimo.com/v1/chat/completions')
          expect(b.max_completion_tokens).toBe(64_000)
          expect(b.max_tokens).toBeUndefined()
          expect(b.reasoning_effort).toBe('low')
          break
        case 'openrouter':
          expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions')
          expect(r.headers['http-referer']).toBe('https://aula.local')
          expect(r.headers['x-openrouter-title']).toBe('Aula')
          expect(r.headers['x-title']).toBe('Aula')
          expect(b.reasoning).toEqual({ effort: 'low' })
          expect(b.reasoning_effort).toBeUndefined()
          break
        case 'openai':
          expect(r.url).toBe('https://api.openai.com/v1/responses')
          expect(b.store).toBe(false)
          expect(b.instructions).toBe('Eres breve.')
          expect(at(b, 'input', 0)).toEqual({ role: 'user', content: 'Hola' })
          expect(at(b, 'tools', 0)).toMatchObject({ type: 'function', name: 'get_weather' })
          expect(at(b, 'tools', 0, 'parameters')).toBeDefined()
          expect(b.reasoning).toEqual({ effort: 'low', summary: 'auto' })
          expect(b.max_output_tokens).toBe(64_000)
          expect(b.temperature).toBeUndefined()
          expect(b.messages).toBeUndefined()
          expect(b.stream_options).toBeUndefined()
          break
        case 'anthropic':
          expect(r.url).toBe('https://api.anthropic.com/v1/messages')
          expect(r.headers['x-api-key']).toBe(TEST_KEY)
          expect(r.headers['anthropic-version']).toBe('2023-06-01')
          expect(r.headers.authorization).toBeUndefined()
          expect(b.system).toBe('Eres breve.')
          expect(b.max_tokens).toBe(32_000)
          expect(b.output_config).toEqual({ effort: 'low' })
          expect(b.temperature).toBeUndefined()
          expect(b.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
          expect(b.tool_choice).toBeUndefined()
          expect(at(b, 'tools', 0, 'input_schema')).toBeDefined()
          break
        case 'opencode-zen':
          expect(r.url).toBe('https://opencode.ai/inference/v1/chat/completions')
          expect(r.headers.authorization).toBe(`Bearer ${TEST_KEY}`)
          break
        case 'ollama':
          expect(r.url).toBe('http://localhost:11434/v1/chat/completions')
          expect(r.headers.authorization).toBeUndefined()
          expect(b.tool_choice).toBeUndefined()
          break
      }
      expect(res.usage.completionTokens, id).toBe(2)
    }
  })

  it('los errores nombran al proveedor (401, 403, 429 con espera, 5xx reintentado)', async () => {
    for (const id of ['deepseek', 'mimo', 'openrouter', 'openai', 'anthropic', 'opencode-zen']) {
      const cfg = preset(id)
      const name = cfg.label
      const anthropic = cfg.kind === 'anthropic'
      const err = (type: string, message: string) => anthropic
        ? `{"type":"error","error":{"type":"${type}","message":"${message}"},"request_id":"req_1"}`
        : `{"error":{"message":"${message}","type":"${type}","code":null}}`
      const e401 = await modelFor(cfg, [jsonReply(err('authentication_error', `invalid x-api-key ${TEST_KEY}`), 401)]).model.complete(fullRequest).catch((e) => e)
      expect(e401).toMatchObject({ kind: 'missingKey', status: 401 })
      expect(e401.message).toContain(name)
      expect(e401.message).toContain('401')
      expect(e401.message).not.toContain(TEST_KEY)
      const e403 = await modelFor(cfg, [jsonReply(err('permission_error', 'not allowed'), 403)]).model.complete(fullRequest).catch((e) => e)
      expect(e403).toMatchObject({ kind: 'http', status: 403 })
      const limited = modelFor(cfg, [jsonReply(err('rate_limit_error', 'Rate limit reached'), 429, { 'Retry-After': '30' })])
      const e429 = await limited.model.complete(fullRequest).catch((e) => e)
      expect(e429).toMatchObject({ kind: 'rateLimited', retryAfter: 30 })
      expect(e429.message).toContain(name)
      expect(limited.mf.requests).toHaveLength(1)
      const flaky = modelFor(cfg, [jsonReply(err('api_error', 'Internal server error'), 500), okReply(cfg)])
      expect(textOf((await flaky.model.complete(fullRequest)).message)).toBe('OK')
      expect(flaky.mf.requests).toHaveLength(2)
    }
  })

  it('OpenAI: los códigos de saldo agotado no son una espera', async () => {
    for (const code of ['credit_balance_exhausted', 'organization_spend_limit_exceeded', 'insufficient_quota']) {
      const e = await modelFor(preset('openai'), [jsonReply(`{"error":{"message":"Request blocked.","type":"${code}","code":"${code}"}}`, 429)]).model.complete(fullRequest).catch((x) => x)
      expect(e).toMatchObject({ kind: 'http', status: 429, code: 'ai_quota' })
      expect(e.message).toContain('OpenAI')
      expect(e.message).toContain('saldo')
    }
  })
})

describe('Responses API (OpenAI)', () => {
  const reasoningAndCall = (encrypted = 'gAAAAB-cifrado') =>
    ev('response.created', '{"type":"response.created","response":{"id":"resp_1","status":"in_progress","output":[]}}')
    + ev('response.output_item.added', '{"type":"response.output_item.added","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}')
    + ev('response.reasoning_summary_text.delta', '{"type":"response.reasoning_summary_text.delta","item_id":"rs_1","output_index":0,"summary_index":0,"delta":"Miro el clima."}')
    + ev('response.output_item.done', `{"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Miro el clima."}],"encrypted_content":"${encrypted}"}}`)
    + ev('response.output_item.added', '{"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","status":"in_progress","call_id":"call_1","name":"get_weather","arguments":""}}')
    + ev('response.function_call_arguments.delta', '{"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"{\\"city\\":"}')
    + ev('response.function_call_arguments.delta', '{"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"\\"París\\"}"}')
    + ev('response.function_call_arguments.done', '{"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":1,"arguments":"{\\"city\\":\\"París\\"}"}')
    + ev('response.output_item.done', '{"type":"response.output_item.done","output_index":1,"item":{"id":"fc_1","type":"function_call","status":"completed","call_id":"call_1","name":"get_weather","arguments":"{\\"city\\":\\"París\\"}"}}')
    + ev('response.completed', '{"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":30,"output_tokens":20,"output_tokens_details":{"reasoning_tokens":12}}}}')

  const loop = (model: ChatModel, tools: AgentTool[], prompt = 'Clima', extra: Partial<ToolLoopOptions> = {}) => {
    const events: string[] = []
    const reasoning: string[] = []
    return runToolLoop({ model, prompt, tools, sleep: async () => {}, onEvent: (e) => {
      events.push(e.type)
      if (e.type === 'reasoning') reasoning.push(e.text)
    }, ...extra }).then((result) => ({ result, events, reasoning }))
  }

  it('el bucle reenvía el razonamiento cifrado delante de su llamada', async () => {
    const { mf, model } = modelFor(preset('openai'), [sseReply(reasoningAndCall()), sseReply(responsesOK)])
    const seen: JSONObject[] = []
    const tool: AgentTool = { ...weatherTool, run: (args) => {
      seen.push(args)
      return 'Soleado, 21 °C'
    } }
    const { result, reasoning } = await loop(model, [tool], '¿Qué tiempo hace en París?')
    expect(seen[0].city).toBe('París')
    expect(reasoning.join('')).toContain('Miro el clima')
    expect(result.text).toBe('OK')
    const second = at(mf.requests[1].body, 'input') as JSONObject[]
    expect(second.map((x) => (x.type as string) ?? 'role:' + x.role)).toEqual(['role:user', 'reasoning', 'function_call', 'function_call_output'])
    expect(second[1]).toMatchObject({ encrypted_content: 'gAAAAB-cifrado', id: 'rs_1' })
    expect(second[2].call_id).toBe('call_1')
    expect(JSON.parse(second[2].arguments as string).city).toBe('París')
    expect(second[3]).toMatchObject({ call_id: 'call_1', output: 'Soleado, 21 °C' })
  })
  it('si rechaza el razonamiento reenviado, se repite sin él', async () => {
    const rejected = jsonReply('{"error":{"message":"The encrypted content for item rs_1 could not be verified.","type":"invalid_request_error","param":"input","code":"invalid_encrypted_content"}}', 400)
    const { mf, model } = modelFor(preset('openai'), [sseReply(reasoningAndCall()), rejected, sseReply(responsesOK)])
    const { result } = await loop(model, [{ ...weatherTool, run: () => 'Soleado' }])
    expect(result.text).toBe('OK')
    expect(mf.requests).toHaveLength(3)
    const retried = at(mf.requests[2].body, 'input') as JSONObject[]
    expect(retried.some((x) => x.type === 'reasoning')).toBe(false)
    expect(retried.some((x) => x.type === 'function_call_output')).toBe(true)
  })
  it('finales y errores: incompleta, negativa, fallo, límite y corte', async () => {
    const cfg = preset('openai')
    const incomplete = ev('response.output_text.delta', '{"type":"response.output_text.delta","item_id":"m","output_index":0,"content_index":0,"delta":"Hola"}')
      + ev('response.incomplete', '{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}')
    const cut = await modelFor(cfg, [sseReply(incomplete)]).model.complete(fullRequest)
    expect(cut.finish).toBe('length')
    expect(textOf(cut.message)).toBe('Hola')
    const refusal = ev('response.refusal.delta', '{"type":"response.refusal.delta","item_id":"m","output_index":0,"content_index":0,"delta":"No puedo ayudar con eso."}')
      + ev('response.completed', '{"type":"response.completed","response":{"status":"completed"}}')
    expect((await modelFor(cfg, [sseReply(refusal)]).model.complete(fullRequest)).finish).toBe('contentFilter')
    const failed = ev('response.failed', '{"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"The model failed to generate a response."}}}')
    const f = await modelFor(cfg, [sseReply(failed)]).model.complete(fullRequest).catch((e) => e)
    expect(f.message).toContain('OpenAI')
    expect(f.message).toContain('The model failed to generate a response.')
    const limited = ev('error', '{"type":"error","code":"rate_limit_exceeded","message":"Rate limit reached for gpt-6-sol","param":null}')
    const l = await modelFor(cfg, [sseReply(limited)]).model.complete(fullRequest).catch((e) => e)
    expect(l).toMatchObject({ kind: 'rateLimited' })
    expect(l.message).toContain('429')
    const broken = await modelFor(cfg, [sseReply(incomplete.split('event: response.incomplete')[0])]).model.complete(fullRequest).catch((e) => e)
    expect(broken).toMatchObject({ kind: 'network' })
    expect(broken.message).toContain('OpenAI')
  })
  it('sin streaming lee la respuesta entera', async () => {
    const cfg = { ...preset('openai'), supportsStreaming: false }
    const { mf, model } = modelFor(cfg, [jsonReply('{"id":"resp_1","object":"response","status":"completed","output":[{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Pienso."}],"encrypted_content":"enc"},{"id":"fc_1","type":"function_call","call_id":"call_9","name":"get_weather","arguments":"{\\"city\\":\\"Lima\\"}","status":"completed"}],"usage":{"input_tokens":5,"output_tokens":7}}')])
    const res = await model.complete(fullRequest)
    expect((mf.requests[0].body as Body).stream).toBe(false)
    expect(res.message.toolCalls![0]).toMatchObject({ id: 'call_9', arguments: { city: 'Lima' } })
    expect(res.message.reasoning).toBe('Pienso.')
    expect(res.finish).toBe('toolCalls')
  })
  it('la opción local elige la API de OpenAI', async () => {
    const cfg = preset('openai')
    cfg.extraHeaders['x-aula-openai-api'] = 'chat'
    const chat = modelFor(cfg, [sseReply(chatOK)])
    await chat.model.complete(fullRequest)
    expect(chat.mf.requests[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect((chat.mf.requests[0].body as Body).max_completion_tokens).toBeDefined()
    const gw: ProviderConfig = { id: 'custom-gw', kind: 'openai-compatible', label: 'Pasarela', baseURL: 'https://gateway.example.com/openai/v1', model: 'gpt-6-sol',
      secretRef: 'k', extraHeaders: { 'x-aula-openai-api': 'responses' }, supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true }
    const r = modelFor(gw, [sseReply(responsesOK)], { k: TEST_KEY })
    expect(textOf((await r.model.complete(fullRequest)).message)).toBe('OK')
    expect(r.mf.requests[0].url).toBe('https://gateway.example.com/openai/v1/responses')
    expect(r.mf.requests[0].headers['x-aula-openai-api']).toBeUndefined()
  })
  it('detalles del cuerpo', () => {
    const cfg = { ...preset('openai'), supportsVision: true }
    const png = { mediaType: 'image/png', base64: 'iVA=' }
    const history: ChatMessage[] = [msg.system('S'), msg.user('Mira', [png]), msg.assistant('Voy.', [{ id: 'call_1', name: 'foto', arguments: {} }]), msg.toolResult('call_1', 'foto', 'ok', [png])]
    const b = responsesBody(cfg, { model: '', messages: history, jsonMode: true, reasoningEffort: 'none' }, true, true, new ThinkingVault()) as Body
    const input = b.input as JSONObject[]
    expect(at(input[0], 'content', 1, 'type')).toBe('input_image')
    expect((at(input[0], 'content', 1, 'image_url') as string).startsWith('data:image/png;base64,')).toBe(true)
    expect(input[1]).toMatchObject({ role: 'assistant', content: 'Voy.' })
    expect(input[2].type).toBe('function_call')
    expect(input[3].type).toBe('function_call_output')
    expect(input[4].role).toBe('user')
    expect(at(b, 'text', 'format', 'type')).toBe('json_object')
    expect(at(b, 'reasoning', 'effort')).toBe('none')
    expect(at(b, 'reasoning', 'summary')).toBeUndefined()
    expect((responsesBody(preset('openai'), { model: '', messages: [msg.user('x')], temperature: 0.2, reasoningEffort: 'none' }, true) as Body).temperature).toBe(0.2)
    expect((responsesBody(preset('openai'), { model: '', messages: [msg.user('x')], temperature: 0.2 }, true) as Body).temperature).toBeUndefined()
  })
})

describe('otros detalles de los presets', () => {
  it('las listas de modelos esconden voz, embeddings e imágenes', async () => {
    const cfg = preset('mimo')
    const mf = mockFetch([jsonReply('{"object":"list","data":[{"id":"mimo-v2.5"},{"id":"mimo-v2.5-asr"},{"id":"mimo-v2.5-tts-voiceclone"},{"id":"mimo-v2.6-flash"},{"id":"mimo-v2.6-pro"},{"id":"text-embedding-3-small"},{"id":"whisper-1"},{"id":"dall-e-3"},{"id":"gpt-image-1"},{"id":"omni-moderation-latest"},{"id":"nomic-embed-text:latest"}]}')])
    expect(await openAIListModels(cfg, testDeps(mf.fetch, { [cfg.secretRef!]: TEST_KEY }))).toEqual(['mimo-v2.5', 'mimo-v2.6-flash', 'mimo-v2.6-pro'])
    expect(likelyChatModels(['whisper-1'])).toEqual(['whisper-1'])
    expect(likelyChatModels(['qwen3:8b', 'llama-embedded-chat', 'gpt-6-sol'])).toEqual(['qwen3:8b', 'llama-embedded-chat', 'gpt-6-sol'])
  })
  it('MiMo: clave de un plan con la dirección del otro', async () => {
    const cfg = preset('mimo')
    const key = 'sk-' + 'pagoporuso1234567890'
    const e = await modelFor(cfg, [jsonReply('{"error":{"code":"401","message":"Invalid API Key","type":"invalid_key"}}', 401)], { [cfg.secretRef!]: key }).model.complete(fullRequest).catch((x) => x)
    expect(e).toMatchObject({ kind: 'missingKey' })
    for (const s of ['401', 'sk-', 'https://api.xiaomimimo.com/v1']) expect(e.message).toContain(s)
    expect(e.message).not.toContain(key)
    const payg = { ...cfg, baseURL: 'https://api.xiaomimimo.com/v1' }
    const e2 = await modelFor(payg, [jsonReply('{"error":{"message":"Invalid API Key"}}', 401)], { [cfg.secretRef!]: 'tp-' + 'plan1234567890abcdef' }).model.complete(fullRequest).catch((x) => x)
    expect(e2.message).toContain('tp-')
    expect(e2.message).toContain('Token Plan')
    expect(mimoMismatchHint('token-plan-sgp.xiaomimimo.com', 'tp-123')).toBeUndefined()
    expect(mimoMismatchHint('api.deepseek.com', 'sk-123')).toBeUndefined()
  })
  it('un servidor de este ordenador sin clave se llama sin Authorization (y con ella si la hay)', async () => {
    const cfg: ProviderConfig = { id: 'custom-lm', kind: 'openai-compatible', label: 'LM Studio propio', baseURL: 'http://localhost:1234/v1', model: 'qwen3-8b',
      secretRef: 'ai.key.custom-lm', extraHeaders: {}, supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true }
    const a = modelFor(cfg, [sseReply(chatOK)], {})
    expect(textOf((await a.model.complete(fullRequest)).message)).toBe('OK')
    expect(a.mf.requests[0].headers.authorization).toBeUndefined()
    const keyed = modelFor(cfg, [sseReply(chatOK)], { 'ai.key.custom-lm': 'lm-token-123' })
    await keyed.model.complete(fullRequest)
    expect(keyed.mf.requests[0].headers.authorization).toBe('Bearer lm-token-123')
    const remote = modelFor({ ...cfg, id: 'custom-x', label: 'Remoto', baseURL: 'https://llm.example.com/v1' }, [sseReply(chatOK)], {})
    const e = await remote.model.complete(fullRequest).catch((x) => x)
    expect(e).toMatchObject({ kind: 'missingKey' })
    expect(e.message).toContain('Remoto')
  })
  it('una negativa a mitad de una llamada nunca ejecuta la herramienta', async () => {
    const refusal = ev('message_start', '{"type":"message_start","message":{"id":"m","usage":{"input_tokens":5,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\": \\"Pa"}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":3}}')
      + ev('message_stop', '{"type":"message_stop"}')
    const { mf, model } = modelFor(preset('anthropic'), [sseReply(refusal)])
    let ran = 0
    const notices: string[] = []
    const result = await runToolLoop({ model, prompt: 'Clima', tools: [{ ...weatherTool, run: () => (ran++, 'x') }], sleep: async () => {},
      onEvent: (e) => e.type === 'notice' && notices.push(e.text) })
    expect(ran).toBe(0)
    expect(mf.requests).toHaveLength(1)
    expect(result.stopReason).toBe('content_filter')
    expect(notices.some((n) => n.includes('filtro'))).toBe(true)
  })
  it('valores antiguos de los presets se ponen al día', () => {
    const zen = preset('opencode-zen')
    expect(modernized({ ...zen, baseURL: 'https://opencode.ai/zen/v1' }).baseURL).toBe('https://opencode.ai/inference/v1')
    expect(modernized({ ...zen, baseURL: 'https://mi-pasarela.example.com/v1' }).baseURL).toBe('https://mi-pasarela.example.com/v1')
    const mimo = preset('mimo')
    expect(modernized({ ...mimo, model: 'mimo-v2.5-pro' }).model).toBe('mimo-v2.6-pro')
    expect(modernized({ ...mimo, id: 'mi-mimo', baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' }).model).toBe('mimo-v2.6-pro')
    expect(modernized({ ...mimo, model: 'mimo-v2.6-flash' })).toEqual({ ...mimo, model: 'mimo-v2.6-flash' })
    expect(modernized({ ...preset('deepseek'), model: 'deepseek-chat' }).model).toBe('deepseek-flash')
  })
})

describe('cuerpo de chat/completions', () => {
  const config = (o: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 't', kind: 'openai-compatible', label: 'Prueba', baseURL: 'https://x.test/v1', model: 'modelo-x', secretRef: null, extraHeaders: {},
    supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true, ...o
  })
  const body = (c: ProviderConfig, r: ChatRequest, stream = true) => chatBody(c, r, stream, detectQuirks(c)) as Body
  const simple: ChatRequest = { model: '', messages: [msg.user('Hola')] }

  it('mínimo, orden y modelo de la configuración', () => {
    expect(body(config(), { model: 'm1', messages: [msg.user('Hola')] })).toEqual({ model: 'm1', messages: [{ role: 'user', content: 'Hola' }], stream: true, stream_options: { include_usage: true } })
    const b = body(config(), { model: '', messages: [msg.system('Eres un tutor.'), msg.user('Hola')] })
    expect(b.model).toBe('modelo-x')
    expect(b.messages).toEqual([{ role: 'system', content: 'Eres un tutor.' }, { role: 'user', content: 'Hola' }])
  })
  it('cadena «golden» determinista', () => {
    expect(canonicalJSON(body(config(), { model: 'm', messages: [msg.system('S'), msg.user('U')], tools: [weatherTool], temperature: 0.2, maxTokens: 100 })))
      .toBe('{"max_tokens":100,"messages":[{"content":"S","role":"system"},{"content":"U","role":"user"}],"model":"m","stream":true,"stream_options":{"include_usage":true},"temperature":0.2,"tools":[{"function":{"description":"Clima de una ciudad","name":"get_weather","parameters":{"additionalProperties":false,"properties":{"city":{"description":"Ciudad","type":"string"}},"required":["city"],"type":"object"}},"type":"function"}]}')
  })
  it('muestreo, max_tokens, JSON y razonamiento', () => {
    const b = body(config(), simple)
    for (const k of ['temperature', 'top_p', 'max_tokens', 'tools', 'response_format', 'reasoning_effort']) expect(b[k]).toBeUndefined()
    const s = body(config(), { model: 'm', messages: [msg.user('x')], temperature: 0, topP: 0.9 })
    expect(s.temperature).toBe(0)
    expect(s.top_p).toBe(0.9)
    expect(body(config(), { model: 'm', messages: [msg.user('x')], maxTokens: 500 }).max_tokens).toBe(500)
    const oa = body(config({ baseURL: 'https://api.openai.com/v1', extraHeaders: { 'x-aula-openai-api': 'chat' } }), { model: 'm', messages: [msg.user('x')], maxTokens: 500 })
    expect(oa.max_completion_tokens).toBe(500)
    expect(oa.max_tokens).toBeUndefined()
    expect(body(config({ maxOutputTokens: 4096 }), simple).max_tokens).toBe(4096)
    expect(body(config({ maxOutputTokens: 4096 }), { model: 'm', messages: [msg.user('x')], maxTokens: 77 }).max_tokens).toBe(77)
    expect(body(config({ supportsJSONMode: true }), { model: 'm', messages: [msg.user('x')], jsonMode: true }).response_format).toEqual({ type: 'json_object' })
    expect(body(config(), { model: 'm', messages: [msg.user('x')], jsonMode: true }).response_format).toBeUndefined()
    expect(body(config(), { model: 'm', messages: [msg.user('x')], reasoningEffort: 'high' }).reasoning_effort).toBe('high')
    const or = body(config({ baseURL: 'https://openrouter.ai/api/v1' }), { model: 'm', messages: [msg.user('x')], reasoningEffort: 'high' })
    expect(or.reasoning).toEqual({ effort: 'high' })
    expect(or.reasoning_effort).toBeUndefined()
  })
  it('herramientas y tool_choice (auto no se envía; sin herramientas, nada)', () => {
    const tools: ToolSpec[] = [weatherTool, { name: 'sin_parametros', description: 'x', inputSchema: {} }]
    const b = body(config(), { model: 'm', messages: [msg.user('x')], tools })
    expect(at(b, 'tools', 0)).toEqual({ type: 'function', function: { name: 'get_weather', description: 'Clima de una ciudad', parameters: weatherTool.inputSchema } })
    expect(at(b, 'tools', 1, 'function', 'parameters')).toEqual({ type: 'object', properties: {} })
    expect(b.tool_choice).toBeUndefined()
    expect(body(config(), { model: 'm', messages: [msg.user('x')], tools, toolChoice: 'none' }).tool_choice).toBe('none')
    expect(body(config(), { model: 'm', messages: [msg.user('x')], tools, toolChoice: 'required' }).tool_choice).toBe('required')
    expect(body(config(), { model: 'm', messages: [msg.user('x')], tools, toolChoice: { name: 'get_weather' } }).tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
    const none = body(config(), { model: 'm', messages: [msg.user('x')], toolChoice: 'required' })
    expect(none.tool_choice).toBeUndefined()
    expect(none.tools).toBeUndefined()
  })
  it('llamadas y resultados; texto del asistente; mensaje vacío', () => {
    const call: ToolCall = { id: 'call_1', name: 'get_weather', arguments: { city: 'Bogotá' }, rawArguments: '{"city":"Bogotá"}' }
    expect(body(config(), { model: 'm', messages: [msg.user('¿Clima?'), msg.assistant('', [call]), msg.toolResult('call_1', 'get_weather', '18 °C')], tools: [weatherTool] }).messages).toEqual([
      { role: 'user', content: '¿Clima?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Bogotá"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '18 °C' }
    ])
    const c: ToolCall = { id: 'c', name: 't', arguments: {} }
    expect(at(body(config(), { model: 'm', messages: [msg.user('x'), msg.assistant('Voy a mirar.', [c]), msg.toolResult('c', 't', 'ok')] }), 'messages', 1, 'content')).toBe('Voy a mirar.')
    const plain = body(config(), { model: 'm', messages: [msg.user('a'), msg.assistant('hola'), msg.assistant(''), msg.user('b')] })
    expect(at(plain, 'messages', 1)).toEqual({ role: 'assistant', content: 'hola' })
    expect(at(plain, 'messages', 2)).toEqual({ role: 'assistant', content: '' })
    expect(at(body(config(), { model: 'm', messages: [msg.user('x'), msg.assistant('', [c]), msg.toolResult('c', 't', '')] }), 'messages', 2, 'content')).toBe('(sin salida)')
  })
  it('los argumentos enviados siempre son JSON estricto (LaTeX escapado)', () => {
    const call: ToolCall = { id: 'c', name: 't', arguments: { tex: '\\frac{1}{2} + \\theta' }, rawArguments: '{"tex": "\\frac{1}{2} + \\theta"}' }
    const sent = at(body(config(), { model: 'm', messages: [msg.user('x'), msg.assistant('', [call]), msg.toolResult('c', 't', 'ok')] }), 'messages', 1, 'tool_calls', 0, 'function', 'arguments') as string
    expect(JSON.parse(sent).tex).toBe('\\frac{1}{2} + \\theta')
    expect(sent).toContain('\\\\frac')
  })
  it('imágenes: data URLs; sin visión, error; las de una herramienta van en un mensaje de usuario posterior', () => {
    const img = { mediaType: 'image/png', base64: 'QUJD' }
    expect(at(body(config({ supportsVision: true }), { model: 'm', messages: [msg.user('¿Qué ves?', [img])] }), 'messages', 0, 'content'))
      .toEqual([{ type: 'text', text: '¿Qué ves?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }])
    expect(() => body(config(), { model: 'm', messages: [msg.user('x', [img])] })).toThrow(/no admite imágenes/)
    expect(() => body(config(), { model: 'm', messages: [msg.user('a', [img]), msg.assistant('ok'), msg.user('b')] })).toThrow(AIError)
    const c1: ToolCall = { id: 'c1', name: 'captura', arguments: {} }
    const c2: ToolCall = { id: 'c2', name: 'otra', arguments: {} }
    const b = body(config({ supportsVision: true }), { model: 'm', messages: [msg.user('x'), msg.assistant('', [c1, c2]), msg.toolResult('c1', 'captura', 'hecho', [img]), msg.toolResult('c2', 'otra', 'ok'), msg.assistant('fin')] })
    expect((b.messages as JSONObject[]).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user', 'assistant'])
    expect(at(b, 'messages', 2, 'content')).toBe('hecho')
    expect(at(b, 'messages', 4, 'content', 1, 'image_url', 'url')).toBe('data:image/png;base64,QUJD')
  })
  it('razonamiento reenviado: DeepSeek (con herramientas), OpenRouter, nunca OpenAI ni vacío', () => {
    const history: ChatMessage[] = [msg.user('x'), msg.assistant('', [{ id: 'c', name: 'get_weather', arguments: { city: 'Lima' } }], 'Pienso en Lima.'), msg.toolResult('c', 'get_weather', 'ok')]
    expect(at(body(config({ baseURL: 'https://api.deepseek.com' }), { model: 'deepseek-flash', messages: history, tools: [weatherTool] }), 'messages', 1, 'reasoning_content')).toBe('Pienso en Lima.')
    expect(at(body(config({ baseURL: 'https://api.deepseek.com' }), { model: 'm', messages: history }), 'messages', 1, 'reasoning_content')).toBeUndefined()
    const oa = at(body(config({ baseURL: 'https://api.openai.com/v1' }), { model: 'm', messages: history, tools: [weatherTool] }), 'messages', 1) as JSONObject
    expect(oa.reasoning_content).toBeUndefined()
    expect(oa.reasoning).toBeUndefined()
    const or = at(body(config({ baseURL: 'https://openrouter.ai/api/v1' }), { model: 'm', messages: history, tools: [weatherTool] }), 'messages', 1) as JSONObject
    expect(or.reasoning).toBe('Pienso en Lima.')
    expect(or.reasoning_content).toBeUndefined()
    const empty: ChatMessage[] = [msg.user('x'), msg.assistant('', [{ id: 'c', name: 't', arguments: {} }], ''), msg.toolResult('c', 't', 'ok')]
    expect(at(body(config({ baseURL: 'https://api.deepseek.com' }), { model: 'm', messages: empty, tools: [weatherTool] }), 'messages', 1, 'reasoning_content')).toBeUndefined()
  })
  it('extraBody al final, sin streaming, stream_options desactivable y errores', () => {
    const b = body(config(), { model: 'm', messages: [msg.user('x')], temperature: 0.5, extraBody: { thinking: { type: 'enabled' }, temperature: 1, stream_options: null, seed: 7 } })
    expect(b.thinking).toEqual({ type: 'enabled' })
    expect(b.temperature).toBe(1)
    expect(b.stream_options).toBeUndefined()
    expect(b.seed).toBe(7)
    const ns = body(config(), simple, false)
    expect(ns.stream).toBe(false)
    expect(ns.stream_options).toBeUndefined()
    expect(body(config({ extraHeaders: { 'x-aula-stream-usage': 'false' } }), simple).stream_options).toBeUndefined()
    expect(() => body(config({ model: '' }), simple)).toThrow(/modelo/)
    expect(() => body(config(), { model: 'm', messages: [] })).toThrow(AIError)
  })
  it('Unicode y barras; cuerpos grandes', () => {
    expect(canonicalJSON(body(config(), { model: 'm', messages: [msg.user('Ñandú 👋 ∫₀¹ x² dx — https://a.b/c')] }))).toContain('Ñandú 👋 ∫₀¹ x² dx — https://a.b/c')
    const big = 'QUJD'.repeat(500_000)
    expect(canonicalJSON(body(config({ supportsVision: true }), { model: 'm', messages: [msg.user('x', [{ mediaType: 'image/jpeg', base64: big }])] })).length).toBeGreaterThan(2_000_000)
  })
})

describe('el razonamiento elegido llega a la petición', () => {
  const first = async (cfg: ProviderConfig, req: ChatRequest = { model: '', messages: [msg.user('Hola')], timeoutSec: 10 }) => {
    const { mf, model } = modelFor(cfg, [okReply(cfg)])
    await model.complete(req)
    return mf.requests[0].body as Body
  }
  it('OpenAI (Responses): el nivel guardado, en chat y en el bucle; automático y otro modelo no lo mandan', async () => {
    const cfg = { ...preset('openai'), model: 'gpt-6.1-sol', reasoning: 'xhigh' }
    expect(at(await first(cfg), 'reasoning', 'effort')).toBe('xhigh')
    const { mf, model } = modelFor(cfg, [sseReply(responsesOK)])
    await runToolLoop({ model, system: 'Breve', prompt: 'Hola', timeoutSec: 10, sleep: async () => {} })
    expect(at(mf.requests[0].body, 'reasoning', 'effort')).toBe('xhigh')
    expect(at(await first({ ...cfg, reasoning: 'auto' }), 'reasoning', 'effort')).toBeUndefined()
    expect(at(await first({ ...cfg, model: 'gpt-4.1' }), 'reasoning', 'effort')).toBeUndefined()
  })
  it('Anthropic (output_config), DeepSeek (thinking) y MiMo (interruptor)', async () => {
    expect(at(await first({ ...preset('anthropic'), reasoning: 'max' }), 'output_config', 'effort')).toBe('max')
    const off = await first({ ...preset('deepseek'), reasoning: 'none' })
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off.reasoning_effort).toBeUndefined()
    const on = await first({ ...preset('deepseek'), reasoning: 'max' })
    expect(on.thinking).toEqual({ type: 'enabled' })
    expect(on.reasoning_effort).toBe('max')
    const mimoOn = await first({ ...preset('mimo'), reasoning: 'enabled' })
    expect(mimoOn.thinking).toEqual({ type: 'enabled' })
    expect(mimoOn.reasoning_effort).toBeUndefined()
    expect((await first({ ...preset('mimo'), reasoning: 'none' })).thinking).toEqual({ type: 'disabled' })
  })
  it('OpenRouter: los niveles que publica el catálogo', async () => {
    const router = preset('openrouter')
    const b = await first({ ...router, reasoning: 'max', reasoningCapabilitiesByModel: { [router.model]: { efforts: ['low', 'high', 'max'] } } })
    expect(b.reasoning).toEqual({ effort: 'max' })
    expect(b.provider).toBeUndefined()
    // sin niveles publicados, no se manda (el modelo podría no admitirlo)
    expect((await first({ ...router, reasoning: 'max' })).reasoning).toBeUndefined()
  })
  it('un nivel guardado que el proveedor rechaza se explica sin reintentar con otro', async () => {
    for (const id of ['openai', 'anthropic']) {
      const cfg = { ...preset(id), reasoning: 'high' }
      const message = id === 'anthropic' ? 'output_config.effort: unsupported value' : 'reasoning.effort: unsupported value'
      const { mf, model } = modelFor(cfg, [jsonReply(`{"error":{"message":"${message}"}}`, 400)])
      const e = await model.complete({ model: '', messages: [msg.user('Hola')], timeoutSec: 10 }).catch((x) => x)
      expect(e).toBeInstanceOf(AIError)
      expect(e.message).toContain('Alto')
      expect(mf.requests).toHaveLength(1)
    }
  })
})

describe('caché de prompts con el bucle real', () => {
  const longSystem = 'Regla del autor: escribe con rigor y cita los materiales. '.repeat(40)
  const course = '## Course context\n- Title: Cálculo I\n' + '- Topic: límites y derivadas\n'.repeat(12)
  const echo: AgentTool = { name: 'eco', description: 'Devuelve lo que recibe', inputSchema: { type: 'object', properties: { texto: { type: 'string' } } }, run: (a) => `eco: ${canonicalJSON(a)}` }
  const loopOpts = (model: ChatModel, tools: AgentTool[] = [echo], shared: string = course): ToolLoopOptions =>
    ({ model, system: longSystem, prompt: 'Escribe la lección 1.', sharedContext: shared, tools, maxSteps: 6, timeoutSec: 30, sleep: async () => {} })
  const markers = (v: unknown, key = 'cache_control'): number => {
    if (Array.isArray(v)) return v.reduce((n: number, x) => n + markers(x, key), 0)
    if (v && typeof v === 'object') return (key in v ? 1 : 0) + Object.values(v).reduce((n: number, x) => n + markers(x, key), 0)
    return 0
  }
  const unmarked = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(unmarked)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) if (k !== 'cache_control' && k !== 'prompt_cache_breakpoint') o[k] = unmarked(x)
      return o
    }
    return v
  }
  const anthropicToolCall = (read: number, write: number, input: number) =>
    ev('message_start', `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":${input},"cache_read_input_tokens":${read},"cache_creation_input_tokens":${write},"output_tokens":1}}}`)
    + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"eco","input":{}}}')
    + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"texto\\":\\"hola\\"}"}}')
    + ev('content_block_stop', '{"type":"content_block_stop","index":0}')
    + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}') + ev('message_stop', '{"type":"message_stop"}')
  const anthropicText = (read: number, write: number, input: number) =>
    ev('message_start', `{"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-sonnet-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":${input},"cache_read_input_tokens":${read},"cache_creation_input_tokens":${write},"output_tokens":1}}}`)
    + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
    + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Listo."}}')
    + ev('content_block_stop', '{"type":"content_block_stop","index":0}')
    + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}') + ev('message_stop', '{"type":"message_stop"}')
  const chatToolCall = (usage: string) => data('{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"eco","arguments":""}}]}}]}')
    + data('{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"texto\\":\\"hola\\"}"}}]},"finish_reason":"tool_calls"}]}')
    + data(`{"id":"c1","object":"chat.completion.chunk","choices":[],"usage":${usage}}`) + DONE
  const chatText = (usage: string) => data('{"id":"c2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Listo."},"finish_reason":"stop"}]}')
    + data(`{"id":"c2","object":"chat.completion.chunk","choices":[],"usage":${usage}}`) + DONE
  const responsesToolCall = (usage: string) => ev('response.created', '{"type":"response.created","response":{"id":"resp_1","status":"in_progress","output":[]}}')
    + ev('response.output_item.added', '{"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"eco","arguments":""}}')
    + ev('response.function_call_arguments.delta', '{"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"texto\\":\\"hola\\"}"}')
    + ev('response.output_item.done', '{"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"eco","arguments":"{\\"texto\\":\\"hola\\"}"}}')
    + ev('response.completed', `{"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[],"usage":${usage}}}`)
  const responsesText = (usage: string) => ev('response.output_text.delta', '{"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"Listo."}')
    + ev('response.completed', `{"type":"response.completed","response":{"id":"resp_2","status":"completed","output":[],"usage":${usage}}}`)
  const openai = (model: string): ProviderConfig => ({ id: 'openai', kind: 'openai-compatible', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model, secretRef: 'test-key',
    extraHeaders: {}, supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true })
  const openrouter = (model: string): ProviderConfig => ({ ...openai(model), id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' })
  const anthropicCfg: ProviderConfig = { id: 'anthropic', kind: 'anthropic', label: 'Anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', secretRef: 'test-key',
    extraHeaders: {}, supportsTools: true, supportsVision: true, supportsStreaming: true, supportsJSONMode: false, enabled: true }

  it('Anthropic: marca el prefijo estable, el contexto compartido y la cola; el prefijo se repite idéntico', async () => {
    const { mf, model } = modelFor(anthropicCfg, [sseReply(anthropicToolCall(0, 4200, 30)), sseReply(anthropicText(4200, 90, 12))])
    const result = await runToolLoop(loopOpts(model))
    expect(result.text).toBe('Listo.')
    expect(mf.requests).toHaveLength(2)
    const a = mf.requests[0].body as Body
    const b = mf.requests[1].body as Body
    expect(a.system).toEqual([{ type: 'text', text: longSystem, cache_control: { type: 'ephemeral' } }])
    expect(a.cache_control).toBeUndefined()
    const opening = at(a, 'messages', 0, 'content') as JSONObject[]
    expect(opening).toHaveLength(2)
    expect(opening[0]).toMatchObject({ text: course + '\n', cache_control: { type: 'ephemeral' } })
    expect(opening[1]).toMatchObject({ text: 'Escribe la lección 1.', cache_control: { type: 'ephemeral' } })
    expect(markers(a)).toBe(3)
    const msgs = b.messages as JSONObject[]
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(at(msgs[0], 'content', 0, 'cache_control')).toEqual({ type: 'ephemeral' })
    expect(at(msgs[0], 'content', 1, 'cache_control')).toBeUndefined()
    const lastBlock = (msgs[2].content as JSONObject[]).at(-1)!
    expect(lastBlock.type).toBe('tool_result')
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' })
    expect(markers(b)).toBeLessThanOrEqual(4)
    expect(unmarked(a.tools)).toEqual(unmarked(b.tools))
    expect(unmarked(a.system)).toEqual(unmarked(b.system))
    expect(unmarked(at(a, 'messages', 0))).toEqual(unmarked(msgs[0]))
    expect(a.thinking).toEqual(b.thinking)
    expect(result.usage.promptTokens).toBe(30 + 4200 + (12 + 4200 + 90))
    expect(result.usage.cachedTokens).toBe(4200)
    expect(result.usage.cacheWriteTokens).toBe(4290)
  })
  it('Anthropic: una petición suelta solo marca el prefijo estable', async () => {
    const { mf, model } = modelFor(anthropicCfg, [sseReply(anthropicText(0, 0, 900))])
    await runToolLoop(loopOpts(model, [], ''))
    const b = mf.requests[0].body as Body
    expect(at(b, 'system', 0, 'cache_control')).toEqual({ type: 'ephemeral' })
    expect(markers(b)).toBe(1)
    expect((at(b, 'messages', 0, 'content') as unknown[]).length).toBe(1)
  })
  it('Anthropic compatible sin cache_control: un reintento y después limpio', async () => {
    const rejected = jsonReply('{"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.0.cache_control: Extra inputs are not permitted"}}', 400)
    const { mf, model } = modelFor(anthropicCfg, [rejected, sseReply(anthropicToolCall(0, 0, 900)), sseReply(anthropicText(0, 0, 950))])
    const result = await runToolLoop(loopOpts(model))
    expect(result.text).toBe('Listo.')
    expect(mf.requests).toHaveLength(3)
    expect(markers(mf.requests[0].body)).toBeGreaterThan(0)
    expect(markers(mf.requests[1].body)).toBe(0)
    expect(markers(mf.requests[2].body)).toBe(0)
    expect(at(mf.requests[1].body, 'system', 0, 'text')).toBe(longSystem)
  })
  it('OpenAI GPT-6 (Responses): puntos explícitos y una clave estable', async () => {
    const { mf, model } = modelFor(openai('gpt-6-sol'), [
      sseReply(responsesToolCall('{"input_tokens":3000,"output_tokens":10,"input_tokens_details":{"cached_tokens":0,"cache_write_tokens":2900}}')),
      sseReply(responsesText('{"input_tokens":3100,"output_tokens":5,"input_tokens_details":{"cached_tokens":2900,"cache_write_tokens":150}}'))
    ], { 'test-key': TEST_KEY })
    const result = await runToolLoop(loopOpts(model))
    expect(result.text).toBe('Listo.')
    const a = mf.requests[0].body as Body
    const b = mf.requests[1].body as Body
    expect(mf.requests[0].url).toBe('https://api.openai.com/v1/responses')
    expect(a.instructions).toBeUndefined()
    expect(at(a, 'input', 0)).toEqual({ role: 'developer', content: [{ type: 'input_text', text: longSystem, prompt_cache_breakpoint: { mode: 'explicit' } }] })
    expect(at(a, 'input', 1, 'content', 0, 'prompt_cache_breakpoint')).toEqual({ mode: 'explicit' })
    expect(at(a, 'input', 1, 'content', 0, 'text')).toBe(course + '\n')
    expect(at(a, 'input', 1, 'content', 1, 'prompt_cache_breakpoint')).toBeUndefined()
    expect(a.prompt_cache_options).toBeUndefined()
    const key = a.prompt_cache_key as string
    expect(key.startsWith('aula-')).toBe(true)
    expect(key.length).toBeLessThanOrEqual(64)
    expect(b.prompt_cache_key).toBe(key)
    expect(markers(a, 'prompt_cache_breakpoint')).toBe(2)
    const ia = a.input as JSONValue[]
    const ib = b.input as JSONObject[]
    expect(ib.slice(0, ia.length)).toEqual(ia)
    expect(ib.slice(ia.length).map((x) => x.type)).toEqual(['function_call', 'function_call_output'])
    expect(a.tools).toEqual(b.tools)
    expect(result.usage).toMatchObject({ promptTokens: 6100, cachedTokens: 2900, cacheWriteTokens: 3050 })
  })
  it('OpenAI: petición suelta en modo explícito; modelos anteriores solo con la clave', async () => {
    const one = modelFor(openai('gpt-6.1-sol'), [sseReply(responsesText('{"input_tokens":900,"output_tokens":5}'))], { 'test-key': TEST_KEY })
    await runToolLoop(loopOpts(one.model, [], ''))
    const b = one.mf.requests[0].body as Body
    expect(b.prompt_cache_options).toEqual({ mode: 'explicit' })
    expect(at(b, 'input', 0, 'role')).toBe('developer')
    expect(markers(b, 'prompt_cache_breakpoint')).toBe(1)
    const old = modelFor(openai('gpt-5.5'), [sseReply(responsesText('{"input_tokens":900,"output_tokens":5,"input_tokens_details":{"cached_tokens":768}}'))], { 'test-key': TEST_KEY })
    const r = await runToolLoop(loopOpts(old.model, []))
    const ob = old.mf.requests[0].body as Body
    expect(ob.instructions).toBe(longSystem)
    expect(markers(ob, 'prompt_cache_breakpoint')).toBe(0)
    expect(ob.prompt_cache_options).toBeUndefined()
    expect(typeof ob.prompt_cache_key).toBe('string')
    expect(at(ob, 'input', 0, 'content')).toBe(course + '\n' + 'Escribe la lección 1.')
    expect(r.usage.cachedTokens).toBe(768)
  })
  it('OpenAI: parámetros de caché rechazados se quitan y se recuerdan', async () => {
    const cfg = openai('gpt-6-sol')
    const s = modelFor(cfg, [jsonReply('{"error":{"message":"Unknown parameter: \'prompt_cache_key\'.","type":"invalid_request_error","param":"prompt_cache_key","code":"unknown_parameter"}}', 400),
      sseReply(responsesText('{"input_tokens":900,"output_tokens":5}'))], { 'test-key': TEST_KEY })
    const r = await runToolLoop(loopOpts(s.model, []))
    expect(r.text).toBe('Listo.')
    const retry = s.mf.requests.at(-1)!.body as Body
    expect(retry.prompt_cache_key).toBeUndefined()
    expect(retry.prompt_cache_options).toBeUndefined()
    expect(markers(retry, 'prompt_cache_breakpoint')).toBe(0)
    expect(retry.instructions).toBe(longSystem)
    expect(at(retry, 'input', 0, 'role')).not.toBe('developer')
    expect(s.fixups.tags(FixupMemory.key(cfg.baseURL, 'gpt-6-sol')).has('prompt_cache')).toBe(true)
  })
  it('OpenRouter con Claude: marcadores por bloque, caché de la conversación y session_id', async () => {
    const { mf, model } = modelFor(openrouter('anthropic/claude-sonnet-5.5'), [
      sseReply(chatToolCall('{"prompt_tokens":3000,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":2950}}')),
      sseReply(chatText('{"prompt_tokens":3100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":2950,"cache_write_tokens":120}}'))
    ], { 'test-key': TEST_KEY })
    const r = await runToolLoop(loopOpts(model))
    expect(r.text).toBe('Listo.')
    const a = mf.requests[0].body as Body
    const b = mf.requests[1].body as Body
    expect(at(a, 'messages', 0)).toEqual({ role: 'system', content: [{ type: 'text', text: longSystem, cache_control: { type: 'ephemeral' } }] })
    expect(at(a, 'messages', 1, 'content', 0, 'cache_control')).toEqual({ type: 'ephemeral' })
    expect(at(a, 'messages', 1, 'content', 1, 'text')).toBe('Escribe la lección 1.')
    expect(a.cache_control).toEqual({ type: 'ephemeral' })
    expect(typeof a.session_id).toBe('string')
    expect(b.session_id).toBe(a.session_id)
    expect(a.prompt_cache_key).toBeUndefined()
    const ma = a.messages as JSONValue[]
    expect((b.messages as JSONValue[]).slice(0, ma.length)).toEqual(ma)
    expect(r.usage).toMatchObject({ cachedTokens: 2950, cacheWriteTokens: 3070, promptTokens: 6100 })
  })
  it('OpenRouter con modelos de caché implícita: sin marcadores, solo session_id', async () => {
    for (const m of ['google/gemini-3.6-flash', 'deepseek/deepseek-v4.1-flash']) {
      const { mf, model } = modelFor(openrouter(m), [sseReply(chatText('{"prompt_tokens":900,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":512}}'))], { 'test-key': TEST_KEY })
      const r = await runToolLoop(loopOpts(model, []))
      const b = mf.requests[0].body as Body
      expect(markers(b), m).toBe(0)
      expect(at(b, 'messages', 0, 'content')).toBe(longSystem)
      expect(at(b, 'messages', 1, 'content')).toBe(course + '\n' + 'Escribe la lección 1.')
      expect(typeof b.session_id).toBe('string')
      expect(r.usage.cachedTokens).toBe(512)
    }
  })
  it('OpenRouter con GPT-6: el sistema marcado, la cola no; petición suelta en modo explícito', async () => {
    const loop = modelFor(openrouter('openai/gpt-6-sol'), [sseReply(chatText('{"prompt_tokens":900,"completion_tokens":5}'))], { 'test-key': TEST_KEY })
    await runToolLoop(loopOpts(loop.model))
    const b = loop.mf.requests[0].body as Body
    expect(at(b, 'messages', 0, 'content', 0, 'cache_control')).toEqual({ type: 'ephemeral' })
    expect(b.cache_control).toBeUndefined()
    expect(b.prompt_cache_options).toBeUndefined()
    const once = modelFor(openrouter('openai/gpt-6-sol'), [sseReply(chatText('{"prompt_tokens":900,"completion_tokens":5}'))], { 'test-key': TEST_KEY })
    await runToolLoop(loopOpts(once.model, [], ''))
    const single = once.mf.requests[0].body as Body
    expect(single.prompt_cache_options).toEqual({ mode: 'explicit' })
    expect(markers(single)).toBe(1)
  })
  it('caché automática por prefijo (DeepSeek, MiMo, Ollama): sin parámetros y prefijo idéntico', async () => {
    const cases: [string, string, string, number][] = [
      ['deepseek', '{"prompt_tokens":3000,"completion_tokens":10,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":3000}',
        '{"prompt_tokens":3100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":2944,"prompt_cache_miss_tokens":156}', 2944],
      ['mimo', '{"prompt_tokens":3000,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":0}}', '{"prompt_tokens":3100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":2816}}', 2816],
      ['ollama', '{"prompt_tokens":3000,"completion_tokens":10}', '{"prompt_tokens":3100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":3000}}', 3000]
    ]
    for (const [id, u1, u2, cached] of cases) {
      const cfg = preset(id)
      const { mf, model } = modelFor(cfg, [sseReply(chatToolCall(u1)), sseReply(chatText(u2))])
      const r = await runToolLoop(loopOpts(model))
      expect(r.text, id).toBe('Listo.')
      const a = mf.requests[0].body as Body
      const b = mf.requests.at(-1)!.body as Body
      for (const key of ['cache_control', 'prompt_cache_key', 'session_id', 'prompt_cache_options', 'prompt_cache_breakpoint']) expect(markers(a, key) + markers(b, key), `${id}: ${key}`).toBe(0)
      expect(at(a, 'messages', 0, 'content')).toBe(longSystem)
      expect(at(a, 'messages', 1, 'content')).toBe(course + '\n' + 'Escribe la lección 1.')
      const ma = a.messages as JSONValue[]
      expect((b.messages as JSONValue[]).slice(0, ma.length)).toEqual(ma)
      expect(a.tools).toEqual(b.tools)
      expect(r.usage.cachedTokens, id).toBe(cached)
      expect(r.usage.promptTokens, id).toBe(6100)
    }
  })
  it('el uso lee cada campo de caché sin contar dos veces', () => {
    expect(parseOpenAIUsage({ prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 }, prompt_cache_hit_tokens: 64 })?.cachedTokens).toBe(64)
    expect(parseOpenAIUsage({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 300, cache_creation_input_tokens: 50 })).toMatchObject({ promptTokens: 360, cachedTokens: 300, cacheWriteTokens: 50 })
    expect(parseOpenAIUsage({ input_tokens: 1000, output_tokens: 2, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 } })).toMatchObject({ promptTokens: 1000, cachedTokens: 600, cacheWriteTokens: 300 })
  })
})

describe('fixtures varias', () => {
  it('DeepSeek con el error de contexto se clasifica', async () => {
    const e = await modelFor(preset('deepseek'), [jsonReply(Fixtures.deepseekContext400, 400)]).model.complete(fullRequest).catch((x) => x)
    expect(e.code).toBe('ai_context_length')
  })
})
