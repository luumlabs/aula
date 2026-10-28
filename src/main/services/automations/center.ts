// El centro de las automatizaciones (AutomationCenter.swift).
//
// CONTRATO (lo usan el IPC, el chat y las pruebas):
//   arrancar ......... `start()` (una vuelta cada ≤ 60 s y al instante con `tick()`: al despertar el ordenador, al cambiar algo)
//   listar ........... `items()`, `snapshot()`, `runs(id)`, `inboxEntries()`
//   cambiar .......... `save(draft)`, `add`, `update`, `setEnabled`, `remove`, `runNow`
//   modo proactivo ... `setProactive(patch)` crea/actualiza las rutinas; `scheduleFollowup` (con presupuesto); `pause`
//   bandeja .......... `markRead`, `markAllRead`, `archive`, `archiveRead`, `snooze`, `dismissOffer`
//   avisos ........... `onChange(fn)` (la interfaz se refresca)
// Nunca hay dos ejecuciones de la misma automatización a la vez; las que usan IA van de una en una (cuidan el gasto y el
// navegador de Aula); las demás (recordatorios, ofertas de curso) no esperan. Una sola copia de Aula hace las tareas (lo
// garantiza el cerrojo de instancia única de Electron).
//
// Diferencia con Swift: las rutinas sin IA (recordatorios de entregas y exámenes sin preparar) funcionan también con «Aula
// siempre activa» apagada mientras la app está abierta (no gastan nada y no necesitan nada configurado).
import { IDs, Hashing } from '@engine/base/ids'
import { addDays, settingTime, startOfDay } from '@engine/calendar/time'
import { tr } from '@shared/ai/i18n'
import { isSampleCourse } from '@shared/samples'
import { settingsPath } from '@shared/settings/sections'
import type { AssistantCard, AssistantMessage } from '@shared/assistant/types'
import type { HomeSummary } from '@shared/ipc/home'
import {
  AutomationPlanner, DEFAULT_CAPABILITIES, LIGHT_ROUTINES, NIGHT_QUIET, PROACTIVE_ROUTINES, UPDATES_THREAD, applyStyle, compareFindings, countsAsUnread,
  dayKey, defaultProactiveSettings, effectiveStart, emptyAutomationState, findingIdentity, inboxDedupeKey, limitsOf, markCustomIfEdited, matchesSwiftFilter,
  previewLine, proactiveIsActive, quietContains, quietEnd, routineID, routineSchedule, routineUsesAI, scheduleIsValid, trimInbox, unreadCount, withRoutine,
  type Automation, type AutomationBook, type AutomationDraft, type AutomationFinding, type AutomationHealthIssue, type AutomationItemView, type AutomationNotice,
  type AutomationOutcome, type AutomationPriority, type AutomationPreviewItem, type AutomationRun, type AutomationSchedule, type AutomationsSnapshot,
  type AutomationSlot, type AutomationState, type AutomationTrigger, type InboxEntry, type InboxKind, type ProactiveRoutine, type ProactiveSettings,
  type SwiftInboxFilter
} from '@shared/automations'
import { log } from '../log'
import { AutomationBudget, Backoff, NoticeRouter, makeNotice, pruneLedger, recordNotice } from './attention'
import type { AutomationEnvironment } from './env'
import { examOffer, examsWithoutCourse, morning, morningCard, reminder, weekly, weeklyCard, actionsCard, cardAction, type Composed, type RoutineEvent } from './routines'
import { AutomationRunError, runAutomationCheck, type AutomationAgentOutput } from './runner'
import type { AutomationStore } from './store'
import {
  automationSymbol, clip, clock, findingKindTitle, firstLine, headline, list, originTitle, routineDetail, routineTitle, scheduleSummary, shortDayTime,
  timeDisplay, weekdayName, weekdaysPhrase, when
} from './texts'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const iso = (t: number) => new Date(t).toISOString()
const ms = (v: string | undefined): number | undefined => {
  if (!v) return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

/** Un límite o un dato que no vale (el mensaje es para el estudiante o para la IA). */
export class AutomationLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationLimitError'
  }
}

interface Job {
  id: string
  trigger: AutomationTrigger
  slots: AutomationSlot[]
  byAssistant?: boolean
  /** El horario con que se planeó (si cambió, no se hace). */
  plannedSchedule?: string
}

export interface FollowupDraft {
  title: string
  instruction: string
  when: Date
  capabilities?: Automation['capabilities']
  threadID?: string
  courseID?: string
  context?: string
}

export interface CenterOptions {
  store: AutomationStore
  env: AutomationEnvironment
  clock?: () => number
  /** Recuperaciones como mucho por minuto (al despertar tras días cerrado no se lanza todo a la vez). */
  maxCatchUpsPerTick?: number
}

const isLight = (r: ProactiveRoutine | undefined): boolean => !!r && LIGHT_ROUTINES.includes(r)
const usesAI = (a: Automation): boolean => (a.routine ? routineUsesAI(a.routine) : true)
const scheduleKey = (s: AutomationSchedule): string => JSON.stringify(s)

export class AutomationCenter {
  static readonly maxAutomations = 40
  readonly store: AutomationStore
  readonly env: AutomationEnvironment
  private readonly now: () => number
  readonly maxCatchUpsPerTick: number

  private list: Automation[]
  private book: AutomationBook
  private proactive: ProactiveSettings
  private inbox: InboxEntry[]
  private running = new Set<string>()
  private queue: Job[] = []
  private draining: Promise<void> | null = null
  private ticking = false
  private queuedTick: Promise<void> | null = null
  private tickChain: Promise<void> = Promise.resolve()
  private eventsCache: { at: number; events: RoutineEvent[] } | null = null
  private listeners = new Set<(reason: string) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private catchUps: { start: number; count: number } | null = null
  private aborts = new Map<string, AbortController>()
  private aiReadyCache: { at: number; ready: boolean } | null = null
  /** La novedad que pidió abrir una notificación (la interfaz la recoge al abrir «Novedades»). */
  pendingFocus: string | undefined

  constructor(o: CenterOptions) {
    this.store = o.store
    this.env = o.env
    this.now = o.clock ?? (() => Date.now())
    this.maxCatchUpsPerTick = o.maxCatchUpsPerTick ?? 3
    this.list = this.store.automations()
    this.book = this.store.book()
    this.proactive = this.store.proactive() ?? defaultProactiveSettings()
    this.inbox = this.store.inbox() ?? []
  }

  private get tz(): string { return this.env.timeZone() }
  private planner(): AutomationPlanner { return new AutomationPlanner(this.tz) }

  // MARK: Avisos de cambios

  onChange(fn: (reason: string) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(reason = 'state'): void {
    for (const fn of [...this.listeners]) {
      try { fn(reason) } catch (err) { log.warn('Automatizaciones: aviso de cambio', err) }
    }
  }

  // MARK: Bucle

  /** Empieza a vigilar los horarios (una vuelta cada ≤ 60 s; `tick()` fuerza una ya). */
  start(): void {
    if (this.started) return
    this.started = true
    this.ensureRoutines()
    void this.loop()
  }

  stop(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const c of this.aborts.values()) c.abort()
  }

  private async loop(): Promise<void> {
    if (!this.started) return
    try { await this.tick() } catch (err) { log.warn('Automatizaciones: vuelta', err) }
    if (!this.started) return
    const wait = await this.secondsToNextWake().catch(() => 60)
    this.timer = setTimeout(() => void this.loop(), Math.max(5, Math.min(60, wait)) * 1000)
    this.timer.unref?.()
  }

  private async secondsToNextWake(): Promise<number> {
    const now = this.now()
    const events = await this.events(now)
    const p = this.planner()
    const next: number[] = []
    for (const a of this.list) {
      const w = p.wakeDate(a, this.state(a.id), now, events)
      if (w !== undefined) next.push(w)
    }
    for (const h of this.book.notices.held) next.push(Date.parse(h.until))
    for (const e of this.inbox) { const s = ms(e.snoozedUntil); if (s !== undefined && s > now) next.push(s) }
    return next.length ? (Math.min(...next) - now) / 1000 : 60
  }

  /** Una vuelta: decide qué toca y lo lanza (lo que usa IA, a la cola). Si ya hay una en marcha, se encadena otra (con la
   *  hora de entonces); las que llegan mientras esa espera, la comparten. */
  tick(): Promise<void> {
    if (this.queuedTick) return this.queuedTick
    const next = this.tickChain.then(async () => {
      this.queuedTick = null
      this.ticking = true
      try { await this.evaluate() } finally { this.ticking = false }
    })
    this.queuedTick = next
    this.tickChain = next.catch((err) => log.warn('Automatizaciones: vuelta', err))
    return next
  }

  private state(id: string): AutomationState {
    return this.book.states[id] ?? emptyAutomationState()
  }

  private allowedNow(a: Automation, now: number): boolean {
    const paused = (ms(this.proactive.pausedUntil) ?? 0) > now
    return !paused && (a.origin === 'student' || proactiveIsActive(this.proactive, now) || (a.origin === 'routine' && isLight(a.routine)))
  }

