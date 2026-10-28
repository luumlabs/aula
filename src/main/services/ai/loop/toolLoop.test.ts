// Port de Tests/AIKitTests/ToolLoopRunnerTests.swift y ToolExecutorCancellationTests.swift: el bucle de agente con un modelo de guion.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import type { AgentEvent, ChatMessage, ChatRequest, ImagePart, Usage } from '@shared/ai/types'
import { messageImages, messageText } from '@shared/ai/types'
import type { JSONObject } from '@shared/ai/json'
import { AIError } from '../errors'
import { canonicalJSON } from '../core/json'
import type { AgentTool, ModelCapabilities, ToolOutput } from '../model'
import { MockChatModel, step, type Step } from '../testing/mocks'
import { estimateMessages } from './contextManager'
import { ToolExecutor } from './toolExecutor'
import { runToolLoop, type ToolLoopOptions } from './toolLoop'

const c1 = { id: 'call_1', name: 'eco', args: '{"texto":"hola"}' }
const u = (p: number, c: number, r = 0, cached = 0): Usage => ({ promptTokens: p, completionTokens: c, reasoningTokens: r, cachedTokens: cached, cacheWriteTokens: 0 })

function lineOf(e: AgentEvent): string {
  switch (e.type) {
    case 'started':
      return `started:${e.provider}/${e.model}`
    case 'text':
      return `text:${e.text}`
    case 'reasoning':
      return `reasoning:${e.text}`
    case 'toolStarted':
      return `toolStarted:${e.id}:${e.name}`
    case 'toolFinished':
      return `toolFinished:${e.id}:${e.name}:${e.ok ? 'ok' : 'error'}`
    case 'usage':
      return `usage:${e.usage.promptTokens}/${e.usage.completionTokens}`
    case 'notice':
      return `notice:${e.text}`
    case 'finished':
      return `finished:${e.result.stopReason}`
  }
}

class CallLog {
  args: JSONObject[] = []
  running = 0
  maxRunning = 0
}

function echoTool(name = 'eco', o: { log?: CallLog; delayMs?: number; result?: (a: JSONObject) => string | ToolOutput } = {}): AgentTool {
  return {
    name, description: 'Devuelve lo que recibe', inputSchema: { type: 'object', properties: { texto: { type: 'string' } } },
    async run(args, ctx) {
      const log = o.log
      if (log) {
        log.args.push(args)
        log.running++
        log.maxRunning = Math.max(log.maxRunning, log.running)
      }
      try {
        if (o.delayMs) await sleepAbortable(o.delayMs, ctx.signal)
        return o.result ? o.result(args) : `eco: ${canonicalJSON(args)}`
      } finally {
        if (log) log.running--
      }
    }
  }
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('cancelada'))
    }, { once: true })
  })
}

interface RunOut {
  events: AgentEvent[]
  lines: string[]
  notices: string[]
  text: string
  result?: Awaited<ReturnType<typeof runToolLoop>>
  error?: unknown
}

async function run(model: MockChatModel, opts: Partial<ToolLoopOptions> = {}, sleeps: number[] = []): Promise<RunOut> {
  const events: AgentEvent[] = []
  const out: RunOut = { events, lines: [], notices: [], text: '' }
  try {
    out.result = await runToolLoop({ model, system: 'Eres un agente.', prompt: 'Haz el trabajo', timeoutSec: 30, sleep: async (s) => void sleeps.push(s), onEvent: (e) => events.push(e), ...opts })
  } catch (err) {
    out.error = err
  }
  out.lines = events.map(lineOf)
  out.notices = events.flatMap((e) => (e.type === 'notice' ? [e.text] : []))
  out.text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
  return out
}

const model = (script: Step[] | ((req: ChatRequest, i: number) => Step), caps: Partial<ModelCapabilities> = {}) => new MockChatModel(script, caps)
const tools = (r: ChatRequest) => r.tools ?? []
const toolTexts = (msgs: ChatMessage[]) => msgs.filter((m) => m.role === 'tool').map(messageText)

beforeEach(() => setAILocale('es'))

