// Textos de las automatizaciones en la interfaz (con i18n): horarios en palabras, fechas cercanas, iconos de cada tipo.
import type { TFunction } from 'i18next'
import i18n from '@renderer/i18n'
import type { IconName } from '@renderer/design'
import { ICON_PATHS } from '@renderer/design/icons/paths'
import { WEEKDAYS, effectiveEventKinds, effectiveInterval, type AutomationOutcome, type AutomationSchedule, type InboxKind, type ProactiveRoutine } from '@shared/automations'

const loc = () => (i18n.language === 'es' ? 'es-ES' : 'en-US')

export function list(items: string[]): string {
  try {
    return new Intl.ListFormat(loc(), { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

/** «8:00» de una hora «HH:mm». */
export function timeDisplay(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5, h || 0, m || 0))
}

/** Nombre del día (1 = domingo). */
export function weekdayName(d: number, style: 'long' | 'short' | 'narrow' = 'long'): string {
  return new Intl.DateTimeFormat(loc(), { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2026, 0, 3 + Math.max(1, Math.min(7, d))))
}

export function weekdaysPhrase(t: TFunction, days: readonly number[]): string {
  const set = new Set(days.length ? days : WEEKDAYS.all)
  const same = (xs: number[]) => xs.length === set.size && xs.every((d) => set.has(d))
  if (same(WEEKDAYS.all)) return t('inbox:schedule.everyDay')
  if (same(WEEKDAYS.schoolDays)) return t('inbox:schedule.weekdays')
  if (same(WEEKDAYS.weekend)) return t('inbox:schedule.weekend')
  return list(WEEKDAYS.mondayFirst.filter((d) => set.has(d)).map((d) => weekdayName(d)))
}

export function hoursText(t: TFunction, h: number): string {
  if (h >= 48 && h % 24 === 0) return t('inbox:schedule.days', { count: h / 24 })
  if (h < 1) return t('inbox:schedule.minutes', { count: Math.round(h * 60) })
  return `${new Intl.NumberFormat(loc(), { maximumFractionDigits: 1 }).format(h)} h`
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase(loc()) + s.slice(1)

/** «Todos los días a las 8:00», «Cada 8 h, de 8:00 a 22:00», «24 h y 2 h antes de entregas y exámenes». */
export function scheduleSummary(t: TFunction, s: AutomationSchedule): string {
  switch (s.kind) {
    case 'daily':
      return cap(t('inbox:schedule.dailyAt', { days: weekdaysPhrase(t, s.weekdays), times: list([...new Set(s.times)].sort().map(timeDisplay)) }))
    case 'interval': {
      const base = t('inbox:schedule.every', { hours: new Intl.NumberFormat(loc(), { maximumFractionDigits: 1 }).format(effectiveInterval(s)), from: timeDisplay(s.windowStart), to: timeDisplay(s.windowEnd) })
      return s.weekdays.length === 0 || s.weekdays.length === 7 ? base : `${base} · ${weekdaysPhrase(t, s.weekdays)}`
    }
    case 'once':
      return s.date ? t('inbox:schedule.once', { when: whenText(t, s.date) }) : t('inbox:schedule.onceEmpty')
    case 'beforeEvents': {
      const kinds = effectiveEventKinds(s)
      const what = kinds.size === 1 && kinds.has('assignment') ? t('inbox:schedule.whatAssign') : [...kinds].every((k) => k === 'exam' || k === 'quiz') ? t('inbox:schedule.whatExams') : t('inbox:schedule.whatBoth')
      return cap(t('inbox:schedule.before', { hours: list(s.hoursBefore.filter((h) => h > 0).sort((a, b) => b - a).map((h) => hoursText(t, h))), what }))
    }
  }
}

function dayDiff(d: Date, now = new Date()): number {
  const a = new Date(d), b = new Date(now)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}

/** «hoy a las 20:00», «mañana a las 8:00», «el jueves a las 10:00», «el jueves, 22 de octubre a las 10:00». */
export function whenText(t: TFunction, iso: string, now = new Date()): string {
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit' }).format(d)
  const diff = dayDiff(d, now)
  if (diff === 0) return t('inbox:when.today', { time })
  if (diff === 1) return t('inbox:when.tomorrow', { time })
  const day = new Intl.DateTimeFormat(loc(), diff > 0 && diff < 7 ? { weekday: 'long' } : { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
  return t('inbox:when.day', { day, time })
}

/** La hora de una fila: «9:41» hoy, «ayer», «lun», «12 oct». */
export function rowTime(t: TFunction, iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = dayDiff(d, now)
  if (diff === 0) return new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit' }).format(d)
  if (diff === -1) return t('inbox:when.yesterday')
  if (diff > -7) return new Intl.DateTimeFormat(loc(), { weekday: 'short' }).format(d).replace('.', '')
  return new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short' }).format(d).replace('.', '')
}

export const KIND_ICONS: Record<InboxKind, IconName> = {
  platform: 'inbox', reminder: 'bell', summary: 'today', offer: 'exam', followup: 'repeat', automation: 'history', system: 'aula', problem: 'alert', digest: 'layers'
}

export const ROUTINE_ICONS: Record<ProactiveRoutine, IconName> = {
  morningBrief: 'today', platformCheck: 'inbox', deadlineReminders: 'bell', examOffers: 'exam', weeklySummary: 'calendar'
}

/** El icono que manda el proceso principal (si no existe, uno neutro). */
export function iconOr(name: string | undefined, fallback: IconName): IconName {
  return name && name in ICON_PATHS ? (name as IconName) : fallback
}

/** El tono del último resultado (solo lo que pide atención). */
export function outcomeTone(o: AutomationOutcome | undefined): string | null {
  switch (o) {
    case 'news': case 'conditionMet': return 'var(--info)'
    case 'failed': return 'var(--danger)'
    case 'needsSignIn': case 'budget': return 'var(--warning)'
    default: return null
  }
}
