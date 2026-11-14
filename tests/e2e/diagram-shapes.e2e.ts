// Diagramas en la app real: cada paso de un proceso rodea a pluma lo que señala (y ← → / Esc lo recorren), los pasos de una
// forma con `build` la van construyendo y las formas ya hechas (pirámide, Venn, mapa mental) marcan cada parte para poder
// preguntarle al tutor por ella. Usa la página de desarrollo de los bloques visuales.
import { test, expect, type Locator, type Page } from 'playwright/test'
import { go, launch } from './helpers'

/** Opacidad calculada de la parte `id` de la figura titulada `title` (la de su caja HTML). */
const opacityOf = (page: Page, title: string, id: string): Promise<string> =>
  page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(`section[aria-label="${title}"] div[data-ask-part="${id}"]`)}); return el ? getComputedStyle(el).opacity : '' })()`)

/** La página de desarrollo no se desplaza sola: se le deja para llegar a cada ejemplo. */
async function section(page: Page, title: string): Promise<Locator> {
  await page.evaluate(`document.querySelectorAll('.screen-layer').forEach((e) => { e.style.overflowY = 'auto' })`)
  const s = page.locator(`section[aria-label="${title}"]`).first()
  await s.scrollIntoViewIfNeeded()
  return s
}
const rings = (s: Locator): Locator => s.locator('svg.ink[style*="pigment-brick"]')

test('un proceso rodea lo que señala cada paso; ← → cambian de paso y Esc enseña todo', async () => {
  const { app, page } = await launch()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'visual-preview' })
  const s = await section(page, 'Fases de la mitosis')
  await expect(rings(s)).toHaveCount(0)
  await s.getByRole('button', { name: /Watch the process|Ver el proceso/ }).click()
  await expect(rings(s)).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(s.getByText(/Step 2 of 5|Paso 2 de 5/)).toBeVisible()
  await expect(rings(s)).toHaveCount(1)
  await page.keyboard.press('ArrowLeft')
  await expect(s.getByText(/Step 1 of 5|Paso 1 de 5/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(rings(s)).toHaveCount(0)
  await expect(s.getByRole('button', { name: /Show all|Ver todo/ })).toHaveCount(0)
  // con la barra de pasos enfocada (se pulsa o se arrastra), Esc también enseña todo (no sigue hasta la lección)
  const scrubber = s.getByRole('slider')
  await scrubber.click()
  await expect(s.getByRole('button', { name: /Show all|Ver todo/ })).toHaveCount(1)
  await expect(scrubber).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(rings(s)).toHaveCount(0)
  await expect(s.getByRole('button', { name: /Show all|Ver todo/ })).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})

test('formas ya hechas: la pirámide se construye paso a paso y cada parte se puede señalar', async () => {
  const { app, page } = await launch()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'visual-preview' })
  const pyr = await section(page, 'Jerarquía normativa (Kelsen)')
  for (const id of ['ce', 'lo', 'ld', 'rd', 'om']) await expect(pyr.locator(`div[data-ask-part="${id}"]`)).toHaveCount(1)
  await pyr.getByRole('button', { name: /Watch the process|Ver el proceso/ }).click()
  // el primer paso solo ha sacado la cúspide: lo demás no se ve ni se puede señalar (no da pistas de lo que viene)
  const opacity = (id: string): Promise<string> => opacityOf(page, 'Jerarquía normativa (Kelsen)', id)
  await expect.poll(() => opacity('ce')).toBe('1')
  await expect(pyr.locator('[data-ask-part="om"]')).toHaveCount(0)
  await expect(pyr.getByText('Órdenes ministeriales')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect.poll(() => opacity('om')).toBe('1')
  await expect(pyr.getByText('Órdenes ministeriales')).toBeVisible()
  const venn = await section(page, 'Mitosis y meiosis')
  await expect(venn.locator('[data-ask-part="region:mi&me"]')).toHaveAttribute('data-ask-label', /Mitosis (y|and) Meiosis/)
  const mind = await section(page, 'La célula de un vistazo')
  await expect(mind.locator('div[data-ask-part="mit"]')).toHaveCount(1)
  expect(errors).toEqual([])
  await app.close()
})