describe('casos básicos', () => {
  it('respuesta simple sin herramientas', async () => {
    const m = model([step({ text: 'Hola mundo', reasoning: 'pienso' })])
    const r = await run(m)
    expect(r.lines[0]).toBe('started:Mock/mock-model')
    expect(r.text).toBe('Hola mundo')
    expect(r.lines).toContain('reasoning:pienso')
    expect(r.result).toMatchObject({ text: 'Hola mundo', steps: 1, stopReason: 'stop', usage: u(10, 5) })
    expect(r.lines.slice(-2)).toEqual(['usage:10/5', 'finished:stop'])
    expect(m.callCount).toBe(1)
    expect(r.notices).toEqual([])
  })
  it('la primera petición lleva sistema, usuario y herramientas (sin sistema vacío)', async () => {
    const m = model([step({ text: 'ok' })])
    await run(m, { prompt: 'Crea la lección', system: 'Eres un tutor.', tools: [echoTool()] })
    const req = m.requests[0]
    expect(req.messages.map((x) => x.role)).toEqual(['system', 'user'])
    expect(messageText(req.messages[0])).toBe('Eres un tutor.')
    expect(messageText(req.messages[1])).toBe('Crea la lección')
    expect(tools(req).map((t) => t.name)).toEqual(['eco'])
    expect(req.model).toBe('mock-model')
    const m2 = model([step({ text: 'ok' })])
    await run(m2, { system: '' })
    expect(m2.requests[0].messages.map((x) => x.role)).toEqual(['user'])
  })
  it('llamada a herramienta y después respuesta', async () => {
    const log = new CallLog()
    const m = model([step({ text: 'Voy.', calls: [c1] }), step({ text: 'Listo.' })])
    const r = await run(m, { tools: [echoTool('eco', { log })] })
    expect(log.args).toEqual([{ texto: 'hola' }])
    const started = r.lines.indexOf('toolStarted:call_1:eco')
    const finished = r.lines.indexOf('toolFinished:call_1:eco:ok')
    expect(started).toBeGreaterThan(r.lines.indexOf('text:Voy.'))
    expect(finished).toBeGreaterThan(started)
    expect(r.text).toBe('Voy.Listo.')
    expect(r.result).toMatchObject({ text: 'Listo.', steps: 2, usage: u(20, 10) })
    const second = m.requests[1].messages
    expect(second.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(messageText(second[2])).toBe('Voy.')
    expect(second[2].toolCalls![0]).toMatchObject({ id: 'call_1', arguments: { texto: 'hola' } })
    expect(second[3]).toMatchObject({ toolCallID: 'call_1', name: 'eco' })
    expect(messageText(second[3])).toBe('eco: {"texto":"hola"}')
  })
  it('el texto final es el último del asistente (o el último no vacío)', async () => {
    expect((await run(model([step({ text: 'Paso intermedio', calls: [c1] }), step({ text: 'Respuesta final' })]), { tools: [echoTool()] })).result?.text).toBe('Respuesta final')
    expect((await run(model([step({ text: 'Dije esto', calls: [c1] }), step({ text: '', finish: 'stop' }), step({ text: '', finish: 'stop' })]), { tools: [echoTool()] })).result?.text).toBe('Dije esto')
  })
  it('temperatura, tokens de salida, razonamiento y extraBody llegan a cada petición', async () => {
    const m = model([step({ text: 'ok' })], { maxOutputTokens: 5000 })
    await run(m, { temperature: 0.3, maxOutputTokens: 777 })
    expect(m.requests[0]).toMatchObject({ temperature: 0.3, maxTokens: 777 })
    const m2 = model([step({ text: 'ok' })], { maxOutputTokens: 5000 })
    await run(m2)
    expect(m2.requests[0].temperature).toBeUndefined()
    expect(m2.requests[0].maxTokens).toBe(5000)
    const m3 = model([step({ calls: [c1] }), step({ text: 'ok' })])
    await run(m3, { tools: [echoTool()], reasoningEffort: 'low', extraBody: { thinking: { type: 'disabled' } } })
    for (const req of m3.requests) {
      expect(req.reasoningEffort).toBe('low')
      expect(req.extraBody).toEqual({ thinking: { type: 'disabled' } })
    }
  })
  it('sin herramientas: nada de herramientas ni modo de texto', async () => {
    const m = model([step({ text: 'ok' })], { tools: false })
    const r = await run(m)
    expect(tools(m.requests[0])).toEqual([])
    expect(r.notices).toEqual([])
    expect(messageText(m.requests[0].messages[0])).not.toContain('```tool')
  })
})

describe('herramientas en paralelo', () => {
  it('hasta 4 a la vez y los resultados en el orden de las llamadas', async () => {
    const log = new CallLog()
    const slowFirst: AgentTool = { name: 'eco', description: 'x', inputSchema: { type: 'object', properties: { n: { type: 'integer' } } }, async run(args, ctx) {
      log.args.push(args)
      log.running++
      log.maxRunning = Math.max(log.maxRunning, log.running)
      const n = Number(args.n ?? 0)
      try {
        await sleepAbortable((7 - n) * 40, ctx.signal)
        return `resultado ${n}`
      } finally {
        log.running--
      }
    } }
    const calls = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `c${n}`, name: 'eco', args: `{"n":${n}}` }))
    const m = model([step({ calls }), step({ text: 'fin' })])
    const r = await run(m, { tools: [slowFirst] })
    expect(log.maxRunning).toBe(4)
    const msgs = m.requests[1].messages
    expect(toolTexts(msgs)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `resultado ${n}`))
    expect(msgs.filter((x) => x.role === 'tool').map((x) => x.toolCallID)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
    const firstFinish = r.lines.findIndex((l) => l.startsWith('toolFinished'))
    expect(r.lines.indexOf('toolStarted:c5:eco')).toBeGreaterThan(firstFinish)
    expect(r.lines.filter((l) => l.startsWith('toolStarted'))).toHaveLength(6)
    expect(r.lines.filter((l) => l.startsWith('toolFinished'))).toHaveLength(6)
  })
  it('el máximo se puede cambiar y herramientas distintas van a la vez', async () => {
    const log = new CallLog()
    await run(model([step({ calls: [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, name: 'eco', args: '{}' })) }), step({ text: 'fin' })]),
      { tools: [echoTool('eco', { log, delayMs: 10 })], maxParallelTools: 1 })
    expect(log.maxRunning).toBe(1)
    const la = new CallLog()
    const lb = new CallLog()
    const m = model([step({ calls: [{ id: 'a', name: 'uno', args: '{"texto":"1"}' }, { id: 'b', name: 'dos', args: '{"texto":"2"}' }] }), step({ text: 'fin' })])
    await run(m, { tools: [echoTool('uno', { log: la }), echoTool('dos', { log: lb })] })
    expect(la.args).toHaveLength(1)
    expect(lb.args).toHaveLength(1)
    expect(m.requests[1].messages.filter((x) => x.role === 'tool').map((x) => x.name)).toEqual(['uno', 'dos'])
  })
})

