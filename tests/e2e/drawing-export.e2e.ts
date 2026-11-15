// Exportación completa del dibujo: la referencia es la imagen viva, no otra salida del exportador.
import { test, expect, type ElectronApplication, type Locator, type Page, type TestInfo } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BlockOf } from '../../src/shared/schema/blocks'
import type { DrawingRenderSceneV1 } from '../../src/shared/figuresDrawing'
import { go, homeWithDemoCourse } from './helpers'
import { compareDrawingPixels, type LiveDrawingGeometry } from './drawing-pixels'

const PACK = 'exam-2-math112'
const SKILLS = ['reference-angles', 'degree-radian-conversion', 'arc-length-sector-area']
interface RenderAudit { captures: Array<{ dip: number[]; native: { width: number; height: number }; png: { width: number; height: number }; chunks: string[]; stayHidden: boolean }>; id: number; shown: number; destroyed: boolean; defaultSession: boolean; calls: Array<{ method: string; args?: unknown; result?: unknown; error?: string }>; isolation?: unknown }
const STATIC: BlockOf<'drawing'> = {
  id: 'export-drawing-static', type: 'drawing', title: 'Drawing export fixture', width: 480, height: 320, style: 'hand',
  items: [
    // El elemento oculto precede a los visibles: filtrar antes de preparar cambiaría índices y semillas.
    { kind: 'rect', id: 'HIDDEN_ID', name: 'HIDDEN_NAME', x: 65, y: 135, w: 90, h: 55, label: 'HIDDEN_STAGE_LABEL', stage: 3 },
    { kind: 'object', object: 'car', id: 'car', name: 'HIDDEN_CAR_ANSWER', x: 125, y: 210, w: 115, fill: 'blue', label: 'Car', anchor: 'auto' },
    { kind: 'object', object: 'ground', x: 125, y: 240, w: 220 },
    { kind: 'rect', id: 'hatch', x: 315, y: 155, w: 110, h: 65, fill: 'terracotta', fillStyle: 'hatch', label: 'Hatching' },
    { kind: 'text', x: 230, y: 45, text: '$\\frac{v_0^2}{2g}+\\sqrt{x_1}$', size: 22 },
    { kind: 'text', x: 110, y: 90, text: 'زاوية المثلث', size: 18 },
    { kind: 'text', x: 335, y: 100, text: '[Reference](https://example.invalid/reference)', size: 18 },
    { kind: 'measure', x1: 280, y1: 265, x2: 435, y2: 265, label: '$d=12\\,\\mathrm{m}$' },
    { kind: 'dot', id: 'anchor', cx: 435, cy: 40, r: 9, fill: 'green', stroke: 'green', opacity: 1 }
  ],
  steps: [{ title: 'Visible', md: 'VISIBLE_STEP_GUIDE', show: 1, highlight: ['car'] }, { title: 'Later', md: 'HIDDEN_STEP_ANSWER', show: 3 }]
}
const OVERFLOW: BlockOf<'drawing'> = {
  id: 'export-drawing-overflow', type: 'drawing', title: 'Overflow fixture', width: 400, height: 280,
  items: [
    { kind: 'line', x1: -55, y1: -28, x2: 450, y2: 295, width: 5, stroke: 'blue' },
    { kind: 'text', x: -50, y: 135, anchor: 'left', text: '$\\frac{a+b}{\\sqrt{c}}$ outside the nominal canvas', size: 24 },
    { kind: 'circle', cx: 435, cy: 225, r: 33, fill: 'amber', opacity: 0.4 },
    { kind: 'dot', cx: 300, cy: 45, r: 9, fill: 'green', stroke: 'green', opacity: 1 }
  ]
}
const MOVING: BlockOf<'drawing'> = {
  id: 'export-drawing-moving', type: 'drawing', title: 'Moving fixture', width: 420, height: 320,
  params: [{ name: 'x', label: 'Displacement', min: -30, max: 90, step: 1, value: 0 }],
  time: { name: 't', min: '0', max: '20', speed: 1, loop: true, autoplay: false },
  items: [
    { kind: 'line', x1: 120, y1: 40, x2: 240, y2: 40, width: 2.5 },
    { kind: 'line', id: 'rope', name: 'ROPE_NAME_PRIVATE', x1: 180, y1: 40, x2: 180, y2: 220, motion: { turn: '40*sin(t*2)', pivot: [180, 40], dx: 'x' } },
    { kind: 'circle', id: 'bob', name: 'BOB_NAME_PRIVATE', cx: 180, cy: 232, r: 14, fill: 'accent', opacity: 0.4, motion: { turn: '40*sin(t*2)', pivot: [180, 40], dx: 'x' } },
    { kind: 'text', x: 320, y: 55, text: '$T=2\\pi\\sqrt{l/g}$', size: 18 }
  ],
  steps: [{ title: 'First', md: 'First position', params: { x: -20 }, highlight: ['rope'] }, { title: 'Second', md: 'Second position', params: { x: 80 }, highlight: ['bob'] }]
}

