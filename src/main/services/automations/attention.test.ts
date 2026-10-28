// Presupuesto, estilos, avisos (tope por hora, silencio, al despertar, repetidos), resúmenes de avisos y la bandeja pura:
// filtros, grupos, búsqueda y posponer (port de AutomationV2Tests.swift).
import { describe, expect, it } from 'vitest'
import { makeInstant } from '@engine/calendar/time'
import {
  applyStyle, countsAsUnread, defaultProactiveSettings, groupByDay, groupByKind, limitsOf, markCustomIfEdited, snoozeDate, unreadCount, visibleEntries, visibleSwift,
  type AutomationNotice, type InboxEntry, type InboxKind, type NoticeLedger
} from '@shared/automations'
import { AutomationBudget, NoticeRouter, makeNotice, recordNotice } from './attention'
import { decodeProactive } from './codec'

const TZ = 'Europe/Madrid'
const at = (y: number, m: number, d: number, h: number, min = 0, s = 0) => makeInstant(y, m, d, h, min, s, TZ)
const isoAt = (t: number) => new Date(t).toISOString()

describe('presupuesto y estilos', () => {
  it('prioridades y estimación', () => {
    const b = new AutomationBudget(100_000, 80_000, 10_000)
    expect(b.allows(1)).toBe(true)
    expect(b.allows(0)).toBe(false) // lo de baja prioridad deja libre al menos un cuarto
    expect(b.allows(2)).toBe(true)
    const full = new AutomationBudget(100_000, 100_000, 10_000)
    expect(full.allows(1)).toBe(false)
    expect(full.exhausted).toBe(true)
    expect(full.allows(2)).toBe(true) // reserva del 25 %
    expect(new AutomationBudget(100_000, 125_000).allows(2)).toBe(false)
    expect(AutomationBudget.estimateFrom([])).toBe(AutomationBudget.defaultEstimate)
    expect(AutomationBudget.estimateFrom([1000, 9000, 3000, 2000, 50_000])).toBe(3000)
    expect(new AutomationBudget(150_000, 30_000, 6000).runsLeft).toBe(20)
  })

  it('estilos y ajustes de la v1', () => {
    let p = defaultProactiveSettings()
    expect([p.style, p.dailyTokenLimit, p.noticesPerHour, p.maxFollowupsPerDay]).toEqual(['balanced', 150_000, 2, 6])
    p = applyStyle(p, 'discreet')
    expect([p.dailyTokenLimit, p.noticesPerHour, limitsOf(p).normalSound, limitsOf(p).morningInterrupts]).toEqual([60_000, 1, false, false])
    p = applyStyle(p, 'attentive')
    expect([p.dailyTokenLimit, limitsOf(p).summariesInterrupt]).toEqual([400_000, true])
    expect(markCustomIfEdited({ ...p, dailyTokenLimit: 90_000 }).style).toBe('custom')
    const v1 = decodeProactive({ enabled: true, dailyTokenLimit: 150000, maxFollowupsPerDay: 3 })
    expect([v1.style, v1.maxFollowupsPerDay, v1.noticesPerHour]).toEqual(['balanced', 6, 2])
    const v1b = decodeProactive({ enabled: true, dailyTokenLimit: 300000, maxFollowupsPerDay: 3 })
    expect([v1b.style, v1b.dailyTokenLimit, v1b.maxFollowupsPerDay]).toEqual(['custom', 300_000, 3])
    expect(decodeProactive(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })
})

function notice(key: string, level: AutomationNotice['level'] = 'active', priority: AutomationNotice['priority'] = 1, entry?: string): AutomationNotice {
  return { ...makeNotice({ title: key, body: '', automationID: 'a', level, priority, dedupeKey: key }), ...(entry ? { entryID: entry } : {}) }
}

describe('avisos', () => {
  it('tope por hora, silencio, al despertar y repetidos', () => {
    const r = new NoticeRouter(2, { enabled: true, from: '22:30', to: '07:30' }, TZ)
    const ledger: NoticeLedger = { sent: [], held: [] }
    const t0 = at(2026, 10, 14, 10)
    expect(r.decide(notice('a'), ledger, t0)).toEqual({ type: 'post' }); recordNotice(ledger, notice('a'), t0)
    expect(r.decide(notice('a'), ledger, t0 + 60_000)).toEqual({ type: 'drop' })
    expect(r.decide(notice('b'), ledger, t0 + 60_000)).toEqual({ type: 'post' }); recordNotice(ledger, notice('b'), t0 + 60_000)
    expect(r.decide(notice('c'), ledger, t0 + 120_000)).toEqual({ type: 'hold', until: t0 + 3_600_000 })
    expect(r.decide(notice('d', 'active', 2), ledger, t0 + 120_000)).toEqual({ type: 'post' })
    expect(r.decide(notice('e', 'passive', 0), ledger, t0 + 120_000)).toEqual({ type: 'post' })
    expect(r.decide(notice('f', 'timeSensitive', 2), ledger, t0 + 120_000)).toEqual({ type: 'post' })
    expect(r.decide(notice('a'), ledger, t0 + 12 * 3_600_000 + 60_000)).toEqual({ type: 'post' })
    const night = at(2026, 10, 14, 23)
    expect(r.decide(notice('g'), ledger, night)).toEqual({ type: 'hold', until: at(2026, 10, 15, 7, 30) })
    expect(r.decide(notice('g2', 'active', 2), ledger, night)).toEqual({ type: 'hold', until: at(2026, 10, 15, 7, 30) })
    expect(r.decide(notice('h', 'timeSensitive', 2), ledger, night)).toEqual({ type: 'post' })
    const wake: NoticeLedger = { sent: [], held: [] }
    expect(r.decide(notice('i'), wake, t0, true)).toEqual({ type: 'hold', until: t0 + 180_000 })
    wake.held.push({ notice: notice('i'), until: isoAt(t0 + 180_000) })
    expect(r.decide(notice('j'), wake, t0 + 61_000, true)).toEqual({ type: 'hold', until: t0 + 180_000 })
    expect(r.decide(notice('k', 'active', 2), wake, t0, true)).toEqual({ type: 'post' })
    expect(r.decide(notice('i'), wake, t0 + 90_000)).toEqual({ type: 'drop' })
  })

  it('lo que esperaba sale en un solo resumen y sin lo ya leído', () => {
    const t0 = at(2026, 10, 14, 7, 30)
    const ledger: NoticeLedger = { sent: [], held: [] }
    ;['Tarea 4', 'Anuncio nuevo', 'Notas del parcial'].forEach((t, i) => ledger.held.push({ notice: notice(t, 'active', i === 2 ? 2 : 1, `e${i}`), until: isoAt(t0) }))
    ledger.held.push({ notice: notice('Más tarde', 'active', 1, 'e9'), until: isoAt(t0 + 3_600_000) })
    const d = NoticeRouter.release(ledger, t0, (n) => n.entryID !== 'e1')
    expect(d?.title).toBe('2 novedades de Aula')
    expect(d?.kind).toBe('digest')
    expect(d?.entryIDs).toEqual(['e2', 'e0'])
    expect(d?.body.startsWith('Notas del parcial')).toBe(true)
    expect(ledger.held.length).toBe(1)
    expect(NoticeRouter.release(ledger, t0 + 60_000, () => true)).toBeNull()
    const one = NoticeRouter.release(ledger, t0 + 3_600_000, () => true)
    expect([one?.title, one?.entryID]).toEqual(['Más tarde', 'e9'])
  })
})

describe('bandeja', () => {
  const local = (y: number, m: number, d: number, h: number, min = 0, s = 0) => at(y, m, d, h, min, s)
  function e(id: string, kind: InboxKind, date: number, o: { read?: boolean; archived?: boolean; snoozed?: number; resurfaced?: boolean; course?: string; title?: string } = {}): InboxEntry {
    return {
      id, threadID: 'aula-novedades', kind, priority: 1, title: o.title ?? id, preview: '', source: '', date: isoAt(date), read: o.read ?? false, archived: o.archived ?? false,
      resurfaced: o.resurfaced ?? false, dedupeKey: '', notified: false, ...(o.course ? { course: o.course } : {}), ...(o.snoozed ? { snoozedUntil: isoAt(o.snoozed) } : {})
    }
  }

  it('filtros, grupos, búsqueda y posponer', () => {
    const now = local(2026, 10, 14, 12) // miércoles
    const entries = [
      e('tarea', 'platform', local(2026, 10, 14, 8), { course: 'MATH112', title: 'Tárea 4: Identidades' }),
      e('recordatorio', 'reminder', local(2026, 10, 14, 9), { read: true }),
      e('resumen', 'summary', local(2026, 10, 13, 7, 45)),
      e('seguimiento', 'followup', local(2026, 10, 11, 20)),
      e('vieja', 'automation', local(2026, 10, 1, 8), { read: true, archived: true }),
      e('oferta', 'offer', local(2026, 10, 14, 7), { snoozed: local(2026, 10, 15, 8) }),
      e('volvio', 'problem', local(2026, 10, 14, 11), { resurfaced: true }),
      e('antes', 'system', local(2026, 10, 2, 8), { read: true })
    ]
    const ids = (xs: InboxEntry[]) => xs.map((x) => x.id)
    expect(unreadCount(entries, now)).toBe(4)
    expect(ids(visibleSwift(entries, 'all', now))).toEqual(['volvio', 'recordatorio', 'tarea', 'resumen', 'seguimiento', 'antes'])
    expect(ids(visibleSwift(entries, 'unread', now))).toEqual(['volvio', 'tarea', 'resumen', 'seguimiento'])
    expect(ids(visibleSwift(entries, 'platform', now))).toEqual(['tarea'])
    expect(ids(visibleSwift(entries, 'dates', now))).toEqual(['recordatorio'])
    expect(ids(visibleSwift(entries, 'snoozed', now))).toEqual(['oferta'])
    expect(ids(visibleSwift(entries, 'archived', now))).toEqual(['vieja'])
    expect(ids(visibleSwift(entries, 'all', now, 'tarea mac'))).toEqual([])
    expect(ids(visibleSwift(entries, 'all', now, 'TAREA 4'))).toEqual(['tarea'])
    expect(ids(visibleSwift(entries, 'all', now, 'math112'))).toEqual(['tarea'])
    // la vista de esta versión: por tipo y por estado
    expect(ids(visibleEntries(entries, { filter: 'reminder', now }))).toEqual(['recordatorio'])
    expect(ids(visibleEntries(entries, { view: 'snoozed', now }))).toEqual(['oferta'])
    expect(countsAsUnread(entries[5], local(2026, 10, 15, 8, 0, 1))).toBe(true)
    const days = groupByDay(visibleSwift(entries, 'all', now), now, TZ)
    expect(days.map((g) => g.section)).toEqual(['snoozedBack', 'today', 'yesterday', 'week', 'earlier'])
    expect(ids(days[0].entries)).toEqual(['volvio'])
    expect(groupByKind(entries)[0].kind).toBe('problem')
    expect(snoozeDate('oneHour', now, TZ)).toBe(local(2026, 10, 14, 13))
    expect(snoozeDate('thisEvening', now, TZ)).toBe(local(2026, 10, 14, 18))
    expect(snoozeDate('thisEvening', local(2026, 10, 14, 17, 45), TZ)).toBeNull()
    expect(snoozeDate('tomorrow', now, TZ)).toBe(local(2026, 10, 15, 8))
    expect(snoozeDate('weekend', now, TZ)).toBe(local(2026, 10, 17, 10))
    expect(snoozeDate('nextWeek', now, TZ)).toBe(local(2026, 10, 19, 8))
    expect(snoozeDate('weekend', local(2026, 10, 17, 12), TZ)).toBeNull()
    expect(snoozeDate('nextWeek', local(2026, 10, 19, 9), TZ)).toBe(local(2026, 10, 26, 8))
  })

  it('posponer respeta el cambio de hora', () => {
    const sat = at(2026, 10, 24, 12)
    const sun8 = at(2026, 10, 25, 8)
    expect(snoozeDate('tomorrow', sat, TZ)).toBe(sun8)
    expect(sun8 - sat).toBe(21 * 3_600_000)
    expect(snoozeDate('nextWeek', sat, TZ)).toBe(at(2026, 10, 26, 8))
    expect(snoozeDate('tomorrow', at(2026, 3, 28, 12), TZ)! - at(2026, 3, 28, 12)).toBe(19 * 3_600_000)
  })
})
