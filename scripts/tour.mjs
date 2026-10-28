// Recorrido de capturas de la interfaz (modo demostración): una sola app, varias pantallas, claro y oscuro.
//   xvfb-run -a node scripts/tour.mjs <carpeta-salida> [--size 1440x900] [--lang es]
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const outDir = resolve(process.argv[2] || 'shots/tour')
const sizeArg = process.argv.indexOf('--size')
const [W, H] = (sizeArg > 0 ? process.argv[sizeArg + 1] : '1440x900').split('x').map(Number)
const langArg = process.argv.indexOf('--lang')
const lang = langArg > 0 ? process.argv[langArg + 1] : 'es'
mkdirSync(outDir, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'aula-tour-'))
// la biblioteca empieza con el curso de ejemplo real
cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: lang, name: 'Boris' } }))

const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: W, height: H })
win.on('pageerror', (e) => console.error('[pageerror]', e.message))
win.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()))
await win.waitForTimeout(1800)

const go = (r) => win.evaluate((x) => window.__aula.navigate(x), r)
const theme = (t) => win.evaluate((x) => window.__aula.setTheme(x), t)
const shot = async (name, wait = 1600) => {
  await win.waitForTimeout(wait)
  await win.screenshot({ path: join(outDir, `${name}.png`) })
  console.log(name)
}

const course = 'exam-2-math112'
const steps = [
  ['theme', 'light'],
  ['go', { name: 'home' }, '01-hoy'],
  ['go', { name: 'course', id: course, tab: 'learn' }, null, 1500],
  ['go', { name: 'home' }, null, 900],
  ['go', { name: 'course', id: course }, '02-curso-animacion', 230],
  ['wait', 1800, '03-curso-resumen'],
  ['go', { name: 'course', id: course, tab: 'learn' }, '04-curso-aprender'],
  ['go', { name: 'course', id: course, tab: 'reference' }, '05-curso-referencia'],
  ['go', { name: 'course', id: course, tab: 'cards' }, '06-curso-tarjetas'],
  ['go', { name: 'tools' }, '07-herramientas'],
  ['go', { name: 'tools', tool: 'timer' }, '08-temporizador'],
  ['go', { name: 'gallery' }, '09-pixel-art', 3500],
  ['go', { name: 'home' }, null],
  ['palette', null, '10-paleta'],
  ['theme', 'dark'],
  ['go', { name: 'home' }, '11-hoy-oscuro'],
  ['go', { name: 'course', id: course }, '12-curso-oscuro', 2600],
  ['go', { name: 'course', id: course, tab: 'reference' }, '13-referencia-oscuro']
]
for (const [kind, arg, name, wait] of steps) {
  if (kind === 'theme') await theme(arg)
  if (kind === 'go') await go(arg)
  if (kind === 'palette') {
    await win.keyboard.press('Control+k')
    await win.keyboard.type('trig', { delay: 40 })
  }
  if (kind === 'wait') await win.waitForTimeout(arg)
  if (name) await shot(name, kind === 'wait' ? 0 : wait)
  if (kind === 'palette') await win.keyboard.press('Escape')
}
await app.close()
