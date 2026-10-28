// Calendarios a los que te suscribes con un enlace .ics (webcal:// o https://): el horario de la universidad, tu Google
// Calendar, los festivos… Como el calendario de una plataforma: el enlace es el secreto y va al almacén cifrado
// (`calendar.subscription.<id>`), nunca al registro ni a la interfaz. Aquí solo el nombre, el servidor y cómo fue la última
// lectura (`<datos>/calendar-subscriptions.json`); lo leído se guarda en `<datos>/Calendars/<id>.ics` para verlo sin conexión.
// Se vuelve a leer cada cierto tiempo y cuando lo pide el estudiante: si falla, siguen los eventos de la última lectura buena.
// Sus eventos son de solo lectura (como los de una plataforma) y llevan como «plataforma» el id de la suscripción.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CALENDAR_SUBSCRIPTION_PREFIX, isSubscriptionID, type CalendarSubscribeInput, type CalendarSubscriptionView } from '@shared/calendar'
import { feedHost, ICSLimitError, normalizeFeedURL, parseICS, parseLine, unescapeText, unfold, type StudyEvent } from '@engine/calendar/ics'
import type { CampusEvent } from '@engine/calendar'
import { IDs } from '@engine/base/ids'
import { SecretMask } from '@engine/platforms'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { readJSON, writeFileAtomic, writeJSONAtomic } from '../fs'
import { log } from '../log'
import { secrets as defaultSecrets, type SecretStore } from '../secrets'
import { CalendarFeedError, fetchICSBytes, type FetchLike } from './feeds'
import { campusEventFrom } from './sources'

export const SUBSCRIPTIONS_FILE = 'calendar-subscriptions.json'
export const SUBSCRIPTION_CACHE_DIR = 'Calendars'
/** Tope de suscripciones (cada una se descarga en cada actualización). */
export const MAX_SUBSCRIPTIONS = 20
/** Lo leído se vuelve a interpretar cada día (las series sin fin se expanden desde «hoy»). */
const REPARSE_MS = 24 * 3_600_000

export function subscriptionSecretKey(id: string): string {
  return `calendar.subscription.${id}`
}

interface SubscriptionRecord {
  id: string
  name: string
  host: string
  added: string
  refreshedAt?: string
  attemptedAt?: string
  error?: string
  errorCode?: string
  events: number
}

interface SubscriptionsFile {
  schema: 1
  subscriptions: SubscriptionRecord[]
}

/** De dónde saca el calendario los eventos de las suscripciones (sin red: lo último leído). */
export interface SubscriptionEventSource {
  /** Los eventos entre dos instantes (de la copia guardada). */
  events(from: Date, to: Date): CampusEvent[]
  /** Vuelve a leerlas todas ahora. */
  refreshAll?(): Promise<unknown>
}

export interface CalendarSubscriptionsOptions {
  /** Carpeta de datos de Aula. */
  root: string
  secrets?: () => SecretStore
  fetch?: FetchLike
  now?: () => Date
  /** Zona de las horas flotantes y de los eventos de todo el día. */
  timeZone?: string
  newID?: () => string
}

export const SubscriptionErrors = {
  invalidURL: () => new AulaError('calendar_invalid_url', tr(
    'El enlace no es válido. Pega la dirección del calendario: empieza por webcal:// o https:// (en Google Calendar: Configuración → Integrar calendario → «Dirección secreta en formato iCal»).',
    'That link isn’t valid. Paste the calendar’s address: it starts with webcal:// or https:// (in Google Calendar: Settings → Integrate calendar → “Secret address in iCal format”).'
  )),
  duplicate: (name: string) => new AulaError('calendar_duplicate', tr(`Ya estás suscrito a ese calendario («${name}»).`, `You’re already subscribed to that calendar (“${name}”).`)),
  tooMany: () => new AulaError('calendar_too_many', tr(`Como mucho ${MAX_SUBSCRIPTIONS} suscripciones. Quita alguna que ya no uses.`, `At most ${MAX_SUBSCRIPTIONS} subscriptions. Remove one you no longer use.`)),
  notFound: () => new AulaError('not_found', tr('Esa suscripción ya no existe.', 'That subscription no longer exists.')),
  missingLink: () => new AulaError('calendar_missing_link', tr(
    'No se encuentra el enlace de esta suscripción (¿se borraron los secretos?). Quítala y vuelve a suscribirte.',
    'This subscription’s link can’t be found (were the secrets deleted?). Remove it and subscribe again.'
  )),
  badName: () => new AulaError('invalid_args', tr('Ponle un nombre a la suscripción.', 'Give the subscription a name.'))
}

