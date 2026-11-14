// El dibujo vectorial con la app real: «Marcar» y la zona de marcar quedan fuera de la imagen (los lectores de pantalla los
// anuncian) y marcar una parte con nombre funciona; un paso que rodea algo que aún no se ve no apaga el dibujo; y el rodeado
// de algo que gira sigue a la vista mientras corre el reloj (no se esconde y se vuelve a trazar en cada fotograma).
import { test, expect, type Page } from 'playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

const PACK = 'exam-2-math112'

const INSCRIBED = {
  id: 'e2e-inscribed', type: 'drawing', title: 'Inscribed angle', width: 400, height: 320,
  items: [
    { kind: 'circle', cx: 200, cy: 160, r: 110, stroke: 'gray' },
    { kind: 'dot', id: 'A', name: 'Point A', cx: 104.7, cy: 215, label: 'A', anchor: 'auto' },
    { kind: 'dot', id: 'B', name: 'Point B', cx: 295.3, cy: 215, label: 'B', anchor: 'auto' },
    { kind: 'dot', id: 'P', name: 'Point P', cx: 180.9, cy: 51.7, label: 'P', anchor: 'auto', stage: 2 },
    { kind: 'angle', id: 'ins', name: 'inscribed angle', points: [[104.7, 215], [180.9, 51.7], [295.3, 215]], r: 30, label: '$\\alpha$', stage: 2 }
  ],
  steps: [
    { title: 'Arc', md: 'The arc AB.', show: 1, highlight: ['A'] },
    { title: 'Too early', md: 'P is not there yet.', show: 1, highlight: ['P'] },
    { title: 'Angle', md: 'Seen from P.', show: 2, highlight: ['ins'] }
  ]
}

const PENDULUM = {
  id: 'e2e-pendulum', type: 'drawing', title: 'Pendulum', width: 360, height: 300,
  time: { name: 't', min: '0', max: '20', loop: true, autoplay: false },
  items: [
    { kind: 'line', x1: 120, y1: 40, x2: 240, y2: 40, width: 2.5 },
    { kind: 'line', id: 'rope', name: 'Rope', x1: 180, y1: 40, x2: 180, y2: 220, motion: { turn: '40*sin(t*2)', pivot: [180, 40] } },
    { kind: 'circle', id: 'bob', name: 'Bob', cx: 180, cy: 232, r: 12, fill: 'accent', opacity: 0.4, motion: { turn: '40*sin(t*2)', pivot: [180, 40] } }
  ],
  steps: [{ title: 'Rope', md: 'The rope turns.', highlight: ['rope'] }, { title: 'Bob', md: 'The bob.', highlight: ['bob'] }]
}

/** El curso de ejemplo con el dibujo al principio de la primera lección, en modo lectura. */
function homeWith(block: unknown): string {
  const home = homeWithDemoCourse()
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const f of readdirSync(skills)) {
    const p = join(skills, f)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (s.id === 'reference-angles') s.lesson = [block, ...s.lesson]
    writeFileSync(p, JSON.stringify(s))
  }
  const prog = join(home, 'Packs', PACK, 'progress.json')
  const pr = JSON.parse(readFileSync(prog, 'utf8'))
  pr.settings = { ...(pr.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(prog, JSON.stringify(pr))
  return home
}

/** Cuántos trazos de los rodeados están escondidos (la máscara sin descubrir). */
const hiddenLoops = (cell: ReturnType<Page['locator']>): Promise<number> =>
  cell.locator('.ink-fixed [data-reveal]').evaluateAll((els) => els.filter((e) => (e as unknown as { style: { strokeDashoffset: string } }).style.strokeDashoffset === '1').length)

test('dibujo: «Marcar» fuera de la imagen, marcar una parte y un paso que rodea algo que aún no se ve', async () => {
  const { app, page } = await launch({ home: homeWith(INSCRIBED) })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  const cell = page.locator('[data-block="drawing"]').first()
  await cell.scrollIntoViewIfNeeded()
  await expect(cell.getByRole('img', { name: 'Inscribed angle' })).toHaveCount(1)
  const trigger = cell.getByRole('button', { name: 'Mark and ask the tutor' })
  await expect(trigger).toBeVisible()
  // lo de dentro de una imagen no llega a los lectores de pantalla
  await expect(trigger.locator('xpath=ancestor::*[@role="img"]')).toHaveCount(0)
  // el segundo paso rodea P, que aún no está: nada se atenúa
  await cell.getByRole('button', { name: 'Next step' }).click()
  await cell.getByRole('button', { name: 'Next step' }).click()
  await expect(cell.getByText('P is not there yet.')).toBeVisible()
  await page.waitForTimeout(400)
  expect(await cell.locator('svg g[style*="opacity: 0.3"]').count()).toBe(0)
  await expect(cell.locator('.ink-fixed')).toHaveCount(0)
  // el tercero sí rodea (el ángulo) y atenúa el resto
  await cell.getByRole('button', { name: 'Next step' }).click()
  await expect(cell.locator('.ink-fixed')).toHaveCount(1)
  await expect.poll(async () => cell.locator('svg g[style*="opacity: 0.3"]').count()).toBeGreaterThan(0)
  // marcar con el ratón: la zona de marcar queda encima del dibujo y fuera de la imagen
  await trigger.click()
  const overlay = cell.locator('[data-ask-overlay]')
  await expect(overlay).toBeFocused()
  await expect(overlay.locator('xpath=ancestor::*[@role="img"]')).toHaveCount(0)
  const fig = (await cell.locator('[data-ask-layer]').boundingBox())!
  const cx = fig.x + fig.width * (295.3 / 400), cy = fig.y + fig.height * (215 / 320), r = fig.width * 0.05
  await page.mouse.move(cx + r, cy - r * 0.4)
  await page.mouse.down()
  for (let i = 0; i <= 36; i++) {
    const a = -0.4 - (i / 36) * Math.PI * 2.15
    await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r, { steps: 2 })
  }
  await page.mouse.up()
  await expect(cell.locator('[data-ask-bar]').getByText('Point B', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('dibujo: el rodeado de algo que gira sigue a la vista mientras corre el reloj', async () => {
  const { app, page } = await launch({ home: homeWith(PENDULUM) })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  const cell = page.locator('[data-block="drawing"]').first()
  await cell.scrollIntoViewIfNeeded()
  await cell.getByRole('button', { name: 'Next step' }).click()
  await expect(cell.locator('.ink-fixed')).toHaveCount(1)
  // primero se traza a mano, entero
  await expect.poll(() => hiddenLoops(cell)).toBe(0)
  // con el reloj en marcha la cuerda gira y su caja cambia de tamaño en cada fotograma: el rodeado no se vuelve a esconder
  await cell.getByRole('group', { name: 'Drawing controls' }).getByRole('button', { name: 'Play' }).click()
  for (let k = 0; k < 10; k++) {
    await page.waitForTimeout(120)
    expect(await hiddenLoops(cell)).toBe(0)
  }
  expect(errors).toEqual([])
  await app.close()
})
