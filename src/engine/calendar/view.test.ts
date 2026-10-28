// Lo que cruza el IPC (vistas y validación de lo que manda la interfaz) y el formato de `calendar.json`.
import { describe, expect, it } from 'vitest'
import { fullEventID } from '@shared/calendar'
import { makeInstant } from '@engine/calendar/time'
import { calendarFileText, decodeCalendarFile, decodeEvent, encodeEvent } from './codec'
import { addOwnEvent, isTaskDoneIn, mergeCalendar, setTaskDone } from './core'
import { emptyCalendarFile, makeCalendarEvent } from './model'
import { weeklyRule } from './rrule'
import { draftFromInput, parseInstant, patchFromInput, toEventView } from './view'

const TZ = 'Europe/Madrid'
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(makeInstant(y, mo, d, h, mi, 0, TZ))
let n = 0
const opts = { timeZone: TZ, newID: () => `own:test${++n}`, now: () => at(2026, 10, 1, 12) }

describe('Vistas para la interfaz', () => {
  it('una repetición lleva el id de la serie y su clave (la interfaz los junta)', () => {
    const f = emptyCalendarFile()
    const series = addOwnEvent(f, { title: 'Cálculo', kind: 'lecture', start: at(2026, 10, 5, 10), end: at(2026, 10, 5, 11), recurrence: weeklyRule([2]), timeZone: TZ }, 'student', opts)
    const occ = mergeCalendar({ file: f, platform: [], courses: [], from: at(2026, 10, 1), to: at(2026, 10, 20), timeZone: TZ })
    expect(occ).toHaveLength(3)
    const v = toEventView(occ[1], { timeZone: TZ, language: 'es' })
    expect(v.id).toBe(series.id)
    expect(v.occurrenceKey).toBe('20261012T100000')
    expect(fullEventID(v)).toBe(occ[1].id)
    expect(v.start).toBe(at(2026, 10, 12, 10).toISOString())
    expect(v.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(v.recurrenceText).toBe('Cada semana: lunes')
    expect(v.editable).toBe(true)
    expect(v.isTask).toBe(false)
    expect(v.task).toBeUndefined()
  })

  it('las entregas son tareas y llevan si están hechas', () => {
    const f = emptyCalendarFile()
    const t = addOwnEvent(f, { title: 'Entrega', kind: 'assignment', start: at(2026, 10, 9, 23, 59) }, 'student', opts)
    expect(toEventView(t).task).toEqual({ done: false })
    expect(isTaskDoneIn(f, t.id, opts)).toBe(false)
    setTaskDone(f, t.id, true, at(2026, 10, 2), opts)
    expect(isTaskDoneIn(f, t.id, opts)).toBe(true)
    expect(toEventView(f.events[0]).task).toEqual({ done: true, completedAt: at(2026, 10, 2).toISOString() })
    // de una plataforma: aparte
    setTaskDone(f, 'platform:x:1', true, at(2026, 10, 2), opts)
    expect(isTaskDoneIn(f, 'platform:x:1', opts)).toBe(true)
  })

  it('lee y valida un borrador y un cambio de la interfaz', () => {
    const d = draftFromInput({ title: 'Clase', kind: 'lecture', start: '2026-10-05T08:00:00.000Z', end: '2026-10-05T09:00:00.000Z', recurrence: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=2026-12-20', timeZone: TZ, reminders: [10.7] }, TZ)
    expect(d.start).toEqual(new Date('2026-10-05T08:00:00.000Z'))
    expect(d.recurrence?.until?.toISOString()).toBe('2026-12-20T22:59:59.000Z')
    expect(d.reminders).toEqual([10])
    expect(() => draftFromInput({ title: 'x', start: 'mañana' })).toThrow(/Fecha/)
    expect(() => draftFromInput({ title: 'x', start: '2026-10-05', kind: 'fiesta' })).toThrow(/Tipo/)
    expect(() => draftFromInput({ title: 'x', start: '2026-10-05', recurrence: 'FREQ=SOMETIMES' })).toThrow(/repetición/)
    expect(() => draftFromInput(null)).toThrow()
    expect(draftFromInput({ title: 'x', start: '2026-10-05' }, TZ).start).toEqual(at(2026, 10, 5))
    const p = patchFromInput({ title: 'Nuevo', recurrence: 'none', clearEnd: true, location: '' }, TZ)
    expect(p).toEqual({ title: 'Nuevo', clearRecurrence: true, clearEnd: true, location: '' })
    expect(() => patchFromInput({ allDay: 'sí' })).toThrow()
    expect(parseInstant('2026-10-19 10:00', 'America/New_York')?.date.toISOString()).toBe('2026-10-19T14:00:00.000Z')
    expect(parseInstant('2026-02-30')).toBeNull()
  })
})

describe('calendar.json', () => {
  it('ida y vuelta sin campos vacíos y con las claves de Swift', () => {
    const e = makeCalendarEvent({ id: 'own:a', title: 'Cálculo', kind: 'lecture', start: at(2026, 10, 5, 10), end: at(2026, 10, 5, 11), recurrence: weeklyRule([2, 4]), timeZone: TZ, reminders: [15], task: { done: false, doneOccurrences: { '20261005T100000': at(2026, 10, 5, 12) } } })
    const json = encodeEvent(e)
    expect(Object.keys(json).sort()).toEqual(['allDay', 'end', 'id', 'kind', 'origin', 'recurrence', 'reminders', 'start', 'task', 'timeZone', 'title'])
    expect(json.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    expect(json.start).toBe('2026-10-05T08:00:00.000Z')
    const back = decodeEvent(JSON.parse(JSON.stringify(json)))!
    expect(back.title).toBe('Cálculo')
    expect(back.task?.doneOccurrences['20261005T100000']).toEqual(at(2026, 10, 5, 12))
    expect(encodeEvent(back)).toEqual(json)
  })

  it('lo que no se entiende vuelve tal cual; si se cambia, se escribe lo nuevo', () => {
    const raw = { id: 'own:a', title: 'Futura', kind: 'seminar', start: 'no es fecha', origin: 'satélite', recurrence: 'FREQ=HOURLY', timeZone: 'Marte/Base', color: 'blue', exceptions: ['x'] }
    const e = decodeEvent(raw)!
    expect(e.kind).toBe('event')
    expect(e.origin).toBe('own')
    expect(e.recurrence).toBeUndefined()
    expect(e.timeZone).toBeUndefined()
    expect(e.exceptions).toEqual([])
    const out = encodeEvent(e)
    for (const k of ['kind', 'start', 'origin', 'recurrence', 'timeZone', 'color', 'exceptions'] as const) expect(out[k]).toEqual(raw[k])
    e.kind = 'exam'
    expect(encodeEvent(e).kind).toBe('exam')
  })

  it('un archivo con basura conserva lo que se puede leer', () => {
    const f = decodeCalendarFile({ schema: 'x', events: [5, null, { id: 'own:b', title: 'B', start: '2026-10-05T08:00:00Z' }], links: { a: 'b', c: 3 }, completed: { t: '2026-10-05T08:00:00Z' } })
    expect(f.schema).toBe(1)
    expect(f.events.map((e) => e.id)).toEqual(['own:b'])
    expect(f.links).toEqual({})
    expect(f.completed.t).toEqual(new Date('2026-10-05T08:00:00Z'))
    expect(() => decodeCalendarFile([])).toThrow()
    expect(JSON.parse(calendarFileText(f)).schema).toBe(2)
  })
})
