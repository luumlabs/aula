// PNG de todas las familias de Diagram: referencias vivas, curso real y datos de prueba aislados.
import { test, expect, type ElectronApplication, type Locator, type Page, type TestInfo } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DiagramPrimitive, DiagramRenderSceneV1 } from '../../src/shared/figuresDiagram'
import type { FigureRenderInput } from '../../src/shared/figuresRender'
import { DIAGRAM_FIXTURES, EMPTY_DIAGRAM } from './diagram-fixtures'
import { decodeDiagramFramePng, diagramHoverFramePixels } from './diagram-frame'
import { compareDiagramPixels, type LiveDiagramGeometry } from './diagram-pixels'
import { go, homeWithDemoCourse } from './helpers'
import { captureDiagramReference, initializeDiagramReference, evaluateLiveElement, liveGeometry } from './diagram-reference'

const PACK = 'exam-2-math112', SKILLS = ['reference-angles', 'degree-radian-conversion', 'arc-length-sector-area']
interface Audit { id: number; shown: number; destroyed: boolean; defaultSession: boolean; calls: Array<{ method: string; input?: unknown; result?: unknown; error?: string }>; isolation?: unknown }
interface MainAudit { diagramAudit: Audit[]; holdDiagram?: boolean; releaseDiagram?: () => void; sourceViewport?: unknown }
const groups = [DIAGRAM_FIXTURES.slice(0, 5), DIAGRAM_FIXTURES.slice(5, 10), DIAGRAM_FIXTURES.slice(10)]

function prepare(theme: 'light' | 'dark'): string {
  const home = homeWithDemoCourse()
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: theme === 'light' ? 'en' : 'es', theme } }))
  const dir = join(home, 'Packs', PACK, 'skills')
  for (const file of readdirSync(dir)) {
    const path = join(dir, file), skill = JSON.parse(readFileSync(path, 'utf8')), index = SKILLS.indexOf(skill.id)
    if (index >= 0) skill.lesson = groups[index].map(f => f.block)
    writeFileSync(path, JSON.stringify(skill))
  }
  const path = join(home, 'Packs', PACK, 'progress.json'), progress = JSON.parse(readFileSync(path, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }; writeFileSync(path, JSON.stringify(progress))
  return home
}

async function start(home: string, dark: boolean): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({ args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', `--force-device-scale-factor=${dark ? 2 : 1}`], env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ app: main, session }) => {
      const state = globalThis as unknown as MainAudit; state.diagramAudit = []; state.sourceViewport = []
      main.on('browser-window-created', (_event, win) => {
        const wc = win.webContents
        const audit: Audit = { id: wc.id, shown: 0, destroyed: false, defaultSession: wc.session === session.defaultSession, calls: [] }
        state.diagramAudit.push(audit)
        win.on('show', () => audit.shown++); wc.once('destroyed', () => { audit.destroyed = true })
        const execute = wc.executeJavaScript.bind(wc)
        wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
          const match = /^window\.aulaFigureRender\.(render|resize|normalize)\(([\s\S]*)\)$/.exec(code)
          if (!match) return execute(code, gesture)
          const method = match[1], input = JSON.parse(match[2]) as Record<string, unknown>
          const call: Audit['calls'][number] = { method, input: method === 'normalize' ? { width: input.width, height: input.height } : input }
          audit.calls.push(call)
          try {
            const result = await execute(code, gesture)
            call.result = method === 'normalize' ? { width: result.width, height: result.height } : result
            if (method === 'render') {
              audit.isolation = await execute(`({bridge:'aula' in globalThis,node:typeof require!=='undefined'||typeof process!=='undefined',links:document.querySelectorAll('a[href]').length,images:document.querySelectorAll('img[src]').length,frames:document.querySelectorAll('iframe,object,embed').length,text:document.querySelector('[data-diagram-scene]')?.textContent,fractions:[...document.querySelectorAll('.katex .frac-line')].map(n=>{const c=getComputedStyle(n),b=n.getBoundingClientRect();return{border:c.borderBottomWidth,minHeight:c.minHeight,fontSize:c.fontSize,width:b.width,height:b.height,dpr:devicePixelRatio}})})`)
              if (state.holdDiagram) await new Promise<void>((resolve, reject) => { state.releaseDiagram = resolve; wc.once('destroyed', () => reject(new Error('Fixture capture cancelled'))) })
            }
            return result
          } catch (error) { call.error = String(error); throw error }
        }) as typeof wc.executeJavaScript
      })
    })
    // Diagnóstico del fixture: el DPR expuesto por CDP puede diferir de la cuantización CSS real.
    // Sólo se guardan números/estilos de geometría; no hay texto, rutas, URL ni cabeceras.
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    await page.waitForFunction('!!document.documentElement && !!document.body', null, { timeout: 5_000 })
    const sourceWindow = await app.browserWindow(page)
    const sourceId = await sourceWindow.evaluate(window => window.webContents.id as number)
    await sourceWindow.dispose()
    const recordSourceViewport = async (phase: 'before-setViewportSize' | 'after-setViewportSize'): Promise<void> => {
      const dom = await page.evaluate<unknown>(`(() => {
        const zoomChain = [document.documentElement, document.body].map(element => {
          const css = getComputedStyle(element)
          return { element: element.tagName.toLowerCase(), zoom: css.getPropertyValue('zoom'), transform: css.transform, fontSize: css.fontSize }
        })
        const probe = document.createElement('div')
        probe.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:0;min-height:0;max-height:none;margin:0;padding:0;box-sizing:content-box;visibility:hidden;pointer-events:none;font-size:12px;line-height:1;border:0;border-bottom:0.04em solid rgb(0,0,0)'
        document.body.appendChild(probe)
        try {
          const css = getComputedStyle(probe), box = probe.getBoundingClientRect()
          return {
            devicePixelRatio: window.devicePixelRatio,
            viewport: { width: window.innerWidth, height: window.innerHeight, visualScale: window.visualViewport?.scale ?? null },
            zoomChain,
            probe: {
              requestedFontPx: 12, requestedBorderEm: 0.04,
              fontSize: css.fontSize, zoom: css.getPropertyValue('zoom'), transform: css.transform,
              borderBottomWidth: css.borderBottomWidth, borderBottomStyle: css.borderBottomStyle,
              rect: { width: box.width, height: box.height }, offsetHeight: probe.offsetHeight
            }
          }
        } finally { probe.remove() }
      })()`)
      await app.evaluate(({ BrowserWindow, screen }, { phase, sourceId, dom }) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === sourceId)
        if (!window || window.isDestroyed()) throw new Error('The source fixture window is unavailable')
        const primary = screen.getPrimaryDisplay(), matching = screen.getDisplayMatching(window.getBounds())
        const native = {
          primaryDisplay: { scaleFactor: primary.scaleFactor }, matchingDisplay: { scaleFactor: matching.scaleFactor },
          contentBounds: window.getContentBounds(), zoomFactor: window.webContents.getZoomFactor()
        }
        const state = globalThis as unknown as MainAudit
        const previous = Array.isArray(state.sourceViewport) ? state.sourceViewport : []
        state.sourceViewport = [...previous, { phase, dom, native }]
      }, { phase, sourceId, dom })
    }
    await recordSourceViewport('before-setViewportSize')
    const nativeDpr = await page.evaluate<number>('devicePixelRatio')
    await page.setViewportSize({ width: 1440, height: 1100 })
    await initializeDiagramReference(page, nativeDpr)
    await recordSourceViewport('after-setViewportSize')
    await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
    return { app, page, errors }
  } catch (error) { await app.close().catch(() => undefined); throw error }
}

