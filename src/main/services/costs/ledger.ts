// El libro de cuentas de la IA (port de StudyEngine/Costs/CostLedger.swift). Cada llamada deja una línea: cuándo, qué proveedor y
// modelo, para qué, de qué curso, cuántos tokens y cuánto costó (`usd: null` = no se sabe; NUNCA 0 por no saber). De ahí salen
// «Este curso: ≈ 0,41 US$ · este mes: 2,90 US$» y el tope diario.
//
// Se guarda en `<datos>/costs.json` (escritura atómica, agrupada para no reescribir el archivo en cada llamada). El día de una
// línea es el día LOCAL en que se apuntó (se guarda con ella): cambiar de zona horaria no mueve lo ya apuntado. Las líneas de
// hace más de `detailDays` días se resumen (por día, curso, uso, proveedor y modelo) y los totales siguen saliendo iguales.
// Las claves de cada línea son las de la app Swift; si existe su libro (`<datos>/Costs/ledger.jsonl` + `rollups.json`) y aún
// no hay `costs.json`, se importa una vez.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Usage } from '@shared/ai/types'
import { readJSON, writeJSONAtomic } from '../fs'
import { log } from '../log'
import type { BillingKind, CostSummary, PriceSource } from './pricing'
import { emptySummary } from './pricing'
import { isAIUsePurpose, type AIUsePurpose } from './scope'

/** Cómo terminó una llamada. */
export type CostOutcome = 'ok' | 'cut' | 'failed' | 'cancelled'

/** Una llamada (o una tarea de agente completa) apuntada en el libro. */
export interface CostEntry {
  id: string
  /** Fecha ISO 8601. */
  at: string
  /** Día local (yyyy-MM-dd) en que se apuntó. */
  day: string
  providerID: string
  providerName: string
  billing: BillingKind
  model: string
  purpose: AIUsePurpose
  courseID?: string
  label?: string
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  reasoningTokens: number
  /** Dólares; `null` = no se sabe. */
  usd: number | null
  /** `false` = precio de lista o estimación («≈»). */
  exact: boolean
  priceSource?: PriceSource
  outcome: CostOutcome
}

/** Resumen de las líneas antiguas. */
export interface CostRollup {
  day: string
  courseID?: string
  purpose: AIUsePurpose
  providerID: string
  model: string
  usd: number
  calls: number
  unknownCalls: number
  inexactCalls: number
  freeCalls: number
  tokens: number
}

interface CostsFile {
  schema: 1
  /** Último día ya resumido en `rollups` (las líneas de ese día o anteriores no cuentan dos veces). */
  throughDay: string
  rollups: CostRollup[]
  entries: CostEntry[]
}

export const entryTokens = (e: Pick<CostEntry, 'promptTokens' | 'completionTokens'>) => e.promptTokens + e.completionTokens

/** Día local (yyyy-MM-dd) de un instante. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Medianoche local siguiente a `ms`. */
export function nextMidnight(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
}

/** `ms` menos `days` días de calendario local. */
export function daysBefore(ms: number, days: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days, d.getHours(), d.getMinutes()).getTime()
}

function addToSummary(s: CostSummary, e: CostEntry): void {
  s.calls += 1
  s.tokens += entryTokens(e)
  if (e.usd === null) {
    s.unknownCalls += 1
    return
  }
  s.usd += e.usd
  if (e.usd === 0) s.freeCalls += 1
  else if (!e.exact) s.inexactCalls += 1
}

function addRollup(s: CostSummary, r: CostRollup): void {
  s.calls += r.calls
  s.unknownCalls += r.unknownCalls
  s.inexactCalls += r.inexactCalls
  s.freeCalls += r.freeCalls
  s.tokens += r.tokens
  s.usd += r.usd
}

const rollupKey = (r: Pick<CostRollup, 'day' | 'courseID' | 'purpose' | 'providerID' | 'model'>) =>
  [r.day, r.courseID ?? '', r.purpose, r.providerID, r.model].join('\u001f')

const nonNegInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
const nonNegNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

const BILLINGS: BillingKind[] = ['perToken', 'subscription', 'local', 'unknown']
const SOURCES: PriceSource[] = ['user', 'live', 'list', 'free']
const OUTCOMES: CostOutcome[] = ['ok', 'cut', 'failed', 'cancelled']

/** Lee una línea tolerando datos viejos o editados a mano (un importe que no es finito y ≥ 0 se lee como «no se sabe»). */
export function decodeEntry(raw: unknown): CostEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const day = typeof o.day === 'string' ? o.day : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const at = typeof o.at === 'string' ? o.at : typeof o.at === 'number' ? new Date(o.at).toISOString() : new Date(0).toISOString()
  const usd = typeof o.usd === 'number' && Number.isFinite(o.usd) && o.usd >= 0 ? o.usd : null
  const e: CostEntry = {
    id: typeof o.id === 'string' && o.id ? o.id : Math.random().toString(36).slice(2, 14),
    at,
    day,
    providerID: typeof o.providerID === 'string' ? o.providerID : '',
    providerName: typeof o.providerName === 'string' ? o.providerName : '',
    billing: BILLINGS.includes(o.billing as BillingKind) ? (o.billing as BillingKind) : 'unknown',
    model: typeof o.model === 'string' ? o.model : '',
    purpose: isAIUsePurpose(o.purpose) ? o.purpose : 'other',
    promptTokens: nonNegInt(o.promptTokens),
    completionTokens: nonNegInt(o.completionTokens),
    cachedTokens: nonNegInt(o.cachedTokens),
    reasoningTokens: nonNegInt(o.reasoningTokens),
    usd,
    exact: o.exact === true,
    outcome: OUTCOMES.includes(o.outcome as CostOutcome) ? (o.outcome as CostOutcome) : 'ok'
  }
  const course = optStr(o.courseID)
  if (course) e.courseID = course
  const label = optStr(o.label)
  if (label) e.label = label
  if (SOURCES.includes(o.priceSource as PriceSource)) e.priceSource = o.priceSource as PriceSource
  return e
}

function decodeRollup(raw: unknown): CostRollup | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return null
  const r: CostRollup = {
    day: o.day,
    purpose: isAIUsePurpose(o.purpose) ? o.purpose : 'other',
    providerID: typeof o.providerID === 'string' ? o.providerID : '',
    model: typeof o.model === 'string' ? o.model : '',
    usd: nonNegNum(o.usd),
    calls: nonNegInt(o.calls),
    unknownCalls: nonNegInt(o.unknownCalls),
    inexactCalls: nonNegInt(o.inexactCalls),
    freeCalls: nonNegInt(o.freeCalls),
    tokens: nonNegInt(o.tokens)
  }
  const course = optStr(o.courseID)
  if (course) r.courseID = course
  return r
}

export interface CostLedgerOptions {
  /** Días que se guardan línea a línea (después, resumidos). Por defecto 31. */
  detailDays?: number
  /** Retraso con el que se agrupan las escrituras (ms). 0 = escribir en cada línea. Por defecto 400. */
  writeDelayMs?: number
}

/** Condición sobre (día, curso, uso). */
export type CostMatch = (day: string, courseID: string | undefined, purpose: AIUsePurpose) => boolean

export class CostLedger {
  readonly detailDays: number
  private readonly writeDelayMs: number
  private data: CostsFile | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private exitHook: (() => void) | null = null

  /** `file`: `<datos>/costs.json` (`null` = solo en memoria, para pruebas). */
  constructor(readonly file: string | null, opts: CostLedgerOptions = {}) {
    this.detailDays = Math.max(1, opts.detailDays ?? 31)
    this.writeDelayMs = Math.max(0, opts.writeDelayMs ?? 400)
  }

