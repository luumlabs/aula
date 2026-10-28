// Fechas del calendario (lunes primero) con el idioma de la interfaz.
import { addDays, endOfMonth, endOfWeek, isSameDay, startOfMonth, startOfWeek } from 'date-fns'
import type { IconName } from '@renderer/design'
import type { CalEvent, CalKind } from './data'

/** El icono de cada tipo de evento. */
export const KIND_ICON: Record<CalKind, IconName> = { exam: 'exam', quiz: 'checklist', assignment: 'upload', lecture: 'users', study: 'learn', event: 'calendar' }

export const weekOpts = { weekStartsOn: 1 as const }

export function monthGrid(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), weekOpts)
  const end = endOfWeek(endOfMonth(month), weekOpts)
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

export function eventsOn(events: CalEvent[], day: Date): CalEvent[] {
  return events
    .filter((e) => isSameDay(e.start, day) || (e.end && e.start < day && e.end > addDays(day, 1) && e.allDay))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
}

export const isAssessment = (e: CalEvent) => e.kind === 'exam' || e.kind === 'quiz'