/** El nombre que trae el calendario (`X-WR-CALNAME`), si lo trae. */
export function calendarNameOf(data: Uint8Array | string): string | null {
  for (const line of unfold(data).slice(0, 400)) {
    const p = parseLine(line)
    if (p?.name === 'BEGIN' && p.value.trim().toUpperCase() === 'VEVENT') break
    if (p?.name === 'X-WR-CALNAME') {
      const name = unescapeText(p.value).trim()
      if (name) return Array.from(name).slice(0, 80).join('')
    }
  }
  return null
}

/** Junta las fechas de las plataformas con las de las suscripciones sin repetir: un evento que ya llega de una plataforma
 *  (o de otra suscripción) con el mismo UID y el mismo inicio no sale dos veces. */
export function mergeFeedEvents(platform: CampusEvent[], subscribed: CampusEvent[]): CampusEvent[] {
  const key = (e: CampusEvent) => `${e.id}|${e.start.getTime()}`
  const seen = new Set(platform.map(key))
  const out = [...platform]
  for (const e of subscribed) {
    const k = key(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

function toView(r: SubscriptionRecord): CalendarSubscriptionView {
  const v: CalendarSubscriptionView = { id: r.id, name: r.name, host: r.host, added: r.added, events: r.events }
  if (r.refreshedAt) v.refreshedAt = r.refreshedAt
  if (r.attemptedAt) v.attemptedAt = r.attemptedAt
  if (r.error) v.error = r.error
  if (r.errorCode) v.errorCode = r.errorCode
  return v
}

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const t = name.replace(/\s+/g, ' ').trim()
  return t ? Array.from(t).slice(0, 80).join('') : null
}

export class CalendarSubscriptions implements SubscriptionEventSource {
  readonly root: string
  private readonly secrets: () => SecretStore
  private readonly fetch?: FetchLike
  private readonly now: () => Date
  private readonly tz?: string
  private readonly newID: () => string
  private parsed = new Map<string, { at: number; events: CampusEvent[] }>()
  private inflight = new Map<string, Promise<CalendarSubscriptionView>>()

  constructor(opts: CalendarSubscriptionsOptions) {
    this.root = opts.root
    this.secrets = opts.secrets ?? defaultSecrets
    this.fetch = opts.fetch
    this.now = opts.now ?? (() => new Date())
    this.tz = opts.timeZone
    this.newID = opts.newID ?? (() => CALENDAR_SUBSCRIPTION_PREFIX + IDs.short(8))
  }

  get fileURL(): string { return join(this.root, SUBSCRIPTIONS_FILE) }
  cacheFile(id: string): string { return join(this.root, SUBSCRIPTION_CACHE_DIR, `${id}.ics`) }

  // MARK: Archivo

  private read(): SubscriptionRecord[] {
    const raw = readJSON<Partial<SubscriptionsFile>>(this.fileURL)
    const list = Array.isArray(raw?.subscriptions) ? raw.subscriptions : []
    return list.filter((r): r is SubscriptionRecord => !!r && typeof r === 'object' && isSubscriptionID(r.id) && typeof r.name === 'string')
      .map((r) => ({ ...r, host: typeof r.host === 'string' ? r.host : '?', added: typeof r.added === 'string' ? r.added : this.now().toISOString(), events: typeof r.events === 'number' ? r.events : 0 }))
  }

  private write(list: SubscriptionRecord[]): void {
    writeJSONAtomic(this.fileURL, { schema: 1, subscriptions: list } satisfies SubscriptionsFile)
  }

  private update(id: string, fn: (r: SubscriptionRecord) => void): SubscriptionRecord {
    const list = this.read()
    const r = list.find((x) => x.id === id)
    if (!r) throw SubscriptionErrors.notFound()
    fn(r)
    for (const k of Object.keys(r) as (keyof SubscriptionRecord)[]) if (r[k] === undefined) delete r[k]
    this.write(list)
    return r
  }

  // MARK: Leer

  /** Las suscripciones (sin los enlaces). */
  list(): CalendarSubscriptionView[] {
    return this.read().map(toView)
  }

  /** ¿Hay alguna? */
  isConfigured(): boolean {
    return this.read().length > 0
  }

  /** Interpreta lo leído (con los topes de `ICS_LIMITS`: un calendario que se pasa da un `AulaError` con su código). */
  private parse(data: Uint8Array, r: Pick<SubscriptionRecord, 'id' | 'name'>): CampusEvent[] {
    let list: StudyEvent[]
    try {
      list = parseICS(data, { now: this.now(), timeZone: this.tz })
    } catch (err) {
      if (err instanceof ICSLimitError) throw new AulaError(err.code, err.message)
      throw err
    }
    return list.map((e) => campusEventFrom(e, { accountId: r.id, label: r.name }))
  }

  /** Los eventos de una suscripción (de la copia guardada; se interpreta una vez al día). */
  private cached(r: SubscriptionRecord): CampusEvent[] {
    const hit = this.parsed.get(r.id)
    const now = this.now().getTime()
    if (hit && now - hit.at < REPARSE_MS) return hit.events
    const file = this.cacheFile(r.id)
    if (!existsSync(file)) return []
    let events: CampusEvent[] = []
    try {
      events = this.parse(readFileSync(file), r)
    } catch (err) {
      log.warn(`Calendario: no se pudo leer la copia de la suscripción ${r.id}`, err)
    }
    this.parsed.set(r.id, { at: now, events })
    return events
  }

  /** Todos los eventos de las suscripciones entre dos instantes (sin red). */
  events(from: Date, to: Date): CampusEvent[] {
    const out: CampusEvent[] = []
    for (const r of this.read()) {
      for (const e of this.cached(r)) if (e.start.getTime() >= from.getTime() && e.start.getTime() <= to.getTime()) out.push({ ...e, platformLabel: r.name })
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime())
  }

  // MARK: Escribir

  /** Se suscribe: comprueba el enlace, lo lee una vez (si falla, no se guarda nada) y guarda el enlace en el almacén cifrado. */
  async add(input: CalendarSubscribeInput): Promise<CalendarSubscriptionView> {
    const url = typeof input?.url === 'string' ? normalizeFeedURL(input.url) : null
    if (!url) throw SubscriptionErrors.invalidURL()
    const list = this.read()
    if (list.length >= MAX_SUBSCRIPTIONS) throw SubscriptionErrors.tooMany()
    const store = this.secrets()
    const same = list.find((r) => store.get(subscriptionSecretKey(r.id))?.toLowerCase() === url.toLowerCase())
    if (same) throw SubscriptionErrors.duplicate(same.name)
    const data = await fetchICSBytes(url, { fetch: this.fetch, now: this.now(), timeZone: this.tz })
    const id = this.newID()
    const now = this.now().toISOString()
    const name = cleanName(input.name) ?? calendarNameOf(data) ?? feedHost(url)
    const r: SubscriptionRecord = { id, name, host: feedHost(url), added: now, refreshedAt: now, attemptedAt: now, events: 0 }
    const events = this.parse(data, r)
    r.events = events.length
    store.set(subscriptionSecretKey(id), url)
    writeFileAtomic(this.cacheFile(id), data)
    this.parsed.set(id, { at: this.now().getTime(), events })
    this.write([...this.read(), r])
    log.info(`[calendario] suscripción nueva (${id}: ${SecretMask.url(url)}, ${events.length} eventos)`)
    return toView(r)
  }

  /** Cambia el nombre. */
  rename(id: string, name: string): CalendarSubscriptionView {
    const clean = cleanName(name)
    if (!clean) throw SubscriptionErrors.badName()
    return toView(this.update(id, (r) => { r.name = clean }))
  }

  /** Quita la suscripción: su enlace, su copia y sus eventos. */
  remove(id: string): void {
    const list = this.read()
    if (!list.some((r) => r.id === id)) throw SubscriptionErrors.notFound()
    this.write(list.filter((r) => r.id !== id))
    try { this.secrets().delete(subscriptionSecretKey(id)) } catch (err) { log.warn('Calendario: no se pudo borrar el enlace de la suscripción', err) }
    rmSync(this.cacheFile(id), { force: true })
    this.parsed.delete(id)
  }

  /** Vuelve a leer una suscripción. Si falla, se apunta el error y siguen los eventos de la última lectura buena. */
  refresh(id: string): Promise<CalendarSubscriptionView> {
    const running = this.inflight.get(id)
    if (running) return running
    const p = this.doRefresh(id).finally(() => this.inflight.delete(id))
    this.inflight.set(id, p)
    return p
  }

  private async doRefresh(id: string): Promise<CalendarSubscriptionView> {
    const r = this.read().find((x) => x.id === id)
    if (!r) throw SubscriptionErrors.notFound()
    const url = this.secrets().get(subscriptionSecretKey(id))
    let data: Uint8Array | null = null
    let failure: { message: string; code: string } | null = null
    if (!url) {
      const e = SubscriptionErrors.missingLink()
      failure = { message: e.message, code: e.code }
    } else {
      try {
        data = await fetchICSBytes(url, { fetch: this.fetch, now: this.now(), timeZone: this.tz })
      } catch (err) {
        failure = { message: err instanceof Error ? err.message : String(err), code: err instanceof CalendarFeedError || err instanceof AulaError ? err.code : 'network' }
      }
    }
    const now = this.now().toISOString()
    if (!data) {
      log.warn(`[calendario] la suscripción ${id} no se pudo leer (${failure?.code})`)
      return toView(this.update(id, (x) => { x.attemptedAt = now; x.error = failure?.message; x.errorCode = failure?.code }))
    }
    let events: CampusEvent[]
    try {
      events = this.parse(data, r)
    } catch (err) {
      const limit = err instanceof AulaError ? err : null
      return toView(this.update(id, (x) => {
        x.attemptedAt = now
        x.error = limit?.message ?? tr('El calendario no se pudo leer.', 'The calendar couldn’t be read.')
        x.errorCode = limit?.code ?? 'not_a_calendar'
      }))
    }
    // lo nuevo sustituye a lo de antes (lo quitado en el calendario original desaparece; lo marcado como hecho sigue por su id)
    writeFileAtomic(this.cacheFile(id), data)
    this.parsed.set(id, { at: this.now().getTime(), events })
    return toView(this.update(id, (x) => { x.attemptedAt = now; x.refreshedAt = now; x.error = undefined; x.errorCode = undefined; x.events = events.length }))
  }

  /** Vuelve a leer todas (o solo las que no se intentaron en `olderThanMs`). Devuelve si cambió algo que enseñar. */
  async refreshAll(opts: { olderThanMs?: number } = {}): Promise<{ refreshed: CalendarSubscriptionView[] }> {
    const now = this.now().getTime()
    const due = this.read().filter((r) => opts.olderThanMs === undefined || !r.attemptedAt || now - Date.parse(r.attemptedAt) >= opts.olderThanMs)
    const refreshed = await Promise.all(due.map((r) => this.refresh(r.id).catch(() => null)))
    return { refreshed: refreshed.filter((x): x is CalendarSubscriptionView => x !== null) }
  }

  /** El título de un evento de una suscripción (para los mensajes). */
  title(platformEventID: string): string | undefined {
    for (const r of this.read()) {
      const prefix = `platform:${r.id}:`
      if (!platformEventID.startsWith(prefix)) continue
      const uid = platformEventID.slice(prefix.length)
      return this.cached(r).find((e) => e.id === uid)?.title
    }
    return undefined
  }
}

/** Vuelve a leer las suscripciones cada `everyMs` (las que no se leyeron en `maxAgeMs`) y avisa si se leyó alguna. */
export function startSubscriptionRefresh(subs: Pick<CalendarSubscriptions, 'refreshAll'>, opts: { everyMs?: number; maxAgeMs?: number; firstAfterMs?: number; onRefreshed?: () => void } = {}): { stop(): void } {
  const every = opts.everyMs ?? 15 * 60_000
  const maxAge = opts.maxAgeMs ?? 60 * 60_000
  let stopped = false
  let running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const r = await subs.refreshAll({ olderThanMs: maxAge })
      if (!stopped && r.refreshed.length) opts.onRefreshed?.()
    } catch (err) {
      log.warn('Calendario: no se pudieron actualizar las suscripciones', err)
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void tick(), opts.firstAfterMs ?? 20_000)
  const timer = setInterval(() => void tick(), every)
  first.unref?.()
  timer.unref?.()
  return {
    stop() {
      stopped = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }
}
