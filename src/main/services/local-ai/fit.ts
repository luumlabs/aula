// ¿Cabe este modelo en este ordenador y a qué velocidad irá? (port de `LocalAIKit/Fit/FitEstimator.swift`).
// En Apple Silicon se sigue exactamente el estimador de la app Swift (memoria unificada, ancho de banda del chip). En Windows y
// Linux se añade la GPU dedicada: si el modelo cabe en su memoria, va a la velocidad de la GPU; si no, solo con la CPU.
import type { FitEstimate, FitLevel, FitReason, HardwareProfile, ModelCard } from '@shared/agents'
import { downloadBytes, isMoE } from './catalog'
import { chipSpecOf } from './hardware'

export interface FitPolicy {
  /** Contexto que Aula quiere para sus agentes. */
  targetContext: number
  /** Por debajo de esto los agentes de Aula no trabajan bien. */
  minimumContext: number
  /** No se reserva más que esto aunque sobre memoria. */
  maximumContext: number
  /** Bytes por elemento de la caché KV: 2 = f16 (Ollama, LM Studio); 1,0625 = q8_0 (motor de Aula). */
  kvBytesPerElement: number
  /** Búferes de cálculo y del motor, aparte de pesos y caché. */
  overheadBytes: number
  idealFraction: number
  worksFraction: number
}

export const DEFAULT_FIT_POLICY: FitPolicy = {
  targetContext: 32_768,
  minimumContext: 16_384,
  maximumContext: 65_536,
  kvBytesPerElement: 1.0625,
  overheadBytes: 700 * 1_048_576,
  idealFraction: 0.75,
  worksFraction: 0.92
}

/** Para un motor con caché KV f16 (Ollama, LM Studio). */
export const F16_FIT_POLICY: FitPolicy = { ...DEFAULT_FIT_POLICY, kvBytesPerElement: 2 }

const GB = 1_073_741_824
const LEVEL_ORDER: FitLevel[] = ['tooBig', 'tight', 'works', 'ideal']
const rank = (l: FitLevel): number => LEVEL_ORDER.indexOf(l)

/** Bytes de la caché KV de `context` tokens con una forma conocida. */
export function kvShapeBytes(kv: NonNullable<ModelCard['kv']>, context: number, bytesPerElement: number): number {
  const sliding = kv.slidingLayers ?? 0
  const full = Math.max(0, kv.layers - sliding) * context
  const slid = sliding * Math.min(context, Math.max(kv.slidingWindow ?? 0, 1))
  return Math.trunc(2 * kv.kvHeads * kv.headDim * bytesPerElement * (full + slid))
}

/** Memoria propia de la GPU dedicada que puede usar el modelo (0 si no hay). */
export function gpuBudget(hw: HardwareProfile): number {
  if (hw.isAppleSilicon || !hw.gpu?.vramBytes) return 0
  return Math.max(0, Math.trunc(hw.gpu.vramBytes * 0.92 - 0.5 * GB))
}

/** Memoria de la CPU que se puede dedicar a un modelo sin quitar a Aula y al sistema lo suyo. */
function cpuBudget(hw: HardwareProfile): number {
  const ram = hw.memoryBytes
  const reserve = ram <= 16.5 * GB ? 4 * GB : ram <= 32.5 * GB ? 6 * GB : 8 * GB
  return Math.trunc(Math.max(0, Math.min(ram * 0.5, ram - reserve)))
}

/**
 * Memoria que el ordenador puede dedicar a un modelo. Apple Silicon: lo que macOS deja a la GPU (`recommendedMaxWorkingSetSize`)
 * menos 1 GB, sin quitar al sistema lo suyo (4 GB libres con 16 GB o menos, 6 GB hasta 32 GB y 8 GB por encima). Resto: la
 * memoria de la GPU dedicada o, si es mayor, la mitad de la RAM (solo CPU).
 */
export function fitBudget(hw: HardwareProfile): number {
  const ram = hw.memoryBytes
  if (hw.isAppleSilicon) {
    const reserve = ram <= 16.5 * GB ? 4 * GB : ram <= 32.5 * GB ? 6 * GB : 8 * GB
    const ws = hw.gpuWorkingSetBytes ?? ram * (ram > 36 * GB ? 0.75 : 0.66)
    return Math.trunc(Math.max(0, Math.min(ws - 1 * GB, ram - reserve)))
  }
  return Math.max(gpuBudget(hw), cpuBudget(hw))
}

/** Bytes de la caché KV (forma exacta si se conoce; si no, una estimación prudente por tamaño). */
export function kvBytes(card: ModelCard, context: number, policy: FitPolicy = DEFAULT_FIT_POLICY): number {
  if (card.kv) return kvShapeBytes(card.kv, context, policy.kvBytesPerElement)
  const active = card.activeParametersB ?? card.parametersB
  const perTokenF16 = isMoE(card) ? 100_000 : active < 2 ? 60_000 : active < 6 ? 120_000 : active < 20 ? 160_000 : 260_000
  return Math.trunc(((perTokenF16 * policy.kvBytesPerElement) / 2) * context)
}

