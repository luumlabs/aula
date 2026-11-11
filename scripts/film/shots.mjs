// Las capturas de la app real que salen al final del corto (a doble densidad, con el curso de ejemplo, en inglés):
//   npm run build && node scripts/film/shots.mjs      → scripts/film/assets/*.png (git no las guarda)
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const OUT = resolve('scripts/film/assets')
mkdirSync(OUT, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'aula-film-'))
writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', theme: 'light' } }))
cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
const app = await electron.launch({
  args: [resolve('.'), '--no-sandbox', '--force-device-scale-factor=2'],
  env: { ...process.env, AULA_HOME: home, AULA_SEED: 'demo', AULA_DEMO: '1', AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_THEME: 'light' }
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 900 })
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)
const ID = 'exam-2-math112'
// el recuadro del visor 3D de moléculas en la ventana de 1440×900
const MOL = { x: 300, y: 118, width: 730, height: 580 }
const go = async (route, wait = 2200) => {
  await win.evaluate((r) => window.__aula?.navigate?.(r), route)
  await win.waitForTimeout(wait)
}
const shot = async (name) => {
  await win.screenshot({ path: join(OUT, `${name}.png`) })
  console.log('✓', name)
}
await go({ name: 'home' }, 3200)
await shot('today')
await go({ name: 'course', id: ID, tab: 'overview' }, 2600)
await shot('course')
await go({ name: 'study', id: ID, mode: 'learn', skill: 'reference-angles' }, 3000)
// la opción A de la pregunta de entrada (las fórmulas no se encuentran por texto: se pulsa en su sitio)
await win.mouse.click(832, 453)
await win.waitForTimeout(900)
await win.getByRole('button', { name: /Continue/ }).first().click({ timeout: 5000 }).catch(() => undefined)
await win.waitForTimeout(2600)
await shot('lesson')
await go({ name: 'study', id: ID, mode: 'cards' }, 2600)
await win.getByRole('button', { name: /Flip/ }).first().click({ timeout: 5000 }).catch(() => undefined)
await win.waitForTimeout(1400)
await shot('cards')
await go({ name: 'calendar', view: 'month' }, 2400)
await shot('calendar')
// modelos en 3D, gráficas y herramientas
// la molécula gira sola: una secuencia de fotogramas (solo su recuadro), para que en el corto gire de verdad
await go({ name: 'tools', tool: 'molecules' }, 4200)
await shot('molecules')
for (let i = 0; i < 36; i++) {
  await win.screenshot({ path: join(OUT, `mol-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 90, clip: MOL })
  await win.waitForTimeout(40)
}
console.log('✓ molécula girando (36 fotogramas)')
await go({ name: 'tools', tool: 'grapher' }, 3600)
await shot('grapher')
await go({ name: 'tools', tool: 'periodic' }, 3200)
await shot('periodic')
await go({ name: 'tools', tool: 'physics' }, 3800)
await win.getByRole('button', { name: /Launch/ }).first().click({ timeout: 5000 }).catch(() => undefined)
await win.waitForTimeout(1500)
await shot('physics')
await go({ name: 'tools' }, 2600)
await shot('tools')
await go({ name: 'stats' }, 3200)
await shot('stats')
await go({ name: 'study', id: ID, mode: 'exam' }, 3000)
await shot('exam')
// el apartado de la IA: preguntarle a Aula y un cuestionario en la conversación
await go({ name: 'chat' }, 2600)
const box = win.locator('textarea').first()
await box.fill('Give me a quick quiz')
await box.press('Enter')
await win.waitForSelector('[data-studyset="quiz"]', { timeout: 30000 }).catch(() => undefined)
await win.waitForTimeout(2500)
await shot('chat')
await win.getByRole('button', { name: /^Start$/ }).first().click({ timeout: 5000 }).catch(() => undefined)
await win.waitForTimeout(1500)
await shot('quiz')
await app.close()
