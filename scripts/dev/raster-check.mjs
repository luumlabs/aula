import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
// PDF mínimo: una página con un rectángulo negro y texto
const content = 'BT /F1 48 Tf 72 700 Td (Hola Aula) Tj ET 72 400 200 100 re f'
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
]
let pdf = '%PDF-1.4\n'; const offs = []
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
const xref = pdf.length
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
const b64 = Buffer.from(pdf).toString('base64')
const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: mkdtempSync(join(tmpdir(), 'r-')), AULA_SKIP_ONBOARDING: '1' } })
await app.firstWindow()
const png = await app.evaluate(async ({ BrowserWindow }, { b64, file }) => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  await w.loadFile(file)
  for (let i = 0; i < 100; i++) { if (await w.webContents.executeJavaScript('typeof window.__raster === "object"')) break; await new Promise((r) => setTimeout(r, 50)) }
  const n = await w.webContents.executeJavaScript(`window.__raster.open("k", ${JSON.stringify(b64)})`)
  const out = await w.webContents.executeJavaScript(`window.__raster.render("k", 1, 800)`)
  return { n, len: out ? out.length : 0, out }
}, { b64, file: resolve('out/renderer/raster.html') })
console.log('pages', png.n, 'png b64 length', png.len)
if (png.out) writeFileSync(process.argv[2], Buffer.from(png.out, 'base64'))
await app.close()