  private async evaluate(): Promise<void> {
    const now = this.now()
    const events = await this.events(now)
    const p = this.planner()
    if (this.catchUps && (now - this.catchUps.start >= MIN || now < this.catchUps.start)) this.catchUps = null
    let catchUps = this.catchUps?.count ?? 0
    const inline: Job[] = []
    let changed = this.sanitizeClock(now)
    const aiPaused = (ms(this.book.aiPausedUntil) ?? 0) > now
    for (const a of this.list) {
      const st = { ...this.state(a.id) }
      const exp = ms(a.expiresAt)
      if (exp !== undefined && exp <= now && !st.completed) { st.completed = true; this.book.states[a.id] = st; changed = true; continue }
      // las rutinas y los seguimientos de la IA solo con «Aula siempre activa» (las ligeras, siempre); en pausa, nada
      if (!this.allowedNow(a, now) || this.running.has(a.id) || this.queue.some((j) => j.id === a.id)) {
        if (a.enabled && !st.completed && st.lastChecked !== iso(now)) { st.lastChecked = iso(now); this.book.states[a.id] = st }
        continue
      }
      const d = p.decide(a, st, now, events, this.proactive.quiet)
      if (a.schedule.kind === 'beforeEvents') fire(st, [...d.expiredKeys, ...d.missed.map((s) => s.key)])
      const lastMissed = d.missed[d.missed.length - 1]
      if (lastMissed && a.schedule.kind !== 'beforeEvents') {
        this.store.record(this.newRun(a, 'scheduled', lastMissed.at, now, {
          outcome: 'missed', finished: iso(now),
          summary: tr(`No se hizo a su hora (${shortDayTime(lastMissed.at, this.tz)}): el ordenador estaba dormido o Aula cerrada.`, `It didn't run on time (${shortDayTime(lastMissed.at, this.tz)}): the computer was asleep or Aula was closed.`)
        }))
        changed = true
      }
      const act = d.action
      if (act.type === 'none') st.lastChecked = iso(now)
      else if (act.type === 'defer') {
        st.lastChecked = iso(now); st.deferredUntil = iso(act.until); st.deferredSlot = iso(act.slot.at)
        changed = true
      } else {
        // la IA está en pausa (falló seguido): lo que la necesita espera (los resúmenes salen igual, sin IA)
        const until = ms(this.book.aiPausedUntil)
        if (usesAI(a) && aiPaused && a.routine !== 'morningBrief' && a.routine !== 'weeklySummary' && until !== undefined) {
          st.lastChecked = iso(now)
          st.retryAt = iso(until + (Math.abs(hashCode(a.id)) % 6) * 20_000)
          this.book.states[a.id] = st
          changed = true
          continue
        }
        if (act.trigger === 'catchUp') {
          if (catchUps >= this.maxCatchUpsPerTick) { this.book.states[a.id] = st; continue } // en el minuto siguiente
          catchUps++
          this.catchUps = { start: this.catchUps?.start ?? now, count: catchUps }
        }
        st.lastChecked = iso(now)
        delete st.retryAt; delete st.deferredUntil; delete st.deferredSlot
        if (a.schedule.kind === 'beforeEvents') fire(st, act.slots.map((s) => s.key))
        const job: Job = { id: a.id, trigger: act.trigger, slots: act.slots, plannedSchedule: scheduleKey(a.schedule) }
        if (usesAI(a)) this.queue.push(job)
        else inline.push(job)
        this.running.add(a.id)
        changed = true
      }
      this.book.states[a.id] = st
    }
    // seguimientos de la IA ya hechos hace más de 2 días: fuera de la lista
    const before = this.list.length
    this.list = this.list.filter((a) => !(a.origin === 'aula' && this.state(a.id).completed && (ms(this.state(a.id).lastRun) ?? ms(a.created) ?? 0) < now - 2 * DAY))
    if (this.list.length !== before) { this.store.saveAutomations(this.list); changed = true }
    if (this.resurfaceSnoozed(now)) changed = true
    if (this.releaseHeld(now)) changed = true
    if (changed || now - (ms(this.book.lastTick) ?? 0) > 10 * MIN) {
      this.book.lastTick = iso(now)
      this.pruneBook(now)
      this.store.saveBook(this.book)
    }
    if (changed) this.changed('state')
    for (const job of inline) await this.execute(job)
    this.drain()
  }

  /** Si el reloj fue hacia atrás (se corrigió la hora, cambió la zona), nada queda esperando a un futuro que ya no llega. */
  private sanitizeClock(now: number): boolean {
    let fixed = false
    for (const [id, s] of Object.entries(this.book.states)) {
      const st = { ...s }
      let touched = false
      if ((ms(st.lastChecked) ?? 0) > now + 2 * MIN) { st.lastChecked = iso(now); touched = true }
      if ((ms(st.retryAt) ?? 0) > now + 3 * HOUR) { st.retryAt = iso(now + Backoff.steps[0]); touched = true }
      if ((ms(st.deferredUntil) ?? 0) > now + 36 * HOUR) { st.deferredUntil = iso(quietEnd(this.proactive.quiet, now, this.tz)); touched = true }
      if (touched) { this.book.states[id] = st; fixed = true }
    }
    if ((ms(this.book.aiPausedUntil) ?? 0) > now + 4 * HOUR) { this.book.aiPausedUntil = iso(now + 10 * MIN); fixed = true }
    if ((ms(this.book.lastTick) ?? 0) > now + 2 * MIN) { delete this.book.lastTick; fixed = true }
    for (const h of this.book.notices.held) if (Date.parse(h.until) > now + 26 * HOUR) { h.until = iso(now); fixed = true }
    if (fixed) log.warn('Automatizaciones: el reloj fue hacia atrás; ajusto lo pendiente')
    return fixed
  }