async function audit(app: ElectronApplication, info: TestInfo, name: string): Promise<Audit[]> {
  const { value, sourceViewport } = await app.evaluate(() => {
    const state = globalThis as unknown as MainAudit
    return { value: state.diagramAudit, sourceViewport: state.sourceViewport ?? null }
  })
  const path = info.outputPath(`${name}-audit.json`), viewportPath = info.outputPath(`${name}-source-viewport.json`)
  writeFileSync(path, JSON.stringify(value, null, 2)); await info.attach(`${name}-audit.json`, { path, contentType: 'application/json' })
  writeFileSync(viewportPath, JSON.stringify(sourceViewport, null, 2))
  await info.attach(`${name}-source-viewport.json`, { path: viewportPath, contentType: 'application/json' })
  return value
}
const action = (figure: Locator): Locator => figure.getByRole('button', { name: /Export figure|Exportar figura/ })
async function destination(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: path === null, filePath: path ?? undefined })) as typeof dialog.showSaveDialog }, path)
}
async function save(app: ElectronApplication, page: Page, figure: Locator, path: string, options: { keyboard?: boolean } = {}): Promise<void> {
  await destination(app, path)
  if (options.keyboard) {
    await action(figure).focus(); await action(figure).press('ArrowDown')
  } else await action(figure).click()
  await expect(page.getByRole('menuitem', { name: /^(Save|Guardar) SVG/ })).toHaveCount(0)
  const png = page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ })
  if (options.keyboard) { await expect(png).toBeFocused(); await png.press('Enter') }
  else await png.click()
  await expect.poll(() => existsSync(path), { timeout: 30_000 }).toBe(true)
  await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('menuitem', { includeHidden: true })).toHaveCount(0)
}
async function inspect(page: Page, file: string, info: TestInfo, name: string): Promise<{ width: number; height: number }> {
  const png = readFileSync(file), width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks: string[] = []
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0)
  expect(Math.max(width, height)).toBeLessThanOrEqual(4096); expect(width * height).toBeLessThanOrEqual(16 * 1024 * 1024)
  for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); chunks.push(png.toString('ascii', at + 4, at + 8)); at += 12 + size }
  expect(chunks.some(c => ['iCCP', 'tEXt', 'zTXt', 'iTXt', 'acTL'].includes(c))).toBe(false)
  // Otra API decodifica el archivo final y comprueba que la superficie entregada sea opaca.
  const decoded = await page.evaluate(`(async () => { const image=new Image(); image.src='data:image/png;base64,${png.toString('base64')}'; await image.decode(); const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let opaque=true;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){opaque=false;break}return{width:c.width,height:c.height,opaque};})()`)
  expect(decoded).toEqual({ width, height, opaque: true })
  await info.attach(`${name}.png`, { path: file, contentType: 'image/png' }); return { width, height }
}
function texts(primitives: DiagramPrimitive[]): string[] {
  return primitives.flatMap(p => p.kind === 'group' ? texts(p.children) : p.kind === 'label' ? p.lines.map(line => line.text) : [])
}
async function scene(app: ElectronApplication, index: number): Promise<DiagramRenderSceneV1> {
  const input = await app.evaluate((_electron, index) => (globalThis as unknown as MainAudit).diagramAudit[index]?.calls.find(c => c.method === 'render')?.input as FigureRenderInput | undefined, index)
  expect(input?.kind).toBe('diagram')
  if (!input || input.kind !== 'diagram') throw new Error('Expected Diagram render input')
  return input.scene
}
async function visibleParts(figure: Locator): Promise<string[]> {
  return figure.locator('[data-diagram-canvas] [data-ask-part]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-ask-part')!).filter(Boolean))
}
async function settle(page: Page, figure: Locator): Promise<void> {
  await figure.locator('.viz-dots').scrollIntoViewIfNeeded(); await page.mouse.move(8, 8)
  await page.waitForTimeout(2400)
  await page.evaluate('document.fonts.ready')
}


interface PausedFlowPhase { phase: number; currentTime: number | null; wasRunning: boolean; playState: string }
/** Sólo el fixture de paridad pausa Animation objects en su fase real; no cambia CSS ni Playing. */
async function pauseVizFlowAtCurrentPhase(figure: Locator): Promise<PausedFlowPhase[]> {
  return evaluateLiveElement<PausedFlowPhase[]>(figure.locator('[data-diagram-canvas]'), `async canvas => {
    if (canvas.__diagramPixelPausedFlows) throw new Error('The pixel fixture already holds flow animations');
    const held = [];
    for (const path of canvas.querySelectorAll('.viz-flow')) for (const animation of path.getAnimations()) {
      if (animation.animationName !== 'viz-flow') continue;
      const wasRunning = animation.playState === 'running';
      held.push({ path, animation, wasRunning });
      if (wasRunning) animation.pause();
    }
    canvas.__diagramPixelPausedFlows = held;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return held.map(({ path, animation, wasRunning }) => ({ phase: parseFloat(getComputedStyle(path).strokeDashoffset), currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null, wasRunning, playState: animation.playState }));
  }`)
}
async function resumePixelFixtureFlows(figure: Locator): Promise<void> {
  await evaluateLiveElement(figure.locator('[data-diagram-canvas]'), `canvas => {
    const held = canvas.__diagramPixelPausedFlows || [];
    delete canvas.__diagramPixelPausedFlows;
    for (const { animation, wasRunning } of held) if (wasRunning) animation.play();
  }`)
}

/** La referencia de imagen muestra la figura detrás de controles ajenos al PNG; no toca el lienzo. */
async function prepareDiagramPixelReference(figure: Locator): Promise<void> {
  await evaluateLiveElement<void>(figure.locator('.viz-dots'), `viewport => {
    if (viewport.__diagramPixelChrome) throw new Error('The pixel fixture already holds viewport controls');
    const canvas=viewport.querySelector('[data-diagram-canvas]'), before=canvas.getBoundingClientRect();
    const typography=()=>{const c=getComputedStyle(canvas);return[c.fontFamily,c.fontSize,c.fontStyle,c.transform].join('|');}, beforeStyle=typography();
    const held=[];viewport.__diagramPixelChrome=held;
    for(const child of viewport.children){
      if(child===canvas||child.contains(canvas))continue;
      if(child.matches('[data-ask-part]')||child.querySelector('[data-ask-part]'))throw new Error('The fixture cannot hide Diagram content');
      if(!child.matches('button,[role=button]')&&!child.querySelector('button,[role=button]')&&!child.classList.contains('pointer-events-none'))throw new Error('Unknown Diagram viewport sibling');
      held.push({child,value:child.style.getPropertyValue('visibility'),priority:child.style.getPropertyPriority('visibility')});
      child.style.setProperty('visibility','hidden','important');
    }
    const after=canvas.getBoundingClientRect();
    if(['x','y','width','height'].some(key=>before[key]!==after[key])||beforeStyle!==typography())throw new Error('Hiding viewport controls changed Diagram geometry or typography');
  }`)
}
async function restoreDiagramPixelReference(figure: Locator): Promise<void> {
  await evaluateLiveElement<void>(figure.locator('.viz-dots'), `viewport => {
    const held=viewport.__diagramPixelChrome||[];delete viewport.__diagramPixelChrome;
    for(const{child,value,priority}of held){if(value)child.style.setProperty('visibility',value,priority);else child.style.removeProperty('visibility');}
  }`)
}

