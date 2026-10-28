// Lógica pura de la bandeja «Novedades» (AutomationInbox.swift): filtrar, agrupar por día o por tipo, contar lo no leído,
// buscar, recortar y posponer. La usan el proceso principal y la interfaz.
import { Hashing } from '@engine/base/ids'
import { localTimeZone, wallTime } from '@engine/calendar/time'
import type { InboxEntry, InboxKind } from './types'
import { atMinutes } from './time'
import { foldText } from './novelty'

/** Tope de entradas (las archivadas y leídas más antiguas salen primero). */
export const INBOX_CAPACITY = 600

const ms = (v: string | undefined): number => {
  if (!v) return 0
  const t = Date.parse(v)
  return Number.isNaN(t) ? 0 : t
}

/** Pospuesta (y aún no ha vuelto). */
export function isSnoozed(e: InboxEntry, now: number): boolean {
  return ms(e.snoozedUntil) > now
}

/** Cuenta como «sin leer» (distintivo, bandeja del sistema, barra lateral). */
export function countsAsUnread(e: InboxEntry, now: number): boolean {
  return !e.read && !e.archived && !isSnoozed(e, now)
}

export function unreadCount(entries: readonly InboxEntry[], now: number): number {
  return entries.filter((e) => countsAsUnread(e, now)).length
}

// MARK: Filtros

/** Qué se ve: abiertas, pospuestas o archivadas. */
export type InboxView = 'open' | 'snoozed' | 'archived'
/** Filtros por tipo (o «sin leer»). */
export type InboxFilter = 'all' | 'unread' | InboxKind

/** Los de Swift (Todo, Sin leer, Plataforma, Fechas, Resúmenes, Seguimientos, Pospuestas, Archivadas). */
export type SwiftInboxFilter = 'all' | 'unread' | 'platform' | 'dates' | 'summaries' | 'aula' | 'snoozed' | 'archived'

export function matchesView(e: InboxEntry, view: InboxView, now: number): boolean {
  if (view === 'archived') return e.archived
  if (view === 'snoozed') return !e.archived && isSnoozed(e, now)
  return !e.archived && !isSnoozed(e, now)
}

export function matchesFilter(e: InboxEntry, filter: InboxFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'unread') return !e.read
  return e.kind === filter
}

/** El filtro de Swift (para `markAllRead` y las pruebas portadas). */
export function matchesSwiftFilter(e: InboxEntry, filter: SwiftInboxFilter, now: number): boolean {
  if (filter === 'archived') return e.archived
  if (filter === 'snoozed') return !e.archived && isSnoozed(e, now)
  if (e.archived || isSnoozed(e, now)) return false
  switch (filter) {
    case 'all': return true
    case 'unread': return !e.read
    case 'platform': return e.kind === 'platform'
    case 'dates': return e.kind === 'reminder' || e.kind === 'offer'
    case 'summaries': return e.kind === 'summary'
    case 'aula': return e.kind === 'followup' || e.kind === 'automation' || e.kind === 'system' || e.kind === 'problem'
  }
}

function matchesQuery(e: InboxEntry, q: string): boolean {
  if (!q) return true
  return foldText([e.title, e.preview, e.course ?? '', e.source].join(' ')).includes(q)
}

/** Lo que se ve con una vista, un filtro y una búsqueda, lo más reciente primero. */
export function visibleEntries(entries: readonly InboxEntry[], opts: { view?: InboxView; filter?: InboxFilter; query?: string; now: number }): InboxEntry[] {
  const q = foldText(opts.query ?? '')
  const view = opts.view ?? 'open'
  const filter = opts.filter ?? 'all'
  return entries.filter((e) => matchesView(e, view, opts.now) && matchesFilter(e, filter) && matchesQuery(e, q)).sort((a, b) => ms(b.date) - ms(a.date))
}

/** Como `AutomationInbox.visible` de Swift (con sus filtros). */
export function visibleSwift(entries: readonly InboxEntry[], filter: SwiftInboxFilter, now: number, query = ''): InboxEntry[] {
  const q = foldText(query)
  return entries.filter((e) => matchesSwiftFilter(e, filter, now) && matchesQuery(e, q)).sort((a, b) => ms(b.date) - ms(a.date))
}

// MARK: Grupos

export type InboxSection = 'snoozedBack' | 'today' | 'yesterday' | 'week' | 'earlier'
export const INBOX_SECTIONS: readonly InboxSection[] = ['snoozedBack', 'today', 'yesterday', 'week', 'earlier']

