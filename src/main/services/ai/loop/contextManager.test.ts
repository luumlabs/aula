// Port de Tests/AIKitTests/ContextManagerTests.swift: estimación de tokens y recorte del historial del agente.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { messageImages, messageText, msg, type ImagePart, type ToolSpec } from '@shared/ai/types'
import type { JSONObject } from '@shared/ai/json'
import {
  droppedNote, estimateMessage, estimateText, estimateTools, estimateTurn, fitTurns, hardCut, reportChanged, reportSummary, shouldTrim, shrinkValue,
  trimmedItem, turnAssistantMessage, turnMessages, turnResultMessages, TOKENS_PER_IMAGE, TRIM_HYSTERESIS, TRIM_MARKER, type ResultItem, type Turn
} from './contextManager'
import { parseTextTools } from './textToolProtocol'

const weatherTool: ToolSpec = { name: 'get_weather', description: 'Clima de una ciudad', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }
const bigText = (chars: number, first = 'Primera línea del resultado') => first + '\n' + 'x'.repeat(Math.max(0, chars - first.length - 1))
const item = (o: Partial<ResultItem> & { text: string }): ResultItem => ({ callID: '1', name: 't', images: [], ok: true, ...o })

function turn(i: number, o: { resultChars?: number; argChars?: number; images?: ImagePart[] } = {}): Turn {
  return {
    text: `paso ${i}`,
    calls: [{ id: `c${i}`, name: 't', arguments: { texto: 'a'.repeat(o.argChars ?? 50) } }],
    items: [{ callID: `c${i}`, name: 't', text: bigText(o.resultChars ?? 3500, `Resultado ${i}`), images: o.images ?? [], ok: true }]
  }
}
const total = (turns: Turn[], fixed = 0, textMode = false) => fixed + turns.reduce((n, t) => n + estimateTurn(t, textMode), 0)
const texts = (turns: Turn[]) => turns.map((t) => t.items.map((x) => x.text))
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

beforeEach(() => setAILocale('es'))

describe('estimación', () => {
  it('caracteres / 3,5 (por escalares, no bytes)', () => {
    expect(estimateText('a'.repeat(350))).toBe(100)
    expect(estimateText('a'.repeat(351))).toBe(101)
    expect(estimateText('')).toBe(0)
    expect(estimateText('😀'.repeat(100))).toBe(29)
  })
  it('mensajes: sobrecoste, imágenes y llamadas; herramientas con su esquema', () => {
    expect(estimateMessage(msg.user('a'.repeat(350)))).toBe(104)
    expect(estimateMessage(msg.user('', [{ mediaType: 'image/png', base64: 'QUJD' }]))).toBe(TOKENS_PER_IMAGE + 4)
    expect(estimateMessage(msg.assistant('', [{ id: '1', name: 'get_weather', arguments: { city: 'Bogotá' } }]))).toBeGreaterThan(9)
    expect(estimateTools([weatherTool])).toBeGreaterThan(estimateText('get_weather'))
    expect(estimateTools([])).toBe(0)
  })
})