async function captureWithLiveComparison(app: ElectronApplication, page: Page, figure: Locator, file: string, info: TestInfo, name: string, options: { expectedEmpty?: boolean; requireMath?: boolean; keyboard?: boolean } = {}): Promise<{ dimensions: { width: number; height: number }; natural: { width: number; height: number } }> {
  try {
    await prepareDiagramPixelReference(figure)
    const phases = await pauseVizFlowAtCurrentPhase(figure)
    expect(phases.every(p => Number.isFinite(p.phase) && p.playState === 'paused')).toBe(true)
    if (phases.some(p => p.wasRunning)) expect(phases.some(p => p.wasRunning && Math.abs(p.phase) > 0.00001)).toBe(true)
    const { png: live, geometry } = await captureDiagramReference(page, figure, info, name, { expectedEmpty: options.expectedEmpty, phases })
    await save(app, page, figure, file, { keyboard: options.keyboard })
    const dimensions = await inspect(page, file, info, name)
    const comparison = await compareDiagramPixels(page, live, readFileSync(file), geometry, info, name, 'dense')
    if (options.requireMath) expect(comparison.labels.filter(label => label.kind === 'math' && !label.skipped).length, 'The independent oracle must inspect a separately clipped formula area').toBeGreaterThan(0)
    return { dimensions, natural: { width: geometry.canvas.naturalWidth, height: geometry.canvas.naturalHeight } }
  } finally { try { await resumePixelFixtureFlows(figure) } finally { await restoreDiagramPixelReference(figure) } }
}

for (const theme of ['light', 'dark'] as const) for (const fixture of DIAGRAM_FIXTURES) {
  test(`Diagram PNG: ${fixture.key}, construcción y layout en ${theme}`, async ({}, info) => {
    // Cada familia tiene datos y aplicación propios: un fallo no impide comprobar las restantes.
    const home = prepare(theme), source = lifecycleLesson(home, [fixture.block])
    const { app, page, errors } = await start(home, theme === 'dark')
    let captureIndex = 0
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
      const figure = page.locator('[data-block="diagram"]').first()
      // en modo editorial la barra lateral está plegada por defecto; al desplegarla a mano, a 800 px la figura vuelve a ser estrecha
      if (fixture.narrow) {
        await page.getByRole('button', { name: /^(More sections|Más secciones)$/ }).first().click()
        await page.getByRole('menuitem', { name: /^(Expand sidebar|Desplegar la barra)$/ }).click()
      }
      await page.setViewportSize({ width: fixture.narrow ? 800 : 1440, height: 1100 })
      await settle(page, figure)
      const progressPath = join(home, 'Packs', PACK, 'progress.json'), beforeProgress = readFileSync(progressPath, 'utf8')
      if (fixture.family === 'pyramid' || fixture.family === 'funnel') {
        // Observa la rama responsive real: tres líderes laterales en ancho, detalles dentro en estrecho.
        const leaders = figure.locator('[data-diagram-canvas] path[stroke-dasharray="1.5 4"]')
        await expect(leaders).toHaveCount(fixture.narrow ? 0 : 3)
      }
      if (fixture.block.steps.length) {
        // Vista general sin paso resaltado: incluye el icono central del ciclo y formas sin atenuación.
        await captureWithLiveComparison(app, page, figure, join(home, `${theme}-${fixture.key}-overview.png`), info, `${fixture.key}-overview`, { requireMath: true })
        const overview = await scene(app, captureIndex++)
        expect(overview.family).toBe(fixture.family); expect(JSON.stringify(overview)).not.toContain('PRIVATE_')
        await figure.getByRole('button', { name: /Next step|Paso siguiente/ }).click()
        await settle(page, figure)
        const shown = new Set(await visibleParts(figure)), file = join(home, `${theme}-${fixture.key}-first.png`)
        await captureWithLiveComparison(app, page, figure, file, info, `${fixture.key}-first`, { requireMath: true })
        const input = await scene(app, captureIndex++)
        expect(input.family).toBe(fixture.family)
        expect(JSON.stringify(input)).not.toContain('PRIVATE_')
        for (const node of fixture.block.nodes.filter(node => !shown.has(node.id))) {
          expect(texts(input.primitives)).not.toContain(node.label)
          if (node.detail) expect(texts(input.primitives)).not.toContain(node.detail)
        }
        await figure.getByRole('button', { name: /Next step|Paso siguiente/ }).click()
        await settle(page, figure)
      }
      const file = join(home, `${theme}-${fixture.key}.png`)
      const { dimensions, natural } = await captureWithLiveComparison(app, page, figure, file, info, fixture.key, { requireMath: fixture.key !== 'fallback' })
      const input = await scene(app, captureIndex++)
      expect(input.family).toBe(fixture.family); expect(JSON.stringify(input)).not.toContain('PRIVATE_')
      expect(dimensions.width).toBeGreaterThanOrEqual(Math.min(4096, Math.ceil(natural.width)))
      expect(dimensions.height).toBeGreaterThanOrEqual(Math.min(4096, Math.ceil(natural.height)))
      expect(input.canvas).toEqual(natural)
      const results = await audit(app, info, `${theme}-${fixture.key}-verified`)
      expect(results).toHaveLength(captureIndex)
      for (const result of results) {
        expect(result.shown).toBe(0); expect(result.defaultSession).toBe(false); expect(result.destroyed).toBe(true)
        expect(result.isolation).toMatchObject({ bridge: false, node: false, links: 0, images: 0, frames: 0 })
        expect(result.calls.map(c => c.method)).toEqual(['render', 'resize', 'normalize'])
        expect(result.calls.every(c => !c.error)).toBe(true)
      }
      expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
      expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
      expect(errors).toEqual([])
    } finally { await audit(app, info, `${theme}-${fixture.key}`); await app.close() }
  })
}

test('Diagram PNG exporta el lienzo de un paso narrativo vacío', async ({}, info) => {
  const home = prepare('light'), path = join(home, 'Packs', PACK, 'skills', `${SKILLS[0]}.json`), skill = JSON.parse(readFileSync(path, 'utf8'))
  skill.lesson = [EMPTY_DIAGRAM]; writeFileSync(path, JSON.stringify(skill))
  const { app, page, errors } = await start(home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first()
    await figure.getByRole('button', { name: 'Next step', exact: true }).click(); await settle(page, figure)
    await expect(figure.locator('[data-diagram-canvas] [data-ask-part]')).toHaveCount(0)
    const file = join(home, 'empty.png')
    await captureWithLiveComparison(app, page, figure, file, info, 'empty', { expectedEmpty: true })
    const input = await scene(app, 0)
    expect(input.primitives).toEqual([]); expect(JSON.stringify(input)).not.toContain('HIDDEN_FUTURE_LABEL')
    expect(errors).toEqual([])
  } finally { await audit(app, info, 'empty'); await app.close() }
})

type LifecycleDiagram = typeof EMPTY_DIAGRAM
const CONTEXT_DIAGRAM: LifecycleDiagram = {
  id: 'lifecycle-context', type: 'diagram', kind: 'flow', direction: 'lr', title: 'Context fixture',
  nodes: [{ id: 'a', label: 'مرحلة $\\frac{a+b}{c}$', shape: 'round', color: 'blue' }, { id: 'b', label: 'Result $x_1^2$', shape: 'box', color: 'green' }],
  edges: [{ from: 'a', to: 'b', arrow: true, dashed: false }], steps: []
}

function lifecycleLesson(home: string, blocks: readonly unknown[]): { path: string; bytes: string } {
  const path = join(home, 'Packs', PACK, 'skills', `${SKILLS[0]}.json`), skill = JSON.parse(readFileSync(path, 'utf8'))
  skill.lesson = blocks; writeFileSync(path, JSON.stringify(skill))
  return { path, bytes: readFileSync(path, 'utf8') }
}
function lifecycleFullMotion(home: string): void {
  const path = join(home, 'settings.json'), settings = JSON.parse(readFileSync(path, 'utf8'))
  settings.general.motion = 'full'; writeFileSync(path, JSON.stringify(settings))
}
async function holdDiagramCapture(app: ElectronApplication, hold: boolean): Promise<void> {
  await app.evaluate((_electron, hold) => {
    const state = globalThis as unknown as MainAudit
    state.holdDiagram = hold
    if (!hold) { state.releaseDiagram?.(); state.releaseDiagram = undefined }
  }, hold)
}
async function waitHeldDiagram(app: ElectronApplication, index: number): Promise<void> {
  await expect.poll(() => app.evaluate((_electron, index) => {
    const state = globalThis as unknown as MainAudit
    return !!state.releaseDiagram && !!state.diagramAudit[index]?.calls.find(call => call.method === 'render')?.result
  }, index)).toBe(true)
}
async function chooseDiagramPng(page: Page, figure: Locator): Promise<void> {
  await action(figure).click()
  await page.getByRole('menuitem', { name: /^Save PNG/ }).click()
}
function lifecycleLeaves(primitives: DiagramPrimitive[]): Exclude<DiagramPrimitive, { kind: 'group' }>[] {
  return primitives.flatMap(primitive => primitive.kind === 'group' ? primitive.children : [primitive])
}

