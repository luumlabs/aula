// La paleta ⌘K: lo que coincide va antes que «Pregúntale a Aula», y busca dentro de los cursos (curso de ejemplo real).
import { test, expect } from 'playwright/test'
import { homeWithDemoCourse, launch } from './helpers'

test('⌘K: «calend» + Intro abre el calendario; «reference angle» encuentra el término y abre la referencia', async () => {
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const input = page.locator('[cmdk-input]')
  const selected = page.locator('[cmdk-item][data-selected="true"]')

  await page.keyboard.press('Control+k')
  await input.fill('calend')
  await expect(selected).toContainText('Calendar')
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.locator('nav[aria-label="Aula"] [aria-current="page"]')).toContainText('Calendar')

  await page.keyboard.press('Control+k')
  await input.fill('reference angle')
  await expect(page.getByText('In your courses')).toBeVisible()
  await expect(selected).toContainText('Reference angle')
  await expect(selected).toContainText('Glossary')
  await expect(selected.locator('mark').first()).toBeVisible()
  // preguntar a Aula sigue ahí, al final
  await expect(page.locator('[cmdk-item]').last()).toContainText('reference angle')
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.getByText('Glossary').first()).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})
