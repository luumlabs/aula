// Los arreglos de J2 de punta a punta: ⌘K encuentra las herramientas; «Detener» deja la respuesta como interrumpida con
// «Continuar»; borrar una conversación se puede deshacer; y «Responder» desde Novedades abre un chat con el texto listo y lo
// que se envía se ve.
import { test, expect } from 'playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

test('⌘K encuentra las herramientas desde cualquier pantalla (J2-6)', async () => {
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'home' })
  const input = page.locator('[cmdk-input]')
  const selected = page.locator('[cmdk-item][data-selected="true"]')
  for (const [q, name] of [['pomodoro', 'Study timer'], ['periodic table', 'Periodic table'], ['calculator', 'Calculator']]) {
    await page.keyboard.press('Control+k')
    await input.fill(q)
    await expect(selected).toContainText(name)
    await page.keyboard.press('Escape')
  }
  await page.keyboard.press('Control+k')
  await input.fill('grapher')
  await page.keyboard.press('Enter')
  await expect(page.getByText('All tools')).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('«Detener» a mitad: la respuesta queda interrumpida con «Continuar»; borrar la conversación se deshace (J2-3, J2-4)', async () => {
  test.setTimeout(120_000)
  const { app, page, home } = await launch({ home: homeWithDemoCourse(), env: { AULA_FAKE_AI_DELAY_MS: '250' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('Why is cos 210° negative?')
  await box.press('Enter')
  // en cuanto empieza a escribir el texto (no solo a pensar), se detiene
  await expect(page.locator('[data-role="assistant"][data-phase="writing"]').first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText('Reply interrupted')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()

  // borrar: desaparece al momento y «Deshacer» la devuelve
  const list = page.locator('.group').filter({ hasText: 'Why is cos 210° negative?' }).first()
  await list.hover()
  await list.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByText(/Deleted “/)).toBeVisible()
  await expect(page.locator('.group').filter({ hasText: 'Why is cos 210° negative?' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.group').filter({ hasText: 'Why is cos 210° negative?' }).first()).toBeVisible()
  const threads = join(home, 'Assistant', 'threads')
  const count = () => (existsSync(threads) ? readdirSync(threads).filter((n) => n.endsWith('.json') && !n.startsWith('.')).length : 0)
  expect(count()).toBe(1)
  // y si no se deshace, se borra de verdad (con sus adjuntos) cuando pasa el aviso
  await list.hover()
  await list.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  expect(count()).toBe(1)
  await expect.poll(count, { timeout: 15_000 }).toBe(0)
  expect(errors).toEqual([])
  await app.close()
})

test('«Responder» desde Novedades abre el chat con el texto listo y lo enviado se ve (J2-5)', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse(), env: { AULA_SEED: 'demo' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'inbox' })
  await page.getByText(/1 new assignment/).first().click()
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click()
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await expect(box).toHaveValue(/^About “1 new assignment/)
  await box.press('End')
  await box.pressSequentially('what do I need first?')
  await box.press('Enter')
  await expect(page.locator('[data-role="user"]').filter({ hasText: 'what do I need first?' }).first()).toBeVisible()
  await expect(page.getByText('How can I help?')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})
