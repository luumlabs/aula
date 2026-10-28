// Línea de tiempo a escala (port de TimelineBlockView.swift): fechas → años decimales, carriles sin solapes, carriles de los
// periodos y marcas del eje. Lógica pura (se prueba aparte).
import { HistoricalDate } from '@shared/schema/visual'
import type { TimelineEvent, TimelinePeriod } from '@shared/schema/blocks'
import { niceStep, ticks } from '../plot/ticks'

export interface TimelineItem {
  index: number
  event: TimelineEvent
  start: number
  end?: number
}

export interface PeriodItem {
  index: number
  period: TimelinePeriod
  start: number
  end: number
}

/** Hechos con fecha legible (como mucho 200); los demás se nombran aparte. */
export function timelineItems(events: TimelineEvent[]): TimelineItem[] {
  const out: TimelineItem[] = []
  events.slice(0, 200).forEach((event, index) => {
    const p = HistoricalDate.parse(event.when)
    if (!p) return
    const e = event.end !== undefined ? HistoricalDate.parse(event.end) : undefined
    const end = e ? (e.end ?? e.start) : p.end
    out.push({ index, event, start: p.start, end: end !== undefined && end > p.start ? end : undefined })
  })
  return out
}

export function periodItems(periods: TimelinePeriod[]): PeriodItem[] {
  const out: PeriodItem[] = []
  periods.slice(0, 40).forEach((period, index) => {
    const a = HistoricalDate.parse(period.from)
    const b = HistoricalDate.parse(period.to)
    if (!a || !b) return
    const end = b.end ?? b.start
    if (end > a.start) out.push({ index, period, start: a.start, end })
  })
  return out
}

/** ¿Se dibuja a escala? Con dos hechos o más y la mayoría con fecha legible (o si el autor lo pide en horizontal). */
export function isProportional(layout: string, total: number, dated: number): boolean {
  if (layout === 'vertical' || total < 2) return false
  return layout === 'horizontal' ? dated >= 2 : dated >= total * 0.7
}

/** Extremos de la escala con un margen del 4 %. */
export function timelineSpan(items: TimelineItem[], periods: PeriodItem[]): [number, number] {
  const starts = [...items.map((i) => i.start), ...periods.map((p) => p.start)]
  const ends = [...items.map((i) => i.end ?? i.start), ...periods.map((p) => p.end)]
  if (!starts.length) return [0, 1]
  const lo0 = Math.min(...starts)
  const hi0 = Math.max(...ends)
  const span = Math.max(hi0 - lo0, 1e-6)
  return [lo0 - span * 0.04, hi0 + span * 0.04]
}

export const xOf = (v: number, lo: number, hi: number, width: number, pad = 16): number => pad + ((v - lo) / Math.max(1e-9, hi - lo)) * (width - pad * 2)

/** Ancho aproximado de la etiqueta de un hecho (fecha + título) en px. */
export function labelWidth(e: TimelineEvent, dateText: string): number {
  return Math.min(260, Array.from(dateText).length * 6.6 + Array.from(e.title).length * 7.1 + 30)
}

/** Carriles sin solapes: cada hecho va en el primer carril donde cabe su etiqueta (a la derecha de su punto). */
export function lanes(items: TimelineItem[], lo: number, hi: number, width: number, dateText: (s: string) => string): Map<number, number> {
  const laneEnd: number[] = []
  const out = new Map<number, number>()
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    const x = xOf(it.start, lo, hi, width)
    const w = labelWidth(it.event, dateText(it.event.when))
    const start = Math.min(x - 8, width - w - 4)
    const right = Math.max(start + w, it.end !== undefined ? xOf(it.end, lo, hi, width) : 0) + 8
    const k = laneEnd.findIndex((e) => e <= start - 4)
    if (k >= 0) {
      laneEnd[k] = right
      out.set(it.index, k)
    } else {
      laneEnd.push(right)
      out.set(it.index, laneEnd.length - 1)
    }
  }
  return out
}

/** Carril de cada periodo (reparto voraz): dos periodos solo se apilan si se solapan. Como mucho 3 carriles. */
export function periodLanes(periods: PeriodItem[]): { lane: Map<number, number>; count: number } {
  const ends: number[] = []
  const lane = new Map<number, number>()
  for (const p of [...periods].sort((a, b) => a.start - b.start)) {
    const k = ends.findIndex((e) => e <= p.start)
    if (k >= 0) {
      ends[k] = p.end
      lane.set(p.index, k)
    } else {
      ends.push(p.end)
      lane.set(p.index, ends.length - 1)
    }
  }
  return { lane, count: Math.min(3, ends.length) }
}

/** Texto de un año: «1789», «44 a. C.» / «44 BC», «65 Ma». */
export function yearText(y: number, words: { bc: (n: string) => string; ma: (n: string) => string }, lang: string): string {
  if (Math.abs(y) >= 1e5) {
    const ma = new Intl.NumberFormat(lang || 'en', { maximumSignificantDigits: 4 }).format(Math.abs(y) / 1e6)
    return words.ma(ma)
  }
  const n = Math.round(y)
  return n < 0 ? words.bc(String(-n)) : String(n)
}

export interface AxisTick {
  value: number
  /** Año entero o mes (fracción de año). */
  kind: 'year' | 'month'
}

/** Marcas del eje: años enteros (nunca medios años) o, en periodos de menos de 2 años, meses. */
export function axisTicks(lo: number, hi: number, width: number): AxisTick[] {
  const span = hi - lo
  const target = Math.max(3, Math.floor(width / 110))
  if (span >= 2 || Math.abs(lo) >= 1e5 || Math.abs(hi) >= 1e5) {
    let step = niceStep(span, target)
    if (Math.abs(lo) < 1e5 && Math.abs(hi) < 1e5) step = Math.max(step, 1)
    return ticks(lo, hi, step).map((value) => ({ value, kind: 'year' as const }))
  }
  const monthStep = [1, 2, 3, 6].find((s) => (span * 12) / s <= target) ?? 6
  const out: AxisTick[] = []
  let m = Math.ceil((lo * 12) / monthStep) * monthStep
  while (m / 12 <= hi + 1e-9 && out.length < 60) {
    out.push({ value: m / 12, kind: 'month' })
    m += monthStep
  }
  return out
}

/** Fecha ISO («1789-07-14») como fecha legible en el idioma; lo demás, tal cual. */
export function dateText(s: string, lang: string): string {
  const m = /^(\d{3,4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return s
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return s
  try {
    return new Intl.DateTimeFormat(lang || 'en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
  } catch {
    return s
  }
}

/** «jul 1789» para una fracción de año. */
export function monthText(t: number, lang: string): string {
  const y = Math.floor(t)
  const k = Math.round((t - y) * 12) % 12
  try {
    const name = new Intl.DateTimeFormat(lang || 'en', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, k, 1)))
    return `${name} ${y}`
  } catch {
    return String(y)
  }
}
