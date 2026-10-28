// Firma las actualizaciones de una carpeta de release con la clave Ed25519 de Aula (ver docs/PUBLISHING.md, «Update
// signatures»). Para cada archivo de cada latest*.yml: comprueba su SHA-512, firma
// `aula-update-v1\n<archivo>\n<versión>\n<sha512>` y escribe la firma en su entrada (`aulaSignature`). La app instalada
// rechaza cualquier actualización sin esa firma. Las notas (`releaseNotes`, que la app enseña) se firman aparte:
// `aula-notes-v1\n<versión>\n<sha512 de las notas>` → `aulaNotesSignature` (sin ella, la app no las enseña).
// Vale la privada de cualquiera de las claves públicas de la app (UPDATE_PUBLIC_KEYS: la principal y la de reserva).
//
//   node scripts/release-sign.mjs release/0.1.0 [--key ~/.aula-signing/update-ed25519.key]
//   node scripts/release-sign.mjs release/0.1.0 --key /Volumes/USB/update-ed25519-backup.key   (con la de reserva)
//   AULA_UPDATE_SIGNING_KEY="<PEM>" node scripts/release-sign.mjs release/0.1.0      (CI: la clave en un secreto)
//   node scripts/release-sign.mjs --verify release/0.1.0                            (solo comprueba, con la clave pública)
//   node scripts/release-sign.mjs --check-key [--key <copia>]                       (¿está la clave y es de la app? antes de
//                                                                                    compilar, o para comprobar una copia)
//
// La clave PRIVADA nunca va en el repositorio. Si se pierden la principal Y la de reserva, las copias instaladas no aceptarán
// más actualizaciones: habría que publicar una versión con otras claves e instalarla a mano (docs/PUBLISHING.md).
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const here = dirname(fileURLToPath(import.meta.url))
const FIELD = 'aulaSignature'
const NOTES_FIELD = 'aulaNotesSignature'

const args = process.argv.slice(2)
const verifyOnly = args.includes('--verify')
const checkKey = args.includes('--check-key')
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null)
const keyArg = valueOf('--key')
// solo para las pruebas del propio guion (con una clave de usar y tirar): la app SIEMPRE usa la de signature.ts
const publicArg = valueOf('--public')
const dir = resolve(args.find((a, i) => !a.startsWith('--') && !['--key', '--public'].includes(args[i - 1])) || 'release')

/** Las claves públicas que lleva la app (src/main/services/updates/signature.ts → UPDATE_PUBLIC_KEYS). */
function embeddedPublicKeys(root = join(here, '..')) {
  const src = readFileSync(join(root, 'src/main/services/updates/signature.ts'), 'utf8')
  const block = /export const UPDATE_PUBLIC_KEYS[^=]*=\s*\[([^\]]*)\]/.exec(src)
  const list = block ? [...block[1].matchAll(/'([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]) : []
  if (!list.length) throw new Error('No encuentro UPDATE_PUBLIC_KEYS en signature.ts')
  return list.map((k) => createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }))
}

const message = (name, version, sha512) => Buffer.from(`aula-update-v1\n${name}\n${version}\n${sha512}`, 'utf8')
const notesMessage = (version, notes) =>
  Buffer.from(`aula-notes-v1\n${version}\n${createHash('sha512').update(notes, 'utf8').digest('base64')}`, 'utf8')
const validFor = (msg, sig, keys) => typeof sig === 'string' && keys.some((k) => { try { return verify(null, msg, k, Buffer.from(sig, 'base64')) } catch { return false } })
const nameOf = (url) => decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop())
const sha512 = (file) =>
  new Promise((ok, ko) => {
    const h = createHash('sha512')
    createReadStream(file).on('data', (c) => h.update(c)).on('error', ko).on('end', () => ok(h.digest('base64')))
  })

function privateKey() {
  const pem = process.env.AULA_UPDATE_SIGNING_KEY || (() => {
    const file = keyArg ? resolve(keyArg.replace(/^~(?=\/)/, homedir())) : join(homedir(), '.aula-signing', 'update-ed25519.key')
    if (!existsSync(file)) throw new Error(`No está la clave privada de firma (${file}). Ver docs/PUBLISHING.md.`)
    const mode = statSync(file).mode & 0o077
    if (mode && process.platform !== 'win32') throw new Error(`${file} lo pueden leer otros usuarios: chmod 600 ${file}`)
    return readFileSync(file, 'utf8')
  })()
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('La clave de firma no es Ed25519')
  return key
}

async function main() {
  const pubs = publicArg ? publicArg.split(',').map((k) => createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' })) : embeddedPublicKeys()
  const priv = verifyOnly ? null : privateKey()
  if (priv) {
    // la privada debe ser la pareja de una de las públicas que lleva la app (si no, las copias rechazarían esta versión)
    const probe = Buffer.from('aula-update-key-check')
    const which = pubs.findIndex((p) => verify(null, probe, p, sign(null, probe, priv)))
    if (which < 0) throw new Error('La clave privada no corresponde a ninguna de UPDATE_PUBLIC_KEYS de la app.')
    if (checkKey) {
      console.log(`✓ La clave de firma está y es la pareja de la clave pública ${which === 0 ? 'principal' : `de reserva (n.º ${which})`} de la app.`)
      return
    }
  }
  const ymls = readdirSync(dir).filter((f) => /^latest.*\.yml$/.test(f))
  if (!ymls.length) throw new Error(`No hay ningún latest*.yml en ${dir}`)
  let bad = 0
  for (const y of ymls) {
    const path = join(dir, y)
    const info = yaml.load(readFileSync(path, 'utf8'))
    for (const f of info.files || []) {
      const name = nameOf(f.url)
      const file = join(dir, name)
      if (!existsSync(file)) {
        console.error(`✗ ${y}: falta ${name}`)
        bad++
        continue
      }
      const got = await sha512(file)
      if (got !== f.sha512) {
        console.error(`✗ ${y}: el SHA-512 de ${name} no coincide`)
        bad++
        continue
      }
      const msg = message(name, String(info.version), got)
      if (priv) f[FIELD] = sign(null, msg, priv).toString('base64')
      if (!validFor(msg, f[FIELD], pubs)) {
        console.error(`✗ ${y}: ${name} sin firma válida de Aula`)
        bad++
      } else console.log(`✓ ${y} → ${name} firmado`)
    }
    // las notas que la app enseña (sin firma, no las enseña)
    if (typeof info.releaseNotes === 'string') {
      const msg = notesMessage(String(info.version), info.releaseNotes)
      if (priv) info[NOTES_FIELD] = sign(null, msg, priv).toString('base64')
      if (!validFor(msg, info[NOTES_FIELD], pubs)) {
        console.error(`✗ ${y}: las notas no llevan una firma válida de Aula`)
        bad++
      } else console.log(`✓ ${y} → notas firmadas`)
    }
    if (priv) writeFileSync(path, yaml.dump(info, { lineWidth: -1, noRefs: true }))
  }
  if (bad) {
    console.error(`\n${bad} problema(s) con la firma.`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
