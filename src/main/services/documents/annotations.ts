// Subrayados y notas en documentos (port de DocumentAnnotations.swift). Se guardan aparte, en JSON, sin tocar el original:
// `<curso>/annotations/<material>.json` para los materiales de un curso o `<datos>/Documents/annotations/<clave>.json` para los
// demás (importados y documentos creados). Lo que propone Aula llega con `author = aula`. Escrituras atómicas con cerrojo:
// dos guardados a la vez (el estudiante subraya mientras se aprueban las marcas de Aula) no se pisan.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { IDs } from '@engine/base/ids'
import type { DocumentAnnotation, DocumentAnnotationFile } from '@shared/documents'
import { decodeAnnotation } from '@shared/documents'
import { writeJSONFile } from '../store/jsonFile'
import { withFileLock } from '../store/lock'

/** Máximo de marcas por documento (como Swift). */
export const MAX_ANNOTATIONS = 10_000

const byPageThenDate = (a: DocumentAnnotation, b: DocumentAnnotation): number => a.page - b.page || a.created.localeCompare(b.created)

/** Lee un archivo de anotaciones con tolerancia: una marca dañada se salta (no se pierden las demás). */
export function decodeAnnotationFile(raw: unknown): DocumentAnnotationFile {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const items = Array.isArray(o.items)
    ? o.items.flatMap((x) => { const a = decodeAnnotation(x, () => IDs.short(8)); return a ? [a] : [] }).slice(0, MAX_ANNOTATIONS)
    : []
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    title: typeof o.title === 'string' ? o.title : '',
    key: typeof o.key === 'string' ? o.key : '',
    items
  }
}

/** Una marca nueva con los valores por defecto (id corto, fechas de ahora). */
export function makeAnnotation(p: Partial<DocumentAnnotation> & { page: number; text: string }): DocumentAnnotation {
  const now = new Date().toISOString()
  const a: DocumentAnnotation = {
    id: p.id ?? IDs.short(8), page: p.page, kind: p.kind ?? 'highlight', color: p.color ?? 'yellow', rects: p.rects ?? [],
    text: Array.from(p.text).slice(0, 2000).join(''), author: p.author ?? 'student', created: p.created ?? now, updated: p.updated ?? now
  }
  if (p.note !== undefined) a.note = p.note
  return a
}

export class DocumentAnnotationStore {
  constructor(readonly file: string, readonly title: string, readonly key: string) {}

  private get lockPath(): string { return `${this.file}.lock` }

  load(): DocumentAnnotation[] {
    if (!existsSync(this.file)) return []
    try {
      return decodeAnnotationFile(JSON.parse(readFileSync(this.file, 'utf8'))).items.sort(byPageThenDate)
    } catch {
      return []
    }
  }

  count(): number {
    return this.load().length
  }

  private write(items: DocumentAnnotation[]): void {
    if (!items.length) {
      rmSync(this.file, { force: true })
      return
    }
    const file: DocumentAnnotationFile = { version: 1, title: this.title, key: this.key, items }
    writeJSONFile(this.file, file)
  }

  /** Lee, cambia y guarda dentro del cerrojo. Devuelve todas, ordenadas por página y fecha. */
  modify(change: (all: DocumentAnnotation[]) => DocumentAnnotation[] | void): DocumentAnnotation[] {
    return withFileLock(this.lockPath, () => {
      const all = this.load()
      const next = (change(all) ?? all).slice(0, MAX_ANNOTATIONS)
      this.write(next)
      return [...next].sort(byPageThenDate)
    })
  }

  /** Añade o sustituye (mismo id; la fecha de cambio se pone al día). */
  upsert(a: DocumentAnnotation): DocumentAnnotation[] {
    return this.modify((all) => {
      const i = all.findIndex((x) => x.id === a.id)
      if (i >= 0) all[i] = { ...a, created: all[i].created, updated: new Date().toISOString() }
      else all.push(a)
    })
  }

  remove(id: string): DocumentAnnotation[] {
    return this.modify((all) => all.filter((x) => x.id !== id))
  }
}
