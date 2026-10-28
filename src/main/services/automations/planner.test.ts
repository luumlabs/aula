// Planificador, horas y novedades (port de AutomationTests.swift y AutomationIntervalOverflowTests.swift): horas, días,
// franjas, una vez, avisos antes de eventos, recuperación tras sueño o cierre, horas de silencio y cambio de hora (Madrid).
import { describe, expect, it } from 'vitest'
import { makeInstant, wallTime } from '@engine/calendar/time'
import {
  AutomationPlanner, compareFindings, defaultSchedule, emptyAutomationState, normalizedURL, parseTime, parseWeekdays, quietContains, quietEnd, WEEKDAYS,
  type Automation, type AutomationFinding, type AutomationSchedule, type PlannerEvent, type QuietHours
} from '@shared/automations'
import { headline, scheduleSummary } from './texts'
import { decodeSchedule } from './codec'

const TZ = 'Europe/Madrid'
const at = (y: number, m: number, d: number, h: number, min = 0, s = 0) => makeInstant(y, m, d, h, min, s, TZ)
const hourOf = (t: number) => wallTime(t, TZ).hour
const p = new AutomationPlanner(TZ)

function daily(times: string[], weekdays: number[] = []): AutomationSchedule {
  return { ...defaultSchedule('daily'), times, weekdays }
}
function interval(every: number, from = '08:00', to = '22:00', weekdays: number[] = []): AutomationSchedule {
  return { ...defaultSchedule('interval'), everyHours: every, windowStart: from, windowEnd: to, weekdays }
}
function once(t: number): AutomationSchedule {
  return { ...defaultSchedule('once'), date: new Date(t).toISOString() }
}
function before(hours: number[], kinds: AutomationSchedule['eventKinds'] = []): AutomationSchedule {
  return { ...defaultSchedule('beforeEvents'), hoursBefore: hours, eventKinds: kinds }
}
function auto(schedule: AutomationSchedule, extra: Partial<Automation> = {}): Automation {
  return { id: 'a', title: 'x', instruction: 'x', schedule, capabilities: ['courses'], notify: 'news', untilFound: false, enabled: true, origin: 'student', platformIDs: [], created: new Date(at(2026, 10, 1, 0)).toISOString(), updated: new Date(at(2026, 10, 1, 0)).toISOString(), ...extra }
}
function state(lastChecked: number, extra: Partial<ReturnType<typeof emptyAutomationState>> = {}) {
  return { ...emptyAutomationState(), lastChecked: new Date(lastChecked).toISOString(), ...extra }
}
const ev = (id: string, title: string, kind: string, start: number, allDay = false): PlannerEvent => ({ id, title, kind, start: new Date(start), allDay })

describe('horas y días', () => {
  it('lee horas como la app Swift', () => {
    expect(parseTime('08:00')).toBe('08:00')
    expect(parseTime('8:30')).toBe('08:30')
    expect(parseTime('20h')).toBe('20:00')
    expect(parseTime('8pm')).toBe('20:00')
    expect(parseTime('8:30 pm')).toBe('20:30')
    expect(parseTime('12am')).toBe('00:00')
    expect(parseTime('20.15')).toBe('20:15')
    expect(parseTime(465)).toBe('07:45')
    expect(parseTime('25:00')).toBeNull()
    expect(parseTime('mañana')).toBeNull()
  })

  it('lee días de la semana en español e inglés', () => {
    expect(parseWeekdays(['mon', 'miércoles', 'Viernes'])).toEqual([2, 4, 6])
    expect(parseWeekdays(['weekdays'])).toEqual(WEEKDAYS.schoolDays)
    expect(parseWeekdays(['fin de semana'])).toEqual([1, 7])
  })

  it('resume el horario y lee con tolerancia', () => {
    expect(scheduleSummary(daily(['08:00']), TZ)).toMatch(/^Todos los días a las 8:00/)
    expect(scheduleSummary(daily(['20:00'], WEEKDAYS.schoolDays), TZ)).toMatch(/^De lunes a viernes/)
    expect(scheduleSummary(interval(8), TZ)).toMatch(/^Cada 8 h/)
    expect(scheduleSummary(before([24, 2]), TZ)).toContain('antes de entregas y exámenes')
    const back = decodeSchedule({ kind: 'daily', times: ['07:45', 'nope'], weekdays: [2, 9] })
    expect(back.times).toEqual(['07:45'])
    expect(back.weekdays).toEqual([2])
  })
})

