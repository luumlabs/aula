// Lectura en otro proceso: protocolo, errores, cancelación, cola, caídas y el puente del dibujante de páginas, con un
// canal en memoria que clona cada mensaje (como `utilityProcess`).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IngestInput, PageRasterizer, SourceDocument } from '@shared/ingest'
import { AulaError } from '../../errors'
import { CancelledError, IngestError, isIngestError } from '../errors'
import { importSourceIntoPack, ingest, ingestFile, readInput, setIngestRunner } from '../index'
import { setIngestLanguage } from '../messages'
import type { IngestOptions } from '../options'
import { readInputHere } from '../read'
import { canDelegate, type IngestRunner } from '../runner'
import { EmptySourceError } from '../sourceStore'
import { ProgressLog, tempDir, type TempDir } from '../testing/files'
import { buildPDF, LOREM, paragraph } from '../testing/pdf'
import { IngestWorkerClient, type IngestWorkerClientOptions, type WorkerProcess } from './client'
import { fromWireOptions, rebuildError, serializeError, toWireOptions, type FromWorker, type ToWorker, type WorkerSettings } from './protocol'
import { RasterBridge, serveIngestWorker, type WorkerServer } from './server'

type Reader = (input: IngestInput, options: Partial<IngestOptions>) => Promise<SourceDocument>

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('tiempo agotado')
    await tick(2)
  }
}

/** Procesos de lectura en memoria: cada mensaje se clona y llega en la siguiente vuelta, como entre procesos. */
class MemoryWorkers {
  readonly toWorker: ToWorker[] = []
  readonly fromWorker: FromWorker[] = []
  readonly servers: WorkerServer[] = []
  private kills: Array<(code: number) => void> = []
  silent = false

  constructor(private readonly read: Reader = readInputHere) {}

  readonly spawn = (): WorkerProcess => {
    let alive = true
    let toServer: ((m: unknown) => void) | null = null
    const toHost: Array<(m: unknown) => void> = []
    const exits: Array<(code: number) => void> = []
    const die = (code: number): void => {
      if (!alive) return
      alive = false
      setTimeout(() => exits.forEach((h) => h(code)), 0)
    }
    this.kills.push(die)
    if (!this.silent) {
      this.servers.push(serveIngestWorker({
        post: (m) => {
          if (!alive) return
          this.fromWorker.push(m)
          const copy = structuredClone(m)
          setTimeout(() => { if (alive) toHost.forEach((h) => h(copy)) }, 0)
        },
        listen: (h) => { toServer = h }
      }, this.read))
    } else die(1)
    return {
      post: (m) => {
        if (!alive) throw new Error('cerrado')
        this.toWorker.push(m)
        const copy = structuredClone(m)
        setTimeout(() => { if (alive) toServer?.(copy) }, 0)
      },
      onMessage: (h) => { toHost.push(h) },
      onExit: (h) => { exits.push(h) },
      kill: () => die(0)
    }
  }

  /** El proceso vivo se cae (p. ej., sin memoria). */
  crash(): void {
    this.kills[this.kills.length - 1]?.(134)
  }

  sent(type: ToWorker['type']): ToWorker[] {
    return this.toWorker.filter((m) => m.type === type)
  }
}

const SETTINGS: WorkerSettings = { uiLanguage: 'es', ocr: {} }

function client(workers: MemoryWorkers, extra: Partial<IngestWorkerClientOptions> = {}): IngestWorkerClient {
  return new IngestWorkerClient({ spawn: workers.spawn, settings: () => SETTINGS, idleMs: 0, ...extra })
}

/** Lectura de mentira que espera a que la suelten (o a que la cancelen). */
class Gates {
  readonly started: string[] = []
  private readonly open = new Map<string, () => void>()

