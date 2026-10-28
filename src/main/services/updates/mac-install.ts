// Instalar una actualización en macOS sin Squirrel.Mac.
//
// Squirrel.Mac (lo que usa electron-updater) solo acepta la versión nueva si cumple el «requisito designado» de la firma de
// la que está abierta. Con la firma ad hoc de Aula ese requisito es el hash exacto del ejecutable (`cdhash H"…"`), así que
// NINGUNA versión nueva lo cumple y la actualización se rechaza siempre. Aquí lo hacemos nosotros:
//   1. electron-updater descarga el .zip y comprueba su SHA-512 (el de latest-mac.yml); lo volvemos a comprobar y se exige
//      la firma propia de Aula (Ed25519, ./signature.ts): el SHA-512 solo dice que el zip es el que anuncia el .yml.
//   2. `ditto` lo descomprime en una carpeta aparte y se comprueba la app: identificador, versión, `codesign --verify
//      --deep --strict` (que no le falte ni sobre nada) y, si la app abierta tiene firma de desarrollador, que la nueva
//      cumpla su mismo requisito (lo que haría Squirrel).
//   3. Al salir, dos `rename` en la misma carpeta: la app actual pasa a `.Aula-previous.app` y la nueva ocupa su sitio. Si
//      algo falla, se deshace en el acto y la app de siempre sigue donde estaba.
//   4. La versión nueva, al abrirse bien, borra la copia anterior. Si no llega a abrirse, el vigilante (un `sh` aparte)
//      devuelve la anterior a su sitio, la reabre y apunta la versión fallida para no volver a intentarlo sola.
// Este módulo no importa `electron`: lo usan src/main/electron/updates.ts y las pruebas.
import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, accessSync, constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { KeyObject } from 'node:crypto'
import { verifyDownloadedUpdate, type SignedFileEntry } from './signature'
import { compareVersions } from './version'

/** Por qué no se puede instalar (o no se instaló) una versión. La interfaz lo traduce. */
export type MacInstallErrorCode = 'translocated' | 'readOnly' | 'corrupt' | 'verify' | 'install' | 'disk' | 'system'

export class MacInstallError extends Error {
  constructor(readonly code: MacInstallErrorCode, message: string) {
    super(message)
    this.name = 'MacInstallError'
  }
}

export type Run = (cmd: string, args: string[]) => Promise<string>

