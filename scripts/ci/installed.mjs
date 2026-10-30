// Prueba los instaladores PUBLICADOS de Aula como lo haría un estudiante (lo lanza .github/workflows/platforms.yml):
// los descarga de la release, los instala, abre Aula, comprueba que busca la actualización en el GitHub real y la instala.
//
//   node scripts/ci/installed.mjs <escenario> --out <carpeta> [--from 0.1.0] [--to 0.1.1] [--mode quit|restart]
//
// Escenarios:
//   win-update       Windows: instala <from> (/S, por usuario), se actualiza sola a <to> (al salir o con «Reiniciar»)
//   win-fresh        Windows: instala <to> desde cero, arranca, se cierra y se desinstala (los datos se quedan)
//   appimage-update  Linux: la AppImage <from> (sin FUSE: APPIMAGE_EXTRACT_AND_RUN) se cambia sola por la <to>
//   deb              Linux: la .deb <from> avisa de la <to> sin descargarla; luego `apt install` de la <to> encima
//
// <to> tiene que ser la última versión publicada (la que ve la app). Deja en --out los registros (main.log de cada
// arranque), las capturas y summary.json. No usa secretos: todo lo que descarga es público. La app no recibe ninguna
// variable que no exista ya (src/main/electron/updates.ts): AULA_UPDATE_CHECK_DELAY_MS y AULA_UPDATE_AUTO_INSTALL.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync, closeSync, copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync,
  readFileSync, readlinkSync, statSync, writeFileSync, appendFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const REPO = 'luumlabs/aula'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SEMVER = /^\d+\.\d+\.\d+$/

// ── Argumentos ──────────────────────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const scenario = argv[0]
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i > 0 && argv[i + 1] ? argv[i + 1] : def
}
const FROM = opt('from', '0.1.0')
const TO = opt('to', '0.1.1')
const MODE = opt('mode', 'quit')
const OUT = resolve(opt('out', join(tmpdir(), 'aula-installed')))
const SCENARIOS = { 'win-update': winUpdate, 'win-fresh': winFresh, 'appimage-update': appImageUpdate, deb }
if (!SCENARIOS[scenario] || !SEMVER.test(FROM) || !SEMVER.test(TO) || !['quit', 'restart'].includes(MODE)) {
  console.error('Usage: node scripts/ci/installed.mjs <win-update|win-fresh|appimage-update|deb> --out <dir> [--from X.Y.Z] [--to X.Y.Z] [--mode quit|restart]')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
// las descargas (cientos de MB) fuera de --out: no se suben como artefacto
const DOWNLOADS = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'aula-dl-'))

// ── Resultado ───────────────────────────────────────────────────────────────────────────────────────────────────────

const results = []
const t0 = Date.now()
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`
const say = (msg) => console.log(`${stamp()} ${msg}`)
function check(ok, what, detail = '') {
  results.push({ ok: !!ok, what, detail })
  say(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
  return !!ok
}
function note(what) {
  results.push({ ok: true, what, note: true })
  say(`NOTE ${what}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function finish() {
  const failed = results.filter((r) => !r.ok)
  const summary = { scenario, mode: MODE, from: FROM, to: TO, platform: process.platform, arch: process.arch, failed: failed.length, results }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.note ? 'note' : r.ok ? 'pass' : '**FAIL**'} | ${r.what.replace(/\|/g, '\\|')} | ${(r.detail || '').replace(/\|/g, '\\|')} |`)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${scenario}${scenario === 'win-update' ? ` (${MODE})` : ''} · ${process.platform}-${process.arch} · ${FROM} → ${TO}\n\n| | Check | Detail |\n| --- | --- | --- |\n${rows.join('\n')}\n\n`)
  }
  say(failed.length ? `${failed.length} check(s) failed` : 'all checks passed')
  process.exit(failed.length ? 1 : 0)
}

// ── Utilidades comunes ──────────────────────────────────────────────────────────────────────────────────────────────

