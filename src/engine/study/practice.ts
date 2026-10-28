// Cola de ejercicios de una sesión de práctica (port de StudyEngine/Learning/PracticeQueue.swift).
//
// La práctica de un tema y «lo más flojo» son adaptativas (PracticePicker): el nivel sale del dominio de cada habilidad (el que
// deja la probabilidad de acierto cerca del 75 %), se evita lo hecho últimamente y cada plantilla da una sola variante por
// sesión. La sesión se arma como una escalera (si acierta, sube hacia el nivel examen) y `refill` vuelve a elegir el siguiente
// ejercicio tras cada respuesta con el dominio ya actualizado: si falla, baja.
import { PracticePicker, attempt, freshMastery, type ExerciseRef, type SkillMastery } from '@engine/learn'
import { ownValue, isReviewUsable, orderedSkills, type Exercise, type ItemID, type Pack, type Skill, type StudyProgress } from '@shared/schema'
import { instantiateTemplate } from '@engine/grading'
import type { PracticeOptions, PracticeRequest, SkillsInput } from './types'
import { LearnBridge } from './bridge'
import { Recorder } from './recorder'
import { seedOf, skillMap, StudyMix, u64 } from './util'

const GOLDEN = 0x9e3779b97f4a7c15n

type Instantiate = (t: Skill['templates'][number], seed: bigint) => Exercise | undefined
const defaultInstantiate: Instantiate = (t, seed) => instantiateTemplate(t, seed)

/** Id de banco de un ejercicio de la sesión (las variantes de una plantilla cuentan como su plantilla). */
export const refID = (e: Exercise): string => e.templateID ?? e.id

/** Lo hecho últimamente (lo más reciente al final), con las variantes de plantilla como su plantilla («t#123» → «t»). */
export function recentRefIDs(p: StudyProgress, limit = 60): string[] {
  return p.attempts.slice(-limit).map((a) => { const i = a.exerciseID.indexOf('#'); return i >= 0 ? a.exerciseID.slice(0, i) : a.exerciseID })
}

/** El banco como referencias: cada ejercicio usable y UNA entrada por plantilla (como mucho 40 por habilidad). */
export function practiceRefs(skills: Readonly<Record<ItemID, Skill>>, ids: readonly ItemID[], level: number | undefined, withTemplates = true): ExerciseRef[] {
  let out: ExerciseRef[] = []
  for (const sid of ids) {
    const s = ownValue(skills, sid)
    if (!s) continue
    for (const e of s.exercises) if (isReviewUsable(e.review)) out.push({ id: e.id, skillID: sid, level: e.level, tags: e.tags })
    if (withTemplates) for (const t of s.templates.slice(0, 40)) out.push({ id: t.id, skillID: sid, level: t.level, tags: t.tags, isTemplate: true })
  }
  if (level !== undefined) { const f = out.filter((r) => r.level === level); if (f.length) out = f }
  return out
}

function exerciseFor(ref: ExerciseRef, skills: Readonly<Record<ItemID, Skill>>, seed: bigint, instantiate: Instantiate): Exercise | undefined {
  const s = ownValue(skills, ref.skillID)
  if (!s) return undefined
  if (ref.isTemplate) { const t = s.templates.find((x) => x.id === ref.id); return t ? instantiate(t, seed) : undefined }
  return s.exercises.find((x) => x.id === ref.id)
}

/** Elige `count` ejercicios con PracticePicker; con `ladder`, cada elección supone un acierto para la siguiente. */
function adaptive(pool: readonly ExerciseRef[], skills: Readonly<Record<ItemID, Skill>>, progress: StudyProgress, count: number, exclude: ReadonlySet<string>,
  now: Date, seed: bigint, ladder: boolean, instantiate: Instantiate): Exercise[] {
  const model = LearnBridge.masteryModel
  const mastery: Record<string, SkillMastery> = Object.create(null) as Record<string, SkillMastery>
  for (const [k, v] of Object.entries(progress.skills)) mastery[k] = LearnBridge.mastery(v)
  const recent = recentRefIDs(progress)
  const used = new Set(exclude)
  const rng = new StudyMix(seed)
  const out: Exercise[] = []
  let step = 0n
  while (out.length < count) {
    const available = pool.filter((r) => !used.has(r.id))
    const ref = PracticePicker.next({ pool: available, masteryBySkill: mastery, recent, focusSkill: null, now, seed: u64(seed + u64(step * GOLDEN)), model })
    if (!ref) break
    step += 1n
    used.add(ref.id)
    recent.push(ref.id)
    // una plantilla que no se puede instanciar con esta semilla se salta
    const e = exerciseFor(ref, skills, rng.next(), instantiate)
    if (!e) continue
    out.push(e)
    if (ladder) mastery[ref.skillID] = model.updated(mastery[ref.skillID] ?? freshMastery(), attempt(1, { difficulty: ref.level, mode: 'practice' }), now)
  }
  return out
}

