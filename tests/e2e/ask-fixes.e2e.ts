// «Marcar y preguntar» con la app real, lo que la revisión encontró: la capa de marcar queda encima de la figura también
// cuando el bloque ya estaba cargado (la segunda vez que se abre una lección); el botón «Marcar» de la figura, pulsado, cierra
// sin dejar una marca; una nota se cierra al pulsar en otro sitio y la siguiente funciona; espacio e Intro no pasan de página
// mientras se marca; en «Señálalo» y «Arrastra» no se ofrece; una figura del enunciado de un ejercicio le dice al tutor qué
// ejercicio es; y lo que se lee del DOM de cada bloque (una estructura con grupos marca en su pozo, no en el bloque entero; una
// ruta de un mapa y una flecha de un dibujo son su línea, no su caja; un nodo por salir de una construcción no cuenta).
import { test, expect, type Locator, type Page } from 'playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  ]
}
const DIAGRAM = { id: 'ask-diagram', type: 'diagram', kind: 'flow', title: 'Quadrants', nodes: [{ id: 'a', label: 'Angle' }, { id: 'b', label: 'Reference angle' }], edges: [{ from: 'a', to: 'b' }] }

/** El curso de ejemplo con la célula al principio de la primera lección (y una segunda página) y un diagrama en cada enunciado. */
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

/** Un lazo a mano alrededor de un punto de la figura (fracciones de lo que se amplía, o del lienzo si no hay). */
async function loop(page: Page, fig: Locator, fx: number, fy: number, rxf: number, ryf: number): Promise<void> {
  const b = (await fig.boundingBox())!
  const cx = b.x + b.width * fx, cy = b.y + b.height * fy
  const rx = b.width * rxf, ry = b.height * ryf
  await page.mouse.move(cx + rx, cy - ry * 0.4)
  await page.mouse.down()
  for (let i = 0; i <= 36; i++) {
    const a = -0.4 - (i / 36) * Math.PI * 2.15
    await page.mouse.move(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, { steps: 2 })
  }
  await page.mouse.up()
}

/** ¿La capa de marcar es lo último del lienzo (así se pinta y se pulsa encima de la figura)? */
const layerIsLast = (cell: Locator): Promise<boolean> =>
  cell.locator('[data-ask-canvas]').evaluate((c) => c.lastElementChild?.hasAttribute('data-ask-layer') === true)

test('la figura ya cargada: la capa va encima, se marca con el ratón, espacio no pasa de página, las notas y el botón de la figura', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithFigures() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  await expect(page.locator('[data-block="labeled"]').first()).toBeVisible()
  // fuera y otra vez dentro: el bloque ya está cargado y se monta de una vez con la capa
  await go(page, { name: 'home' })
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  const cell = page.locator('[data-block="labeled"]').first()
  await expect(cell).toBeVisible()
  const toggle = cell.locator('[data-ask-canvas]').getByRole('button', { name: 'Mark and ask the tutor' })
  await toggle.click()
  await expect(cell.locator('[data-ask-overlay]')).toBeFocused()
  expect(await layerIsLast(cell)).toBe(true)

  // con el ratón, sobre la figura: la marca llega a la capa (no a la figura de debajo)
  await loop(page, cell.locator('[data-ask-surface]'), 0.233, 0.4, 0.11, 0.11)
  await expect(cell.locator('[data-ask-bar]').getByText('Mitochondrion', { exact: true })).toBeVisible()

  // espacio e Intro sin parte elegida: la página no pasa y se sigue marcando
  await cell.locator('[data-ask-overlay]').focus()
  await page.keyboard.press(' ')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await expect(cell.locator('[data-ask-bar]')).toHaveCount(1)
  await expect(cell.locator('[data-ask-bar]').getByText('Mitochondrion', { exact: true })).toBeVisible()

  // dos notas seguidas: la primera se deja al pulsar en otro sitio y la segunda también se escribe
  await cell.locator('[data-ask-bar]').getByRole('tab', { name: 'Note' }).click()
  const view = (await cell.locator('[data-ask-overlay]').boundingBox())!
  await page.mouse.click(view.x + view.width * 0.3, view.y + view.height * 0.75)
  await expect(cell.getByRole('textbox', { name: 'Note' })).toBeFocused()
  await page.keyboard.type('first note')
  await page.mouse.click(view.x + view.width * 0.6, view.y + view.height * 0.85)
  await expect(cell.locator('[data-ask-layer]').getByText('first note', { exact: true })).toBeVisible()
  await expect(cell.getByRole('textbox', { name: 'Note' })).toBeFocused()
  await expect(cell.getByRole('textbox', { name: 'Note' })).toHaveValue('')
  await page.keyboard.type('second note')
  await page.keyboard.press('Enter')
  await expect(cell.locator('[data-ask-layer]').getByText('second note', { exact: true })).toBeVisible()
  await expect(cell.getByRole('textbox', { name: 'Note' })).toHaveCount(0)

  // el botón «Marcar» de la figura, pulsado, deja de marcar (sin una marca de más debajo)
  const marks = await cell.locator('[data-ask-layer] svg path[d^="M"]').count()
  await toggle.click()
  await expect(cell.locator('[data-ask-overlay]')).toHaveCount(0)
  expect(await cell.locator('[data-ask-layer] svg path[d^="M"]').count()).toBeLessThanOrEqual(marks)

  // en «Señálalo» y «Arrastra» no se ofrece (la práctica no chiva nombres); al volver a explorar, sí
  await cell.getByRole('tab', { name: 'Find it' }).click()
  await expect(cell.getByRole('button', { name: 'Mark and ask the tutor' })).toHaveCount(0)
  await cell.getByRole('tab', { name: 'Drag' }).click()
  await expect(cell.getByRole('button', { name: 'Mark and ask the tutor' })).toHaveCount(0)
  await cell.getByRole('tab', { name: 'Explore' }).click()
  await expect(cell.getByRole('button', { name: 'Mark and ask the tutor' })).toHaveCount(1)
  expect(errors).toEqual([])
  await app.close()
})

