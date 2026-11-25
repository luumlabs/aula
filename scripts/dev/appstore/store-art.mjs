// Las piezas del App Store de Aula para iPhone y iPad, pintadas en HTML (store-art.html) con el Electron del proyecto y
// Playwright, sin dependencias nuevas: la letra es Newsreader (OFL, de node_modules), los colores los de styles.css y el
// pincel el de la app (design/paint, juntado con esbuild). Cada pieza se maqueta en puntos y se captura a escala entera,
// así sale con los píxeles exactos que pide Apple.
//
//   node scripts/dev/appstore/store-art.mjs shots [--slot iphone-6.9|iphone-6.3|ipad-13|all] [--lang en|es|all]
//        [--raw <carpeta>] [--out <carpeta>] [--standins <json>] [--stamp <texto>]
//     Las 7 capturas por ranura e idioma: titular serif + sublínea en cursiva sobre papel y la interfaz real en una
//     tarjeta. Lee <raw>/<iphone|ipad>/<lang>/0N-<nombre>.png (del simulador, con la barra de estado, que se quita) y
//     escribe <out>/<ranura>/<lang>/0N-<nombre>.jpg (JPEG al 92 %, sin alfa, comprobado con sips) y una hoja de contacto
//     en <out>/sheets/. Por defecto raw = docs/app-store/media/raw y out = docs/app-store/media/screenshots. El encuadre
//     de cada captura (`frame`) y los titulares partidos a mano (`lines`) están en store-copy.mjs.
//     --standins: prueba en seco con otras imágenes (p. ej. capturas de escritorio), encuadradas a mano:
//       { "iphone": { "today": { "src": "/ruta.jpg", "x": 0.2, "y": 0, "zoom": 1 }, … }, "ipad": { … } }
//
//   node scripts/dev/appstore/store-art.mjs video [--device iphone|ipad|all] [--lang en|es|all] [--out <carpeta>]
//        [--taps <taps.json>] [--plan-b]
//     Lo que va encima de la vista previa, en PNG con alfa a tamaño de fotograma (886×1920 o 1600×1200): la franja de
//     papel, los cinco rótulos, «Sequence shortened», los toques y la cartela final, en <out>/art/<device>/<lang>/; y el
//     EDL para app-preview.swift en <out>/<device>-<lang>.edl.json, con las tomas por rellenar (from/to). Por defecto
//     out = docs/app-store/media. taps.json, en puntos del simulador (de la captura del ensayo: píxeles ÷ 3 o ÷ 2):
//       { "iphone": { "check": [x, y], "explain": [x, y], "card": [x, y], "good": [x, y] }, "ipad": { … } }
//     (o por idioma: { "iphone": { "en": { … }, "es": { … } } }). --plan-b: sin «Sequence shortened» (la pista del
//     ejercicio en lugar del tutor, §2.11 del plan).
import { _electron as electron } from 'playwright'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CAPTIONS, CAPTION_FADE, CLIPS, END_CARD, PREVIEW_DURATION, SHORTENED, SHOTS, SHOT_TYPE, SLOTS, SOURCES, TAPS, VIDEO } from './store-copy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')
const MEDIA = join(ROOT, 'docs/app-store/media')
const require = createRequire(import.meta.url)

const [cmd, ...rest] = process.argv.slice(2)
const flag = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d)
const list = (v, all) => (v === 'all' ? all : v.split(','))

// ── Lo que se inyecta en la página: la letra (en data:, porque desde file:// la carga de fuentes pasa por CORS) y el pincel ──
function fontCss() {
  const dir = join(ROOT, 'node_modules/@fontsource-variable/newsreader')
  return ['index.css', 'wght-italic.css']
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
    .replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => `url(data:font/woff2;base64,${readFileSync(join(dir, 'files', file)).toString('base64')})`)
}

