// Release-only checks for the direct-download Mac build. No keychain mutations or secret output.
// `beforePack` also protects `npm run dist:mac`; `afterSign` runs after electron-builder's notarization.
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const BUNDLE_ID = 'com.luumlabs.aula'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 })
  // Command arguments contain no credentials. Keep subprocess diagnostics out of the error to avoid accidental leaks.
  if (result.error || result.status !== 0) throw new Error(`Mac release check failed: ${command} ${args[0] || ''}`)
  return String(result.stdout || '') + String(result.stderr || '')
}

function expectedTeam(env = process.env) {
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID || '')) {
    throw new Error('Set APPLE_TEAM_ID to the 10-character paid Apple Developer team that must sign Aula.')
  }
  return env.APPLE_TEAM_ID
}

function requireNotarization(env) {
  // Xcode can submit with its already authenticated developer account. The afterSign hook
  // must still wait for Apple and validate the stapled app before packaging (see below).
  if (env.AULA_XCODE_NOTARIZE === '1') return
  // Follow electron-builder 26's credential precedence, including rejecting partial first-choice credentials.
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
  if (env.AULA_MAC_ADHOC || env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    throw new Error('Ad-hoc signing and disabled signing discovery are not allowed for a public Mac release.')
  }
  if (env.AULA_AUDIT_BUILD) throw new Error('An audit build cannot be distributed.')
  requireNotarization(env)
  // CSC_LINK is imported by electron-builder into its temporary keychain. Check the resulting app after signing.
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
  let mounted = false
  const mount = join(temp, 'image')
  try {
    const extracted = join(temp, 'zip')
    exec('/usr/bin/ditto', ['-x', '-k', zip, extracted])
    verifyApp(onlyApp(extracted), { env, version, exec })
    exec('/usr/bin/codesign', ['--verify', '--strict', `-R=${signingRequirement(team, false)}`, dmg])
    // Verify the actual app delivered by the DMG too, not an unrelated staging copy left beside it.
    exec('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg])
    mounted = true
    verifyApp(onlyApp(mount), { env, version, exec })
  } finally {
    if (mounted) {
      // Never recursively remove the temporary directory until the image has detached successfully.
      exec('/usr/bin/hdiutil', ['detach', mount])
    }
    rmSync(temp, { recursive: true, force: true })
  }
}

function beforePack(context) {
  if (context.electronPlatformName === 'mas') throw new Error('The App Store build needs its own sandboxed configuration and provisioning profile.')
  if (context.electronPlatformName !== 'darwin') return
  preflight({ ...context.packager.config, mac: context.packager.platformSpecificBuildOptions })
}

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const version = context.packager.appInfo.version
  if (process.env.AULA_XCODE_NOTARIZE === '1') {
    const team = expectedTeam()
    verifySignature(app, { version })
    await require('./mac-xcode-notarize.cjs').notarizeWithXcode(app, { team, version, verifyApp })
  }
  verifyApp(app, { version })
}

module.exports = { expectedTeam, requireNotarization, assertConfiguration, preflight, signingRequirement, verifySignature, verifyApp, verifyRelease, beforePack, afterSign }

if (require.main === module) {
  try {
    const [mode, folder, version] = process.argv.slice(2)
    if (mode === '--verify-release' && folder && version) verifyRelease(folder, version)
    else if (mode === '--preflight') {
      const config = require('js-yaml').load(readFileSync('electron-builder.yml', 'utf8'))
      // release-local.sh applies this same override to electron-builder when using Xcode.
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
