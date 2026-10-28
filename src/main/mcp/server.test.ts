// Port de `Tests/AgentKitTests/MCPServerTests.swift`: el servidor MCP con `handleLine` (una línea JSON-RPC → respuesta).
import { describe, expect, it } from 'vitest'
import { MCPServer } from './server'

function makeServer(): MCPServer {
  const server = new MCPServer({ name: 'aula-test', version: '1.2.3', instructions: 'Usa las herramientas de Aula.' })
  server.addTool({ name: 'suma', description: 'Suma dos números.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }, (args) => ({
    text: String(Math.trunc(Number(args.a ?? 0) + Number(args.b ?? 0)))
  }))
  server.addTool({ name: 'eco', description: 'Devuelve el texto.', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }, (args) => ({ text: String(args.texto ?? '') }))
  server.addTool({ name: 'args', description: 'Devuelve los argumentos.', inputSchema: {} }, (args) => ({ text: JSON.stringify(args) }))
  server.addTool({ name: 'imagen', description: 'Una imagen.', inputSchema: { type: 'object', properties: {} } }, () => ({ text: 'mira', images: [{ mediaType: 'image/png', base64: 'QUJD' }] }))
  server.addTool({ name: 'falla', description: 'Lanza.', inputSchema: { type: 'object', properties: {} } }, () => {
    throw new Error('no se pudo')
  })
  server.addTool({ name: 'marcada', description: 'isError.', inputSchema: { type: 'object', properties: {} } }, () => ({ text: 'mal', isError: true }))
  return server
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function rpc(server: MCPServer, json: string): Promise<Json> {
  const reply = await server.handleLine(json)
  if (reply === undefined) return undefined
  expect(reply).not.toContain('\n') // una sola línea
  return JSON.parse(reply)
}

describe('MCPServer · initialize', () => {
  it('negocia la versión del protocolo', async () => {
    const server = makeServer()
    const cases: [string | undefined, string][] = [
      ['2025-06-18', '2025-06-18'], ['2025-03-26', '2025-03-26'], ['2024-11-05', '2024-11-05'],
      ['2025-11-25', '2025-06-18'], // más nueva: la más alta que soportamos
      ['2025-04-01', '2025-03-26'], // entre dos nuestras: la inferior
      ['2024-01-01', '2025-06-18'], // anterior a todas: nuestra más reciente
      [undefined, '2025-06-18']
    ]
    for (const [i, [requested, expected]] of cases.entries()) {
      const params = requested ? `,"params":{"protocolVersion":"${requested}","capabilities":{},"clientInfo":{"name":"t","version":"1"}}` : ''
      const reply = await rpc(server, `{"jsonrpc":"2.0","id":${i},"method":"initialize"${params}}`)
      expect(reply.result.protocolVersion, String(requested)).toBe(expected)
      expect(reply.id).toBe(i)
    }
  })

  it('forma del resultado', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}')
    expect(reply.result.capabilities.tools.listChanged).toBe(false)
    expect(reply.result.serverInfo).toEqual({ name: 'aula-test', version: '1.2.3' })
    expect(reply.result.instructions).toBe('Usa las herramientas de Aula.')
    expect(reply.jsonrpc).toBe('2.0')
  })

  it('sin instrucciones no las envía', async () => {
    const reply = await rpc(new MCPServer({ name: 'x', version: '1' }), '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
    expect(reply.result.instructions).toBeUndefined()
  })

  it('las notificaciones no tienen respuesta', async () => {
    const server = makeServer()
    expect(await server.handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeUndefined()
    expect(await server.handleLine('{"jsonrpc":"2.0","method":"notifications/lo-que-sea","params":{"a":1}}')).toBeUndefined()
    expect(await server.handleLine('{"jsonrpc":"2.0","id":null,"method":"ping"}')).toBeUndefined()
  })

  it('ping', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":9,"method":"ping"}')
    expect(reply.id).toBe(9)
    expect(reply.result).toEqual({})
  })
})

