// Utilidades de la pantalla de Documentos: abrir un documento (también desde otras pantallas), iconos por tipo, plegado para
// buscar y las llamadas tipadas al proceso principal.
import type { IconName } from '@renderer/design'
import type { DocumentEntry, DocumentRef } from '@shared/documents'
import { docKey } from '@shared/documents'
import { navigate } from '@renderer/app/router'

/** Abre un documento en el lector de Aula (en una página, si se da). Lo pueden usar otras pantallas (p. ej. Materiales). */
export function openDocument(ref: DocumentRef, page?: number): void {
  navigate({ name: 'documents', doc: docKey(ref) + (page && page > 1 ? `@${page}` : '') })
}

/** Abre un material de un curso en el lector (atajo para las fuentes del curso y las citas «Apuntes · p. 12»). */
export function openCourseSource(packId: string, sourceId: string, page?: number): void {
  openDocument({ kind: 'source', packId, sourceId }, page)
}

export const KIND_ICON: Record<string, IconName> = {
  pdf: 'file-text', docx: 'file-text', doc: 'file-text', word: 'file-text', pptx: 'layers', ppt: 'layers', powerpoint: 'layers', key: 'layers',
  xlsx: 'database', csv: 'database', image: 'image', png: 'image', jpg: 'image', jpeg: 'image', web: 'globe', html: 'globe', url: 'globe',
  text: 'note', markdown: 'note', md: 'note', rtf: 'note', canvas: 'browser', epub: 'book', video: 'video', audio: 'audio'
}

export function kindIcon(kind: string): IconName {
  return KIND_ICON[kind.toLowerCase()] ?? 'file'
}

/** Nombre corto del tipo («PDF», «Word»…). */
export function kindLabel(kind: string): string {
  const k = kind.toLowerCase()
  if (k === 'pdf') return 'PDF'
  if (['docx', 'doc', 'word'].includes(k)) return 'Word'
  if (['pptx', 'ppt', 'powerpoint', 'key'].includes(k)) return 'PowerPoint'
  if (['xlsx', 'csv'].includes(k)) return 'Excel'
  if (['md', 'markdown'].includes(k)) return 'Markdown'
  if (k === 'epub') return 'EPUB'
  if (['web', 'html', 'url'].includes(k)) return 'Web'
  return k.toUpperCase().slice(0, 6)
}

/** Pliega sin cambiar la longitud (para buscar y resaltar sin acentos ni mayúsculas). */
export function foldKeep(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const code = ch.charCodeAt(0)
    if (code < 0x80) { out += ch.toLowerCase(); continue }
    if (code >= 0xd800 && code <= 0xdfff) { out += ch; continue }
    const base = ch.normalize('NFD')[0] ?? ch
    const low = base.toLowerCase()
    out += low.length === 1 ? low : base
  }
  return out
}

/** Para ordenar «Recientes». */
export function byOpened(a: DocumentEntry, b: DocumentEntry): number {
  return (b.opened ?? '').localeCompare(a.opened ?? '')
}

/** Los textos con `**coincidencias**` de la búsqueda, como trozos para pintar. */
export function boldParts(snippet: string): { text: string; bold: boolean }[] {
  return snippet.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (p.startsWith('**') && p.endsWith('**') ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false }))
}