async function download(version, name) {
  const dest = join(DOWNLOADS, `v${version}`, name)
  if (existsSync(dest)) return dest
  mkdirSync(dirname(dest), { recursive: true })
  const url = `https://github.com/${REPO}/releases/download/v${version}/${name}`
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
      say(`downloaded ${name} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`)
      return dest
    } catch (e) {
      if (attempt >= 3) throw new Error(`download ${url}: ${e.message}`)
      await sleep(5000 * attempt)
    }
  }
}

const sha512 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64')

/** El sha512 que el latest*.yml publicado da para un archivo (formato de electron-builder: `- url: …\n    sha512: …`). */
function publishedSha512(ymlText, fileName) {
  const lines = ymlText.split(/\r?\n/)
  const i = lines.findIndex((l) => l.trim() === `- url: ${fileName}`)
  for (let j = i + 1; i >= 0 && j < lines.length && !lines[j].trim().startsWith('- url:'); j++) {
    const m = lines[j].match(/^\s*sha512:\s*(\S+)/)
    if (m) return m[1]
  }
  return null
}

/** Carpeta de datos nueva con el curso de ejemplo (el formato real en disco). */
function seededHome(label) {
  const home = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `aula-home-${label}-`))
  cpSync(join(ROOT, 'resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
  return home
}

/** Huella de cada archivo de los cursos (para comprobar que una actualización no pierde nada). */
function manifest(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) out[relative(dir, p).replace(/\\/g, '/')] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

function compareData(home, before, settingsBefore) {
  const after = manifest(join(home, 'Packs'))
  const missing = Object.keys(before).filter((f) => !(f in after))
  const changed = Object.keys(before).filter((f) => f in after && after[f] !== before[f])
  check(missing.length === 0, 'course files kept after the update', missing.length ? `missing: ${missing.join(', ')}` : `${Object.keys(before).length} files`)
  if (changed.length) note(`course files rewritten by the app: ${changed.join(', ')}`)
  const settings = readJSONSafe(join(home, 'settings.json'))
  check(settings && (!settingsBefore || settings.onboarded === settingsBefore.onboarded), 'settings kept after the update', settings ? `onboarded: ${settings.onboarded}` : 'settings.json unreadable')
}

function readJSONSafe(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

const logFile = (home) => join(home, 'Logs', 'main.log')
function readLog(home) {
  try { return readFileSync(logFile(home), 'utf8') } catch { return '' }
}
/** Lo que el registro tiene ahora (para mirar solo lo que escribe el siguiente arranque). */
const logMark = (home) => readLog(home).length

/** Espera una línea del registro (desde `from`). null si no llega a tiempo o si el proceso termina antes. */
async function waitForLog(home, from, re, timeoutMs, alive = () => true) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const m = readLog(home).slice(from).match(re)
    if (m) return m
    if (Date.now() > end || !alive()) return null
    await sleep(1000)
  }
}

/** Errores del registro (desde `from`): las líneas `[error]` de electron-log. Los avisos se cuentan aparte. */
function logProblems(home, from) {
  const lines = readLog(home).slice(from).split(/\r?\n/)
  return {
    errors: lines.filter((l) => /^\[[^\]]+\] \[error\]/.test(l)),
    warnings: lines.filter((l) => /^\[[^\]]+\] \[warn\]/.test(l))
  }
}

function checkLogClean(home, from, label) {
  const { errors, warnings } = logProblems(home, from)
  check(errors.length === 0, `${label}: no errors in main.log`, errors.length ? errors.slice(0, 5).join(' ⏎ ') : `${warnings.length} warning(s)`)
  for (const w of warnings.slice(0, 10)) say(`  warn: ${w.slice(0, 300)}`)
}

/** Guarda el registro de este arranque. */
function saveLog(home, label) {
  try { copyFileSync(logFile(home), join(OUT, `${label}.main.log`)) } catch { say(`no main.log for ${label}`) }
}

/** Lanza un programa con su salida en --out/<nombre>.output.txt. */
function launch(cmd, args, env, name) {
  const fd = openSync(join(OUT, `${name}.output.txt`), 'a')
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' })
  closeSync(fd)
  child.exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })))
  child.once('error', (e) => say(`launch error (${name}): ${e.message}`))
  say(`launched ${basename(cmd)} ${args.join(' ')} (pid ${child.pid})`)
  return child
}

const running = (child) => child.exitCode === null && child.signalCode === null

