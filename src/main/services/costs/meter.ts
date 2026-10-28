// Contabilidad y tope diario del dinero que gasta la IA (port de StudyEngine/Costs/CostMeter.swift).
//
// El tope es una PUERTA, no un aviso a posteriori:
//  · antes de empezar, una llamada de pago solo sale si lo gastado hoy (lo apuntado + lo que llevan las llamadas en curso) más
//    lo que suele costar una como ella cabe en el tope;
//  · durante la llamada, cada vez que el proveedor dice cuánto lleva, se suma y, si el total de hoy pasa del tope, la llamada se
//    corta (lo gastado se apunta igual);
//  · las suscripciones y los modelos de este ordenador no cuentan; con el tope puesto, un modelo de precio desconocido no se usa
//    (`blockUnknownPrices`), porque con él no se puede garantizar el tope.
// Es un límite de Aula con los precios que conoce, no la factura del proveedor.
import type { Usage } from '@shared/ai/types'
import { usageTotal } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import type { AISettings } from '@shared/settings/ai'
import { AIError } from '../ai/errors'
import { CostLedger, dayKey, nextMidnight, usageFields, type CostEntry, type CostOutcome } from './ledger'
import { PriceBook, type BillingProvider } from './priceBook'
import { costOf, formatUSD, isValidPrice, modelPrice, quoteIsKnown, quoteIsPaid, type ModelPrice, type PriceQuote } from './pricing'
import { currentAIUse, type AIUsePurpose, type AIUseScope } from './scope'

/** Ajustes del gasto. */
export interface SpendingSettings {
  /** Tope diario en USD. `null` = sin tope. Negativo o no finito = tope mal puesto (lo de pago no sale). */
  dailyLimitUSD: number | null
  /** A partir de qué fracción del tope se avisa (0,1…1). */
  warnFraction: number
  /** Con tope: no usar modelos de precio desconocido. */
  blockUnknownPrices: boolean
  /** Precios propios: «modelo» o «proveedor:modelo». */
  userPrices: Record<string, ModelPrice>
}

export function defaultSpending(): SpendingSettings {
  return { dailyLimitUSD: null, warnFraction: 0.8, blockUnknownPrices: true, userPrices: {} }
}

/** Los ajustes de gasto a partir de los de IA (`dailyBudgetUSD: 0` = sin tope). */
export function spendingFromAISettings(ai: Partial<AISettings> | undefined): SpendingSettings {
  const s = defaultSpending()
  const raw = ai?.dailyBudgetUSD
  if (typeof raw === 'number') s.dailyLimitUSD = raw === 0 ? null : Number.isFinite(raw) && raw > 0 ? raw : -1
  else if (raw !== undefined && raw !== null) s.dailyLimitUSD = -1
  const w = ai?.warnFraction
  if (typeof w === 'number' && Number.isFinite(w)) s.warnFraction = Math.min(1, Math.max(0.1, w))
  if (typeof ai?.blockUnknownPrices === 'boolean') s.blockUnknownPrices = ai.blockUnknownPrices
  for (const [k, v] of Object.entries(ai?.userPrices ?? {})) {
    if (!v) continue
    const p = modelPrice(v.input, v.output, v.cacheRead, v.cacheWrite)
    if (isValidPrice(p)) s.userPrices[k] = p
  }
  return s
}

export const limitIsValid = (s: SpendingSettings) => s.dailyLimitUSD === null || (Number.isFinite(s.dailyLimitUSD) && s.dailyLimitUSD >= 0)

export type SpendingLevel = 'noLimit' | 'ok' | 'warning' | 'reached' | 'invalid'

/** Dónde está el gasto de hoy (lo mismo que mira la puerta: la interfaz no suma por su cuenta). */
export interface SpendingStatus {
  day: string
  limit: number | null
  /** Apuntado hoy (lo conocido). */
  spent: number
  /** Lo que llevan las llamadas en curso. */
  inFlight: number
  unknownCalls: number
  /** Todo lo de hoy es exacto. */
  exact: boolean
  level: SpendingLevel
  /** Medianoche local (ms). */
  resetsAt: number
}

