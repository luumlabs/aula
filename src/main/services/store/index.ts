// Almacén de cursos en disco (port de StudyModel/Store.swift, PackZip.swift, Watch.swift e History/): punto de entrada para
// el resto del proceso principal. `getLibrary()` da la biblioteca de la carpeta de datos y `onCourseChanged` avisa cuando un
// curso cambia, lo escriba este proceso o otro (el ayudante MCP de un agente CLI).
import type { ItemID } from '@shared/schema'
import { log } from '../log'
import { paths } from '../paths'
import { Library } from './library'
import { watchPacks, type PacksWatcher } from './watcher'
import { tidyDataFolder } from './maintenance'

export * from './library'
export * from './packStore'
export * from './packZip'
export * from './watcher'
export * from './samples'
export * from './safePath'
export { tidyDataFolder, type TidyReport } from './maintenance'
export { withFileLock, withFileLocks, LockTimeoutError } from './lock'
export { jsonBytes, readJSONFile, tryReadJSONFile, writeJSONFile } from './jsonFile'
export { ChangeHistory, HistoryError, courseIDOfPath, groupCourseIDs, type HistoryFileHost, type RecordOptions } from './history/changeHistory'
export { ChangeContext, actorKindTitle } from './history/context'
export { describeChange } from './history/describer'
export { JSONMerge } from './history/jsonMerge'

let shared: Library | null = null

/** La biblioteca de la carpeta de datos de Aula (una por proceso; se rehace si cambia la carpeta, p. ej. en pruebas). */
export function getLibrary(): Library {
  const root = paths.root()
  if (!shared || shared.root !== root) {
    shared = new Library(root)
    shared.onPackWrite = (id) => notifyCourseChanged(id)
  }
  return shared
}

// MARK: Avisos de cambios

type Listener = (packId: ItemID) => void
const listeners = new Set<Listener>()
const pending = new Map<ItemID, ReturnType<typeof setTimeout>>()
/** Las escrituras llegan a ráfagas (habilidad + pack.json): un aviso por curso cada tanto. */
const COALESCE_MS = 120

/** Escucha los cambios de cualquier curso. Devuelve la función para dejar de escuchar. */
export function onCourseChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Avisa (agrupando las ráfagas) de que `packId` cambió. */
export function notifyCourseChanged(packId: ItemID): void {
  if (pending.has(packId)) return
  pending.set(packId, setTimeout(() => {
    pending.delete(packId)
    for (const fn of [...listeners]) {
      try { fn(packId) } catch (err) { log.warn('Aviso de cambio de curso', err) }
    }
  }, COALESCE_MS))
}

let watcher: PacksWatcher | null = null
let tidied = false

/** Empieza a vigilar `Packs/` (lo que escriben otros procesos). Idempotente. Un rato después ordena la carpeta de datos (una
 *  vez por ejecución: papelera vieja, adjuntos huérfanos, depuración de ejecuciones antiguas). */
export function startCourseWatcher(): void {
  if (watcher) return
  watcher = watchPacks(getLibrary().packsDirectory, (id) => notifyCourseChanged(id))
  if (!tidied) {
    tidied = true
    const root = getLibrary().root
    setTimeout(() => {
      try { tidyDataFolder(root) } catch (err) { log.warn('Orden de la carpeta de datos', err) }
    }, 45_000).unref?.()
  }
}

export function stopCourseWatcher(): void {
  watcher?.stop()
  watcher = null
}
