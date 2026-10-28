// Descargas con la sesión de la cuenta (session 'will-download'): solo las que Aula pidió (una dirección o un clic aprobado);
// cualquier otra se cancela. Se bajan a una carpeta de preparación con tope de tamaño y de tiempo, se comprueba el tipo y el
// contenido (nada de programas; una página web en vez del archivo = hay que iniciar sesión) y se guardan sin sobrescribir.
import type { DownloadItem, Session, WebContents } from 'electron'
import { filenameFromURL, hasBlockedExtension, isBlockedMime } from '@engine/platforms'
import { AulaError } from '@main/services/errors'
import { tr } from '@shared/ai/i18n'
import { DEFAULT_DOWNLOAD_LIMIT, platformDownloadsDir, stagingPath, storeDownloadedFile, verifyDownloadedFile, type SavedDownload } from '@main/services/platforms/downloads'
import { log } from '@main/services/log'
import { rmSync } from 'node:fs'

export interface DownloadOptions {
  /** Carpeta de destino (por defecto, la temporal de la cuenta). */
  dir?: string
  maxBytes?: number
  timeoutMs?: number
}

interface Pending {
  accountId: string | null
  url?: string
  webContentsId?: number
  opts: Required<Pick<DownloadOptions, 'maxBytes' | 'timeoutMs'>> & { dir: string }
  resolve: (d: SavedDownload) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  item?: DownloadItem
}

function norm(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.toString()
  } catch {
    return url
  }
}

export class DownloadManager {
  private pending: Pending[] = []

  /** Descarga una dirección con la sesión (`session.downloadURL`). */
  download(ses: Session, accountId: string | null, url: string, opts: DownloadOptions = {}): Promise<SavedDownload> {
    const p = this.expect({ accountId, url: norm(url) }, opts)
    try {
      ses.downloadURL(url)
    } catch (err) {
      this.fail(p.entry, new AulaError('download_failed', 'No se pudo empezar la descarga.'))
    }
    return p.promise
  }

  /** Espera la descarga que provoque un clic aprobado en esa pestaña (o null si no llega en `graceMs`). */
  expectFromWebContents(webContentsId: number, accountId: string | null, opts: DownloadOptions = {}): { promise: Promise<SavedDownload>; cancel: () => void; started: () => boolean } {
    const p = this.expect({ accountId, webContentsId }, opts)
    return {
      promise: p.promise,
      cancel: () => {
        if (!p.entry.item) this.fail(p.entry, new AulaError('cancelled', 'Sin descarga'), true)
      },
      started: () => !!p.entry.item
    }
  }

  private expect(where: { accountId: string | null; url?: string; webContentsId?: number }, opts: DownloadOptions): { promise: Promise<SavedDownload>; entry: Pending } {
    let entry!: Pending
    const promise = new Promise<SavedDownload>((resolve, reject) => {
      const full = { dir: opts.dir ?? platformDownloadsDir(where.accountId), maxBytes: opts.maxBytes ?? DEFAULT_DOWNLOAD_LIMIT, timeoutMs: opts.timeoutMs ?? 180_000 }
      entry = {
        ...where, opts: full, resolve, reject,
        timer: setTimeout(() => this.fail(entry, new AulaError('timeout', tr('La descarga tardó demasiado.', 'The download took too long.'))), full.timeoutMs)
      }
      this.pending.push(entry)
    })
    promise.catch(() => { /* lo maneja quien llama */ })
    return { promise, entry }
  }

  private fail(p: Pending, err: Error, silent = false): void {
    if (!this.pending.includes(p)) return
    this.pending = this.pending.filter((x) => x !== p)
    clearTimeout(p.timer)
    try { if (p.item && p.item.getState() === 'progressing') p.item.cancel() } catch { /* nada */ }
    if (!silent) log.info(`[platforms] descarga fallida: ${err.message}`)
    p.reject(err)
  }

  /** Lo llama la sesión por cada descarga ('will-download'). */
  route(accountId: string | null, item: DownloadItem, wc: WebContents | undefined): void {
    const chain = item.getURLChain().map(norm)
    const first = chain[0] ?? norm(item.getURL())
    const p = this.pending.find((x) => !x.item && x.accountId === accountId && ((x.url && (x.url === first || chain.includes(x.url))) || (x.webContentsId != null && wc && x.webContentsId === wc.id)))
    if (!p) {
      // una descarga que Aula no pidió (p. ej. desde la ventana de inicio de sesión): no
      item.cancel()
      return
    }
    p.item = item
    const staging = stagingPath()
    item.setSavePath(staging)
    const name = item.getFilename() || filenameFromURL(first) || 'archivo'
    const mime = item.getMimeType() || null
    const total = item.getTotalBytes()
    if (total > p.opts.maxBytes) return this.fail(p, new AulaError('too_large', tr(
      `El archivo es demasiado grande (máximo ${Math.round(p.opts.maxBytes / 1048576)} MB).`,
      `The file is too large (maximum ${Math.round(p.opts.maxBytes / 1048576)} MB).`
    )))
    if (isBlockedMime(mime) || hasBlockedExtension(name)) return this.fail(p, new AulaError('download_blocked', 'Por seguridad, Aula no guarda programas ni instaladores.'))
    item.on('updated', () => {
      if (item.getReceivedBytes() > p.opts.maxBytes) this.fail(p, new AulaError('too_large', 'El archivo es demasiado grande.'))
    })
    item.once('done', (_e, state) => {
      if (!this.pending.includes(p)) {
        rmSync(staging, { force: true })
        return
      }
      this.pending = this.pending.filter((x) => x !== p)
      clearTimeout(p.timer)
      if (state !== 'completed') {
        rmSync(staging, { force: true })
        p.reject(new AulaError('download_failed', state === 'cancelled' ? tr('Se canceló la descarga.', 'The download was cancelled.') : tr('Se cortó la descarga.', 'The download was cut off.')))
        return
      }
      try {
        verifyDownloadedFile(staging, { filename: name, mimeType: mime, maxBytes: p.opts.maxBytes, requestedName: filenameFromURL(first) ?? undefined })
        const stored = storeDownloadedFile(staging, p.opts.dir, name, mime)
        p.resolve({ path: stored.path, filename: stored.filename, bytes: item.getReceivedBytes(), mimeType: mime, sourceURL: first })
      } catch (err) {
        rmSync(staging, { force: true })
        p.reject(err instanceof Error ? err : new AulaError('download_failed', 'No se pudo guardar el archivo.'))
      }
    })
  }

  cancelAll(): void {
    for (const p of [...this.pending]) this.fail(p, new AulaError('cancelled', 'Cancelado'), true)
  }
}