async function waitExit(child, ms) {
  return Promise.race([child.exited, sleep(ms).then(() => null)])
}

/** Entorno de cada arranque: carpeta de datos propia, IA simulada y la primera búsqueda a los 3 s (no a los 45). */
const appEnv = (home, extra = {}) => ({ AULA_HOME: home, AULA_FAKE_AI: '1', AULA_UPDATE_CHECK_DELAY_MS: '3000', ...extra })

// ── Windows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const psq = (s) => String(s).replace(/'/g, "''")
function ps(script) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 60_000 }).trim()
  } catch (e) {
    say(`powershell failed: ${e.message.split('\n')[0]}`)
    return ''
  }
}

const UNINSTALL_KEYS = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
/** La entrada de «Aplicaciones instaladas» de Aula: HKCU (por usuario) o HKLM (para todos, con administrador). */
function winInstalled(hive = 'HKCU') {
  const json = ps(`$k = Get-ItemProperty '${hive}:\\${UNINSTALL_KEYS}' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Aula*' } | Select-Object -First 1; if ($k) { [pscustomobject]@{ name = $k.DisplayName; version = $k.DisplayVersion; location = $k.InstallLocation; uninstall = $k.UninstallString; quiet = $k.QuietUninstallString } | ConvertTo-Json -Compress }`)
  return json ? JSON.parse(json) : null
}

function winExe(info) {
  const local = process.env.LOCALAPPDATA
  const candidates = [info?.location && join(info.location, 'Aula.exe'), join(local, 'Programs', 'aula', 'Aula.exe'), join(local, 'Programs', 'Aula', 'Aula.exe')]
  return candidates.find((p) => p && existsSync(p)) ?? null
}

const winFileVersion = (exe) => ps(`(Get-Item -LiteralPath '${psq(exe)}').VersionInfo.ProductVersion`)

/** Procesos de Aula: el principal (sin --type=) y el resto; con su versión y el título de su ventana. */
function winAulaProcesses() {
  const json = ps(`@(Get-CimInstance Win32_Process -Filter "Name='Aula.exe'" | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{ pid = $_.ProcessId; main = ($_.CommandLine -notmatch '--type='); path = $_.ExecutablePath; title = $p.MainWindowTitle } }) | ConvertTo-Json -Compress`)
  if (!json) return []
  const v = JSON.parse(json)
  return Array.isArray(v) ? v : [v]
}

const winInstallerRunning = () => ps(`@(Get-Process | Where-Object { $_.ProcessName -like 'Aula-Setup*' -or $_.ProcessName -in 'Un_A','Au_' }).Count`) !== '0'

