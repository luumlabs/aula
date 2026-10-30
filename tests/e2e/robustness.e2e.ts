// Lo que la auditoría final (A3) encontró en los flujos del estudiante, con la app real: el tutor no se reabre ni repite su
// pregunta (A3-P1-1), «Conectar con ChatGPT» enseña en qué va y se puede cancelar (A3-P1-2), «Nuevo curso» no pierde lo escrito
// (A3-P1-3), un corte de red a mitad de respuesta deja «Continuar» (A3-P1-4), y varios P2 (tarjeta del curso del chat, resumen
// al rechazar, mensajes demasiado largos). Importar dos veces el mismo curso (J2-24) se prueba en store.test.ts.
import { test, expect, type Page } from 'playwright/test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { go, homeWithDemoCourse, launch, readJSON } from './helpers'

const PACK = 'exam-2-math112'
const englishHome = (home: string): string => {
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', name: 'Maya' } }))
  return home
}
/** La IA de verdad (no la simulada) sin encontrar las CLIs de quien pasa las pruebas: HOME temporal y PATH mínimo. */
const isolated = (): Record<string, string> => ({ AULA_FAKE_AI: '', HOME: mkdtempSync(join(tmpdir(), 'aula-e2e-h-')), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/sh' })

async function invoke<T = unknown>(page: Page, method: string, args?: unknown): Promise<T> {
  const r = await page.evaluate(([m, a]) => (globalThis as unknown as { aula: { invoke(m: string, a: unknown): Promise<unknown> } }).aula.invoke(m as string, a), [method, args] as const)
  const env = r as { ok: boolean; value?: T; error?: { message: string } }
  if (!env.ok) throw new Error(env.error?.message ?? 'rpc')
  return env.value as T
}

function tutorAsks(home: string): number {
  const dir = join(home, 'Packs', PACK, 'chats')
  if (!existsSync(dir)) return 0
  let n = 0
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('.'))) {
    const th = readJSON<{ messages: Array<{ role: string; text: string }> }>(join(dir, f))
    n += th.messages.filter((m) => m.role === 'user' && /Explain why my answer/.test(m.text)).length
  }
  return n
}

test('A3-P1-1: el tutor no se reabre en otras pantallas ni repite «Explain my mistake» (tampoco en el simulacro)', async () => {
  test.setTimeout(120_000)
  const home = englishHome(homeWithDemoCourse())
  const { app, page } = await launch({ home, env: { AULA_HIDDEN: '1' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'exact-trig-values' })
  await page.locator('main input:visible').first().click()
  await page.keyboard.type('1/2')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Explain my mistake' }).click()
  await expect(page.getByText('Your tutor')).toBeVisible()
  await expect.poll(() => tutorAsks(home), { timeout: 30_000 }).toBe(1)
  // sin cerrar el panel: a Inicio y después a otras pantallas de estudio
  await go(page, { name: 'home' })
  await expect(page.getByText('Your tutor')).toHaveCount(0)
  for (const r of [{ mode: 'cards' }, { mode: 'learn', skill: 'reference-angles' }, { mode: 'exam' }]) {
    await go(page, { name: 'study', id: PACK, ...r })
    await page.waitForTimeout(1500)
    await expect(page.getByText('Your tutor')).toHaveCount(0)
  }
  // ninguna pregunta repetida (cada una era una llamada de IA)
  expect(tutorAsks(home)).toBe(1)
  expect(errors).toEqual([])
  await app.close()
})

test('A3-P1-2: «Conectar con ChatGPT» dice en qué va, deja abrir otra vez la página y cancelar, y sigue igual al volver', async () => {
  // el Codex que instala Aula en Windows es codex.exe: con este guion falso, Aula no lo encontraría y descargaría el de verdad
  test.skip(process.platform === 'win32', 'necesita un codex.exe falso')
  test.setTimeout(90_000)
  const home = englishHome(mkdtempSync(join(tmpdir(), 'aula-e2e-')))
  // un Codex «ya instalado por Aula» que espera al navegador (nunca abre nada ni toca la red)
  const dir = join(home, 'tools', 'codex', '0.162.1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'codex'), [
    '#!/bin/sh',
    'case "$*" in',
    '  *"--version"*) echo "codex-cli 0.162.1"; exit 0 ;;',
    '  *"login status"*) echo "Not logged in" >&2; exit 1 ;;',
    '  *"login"*) echo "If your browser did not open, navigate to this URL to authenticate:" >&2; echo "" >&2;',
    '    echo "https://auth.openai.com/oauth/authorize?client_id=e2e&state=e2e" >&2; sleep 120; exit 1 ;;',
    '  *) exit 2 ;;',
    'esac', ''
  ].join('\n'))
  chmodSync(join(dir, 'codex'), 0o755)
  writeFileSync(join(dir, '.installed'), '0.162.1')
  const { app, page } = await launch({ home, env: { ...isolated(), AULA_HIDDEN: '1' } })
  await go(page, { name: 'settings', section: 'ai' })
  await page.getByRole('button', { name: 'Connect with ChatGPT' }).last().click()
  const panel = page.getByTestId('chatgpt-login')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Sign in to ChatGPT in your browser to finish')).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByRole('button', { name: 'Open the page again' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Sign in with a code instead' })).toBeVisible()
  // ir a otra pantalla y volver: sigue a la vista (antes el botón volvía a estar normal con el login vivo detrás)
  await go(page, { name: 'home' })
  await go(page, { name: 'settings', section: 'ai' })
  await expect(page.getByTestId('chatgpt-login').getByText('Sign in to ChatGPT in your browser to finish')).toBeVisible()
  await page.getByTestId('chatgpt-login').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('chatgpt-login')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Connect with ChatGPT' }).last()).toBeEnabled()
  await app.close()
})

