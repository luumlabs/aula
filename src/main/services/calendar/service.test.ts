// El calendario de Aula de principio a fin, con la biblioteca real en una carpeta temporal y plataformas simuladas.
// Port de StudyEngineTests/CalendarTests.swift, CalendarSeriesTests.swift, EngineReviewCalendarFixTests.swift y
// CalendarLinkedExamTests.swift (lo que no depende de las herramientas del chat de otro dominio).
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makePack, makeSkillRef, type ExamInfo } from '@shared/schema'
import {
  autoApprove, CALENDAR_TOOL_NAMES, isDone, isRecurring, isTask, makeCalendarEvent, makeRecurrenceRule, parseRRule, parseToolDate, weeklyRule, writeICS,
  expandOccurrences, mentionsFormat, type CalendarApprovalCard, type CalendarEvent, type CalendarEventPatch, type CampusEvent
} from '@engine/calendar'
import { addDays, makeInstant, pad, startOfDay, wallTime } from '@engine/calendar/time'
import { Library } from '../store/library'
import { ChangeContext } from '../store/history/context'
import { writeJSONFile } from '../store/jsonFile'
import { StudyCalendarService } from './service'
import type { PlatformEventSource } from './sources'
import { isPreparing, keepAsIs, preparationSnapshotOf } from './preparation'

const TZ = 'Europe/Madrid'
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

function tmpRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'aula-cal-'))
  roots.push(r)
  return r
}

/** «2026-10-14 10:00» en Madrid. */
function at(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s)!
  return new Date(makeInstant(+m[1], +m[2], +m[3], +m[4], +m[5], 0, TZ))
}
function wall(d: Date | undefined, tz = TZ): string {
  if (!d) return 'nil'
  const w = wallTime(d, tz)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)} ${WEEKDAY[w.weekday - 1]} ${pad(w.hour, 2)}:${pad(w.minute, 2)}`
}
const ymd = (d: Date) => { const w = wallTime(d, TZ); return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}` }

/** Plataforma falsa con un examen, un quiz, una entrega y una clase. */
class FakeCampus implements PlatformEventSource {
  static base = startOfDay(new Date(), TZ)
  static at(d: number, h: number): Date { return new Date(addDays(FakeCampus.base, d, TZ).getTime() + h * 3_600_000) }
  constructor(private readonly fail = false) {}
  isConfigured(): boolean { return true }
  async events(from: Date, to: Date): Promise<CampusEvent[]> {
    if (this.fail) throw new Error('sin conexión')
    const ev = (id: string, title: string, course: string, start: Date, kind: string, isExam: boolean, details?: string): CampusEvent =>
      ({ id, title, course, start, allDay: false, isExam, kind, platformID: 'moodle1', platformLabel: 'Moodle', ...(details ? { details } : {}) })
    return [
      ev('e1', 'Parcial 2', 'FIS101', FakeCampus.at(3, 10), 'exam', true, 'Temas 3 y 4. 90 minutos, sin calculadora.'),
      ev('e2', 'Cuestionario 4', 'FIS101', FakeCampus.at(8, 23), 'quiz', true),
      ev('e3', 'Entrega: práctica', 'QUI110', FakeCampus.at(5, 23), 'assignment', false),
      ev('e4', 'Clase de laboratorio', 'QUI110', FakeCampus.at(1, 9), 'event', false),
      ev('old', 'Examen 1', 'FIS101', FakeCampus.at(-20, 10), 'exam', true)
    ].filter((e) => e.start.getTime() >= from.getTime() && e.start.getTime() <= to.getTime())
  }
}
const fakeAt = (d: number, h: number) => FakeCampus.at(d, h)
const base = FakeCampus.base

function setup(opts: { campus?: PlatformEventSource | null; history?: boolean } = {}) {
  const root = tmpRoot()
  const lib = new Library(root, { recordsHistory: opts.history ?? true })
  const cal = new StudyCalendarService({ root, library: lib, platforms: opts.campus === undefined ? new FakeCampus() : opts.campus, timeZone: TZ })
  cal.invalidatePlatformCache()
  return { root, lib, cal }
}

function errorCode(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code ?? 'sin código'
  }
  return 'no lanzó'
}