function winScreenshot(name) {
  const file = join(OUT, `${name}.png`)
  ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save('${psq(file)}', [System.Drawing.Imaging.ImageFormat]::Png)`)
  say(existsSync(file) ? `screenshot ${basename(file)}` : `screenshot ${name} failed`)
}

/** Cierra Aula como al pulsar la X (WM_CLOSE); si no se cierra en 30 s, a la fuerza (y se cuenta como fallo). */
async function winClose(pid, label) {
  spawnSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore' })
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    if (!winAulaProcesses().some((p) => p.pid === pid)) return check(true, `${label}: closes when its window is closed`)
    await sleep(1000)
  }
  spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
  return check(false, `${label}: closes when its window is closed`, 'still running 30 s after WM_CLOSE (killed)')
}

async function winWaitWindow(label, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const w = winAulaProcesses().find((p) => p.main && p.title)
    if (w) return check(true, `${label}: window open`, `"${w.title}"`)
    await sleep(2000)
  }
  return check(false, `${label}: window open`, 'no Aula window after 60 s')
}

async function winInstall(version) {
  const setup = await download(version, `Aula-Setup-${version}.exe`)
  // como el estudiante: el instalador de un clic, por usuario, sin preguntar nada (/S)
  const r = spawnSync(setup, ['/S'], { timeout: 10 * 60_000 })
  check(r.status === 0, `installer ${version} /S exits cleanly`, `exit code ${r.status}${r.error ? `, ${r.error.message}` : ''}`)
  const info = winInstalled('HKCU')
  check(info?.version === version, `${version} registered for this user (HKCU)`, info ? `${info.name}, ${info.location}` : 'no uninstall entry')
  check(!winInstalled('HKLM'), 'not installed machine-wide (no admin needed)')
  const exe = winExe(info)
  check(exe && exe.toLowerCase().startsWith(join(process.env.LOCALAPPDATA, 'Programs').toLowerCase()), 'installed under %LOCALAPPDATA%\\Programs', exe ?? 'Aula.exe not found')
  if (!exe) finish()
  check(winFileVersion(exe).startsWith(version), `Aula.exe is ${version}`, winFileVersion(exe))
  // el instalador de un clic en silencio no debería abrir Aula; si la abre, se cierra (usaría %APPDATA%\Aula)
  await sleep(5000)
  const auto = winAulaProcesses()
  if (auto.length) {
    note(`the silent installer started Aula by itself (${auto.length} process(es)); closing it`)
    for (const p of auto.filter((p) => p.main)) await winClose(p.pid, 'auto-started copy')
  }
  return { exe, info }
}

async function winUpdate() {
  say(`Windows ${process.arch}: install ${FROM}, update to ${TO} (${MODE === 'quit' ? 'install on quit' : 'Restart and update'})`)
  const { exe } = await winInstall(FROM)
  const home = seededHome('update')
  const packs = manifest(join(home, 'Packs'))

  // 1) la versión vieja: busca en GitHub, descarga, comprueba la firma y, al salir (o con «Reiniciar»), instala
  let mark = logMark(home)
  const app = launch(exe, [], appEnv(home, { AULA_SKIP_ONBOARDING: '1', AULA_UPDATE_AUTO_INSTALL: MODE === 'quit' ? 'quit' : '1' }), `${FROM}-update`)
  const alive = () => running(app)
  await winWaitWindow(`${FROM}`)
  const checking = await waitForLog(home, mark, /Checking for update/, 90_000, alive)
  check(checking, `${FROM}: checks for updates`)
  const found = await waitForLog(home, mark, /Found version (\S+)/, 90_000, alive)
  check(found?.[1] === TO, `${FROM}: finds ${TO} on GitHub`, found ? `found ${found[1]}` : 'no "Found version" in the log')
  winScreenshot(`${FROM}-downloading`)
  const verified = await waitForLog(home, mark, new RegExp(`${TO.replace(/\./g, '\\.')}: firma de Aula comprobada`), 10 * 60_000, alive)
  check(verified, `${FROM}: downloads ${TO} and verifies Aula's signature`)
  const install = await waitForLog(home, mark, MODE === 'quit' ? /Auto install update on quit/ : /Install: isSilent: false, isForceRunAfter: true/, 60_000, alive)
  check(install, `${FROM}: starts the installer ${MODE === 'quit' ? 'on quit' : 'on Restart'}`)
  const exited = await waitExit(app, 60_000)
  check(exited, `${FROM}: quits`, exited ? `exit ${exited.code ?? exited.signal}` : 'still running after 60 s')
  saveLog(home, `${FROM}-update`)

  // 2) el instalador nuevo termina y deja la versión nueva en el mismo sitio
  const end = Date.now() + 5 * 60_000
  let version = ''
  while (Date.now() < end) {
    version = winInstalled('HKCU')?.version ?? ''
    if (version === TO && winFileVersion(exe).startsWith(TO) && !winInstallerRunning()) break
    await sleep(3000)
  }
  check(version === TO, `${TO} installed by the update`, `uninstall entry: ${version || 'none'}, Aula.exe: ${winFileVersion(exe)}`)
  check(existsSync(exe), 'same install folder', exe)

  // 3) la versión nueva: arranca con los mismos datos (con «Reiniciar» la abre el instalador; al salir, el estudiante)
  mark = logMark(home)
  let child = null
  if (MODE === 'restart') {
    const end2 = Date.now() + 90_000
    let main = null
    while (Date.now() < end2 && !(main = winAulaProcesses().find((p) => p.main))) await sleep(2000)
    check(main, `${TO}: reopened after "Restart and update"`)
    if (!main) finish()
    // el registro de ese arranque ya puede tener líneas: se mira desde antes de reabrir
    mark = 0
  } else {
    await sleep(5000)
    check(winAulaProcesses().length === 0, 'install on quit does not reopen Aula')
    child = launch(exe, [], appEnv(home), `${TO}-after-update`)
  }
  const sinceInstall = readLog(home).lastIndexOf(`Found version ${TO}`)
  const upToDate = await waitForLog(home, Math.max(mark, sinceInstall), /Update for version (\S+) is not available/, 120_000)
  check(upToDate?.[1] === TO, `${TO}: running and up to date`, upToDate ? `current ${upToDate[1]}` : 'no "not available" line')
  await winWaitWindow(TO)
  await sleep(4000)
  winScreenshot(`${TO}-after-update`)
  compareData(home, packs, { onboarded: true })
  const main = winAulaProcesses().find((p) => p.main)
  if (main) await winClose(main.pid, TO)
  if (child) await waitExit(child, 10_000)
  checkLogClean(home, 0, `${FROM} → ${TO}`)
  saveLog(home, `${TO}-after-update`)
  finish()
}

