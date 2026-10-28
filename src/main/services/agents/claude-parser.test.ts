// Port de `Tests/AgentKitTests/ClaudeStreamParserTests.swift` (con las capturas reales de `Fixtures/ClaudeFixtures.swift`).
import { describe, expect, it } from 'vitest'
import { ClaudeStreamParser, CONNECTION_RETRY_POLICY, connectionFailureMessage, slowConnectionMessage } from './claude'
import { stripMCPPrefix, type CLIConclusion } from './engine'
import { CLIErrorClassifier } from './errors'
import { LineBuffer } from './line-buffer'
import { emptyUsage, type AgentEvent } from './types'
import { ClaudeEvents as E, fixture, fixtureLines } from './__fixtures__/support'

const makeParser = (servers: string[] = ['aula']): ClaudeStreamParser => new ClaudeStreamParser('Claude Code', 'haiku', servers)

function run(lines: string[], parser: ClaudeStreamParser = makeParser()): { events: AgentEvent[]; violation?: string; conclusion: CLIConclusion; terminal: boolean } {
  const events: AgentEvent[] = []
  let violation: string | undefined
  let terminal = false
  for (const line of lines) {
    const step = parser.consume(line)
    events.push(...step.events)
    violation ??= step.violation
    terminal = terminal || !!step.isTerminal
  }
  return { events, violation, conclusion: parser.conclude(), terminal }
}

const texts = (events: AgentEvent[]): string => events.map((e) => (e.type === 'text' ? e.text : '')).join('')
const reasonings = (events: AgentEvent[]): string => events.map((e) => (e.type === 'reasoning' ? e.text : '')).join('')
const notices = (events: AgentEvent[]): string[] => events.flatMap((e) => (e.type === 'notice' ? [e.text] : []))
const count = (events: AgentEvent[], type: AgentEvent['type']): number => events.filter((e) => e.type === type).length

function finished(c: CLIConclusion) {
  if (c.type !== 'finished') throw new Error(`se esperaba fin normal y fue ${c.type}`)
  return c.result
}
function failed(c: CLIConclusion) {
  if (c.type !== 'failed') throw new Error(`se esperaba fallo y fue ${c.type}`)
  return c.failure
}

describe('ClaudeStreamParser · capturas reales', () => {
  it('texto simple con razonamiento', () => {
    const o = run(fixtureLines('claude-text-ok.jsonl'))
    expect(o.violation).toBeUndefined()
    expect(o.terminal).toBe(true)
    expect(o.events[0]).toEqual({ type: 'started', provider: 'Claude Code', model: 'claude-haiku-4-5-20251001' })
    expect(texts(o.events)).toBe('OK') // el texto no se duplica con la instantánea `assistant`
    expect(reasonings(o.events)).toBe('The user asks me to respond only "OK".')
    const r = finished(o.conclusion)
    expect(r.text).toBe('OK')
    expect(r.steps).toBe(1)
    expect(r.stopReason).toBe('stop')
    expect(r.sessionID).toBe('d02291b9-4ac4-41d5-be26-45b9c0c01179')
    expect(r.usage.completionTokens).toBe(14)
  })

  it('herramienta MCP con --max-turns 1 → max_steps', () => {
    const o = run(fixtureLines('claude-mcp-tool-max-turns.jsonl'), makeParser(['aulatest']))
    expect(o.violation).toBeUndefined()
    const tools = o.events.flatMap((e) =>
      e.type === 'toolStarted' ? [`start ${e.id} ${e.name} ${e.summary}`] : e.type === 'toolFinished' ? [`end ${e.id} ${e.name} ${e.ok} ${e.summary}`] : []
    )
    expect(tools).toEqual(['start call_e32d40a832e9473fb79d7eea suma {"a":2,"b":3}', 'end call_e32d40a832e9473fb79d7eea suma true 5 [sello:KX-4417]'])
    const r = finished(o.conclusion)
    expect(r.stopReason).toBe('max_steps')
    expect(r.steps).toBe(2)
    expect(r.sessionID).toBe('9dc49c0e-6f61-404e-8a1c-b7385214ef48')
    expect(r.text).toBe('')
  })

  it('el modelo no necesitó la herramienta', () => {
    const o = run(fixtureLines('claude-mcp-no-tool-call.jsonl'), makeParser(['aulatest']))
    expect(o.violation).toBeUndefined()
    expect(count(o.events, 'toolStarted')).toBe(0)
    expect(finished(o.conclusion).text).toBe('5')
  })

  it('sin sesión iniciada', () => {
    const o = run(fixtureLines('claude-not-logged-in.jsonl'))
    expect(texts(o.events)).toBe('') // el mensaje sintético de error no es texto del asistente
    const f = failed(o.conclusion)
    expect(f.kind).toBe('notLoggedIn')
    expect(f.message).toContain('Not logged in')
    const error = CLIErrorClassifier.claude.classify(f.message, f.kind, f.retryAfter)
    expect(error.kind).toBe('notLoggedIn')
    expect(error.message).toContain('`claude`')
  })

  it('las capturas sobreviven a cualquier troceo y a CRLF', () => {
    for (const name of ['claude-text-ok.jsonl', 'claude-mcp-tool-max-turns.jsonl', 'claude-not-logged-in.jsonl']) {
      const expected = run(fixtureLines(name), makeParser(['aulatest'])).events.length
      const data = Buffer.from(fixture(name).replace(/\n/g, '\r\n'))
      for (const size of [1, 7, 64, 1000]) {
        const buffer = new LineBuffer()
        const parser = makeParser(['aulatest'])
        let n = 0
        for (let offset = 0; offset < data.length; offset += size) for (const l of buffer.append(data.subarray(offset, offset + size))) n += parser.consume(l).events.length
        const rest = buffer.finish()
        if (rest !== undefined) n += parser.consume(rest).events.length
        expect(n, `${name} troceo ${size}`).toBe(expected)
      }
    }
  })
})

