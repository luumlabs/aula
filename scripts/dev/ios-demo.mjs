// La demostración de la app de iPhone/iPad (para probarla sin un Mac, y para la revisión del App Store): graba, desde la
// app REAL con el curso de ejemplo, lo que el Mac le sirve a un dispositivo (la interfaz, sus archivos y las respuestas a
// cada llamada) durante un recorrido por las pantallas, y lo guarda en un solo archivo que la app de iOS lleva dentro y
// sirve ella misma (native/ios/Aula/DemoServer.swift).
//   npm run build && node scripts/dev/ios-demo.mjs [--lang en|es] [--out archivo] [--shots carpeta]
// Escribe native/ios/Aula/Demo.aulademo (git no lo guarda: se rehace antes de archivar la app). Formato:
//   «AULADEMO1\n» · longitud del índice (uint32 BE) · índice JSON · datos
//   índice: { day, files: { ruta: [desde, largo, tipo] }, csp, rpc: { cuerpo de la llamada: [desde, largo] },
//             fallback: { método: cuerpo }, events: { cuerpo: [{ after: ms, line }] } }
// `day` es el día de la grabación: la app desplaza las fechas de las respuestas a hoy, para que el ejemplo no envejezca.
//
// Las capturas y el vídeo del App Store usan otra grabación, que NUNCA entra en la app (el simulador la carga de
// Documents con «-AulaDemo», solo en depuración: native/ios/Aula/StoreShots.swift):
//   npm run build && node scripts/dev/ios-demo.mjs --preview --lang en|es [--out archivo] [--fake-ai] [--check-ai]
// Escribe docs/app-store/media/archives/Preview-<idioma>.aulademo (fuera de git). Cambia tres cosas:
//   - las vistas tienen el tamaño de los dispositivos de las capturas (iPad 13″ en horizontal e iPhone 18 Pro Max);
//   - la IA es la de verdad, la de la CLI de Claude Code con la sesión iniciada (nunca una clave): una sola llamada, la del
//     tutor (sin el cuestionario del chat). --fake-ai usa la simulada, para ensayar; --check-ai solo dice qué IA usaría;
//   - al final, lo que sale en el marketing (la lección del arco hasta su gráfica, el «27» en boli rojo, «Explicar mi
//     error» y la respuesta del tutor, una tarjeta girada y puntuada): cada llamada nueva queda como la última de su
//     método, que es lo que la demostración contesta en el simulador.
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const shots = option('--shots') ? resolve(option('--shots')) : null
const checkAI = args.includes('--check-ai')
const preview = args.includes('--preview') || checkAI
const realAI = preview && !args.includes('--fake-ai')
const lang = option('--lang') ?? 'en'
if (lang !== 'en' && lang !== 'es') throw new Error('--lang: en o es')
const OUT = resolve(option('--out') ?? (preview ? `docs/app-store/media/archives/Preview-${lang}.aulademo` : 'native/ios/Aula/Demo.aulademo'))
const ID = 'exam-2-math112'
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// iPad y teléfono: los de las capturas del App Store con --preview; si no, un iPad de 11″ y un iPhone normales
const VIEWS = preview ? { wide: { width: 1376, height: 1032 }, narrow: { width: 440, height: 956 } } : { wide: { width: 1180, height: 820 }, narrow: { width: 390, height: 844 } }

// Los avisos viajan con el código, también sin Mac ni conexión. Si falta el build de licencias, falla antes de grabar.
const legalFiles = ['LICENSE.md', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt'].map((name) => {
  const data = readFileSync(resolve(name === 'THIRD_PARTY_LICENSES.txt' ? `out/${name}` : name))
  if (!data.toString('utf8').trim()) throw new Error(`el aviso de licencia está vacío: ${name}`)
  return ['/' + name, { type: 'text/plain; charset=utf-8', data }]
})

