// Los dibujos a tinta de la app de iPhone/iPad (native/ios): el arco de Aula a cada hora y el flexo, sacados de la app
// REAL (design/InkArt.tsx, por la galería de diseño) para que sean los mismos trazos, sobre el papel de cada tema.
//   npm run build && node scripts/dev/ios-art.mjs
// Escribe native/ios/Aula/Assets.xcassets/<Nombre>.imageset/{light,dark}.png (a 3x) y su Contents.json. Las imágenes son
// opacas, con el color «Paper» de la app de iOS de fondo (el mismo --paper de aquí), porque en oscuro la acuarela suma luz
// sobre el papel y con transparencia saldría apagada.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ASSETS = resolve('native/ios/Aula/Assets.xcassets')
/** Orden de la galería: las cuatro horas del arco y los seis objetos. */
const NAMES = ['ArchDawn', 'ArchNoon', 'ArchDusk', 'ArchNight', null, null, null, null, null, 'SpotLamp']
const PAPER = { light: '#fcfaf5', dark: '#181613' }
/** El dibujo se pinta al triple (la app lo usa a 3x): 300×250 pt, con 30 pt de aire para las aguadas que se salen. */
const S = 3
const W = 300 * S, H = 250 * S, PAD = 30 * S

for (const theme of ['light', 'dark']) {
  const home = mkdtempSync(join(tmpdir(), 'aula-ios-art-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en' } }))
  const app = await electron.launch({
    args: [resolve('.'), '--no-sandbox'],
    env: { ...process.env, AULA_HOME: home, AULA_THEME: theme, AULA_SKIP_ONBOARDING: '1' }
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 1200 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate((t) => window.__aula?.setTheme?.(t), theme)
  await win.evaluate(() => window.__aula?.navigate?.({ name: 'gallery' }))
  await win.waitForSelector('svg.ink-art')
  await win.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      html, body, #root, #root *:not(svg):not(svg *) { background: ${PAPER[theme]} !important; background-image: none !important; box-shadow: none !important; border-color: transparent !important; }
      /* solo los dibujos: ni barras, ni textos, ni la barra de desplazamiento */
      body * { visibility: hidden !important; }
      svg.ink-art, svg.ink-art * { visibility: visible !important; }
      ::-webkit-scrollbar { display: none !important; }
      svg.ink-art { width: ${W}px !important; height: ${H}px !important; margin: ${PAD + 20}px !important; max-width: none !important; }`
  })
  await win.waitForTimeout(800)
  const count = await win.locator('svg.ink-art').count()
  for (let i = 0; i < Math.min(count, NAMES.length); i++) {
    const name = NAMES[i]
    if (!name) continue
    const el = win.locator('svg.ink-art').nth(i)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }))
    await win.waitForTimeout(250)
    const box = await el.boundingBox()
    if (box.y < PAD || box.x < PAD) throw new Error(`${name}: el dibujo queda cortado por el borde de la ventana`)
    const dir = join(ASSETS, `${name}.imageset`)
    mkdirSync(dir, { recursive: true })
    await win.screenshot({ path: join(dir, `${theme}.png`), clip: { x: box.x - PAD, y: box.y - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD } })
    writeFileSync(join(dir, 'Contents.json'), JSON.stringify({
      images: [
        { filename: 'light.png', idiom: 'universal', scale: '3x' },
        { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'dark.png', idiom: 'universal', scale: '3x' }
      ],
      info: { author: 'xcode', version: 1 }
    }, null, 2) + '\n')
    console.log(theme, name)
  }
  await app.close()
}
