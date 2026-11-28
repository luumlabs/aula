// Extremo a extremo del acceso remoto con el proceso auxiliar real (aula-tsnet / aula-tsnet.exe):
//  · apagado por defecto (activación explícita);
//  · escucha solo en 127.0.0.1 y rechaza Host ajenos (421) y llamadas sin vincular (401);
//  · arranca el sidecar real de Tailscale hasta `needsLogin`, aislando su estado en AULA_HOME/Remote/tailnet/data
//    sin tocar %LocalAppData%\Tailscale en Windows;
//  · empareja un dispositivo móvil de prueba, sirve los cursos existentes sin migrar datos, respeta la lista cerrada
//    y los nombres seguros en NTFS (CON.txt), y revoca el acceso al instante;
//  · se apaga limpio al desactivar y al cerrar Aula.
import { test, expect } from 'playwright/test'
import { request as httpRequest } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homeWithDemoCourse, launch } from './helpers'

type Envelope = { ok: boolean; value?: unknown; error?: { code?: string; message?: string } }

function devSidecarPath(): string {
  const root = resolve(__dirname, '../..')
  const binDir = join(root, 'native', 'tsnet', 'bin')
  if (process.platform === 'win32') {
    const a = join(binDir, `win-${process.arch}`, 'aula-tsnet.exe')
    return existsSync(a) ? a : join(binDir, 'aula-tsnet.exe')
  }
  if (process.platform === 'linux') {
    const a = join(binDir, `linux-${process.arch}`, 'aula-tsnet')
    return existsSync(a) ? a : join(binDir, 'aula-tsnet')
  }
  return join(binDir, 'aula-tsnet')
}

function rawHttp(opts: {
  port: number
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((res, rej) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: opts.port, method: opts.method, path: opts.path, headers: opts.headers },
      (r) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }))
      }
    )
    req.on('error', rej)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

