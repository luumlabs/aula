// Comprobaciones de una versión pública de macOS (descarga directa). No tocan el llavero ni imprimen secretos.
// `beforePack` protege también `npm run dist:mac`; `afterSign` se ejecuta tras la notarización de electron-builder.
// Para probar la app empaquetada sin certificado de Apple: `npm run pack:mac:dev` (solo la carpeta, firma ad hoc).
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { fromBuilder } = require('./builder-deps.cjs')

const BUNDLE_ID = 'com.luumlabs.aula'
const JIT_ENTITLEMENT = 'com.apple.security.cs.allow-jit'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 })
  const output = String(result.stdout || '') + String(result.stderr || '')
  if (result.error || result.status !== 0) {
    // Estos comandos (codesign, spctl, stapler, hdiutil…) no reciben ni imprimen credenciales: su salida dice qué falló.
    const detail = (result.error ? String(result.error.message) : output).trim().slice(-1500)
    throw new Error(`Mac release check failed: ${command} ${args[0] || ''}${detail ? `\n${detail}` : ''}`)
  }
  return output
}

function expectedTeam(env = process.env) {
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID || '')) {
    throw new Error('Set APPLE_TEAM_ID to the 10-character paid Apple Developer team that must sign Aula.')
  }
  return env.APPLE_TEAM_ID
}

function requireNotarization(env) {
  // Xcode puede enviar con la cuenta de desarrollador en la que ya tiene sesión. El hook afterSign
  // espera igualmente a Apple y valida la app con su ticket antes de empaquetar (más abajo).
  if (env.AULA_XCODE_NOTARIZE === '1') return
  // Mismo orden de credenciales que electron-builder 26; unas credenciales a medias de la primera opción se rechazan.
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    if (!env.APPLE_ID || !env.APPLE_APP_SPECIFIC_PASSWORD) {
      throw new Error('Notarization needs both APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD.')
    }
  } else if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) {
    if (!env.APPLE_API_KEY || !env.APPLE_API_KEY_ID || !env.APPLE_API_ISSUER) {
      throw new Error('Notarization needs APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.')
    }
  } else if (!env.APPLE_KEYCHAIN_PROFILE) {
    throw new Error('Apple notarization credentials are missing. Configure an Apple ID, API key or APPLE_KEYCHAIN_PROFILE before building.')
  }
}

function assertConfiguration(config, env = process.env) {
  const mac = config.mac || {}
  if (config.appId !== BUNDLE_ID) throw new Error(`The release appId must remain ${BUNDLE_ID}.`)
  for (const field of ['forceCodeSigning', 'hardenedRuntime', 'strictVerify']) {
    if (mac[field] !== true) throw new Error(`Public Mac builds require mac.${field}: true.`)
  }
  if (env.AULA_XCODE_NOTARIZE === '1') {
    if (mac.notarize !== false || typeof config.afterSign !== 'string' || resolve(config.afterSign) !== resolve(__dirname, 'mac-after-sign.cjs')) {
      throw new Error('Xcode notarization requires the Aula afterSign hook and disables only electron-builder’s own notarization step.')
    }
  } else if (mac.notarize !== true) {
    throw new Error('Public Mac builds require mac.notarize: true.')
  }
  if (mac.identity === null || mac.identity === '-' || mac.sign != null || mac.type === 'development') {
    throw new Error('Public Mac builds require standard Developer ID Application signing; custom, local and ad-hoc signing are disabled.')
  }
}

function preflight(config, { env = process.env, platform = process.platform, exec = run } = {}) {
  if (platform !== 'darwin') throw new Error('A public Mac release must be built and verified on macOS.')
  assertConfiguration(config, env)
  const team = expectedTeam(env)
  if (env.AULA_MAC_ADHOC || env.AULA_MAC_DEV_BUILD || env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    throw new Error('Ad-hoc signing, development builds and disabled signing discovery are not allowed for a public Mac release.')
  }
  if (env.AULA_AUDIT_BUILD) throw new Error('An audit build cannot be distributed.')
  requireNotarization(env)
  // electron-builder importa CSC_LINK a su llavero temporal: en ese caso se comprueba la app ya firmada.
  if (!env.CSC_LINK) {
    const identities = exec('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
    const qualifier = config.mac.identity || env.CSC_NAME
    const matching = identities.split('\n').some(line => {
      const match = /\b([0-9A-F]{40}) "(Developer ID Application: [^"]+)"/.exec(line)
      return match && match[2].endsWith(`(${team})`) && (!qualifier || match[2].includes(qualifier) || match[1] === qualifier.toUpperCase())
    })
    if (!matching) throw new Error('No valid Developer ID Application identity for APPLE_TEAM_ID was found. Apple Development is not a distribution certificate.')
  }
  return team
}

