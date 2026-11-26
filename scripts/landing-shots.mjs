// Fotos fijas de la portada del README (docs/media/landing): la app de verdad con el curso de ejemplo, a escala 2,
// recortadas y pasadas a JPEG con sips (macOS). Las animaciones salen del vídeo con scripts/dev/landing-gif.swift.
//   npm run build && node scripts/landing-shots.mjs [docs/media/landing] [tutor|notes|exam …]
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [dir = 'docs/media/landing', ...only] = process.argv.slice(2)
const OUT = resolve(dir)
mkdirSync(OUT, { recursive: true })
const sleep = 'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));'

// escribe en el chat y lo envía (como quizChat en readme-shots.mjs)
const ask = (text) => `(async () => { ${sleep}
  for (let i = 0; i < 60 && !document.querySelector('textarea'); i++) await sleep(250)
  await sleep(400)
  const box = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})()`

// pulsa, en orden, el primer botón cuyo texto coincide con cada patrón, en cuanto aparece
const press = (...patterns) => `(async () => { ${sleep}
  for (const re of [${patterns.join(', ')}]) {
    let b
    for (let i = 0; i < 40 && !(b = [...document.querySelectorAll('button')].find((x) => re.test((x.textContent || '').trim()))); i++) await sleep(250)
    b?.click()
    await sleep(300)
  }
})()`

// size: ventana (px CSS) · rect: recorte (px CSS) · out: tamaño final del JPEG · window 'hidden': la ventana que pinta el documento
// q: calidad del JPEG (80 si no se dice; la chuleta, toda texto, baja a 75 para quedar bajo 240 KB)
// Los cortes caen entre líneas, nunca a media frase: la chuleta, con la primera definición a la izquierda y «Amplitude» a
// la derecha, para que ningún título quede sin nada debajo (las dos columnas tienen hueco a 726–730 px, igual en español);
// el simulacro, con «Simulacros anteriores» entera también en español (que ocupa más).
const SHOTS = [
  { name: 'tutor', size: [1120, 1100], route: { name: 'chat' }, fakeAI: true, wait: 11000, rect: [0, 0, 1120, 904], out: [1400, 1130],
    eval: { en: ask('Why is cos 210° negative?'), es: ask('¿Por qué cos 210° es negativo?') } },
  { name: 'notes', size: [1120, 640], route: { name: 'documents' }, wait: 6000, window: 'hidden', rect: { en: [0, 0, 900, 838], es: [0, 0, 900, 567] }, paper: true, out: { en: [1400, 1300], es: [1400, 912] }, q: 75,
    eval: press('/^(Create document|Crear documento)$/', '/^(Cheat sheet|Chuleta)/') },
  { name: 'exam', size: [1120, 820], route: { name: 'course', id: 'exam-2-math112', tab: 'exam' }, wait: 4500, out: [1400, 1025] }
]

const sips = (...args) => execFileSync('sips', args, { stdio: 'ignore' })

async function shoot(s, lang) {
  const home = mkdtempSync(join(tmpdir(), 'aula-landing-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: lang } }))
  cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
  const app = await electron.launch({
    // --hide-scrollbars: sin barras de desplazamiento, salgan o no según el ratón conectado (macOS), así el ancho es fijo
    args: [resolve('.'), '--no-sandbox', '--force-device-scale-factor=2', '--hide-scrollbars'],
    env: { ...process.env, AULA_HOME: home, AULA_SEED: 'demo', AULA_DEMO: '1', AULA_THEME: 'light', AULA_SKIP_ONBOARDING: '1', AULA_NO_UPDATES: '1', AULA_FAKE_AI: s.fakeAI ? '1' : '' }
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), s.size)
  await win.waitForTimeout(1500)
  await win.evaluate(() => window.__aula?.setTheme?.('light'))
  await win.evaluate((r) => window.__aula?.navigate?.(r), s.route)
  const code = typeof s.eval === 'object' ? s.eval[lang] : s.eval
  if (code) await win.evaluate(code)
  await win.waitForTimeout(s.wait)
  const rect = Array.isArray(s.rect) ? s.rect : s.rect?.[lang] ?? null
  // capturePage a escala del dispositivo: el recorte va en px CSS y sale al doble
  const png = await app.evaluate(async ({ BrowserWindow }, [which, box]) => {
    const all = BrowserWindow.getAllWindows()
    const target = all.find((w) => (which === 'hidden' ? !w.isVisible() : w.isVisible())) ?? all[0]
    const img = await target.webContents.capturePage(box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : undefined)
    return img.toPNG().toString('base64')
  }, [s.window ?? 'visible', rect])
  await app.close()
  rmSync(home, { recursive: true, force: true })

  const tmp = join(tmpdir(), `aula-landing-${s.name}-${lang}.png`)
  writeFileSync(tmp, Buffer.from(png, 'base64'))
  // el documento no trae márgenes: hoja blanca con margen (72 y 68 px por lado) y, alrededor, 60 px de papel
  if (s.paper && rect) {
    const [w, h] = [rect[2] * 2, rect[3] * 2]
    sips('-p', String(h + 136), String(w + 144), '--padColor', 'FFFFFF', tmp, '--out', tmp)
    sips('-p', String(h + 256), String(w + 264), '--padColor', 'FAF8F3', tmp, '--out', tmp)
  }
  const outSize = Array.isArray(s.out) ? s.out : s.out[lang]
  sips('-z', String(outSize[1]), String(outSize[0]), tmp, '--out', tmp)
  const file = join(OUT, `${s.name}-${lang}.jpg`)
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', String(s.q ?? 80), tmp, '--out', file)
  rmSync(tmp, { force: true })
  console.log('✓', file)
}

for (const lang of ['en', 'es'])
  for (const s of SHOTS) if (!only.length || only.includes(s.name)) await shoot(s, lang)
