// Descompresión SEGURA de los paquetes del motor (`.zip` y `.tar.gz`) en una carpeta nueva y vacía, sin programas externos:
// se rechazan rutas absolutas, «..» y enlaces que apunten fuera del paquete (lo que en Swift hacían `tar`/`ditto` más
// `symlinkEscaping`). Solo archivos normales, carpetas y enlaces simbólicos internos.
import { constants, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { tr } from '@shared/ai/i18n'
import JSZip from 'jszip'
import { AulaError } from '../errors'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class ArchiveError extends AulaError {
  constructor(message: string) {
    super('local_engine_archive', tr(`El paquete del motor no es válido: ${message}`, `The engine package isn’t valid: ${message}`))
    this.name = 'ArchiveError'
  }
}

/** Ruta interna limpia («a/b/c») o `undefined` si sale del paquete o es absoluta. */
export function safeEntryPath(raw: string): string | undefined {
  const name = raw.replace(/\\/g, '/')
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\0')) return undefined
  const parts: string[] = []
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return undefined
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : undefined
}

/** ¿El destino de un enlace (relativo a la carpeta del enlace) se queda dentro del paquete? */
export function symlinkStaysInside(entry: string, target: string): boolean {
  if (!target || target.startsWith('/') || /^[A-Za-z]:/.test(target) || target.includes('\\')) return false
  const resolved = posix.normalize(posix.join(posix.dirname(entry), target))
  return resolved !== '..' && !resolved.startsWith('../') && !posix.isAbsolute(resolved)
}

interface Entry {
  path: string
  type: 'file' | 'dir' | 'symlink' | 'hardlink'
  mode: number
  data?: Uint8Array
  link?: string
}

function inside(root: string, rel: string): string {
  const full = resolve(root, ...rel.split('/'))
  if (full !== root && !full.startsWith(root + sep)) throw new ArchiveError(tr(`ruta fuera del paquete: ${rel}`, `path outside the package: ${rel}`))
  return full
}

/**
 * Ningún trozo de la ruta (las carpetas por las que pasa y, si ya existe, el propio destino) puede ser un enlace
 * simbólico: escribir «a través» de un enlace del propio paquete es como salen las entradas encadenadas
 * («p -> .», «p/q -> ..», «q/x»…) fuera de la carpeta (J3-6). Las carpetas reales que faltan las crea `mkdir` después.
 */
function assertNoLinkOnPath(base: string, rel: string): void {
  let current = base
  for (const part of rel.split('/')) {
    current = join(current, part)
    let st
    try {
      st = lstatSync(current)
    } catch {
      return // aún no existe: el resto tampoco
    }
    if (st.isSymbolicLink()) throw new ArchiveError(tr(`ruta que pasa por un enlace: ${rel}`, `path that goes through a link: ${rel}`))
  }
}

/** Tras crear las carpetas, la carpeta real del destino sigue dentro del paquete (segunda comprobación). */
function assertRealParentInside(realBase: string, target: string, rel: string): void {
  const parent = realpathSync(dirname(target))
  if (parent !== realBase && !parent.startsWith(realBase + sep)) throw new ArchiveError(tr(`ruta fuera del paquete: ${rel}`, `path outside the package: ${rel}`))
}

/**
 * El destino de un enlace simbólico, recorrido desde su carpeta: puede subir («..») solo al principio y nunca puede pasar
 * por otro enlace del paquete (un enlace a «.» haría que «d/../..» saliera aunque el texto parezca quedarse dentro).
 */
function symlinkTargetIsSafe(entry: string, target: string, links: ReadonlySet<string>): boolean {
  if (!symlinkStaysInside(entry, target)) return false
  const parts = target.split('/').filter((p) => p !== '' && p !== '.')
  let i = 0
  while (i < parts.length && parts[i] === '..') i++
  if (parts.slice(i).includes('..')) return false
  const dir = posix.dirname(entry)
  const up = dir === '.' ? [] : dir.split('/')
  if (i > up.length) return false
  const walked = up.slice(0, up.length - i)
  // las carpetas intermedias del destino (no el último trozo) no pueden ser enlaces
  for (const part of parts.slice(i, -1)) {
    walked.push(part)
    if (links.has(walked.join('/'))) return false
  }
  return true
}

function writeEntries(root: string, entries: Entry[]): number {
  const base = resolve(root)
  mkdirSync(base, { recursive: true })
  const realBase = realpathSync(base)
  let count = 0
  const links = new Set(entries.filter((e) => e.type === 'symlink').map((e) => e.path))
  const seen = new Set<string>()
  // primero carpetas y archivos; los enlaces al final (pueden apuntar a archivos aún no escritos)
  const ordered = [...entries.filter((e) => e.type === 'dir' || e.type === 'file'), ...entries.filter((e) => e.type === 'symlink' || e.type === 'hardlink')]
  for (const entry of ordered) {
    const target = inside(base, entry.path)
    // la misma ruta dos veces (p. ej. un archivo y luego un enlace con su nombre): no se sobrescribe nada
    if (entry.type !== 'dir' && seen.has(entry.path)) throw new ArchiveError(tr(`entrada repetida: ${entry.path}`, `repeated entry: ${entry.path}`))
    seen.add(entry.path)
    assertNoLinkOnPath(base, entry.path)
    if (entry.type === 'dir') {
      mkdirSync(target, { recursive: true })
      assertRealParentInside(realBase, join(target, '.'), entry.path)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    assertRealParentInside(realBase, target, entry.path)
    if (entry.type === 'file') {
      writeFileSync(target, entry.data ?? new Uint8Array(), { mode: (entry.mode & 0o777) | 0o600, flag: 'wx' })
      try {
        chmodSync(target, (entry.mode & 0o777) | 0o600)
      } catch {
        /* Windows */
      }
    } else if (entry.type === 'symlink') {
      if (!entry.link || !symlinkTargetIsSafe(entry.path, entry.link, links)) throw new ArchiveError(tr(`enlace fuera del paquete: ${entry.path}`, `link outside the package: ${entry.path}`))
      if (process.platform === 'win32') {
        // en Windows un enlace simbólico pide permisos: se copia el archivo (ya escrito y real, dentro del paquete)
        const source = posix.normalize(posix.join(posix.dirname(entry.path), entry.link))
        assertNoLinkOnPath(base, source)
        copyFileSync(realInside(realBase, inside(base, source), source), target, constants.COPYFILE_EXCL)
      } else {
        symlinkSync(entry.link, target)
      }
    } else {
      const source = entry.link ? safeEntryPath(entry.link) : undefined
      if (!source) throw new ArchiveError(tr(`enlace fuera del paquete: ${entry.path}`, `link outside the package: ${entry.path}`))
      assertNoLinkOnPath(base, source)
      copyFileSync(realInside(realBase, inside(base, source), source), target, constants.COPYFILE_EXCL)
    }
    count += 1
  }
  return count
}

/** La ruta real de un origen (siguiendo enlaces) si sigue dentro del paquete. */
function realInside(realBase: string, full: string, rel: string): string {
  let real: string
  try {
    real = realpathSync(full)
  } catch {
    throw new ArchiveError(tr(`el enlace apunta a algo que no está en el paquete: ${rel}`, `the link points to something outside the package: ${rel}`))
  }
  if (!real.startsWith(realBase + sep)) throw new ArchiveError(tr(`enlace fuera del paquete: ${rel}`, `link outside the package: ${rel}`))
  return real
}

// MARK: tar

function cString(buf: Uint8Array, start: number, length: number): string {
  let end = start
  while (end < start + length && buf[end] !== 0) end++
  return Buffer.from(buf.subarray(start, end)).toString('utf8')
}

function octal(buf: Uint8Array, start: number, length: number): number {
  // base 256 (GNU) si el primer byte tiene el bit alto
  if (buf[start] & 0x80) {
    let n = 0
    for (let i = start + 1; i < start + length; i++) n = n * 256 + buf[i]
    return n
  }
  const text = cString(buf, start, length).trim()
  return text ? parseInt(text, 8) : 0
}

function paxRecords(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  const text = Buffer.from(data).toString('utf8')
  let i = 0
  while (i < text.length) {
    const space = text.indexOf(' ', i)
    if (space < 0) break
    const len = Number(text.slice(i, space))
    if (!Number.isFinite(len) || len <= 0) break
    const record = text.slice(space + 1, i + len - 1)
    const eq = record.indexOf('=')
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1)
    i += len
  }
  return out
}

/** Entradas de un archivo tar (ustar, pax y nombres largos de GNU). */
export function parseTar(tar: Uint8Array): Entry[] {
  const entries: Entry[] = []
  let offset = 0
  let pax: Record<string, string> = {}
  let longName: string | undefined
  let longLink: string | undefined
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 48)
    const dataStart = offset + 512
    if (!Number.isSafeInteger(size) || size < 0 || dataStart + size > tar.length) throw new ArchiveError(tr('tar incompleto', 'incomplete tar'))
    const data = tar.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / 512) * 512
    if (type === 'x') {
      pax = paxRecords(data)
      continue
    }
    if (type === 'g') continue
    if (type === 'L') {
      longName = cString(data, 0, data.length)
      continue
    }
    if (type === 'K') {
      longLink = cString(data, 0, data.length)
      continue
    }
    const magic = cString(header, 257, 6)
    const prefix = magic.startsWith('ustar') ? cString(header, 345, 155) : ''
    const rawName = pax.path ?? longName ?? (prefix ? `${prefix}/${cString(header, 0, 100)}` : cString(header, 0, 100))
    const rawLink = pax.linkpath ?? longLink ?? cString(header, 157, 100)
    pax = {}
    longName = undefined
    longLink = undefined
    const path = safeEntryPath(rawName)
    if (!path) {
      if (/^(\.\/?)+$/.test(rawName)) continue // «./» (la raíz del paquete)
      throw new ArchiveError(tr(`ruta no permitida: ${rawName}`, `path not allowed: ${rawName}`))
    }
    const mode = octal(header, 100, 8)
    if (type === '0' || type === '\0' || type === '7') entries.push({ path, type: 'file', mode, data })
    else if (type === '5') entries.push({ path, type: 'dir', mode })
    else if (type === '2') entries.push({ path, type: 'symlink', mode, link: rawLink })
    else if (type === '1') entries.push({ path, type: 'hardlink', mode, link: rawLink })
    // otros tipos (dispositivos, FIFOs…) se ignoran
  }
  return entries
}

