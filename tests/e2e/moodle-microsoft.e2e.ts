// Issue #25: «no puedo iniciar sesión en Moodle con la cuenta de la universidad (Outlook): se queda colgado o entra en bucle».
// Un Moodle y un Microsoft Entra ID falsos y locales (tests/e2e/fake-moodle-microsoft.ts) pasan por la ventana de inicio de
// sesión REAL de Aula; un «estudiante» simulado escribe valores de prueba locales y pulsa botones, como una persona (con
// pausas). Se cuentan los /authorize de cada flujo, las comprobaciones de fondo, los reinicios del flujo de Microsoft, si Aula
// acaba con la sesión iniciada y cuánto tarda. Aula nunca escribe ni pulsa nada por el estudiante: solo mira.
// Los /authorize de fondo se cuentan desde el principio de cada caso: tampoco el sondeo del alta (sin cookies) empieza un
// acceso de Microsoft (se para antes de /auth/oidc/).
//
//   npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/moodle-microsoft.e2e.ts
//   AULA_E2E_LOG=1 …   (línea de tiempo de cada caso aunque pase)
//   AULA_E2E_RESULTS=/ruta/resultados.jsonl …   (una línea JSON por caso)
//   AULA_E2E_THINK_MS=2500 …   (pausa del estudiante entre pasos; 1500 por defecto)
//
// Necesita `npm run build` antes (usa out/).
import { test, expect, type ElectronApplication, type Page } from 'playwright/test'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './helpers'
import { startFakeMoodleMicrosoft, type FakeMoodleMicrosoft, type MMSummary, type MoodleMicrosoftOptions } from './fake-moodle-microsoft'

interface View { id: string; status: string; signingIn: boolean; label: string; baseURL: string; statusDetail?: string }

interface Plan {
  /** Pausa «humana» antes de cada paso (ms). */
  thinkMs?: number
  /** Respuesta a «¿Quiere mantener la sesión iniciada?». */
  kmsi?: 'yes' | 'no'
  /** Lo que tarda en leer la política antes de aceptarla (ms). */
  policyReadMs?: number
  /** En la política, cierra la ventana sin aceptarla. */
  closeOnPolicy?: boolean
  /** En la página de la contraseña, pulsa «Ya he iniciado sesión» en Aula (impaciente) antes de escribirla: cuántas veces
   *  como mucho (una por cada vez que vea esa página). */
  confirmOnPassword?: number
  /** Lo que tarda en aprobar el doble factor en el móvil (ms). */
  mfaApproveMs?: number
  /** Mientras espera al doble factor, pulsa «Ya he iniciado sesión» en Aula (cuántas veces como mucho). */
  confirmOnMfa?: number
  /** Control: termina al llegar al Área personal. */
  untilDashboard?: boolean
  maxMs?: number
}

interface StudentRun {
  outcome: 'window-closed' | 'closed-by-student' | 'dashboard' | 'idp-error' | 'timeout'
  ms: number
  steps: string[]
  usernamePages: number
  /** El aviso de Aula del paso de Moodle (política) estaba a la vista. */
  stepHint: boolean
  idpError?: string
}

interface Scenario {
  name: string
  fake: MoodleMicrosoftOptions
  plan?: Plan
  /** Una comprobación de la sesión ya en marcha (la del arranque o «Comprobar ahora») cuando se abre la ventana. */
  checkInFlight?: boolean
  /** También en una ventana normal de Electron sin Aula (control: el falso funciona en cualquier navegador). */
  control?: boolean
}

interface StudentHooks {
  /** «Ya he iniciado sesión» en Aula. */
  confirm?: () => Promise<unknown>
  /** Cierra la ventana (el botón de cerrar de la ventana). */
  close?: () => Promise<unknown>
}

const THINK_MS = Number(process.env.AULA_E2E_THINK_MS ?? 1500)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const POLICY_TEXT = /política|policy/i
const FORCED: MoodleMicrosoftOptions = { auth: 'oidc', forceRedirect: true, forceLogin: true }

const SCENARIOS: Scenario[] = [
  // auth_oauth2 del núcleo: botón «Microsoft» en la página de acceso, vuelta GET a /admin/oauth2callback.php (sesskey)
  { name: 'oauth2 · botón en el acceso', fake: { auth: 'oauth2' } },
  // auth_oidc con redirección forzada: la ventana va directa a Microsoft; vuelta por form_post (MoodleSession Lax)
  { name: 'oidc · forzado · form_post', fake: FORCED },
  // tras entrar, Moodle pide aceptar la política del sitio: la ventana espera a que el estudiante la acepte
  { name: 'oidc · forzado · política del sitio', fake: { ...FORCED, policy: true }, plan: { policyReadMs: 5000 }, control: true },
  // el estudiante pulsa «Ya he iniciado sesión» en Aula mientras está en la contraseña o aprobando el doble factor: la
  // comprobación no debe empezar un flujo de Microsoft por debajo (dejaría viejo el de la ventana)
  { name: 'oidc · forzado · «Ya he iniciado sesión» 4 veces', fake: FORCED, plan: { confirmOnPassword: 4 } },
  { name: 'oidc · forzado · doble factor · «Ya he iniciado sesión» mientras aprueba (×3)', fake: { ...FORCED, mfa: true }, plan: { confirmOnMfa: 3 } },
  // una comprobación lenta ya en marcha al abrir la ventana: se corta, sin pisar la sesión de la ventana
  { name: 'oidc · forzado · comprobación LENTA en marcha al abrir', fake: { ...FORCED, slowBackgroundMs: 2500 }, checkInFlight: true },
  { name: 'oauth2 · comprobación LENTA en marcha al abrir', fake: { auth: 'oauth2', slowBackgroundMs: 4000 }, checkInFlight: true }
]

