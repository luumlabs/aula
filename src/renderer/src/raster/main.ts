// Página oculta que dibuja páginas de PDF (y convierte imágenes) a PNG para el OCR de lo escaneado. El proceso principal
// la llama con `executeJavaScript` (ver src/main/electron/rasterizer.ts); no tiene puente ni acceso a nada más.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Doc = pdfjs.PDFDocumentProxy
const docs = new Map<string, Doc>()
const MAX_DOCS = 3

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

async function canvasPng(canvas: OffscreenCanvas): Promise<string> {
  return toBase64(await canvas.convertToBlob({ type: 'image/png' }))
}

const api = {
  /** Abre (o reutiliza) un PDF con su huella; los más antiguos se cierran. */
  async open(key: string, b64: string): Promise<number> {
    const hit = docs.get(key)
    if (hit) return hit.numPages
    const doc = await pdfjs.getDocument({ data: fromBase64(b64), isEvalSupported: false, disableFontFace: false }).promise
    docs.set(key, doc)
    while (docs.size > MAX_DOCS) {
      const [old] = docs.keys()
      void docs.get(old)?.destroy()
      docs.delete(old)
    }
    return doc.numPages
  },
  has(key: string): boolean {
    return docs.has(key)
  },
  /** PNG (base64) de la página `page` (desde 1) con el lado largo de `maxDimension` px; null si no existe. */
  async render(key: string, page: number, maxDimension: number): Promise<string | null> {
    const doc = docs.get(key)
    if (!doc || page < 1 || page > doc.numPages) return null
    const p = await doc.getPage(page)
    const base = p.getViewport({ scale: 1 })
    const scale = Math.min(4096, Math.max(64, maxDimension)) / Math.max(base.width, base.height)
    const viewport = p.getViewport({ scale })
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // fondo blanco: el OCR lee mejor que sobre transparente
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await p.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise
    p.cleanup()
    return canvasPng(canvas)
  },
  close(key: string): void {
    void docs.get(key)?.destroy()
    docs.delete(key)
  },
  /** Imagen (AVIF, WebP, BMP…) → PNG con la orientación EXIF aplicada; null si el navegador no la sabe leer. */
  async imageToPng(b64: string, maxDimension: number): Promise<string | null> {
    try {
      const bitmap = await createImageBitmap(new Blob([fromBase64(b64) as BlobPart]), { imageOrientation: 'from-image' })
      const scale = Math.min(1, Math.min(4096, maxDimension) / Math.max(bitmap.width, bitmap.height))
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      return canvasPng(canvas)
    } catch {
      return null
    }
  }
}

;(window as unknown as { __raster: typeof api }).__raster = api
document.title = 'ready'