test('Diagram PNG: navegar cancela, el diálogo conserva foco/progreso y se puede reintentar', async ({}, info) => {
  const home = prepare('light'), source = lifecycleLesson(home, [CONTEXT_DIAGRAM]), { app, page, errors } = await start(home, false)
  const canceled = join(home, 'diagram-must-not-exist.png')
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first()
    await settle(page, figure)
    await destination(app, canceled); await holdDiagramCapture(app, true)
    await chooseDiagramPng(page, figure); await waitHeldDiagram(app, 0)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'true')
    const busy = figure.locator('[data-figure-export] button[aria-haspopup="menu"]')
    await expect(busy).toHaveAttribute('aria-disabled', 'true')
    await busy.press('ArrowDown'); await expect(page.getByRole('menuitem')).toHaveCount(0)
    await go(page, { name: 'home' })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(existsSync(canceled)).toBe(false)
    await holdDiagramCapture(app, false)

    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] }); await settle(page, figure)
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    await destination(app, null); await chooseDiagramPng(page, figure)
    // Debe comenzar y terminar otro trabajo: aria-busy=false inicial por sí solo no prueba el diálogo.
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as MainAudit).diagramAudit.length)).toBe(2)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    await expect(action(figure)).toBeFocused()
    expect(readFileSync(progressPath, 'utf8')).toBe(before)
    expect(existsSync(canceled)).toBe(false)

    const retry = join(home, 'diagram-after-cancel.png')
    await save(app, page, figure, retry); await inspect(page, retry, info, 'diagram-after-cancel')
    const results = await audit(app, info, 'diagram-lifecycle-verified')
    expect(results).toHaveLength(3)
    expect(results.every(result => result.destroyed && !result.defaultSession && result.shown === 0)).toBe(true)
    expect(results.slice(1).every(result => result.calls.every(call => !call.error))).toBe(true)
    expect(readFileSync(progressPath, 'utf8')).toBe(before)
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
    expect(errors).toEqual([])
  } finally {
    try { await holdDiagramCapture(app, false); await audit(app, info, 'diagram-lifecycle') }
    finally { await app.close() }
  }
})

// Excepción sólo del fixture: conserva el renderer original y su validación; rechaza una vez
// DESPUÉS de que render(input) haya terminado. No sustituye IPC, captura, guardado ni cancelación.
async function failNextPrivateDiagramRender(app: ElectronApplication, marker: string): Promise<void> {
  await app.evaluate(({ app: main }, marker) => {
    const state = globalThis as unknown as MainAudit & {
      diagramFailureFixture: { armed: boolean; fired: number; stack: string }
    }
    state.diagramFailureFixture = { armed: true, fired: 0, stack: '' }
    main.on('browser-window-created', (_event, window) => {
      const wc = window.webContents, execute = wc.executeJavaScript.bind(wc)
      // Se registra después del observador MainAudit de start(): éste conserva input y error reales.
      wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
        const match = /^window\.aulaFigureRender\.render\(([\s\S]*)\)$/.exec(code)
        const input = match ? JSON.parse(match[1]) as FigureRenderInput : undefined
        if (!state.diagramFailureFixture.armed || input?.kind !== 'diagram') return execute(code, gesture)
        state.diagramFailureFixture.armed = false
        state.diagramFailureFixture.fired++
        await execute(`(() => {
          const api = window.aulaFigureRender, original = api.render.bind(api);
          api.render = async input => {
            api.render = original;
            await original(input);
            throw new Error(${JSON.stringify(marker)});
          };
        })()`, false)
        try { return await execute(code, gesture) }
        catch (error) {
          state.diagramFailureFixture.stack = error instanceof Error ? error.stack || error.message : String(error)
          throw error
        }
      }) as typeof wc.executeJavaScript
    })
  }, marker)
}

test('Diagram PNG: un fallo real de render muestra error localizado, limpia y permite reintentar', async ({}, info) => {
  const home = prepare('dark'), source = lifecycleLesson(home, [CONTEXT_DIAGRAM])
  const marker = 'Diagram E2E deliberate private render failure'
  const packPath = join(home, 'Packs', PACK, 'pack.json'), packBefore = readFileSync(packPath, 'utf8')
  const failed = join(home, 'diagram-render-failed.png'), retry = join(home, 'diagram-render-retry.png')
  const { app, page, errors } = await start(home, true)
  try {
    await failNextPrivateDiagramRender(app, marker)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first()
    await settle(page, figure)
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), beforeProgress = readFileSync(progressPath, 'utf8')
    const canvas = figure.locator('[data-diagram-canvas]')
    const beforeContext = await evaluateLiveElement<{ family: string; style: string; transform: string }>(canvas,
      'element => ({ family: getComputedStyle(element).fontFamily, style: getComputedStyle(element).fontStyle, transform: element.style.transform })')

    await destination(app, failed)
    await action(figure).focus(); await action(figure).press('ArrowDown')
    const png = page.getByRole('menuitem', { name: /^Guardar PNG/ })
    await expect(png).toBeFocused(); await png.press('Enter')
    await expect(page.getByText('No se pudo guardar el dibujo', { exact: true })).toBeVisible()
    await expect(page.getByText('Could not save the drawing', { exact: true })).toHaveCount(0)
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    await expect(action(figure)).toHaveAttribute('aria-disabled', 'false')
    await expect(action(figure)).toBeFocused()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(existsSync(failed)).toBe(false)
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
    expect(readFileSync(packPath, 'utf8')).toBe(packBefore)
    expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)

    const first = await audit(app, info, 'diagram-real-error')
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ shown: 0, destroyed: true, defaultSession: false })
    expect(first[0].calls.map(call => call.method)).toEqual(['render'])
    expect(first[0].calls[0].error).toContain(marker)
    const failedScene = await scene(app, 0)
    const failure = await app.evaluate(() => (globalThis as unknown as {
      diagramFailureFixture: { armed: boolean; fired: number; stack: string }
    }).diagramFailureFixture)
    expect(failure).toMatchObject({ armed: false, fired: 1 })
    expect(failure.stack).toContain(marker)
    await info.attach('diagram-real-error-stack.json', { body: JSON.stringify(failure, null, 2), contentType: 'application/json' })

    // Es el mismo flujo real de PNG, después del rechazo: no se navega ni se recarga el curso.
    await captureWithLiveComparison(app, page, figure, retry, info, 'diagram-real-error-retry', { requireMath: true, keyboard: true })
    await expect(page.getByText('Dibujo guardado', { exact: true })).toBeVisible()
    await expect(action(figure)).toBeFocused()
    expect(await scene(app, 1)).toEqual(failedScene)
    expect(await evaluateLiveElement(canvas,
      'element => ({ family: getComputedStyle(element).fontFamily, style: getComputedStyle(element).fontStyle, transform: element.style.transform })')).toEqual(beforeContext)
    const results = await audit(app, info, 'diagram-real-error-retry-verified')
    expect(results).toHaveLength(2)
    expect(results.every(result => result.destroyed && !result.defaultSession && result.shown === 0)).toBe(true)
    expect(results[1].calls.map(call => call.method)).toEqual(['render', 'resize', 'normalize'])
    expect(results[1].calls.every(call => !call.error)).toBe(true)
    expect(results[1].isolation).toMatchObject({ bridge: false, node: false, links: 0, images: 0, frames: 0 })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(existsSync(failed)).toBe(false)
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
    expect(readFileSync(packPath, 'utf8')).toBe(packBefore)
    expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
    expect(await app.evaluate(() => (globalThis as unknown as { diagramFailureFixture: { fired: number } }).diagramFailureFixture.fired)).toBe(1)
    expect(errors).toEqual([])
  } finally { try { await audit(app, info, 'diagram-real-error-final') } finally { await app.close() } }
})