async function winFresh() {
  say(`Windows ${process.arch}: fresh install of ${TO}`)
  const { exe, info } = await winInstall(TO)

  // con una carpeta de datos temporal (AULA_HOME)
  const home = seededHome('fresh')
  const app = launch(exe, [], appEnv(home), `${TO}-fresh`)
  await winWaitWindow(TO)
  const upToDate = await waitForLog(home, 0, /Update for version (\S+) is not available/, 90_000, () => running(app))
  check(upToDate?.[1] === TO, `${TO}: checks GitHub and is up to date`, upToDate ? `current ${upToDate[1]}` : 'no "not available" line')
  await sleep(4000)
  winScreenshot(`${TO}-fresh-onboarding`)
  await winClose(app.pid, TO)
  checkLogClean(home, 0, `${TO} fresh`)
  saveLog(home, `${TO}-fresh`)

  // como un estudiante de verdad: sin AULA_HOME, en %APPDATA%\Aula (la máquina es desechable)
  const appData = join(process.env.APPDATA, 'Aula')
  const app2 = launch(exe, [], { AULA_FAKE_AI: '1', AULA_UPDATE_CHECK_DELAY_MS: '3000' }, `${TO}-appdata`)
  await winWaitWindow(`${TO} (default data folder)`)
  const ok2 = await waitForLog(appData, 0, /Update for version (\S+) is not available/, 90_000, () => running(app2))
  check(ok2, `${TO}: uses %APPDATA%\\Aula by default`, existsSync(appData) ? appData : 'folder not created')
  await winClose(app2.pid, `${TO} (default data folder)`)
  checkLogClean(appData, 0, `${TO} in %APPDATA%\\Aula`)
  saveLog(appData, `${TO}-appdata`)

  // desinstalar (en silencio): se va el programa, se quedan los datos del estudiante
  const uninstaller = info?.location && join(info.location, `Uninstall Aula.exe`)
  if (uninstaller && existsSync(uninstaller)) {
    const r = spawnSync(uninstaller, ['/S'], { timeout: 5 * 60_000 })
    const end = Date.now() + 120_000
    while (Date.now() < end && (existsSync(exe) || winInstalled('HKCU'))) await sleep(2000)
    check(r.status === 0 && !existsSync(exe) && !winInstalled('HKCU'), 'silent uninstall removes the app', `exit ${r.status}`)
    check(existsSync(join(appData, 'settings.json')) && existsSync(join(home, 'Packs')), 'uninstall keeps the student\'s data')
  } else {
    check(false, 'uninstaller present', uninstaller ?? 'no install location')
  }
  finish()
}

// ── Linux ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const sh = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 10 * 60_000, ...o })

/** Los procesos que cuelgan de `root` (la AppImage arranca su runtime, luego AppRun y luego Electron). */
function descendants(root) {
  const parent = new Map()
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
      parent.set(Number(d), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]))
    } catch { /* ya no está */ }
  }
  const out = []
  const walk = (p) => { for (const [c, pp] of parent) if (pp === p) { out.push(c); walk(c) } }
  walk(root)
  return out
}

