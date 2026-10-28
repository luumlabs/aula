// Cerrojo entre procesos (la app y el ayudante MCP escriben en los mismos cursos). Port de FileLock (BaseKit/FileIO.swift):
// Swift usaba flock; aquí, una carpeta creada con `mkdir` (atómico) con el pid del dueño. Es reentrante dentro del proceso
// y se rompe si el dueño murió o lleva demasiado tiempo (un cierre a lo bruto no deja el curso bloqueado para siempre).
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const held = new Map<string, number>()
const sleeper = new Int32Array(new SharedArrayBuffer(4))

/** Espera síncrona (las operaciones del almacén son síncronas, como en Swift). */
export function sleepSync(ms: number): void {
  Atomics.wait(sleeper, 0, 0, ms)
}

export interface LockOptions {
  /** Cuánto esperar como mucho a que otro proceso lo suelte (ms). */
  timeoutMs?: number
  /** A partir de cuánto se considera abandonado un cerrojo cuyo dueño no se puede comprobar (ms). */
  staleMs?: number
}

export class LockTimeoutError extends Error {
  constructor(path: string) {
    super(`El archivo está bloqueado por otro proceso: ${path}`)
    this.name = 'LockTimeoutError'
  }
}

function ownerAlive(lockDir: string): boolean | undefined {
  try {
    const [pidText] = readFileSync(join(lockDir, 'owner'), 'utf8').split(' ')
    const pid = Number(pidText)
    if (!Number.isInteger(pid) || pid <= 0) return undefined
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  } catch {
    return undefined
  }
}

function acquire(lockDir: string, opts: LockOptions): void {
  const timeout = opts.timeoutMs ?? 15_000
  const stale = opts.staleMs ?? 60_000
  const deadline = Date.now() + timeout
  mkdirSync(dirname(lockDir), { recursive: true })
  let wait = 2
  for (;;) {
    try {
      mkdirSync(lockDir)
      try { writeFileSync(join(lockDir, 'owner'), `${process.pid} ${Date.now()}`) } catch { /* sin dueño escrito: caduca por tiempo */ }
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    // ¿abandonado? (dueño muerto o demasiado viejo)
    const alive = ownerAlive(lockDir)
    let age = 0
    try { age = Date.now() - statSync(lockDir).mtimeMs } catch { continue }
    if (alive === false || (alive === undefined && age > 2_000) || age > stale) {
      try { rmSync(lockDir, { recursive: true, force: true }) } catch { /* otro lo quitó */ }
      continue
    }
    if (Date.now() > deadline) throw new LockTimeoutError(lockDir)
    sleepSync(wait)
    wait = Math.min(wait * 2, 25)
  }
}

/** Ejecuta `body` con el cerrojo `lockDir` tomado (reentrante en el mismo proceso). */
export function withFileLock<T>(lockDir: string, body: () => T, opts: LockOptions = {}): T {
  const depth = held.get(lockDir) ?? 0
  if (depth > 0) {
    held.set(lockDir, depth + 1)
    try { return body() } finally { held.set(lockDir, held.get(lockDir)! - 1) }
  }
  acquire(lockDir, opts)
  held.set(lockDir, 1)
  try {
    return body()
  } finally {
    held.delete(lockDir)
    try { rmSync(lockDir, { recursive: true, force: true }) } catch { /* nada */ }
  }
}

/** Con varios cerrojos a la vez (en orden, para no bloquearse entre procesos). */
export function withFileLocks<T>(lockDirs: string[], body: () => T, opts: LockOptions = {}): T {
  const sorted = [...new Set(lockDirs)].sort()
  const run = (i: number): T => (i >= sorted.length ? body() : withFileLock(sorted[i], () => run(i + 1), opts))
  return run(0)
}

/** Carpeta de cerrojo que corresponde a un archivo `.lock` de Swift (`.lock` → `.aula-lock`). */
export function lockDirFor(path: string): string {
  if (path.endsWith('/.lock') || path === '.lock') return path.slice(0, -'.lock'.length) + '.aula-lock'
  if (path.endsWith('.progress.lock')) return path.slice(0, -'.progress.lock'.length) + '.aula-progress-lock'
  return path
}
