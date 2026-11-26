// La paleta ⌘K: sin escribir, primero lo de estudiar; lo que coincide va antes que «Pregúntale a Aula», y busca dentro de los
// cursos (curso de ejemplo real).
import { test, expect } from 'playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

test('⌘K sin escribir: lo primero es seguir con el plan de hoy; las acciones de estudio llevan al curso del examen', async () => {
  // en inglés, sea cual sea el idioma del equipo
  const home = homeWithDemoCourse()
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en' } }))
  const { app, page } = await launch({ home })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const input = page.locator('[cmdk-input]')
  const selected = page.locator('[cmdk-item][data-selected="true"]')
  const course = page.locator('main').getByText('Exam #2 · MATH 101').first()
  await expect(course).toBeVisible()

  await page.keyboard.press('Control+k')
  await expect(page.locator('[cmdk-item]').first()).toContainText('Continue today’s plan')
  await expect(selected).toContainText('Continue today’s plan')
  await expect(page.locator('[cmdk-group-heading]').first()).toHaveText('Study')
  // la apariencia va al final
  await expect(page.locator('[cmdk-group-heading]').last()).toHaveText('Appearance')

  // el simulacro del curso, escribiendo
  await input.fill('mock exam')
  await expect(selected).toContainText('Mock exam: Exam #2 · MATH 101')
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.locator('[data-screen="study"][data-active="true"]')).toBeVisible()

  // repasar abre el curso
  await page.keyboard.press('Control+k')
  await input.fill('review')
  await expect(selected).toContainText('Review Exam #2 · MATH 101')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-screen="course"][data-active="true"]')).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})