// MARK: zip

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

async function zipEntries(data: Uint8Array): Promise<Entry[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch (err) {
    throw new ArchiveError(tr(`zip ilegible (${errorMessage(err)})`, `unreadable zip (${errorMessage(err)})`))
  }
  const entries: Entry[] = []
  for (const file of Object.values(zip.files)) {
    const raw = file.unsafeOriginalName ?? file.name
    const path = safeEntryPath(raw)
    if (!path) throw new ArchiveError(tr(`ruta no permitida: ${raw}`, `path not allowed: ${raw}`))
    const unix = typeof file.unixPermissions === 'number' ? file.unixPermissions : typeof file.unixPermissions === 'string' ? parseInt(file.unixPermissions, 8) : 0
    if (file.dir) {
      entries.push({ path, type: 'dir', mode: 0o755 })
      continue
    }
    const content = await file.async('uint8array')
    if ((unix & S_IFMT) === S_IFLNK) entries.push({ path, type: 'symlink', mode: 0o777, link: Buffer.from(content).toString('utf8') })
    else entries.push({ path, type: 'file', mode: unix & 0o777 ? unix & 0o777 : 0o644, data: content })
  }
  return entries
}

// MARK: Entrada

/** Descomprime `archive` (`.zip`, `.tar.gz`/`.tgz` o `.tar`) en `destination`. Devuelve cuántos archivos y enlaces escribió. */
export async function extractArchive(archive: string, destination: string): Promise<number> {
  if (!isAbsolute(destination)) throw new ArchiveError(tr('destino relativo', 'relative destination'))
  const lower = archive.toLowerCase()
  const raw = await readFile(archive)
  let entries: Entry[]
  if (lower.endsWith('.zip')) entries = await zipEntries(raw)
  else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    let tar: Buffer
    try {
      tar = await promisify(gunzip)(raw)
    } catch {
      throw new ArchiveError(tr('gzip ilegible', 'unreadable gzip'))
    }
    entries = parseTar(tar)
  } else if (lower.endsWith('.tar')) entries = parseTar(raw)
  else throw new ArchiveError(tr(`formato desconocido: ${archive}`, `unknown format: ${archive}`))
  if (entries.length === 0) throw new ArchiveError(tr('está vacío', 'it’s empty'))
  return writeEntries(destination, entries)
}

/** Lee el marcador `.installed` (ruta relativa del ejecutable) de una carpeta. */
export function readMarker(folder: string): string | undefined {
  try {
    const rel = readFileSync(join(folder, '.installed'), 'utf8').trim()
    return rel || undefined
  } catch {
    return undefined
  }
}
