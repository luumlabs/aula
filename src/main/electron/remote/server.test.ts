// El servidor remoto de punta a punta (HTTP de verdad en 127.0.0.1): quién entra, qué puede pedir y qué recibe.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { request } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() }
}))

const KEY = 'k'.repeat(64)
let base = ''
let url = ''
let cookie = ''
let token = ''
let server: import('./server').RemoteServer
let devices: import('@main/services/remote/devices').DeviceRegistry
let seen: { method: string; args: unknown; device?: string }[] = []

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> => fetch(url + path, { headers, redirect: 'manual' })
/** Lee un flujo de eventos hasta que aparece `word`. */
const until = async (r: ReadableStreamDefaultReader<Uint8Array>, word: string): Promise<string> => {
  let text = ''
  while (!text.includes(word)) text += new TextDecoder().decode((await r.read()).value)
  return text
}
/** Lee un flujo de eventos hasta que el servidor lo cierra (si no lo cierra, la prueba se queda esperando y falla). */
const drain = async (r: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  let text = ''
  for (;;) {
    const { done, value } = await r.read()
    if (done) return text
    text += new TextDecoder().decode(value)
  }
}
const rpc = async (method: string, args?: unknown, headers: Record<string, string> = { cookie }): Promise<{ ok: boolean; value?: unknown; error?: { code: string } }> =>
  (await fetch(url + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ method, args }) })).json() as never

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'aula-remote-srv-'))
  const { setDataRoot } = await import('@main/services/paths')
  setDataRoot(join(base, 'Aula'))
  mkdirSync(join(base, 'Aula', 'Packs', 'curso', 'assets'), { recursive: true })
  writeFileSync(join(base, 'Aula', 'Packs', 'curso', 'assets', 'fig.png'), '0123456789')
  writeFileSync(join(base, 'Aula', 'settings.json'), '{"secreto":true}')
  const renderer = join(base, 'renderer')
  mkdirSync(join(renderer, 'assets'), { recursive: true })
  writeFileSync(join(renderer, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><title>Aula</title></head><body><div id="root"></div></body></html>')
  writeFileSync(join(renderer, 'assets', 'app.js'), 'console.log(1)')

  const { handle } = await import('../rpc')
  const note = (method: string) => (args: unknown, ctx: { remote?: { deviceId: string } }) => { seen.push({ method, args, device: ctx.remote?.deviceId }); return { src: 'aula-asset://pack/curso/assets/fig.png' } }
  for (const m of ['courses.list', 'create.addFiles', 'settings.update', 'ai.setKey', 'ai.configure', 'ai.choose', 'ai.choices', 'memory.add', 'memory.forget', 'memory.clear', 'memory.export', 'data.deleteAll', 'data.exportAll']) handle(m as never, note(m) as never)

  const { DeviceRegistry } = await import('@main/services/remote/devices')
  const { UploadStore } = await import('@main/services/remote/uploads')
  const { userFiles } = await import('@main/services/userFiles')
  const { RemoteServer } = await import('./server')
  devices = new DeviceRegistry(join(base, 'devices.json'))
  server = new RemoteServer({ devices, uploads: new UploadStore(join(base, 'uploads'), { grant: (p) => userFiles.grant(p) }), rendererRoot: renderer, language: () => 'es', version: '9.9.9', proxyKey: KEY })
  url = `http://127.0.0.1:${await server.start()}`
})
afterAll(async () => { await server.stop() })