  private pruneBook(now: number): void {
    const oldest = dayKey(now - 15 * DAY, this.tz)
    const keep = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([k]) => k >= oldest))
    this.book.usage = keep(this.book.usage)
    this.book.followups = keep(this.book.followups)
    if (this.book.offeredEvents.length > 300) this.book.offeredEvents = this.book.offeredEvents.slice(-300)
    pruneLedger(this.book.notices, now)
    this.book.announced = Object.fromEntries(Object.entries(this.book.announced).filter(([, d]) => now - Date.parse(d) < 30 * DAY))
    if (this.book.recentCosts.length > 12) this.book.recentCosts = this.book.recentCosts.slice(-12)
  }

  /** Las que usan IA, de una en una. */
  private drain(): void {
    if (this.draining || !this.queue.length) return
    this.draining = (async () => {
      while (this.queue.length) {
        const job = this.queue.shift()!
        await this.execute(job)
      }
    })().finally(() => {
      this.draining = null
      if (this.queue.length) this.drain()
    })
  }

  /** Espera a que no quede nada en marcha (pruebas). */
  async waitIdle(timeoutMs = 60_000): Promise<void> {
    const end = Date.now() + timeoutMs
    while ((this.ticking || this.queuedTick || this.queue.length || this.running.size || this.draining) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  // MARK: Calendario

  private async events(now: number): Promise<RoutineEvent[]> {
    const c = this.eventsCache
    if (c && now - c.at < 2 * MIN && now >= c.at) return c.events
    let events: RoutineEvent[] = []
    try { events = await this.env.events(new Date(now - DAY), new Date(now + 62 * DAY)) } catch (err) { log.warn('Automatizaciones: calendario', err) }
    // el examen de un curso de ejemplo no es del estudiante: ni resúmenes ni avisos con él (A4-P1-1)
    events = events.filter((e) => !(e.origin === 'course' && isSampleCourse(e.packID)))
    this.eventsCache = { at: now, events }
    return events
  }

  /** El calendario cambió (o la hora, o la zona): que se vuelva a leer. */
  invalidateEvents(): void {
    this.eventsCache = null
  }

  // MARK: Presupuesto

  private usageToday(now: number): number {
    return this.book.usage[dayKey(now, this.tz)] ?? 0
  }

  budget(now: number = this.now()): AutomationBudget {
    return new AutomationBudget(this.proactive.dailyTokenLimit, this.usageToday(now), AutomationBudget.estimateFrom(this.book.recentCosts))
  }

  /** Cuánto importa esta revisión: lo pedido a mano y la plataforma primero; lo recuperado tarde y el resumen semanal, lo último. */
  private priority(a: Automation, trigger: AutomationTrigger, byAssistant = false): AutomationPriority {
    if (trigger === 'manual') return byAssistant ? 1 : 2
    if (a.routine === 'weeklySummary') return 0
    if (a.capabilities.includes('platform')) return trigger === 'catchUp' ? 1 : 2
    if (trigger === 'catchUp' && !a.routine) return 0
    return 1
  }

  private async aiReady(): Promise<boolean> {
    const now = Date.now()
    if (this.aiReadyCache && now - this.aiReadyCache.at < MIN) return this.aiReadyCache.ready
    let ready = false
    try { ready = (await this.env.model()) !== null } catch { ready = false }
    this.aiReadyCache = { at: now, ready }
    return ready
  }

  // MARK: Ejecutar

  private newRun(a: Automation, trigger: AutomationTrigger, slot: number | undefined, started: number, extra: Partial<AutomationRun> = {}): AutomationRun {
    return {
      id: 'run-' + IDs.short(8), automationID: a.id, title: a.title, trigger, ...(slot !== undefined ? { slot: iso(slot) } : {}), started: iso(started),
      outcome: 'done', summary: '', newItems: [], changedItems: [], knownCount: 0, tokens: 0, tokensEstimated: false, notified: false, created: [], skippedActions: [],
      ...extra
    }
  }

  private mayStartAutomatically(a: Automation, now: number): boolean {
    if (!a.enabled || this.state(a.id).completed) return false
    const exp = ms(a.expiresAt)
    if (exp !== undefined && exp <= now) return false
    return this.allowedNow(a, now)
  }

  /** Una de «una vez» que se descarta al entrar deja rastro con el motivo. */
  private recordDiscarded(a: Automation, job: Job, now: number): void {
    if (a.schedule.kind !== 'once' || this.state(a.id).completed) return
    let why: string
    if (job.plannedSchedule !== scheduleKey(a.schedule)) why = tr('No se hizo: cambiaste su horario; la próxima vez irá con el nuevo.', "It didn't run: you changed its schedule; next time it uses the new one.")
    else if (!a.enabled) why = tr('No se hizo: está desactivada.', "It didn't run: it's turned off.")
    else if ((ms(a.expiresAt) ?? Infinity) <= now) why = tr('No se hizo: ya había caducado.', "It didn't run: it had expired.")
    else if ((ms(this.proactive.pausedUntil) ?? 0) > now) why = tr('No se hizo: Aula siempre activa estaba en pausa.', "It didn't run: Aula always on was paused.")
    else why = tr('No se hizo: fuera del horario en que Aula trabaja sola.', "It didn't run: outside the hours when Aula works on its own.")
    this.store.record(this.newRun(a, job.trigger, job.slots[job.slots.length - 1]?.at, now, { outcome: 'skipped', finished: iso(now), summary: why }))
  }

  private async execute(job: Job): Promise<void> {
    try {
      await this.executeInner(job)
    } catch (err) {
      log.error('Automatizaciones: ejecución', err)
    } finally {
      this.running.delete(job.id)
      this.changed('runs')
    }
  }

  private async executeInner(job: Job): Promise<void> {
    const a = this.list.find((x) => x.id === job.id)
    if (!a) return
    this.changed('runs')
    const now = this.now()
    if (job.trigger !== 'manual' && (job.plannedSchedule !== scheduleKey(a.schedule) || !this.mayStartAutomatically(a, now))) {
      this.recordDiscarded(a, job, now)
      return
    }
    if (a.routine && !routineUsesAI(a.routine)) return this.runDeterministic(a, a.routine, job, now)
    const bud = this.budget(now)
    const prio = this.priority(a, job.trigger, job.byAssistant)
    const aiPaused = (ms(this.book.aiPausedUntil) ?? 0) > now && (job.trigger !== 'manual' || !!job.byAssistant)
    const model = await this.env.model().catch(() => null)
    if ((a.routine === 'morningBrief' || a.routine === 'weeklySummary') && (!model || !bud.allows(prio) || aiPaused)) {
      return this.runFallback(a, job, now, aiPaused ? this.book.aiPauseReason : undefined)
    }
    const run = this.newRun(a, job.trigger, job.slots[job.slots.length - 1]?.at, now)
    if (aiPaused) {
      // el proveedor sigue en pausa: se reintenta cuando se reanude, sin gastar un intento
      this.book.states[a.id] = { ...this.state(a.id), retryAt: this.book.aiPausedUntil }
      this.store.saveBook(this.book)
      return
    }
    if (!bud.allows(prio)) {
      return this.budgetStop(a, job, run, now, tr('No la hice: hoy ya se usó el presupuesto de lo que Aula hace sola.', "I didn't run it: today's budget for what Aula does on its own is used up."))
    }
    const state = this.state(a.id)
    const previous = this.store.runs(a.id).find((r) => !['missed', 'skipped', 'budget'].includes(r.outcome))
    const abort = new AbortController()
    this.aborts.set(a.id, abort)
    try {
      if (!model) throw new AutomationRunError(tr(`Aula no tiene una IA lista. Elige una en ${settingsPath('ai', 'es')}.`, `Aula doesn’t have an AI ready. Choose one in ${settingsPath('ai', 'en')}.`), { transient: false })
      const events = await this.events(now)
      const study = await this.env.studySummary().catch(() => null)
      const followup = proactiveIsActive(this.proactive, now) && this.proactive.followups
        ? async (d: { title: string; instruction: string; when: Date }) => {
            const item = await this.scheduleFollowup({ ...d, capabilities: a.capabilities, threadID: a.threadID, courseID: a.courseID, context: tr(`Lo programó la revisión «${a.title}».`, `Scheduled by the check “${a.title}”.`) })
            return { id: item.automation.id, at: item.nextRun ?? d.when.toISOString() }
          }
        : undefined
      const out = await runAutomationCheck({
        automation: a, why: this.why(job), state, previous, proactive: this.proactive, now: new Date(now), maxTokens: bud.allowance(prio),
        env: this.env, model, events, study, followup, signal: abort.signal
      })
      await this.deliverResult(a, job, run, state, out)
    } catch (err) {
      await this.handleFailure(a, job, run, state, err)
    } finally {
      this.aborts.delete(a.id)
    }
  }

  /** Lo que encontró una revisión con IA: novedades, historial, aviso y entrada en la bandeja. */
  private async deliverResult(a: Automation, job: Job, run: AutomationRun, state: AutomationState, out: AutomationAgentOutput): Promise<void> {
    const end = this.now()
    const day = dayKey(end, this.tz)
    // lo gastado cuenta siempre, también si la borraron mientras revisaba
    this.book.usage[day] = (this.book.usage[day] ?? 0) + out.tokens
    this.book.recentCosts.push(out.tokens)
    if (!this.list.some((x) => x.id === a.id)) { this.store.saveBook(this.book); return }
    this.book.aiFailureStreak = 0; this.book.aiPauseLevel = 0
    delete this.book.aiPausedUntil; delete this.book.aiPauseReason
    const st: AutomationState = { ...(this.book.states[a.id] ?? state) }
    const cmp = compareFindings(out.findings, st.seen, !st.baselineDone, new Date(end))
    st.seen = cmp.seen
    st.baselineDone = true
    let outcome: AutomationOutcome
    if (a.untilFound && out.conditionMet) outcome = 'conditionMet'
    else if (cmp.new.length || cmp.changed.length) outcome = 'news'
    else if (out.signIn) outcome = 'needsSignIn'
    else if (a.routine) outcome = 'done'
    else outcome = 'nothingNew'
    Object.assign(run, {
      outcome, finished: iso(end), summary: out.summary, newItems: cmp.new, changedItems: cmp.changed, knownCount: cmp.known.length, tokens: out.tokens,
      tokensEstimated: out.estimated, created: out.created, skippedActions: out.skipped, provider: out.provider, ...(out.signIn ? { signIn: out.signIn.site } : {})
    })
    st.runCount += 1; st.lastRun = iso(end); st.lastOutcome = outcome; st.lastSummary = out.summary
    st.consecutiveFailures = 0; st.retries = 0; st.failureNotified = false
    if (outcome === 'conditionMet' || a.schedule.kind === 'once' || (a.maxRuns !== undefined && st.runCount >= a.maxRuns)) st.completed = true
    // la sesión de la plataforma: caducada / vuelve a funcionar
    if (out.signIn) this.book.signInNeeded[out.signIn.site] = this.book.signInNeeded[out.signIn.site] ?? iso(end)
    else if (a.capabilities.includes('platform') && out.pages > 0) this.book.signInNeeded = {}
    // lo mismo encontrado por otra automatización ya se avisó: no se repite
    const fresh = cmp.new.filter((f) => this.book.announced[findingIdentity(f)] === undefined)
    for (const f of [...cmp.new, ...cmp.changed]) this.book.announced[findingIdentity(f)] = iso(end)
    let notify = a.notify === 'always' ? true : a.notify === 'chatOnly' ? false : fresh.length > 0 || cmp.changed.length > 0 || outcome === 'conditionMet' || out.important
    if (a.notify === 'always' && outcome === 'news' && !fresh.length && !cmp.changed.length) notify = false // ya avisado por otra
    let signInNotice = false
    if (out.signIn && st.signInNotifiedDay !== day) { notify = true; signInNotice = true; st.signInNotifiedDay = day }
    this.book.states[a.id] = st
    const message = this.composeMessage(a, run, out, cmp.new, cmp.changed, st.completed && outcome === 'conditionMet')
    const kind = this.inboxKind(a, !!out.signIn && !cmp.new.length && !cmp.changed.length)
    const notice = notify ? this.noticeFor(a, out, fresh.length ? fresh : cmp.new, cmp.changed, kind, signInNotice, end) : null
    const title = headline(cmp.new, cmp.changed) ?? (out.signIn ? tr(`Inicia sesión otra vez en ${out.signIn.site}`, `Sign in again to ${out.signIn.site}`) : a.routine ? routineTitle(a.routine) : a.title)
    // «nada nuevo» (sin aviso) queda ya leído: está para consultarlo, no para molestar; lo que ya avisó otra, también
    const quietResult = !notice && (outcome === 'nothingNew' || outcome === 'done') && a.notify === 'news'
    const alreadyTold = !notice && outcome === 'news' && a.notify !== 'chatOnly'
    run.threadID = this.deliveryThread(a) ?? UPDATES_THREAD
    const foundKey = [...cmp.new, ...cmp.changed].map(findingIdentity).sort().join(',') + '|' + outcome
    const d = await this.publish({
      automationID: a.id, runID: run.id, threadID: this.deliveryThread(a), message, kind, priority: notice?.priority ?? 1, title,
      course: [...cmp.new, ...cmp.changed].map((f) => f.course).find((c) => !!c), notice, late: job.trigger === 'catchUp', now: end,
      read: quietResult || alreadyTold, extraKey: foundKey
    })
    run.messageID = d.id
    run.notified = d.notified
    this.store.record(run)
    this.store.saveBook(this.book)
  }

  private async handleFailure(a: Automation, job: Job, run: AutomationRun, state: AutomationState, error: unknown): Promise<void> {
    const end = this.now()
    const e = error instanceof AutomationRunError ? error : new AutomationRunError(error instanceof Error ? error.message : String(error), { transient: true, provider: true })
    const day = dayKey(end, this.tz)
    if (e.tokens > 0) this.book.usage[day] = (this.book.usage[day] ?? 0) + e.tokens
    // «Detener» no es un fallo: queda como detenida, sin avisar, sin reintentos y sin pausar la IA
    if (e.cancelled) {
      Object.assign(run, { outcome: 'skipped', finished: iso(end), tokens: e.tokens, summary: tr('Se detuvo antes de terminar.', 'It was stopped before finishing.') })
      if (this.list.some((x) => x.id === a.id)) this.store.record(run)
      this.store.saveBook(this.book)
      return
    }
    // el proveedor falló seguido (o dijo «límite de uso»): toda la IA espera un rato
    if (e.provider) {
      this.book.aiFailureStreak += 1
      if (e.rateLimited || this.book.aiFailureStreak >= 2) {
        this.book.aiPausedUntil = iso(end + Backoff.providerPause(this.book.aiPauseLevel))
        this.book.aiPauseLevel += 1
        this.book.aiPauseReason = e.rateLimited ? tr('Tu proveedor de IA llegó a su límite de uso', 'Your AI provider reached its usage limit') : tr('Tu proveedor de IA no responde', "Your AI provider isn't responding")
      }
    }
    // el resumen de la mañana y el de la semana llegan igual, a su hora: sin la IA
    if (a.routine === 'morningBrief' || a.routine === 'weeklySummary') return this.runFallback(a, job, end, e.message)
    if (!this.list.some((x) => x.id === a.id)) { this.store.saveBook(this.book); return }
    if (e.budget) {
      run.tokens = e.tokens
      if (e.spendingCap) this.book.spendingCapDay = day
      return this.budgetStop(a, job, run, end, e.message, e.spendingCap)
    }
    const st: AutomationState = { ...(this.book.states[a.id] ?? state) }
    st.consecutiveFailures += 1; st.lastRun = iso(end); st.lastOutcome = 'failed'
    Object.assign(run, { outcome: 'failed', finished: iso(end), error: e.message })
    let retrying = false
    const delay = e.transient ? Backoff.delay(st.retries, e.rateLimited) : null
    if (delay !== null) {
      let at = end + delay
      const pause = ms(this.book.aiPausedUntil)
      if (pause !== undefined && pause > at) at = pause
      const nextSlot = this.planner().next(a.schedule, end, await this.events(end))?.at
      if (nextSlot === undefined || nextSlot > at) { st.retryAt = iso(at); st.retries += 1; retrying = true }
    }
    if (!retrying) st.retries = 0
    run.summary = retrying
      ? tr(`Falló (${e.message}). Lo reintento a las ${clock(ms(st.retryAt)!, this.tz)}.`, `It failed (${e.message}). I'll retry at ${clock(ms(st.retryAt)!, this.tz)}.`)
      : tr(`Falló: ${e.message}`, `It failed: ${e.message}`)
    // al chat: cuando ya no hay reintento (una vez hasta que vuelva a funcionar); notificación discreta tras 3 fallos o sin arreglo solo
    if (!retrying && !st.failureNotified) {
      st.failureNotified = true
      const text = tr(`No pude hacer «${a.title}»: ${e.message}`, `I couldn't do “${a.title}”: ${e.message}`)
      const card = actionsCard(a.title, [
        cardAction('runAutomation', tr('Volver a intentarlo', 'Try again'), { symbol: 'refresh', prominent: true, value: a.id }),
        cardAction('openAutomation', tr('Ver la automatización', 'See the automation'), { value: a.id })
      ], { icon: 'alert', automationID: a.id })
      const msg = this.message(text, end, [card], this.origin(a, run.id))
      let notice: AutomationNotice | null = null
      if ((st.consecutiveFailures >= 3 || !e.transient) && a.notify !== 'chatOnly') {
        notice = makeNotice({ title: tr(`No pude hacer «${a.title}»`, `I couldn't do “${a.title}”`), body: e.message, automationID: a.id, kind: 'problem', level: 'passive', subtitle: tr('Necesita tu ayuda', 'Needs you'), group: 'problem', dedupeKey: 'fail:' + a.id + ':' + Hashing.stableID(e.message) })
      }
      this.book.states[a.id] = st
      run.threadID = this.deliveryThread(a) ?? UPDATES_THREAD
      const d = await this.publish({ automationID: a.id, runID: run.id, threadID: this.deliveryThread(a), message: msg, kind: 'problem', priority: 1, title: tr(`No pude hacer «${a.title}»`, `I couldn't do “${a.title}”`), notice, late: false, now: end })
      run.messageID = d.id; run.notified = d.notified
    }
    this.book.states[a.id] = st
    this.store.record(run)
    this.store.saveBook(this.book)
  }

  /** Se acabó el presupuesto: se apunta, lo de una sola vez espera a mañana y el estudiante lo sabe una vez al día. */
  private async budgetStop(a: Automation, job: Job, run: AutomationRun, now: number, summary: string, spendingCap = false): Promise<void> {
    run.outcome = 'budget'; run.finished = iso(now); run.summary = summary
    const st: AutomationState = { ...this.state(a.id) }
    if (a.schedule.kind === 'once' && !st.completed) {
      const tomorrow8 = settingTime(addDays(startOfDay(now, this.tz), 1, this.tz), 8, 0, 0, this.tz).getTime()
      const at = quietEnd(this.proactive.quiet, tomorrow8, this.tz)
      if ((ms(a.expiresAt) ?? Infinity) > at) {
        st.deferredUntil = iso(at); st.deferredSlot = iso(job.slots[job.slots.length - 1]?.at ?? now)
        run.summary = spendingCap ? tr('Hoy ya se llegó al tope de gasto en IA: lo dejo para mañana.', "Today's AI spending cap was reached: I'll leave it for tomorrow.") : tr('Hoy ya se usó el presupuesto de lo que Aula hace sola: lo dejo para mañana.', "Today's budget for what Aula does on its own is used up: I'll leave it for tomorrow.")
      }
    }
    this.book.states[a.id] = st
    const day = dayKey(now, this.tz)
    if (this.book.budgetNotifiedDay !== day) {
      this.book.budgetNotifiedDay = day
      const text = spendingCap
        ? tr(`Hoy llegaste al tope de gasto en IA que pusiste. Lo que hago sola con una IA de pago vuelve mañana; los recordatorios siguen llegando. Si quieres, cámbialo en ${settingsPath('ai', 'es')}.`, `Today you reached the AI spending cap you set. What I do on my own with a paid AI comes back tomorrow; reminders keep coming. You can change it in ${settingsPath('ai', 'en')}.`)
        : tr(`Hoy ya usé el presupuesto que pusiste para lo que hago sola. Lo urgente (novedades de tu plataforma, lo que vence pronto) sigue llegando; lo demás vuelve mañana. Si quieres, cámbialo en ${settingsPath('persistent', 'es')}.`, `Today I used the budget you set for what I do on my own. Urgent things (news from your platform, what’s due soon) keep coming; the rest comes back tomorrow. You can change it in ${settingsPath('persistent', 'en')}.`)
      const card = actionsCard(tr('Presupuesto de hoy', "Today's budget"), [cardAction('openSettings', tr('Ajustar el presupuesto', 'Adjust the budget'), { value: spendingCap ? 'ai' : 'automations' })], { icon: 'activity' })
      run.messageID = (await this.publish({ automationID: a.id, runID: run.id, message: this.message(text, now, [card], this.origin(a, run.id)), kind: 'system', priority: 0, title: tr('Presupuesto de hoy usado', "Today's budget used"), notice: null, late: false, now })).id
    }
    this.store.record(run)
    this.store.saveBook(this.book)
  }

  private why(job: Job): string {
    const last = job.slots[job.slots.length - 1]
    const at = last ? new Intl.DateTimeFormat('en-US', { timeZone: this.tz, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(last.at) : ''
    switch (job.trigger) {
      case 'scheduled': return `it is the scheduled time (${at})`
      case 'catchUp': return `LATE: it was due at ${at} but the computer was asleep or Aula was closed — check now and mention it only if it matters`
      case 'manual': return job.byAssistant ? 'you (Aula, in the chat) chose to run it now for the student' : 'the student pressed «Ejecutar ahora» (run it now)'
      case 'retry': return 'a retry after an error a few minutes ago'
    }
  }

  /** Los seguimientos (de la IA, o de una vez pedidos en una conversación) responden en esa conversación; lo demás, en «Novedades». */
  private deliveryThread(a: Automation): string | undefined {
    return a.origin === 'aula' || a.schedule.kind === 'once' ? a.threadID : undefined
  }

  private origin(a: Automation, runID: string): NonNullable<AssistantMessage['origin']> {
    const kind = a.routine === 'deadlineReminders' ? 'reminder' : a.routine ? 'routine' : a.origin === 'aula' ? 'followup' : 'automation'
    return { kind, title: originTitle(a), automationID: a.id, runID, symbol: automationSymbol(a) }
  }

  private inboxKind(a: Automation, signIn = false): InboxKind {
    if (signIn) return 'problem'
    switch (a.routine) {
      case 'morningBrief': case 'weeklySummary': return 'summary'
      case 'platformCheck': return 'platform'
      case 'deadlineReminders': return 'reminder'
      case 'examOffers': return 'offer'
    }
    if (a.origin === 'aula') return 'followup'
    return a.capabilities.includes('platform') ? 'platform' : 'automation'
  }

  private message(text: string, at: number, cards: AssistantCard[], origin: AssistantMessage['origin'], notices: string[] = [], provider?: string): AssistantMessage {
    return {
      id: 'msg-' + IDs.short(12), role: 'assistant', text, date: iso(at), mentions: [], attachments: [], cards, steps: [], notices, failed: false, interrupted: false,
      ...(provider ? { provider } : {}), ...(origin ? { origin } : {})
    }
  }

  /** El mensaje con el resultado de una revisión con IA. */
  private composeMessage(a: Automation, run: AutomationRun, out: AutomationAgentOutput, news: AutomationFinding[], changed: AutomationFinding[], completed: boolean): AssistantMessage {
    const cards: AssistantCard[] = [...out.cards]
    const fresh = [...news, ...changed]
    const started = Date.parse(run.started)
    if (fresh.length) {
      const facts = fresh.slice(0, 6).map((f) => ({ label: findingKindTitle(f.kind), value: [f.title, f.due ? when(Date.parse(f.due), false, started, this.tz) : null].filter(Boolean).join(' · ') }))
      const actions = []
      const task = fresh.find((f) => f.kind === 'assignment')
      if (task) actions.push(cardAction('ask', tr('¿Lo vemos juntos?', 'Shall we look at it together?'), { symbol: 'users', prominent: true, value: tr(`Cuéntame qué piden en «${task.title}» y ayúdame a organizarme para hacerlo (sin hacerlo por mí).`, `Tell me what “${task.title}” asks for and help me get organized to do it (without doing it for me).`) }))
      const url = fresh.find((f) => (f.url ?? '').startsWith('http'))?.url
      if (url) actions.push(cardAction('openURL', tr('Abrir en la plataforma', 'Open on the platform'), { symbol: 'external', value: url }))
      actions.push(cardAction('openAutomation', tr('Ver la automatización', 'See the automation'), { value: a.id }))
      cards.unshift(actionsCard(headline(news, changed) ?? a.title, actions, { facts, icon: 'search', automationID: a.id }))
    }
    if (out.signIn) {
      cards.push(actionsCard(tr(`Inicia sesión otra vez en ${out.signIn.site}`, `Sign in again to ${out.signIn.site}`), [
        cardAction('signIn', tr('Iniciar sesión', 'Sign in'), { symbol: 'key', prominent: true, value: out.signIn.accountId || undefined }),
        cardAction('runAutomation', tr('Volver a revisar', 'Check again'), { symbol: 'refresh', value: a.id })
      ], { detail: tr(`La sesión de Aula en ${out.signIn.site} caducó y no pude revisarlo. Aula nunca inicia sesión por su cuenta: hazlo tú en su ventana y vuelvo a mirar.`, `Aula's session on ${out.signIn.site} expired and I couldn't check it. Aula never signs in on its own: do it in its window and I'll look again.`), icon: 'key', automationID: a.id }))
    }
    if (a.routine === 'morningBrief') cards.push(morningCard())
    if (a.routine === 'weeklySummary') cards.push(weeklyCard())
    let text = out.summary
    if (completed) text += '\n\n' + tr('_Ya está: dejo de revisarlo. Si quieres que siga, reactívalo en Automatizaciones._', "_Done: I'll stop checking. If you want me to keep going, turn it back on in Automations._")
    const notices: string[] = []
    if (out.skipped.length) notices.push(tr(`Por seguridad no hice nada en tu plataforma: ${list(out.skipped.slice(0, 3))}`, `For safety I didn't do anything on your platform: ${list(out.skipped.slice(0, 3))}`))
    if (out.created.length) notices.push(tr(`Preparé: ${list(out.created)}`, `I prepared: ${list(out.created)}`))
    return this.message(text, Date.parse(run.finished ?? run.started), cards, this.origin(a, run.id), notices, out.provider)
  }

  /** La notificación de una revisión con IA: título claro, subtítulo con el curso o el tipo, cuerpo con qué pasó y qué hacer. */
  private noticeFor(a: Automation, out: AutomationAgentOutput, news: AutomationFinding[], changed: AutomationFinding[], kind: InboxKind, signIn: boolean, now: number): AutomationNotice | null {
    if (!this.proactive.notifications) return null
    const limits = limitsOf(this.proactive)
    if (out.signIn && signIn && !news.length && !changed.length) {
      return makeNotice({
        title: tr(`Inicia sesión otra vez en ${out.signIn.site}`, `Sign in again to ${out.signIn.site}`),
        body: tr(`No pude revisar «${a.title}» porque tu sesión caducó. Ábrela en Aula para iniciarla; yo nunca lo hago por mi cuenta.`, `I couldn't check “${a.title}” because your session expired. Open it in Aula to sign in; I never do it on my own.`),
        automationID: a.id, kind: 'problem', level: 'passive', subtitle: out.signIn.site, group: 'problem', dedupeKey: 'signin:' + out.signIn.site + ':' + dayKey(now, this.tz)
      })
    }
    const found = [...news, ...changed]
    const course = found.map((f) => f.course).find((c) => !!c)
    let n: AutomationNotice
    if (found.length === 1) {
      const f = found[0]
      const isChange = news.length === 0
      let body = isChange ? tr('Cambió la fecha.', 'The date changed.') : f.detail ? clip(f.detail, 120) : ''
      if (f.due) body = (body ? body + ' ' : '') + tr(`Vence ${when(Date.parse(f.due), false, now, this.tz)}.`, `Due ${when(Date.parse(f.due), false, now, this.tz)}.`)
      if (f.kind === 'assignment') body += (body ? ' ' : '') + tr('¿La organizamos juntos?', 'Shall we organize it together?')
      if (!body) body = firstLine(out.summary)
      const what = isChange ? tr(`${findingKindTitle(f.kind)} cambiada`, `${findingKindTitle(f.kind)} changed`) : tr(`${findingKindTitle(f.kind)} nueva`, `New ${findingKindTitle(f.kind).toLowerCase()}`)
      n = makeNotice({ title: f.title, body, automationID: a.id, kind, level: 'active', priority: out.important ? 2 : 1, subtitle: [what, course].filter(Boolean).join(' · ') })
    } else if (found.length) {
      const courses = [...new Set(found.map((f) => f.course).filter((c): c is string => !!c))].sort()
      n = makeNotice({ title: headline(news, changed) ?? a.title, body: firstLine(out.summary), automationID: a.id, kind, level: 'active', priority: out.important ? 2 : 1, subtitle: courses.length ? list(courses.slice(0, 3)) : a.routine ? routineTitle(a.routine) : a.title })
    } else {
      const summaryKind = kind === 'summary'
      const level = summaryKind ? ((a.routine === 'morningBrief' ? limits.morningInterrupts : limits.summariesInterrupt) ? 'active' : 'passive') : 'active'
      n = makeNotice({ title: a.routine ? routineTitle(a.routine) : a.title, body: firstLine(out.summary), automationID: a.id, kind, level, priority: summaryKind ? 0 : out.important ? 2 : 1, subtitle: a.routine ? undefined : originTitle(a) })
    }
    if (!n.body) n.body = tr('Tienes el resultado en Novedades.', 'The result is in your Inbox.')
    n.body = clip(n.body, 220)
    n.group = kind + (course ? '.' + IDs.slug(course, 24) : '')
    if (course) n.summaryArgument = course
    n.sound = n.level === 'timeSensitive' || (n.level === 'active' && (limits.normalSound || n.priority === 2))
    n.dedupeKey = found.length
      ? 'find:' + Hashing.stableID(found.map((f) => findingIdentity(f) + '|' + (f.due ? String(Math.trunc(Date.parse(f.due) / 1000)) : '')).sort().join(','))
      : inboxDedupeKey(kind, a.id, out.summary)
    return n
  }

  // MARK: Publicar (chat + bandeja + notificación)

  private router(): NoticeRouter {
    return new NoticeRouter(limitsOf(this.proactive).noticesPerHour, this.proactive.quiet, this.tz)
  }

  /** Deja un resultado en el chat y en la bandeja y decide su notificación. Lo idéntico de las últimas 24 h no se repite. */
  private async publish(p: {
    automationID: string; runID: string; threadID?: string; message: AssistantMessage; kind: InboxKind; priority: AutomationPriority; title: string
    course?: string; notice: AutomationNotice | null; late: boolean; now: number; read?: boolean; extraKey?: string
  }): Promise<{ id: string; notified: boolean }> {
    const key = inboxDedupeKey(p.kind, p.automationID, p.message.text + (p.extraKey ? '\n' + p.extraKey : ''))
    const dup = this.inbox.find((e) => e.dedupeKey === key && !e.archived && Math.abs(p.now - Date.parse(e.date)) < DAY)
    if (dup) return { id: dup.id, notified: false }
    const thread = p.threadID ?? UPDATES_THREAD
    const chat = this.env.chat()
    let id = p.message.id
    if (chat) {
      try {
        const got = await chat.postSystemMessage(thread, p.message)
        if (typeof got === 'string' && got) id = got
      } catch (err) {
        log.warn('Automatizaciones: no pude dejar el mensaje en el chat', err)
      }
    }
    const entry: InboxEntry = {
      id, threadID: thread, automationID: p.automationID, runID: p.runID, kind: p.kind, priority: p.priority, title: p.title,
      preview: previewLine(p.message.text), ...(p.course ? { course: p.course } : {}), source: p.message.origin?.title ?? '',
      ...(p.message.origin?.symbol ? { symbol: p.message.origin.symbol } : {}), date: iso(p.now), read: p.read ?? false, archived: false, resurfaced: false,
      dedupeKey: key, notified: false, message: { ...p.message, id }
    }
    let post: AutomationNotice | null = null
    if (p.notice && this.proactive.notifications) {
      const n: AutomationNotice = { ...p.notice, entryID: entry.id }
      if (!n.dedupeKey) n.dedupeKey = key
      const d = this.router().decide(n, this.book.notices, p.now, p.late)
      if (d.type === 'post') { post = n; recordNotice(this.book.notices, n, p.now); entry.notified = true }
      else if (d.type === 'hold') { this.book.notices.held.push({ notice: n, until: iso(d.until) }); entry.notified = true }
      entry.notice = n
    }
    this.inbox.push(entry)
    this.inbox = trimInbox(this.inbox)
    this.store.saveInbox(this.inbox)
    this.store.saveBook(this.book)
    if (post) this.safeNotify(post)
    this.changed('inbox')
    return { id: entry.id, notified: !!post }
  }

  private safeNotify(n: AutomationNotice): void {
    try { this.env.notify(n) } catch (err) { log.warn('Automatizaciones: notificación', err) }
  }

  /** Los avisos que esperaban y ya tocan: uno suelto o un resumen; lo ya leído o archivado no se avisa. */
  private releaseHeld(now: number): boolean {
    if (!this.book.notices.held.some((h) => Date.parse(h.until) <= now)) return false
    const n = NoticeRouter.release(this.book.notices, now, (x) => {
      const ids = x.entryIDs.length ? x.entryIDs : x.entryID ? [x.entryID] : []
      if (!ids.length) return true
      return ids.some((id) => { const e = this.inbox.find((y) => y.id === id); return e ? countsAsUnread(e, now) : false })
    })
    if (n && this.proactive.notifications) {
      recordNotice(this.book.notices, n, now)
      this.safeNotify(n)
    }
    return true
  }

  /** Lo pospuesto que ya toca vuelve a la bandeja (sin leer, arriba) con su aviso. */
  private resurfaceSnoozed(now: number): boolean {
    const back: InboxEntry[] = []
    for (const e of this.inbox) {
      const until = ms(e.snoozedUntil)
      if (until === undefined || until > now) continue
      delete e.snoozedUntil
      e.resurfaced = true; e.read = false; e.archived = false; e.date = iso(now)
      back.push(e)
    }
    if (!back.length) return false
    this.store.saveInbox(this.inbox)
    if (!this.proactive.notifications) return true
    for (const e of back) {
      const n: AutomationNotice = { ...(e.notice ?? makeNotice({ title: e.title, body: e.preview, automationID: e.automationID ?? '', kind: e.kind })), entryID: e.id, entryIDs: [] }
      n.subtitle = tr('Lo pospusiste: vuelve ahora', 'You snoozed it: it is back now')
      if (n.level === 'passive') n.level = 'active'
      n.sound = true
      n.dedupeKey = 'snooze:' + e.id + ':' + Math.trunc(now / 1000)
      const d = this.router().decide(n, this.book.notices, now)
      if (d.type === 'hold') this.book.notices.held.push({ notice: n, until: iso(d.until) })
      else { recordNotice(this.book.notices, n, now); this.safeNotify(n) } // lo pidió el estudiante: sale aunque haya tope
    }
    return true
  }

  // MARK: Rutinas sin IA

  private async runDeterministic(a: Automation, routine: ProactiveRoutine, job: Job, now: number): Promise<void> {
    const run = this.newRun(a, job.trigger, job.slots[job.slots.length - 1]?.at, now)
    this.invalidateEvents()
    const events = await this.events(now)
    const limits = limitsOf(this.proactive)
    const lines: string[] = []
    const packs = this.env.packs()
    if (routine === 'deadlineReminders') {
      for (const slot of job.slots) {
        const e = events.find((x) => x.id === slot.eventID)
        if (!e || effectiveStart(e, this.tz) <= now) continue
        const pid = e.packID ?? this.env.packIDForEvent(e.id)
        const course = pid ? packs.find((p) => p.id === pid) : undefined
        const c = reminder(e, slot, course, now, this.tz)
        const left = effectiveStart(e, this.tz) - now
        const courseName = [e.course, course?.title].find((x) => !!x && x.trim() !== '')
        const n = makeNotice({
          title: c.noticeTitle, body: c.noticeBody, automationID: a.id, kind: 'reminder', level: c.urgent ? 'timeSensitive' : 'active', priority: left <= 26 * HOUR ? 2 : 1,
          subtitle: courseName, group: 'reminder' + (courseName ? '.' + IDs.slug(courseName, 24) : ''), dedupeKey: 'remind:' + e.id + ':' + Math.round((slot.hoursBefore ?? 0) * 60)
        })
        if (courseName) n.summaryArgument = courseName
        n.sound = c.urgent || limits.normalSound || n.priority === 2
        const d = await this.publish({ automationID: a.id, runID: run.id, message: this.message(c.text, now, c.cards, this.origin(a, run.id)), kind: 'reminder', priority: n.priority, title: c.noticeTitle, course: courseName, notice: n, late: job.trigger === 'catchUp', now })
        run.messageID = d.id
        run.notified = run.notified || d.notified
        lines.push(firstLine(c.text))
      }
    } else if (routine === 'examOffers') {
      const offered = new Set(this.book.offeredEvents)
      const exams = examsWithoutCourse(events, packs, (id) => this.env.packIDForEvent(id), offered, this.proactive.examOfferDays, now, this.tz)
      for (const e of exams.slice(0, 2)) {
        this.book.offeredEvents.push(e.id) // antes de esperar: otra vuelta a la vez no lo ofrece dos veces
        const c: Composed = examOffer(e, now, this.tz)
        const n = makeNotice({ title: c.noticeTitle, body: c.noticeBody, automationID: a.id, kind: 'offer', level: limits.summariesInterrupt ? 'active' : 'passive', subtitle: e.course, group: 'offer', dedupeKey: 'offer:' + e.id })
        n.sound = n.level === 'active' && limits.normalSound
        const d = await this.publish({ automationID: a.id, runID: run.id, message: this.message(c.text, now, c.cards, this.origin(a, run.id)), kind: 'offer', priority: 1, title: c.noticeTitle, course: e.course, notice: n, late: job.trigger === 'catchUp', now })
        run.messageID = d.id
        run.notified = run.notified || d.notified
        lines.push(firstLine(c.text))
      }
    }
    run.finished = iso(this.now())
    run.outcome = lines.length ? 'done' : 'nothingNew'
    run.summary = lines.length ? lines.join('\n') : tr('Nada que avisar.', 'Nothing to report.')
    const st = { ...this.state(a.id) }
    st.runCount += 1; st.lastRun = run.finished; st.lastOutcome = run.outcome; st.lastSummary = run.summary
    this.book.states[a.id] = st
    if (lines.length || job.trigger === 'manual') this.store.record(run)
    this.store.saveBook(this.book)
  }

  /** Resumen de la mañana o de la semana sin IA (no hay ninguna, se acabó el presupuesto o el proveedor falla). */
  private async runFallback(a: Automation, job: Job, now: number, reason?: string): Promise<void> {
    const run = this.newRun(a, job.trigger, job.slots[job.slots.length - 1]?.at, now)
    const events = await this.events(now)
    const study: HomeSummary | null = await this.env.studySummary().catch(() => null)
    const c = a.routine === 'weeklySummary' ? weekly(events, study, now, this.tz) : morning(events, study, now, this.tz)
    const notices: string[] = []
    if (reason) notices.push(tr(`Tu proveedor de IA no respondió (${clip(reason, 120)}): te dejo el resumen con tu calendario y tus cursos.`, `Your AI provider didn't respond (${clip(reason, 120)}): here's the summary from your calendar and courses.`))
    else if (this.budget(now).exhausted) notices.push(tr('Hoy ya se usó el presupuesto de lo que Aula hace sola: resumen con tu calendario y tus cursos.', "Today's budget for what Aula does on its own is used up: summary from your calendar and courses."))
    if (reason) run.error = reason
    const limits = limitsOf(this.proactive)
    const interrupts = a.routine === 'morningBrief' ? limits.morningInterrupts : limits.summariesInterrupt
    const n = makeNotice({ title: c.noticeTitle, body: c.noticeBody, automationID: a.id, kind: 'summary', level: interrupts ? 'active' : 'passive', priority: 0, group: 'summary', dedupeKey: 'summary:' + a.id + ':' + dayKey(now, this.tz) })
    n.sound = false
    const d = await this.publish({ automationID: a.id, runID: run.id, message: this.message(c.text, now, c.cards, this.origin(a, run.id), notices), kind: 'summary', priority: 0, title: c.noticeTitle, notice: n, late: job.trigger === 'catchUp', now })
    Object.assign(run, { messageID: d.id, notified: d.notified, finished: iso(this.now()), outcome: 'done', summary: c.text })
    const st = { ...this.state(a.id) }
    st.runCount += 1; st.lastRun = run.finished; st.lastOutcome = 'done'; st.lastSummary = c.text
    this.book.states[a.id] = st
    this.store.record(run)
    this.store.saveBook(this.book)
  }

  // MARK: Listar

  private view(a: Automation, now: number, events: readonly RoutineEvent[]): AutomationItemView {
    const st = this.state(a.id)
    const next = this.planner().nextRun(a, st, now, events)
    return {
      automation: a, running: this.running.has(a.id), runCount: st.runCount, consecutiveFailures: st.consecutiveFailures, completed: st.completed,
      ...(next !== undefined ? { nextRun: iso(next) } : {}), ...(st.lastRun ? { lastRun: st.lastRun } : {}), ...(st.lastOutcome ? { lastOutcome: st.lastOutcome } : {}),
      ...(st.lastSummary ? { lastSummary: st.lastSummary } : {}), ...(st.retryAt ? { retryAt: st.retryAt } : {}), ...(st.deferredUntil ? { deferredUntil: st.deferredUntil } : {})
    }
  }

  async items(): Promise<AutomationItemView[]> {
    const now = this.now()
    const events = await this.events(now)
    return this.list.map((a) => this.view(a, now, events))
  }

  async item(id: string): Promise<AutomationItemView | null> {
    return (await this.items()).find((i) => i.automation.id === id) ?? null
  }

  automations(): Automation[] { return [...this.list] }
  runs(id: string): AutomationRun[] { return this.store.runs(id) }
  proactiveSettings(): ProactiveSettings { return { ...this.proactive } }
  inboxEntries(): InboxEntry[] { return [...this.inbox] }
  unread(now: number = this.now()): number { return unreadCount(this.inbox, now) }
  isRunning(id: string): boolean { return this.running.has(id) }

  /** Seguimientos que Aula aún puede programarse hoy: los que quepan en el presupuesto, con el techo del estilo. */
  followupsLeft(now: number = this.now()): number {
    const used = this.book.followups[dayKey(now, this.tz)] ?? 0
    const b = this.budget(now)
    const pending = this.list.filter((a) => a.origin === 'aula' && a.enabled && !this.state(a.id).completed).length
    return Math.max(0, Math.min(this.proactive.maxFollowupsPerDay - used, b.allows(1) ? b.runsLeft - pending : 0))
  }

  async snapshot(): Promise<AutomationsSnapshot> {
    const now = this.now()
    const items = await this.items()
    const b = this.budget(now)
    const aiReady = await this.aiReady()
    const nextItem = items.filter((i) => i.automation.enabled && i.nextRun && this.allowedNow(i.automation, now)).sort((x, y) => Date.parse(x.nextRun!) - Date.parse(y.nextRun!))[0]
    return {
      items, proactive: { ...this.proactive }, active: proactiveIsActive(this.proactive, now), running: [...this.running], unread: this.unread(now), usageToday: this.usageToday(now),
      budget: { limit: b.limit, used: b.used, estimate: b.estimate, runsLeft: b.runsLeft, exhausted: b.exhausted },
      followupsLeft: this.followupsLeft(now), health: this.health(items, now, aiReady),
      ...(nextItem ? { nextUp: { id: nextItem.automation.id, title: nextItem.automation.routine ? routineTitle(nextItem.automation.routine) : nextItem.automation.title, ...(nextItem.automation.routine ? { routine: nextItem.automation.routine } : {}), at: nextItem.nextRun! } } : {}),
      preview: await this.preview(this.proactive), chatLinked: this.env.chat() !== null, aiReady, timeZone: this.tz
    }
  }

  /** Cómo está ahora (lo más importante primero). */
  health(items: AutomationItemView[], now: number, aiReady: boolean): AutomationHealthIssue[] {
    const issues: AutomationHealthIssue[] = []
    const paused = ms(this.proactive.pausedUntil)
    if (paused !== undefined && paused > now && this.proactive.enabled) issues.push(paused > now + 300 * DAY ? { kind: 'paused' } : { kind: 'paused', until: iso(paused) })
    const active = items.filter((i) => i.automation.enabled && !i.completed && this.allowedNow(i.automation, now))
    if (active.some((i) => usesAI(i.automation)) && !aiReady) issues.push({ kind: 'noAI' })
    const signIns = Object.entries(this.book.signInNeeded).sort(([, a], [, b]) => Date.parse(a) - Date.parse(b))
    if (signIns.length) issues.push({ kind: 'signIn', site: signIns[0][0], since: signIns[0][1] })
    const aiUntil = ms(this.book.aiPausedUntil)
    if (aiUntil !== undefined && aiUntil > now) issues.push({ kind: 'aiUnavailable', until: iso(aiUntil), reason: this.book.aiPauseReason ?? tr('Tu proveedor de IA no responde', "Your AI provider isn't responding") })
    const capToday = this.book.spendingCapDay === dayKey(now, this.tz)
    if ((this.budget(now).exhausted || capToday) && active.some((i) => usesAI(i.automation))) issues.push({ kind: 'budget', resumes: iso(addDays(startOfDay(now, this.tz), 1, this.tz).getTime()) })
    for (const i of active) {
      if (this.state(i.automation.id).failureNotified && i.consecutiveFailures >= 2) issues.push({ kind: 'failing', id: i.automation.id, title: i.automation.title, message: i.lastSummary ?? '' })
    }
    return issues
  }

  // MARK: Bandeja

  private changeInbox(ids: readonly string[], body: (e: InboxEntry) => void): string[] {
    const set = new Set(ids)
    const touched: string[] = []
    for (const e of this.inbox) if (set.has(e.id)) { body(e); touched.push(e.id) }
    if (touched.length) {
      this.store.saveInbox(this.inbox)
      this.changed('inbox')
    }
    return touched
  }

  /** Leídas (o no). Devuelve las que cambiaron (para quitar sus notificaciones). */
  markRead(ids: readonly string[], read = true): string[] {
    const r = this.changeInbox(ids, (e) => { e.read = read; if (read) e.resurfaced = false })
    if (read && r.length) this.withdraw(r)
    return r
  }

  /** Todo lo visible como leído (con un filtro, solo lo de ese filtro). */
  markAllRead(filter: SwiftInboxFilter = 'all'): string[] {
    const now = this.now()
    const ids = this.inbox.filter((e) => matchesSwiftFilter(e, filter, now) && !e.read).map((e) => e.id)
    const r = this.changeInbox(ids, (e) => { e.read = true; e.resurfaced = false })
    if (r.length) this.withdraw(r)
    return r
  }

  /** Archivar (o desarchivar). Archivar también la marca como leída. */
  archive(ids: readonly string[], on = true): string[] {
    const r = this.changeInbox(ids, (e) => { e.archived = on; if (on) { e.read = true; delete e.snoozedUntil; e.resurfaced = false } })
    if (on && r.length) this.withdraw(r)
    return r
  }

  /** «Despejar»: archiva lo ya leído de más de `days` días. */
  archiveRead(days = 0): string[] {
    const now = this.now()
    const ids = this.inbox.filter((e) => e.read && !e.archived && !((ms(e.snoozedUntil) ?? 0) > now) && now - Date.parse(e.date) >= days * DAY).map((e) => e.id)
    return this.changeInbox(ids, (e) => { e.archived = true })
  }

  /** Posponer hasta `until` (`null` = deshacer). Mientras, no cuenta como sin leer ni se ve en la bandeja. */
  snooze(ids: readonly string[], until: number | null): string[] {
    const r = this.changeInbox(ids, (e) => { if (until === null) delete e.snoozedUntil; else { e.snoozedUntil = iso(until); e.archived = false } })
    if (until !== null && r.length) {
      this.book.notices.held = this.book.notices.held.filter((h) => !ids.includes(h.notice.entryID ?? ''))
      this.store.saveBook(this.book)
      this.withdraw(r)
    }
    return r
  }

  /** «Ahora no» en la oferta de preparar un examen: no se vuelve a ofrecer y la tarjeta queda hecha. */
  dismissOffer(eventID: string, entryID?: string): void {
    if (!this.book.offeredEvents.includes(eventID)) this.book.offeredEvents.push(eventID)
    this.store.saveBook(this.book)
    if (entryID) {
      this.changeInbox([entryID], (e) => {
        e.read = true
        for (const c of e.message?.cards ?? []) if (c.actions.some((x) => x.kind === 'neverForEvent' && x.value === eventID)) c.state = 'done'
      })
    }
  }

  private withdraw(ids: string[]): void {
    try { this.env.withdraw(ids) } catch { /* nada */ }
  }

  // MARK: Cambiar

  /** Valida y completa una automatización nueva o cambiada. */
  private validated(a: Automation, now: number): Automation {
    const x: Automation = { ...a, title: a.title.trim(), instruction: a.instruction.trim() }
    if (!x.title) x.title = x.instruction ? clip(x.instruction.split(/[.\n]/)[0].trim(), 60) : tr('Automatización', 'Automation')
    x.title = x.title.slice(0, 80)
    x.instruction = x.instruction.slice(0, 4000)
    if (!scheduleIsValid(x.schedule)) throw new AutomationLimitError(tr('El horario no es válido: falta la hora o la fecha.', 'The schedule is not valid: the time or date is missing.'))
    if (x.schedule.kind === 'once' && (ms(x.schedule.date) ?? 0) <= now + 30_000) throw new AutomationLimitError(tr('La fecha ya pasó: elige una hora futura.', 'That date is in the past: choose a future time.'))
    if (!x.capabilities.length) x.capabilities = [...DEFAULT_CAPABILITIES]
    x.updated = iso(now)
    return x
  }

  /** Crea o cambia una automatización desde el editor. */
  async save(d: AutomationDraft): Promise<AutomationItemView> {
    const existing = d.id ? this.list.find((a) => a.id === d.id) : undefined
    const now = this.now()
    const base: Automation = existing ?? {
      id: 'auto-' + IDs.short(8), title: '', instruction: '', schedule: d.schedule, capabilities: [], notify: 'news', untilFound: false, enabled: true, origin: 'student', platformIDs: [], created: iso(now), updated: iso(now)
    }
    const next: Automation = { ...base, title: d.title, instruction: d.instruction, schedule: d.schedule, capabilities: d.capabilities, notify: d.notify, untilFound: d.untilFound, enabled: d.enabled ?? base.enabled, ...(d.platformIDs ? { platformIDs: d.platformIDs } : {}) }
    if (d.maxRuns === null) delete next.maxRuns
    else if (d.maxRuns !== undefined) next.maxRuns = d.maxRuns
    if (d.expiresAt === null) delete next.expiresAt
    else if (d.expiresAt !== undefined) next.expiresAt = d.expiresAt
    if (d.courseID === null) delete next.courseID
    else if (d.courseID !== undefined) next.courseID = d.courseID
    if (next.untilFound && next.notify === 'chatOnly') next.notify = 'news'
    return existing ? this.update(next) : this.add(next)
  }

  async add(a: Automation): Promise<AutomationItemView> {
    const now = this.now()
    if (this.list.filter((x) => !x.routine).length >= AutomationCenter.maxAutomations) {
      throw new AutomationLimitError(tr(`Ya tienes ${AutomationCenter.maxAutomations} automatizaciones: borra alguna antes de crear otra.`, `You already have ${AutomationCenter.maxAutomations} automations: delete one before creating another.`))
    }
    const x = this.validated(a, now)
    if (this.list.some((y) => y.id === x.id)) x.id = 'auto-' + IDs.short(8)
    x.created = iso(now)
    this.list.push(x)
    this.book.states[x.id] = { ...emptyAutomationState(), lastChecked: iso(now) }
    this.store.saveAutomations(this.list)
    this.store.saveBook(this.book)
    this.changed('automations')
    void this.tick()
    return this.view(x, now, await this.events(now))
  }

  async update(a: Automation): Promise<AutomationItemView> {
    const now = this.now()
    const i = this.list.findIndex((x) => x.id === a.id)
    if (i < 0) throw new AutomationLimitError(tr('No encuentro esa automatización.', "I can't find that automation."))
    const old = this.list[i]
    const x = { ...this.validated(a, now), created: old.created, origin: old.origin, ...(old.routine ? { routine: old.routine } : {}) }
    this.list[i] = x
    const st = { ...this.state(x.id) }
    if (scheduleKey(x.schedule) !== scheduleKey(old.schedule) || (x.enabled && !old.enabled)) {
      // el horario nuevo empieza ahora (lo de antes no cuenta) y vuelve a funcionar si ya había terminado
      st.lastChecked = iso(now); delete st.retryAt; delete st.deferredUntil; delete st.deferredSlot; st.completed = false; st.retries = 0
      if (x.maxRuns !== undefined) st.runCount = 0
    }
    if (x.untilFound !== old.untilFound || x.instruction !== old.instruction) st.completed = false
    this.book.states[x.id] = st
    this.pruneQueued(now)
    this.store.saveAutomations(this.list)
    this.store.saveBook(this.book)
    this.changed('automations')
    void this.tick()
    return this.view(x, now, await this.events(now))
  }

  async setEnabled(id: string, on: boolean): Promise<AutomationItemView | null> {
    const a = this.list.find((x) => x.id === id)
    if (!a) throw new AutomationLimitError(tr('No encuentro esa automatización.', "I can't find that automation."))
    if (a.routine) { // una rutina se enciende y apaga desde el modo proactivo
      await this.setProactive(withRoutine(this.proactive, a.routine, on))
      return this.item(id)
    }
    return this.update({ ...a, enabled: on })
  }

  async remove(id: string): Promise<void> {
    const a = this.list.find((x) => x.id === id)
    if (!a) throw new AutomationLimitError(tr('No encuentro esa automatización.', "I can't find that automation."))
    if (a.routine) { await this.setProactive(withRoutine(this.proactive, a.routine, false)); return }
    this.list = this.list.filter((x) => x.id !== id)
    this.queue = this.queue.filter((j) => {
      if (j.id !== id) return true
      this.running.delete(id)
      return false
    })
    this.aborts.get(id)?.abort()
    delete this.book.states[id]
    this.store.saveAutomations(this.list)
    this.store.saveBook(this.book)
    this.store.deleteData(id)
    this.changed('automations')
  }

  /** «Ejecutar ahora». `byAssistant`: lo pide la IA del chat (prioridad normal, respeta la pausa de la IA). */
  runNow(id: string, byAssistant = false): boolean {
    const a = this.list.find((x) => x.id === id)
    if (!a || this.running.has(id)) return false
    const asked = this.now()
    this.running.add(id)
    const job: Job = { id, trigger: 'manual', slots: [{ at: asked, key: 'manual' }], byAssistant }
    if (usesAI(a)) {
      if (byAssistant) this.queue.push(job)
      else this.queue.unshift(job) // lo que pulsa el estudiante pasa delante
      this.drain()
    } else void this.execute(job)
    this.changed('runs')
    return true
  }

  /** Detiene una revisión en marcha. */
  stopRun(id: string): void {
    this.aborts.get(id)?.abort()
  }

  /** Quita de la cola lo automático que ya no toca (horario cambiado, desactivada, pausa). */
  private pruneQueued(now: number): void {
    const keep: Job[] = []
    for (const j of this.queue) {
      const a = this.list.find((x) => x.id === j.id)
      const stale = j.trigger !== 'manual' && (!a || j.plannedSchedule !== scheduleKey(a.schedule) || !this.mayStartAutomatically(a, now))
      if (stale) {
        this.running.delete(j.id)
        if (a) this.recordDiscarded(a, j, now)
      } else keep.push(j)
    }
    this.queue = keep
  }

  // MARK: Seguimientos de la IA

  async scheduleFollowup(d: FollowupDraft): Promise<AutomationItemView> {
    const now = this.now()
    if (!proactiveIsActive(this.proactive, now) || !this.proactive.followups) {
      throw new AutomationLimitError("«Aula siempre activa» is off (or follow-ups are disabled): you can't schedule follow-ups on your own. Offer it to the student instead.")
    }
    const today = dayKey(now, this.tz)
    const used = this.book.followups[today] ?? 0
    if (used >= this.proactive.maxFollowupsPerDay) {
      throw new AutomationLimitError(`Daily limit reached: you already scheduled ${used} follow-ups today. Don't schedule more; tell the student.`)
    }
    if (this.followupsLeft(now) <= 0) {
      const b = this.budget(now)
      throw new AutomationLimitError(`Today's budget for automatic tasks is almost used up (${Math.round(b.used / 1000)}k of ${Math.round(b.limit / 1000)}k tokens): don't schedule follow-ups today.`)
    }
    let when = Math.max(d.when.getTime(), now + 5 * MIN)
    if (when > now + 14 * DAY) throw new AutomationLimitError('Too far: follow-ups can be at most 14 days ahead.')
    // nunca en horas de silencio ni de madrugada: al final del silencio
    for (let i = 0; i < 3; i++) for (const q of [this.proactive.quiet, NIGHT_QUIET]) if (quietContains(q, when, this.tz)) when = quietEnd(q, when, this.tz)
    const a: Automation = {
      id: 'auto-' + IDs.short(8), title: d.title, instruction: d.instruction, schedule: { kind: 'once', times: [], weekdays: [], everyHours: 8, windowStart: '08:00', windowEnd: '22:00', date: iso(when), hoursBefore: [], eventKinds: [] },
      capabilities: d.capabilities?.length ? d.capabilities : [...DEFAULT_CAPABILITIES], notify: 'always', untilFound: false, enabled: true, origin: 'aula',
      ...(d.courseID ? { courseID: d.courseID } : {}), ...(d.threadID ? { threadID: d.threadID } : {}), ...(d.context ? { context: d.context } : {}),
      platformIDs: [], created: iso(now), updated: iso(now)
    }
    this.book.followups[today] = used + 1 // antes de esperar: dos a la vez no se saltan el límite
    try {
      return await this.add(a)
    } catch (err) {
      this.book.followups[today] = Math.max(0, (this.book.followups[today] ?? 1) - 1)
      throw err
    }
  }

  // MARK: Modo proactivo

  /** Cambia «Aula siempre activa» y deja sus rutinas como dice (las crea, cambia su horario o las apaga). */
  async setProactive(next: ProactiveSettings): Promise<void> {
    const now = this.now()
    const p: ProactiveSettings = { ...next }
    const turningOn = p.enabled && !this.proactive.enabled
    if (turningOn) p.activatedAt = iso(now)
    this.applyRoutines(p, now)
    this.proactive = p
    this.pruneQueued(now)
    this.store.saveProactive(p)
    this.store.saveAutomations(this.list)
    this.store.saveBook(this.book)
    this.changed('proactive')
    if (turningOn) {
      await this.deliverWelcome(p, now)
      // los exámenes sin curso se ofrecen ya, sin esperar a mañana
      const offers = this.list.find((x) => x.id === routineID('examOffers'))
      if (p.examOffers && offers && offers.enabled && !this.running.has(offers.id)) {
        this.running.add(offers.id)
        await this.execute({ id: offers.id, trigger: 'manual', slots: [{ at: now, key: 'welcome' }] })
      }
    }
    await this.tick()
  }

  /** Aplica un parche validado (de la interfaz) a los ajustes del modo. */
  async patchProactive(patch: Partial<ProactiveSettings>): Promise<void> {
    let p: ProactiveSettings = { ...this.proactive, ...patch }
    if (patch.style && patch.style !== 'custom') p = applyStyle(p, patch.style)
    else if (patch.dailyTokenLimit !== undefined || patch.noticesPerHour !== undefined || patch.maxFollowupsPerDay !== undefined) p = markCustomIfEdited(p)
    await this.setProactive(p)
  }

  /** Al arrancar: que las rutinas existan y coincidan con los ajustes (p. ej. tras borrar `automations.json`). */
  ensureRoutines(): void {
    const before = JSON.stringify(this.list)
    const now = this.now()
    this.applyRoutines(this.proactive, now)
    if (JSON.stringify(this.list) !== before) {
      this.store.saveAutomations(this.list)
      this.store.saveBook(this.book)
      this.changed('automations')
    }
  }

  private applyRoutines(p: ProactiveSettings, now: number): void {
    for (const r of PROACTIVE_ROUTINES) {
      const id = routineID(r)
      const on = p[r] && (p.enabled || isLight(r))
      const schedule = routineSchedule(p, r)
      const i = this.list.findIndex((x) => x.id === id)
      if (i >= 0) {
        const was = this.list[i]
        const changedSchedule = scheduleKey(schedule) !== scheduleKey(was.schedule)
        if (was.enabled === on && !changedSchedule && was.title === routineTitle(r)) continue
        this.list[i] = { ...was, schedule, enabled: on, title: routineTitle(r), updated: iso(now) }
        if ((on && !was.enabled) || changedSchedule) {
          const st = { ...this.state(id), lastChecked: iso(now) }
          delete st.deferredUntil; delete st.retryAt
          this.book.states[id] = st
        }
      } else if (on) {
        this.list.push({
          id, title: routineTitle(r), instruction: '', schedule, capabilities: routineCapabilities(r), notify: r === 'platformCheck' ? 'news' : 'always',
          untilFound: false, enabled: true, origin: 'routine', routine: r, platformIDs: [], created: iso(now), updated: iso(now)
        })
        this.book.states[id] = { ...emptyAutomationState(), lastChecked: iso(now) }
      }
    }
  }

  /** Pausa todo hasta una fecha (`null` = reanudar). */
  async pause(until: number | null): Promise<void> {
    const p = { ...this.proactive }
    if (until === null) delete p.pausedUntil
    else p.pausedUntil = iso(until)
    this.proactive = p
    this.pruneQueued(this.now())
    this.store.saveProactive(p)
    this.changed('proactive')
    await this.tick()
  }

  /** Lo próximo que harían las rutinas con estos ajustes (para explicarlo antes de encender el modo). */
  async preview(p: ProactiveSettings, days = 7, limit = 6): Promise<AutomationPreviewItem[]> {
    const now = this.now()
    const events = await this.events(now)
    const pl = this.planner()
    const horizon = now + days * DAY
    const out: AutomationPreviewItem[] = []
    for (const r of PROACTIVE_ROUTINES) {
      if (!p[r] || r === 'examOffers') continue
      const s = routineSchedule(p, r)
      if (r === 'deadlineReminders') for (const slot of pl.slots(s, now, horizon, events, 4)) out.push({ date: iso(slot.at), routine: r, detail: slot.eventTitle ?? '' })
      else for (const slot of pl.slots(s, now, horizon, [], 2)) out.push({ date: iso(slot.at), routine: r, detail: '' })
    }
    return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(0, limit)
  }

  /** El mensaje que explica qué hará «Aula siempre activa». */
  private async deliverWelcome(p: ProactiveSettings, now: number): Promise<void> {
    const lines: string[] = []
    for (const r of PROACTIVE_ROUTINES) {
      if (!p[r]) continue
      let w: string
      switch (r) {
        case 'morningBrief': w = tr(`cada día a las ${timeDisplay(p.morningTime)}`, `every day at ${timeDisplay(p.morningTime)}`); break
        case 'platformCheck': w = tr(`${weekdaysPhrase(p.platformCheckDays)} a las ${timeDisplay(p.platformCheckTime)}`, `${weekdaysPhrase(p.platformCheckDays)} at ${timeDisplay(p.platformCheckTime)}`); break
        case 'deadlineReminders': w = scheduleSummary(routineSchedule(p, r), this.tz).toLowerCase(); break
        case 'examOffers': w = tr(`cuando falten ${p.examOfferDays} días o menos`, `when ${p.examOfferDays} days or fewer are left`); break
        case 'weeklySummary': w = tr(`los ${weekdayName(p.weeklyDay)} a las ${timeDisplay(p.weeklyTime)}`, `on ${weekdayName(p.weeklyDay)}s at ${timeDisplay(p.weeklyTime)}`); break
      }
      lines.push(`- **${routineTitle(r)}** · ${w}: ${routineDetail(r)}`)
    }
    const l = limitsOf(p)
    const quiet = p.quiet.enabled ? tr(`de ${timeDisplay(p.quiet.from)} a ${timeDisplay(p.quiet.to)}`, `from ${timeDisplay(p.quiet.from)} to ${timeDisplay(p.quiet.to)}`) : tr('de 1:00 a 6:00', 'from 1:00 to 6:00')
    let text = tr('**Aula siempre activa está encendida.** Esto es lo que haré por ti:', "**Aula always on is now on.** Here's what I'll do for you:") + '\n\n' + lines.join('\n')
    text += '\n\n' + tr(`Como mucho ${l.noticesPerHour} avisos por hora (lo urgente siempre llega) y lo demás te espera en Novedades.`, `At most ${l.noticesPerHour} notifications per hour (urgent ones always arrive); the rest waits for you in your Inbox.`)
    text += '\n\n' + tr(`En tu plataforma solo leo: nunca entrego tareas, empiezo exámenes, envío mensajes ni cambio nada, y no inicio sesión por mi cuenta. No te molesto ${quiet} y no paso del presupuesto diario que elegiste.`, `On your platform I only read: I never submit work, start exams, send messages or change anything, and I don't sign in on my own. I won't disturb you ${quiet} and I stay within the daily budget you chose.`)
    const card = actionsCard(tr('Aula siempre activa', 'Aula always on'), [
      cardAction('openAutomation', tr('Ver y ajustar', 'See and adjust'), { symbol: 'sliders', prominent: true }),
      cardAction('openSettings', tr('Estilo, silencio y presupuesto', 'Style, quiet hours and budget'), { value: 'automations' })
    ], { icon: 'sun' })
    const msg = this.message(text, now, [card], { kind: 'system', title: tr('Aula siempre activa', 'Aula always on'), symbol: 'sun' })
    await this.publish({ automationID: 'proactive', runID: 'welcome-' + IDs.short(6), message: msg, kind: 'system', priority: 1, title: tr('Aula siempre activa está encendida', 'Aula always on is now on'), notice: null, late: false, now })
  }

  /** Solo desarrollo y capturas: deja una bandeja y unas automatizaciones de ejemplo (si aún no hay nada). */
  importDemo(entries: readonly InboxEntry[], automations: readonly Automation[]): void {
    if (this.inbox.length || this.list.some((a) => !a.routine)) return
    this.inbox = trimInbox([...entries])
    const now = this.now()
    for (const a of automations) {
      this.list.push(a)
      this.book.states[a.id] = { ...emptyAutomationState(), lastChecked: iso(now), runCount: 3, lastRun: iso(now - 4 * HOUR), lastOutcome: 'nothingNew' }
    }
    this.store.saveInbox(this.inbox)
    this.store.saveAutomations(this.list)
    this.store.saveBook(this.book)
    this.changed('inbox')
  }

  /** Para pruebas y la bandeja del sistema: el resumen de lo que hará, en una línea. */
  statusLine(now: number = this.now()): string {
    if (!this.proactive.enabled) return tr('Apagada', 'Off')
    if (!proactiveIsActive(this.proactive, now)) return tr('En pausa', 'Paused')
    return tr('Activa', 'On')
  }
}

function fire(st: AutomationState, keys: readonly string[]): void {
  for (const k of keys) if (!st.firedKeys.includes(k)) st.firedKeys.push(k)
  if (st.firedKeys.length > 300) st.firedKeys = st.firedKeys.slice(-300)
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export function routineCapabilities(r: ProactiveRoutine): Automation['capabilities'] {
  switch (r) {
    case 'morningBrief': case 'weeklySummary': return ['calendar', 'courses']
    case 'platformCheck': return ['platform', 'calendar', 'courses', 'study']
    case 'deadlineReminders': case 'examOffers': return ['calendar']
  }
}
