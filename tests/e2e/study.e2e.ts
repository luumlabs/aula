// Estudiar con el curso de ejemplo real: repasar tarjetas guarda el progreso en disco; editar el curso cambia su nombre en
// la barra lateral y en pack.json; las estadísticas y el inicio leen datos reales.
import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch, readJSON } from './helpers'

const PACK = 'exam-2-math112'

test('repasar una tarjeta (girar y valorar) guarda el progreso', async () => {
  const home = homeWithDemoCourse()
  const { app, page } = await launch({ home })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'cards' })
  await expect(page.getByRole('button', { name: /Flip/ })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Good/ })).toBeVisible()
  await page.getByRole('button', { name: /Good/ }).click()
  // el envío al proceso principal va por lotes (~600 ms)
  await expect
    .poll(() => Object.keys(readJSON<{ cards?: Record<string, unknown> }>(join(home, 'Packs', PACK, 'progress.json')).cards ?? {}).length, { timeout: 10_000 })
    .toBeGreaterThan(0)
  expect(errors).toEqual([])
  await app.close()
})

test('editar el nombre del curso lo cambia en la barra lateral y en disco', async () => {
  const home = homeWithDemoCourse()
  const { app, page } = await launch({ home })
  await go(page, { name: 'course', id: PACK })
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByText('Edit', { exact: true }).click()
  const name = page.getByLabel('Name')
  await name.fill('Trigonometría · Parcial 2')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('nav[aria-label="Aula"]').getByText('Trigonometría · Parcial 2')).toBeVisible()
  expect(readJSON<{ title: string }>(join(home, 'Packs', PACK, 'pack.json')).title).toBe('Trigonometría · Parcial 2')
  await app.close()
})

test('inicio, curso y estadísticas se abren con el curso real sin errores', async () => {
  const home = homeWithDemoCourse()
  const { app, page } = await launch({ home })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.getByText(/Today’s plan|Today's plan/)).toBeVisible()
  for (const tab of ['overview', 'learn', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference']) {
    await go(page, { name: 'course', id: PACK, tab })
  }
  await go(page, { name: 'stats' })
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  await go(page, { name: 'study', id: PACK, mode: 'exam' })
  await expect(page.getByText(/Mock exam/).first()).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('el tema oscuro se aplica y se guarda', async () => {
  const { app, page, home } = await launch()
  await go(page, { name: 'settings' })
  await page.getByRole('button', { name: /Dark/ }).first().click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect.poll(() => readJSON<{ general: { theme: string } }>(join(home, 'settings.json')).general.theme).toBe('dark')
  await app.close()
})
