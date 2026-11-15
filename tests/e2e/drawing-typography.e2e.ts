import { test, expect, type Page } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { go, homeWithDemoCourse } from './helpers'
import { compareDrawingPixels, type LiveDrawingGeometry } from './drawing-pixels'

for (const fixture of [{ theme: 'academic', layout: 'content', italic: false }, { theme: 'chalk', layout: 'content', italic: false }, { theme: 'aula', layout: 'quote', italic: true }]) {
  test(`Drawing PNG conserva tipografía de diapositiva ${fixture.theme}/${fixture.layout}`, async ({}, info) => {
    const home = homeWithDemoCourse(), pack = 'exam-2-math112', skillId = 'reference-angles'
    const path = join(home, 'Packs', pack, 'skills', `${skillId}.json`), skill = JSON.parse(readFileSync(path, 'utf8'))
    skill.lesson = [{ type: 'slides', id: 'typography-deck', theme: fixture.theme, slides: [{ id: 'typography-slide', layout: fixture.layout, blocks: [{ type: 'drawing', id: 'inherited', width: 420, height: 180, items: [
      { kind: 'text', x: 210, y: 75, text: 'Inherited typography $\\frac{a+b}{c}$', size: 22 },
      { kind: 'line', x1: 35, y1: 130, x2: 380, y2: 130, stroke: 'blue', width: 2 },
      { kind: 'dot', cx: 380, cy: 30, r: 9, fill: 'green', stroke: 'green', opacity: 1 }
    ] }], right: [] }] }]
    writeFileSync(path, JSON.stringify(skill))
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', theme: 'light' } }))
    const progressPath = join(home, 'Packs', pack, 'progress.json'), progress = JSON.parse(readFileSync(progressPath, 'utf8'))
    progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }; writeFileSync(progressPath, JSON.stringify(progress))
    const sourceBytes = readFileSync(path, 'utf8')
    const app = await electron.launch({ args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', '--force-device-scale-factor=1'], env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' } })
    let sourcePage: Page | undefined
    try {
      const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
      sourcePage = page
      await page.setViewportSize({ width: 1440, height: 1100 })
      const output = join(home, 'typography.png')
      await app.evaluate(({ app: main, dialog }, output) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: output })) as typeof dialog.showSaveDialog
        main.on('browser-window-created', (_event, win) => {
          const execute = win.webContents.executeJavaScript.bind(win.webContents)
          win.webContents.executeJavaScript = (async (code: string, gesture?: boolean) => {
            const result = await execute(code, gesture)
            if (code.startsWith('window.aulaFigureRender.render(')) {
              (globalThis as unknown as { typography: unknown }).typography = await execute(`(() => { const n=document.querySelector('[data-drawing-label]'), c=getComputedStyle(n); return {family:c.fontFamily,style:c.fontStyle,text:n.textContent} })()`)
              ;(globalThis as unknown as { layoutMetrics: unknown }).layoutMetrics = JSON.parse(code.slice('window.aulaFigureRender.render('.length, -1)).metrics
            }
            return result
          }) as typeof win.webContents.executeJavaScript
        })
      }, output)
      await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
      await go(page, { name: 'study', id: pack, mode: 'learn', skill: skillId })
      const figure = page.locator('[data-block="drawing"]').first()
      await expect(figure.locator('.viz-label')).toBeVisible(); await page.waitForTimeout(2500)
      // La tinta vive sobre papel opaco en el archivo. El tinte decorativo de Chalk pertenece a la
      // diapositiva, no al dibujo; este mat del fixture conserva sus fuentes, tamaño, zoom y transform.
      await page.evaluate(`(() => {
        const host=document.querySelector('[data-block="drawing"] [data-ask-canvas]');
        const value=host.style.getPropertyValue('background-color'),priority=host.style.getPropertyPriority('background-color');
        window.restoreDrawingMat=()=>{if(value)host.style.setProperty('background-color',value,priority);else host.style.removeProperty('background-color');delete window.restoreDrawingMat;};
        host.style.backgroundColor=getComputedStyle(host).getPropertyValue('--draw-paper').trim()||'var(--paper)';
      })()`)
      const source = await page.evaluate<{ family: string; style: string; text: string }>(`(() => { const n=document.querySelector('[data-block="drawing"] .viz-label'), c=getComputedStyle(n); return {family:c.fontFamily,style:c.fontStyle,text:n.textContent} })()`)
      expect(source.style).toBe(fixture.italic ? 'italic' : 'normal')
      expect(source.family).toContain(fixture.theme === 'chalk' ? 'ui-rounded' : 'ui-serif')
      const geometry = await page.evaluate<LiveDrawingGeometry>(`(() => {
        const root=document.querySelector('[data-block="drawing"] [role="img"]'), box=root.getBoundingClientRect();
        const rect=n=>{const b=n.getBoundingClientRect();return {x:b.x-box.x,y:b.y-box.y,width:b.width,height:b.height}};
        return {width:box.width,height:box.height,scale:box.width/parseFloat(getComputedStyle(root).width),labels:[...root.querySelectorAll('.viz-label, .viz-label .katex-html')].map(n=>({text:(n.classList.contains('katex-html')?'[math] ':'')+n.textContent,...rect(n)})),exclusions:[...document.querySelectorAll('button')].map(rect).filter(b=>b.width>0&&b.height>0&&b.x<box.width&&b.y<box.height&&b.x+b.width>0&&b.y+b.height>0)};
      })()`)
      const livePath = info.outputPath('live.png'), live = await figure.getByRole('img').screenshot({ path: livePath, scale: 'css' })
      await info.attach('live.png', { path: livePath, contentType: 'image/png' })
      await figure.getByRole('button', { name: 'Export figure', exact: true }).click()
      await page.getByRole('menuitem', { name: /^Save PNG/ }).click()
      await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
      const isolated = await app.evaluate(() => (globalThis as unknown as { typography: unknown }).typography)
      const metrics = await app.evaluate(() => (globalThis as unknown as { layoutMetrics: unknown }).layoutMetrics)
      const ancestry = await page.evaluate(`(() => { const result=[]; for(let n=document.querySelector('[data-block="drawing"] [role="img"]');n;n=n.parentElement) { const c=getComputedStyle(n),b=n.getBoundingClientRect();result.push({tag:n.tagName,cls:n.className,width:b.width,height:b.height,cssWidth:c.width,cssHeight:c.height,zoom:c.zoom,transform:c.transform,background:c.backgroundColor}); } return result })()`)
      const report = info.outputPath('typography.json'); writeFileSync(report, JSON.stringify({ source, isolated, metrics, geometry, ancestry }, null, 2))
      await info.attach('typography.json', { path: report, contentType: 'application/json' })
      expect(isolated).toEqual(source)
      await info.attach('saved.png', { path: output, contentType: 'image/png' })
      await compareDrawingPixels(page, live, readFileSync(output), geometry, info, fixture.theme)
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
      expect(readFileSync(path, 'utf8')).toBe(sourceBytes); expect(errors).toEqual([])
    } finally { try { if (sourcePage && !sourcePage.isClosed()) await sourcePage.evaluate('window.restoreDrawingMat?.()') } finally { await app.close() } }
  })
}