function prepare(theme: 'light' | 'dark'): string {
  const home = homeWithDemoCourse(), fixtures = [STATIC, OVERFLOW, MOVING]
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: theme === 'light' ? 'en' : 'es', theme } }))
  const dir = join(home, 'Packs', PACK, 'skills')
  for (const file of readdirSync(dir)) {
    const path = join(dir, file), skill = JSON.parse(readFileSync(path, 'utf8'))
    const index = SKILLS.indexOf(skill.id)
    if (index >= 0) skill.lesson = [fixtures[index]]
    writeFileSync(path, JSON.stringify(skill))
  }
  const path = join(home, 'Packs', PACK, 'progress.json'), progress = JSON.parse(readFileSync(path, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(path, JSON.stringify(progress))
  return home
}

async function start(home: string, dark: boolean): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', `--force-device-scale-factor=${dark ? 2 : 1}`],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' }
  })
  const page = await app.firstWindow(), errors: string[] = []
  await app.evaluate(({ app: mainApp, session }) => {
    const state = globalThis as unknown as { drawingQa: RenderAudit[]; drawingQaHold?: boolean; drawingQaRelease?: () => void }
    state.drawingQa = []
    mainApp.on('browser-window-created', (_event, window) => {
      const wc = window.webContents
      const audit: RenderAudit = { id: wc.id, shown: 0, destroyed: false, defaultSession: wc.session === session.defaultSession, calls: [], captures: [] }
      state.drawingQa.push(audit)
      window.on('show', () => { audit.shown++ })
      wc.once('destroyed', () => { audit.destroyed = true })
      const capturePage = wc.capturePage.bind(wc)
      wc.capturePage = async (...args: Parameters<typeof wc.capturePage>) => {
        const native = await capturePage(...args), png = native.toPNG(), chunks: string[] = []
        for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); chunks.push(png.toString('ascii', at + 4, at + 8)); at += 12 + size }
        audit.captures.push({ dip: window.getContentSize(), native: native.getSize(), png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, chunks, stayHidden: args[1]?.stayHidden === true })
        return native
      }
      const execute = wc.executeJavaScript.bind(wc)
      // Instrumentación sólo del proceso fixture: conserva la llamada real y observa el contrato privado main→escena.
      wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
        const match = /^window\.aulaFigureRender\.(render|resize|normalize)\(([\s\S]*)\)$/.exec(code)
        if (!match) return execute(code, gesture)
        const method = match[1], args = JSON.parse(match[2]) as Record<string, unknown>
        const call: RenderAudit['calls'][number] = { method, args: method === 'normalize' ? { width: args.width, height: args.height } : args }
        audit.calls.push(call)
        try {
          const result = await execute(code, gesture)
          call.result = method === 'normalize' ? { width: result.width, height: result.height } : result
          if (method === 'render') audit.isolation = await execute(`({
            aula: 'aula' in globalThis, node: typeof require !== 'undefined' || typeof process !== 'undefined',
            links: document.querySelectorAll('a[href]').length, images: document.querySelectorAll('img[src]').length,
            frames: document.querySelectorAll('iframe, object, embed').length,
            text: document.querySelector('[data-drawing-scene]').textContent,
            largest: Array.from(document.querySelectorAll('[data-drawing-label] *')).map(e=>({tag:e.tagName,cls:e.getAttribute('class'),width:e.getBoundingClientRect().width})).sort((a,b)=>b.width-a.width).slice(0,6)
          })`)
          if (method === 'render' && state.drawingQaHold) await new Promise<void>((resolve, reject) => {
            state.drawingQaRelease = resolve
            wc.once('destroyed', () => reject(new Error('Fixture render cancelled')))
          })
          return result
        } catch (error) { call.error = String(error); throw error }
      }) as typeof wc.executeJavaScript
    })
  })
  page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: dark ? 1000 : 1440, height: dark ? 1000 : 900 })
  await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
  return { app, page, errors }
}
async function audit(app: ElectronApplication, info: TestInfo, home: string, name: string): Promise<RenderAudit[]> {
  const result = await app.evaluate(() => (globalThis as unknown as { drawingQa: RenderAudit[] }).drawingQa)
  const path = join(home, `${name}-render-audit.json`)
  writeFileSync(path, JSON.stringify(result, null, 2))
  await info.attach(`${name}-render-audit.json`, { path, contentType: 'application/json' })
  return result
}
const action = (figure: Locator): Locator => figure.getByRole('button', { name: /Export figure|Exportar figura/ })
async function destination(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: filePath === null, filePath: filePath ?? undefined })) as typeof dialog.showSaveDialog
  }, path)
}
async function save(app: ElectronApplication, page: Page, figure: Locator, path: string): Promise<void> {
  await destination(app, path)
  await action(figure).click()
  await expect(page.getByRole('menuitem', { name: /^(Save|Guardar) SVG/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ }).click()
  try { await expect.poll(() => existsSync(path), { timeout: 30_000 }).toBe(true) }
  catch (error) {
    const diagnostic = await page.evaluate(`({fonts: document.fonts.status, failedFonts: [...document.querySelectorAll('[data-block=\"drawing\"] .viz-label, [data-block=\"drawing\"] .viz-label *')].filter(n => !n.closest('.katex-mathml')).map(n => { const c=getComputedStyle(n); const font=c.fontStyle+' '+c.fontWeight+' '+c.fontSize+' '+c.fontFamily; return {tag:n.tagName,cls:n.className,font,text:n.textContent,ok:c.display==='none'||document.fonts.check(font,n.textContent||'Aula')}; }).filter(n=>!n.ok), alerts: document.body.innerText.slice(-1500)})`)
    writeFileSync(`${path}.diagnostic.json`, JSON.stringify(diagnostic, null, 2))
    throw new Error(`Drawing export failed; diagnostic: ${path}.diagnostic.json`, { cause: error })
  }
  await expect(action(figure)).toBeVisible()
}

async function liveGeometry(page: Page): Promise<LiveDrawingGeometry> {
  return page.evaluate<LiveDrawingGeometry>(`(() => {
    const root=document.querySelector('[data-block="drawing"] [role="img"]'), box=root.getBoundingClientRect();
    const rect=n=>{const b=n.getBoundingClientRect();return {x:b.x-box.x,y:b.y-box.y,width:b.width,height:b.height}};
    return {width:box.width,height:box.height,labels:[...root.querySelectorAll('.viz-label')].map(n=>({text:n.textContent,...rect(n)})),exclusions:[...document.querySelectorAll('button')].map(rect).filter(b=>b.width>0&&b.height>0&&b.x<box.width&&b.y<box.height&&b.x+b.width>0&&b.y+b.height>0)};
  })()`)
}

/** PNG reabierto y decodificado por otra API, sin CSS ni estado de la escena exportada. */
async function inspect(page: Page, path: string, info: TestInfo, name: string) {
  const png = readFileSync(path)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const chunks: string[] = []
  for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); chunks.push(png.toString('ascii', at + 4, at + 8)); at += 12 + size }
  expect(chunks).not.toContain('iCCP')
  expect(chunks.some(c => ['tEXt', 'iTXt', 'zTXt'].includes(c))).toBe(false)
  const result = await page.evaluate(async base64 => {
    type Bitmap = { src: string; decode(): Promise<void>; naturalWidth: number; naturalHeight: number }
    const { Image, document } = globalThis as unknown as {
      Image: new () => Bitmap
      document: { createElement(tag: 'canvas'): { width: number; height: number; getContext(kind: '2d'): {
        drawImage(image: Bitmap, x: number, y: number): void
        getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
      } | null } }
    }
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0, opaque = true, left = canvas.width, top = canvas.height, right = 0, bottom = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 255) opaque = false
      if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 45) {
        ink++; const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width)
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
    }
    return { width: canvas.width, height: canvas.height, ink, opaque, background: Array.from(data.slice(0, 4)), margins: [left, top, canvas.width - right - 1, canvas.height - bottom - 1] }
  }, png.toString('base64'))
  expect(result.width).toBe(png.readUInt32BE(16)); expect(result.height).toBe(png.readUInt32BE(20))
  expect(result.width).toBeLessThanOrEqual(4096); expect(result.height).toBeLessThanOrEqual(4096)
  expect(result.width * result.height).toBeLessThanOrEqual(16 * 1024 * 1024)
  expect(result.opaque).toBe(true); expect(result.ink).toBeGreaterThan(100)
  expect(Math.min(...result.margins)).toBeGreaterThan(0)
  await info.attach(`${name}.png`, { path, contentType: 'image/png' })
  await info.attach(`${name}-pixels.json`, { body: JSON.stringify({ ...result, chunks }), contentType: 'application/json' })
  return result
}

