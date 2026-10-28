// Genera el icono de Aula para todas las plataformas a partir de icon-art.mjs (dibujos en SVG) o de paint-art.mjs
// (iconos pintados a mano con código). Se ejecuta con el Electron del proyecto (Chromium rasteriza el SVG o pinta el
// cuadro en un <canvas>, sin dependencias nuevas):
//
//   npx electron scripts/dev/icon/build-icons.mjs                    → escribe en el repo los iconos de CHOSEN
//   npx electron scripts/dev/icon/build-icons.mjs --variant c2       → ídem con otra propuesta (pixelSun, c2, e…
//                                                                      o una pintada: sumiB, sumiA, watercolor…)
//   npx electron scripts/dev/icon/build-icons.mjs --sheet DIR        → además, la lámina comparativa y los PNG en DIR
//     --ids c2,d2,e   propuestas de la lámina (por defecto, todas) · --name sheet2.png · --recommend e (la marca)
//     --no-repo       solo la lámina, sin tocar el repo
//
// Salida (desde la raíz del repo):
//   build/icon.png (1024, rejilla de macOS) · build/icon.icns (iconutil, con dibujo propio a 16/32 px)
//   build/icon.ico (16–256, Windows) · build/icons/<n>x<n>.png (Linux) · resources/icon.png (512, ventana/avisos en Linux)
//   resources/tray/{trayTemplate,trayTemplate@2x,tray,tray@2x}.png · docs/media/aula-icon.png (512, README)
// Las pintadas usan dos cuadros: el de 1648 px para ≥ 64 px y un dibujo simplificado para ≤ 32 px (16, 16@2x y 32).
// Las láminas de las propuestas pintadas las hace paint-icons.mjs.
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PROPOSALS, iconSvg, traySvg } from './icon-art.mjs'
import { PAINTINGS } from './paint-art.mjs'

/** La propuesta que se publica: «Sumi-e mínimo B · arco y horizonte» (paint-art.mjs), elegida el 27-10. */
export const CHOSEN = 'sumiB'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const sheetDir = opt('--sheet') ? resolve(opt('--sheet')) : null
const variant = opt('--variant') ?? CHOSEN
const nameOf = (id) => (PROPOSALS[id] ?? PAINTINGS[id]).name
if (!PROPOSALS[variant] && !PAINTINGS[variant]) {
  const all = [...Object.keys(PROPOSALS), ...Object.keys(PAINTINGS)]
  console.error(`propuesta desconocida: ${variant} (hay: ${all.join(', ')})`)
  process.exit(1)
}
const PAINT_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'paint-art.mjs')).href
const sheetIds = opt('--ids') ? opt('--ids').split(',') : Object.keys(PROPOSALS)
const sheetName = opt('--name') ?? 'sheet.png'
const recommend = opt('--recommend')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
// sin GPU: el canvas sale igual en cualquier máquina (y las pintadas, idénticas a las de paint-icons.mjs)
app.disableHardwareAcceleration()
app.dock?.hide()

let win
let tmp
async function page() {
  if (win) return win
  // una página file:// para poder importar paint-art.mjs con import()
  tmp = mkdtempSync(join(tmpdir(), 'aula-icons-'))
  writeFileSync(join(tmp, 'blank.html'), '<meta charset=utf-8><body style="margin:0">')
  win = new BrowserWindow({ show: false, width: 1600, height: 1200, webPreferences: { offscreen: true, sandbox: true } })
  await win.loadFile(join(tmp, 'blank.html'))
  return win
}

