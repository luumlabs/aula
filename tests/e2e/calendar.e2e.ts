// El calendario sin el chat: añadir con la frase, abrir el evento, cambiarle el nombre y borrarlo; y un evento nuevo que
// se repite cada semana con «Nuevo evento». Comprueba lo que queda en `calendar.json`.
import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { go, launch, readJSON } from './helpers'

interface StoredEvent { id: string; title: string; recurrence?: string }
const stored = (home: string) => readJSON<{ events: StoredEvent[] }>(join(home, 'calendar.json')).events

test('añadir rápido → abrir → cambiar el nombre → borrar, y un evento nuevo que se repite', async () => {
  const { app, page, home } = await launch()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'calendar', view: 'agenda' })

  // añadir rápido
  const quick = page.getByRole('textbox', { name: 'Add' })
  await quick.fill('Repaso de química mañana a las 17')
  await quick.press('Enter')
  await expect(page.getByText('Added to the calendar').first()).toBeVisible()
  await expect.poll(() => stored(home).length).toBe(1)
  const title = stored(home)[0].title

  // abrir su hoja desde la agenda y cambiarle el nombre
  await page.getByRole('button', { name: `Open “${title}”` }).first().click()
  const name = page.getByRole('textbox', { name: 'Name' })
  await expect(name).toHaveValue(title)
  await name.fill('Repaso de química con Ana')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => stored(home)[0]?.title).toBe('Repaso de química con Ana')

  // y borrarlo
  await page.getByRole('button', { name: 'Open “Repaso de química con Ana”' }).first().click()
  await page.getByRole('button', { name: 'Delete…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => stored(home).length).toBe(0)
  await expect(page.getByRole('button', { name: 'Open “Repaso de química con Ana”' })).toHaveCount(0)

  // «Nuevo evento» que se repite cada semana
  await page.getByRole('button', { name: 'New event' }).first().click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Clase de física')
  await page.getByRole('radio', { name: 'Class' }).click()
  await page.getByRole('button', { name: 'Doesn’t repeat' }).click()
  await page.getByRole('option', { name: 'Every week, on…' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.poll(() => stored(home).find((e) => e.title === 'Clase de física')?.recurrence ?? '').toMatch(/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/)

  expect(errors).toEqual([])
  await app.close()
})