async function invoke<T>(page: Page, method: string, args?: unknown): Promise<T> {
  const env = await page.evaluate(([m, a]) => (globalThis as unknown as { aula: { invoke(m: string, a?: unknown): Promise<unknown> } }).aula.invoke(m as string, a), [method, args] as const)
  const e = env as { ok: boolean; value?: T; error?: { message: string } }
  if (!e.ok) throw new Error(e.error?.message ?? 'rpc')
  return e.value as T
}

async function view(page: Page, accountId: string): Promise<View | undefined> {
  return (await invoke<View[]>(page, 'platforms.list')).find((a) => a.id === accountId)
}

/** Espera a que la cuenta cumpla `ok` (la ventana ya cerrada, el estado ya aplicado). */
async function waitView(page: Page, accountId: string, ok: (v: View) => boolean, ms = 20_000): Promise<View> {
  const until = Date.now() + ms
  let v: View | undefined
  while (Date.now() < until) {
    v = await view(page, accountId)
    if (v && ok(v)) return v
    await sleep(300)
  }
  throw new Error(`la cuenta no llegó al estado esperado: ${JSON.stringify(v)}`)
}

const signedIn = (v: View): boolean => v.status === 'signedIn' && !v.signingIn

/** Líneas del registro de plataformas de Aula. */
function platformLog(home: string): string {
  const f = join(home, 'Logs', 'main.log')
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('[platforms]')).join('\n') : '(sin registro)'
}

/** Lo que tiene delante el estudiante (marcas del falso en el body). */
async function pageState(win: Page): Promise<{ fake: string; page: string; text: string }> {
  return win.evaluate(() => {
    const body = (globalThis as unknown as { document: { body: { dataset: Record<string, string | undefined>; innerText: string } | null } }).document.body
    return { fake: body?.dataset.fake ?? '', page: body?.dataset.page ?? '', text: (body?.innerText ?? '').slice(0, 300) }
  })
}

/**
 * El estudiante: mira qué página tiene delante (data-fake) y hace lo que haría una persona, con una pausa antes de cada paso.
 * Solo escribe valores de prueba locales en el Microsoft falso y pulsa botones.
 */
