// Importar un .ics como eventos propios: series con su regla (y sus excepciones), cada vez suelta cuando la regla no se
// puede guardar igual, y sin duplicar lo ya importado (mismo UID).
import { describe, expect, it } from 'vitest'
import { makeInstant } from '@engine/calendar/time'
import { mergeCalendar, updateOwnEvent } from './core'
import { emptyCalendarFile } from './model'
import { importedEventID, importICSInto } from './importICS'
import { parseICSSeries } from './ics/parser'

const TZ = 'Europe/Madrid'
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(makeInstant(y, mo, d, h, mi, 0, TZ))
const NOW = at(2026, 10, 1, 12)

function cal(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prueba//ES', ...events, 'END:VCALENDAR'].join('\r\n')
}

const CLASS = [
  'BEGIN:VEVENT', 'UID:clase-fisica@uni', 'SUMMARY:Clase de Física', 'LOCATION:Aula 2.14',
  'DTSTART;TZID=Europe/Madrid:20261005T100000', 'DTEND;TZID=Europe/Madrid:20261005T113000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261216T225959Z', 'EXDATE;TZID=Europe/Madrid:20261012T100000', 'END:VEVENT'
].join('\r\n')

const MOVED = [
  'BEGIN:VEVENT', 'UID:clase-fisica@uni', 'RECURRENCE-ID;TZID=Europe/Madrid:20261014T100000', 'SUMMARY:Clase de Física (aula 5)',
  'LOCATION:Aula 5', 'DTSTART;TZID=Europe/Madrid:20261014T120000', 'DTEND;TZID=Europe/Madrid:20261014T133000', 'END:VEVENT'
].join('\r\n')

const EXAM = [
  'BEGIN:VEVENT', 'UID:examen-quimica@uni', 'SUMMARY:Examen parcial de Química', 'DTSTART:20261110T080000Z', 'DTEND:20261110T100000Z',
  'DESCRIPTION:Temas 1 a 4', 'END:VEVENT'
].join('\r\n')

