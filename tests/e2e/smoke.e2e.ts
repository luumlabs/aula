import { test, expect } from 'playwright/test'
import { launch } from './helpers'

test('arranca, muestra Inicio y navega por las secciones principales', async () => {
  const { app, page } = await launch()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const nav = page.locator('nav[aria-label="Aula"]')
  await expect(nav).toBeVisible()
  for (const name of ['Courses', 'Calendar', 'Aula']) {
    await nav.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(300)
  }
  for (const name of ['Statistics', 'Tools', 'Documents', 'Inbox']) {
    await page.getByRole('button', { name: 'More sections', exact: true }).first().click()
    await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click()
    await page.waitForTimeout(300)
  }
  await nav.getByRole('button', { name: 'Today', exact: true }).click()
  await page.waitForTimeout(300)
  expect(errors).toEqual([])
  await app.close()
})