describe('fallos de las herramientas (el agente se recupera)', () => {
  it('herramienta desconocida: error con las disponibles', async () => {
    const m = model([step({ calls: [{ id: 'c1', name: 'inexistente', args: '{}' }] }), step({ text: 'ya veo' })])
    const r = await run(m, { tools: [echoTool('zeta'), echoTool('alfa')] })
    expect(messageText(m.requests[1].messages.at(-1)!)).toBe('Error: No existe la herramienta inexistente. Disponibles: alfa, zeta')
    expect(r.lines).toContain('toolFinished:c1:inexistente:error')
    expect(r.result?.text).toBe('ya veo')
  })
  it('argumentos ilegibles: se pide JSON válido sin ejecutar', async () => {
    const log = new CallLog()
    const m = model([step({ calls: [{ id: 'c1', name: 'eco', args: 'esto no es json en absoluto' }] }), step({ text: 'reenvío' })])
    const r = await run(m, { tools: [echoTool('eco', { log })] })
    expect(log.args).toEqual([])
    const t = messageText(m.requests[1].messages.at(-1)!)
    expect(t.startsWith('Error: no pude interpretar los argumentos')).toBe(true)
    for (const s of ['JSON válido', 'barras invertidas de LaTeX duplicadas', 'esto no es json en absoluto']) expect(t).toContain(s)
    expect(r.lines).toContain('toolFinished:c1:eco:error')
  })
  it('una excepción no aborta el agente; isError y salida vacía', async () => {
    const boom: AgentTool = { name: 'eco', description: 'x', inputSchema: {}, run: () => { throw new Error('se rompió el disco') } }
    const m = model([step({ calls: [c1] }), step({ text: 'me recupero' })])
    const r = await run(m, { tools: [boom] })
    expect(messageText(m.requests[1].messages.at(-1)!)).toBe('Error: la herramienta «eco» falló: se rompió el disco')
    expect(r.result).toMatchObject({ text: 'me recupero', stopReason: 'stop' })
    const flagged: AgentTool = { name: 'eco', description: 'x', inputSchema: {}, run: () => ({ text: 'el archivo no existe', isError: true }) }
    const m2 = model([step({ calls: [c1] }), step({ text: 'ok' })])
    const r2 = await run(m2, { tools: [flagged] })
    expect(messageText(m2.requests[1].messages.at(-1)!)).toBe('Error: el archivo no existe')
    expect(r2.lines).toContain('toolFinished:call_1:eco:error')
    const empty: AgentTool = { name: 'eco', description: 'x', inputSchema: {}, run: () => '' }
    const m3 = model([step({ calls: [c1] }), step({ text: 'ok' })])
    await run(m3, { tools: [empty] })
    expect(messageText(m3.requests[1].messages.at(-1)!)).toBe('(sin salida)')
  })
  it('los resultados enormes se recortan', async () => {
    const m = model([step({ calls: [c1] }), step({ text: 'ok' })])
    await run(m, { tools: [echoTool('eco', { result: () => 'x'.repeat(300_000) })], maxToolResultChars: 1000 })
    const t = messageText(m.requests[1].messages.at(-1)!)
    expect(t.length).toBeLessThan(1200)
    expect(t).toContain('resultado recortado')
  })
  it('nombres tolerantes guardados en su forma canónica; sin adivinar si hay ambigüedad', async () => {
    const log = new CallLog()
    for (const sloppy of ['functions.eco', 'ECO', ' eco ', '`eco`', 'default_api.eco']) {
      const m = model([step({ calls: [{ id: 'c1', name: sloppy, args: '{}' }] }), step({ text: 'ok' })])
      await run(m, { tools: [echoTool('eco', { log })] })
      expect(m.requests[1].messages[2].toolCalls![0].name, sloppy).toBe('eco')
      expect(messageText(m.requests[1].messages.at(-1)!).startsWith('eco:'), sloppy).toBe(true)
    }
    expect(log.args).toHaveLength(5)
    const m = model([step({ calls: [{ id: 'c1', name: 'ECO', args: '{}' }] }), step({ text: 'ok' })])
    await run(m, { tools: [echoTool('eco'), echoTool('Eco')] })
    expect(messageText(m.requests[1].messages.at(-1)!).startsWith('Error: No existe la herramienta')).toBe(true)
  })
  it('nombres repetidos: vale la primera', async () => {
    const first = new CallLog()
    const second = new CallLog()
    const m = model([step({ calls: [c1] }), step({ text: 'ok' })])
    await run(m, { tools: [echoTool('eco', { log: first }), echoTool('eco', { log: second })] })
    expect(first.args).toHaveLength(1)
    expect(second.args).toHaveLength(0)
    expect(tools(m.requests[0])).toHaveLength(1)
  })
  it('resúmenes de los eventos de herramienta', async () => {
    const longArgs = '{"texto":"' + 'abcdefghij'.repeat(20) + '"}'
    const r = await run(model([step({ calls: [{ id: 'c1', name: 'eco', args: longArgs }] }), step({ text: 'ok' })]),
      { tools: [echoTool('eco', { result: () => 'primera línea\nsegunda línea\n\ntercera\ncuarta' })] })
    const started = r.events.flatMap((e) => (e.type === 'toolStarted' ? [e.summary] : []))[0]
    const finished = r.events.flatMap((e) => (e.type === 'toolFinished' ? [e.summary] : []))[0]
    expect(started.startsWith('eco {"texto":"abcdefghij')).toBe(true)
    expect(Array.from(started).length).toBe('eco '.length + 80 + 1)
    expect(started.endsWith('…')).toBe(true)
    expect(finished).toBe('primera línea ⏎ segunda línea ⏎ tercera …')
  })
})

