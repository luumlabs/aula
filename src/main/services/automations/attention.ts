// La atención del estudiante (AutomationAttention.swift): presupuesto diario con prioridades, avisos agrupados (tope por
// hora, horas de silencio, tras despertar el ordenador), sin repetir lo mismo, y esperas entre reintentos.
//   · PRESUPUESTO: lo urgente puede usar además una reserva del 25 %; lo normal empieza mientras quede; lo de baja prioridad
//     solo si queda al menos un cuarto libre. Los recordatorios y las ofertas no usan IA: siempre llegan.
//   · AVISOS: como mucho N que interrumpen por hora; lo urgente pasa siempre; en silencio y al despertar, lo no urgente se junta
//     en un resumen («4 novedades de Aula»).
import { Hashing } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import { quietContains, quietEnd, type AutomationNotice, type AutomationPriority, type NoticeLedger, type QuietHours } from '@shared/automations'

// MARK: Presupuesto

export class AutomationBudget {
  /** Lo que puede usar lo urgente además del límite. */
  static readonly reserveFraction = 0.25
  /** Coste típico de una revisión cuando aún no hay historial. */
  static readonly defaultEstimate = 6_000

  readonly limit: number
  readonly used: number
  readonly estimate: number

  constructor(limit: number, used: number, estimate: number = AutomationBudget.defaultEstimate) {
    this.limit = Math.max(1, limit)
    this.used = Math.max(0, used)
    this.estimate = Math.max(500, estimate)
  }

  get reserve(): number { return Math.trunc(this.limit * AutomationBudget.reserveFraction) }
  get remaining(): number { return Math.max(0, this.limit - this.used) }

  /** ¿Puede empezar una revisión de esta prioridad? */
  allows(p: AutomationPriority): boolean {
    if (p === 2) return this.used < this.limit + this.reserve
    if (p === 1) return this.used < this.limit
    return this.used + this.estimate <= Math.trunc((this.limit * 3) / 4)
  }

  /** Lo que puede gastar como mucho una revisión de esta prioridad que empieza ahora. */
  allowance(p: AutomationPriority): number {
    if (p === 2) return Math.max(0, this.limit + this.reserve - this.used)
    if (p === 1) return Math.max(0, this.limit - this.used)
    return Math.max(0, Math.trunc((this.limit * 3) / 4) - this.used)
  }

  /** Se acabó lo normal (solo queda la reserva de lo urgente). */
  get exhausted(): boolean { return !this.allows(1) }
  /** Revisiones normales que aún caben hoy (aprox.). */
  get runsLeft(): number { return Math.trunc(this.remaining / this.estimate) }

  /** Mediana de los últimos costes (o el valor por defecto). */
  static estimateFrom(costs: readonly number[]): number {
    const c = costs.filter((x) => x > 0).slice(-12).sort((a, b) => a - b)
    return c.length ? c[Math.trunc(c.length / 2)] : AutomationBudget.defaultEstimate
  }
}

// MARK: Avisos

export type NoticeDecision = { type: 'post' } | { type: 'hold'; until: number } | { type: 'drop' }

const HOUR = 3_600_000
const ms = (v: string) => Date.parse(v)

/** Apunta un aviso enviado (cuenta para el tope por hora si es normal: lo pasivo y lo urgente no). */
export function recordNotice(ledger: NoticeLedger, n: AutomationNotice, at: number): void {
  ledger.sent.push({ date: new Date(at).toISOString(), key: n.dedupeKey, counted: n.level === 'active' && n.priority < 2 })
}

/** Solo lo de las últimas 48 h (y topes). */
export function pruneLedger(ledger: NoticeLedger, now: number): void {
  ledger.sent = ledger.sent.filter((s) => now - ms(s.date) <= 48 * HOUR && ms(s.date) <= now + HOUR).slice(-400)
  if (ledger.held.length > 60) ledger.held = ledger.held.slice(-60)
}

/** Decide qué pasa con cada notificación (puro). */
export class NoticeRouter {
  /** Lo mismo no se vuelve a notificar antes de esto. */
  static readonly repeatWindow = 12 * HOUR
  /** Tras despertar el ordenador, lo no urgente se junta en un resumen que sale a los pocos minutos. */
  static readonly wakeBatch = 3 * 60_000

  readonly perHour: number

  constructor(perHour: number, readonly quiet: QuietHours, readonly tz: string) {
    this.perHour = Math.max(1, perHour)
  }