/** execFile con salida de texto (stdout + stderr si falla). */
export const run: Run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args[0] ?? ''}: ${String(stderr || err.message).trim()}`))
      else resolve(String(stdout) + String(stderr))
    })
  })

/** `/…/Aula.app/Contents/MacOS/Aula` → `/…/Aula.app` (null si no está dentro de un paquete .app). */
export function appBundleOf(execPath: string): string | null {
  const i = execPath.lastIndexOf('.app/Contents/MacOS/')
  return i < 0 ? null : execPath.slice(0, i + 4)
}

/** Nombres de las copias de trabajo, junto a la app (misma carpeta = `rename` atómico). */
export function siblings(target: string): { backup: string; incoming: string } {
  const name = basename(target, '.app')
  return { backup: join(dirname(target), `.${name}-previous.app`), incoming: join(dirname(target), `.${name}-incoming.app`) }
}

/**
 * ¿Puede reemplazarse esta app? null = sí. 'translocated': macOS la abrió desde una copia temporal de solo lectura
 * (App Translocation: está en Descargas o en el .dmg sin mover a Aplicaciones); 'readOnly': la carpeta no deja escribir.
 */
export function selfUpdateBlocker(target: string): MacInstallErrorCode | null {
  if (target.includes('/AppTranslocation/')) return 'translocated'
  // abierta desde el .dmg (o un disco de solo lectura): lo que toca es moverla a Aplicaciones (A1-P2-18c)
  if (target.startsWith('/Volumes/') && !writable(dirname(target))) return 'translocated'
  if (!writable(dirname(target)) || !writable(target)) return 'readOnly'
  return null
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** SHA-512 en base64 (el formato de latest-mac.yml). */
export function sha512Base64(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('base64')))
  })
}

export interface StageOptions {
  zip: string
  /** SHA-512 (base64) que anuncia latest-mac.yml. */
  sha512?: string
  version: string
  bundleId: string
  /** Carpeta de trabajo (se vacía). */
  stageDir: string
  /** App abierta ahora: si tiene firma de desarrollador, la nueva debe cumplir su mismo requisito. */
  current?: string
  /** Firma propia de Aula (Ed25519) del zip: su entrada de latest-mac.yml. La app la pasa SIEMPRE (ver signature.ts). */
  signature?: { entry: SignedFileEntry | null; publicKey?: KeyObject | readonly KeyObject[] }
  /** Versión de macOS de este Mac («13.6.1»): la nueva no se prepara si pide una mayor (LSMinimumSystemVersion). */
  systemVersion?: string
  run?: Run
}

/** Descomprime y comprueba la versión nueva. Devuelve la ruta de la app lista para ocupar el sitio de la actual. */
export async function stageMacUpdate(o: StageOptions): Promise<string> {
  const exec = o.run ?? run
  const got = o.sha512 || o.signature ? await sha512Base64(o.zip) : ''
  if (o.sha512 && got !== o.sha512) throw new MacInstallError('corrupt', `SHA-512 distinto: ${got} ≠ ${o.sha512}`)
  if (o.signature) {
    // la firma de Aula: sin ella, cualquiera con acceso a las releases de GitHub podría instalar su código (J3-4)
    try {
      await verifyDownloadedUpdate({ file: o.zip, entry: o.signature.entry, version: o.version, sha512: got, publicKey: o.signature.publicKey })
    } catch (e) {
      throw new MacInstallError('verify', `Sin firma válida de Aula: ${(e as Error).message}`)
    }
  }
  rmSync(o.stageDir, { recursive: true, force: true })
  mkdirSync(o.stageDir, { recursive: true })
  try {
    await exec('/usr/bin/ditto', ['-x', '-k', o.zip, o.stageDir])
  } catch (e) {
    const msg = (e as Error).message
    // sin espacio no es una descarga dañada (no hay que volver a bajarla: hay que liberar espacio), A1-P2-19
    if (/no space left|ENOSPC/i.test(msg)) throw new MacInstallError('disk', `Sin espacio para descomprimir: ${msg}`)
    throw new MacInstallError('corrupt', `No se pudo descomprimir: ${msg}`)
  }
  const apps = readdirSync(o.stageDir).filter((f) => f.endsWith('.app'))
  if (apps.length !== 1) throw new MacInstallError('verify', `El zip no trae una sola app (${apps.join(', ') || 'ninguna'})`)
  const app = join(o.stageDir, apps[0])
  const plist = await readPlist(join(app, 'Contents', 'Info.plist'), exec)
  if (plist.CFBundleIdentifier !== o.bundleId) throw new MacInstallError('verify', `Identificador ${String(plist.CFBundleIdentifier)} ≠ ${o.bundleId}`)
  if (plist.CFBundleShortVersionString !== o.version) throw new MacInstallError('verify', `Versión ${String(plist.CFBundleShortVersionString)} ≠ ${o.version}`)
  // una versión que pide un macOS más nuevo no se instala (instalada al salir, se quedaría sin abrir), A1-P2-10
  const minimum = typeof plist.LSMinimumSystemVersion === 'string' ? plist.LSMinimumSystemVersion : ''
  if (minimum && o.systemVersion && compareVersions(o.systemVersion, minimum) < 0) {
    throw new MacInstallError('system', `La ${o.version} pide macOS ${minimum} o posterior (este Mac: ${o.systemVersion})`)
  }
  try {
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  } catch (e) {
    throw new MacInstallError('verify', `Firma no válida: ${(e as Error).message}`)
  }
  const requirement = o.current ? await developerRequirement(o.current, exec) : null
  if (requirement) {
    try {
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', `-R=${requirement}`, app])
    } catch (e) {
      throw new MacInstallError('verify', `No la firmó el mismo desarrollador: ${(e as Error).message}`)
    }
  }
  return app
}

async function readPlist(file: string, exec: Run): Promise<Record<string, unknown>> {
  try {
    const out = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])
    const v: unknown = JSON.parse(out)
    if (v && typeof v === 'object') return v as Record<string, unknown>
  } catch {
    /* abajo */
  }
  throw new MacInstallError('verify', 'Info.plist ilegible')
}

/** Requisito designado de la app abierta si es de un desarrollador; null con firma ad hoc (`cdhash …`) o sin firma. */
export async function developerRequirement(app: string, exec: Run = run): Promise<string | null> {
  try {
    const out = await exec('/usr/bin/codesign', ['-d', '-r-', app])
    const m = /designated => (.+)/.exec(out)
    const req = m?.[1]?.trim()
    if (!req || req.startsWith('cdhash')) return null
    return req
  } catch {
    return null
  }
}

/** Lo que queda apuntado al instalar (lo lee la versión nueva al abrirse). */
export interface InstallJournal {
  from: string
  to: string
  target: string
  backup: string
  stageDir: string
  at: string
}

/**
 * Pone la app nueva en el sitio de la actual (síncrono: se llama al salir). Si algo falla, todo vuelve a como estaba y
 * se lanza MacInstallError('install'). Con `allowCopy: false` (al apagar el Mac) solo se hacen `rename` instantáneos: si la
 * versión nueva está en otro disco, no se instala ahora.
 */
export function swapMacBundle(target: string, staged: string, opts: { allowCopy?: boolean } = {}): { backup: string } {
  const { backup, incoming } = siblings(target)
  rmSync(backup, { recursive: true, force: true })
  rmSync(incoming, { recursive: true, force: true })
  // primero junto a la actual (mismo disco: ver stageDirFor); si esto falla, aún no se ha tocado nada
  const ready = incoming
  try {
    try {
      renameSync(staged, incoming)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV' || opts.allowCopy === false) throw e
      execFileSync('/usr/bin/ditto', [staged, incoming]) // otro disco: copia (más lenta, mismo resultado)
    }
  } catch (e) {
    rmSync(incoming, { recursive: true, force: true })
    throw new MacInstallError('install', `No se pudo preparar la versión nueva: ${(e as Error).message}`)
  }
  try {
    renameSync(target, backup)
  } catch (e) {
    rmSync(ready, { recursive: true, force: true })
    throw new MacInstallError('install', `No se pudo apartar la versión actual: ${(e as Error).message}`)
  }
  try {
    renameSync(ready, target)
  } catch (e) {
    renameSync(backup, target)
    rmSync(ready, { recursive: true, force: true })
    throw new MacInstallError('install', `No se pudo colocar la versión nueva: ${(e as Error).message}`)
  }
  return { backup }
}

/**
 * Carpeta de trabajo para descomprimir: junto a la app si se puede (mismo disco), si no en la caché.
 * Oculta (empieza por punto) para que no aparezca en Aplicaciones.
 */
export function stageDirFor(target: string, cacheDir: string): string {
  const near = join(dirname(target), `.${basename(target, '.app')}-update`)
  try {
    if (statSync(cacheDir).dev === statSync(dirname(target)).dev) return join(cacheDir, 'staged')
  } catch {
    /* sin caché: junto a la app */
  }
  return near
}

/** Al abrir la versión nueva sana: borra la copia anterior y la carpeta de trabajo. */
export function cleanupAfterUpdate(j: Pick<InstallJournal, 'backup' | 'stageDir'>): void {
  for (const p of [j.backup, j.stageDir]) {
    if (p && /\.app$|update$|staged$/.test(p) && existsSync(p)) rmSync(p, { recursive: true, force: true })
  }
}

export interface WatchdogOptions {
  target: string
  /** Ejecutable de la app dentro de `target` (…/Aula.app/Contents/MacOS/Aula): para ver si sigue abierta y reabrirla. */
  executable: string
  backup: string
  /** La versión nueva escribe este archivo al abrirse bien. */
  marker: string
  /** Aquí apunta el vigilante la versión que no arrancó. */
  failedFile: string
  version: string
  /** Proceso de la versión vieja (hay que esperar a que salga). */
  pid: number
  /** Segundos que se le dan a la versión nueva para abrirse. */
  graceSeconds?: number
  /** Huella de lo publicado (failed.ts → fingerprintOf), para apuntarla con el fallo. */
  fingerprint?: string
  /** Argumentos con los que se abrió la versión vieja: la que vuelve se reabre con los mismos (como app.relaunch). */
  args?: string[]
}

/** El ejecutable de una app (CFBundleExecutable) en la ruta de otra: `/A/Aula 2.app` + `…/MacOS/Aula` → `/A/Aula 2.app/Contents/MacOS/Aula`. */
export function executableIn(target: string, execPath: string): string {
  return join(target, 'Contents', 'MacOS', basename(execPath))
}

/** Guion de `sh` del vigilante (sin dependencias: solo /bin/sh, kill, ps, grep, mv, rm). */
export function watchdogScript(o: WatchdogOptions): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const grace = Math.max(5, Math.round(o.graceSeconds ?? 120))
  const fingerprint = (o.fingerprint ?? '').replace(/[^A-Za-z0-9+/=,]/g, '')
  return `#!/bin/sh
