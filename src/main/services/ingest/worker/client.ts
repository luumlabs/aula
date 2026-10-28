// Lado del proceso principal: manda las lecturas al proceso de lectura (como mucho `concurrency` a la vez, el resto en
// cola), lo arranca al primer uso y lo cierra si no se usa, lo vuelve a arrancar si se cae (las lecturas en curso fallan
// con un error claro), reenvía la cancelación y responde a sus peticiones de dibujo de páginas.
import type { IngestInput, PageRasterizer, SourceDocument } from '@shared/ingest'
import { CancelledError, IngestError } from '../errors'
import { L } from '../messages'
import { defaultOptions, type IngestOptions } from '../options'
import type { IngestRunner } from '../runner'
import { isFromWorker, rebuildError, toWireOptions, type FromWorker, type LogLevel, type RasterRequest, type ToWorker, type WorkerSettings } from './protocol'

/** Un proceso de lectura vivo (en Electron, un `UtilityProcess`; en las pruebas, uno en memoria). */
export interface WorkerProcess {
  post(message: ToWorker): void
  onMessage(handler: (message: unknown) => void): void
  onExit(handler: (code: number) => void): void
  kill(): void
}

type Reader = (input: IngestInput, options: Partial<IngestOptions>) => Promise<SourceDocument>

export interface IngestWorkerClientOptions {
  /** Arranca un proceso de lectura. */
  spawn: () => WorkerProcess
  /** Ajustes que se le pasan (idioma de la interfaz, caché del OCR); se reenvían si cambian. */
  settings: () => WorkerSettings
  /** Lecturas a la vez (por defecto, 2). */
  concurrency?: number
  /** Se cierra tras este tiempo sin lecturas (por defecto, 3 min; 0 = nunca). */
  idleMs?: number
  /** Tras cancelar, cuánto se espera a que el proceso suelte la lectura; pasado ese tiempo, el proceso se reinicia (A2-P2-17). */
  cancelGraceMs?: number
  /** Sin ningún mensaje del proceso durante este tiempo con lecturas en curso, se da por colgado y se reinicia (por defecto, 3 min). */
  stallMs?: number
  /** Lectura en este proceso si el de lectura no consigue arrancar. */
  fallback?: Reader
  /** Registro (avisos del proceso de lectura y de este lado). */
  log?: (level: LogLevel, text: string) => void
}

interface Job {
  id: number
  input: IngestInput
  options: Partial<IngestOptions>
  rasterizer: PageRasterizer | undefined
  resolve: (doc: SourceDocument) => void
  reject: (e: unknown) => void
  /** Ya se respondió a quien llamó (resultado, error o cancelación). */
  done: boolean
  grace: NodeJS.Timeout | null
  unlisten: () => void
}

interface Live {
  proc: WorkerProcess
  /** Avisó de que arrancó (si se cae antes, no llegó a leer nada). */
  ready: boolean
  settings: string
}

const PDF_CACHE = 2
const START_ATTEMPTS = 2

/** El error de las lecturas en curso cuando el proceso de lectura se cae. */
export function workerCrashedError(): IngestError {
  return new IngestError('unreadable', L('el lector de archivos se cerró de forma inesperada'))
}

/** El error de las lecturas en curso cuando el proceso de lectura deja de responder y se reinicia. */
export function workerStalledError(): IngestError {
  return new IngestError('unreadable', L('el lector de archivos tardó demasiado y se reinició'))
}

export class IngestWorkerClient implements IngestRunner {
  private worker: Live | null = null
  private readonly queue: Job[] = []
  private readonly running = new Map<number, Job>()
  private readonly pdfs = new Map<string, Uint8Array>()
  private next = 1
  private idle: NodeJS.Timeout | null = null
  private startFailures = 0
  private broken = false
  private disposed = false
  private spawned = 0
  private readonly concurrency: number
  private readonly idleMs: number
  private readonly cancelGraceMs: number
  private readonly stallMs: number
  private stall: NodeJS.Timeout | null = null
  private recycled = 0

