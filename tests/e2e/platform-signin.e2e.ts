// Inicio de sesión en plataformas con SSO (todo local y falso: sin cuentas reales y sin escribir credenciales; solo se pulsa
// «Continuar»). Comprueba que Aula detecta la sesión aunque el SSO vaya por otro host y otro puerto, haya doble factor, el
// panel se pinte con JavaScript o el acceso se haga en una ventana emergente que vuelve sin navegar.
import { test, expect, type ElectronApplication, type Page } from 'playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './helpers'
import { startFakePlatforms, type FakePlatforms } from './fake-platforms'

interface View { id: string; status: string; signingIn: boolean; label: string }

let fake: FakePlatforms

/** Líneas del registro de plataformas (para ver qué pasó si algo falla o con AULA_E2E_LOG=1). */
function platformLog(home: string): string {
  const f = join(home, 'Logs', 'main.log')
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('[platforms]')).join('\n') : '(sin registro)'
}

function report(home: string, failed: boolean): void {
  if (process.env.AULA_E2E_LOG || failed) {
    console.log(platformLog(home))
    console.log(fake.requests.map((r) => `${r.method} ${r.host}${r.path} ${r.authed ? 'authed' : ''}`).join('\n'))
  }
}

test.beforeAll(async () => {
  fake = await startFakePlatforms({ slowLoginMs: Number(process.env.AULA_E2E_SLOW_LOGIN ?? 1800), sameSite: (process.env.AULA_E2E_SAMESITE as 'Lax' | 'Strict' | 'None' | undefined) ?? 'Lax' })
})
test.afterAll(async () => {
  await fake?.close()
})

async function invoke<T>(page: Page, method: string, args?: unknown): Promise<T> {
  const env = await page.evaluate(([m, a]) => (globalThis as unknown as { aula: { invoke(m: string, a?: unknown): Promise<unknown> } }).aula.invoke(m as string, a), [method, args] as const)
  const e = env as { ok: boolean; value?: T; error?: { message: string } }
  if (!e.ok) throw new Error(e.error?.message ?? 'rpc')
  return e.value as T
}

/** Abre la ventana de acceso de la cuenta (sin esperar a que acabe) y devuelve su página. */
async function openSignIn(app: ElectronApplication, page: Page, accountId: string): Promise<Page> {
  const next = app.waitForEvent('window', { timeout: 15_000 })
  void page.evaluate((id) => (globalThis as unknown as { aula: { invoke(m: string, a?: unknown): Promise<unknown> } }).aula.invoke('platforms.signIn', { accountId: id }), accountId).catch(() => undefined)
  return next
}

async function waitSignedIn(page: Page, accountId: string, ms = 25_000): Promise<View> {
  const start = Date.now()
  let last: View | undefined
  while (Date.now() - start < ms) {
    const list = await invoke<View[]>(page, 'platforms.list')
    last = list.find((a) => a.id === accountId)
    if (last?.status === 'signedIn' && !last.signingIn) return last
    await page.waitForTimeout(400)
  }
  throw new Error(`no se detectó la sesión (estado: ${last?.status}, abierta: ${last?.signingIn})`)
}

test('Canvas con SAML en otro host, doble factor y panel pintado con JavaScript', async () => {
  const { app, page, home } = await launch()
  let failed = true
  try {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.canvasURL, kind: 'canvas' })
    const win = await openSignIn(app, page, acc.id)
    await win.waitForURL(/sso\.localhost.*SSO/, { timeout: 15_000 })
    await win.getByRole('button', { name: 'Continuar' }).click()
    await win.waitForURL(/idp\/mfa/)
    await win.getByRole('button', { name: 'Ya lo aprobé' }).click()
    const v = await waitSignedIn(page, acc.id)
    expect(v.status).toBe('signedIn')
    // la ventana se cierra sola
    await expect.poll(() => win.isClosed(), { timeout: 8000 }).toBe(true)
    // la comprobación llevó la cookie de la sesión (SameSite=Lax) y fue de solo lectura
    expect(fake.requests.some((r) => r.path === '/api/v1/users/self' && r.authed)).toBe(true)
    expect(fake.writes()).toEqual([])
    failed = false
  } finally {
    await app.close()
    report(home, failed)
  }
})

test('Moodle con CAS: redirecciones entre hosts y menú del usuario al final de una página grande', async () => {
  const { app, page, home } = await launch()
  let failed = true
  try {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
    const win = await openSignIn(app, page, acc.id)
    // la portada pública de Moodle: el estudiante pulsa «Acceder» y elige la cuenta de la universidad
    await win.getByRole('link', { name: 'Acceder' }).click()
    await win.getByRole('link', { name: 'Entrar con la cuenta de la universidad' }).click()
    await win.waitForURL(/cas\.localhost:\d+\/cas\/login/)
    await win.getByRole('button', { name: 'Continuar' }).click()
    const v = await waitSignedIn(page, acc.id)
    expect(v.status).toBe('signedIn')
    await expect.poll(() => win.isClosed(), { timeout: 8000 }).toBe(true)
    expect(fake.writes()).toEqual([])
    failed = false
  } finally {
    await app.close()
    report(home, failed)
  }
})

test('Blackboard Ultra: acceso en una ventana emergente y panel que cambia sin navegar', async () => {
  const { app, page, home } = await launch()
  let failed = true
  try {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.blackboardURL, kind: 'blackboard' })
    const win = await openSignIn(app, page, acc.id)
    await win.getByRole('button', { name: 'Iniciar sesión con la universidad' }).click({ timeout: 15_000 })
    const popup = await app.waitForEvent('window', { timeout: 10_000 })
    await popup.waitForURL(/idp\.localhost:\d+\/idp\/popup/)
    await popup.getByRole('button', { name: 'Continuar' }).click()
    await popup.waitForURL(/idp\/mfa/)
    await popup.getByRole('button', { name: 'Ya lo aprobé' }).click()
    const v = await waitSignedIn(page, acc.id)
    expect(v.status).toBe('signedIn')
    expect(fake.writes()).toEqual([])
    failed = false
  } finally {
    await app.close()
    report(home, failed)
  }
})

test('«Ya he iniciado sesión» vuelve a comprobar y la interfaz lo dice claro', async () => {
  const { app, page, home } = await launch()
  let failed = true
  try {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.canvasURL, kind: 'canvas', label: 'Canvas de tu universidad' })
    // sin iniciar sesión: el respaldo dice que aún no
    const win = await openSignIn(app, page, acc.id)
    await win.waitForURL(/sso\.localhost/, { timeout: 15_000 })
    const early = await invoke<{ signedIn: boolean }>(page, 'platforms.confirmSignIn', { accountId: acc.id })
    expect(early.signedIn).toBe(false)
    expect(win.isClosed()).toBe(false)
    // la pantalla de plataformas muestra la espera y el botón de respaldo
    await page.evaluate(() => (globalThis as unknown as { __aula: { navigate(r: unknown): void } }).__aula.navigate({ name: 'settings' }))
    const confirm = page.getByRole('button', { name: /already signed in|Ya he iniciado sesión/i })
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await win.getByRole('button', { name: 'Continuar' }).click()
    await win.getByRole('button', { name: 'Ya lo aprobé' }).click()
    await waitSignedIn(page, acc.id)
    await expect(page.getByText(/Signed in to Canvas de tu universidad|Sesión iniciada en Canvas de tu universidad/).first()).toBeVisible({ timeout: 10_000 })
    failed = false
  } finally {
    await app.close()
    report(home, failed)
  }
})