export const PracticeQueue = {
  defaultInstantiate,

  isAdaptive(r: PracticeRequest): boolean {
    return r.kind === 'skill' || r.kind === 'weakest'
  },

  build(pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, request: PracticeRequest, opts: PracticeOptions = {}, instantiate: Instantiate = defaultInstantiate): Exercise[] {
    const now = opts.now ?? new Date()
    const seed = seedOf(opts.seed, now)
    const count = Math.max(0, Math.trunc(opts.count ?? 10))
    const skills = skillMap(skillsInput)
    // la sesión identifica cada ejercicio por su id: un id repetido sale una sola vez
    const seen = new Set<string>()
    return PracticeQueue.candidates(pack, skills, progress, request, count, now, seed, instantiate).filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  },

  candidates(pack: Pack, skills: Readonly<Record<ItemID, Skill>>, progress: StudyProgress, request: PracticeRequest, count: number, now: Date, seed: bigint, instantiate: Instantiate): Exercise[] {
    switch (request.kind) {
      case 'skill': return adaptive(practiceRefs(skills, [request.skillId], request.level), skills, progress, count, new Set(), now, seed, true, instantiate)
      case 'weakest': return adaptive(practiceRefs(skills, PracticeQueue.weakest(pack, skills, progress, now), undefined), skills, progress, count, new Set(), now, seed, true, instantiate)
      case 'mistakes': {
        const out: Exercise[] = []
        for (const m of Recorder.dueMistakes(progress, now, skills)) {
          const s = ownValue(skills, m.skill)
          const t = m.templateID !== undefined && m.seed !== undefined ? s?.templates.find((x) => x.id === m.templateID) : undefined
          const fromTemplate = t && m.seed !== undefined ? instantiate(t, BigInt(m.seed)) : undefined
          if (fromTemplate) { out.push(fromTemplate); continue }
          const e = s?.exercises.find((x) => x.id === m.exerciseID && isReviewUsable(x.review))
          if (e) out.push(e)
        }
        return out.slice(0, count)
      }
      case 'diagnostic': {
        const rng = new StudyMix(seed)
        const out: Exercise[] = []
        for (const s of orderedSkills(pack)) {
          const pool = rng.shuffled(practiceRefs(skills, [s.id], undefined).filter((r) => r.level <= 2))
          let taken = 0
          for (const r of pool) {
            if (taken >= 2) continue
            const e = exerciseFor(r, skills, rng.next(), instantiate)
            if (e) { out.push(e); taken += 1 }
          }
        }
        return out.slice(0, Math.max(count, 12))
      }
    }
  },

  /** El ejercicio que conviene ahora en el hueco `slot` de una sesión adaptativa. undefined = se deja el que había. */
  refill(slot: number, session: readonly Exercise[], pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, request: PracticeRequest,
    opts: PracticeOptions = {}, instantiate: Instantiate = defaultInstantiate): Exercise | undefined {
    if (!PracticeQueue.isAdaptive(request) || slot < 0 || slot >= session.length) return undefined
    const now = opts.now ?? new Date()
    const seed = seedOf(opts.seed, now)
    const skills = skillMap(skillsInput)
    // «lo más flojo» sigue con las habilidades con que empezó la sesión
    const ids = request.kind === 'skill' ? [request.skillId] : [...new Set(session.map((e) => e.skill))]
    const pool = practiceRefs(skills, ids, request.kind === 'skill' ? request.level : undefined)
    const others = new Set(session.filter((_e, i) => i !== slot).map(refID))
    const next = adaptive(pool, skills, progress, 1, others, now, seed, false, instantiate)[0]
    if (!next) return undefined
    return refID(next) === refID(session[slot]) ? undefined : next
  },

  /** Las 3 habilidades más flojas entre las practicadas; si no llegan a 3, se completa con las no vistas en el orden del curso. */
  weakest(pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, now: Date): ItemID[] {
    const skills = skillMap(skillsInput)
    const seen = new Set<ItemID>()
    const refs = orderedSkills(pack).filter((r) => ownValue(skills, r.id) !== undefined && (seen.has(r.id) ? false : (seen.add(r.id), true)))
    const practiced = refs
      .map((r) => [r.id, Recorder.mastery(ownValue(progress.skills, r.id), now)] as const)
      .filter((x): x is readonly [string, number] => x[1] !== undefined)
      .map((x, i) => ({ id: x[0], m: x[1], i }))
      .sort((a, b) => a.m - b.m || a.i - b.i)
      .map((x) => x.id)
    const unseen = refs.map((r) => r.id).filter((id) => !practiced.includes(id))
    return [...practiced, ...unseen].slice(0, 3)
  }
}