# Vigilante de la actualización de Aula: si la versión nueva no llega a abrirse, vuelve la anterior.
TARGET=${q(o.target)}
EXEC=${q(o.executable)}
BACKUP=${q(o.backup)}
MARKER=${q(o.marker)}
FAILED=${q(o.failedFile)}
VERSION=${q(o.version)}
OLDPID=${o.pid}
i=0
while kill -0 "$OLDPID" 2>/dev/null && [ $i -lt 120 ]; do sleep 0.5; i=$((i+1)); done
i=0
while [ $i -lt ${grace * 2} ]; do
  [ -f "$MARKER" ] && exit 0
  sleep 0.5; i=$((i+1))
done
[ -f "$MARKER" ] && exit 0
# sigue abierta (lenta, pero viva): no se toca (ruta exacta del ejecutable, sin expresiones regulares)
ps -axo comm= 2>/dev/null | grep -Fqx -- "$EXEC" && exit 0
[ -d "$BACKUP" ] || exit 0
FAILEDAPP="$(dirname "$TARGET")/.$(basename "$TARGET" .app)-failed.app"
rm -rf "$FAILEDAPP"
mv "$TARGET" "$FAILEDAPP" 2>/dev/null
if mv "$BACKUP" "$TARGET"; then
  rm -rf "$FAILEDAPP"
  mkdir -p "$(dirname "$FAILED")"
  printf '{"version":"%s","reason":"start","at":"%s"${fingerprint ? `,"fingerprint":"${fingerprint}"` : ''}}\\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$FAILED"
  "$EXEC"${(o.args ?? []).map((a) => ' ' + q(a)).join('')} >/dev/null 2>&1 &
else
  mv "$FAILEDAPP" "$TARGET" 2>/dev/null
fi
exit 0
`
}
