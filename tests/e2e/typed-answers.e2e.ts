// Respuestas escritas con el curso de ejemplo real: la corta crece y admite varias líneas (Mayús+Intro, lo pegado), Intro
// la comprueba como siempre y, si está mal, se tacha renglón a renglón (también con renglones en los dos sentidos); vacía,
// un texto de ejemplo largo no la hace crecer. Las de números siguen en una línea.
import { test, expect } from 'playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

const PACK = 'exam-2-math112'

/** Una carpeta con el curso de ejemplo en la que el tema `skill` solo tiene el ejercicio `id` (con su respuesta cambiada por
 *  `patch`, si hace falta): su práctica empieza por él. */
function homeWithOnly(skill: string, id: string, patch?: (answer: Record<string, unknown>) => void): string {
  const home = homeWithDemoCourse()
  const path = join(home, 'Packs', PACK, 'skills', `${skill}.json`)
  const s = JSON.parse(readFileSync(path, 'utf8')) as { exercises: { id: string; answer: Record<string, unknown> }[]; templates: unknown[] }
  s.exercises = s.exercises.filter((e) => e.id === id)
  if (patch) patch(s.exercises[0].answer)
  s.templates = []
  writeFileSync(path, JSON.stringify(s))
  return home
}

type Box = { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number; style: { overflowY: string } }
/** `getComputedStyle` de la página (estas pruebas se compilan sin los tipos del DOM). */
type Styles = { getComputedStyle: (el: unknown, pseudo?: string) => { whiteSpace: string } }

test('respuesta corta: Mayús+Intro hace un salto de línea, Intro comprueba y lo escrito en dos líneas se tacha renglón a renglón', async () => {
  // «csc 180°»: «undefined», «does not exist»…
  const { app, page } = await launch({ home: homeWithOnly('exact-trig-values', 'etv-e6') })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'exact-trig-values' })
  const field = page.locator('main textarea[data-answer-field]')
  await expect(field).toBeVisible()
  await expect(field).toHaveAttribute('aria-multiline', 'true')
  await expect(page.locator('main input[data-answer-field]')).toHaveCount(0)
  const one = (await field.boundingBox())!.height

  await field.click()
  await field.pressSequentially('it is')
  await field.press('Shift+Enter')
  await field.pressSequentially('zero')
  await expect(field).toHaveValue('it is\nzero')
  // el salto de línea no comprueba, y el campo crece con la segunda línea
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')
  expect((await field.boundingBox())!.height).toBeGreaterThan(one + 15)

  // Intro comprueba (sin añadir otra línea): mal, tachado con un trazo por renglón
  await field.press('Enter')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveValue('it is\nzero')
  await expect(page.locator('main [data-struck-lines] .ink-strike')).toHaveCount(2)

  // lo pegado conserva sus saltos de línea (y, sin Intro, no comprueba); el tachado se va al cambiar lo escrito
  await field.fill('')
  await page.keyboard.insertText('does not\nexist')
  await expect(field).toHaveValue('does not\nexist')
  await expect(page.locator('main [data-struck-lines]')).toHaveCount(0)
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')

  // ⌘/Ctrl+Intro también comprueba: bien (el salto cuenta como un espacio) y el campo queda cerrado. Antes, la pausa de
  // alguien que escribe: un Intro a menos de 350 ms del anterior no cuenta (useExercise: un doble Intro no se salta el resultado)
  await page.waitForTimeout(400)
  await field.press('ControlOrMeta+Enter')
  await expect(field).toHaveAttribute('readonly', '')
  await expect(field).toHaveValue('does not\nexist')
  expect(errors).toEqual([])
  await app.close()
})

