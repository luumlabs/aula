// El cursor-sol: el sol en lugar de la flecha (con aro sobre lo que se pulsa), la barra de escribir en los campos de texto, la
// cola de cometa al moverse y la flecha de siempre con «Cursor: System» en Ajustes → Apariencia o desde ⌘K.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, type Page } from 'playwright/test'
import { go, launch } from './helpers'

/** El cursor calculado del primer elemento que encaja (se evalúa en la página). */
const cursorOf = (page: Page, sel: string): Promise<string | null> =>
  page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? getComputedStyle(el).cursor : null })()`)

test('el cursor es el sol, deja cola al moverse y vuelve a la flecha si se pide', async () => {
  // en Windows y Linux una ventana que nunca sale a la pantalla deja de pintar fotogramas (y la cola no se dibuja): allí
  // se abre a la vista; en macOS, escondida (sigue pintando y no molesta a quien trabaja en el Mac)
  // en inglés, para buscar en ⌘K por su nombre sea cual sea el idioma del equipo
  const home = mkdtempSync(join(tmpdir(), 'aula-e2e-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en' } }))
  const { app, page } = await launch({ home, env: process.platform === 'darwin' ? { AULA_HIDDEN: '1' } : {} })
  await expect(page.locator('nav[aria-label="Aula"]')).toBeAttached()
  await expect(page.locator('html.sun-cursor')).toBeAttached()

  // el sol en el fondo y, con aro, en los botones; la barra de escribir en los campos
  expect(await cursorOf(page, 'body')).toMatch(/url\("?data:image\/png/)
  const button = await cursorOf(page, 'nav button')
  expect(button).toMatch(/url\("?data:image\/png/)
  expect(button).not.toBe(await cursorOf(page, 'body'))
  await go(page, { name: 'chat' })
  await expect(page.locator('textarea').first()).toBeAttached()
  expect(await cursorOf(page, 'textarea')).toBe('text')

  // la cola: un lienzo encima de todo que no recibe clics y pinta al moverse. La cola se apaga en 280 ms, así que se mide
  // en cada fotograma mientras se mueve (leerla después llegaría tarde en un ordenador lento, como los de CI)
  await page.evaluate(`(() => {
    const c = [...document.querySelectorAll('body > canvas')].find((x) => x.style.zIndex === '2147483647')
    window.__trail = !c ? -1 : c.style.pointerEvents === 'none' ? 0 : -2
    if (window.__trail < 0) return
    const start = performance.now()
    const tick = () => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let a = 0
      for (let i = 3; i < d.length; i += 4) a += d[i]
      window.__trail = Math.max(window.__trail, a)
      if (performance.now() - start < 4000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
  await page.mouse.move(200, 300)
  await page.mouse.move(900, 420, { steps: 12 })
  await expect.poll(() => page.evaluate<number>('window.__trail'), { timeout: 4000 }).toBeGreaterThan(0)

  // ⌘K «Use the system cursor» (lo mismo que Ajustes → Apariencia → Cursor: System): la flecha de siempre, al momento
  const input = page.locator('[cmdk-input]')
  const selected = page.locator('[cmdk-item][data-selected="true"]')
  await page.keyboard.press('Control+k')
  await input.fill('system cursor')
  await expect(selected).toContainText('Use the system cursor')
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.locator('html.sun-cursor')).not.toBeAttached()
  expect(await cursorOf(page, 'body')).toBe('auto')

  // y «Use the sun cursor» devuelve el sol
  await page.keyboard.press('Control+k')
  await input.fill('sun cursor')
  await expect(selected).toContainText('Use the sun cursor')
  await page.keyboard.press('Enter')
  await expect(page.locator('html.sun-cursor')).toBeAttached()

  // «Ajustes → Apariencia» (el chat, ⌘K) baja hasta la fila del cursor; cada sección de Ajustes tiene su ancla
  await go(page, { name: 'settings', section: 'appearance' })
  await expect(page.locator('[data-settings-section="appearance"]').getByText('brings back the usual arrow')).toBeInViewport()
  const anchors = await page.evaluate<string[]>(`[...document.querySelectorAll('[data-settings-section]')].map((e) => e.getAttribute('data-settings-section')).sort()`)
  expect(anchors).toEqual(['about', 'ai', 'appearance', 'data', 'devices', 'general', 'memory', 'persistent', 'platforms'])
  await app.close()
})