describe('límite de pasos', () => {
  it('al llegar al límite se pide un resumen final sin herramientas', async () => {
    const log = new CallLog()
    const m = model((req) => (tools(req).length ? step({ text: 'Sigo.', calls: [{ id: `c${req.messages.length}`, name: 'eco', args: '{}' }] }) : step({ text: 'Resumen: hice tres pasos.' })))
    const r = await run(m, { tools: [echoTool('eco', { log })], maxSteps: 3 })
    expect(log.args).toHaveLength(3)
    expect(m.callCount).toBe(4)
    const last = m.requests[3]
    expect(tools(last)).toEqual([])
    expect(last.messages.at(-1)!.role).toBe('user')
    expect(messageText(last.messages.at(-1)!)).toContain('límite de pasos')
    expect(r.result).toMatchObject({ stopReason: 'max_steps', steps: 3, text: 'Resumen: hice tres pasos.' })
    expect(r.result!.usage.promptTokens).toBe(40)
    expect(r.notices.some((n) => n.includes('límite de 3 pasos'))).toBe(true)
  })
  it('terminar en el último paso no es llegar al límite; un máximo ≤ 0 es 1', async () => {
    const m = model([step({ calls: [c1] }), step({ text: 'listo' })])
    expect((await run(m, { tools: [echoTool()], maxSteps: 2 })).result?.stopReason).toBe('stop')
    expect(m.callCount).toBe(2)
    const z = await run(model((req) => (tools(req).length ? step({ calls: [c1] }) : step({ text: 'resumen' }))), { tools: [echoTool()], maxSteps: 0 })
    expect(z.result).toMatchObject({ steps: 1, stopReason: 'max_steps' })
  })
  it('40 pasos con una ventana pequeña terminan (recortando el historial)', async () => {
    const log = new CallLog()
    const m = model((_, i) => (i < 39 ? step({ calls: [{ id: `c${i}`, name: 'eco', args: `{"texto":"paso ${i}"}` }], chunk: 50 }) : step({ text: 'terminé' })), { contextWindow: 8000 })
    const r = await run(m, { tools: [echoTool('eco', { log, result: () => 'resultado '.repeat(400) })] })
    expect(r.result).toMatchObject({ steps: 40, stopReason: 'stop' })
    expect(log.args).toHaveLength(39)
    expect(r.notices.some((n) => n.startsWith('Contexto largo'))).toBe(true)
  })
})

describe('gestión del contexto', () => {
  it('los resultados antiguos se recortan cuando crece el contexto', async () => {
    const big = 'dato '.repeat(2000)
    const m = model((_, i) => (i < 4 ? step({ calls: [{ id: `c${i}`, name: 'eco', args: '{}' }] }) : step({ text: 'fin' })), { contextWindow: 10_000 })
    const r = await run(m, { tools: [echoTool('eco', { result: () => 'Resultado importante\n' + big })] })
    const last = toolTexts(m.requests.at(-1)!.messages)
    expect(last).toHaveLength(4)
    expect(last[0]).toBe('Resultado importante\n[recortado]')
    expect(last.at(-1)!.length).toBeGreaterThan(5000)
    expect(r.notices.some((n) => n.includes('Contexto largo') && n.includes('recorté'))).toBe(true)
    expect(r.result?.stopReason).toBe('stop')
  })
  it('ventana de 100 000 tokens por defecto', async () => {
    const big = 'x'.repeat(180_000)
    const m = model((_, i) => (i < 3 ? step({ calls: [{ id: `c${i}`, name: 'eco', args: '{}' }] }) : step({ text: 'fin' })), { contextWindow: 0 })
    await run(m, { tools: [echoTool('eco', { result: () => 'R\n' + big })], maxToolResultChars: 500_000 })
    const r2 = toolTexts(m.requests[2].messages)
    expect(r2[0]).toBe('R\n[recortado]')
    expect(r2.at(-1)!.length).toBeGreaterThan(100_000)
    expect(toolTexts(m.requests[1].messages)[0].length).toBeGreaterThan(100_000)
  })
  it('«el contexto no cabe»: recorta más y reintenta una vez', async () => {
    const big = 'dato '.repeat(2000)
    const overflow = new AIError('http', "This model's maximum context length is 65536 tokens. However, you requested 70012 tokens.", { status: 400 })
    const m = model((_, i) => (i <= 1 ? step({ calls: [{ id: `c${i}`, name: 'eco', args: '{}' }] }) : i === 2 ? { fail: overflow } : step({ text: 'ya cabe' })), { contextWindow: 1_000_000 })
    const r = await run(m, { tools: [echoTool('eco', { result: () => 'Resultado\n' + big })] })
    expect(m.callCount).toBe(4)
    expect(r.notices.some((n) => n.includes('el contexto no cabe'))).toBe(true)
    expect(estimateMessages(m.requests[3].messages)).toBeLessThan(estimateMessages(m.requests[2].messages) / 2 + 200)
    expect(r.result?.text).toBe('ya cabe')
    const twice = model([{ fail: new AIError('http', 'prompt is too long: 213462 tokens > 200000 maximum', { status: 400 }) }])
    const e = await run(twice, { tools: [echoTool()] })
    expect(e.error).toMatchObject({ status: 400 })
    expect((e.error as AIError).message).toContain('prompt is too long')
    expect(twice.callCount).toBe(2)
  })
})

