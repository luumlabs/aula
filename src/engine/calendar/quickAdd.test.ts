// «Añadir rápido»: port de CalendarTests.swift (testQuickAdd*), CalendarSeriesTests.swift (repeticiones) y
// EngineReviewCalendarFixTests.swift (ENG-22 y ENG-31).
import { describe, expect, it } from 'vitest'
import { makeInstant, pad, wallTime } from '@engine/calendar/time'
import { expandOccurrences } from './expander'
import { cleanTitle, detectCourse, detectKind, fold, parseQuickEvent, quickEventDraft } from './quickAdd'
import { quickSummary } from './view'

const TZ = 'Europe/Madrid'
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const at = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s)!
  return new Date(makeInstant(+m[1], +m[2], +m[3], +m[4], +m[5], 0, TZ))
}
const wall = (d: Date | undefined) => {
  if (!d) return 'nil'
  const w = wallTime(d, TZ)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)} ${WEEKDAY[w.weekday - 1]} ${pad(w.hour, 2)}:${pad(w.minute, 2)}`
}
/** (mes, día, hora, minuto) en Madrid. */
const comps = (d: Date) => { const w = wallTime(d, TZ); return [w.month, w.day, w.hour, w.minute] }
/** Lunes 12 de octubre de 2026, 15:00. */
const monday = at('2026-10-12 15:00')
const parse = (text: string, now = monday) => parseQuickEvent(text, { now, timeZone: TZ })

describe('Añadir rápido · español', () => {
  it('frases de siempre', () => {
    const a = parse('Prueba de inglés el lunes a las 10')!
    expect(a.title).toBe('Prueba de inglés'); expect(a.kind).toBe('exam'); expect(a.course).toBe('Inglés')
    expect(a.allDay).toBe(false); expect(a.hasDate).toBe(true)
    expect(comps(a.start)).toEqual([10, 19, 10, 0])
    const b = parse('entrega de la práctica mañana 23:59')!
    expect(b.kind).toBe('assignment'); expect(b.title).toBe('Entrega de la práctica'); expect(b.course).toBeUndefined()
    expect(comps(b.start)).toEqual([10, 13, 23, 59])
    expect(b.end).toBeUndefined()
    const c = parse('estudiar química hoy de 17 a 19')!
    expect(c.kind).toBe('study'); expect(c.title).toBe('Estudiar química')
    expect(comps(c.start)).toEqual([10, 12, 17, 0]); expect(comps(c.end!)).toEqual([10, 12, 19, 0])
    const d = parse('Parcial 2 de Física el 20/10 a las 8')!
    expect(d.title).toBe('Parcial 2 de Física'); expect(d.course).toBe('Física'); expect(comps(d.start)).toEqual([10, 20, 8, 0])
    const e = parse('examen final 15 de diciembre')!
    expect(e.allDay).toBe(true); expect(e.title).toBe('Examen final'); expect(comps(e.start)).toEqual([12, 15, 0, 0])
    const f = parse('Clase de laboratorio el jueves a las 9 de la mañana')!
    expect(f.kind).toBe('lecture'); expect(f.title).toBe('Clase de laboratorio'); expect(comps(f.start)).toEqual([10, 15, 9, 0])
    const g = parse('tutoría a las 5')!
    expect(comps(g.start)).toEqual([10, 12, 17, 0]); expect(g.hasDate).toBe(false)
    const h = parse('quiz de historia dentro de 3 días')!
    expect(h.kind).toBe('quiz'); expect(h.course).toBe('Historia'); expect(comps(h.start)).toEqual([10, 15, 0, 0])
    const i = parse('examen de matemáticas pasado mañana a las 12:30')!
    expect(comps(i.start)).toEqual([10, 14, 12, 30])
  })
})

describe('Añadir rápido · inglés y casos límite', () => {
  it('frases en inglés y entradas raras', () => {
    const a = parse('English test next Monday at 10am')!
    expect(a.title).toBe('English test'); expect(a.kind).toBe('exam'); expect(comps(a.start)).toEqual([10, 19, 10, 0])
    const b = parse('Physics midterm on November 3 at 2pm')!
    expect(b.title).toBe('Physics midterm'); expect(comps(b.start)).toEqual([11, 3, 14, 0])
    const c = parse('reunión de grupo')!
    expect(c.allDay).toBe(true); expect(c.hasDate).toBe(false); expect(c.kind).toBe('event')
    expect(parse('   ')).toBeNull()
    const d = parse('examen 1/10')!
    expect(comps(d.start).slice(0, 2)).toEqual([10, 1])
    expect(wallTime(d.start, TZ).year).toBe(2027)
  })

  it('la hora que ya pasó hoy, sin fecha: mañana', () => {
    const r = parse('tutoría a las 9:00')!
    expect(comps(r.start)).toEqual([10, 13, 9, 0])
  })

  it('otros idiomas: lo básico', () => {
    expect(comps(parse('Klausur morgen um 10 Uhr')!.start)).toEqual([10, 13, 10, 0])
    expect(comps(parse('Examen demain à 9h30')!.start)).toEqual([10, 13, 9, 30])
    expect(comps(parse('期末試験 明日 10時')!.start)).toEqual([10, 13, 10, 0])
  })
})

describe('Añadir rápido · repeticiones', () => {
  it('clases que se repiten', () => {
    const monday9 = at('2026-10-12 09:00')
    const r = parse('Cálculo L y X de 10 a 11 todo el cuatrimestre', monday9)!
    expect(r.title).toBe('Cálculo'); expect(r.kind).toBe('lecture')
    expect(r.recurrence?.frequency).toBe('WEEKLY'); expect(r.recurrence?.byDay.map((d) => d.weekday)).toEqual([2, 4])
    expect(wall(r.start)).toBe('2026-10-12 Mon 10:00')
    expect(r.end).toEqual(at('2026-10-12 11:00'))
    expect(wall(r.recurrence!.until)).toBe('2027-02-12 Fri 23:59')
    expect(quickEventDraft(r).recurrence).toBeDefined()
    expect(quickEventDraft(r).timeZone).toBe(TZ)

    const late = parse('Inglés todos los martes y jueves a las 9 hasta el 20 de diciembre', at('2026-10-13 10:00'))!
    expect(late.title).toBe('Inglés'); expect(late.recurrence?.byDay.map((d) => d.weekday)).toEqual([3, 5])
    expect(wall(late.start)).toBe('2026-10-15 Thu 09:00')
    expect(wall(late.recurrence!.until)).toBe('2026-12-20 Sun 23:59')

    const gym = parse('Gym every Monday and Wednesday at 7pm for 4 weeks', monday9)!
    expect(gym.title).toBe('Gym'); expect(gym.recurrence?.byDay.map((d) => d.weekday)).toEqual([2, 4]); expect(wall(gym.start)).toBe('2026-10-12 Mon 19:00')
    expect(parse('English test on Monday at 10am', monday9)?.recurrence).toBeUndefined()
    const daily = parse('Repasar tarjetas cada día a las 21', monday9)!
    expect(daily.recurrence?.frequency).toBe('DAILY'); expect(daily.kind).toBe('study')
    const once = parse('Prueba de inglés el lunes a las 10', monday9)!
    expect(once.recurrence).toBeUndefined(); expect(wall(once.start)).toBe('2026-10-19 Mon 10:00')
    const biweekly = parse('Tutoría cada dos semanas a las 16', monday9)!
    expect(biweekly.recurrence?.interval).toBe(2)
  })

  it('«L-V», «hasta el viernes», «hasta diciembre»; «diario» y «semanal» sueltos no repiten (ENG-22)', () => {
    const monday9 = at('2026-10-12 09:00')
    expect(parse('Clase de inglés L-V a las 9', monday9)!.recurrence?.byDay.map((d) => d.weekday)).toEqual([2, 3, 4, 5, 6])
    const gym = parse('Gimnasio cada día a las 7 hasta el viernes', monday9)!
    expect(gym.title).toBe('Gimnasio')
    expect(gym.recurrence?.frequency).toBe('DAILY')
    expect(wall(gym.recurrence?.until).slice(0, 10)).toBe('2026-10-16')
    expect(wall(gym.start).startsWith('2026-10-16')).toBe(false)
    expect(wall(parse('Tutoría todos los lunes a las 16 hasta diciembre', monday9)!.recurrence?.until).slice(0, 10)).toBe('2026-12-31')
    expect(parse('Leer el diario mañana a las 8', monday9)!.recurrence).toBeUndefined()
    expect(parse('Entregar informe semanal el viernes', monday9)!.recurrence).toBeUndefined()
    expect(parse('Repasar a diario a las 21', monday9)!.recurrence?.frequency).toBe('DAILY')
  })

  it('el final por fecha es el final de ese día aunque cambie la hora (ENG-31)', () => {
    const r = parse('Pastilla cada día a las 0:30 hasta el 28 de marzo', at('2027-03-20 09:00'))!
    const occ = expandOccurrences(r.start, r.recurrence!, TZ, r.start, at('2027-04-10 00:00')).map(wall)
    expect(occ[occ.length - 1].slice(0, 10)).toBe('2027-03-28')
  })
})

describe('Añadir rápido · piezas', () => {
  it('título, tipo y asignatura', () => {
    expect(cleanTitle('  Examen de   física el ')).toBe('Examen de física')
    expect(cleanTitle('quiz para el')).toBe('Quiz')
    expect(detectKind('control de lectura')).toBe('quiz')
    expect(detectKind('reunion')).toBe('event')
    expect(detectCourse('Entrega de la práctica 3')).toBeUndefined()
    expect(detectCourse('Parcial 2 de Física I')).toBe('Física I')
    expect(fold('Ñandú Ármándo')).toBe('nandu armando')
    expect(fold('Ñandú').length).toBe('Ñandú'.length)
  })

  it('la frase de vista previa', () => {
    const r = parse('Prueba de inglés el lunes a las 10')!
    const s = quickSummary(r, 'es')
    expect(s).toContain('Prueba de inglés')
    expect(s).toContain('Examen')
    expect(s).toContain('19 de octubre')
    expect(s).toContain('10:00')
    expect(quickSummary(parse('Cálculo L y X de 10 a 11', at('2026-10-12 09:00'))!, 'en')).toContain('Every week')
  })
})