test('Diagram PNG: zoom y arrastre conservan la escena natural y los mismos bytes PNG', async ({}, info) => {
  const home = prepare('light')
  const wide: LifecycleDiagram = {
    ...CONTEXT_DIAGRAM, id: 'lifecycle-wide', title: 'Wide canvas',
    nodes: Array.from({ length: 9 }, (_, i) => ({ id: `wide-${i}`, label: `Node ${i} with a visible label`, shape: 'box' as const, color: i % 2 ? 'green' : 'blue' })),
    edges: Array.from({ length: 8 }, (_, i) => ({ from: `wide-${i}`, to: `wide-${i + 1}`, arrow: true, dashed: false })), steps: []
  }
  const source = lifecycleLesson(home, [wide]), { app, page, errors } = await start(home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first(), canvas = figure.locator('[data-diagram-canvas]'), well = figure.locator('.viz-dots')
    await settle(page, figure)
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), beforeProgress = readFileSync(progressPath, 'utf8')
    const first = join(home, 'diagram-natural.png'); await save(app, page, figure, first)
    const initial = await scene(app, 0), initialTransform = await evaluateLiveElement<string>(canvas, 'element => element.style.transform')
    expect(initialTransform).toContain('scale(')
    await figure.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect.poll(() => evaluateLiveElement<string>(canvas, 'element => element.style.transform')).not.toBe(initialTransform)
    // Espera sólo la transición de viewport; no hay pasos ni viz-flow animado en este fixture.
    await page.waitForTimeout(350)
    const zoomTransform = await evaluateLiveElement<string>(canvas, 'element => element.style.transform'), box = (await well.boundingBox())!
    await page.mouse.move(box.x + box.width * .65, box.y + box.height * .65)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .65 - 90, box.y + box.height * .65 - 30, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => evaluateLiveElement<string>(canvas, 'element => element.style.transform')).not.toBe(zoomTransform)
    // Evita que el hover accidental de un nodo forme parte del segundo snapshot.
    await page.mouse.move(8, 8); await settle(page, figure)
    const transformBeforeExport = await evaluateLiveElement<string>(canvas, 'element => element.style.transform')
    const second = join(home, 'diagram-pan-zoom.png'); await save(app, page, figure, second)
    expect(await scene(app, 1)).toEqual(initial)
    expect(readFileSync(second).equals(readFileSync(first))).toBe(true)
    expect(await evaluateLiveElement<string>(canvas, 'element => element.style.transform')).toBe(transformBeforeExport)
    await inspect(page, first, info, 'diagram-natural'); await inspect(page, second, info, 'diagram-pan-zoom')
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
    expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
    expect(errors).toEqual([])
  } finally { try { await audit(app, info, 'diagram-pan-zoom') } finally { await app.close() } }
})

interface DiagramClickFrame { flows: Array<{ d: string; offset: number }>; counter: string; caption: string }
test('Diagram PNG: captura el flujo y contador del click mientras la reproducción continúa', async ({}, info) => {
  const home = prepare('light'); lifecycleFullMotion(home)
  const cycle: LifecycleDiagram = {
    ...CONTEXT_DIAGRAM, id: 'lifecycle-playback', kind: 'cycle', title: 'Playback fixture',
    nodes: [{ id: 'a', label: 'First', shape: 'round' }, { id: 'b', label: 'Second', shape: 'round' }, { id: 'c', label: 'Third', shape: 'round' }],
    edges: [{ from: 'a', to: 'b', arrow: true, dashed: false }, { from: 'b', to: 'c', arrow: true, dashed: false }, { from: 'c', to: 'a', arrow: true, dashed: false }],
    // Diez pasos dejan margen a CI; el mismo tramo sigue encendido mientras cambia el contador.
    steps: Array.from({ length: 10 }, (_, i) => ({ title: `HIDDEN_PLAY_TITLE_${i}`, md: `HIDDEN_PLAY_GUIDE_${i}`, nodes: [], edges: [['a', 'b']] }))
  }
  const source = lifecycleLesson(home, [cycle]), { app, page, errors } = await start(home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first()
    await settle(page, figure)
    await expect(page.locator('html')).not.toHaveClass(/(?:^|\s)reduce-motion(?:\s|$)/)
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), beforeProgress = readFileSync(progressPath, 'utf8')
    // Captura DOM independiente anterior al manejador React del menú; no consulta la proyección de exportación.
    await page.evaluate(`(() => {
      window.diagramClickFrames=[];
      window.readDiagramClickFrame=()=>{
        const root=document.querySelector('[data-block="diagram"] [data-diagram-canvas]');
        const counter=[...root.querySelectorAll('.font-serif.tabular')].find(node=>/^\\d+$/.test(node.textContent.trim()));
        return {flows:[...root.querySelectorAll('[data-diagram-flow]')].map(node=>({d:node.getAttribute('d'),offset:parseFloat(getComputedStyle(node).strokeDashoffset)})),counter:counter.textContent.trim(),caption:counter.nextElementSibling.textContent.trim()};
      };
      document.addEventListener('click',event=>{
        if(event.target.closest('[role="menuitem"]')?.textContent.startsWith('Save PNG')) window.diagramClickFrames.push(window.readDiagramClickFrame());
      },true);
    })()`)
    await figure.getByRole('button', { name: 'Watch the process', exact: true }).click()
    await expect(figure.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(figure.locator('[data-diagram-flow]')).toHaveCount(1)
    // AULA_HIDDEN pausa los bucles ambientales. Sólo este path del fixture simula una figura visible,
    // con prioridad inline frente al selector ambiental; conserva el reloj real y se restaura en finally.
    await evaluateLiveElement<void>(figure, `figure => {
      const paths=[...figure.querySelectorAll('[data-diagram-flow].viz-flow')].map(path=>({path,value:path.style.getPropertyValue('animation-play-state'),priority:path.style.getPropertyPriority('animation-play-state')}));
      window.restoreDiagramFlow=()=>{for(const{path,value,priority}of paths){if(value)path.style.setProperty('animation-play-state',value,priority);else path.style.removeProperty('animation-play-state');}delete window.restoreDiagramFlow;};
      for(const{path}of paths)path.style.setProperty('animation-play-state','running','important');
    }`)
    await expect(figure.locator('[data-diagram-flow]')).toHaveCSS('animation-play-state', 'running')
    const file = join(home, 'diagram-playing.png')
    await destination(app, file); await holdDiagramCapture(app, true)
    await chooseDiagramPng(page, figure); await waitHeldDiagram(app, 0)
    const frozen = await scene(app, 0), clicked = await page.evaluate<DiagramClickFrame>('window.diagramClickFrames[0]')
    await info.attach('diagram-playback-click.json', { body: JSON.stringify(clicked), contentType: 'application/json' })
    const leaves = lifecycleLeaves(frozen.primitives)
    const flow = leaves.filter((leaf): leaf is Extract<DiagramPrimitive, { kind: 'path' }> => leaf.kind === 'path' && leaf.dash.length === 2 && leaf.dash[0] === 2 && leaf.dash[1] === 12)
    expect(flow.map(path => ({ d: path.d, offset: path.dashOffset }))).toEqual(clicked.flows)
    expect(clicked.flows).toHaveLength(1)
    expect(clicked.flows.every(path => Number.isFinite(path.offset))).toBe(true)
    const counter = leaves.find(leaf => leaf.kind === 'label' && leaf.lines[0]?.content === 'plain' && leaf.lines[0]?.size === 34)
    expect(counter?.kind).toBe('label')
    if (!counter || counter.kind !== 'label') throw new Error('Expected cycle counter in frozen scene')
    expect(counter.lines.map(line => line.text)).toEqual([clicked.counter, clicked.caption])
    expect(JSON.stringify(frozen)).not.toContain('HIDDEN_PLAY_')
    // Ambos progresan con sus relojes reales mientras main sigue esperando el render privado retenido.
    await expect.poll(() => page.evaluate('Number(window.readDiagramClickFrame().counter)')).toBeGreaterThan(Number(clicked.counter))
    await expect(figure.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(figure.locator('[data-diagram-flow]')).toHaveCSS('animation-play-state', 'running')
    await expect.poll(() => page.evaluate('window.readDiagramClickFrame().flows[0].offset')).not.toBe(clicked.flows[0].offset)
    expect(await app.evaluate(() => !!(globalThis as unknown as MainAudit).releaseDiagram)).toBe(true)
    expect(await scene(app, 0)).toEqual(frozen)
    await holdDiagramCapture(app, false)
    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true)
    await inspect(page, file, info, 'diagram-playing')
    await expect(figure.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
    expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
    expect(errors).toEqual([])
  } finally {
    try {
      await holdDiagramCapture(app, false)
      await page.evaluate('window.restoreDiagramFlow?.()')
      await audit(app, info, 'diagram-playback')
    }
    finally { await app.close() }
  }
})

interface DiagramNativeContext { family: string; style: string; language: string; direction: string; mathDirection: string | null }
async function observeDiagramContext(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: main }) => {
    const state = globalThis as unknown as MainAudit & { diagramContexts: DiagramNativeContext[] }; state.diagramContexts = []
    main.on('browser-window-created', (_event, window) => {
      const wc = window.webContents, previous = wc.executeJavaScript.bind(wc)
      wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
        const result = await previous(code, gesture)
        if (/^window\.aulaFigureRender\.render\(/.test(code)) {
          state.diagramContexts.push(await previous(`(() => {const root=document.querySelector('[data-diagram-scene]'),rich=root.querySelector('.drawing-static-text'),math=root.querySelector('.katex'),css=getComputedStyle(root);return{family:css.fontFamily,style:css.fontStyle,language:rich.lang,direction:getComputedStyle(rich).direction,mathDirection:math?getComputedStyle(math).direction:null};})()`, false))
        }
        return result
      }) as typeof wc.executeJavaScript
    })
  })
}
async function nativeDiagramContext(app: ElectronApplication, index: number): Promise<DiagramNativeContext> {
  return app.evaluate((_electron, index) => (globalThis as unknown as { diagramContexts: DiagramNativeContext[] }).diagramContexts[index], index)
}

