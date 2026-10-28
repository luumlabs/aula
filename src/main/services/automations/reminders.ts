// Recordatorios de estudio (StudyReminders.swift + los avisos de los eventos del calendario): «Hora de estudiar» cada día a la
// hora elegida, «Mañana: examen de…» el día antes de cada examen de un curso y los avisos que el estudiante puso en sus eventos.
// Funcionan con la app abierta (y en segundo plano con «Aula siempre activa»), sin nada que configurar. En la app Swift los
// programaba el sistema; aquí los lanza Aula: se guarda lo ya avisado (`Automations/reminders.json`) y, al volver de dormir,
// se recupera lo perdido si aún tiene sentido (nunca una tanda de avisos viejos).
import { tr } from '@shared/ai/i18n'
import type { GeneralSettings } from '@shared/settings'
import type { HomeSummary } from '@shared/ipc/home'
import type { PackSummary } from '@shared/schema/library'
import { isSampleCourse } from '@shared/samples'
import { addDays, startOfDay, wallTime } from '@engine/calendar/time'
import { atMinutes, dayKey, parseTime, timeMinutes } from '@shared/automations'
import { log } from '../log'
import type { AutomationStore } from './store'
import { clock, list } from './texts'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** A dónde lleva el aviso al tocarlo. */
export type ReminderTarget = { kind: 'home' } | { kind: 'course'; id: string } | { kind: 'calendar'; eventID: string; date: string }

export interface StudyReminderNotice {
  /** Estable: el mismo aviso tiene el mismo id. */
  id: string
  title: string
  body: string
  target: ReminderTarget
}

/** Un aviso del calendario (lo da `calendarService().pendingReminders`). */
export interface CalendarReminderLike {
  id: string
  eventID: string
  title: string
  kind: string
  eventStart: Date
  fireAt: Date
  minutesBefore: number
}

interface Planned {
  key: string
  at: number
  /** Hasta cuánto tarde todavía tiene sentido. */
  window: number
  kind: 'daily' | 'exam' | 'event'
  pack?: PackSummary
  reminder?: CalendarReminderLike
}

export interface StudyRemindersOptions {
  store: AutomationStore
  settings: () => GeneralSettings
  packs: () => PackSummary[]
  studySummary: () => Promise<HomeSummary | null>
  calendarReminders: (from: Date, to: Date) => CalendarReminderLike[]
  notify: (n: StudyReminderNotice) => void
  timeZone: () => string
  clock?: () => number
}

interface RemindersFile {
  lastCheck?: string
  fired: Record<string, string>
}

export class StudyReminders {
  private readonly o: StudyRemindersOptions
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private checking: Promise<void> | null = null

  constructor(o: StudyRemindersOptions) {
    this.o = o
    this.now = o.clock ?? (() => Date.now())
  }

  private read(): RemindersFile {
    const raw = this.o.store.readExtra(this.o.store.remindersFile) as Partial<RemindersFile> | undefined
    const fired: Record<string, string> = {}
    if (raw && typeof raw.fired === 'object' && raw.fired) for (const [k, v] of Object.entries(raw.fired)) if (typeof v === 'string') fired[k] = v
    return { ...(typeof raw?.lastCheck === 'string' ? { lastCheck: raw.lastCheck } : {}), fired }
  }

  private write(f: RemindersFile): void {
    this.o.store.writeExtra(this.o.store.remindersFile, f)
  }

  /** Lo que toca entre dos instantes. */
  plan(from: number, to: number): Planned[] {
    const tz = this.o.timeZone()
    const s = this.o.settings()
    const out: Planned[] = []
    const minutes = timeMinutes(parseTime(s.reminderTime) ?? '18:00')
    if (s.reminders) {
      // cada día a la hora elegida
      for (let d = startOfDay(from, tz).getTime(), i = 0; d <= to && i < 40; d = addDays(d, 1, tz).getTime(), i++) {
        const at = atMinutes(d, minutes, tz)
        if (at > from && at <= to) out.push({ key: 'daily:' + dayKey(at, tz), at, window: 2 * HOUR, kind: 'daily' })
      }
      // el día antes de cada examen, a la misma hora
      for (const p of this.o.packs()) {
        const exam = p.examDate ? Date.parse(p.examDate) : NaN
        // el examen de un curso de ejemplo no es del estudiante (A4-P1-1)
        if (Number.isNaN(exam) || isSampleCourse(p.id)) continue
        const at = atMinutes(exam, minutes, tz, -1)
        if (at > from && at <= to && at < exam) out.push({ key: `exam:${p.id}:${dayKey(exam, tz)}`, at, window: 12 * HOUR, kind: 'exam', pack: p })
      }
    }
    // los avisos que el estudiante puso en sus eventos
    try {
      for (const r of this.o.calendarReminders(new Date(from), new Date(to))) {
        const at = r.fireAt.getTime()
        if (at > from && at <= to) out.push({ key: 'event:' + r.id, at, window: Math.min(HOUR, Math.max(10 * MIN, r.minutesBefore * MIN)), kind: 'event', reminder: r })
      }
    } catch (err) {
      log.warn('Recordatorios: calendario', err)
    }
    return out.sort((a, b) => a.at - b.at)
  }

