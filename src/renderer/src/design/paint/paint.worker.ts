// Hilo aparte para dibujar: las recetas tardan unos milisegundos y así nunca roban un fotograma a la interfaz.
import { renderPaint, type PaintSpec } from './recipes'

interface Req {
  id: number
  spec: PaintSpec
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, spec } = e.data
  try {
    const blob = await renderPaint(spec).convertToBlob({ type: 'image/png' })
    ;(self as unknown as Worker).postMessage({ id, blob })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
