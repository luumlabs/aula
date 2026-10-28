// Renderiza las propuestas del icono «pintado a mano» (paint-art.mjs) con el Electron del proyecto, sin ventanas:
//
//   npx electron scripts/dev/icon/paint-icons.mjs --out DIR                 → todo: cuadros, máscara de macOS, pruebas
//                                                                             de tamaño y la lámina comparativa
//   npx electron scripts/dev/icon/paint-icons.mjs --out DIR --ids gouache   → solo esas propuestas
//   --only art   solo los cuadros (rápido, para iterar) · --master   guarda también el cuadro a resolución completa
//   --px 1648    resolución del cuadro (por defecto 2× de 824, la squircle)
//   --title "…"  título de la lámina · --no-current  sin la fila del icono actual · --ref sumi  marca esa propuesta
//                como referencia (la de la ronda anterior)
//
// Por propuesta, en DIR/<id>/: <id>-art.png (el cuadro, 1024), <id>-mac-{1024,512,128,64,32,16}.png (con la máscara
// de macOS, dibujado a cada tamaño), <id>-plain-256.png (Windows/Linux), <id>-detail.png (recorte a tamaño real) y
// <id>-sizes.png (prueba de legibilidad). En DIR: sheet.png (la lámina, con el icono actual) y tray-*.png.
//
// NO escribe nada en el repo (build/, resources/, docs/): eso se hará cuando el dueño elija.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { iconSvg, traySvg } from './icon-art.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const out = resolve(opt('--out') ?? join(tmpdir(), 'aula-paint-icon'))
const only = opt('--only')
const masterPx = Number(opt('--px') ?? 1648)
const MODULE = pathToFileURL(join(HERE, 'paint-art.mjs')).href
/** Lado del recorte de detalle, en px del cuadro maestro (a tamaño real). */
const DETAIL = 420

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
app.dock?.hide()

const write = (file, buf) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buf)
}
const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64')
const b64 = (buf) => 'data:image/png;base64,' + buf.toString('base64')
const J = JSON.stringify

let win
let tmp
async function page() {
  if (win) return win
  tmp = mkdtempSync(join(tmpdir(), 'aula-paint-'))
  writeFileSync(join(tmp, 'blank.html'), '<meta charset=utf-8><body style="margin:0">')
  win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true, sandbox: true }
  })
  await win.loadFile(join(tmp, 'blank.html'))
  return win
}

/** Ejecuta código en la página con el módulo cargado como `M` y el caché de cuadros en `window.__art`. */
async function run(body) {
  const w = await page()
  return w.webContents.executeJavaScript(`(async () => {
    const M = await import(${J(MODULE)})
    window.__art ??= {}
    ${body}
  })()`)
}