test('A3-P1-3: «Nuevo curso» guarda el borrador al ir a otra pantalla y al cerrar Aula; «Descartar borrador» lo vacía', async () => {
  test.setTimeout(120_000)
  const home = englishHome(mkdtempSync(join(tmpdir(), 'aula-e2e-')))
  let { app, page } = await launch({ home, env: { AULA_HIDDEN: '1' } })
  await go(page, { name: 'create' })
  await page.getByPlaceholder(/Calculus I/).fill('Termodinámica · Parcial 1')
  await page.getByRole('button', { name: 'Paste text' }).click()
  await page.getByPlaceholder(/Paste notes/).fill('La primera ley: ΔU = Q − W. La entropía de un sistema aislado nunca disminuye.')
  await page.getByRole('button', { name: /Add this text/ }).click()
  await expect(page.locator('main').getByText(/La primera ley/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Paste text' }).click()
  await page.getByPlaceholder(/Paste notes/).fill('Notas aún sin añadir')
  // a Inicio y vuelta
  await go(page, { name: 'home' })
  await go(page, { name: 'create' })
  await expect(page.getByPlaceholder(/Calculus I/)).toHaveValue('Termodinámica · Parcial 1')
  await expect(page.locator('main').getByText(/La primera ley/).first()).toBeVisible()
  await expect(page.getByPlaceholder(/Paste notes/)).toHaveValue('Notas aún sin añadir')
  // cerrar Aula y volver a abrirla
  await app.close()
  ;({ app, page } = await launch({ home, env: { AULA_HIDDEN: '1' } }))
  await go(page, { name: 'create' })
  await expect(page.getByPlaceholder(/Calculus I/)).toHaveValue('Termodinámica · Parcial 1')
  await expect(page.locator('main').getByText(/La primera ley/).first()).toBeVisible()
  // empezar de cero
  await page.getByTestId('create-discard').click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByPlaceholder(/Calculus I/)).toHaveValue('')
  await expect(page.locator('main').getByText(/La primera ley/)).toHaveCount(0)
  await expect.poll(() => (existsSync(join(home, 'Drafts')) ? readdirSync(join(home, 'Drafts')).length : 0)).toBe(0)
  await app.close()
})

/** Un proveedor compatible con OpenAI en 127.0.0.1: en modo «cut» manda 3 trozos y corta el socket a mitad. */
async function fakeProvider(): Promise<{ url: string; mode: (m: 'cut' | 'ok') => void; close: () => Promise<void> }> {
  let mode: 'cut' | 'ok' = 'cut'
  const sockets = new Set<Socket>()
  const chunk = (text: string): string => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`
  const srv: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url?.includes('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); return }
      const json = JSON.parse(body || '{}') as { stream?: boolean }
      const text = mode === 'cut' ? 'A reference angle is the acute angle' : 'between the terminal side and the x-axis.'
      if (!json.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for (const w of text.split(/(?<= )/)) res.write(chunk(w))
      if (mode === 'cut') { setTimeout(() => res.socket?.destroy(), 300); return }
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`,
    mode: (m) => { mode = m },
    close: async () => { for (const s of sockets) s.destroy(); await new Promise((r) => srv.close(() => r(undefined))) }
  }
}

