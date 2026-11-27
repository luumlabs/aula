// Los dibujos a tinta de la app de iPhone/iPad (native/ios) y Android (native/android):
//  - el arco «El umbral» a cada hora (ArchDawn, ArchNoon, ArchDusk, ArchNight), de la misma mano que el icono y la
//    marca viva de Hoy (scripts/dev/icon/umbral-art.mjs), con luz ambiental según la hora sobre el papel exacto;
//  - el flexo (SpotLamp), sacado de la app REAL (design/InkArt.tsx, por la galería de diseño) sobre el papel exacto.
//   npm run build && node scripts/dev/ios-art.mjs
// Escribe native/ios/Aula/Assets.xcassets/<Nombre>.imageset/{light,dark}.png (1080×930 a 3x) y su Contents.json.
// Las imágenes son opacas con el color «Paper» exacto de Paper.colorset / styles.css (#FAF8F3 en claro, #121110 en
// oscuro) para que las aguadas y luces se fundan sin bordes visibles.
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BOX, cel } from './icon/umbral-art.mjs'

const ASSETS = resolve('native/ios/Aula/Assets.xcassets')
/** El papel exacto de Paper.colorset, styles.css y native/android/res (themes.xml). */
const PAPER = { light: '#faf8f3', dark: '#121110' }
const INK = { light: '#191714', dark: '#f2efe9' }
const SUN = { light: '#b8502d', dark: '#e89266' }
/** El dibujo se pinta al triple (la app lo usa a 3x): 300×250 pt, con 30 pt de aire (1080×930 px). */
const S = 3
const W = 300 * S, H = 250 * S, PAD = 30 * S
const FULL_W = W + 2 * PAD
const FULL_H = H + 2 * PAD

const ARCH_SCENES = {
  ArchDawn: {
    frame: cel({ seed: 3, lift: 0, open: 2 }),
    glow: { light: ['#e8bc72', 0.24, '#d68c60', 0.10], dark: ['#e09e5c', 0.16, '#d48056', 0.08] },
    cy: 0.62
  },
  ArchNoon: {
    frame: cel({ seed: 11, lift: 22, open: 3, rays: 0.65 }),
    glow: { light: ['#f2c275', 0.22, '#e8bc72', 0.08], dark: ['#f2c275', 0.15, '#e09e5c', 0.07] },
    cy: 0.54
  },
  ArchDusk: {
    frame: cel({ seed: 19, lift: 6, open: 1 }),
    glow: { light: ['#d68c60', 0.24, '#b8502d', 0.10], dark: ['#e89266', 0.17, '#c7694b', 0.08] },
    cy: 0.60
  },
  ArchNight: {
    frame: cel({ seed: 27, lift: 0, open: -4 }),
    glow: { light: ['#b8a898', 0.16, '#8f8478', 0.06], dark: ['#8c7d6e', 0.14, '#5e5348', 0.06] },
    cy: 0.58
  }
}

function umbralSceneSvg(name, theme) {
  const s = ARCH_SCENES[name]
  const [c1, o1, c2, o2] = s.glow[theme]
  const scale = 640 / Math.max(BOX.w, BOX.h)
  const cx = FULL_W / 2
  const cy = FULL_H / 2 + 12
  const ink = s.frame.ink.map((d) => `<path d="${d}" fill="${INK[theme]}"/>`).join('')
  const sun = s.frame.sun.map((d) => `<path d="${d}" fill="${SUN[theme]}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FULL_W}" height="${FULL_H}" viewBox="0 0 ${FULL_W} ${FULL_H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="${Math.round(s.cy * 100)}%" r="42%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="${o1}"/>
      <stop offset="52%" stop-color="${c2}" stop-opacity="${o2}"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${FULL_W}" height="${FULL_H}" fill="url(#g)"/>
  <g transform="translate(${cx} ${cy}) scale(${scale.toFixed(5)}) translate(${-BOX.cx} ${-BOX.cy})">${ink}${sun}</g>
</svg>`
}

function writeContents(dir) {
  writeFileSync(join(dir, 'Contents.json'), JSON.stringify({
    images: [
      { filename: 'light.png', idiom: 'universal', scale: '3x' },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'dark.png', idiom: 'universal', scale: '3x' }
    ],
    info: { author: 'xcode', version: 1 }
  }, null, 2) + '\n')
}

for (const theme of ['light', 'dark']) {
  const home = mkdtempSync(join(tmpdir(), 'aula-ios-art-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en' } }))
  const app = await electron.launch({
    args: [resolve('.'), '--no-sandbox', '--force-color-profile=srgb'],
    env: { ...process.env, AULA_HOME: home, AULA_THEME: theme, AULA_SKIP_ONBOARDING: '1' }
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 1200 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate((t) => window.__aula?.setTheme?.(t), theme)
  await win.evaluate(() => window.__aula?.navigate?.({ name: 'gallery' }))
  await win.waitForSelector('svg.ink-art:not(.ink-live-layer)')

  // 1. Los cuatro momentos del arco «El umbral» rasterizados en Chromium sobre el papel exacto (1080×930 opacos)
  for (const name of Object.keys(ARCH_SCENES)) {
    const svg = umbralSceneSvg(name, theme)
    const b64 = await win.evaluate(async ([svgText, w, h]) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)))
      await img.decode()
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, 0, 0, w, h)
      return c.toDataURL('image/png').split(',')[1]
    }, [svg, FULL_W, FULL_H])
    const dir = join(ASSETS, `${name}.imageset`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${theme}.png`), Buffer.from(b64, 'base64'))
    writeContents(dir)
    console.log(theme, name)
  }

  // 2. El flexo (SpotLamp = INK_SPOT_NAMES[5]) aislado en un lienzo limpio sobre el papel exacto (#FAF8F3 / #121110)
  await win.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`
  })
  await win.evaluate(([paper, w, h, fw, fh]) => {
    const spots = document.querySelectorAll('svg.ink-art:not(.ink-live-layer)')
    const lamp = spots[5]
    if (!lamp) throw new Error(`SpotLamp no encontrado (svg.ink-art:not(.ink-live-layer) count=${spots.length})`)
    const stage = document.createElement('div')
    stage.id = '__aula_spot_stage'
    Object.assign(stage.style, {
      position: 'fixed', left: '0', top: '0', width: `${fw}px`, height: `${fh}px`,
      zIndex: '2147483647', background: paper, display: 'flex', alignItems: 'center', justifyContent: 'center'
    })
    const clone = lamp.cloneNode(true)
    clone.style.width = `${w}px`
    clone.style.height = `${h}px`
    clone.style.maxWidth = 'none'
    stage.appendChild(clone)
    document.body.appendChild(stage)
  }, [PAPER[theme], W, H, FULL_W, FULL_H])
  await win.waitForTimeout(400)
  const dir = join(ASSETS, 'SpotLamp.imageset')
  mkdirSync(dir, { recursive: true })
  await win.screenshot({ path: join(dir, `${theme}.png`), clip: { x: 0, y: 0, width: FULL_W, height: FULL_H } })
  writeContents(dir)
  console.log(theme, 'SpotLamp')
  await app.close()
}
