// Coste en dinero de las llamadas a la IA (port de StudyEngine/Costs/Pricing.swift). Tres fuentes de precio, en este orden, y
// NINGUNA se inventa: 1) lo que ponga la persona; 2) el catálogo del proveedor en vivo (OpenRouter publica sus precios);
// 3) la tabla de lista de Aula, con la fecha en que se comprobó cada fila (se marca «≈»). Las suscripciones y los modelos de este
// ordenador no se cobran por token (0, y se dice por qué). Si un modelo no está en ninguna fuente, el coste es DESCONOCIDO, nunca 0.
import { aiLocale, tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import type { Usage } from '@shared/ai/types'

/** Precio de un modelo en dólares por millón de tokens. */
export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
  /** Leer de la caché. Sin valor = 0,1 × la entrada. */
  cacheReadPerMillion?: number
  /** Escribir en la caché (5 min). Sin valor = 1,25 × la entrada. */
  cacheWritePerMillion?: number
  /** Tramo caro de contexto largo (Claude Haiku 5.5 cobra otra tarifa por encima de 100 000 tokens de entrada en una llamada). */
  longContext?: { aboveInputTokens: number; inputPerMillion: number; outputPerMillion: number }
}

export const DEFAULT_CACHE_READ_FACTOR = 0.1
export const DEFAULT_CACHE_WRITE_FACTOR = 1.25

export function modelPrice(input: number, output: number, cacheRead?: number, cacheWrite?: number, longContext?: ModelPrice['longContext']): ModelPrice {
  const p: ModelPrice = { inputPerMillion: input, outputPerMillion: output }
  if (cacheRead !== undefined) p.cacheReadPerMillion = cacheRead
  if (cacheWrite !== undefined) p.cacheWritePerMillion = cacheWrite
  if (longContext) p.longContext = longContext
  return p
}

export const effectiveCacheRead = (p: ModelPrice) => p.cacheReadPerMillion ?? p.inputPerMillion * DEFAULT_CACHE_READ_FACTOR
export const effectiveCacheWrite = (p: ModelPrice) => p.cacheWritePerMillion ?? p.inputPerMillion * DEFAULT_CACHE_WRITE_FACTOR

export function isFreePrice(p: ModelPrice): boolean {
  return p.inputPerMillion === 0 && p.outputPerMillion === 0 && (p.cacheReadPerMillion ?? 0) === 0 && (p.cacheWritePerMillion ?? 0) === 0
}

/** Todos los números finitos y no negativos (un precio editado a mano o de otra versión puede no serlo). */
export function isValidPrice(p: ModelPrice | undefined | null): p is ModelPrice {
  if (!p || typeof p !== 'object') return false
  const nums = [p.inputPerMillion, p.outputPerMillion, p.cacheReadPerMillion, p.cacheWritePerMillion, p.longContext?.inputPerMillion, p.longContext?.outputPerMillion]
  for (const [i, v] of nums.entries()) {
    if (v === undefined && i >= 2) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false
  }
  return !p.longContext || p.longContext.aboveInputTokens > 0
}

/** De dónde sale un precio. */
export type PriceSource = 'user' | 'live' | 'list' | 'free'

/** Cómo se paga un proveedor. */
export type BillingKind = 'perToken' | 'subscription' | 'local' | 'unknown'

/** El precio que se aplicará a una llamada (o por qué no se sabe). */
export interface PriceQuote {
  billing: BillingKind
  /** `undefined` = no se conoce (y no es gratis). */
  price?: ModelPrice
  source?: PriceSource
  /** Día en que se comprobó (lista) o se pidió (catálogo), en ms. */
  asOf?: number
  /** `false` = precio de lista o aproximado: se enseña con «≈». */
  exact: boolean
  model: string
}

export const quoteIsKnown = (q: PriceQuote) => q.price !== undefined
/** ¿Esta llamada suma dinero? (no para suscripciones, modelos locales y gratuitos) */
export const quoteIsPaid = (q: PriceQuote) => (q.billing === 'perToken' || q.billing === 'unknown' ? !(q.price && isFreePrice(q.price)) : false)

