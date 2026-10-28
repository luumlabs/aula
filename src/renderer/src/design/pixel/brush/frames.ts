// Los fotogramas dibujados a mano, hechos UNA vez y guardados: cada (personaje, fotograma, tamaño, papel, dibujo del
// «hervor») se pinta la primera vez que hace falta y luego es un mapa de bits que se copia en el lienzo (sin coste por
// fotograma). Se pintan en un hilo aparte (paint.worker.ts), por orden de prioridad (lo que se ve, primero), así el hilo
// de la interfaz nunca tiene tareas largas; si no hay hilo, en el principal, con un presupuesto por fotograma.
import { opsOf, type CompiledAnim, type Px } from '../anim'
import { paintBoard, type InkInfo, type Painting } from './painter'
import { familiesOf, lineColorsOf } from './trace'
import { paintRigFrame, rigOf } from './rigs'
import type { FrameJob } from './paint.worker'
import { DRAWINGS, type DrawingName } from './drawings'
import { paintDrawing } from './painter'
import './cast'

// ——— cómo se dibuja cada personaje ———
const infos = new WeakMap<CompiledAnim, InkInfo>()
/** Qué es línea, qué familias de color tiene y cómo van sus líneas de color (calculado una vez por personaje). */
export function inkInfoOf(anim: CompiledAnim): InkInfo {
  let info = infos.get(anim)
  if (!info) {
    const look = anim.look
    const line = look?.line ? new Set(look.line) : lineColorsOf(anim.base, look?.outline)
    info = look?.plain ? { line, strokes: look.strokes ?? 'any', plain: true } : { line, family: familiesOf(anim.base, line), strokes: look?.strokes ?? 'all' }
    infos.set(anim, info)
  }
  return info
}

/** El muñeco dibujado a mano de este fotograma, si el personaje lo tiene (y el fotograma salió de su historia). */
function rigFrame(anim: CompiledAnim, px: Px[]): { rig: string; ops: string } | null {
  const id = anim.look?.id
  if (!id || !rigOf(id)) return null
  const ops = opsOf(px)
  return ops === undefined ? null : { rig: id, ops }
}

/** Pinta un fotograma aquí mismo (pruebas, o sin hilo aparte). */
export function paintFrame(anim: CompiledAnim, px: Px[], W: number, dark: boolean, variant: number, dpr: number): Painting {
  const t = { W, stride: anim.stride, dark, variant, dpr }
  const r = rigFrame(anim, px)
  if (r) return paintRigFrame(rigOf(r.rig)!, r.ops, t)
  return paintBoard(px, inkInfoOf(anim), t)
}

// ——— el almacén (con límite de memoria: se tira lo que lleva más tiempo sin usarse) ———
export type FrameImage = ImageBitmap | HTMLCanvasElement
const BUDGET = 64 * 1024 * 1024
const store = new WeakMap<Px[], Map<string, FrameImage>>()
const lru = new Map<FrameImage, { px: Px[]; key: string; bytes: number }>()
let bytes = 0

const keyOf = (anim: CompiledAnim, W: number, dark: boolean, variant: number) => `${anim.look?.id ?? ''}|${W}|${dark ? 1 : 0}|${variant}`

function remember(px: Px[], key: string, img: FrameImage): void {
  let m = store.get(px)
  if (!m) store.set(px, (m = new Map()))
  m.set(key, img)
  const b = img.width * img.height * 4
  lru.set(img, { px, key, bytes: b })
  bytes += b
  for (const [old, e] of lru) {
    if (bytes <= BUDGET) break
    lru.delete(old)
    store.get(e.px)?.delete(e.key)
    bytes -= e.bytes
    if ('close' in old) old.close()
  }
}

/** El fotograma ya pintado, si lo está. */
export function peekFrame(anim: CompiledAnim, px: Px[], W: number, dark: boolean, variant: number): FrameImage | undefined {
  const img = store.get(px)?.get(keyOf(anim, W, dark, variant))
  if (img) {
    const e = lru.get(img)
    if (e) {
      lru.delete(img)
      lru.set(img, e)
    }
  }
  return img
}

// ——— la cola: por prioridad (0 = se ve y es el dibujo quieto … 3 = adelantar una historia) ———
export const PRIORITY = { visible: 0, playing: 1, hidden: 2, ahead: 3 } as const

interface Job {
  anim: CompiledAnim
  px: Px[]
  W: number
  dark: boolean
  variant: number
  dpr: number
  priority: number
  seq: number
  done: ((img: FrameImage) => void)[]
}
const queue = new Map<string, Job>()
const jobIds = new WeakMap<Px[], number>()
let nextJob = 1
let seq = 0

function jobKey(anim: CompiledAnim, px: Px[], W: number, dark: boolean, variant: number): string {
  let id = jobIds.get(px)
  if (!id) jobIds.set(px, (id = nextJob++))
  return `${id}|${keyOf(anim, W, dark, variant)}`
}

/** Pide el fotograma; `done` (si se da) se llama al tenerlo. Si ya estaba pedido, sube su prioridad si hace falta. */
export function requestFrame(anim: CompiledAnim, px: Px[], W: number, dark: boolean, variant: number, dpr: number, priority: number, done?: (img: FrameImage) => void): void {
  const hit = peekFrame(anim, px, W, dark, variant)
  if (hit) {
    done?.(hit)
    return
  }
  const k = jobKey(anim, px, W, dark, variant)
  let job = queue.get(k) ?? inflight.get(k)
  if (!job) queue.set(k, (job = { anim, px, W, dark, variant, dpr, priority, seq: seq++, done: [] }))
  else if (priority < job.priority) job.priority = priority
  if (done) job.done.push(done)
  pump()
}

