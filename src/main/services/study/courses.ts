// Cursos tal como los necesita el motor de estudio: el curso, sus habilidades (en el orden del plan), el progreso y si aún se
// está creando. Lee de la biblioteca de la carpeta de datos (o de la que se dé, en pruebas).
import { orderedSkills, type ItemID, type Pack, type Skill, type StudyProgress } from '@shared/schema'
import { tr } from '@shared/ai/i18n'
import { AulaError, invalidArgs } from '../errors'
import { log } from '../log'
import { getLibrary, LockTimeoutError, type Library, type PackStore } from '../store'
import { isPreparing } from '../calendar/preparation'

export interface CourseData {
  store: PackStore
  pack: Pack
  skills: Skill[]
  progress: StudyProgress
  /** Aún se está creando (sin plan ni nota). */
  generating: boolean
}

let libraryOverride: Library | null = null

/** La biblioteca que usa el estudio (pruebas: una carpeta temporal). */
export function setStudyLibrary(lib: Library | null): void {
  libraryOverride = lib
}

export function studyLibrary(): Library {
  return libraryOverride ?? getLibrary()
}

/** El almacén de un curso o un error «not_found». */
export function requireStore(packId: unknown): PackStore {
  if (typeof packId !== 'string' || !packId) throw invalidArgs(tr('Falta el curso', 'The course is missing'))
  const store = studyLibrary().openPack(packId)
  if (!store) throw new AulaError('not_found', tr('Ese curso no existe', 'That course doesn’t exist'))
  return store
}

function generatingOf(store: PackStore): boolean {
  try { return isPreparing(store) } catch { return false }
}

/** Habilidades del curso en el orden del plan (las que faltan o están dañadas se saltan). */
export function loadSkills(store: PackStore, pack: Pack): Skill[] {
  return store.loadSkills(orderedSkills(pack).map((s) => s.id))
}

export function loadCourse(packId: ItemID): CourseData {
  const store = requireStore(packId)
  let pack: Pack
  try { pack = store.loadPack() } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new AulaError('invalid_pack', tr(`No se pudo leer el curso: ${reason}`, `Couldn’t read the course: ${reason}`))
  }
  return { store, pack, skills: loadSkills(store, pack), progress: store.loadProgress(), generating: generatingOf(store) }
}

/** Todos los cursos que se pueden leer (los dañados se saltan). */
export function loadAllCourses(): CourseData[] {
  const lib = studyLibrary()
  const out: CourseData[] = []
  for (const id of lib.packIDs()) {
    const store = lib.openPack(id)
    if (!store) continue
    try {
      const pack = store.loadPack()
      out.push({ store, pack, skills: loadSkills(store, pack), progress: store.loadProgress(), generating: generatingOf(store) })
    } catch (err) {
      log.warn(`Curso ilegible ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}

/** Todos los progresos (para la racha de todos los cursos), salvo el de `except`. */
export function allProgress(except?: ItemID): StudyProgress[] {
  const lib = studyLibrary()
  const out: StudyProgress[] = []
  for (const id of lib.packIDs()) {
    if (id === except) continue
    const store = lib.openPack(id)
    if (store) out.push(store.loadProgress())
  }
  return out
}

/** Sustituye en su sitio el contenido de `target` por el de `next` (el almacén guarda el objeto que le dio a `body`). */
export function replaceProgress(target: StudyProgress, next: StudyProgress): void {
  const t = target as unknown as Record<string, unknown>
  for (const k of Object.keys(t)) if (!(k in next)) delete t[k]
  Object.assign(target, next)
}

/** Lee, cambia y guarda el progreso con cerrojo. Un cerrojo ocupado es un error claro. */
export function updateProgress<T>(store: PackStore, change: (p: StudyProgress) => { progress: StudyProgress; value: T }): T {
  try {
    return store.updateProgress((p) => {
      const r = change(p)
      replaceProgress(p, r.progress)
      return r.value
    })
  } catch (err) {
    if (err instanceof LockTimeoutError) throw new AulaError('busy', tr('El progreso está ocupado: inténtalo de nuevo en un momento.', 'Progress is busy: try again in a moment.'))
    throw err
  }
}
