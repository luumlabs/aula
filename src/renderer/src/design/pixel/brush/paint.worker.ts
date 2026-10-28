// Hilo aparte para dibujar los personajes: pintar un fotograma cuesta 1–5 ms (y la primera vez a un tamaño, preparar el
// papel y el pulso de la mano, algo más); aquí no le roba nunca un fotograma a la interfaz. Devuelve un ImageBitmap.
import { paintBoard, paintDrawing, type InkInfo, type Painting } from './painter'
import { DRAWINGS, type DrawingName } from './drawings'
import { paintRigFrame, rigOf } from './rigs'
import './cast'

export interface FrameJob {
  id: number
  W: number
  stride: number
  dark: boolean
  variant: number
  dpr: number
  /** Personaje dibujado a mano: su id y las operaciones del fotograma. */
  rig?: string
  ops?: string
  /** Si no: el tablero y cómo se lee. */
  px?: (string | null)[]
  info?: { line: string[]; family: [string, string][]; strokes: 'all' | 'dabs' | 'any'; plain?: boolean }
  /** Un dibujo suelto (la medalla, la llama, el sol y la luna del saludo) con sus colores y su fotograma. */
  drawing?: { name: DrawingName; colors: Record<string, string>; frame: number }
}

function paint(job: FrameJob): Painting {
  const t = { W: job.W, stride: job.stride, dark: job.dark, variant: job.variant, dpr: job.dpr }
  if (job.drawing) return paintDrawing(DRAWINGS[job.drawing.name](job.drawing.colors, job.drawing.frame), t)
  const rig = job.rig ? rigOf(job.rig) : undefined
  if (rig && job.ops !== undefined) return paintRigFrame(rig, job.ops, t)
  const info: InkInfo = { line: new Set(job.info?.line ?? []), family: new Map(job.info?.family ?? []), strokes: job.info?.strokes ?? 'all', plain: job.info?.plain }
  return paintBoard(job.px ?? [], info, t)
}

self.onmessage = (e: MessageEvent<FrameJob>) => {
  const job = e.data
  try {
    const p = paint(job)
    const canvas = new OffscreenCanvas(p.width, p.height)
    canvas.getContext('2d')?.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0)
    const bitmap = canvas.transferToImageBitmap()
    ;(self as unknown as Worker).postMessage({ id: job.id, bitmap }, [bitmap])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: job.id, error: String(err) })
  }
}
