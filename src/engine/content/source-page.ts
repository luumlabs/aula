// La página de un material del curso como base de una figura (port de StudyEngine/Content/SourcePage.swift): la página de un
// PDF o la foto misma. Aquí la parte pura (qué se puede dibujar y su proporción a partir de los bytes); la lectura del
// archivo la hace el proceso principal.
import type { SourceMeta, SourceRef } from '@shared/schema'
import { imageSize } from './asset-meta'

export const PHOTO_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'tiff', 'tif', 'gif', 'webp', 'bmp'])

/** Lo que hace falta saber de un PDF para dibujar una página: cuántas hay y su caja (ancho, alto, giro). */
export interface PdfInfo { pages: number; boxes: Array<{ width: number; height: number; rotate: number }> }

const latin1 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 0x8000)))
  return s
}

/** Lectura ligera de un PDF (sin descomprimir): páginas y cajas de las que están a la vista. undefined si no es un PDF. */
export function inspectPdf(bytes: Uint8Array): PdfInfo | undefined {
  const head = latin1(bytes.subarray(0, 8))
  if (!head.startsWith('%PDF')) return undefined
  const text = latin1(bytes)
  const box = (s: string): { width: number; height: number } | undefined => {
    const m = /\/(?:CropBox|MediaBox)\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(s)
    if (!m) return undefined
    const w = Math.abs(Number(m[3]) - Number(m[1])), h = Math.abs(Number(m[4]) - Number(m[2]))
    return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : undefined
  }
  const inherited = box(text)
  const boxes: PdfInfo['boxes'] = []
  const re = /<<((?:(?!>>)[\s\S]){0,4000}?)\/Type\s*\/Page(?![a-zA-Z])([\s\S]{0,4000}?)>>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const dict = m[1] + m[2]
    const b = box(dict) ?? inherited
    const rot = /\/Rotate\s+(-?\d+)/.exec(dict)
    if (b) boxes.push({ ...b, rotate: rot ? Number(rot[1]) : 0 })
  }
  let pages = boxes.length
  if (!pages) {
    // páginas dentro de flujos comprimidos: el /Count del árbol, si está a la vista
    const counts = [...text.matchAll(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)|\/Count\s+(\d+)[\s\S]{0,200}?\/Type\s*\/Pages/g)].map((x) => Number(x[1] ?? x[2]))
    pages = counts.length ? Math.max(...counts) : 0
  }
  return { pages, boxes }
}

/** La página (1…n) se puede dibujar y su proporción (ancho / alto tal como se ve), o undefined si no se puede. */
export function pdfPageAspect(info: PdfInfo, page: number): { drawable: boolean; aspect?: number } {
  const p = Math.max(1, Math.trunc(page))
  if (!(p <= info.pages)) return { drawable: false }
  const b = info.boxes[p - 1] ?? info.boxes[0]
  if (!b) return { drawable: true }
  if (!(b.width > 1 && b.height > 1)) return { drawable: false }
  const rotated = ((b.rotate % 180) + 180) % 180 !== 0
  const [w, h] = rotated ? [b.height, b.width] : [b.width, b.height]
  return { drawable: true, aspect: w / h }
}

/** Lo que el proceso principal le da a `locateSourcePage`: el material, la extensión del original y sus bytes. */
export interface SourceOriginal { meta: SourceMeta; ext: string; bytes: Uint8Array }

/** ¿Se puede dibujar la referencia (PDF con esa página o una foto)? Con la proporción de la página si se sabe. */
export function locateSourcePage(ref: SourceRef, original: SourceOriginal | undefined): { page: number; pdf: boolean; aspect?: number } | undefined {
  if (!original || original.meta.id !== ref.source) return undefined
  const page = Math.max(1, ref.page ?? 1)
  const ext = original.ext.toLowerCase()
  if (ext === 'pdf') {
    const info = inspectPdf(original.bytes)
    if (!info) return undefined
    const r = pdfPageAspect(info, page)
    return r.drawable ? { page, pdf: true, ...(r.aspect !== undefined ? { aspect: r.aspect } : {}) } : undefined
  }
  if (PHOTO_EXTENSIONS.has(ext) && page === 1) {
    const size = imageSize(original.bytes)
    // HEIC/TIFF no se miden aquí: se aceptan como fotos sin proporción conocida
    if (size) return size[1] > 0 ? { page: 1, pdf: false, aspect: size[0] / size[1] } : undefined
    return ['heic', 'heif', 'tiff', 'tif'].includes(ext) ? { page: 1, pdf: false } : undefined
  }
  return undefined
}