async function student(win: Page, plan: Plan, fake: FakeMoodleMicrosoft, hooks: StudentHooks = {}): Promise<StudentRun> {
  const start = Date.now()
  const steps: string[] = []
  let last = ''
  let usernamePages = 0
  let confirmed = 0
  let stepHint = false
  const step = (s: string): void => {
    steps.push(`+${((Date.now() - start) / 1000).toFixed(1)}s ${s}`)
    fake.mark(`estudiante: ${s}`)
  }
  const done = (outcome: StudentRun['outcome'], extra: Partial<StudentRun> = {}): StudentRun => ({ outcome, ms: Date.now() - start, steps, usernamePages, stepHint, ...extra })
  /** Actúa solo si la página sigue siendo la misma (la ventana puede haber navegado o haberse cerrado durante la pausa). */
  const on = (pageId: string, sel: string): ReturnType<Page['locator']> => win.locator(`body[data-page="${pageId}"] ${sel}`)
  while (Date.now() - start < (plan.maxMs ?? 60_000)) {
    if (win.isClosed()) return done('window-closed')
    let st: { fake: string; page: string; text: string } | null = null
    try {
      st = await pageState(win)
    } catch {
      await sleep(150)
      continue
    }
    if (!st.fake || st.page === last) {
      await sleep(200)
      continue
    }
    last = st.page
    const id = st.page
    try {
      switch (st.fake) {
        case 'ms-username':
          usernamePages++
          step(`Microsoft: página del usuario (${usernamePages}.ª vez)`)
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, '#i0116').fill('estudiante@uni.localhost', { timeout: 3000 })
          await on(id, '#idSIButton9').click({ timeout: 3000 })
          break
        case 'ms-password':
          step('Microsoft: página de la contraseña')
          if (plan.confirmOnPassword && confirmed < plan.confirmOnPassword && hooks.confirm) {
            confirmed++
            step(`pulsa «Ya he iniciado sesión» en Aula (${confirmed}.ª vez)`)
            const r = await hooks.confirm().catch((e: unknown) => ({ error: String(e) }))
            step(`Aula contesta: ${JSON.stringify(r).slice(0, 80)}`)
          }
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, '#i0118').fill('prueba-local', { timeout: 3000 })
          await on(id, '#idSIButton9').click({ timeout: 3000 })
          break
        case 'ms-mfa': {
          step('Microsoft: «Aprueba la solicitud» (doble factor), coge el móvil')
          const approveIn = plan.mfaApproveMs ?? 5000
          if (plan.confirmOnMfa && confirmed < plan.confirmOnMfa && hooks.confirm) {
            await sleep(Math.min(2000, approveIn / 2))
            confirmed++
            step(`mientras, pulsa «Ya he iniciado sesión» en Aula (${confirmed}.ª vez)`)
            const r = await hooks.confirm().catch((e: unknown) => ({ error: String(e) }))
            step(`Aula contesta: ${JSON.stringify(r).slice(0, 60)}`)
            await sleep(Math.max(0, approveIn - Math.min(2000, approveIn / 2)))
          } else await sleep(approveIn)
          step('aprueba en el móvil')
          fake.approveMfa()
          break
        }
        case 'ms-kmsi':
          step('Microsoft: «¿Mantener la sesión iniciada?»')
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, plan.kmsi === 'no' ? '#idBtn_Back' : '#idSIButton9').click({ timeout: 3000 })
          break
        case 'ms-error':
          step(`Microsoft: ERROR ${st.text.replace(/\s+/g, ' ').slice(0, 160)}`)
          return done('idp-error', { idpError: st.text.replace(/\s+/g, ' ').slice(0, 200) })
        case 'ms-autopost':
          step('Microsoft: formulario que vuelve solo a Moodle')
          break
        case 'portal':
          step('portal de la universidad → «Campus virtual»')
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, '#campus-link').click({ timeout: 3000 })
          break
        case 'moodle-front':
          step('Moodle: portada sin sesión → «Acceder»')
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, 'a[href*="/login/index.php"]').first().click({ timeout: 3000 })
          break
        case 'moodle-login':
          step(`Moodle: página de acceso${/timed out/i.test(st.text) ? ' con «Your session has most likely timed out»' : ''} → «Microsoft»`)
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, '#ms-provider').click({ timeout: 3000 })
          break
        case 'moodle-already':
          // su botón principal cerraría la sesión: el estudiante espera a que Aula se dé cuenta
          step('Moodle: «Ya has iniciado sesión» (no toca nada)')
          break
        case 'moodle-error':
          step(`Moodle: ERROR «${st.text.replace(/\s+/g, ' ').slice(0, 120)}» → «Continuar»`)
          await sleep(plan.thinkMs ?? THINK_MS)
          await on(id, '#continue').click({ timeout: 3000 })
          break
        case 'moodle-policy':
          step('Moodle: política del sitio (la lee)')
          stepHint = stepHint || (await win.locator('[data-aula-hint="step"]').first().waitFor({ state: 'attached', timeout: 6000 }).then(() => true, () => false))
          step(stepHint ? 've el aviso de Aula: «hazlo aquí y la ventana se cerrará sola»' : 'NO ve el aviso de Aula')
          if (plan.closeOnPolicy && hooks.close) {
            await sleep(plan.thinkMs ?? THINK_MS)
            step('cierra la ventana sin aceptar la política')
            await hooks.close()
            return done('closed-by-student')
          }
          await sleep(plan.policyReadMs ?? 4000)
          step('Moodle: acepta la política')
          await on(id, '#agree').click({ timeout: 3000 })
          break
        case 'moodle-dashboard':
          step('Moodle: Área personal')
          if (plan.untilDashboard) return done('dashboard')
          break
        default:
          step(`página ${st.fake}`)
      }
    } catch (err) {
      // la página cambió o la ventana se cerró a mitad del paso
      step(`(paso interrumpido: ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 80)})`)
      last = ''
    }
  }
  return done('timeout')
}

interface Result extends MMSummary {
  scenario: string
  mode: 'aula' | 'control'
  outcome: StudentRun['outcome']
  signedIn: boolean | null
  usernamePages: number
  seconds: number
  windowClosedAt: number | null
  stepHint: boolean
  idpError?: string
}

function report(r: Result, run: StudentRun, fake: FakeMoodleMicrosoft, home: string | null, failed: boolean): void {
  const line = JSON.stringify(r)
  console.log(`RESULT ${line}`)
  if (process.env.AULA_E2E_RESULTS) appendFileSync(process.env.AULA_E2E_RESULTS, line + '\n')
  if (process.env.AULA_E2E_LOG || failed) {
    console.log(`--- ${r.mode} · ${r.scenario}: estudiante\n${run.steps.join('\n')}`)
    console.log(`--- ${r.mode} · ${r.scenario}: peticiones y sucesos\n${fake.timeline()}`)
    if (home) console.log(`--- ${r.mode} · ${r.scenario}: registro de Aula\n${platformLog(home)}`)
  }
}

async function openSignIn(app: ElectronApplication, page: Page, accountId: string): Promise<Page> {
  const next = app.waitForEvent('window', { timeout: 15_000 })
  void page.evaluate((id) => (globalThis as unknown as { aula: { invoke(m: string, a?: unknown): Promise<unknown> } }).aula.invoke('platforms.signIn', { accountId: id }), accountId).catch(() => undefined)
  return next
}

/** Cierra la ventana como el estudiante (su botón de cerrar), no desde la página. */
async function closeWindow(app: ElectronApplication, win: Page): Promise<void> {
  if (win.isClosed()) return
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.close()).catch(() => undefined)
  await expect.poll(() => win.isClosed(), { timeout: 5000 }).toBe(true)
}

