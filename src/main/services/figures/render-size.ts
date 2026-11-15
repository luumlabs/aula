import { FIGURE_LIMITS as L, FigureValidationError } from '@shared/figures'
import type { DrawingRenderBounds } from '@shared/figuresDrawing'
import { DRAWING_LIMITS } from '@engine/figures/drawing'
const fail = (): never => { throw new FigureValidationError('too_large') }
export function checkRenderSize(width: number, height: number): void {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= L.maxDimension) || width * height > L.maxPixels) fail()
}
export function drawingCaptureSize(bounds: DrawingRenderBounds, scale: 1 | 2, physicalScale: number): { width: number; height: number; outputWidth: number; outputHeight: number; scale: number } {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || Math.max(Math.abs(bounds.x), Math.abs(bounds.y), bounds.width, bounds.height) > DRAWING_LIMITS.maxSceneExtent) fail()
  if (!Number.isFinite(physicalScale) || physicalScale < .5 || physicalScale > 8) fail()
  const outputScale = Math.min(scale, L.maxDimension / bounds.width, L.maxDimension / bounds.height, Math.sqrt(L.maxPixels / (bounds.width * bounds.height)))
  const outputWidth = Math.max(1, Math.floor(bounds.width * outputScale)), outputHeight = Math.max(1, Math.floor(bounds.height * outputScale))
  // Un píxel de holgura en el techo evita que el redondeo de Chromium exceda el presupuesto físico.
  const maxCss = Math.floor((L.maxDimension - 1) / physicalScale)
  const captureScale = Math.min(outputScale / physicalScale, maxCss / bounds.width, maxCss / bounds.height)
  const width = Math.max(1, Math.ceil(bounds.width * captureScale)), height = Math.max(1, Math.ceil(bounds.height * captureScale))
  checkRenderSize(Math.ceil(width * physicalScale), Math.ceil(height * physicalScale)); checkRenderSize(outputWidth, outputHeight)
  // Captura nativa + decoder + canvas + salida (RGBA) nunca superan 256 MiB; PNG/base64 tienen presupuesto aparte.
  if ((Math.ceil(width * physicalScale) * Math.ceil(height * physicalScale) * 2 + outputWidth * outputHeight * 2) * 4 > 256 * 1024 * 1024) fail()
  return { width, height, outputWidth, outputHeight, scale: Math.min(width / bounds.width, height / bounds.height) }
}
export function privatePngSize(data: Uint8Array): { width: number; height: number } {
  if (data.byteLength < 33 || data.byteLength > L.maxPngBytes) fail()
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) throw new FigureValidationError()
  const width = header.getUint32(16), height = header.getUint32(20)
  checkRenderSize(width, height)
  return { width, height }
}
