// Cursos «en preparación» (CoursePreparation.swift) sobre el almacén de un curso: lee los registros de creación de
// `Packs/<id>/runs/` (`run-*.json`, `<run>.findings.json`, `<run>.kept.json`, con los nombres de la app Swift).
import { join } from 'node:path'
import {
  decodePreparationFindings, decodePreparationRun, pendingPreparation, preparationSnapshot, type PreparationFindings, type PreparationRun,
  type PreparationSnapshot
} from '@engine/calendar'
import { parseISODate } from '@engine/calendar/time'
import { tryReadJSONFile, writeJSONFile } from '../store/jsonFile'
import type { PackStore } from '../store/packStore'

function runFile(store: PackStore, name: string): string {
  return join(store.runsDirectory, `${name}.json`)
}

/** Las creaciones y ampliaciones del curso (de la más reciente a la más antigua). */
export function previousRuns(store: PackStore): PreparationRun[] {
  return store.listNames('runs')
    .filter((n) => n.startsWith('run-') && !n.includes('.'))
    .map((n) => decodePreparationRun(tryReadJSONFile(runFile(store, n))))
    .filter((r): r is PreparationRun => r !== null)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
}

function isKept(store: PackStore, runID: string): boolean {
  const raw = tryReadJSONFile(runFile(store, `${runID}.kept`))
  return typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).kept === true
}

function findings(store: PackStore, runID: string): PreparationFindings | null {
  return decodePreparationFindings(tryReadJSONFile(runFile(store, `${runID}.findings`)))
}

/** La creación más reciente si aún no terminó y el curso todavía no está listo para estudiar (`null` = curso normal). */
export function pendingCreation(store: PackStore): PreparationRun | null {
  let skills = 0
  try { skills = store.loadPack().skills.length } catch { skills = 0 }
  return pendingPreparation(previousRuns(store), skills, (id) => isKept(store, id))
}

export function isPreparing(store: PackStore): boolean {
  return pendingCreation(store) !== null
}

/** El estudiante detuvo la creación y se queda con lo que hay: desde ahora es un curso normal. */
export function keepAsIs(store: PackStore, runID: string): void {
  try { writeJSONFile(runFile(store, `${runID}.kept`), { kept: true }) } catch { /* sin permiso: sigue en preparación */ }
}

/** Lo que ya se sabe del curso en preparación (para su tarjeta). */
export function preparationSnapshotOf(store: PackStore, runID: string | null): PreparationSnapshot | null {
  let pack
  try { pack = store.loadPack() } catch { return null }
  const run = runID ? decodePreparationRun(tryReadJSONFile(runFile(store, runID))) : null
  const date = pack.exam?.date ? parseISODate(pack.exam.date) ?? undefined : undefined
  return preparationSnapshot({
    title: pack.title, subject: pack.subject, exam: pack.exam ? { title: pack.exam.title, date, notes: pack.exam.notes } : undefined,
    skillTitles: pack.skills.map((s) => s.title), sourceCount: pack.sources.length
  }, run, runID ? findings(store, runID) : null)
}
