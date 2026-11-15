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
interface RenderAudit { captures: Array<{ dip: number[]; windowBounds: { x: number; y: number; width: number; height: number }; contentBounds: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number; scale: number }; native: { width: number; height: number }; png: { width: number; height: number }; chunks: string[]; stayHidden: boolean }>; id: number; shown: number; destroyed: boolean; defaultSession: boolean; calls: Array<{ method: string; args?: unknown; result?: unknown; error?: string }>; isolation?: unknown }
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

function prepare(theme: 'light' | 'dark', fullMotion = false): string {
  const home = homeWithDemoCourse(), fixtures = [STATIC, OVERFLOW, MOVING]
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: theme === 'light' ? 'en' : 'es', theme, ...(fullMotion ? { motion: 'full' } : {}) } }))
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
        const dip = window.getContentSize(), windowBounds = window.getBounds(), contentBounds = window.getContentBounds()
        const viewport = await wc.executeJavaScript('({width: innerWidth, height: innerHeight, scale: devicePixelRatio})', false) as { width: number; height: number; scale: number }
        const native = await capturePage(...args), png = native.toPNG(), chunks: string[] = []
        for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); chunks.push(png.toString('ascii', at + 4, at + 8)); at += 12 + size }
        audit.captures.push({ dip, windowBounds, contentBounds, viewport, native: native.getSize(), png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, chunks, stayHidden: args[1]?.stayHidden === true })
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
    const diagnosticPath = `${path}.diagnostic.json`
    writeFileSync(diagnosticPath, JSON.stringify(diagnostic, null, 2))
    try { await test.info().attach('drawing-export-diagnostic.json', { path: diagnosticPath, contentType: 'application/json' }) }
    catch { /* Conserva el fallo original si el runner tampoco puede adjuntar el diagnóstico. */ }
    throw new Error(`Drawing export failed; diagnostic: ${diagnosticPath}`, { cause: error })
  }
  await expect(action(figure)).toBeVisible()
}

