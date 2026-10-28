// Port de Tests/StudyEngineTests/CostTests.swift y SpendingCapContractTests.swift: precios, libro de cuentas, tope diario y el
// envoltorio que mide cada llamada a la IA.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setAILocale } from '@shared/ai/i18n'
import type { ModelCatalog, Usage } from '@shared/ai/types'
import { emptyUsage } from '@shared/ai/types'
import { MockChatModel, step } from '../ai/testing/mocks'
import type { ChatModel } from '../ai/model'
import { CostLedger, dayKey, type CostEntry } from './ledger'
import { BudgetError, CostMeter, spendingFromAISettings, statusText, type SpendingSettings } from './meter'
import { meteredModel } from './metered'
import { PriceBook, listPriceFor, LIST_PRICES, normalizeModel, dayToMs, type BillingProvider } from './priceBook'
import { costOf, formatSummary, formatUSD, isValidPrice, modelPrice, quoteExplanation, quoteIsKnown, quoteIsPaid, emptySummary } from './pricing'
import { withAIUse } from './scope'
import { costsView } from './index'

const deepseek: BillingProvider = { id: 'deepseek', kind: 'openai-compatible', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash' }
const openrouter: BillingProvider = { id: 'openrouter', kind: 'openai-compatible', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-5.5' }
const claudeSub: BillingProvider = { id: 'claude-cli', kind: 'claude-cli', label: 'Claude', model: '' }
const ollama: BillingProvider = { id: 'ollama', kind: 'ollama', label: 'Ollama', baseURL: 'http://localhost:11434/v1', model: 'qwen3.5:9b' }
const custom: BillingProvider = { id: 'mi-servidor', kind: 'openai-compatible', label: 'Mío', baseURL: 'https://ia.example.com/v1', model: 'secreto-1' }
const u = (p: number, c = 0, cached = 0): Usage => ({ ...emptyUsage(), promptTokens: p, completionTokens: c, cachedTokens: cached })

let root: string
beforeEach(() => {
  setAILocale('es')
  root = mkdtempSync(join(tmpdir(), 'aula-costs-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function entry(usd: number | null, day: string, o: Partial<CostEntry> = {}): CostEntry {
  return {
    id: Math.random().toString(36).slice(2), at: new Date().toISOString(), day, providerID: 'deepseek', providerName: 'DeepSeek', billing: 'perToken',
    model: 'deepseek-flash', purpose: 'chat', promptTokens: 10, completionTokens: 5, cachedTokens: 0, reasoningTokens: 0, usd, exact: true, priceSource: 'list', outcome: 'ok', ...o
  }
}

function meterWith(settings: () => SpendingSettings, clock?: () => number, file: string | null = null): CostMeter {
  return new CostMeter({ ledger: new CostLedger(file, { writeDelayMs: 0 }), prices: new PriceBook(null), settings, clock })
}
const limit = (v: number | null, o: Partial<SpendingSettings> = {}): SpendingSettings => ({ dailyLimitUSD: v, warnFraction: 0.8, blockUnknownPrices: true, userPrices: {}, ...o })

describe('precios', () => {
  it('se normaliza sin emparejar nunca por prefijo', () => {
    expect(normalizeModel('anthropic/claude-sonnet-5.5')).toBe('claude-sonnet-5-5')
    expect(normalizeModel('claude-opus-4-6-20260115')).toBe('claude-opus-4-6')
    expect(normalizeModel('anthropic.claude-haiku-4-5-v1:0')).toBe('claude-haiku-4-5')
    expect(normalizeModel('claude-opus-5-5@20260401')).toBe('claude-opus-5-5')
    expect(listPriceFor('claude-opus-5-5')?.price.inputPerMillion).toBe(4)
    expect(listPriceFor('claude-opus-5')?.price.inputPerMillion).toBe(5)
    expect(listPriceFor('claude-opus-5-6')).toBeUndefined()
    expect(listPriceFor('deepseek/deepseek-v4.1-flash')?.price.cacheReadPerMillion).toBe(0.006)
  })
  it('la tabla de lista tiene fecha, referencia y precios válidos (cada modelo en una fila)', () => {
    for (const row of LIST_PRICES) {
      expect(isValidPrice(row.price), row.ids.join()).toBe(true)
      expect(dayToMs(row.verified)).toBeDefined()
      expect(row.reference).not.toBe('')
    }
    const ids = LIST_PRICES.flatMap((r) => r.ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('cobro y cotizaciones', () => {
    const book = new PriceBook(null)
    expect(book.quote(claudeSub).billing).toBe('subscription')
    expect(quoteIsPaid(book.quote(claudeSub))).toBe(false)
    expect(book.quote(ollama).billing).toBe('local')
    expect(book.quote({ id: 'opencode-cli', kind: 'opencode-cli', model: 'x' }).billing).toBe('unknown')
    const ds = book.quote(deepseek)
    expect(ds.source).toBe('list')
    expect(ds.exact).toBe(false)
    expect(ds.price?.inputPerMillion).toBe(0.3)
    const unknown = book.quote(custom)
    expect(quoteIsKnown(unknown)).toBe(false)
    expect(quoteIsPaid(unknown)).toBe(true)
    expect(quoteExplanation(unknown)).toContain('no sabe')
    const mine = book.quote(custom, undefined, { 'secreto-1': modelPrice(1, 2) })
    expect(mine.source).toBe('user')
    expect(mine.exact).toBe(true)
    expect(quoteIsKnown(book.quote(custom, undefined, { 'secreto-1': modelPrice(-1, 2) }))).toBe(false)
    expect(book.quote(deepseek, undefined, { 'deepseek:deepseek-flash': modelPrice(9, 9) }).price?.inputPerMillion).toBe(9)
    expect(quoteIsPaid(book.quote(openrouter, 'qwen/qwen3:free'))).toBe(false)
  })
  it('los precios del catálogo en vivo mandan y se guardan', () => {
    const file = join(root, 'Cache', 'prices.json')
    const book = new PriceBook(file)
    expect(book.quote(openrouter).source).toBe('list')
    const fetched = Date.now()
    const catalog: ModelCatalog = {
      models: [{ id: 'anthropic/claude-sonnet-5.5', inputPricePerMillion: 2.2, outputPricePerMillion: 11, isFree: false },
        { id: 'meta/gratis', inputPricePerMillion: 0, outputPricePerMillion: 0, isFree: true }, { id: 'sin/precio', isFree: false }],
      popular: [], free: [], fetchedAt: fetched, source: 'api'
    }
    expect(book.learn(catalog, openrouter)).toBe(2)
    const q = book.quote(openrouter, undefined, {}, fetched)
    expect(q.source).toBe('live')
    expect(q.exact).toBe(true)
    expect(q.price?.inputPerMillion).toBe(2.2)
    expect(quoteIsPaid(book.quote(openrouter, 'meta/gratis'))).toBe(false)
    expect(book.learn({ models: [{ id: 'x', inputPricePerMillion: 1, outputPricePerMillion: 1, isFree: false }], popular: [], free: [], fetchedAt: fetched, source: 'known' }, openrouter)).toBe(0)
    const again = new PriceBook(file)
    expect(again.quote(openrouter, undefined, {}, fetched).price?.outputPerMillion).toBe(11)
    expect(again.quote(openrouter, undefined, {}, fetched + 60 * 86_400_000).exact).toBe(false)
    writeFileSync(file, '{nope')
    expect(new PriceBook(file).quote(openrouter).source).toBe('list')
  })
  it('cálculo del coste (caché leída y escrita, tramo largo, números imposibles)', () => {
    const sonnet = listPriceFor('claude-sonnet-5-5')!.price
    const c = costOf(u(1_000_000, 100_000, 200_000), sonnet)
    expect(c.usd).toBeCloseTo(1.6 + 0.04 + 1.0, 9)
    expect(c.exact).toBe(true)
    expect(costOf(u(1_000_000), sonnet, 1_000_000).usd).toBeCloseTo(2.5, 9)
    expect(costOf({ ...u(1_000_000), cacheWriteTokens: 1_000_000 }, sonnet).usd).toBeCloseTo(2.5, 9)
    const haiku = listPriceFor('claude-haiku-5-5')!.price
    expect(costOf(u(200_000), haiku, 0, 200_000).usd).toBeCloseTo(0.1, 9)
    const cum = costOf(u(300_000), haiku)
    expect(cum.usd).toBeCloseTo(0.03, 9)
    expect(cum.exact).toBe(false)
    expect(costOf({ ...u(-5, -1, 99) }, sonnet).usd).toBe(0)
  })
  it('un coste desconocido se dice, no se pinta como 0', () => {
    setAILocale('en')
    expect(formatUSD(undefined)).toBe('unknown cost')
    expect(formatUSD(Number.NaN)).toBe(formatUSD(undefined))
    expect(formatUSD(0.41)).toBe('$0.41')
    expect(formatUSD(0.41, false)).toBe('≈ $0.41')
    expect(formatUSD(0.0032)).toContain('0.0032')
    expect(formatUSD(0.00001).startsWith('< ')).toBe(true)
    const s = emptySummary()
    expect(formatSummary(s)).toBe('$0')
    expect(formatSummary({ ...s, calls: 2, unknownCalls: 2 })).toBe(formatUSD(undefined))
    setAILocale('es')
    expect(formatUSD(undefined)).toBe('coste desconocido')
  })
})

describe('libro de cuentas', () => {
  it('totales por día, mes, curso, uso; otra instancia lee lo mismo', () => {
    const file = join(root, 'costs.json')
    const ledger = new CostLedger(file, { writeDelayMs: 0 })
    ledger.append(entry(0.1, '2026-10-12', { courseID: 'quimica', purpose: 'course' }))
    ledger.append(entry(0.25, '2026-10-13', { courseID: 'quimica', purpose: 'tutor', exact: false }))
    ledger.append(entry(null, '2026-10-13', { purpose: 'chat' }))
    ledger.append(entry(0, '2026-10-13', { purpose: 'automation' }))
    ledger.append(entry(1, '2026-09-30', { courseID: 'fisica' }))
    const today = ledger.summaryForDay('2026-10-13')
    expect(today.usd).toBeCloseTo(0.25, 9)
    expect(today).toMatchObject({ calls: 3, unknownCalls: 1, freeCalls: 1, inexactCalls: 1 })
    expect(ledger.summaryForMonth('2026-10').usd).toBeCloseTo(0.35, 9)
    expect(ledger.summaryForCourse('quimica').usd).toBeCloseTo(0.35, 9)
    expect(ledger.byCourse('2026-10').quimica.calls).toBe(2)
    expect(ledger.byCourse('2026-10')[''].calls).toBe(2)
    expect(ledger.byPurpose('2026-10-13').tutor?.usd).toBeCloseTo(0.25, 9)
    const other = new CostLedger(file)
    expect(other.summaryForMonth('2026-10').calls).toBe(4)
  })
  it('escrituras agrupadas: se guardan con flush (y el archivo es JSON)', () => {
    const file = join(root, 'costs.json')
    const ledger = new CostLedger(file, { writeDelayMs: 10_000 })
    ledger.append(entry(0.5, '2026-10-13'))
    expect(existsSync(file)).toBe(false)
    ledger.flush()
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    expect(raw.schema).toBe(1)
    expect(raw.entries).toHaveLength(1)
  })
  it('compactar es idempotente y conserva los totales', () => {
    const ledger = new CostLedger(join(root, 'costs.json'), { writeDelayMs: 0, detailDays: 62 })
    const now = new Date(2026, 9, 13, 12, 0).getTime()
    for (const d of ['2026-06-01', '2026-06-01', '2026-07-15', '2026-10-01', '2026-10-13']) ledger.append(entry(0.5, d, { courseID: 'c' }))
    ledger.append(entry(null, '2026-06-02'))
    const before = [ledger.summaryForMonth('2026-06'), ledger.summaryForCourse('c'), ledger.summaryForMonth('2026-10')]
    expect(ledger.compact(now)).toBe(4)
    expect(ledger.entries()).toHaveLength(2)
    expect([ledger.summaryForMonth('2026-06'), ledger.summaryForCourse('c'), ledger.summaryForMonth('2026-10')]).toEqual(before)
    expect(ledger.compact(now)).toBe(0)
    // una línea ya resumida que reaparece no cuenta dos veces
    ledger.append(entry(0.5, '2026-06-01', { courseID: 'c' }))
    expect(ledger.summaryForCourse('c')).toEqual(before[1])
    const reread = new CostLedger(join(root, 'costs.json'))
    expect(reread.summaryForCourse('c')).toEqual(before[1])
  })
  it('lee datos viejos o editados a mano con tolerancia', () => {
    const file = join(root, 'costs.json')
    writeFileSync(file, JSON.stringify({ schema: 1, throughDay: '', rollups: [{ day: 'mal' }], entries: [{ day: '2026-10-13', usd: -3, purpose: 'nuevo', billing: 'raro' }, { nada: true }] }))
    const l = new CostLedger(file)
    const e = l.entries()
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ usd: null, purpose: 'other', billing: 'unknown', outcome: 'ok' })
  })
  it('importa una vez el libro de la app Swift', () => {
    mkdirSync(join(root, 'Costs'))
    writeFileSync(join(root, 'Costs', 'ledger.jsonl'), [
      JSON.stringify({ id: 'a', at: '2026-10-12T10:00:00Z', day: '2026-10-12', providerID: 'deepseek', billing: 'perToken', model: 'deepseek-flash', purpose: 'course', courseID: 'q', promptTokens: 1, completionTokens: 2, usd: 0.2, exact: true, outcome: 'ok' }),
      '{"id":"rota","usd":0.5,"da'
    ].join('\n'))
    writeFileSync(join(root, 'Costs', 'rollups.json'), JSON.stringify({ schema: 1, throughDay: '2026-06-30', rows: [{ day: '2026-06-01', purpose: 'chat', providerID: 'x', model: 'm', usd: 1, calls: 3, unknownCalls: 0, inexactCalls: 0, freeCalls: 0, tokens: 30 }] }))
    const l = new CostLedger(join(root, 'costs.json'), { writeDelayMs: 0 })
    expect(l.summaryForCourse('q').usd).toBeCloseTo(0.2)
    expect(l.summaryForMonth('2026-06').calls).toBe(3)
    expect(existsSync(join(root, 'costs.json'))).toBe(true)
  })
  it('el día de una línea es el local en que se apuntó, también con cambio de hora', () => {
    const prev = process.env.TZ
    process.env.TZ = 'Europe/Madrid'
    try {
      expect(dayKey(new Date(2026, 9, 25, 0, 30).getTime())).toBe('2026-10-25')
      expect(dayKey(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25')
      expect(dayKey(new Date(2026, 9, 26, 0, 0).getTime())).toBe('2026-10-26')
      expect(dayKey(new Date(2026, 2, 29, 23, 59).getTime())).toBe('2026-03-29')
      let now = new Date(2026, 9, 25, 23, 10).getTime()
      const meter = meterWith(() => limit(1), () => now)
      meter.ledger.append(entry(1.5, '2026-10-25'))
      expect(meter.status().level).toBe('reached')
      expect(meter.status().resetsAt).toBe(new Date(2026, 9, 26, 0, 0).getTime())
      expect(() => meter.begin(deepseek)).toThrow(BudgetError)
      now = new Date(2026, 9, 26, 0, 1).getTime()
      expect(meter.status().level).toBe('ok')
      expect(() => meter.begin(deepseek).finish(emptyUsage())).not.toThrow()
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  })
})

describe('tope diario', () => {
  it('la puerta: aviso, corte a mitad, lo gratis sigue, precio desconocido y tope mal puesto', () => {
    let settings = limit(1)
    const meter = meterWith(() => settings)
    expect(meter.status().level).toBe('ok')
    meter.ledger.append(entry(0.85, dayKey(Date.now())))
    expect(meter.status().level).toBe('warning')
    const t = meter.begin(deepseek, undefined, { purpose: 'tutor', courseID: 'quimica' })
    expect(t.update(u(100_000, 10_000))).toBeUndefined()
    expect(meter.status().inFlight).toBeCloseTo(0.042, 9)
    const cut = t.update(u(300_000, 100_000))
    expect(cut).toBeInstanceOf(BudgetError)
    expect(cut!.midRun).toBe(true)
    const e = t.finish(u(300_000, 100_000), 'cut')
    expect(e).toMatchObject({ courseID: 'quimica', purpose: 'tutor', outcome: 'cut' })
    expect(meter.status().inFlight).toBe(0)
    expect(meter.status().level).toBe('reached')
    let err: unknown
    try {
      meter.begin(deepseek)
    } catch (x) {
      err = x
    }
    expect(err).toBeInstanceOf(BudgetError)
    expect((err as BudgetError).code).toBe('ai_budget')
    expect((err as BudgetError).message).toContain('tope')
    expect(() => meter.checkBudget()).toThrow(BudgetError)
    expect(() => meter.begin(claudeSub).finish(u(1000))).not.toThrow()
    expect(() => meter.begin(ollama).finish(u(1000))).not.toThrow()
    settings = limit(100)
    try {
      meter.begin(custom)
      throw new Error('debía fallar')
    } catch (x) {
      expect((x as BudgetError).reason).toEqual({ type: 'unknownPrice', model: 'secreto-1' })
    }
    settings = limit(100, { blockUnknownPrices: false })
    expect(meter.begin(custom).finish(u(5)).usd).toBeNull()
    settings = limit(-3)
    expect(meter.status().level).toBe('invalid')
    expect(() => meter.begin(deepseek)).toThrow(/no es un número válido/)
    expect(() => meter.begin(claudeSub).finish(emptyUsage())).not.toThrow()
    settings = limit(0)
    expect(() => meter.begin(deepseek)).toThrow(BudgetError)
    expect(() => meter.begin(ollama).finish(emptyUsage())).not.toThrow()
    expect(() => meter.checkBudget(claudeSub)).not.toThrow()
    expect(() => meter.checkBudget(deepseek)).toThrow(BudgetError)
  })
  it('se reserva lo que suele costar una llamada así', () => {
    const meter = meterWith(() => limit(1))
    const today = dayKey(Date.now())
    meter.ledger.append(entry(0.4, today, { purpose: 'course', exact: false }))
    meter.ledger.append(entry(0.4, today, { purpose: 'course', exact: false }))
    expect(() => meter.begin(deepseek, undefined, { purpose: 'course' })).toThrow(BudgetError)
    expect(() => meter.begin(deepseek, undefined, { purpose: 'chat' }).finish(emptyUsage())).not.toThrow()
  })
  it('las llamadas a la vez comparten el tope; cerrar dos veces no apunta dos veces', () => {
    const meter = meterWith(() => limit(1))
    const tickets = Array.from({ length: 6 }, () => meter.begin(deepseek, undefined, { purpose: 'course' }))
    for (const t of tickets) expect(t.update(u(300_000, 50_000))).toBeUndefined()
    expect(meter.status().inFlight).toBeCloseTo(0.9, 9)
    const seventh = meter.begin(deepseek, undefined, { purpose: 'chat' })
    expect(seventh.update(u(400_000))).toBeInstanceOf(BudgetError)
    for (const t of tickets) t.finish(u(300_000, 50_000))
    seventh.finish(u(400_000), 'cut')
    expect(meter.status().inFlight).toBe(0)
    expect(meter.ledger.summaryForDay(dayKey(Date.now())).usd).toBeCloseTo(1.02, 9)
    tickets[0].finish(u(1))
    expect(meter.ledger.summaryForDay(dayKey(Date.now())).calls).toBe(7)
  })
  it('la reserva se mantiene hasta el final y lo no gastado se devuelve', () => {
    const meter = meterWith(() => limit(1))
    meter.ledger.append(entry(0.4, dayKey(Date.now()), { purpose: 'course' }))
    const first = meter.begin(deepseek, undefined, { purpose: 'course' })
    expect(() => meter.begin(deepseek, undefined, { purpose: 'course' })).toThrow(BudgetError)
    expect(meter.status().inFlight).toBeCloseTo(0.4, 9)
    expect(first.update(u(1000))).toBeUndefined()
    expect(meter.status().inFlight).toBeCloseTo(0.4, 9)
    const e = first.finish(u(10_000))
    expect(meter.status().inFlight).toBe(0)
    expect(meter.status().spent).toBeCloseTo(0.4 + (e.usd ?? 0), 9)
    expect(() => meter.begin(deepseek, undefined, { purpose: 'course' }).finish(emptyUsage(), 'cancelled')).not.toThrow()
  })
  it('lo denegado no apunta nada; una llamada de pago que falla sin uso cuenta 0 aproximado', () => {
    const meter = meterWith(() => limit(null, { userPrices: { 'fixture:fixture-paid': modelPrice(1, 1) } }))
    const paid: BillingProvider = { id: 'fixture', kind: 'openai-compatible', baseURL: 'https://offline.invalid/v1', model: 'fixture-paid' }
    const e = meter.begin(paid).finish(emptyUsage(), 'failed')
    expect(e).toMatchObject({ usd: 0, exact: false, outcome: 'failed' })
    const capped = meterWith(() => limit(0.01, { userPrices: { 'fixture:fixture-paid': modelPrice(1, 1) } }))
    capped.ledger.append(entry(0.02, dayKey(Date.now())))
    const before = capped.ledger.entries().length
    expect(() => capped.check(paid)).toThrow(BudgetError)
    expect(() => capped.begin(paid)).toThrow(BudgetError)
    expect(capped.ledger.entries().length).toBe(before)
  })
  it('ajustes de la app: 0 = sin tope; negativo = mal puesto; precios propios válidos', () => {
    expect(spendingFromAISettings({ dailyBudgetUSD: 0 }).dailyLimitUSD).toBeNull()
    expect(spendingFromAISettings({ dailyBudgetUSD: 2.5 }).dailyLimitUSD).toBe(2.5)
    expect(spendingFromAISettings({ dailyBudgetUSD: -1 }).dailyLimitUSD).toBe(-1)
    expect(spendingFromAISettings({ dailyBudgetUSD: Number.NaN }).dailyLimitUSD).toBe(-1)
    const s = spendingFromAISettings({ dailyBudgetUSD: 1, warnFraction: 7, blockUnknownPrices: false, userPrices: { mio: { input: 1, output: 2 }, malo: { input: Infinity, output: 1 } } })
    expect(Object.keys(s.userPrices)).toEqual(['mio'])
    expect(s.warnFraction).toBe(1)
    expect(s.blockUnknownPrices).toBe(false)
  })
  it('vista para la interfaz', () => {
    const meter = meterWith(() => limit(2))
    meter.ledger.append(entry(0.41, dayKey(Date.now()), { courseID: 'bio', purpose: 'tutor' }))
    const v = costsView(meter)
    expect(v.today.usd).toBeCloseTo(0.41)
    expect(v.limitUSD).toBe(2)
    expect(v.level).toBe('ok')
    expect(v.byPurpose.tutor.calls).toBe(1)
    expect(v.byCourse.bio.calls).toBe(1)
    expect(v.statusText).toContain('de')
    expect(statusText(meter.status())).toBe(v.statusText)
    expect(v.remainingUSD).toBeCloseTo(1.59)
  })
})

describe('modelo medido', () => {
  it('apunta cada llamada con su curso y su uso (tramo largo por llamada)', async () => {
    const meter = meterWith(() => limit(null))
    const inner = new MockChatModel([step({ text: 'ok', usage: u(150_000, 1_000) })])
    inner.model = 'claude-haiku-5-5'
    const model = meteredModel(inner, { id: 'anthropic', kind: 'anthropic', baseURL: 'https://api.anthropic.com' }, meter)
    const res = await withAIUse({ purpose: 'grading', courseID: 'bio' }, () => model.complete({ messages: [] }))
    expect(res.message.content).toEqual([{ type: 'text', text: 'ok' }])
    const e = meter.ledger.recent(1)[0]
    expect(e).toMatchObject({ purpose: 'grading', courseID: 'bio', providerID: 'anthropic', model: 'claude-haiku-5-5', outcome: 'ok' })
    expect(e.usd).toBeCloseTo(0.15 * 0.5 + 0.001 * 2.5, 9)
    expect(meteredModel(model, { id: 'x', kind: 'anthropic' }, meter)).toBe(model)
  })
  it('no empieza si no cabe; un fallo o una cancelación también se apuntan', async () => {
    const meter = meterWith(() => limit(0.001))
    meter.ledger.append(entry(0.01, dayKey(Date.now())))
    const inner = new MockChatModel([step({ text: 'no' })])
    const model = meteredModel(inner, { ...deepseek }, meter)
    await expect(model.complete({ messages: [] })).rejects.toMatchObject({ code: 'ai_budget' })
    expect(inner.callCount).toBe(0)
    const free = meterWith(() => limit(null))
    const failing = meteredModel(new MockChatModel([{ fail: new Error('caído') }]), { ...deepseek }, free)
    await expect(failing.complete({ messages: [] })).rejects.toThrow('caído')
    expect(free.ledger.recent(1)[0].outcome).toBe('failed')
    const hanging = meteredModel(new MockChatModel([{ hang: true }]), { ...deepseek }, free)
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 20)
    await expect(hanging.complete({ messages: [] }, { signal: ctl.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(free.ledger.recent(1)[0].outcome).toBe('cancelled')
  })
  it('un uso a mitad que pasa del tope corta la llamada', async () => {
    const meter = meterWith(() => limit(0.01, { userPrices: { 'fixture:fixture-paid': modelPrice(1, 1) } }))
    const inner = new MockChatModel([{ eventsThenFail: [{ type: 'text', text: 'BEFORE_CAP' }, { type: 'usage', usage: u(20_000) }], error: new Error('no debería llegar') }])
    // el modelo simulado no mira la señal entre eventos: la llamada falla igual y el error es el del tope
    const model = meteredModel(inner, { id: 'fixture', kind: 'openai-compatible', baseURL: 'https://offline.invalid/v1', model: 'fixture-paid' }, meter)
    inner.model = 'fixture-paid'
    let text = ''
    const err = await model.complete({ messages: [] }, { onDelta: (e) => e.type === 'text' && (text += e.text) }).catch((x) => x)
    expect(err).toBeInstanceOf(BudgetError)
    expect(err.midRun).toBe(true)
    expect(text).toBe('BEFORE_CAP')
    const charge = meter.ledger.entries()
    expect(charge).toHaveLength(1)
    expect(charge[0]).toMatchObject({ outcome: 'cut', promptTokens: 20_000 })
    expect(charge[0].usd).toBeCloseTo(0.02, 9)
  })
  it('agentes con bucle propio (CLI): se mide la tarea entera y se corta al pasarse', async () => {
    const meter = meterWith(() => limit(0.1))
    const cli = (steps: Usage[]): ChatModel => ({
      providerId: 'deepseek', providerName: 'DeepSeek', kind: 'openai-compatible', model: 'deepseek-flash',
      capabilities: { tools: true, vision: false, streaming: true, jsonMode: false, contextWindow: 100_000, reasoning: null },
      complete: async () => { throw new Error('no se usa') },
      runAgent: async (_task, opts) => {
        for (const s of steps) {
          if (opts.signal?.aborted) throw opts.signal.reason
          opts.onEvent?.({ type: 'usage', usage: s })
          await new Promise((r) => setTimeout(r, 1))
        }
        if (opts.signal?.aborted) throw opts.signal.reason
        return { text: 'hecho', steps: steps.length, usage: steps.at(-1) ?? emptyUsage(), stopReason: 'stop' }
      }
    })
    const task = { system: 's', messages: [], prompt: 'p', tools: [], maxSteps: 5, timeoutSec: 30 }
    const ok = meteredModel(cli([u(10_000, 1_000)]), deepseek, meter)
    await withAIUse({ purpose: 'course', courseID: 'historia', label: 'Crear el curso' }, () => ok.runAgent!(task, {}))
    const first = meter.ledger.recent(1)[0]
    expect(first).toMatchObject({ courseID: 'historia', purpose: 'course', label: 'Crear el curso', outcome: 'ok' })
    expect(first.usd).toBeCloseTo(0.0042, 9)
    const big = meteredModel(cli([u(100_000), u(400_000), u(900_000)]), deepseek, meter)
    const err = await big.runAgent!(task, {}).catch((x) => x)
    expect(err).toBeInstanceOf(BudgetError)
    expect(err.midRun).toBe(true)
    const cut = meter.ledger.recent(1)[0]
    expect(cut.outcome).toBe('cut')
    expect(cut.usd).toBeCloseTo(0.12, 9)
    await expect(ok.runAgent!(task, {})).rejects.toBeInstanceOf(BudgetError)
    expect(meter.ledger.recent(10)).toHaveLength(2)
  })
})