for (const theme of ['light', 'dark'] as const) {
  test(`Drawing PNG completo: fórmulas, rayado y overflow en ${theme}`, async ({}, info) => {
    test.setTimeout(120_000)
    const home = prepare(theme), { app, page, errors } = await start(home, theme === 'dark')
    const paths = SKILLS.map(id => join(home, 'Packs', PACK, 'skills', `${id}.json`)), courses = paths.map(p => readFileSync(p, 'utf8'))
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
      const figure = page.locator('[data-block="drawing"]').first()
      await figure.getByRole('button', { name: /Next step|Paso siguiente/ }).click()
      await expect(figure.getByText('VISIBLE_STEP_GUIDE')).toBeVisible()
      await expect(figure.getByText('HIDDEN_STAGE_LABEL', { exact: true })).toHaveCount(0)
      await expect(figure.locator('.katex').first()).toBeVisible()
      await expect(figure.locator('pattern')).not.toHaveCount(0)
      await expect(figure.locator('.ink-fixed')).toHaveCount(1)
      // La comparación debe usar la apariencia final de los trazos, sin detener reloj o cambiar pasos.
      await page.waitForTimeout(3000)
      const geometry = await liveGeometry(page)
      const live = await figure.getByRole('img').screenshot({ scale: 'css' })
      const livePath = info.outputPath(`${theme}-live.png`); writeFileSync(livePath, live)
      await info.attach(`${theme}-live.png`, { path: livePath, contentType: 'image/png' })
      const file = join(home, `${theme}-drawing.png`)
      await save(app, page, figure, file)
      const pixels = await inspect(page, file, info, `${theme}-drawing`)
      await compareDrawingPixels(page, live, readFileSync(file), geometry, info, theme)
      if (theme === 'dark') expect(pixels.background[0]).toBeLessThan(100)
      else expect(pixels.background[0]).toBeGreaterThan(180)
      await expect(figure.getByText('VISIBLE_STEP_GUIDE')).toBeVisible()
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[1] })
      const canvas = (await figure.getByRole('img').boundingBox())!
      await save(app, page, figure, join(home, `${theme}-overflow.png`))
      const overflow = await inspect(page, join(home, `${theme}-overflow.png`), info, `${theme}-overflow`)
      expect(overflow.width).toBeGreaterThan(canvas.width + 80)
      expect(overflow.height).toBeGreaterThan(canvas.height + 25)
      expect(paths.map(p => readFileSync(p, 'utf8'))).toEqual(courses)
      expect(errors).toEqual([])
      const captures = await audit(app, info, home, `${theme}-verified`)
      expect(captures).toHaveLength(2)
      for (const capture of captures) {
        expect(capture.shown).toBe(0); expect(capture.defaultSession).toBe(false); expect(capture.destroyed).toBe(true)
        expect(capture.isolation).toMatchObject({ aula: false, node: false, links: 0, images: 0, frames: 0 })
        expect(capture.calls.map(c => c.method)).toEqual(['render', 'resize', 'normalize'])
        expect(capture.calls.every(c => !c.error)).toBe(true)
        expect(capture.captures).toHaveLength(2)
        expect(capture.captures[0].dip).toEqual([128, 128])
        expect(capture.captures.every(c => c.stayHidden && c.png.width > 0 && c.png.height > 0)).toBe(true)
        expect(JSON.stringify(capture)).not.toContain('HIDDEN_')
      }
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    } finally { await audit(app, info, home, theme); await app.close() }
  })
}