describe('ClaudeStreamParser · flujos sintéticos', () => {
  it('recorrido completo con una herramienta', () => {
    const o = run(E.fullToolFlow())
    expect(o.violation).toBeUndefined()
    const names = o.events.map((e) =>
      e.type === 'toolStarted' ? `toolStarted:${e.name}:${e.summary}` : e.type === 'toolFinished' ? `toolFinished:${e.name}:${e.ok}:${e.summary}` : e.type
    )
    // entre los textos de dos mensajes distintos va un separador «\n\n» (un .text extra)
    expect(names).toEqual([
      'started', 'reasoning', 'reasoning', 'text', 'text',
      'toolStarted:crear_leccion:{"n":3,"titulo":"Círculo unidad"}',
      'toolFinished:crear_leccion:true:Lección creada ⏎ id=abc',
      'text', 'text', 'text'
    ])
    expect(texts(o.events)).toBe('Voy a crear la lección.\n\nListo, ya está.')
    const r = finished(o.conclusion)
    expect(r.text).toBe('Listo, ya está.')
    expect(r.steps).toBe(2)
    expect(r.usage.promptTokens).toBe(130) // 10 + 100 (caché leída) + 20 (caché escrita)
    expect(r.usage.cachedTokens).toBe(100)
    expect(r.usage.cacheWriteTokens).toBe(20)
    expect(r.usage.completionTokens).toBe(5)
    expect(r.usage.reasoningTokens).toBe(3)
  })

  it('sin mensajes parciales, las instantáneas lo dan todo', () => {
    const o = run([
      E.initEvent({ tools: ['mcp__aula__crear_leccion'] }),
      E.assistant('m1', [E.thinkingBlock('pienso')]),
      E.assistant('m1', [E.textBlock('hola')]),
      E.assistant('m1', [E.toolUseBlock('t1', 'mcp__aula__crear_leccion', { a: 1 })]),
      E.toolResult('t1', 'ok'),
      E.assistant('m2', [E.textBlock('adiós')]),
      E.result({ text: 'adiós', turns: 2 })
    ])
    expect(reasonings(o.events)).toBe('pienso')
    expect(texts(o.events)).toBe('hola\n\nadiós')
    expect(count(o.events, 'toolStarted')).toBe(1)
    expect(count(o.events, 'toolFinished')).toBe(1)
  })

  it('toolStarted una sola vez aunque la instantánea se repita', () => {
    const block = E.toolUseBlock('t1', 'mcp__aula__x', { k: 'v' })
    expect(count(run([E.initEvent(), E.assistant('m', [block]), E.assistant('m', [block]), E.result({ text: '' })]).events, 'toolStarted')).toBe(1)
  })

  it('resultados con error y con formas distintas', () => {
    const o = run([
      E.initEvent(),
      E.assistant('m', [E.toolUseBlock('a', 'mcp__aula__falla', {}), E.toolUseBlock('b', 'mcp__aula__imagen', {})]),
      E.toolResult('a', 'Error: no existe', true),
      E.toolResult('b', [{ type: 'text', text: 'una foto' }, { type: 'image', source: { type: 'base64' } }]),
      E.toolResult('desconocido', null),
      E.result({ text: 'fin' })
    ])
    const done = o.events.flatMap((e) => (e.type === 'toolFinished' ? [`${e.id}|${e.name}|${e.ok}|${e.summary}`] : []))
    expect(done).toEqual(['a|falla|false|Error: no existe', 'b|imagen|true|una foto ⏎ [imagen]', 'desconocido|herramienta|true|'])
  })

  it('resúmenes de las herramientas web: consulta y URL', () => {
    const o = run([
      E.initEvent({ tools: ['WebSearch', 'WebFetch'] }),
      E.assistant('m', [E.toolUseBlock('s', 'WebSearch', { query: 'identidades trigonométricas' }), E.toolUseBlock('f', 'WebFetch', { url: 'https://example.com/a', prompt: 'resume' })]),
      E.result({ text: '' })
    ])
    expect(o.events.flatMap((e) => (e.type === 'toolStarted' ? [`${e.name}: ${e.summary}`] : []))).toEqual(['WebSearch: identidades trigonométricas', 'WebFetch: https://example.com/a'])
  })

  it('los argumentos largos se recortan en el resumen', () => {
    const o = run([E.initEvent(), E.assistant('m', [E.toolUseBlock('t', 'mcp__aula__x', { texto: 'x'.repeat(500) })]), E.result({ text: '' })])
    const started = o.events.find((e) => e.type === 'toolStarted')
    expect(started?.type).toBe('toolStarted')
    const summary = started?.type === 'toolStarted' ? started.summary : ''
    expect(Array.from(summary).length).toBeLessThanOrEqual(81)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('init avisa de los servidores MCP que fallaron', () => {
    const o = run([E.initEvent({ servers: [['aula', 'connected'], ['canvas', 'failed'], ['otro', 'needs-auth']] }), E.result({ text: 'x' })])
    const n = notices(o.events)
    expect(n).toHaveLength(2)
    expect(n[0]).toContain('canvas')
    expect(n[0]).toContain('failed')
    expect(n[1]).toContain('otro')
  })

  it('sin modelo en init, started usa el pedido', () => {
    const o = run([E.line({ type: 'system', subtype: 'init', session_id: 's' }), E.result({ text: 'x' })])
    expect(o.events[0]).toMatchObject({ type: 'started', model: 'haiku' })
  })
})

describe('ClaudeStreamParser · errores', () => {
  it('límite de uso con la hora de reinicio', () => {
    const o = run([
      E.initEvent(),
      E.line({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Date.now() / 1000 + 7200, rateLimitType: 'five_hour' } }),
      E.assistant('m', [E.textBlock("You've hit your limit · resets 3pm (Europe/Madrid)")], 'rate_limit'),
      E.result({ isError: true, text: "You've hit your limit · resets 3pm (Europe/Madrid)" })
    ])
    const f = failed(o.conclusion)
    expect(f.kind).toBe('rateLimited')
    expect(f.retryAfter).toBeDefined()
    expect(Math.abs((f.retryAfter ?? 0) - 7200)).toBeLessThan(5)
    const error = CLIErrorClassifier.claude.classify(f.message, f.kind, f.retryAfter)
    expect(error.kind).toBe('rateLimited')
    expect(error.message).toContain('límite de uso')
    expect(Math.abs((error.retryAfter ?? 0) - 7200)).toBeLessThan(10) // prefiere el dato estructurado del evento al texto
    expect(texts(o.events)).toBe('')
  })

  it('el aviso de límite cercano sale una vez', () => {
    const warning = E.line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })
    expect(count(run([E.initEvent(), warning, warning, E.result()]).events, 'notice')).toBe(1)
    const allowed = E.line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })
    expect(run([allowed, E.result()]).events).toHaveLength(0)
  })

  it('error durante la ejecución', () => {
    const f = failed(run([E.initEvent(), E.result({ subtype: 'error_during_execution', isError: true, text: null, errors: ['Se rompió algo', 'otra cosa'] })]).conclusion)
    expect(f.message).toBe('Se rompió algo\notra cosa')
  })

  it('un resultado de error sin texto sigue fallando', () => {
    expect(failed(run([E.initEvent(), E.result({ subtype: 'error_max_budget_usd', isError: true, text: null })]).conclusion).message).toContain('error_max_budget_usd')
  })

  it('los reintentos de la API son avisos (sin repetir el mismo intento)', () => {
    const retry = (attempt: number): string => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, error_status: 529 })
    const n = notices(run([E.initEvent(), retry(1), retry(1), retry(2), E.result()]).events)
    expect(n).toHaveLength(2)
    expect(n[0]).toContain('saturado')
    expect(n[0]).toContain('529')
    expect(n[0]).toContain('1 de 10')
  })

  it('el aviso de reintento dice el motivo real', () => {
    const retry = (attempt: number, fields: Record<string, unknown>): string => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, ...fields })
    const n = notices(run([E.initEvent(), retry(1, { error_status: 429, error: 'rate_limit' }), retry(2, { error: 'connection_error' }), E.result()]).events)
    expect(n).toHaveLength(2)
    expect(n[0]).toContain('limita las peticiones')
    expect(n[0]).toContain('429')
    expect(n[0]).toContain('1 de 10')
    expect(n[1]).toContain('Reintentando la conexión')
    expect(n[1]).toContain('intento 2 de 10')
  })

  it('sin red (reintentos sin código HTTP) se corta pronto con un fallo de red en vez de esperar 3 minutos', () => {
    // lo que imprime de verdad Claude Code 2.1 con ANTHROPIC_BASE_URL apuntando a un puerto cerrado (ECONNREFUSED)
    const retry = (attempt: number): string => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, retry_delay_ms: 500 * attempt, error_status: null, error: 'unknown' })
    const parser = makeParser()
    const stops: boolean[] = []
    for (const line of [E.initEvent(), retry(1), retry(2), retry(3), retry(4)]) stops.push(!!parser.consume(line).stopNow)
    expect(stops).toEqual([false, false, false, false, true])
    const failure = failed(parser.conclude())
    expect(failure.kind).toBe('network')
    const err = CLIErrorClassifier.claude.classify(failure.message, failure.kind)
    expect(err.kind).toBe('network')
    expect(err.message).toContain('no pudo conectarse a internet')
    expect(err.message).toContain(connectionFailureMessage(4).slice(0, 40))
  })

  it('si cada intento tarda minutos (la API no contesta) no es «sin red»: se corta más tarde y como espera agotada', () => {
    let now = 0
    const parser = new ClaudeStreamParser('Claude Code', 'haiku', ['aula'], () => now)
    const retry = (attempt: number): string => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, retry_delay_ms: 1000, error_status: null, error: 'unknown' })
    const stops: boolean[] = []
    for (const attempt of [1, 2, 3, 4]) {
      stops.push(!!parser.consume(retry(attempt)).stopNow)
      now += 2 * 60_000 // cada intento tarda dos minutos en fallar
    }
    // a los 4 lentos aún no (solo 6 min con 3 o más): se para en el que pasa de 5 min con al menos 3
    expect(stops).toEqual([false, false, false, true])
    const failure = failed(parser.conclude())
    expect(failure.kind).toBe('timeout')
    expect(failure.message).toBe(slowConnectionMessage(4, 6))
    expect(CLIErrorClassifier.claude.classify(failure.message, failure.kind).kind).toBe('timeout')
    expect(CONNECTION_RETRY_POLICY.slowWindowMs).toBe(300_000)
  })

  it('los reintentos con respuesta HTTP (529, 429) no cuentan como falta de red', () => {
    const parser = makeParser()
    const lines = [1, 2, 3, 4, 5, 6].map((attempt) => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, error_status: attempt % 2 ? 529 : null, error: attempt % 2 ? 'overloaded' : 'unknown' }))
    expect(lines.some((l) => parser.consume(l).stopNow)).toBe(false)
    const rate = makeParser()
    const limited = [1, 2, 3, 4, 5].map((attempt) => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, error_status: null, error: 'rate_limit' }))
    expect(limited.some((l) => rate.consume(l).stopNow)).toBe(false)
  })

  it('los permisos denegados dan un aviso', () => {
    const n = notices(run([E.initEvent(), E.result({ denials: ['Bash', 'Bash', 'Write'] })]).events)
    expect(n).toHaveLength(1)
    expect(n[0]).toContain('Bash, Write')
  })

  it('sin evento result no hay desenlace', () => {
    const o = run([E.initEvent(), E.messageStart('m'), E.blockStart(0, { type: 'text', text: '' }), E.textDelta(0, 'a medias')])
    expect(texts(o.events)).toBe('a medias')
    expect(o.conclusion.type).toBe('noResult')
  })

  it('un error del asistente sin result falla', () => {
    const f = failed(run([E.initEvent(), E.assistant('m', [E.textBlock('Invalid API key · Fix external API key')], 'authentication_failed')]).conclusion)
    expect(f.kind).toBe('notLoggedIn')
  })
})

