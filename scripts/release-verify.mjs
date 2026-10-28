// Comprueba una carpeta de release antes de subirla: cada latest*.yml es de esta versión, sus archivos están y su
// SHA-512 coincide (lo que comprueban las copias instaladas al actualizarse). Sale con código 1 si algo falla.
//   node scripts/release-verify.mjs release/0.1.1 [0.1.1]
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const dir = resolve(process.argv[2] || 'release')
const version = process.argv[3] || JSON.parse(readFileSync('package.json', 'utf8')).version

const sha512 = (file) =>
  new Promise((ok, ko) => {
    const h = createHash('sha512')
    createReadStream(file).on('data', (c) => h.update(c)).on('error', ko).on('end', () => ok(h.digest('base64')))
  })

let bad = 0
const fail = (m) => {
  bad++
  console.error('✗', m)
}
const ymls = readdirSync(dir).filter((f) => /^latest.*\.yml$/.test(f))
if (!ymls.length) fail(`no hay ningún latest*.yml en ${dir}`)
for (const y of ymls) {
  const info = yaml.load(readFileSync(join(dir, y), 'utf8'))
  if (info.version !== version) fail(`${y}: versión ${info.version}, se esperaba ${version}`)
  for (const f of info.files || []) {
    const file = join(dir, f.url)
    if (!existsSync(file)) {
      fail(`${y}: falta ${f.url}`)
      continue
    }
    const got = await sha512(file)
    if (got !== f.sha512) fail(`${y}: el SHA-512 de ${f.url} no coincide (¿se recompiló después?)`)
    else console.log(`✓ ${y} → ${f.url}`)
  }
  if (!info.releaseNotes) console.warn(`! ${y}: sin notas de la versión (releaseInfo.releaseNotesFile)`)
}
const expect = { 'latest-mac.yml': 'macOS', 'latest.yml': 'Windows', 'latest-linux.yml': 'Linux x64', 'latest-linux-arm64.yml': 'Linux arm64' }
for (const [y, name] of Object.entries(expect)) if (!ymls.includes(y)) console.warn(`! sin ${y}: las copias de ${name} no verán esta versión`)
if (bad) {
  console.error(`\n${bad} problema(s): no subas esta carpeta.`)
  process.exit(1)
}
console.log(`\nTodo en orden para la ${version}.`)
