// Cursos, progreso e historial de cambios de Aula: la biblioteca en disco vista desde la interfaz.
import type {
  ChangeGroupSummary, CourseMetaPatch, ItemID, Pack, PackSummary, Skill, StudyProgress, UndoPlan, UndoResult
} from '../schema'

export interface CourseExportArgs {
  id: ItemID
  /** Incluir el progreso personal (y notas, subrayados y documentos). Por defecto, no. */
  includeProgress?: boolean
}

export interface CourseExportResult {
  /** Archivo `.aulapack` escrito (elegido por el estudiante en el diálogo de guardar). */
  path: string
}

export interface CourseImportArgs {
  /** Archivo `.aulapack` ya elegido (p. ej. arrastrado a la ventana). Si falta, se pregunta con un diálogo. */
  path?: string
  /** Si el curso ya está: conservar los dos, sustituirlo o no importar. Si falta, se pregunta con un diálogo (J2-24). */
  ifDuplicate?: 'keepBoth' | 'replace' | 'cancel'
}

export interface CourseImportResult {
  /** Id (único) con el que quedó el curso importado. */
  id: ItemID
}

export interface HistoryListArgs {
  /** Solo los cambios que tocaron este curso (o se hicieron para él). */
  courseId?: ItemID
  /** Como mucho (por defecto 50, máximo 200). */
  limit?: number
}

export interface HistoryUndoArgs {
  groupId: string
  /** Deshacer también los cambios de Aula posteriores en los mismos archivos. Por defecto, sí. */
  includeLater?: boolean
  /** Mantener lo que cambió el estudiante después. Por defecto, sí. */
  keepLaterEdits?: boolean
}

declare module './contract' {
  interface RpcMethods {
    /** Los cursos, del actualizado más recientemente al más antiguo. */
    'courses.list': { args: void; result: PackSummary[] }
    /** El curso (`pack.json`), o null si no existe. */
    'courses.get': { args: { id: ItemID }; result: Pack | null }
    /** El contenido de una habilidad, o null si no existe. */
    'courses.getSkill': { args: { id: ItemID; skillId: ItemID }; result: Skill | null }
    /** Todas las habilidades del curso que se pueden leer, en el orden del plan. */
    'courses.getSkills': { args: { id: ItemID }; result: Skill[] }
    /** Cambia los metadatos (título, icono, color, examen…). Devuelve el curso guardado. */
    'courses.update': { args: { id: ItemID; patch: CourseMetaPatch }; result: Pack }
    /** Manda el curso a la papelera. */
    'courses.delete': { args: { id: ItemID }; result: void }
    /** Exporta a `.aulapack` (pregunta dónde con un diálogo). null = cancelado. */
    'courses.export': { args: CourseExportArgs; result: CourseExportResult | null }
    /** Importa un `.aulapack` (con diálogo si no se da la ruta). null = cancelado. */
    'courses.import': { args: CourseImportArgs | void; result: CourseImportResult | null }
    'progress.get': { args: { id: ItemID }; result: StudyProgress }
    'progress.save': { args: { id: ItemID; progress: StudyProgress }; result: void }
    /** Los cambios de Aula, del más reciente al más antiguo, con sus frases. */
    'history.list': { args: HistoryListArgs | void; result: ChangeGroupSummary[] }
    /** Lo que haría deshacer un grupo (sin tocar nada). */
    'history.plan': { args: HistoryUndoArgs; result: UndoPlan }
    'history.undo': { args: HistoryUndoArgs; result: UndoResult }
  }
  interface RpcEvents {
    /** Un curso cambió en disco (lo escribiera este proceso u otro). */
    'courses.changed': { packId: ItemID }
  }
}
export {}
