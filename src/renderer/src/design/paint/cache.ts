// Cada dibujo se hace UNA vez por sesión (en un hilo aparte) y se guarda como imagen: en pantalla es una máscara quieta,
// sin filtros ni trabajo por fotograma. La misma receta + semilla + tamaño da siempre el mismo dibujo.
import { renderPaint, type PaintSpec } from './recipes'

const ready = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

/** Clave estable de una pintura (los tamaños ya vienen redondeados por quien la pide). */
export function paintKey(spec: PaintSpec): string {
  return `${spec.kind}:${spec.seed}:${spec.w}x${spec.h}@${spec.scale ?? 1}`
}

/** La pintura ya hecha, si la hay (para no parpadear al volver a una pantalla). */
export function peekPaint(spec: PaintSpec): string | undefined {
  return ready.get(paintKey(spec))
}

/** Pinta (o devuelve la ya pintada): una URL `blob:` de la máscara. */
export function requestPaint(spec: PaintSpec): Promise<string> {
  const key = paintKey(spec)
  const done = ready.get(key)
  if (done) return Promise.resolve(done)
  let p = pending.get(key)
  if (!p) {
    p = render(spec).then((blob) => {
      const url = URL.createObjectURL(blob)
      ready.set(key, url)
      pending.delete(key)
      return url
    })
    p.catch(() => pending.delete(key))
    pending.set(key, p)
  }
  return p
}

// ───────────── El hilo de pintura ─────────────

let worker: Worker | null | undefined
let nextId = 1
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./paint.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.blob) w.resolve(e.data.blob)
      else w.reject(new Error(e.data.error ?? 'paint'))
    }
    worker.onerror = () => {
      // sin hilo (o se cayó): lo pendiente se pinta en el principal
      for (const w of waiting.values()) w.reject(new Error('paint worker'))
      waiting.clear()
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

function render(spec: PaintSpec): Promise<Blob> {
  const w = getWorker()
  if (w) {
    const id = nextId++
    return new Promise<Blob>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      w.postMessage({ id, spec })
    }).catch(() => renderHere(spec))
  }
  return renderHere(spec)
}

/** Plan B: en el hilo principal, cuando haya un hueco. */
function renderHere(spec: PaintSpec): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const run = () => {
      try {
        renderPaint(spec).convertToBlob({ type: 'image/png' }).then(resolve, reject)
      } catch (e) {
        reject(e)
      }
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 600 })
    else setTimeout(run, 16)
  })
}
