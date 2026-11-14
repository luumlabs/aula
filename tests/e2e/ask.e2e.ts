// «Marcar y preguntar al tutor» y el recorrido guiado de las figuras, con la app real: se rodea una parte de una figura de
// la lección, se pregunta y el tutor recibe el nombre de la parte; con el teclado también; en el simulacro no se ofrece.
import { test, expect, type Page } from 'playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

const PACK = 'exam-2-math112'

const CELL = {
  id: 'ask-cell', type: 'labeled', title: 'Animal cell', alt: 'A diagram of an animal cell', labels: 'auto', practice: true,
  drawing: {
    width: 600, height: 400,
    items: [
      { kind: 'ellipse', cx: 300, cy: 200, rx: 272, ry: 176, stroke: 'brown', fill: 'amber', opacity: 0.08, width: 2.5 },
      { kind: 'circle', cx: 300, cy: 190, r: 72, stroke: 'plum', fill: 'plum', opacity: 0.14, width: 2 },
      { kind: 'ellipse', cx: 140, cy: 160, rx: 46, ry: 20, stroke: 'terracotta', fill: 'terracotta', opacity: 0.18, width: 1.8 }
    ]
  },
  parts: [
    { id: 'mem', name: 'Plasma membrane', x: 0.06, y: 0.62 },
    { id: 'nuc', name: 'Nucleus', x: 0.5, y: 0.475, r: 0.12 },
    { id: 'mit', name: 'Mitochondrion', x: 0.233, y: 0.4, rect: [0.155, 0.34, 0.156, 0.12] },
    { id: 'cyt', name: 'Cytoplasm', x: 0.7, y: 0.7 }
  ],
  steps: [
    { title: 'The boundary', md: 'The membrane wraps the cell.', parts: ['mem'] },
    { title: 'The control centre', md: 'The nucleus keeps the DNA.', parts: ['nuc'] },
    { title: 'Energy', md: 'Mitochondria make ATP.', parts: ['mit', 'nuc'] }
  ]
}
const DIAGRAM = { id: 'ask-diagram', type: 'diagram', kind: 'flow', title: 'Quadrants', nodes: [{ id: 'a', label: 'Angle' }, { id: 'b', label: 'Reference angle' }], edges: [{ from: 'a', to: 'b' }] }