const HOLIDAY = ['BEGIN:VEVENT', 'UID:fiesta@uni', 'SUMMARY:Día del estudiante', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261121', 'END:VEVENT'].join('\r\n')

const TODO = ['BEGIN:VTODO', 'UID:tarea@uni', 'SUMMARY:Entregar la práctica 3', 'DUE:20261108T225900Z', 'STATUS:COMPLETED', 'END:VTODO'].join('\r\n')

describe('Leer un .ics como series', () => {
  it('una clase semanal es UNA serie con su regla, la fecha quitada y la repetición movida', () => {
    const series = parseICSSeries(cal(CLASS, MOVED), { now: NOW, timeZone: TZ })
    expect(series).toHaveLength(1)
    const s = series[0]
    expect(s.uid).toBe('clase-fisica@uni')
    expect(s.rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261216T225959Z')
    expect(s.zone).toBe(TZ)
    expect(s.excluded.map((d) => d.getTime())).toEqual([at(2026, 10, 12, 10).getTime()])
    expect(s.changed).toHaveLength(1)
    expect(s.changed[0].original.getTime()).toBe(at(2026, 10, 14, 10).getTime())
    expect(s.changed[0].event.start.getTime()).toBe(at(2026, 10, 14, 12).getTime())
    // las veces que quedan no incluyen ni la quitada ni la movida
    expect(s.occurrences.some((d) => d.getTime() === at(2026, 10, 12, 10).getTime())).toBe(false)
    expect(s.occurrences.some((d) => d.getTime() === at(2026, 10, 14, 10).getTime())).toBe(false)
  })

  it('una repetición cancelada se quita de su serie', () => {
    const cancelled = MOVED.replace('LOCATION:Aula 5', 'STATUS:CANCELLED')
    const [s] = parseICSSeries(cal(CLASS, cancelled), { now: NOW, timeZone: TZ })
    expect(s.changed).toHaveLength(0)
    expect(s.excluded.map((d) => d.getTime())).toContain(at(2026, 10, 14, 10).getTime())
  })
})

describe('Importar un .ics', () => {
  it('añade la serie con su regla, las excepciones y el cambio de una vez, y los sueltos', () => {
    const f = emptyCalendarFile()
    const r = importICSInto(f, cal(CLASS, MOVED, EXAM, HOLIDAY, TODO), { now: NOW, timeZone: TZ })
    expect(r.added).toHaveLength(4)
    expect(r.recurring).toBe(1)
    expect(r.skipped).toBe(0)
    const clase = f.events.find((e) => e.id === importedEventID('clase-fisica@uni'))!
    expect(clase.origin).toBe('own')
    expect(clase.kind).toBe('lecture')
    expect(clase.timeZone).toBe(TZ)
    expect(clase.recurrence?.frequency).toBe('WEEKLY')
    expect(clase.exceptions).toHaveLength(1)
    // el calendario muestra la semana del 12: el lunes quitado no está y el miércoles va a las 12 en el aula 5
    const week = mergeCalendar({ file: f, platform: [], courses: [], from: at(2026, 10, 12), to: at(2026, 10, 18, 23, 59), timeZone: TZ })
    const classes = week.filter((e) => e.seriesID === clase.id)
    expect(classes).toHaveLength(1)
    expect(classes[0].start.getTime()).toBe(at(2026, 10, 14, 12).getTime())
    expect(classes[0].location).toBe('Aula 5')
    expect(classes[0].title).toBe('Clase de Física (aula 5)')

    const exam = f.events.find((e) => e.id === importedEventID('examen-quimica@uni'))!
    expect(exam.kind).toBe('exam')
    expect(exam.notes).toBe('Temas 1 a 4')
    const holiday = f.events.find((e) => e.id === importedEventID('fiesta@uni'))!
    expect(holiday.allDay).toBe(true)
    const todo = f.events.find((e) => e.id === importedEventID('tarea@uni'))!
    expect(todo.task?.done).toBe(true)
  })

  it('volver a importar el mismo archivo no duplica nada (mismo UID), aunque se haya cambiado el evento', () => {
    const f = emptyCalendarFile()
    importICSInto(f, cal(CLASS, EXAM), { now: NOW, timeZone: TZ })
    updateOwnEvent(f, importedEventID('examen-quimica@uni'), { title: 'Parcial de Química (aula 3)' }, { timeZone: TZ, now: () => NOW })
    const again = importICSInto(f, cal(CLASS, EXAM, HOLIDAY), { now: NOW, timeZone: TZ })
    expect(again.added).toHaveLength(1)
    expect(again.skipped).toBe(2)
    expect(f.events).toHaveLength(3)
    expect(f.events.find((e) => e.id === importedEventID('examen-quimica@uni'))?.title).toBe('Parcial de Química (aula 3)')
  })

  it('una regla que Aula no puede guardar igual (con RDATE) se importa vez a vez', () => {
    const odd = [
      'BEGIN:VEVENT', 'UID:tutoria@uni', 'SUMMARY:Tutoría', 'DTSTART;TZID=Europe/Madrid:20261006T160000', 'DTEND;TZID=Europe/Madrid:20261006T170000',
      'RRULE:FREQ=WEEKLY;COUNT=3', 'RDATE;TZID=Europe/Madrid:20261009T160000', 'END:VEVENT'
    ].join('\r\n')
    const f = emptyCalendarFile()
    const r = importICSInto(f, cal(odd), { now: NOW, timeZone: TZ })
    expect(r.recurring).toBe(0)
    expect(r.added.map((e) => e.start.getTime())).toEqual([at(2026, 10, 6, 16), at(2026, 10, 9, 16), at(2026, 10, 13, 16), at(2026, 10, 20, 16)].map((d) => d.getTime()))
    expect(new Set(r.added.map((e) => e.id)).size).toBe(4)
    expect(r.added.every((e) => e.end && e.end.getTime() - e.start.getTime() === 3_600_000)).toBe(true)
    // y tampoco se duplican al volver a importarlo
    expect(importICSInto(f, cal(odd), { now: NOW, timeZone: TZ }).skipped).toBe(4)
  })

  it('un archivo sin eventos no añade nada', () => {
    const f = emptyCalendarFile()
    expect(importICSInto(f, cal(), { now: NOW, timeZone: TZ }).added).toHaveLength(0)
  })
})
