// Comprueba lo que va al App Store antes de archivar la app de iPhone y iPad:
//   - que los textos de docs/app-store/listing.md caben en los límites de Apple (bytes donde Apple cuenta bytes);
//   - que la versión de native/ios sigue la regla (la del Mac con la que sale: la de package.json o la siguiente);
//   - los dos manifiestos de privacidad (el de la app y el de cada TailscaleKit.framework), el identificador del
//     framework, sus dSYM (con los UUID de cada binario) y los avisos de licencia (Aula/Licenses.json, al día con
//     el libtailscale fijado y con LICENSE/NOTICE);
//   - que está la grabación de la demostración (Demo.aulademo): sin ella la revisión no puede probar la app.
//   node scripts/dev/app-store-check.mjs            todo (antes de archivar; en macOS, que tiene plutil)
//   node scripts/dev/app-store-check.mjs --texts    solo los textos
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { aulaNotice } from '../../native/ios/scripts/aula-notice.mjs'

const IOS = 'native/ios'
const onlyTexts = process.argv.includes('--texts')
let bad = 0
const line = (ok, text) => {
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${text}`)
}
const warn = (text) => console.log(`⚠ ${text}`)

// --- Los textos ---------------------------------------------------------------------------------------------------
// Apple cuenta caracteres en casi todo, y bytes (UTF-8) en las palabras clave y las notas de revisión.
const LIMITS = {
  name: { max: 30, min: 2 },
  'name-alt': { max: 30, min: 2 },
  subtitle: { max: 30 },
  promo: { max: 170 },
  keywords: { max: 100, bytes: true },
  description: { max: 4000 },
  whatsnew: { max: 4000 },
  reviewnotes: { max: 4000, bytes: true }
}
const REQUIRED = ['name:en', 'subtitle:en', 'promo:en', 'keywords:en', 'description:en', 'reviewnotes:en',
  'name:es', 'subtitle:es', 'promo:es', 'keywords:es', 'description:es']
const md = readFileSync('docs/app-store/listing.md', 'utf8')
const fields = new Map()
console.log('Textos (docs/app-store/listing.md)')
for (const [, field, lang, body] of md.matchAll(/<!-- ([a-z-]+):([a-z]+) -->\n([\s\S]*?)\n<!-- \/\1 -->/g)) {
  const text = body.trim()
  const limit = LIMITS[field]
  if (!limit) {
    line(false, `${field} (${lang}): campo desconocido`)
    continue
  }
  fields.set(`${field}:${lang}`, text)
  const n = limit.bytes ? Buffer.byteLength(text, 'utf8') : [...text].length
  line(n >= (limit.min ?? 1) && n <= limit.max, `${field} (${lang}): ${n} / ${limit.max}${limit.bytes ? ' bytes' : ''}`)
}
for (const key of REQUIRED) if (!fields.has(key)) line(false, `falta ${key}`)

// las palabras clave: separadas por comas sin espacios, de 3 letras o más, sin repetir, y mejor sin las del nombre
for (const lang of ['en', 'es']) {
  const keywords = fields.get(`keywords:${lang}`)
  if (!keywords) continue
  const terms = keywords.split(',')
  if (/,\s|\s,/.test(keywords)) line(false, `keywords (${lang}): sin espacios junto a las comas (cuentan como bytes)`)
  const short = terms.filter((t) => [...t.trim()].length < 3)
  if (short.length) line(false, `keywords (${lang}): términos de menos de 3 letras: ${short.join(', ')}`)
  const lower = terms.map((t) => t.trim().toLowerCase())
  const dup = lower.filter((t, i) => lower.indexOf(t) !== i)
  if (dup.length) line(false, `keywords (${lang}): repetidos: ${dup.join(', ')}`)
  // Apple ya indexa el nombre y el subtítulo: repetir sus palabras gasta bytes
  const indexed = new Set(`${fields.get(`name:${lang}`) ?? ''} ${fields.get(`subtitle:${lang}`) ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))
  const repeated = lower.flatMap((t) => t.split(/\s+/)).filter((w) => indexed.has(w))
  if (repeated.length) warn(`keywords (${lang}): ya están en el nombre o el subtítulo: ${[...new Set(repeated)].join(', ')}`)
}

// las direcciones de la ficha que apuntan a este repositorio tienen que existir
for (const [, path] of md.matchAll(/https:\/\/github\.com\/luumlabs\/aula\/blob\/main\/([\w./-]+)/g)) {
  if (!existsSync(path)) line(false, `la ficha enlaza ${path}, que no existe`)
}

if (onlyTexts) finish()