test('una figura del enunciado de un ejercicio: el tutor recibe qué ejercicio es y que está sin resolver', async () => {
  test.setTimeout(120_000)
  const { app, page, home } = await launch({ home: homeWithFigures() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'practice' })
  const figure = page.locator('[data-block="diagram"]').first()
  await expect(figure).toBeVisible()
  await figure.getByRole('button', { name: 'Mark and ask the tutor' }).click()
  await expect(figure.locator('[data-ask-overlay]')).toBeFocused()
  // con el teclado: la primera parte, rodeada
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(figure.locator('[data-ask-bar]').getByText('Angle', { exact: true })).toBeVisible()
  await figure.getByPlaceholder('What would you like to know about what you marked?').fill('What is this?')
  await figure.getByRole('button', { name: 'Ask the tutor', exact: true }).click()
  await expect(page.locator('[data-role="user"]').filter({ hasText: 'What is this?' })).toBeVisible()
  // en el hilo del tutor, el mensaje lleva el ejercicio (no solo la figura)
  const chats = join(home, 'Packs', PACK, 'chats')
  await expect.poll(() => {
    if (!existsSync(chats)) return null
    for (const f of readdirSync(chats).filter((x) => x.endsWith('.json'))) {
      const thread = JSON.parse(readFileSync(join(chats, f), 'utf8')) as { messages?: Array<{ text?: string; context?: Record<string, unknown> }> }
      const m = thread.messages?.find((x) => x.text?.startsWith('What is this?'))
      if (m?.context) return { block: m.context.blockID, exercise: typeof m.context.exerciseID === 'string', result: m.context.lastResult, screen: m.context.screen }
    }
    return null
  }, { timeout: 30_000 }).toEqual({ block: 'ask-diagram', exercise: true, result: 'not solved yet', screen: 'practice' })
  expect(errors).toEqual([])
  await app.close()
})

const STRUCTURE = { id: 'ask-structure', type: 'structure', title: 'Ethanol', smiles: 'CCO', groups: [{ atoms: [3], label: 'hydroxyl' }, { atoms: [1, 2], label: 'ethyl' }] }
// la ruta en diagonal pasa lejos de Grecia, pero su caja la cubre
const MAP = { id: 'ask-map', type: 'map', title: 'Journey', practice: false, countries: ['Greece'], routes: [{ points: [[38.7, -9.1], [55.7, 37.6]], label: 'Lisbon to Moscow' }] }
const BUILD = {
  id: 'ask-build', type: 'diagram', kind: 'flow', direction: 'tb', title: 'Build', build: true,
  nodes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
  steps: [{ title: 'One', md: 'one', nodes: ['a'] }, { title: 'Two', md: 'two', nodes: ['b'] }, { title: 'Three', md: 'three', nodes: ['c'] }]
}
// la pelota cae dentro de la caja de la flecha (menos de un cuarto del lienzo: un objeto, no una zona) y lejos de su línea
const DRAWING = {
  id: 'ask-drawing', type: 'drawing', width: 400, height: 300, title: 'Forces',
  items: [{ kind: 'arrow', id: 'force', x1: 150, y1: 250, x2: 350, y2: 110, name: 'Force' }, { kind: 'circle', id: 'ball', cx: 310, cy: 225, r: 14, fill: 'accent', name: 'Ball' }]
}
const FIRST_IN: Record<string, unknown> = { 'amplitude-period-phase': STRUCTURE, 'arc-length-sector-area': MAP, 'degree-radian-conversion': BUILD, 'exact-trig-values': DRAWING }