/** Hora (del falso) a la que se cierra la ventana. */
function closedAt(win: Page, fake: FakeMoodleMicrosoft, label = 'la ventana de inicio de sesión se cerró'): () => number | null {
  let at: number | null = null
  win.on('close', () => {
    at = fake.now()
    fake.mark(label)
  })
  return () => at
}

/** Un caso con el falso y Aula: al fallar (o con AULA_E2E_LOG=1), la línea de tiempo y el registro de Aula. */
async function withAula(
  fakeOpts: MoodleMicrosoftOptions,
  body: (ctx: { fake: FakeMoodleMicrosoft; app: ElectronApplication; page: Page; home: string }) => Promise<void>
): Promise<void> {
  const fake = await startFakeMoodleMicrosoft(fakeOpts)
  const { app, page, home } = await launch()
  let ok = false
  try {
    await body({ fake, app, page, home })
    ok = test.info().errors.length === 0
  } finally {
    await app.close().catch(() => undefined)
    if (process.env.AULA_E2E_LOG || !ok) {
      console.log(`--- ${test.info().title}: peticiones y sucesos\n${fake.timeline()}`)
      console.log(`--- ${test.info().title}: registro de Aula\n${platformLog(home)}`)
    }
    await fake.close()
  }
}

// MARK: Escenarios con el estudiante