describe('modo de texto', () => {
  const textBlock = '```tool\n{"name":"eco","arguments":{"texto":"hola"}}\n```'
  const textModeNotice = 'Este modelo no admite herramientas nativas; uso el modo de texto'

  it('si el proveedor rechaza las herramientas, pasa al modo de texto', async () => {
    const log = new CallLog()
    const reject = new AIError('http', 'registry.ollama.ai/library/gemma3:4b does not support tools', { status: 400 })
    const m = model((_, i) => (i === 0 ? { fail: reject } : i === 1 ? step({ text: `Voy a llamar.\n\n${textBlock}\n`, chunk: 5 }) : step({ text: 'Todo bien.' })))
    const r = await run(m, { system: 'Eres un tutor.', tools: [echoTool('eco', { log })] })
    expect(r.notices).toEqual([textModeNotice])
    expect(m.callCount).toBe(3)
    const r1 = m.requests[1]
    expect(tools(r1)).toEqual([])
    const sys = messageText(r1.messages[0])
    expect(sys.startsWith('Eres un tutor.')).toBe(true)
    expect(sys).toContain('```tool')
    expect(sys).toContain('### eco')
    expect(log.args).toEqual([{ texto: 'hola' }])
    const r2 = m.requests[2].messages
    expect(r2.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messageText(r2[2])).toContain('```tool')
    expect(r2[2].toolCalls ?? []).toEqual([])
    expect(messageText(r2[3])).toContain('<tool_result name="eco" ok="true">')
    expect(messageText(r2[3])).toContain('eco: {"texto":"hola"}')
    expect(r.text).not.toContain('```tool')
    expect(r.text).not.toContain('"name"')
    expect(r.text.startsWith('Voy a llamar.')).toBe(true)
    expect(r.result?.text).toBe('Todo bien.')
    expect(r.lines.some((l) => l.startsWith('toolStarted:texto_1_') && l.endsWith(':eco'))).toBe(true)
  })
  it('un 404 al estilo OpenRouter también cambia de modo', async () => {
    const reject = new AIError('http', 'No endpoints found that support tool use. To learn more...', { status: 404 })
    const r = await run(model((_, i) => (i === 0 ? { fail: reject } : step({ text: 'sin herramientas' }))), { tools: [echoTool()] })
    expect(r.notices).toHaveLength(1)
    expect(r.result?.text).toBe('sin herramientas')
  })
  it('sin herramientas nativas empieza en modo de texto', async () => {
    const log = new CallLog()
    const m = model((_, i) => (i === 0 ? step({ text: textBlock }) : step({ text: 'hecho' })), { tools: false })
    const r = await run(m, { tools: [echoTool('eco', { log })] })
    expect(r.notices).toEqual([textModeNotice])
    expect(tools(m.requests[0])).toEqual([])
    expect(messageText(m.requests[0].messages[0])).toContain('```tool')
    expect(m.callCount).toBe(2)
    expect(log.args).toHaveLength(1)
    expect(r.lines[0]).toBe('started:Mock/mock-model')
    expect(r.lines[1]).toBe(`notice:${textModeNotice}`)
  })
  it('nunca enseña los bloques aunque lleguen en trozos diminutos', async () => {
    const full = 'Antes.\n\n' + textBlock + '\n\nDespués.'
    const r = await run(model((_, i) => (i === 0 ? step({ text: full, chunk: 2 }) : step({ text: 'fin' })), { tools: false }), { tools: [echoTool()] })
    for (const s of ['`', 'name', 'arguments']) expect(r.text).not.toContain(s)
    expect(r.text).toContain('Antes.')
    expect(r.text).toContain('Después.')
  })
  it('un bloque roto se informa y el modelo lo corrige', async () => {
    const log = new CallLog()
    const m = model((_, i) => (i === 0 ? step({ text: '```tool\n{roto\n```' }) : i === 1 ? step({ text: textBlock }) : step({ text: 'ahora sí' })), { tools: false })
    const r = await run(m, { tools: [echoTool('eco', { log })] })
    const feedback = messageText(m.requests[1].messages.at(-1)!)
    expect(feedback).toContain('ok="false"')
    expect(feedback.includes('incompleto') || feedback.includes('JSON')).toBe(true)
    expect(log.args).toHaveLength(1)
    expect(r.result).toMatchObject({ text: 'ahora sí', steps: 3 })
  })
  it('varios bloques: todos se ejecutan y se responden en un mensaje', async () => {
    const log = new CallLog()
    const two = textBlock + '\n' + textBlock.replace('hola', 'adiós')
    const m = model((_, i) => (i === 0 ? step({ text: two }) : step({ text: 'ok' })), { tools: false })
    await run(m, { tools: [echoTool('eco', { log })] })
    expect(log.args).toHaveLength(2)
    expect(messageText(m.requests[1].messages.at(-1)!).split('<tool_result').length - 1).toBe(2)
    expect(m.requests[1].messages.filter((x) => x.role === 'user')).toHaveLength(2)
  })
  it('el LaTeX de los argumentos se repara', async () => {
    const log = new CallLog()
    const block = '```tool\n{"name":"eco","arguments":{"texto":"\\frac{1}{2} + \\theta"}}\n```'
    await run(model((_, i) => (i === 0 ? step({ text: block }) : step({ text: 'ok' })), { tools: false }), { tools: [echoTool('eco', { log })] })
    expect(log.args[0].texto).toBe('\\frac{1}{2} + \\theta')
  })
  it('cambiar a modo de texto a mitad reescribe el historial nativo', async () => {
    const reject = new AIError('http', 'this model does not support function calling', { status: 400 })
    const m = model((_, i) => (i === 0 ? step({ text: 'Primero.', calls: [c1] }) : i === 1 ? { fail: reject } : step({ text: 'fin' })))
    const r = await run(m, { tools: [echoTool()] })
    expect(r.notices).toHaveLength(1)
    const msgs = m.requests[2].messages
    expect(msgs.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messageText(msgs[2])).toContain('```tool')
    expect(messageText(msgs[2])).toContain('"eco"')
    expect(msgs[2].toolCalls ?? []).toEqual([])
    expect(messageText(msgs[3])).toContain('<tool_result name="eco"')
    expect(msgs.some((x) => x.role === 'tool')).toBe(false)
  })
  it('el resumen final vuelve al modo de texto si el servicio rechaza mensajes tool sin herramientas', async () => {
    const reject = new AIError('http', "Messages with role 'tool' require the 'tools' parameter to be declared", { status: 400 })
    const m = model((req) => {
      if (!tools(req).length && req.messages.some((x) => x.role === 'tool')) return { fail: reject }
      return tools(req).length ? step({ calls: [c1] }) : step({ text: 'Resumen en modo texto.' })
    })
    const r = await run(m, { tools: [echoTool()], maxSteps: 2 })
    expect(r.result).toMatchObject({ stopReason: 'max_steps', text: 'Resumen en modo texto.' })
    expect(m.requests.at(-1)!.messages.some((x) => x.role === 'tool')).toBe(false)
    expect(r.notices.filter((n) => n.includes('modo de texto'))).toHaveLength(1)
  })
  it('otros errores no se confunden con el rechazo de las herramientas', async () => {
    const m = model([{ fail: new AIError('http', 'temperature must be between 0 and 2', { status: 400 }) }])
    const r = await run(m, { tools: [echoTool()] })
    expect(r.error).toMatchObject({ status: 400 })
    expect(m.callCount).toBe(1)
  })
})