/** SVG → PNG (Buffer) al tamaño exacto, rasterizado como vector a ese tamaño. */
async function raster(svg, size) {
  const w = await page()
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  const url = await w.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode()
    const c = document.createElement('canvas'); c.width = c.height = ${size}
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size})
    return c.toDataURL('image/png')
  })()`)
  return Buffer.from(url.split(',')[1], 'base64')
}

/** Icono pintado (paint-art.mjs) a `size` px: el cuadro grande para ≥ 64 px y el simplificado para ≤ 32 px. */
async function paintPng(id, size, platform) {
  const w = await page()
  const detail = size <= 32 ? 'small' : 'full'
  const opts = JSON.stringify(detail === 'small' ? { px: 412, detail } : { px: 1648 })
  const url = await w.webContents.executeJavaScript(`(async () => {
    const M = await import(${JSON.stringify(PAINT_URL)})
    window.__art ??= {}
    const a = (window.__art[${JSON.stringify(id)}] ??= {})
    a.${detail} ??= M.renderArt(${JSON.stringify(id)}, ${opts})
    return M.composeIcon(a.${detail}, { size: ${size}, platform: ${JSON.stringify(platform)} }).toDataURL('image/png')
  })()`)
  return Buffer.from(url.split(',')[1], 'base64')
}

/** El icono `id` a `size` px para una plataforma ('mac' con la rejilla de Apple, 'plain' casi a sangre). */
const icon = (id, { size, platform = 'mac' }) =>
  PAINTINGS[id] ? paintPng(id, size, platform) : raster(iconSvg(id, { size, platform }), size)

const write = (file, buf) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buf)
}

/** .ico con entradas PNG (Windows Vista en adelante). */
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(entries.length, 4)
  let offset = head.length
  entries.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, o)
    head.writeUInt8(size >= 256 ? 0 : size, o + 1)
    head.writeUInt16LE(1, o + 4) // planos
    head.writeUInt16LE(32, o + 6) // bits por píxel
    head.writeUInt32LE(png.length, o + 8)
    head.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...entries.map((e) => e.png)])
}

/** .icns con iconutil (solo macOS): cada tamaño se dibuja a su tamaño, con el detalle que le toca. */
async function icns(id, out) {
  const dir = mkdtempSync(join(tmpdir(), 'aula-icon-'))
  const set = join(dir, 'icon.iconset')
  mkdirSync(set)
  for (const pt of [16, 32, 128, 256, 512]) {
    write(join(set, `icon_${pt}x${pt}.png`), await icon(id, { size: pt }))
    write(join(set, `icon_${pt}x${pt}@2x.png`), await icon(id, { size: pt * 2 }))
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out])
  rmSync(dir, { recursive: true, force: true })
}

async function buildRepoAssets(id) {
  const at = (p) => join(ROOT, p)
  write(at('build/icon.png'), await icon(id, { size: 1024 }))
  if (process.platform === 'darwin') await icns(id, at('build/icon.icns'))
  else console.warn('· build/icon.icns no se rehace fuera de macOS (hace falta iconutil)')
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const entries = []
  for (const size of icoSizes) entries.push({ size, png: await icon(id, { size, platform: 'plain' }) })
  write(at('build/icon.ico'), ico(entries))
  for (const size of [16, 32, 48, 64, 128, 256, 512])
    write(at(`build/icons/${size}x${size}.png`), await icon(id, { size, platform: 'plain' }))
  write(at('resources/icon.png'), await icon(id, { size: 512, platform: 'plain' }))
  write(at('docs/media/aula-icon.png'), await icon(id, { size: 512 }))
  // bandeja: plantilla negra para macOS (el sistema la tiñe; vector a la rejilla de píxeles, con la silueta del
  // icono) y en color para Windows/Linux
  const trayShape = PAINTINGS[id]?.tray ?? {}
  write(at('resources/tray/trayTemplate.png'), await raster(traySvg(16, '#000000', trayShape), 16))
  write(at('resources/tray/trayTemplate@2x.png'), await raster(traySvg(32, '#000000', trayShape), 32))
  write(at('resources/tray/tray.png'), await icon(id, { size: 16, platform: 'plain' }))
  write(at('resources/tray/tray@2x.png'), await icon(id, { size: 32, platform: 'plain' }))
  console.log(`✓ icono «${nameOf(id)}» escrito en build/, resources/ y docs/media/`)
}

// ── Lámina comparativa ───────────────────────────────────────────────────────────────────────────────────────────────
const b64 = (buf) => 'data:image/png;base64,' + buf.toString('base64')

async function buildSheet(dir) {
  mkdirSync(dir, { recursive: true })
  const ids = sheetIds
  const sizes = [1024, 512, 256, 128, 64, 32, 16]
  const r = {}
  for (const id of ids) {
    r[id] = {}
    for (const s of sizes) {
      r[id][s] = await icon(id, { size: s })
      if (s === 1024 || s === 512) write(join(dir, `${id}-${s}.png`), r[id][s])
    }
    r[id].plain = await icon(id, { size: 256, platform: 'plain' })
  }
  const tray = { t16: await raster(traySvg(16), 16), t32: await raster(traySvg(32), 32), w16: await raster(traySvg(16, '#ffffff'), 16), w32: await raster(traySvg(32, '#ffffff'), 32) }
  const neighbours = ['#3B82F6', '#34C759', '#8E8E93', '#FF9500'].map((c) => `<div class="nb" style="background:${c}"></div>`)
  const dock = (id, dark) => `
    <div class="dock ${dark ? 'dark' : ''}">
      ${neighbours[0]}${neighbours[1]}<img src="${b64(r[id][128])}" width="64" height="64">${neighbours[2]}${neighbours[3]}
      <span class="sep"></span><img src="${b64(r[id][32])}" width="32" height="32"><img src="${b64(r[id][16])}" width="16" height="16">
    </div>`
  const row = (id) => `
    <section>
      <h2>${nameOf(id)}${id === recommend ? ' <em>· recomendada</em>' : id === variant && !recommend ? ' <em>· elegida</em>' : ''}</h2>
      <div class="line">
        <img src="${b64(r[id][1024])}" width="300" height="300">
        <div class="sizes">
          ${[128, 64, 32, 16].map((s) => `<figure><img src="${b64(r[id][s])}" width="${s}" height="${s}"><figcaption>${s}</figcaption></figure>`).join('')}
          ${[32, 16].map((s) => `<figure><img class="px" src="${b64(r[id][s])}" width="${s * 4}" height="${s * 4}"><figcaption>${s} ×4</figcaption></figure>`).join('')}
        </div>
        <div class="docks">${dock(id, false)}${dock(id, true)}
          <div class="finder"><img src="${b64(r[id][32])}" width="16" height="16"> Aula.app <span>· lista del Finder</span></div>
          <div class="finder dark"><img src="${b64(r[id][32])}" width="16" height="16"> Aula.app <span>· lista del Finder</span></div>
        </div>
      </div>
    </section>`
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:28px 36px;background:#F3F0E9;font:14px -apple-system,system-ui;color:#201E1A;width:1528px}
    h1{font:600 30px "New York",Georgia,serif;margin:0 0 4px} p.sub{margin:0 0 18px;color:#6B655C}
    section{background:#FFFDF9;border-radius:22px;padding:18px 22px;margin:0 0 16px;box-shadow:0 1px 3px rgba(60,40,20,.12)}
    h2{font:600 20px "New York",Georgia,serif;margin:0 0 10px} h2 em{color:#B4502F;font-style:normal}
    .line{display:flex;gap:26px;align-items:center}
    .sizes{display:flex;gap:18px;align-items:flex-end;width:600px;flex-wrap:nowrap}
    figure{margin:0;text-align:center} figcaption{font-size:11px;color:#8A847A;margin-top:4px}
    img.px{image-rendering:pixelated}
    .docks{display:flex;flex-direction:column;gap:10px}
    .dock{display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:24px;background:rgba(255,255,255,.55);
      border:1px solid rgba(0,0,0,.08);background-image:linear-gradient(#E9E3D8,#E2DBCE)}
    .dock.dark{background-image:linear-gradient(#2C2A27,#1E1C1A);border-color:rgba(255,255,255,.1)}
    .nb{width:52px;height:52px;margin:6px;border-radius:12px;opacity:.85}
    .sep{width:1px;height:40px;background:rgba(127,127,127,.4);margin:0 4px}
    .finder{display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:#fff;font-size:13px}
    .finder span{color:#999}.finder.dark{background:#1E1E1E;color:#eee}
    .tray{display:flex;gap:16px;align-items:center}
    .bar{display:flex;gap:14px;align-items:center;padding:4px 12px;border-radius:8px;background:#ECE7DF}
    .bar.dark{background:#2a2a2a}
  </style>
  <h1>Icono de Aula · propuestas</h1>
  <p class="sub">1024 de macOS (rejilla de Apple, squircle 824) · 128/64/32/16 dibujados a su tamaño · Dock claro y oscuro (64 pt) · Finder (16 pt @2x)</p>
  ${ids.map(row).join('')}
  <section><h2>Barra de menús (plantilla monocroma) y plano para Windows/Linux</h2>
    <div class="tray">
      <div class="bar"><img src="${b64(tray.t32)}" width="16" height="16"><img src="${b64(tray.t16)}" width="16" height="16"><span>16 pt @2x · @1x</span></div>
      <div class="bar dark"><img src="${b64(tray.w32)}" width="16" height="16"><img src="${b64(tray.w16)}" width="16" height="16"><span style="color:#ddd">oscuro</span></div>
      <img class="px" src="${b64(tray.t32)}" width="128" height="128" style="background:#fff;border-radius:12px">
      ${ids.map((id) => `<img src="${b64(r[id].plain)}" width="96" height="96">`).join('')}
    </div>
  </section>`
  const file = join(dir, sheetName.replace(/\.png$/, '.html'))
  writeFileSync(file, html)
  const w = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { offscreen: true, sandbox: true } })
  await w.loadFile(file)
  const height = await w.webContents.executeJavaScript('document.documentElement.scrollHeight')
  w.setContentSize(1600, height)
  await new Promise((ok) => setTimeout(ok, 400))
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1600, height })
  write(join(dir, sheetName), img.toPNG())
  rmSync(file, { force: true })
  console.log(`✓ lámina en ${join(dir, sheetName)}`)
}

app.whenReady().then(async () => {
  try {
    if (sheetDir) await buildSheet(sheetDir)
    if (!args.includes('--no-repo')) await buildRepoAssets(variant)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  app.quit()
})
