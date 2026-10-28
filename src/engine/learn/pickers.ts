// Selectores de ejercicios: práctica adaptativa e intercalada (PracticePicker) y simulacros según el modelo de examen
// (ExamPicker). Reproducibles con semilla (SplitMix64, misma secuencia que la versión Swift).
import { MasteryModel, type SkillMastery } from './mastery'
import { SplitMix64, type Seed } from './seededRandom'
import { compareIds } from './support'

/** Referencia a un ejercicio del banco (sin su contenido). */
export interface ExerciseRef {
  id: string
  skillID: string
  /** 1 (fácil) a 3 (difícil); se admiten otros valores. */
  level: number
  /** Etiquetas libres (tipo de problema) para variar dentro de una sección. */
  tags?: string[]
  /** Plantilla numérica (cada instancia cambia los números). */
  isTemplate?: boolean
}

/** Una sección del modelo de examen («Parte A: gráficas, 4 ejercicios de nivel 1 a 2»). */
export interface BlueprintSection {
  title: string
  /** Habilidades de las que salen. Vacío = cualquiera. */
  skillIDs: string[]
  count: number
  minLevel?: number
  maxLevel?: number
}

function uniqueSorted(pool: readonly ExerciseRef[]): ExerciseRef[] {
  const seen = new Set<string>()
  const out: ExerciseRef[] = []
  for (const e of pool) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out.sort((a, b) => compareIds(a.id, b.id))
}

// MARK: - Práctica

export const PracticePicker = {
  /** Probabilidad de acierto que se busca (zona de desarrollo próximo). */
  targetSuccess: 0.75,
  /** Logits por nivel de dificultad. */
  logitPerLevel: 1.0,
  unseenCalibration: 0.5,
  unseenNeed: 0.7,

  /** Siguiente ejercicio, o `null` si no hay ninguno.
   *  - `recent`: últimos ejercicios hechos, el MÁS RECIENTE AL FINAL (no se repiten mientras haya otros).
   *  - `focusSkill`: solo de esa habilidad; sin ella se intercalan (se sortea la habilidad, más cuanto menos dominada, y se
   *    penalizan las dos últimas practicadas).
   *  Dentro de la habilidad, el nivel cuya probabilidad de acierto prevista queda más cerca del 75 %. */
  next(args: {
    pool: readonly ExerciseRef[]
    masteryBySkill: Readonly<Record<string, SkillMastery>> | ReadonlyMap<string, SkillMastery>
    recent?: readonly string[]
    focusSkill?: string | null
    now: Date
    seed: Seed
    model?: MasteryModel
  }): ExerciseRef | null {
    const model = args.model ?? new MasteryModel()
    const recent = args.recent ?? []
    const getM = (s: string): SkillMastery | undefined =>
      args.masteryBySkill instanceof Map ? args.masteryBySkill.get(s) : (args.masteryBySkill as Readonly<Record<string, SkillMastery>>)[s]
    const rng = new SplitMix64(args.seed)
    const unique = uniqueSorted(args.pool)
    const focus = args.focusSkill ?? null
    const candidates = focus !== null ? unique.filter((e) => e.skillID === focus) : unique
    if (candidates.length === 0) return null

    // recencia: posición de la última aparición (mayor = más reciente)
    const lastSeen = new Map<string, number>()
    recent.forEach((id, i) => lastSeen.set(id, i))
    let available = candidates.filter((e) => !lastSeen.has(e.id))
    if (available.length === 0) {
      // todo es reciente: la mitad más antigua
      const byAge = stableSort(candidates, (a, b) => (lastSeen.get(a.id) ?? -1) - (lastSeen.get(b.id) ?? -1))
      available = byAge.slice(0, Math.max(1, Math.floor(byAge.length / 2)))
    }

    // 1) habilidad
    const bySkill = new Map<string, ExerciseRef[]>()
    for (const e of available) {
      const list = bySkill.get(e.skillID) ?? []
      list.push(e)
      bySkill.set(e.skillID, list)
    }
    const skills = [...bySkill.keys()].sort(compareIds)
    let chosenSkill: string
    if (skills.length === 1) chosenSkill = skills[0]
    else {
      const skillByID = new Map<string, string>()
      for (const e of unique) if (!skillByID.has(e.id)) skillByID.set(e.id, e.skillID)
      const recentSkills = [...recent].reverse().map((id) => skillByID.get(id)).filter((s): s is string => s !== undefined)
      const last = recentSkills[0]
      const beforeLast = recentSkills.length > 1 ? recentSkills[1] : undefined
      const weights = skills.map((s) => {
        let w = PracticePicker.need(getM(s), args.now, model)
        if (s === last) w *= 0.2
        else if (s === beforeLast) w *= 0.6
        return w
      })
      chosenSkill = skills[rng.weightedIndex(weights) ?? 0]
    }

    // 2) nivel más cerca del 75 % (empates → el más fácil)
    const group = bySkill.get(chosenSkill) ?? []
    const p = PracticePicker.calibration(getM(chosenSkill), args.now, model)
    const levels = [...new Set(group.map((e) => e.level))].sort((a, b) => a - b)
    let bestLevel = levels[0]
    let bestGap = Infinity
    for (const level of levels) {
      const gap = Math.abs(PracticePicker.predictedSuccess(p, level) - PracticePicker.targetSuccess)
      if (gap < bestGap - 1e-12) {
        bestGap = gap
        bestLevel = level
      }
    }

    // 3) ejercicio
    const options = group.filter((e) => e.level === bestLevel)
    return options[rng.nextInt(options.length)] ?? null
  },

  /** σ(logit(dominio) + (2 − nivel)). */
  predictedSuccess(mastery: number, level: number): number {
    const m = Math.min(Math.max(mastery, 0.02), 0.98)
    const logit = Math.log(m / (1 - m)) + (2.0 - level) * PracticePicker.logitPerLevel
    return 1 / (1 + Math.exp(-logit))
  },

  calibration(m: SkillMastery | undefined, now: Date, model: MasteryModel): number {
    if (!m || !(m.attempts > 0)) return PracticePicker.unseenCalibration
    return model.probability(m, now)
  },

  /** Cuánta práctica necesita una habilidad: más cuanto menos dominada; las no vistas pesan mucho. */
  need(m: SkillMastery | undefined, now: Date, model: MasteryModel): number {
    const p = m && m.attempts > 0 ? model.probability(m, now) : 1 - PracticePicker.unseenNeed
    return 1 - p + 0.15
  }
}

