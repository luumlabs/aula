// Notarización opcional con la cuenta de desarrollador en la que Xcode ya tiene sesión.
// No se empaqueta nada hasta que Apple devuelve una app con un ticket válido y grapado.
const { createHash } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, dirname, join, resolve } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { fromBuilder } = require('./builder-deps.cjs')
const plist = fromBuilder('plist')

// Fallos seguidos sin explicación que se toleran al preguntar a Apple antes de darlo por rechazado.
const MAX_UNEXPLAINED = 3

function isProcessing(output) {
  return /is processing and not ready for distribution/i.test(output)
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function treeDigest(root) {
  if (!existsSync(root)) return null
  const hash = createHash('sha256')
  function visit(path, relative) {
    const stat = lstatSync(path)
    hash.update(`${relative}\0${stat.mode & 0o777}\0`)
    if (stat.isSymbolicLink()) hash.update(`link\0${readlinkSync(path)}\0`)
    else if (stat.isDirectory()) {
      hash.update('directory\0')
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${relative}/${name}`)
    } else if (stat.isFile()) hash.update(`file\0${digest(path)}\0`)
    else throw new Error('Unexpected file in unpacked app resources.')
  }
  visit(root, '')
  return hash.digest('hex')
}

function appResourcesDigest(app) {
  const resources = join(app, 'Contents', 'Resources')
  // Una app universal de Electron puede llevar app-x64.asar y app-arm64.asar junto a un app.asar pequeño de entrada.
  // Se comparan todos los archivos y carpetas desempaquetadas, con sus nombres, antes de aceptar lo exportado.
  const names = readdirSync(resources).filter(name => name.endsWith('.asar') || name.endsWith('.asar.unpacked')).sort()
  if (!names.includes('app.asar')) throw new Error('The signed Aula app is missing app.asar.')
  return JSON.stringify(names.map(name => {
    const path = join(resources, name)
    const stat = lstatSync(path)
    if (name.endsWith('.asar') ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error('Unexpected app archive or unpacked resources.')
    }
    return [name, treeDigest(path)]
  }))
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 5 * 60_000 })
  if (result.error || result.status !== 0) throw new Error(`Mac Xcode notarization failed at ${basename(command)}.`)
}

function signingIdentity(app) {
  const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', app], { encoding: 'utf8', timeout: 120_000 })
  if (result.error || result.status !== 0) throw new Error('Could not read the Developer ID signing identity.')
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  return /^Authority=(Developer ID Application: .+)$/m.exec(output)?.[1] || ''
}

function runXcode(args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/xcodebuild', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    const collect = (chunk) => { tail = (tail + chunk.toString()).slice(-65536) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolvePromise({ code, tail, timedOut }) })
  })
}

async function notarizeWithXcode(appPath, {
  team, version, verifyApp, runProcess = runXcode, runTool = run,
  wait = delay, now = Date.now, tempRoot = tmpdir(), getIdentity = signingIdentity
}) {
  if (!/^[A-Z0-9]{10}$/.test(team) || !version || typeof verifyApp !== 'function') throw new Error('Invalid Xcode notarization parameters.')
  const app = resolve(appPath)
  const temp = mkdtempSync(join(tempRoot, 'aula-xcode-notary-'))
  const archive = join(temp, 'Aula.xcarchive')
  const archiveApp = join(archive, 'Products', 'Applications', 'Aula.app')
  const exportOptions = join(temp, 'ExportOptions.plist')
  const exported = join(temp, 'notarized')
  let finished = false
  try {
    const originalResources = appResourcesDigest(app)
    const identity = getIdentity(app)
    if (!identity.startsWith('Developer ID Application: ') || !identity.endsWith(`(${team})`)) throw new Error('The Xcode archive has the wrong signing identity.')
    const appInfo = plist.parse(readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8'))
    if (appInfo.CFBundleIdentifier !== 'com.luumlabs.aula' || appInfo.CFBundleShortVersionString !== version || !appInfo.CFBundleVersion) {
      throw new Error('The Xcode archive has the wrong app identifier or version.')
    }
    mkdirSync(dirname(archiveApp), { recursive: true })
    runTool('/usr/bin/ditto', [app, archiveApp])
    writeFileSync(join(archive, 'Info.plist'), plist.build({
      ArchiveVersion: 2,
      CreationDate: new Date(),
      Name: 'Aula',
      SchemeName: 'Aula',
      ApplicationProperties: {
        ApplicationPath: 'Applications/Aula.app',
        CFBundleIdentifier: 'com.luumlabs.aula',
        CFBundleShortVersionString: version,
        CFBundleVersion: appInfo.CFBundleVersion,
        SigningIdentity: identity,
        Team: team
      }
    }))
    writeFileSync(exportOptions, plist.build({
      method: 'developer-id', destination: 'upload', signingStyle: 'manual',
      signingCertificate: 'Developer ID Application', teamID: team
    }))
    console.log('Submitting signed Aula to Apple using the Xcode account…')
    const upload = await runProcess([
      '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', exportOptions,
      '-exportPath', join(temp, 'upload'), '-allowProvisioningUpdates'
    ], 20 * 60_000)
    if (upload.code !== 0 || upload.timedOut) throw new Error('Xcode could not upload Aula for notarization.')

    console.log('Apple is processing the notarization request; no release artifact will be created until it passes.')
    const deadline = now() + 60 * 60_000
    let received = false
    let unexplained = 0
    while (now() < deadline) {
      const result = await runProcess(['-exportNotarizedApp', '-archivePath', archive, '-exportPath', exported], 2 * 60_000)
      if (result.code === 0 && !result.timedOut) { received = true; break }
      // El aviso de «sigue procesando» depende del idioma y la versión de Xcode, y la consulta puede fallar por la red:
      // un fallo sin explicación se reintenta unas pocas veces antes de darlo por rechazado.
      if (!result.timedOut && isProcessing(result.tail)) unexplained = 0
      else if (++unexplained >= MAX_UNEXPLAINED) {
        const detail = String(result.tail || '').trim().slice(-600)
        throw new Error(`Apple did not return a notarized Aula app. Check the archive in Xcode Organizer.${detail ? `\n${detail}` : ''}`)
      }
      await wait(20_000)
    }
    if (!received) throw new Error('Apple is still processing Aula after one hour. Check the archive in Xcode Organizer.')
    const apps = readdirSync(exported).filter(name => name.endsWith('.app'))
    if (apps.length !== 1 || apps[0] !== 'Aula.app') throw new Error('Xcode did not export exactly one Aula.app.')
    const notarized = join(exported, apps[0])
    if (appResourcesDigest(notarized) !== originalResources) {
      throw new Error('The notarized app does not contain the same Aula code that was uploaded.')
    }
    runTool('/usr/bin/xcrun', ['stapler', 'staple', notarized])
    verifyApp(notarized, { version })

    // El original se conserva hasta que la copia notarizada pasa la misma comprobación en su sitio definitivo.
    // Si algo falla se restaura, y no se genera ningún DMG ni ZIP.
    const backup = `${app}.before-xcode-notarization`
    if (existsSync(backup)) throw new Error('A previous notarization backup already exists; inspect it before continuing.')
    renameSync(app, backup)
    try {
      runTool('/usr/bin/ditto', [notarized, app])
      verifyApp(app, { version })
    } catch (error) {
      rmSync(app, { recursive: true, force: true })
      renameSync(backup, app)
      throw error
    }
    rmSync(backup, { recursive: true, force: true })
    finished = true
  } finally {
    if (finished) rmSync(temp, { recursive: true, force: true })
    else console.error(`Xcode notarization archive retained for inspection: ${archive}`)
  }
}

module.exports = { isProcessing, notarizeWithXcode }
