// La demostración de la app de iPhone/iPad (para probarla sin un Mac, y para la revisión del App Store): graba, desde la
// app REAL con el curso de ejemplo, lo que el Mac le sirve a un dispositivo (la interfaz, sus archivos y las respuestas a
// cada llamada) durante un recorrido por las pantallas, y lo guarda en un solo archivo que la app de iOS lleva dentro y
// sirve ella misma (native/ios/Aula/DemoServer.swift).
//   npm run build && node scripts/dev/ios-demo.mjs [--shots carpeta]
// Escribe native/ios/Aula/Demo.aulademo (git no lo guarda: se rehace antes de archivar la app). Formato:
//   «AULADEMO1\n» · longitud del índice (uint32 BE) · índice JSON · datos
//   índice: { day, files: { ruta: [desde, largo, tipo] }, csp, rpc: { cuerpo de la llamada: [desde, largo] },
//             fallback: { método: cuerpo }, events: { cuerpo: [{ after: ms, line }] } }
// `day` es el día de la grabación: la app desplaza las fechas de las respuestas a hoy, para que el ejemplo no envejezca.
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const shots = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null
const OUT = resolve('native/ios/Aula/Demo.aulademo')
const ID = 'exam-2-math112'
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── La app con el curso de ejemplo y seis semanas de estudio simuladas, en inglés (el idioma de la revisión) ───────────
const home = mkdtempSync(join(tmpdir(), 'aula-ios-demo-'))
writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en' } }))
cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
const app = await electron.launch({
  args: [resolve('.'), '--no-sandbox'],
  env: { ...process.env, AULA_HOME: home, AULA_SEED: 'demo', AULA_DEMO: '1', AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1' }
})
const main = await app.firstWindow()
await main.waitForLoadState('domcontentloaded')
await main.waitForTimeout(2500)
const call = (m, a) => main.evaluate(async ([m, a]) => { const r = await window.aula.invoke(m, a); if (!r.ok) throw new Error(`${m}: ${r.error.message}`); return r.value }, [m, a])
const status = await call('remote.setEnabled', { enabled: true })
const base = status.localURL
if (!base) throw new Error('el acceso desde dispositivos no arrancó')
const code = (await call('remote.startPairing')).pairing.code

// ── El «dispositivo»: otra ventana, sin el puente de Electron, que habla con el servidor como un iPad ─────────────────
const opening = app.waitForEvent('window')
await app.evaluate(async ({ BrowserWindow }, url) => {
  const w = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { partition: 'aula-demo-device' } })
  await w.loadURL(url)
}, base + '/pair')
const page = await opening
await page.waitForLoadState('domcontentloaded')
const paired = await page.evaluate(async (code) => (await fetch('/pair/complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'Demo', platform: 'ipad' }) })).json(), code)
if (!paired.ok) throw new Error('no se pudo vincular el dispositivo de la grabación')

// ── Lo que se graba ───────────────────────────────────────────────────────────────────────────────────────────────────
const files = new Map() // ruta → { type, data }
const rpc = new Map() // cuerpo → respuesta (texto)
const fallback = {} // método → último cuerpo
const events = {} // cuerpo → [{ after, line }]
let csp = ''
let lastSend = null // el último chat.send: { body, at }
const pending = []

page.on('request', (req) => {
  if (new URL(req.url()).pathname !== '/rpc') return
  const body = req.postData() ?? ''
  try { if (JSON.parse(body).method === 'chat.send') lastSend = { body, at: Date.now() } } catch { /* cuerpo raro */ }
})

page.on('response', (res) => {
  const req = res.request()
  const url = new URL(req.url())
  if (url.origin !== base) return
  pending.push((async () => {
    try {
      if (url.pathname === '/rpc' && req.method() === 'POST') {
        const body = req.postData() ?? ''
        const text = await res.text()
        rpc.set(body, text)
        let method = ''
        try { method = JSON.parse(body).method } catch { /* cuerpo raro */ }
        if (method) fallback[method] = body
        return
      }
      if (req.method() !== 'GET' || url.pathname === '/events' || res.status() !== 200) return
      const type = res.headers()['content-type'] ?? 'application/octet-stream'
      if (url.pathname === '/') csp = res.headers()['content-security-policy'] ?? csp
      files.set(url.pathname, { type, data: await res.body() })
    } catch { /* respuesta sin cuerpo (cancelada al cambiar de pantalla) */ }
  })())
})

// los eventos que el Mac manda al dispositivo mientras Aula contesta: quedan apuntados al mensaje que los provocó
const stream = http.get(base + '/events', { headers: { authorization: `Bearer ${paired.token}` } }, (res) => {
  let buffer = ''
  res.setEncoding('utf8')
  res.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim() || !lastSend) continue
      let name = ''
      try { name = JSON.parse(line).event } catch { continue }
      // solo la respuesta de Aula en el chat; lo de fondo no se repite
      if (!/^chat\./.test(name)) continue
      ;(events[lastSend.body] ??= []).push({ after: Math.min(Date.now() - lastSend.at, 8000), line })
    }
  })
})
stream.on('error', () => { /* se cierra al acabar */ })

