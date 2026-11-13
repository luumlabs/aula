// El puente de la interfaz cuando Aula se usa desde un dispositivo (iPad, iPhone o un navegador), no desde su ventana del
// Mac: define `window.aula` con las mismas tres cosas que el preload (invocar, escuchar, plataforma), pero hablando por
// HTTP con el servidor remoto. Se sirve como `/remote-bridge.js` y se carga antes que la app. JavaScript simple, sin
// módulos ni dependencias, para que funcione en cualquier WebView.
import { settingsPath } from '@shared/settings/sections'

export const REMOTE_BRIDGE_JS = String.raw`(function () {
  'use strict'
  if (window.aula) return
  var listeners = {}
  // sin HTTPS (la red privada ya cifra) el navegador esconde algunas funciones: se suplen las que usa la app
  function hex(bytes) { var a = new Uint8Array(bytes); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return (b + 256).toString(16).slice(1) }).join('') }
  if (!crypto.randomUUID) crypto.randomUUID = function () { var h = hex(16); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20) }
  if (!navigator.clipboard) {
    try {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: function (text) {
        return new Promise(function (resolve, reject) {
          var ta = document.createElement('textarea')
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
          document.body.appendChild(ta); ta.select()
          var ok = false
          try { ok = document.execCommand('copy') } catch (err) { /* sin permiso */ }
          document.body.removeChild(ta)
          if (ok) resolve(); else reject(new Error('copy'))
        })
      } } })
    } catch (err) { /* el navegador no deja definirlo */ }
  }
  // archivos elegidos en el dispositivo: se suben al Mac y la app recibe una dirección que el servidor entiende
  var uploads = []
  function upload(file) {
    var id = hex(16)
    var p = fetch('/upload/' + id, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-aula-filename': encodeURIComponent(file.name || 'archivo') }, body: file })
      .catch(function () { /* la llamada que lo use dirá que no pudo abrirlo */ })
      .then(function () { uploads = uploads.filter(function (x) { return x !== p }) })
    uploads.push(p)
    return 'aula-upload://' + id + '/' + (file.name || 'archivo')
  }
  var wide = Math.min(window.screen.width, window.screen.height) >= 700
  var android = /Android/.test(navigator.userAgent)
  // lo pone el servidor en la página: este dispositivo es propietario (hace de ventana de Aula como servidor) y si Aula es
  // un servidor (sin Mac)
  function meta(name) {
    try { var m = document.querySelector('meta[name="' + name + '"]'); return m ? m.getAttribute('content') : null } catch (err) { return null }
  }
  var owner = meta('aula-device') === 'owner'
  var server = meta('aula-host') === 'server'
  // los avisos del puente, en el idioma de la interfaz (lo pone en <html lang> al elegirlo; como ella: lo que no es español
  // va en inglés)
  function say(es, en) {
    var lang = ''
    try { lang = (document.documentElement && document.documentElement.lang) || navigator.language || '' } catch (err) { /* sin documento */ }
    return String(lang).toLowerCase().indexOf('es') === 0 ? es : en
  }
  function deliver(event, payload) {
    var set = listeners[event]
    if (!set) return
    set.slice().forEach(function (fn) { try { fn(payload) } catch (err) { console.error('[aula] listener ' + event, err) } })
  }
  function gone() {
    // la ficha ya no vale (se retiró el dispositivo o caducó): volver a emparejar
    if (location.pathname !== '/pair') location.replace('/pair')
  }
  // eventos: una respuesta que no termina, con un evento JSON por línea (se reconecta sola)
  var retry = 500
  function listen() {
    fetch('/events', { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      if (res.status === 401) { gone(); return }
      if (!res.ok || !res.body) throw new Error('events ' + res.status)
      retry = 500
      var reader = res.body.getReader()
      var decoder = new TextDecoder()
      var pending = ''
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) throw new Error('events closed')
          pending += decoder.decode(chunk.value, { stream: true })
          var lines = pending.split('\n')
          pending = lines.pop() || ''
          lines.forEach(function (line) {
            if (!line.trim()) return
            try { var m = JSON.parse(line); if (m && typeof m.event === 'string') deliver(m.event, m.payload) } catch (err) { /* línea a medias */ }
          })
          return pump()
        })
      }
      return pump()
    }).catch(function () {
      setTimeout(listen, retry)
      retry = Math.min(retry * 2, 15000)
      // al volver la conexión puede haberse perdido algo: que cada pantalla vuelva a pedir sus datos
      deliver('remote.reconnected', {})
    })
  }
  window.aula = {
    platform: android ? 'android' : wide ? 'ipados' : 'ios',
    remote: true,
    owner: owner,
    server: server,
    appStore: false,
    invoke: function (method, args) {
      // un enlace se abre en el propio dispositivo (en el servidor no hay quien lo vea)
      if (method === 'app.openExternal') {
        var target = args && typeof args.url === 'string' ? args.url : ''
        if (/^https?:\/\//i.test(target)) window.open(target, '_blank', 'noopener')
        return Promise.resolve({ ok: true, value: null })
      }
      var body = JSON.stringify({ method: method, args: args === undefined ? null : args })
      // si la llamada nombra un archivo que aún se está subiendo, espera a que llegue
      var ready = uploads.length && body.indexOf('aula-upload://') >= 0 ? Promise.all(uploads.slice()) : Promise.resolve()
      return ready.then(function () { return fetch('/rpc', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body }) })
        .then(function (res) {
          if (res.status === 401) { gone(); return { ok: false, error: { message: say('Este dispositivo ya no está vinculado.', 'This device is no longer linked.'), code: 'forbidden' } } }
          return res.json()
        })
        .catch(function () { return { ok: false, error: { message: server ? say('No se pudo conectar con tu servidor de Aula.', 'Could not reach your Aula server.') : say('No se pudo conectar con Aula en tu Mac.', 'Could not reach Aula on your Mac.'), code: 'offline' } } })
    },
    on: function (event, fn) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(fn)
      return function () { listeners[event] = (listeners[event] || []).filter(function (x) { return x !== fn }) }
    },
    pathForFile: function (file) { return file ? upload(file) : '' }
  }
  listen()
})()
`