test('Diagram PNG: prosa RTL y matemáticas LTR llegan a la captura nativa', async ({}, info) => {
  const home = prepare('light'), source = lifecycleLesson(home, [CONTEXT_DIAGRAM]), packPath = join(home, 'Packs', PACK, 'pack.json')
  const pack = JSON.parse(readFileSync(packPath, 'utf8')); pack.language = 'ar'; writeFileSync(packPath, JSON.stringify(pack))
  const packBefore = readFileSync(packPath, 'utf8'), { app, page, errors } = await start(home, false)
  try {
    await observeDiagramContext(app)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first(); await settle(page, figure)
    await expect(figure.locator('[data-diagram-canvas] .aula-rich-inline[dir="rtl"]').first()).toBeVisible()
    expect(await evaluateLiveElement<string>(figure.locator('.katex').first(), 'element => getComputedStyle(element).direction')).toBe('ltr')
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    const file = join(home, 'diagram-rtl.png'); await captureWithLiveComparison(app, page, figure, file, info, 'diagram-rtl', { requireMath: true })
    expect((await scene(app, 0)).appearance).toMatchObject({ language: 'ar', direction: 'rtl' })
    expect(await nativeDiagramContext(app, 0)).toMatchObject({ language: 'ar', direction: 'rtl', mathDirection: 'ltr' })
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes); expect(readFileSync(packPath, 'utf8')).toBe(packBefore)
    expect(readFileSync(progressPath, 'utf8')).toBe(before); expect(errors).toEqual([])
  } finally { try { await audit(app, info, 'diagram-rtl') } finally { await app.close() } }
})

test('Diagram PNG: hereda serif, rounded y cursiva de Slides reales', async ({}, info) => {
  test.setTimeout(120_000)
  const home = prepare('light')
  const cases = [
    { key: 'academic', theme: 'academic', layout: 'content' as const, font: 'serif', italic: false },
    { key: 'chalk', theme: 'chalk', layout: 'content' as const, font: 'rounded', italic: false },
    { key: 'quote', theme: 'aula', layout: 'quote' as const, font: 'serif', italic: true }
  ]
  // Slides no es un BlockOf<'slides'>: el formato de disco conserva type:'slides' y decodeDeck lee su payload.
  const decks = cases.map(c => {
    const slide: import('../../src/shared/schema/cards').Slide = { id: `slide-${c.key}`, layout: c.layout, blocks: [{ ...CONTEXT_DIAGRAM, id: `diagram-${c.key}` }], right: [] }
    return { id: `deck-${c.key}`, type: 'slides', title: `Deck ${c.key}`, theme: c.theme, transition: 'none', slides: [slide] }
  })
  const source = lifecycleLesson(home, decks), { app, page, errors } = await start(home, false)
  try {
    await observeDiagramContext(app)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i], figure = page.locator('[data-block="diagram"]').nth(i); await settle(page, figure)
      const sourceFont = await evaluateLiveElement<Pick<DiagramNativeContext, 'family' | 'style'>>(figure.locator('[data-diagram-canvas]'), 'element => ({family:getComputedStyle(element).fontFamily,style:getComputedStyle(element).fontStyle})')
      const progressPath = join(home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
      const file = join(home, `diagram-slide-${c.key}.png`); await captureWithLiveComparison(app, page, figure, file, info, `diagram-slide-${c.key}`, { requireMath: true })
      expect((await scene(app, i)).metrics).toMatchObject({ bodyFont: c.font, bodyItalic: c.italic })
      expect(await nativeDiagramContext(app, i)).toMatchObject(sourceFont)
      expect(readFileSync(progressPath, 'utf8')).toBe(before)
    }
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes); expect(errors).toEqual([])
  } finally { try { await audit(app, info, 'diagram-slide-contexts') } finally { await app.close() } }
})