async function holdCapture(app: ElectronApplication, hold: boolean): Promise<void> {
  await app.evaluate((_electron, hold) => {
    const state = globalThis as unknown as { drawingQaHold: boolean; drawingQaRelease?: () => void }
    state.drawingQaHold = hold
    if (!hold) { state.drawingQaRelease?.(); state.drawingQaRelease = undefined }
  }, hold)
}
async function rendered(app: ElectronApplication, index: number): Promise<DrawingRenderSceneV1> {
  await expect.poll(() => app.evaluate((_electron, index) => !!(globalThis as unknown as { drawingQa: RenderAudit[] }).drawingQa[index]?.calls.find(c => c.method === 'render')?.result, index)).toBe(true)
  return app.evaluate((_electron, index) => (globalThis as unknown as { drawingQa: RenderAudit[] }).drawingQa[index].calls.find(c => c.method === 'render')!.args as DrawingRenderSceneV1, index)
}
async function choosePng(page: Page, figure: Locator): Promise<void> {
  await action(figure).click()
  await page.getByRole('menuitem', { name: /^Save PNG/ }).click()
}

test('Drawing PNG: cancelar al navegar libera la captura y cancelar el diálogo conserva foco y progreso', async ({}, info) => {
  const home = prepare('light'), { app, page, errors } = await start(home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="drawing"]').first()
    const canceled = join(home, 'must-not-exist.png')
    await destination(app, canceled); await holdCapture(app, true)
    await choosePng(page, figure); await rendered(app, 0)
    const busy = figure.locator('[data-figure-export] button')
    await expect(busy).toHaveAttribute('aria-disabled', 'true')
    await busy.press('ArrowDown')
    await expect(page.getByRole('menuitem')).toHaveCount(0)
    await go(page, { name: 'home' })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(existsSync(canceled)).toBe(false)
    await holdCapture(app, false)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    await destination(app, null); await choosePng(page, figure)
    await rendered(app, 1)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    await expect(action(figure)).toBeFocused()
    expect(readFileSync(progressPath, 'utf8')).toBe(before)
    expect(existsSync(canceled)).toBe(false)
    await save(app, page, figure, join(home, 'after-cancel.png'))
    await inspect(page, join(home, 'after-cancel.png'), info, 'after-cancel')
    const captures = await audit(app, info, home, 'cancellation-verified')
    expect(captures).toHaveLength(3)
    expect(captures.every(c => c.destroyed && !c.defaultSession && c.shown === 0)).toBe(true)
    expect(errors).toEqual([])
  } finally { await audit(app, info, home, 'cancellation'); await app.close() }
})