/** Para «Añadir a la pantalla de inicio»: Aula se abre a pantalla completa, como una app. */
export const REMOTE_MANIFEST = JSON.stringify({
  name: 'Aula', short_name: 'Aula', start_url: '/', scope: '/', display: 'standalone', background_color: '#fcfaf5', theme_color: '#fcfaf5',
  icons: [{ src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
})

/** Lo que dice la página de vincular cuando Aula es un servidor (no hay Mac): dónde se consigue el código. */
const SERVER_PAIRING = {
  en: { lead: 'Type the code your Aula server shows when it starts (or run “aula-server link” on the server for a new one). Once you have a device, its owner can also give codes in Settings.', expired: 'That code expired. Run “aula-server link” on the server for a new one.', tooMany: 'Too many attempts. Run “aula-server link” on the server for a new code.', noCode: 'Aula is not waiting for a device. Run “aula-server link” on the server.', full: 'There are too many linked devices. An owner can remove one in Settings.', offline: 'Could not reach your Aula server.' },
  es: { lead: 'Escribe el código que enseña tu servidor de Aula al arrancar (o pídele otro con «aula-server link» en el servidor). Cuando ya tengas un dispositivo, su propietario también da códigos en Ajustes.', expired: 'Ese código caducó. Pide otro con «aula-server link» en el servidor.', tooMany: 'Demasiados intentos. Pide un código nuevo con «aula-server link» en el servidor.', noCode: 'Aula no está esperando a ningún dispositivo. Pide un código con «aula-server link» en el servidor.', full: 'Hay demasiados dispositivos vinculados. Un propietario puede quitar alguno en Ajustes.', offline: 'No se pudo conectar con tu servidor de Aula.' }
} as const

/** Página mínima para vincular un dispositivo: pide el código que enseña Aula en el Mac (o el servidor). Sin dependencias. */
export function pairingPage(lang: 'es' | 'en', nonce: string, host: 'mac' | 'server' = 'mac'): string {
  const base = lang === 'en'
    ? { title: 'Link this device to Aula', lead: `On your Mac, open Aula → ${settingsPath('devices', 'en')} and choose “Link”. Type the code it shows.`, name: 'Name of this device', code: 'Code', go: 'Link', wrong: 'That code is not right.', expired: 'That code expired. Ask for a new one on your Mac.', tooMany: 'Too many attempts. Ask for a new code on your Mac.', noCode: 'Aula is not waiting for a device. Choose “Link” on your Mac.', full: 'There are too many linked devices. Remove one on your Mac.', offline: 'Could not reach Aula on your Mac.' }
    : { title: 'Vincula este dispositivo con Aula', lead: `En tu Mac, abre Aula → ${settingsPath('devices', 'es')} y elige «Vincular». Escribe el código que te enseña.`, name: 'Nombre de este dispositivo', code: 'Código', go: 'Vincular', wrong: 'Ese código no es correcto.', expired: 'Ese código caducó. Pide uno nuevo en tu Mac.', tooMany: 'Demasiados intentos. Pide un código nuevo en tu Mac.', noCode: 'Aula no está esperando a ningún dispositivo. Elige «Vincular» en tu Mac.', full: 'Hay demasiados dispositivos vinculados. Quita alguno en tu Mac.', offline: 'No se pudo conectar con Aula en tu Mac.' }
  const t = host === 'server' ? { ...base, ...SERVER_PAIRING[lang] } : base
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Aula</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--paper:#fcfaf5;--ink:#2a2520;--soft:#77716a;--line:rgba(42,37,32,.16);--brick:#b4502f;--on:#fff;--field:#fff}
@media (prefers-color-scheme:dark){:root{--paper:#181613;--ink:#efe6dc;--soft:#b3aca3;--line:rgba(239,230,220,.2);--brick:#ee9f72;--on:#2b160b;--field:#221f1b}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:17px/1.45 -apple-system,system-ui,sans-serif;padding:24px}
main{width:100%;max-width:400px}h1{font:500 30px/1.15 "New York",ui-serif,Georgia,serif;margin:0 0 10px}p{color:var(--soft);margin:0 0 22px}
label{display:block;font-size:14px;font-weight:600;color:var(--soft);margin:14px 0 6px}
input{width:100%;height:48px;border-radius:14px;border:1px solid var(--line);background:var(--field);color:var(--ink);font:inherit;padding:0 14px}
input#code{font:500 28px/1 ui-monospace,Menlo,monospace;letter-spacing:.3em;text-align:center}
button{margin-top:22px;width:100%;height:50px;border:0;border-radius:14px;background:var(--brick);color:var(--on);font:600 17px/1 -apple-system,system-ui,sans-serif}button:disabled{opacity:.5}
#err{color:var(--brick);min-height:24px;margin-top:14px;font-size:15px}
</style></head><body><main>
<h1>${t.title}</h1><p>${t.lead}</p>
<form id="f"><label for="name">${t.name}</label><input id="name" autocomplete="off" maxlength="60">
<label for="code">${t.code}</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
<button id="go">${t.go}</button><div id="err" role="alert"></div></form>
</main><script nonce="${nonce}">
(function(){var T=${JSON.stringify({ wrong: t.wrong, expired: t.expired, tooMany: t.tooMany, noCode: t.noCode, full: t.full, offline: t.offline })}
var wide=Math.min(screen.width,screen.height)>=700,ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
var android=/Android/.test(navigator.userAgent)
var platform=ios?(wide?'ipad':'iphone'):android?'android':'web'
document.getElementById('name').value=platform==='ipad'?'iPad':platform==='iphone'?'iPhone':platform==='android'?'Android':${JSON.stringify(lang === 'en' ? 'Browser' : 'Navegador')}
document.getElementById('f').addEventListener('submit',function(e){e.preventDefault()
var go=document.getElementById('go'),err=document.getElementById('err');go.disabled=true;err.textContent=''
fetch('/pair/complete',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value,name:document.getElementById('name').value,platform:platform})})
.then(function(r){return r.json()}).then(function(r){if(r.ok){location.replace('/')}else{err.textContent=T[r.error]||T.wrong;go.disabled=false}})
.catch(function(){err.textContent=T.offline;go.disabled=false})})})()
</script></body></html>`
}