// Opcional: mono está admitido por el DTO, pero no existe un tema mono en el esquema Deck actual.
// Este caso cambia sólo el estilo del DOM fixture, sin inventar propiedades de curso ni un flujo de producto.
test('Diagram PNG: contexto mono conocido del fixture se conserva en la captura nativa', async ({}, info) => {
  const home = prepare('light'), source = lifecycleLesson(home, [CONTEXT_DIAGRAM]), { app, page, errors } = await start(home, false)
  try {
    await observeDiagramContext(app)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
    const figure = page.locator('[data-block="diagram"]').first(); await settle(page, figure)
    // Coincide exactamente con DIAGRAM_FONTS.mono; no hay FONT_STACK.mono en los temas de Slides.
    await evaluateLiveElement<void>(figure, 'element => { element.style.fontFamily = "var(--font-mono)" }')
    await page.evaluate('document.fonts.ready')
    const sourceFont = await evaluateLiveElement<Pick<DiagramNativeContext, 'family' | 'style'>>(figure.locator('[data-diagram-canvas]'), 'element => ({family:getComputedStyle(element).fontFamily,style:getComputedStyle(element).fontStyle})')
    const progressPath = join(home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    const file = join(home, 'diagram-mono-context.png'); await captureWithLiveComparison(app, page, figure, file, info, 'diagram-mono-context', { requireMath: true })
    expect((await scene(app, 0)).metrics).toMatchObject({ bodyFont: 'mono', bodyItalic: false })
    expect(await nativeDiagramContext(app, 0)).toMatchObject(sourceFont)
    expect(readFileSync(source.path, 'utf8')).toBe(source.bytes); expect(readFileSync(progressPath, 'utf8')).toBe(before)
    expect(errors).toEqual([])
  } finally { try { await audit(app, info, 'diagram-mono-context') } finally { await app.close() } }
})

type VennHoverCircle = Extract<DiagramPrimitive, { kind: 'venn-region' }>['include'][number]
interface VennHoverSource {
  canvas: { width: number; height: number }
  visible: Array<{ id: string; circle: VennHoverCircle }>
  definitions: VennHoverCircle[]
  hoveredParts: string[]
  region: { whole: boolean; include: VennHoverCircle[]; exclude: VennHoverCircle[] } | null
}
interface VennHoverCase { key: string; members: string[]; whole: boolean }

function vennHoverSystemCursor(home: string): void {
  const path = join(home, 'settings.json'), settings = JSON.parse(readFileSync(path, 'utf8'))
  settings.general.cursor = 'system'; writeFileSync(path, JSON.stringify(settings))
}

/** Lee atributos SVG pintados y estilos comprometidos, sin usar layout interno, DTO ni bounds del exportador. */
async function vennHoverSource(figure: Locator): Promise<VennHoverSource> {
  return evaluateLiveElement<VennHoverSource>(figure.locator('[data-diagram-canvas]'), `canvas => {
    const svg = canvas.querySelector(':scope > svg');
    if (!svg) throw new Error('The live Venn SVG is unavailable');
    const circle = element => {
      if (!element) throw new Error('The live Venn clip circle is unavailable');
      const value = { cx: Number(element.getAttribute('cx')), cy: Number(element.getAttribute('cy')), r: Number(element.getAttribute('r')) };
      if (!Object.values(value).every(Number.isFinite) || value.r <= 0) throw new Error('The live Venn circle has invalid geometry');
      return value;
    };
    const visible = element => {
      for (let node = element; node; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) return false;
      }
      return true;
    };
    const reference = (value, tag) => {
      const match = /^url\\(#([^)]*)\\)$/.exec(value || '');
      const node = match && Array.from(svg.querySelectorAll(tag)).find(candidate => candidate.id === match[1]);
      if (!node) throw new Error('The live Venn clipping reference is unavailable');
      return node;
    };
    const overlay = svg.querySelector(':scope > g[pointer-events="none"]');
    let region = null;
    if (overlay) {
      const include = Array.from(overlay.querySelectorAll('g[clip-path]')).map(node => circle(reference(node.getAttribute('clip-path'), 'clipPath').querySelector('circle')));
      const mask = overlay.getAttribute('mask');
      const exclude = mask ? Array.from(reference(mask, 'mask').querySelectorAll('circle')).map(circle) : [];
      if (!include.length) throw new Error('The live Venn hover has no clipping circle');
      region = { whole: !mask, include, exclude };
    }
    const css = getComputedStyle(canvas);
    return {
      canvas: { width: parseFloat(css.width), height: parseFloat(css.height) },
      visible: Array.from(svg.querySelectorAll(':scope > g > circle')).filter(visible).map(node => ({ id: node.getAttribute('data-ask-part'), circle: circle(node) })),
      definitions: Array.from(svg.querySelectorAll('clipPath > circle')).map(circle),
      hoveredParts: Array.from(canvas.querySelectorAll('[data-ask-part]:hover')).map(node => node.getAttribute('data-ask-part')),
      region
    };
  }`)
}

async function hoverVennPart(figure: Locator, selected: VennHoverCase): Promise<void> {
  const canvas = figure.locator('[data-diagram-canvas]')
  if (selected.whole) {
    // El título tiene su propio handler de círculo completo; evita una región superpuesta al círculo SVG.
    await canvas.locator(`.viz-label[data-ask-part="${selected.members[0]}"] > span`).hover()
  } else {
    const region = canvas.locator(`[data-ask-part="region:${selected.members.join('&')}"]`)
    await expect(region).toHaveCount(1)
    const box = await region.boundingBox()
    if (!box || box.width <= 2 || box.height <= 2) throw new Error('The live Venn region cannot receive a pointer')
    // La franja central superior de 4 px queda fuera del rótulo interior y dentro de las esquinas redondeadas.
    await region.hover({ position: { x: box.width / 2, y: 1 } })
  }
  await expect.poll(async () => {
    const live = await vennHoverSource(figure)
    if (!live.region) return null
    return { whole: live.region.whole, include: live.region.include }
  }).toEqual({
    whole: selected.whole,
    include: (await vennHoverSource(figure)).visible.filter(item => selected.members.includes(item.id)).map(item => item.circle)
  })
}

async function captureHoveredVenn(app: ElectronApplication, page: Page, figure: Locator, home: string, info: TestInfo, name: string, index: number, selected: VennHoverCase, visibleIds: string[], count: 2 | 3): Promise<void> {
  await hoverVennPart(figure, selected)
  // No settle(): mover el ratón a (8,8) borraría precisamente el estado que se quiere comparar.
  const before = await vennHoverSource(figure)
  expect(before.definitions).toHaveLength(count)
  expect(before.visible.map(item => item.id)).toEqual(visibleIds)
  expect(before.region).not.toBeNull()
  const expectedInclude = before.visible.filter(item => selected.members.includes(item.id)).map(item => item.circle)
  const expectedExclude = selected.whole ? [] : before.visible.filter(item => !selected.members.includes(item.id)).map(item => item.circle)
  expect(before.region).toEqual({ whole: selected.whole, include: expectedInclude, exclude: expectedExclude })
  expect(before.hoveredParts).toContain(selected.whole ? selected.members[0] : `region:${selected.members.join('&')}`)
  const maskFile = info.outputPath(`${name}-live-mask.json`)
  writeFileSync(maskFile, JSON.stringify(before, null, 2)); await info.attach(`${name}-live-mask.json`, { path: maskFile, contentType: 'application/json' })

  const { natural } = await captureWithLiveComparison(app, page, figure, join(home, `${name}.png`), info, name, { keyboard: true, requireMath: true })
  expect(natural).toEqual(before.canvas)
  const input = await scene(app, index), leaves = lifecycleLeaves(input.primitives)
  expect(input.family).toBe('venn'); expect(input.canvas).toEqual(before.canvas)
  const regions = leaves.filter((primitive): primitive is Extract<DiagramPrimitive, { kind: 'venn-region' }> => primitive.kind === 'venn-region')
  expect(regions).toHaveLength(1)
  expect(regions[0].include).toEqual(expectedInclude)
  expect(regions[0].exclude).toEqual(expectedExclude)
  expect(leaves.filter(primitive => primitive.kind === 'ellipse').map(primitive => ({ cx: primitive.cx, cy: primitive.cy, r: primitive.rx }))).toEqual(before.visible.map(item => item.circle))
  expect(JSON.stringify(input)).not.toContain('PRIVATE_')
  // El teclado no mueve el cursor ni limpia el hover al abrir/cerrar el menú o finalizar el diálogo.
  const after = await vennHoverSource(figure)
  expect(after.region).toEqual(before.region)
  expect(after.hoveredParts).toEqual(before.hoveredParts)
}

for (const theme of ['light', 'dark'] as const) for (const count of [2, 3] as const) {
  test(`Diagram PNG: Venn ${count} conserva círculo, regiones y máscara del hover en ${theme}`, async ({}, info) => {
    test.setTimeout(120_000)
    const home = prepare(theme), fixture = DIAGRAM_FIXTURES.find(item => item.key === `venn${count}`)
    if (!fixture) throw new Error('The Venn hover fixture is unavailable')
    vennHoverSystemCursor(home)
    const full: LifecycleDiagram = { ...fixture.block, id: `${fixture.block.id}-hover-full`, build: false, steps: [] }
    const construction: LifecycleDiagram = { ...fixture.block, id: `${fixture.block.id}-hover-build`, build: true }
    const source = lifecycleLesson(home, [full, construction]), { app, page, errors } = await start(home, theme === 'dark')
    const allIds = ['PRIVATE_ID_A', 'PRIVATE_ID_B', ...(count === 3 ? ['PRIVATE_ID_C'] : [])]
    const cases: VennHoverCase[] = [
      { key: 'whole-A', members: [allIds[0]], whole: true },
      { key: 'only-A', members: [allIds[0]], whole: false },
      { key: 'A-and-B', members: allIds.slice(0, 2), whole: false },
      ...(count === 3 ? [{ key: 'A-and-B-and-C', members: allIds, whole: false }] : [])
    ]
    let index = 0
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
      await expect(page.locator('html')).not.toHaveClass(/sun-cursor/)
      await expect(page.locator('style[data-aula-cursor]')).toHaveCount(0)
      const fullFigure = page.locator('[data-block="diagram"]').nth(0)
      await settle(page, fullFigure)
      const progressPath = join(home, 'Packs', PACK, 'progress.json'), beforeProgress = readFileSync(progressPath, 'utf8')
      for (const selected of cases) await captureHoveredVenn(app, page, fullFigure, home, info, `${theme}-venn${count}-${selected.key}`, index++, selected, allIds, count)
      expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)

      // El primer paso menciona sólo el elemento a; revela A por pertenencia, pero deja B/C en el futuro.
      const buildFigure = page.locator('[data-block="diagram"]').nth(1)
      await buildFigure.getByRole('button', { name: /Next step|Paso siguiente/ }).click()
      await settle(page, buildFigure)
      const buildProgress = readFileSync(progressPath, 'utf8')
      await captureHoveredVenn(app, page, buildFigure, home, info, `${theme}-venn${count}-only-A-future-hidden`, index++, cases[1], [allIds[0]], count)
      const built = await scene(app, index - 1)
      expect(texts(built.primitives)).not.toContain('Set B')
      if (count === 3) expect(texts(built.primitives)).not.toContain('Set C')
      expect(readFileSync(progressPath, 'utf8')).toBe(buildProgress)
      expect(readFileSync(source.path, 'utf8')).toBe(source.bytes)
      const results = await audit(app, info, `${theme}-venn${count}-hover-verified`)
      expect(results).toHaveLength(cases.length + 1)
      expect(results.every(result => result.destroyed && !result.defaultSession && result.shown === 0 && result.calls.every(call => !call.error))).toBe(true)
      expect(errors).toEqual([])
    } finally { try { await audit(app, info, `${theme}-venn${count}-hover`) } finally { await app.close() } }
  })
}

