// Crear y ampliar cursos con el equipo de agentes (lo implementa src/main/services/pipeline).
import type { CreateRequest, MaterialView, RunSummary, RunView } from '../generation/types'

declare module './contract' {
  interface RpcMethods {
    /** Lee archivos (PDF, Word, PowerPoint, imágenes, EPUB…) al área de preparación; el progreso llega por 'create.material'. */
    'create.addFiles': { args: { paths: string[]; draftId?: string }; result: { draftId: string; materials: MaterialView[] } }
    'create.addText': { args: { text: string; title?: string; draftId?: string }; result: { draftId: string; materials: MaterialView[] } }
    'create.addURL': { args: { url: string; draftId?: string }; result: { draftId: string; materials: MaterialView[] } }
    'create.removeMaterial': { args: { draftId: string; materialId: string }; result: MaterialView[] }
    /** Los materiales de un borrador (al volver a «Nuevo curso» o tras cerrar Aula: A3-P1-3). */
    'create.draft': { args: { draftId: string }; result: MaterialView[] }
    /** «Descartar borrador»: borra lo leído. */
    'create.discardDraft': { args: { draftId: string }; result: void }
    /** «Materiales» de un curso: lo ya leído del borrador pasa al curso al momento. */
    'create.attachToCourse': { args: { packId: string; draftId: string }; result: { moved: number } }
    /** Empieza a crear el curso: devuelve la ejecución (el monitor la sigue con 'generation.update'). */
    'create.start': { args: { draftId?: string; request: CreateRequest }; result: { runId: string; packId: string } }
    /** «Pedir cambios a Aula»: amplía o corrige un curso existente. */
    'generation.extend': { args: { packId: string; instruction: string; skillId?: string }; result: { runId: string } }
    'generation.runs': { args: void; result: RunSummary[] }
    'generation.run': { args: { id: string }; result: RunView | null }
    'generation.cancel': { args: { id: string }; result: void }
    'generation.resume': { args: { id: string }; result: void }
    /** Terminar con lo que ya hay (tras un límite de uso o un fallo). */
    'generation.keep': { args: { id: string }; result: void }
    'generation.answer': { args: { id: string; questionId: string; answer: string }; result: void }
  }
  interface RpcEvents {
    'generation.update': RunView
    'create.material': { draftId: string; material: MaterialView }
  }
}
export {}
