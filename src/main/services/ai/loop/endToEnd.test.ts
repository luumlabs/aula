// Port de Tests/AIKitTests/EndToEndTests.swift: el bucle de agente → proveedor real → `fetch` simulado (sin red). Incluye el
// caso crítico del LaTeX con una sola barra invertida dentro de los argumentos de las herramientas.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import type { JSONObject } from '@shared/ai/json'
import type { AgentEvent } from '@shared/ai/types'
import type { AgentTool, ChatModel } from '../model'
import { AnthropicModel } from '../providers/anthropic'
import type { ProviderConfig } from '../providers/config'
import { ThinkingVault } from '../providers/memory'
import { OpenAICompatibleModel } from '../providers/openai'
import { Fixtures } from '../testing/fixtures'
import { jsonReply, mockFetch, sseHeaders, sseReply, testDeps, type MockReply } from '../testing/mocks'
import { runToolLoop, type ToolLoopOptions } from './toolLoop'

const KEY = 'sk-test-1234567890abcdefXYZ'
const data = (json: string) => `data: ${json}\n\n`
const ev = (name: string, json: string) => `event: ${name}\ndata: ${json}\n\n`
const DONE = 'data: [DONE]\n\n'
const finalAnswer = data('{"choices":[{"index":0,"delta":{"content":"Listo."},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}') + DONE

