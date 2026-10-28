// Qué hoja de evento está abierta (una sola en toda la app): la de un evento (por su id completo, con su vista si ya se
// tiene) o la de uno nuevo. La abren el mes, la semana, la agenda, el panel del día y «Tu semana» de Inicio.
import { create } from 'zustand'
import type { CalendarEventView } from '@shared/calendar'

export type EventSheetRequest =
  | { mode: 'event'; id: string; view?: CalendarEventView }
  | { mode: 'new'; start: Date; allDay?: boolean }

interface EventSheetState {
  request: EventSheetRequest | null
  /** Cambia con cada apertura (para empezar el formulario de cero). */
  seq: number
  open: (r: EventSheetRequest) => void
  close: () => void
}

export const useEventSheet = create<EventSheetState>((set, get) => ({
  request: null,
  seq: 0,
  open: (request) => set({ request, seq: get().seq + 1 }),
  close: () => set({ request: null })
}))

/** Abre la hoja de un evento (id completo: `own:abc#20261026T100000`, `platform:…`, `course:…`). */
export function openEventSheet(id: string, view?: CalendarEventView): void {
  useEventSheet.getState().open({ mode: 'event', id, ...(view ? { view } : {}) })
}

/** Abre la hoja vacía para añadir un evento ese día: hoy, a la próxima hora en punto; otro día, a las 10. */
export function openNewEventSheet(day: Date = new Date(), opts: { allDay?: boolean } = {}): void {
  const now = new Date()
  const start = new Date(day)
  if (start.toDateString() === now.toDateString()) start.setHours(Math.min(22, now.getHours() + 1), 0, 0, 0)
  else start.setHours(10, 0, 0, 0)
  useEventSheet.getState().open({ mode: 'new', start, ...(opts.allDay ? { allDay: true } : {}) })
}