test('A3-P1-4: si la conexión se corta a mitad, la respuesta queda interrumpida en su burbuja con «Continue», que sigue', async () => {
  test.setTimeout(120_000)
  const fake = await fakeProvider()
  const home = englishHome(mkdtempSync(join(tmpdir(), 'aula-e2e-')))
  const { app, page } = await launch({ home, env: { ...isolated(), AULA_HIDDEN: '1' } })
  try {
    await invoke(page, 'ai.configure', { providerId: 'custom', baseURL: fake.url, model: 'test-model', activate: true })
    await go(page, { name: 'chat' })
    const box = page.getByRole('textbox', { name: 'Message Aula…' })
    await box.fill('What is a reference angle?')
    await box.press('Enter')
    const reply = page.locator('[data-role="assistant"]')
    await expect(reply.first().getByText('Reply interrupted')).toBeVisible({ timeout: 60_000 })
    // una sola burbuja: lo que llegó, el motivo dentro y «Continue» (ni parece terminada ni sale otra que culpe a la red)
    await expect(reply).toHaveCount(1)
    await expect(reply.first()).toContainText('A reference angle')
    await expect(reply.first()).toContainText('The connection dropped partway through the reply')
    await expect(page.getByText('Couldn’t reply')).toHaveCount(0)
    fake.mode('ok')
    await reply.first().getByRole('button', { name: 'Continue' }).click()
    // «Continue» sigue en una burbuja nueva (la última); se mira dentro de ella porque la lista de conversaciones repite
    // el final de la respuesta como vista previa
    await expect(reply.last()).toContainText('between the terminal side', { timeout: 60_000 })
    await expect(page.getByText('Reply interrupted')).toHaveCount(0)
  } finally {
    await app.close()
    await fake.close()
  }
})

test('A3-P2-7: un mensaje de más de 100 000 caracteres no se envía ni se pierde, y se explica en inglés', async () => {
  test.setTimeout(90_000)
  const home = englishHome(homeWithDemoCourse())
  const { app, page } = await launch({ home, env: { AULA_HIDDEN: '1' } })
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  const huge = 'x'.repeat(120_000)
  await box.fill(huge)
  await expect(page.getByTestId('chat-too-long')).toContainText('Too long to send')
  await box.press('Enter')
  await page.waitForTimeout(800)
  // sigue en la caja y no salió ningún mensaje
  expect((await box.inputValue()).length).toBe(120_000)
  await expect(page.locator('[data-role="user"]')).toHaveCount(0)
  // el proceso principal también lo rechaza, en el idioma de la interfaz
  const th = await invoke<{ id: string }>(page, 'chat.newThread')
  const err = await invoke(page, 'chat.send', { threadId: th.id, text: huge }).then(() => '', (e: Error) => e.message)
  expect(err).toContain('That message is too long')
  await app.close()
})

test('A3-P2-5 / A3-P2-6: la tarjeta del curso del chat llega a «Ready to study» y rechazar un permiso no cuenta como hecho', async () => {
  test.setTimeout(180_000)
  const home = englishHome(homeWithDemoCourse())
  const { app, page } = await launch({ home, env: { AULA_HIDDEN: '1', AULA_FAKE_TEAM_DELAY_MS: '20' } })
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  // rechazar apuntar un examen: el resumen no dice que cambió el calendario
  await box.fill('I have an English test on Monday at 10')
  await box.press('Enter')
  const deny = page.getByRole('button', { name: /^(No|Don’t add|Not now|Deny)$/ }).first()
  await deny.click({ timeout: 60_000 })
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('[data-testid="chat-activity"]').last()).not.toContainText(/made a change|changed your calendar/i)
  // un curso desde el chat: la tarjeta sigue la creación hasta el final
  await page.getByRole('button', { name: /New conversation/ }).first().click()
  await box.fill('Make me a course on photosynthesis')
  await box.press('Enter')
  await page.getByRole('button', { name: /^Create the course$/ }).first().click({ timeout: 60_000 })
  const card = page.getByTestId('chat-course-card').last()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card).toHaveAttribute('data-status', 'ready', { timeout: 150_000 })
  await expect(card).toContainText('Ready to study')
  await expect(card).not.toContainText('Starting')
  await app.close()
})
