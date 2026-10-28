// Port de CanvasKitTests/ICSRecurrenceTests.swift. Los casos «RFC» son los ejemplos de la sección 3.8.5.3 del RFC 5545.
import { describe, expect, it } from 'vitest'
import { wallTime } from '@engine/calendar/time'
import { MAX_OCCURRENCES_PER_EVENT, parseICS } from './parser'
import { parseICSRule } from './recurrence'
import { utcDate } from './testSupport.testutil'

const NY = 'America/New_York'
const now = utcDate('2024-10-15T12:00:00Z')

/** «1997-09-02» (y « HH:mm» si no son las 9:00) en Nueva York. */
function local(d: Date): string {
  const w = wallTime(d, NY)
  const day = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`
  return w.hour === 9 && w.minute === 0 ? day : `${day} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
}

/** Fechas de una serie que empieza el 2-sep-1997 a las 9:00 (Nueva York) por defecto. */
function dates(rrule: string, opts: { start?: string; extra?: string[]; now?: Date } = {}): string[] {
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r\r\nDTSTART;TZID=America/New_York:${opts.start ?? '19970902T090000'}\r\nRRULE:${rrule}\r\n` +
    (opts.extra ?? []).map((l) => l + '\r\n').join('') + 'SUMMARY:Serie\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
  return parseICS(ics, { now: opts.now ?? utcDate('1997-09-01T00:00:00Z'), timeZone: NY }).map((e) => local(e.start))
}

describe('RRULE · ejemplos del RFC 5545', () => {
  it('diaria, 10 veces', () => {
    expect(dates('FREQ=DAILY;COUNT=10')).toEqual(['1997-09-02', '1997-09-03', '1997-09-04', '1997-09-05', '1997-09-06', '1997-09-07', '1997-09-08', '1997-09-09', '1997-09-10', '1997-09-11'])
  })
  it('cada dos días', () => {
    expect(dates('FREQ=DAILY;INTERVAL=2;COUNT=5')).toEqual(['1997-09-02', '1997-09-04', '1997-09-06', '1997-09-08', '1997-09-10'])
  })
  it('cada 10 días', () => {
    expect(dates('FREQ=DAILY;INTERVAL=10;COUNT=5')).toEqual(['1997-09-02', '1997-09-12', '1997-09-22', '1997-10-02', '1997-10-12'])
  })
  it('semanal, 10 veces', () => {
    expect(dates('FREQ=WEEKLY;COUNT=10')).toEqual(['1997-09-02', '1997-09-09', '1997-09-16', '1997-09-23', '1997-09-30', '1997-10-07', '1997-10-14', '1997-10-21', '1997-10-28', '1997-11-04'])
  })
  it('cada dos semanas', () => {
    expect(dates('FREQ=WEEKLY;INTERVAL=2;COUNT=5;WKST=SU')).toEqual(['1997-09-02', '1997-09-16', '1997-09-30', '1997-10-14', '1997-10-28'])
  })
  it('martes y jueves hasta una fecha', () => {
    const expected = ['1997-09-02', '1997-09-04', '1997-09-09', '1997-09-11', '1997-09-16', '1997-09-18', '1997-09-23', '1997-09-25', '1997-09-30', '1997-10-02']
    expect(dates('FREQ=WEEKLY;UNTIL=19971007T000000Z;WKST=SU;BYDAY=TU,TH')).toEqual(expected)
    expect(dates('FREQ=WEEKLY;COUNT=10;WKST=SU;BYDAY=TU,TH')).toEqual(expected)
  })
  it('cada dos semanas L, X y V hasta el 24 de diciembre', () => {
    expect(dates('FREQ=WEEKLY;INTERVAL=2;UNTIL=19971224T000000Z;WKST=SU;BYDAY=MO,WE,FR', { start: '19970901T090000' })).toEqual([
      '1997-09-01', '1997-09-03', '1997-09-05', '1997-09-15', '1997-09-17', '1997-09-19', '1997-09-29', '1997-10-01', '1997-10-03', '1997-10-13', '1997-10-15',
      '1997-10-17', '1997-10-27', '1997-10-29', '1997-10-31', '1997-11-10', '1997-11-12', '1997-11-14', '1997-11-24', '1997-11-26', '1997-11-28', '1997-12-08',
      '1997-12-10', '1997-12-12', '1997-12-22'])
  })
  it('cada dos semanas martes y jueves, 8 veces', () => {
    expect(dates('FREQ=WEEKLY;INTERVAL=2;COUNT=8;WKST=SU;BYDAY=TU,TH')).toEqual(['1997-09-02', '1997-09-04', '1997-09-16', '1997-09-18', '1997-09-30', '1997-10-02', '1997-10-14', '1997-10-16'])
  })
  it('WKST cambia el resultado', () => {
    expect(dates('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO', { start: '19970805T090000' })).toEqual(['1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24'])
    expect(dates('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU', { start: '19970805T090000' })).toEqual(['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31'])
  })
  it('mensual, el primer viernes', () => {
    expect(dates('FREQ=MONTHLY;COUNT=10;BYDAY=1FR', { start: '19970905T090000' })).toEqual(['1997-09-05', '1997-10-03', '1997-11-07', '1997-12-05', '1998-01-02', '1998-02-06', '1998-03-06', '1998-04-03', '1998-05-01', '1998-06-05'])
    expect(dates('FREQ=MONTHLY;UNTIL=19971224T000000Z;BYDAY=1FR', { start: '19970905T090000' })).toEqual(['1997-09-05', '1997-10-03', '1997-11-07', '1997-12-05'])
  })
  it('cada dos meses, primer y último domingo', () => {
    expect(dates('FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=1SU,-1SU', { start: '19970907T090000' })).toEqual(['1997-09-07', '1997-09-28', '1997-11-02', '1997-11-30', '1998-01-04', '1998-01-25', '1998-03-01', '1998-03-29', '1998-05-03', '1998-05-31'])
  })
  it('el penúltimo lunes', () => {
    expect(dates('FREQ=MONTHLY;COUNT=6;BYDAY=-2MO', { start: '19970922T090000' })).toEqual(['1997-09-22', '1997-10-20', '1997-11-17', '1997-12-22', '1998-01-19', '1998-02-16'])
  })
  it('el antepenúltimo día del mes', () => {
    expect(dates('FREQ=MONTHLY;COUNT=6;BYMONTHDAY=-3', { start: '19970928T090000' })).toEqual(['1997-09-28', '1997-10-29', '1997-11-28', '1997-12-29', '1998-01-29', '1998-02-26'])
  })
  it('el penúltimo día del mes', () => {
    expect(dates('FREQ=MONTHLY;COUNT=6;BYMONTHDAY=-2', { start: '19970929T090000' })).toEqual(['1997-09-29', '1997-10-30', '1997-11-29', '1997-12-30', '1998-01-30', '1998-02-27'])
  })
  it('el 2 y el 15 de cada mes', () => {
    expect(dates('FREQ=MONTHLY;COUNT=10;BYMONTHDAY=2,15')).toEqual(['1997-09-02', '1997-09-15', '1997-10-02', '1997-10-15', '1997-11-02', '1997-11-15', '1997-12-02', '1997-12-15', '1998-01-02', '1998-01-15'])
  })
  it('el primero y el último de cada mes', () => {
    expect(dates('FREQ=MONTHLY;COUNT=10;BYMONTHDAY=1,-1', { start: '19970930T090000' })).toEqual(['1997-09-30', '1997-10-01', '1997-10-31', '1997-11-01', '1997-11-30', '1997-12-01', '1997-12-31', '1998-01-01', '1998-01-31', '1998-02-01'])
  })
  it('cada 18 meses, del 10 al 15', () => {
    expect(dates('FREQ=MONTHLY;INTERVAL=18;COUNT=10;BYMONTHDAY=10,11,12,13,14,15', { start: '19970910T090000' })).toEqual(['1997-09-10', '1997-09-11', '1997-09-12', '1997-09-13', '1997-09-14', '1997-09-15', '1999-03-10', '1999-03-11', '1999-03-12', '1999-03-13'])
  })
  it('todos los martes, cada dos meses', () => {
    expect(dates('FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=TU')).toEqual(['1997-09-02', '1997-09-09', '1997-09-16', '1997-09-23', '1997-09-30', '1997-11-04', '1997-11-11', '1997-11-18', '1997-11-25', '1998-01-06'])
  })
  it('anual en junio y julio', () => {
    expect(dates('FREQ=YEARLY;COUNT=10;BYMONTH=6,7', { start: '19970610T090000' })).toEqual(['1997-06-10', '1997-07-10', '1998-06-10', '1998-07-10', '1999-06-10', '1999-07-10', '2000-06-10', '2000-07-10', '2001-06-10', '2001-07-10'])
  })
  it('cada dos años en enero, febrero y marzo', () => {
    expect(dates('FREQ=YEARLY;INTERVAL=2;COUNT=10;BYMONTH=1,2,3', { start: '19970310T090000' })).toEqual(['1997-03-10', '1999-01-10', '1999-02-10', '1999-03-10', '2001-01-10', '2001-02-10', '2001-03-10', '2003-01-10', '2003-02-10', '2003-03-10'])
  })
  it('todos los jueves de marzo', () => {
    expect(dates('FREQ=YEARLY;COUNT=6;BYMONTH=3;BYDAY=TH', { start: '19970313T090000' })).toEqual(['1997-03-13', '1997-03-20', '1997-03-27', '1998-03-05', '1998-03-12', '1998-03-19'])
  })
  it('todos los jueves del verano', () => {
    expect(dates('FREQ=YEARLY;COUNT=6;BYDAY=TH;BYMONTH=6,7,8', { start: '19970605T090000' })).toEqual(['1997-06-05', '1997-06-12', '1997-06-19', '1997-06-26', '1997-07-03', '1997-07-10'])
  })
  it('viernes 13', () => {
    expect(dates('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=5', { start: '19980213T090000' })).toEqual(['1998-02-13', '1998-03-13', '1998-11-13', '1999-08-13', '2000-10-13'])
  })
  it('el primer sábado después del primer domingo', () => {
    expect(dates('FREQ=MONTHLY;COUNT=10;BYDAY=SA;BYMONTHDAY=7,8,9,10,11,12,13', { start: '19970913T090000' })).toEqual(['1997-09-13', '1997-10-11', '1997-11-08', '1997-12-13', '1998-01-10', '1998-02-07', '1998-03-07', '1998-04-11', '1998-05-09', '1998-06-13'])
  })
  it('el día de las elecciones', () => {
    expect(dates('FREQ=YEARLY;INTERVAL=4;COUNT=3;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8', { start: '19961105T090000' })).toEqual(['1996-11-05', '2000-11-07', '2004-11-02'])
  })
  it('BYSETPOS: el tercero de martes, miércoles y jueves', () => {
    expect(dates('FREQ=MONTHLY;COUNT=3;BYDAY=TU,WE,TH;BYSETPOS=3', { start: '19970904T090000' })).toEqual(['1997-09-04', '1997-10-07', '1997-11-06'])
  })
  it('BYSETPOS: el penúltimo día laborable', () => {
    expect(dates('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2;COUNT=4', { start: '19970929T090000' })).toEqual(['1997-09-29', '1997-10-30', '1997-11-27', '1997-12-30'])
  })
})

describe('RRULE · comportamiento propio', () => {
  it('la hora local se conserva al cambiar el horario', () => {
    const e = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:dst\r\nDTSTART;TZID=America/New_York:20241028T080000\r\nRRULE:FREQ=DAILY;COUNT=10\r\nSUMMARY:Clase\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now, timeZone: NY })
    expect(e).toHaveLength(10)
    for (const ev of e) expect(wallTime(ev.start, NY).hour).toBe(8)
    expect(e[0].start).toEqual(utcDate('2024-10-28T12:00:00Z'))
    expect(e[9].start).toEqual(utcDate('2024-11-06T13:00:00Z'))
  })

  it('cada ocurrencia conserva la duración', () => {
    const e = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART:20241014T120000Z\r\nDTEND:20241014T125000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Clase\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now, timeZone: NY })
    for (const ev of e) expect(ev.end!.getTime() - ev.start.getTime()).toBe(3_000_000)
  })

  it('ids de las ocurrencias únicos y estables', () => {
    const ids = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:serie@x\r\nDTSTART:20241014T120000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Clase\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now, timeZone: NY }).map((e) => e.id)
    expect(ids).toEqual(['serie@x#20241014T120000Z', 'serie@x#20241015T120000Z', 'serie@x#20241016T120000Z'])
  })

  it('EXDATE quita ocurrencias (también solo con la fecha)', () => {
    const rule = 'FREQ=DAILY;COUNT=5'
    expect(dates(rule, { extra: ['EXDATE;TZID=America/New_York:19970904T090000'] })).toEqual(['1997-09-02', '1997-09-03', '1997-09-05', '1997-09-06'])
    expect(dates(rule, { extra: ['EXDATE;VALUE=DATE:19970904,19970905'] })).toEqual(['1997-09-02', '1997-09-03', '1997-09-06'])
    expect(dates(rule, { extra: ['EXDATE:19970904T130000Z'] })).toEqual(['1997-09-02', '1997-09-03', '1997-09-05', '1997-09-06'])
    expect(dates(rule, { extra: ['EXDATE;TZID=America/New_York:19970903T090000', 'EXDATE;TZID=America/New_York:19970905T090000'] })).toEqual(['1997-09-02', '1997-09-04', '1997-09-06'])
  })

  it('EXDATE no reduce COUNT', () => {
    expect(dates('FREQ=DAILY;COUNT=3', { extra: ['EXDATE;TZID=America/New_York:19970903T090000'] })).toHaveLength(2)
  })

  it('RDATE añade ocurrencias', () => {
    expect(dates('FREQ=WEEKLY;COUNT=2', { extra: ['RDATE;TZID=America/New_York:19970905T090000'] })).toEqual(['1997-09-02', '1997-09-05', '1997-09-09'])
  })

  it('RDATE sin RRULE', () => {
    expect(parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r\r\nDTSTART:20241014T120000Z\r\nRDATE:20241020T120000Z,20241027T120000Z\r\nSUMMARY:Sesión\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now, timeZone: NY })).toHaveLength(3)
  })

  it('RECURRENCE-ID sustituye la ocurrencia original', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:s', 'DTSTART;TZID=America/New_York:20241014T080000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Clase', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:s', 'RECURRENCE-ID;TZID=America/New_York:20241015T080000', 'DTSTART;TZID=America/New_York:20241015T150000', 'SUMMARY:Clase movida', 'END:VEVENT', 'END:VCALENDAR'].join('\n')
    const e = parseICS(ics, { now, timeZone: NY })
    expect(e).toHaveLength(3)
    expect(e.map((x) => local(x.start))).toEqual(['2024-10-14 08:00', '2024-10-15 15:00', '2024-10-16 08:00'])
    expect(e.map((x) => x.title)).toEqual(['Clase', 'Clase movida', 'Clase'])
  })

  it('una instancia suelta sin serie también sale', () => {
    expect(parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:solo\r\nRECURRENCE-ID:20241015T120000Z\r\nDTSTART:20241015T150000Z\r\nSUMMARY:Instancia suelta\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now, timeZone: NY })).toHaveLength(1)
  })

  it('una serie acotada del pasado sale entera', () => {
    const far = utcDate('2030-01-01T00:00:00Z')
    expect(dates('FREQ=WEEKLY;COUNT=4', { start: '20240101T090000', now: far })).toHaveLength(4)
    expect(dates('FREQ=DAILY;UNTIL=20240110T000000Z', { start: '20240101T090000', now: far })).toHaveLength(9)
  })

  it('una serie sin fin de hace años sigue dando las próximas', () => {
    const list = dates('FREQ=DAILY', { start: '20200101T090000', now })
    expect(list.length).toBeLessThanOrEqual(MAX_OCCURRENCES_PER_EVENT)
    expect(list.length).toBeGreaterThan(0)
    expect(list[0] >= '2024-08-16').toBe(true)
    expect(list).toContain('2024-10-20')
  })

  it('una serie sin fin se para en el horizonte', () => {
    const list = dates('FREQ=WEEKLY', { start: '20241014T090000', now })
    expect(list.length).toBeLessThanOrEqual(200)
    expect(list[list.length - 1] <= '2026-12-31').toBe(true)
    expect(list[0]).toBe('2024-10-14')
    expect(list.length).toBeGreaterThan(100)
  })

  it('una serie acotada larga se queda en 200', () => {
    expect(dates('FREQ=DAILY;COUNT=1000', { start: '20241001T090000', now })).toHaveLength(200)
  })

  it('una serie futura empieza en DTSTART', () => {
    expect(dates('FREQ=MONTHLY;COUNT=3', { start: '20260115T090000', now })).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('mensual el 31: se salta los meses cortos', () => {
    expect(dates('FREQ=MONTHLY;COUNT=5', { start: '20240131T090000', now: utcDate('2024-01-01T00:00:00Z') })).toEqual(['2024-01-31', '2024-03-31', '2024-05-31', '2024-07-31', '2024-08-31'])
  })

  it('el 29 de febrero anual', () => {
    expect(dates('FREQ=YEARLY;COUNT=3', { start: '20240229T090000', now: utcDate('2024-01-01T00:00:00Z') })).toEqual(['2024-02-29', '2028-02-29', '2032-02-29'])
  })

  it('todo el día: sigue siendo de todo el día y de un día', () => {
    const e = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20241021\r\nDTEND;VALUE=DATE:20241022\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Entrega semanal\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now, timeZone: NY })
    expect(e).toHaveLength(3)
    expect(e.every((x) => x.allDay)).toBe(true)
    for (const ev of e) expect(wallTime(ev.end!, NY).epochDay - wallTime(ev.start, NY).epochDay).toBe(1)
    expect(e.map((x) => local(x.start))).toEqual(['2024-10-21 00:00', '2024-10-28 00:00', '2024-11-04 00:00'])
  })

  it('UNTIL con solo la fecha incluye ese día entero', () => {
    expect(dates('FREQ=DAILY;UNTIL=19970905', { start: '19970902T090000' })).toEqual(['1997-09-02', '1997-09-03', '1997-09-04', '1997-09-05'])
  })

  it('frecuencias no admitidas y reglas ilegibles: un solo evento', () => {
    expect(dates('FREQ=HOURLY;COUNT=5')).toHaveLength(1)
    expect(dates('FREQ=SECONDLY')).toHaveLength(1)
    expect(dates('esto no es una regla')).toHaveLength(1)
    expect(dates('FREQ=DAILY;COUNT=abc;INTERVAL=0').length > 1).toBe(true)
  })

  it('DTSTART que no cumple la regla es igualmente la primera', () => {
    expect(dates('FREQ=WEEKLY;COUNT=3;BYDAY=MO')).toEqual(['1997-09-02', '1997-09-08', '1997-09-15'])
  })

  it('lectura de la regla', () => {
    const r = parseICSRule('FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=1SU,-1SU,MO;BYMONTHDAY=1,-1,0,40;BYMONTH=1,13;BYSETPOS=-1;WKST=SU')
    expect(r?.freq).toBe('monthly')
    expect(r?.interval).toBe(2)
    expect(r?.count).toBe(10)
    expect(r?.byDay).toEqual([{ ordinal: 1, weekday: 7 }, { ordinal: -1, weekday: 7 }, { ordinal: null, weekday: 1 }])
    expect(r?.byMonthDay).toEqual([1, -1])
    expect(r?.byMonth).toEqual([1])
    expect(r?.bySetPos).toEqual([-1])
    expect(r?.weekStart).toBe(7)
    expect(parseICSRule('FREQ=MINUTELY')).toBeNull()
    expect(parseICSRule('COUNT=3')).toBeNull()
    expect(parseICSRule('freq=daily;interval=3')?.interval).toBe(3)
  })

  it('muchos eventos con regla siguen siendo rápidos', () => {
    let body = ''
    for (let i = 0; i < 300; i++) body += `BEGIN:VEVENT\r\nUID:r${i}\r\nDTSTART;TZID=America/New_York:20240901T090000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\r\nSUMMARY:Serie ${i}\r\nEND:VEVENT\r\n`
    const t0 = Date.now()
    const events = parseICS('BEGIN:VCALENDAR\r\n' + body + 'END:VCALENDAR\r\n', { now, timeZone: NY })
    expect(events.length).toBeGreaterThan(300)
    expect(Date.now() - t0).toBeLessThan(10_000)
  }, 30_000)
})
