// Tipos del historial de cambios de Aula («Deshacer lo que cambió Aula»), de StudyModel/History. La lógica vive en el
// proceso principal (`@main/services/store/history`); aquí solo lo que viaja por el IPC.
import type { ISODate } from './coding'

/** Quién hizo un grupo de cambios. */
export const CHANGE_ACTOR_KINDS = ['chat', 'tutor', 'pipeline', 'automation', 'memory', 'undo', 'other'] as const
export type ChangeActorKind = (typeof CHANGE_ACTOR_KINDS)[number]

export interface ChangeActor {
  kind: ChangeActorKind
  /** Id del grupo: un turno, una ejecución. Todos los cambios con el mismo grupo se deshacen juntos. */
  group: string
  /** Lo que se pidió o lo que hizo («Pedir cambios: añade ejercicios de identidades»). */
  label: string
  /** Curso al que se refiere (si es de uno). */
  courseID?: string
}

/** A qué pertenece un archivo del historial. */
export const CHANGE_DOMAINS = ['course', 'calendar', 'memory', 'other'] as const
export type ChangeDomain = (typeof CHANGE_DOMAINS)[number]

/** Lo que hizo un grupo en un archivo (primer «antes» y último «después» del grupo). */
export interface FileChange {
  /** Ruta relativa a la carpeta de Aula («Packs/quimica/skills/enlace.json»). */
  path: string
  domain: ChangeDomain
  courseID?: string
  /** Huella del contenido (undefined = el archivo no existía / se borró). */
  before?: string
  after?: string
  at: ISODate
}

/** Una línea legible de lo que cambió («Lección «Enlace iónico»: 3 ejercicios nuevos»). */
export interface ChangeLine {
  path: string
  text: string
}

/** Un grupo de cambios de Aula (un turno, una ejecución). */
export interface ChangeGroup {
  id: string
  kind: ChangeActorKind
  label: string
  courseID?: string
  startedAt: ISODate
  updatedAt: ISODate
  files: FileChange[]
  /** Ya se deshizo (y ese deshacer sigue en pie). */
  isUndone: boolean
  /** Si es un deshacer: los grupos que deshizo. */
  undid: string[]
}

/** Un grupo con sus frases, para la lista «Cambios de Aula». */
export interface ChangeGroupSummary extends ChangeGroup {
  lines: ChangeLine[]
}

export type UndoFileAction = 'restore' | 'remove' | 'recreate' | 'keep'

export interface UndoPlanFile {
  path: string
  domain: ChangeDomain
  /** Qué se hará: volver al estado de antes, borrarlo (Aula lo creó), recrearlo (Aula lo borró) o dejarlo. */
  action: UndoFileAction
  /** Partes que cambió otro después y se quedan como están. */
  conflicts: string[]
  /** No se puede (no hay copia): el grupo no se puede deshacer. */
  problem?: string
}

/** Lo que haría deshacer un grupo (para enseñarlo antes de confirmar). */
export interface UndoPlan {
  group: ChangeGroup
  /** Cambios de Aula posteriores en los mismos archivos que también se deshacen. */
  alsoUndo: ChangeGroup[]
  files: UndoPlanFile[]
  lines: ChangeLine[]
  conflicts: number
  problems: string[]
  canUndo: boolean
}

export interface UndoOptions {
  /** Deshacer también los cambios de Aula posteriores en los mismos archivos (si no, y los hay, no se hace nada). */
  includeLater?: boolean
  /** Mantener lo que cambió el estudiante después (fusión). false = volver exactamente al estado de antes. */
  keepLaterEdits?: boolean
}

export interface UndoResult {
  /** El grupo del propio deshacer (se puede deshacer a su vez). */
  undoGroupID: string
  undoneGroups: string[]
  files: string[]
  /** Partes en las que se mantuvo lo que cambió otro. */
  keptLaterEdits: string[]
}