  readonly read: Reader = (input, options) => {
    const name = input.type === 'text' ? input.text : ''
    this.started.push(name)
    return new Promise<SourceDocument>((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new CancelledError()), { once: true })
      this.open.set(name, () => resolve({ title: name, kind: 'text', pages: [{ number: 1, text: name, usedOCR: false, hasFigures: false }], metadata: {}, warnings: [] }))
    })
  }

  release(name: string): void {
    this.open.get(name)?.()
  }
}

let tmp: TempDir
let active: IngestWorkerClient[] = []
beforeEach(() => { tmp = tempDir() })
afterEach(() => {
  for (const c of active) c.dispose()
  active = []
  setIngestRunner(null)
  setIngestLanguage('es')
  tmp.cleanup()
})

function track(c: IngestWorkerClient): IngestWorkerClient {
  active.push(c)
  return c
}

function multiPagePDF(): Uint8Array {
  const topics = ['Triángulos', 'Circunferencia', 'Funciones', 'Vectores']
  return buildPDF({ info: { Title: 'Geometría' }, pages: topics.map((t, i) => ({ texts: [{ text: `Capítulo ${i + 1}: ${t}`, x: 72, y: 720, size: 22 }, ...paragraph(`Sobre ${t.toLowerCase()}. ` + LOREM, 72, 680, 420, 11)] })) })
}

describe('Lectura en el proceso de lectura', () => {
  it('un texto, un archivo .txt y un PDF de varias páginas dan lo mismo que en este proceso', async () => {
    const c = track(client(new MemoryWorkers()))
    const inputs: IngestInput[] = [
      { type: 'text', text: 'Apuntes pegados: la célula es la unidad básica de la vida.', title: 'Biología' },
      { type: 'file', path: tmp.write('notas.txt', 'Tema 1\n\nLa fotosíntesis convierte la luz en energía química.\n') },
      { type: 'file', path: tmp.write('libro.pdf', multiPagePDF()) }
    ]
    for (const input of inputs) {
      const there = await c.read(input, {})
      const here = await readInputHere(input, {})
      expect(there).toEqual(here)
    }
    expect(c.state.spawned).toBe(1)
  })

  it('las funciones públicas usan el lector aparte cuando está instalado', async () => {
    const workers = new MemoryWorkers()
    setIngestRunner(track(client(workers)))
    const path = tmp.write('libro.pdf', multiPagePDF())
    const there = await ingestFile(path, { sourceID: 'libro' })
    expect(workers.sent('read')).toHaveLength(1)
    setIngestRunner(null)
    const here = await ingestFile(path, { sourceID: 'libro' })
    expect(there).toEqual(here)
    expect(there.pages).toHaveLength(4)
    expect(there.chunks.map((ch) => ch.id)).toEqual(here.chunks.map((ch) => ch.id))
  })

  it('importar a un curso: lee fuera, guarda aquí, con el progreso completo', async () => {
    const workers = new MemoryWorkers()
    setIngestRunner(track(client(workers)))
    const log = new ProgressLog()
    const saved = await importSourceIntoPack(join(tmp.path, 'pack'), { type: 'file', path: tmp.write('libro.pdf', multiPagePDF()) }, { onProgress: log.callback, sourceID: 'geo' })
    expect(workers.sent('read')).toHaveLength(1)
    expect(workers.fromWorker.some((m) => m.type === 'progress')).toBe(true)
    expect(existsSync(join(tmp.path, 'pack', 'sources', 'geo', 'chunks.json'))).toBe(true)
    expect(saved.result.chunks.length).toBeGreaterThan(0)
    expect(log.fractions.at(-1)).toBe(1)
    for (let i = 1; i < log.fractions.length; i++) expect(log.fractions[i]).toBeGreaterThanOrEqual(log.fractions[i - 1])
  })

  it('con un transporte o un motor de OCR propios se lee en este proceso', async () => {
    let calls = 0
    const runner: IngestRunner = { read: async () => { calls++; throw new Error('no debería llamarse') } }
    setIngestRunner(runner)
    expect(canDelegate({ ocr: false })).toBe(true)
    expect(canDelegate({ transport: { request: async () => { throw new Error('x') } } })).toBe(false)
    expect(canDelegate({ ocr: { name: 'x', recognize: async () => ({ width: 1, height: 1, lines: [] }) } })).toBe(false)
    const doc = await readInput({ type: 'text', text: 'hola' }, { ocr: { name: 'x', recognize: async () => ({ width: 1, height: 1, lines: [] }) } })
    expect(doc.pages[0].text).toBe('hola')
    expect(calls).toBe(0)
    await expect(ingest({ type: 'text', text: 'hola' })).rejects.toThrow('no debería llamarse')
  })
})