describe('recorte', () => {
  it('si cabe, nada cambia', () => {
    const turns = range(4).map((i) => turn(i))
    const before = texts(turns)
    const r = fitTurns(turns, 100, 1_000_000, false, false)
    expect(reportChanged(r)).toBe(false)
    expect(texts(turns)).toEqual(before)
  })
  it('primero los resultados antiguos, conservando su primera línea', () => {
    const turns = range(6).map((i) => turn(i))
    const budget = total(turns) - 2 * estimateTurn(turns[0], false)
    const r = fitTurns(turns, 0, budget, false, false)
    expect(reportChanged(r)).toBe(true)
    expect(r.trimmedResults).toBeGreaterThan(0)
    expect(r.droppedTurns).toBe(0)
    expect(total(turns)).toBeLessThanOrEqual(budget)
    expect(turns[0].items[0].text).toBe('Resultado 0\n[recortado]')
    expect(turns[0].items[0].trimmed).toBe(true)
    expect(turns.at(-1)!.items[0].text).not.toContain('[recortado]')
    expect(turns.at(-2)!.items[0].text).not.toContain('[recortado]')
  })
  it('del más viejo al más nuevo, bajando al 80 % para que el paso siguiente quepa sin recortar', () => {
    const turns = range(6).map((i) => turn(i))
    const one = estimateTurn(turns[0], false)
    const saved = one - estimateTurn({ ...turns[0], items: turns[0].items.map(trimmedItem) }, false)
    const budget = total(turns) - saved + 1
    const r = fitTurns(turns, 0, budget, false, false)
    const soft = Math.floor(budget * TRIM_HYSTERESIS)
    const needed = Math.ceil((total(range(6).map((i) => turn(i))) - soft) / saved)
    expect(r.trimmedResults).toBe(Math.min(4, needed))
    expect(turns[0].items[0].trimmed).toBe(true)
    expect(turns[4].items[0].trimmed || turns[5].items[0].trimmed).toBeFalsy()
    expect(r.droppedTurns).toBe(0)
    const next = [...turns, turn(6, { resultChars: 200 })]
    const before = texts(next)
    expect(reportChanged(fitTurns(next, 0, budget, false, false))).toBe(false)
    expect(texts(next)).toEqual(before)
  })
  it('los resultados cortos no se recortan; el recorte quita imágenes y acorta la primera línea', () => {
    expect(shouldTrim(item({ text: 'corto' }))).toBe(false)
    expect(shouldTrim(item({ text: 'x'.repeat(301) }))).toBe(true)
    expect(shouldTrim(item({ text: 'corto', images: [{ mediaType: 'image/png', base64: 'QQ==' }] }))).toBe(true)
    expect(shouldTrim(item({ text: 'x'.repeat(900), trimmed: true }))).toBe(false)
    const t = trimmedItem(item({ text: 'L'.repeat(500) + '\nsegunda', images: [{ mediaType: 'image/png', base64: 'QQ==' }] }))
    expect(t.images).toEqual([])
    expect(t.text.endsWith('\n[recortado]')).toBe(true)
    expect(t.text.length).toBeLessThan(230)
    expect(t.text).toContain('…')
    expect(trimmedItem(item({ text: '\n\n\n' })).text).toBe('[recortado]')
  })
  it('los argumentos largos de llamadas antiguas se acortan antes de tirar pasos', () => {
    const turns = range(5).map((i) => turn(i, { resultChars: 100, argChars: 20_000 }))
    const r = fitTurns(turns, 0, Math.floor(total(turns) / 2), false, false)
    expect(r.shrunkArguments).toBeGreaterThan(0)
    expect(r.droppedTurns).toBe(0)
    const shrunk = (turns[0].calls[0].arguments as JSONObject).texto as string
    expect(shrunk.endsWith('…[recortado]')).toBe(true)
    expect(shrunk.length).toBeLessThan(300)
    expect(turns[0].calls[0].rawArguments).toBeUndefined()
    expect(((turns.at(-1)!.calls[0].arguments as JSONObject).texto as string).length).toBe(20_000)
  })
  it('acortar entra en valores anidados', () => {
    const { value, changed } = shrinkValue({ a: { b: ['z'.repeat(1000), 'corto'] }, n: 5 })
    expect(changed).toBe(true)
    const o = value as { a: { b: string[] }; n: number }
    expect(o.n).toBe(5)
    expect(o.a.b[1]).toBe('corto')
    expect(o.a.b[0].endsWith('[recortado]')).toBe(true)
    expect(shrinkValue({ x: 'corto' }).changed).toBe(false)
  })
  it('como último recurso se tiran pasos enteros antiguos (siempre quedan los recientes)', () => {
    const turns = range(8).map((i) => turn(i, { resultChars: 200, argChars: 100 }))
    const budget = Math.floor(total(turns) / 3)
    const r = fitTurns(turns, 0, budget, false, false)
    expect(r.droppedTurns).toBeGreaterThan(0)
    expect(total(turns)).toBeLessThanOrEqual(budget)
    expect(turns.length).toBeGreaterThanOrEqual(2)
    expect(turns.at(-1)!.text).toBe('paso 7')
    expect(turns.length).toBe(8 - r.droppedTurns)
  })
  it('el último paso siempre se conserva y su resultado no se recorta en modo normal', () => {
    const turns = range(3).map((i) => turn(i, { resultChars: 30_000 }))
    fitTurns(turns, 0, 100, false, false)
    expect(turns).toHaveLength(1)
    expect(turns[0].text).toBe('paso 2')
    expect(turns[0].items[0].trimmed).toBeFalsy()
  })
  it('los dos últimos pasos se protegen hasta que nada más ayude', () => {
    const turns = range(4).map((i) => turn(i, { resultChars: 20_000 }))
    fitTurns(turns, 0, 2 * estimateTurn(turns[3], false) + 600, false, false)
    expect(turns).toHaveLength(4)
    expect(turns[0].items[0].trimmed && turns[1].items[0].trimmed).toBe(true)
    expect(turns[2].items[0].trimmed || turns[3].items[0].trimmed).toBeFalsy()
    const two = range(2).map((i) => turn(i, { resultChars: 40_000 }))
    fitTurns(two, 0, estimateTurn(two[1], false) + 500, false, false)
    expect(two[0].items[0].trimmed).toBe(true)
    expect(two[1].items[0].trimmed).toBeFalsy()
  })
  it('modo agresivo: a la mitad del tamaño actual, incluso el resultado más reciente', () => {
    const turns = range(4).map((i) => turn(i, { resultChars: 30_000 }))
    const before = total(turns)
    expect(reportChanged(fitTurns(turns, 0, before + 1000, false, false))).toBe(false)
    expect(reportChanged(fitTurns(turns, 0, before + 1000, false, true))).toBe(true)
    expect(total(turns)).toBeLessThanOrEqual(before / 2)
    expect(turns[0].items[0].trimmed).toBe(true)
    const one = [turn(0, { resultChars: 100_000 })]
    const r = fitTurns(one, 0, 1_000_000, false, true)
    expect(r.trimmedResults).toBeGreaterThan(0)
    const t = one[0].items[0].text
    expect(Array.from(t).length).toBeLessThanOrEqual(4000 + TRIM_MARKER.length + 2)
    expect(t.endsWith('[recortado]')).toBe(true)
    expect(t.startsWith('Resultado 0')).toBe(true)
  })
  it('corte duro, tokens fijos, idempotencia y modo de texto', () => {
    expect(hardCut('corto', 10)).toBe('corto')
    expect(hardCut('abcdefghij', 4)).toBe('abcd\n[recortado]')
    const a = range(5).map((i) => turn(i))
    const b = range(5).map((i) => turn(i))
    const budget = total(a) + 10
    expect(reportChanged(fitTurns(a, 0, budget, false, false))).toBe(false)
    expect(reportChanged(fitTurns(b, 50_000, budget, false, false))).toBe(true)
    const many = range(10).map((i) => turn(i, { resultChars: 5000, argChars: 3000 }))
    const b2 = Math.floor(total(many) / 3)
    fitTurns(many, 0, b2, false, false)
    const snap = texts(many)
    expect(reportChanged(fitTurns(many, 0, b2, false, false))).toBe(false)
    expect(texts(many)).toEqual(snap)
    const textTurns = range(5).map((i) => ({ ...turn(i, { resultChars: 4000 }), rawText: 'texto\n```tool\n{"name":"t","arguments":{}}\n```' }))
    const tb = Math.floor(total(textTurns, 0, true) / 2)
    expect(reportChanged(fitTurns(textTurns, 0, tb, true, false))).toBe(true)
    expect(total(textTurns, 0, true)).toBeLessThanOrEqual(tb)
  })
  it('resumen del informe y nota de pasos omitidos', () => {
    expect(reportChanged({ trimmedResults: 0, shrunkArguments: 0, droppedTurns: 0 })).toBe(false)
    const s = reportSummary({ trimmedResults: 3, droppedTurns: 2, shrunkArguments: 1 })
    expect(s).toContain('recorté 3')
    expect(s).toContain('omití 2')
    expect(s).toContain('acorté')
    const n = droppedNote(7)
    expect(n.role).toBe('user')
    expect(messageText(n)).toContain('7 pasos')
  })
})