describe('planificador', () => {
  it('huecos diarios, por intervalo y de una vez', () => {
    const mon = at(2026, 10, 12, 0)
    const s = daily(['20:00', '08:00'], [2, 4])
    const slots = p.slots(s, mon, at(2026, 10, 15, 0))
    expect(slots.map((x) => x.at)).toEqual([at(2026, 10, 12, 8), at(2026, 10, 12, 20), at(2026, 10, 14, 8), at(2026, 10, 14, 20)])
    expect(p.next(s, at(2026, 10, 12, 20))?.at).toBe(at(2026, 10, 14, 8)) // el martes no toca
    // cada 7 h de 8:00 a 22:00 = 8, 15, 22
    expect(p.slots(interval(7), mon, at(2026, 10, 12, 23, 59)).map((x) => x.at)).toEqual([at(2026, 10, 12, 8), at(2026, 10, 12, 15), at(2026, 10, 12, 22)])
    // nunca menos de 1 h aunque pidan cada 10 min
    expect(p.slots(interval(0.1, '08:00', '11:00'), mon, at(2026, 10, 12, 12)).length).toBe(4)
    expect(p.next(once(at(2026, 10, 13, 18, 30)), mon)?.at).toBe(at(2026, 10, 13, 18, 30))
    expect(p.next(once(at(2026, 10, 13, 18, 30)), at(2026, 10, 13, 19))).toBeUndefined()
    expect(slots[0].key).toBe('2026-10-12T08:00')
  })

  it('intervalos enormes: un hueco por día permitido, sin colgarse', () => {
    const mon = at(2026, 10, 12, 0)
    const huge = interval(1e12)
    expect(p.slots(huge, mon, at(2026, 10, 14, 23)).map((x) => x.at)).toEqual([at(2026, 10, 12, 8), at(2026, 10, 13, 8), at(2026, 10, 14, 8)])
    expect(p.next(huge, mon)?.at).toBe(at(2026, 10, 12, 8))
    // una franja que cruza la medianoche se corta en las 23:59
    expect(p.slots(interval(2, '22:00', '02:00'), mon, at(2026, 10, 12, 23, 59)).map((x) => hourOf(x.at))).toEqual([22])
  })

  it('cambio de hora: un hueco por día y la misma hora de reloj', () => {
    const fall = p.slots(daily(['02:30']), at(2026, 10, 24, 12), at(2026, 10, 26, 12))
    expect(fall.length).toBe(2)
    const spring = p.slots(daily(['02:30']), at(2026, 3, 28, 12), at(2026, 3, 30, 12))
    expect(spring.length).toBe(2)
    expect(wallTime(spring[0].at, TZ).day).toBe(29)
    const eight = p.slots(daily(['08:00']), at(2026, 10, 24, 12), at(2026, 10, 26, 12))
    expect(eight.map((x) => hourOf(x.at))).toEqual([8, 8])
  })

  it('avisos antes de eventos: uno por evento, el más reciente, nunca después de empezar', () => {
    const due = ev('own:a', 'Ensayo', 'assignment', at(2026, 10, 15, 23, 59))
    const exam = ev('platform:x:e', 'Parcial', 'exam', at(2026, 10, 14, 10))
    const allDay = ev('own:b', 'Práctica', 'assignment', at(2026, 10, 16, 0), true)
    const lecture = ev('own:c', 'Clase', 'lecture', at(2026, 10, 14, 9))
    const sched = before([24, 2])
    const s = p.slots(sched, at(2026, 10, 12, 0), at(2026, 10, 20, 0), [due, exam, allDay, lecture])
    expect(s.length).toBe(6) // 2 avisos × 3 eventos; las clases no
    expect(s.some((x) => x.eventID === 'own:b' && hourOf(x.at) === 21)).toBe(true) // sin hora = a las 23:59
    const a = auto(sched, { origin: 'routine', routine: 'deadlineReminders' })
    const st = state(at(2026, 10, 13, 8))
    const d = p.decide(a, st, at(2026, 10, 14, 7), [exam])
    expect(d.action.type).toBe('run')
    if (d.action.type === 'run') {
      expect(d.action.trigger).toBe('catchUp')
      expect(d.action.slots.map((x) => x.hoursBefore)).toEqual([24])
    }
    const d2 = p.decide(a, st, at(2026, 10, 14, 8, 30), [exam])
    expect(d2.action.type === 'run' && d2.action.slots.map((x) => x.hoursBefore)).toEqual([2])
    expect(d2.expiredKeys.length).toBe(1)
    expect(p.decide(a, st, at(2026, 10, 14, 10, 30), [exam]).action.type).toBe('none')
    expect(p.decide(a, { ...st, firedKeys: s.map((x) => x.key) }, at(2026, 10, 14, 9), [exam]).action.type).toBe('none')
  })

  it('recupera una vez tras dormir o cerrar, con su ventana', () => {
    const a = auto(daily(['08:00']))
    const st = state(at(2026, 10, 10, 7))
    const d = p.decide(a, st, at(2026, 10, 12, 9, 30))
    expect(d.action.type === 'run' && d.action.trigger).toBe('catchUp')
    expect(d.action.type === 'run' && d.action.slots.map((x) => x.at)).toEqual([at(2026, 10, 12, 8)])
    expect(d.missed.map((x) => x.at)).toEqual([at(2026, 10, 10, 8), at(2026, 10, 11, 8)])
    const late = p.decide(a, st, at(2026, 10, 12, 15))
    expect(late.action.type).toBe('none')
    expect(late.missed.length).toBe(3)
    const onTime = p.decide(a, state(at(2026, 10, 12, 7, 59)), at(2026, 10, 12, 8, 0, 30))
    expect(onTime.action.type === 'run' && onTime.action.trigger).toBe('scheduled')
    const retry = p.decide(a, state(at(2026, 10, 12, 8, 1), { retryAt: new Date(at(2026, 10, 12, 8, 6)).toISOString() }), at(2026, 10, 12, 8, 7))
    expect(retry.action.type === 'run' && retry.action.trigger).toBe('retry')
    const o = auto(once(at(2026, 10, 11, 20)))
    const os = state(at(2026, 10, 11, 19))
    const r1 = p.decide(o, os, at(2026, 10, 12, 7))
    expect(r1.action.type === 'run' && r1.action.slots[0].key).toBe('2026-10-11T20:00')
    expect(p.decide(o, os, at(2026, 10, 12, 9)).action.type).toBe('none')
    expect(p.decide({ ...a, enabled: false }, st, at(2026, 10, 12, 9)).action.type).toBe('none')
    expect(p.decide(a, { ...st, completed: true }, at(2026, 10, 12, 9)).action.type).toBe('none')
  })

  it('horas de silencio: aplaza la IA y las rutinas, no lo que programó el estudiante', () => {
    const quiet: QuietHours = { enabled: true, from: '22:30', to: '07:30' }
    expect(quietContains(quiet, at(2026, 10, 12, 23), TZ)).toBe(true)
    expect(quietContains(quiet, at(2026, 10, 13, 6), TZ)).toBe(true)
    expect(quietContains(quiet, at(2026, 10, 12, 12), TZ)).toBe(false)
    expect(quietEnd(quiet, at(2026, 10, 12, 23), TZ)).toBe(at(2026, 10, 13, 7, 30))
    const st = state(at(2026, 10, 12, 22, 59))
    const ai = auto(daily(['23:00']), { origin: 'aula' })
    const d = p.decide(ai, st, at(2026, 10, 12, 23), [], quiet)
    expect(d.action).toMatchObject({ type: 'defer', until: at(2026, 10, 13, 7, 30) })
    const deferred = { ...st, deferredUntil: new Date(at(2026, 10, 13, 7, 30)).toISOString(), deferredSlot: new Date(at(2026, 10, 12, 23)).toISOString(), lastChecked: new Date(at(2026, 10, 13, 7)).toISOString() }
    expect(p.decide(ai, deferred, at(2026, 10, 13, 7), [], quiet).action.type).toBe('none')
    const r = p.decide(ai, deferred, at(2026, 10, 13, 7, 31), [], quiet)
    expect(r.action.type === 'run' && r.action.trigger).toBe('catchUp')
    const mine = p.decide(auto(daily(['23:00'])), st, at(2026, 10, 12, 23), [], quiet)
    expect(mine.action.type === 'run' && mine.action.trigger).toBe('scheduled')
    // un recordatorio de algo que vence antes de que acabe el silencio no se aplaza
    const rem = auto(before([2]), { origin: 'routine', routine: 'deadlineReminders' })
    expect(p.decide(rem, st, at(2026, 10, 12, 23, 1), [ev('own:z', 'Entrega', 'assignment', at(2026, 10, 13, 1))], quiet).action.type).toBe('run')
  })

  it('la próxima vez para la interfaz salta los avisos ya dados', () => {
    const exam = ev('e1', 'Parcial', 'exam', at(2026, 10, 20, 10))
    const a = auto(before([24, 2]))
    const st = state(at(2026, 10, 18, 0))
    const first = p.nextRun(a, st, at(2026, 10, 18, 0), [exam])
    expect(first).toBe(at(2026, 10, 19, 10))
    const fired = p.slots(a.schedule, at(2026, 10, 18, 0), at(2026, 10, 19, 11), [exam]).map((x) => x.key)
    expect(p.nextRun(a, { ...st, firedKeys: fired }, at(2026, 10, 18, 0), [exam])).toBe(at(2026, 10, 20, 8))
  })
})