  private load(): CostsFile {
    if (this.data) return this.data
    const empty: CostsFile = { schema: 1, throughDay: '', rollups: [], entries: [] }
    if (!this.file) return (this.data = empty)
    const raw = readJSON<Partial<CostsFile>>(this.file)
    if (raw && typeof raw === 'object') {
      this.data = {
        schema: 1,
        throughDay: typeof raw.throughDay === 'string' ? raw.throughDay : '',
        rollups: Array.isArray(raw.rollups) ? raw.rollups.map(decodeRollup).filter((r): r is CostRollup => !!r) : [],
        entries: Array.isArray(raw.entries) ? raw.entries.map(decodeEntry).filter((e): e is CostEntry => !!e) : []
      }
      return this.data
    }
    const imported = existsSync(this.file) ? null : this.importSwiftLedger()
    this.data = imported ?? empty
    if (imported) this.scheduleWrite()
    return this.data
  }

  /** El libro de la app Swift (misma carpeta de datos), si existe: se lee una vez y se guarda en `costs.json`. */
  private importSwiftLedger(): CostsFile | null {
    if (!this.file) return null
    const dir = join(dirname(this.file), 'Costs')
    const ledger = join(dir, 'ledger.jsonl')
    const rollupsFile = join(dir, 'rollups.json')
    if (!existsSync(ledger) && !existsSync(rollupsFile)) return null
    const out: CostsFile = { schema: 1, throughDay: '', rollups: [], entries: [] }
    try {
      const r = readJSON<{ throughDay?: unknown; rows?: unknown[] }>(rollupsFile)
      if (r) {
        out.throughDay = typeof r.throughDay === 'string' ? r.throughDay : ''
        out.rollups = (r.rows ?? []).map(decodeRollup).filter((x): x is CostRollup => !!x)
      }
      if (existsSync(ledger)) {
        for (const line of readFileSync(ledger, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            const e = decodeEntry(JSON.parse(line))
            if (e && (!out.throughDay || e.day > out.throughDay)) out.entries.push(e)
          } catch {
            /* línea cortada: se ignora */
          }
        }
      }
      log.info(`Costes: importadas ${out.entries.length} líneas del libro de la app anterior`)
      return out
    } catch (err) {
      log.warn('Costes: no se pudo importar el libro de la app anterior', err)
      return null
    }
  }