const openAIConfig = (o: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'test', kind: 'openai-compatible', label: 'Proveedor de prueba', baseURL: 'https://mock.test/v1', model: 'modelo-x', secretRef: 'k', extraHeaders: {},
  supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true, ...o
})
const anthropicConfig = (): ProviderConfig => ({ ...openAIConfig(), id: 'anthropic-test', kind: 'anthropic', label: 'Anthropic de prueba', baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', supportsVision: true })

function setup(script: MockReply[], config = openAIConfig(), keys: Record<string, string> = { k: KEY }) {
  const mf = mockFetch(script)
  const deps = testDeps(mf.fetch, keys, { vault: new ThinkingVault() })
  const model: ChatModel = config.kind === 'anthropic' ? new AnthropicModel(config, deps) : new OpenAICompatibleModel(config, deps)
  return { mf, model, deps }
}

async function run(model: ChatModel, opts: Partial<ToolLoopOptions> = {}, sleeps: number[] = []) {
  const events: AgentEvent[] = []
  let error: unknown
  let result: Awaited<ReturnType<typeof runToolLoop>> | undefined
  try {
    result = await runToolLoop({ model, prompt: 'Haz el trabajo', system: 'Eres un agente.', timeoutSec: 30, sleep: async (s) => void sleeps.push(s), onEvent: (e) => events.push(e), ...opts })
  } catch (e) {
    error = e
  }
  return {
    result, error, events,
    notices: events.flatMap((e) => (e.type === 'notice' ? [e.text] : [])),
    text: events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
  }
}

function formulaTool(log: JSONObject[] = []): AgentTool {
  return {
    name: 'mostrar_formula', description: 'Muestra una fórmula',
    inputSchema: { type: 'object', properties: { tex: { type: 'string' }, nota: { type: 'string' } }, required: ['tex'] },
    run: (args) => {
      log.push(args)
      return `fórmula mostrada: ${String(args.tex ?? '?')}`
    }
  }
}

const at = (v: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((cur, p) => (cur as Record<string | number, unknown> | undefined)?.[p], v)

beforeEach(() => setAILocale('es'))

describe('LaTeX con una sola barra invertida', () => {
  it('llega reparado a la herramienta por toda la tubería (con cualquier troceo)', async () => {
    for (const chunk of [1, 2, 3, 5, 11, 40, 4096]) {
      const log: JSONObject[] = []
      const { model } = setup([sseReply(Fixtures.openAILatexToolCall, chunk), sseReply(finalAnswer)])
      const r = await run(model, { tools: [formulaTool(log)] })
      expect(log[0]?.tex, `trozos de ${chunk}`).toBe('\\frac{1}{2} + \\theta \\neq \\sqrt{2}')
      expect(log[0]?.nota).toBe('x\ty')
      expect(r.result).toMatchObject({ text: 'Listo.', stopReason: 'stop' })
    }
  })
  it('el historial reenviado es JSON estricto con el LaTeX reparado; el texto original se conserva', async () => {
    const { mf, model } = setup([sseReply(Fixtures.openAILatexToolCall), sseReply(finalAnswer)])
    await run(model, { tools: [formulaTool()] })
    const second = mf.requests.at(-1)!.body
    const sent = at(second, 'messages', 2, 'tool_calls', 0, 'function', 'arguments') as string
    expect(JSON.parse(sent).tex).toBe('\\frac{1}{2} + \\theta \\neq \\sqrt{2}')
    expect(at(second, 'messages', 2, 'tool_calls', 0, 'id')).toBe('call_latex_1')
    expect(at(second, 'messages', 3)).toMatchObject({ role: 'tool', tool_call_id: 'call_latex_1', content: 'fórmula mostrada: \\frac{1}{2} + \\theta \\neq \\sqrt{2}' })
    const direct = setup([sseReply(Fixtures.openAILatexToolCall)])
    const res = await direct.model.complete({ messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
    expect(res.message.toolCalls![0].rawArguments).toContain('"tex": "\\frac')
  })
  it('también en el JSON parcial de Anthropic (y se reenvía ya reparado)', async () => {
    const s1 = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_latex","name":"mostrar_formula","input":{}}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"tex\\": \\"\\\\"}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"frac{\\\\"}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"pi}{2} \\\\"}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"theta\\"}"}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}') + ev('message_stop', '{"type":"message_stop"}')
    const s2 = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Mostrada."}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}') + ev('message_stop', '{"type":"message_stop"}')
    for (const chunk of [1, 7, 4096]) {
      const log: JSONObject[] = []
      const { mf, model } = setup([sseReply(s1, chunk), sseReply(s2, chunk)], anthropicConfig())
      const r = await run(model, { tools: [formulaTool(log)] })
      expect(log[0]?.tex, `trozos de ${chunk}`).toBe('\\frac{\\pi}{2} \\theta')
      expect(r.result?.text).toBe('Mostrada.')
      expect(at(mf.requests.at(-1)!.body, 'messages', 1, 'content', 0, 'input', 'tex')).toBe('\\frac{\\pi}{2} \\theta')
    }
  })
})

describe('flujos completos', () => {
  it('DeepSeek: el razonamiento se reenvía durante el bucle', async () => {
    const first = data('{"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Necesito la fórmula."}}]}')
      + data('{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ds1","type":"function","function":{"name":"mostrar_formula","arguments":"{\\"tex\\":\\"x^2\\"}"}}]}}]}')
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4}}') + DONE
    const { mf, model } = setup([sseReply(first), sseReply(finalAnswer)], openAIConfig({ extraHeaders: { 'x-aula-echo-reasoning': 'reasoning_content' } }))
    const r = await run(model, { tools: [formulaTool()] })
    expect(r.events.some((e) => e.type === 'reasoning' && e.text === 'Necesito la fórmula.')).toBe(true)
    const second = mf.requests.at(-1)!.body
    expect(at(second, 'messages', 2, 'reasoning_content')).toBe('Necesito la fórmula.')
    expect((at(second, 'tools') as unknown[]).length).toBe(1)
    expect(r.result?.usage).toMatchObject({ promptTokens: 14, completionTokens: 6 })
  })
  it('MiMo: una llamada entera por el bucle', async () => {
    const log: JSONObject[] = []
    const tool: AgentTool = { name: 'crear_leccion', description: 'Crea una lección', inputSchema: { type: 'object', properties: { titulo: { type: 'string' }, nivel: { type: 'integer' } } },
      run: (a) => (log.push(a), 'lección creada') }
    const { mf, model } = setup([sseReply(Fixtures.mimoToolCall), sseReply(finalAnswer)])
    const r = await run(model, { tools: [tool] })
    expect(log[0]).toEqual({ titulo: 'Límites', nivel: 2 })
    expect(r.result?.text).toBe('Listo.')
    expect(at(mf.requests.at(-1)!.body, 'messages', 2, 'tool_calls', 0, 'id')).toBe('call_mimo_01')
  })
  it('Anthropic: el bucle reenvía el razonamiento firmado', async () => {
    const s2 = ev('message_start', '{"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1}}}')
      + ev('content_block_start', '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}')
      + ev('content_block_delta', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hace sol en Lima."}}')
      + ev('message_delta', '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}') + ev('message_stop', '{"type":"message_stop"}')
    const { mf, model } = setup([sseReply(Fixtures.anthropicThinkingTool), sseReply(s2)], anthropicConfig())
    const weather: AgentTool = { name: 'get_weather', description: 'Clima', inputSchema: { type: 'object', properties: { city: { type: 'string' } } }, run: () => 'Soleado, 24 °C' }
    const r = await run(model, { tools: [weather] })
    expect(r.result).toMatchObject({ text: 'Hace sol en Lima.', steps: 2 })
    expect(r.events.flatMap((e) => (e.type === 'reasoning' ? [e.text] : [])).join('')).toBe('Debo consultar el clima.')
    const assistant = at(mf.requests.at(-1)!.body, 'messages', 1, 'content') as JSONObject[]
    expect(assistant.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use'])
    expect(assistant[0].signature).toBe('EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkz')
    expect(at(mf.requests.at(-1)!.body, 'messages', 2, 'content', 0)).toMatchObject({ tool_use_id: 'toolu_01Think1', content: 'Soleado, 24 °C' })
  })
  it('un rechazo de las herramientas por HTTP pasa al modo de texto (también con trozos diminutos)', async () => {
    const log: JSONObject[] = []
    const block = '```tool\n{"name":"mostrar_formula","arguments":{"tex":"\\\\frac{a}{b}"}}\n```'
    let pieces = data('{"choices":[{"index":0,"delta":{"content":"Voy.\\n\\n"}}]}')
    for (let i = 0; i < block.length; i += 3) pieces += data(JSON.stringify({ choices: [{ index: 0, delta: { content: block.slice(i, i + 3) } }] }))
    pieces += data('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') + DONE
    const { mf, model } = setup([jsonReply(Fixtures.ollamaNoTools400, 400), sseReply(pieces, 5), sseReply(finalAnswer)])
    const r = await run(model, { tools: [formulaTool(log)] })
    expect(r.notices).toEqual(['Este modelo no admite herramientas nativas; uso el modo de texto'])
    expect(mf.requests).toHaveLength(3)
    expect((mf.requests[0].body as JSONObject).tools).toBeDefined()
    expect((mf.requests[1].body as JSONObject).tools).toBeUndefined()
    expect(at(mf.requests[1].body, 'messages', 0, 'content')).toContain('```tool')
    expect(log[0]?.tex).toBe('\\frac{a}{b}')
    expect(r.text).not.toContain('```')
    expect(r.text).not.toContain('mostrar_formula')
    expect(r.result?.text).toBe('Listo.')
    const feedback = (at(mf.requests[2].body, 'messages') as JSONObject[]).at(-1)!.content as string
    expect(feedback).toContain('<tool_result name="mostrar_formula" ok="true">')
  })
  it('un 429 por HTTP lo espera el bucle; los 5xx los reintenta el proveedor sin que el bucle lo note', async () => {
    const sleeps: number[] = []
    const limited = setup([jsonReply(Fixtures.openAI429, 429, { 'Retry-After': '3' }), sseReply(finalAnswer)])
    const r = await run(limited.model, {}, sleeps)
    expect(sleeps).toEqual([3])
    expect(limited.mf.requests).toHaveLength(2)
    expect(r.result?.text).toBe('Listo.')
    expect(r.notices.some((n) => n.includes('Límite de uso') && n.includes('3 s'))).toBe(true)
    const flaky = setup([jsonReply('', 503), jsonReply('', 502), sseReply(finalAnswer)])
    const f = await run(flaky.model)
    expect(flaky.mf.requests).toHaveLength(3)
    expect(f.notices).toEqual([])
    expect(f.result?.steps).toBe(1)
  })
  it('un contexto que no cabe por HTTP se recorta y se repite', async () => {
    const big = 'dato '.repeat(2000)
    const tool: AgentTool = { name: 'mostrar_formula', description: 'x', inputSchema: {}, run: () => 'Resultado\n' + big }
    const call = (n: number) => data(`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c${n}","type":"function","function":{"name":"mostrar_formula","arguments":"{}"}}]}}]}`)
      + data('{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}') + DONE
    const { mf, model } = setup([sseReply(call(1)), sseReply(call(2)), jsonReply(Fixtures.deepseekContext400, 400), sseReply(finalAnswer)], openAIConfig({ contextWindow: 1_000_000 }))
    const r = await run(model, { tools: [tool] })
    expect(mf.requests).toHaveLength(4)
    expect(r.notices.some((n) => n.includes('el contexto no cabe'))).toBe(true)
    expect(r.result?.text).toBe('Listo.')
    expect(mf.requests[3].rawBody.length).toBeLessThan(mf.requests[2].rawBody.length)
  })
  it('cancelar o agotar el tiempo corta la petición HTTP', async () => {
    const hang = setup([{ status: 200, headers: sseHeaders, chunks: [], hang: true }])
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 50)
    const c = await run(hang.model, { signal: ctl.signal, timeoutSec: 60 })
    expect(c.result?.stopReason).toBe('cancelled')
    const slow = setup([{ hangBeforeHeaders: true }])
    const t = await run(slow.model, { timeoutSec: 0.3 })
    expect(t.result?.stopReason).toBe('timeout')
  })
  it('falta la clave: el error sale del bucle sin llamar a la red; dos tareas a la vez no se mezclan', async () => {
    const { mf, model } = setup([sseReply(finalAnswer)], openAIConfig({ label: 'DeepSeek' }), {})
    const r = await run(model)
    expect(r.error).toMatchObject({ kind: 'missingKey' })
    expect((r.error as Error).message).toContain('Falta la clave de API de DeepSeek')
    expect(mf.requests).toHaveLength(0)
    const a = setup([sseReply(finalAnswer)])
    const b = setup([sseReply(Fixtures.openAIText)])
    const [ra, rb] = await Promise.all([run(a.model, { prompt: 'uno' }), run(b.model, { prompt: 'dos' })])
    expect(ra.result?.text).toBe('Listo.')
    expect(rb.result?.text).toBe('¡Hola, mundo! ñandú 👋 日本語')
  })
})