test('acceso remoto de escritorio (Mac/Windows/Linux): activación explícita, sidecar real, emparejamiento y seguridad', async () => {
  test.setTimeout(180_000)
  const sidecar = devSidecarPath()
  const hasSidecar = existsSync(sidecar)
  // En CI siempre se compila el sidecar antes de ejecutar las pruebas E2E
  if (process.env.CI === 'true') {
    expect(hasSidecar, `missing sidecar binary at ${sidecar}`).toBe(true)
  }

  const winSystemTailscale = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Tailscale')
    : null
  const hadWinSystemTailscale = winSystemTailscale ? existsSync(winSystemTailscale) : false

  const home = homeWithDemoCourse()
  const { app, page } = await launch({ home })
  const call = async (method: string, args?: unknown): Promise<Record<string, unknown>> => {
    const r = (await page.evaluate(
      ([m, a]) => (globalThis as unknown as { aula: { invoke(m: unknown, a: unknown): Promise<unknown> } }).aula.invoke(m, a),
      [method, args] as const
    )) as Envelope
    if (!r.ok) throw new Error(`${method}: ${r.error?.message}`)
    return r.value as Record<string, unknown>
  }

  try {
    // 1. Apagado por defecto (activación explícita)
    const initial = await call('remote.status')
    expect(initial.enabled).toBe(false)
    expect(initial.localURL).toBeUndefined()
    const initialTailnet = initial.tailnet as { state: string }
    if (hasSidecar) expect(initialTailnet.state).toBe('off')

    // 2. Activación explícita: escucha solo en 127.0.0.1 y persiste el estado en AULA_HOME/Remote
    const enabled = await call('remote.setEnabled', { enabled: true })
    expect(enabled.enabled).toBe(true)
    const localURL = enabled.localURL as string
    expect(localURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const port = Number(new URL(localURL).port)
    const stateFile = JSON.parse(readFileSync(join(home, 'Remote', 'state.json'), 'utf8')) as { enabled: boolean }
    expect(stateFile.enabled).toBe(true)

    // 3. Sidecar real: arranca, aísla su carpeta de datos/registros y alcanza needsLogin (sin cuenta de Tailscale)
    if (hasSidecar) {
      await expect.poll(async () => {
        const s = await call('remote.status')
        const t = s.tailnet as { state: string; authURL?: string }
        return t.state === 'needsLogin' && typeof t.authURL === 'string' && /^https:\/\/login\.tailscale\.com\//.test(t.authURL)
      }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe(true)

      expect(existsSync(join(home, 'Remote', 'tailnet', 'data'))).toBe(true)
      if (winSystemTailscale && !hadWinSystemTailscale) {
        expect(existsSync(winSystemTailscale)).toBe(false)
      }
    }

    // 4. Controles defensivos de red y cabeceras
    const foreignHost = await rawHttp({ port, method: 'GET', path: '/health', headers: { host: 'evil.example' } })
    expect(foreignHost.status).toBe(421)

    const unauthRpc = await rawHttp({
      port,
      method: 'POST',
      path: '/rpc',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
        'x-aula-tailnet-user': 'spoofed@example.com'
      },
      body: JSON.stringify({ method: 'courses.list' })
    })
    expect(unauthRpc.status).toBe(401)

    const health = await rawHttp({
      port,
      method: 'GET',
      path: '/health?challenge=abcdefghijklmnop1234',
      headers: { host: `127.0.0.1:${port}` }
    })
    expect(health.status).toBe(200)
    const healthJson = JSON.parse(health.body) as { ok: boolean; app: string; proof?: { proxy?: string } }
    expect(healthJson.ok).toBe(true)
    expect(healthJson.app).toBe('aula')
    expect(typeof healthJson.proof?.proxy).toBe('string')

    // 5. Página de emparejamiento con textos acordes a la plataforma
    const pairPage = await rawHttp({ port, method: 'GET', path: '/pair', headers: { host: `127.0.0.1:${port}` } })
    expect(pairPage.status).toBe(200)
    expect(pairPage.headers['cache-control']).toBe('no-store')
    if (process.platform === 'win32') {
      expect(pairPage.body).toMatch(/Windows PC|PC con Windows/)
    } else {
      expect(pairPage.body).toMatch(/Mac/)
    }

    // 6. Emparejamiento y acceso a la instancia existente (sin migrar datos)
    const pairingRes = await call('remote.startPairing')
    const code = (pairingRes.pairing as { code: string }).code
    expect(code).toMatch(/^\d{6}$/)

    const complete = await rawHttp({
      port,
      method: 'POST',
      path: '/pair/complete',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'Pixel Test', platform: 'android' })
    })
    expect(complete.status).toBe(200)
    const setCookie = Array.isArray(complete.headers['set-cookie']) ? complete.headers['set-cookie'].join('; ') : (complete.headers['set-cookie'] ?? '')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    const paired = JSON.parse(complete.body) as { ok: boolean; token: string; device: { id: string } }
    expect(paired.ok).toBe(true)
    const authHeader = { host: `127.0.0.1:${port}`, authorization: `Bearer ${paired.token}` }

    // Meta aula-host en la app servida
    const appHtml = await rawHttp({ port, method: 'GET', path: '/', headers: authHeader })
    expect(appHtml.status).toBe(200)
    if (process.platform === 'win32') {
      expect(appHtml.body).toContain('<meta name="aula-host" content="windows">')
    } else {
      expect(appHtml.body).not.toContain('<meta name="aula-host" content="windows">')
    }

    // Cursos existentes accesibles directamente desde AULA_HOME sin migrar
    const coursesRes = await rawHttp({
      port,
      method: 'POST',
      path: '/rpc',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'courses.list' })
    })
    expect(coursesRes.status).toBe(200)
    const coursesEnv = JSON.parse(coursesRes.body) as Envelope
    expect(coursesEnv.ok).toBe(true)
    expect(JSON.stringify(coursesEnv.value)).toContain('exam-2-math112')

    // Lista cerrada: métodos sensibles denegados con mensaje acorde a la plataforma
    const deniedDelete = await rawHttp({
      port,
      method: 'POST',
      path: '/rpc',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'data.deleteAll' })
    })
    const deniedEnv = JSON.parse(deniedDelete.body) as Envelope
    expect(deniedEnv.ok).toBe(false)
    expect(deniedEnv.error?.code).toBe('forbidden')
    if (process.platform === 'win32') {
      expect(deniedEnv.error?.message).toMatch(/Windows PC|PC con Windows/)
    }

    const deniedKey = await rawHttp({
      port,
      method: 'POST',
      path: '/rpc',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'ai.setKey', args: { providerId: 'openai', key: 'sk-test' } })
    })
    expect((JSON.parse(deniedKey.body) as Envelope).error?.code).toBe('forbidden')

    // Subida con nombre reservado de NTFS (CON.txt): nunca falla ni crea dispositivo reservado en Windows
    const upload = await rawHttp({
      port,
      method: 'PUT',
      path: '/upload/0123456789abcdef0123456789abcdef',
      headers: { ...authHeader, 'x-aula-filename': encodeURIComponent('CON.txt') },
      body: 'hello'
    })
    expect(upload.status).toBe(200)

    // Revocación inmediata del dispositivo
    await call('remote.revoke', { id: paired.device.id })
    const afterRevoke = await rawHttp({
      port,
      method: 'POST',
      path: '/rpc',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'courses.list' })
    })
    expect(afterRevoke.status).toBe(401)

    // 7. Apagado limpio y reactivación antes de cerrar la app (verifica cierre limpio del sidecar en quit)
    const disabled = await call('remote.setEnabled', { enabled: false })
    expect(disabled.enabled).toBe(false)
    expect(disabled.localURL).toBeUndefined()
    if (hasSidecar) expect((disabled.tailnet as { state: string }).state).toBe('off')

    const reenabled = await call('remote.setEnabled', { enabled: true })
    expect(reenabled.enabled).toBe(true)
  } finally {
    await app.close()
  }

  // Los cursos originales siguen intactos tras activar, usar y cerrar el acceso remoto
  expect(existsSync(join(home, 'Packs', 'exam-2-math112'))).toBe(true)
})