/** Cuadro maestro y versión simplificada (≤ 32 px) de una propuesta, en caché dentro de la página. */
async function master(id) {
  const t0 = Date.now()
  await run(`
    const id = ${J(id)}
    window.__art[id] ??= {}
    window.__art[id].full ??= M.renderArt(id, { px: ${masterPx} })
    window.__art[id].small ??= M.renderArt(id, { px: 412, detail: 'small' })
  `)
  console.log(`· ${id}: pintado en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

/** PNG de una propuesta a `size` px: plataforma mac / plain / square; ≤ 32 px usa el dibujo simplificado. */
async function icon(id, { size, platform = 'mac', detail }) {
  const d = detail ?? (size <= 32 ? 'small' : 'full')
  return png(
    await run(
      `return M.composeIcon(window.__art[${J(id)}].${d}, { size: ${size}, platform: ${J(platform)} }).toDataURL('image/png')`
    )
  )
}

/** Recorte del cuadro maestro a tamaño real (la textura de la pintura). */
async function detailCrop(id) {
  return png(
    await run(`
    const src = window.__art[${J(id)}].full
    const [u, v] = M.PAINTINGS[${J(id)}].detail
    const k = src.width / M.BOX
    const c = document.createElement('canvas'); c.width = c.height = ${DETAIL}
    c.getContext('2d').drawImage(src, Math.round(u * k), Math.round(v * k), ${DETAIL}, ${DETAIL}, 0, 0, ${DETAIL}, ${DETAIL})
    return c.toDataURL('image/png')`)
  )
}

/** SVG → PNG al tamaño exacto (como build-icons.mjs). */
async function svgPng(svg, size) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  return png(
    await run(`
    const img = new Image(); img.src = ${J(src)}; await img.decode()
    const c = document.createElement('canvas'); c.width = c.height = ${size}
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size})
    return c.toDataURL('image/png')`)
  )
}

/** El icono actual (icon-art.mjs, CHOSEN = pixelSun). */
const currentIcon = (size) => svgPng(iconSvg('pixelSun', { size, platform: 'mac' }), size)

/** Recorte del icono actual a la misma escala que los cuadros maestros (para comparar la textura). */
async function currentDetail() {
  const S = Math.round((masterPx / 824) * 1024)
  const svg = iconSvg('pixelSun', { size: S, platform: 'mac', detail: 'full' })
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  return png(
    await run(`
    const img = new Image(); img.src = ${J(src)}; await img.decode()
    const k = ${masterPx} / 824
    const c = document.createElement('canvas'); c.width = c.height = ${DETAIL}
    c.getContext('2d').drawImage(img, Math.round((100 + 440) * k), Math.round((100 + 470) * k), ${DETAIL}, ${DETAIL}, 0, 0, ${DETAIL}, ${DETAIL})
    return c.toDataURL('image/png')`)
  )
}

/** Captura una página HTML (archivo temporal) a PNG con su altura natural. */
async function shoot(html, file, width) {
  const f = join(tmp, 'sheet.html')
  writeFileSync(f, html)
  const w = new BrowserWindow({
    show: false,
    width,
    height: 300,
    webPreferences: { offscreen: true, sandbox: true }
  })
  await w.loadFile(f)
  const height = await w.webContents.executeJavaScript('document.documentElement.scrollHeight')
  w.setContentSize(width, height)
  await new Promise((ok) => setTimeout(ok, 500))
  const img = await w.webContents.capturePage({ x: 0, y: 0, width, height })
  write(file, img.toPNG())
  w.destroy()
}

const CSS = `
  body{margin:0;padding:28px 36px;background:#F3F0E9;font:14px -apple-system,system-ui;color:#201E1A}
  h1{font:600 30px "New York",Georgia,serif;margin:0 0 4px} p.sub{margin:0 0 18px;color:#6B655C;max-width:1300px}
  section{background:#FFFDF9;border-radius:22px;padding:18px 22px;margin:0 0 16px;box-shadow:0 1px 3px rgba(60,40,20,.12)}
  h2{font:600 20px "New York",Georgia,serif;margin:0 0 10px} h2 small{font:13px -apple-system,system-ui;color:#8A847A}
  .line{display:flex;gap:20px;align-items:center}
  figure{margin:0;text-align:center} figcaption{font-size:11px;color:#8A847A;margin-top:4px}
  img.px{image-rendering:pixelated} img.detail{border-radius:12px;display:block}
  .sizes{display:flex;gap:14px;align-items:flex-end;padding:12px 14px;border-radius:14px}
  .sizes.light{background:#FFFFFF}.sizes.dark{background:#1E1C1A}.sizes.dark figcaption{color:#9a948a}
  .dock{display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:20px;
    border:1px solid rgba(0,0,0,.08);background:linear-gradient(#E9E3D8,#E2DBCE)}
  .dock.dark{background:linear-gradient(#2C2A27,#1E1C1A);border-color:rgba(255,255,255,.1)}
  .nb{width:52px;height:52px;margin:6px;border-radius:12px;opacity:.85}
  .finder{display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:6px;background:#fff;font-size:13px}
  .finder span{color:#999}.finder.dark{background:#1E1E1E;color:#eee}
  .bar{display:flex;gap:10px;align-items:center;padding:0 10px;height:24px;border-radius:6px;background:#ECE7DF;font-size:12px}
  .bar.dark{background:#2a2a2a;color:#ddd}
  .col{display:flex;flex-direction:column;gap:8px}
`
const neighbours = ['#3B82F6', '#34C759', '#8E8E93', '#FF9500'].map(
  (c) => `<div class="nb" style="background:${c}"></div>`
)
const dock = (r, dark) =>
  `<div class="dock ${dark ? 'dark' : ''}">${neighbours[0]}${neighbours[1]}<img src="${b64(r[128])}" width="64" height="64">${neighbours[2]}${neighbours[3]}</div>`
const finder = (r, dark) =>
  `<div class="finder ${dark ? 'dark' : ''}"><img src="${b64(r[32])}" width="16" height="16"> Aula.app <span>· Finder</span></div>`
const sizesRow = (r, dark) => `<div class="sizes ${dark ? 'dark' : 'light'}">
  ${[128, 64, 32, 16].map((s) => `<figure><img src="${b64(r[s])}" width="${s}" height="${s}"><figcaption>${s}</figcaption></figure>`).join('')}
  ${[32, 16].map((s) => `<figure><img class="px" src="${b64(r[s])}" width="${s * 4}" height="${s * 4}"><figcaption>${s} ×4</figcaption></figure>`).join('')}
</div>`
const bar = (tray, dark, label) => `<div class="bar ${dark ? 'dark' : ''}">
  <img src="${b64(dark ? tray.w32 : tray.t32)}" width="16" height="16"><img src="${b64(dark ? tray.w16 : tray.t16)}" width="16" height="16"><span>${label}</span></div>`

async function sizesFor(get) {
  const r = {}
  for (const s of [1024, 512, 256, 128, 64, 32, 16]) r[s] = await get(s)
  return r
}

async function trays() {
  const vec = {
    t16: await svgPng(traySvg(16), 16),
    t32: await svgPng(traySvg(32), 32),
    w16: await svgPng(traySvg(16, '#ffffff'), 16),
    w32: await svgPng(traySvg(32, '#ffffff'), 32)
  }
  const t = (px, c) => run(`return M.renderTray(${px}, ${J(c)}).toDataURL('image/png')`).then(png)
  const brush = {
    t16: await t(16, '#000000'),
    t32: await t(32, '#000000'),
    w16: await t(16, '#ffffff'),
    w32: await t(32, '#ffffff')
  }
  write(join(out, 'tray-brush-trayTemplate.png'), brush.t16)
  write(join(out, 'tray-brush-trayTemplate@2x.png'), brush.t32)
  return { vec, brush }
}

const traySection = (
  tr
) => `<section><h2>Barra de menús <small>· plantilla monocroma de 16 pt (macOS solo usa el alfa y la tiñe)</small></h2>
  <div class="line">
    <div class="col">${bar(tr.vec, false, 'actual (vector, a la rejilla de píxeles)')}${bar(tr.vec, true, 'actual')}</div>
    <div class="col">${bar(tr.brush, false, 'propuesta «a pincel»')}${bar(tr.brush, true, 'propuesta «a pincel»')}</div>
    <figure><img class="px" src="${b64(tr.vec.t32)}" width="96" height="96" style="background:#fff;border-radius:10px"><figcaption>actual @2x ×3</figcaption></figure>
    <figure><img class="px" src="${b64(tr.brush.t32)}" width="96" height="96" style="background:#fff;border-radius:10px"><figcaption>pincel @2x ×3</figcaption></figure>
    <figure><img class="px" src="${b64(tr.brush.t16)}" width="96" height="96" style="background:#fff;border-radius:10px"><figcaption>pincel @1x ×6</figcaption></figure>
  </div></section>`

async function proposalSheet(id, name, r, det, tr) {
  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <h1>${name} <small style="font:14px -apple-system;color:#8A847A">· prueba de legibilidad</small></h1>
  <p class="sub">macOS 1024 (squircle 824) y un recorte del cuadro a tamaño real. 128 y 64 se reducen del cuadro; 32 y 16 usan un
  dibujo simplificado pintado aparte. Dock a 64 pt (128 px), lista del Finder (16 pt @2x) y barra de menús.</p>
  <section><div class="line"><img src="${b64(r[1024])}" width="380" height="380">
    <figure><img class="detail" src="${b64(det)}" width="${DETAIL}" height="${DETAIL}"><figcaption>detalle a tamaño real (cuadro de ${masterPx} px)</figcaption></figure>
    <div class="col">${sizesRow(r, false)}${sizesRow(r, true)}</div></div></section>
  <section><div class="line"><div class="col">${dock(r, false)}${dock(r, true)}</div>
    <div class="col">${finder(r, false)}${finder(r, true)}</div></div></section>
  ${traySection(tr)}`
  await shoot(html, join(out, id, `${id}-sizes.png`), 1560)
}

async function comparison(rows, tr) {
  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <h1>${opt('--title') ?? 'Icono de Aula · pintado a mano'}</h1>
  <p class="sub">${args.includes('--no-current') ? 'Propuestas' : 'El actual («C · Sol de píxeles») y propuestas'} pintadas con código (paint-art.mjs, semilla fija, sin imágenes).
  Por fila: macOS 1024 (squircle 824) · recorte a tamaño real · 128/64/32/16 a su tamaño en claro y oscuro (32 y 16 ampliados ×4) · Dock.</p>
  ${rows
    .map(
      ({ name, r, det, note }) => `<section><h2>${name} <small>${note ?? ''}</small></h2><div class="line">
      <img src="${b64(r[1024])}" width="270" height="270">
      <img class="detail" src="${b64(det)}" width="250" height="250">
      <div class="col">${sizesRow(r, false)}${sizesRow(r, true)}</div>
      <div class="col">${dock(r, false)}${dock(r, true)}</div></div></section>`
    )
    .join('')}
  ${traySection(tr)}`
  await shoot(html, join(out, 'sheet.png'), 1580)
}

app.whenReady().then(async () => {
  try {
    mkdirSync(out, { recursive: true })
    const list = opt('--ids') ? opt('--ids').split(',') : await run('return Object.keys(M.PAINTINGS)')
    const names = await run('return Object.fromEntries(Object.entries(M.PAINTINGS).map(([k, v]) => [k, v.name]))')
    const tr = only === 'art' ? null : await trays()
    const rows =
      only === 'art' || args.includes('--no-current')
        ? []
        : [
            {
              name: 'Actual · C · Sol de píxeles',
              r: await sizesFor(currentIcon),
              det: await currentDetail(),
              note: '· icon-art.mjs (CHOSEN)'
            }
          ]
    for (const id of list) {
      await master(id)
      write(
        join(out, id, `${id}-art.png`),
        png(
          await run(
            `return M.composeIcon(window.__art[${J(id)}].full, { size: 1024, platform: 'square' }).toDataURL('image/png')`
          )
        )
      )
      if (args.includes('--master'))
        write(
          join(out, id, `${id}-master.png`),
          png(await run(`return window.__art[${J(id)}].full.toDataURL('image/png')`))
        )
      if (only === 'art') continue
      write(
        join(out, id, `${id}-art-small.png`),
        png(await run(`return window.__art[${J(id)}].small.toDataURL('image/png')`))
      )
      const r = await sizesFor((s) => icon(id, { size: s }))
      for (const s of [1024, 512, 128, 64, 32, 16]) write(join(out, id, `${id}-mac-${s}.png`), r[s])
      write(join(out, id, `${id}-plain-256.png`), await icon(id, { size: 256, platform: 'plain' }))
      const det = await detailCrop(id)
      write(join(out, id, `${id}-detail.png`), det)
      await proposalSheet(id, names[id], r, det, tr)
      rows.push({
        name: names[id],
        r,
        det,
        note: id === opt('--ref') ? '· referencia: la elegida en la ronda anterior' : ''
      })
    }
    if (only !== 'art') await comparison(rows, tr)
    console.log(`✓ en ${out}`)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  app.quit()
})