for (const sc of SCENARIOS) {
  test(`Aula · ${sc.name}`, async () => {
    const fake = await startFakeMoodleMicrosoft(sc.fake)
    const { app, page, home } = await launch()
    let failed = true
    let run: StudentRun | null = null
    let r: Result | null = null
    try {
      const acc = await invoke<View>(page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
      // desde aquí cuenta lo que hace Aula con la cuenta (los /authorize de fondo, desde el principio: también el alta)
      const from = fake.now()
      let checking: Promise<unknown> | null = null
      if (sc.checkInFlight) {
        fake.mark('Aula: comprobación de la sesión en marcha (platforms.check)')
        checking = invoke(page, 'platforms.check', { accountId: acc.id }).catch((e: unknown) => String(e))
        await sleep(150)
      }
      fake.mark('Aula abre la ventana de inicio de sesión')
      const t0 = fake.now()
      const win = await openSignIn(app, page, acc.id)
      const windowClosedAt = closedAt(win, fake)
      run = await student(win, sc.plan ?? {}, fake, { confirm: () => invoke(page, 'platforms.confirmSignIn', { accountId: acc.id }) })
      // tras cerrarse la ventana, el estado llega enseguida
      let v = await view(page, acc.id)
      for (let i = 0; i < 20 && v?.signingIn; i++) {
        await sleep(250)
        v = await view(page, acc.id)
      }
      if (checking) fake.mark(`Aula: la comprobación en marcha terminó: ${JSON.stringify(await checking).slice(0, 120)}`)
      r = {
        scenario: sc.name, mode: 'aula', outcome: run.outcome, signedIn: v?.status === 'signedIn' && !v.signingIn, usernamePages: run.usernamePages,
        seconds: Math.round((fake.now() - t0) / 100) / 10, windowClosedAt: windowClosedAt(), stepHint: run.stepHint,
        ...(run.idpError ? { idpError: run.idpError } : {}), ...fake.summary(from), authorizeBackground: fake.summary().authorizeBackground
      }
      // Aula detecta la sesión, con un solo flujo de Microsoft, sin reinicios ni bucles, sin empezar inicios de sesión por su
      // cuenta y sin cerrar la ventana antes de que el estudiante acabe (la política)
      expect.soft(r.signedIn, 'Aula acaba con la sesión iniciada').toBe(true)
      expect.soft(r.outcome, 'la ventana se cierra sola').toBe('window-closed')
      expect.soft(r.staleSubmits, 'ningún flujo de Microsoft se queda viejo (el estudiante no vuelve a la página del usuario)').toBe(0)
      expect.soft(r.loopErrors, 'sin AADSTS50196 (bucle)').toBe(0)
      expect.soft(r.authorizeBackground, 'Aula no empieza inicios de sesión de Microsoft de fondo').toBe(0)
      expect.soft(r.sesskeyMismatch + r.unknownState, 'Moodle no pierde el hilo (sesskey / estado)').toBe(0)
      expect.soft(r.logouts, 'nadie cierra la sesión de Moodle').toBe(0)
      if (sc.fake.policy) {
        expect.soft(r.policyAcceptedAt, 'el estudiante llegó a aceptar la política').not.toBeNull()
        expect.soft((r.windowClosedAt ?? 0) >= (r.policyAcceptedAt ?? Infinity), 'la ventana no se cierra antes de aceptar la política').toBe(true)
        expect.soft(r.stepHint, 'el aviso de Aula explica el paso en la ventana').toBe(true)
      }
      failed = test.info().errors.length > 0
    } finally {
      await app.close().catch(() => undefined)
      if (r && run) report(r, run, fake, home, failed)
      else if (run) console.log(run.steps.join('\n'), '\n', fake.timeline(), '\n', platformLog(home))
      await fake.close()
    }
  })

  if (!sc.control) continue

  test(`control (ventana normal, sin Aula) · ${sc.name}`, async () => {
    const fake = await startFakeMoodleMicrosoft(sc.fake)
    const { app } = await launch()
    let failed = true
    let run: StudentRun | null = null
    let r: Result | null = null
    try {
      // una ventana normal de Electron, con una sesión en memoria propia y sin nada de Aula mirando
      const next = app.waitForEvent('window', { timeout: 15_000 })
      fake.mark('control: se abre una ventana normal')
      const t0 = fake.now()
      await app.evaluate(({ BrowserWindow }, url) => {
        const w = new BrowserWindow({ width: 1000, height: 760, show: true, webPreferences: { partition: `control-${Date.now()}`, contextIsolation: true, sandbox: true } })
        void w.loadURL(url)
      }, fake.moodleURL)
      const win = await next
      run = await student(win, { ...(sc.plan ?? {}), untilDashboard: true }, fake)
      r = {
        scenario: sc.name, mode: 'control', outcome: run.outcome, signedIn: null, usernamePages: run.usernamePages,
        seconds: Math.round((fake.now() - t0) / 100) / 10, windowClosedAt: null, stepHint: run.stepHint, ...(run.idpError ? { idpError: run.idpError } : {}), ...fake.summary()
      }
      expect.soft(r.outcome, 'el estudiante llega al Área personal').toBe('dashboard')
      expect.soft(r.staleSubmits).toBe(0)
      expect.soft(r.loopErrors).toBe(0)
      failed = test.info().errors.length > 0
    } finally {
      await app.close().catch(() => undefined)
      if (r && run) report(r, run, fake, null, failed)
      await fake.close()
    }
  })
}

// MARK: Política nueva con la sesión iniciada

test('Aula · política nueva: los cursos lo explican, la comprobación no lo tapa y la ventana espera a que se acepte', async () => {
  test.setTimeout(180_000)
  await withAula(FORCED, async ({ fake, app, page }) => {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
    const from = fake.now()
    // 1) entra como siempre
    const run1 = await student(await openSignIn(app, page, acc.id), {}, fake)
    expect(run1.outcome).toBe('window-closed')
    await waitView(page, acc.id, signedIn)
    expect(await invoke<unknown[]>(page, 'platforms.courses', { accountId: acc.id })).toHaveLength(1)

    // 2) Moodle publica otra versión de la política: los cursos fallan y lo explican (no «la sesión se cerró»)
    fake.publishPolicy()
    const failure = await invoke<unknown[]>(page, 'platforms.courses', { accountId: acc.id }).then(() => 'sin error', (e: unknown) => String(e))
    expect(failure).toMatch(POLICY_TEXT)
    let v = await waitView(page, acc.id, (x) => x.status === 'needsSignIn')
    expect(v.statusDetail ?? '').toMatch(POLICY_TEXT)

    // 3) una comprobación mira la página: core_session_touch (que funciona con la política pendiente) diría «iniciada»
    const touches = fake.summary().touches
    v = await invoke<View>(page, 'platforms.check', { accountId: acc.id })
    expect(v.status).toBe('needsSignIn')
    expect(v.statusDetail ?? '').toMatch(POLICY_TEXT)
    expect(fake.summary().touches, 'sin el atajo core_session_touch mientras hay un paso pendiente').toBe(touches)

    // 4) «Iniciar sesión»: la ventana va a la política y espera; el estudiante la cierra sin aceptar
    const win2 = await openSignIn(app, page, acc.id)
    const run2 = await student(win2, { closeOnPolicy: true }, fake, { close: () => closeWindow(app, win2) })
    expect(run2.outcome).toBe('closed-by-student')
    expect(run2.stepHint, 'el aviso de Aula explica el paso').toBe(true)
    v = await waitView(page, acc.id, (x) => !x.signingIn)
    expect(v.status).toBe('needsSignIn')
    expect(v.statusDetail ?? '').toMatch(POLICY_TEXT)
    expect(fake.policyAgreed()).toBe(false)

    // 5) vuelve, la lee y la acepta: la ventana se cierra sola DESPUÉS de aceptarla
    const win3 = await openSignIn(app, page, acc.id)
    const closed3 = closedAt(win3, fake)
    const run3 = await student(win3, { policyReadMs: 4000 }, fake)
    expect(run3.outcome).toBe('window-closed')
    expect(run3.stepHint).toBe(true)
    const s = fake.summary(from)
    expect(s.policyAcceptedAt).not.toBeNull()
    expect(closed3() ?? 0).toBeGreaterThanOrEqual(s.policyAcceptedAt ?? Infinity)
    await waitView(page, acc.id, signedIn)
    expect(await invoke<unknown[]>(page, 'platforms.courses', { accountId: acc.id })).toHaveLength(1)
    expect(s.logouts).toBe(0)
    expect(fake.summary().authorizeBackground, 'ni el alta ni la comprobación de fondo empiezan un acceso de Microsoft').toBe(0)
  })
})

// MARK: Llaves de acceso

test('Aula · llave de acceso (passkey) en Microsoft: no se queda colgada, se puede volver a intentar y Aula lo explica', async () => {
  test.setTimeout(180_000)
  await withAula({ ...FORCED, passkey: true, passkeyTimeoutMs: 8000 }, async ({ fake, app, page, home }) => {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
    const win = await openSignIn(app, page, acc.id)
    await win.locator('body[data-fake="ms-username"] #passkey-get').waitFor({ timeout: 20_000 })

    /** Pulsa un botón de llave de acceso de la página y espera a que la petición termine (12 s como mucho). */
    const passkey = async (button: '#passkey-get' | '#passkey-create', timeoutMs?: number): Promise<{ name: string; ms: number }> => {
      const out = win.locator('#passkey-result')
      await out.evaluate((el) => { el.textContent = '' })
      const b = win.locator(button)
      // sin `timeoutMs`, el tope que la página pide por defecto
      await b.evaluate((el, t) => (t ? el.setAttribute('data-timeout', String(t)) : el.removeAttribute('data-timeout')), timeoutMs ?? 0)
      fake.mark(`estudiante: pulsa ${button}${timeoutMs ? ` (la página pide ${timeoutMs} ms)` : ''}`)
      await b.click()
      await expect.poll(async () => (await out.textContent()) ?? '', { timeout: 13_000, intervals: [250] }).toMatch(/^\w+: (?!pending)\w+ \d+$/)
      const m = /^\w+: (\w+) (\d+)$/.exec((await out.textContent()) ?? '')
      fake.mark(`la página recibe: ${m?.[1]} en ${m?.[2]} ms`)
      return { name: m?.[1] ?? '', ms: Number(m?.[2] ?? NaN) }
    }

    // 1) en macOS y Linux Electron no tiene interfaz de llaves de acceso: el tope de Aula (10 s) corta aunque la página pida 60 s
    const noUI = process.platform !== 'win32'
    const first = await passkey('#passkey-get', noUI ? 60_000 : undefined)
    expect(first.name, 'la petición acaba como si el estudiante cancelara').toBe('NotAllowedError')
    expect(first.ms).toBeLessThanOrEqual(12_000)
    const marker = await win.evaluate(() => (globalThis as unknown as { document: { documentElement: { getAttribute(n: string): string | null } } }).document.documentElement.getAttribute('data-aula-passkey'))
    // sin interfaz siempre la corta Aula; en Windows también puede acabar antes por sí sola (y entonces no hay aviso:
    // cancelar Windows Hello no es «las llaves de acceso no funcionan aquí»)
    if (noUI) expect(marker).toBe('failed')
    else expect(['asked', 'failed']).toContain(marker)
    const cutByAula = marker === 'failed'
    // el aviso de Aula, arriba en la página de Microsoft
    const hint = win.locator('[data-aula-hint="passkey"]')
    if (noUI || cutByAula) {
      await expect(hint).toHaveCount(1, { timeout: 6000 })
      await expect(hint).toContainText(/passkey/i)
    }

    // 2) otra vez: nunca «A request is already pending»
    const again = await passkey('#passkey-get')
    expect(again.name).toBe('NotAllowedError')
    expect(again.ms).toBeLessThanOrEqual(12_000)

    // 3) crear una llave de acceso (lo que Microsoft propone tras el doble factor): igual
    const created = await passkey('#passkey-create')
    expect(created.name).toBe('NotAllowedError')
    expect(created.ms).toBeLessThanOrEqual(12_000)

    // 4) una petición condicional (autocompletar) no se toca: la página la sigue pudiendo cancelar
    const conditional = await win.evaluate(async () => {
      interface Creds { get(o: unknown): Promise<unknown> }
      const g = globalThis as unknown as { navigator: { credentials: Creds }; AbortController: new () => { signal: unknown; abort(): void } }
      const ctl = new g.AbortController()
      const t0 = Date.now()
      const p = g.navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), timeout: 60_000, allowCredentials: [] }, mediation: 'conditional', signal: ctl.signal })
      setTimeout(() => ctl.abort(), 500)
      const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 5000))
      return Promise.race([p.then(() => 'resolved', (e: unknown) => `${(e as { name?: string }).name ?? '?'} ${Date.now() - t0}`), timeout])
    })
    expect(conditional).toMatch(/^AbortError /)
    if (noUI || cutByAula) expect(platformLog(home)).toMatch(/pidió una llave de acceso/)

    // 5) el estudiante elige otra forma (contraseña) y entra: la ventana se cierra sola
    const run = await student(win, {}, fake)
    expect(run.outcome).toBe('window-closed')
    await waitView(page, acc.id, signedIn)
    expect(fake.summary().authorizeBackground).toBe(0)
  })
})

