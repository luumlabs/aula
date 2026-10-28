// Capturas de los logos de las IA (Ajustes → Tu IA, bienvenida, selector de modelo, monitor de creación) en claro y oscuro.
// Uso: node scripts/dev/shots-logos.mjs <carpeta> [es|en]   (tras npm run build). Datos aislados en un AULA_HOME temporal,
// con claves de prueba inventadas (no son de nadie: solo hacen que Aula enseñe esos proveedores como configurados).
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const out = resolve(process.argv[2] ?? 'shots-logos')
const lang = process.argv[3] ?? 'es'
mkdirSync(out, { recursive: true })
const TEST_KEYS = {
  anthropic: 'sk-ant-test-aula-logos-000000000000000000',
  openrouter: 'sk-or-test-aula-logos-000000000000000000',
  deepseek: 'sk-0123456789abcdef0123456789abcdef',
  gemini: 'AIzaTestAulaLogos000000000000000000000'
}

async function run(onboarded, theme, fn) {
  const home = mkdtempSync(join(tmpdir(), 'aula-logos-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded, general: { language: lang, theme, name: onboarded ? 'Boris' : '' } }))
  const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 900 })
    win.on('pageerror', (e) => console.error('[pageerror]', e.message))
    await win.waitForTimeout(1600)
    await win.evaluate((t) => window.__aula?.setTheme(t), theme)
    await fn(win)
  } finally {
    await app.close()
  }
}

const setKeys = (win) =>
  win.evaluate(async (keys) => {
    for (const [providerId, key] of Object.entries(keys)) await window.aula.invoke('ai.setKey', { providerId, key })
    await window.aula.invoke('ai.configure', { providerId: 'openrouter' })
  }, TEST_KEYS)

for (const theme of ['light', 'dark']) {
  await run(true, theme, async (win) => {
    // sin claves: las cápsulas con los proveedores que admite una clave
    await win.evaluate(() => window.__aula.navigate({ name: 'settings' }))
    await win.waitForTimeout(2200)
    await win.screenshot({ path: join(out, `ajustes-${theme}.png`) })
    await setKeys(win)
    await win.evaluate(() => window.__aula.navigate({ name: 'home' }))
    await win.waitForTimeout(600)
    await win.evaluate(() => window.__aula.navigate({ name: 'settings' }))
    await win.waitForTimeout(2200)
    await win.screenshot({ path: join(out, `ajustes-claves-${theme}.png`) })
    // el gasto: «Cuenta lo gastado con» y los logos de las claves de pago
    await win.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollBy(0, 420))
    await win.waitForTimeout(700)
    await win.screenshot({ path: join(out, `gasto-${theme}.png`) })
    await win.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0))
    // pasar el ratón por una fila: el logo toma su color
    const row = win.locator('.group:has-text("Google Gemini")').first()
    if (await row.count()) {
      await row.hover()
      await win.waitForTimeout(500)
      const box = await row.boundingBox()
      if (box) await win.screenshot({ path: join(out, `fila-hover-${theme}.png`), clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } })
    }
    // el selector de modelo de OpenRouter (cada modelo con el logo de quien lo hizo)
    const select = win.locator('.group:has-text("OpenRouter") [data-aula-select]').first()
    if (await select.count()) {
      await select.click()
      await win.waitForTimeout(500)
      await win.screenshot({ path: join(out, `modelos-${theme}.png`) })
      await win.keyboard.press('Escape')
    }
    // la pastilla «Detectado: …» al pegar una clave
    const field = win.locator('input[type="password"]').first()
    await field.fill('gsk_test_aula_logos_0000000000')
    await win.waitForTimeout(500)
    const card = win.locator('input[type="password"]').first().locator('xpath=ancestor::div[contains(@class,"flex-col")][1]')
    const cb = await card.boundingBox()
    if (cb) await win.screenshot({ path: join(out, `detectado-${theme}.png`), clip: { x: cb.x - 12, y: cb.y - 12, width: cb.width + 24, height: cb.height + 24 } })
    await field.fill('')
    // el monitor de una creación: un id que el proceso principal rechaza hace que la interfaz enseñe la de demostración
    await win.evaluate(() => window.__aula.navigate({ name: 'run', id: 'demo-' + 'x'.repeat(120) }))
    await win.waitForTimeout(2000)
    await win.screenshot({ path: join(out, `monitor-${theme}.png`), clip: { x: 0, y: 0, width: 1440, height: 420 } })
  })
  await run(false, theme, async (win) => {
    await win.waitForTimeout(800)
    await win.getByRole('button', { name: lang === 'es' ? 'Empezar' : 'Get started', exact: true }).click()
    await win.waitForTimeout(2200)
    await win.screenshot({ path: join(out, `bienvenida-${theme}.png`) })
  })
}
console.log('ok', out)
