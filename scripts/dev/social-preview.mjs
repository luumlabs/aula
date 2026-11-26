// La imagen para redes de Aula (docs/media/social-preview.png, 1280×640): el icono, el nombre, la frase de la portada y
// un cuestionario corregido en el chat. Se hace con el Electron del proyecto, sin dependencias:
//   npx electron scripts/dev/social-preview.mjs [salida.png]
// Si cambian el icono (scripts/dev/icon/build-icons.mjs) o la captura del chat (scripts/readme-shots.mjs chat), vuelve a
// ejecutarlo. GitHub no la toma del repositorio: hay que subirla a mano en Settings → Social preview.
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = resolve(process.argv.slice(2).find((a) => a.endsWith('.png')) ?? join(ROOT, 'docs/media/social-preview.png'))
const data = (file) => 'data:image/png;base64,' + readFileSync(join(ROOT, file)).toString('base64')
// recorte de la captura del chat (1440×900): la columna del mensaje con el cuestionario corregido
const K = 0.725

const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; background: #faf8f3; color: #191714; position: relative; font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif; }
  /* grano de papel fijo, sin desenfoque ni degradados */
  svg.grain { position: absolute; inset: 0; width: 1280px; height: 640px; opacity: 0.45; mix-blend-mode: multiply; }
  .icon { position: absolute; left: 72px; top: 64px; width: 112px; height: 112px; }
  h1 { position: absolute; left: 206px; top: 78px; margin: 0; font: 500 92px/1 'New York', ui-serif, Georgia, serif; letter-spacing: -1px; }
  .hook { position: absolute; left: 76px; top: 214px; width: 600px; margin: 0; font: 400 40px/1.2 'New York', ui-serif, Georgia, serif; color: #2a2622; }
  .hook em { display: block; color: #b8502d; font-style: italic; font-weight: 500; }
  .sub { position: absolute; left: 78px; top: 350px; width: 520px; margin: 0; font-size: 21px; line-height: 1.45; color: #4a4540; }
  .sub b { color: #191714; font-weight: 600; }
  .plat { position: absolute; left: 78px; top: 548px; margin: 0; font-size: 17px; color: #6b655e; letter-spacing: 0.2px; }
  .shot { position: absolute; left: 652px; top: 56px; width: 572px; height: 528px; border-radius: 18px; overflow: hidden; background: #fdfcf9; box-shadow: 0 0 0 1px rgba(25, 23, 20, 0.1), 0 30px 60px -24px rgba(52, 36, 20, 0.34); }
  .shot img { position: absolute; width: ${1440 * K}px; left: ${-452 * K}px; top: ${-64 * K}px; }
</style>
<svg class="grain"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .45  0 0 0 0 .35  0 0 0 .06 0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>
<img class="icon" src="${data('docs/media/aula-icon.png')}">
<h1>Aula</h1>
<p class="hook">Turn your notes into a course. <em>An AI tutor studies it with you.</em></p>
<p class="sub"><b>Free and open source.</b> Lessons, exercises checked as you answer, flashcards and mock exams. Your own AI, or a free local model.</p>
<p class="plat">Windows · macOS · Linux · iPhone · iPad · Android</p>
<div class="shot"><img src="${data('docs/media/screenshots/chat-light-en.png')}"></div>`

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.dock?.hide()
app.whenReady().then(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aula-social-'))
  const file = join(tmp, 'social.html')
  writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, width: 1280, height: 640, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } })
  await win.loadFile(file)
  await new Promise((ok) => setTimeout(ok, 700))
  writeFileSync(out, (await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 })).toPNG())
  rmSync(tmp, { recursive: true, force: true })
  console.log('✓', out)
  app.quit()
})
