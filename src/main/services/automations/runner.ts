// Una revisión con IA (AutomationRunner.swift): arma las herramientas de solo lectura, las instrucciones y el bucle de agente,
// vigila el presupuesto que le queda (se corta a mitad si lo pasa) y traduce los fallos a «pasajero / del proveedor /
// presupuesto / detenida».
import { emptyUsage, usageTotal, type Usage } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import type { AssistantCard } from '@shared/assistant/types'
import type { HomeSummary } from '@shared/ipc/home'
import type { Automation, AutomationFinding, AutomationRun, AutomationState, ProactiveSettings } from '@shared/automations'
import { AIError, BudgetError, isCancellation, runToolLoop, withAIUse, type ChatModel } from '../ai'
import type { AutomationEnvironment } from './env'
import { systemPrompt, turnPrompt } from './prompts'
import type { RoutineEvent } from './routines'
import { RunLog, automationTools } from './tools'

/** Por qué no se pudo (y si tiene sentido reintentar). */
export class AutomationRunError extends Error {
  /** Pasajero (red, límite de uso): se reintenta con espera. */
  transient: boolean
  rateLimited: boolean
  /** Lo falló el proveedor de IA: cuenta para pausar toda la IA un rato. */
  provider: boolean
  /** Tokens que se gastaron igualmente. */
  tokens: number
  /** Se cortó porque llegó al presupuesto que le quedaba. */
  budget: boolean
  /** El presupuesto que se acabó es el tope de gasto en dinero (Ajustes → IA). */
  spendingCap: boolean
  /** Se detuvo (no es un fallo). */
  cancelled: boolean

  constructor(message: string, o: { transient: boolean; rateLimited?: boolean; provider?: boolean; tokens?: number; budget?: boolean; spendingCap?: boolean; cancelled?: boolean }) {
    super(message)
    this.name = 'AutomationRunError'
    this.transient = o.transient
    this.rateLimited = o.rateLimited ?? false
    this.provider = o.provider ?? false
    this.tokens = o.tokens ?? 0
    this.budget = o.budget ?? false
    this.spendingCap = o.spendingCap ?? false
    this.cancelled = o.cancelled ?? false
  }
}

/** Lo que devuelve una revisión con IA. */
export interface AutomationAgentOutput {
  summary: string
  findings: AutomationFinding[]
  conditionMet: boolean
  important: boolean
  skipped: string[]
  signIn?: { site: string; accountId: string }
  cards: AssistantCard[]
  created: string[]
  tokens: number
  estimated: boolean
  provider: string
  reported: boolean
  /** Páginas de la plataforma que leyó (si leyó alguna, la sesión funciona). */
  pages: number
}

export interface RunOptions {
  automation: Automation
  why: string
  state: AutomationState
  previous?: AutomationRun
  proactive: ProactiveSettings
  now: Date
  /** Lo que esta revisión puede gastar del presupuesto del día (sin valor = sin tope). */
  maxTokens?: number
  env: AutomationEnvironment
  model: ChatModel
  events: readonly RoutineEvent[]
  study: HomeSummary | null
  followup?: (draft: { title: string; instruction: string; when: Date }) => Promise<{ id: string; at: string }>
  signal?: AbortSignal
}

export async function runAutomationCheck(o: RunOptions): Promise<AutomationAgentOutput> {
  return withAIUse({ purpose: 'automation', label: o.automation.title }, () => runInner(o))
}