describe('Calendario · eventos propios, plataformas y cursos (CalendarTests)', () => {
  it('los eventos propios se guardan junto a settings.json', () => {
    const { root, lib, cal } = setup()
    const start = fakeAt(2, 18)
    const ev = cal.add({ title: '  Prueba de inglés ', kind: 'exam', start, course: 'Inglés', notes: 'Unidad 5' }, 'ai')
    expect(ev.id.startsWith('own:')).toBe(true)
    expect(ev.title).toBe('Prueba de inglés')
    expect(ev.createdBy).toBe('ai')
    expect(existsSync(join(root, 'calendar.json'))).toBe(true)
    // otra instancia (otro proceso) lo ve
    const again = new StudyCalendarService({ root, library: lib, platforms: null, timeZone: TZ })
    expect(again.ownEvents().map((e) => e.title)).toEqual(['Prueba de inglés'])
    // mover el inicio arrastra el fin
    cal.update(ev.id, { end: new Date(start.getTime() + 3_600_000) })
    const moved = cal.update(ev.id, { title: 'Prueba oral de inglés', start: new Date(start.getTime() + 86_400_000) })
    expect(moved.title).toBe('Prueba oral de inglés')
    expect(moved.end).toEqual(new Date(start.getTime() + 86_400_000 + 3_600_000))
    expect(errorCode(() => cal.update(ev.id, { end: new Date(start.getTime() - 10_000) }))).toBe('invalid')
    cal.delete(ev.id)
    expect(cal.ownEvents()).toEqual([])
    expect(errorCode(() => cal.delete(ev.id))).toBe('not_found')
    expect(errorCode(() => cal.add({ title: ' ', start }))).toBe('invalid')
  })

  it('todo junto, con las plataformas de solo lectura', async () => {
    const { lib, cal } = setup()
    const store = lib.createPack(makePack({ id: '', title: 'Química General', subject: 'Química', exam: { title: 'Final de Química', date: fakeAt(12, 9).toISOString() } }))
    cal.add({ title: 'Repasar estequiometría', kind: 'study', start: fakeAt(4, 17), end: fakeAt(4, 18) })
    const snap = await cal.events(base, fakeAt(30, 0))
    expect(snap.platformError).toBeUndefined()
    expect(snap.events.map((e) => e.title)).toEqual(['Clase de laboratorio', 'Parcial 2', 'Repasar estequiometría', 'Entrega: práctica', 'Cuestionario 4', 'Final de Química'])
    const parcial = snap.events.find((e) => e.title === 'Parcial 2')!
    expect(parcial.kind).toBe('exam')
    expect(parcial.origin).toBe('platform')
    expect(parcial.platformID).toBe('moodle1')
    expect(parcial.platformLabel).toBe('Moodle')
    expect(parcial.id).toBe('platform:moodle1:e1')
    expect(parcial.notes).toBe('Temas 3 y 4. 90 minutos, sin calculadora.')
    expect(snap.events.find((e) => e.title === 'Clase de laboratorio')?.kind).toBe('lecture')
    expect(snap.events.find((e) => e.title === 'Entrega: práctica')?.kind).toBe('assignment')
    const final = snap.events.find((e) => e.origin === 'course')!
    expect(final.packID).toBe(store.id)
    expect(final.course).toBe('Química')
    try {
      cal.update(parcial.id, { title: 'x' })
      throw new Error('debía fallar')
    } catch (err) {
      expect((err as { code?: string }).code).toBe('read_only')
      expect((err as Error).message).toContain('«Parcial 2»')
    }
    expect(errorCode(() => cal.delete(parcial.id))).toBe('read_only')
    // cambiar la fecha del examen de un curso la cambia en el curso
    const moved = cal.update(final.id, { start: fakeAt(13, 9) })
    expect(moved.start).toEqual(fakeAt(13, 9))
    expect(store.loadPack().exam?.date).toBe(fakeAt(13, 9).toISOString())
    // próximos exámenes de todos los orígenes
    expect((await cal.upcomingExams(30)).map((e) => e.title)).toEqual(['Parcial 2', 'Cuestionario 4', 'Final de Química'])
    // buscar sin tildes ni mayúsculas
    expect((await cal.search('quimica')).map((e) => e.title)).toEqual(['Final de Química'])
    expect((await cal.search('fis101 parcial')).map((e) => e.title)).toEqual(['Parcial 2'])
    expect((await cal.event('platform:moodle1:e1'))?.title).toBe('Parcial 2')
  })

  it('el curso creado para un examen queda vinculado y no se repite', async () => {
    const { lib, cal } = setup()
    const store = lib.createPack(makePack({ id: '', title: 'Física · Parcial 2', subject: 'FIS101', exam: { title: 'Parcial 2', date: fakeAt(3, 10).toISOString() } }))
    cal.link('platform:moodle1:e1', store.id)
    expect(cal.packID('platform:moodle1:e1')).toBe(store.id)
    const evs = (await cal.events(base, fakeAt(10, 0))).events
    expect(evs.filter((e) => e.title === 'Parcial 2')).toHaveLength(1)
    expect(evs.find((e) => e.title === 'Parcial 2')?.packID).toBe(store.id)
    // sin vínculo explícito: mismo día y misma asignatura → se reconoce
    cal.link('platform:moodle1:e1', null)
    const guessed = (await cal.events(base, fakeAt(10, 0))).events
    expect(guessed.filter((e) => e.title === 'Parcial 2')).toHaveLength(1)
    expect(guessed.find((e) => e.title === 'Parcial 2')?.packID).toBe(store.id)
  })

  it('si falla la plataforma quedan los demás y la última copia', async () => {
    const { root, lib, cal } = setup()
    cal.add({ title: 'Tutoría', start: fakeAt(1, 12) })
    expect((await cal.events(base, fakeAt(10, 0))).events).toHaveLength(5)
    const offline = new StudyCalendarService({ root, library: lib, platforms: new FakeCampus(true), timeZone: TZ })
    const snap = await offline.events(base, fakeAt(10, 0), true)
    expect(snap.platformError).toBeDefined()
    expect(snap.events).toHaveLength(5)
    offline.invalidatePlatformCache()
    const nothing = await offline.events(base, fakeAt(10, 0), true)
    expect(nothing.events.map((e) => e.title)).toEqual(['Tutoría'])
    expect(nothing.platformError).toBeDefined()
  })

  it('un evento estropeado no se lleva a los demás', () => {
    const { cal } = setup()
    cal.add({ title: 'Bueno', start: new Date() })
    const text = readFileSync(cal.fileURL, 'utf8').replace('"events": [', '"events": [ {"id": 5, "start": "no es fecha"},')
    writeFileSync(cal.fileURL, text)
    expect(cal.ownEvents().filter((e) => e.title === 'Bueno')).toHaveLength(1)
  })

  it('fechas de la IA', () => {
    const d = parseToolDate('2026-10-19T10:00', 'America/New_York')
    expect(d?.allDay).toBe(false)
    expect(d?.date.toISOString()).toBe('2026-10-19T14:00:00.000Z')
    expect(parseToolDate('2026-10-19', 'America/New_York')?.allDay).toBe(true)
    expect(parseToolDate('2026-10-19T10:00:00Z')?.allDay).toBe(false)
    expect(parseToolDate('2026-10-19 10:00')).not.toBeNull()
    expect(parseToolDate('el lunes')).toBeNull()
  })

  it('herramientas: añadir, listar, cambiar y borrar', async () => {
    const { cal } = setup()
    const tools = cal.toolHandlers({ approve: autoApprove })
    expect(new Set(Object.keys(tools))).toEqual(new Set(CALENDAR_TOOL_NAMES))
    const day = addDays(new Date(), 6, TZ)
    const added = await tools.calendar_add({ title: 'Prueba de inglés', kind: 'exam', start: ymd(day) + 'T09:30', course: 'Inglés' })
    expect(added.isError, added.text).toBe(false)
    const id = (added.data.event as { id: string }).id
    const exams = await tools.calendar_upcoming_exams({ days: 10 })
    expect(exams.text.includes('Prueba de inglés') && exams.text.includes('Parcial 2'), exams.text).toBe(true)
    const upd = await tools.calendar_update({ id, start: ymd(day) + 'T11:00' })
    expect(upd.isError, upd.text).toBe(false)
    expect(upd.text).toContain('T11:00')
    expect((await tools.calendar_update({ id: 'platform:moodle1:e1', title: 'x' })).isError).toBe(true)
    expect((await tools.calendar_search({ query: 'ingles' })).text).toContain(id)
    expect((await tools.calendar_delete({ id })).isError).toBe(false)
    const list = await tools.calendar_list({ from: ymd(new Date()), to: ymd(day) })
    expect(list.text).not.toContain('Prueba de inglés')
    expect(list.text).toContain('Parcial 2')
    expect((await tools.calendar_update({ id: 'own:x' })).text).toContain('Nothing to change')
  })

  it('el adaptador del chat', async () => {
    const { cal } = setup()
    const a = cal.forAssistant()
    const ev = await a.addEvent({ title: 'Examen de inglés', start: fakeAt(6, 9), kind: 'exam' })
    expect(ev.source).toBe('aula')
    expect(ev.editable).toBe(true)
    const all = await a.events(base, fakeAt(10, 0))
    expect(all.some((e) => e.id === ev.id)).toBe(true)
    expect(all.find((e) => e.title === 'Clase de laboratorio')?.kind).toBe('class')
    expect(all.find((e) => e.title === 'Parcial 2')?.editable).toBe(false)
    await a.deleteEvent(ev.id)
    expect(cal.ownEvents()).toEqual([])
  })

  it('en preparación hasta que las lecciones están escritas', () => {
    const { lib } = setup()
    const store = lib.createPack(makePack({ id: '', title: 'Inglés · prueba', exam: { title: 'Prueba', date: fakeAt(5, 9).toISOString() } }))
    expect(isPreparing(store)).toBe(false)
    const runID = 'run-20261012-100000-aaa'
    const stages = { prepare: 'pending', gather: 'pending', plan: 'pending', author: 'pending', crossCutting: 'pending', verify: 'pending', polish: 'pending' }
    const st: Record<string, unknown> = { runID, request: { packID: store.id, title: 'Inglés', topics: 'Unidad 5: past simple', mode: { create: {} } }, stages, startedAt: new Date().toISOString(), cancelled: false }
    const save = (name: string, v: unknown) => writeJSONFile(join(store.runsDirectory, `${name}.json`), v)
    save(runID, st)
    expect(isPreparing(store)).toBe(true)
    save(`${runID}.findings`, { examTitle: 'Prueba de la unidad 5', covers: 'Past simple y vocabulario de viajes', format: '20 preguntas, 40 minutos' })
    const snap = preparationSnapshotOf(store, runID)!
    expect(snap.about).toBe('Past simple y vocabulario de viajes')
    expect(snap.examTitle).toBe('Prueba de la unidad 5')
    expect(snap.format).toBe('20 preguntas, 40 minutos')
    expect(snap.examDate).toEqual(fakeAt(5, 9))
    // pausada: sigue en preparación
    save(runID, { ...st, cancelled: true, finishedAt: new Date().toISOString() })
    expect(isPreparing(store)).toBe(true)
    // terminada: curso normal
    save(runID, { ...st, cancelled: false, finishedAt: new Date().toISOString(), stages: { ...stages, author: 'done' } })
    store.updatePack((p) => { p.skills = [makeSkillRef({ id: 's1', title: 'Past simple' })] })
    expect(isPreparing(store)).toBe(false)
    // detenida y el estudiante se queda con lo que hay
    save(runID, { ...st, stages: { ...stages, author: 'running' } })
    expect(isPreparing(store)).toBe(true)
    keepAsIs(store, runID)
    expect(isPreparing(store)).toBe(false)
  })

  it('el formato solo se pregunta si la plataforma no lo dice', () => {
    expect(mentionsFormat('Temas 3 y 4. 90 minutos, sin calculadora.')).toBe(true)
    expect(mentionsFormat('25 multiple choice questions, open book')).toBe(true)
    expect(mentionsFormat('Temas 3 y 4: identidades trigonométricas')).toBe(false)
    expect(mentionsFormat(null)).toBe(false)
  })
})