// MARK: - Simulacros

export const ExamPicker = {
  /** Para cada sección (en orden) los ejercicios elegidos: sin repetidos en todo el examen, repartidos entre habilidades,
   *  con niveles en el rango (y si faltan, los más cercanos), en dificultad creciente. `avoid` es una preferencia (las
   *  plantillas cuentan siempre como nuevas). La misma semilla y el mismo banco dan siempre el mismo examen. */
  pick(sections: readonly BlueprintSection[], pool: readonly ExerciseRef[], seed: Seed, avoid: ReadonlySet<string> | readonly string[] = []): ExerciseRef[][] {
    const unique = uniqueSorted(pool)
    const avoidSet = avoid instanceof Set ? avoid : new Set(avoid as readonly string[])
    const used = new Set<string>()
    const result: ExerciseRef[][] = []
    sections.forEach((section, index) => {
      const rng = SplitMix64.withStream(seed, index)
      const chosen = pickSection(section, unique, used, avoidSet, rng)
      for (const e of chosen) used.add(e.id)
      result.push(chosen)
    })
    return result
  }
}

function bounded(x: number): number {
  return Math.min(Math.max(x, -1_000_000), 1_000_000)
}

function pickSection(section: BlueprintSection, pool: readonly ExerciseRef[], used: ReadonlySet<string>, avoid: ReadonlySet<string>, rng: SplitMix64): ExerciseRef[] {
  const wanted = Math.max(0, Math.trunc(section.count))
  if (!(wanted > 0)) return []
  const minL = section.minLevel ?? 1, maxL = section.maxLevel ?? 3
  const lo = bounded(Math.min(minL, maxL)), hi = bounded(Math.max(minL, maxL))
  const allowed = new Set(section.skillIDs)
  // candidatos en un orden aleatorio reproducible (último criterio de desempate)
  const candidates = rng.shuffled(pool.filter((e) => !used.has(e.id) && (allowed.size === 0 || allowed.has(e.skillID))))
  if (candidates.length === 0) return []

  const inRange = (e: ExerciseRef) => bounded(e.level) >= lo && bounded(e.level) <= hi
  const avoided = (e: ExerciseRef) => !e.isTemplate && avoid.has(e.id)
  // 0: en rango y nuevo · 1: fuera y nuevo · 2: en rango pero visto · 3: fuera y visto
  const tiers = candidates.map((e) => (avoided(e) ? 2 : 0) + (inRange(e) ? 0 : 1))
  const taken = new Array<boolean>(candidates.length).fill(false)
  const picksPerSkill = new Map<string, number>()
  const chosenTags = new Set<string>()
  const chosen: ExerciseRef[] = []

  // rampa de dificultad: nivel objetivo de cada hueco
  const target = (slot: number): number => {
    if (!(hi > lo)) return lo
    if (wanted === 1) return lo + Math.trunc((hi - lo + 1) / 2)
    return lo + Math.trunc(roundHalfAwayInt((slot * (hi - lo)) / (wanted - 1)))
  }

  for (let slot = 0; slot < wanted; slot++) {
    const goal = target(slot)
    let best = -1
    let bestKey: [number, number, number, number] = [Infinity, Infinity, Infinity, Infinity]
    for (let i = 0; i < candidates.length; i++) {
      if (taken[i]) continue
      const e = candidates[i]
      const overlap = (e.tags ?? []).reduce((acc, t) => acc + (chosenTags.has(t) ? 1 : 0), 0)
      // frescura/rango → equilibrio entre habilidades → cercanía al nivel objetivo → variedad de etiquetas
      const key: [number, number, number, number] = [tiers[i], picksPerSkill.get(e.skillID) ?? 0, Math.abs(bounded(e.level) - goal), overlap]
      if (best < 0 || lexLess(key, bestKey)) {
        best = i
        bestKey = key
      }
    }
    if (best < 0) break
    taken[best] = true
    const e = candidates[best]
    picksPerSkill.set(e.skillID, (picksPerSkill.get(e.skillID) ?? 0) + 1)
    for (const t of e.tags ?? []) chosenTags.add(t)
    chosen.push(e)
  }
  // dificultad creciente (estable)
  return stableSort(chosen, (a, b) => a.level - b.level)
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

function roundHalfAwayInt(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

function stableSort<T>(array: readonly T[], cmp: (a: T, b: T) => number): T[] {
  return array.map((v, i) => ({ v, i })).sort((a, b) => cmp(a.v, b.v) || a.i - b.i).map((x) => x.v)
}