test('Drawing PNG congela el frame visible durante reloj y transición sin detenerlos', async ({}, info) => {
  const home = prepare('light'), { app, page, errors } = await start(home, false)
  type ClickSnapshot = { rope: string; bob: string; time: number }
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[2] })
    const figure = page.locator('[data-block="drawing"]').first()
    await page.waitForTimeout(1500)
    // El observador DOM corre antes del manejador React: la referencia es el frame comprometido que ve el estudiante.
    await page.evaluate(`(() => {
      window.drawingClickSnapshots=[];
      document.addEventListener('click', event => {
        if (!event.target.closest('[role="menuitem"]')?.textContent.startsWith('Save PNG')) return;
        const root=document.querySelector('[data-block="drawing"]');
        window.drawingClickSnapshots.push({rope:root.querySelector('[data-ask-part="rope"]').getAttribute('transform'),bob:root.querySelector('[data-ask-part="bob"]').getAttribute('transform'),time:Number(root.querySelector('input[aria-label="t"]').value)});
      }, true);
    })()`)
    const controls = figure.getByRole('group')
    await controls.getByRole('button', { name: 'Play', exact: true }).click()
    const clockFile = join(home, 'clock.png')
    await destination(app, clockFile); await holdCapture(app, true)
    await choosePng(page, figure)
    const clockScene = await rendered(app, 0)
    const clockClick = await page.evaluate<ClickSnapshot>('window.drawingClickSnapshots[0]')
    function sameFrame(scene: DrawingRenderSceneV1, snapshot: ClickSnapshot): void {
      for (const [index, name] of [[1, 'rope'], [2, 'bob']] as const) {
        const t = scene.items.find(item => item.sourceIndex === index)!.transform
        expect(snapshot[name]).toBe(`translate(${t.dx.toFixed(2)} ${t.dy.toFixed(2)})${t.deg ? ` rotate(${(-t.deg).toFixed(2)} ${t.px.toFixed(2)} ${t.py.toFixed(2)})` : ''}`)
      }
    }
    sameFrame(clockScene, clockClick)
    await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect.poll(async () => Number(await controls.getByRole('slider', { name: 't', exact: true }).inputValue())).toBeGreaterThan(clockClick.time + .1)
    await holdCapture(app, false)
    await expect.poll(() => existsSync(clockFile)).toBe(true)
    await inspect(page, clockFile, info, 'clock')
    await controls.getByRole('button', { name: 'Pause', exact: true }).click()
    await figure.getByRole('button', { name: 'Next step', exact: true }).click()
    await page.waitForTimeout(650)
    const glideFile = join(home, 'glide.png')
    await destination(app, glideFile); await holdCapture(app, true)
    // Dos frames dejan empezar la transición de 550 ms; se selecciona exportar sin esperas artificiales que la terminen.
    await page.evaluate(`(async () => {
      const root=document.querySelector('[data-block="drawing"]');
      root.querySelector('button[aria-label="Next step"]').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      root.querySelector('[data-figure-export] button').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      [...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent.startsWith('Save PNG')).click();
    })()`)
    const glideScene = await rendered(app, 1), glideClick = await page.evaluate<ClickSnapshot>('window.drawingClickSnapshots[1]')
    sameFrame(glideScene, glideClick)
    const dx = glideScene.items.find(item => item.sourceIndex === 1)!.transform.dx
    expect(dx).toBeGreaterThan(-20); expect(dx).toBeLessThan(80)
    await expect(controls.getByRole('slider', { name: 'Displacement' })).toHaveValue('80')
    await expect(figure.getByText('Second position', { exact: true })).toBeVisible()
    await holdCapture(app, false)
    await expect.poll(() => existsSync(glideFile)).toBe(true)
    await inspect(page, glideFile, info, 'glide')
    const captures = await audit(app, info, home, 'motion-verified')
    expect(captures).toHaveLength(2)
    expect(captures.every(c => c.destroyed && c.shown === 0)).toBe(true)
    expect(errors).toEqual([])
  } finally { await audit(app, info, home, 'motion'); await app.close() }
})