describe('Calendario · series, tareas, archivos de antes, historial y .ics (CalendarSeriesTests)', () => {
  const addClasses = (cal: StudyCalendarService) => cal.add({
    title: 'Cálculo', kind: 'lecture', start: at('2026-09-14 10:00'), end: at('2026-09-14 11:00'), location: 'Aula 3',
    recurrence: weeklyRule([2, 4], { until: at('2026-12-20 23:59') }), timeZone: 'Europe/Madrid'
  })
  const ofSeries = (list: CalendarEvent[], id: string) => list.filter((e) => e.seriesID === id)

  it('clases que se repiten', async () => {
    const { cal } = setup()
    const series = addClasses(cal)
    const october = ofSeries((await cal.events(at('2026-10-01 00:00'), at('2026-11-01 00:00'))).events, series.id)
    expect(october).toHaveLength(8)
    expect(october.every((e) => wall(e.start).endsWith('10:00') && e.end!.getTime() - e.start.getTime() === 3_600_000)).toBe(true)
    expect(october.every((e) => e.id.startsWith(series.id + '#') && isRecurring(e))).toBe(true)
    const first = october[0]
    expect((await cal.event(first.id))?.start).toEqual(first.start)
    expect(await cal.event(series.id + '#20261013T100000')).toBeNull()
    // solo esa vez: otra hora y otra aula
    const moved = cal.update(first.id, { start: at('2026-10-05 12:00'), location: 'Aula 7' }, 'thisOccurrence')
    expect(wall(moved.start)).toBe('2026-10-05 Mon 12:00')
    expect(moved.location).toBe('Aula 7')
    expect(moved.end).toEqual(at('2026-10-05 13:00'))
    // ese día no hay clase
    cal.delete(october[1].id, 'thisOccurrence')
    const after = ofSeries((await cal.events(at('2026-10-01 00:00'), at('2026-11-01 00:00'))).events, series.id)
    expect(after).toHaveLength(7)
    expect(after.find((e) => e.id === first.id)?.location).toBe('Aula 7')
    expect(after.some((e) => e.id === october[1].id)).toBe(false)
    // de aquí en adelante: otra aula (parte la serie en dos)
    const pivot = after.find((e) => wall(e.start).startsWith('2026-10-19'))!
    expect(cal.update(pivot.id, { location: 'Aula Magna' }, 'thisAndFollowing').location).toBe('Aula Magna')
    const all = (await cal.events(at('2026-09-01 00:00'), at('2027-01-01 00:00'))).events.filter((e) => e.title === 'Cálculo')
    expect(all).toHaveLength(27)
    expect(all.filter((e) => e.start < pivot.start).every((e) => e.location !== 'Aula Magna')).toBe(true)
    expect(all.filter((e) => e.start >= pivot.start).every((e) => e.location === 'Aula Magna')).toBe(true)
    expect(cal.ownEvents()).toHaveLength(2)
    // todas: una hora más tarde (desde una repetición se mueve toda la serie)
    const tailSeries = cal.ownEvents().find((e) => e.location === 'Aula Magna')!
    const anyTail = all[all.length - 1]
    cal.update(anyTail.id, { start: new Date(anyTail.start.getTime() + 3_600_000) }, 'allOccurrences')
    const shifted = ofSeries((await cal.events(at('2026-10-19 00:00'), at('2027-01-01 00:00'))).events, tailSeries.id)
    expect(shifted.every((e) => wall(e.start).endsWith('11:00')), shifted.map((e) => wall(e.start)).join(', ')).toBe(true)
    // y quitar de aquí en adelante
    cal.delete(shifted[2].id, 'thisAndFollowing')
    expect(ofSeries((await cal.events(at('2026-10-19 00:00'), at('2027-01-01 00:00'))).events, tailSeries.id)).toHaveLength(2)
  })

  it('partir una serie que cuenta veces conserva el total', async () => {
    const { cal } = setup()
    const e = cal.add({ title: 'Tutoría', kind: 'lecture', start: at('2026-11-02 16:00'), recurrence: makeRecurrenceRule({ frequency: 'WEEKLY', count: 6 }), timeZone: 'Europe/Madrid' })
    const list = (await cal.events(at('2026-11-01 00:00'), at('2027-01-01 00:00'))).events.filter((x) => x.title === 'Tutoría')
    expect(list).toHaveLength(6)
    cal.update(list[2].id, { title: 'Tutoría (online)' }, 'thisAndFollowing')
    const both = (await cal.events(at('2026-11-01 00:00'), at('2027-01-01 00:00'))).events.filter((x) => x.title.startsWith('Tutoría'))
    expect(both).toHaveLength(6)
    expect(both.filter((x) => x.title === 'Tutoría (online)')).toHaveLength(4)
    expect(cal.ownEvents().find((x) => x.id === e.id)?.recurrence?.count).toBe(2)
  })

  it('tareas, avisos y hechas', async () => {
    const { cal } = setup()
    const now = at('2026-10-13 09:00')
    const task = cal.add({ title: 'Entregar práctica 3', kind: 'assignment', start: at('2026-10-16 23:59'), reminders: [120, 1440, -5, 99_999_999] })
    expect(isTask(task)).toBe(true)
    expect(task.reminders).toEqual([120, 1440])
    let r = cal.pendingReminders(now, at('2026-10-20 00:00'))
    expect(r.map((x) => wall(x.fireAt))).toEqual(['2026-10-15 Thu 23:59', '2026-10-16 Fri 21:59'])
    expect(new Set(r.map((x) => x.id)).size).toBe(2)
    cal.setDone(task.id, true, now)
    expect(cal.pendingReminders(now, at('2026-10-20 00:00'))).toEqual([])
    expect((await cal.tasks(now, at('2026-10-20 00:00'))).some((e) => e.id === task.id)).toBe(false)
    expect((await cal.tasks(now, at('2026-10-20 00:00'), true)).find((e) => e.id === task.id) && isDone((await cal.tasks(now, at('2026-10-20 00:00'), true)).find((e) => e.id === task.id)!)).toBe(true)
    // una tarea que se repite: hecha día a día
    const weekly = cal.add({ title: 'Hoja de ejercicios', kind: 'assignment', start: at('2026-10-16 18:00'), recurrence: makeRecurrenceRule({ frequency: 'WEEKLY', count: 4 }), timeZone: 'Europe/Madrid', reminders: [60], isTask: true })
    const sheets = ofSeries(await cal.tasks(now, at('2026-12-01 00:00')), weekly.id)
    expect(sheets).toHaveLength(4)
    cal.setDone(sheets[0].id, true, now)
    expect(ofSeries(await cal.tasks(now, at('2026-12-01 00:00')), weekly.id)).toHaveLength(3)
    r = cal.pendingReminders(now, at('2026-12-01 00:00')).filter((x) => x.eventID.startsWith(weekly.id))
    expect(r).toHaveLength(3)
    // una entrega de la plataforma (solo lectura) también se puede marcar hecha
    const later = new Date(Date.now() + 30 * 86_400_000)
    const platform = (await cal.tasks(new Date(), later)).filter((e) => e.origin === 'platform')
    expect(platform.map((e) => e.title)).toEqual(['Entrega: práctica'])
    cal.setDone(platform[0].id, true)
    expect(isDone((await cal.tasks(new Date(), later, true)).find((e) => e.id === platform[0].id)!)).toBe(true)
    expect(cal.toggleDone(platform[0].id)).toBe(false)
    expect((await cal.tasks(new Date(), later)).filter((e) => e.origin === 'platform')).toHaveLength(1)
    expect(errorCode(() => cal.setDone('own:no-existe', true))).toBe('not_found')
  })

  it('los archivos de la versión 1 se leen y se pasan a la 2 una vez', () => {
    const { root, cal } = setup()
    writeFileSync(join(root, 'calendar.json'), `{"schema":1,"events":[{"id":"own:abc","title":"Prueba de inglés","kind":"exam","start":"2026-10-20T08:00:00.000Z","allDay":false,"origin":"own","createdBy":"student"},
 {"id":"own:raro","title":"Con zona rara","kind":"lecture","start":"2026-10-21T08:00:00Z","allDay":false,"origin":"own","timeZone":"Marte/Olympus","reminders":[30,-4]},
 5],"links":{"platform:moodle1:e1":"fisica"}}`)
    const events = cal.ownEvents()
    expect(events.map((e) => e.id)).toEqual(['own:abc', 'own:raro'])
    expect(events[1].timeZone).toBeUndefined()
    expect(events[1].reminders).toEqual([30])
    expect(events[0].recurrence).toBeUndefined()
    expect(cal.packID('platform:moodle1:e1')).toBe('fisica')
    cal.link('platform:moodle1:e2', 'fisica')
    const once = readFileSync(join(root, 'calendar.json'))
    const parsed = JSON.parse(once.toString('utf8'))
    expect(parsed.schema).toBe(2)
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0].exceptions).toBeUndefined()
    expect(parsed.events[1].timeZone).toBe('Marte/Olympus')
    cal.link('platform:moodle1:e2', 'fisica')
    expect(readFileSync(join(root, 'calendar.json')).equals(once)).toBe(true)
    expect(cal.ownEvents().map((e) => e.title)).toEqual(['Prueba de inglés', 'Con zona rara'])
  })

  it('lo que cambia Aula se puede deshacer sin tocar lo del estudiante', () => {
    const { lib, cal } = setup()
    const actor = { kind: 'chat' as const, group: 'chat-t1-m1', label: 'Pon mis clases de Cálculo' }
    const series = ChangeContext.run(actor, () => addClasses(cal))
    cal.add({ title: 'Mi cumple', start: at('2026-11-02 00:00'), allDay: true })
    const h = lib.history!
    expect(h.groups().map((g) => g.id)).toEqual(['chat-t1-m1'])
    expect(h.describe(h.group('chat-t1-m1')!).map((l) => l.text).join()).toContain('Cálculo')
    h.undo('chat-t1-m1')
    expect(cal.ownEvents().map((e) => e.title)).toEqual(['Mi cumple'])
    expect(cal.ownEvents().some((e) => e.id === series.id)).toBe(false)
  })

  it('exportar a .ics', async () => {
    const { cal } = setup()
    const series = addClasses(cal)
    const occ = ofSeries((await cal.events(at('2026-10-01 00:00'), at('2026-10-15 00:00'))).events, series.id)
    cal.delete(occ[0].id, 'thisOccurrence')
    cal.update(occ[1].id, { start: at('2026-10-07 12:00') }, 'thisOccurrence')
    cal.add({ title: 'Entregar práctica 3; versión final, con anexos', kind: 'assignment', start: at('2026-10-16 23:59'), notes: 'Línea 1\nLínea 2 \\ con barra', reminders: [120] })
    cal.add({ title: 'Puente', start: at('2026-12-07 00:00'), end: at('2026-12-09 00:00'), allDay: true, timeZone: 'Europe/Madrid' })
    const ics = await cal.exportICS({}, at('2026-10-13 12:00'))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    const physical = ics.split('\r\n').slice(0, -1)
    expect(physical.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
    const lines = unfoldICS(ics)
    expect(lines.filter((l) => l === 'BEGIN:VEVENT').length).toBe(lines.filter((l) => l === 'END:VEVENT').length)
    expect(lines).toContain('DTSTART;TZID=Europe/Madrid:20260914T100000')
    expect(lines.some((l) => l.startsWith('RRULE:FREQ=WEEKLY;UNTIL=20261220T') && l.endsWith('BYDAY=MO,WE'))).toBe(true)
    expect(lines).toContain('EXDATE;TZID=Europe/Madrid:20261005T100000')
    expect(lines).toContain('RECURRENCE-ID;TZID=Europe/Madrid:20261007T100000')
    expect(lines).toContain('DTSTART;TZID=Europe/Madrid:20261007T120000')
    expect(lines).toContain('SUMMARY:Entregar práctica 3\\; versión final\\, con anexos')
    expect(lines).toContain('DESCRIPTION:Línea 1\\nLínea 2 \\\\ con barra')
    expect(lines).toContain('TRIGGER:-PT120M')
    expect(lines).toContain('DTSTART;VALUE=DATE:20261207')
    expect(lines).toContain('DTEND;VALUE=DATE:20261209')
    expect(lines).toContain('DTSTART:20261016T215900Z')
    // la zona con su cambio de hora de octubre (de +02:00 a +01:00) y el de marzo
    expect(lines).toContain('TZID:Europe/Madrid')
    const std = lines.map((l, i) => (l === 'DTSTART:20261025T030000' ? i : -1)).filter((i) => i >= 0)
    expect(std).toHaveLength(1)
    expect(lines[std[0] + 1]).toBe('TZOFFSETFROM:+0200')
    expect(lines[std[0] + 2]).toBe('TZOFFSETTO:+0100')
    expect(lines).toContain('DTSTART:20270328T020000')
    // la regla exportada se vuelve a leer y da las mismas clases
    const back = parseRRule(lines.find((l) => l.startsWith('RRULE:'))!, TZ)
    const end = at('2027-01-01 00:00')
    expect(expandOccurrences(series.start, back, TZ, series.start, end)).toEqual(expandOccurrences(series.start, series.recurrence!, TZ, series.start, end))
    // una tarea hecha no lleva aviso
    const task = cal.ownEvents().find((e) => e.kind === 'assignment')!
    cal.setDone(task.id, true)
    const done = unfoldICS(await cal.exportICS())
    expect(done).toContain('X-AULA-DONE:TRUE')
    expect(done).not.toContain('TRIGGER:-PT120M')
  })

  it('herramientas del chat: clases que se repiten y tareas', async () => {
    const { cal } = setup()
    const adapter = cal.forAssistant()
    const added = await adapter.addEvent({ title: 'Física', start: at('2026-10-13 12:00'), end: at('2026-10-13 13:00'), kind: 'class', recurrence: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=2026-12-15', reminders: [15] })
    expect(added.recurrence?.startsWith('FREQ=WEEKLY')).toBe(true)
    expect(added.reminders).toEqual([15])
    const range = () => adapter.events(at('2026-10-13 00:00'), at('2026-12-31 00:00'))
    const classes = (await range()).filter((e) => e.title === 'Física')
    expect(classes).toHaveLength(10)
    await adapter.updateEvent(classes[3].id, { title: 'Física', start: classes[3].start, end: classes[3].end, kind: 'class', location: 'Lab 2', scope: 'this' })
    expect((await range()).filter((e) => e.location === 'Lab 2')).toHaveLength(1)
    await adapter.deleteEvent(classes[5].id, 'following')
    expect((await range()).filter((e) => e.title === 'Física')).toHaveLength(5)
    await expect(adapter.addEvent({ title: 'x', start: new Date(), recurrence: 'FREQ=SOMETIMES' })).rejects.toThrow()
    const task = await adapter.addEvent({ title: 'Entregar informe', start: at('2026-10-20 23:59'), kind: 'assignment' })
    expect(task.isTask).toBe(true)
    expect(task.done).toBe(false)
    await adapter.setTaskDone(task.id, true)
    expect((await adapter.events(at('2026-10-20 00:00'), at('2026-10-21 00:00'))).find((e) => e.id === task.id)?.done).toBe(true)
  })
})

/** Junta las líneas plegadas de un .ics. */
function unfoldICS(ics: string): string[] {
  const out: string[] = []
  for (const raw of ics.split('\r\n')) {
    if (!raw) continue
    if (raw.startsWith(' ') && out.length) out[out.length - 1] += raw.slice(1)
    else out.push(raw)
  }
  return out
}

describe('Calendario · revisión de las series (EngineReviewCalendarFixTests)', () => {
  const mondays = (cal: StudyCalendarService, title = 'Cálculo', task = false) => cal.add({
    title, kind: task ? 'assignment' : 'lecture', start: at('2026-10-05 10:00'), end: task ? undefined : at('2026-10-05 11:00'),
    recurrence: weeklyRule([2], { until: at('2026-12-20 23:59') }), timeZone: 'Europe/Madrid', isTask: task
  })
  const list = async (cal: StudyCalendarService, prefix = 'Cálculo') =>
    (await cal.events(at('2026-10-01 00:00'), at('2027-01-01 00:00'))).events.filter((e) => e.title.startsWith(prefix)).sort((a, b) => a.start.getTime() - b.start.getTime())
  /** El cambio completo que manda la interfaz al guardar. */
  const fullPatch = (e: CalendarEvent, title?: string, start?: Date): CalendarEventPatch => {
    const s = start ?? e.start
    const p: CalendarEventPatch = {
      title: title ?? e.title, kind: e.kind, start: s, allDay: e.allDay, course: e.course ?? '', notes: e.notes ?? '', location: e.location ?? '',
      clearEnd: !e.end, clearPack: !e.packID, clearRecurrence: !e.recurrence, reminders: e.reminders, isTask: isTask(e)
    }
    if (e.end) p.end = new Date(e.end.getTime() + (s.getTime() - e.start.getTime()))
    if (e.packID) p.packID = e.packID
    if (e.recurrence) p.recurrence = e.recurrence
    return p
  }
  const calendar = () => setup({ campus: null, history: false })

  it('«esta y las siguientes» con el cambio completo no resucita días quitados (ENG-03)', async () => {
    const { cal } = calendar()
    mondays(cal)
    const oct26 = (await list(cal)).find((e) => wall(e.start).startsWith('2026-10-26'))!
    cal.delete(oct26.id, 'thisOccurrence')
    const oct19 = (await list(cal)).find((e) => wall(e.start).startsWith('2026-10-19'))!
    cal.update(oct19.id, fullPatch(oct19, 'Cálculo II'), 'thisAndFollowing')
    const after = await list(cal)
    expect(after.some((e) => wall(e.start).startsWith('2026-10-26'))).toBe(false)
    expect(wall(after.filter((e) => e.title === 'Cálculo II')[0].start)).toBe('2026-10-19 Mon 10:00')
    expect(after.filter((e) => e.title === 'Cálculo')).toHaveLength(2)
  })

  it('lo mismo desde la primera repetición (toda la serie)', async () => {
    const { cal } = calendar()
    mondays(cal)
    const all = await list(cal)
    cal.delete(all[3].id, 'thisOccurrence')
    const n = (await list(cal)).length
    cal.update(all[0].id, fullPatch(all[0], 'Cálculo II'), 'thisAndFollowing')
    expect(await list(cal)).toHaveLength(n)
  })

  it('una vez movida y luego renombrar las siguientes no las pasa todas a esa hora', async () => {
    const { cal } = calendar()
    mondays(cal)
    const occ = (await list(cal))[2]
    cal.update(occ.id, { start: at('2026-10-19 12:00') }, 'thisOccurrence')
    const moved = (await list(cal)).find((e) => e.id === occ.id)!
    expect(wall(moved.start)).toBe('2026-10-19 Mon 12:00')
    cal.update(moved.id, fullPatch(moved, 'Cálculo II'), 'thisAndFollowing')
    const tail = (await list(cal)).filter((e) => e.title === 'Cálculo II').map((e) => wall(e.start))
    expect(tail[0]).toBe('2026-10-19 Mon 12:00')
    expect(tail[1]).toBe('2026-10-26 Mon 10:00')
  })

  it('mover de verdad «esta y las siguientes» desplaza la cola y sus días quitados', async () => {
    const { cal } = calendar()
    mondays(cal)
    const all = await list(cal)
    cal.delete(all[4].id, 'thisOccurrence')
    const oct19 = all[2]
    cal.update(oct19.id, fullPatch(oct19, undefined, new Date(oct19.start.getTime() + 3_600_000)), 'thisAndFollowing')
    const after = (await list(cal)).map((e) => wall(e.start))
    expect(after).toContain('2026-10-19 Mon 11:00')
    expect(after).toContain('2026-10-26 Mon 11:00')
    expect(after.some((s) => s.startsWith('2026-11-02'))).toBe(false)
  })

  it('mover toda la serie conserva los días quitados y las tareas hechas (ENG-13)', async () => {
    const { cal } = calendar()
    mondays(cal, 'Cálculo hoja', true)
    let all = await list(cal)
    cal.setDone(all[0].id, true)
    cal.delete(all[2].id, 'thisOccurrence')
    all = await list(cal)
    const n = all.length
    cal.update(all[1].id, { start: new Date(all[1].start.getTime() + 3_600_000) }, 'allOccurrences')
    const after = await list(cal)
    expect(after).toHaveLength(n)
    expect(isDone(after[0])).toBe(true)
    expect(wall(after[0].start)).toBe('2026-10-05 Mon 11:00')
    expect(after.some((e) => wall(e.start).startsWith('2026-10-19'))).toBe(false)
  })

  it('«solo esta vez» guarda tipo y todo el día; lo que es de la serie da un error claro (ENG-14)', async () => {
    const { cal } = calendar()
    mondays(cal)
    const all = await list(cal)
    const r = cal.update(all[2].id, { kind: 'exam', allDay: true }, 'thisOccurrence')
    expect(r.kind).toBe('exam')
    expect(r.allDay).toBe(true)
    const l3 = await list(cal)
    expect(l3.find((e) => e.id === all[2].id)?.kind).toBe('exam')
    expect(l3[3].kind).toBe('lecture')
    try {
      cal.update(all[3].id, { reminders: [30] }, 'thisOccurrence')
      throw new Error('debía fallar')
    } catch (err) {
      expect((err as Error).message).toContain('Solo esta vez')
    }
    // el cambio completo de la interfaz (misma regla y mismos avisos) no es un cambio de serie
    cal.update(all[4].id, fullPatch(all[4], 'Cálculo (aula 3)'), 'thisOccurrence')
    expect((await list(cal)).find((e) => e.id === all[4].id)?.title).toBe('Cálculo (aula 3)')
    // arrastrar una repetición de todo el día a una hora sí se aplica
    cal.add({ title: 'Cálculo festivo', kind: 'event', start: at('2026-10-06 00:00'), allDay: true, recurrence: weeklyRule([3]), timeZone: 'Europe/Madrid' })
    const day = (await list(cal, 'Cálculo festivo'))[0]
    const timed = cal.update(day.id, { start: at('2026-10-06 09:00'), end: at('2026-10-06 10:00'), allDay: false }, 'thisOccurrence')
    expect(timed.allDay).toBe(false)
    expect(wall(timed.start)).toBe('2026-10-06 Tue 09:00')
  })

  it('lo que no se entiende se conserva; un archivo ilegible se aparta (ENG-20)', () => {
    const { root, cal } = calendar()
    writeFileSync(cal.fileURL, '{"schema":2,"events":[{"id":"own:a","title":"Futura","kind":"seminar","start":"2026-10-05T08:00:00Z","origin":"own","recurrence":"FREQ=HOURLY;INTERVAL=1","color":"blue"}],"links":{},"completed":{}}')
    mondays(cal, 'Otro')
    const saved = readFileSync(cal.fileURL, 'utf8')
    expect(saved).toContain('seminar')
    expect(saved).toContain('HOURLY')
    expect(saved).toContain('"color"')
    // de una versión más nueva: no se toca
    writeFileSync(cal.fileURL, '{"schema":99,"events":[]}')
    expect(errorCode(() => mondays(cal, 'Nuevo'))).toBe('invalid')
    expect(readFileSync(cal.fileURL, 'utf8')).toContain('99')
    // ilegible y sin copia anterior: copia .damaged, aviso y el siguiente intento funciona
    writeFileSync(cal.fileURL, '{no es json')
    rmSync(join(root, '.calendar.json.bak'), { force: true })
    try {
      mondays(cal, 'Nuevo')
      throw new Error('debía fallar')
    } catch (err) {
      expect((err as Error).message).toContain('copia')
    }
    expect(readdirSync(root).filter((n) => n.startsWith('calendar.json.damaged-'))).toHaveLength(1)
    expect(() => mondays(cal, 'Nuevo')).not.toThrow()
  })

  it('A3-P2-9: calendar.json guarda la versión anterior y, si se daña, se lee de ella; si no hay, se avisa ya al leer', async () => {
    const { root, cal } = calendar()
    mondays(cal, 'Uno')
    mondays(cal, 'Dos')
    mondays(cal, 'Tres')
    expect(existsSync(join(root, '.calendar.json.bak'))).toBe(true)
    // truncado a mitad (un corte de luz, un disco lleno…): se ve lo de la copia anterior, sin aviso
    writeFileSync(cal.fileURL, readFileSync(cal.fileURL, 'utf8').slice(0, 40))
    let snap = await cal.events(at('2026-09-01 00:00'), at('2026-12-31 00:00'))
    expect(new Set(snap.events.map((e) => e.title))).toEqual(new Set(['Uno', 'Dos']))
    expect(snap.fileProblem).toBeUndefined()
    // el siguiente cambio parte de la copia (no de un calendario vacío) y no se pierde lo que había
    mondays(cal, 'Cuatro')
    snap = await cal.events(at('2026-09-01 00:00'), at('2026-12-31 00:00'))
    expect(new Set(snap.events.map((e) => e.title))).toEqual(new Set(['Uno', 'Dos', 'Cuatro']))
    expect(readdirSync(root).filter((n) => n.startsWith('calendar.json.damaged-'))).toHaveLength(1)
    // dañados los dos: vacío, pero con el aviso al leer (antes solo se sabía al añadir algo)
    writeFileSync(cal.fileURL, '{roto')
    writeFileSync(join(root, '.calendar.json.bak'), '{roto también')
    snap = await cal.events(at('2026-09-01 00:00'), at('2026-12-31 00:00'))
    expect(snap.events.filter((e) => e.origin === 'own')).toEqual([])
    expect(snap.fileProblem).toContain('calendar.json.damaged-')
  })

  it('una serie de hace años exporta los cambios de hora de ahora (ENG-21)', () => {
    const e = makeCalendarEvent({ id: 'own:old', title: 'Vieja', kind: 'lecture', start: at('2021-09-13 10:00'), end: at('2021-09-13 11:00'), recurrence: weeklyRule([2]), timeZone: 'Europe/Madrid' })
    const ics = writeICS([e], {}, at('2026-10-19 10:00'))
    expect(ics).toContain('DTSTART:20261025T030000')
    expect(ics).toContain('DTSTART:20280326T020000')
  })

  it('las herramientas piden permiso para marcar tareas y dicen alcance y regla (ENG-15/17)', async () => {
    const { cal } = calendar()
    const t = cal.add({ title: 'Entrega', kind: 'assignment', start: at('2026-10-20 23:59'), reminders: [60] })
    const cards: CalendarApprovalCard[] = []
    const deny = cal.toolHandlers({ approve: async (c) => { cards.push(c); return false } })
    await deny.calendar_complete_task({ id: t.id })
    expect(cards).toHaveLength(1)
    expect(cal.pendingReminders(at('2026-10-01 00:00'), at('2026-11-01 00:00')).length).toBeGreaterThan(0)
    mondays(cal)
    const occ = (await list(cal))[1]
    await deny.calendar_delete({ id: occ.id, scope: 'all' })
    const card = cards[cards.length - 1]
    const shown = card.facts.map((f) => `${f.label}: ${f.value}`).join(' | ')
    expect(shown).toContain('Toda la serie')
    expect(shown).toContain('Cada semana')
    expect(card.facts.some((f) => f.value === 'Cálculo')).toBe(true)
    // un tipo para una sola vez: de verdad cambia
    await cal.toolHandlers({ approve: autoApprove }).calendar_update({ id: occ.id, kind: 'exam' })
    expect((await list(cal)).find((e) => e.id === occ.id)?.kind).toBe('exam')
    // sin nadie que conteste no se hace
    expect((await cal.toolHandlers().calendar_add({ title: 'x', start: '2026-10-21' })).isError).toBe(true)
  })
})

describe('Calendario · exámenes vinculados a un curso (CalendarLinkedExamTests)', () => {
  const start = new Date(1_705_276_800_000) // 2024-01-15T00:00:00Z
  const from = new Date(start.getTime() - 86_400_000)
  const to = new Date(start.getTime() + 60 * 86_400_000)

  function fixture(exam: ExamInfo | null = { title: 'Final principal' }) {
    const root = tmpRoot()
    const library = new Library(root, { recordsHistory: false })
    const store = library.createPack(makePack({ id: 'linked-course', title: 'Curso sintético', created: start.toISOString(), updated: start.toISOString(), ...(exam ? { exam } : {}) }))
    const calendar = new StudyCalendarService({ root, library, platforms: null, timeZone: TZ })
    const reopen = () => new StudyCalendarService({ root, library: new Library(root, { recordsHistory: false }), platforms: null, timeZone: TZ })
    return { root, library, store, calendar, reopen }
  }
  const events = async (c: StudyCalendarService) => (await c.events(from, to)).events

  it('un examen vinculado es propio y no escribe en el curso', async () => {
    const main: ExamInfo = { title: 'Final principal', durationMinutes: 150, totalPoints: 100, aids: 'Calculadora', notes: 'Temario global', location: 'Aula principal' }
    const f = fixture(main)
    const before = readFileSync(join(f.store.directory, 'pack.json'))
    const added = await f.calendar.forAssistant().addEvent({ title: 'Parcial', start, kind: 'exam', courseID: f.store.id })
    expect(added.id.startsWith('own:')).toBe(true)
    expect(added.source).toBe('aula')
    expect(added.courseID).toBe(f.store.id)
    expect((await events(f.calendar)).map((e) => e.id)).toEqual([added.id])
    expect(f.store.loadPack().exam).toEqual(main)
    expect(readFileSync(join(f.store.directory, 'pack.json')).equals(before)).toBe(true)
  })

  it('un curso sin examen no gana uno en la sombra', async () => {
    const f = fixture(null)
    const added = await f.calendar.forAssistant().addEvent({ title: 'Parcial', start, kind: 'exam', courseID: f.store.id })
    expect(f.store.loadPack().exam).toBeUndefined()
    expect((await events(f.calendar)).map((e) => e.id)).toEqual([added.id])
  })

  it('borrar el examen no deja sombra al reabrir', async () => {
    const f = fixture()
    const a = f.calendar.forAssistant()
    const added = await a.addEvent({ title: 'Parcial', start, kind: 'exam', courseID: f.store.id })
    await a.deleteEvent(added.id)
    expect(await events(f.reopen())).toEqual([])
    expect(f.calendar.ownEvents()).toEqual([])
    expect(f.store.loadPack().exam?.date).toBeUndefined()
  })

  it('mover el examen no deja la fecha original en el curso', async () => {
    const f = fixture()
    const a = f.calendar.forAssistant()
    const added = await a.addEvent({ title: 'Parcial', start, kind: 'exam', courseID: f.store.id })
    const movedDate = new Date(start.getTime() + 7 * 86_400_000)
    const changed = { title: 'Parcial aplazado', start: movedDate, end: new Date(movedDate.getTime() + 5_400_000), kind: 'exam', courseID: f.store.id, notes: 'Nuevo temario', location: 'Sala B', reminders: [60] }
    const moved = await a.updateEvent(added.id, changed)
    expect(moved.id).toBe(added.id)
    const visible = await events(f.reopen())
    expect(visible.map((e) => e.id)).toEqual([added.id])
    const own = visible[0]
    expect(own.start).toEqual(movedDate)
    expect(own.end).toEqual(changed.end)
    expect(own.notes).toBe('Nuevo temario')
    expect(own.location).toBe('Sala B')
    expect(own.reminders).toEqual([60])
    expect(f.store.loadPack().exam?.date).toBeUndefined()
  })

  it('un examen de dos días conserva sus campos y la tarea al reabrir', async () => {
    const f = fixture()
    const a = f.calendar.forAssistant()
    const d = { title: 'Parcial de dos días', start, end: new Date(start.getTime() + 2 * 86_400_000), allDay: true, kind: 'exam', courseID: f.store.id, notes: 'Traer material', location: 'Sala A', reminders: [30, 120], isTask: true }
    const added = await a.addEvent(d)
    await a.setTaskDone(added.id, true)
    const reopened = f.reopen()
    const saved = (await reopened.event(added.id))!
    expect((await events(reopened)).map((e) => e.id)).toEqual([added.id])
    expect(saved.origin).toBe('own')
    expect(saved.createdBy).toBe('ai')
    expect(saved.packID).toBe(f.store.id)
    expect(saved.title).toBe(d.title)
    expect(saved.start).toEqual(d.start)
    expect(saved.end).toEqual(d.end)
    expect(saved.allDay).toBe(true)
    expect(saved.notes).toBe(d.notes)
    expect(saved.location).toBe(d.location)
    expect(saved.reminders).toEqual([30, 120])
    expect(isTask(saved)).toBe(true)
    expect(isDone(saved)).toBe(true)
  })

  it('un examen vinculado que se repite solo lista sus repeticiones', async () => {
    const f = fixture()
    const added = await f.calendar.forAssistant().addEvent({ title: 'Dos parciales', start, end: new Date(start.getTime() + 3_600_000), kind: 'exam', courseID: f.store.id, notes: 'Mismo temario', location: 'Sala A', recurrence: 'FREQ=DAILY;COUNT=2', reminders: [30] })
    const reopened = f.reopen()
    const visible = await events(reopened)
    expect(visible).toHaveLength(2)
    expect(visible.every((e) => e.origin === 'own' && e.seriesID === added.id && e.id.startsWith(added.id + '#'))).toBe(true)
    expect(visible.every((e) => e.packID === f.store.id && e.notes === 'Mismo temario' && e.location === 'Sala A' && e.reminders.join() === '30')).toBe(true)
    expect((await reopened.event(added.id))?.recurrence?.count).toBe(2)
    expect(f.store.loadPack().exam?.date).toBeUndefined()
  })

  it('dos parciales no eligen la fecha principal; fijarla aparte sí funciona', async () => {
    const f = fixture()
    const a = f.calendar.forAssistant()
    const first = await a.addEvent({ title: 'Parcial 1', start, kind: 'exam', courseID: f.store.id })
    const second = await a.addEvent({ title: 'Parcial 2', start: new Date(start.getTime() + 7 * 86_400_000), kind: 'exam', courseID: f.store.id })
    expect(f.store.loadPack().exam?.date).toBeUndefined()
    expect(new Set((await events(f.calendar)).map((e) => e.id))).toEqual(new Set([first.id, second.id]))
    const mainDate = new Date(start.getTime() + 21 * 86_400_000)
    f.calendar.update(`course:${f.store.id}`, { start: mainDate, title: 'Final principal' })
    expect(f.store.loadPack().exam?.date).toBe(mainDate.toISOString())
    const after = await events(f.reopen())
    expect(new Set(after.filter((e) => e.origin === 'own').map((e) => e.id))).toEqual(new Set([first.id, second.id]))
    expect(after.filter((e) => e.origin === 'course').map((e) => e.id)).toEqual([`course:${f.store.id}`])
    expect(after.find((e) => e.origin === 'course')?.start).toEqual(mainDate)
  })

  it('un examen principal con fecha sigue aparte del propio nuevo', async () => {
    const main: ExamInfo = { title: 'Final principal', date: start.toISOString(), durationMinutes: 150, notes: 'Global', location: 'Sala principal' }
    const f = fixture(main)
    const added = await f.calendar.forAssistant().addEvent({ title: main.title, start, kind: 'exam', courseID: f.store.id })
    expect(f.store.loadPack().exam).toEqual(main)
    const visible = await events(f.calendar)
    expect(new Set(visible.map((e) => e.id))).toEqual(new Set([added.id, `course:${f.store.id}`]))
    expect(visible.find((e) => e.origin === 'course')?.start).toEqual(start)
  })

  it('una prueba corta vinculada deja el examen principal sin fecha', async () => {
    const f = fixture()
    const added = await f.calendar.forAssistant().addEvent({ title: 'Prueba corta', start, kind: 'quiz', courseID: f.store.id })
    const visible = await events(f.calendar)
    expect(visible.map((e) => e.id)).toEqual([added.id])
    expect(f.store.loadPack().exam?.date).toBeUndefined()
    expect(visible[0].kind).toBe('quiz')
  })

  it('exámenes sin curso o con un curso desconocido siguen siendo independientes', async () => {
    const f = fixture()
    const a = f.calendar.forAssistant()
    const unlinked = await a.addEvent({ title: 'Parcial', start, kind: 'exam' })
    const unknown = await a.addEvent({ title: 'Parcial', start, kind: 'exam', courseID: 'missing-synthetic-course' })
    expect(unlinked.id).not.toBe(unknown.id)
    expect(new Set((await events(f.calendar)).map((e) => e.id))).toEqual(new Set([unlinked.id, unknown.id]))
    expect(unlinked.courseID).toBeUndefined()
    expect(unknown.courseID).toBe('missing-synthetic-course')
    expect(f.store.loadPack().exam?.date).toBeUndefined()
  })

  it('fijar la fecha principal conserva los demás datos del examen', async () => {
    const original: ExamInfo = { title: 'Final principal', durationMinutes: 150, totalPoints: 100, aids: 'Calculadora', notes: 'Temario global', location: 'Sala A' }
    const f = fixture(original)
    const mainDate = new Date(start.getTime() + 21 * 86_400_000)
    f.calendar.update(`course:${f.store.id}`, { start: mainDate, title: 'Final confirmado' })
    const reopened = f.reopen()
    expect(reopened.library!.openPack(f.store.id)!.loadPack().exam).toEqual({ ...original, title: 'Final confirmado', date: mainDate.toISOString() })
    expect((await events(reopened)).map((e) => e.id)).toEqual([`course:${f.store.id}`])
    expect(reopened.ownEvents()).toEqual([])
  })
})
