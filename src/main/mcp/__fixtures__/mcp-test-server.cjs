#!/usr/bin/env node
// Servidor MCP mínimo para las pruebas (port del de Python de `Tests/AgentKitTests/Fixtures/PythonServers.swift`).
// stdio, un mensaje JSON por línea; registro solo por stderr.
// Herramientas: suma(a,b), eco(texto), fallo(), imagen(), lento(segundos), args(...).
// MODE: normal | noisy | slow-init | die-on-call | die-once | fail-start | rpc-error | paged | stubborn
// PIDFILE: si existe, el servidor escribe ahí su pid. MARKER: archivo que usa el modo die-once.
'use strict'
const fs = require('node:fs')
const readline = require('node:readline')

const MODE = process.env.MODE || 'normal'
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TOOLS = [
  { name: 'suma', description: 'Suma dos numeros y devuelve el resultado.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'eco', description: 'Devuelve el texto recibido.', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'fallo', description: 'Siempre falla (para probar isError).', inputSchema: { type: 'object', properties: {} } },
  { name: 'imagen', description: 'Devuelve una imagen PNG de 1x1 pixel.', inputSchema: { type: 'object', properties: {} } },
  { name: 'lento', description: 'Espera unos segundos y responde.', inputSchema: { type: 'object', properties: { segundos: { type: 'number' } }, required: ['segundos'] } },
  { name: 'args', description: 'Devuelve los argumentos recibidos como JSON.', inputSchema: { type: 'object', properties: {} } }
]

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

async function callTool(name, args) {
  switch (name) {
    case 'suma':
      // el sello permite comprobar que el agente llamó de verdad a la herramienta
      return { content: [{ type: 'text', text: `${args.a + args.b} [sello:KX-4417]` }], isError: false }
    case 'eco':
      return { content: [{ type: 'text', text: String(args.texto ?? '') }], isError: false }
    case 'fallo':
      return { content: [{ type: 'text', text: 'Fallo a proposito' }], isError: true }
    case 'imagen':
      return { content: [{ type: 'text', text: 'una imagen' }, { type: 'image', data: PNG_1X1, mimeType: 'image/png' }], isError: false }
    case 'lento':
      await new Promise((r) => setTimeout(r, Number(args.segundos ?? 1) * 1000))
      return { content: [{ type: 'text', text: 'listo' }], isError: false }
    case 'args':
      return { content: [{ type: 'text', text: JSON.stringify(sortKeys(args)) }], isError: false }
    default:
      return undefined
  }
}

async function handle(msg) {
  const { method, id } = msg
  if (method === 'initialize') {
    if (MODE === 'slow-init') await new Promise((r) => setTimeout(r, 30_000))
    const version = (msg.params || {}).protocolVersion || '2025-06-18'
    send({ jsonrpc: '2.0', id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aula-test-server', version: '0.0.1' }, instructions: 'Servidor de pruebas' } })
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
  } else if (method === 'tools/list') {
    const cursor = (msg.params || {}).cursor
    if (MODE === 'paged') send({ jsonrpc: '2.0', id, result: cursor === undefined ? { tools: TOOLS.slice(0, 2), nextCursor: 'pagina-2' } : { tools: TOOLS.slice(2) } })
    else send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  } else if (method === 'tools/call') {
    if (MODE === 'die-once' && !fs.existsSync(process.env.MARKER || '/nonexistent')) {
      fs.writeFileSync(process.env.MARKER, '1')
      process.stderr.write('boom: el servidor se cae\n', () => process.exit(3))
      return
    }
    if (MODE === 'die-on-call') {
      process.stderr.write('boom: el servidor se cae\n', () => process.exit(3))
      return
    }
    if (MODE === 'rpc-error') return send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'fallo interno del servidor' } })
    const params = msg.params || {}
    const result = await callTool(params.name, params.arguments || {})
    send(result === undefined ? { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } } : { jsonrpc: '2.0', id, result })
  } else if (method === 'resources/list' || method === 'prompts/list') {
    send({ jsonrpc: '2.0', id, result: { [method.startsWith('res') ? 'resources' : 'prompts']: [] } })
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
  // las notificaciones (sin id) se ignoran
}

if (process.env.PIDFILE) fs.writeFileSync(process.env.PIDFILE, String(process.pid))
if (MODE === 'fail-start') {
  process.stderr.write('No se pudo arrancar: falta una dependencia\n', () => process.exit(1))
} else {
  if (MODE === 'stubborn') {
    process.on('SIGTERM', () => undefined) // ignora SIGTERM y el EOF: solo SIGKILL lo detiene
    setInterval(() => undefined, 1000)
  }
  if (MODE === 'noisy') process.stdout.write('Servidor listo (esto no es JSON)\n\n{no es json\n')
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (raw) => {
    const line = raw.trim()
    if (!line) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    handle(msg).catch((err) => process.stderr.write(String(err) + '\n'))
  })
}