function weightBytes(card: ModelCard): number {
  return downloadBytes(card) ?? Math.trunc(card.parametersB * 0.61 * 1e9) // Q4_K_M ≈ 4,85 bits por parámetro
}

/** Memoria total con `context` tokens (pesos + caché + búferes). */
export function fitMemory(card: ModelCard, context: number, policy: FitPolicy = DEFAULT_FIT_POLICY): number {
  const weights = weightBytes(card)
  return weights + kvBytes(card, context, policy) + policy.overheadBytes + Math.trunc(weights / 50)
}

/** ¿Este modelo va entero en la GPU dedicada con el contexto mínimo? */
function fitsInGPU(card: ModelCard, hw: HardwareProfile, policy: FitPolicy): boolean {
  const budget = gpuBudget(hw)
  return budget > 0 && fitMemory(card, Math.min(policy.minimumContext, card.contextLength || policy.minimumContext), policy) <= budget
}

/** Ancho de banda aproximado de una GPU dedicada por su nombre (GB/s). */
export function discreteGPUBandwidth(name: string): number {
  const n = name.toLowerCase()
  if (/rtx\s*5090/.test(n)) return 1790
  if (/rtx\s*4090/.test(n)) return 1008
  if (/rtx\s*(5080|4080|3090|3080)/.test(n)) return 850
  if (/rtx\s*(5070|4070|3070)/.test(n)) return 500
  if (/rtx\s*(5060|4060|3060|2080|2070)/.test(n)) return 360
  if (/rx\s*7900/.test(n)) return 900
  if (/rx\s*(7800|6800|6900)/.test(n)) return 550
  if (/rx\s*(7700|7600|6700|6600)/.test(n)) return 350
  return 300
}

/**
 * Tokens por segundo al generar: cada token lee los pesos activos de la memoria (ancho de banda × eficiencia / bytes).
 * Eficiencias de llama.cpp en Apple: ~0,78 base, ~0,72 Pro, ~0,63 Max, ~0,5 Ultra; los MoE rinden algo menos (×0,7).
 */
export function generationSpeed(card: ModelCard, hw: HardwareProfile, policy: FitPolicy = DEFAULT_FIT_POLICY): number | undefined {
  const weights = card.gguf?.bytes ?? Math.trunc(card.parametersB * 0.61 * 1e9)
  const activeFraction = Math.min(1, (card.activeParametersB ?? card.parametersB) / Math.max(card.parametersB, 0.01))
  const active = weights * activeFraction
  if (active <= 0) return undefined
  const moe = isMoE(card) ? 0.7 : 1
  if (hw.isAppleSilicon) {
    const spec = chipSpecOf(hw)
    const bw = (spec?.bandwidthGBs ?? 100) * 1e9
    const tier = spec?.tier ?? 'base'
    const efficiency = tier === 'base' ? 0.78 : tier === 'pro' ? 0.72 : tier === 'max' ? 0.63 : 0.5
    return Math.min(250, (bw * efficiency * moe) / active)
  }
  if (hw.gpu?.vramBytes && fitsInGPU(card, hw, policy)) {
    return Math.min(300, (discreteGPUBandwidth(hw.gpu.name) * 1e9 * 0.6 * moe) / active)
  }
  // solo CPU con memoria de dos canales (~40 GB/s), poco eficiente
  return Math.min(40, (40e9 * 0.45 * moe) / active)
}

/** Tokens por segundo al leer la entrada (con 16–32 k tokens es lo que más tarda). */
export function promptSpeed(card: ModelCard, hw: HardwareProfile, policy: FitPolicy = DEFAULT_FIT_POLICY): number | undefined {
  const activeB = Math.max(0.5, (card.activeParametersB ?? card.parametersB) * (isMoE(card) ? 1.6 : 1))
  if (hw.isAppleSilicon) {
    const cores = hw.gpuCores ?? 8
    const factor = chipSpecOf(hw)?.gpuCoreFactor ?? 1
    return (15.5 * cores * factor * 6.74) / activeB
  }
  if (hw.gpu?.vramBytes && fitsInGPU(card, hw, policy)) return (1500 * 6.74) / activeB
  return (Math.max(4, hw.performanceCores) * 3 * 6.74) / activeB
}

function hasPositiveContexts(card: ModelCard, policy: FitPolicy): boolean {
  return card.contextLength > 0 && policy.minimumContext > 0 && policy.maximumContext > 0 && policy.targetContext > 0
}

