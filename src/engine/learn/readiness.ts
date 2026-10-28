// Estimación de la nota esperada en el examen a partir del dominio de cada habilidad, con intervalo de credibilidad del 80 %.
import { BetaMath } from './betaMath'
import { MasteryModel, type SkillMastery } from './mastery'
import { clamp, compareIds, resolveText, roundHalfAway, type TextOptions } from './support'

/** Peso de una habilidad en el examen (puntos o peso relativo: solo importa la proporción). */
export interface SkillWeight {
  skillID: string
  weight: number
}

/** Etiqueta estable de la preparación (para i18n en la interfaz). */
export type ReadinessLabelKey = 'noData' | 'gettingStarted' | 'farFromReady' | 'onTrack' | 'doingWell' | 'almostReady' | 'ready'

export interface Readiness {
  /** Nota esperada, 0…1. */
  expectedScore: number
  /** Límites del intervalo de credibilidad del 80 %. */
  low: number
  high: number
  /** Fracción (por peso) de las habilidades ya intentadas. */
  coverage: number
  /** «Aún sin datos», «Recién empezando», «Te falta bastante», «En camino», «Vas bien», «Casi listo», «Listo». */
  label: string
  labelKey: ReadinessLabelKey
  /** Las más flojas (las que más puntos hacen perder), como mucho 5 y por debajo del 80 %. */
  weakest: string[]
}

export interface ReadinessEntry {
  weight: SkillWeight
  mastery: SkillMastery
}

const LABELS: Record<ReadinessLabelKey, { es: string; en: string }> = {
  noData: { es: 'Aún sin datos', en: 'No data yet' },
  gettingStarted: { es: 'Recién empezando', en: 'Just getting started' },
  farFromReady: { es: 'Te falta bastante', en: "You're far from ready" },
  onTrack: { es: 'En camino', en: 'On track' },
  doingWell: { es: 'Vas bien', en: "You're doing well" },
  almostReady: { es: 'Casi listo', en: 'Almost ready' },
  ready: { es: 'Listo', en: 'Ready' }
}

export function readinessLabelText(key: ReadinessLabelKey, o?: TextOptions): string {
  return LABELS[key][resolveText(o).lang]
}

export const ReadinessEstimator = {
  /** Beta que se asume para una habilidad NUNCA intentada: media 0,10 y mucha incertidumbre. */
  unseenAlpha: 0.25,
  unseenBeta: 2.25,
  intervalLevel: 0.8,
  weakestLimit: 5,
  weakThreshold: 0.8,

  /** Agrega las Betas de cada habilidad ponderadas por su peso (media Σ wᵢ·pᵢ, varianza Σ wᵢ²·vᵢ). Pesos ≤ 0 o no
   *  finitos se ignoran; sin habilidades válidas, ceros y «Aún sin datos». */
  estimate(skills: readonly ReadinessEntry[], model: MasteryModel, now: Date, o?: TextOptions): Readiness {
    interface Item { id: string; w: number; mean: number; variance: number; seen: boolean }
    const items: Item[] = []
    for (const s of skills) {
      const w = s.weight.weight
      if (!Number.isFinite(w) || !(w > 0)) continue
      const seen = s.mastery.attempts > 0
      let a: number, b: number
      if (seen) {
        const d = model.decayed(s.mastery, now)
        a = d.alpha
        b = d.beta
      } else {
        a = ReadinessEstimator.unseenAlpha
        b = ReadinessEstimator.unseenBeta
      }
      items.push({ id: s.weight.skillID, w, mean: BetaMath.mean(a, b), variance: BetaMath.variance(a, b), seen })
    }
    const maxWeight = items.reduce((m, x) => Math.max(m, x.w), -Infinity)
    if (!(maxWeight > 0)) {
      return { expectedScore: 0, low: 0, high: 0, coverage: 0, label: readinessLabelText('noData', o), labelKey: 'noData', weakest: [] }
    }
    // se normaliza por el mayor peso: solo importan las proporciones y la suma nunca desborda
    for (const it of items) it.w /= maxWeight
    const total = items.reduce((s, x) => s + x.w, 0)
    let mean = 0, variance = 0, coverage = 0
    for (const it of items) {
      const n = it.w / total
      mean += n * it.mean
      variance += n * n * it.variance
      if (it.seen) coverage += n
    }
    mean = clamp(mean, 0, 1)
    coverage = clamp(coverage, 0, 1)
    let low = mean, high = mean
    const beta = BetaMath.match(mean, variance)
    if (beta) {
      const tail = (1 - ReadinessEstimator.intervalLevel) / 2
      low = Math.min(BetaMath.quantile(tail, beta.a, beta.b), mean)
      high = Math.max(BetaMath.quantile(1 - tail, beta.a, beta.b), mean)
    }
    // las que más puntos hacen perder (cuantizado para que los empates numéricos se resuelvan por peso y por id)
    const lost = (x: Item) => roundHalfAway(x.w * (1 - x.mean) * 1e9)
    const ranked = items
      .filter((x) => x.mean < ReadinessEstimator.weakThreshold)
      .sort((x, y) => {
        const l0 = lost(x), l1 = lost(y)
        if (l0 !== l1) return l1 - l0
        if (x.w !== y.w) return y.w - x.w
        return compareIds(x.id, y.id)
      })
    const weakest: string[] = []
    for (const it of ranked) {
      if (weakest.includes(it.id)) continue
      weakest.push(it.id)
      if (weakest.length === ReadinessEstimator.weakestLimit) break
    }
    const key = ReadinessEstimator.labelKey(mean, coverage)
    return { expectedScore: mean, low, high, coverage, label: readinessLabelText(key, o), labelKey: key, weakest }
  },

  /** Cobertura 0 → sin datos; < 40 % → empezando; luego por nota: < 40 %, < 60 %, < 75 %; «Listo» exige ≥ 85 % y ≥ 90 % de cobertura. */
  labelKey(expected: number, coverage: number): ReadinessLabelKey {
    if (coverage <= 0) return 'noData'
    if (coverage < 0.4) return 'gettingStarted'
    if (expected < 0.4) return 'farFromReady'
    if (expected < 0.6) return 'onTrack'
    if (expected < 0.75) return 'doingWell'
    if (expected >= 0.85 && coverage >= 0.9) return 'ready'
    return 'almostReady'
  },

  label(expected: number, coverage: number, o?: TextOptions): string {
    return readinessLabelText(ReadinessEstimator.labelKey(expected, coverage), o)
  }
}
