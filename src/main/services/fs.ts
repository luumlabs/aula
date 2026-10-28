// Escritura atómica a prueba de cortes y lectura tolerante de JSON (adaptado de `config.write_private` y
// `credentials._escribir_privado` de Luna): el temporal nace ya con sus permisos, se fuerza a disco (fsync) ANTES del rename
// —sin eso, tras un apagón el nombre nuevo puede apuntar a un archivo vacío o a medias— y se cambia de nombre de golpe.
// Con `backup`, la versión anterior queda como `.<nombre>.bak` (oculta: no se exporta ni la ve el vigilante de cursos), un
// enlace duro al archivo viejo, sin copiar bytes. `readWithBackup` la usa si el archivo principal no se puede leer.
import { closeSync, copyFileSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

export interface AtomicWriteOptions {
  /** Permisos del archivo (el temporal ya nace con ellos). */
  mode?: number
  /** Forzar a disco antes del rename (por defecto sí; las cachés que se pueden rehacer pueden saltárselo). */
  durable?: boolean
  /** Conservar la versión anterior como `.<nombre>.bak`. */
  backup?: boolean
}

/** La copia de la versión anterior de `file` (`dir/.nombre.bak`). */
export function backupPath(file: string): string {
  return join(dirname(file), `.${basename(file)}.bak`)
}

/** ¿Se fuerza a disco? `AULA_FSYNC=0` lo apaga (pruebas de rendimiento). */
const fsyncEnabled = (): boolean => process.env.AULA_FSYNC !== '0'

function keepPrevious(file: string): void {
  const bak = backupPath(file)
  try {
    if (!existsSync(file)) return
    rmSync(bak, { force: true })
    try {
      linkSync(file, bak)
    } catch {
      copyFileSync(file, bak)
    }
  } catch { /* sin copia: la escritura sigue */ }
}

export function writeFileAtomic(file: string, data: string | Uint8Array, modeOrOptions?: number | AtomicWriteOptions): void {
  const opts: AtomicWriteOptions = typeof modeOrOptions === 'number' ? { mode: modeOrOptions } : (modeOrOptions ?? {})
  mkdirSync(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    const fd = openSync(tmp, 'wx', opts.mode ?? 0o644)
    try {
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      let off = 0
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
      if ((opts.durable ?? true) && fsyncEnabled()) {
        try { fsyncSync(fd) } catch { /* sistemas de archivos sin fsync */ }
      }
    } finally {
      closeSync(fd)
    }
    if (opts.backup) keepPrevious(file)
    renameSync(tmp, file)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* nada */ }
    throw err
  }
}

export function writeJSONAtomic(file: string, value: unknown, pretty = true, opts: AtomicWriteOptions = {}): void {
  writeFileAtomic(file, JSON.stringify(value, null, pretty ? 1 : 0) + '\n', opts)
}

export function readJSON<T = unknown>(file: string): T | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Lo que dio `readWithBackup`. */
export interface BackupRead<T> {
  value: T
  /** Se leyó de la copia anterior porque el archivo estaba dañado. */
  fromBackup: boolean
  /** Dónde quedó apartada una copia del archivo dañado (si lo estaba). */
  damagedCopy?: string
}

/**
 * Lee `file` con `parse`; si no se puede (dañado, a medias), guarda una copia del dañado al lado (`<nombre>.damaged-<huella>`,
 * como «apartar ilegible» de Luna) y prueba con la copia anterior. `undefined` si no existe o ninguna de las dos sirve.
 * El archivo dañado no se toca: la próxima escritura lo sustituye (así no se pisa lo que otro proceso acabe de escribir).
 */
export function readWithBackup<T>(file: string, parse: (text: string) => T): BackupRead<T> | undefined {
  let text: string | undefined
  try { text = readFileSync(file, 'utf8') } catch { text = undefined }
  if (text !== undefined) {
    try {
      return { value: parse(text), fromBackup: false }
    } catch { /* dañado: se aparta una copia y se mira la anterior */ }
  }
  let damagedCopy: string | undefined
  if (text !== undefined) damagedCopy = keepDamagedCopy(file, text)
  const bak = backupPath(file)
  try {
    const value = parse(readFileSync(bak, 'utf8'))
    return damagedCopy ? { value, fromBackup: true, damagedCopy } : { value, fromBackup: true }
  } catch {
    return undefined
  }
}

/**
 * Copia (no mueve) un archivo dañado a `<nombre>.damaged-<huella>`: una sola copia por contenido, aunque se lea mil veces, y
 * con otra extensión (nadie que liste los `.json` de una carpeta la confunde con un archivo de verdad). Una copia nunca se copia.
 */
export function keepDamagedCopy(file: string, content: string | Buffer): string | undefined {
  if (basename(file).includes('.damaged-')) return undefined
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 10)
  const dest = join(dirname(file), `${basename(file)}.damaged-${hash}`)
  try {
    // privada: puede llevar datos del estudiante (la memoria, por ejemplo)
    if (!existsSync(dest)) writeFileAtomic(dest, content, { durable: false, mode: 0o600 })
    return dest
  } catch {
    return undefined
  }
}
