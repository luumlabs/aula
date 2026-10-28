import { test, expect } from 'playwright/test'
import { launch } from './helpers'

test('arranca, muestra Inicio y navega por las secciones principales', async () => {
  const { app, page } = await launch()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('nav[aria-label="Aula"]')).toBeVisible()
  for (const name of ['Calendar', 'Statistics', 'Tools', 'Documents', 'Inbox', 'Today']) {
    await page.getByRole('button', { name, exact: true }).first().click()
    await page.waitForTimeout(400)
  }
  expect(errors).toEqual([])
  await app.close()
})
