// Cambiar de pantalla (J1-6, J1-7): navegar muy rápido muchas veces nunca deja la vista en blanco ni colgada; al salir de un curso
// no parpadea «Course not found»; y entre dos pantallas siempre hay algo a la vista (la anterior se queda hasta tener la nueva).
import { test, expect, type Page } from 'playwright/test'
import { go, homeWithDemoCourse, launch } from './helpers'

const COURSE = 'exam-2-math112'

/** Lo mínimo del navegador que usan las funciones de `page.evaluate` (el tsconfig de las pruebas no incluye el DOM). */
type El = { dataset: Record<string, string | undefined>; innerText: string }
interface Win {
  document: { querySelectorAll(s: string): ArrayLike<El> }
  getComputedStyle(e: El): { opacity: string }
  requestAnimationFrame(cb: () => void): number
  __aula: { navigate(r: unknown): void }
}

type R = Record<string, unknown>
const ROUTES: R[] = [
  { name: 'home' },
  { name: 'course', id: COURSE },
  { name: 'calendar' },
  { name: 'course', id: COURSE, tab: 'practice' },
  { name: 'stats' },
  { name: 'chat' },
  { name: 'inbox' },
  { name: 'documents' },
  { name: 'study', id: COURSE, mode: 'cards' },
  { name: 'settings' },
  { name: 'tools' }
]

/** Navega sin esperar a que se pinte (como varios clics seguidos). */
async function nav(page: Page, r: R): Promise<void> {
  await page.evaluate((x) => (globalThis as unknown as { __aula: { navigate(r: unknown): void } }).__aula.navigate(x), r)
}

/** Las capas de pantalla que hay ahora: cuál, si es la de delante, su opacidad y si tiene texto. */
function layers(page: Page) {
  return page.evaluate(() => {
    const w = globalThis as unknown as Win
    return Array.from(w.document.querySelectorAll('[data-screens] > [data-screen]')).map((el) => ({
      screen: el.dataset.screen,
      active: el.dataset.active === 'true',
      opacity: Number(w.getComputedStyle(el).opacity),
      text: (el.innerText || '').trim().length
    }))
  })
}

test('navegar muy rápido (cientos de veces) siempre acaba en la última pantalla, visible y con contenido', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'home' })
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let round = 0; round < 8; round++) {
    let last: R = ROUTES[0]
    for (let i = 0; i < 30; i++) {
      last = ROUTES[Math.floor(rand() * ROUTES.length)]
      await nav(page, last)
      // ráfagas: a veces nada entre dos navegaciones, a veces lo que dura una transición
      const wait = [0, 0, 16, 40, 90, 150, 260][Math.floor(rand() * 7)]
      if (wait) await page.waitForTimeout(wait)
    }
    await page.waitForTimeout(900)
    const now = await layers(page)
    // una sola capa, la de la última ruta, opaca y con contenido (antes: congelada en opacidad 0 para siempre)
    expect(now.filter((l) => l.active), JSON.stringify(now)).toHaveLength(1)
    expect(now, JSON.stringify(now)).toHaveLength(1)
    expect(now[0].screen).toBe(last.name)
    expect(now[0].opacity).toBe(1)
    expect(now[0].text).toBeGreaterThan(0)
  }
  expect(errors).toEqual([])
  await app.close()
})

test('al salir de un curso no parpadea «Course not found» y nunca se ve la página vacía', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'home' })
  // la primera visita de cada pantalla también (código y datos aún sin cargar), y luego las repetidas
  const pairs: [R, R][] = [
    [{ name: 'course', id: COURSE }, { name: 'calendar' }],
    [{ name: 'calendar' }, { name: 'course', id: COURSE }],
    [{ name: 'course', id: COURSE }, { name: 'home' }],
    [{ name: 'home' }, { name: 'stats' }],
    [{ name: 'stats' }, { name: 'course', id: COURSE }],
    [{ name: 'course', id: COURSE }, { name: 'calendar' }]
  ]
  for (const [from, to] of pairs) {
    await go(page, from)
    await page.waitForTimeout(400)
    // fotograma a fotograma durante 700 ms tras navegar
    const frames = await page.evaluate(async (r) => {
      const w = globalThis as unknown as Win
      const out: { notFound: boolean; maxOpacity: number; text: number; n: number }[] = []
      w.__aula.navigate(r)
      const t0 = performance.now()
      while (performance.now() - t0 < 700) {
        await new Promise((ok) => w.requestAnimationFrame(() => ok(null)))
        const els = Array.from(w.document.querySelectorAll('[data-screens] > [data-screen]'))
        out.push({
          notFound: els.some((el) => el.innerText.includes('Course not found')),
          maxOpacity: Math.max(0, ...els.map((el) => Number(w.getComputedStyle(el).opacity))),
          text: Math.max(0, ...els.map((el) => (el.innerText || '').trim().length)),
          n: els.length
        })
      }
      return out
    }, to)
    const label = `${from.name} → ${to.name}`
    expect(frames.length, label).toBeGreaterThan(10)
    expect(frames.some((f) => f.notFound), label).toBe(false)
    // siempre hay una pantalla con contenido a la vista (con el fundido cruzado, ninguna baja de ~40 % a la vez)
    const blank = frames.filter((f) => f.text === 0 || f.maxOpacity < 0.4)
    expect(blank, `${label}: ${JSON.stringify(blank.slice(0, 3))}`).toEqual([])
    // y al final, solo la nueva
    expect(frames.at(-1)!.n, label).toBe(1)
  }
  expect(errors).toEqual([])
  await app.close()
})

test('bienvenida en una ventana baja (1000×680): «Continuar» siempre a la vista y los pasos nunca se quedan en blanco (J1-20, J1-6)', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launch({ onboarding: true })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1000, height: 680 })
  await page.getByRole('button', { name: 'Get started' }).click()
  const next = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(next).toBeVisible()
  const box = await next.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y + box!.height).toBeLessThanOrEqual(680)
  // y se pulsa sin desplazar: pasa al paso de la plataforma
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(page.getByRole('button', { name: 'I don’t use one' })).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})