  constructor(private readonly options: IngestWorkerClientOptions) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 2))
    this.idleMs = Math.max(0, options.idleMs ?? 3 * 60 * 1000)
    this.cancelGraceMs = Math.max(0, options.cancelGraceMs ?? 15_000)
    this.stallMs = Math.max(0, options.stallMs ?? 3 * 60 * 1000)
  }

  /** Estado (para las pruebas y el registro). */
  get state(): { running: number; queued: number; spawned: number; alive: boolean; broken: boolean; recycled: number } {
    return { running: this.running.size, queued: this.queue.length, spawned: this.spawned, alive: this.worker !== null, broken: this.broken, recycled: this.recycled }
  }

  read(input: IngestInput, options: Partial<IngestOptions>): Promise<SourceDocument> {
    if (this.disposed || options.signal?.aborted) return Promise.reject(new CancelledError())
    if (this.broken && this.options.fallback) return this.options.fallback(input, options)
    return new Promise<SourceDocument>((resolve, reject) => {
      const job: Job = {
        id: this.next++,
        input,
        options,
        rasterizer: options.rasterizer ?? defaultOptions().rasterizer,
        resolve,
        reject,
        done: false,
        grace: null,
        unlisten: () => undefined
      }
      const signal = options.signal
      if (signal) {
        const onAbort = (): void => this.abort(job)
        signal.addEventListener('abort', onAbort, { once: true })
        job.unlisten = () => signal.removeEventListener('abort', onAbort)
      }
      this.queue.push(job)
      this.pump()
    })
  }

  /** Cierra el proceso de lectura y cancela todo (al salir de la app). */
  dispose(): void {
    this.disposed = true
    this.clearIdle()
    this.clearStall()
    this.stopWorker()
    const jobs = [...this.queue, ...this.running.values()]
    this.queue.length = 0
    this.running.clear()
    for (const job of jobs) this.settle(job, new CancelledError())
  }

  // MARK: Cola

  private pump(): void {
    if (this.disposed) return
    while (this.queue.length > 0 && (this.broken || this.running.size < this.concurrency)) {
      const job = this.queue.shift() as Job
      if (job.done) continue
      if (this.broken) this.runHere(job)
      else this.start(job)
    }
    this.scheduleIdle()
  }

  private start(job: Job): void {
    let live: Live
    try {
      live = this.ensureWorker()
    } catch (e) {
      this.log('error', `[ingest] no arrancó el proceso de lectura: ${e instanceof Error ? e.message : String(e)}`)
      this.startFailed([job])
      return
    }
    this.running.set(job.id, job)
    try {
      this.sendSettings(live)
      live.proc.post({ type: 'read', id: job.id, input: job.input, options: toWireOptions(job.options, job.rasterizer) })
    } catch {
      // Se cerró justo ahora: lo trata su aviso de salida
    }
    this.touch()
  }

  private runHere(job: Job): void {
    const fallback = this.options.fallback
    if (!fallback) { this.settle(job, workerCrashedError()); return }
    fallback(job.input, job.options).then((doc) => this.settle(job, null, doc), (e: unknown) => this.settle(job, e))
  }

  private abort(job: Job): void {
    const queued = this.queue.indexOf(job)
    if (queued >= 0) this.queue.splice(queued, 1)
    else if (this.running.has(job.id) && this.worker) {
      try { this.worker.proc.post({ type: 'cancel', id: job.id }) } catch { /* ya cerrado */ }
      // Quien llama no espera; el hueco se libera cuando el proceso suelte la lectura. Si no la suelta a tiempo (un PDF que no cede
      // el hilo), el proceso se reinicia: si no, la lectura fantasma seguía ocupándolo y las siguientes esperaban (A2-P2-17)
      job.grace = setTimeout(() => this.cancelExpired(job.id), this.cancelGraceMs)
      job.grace.unref?.()
    }
    this.settle(job, new CancelledError())
  }

  /** Termina una lectura en curso y deja sitio a la siguiente. */
  private release(id: number, error: unknown = null, doc?: SourceDocument): void {
    const job = this.running.get(id)
    if (!job) return
    this.running.delete(id)
    if (job.grace) clearTimeout(job.grace)
    if (this.running.size === 0) this.clearStall()
    this.settle(job, error, doc)
    this.pump()
  }

  /** Una lectura cancelada que el proceso no soltó a tiempo: se reinicia el proceso; las demás en curso vuelven a la cola. */
  private cancelExpired(id: number): void {
    if (!this.running.has(id)) return
    this.log('warn', '[ingest] una lectura cancelada no terminó a tiempo: se reinicia el proceso de lectura')
    this.recycle((job) => (job.id === id ? 'drop' : 'requeue'))
  }

  /** Nada del proceso en `stallMs` con lecturas en curso: se reinicia y esas lecturas fallan con un error claro. */
  private stalled(): void {
    this.stall = null
    if (this.running.size === 0 || !this.worker) return
    this.log('warn', `[ingest] el proceso de lectura no respondió en ${Math.round(this.stallMs / 1000)} s: se reinicia`)
    this.recycle(() => 'fail')
  }

  /** Mata el proceso de lectura (sin esperar a que salga) y decide qué pasa con cada lectura en curso. */
  private recycle(decide: (job: Job) => 'fail' | 'requeue' | 'drop'): void {
    this.recycled++
    this.clearStall()
    const jobs = [...this.running.values()]
    this.running.clear()
    this.stopWorker()
    const again: Job[] = []
    for (const job of jobs) {
      if (job.grace) clearTimeout(job.grace)
      job.grace = null
      const what = job.done ? 'drop' : decide(job)
      if (what === 'requeue') again.push(job)
      else if (what === 'fail') this.settle(job, workerStalledError())
    }
    this.queue.unshift(...again)
    this.pump()
  }

  /** El proceso dio señales de vida: el plazo de «colgado» vuelve a empezar. */
  private touch(): void {
    this.clearStall()
    if (this.stallMs === 0 || this.running.size === 0 || this.disposed) return
    this.stall = setTimeout(() => this.stalled(), this.stallMs)
    this.stall.unref?.()
  }

  private clearStall(): void {
    if (this.stall) clearTimeout(this.stall)
    this.stall = null
  }

  private settle(job: Job, error: unknown, doc?: SourceDocument): void {
    if (job.done) return
    job.done = true
    job.unlisten()
    if (error || !doc) job.reject(error ?? new CancelledError())
    else job.resolve(doc)
  }

  // MARK: Proceso de lectura

  private ensureWorker(): Live {
    if (this.worker) return this.worker
    this.clearIdle()
    const proc = this.options.spawn()
    this.spawned++
    const live: Live = { proc, ready: false, settings: '' }
    this.worker = live
    proc.onMessage((m) => this.onMessage(live, m))
    proc.onExit((code) => this.onExit(live, code))
    return live
  }

  private sendSettings(live: Live): void {
    const settings = this.options.settings()
    const json = JSON.stringify(settings)
    if (json === live.settings) return
    live.settings = json
    live.proc.post({ type: 'init', settings })
  }

  private onMessage(live: Live, raw: unknown): void {
    if (live !== this.worker || !isFromWorker(raw)) return
    const m: FromWorker = raw
    this.touch()
    switch (m.type) {
      case 'ready':
        live.ready = true
        this.startFailures = 0
        break
      case 'progress': {
        const job = this.running.get(m.id)
        if (job && !job.done) {
          try { job.options.onProgress?.(m.fraction, m.message) } catch { /* el progreso no rompe la lectura */ }
        }
        break
      }
      case 'result': this.release(m.id, null, m.result); break
      case 'error': this.release(m.id, rebuildError(m)); break
      case 'raster': void this.answerRaster(live, m); break
      case 'log': this.log(m.level, m.text); break
    }
  }

  private onExit(live: Live, code: number): void {
    if (live !== this.worker) return
    this.worker = null
    this.pdfs.clear()
    const jobs = [...this.running.values()]
    this.running.clear()
    this.clearStall()
    if (!live.ready) {
      this.log('error', `[ingest] el proceso de lectura se cerró al arrancar (código ${code})`)
      this.startFailed(jobs)
      return
    }
    this.log('warn', `[ingest] el proceso de lectura se cerró (código ${code}); ${jobs.length} lectura(s) en curso fallan`)
    for (const job of jobs) {
      if (job.grace) clearTimeout(job.grace)
      this.settle(job, workerCrashedError())
    }
    this.pump()
  }

  /** No llegó a arrancar: sus lecturas no empezaron, se reintentan; a la segunda, se lee en este proceso. */
  private startFailed(jobs: Job[]): void {
    this.startFailures++
    if (this.startFailures >= START_ATTEMPTS) {
      this.broken = true
      this.log('error', '[ingest] se leerá en el proceso principal')
    }
    this.queue.unshift(...jobs.filter((j) => !j.done))
    // Arranque fallido síncrono: el reintento va en la siguiente vuelta para no encadenar llamadas
    setTimeout(() => this.pump(), 0)
  }

  private async answerRaster(live: Live, m: RasterRequest): Promise<void> {
    const reply = (png: Uint8Array | null, missing?: boolean): void => {
      if (live !== this.worker) return
      try { live.proc.post({ type: 'raster-result', id: m.id, png, missing }) } catch { /* ya cerrado */ }
      this.touch()
    }
    const job = this.running.get(m.call)
    if (!job || job.done || !job.rasterizer) { reply(null); return }
    try {
      if (m.op === 'image') {
        reply(job.rasterizer.imageToPng ? await job.rasterizer.imageToPng(m.image, m.maxDimension) : null)
        return
      }
      const pdf = m.pdf ? this.remember(m.key, m.pdf) : this.recall(m.key)
      if (!pdf) { reply(null, true); return }
      reply(await job.rasterizer.renderPdfPage(pdf, m.page, m.maxDimension))
    } catch (e) {
      this.log('warn', `[ingest] no se pudo dibujar la página: ${e instanceof Error ? e.message : String(e)}`)
      reply(null)
    }
  }

  /** Los últimos PDF que pidió dibujar (cada uno viaja una sola vez). */
  private remember(key: string, pdf: Uint8Array): Uint8Array {
    this.pdfs.delete(key)
    this.pdfs.set(key, pdf)
    while (this.pdfs.size > PDF_CACHE) this.pdfs.delete(this.pdfs.keys().next().value as string)
    return pdf
  }

  private recall(key: string): Uint8Array | undefined {
    const pdf = this.pdfs.get(key)
    if (pdf) this.remember(key, pdf)
    return pdf
  }

  private scheduleIdle(): void {
    if (this.idle || !this.worker || this.idleMs === 0 || this.running.size > 0 || this.queue.length > 0) return
    this.idle = setTimeout(() => {
      this.idle = null
      if (this.running.size === 0 && this.queue.length === 0) this.stopWorker()
    }, this.idleMs)
    this.idle.unref?.()
  }

  private clearIdle(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
  }

  private stopWorker(): void {
    const live = this.worker
    this.worker = null
    this.pdfs.clear()
    if (live) {
      try { live.proc.kill() } catch { /* ya cerrado */ }
    }
  }

  private log(level: LogLevel, text: string): void {
    this.options.log?.(level, text)
  }
}
