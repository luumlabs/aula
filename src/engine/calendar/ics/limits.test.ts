// Calendarios hostiles: series «cada día, 20 000 veces» desde 1980, miles de eventos, listas enormes de BYDAY o EXDATE. La
// lectura entera tiene topes (ICS_LIMITS) y, aunque la serie empiece hace décadas, solo se calculan las fechas de alrededor
// de hoy. Y lo calculado con ventana es exactamente lo mismo que expandir la serie entera y recortar.
import { describe, expect, it } from 'vitest'
import { importICSInto, MAX_IMPORTED_EVENTS } from '../importICS'
import { emptyCalendarFile } from '../model'
import { ICSLimitError, ICS_LIMITS } from './limits'
import { MAX_OCCURRENCES_PER_EVENT, parseICS, parseICSSeries } from './parser'
import { icsOccurrences, icsOccurrenceWindow, parseICSRule, type ICSOccurrenceArgs } from './recurrence'
import { LCG } from './testSupport.testutil'

const NOW = new Date('2026-10-26T00:00:00Z')
const DAY = 86_400_000
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`
const daily = (n: number) => wrap(Array.from({ length: n }, (_, i) => `BEGIN:VEVENT\r\nUID:x${i}\r\nDTSTART:19800101T100000Z\r\nRRULE:FREQ=DAILY;COUNT=20000\r\nSUMMARY:a\r\nEND:VEVENT\r\n`).join(''))

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof ICSLimitError ? err.code : `otro error: ${String(err)}`
  }
}

describe('ICS · topes de una lectura', () => {
  it('el feed del revisor (200 series diarias de 20 000 veces desde 1980) se lee enseguida y acotado', () => {
    const t0 = Date.now()
    const events = parseICS(new TextEncoder().encode(daily(200)), { now: NOW, timeZone: 'Europe/Madrid' })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(events).toHaveLength(200 * MAX_OCCURRENCES_PER_EVENT)
    // las de alrededor de hoy (desde 60 días atrás), no las de 1980
    const first = Math.min(...events.map((e) => e.start.getTime()))
    expect(first).toBeGreaterThanOrEqual(NOW.getTime() - 60 * DAY)
    expect(first).toBeLessThan(NOW.getTime() - 59 * DAY)
  })

  it('con cuatro veces más series, para enseguida con un error claro', () => {
    for (const read of [() => parseICS(daily(800), { now: NOW, timeZone: 'UTC' }), () => parseICSSeries(daily(800), { now: NOW, timeZone: 'UTC' })]) {
      const t0 = Date.now()
      expect(codeOf(read)).toBe('calendar_too_complex')
      expect(Date.now() - t0).toBeLessThan(1000)
    }
  })

  it('demasiados eventos: «calendar_too_large» (sin convertir el resto)', () => {
    const body = Array.from({ length: 30 }, (_, i) => `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART:20261101T090000Z\r\nSUMMARY:E\r\nEND:VEVENT\r\n`).join('')
    expect(parseICS(wrap(body), { now: NOW, timeZone: 'UTC', limits: { maxEvents: 30 } })).toHaveLength(30)
    expect(codeOf(() => parseICS(wrap(body), { now: NOW, timeZone: 'UTC', limits: { maxEvents: 29 } }))).toBe('calendar_too_large')
    expect(codeOf(() => parseICSSeries(wrap(body), { now: NOW, timeZone: 'UTC', limits: { maxEvents: 29 } }))).toBe('calendar_too_large')
    expect(ICS_LIMITS.maxEvents).toBeGreaterThanOrEqual(40_000) // un feed de Canvas de casi 10 MB cabe
  })

  it('reglas que no saltan (filtros, semanas desde el año 1, BYDAY o EXDATE enormes) también paran a tiempo', () => {
    const days = Array.from({ length: 742 }, (_, i) => `${(i % 106) - 53 || 1}${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][i % 7]}`).join(',')
    const exdates = Array.from({ length: 3000 }, (_, i) => `2026${String(1 + (i % 12)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T100000Z`).join(',')
    const feeds = [
      () => `DTSTART:19800101T100000Z\r\nRRULE:FREQ=DAILY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;COUNT=20000`,
      () => `DTSTART:00010101T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12`,
      () => `DTSTART:19000101T100000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=${days};COUNT=20000`,
      () => `DTSTART:19000101T100000Z\r\nRRULE:FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYDAY=${days};COUNT=20000`,
      () => `DTSTART:19800101T100000Z\r\nRRULE:FREQ=DAILY\r\nEXDATE:${exdates}`
    ]
    for (const lines of feeds) {
      const body = Array.from({ length: 300 }, (_, i) => `BEGIN:VEVENT\r\nUID:h${i}\r\n${lines()}\r\nSUMMARY:a\r\nEND:VEVENT\r\n`).join('')
      const t0 = Date.now()
      expect(codeOf(() => parseICS(wrap(body), { now: NOW, timeZone: 'Europe/Madrid' }))).toBe('calendar_too_complex')
      expect(Date.now() - t0).toBeLessThan(1000)
    }
  })

  it('importar el feed del revisor: rápido, con el tope de eventos y sin guardar reglas que costaría expandir en cada vista', () => {
    const f = emptyCalendarFile()
    const t0 = Date.now()
    const r = importICSInto(f, daily(300), { now: NOW, timeZone: 'Europe/Madrid' })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(r.added.length).toBeLessThanOrEqual(MAX_IMPORTED_EVENTS)
    // una serie de COUNT desde 1980 no se guarda como regla (el expansor la recorrería desde el principio en cada vista)
    expect(r.recurring).toBeLessThanOrEqual(3)
  })

  it('una serie normal se sigue importando con su regla', () => {
    const f = emptyCalendarFile()
    const body = 'BEGIN:VEVENT\r\nUID:clase\r\nDTSTART;TZID=Europe/Madrid:20260907T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T230000Z\r\nSUMMARY:Física\r\nEND:VEVENT\r\n'
    const r = importICSInto(f, wrap(body), { now: NOW, timeZone: 'Europe/Madrid' })
    expect(r.added).toHaveLength(1)
    expect(r.recurring).toBe(1)
  })
})

describe('ICS · ventana alrededor de hoy', () => {
  const ZONES = ['UTC', 'Europe/Madrid', 'America/New_York', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']
  const RULES = [
    'FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=DAILY;BYDAY=MO,TU,FR', 'FREQ=DAILY;BYMONTH=3,10', 'FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA;WKST=SU', 'FREQ=WEEKLY;BYDAY=TU,TH', 'FREQ=WEEKLY;BYDAY=MO,TH;BYMONTH=1,6', 'FREQ=MONTHLY;BYDAY=-1FR',
    'FREQ=MONTHLY;BYMONTHDAY=1,15,-1', 'FREQ=YEARLY', 'FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'FREQ=WEEKLY;BYDAY=MO,TU,WE;BYSETPOS=1,-1'
  ]

  /** Lo esperado: la serie entera (sin ventana) partida en `from`. */
  function expected(args: ICSOccurrenceArgs, from: number, keep: number) {
    const all = icsOccurrences({ ...args, from: undefined, keep: undefined })
    return { before: all.filter((d) => d < from).slice(-keep), inside: all.filter((d) => d >= from).slice(0, keep) }
  }

  it('da lo mismo que expandir la serie entera y recortar (reglas, zonas, COUNT, UNTIL y ventanas al azar)', () => {
    const rnd = new LCG(20261026)
    const pick = <T,>(list: T[]): T => list[rnd.below(list.length)]
    for (let i = 0; i < 400; i++) {
      const rule = parseICSRule(pick(RULES))!
      const startYear = 1995 + rnd.below(31)
      const start = { year: startYear, month: 1 + rnd.below(12), day: 1 + rnd.below(28) }
      const startMs = Date.UTC(start.year, start.month - 1, start.day)
      const kind = rnd.below(3)
      if (kind === 0) rule.count = 1 + rnd.below(3000)
      const until = kind === 1 ? startMs + rnd.below(40 * 365) * DAY : null
      const args: ICSOccurrenceArgs = {
        rule, start, time: { hour: rnd.below(24), minute: 30, second: 0 }, zone: pick(ZONES), until, horizon: NOW.getTime() + 800 * DAY
      }
      const from = NOW.getTime() - rnd.below(20 * 365) * DAY + rnd.below(DAY)
      const keep = 1 + rnd.below(250)
      const w = icsOccurrenceWindow({ ...args, from, keep })
      const want = expected(args, from, keep)
      const label = `${i}: ${JSON.stringify({ rule, start, zone: args.zone, until, from, keep })}`
      expect(w.inside, label).toEqual(want.inside)
      expect(w.before(), label).toEqual(want.before)
    }
  })

  it('el salto de las diarias y semanales sin filtros cuenta bien para COUNT (la última es la misma)', () => {
    for (const text of ['FREQ=DAILY;COUNT=17000', 'FREQ=DAILY;INTERVAL=2;COUNT=8000', 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4500', 'FREQ=WEEKLY;BYDAY=SA;COUNT=2400']) {
      const rule = parseICSRule(text)!
      const args: ICSOccurrenceArgs = { rule, start: { year: 1980, month: 1, day: 2 }, time: { hour: 10, minute: 0, second: 0 }, zone: 'Europe/Madrid', until: null, horizon: NOW.getTime() + 800 * DAY }
      const from = NOW.getTime() - 60 * DAY
      const w = icsOccurrenceWindow({ ...args, from, keep: 201 })
      const want = expected(args, from, 201)
      expect(w.inside, text).toEqual(want.inside)
      expect(w.before(), text).toEqual(want.before)
    }
  })

  it('parseICS con EXDATE y RDATE da lo mismo que antes (la serie entera, quitando, y el recorte de 200)', () => {
    const exdates = ['20260901T100000Z', '20261027T100000Z', '20261028T100000Z', '19900105T100000Z']
    for (const [rrule, extra] of [
      ['FREQ=DAILY;COUNT=20000', ''], ['FREQ=DAILY;UNTIL=20200101T000000Z', ''], ['FREQ=DAILY;COUNT=150', ''],
      ['FREQ=WEEKLY;BYDAY=MO,WE,FR', 'RDATE:20261029T150000Z,19850101T100000Z'], ['FREQ=DAILY;COUNT=17030', '']
    ] as const) {
      const body = `BEGIN:VEVENT\r\nUID:s\r\nDTSTART:19900101T100000Z\r\nRRULE:${rrule}\r\nEXDATE:${exdates.join(',')}\r\n${extra ? extra + '\r\n' : ''}SUMMARY:S\r\nEND:VEVENT\r\n`
      const got = parseICS(wrap(body), { now: NOW, timeZone: 'UTC' }).map((e) => e.start.getTime())
      // referencia: la serie entera, más RDATE, menos EXDATE, y el recorte de siempre
      const rule = parseICSRule(rrule)!
      const until = rule.until ? Date.UTC(2020, 0, 1) : null
      let all = icsOccurrences({ rule, start: { year: 1990, month: 1, day: 1 }, time: { hour: 10, minute: 0, second: 0 }, zone: 'UTC', until, horizon: NOW.getTime() + 800 * DAY })
      if (extra) all.push(Date.UTC(2026, 9, 29, 15), Date.UTC(1985, 0, 1, 10))
      const ex = new Set(exdates.map((t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), 10)))
      all = [...new Set(all.filter((d) => !ex.has(d)))].sort((a, b) => a - b)
      const windowStart = NOW.getTime() - 60 * DAY
      const recent = all.filter((d) => d >= windowStart)
      const want = all.length > MAX_OCCURRENCES_PER_EVENT ? (recent.length ? recent.slice(0, MAX_OCCURRENCES_PER_EVENT) : all.slice(-MAX_OCCURRENCES_PER_EVENT)) : all
      expect(got, rrule).toEqual(want)
    }
  })
})
