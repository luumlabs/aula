// Port de Tests/AIKitTests/ThinkTagTests.swift: razonamiento escrito dentro del texto (`<think>…</think>`) por modelos locales.
import { describe, expect, it } from 'vitest'
import { msg } from '@shared/ai/types'
import { collect, digest, jsonReply, mockFetch, sseReply, testDeps } from '../testing/mocks'
import { runToolLoop } from '../loop/toolLoop'
import { ThinkTagSplitter } from './common'
import { OpenAICompatibleModel } from './openai'
import type { ProviderConfig } from './config'

function split(chunks: string[]): { reasoning: string; visible: string } {
  const s = new ThinkTagSplitter()
  let reasoning = ''
  let visible = ''
  for (const c of chunks) {
    const r = s.feed(c)
    reasoning += r.reasoning
    visible += r.visible
  }
  const f = s.finish()
  return { reasoning: reasoning + f.reasoning, visible: visible + f.visible }
}

describe('separador de <think>', () => {
  it('texto entero; saltos tras el cierre; espacios antes de abrir', () => {
    expect(split(['<think>Pienso un poco.</think>La respuesta es 4.'])).toEqual({ reasoning: 'Pienso un poco.', visible: 'La respuesta es 4.' })
    expect(split(['<think>x</think>\n\nHola']).visible).toBe('Hola')
    expect(split(['<think>x</think>\n', '\nHola']).visible).toBe('Hola')
    expect(split(['<think>x</think>', '\n', '\n', 'Hola\nmundo']).visible).toBe('Hola\nmundo')
    expect(split(['  \n<think>idea</think>ok'])).toEqual({ reasoning: 'idea', visible: 'ok' })
  })
  it('cualquier corte da lo mismo', () => {
    const text = '<think>Primero ñandú 👋 y luego otra cosa.</think>\nResultado final con $x^2$.'
    const chars = Array.from(text)
    const expected = { reasoning: 'Primero ñandú 👋 y luego otra cosa.', visible: 'Resultado final con $x^2$.' }
    for (let i = 0; i <= chars.length; i++) expect(split([chars.slice(0, i).join(''), chars.slice(i).join('')])).toEqual(expected)
    expect(split(chars)).toEqual(expected)
  })
  it('sin etiquetas pasa tal cual; etiquetas tras texto visible no cuentan; solo el primer bloque', () => {
    expect(split(['Hola ', 'mundo']).visible).toBe('Hola mundo')
    expect(split(['  Hola']).visible).toBe('  Hola')
    expect(split(['<html>no es razonamiento</html>']).visible).toBe('<html>no es razonamiento</html>')
    expect(split(['<thinking>otra cosa</thinking>']).visible).toBe('<thinking>otra cosa</thinking>')
    expect(split(['<thi', 's es otro texto>']).visible).toBe('<this es otro texto>')
    expect(split(['']).visible).toBe('')
    expect(split(['Respuesta con <think>etiqueta</think> en medio.'])).toEqual({ reasoning: '', visible: 'Respuesta con <think>etiqueta</think> en medio.' })
    expect(split(['<think>uno</think>texto<think>dos</think>fin'])).toEqual({ reasoning: 'uno', visible: 'texto<think>dos</think>fin' })
  })
  it('sin cerrar termina como razonamiento; un inicio parcial al final es texto; va saliendo poco a poco', () => {
    expect(split(['<think>pensando sin cerrar'])).toEqual({ reasoning: 'pensando sin cerrar', visible: '' })
    expect(split(['<think>idea</thi']).reasoning).toBe('idea</thi')
    expect(split(['<thi']).visible).toBe('<thi')
    expect(split(['   ']).visible).toBe('   ')
    const s = new ThinkTagSplitter()
    expect(s.feed('<think>uno ').reasoning).toBe('uno ')
    expect(s.feed('dos').reasoning).toBe('dos')
    expect(s.feed('</think>hola').visible).toBe('hola')
    expect(s.feed(' y más').visible).toBe(' y más')
  })
})

describe('a través del proveedor', () => {
  const config: ProviderConfig = { id: 'local', kind: 'openai-compatible', label: 'Local', baseURL: 'http://localhost:11434/v1', model: 'qwen3', secretRef: null,
    extraHeaders: {}, supportsTools: true, supportsVision: false, supportsStreaming: true, supportsJSONMode: false, enabled: true }
  const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`
  const end = (finish = 'stop') => `data: {"choices":[{"index":0,"delta":{},"finish_reason":"${finish}"}]}\n\ndata: [DONE]\n\n`
  const run = async (s: string, size = 0, cfg = config) => {
    const mf = mockFetch([sseReply(s, size)])
    return digest((await collect(new OpenAICompatibleModel(cfg, testDeps(mf.fetch)), { messages: [msg.user('Hola')] })).events)
  }

  it('el razonamiento en línea pasa a eventos de razonamiento (con cualquier troceo)', async () => {
    const s = chunk('<think>Hay que') + chunk(' derivar.</th') + chunk('ink>\n') + chunk('La derivada es ') + chunk('$2x$.') + end()
    for (const size of [0, 1, 3, 17]) {
      const d = await run(s, size)
      expect(d.reasoning).toBe('Hay que derivar.')
      expect(d.text).toBe('La derivada es $2x$.')
    }
  })
  it('también en respuestas JSON enteras; sin cerrar al final; junto a los campos propios', async () => {
    const mf = mockFetch([jsonReply('{"choices":[{"index":0,"message":{"role":"assistant","content":"<think>razono</think>\\nrespondo"},"finish_reason":"stop"}]}')])
    const d = digest((await collect(new OpenAICompatibleModel({ ...config, supportsStreaming: false }, testDeps(mf.fetch)), { messages: [msg.user('x')] })).events)
    expect(d).toMatchObject({ reasoning: 'razono', text: 'respondo' })
    expect(await run(chunk('<think>sin cerrar') + end('length'))).toMatchObject({ reasoning: 'sin cerrar', text: '', finish: 'length' })
    const both = await run('data: {"choices":[{"index":0,"delta":{"reasoning_content":"campo propio"}}]}\n\n' + chunk('<think>y etiqueta</think>texto') + end())
    expect(both).toMatchObject({ reasoning: 'campo propioy etiqueta', text: 'texto' })
  })
  it('el bucle deja el razonamiento fuera del texto final', async () => {
    const mf = mockFetch([sseReply(chunk('<think>pienso</think>') + chunk('Texto final.') + end())])
    let shown = ''
    const r = await runToolLoop({ model: new OpenAICompatibleModel(config, testDeps(mf.fetch)), prompt: 'x', onEvent: (e) => e.type === 'text' && (shown += e.text) })
    expect(r.text).toBe('Texto final.')
    expect(shown).toBe('Texto final.')
  })
})