describe('servidor remoto', () => {
  it('solo responde a este ordenador o al proceso de Tailscale (con su clave)', async () => {
    // (fetch no deja cambiar la cabecera Host: con node:http)
    const status = (headers: Record<string, string>): Promise<number> => new Promise((resolve, reject) => {
      request(url + '/health', { headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0) }).on('error', reject).end()
    })
    expect(await status({ host: 'evil.example' })).toBe(421) // otra página que apunta su nombre a 127.0.0.1
    expect(await status({ host: 'aula-mac', 'x-aula-proxy-key': 'otra' })).toBe(421)
    expect(await status({ host: 'aula-mac', 'x-aula-proxy-key': KEY })).toBe(200)
    expect(await status({})).toBe(200)
  })
  it('demuestra al proceso de Tailscale que es Aula firmando su reto', async () => {
    const challenge = 'r'.repeat(32)
    const body = await (await get(`/health?challenge=${challenge}`)).json() as { app: string; version: string; proof?: { proxy: string } }
    expect(body).toMatchObject({ app: 'aula', version: '9.9.9' })
    expect(body.proof?.proxy).toBe(createHmac('sha256', KEY).update('aula-health:v1:' + challenge).digest('base64url'))
    expect((await (await get('/health?challenge=corto')).json() as { proof?: unknown }).proof).toBeUndefined()
  })
  it('sin vincular: la interfaz manda a /pair y no hay RPC, eventos, recursos ni subidas', async () => {
    const page = await get('/')
    expect([page.status, page.headers.get('location')]).toEqual([302, '/pair'])
    expect((await get('/pair')).headers.get('content-security-policy')).toContain("default-src 'none'")
    expect((await fetch(url + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"method":"courses.list"}' })).status).toBe(401)
    expect((await get('/events')).status).toBe(401)
    expect((await get('/asset/pack/curso/assets/fig.png')).status).toBe(401)
    expect((await fetch(url + `/upload/${'a'.repeat(32)}`, { method: 'PUT', headers: { 'x-aula-filename': 'a.txt' }, body: 'x' })).status).toBe(401)
    // los archivos de la interfaz (sin datos) sí: la página de vincular no los necesita, la app sí
    expect((await get('/assets/app.js')).status).toBe(200)
  })
  it('vincular: código equivocado no; el bueno deja una cookie HttpOnly y una ficha', async () => {
    const pair = (code: string, type = 'application/json'): Promise<Response> => fetch(url + '/pair/complete', { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify({ code, name: 'iPad de prueba', platform: 'ipad' }) })
    expect((await pair('000000')).status).toBe(403) // nadie pidió un código
    const { code } = devices.startPairing()
    expect((await pair(code, 'text/plain')).status).toBe(415) // un formulario de otra página no puede
    const res = await pair(code)
    const body = await res.json() as { ok: boolean; token: string; device: { name: string } }
    expect(body).toMatchObject({ ok: true, device: { name: 'iPad de prueba' } })
    const set = res.headers.get('set-cookie') ?? ''
    expect(set).toMatch(/^aula_device=.+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/)
    cookie = set.split(';')[0]
    token = body.token
  })
  it('vinculado: recibe la interfaz con el puente delante y la política del servidor', async () => {
    const page = await get('/', { cookie })
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toMatch(/<head><meta name="viewport"[^>]+viewport-fit=cover">.*<script src="\/remote-bridge\.js"><\/script>/)
    expect(html).not.toContain('http-equiv')
    const csp = page.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).not.toContain('aula-asset')
    expect(await (await get('/remote-bridge.js')).text()).toContain('window.aula')
  })
  it('RPC: lo permitido llega (con el dispositivo y las direcciones reescritas); lo demás se niega sin llegar', async () => {
    seen = []
    expect(await rpc('courses.list')).toEqual({ ok: true, value: { src: '/asset/pack/curso/assets/fig.png' } })
    expect(seen[0]).toMatchObject({ method: 'courses.list' })
    expect(seen[0].device).toMatch(/^[0-9a-f]{12}$/)
    // también con la ficha en Authorization (la app nativa)
    expect((await rpc('courses.list', undefined, { authorization: `Bearer ${token}` })).ok).toBe(true)
    expect((await rpc('ai.setKey', { providerId: 'x', key: 'y' })).error?.code).toBe('forbidden')
    expect((await rpc('settings.update', { persistent: { enabled: true } })).ok).toBe(true)
    expect(await rpc('app.setTheme', { theme: 'dark' })).toEqual({ ok: true, value: null })
    expect((await rpc('course.inventado')).error?.code).toBe('unknown_method')
    expect(seen.map((s) => s.method)).toEqual(['courses.list', 'courses.list', 'settings.update'])
  })
  it('Ajustes desde el dispositivo: lo de uso diario llega tal cual; lo del Mac se niega sin llegar', async () => {
    seen = []
    const denied = async (method: string, args?: unknown): Promise<void> => expect((await rpc(method, args)).error?.code, `${method} ${JSON.stringify(args)}`).toBe('forbidden')
    // el idioma, el tema y las horas de silencio: sí
    expect((await rpc('settings.update', { general: { language: 'en', theme: 'dark' } })).ok).toBe(true)
    expect((await rpc('settings.update', { persistent: { quietHours: { from: '23:00', to: '07:00' } } })).ok).toBe(true)
    // un campo del Mac anula el cambio entero, aunque venga con uno bueno
    await denied('settings.update', { general: { theme: 'light' }, data: { memory: false } })
    await denied('settings.update', { ai: { providers: [{ id: 'custom', baseURL: 'https://malo.example/v1' }] } })
    await denied('settings.update', { ai: { dailyBudgetUSD: 0 } })
    await denied('settings.update', { platforms: { keepSignedIn: false } })
    await denied('settings.update', { persistent: { enabled: true, openAtLogin: true } })
    await denied('settings.update', { general: { cursor: 'system' } })
    await denied('settings.update', { general: { textScale: 3 } })
    await denied('settings.update')
    // la IA: elegir entre las listas, sí; configurar, dar una dirección o una clave, no
    expect((await rpc('ai.choices')).ok).toBe(true)
    expect((await rpc('ai.choose', { providerId: 'deepseek', model: 'deepseek-v4-pro' })).ok).toBe(true)
    await denied('ai.choose', { providerId: 'custom', baseURL: 'https://malo.example/v1', key: 'sk-1234567890abcdef' })
    await denied('ai.configure', { providerId: 'deepseek' })
    await denied('ai.setKey', { providerId: 'openai', key: 'sk-1234567890abcdef' })
    // la memoria: añadir y olvidar uno, sí; varios de golpe, borrarla entera o exportarla, no
    expect((await rpc('memory.add', { text: 'Me cuesta la trigonometría' })).ok).toBe(true)
    expect((await rpc('memory.forget', { ids: ['m1'] })).ok).toBe(true)
    await denied('memory.forget', { ids: ['m1', 'm2'] })
    await denied('memory.clear')
    await denied('memory.export')
    // los datos
    await denied('data.deleteAll')
    await denied('data.exportAll')
    expect(seen.map((s) => [s.method, s.args])).toEqual([
      ['settings.update', { general: { language: 'en', theme: 'dark' } }],
      ['settings.update', { persistent: { quietHours: { from: '23:00', to: '07:00' } } }],
      ['ai.choices', undefined],
      ['ai.choose', { providerId: 'deepseek', model: 'deepseek-v4-pro' }],
      ['memory.add', { text: 'Me cuesta la trigonometría' }],
      ['memory.forget', { ids: ['m1'] }]
    ])
  })
  it('eventos: lo que emite Aula llega por /events, una línea por evento', async () => {
    const res = await get('/events', { cookie })
    const reader = res.body!.getReader()
    const { emit } = await import('../rpc')
    emit('calendar.changed' as never, { cover: 'aula-asset://pack/curso/assets/fig.png' } as never)
    let text = ''
    while (!text.includes('calendar.changed')) text += new TextDecoder().decode((await reader.read()).value)
    expect(JSON.parse(text.trim())).toEqual({ event: 'calendar.changed', payload: { cover: '/asset/pack/curso/assets/fig.png' } })
    expect(server.listeners).toBe(1)
    await reader.cancel()
  })
  it('recursos: los del curso (con rangos) sí; salir de su carpeta, no', async () => {
    const whole = await get('/asset/pack/curso/assets/fig.png', { cookie })
    expect([whole.status, whole.headers.get('content-type'), await whole.text()]).toEqual([200, 'image/png', '0123456789'])
    const part = await get('/asset/pack/curso/assets/fig.png', { cookie, range: 'bytes=2-5' })
    expect([part.status, part.headers.get('content-range'), await part.text()]).toEqual([206, 'bytes 2-5/10', '2345'])
    expect((await get('/asset/pack/curso/assets/fig.png', { cookie, range: 'bytes=50-60' })).status).toBe(416)
    for (const bad of ['/asset/pack/curso/%2e%2e/%2e%2e/settings.json', '/asset/pack/..%2f..%2fsettings.json', '/asset/settings.json', '/asset/pack/curso/assets/no-existe.png'])
      expect((await get(bad, { cookie })).status, bad).toBe(404)
  })
  it('subidas: el archivo del dispositivo llega a la app como una ruta del Mac permitida', async () => {
    const id = 'e'.repeat(32)
    const up = await fetch(url + `/upload/${id}`, { method: 'PUT', headers: { cookie, 'x-aula-filename': encodeURIComponent('apuntes fotosíntesis.md') }, body: '# Apuntes' })
    expect(up.status).toBe(200)
    expect((await fetch(url + `/upload/${'f'.repeat(32)}`, { method: 'PUT', headers: { cookie }, body: 'x' })).status).toBe(400) // sin nombre
    seen = []
    await rpc('create.addFiles', { paths: [`aula-upload://${id}/apuntes fotosíntesis.md`] })
    const path = (seen[0].args as { paths: string[] }).paths[0]
    expect(path).toMatch(/uploads[\\/][0-9a-f]{12}[\\/]e{32}[\\/]apuntes fotosíntesis\.md$/)
    const { userFiles } = await import('@main/services/userFiles')
    expect(() => userFiles.check([path])).not.toThrow()
  })
  it('al retirar el dispositivo, su cookie deja de valer', async () => {
    devices.revoke(devices.list()[0].id)
    expect((await fetch(url + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{"method":"courses.list"}' })).status).toBe(401)
    expect((await get('/', { cookie })).status).toBe(302)
  })
})

describe('servidor remoto de Aula como servidor (sin ventana)', () => {
  const ADMIN = 'a'.repeat(43)
  let srv: import('./server').RemoteServer
  let reg: import('@main/services/remote/devices').DeviceRegistry
  let surl = ''
  let links: boolean[] = []
  const call = async (method: string, args: unknown, c: string): Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }> =>
    (await fetch(surl + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', cookie: c }, body: JSON.stringify({ method, args }) })).json() as never
  const link = async (owner: boolean): Promise<string> => {
    const { code } = reg.startPairing({ owner })
    const res = await fetch(surl + '/pair/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: owner ? 'iPad' : 'Móvil', platform: owner ? 'ipad' : 'android' }) })
    const set = res.headers.get('set-cookie') ?? ''
    expect(set).toMatch(/^aula_device_abc123def456=.+; HttpOnly; SameSite=Strict$/)
    return set.split(';')[0]
  }

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aula-remote-headless-'))
    const renderer = join(dir, 'renderer')
    mkdirSync(renderer, { recursive: true })
    writeFileSync(join(renderer, 'index.html'), '<!doctype html><html><head><title>Aula</title></head><body></body></html>')
    const { DeviceRegistry } = await import('@main/services/remote/devices')
    const { UploadStore } = await import('@main/services/remote/uploads')
    const { RemoteServer } = await import('./server')
    reg = new DeviceRegistry(join(dir, 'devices.json'))
    srv = new RemoteServer({
      devices: reg, uploads: new UploadStore(join(dir, 'uploads'), { grant: () => true }), rendererRoot: renderer, language: () => 'es', version: '9.9.9', proxyKey: KEY,
      cookieName: 'aula_device_abc123def456', host: 'server',
      admin: { token: ADMIN, status: () => ({ server: true }), link: (owner) => { links.push(owner); return { code: '123456', owner } } }
    })
    surl = `http://127.0.0.1:${await srv.start()}`
  })
  afterAll(async () => { await srv.stop() })

  it('la consola del servidor: solo desde este ordenador, con su clave y nunca por la red privada', async () => {
    const admin = (path: string, headers: Record<string, string>, body?: unknown): Promise<Response> =>
      fetch(surl + path, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    expect((await admin('/admin/status', {})).status).toBe(404)
    expect((await admin('/admin/status', { authorization: 'Bearer ' + 'b'.repeat(43) })).status).toBe(404)
    expect((await admin('/admin/status', { authorization: 'Bearer ' + ADMIN, 'x-aula-proxy-key': KEY })).status).toBe(404)
    expect(await (await admin('/admin/status', { authorization: 'Bearer ' + ADMIN })).json()).toEqual({ ok: true, value: { server: true } })
    links = []
    expect(await (await admin('/admin/link', { authorization: 'Bearer ' + ADMIN }, {})).json()).toEqual({ ok: true, value: { code: '123456', owner: true } })
    expect(await (await admin('/admin/link', { authorization: 'Bearer ' + ADMIN }, { owner: false })).json()).toEqual({ ok: true, value: { code: '123456', owner: false } })
    expect(links).toEqual([true, false])
  })
  it('la página de vincular habla del servidor, no del Mac', async () => {
    const html = await (await fetch(surl + '/pair')).text()
    expect(html).toContain('aula-server link')
    expect(html).not.toContain('En tu Mac')
  })
  it('el propietario hace de ventana (claves, dispositivos); un dispositivo normal no', async () => {
    seen = []
    const owner = await link(true)
    const phone = await link(false)
    const page = await (await fetch(surl + '/', { headers: { cookie: owner } })).text()
    expect(page).toContain('<meta name="aula-host" content="server"><meta name="aula-device" content="owner"><script src="/remote-bridge.js">')
    const plain = await (await fetch(surl + '/', { headers: { cookie: phone } })).text()
    expect(plain).toContain('<meta name="aula-host" content="server">')
    expect(plain).not.toContain('aula-device')
    expect((await call('ai.setKey', { providerId: 'deepseek', key: 'sk-1234567890abcdef' }, owner)).ok).toBe(true)
    expect((await call('ai.configure', { providerId: 'custom', baseURL: 'https://ia.example/v1' }, owner)).ok).toBe(true)
    expect((await call('memory.clear', undefined, owner)).ok).toBe(true)
    const no = await call('data.deleteAll', undefined, owner)
    expect(no.error).toMatchObject({ code: 'forbidden', message: expect.stringContaining('consola del servidor') })
    const phoneNo = await call('ai.setKey', { providerId: 'deepseek', key: 'sk-1234567890abcdef' }, phone)
    expect(phoneNo.error).toMatchObject({ code: 'forbidden', message: expect.stringContaining('propietario') })
    expect(seen.map((s) => s.method)).toEqual(['ai.setKey', 'ai.configure', 'memory.clear'])
  })
  const open = async (c: string): Promise<ReadableStreamDefaultReader<Uint8Array>> => (await fetch(surl + '/events', { headers: { cookie: c } })).body!.getReader()
  /** El dispositivo de una cookie («aula_device_…=<ficha>»). */
  const idOf = (c: string): string => reg.authenticate(decodeURIComponent(c.slice(c.indexOf('=') + 1)))!.id

  it('los eventos de los dispositivos (con sus códigos) solo llegan al propietario', async () => {
    const owner = await link(true)
    const phone = await link(false)
    const ro = await open(owner)
    const rp = await open(phone)
    const { emit } = await import('../rpc')
    emit('remote.changed' as never, { pairing: { code: '654321' } } as never)
    emit('calendar.changed' as never, {} as never)
    expect(await until(ro, 'calendar.changed')).toContain('654321')
    expect(await until(rp, 'calendar.changed')).not.toContain('654321')
    await ro.cancel()
    await rp.cancel()
  })
  it('un dispositivo retirado deja de recibir eventos y se le corta el flujo: ni el código del propietario que lo sustituye', async () => {
    const owner = await link(true)
    const phone = await link(false)
    const [ownerId, phoneId] = [idOf(owner), idOf(phone)]
    const ro = await open(owner)
    const rp = await open(phone)
    const { emit } = await import('../rpc')
    // retirado del registro y nada más: el evento siguiente ya no le llega, y su flujo se cierra
    reg.revoke(ownerId)
    emit('remote.changed' as never, { pairing: { code: '777777', owner: true } } as never)
    emit('calendar.changed' as never, { curso: 'secreto' } as never)
    const got = await drain(ro)
    expect(got).not.toContain('777777')
    expect(got).not.toContain('calendar.changed')
    // el otro, aún vinculado, sí lo recibió (sin el código: no es propietario)
    expect(await until(rp, 'calendar.changed')).not.toContain('777777')
    // «Retirar» (RemoteAccess.revoke) además lo corta en el acto, sin esperar a ningún evento
    reg.revoke(phoneId)
    srv.disconnect(phoneId)
    await drain(rp)
  })
  it('un dispositivo con la cookie de antes («aula_device») sigue entrando y recibe la de esta instalación', async () => {
    const t = reg.completePairing(reg.startPairing().code, 'iPad viejo', 'ipad').token
    const res = await fetch(surl + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `aula_device=${t}` }, body: '{"method":"courses.list"}' })
    expect((await res.json() as { ok: boolean }).ok).toBe(true)
    expect(res.headers.get('set-cookie')).toMatch(/^aula_device_abc123def456=/)
    // y una cookie de otra Aula (con otro nombre) no estorba: cada una lleva la suya
    const both = await fetch(surl + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `aula_device_ffffffffffff=otra; aula_device_abc123def456=${t}` }, body: '{"method":"courses.list"}' })
    expect((await both.json() as { ok: boolean }).ok).toBe(true)
  })
})

describe('servidor remoto en el Mac: sin propietarios, y una ficha caducada corta su flujo', () => {
  let srv: import('./server').RemoteServer
  let reg: import('@main/services/remote/devices').DeviceRegistry
  let murl = ''
  let now = Date.now()
  const pair = async (owner: boolean): Promise<string> => {
    const { code } = reg.startPairing({ owner })
    const res = await fetch(murl + '/pair/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'iPad', platform: 'ipad' }) })
    return (res.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const open = async (c: string): Promise<ReadableStreamDefaultReader<Uint8Array>> => (await fetch(murl + '/events', { headers: { cookie: c } })).body!.getReader()

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aula-remote-mac-'))
    const renderer = join(dir, 'renderer')
    mkdirSync(renderer, { recursive: true })
    writeFileSync(join(renderer, 'index.html'), '<!doctype html><html><head><title>Aula</title></head><body></body></html>')
    const { DeviceRegistry } = await import('@main/services/remote/devices')
    const { UploadStore } = await import('@main/services/remote/uploads')
    const { RemoteServer } = await import('./server')
    reg = new DeviceRegistry(join(dir, 'devices.json'), () => now)
    srv = new RemoteServer({ devices: reg, uploads: new UploadStore(join(dir, 'uploads'), { grant: () => true }), rendererRoot: renderer, language: () => 'es', version: '9.9.9', proxyKey: KEY })
    murl = `http://127.0.0.1:${await srv.start()}`
  })
  afterAll(async () => { await srv.stop() })

  it('un dispositivo marcado como propietario (la carpeta de datos de un servidor) es en el Mac un dispositivo más', async () => {
    const c = await pair(true)
    expect(reg.list()[0].owner).toBe(true)
    const page = await (await fetch(murl + '/', { headers: { cookie: c } })).text()
    expect(page).toContain('<script src="/remote-bridge.js">')
    expect(page).not.toContain('aula-device')
    seen = []
    const res = await (await fetch(murl + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', cookie: c }, body: JSON.stringify({ method: 'ai.setKey', args: { providerId: 'deepseek', key: 'sk-1234567890abcdef' } }) })).json() as { ok: boolean; error?: { code: string; message: string } }
    expect(res.error).toMatchObject({ code: 'forbidden', message: expect.stringContaining('Mac') })
    expect(seen).toEqual([])
    // ni los avisos de los dispositivos (con el código que enseña la ventana)
    const r = await open(c)
    const { emit } = await import('../rpc')
    emit('remote.changed' as never, { pairing: { code: '424242' } } as never)
    emit('calendar.changed' as never, {} as never)
    expect(await until(r, 'calendar.changed')).not.toContain('424242')
    await r.cancel()
  })
  it('una ficha que pasa 90 días sin usarse deja de recibir eventos y su flujo se cierra', async () => {
    const { TOKEN_DAYS } = await import('@main/services/remote/devices')
    const r = await open(await pair(false))
    now += TOKEN_DAYS * 86_400_000 + 1
    const { emit } = await import('../rpc')
    emit('calendar.changed' as never, { curso: 'secreto' } as never)
    expect(await drain(r)).not.toContain('calendar.changed')
  })
})
