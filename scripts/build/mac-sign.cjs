// Firma de macOS (electron-builder.yml → mac.sign). A1-P1-5.
//
// Con firma ad hoc, el «requisito designado» de cada versión es su hash exacto (`cdhash H"…"`): tras cada actualización,
// macOS volvía a pedir la contraseña del llavero para «Aula Safe Storage». Firmada siempre con el MISMO certificado
// («Aula Local Signing», ~/.aula-signing/), el requisito pasa a ser `identifier "com.luumlabs.aula" and certificate root =
// H"…"`: lo cumplen todas las versiones, y el instalador propio (src/main/services/updates/mac-install.ts) lo exige a cada
// versión nueva. Gatekeeper la trata igual que a una ad hoc (no es de Apple: «Abrir igualmente» la primera vez).
//
// Sin ese llavero (otro ordenador, CI) o con AULA_MAC_ADHOC=1, firma ad hoc como antes. OJO: una vez publicada una versión
// firmada con el certificado, las siguientes TIENEN que ir firmadas con él (scripts/release-local.sh lo exige); si se
// perdiera, las copias rechazarían las actualizaciones (docs/PUBLISHING.md → «Signing»).
//
// El llavero propio (no está en la lista de búsqueda del sistema) se desbloquea con su contraseña guardada al lado solo
// mientras se firma, y se vuelve a bloquear; la clave deja usarla a /usr/bin/codesign sin preguntar (comprobado: ningún
// diálogo). Nunca se imprime ninguna contraseña.
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

const DIR = process.env.AULA_MAC_SIGNING_DIR || join(homedir(), '.aula-signing')
const KEYCHAIN = join(DIR, 'aula-signing.keychain-db')
const PASSWORD = join(DIR, 'keychain.pass')
const NAME = 'Aula Local Signing'

/** Huella SHA-1 de la identidad «Aula Local Signing» de su llavero (desbloqueado), o null si no está. */
function localIdentity() {
  if (process.env.AULA_MAC_ADHOC === '1' || process.platform !== 'darwin') return null
  if (!existsSync(KEYCHAIN) || !existsSync(PASSWORD)) return null
  const password = readFileSync(PASSWORD, 'utf8').trim()
  execFileSync('/usr/bin/security', ['unlock-keychain', '-p', password, KEYCHAIN], { stdio: 'ignore', timeout: 20_000 })
  const out = execFileSync('/usr/bin/security', ['find-identity', '-p', 'codesigning', KEYCHAIN], { encoding: 'utf8', timeout: 20_000 })
  const m = new RegExp(`\\b([0-9A-F]{40}) "${NAME}"`).exec(out)
  return m ? m[1] : null
}

module.exports = async function sign(opts) {
  const { sign: osxSign } = require('app-builder-lib/out/codeSign/macCodeSign')
  const hash = localIdentity()
  if (!hash) {
    console.log(`  • ad hoc signature (no «${NAME}» keychain in ${DIR}, or AULA_MAC_ADHOC=1)`)
    return osxSign(opts)
  }
  console.log(`  • signing with «${NAME}» (${hash.slice(0, 8)}…)`)
  // sin sello de tiempo: el servidor de Apple no siempre sella firmas que no son de Apple ("The timestamp service is not
  // available") y, sin notarizar, no hace falta
  const perFile = opts.optionsForFile
  const optionsForFile = (file) => ({ ...(perFile ? perFile(file) : {}), timestamp: 'none' })
  try {
    return await osxSign({ ...opts, identity: hash, keychain: KEYCHAIN, identityValidation: false, optionsForFile })
  } finally {
    try { execFileSync('/usr/bin/security', ['lock-keychain', KEYCHAIN], { stdio: 'ignore', timeout: 20_000 }) } catch { /* nada */ }
  }
}
