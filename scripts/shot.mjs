// Capturas de la app real (Electron) para revisar la interfaz sin pantalla:
//   xvfb-run -a node scripts/shot.mjs --out shots/home.png [--route home] [--theme dark|light] [--size 1440x900]
//                                     [--home /ruta/datos] [--wait 1500] [--eval "js"] [--seed demo] [--lang es|en]
// Con --route usa el gancho de desarrollo window.__aula.navigate (solo existe sin empaquetar).
import { _electron as electron } from 'playwright'
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, [])
)
const out = resolve(args.out || 'shots/shot.png')
const [w, h] = (args.size || '1440x900').split('x').map(Number)
const home = args.home || mkdtempSync(join(tmpdir(), 'aula-shot-'))
mkdirSync(dirname(out), { recursive: true })
// Idioma de la interfaz para la captura (--lang es|en): ajustes iniciales de la carpeta de datos
if (args.lang && !args.home) writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: args.lang } }))
// En modo demostración la biblioteca empieza con el curso de ejemplo real (Trigonometría), si no se dio otra carpeta.
if (args.demo && !args.home && !existsSync(join(home, 'Packs', 'exam-2-math112'))) cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })

const app = await electron.launch({
  args: [resolve('.'), '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, AULA_HOME: home, AULA_SEED: args.seed || (args.demo ? 'demo' : ''), AULA_DEMO: args.demo ? '1' : '', AULA_THEME: args.theme || '', AULA_SKIP_ONBOARDING: args.onboarding ? '' : '1' }
})
const win = await app.firstWindow()
await win.setViewportSize({ width: w, height: h })
win.on('console', (m) => { if (m.type() === 'error') console.error('[renderer]', m.text()) })
win.on('pageerror', (e) => console.error('[pageerror]', e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(Number(args.boot || 1200))
if (args.theme) await win.evaluate((t) => window.__aula?.setTheme?.(t), args.theme)
if (args.route) await win.evaluate((r) => window.__aula?.navigate?.(JSON.parse(r)), args.route.startsWith('{') ? args.route : JSON.stringify({ name: args.route }))
if (args.eval) await win.evaluate(args.eval)
await win.waitForTimeout(Number(args.wait || 1500))
await win.screenshot({ path: out })
console.log('captura:', out)
await app.close()
