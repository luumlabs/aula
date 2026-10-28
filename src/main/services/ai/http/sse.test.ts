// Port de Tests/AIKitTests/SSEParserTests.swift.
import { describe, expect, it } from 'vitest'
import { SSEParser, isDoneEvent, type SSEEvent } from './sse'
import { Fixtures } from '../testing/fixtures'

const enc = new TextEncoder()

function parseAll(chunks: (Uint8Array | string)[], max?: number): SSEEvent[] {
  const p = new SSEParser(max)
  const out: SSEEvent[] = []
  for (const c of chunks) out.push(...p.feed(c))
  out.push(...p.finish())
  return out
}

function split(data: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size))
  return out
}

/** Generador determinista (SplitMix64 de 32 bits simplificado). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
}

function randomSplit(data: Uint8Array, maxSize: number, seed: number): Uint8Array[] {
  const next = rng(seed)
  const out: Uint8Array[] = []
  let i = 0
  while (i < data.length) {
    const n = 1 + (next() % maxSize)
    out.push(data.slice(i, i + n))
    i += n
  }
  return out
}

describe('SSEParser · básicos', () => {
  it('un evento', () => {
    expect(new SSEParser().feed('data: hola\n\n')).toEqual([{ data: 'hola' }])
  })

  it('nombre, id y retry', () => {
    const p = new SSEParser()
    expect(p.feed('event: message_start\nid: 42\nretry: 3000\ndata: {"a":1}\n\n')).toEqual([{ event: 'message_start', data: '{"a":1}', id: '42', retry: 3000 }])
    expect(p.lastEventID).toBe('42')
    expect(p.retryMilliseconds).toBe(3000)
  })

  it('varias líneas data se unen con salto de línea', () => {
    expect(new SSEParser().feed('data: línea 1\ndata: línea 2\ndata:\ndata: línea 4\n\n')[0].data).toBe('línea 1\nlínea 2\n\nlínea 4')
  })

  it('solo se quita un espacio inicial', () => {
    const p = new SSEParser()
    expect(p.feed('data:sin espacio\n\n')[0].data).toBe('sin espacio')
    expect(p.feed('data:  dos espacios\n\n')[0].data).toBe(' dos espacios')
  })

  it('los comentarios se ignoran pero se cuentan', () => {
    const p = new SSEParser()
    expect(p.feed(': keep-alive\n\n: OPENROUTER PROCESSING\n\ndata: x\n\n')).toEqual([{ data: 'x' }])
    expect(p.commentLines).toBe(2)
  })

  it('un comentario dentro de un evento no lo rompe', () => {
    expect(new SSEParser().feed('data: a\n: nota\ndata: b\n\n')[0].data).toBe('a\nb')
  })

  it('un evento sin datos no se entrega y su nombre no se arrastra', () => {
    const p = new SSEParser()
    expect(p.feed('event: ping\n\n')).toEqual([])
    expect(p.feed('data: x\n\n')).toEqual([{ data: 'x' }])
  })

  it('campos desconocidos se ignoran', () => {
    expect(new SSEParser().feed('foo: bar\nbaz\ndata: ok\n\n')).toEqual([{ data: 'ok' }])
  })

  it('marca [DONE]', () => {
    const ev = new SSEParser().feed('data: [DONE]\n\n')
    expect(ev).toHaveLength(1)
    expect(isDoneEvent(ev[0])).toBe(true)
    expect(isDoneEvent({ data: '{}' })).toBe(false)
  })

  it('un id con NUL se ignora', () => {
    expect(new SSEParser().feed('id: a\u0000b\ndata: x\n\n')[0].id).toBeUndefined()
  })

  it('un retry no numérico se ignora', () => {
    const p = new SSEParser()
    p.feed('retry: abc\ndata: x\n\n')
    expect(p.retryMilliseconds).toBeUndefined()
  })

  it('el último id persiste entre eventos', () => {
    const p = new SSEParser()
    p.feed('id: 7\ndata: a\n\ndata: b\n\n')
    expect(p.lastEventID).toBe('7')
  })
})

describe('SSEParser · finales de línea', () => {
  it('CRLF', () => {
    expect(new SSEParser().feed('data: a\r\n\r\ndata: b\r\n\r\n').map((e) => e.data)).toEqual(['a', 'b'])
  })
  it('CR solo', () => {
    expect(new SSEParser().feed('data: a\r\rdata: b\r\r').map((e) => e.data)).toEqual(['a', 'b'])
  })
  it('mezclados', () => {
    expect(new SSEParser().feed('data: a\r\n\ndata: b\n\r\ndata: c\r\r').map((e) => e.data)).toEqual(['a', 'b', 'c'])
  })
  it('CRLF partido entre trozos', () => {
    const p = new SSEParser()
    const out = [...p.feed('data: a\r'), ...p.feed('\n\r'), ...p.feed('\ndata: b\r\n\r\n')]
    expect(out.map((e) => e.data)).toEqual(['a', 'b'])
  })
  it('líneas en blanco de sobra no hacen daño', () => {
    expect(new SSEParser().feed('\n\n\ndata: a\n\n\n\ndata: b\n\n').map((e) => e.data)).toEqual(['a', 'b'])
  })
})

describe('SSEParser · BOM y UTF-8', () => {
  it('quita el BOM inicial', () => {
    expect(new SSEParser().feed(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('data: bom\n\n')]))).toEqual([{ data: 'bom' }])
  })
  it('BOM partido entre trozos', () => {
    const p = new SSEParser()
    const out = [...p.feed(new Uint8Array([0xef, 0xbb])), ...p.feed(new Uint8Array([0xbf, ...enc.encode('data: bom\n\n')]))]
    expect(out).toEqual([{ data: 'bom' }])
  })
  it('un BOM a mitad del flujo se conserva (campo desconocido)', () => {
    const bytes = new Uint8Array([...enc.encode('data: a\n\n'), 0xef, 0xbb, 0xbf, ...enc.encode('data: b\n\n')])
    expect(new SSEParser().feed(bytes)).toHaveLength(1)
  })
  it('caracteres multibyte partidos de todas las formas posibles', () => {
    const data = enc.encode('data: ñandú 👋 日本語 \u{1F1EA}\u{1F1F8}\n\n')
    for (let i = 1; i < data.length; i++) {
      expect(parseAll([data.slice(0, i), data.slice(i)]).map((e) => e.data)).toEqual(['ñandú 👋 日本語 \u{1F1EA}\u{1F1F8}'])
    }
  })
  it('byte a byte', () => {
    const events = parseAll(split(enc.encode('event: x\ndata: ¿Qué tal, señor? 😀\n\ndata: [DONE]\n\n'), 1))
    expect(events.map((e) => e.data)).toEqual(['¿Qué tal, señor? 😀', '[DONE]'])
    expect(events[0].event).toBe('x')
  })
  it('cualquier troceo equivale a la entrada entera', () => {
    const data = enc.encode(Fixtures.openAIText + Fixtures.deepseekReasoning + Fixtures.openRouter + Fixtures.anthropicTextAndTools)
    const expected = parseAll([data])
    expect(expected.length).toBeGreaterThan(20)
    for (let seed = 1; seed <= 25; seed++) expect(parseAll(randomSplit(data, 37, seed))).toEqual(expected)
    for (const size of [1, 2, 3, 5, 64, 1000]) expect(parseAll(split(data, size))).toEqual(expected)
  })
  it('UTF-8 inválido no rompe nada', () => {
    const ev = new SSEParser().feed(new Uint8Array([...enc.encode('data: '), 0xff, 0xfe, 0x41, ...enc.encode('\n\n')]))
    expect(ev).toHaveLength(1)
    expect(ev[0].data).toContain('A')
  })
})

describe('SSEParser · fin del flujo', () => {
  it('finish entrega el evento sin línea en blanco final', () => {
    const p = new SSEParser()
    expect(p.feed('data: [DONE]')).toEqual([])
    expect(p.finish().map((e) => e.data)).toEqual(['[DONE]'])
  })
  it('finish entrega una línea completa sin salto', () => {
    const p = new SSEParser()
    expect(p.feed('event: x\ndata: casi')).toEqual([])
    expect(p.finish()).toEqual([{ event: 'x', data: 'casi' }])
  })
  it('sin nada pendiente no devuelve nada', () => {
    const p = new SSEParser()
    p.feed('data: a\n\n')
    expect(p.finish()).toEqual([])
  })
  it('finish es idempotente', () => {
    const p = new SSEParser()
    p.feed('data: a')
    expect(p.finish()).toHaveLength(1)
    expect(p.finish()).toEqual([])
  })
  it('sigue funcionando tras finish', () => {
    const p = new SSEParser()
    p.feed('data: a')
    p.finish()
    expect(p.feed('data: b\n\n').map((e) => e.data)).toEqual(['b'])
  })
})

describe('SSEParser · entradas hostiles', () => {
  it('una línea enorme se descarta sin matar el flujo', () => {
    const p = new SSEParser(1024)
    expect(p.feed('data: ' + 'x'.repeat(5000) + '\n\ndata: sigue\n\n').map((e) => e.data)).toEqual(['sigue'])
    expect(p.droppedLines).toBe(1)
  })
  it('una línea enorme en trozos', () => {
    const p = new SSEParser(100)
    const out: SSEEvent[] = []
    for (let i = 0; i < 50; i++) out.push(...p.feed('y'.repeat(40)))
    out.push(...p.feed('\n\ndata: ok\n\n'))
    expect(out.map((e) => e.data)).toEqual(['ok'])
    expect(p.droppedLines).toBe(1)
  })
  it('basura sin saltos de línea nunca produce eventos', () => {
    const p = new SSEParser(64)
    const next = rng(99)
    const bytes = new Uint8Array(5000).map(() => {
      const b = next() & 0xff
      return b === 0x0a || b === 0x0d ? 0x41 : b
    })
    expect(p.feed(bytes)).toEqual([])
  })
  it('basura binaria no rompe nada', () => {
    const p = new SSEParser()
    const next = rng(7)
    for (let i = 0; i < 200; i++) p.feed(new Uint8Array(next() % 300).map(() => next() & 0xff))
    expect(() => p.finish()).not.toThrow()
  })
  it('«data» sin dos puntos es una línea de datos vacía', () => {
    expect(new SSEParser().feed(':\n:\ndata\n\n')).toEqual([{ data: '' }])
  })
})

describe('SSEParser · flujos reales', () => {
  it('OpenAI', () => {
    const events = parseAll([Fixtures.openAIText])
    expect(events).toHaveLength(7)
    expect(isDoneEvent(events[events.length - 1])).toBe(true)
  })
  it('Anthropic conserva los nombres de evento', () => {
    const events = parseAll([Fixtures.anthropicTextAndTools])
    expect(events[0].event).toBe('message_start')
    expect(events[events.length - 1].event).toBe('message_stop')
    expect(events.some((e) => e.event === 'ping')).toBe(true)
  })
  it('todas las fixtures son JSON bien formado', () => {
    const streams = [Fixtures.openAIText, Fixtures.openAIToolCalls, Fixtures.deepseekReasoning, Fixtures.openRouter, Fixtures.openRouterMidStreamError,
      Fixtures.mimoToolCall, Fixtures.openAILatexToolCall, Fixtures.anthropicTextAndTools, Fixtures.anthropicThinkingTool, Fixtures.anthropicOverloadedMidStream]
    for (const f of streams) for (const ev of parseAll([f])) if (!isDoneEvent(ev)) expect(() => JSON.parse(ev.data)).not.toThrow()
    for (const j of [Fixtures.openAI401, Fixtures.openAI404Model, Fixtures.openAI429, Fixtures.openAIQuota429, Fixtures.deepseek402, Fixtures.deepseek401,
      Fixtures.mimo401, Fixtures.openRouter402, Fixtures.openRouterNoTools404, Fixtures.openRouterProvider400, Fixtures.ollamaNoTools400,
      Fixtures.deepseekContext400, Fixtures.anthropic401, Fixtures.anthropic429, Fixtures.anthropic529, Fixtures.anthropicTooLong400,
      Fixtures.anthropicThinkingSig400]) expect(() => JSON.parse(j)).not.toThrow()
  })
})
