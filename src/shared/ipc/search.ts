// Búsqueda en toda la biblioteca (⌘K): lecciones, ejercicios, glosario, fórmulas y materiales de todos los cursos (BM25).
// Lo implementa src/main/services/search/library.ts.

export type LibraryHitKind = 'lesson' | 'exercise' | 'glossary' | 'formula' | 'material'

export interface LibraryHit {
  /** Único en la lista («<curso>/<tipo>/<…>»). */
  id: string
  kind: LibraryHitKind
  courseID: string
  courseTitle: string
  /** Tema, término, fórmula o material. */
  title: string
  /** ≈ 200 caracteres alrededor de la coincidencia, con las coincidencias entre `**…**`. */
  snippet: string
  /** Lección o ejercicio: el tema al que pertenece. */
  skillID?: string
  /** Material: la fuente y su página. */
  sourceID?: string
  page?: number
  score: number
}

export interface LibrarySearchResult {
  hits: LibraryHit[]
  /** Cursos que aún se están indexando (la interfaz vuelve a preguntar en un momento). */
  pending: number
}

/** Límite de resultados que se pueden pedir. */
export const LIBRARY_SEARCH_MAX = 50

declare module './contract' {
  interface RpcMethods {
    /** Busca en todos los cursos. `q` vacía o de menos de 2 caracteres → sin resultados. */
    'search.query': { args: { q: string; limit?: number }; result: LibrarySearchResult }
  }
}
export {}