// MARK: «Ya has iniciado sesión»

test('Aula · «Ya has iniciado sesión»: dirección pegada de /login/index.php con la sesión de Moodle viva', async () => {
  await withAula({ auth: 'oauth2' }, async ({ fake, app, page }) => {
    const acc = await invoke<View>(page, 'platforms.add', { url: `${fake.moodleURL}login/index.php`, kind: 'moodle' })
    // se guarda la raíz de Moodle, no la página de acceso
    expect(acc.baseURL).toBe(fake.moodleURL)
    // la sesión de Moodle sigue viva en la sesión de la cuenta (el estudiante entró antes)
    const sid = fake.authedSession()
    await app.evaluate(async ({ session }, a) => {
      await session.fromPartition(`persist:platform-${a.id}`).cookies.set({ url: a.url, name: 'MoodleSession', value: a.sid, path: '/', httpOnly: true, sameSite: 'lax' })
    }, { id: acc.id, url: fake.moodleURL, sid })

    // 1) la ventana empieza en la raíz (no en /login/index.php: su botón cerraría la sesión) y se cierra sola
    const from1 = fake.now()
    const win1 = await openSignIn(app, page, acc.id)
    await expect.poll(() => win1.isClosed(), { timeout: 15_000 }).toBe(true)
    const navs = fake.requests.filter((r) => r.t >= from1 && r.site === 'moodle' && r.mode === 'navigate')
    expect(navs[0]?.path).toBe('/')
    expect(navs.some((r) => r.path === '/login/index.php')).toBe(false)
    await waitView(page, acc.id, signedIn)

    // 2) la ventana acaba en /login/index.php con la sesión viva («Ya has iniciado sesión»), como si un enlace la llevara allí
    // (no tiene barra de direcciones): Aula lo reconoce y la cierra sola, sin que nadie pulse su botón (cerraría la sesión).
    // La portada se retiene para que esa página llegue antes que el Área personal.
    fake.set({ holdFrontMs: 8000 })
    const from2 = fake.now()
    const next = openSignIn(app, page, acc.id)
    await expect.poll(() => fake.requests.some((r) => r.t >= from2 && r.site === 'moodle' && r.mode === 'navigate' && r.path === '/'), { timeout: 10_000 }).toBe(true)
    fake.mark('un enlace lleva la ventana a la página de acceso de Moodle')
    const moved = await app.evaluate(({ BrowserWindow }, url) => {
      // la de acceso aún tiene su título inicial («Inicia sesión · …» / «Sign in · …»): la portada no ha llegado
      const w = BrowserWindow.getAllWindows().find((x) => /^(Inicia sesión|Sign in) · /.test(x.getTitle()))
      if (!w) return false
      void w.webContents.loadURL(url).catch(() => undefined)
      return true
    }, `${fake.moodleURL}login/index.php`)
    expect(moved).toBe(true)
    const win2 = await next
    const run = await student(win2, { maxMs: 20_000 }, fake)
    fake.set({ holdFrontMs: 0 })
    expect(fake.requests.some((r) => r.t >= from2 && r.site === 'moodle' && r.mode === 'navigate' && r.path === '/my/'), 'la ventana no pasó por el Área personal').toBe(false)
    expect(run.steps.some((s) => s.includes('«Ya has iniciado sesión»')), 'la ventana mostró «Ya has iniciado sesión»').toBe(true)
    expect(run.outcome, 'Aula la cierra sola').toBe('window-closed')
    expect(fake.summary().logouts, 'nadie cerró la sesión').toBe(0)
    await waitView(page, acc.id, signedIn)
  })
})

