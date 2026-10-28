// Recordatorios de estudio (StudyReminders.swift): «Hora de estudiar» a la hora elegida (sin insistir si ya cumpliste la meta),
// «Mañana: examen de…» el día antes, avisos de los eventos y recuperación al despertar sin tandas de avisos viejos.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeInstant } from '@engine/calendar/time'
import { defaultSettings } from '@shared/settings'
import type { HomeSummary } from '@shared/ipc/home'
import type { PackSummary } from '@shared/schema/library'
import { StudyReminders, type CalendarReminderLike, type StudyReminderNotice } from './reminders'
import { AutomationStore } from './store'

const TZ = 'Europe/Madrid'
const at = (y: number, m: number, d: number, h: number, min = 0) => makeInstant(y, m, d, h, min, 0, TZ)

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-rem-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const pack = (id: string, title: string, exam?: number): PackSummary => ({ id, title, subject: '', icon: 'math', hue: 0.1, updated: '2026-10-01T00:00:00Z', skillCount: 3, exerciseCount: 10, cardCount: 5, language: 'es', hasExam: !!exam, ...(exam ? { examDate: new Date(exam).toISOString() } : {}) })

function summary(minutesDone: number, dueCards = 4, mistakes = 2): HomeSummary {
  return { name: '', today: { minutesDone, minutesGoal: 30, itemsDone: 0, itemsTotal: 3 }, streak: { days: 0, best: 0, week: [] }, plan: [], exams: [], courses: [], upcoming: [], dueCards, mistakes, aiReady: true }
}

function setup(o: { packs?: PackSummary[]; study?: HomeSummary | null; reminders?: CalendarReminderLike[]; enabled?: boolean } = {}) {
  let now = at(2026, 10, 12, 9)
  const sent: StudyReminderNotice[] = []
  const settings = { ...defaultSettings().general, reminders: o.enabled ?? true, reminderTime: '18:00' }
  const r = new StudyReminders({
    store: new AutomationStore(root), settings: () => settings, packs: () => o.packs ?? [pack('trig', 'Trigonometría')],
    studySummary: async () => (o.study === undefined ? summary(5) : o.study), calendarReminders: (from, to) => (o.reminders ?? []).filter((x) => x.fireAt >= from && x.fireAt <= to),
    notify: (n) => sent.push(n), timeZone: () => TZ, clock: () => now
  })
  return { r, sent, set: (t: number) => { now = t } }
}

describe('recordatorios de estudio', () => {
  it('«Hora de estudiar» a su hora, una vez al día', async () => {
    const { r, sent, set } = setup()
    await r.check() // la primera vez no recupera nada viejo
    set(at(2026, 10, 12, 17, 59)); await r.check()
    expect(sent).toEqual([])
    set(at(2026, 10, 12, 18, 0, )); await r.check()
    set(at(2026, 10, 12, 18, 1)); await r.check()
    expect(sent.map((n) => n.title)).toEqual(['Hora de estudiar'])
    expect(sent[0].body).toContain('4 tarjetas y 2 errores')
    expect(sent[0].target).toEqual({ kind: 'home' })
    expect(r.nextWake(at(2026, 10, 12, 18, 2))).toBe(at(2026, 10, 13, 18))
  })

  it('no insiste si ya cumpliste la meta, ni sin cursos, ni apagado', async () => {
    for (const o of [{ study: summary(45) }, { packs: [] }, { enabled: false }]) {
      const { r, sent, set } = setup(o)
      await r.check()
      set(at(2026, 10, 12, 18, 0)); await r.check()
      expect(sent).toEqual([])
    }
  })

  it('el día antes de un examen y los avisos de los eventos; al despertar, solo lo que aún tiene sentido', async () => {
    const reminders: CalendarReminderLike[] = [
      { id: 'r1', eventID: 'own:a', title: 'Tutoría', kind: 'event', eventStart: new Date(at(2026, 10, 12, 12)), fireAt: new Date(at(2026, 10, 12, 11, 45)), minutesBefore: 15 },
      { id: 'r2', eventID: 'own:b', title: 'Laboratorio', kind: 'event', eventStart: new Date(at(2026, 10, 12, 16)), fireAt: new Date(at(2026, 10, 12, 15, 30)), minutesBefore: 30 }
    ]
    const { r, sent, set } = setup({ packs: [pack('trig', 'Trigonometría', at(2026, 10, 13, 9))], reminders })
    await r.check()
    set(at(2026, 10, 12, 11, 46)); await r.check()
    expect(sent.map((n) => n.title)).toEqual(['Tutoría'])
    expect(sent[0].body).toContain('Empieza en 14 min')
    expect(sent[0].target).toMatchObject({ kind: 'calendar', eventID: 'own:a' })
    // el ordenador dormía de 12:00 a 18:30: el de las 15:30 ya no tiene sentido; el del examen (18:00) sí, y una sola vez
    set(at(2026, 10, 12, 18, 30)); await r.check()
    expect(sent.map((n) => n.title)).toEqual(['Tutoría', 'Hora de estudiar', 'Mañana: examen de Trigonometría'])
    expect(sent[2].target).toEqual({ kind: 'course', id: 'trig' })
    set(at(2026, 10, 12, 18, 40)); await r.check()
    expect(sent.length).toBe(3)
  })

  it('A4-P1-1: el examen del curso de ejemplo no avisa («Mañana: examen de Exam #2 · MATH 101»)', async () => {
    const { r, sent, set } = setup({ packs: [pack('exam-2-math112', 'Exam #2 · MATH 101', at(2026, 10, 13, 9)), pack('trig', 'Trigonometría', at(2026, 10, 13, 9))] })
    await r.check()
    set(at(2026, 10, 12, 18, 30)); await r.check()
    expect(sent.map((n) => n.title)).toContain('Mañana: examen de Trigonometría')
    expect(sent.some((n) => n.title.includes('MATH 101'))).toBe(false)
  })
})
