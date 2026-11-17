// A6 (App Store, sin acceso web sin restricciones): con un dispositivo manejando el navegador en vivo del Mac, los marcos
// de dentro de su plataforma cargan lo suyo (un recurso incrustado), pero un marco ajeno no salta a otro sitio: ni por una
// redirección (Electron da ahí el marco «especulativo», aún vacío) ni por un enlace dentro de un documento en blanco o
// srcdoc que escribe ese marco. El srcdoc de la propia plataforma sí sigue. Todo local y falso, en *.localhost.
import { test, expect, type Page } from 'playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launch } from './helpers'

type Envelope = { ok: boolean; value?: unknown; error?: { code: string; message: string } }
type LiveState = { id: string; url: string; refused?: { host: string } }

/** Un enlace que se pulsa solo dentro del documento (el que lo pide es ese mismo marco). */
const autoClick = (href: string): string => `<a id="a" href="${href}">x</a><script>setTimeout(() => document.getElementById('a').click(), 300)</script>`

/** La plataforma (moodle.localhost), un sitio ajeno que incrusta (external.localhost) y adonde no debe llegar (evil-*). */
async function startSites(): Promise<{ origin: (host: string) => string; hosts: string[]; close(): Promise<void> }> {
  const hosts: string[] = []
  let port = 0
  const origin = (host: string): string => `http://${host}:${port}`
  const html = (body: string): string => `<!doctype html><meta charset="utf-8"><body style="margin:0">${body}</body>`
  const server: Server = createServer((req, res) => {
    const host = String(req.headers.host ?? '').split(':')[0]
    const path = req.url ?? '/'
    hosts.push(host)
    const send = (body: string): void => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html(body)) }
    if (host === 'moodle.localhost') {
      if (path === '/own-srcdoc') return send(`<iframe style="width:100%;height:400px" srcdoc="${autoClick(origin('inner-ok.localhost') + '/').replace(/"/g, '&quot;')}"></iframe>`)
      const mode = path.slice(1)
      if (['redirect', 'spec', 'blank', 'srcdoc'].includes(mode)) return send(`<iframe style="width:100%;height:600px" src="${origin('external.localhost')}/${mode}"></iframe>`)
      return send('<h1>Campus</h1>')
    }
    if (host === 'external.localhost') {
      // se va sola dentro de su sitio, y de ahí la redirige el servidor a otro
      if (path === '/redirect') return send(`<p>externo</p><script>setTimeout(() => { location.href = '/hop' }, 300)</script>`)
      if (path === '/hop') { res.writeHead(302, { Location: origin('evil-redirect.localhost') + '/' }); res.end(); return }
      // va a otro sitio por un paso permitido (un «SSO»), que la redirige fuera: ahí el marco del salto aún no tiene nada
      if (path === '/spec') return send(`<p>externo</p><script>setTimeout(() => { location.href = '${origin('sso.localhost')}/login' }, 300)</script>`)
      // un marco en blanco que escribe con document.write, con un enlace dentro
      if (path === '/blank') return send(`<iframe id="w" style="width:100%;height:300px"></iframe><script>const d = document.getElementById('w').contentDocument; d.open(); d.write(${JSON.stringify(autoClick(origin('evil-blank.localhost') + '/')).replace(/<\//g, '<\\/')}); d.close()</script>`)
      if (path === '/srcdoc') return send(`<iframe style="width:100%;height:300px" srcdoc="${autoClick(origin('evil-srcdoc.localhost') + '/').replace(/"/g, '&quot;')}"></iframe>`)
      return send('<p>externo</p>')
    }
    if (host === 'sso.localhost') { res.writeHead(302, { Location: origin('evil-spec.localhost') + '/' }); res.end(); return }
    send(`<h1>${host}</h1>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as AddressInfo).port
  return { origin, hosts, close: () => new Promise<void>((r) => server.close(() => r())) }
}

test('dispositivo: un marco ajeno no salta a otro sitio (redirección, documento en blanco, srcdoc); la plataforma sí', async () => {
  test.setTimeout(180_000)
  const sites = await startSites()
  const { app, page: mac } = await launch()
  try {
    const call = async (p: Page, method: string, args?: unknown): Promise<unknown> => {
      const r = (await p.evaluate(([m, a]) => (globalThis as unknown as { aula: { invoke(m: unknown, a: unknown): Promise<unknown> } }).aula.invoke(m, a), [method, args] as const)) as Envelope
      if (!r.ok) throw new Error(`${method}: ${r.error?.message}`)
      return r.value
    }
    const account = (await call(mac, 'platforms.add', { url: sites.origin('moodle.localhost') + '/', kind: 'moodle' })) as { id: string }

    // el «dispositivo»: otra ventana sin el puente de Electron, vinculada como un iPhone
    const base = ((await call(mac, 'remote.setEnabled', { enabled: true })) as { localURL: string }).localURL
    const code = ((await call(mac, 'remote.startPairing')) as { pairing: { code: string } }).pairing.code
    const opening = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { partition: 'aula-e2e-device-live' } })
      await w.loadURL(url)
    }, base + '/pair')
    const device = await opening
    await device.waitForLoadState('domcontentloaded')
    const paired = (await device.evaluate(async (c) => (await fetch('/pair/complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c, name: 'iPhone', platform: 'iphone' }) })).json(), code)) as { ok: boolean }
    expect(paired.ok).toBe(true)
    await device.goto(base + '/')
    await device.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula, null, { timeout: 20_000 })

    /** El dispositivo abre una página de su plataforma y se espera a que su marco cargue lo que tiene que cargar. */
    const openOnDevice = async (path: string, framed: string): Promise<string> => {
      const s = (await call(device, 'live.open', { accountId: account.id, url: sites.origin('moodle.localhost') + path })) as LiveState
      await expect.poll(() => sites.hosts.includes(framed), { timeout: 20_000 }).toBe(true)
      return s.id
    }
    const refusedHost = async (id: string): Promise<string | undefined> => ((await call(mac, 'live.state', { id })) as LiveState | null)?.refused?.host

    // un marco ajeno que se redirige a otro sitio: se corta (y no llega ni la petición)
    let id = await openOnDevice('/redirect', 'external.localhost')
    await expect.poll(() => refusedHost(id), { timeout: 20_000 }).toBe('evil-redirect.localhost')
    // ni pasando antes por otro sitio permitido (el marco del salto, «especulativo», aún no tiene nada cargado)
    id = await openOnDevice('/spec', 'sso.localhost')
    await expect.poll(() => refusedHost(id), { timeout: 20_000 }).toBe('evil-spec.localhost')
    // un enlace dentro de un documento en blanco que escribe el marco ajeno: tampoco
    id = await openOnDevice('/blank', 'external.localhost')
    await expect.poll(() => refusedHost(id), { timeout: 20_000 }).toBe('evil-blank.localhost')
    // ni dentro de un srcdoc suyo
    id = await openOnDevice('/srcdoc', 'external.localhost')
    await expect.poll(() => refusedHost(id), { timeout: 20_000 }).toBe('evil-srcdoc.localhost')
    // el srcdoc de la propia plataforma sí sigue
    id = await openOnDevice('/own-srcdoc', 'inner-ok.localhost')
    expect(await refusedHost(id)).toBeUndefined()

    await mac.waitForTimeout(800)
    expect(sites.hosts.filter((h) => h.startsWith('evil-'))).toEqual([])
  } finally {
    await app.close()
    await sites.close()
  }
})
