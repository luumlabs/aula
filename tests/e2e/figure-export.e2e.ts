// Archivos reales con perfil temporal: el diálogo se simula, pero el dibujo, IPC, validación y escritura son los de Aula.
import { test, expect, type ElectronApplication, type Locator, type Page, type TestInfo } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { go, homeWithDemoCourse } from './helpers'

const PACK = 'exam-2-math112'
const SKILL = 'reference-angles'
const SKILLS = [SKILL, 'degree-radian-conversion', 'arc-length-sector-area', 'amplitude-period-phase']
const fixtures = [
  { id: 'export-aspirin', type: 'structure', title: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', aromatic: 'circle',
    groups: [{ atoms: [2, 3, 4], label: 'Ester' }], steps: [{ md: 'First group', atoms: [2, 3, 4] }, { md: 'Second group', atoms: [11, 12, 13] }] },
  { id: 'export-ions', type: 'structure', title: 'Isotope and ions', smiles: '[13CH3][NH3+].[Cl-]', style: 'condensed' },
  { id: 'export-reaction', type: 'structure', title: 'Reaction', smiles: 'CC(=O)O.OCC>>CC(=O)OCC.O', conditions: 'H₂SO₄, calor', reversible: true },
  { id: 'export-expanded', type: 'structure', title: 'Ethanol', smiles: 'CCO' }
]

function prepare(language: 'es' | 'en', theme: 'light' | 'dark'): string {
  const home = homeWithDemoCourse()
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language, theme } }))
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const file of readdirSync(skills)) {
    const path = join(skills, file)
    const skill = JSON.parse(readFileSync(path, 'utf8'))
    const index = SKILLS.indexOf(skill.id)
    if (index >= 0) skill.lesson = [fixtures[index]]
    for (const exercise of skill.exercises ?? []) exercise.prompt = [{
      id: 'export-prompt', type: 'structure', smiles: 'CCO', title: 'HIDDEN_ETHANOL', alt: 'HIDDEN_DESCRIPTION', formula: 'HIDDEN_FORMULA',
      autoGroups: true, groups: [{ atoms: [3], label: 'HIDDEN_HYDROXYL', md: 'HIDDEN_EXPLANATION' }], steps: [{ md: 'HIDDEN_STEP' }]
    }, ...(exercise.prompt ?? [])]
    writeFileSync(path, JSON.stringify(skill))
  }
  const path = join(home, 'Packs', PACK, 'progress.json')
  const progress = JSON.parse(readFileSync(path, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(path, JSON.stringify(progress))
  return home
}

async function start(home: string, width = 1440): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({
    // Linux CI necesita este argumento; macOS conserva el sandbox nativo de Electron.
    args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', `--force-device-scale-factor=${width === 1440 ? 1 : 2}`],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 680 })
  await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
  return { app, page, errors }
}

/** El destino proviene del diálogo nativo, nunca de los argumentos del renderer. null equivale a Cancelar. */
async function destination(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: filePath === null, filePath: filePath ?? undefined })) as typeof dialog.showSaveDialog
  }, path)
}

const action = (figure: Locator): Locator => figure.getByRole('button', { name: /Export figure|Exportar figura/ })

/** La igualdad SVG/PNG no detectaría una omisión común: también se contrasta con la figura viva. */
async function compareDrawing(page: Page, figure: Locator, xml: string): Promise<void> {
  const exported = await page.evaluate((source) => {
    const { DOMParser } = globalThis as unknown as { DOMParser: new () => {
      parseFromString(value: string, type: string): { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }> }
    } }
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    return { errors: doc.querySelectorAll('parsererror').length, paths: doc.querySelectorAll('path').length, labels: Array.from(doc.querySelectorAll('text'), node => node.textContent ?? '') }
  }, xml)
  const live = figure.locator('[data-ask-surface] > svg')
  expect(exported.errors).toBe(0)
  expect(exported.paths).toBe(await live.locator('path').count())
  expect(exported.labels).toEqual(await live.locator('text').allTextContents())
}

async function save(app: ElectronApplication, page: Page, figure: Locator, path: string, format: 'SVG' | 'PNG'): Promise<void> {
  await destination(app, path)
  await action(figure).click()
  await page.getByRole('menuitem', { name: new RegExp(`^(Save|Guardar) ${format}`) }).click()
  await expect.poll(() => existsSync(path)).toBe(true)
  await expect(action(figure)).toBeEnabled()
}