describe('ClaudeStreamParser · seguridad', () => {
  it('herramientas peligrosas en init = violación', () => {
    const o = run([E.initEvent({ tools: ['mcp__aula__x', 'Bash', 'Edit', 'WebSearch'] })])
    expect(o.violation).toContain('Bash, Edit')
  })

  it('lista blanca (J3-9): herramientas nuevas que ejecutan órdenes o fuera de la tarea = violación', () => {
    expect(run([E.initEvent({ tools: ['mcp__aula__x', 'Monitor'] })]).violation).toContain('Monitor')
    expect(run([E.initEvent({ tools: ['EnterWorktree', 'Workflow', 'TaskStop'] })]).violation).toContain('EnterWorktree, TaskStop, Workflow')
    // un servidor MCP que no es de la tarea
    expect(run([E.initEvent({ tools: ['mcp__otro__borrar'] })]).violation).toContain('mcp__otro__borrar')
    // la web solo si la tarea la permite
    const noWeb = new ClaudeStreamParser('Claude Code', 'haiku', ['aula'], Date.now, false)
    expect(noWeb.consume(E.initEvent({ tools: ['mcp__aula__x', 'WebFetch'] })).violation).toContain('WebFetch')
    // ejecutar una desconocida (aunque no saliera en init) también
    const call = E.assistant('m', [E.toolUseBlock('m1', 'Monitor', { command: 'ls' })])
    expect(run([E.initEvent(), call, E.toolResult('m1', 'salida', false)]).violation).toBeDefined()
  })

  it('integradas inofensivas no son violación', () => {
    expect(run([E.initEvent({ tools: ['ToolSearch', 'TodoWrite', 'mcp__aula__bash'] })]).violation).toBeUndefined()
    // la web propia solo con una tarea que la pida (A2-P1-2: por defecto, no)
    const web = new ClaudeStreamParser('Claude Code', 'haiku', ['aula'], Date.now, true)
    expect(web.consume(E.initEvent({ tools: ['ToolSearch', 'WebFetch', 'mcp__aula__bash'] })).violation).toBeUndefined()
    expect(run([E.initEvent({ tools: ['WebFetch'] })]).violation).toContain('WebFetch')
  })

  it('ejecutar una peligrosa es violación; si se denegó, no', () => {
    const call = E.assistant('m', [E.toolUseBlock('b1', 'Bash', { command: 'ls' }), E.toolUseBlock('b2', 'Write', {})])
    expect(run([E.initEvent(), call, E.toolResult('b1', 'denied', true)]).violation).toBeUndefined()
    expect(run([E.initEvent(), call, E.toolResult('b2', 'escrito', false)]).violation).toBeDefined()
  })
})