/** Procesos principales de Aula (Electron sin --type=), dentro de `root` o en todo el sistema. */
function linuxAulaMains(root) {
  const pids = root ? [root, ...descendants(root)] : readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number)
  return pids.filter((pid) => {
    try {
      const exe = basename(readlinkSync(`/proc/${pid}/exe`))
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      return exe === 'aula' && !cmd.includes('--type=')
    } catch {
      return false
    }
  })
}

function linuxScreenshot(name) {
  const file = join(OUT, `${name}.png`)
  const r = sh('import', ['-window', 'root', file])
  say(r.status === 0 ? `screenshot ${basename(file)}` : `screenshot ${name} failed: ${r.error?.message ?? r.stderr}`)
}

async function linuxWaitWindow(label, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const r = sh('xwininfo', ['-root', '-tree'])
    const line = (r.stdout || '').split('\n').find((l) => /"Aula"/.test(l) && /\d+x\d+\+/.test(l))
    if (line) return check(true, `${label}: window open`, line.trim().slice(0, 120))
    await sleep(2000)
  }
  return check(false, `${label}: window open`, 'no window titled "Aula" after 60 s')
}

/** Cierra Aula como el sistema al apagar (SIGTERM al proceso principal de Electron). */
async function linuxClose(child, label) {
  const mains = linuxAulaMains(child.pid)
  for (const pid of mains) try { process.kill(pid, 'SIGTERM') } catch { /* ya no está */ }
  const exited = await waitExit(child, 30_000)
  if (!exited) try { process.kill(-child.pid, 'SIGKILL') } catch { /* nada */ }
  return check(exited && mains.length > 0, `${label}: quits on SIGTERM`, exited ? `exit ${exited.code ?? exited.signal}` : 'still running after 30 s (killed)')
}

function linuxDiagnostics() {
  const read = (f) => { try { return readFileSync(f, 'utf8').trim() } catch { return 'n/a' } }
  note(`kernel.apparmor_restrict_unprivileged_userns = ${read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')}`)
  note(`unprivileged user namespaces (unshare -Ur true): ${sh('unshare', ['-Ur', 'true']).status === 0 ? 'available' : 'blocked'}`)
  note(`/dev/fuse: ${existsSync('/dev/fuse') ? 'present' : 'missing'}; libfuse2: ${sh('sh', ['-c', 'ldconfig -p | grep -q "libfuse.so.2"']).status === 0 ? 'installed' : 'not installed'}`)
}