describe('uso de tokens', () => {
  it('acumulado tras cada llamada y el último justo antes del fin', async () => {
    const m = model([step({ calls: [c1], usage: u(10, 5, 1, 2) }), step({ calls: [c1], usage: u(20, 7, 3, 4) }), step({ text: 'fin', usage: u(30, 9) })])
    const r = await run(m, { tools: [echoTool()] })
    expect(r.result?.usage).toEqual(u(60, 21, 4, 6))
    expect(r.lines.filter((l) => l.startsWith('usage:'))).toEqual(['usage:10/5', 'usage:30/12', 'usage:60/21'])
    expect(r.lines.slice(-2)).toEqual(['usage:60/21', 'finished:stop'])
  })
  it('sin uso cuenta como cero', async () => {
    expect((await run(model([step({ text: 'x', usage: null })]))).result?.usage).toEqual(u(0, 0))
  })
})

describe('cancelación y tiempo', () => {
  it('cancelar para la tarea sin error y corta la petición', async () => {
    const m = model([{ hang: true }])
    const ctl = new AbortController()
    const p = run(m, { signal: ctl.signal, timeoutSec: 60 })
    await new Promise((r) => setTimeout(r, 30))
    expect(m.callCount).toBe(1)
    ctl.abort()
    const r = await p
    expect(r.error).toBeUndefined()
    expect(r.result?.stopReason).toBe('cancelled')
    expect(m.cancelled).toBeGreaterThanOrEqual(1)
  })
  it('la cancelación llega a las herramientas en marcha y no se pide otro paso', async () => {
    let seen = false
    let started = false
    const tool: AgentTool = { name: 'eco', description: 'x', inputSchema: {}, async run(_, ctx) {
      started = true
      try {
        await sleepAbortable(10_000, ctx.signal)
      } catch (e) {
        seen = true
        throw e
      }
      return 'tarde'
    } }
    const m = model([step({ calls: [c1] }), step({ text: 'no debería llegar' })])
    const ctl = new AbortController()
    const p = run(m, { tools: [tool], signal: ctl.signal, timeoutSec: 60 })
    for (let i = 0; i < 200 && !started; i++) await new Promise((r) => setTimeout(r, 5))
    ctl.abort()
    const r = await p
    expect(r.result?.stopReason).toBe('cancelled')
    for (let i = 0; i < 100 && !seen; i++) await new Promise((r) => setTimeout(r, 5))
    expect(seen).toBe(true)
    expect(m.callCount).toBe(1)
  })
  it('tiempo máximo de la tarea (esperando al modelo o durante una herramienta)', async () => {
    const t0 = Date.now()
    const r = await run(model([{ hang: true }]), { timeoutSec: 0.3 })
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(r.result?.stopReason).toBe('timeout')
    expect(r.notices.some((n) => n.includes('tiempo máximo'))).toBe(true)
    expect(r.lines.at(-1)).toBe('finished:timeout')
    let seen = false
    const tool: AgentTool = { name: 'eco', description: 'x', inputSchema: {}, async run(_, ctx) {
      try {
        await sleepAbortable(10_000, ctx.signal)
      } catch (e) {
        seen = true
        throw e
      }
      return 'tarde'
    } }
    const r2 = await run(model([step({ text: 'Trabajando.', calls: [c1] })]), { tools: [tool], timeoutSec: 0.3 })
    expect(r2.result).toMatchObject({ stopReason: 'timeout', text: 'Trabajando.' })
    expect(seen).toBe(true)
  })
  it('el plazo se mira entre pasos; 0 = sin plazo', async () => {
    const r = await run(model(() => step({ text: 'p', calls: [c1] })), { tools: [echoTool('eco', { delayMs: 100 })], maxSteps: 100, timeoutSec: 0.45 })
    expect(r.result?.stopReason).toBe('timeout')
    expect(r.result!.steps).toBeLessThan(10)
    expect((await run(model([step({ text: 'ok' })]), { timeoutSec: 0 })).result?.stopReason).toBe('stop')
  })
})

describe('límite de uso (429)', () => {
  it('espera y repite el mismo paso', async () => {
    const sleeps: number[] = []
    const limited = new AIError('rateLimited', 'límite', { status: 429, retryAfter: 2 })
    const m = model((_, i) => (i < 2 ? { fail: limited } : step({ text: 'ya' })))
    const r = await run(m, {}, sleeps)
    expect(sleeps).toEqual([2, 2])
    expect(m.callCount).toBe(3)
    expect(r.notices.filter((n) => n.includes('Límite de uso'))).toHaveLength(2)
    expect(r.result).toMatchObject({ text: 'ya', steps: 1 })
  })
  it('sin Retry-After: 5, 20, 45; con uno enorme, como mucho 60', async () => {
    const s1: number[] = []
    await run(model((_, i) => (i < 3 ? { fail: new AIError('rateLimited', 'límite', { status: 429 }) } : step({ text: 'ya' }))), {}, s1)
    expect(s1).toEqual([5, 20, 45])
    const s2: number[] = []
    await run(model((_, i) => (i < 1 ? { fail: new AIError('rateLimited', 'límite', { status: 429, retryAfter: 3600 }) } : step({ text: 'ya' }))), {}, s2)
    expect(s2).toEqual([60])
  })
  it('se rinde tras tres reintentos; a mitad conserva lo hecho', async () => {
    const s: number[] = []
    const m = model([{ fail: new AIError('rateLimited', 'límite', { status: 429, retryAfter: 1 }) }])
    const r = await run(m, {}, s)
    expect(r.error).toMatchObject({ kind: 'rateLimited' })
    expect(m.callCount).toBe(4)
    expect(s).toEqual([1, 1, 1])
    const log = new CallLog()
    const m2 = model((_, i) => (i === 0 ? step({ calls: [c1] }) : i === 1 ? { fail: new AIError('rateLimited', 'límite', { status: 429, retryAfter: 1 }) } : step({ text: 'listo' })))
    const r2 = await run(m2, { tools: [echoTool('eco', { log })] })
    expect(log.args).toHaveLength(1)
    expect(m2.requests[1].messages.length).toBe(m2.requests[2].messages.length)
    expect(r2.result?.text).toBe('listo')
  })
})