export const committedOf = (s: SpendingStatus) => s.spent + s.inFlight
export const remainingOf = (s: SpendingStatus) => (s.limit === null ? null : Math.max(0, s.limit - committedOf(s)))
export const allowsPaidWork = (s: SpendingStatus) => s.level !== 'reached' && s.level !== 'invalid'

/** «0,41 US$ de 2,00 US$ hoy», «0,41 US$ hoy (sin tope)». */
export function statusText(s: SpendingStatus): string {
  const spent = formatUSD(committedOf(s), s.exact)
  if (s.limit === null) return tr(`${spent} hoy (sin tope)`, `${spent} today (no limit)`)
  return tr(`${spent} de ${formatUSD(s.limit)} hoy`, `${spent} of ${formatUSD(s.limit)} today`)
}

export type BudgetReason = { type: 'reached'; limit: number; spent: number } | { type: 'unknownPrice'; model: string } | { type: 'invalidLimit' }

function budgetMessage(reason: BudgetReason, midRun: boolean): string {
  switch (reason.type) {
    case 'reached': {
      const l = formatUSD(reason.limit)
      return midRun
        ? tr(`Paré aquí: llegaste al tope de gasto de hoy (${l}). Lo hecho se guarda; puedes seguir mañana o subir el tope en ${settingsPath('ai', 'es')}.`,
          `I stopped here: you reached today’s spending limit (${l}). What’s done is saved; you can continue tomorrow or raise the limit in ${settingsPath('ai', 'en')}.`)
        : tr(`Llegaste al tope de gasto de hoy (${l}). Vuelve a haber margen mañana, o sube el tope en ${settingsPath('ai', 'es')}.`,
          `You reached today’s spending limit (${l}). There will be room again tomorrow, or raise the limit in ${settingsPath('ai', 'en')}.`)
    }
    case 'unknownPrice':
      return tr(`Con el tope de gasto puesto, Aula no usa «${reason.model}» porque no sabe su precio. Añade su precio en ${settingsPath('ai', 'es')}, elige otro modelo o quita el tope.`,
        `With the spending limit on, Aula doesn’t use “${reason.model}” because it doesn’t know its price. Add its price in ${settingsPath('ai', 'en')}, choose another model or remove the limit.`)
    case 'invalidLimit':
      return tr(`El tope de gasto diario no es un número válido. Corrígelo en ${settingsPath('ai', 'es')}.`, `The daily spending limit isn’t a valid number. Fix it in ${settingsPath('ai', 'en')}.`)
  }
}

/** Por qué no sale (o se cortó) una llamada de pago. Código estable `ai_budget`. */
export class BudgetError extends AIError {
  readonly reason: BudgetReason
  /** Cuándo vuelve a haber margen (medianoche local, ms); `undefined` si depende de la persona. */
  readonly resumesAt?: number
  readonly midRun: boolean

  constructor(reason: BudgetReason, opts: { resumesAt?: number; midRun?: boolean } = {}) {
    super('other', budgetMessage(reason, opts.midRun ?? false), { code: 'ai_budget' })
    this.name = 'BudgetError'
    this.reason = reason
    this.resumesAt = opts.resumesAt
    this.midRun = opts.midRun ?? false
  }
}

interface Flight {
  purpose: AIUsePurpose
  courseID?: string
  model: string
  reservedUSD: number
  usd: number
}

let ticketCounter = 0
const newID = () => Date.now().toString(36) + (ticketCounter++).toString(36) + Math.random().toString(36).slice(2, 6)

export interface CostMeterOptions {
  ledger: CostLedger
  prices: PriceBook
  /** De dónde sale el tope (se lee en cada consulta). */
  settings: () => SpendingSettings
  clock?: () => number
}

export class CostMeter {
  readonly ledger: CostLedger
  readonly prices: PriceBook
  private readonly settingsSource: () => SpendingSettings
  private readonly clock: () => number
  private flights = new Map<string, Flight>()
  private lastCompaction: number | undefined

  constructor(opts: CostMeterOptions) {
    this.ledger = opts.ledger
    this.prices = opts.prices
    this.settingsSource = opts.settings
    this.clock = opts.clock ?? Date.now
  }

  get settings(): SpendingSettings {
    return this.settingsSource()
  }

  get now(): number {
    return this.clock()
  }

  // MARK: Consultar