async function appImageUpdate() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const yml = process.arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml'
  say(`Linux ${arch}: AppImage ${FROM} updates itself to ${TO}`)
  linuxDiagnostics()
  // la carpeta donde el estudiante guardó la AppImage (escribible: si no, Aula no descarga)
  const apps = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'aula-apps-'))
  const oldName = `Aula-${FROM}-linux-${arch}.AppImage`
  const newName = `Aula-${TO}-linux-${arch}.AppImage`
  const image = join(apps, oldName)
  copyFileSync(await download(FROM, oldName), image)
  chmodSync(image, 0o755)

  // con FUSE la AppImage se monta (lo normal en un escritorio); sin él (o sin libfuse2) no arranca: se mira cuál es el
  // caso aquí y, si no hay FUSE, se usa APPIMAGE_EXTRACT_AND_RUN (la AppImage se extrae en /tmp y se ejecuta)
  const probeHome = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'aula-probe-'))
  const probe = launch(image, [], appEnv(probeHome, { AULA_NO_UPDATES: '1' }), `${FROM}-fuse-probe`)
  const probeEnd = Date.now() + 30_000
  while (Date.now() < probeEnd && running(probe) && !linuxAulaMains(probe.pid).length) await sleep(1000)
  const fuse = running(probe) && linuxAulaMains(probe.pid).length > 0
  note(fuse ? 'the AppImage mounts with FUSE on this runner' : `the AppImage does not start without FUSE here (${readFileSync(join(OUT, `${FROM}-fuse-probe.output.txt`), 'utf8').trim().split('\n').slice(0, 2).join(' / ')}): using APPIMAGE_EXTRACT_AND_RUN=1`)
  if (running(probe)) await linuxClose(probe, `${FROM} (FUSE probe)`)
  const extract = fuse ? {} : { APPIMAGE_EXTRACT_AND_RUN: '1' }

  const home = seededHome('appimage')
  const packs = manifest(join(home, 'Packs'))
  let mark = logMark(home)
  const app = launch(image, [], appEnv(home, { ...extract, AULA_SKIP_ONBOARDING: '1', AULA_UPDATE_AUTO_INSTALL: MODE === 'quit' ? 'quit' : '1' }), `${FROM}-update`)
  const alive = () => running(app)
  await linuxWaitWindow(FROM)
  check(await waitForLog(home, mark, /Checking for update/, 90_000, alive), `${FROM}: checks for updates`)
  const found = await waitForLog(home, mark, /Found version (\S+)/, 90_000, alive)
  check(found?.[1] === TO, `${FROM}: finds ${TO} on GitHub`, found ? `found ${found[1]}` : 'no "Found version" in the log')
  linuxScreenshot(`${FROM}-downloading`)
  const verified = await waitForLog(home, mark, new RegExp(`${TO.replace(/\./g, '\\.')}: firma de Aula comprobada`), 10 * 60_000, alive)
  check(verified, `${FROM}: downloads ${TO} and verifies Aula's signature`)
  const install = await waitForLog(home, mark, MODE === 'quit' ? /Auto install update on quit/ : /Install: isSilent: false, isForceRunAfter: true/, 60_000, alive)
  check(install, `${FROM}: installs ${MODE === 'quit' ? 'on quit' : 'on Restart'}`)
  const exited = await waitExit(app, 3 * 60_000)
  check(exited, `${FROM}: quits`, exited ? `exit ${exited.code ?? exited.signal}` : 'still running after 3 min')
  saveLog(home, `${FROM}-update`)

  // la AppImage vieja se cambia por la nueva (con el nombre de la versión nueva), idéntica a la publicada
  const updated = join(apps, newName)
  check(!existsSync(image), `the ${FROM} AppImage is gone`)
  check(existsSync(updated) && (statSync(updated).mode & 0o111) !== 0, `${newName} is in its place and executable`, readdirSync(apps).join(', '))
  if (!existsSync(updated)) finish()
  const published = publishedSha512(readFileSync(await download(TO, yml), 'utf8'), newName)
  check(published && sha512(updated) === published, `${newName} is byte-identical to the published one (SHA-512 in ${yml})`)

  // la versión nueva: con «Reiniciar» la abre la vieja al salir; al salir sin más, la abre el estudiante
  let app2 = null
  const sinceFound = readLog(home).lastIndexOf(`Found version ${TO}`)
  if (MODE === 'restart') {
    const end = Date.now() + 90_000
    while (Date.now() < end && !linuxAulaMains().length) await sleep(1000)
    check(linuxAulaMains().length > 0, `${TO}: reopened after "Restart and update"`)
  } else {
    await sleep(5000)
    check(linuxAulaMains().length === 0, 'install on quit does not leave Aula running')
    mark = logMark(home)
    app2 = launch(updated, [], appEnv(home, extract), `${TO}-after-update`)
  }
  const upToDate = await waitForLog(home, Math.max(mark, sinceFound), /Update for version (\S+) is not available/, 120_000)
  check(upToDate?.[1] === TO, `${TO}: running and up to date`, upToDate ? `current ${upToDate[1]}` : 'no "not available" line')
  await linuxWaitWindow(TO)
  await sleep(4000)
  linuxScreenshot(`${TO}-after-update`)
  compareData(home, packs, { onboarded: true })
  if (app2) await linuxClose(app2, TO)
  else for (const pid of linuxAulaMains()) await linuxCloseOrphan(pid, TO)
  checkLogClean(home, 0, `${FROM} → ${TO}`)
  saveLog(home, `${TO}-after-update`)
  finish()
}

/** Cierra una Aula que no lanzamos nosotros (la que abrió «Reiniciar y actualizar»). */
async function linuxCloseOrphan(pid, label) {
  try { process.kill(pid, 'SIGTERM') } catch { /* ya no está */ }
  const end = Date.now() + 30_000
  while (Date.now() < end && existsSync(`/proc/${pid}`)) await sleep(500)
  const gone = !existsSync(`/proc/${pid}`) || /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  if (!gone) try { process.kill(pid, 'SIGKILL') } catch { /* nada */ }
  return check(gone, `${label}: quits on SIGTERM`)
}