describe('Errores', () => {
  it('un archivo que no existe llega como el mismo IngestError', async () => {
    const c = track(client(new MemoryWorkers()))
    const input: IngestInput = { type: 'file', path: join(tmp.path, 'no-existe.pdf') }
    const there = await c.read(input, {}).catch((e: unknown) => e)
    const here = await readInputHere(input, {}).catch((e: unknown) => e)
    expect(there).toBeInstanceOf(IngestError)
    expect(isIngestError(there, 'fileNotFound')).toBe(true)
    expect((there as IngestError).message).toBe((here as IngestError).message)
    expect((there as IngestError).code).toBe('ingest_fileNotFound')
    expect((there as IngestError).reason).toBe((here as IngestError).reason)
  })

  it('los mensajes salen en el idioma de la interfaz que se le pasa', async () => {
    let settings: WorkerSettings = { uiLanguage: 'en', ocr: {} }
    const workers = new MemoryWorkers()
    const c = track(new IngestWorkerClient({ spawn: workers.spawn, settings: () => settings, idleMs: 0 }))
    const e = (await c.read({ type: 'file', path: join(tmp.path, 'missing.pdf') }, {}).catch((x: unknown) => x)) as Error
    expect(e.message).toContain("wasn't found")
    settings = { uiLanguage: 'es', ocr: {} }
    const e2 = (await c.read({ type: 'file', path: join(tmp.path, 'missing.pdf') }, {}).catch((x: unknown) => x)) as Error
    expect(e2.message).toContain('No se encontró')
    // los ajustes solo viajan cuando cambian
    expect(workers.sent('init')).toHaveLength(2)
  })

  it('cada tipo de error se reconstruye con su clase, código y mensaje', () => {
    const cases: Error[] = [
      new IngestError('passwordProtected', 'examen.pdf'),
      new EmptySourceError('Vacío'),
      new CancelledError(),
      new AulaError('ingest_x', 'Algo'),
      new TypeError('raro')
    ]
    for (const original of cases) {
      const wire = structuredClone(serializeError(original))
      const back = rebuildError(wire)
      expect(back.constructor).toBe(original.constructor === TypeError ? Error : original.constructor)
      expect(back.message).toBe(original.message)
      expect(back.name).toBe(original.name)
      if (original instanceof AulaError) expect((back as AulaError).code).toBe(original.code)
    }
    const back = rebuildError(serializeError(new IngestError('passwordProtected', 'examen.pdf'))) as IngestError
    expect(back.kind).toBe('passwordProtected')
    expect(back.reason).toBe('examen.pdf')
    expect(rebuildError(serializeError('cadena')).message).toBe('cadena')
  })
})