describe('errores del proveedor', () => {
  it('el error sale tras «started»; el gasto previo se informa antes', async () => {
    const m = model([{ fail: new AIError('missingKey', 'Falta la clave de API de Mock.') }])
    const r = await run(m)
    expect(r.error).toMatchObject({ kind: 'missingKey', message: 'Falta la clave de API de Mock.' })
    expect(r.lines[0]).toBe('started:Mock/mock-model')
    expect(m.callCount).toBe(1)
    const r2 = await run(model([step({ calls: [c1], usage: u(100, 40) }), { fail: new AIError('http', 'caído', { status: 503 }) }]), { tools: [echoTool()] })
    expect(r2.error).toMatchObject({ status: 503 })
    expect(r2.lines.at(-1)).toBe('usage:100/40')
    expect(r2.events.some((e) => e.type === 'finished')).toBe(false)
  })
  it('tras salida parcial no se reintenta; un error cualquiera pasa tal cual', async () => {
    const m = model([{ eventsThenFail: [{ type: 'text', text: 'Hola a med' }], error: new AIError('network', 'se cortó') }])
    const r = await run(m)
    expect(r.error).toMatchObject({ kind: 'network' })
    expect(r.text).toBe('Hola a med')
    expect(m.callCount).toBe(1)
    class Weird extends Error {}
    expect((await run(model([{ fail: new Weird('raro') }]))).error).toBeInstanceOf(Weird)
  })
})

describe('casos delicados', () => {
  it('el razonamiento se reenvía y queda en el historial', async () => {
    const m = model([step({ reasoning: 'Pienso en la herramienta.', calls: [c1] }), step({ text: 'fin' })])
    const r = await run(m, { tools: [echoTool()] })
    expect(r.lines).toContain('reasoning:Pienso en la herramienta.')
    expect(m.requests[1].messages[2].reasoning).toBe('Pienso en la herramienta.')
  })
  it('la última llamada cortada por longitud no se ejecuta', async () => {
    const log = new CallLog()
    const m = model([step({ text: 'Dos cosas.', calls: [{ id: 'ok', name: 'eco', args: '{"texto":"completa"}' }, { id: 'cortada', name: 'eco', args: '{"texto":"esto se cor' }], finish: 'length' }),
      step({ text: 'reenvío en partes' })])
    const r = await run(m, { tools: [echoTool('eco', { log })] })
    expect(log.args).toEqual([{ texto: 'completa' }])
    const t = toolTexts(m.requests[1].messages)
    expect(t).toHaveLength(2)
    expect(t[0].startsWith('eco:')).toBe(true)
    expect(t[1].startsWith('Error: tu respuesta se cortó por el límite de longitud')).toBe(true)
    expect(r.notices.some((n) => n.includes('quedó cortada'))).toBe(true)
    expect(r.result?.text).toBe('reenvío en partes')
  })
  it('longitud sin llamadas y filtro de contenido tienen su motivo', async () => {
    const r = await run(model([step({ text: 'Una respuesta muy larga que se cor', finish: 'length' })]))
    expect(r.result?.stopReason).toBe('length')
    expect(r.notices.some((n) => n.includes('límite de longitud'))).toBe(true)
    const f = await run(model([step({ text: '', finish: 'contentFilter' })]))
    expect(f.result?.stopReason).toBe('content_filter')
    expect(f.notices.some((n) => n.includes('filtro de contenido'))).toBe(true)
  })
  it('una respuesta vacía tras resultados recibe un empujón (una vez, y no se queda en el historial)', async () => {
    const m = model([step({ calls: [c1] }), step({ text: '', finish: 'stop' }), step({ text: 'Ahora sí.' })])
    const r = await run(m, { tools: [echoTool()] })
    expect(m.callCount).toBe(3)
    const nudge = m.requests[2].messages.at(-1)!
    expect(nudge.role).toBe('user')
    expect(messageText(nudge)).toContain('Continúa')
    expect(m.requests[2].messages.length).toBe(m.requests[1].messages.length + 1)
    expect(r.result?.text).toBe('Ahora sí.')
    const start = model([step({ text: '', finish: 'stop' })])
    expect((await run(start, { tools: [echoTool()] })).result?.text).toBe('')
    expect(start.callCount).toBe(1)
    const once = model([step({ calls: [c1] }), step({ text: '', finish: 'stop' }), step({ text: '', finish: 'stop' }), step({ text: 'tarde' })])
    await run(once, { tools: [echoTool()] })
    expect(once.callCount).toBe(3)
  })
  it('imágenes según la visión del modelo', async () => {
    const img: ImagePart = { mediaType: 'image/png', base64: 'QUJD' }
    const blindModel = model([step({ text: 'ok' })], { vision: false })
    const r = await run(blindModel, { images: [img, img] })
    expect(r.notices.some((n) => n.includes('no admite imágenes') && n.includes('2'))).toBe(true)
    expect(messageImages(blindModel.requests[0].messages.at(-1)!)).toEqual([])
    const seeing = model([step({ text: 'ok' })], { vision: true })
    await run(seeing, { images: [img] })
    expect(messageImages(seeing.requests[0].messages.at(-1)!)).toEqual([img])
    const shot: AgentTool = { name: 'eco', description: 'x', inputSchema: {}, run: () => ({ text: 'captura', images: [img] }) }
    const blind = model([step({ calls: [c1] }), step({ text: 'ok' })], { vision: false })
    await run(blind, { tools: [shot] })
    const m1 = blind.requests[1].messages.at(-1)!
    expect(messageImages(m1)).toEqual([])
    expect(messageText(m1)).toContain('imagen(es) omitida(s)')
    const sees = model([step({ calls: [c1] }), step({ text: 'ok' })], { vision: true })
    await run(sees, { tools: [shot] })
    expect(messageImages(sees.requests[1].messages.at(-1)!)).toHaveLength(1)
  })
  it('argumentos con una valla de código dentro de una cadena se recuperan', async () => {
    const log = new CallLog()
    const args = '{"texto": "Ejemplo:\n```swift\nlet x = 1\n```\nfin"}'
    const m = model([{ events: [{ type: 'tool_call', index: 0, id: 'c1', name: 'eco', argumentsFragment: args }, { type: 'finished', finish: 'toolCalls' }] }, step({ text: 'ok' })])
    await run(m, { tools: [echoTool('eco', { log })] })
    expect(log.args).toHaveLength(1)
    expect(log.args[0].texto).toBe('Ejemplo:\n```swift\nlet x = 1\n```\nfin')
  })
})

