// Descargas grandes y verificadas: a `<destino>.part` (se reanuda con `Range`), con tope de tamaño, plazo de inactividad,
// reintentos con retroceso y SHA-256 al terminar; solo entonces se renombra (port de `LocalAIKit/Download/Downloader.swift`).
// Cancelar (`signal`) deja el `.part` para continuar después. La red se inyecta (`fetch`): el proceso principal puede pasar la de
// Electron, que respeta el proxy del sistema.
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tr } from '@shared/ai/i18n'
import { writeFileAtomic } from '../fs'
import { AulaError } from '../errors'
import { CancelledError } from '../agents/errors'
import { freeSpace as defaultFreeSpace } from './hardware'

/** Un archivo que bajar: de dónde, adónde y cómo comprobarlo. */
export interface FileDownload {
  url: string
  destination: string
  bytes: number
  /** SHA-256 en minúsculas. Obligatorio salvo con `unverified` (p. ej. un paquete cuyo editor no publica la huella). */
  sha256?: string
  unverified?: boolean
}

export interface TransferProgress {
  bytesDone: number
  bytesTotal: number
  currentFile?: string
}

export function progressFraction(p: TransferProgress): number {
  return p.bytesTotal > 0 ? Math.min(1, Math.max(0, p.bytesDone / p.bytesTotal)) : 0
}

export type DownloadErrorKind = 'noSpace' | 'integrity' | 'http' | 'network' | 'missingChecksum' | 'write' | 'changed'

const GB = 1_073_741_824

function humanBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(1).replace('.', ',')} GB`
  if (n >= 1_048_576) return `${Math.round(n / 1_048_576)} MB`
  return `${Math.max(0, Math.round(n / 1024))} KB`
}

export class DownloadError extends AulaError {
  constructor(
    readonly kind: DownloadErrorKind,
    message: string,
    /** ¿Vale la pena reintentar? */
    readonly transient = false
  ) {
    super(kind === 'noSpace' ? 'local_no_space' : kind === 'network' ? 'local_network' : 'local_download', message)
    this.name = 'DownloadError'
  }

  static noSpace(needed: number, free: number): DownloadError {
    return new DownloadError('noSpace', tr(`No hay sitio en el disco: hacen falta ${humanBytes(needed)} y quedan ${humanBytes(free)}.`, `There’s not enough disk space: ${humanBytes(needed)} needed and ${humanBytes(free)} left.`))
  }
  static integrity(why: string, transient: boolean): DownloadError {
    return new DownloadError('integrity', tr(`La descarga llegó dañada (${why}). Vuelve a intentarlo.`, `The download arrived damaged (${why}). Try again.`), transient)
  }
  static http(status: number, file: string): DownloadError {
    return new DownloadError('http', tr(`El servidor respondió ${status} al pedir «${file}».`, `The server answered ${status} when asked for “${file}”.`), status >= 500 || status === 429)
  }
  static network(message: string): DownloadError {
    return new DownloadError('network', tr(`Problema de conexión: ${message}`, `Connection problem: ${message}`), true)
  }
  static missingChecksum(file: string): DownloadError {
    return new DownloadError('missingChecksum', tr(`«${file}» no publica su huella SHA-256: no lo descargo por seguridad.`, `“${file}” doesn’t publish its SHA-256 fingerprint, so I won’t download it, for security.`))
  }
  static write(message: string): DownloadError {
    return new DownloadError('write', tr(`No pude guardar el archivo: ${message}`, `I couldn’t save the file: ${message}`))
  }
  static changed(file: string): DownloadError {
    return new DownloadError('changed', tr(
        `«${file}» ya no es el archivo que comprobó Aula (quien lo publica lo ha cambiado), así que no lo descargo. Actualiza Aula o elige otro modelo.`,
        `“${file}” is no longer the file Aula checked (its publisher changed it), so I won’t download it. Update Aula or choose another model.`
      )
    )
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DownloaderOptions {
  attempts?: number
  retryDelayMs?: number
  idleTimeoutMs?: number
  /** Disco que la descarga deja libre para el resto del ordenador. */
  diskMargin?: number
  freeSpace?: (folder: string) => number | undefined
  userAgent?: string
  fetch?: FetchLike
  /** Hosts a los que se puede seguir una redirección sin https (pruebas con un servidor local). */
  insecureHosts?: string[]
}

const partPath = (f: FileDownload): string => f.destination + '.part'
const sidecarPath = (f: FileDownload): string => join(dirname(f.destination), '.' + basename(f.destination) + '.sha256')

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}

/** Entero y comprobado: tamaño exacto y el SHA-256 anotado al terminar coincide (no se rehace el hash de GB cada vez). */
export function isDownloadComplete(f: FileDownload): boolean {
  if (fileSize(f.destination) !== f.bytes) return false
  let noted: string
  try {
    noted = readFileSync(sidecarPath(f), 'utf8').trim()
  } catch {
    return false
  }
  return f.sha256 ? noted === f.sha256.toLowerCase() : /^[0-9a-f]{64}$/.test(noted)
}

/** SHA-256 de un archivo, a trozos. */
export function sha256OfFile(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, { highWaterMark: 8 * 1024 * 1024 })
    const onAbort = (): void => {
      stream.destroy(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    stream.on('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve(hash.digest('hex'))
    })
  })
}

/** SHA-256 que anuncia Hugging Face para el archivo que va a servir (`X-Linked-Etag`); `undefined` si no tiene esa forma. */
export function announcedSHA256(headers: Headers): string | undefined {
  const raw = headers.get('x-linked-etag')
  if (!raw) return undefined
  let v = raw.trim()
  if (v.startsWith('W/')) v = v.slice(2)
  v = v.replace(/^"+|"+$/g, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(v) ? v : undefined
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause
    const detail = cause instanceof Error ? cause.message : ''
    return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message
  }
  return String(err)
}

export class Downloader {
  readonly attempts: number
  readonly retryDelayMs: number
  readonly idleTimeoutMs: number
  readonly diskMargin: number
  private readonly freeSpace: (folder: string) => number | undefined
  private readonly userAgent: string
  private readonly fetchImpl: FetchLike
  private readonly insecureHosts: Set<string>

  constructor(options: DownloaderOptions = {}) {
    this.attempts = Math.max(1, options.attempts ?? 4)
    this.retryDelayMs = options.retryDelayMs ?? 2000
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000
    this.diskMargin = options.diskMargin ?? 2 * GB
    this.freeSpace = options.freeSpace ?? defaultFreeSpace
    this.userAgent = options.userAgent ?? `Aula/2.0 (local-ai; ${process.platform})`
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.insecureHosts = new Set(options.insecureHosts ?? [])
  }

  /** Baja los archivos que falten (los ya completos y comprobados no se piden otra vez). */
  async run(files: FileDownload[], progress: (p: TransferProgress) => void = () => undefined, signal?: AbortSignal): Promise<void> {
    for (const f of files) {
      if (!f.unverified && !/^[0-9a-fA-F]{64}$/.test(f.sha256 ?? '')) throw DownloadError.missingChecksum(basename(f.destination))
    }
    const total = files.reduce((s, f) => s + f.bytes, 0)
    const onDisk = (except?: FileDownload): number =>
      files.reduce((s, f) => (f === except ? s : s + (isDownloadComplete(f) ? f.bytes : Math.min(fileSize(partPath(f)) ?? 0, f.bytes))), 0)
    const missing = files.filter((f) => !isDownloadComplete(f))
    if (missing.length > 0) {
      if (signal?.aborted) throw new CancelledError()
      const partial = missing.reduce((s, f) => s + Math.min(fileSize(partPath(f)) ?? 0, f.bytes), 0)
      const needed = missing.reduce((s, f) => s + f.bytes, 0) - partial
      mkdirSync(dirname(missing[0].destination), { recursive: true })
      const free = this.freeSpace(dirname(missing[0].destination))
      if (free !== undefined && free < needed + this.diskMargin) throw DownloadError.noSpace(needed + this.diskMargin, free)
      // lo que ya hay, antes del primer byte: la interfaz pasa a «descargando» aunque el archivo llegue de una vez
      progress({ bytesDone: onDisk(), bytesTotal: total, currentFile: basename(missing[0].destination) })
      for (const f of missing) {
        mkdirSync(dirname(f.destination), { recursive: true })
        rmSync(f.destination, { force: true })
        for (let attempt = 1; ; attempt++) {
          if (signal?.aborted) throw new CancelledError()
          try {
            const others = onDisk(f)
            await this.fetchFile(f, (written) => progress({ bytesDone: others + written, bytesTotal: total, currentFile: basename(f.destination) }), signal)
            break
          } catch (err) {
            if (signal?.aborted) throw new CancelledError()
            const failure = err instanceof DownloadError ? err : DownloadError.network(errorText(err))
            if (!failure.transient || attempt >= this.attempts) throw failure
            const wait = this.retryDelayMs * Math.pow(2, attempt - 1)
            if (wait > 0) await sleep(wait, signal)
          }
        }
      }
    }
    progress({ bytesDone: onDisk(), bytesTotal: total })
  }

  // MARK: Un archivo

  private async fetchFile(f: FileDownload, onWritten: (written: number) => void, signal?: AbortSignal): Promise<void> {
    const part = partPath(f)
    let done = fileSize(part) ?? 0
    if (done > f.bytes) {
      rmSync(part, { force: true })
      done = 0
    }
    if (done < f.bytes) await this.stream(f, done, onWritten, signal)
    if (fileSize(part) !== f.bytes) throw DownloadError.integrity(tr('tamaño distinto del publicado', 'size differs from the published one'), true)
    const hash = await sha256OfFile(part, signal)
    if (f.sha256 && hash !== f.sha256.toLowerCase()) {
      rmSync(part, { force: true })
      throw DownloadError.integrity(tr('la huella SHA-256 no coincide', 'the SHA-256 fingerprint doesn’t match'), false)
    }
    try {
      rmSync(f.destination, { force: true })
      renameSync(part, f.destination)
      writeFileAtomic(sidecarPath(f), hash)
    } catch (err) {
      throw DownloadError.write(errorText(err))
    }
  }

  /** Sigue las redirecciones a mano (solo https; nunca reenvía credenciales) y comprueba la huella anunciada en cada salto. */
  private async open(f: FileDownload, offset: number, signal: AbortSignal): Promise<Response> {
    const name = basename(f.destination)
    let url = new URL(f.url)
    for (let hop = 0; hop < 10; hop++) {
      const headers: Record<string, string> = { 'user-agent': this.userAgent, 'accept-encoding': 'identity' }
      if (offset > 0) headers.range = `bytes=${offset}-`
      let res: Response
      try {
        res = await this.fetchImpl(url.toString(), { headers, redirect: 'manual', signal })
      } catch (err) {
        // una red que no admite redirecciones «a mano» (o un fallo pasajero): se pide otra vez dejando que las siga ella
        if (signal.aborted) throw err
        return this.fetchImpl(url.toString(), { headers, redirect: 'follow', signal })
      }
      if (res.type === 'opaqueredirect' || res.status === 0) {
        // la redirección no se deja ver: se sigue sola (la huella SHA-256 se comprueba igual al terminar)
        await res.body?.cancel().catch(() => undefined)
        return this.fetchImpl(url.toString(), { headers, redirect: 'follow', signal })
      }
      const announced = announcedSHA256(res.headers)
      if (announced && f.sha256 && announced !== f.sha256.toLowerCase()) {
        await res.body?.cancel().catch(() => undefined)
        throw DownloadError.changed(name)
      }
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined)
        const next = new URL(location, url)
        if (next.protocol !== 'https:' && !this.insecureHosts.has(next.hostname)) throw DownloadError.network(tr('el servidor redirigió a una dirección no segura', 'the server redirected to an insecure address'))
        url = next
        continue
      }
      return res
    }
    throw DownloadError.network(tr('demasiadas redirecciones', 'too many redirects'))
  }

  private async stream(f: FileDownload, start: number, onWritten: (written: number) => void, outer?: AbortSignal): Promise<void> {
    const part = partPath(f)
    const name = basename(f.destination)
    const controller = new AbortController()
    let idle = false
    const onOuter = (): void => controller.abort()
    if (outer?.aborted) throw new CancelledError()
    outer?.addEventListener('abort', onOuter, { once: true })
    let timer: NodeJS.Timeout | undefined
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        idle = true
        controller.abort()
      }, this.idleTimeoutMs)
    }
    let handle: FileHandle | undefined
    let written = start
    try {
      arm()
      let res: Response
      try {
        res = await this.open(f, start, controller.signal)
      } catch (err) {
        if (err instanceof DownloadError) throw err
        if (outer?.aborted) throw new CancelledError()
        throw DownloadError.network(idle ? tr('el servidor dejó de responder', 'the server stopped responding') : errorText(err))
      }
      let offset = start
      if (res.status === 206 && offset > 0) {
        const range = res.headers.get('content-range') ?? ''
        const from = /bytes\s+(\d+)-/.exec(range)?.[1]
        if (from !== String(offset)) {
          await res.body?.cancel().catch(() => undefined)
          rmSync(part, { force: true })
          throw DownloadError.integrity(tr('el servidor reanudó en otro punto', 'the server resumed at a different point'), true)
        }
      } else if (res.status === 200 || res.status === 206) {
        offset = 0
      } else if (res.status === 416) {
        await res.body?.cancel().catch(() => undefined)
        rmSync(part, { force: true })
        throw DownloadError.integrity(tr('el servidor no pudo reanudar', 'the server couldn’t resume'), true)
      } else {
        await res.body?.cancel().catch(() => undefined)
        throw DownloadError.http(res.status, name)
      }
      if (!res.body) throw DownloadError.network(tr('respuesta sin contenido', 'empty response'))
      try {
        handle = await open(part, offset > 0 ? 'a' : 'w')
      } catch (err) {
        throw DownloadError.write(errorText(err))
      }
      written = offset
      let lastReport = 0
      let pending: Buffer[] = []
      let pendingBytes = 0
      const flush = async (): Promise<void> => {
        if (pendingBytes === 0 || !handle) return
        const data = pending.length === 1 ? pending[0] : Buffer.concat(pending)
        pending = []
        pendingBytes = 0
        try {
          await handle.write(data)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          await handle.close().catch(() => undefined)
          handle = undefined
          if (code === 'ENOSPC' || code === 'EDQUOT') {
            rmSync(part, { force: true })
            throw DownloadError.noSpace(f.bytes - offset, defaultFreeSpace(dirname(part)) ?? 0)
          }
          throw DownloadError.write(errorText(err))
        }
      }
      const reader = res.body.getReader()
      try {
        for (;;) {
          let chunk: Awaited<ReturnType<typeof reader.read>>
          try {
            chunk = await reader.read()
          } catch (err) {
            // lo ya recibido se guarda: la próxima vez se reanuda desde ahí
            await flush().catch(() => undefined)
            if (outer?.aborted) throw new CancelledError()
            throw DownloadError.network(idle ? tr('el servidor dejó de enviar datos', 'the server stopped sending data') : errorText(err))
          }
          if (chunk.done) break
          arm()
          const bytes = chunk.value
          if (written + bytes.length > f.bytes) {
            await reader.cancel().catch(() => undefined)
            await handle?.close().catch(() => undefined)
            handle = undefined
            rmSync(part, { force: true })
            throw DownloadError.integrity(tr('más grande de lo publicado', 'larger than published'), false)
          }
          pending.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
          pendingBytes += bytes.length
          written += bytes.length
          if (pendingBytes >= 4 * 1024 * 1024) await flush()
          const now = Date.now()
          if (now - lastReport > 200 || written === f.bytes) {
            lastReport = now
            onWritten(written)
          }
        }
        await flush()
      } finally {
        reader.releaseLock()
      }
      onWritten(written)
    } finally {
      if (timer) clearTimeout(timer)
      outer?.removeEventListener('abort', onOuter)
      await handle?.sync().catch(() => undefined)
      await handle?.close().catch(() => undefined)
    }
  }
}

