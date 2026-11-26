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
  await expect(page.getByRole('heading', { name: 'Trigonometría · Parcial 2' })).toBeVisible()
  await page.getByRole('button', { name: 'More sections', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Expand sidebar' }).click()
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
  for (const tab of ['overview', 'learn', 'review', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference']) {
    await go(page, { name: 'course', id: PACK, tab })
  }
  await go(page, { name: 'stats' })
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  await go(page, { name: 'study', id: PACK, mode: 'exam' })
  await expect(page.getByText(/Mock exam/).first()).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('el curso en cinco pestañas: los ids viejos llevan a su sección, un botón principal por vista y el título una vez', async () => {
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const screen = '[data-screen="course"][data-active="true"]'
  await go(page, { name: 'course', id: PACK })
  await expect(page.locator(`${screen} [role="tablist"]`).first().getByRole('tab')).toHaveCount(5)
  // el título del curso sale una vez (su h1), no también en la barra de arriba
  await expect(page.locator('main').getByText('Exam #2 · MATH 101', { exact: true })).toHaveCount(1)
  for (const tab of ['overview', 'learn', 'review', 'exam', 'materials']) {
    await go(page, { name: 'course', id: PACK, tab })
    await page.waitForTimeout(500)
    const primary = await page.locator(`${screen} [data-variant="primary"]`).evaluateAll((els) => els.filter((e) => (e as unknown as { offsetParent: unknown }).offsetParent !== null).length)
    expect(primary, tab).toBeLessThanOrEqual(1)
  }
  // «cards» (de antes) abre Repasar con «Flashcards» a la vista; «reference», el apéndice de Aprender
  await go(page, { name: 'course', id: PACK, tab: 'cards' })
  await expect(page.locator(screen).getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator(`${screen} [data-course-section="cards"]`)).toBeInViewport()
  await go(page, { name: 'course', id: PACK, tab: 'mistakes' })
  await expect(page.locator(`${screen} [data-course-section="mistakes"]`)).toBeInViewport()
  await go(page, { name: 'course', id: PACK, tab: 'reference' })
  await expect(page.locator(screen).getByRole('tab', { name: 'Learn', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator(screen).getByText('Formula sheet and glossary')).toBeInViewport()
  // las cinco caben sin desplazarse a 1000 px
  await page.setViewportSize({ width: 1000, height: 680 })
  await go(page, { name: 'course', id: PACK })
  const fits = await page.locator(`${screen} [role="tablist"]`).first().evaluate((l) => { const box = l.parentElement as unknown as { scrollWidth: number; clientWidth: number }; return box.scrollWidth <= box.clientWidth + 1 })
  expect(fits).toBe(true)
  expect(errors).toEqual([])
  await app.close()
})

test('«Estudiar ahora» entra directamente en el primer paso del plan y salir vuelve a la agenda', async () => {
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  await go(page, { name: 'course', id: PACK })
  await page.getByRole('button', { name: 'Study now', exact: true }).click()
  // el primer paso del plan, sin pasar por la agenda
  const study = page.locator('[data-screen="study"][data-active="true"]')
  await expect(study.getByRole('button', { name: /^Exit/ })).toBeVisible()
  await expect(study.getByRole('heading', { name: /Today’s plan|Keep going/ })).toHaveCount(0)
  // salir (el primer Esc suelta el campo de la respuesta, si lo hay): a la agenda del plan
  await study.getByRole('button', { name: /^Exit/ }).click()
  await expect(study.getByRole('heading', { name: /Today’s plan|Keep going/ })).toBeVisible()
  await app.close()
})

test('«Empezar el repaso» no pisa el plan: salir vuelve a Repasar y «Estudiar ahora» sigue con los pasos de aprender', async () => {
  // con seis semanas de estudio simuladas hay tarjetas y errores que tocan hoy
  const { app, page } = await launch({ home: homeWithDemoCourse(), env: { AULA_SEED: 'demo' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const course = page.locator('[data-screen="course"][data-active="true"]')
  const study = page.locator('[data-screen="study"][data-active="true"]')
  // la cola de repaso, y salir de ella: de vuelta a Repasar (no a la agenda del plan)
  await go(page, { name: 'course', id: PACK, tab: 'review' })
  await course.getByRole('button', { name: 'Start reviewing', exact: true }).click()
  await expect(study.getByRole('button', { name: /^Exit/ })).toBeVisible()
  await study.getByRole('button', { name: /^Exit/ }).click()
  await expect(course.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: /Today’s plan|Keep going/ })).toHaveCount(0)
  // otra vez, y esta se deja por otra pantalla; después, «Estudiar ahora» → salir: la agenda es el plan entero
  await course.getByRole('button', { name: 'Start reviewing', exact: true }).click()
  await expect(study.getByRole('button', { name: /^Exit/ })).toBeVisible()
  await go(page, { name: 'home' })
  await go(page, { name: 'course', id: PACK })
  await course.getByRole('button', { name: 'Study now', exact: true }).click()
  await expect(study.getByRole('button', { name: /^Exit/ })).toBeVisible()
  await study.getByRole('button', { name: /^Exit/ }).click()
  await expect(study.getByRole('heading', { name: /Today’s plan|Keep going/ })).toBeVisible()
  await expect(study.getByText(/^Learn: /).first()).toBeVisible()
  await expect(study.getByText('Flashcard review', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('un fallo se corrige con el boli rojo: lo escrito tachado, el porqué al margen y «Try again» pegado debajo', async () => {
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  // un ejercicio del arco cuya respuesta exacta lleva π («Give the exact value»): se vuelve a entrar hasta que sale
  for (let i = 0; i < 14; i++) {
    await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'arc-length-sector-area' })
    if (await page.locator('main').getByText(/Give the exact value/).count()) break
    await go(page, { name: 'home' })
  }
  await expect(page.locator('main').getByText(/Give the exact value/).first()).toBeVisible()
  const input = page.locator('main input:visible').first()
  await input.fill('27')
  await input.press('Enter')
  await expect(page.locator('main input[aria-invalid="true"]')).toHaveCount(1)
  await expect(page.getByText('The exact answer has π in it.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain my mistake' })).toBeVisible()
  // «Try again» va justo debajo del ejercicio, no al fondo de la ventana
  const gap = await page.evaluate(`(() => {
    const ex = [...document.querySelectorAll('main [class*="rounded-[22px]"]')].find((e) => e.textContent.includes('Give the exact value'))
    const btn = [...document.querySelectorAll('main button')].find((b) => /^Try again/.test(b.textContent.trim()))
    return btn.getBoundingClientRect().top - ex.getBoundingClientRect().bottom
  })()`) as number
  expect(gap).toBeLessThan(120)
  // al escribir otra cosa, el tachado se va
  await input.fill('3')
  await expect(page.locator('main input[aria-invalid="true"]')).toHaveCount(0)
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