async function liveGeometry(page: Page, scaled = false): Promise<LiveDrawingGeometry> {
  return page.evaluate<LiveDrawingGeometry>(`(() => {
    const root=document.querySelector('[data-block="drawing"] [role="img"]'), box=root.getBoundingClientRect();
    const rect=n=>{const b=n.getBoundingClientRect();return {x:b.x-box.x,y:b.y-box.y,width:b.width,height:b.height}};
    return {width:box.width,height:box.height,...(${scaled} ? {scale:box.width/parseFloat(getComputedStyle(root).width)} : {}),labels:[...root.querySelectorAll('.viz-label, .viz-label .katex-html')].map(n=>({text:(n.classList.contains('katex-html')?'[math] ':'')+n.textContent,...rect(n)})),exclusions:[...document.querySelectorAll('button')].map(rect).filter(b=>b.width>0&&b.height>0&&b.x<box.width&&b.y<box.height&&b.x+b.width>0&&b.y+b.height>0)};
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
  const home = prepare('light', true), { app, page, errors } = await start(home, false)
  type ClickSnapshot = { rope: string; bob: string; time: number }
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[2] })
    const figure = page.locator('[data-block="drawing"]').first()
    await page.waitForTimeout(1500)
    await expect(page.locator('html')).not.toHaveClass(/(?:^|\s)reduce-motion(?:\s|$)/)
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
    const displacement = controls.getByRole('slider', { name: 'Displacement' })
    await expect(displacement).toHaveValue('-20')
    const glideFile = join(home, 'glide.png')
    await destination(app, glideFile); await holdCapture(app, true)
    try {
      // Sólo el reloj de la página fuente es lógico: la entrega de RAF, sus IDs y cancelación siguen siendo nativos.
      // Dos RAF reales de una ventana oculta pueden tardar más que los 550 ms de la transición.
      await page.evaluate(`(() => {
        const nowDescriptor=Object.getOwnPropertyDescriptor(performance,'now');
        const rafDescriptor=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');
        const nativeRaf=window.requestAnimationFrame.bind(window);
        let now=performance.now();
        window.drawingGlideClock={
          advance(ms){now+=ms},
          restore(){
            if(nowDescriptor) Object.defineProperty(performance,'now',nowDescriptor); else delete performance.now;
            if(rafDescriptor) Object.defineProperty(window,'requestAnimationFrame',rafDescriptor); else delete window.requestAnimationFrame;
            delete window.drawingGlideClock;
          }
        };
        Object.defineProperty(performance,'now',{configurable:true,writable:true,value:()=>now});
        Object.defineProperty(window,'requestAnimationFrame',{configurable:true,writable:true,value:callback=>nativeRaf(()=>callback(now))});
        document.querySelector('[data-block="drawing"] button[aria-label="Next step"]').click();
      })()`)
      await page.evaluate('window.drawingGlideClock.advance(160)')
      await expect.poll(async () => Number(await displacement.inputValue())).toBeGreaterThan(-20)
      expect(Number(await displacement.inputValue())).toBeLessThan(80)
      // El tiempo lógico permanece fijo entre el commit observado y la selección de PNG.
      await page.evaluate(`(async () => {
        document.querySelector('[data-block="drawing"] [data-figure-export] button').click();
        await new Promise(resolve=>setTimeout(resolve,0));
        [...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent.startsWith('Save PNG')).click();
      })()`)
      const glideScene = await rendered(app, 1), glideClick = await page.evaluate<ClickSnapshot>('window.drawingClickSnapshots[1]')
      sameFrame(glideScene, glideClick)
      const dx = glideScene.items.find(item => item.sourceIndex === 1)!.transform.dx
      expect(dx).toBeGreaterThan(-20); expect(dx).toBeLessThan(80)
      await expect.poll(() => app.evaluate(() => !!(globalThis as unknown as { drawingQaRelease?: () => void }).drawingQaRelease)).toBe(true)
      await page.evaluate('window.drawingGlideClock.advance(600)')
      await expect(displacement).toHaveValue('80')
      await expect(figure.getByText('Second position', { exact: true })).toBeVisible()
      await holdCapture(app, false)
      await expect.poll(() => existsSync(glideFile)).toBe(true)
      await inspect(page, glideFile, info, 'glide')
    } finally {
      try { await holdCapture(app, false) }
      finally { await page.evaluate('window.drawingGlideClock?.restore()') }
    }
    const captures = await audit(app, info, home, 'motion-verified')
    expect(captures).toHaveLength(2)
    expect(captures.every(c => c.destroyed && c.shown === 0)).toBe(true)
    expect(errors).toEqual([])
  } finally { await audit(app, info, home, 'motion'); await app.close() }
})

interface ZoomMathGeometry {
  zoom: number
  width: number
  height: number
  math: Array<{ kind: string; border: string; zoom: number; fontSize: string; x: number; y: number; width: number; height: number }>
}
// La referencia nace de estilos y rectángulos del DOM real, no del DTO ni de los helpers de exportación.
const zoomMathGeometry = (selector: string): string => `(() => {
  const root=document.querySelector(${JSON.stringify(selector)}), box=root.getBoundingClientRect(), css=getComputedStyle(root);
  const width=parseFloat(css.width), height=parseFloat(css.height), scale=box.width/width;
  const zoomAt=element=>{let zoom=1;for(let node=element;node;node=node.parentElement)zoom*=Number(getComputedStyle(node).zoom);return zoom;};
  return {zoom:zoomAt(root),width,height,math:[...root.querySelectorAll('.katex-html, .frac-line, .sqrt')].map(node=>{
    const r=node.getBoundingClientRect(),s=getComputedStyle(node);
    return{kind:node.classList.contains('frac-line')?'fraction':node.classList.contains('sqrt')?'root':'formula',border:s.borderBottomWidth,zoom:zoomAt(node),fontSize:s.fontSize,x:(r.x-box.x)/scale,y:(r.y-box.y)/scale,width:r.width/scale,height:r.height/scale};
  })};
})()`

for (const c of [
  { key: 'academic', theme: 'academic', layout: 'content' as const, textScale: 1, rootFont: 15, zoom: 1.75, rootZoom: 1, italic: false },
  { key: 'quote', theme: 'aula', layout: 'quote' as const, textScale: 1.4, rootFont: 21, zoom: 1.8, rootZoom: 1, italic: true },
  { key: 'root-zoom', theme: 'academic', layout: 'content' as const, textScale: 1, rootFont: 15, zoom: 1.75, rootZoom: 1.25, italic: false }
]) test(`Drawing PNG conserva CSS zoom y raíces de Slides reales: ${c.key}`, async ({}, info) => {
  const home = prepare('light'), settingsPath = join(home, 'settings.json'), settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  settings.general.textScale = c.textScale; settings.general.motion = 'reduced'; writeFileSync(settingsPath, JSON.stringify(settings))
  // El fixture de zoom en html cabe entero en el viewport recortado de Slides, incluso a esa densidad.
  const compact = c.rootZoom !== 1
  const block: BlockOf<'drawing'> = { id: `zoom-${c.key}`, type: 'drawing', width: compact ? 200 : 360, height: compact ? 70 : 120, items: [
    { kind: 'text', x: compact ? 50 : 90, y: compact ? 25 : 40, text: '$\\frac{a_1+b}{\\sqrt{x_2}}$', size: 22 },
    { kind: 'text', x: compact ? 130 : 245, y: compact ? 50 : 80, text: '$\\sqrt{1+\\frac{x}{y}}$', size: 18 },
    { kind: 'dot', cx: compact ? 175 : 320, cy: compact ? 12 : 20, r: 9, fill: 'green', stroke: 'green' }
  ] }
  const slide: import('../../src/shared/schema/cards').Slide = { id: `slide-${c.key}`, layout: c.layout, blocks: [block], right: [] }
  const sourcePath = join(home, 'Packs', PACK, 'skills', `${SKILLS[0]}.json`), lesson = JSON.parse(readFileSync(sourcePath, 'utf8'))
  lesson.lesson = [{ id: `deck-${c.key}`, type: 'slides', title: `Zoom ${c.key}`, theme: c.theme, transition: 'none', slides: [slide] }]
  writeFileSync(sourcePath, JSON.stringify(lesson)); const sourceBytes = readFileSync(sourcePath, 'utf8')
  const { app, page, errors } = await start(home, false)
  try {
    await app.evaluate(({ app: main }) => {
      main.on('browser-window-created', (_event, window) => {
        const wc = window.webContents, previous = wc.executeJavaScript.bind(wc)
        wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
          const result = await previous(code, gesture)
          if (/^window\.aulaFigureRender\.render\(/.test(code)) {
            // Se instala desde Node sin serializar funciones transpiliadas dentro de evaluate.
            const state = globalThis as unknown as { drawingZoomRead?: string; drawingZoomMath?: ZoomMathGeometry }
            state.drawingZoomMath = await previous(state.drawingZoomRead!, false)
          }
          return result
        }) as typeof wc.executeJavaScript
      })
    })
    await app.evaluate((_electron, expression) => { (globalThis as unknown as { drawingZoomRead: string }).drawingZoomRead = expression }, zoomMathGeometry('[data-drawing-scene]'))
    // Contexto DOM de densidad adicional: prueba que el zoom del html también participa en el producto.
    if (c.rootZoom !== 1) await page.evaluate(`document.documentElement.style.zoom = '${c.rootZoom}'`)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="drawing"]').first()
    await figure.scrollIntoViewIfNeeded(); await expect(figure.locator('.frac-line')).toHaveCount(2)
    await page.waitForTimeout(700)
    const before = await page.evaluate<ZoomMathGeometry>(zoomMathGeometry('[data-block="drawing"] [role="img"]'))
    expect(before.zoom).toBeCloseTo(c.zoom * c.rootZoom, 5)
    expect(before.math.filter(node => node.kind === 'root')).toHaveLength(2)
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), progress = readFileSync(progressPath, 'utf8')
    // «Marcar» es un portal hermano de role=img. SlidePigment es decoración de la diapositiva detrás
    // del lienzo transparente; ninguno forma parte del dibujo autónomo sobre papel. Se restauran antes de exportar.
    await expect(figure.locator('[data-ask-layer]')).toHaveCount(1)
    await expect(page.locator('.viz-slide > .paint')).toHaveCount(1)
    await expect(figure.locator('.paint')).toHaveCount(0)
    const ui = await page.addStyleTag({ content: '[data-block="drawing"] [data-ask-layer], .viz-slide > .paint { visibility: hidden !important; }' })
    let live: Buffer, geometry: LiveDrawingGeometry
    try { geometry = await liveGeometry(page, true); live = await figure.getByRole('img').screenshot({ scale: 'css' }) }
    finally { await ui.evaluate(element => element.remove()) }
    const livePath = info.outputPath(`${c.key}-live.png`); writeFileSync(livePath, live); await info.attach(`${c.key}-live.png`, { path: livePath, contentType: 'image/png' })
    const file = join(home, `drawing-css-zoom-${c.key}.png`); await save(app, page, figure, file)
    const input = await rendered(app, 0), after = await app.evaluate(() => (globalThis as unknown as { drawingZoomMath: ZoomMathGeometry }).drawingZoomMath)
    const mathPath = info.outputPath(`${c.key}-math-geometry.json`); writeFileSync(mathPath, JSON.stringify({ before, after, metrics: input.metrics }, null, 2))
    await info.attach(`${c.key}-math-geometry.json`, { path: mathPath, contentType: 'application/json' })
    expect(input.metrics).toMatchObject({ cssZoom: before.zoom, rootFontPx: c.rootFont, bodyFont: 'serif', bodyItalic: c.italic })
    expect(input.metrics.layoutWidth).toBeCloseTo(before.width, 3)
    // El root sin zoom usa la rejilla de layout 1/64px; el original zoomado puede caer entre sus puntos.
    expect(Math.abs(after.width - before.width)).toBeLessThan(1 / 64); expect(Math.abs(after.height - before.height)).toBeLessThan(1 / 64)
    expect(after.math).toHaveLength(before.math.length)
    for (let i = 0; i < before.math.length; i++) {
      expect(after.math[i].kind).toBe(before.math[i].kind)
      expect(after.math[i].border).toBe(before.math[i].border)
      expect(after.math[i].zoom).toBe(before.math[i].zoom); expect(after.math[i].fontSize).toBe(before.math[i].fontSize)
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after.math[i][key] - before.math[i][key]), `${before.math[i].kind} ${key}`).toBeLessThan(.05)
    }
    await inspect(page, file, info, `drawing-css-zoom-${c.key}`)
    await compareDrawingPixels(page, live, readFileSync(file), geometry, info, `drawing-css-zoom-${c.key}`)
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceBytes); expect(readFileSync(progressPath, 'utf8')).toBe(progress)
    expect(errors).toEqual([])
  } finally { try { await audit(app, info, home, `css-zoom-${c.key}`) } finally { await app.close() } }
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
