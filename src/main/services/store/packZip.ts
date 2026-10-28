// `.aulapack` (un ZIP con la carpeta del curso como raíz, como `ditto -c -k --keepParent`), con JSZip. Port de
// StudyModel/PackZip.swift.
//
// Seguridad del lector: nada se escribe fuera de la carpeta de destino («zip slip»: se rechazan rutas absolutas, «\» y «..»),
// no se crean enlaces simbólicos y hay límites de entradas y de bytes descomprimidos (contra bombas zip).
import { closeSync, createReadStream, createWriteStream, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import JSZip from 'jszip'
import { tr } from '@shared/ai/i18n'

export interface ZipLimits {
  /** Nombres de Windows (por defecto, en Windows): «a:b» (flujo NTFS), «CON», «nul.txt», punto o espacio final → «_». */
  windowsNames?: boolean
  maxEntries: number
  /** Bytes descomprimidos en total (se cuentan al descomprimir, no por lo que declara el ZIP). */
  maxTotalBytes: number
  /** Tamaño del archivo comprimido (se lee entero en memoria). */
  maxArchiveBytes?: number
}

// A2-P1-4: el archivo se lee entero en memoria; 512 MiB bastan para un curso con sus PDF (antes, 1 GiB)
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 20_000, maxTotalBytes: 1024 * 1024 * 1024, maxArchiveBytes: 512 * 1024 * 1024 }

export class PackZipError extends Error {
  constructor(readonly code: 'not_zip' | 'unsafe_path' | 'too_large' | 'corrupt' | 'unsupported', message: string) {
    super(message)
    this.name = 'PackZipError'
  }
}

/** Basura de macOS al comprimir desde el Finder. */
function isJunk(name: string): boolean {
  const last = name.split('/').filter(Boolean).pop() ?? ''
  return name.startsWith('__MACOSX/') || last.startsWith('._') || last === '.DS_Store'
}

/**
 * Comprime la carpeta `directory` (con ella como raíz del ZIP) en `destination`. `include(rel, isDir)` decide qué entra
 * (rutas relativas a la carpeta, con «/»). Los enlaces simbólicos nunca entran. Se escribe por trozos: cada archivo se abre
 * cuando le toca y el ZIP va a un temporal junto al destino (que se renombra al terminar), sin tenerlo todo en memoria.
 */