// --- La versión ---------------------------------------------------------------------------------------------------
console.log('\nVersión (native/ios/Aula.xcodeproj)')
const pbxproj = readFileSync(join(IOS, 'Aula.xcodeproj/project.pbxproj'), 'utf8')
const settings = (key) => [...pbxproj.matchAll(new RegExp(`\\b${key} = "?([^";]*)"?;`, 'g'))].map((m) => m[1])
const marketing = [...new Set(settings('MARKETING_VERSION'))]
const build = [...new Set(settings('CURRENT_PROJECT_VERSION'))]
const desktop = JSON.parse(readFileSync('package.json', 'utf8')).version
line(marketing.length === 1 && /^\d+\.\d+\.\d+$/.test(marketing[0]), `MARKETING_VERSION igual en Debug y Release y de tres números: ${marketing.join(', ')}`)
line(build.length === 1 && /^[1-9]\d*$/.test(build[0]), `CURRENT_PROJECT_VERSION (el build) igual en Debug y Release y entero: ${build.join(', ')}`)
const next = nextVersions(desktop)
if (marketing[0] === desktop) line(true, `${marketing[0]} = package.json`)
else line(next.includes(marketing[0]), `${marketing[0]} es la versión del Mac con la que sale: package.json dice ${desktop} (vale ${desktop} o la siguiente, ${next.join(' / ')})`)
// solo iPhone y iPad: ni Mac Catalyst, ni la app de iPad en los Mac con Apple silicon, ni en Vision Pro
for (const key of ['SUPPORTS_MACCATALYST', 'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD', 'SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD']) {
  const values = settings(key)
  line(values.length >= 2 && values.every((v) => v === 'NO'), `${key} = NO`)
}
if (/DEVELOPMENT_TEAM = "?[A-Z0-9]{10}"?;/.test(pbxproj)) line(false, 'el pbxproj lleva un DEVELOPMENT_TEAM: el equipo se pasa en la orden de xcodebuild')