// ── El recorrido ──────────────────────────────────────────────────────────────────────────────────────────────────────
const go = async (route, wait = 2200) => {
  await page.evaluate((r) => window.__aula?.navigate?.(r), route)
  await page.waitForTimeout(wait)
}
const snap = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${name}.png`) }) } }
const course = (tab) => ({ name: 'course', id: ID, tab })
const study = (mode, extra = {}) => ({ name: 'study', id: ID, mode, ...extra })

async function tour(tag) {
  await page.goto(base + '/?demo=1')
  await page.waitForSelector('nav, [role="tablist"], main', { timeout: 20000 }).catch(() => undefined)
  await page.waitForTimeout(3500)
  await snap(`${tag}-home`)
  for (const tab of ['overview', 'learn', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference']) await go(course(tab), 1800)
  await snap(`${tag}-course`)
  await go(study('learn', { skill: 'reference-angles' }), 3000)
  await snap(`${tag}-learn`)
  await go(study('practice'), 2500)
  await go(study('cards'), 2500)
  await snap(`${tag}-cards`)
  await go(study('plan'), 2200)
  await go(study('mistakes'), 2200)
  await go(study('exam'), 2200)
  for (const view of ['agenda', 'week', 'month']) await go({ name: 'calendar', view }, 1800)
  await snap(`${tag}-calendar`)
  await go({ name: 'stats' }, 2500)
  await go({ name: 'tools' }, 1800)
  for (const tool of ['formulas', 'calculator', 'grapher', 'periodic', 'units', 'timer']) await go({ name: 'tools', tool }, 1500)
  await go({ name: 'documents' }, 2000)
  await go({ name: 'inbox' }, 2500)
  await snap(`${tag}-inbox`)
  await go({ name: 'create' }, 2000)
  // los ajustes de un dispositivo (lo de uso diario): que la demostración también los enseñe
  await go({ name: 'settings' }, 2500)
  // el chat: un cuestionario rápido con la IA simulada (lo que Aula contesta en la demostración)
  await go({ name: 'chat' }, 2500)
  const box = page.locator('textarea').first()
  if (await box.count()) {
    await box.fill('Give me a quick quiz')
    await box.press('Enter')
    await page.waitForSelector('[data-studyset="quiz"]', { timeout: 30000 }).catch(() => undefined)
    await page.waitForTimeout(3000)
    await snap(`${tag}-chat`)
  }
  await go({ name: 'home' }, 2500)
  // las conversaciones, ya contestadas: la interfaz no las vuelve a pedir (las tiene en memoria), así que se piden aquí
  // para que lo que quede grabado sea su estado final y no «pensando»
  await page.evaluate(async () => {
    const list = await window.aula.invoke('chat.threads')
    for (const t of list.value ?? []) await window.aula.invoke('chat.thread', { id: t.id })
  })
  await page.waitForTimeout(800)
}

await tour('wide')
await page.setViewportSize({ width: 390, height: 844 })
await tour('narrow')
await Promise.allSettled(pending)
await sleep(500)
stream.destroy()

// los archivos de la interfaz que el recorrido no llegó a pedir (pantallas que se cargan al entrar): todos van dentro
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', json: 'application/json; charset=utf-8', wasm: 'application/wasm', html: 'text/html; charset=utf-8', mjs: 'text/javascript; charset=utf-8', map: 'application/json' }
const assets = resolve('out/renderer/assets')
for (const name of readdirSync(assets)) {
  const path = '/assets/' + name
  // las fuentes van en woff2 (lo que entiende cualquier iPhone); las copias en formatos viejos no hacen falta
  if (files.has(path) || /\.(ttf|woff|map)$/.test(name)) continue
  files.set(path, { type: TYPES[name.split('.').pop()] ?? 'application/octet-stream', data: readFileSync(join(assets, name)) })
}
if (!files.has('/')) throw new Error('no se grabó la página de la interfaz')
await app.close()

// ── El archivo ────────────────────────────────────────────────────────────────────────────────────────────────────────
const chunks = []
let offset = 0
const put = (data) => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'); chunks.push(b); const at = offset; offset += b.length; return [at, b.length] }
const now = new Date()
const index = {
  day: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  csp,
  files: Object.fromEntries([...files].map(([path, f]) => [path, [...put(f.data), f.type]])),
  rpc: Object.fromEntries([...rpc].map(([body, text]) => [body, put(text)])),
  fallback,
  events
}
const head = Buffer.from(JSON.stringify(index), 'utf8')
const length = Buffer.alloc(4)
length.writeUInt32BE(head.length)
writeFileSync(OUT, Buffer.concat([Buffer.from('AULADEMO1\n', 'utf8'), length, head, ...chunks]))
const methods = [...new Set([...rpc.keys()].map((b) => { try { return JSON.parse(b).method } catch { return '?' } }))].sort()
log(`✓ ${OUT}`)
log(`  ${files.size} archivos · ${rpc.size} llamadas (${methods.length} métodos) · ${Object.keys(events).length} con eventos · ${((head.length + offset) / 1048576).toFixed(1)} MB · día ${index.day}`)
log('  métodos: ' + methods.join(', '))