// MARK: Moodle en otro host del mismo sitio

test('Aula · Moodle en otro host del mismo sitio: la dirección guardada era la del portal', async () => {
  await withAula({ auth: 'oauth2', moodleHost: 'campus.uni.localhost', portalHost: 'uni.localhost' }, async ({ fake, app, page, home }) => {
    const portalURL = fake.portalURL ?? ''
    const acc = await invoke<View>(page, 'platforms.add', { url: portalURL, kind: 'moodle' })
    // el sondeo no ve ningún Moodle en el portal: se queda su dirección
    expect(acc.baseURL).toBe(portalURL)
    const win = await openSignIn(app, page, acc.id)
    const run = await student(win, {}, fake)
    expect(run.outcome, 'la ventana se cierra sola en el Moodle del campus').toBe('window-closed')
    const v = await waitView(page, acc.id, signedIn)
    // desde ahora la cuenta usa la raíz del Moodle de verdad
    expect(v.baseURL).toBe(fake.moodleURL)
    expect(platformLog(home)).toMatch(/otro host del mismo sitio/)
    expect(await invoke<unknown[]>(page, 'platforms.courses', { accountId: acc.id })).toHaveLength(1)
    expect(fake.summary().authorizeBackground).toBe(0)
  })
})

// MARK: Errores de Microsoft Entra

