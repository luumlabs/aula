import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'aula-cr-'))
writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'es', name: 'Boris' } }))
const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 900 })
win.on('pageerror', (e) => console.error('[pageerror]', e.message))
await win.waitForTimeout(1500)
await win.evaluate(() => window.__aula.navigate({ name: 'create', prefill: { title: 'Química general · Examen final' } }))
await win.waitForTimeout(2200)
await win.screenshot({ path: join(out, 'crear.png') })
await win.evaluate(() => window.__aula.navigate({ name: 'run', id: 'demo' }))
await win.waitForTimeout(4500)
await win.screenshot({ path: join(out, 'monitor.png') })
await app.close()