async function runInner(o: RunOptions): Promise<AutomationAgentOutput> {
  const a = o.automation
  const tz = o.env.timeZone()
  const log = new RunLog()
  const platforms = a.capabilities.includes('platform') ? o.env.platforms() : null
  const all = platforms?.accounts() ?? []
  const accounts = a.platformIDs.length ? all.filter((p) => a.platformIDs.includes(p.id)) : all
  const problem = platforms ? platforms.readiness() : a.capabilities.includes('platform') ? 'the platform browser is not available' : null
  const ready = !!platforms && !problem && accounts.length > 0
  const tab = 'automation-' + a.id.slice(0, 40)
  const packs = o.env.packs()
  const tools = automationTools({
    automation: a, log, events: o.events, study: o.study, packs, platforms: ready ? platforms : null, accounts, tab, now: o.now, followup: o.followup
  })
  const system = systemPrompt(o.env.language())
  const prompt = turnPrompt(a, {
    why: o.why, previous: o.previous, known: o.state.seen, baseline: !o.state.baselineDone, platforms: a.capabilities.includes('platform') ? accounts.map((x) => ({ label: x.label, url: x.url })) : [],
    browserReady: ready, browserProblem: problem ?? undefined, courses: packs.map((p) => ({ id: p.id, title: p.title, examDate: p.examDate })),
    dailyMinutes: o.study?.today.minutesGoal ?? 60, proactive: o.proactive, now: o.now, tz
  })
  const provider = [o.model.providerName, o.model.model].filter((x) => !!x).join(' · ')
  // lo gastado hasta ahora: el acumulado que da el proveedor o, si aún no dijo nada, una estimación por pasos
  const perStep = Math.max(1, Math.trunc((system.length + prompt.length) / 4))
  let usage: Usage = emptyUsage()
  let calls = 0
  const spent = () => Math.max(usageTotal(usage), calls * perStep)
  const stop = new AbortController()
  let overBudget = false
  const onParent = () => stop.abort()
  if (o.signal?.aborted) stop.abort()
  else o.signal?.addEventListener('abort', onParent, { once: true })
  let result
  try {
    result = await runToolLoop({
      model: o.model, system, prompt, tools, signal: stop.signal, maxSteps: 40, timeoutSec: 900, temperature: 0.3, maxOutputTokens: 3000,
      onEvent: (e) => {
        if (e.type === 'usage' && usageTotal(e.usage) >= usageTotal(usage)) usage = e.usage
        else if (e.type === 'toolStarted') calls++
        else if (e.type === 'finished' && usageTotal(e.result.usage) > usageTotal(usage)) usage = e.result.usage
        if (o.maxTokens !== undefined && spent() > o.maxTokens && !overBudget) {
          overBudget = true
          stop.abort()
        }
      }
    })
  } catch (err) {
    throw toRunError(err, spent(), o.signal?.aborted === true && !overBudget)
  } finally {
    o.signal?.removeEventListener('abort', onParent)
    if (ready) { try { platforms!.closeTab(tab) } catch { /* nada */ } }
  }
  if (overBudget) {
    throw new AutomationRunError(tr('Paré la revisión a medias: llegó al presupuesto de hoy para lo que Aula hace sola.', "I stopped the check halfway: it reached today's budget for what Aula does on its own."), { transient: false, tokens: spent(), budget: true })
  }
  if (result.stopReason === 'cancelled') {
    throw new AutomationRunError(tr('Se detuvo.', 'It was stopped.'), { transient: false, tokens: spent(), cancelled: true })
  }
  const report = log.report
  const text = result.text.trim()
  let tokens = usageTotal(usage) || usageTotal(result.usage)
  let estimated = false
  if (tokens === 0) {
    tokens = Math.max(spent(), Math.trunc((system.length + prompt.length + text.length) / 4) + log.pages * 2500)
    estimated = true
  }
  let summary = report?.summary.trim() ?? ''
  if (!summary) summary = text.slice(0, 2000)
  if (!summary && !report) {
    // se acabó el tiempo o los pasos (una plataforma lenta): resultado incompleto, no un fallo del proveedor
    if (result.stopReason === 'timeout' || result.stopReason === 'max_steps') {
      throw new AutomationRunError(tr('La revisión no terminó a tiempo (la plataforma iba lenta o había demasiado que leer).', "The check didn't finish in time (the platform was slow or there was too much to read)."), { transient: true, tokens })
    }
    throw new AutomationRunError(tr('Tu proveedor de IA no devolvió ningún resultado.', 'Your AI provider returned no result.'), { transient: true, provider: true, tokens })
  }
  let signIn = log.signIn
  if (!signIn && report?.needsSignIn) {
    const site = report.needsSignIn
    const acc = accounts.find((x) => x.label.toLowerCase().includes(site.toLowerCase()) || site.toLowerCase().includes(x.label.toLowerCase())) ?? accounts[0]
    signIn = { site: acc?.label ?? site, accountId: acc?.id ?? '' }
  }
  return {
    summary, findings: report?.items ?? [], conditionMet: report?.conditionMet ?? false, important: report?.important ?? false,
    skipped: [...(report?.skipped ?? []), ...log.blocked], ...(signIn ? { signIn } : {}), cards: log.cards, created: log.created,
    tokens, estimated, provider, reported: !!report, pages: log.pages
  }
}

/** Un fallo del bucle → `AutomationRunError` (pasajero, del proveedor, presupuesto o detenido). */
function toRunError(err: unknown, tokens: number, stopped: boolean): AutomationRunError {
  if (err instanceof AutomationRunError) return err
  if (stopped || isCancellation(err)) return new AutomationRunError(tr('Se detuvo.', 'It was stopped.'), { transient: false, tokens, cancelled: true })
  if (err instanceof BudgetError) return new AutomationRunError(err.message, { transient: false, tokens, budget: true, spendingCap: true })
  if (err instanceof AIError) {
    const transient = err.kind === 'network' || err.kind === 'rateLimited' || err.kind === 'timeout' || (err.kind === 'http' && (err.status ?? 500) >= 500) || (err.kind === 'badResponse' && (err.status ?? 0) >= 500)
    const noProvider = err.code === 'ai_no_provider' || err.kind === 'missingKey' || err.kind === 'notInstalled' || err.kind === 'notLoggedIn'
    return new AutomationRunError(err.message, { transient: transient && !noProvider, rateLimited: err.kind === 'rateLimited' || err.status === 429, provider: transient, tokens })
  }
  return new AutomationRunError(err instanceof Error ? err.message : String(err), { transient: true, provider: true, tokens })
}