/** Reabrir ambos archivos como imágenes independientes: no heredan CSS, fuentes ni el DOM de la figura original. */
async function inspectPair(page: Page, svgPath: string, pngPath: string, info: TestInfo, name: string): Promise<void> {
  const svg = readFileSync(svgPath, 'utf8')
  const png = readFileSync(pngPath)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(svg.match(/<script|foreignObject|<image|<use\b|\s(?:href|xlink:href|style|class|data-ask(?:-[\w-]+)?|aria-label)=|var\(|color-mix\(|url\(/i)).toBeNull()
  const result = await page.evaluate(async ({ svg64, png64 }) => {
    // El test se compila para Node; este contrato mínimo describe sólo las API del renderer que ejercitamos.
    type Bitmap = { src: string; decode(): Promise<void>; naturalWidth: number; naturalHeight: number }
    const { Image, document } = globalThis as unknown as {
      Image: new () => Bitmap
      document: { createElement(tag: 'canvas'): {
        width: number; height: number
        getContext(kind: '2d'): { drawImage(image: Bitmap, x: number, y: number, width: number, height: number): void; getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray } } | null
      } }
    }
    const load = async (src: string): Promise<Bitmap> => {
      const image = new Image()
      image.src = src
      await image.decode()
      return image
    }
    const [vector, raster] = await Promise.all([load(`data:image/svg+xml;base64,${svg64}`), load(`data:image/png;base64,${png64}`)])
    const pixels = (image: Bitmap): Uint8ClampedArray => {
      const canvas = document.createElement('canvas')
      canvas.width = raster.naturalWidth
      canvas.height = raster.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const a = pixels(vector), b = pixels(raster)
    let changed = 0, ink = 0, opaque = true
    let left = raster.naturalWidth, top = raster.naturalHeight, right = 0, bottom = 0
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) changed++
      if (Math.abs(b[i] - b[0]) + Math.abs(b[i + 1] - b[1]) + Math.abs(b[i + 2] - b[2]) > 30) {
        ink++
        const x = (i / 4) % raster.naturalWidth, y = Math.floor(i / 4 / raster.naturalWidth)
        left = Math.min(left, x); right = Math.max(right, x)
        top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
      if (b[i + 3] !== 255) opaque = false
    }
    return { changed, ink, opaque, width: raster.naturalWidth, height: raster.naturalHeight, background: Array.from(b.slice(0, 4)), margins: [left, top, raster.naturalWidth - right - 1, raster.naturalHeight - bottom - 1] }
  }, { svg64: Buffer.from(svg).toString('base64'), png64: png.toString('base64') })
  expect(result.changed).toBe(0)
  expect(result.ink).toBeGreaterThan(100)
  expect(result.opaque).toBe(true)
  expect(result.width).toBe(png.readUInt32BE(16))
  expect(result.height).toBe(png.readUInt32BE(20))
  expect(result.width).toBeGreaterThan(40)
  expect(result.height).toBeGreaterThan(40)
  expect(Math.min(...result.margins)).toBeGreaterThan(0)
  if (name.startsWith('dark')) expect(result.background[0]).toBeLessThan(100)
  else expect(result.background[0]).toBeGreaterThan(180)
  await info.attach(`${name}.svg`, { path: svgPath, contentType: 'image/svg+xml' })
  await info.attach(`${name}.png`, { path: pngPath, contentType: 'image/png' })
  await info.attach(`${name}-pixels.json`, { body: JSON.stringify(result), contentType: 'application/json' })
}

for (const theme of ['light', 'dark'] as const) {
  test(`SVG y PNG portátiles: química, reacción y grupo activo en ${theme}`, async ({}, info) => {
    test.setTimeout(150_000)
    const home = prepare(theme === 'light' ? 'en' : 'es', theme)
    const skillPaths = SKILLS.map(id => join(home, 'Packs', PACK, 'skills', `${id}.json`))
    const originalSkills = skillPaths.map(path => readFileSync(path, 'utf8'))
    const { app, page, errors } = await start(home, theme === 'light' ? 1440 : 1000)
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
      const figures = page.locator('[data-block="structure"]')
      await expect(figures).toHaveCount(1)
      await figures.nth(0).getByRole('button', { name: 'Ester', exact: true }).click()
      for (let i = 0; i < fixtures.length; i++) {
        if (i > 0) await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[i] })
        await expect(figures).toHaveCount(1)
        const figure = figures.first()
        if (i === 3) await figure.getByRole('tab', { name: /Expanded|Desarrollada/ }).click()
        const svg = join(home, `${theme}-${i}.svg`), png = join(home, `${theme}-${i}.png`)
        await save(app, page, figure, svg, 'SVG')
        await save(app, page, figure, png, 'PNG')
        await inspectPair(page, svg, png, info, `${theme}-${i}`)
        const xml = readFileSync(svg, 'utf8')
        await compareDrawing(page, figure, xml)
        if (i === 3) {
          const controls = join(home, `${theme}-export-controls.png`)
          await figure.screenshot({ path: controls })
          await info.attach(`${theme}-export-controls.png`, { path: controls, contentType: 'image/png' })
        }
        if (i === 0) {
          expect(xml).toMatch(/opacity="0.3"/)
          await expect(figure.getByRole('button', { name: 'Ester', exact: true })).toHaveAttribute('aria-pressed', 'true')
          const surface = figure.locator('[data-ask-surface]')
          const before = await surface.getAttribute('style')
          const canvas = figure.locator('[data-ask-canvas]')
          const bounds = (await canvas.boundingBox())!
          await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -250, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 })
          await expect.poll(() => surface.getAttribute('style')).not.toBe(before)
          const zoomed = join(home, `${theme}-zoomed.svg`)
          await save(app, page, figure, zoomed, 'SVG')
          expect(readFileSync(zoomed, 'utf8')).toBe(xml)
          await figure.getByRole('button', { name: /Walk through|Recorrer/ }).click()
          await figure.getByRole('button', { name: /Next step|Paso siguiente/ }).click()
          await expect(figure.getByText(/Step 2 of 2|Paso 2 de 2/)).toBeVisible()
          const stepSvg = join(home, `${theme}-step.svg`), stepPng = join(home, `${theme}-step.png`)
          await save(app, page, figure, stepSvg, 'SVG')
          await save(app, page, figure, stepPng, 'PNG')
          await inspectPair(page, stepSvg, stepPng, info, `${theme}-step`)
          await compareDrawing(page, figure, readFileSync(stepSvg, 'utf8'))
          expect(readFileSync(stepSvg, 'utf8')).not.toBe(xml)
          await expect(figure.getByText(/Step 2 of 2|Paso 2 de 2/)).toBeVisible()
        }
        if (i === 1) for (const text of ['13', 'N', 'H', '3', '+', 'Cl']) expect(xml).toContain(`>${text}<`)
        if (i === 2) expect(xml).toContain('H₂SO₄, calor')
        if (i === 3) {
          expect([...xml.matchAll(/>H<\/tspan>/g)]).toHaveLength(6)
          await expect(figure.getByRole('tab', { name: /Expanded|Desarrollada/ })).toHaveAttribute('aria-selected', 'true')
        }
      }
      expect(skillPaths.map(path => readFileSync(path, 'utf8'))).toEqual(originalSkills)
      expect(errors).toEqual([])
    } finally { await app.close() }
  })
}

