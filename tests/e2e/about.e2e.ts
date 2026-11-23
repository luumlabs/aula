// A6-P1-4: Ajustes → Acerca de enseña los avisos legales de la AGPL (copyright, que es software libre sin garantía, cómo
// ver la licencia y dónde está el código de esta versión) y, por la guía 5.1.1(i) del App Store, la política de privacidad
// y la ayuda, en inglés y en español. No se pulsan los enlaces: abrirían
// programas del sistema; el proceso principal sí rechaza cualquier documento que no sea uno de los dos.
// Al final, «Apoya a Aula»: un botón neutro a GitHub Sponsors (Ayuda → «Apoyar a Aula…» lleva hasta él y deja ahí el foco,
// también si ya se estaba allí, una vez por llegada). En un dispositivo, enlaces de verdad, y el menú del Mac no lo mueve; dentro de una app
// nativa, solo si ella lo dice (window.aulaApp.supportLink(), lib/supportLink.ts).
import { test, expect, type Page } from 'playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { go, launch, type Launched } from './helpers'

function homeIn(language: 'en' | 'es'): string {
  const home = mkdtempSync(join(tmpdir(), 'aula-e2e-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language, name: 'Maya' } }))
  return home
}

const TEXTS = {
  en: {
    license: /Free software: you can share and change it under the GNU AGPL v3\. It comes with absolutely no warranty\./,
    links: ['License', 'Source code', 'Third-party licenses', 'Privacy policy', 'Help and support'],
    support: { title: 'Support Aula', body: /nothing you study reaches us/, donate: 'Donate on GitHub Sponsors', star: 'star it on GitHub' }
  },
  es: {
    license: /Software libre: puedes compartirlo y modificarlo con la licencia GNU AGPL v3\. No tiene ninguna garantía\./,
    links: ['Licencia', 'Código fuente', 'Licencias de terceros', 'Política de privacidad', 'Ayuda y soporte'],
    support: { title: 'Apoya a Aula', body: /nada de lo que estudias nos llega/, donate: 'Donar en GitHub Sponsors', star: 'dale una estrella en GitHub' }
  }
} as const

const SPONSORS = 'https://github.com/sponsors/luumlabs'

type Envelope = { ok: boolean; value?: unknown; error?: { code: string; message: string } }

const navigateTo = (page: Page, route: Record<string, unknown>): Promise<void> =>
  page.evaluate((r) => (globalThis as unknown as { __aula: { navigate(r: unknown): void } }).__aula.navigate(r), route)

/** Elige una entrada del menú de la app, como con el ratón; false si no está. */
const clickMenu = (app: Launched['app'], label: string): Promise<boolean> =>
  app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) {
        if (i.label === wanted) return i
        const sub = i.submenu ? find(i.submenu.items) : undefined
        if (sub) return sub
      }
      return undefined
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    item?.click()
    return !!item
  }, label)