describe('MCPServer · tools/list y tools/call', () => {
  it('mantiene el orden de registro y normaliza los esquemas', async () => {
    const tools = (await rpc(makeServer(), '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).result.tools
    expect(tools.map((t: Json) => t.name)).toEqual(['suma', 'eco', 'args', 'imagen', 'falla', 'marcada'])
    expect(tools[0].description).toBe('Suma dos números.')
    expect(tools[0].inputSchema.type).toBe('object')
    expect(tools[0].inputSchema.required).toHaveLength(2)
    expect(tools[2].inputSchema.type).toBe('object') // un esquema vacío sale como objeto válido
    expect(tools[2].inputSchema.properties).toBeDefined()
  })

  it('registrar con el mismo nombre sustituye sin duplicar', async () => {
    const server = makeServer()
    server.addTool({ name: 'suma', description: 'Nueva', inputSchema: { type: 'object', properties: {} } }, () => ({ text: 'nueva' }))
    const list = await rpc(server, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    expect(list.result.tools).toHaveLength(6)
    expect(list.result.tools[0].description).toBe('Nueva')
    expect((await rpc(server, '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"suma","arguments":{}}}')).result.content[0].text).toBe('nueva')
  })

  it('devuelve texto', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"suma","arguments":{"a":2,"b":3}}}')
    expect(reply.id).toBe(3)
    expect(reply.result.content[0]).toEqual({ type: 'text', text: '5' })
    expect(reply.result.isError).toBe(false)
  })

  it('devuelve imágenes', async () => {
    const content = (await rpc(makeServer(), '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"imagen"}}')).result.content
    expect(content).toHaveLength(2)
    expect(content[0].type).toBe('text')
    expect(content[1]).toEqual({ type: 'image', data: 'QUJD', mimeType: 'image/png' })
  })

  it('una herramienta que lanza es un resultado isError, no un error de protocolo', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"falla","arguments":{}}}')
    expect(reply.error).toBeUndefined()
    expect(reply.result.isError).toBe(true)
    expect(reply.result.content[0].text).toBe('Error: no se pudo')
  })

  it('un resultado marcado como error se propaga', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"marcada"}}')
    expect(reply.result.isError).toBe(true)
    expect(reply.result.content[0].text).toBe('mal')
  })

  it('herramienta desconocida = parámetros no válidos', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"no-existe"}}')
    expect(reply.error.code).toBe(-32602)
    expect(reply.error.message).toContain('no-existe')
    expect(reply.result).toBeUndefined()
  })

  it('sin nombre = parámetros no válidos', async () => {
    for (const json of ['{"jsonrpc":"2.0","id":1,"method":"tools/call"}', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}',
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":42}}', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":""}}']) {
      expect((await rpc(makeServer(), json)).error.code, json).toBe(-32602)
    }
  })

  it('los argumentos son un objeto, null o una cadena con un objeto', async () => {
    const server = makeServer()
    for (const bad of ['[1,2]', '42', 'true']) expect((await rpc(server, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"args","arguments":${bad}}}`)).error.code, bad).toBe(-32602)
    expect((await rpc(server, '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"args","arguments":null}}')).result.content[0].text).toBe('{}')
    expect((await rpc(server, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"args"}}')).result.content[0].text).toBe('{}')
    expect((await rpc(server, '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"args","arguments":"[1,2,3]"}}')).error.code).toBe(-32602)
  })

  it('los argumentos en una cadena con JSON mal escapado se reparan', async () => {
    const raw = '{"texto": "\\frac{1}{2} y \\theta", }' // barras de LaTeX sin duplicar y coma final
    const reply = await rpc(makeServer(), `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eco","arguments":${JSON.stringify(raw)}}}`)
    expect(reply.result.content[0].text).toBe('\\frac{1}{2} y \\theta')
  })

  it('LaTeX destrozado en argumentos objeto se repara (también anidado)', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eco","arguments":{"texto":"\\frac{1}{2} y \\theta"}}}')
    expect(reply.result.content[0].text).toBe('\\frac{1}{2} y \\theta')
    const nested = await rpc(makeServer(), '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"args","arguments":{"a":{"b":["\\frac{1}{2}", 3]}}}}')
    expect(nested.result.content[0].text).toContain('\\\\frac{1}{2}')
    expect(nested.result.content[0].text).toContain('3')
  })
})