function aptInstall(file) {
  const r = sh('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', resolve(file)], { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } })
  writeFileSync(join(OUT, `apt-${basename(file)}.txt`), `${r.stdout}\n${r.stderr}`)
  return r.status === 0
}
const debVersion = () => sh('dpkg-query', ['-W', '-f=${Version}', 'aula']).stdout?.trim()

/** El ejecutable que abre el menú de aplicaciones (Exec= del .desktop que instala la .deb). */
function debExec() {
  const desktop = ['/usr/share/applications/aula.desktop', '/usr/share/applications/Aula.desktop'].find(existsSync)
  const exec = desktop && readFileSync(desktop, 'utf8').match(/^Exec=("?)([^"\s]+)\1/m)?.[2]
  note(`desktop entry: ${desktop ?? 'none'} → ${exec ?? '?'}`)
  return exec && existsSync(exec) ? exec : '/opt/Aula/aula'
}

async function deb() {
  say(`Linux: .deb ${FROM} (notice only), then apt install of ${TO} over it`)
  linuxDiagnostics()
  const fromDeb = await download(FROM, `Aula-${FROM}-linux-amd64.deb`)
  const toDeb = await download(TO, `Aula-${TO}-linux-amd64.deb`)
  check(aptInstall(fromDeb) && debVersion() === FROM, `apt install ./Aula-${FROM}-linux-amd64.deb`, `dpkg: ${debVersion()}`)
  const exe = debExec()
  const sandbox = join(dirname(exe), 'chrome-sandbox')
  if (existsSync(sandbox)) note(`chrome-sandbox mode ${(statSync(sandbox).mode & 0o7777).toString(8)} owner uid ${statSync(sandbox).uid}`)

  const home = seededHome('deb')
  const packs = manifest(join(home, 'Packs'))
  let mark = logMark(home)
  const app = launch(exe, [], appEnv(home, { AULA_SKIP_ONBOARDING: '1' }), `${FROM}-deb`)
  const alive = () => running(app)
  await linuxWaitWindow(`${FROM} (.deb)`)
  const found = await waitForLog(home, mark, /Found version (\S+)/, 90_000, alive)
  check(found?.[1] === TO, `${FROM} (.deb): sees ${TO} on GitHub`, found ? `found ${found[1]}` : 'no "Found version" in the log')
  await sleep(20_000)
  check(!/Downloading update/.test(readLog(home).slice(mark)), `${FROM} (.deb): does not download it (offers the download page)`)
  linuxScreenshot(`${FROM}-deb-notice`)
  await linuxClose(app, `${FROM} (.deb)`)
  checkLogClean(home, mark, `${FROM} (.deb)`)
  saveLog(home, `${FROM}-deb`)

  check(aptInstall(toDeb) && debVersion() === TO, `apt install ./Aula-${TO}-linux-amd64.deb (upgrade)`, `dpkg: ${debVersion()}`)
  mark = logMark(home)
  const app2 = launch(exe, [], appEnv(home), `${TO}-deb`)
  await linuxWaitWindow(`${TO} (.deb)`)
  const upToDate = await waitForLog(home, mark, /Update for version (\S+) is not available/, 90_000, () => running(app2))
  check(upToDate?.[1] === TO, `${TO} (.deb): running and up to date`, upToDate ? `current ${upToDate[1]}` : 'no "not available" line')
  await sleep(4000)
  linuxScreenshot(`${TO}-deb`)
  compareData(home, packs, { onboarded: true })
  await linuxClose(app2, `${TO} (.deb)`)
  checkLogClean(home, mark, `${TO} (.deb)`)
  saveLog(home, `${TO}-deb`)
  finish()
}

// ── Arranque ────────────────────────────────────────────────────────────────────────────────────────────────────────

SCENARIOS[scenario]().catch((e) => {
  check(false, 'unexpected error', e?.stack ?? String(e))
  finish()
})