  /** Avisa de lo que toca (y recupera lo perdido si aún tiene sentido). */
  async check(): Promise<void> {
    if (this.checking) return this.checking
    this.checking = this.checkInner().finally(() => { this.checking = null })
    return this.checking
  }

  private async checkInner(): Promise<void> {
    const now = this.now()
    const file = this.read()
    const last = file.lastCheck ? Date.parse(file.lastCheck) : NaN
    // la primera vez (o tras mucho tiempo cerrada) no se recupera nada viejo
    const from = Number.isNaN(last) || last > now ? now - 2 * MIN : Math.max(last, now - 13 * HOUR)
    const due = this.plan(from, now).filter((p) => !file.fired[p.key] && now - p.at <= p.window)
    let study: HomeSummary | null | undefined
    for (const p of due) {
      file.fired[p.key] = new Date(now).toISOString()
      if (p.kind === 'daily') {
        if (study === undefined) study = await this.o.studySummary().catch(() => null)
        const n = this.dailyNotice(p, study)
        if (n) this.safeNotify(n)
      } else if (p.kind === 'exam' && p.pack) {
        this.safeNotify({
          id: 'aula.reminder.exam.' + p.pack.id, target: { kind: 'course', id: p.pack.id },
          title: tr(`Mañana: examen de ${p.pack.title}`, `Tomorrow: ${p.pack.title} exam`),
          body: tr('Haz un simulacro corto y repasa tus errores en Aula. ¡Tú puedes!', 'Do a short practice exam and review your mistakes in Aula. You can do it!')
        })
      } else if (p.kind === 'event' && p.reminder) {
        this.safeNotify(this.eventNotice(p.reminder, now))
      }
    }
    // lo ya avisado de hace más de 3 días sobra
    for (const [k, v] of Object.entries(file.fired)) if (now - Date.parse(v) > 3 * DAY) delete file.fired[k]
    file.lastCheck = new Date(now).toISOString()
    this.write(file)
  }

  private dailyNotice(p: Planned, study: HomeSummary | null): StudyReminderNotice | null {
    if (!this.o.packs().length) return null // sin cursos no hay nada que estudiar
    const goal = study?.today.minutesGoal ?? 30
    if (study && study.today.minutesDone >= goal) return null // ya cumplió la meta de hoy: no se insiste
    const cards = study?.dueCards ?? 0
    const mistakes = study?.mistakes ?? 0
    const parts = [
      cards ? tr(`${cards} ${cards === 1 ? 'tarjeta' : 'tarjetas'}`, `${cards} ${cards === 1 ? 'card' : 'cards'}`) : null,
      mistakes ? tr(`${mistakes} ${mistakes === 1 ? 'error' : 'errores'}`, `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`) : null
    ].filter((x): x is string => !!x)
    const body = parts.length
      ? tr(`Tienes ${list(parts)} por repasar. Con ${goal} minutos basta.`, `You have ${list(parts)} to review. ${goal} minutes is enough.`)
      : tr(`Tu plan de hoy te espera en Aula. Con ${goal} minutos basta.`, `Today's plan is waiting in Aula. ${goal} minutes is enough.`)
    return { id: 'aula.reminder.daily', title: tr('Hora de estudiar', 'Time to study'), body, target: { kind: 'home' } }
  }

  private eventNotice(r: CalendarReminderLike, now: number): StudyReminderNotice {
    const tz = this.o.timeZone()
    const start = r.eventStart.getTime()
    const left = Math.max(0, Math.round((start - now) / MIN))
    const sameDay = wallTime(start, tz).epochDay === wallTime(now, tz).epochDay
    const body = left < 90
      ? tr(`Empieza en ${Math.max(1, left)} min (${clock(start, tz)}).`, `Starts in ${Math.max(1, left)} min (${clock(start, tz)}).`)
      : sameDay ? tr(`Hoy a las ${clock(start, tz)}.`, `Today at ${clock(start, tz)}.`) : tr(`El ${new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: tz }).format(start)} a las ${clock(start, tz)}.`, `On ${new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(start)} at ${clock(start, tz)}.`)
    return { id: 'aula.reminder.event.' + r.id, title: r.title, body, target: { kind: 'calendar', eventID: r.eventID, date: r.eventStart.toISOString() } }
  }

  private safeNotify(n: StudyReminderNotice): void {
    try { this.o.notify(n) } catch (err) { log.warn('Recordatorios: aviso', err) }
  }

  /** La próxima vez que hay que mirar (en las próximas 36 h; si no, dentro de un rato). */
  nextWake(now: number = this.now()): number {
    const next = this.plan(now, now + 36 * HOUR)[0]
    return next ? next.at : now + 30 * MIN
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.loop()
  }

  stop(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Vuelve a calcular (cambió la hora, un curso, el calendario o se despertó el ordenador). */
  poke(): void {
    if (!this.started) return
    if (this.timer) clearTimeout(this.timer)
    void this.loop()
  }

  private async loop(): Promise<void> {
    if (!this.started) return
    try { await this.check() } catch (err) { log.warn('Recordatorios', err) }
    if (!this.started) return
    const wait = Math.max(5_000, Math.min(15 * MIN, this.nextWake() - this.now() + 500))
    this.timer = setTimeout(() => void this.loop(), wait)
    this.timer.unref?.()
  }
}
