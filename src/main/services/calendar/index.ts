// Servicio del calendario (sin `electron`): el de la carpeta de datos se crea una vez y lo comparten la interfaz (IPC), el
// planificador y el chat. También vigila `calendar.json` por si lo cambia otro proceso (el ayudante MCP de un agente).
import { existsSync, watch, type FSWatcher } from 'node:fs'
import type { CalendarChange } from '@shared/calendar'
import { CalendarError, ICSLimitError, RecurrenceParseError } from '@engine/calendar'
import { AulaError } from '../errors'
import { log } from '../log'
import { dataRoot } from '../paths'
import { StudyCalendarService, type CalendarServiceOptions } from './service'
import { settingsPlatformSource } from './sources'
import { CalendarSubscriptions } from './subscriptions'

export * from './service'
export * from './store'
export * from './feeds'
export * from './sources'
export * from './courses'
export * from './preparation'
export * from './subscriptions'

let shared: StudyCalendarService | null = null
let sharedSubscriptions: CalendarSubscriptions | null = null
const listeners = new Set<(c: CalendarChange) => void>()

/** Las suscripciones a calendarios .ics de la carpeta de datos (una sola instancia). */
export function calendarSubscriptions(): CalendarSubscriptions {
  if (!sharedSubscriptions || sharedSubscriptions.root !== dataRoot()) sharedSubscriptions = new CalendarSubscriptions({ root: dataRoot() })
  return sharedSubscriptions
}

/** Sustituye (o quita) las suscripciones compartidas (pruebas). */
export function setCalendarSubscriptions(s: CalendarSubscriptions | null): void {
  sharedSubscriptions = s
}

/** El calendario de la carpeta de datos (con los calendarios .ics de las cuentas de Ajustes y las suscripciones). */
export function calendarService(overrides: Partial<CalendarServiceOptions> = {}): StudyCalendarService {
  if (!shared) {
    shared = new StudyCalendarService({ root: dataRoot(), platforms: settingsPlatformSource(), subscriptions: calendarSubscriptions(), ...overrides })
    shared.onChange = (c) => notify(c)
  }
  return shared
}

/** Sustituye (o quita) el calendario compartido (pruebas). */
export function setCalendarService(s: StudyCalendarService | null): void {
  shared = s
  if (s) s.onChange = (c) => notify(c)
}

/** Avisa a quien escucha de un cambio del calendario que no pasa por el servicio (p. ej. una suscripción nueva). */
export function announceCalendarChange(c: CalendarChange): void {
  notify(c)
}

function notify(c: CalendarChange): void {
  for (const fn of listeners) {
    try { fn(c) } catch (err) { log.warn('Aviso de cambio del calendario', err) }
  }
}

/** Avisa de cada cambio del calendario (de este proceso o, si se vigila, de otro). Devuelve cómo dejar de escuchar. */
export function onCalendarChange(fn: (c: CalendarChange) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Vigila `calendar.json` (cambios de otros procesos). Los avisos se agrupan con una espera corta. */
export function watchCalendarFile(service: StudyCalendarService, debounceMs = 400): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null
  let lastOwnWrite = 0
  const previous = service.store.onWrite
  service.store.onWrite = () => { lastOwnWrite = Date.now(); previous?.() }
  try {
    if (existsSync(service.root)) {
      watcher = watch(service.root, (_event, name) => {
        if (name !== 'calendar.json' || Date.now() - lastOwnWrite < 1000) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; notify({ reason: 'events' }) }, debounceMs)
      })
      watcher.on('error', () => undefined)
    }
  } catch (err) {
    log.warn('Calendario: no se puede vigilar calendar.json', err)
  }
  return {
    stop() {
      if (timer) clearTimeout(timer)
      watcher?.close()
      service.store.onWrite = previous
    }
  }
}

/** Errores del calendario como `AulaError` (código estable para la interfaz). */
export function toCalendarAulaError(err: unknown): unknown {
  if (err instanceof AulaError) return err
  if (err instanceof CalendarError) return new AulaError(err.code, err.message, err.detail !== undefined ? { detail: err.detail } : undefined)
  if (err instanceof RecurrenceParseError) return new AulaError('invalid', err.message)
  if (err instanceof ICSLimitError) return new AulaError(err.code, err.message)
  return err
}
