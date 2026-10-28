// Textos de lo que Aula hace sola (notificaciones, mensajes del chat, historial) en el idioma de la interfaz (es/en, con `tr`).
// Las fechas, en la zona del estudiante. La interfaz traduce lo suyo con i18next; esto es lo que nace en el proceso principal.
import { aiLocale, tr } from '@shared/ai/i18n'
import { isSameDay, addDays, wallTime } from '@engine/calendar/time'
import {
  effectiveEventKinds, effectiveInterval, WEEKDAYS, type Automation, type AutomationFinding, type AutomationSchedule, type InboxKind, type ProactiveRoutine
} from '@shared/automations'

export function locale(): string {
  return aiLocale() === 'en' ? 'en-US' : 'es-ES'
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(opts: Intl.DateTimeFormatOptions, tz: string): Intl.DateTimeFormat {
  const key = locale() + tz + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale(), { ...opts, timeZone: tz }) } catch { f = new Intl.DateTimeFormat(locale(), opts) }
    fmtCache.set(key, f)
  }
  return f
}

/** «8:00» / «8:00 PM». */
export function clock(at: number, tz: string): string {
  return fmt({ hour: 'numeric', minute: '2-digit' }, tz).format(at)
}

/** «lunes» / «Monday». */
export function weekday(at: number, tz: string): string {
  return fmt({ weekday: 'long' }, tz).format(at)
}

/** «jueves, 15 de octubre» / «Thursday, October 15». */
export function longDay(at: number, tz: string): string {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long' }, tz).format(at)
}

/** «lun 20:00». */
export function shortDayTime(at: number, tz: string): string {
  return fmt({ weekday: 'short', hour: 'numeric', minute: '2-digit' }, tz).format(at)
}

/** [«A», «B», «C»] → «A, B y C». */
export function list(items: readonly string[]): string {
  try {
    return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

export function capitalizeFirst(s: string): string {
  return s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1)
}

/** «8:00» de una hora «HH:mm» (la hora de pared tal cual, sin zona). */
export function timeDisplay(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5, h || 0, m || 0))
}

/** Nombre del día de la semana (1 = domingo). */
export function weekdayName(d: number, short = false): string {
  // 4-ene-2026 fue domingo
  return new Intl.DateTimeFormat(locale(), { weekday: short ? 'short' : 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 3 + Math.max(1, Math.min(7, d))))
}

/** «todos los días», «de lunes a viernes», «los fines de semana», «lunes, miércoles y viernes». */
export function weekdaysPhrase(days: readonly number[]): string {
  const set = new Set(days.length ? days : WEEKDAYS.all)
  const same = (xs: number[]) => xs.length === set.size && xs.every((d) => set.has(d))
  if (same(WEEKDAYS.all)) return tr('todos los días', 'every day')
  if (same(WEEKDAYS.schoolDays)) return tr('de lunes a viernes', 'Monday to Friday')
  if (same(WEEKDAYS.weekend)) return tr('los fines de semana', 'on weekends')
  return list(WEEKDAYS.mondayFirst.filter((d) => set.has(d)).map((d) => weekdayName(d)))
}

