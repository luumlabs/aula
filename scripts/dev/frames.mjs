// Fotogramas de la animación al entrar en un curso (cortina de píxeles + icono que se enciende).
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'aula-fr-'))
writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'es', name: 'Boris' } }))
const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 900 })
await win.waitForTimeout(1500)
await win.evaluate(() => window.__aula.navigate({ name: 'course', id: 'demo-quimica', tab: 'learn' }))
await win.waitForTimeout(1500)
await win.evaluate(() => window.__aula.navigate({ name: 'home' }))
await win.waitForTimeout(1200)
await win.evaluate(() => window.__aula.navigate({ name: 'course', id: 'exam-2-math112' }))
const t0 = Date.now()
for (const ms of [330, 420, 520, 640, 800]) {
  const wait = ms - (Date.now() - t0)
  if (wait > 0) await win.waitForTimeout(wait)
  await win.screenshot({ path: join(out, `frame-${ms}.png`) })
}
await app.close()