// Las pestañas del curso: las de la interfaz reorganizada (Resumen, Aprender, Repasar, Simulacro, Materiales) si este
// código ya la tiene; los ids de antes se graban siempre (en la nueva siguen funcionando como alias)
const router = readFileSync(resolve('src/renderer/src/app/router.ts'), 'utf8')
const COURSE_TABS = [...(/\bCOURSE_VIEWS\b/.test(router) ? ['review'] : []), 'overview', 'learn', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference']
// los botones del marketing, con el texto de la interfaz en su idioma
const studyText = JSON.parse(readFileSync(resolve(`src/renderer/src/i18n/locales/${lang}/study.json`), 'utf8'))

// ── La app con el curso de ejemplo y seis semanas de estudio simuladas, en inglés (el de la revisión) o en --lang ──────
const home = mkdtempSync(join(tmpdir(), 'aula-ios-demo-'))
const settings = { version: 2, onboarded: true, general: { language: lang } }
// la IA de verdad: la CLI de Claude Code (su suscripción, con la sesión del dueño), nunca una clave
if (realAI) settings.ai = { activeProvider: 'claude-cli' }
writeFileSync(join(home, 'settings.json'), JSON.stringify(settings))
cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
// sin claves ni puertas de otra sesión en el entorno: la CLI usa la sesión que tiene iniciada
const env = realAI ? Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI)_|API_KEY|AUTH_TOKEN/i.test(k))) : process.env
const app = await electron.launch({
  args: [resolve('.'), '--no-sandbox'],
  env: { ...env, AULA_HOME: home, AULA_SEED: 'demo', AULA_DEMO: '1', AULA_FAKE_AI: realAI ? '' : '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1' }
})
const main = await app.firstWindow()
await main.waitForLoadState('domcontentloaded')
await main.waitForTimeout(2500)
const call = (m, a) => main.evaluate(async ([m, a]) => { const r = await window.aula.invoke(m, a); if (!r.ok) throw new Error(`${m}: ${r.error.message}`); return r.value }, [m, a])
if (preview) {
  const ai = await call('ai.status', {})
  log(`IA: ${ai.resolved ? `${ai.resolved.label} (${ai.resolved.kind})` : 'ninguna'}${ai.ready ? '' : ` · no está lista: ${ai.problem?.message ?? '?'}`}`)
  if (realAI && !(ai.ready && ai.resolved?.kind === 'claude-cli')) {
    await app.close()
    throw new Error('la grabación del marketing necesita la CLI de Claude Code con la sesión iniciada (o --fake-ai para ensayar)')
  }
  if (checkAI) {
    await app.close()
    process.exit(0)
  }
  const hour = new Date().getHours() + new Date().getMinutes() / 60
  if (realAI && (hour < 8 || hour > 11.5)) log('aviso: la hora de la respuesta del tutor queda grabada; para el marketing se graba de 8:00 a 11:30')
}
const status = await call('remote.setEnabled', { enabled: true })
const base = status.localURL
if (!base) throw new Error('el acceso desde dispositivos no arrancó')
const code = (await call('remote.startPairing')).pairing.code