describe('Opciones', () => {
  it('solo viaja la parte serializable, y vuelve igual', () => {
    const rasterizer: PageRasterizer = { renderPdfPage: async () => null }
    const wire = toWireOptions({ language: 'ja', ocrLanguages: ['jpn', 'eng'], ocr: false, maxPages: 7, ocrWhenTextShorterThan: 10, includeSpeakerNotes: false, allowPrivate: true, maxArchiveBytes: 5, maxArchiveEntries: 6, maxWebBytes: 8, onProgress: () => undefined, signal: new AbortController().signal }, rasterizer)
    expect(structuredClone(wire)).toEqual(wire)
    expect(wire).toEqual({ language: 'ja', ocrLanguages: ['jpn', 'eng'], ocrOff: true, maxPages: 7, ocrWhenTextShorterThan: 10, includeSpeakerNotes: false, allowPrivate: true, maxArchiveBytes: 5, maxArchiveEntries: 6, maxWebBytes: 8, rasterPdf: true, rasterImage: false, progress: true })
    const signal = new AbortController().signal
    const back = fromWireOptions(wire, { signal, onProgress: undefined, rasterizer: undefined })
    expect(back).toMatchObject({ language: 'ja', ocrLanguages: ['jpn', 'eng'], ocr: false, maxPages: 7, ocrWhenTextShorterThan: 10, includeSpeakerNotes: false, allowPrivate: true, maxArchiveBytes: 5, maxArchiveEntries: 6, maxWebBytes: 8, signal })
    expect(toWireOptions({})).toEqual({ rasterPdf: false, rasterImage: false, progress: false })
  })
})