describe('pasos (Turn)', () => {
  it('mensajes en modo nativo y de texto', () => {
    const t: Turn = { text: 'Voy.', reasoning: 'pienso', calls: [{ id: 'c1', name: 'eco', arguments: { texto: 'hola' } }], items: [item({ callID: 'c1', name: 'eco', text: 'eco: hola' })] }
    const native = turnMessages(t, false)
    expect(native.map((m) => m.role)).toEqual(['assistant', 'tool'])
    expect(native[0].toolCalls![0].id).toBe('c1')
    expect(native[0].reasoning).toBe('pienso')
    expect(native[1].toolCallID).toBe('c1')
    expect(messageText(native[1])).toBe('eco: hola')
    const text = turnMessages(t, true)
    expect(text.map((m) => m.role)).toEqual(['assistant', 'user'])
    expect(text[0].toolCalls ?? []).toEqual([])
    expect(messageText(text[0])).toContain('```tool')
    expect(messageText(text[0]).startsWith('Voy.')).toBe(true)
    expect(messageText(text[1])).toContain('<tool_result name="eco" ok="true">')
    expect(parseTextTools(messageText(text[0])).calls[0].arguments).toEqual({ texto: 'hola' })
  })
  it('en modo de texto manda el texto original; imágenes de herramientas en los dos modos', () => {
    const t: Turn = { text: 'x', rawText: 'RAW', calls: [], items: [] }
    expect(messageText(turnAssistantMessage(t, true))).toBe('RAW')
    expect(turnResultMessages(t, true)).toEqual([])
    const img = { mediaType: 'image/png', base64: 'QQ==' }
    const withImg: Turn = { text: '', calls: [{ id: 'c', name: 'cap', arguments: {} }], items: [item({ callID: 'c', name: 'cap', text: 'ok', images: [img] })] }
    expect(messageImages(turnResultMessages(withImg, false)[0])).toEqual([img])
    expect(messageImages(turnResultMessages(withImg, true)[0])).toEqual([img])
  })
})
