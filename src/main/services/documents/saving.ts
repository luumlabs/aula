// Guardar documentos (port de DocumentSaving y CourseDocuments en DocumentServices.swift): sin pisar otro con el mismo nombre,
// con la carpeta de imágenes de Markdown al lado, y los que se guardan en el curso apuntados en `<curso>/documents/index.json`.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { IDs } from '@engine/base/ids'
import type { DocumentFormat, DocumentKind, SavedDocument } from '@shared/documents'
import { parseDocumentFormat, parseDocumentKind, safeFileName } from '@shared/documents'
import { vDate } from '@shared/schema'
import { writeFileAtomic } from '../fs'
import { writeJSONFile } from '../store/jsonFile'
import { withFileLock } from '../store/lock'
import { SafePath } from '../store/safePath'
import type { PackStore } from '../store/packStore'

export const FORMAT_EXTENSION: Record<DocumentFormat, string> = { pdf: 'pdf', docx: 'docx', markdown: 'md' }

/** Un documento ya dibujado, listo para escribir. */
export interface RenderedDocument {
  data: Uint8Array
  format: DocumentFormat
  pages: number
  title: string
  kind: DocumentKind
  /** Nombre de archivo sin extensión. */
  baseName: string
  /** Markdown: imágenes que van en una carpeta al lado. */
  attachments: { name: string; data: Uint8Array }[]
  courseID?: string
}

export function fileName(doc: RenderedDocument): string {
  return `${doc.baseName}.${FORMAT_EXTENSION[doc.format]}`
}

/** Carpeta de las imágenes de un Markdown («<nombre> — imágenes»). */
export function imageFolderName(base: string, lang: 'es' | 'en' = 'es'): string {
  return `${base} — ${lang === 'en' ? 'images' : 'imágenes'}`
}

/** Una ruta libre en `folder` («Nombre.pdf», «Nombre 2.pdf»…). */
export function freePath(folder: string, base: string, ext: string): string {
  let p = join(folder, `${base}.${ext}`)
  for (let n = 2; existsSync(p) && n < 10_000; n++) p = join(folder, `${base} ${n}.${ext}`)
  return p
}

/** Escribe el documento (y, en Markdown, su carpeta de imágenes) y devuelve la ruta final. `exact`: esa ruta (ya confirmada). */
export function writeRendered(doc: RenderedDocument, folder: string, opts: { exactPath?: string; lang?: 'es' | 'en' } = {}): string {
  mkdirSync(folder, { recursive: true })
  const ext = FORMAT_EXTENSION[doc.format]
  const target = opts.exactPath ?? freePath(folder, safeFileName(doc.baseName), ext)
  writeFileAtomic(target, doc.data)
  if (doc.format === 'markdown' && doc.attachments.length) {
    const base = basename(target, extname(target))
    const imgs = join(folder, imageFolderName(base, opts.lang))
    mkdirSync(imgs, { recursive: true })
    for (const a of doc.attachments) {
      const name = basename(a.name.replace(/\\/g, '/'))
      if (SafePath.isComponent(name)) writeFileAtomic(join(imgs, name), a.data)
    }
    // el .md apunta a la carpeta con el nombre que tenía al prepararse: se corrige si el archivo cambió de nombre
    if (base !== doc.baseName) {
      const text = Buffer.from(doc.data).toString('utf8').split(`](<${imageFolderName(doc.baseName, opts.lang)}/`).join(`](<${imageFolderName(base, opts.lang)}/`)
      writeFileAtomic(target, text)
    }
  }
  return target
}

// MARK: - Documentos guardados en el curso

export const COURSE_DOCUMENTS_FOLDER = 'documents'

export function courseDocumentsDir(store: PackStore): string {
  return join(store.directory, COURSE_DOCUMENTS_FOLDER)
}

function indexPath(store: PackStore): string {
  return join(courseDocumentsDir(store), 'index.json')
}

export function decodeSavedDocument(raw: unknown): SavedDocument | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  return {
    id: typeof o.id === 'string' && o.id ? o.id : IDs.short(8),
    kind: parseDocumentKind(o.kind) ?? 'summary',
    format: parseDocumentFormat(o.format) ?? 'pdf',
    title: typeof o.title === 'string' ? o.title : '',
    fileName: typeof o.fileName === 'string' ? o.fileName : '',
    pages: typeof o.pages === 'number' && Number.isFinite(o.pages) ? Math.max(0, Math.floor(o.pages)) : 0,
    created: vDate(o.created) ?? new Date().toISOString(),
    byAssistant: o.byAssistant === true
  }
}

function readIndex(store: PackStore): SavedDocument[] {
  try {
    const raw = JSON.parse(readFileSync(indexPath(store), 'utf8')) as unknown
    return Array.isArray(raw) ? raw.flatMap((x) => { const d = decodeSavedDocument(x); return d ? [d] : [] }) : []
  } catch {
    return []
  }
}

/** El archivo de un documento, solo si su nombre es un nombre suelto y queda dentro de la carpeta de documentos del curso. */
export function savedDocumentPath(doc: SavedDocument, store: PackStore): string | undefined {
  const dir = courseDocumentsDir(store)
  if (!SafePath.isComponent(doc.fileName)) return undefined
  const p = join(dir, doc.fileName)
  return SafePath.isInside(p, dir) ? p : undefined
}

/** Los documentos guardados (los que ya no están en disco se omiten), del más nuevo al más viejo. */
export function listCourseDocuments(store: PackStore): SavedDocument[] {
  return readIndex(store)
    .filter((d) => { const p = savedDocumentPath(d, store); return !!p && existsSync(p) })
    .sort((a, b) => b.created.localeCompare(a.created))
}

/** Guarda un documento en el curso y lo apunta en el índice. */
export function addCourseDocument(doc: RenderedDocument, store: PackStore, byAssistant: boolean, lang: 'es' | 'en' = 'es'): { saved: SavedDocument; path: string } {
  const dir = courseDocumentsDir(store)
  mkdirSync(dir, { recursive: true })
  const path = writeRendered(doc, dir, { lang })
  const saved: SavedDocument = { id: IDs.short(8), kind: doc.kind, format: doc.format, title: doc.title, fileName: basename(path), pages: doc.pages, created: new Date().toISOString(), byAssistant }
  withFileLock(join(dir, 'index.lock'), () => {
    const all = readIndex(store)
    all.push(saved)
    writeJSONFile(indexPath(store), all)
  })
  return { saved, path }
}

/** Quita un documento del curso (solo lo que está de verdad dentro de su carpeta de documentos). */
export function removeCourseDocument(id: string, store: PackStore): void {
  const dir = courseDocumentsDir(store)
  withFileLock(join(dir, 'index.lock'), () => {
    const all = readIndex(store)
    const d = all.find((x) => x.id === id)
    const p = d ? savedDocumentPath(d, store) : undefined
    if (d && p) {
      rmSync(p, { force: true })
      for (const l of ['es', 'en'] as const) {
        const images = join(dir, imageFolderName(basename(p, extname(p)), l))
        if (d.format === 'markdown' && SafePath.isInside(images, dir)) rmSync(images, { recursive: true, force: true })
      }
    }
    writeJSONFile(indexPath(store), all.filter((x) => x.id !== id))
  })
}
