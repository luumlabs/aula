// Archivos descargados con la sesión: se bajan a una carpeta de preparación, se comprueban (tamaño, tipo, que no sea un
// programa ni una página de acceso) y se mueven sin sobrescribir a la carpeta de destino, con nombre saneado y sin permisos de
// ejecución. Port de las reglas de BrowserKit/Downloads/*. Sin Electron.
import { closeSync, constants, copyFileSync, fstatSync, linkSync, mkdirSync, openSync, readSync, readdirSync, rmSync, statSync, chmodSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ensureExtension, isBlockedMime, isExecutableContent, looksLikeWebPage, sanitizeFilename, uniqueNameCandidates } from '@engine/platforms'
import { paths } from '../paths'
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'

export const DEFAULT_DOWNLOAD_LIMIT = 250 * 1024 * 1024

export interface SavedDownload {
  path: string
  filename: string
  bytes: number
  mimeType: string | null
  sourceURL: string
}

/** Carpeta temporal de descargas de una cuenta (dentro de la caché de Aula; se limpia sola). */
export function platformDownloadsDir(accountId: string | null): string {
  const dir = join(paths.cache(), 'Platform Downloads', accountId ?? 'web')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Ruta de preparación única (`.part`) para una descarga en curso. */
export function stagingPath(): string {
  const dir = join(paths.cache(), 'Platform Downloads', '.staging')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, `${randomBytes(8).toString('hex')}.part`)
}

/** Primeros 512 bytes y últimos 512 (para reconocer programas e imágenes de disco). */
export function readHeadTail(file: string): { head: Uint8Array; tail: Uint8Array; size: number } {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const head = Buffer.alloc(Math.min(512, size))
    if (head.length) readSync(fd, head, 0, head.length, 0)
    let tail = new Uint8Array()
    if (size >= 512) {
      const t = Buffer.alloc(4)
      readSync(fd, t, 0, 4, size - 512)
      tail = t
    }
    return { head, tail, size }
  } finally {
    closeSync(fd)
  }
}

/**
 * Comprueba un archivo bajado: tamaño, que no sea un programa (por nombre, tipo o contenido) ni una página web cuando se
 * esperaba un archivo (casi siempre: hay que iniciar sesión). Lanza AulaError con un código estable.
 */
export function verifyDownloadedFile(file: string, opts: { filename: string; mimeType: string | null; maxBytes: number; requestedName?: string }): void {
  const { head, tail, size } = readHeadTail(file)
  if (size > opts.maxBytes) throw new AulaError('too_large', tr(
      `El archivo es demasiado grande (máximo ${Math.round(opts.maxBytes / 1048576)} MB).`,
      `The file is too large (maximum ${Math.round(opts.maxBytes / 1048576)} MB).`
    ))
  if (size === 0) throw new AulaError('download_failed', tr('El archivo llegó vacío.', 'The file arrived empty.'))
  if (isBlockedMime(opts.mimeType) || isExecutableContent(head, opts.filename, tail)) {
    throw new AulaError('download_blocked', tr('Por seguridad, Aula no guarda programas ni instaladores.', 'For security, Aula doesn’t save programs or installers.'))
  }
  if (looksLikeWebPage(opts.mimeType, head, opts.requestedName ?? opts.filename)) {
    throw new AulaError('needs_sign_in', tr('Llegó una página web en vez del archivo: probablemente hay que iniciar sesión.', 'A web page arrived instead of the file: you probably need to sign in.'))
  }
}

/** Mueve el archivo a `dir` sin sobrescribir («nombre (2).ext»…), con permisos 0644. Devuelve la ruta final. */
export function storeDownloadedFile(src: string, dir: string, rawName: string, mimeType: string | null): { path: string; filename: string } {
  mkdirSync(dir, { recursive: true })
  const name = ensureExtension(sanitizeFilename(rawName), mimeType)
  for (const candidate of uniqueNameCandidates(name)) {
    const dest = join(dir, candidate)
    try {
      // enlace duro = reserva atómica del nombre (falla si ya existe)
      linkSync(src, dest)
      unlinkSync(src)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') continue
      if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL' || code === 'ENOSYS') {
        try {
          copyFileSync(src, dest, constants.COPYFILE_EXCL)
          rmSync(src, { force: true })
        } catch (e2) {
          if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw new AulaError('download_failed', tr('No se pudo guardar el archivo.', 'Couldn’t save the file.'))
        }
      } else {
        throw new AulaError('download_failed', tr('No se pudo guardar el archivo.', 'Couldn’t save the file.'))
      }
    }
    try { chmodSync(dest, 0o644) } catch { /* sin importancia */ }
    return { path: dest, filename: candidate }
  }
  throw new AulaError('download_failed', tr('Demasiados archivos con el mismo nombre.', 'Too many files with the same name.'))
}

/** Borra descargas temporales antiguas (por defecto de más de 3 días) y restos de preparación. */
export function cleanupPlatformDownloads(maxAgeMs = 3 * 86_400_000, now = Date.now()): void {
  const root = join(paths.cache(), 'Platform Downloads')
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const sub of entries) {
    const dir = join(root, sub)
    let files: string[] = []
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      const p = join(dir, f)
      try {
        const st = statSync(p)
        const limit = sub === '.staging' ? 3600_000 : maxAgeMs
        if (now - st.mtimeMs > limit) rmSync(p, { force: true, recursive: true })
      } catch { /* sigue */ }
    }
  }
}
