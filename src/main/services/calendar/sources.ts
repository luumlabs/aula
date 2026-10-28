// Las fechas de las plataformas (LiveCampus.swift): los calendarios .ics privados que se guardaron al conectar cada cuenta
// (Canvas, Moodle, Blackboard…; uno o varios enlaces por cuenta, uno por línea, en el almacén de secretos). Se leen a la vez
// y se juntan sin repetir. Los enlaces nunca salen de aquí (ni a la IA ni a los registros).
import type { CalendarFeedStatus } from '@shared/calendar'
import type { PlatformAccount } from '@shared/settings/platforms'
import { platformSecretKeys } from '@shared/settings/platforms'
import { normalizeFeedURL, type StudyEvent } from '@engine/calendar/ics'
import type { CampusEvent } from '@engine/calendar'
import { getSettings } from '../settings'
import { secrets, type SecretStore } from '../secrets'
import { tr } from '@shared/ai/i18n'
import { fetchICSFeed, type FetchLike } from './feeds'

/** De dónde salen las fechas de las plataformas (se puede sustituir en las pruebas, o sumar la API de Canvas). */
export interface PlatformEventSource {
  /** ¿Hay algo configurado? (sin leer los enlaces) */
  isConfigured(): boolean
  /** Todas las fechas entre dos instantes. Lanza solo si no se pudo leer nada y hubo algún error. */
  events(from: Date, to: Date): Promise<CampusEvent[]>
  /** Cómo fue la última lectura de cada calendario. */
  lastStatus?(): CalendarFeedStatus[]
}

/** Un calendario que leer: la cuenta de la que viene y su enlace (secreto). */
export interface CalendarFeedSource {
  accountId: string
  label: string
  url: string
}

/** Los enlaces de un secreto (uno por línea). */
export function linksIn(secret: string | null | undefined): string[] {
  return (secret ?? '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
}

/** Los calendarios de las cuentas (sin repetir enlaces). */
export function feedSourcesFor(accounts: PlatformAccount[], store: SecretStore): CalendarFeedSource[] {
  const out: CalendarFeedSource[] = []
  const seen = new Set<string>()
  for (const a of accounts) {
    const key = a.calendarSecretRef ?? platformSecretKeys.calendar(a.id)
    let value: string | null = null
    try { value = store.get(key) } catch { value = null }
    for (const url of linksIn(value)) {
      const k = url.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ accountId: a.id, label: a.label, url })
    }
  }
  return out
}

/** Una fecha de un .ics como fecha de plataforma. */
export function campusEventFrom(e: StudyEvent, source: Pick<CalendarFeedSource, 'accountId' | 'label'>): CampusEvent {
  const c: CampusEvent = { id: e.id, title: e.title, start: e.start, allDay: e.allDay, isExam: e.isExam, kind: e.kind, platformID: source.accountId, platformLabel: source.label }
  if (e.course) c.course = e.course
  if (e.end) c.end = e.end
  if (e.url) c.url = e.url
  if (e.location) c.location = e.location
  if (e.descriptionText) c.details = e.descriptionText
  if (e.courseID !== null) c.courseID = e.courseID
  return c
}

export interface IcsSourceOptions {
  fetch?: FetchLike
  timeZone?: string
  now?: () => Date
}

/** Los calendarios .ics de las cuentas de las plataformas. */
export class IcsPlatformSource implements PlatformEventSource {
  private status: CalendarFeedStatus[] = []

  constructor(private readonly sources: () => CalendarFeedSource[], private readonly opts: IcsSourceOptions = {}) {}

  isConfigured(): boolean {
    return this.sources().length > 0
  }

  lastStatus(): CalendarFeedStatus[] {
    return this.status.map((s) => ({ ...s }))
  }

  async events(from: Date, to: Date): Promise<CampusEvent[]> {
    const now = this.opts.now?.() ?? new Date()
    const list = this.sources()
    let firstError: unknown = null
    const status: CalendarFeedStatus[] = []
    const results = await Promise.all(list.map(async (source) => {
      if (!normalizeFeedURL(source.url)) {
        status.push({ accountId: source.accountId, label: source.label, ok: false, error: tr('El enlace del calendario no es válido.', 'The calendar link isn’t valid.'), events: 0 })
        return [] as CampusEvent[]
      }
      try {
        const evs = (await fetchICSFeed(normalizeFeedURL(source.url)!, { fetch: this.opts.fetch, now, timeZone: this.opts.timeZone }))
          .filter((e) => e.start.getTime() >= from.getTime() && e.start.getTime() <= to.getTime())
        status.push({ accountId: source.accountId, label: source.label, ok: true, events: evs.length })
        return evs.map((e) => campusEventFrom(e, source))
      } catch (err) {
        firstError = firstError ?? err
        status.push({ accountId: source.accountId, label: source.label, ok: false, error: err instanceof Error ? err.message : String(err), events: 0 })
        return [] as CampusEvent[]
      }
    }))
    this.status = status
    const out = results.flat()
    if (!out.length && firstError) throw firstError
    const seen = new Set<string>()
    return out.sort((a, b) => a.start.getTime() - b.start.getTime()).filter((e) => {
      const key = `${e.platformID ?? ''}:${e.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

/** Los calendarios de las cuentas de Ajustes (con sus enlaces en el almacén de secretos). */
export function settingsPlatformSource(opts: IcsSourceOptions = {}): IcsPlatformSource {
  return new IcsPlatformSource(() => {
    try {
      return feedSourcesFor(getSettings().platforms.accounts, secrets())
    } catch {
      return []
    }
  }, opts)
}
