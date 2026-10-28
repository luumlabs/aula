// Comprobación de las protecciones de la ventana principal, con datos de prueba en una carpeta temporal (AULA_HOME):
//   node scripts/dev/security-check.mjs                     la app de desarrollo (tras `npm run build`)
//   node scripts/dev/security-check.mjs <ejecutable>        una app empaquetada (p. ej. …/Aula.app/Contents/MacOS/Aula):
//                                                            se conecta por CDP (los fusibles no dejan --inspect). Una app
//                                                            de release RECHAZA --remote-debugging-port (sale con 1): se
//                                                            comprueba eso y, para lo demás, hace falta una compilación de
//                                                            auditoría (AULA_AUDIT_BUILD=1 npm run build + electron-builder --dir)
// Comprueba: la interfaz va por app://aula; la ventana no navega fuera; fetch/XHR a file:// fallan (J3-2) y no se lee
// secrets.enc; nada externo por fetch; aula-asset no sale del curso; permisos (cámara, micrófono, ubicación, leer el
// portapapeles) denegados; el puente no llega a un iframe; RPC hostil rechazado; la clave no sale por RPC.
// Nunca abre el navegador del sistema: en desarrollo se anula shell.openExternal y con la app empaquetada no se prueba
// ninguna dirección web. Sale con código 1 si algo falla.
import { _electron as electron, chromium } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const exe = process.argv[2]
const home = mkdtempSync(join(tmpdir(), 'aula-sec-'))
writeFileSync(join(home, 'secrets.enc'), 'AULA-PLN1:{"ai.key.openai":"sk-FAKE-SECCHECK"}')
mkdirSync(join(home, 'Packs', 'curso', 'assets'), { recursive: true })
writeFileSync(join(home, 'Packs', 'curso', 'assets', 'ok.txt'), 'ASSET-OK')
writeFileSync(join(home, 'canary.txt'), 'CANARY')
const env = { ...process.env, AULA_HOME: home, AULA_SKIP_ONBOARDING: '1', AULA_NO_UPDATES: '1', AULA_HIDDEN: '1' }

let bad = 0
const check = (name, ok, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

let close
let win
let opened = []
if (exe) {
  const port = 9300 + Math.floor(Math.random() * 500)
  // --use-mock-keychain: nunca el llavero de verdad (en macOS la app de prueba pediría el «Aula Safe Storage» del dueño)
  const child = spawn(exe, [`--remote-debugging-port=${port}`, '--use-mock-keychain'], { env, stdio: 'ignore' })
  let exitCode = null
  child.on('exit', (code) => { exitCode = code })
  close = async () => { child.kill('SIGTERM') }
  let browser
  for (let i = 0; i < 60 && !browser && exitCode === null; i++) {
    await new Promise((r) => setTimeout(r, 500))
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined)
  }
  if (!browser && exitCode !== null) {
    // la app de release no abre CDP (src/main/electron/debug-guard.ts): es lo que tiene que pasar
    check('la app empaquetada rechaza --remote-debugging-port (sale sin abrir CDP)', exitCode === 1, `código ${exitCode}`)
    console.log('  (para comprobar el resto, una compilación de auditoría: AULA_AUDIT_BUILD=1 npm run build && npx electron-builder --dir)')
    process.exit(bad ? 1 : 0)
  }
  if (!browser) throw new Error('No se pudo conectar con la app empaquetada')
  console.log('! compilación de auditoría: acepta --remote-debugging-port (nunca publicar así)')
  for (let i = 0; i < 60 && !win; i++) {
    win = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://aula/index.html'))
    if (!win) await new Promise((r) => setTimeout(r, 500))
  }
  if (!win) throw new Error('No aparece la ventana de la app (app://aula/index.html)')
} else {
  const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env })
  // nunca el navegador del dueño: se apuntan las llamadas en vez de abrirlas
  await app.evaluate(({ shell }) => {
    globalThis.__opened = []
    shell.openExternal = async (url) => { globalThis.__opened.push(url) }
  })
  close = () => app.close()
  win = await app.firstWindow()
  opened = { get: () => app.evaluate(() => globalThis.__opened) }
}
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2000)

// 1. protocolo propio
const href = await win.evaluate(() => location.href)
check('la interfaz va por app://aula', href.startsWith('app://aula/'), href)

// 2. navegación fuera de la app
const before = href
const targets = ['file:///etc/hosts', 'file:///', '//evil.example/x.html', 'aula-asset://pack/curso/ok.txt', ...(exe ? [] : ['https://example.com/'])]
for (const target of targets) {
  await win.evaluate((t) => { location.href = t }, target).catch(() => {})
  await win.waitForTimeout(400)
  const now = await win.evaluate(() => location.href).catch(() => '?')
  check(`no navega a ${target}`, now === before, now === before ? '' : now)
}
if (!exe) {
  const list = await opened.get()
  check('una web se abre fuera (sin tocar el navegador real: anulado)', list.includes('https://example.com/'), JSON.stringify(list))
}

