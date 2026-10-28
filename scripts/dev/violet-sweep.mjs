// Barrido de violeta: abre la app compilada (out/) con datos de ejemplo, recorre las pantallas en claro y en oscuro y cuenta
// los píxeles violetas, morados o lilas de la interfaz (OKLCH: matiz 270–335°, croma ≥ 0,06; la misma definición que
// src/renderer/src/design/colorGuard.ts). No cuenta las imágenes del estudiante (<img>, bloques de imagen, visores 3D).
// Uso: npm run build && node scripts/dev/violet-sweep.mjs [carpeta-de-capturas]
// Sale con código 1 si alguna pantalla tiene más de MAX píxeles violetas (por defecto 40; los bordes suavizados dan alguno).
import { _electron as electron } from 'playwright'
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve('.')
const OUT = process.argv[2] ? resolve(process.argv[2]) : null
const MAX = Number(process.env.MAX ?? 40)
if (OUT) mkdirSync(OUT, { recursive: true })

const ROUTES = [
  ['home', { name: 'home' }],
  ['course', { name: 'course', id: 'exam-2-math112' }],
  ['course-reference', { name: 'course', id: 'exam-2-math112', tab: 'reference' }],
  ['learn', { name: 'study', id: 'exam-2-math112', mode: 'learn', skill: 'exact-trig-values' }],
  ['cards', { name: 'study', id: 'exam-2-math112', mode: 'cards' }],
  ['calendar', { name: 'calendar' }],
  ['chat', { name: 'chat' }],
  ['create', { name: 'create' }],
  ['tools', { name: 'tools' }],
  ['periodic', { name: 'tools', tool: 'periodic' }],
  ['grapher', { name: 'tools', tool: 'grapher' }],
  ['stats', { name: 'stats' }],
  ['documents', { name: 'documents' }],
  ['inbox', { name: 'inbox' }],
  ['settings', { name: 'settings' }],
  ['gallery', { name: 'gallery' }]
]

/** Cuenta píxeles violetas de una captura (PNG en base64) dentro de la página, saltándose las zonas excluidas. */
async function countViolet(win, png) {
  return win.evaluate(async ({ b64 }) => {
    const skip = [...document.querySelectorAll('img, [data-block="image"], [data-block="model3d"], canvas[data-engine]')].map((e) => e.getBoundingClientRect())
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const { data, width, height } = g.getImageData(0, 0, bmp.width, bmp.height)
    const sx = width / window.innerWidth
    const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    const cache = new Map()
    let n = 0
    let box = null
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
        let v = cache.get(key)
        if (v === undefined) {
          const R = lin(data[i]), G = lin(data[i + 1]), B = lin(data[i + 2])
          const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
          const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
          const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
          const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
          const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
          const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
          const h = ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360
          v = Math.hypot(A, Bb) >= 0.06 && h >= 270 && h <= 335 && L > 0.2 && L < 0.97
          cache.set(key, v)
        }
        if (!v) continue
        const px = x / sx, py = y / sx
        if (skip.some((r) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom)) continue
        n++
        box = box ? [Math.min(box[0], px), Math.min(box[1], py), Math.max(box[2], px), Math.max(box[3], py)] : [px, py, px, py]
      }
    }
    return { n, box: box && box.map(Math.round) }
  }, { b64: png.toString('base64') })
}

async function sweep(lang) {
  const home = mkdtempSync(join(tmpdir(), 'aula-violet-'))
  cpSync(join(ROOT, 'resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: lang, name: 'Ada' } }))
  const app = await electron.launch({ args: [ROOT, '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1', AULA_FAKE_AI: '1', AULA_SEED: 'demo', AULA_NO_UPDATES: '1' } })
  const bad = []
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 900 })
    await win.waitForTimeout(2200)
    await win.evaluate(() => document.documentElement.setAttribute('data-pixel-idle', 'off'))
    for (const [name, route] of ROUTES) {
      await win.evaluate((r) => window.__aula.navigate(r), route)
      await win.waitForTimeout(1600)
      for (const theme of ['light', 'dark']) {
        await win.evaluate((t) => window.__aula.setTheme(t), theme)
        await win.waitForTimeout(500)
        const png = await win.screenshot({ timeout: 15000 })
        if (OUT) writeFileSync(join(OUT, `${lang}-${name}-${theme}.png`), png)
        const { n, box } = await countViolet(win, png)
        const line = `${lang} ${name.padEnd(17)} ${theme.padEnd(5)} ${String(n).padStart(6)} px violeta${box ? `  (x ${box[0]}–${box[2]}, y ${box[1]}–${box[3]})` : ''}`
        console.log(line)
        if (n > MAX) bad.push(line)
      }
    }
  } finally {
    await app.close().catch(() => {})
    rmSync(home, { recursive: true, force: true })
  }
  return bad
}

const bad = [...(await sweep('es')), ...(await sweep('en'))]
if (bad.length) {
  console.error(`\nCon violeta (más de ${MAX} px):\n${bad.join('\n')}`)
  process.exit(1)
}
console.log('\nSin violeta en la interfaz.')
