// Reglas de repetición de los eventos propios: port de las partes de reglas de StudyEngineTests/CalendarSeriesTests.swift,
// RecurrenceUntilDayTests.swift y EngineReviewCalendarFixTests.swift (ENG-32 y el resumen legible).
import { describe, expect, it } from 'vitest'
import { makeInstant, pad, wallTime } from '@engine/calendar/time'
import { expandOccurrences } from './expander'
import { formatRRule, makeRecurrenceRule, parseRRule, readableRecurrence, recurrenceSummary, rulesEqual, weeklyRule } from './rrule'
import { decodeRule, encodeRule } from './codec'

const MADRID = 'Europe/Madrid'
const NEW_YORK = 'America/New_York'
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** «2026-10-14 10:00» en la zona. */
function at(s: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s)!
  return new Date(makeInstant(+m[1], +m[2], +m[3], +m[4], +m[5], 0, tz))
}
/** «2026-10-14 Wed 10:00» en la zona. */
function wall(d: Date, tz: string): string {
  const w = wallTime(d, tz)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)} ${WEEKDAY[w.weekday - 1]} ${pad(w.hour, 2)}:${pad(w.minute, 2)}`
}
/** «20241104T045959» en UTC. */
function utc(s: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s)!
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
}
function local(s: string, tz: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s)!
  return new Date(makeInstant(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], tz))
}

function expand(rule: string, start: string, tz: string, to: string, from?: string): string[] {
  const r = parseRRule(rule, tz)
  const s = at(start, tz)
  return expandOccurrences(s, r, tz, from ? at(from, tz) : s, at(to, tz)).map((d) => wall(d, tz))
}

describe('RRULE propio · leer y escribir', () => {
  it('enteros extremos se rechazan sin romper nada', () => {
    for (const raw of [`FREQ=MONTHLY;BYMONTHDAY=${-(2 ** 63)}`, `FREQ=MONTHLY;BYDAY=${-(2 ** 63)}MO`, `FREQ=MONTHLY;BYSETPOS=-9223372036854775808`,
      'FREQ=WEEKLY;INTERVAL=9223372036854775807', 'FREQ=DAILY;BYMONTH=13', 'FREQ=MONTHLY;BYMONTHDAY=0']) {
      expect(() => parseRRule(raw), raw).toThrow()
      expect(decodeRule(raw), raw).toBeUndefined()
    }
    const direct = makeRecurrenceRule({ frequency: 'WEEKLY', interval: Number.MAX_SAFE_INTEGER, byDay: [{ weekday: 2, ordinal: Number.MIN_SAFE_INTEGER }], byMonthDay: [Number.MIN_SAFE_INTEGER, -1, 31], bySetPos: [Number.MIN_SAFE_INTEGER, 1] })
    expect(direct.interval).toBe(10_000)
    expect(direct.byMonthDay).toEqual([-1, 31])
    expect(direct.bySetPos).toEqual([1])
    expect(direct.byDay).toEqual([])
    const mutated = { ...makeRecurrenceRule({ frequency: 'WEEKLY' }), interval: Number.MAX_SAFE_INTEGER }
    const start = at('2026-10-14 10:00', MADRID)
    expect(expandOccurrences(start, mutated, MADRID, start, new Date(start.getTime() + 86_400_000))).toEqual([])
  })

  it('leer y escribir RRULE', () => {
    const r = parseRRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261220T225959Z;WKST=MO', MADRID)
    expect(r.frequency).toBe('WEEKLY')
    expect(r.byDay.map((d) => d.weekday)).toEqual([2, 4])
    expect(formatRRule(r)).toBe('FREQ=WEEKLY;UNTIL=20261220T225959Z;BYDAY=MO,WE')
    expect(rulesEqual(parseRRule(formatRRule(r)), r)).toBe(true)
    expect(parseRRule('FREQ=MONTHLY;BYDAY=-1FR,2TU').byDay).toEqual([{ weekday: 6, ordinal: -1 }, { weekday: 3, ordinal: 2 }])
    // UNTIL sin zona: en la del evento; una fecha sola = hasta el final de ese día
    expect(wall(parseRRule('FREQ=DAILY;UNTIL=20261220', MADRID).until!, MADRID)).toBe('2026-12-20 Sun 23:59')
    for (const bad of ['BYDAY=MO', 'FREQ=HOURLY', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=WEEKLY;COUNT=3;UNTIL=20261220', 'FREQ=WEEKLY;BYDAY=2MO', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;UNTIL=mañana']) {
      expect(() => parseRRule(bad), bad).toThrow()
    }
    // se guarda como texto en el JSON del calendario
    expect(JSON.stringify(encodeRule(r))).toBe('"FREQ=WEEKLY;UNTIL=20261220T225959Z;BYDAY=MO,WE"')
    expect(rulesEqual(decodeRule(encodeRule(r)), r)).toBe(true)
    expect(recurrenceSummary(r, { language: 'es' }).startsWith('Cada semana')).toBe(true)
    expect(recurrenceSummary(r, { language: 'en' }).startsWith('Every week')).toBe(true)
  })

  it('resumen legible para las tarjetas', () => {
    const text = readableRecurrence(weeklyRule([2, 4], { until: at('2026-12-20 23:59', MADRID) }), { language: 'es', timeZone: MADRID })
    expect(text.startsWith('Cada semana')).toBe(true)
    expect(text).toContain('lunes')
    expect(text).toContain('miércoles')
    expect(text).toContain('hasta el')
    expect(readableRecurrence(makeRecurrenceRule({ frequency: 'DAILY' }), { language: 'es' })).toBe('Cada día, sin final')
    expect(readableRecurrence(makeRecurrenceRule({ frequency: 'MONTHLY', interval: 2, count: 3 }), { language: 'en' })).toBe('Every 2 months, 3 times')
  })
})

describe('RRULE propio · repeticiones', () => {
  it('las clases semanales conservan la hora de pared con el cambio de hora', () => {
    const got = expand('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261104T235959Z', '2026-09-14 10:00', MADRID, '2026-12-31 00:00')
    expect(got).toHaveLength(16)
    expect(got.every((s) => s.endsWith('10:00'))).toBe(true)
    expect(got[0]).toBe('2026-09-14 Mon 10:00')
    expect(got[got.length - 1]).toBe('2026-11-04 Wed 10:00')
    const r = parseRRule('FREQ=WEEKLY;BYDAY=MO', MADRID)
    const two = expandOccurrences(at('2026-10-19 10:00', MADRID), r, MADRID, at('2026-10-19 00:00', MADRID), at('2026-10-27 00:00', MADRID))
    expect(two.map((d) => wall(d, 'UTC'))).toEqual(['2026-10-19 Mon 08:00', '2026-10-26 Mon 09:00'])
    expect(expand('FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6', '2026-10-27 09:30', NEW_YORK, '2026-12-31 00:00'))
      .toEqual(['2026-10-27 Tue 09:30', '2026-10-29 Thu 09:30', '2026-11-03 Tue 09:30', '2026-11-05 Thu 09:30', '2026-11-10 Tue 09:30', '2026-11-12 Thu 09:30'])
  })

  it('horas que no existen y que se repiten', () => {
    const spring = expandOccurrences(at('2026-03-28 02:30', MADRID), makeRecurrenceRule({ frequency: 'DAILY', count: 3 }), MADRID, at('2026-03-28 00:00', MADRID), at('2026-04-01 00:00', MADRID))
    expect(spring.map((d) => wall(d, MADRID))).toEqual(['2026-03-28 Sat 02:30', '2026-03-29 Sun 03:30', '2026-03-30 Mon 02:30'])
    expect(wall(new Date(makeInstant(2026, 3, 29, 2, 30, 0, MADRID)), 'UTC')).toBe('2026-03-29 Sun 01:30')
    expect(wall(new Date(makeInstant(2026, 10, 25, 2, 30, 0, MADRID)), 'UTC')).toBe('2026-10-25 Sun 00:30')
  })

  it('mensuales, anuales y casos límite', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', '2026-10-30 18:00', MADRID, '2027-06-01 00:00')).toEqual(['2026-10-30 Fri 18:00', '2026-11-27 Fri 18:00', '2026-12-25 Fri 18:00'])
    expect(expand('FREQ=MONTHLY;BYDAY=2TU;COUNT=3', '2026-10-13 12:00', MADRID, '2027-06-01 00:00')).toEqual(['2026-10-13 Tue 12:00', '2026-11-10 Tue 12:00', '2026-12-08 Tue 12:00'])
    expect(expand('FREQ=MONTHLY;COUNT=4', '2026-10-31 09:00', MADRID, '2027-12-01 00:00')).toEqual(['2026-10-31 Sat 09:00', '2026-12-31 Thu 09:00', '2027-01-31 Sun 09:00', '2027-03-31 Wed 09:00'])
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', '2027-01-31 09:00', MADRID, '2027-12-01 00:00')).toEqual(['2027-01-31 Sun 09:00', '2027-02-28 Sun 09:00', '2027-03-31 Wed 09:00'])
    expect(expand('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3', '2026-10-30 17:00', MADRID, '2027-06-01 00:00')).toEqual(['2026-10-30 Fri 17:00', '2026-11-30 Mon 17:00', '2026-12-31 Thu 17:00'])
    expect(expand('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=2', '2028-02-29 08:00', MADRID, '2040-01-01 00:00')).toEqual(['2028-02-29 Tue 08:00', '2032-02-29 Sun 08:00'])
    expect(expand('FREQ=DAILY;INTERVAL=3;COUNT=3', '2026-12-30 08:00', MADRID, '2027-02-01 00:00')).toEqual(['2026-12-30 Wed 08:00', '2027-01-02 Sat 08:00', '2027-01-05 Tue 08:00'])
    expect(expand('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=3', '2026-10-16 15:00', MADRID, '2027-02-01 00:00')).toEqual(['2026-10-16 Fri 15:00', '2026-10-30 Fri 15:00', '2026-11-13 Fri 15:00'])
    // DTSTART siempre cuenta como la primera, aunque no cumpla la regla
    expect(expand('FREQ=WEEKLY;BYDAY=FR;COUNT=2', '2026-10-13 15:00', MADRID, '2027-01-01 00:00')).toEqual(['2026-10-13 Tue 15:00', '2026-10-16 Fri 15:00'])
    // una regla que nunca se cumple no cuelga
    const t0 = Date.now()
    expect(expand('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', '2026-01-01 00:00', MADRID, '2126-01-01 00:00')).toEqual(['2026-01-01 Thu 00:00'])
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('ventanas lejos del inicio: rápidas y exactas', () => {
    const t0 = Date.now()
    expect(expand('FREQ=DAILY', '2000-01-01 07:00', MADRID, '2026-10-27 00:00', '2026-10-24 00:00')).toEqual(['2026-10-24 Sat 07:00', '2026-10-25 Sun 07:00', '2026-10-26 Mon 07:00'])
    expect(expand('FREQ=WEEKLY;BYDAY=MO', '2001-01-01 10:00', MADRID, '2026-10-20 00:00', '2026-10-01 00:00')).toEqual(['2026-10-05 Mon 10:00', '2026-10-12 Mon 10:00', '2026-10-19 Mon 10:00'])
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=15', '1999-03-15 10:00', MADRID, '2026-11-30 00:00', '2026-10-01 00:00')).toEqual(['2026-10-15 Thu 10:00', '2026-11-15 Sun 10:00'])
    expect(Date.now() - t0).toBeLessThan(2000)
    // con COUNT se cuenta desde el principio
    expect(expand('FREQ=DAILY;COUNT=5', '2026-10-01 07:00', MADRID, '2026-12-01 00:00', '2026-10-04 00:00')).toEqual(['2026-10-04 Sun 07:00', '2026-10-05 Mon 07:00'])
  })

  it('YEARLY con BYMONTHDAY sin BYMONTH vale para todos los meses (ENG-32)', () => {
    const s = at('2026-01-15 10:00', MADRID)
    expect(expandOccurrences(s, parseRRule('FREQ=YEARLY;BYMONTHDAY=15', MADRID), MADRID, s, at('2026-04-30 00:00', MADRID))).toHaveLength(4)
    expect(expandOccurrences(s, parseRRule('FREQ=YEARLY', MADRID), MADRID, s, at('2027-04-30 00:00', MADRID))).toHaveLength(2)
  })
})

describe('RRULE propio · UNTIL de solo fecha (MJ-CAL-001)', () => {
  const until = (raw: string, tz: string) => parseRRule('FREQ=DAILY;UNTIL=' + raw, tz).until!

  it('incluye el final del día largo de Nueva York', () => {
    expect(until('20241103', NEW_YORK)).toEqual(utc('20241104T045959'))
  })
  it('se para al final del día corto de Nueva York', () => {
    expect(until('20240310', NEW_YORK)).toEqual(utc('20240311T035959'))
  })
  it('cambios de media hora: el final real del día', () => {
    expect(until('20240407', 'Australia/Lord_Howe')).toEqual(utc('20240407T132959'))
    expect(until('20241006', 'Australia/Lord_Howe')).toEqual(utc('20241006T125959'))
  })
  it('cambios europeos en la zona del evento', () => {
    expect(until('20240331', 'Europe/Berlin')).toEqual(utc('20240331T215959'))
    expect(until('20241027', 'Europe/Berlin')).toEqual(utc('20241027T225959'))
  })
  it('una repetición tardía del día largo se conserva', () => {
    const start = local('20241102T233000', NEW_YORK)
    const rule = parseRRule('FREQ=DAILY;UNTIL=20241103', NEW_YORK)
    expect(expandOccurrences(start, rule, NEW_YORK, start, local('20241105T120000', NEW_YORK))).toEqual([start, local('20241103T233000', NEW_YORK)])
  })
  it('el día corto no admite la del día siguiente', () => {
    const start = local('20240309T003000', NEW_YORK)
    const rule = parseRRule('FREQ=DAILY;UNTIL=20240310', NEW_YORK)
    expect(expandOccurrences(start, rule, NEW_YORK, start, local('20240312T120000', NEW_YORK))).toEqual([start, local('20240310T003000', NEW_YORK)])
  })
  it('un UNTIL con hora conserva su instante exacto', () => {
    expect(until('20241103T233000', NEW_YORK)).toEqual(utc('20241104T043000'))
    expect(until('20240310T003000', NEW_YORK)).toEqual(utc('20240310T053000'))
    expect(until('20241103T123456Z', 'Australia/Lord_Howe')).toEqual(utc('20241103T123456'))
  })
  it('fechas normales y todo el día: ida y vuelta estables', () => {
    const cases: [string, string, string][] = [['20240229', 'UTC', '20240229T235959'], ['20241231', 'Asia/Kolkata', '20241231T182959'], ['20241103', NEW_YORK, '20241104T045959']]
    for (const [raw, tz, expected] of cases) {
      const rule = parseRRule('FREQ=DAILY;UNTIL=' + raw, tz)
      if (tz !== NEW_YORK) expect(rule.until).toEqual(utc(expected))
      expect(formatRRule(rule, { allDay: true, timeZone: tz })).toBe('FREQ=DAILY;UNTIL=' + raw)
      expect(rulesEqual(decodeRule(encodeRule(rule)), rule)).toBe(true)
    }
  })
  it('UNTIL ilegible o junto a COUNT se rechaza', () => {
    expect(() => parseRRule('FREQ=DAILY;UNTIL=not-a-date', NEW_YORK)).toThrow()
    expect(() => parseRRule('FREQ=DAILY;COUNT=2;UNTIL=20241103', NEW_YORK)).toThrow()
  })
})
