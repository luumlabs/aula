// Contrato de la memoria del estudiante (Ajustes → Memoria): ver, corregir, olvidar, borrar todo y exportar lo que Aula recuerda.
// Lo implementa src/main/services/memory; el interruptor general es `settings.data.memory`.

/** De qué trata un recuerdo (mismas claves que la app Swift). */
export type MemoryKindName =
  | 'identity' | 'studies' | 'subject' | 'exam' | 'learning' | 'preference' | 'difficulty' | 'mistake' | 'strength' | 'goal' | 'schedule' | 'platform' | 'other'

/** De dónde salió: lo escribió el estudiante, el tutor, el chat con Aula, la práctica o al crear un curso. */
export type MemorySourceName = 'student' | 'tutor' | 'assistant' | 'practice' | 'course'

/** Un recuerdo tal como lo enseña el panel. */
export interface MemoryRecordView {
  id: string
  kind: MemoryKindName
  /** Sección del panel: about · learning · exams · progress · other. */
  group: 'about' | 'learning' | 'exams' | 'progress' | 'other'
  text: string
  source: MemorySourceName
  courseID?: string
  courseTitle?: string
  confidence: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
  /** active · expired (caducó) · superseded (lo sustituyó una corrección). */
  status: 'active' | 'expired' | 'superseded'
  sensitive: boolean
  editedByStudent: boolean
  uses: number
}

export interface MemoryStatus {
  enabled: boolean
  /** Hasta cuándo está en pausa el aprendizaje (ISO); sin valor = no está en pausa. */
  pausedUntil?: string
  active: number
  total: number
  /** Un error de disco o de borrado pendiente (sin texto de recuerdos). */
  problem?: string
}

declare module './contract' {
  interface RpcMethods {
    'memory.status': { args: void; result: MemoryStatus }
    /** Recuerdos del más reciente al más antiguo (con `includeInactive`, también los caducados y sustituidos). */
    'memory.list': { args: { includeInactive?: boolean; query?: string } | void; result: MemoryRecordView[] }
    /** El estudiante escribe algo para que Aula lo recuerde (cuenta como confirmado). */
    'memory.add': { args: { text: string; kind?: MemoryKindName }; result: MemoryRecordView }
    /** Corrige un recuerdo (queda como suyo: lo automático no lo pisa). */
    'memory.edit': { args: { id: string; text: string; kind?: MemoryKindName }; result: MemoryRecordView }
    /** Devuelve a la memoria activa uno caducado o sustituido. */
    'memory.restore': { args: { id: string }; result: void }
    /** Olvida para siempre (también de las copias del historial de cambios). */
    'memory.forget': { args: { ids: string[] }; result: { forgotten: string[] } }
    'memory.clear': { args: void; result: { forgotten: string[] } }
    /** Pausa el aprendizaje (`until` ISO; null reanuda; 'forever' hasta reanudarla). */
    'memory.pause': { args: { until: string | null }; result: MemoryStatus }
    /** Todo lo que Aula recuerda, como JSON legible (la interfaz lo guarda donde diga el estudiante). */
    'memory.export': { args: void; result: { fileName: string; json: string } }
  }
  interface RpcEvents {
    'memory.changed': { changed: true }
  }
}
export {}