  quote(provider: BillingProvider, model?: string): PriceQuote {
    return this.prices.quote(provider, model, this.settings.userPrices, this.clock())
  }

  status(): SpendingStatus {
    const now = this.clock()
    const s = this.settings
    const day = dayKey(now)
    const today = this.ledger.summaryForDay(day)
    let inFlight = 0
    for (const f of this.flights.values()) inFlight += f.usd
    const st: SpendingStatus = {
      day, limit: s.dailyLimitUSD, spent: today.usd, inFlight, unknownCalls: today.unknownCalls,
      exact: today.inexactCalls === 0 && inFlight === 0, level: 'noLimit', resetsAt: nextMidnight(now)
    }
    if (!limitIsValid(s)) return { ...st, limit: null, level: 'invalid' }
    const limit = s.dailyLimitUSD
    if (limit === null) return st
    const committed = committedOf(st)
    if (limit === 0 || committed >= limit) st.level = 'reached'
    else if (committed >= limit * s.warnFraction) st.level = 'warning'
    else st.level = 'ok'
    return st
  }

  /** Lo que suele costar una llamada así (mediana de las últimas 15 del mismo uso y modelo); 0 sin historia. */
  typicalCost(purpose: AIUsePurpose, model: string): number {
    const recent = this.ledger.entries().reverse()
      .filter((e) => e.purpose === purpose && e.model === model && e.outcome === 'ok' && e.usd !== null)
      .slice(0, 15).map((e) => e.usd as number).sort((a, b) => a - b)
    return recent.length ? recent[Math.floor(recent.length / 2)] : 0
  }

  /** ¿Puede salir una llamada de pago con este proveedor y modelo? Lanza `BudgetError` si no (sin efectos). */
  check(provider: BillingProvider, model?: string, purpose: AIUsePurpose = 'other'): void {
    this.admission(this.quote(provider, model), purpose)
  }

  /** ¿Ya se gastó hoy todo el tope? (entre etapas de un trabajo largo). Un proveedor que no cobra nunca se para. */
  checkBudget(provider?: BillingProvider, model?: string): void {
    if (provider) {
      const q = this.quote(provider, model)
      if (!quoteIsPaid(q) && quoteIsKnown(q)) return
    }
    const st = this.status()
    if (st.level === 'reached' && committedOf(st) > 0) {
      throw new BudgetError({ type: 'reached', limit: st.limit ?? 0, spent: committedOf(st) }, { resumesAt: st.resetsAt })
    }
  }

  /** Lo que se reserva hasta saber el coste real (o lanza). */
  private admission(q: PriceQuote, purpose: AIUsePurpose): number {
    if (!quoteIsPaid(q) && quoteIsKnown(q)) return 0 // gratis: siempre
    const s = this.settings
    if (!limitIsValid(s)) throw new BudgetError({ type: 'invalidLimit' })
    const estimate = quoteIsKnown(q) ? this.typicalCost(purpose, q.model) : 0
    const limit = s.dailyLimitUSD
    if (limit === null) return estimate
    const st = this.status()
    const committed = committedOf(st)
    if (committed >= limit || committed + estimate > limit + 1e-12) {
      throw new BudgetError({ type: 'reached', limit, spent: committed }, { resumesAt: st.resetsAt })
    }
    if (!quoteIsKnown(q)) {
      if (s.blockUnknownPrices) throw new BudgetError({ type: 'unknownPrice', model: q.model || '?' })
      return 0
    }
    return estimate
  }

  // MARK: Una llamada

  /** Pide paso para una llamada (lanza `BudgetError` si no cabe) y la registra como «en curso». */
  begin(provider: BillingProvider, model?: string, scope?: AIUseScope): CostTicket {
    const q = this.quote(provider, model)
    const use = scope ?? currentAIUse() ?? { purpose: 'other' as const }
    const reserved = this.admission(q, use.purpose)
    const t = new CostTicket(this, provider, q, use)
    this.flights.set(t.id, { purpose: use.purpose, courseID: use.courseID, model: q.model, reservedUSD: reserved, usd: reserved })
    return t
  }

  /** @internal */
  updateFlight(id: string, usd: number): void {
    const f = this.flights.get(id)
    if (f) f.usd = Math.max(f.reservedUSD, usd)
  }

