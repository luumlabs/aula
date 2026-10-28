// Port de CanvasKitTests/ICSParserTests.swift (+ lo de StudyEvent de ModelsTests y RobustnessTests).
import { describe, expect, it } from 'vitest'
import { unfold, parseLine, unescapeText } from './lexer'
import { MAX_OCCURRENCES_PER_EVENT, parseICS, parseICSDuration, untitledEvent } from './parser'
import { chronological, clipped, type StudyEvent } from './studyEvent'
import { LCG, localText, utcDate } from './testSupport.testutil'

const NY = 'America/New_York'
const LA = 'America/Los_Angeles'
const now = utcDate('2024-10-15T12:00:00Z')

const parse = (ics: string | Uint8Array, timeZone = NY, at = now) => parseICS(ics, { now: at, timeZone })
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`
const event = (...lines: string[]) => 'BEGIN:VEVENT\r\n' + lines.join('\r\n') + '\r\nEND:VEVENT'
const utf8 = (s: string) => new TextEncoder().encode(s)

describe('ICS · Canvas', () => {
  it('tarea del feed de Canvas con el curso entre corchetes', () => {
    const ics = wrap(event(
      'UID:event-assignment-9001', 'DTSTAMP:20241001T120000Z', 'DTSTART:20241021T035900Z', 'DTEND:20241021T035900Z',
      'SUMMARY:Examen 2 [MATH112-12345]',
      'DESCRIPTION:Click on the link to view the assignment\\n\\nhttps://school.instructure.com/courses/123/assignments/9001',
      'URL;VALUE=URI:https://school.instructure.com/courses/123/assignments/9001', 'CLASS:PUBLIC', 'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT'))
    const events = parse(ics)
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.title).toBe('Examen 2')
    expect(e.course).toBe('MATH112')
    expect(e.start).toEqual(utcDate('2024-10-21T03:59:00Z'))
    expect(localText(e.start)).toBe('2024-10-20 23:59')
    expect(e.end).toBeNull()
    expect(e.allDay).toBe(false)
    expect(e.kind).toBe('exam')
    expect(e.isExam).toBe(true)
    expect(e.url).toBe('https://school.instructure.com/courses/123/assignments/9001')
    expect(e.id).toBe('event-assignment-9001')
    expect(e.source).toBe('ics')
    expect(e.descriptionText?.startsWith('Click on the link to view the assignment')).toBe(true)
  })

  it('las tareas y eventos de Canvas tienen su tipo', () => {
    const ics = wrap([
      event('UID:event-assignment-1', 'DTSTART:20241022T035900Z', 'SUMMARY:Chapter 3 Homework [MATH112-12345]'),
      event('UID:event-calendar-event-7', 'DTSTART:20241022T140000Z', 'DTEND:20241022T150000Z', 'SUMMARY:Office hours [MATH112-12345]', 'LOCATION:Room 204\\, Building C'),
      event('UID:event-assignment-2', 'DTSTART:20241023T035900Z', 'SUMMARY:Quiz 4 [MATH112-12345]'),
      event('UID:event-assignment-3', 'DTSTART:20241024T035900Z', 'SUMMARY:Midterm Review [MATH112-12345]'),
      event('UID:event-assignment-4', 'DTSTART:20241025T035900Z', 'SUMMARY:Reading [MATH112-12345]')
    ].join('\r\n'))
    const e = parse(ics)
    expect(e.map((x) => x.kind)).toEqual(['assignment', 'event', 'quiz', 'assignment', 'assignment'])
    expect(e.map((x) => x.isExam)).toEqual([false, false, true, false, false])
    expect(e[1].location).toBe('Room 204, Building C')
    expect(e.map((x) => x.course)).toEqual(Array(5).fill('MATH112'))
  })

  it('el corchete solo es un curso si lo parece', () => {
    const ics = wrap([
      event('UID:a', 'DTSTART:20241022T100000Z', 'SUMMARY:Cena [Mamá]'),
      event('UID:b', 'DTSTART:20241023T100000Z', 'SUMMARY:Reunión [BIO2010C-001]'),
      event('UID:event-assignment-9', 'DTSTART:20241024T100000Z', 'SUMMARY:Tarea [Trigonometría]')
    ].join('\r\n'))
    const e = parse(ics)
    expect(e[0].title).toBe('Cena [Mamá]'); expect(e[0].course).toBeNull()
    expect(e[1].title).toBe('Reunión'); expect(e[1].course).toBe('BIO2010C')
    expect(e[2].title).toBe('Tarea'); expect(e[2].course).toBe('Trigonometría')
  })

  it('variantes del código de curso', () => {
    const ics = wrap([
      event('UID:event-assignment-1', 'DTSTART:20241022T100000Z', 'SUMMARY:A [MATH 112-12345]'),
      event('UID:event-assignment-2', 'DTSTART:20241023T100000Z', 'SUMMARY:B [2024FA-MATH112-12345]'),
      event('UID:event-assignment-3', 'DTSTART:20241024T100000Z', 'SUMMARY:C [Fall 2024 Trigonometry]')
    ].join('\r\n'))
    const e = parse(ics)
    expect(e[0].course).toBe('MATH112')
    expect(e[1].course).toBe('MATH112')
    expect(e[2].course).toBe('Fall 2024 Trigonometry')
  })

  it('el curso sale de CATEGORIES si no hay corchete', () => {
    expect(parse(wrap(event('UID:x', 'DTSTART:20241110T140000Z', 'SUMMARY:Final Exam', 'CATEGORIES:CALC101,Blue category')))[0].course).toBe('CALC101')
  })
})

describe('ICS · todo el día', () => {
  it('medianoche local y fin exclusivo', () => {
    const e = parse(wrap(event('UID:d1', 'DTSTART;VALUE=DATE:20241024', 'DTEND;VALUE=DATE:20241025', 'SUMMARY:Homework 5')))[0]
    expect(e.allDay).toBe(true)
    expect(localText(e.start)).toBe('2024-10-24 00:00')
    expect(localText(e.end)).toBe('2024-10-25 00:00')
  })

  it('sin fin dura un día; varios días conservan el intervalo', () => {
    const one = parse(wrap(event('UID:d1', 'DTSTART;VALUE=DATE:20241024', 'SUMMARY:Un día')))[0]
    expect(localText(one.end)).toBe('2024-10-25 00:00')
    const multi = parse(wrap(event('UID:d2', 'DTSTART;VALUE=DATE:20241024', 'DTEND;VALUE=DATE:20241028', 'SUMMARY:Semana de exámenes')))[0]
    expect(localText(multi.end)).toBe('2024-10-28 00:00')
    expect(multi.allDay).toBe(true)
  })

  it('la misma fecha sea cual sea la zona del dispositivo', () => {
    const ics = wrap(event('UID:d1', 'DTSTART;VALUE=DATE:20241108', 'DTEND;VALUE=DATE:20241109', 'SUMMARY:Midterm Exam'))
    for (const zone of [LA, NY, 'UTC', 'Pacific/Auckland']) expect(localText(parse(ics, zone)[0].start, zone)).toBe('2024-11-08 00:00')
  })

  it('una fecha sin VALUE=DATE también es de todo el día', () => {
    expect(parse(wrap(event('UID:d1', 'DTSTART:20241024', 'SUMMARY:Sin parámetro')))[0].allDay).toBe(true)
  })
})

describe('ICS · zonas horarias', () => {
  it('UTC, flotante, TZID, desfase y forma extendida', () => {
    const ics = wrap([
      event('UID:u', 'DTSTART:20241101T120000Z', 'SUMMARY:UTC'),
      event('UID:f', 'DTSTART:20241101T120000', 'SUMMARY:Flotante'),
      event('UID:t', 'DTSTART;TZID=America/Chicago:20241101T120000', 'SUMMARY:Chicago'),
      event('UID:o', 'DTSTART:20241101T120000-0500', 'SUMMARY:Offset'),
      event('UID:x', 'DTSTART:2024-11-01T12:00:00+02:00', 'SUMMARY:Extendido')
    ].join('\r\n'))
    const byID = Object.fromEntries(parse(ics).map((e) => [e.id, e.start.toISOString()]))
    expect(byID.u).toBe('2024-11-01T12:00:00.000Z')
    expect(byID.f).toBe('2024-11-01T16:00:00.000Z')
    expect(byID.t).toBe('2024-11-01T17:00:00.000Z')
    expect(byID.o).toBe('2024-11-01T17:00:00.000Z')
    expect(byID.x).toBe('2024-11-01T10:00:00.000Z')
  })

  it('la hora flotante sigue a la zona indicada', () => {
    const ics = wrap(event('UID:f', 'DTSTART:20241101T090000', 'SUMMARY:Flotante'))
    expect(parse(ics, NY)[0].start).toEqual(utcDate('2024-11-01T13:00:00Z'))
    expect(parse(ics, LA)[0].start).toEqual(utcDate('2024-11-01T16:00:00Z'))
    expect(parse(ics, 'UTC')[0].start).toEqual(utcDate('2024-11-01T09:00:00Z'))
  })

  it('un TZID desconocido es hora flotante', () => {
    expect(parse(wrap(event('UID:m', 'DTSTART;TZID=Mars/Olympus_Mons:20241101T090000', 'SUMMARY:Marte')))[0].start).toEqual(utcDate('2024-11-01T13:00:00Z'))
  })

  it('TZID a través del cambio de hora', () => {
    const e = parse(wrap([
      event('UID:a', 'DTSTART;TZID=America/New_York:20241102T090000', 'SUMMARY:Antes'),
      event('UID:b', 'DTSTART;TZID=America/New_York:20241104T090000', 'SUMMARY:Después')
    ].join('\r\n')))
    expect(e[0].start).toEqual(utcDate('2024-11-02T13:00:00Z'))
    expect(e[1].start).toEqual(utcDate('2024-11-04T14:00:00Z'))
  })

  it('zonas de Windows, de Mozilla, entre comillas y descriptivas', () => {
    const ics = wrap([
      event('UID:w', 'DTSTART;TZID=Eastern Standard Time:20241105T090000', 'SUMMARY:Outlook'),
      event('UID:m', 'DTSTART;TZID=/mozilla.org/20070129_1/Europe/Berlin:20241105T090000', 'SUMMARY:Mozilla'),
      event('UID:q', 'DTSTART;TZID="America/Denver":20241105T090000', 'SUMMARY:Comillas'),
      event('UID:p', 'DTSTART;TZID="(UTC-05:00) Eastern Time (US & Canada)":20241105T090000', 'SUMMARY:Descriptivo'),
      event('UID:a', 'DTSTART;TZID=Argentina Standard Time:20241105T090000', 'SUMMARY:Buenos Aires')
    ].join('\r\n'))
    const byID = Object.fromEntries(parse(ics, 'UTC').map((e) => [e.id, e.start.toISOString()]))
    expect(byID.w).toBe('2024-11-05T14:00:00.000Z')
    expect(byID.m).toBe('2024-11-05T08:00:00.000Z')
    expect(byID.q).toBe('2024-11-05T16:00:00.000Z')
    expect(byID.p).toBe('2024-11-05T14:00:00.000Z')
    expect(byID.a).toBe('2024-11-05T12:00:00.000Z')
  })

  it('fin en otra zona y DURATION', () => {
    const e = parse(wrap(event('UID:z', 'DTSTART;TZID=America/New_York:20241105T090000', 'DTEND;TZID=America/Chicago:20241105T093000', 'SUMMARY:Zonas')))[0]
    expect(e.end).toEqual(utcDate('2024-11-05T15:30:00Z'))
    const d = parse(wrap(event('UID:d', 'DTSTART:20241105T140000Z', 'DURATION:PT1H30M', 'SUMMARY:Duración')))[0]
    expect(d.end).toEqual(utcDate('2024-11-05T15:30:00Z'))
  })

  it('duraciones', () => {
    expect(parseICSDuration('PT1H30M')).toBe(5400)
    expect(parseICSDuration('P1D')).toBe(86_400)
    expect(parseICSDuration('P1W')).toBe(604_800)
    expect(parseICSDuration('P1DT2H')).toBe(93_600)
    expect(parseICSDuration('-PT15M')).toBe(-900)
    expect(parseICSDuration('PT30S')).toBe(30)
    for (const bad of ['1H', 'PT', 'P1X', '']) expect(parseICSDuration(bad)).toBeNull()
  })

  it('un fin anterior al inicio se descarta', () => {
    expect(parse(wrap(event('UID:e', 'DTSTART:20241105T140000Z', 'DTEND:20241105T130000Z', 'SUMMARY:Fin antes')))[0].end).toBeNull()
  })
})

describe('ICS · texto', () => {
  it('líneas plegadas, escapes y multibyte', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fold1\r\nDTSTART:20241101T120000Z\r\n' +
      'SUMMARY:Quiz 3 on a very long title that gets folded across\r\n  several physical lines\r\n' +
      'DESCRIPTION:Line one\\nLine two\\, with comma\\; semicolon and back\\\\slash\r\n' +
      'LOCATION:Aula\\, Edificio Ñ\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    const e = parse(ics)[0]
    expect(e.title).toBe('Quiz 3 on a very long title that gets folded across several physical lines')
    expect(e.descriptionText).toBe('Line one\nLine two, with comma; semicolon and back\\slash')
    expect(e.location).toBe('Aula, Edificio Ñ')
  })

  it('plegado con tabulador y finales LF o CR', () => {
    expect(parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20241101T120000Z\nSUMMARY:Titulo\n\tcontinuado\nEND:VEVENT\nEND:VCALENDAR\n')[0].title).toBe('Titulocontinuado')
    expect(parse('BEGIN:VCALENDAR\rBEGIN:VEVENT\rUID:a\rDTSTART:20241101T120000Z\rSUMMARY:Solo CR\rEND:VEVENT\rEND:VCALENDAR\r')[0].title).toBe('Solo CR')
  })

  it('pliegue en medio de un carácter de varios bytes', () => {
    const head = utf8('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u\r\nDTSTART:20241101T120000Z\r\nSUMMARY:Examen de Matem')
    const tail = utf8('ticas\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
    const bytes = new Uint8Array([...head, 0xc3, ...utf8('\r\n '), 0xa1, ...tail])
    expect(unfold(bytes)).toHaveLength(7)
    expect(parse(bytes)[0].title).toBe('Examen de Matemáticas')
  })

  it('Windows-1252 y UTF-16', () => {
    const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:l1\r\nDTSTART:20241101T120000Z\r\nSUMMARY:Examen de Matemáticas\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    const latin = Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0)))
    expect(parse(latin)[0].title).toBe('Examen de Matemáticas')
    const u16 = new Uint8Array(2 + text.length * 2)
    u16[0] = 0xff; u16[1] = 0xfe
    for (let i = 0; i < text.length; i++) { u16[2 + 2 * i] = text.charCodeAt(i) & 0xff; u16[3 + 2 * i] = text.charCodeAt(i) >> 8 }
    expect(parse(u16)[0].title).toBe('Examen de Matemáticas')
    const be = new Uint8Array(u16.length)
    be[0] = 0xfe; be[1] = 0xff
    for (let i = 0; i < text.length; i++) { be[2 + 2 * i] = text.charCodeAt(i) >> 8; be[3 + 2 * i] = text.charCodeAt(i) & 0xff }
    expect(parse(be)[0].title).toBe('Examen de Matemáticas')
  })

  it('BOM, minúsculas y sin envoltorio VCALENDAR', () => {
    const e = parse('﻿begin:vevent\r\nuid:abc\r\ndtstart:20241101T120000Z\r\nsummary:Sin envoltorio\r\nend:vevent\r\n')
    expect(e).toHaveLength(1)
    expect(e[0].title).toBe('Sin envoltorio')
  })

  it('la descripción en HTML pasa a texto', () => {
    const ics = wrap(event('UID:h', 'DTSTART:20241105T140000Z', 'SUMMARY:Reunión',
      'DESCRIPTION:<p>Únete: <a href="https://zoom.us/j/123">https://zoom.us/j/123</a></p><ul><li>Trae calculadora</li></ul>'))
    expect(parse(ics)[0].descriptionText).toBe('Únete: https://zoom.us/j/123\n\n- Trae calculadora')
  })

  it('X-ALT-DESC si la descripción está vacía', () => {
    const ics = wrap(event('UID:h', 'DTSTART:20241105T140000Z', 'SUMMARY:Reunión', 'X-ALT-DESC;FMTTYPE=text/html:<html><body><p>Final exam, <b>chapters 1-9</b>.</p></body></html>'))
    expect(parse(ics)[0].descriptionText).toBe('Final exam, **chapters 1-9**.')
  })

  it('una descripción larga se recorta', () => {
    const d = parse(wrap(event('UID:l', 'DTSTART:20241105T140000Z', 'SUMMARY:Largo', `DESCRIPTION:${'palabra '.repeat(1000)}`)))[0].descriptionText ?? ''
    expect(Array.from(d).length).toBeLessThanOrEqual(2001)
    expect(d.endsWith('…')).toBe(true)
  })

  it('título vacío o en blanco', () => {
    expect(parse(wrap([event('UID:a', 'DTSTART:20241105T140000Z'), event('UID:b', 'DTSTART:20241106T140000Z', 'SUMMARY:   ')].join('\r\n'))).map((e) => e.title))
      .toEqual([untitledEvent(), untitledEvent()])
  })

  it('parámetros con dos puntos y punto y coma entre comillas', () => {
    const p = parseLine('DTSTART;TZID="Europe/Madrid;x:y";VALUE=DATE-TIME:20241101T090000')
    expect(p?.name).toBe('DTSTART')
    expect(p?.params.TZID).toBe('Europe/Madrid;x:y')
    expect(p?.params.VALUE).toBe('DATE-TIME')
    expect(p?.value).toBe('20241101T090000')
    expect(parseLine('esto no tiene dos puntos')).toBeNull()
    expect(parseLine(':sin nombre')).toBeNull()
    expect(parseLine('URL;VALUE=URI:https://x.com/a:b?c=d;e')?.value).toBe('https://x.com/a:b?c=d;e')
  })

  it('desescapar', () => {
    expect(unescapeText('a\\nb\\Nc\\,d\\;e\\\\f\\x')).toBe('a\nb\nc,d;e\\fx')
    expect(unescapeText('termina en barra\\')).toBe('termina en barra\\')
    expect(unescapeText('sin escapes')).toBe('sin escapes')
  })
})

describe('ICS · tareas, cancelados y errores', () => {
  it('VTODO usa DUE y es una entrega', () => {
    const e = parse(wrap('BEGIN:VTODO\r\nUID:t1\r\nDUE:20241103T235900Z\r\nDTSTART:20241101T100000Z\r\nSUMMARY:Read chapter 4\r\nEND:VTODO'))[0]
    expect(e.start).toEqual(utcDate('2024-11-03T23:59:00Z'))
    expect(e.end).toBeNull()
    expect(e.kind).toBe('assignment')
  })

  it('VTODO sin DUE usa DTSTART; sin fechas se omite', () => {
    const e = parse(wrap('BEGIN:VTODO\r\nUID:t1\r\nDTSTART:20241101T100000Z\r\nSUMMARY:Con inicio\r\nEND:VTODO\r\nBEGIN:VTODO\r\nUID:t2\r\nSUMMARY:Sin fechas\r\nEND:VTODO'))
    expect(e.map((x) => x.title)).toEqual(['Con inicio'])
  })

  it('los cancelados se omiten', () => {
    const ics = wrap([event('UID:a', 'DTSTART:20241101T090000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelado'), event('UID:b', 'DTSTART:20241101T100000Z', 'STATUS:TENTATIVE', 'SUMMARY:Tentativo')].join('\r\n'))
    expect(parse(ics).map((e) => e.title)).toEqual(['Tentativo'])
  })

  it('un evento defectuoso no rompe el resto', () => {
    const ics = wrap([
      event('UID:ok1', 'DTSTART:20241101T090000Z', 'SUMMARY:Bueno 1'),
      event('UID:bad1', 'DTSTART:garbage', 'SUMMARY:Fecha mala'),
      event('UID:bad2', 'SUMMARY:Sin fecha'),
      event('UID:bad3', 'DTSTART:20241399T090000Z', 'SUMMARY:Mes 13'),
      event('UID:bad4', 'DTSTART:20240230T090000Z', 'SUMMARY:30 de febrero'),
      event('UID:bad5', 'DTSTART:00000101T090000Z', 'SUMMARY:Año cero'),
      event('UID:bad6', 'DTSTART:20241101T256000Z', 'SUMMARY:Hora 25'),
      event('UID:ok2', 'DTSTART:20241102T090000Z', 'SUMMARY:Bueno 2')
    ].join('\r\n'))
    expect(parse(ics).map((e) => e.title)).toEqual(['Bueno 1', 'Bueno 2'])
  })

  it('VALARM no pisa los campos del evento', () => {
    const e = parse(wrap('BEGIN:VEVENT\r\nUID:al\r\nDTSTART:20241101T090000Z\r\nSUMMARY:Reunión\r\nDESCRIPTION:Descripción real\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Recordatorio\r\nSUMMARY:Alarma\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT'))[0]
    expect(e.title).toBe('Reunión')
    expect(e.descriptionText).toBe('Descripción real')
  })

  it('un archivo cortado conserva lo leído', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20241101T090000Z\r\nSUMMARY:Completo\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART:20241102T090000Z\r\nSUMMARY:Cortado'
    expect(parse(ics).map((e) => e.title)).toEqual(['Completo', 'Cortado'])
  })

  it('basura y entradas vacías', () => {
    expect(parse('')).toHaveLength(0)
    expect(parse('   \r\n\r\n')).toHaveLength(0)
    expect(parse('esto no es un calendario')).toHaveLength(0)
    expect(parse('<html><body>Inicia sesión</body></html>')).toHaveLength(0)
    expect(parse('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toHaveLength(0)
    expect(parse('\u0000'.repeat(1000) + 'BEGIN:VEVENT')).toHaveLength(0)
    const rng = new LCG(1)
    parse(Array.from({ length: 5000 }, () => String.fromCharCode(32 + rng.below(95))).join(''))
  })

  it('sin UID: un id generado estable', () => {
    const ics = wrap([event('DTSTART:20241101T090000Z', 'SUMMARY:Sin UID'), event('DTSTART:20241102T090000Z', 'SUMMARY:Sin UID')].join('\r\n'))
    const ids = parse(ics).map((e) => e.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0].startsWith('evento-')).toBe(true)
    expect(parse(ics).map((e) => e.id)).toEqual(ids)
  })

  it('UID repetidos reciben ids únicos', () => {
    const ids = parse(wrap([event('UID:dup', 'DTSTART:20241101T090000Z', 'SUMMARY:Uno'), event('UID:dup', 'DTSTART:20241102T090000Z', 'SUMMARY:Dos')].join('\r\n'))).map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe('dup')
  })

  it('ordenados por inicio', () => {
    const ics = wrap([event('UID:c', 'DTSTART:20241103T090000Z', 'SUMMARY:C'), event('UID:a', 'DTSTART:20241101T090000Z', 'SUMMARY:A'), event('UID:b', 'DTSTART:20241102T090000Z', 'SUMMARY:B')].join('\r\n'))
    expect(parse(ics).map((e) => e.title)).toEqual(['A', 'B', 'C'])
  })

  it('con los argumentos por defecto', () => {
    expect(parseICS(wrap(event('UID:d', 'DTSTART:20991101T090000Z', 'SUMMARY:Futuro lejano')))).toHaveLength(1)
  })

  it('un feed grande se lee rápido', () => {
    let body = ''
    for (let i = 0; i < 5000; i++) {
      body += `BEGIN:VEVENT\r\nUID:ev-${i}@x\r\nDTSTART:2024${String(1 + (i % 12)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T090000Z\r\nSUMMARY:Evento número ${i} [MATH112-12345]\r\nDESCRIPTION:Texto de la descripción ${i}\\nsegunda línea\r\nEND:VEVENT\r\n`
    }
    const t0 = Date.now()
    expect(parse('BEGIN:VCALENDAR\r\n' + body + 'END:VCALENDAR\r\n')).toHaveLength(5000)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

describe('StudyEvent', () => {
  const ev = (p: Partial<StudyEvent> & { id: string; title: string; start: Date }): StudyEvent => ({
    course: null, end: null, allDay: false, kind: 'event', isExam: false, url: null, descriptionText: null, location: null, source: 'ics', courseID: null, ...p
  })

  it('orden por fecha y, a igualdad, por título', () => {
    const a = ev({ id: 'a', title: 'B', start: new Date(1_700_000_000_000) })
    const b = ev({ id: 'b', title: 'A', start: a.start })
    const c = ev({ id: 'c', title: 'Z', start: new Date(a.start.getTime() - 1000) })
    expect(chronological(b, a)).toBeLessThan(0)
    expect(chronological(c, b)).toBeLessThan(0)
  })

  it('texto recortado', () => {
    expect(clipped(null)).toBeNull()
    expect(clipped('   \n ')).toBeNull()
    expect(clipped('  hola  ')).toBe('hola')
    const c = clipped('abc '.repeat(1000), 100)!
    expect(c.endsWith('…')).toBe(true)
    expect(Array.from(c).length).toBeLessThanOrEqual(101)
    expect(clipped('x'.repeat(500), 100)).not.toBe('')
  })
})

describe('ICS · entradas hostiles', () => {
  const validICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:America/New_York', 'BEGIN:VEVENT', 'UID:event-assignment-1', 'DTSTART:20241021T035900Z',
    'SUMMARY:Examen 2 [MATH112-12345]', 'DESCRIPTION:Click on the link\\nhttps://school.instructure.com/courses/1', 'END:VEVENT', 'BEGIN:VEVENT',
    'UID:abc@google.com', 'DTSTART;TZID=America/New_York:20241014T080000', 'DTEND;TZID=America/New_York:20241014T085000',
    'RRULE:FREQ=WEEKLY;UNTIL=20241130T045959Z;BYDAY=MO,WE,FR;INTERVAL=2', 'EXDATE;TZID=America/New_York:20241016T080000', 'SUMMARY:Trig class',
    'LOCATION:Room 204\\, Building C', 'END:VEVENT', 'BEGIN:VTODO', 'UID:t1', 'DUE;VALUE=DATE:20241103', 'SUMMARY:Read', 'END:VTODO', 'END:VCALENDAR', ''
  ].join('\r\n')

  const mutate = (text: string, rng: LCG, edits: number): Uint8Array => {
    const bytes = Array.from(utf8(text))
    for (let k = 0; k < edits && bytes.length; k++) {
      const i = rng.below(bytes.length)
      switch (rng.below(4)) {
        case 0: bytes[i] = rng.byte(); break
        case 1: bytes.splice(i, 1); break
        case 2: bytes.splice(i, 0, rng.byte()); break
        default: {
          const j = rng.below(bytes.length)
          bytes.splice(i, 0, ...bytes.slice(Math.min(i, j), Math.max(i, j)).slice(0, 200))
        }
      }
    }
    return Uint8Array.from(bytes)
  }

  it('un ICS mutado nunca falla ni se cuelga', () => {
    const rng = new LCG(42)
    const t0 = Date.now()
    for (let n = 0; n < 200; n++) {
      const text = new TextDecoder().decode(mutate(validICS, rng, rng.below(40) + 1))
      const events = parse(text)
      expect(events.length).toBeLessThanOrEqual(3 * MAX_OCCURRENCES_PER_EVENT + 50)
      for (const e of events) { expect(e.id).not.toBe(''); expect(e.title).not.toBe('') }
    }
    expect(Date.now() - t0).toBeLessThan(20_000)
  })

  it('bytes mutados', () => {
    const rng = new LCG(7)
    for (let n = 0; n < 200; n++) {
      const bytes = utf8(validICS)
      for (let k = 0; k < 30; k++) bytes[rng.below(bytes.length)] = rng.byte()
      parse(bytes, 'UTC')
    }
  })

  it('ruido imprimible con forma de ICS', () => {
    const rng = new LCG(99)
    const names = ['BEGIN', 'END', 'DTSTART', 'DTEND', 'SUMMARY', 'RRULE', 'EXDATE', 'UID', 'DUE', 'DURATION', 'RECURRENCE-ID', 'RDATE', 'STATUS']
    const values = ['VEVENT', 'VTODO', '20241021T035900Z', 'FREQ=DAILY;COUNT=500', 'FREQ=MONTHLY;BYDAY=-1FR;BYSETPOS=3', 'P1D', 'garbage', '', '20240230', ';;;', 'FREQ=WEEKLY;INTERVAL=99999999999999']
    for (let n = 0; n < 100; n++) {
      const lines = Array.from({ length: 50 }, () => {
        const name = names[rng.below(names.length)], v = values[rng.below(values.length)]
        return rng.below(5) === 0 ? `${name};TZID=Mars/Base;VALUE=DATE:${v}` : `${name}:${v}`
      })
      parse(lines.join('\r\n'), 'UTC', new Date())
    }
  })

  it('reglas hostiles acotadas', () => {
    const rules = ['FREQ=DAILY;INTERVAL=1000;COUNT=100000',
      'FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYMONTHDAY=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31;COUNT=100000',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYSETPOS=1,2,3,4,5,-1,-2', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;INTERVAL=1;UNTIL=99991231T235959Z',
      'FREQ=DAILY;UNTIL=00010101T000000Z', 'FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=2', 'FREQ=YEARLY;BYDAY=53MO;BYMONTH=2']
    const t0 = Date.now()
    for (const rule of rules) {
      const events = parse(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:h\r\nDTSTART:20240101T090000Z\r\nRRULE:${rule}\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`, 'UTC')
      expect(events.length, rule).toBeLessThanOrEqual(MAX_OCCURRENCES_PER_EVENT)
      expect(events.length, rule).toBeGreaterThanOrEqual(1)
    }
    expect(Date.now() - t0).toBeLessThan(15_000)
  })

  it('una recurrencia acotada enorme se para en el horizonte (SEC-18)', () => {
    const at = new Date(1_704_067_200_000)
    const t0 = Date.now()
    const events = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bomba\r\nDTSTART:20240101T090000Z\r\nRRULE:FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=999999999\r\nSUMMARY:Serie\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { now: at })
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(events.length).toBeGreaterThan(0)
    const horizon = Date.UTC(2057, 0, 1)
    expect(events.every((e) => e.start.getTime() < horizon)).toBe(true)
  })

  it('casi 10 MB de feed en un tiempo razonable', () => {
    const parts = ['BEGIN:VCALENDAR\r\nVERSION:2.0\r\n']
    let size = parts[0].length, i = 0
    while (size < 9_500_000) {
      const chunk = `BEGIN:VEVENT\r\nUID:ev-${i}@x\r\nDTSTART:20241101T090000Z\r\nDTEND:20241101T100000Z\r\nSUMMARY:Evento número ${i} [MATH112-12345]\r\nDESCRIPTION:Descripción larga que se pliega en varias líneas para parecerse a un feed real de Canvas con mucho texto de relleno.\r\nLOCATION:Aula 204\r\nEND:VEVENT\r\n`
      parts.push(chunk)
      size += chunk.length
      i++
    }
    parts.push('END:VCALENDAR\r\n')
    const t0 = Date.now()
    expect(parse(parts.join(''), 'UTC')).toHaveLength(i)
    expect(Date.now() - t0).toBeLessThan(20_000)
  }, 60_000)
})