describe('MCPServer · errores de protocolo y entrada hostil', () => {
  it('error de análisis con id nulo', async () => {
    for (const bad of ['{no es json', '{"jsonrpc":', 'esto no es json', '\u0000\u0001\u0002', "{'a':1}"]) {
      const reply = await rpc(makeServer(), bad)
      expect(reply.error.code, bad).toBe(-32700)
      expect(reply.id).toBeNull()
    }
  })

  it('peticiones no válidas', async () => {
    const server = makeServer()
    for (const json of ['[]', '42', '"texto"', 'true', '{}', '{"jsonrpc":"2.0","id":1}', '{"jsonrpc":"1.0","id":1,"method":"ping"}',
      '{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}', '{"jsonrpc":"2.0","id":true,"method":"ping"}', '{"jsonrpc":"2.0","id":1,"method":""}', '{"jsonrpc":"2.0","id":1,"method":5}']) {
      expect((await rpc(server, json)).error.code, json).toBe(-32600)
    }
  })

  it('método no encontrado', async () => {
    const reply = await rpc(makeServer(), '{"jsonrpc":"2.0","id":1,"method":"no/existe"}')
    expect(reply.error.code).toBe(-32601)
    expect(reply.id).toBe(1)
  })

  it('recursos y prompts vacíos', async () => {
    const server = makeServer()
    expect((await rpc(server, '{"jsonrpc":"2.0","id":1,"method":"resources/list"}')).result.resources).toEqual([])
    expect((await rpc(server, '{"jsonrpc":"2.0","id":2,"method":"resources/templates/list"}')).result.resourceTemplates).toEqual([])
    expect((await rpc(server, '{"jsonrpc":"2.0","id":3,"method":"prompts/list"}')).result.prompts).toEqual([])
    expect((await rpc(server, '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"x://y"}}')).error.code).toBe(-32602)
  })

  it('los ids se devuelven tal cual', async () => {
    const server = makeServer()
    expect((await rpc(server, '{"jsonrpc":"2.0","id":"abc-1","method":"ping"}')).id).toBe('abc-1')
    expect((await rpc(server, '{"jsonrpc":"2.0","id":9007199254740000,"method":"ping"}')).id).toBe(9_007_199_254_740_000)
    expect((await rpc(server, '{"jsonrpc":"2.0","id":0,"method":"ping"}')).id).toBe(0)
    expect((await rpc(server, '{"jsonrpc":"2.0","id":"ñandú-日本","method":"ping"}')).id).toBe('ñandú-日本')
  })

  it('las líneas en blanco se ignoran', async () => {
    const server = makeServer()
    for (const l of ['', '   ', '\t', '\r']) expect(await server.handleLine(l)).toBeUndefined()
    expect((await rpc(server, '   {"jsonrpc":"2.0","id":1,"method":"ping"}   \r')).id).toBe(1)
  })

  it('lotes de peticiones', async () => {
    const server = makeServer()
    const reply = JSON.parse(
      (await server.handleLine('[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"tools/list"},{"jsonrpc":"2.0","id":3,"method":"no/existe"}]')) ?? '[]'
    )
    expect(reply).toHaveLength(3)
    expect(reply.map((r: Json) => r.id)).toEqual([1, 2, 3])
    expect(reply[2].error.code).toBe(-32601)
    expect(await server.handleLine('[{"jsonrpc":"2.0","method":"notifications/initialized"}]')).toBeUndefined()
    expect((await rpc(server, '[]')).error.code).toBe(-32600)
  })

  it('las respuestas del cliente se ignoran', async () => {
    expect(await makeServer().handleLine('{"jsonrpc":"2.0","id":1,"result":{}}')).toBeUndefined()
  })

  it('la respuesta es una línea aunque el contenido tenga saltos', async () => {
    const reply = await makeServer().handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eco","arguments":{"texto":"línea 1\\nlínea 2\\r\\n\\u2028fin\\ttab"}}}')
    expect(reply).toBeDefined()
    expect(reply).not.toContain('\n')
    expect(reply).not.toContain('\r')
    expect(JSON.parse(reply!).result.content[0].text).toBe('línea 1\nlínea 2\r\n\u2028fin\ttab')
  })

  it('un argumento enorme va y vuelve', async () => {
    const big = 'x'.repeat(5_000_000)
    const reply = await makeServer().handleLine(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eco","arguments":{"texto":"${big}"}}}`)
    expect(JSON.parse(reply ?? '{}').result.content[0].text.length).toBe(5_000_000)
  })

  it('una entrada muy anidada no tumba nada', async () => {
    const server = makeServer()
    expect((await rpc(server, '['.repeat(200_000) + ']'.repeat(200_000))).error).toBeDefined()
    const deep = '{"a":'.repeat(50_000) + '1' + '}'.repeat(50_000)
    expect(await rpc(server, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"args","arguments":${deep}}}`)).toBeDefined()
  })

  it('UTF-8 no válido dentro de una línea no rompe nada', async () => {
    const bytes = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eco","arguments":{"texto":"ab'), Buffer.from([0xff, 0xfe]), Buffer.from('cd"}}}')])
    expect((await rpc(makeServer(), bytes.toString('utf8'))).result).toBeDefined()
  })

  it('las llamadas a la vez se contestan por separado y en paralelo', async () => {
    const server = new MCPServer({ name: 'c', version: '1' })
    server.addTool({ name: 'espera', description: '', inputSchema: { type: 'object', properties: { ms: { type: 'integer' } } } }, async (args) => {
      await new Promise((r) => setTimeout(r, Number(args.ms ?? 0)))
      return { text: `listo-${args.ms}` }
    })
    const started = Date.now()
    const replies = await Promise.all(
      Array.from({ length: 30 }, async (_, i) => JSON.parse((await server.handleLine(`{"jsonrpc":"2.0","id":${i},"method":"tools/call","params":{"name":"espera","arguments":{"ms":${200 + i}}}}`)) ?? '{}'))
    )
    replies.forEach((r, i) => {
      expect(r.id).toBe(i)
      expect(r.result.content[0].text).toBe(`listo-${200 + i}`)
    })
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('una cancelación que llega antes que la llamada: ni se ejecuta ni se responde', async () => {
    let ran = false
    const server = new MCPServer({ name: 's', version: '1' })
    server.addTool({ name: 'accion', description: '', inputSchema: {} }, () => {
      ran = true
      return { text: 'hecho' }
    })
    expect(await server.handleLine('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7,"reason":"timeout"}}')).toBeUndefined()
    expect(await server.handleLine('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"accion","arguments":{}}}')).toBeUndefined()
    expect(ran).toBe(false)
    expect(await server.handleLine('{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"accion","arguments":{}}}')).toBeDefined()
    expect(ran).toBe(true)
  })
})
