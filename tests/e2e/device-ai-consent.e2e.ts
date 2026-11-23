// A8 (guía 5.1.2(i) del App Store): desde un dispositivo vinculado, antes de mandar lo primero a la IA, Aula dice a quién
// lo manda y espera a que el estudiante continúe. Cancelar no manda nada (el texto vuelve a la caja). En la demostración el
// aviso es el suyo; con la IA simulada no hay a quién mandar nada, así que fuera de ella no se pregunta. La ventana del Mac
// nunca lo enseña. (Con una IA de verdad, la guardia del Mac la prueban src/main/electron/remote/server.test.ts.)
import { test, expect, type Page } from 'playwright/test'
import { go, homeWithDemoCourse, launch } from './helpers'

type Envelope = { ok: boolean; value?: unknown; error?: { code: string; message: string } }

const navigateTo = (page: Page, route: Record<string, unknown>): Promise<void> =>
  page.evaluate((r) => (globalThis as unknown as { __aula: { navigate(r: unknown): void } }).__aula.navigate(r), route)

test('dispositivo: el aviso de la IA antes del primer mensaje; cancelar no manda nada', async () => {
  test.setTimeout(180_000)
  const { app, page: mac } = await launch({ home: homeWithDemoCourse() })
  try {
    const call = async (method: string, args?: unknown): Promise<Record<string, unknown>> => {
      const r = (await mac.evaluate(([m, a]) => (globalThis as unknown as { aula: { invoke(m: unknown, a: unknown): Promise<unknown> } }).aula.invoke(m, a), [method, args] as const)) as Envelope
      if (!r.ok) throw new Error(`${method}: ${r.error?.message}`)
      return r.value as Record<string, unknown>
    }
    const base = (await call('remote.setEnabled', { enabled: true })).localURL as string
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const code = ((await call('remote.startPairing')).pairing as { code: string }).code

    // el «dispositivo»: otra ventana sin el puente de Electron, que habla con el servidor como un iPhone
    const opening = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { partition: 'aula-e2e-device' } })
      await w.loadURL(url)
    }, base + '/pair')
    const device = await opening
    await device.waitForLoadState('domcontentloaded')
    const paired = (await device.evaluate(async (c) => (await fetch('/pair/complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c, name: 'iPhone', platform: 'iphone' }) })).json(), code)) as { ok: boolean }
    expect(paired.ok).toBe(true)

    // lo que el dispositivo pide al Mac
    const sent: string[] = []
    device.on('request', (req) => {
      if (new URL(req.url()).pathname !== '/rpc') return
      try { sent.push((JSON.parse(req.postData() ?? '{}') as { method?: string }).method ?? '?') } catch { /* cuerpo raro */ }
    })

    // con la IA simulada no se manda nada a nadie: no hay nada que aceptar
    await device.goto(base + '/')
    await device.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula, null, { timeout: 20_000 })
    const state = (await device.evaluate(() => (globalThis as unknown as { aula: { invoke(m: string): Promise<unknown> } }).aula.invoke('ai.consent'))) as Envelope
    expect(state).toEqual({ ok: true, value: { needed: false, recipients: [] } })

    // en la demostración, su aviso antes del primer mensaje
    await device.goto(base + '/?demo=1')
    await device.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula, null, { timeout: 20_000 })
    await navigateTo(device, { name: 'chat' })
    const box = device.locator('textarea').first()
    await expect(box).toBeVisible()
    await box.fill('Give me a quick quiz')
    await box.press('Enter')
    const accept = device.locator('[data-ai-consent="accept"]')
    await expect(accept).toBeVisible()
    await expect(device.getByRole('dialog')).toContainText(/In this demo nothing is sent anywhere|En esta demostración no se envía nada/)

    // cancelar: no sale nada y el texto vuelve a la caja
    await device.locator('[data-ai-consent="cancel"]').click()
    await expect(accept).toHaveCount(0)
    await expect(box).toHaveValue('Give me a quick quiz')
    expect(sent).not.toContain('chat.send')
    await expect(device.locator('[data-role="user"]').filter({ hasText: 'Give me a quick quiz' })).toHaveCount(0)

    // continuar: se manda y Aula contesta
    await box.press('Enter')
    await accept.click()
    await expect(device.locator('[data-role="user"]').filter({ hasText: 'Give me a quick quiz' }).first()).toBeVisible()
    expect(sent).toContain('chat.send')
    await expect.poll(async () => device.locator('[data-role="assistant"]').count(), { timeout: 60_000 }).toBeGreaterThan(0)

    // y ya no se vuelve a preguntar
    await expect(device.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
    await box.fill('Thanks')
    await box.press('Enter')
    await expect(device.locator('[data-role="user"]').filter({ hasText: 'Thanks' }).first()).toBeVisible()
    await expect(accept).toHaveCount(0)

    // la ventana del Mac nunca lo enseña
    await go(mac, { name: 'chat' })
    const macBox = mac.getByRole('textbox', { name: 'Message Aula…' })
    await macBox.fill('¿Qué es una parábola?')
    await macBox.press('Enter')
    await expect(mac.locator('[data-role="user"]').filter({ hasText: '¿Qué es una parábola?' }).first()).toBeVisible()
    await expect(mac.locator('[data-ai-consent]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