/** Veredicto completo. */
export function estimateFit(card: ModelCard, hw: HardwareProfile, policy: FitPolicy = DEFAULT_FIT_POLICY): FitEstimate {
  const budget = fitBudget(hw)
  const positive = hasPositiveContexts(card, policy)
  const native = positive ? Math.min(card.contextLength, policy.maximumContext) : Math.max(policy.minimumContext, card.contextLength)
  const minimum = positive ? Math.min(policy.minimumContext, native) : policy.minimumContext
  const candidates = [65_536, 49_152, 32_768, 24_576, 16_384].filter((c) => c <= Math.min(policy.maximumContext, native) && c >= minimum)
  const tps = generationSpeed(card, hw, policy)
  const pps = promptSpeed(card, hw, policy)
  const size = downloadBytes(card)
  const diskOK = hw.freeDiskBytes === undefined || size === undefined ? true : hw.freeDiskBytes > size + 2 * GB
  const preferred = Math.min(policy.targetContext, candidates[0] ?? minimum)
  const target = positive ? Math.max(minimum, preferred) : preferred
  const need = (c: number): number => fitMemory(card, c, policy)
  const b = Math.max(budget, 1)
  // el mayor contexto «holgado» que llegue al objetivo; si no, el objetivo; si no, el mayor que quepa
  const roomy = candidates.find((c) => c >= target && need(c) <= b * policy.idealFraction)
  const fitting = candidates.find((c) => need(c) <= b * policy.worksFraction)
  const context = roomy ?? (need(target) <= b * policy.worksFraction ? target : fitting ?? minimum)
  const mem = need(context)
  const fraction = mem / b

  let level: FitLevel
  let reason: FitReason
  if (need(minimum) > b) {
    level = 'tooBig'
    reason = 'needsMoreMemory'
  } else if ((positive && context < policy.minimumContext) || context < target) {
    level = 'tight'
    reason = 'shortContextOnly'
  } else if (fraction > policy.worksFraction) {
    level = 'tight'
    reason = 'closeOtherApps'
  } else if (fraction > policy.idealFraction) {
    level = 'works'
    reason = 'fits'
  } else {
    level = 'ideal'
    reason = 'comfortable'
  }
  // la velocidad también cuenta: muy lento no es «ideal» aunque quepa
  if (rank(level) >= rank('works') && tps !== undefined) {
    if (tps < 4) {
      level = 'tight'
      reason = 'slow'
    } else if (tps < 12) {
      level = 'works'
      reason = 'slow'
    } else if (level === 'ideal' && tps < 18) {
      level = 'works'
      reason = 'fits'
    }
  }
  // solo CPU (Mac Intel u ordenador sin GPU dedicada donde quepa): leer 16 k tokens tarda minutos
  const cpuOnly = !hw.isAppleSilicon && !fitsInGPU(card, hw, policy)
  const cpuReason: FitReason = hw.platform === 'darwin' ? 'intelCPU' : 'cpuOnly'
  if (cpuOnly && rank(level) > rank('tight')) {
    level = 'tight'
    reason = cpuReason
  } else if (cpuOnly && level === 'tight' && reason !== 'needsMoreMemory') {
    reason = cpuReason
  }
  const returnedContext = level === 'tooBig' ? minimum : context
  return {
    level,
    reason,
    contextTokens: returnedContext,
    memoryBytes: positive ? need(returnedContext) : mem,
    budgetBytes: budget,
    tokensPerSecond: tps,
    promptTokensPerSecond: pps,
    diskOK
  }
}

/** ¿Hay con qué mover un modelo con soltura? (Apple Silicon o una GPU dedicada con 4 GB o más) */
export function hasAccelerator(hw: HardwareProfile): boolean {
  return hw.isAppleSilicon || (hw.gpu?.vramBytes ?? 0) >= 4 * GB
}

/**
 * Los mejores para este ordenador: con herramientas y que quepan («Ideal» o «Funciona»; si ninguno, los «Justo»), por la
 * preferencia del catálogo (`rank`) con penalización según el encaje (Funciona +3, Justo +8) y como mucho dos del mismo editor.
 * Sin acelerador (solo CPU), ninguno: la interfaz lo explica.
 */
export function recommendedModels(cards: ModelCard[], hw: HardwareProfile, policy: FitPolicy = DEFAULT_FIT_POLICY, limit = 4): ModelCard[] {
  if (!hasAccelerator(hw)) return []
  const scored = cards
    .filter((c) => c.capabilities.includes('tools') && c.gguf)
    .map((c) => [c, estimateFit(c, hw, policy)] as const)
    .filter(([c, e]) => !hasPositiveContexts(c, policy) || e.contextTokens >= policy.minimumContext)
    .filter(([, e]) => e.reason !== 'cpuOnly' && e.reason !== 'intelCPU')
  let good = scored.filter(([, e]) => rank(e.level) >= rank('works') && e.diskOK)
  if (good.length === 0) good = scored.filter(([, e]) => e.level === 'tight' && e.diskOK)
  const penalty = (l: FitLevel): number => (l === 'ideal' ? 0 : l === 'works' ? 3 : l === 'tight' ? 8 : 100)
  const score = (x: readonly [ModelCard, FitEstimate]): number => (x[0].rank ?? 50) + penalty(x[1].level)
  const sorted = [...good].sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    return sa !== sb ? sa - sb : b[0].parametersB - a[0].parametersB
  })
  const out: ModelCard[] = []
  const perPublisher = new Map<string, number>()
  for (const [card] of sorted) {
    if (out.length >= limit) break
    const n = perPublisher.get(card.publisher) ?? 0
    if (n >= 2) continue
    perPublisher.set(card.publisher, n + 1)
    out.push(card)
  }
  return out
}