/** Por día: «Vuelven de posponer», «Hoy», «Ayer», «Esta semana», «Antes». */
export function groupByDay(entries: readonly InboxEntry[], now: number, tz: string = localTimeZone()): { section: InboxSection; entries: InboxEntry[] }[] {
  const today = wallTime(now, tz).epochDay
  const groups = new Map<InboxSection, InboxEntry[]>()
  for (const e of entries) {
    const day = wallTime(ms(e.date), tz).epochDay
    let s: InboxSection
    if (e.resurfaced && !e.read) s = 'snoozedBack'
    else if (day === today) s = 'today'
    else if (day === today - 1) s = 'yesterday'
    else if (day >= today - 6) s = 'week'
    else s = 'earlier'
    const list = groups.get(s) ?? []
    list.push(e)
    groups.set(s, list)
  }
  return INBOX_SECTIONS.filter((s) => groups.has(s)).map((s) => ({ section: s, entries: groups.get(s)! }))
}

/** Orden de los tipos: lo que necesita al estudiante primero. */
export const INBOX_KIND_ORDER: readonly InboxKind[] = ['problem', 'reminder', 'platform', 'offer', 'followup', 'automation', 'summary', 'system', 'digest']

export function groupByKind(entries: readonly InboxEntry[]): { kind: InboxKind; entries: InboxEntry[] }[] {
  return INBOX_KIND_ORDER.map((k) => ({ kind: k, entries: entries.filter((e) => e.kind === k) })).filter((g) => g.entries.length > 0)
}

/** Recorta: primero las archivadas y leídas más antiguas. */
export function trimInbox(entries: readonly InboxEntry[]): InboxEntry[] {
  if (entries.length <= INBOX_CAPACITY) return [...entries]
  const rank = (e: InboxEntry) => (e.archived ? 0 : e.read ? 1 : 2)
  return [...entries].sort((a, b) => (rank(a) !== rank(b) ? rank(b) - rank(a) : ms(b.date) - ms(a.date))).slice(0, INBOX_CAPACITY)
}

// MARK: Texto

/** El texto de un mensaje sin los bloques de Aula ni las marcas de Markdown. */
export function plainText(md: string): string {
  return md
    .replace(/```aula-[a-z]+[\s\S]*?```/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
}

/** La primera línea con contenido, sin marcas (como mucho 220 caracteres). */
export function previewLine(md: string): string {
  let plain = plainText(md)
  for (const mark of ['**', '__', '`']) plain = plain.split(mark).join('')
  plain = plain.replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
  const line = plain.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? ''
  return line.length > 220 ? line.slice(0, 219).trimEnd() + '…' : line
}

/** Clave para no repetir lo mismo: el tipo + la automatización + el texto normalizado. */
export function inboxDedupeKey(kind: InboxKind, automationID: string | undefined, text: string): string {
  const plain = foldText(plainText(text))
  return `${kind}:${automationID ?? ''}:${Hashing.stableID(plain.slice(0, 600))}`
}

// MARK: Posponer

export type SnoozePreset = 'oneHour' | 'thisEvening' | 'tomorrow' | 'weekend' | 'nextWeek'
export const SNOOZE_PRESETS: readonly SnoozePreset[] = ['oneHour', 'thisEvening', 'tomorrow', 'weekend', 'nextWeek']

/** Cuándo vuelve con cada atajo (`null` = no tiene sentido ahora: «Esta tarde» a las 19:00, «Fin de semana» un sábado). */
export function snoozeDate(p: SnoozePreset, now: number, tz: string = localTimeZone()): number | null {
  const wd = wallTime(now, tz).weekday
  switch (p) {
    case 'oneHour':
      return now + 3_600_000
    case 'thisEvening': {
      const d = atMinutes(now, 18 * 60, tz)
      return d - now > 30 * 60_000 ? d : null
    }
    case 'tomorrow':
      return atMinutes(now, 8 * 60, tz, 1)
    case 'weekend':
      if (wd === 7 || wd === 1) return null // ya es fin de semana
      return atMinutes(now, 10 * 60, tz, 7 - wd)
    case 'nextWeek': {
      const ahead = (9 - wd) % 7 === 0 ? 7 : (9 - wd) % 7 // el próximo lunes
      return atMinutes(now, 8 * 60, tz, ahead)
    }
  }
}
