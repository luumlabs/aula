// Archivos que el estudiante elige en su iPad o iPhone. Allí la interfaz no tiene rutas del Mac: el puente sube el archivo
// (`PUT /upload/<id>`) y a la app le da una dirección `aula-upload://<id>/<nombre>`; al llegar una llamada, esas
// direcciones se cambian por la ruta de la copia en el Mac, que queda apuntada como «archivo dado por el estudiante».
// Las copias viven en una carpeta temporal (fuera de la carpeta de datos) y se borran a los pocos días. Sin Electron.
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

export const UPLOAD_SCHEME = 'aula-upload://'
const ID = /^[0-9a-f]{32}$/
const REF = /^aula-upload:\/\/([0-9a-f]{32})\//
/** Una clase grabada en vídeo puede pesar: hasta 4 GB por archivo. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
const KEEP_MS = 7 * 86_400_000

export class UploadError extends Error {
  constructor(readonly code: 'invalid' | 'tooBig' | 'failed') { super(code) }
}

/** Nombre de archivo seguro: sin carpetas, sin caracteres de control, sin punto inicial; conserva la extensión. */
export function safeUploadName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim().slice(-160)
  return clean || 'archivo'
}

export class UploadStore {
  constructor(private readonly dir: string, private readonly opts: { maxBytes?: number; grant?: (path: string) => boolean } = {}) {}

  private folder(deviceId: string, id: string): string { return join(this.dir, deviceId, id) }

  /** Guarda lo que sube un dispositivo. Devuelve la ruta de la copia. */
  async receive(deviceId: string, id: string, name: string, body: Readable): Promise<string> {
    if (!ID.test(id) || !/^[0-9a-f]{6,32}$/.test(deviceId)) throw new UploadError('invalid')
    const folder = this.folder(deviceId, id)
    if (existsSync(folder)) throw new UploadError('invalid') // cada identificador, una sola vez
    mkdirSync(folder, { recursive: true })
    const path = join(folder, safeUploadName(name))
    const max = this.opts.maxBytes ?? MAX_UPLOAD_BYTES
    try {
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(path, { flags: 'wx' })
        let size = 0
        let failed = false
        // al fallar se suelta el archivo y se espera a que el sistema lo cierre: borrar la carpeta mientras aún se está
        // abriendo dejaba, a veces, el archivo a medias dentro (y el borrado fallaba)
        const fail = (code: UploadError['code']): void => {
          if (failed) return
          failed = true
          body.unpipe(out)
          const done = (): void => reject(new UploadError(code))
          if (out.closed) done()
          else { out.once('close', done); out.destroy() }
        }
        body.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > max) fail('tooBig')
        })
        body.on('error', () => fail('failed'))
        body.on('aborted', () => fail('failed'))
        out.on('error', () => fail('failed'))
        out.on('finish', () => { if (!failed) resolve() })
        body.pipe(out)
      })
    } catch (err) {
      rmSync(folder, { recursive: true, force: true, maxRetries: 3 })
      throw err
    }
    this.opts.grant?.(path)
    return path
  }

  /** La copia de una dirección `aula-upload://…` de ESTE dispositivo (undefined si no existe). */
  pathOf(deviceId: string, ref: string): string | undefined {
    const m = REF.exec(ref)
    if (!m) return undefined
    const folder = this.folder(deviceId, m[1])
    try {
      const [file] = readdirSync(folder)
      return file ? join(folder, file) : undefined
    } catch { return undefined }
  }

  /** Cambia, en los argumentos de una llamada, las direcciones de subida por sus rutas (en cualquier nivel). */
  resolve(deviceId: string, value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return value.startsWith(UPLOAD_SCHEME) ? this.pathOf(deviceId, value) ?? value : value
    if (depth > 8 || value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((v) => this.resolve(deviceId, v, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = this.resolve(deviceId, v, depth + 1)
    return out
  }

  /** Borra las copias viejas (y todas las de un dispositivo retirado, con `deviceId`). */
  sweep(now = Date.now(), deviceId?: string): void {
    if (deviceId) { rmSync(join(this.dir, deviceId), { recursive: true, force: true }); return }
    let devices: string[]
    try { devices = readdirSync(this.dir) } catch { return }
    for (const d of devices) {
      let ids: string[]
      try { ids = readdirSync(join(this.dir, d)) } catch { continue }
      for (const id of ids) {
        try { if (now - statSync(join(this.dir, d, id)).mtimeMs > KEEP_MS) rmSync(join(this.dir, d, id), { recursive: true, force: true }) } catch { /* ya no está */ }
      }
    }
  }
}
