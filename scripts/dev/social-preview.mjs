// La imagen para redes de Aula (docs/media/social-preview.png, 1280×640): el icono, el nombre, la frase y la pantalla de
// Hoy. Se hace con el Electron del proyecto, a partir del icono y de la captura del README (sin dependencias):
//   npx electron scripts/dev/social-preview.mjs [salida.png]
// Después de regenerar el icono (scripts/dev/icon/build-icons.mjs) o las capturas (scripts/readme-shots.mjs), vuelve a
// ejecutarlo. GitHub no la toma del repositorio: hay que subirla a mano en Settings → Social preview.
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = resolve(process.argv.slice(2).find((a) => a.endsWith('.png')) ?? join(ROOT, 'docs/media/social-preview.png'))
const data = (file) => 'data:image/png;base64,' + readFileSync(join(ROOT, file)).toString('base64')

const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; background: #f6f1e8; color: #201e1a; position: relative; font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif; }
  /* una aguada tibia detrás del icono, como las del propio icono (pintada con filtros, sin degradados de relleno) */
  svg.wash { position: absolute; left: -120px; top: -90px; width: 760px; height: 560px; mix-blend-mode: multiply; }
  .icon { position: absolute; left: 66px; top: 68px; width: 158px; height: 158px; }
  h1 { position: absolute; left: 82px; top: 246px; margin: 0; font: 500 112px/1 'New York', ui-serif, Georgia, serif; letter-spacing: -1px; }
  p.line { position: absolute; left: 84px; top: 398px; margin: 0; width: 460px; font: 400 33px/1.28 'New York', ui-serif, Georgia, serif; color: #2f2b26; }
  p.line em { color: #a9472a; font-weight: 500; }
  p.sub { position: absolute; left: 84px; top: 508px; margin: 0; font-size: 18px; color: #5d5852; }
  p.sub b { color: #2f2b26; font-weight: 600; }
  .shot { position: absolute; left: 604px; top: 86px; width: 1010px; border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px rgba(32, 30, 26, 0.1), 0 30px 60px -24px rgba(60, 40, 20, 0.4); }
  .shot img { display: block; width: 100%; }
</style>
<svg class="wash" viewBox="0 0 760 560"><defs><filter id="w" x="-30%" y="-30%" width="160%" height="160%">
  <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="3" seed="13" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="16" result="b"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="7" result="p"/>
  <feColorMatrix in="p" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.45 1.12" result="pa"/>
  <feComposite in="b" in2="pa" operator="in"/></filter></defs>
  <g filter="url(#w)"><ellipse cx="300" cy="250" rx="250" ry="150" fill="#efbf6f" opacity="0.3"/><ellipse cx="470" cy="180" rx="170" ry="80" fill="#dba892" opacity="0.26"/></g></svg>
<img class="icon" src="${data('docs/media/aula-icon.png')}">
<h1>Aula</h1>
<p class="line">Turn anything you study into a course, <em>and study it together.</em></p>
<p class="sub"><b>Free &amp; open source</b> · macOS · Windows · Linux</p>
<div class="shot"><img src="${data('docs/media/screenshots/home-light-en.png')}"></div>`

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.dock?.hide()
app.whenReady().then(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aula-social-'))
  const file = join(tmp, 'social.html')
  writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, width: 1280, height: 640, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } })
  await win.loadFile(file)
  await new Promise((ok) => setTimeout(ok, 600))
  writeFileSync(out, (await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 })).toPNG())
  rmSync(tmp, { recursive: true, force: true })
  console.log('✓', out)
  app.quit()
})
