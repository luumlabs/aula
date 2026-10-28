// Orden de la carpeta de datos (para que no crezca sin fin): se hace una vez, un rato después de abrir la app, y solo toca lo
// que Aula sabe que sobra:
//   · `Eliminados/<curso>-<fecha>`: los cursos borrados cuando la papelera del sistema no estaba; como una papelera, 30 días.
//   · `Assistant/Packs/<id>`: adjuntos de una conversación que ya no existe (se adjuntó algo y no se llegó a enviar), 7 días.
//   · `Packs/<curso>/runs/*.args/` y `*.errores.log`: lo que se guardó para depurar una ejecución de la IA, 30 días.
// Nada de esto es progreso, contenido de un curso ni memoria del estudiante.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { log } from '../log'

const DAY = 86_400_000
export const TRASH_KEEP_DAYS = 30
export const ORPHAN_FILES_KEEP_DAYS = 7
export const RUN_DEBUG_KEEP_DAYS = 30

export interface TidyReport {
  trash: number
  orphanFiles: number
  runDebug: number
}

const list = (dir: string): string[] => {
  try { return readdirSync(dir) } catch { return [] }
}

/** Fecha de la última modificación (ms) de una carpeta o archivo y de lo que tiene dentro (un nivel). */
function lastTouched(path: string): number {
  let t = 0
  try { t = statSync(path).mtimeMs } catch { return Infinity }
  for (const n of list(path)) {
    try { t = Math.max(t, statSync(join(path, n)).mtimeMs) } catch { /* nada */ }
  }
  return t
}

function remove(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** Los ids (en forma de archivo) de todas las conversaciones que existen: las del chat y las del tutor de cada curso. */
function threadNames(root: string): Set<string> {
  const out = new Set<string>()
  const add = (dir: string): void => {
    for (const n of list(dir)) if (n.endsWith('.json') && !n.startsWith('.')) out.add(n.slice(0, -5))
  }
  add(join(root, 'Assistant', 'threads'))
  for (const pack of list(join(root, 'Packs'))) add(join(root, 'Packs', pack, 'chats'))
  return out
}

export function tidyDataFolder(root: string, now: Date = new Date()): TidyReport {
  const report: TidyReport = { trash: 0, orphanFiles: 0, runDebug: 0 }
  const t = now.getTime()
  // 1) la papelera propia
  const bin = join(root, 'Eliminados')
  for (const n of list(bin)) {
    const p = join(bin, n)
    if (t - lastTouched(p) > TRASH_KEEP_DAYS * DAY && remove(p)) report.trash++
  }
  // 2) adjuntos sin conversación
  const files = join(root, 'Assistant', 'Packs')
  if (existsSync(files)) {
    const threads = new Set([...threadNames(root)].map((n) => IDs.slug(n, 64)))
    for (const n of list(files)) {
      if (n.startsWith('.') || threads.has(n)) continue
      const p = join(files, n)
      if (t - lastTouched(p) > ORPHAN_FILES_KEEP_DAYS * DAY && remove(p)) report.orphanFiles++
    }
  }
  // 3) lo de depuración de las ejecuciones
  for (const pack of list(join(root, 'Packs'))) {
    const runs = join(root, 'Packs', pack, 'runs')
    for (const n of list(runs)) {
      if (!n.endsWith('.args') && !n.endsWith('.errores.log')) continue
      const p = join(runs, n)
      if (t - lastTouched(p) > RUN_DEBUG_KEEP_DAYS * DAY && remove(p)) report.runDebug++
    }
  }
  if (report.trash || report.orphanFiles || report.runDebug) log.info(`Orden de la carpeta de datos: ${JSON.stringify(report)}`)
  return report
}