/** «24 h», «30 min», «2 días». */
export function hoursText(h: number): string {
  if (h >= 48 && h % 24 === 0) return tr(`${h / 24} días`, `${h / 24} days`)
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(h)} h`
}

/** «Todos los días a las 8:00», «Cada 8 h, de 8:00 a 22:00», «Una vez: …», «24 h y 2 h antes de entregas y exámenes». */
export function scheduleSummary(s: AutomationSchedule, tz: string): string {
  switch (s.kind) {
    case 'daily': {
      const hours = list([...new Set(s.times)].sort().map(timeDisplay))
      return tr(`${capitalizeFirst(weekdaysPhrase(s.weekdays))} a las ${hours}`, `${capitalizeFirst(weekdaysPhrase(s.weekdays))} at ${hours}`)
    }
    case 'interval': {
      const every = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(effectiveInterval(s))
      const base = tr(`Cada ${every} h, de ${timeDisplay(s.windowStart)} a ${timeDisplay(s.windowEnd)}`, `Every ${every} h, from ${timeDisplay(s.windowStart)} to ${timeDisplay(s.windowEnd)}`)
      return s.weekdays.length === 0 || s.weekdays.length === 7 ? base : base + ' · ' + weekdaysPhrase(s.weekdays)
    }
    case 'once': {
      const at = s.date ? Date.parse(s.date) : NaN
      if (Number.isNaN(at)) return tr('Una vez', 'Once')
      return tr(`Una vez: ${longDay(at, tz)}, ${clock(at, tz)}`, `Once: ${longDay(at, tz)}, ${clock(at, tz)}`)
    }
    case 'beforeEvents': {
      const hs = list(s.hoursBefore.filter((h) => h > 0).sort((a, b) => b - a).map(hoursText))
      const kinds = effectiveEventKinds(s)
      const onlyAssign = kinds.size === 1 && kinds.has('assignment')
      const onlyExams = [...kinds].every((k) => k === 'exam' || k === 'quiz')
      const what = onlyAssign ? tr('entregas', 'deadlines') : onlyExams ? tr('exámenes', 'exams') : tr('entregas y exámenes', 'deadlines and exams')
      return tr(`${hs} antes de ${what}`, `${hs} before ${what}`)
    }
  }
}

// MARK: Fechas en palabras

/** «hoy a las 23:59», «mañana a las 10:00», «el jueves a las 10:00», «el jueves 22 de octubre». */
export function when(at: number, allDay: boolean, now: number, tz: string): string {
  const time = clock(at, tz)
  if (isSameDay(at, now, tz)) return allDay ? tr('hoy', 'today') : tr(`hoy a las ${time}`, `today at ${time}`)
  if (isSameDay(at, addDays(now, 1, tz), tz)) return allDay ? tr('mañana', 'tomorrow') : tr(`mañana a las ${time}`, `tomorrow at ${time}`)
  const days = daysLeft(at, now, tz)
  const day = days < 7 ? weekday(at, tz) : longDay(at, tz)
  return allDay ? tr(`el ${day}`, `on ${day}`) : tr(`el ${day} a las ${time}`, `on ${day} at ${time}`)
}

/** «en 2 h», «en 45 min». */
export function inTime(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 90) return tr(`en ${Math.max(1, m)} min`, `in ${Math.max(1, m)} min`)
  return tr(`en ${Math.round(seconds / 3600)} h`, `in ${Math.round(seconds / 3600)} h`)
}

/** Días de calendario entre hoy y `at` (0 = hoy, 1 = mañana). */
export function daysLeft(at: number, now: number, tz: string): number {
  return wallTime(at, tz).epochDay - wallTime(now, tz).epochDay
}

// MARK: Nombres

export function findingKindTitle(kind: string): string {
  switch (kind) {
    case 'assignment': return tr('Asignación', 'Assignment')
    case 'announcement': return tr('Anuncio', 'Announcement')
    case 'material': return tr('Material', 'Material')
    case 'grade': return tr('Nota', 'Grade')
    case 'exam': return tr('Examen', 'Exam')
    case 'class': return tr('Clase', 'Class')
    case 'message': return tr('Mensaje', 'Message')
    default: return tr('Novedad', 'Update')
  }
}

export function inboxKindTitle(k: InboxKind): string {
  switch (k) {
    case 'platform': return tr('Plataforma', 'Platform')
    case 'reminder': return tr('Recordatorio', 'Reminder')
    case 'summary': return tr('Resumen', 'Summary')
    case 'offer': return tr('Examen sin preparar', 'Exam to prepare')
    case 'followup': return tr('Seguimiento', 'Follow-up')
    case 'automation': return tr('Automatización', 'Automation')
    case 'system': return 'Aula'
    case 'problem': return tr('Necesita tu ayuda', 'Needs you')
    case 'digest': return tr('Resumen de avisos', 'Notification summary')
  }
}

export function routineTitle(r: ProactiveRoutine): string {
  switch (r) {
    case 'morningBrief': return tr('Resumen de la mañana', 'Morning summary')
    case 'platformCheck': return tr('Revisión de la plataforma', 'Platform check')
    case 'deadlineReminders': return tr('Recordatorios de entregas y exámenes', 'Deadline and exam reminders')
    case 'examOffers': return tr('Exámenes sin preparar', 'Exams to prepare')
    case 'weeklySummary': return tr('Resumen semanal', 'Weekly summary')
  }
}

/** Etiqueta del origen en el chat («Rutina de la mañana»). */
export function routineOriginTitle(r: ProactiveRoutine): string {
  switch (r) {
    case 'morningBrief': return tr('Rutina de la mañana', 'Morning routine')
    case 'platformCheck': return tr('Revisión de tu plataforma', 'Check of your platform')
    case 'deadlineReminders': return tr('Recordatorio', 'Reminder')
    case 'examOffers': return tr('Se acerca un examen', 'An exam is coming up')
    case 'weeklySummary': return tr('Resumen semanal', 'Weekly summary')
  }
}

export function routineDetail(r: ProactiveRoutine): string {
  switch (r) {
    case 'morningBrief': return tr('Tus clases de hoy, lo que vence pronto y qué estudiar hoy según el plan de cada curso.', "Today's classes, what's due soon and what to study today from each course's plan.")
    case 'platformCheck': return tr('Mira qué hay nuevo en tu plataforma (materiales, anuncios, la clase de hoy) y te prepara un repasito.', "Looks at what's new on your platform (materials, announcements, today's class) and prepares a quick review.")
    case 'deadlineReminders': return tr('Te avisa antes de cada entrega y examen, y te propone prepararlo juntos.', 'Reminds you before each deadline and exam, and offers to prepare it together.')
    case 'examOffers': return tr('Si se acerca un examen y no tienes curso para él, te ofrece prepararlo con un clic.', "If an exam is coming up and you don't have a course for it, offers to prepare it in one click.")
    case 'weeklySummary': return tr('El domingo: cómo te fue la semana y qué viene.', 'On Sunday: how your week went and what is coming.')
  }
}

/** «Rutina de la mañana», «Automatización: Revisar Canvas», «Seguimiento de Aula: …». */
export function originTitle(a: Automation): string {
  if (a.routine) return routineOriginTitle(a.routine)
  if (a.origin === 'aula') return tr(`Seguimiento de Aula: ${a.title}`, `Aula follow-up: ${a.title}`)
  return tr(`Automatización: ${a.title}`, `Automation: ${a.title}`)
}

/** Icono de Aula (nombres de `design/icons`) de una automatización. */
export function automationSymbol(a: Automation): string {
  switch (a.routine) {
    case 'morningBrief': return 'today'
    case 'platformCheck': return 'inbox'
    case 'deadlineReminders': return 'bell'
    case 'examOffers': return 'exam'
    case 'weeklySummary': return 'calendar'
  }
  if (a.origin === 'aula') return 'repeat'
  if (a.schedule.kind === 'beforeEvents') return 'bell'
  if (a.schedule.kind === 'once') return 'clock'
  return a.capabilities.includes('platform') ? 'globe' : 'history'
}

/** «1 asignación nueva: «Tarea 3»», «3 novedades: «A», «B» y 1 más», «Cambió la fecha de «Tarea 1»». */
export function headline(news: readonly AutomationFinding[], changed: readonly AutomationFinding[]): string | null {
  if (!news.length && !changed.length) return null
  const q = (t: string) => `«${t}»`
  if (news.length) {
    const titles = news.slice(0, 2).map((f) => q(f.title))
    const more = news.length > 2 ? [tr(`${news.length - 2} más`, `${news.length - 2} more`)] : []
    const l = list([...titles, ...more])
    const kinds = new Set(news.map((f) => f.kind))
    const n = news.length
    const only = (k: string) => kinds.size === 1 && kinds.has(k)
    if (only('assignment')) return n === 1 ? tr(`1 asignación nueva: ${l}`, `1 new assignment: ${l}`) : tr(`${n} asignaciones nuevas: ${l}`, `${n} new assignments: ${l}`)
    if (only('announcement')) return n === 1 ? tr(`1 anuncio nuevo: ${l}`, `1 new announcement: ${l}`) : tr(`${n} anuncios nuevos: ${l}`, `${n} new announcements: ${l}`)
    if (only('material')) return n === 1 ? tr(`1 material nuevo: ${l}`, `1 new material: ${l}`) : tr(`${n} materiales nuevos: ${l}`, `${n} new materials: ${l}`)
    return n === 1 ? tr(`1 novedad: ${l}`, `1 update: ${l}`) : tr(`${n} novedades: ${l}`, `${n} updates: ${l}`)
  }
  return tr(`Cambió la fecha de ${list(changed.slice(0, 2).map((f) => q(f.title)))}`, `The date of ${list(changed.slice(0, 2).map((f) => q(f.title)))} changed`)
}

/** La primera línea con contenido, sin marcas. */
export function firstLine(md: string): string {
  const plain = md.replace(/```[\s\S]*?```/g, ' ').replace(/\*\*/g, '').replace(/_/g, '')
  return plain.split(/\r?\n/).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).find((l) => l) ?? ''
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}