for (const lang of ['en', 'es'] as const) {
  test(`Acerca de: avisos legales (${lang})`, async () => {
    const { app, page } = await launch({ home: homeIn(lang) })
    try {
      await go(page, { name: 'settings' })
      const legal = page.getByTestId('about-legal')
      await legal.scrollIntoViewIfNeeded()
      await expect(legal).toContainText('Copyright © 2026 Luum Labs')
      await expect(legal).toContainText(TEXTS[lang].license)
      for (const name of TEXTS[lang].links) await expect(legal.getByRole('button', { name, exact: true })).toBeVisible()
      // solo los dos documentos: nada de rutas
      const refused = (await page.evaluate(`window.aula.invoke('app.openLicenses', { which: '../../etc/passwd' })`)) as { ok: boolean; error?: { message: string } }
      expect(refused.ok).toBe(false)
      expect(refused.error?.message).toMatch(/Aviso legal no válido/)
      // y fuera solo se abren enlaces web
      const script = (await page.evaluate(`window.aula.invoke('app.openExternal', { url: 'javascript:alert(1)' })`)) as { ok: boolean; error?: { message: string } }
      expect(script.ok).toBe(false)
      expect(script.error?.message).toMatch(/Solo se abren enlaces web/)

      // «Apoya a Aula», al final: lo que es Aula, un botón neutro (no ladrillo) y cómo ayudar sin dinero
      const texts = TEXTS[lang].support
      const support = page.getByTestId('about-support')
      await support.scrollIntoViewIfNeeded()
      await expect(support.getByRole('heading', { name: texts.title, exact: true })).toBeVisible()
      await expect(support).toContainText(texts.body)
      const donate = support.getByRole('button', { name: texts.donate, exact: true })
      await expect(donate).toHaveAttribute('data-variant', 'secondary')
      const star = support.getByRole('button', { name: texts.star, exact: true })
      await expect(star).toBeVisible()
      // dentro de la frase: subrayado siempre (no solo por el color, WCAG 1.4.1) y sin zona táctil sobre las otras líneas
      await expect(star).toHaveCSS('text-decoration-line', 'underline')
      await expect(star).not.toHaveClass(/touch-target/)
      // el enlace suelto de antes ya no está
      await expect(legal).not.toContainText('♡')
      // el botón abre GitHub Sponsors en el navegador del sistema (shell.openExternal, cambiado aquí para no abrirlo)
      await app.evaluate(({ shell }) => {
        const g = globalThis as { opened?: string[] }
        g.opened = []
        shell.openExternal = async (url: string) => {
          g.opened?.push(url)
        }
      })
      await donate.click()
      await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([SPONSORS])
    } finally {
      await app.close()
    }
  })
}

test('Ayuda → «Apoyar a Aula…» lleva a su apartado de Acerca de y deja ahí el foco, también si ya estaba allí', async () => {
  const { app, page } = await launch({ home: homeIn('es') })
  try {
    const support = page.getByTestId('about-support')
    const title = support.getByRole('heading', { name: 'Apoya a Aula', exact: true })
    await expect(support).toHaveCount(0)
    expect(await clickMenu(app, 'Apoyar a Aula…')).toBe(true)
    await expect(support).toBeInViewport()
    // el foco, en su título: con el teclado o un lector de pantalla se sigue desde ahí; sin anillo (no se pulsa)
    await expect(title).toBeFocused()
    await expect(title).toHaveCSS('outline-style', 'none')

    // ya estaba allí (la ruta no cambia): sube con la rueda, el foco se va a otro sitio y se vuelve a pulsar el menú
    await page.mouse.move(900, 450)
    await page.mouse.wheel(0, -100_000)
    await expect(support).not.toBeInViewport()
    await page.evaluate('document.activeElement && document.activeElement.blur()')
    await expect(title).not.toBeFocused()
    expect(await clickMenu(app, 'Apoyar a Aula…')).toBe(true)
    await expect(title).toBeFocused()
    // el foco va ahí una vez por llegada: si se lleva a otro panel (sin tocar Ajustes) mientras lo de encima aún cambia de
    // alto, el apartado se queda arriba y el foco, donde se llevó
    const fold = page.getByRole('button', { name: 'Plegar la barra', exact: true })
    await fold.focus()
    await page.evaluate(`document.querySelector('[data-settings-section="ai"]').style.paddingTop = '600px'`)
    await page.waitForTimeout(300)
    await expect(fold).toBeFocused()
    await expect(title).not.toBeFocused()
    await expect(support).toBeInViewport()

    // por el índice de Ajustes, no: baja a «Acerca de Aula» y el foco se queda en el índice
    const index = page.getByRole('navigation', { name: 'Ajustes', exact: true }).getByRole('button', { name: 'Acerca de Aula', exact: true })
    await index.click()
    await page.waitForTimeout(500)
    await expect(index).toBeFocused()
    await expect(title).not.toBeFocused()
  } finally {
    await app.close()
  }
})