  private scheduleWrite(): void {
    if (!this.file) return
    this.dirty = true
    if (this.writeDelayMs === 0) {
      this.flush()
      return
    }
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.writeDelayMs)
    this.timer.unref?.()
    if (!this.exitHook) {
      // al cerrar la app, lo pendiente se escribe (escritura síncrona)
      this.exitHook = () => this.flush()
      process.once('exit', this.exitHook)
    }
  }

  /** Escribe lo pendiente ya. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.file || !this.dirty || !this.data) return
    this.dirty = false
    try {
      writeJSONAtomic(this.file, this.data, false)
    } catch (err) {
      log.warn('Costes: no se pudo guardar el libro', err)
    }
  }

  // MARK: Escribir

  append(entry: CostEntry): void {
    this.load().entries.push(entry)
    this.scheduleWrite()
  }

  // MARK: Leer

  /** Las líneas que cuentan (las ya resumidas se ignoran). */
  entries(): CostEntry[] {
    const d = this.load()
    return d.throughDay ? d.entries.filter((e) => e.day > d.throughDay) : [...d.entries]
  }

  rollups(): CostRollup[] {
    return [...this.load().rollups]
  }

  summary(match: CostMatch): CostSummary {
    const s = emptySummary()
    for (const e of this.entries()) if (match(e.day, e.courseID, e.purpose)) addToSummary(s, e)
    for (const r of this.load().rollups) if (match(r.day, r.courseID, r.purpose)) addRollup(s, r)
    return s
  }

  summaryForDay(day: string): CostSummary {
    return this.summary((d) => d === day)
  }

  /** Lo de un mes («2026-10»). */
  summaryForMonth(month: string): CostSummary {
    return this.summary((d) => d.startsWith(month + '-'))
  }

  /** Lo de un curso (desde `sinceDay`, incluido). */
  summaryForCourse(courseID: string, sinceDay = ''): CostSummary {
    return this.summary((d, c) => c === courseID && d >= sinceDay)
  }

  /** Totales por curso en un mes ('' = lo que no es de ningún curso). */
  byCourse(month: string): Record<string, CostSummary> {
    const out: Record<string, CostSummary> = {}
    const get = (k: string | undefined) => (out[k ?? ''] ??= emptySummary())
    for (const e of this.entries()) if (e.day.startsWith(month + '-')) addToSummary(get(e.courseID), e)
    for (const r of this.load().rollups) if (r.day.startsWith(month + '-')) addRollup(get(r.courseID), r)
    return out
  }

  /** Totales por uso en un día. */
  byPurpose(day: string): Partial<Record<AIUsePurpose, CostSummary>> {
    const out: Partial<Record<AIUsePurpose, CostSummary>> = {}
    const get = (k: AIUsePurpose) => (out[k] ??= emptySummary())
    for (const e of this.entries()) if (e.day === day) addToSummary(get(e.purpose), e)
    for (const r of this.load().rollups) if (r.day === day) addRollup(get(r.purpose), r)
    return out
  }

  /** Las últimas líneas (la más reciente primero). */
  recent(limit = 50): CostEntry[] {
    return this.entries().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, Math.max(0, limit))
  }

  // MARK: Compactar

  /** Resume las líneas de antes de `hoy − detailDays` (idempotente). Devuelve cuántas resumió. */
  compact(nowMs = Date.now()): number {
    const d = this.load()
    const cutoff = dayKey(daysBefore(nowMs, this.detailDays))
    const old = d.entries.filter((e) => e.day < cutoff && e.day > d.throughDay)
    const keep = d.entries.filter((e) => e.day >= cutoff)
    if (!old.length && keep.length === d.entries.length) return 0
    if (old.length) {
      const rows = new Map(d.rollups.map((r) => [rollupKey(r), r]))
      for (const e of old) {
        const key = rollupKey(e)
        let r = rows.get(key)
        if (!r) {
          r = { day: e.day, purpose: e.purpose, providerID: e.providerID, model: e.model, usd: 0, calls: 0, unknownCalls: 0, inexactCalls: 0, freeCalls: 0, tokens: 0 }
          if (e.courseID) r.courseID = e.courseID
          rows.set(key, r)
        }
        r.calls += 1
        r.tokens += entryTokens(e)
        if (e.usd === null) r.unknownCalls += 1
        else {
          r.usd += e.usd
          if (e.usd === 0) r.freeCalls += 1
          else if (!e.exact) r.inexactCalls += 1
        }
      }
      d.rollups = [...rows.values()].sort((a, b) => (rollupKey(a) < rollupKey(b) ? -1 : 1))
      const maxDay = old.reduce((m, e) => (e.day > m ? e.day : m), d.throughDay)
      d.throughDay = maxDay
    }
    d.entries = keep
    this.scheduleWrite()
    return old.length
  }

  /** Para pruebas: olvida lo leído (se vuelve a leer del archivo). */
  reload(): void {
    this.flush()
    this.data = null
  }
}

/** Una línea a partir de un uso. */
export function usageFields(u: Usage): Pick<CostEntry, 'promptTokens' | 'completionTokens' | 'cachedTokens' | 'reasoningTokens'> {
  return {
    promptTokens: Math.max(0, u.promptTokens),
    completionTokens: Math.max(0, u.completionTokens),
    cachedTokens: Math.max(0, u.cachedTokens),
    reasoningTokens: Math.max(0, u.reasoningTokens)
  }
}