function signingRequirement(team, bundle = true) {
  return `${bundle ? `identifier "${BUNDLE_ID}" and ` : ''}anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${team}"`
}

/** La app y cada Helper de Electron necesitan JIT con hardened runtime: sin él, sus procesos no arrancan. */
function verifyEntitlements(app, exec) {
  const frameworks = join(app, 'Contents', 'Frameworks')
  const helpers = existsSync(frameworks) ? readdirSync(frameworks).filter(name => name.endsWith('.app')).map(name => join(frameworks, name)) : []
  const granted = new RegExp(`<key>${JIT_ENTITLEMENT.replace(/\./g, '\\.')}</key>\\s*<true\\s*/>`)
  for (const bundle of [app, ...helpers]) {
    const entitlements = exec('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', bundle])
    if (!granted.test(entitlements)) throw new Error(`The signed app lacks the ${JIT_ENTITLEMENT} entitlement: ${basename(bundle)}`)
  }
}

function verifySignature(appPath, { env = process.env, version, exec = run } = {}) {
  const team = expectedTeam(env)
  const app = resolve(appPath)
  exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', `-R=${signingRequirement(team)}`, app])
  const details = exec('/usr/bin/codesign', ['--display', '--verbose=4', app])
  if (!details.split('\n').includes(`TeamIdentifier=${team}`) || !details.split('\n').some(line => line.startsWith('Authority=Developer ID Application:') && line.endsWith(`(${team})`))) {
    throw new Error('The signed app is not from the expected Developer ID Application team.')
  }
  if (!/^CodeDirectory .*flags=.*\bruntime\b/m.test(details)) throw new Error('The signed app does not enable hardened runtime.')
  if (!/^Timestamp=(?!none\s*$)\S.+/mi.test(details)) throw new Error('The signed app has no secure signing timestamp.')
  const plist = JSON.parse(exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents', 'Info.plist')]))
  if (plist.CFBundleIdentifier !== BUNDLE_ID || (version && plist.CFBundleShortVersionString !== version)) {
    throw new Error('The signed app has the wrong bundle ID or version.')
  }
  verifyEntitlements(app, exec)
  return app
}

function verifyApp(appPath, { env = process.env, version, exec = run } = {}) {
  const app = verifySignature(appPath, { env, version, exec })
  exec('/usr/bin/xcrun', ['stapler', 'validate', app])
  exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
  return app
}

function onlyApp(folder) {
  const apps = readdirSync(folder).filter(name => name.endsWith('.app'))
  if (apps.length !== 1 || apps[0] !== 'Aula.app') throw new Error('The artifact must contain exactly one Aula.app at its root.')
  return join(folder, apps[0])
}

function verifyRelease(folder, version, { env = process.env, platform = process.platform, exec = run } = {}) {
  if (platform !== 'darwin') throw new Error('Verify Mac release artifacts on macOS before uploading.')
  const team = expectedTeam(env)
  const dir = resolve(folder)
  const zip = join(dir, `Aula-${version}-mac.zip`)
  const dmg = join(dir, `Aula-${version}-mac.dmg`)
  if (!existsSync(zip) || !existsSync(dmg)) throw new Error('The Mac release needs both its ZIP and DMG.')
  if (readdirSync(dir).some(name => /^Aula-.*-mac\.(?:zip|dmg)(?:\.blockmap)?$/.test(name) && !name.startsWith(`Aula-${version}-mac.`))) {
    throw new Error('The release directory contains Mac artifacts from a different version.')
  }
  const temp = mkdtempSync(join(tmpdir(), 'aula-mac-verify-'))
  const mount = join(temp, 'image')
  let mounted = false
  let failure
  try {
    const extracted = join(temp, 'zip')
    exec('/usr/bin/ditto', ['-x', '-k', zip, extracted])
    verifyApp(onlyApp(extracted), { env, version, exec })
    // Sin firma (electron-builder.yml → dmg.sign: false), Gatekeeper evalúa la app notarizada que trae el DMG.
    // Un DMG firmado se evalúa él mismo: tiene que ser del equipo y llevar su propio ticket de notarización.
    if (isSigned(dmg, exec)) {
      exec('/usr/bin/codesign', ['--verify', '--strict', `-R=${signingRequirement(team, false)}`, dmg])
      exec('/usr/bin/xcrun', ['stapler', 'validate', dmg])
    }
    // También se comprueba la app que entrega el DMG, no una copia cualquiera que haya quedado a su lado.
    exec('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg])
    mounted = true
    verifyApp(onlyApp(mount), { env, version, exec })
  } catch (error) {
    failure = error
  }
  if (mounted) {
    try {
      detach(mount, exec)
    } catch (error) {
      // La carpeta temporal no se borra con la imagen aún montada; el fallo de la comprobación, si lo hubo, va primero.
      if (!failure) throw error
      failure.message += `\n(the disk image is still mounted at ${mount})`
      throw failure
    }
  }
  rmSync(temp, { recursive: true, force: true })
  if (failure) throw failure
}

function isSigned(file, exec) {
  try {
    exec('/usr/bin/codesign', ['--verify', '--strict', file])
    return true
  } catch {
    return false
  }
}

/** Desmonta la imagen; si sigue ocupada (Gatekeeper la acaba de leer), la fuerza. */
function detach(mount, exec) {
  try {
    exec('/usr/bin/hdiutil', ['detach', mount])
  } catch {
    exec('/usr/bin/hdiutil', ['detach', '-force', mount])
  }
}

/** Compilación de prueba sin certificado de Apple: solo la carpeta de la app, con firma ad hoc y sin notarizar. */
function isDevBuild(env = process.env) {
  return env.AULA_MAC_DEV_BUILD === '1'
}

function assertDevBuild(context) {
  const mac = (context.packager && context.packager.platformSpecificBuildOptions) || {}
  // con `--dir`, electron-builder pasa en macOS una lista de destinos vacía: cualquier destino sería un instalador
  if ((context.targets || []).some(target => target.name !== 'dir')) {
    throw new Error('AULA_MAC_DEV_BUILD=1 only builds the unpacked app folder (electron-builder --mac --dir), never a DMG or ZIP.')
  }
  if (mac.identity !== '-' || mac.notarize !== false) {
    throw new Error('AULA_MAC_DEV_BUILD=1 needs an ad-hoc, non-notarized build: use `npm run pack:mac:dev`.')
  }
}

function beforePack(context, options) {
  const env = (options && options.env) || process.env
  if (context.electronPlatformName === 'mas') throw new Error('The App Store build needs its own sandboxed configuration and provisioning profile.')
  if (context.electronPlatformName !== 'darwin') return
  if (isDevBuild(env)) return assertDevBuild(context)
  preflight({ ...context.packager.config, mac: context.packager.platformSpecificBuildOptions }, { env })
}

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  // Una compilación de prueba (ad hoc, solo carpeta) no se notariza ni se distribuye: beforePack ya comprobó que lo es.
  if (isDevBuild()) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const version = context.packager.appInfo.version
  if (process.env.AULA_XCODE_NOTARIZE === '1') {
    const team = expectedTeam()
    verifySignature(app, { version })
    await require('./mac-xcode-notarize.cjs').notarizeWithXcode(app, { team, version, verifyApp })
  }
  verifyApp(app, { version })
}

module.exports = { expectedTeam, requireNotarization, assertConfiguration, preflight, signingRequirement, verifyEntitlements, verifySignature, verifyApp, verifyRelease, beforePack, afterSign }

if (require.main === module) {
  try {
    const [mode, folder, version] = process.argv.slice(2)
    if (mode === '--verify-release' && folder && version) verifyRelease(folder, version)
    else if (mode === '--preflight') {
      const config = fromBuilder('js-yaml').load(readFileSync('electron-builder.yml', 'utf8'))
      // release-local.sh aplica este mismo ajuste a electron-builder cuando se notariza con Xcode.
      if (process.env.AULA_XCODE_NOTARIZE === '1') config.mac.notarize = false
      preflight(config)
    }
    else throw new Error('Usage: mac-release-preflight.cjs --preflight | --verify-release <folder> <version>')
    console.log('✓ Mac release signing and notarization checks passed.')
  } catch (error) {
    console.error(`✗ ${error.message}`)
    process.exitCode = 1
  }
}
