import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: mkdtempSync(join(tmpdir(), 'dbg-')), AULA_DEMO: '1' } })
const win = await app.firstWindow()
win.on('console', (m) => console.log('[console]', m.type(), m.text()))
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
win.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText))
await win.waitForTimeout(1500)
await win.evaluate((r) => window.__aula.navigate(JSON.parse(r)), process.argv[3] || '{"name":"gallery"}')
await win.waitForTimeout(4000)
console.log(await win.evaluate(() => document.querySelector('main')?.lastElementChild?.outerHTML.slice(0, 1200)))
const chunk = process.argv[2]
if (chunk) console.log(await win.evaluate(async (c) => { try { const m = await import(c); return 'ok ' + Object.keys(m) } catch (e) { return 'ERR ' + e.message } }, chunk))
await app.close()