  /** @internal Apunta lo gastado y la quita de «en curso». */
  close(id: string, entry: CostEntry): void {
    this.ledger.append(entry)
    this.flights.delete(id)
    this.compactIfDue()
  }

  /** @internal ¿Se pasó hoy del tope (contando lo que llevan las llamadas en curso)? */
  overLimit(): BudgetError | undefined {
    const s = this.settings
    if (!limitIsValid(s) || s.dailyLimitUSD === null) return undefined
    const st = this.status()
    if (committedOf(st) <= s.dailyLimitUSD + 1e-12) return undefined
    return new BudgetError({ type: 'reached', limit: s.dailyLimitUSD, spent: committedOf(st) }, { resumesAt: st.resetsAt, midRun: true })
  }

  /** Apunta una llamada que se midió en otro sitio (p. ej. un proceso que solo informó el uso al final). */
  record(provider: BillingProvider, model: string | undefined, usage: Usage, scope?: AIUseScope, outcome: CostOutcome = 'ok'): CostEntry {
    const t = new CostTicket(this, provider, this.quote(provider, model), scope ?? currentAIUse() ?? { purpose: 'other' })
    return t.finish(usage, outcome)
  }

  private compactIfDue(): void {
    const now = this.clock()
    if (this.lastCompaction !== undefined && now - this.lastCompaction < 86_400_000) return
    this.lastCompaction = now
    try {
      this.ledger.compact(now)
    } catch {
      /* se reintenta otro día */
    }
  }
}

/** Una llamada en curso: se actualiza con el uso acumulado y se cierra al terminar (se apunta siempre, también si falla). */
export class CostTicket {
  readonly id = newID()
  private closed = false
  private last = 0

  constructor(private readonly meter: CostMeter, readonly provider: BillingProvider, readonly quote: PriceQuote, readonly scope: AIUseScope) {}

  /** El coste de un uso acumulado con el precio de esta llamada (`undefined` si el precio no se sabe). */
  cost(usage: Usage, perCallPromptTokens?: number): { usd: number; exact: boolean } | undefined {
    if (!this.quote.price) return undefined
    const c = costOf(usage, this.quote.price, 0, perCallPromptTokens)
    return { usd: c.usd, exact: c.exact && this.quote.exact }
  }

  /** Nuevo uso acumulado. Devuelve el error si con esto se pasó del tope de hoy (hay que cortar la llamada). */
  update(cumulative: Usage, perCallPromptTokens?: number): BudgetError | undefined {
    const c = this.cost(cumulative, perCallPromptTokens)
    if (!c || this.closed) return undefined
    this.last = c.usd
    this.meter.updateFlight(this.id, c.usd)
    if (!quoteIsPaid(this.quote)) return undefined
    return this.meter.overLimit()
  }

  /** Cierra la llamada y la apunta. Idempotente: la segunda vez no apunta nada. */
  finish(usage: Usage, outcome: CostOutcome = 'ok', perCallPromptTokens?: number): CostEntry {
    const now = this.meter.now
    const c = this.cost(usage, perCallPromptTokens)
    let usd: number | null = c ? c.usd : null
    let exact = c?.exact ?? false
    // una llamada de pago que falló sin decir cuánto gastó: 0 aproximado (no bloquea el tope como «desconocida»)
    if (c && usageTotal(usage) === 0 && outcome !== 'ok' && quoteIsPaid(this.quote)) {
      usd = 0
      exact = false
    }
    const entry: CostEntry = {
      id: this.id,
      at: new Date(now).toISOString(),
      day: dayKey(now),
      providerID: this.provider.id,
      providerName: this.provider.label ?? '',
      billing: this.quote.billing,
      model: this.quote.model,
      purpose: this.scope.purpose,
      ...usageFields(usage),
      usd,
      exact,
      outcome
    }
    if (this.scope.courseID) entry.courseID = this.scope.courseID
    if (this.scope.label) entry.label = Array.from(this.scope.label).slice(0, 160).join('')
    if (this.quote.source) entry.priceSource = this.quote.source
    if (!this.closed) {
      this.closed = true
      this.meter.close(this.id, entry)
    }
    return entry
  }

  /** Lo que lleva gastado. */
  get currentUSD(): number {
    return this.last
  }
}