for (const variant of [
  {
    name: 'acceso condicional (AADSTS53003)', code: 'AADSTS53003', hint: 'device',
    fake: { ...FORCED, authorizeError: 'AADSTS53003: Access has been blocked by Conditional Access policies. The access policy does not allow token issuance.' }
  },
  { name: 'bucle cortado por Microsoft (AADSTS50196)', code: 'AADSTS50196', hint: 'loop', fake: { ...FORCED, loopLimit: 0 } }
]) {
  test(`Aula · Microsoft muestra ${variant.name}: Aula lo explica en la ventana`, async () => {
    await withAula(variant.fake, async ({ fake, app, page, home }) => {
      const acc = await invoke<View>(page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
      const win = await openSignIn(app, page, acc.id)
      await win.locator('body[data-fake="ms-error"]').waitFor({ timeout: 20_000 })
      const hint = win.locator(`[data-aula-hint="${variant.hint}"]`)
      await expect(hint).toHaveCount(1, { timeout: 8000 })
      await expect(hint).toBeVisible()
      expect(platformLog(home)).toContain(`Microsoft muestra ${variant.code}`)
      await closeWindow(app, win)
      const v = await waitView(page, acc.id, (x) => !x.signingIn)
      expect(v.status).not.toBe('signedIn')
    })
  })
}

// MARK: La guarda de destinos

test('Aula · la guarda corta el paso de Microsoft (DNS de un proxy «fake-IP»): la ventana lo explica en vez de quedarse en blanco', async () => {
  await withAula({ ...FORCED, msHost: 'login.idp.test' }, async ({ fake, app, page, home }) => {
    const acc = await invoke<View>(page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
    // la sesión de la cuenta resuelve el host del proveedor a 198.18.0.7, como un proxy o una VPN en modo «fake-IP»
    await app.evaluate(({ session }, a) => {
      const ses = session.fromPartition(`persist:platform-${a.id}`)
      const real = ses.resolveHost.bind(ses)
      const fakeIP: typeof ses.resolveHost = (host, opts) =>
        host === a.host ? Promise.resolve({ endpoints: [{ address: '198.18.0.7', family: 'ipv4' as const }] }) : real(host, opts)
      Object.defineProperty(ses, 'resolveHost', { configurable: true, writable: true, value: fakeIP })
    }, { id: acc.id, host: 'login.idp.test' })
    const win = await openSignIn(app, page, acc.id)
    // la guarda NO se relaja: la página de Microsoft no carga; en su lugar, una página local de Aula que lo explica
    await expect.poll(() => win.url(), { timeout: 20_000 }).toMatch(/^data:text\/html/)
    await expect(win.locator('body')).toContainText('login.idp.test')
    await expect(win.locator('body')).toContainText(/fake-IP/i)
    expect(platformLog(home)).toMatch(/la guarda cortó login\.idp\.test/)
    expect(fake.requests.some((r) => r.site === 'ms'), 'ninguna petición llegó al proveedor').toBe(false)
    await closeWindow(app, win)
    await waitView(page, acc.id, (x) => !x.signingIn)
  })
})

// MARK: Reinicio

// Vuelve tras reiniciar Aula: la sesión de Moodle caducó en el servidor y la de Microsoft sigue viva (o no). Aula repone las
// cookies al arrancar; su comprobación de fondo no entra en el SSO y la reentrada sin ventana recupera la sesión sin bucles.
for (const variant of [
  { name: 'form_post · Microsoft viva', fake: FORCED, msAlive: true },
  { name: 'form_post · Microsoft caducada', fake: FORCED, msAlive: false }
]) {
  test(`Aula · reinicio · ${variant.name}`, async () => {
    const fake = await startFakeMoodleMicrosoft(variant.fake)
    const first = await launch()
    let failed = true
    let from = 0
    let second: Awaited<ReturnType<typeof launch>> | null = null
    try {
      const acc = await invoke<View>(first.page, 'platforms.add', { url: fake.moodleURL, kind: 'moodle' })
      const win = await openSignIn(first.app, first.page, acc.id)
      const run1 = await student(win, {}, fake)
      expect(run1.outcome).toBe('window-closed')
      await first.app.close()
      fake.expireMoodleSessions()
      if (!variant.msAlive) fake.expireMicrosoftSessions()
      from = fake.now()
      fake.mark('Aula vuelve a arrancar (misma carpeta de datos)')
      second = await launch({ home: first.home })
      // lo que hace Aula sola al arrancar (comprobación de fondo, reentrada sin ventana)
      let v: View | undefined
      const until = Date.now() + 30_000
      while (Date.now() < until) {
        v = await view(second.page, acc.id)
        if (v && (v.status === 'signedIn' || v.status === 'needsSignIn') && fake.now() - from > 8000) break
        await sleep(500)
      }
      fake.mark(`estado tras arrancar: ${v?.status}`)
      const s = fake.summary(from)
      const r = { scenario: `reinicio · ${variant.name}`, mode: 'aula', status: v?.status, ...s }
      console.log(`RESULT ${JSON.stringify(r)}`)
      if (process.env.AULA_E2E_RESULTS) appendFileSync(process.env.AULA_E2E_RESULTS, JSON.stringify(r) + '\n')
      expect.soft(s.staleSubmits).toBe(0)
      expect.soft(s.loopErrors).toBe(0)
      expect.soft(fake.summary().authorizeBackground, 'ni el alta ni la comprobación de fondo entran en el SSO').toBe(0)
      expect.soft(v?.status, variant.msAlive ? 'con Microsoft viva, Aula recupera la sesión sola' : 'sin Microsoft, hay que iniciar sesión').toBe(variant.msAlive ? 'signedIn' : 'needsSignIn')
      failed = test.info().errors.length > 0
    } finally {
      await second?.app.close().catch(() => undefined)
      await first.app.close().catch(() => undefined)
      if (process.env.AULA_E2E_LOG || failed) {
        console.log(`--- reinicio · ${variant.name}: peticiones y sucesos desde el arranque\n${fake.timeline(from)}`)
        console.log(`--- registro de Aula\n${platformLog(first.home)}`)
      }
      await fake.close()
    }
  })
}