/** El curso de ejemplo con la figura al principio de la primera lección y un diagrama en el enunciado de cada ejercicio. */
function homeWithFigures(): string {
  const home = homeWithDemoCourse()
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const f of readdirSync(skills)) {
    const p = join(skills, f)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (s.id === 'reference-angles') s.lesson = [CELL, ...s.lesson]
    for (const e of s.exercises ?? []) e.prompt = [DIAGRAM, ...(e.prompt ?? [])]
    writeFileSync(p, JSON.stringify(s))
  }
  const prog = join(home, 'Packs', PACK, 'progress.json')
  const pr = JSON.parse(readFileSync(prog, 'utf8'))
  pr.settings = { ...(pr.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(prog, JSON.stringify(pr))
  return home
}

/** Un lazo a mano alrededor de un punto de la figura (fracciones de lo que se amplía). */
async function loop(page: Page, cell: ReturnType<Page['locator']>, fx: number, fy: number, rxf: number, ryf: number): Promise<void> {
  const fig = (await cell.locator('[data-ask-surface]').boundingBox())!
  const cx = fig.x + fig.width * fx, cy = fig.y + fig.height * fy
  const rx = fig.width * rxf, ry = fig.height * ryf
  await page.mouse.move(cx + rx, cy - ry * 0.4)
  await page.mouse.down()
  for (let i = 0; i <= 36; i++) {
    const a = -0.4 - (i / 36) * Math.PI * 2.15
    await page.mouse.move(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, { steps: 2 })
  }
  await page.mouse.up()
}

test('recorrido guiado: cada paso rodea sus partes a pluma; → avanza y Esc vuelve a la figura entera', async () => {
  const { app, page } = await launch({ home: homeWithFigures() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  const cell = page.locator('[data-block="labeled"]').first()
  await cell.getByRole('button', { name: 'Tour the figure' }).click()
  await expect(cell.getByText('The membrane wraps the cell.')).toBeVisible()
  // un lazo por parte del paso (el primero rodea una)
  await expect(cell.locator('[data-ask-surface] .ink')).toHaveCount(1)
  await cell.getByRole('button', { name: 'Next step' }).click()
  await expect(cell.getByText('The nucleus keeps the DNA.')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(cell.getByText('Mitochondria make ATP.')).toBeVisible()
  await expect(cell.locator('[data-ask-surface] .ink')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(cell.getByRole('button', { name: 'Tour the figure' })).toBeVisible()
  await expect(cell.locator('[data-ask-surface] .ink')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})

test('marcar una parte de la figura y preguntar: el tutor recibe su nombre y la pregunta', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithFigures() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  const cell = page.locator('[data-block="labeled"]').first()
  await cell.getByRole('button', { name: 'Mark and ask the tutor' }).click()
  await expect(cell.locator('[data-ask-overlay]')).toBeFocused()
  // con el ratón: un lazo alrededor de la mitocondria
  await loop(page, cell, 0.233, 0.4, 0.11, 0.11)
  await expect(cell.locator('[data-ask-bar]').getByText('Mitochondrion', { exact: true })).toBeVisible()
  // con el teclado: → elige una parte (en orden de lectura: mitocondria, núcleo, membrana…) e Intro la rodea
  await cell.locator('[data-ask-overlay]').focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(cell.locator('[data-ask-layer]').getByText('Plasma membrane', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(cell.locator('[data-ask-bar]').getByText('Plasma membrane', { exact: true })).toBeVisible()
  // ⌘Z / Ctrl+Z deshace el último
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(cell.locator('[data-ask-bar]').getByText('Plasma membrane', { exact: true })).toHaveCount(0)
  // con zoom (Ctrl + rueda), la marca sigue a la figura: el mismo sitio en fracciones de lo que se amplía
  const where = async (): Promise<[number, number]> => {
    const s = (await cell.locator('[data-ask-surface]').boundingBox())!
    const m = (await cell.locator('[data-ask-layer] svg path[d^="M"]').first().boundingBox())!
    return [(m.x + m.width / 2 - s.x) / s.width, (m.y + m.height / 2 - s.y) / s.height]
  }
  const before = await where()
  const view = (await cell.locator('[data-ask-overlay]').boundingBox())!
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await expect(cell.getByRole('button', { name: 'Fit to view' })).not.toHaveText(/^100\s?%$/)
  await page.waitForTimeout(300)
  const after = await where()
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.02)
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.02)
  await cell.getByPlaceholder('What would you like to know about what you marked?').fill('What does this part do?')
  await cell.getByRole('button', { name: 'Ask the tutor', exact: true }).click()
  await expect(page.getByText('Your tutor')).toBeVisible()
  const sent = page.locator('[data-role="user"]').filter({ hasText: 'What does this part do?' })
  await expect(sent).toBeVisible()
  await expect(sent).toContainText('“Mitochondrion”')
  await expect(sent).toContainText('“Animal cell”')
  // la barra se cierra y las marcas se desvanecen
  await expect(cell.locator('[data-ask-bar]')).toHaveCount(0)
  await expect(cell.locator('[data-ask-layer] path[d^="M"]')).toHaveCount(0, { timeout: 5_000 })
  await expect.poll(async () => page.locator('[data-role="assistant"]').count(), { timeout: 60_000 }).toBeGreaterThan(0)
  expect(errors).toEqual([])
  await app.close()
})

test('Esc cierra el modo de marcar; en la práctica se ofrece y en el simulacro no', async () => {
  const { app, page } = await launch({ home: homeWithFigures() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'practice' })
  const figure = page.locator('[data-block="diagram"]').first()
  await expect(figure).toBeVisible()
  await figure.getByRole('button', { name: 'Mark and ask the tutor' }).click()
  await expect(figure.locator('[data-ask-overlay]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(figure.locator('[data-ask-overlay]')).toHaveCount(0)
  await go(page, { name: 'study', id: PACK, mode: 'exam' })
  await page.getByRole('button', { name: 'Start the mock exam' }).first().click()
  await expect(page.locator('[data-block="diagram"]').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark and ask the tutor' })).toHaveCount(0)
  await expect(page.locator('[data-ask-layer]')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})