  decide(n: AutomationNotice, ledger: NoticeLedger, now: number, late = false): NoticeDecision {
    if (n.dedupeKey) {
      if (ledger.sent.some((s) => s.key === n.dedupeKey && Math.abs(now - ms(s.date)) < NoticeRouter.repeatWindow)) return { type: 'drop' }
      if (ledger.held.some((h) => h.notice.dedupeKey === n.dedupeKey)) return { type: 'drop' }
    }
    if (n.level === 'timeSensitive') return { type: 'post' }
    // en horas de silencio lo no urgente espera al final (un solo resumen)
    if (quietContains(this.quiet, now, this.tz)) return { type: 'hold', until: quietEnd(this.quiet, now, this.tz) }
    // lo pasivo no interrumpe
    if (n.level === 'passive') return { type: 'post' }
    // recuperado tarde (el ordenador dormía): lo no urgente, junto
    if (late && n.priority < 2) {
      const joining = ledger.held.map((h) => ms(h.until)).filter((u) => u > now && u <= now + NoticeRouter.wakeBatch)
      return { type: 'hold', until: joining.length ? Math.max(...joining) : now + NoticeRouter.wakeBatch }
    }
    if (n.priority === 2) return { type: 'post' }
    const recent = ledger.sent.filter((s) => s.counted && ms(s.date) <= now && now - ms(s.date) < HOUR).map((s) => ms(s.date)).sort((a, b) => a - b)
    if (recent.length >= this.perHour) return { type: 'hold', until: recent[0] + HOUR }
    return { type: 'post' }
  }

  /** Lo que ya toca sacar de la espera: un aviso suelto o un resumen de varios. */
  static release(ledger: NoticeLedger, now: number, stillUnread: (n: AutomationNotice) => boolean): AutomationNotice | null {
    const due = ledger.held.filter((h) => ms(h.until) <= now)
    if (!due.length) return null
    ledger.held = ledger.held.filter((h) => ms(h.until) > now)
    const pending = due.map((h) => h.notice).filter(stillUnread)
    if (!pending.length) return null
    if (pending.length === 1) {
      const one = { ...pending[0] }
      if (one.level === 'timeSensitive') one.level = 'active'
      one.sound = one.sound && one.priority === 2
      return one
    }
    return NoticeRouter.digest(pending)
  }

  /** «4 novedades de Aula» con lo más importante primero. */
  static digest(notices: readonly AutomationNotice[]): AutomationNotice {
    const sorted = [...notices].sort((a, b) => (b.priority - a.priority) || (b.relevance - a.relevance))
    let body = sorted.slice(0, 3).map((n) => n.title).join(' · ')
    if (sorted.length > 3) body += ' · ' + tr(`y ${sorted.length - 3} más`, `and ${sorted.length - 3} more`)
    const critical = sorted.some((n) => n.priority === 2)
    return {
      title: tr(`${sorted.length} novedades de Aula`, `${sorted.length} new messages from Aula`),
      subtitle: tr('Te las dejé juntas en Novedades', 'I put them together in your Inbox'),
      body,
      automationID: 'digest',
      kind: 'digest',
      level: critical ? 'active' : 'passive',
      priority: sorted[0]?.priority ?? 1,
      sound: sorted.some((n) => n.priority === 2 && n.sound),
      group: 'digest',
      relevance: critical ? 0.8 : 0.5,
      entryIDs: sorted.map((n) => n.entryID).filter((x): x is string => !!x),
      dedupeKey: 'digest:' + Hashing.stableID(sorted.map((n) => n.dedupeKey).join('|')),
      routine: false
    }
  }
}

/** Una notificación con los valores de Swift (`AutomationNotice.init`). */
export function makeNotice(opts: {
  title: string
  body: string
  automationID: string
  kind?: AutomationNotice['kind']
  level?: AutomationNotice['level']
  priority?: AutomationPriority
  subtitle?: string
  group?: string
  dedupeKey?: string
}): AutomationNotice {
  const level = opts.level ?? 'active'
  const priority = opts.priority ?? 1
  const kind = opts.kind ?? 'automation'
  return {
    title: opts.title,
    ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
    body: opts.body,
    automationID: opts.automationID,
    kind,
    level,
    priority,
    sound: level !== 'passive',
    group: opts.group ?? kind,
    relevance: level === 'timeSensitive' ? 1 : priority === 2 ? 0.8 : priority === 1 ? 0.5 : 0.2,
    entryIDs: [],
    dedupeKey: opts.dedupeKey ?? '',
    routine: opts.automationID.startsWith('routine-')
  }
}

// MARK: Reintentos

export const Backoff = {
  /** 5, 15 y 45 min. Si el proveedor dijo «límite de uso», se empieza en 15. */
  steps: [5 * 60_000, 15 * 60_000, 45 * 60_000],
  delay(attempt: number, rateLimited = false): number | null {
    const i = attempt + (rateLimited ? 1 : 0)
    return i < Backoff.steps.length ? Backoff.steps[i] : null
  },
  /** Pausa de toda la IA cuando el proveedor falla seguido (10, 30, 90 min… hasta 3 h). */
  providerPause(level: number): number {
    return Math.min(3 * HOUR, 600_000 * Math.pow(3, Math.max(0, level)))
  }
}
