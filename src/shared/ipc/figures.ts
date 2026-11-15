import type { FigureSaveArgs, FigureSaveResult } from '../figures'
import type { DrawingRenderSceneV1 } from '../figuresDrawing'

declare module './contract' {
  interface RpcMethods {
    /** Exporta una figura mediante el diálogo del equipo local. null = cancelado; nunca admite una ruta de destino. */
    'figures.save': { args: FigureSaveArgs; result: FigureSaveResult | null }
    /** Escena cerrada, renderizada en una ventana aislada del escritorio local. */
    'figures.renderDrawingPng': { args: { jobId: string; scene: DrawingRenderSceneV1 }; result: { data: Uint8Array; width: number; height: number } }
    'figures.cancelRender': { args: { jobId: string }; result: void }
    /** Solo archivos guardados desde esta ventana durante esta sesión. */
    'figures.revealSaved': { args: { path: string }; result: void }
  }
}
export {}
