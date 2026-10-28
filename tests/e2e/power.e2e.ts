// Energía (J4-1): con la ventana minimizada u oculta, lo ambiental se para (html[data-ambient="off"]) pero NINGUNA entrada,
// salida o respuesta se queda pausada a medias: al volver, la pantalla está entera y visible. Se minimiza/oculta justo a mitad
// de una navegación, que es cuando hay entradas en marcha.
import { test, expect, type Page, type ElectronApplication } from 'playwright/test'
import { go, homeWithDemoCourse, launch } from './helpers'

const COURSE = 'exam-2-math112'

/** Lo mínimo del navegador que usan las funciones de `page.evaluate` (el tsconfig de las pruebas no incluye el DOM). */
type El = { dataset: Record<string, string | undefined>; innerText: string }
interface Anim { playState: string; effect: { getTiming(): { iterations: number } } | null }
interface Win {
  document: { documentElement: El; querySelectorAll(s: string): ArrayLike<El>; getAnimations(): Anim[] }
  getComputedStyle(e: El): { opacity: string }
  __aula: { navigate(r: unknown): void }
}

const ambient = (page: Page) => page.evaluate(() => (globalThis as unknown as Win).document.documentElement.dataset.ambient ?? 'run')

/** Animaciones que terminan (no bucles) y están pausadas: nunca debería haber ninguna. */
const pausedFinite = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Win).document.getAnimations().filter((a) => a.playState === 'paused' && a.effect?.getTiming().iterations !== Infinity).length)

/** La pantalla de delante: cuál, su opacidad y cuánto texto tiene. */
const front = (page: Page) =>
  page.evaluate(() => {
    const w = globalThis as unknown as Win
    const el = Array.from(w.document.querySelectorAll('[data-screens] > [data-screen]')).find((x) => x.dataset.active === 'true')
    return el ? { screen: el.dataset.screen, opacity: Number(w.getComputedStyle(el).opacity), text: (el.innerText || '').trim().length } : null
  })

async function hideWindow(app: ElectronApplication, how: 'minimize' | 'hide'): Promise<void> {
  await app.evaluate(({ BrowserWindow }, h) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.isVisible())
    if (h === 'minimize') w?.minimize()
    else w?.hide()
  }, how)
}
async function showWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.getURL().includes('index.html') || w.webContents.getURL().includes('print=')) continue
      if (w.isMinimized()) w.restore()
      w.show()
    }
  })
}

// necesita una ventana VISIBLE (mide minimizar/ocultar de verdad): con AULA_HIDDEN, que no saca ventanas, se salta
test.skip(!!process.env.AULA_HIDDEN, 'necesita una ventana visible: lánzala sin AULA_HIDDEN')

test('minimizar u ocultar a mitad de una navegación: se para lo ambiental y al volver la pantalla está entera', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'home' })
  await expect.poll(() => ambient(page)).not.toBe('off')

  const cases: [Record<string, unknown>, 'minimize' | 'hide'][] = [
    [{ name: 'tools' }, 'minimize'],
    [{ name: 'course', id: COURSE }, 'hide'],
    [{ name: 'calendar' }, 'minimize'],
    [{ name: 'home' }, 'hide']
  ]
  for (const [route, how] of cases) {
    // navegar y, sin esperar a que entre la pantalla, quitar la ventana de la vista
    await page.evaluate((r) => (globalThis as unknown as Win).__aula.navigate(r), route)
    await hideWindow(app, how)
    await expect.poll(() => ambient(page), { timeout: 5_000 }).toBe('off')
    await page.waitForTimeout(1_200)
    // sin ver la ventana: solo se pausan bucles; las entradas siguen y terminan
    expect(await pausedFinite(page)).toBe(0)
    await showWindow(app)
    await expect.poll(() => ambient(page), { timeout: 5_000 }).not.toBe('off')
    await page.waitForTimeout(900)
    const f = await front(page)
    expect(f?.screen).toBe(route.name)
    expect(f?.opacity).toBeGreaterThan(0.99)
    expect(f?.text).toBeGreaterThan(20)
    expect(await pausedFinite(page)).toBe(0)
  }
  expect(errors).toEqual([])
  await app.close()
})