describe('novedades', () => {
  it('avisa solo de lo nuevo (y de las fechas cambiadas)', () => {
    const t0 = new Date('2026-10-12T08:00:00Z')
    const a1: AutomationFinding = { key: 'https://campus.test.edu/courses/7/assignments/1?module_item_id=9', title: 'Tarea 1: Límites', kind: 'assignment', url: 'https://campus.test.edu/courses/7/assignments/1', due: t0.toISOString(), fresh: false }
    const a2: AutomationFinding = { key: 'x2', title: 'Tarea 2: Derivadas', kind: 'assignment', fresh: false }
    const first = compareFindings([a1, a2], [], true, t0)
    expect(first.new).toEqual([])
    expect(first.known.length).toBe(2)
    expect(first.seen.length).toBe(2)
    expect(compareFindings([a1, { ...a2, fresh: true }], [], true).new.map((f) => f.title)).toEqual(['Tarea 2: Derivadas'])
    const same1: AutomationFinding = { ...a1, key: 'assignment 1', url: 'https://campus.test.edu/courses/7/assignments/1/', due: new Date(t0.getTime() + 86_400_000).toISOString() }
    const same2: AutomationFinding = { key: 'tarea-2', title: 'tarea 2 derivadas', kind: 'assignment', fresh: false }
    const a3: AutomationFinding = { key: 'https://campus.test.edu/courses/7/assignments/3', title: 'Tarea 3: Integrales', kind: 'assignment', fresh: false }
    const second = compareFindings([same1, same2, a3], first.seen, false)
    expect(second.new.map((f) => f.title)).toEqual(['Tarea 3: Integrales'])
    expect(second.changed.map((f) => f.title)).toEqual(['Tarea 1: Límites'])
    expect(second.known.length).toBe(1)
    // dos anuncios con el mismo título y direcciones distintas son distintos
    const w1: AutomationFinding = { key: 'https://campus.test.edu/announcements/10', title: 'Anuncio semanal', kind: 'announcement', fresh: false }
    const w2: AutomationFinding = { ...w1, key: 'https://campus.test.edu/announcements/11' }
    expect(compareFindings([w2], compareFindings([w1], [], false).seen, false).new.length).toBe(1)
    expect(normalizedURL('https://c.edu/mod/assign/view.php?id=12&lang=es#x')).toBe('c.edu/mod/assign/view.php?id=12')
    expect(normalizedURL('https://c.edu/mod/assign/view.php?id=12')).not.toBe(normalizedURL('https://c.edu/mod/assign/view.php?id=13'))
    expect(headline([a3], [])).toBe('1 asignación nueva: «Tarea 3: Integrales»')
    const many = Array.from({ length: 500 }, (_, i): AutomationFinding => ({ key: `k${i}`, title: `Cosa ${i}`, kind: 'other', fresh: false }))
    expect(compareFindings(many, [], false).seen.length).toBe(400)
  })
})
