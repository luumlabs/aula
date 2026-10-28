// pdf.js en la interfaz: se carga la primera vez que hace falta, con su «worker» servido por la propia app (CSP: worker-src
// 'self') y sin `eval`. Los PDF llegan por el protocolo aula-asset:// (el proceso principal solo sirve lo que está dentro de la
// carpeta de datos). Guarda unos pocos documentos abiertos y las miniaturas ya dibujadas.
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { DocumentEntry } from '@shared/documents'
import { api } from '@renderer/lib/api'

type PdfLib = typeof import('pdfjs-dist')

let lib: Promise<PdfLib> | null = null

export function pdfjs(): Promise<PdfLib> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default
    return m
  }).catch((e: unknown) => {
    lib = null
    throw e
  })
  return lib
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

/** Abre un PDF por su URL (aula-asset://…) o sus bytes. Los últimos cuatro se guardan abiertos. */
export function openPdf(url: string, data?: Uint8Array): Promise<PDFDocumentProxy> {
  const key = data ? `${url}#${data.length}` : url
  const hit = docs.get(key)
  if (hit) {
    docs.delete(key)
    docs.set(key, hit)
    return hit
  }
  const p = (async () => {
    const m = await pdfjs()
    const bytes = data ?? new Uint8Array(await (await fetch(url)).arrayBuffer())
    return m.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: true }).promise
  })()
  p.catch(() => docs.delete(key))
  docs.set(key, p)
  while (docs.size > 4) {
    const oldest = docs.keys().next().value as string
    void docs.get(oldest)?.then((d) => d.destroy()).catch(() => undefined)
    docs.delete(oldest)
  }
  return p
}

/** Clave de caché del PDF de un documento. */
export function pdfKey(entry: DocumentEntry): string {
  return entry.fileUrl ?? `doc:${entry.key}`
}

/** El PDF de un documento: por aula-asset:// o, si el protocolo no lo sirve (los que creó Aula), por IPC. */
export function openEntryPdf(entry: DocumentEntry): Promise<PDFDocumentProxy> {
  if (entry.fileUrl) return openPdf(entry.fileUrl)
  const key = pdfKey(entry)
  const hit = docs.get(key)
  if (hit) return hit
  const p = (async () => {
    const { data } = await api.invoke('documents.fileData', { ref: entry.ref })
    const m = await pdfjs()
    return m.getDocument({ data, isEvalSupported: false, enableXfa: false, useSystemFonts: true }).promise
  })()
  p.catch(() => docs.delete(key))
  docs.set(key, p)
  return p
}

/** Olvida un PDF abierto (al quitarlo de la biblioteca). */
export function forgetPdf(url: string): void {
  for (const k of [...docs.keys()]) if (k === url || k.startsWith(`${url}#`)) docs.delete(k)
}

const thumbs = new Map<string, string>()

/** Miniatura de una página (dataURL), con el ancho dado en píxeles CSS. */
export async function pageThumbnail(pdf: PDFDocumentProxy, key: string, page: number, width: number): Promise<string> {
  const id = `${key}|${page}|${width}`
  const hit = thumbs.get(id)
  if (hit) return hit
  const p = await pdf.getPage(page)
  const base = p.getViewport({ scale: 1 })
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const viewport = p.getViewport({ scale: (width / base.width) * dpr })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await p.render({ canvas, viewport }).promise
  const url = canvas.toDataURL('image/jpeg', 0.82)
  thumbs.set(id, url)
  while (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value as string)
  return url
}

/** La página como JPEG en base64 (para los modelos que ven), con el lado largo de unos 1400 px. */
export async function pageJPEG(page: PDFPageProxy): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(3, 1400 / Math.max(base.width, base.height)) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? ''
}

/** Las entradas del índice del PDF (marcadores) con su página y el final del capítulo. */
export async function pdfOutline(pdf: PDFDocumentProxy): Promise<{ title: string; page: number; endPage: number; level: number }[]> {
  const root = await pdf.getOutline().catch(() => null)
  if (!root?.length) return []
  const flat: { title: string; page: number; level: number }[] = []
  type Node = (typeof root)[number]
  const walk = async (nodes: Node[], level: number): Promise<void> => {
    for (const n of nodes) {
      let page = -1
      try {
        const dest = typeof n.dest === 'string' ? await pdf.getDestination(n.dest) : n.dest
        const ref = Array.isArray(dest) ? dest[0] : null
        if (ref && typeof ref === 'object') page = (await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
        else if (typeof ref === 'number') page = ref + 1
      } catch { /* destino roto */ }
      if (page >= 1) flat.push({ title: (n.title || '—').trim(), page, level })
      if (level < 2 && n.items?.length) await walk(n.items, level + 1)
      if (flat.length > 400) return
    }
  }
  await walk(root, 0)
  return flat.map((e, i) => {
    const next = flat.slice(i + 1).find((x) => x.level <= e.level)
    return { ...e, endPage: next ? Math.max(e.page, next.page - 1) : pdf.numPages }
  })
}