test('respuesta corta en un teléfono (375 px): cabe, crece cuando la respuesta se parte y, pasadas seis líneas, se desplaza por dentro', async () => {
  const { app, page } = await launch({ home: homeWithOnly('exact-trig-values', 'etv-e6') })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 375, height: 812 })
  await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'exact-trig-values' })
  const field = page.locator('main textarea[data-answer-field]')
  await expect(field).toBeVisible()
  const start = (await field.boundingBox())!
  expect(start.x).toBeGreaterThanOrEqual(0)
  expect(start.x + start.width).toBeLessThanOrEqual(375)

  // una frase larga se parte en varias líneas: el campo crece, sin desplazarse de lado
  await field.fill('the cosecant of one hundred eighty degrees does not exist, because the sine there is zero')
  expect((await field.boundingBox())!.height).toBeGreaterThan(start.height + 15)
  const wide = await field.evaluate((el) => { const b = el as unknown as Box; return b.scrollWidth - b.clientWidth })
  expect(wide).toBeLessThanOrEqual(0)

  // nueve líneas: se queda en unas seis y lo demás se desplaza dentro del campo
  await field.fill(Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n'))
  const tall = await field.evaluate((el) => { const b = el as unknown as Box; return { sh: b.scrollHeight, ch: b.clientHeight, oy: b.style.overflowY } })
  expect(tall.sh).toBeGreaterThan(tall.ch)
  expect(tall.oy).toBe('auto')
  expect((await field.boundingBox())!.height).toBeLessThan(start.height + 6 * 24)
  expect(errors).toEqual([])
  await app.close()
})

test('respuesta corta con un texto de ejemplo largo (375 px): el campo vacío se queda en una línea y no salta al escribir ni al borrar', async () => {
  const placeholder = 'Write the exact value as a number, or the word “undefined” if it does not exist'
  const { app, page } = await launch({ home: homeWithOnly('exact-trig-values', 'etv-e6', (a) => { a.placeholder = placeholder }) })
  await page.setViewportSize({ width: 375, height: 812 })
  await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'exact-trig-values' })
  const field = page.locator('main textarea[data-answer-field]')
  await expect(field).toHaveAttribute('placeholder', placeholder)
  const height = async (): Promise<number> => (await field.boundingBox())!.height
  // el de una línea mide 3rem (48 px con el texto a su tamaño)
  const empty = await height()
  expect(empty).toBeLessThan(50)
  // el texto de ejemplo, en una sola línea (cortado), como en el campo de una línea
  expect(await field.evaluate((el) => (globalThis as unknown as Styles).getComputedStyle(el, '::placeholder').whiteSpace)).toBe('nowrap')
  await field.click()
  await field.pressSequentially('a')
  expect(await height()).toBeCloseTo(empty, 0)
  await field.press('Backspace')
  await expect(field).toHaveValue('')
  expect(await height()).toBeCloseTo(empty, 0)
  await app.close()
})

test('respuesta corta con renglones en los dos sentidos (árabe y latín): cada trazo del tachado cae sobre su renglón', async () => {
  const { app, page } = await launch({ home: homeWithOnly('exact-trig-values', 'etv-e6') })
  await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'exact-trig-values' })
  const field = page.locator('main textarea[data-answer-field]')
  const strokes = page.locator('main [data-struck-lines] .ink-strike')
  await expect(field).toBeVisible()
  // el campo coloca cada renglón según su primera letra: el árabe a la derecha, el latín a la izquierda
  const check = async (answer: string): Promise<{ left: number; right: number }[]> => {
    await field.fill(answer)
    await page.waitForTimeout(400)
    await field.press('Enter')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(strokes).toHaveCount(2)
    const box = (await field.boundingBox())!
    const rows: { left: number; right: number }[] = []
    for (const s of await strokes.all()) {
      const b = (await s.boundingBox())!
      rows.push({ left: b.x - box.x, right: box.x + box.width - (b.x + b.width) })
    }
    return rows
  }
  // borde (1 px) y relleno (16 px) del campo: el trazo empieza o acaba ahí, no en medio
  const near = 30
  const [ar, en] = await check('ماء\nwater is H2O')
  expect(ar.right).toBeLessThan(near)
  expect(en.left).toBeLessThan(near)
  expect(en.right).toBeGreaterThan(near)
  const [en2, ar2] = await check('water is H2O\nماء')
  expect(en2.left).toBeLessThan(near)
  expect(ar2.right).toBeLessThan(near)
  expect(ar2.left).toBeGreaterThan(near)
  await app.close()
})

test('respuesta numérica: sigue en una línea e Intro comprueba, como siempre', async () => {
  // «3π/4 en grados» (135)
  const { app, page } = await launch({ home: homeWithOnly('degree-radian-conversion', 'drc-e2') })
  await go(page, { name: 'study', id: PACK, mode: 'practice', skill: 'degree-radian-conversion' })
  const field = page.locator('main input[data-answer-field]')
  await expect(field).toBeVisible()
  await expect(page.locator('main textarea[data-answer-field]')).toHaveCount(0)
  await field.fill('135')
  await field.press('Enter')
  await expect(field).toHaveAttribute('readonly', '')
  await app.close()
})
