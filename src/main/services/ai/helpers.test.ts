// Atajos: texto, streaming y JSON con reparación (y una segunda petición que corrige).
import { describe, expect, it } from 'vitest'
import type { JSONValue } from '@shared/ai/json'
import { messageText } from '@shared/ai/types'
import { completeJSON, completeText, parseJSONReply, streamText, buildRequest } from './helpers'
import { MockChatModel, step } from './testing/mocks'

describe('texto', () => {
  it('arma la petición (sistema, conversación, usuario) y devuelve el texto', async () => {
    const m = new MockChatModel([step({ text: 'Hola', reasoning: 'pienso' })])
    const r = await completeText(m, { system: 'S', prompt: 'P', temperature: 0.2, maxTokens: 50, jsonMode: true })
    expect(r).toMatchObject({ text: 'Hola', reasoning: 'pienso', finish: 'stop' })
    const req = m.requests[0]
    expect(req.messages.map((x) => x.role)).toEqual(['system', 'user'])
    expect(req).toMatchObject({ temperature: 0.2, maxTokens: 50, jsonMode: true })
    const blind = new MockChatModel([], { vision: false, jsonMode: false })
    const b = buildRequest(blind, { prompt: 'x', images: [{ mediaType: 'image/png', base64: 'QQ==' }], jsonMode: true })
    expect(b.messages[0].content).toEqual([{ type: 'text', text: 'x' }])
    expect(b.jsonMode).toBeUndefined()
  })
  it('streaming: los fragmentos llegan a medida', async () => {
    const m = new MockChatModel([step({ text: 'Hola mundo', reasoning: 'r', chunk: 4 })])
    const texts: string[] = []
    const reasoning: string[] = []
    const r = await streamText(m, { prompt: 'x' }, { onText: (t) => texts.push(t), onReasoning: (t) => reasoning.push(t) })
    expect(texts).toEqual(['Hola', ' mun', 'do'])
    expect(reasoning).toEqual(['r'])
    expect(r.text).toBe('Hola mundo')
  })
})

describe('JSON', () => {
  it('lee JSON en vallas, con LaTeX de una barra y comas finales', () => {
    expect(parseJSONReply('```json\n{"tex": "\\frac{1}{2}", "a": [1, 2,],}\n```')).toEqual({ tex: '\\frac{1}{2}', a: [1, 2] })
    expect(parseJSONReply('Aquí tienes: {"ok": true} ¡listo!')).toEqual({ ok: true })
    expect(parseJSONReply('')).toBeUndefined()
  })
  it('a la primera, con el esquema en las instrucciones y el modo JSON', async () => {
    const m = new MockChatModel([step({ text: '{"nota": 8, "comentario": "Bien"}' })])
    const r = await completeJSON(m, { system: 'Corrige.', prompt: 'Respuesta: 42', schema: { type: 'object', properties: { nota: { type: 'number' } } } })
    expect(r.value).toEqual({ nota: 8, comentario: 'Bien' })
    expect(r.attempts).toBe(1)
    const sys = messageText(m.requests[0].messages[0])
    expect(sys.startsWith('Corrige.')).toBe(true)
    expect(sys).toContain('JSON Schema')
    expect(m.requests[0].jsonMode).toBe(true)
  })
  it('si no vale, repite diciendo qué falló (y suma el uso)', async () => {
    const m = new MockChatModel([step({ text: 'no sé' }), step({ text: '{"nota": 11}' }), step({ text: '{"nota": 7}' })])
    const validate = (v: JSONValue) => {
      const n = (v as { nota?: unknown }).nota
      return typeof n === 'number' && n >= 0 && n <= 10 ? { ok: true as const, value: n } : { ok: false as const, error: 'nota must be a number between 0 and 10' }
    }
    const r = await completeJSON(m, { prompt: 'Corrige', validate, repairAttempts: 2 })
    expect(r.value).toBe(7)
    expect(r.attempts).toBe(3)
    expect(r.usage.promptTokens).toBe(30)
    const last = m.requests[2].messages
    expect(last.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
    expect(messageText(last[5])).toContain('nota must be a number between 0 and 10')
    expect(messageText(last[3])).toContain('not valid JSON')
  })
  it('se rinde con un error claro', async () => {
    const m = new MockChatModel([step({ text: 'nada' })])
    await expect(completeJSON(m, { prompt: 'x', repairAttempts: 1 })).rejects.toMatchObject({ code: 'ai_bad_response' })
    expect(m.callCount).toBe(2)
    const cut = new MockChatModel([step({ text: '{"a": "cort', finish: 'length' })])
    const e = await completeJSON(cut, { prompt: 'x', repairAttempts: 0 }).catch((x) => x)
    expect(e.message).toContain('length limit')
  })
})