describe('Cola, cancelación y caídas', () => {
  it('como mucho dos lecturas a la vez; el resto espera su turno', async () => {
    const gates = new Gates()
    const c = track(client(new MemoryWorkers(gates.read)))
    const reads = ['a', 'b', 'c'].map((t) => c.read({ type: 'text', text: t }, {}))
    await until(() => gates.started.length === 2)
    await tick(10)
    expect(gates.started).toEqual(['a', 'b'])
    expect(c.state).toMatchObject({ running: 2, queued: 1 })
    gates.release('b')
    await until(() => gates.started.length === 3)
    gates.release('a')
    gates.release('c')
    const docs = await Promise.all(reads)
    expect(docs.map((d) => d.title)).toEqual(['a', 'b', 'c'])
    expect(c.state).toMatchObject({ running: 0, queued: 0 })
  })

  it('cancelar responde enseguida, avisa al proceso de lectura y libera el hueco', async () => {
    const gates = new Gates()
    const workers = new MemoryWorkers(gates.read)
    const c = track(client(workers))
    const controller = new AbortController()
    const reading = c.read({ type: 'text', text: 'largo' }, { signal: controller.signal })
    await until(() => gates.started.length === 1)
    controller.abort()
    await expect(reading).rejects.toBeInstanceOf(CancelledError)
    expect(workers.sent('cancel')).toHaveLength(1)
    await until(() => c.state.running === 0)
    expect(workers.servers[0].active).toBe(0)
    // en cola: se quita sin llegar a enviarse
    const g2 = new Gates()
    const c2 = track(client(new MemoryWorkers(g2.read), { concurrency: 1 }))
    const first = c2.read({ type: 'text', text: 'uno' }, {})
    const later = new AbortController()
    const second = c2.read({ type: 'text', text: 'dos' }, { signal: later.signal })
    later.abort()
    await expect(second).rejects.toBeInstanceOf(CancelledError)
    await until(() => g2.started.length === 1)
    g2.release('uno')
    await first
    await tick(10)
    expect(g2.started).toEqual(['uno'])
    // ya cancelada antes de empezar
    await expect(c.read({ type: 'text', text: 'x' }, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(CancelledError)
  })

  it('si el proceso se cae, las lecturas en curso fallan con un error claro y la siguiente arranca otro', async () => {
    const gates = new Gates()
    const workers = new MemoryWorkers(gates.read)
    const c = track(client(workers))
    const a = c.read({ type: 'text', text: 'a' }, {})
    const b = c.read({ type: 'text', text: 'b' }, {})
    await until(() => gates.started.length === 2)
    workers.crash()
    for (const r of [a, b]) {
      const e = await r.catch((x: unknown) => x)
      expect(isIngestError(e, 'unreadable')).toBe(true)
      expect((e as Error).message).toContain('se cerró de forma inesperada')
    }
    const again = c.read({ type: 'text', text: 'c' }, {})
    await until(() => gates.started.length === 3)
    gates.release('c')
    expect((await again).title).toBe('c')
    expect(c.state.spawned).toBe(2)
  })

  it('si no consigue arrancar, se lee en este proceso', async () => {
    const workers = new MemoryWorkers()
    workers.silent = true
    const logs: string[] = []
    const c = track(client(workers, { fallback: readInputHere, log: (_, t) => logs.push(t) }))
    const doc = await c.read({ type: 'text', text: 'sin proceso de lectura' }, {})
    expect(doc.pages[0].text).toBe('sin proceso de lectura')
    expect(c.state).toMatchObject({ broken: true, spawned: 2 })
    expect(logs.some((l) => l.includes('proceso principal'))).toBe(true)
    // y si ni siquiera se puede lanzar
    const c2 = track(client(new MemoryWorkers(), { spawn: () => { throw new Error('sin permiso') }, fallback: readInputHere }))
    expect((await c2.read({ type: 'text', text: 'hola' }, {})).pages[0].text).toBe('hola')
    const c3 = track(client(new MemoryWorkers(), { spawn: () => { throw new Error('sin permiso') } }))
    await expect(c3.read({ type: 'text', text: 'hola' }, {})).rejects.toBeInstanceOf(IngestError)
  })

  it('se cierra cuando no se usa y vuelve a arrancar al leer otra vez', async () => {
    const c = track(client(new MemoryWorkers(), { idleMs: 20 }))
    await c.read({ type: 'text', text: 'uno' }, {})
    expect(c.state.alive).toBe(true)
    await until(() => !c.state.alive)
    await c.read({ type: 'text', text: 'dos' }, {})
    expect(c.state.spawned).toBe(2)
  })

  it('al salir de la app, lo pendiente se cancela', async () => {
    const gates = new Gates()
    const c = client(new MemoryWorkers(gates.read), { concurrency: 1 })
    const a = c.read({ type: 'text', text: 'a' }, {})
    const b = c.read({ type: 'text', text: 'b' }, {})
    await until(() => gates.started.length === 1)
    c.dispose()
    await expect(a).rejects.toBeInstanceOf(CancelledError)
    await expect(b).rejects.toBeInstanceOf(CancelledError)
    await expect(c.read({ type: 'text', text: 'c' }, {})).rejects.toBeInstanceOf(CancelledError)
  })

  it('el progreso llega a quien llama, en orden', async () => {
    const reader: Reader = async (input, options) => {
      for (const f of [0.1, 0.5, 0.9]) options.onProgress?.(f, `paso ${f}`)
      return readInputHere(input, options)
    }
    const c = track(client(new MemoryWorkers(reader)))
    const log = new ProgressLog()
    await c.read({ type: 'text', text: 'hola' }, { onProgress: log.callback })
    expect(log.items).toEqual([[0.1, 'paso 0.1'], [0.5, 'paso 0.5'], [0.9, 'paso 0.9']])
    // sin nadie escuchando, no viaja el progreso
    const workers = new MemoryWorkers(reader)
    await track(client(workers)).read({ type: 'text', text: 'hola' }, {})
    expect(workers.fromWorker.some((m) => m.type === 'progress')).toBe(false)
  })
})

describe('Dibujante de páginas puente', () => {
  const fakePNG = (page: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, page])

  /** Lectura de mentira que pide dibujar las páginas de varios PDF (como el OCR de páginas escaneadas). */
  function rasterReader(order: Array<[Uint8Array, number]>): Reader {
    return async (_input, options) => {
      const out: number[] = []
      for (const [pdf, page] of order) {
        const png = await options.rasterizer?.renderPdfPage(pdf, page, 2000)
        out.push(png ? png[4] : -1)
      }
      const image = options.rasterizer?.imageToPng ? await options.rasterizer.imageToPng(new Uint8Array([1, 2, 3]), 900) : null
      return { title: out.join(','), kind: 'pdf', pages: [{ number: 1, text: image ? `imagen ${image.length}` : 'sin imagen', usedOCR: false, hasFigures: false }], metadata: {}, warnings: [] }
    }
  }

  function hostRasterizer(seen: Array<{ size: number; page: number; max: number }>, withImages = true): PageRasterizer {
    const r: PageRasterizer = {
      renderPdfPage: async (pdf, page, max) => { seen.push({ size: pdf.length, page, max }); return fakePNG(page) }
    }
    if (withImages) r.imageToPng = async (image) => new Uint8Array(image.length * 2)
    return r
  }

  it('el proceso de lectura pide las páginas al principal; cada PDF viaja una sola vez', async () => {
    const pdf = new Uint8Array(50_000).fill(7)
    const workers = new MemoryWorkers(rasterReader([[pdf, 1], [pdf, 2], [pdf, 3]]))
    const seen: Array<{ size: number; page: number; max: number }> = []
    const c = track(client(workers))
    const doc = await c.read({ type: 'file', path: '/x.pdf' }, { rasterizer: hostRasterizer(seen) })
    expect(doc.title).toBe('1,2,3')
    expect(doc.pages[0].text).toBe('imagen 6')
    expect(seen).toEqual([1, 2, 3].map((page) => ({ size: 50_000, page, max: 2000 })))
    const carrying = workers.fromWorker.filter((m) => m.type === 'raster' && m.op === 'pdf' && m.pdf)
    expect(carrying).toHaveLength(1)
  })

  it('si el principal ya no lo tiene en caché, se vuelve a enviar', async () => {
    const [a, b, c3] = [1, 2, 3].map((n) => new Uint8Array(1000).fill(n))
    const workers = new MemoryWorkers(rasterReader([[a, 1], [b, 1], [c3, 1], [a, 2]]))
    const seen: Array<{ size: number; page: number; max: number }> = []
    const doc = await track(client(workers)).read({ type: 'file', path: '/x.pdf' }, { rasterizer: hostRasterizer(seen) })
    expect(doc.title).toBe('1,1,1,2')
    const carrying = workers.fromWorker.filter((m) => m.type === 'raster' && m.op === 'pdf' && m.pdf)
    expect(carrying).toHaveLength(4)
    expect(workers.sent('raster-result').filter((m) => m.type === 'raster-result' && m.missing)).toHaveLength(1)
  })

  it('sin dibujante en el principal, el proceso de lectura tampoco lo tiene (las páginas quedan por leer)', async () => {
    const pdf = new Uint8Array(10)
    const doc = await track(client(new MemoryWorkers(rasterReader([[pdf, 1]])))).read({ type: 'file', path: '/x.pdf' }, {})
    expect(doc.title).toBe('-1')
    expect(doc.pages[0].text).toBe('sin imagen')
    const docNoImages = await track(client(new MemoryWorkers(rasterReader([[pdf, 4]])))).read({ type: 'file', path: '/x.pdf' }, { rasterizer: hostRasterizer([], false) })
    expect(docNoImages.title).toBe('4')
    expect(docNoImages.pages[0].text).toBe('sin imagen')
  })

  it('el puente responde a cada petición por su id', async () => {
    const posted: Array<{ id: number; pdf?: Uint8Array }> = []
    const bridge = new RasterBridge((m) => posted.push(m.op === 'pdf' ? { id: m.id, pdf: m.pdf } : { id: m.id }))
    const r = bridge.forCall(1, { rasterPdf: true, rasterImage: false }) as PageRasterizer
    expect(r.imageToPng).toBeUndefined()
    const pdf = new Uint8Array([1, 2, 3])
    const p1 = r.renderPdfPage(pdf, 1, 100)
    const p2 = r.renderPdfPage(pdf, 2, 100)
    expect(posted.map((p) => [p.id, !!p.pdf])).toEqual([[1, true], [2, false]])
    bridge.settle(2, { png: fakePNG(2) })
    bridge.settle(1, { png: null })
    bridge.settle(99, { png: null })
    expect(await p2).toEqual(fakePNG(2))
    expect(await p1).toBeNull()
    expect(bridge.forCall(2, { rasterPdf: false, rasterImage: true })).toBeUndefined()
  })
})
