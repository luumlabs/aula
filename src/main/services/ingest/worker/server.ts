// Lado del proceso de lectura: atiende peticiones de lectura (varias a la vez), las cancela, informa del progreso y pide
// al proceso principal que dibuje las páginas escaneadas (allí está la ventana con pdf.js).
import { createHash } from 'node:crypto'
import type { IngestInput, PageRasterizer, SourceDocument } from '@shared/ingest'
import { log } from '../../log'
import { configureOcr } from '../extract/ocr'
import { setIngestLanguage } from '../messages'
import type { IngestOptions } from '../options'
import { readInputHere } from '../read'
import { fromWireOptions, isToWorker, serializeError, type Endpoint, type FromWorker, type LogLevel, type RasterRequest, type ToWorker, type WireOptions, type WorkerSettings } from './protocol'

type Reader = (input: IngestInput, options: Partial<IngestOptions>) => Promise<SourceDocument>

/** Lo que se espera a que el proceso principal dibuje una página (A2-P2-16). */
const RASTER_ANSWER_MS = 120_000

/** Dibujante de páginas que pregunta al proceso principal. Cada PDF viaja una sola vez; después, solo su huella. */
export class RasterBridge {
  private next = 1
  private readonly waiting = new Map<number, (m: { png: Uint8Array | null; missing?: boolean }) => void>()
  private readonly keys = new WeakMap<Uint8Array, string>()
  private readonly sent = new Set<string>()

  constructor(private readonly post: (m: RasterRequest) => void, private readonly answerMs = RASTER_ANSWER_MS) {}

  /** Dibujante para una lectura, o ninguno si el proceso principal no sabe dibujar (las páginas quedan con `needsOCR`). */
  forCall(call: number, wire: Pick<WireOptions, 'rasterPdf' | 'rasterImage'>): PageRasterizer | undefined {
    if (!wire.rasterPdf) return undefined
    const r: PageRasterizer = { renderPdfPage: (pdf, page, maxDimension) => this.pdfPage(call, pdf, page, maxDimension) }
    if (wire.rasterImage) r.imageToPng = (image, maxDimension) => this.ask({ type: 'raster', id: 0, call, op: 'image', image, maxDimension }).then((m) => m.png)
    return r
  }

  /** Respuesta del proceso principal. */
  settle(id: number, answer: { png: Uint8Array | null; missing?: boolean }): void {
    const resolve = this.waiting.get(id)
    if (!resolve) return
    this.waiting.delete(id)
    resolve(answer)
  }

  private async pdfPage(call: number, pdf: Uint8Array, page: number, maxDimension: number): Promise<Uint8Array | null> {
    const key = this.keyOf(pdf)
    for (let attempt = 0; attempt < 2; attempt++) {
      const include = !this.sent.has(key)
      if (include) this.sent.add(key)
      const answer = await this.ask({ type: 'raster', id: 0, call, op: 'pdf', key, pdf: include ? pdf : undefined, page, maxDimension })
      // El proceso principal ya no lo tiene en su caché: se vuelve a enviar
      if (answer.missing) { this.sent.delete(key); continue }
      return answer.png
    }
    return null
  }

  private keyOf(pdf: Uint8Array): string {
    let key = this.keys.get(pdf)
    if (!key) {
      key = createHash('sha256').update(pdf).digest('hex').slice(0, 32)
      this.keys.set(pdf, key)
    }
    return key
  }

  private ask(request: RasterRequest): Promise<{ png: Uint8Array | null; missing?: boolean }> {
    const id = this.next++
    return new Promise((resolve) => {
      // sin respuesta a tiempo (el dibujante del proceso principal se colgó), esa página se da por no dibujada (A2-P2-16)
      const timer = setTimeout(() => {
        if (this.waiting.delete(id)) resolve({ png: null })
      }, this.answerMs)
      timer.unref?.()
      this.waiting.set(id, (answer) => { clearTimeout(timer); resolve(answer) })
      this.post({ ...request, id })
    })
  }
}

export interface WorkerServer {
  /** Lecturas en curso. */
  readonly active: number
}

/** Atiende el canal. `read` es la lectura real (en las pruebas, una de mentira). */
export function serveIngestWorker(port: Endpoint<unknown, FromWorker>, read: Reader = readInputHere): WorkerServer {
  const calls = new Map<number, AbortController>()
  const raster = new RasterBridge((m) => port.post(m))
  let applied = ''

  function apply(settings: WorkerSettings): void {
    const json = JSON.stringify(settings)
    if (json === applied) return
    const before = applied ? (JSON.parse(applied) as WorkerSettings) : null
    applied = json
    setIngestLanguage(typeof settings.uiLanguage === 'string' ? settings.uiLanguage : 'es')
    if (!before || JSON.stringify(before.ocr) !== JSON.stringify(settings.ocr)) configureOcr({ ...settings.ocr })
  }

  async function serve(id: number, input: IngestInput, wire: WireOptions): Promise<void> {
    const controller = new AbortController()
    calls.set(id, controller)
    const onProgress = wire.progress ? (fraction: number, message: string) => port.post({ type: 'progress', id, fraction, message }) : undefined
    const options = fromWireOptions(wire, { signal: controller.signal, onProgress, rasterizer: raster.forCall(id, wire) })
    try {
      const result = await read(input, options)
      port.post({ type: 'result', id, result })
    } catch (e) {
      port.post({ type: 'error', id, ...serializeError(e) })
    } finally {
      calls.delete(id)
    }
  }

  port.listen((message) => {
    if (!isToWorker(message)) return
    const m: ToWorker = message
    switch (m.type) {
      case 'init': apply(m.settings); break
      case 'read': if (!calls.has(m.id)) void serve(m.id, m.input, m.options); break
      case 'cancel': calls.get(m.id)?.abort(); break
      case 'raster-result': raster.settle(m.id, { png: m.png, missing: m.missing }); break
    }
  })
  port.post({ type: 'ready' })
  return { get active() { return calls.size } }
}

/** Los avisos del proceso de lectura van al registro del proceso principal. */
export function forwardLogs(port: Endpoint<unknown, FromWorker>): void {
  log.setSink((level: LogLevel, ...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : safeJSON(a))).join(' ')
    try { port.post({ type: 'log', level, text }) } catch { /* canal cerrado */ }
  })
}

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}