export async function zipDirectory(directory: string, destination: string, include: (rel: string, isDir: boolean) => boolean = () => true): Promise<void> {
  const zip = new JSZip()
  const rootName = directory.split(sep).filter(Boolean).pop() ?? 'curso'
  const top = zip.folder(rootName)!
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const rel = relative(directory, full).split(sep).join('/')
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (!include(rel, true)) continue
        top.folder(rel)
        walk(full)
      } else if (st.isFile()) {
        if (!include(rel, false)) continue
        // vacío: JSZip lo guarda tal cual; si no, un flujo perezoso (el archivo no se abre hasta que se comprime)
        top.file(rel, st.size === 0 ? new Uint8Array(0) : lazyFile(full), { date: st.mtime, binary: true })
      }
    }
  }
  walk(directory)
  mkdirSync(dirname(destination), { recursive: true })
  const tmp = join(dirname(destination), `.${basename(destination)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    const out = zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' })
    await pipeline(out, createWriteStream(tmp))
    renameSync(tmp, destination)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* nada */ }
    throw err
  }
}

/** Un flujo que abre el archivo solo cuando se empieza a leer (con miles de archivos no se agotan los descriptores). */
function lazyFile(path: string): Readable {
  async function* chunks(): AsyncGenerator<Buffer> {
    for await (const chunk of createReadStream(path)) yield chunk as Buffer
  }
  return Readable.from(chunks(), { objectMode: false })
}

function tooLargeText(): string {
  return tr('El curso es demasiado grande para importarlo.', 'The course is too large to import.')
}

/** Reservados de Windows (con o sin extensión): CON, PRN, AUX, NUL, COM1…9, LPT1…9. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i

/**
 * Un componente que en Windows no significa lo que parece (A2-P2-19): «foto.png:evil» escribe un flujo alternativo de NTFS,
 * «CON» o «nul.txt» son dispositivos y «a.» o «b » pierden el final. Se cambia por uno inofensivo (con «_»).
 */
export function windowsSafeComponent(part: string): string {
  let p = part.replace(/[:<>"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, (m) => '_'.repeat(m.length))
  if (WINDOWS_RESERVED.test(p)) p = '_' + p
  return p
}

function unsafePathText(name: string): string {
  return tr(`El archivo contiene una ruta no permitida: ${name}`, `The file contains a path that isn’t allowed: ${name}`)
}

const SIG_CENTRAL = Buffer.from([0x50, 0x4b, 0x01, 0x02])
const SIG_EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06])
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_EOCD64 = 0x06064b50

/** Entradas que declara el registro final del ZIP (EOCD, o el de ZIP64). undefined si no se encuentra. */
async function declaredEntries(path: string, size: number): Promise<number | undefined> {
  const tail = Math.min(size, 65_535 + 22 + 20)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(tail)
    await fh.read(buf, 0, tail, size - tail)
    const at = buf.lastIndexOf(SIG_EOCD)
    if (at < 0 || at + 22 > buf.length) return undefined
    const count = buf.readUInt16LE(at + 10)
    if (count !== 0xffff) return count
    // ZIP64: el localizador va justo antes del EOCD y apunta al registro final de 64 bits
    if (at < 20 || buf.readUInt32LE(at - 20) !== SIG_EOCD64_LOCATOR) return Number.MAX_SAFE_INTEGER
    const offset = Number(buf.readBigUInt64LE(at - 20 + 8))
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 56 > size) return Number.MAX_SAFE_INTEGER
    const rec = Buffer.alloc(56)
    await fh.read(rec, 0, 56, offset)
    if (rec.readUInt32LE(0) !== SIG_EOCD64) return Number.MAX_SAFE_INTEGER
    const n = Number(rec.readBigUInt64LE(32))
    return Number.isSafeInteger(n) ? n : Number.MAX_SAFE_INTEGER
  } finally {
    await fh.close()
  }
}

/**
 * Cuántas firmas de entrada del directorio central («PK\x01\x02») hay en el archivo, leyéndolo por trozos sin cargarlo
 * (para en `stopAfter + 1`). JSZip crea una entrada por cada registro que encuentra seguido, aunque el EOCD diga otra cosa: el
 * número de firmas es un tope de lo que puede llegar a montar en memoria.
 */
export async function countCentralRecords(path: string, stopAfter: number): Promise<number> {
  const fh = await open(path, 'r')
  const CHUNK = 8 * 1024 * 1024
  const buf = Buffer.alloc(CHUNK + 3)
  let carry = 0
  let pos = 0
  let count = 0
  try {
    for (;;) {
      const { bytesRead } = await fh.read(buf, carry, CHUNK, pos)
      if (bytesRead === 0) break
      pos += bytesRead
      const end = carry + bytesRead
      const view = buf.subarray(0, end)
      for (let i = view.indexOf(SIG_CENTRAL); i >= 0; i = view.indexOf(SIG_CENTRAL, i + 1)) {
        if (++count > stopAfter) return count
      }
      // los 3 últimos bytes pasan al siguiente trozo (una firma partida entre dos trozos)
      carry = Math.min(3, end)
      buf.copy(buf, 0, end - carry, end)
    }
    return count
  } finally {
    await fh.close()
  }
}

/** Extrae `archive` dentro de `destination` (que debe existir). Lanza `PackZipError` si el archivo es hostil o no es un ZIP. */
export async function extractZip(archive: string, destination: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<void> {
  const maxArchive = limits.maxArchiveBytes ?? DEFAULT_ZIP_LIMITS.maxArchiveBytes ?? Infinity
  const size = statSync(archive).size
  if (size > maxArchive) throw new PackZipError('too_large', tooLargeText())
  // A2-P1-4: antes de que JSZip monte el índice entero en memoria (millones de entradas = V8 sin memoria), se cuentan las
  // entradas sin cargar el archivo: lo que declara el final del ZIP y las firmas que hay de verdad
  const declaredCount = await declaredEntries(archive, size)
  if (declaredCount !== undefined && declaredCount > limits.maxEntries) throw new PackZipError('too_large', tooLargeText())
  if ((await countCentralRecords(archive, limits.maxEntries)) > limits.maxEntries) throw new PackZipError('too_large', tooLargeText())
  const data = readFileSync(archive)
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data, { createFolders: false })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new PackZipError('not_zip', tr(`El archivo no es un curso de Aula válido (no es un ZIP): ${reason}`, `The file isn’t a valid Aula course (it isn’t a ZIP): ${reason}`))
  }
  const entries = Object.values(zip.files)
  if (entries.length > limits.maxEntries) throw new PackZipError('too_large', tooLargeText())
  // primero se comprueba todo (rutas y tamaños declarados); después se escribe
  const plan: Array<{ entry: JSZip.JSZipObject; parts: string[] }> = []
  const windows = limits.windowsNames ?? process.platform === 'win32'
  // «pack.json» y «PACK.JSON» son el mismo archivo en macOS y Windows: el segundo pisaba al primero sin avisar (A2-P2-19)
  const seen = new Set<string>()
  let declared = 0
  for (const entry of entries) {
    const name = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
    if (isJunk(name)) continue
    const parts = name.split('/').filter((p) => p !== '')
    if (name.startsWith('/') || name.includes('\\') || parts.includes('..') || parts.includes('.') || !parts.length || /^[A-Za-z]:/.test(name) || name.includes('\0')) {
      throw new PackZipError('unsafe_path', unsafePathText(name))
    }
    if (windows) for (let i = 0; i < parts.length; i++) parts[i] = windowsSafeComponent(parts[i])
    const key = parts.join('/').normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new PackZipError('unsafe_path', tr(`El archivo contiene dos entradas con el mismo nombre: ${name}`, `The file contains two entries with the same name: ${name}`))
    seen.add(key)
    // enlaces simbólicos (permisos Unix S_IFLNK): no se crean
    const mode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0
    if ((mode & 0o170000) === 0o120000) continue
    if (!entry.dir) {
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
      if (typeof size === 'number') declared += size
      if (declared > limits.maxTotalBytes) throw new PackZipError('too_large', tooLargeText())
    }
    plan.push({ entry, parts })
  }
  let total = 0
  for (const { entry, parts } of plan) {
    const target = join(destination, ...parts)
    if (!(target + sep).startsWith(join(destination) + sep) || target === join(destination)) throw new PackZipError('unsafe_path', unsafePathText(entry.name))
    if (entry.dir) { mkdirSync(target, { recursive: true }); continue }
    // se descomprime por trozos directo al disco con un tope que corta en cuanto se pasa (A2-P2-12: antes cada entrada se
    // juntaba entera en memoria y se copiaba; una bomba de 900 MB costaba casi 2 GB)
    mkdirSync(join(target, '..'), { recursive: true })
    total += await writeCapped(entry, target, limits.maxTotalBytes - total)
  }
}

interface ZipStream {
  on(event: 'data', fn: (chunk: Uint8Array) => void): ZipStream
  on(event: 'error', fn: (err: Error) => void): ZipStream
  on(event: 'end', fn: () => void): ZipStream
  resume(): ZipStream
  pause(): ZipStream
}

/** Descomprime una entrada por trozos a un temporal junto a `target` (que se renombra al terminar); si pasa de `cap` bytes, para,
 * borra el temporal y lanza `too_large`. Devuelve los bytes escritos. */
function writeCapped(entry: JSZip.JSZipObject, target: string, cap: number): Promise<number> {
  const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(4).toString('hex')}.tmp`)
  const fd = openSync(tmp, 'w', 0o600)
  return new Promise<number>((resolve, reject) => {
    let size = 0
    let settled = false
    const cleanup = (): void => {
      try { closeSync(fd) } catch { /* ya cerrado */ }
      try { rmSync(tmp, { force: true }) } catch { /* nada */ }
    }
    const fail = (err: PackZipError): void => {
      if (settled) return
      settled = true
      try { helper.pause() } catch { /* ya parado */ }
      cleanup()
      reject(err)
    }
    // `internalStream` existe en JSZip 3 aunque sus tipos no lo declaren
    const helper = (entry as unknown as { internalStream(type: 'uint8array'): ZipStream }).internalStream('uint8array')
    helper
      .on('data', (chunk: Uint8Array) => {
        if (settled) return
        size += chunk.length
        if (size > cap) return fail(new PackZipError('too_large', tooLargeText()))
        try {
          let at = 0
          while (at < chunk.length) at += writeSync(fd, chunk, at, chunk.length - at)
        } catch (err) {
          fail(new PackZipError('corrupt', tr(`No se pudo escribir ${entry.name}: ${err instanceof Error ? err.message : String(err)}`, `Couldn’t write ${entry.name}: ${err instanceof Error ? err.message : String(err)}`)))
        }
      })
      .on('error', (err: Error) => fail(new PackZipError('corrupt', tr(`El archivo del curso está dañado (${entry.name}): ${err.message}`, `The course file is damaged (${entry.name}): ${err.message}`))))
      .on('end', () => {
        if (settled) return
        settled = true
        try {
          fsyncSync(fd)
          closeSync(fd)
          renameSync(tmp, target)
          resolve(size)
        } catch (err) {
          cleanup()
          reject(new PackZipError('corrupt', tr(`No se pudo escribir ${entry.name}: ${err instanceof Error ? err.message : String(err)}`, `Couldn’t write ${entry.name}: ${err instanceof Error ? err.message : String(err)}`)))
        }
      })
      .resume()
  })
}
