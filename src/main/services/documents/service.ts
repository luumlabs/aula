// Lo que pide la interfaz de Documentos, sin Electron: abrir un documento, sus marcas y Aula en el lector (con la respuesta
// llegando a trozos y cancelable). El IPC (src/main/electron/handlers/documents.ts) solo valida y reenvía.
import { IDs } from '@engine/base/ids'
import type { DocumentAIRequest, DocumentAIUpdate, DocumentAnnotation, DocumentRef, DocumentView } from '@shared/documents'
import type { Pack } from '@shared/schema'
import { orderedSkills } from '@shared/schema'
import { isCancellation, resolveActiveModel, withAIUse } from '../ai'
import { toErrorInfo } from '../errors'
import { DocumentAnnotationStore } from './annotations'
import { runDocumentAI } from './ai'
import { withDocumentFake } from './fake'
import { entryForLocated, touchRecent } from './library'
import { locate } from './locate'
import { searchPages } from './pages'
import { loadPages, readView } from './reading'

/** Abre un documento para el lector y lo apunta en «Recientes». */
export async function openDocument(ref: DocumentRef): Promise<DocumentView> {
  const doc = locate(ref)
  const view = await readView(doc)
  touchRecent(ref)
  return { entry: entryForLocated(doc), ...view }
}

export function annotationStore(ref: DocumentRef): DocumentAnnotationStore {
  const doc = locate(ref)
  return new DocumentAnnotationStore(doc.annotationsFile, doc.title, doc.annotationsKey)
}

/** Busca dentro de un documento. */
export async function findInDocument(ref: DocumentRef, query: string): Promise<ReturnType<typeof searchPages>> {
  return searchPages(await loadPages(locate(ref)), query, 60)
}

/** Lo que se sabe del examen del curso (para «¿Qué entra en el examen?»). */
export function examContext(pack: Pack | undefined): string | undefined {
  if (!pack) return undefined
  const s: string[] = []
  if (pack.exam) {
    s.push(`Exam: ${pack.exam.title}` + (pack.exam.date ? ` on ${pack.exam.date.slice(0, 10)}` : ''))
    if (pack.exam.notes) s.push(`What the professor said: ${Array.from(pack.exam.notes).slice(0, 800).join('')}`)
  }
  if (pack.blueprint?.sections.length) s.push('Exam sections: ' + pack.blueprint.sections.map((x) => `${x.title} (${x.count} questions)`).join('; '))
  const skills = orderedSkills(pack)
  if (skills.length) s.push('Course lessons: ' + skills.slice(0, 20).map((x) => x.title).join('; '))
  return s.length ? s.join('\n') : undefined
}

/** Las respuestas de Aula en marcha (una nueva no cancela las otras: cada panel cancela la suya). */
export class DocumentAIJobs {
  private readonly jobs = new Map<string, AbortController>()

  constructor(private readonly emit: (u: DocumentAIUpdate) => void) {}

  /** Empieza una acción; devuelve su id. La respuesta llega por `emit`. */
  start(req: DocumentAIRequest): string {
    const jobId = IDs.short(10)
    const ctrl = new AbortController()
    this.jobs.set(jobId, ctrl)
    void this.run(jobId, req, ctrl.signal).finally(() => this.jobs.delete(jobId))
    return jobId
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.abort()
    this.jobs.delete(jobId)
  }

  cancelAll(): void {
    for (const c of this.jobs.values()) c.abort()
    this.jobs.clear()
  }

  private async run(jobId: string, req: DocumentAIRequest, signal: AbortSignal): Promise<void> {
    let last = 0
    let text = ''
    try {
      const doc = locate(req.ref)
      const pages = await loadPages(doc)
      const courseID = doc.store?.id
      const result = await withAIUse({ purpose: 'documents', ...(courseID ? { courseID } : {}), label: doc.title }, async () => {
        // la IA simulada (pruebas, vídeo) responde con el texto del documento
        const model = withDocumentFake(await resolveActiveModel(), req.action, pages, req.language)
        return runDocumentAI(req.action, pages, {
          model, language: req.language, examContext: examContext(doc.pack), pageImage: req.pageImage, signal,
          onText: (t) => {
            text = t
            // a trozos, sin inundar el IPC (cada 60 ms como mucho)
            const now = Date.now()
            if (now - last > 60) { last = now; this.emit({ jobId, text: t, done: false }) }
          }
        })
      })
      if (signal.aborted) return this.emit({ jobId, text, done: true })
      const out: DocumentAIUpdate = { jobId, text: result.text, done: true, cited: result.cited }
      if (req.action.type === 'cards') out.cards = result.cards
      this.emit(out)
    } catch (err) {
      if (signal.aborted || isCancellation(err)) return this.emit({ jobId, text, done: true })
      const info = toErrorInfo(err)
      this.emit({ jobId, text, done: true, error: { message: info.message, code: info.code } })
    }
  }
}

export type { DocumentAnnotation }
