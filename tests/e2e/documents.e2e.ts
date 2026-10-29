// Documentos con la app real (IA simulada, ventana oculta). En la captura del vídeo, «Crear documento» se abría sobre el curso
// actualizado más recientemente (uno de Historia, solo con texto): la guía salía, pero la chuleta, las tarjetas y el examen
// daban «Couldn't prepare the document» (ese curso no tiene fórmulas, tarjetas ni ejercicios). Y Aula en el lector, con la IA
// simulada, contestaba «Simulated reply from Aula.» a todo.
import { test, expect, type ElectronApplication, type Page } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { go, homeWithDemoCourse } from './helpers'

const TRIG = 'exam-2-math112'

/** El curso de ejemplo y otro solo con texto (sin fórmulas, glosario, tarjetas ni ejercicios), el más reciente de los dos. */
function home(): string {
  const h = homeWithDemoCourse()
  writeFileSync(join(h, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', name: 'Maya' } }))
  const dir = join(h, 'Packs', 'world-history')
  cpSync(join(h, 'Packs', TRIG), dir, { recursive: true })
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({ ...pack, id: 'world-history', title: 'World History', formulaSheet: [], glossary: [], blueprint: null, sources: [], updated: '2099-01-01T00:00:00.000Z' }))
  for (const name of readdirSync(join(dir, 'skills'))) {
    const file = join(dir, 'skills', name)
    const skill = JSON.parse(readFileSync(file, 'utf8')) as { lesson: { type: string }[] }
    writeFileSync(file, JSON.stringify({ ...skill, lesson: skill.lesson.filter((b) => b.type === 'text'), exercises: [], templates: [], cards: [], decks: [], mistakes: [] }))
  }
  return h
}

/** Como en las capturas: oculta, con el llavero simulado y la IA simulada. */
async function start(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), '--no-sandbox', '--use-mock-keychain'],
    env: { ...process.env, AULA_HOME: home(), AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1' }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula, null, { timeout: 15_000 })
  return { app, page }
}

type Invoke = { aula: { invoke(m: string, a?: unknown): Promise<{ ok: boolean; value?: Record<string, unknown>; error?: { message: string } }> } }

test('Crear documento: lo que el curso no tiene sale apagado, y varias vistas previas seguidas salen', async () => {
  test.setTimeout(180_000)
  const { app, page } = await start()
  await go(page, { name: 'documents' })
  await page.getByRole('button', { name: 'Create document' }).first().click()
  const dialog = page.getByRole('dialog')
  const kind = (name: string) => dialog.getByRole('button', { name: new RegExp(`^${name}`) })
  const preview = async (): Promise<string> => {
    const preparing = dialog.getByText('Aula is preparing the document…')
    await preparing.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
    await expect(preparing).toBeHidden({ timeout: 60_000 })
    await expect(dialog.getByText('Couldn’t prepare the document')).toHaveCount(0)
    await expect(dialog.locator('img')).toBeVisible()
    return (await dialog.locator('.mr-auto').textContent()) ?? ''
  }

  // se abre sobre el curso más reciente, el de solo texto: la guía sale y lo que no tiene se ve apagado, con el motivo
  await expect(dialog.locator('[data-aula-select]').first()).toHaveText(/World History/)
  expect(await preview()).toMatch(/\d+ pages?/)
  for (const name of ['Cheat sheet', 'Printable flashcards', 'Practice exam']) await expect(kind(name)).toHaveAttribute('aria-disabled', 'true')
  await expect(kind('Practice exam')).toContainText('exercises for the exam')
  await expect(kind('Study guide')).not.toHaveAttribute('aria-disabled', 'true')
  await kind('Practice exam').click({ force: true })
  await expect(kind('Practice exam')).toHaveAttribute('aria-pressed', 'false')
  await expect(dialog.getByText('Couldn’t prepare the document')).toHaveCount(0)

  // con el curso de trigonometría salen todos, uno detrás de otro (la misma ventana de impresión)
  await dialog.locator('[data-aula-select]').first().click()
  await page.getByRole('option', { name: /Exam #2/ }).click()
  await expect(kind('Cheat sheet')).not.toHaveAttribute('aria-disabled', 'true')
  const pages: string[] = []
  for (const name of ['Cheat sheet', 'Printable flashcards', 'Practice exam', 'Study guide']) {
    await kind(name).click()
    await expect(kind(name)).toHaveAttribute('aria-pressed', 'true')
    pages.push(await preview())
  }
  expect(pages.every((p) => /\d+ pages?/.test(p))).toBe(true)
  await app.close()
})

test('Aula en el lector responde con la IA simulada: con el texto del documento y la página citada', async () => {
  test.setTimeout(120_000)
  const { app, page } = await start()
  await go(page, { name: 'documents', doc: `source:${TRIG}:exam-2-review` })
  await page.locator('button[title="Ask Aula about this document"]').click()
  await page.getByText('Summarize this page').click()
  const answer = page.locator('.aula-answer').last()
  await expect(answer).toContainText('Exam 2 covers chapters 3 and 4', { timeout: 15_000 })
  await expect(answer).toContainText('Arc length and sector area')
  // la página citada, para ir a ella
  await expect(page.getByRole('button', { name: 'p. 1', exact: true })).toBeVisible()
  // la cita «(p. N)» dentro de la respuesta es un enlace de verdad, y lo atiende el panel (no cambia la dirección de la app)
  const cite = answer.locator('a[href^="#aula-page-"]').first()
  await expect(cite).toBeVisible()
  await cite.click()
  expect(await page.evaluate<string>('location.hash')).toBe('')
  await expect(page.getByText('Simulated reply from Aula.')).toHaveCount(0)
  await page.getByText('What’s on the exam?').click()
  await expect(page.locator('.aula-answer').last()).toContainText('Most likely on the exam', { timeout: 15_000 })
  await app.close()
})

test('Aula en el lector: una respuesta que llega antes que el id de su petición no deja el panel esperando', async () => {
  test.setTimeout(120_000)
  const { app, page } = await start()
  const saved = await page.evaluate(async (course) => {
    const { aula } = globalThis as unknown as Invoke
    return (await aula.invoke('documents.save', { request: { kind: 'cheatsheet', courseID: course, format: 'pdf' }, target: 'course' })).value?.savedId
  }, TRIG)
  expect(saved).toBeTruthy()
  const ref = { kind: 'saved', packId: TRIG, savedId: saved }
  await go(page, { name: 'documents', doc: `saved:${TRIG}:${saved}` })
  await page.locator('button[title="Ask Aula about this document"]').click()
  await expect(page.getByText('Summarize this page')).toBeVisible()
  // el documento desaparece con el lector abierto: el error sale en el acto, antes que la respuesta con el id de la petición
  await page.evaluate(async (r) => { await (globalThis as unknown as Invoke).aula.invoke('documents.remove', { ref: r }) }, ref)
  await page.getByText('Summarize this page').click()
  await expect(page.getByText('Aula couldn’t answer')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Reading the document…')).toHaveCount(0)
  await app.close()
})
