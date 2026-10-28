// `llama-server` falso para las pruebas del motor (port del guion de Python de `EngineTests.swift`): anota sus argumentos y
// sirve /health, /v1/models y /props en el puerto pedido, SOLO con la clave del archivo `--api-key-file`.
'use strict'
const fs = require('node:fs')
const http = require('node:http')
const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
if (process.env.FAKE_LLAMA_ARGS) fs.writeFileSync(process.env.FAKE_LLAMA_ARGS, JSON.stringify(args))
if (process.env.FAKE_LLAMA_FAIL) {
  process.stderr.write('error: unknown argument: --boom\n', () => process.exit(1))
} else if (process.env.FAKE_LLAMA_CACHE_FAIL && opt('--cache-type-k') === 'q8_0') {
  process.stderr.write('E main: unsupported cache type q8_0 for this model\n', () => process.exit(1))
} else {
  const key = fs.readFileSync(opt('--api-key-file'), 'utf8').split('\n')[0]
  const alias = opt('--alias')
  const delay = Number(process.env.FAKE_LLAMA_LOAD_MS || 0)
  const started = Date.now()
  http
    .createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer ' + key) {
        res.writeHead(401)
        return res.end()
      }
      if (Date.now() - started < delay) {
        res.writeHead(503) // cargando el modelo
        return res.end('{"error":{"message":"Loading model"}}')
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        // respuesta en streaming (SSE) con la forma de la API compatible con OpenAI
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          const request = JSON.parse(raw || '{}')
          if (process.env.FAKE_LLAMA_REQUESTS) fs.appendFileSync(process.env.FAKE_LLAMA_REQUESTS, JSON.stringify(request) + '\n')
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n')
          send({ id: 'c1', object: 'chat.completion.chunk', model: alias, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hola ' } }] })
          send({ id: 'c1', object: 'chat.completion.chunk', model: alias, choices: [{ index: 0, delta: { content: 'desde ' + request.model } }] })
          send({ id: 'c1', object: 'chat.completion.chunk', model: alias, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })
          res.end('data: [DONE]\n\n')
        })
        return
      }
      const body = { '/health': { status: 'ok' }, '/v1/models': { data: [{ id: alias, owned_by: 'llamacpp' }] }, '/props': { default_generation_settings: { n_ctx: Number(opt('--ctx-size')) }, build_info: 'b9999-fake', chat_template_caps: { supports_tool_calls: true } } }[req.url]
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
      res.end(body ? JSON.stringify(body) : '')
    })
    .listen(Number(opt('--port')), '127.0.0.1')
}
