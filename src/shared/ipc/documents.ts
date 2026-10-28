// Documentos: la biblioteca (materiales de los cursos y archivos importados), el lector con subrayados y notas, Aula sobre lo
// que se lee y los documentos para estudiar en papel (PDF, Word, Markdown). Lo implementa src/main/services/documents.
import type {
  DocumentAIRequest, DocumentAIUpdate, DocumentAnnotation, DocumentCardDraft, DocumentCardTarget, DocumentEntry, DocumentHit, DocumentKind,
  DocumentLibrary, DocumentPlan, DocumentRef, DocumentRequest, DocumentSearchHit, DocumentView
} from '../documents/types'

export interface DocumentImportResult {
  imported: DocumentEntry[]
  failed: { name: string; message: string }[]
}

export interface DocumentRenderResult {
  /** Para guardar este mismo PDF sin volver a dibujarlo (`documents.save`). */
  token: string
  pages: number
  data: Uint8Array
  title: string
  baseName: string
}

export interface DocumentSaveArgs {
  request: DocumentRequest
  /** El PDF ya dibujado con `documents.renderPDF` (si el formato es PDF). */
  token?: string
  /** «file»: diálogo de guardar; «course»: en el curso (Referencia → Documentos). */
  target: 'file' | 'course'
}

export interface DocumentSaveResult {
  path: string
  savedId?: string
}

export interface DocumentAIStatus {
  available: boolean
  vision: boolean
  provider?: string
}

declare module './contract' {
  interface RpcMethods {
    /** Todos los documentos: materiales de cada curso, archivos importados y documentos creados por Aula. */
    'documents.library': { args: void; result: DocumentLibrary }
    /** Abre un documento en el lector (lo apunta en «Recientes»). */
    'documents.open': { args: { ref: DocumentRef }; result: DocumentView }
    /** Busca en el texto de todos los documentos (o de un curso). */
    'documents.search': { args: { query: string; courseId?: string; limit?: number }; result: DocumentSearchHit[] }
    /** Busca dentro de un documento (páginas y fragmentos). */
    'documents.find': { args: { ref: DocumentRef; query: string }; result: DocumentHit[] }
    /** Importa archivos (rutas de `api.pathForFile`) a Documentos. El progreso llega por 'documents.importProgress'. */
    'documents.import': { args: { paths: string[] }; result: DocumentImportResult }
    /** Elige archivos con el diálogo del sistema y los importa. null = cancelado. */
    'documents.pick': { args: void; result: DocumentImportResult | null }
    /** Quita un documento importado o creado (los materiales de un curso se quitan desde el curso). */
    'documents.remove': { args: { ref: DocumentRef }; result: void }
    /** Los bytes del original de un documento que el protocolo aula-asset:// no sirve (los PDF que creó Aula en un curso). */
    'documents.fileData': { args: { ref: DocumentRef }; result: { data: Uint8Array } }
    /** Muestra el original en la carpeta del sistema. */
    'documents.reveal': { args: { ref: DocumentRef }; result: void }
    /** Recuerda la página donde se dejó la lectura. */
    'documents.setPage': { args: { ref: DocumentRef; page: number }; result: void }
    'documents.annotations': { args: { ref: DocumentRef }; result: DocumentAnnotation[] }
    /** Añade o sustituye (mismo id) una marca. Devuelve todas, ordenadas. */
    'documents.annotate': { args: { ref: DocumentRef; annotation: DocumentAnnotation }; result: DocumentAnnotation[] }
    'documents.unannotate': { args: { ref: DocumentRef; id: string }; result: DocumentAnnotation[] }
    /** ¿Hay una IA para Aula en el lector? (y si ve imágenes). */
    'documents.aiStatus': { args: void; result: DocumentAIStatus }
    /** Pide a Aula una acción sobre el documento; la respuesta llega por 'documents.ai'. */
    'documents.aiStart': { args: DocumentAIRequest; result: { jobId: string } }
    'documents.aiCancel': { args: { jobId: string }; result: void }
    /** Cursos y lecciones donde se pueden guardar tarjetas (primero el curso del documento). */
    'documents.cardTargets': { args: { ref?: DocumentRef }; result: DocumentCardTarget[] }
    /** Guarda tarjetas en una lección (se puede deshacer desde el historial de cambios). */
    'documents.saveCards': { args: { ref?: DocumentRef; courseId: string; skillId: string; cards: DocumentCardDraft[]; page?: number }; result: { saved: number } }
    /** El plan del documento (qué va en él), para la vista previa. */
    'documents.plan': { args: { request: DocumentRequest }; result: DocumentPlan }
    /** Los tipos que no salen del curso y las lecciones de la petición (su `kind` no cuenta), con el motivo. */
    'documents.kinds': { args: { request: DocumentRequest }; result: { unavailable: Partial<Record<DocumentKind, string>> } }
    /** Dibuja el PDF (vista de impresión en una ventana oculta). */
    'documents.renderPDF': { args: { request: DocumentRequest }; result: DocumentRenderResult }
    /** Guarda el documento (PDF, Word o Markdown) donde diga el estudiante o en el curso. null = cancelado. */
    'documents.save': { args: DocumentSaveArgs; result: DocumentSaveResult | null }
    /** Muestra en la carpeta del sistema un documento que se acaba de guardar (solo los guardados en esta sesión). */
    'documents.revealSaved': { args: { path: string }; result: void }
  }
  interface RpcEvents {
    'documents.ai': DocumentAIUpdate
    /** La biblioteca cambió (importación, marcas, documentos guardados). */
    'documents.changed': { key?: string }
    'documents.importProgress': { name: string; fraction: number; message: string }
  }
}
export {}
