// La captura vive sólo mientras vive la acción; el proceso principal es dueño de su ventana aislada.
import type { DrawingRenderSceneV1 } from '@shared/figuresDrawing'
import { api } from '@renderer/lib/api'
import { abortIfNeeded, bounded } from './snapshot'

export async function captureDrawingPng(scene: DrawingRenderSceneV1, signal: AbortSignal): Promise<Uint8Array> {
  abortIfNeeded(signal)
  const jobId = crypto.randomUUID()
  let cancelled = false
  const cancel = (): void => {
    if (cancelled) return
    cancelled = true
    void api.invoke('figures.cancelRender', { jobId }).catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const result = await bounded(api.invoke('figures.renderDrawingPng', { jobId, scene }), signal, 25_000)
    abortIfNeeded(signal)
    return result.data
  } catch (error) {
    cancel()
    throw error
  } finally { signal.removeEventListener('abort', cancel) }
}