async function inkKit() {
  const entry = `
    import { underlineInk } from './src/renderer/src/design/paint/drawings'
    import { deform, ellipse } from './src/renderer/src/design/paint/shapes'
    import { rngFrom, seedOf } from './src/renderer/src/design/paint/random'
    // una mancha de tinta redonda y cortada a mano (para los toques), con el mismo azar con semilla que el resto
    function dot(size: number, seed: string | number) {
      const rng = rngFrom(seedOf('toque:' + seed))
      const pad = Math.ceil(size * 0.3)
      const w = size + pad * 2
      const poly = deform(ellipse(w / 2, w / 2, size / 2, size * 0.47, 9, rng, [0.05, 0.12]), 3, rng, 1, 0.6)
      return { w, h: w, d: 'M' + poly.map((p) => p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join('L') + 'Z' }
    }
    ;(globalThis as unknown as { AulaInk: unknown }).AulaInk = { underlineInk, dot }
  `
  const r = await build({ stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'ink-kit.ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome140', logLevel: 'error' })
  return r.outputFiles[0].text
}

/** Abre la página en un Electron propio (nunca la app Aula), con perfil temporal y color sRGB. */
async function openPage() {
  const tmp = mkdtempSync(join(tmpdir(), 'aula-store-art-'))
  const main = join(tmp, 'main.cjs')
  writeFileSync(
    main,
    `const { app, BrowserWindow } = require('electron')
     app.setPath('userData', ${JSON.stringify(join(tmp, 'profile'))})
     app.commandLine.appendSwitch('force-color-profile', 'srgb')
     app.commandLine.appendSwitch('disable-renderer-backgrounding')
     app.dock?.hide()
     app.whenReady().then(() => {
       const win = new BrowserWindow({ show: false, width: 1400, height: 1000, paintWhenInitiallyHidden: true,
         webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
       win.loadFile(${JSON.stringify(join(HERE, 'store-art.html'))})
     })`
  )
  const app = await electron.launch({ executablePath: require('electron'), args: [main] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.addStyleTag({ content: fontCss() })
  await page.addScriptTag({ content: await inkKit() })
  await page.evaluate(() => document.fonts.load('500 30px "Newsreader Variable"').then(() => document.fonts.load('italic 400 15px "Newsreader Variable"')))
  const cdp = await page.context().newCDPSession(page)
  return {
    /** Pinta una pieza y la captura a `w`×`h` CSS por `scale` (PNG; transparente donde no hay nada). */
    async render(spec, w, h, scale, png) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false })
      const res = await page.evaluate((s) => window.renderArt(s), spec)
      if (spec.kind === 'sheet') {
        h = Math.ceil(res.height)
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false })
      }
      mkdirSync(dirname(png), { recursive: true })
      // la captura por CDP directamente: la de Playwright vuelve a la escala de la pantalla
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, fromSurface: true, captureBeyondViewport: false })
      writeFileSync(png, Buffer.from(shot.data, 'base64'))
      for (const msg of res.warnings) console.warn(`  ! ${show(png)}: ${msg}`)
      return res
    },
    async close() {
      await app.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

/** Tamaño, alfa y perfil de color según sips (lo mismo que mira App Store Connect). */
function sipsInfo(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', '-g', 'profile', file], { encoding: 'utf8' })
  const get = (k) => out.match(new RegExp(`${k}: (.+)`))?.[1].trim()
  return { w: Number(get('pixelWidth')), h: Number(get('pixelHeight')), alpha: get('hasAlpha') === 'yes', profile: get('profile') }
}

// Chromium etiqueta sus PNG con un perfil propio (Skia) que no es sRGB: los JPEG se convierten al sRGB estándar, así los
// colores guardados son los de styles.css (#f3f0e9, #b4502f) aunque quien los lea ignore el perfil
const SRGB_ICC = '/System/Library/ColorSync/Profiles/sRGB Profile.icc'
const SRGB_NAME = 'sRGB IEC61966-2.1'

function expectSize(file, w, h, alpha) {
  const i = sipsInfo(file)
  if (i.w !== w || i.h !== h) throw new Error(`${file}: ${i.w}×${i.h}, hacían falta ${w}×${h}`)
  if (alpha === false && i.alpha) throw new Error(`${file}: tiene alfa`)
  return i
}

const fileUrl = (p) => pathToFileURL(p).href
/** Segundos redondeados al milisegundo (el EDL se lee y se edita a mano). */
const ms = (s) => Math.round(s * 1000) / 1000
/** Ruta para los mensajes: relativa al repo si está dentro, entera si no. */
const show = (p) => (p.startsWith(ROOT + '/') ? relative(ROOT, p) : p)

// ── Capturas ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function shots() {
  const slots = list(flag('--slot', 'all'), Object.keys(SLOTS))
  const langs = list(flag('--lang', 'all'), ['en', 'es'])
  const raw = resolve(flag('--raw', join(MEDIA, 'raw')))
  const out = resolve(flag('--out', join(MEDIA, 'screenshots')))
  const standins = flag('--standins') ? JSON.parse(readFileSync(resolve(flag('--standins')), 'utf8')) : null
  const stamp = flag('--stamp', standins ? 'DRY RUN · desktop stand-in, not for upload' : null)
  const page = await openPage()
  const made = []
  try {
    for (const slotName of slots) {
      const slot = SLOTS[slotName]
      if (!slot) throw new Error(`ranura desconocida: ${slotName}`)
      const [W, H] = slot.page
      for (const lang of langs) {
        const items = []
        for (const s of SHOTS) {
          const base = `${String(s.n).padStart(2, '0')}-${s.name}`
          const stand = standins?.[slot.device]?.[s.name]
          const src = stand ? resolve(stand.src) : ['png', 'jpg'].map((e) => join(raw, slot.device, lang, `${base}.${e}`)).find(existsSync)
          if (!src || !existsSync(src)) {
            console.warn(`  · falta ${show(join(raw, slot.device, lang, base + '.png'))}: se salta`)
            continue
          }
          const t = s[lang]
          const lines = t.lines?.[slot.device]
          if (lines && lines.join(' ') !== t.title) throw new Error(`${base}/${lang}: el titular partido (${lines.join(' | ')}) no dice lo mismo que «${t.title}»`)
          const png = join(out, '.tmp', `${slotName}-${lang}-${base}.png`)
          const jpg = join(out, slotName, lang, `${base}.jpg`)
          const spec = { kind: 'shot', n: s.n, page: slot.page, card: slot.card, device: slot.device, source: SOURCES[slot.device], type: SHOT_TYPE[slot.device], title: lines ? lines.join('\n') : t.title, sub: t.sub, ink: t.ink ?? null, image: fileUrl(src), fit: stand ? { x: stand.x ?? 0.5, y: stand.y ?? 0, zoom: stand.zoom ?? 1 } : null, frame: stand ? null : (s.frame?.[slot.device] ?? null), stamp }
          const res = await page.render(spec, W, H, slot.scale, png)
          mkdirSync(dirname(jpg), { recursive: true })
          execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', '-m', SRGB_ICC, png, '--out', jpg], { stdio: 'ignore' })
          const info = expectSize(jpg, W * slot.scale, H * slot.scale, false)
          if (info.profile !== SRGB_NAME) throw new Error(`${jpg}: perfil «${info.profile}», hacía falta ${SRGB_NAME}`)
          items.push({ image: fileUrl(jpg), label: `${base} · ${t.title}${res.subSize !== SHOT_TYPE[slot.device].sub[0] ? ` (sublínea a ${res.subSize})` : ''}` })
          made.push(jpg)
          const framed = spec.frame ? ` · encuadre ×${res.upscale.toFixed(2).replace('.', ',')} sobre los píxeles de la captura` : ''
          console.log(`✓ ${show(jpg)} · ${W * slot.scale}×${H * slot.scale} · sin alfa${framed}`)
        }
        if (items.length) {
          const sheet = join(out, 'sheets', `${slotName}-${lang}.png`)
          const cols = slot.device === 'ipad' ? 4 : 7
          await page.render({ kind: 'sheet', title: `${slotName} · ${lang}${stamp ? ' · ' + stamp : ''}`, width: slot.device === 'ipad' ? 1800 : 1600, columns: cols, items }, slot.device === 'ipad' ? 1800 : 1600, 1000, 1, sheet)
          console.log(`  hoja: ${show(sheet)}`)
        }
      }
    }
  } finally {
    await page.close()
    rmSync(join(out, '.tmp'), { recursive: true, force: true })
  }
  return made
}