test('dispositivo: enlaces de verdad y el menú del Mac no lo mueve; dentro de una app nativa, solo si ella lo dice', async () => {
  test.setTimeout(120_000)
  const { app, page: mac } = await launch({ home: homeIn('en') })
  try {
    const call = async (method: string, args?: unknown): Promise<Record<string, unknown>> => {
      const r = (await mac.evaluate(([m, a]) => (globalThis as unknown as { aula: { invoke(m: unknown, a: unknown): Promise<unknown> } }).aula.invoke(m, a), [method, args] as const)) as Envelope
      if (!r.ok) throw new Error(`${method}: ${r.error?.message}`)
      return r.value as Record<string, unknown>
    }
    const base = (await call('remote.setEnabled', { enabled: true })).localURL as string
    const code = ((await call('remote.startPairing')).pairing as { code: string }).code
    // el «dispositivo»: otra ventana sin el puente de Electron, que habla con el servidor como un navegador
    const opening = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { partition: 'aula-e2e-device' } })
      await w.loadURL(url)
    }, base + '/pair')
    const device = await opening
    await device.waitForLoadState('domcontentloaded')
    const paired = (await device.evaluate(async (c) => (await fetch('/pair/complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c, name: 'iPhone', platform: 'iphone' }) })).json(), code)) as { ok: boolean }
    expect(paired.ok).toBe(true)
    await device.goto(base + '/')
    await device.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula, null, { timeout: 20_000 })

    // el menú del Mac es de su ventana: Ayuda → «Support Aula…» lleva al Mac a su apartado, y el dispositivo sigue donde estaba
    await device.evaluate(() => {
      const g = globalThis as unknown as { aula: { on(event: string, fn: (payload: unknown) => void): void }; commands?: unknown[] }
      g.commands = []
      g.aula.on('app.command', (payload) => g.commands?.push(payload))
    })
    expect(await clickMenu(app, 'Support Aula…')).toBe(true)
    await expect(mac.getByTestId('about-support')).toBeInViewport()
    await device.waitForTimeout(1000)
    expect(await device.evaluate(() => (globalThis as unknown as { commands: unknown[] }).commands)).toEqual([])
    await expect(device.locator('[data-settings-page]')).toHaveCount(0)

    await navigateTo(device, { name: 'settings', section: 'about' })

    // en un navegador, enlaces de verdad (los abre el navegador del dispositivo, no el Mac)
    const support = device.getByTestId('about-support')
    await support.scrollIntoViewIfNeeded()
    const donate = support.getByRole('link', { name: 'Donate on GitHub Sponsors', exact: true })
    await expect(donate).toHaveAttribute('href', SPONSORS)
    await expect(donate).toHaveAttribute('target', '_blank')
    await expect(donate).toHaveAttribute('data-variant', 'secondary')
    const star = support.getByRole('link', { name: 'star it on GitHub', exact: true })
    await expect(star).toHaveAttribute('href', 'https://github.com/luumlabs/aula')
    await expect(star).toHaveCSS('text-decoration-line', 'underline')

    // dentro de una app nativa: lo que diga su supportLink()
    const bridge = (kind: 'old' | 'yes' | 'no') =>
      device.evaluate((k) => {
        const w = globalThis as unknown as { aulaApp?: unknown; dispatchEvent(e: Event): boolean }
        w.aulaApp = k === 'old' ? { switchAula() {} } : { supportLink: () => k === 'yes' }
        w.dispatchEvent(new Event('aula:app'))
      }, kind)
    // una app de antes, que no lo dice: no se enseña
    await bridge('old')
    await expect(support).toHaveCount(0)
    // el iPhone con la tienda de EE. UU., o Android: sí
    await bridge('yes')
    await expect(device.getByTestId('about-support')).toBeVisible()
    // la tienda cambió con la página abierta: se va
    await bridge('no')
    await expect(device.getByTestId('about-support')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