// ── El «dispositivo»: otra ventana, sin el puente de Electron, que habla con el servidor como un iPad ─────────────────
const opening = app.waitForEvent('window')
await app.evaluate(async ({ BrowserWindow }, [url, size]) => {
  const w = new BrowserWindow({ ...size, show: false, webPreferences: { partition: 'aula-demo-device' } })
  await w.loadURL(url)
}, [base + '/pair', VIEWS.wide])
const page = await opening
await page.waitForLoadState('domcontentloaded')
await page.setViewportSize(VIEWS.wide)
const paired = await page.evaluate(async (code) => (await fetch('/pair/complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'Demo', platform: 'ipad' }) })).json(), code)
if (!paired.ok) throw new Error('no se pudo vincular el dispositivo de la grabación')

// ── Lo que se graba ───────────────────────────────────────────────────────────────────────────────────────────────────
const files = new Map(legalFiles) // ruta → { type, data }
const rpc = new Map() // cuerpo → respuesta (texto)
const fallback = {} // método → último cuerpo
const events = {} // cuerpo → [{ after, line }]
let csp = ''
let lastSend = null // el último chat.send: { body, at }
const pending = []
// Las llamadas del marketing (--preview): cada una se queda con su PRIMERA respuesta, y las que ya estaban no cambian.
// Así el progreso, Hoy y las conversaciones se graban como antes de tocar nada (en el simulador se vuelve a hacer lo
// mismo desde ahí) y lo nuevo (el intento, la tarjeta, la pregunta al tutor) queda como lo último de su método.
let firstWins = false
const keepFirst = new WeakSet()

page.on('request', (req) => {
  if (new URL(req.url()).pathname !== '/rpc') return
  if (firstWins) keepFirst.add(req)
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
        const first = keepFirst.has(req)
        if (first && rpc.has(body)) return
        const text = await res.text()
        if (first && rpc.has(body)) return
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
  for (const tab of COURSE_TABS) await go(course(tab), 1800)
  await snap(`${tag}-course`)
  await go(study('learn', { skill: 'reference-angles' }), 3000)
  await snap(`${tag}-learn`)
  // el tutor de la lección (sin grabarlo, abrirlo en la demostración daba «esto no está en la demostración»)
  await page.locator('[data-tutor-button]').first().click({ timeout: 4000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  await page.locator('[data-tutor-button]').first().click({ timeout: 4000 }).catch(() => undefined)
  await page.waitForTimeout(500)
  await go(study('practice'), 2500)
  await go(study('cards'), 2500)
  await snap(`${tag}-cards`)
  await go(study('plan'), 2200)
  // «Empezar el plan» (Hoy) entra directo en el primer paso (`start`, interfaz reorganizada; la de antes lo ignora)
  await go(study('plan', { start: true }), 2500)
  await go(study('mistakes'), 2200)
  // el simulacro no se graba: en la demostración (?demo=1 en un dispositivo) lo arma y lo corrige la interfaz con el motor y
  // el progreso vive en memoria (study/data.ts), así que la grabación tampoco deja un intento suyo en el historial
  await go(study('exam'), 2200)
  for (const view of ['agenda', 'week', 'month']) await go({ name: 'calendar', view }, 1800)
  await snap(`${tag}-calendar`)
  await go({ name: 'stats' }, 2500)
  await go({ name: 'tools' }, 1800)
  for (const tool of ['formulas', 'calculator', 'grapher', 'periodic', 'units', 'timer']) await go({ name: 'tools', tool }, 1500)
  await go({ name: 'documents' }, 2000)
  // y uno abierto en el lector (si no, en la demostración ninguno se podía abrir)
  await page.locator('[class*="group/doc"]').first().click({ timeout: 4000 }).catch(() => undefined)
  await page.waitForTimeout(3000)
  await go({ name: 'inbox' }, 2500)
  await snap(`${tag}-inbox`)
  // abrir una novedad la marca como leída: también eso, para que en la demostración se abra sin aviso de error
  await page.locator('[class*="group/entry"] > button[aria-expanded]').first().click({ timeout: 4000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  await go({ name: 'create' }, 2000)
  // los ajustes de un dispositivo (lo de uso diario): que la demostración también los enseñe
  await go({ name: 'settings' }, 2500)
  // el chat: un cuestionario rápido con la IA simulada (lo que Aula contesta en la demostración). En la del marketing
  // no: la única llamada a la IA es la del tutor
  await go({ name: 'chat' }, 2500)
  const box = page.locator('textarea').first()
  // una sola vez (en la primera vuelta): si no, la conversación de ejemplo repetía la misma pregunta y su respuesta. En la
  // del marketing, ninguna
  if (!preview && tag === 'wide' && (await box.count())) {
    await box.fill('Give me a quick quiz')
    await box.press('Enter')
    // el aviso de la IA de terceros (en la demostración, el suyo): se continúa, como haría quien la prueba
    await page.locator('[data-ai-consent="accept"]').click({ timeout: 4000 }).catch(() => undefined)
    await page.waitForSelector('[data-studyset="quiz"]', { timeout: 30000 }).catch(() => undefined)
    await page.waitForTimeout(3000)
    await snap(`${tag}-chat`)
  }
  await go({ name: 'home' }, 2500)
  // los eventos de «Esta semana» (en Hoy) abren su hoja pidiendo el evento entero: también eso, para que en la demostración
  // no digan «Ya no está»
  await page.evaluate(async () => {
    const summary = await window.aula.invoke('home.summary')
    for (const e of summary.value?.upcoming ?? []) await window.aula.invoke('calendar.get', { id: e.id })
  })
  // las conversaciones, ya contestadas: la interfaz no las vuelve a pedir (las tiene en memoria), así que se piden aquí
  // para que lo que quede grabado sea su estado final y no «pensando»
  await page.evaluate(async () => {
    const list = await window.aula.invoke('chat.threads')
    for (const t of list.value ?? []) await window.aula.invoke('chat.thread', { id: t.id })
  })
  await page.waitForTimeout(800)
}

// ── Lo que sale en el vídeo y las capturas del App Store (solo --preview) ─────────────────────────────────────────────
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const button = (name, exact = false) => page.getByRole('button', { name: exact ? name : new RegExp('^' + escape(name)), exact }).filter({ visible: true }).first()
const visible = (locator) => locator.isVisible().catch(() => false)
const tutorState = () => page.evaluate(() => {
  const answers = [...document.querySelectorAll('[data-role="assistant"]')]
  return { answers: answers.length, streaming: document.querySelectorAll('[data-streaming="true"]').length, text: answers.at(-1)?.innerText ?? '' }
})

async function marketing() {
  // la lección del arco: desde su primera página hasta la gráfica del sector (contestando la predicción) y una más
  await go(study('learn', { skill: 'arc-length-sector-area' }), 3000)
  const prev = button(studyText.learn.prev)
  for (let i = 0; i < 12 && (await visible(prev)) && (await prev.isEnabled()); i++) {
    await prev.click()
    await page.waitForTimeout(700)
  }
  const plot = page.getByText('A sector with central angle').filter({ visible: true }).first()
  let predicted = false
  for (let i = 0; i < 12 && !(await visible(plot)); i++) {
    const doubles = page.getByText('doubles', { exact: true }).filter({ visible: true }).first()
    if (!predicted && await visible(doubles)) {
      await doubles.click()
      predicted = true
      await page.waitForTimeout(1500)
      continue
    }
    const next = button(studyText.learn.continue, true)
    if (!(await visible(next))) break
    await next.click()
    await page.waitForTimeout(1500)
  }
  if (await visible(plot)) {
    await page.waitForTimeout(2500)
    await snap('preview-lesson')
    log(`  la lección llega a la gráfica${predicted ? ' (con la predicción contestada)' : ''}`)
    const next = button(studyText.learn.continue, true)
    if (await visible(next)) { await next.click(); await page.waitForTimeout(1500) }
  } else {
    log('  aviso: la lección del arco no llegó a la gráfica «A sector with central angle θ»')
  }

  // la práctica: el ejercicio del arco (π/3 en radio 9) con «27», el boli rojo, «Explicar mi error» y la respuesta
  // el orden de la práctica sale del segundo en que se abre: se vuelve a abrir hasta que empieza por als-e1 (primero la
  // mezclada, la de la toma; si no, la del tema del arco, con menos ejercicios)
  const arc = page.getByText('Find the length of the arc cut off').filter({ visible: true }).first()
  const tries = [...Array(4).fill(study('practice')), ...Array(16).fill(study('practice', { skill: 'arc-length-sector-area' }))]
  let opened = -1
  for (const [i, route] of tries.entries()) {
    if (i) await go({ name: 'home' }, 1100)
    await go(route, 2600)
    if (await visible(arc)) { opened = i; break }
  }
  if (opened < 0) throw new Error('la práctica no empezó por el ejercicio als-e1 (arco de π/3 en radio 9)')
  log(`  la práctica ${tries[opened].skill ? 'del tema del arco' : 'mezclada'} empieza por als-e1 (intento ${opened + 1}: el orden cambia con el segundo en que se abre)`)
  const input = page.locator('main input:visible').first()
  await input.click()
  await page.keyboard.type('27', { delay: 120 })
  await page.waitForTimeout(600)
  await button(studyText.ex.check).click()
  const explain = button(studyText.ex.explainMine)
  await explain.waitFor({ timeout: 10000 })
  await page.waitForTimeout(1500)
  await snap('preview-red-pen')
  await explain.click()
  // hasta que la respuesta está entera y quieta (la IA de verdad tarda: hasta dos minutos)
  const until = Date.now() + 120000
  let last = ''
  let still = 0
  for (;;) {
    await page.waitForTimeout(1000)
    const s = await tutorState()
    still = s.answers > 0 && !s.streaming && s.text === last && s.text.trim() ? still + 1 : 0
    last = s.text
    if (still >= 3) break
    if (Date.now() > until) throw new Error('el tutor no terminó de contestar en dos minutos')
  }
  await page.waitForTimeout(2000)
  await snap('preview-tutor')
  log('  el tutor contestó')

  // las tarjetas: girar la primera y puntuarla «Bien»
  await go(study('cards'), 3000)
  const angular = await visible(page.getByText('Angular speed', { exact: true }).filter({ visible: true }).first())
  if (!angular) log('  aviso: la primera tarjeta no es «Angular speed»')
  await page.waitForTimeout(1500)
  await button(studyText.cards.flip).click()
  const good = button(studyText.cards.rating.good)
  await good.waitFor({ timeout: 10000 })
  await page.waitForTimeout(1600)
  await snap('preview-cards')
  await good.click()
  await page.waitForTimeout(1500)

  // el Resumen del curso, el chat vacío y vuelta a Hoy
  await go(course('overview'), 2500)
  await go({ name: 'chat' }, 2500)
  await go({ name: 'home' }, 2500)
}

// lo que aún se está leyendo de las respuestas (con tope: una respuesta que no acaba de llegar no para la grabación)
const settle = () => Promise.race([Promise.allSettled(pending), sleep(30000)])

await tour('wide')
await page.setViewportSize(VIEWS.narrow)
await tour('narrow')
if (preview) {
  await settle()
  firstWins = true
  log('· lo del marketing')
  await marketing()
}
await settle()
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
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.concat([Buffer.from('AULADEMO1\n', 'utf8'), length, head, ...chunks]))
const methods = [...new Set([...rpc.keys()].map((b) => { try { return JSON.parse(b).method } catch { return '?' } }))].sort()
log(`✓ ${OUT}`)
log(`  ${files.size} archivos · ${rpc.size} llamadas (${methods.length} métodos) · ${Object.keys(events).length} con eventos · ${((head.length + offset) / 1048576).toFixed(1)} MB · día ${index.day} · ${lang}`)
log('  métodos: ' + methods.join(', '))
if (preview) reviewTutor()

/** La respuesta del tutor tal como la verá el simulador, y lo que hay que mirar antes de usarla en el marketing. */
function reviewTutor() {
  const json = (text) => { try { return JSON.parse(text) } catch { return null } }
  const sent = fallback['chat.send']
  const lines = (sent && events[sent]) || []
  const reply = lines.map((e) => json(e.line)?.payload?.message).filter((m) => m?.role === 'assistant').at(-1)
  if (!reply?.text) {
    log('  ✗ no se grabó la respuesta del tutor')
    process.exitCode = 1
    return
  }
  // el hilo del tutor se graba vacío: si trajera ya la pregunta, el simulador la enseñaría dos veces
  const thread = json(rpc.get(fallback['chat.tutorThread']) ?? '')?.value
  const opened = thread?.id ? json(rpc.get(JSON.stringify({ method: 'chat.thread', args: { id: thread.id } })) ?? '')?.value : null
  const before = Math.max(thread?.messages?.length ?? 0, opened?.messages?.length ?? 0)
  if (before) log(`  aviso: el hilo del tutor ya traía ${before} mensajes al abrirlo`)
  const textLines = reply.text.trim().split('\n').filter((l) => l.trim())
  const words = [...reply.text.matchAll(/\b(demo|demostración|claude|anthropic|chatgpt|openai|codex|gpt)\b/gi)].map((m) => m[0])
  log(`  la respuesta del tutor (${textLines.length} líneas, ${lines.length} eventos, la última a los ${lines.at(-1)?.after ?? 0} ms):`)
  for (const l of textLines) log('    │ ' + l)
  if (words.length) log(`  ✗ dice ${[...new Set(words)].join(', ')}: no vale para el marketing`)
  if (textLines.length < 4 || textLines.length > 8) log('  aviso: para el marketing, de 4 a 8 líneas')
  log('  revísala: correcta (s = rθ, 3π) y sin dar la solución entera')
}