// ── Vista previa ─────────────────────────────────────────────────────────────────────────────────────────────────

/** De puntos del simulador a CSS del vídeo (escalar para llenar y recortar al centro, como app-preview.swift). */
function tapToCss(device, [x, y]) {
  const v = VIDEO[device]
  const src = SOURCES[device]
  const W = v.page[0] * v.scale
  const H = v.page[1] * v.scale
  const sw = src.pt[0] * src.scale
  const sh = src.pt[1] * src.scale
  const k = Math.max(W / sw, H / sh)
  return [(x * src.scale * k - (sw * k - W) / 2) / v.scale, (y * src.scale * k - (sh * k - H) / 2) / v.scale]
}

async function video() {
  const devices = list(flag('--device', 'all'), ['iphone', 'ipad'])
  const langs = list(flag('--lang', 'all'), ['en', 'es'])
  const out = resolve(flag('--out', MEDIA))
  const taps = flag('--taps') ? JSON.parse(readFileSync(resolve(flag('--taps')), 'utf8')) : null
  const planB = rest.includes('--plan-b')
  const icon = fileUrl(join(ROOT, 'native/ios/Aula/Assets.xcassets/AppIcon.appiconset/icon-1024.png'))
  const page = await openPage()
  try {
    for (const device of devices) {
      const v = VIDEO[device]
      const [W, H] = v.page
      const size = [W * v.scale, H * v.scale]
      for (const lang of langs) {
        const dir = join(out, 'art', device, lang)
        const rel = (f) => relative(out, join(dir, f))
        const items = []
        const draw = async (name, spec, checker = true) => {
          const png = join(dir, name)
          await page.render({ ...spec, video: v }, W, H, v.scale, png)
          expectSize(png, size[0], size[1])
          items.push({ image: fileUrl(png), label: name, checker })
        }
        const overlays = []
        await draw('band.png', { kind: 'band' })
        overlays.push({ png: rel('band.png'), start: 0, end: PREVIEW_DURATION, fade: 0 })
        for (const c of CAPTIONS) {
          await draw(`cap-${c.n}.png`, { kind: 'caption', text: c[lang] })
          overlays.push({ png: rel(`cap-${c.n}.png`), start: c.start, end: c.end, fade: CAPTION_FADE })
        }
        if (!planB) {
          await draw('short.png', { kind: 'short', text: SHORTENED[lang] })
          overlays.push({ png: rel('short.png'), start: SHORTENED.start, end: SHORTENED.end, fade: SHORTENED.fade })
        }
        const where = taps?.[device]?.[lang] ?? taps?.[device]
        for (const tp of TAPS) {
          const at = where?.[tp.name]
          if (!at) continue
          const [x, y] = tapToCss(device, at)
          await draw(`tap-${tp.name}.png`, { kind: 'tap', x, y, seed: tp.name })
          overlays.push({ png: rel(`tap-${tp.name}.png`), start: ms(tp.t - 0.1), end: ms(tp.t + 0.43), fade: 0.1 })
        }
        if (!where) console.warn(`  · sin toques para ${device}/${lang} (--taps)`)
        await draw('end.png', { kind: 'end', icon, ...END_CARD[lang] }, false)
        overlays.push({ png: rel('end.png'), start: END_CARD.start, end: PREVIEW_DURATION, fade: END_CARD.fade })
        // el EDL: las tomas se rellenan mirando cada grabación (from/to en segundos de la toma)
        const edl = {
          width: size[0],
          height: size[1],
          fps: 30,
          bitrate: 11000000,
          rotate: 0,
          duration: PREVIEW_DURATION,
          clips: CLIPS.map((c) => ({ src: `takes/${device}/${lang}/${c.take}.mov`, from: 0, to: 0, at: c.at, ...(c.dissolveIn ? { dissolveIn: c.dissolveIn } : {}) })),
          overlays,
          audio: 'music/preview-27s.wav',
          audioFadeOut: 1.5
        }
        const edlFile = join(out, `${device}-${lang}.edl.json`)
        writeFileSync(edlFile, JSON.stringify(edl, null, 2) + '\n')
        const sheet = join(out, 'sheets', `video-${device}-${lang}.png`)
        await page.render({ kind: 'sheet', title: `${device} · ${lang} · ${size.join('×')} (sobre damero: transparente)`, width: 1600, columns: device === 'ipad' ? 4 : 6, items }, 1600, 1000, 1, sheet)
        console.log(`✓ ${show(dir)} · ${items.length} PNG de ${size.join('×')} · EDL ${show(edlFile)} · hoja ${show(sheet)}`)
      }
    }
  } finally {
    await page.close()
  }
}

if (cmd === 'shots') await shots()
else if (cmd === 'video') await video()
else {
  console.log('uso: store-art.mjs shots|video [opciones] (ver la cabecera del archivo)')
  process.exit(2)
}
