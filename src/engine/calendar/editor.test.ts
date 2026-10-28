// El formulario de un evento: del evento a los campos y de vuelta al borrador o al cambio (solo lo que se tocó), con las
// repeticiones (cada día, cada semana en unos días, hasta una fecha) y los cambios de una sola vez en una serie.
import { describe, expect, it } from 'vitest'
import type { CalendarEventView, CalendarPatchInput } from '@shared/calendar'
import { makeInstant, wallTime } from '@engine/calendar/time'
import { addOwnEvent, mergeCalendar, updateOwnEventScoped } from './core'
import { emptyCalendarFile } from './model'
import {
  emptyEventForm, eventDraftFromForm, type EventForm, eventFormFromView, eventFormValues, eventPatchFromForms, moveFormStart, patchTouchesSeries, repeatFromRule, ruleFromForm
} from './editor'
import { draftFromInput, patchFromInput, toEventView } from './view'

const TZ = 'Europe/Madrid'
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(makeInstant(y, mo, d, h, mi, 0, TZ))
let n = 0
const opts = { timeZone: TZ, newID: () => `own:ed${++n}`, now: () => at(2026, 10, 1, 12) }

/** El cambio que sale de abrir el evento y tocar unos campos (la hora mueve también el fin). */
function patchFor(v: CalendarEventView, change: Partial<EventForm>): CalendarPatchInput {
  const f = eventFormFromView(v, TZ)
  const next = change.startTime || change.startDate ? moveFormStart(f, { startDate: change.startDate ?? f.startDate, startTime: change.startTime ?? f.startTime }, TZ) : f
  const p = eventPatchFromForms(f, { ...next, ...change }, TZ)
  if (typeof p === 'string') throw new Error(p)
  return p
}

function view(over: Partial<CalendarEventView> = {}): CalendarEventView {
  return {
    id: 'own:x', title: 'Repasar', kind: 'study', start: at(2026, 10, 26, 17).toISOString(), end: at(2026, 10, 26, 18, 30).toISOString(), allDay: false,
    origin: 'own', reminders: [], isTask: false, editable: true, ...over
  }
}