test('menú por teclado, cancelación silenciosa y reintento después de un error', async () => {
  const home = prepare('en', 'light')
  const { app, page, errors } = await start(home)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="structure"]').first()
    const button = action(figure)
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Save SVG…' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Save PNG…' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByRole('menuitem', { name: 'Save SVG…' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(button).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('menuitem', { name: 'Save PNG…' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Save SVG…' })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: 'Save PNG…' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('menu')).toBeHidden()
    await button.focus()
    await destination(app, null)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(button).toBeEnabled()
    await expect(button).toBeFocused()
    await expect(page.getByText('Drawing saved', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Could not save the drawing', { exact: true })).toHaveCount(0)

    // Una operación pendiente no debe recuperar el foco si el usuario ya eligió otro control.
    await app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { figureDialogRelease?: (value: { canceled: boolean; filePath: string }) => void }
      dialog.showSaveDialog = (async () => new Promise(resolve => { state.figureDialogRelease = resolve })) as typeof dialog.showSaveDialog
    })
    await button.click()
    await page.getByRole('menuitem', { name: 'Save SVG…' }).click()
    await expect.poll(() => app.evaluate(() => typeof (globalThis as unknown as { figureDialogRelease?: unknown }).figureDialogRelease)).toBe('function')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
    const other = figure.getByRole('tab', { name: 'Condensed', exact: true })
    await other.focus()
    await app.evaluate(() => {
      const state = globalThis as unknown as { figureDialogRelease?: (value: { canceled: boolean; filePath: string }) => void }
      state.figureDialogRelease?.({ canceled: true, filePath: '' })
      delete state.figureDialogRelease
    })
    await expect(button).toBeEnabled()
    await expect(other).toBeFocused()

    const blocked = join(home, 'blocked.svg')
    mkdirSync(blocked)
    await destination(app, blocked)
    await button.click()
    await page.getByRole('menuitem', { name: 'Save SVG…' }).click()
    await expect(page.getByText('Could not save the drawing', { exact: true })).toBeVisible()
    await expect(button).toBeEnabled()
    await expect(button).toBeFocused()
    await save(app, page, figure, join(home, 'retry.svg'), 'SVG')
    await expect(page.getByText('Drawing saved', { exact: true })).toBeVisible()
    await expect(button).toBeFocused()
    expect(errors).toEqual([])
  } finally { await app.close() }
})

test('el SVG de un enunciado no revela el nombre, grupo, fórmula ni solución ocultos', async () => {
  const home = prepare('en', 'light')
  const { app, page, errors } = await start(home)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'practice' })
    const figure = page.locator('[data-block="structure"]').first()
    await expect(figure).toBeVisible()
    const path = join(home, 'prompt.svg')
    await save(app, page, figure, path, 'SVG')
    const svg = readFileSync(path, 'utf8')
    expect(svg).not.toMatch(/HIDDEN_|C2H6O|hydroxyl|ethanol|g\/mol/i)
    expect(svg).toContain('<path')
    expect(svg).toContain('>O<')
    expect(errors).toEqual([])
  } finally { await app.close() }
})