// 3. lectura de archivos y red
const r = await win.evaluate(async (home) => {
  const f = async (u) => { try { const x = await fetch(u); return `${x.status} ${(await x.text()).slice(0, 40)}` } catch (e) { return 'ERR ' + String(e).slice(0, 40) } }
  const xhr = (u) => new Promise((res) => { try { const x = new XMLHttpRequest(); x.open('GET', u); x.onload = () => res('LOADED ' + x.responseText.slice(0, 30)); x.onerror = () => res('ERR'); x.send() } catch (e) { res('ERR ' + e) } })
  const asset = async (u) => { try { const x = await fetch(u); return x.status } catch { return 'ERR' } }
  return {
    etcHosts: await f('file:///etc/hosts'),
    secrets: await f('file://' + home + '/secrets.enc'),
    xhr: await xhr('file:///etc/hosts'),
    external: await f('https://example.com/'),
    assetOk: await f('aula-asset://pack/curso/ok.txt'),
    assetEscape: [await asset('aula-asset://pack/curso/..%2F..%2Fcanary.txt'), await asset('aula-asset://pack/..%2F/canary.txt'), await asset('aula-asset://pack/curso/%2e%2e/%2e%2e/canary.txt')],
    appEscape: [await asset('app://aula/..%2F..%2F..%2Fetc%2Fhosts'), await asset('app://aula/%2e%2e/%2e%2e/package.json')]
  }
}, home)
check('fetch(file:///etc/hosts) falla', r.etcHosts.startsWith('ERR'), r.etcHosts)
check('fetch(file://…/secrets.enc) falla', r.secrets.startsWith('ERR'), r.secrets)
check('XMLHttpRequest a file:// falla', r.xhr.startsWith('ERR'), r.xhr)
check('fetch a una web externa falla (CSP)', r.external.startsWith('ERR'), r.external)
check('aula-asset sirve el curso', r.assetOk.startsWith('200 ASSET-OK'), r.assetOk)
check('aula-asset no sale del curso', r.assetEscape.every((s) => s === 404 || s === 'ERR'), JSON.stringify(r.assetEscape))
check('app:// no sale de la interfaz', r.appEscape.every((s) => s === 404 || s === 'ERR'), JSON.stringify(r.appEscape))

// 4. permisos
const perms = await win.evaluate(async () => {
  const out = {}
  for (const name of ['geolocation', 'camera', 'microphone', 'clipboard-read']) {
    try { out[name] = (await navigator.permissions.query({ name })).state } catch (e) { out[name] = 'ERR' }
  }
  try { await navigator.mediaDevices.getUserMedia({ audio: true }); out.getUserMedia = 'granted' } catch { out.getUserMedia = 'denied' }
  return out
})
for (const p of ['geolocation', 'camera', 'microphone', 'clipboard-read']) check(`permiso ${p} denegado`, perms[p] !== 'granted', perms[p])
check('micrófono (getUserMedia) denegado', perms.getUserMedia === 'denied')

// 5. puente y RPC
const rpc = await win.evaluate(async () => {
  // cada llamada con plazo: una que no contesta se apunta (y no cuelga la comprobación)
  const inv = (m, a) => Promise.race([window.aula.invoke(m, a), new Promise((r) => setTimeout(() => r({ ok: 'timeout', method: m }), 8000))])
  const info = await inv('app.info')
  const unknown = await inv('nada.raro')
  const proto = await inv('__proto__')
  const ext = await inv('app.openExternal', { url: 'file:///etc/passwd' })
  const leaks = []
  for (const m of ['settings.get', 'ai.providers', 'ai.status', 'app.info', 'secrets.status']) leaks.push(JSON.stringify(await inv(m)).includes('sk-FAKE-SECCHECK'))
  const iframe = await new Promise((res) => { const f = document.createElement('iframe'); f.srcdoc = '<p>x</p>'; f.onload = () => res(typeof f.contentWindow.aula); document.body.appendChild(f); setTimeout(() => res('sin cargar (CSP frame-src)'), 4000) })
  return { info: info.ok, unknown: unknown.ok, proto: proto.ok, ext: ext.ok, leaks, iframe }
})
check('RPC desde la app', rpc.info === true)
check('método desconocido rechazado', rpc.unknown === false)
check('__proto__ rechazado', rpc.proto === false)
check('openExternal(file:) rechazado', rpc.ext === false)
check('la clave no sale por RPC', !rpc.leaks.some(Boolean), JSON.stringify(rpc.leaks))
check('el puente no llega a un iframe', rpc.iframe !== 'object', rpc.iframe)

await close()
console.log(bad ? `\n${bad} comprobación(es) fallida(s).` : '\nTodo en orden.')
process.exit(bad ? 1 : 0)
