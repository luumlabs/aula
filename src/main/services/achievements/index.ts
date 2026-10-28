// Logros: se calculan con el progreso de todos los cursos (`@engine/study/achievements`); aquí solo se apunta, en
// `<datos>/achievements.json`, cuándo se vio cada uno conseguido, para celebrarlo una sola vez.
// La primera vez (sin archivo) se apuntan en silencio los que ya estaban conseguidos: nadie recibe veinte avisos de golpe.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { achievementMeasures, achievementViews, newlyEarned, type AchievementCourse } from '@engine/study/achievements'
import type { AchievementId, AchievementView } from '@shared/ipc/achievements'
import { paths } from '../paths'
import { readJSON, writeJSONAtomic } from '../fs'
import { log } from '../log'
import { getLibrary } from '../store'
import { SAMPLE_COURSE_IDS } from '@shared/samples'

interface EarnedFile {
  version: 1
  earned: Record<string, string>
}

const file = (): string => join(paths.root(), 'achievements.json')
/** Los cursos de ejemplo no cuentan como «tu primer curso». */
const SAMPLE_IDS = [...SAMPLE_COURSE_IDS]

function readEarned(): Record<string, string> | null {
  if (!existsSync(file())) return null
  const raw = readJSON<Partial<EarnedFile>>(file())
  const out: Record<string, string> = {}
  if (raw && raw.earned && typeof raw.earned === 'object') {
    for (const [k, v] of Object.entries(raw.earned)) if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[k] = v
  }
  return out
}

function writeEarned(earned: Record<string, string>): void {
  writeJSONAtomic(file(), { version: 1, earned } satisfies EarnedFile)
}

function courses(): AchievementCourse[] {
  const lib = getLibrary()
  const out: AchievementCourse[] = []
  for (const id of lib.packIDs()) {
    const store = lib.openPack(id)
    if (!store) continue
    try {
      out.push({ pack: store.loadPack(), progress: store.loadProgress() })
    } catch {
      // un curso que no se puede leer no cuenta (ni rompe los demás)
    }
  }
  return out
}

function views(now: Date, earned: Record<string, string>): AchievementView[] {
  return achievementViews(achievementMeasures(courses(), now, { sampleIds: SAMPLE_IDS }), earned)
}

/** La estantería de logros. */
export function listAchievements(now = new Date()): AchievementView[] {
  return views(now, readEarned() ?? {})
}

/** Apunta los logros recién conseguidos y los devuelve (para celebrarlos). La primera vez, solo apunta. */
export function checkAchievements(now = new Date()): AchievementId[] {
  const before = readEarned()
  const current = views(now, before ?? {})
  const fresh = newlyEarned(current, before ?? {})
  if (before && !fresh.length) return []
  const earned = { ...(before ?? {}) }
  for (const id of fresh) earned[id] = now.toISOString()
  try {
    writeEarned(earned)
  } catch (err) {
    log.warn('[logros] no se pudieron guardar', err)
    return []
  }
  return before ? fresh : []
}