function formatDay(ms: number): string {
  return new Intl.DateTimeFormat(aiLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
}

/** Una línea para la interfaz: «Precio de lista aproximado (comprobado el 6 oct 2026)», «Incluido en tu suscripción»… */
export function quoteExplanation(q: PriceQuote): string {
  if (q.billing === 'subscription') return tr('Incluido en tu suscripción', 'Included in your subscription')
  if (q.billing === 'local') return tr('Modelo de este ordenador: gratis', 'Model on this computer: free')
  if (!q.price || !q.source) {
    return tr(`Aula no sabe el precio de este modelo: añádelo en ${settingsPath('ai', 'es')} si quieres que cuente.`,
      `Aula doesn’t know this model’s price: add it in ${settingsPath('ai', 'en')} if you want it counted.`)
  }
  const day = q.asOf !== undefined ? formatDay(q.asOf) : undefined
  switch (q.source) {
    case 'user':
      return tr('Precio que pusiste tú', 'Price you entered')
    case 'live':
      return day ? tr(`Precio del proveedor (consultado el ${day})`, `Provider price (checked on ${day})`) : tr('Precio del proveedor', 'Provider price')
    case 'list':
      return day ? tr(`Precio de lista aproximado (comprobado el ${day})`, `Approximate list price (verified on ${day})`) : tr('Precio de lista aproximado', 'Approximate list price')
    case 'free':
      return tr('Modelo gratuito', 'Free model')
  }
}

/**
 * Cuánto costó un uso con un precio. `promptTokens` incluye los leídos de caché y los escritos (cuando el proveedor los
 * separa); se cobran aparte con su tarifa y no se cuentan dos veces. `perCallPromptTokens`: tokens de entrada de UNA llamada
 * (para el tramo de contexto largo); si solo se sabe el acumulado y pasa del umbral, se usa la tarifa normal y es aproximado.
 */
export function costOf(usage: Usage, price: ModelPrice, cacheWriteTokens = 0, perCallPromptTokens?: number): { usd: number; exact: boolean } {
  const prompt = Math.max(0, usage.promptTokens)
  const completion = Math.max(0, usage.completionTokens)
  const cached = Math.min(Math.max(0, usage.cachedTokens), prompt)
  const written = Math.min(Math.max(0, cacheWriteTokens > 0 ? cacheWriteTokens : usage.cacheWriteTokens), prompt - cached)
  const uncached = Math.max(0, prompt - cached - written)
  let input = price.inputPerMillion
  let output = price.outputPerMillion
  let exact = true
  const tier = price.longContext
  if (tier) {
    if (perCallPromptTokens !== undefined) {
      if (perCallPromptTokens > tier.aboveInputTokens) {
        input = tier.inputPerMillion
        output = tier.outputPerMillion
      }
    } else if (prompt > tier.aboveInputTokens) exact = false // no se sabe si alguna llamada pasó del umbral
  }
  // las tarifas de caché del tramo largo escalan igual que la entrada
  const scale = price.inputPerMillion > 0 ? input / price.inputPerMillion : 1
  const usd = (uncached * input + cached * effectiveCacheRead(price) * scale + written * effectiveCacheWrite(price) * scale + completion * output) / 1_000_000
  if (!Number.isFinite(usd) || usd < 0) return { usd: 0, exact: false }
  return { usd: Math.round(usd * 1e9) / 1e9, exact }
}

/** Totales de un periodo, un curso o un uso. */
export interface CostSummary {
  /** Suma de lo que se sabe (USD). */
  usd: number
  calls: number
  /** Llamadas de coste desconocido (no suman: se dice aparte). */
  unknownCalls: number
  /** Llamadas con precio aproximado. */
  inexactCalls: number
  /** Llamadas que no costaron nada. */
  freeCalls: number
  tokens: number
}

export function emptySummary(): CostSummary {
  return { usd: 0, calls: 0, unknownCalls: 0, inexactCalls: 0, freeCalls: 0, tokens: 0 }
}

/** «0,41 US$», «≈ 0,0032 US$», «0 US$», «coste desconocido». Un coste que no se sabe se DICE, no se pinta como 0. */
export function formatUSD(value: number | undefined | null, exact = true): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0) return tr('coste desconocido', 'unknown cost')
  const locale = aiLocale()
  let text: string
  if (value === 0) {
    text = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(0)
  } else if (value < 0.01) {
    // por debajo de un céntimo, los céntimos no informan: se dan milésimas (como mucho 4 decimales)
    const shown = Math.max(value, 0.0001)
    text = (value < 0.0001 ? '< ' : '') + new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2, minimumSignificantDigits: 1 }).format(shown)
  } else {
    text = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  }
  return exact ? text : '≈ ' + text
}

/** El resumen de un periodo: «≈ 2,90 US$» o «1,20 US$ + 3 llamadas de coste desconocido». */
export function formatSummary(s: CostSummary): string {
  if (s.calls === 0) return formatUSD(0)
  if (s.calls - s.unknownCalls === 0) return formatUSD(undefined)
  const base = formatUSD(s.usd, s.inexactCalls === 0)
  if (s.unknownCalls <= 0) return base
  return tr(`${base} + ${s.unknownCalls} llamadas de coste desconocido`, `${base} + ${s.unknownCalls} calls of unknown cost`)
}