/** El curso de ejemplo con una figura al principio de cuatro lecciones (en modo lectura). */
function homeWithBlocks(): string {
  const home = homeWithDemoCourse()
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const f of readdirSync(skills)) {
    const p = join(skills, f)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (FIRST_IN[s.id]) s.lesson = [FIRST_IN[s.id], ...s.lesson]
    writeFileSync(p, JSON.stringify(s))
  }
  const prog = join(home, 'Packs', PACK, 'progress.json')
  const pr = JSON.parse(readFileSync(prog, 'utf8'))
  pr.settings = { ...(pr.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(prog, JSON.stringify(pr))
  return home
}

/** Un trazo de pluma por unos puntos de la pantalla. */
async function stroke(page: Page, pts: Array<[number, number]>): Promise<void> {
  await page.mouse.move(pts[0][0], pts[0][1])
  await page.mouse.down()
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.up()
}

/** Abre la lección y «Marcar» en su primer bloque del tipo dado. */
async function markIn(page: Page, skill: string, type: string): Promise<Locator> {
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill })
  const block = page.locator(`[data-block="${type}"]`).first()
  await expect(block).toBeVisible()
  await block.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  await block.getByRole('button', { name: 'Mark and ask the tutor' }).first().click()
  await expect(block.locator('[data-ask-overlay]')).toBeFocused()
  return block
}

const recognized = (block: Locator): Promise<string[]> => block.locator('[data-ask-bar] .bg-accent-wash').allInnerTexts()

test('lo que se lee de cada bloque: el pozo de una estructura, la línea de una ruta o una flecha, lo que aún no ha salido', async () => {
  test.setTimeout(150_000)
  const { app, page } = await launch({ home: homeWithBlocks() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  // estructura con grupos (sus botones van debajo del dibujo): se marca en el pozo, no en el bloque entero con su cabecera
  const st = await markIn(page, 'amplitude-period-phase', 'structure')
  expect(await st.locator('[data-ask-layer]').evaluate((l) => l.parentElement?.tagName !== 'SECTION' && l.parentElement?.getAttribute('role') === 'group')).toBe(true)
  const well = (await st.locator('[data-ask-layer]').boundingBox())!
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowRight')
    // el recuadro de una parte (también el de un grupo) y su nombre, dentro del pozo
    const ring = (await st.locator('[data-ask-layer] span[style*="dashed"]').first().boundingBox())!
    const name = (await st.locator('[data-ask-layer] span.bg-accent').first().boundingBox())!
    expect(ring.y + ring.height).toBeLessThanOrEqual(well.y + well.height + 2)
    expect(name.y).toBeGreaterThanOrEqual(well.y - 1)
    expect(name.y + name.height).toBeLessThanOrEqual(well.y + well.height + 1)
  }
  // el botón «Marcar» va en la cabecera, fuera de la capa: pulsado, deja de marcar
  await st.getByRole('button', { name: 'Mark and ask the tutor' }).click()
  await expect(st.locator('[data-ask-overlay]')).toHaveCount(0)

  // mapa: subrayar Grecia es Grecia, no la ruta cuya caja la cubre
  const mp = await markIn(page, 'arc-length-sector-area', 'map')
  const greece = (await mp.locator('path[data-ask-part="country:GRC"], path[data-ask-label="Greece"]').first().boundingBox())!
  const gy = greece.y + greece.height * 0.45
  await stroke(page, Array.from({ length: 12 }, (_, i) => [greece.x + greece.width * (0.25 + (0.4 * i) / 11), gy] as [number, number]))
  await expect(mp.locator('[data-ask-bar]').getByText('Greece', { exact: true })).toBeVisible()
  expect(await recognized(mp)).not.toContain('Lisbon to Moscow')
  await page.keyboard.press('Escape')

  // diagrama que se construye: en el primer paso, con el teclado solo se llega a lo que ya ha salido
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'degree-radian-conversion' })
  const dg = page.locator('[data-block="diagram"]').first()
  await expect(dg).toBeVisible()
  await dg.getByRole('button', { name: 'Watch the process' }).click()
  await page.waitForTimeout(600)
  await dg.getByRole('button', { name: 'Mark and ask the tutor' }).click()
  await expect(dg.locator('[data-ask-overlay]')).toBeFocused()
  const seen = new Set<string>()
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight')
    seen.add((await dg.locator('[data-ask-layer] span.bg-accent').first().innerText()).trim())
  }
  expect([...seen]).toEqual(['Alpha'])
  await page.keyboard.press('Escape')

  // dibujo: subrayar la pelota es la pelota, no la flecha cuya caja la cubre
  const dw = await markIn(page, 'exact-trig-values', 'drawing')
  const ball = (await dw.locator('[data-ask-part="ball"]').first().boundingBox())!
  const by = ball.y + ball.height + 5
  await stroke(page, Array.from({ length: 10 }, (_, i) => [ball.x - 4 + ((ball.width + 8) * i) / 9, by] as [number, number]))
  await expect(dw.locator('[data-ask-bar]').getByText('Ball', { exact: true })).toBeVisible()
  expect(await recognized(dw)).toEqual(['Ball'])
  expect(errors).toEqual([])
  await app.close()
})