// --- Privacidad, framework y licencias ---------------------------------------------------------------------------
if (process.platform !== 'darwin') {
  warn('los manifiestos, el framework y la demostración se comprueban en macOS (hace falta plutil)')
  finish()
}
const plist = (file) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }))
/** Las categorías de funciones «con motivo» que declara un manifiesto, con sus motivos. */
const reasons = (manifest) => new Map((manifest.NSPrivacyAccessedAPITypes ?? []).map((t) => [t.NSPrivacyAccessedAPIType, t.NSPrivacyAccessedAPITypeReasons ?? []]))
const declares = (manifest, category, reason) => reasons(manifest).get(`NSPrivacyAccessedAPICategory${category}`)?.includes(reason) ?? false
/** Los UUID de un binario o un dSYM, con su arquitectura («UUID (arm64)»), según dwarfdump; '' si no se pueden leer. */
const uuids = (file) => {
  try {
    const out = execFileSync('dwarfdump', ['--uuid', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return [...out.matchAll(/^UUID: ([0-9A-F-]+) \((\w+)\)/gm)].map((m) => `${m[1]} (${m[2]})`).sort().join(', ')
  } catch {
    return ''
  }
}

console.log('\nManifiesto de privacidad de la app (Aula/PrivacyInfo.xcprivacy)')
const app = plist(join(IOS, 'Aula/PrivacyInfo.xcprivacy'))
line(app.NSPrivacyTracking === false, 'sin rastreo')
for (const [category, reason, why] of [['FileTimestamp', 'C617.1', 'el nodo de Tailscale'], ['SystemBootTime', '35F9.1', 'el nodo de Tailscale'], ['UserDefaults', 'CA92.1', 'AppModel.swift']]) {
  line(declares(app, category, reason), `${category} ${reason} (${why})`)
}
// lo que guarda Tailscale (docs/PRIVACY.md y la etiqueta de App Store Connect): vinculado, sin rastreo, para que
// funcione. El correo lo ve su inicio de sesión, que se abre dentro de la app (SafariView.swift)
const COLLECTED = ['EmailAddress', 'UserID', 'DeviceID']
const collected = new Map((app.NSPrivacyCollectedDataTypes ?? []).map((t) => [t.NSPrivacyCollectedDataType, t]))
for (const type of COLLECTED) {
  const t = collected.get(`NSPrivacyCollectedDataType${type}`)
  line(t?.NSPrivacyCollectedDataTypeLinked === true && t.NSPrivacyCollectedDataTypeTracking === false &&
    t.NSPrivacyCollectedDataTypePurposes?.length === 1 && t.NSPrivacyCollectedDataTypePurposes[0] === 'NSPrivacyCollectedDataTypePurposeAppFunctionality',
    `recoge ${type}: vinculado, sin rastreo, App Functionality (lo que guarda Tailscale)`)
}
line(collected.size === COLLECTED.length, `no declara más datos que esos ${COLLECTED.length} (${collected.size})`)

console.log('\nTailscaleKit (Frameworks/TailscaleKit.xcframework)')
const xcf = join(IOS, 'Frameworks/TailscaleKit.xcframework')
if (!existsSync(xcf)) line(false, 'falta el framework: native/ios/build-tailscalekit.sh lo compila')
else {
  const slices = readdirSync(xcf, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(xcf, e.name, 'TailscaleKit.framework')).filter(existsSync)
  line(slices.length >= 2, `${slices.length} frameworks (dispositivo y simulador)`)
  const wanted = readFileSync(join(IOS, 'tailscalekit/PrivacyInfo.xcprivacy'), 'utf8')
  for (const fw of slices) {
    const name = fw.split('/').at(-2)
    const manifest = join(fw, 'PrivacyInfo.xcprivacy')
    line(existsSync(manifest) && readFileSync(manifest, 'utf8') === wanted, `${name}: lleva tailscalekit/PrivacyInfo.xcprivacy`)
    if (existsSync(manifest)) {
      const m = plist(manifest)
      line(declares(m, 'FileTimestamp', 'C617.1') && declares(m, 'SystemBootTime', '35F9.1') && m.NSPrivacyTracking === false, `${name}: FileTimestamp C617.1, SystemBootTime 35F9.1, sin rastreo`)
    }
    const id = plist(join(fw, 'Info.plist')).CFBundleIdentifier
    line(id === 'com.luumlabs.aula.TailscaleKit', `${name}: identificador ${id}`)
  }
  // los símbolos de depuración: Xcode copia al archivo los dSYM que declara el xcframework (DebugSymbolsPath); sin
  // ellos, o si no son los de ese binario, App Store Connect avisa y no puede simbolizar los fallos de TailscaleKit
  for (const lib of plist(join(xcf, 'Info.plist')).AvailableLibraries ?? []) {
    const name = lib.LibraryIdentifier
    const dsym = lib.DebugSymbolsPath ? join(xcf, name, lib.DebugSymbolsPath, 'TailscaleKit.framework.dSYM') : ''
    if (!dsym || !existsSync(dsym)) {
      line(false, `${name}: sin TailscaleKit.framework.dSYM (native/ios/build-tailscalekit.sh lo genera)`)
      continue
    }
    const binary = uuids(join(xcf, name, lib.BinaryPath))
    line(binary !== '' && uuids(dsym) === binary, `${name}: dSYM con los UUID del binario (${binary || '?'})`)
  }
}

console.log('\nLicencias (Aula/Licenses.json)')
const licensesFile = join(IOS, 'Aula/Licenses.json')
if (!existsSync(licensesFile)) line(false, 'falta: native/ios/scripts/licenses.mjs lo escribe')
else {
  const licenses = JSON.parse(readFileSync(licensesFile, 'utf8'))
  const pinned = readFileSync(join(IOS, 'build-tailscalekit.sh'), 'utf8').match(/LIBTAILSCALE_REF="\$\{LIBTAILSCALE_REF:-([0-9a-f]{40})\}"/)?.[1]
  line(licenses.libtailscale === pinned, `del libtailscale fijado en build-tailscalekit.sh (${(licenses.libtailscale ?? '?').slice(0, 12)})`)
  const ids = new Set(licenses.components.map((c) => c.id))
  for (const id of ['aula', 'github.com/tailscale/libtailscale', 'tailscale.com', 'github.com/tailscale/wireguard-go', 'go']) {
    line(ids.has(id), `incluye ${id}`)
  }
  const aula = licenses.components.find((c) => c.id === 'aula')
  line(aula?.text === aulaNotice('.'), 'el aviso de Aula es el de NOTICE.md y LICENSE.md de ahora (si no: node native/ios/scripts/licenses.mjs)')
  line(licenses.components.every((c) => c.text?.trim() && c.license), `${licenses.components.length} componentes, todos con su licencia y su texto`)
}

console.log('\nLa demostración (Aula/Demo.aulademo)')
const demo = join(IOS, 'Aula/Demo.aulademo')
if (!existsSync(demo)) line(false, 'falta: sin ella la app sale sin «Try it with an example course» y la revisión no puede probarla (npm run build && node scripts/dev/ios-demo.mjs)')
else {
  const { size, mtime } = statSync(demo)
  line(size > 1_000_000, `${(size / 1e6).toFixed(1)} MB, grabada el ${mtime.toISOString().slice(0, 10)} (grábala otra vez si la interfaz ha cambiado desde entonces)`)
  // la grabación lleva la interfaz dentro (sin comprimir): tiene que ser una con el aviso de la IA de terceros (guía 5.1.2(i))
  line(readFileSync(demo).includes('data-ai-consent'), 'trae el aviso de la IA (A8; si no: npm run build && node scripts/dev/ios-demo.mjs)')
}

finish()

/** Las versiones que pueden seguir a una: la siguiente de parche, de menor o de mayor. */
function nextVersions(version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`]
}

function finish() {
  if (bad) {
    console.error(`\n${bad} comprobación(es) sin pasar`)
    process.exit(1)
  }
  console.log('\nTodo bien')
  process.exit(0)
}
