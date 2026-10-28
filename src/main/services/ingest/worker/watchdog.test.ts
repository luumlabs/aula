// A2-P1-3 / A2-P2-17: el lector aparte tiene vigilante. Un proceso de lectura que se queda colgado (pdf.js sin ceder el hilo no
// atiende ni la cancelación) se reinicia: la lectura colgada falla con un error claro y las siguientes no esperan para siempre.
import { afterEach, describe, expect, it } from 'vitest'
import type { SourceDocument } from '@shared/ingest'
import { CancelledError, isIngestError } from '../errors'
import { IngestWorkerClient, type WorkerProcess } from './client'
import type { FromWorker, ToWorker } from './protocol'

const doc = (title: string): SourceDocument => ({ title, kind: 'text', pages: [{ number: 1, text: title, usedOCR: false, hasFigures: false }], metadata: {}, warnings: [] })

/** Procesos falsos: las lecturas de «hang…» no responden nunca (ni a «cancel»); las demás, a los `delay` ms. */
function fakeWorkers(delay = 30): { spawn: () => WorkerProcess; spawned: () => number; killed: () => number } {
  let spawned = 0
  let killed = 0
  const spawn = (): WorkerProcess => {
    spawned++
    let alive = true
    const handlers: Array<(m: unknown) => void> = []
    const exits: Array<(c: number) => void> = []
    const send = (m: FromWorker): void => { setTimeout(() => { if (alive) handlers.forEach((h) => h(structuredClone(m))) }, 0) }
    send({ type: 'ready' })
    return {
      post: (m: ToWorker) => {
        if (!alive) throw new Error('cerrado')
        if (m.type !== 'read') return
        const path = m.input.type === 'file' ? m.input.path : ''
        if (path.startsWith('hang')) return
        setTimeout(() => send({ type: 'result', id: m.id, result: doc(path) }), delay)
      },
      onMessage: (h) => { handlers.push(h) },
      onExit: (h) => { exits.push(h) },
      kill: () => { if (!alive) return; alive = false; killed++; setTimeout(() => exits.forEach((h) => h(0)), 0) }
    }
  }
  return { spawn, spawned: () => spawned, killed: () => killed }
}

let client: IngestWorkerClient | undefined
afterEach(() => { client?.dispose(); client = undefined })

describe('A2-P1-3 · vigilante del lector aparte', () => {
  it('una lectura colgada: pasado el plazo, el proceso se reinicia y la lectura falla con un error claro', async () => {
    const w = fakeWorkers()
    client = new IngestWorkerClient({ spawn: w.spawn, settings: () => ({ language: 'es' }) as never, stallMs: 150, idleMs: 0 })
    const t0 = Date.now()
    const err = await client.read({ type: 'file', path: 'hang.pdf' }, {}).catch((e: unknown) => e)
    expect(isIngestError(err)).toBe(true)
    expect(String((err as Error).message)).toContain('tardó demasiado')
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(w.killed()).toBe(1)
    // la siguiente lectura va a un proceso nuevo y funciona
    expect((await client.read({ type: 'file', path: 'ok.pdf' }, {})).title).toBe('ok.pdf')
    expect(w.spawned()).toBe(2)
    expect(client.state.recycled).toBe(1)
  })

  it('cancelar una lectura que el proceso no suelta: se reinicia y la otra lectura en curso vuelve a la cola (no espera 40 s)', async () => {
    const w = fakeWorkers(200)
    client = new IngestWorkerClient({ spawn: w.spawn, settings: () => ({ language: 'es' }) as never, cancelGraceMs: 80, stallMs: 0, idleMs: 0, concurrency: 2 })
    const ctl = new AbortController()
    const stuck = client.read({ type: 'file', path: 'hang.pdf' }, { signal: ctl.signal })
    const other = client.read({ type: 'file', path: 'other.pdf' }, {})
    setTimeout(() => ctl.abort(), 20)
    await expect(stuck).rejects.toBeInstanceOf(CancelledError)
    const t0 = Date.now()
    expect((await other).title).toBe('other.pdf')
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(w.killed()).toBe(1)
    expect(client.state.running).toBe(0)
  })

  it('un proceso que trabaja y responde no se reinicia', async () => {
    const w = fakeWorkers(40)
    client = new IngestWorkerClient({ spawn: w.spawn, settings: () => ({ language: 'es' }) as never, stallMs: 150, idleMs: 0 })
    for (let i = 0; i < 5; i++) expect((await client.read({ type: 'file', path: `f${i}` }, {})).title).toBe(`f${i}`)
    await new Promise((r) => setTimeout(r, 250))
    expect(w.killed()).toBe(0)
    expect(client.state.recycled).toBe(0)
  })
})

describe('A2-P2-16 · el dibujante de páginas no deja el OCR colgado', () => {
  it('si el proceso principal no contesta, la página se da por no dibujada (antes: «STILL PENDING» para siempre)', async () => {
    const { RasterBridge } = await import('./server')
    const bridge = new RasterBridge(() => { /* nadie contesta */ }, 60)
    const r = bridge.forCall(1, { rasterPdf: true, rasterImage: true })!
    const t0 = Date.now()
    expect(await r.renderPdfPage(new Uint8Array([1, 2, 3]), 1, 100)).toBeNull()
    expect(await r.imageToPng!(new Uint8Array([1]), 100)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
