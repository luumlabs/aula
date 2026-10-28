import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true })
async function run(onboarded, fn) {
  const home = mkdtempSync(join(tmpdir(), 'aula-set-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded, general: { language: 'es', name: onboarded ? 'Boris' : '' } }))
  const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  win.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await win.waitForTimeout(1800)
  await fn(win)
  await app.close()
}
await run(true, async (win) => {
  await win.evaluate(() => window.__aula.navigate({ name: 'settings' }))
  await win.waitForTimeout(2200)
  await win.screenshot({ path: join(out, 'ajustes-1.png') })
  await win.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollBy(0, 760)); await win.waitForTimeout(900)
  await win.screenshot({ path: join(out, 'ajustes-2.png') })
})
await run(false, async (win) => {
  await win.waitForTimeout(1200)
  await win.screenshot({ path: join(out, 'bienvenida-1.png') })
  await win.getByRole('button', { name: 'Empezar', exact: true }).click(); await win.waitForTimeout(1800)
  await win.screenshot({ path: join(out, 'bienvenida-2-ia.png') })
  await win.getByRole('button', { name: 'Continuar', exact: true }).click(); await win.waitForTimeout(1500)
  await win.screenshot({ path: join(out, 'bienvenida-3-plataforma.png') })
  await win.getByRole('button', { name: 'Continuar', exact: true }).click(); await win.waitForTimeout(1500)
  await win.screenshot({ path: join(out, 'bienvenida-4-listo.png') })
})
