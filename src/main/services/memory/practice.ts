// Memoria · lo que se deduce de la práctica, sin IA (port de PracticeInsights.swift): errores que se repiten, habilidades que
// cuestan o que ya domina y a qué hora suele estudiar. Cada deducción lleva una clave estable («practice:…»): al volver a mirar se
// actualiza su texto y, si deja de ser verdad, se quita sola. Lo que el estudiante corrigió a mano nunca se toca.
import { cleanText, contentHash } from '@engine/assistant'
import { skillMastery } from '@engine/study'
import { tr } from '@shared/ai/i18n'
import type { Pack, SkillRef, SkillProgress, StudyProgress } from '@shared/schema'
import type { Library } from '../store/library'
import type { MemoryDraft } from './models'

export const PRACTICE_KEY_PREFIX = 'practice:'
/** Lo deducido deja de valer si no vuelve a confirmarse en este tiempo. */
const LIFETIME_MS = 45 * 86_400_000

export interface PracticeInsight { draft: MemoryDraft; key: string }

const iso = (ms: number): string => new Date(ms).toISOString()
const t = (s: string | undefined, fallback: number): number => {
  const v = s ? Date.parse(s) : NaN
  return Number.isFinite(v) ? v : fallback
}

export function insightsForPack(pack: Pack, progress: StudyProgress, now: Date = new Date()): PracticeInsight[] {
  const out: PracticeInsight[] = []
  const course = pack.title
  const expiry = (last: string | undefined): string => iso(t(last, now.getTime()) + LIFETIME_MS)
  const insight = (d: MemoryDraft): void => { out.push({ draft: d, key: d.key ?? '' }) }

  // habilidades que cuestan / que ya domina (con suficientes intentos para que el dato signifique algo)
  const hard: Array<[SkillRef, number, SkillProgress]> = []
  const strong: Array<[SkillRef, number, SkillProgress]> = []
  for (const ref of pack.skills) {
    const sp = progress.skills[ref.id]
    if (!sp || sp.attempts < 6) continue
    const m = skillMastery(sp, now)
    if (m === undefined) continue
    if (m < 0.45) hard.push([ref, m, sp])
    else if (m >= 0.88 && sp.attempts >= 8) strong.push([ref, m, sp])
  }
  for (const [ref, m, sp] of hard.sort((a, b) => a[1] - b[1]).slice(0, 3)) {
    const pct = Math.round(m * 100)
    insight({
      kind: 'difficulty', text: tr(`Le cuesta «${ref.title}» (${course}): dominio estimado del ${pct} % tras ${sp.attempts} ejercicios.`,
        `Finds “${ref.title}” (${course}) hard: estimated mastery ${pct} % after ${sp.attempts} exercises.`),
      key: `${PRACTICE_KEY_PREFIX}hard:${pack.id}:${ref.id}`, source: 'practice', courseID: pack.id, courseTitle: course,
      confidence: Math.min(0.9, 0.55 + sp.attempts / 60), expiresAt: expiry(sp.lastPracticed)
    })
  }
  for (const [ref, , sp] of strong.sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    insight({
      kind: 'strength', text: tr(`Domina «${ref.title}» (${course}).`, `Masters “${ref.title}” (${course}).`),
      key: `${PRACTICE_KEY_PREFIX}strong:${pack.id}:${ref.id}`, source: 'practice', courseID: pack.id, courseTitle: course, confidence: 0.75, expiresAt: expiry(sp.lastPracticed)
    })
  }

  // errores que se repiten: el mismo ejercicio fallado 3+ veces con una explicación del error
  const repeated = progress.mistakes.filter((m) => !m.resolved && m.count >= 3 && (m.why ?? '').trim() !== '')
    .sort((a, b) => (b.count - a.count) || (t(b.lastSeen, 0) - t(a.lastSeen, 0)))
  const seenWhy = new Set<string>()
  for (const m of repeated) {
    const why = cleanText(m.why ?? '', 160)
    const h = contentHash(why)
    if (seenWhy.has(h)) continue
    seenWhy.add(h)
    const skill = pack.skills.find((s) => s.id === m.skill)?.title ?? m.skill
    insight({
      kind: 'mistake', text: tr(`Error que repite en «${skill}» (${course}): ${why}`, `Repeated mistake in “${skill}” (${course}): ${why}`),
      key: `${PRACTICE_KEY_PREFIX}mistake:${pack.id}:${m.templateID ?? m.exerciseID}`, source: 'practice', courseID: pack.id, courseTitle: course,
      confidence: Math.min(0.9, 0.5 + m.count * 0.08), expiresAt: expiry(m.lastSeen)
    })
    if (seenWhy.size >= 3) break
  }
  return out
}

/** A qué hora suele estudiar (con al menos 30 ejercicios en 5 días distintos). */
export function scheduleInsight(dates: readonly number[], now: Date = new Date()): PracticeInsight | undefined {
  const recent = dates.filter((d) => now.getTime() - d < 60 * 86_400_000)
  const days = new Set(recent.map((d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` }))
  if (recent.length < 30 || days.size < 5) return undefined
  // franjas: mañana 6–12, tarde 12–18, noche 18–24, madrugada 0–6
  const bands = [0, 0, 0, 0]
  for (const d of recent) {
    const h = new Date(d).getHours()
    bands[h < 6 ? 3 : h < 12 ? 0 : h < 18 ? 1 : 2]++
  }
  const best = bands.indexOf(Math.max(...bands))
  if (bands[best] / recent.length < 0.55) return undefined
  const text = [tr('Suele estudiar por la mañana.', 'Usually studies in the morning.'), tr('Suele estudiar por la tarde.', 'Usually studies in the afternoon.'),
    tr('Suele estudiar por la noche.', 'Usually studies in the evening.'), tr('Suele estudiar de madrugada.', 'Usually studies late at night.')][best]
  const key = `${PRACTICE_KEY_PREFIX}schedule`
  return { key, draft: { kind: 'schedule', text, key, source: 'practice', confidence: 0.7, expiresAt: iso(Math.max(...recent) + LIFETIME_MS) } }
}

export function deriveInsights(library: Library, now: Date = new Date()): PracticeInsight[] {
  const out: PracticeInsight[] = []
  const dates: number[] = []
  for (const id of library.packIDs()) {
    const store = library.openPack(id)
    if (!store) continue
    let pack: Pack
    try { pack = store.loadPack() } catch { continue }
    const progress = store.loadProgress()
    for (const a of progress.attempts) {
      const d = Date.parse(a.date)
      if (Number.isFinite(d)) dates.push(d)
    }
    out.push(...insightsForPack(pack, progress, now))
  }
  const s = scheduleInsight(dates, now)
  if (s) out.push(s)
  return out
}
