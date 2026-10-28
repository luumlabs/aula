// FIX2 · AULA_HIDDEN: lanzada así (pruebas, capturas, auditorías), ninguna ventana aparece nunca en la pantalla de nadie:
// ni cuando macOS activa la app (`activate`: al lanzarla o al pulsar su icono del Dock), ni con una segunda instancia, ni con
// el menú o una notificación. Sin AULA_HIDDEN, `activate` vuelve a enseñar la ventana escondida (eso solo se mira en CI, para
// no abrir ventanas en el Mac de quien pasa las pruebas).
import { test, expect, type ElectronApplication } from 'playwright/test'
import { launch } from './helpers'

const visibleWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => w.webContents.getURL()))

test('con AULA_HIDDEN, ni activar la app ni una segunda instancia enseñan la ventana (y no hay icono en el Dock)', async () => {
  const { app, page } = await launch({ env: { AULA_HIDDEN: '1' } })
  await expect(page.locator('nav[aria-label="Aula"]')).toBeAttached()
  expect(await visibleWindows(app)).toEqual([])

  // lo que hace macOS al activar la app (Dock, Finder, Playwright…) y lo que hace una segunda copia al abrirse
  await app.evaluate(({ app }) => {
    app.emit('activate', {}, false)
    app.emit('second-instance', {}, [], process.cwd(), {})
  })
  await page.waitForTimeout(800)
  expect(await visibleWindows(app)).toEqual([])
  // un comando del menú («Ajustes…») tampoco la enseña
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) {
        if (i.accelerator === 'CmdOrCtrl+,') return i
        const sub = i.submenu ? find(i.submenu.items) : undefined
        if (sub) return sub
      }
      return undefined
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    item?.click()
  })
  await page.waitForTimeout(500)
  expect(await visibleWindows(app)).toEqual([])
  if (process.platform === 'darwin') expect(await app.evaluate(({ app }) => app.dock?.isVisible() ?? false)).toBe(false)
  await app.close()
})

test('sin AULA_HIDDEN, activar la app enseña otra vez la ventana escondida', async () => {
  test.skip(!process.env.CI, 'abre una ventana de verdad: solo en CI')
  const { app, page } = await launch({ env: { AULA_HIDDEN: '' } })
  await expect(page.locator('nav[aria-label="Aula"]')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide())
  expect(await visibleWindows(app)).toEqual([])
  await app.evaluate(({ app }) => { app.emit('activate', {}, false) })
  await expect.poll(async () => (await visibleWindows(app)).length).toBe(1)
  await app.close()
})