describe('Repeticiones en el formulario', () => {
  it('reconoce cada día, cada semana en unos días (lunes primero) y lo demás como regla propia', () => {
    expect(repeatFromRule(undefined, '2026-10-26', TZ)).toMatchObject({ repeat: 'none', weekdays: [1] })
    expect(repeatFromRule('FREQ=DAILY', '2026-10-26', TZ)).toMatchObject({ repeat: 'daily', until: '' })
    expect(repeatFromRule('FREQ=WEEKLY;BYDAY=WE,MO,SU', '2026-10-26', TZ)).toMatchObject({ repeat: 'weekly', weekdays: [1, 3, 7] })
    expect(repeatFromRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261216T225959Z', '2026-10-26', TZ)).toMatchObject({ repeat: 'weekly', until: '2026-12-16' })
    expect(repeatFromRule('FREQ=MONTHLY;BYDAY=2TU', '2026-10-26', TZ)).toMatchObject({ repeat: 'custom', customRule: 'FREQ=MONTHLY;BYDAY=2TU' })
    expect(repeatFromRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-10-26', TZ).repeat).toBe('custom')
  })

  it('escribe la regla (hasta = el último día entero) y el motor la entiende igual', () => {
    const base = { startDate: '2026-10-26', customRule: null, until: '' }
    expect(ruleFromForm({ ...base, repeat: 'none', weekdays: [1] })).toBeNull()
    expect(ruleFromForm({ ...base, repeat: 'daily', weekdays: [1], until: '2026-11-30' })).toBe('FREQ=DAILY;UNTIL=20261130')
    expect(ruleFromForm({ ...base, repeat: 'weekly', weekdays: [3, 1, 7] })).toBe('FREQ=WEEKLY;BYDAY=MO,WE,SU')
    expect(ruleFromForm({ ...base, repeat: 'weekly', weekdays: [] })).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(ruleFromForm({ ...base, repeat: 'custom', weekdays: [1], customRule: 'FREQ=YEARLY' })).toBe('FREQ=YEARLY')
    // ida y vuelta por el formato del IPC: el último día cuenta entero
    const d = draftFromInput({ title: 'Clase', start: at(2026, 10, 26, 10).toISOString(), recurrence: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130' }, TZ)
    const f = emptyCalendarFile()
    const ev = addOwnEvent(f, { ...d, timeZone: TZ }, 'student', opts)
    const all = mergeCalendar({ file: f, platform: [], courses: [], from: at(2026, 10, 1), to: at(2026, 12, 31), timeZone: TZ }).filter((e) => e.seriesID === ev.id)
    expect(all.map((e) => wallTime(e.start, TZ).day)).toEqual([26, 2, 9, 16, 23, 30])
  })
})

describe('Del evento al formulario y de vuelta', () => {
  it('abrir y guardar sin tocar nada no cambia nada', () => {
    for (const v of [
      view(),
      view({ end: null }),
      view({ allDay: true, start: at(2026, 11, 20).toISOString(), end: at(2026, 11, 21).toISOString() }),
      view({ allDay: true, start: at(2026, 11, 20).toISOString(), end: at(2026, 11, 23).toISOString() }),
      view({ kind: 'assignment', isTask: true, end: null }),
      view({ recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261216T225959Z', occurrenceKey: '20261026T170000' }),
      view({ recurrence: 'FREQ=MONTHLY;BYMONTHDAY=1' }),
      view({ packID: 'curso-1', location: 'Biblioteca', notes: 'Temas 3 y 4' })
    ]) {
      const f = eventFormFromView(v, TZ)
      expect(eventPatchFromForms(f, { ...f }, TZ)).toEqual({})
    }
  })

  it('un evento de varios días de todo el día enseña su último día (el fin es exclusivo)', () => {
    const f = eventFormFromView(view({ allDay: true, start: at(2026, 11, 20).toISOString(), end: at(2026, 11, 23).toISOString() }), TZ)
    expect(f).toMatchObject({ allDay: true, startDate: '2026-11-20', endDate: '2026-11-22', hasEnd: true })
  })

  it('el cambio lleva solo lo tocado: título, quitar el fin, el curso y dejar de repetirse', () => {
    const initial = eventFormFromView(view({ packID: 'curso-1', recurrence: 'FREQ=DAILY' }), TZ)
    const p = eventPatchFromForms(initial, { ...initial, title: 'Repasar con Ana', hasEnd: false, packID: null, repeat: 'none' }, TZ)
    expect(p).toEqual({ title: 'Repasar con Ana', clearEnd: true, clearPack: true, clearRecurrence: true })
    expect(patchTouchesSeries(p as CalendarPatchInput)).toBe(true)
    expect(patchTouchesSeries({ title: 'x', start: at(2026, 10, 27, 9).toISOString() })).toBe(false)
  })

  it('mover el inicio arrastra el fin y el día de «cada semana»', () => {
    const f = { ...eventFormFromView(view({ recurrence: 'FREQ=WEEKLY;BYDAY=MO' }), TZ) }
    const moved = moveFormStart(f, { startDate: '2026-10-28', startTime: '09:00' }, TZ)
    expect(moved).toMatchObject({ startDate: '2026-10-28', startTime: '09:00', endDate: '2026-10-28', endTime: '10:30', weekdays: [3] })
    const p = eventPatchFromForms(f, moved, TZ) as Record<string, unknown>
    expect(p.start).toBe(at(2026, 10, 28, 9).toISOString())
    expect(p.end).toBe(at(2026, 10, 28, 10, 30).toISOString())
    expect(p.recurrence).toBe('FREQ=WEEKLY;BYDAY=WE')
  })

  it('detecta los errores: sin nombre, fin antes del inicio, repetición que acaba antes de empezar', () => {
    const f = emptyEventForm(at(2026, 10, 26, 10), TZ)
    expect(eventFormValues(f, TZ)).toEqual({ error: 'title' })
    expect(eventFormValues({ ...f, title: 'x', endTime: '09:00' }, TZ)).toEqual({ error: 'endBeforeStart' })
    expect(eventFormValues({ ...f, title: 'x', repeat: 'daily', until: '2026-10-20' }, TZ)).toEqual({ error: 'untilBeforeStart' })
    expect(eventFormValues({ ...f, title: 'x', startDate: '2026-02-30' }, TZ)).toEqual({ error: 'date' })
    // el último día de la repetición puede ser el mismo del inicio
    expect('values' in eventFormValues({ ...f, title: 'x', repeat: 'daily', until: '2026-10-26' }, TZ)).toBe(true)
  })
})

describe('Borrador de un evento nuevo', () => {
  it('con hora, de todo el día y como tarea (las entregas no tienen fin)', () => {
    const f = { ...emptyEventForm(at(2026, 10, 26, 10), TZ), title: '  Tutoría  ', location: 'Despacho 3' }
    expect(eventDraftFromForm(f, TZ)).toEqual({
      title: 'Tutoría', kind: 'event', start: at(2026, 10, 26, 10).toISOString(), end: at(2026, 10, 26, 11).toISOString(), allDay: false, isTask: false, location: 'Despacho 3'
    })
    const day = { ...emptyEventForm(at(2026, 11, 20), TZ, { allDay: true }), title: 'Fiesta' }
    expect(eventDraftFromForm(day, TZ)).toMatchObject({ allDay: true, start: at(2026, 11, 20).toISOString() })
    expect(eventDraftFromForm(day, TZ)).not.toHaveProperty('end')
    expect(eventDraftFromForm({ ...day, hasEnd: true, endDate: '2026-11-22' }, TZ)).toMatchObject({ end: at(2026, 11, 23).toISOString() })
    const due = { ...emptyEventForm(at(2026, 10, 30, 23, 59), TZ, { kind: 'assignment' }), title: 'Práctica 3' }
    expect(eventDraftFromForm(due, TZ)).toMatchObject({ kind: 'assignment', isTask: true })
    expect(eventDraftFromForm(due, TZ)).not.toHaveProperty('end')
  })

  it('«cada semana» empieza el primer día elegido desde la fecha puesta', () => {
    // lunes 26, pero la clase es martes y jueves: la primera es el martes 27
    const f = { ...emptyEventForm(at(2026, 10, 26, 10), TZ), title: 'Química', repeat: 'weekly' as const, weekdays: [2, 4] }
    const d = eventDraftFromForm(f, TZ)
    expect(d).toMatchObject({ start: at(2026, 10, 27, 10).toISOString(), end: at(2026, 10, 27, 11).toISOString(), recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH', timeZone: TZ })
  })
})

describe('Cambiar una repetición desde el formulario', () => {
  it('«solo esta vez» cambia la hora de un día y «toda la serie» el título de todas', () => {
    const file = emptyCalendarFile()
    const s = addOwnEvent(file, { title: 'Física', kind: 'lecture', start: at(2026, 10, 5, 10), end: at(2026, 10, 5, 11), recurrence: draftFromInput({ title: 'x', start: at(2026, 10, 5, 10).toISOString(), recurrence: 'FREQ=WEEKLY;BYDAY=MO' }, TZ).recurrence, timeZone: TZ }, 'student', opts)
    const occ = () => mergeCalendar({ file, platform: [], courses: [], from: at(2026, 10, 1), to: at(2026, 10, 31), timeZone: TZ }).filter((e) => e.seriesID === s.id)
    const third = toEventView(occ()[2], { timeZone: TZ })
    const p = patchFor(third, { startTime: '12:00' })
    expect(patchTouchesSeries(p)).toBe(false)
    updateOwnEventScoped(file, `${third.id}#${third.occurrenceKey}`, patchFromInput(p, TZ), 'thisOccurrence', opts)
    expect(occ().map((e) => wallTime(e.start, TZ).hour)).toEqual([10, 10, 12, 10])
    const second = toEventView(occ()[1], { timeZone: TZ })
    updateOwnEventScoped(file, `${second.id}#${second.occurrenceKey}`, patchFromInput(patchFor(second, { title: 'Física II' }), TZ), 'allOccurrences', opts)
    expect(occ().map((e) => e.title)).toEqual(['Física II', 'Física II', 'Física II', 'Física II'])
  })
})
