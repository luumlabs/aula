// Costes de la IA: precios, libro de cuentas (`<datos>/costs.json`), tope diario y el envoltorio que mide cada llamada.
//
//     const model = meteredModel(base, { id, kind, baseURL }, costMeter())   // (resolveActiveModel ya lo hace)
//     await withAIUse({ purpose: 'course', courseID }, () => runToolLoop({ model, … }))
//     costMeter().status()                       // «0,41 US$ de 2,00 US$ hoy»
//     costMeter().ledger.summaryForCourse(id)    // «Este curso: ≈ 0,41 US$»
import { join } from 'node:path'
import type { AICostsView, CostSummaryView } from '@shared/ai/views'
import { getSettings } from '../settings'
import { paths } from '../paths'
import { CostLedger } from './ledger'
import { CostMeter, committedOf, remainingOf, spendingFromAISettings, statusText } from './meter'
import { PriceBook } from './priceBook'
import { formatSummary, type CostSummary } from './pricing'

export * from './pricing'
export * from './priceBook'
export * from './ledger'
export * from './meter'
export * from './metered'
export * from './scope'

let shared: CostMeter | null = null

function dataFile(build: () => string): string | null {
  try {
    return build()
  } catch {
    return null // sin carpeta de datos (pruebas): en memoria
  }
}

/** El contador de la app (el mismo para todo el proceso: la puerta ve las llamadas en curso de todos). */
export function costMeter(): CostMeter {
  if (shared) return shared
  shared = new CostMeter({
    ledger: new CostLedger(dataFile(() => join(paths.root(), 'costs.json'))),
    prices: new PriceBook(dataFile(() => join(paths.cache(), 'prices.json'))),
    settings: () => spendingFromAISettings(getSettings().ai)
  })
  return shared
}

/** Para pruebas (o para cambiar de carpeta de datos). `null` = se vuelve a crear la próxima vez. */
export function setCostMeter(meter: CostMeter | null): void {
  shared?.ledger.flush()
  shared = meter
}

export function summaryView(s: CostSummary): CostSummaryView {
  return { ...s, usd: Math.round(s.usd * 1e6) / 1e6, text: formatSummary(s) }
}

/** Lo que enseña la interfaz: hoy, el mes, el tope y el reparto por uso y por curso. */
export function costsView(meter: CostMeter = costMeter()): AICostsView {
  const st = meter.status()
  const month = st.day.slice(0, 7)
  const byPurpose: Record<string, CostSummaryView> = {}
  for (const [k, v] of Object.entries(meter.ledger.byPurpose(st.day))) if (v) byPurpose[k] = summaryView(v)
  const byCourse: Record<string, CostSummaryView> = {}
  for (const [k, v] of Object.entries(meter.ledger.byCourse(month))) byCourse[k] = summaryView(v)
  return {
    today: summaryView(meter.ledger.summaryForDay(st.day)),
    month: summaryView(meter.ledger.summaryForMonth(month)),
    limitUSD: st.limit,
    level: st.level,
    committedUSD: committedOf(st),
    remainingUSD: remainingOf(st),
    resetsAt: st.resetsAt,
    statusText: statusText(st),
    byPurpose,
    byCourse
  }
}