for (const theme of ['light', 'dark'] as const) for (const edgeCount of [40, 41] as const) {
  test(`Diagram PNG: hover de nodo y flechas incidentes con ${edgeCount} aristas en ${theme}`, async ({}, info) => {
    const fixture = DIAGRAM_FIXTURES.find(item => item.key === `edges-${edgeCount}`)!
    const home = prepare(theme); vennHoverSystemCursor(home)
    const source = lifecycleLesson(home, [fixture.block]), { app, page, errors } = await start(home, theme === 'dark')
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILLS[0] })
      const figure = page.locator('[data-block="diagram"]').first(); await settle(page, figure)
      const progressPath = join(home, 'Packs', PACK, 'progress.json'), beforeProgress = readFileSync(progressPath, 'utf8')
      const node = figure.locator(`[data-diagram-canvas] [data-ask-part="${fixture.block.nodes[0].id}"]`)
      const sourceShadow = await evaluateLiveElement<string>(node.locator('.viz-label'), 'element => getComputedStyle(element).boxShadow')
      await captureWithLiveComparison(app, page, figure, join(home, 'before-node-hover.png'), info, 'before-node-hover', { requireMath: true })
      const baseline = await scene(app, 0)
      // en la columna de lectura (700 px) el grafo denso se desborda y el nodo puede quedar a medias fuera de la ventana del
      // diagrama: el ratón va a la parte que se ve
      const [nodeBox, viewBox] = [(await node.boundingBox())!, (await figure.locator('.viz-dots').boundingBox())!]
      const left = Math.max(nodeBox.x, viewBox.x + 4), right = Math.min(nodeBox.x + nodeBox.width, viewBox.x + viewBox.width - 4)
      await page.mouse.move((left + right) / 2, nodeBox.y + nodeBox.height / 2)
      await expect.poll(() => evaluateLiveElement<string>(node.locator('.viz-label'), 'element => getComputedStyle(element).boxShadow')).not.toBe(sourceShadow)
      // Las transiciones de color/sombra terminan antes de comparar el énfasis final comprometido.
      await page.waitForTimeout(350)
      const sourceHover = await evaluateLiveElement<string[]>(figure, 'figure => [...figure.querySelectorAll("[data-diagram-canvas] [data-ask-part]:hover")].map(node => node.getAttribute("data-ask-part"))')
      expect(sourceHover).toContain(fixture.block.nodes[0].id)
      const hoveredFile = join(home, 'hovered-node.png')
      const { natural } = await captureWithLiveComparison(app, page, figure, hoveredFile, info, 'hovered-node', { keyboard: true, requireMath: true })
      if (theme === 'dark' && edgeCount === 40) {
        let framing: ReturnType<typeof diagramHoverFramePixels> | { accepted: false; error: string }
        try { framing = diagramHoverFramePixels(decodeDiagramFramePng(readFileSync(hoveredFile)), natural) }
        catch (error) { framing = { accepted: false, error: String(error) } }
        const report = info.outputPath('hovered-node-absolute-frame.json')
        writeFileSync(report, JSON.stringify({ natural, framing }, null, 2))
        await info.attach('hovered-node-absolute-frame', { path: report, contentType: 'application/json' })
        expect(framing.accepted, 'The hovered graph must retain its absolute framing, margins and dot phase').toBe(true)
      }
      const hovered = await scene(app, 1), before = lifecycleLeaves(baseline.primitives), after = lifecycleLeaves(hovered.primitives)
      const labels = (items: typeof before) => items.filter((item): item is Extract<DiagramPrimitive, { kind: 'label' }> => item.kind === 'label' && item.lines.some(line => line.text === fixture.block.nodes[0].label))
      expect(labels(before)).toHaveLength(1); expect(labels(after)).toHaveLength(1)
      expect(labels(before)[0].shadow).toBe('e1'); expect(labels(after)[0].shadow).toBe('e2')
      const inkColors = (items: typeof before) => items.filter(item => item.kind === 'ink').map(item => item.color)
      const vectorColors = (items: typeof before) => items.filter(item => item.kind === 'path').map(item => item.stroke)
      // El umbral decide la rama viva: ambas deben conservar los nuevos colores de aristas incidentes.
      if (edgeCount === 40) expect(inkColors(after)).not.toEqual(inkColors(before))
      else expect(vectorColors(after)).not.toEqual(vectorColors(before))
      expect(await evaluateLiveElement<string[]>(figure, 'figure => [...figure.querySelectorAll("[data-diagram-canvas] [data-ask-part]:hover")].map(node => node.getAttribute("data-ask-part"))')).toEqual(sourceHover)
      expect(JSON.stringify(hovered)).not.toContain('PRIVATE_')
      expect(readFileSync(source.path, 'utf8')).toBe(source.bytes); expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
      const results = await audit(app, info, 'graph-hover-verified')
      expect(results).toHaveLength(2)
      expect(results.every(result => result.destroyed && !result.defaultSession && result.shown === 0 && result.calls.every(call => !call.error))).toBe(true)
      expect(errors).toEqual([])
    } finally { try { await audit(app, info, 'graph-hover') } finally { await app.close() } }
  })
}