describe('caché en el bucle', () => {
  it('la clave es la huella del prefijo estable; con herramientas se cachea la cola', async () => {
    const m = model([step({ text: 'ok' })])
    await run(m, { prompt: 'A', system: 'S', tools: [echoTool()] })
    await run(m, { prompt: 'B', system: 'S', tools: [echoTool()] })
    await run(m, { prompt: 'A', system: 'S2', tools: [echoTool()] })
    await run(m, { prompt: 'A', system: 'S' })
    const r = m.requests
    expect(r[0].cache?.key).toBe(r[1].cache?.key)
    expect(r[0].cache?.key).not.toBe(r[2].cache?.key)
    expect(r[0].cache?.reuseTail).toBe(true)
    expect(r[3].cache?.reuseTail).toBe(false)
    expect(r[0].cache?.sharedFirstUserPart).toBe(false)
    await run(m, { prompt: 'A', system: 'S', tools: [echoTool()], cacheKey: 'curso-42', sharedContext: 'Contexto' })
    const last = m.requests.at(-1)!
    expect(last.cache?.key).toBe('curso-42')
    expect(last.cache?.sharedFirstUserPart).toBe(true)
    expect(last.messages[1].content).toEqual([{ type: 'text', text: 'Contexto\n\n' }, { type: 'text', text: 'A' }])
  })
  it('el resumen final tras el límite de pasos no cachea la cola', async () => {
    const m = model([step({ calls: [{ id: 'call_1', name: 'eco', args: '{}' }] }), step({ text: 'Resumen.' })])
    await run(m, { tools: [echoTool()], maxSteps: 1 })
    expect(m.requests[0].cache?.reuseTail).toBe(true)
    expect(m.requests.at(-1)!.cache?.reuseTail).toBe(false)
  })
})

describe('agentes con bucle propio (CLIs)', () => {
  it('runToolLoop delega la tarea entera en runAgent', async () => {
    const m = model([step({ text: 'no se usa' })])
    let got: unknown
    const delegated = Object.assign(m, {
      runAgent: async (task: unknown) => {
        got = task
        return { text: 'hecho por la CLI', steps: 3, usage: u(1, 1), stopReason: 'stop' }
      }
    })
    const r = await runToolLoop({ model: delegated, system: 'S', prompt: 'P', sharedContext: 'C', tools: [echoTool()], maxSteps: 7, timeoutSec: 99 })
    expect(r.text).toBe('hecho por la CLI')
    expect(got).toMatchObject({ system: 'S', prompt: 'P', sharedContext: 'C', maxSteps: 7, timeoutSec: 99 })
    expect(m.callCount).toBe(0)
  })
})

describe('ejecutor de herramientas: cancelación', () => {
  it('tras cancelar no empieza ninguna llamada de la cola', async () => {
    let invocations = 0
    const ctl = new AbortController()
    const tool: AgentTool = { name: 'effect', description: 'test', inputSchema: {}, async run(_, ctx) {
      invocations++
      ctl.abort()
      await sleepAbortable(60_000, ctx.signal).catch(() => {})
      return 'done'
    } }
    const executor = new ToolExecutor(new Map([['effect', tool]]), { maxParallel: 1 })
    const calls = [0, 1, 2, 3, 4].map((i) => ({ id: `call_${i}`, name: 'effect', arguments: null }))
    const results = await executor.run(calls, ctl.signal, () => {})
    expect(invocations).toBe(1)
    expect(results.map((r) => r.callID)).toEqual(calls.map((c) => c.id))
    expect(results.slice(1).every((r) => !r.ok)).toBe(true)
  })
  it('un lote ya cancelado no llama a nadie', async () => {
    let invocations = 0
    const tool: AgentTool = { name: 'effect', description: 'test', inputSchema: {}, run: () => (invocations++, 'done') }
    const ctl = new AbortController()
    ctl.abort()
    const results = await new ToolExecutor(new Map([['effect', tool]])).run([{ id: 'call', name: 'effect', arguments: null }], ctl.signal, () => {})
    expect(invocations).toBe(0)
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(false)
  })
})