describe('ClaudeStreamParser · robustez', () => {
  it('basura, eventos desconocidos y mensajes de subagentes se ignoran', () => {
    const parser = makeParser()
    const lines = [
      '', '   ', 'Esto no es JSON', '{"truncado":', '[1,2,3]', '42', '"cadena"',
      E.line({ type: 'evento_nuevo_desconocido', datos: { x: 1 } }),
      E.line({ type: 'system', subtype: 'subtipo_nuevo' }),
      E.line({ type: 'stream_event', event: { type: 'algo_nuevo' } }),
      E.line({ type: 'assistant', parent_tool_use_id: 'toolu_padre', message: { id: 'sub', content: [E.textBlock('texto de subagente')] } }),
      E.line({ type: 'stream_event', parent_tool_use_id: 'toolu_padre', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'no' } } })
    ]
    let n = 0
    for (const l of lines) n += parser.consume(l).events.length
    expect(n).toBe(0)
    expect(parser.unparsedSample).toContain('Esto no es JSON')
    expect(parser.unparsedSample).toContain('truncado')
    expect(parser.conclude().type).toBe('noResult')
  })

  it('un JSON de entrada roto no rompe nada', () => {
    const o = run([E.initEvent(), E.messageStart('m'), E.blockStart(0, { type: 'tool_use', id: 't', name: 'mcp__aula__x', input: {} }), E.jsonDelta(0, '{"a": [1, 2,'), E.blockStop(0), E.result({ text: '' })])
    expect(count(o.events, 'toolStarted')).toBe(1)
  })

  it('fin de bloque sin inicio y deltas sin índice se ignoran', () => {
    const o = run([E.initEvent(), E.blockStop(5), E.jsonDelta(9, '{}'), E.thinkingDelta(0, ''), E.textDelta(0, ''), E.result({ text: '' })])
    expect(o.events).toHaveLength(1) // solo started
  })

  it('un result vacío usa el último texto del asistente', () => {
    expect(finished(run([E.initEvent(), E.assistant('m', [E.textBlock('texto final')]), E.result({ text: '' })]).conclusion).text).toBe('texto final')
  })

  it('max_tokens → length', () => {
    expect(finished(run([E.initEvent(), E.result({ text: 'cortado', stopReason: 'max_tokens' })]).conclusion).stopReason).toBe('length')
  })

  it('max_turns devuelve el último texto del asistente', () => {
    const r = finished(
      run([E.initEvent(), E.assistant('m', [E.textBlock('avance parcial')]), E.result({ subtype: 'error_max_turns', isError: true, text: null, turns: 41, errors: ['Reached maximum number of turns (40)'] })]).conclusion
    )
    expect(r.text).toBe('avance parcial')
    expect(r.stopReason).toBe('max_steps')
    expect(r.steps).toBe(41)
  })

  it('sin usage, uso cero', () => {
    const r = finished(run([E.line({ type: 'result', subtype: 'success', is_error: false, result: 'x', num_turns: 1 })]).conclusion)
    expect(r.usage).toEqual(emptyUsage())
  })

  it('quita el prefijo mcp__servidor__', () => {
    expect(stripMCPPrefix('mcp__aula__crear_leccion', ['aula'])).toBe('crear_leccion')
    expect(stripMCPPrefix('mcp__mi_servidor__a__b', ['mi_servidor'])).toBe('a__b')
    expect(stripMCPPrefix('mcp__aula__x', ['otro'])).toBe('x') // sin coincidencia corta por el primer «__»
    expect(stripMCPPrefix('WebSearch', ['aula'])).toBe('WebSearch')
    expect(stripMCPPrefix('mcp__sinprefijo', [])).toBe('mcp__sinprefijo')
    expect(stripMCPPrefix('mcp__a__x', ['a', 'a__b'])).toBe('x')
  })
})
