// El póster de la película para el README (docs/media/film-poster.png, 1600×900): un fotograma del máster con la
// insignia «Watch the film · m:ss». Se hace con el Electron del proyecto (sin dependencias):
//   node scripts/video/render.ts scripts/video/montage/aula-v6-film.ts --reuse --stills 10.4      (el fotograma)
//   npx electron scripts/dev/film-poster.mjs scripts/video/work/aula-v6-film/stills/aula-v6-film-10.40.png 2:12 [salida.png]
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [still, length = '2:12', target] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('film-poster.mjs'))
if (!still) {
  console.error('uso: npx electron scripts/dev/film-poster.mjs <fotograma.png> [duración] [salida.png]')
  process.exit(1)
}
const out = resolve(target ?? join(ROOT, 'docs/media/film-poster.png'))
const frame = 'data:image/png;base64,' + readFileSync(resolve(still)).toString('base64')

const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 1600px; height: 900px; overflow: hidden; position: relative; background: #f3ece1; }
  img { position: absolute; inset: 0; width: 1600px; height: 900px; object-fit: cover; }
  .badge { position: absolute; left: 60px; bottom: 54px; height: 74px; padding: 0 30px 0 26px; display: flex; align-items: center; gap: 16px; border-radius: 999px;
    background: #b4502f; color: #fff; font: 500 31px/1 'New York', ui-serif, Georgia, serif; box-shadow: 0 2px 4px rgba(120, 50, 25, 0.25), 0 14px 30px -10px rgba(120, 50, 25, 0.5); }
  .play { width: 46px; height: 46px; border-radius: 50%; background: #fff; display: grid; place-items: center; }
  .play::after { content: ''; margin-left: 4px; border-style: solid; border-width: 10px 0 10px 17px; border-color: transparent transparent transparent #b4502f; }
</style>
<img src="${frame}">
<div class="badge"><span class="play"></span>Watch the film · ${length}</div>`

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.dock?.hide()
app.whenReady().then(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aula-poster-'))
  const file = join(tmp, 'poster.html')
  writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } })
  await win.loadFile(file)
  await new Promise((ok) => setTimeout(ok, 600))
  writeFileSync(out, (await win.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 900 })).toPNG())
  rmSync(tmp, { recursive: true, force: true })
  console.log('✓', out)
  app.quit()
})