// ——— el hilo de pintura ———
let worker: Worker | null | undefined
const inflight = new Map<string, Job>()
const byId = new Map<number, string>()
const drawJobs = new Map<number, (img: FrameImage) => void>()
let nextId = 1
/** Pedidos a la vez en el hilo: pocos, para que lo que pase a verse se pueda adelantar en la cola. */
const MAX_INFLIGHT = 3

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('sin hilo')
    worker = new Worker(new URL('./paint.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
      const dj = drawJobs.get(e.data.id)
      if (dj) {
        drawJobs.delete(e.data.id)
        if (e.data.bitmap) dj(e.data.bitmap)
        return
      }
      const k = byId.get(e.data.id)
      byId.delete(e.data.id)
      const job = k ? inflight.get(k) : undefined
      if (k) inflight.delete(k)
      if (job && e.data.bitmap) {
        remember(job.px, keyOf(job.anim, job.W, job.dark, job.variant), e.data.bitmap)
        for (const f of job.done) f(e.data.bitmap)
      } else if (job) {
        // si el hilo falla con un fotograma, se pinta aquí
        const img = paintHere(job)
        for (const f of job.done) f(img)
      }
      pump()
    }
    worker.onerror = () => {
      // sin hilo (o se cayó): lo pendiente se pinta en el principal
      worker = null
      for (const [k, job] of inflight) queue.set(k, job)
      inflight.clear()
      byId.clear()
      pump()
    }
  } catch {
    worker = null
  }
  return worker
}

function next(): [string, Job] | null {
  let best: [string, Job] | null = null
  for (const e of queue) if (!best || e[1].priority < best[1].priority || (e[1].priority === best[1].priority && e[1].seq < best[1].seq)) best = e
  return best
}

let scheduled = false
function pump(): void {
  const w = getWorker()
  if (w) {
    while (inflight.size < MAX_INFLIGHT && queue.size) {
      const [k, job] = next()!
      queue.delete(k)
      const id = nextId++
      byId.set(id, k)
      inflight.set(k, job)
      const r = rigFrame(job.anim, job.px)
      const msg: FrameJob = { id, W: job.W, stride: job.anim.stride, dark: job.dark, variant: job.variant, dpr: job.dpr }
      if (r) Object.assign(msg, r)
      else {
        const info = inkInfoOf(job.anim)
        msg.px = job.px
        msg.info = { line: [...info.line], family: [...(info.family ?? new Map())], strokes: info.strokes ?? 'all', plain: info.plain }
      }
      w.postMessage(msg)
    }
    return
  }
  // sin hilo: en el principal, sin pasar de unos milisegundos por fotograma de pantalla
  if (scheduled || !queue.size) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    const t0 = performance.now()
    while (queue.size && performance.now() - t0 < 6) {
      const [k, job] = next()!
      queue.delete(k)
      const img = paintHere(job)
      for (const f of job.done) f(img)
    }
    pump()
  })
}

function paintHere(job: Job): FrameImage {
  const p = paintFrame(job.anim, job.px, job.W, job.dark, job.variant, job.dpr)
  const c = document.createElement('canvas')
  c.width = p.width
  c.height = p.height
  c.getContext('2d')?.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0)
  remember(job.px, keyOf(job.anim, job.W, job.dark, job.variant), c)
  return c
}

/** Para pruebas y medidas: cuánto ocupa el almacén y cuánto queda por pintar. */
export function frameStoreStats(): { frames: number; bytes: number; queued: number; inflight: number } {
  return { frames: lru.size, bytes, queued: queue.size, inflight: inflight.size }
}

// ——— dibujos sueltos (la medalla, la llama, el sol y la luna del saludo) ———
export interface DrawingSpec {
  name: DrawingName
  colors: Record<string, string>
  frame: number
}
const drawStore = new Map<string, FrameImage>()
const drawWaiting = new Map<string, ((img: FrameImage) => void)[]>()
const drawKey = (d: DrawingSpec, W: number, dark: boolean) => `${d.name}|${d.frame}|${W}|${dark ? 1 : 0}|${Object.entries(d.colors).map(([k, v]) => k + v).join(',')}`

/** El dibujo ya pintado, si lo está. */
export function peekDrawing(d: DrawingSpec, W: number, dark: boolean): FrameImage | undefined {
  return drawStore.get(drawKey(d, W, dark))
}

/** Pide un dibujo suelto (en el hilo de pintura si lo hay). */
export function requestDrawing(d: DrawingSpec, W: number, dark: boolean, dpr: number, done: (img: FrameImage) => void): void {
  const key = drawKey(d, W, dark)
  const hit = drawStore.get(key)
  if (hit) return done(hit)
  const waiting = drawWaiting.get(key)
  if (waiting) {
    waiting.push(done)
    return
  }
  drawWaiting.set(key, [done])
  const finish = (img: FrameImage) => {
    drawStore.set(key, img)
    if (drawStore.size > 240) {
      const first = drawStore.keys().next().value as string
      const old = drawStore.get(first)
      drawStore.delete(first)
      if (old && 'close' in old) old.close()
    }
    for (const f of drawWaiting.get(key) ?? []) f(img)
    drawWaiting.delete(key)
  }
  const w = getWorker()
  const stride = 28
  if (w) {
    const id = nextId++
    drawJobs.set(id, finish)
    const msg: FrameJob = { id, W, stride, dark, variant: 0, dpr, drawing: d }
    w.postMessage(msg)
    return
  }
  requestAnimationFrame(() => {
    const p = paintDrawing(DRAWINGS[d.name](d.colors, d.frame), { W, stride, dark, variant: 0, dpr })
    const c = document.createElement('canvas')
    c.width = p.width
    c.height = p.height
    c.getContext('2d')?.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0)
    finish(c)
  })
}
