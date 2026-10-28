import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const home = mkdtempSync(join(tmpdir(), 'aula-dbg-'))
writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: false, general: { language: 'es' } }))
const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
win.on('console', (m) => console.log('[console]', m.type(), m.text()))
await win.waitForTimeout(2500)
const btn = win.locator('button:has-text("Empezar")').first()
console.log('count', await win.locator('button:has-text("Empezar")').count(), await btn.isVisible(), await btn.boundingBox())
const el = await win.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Empezar')); const r=b.getBoundingClientRect(); const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return top?.outerHTML.slice(0,200) })
console.log('top element:', el)
await btn.click({ force: true })
await win.waitForTimeout(1500)
console.log(await win.evaluate(() => document.body.innerText.slice(0, 200)))
await app.close()