test('Drawing PNG conserva prosa RTL y fórmulas LTR del idioma del curso', async ({}, info) => {
  const home = prepare('light'), packPath = join(home, 'Packs', PACK, 'pack.json')
  const pack = JSON.parse(readFileSync(packPath, 'utf8')); pack.language = 'ar'; writeFileSync(packPath, JSON.stringify(pack))
  const skillPath = join(home, 'Packs', PACK, 'skills', `${SKILLS[0]}.json`), skill = JSON.parse(readFileSync(skillPath, 'utf8'))
  const block: BlockOf<'drawing'> = { id: 'rtl-export', type: 'drawing', title: 'RTL drawing', width: 420, height: 200, items: [
    { kind: 'text', x: 210, y: 75, text: 'زاوية $\\frac{a+b}{c}$ المثلث', size: 22 },
    { kind: 'line', x1: 35, y1: 130, x2: 380, y2: 130, stroke: 'blue', width: 2 },
    { kind: 'dot', cx: 380, cy: 30, r: 9, fill: 'green', stroke: 'green', opacity: 1 }
  ] }
  skill.lesson = [block]; writeFileSync(skillPath, JSON.stringify(skill))
  const { app, page, errors } = await start(home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="drawing"]').first()
    await expect(figure.locator('.viz-label [dir="rtl"]')).toHaveCount(1)
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.viz-label .katex')).direction`)).toBe('ltr')
    await page.waitForTimeout(1500)
    const geometry = await liveGeometry(page)
    const live = await figure.getByRole('img').screenshot({ scale: 'css' }), livePath = info.outputPath('rtl-live.png'); writeFileSync(livePath, live)
    await info.attach('rtl-live.png', { path: livePath, contentType: 'image/png' })
    const file = join(home, 'rtl.png')
    await save(app, page, figure, file)
    await inspect(page, file, info, 'rtl')
    await compareDrawingPixels(page, live, readFileSync(file), geometry, info, 'rtl')
    const scene = await rendered(app, 0)
    expect(scene.appearance).toMatchObject({ direction: 'rtl', language: 'ar' })
    expect(readFileSync(skillPath, 'utf8')).toBe(JSON.stringify(skill))
    expect(errors).toEqual([])
  } finally { await audit(app, info, home, 'rtl'); await app.close() }
})
