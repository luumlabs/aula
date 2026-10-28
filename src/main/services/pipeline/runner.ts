// Orquesta la creación (o ampliación) de un curso con IA, por etapas y de forma reanudable (port de
// StudyEngine/Pipeline/GenerationPipeline.swift):
//   preparar → reunir materiales → plan → habilidades → glosario/fórmulas/simulacro → verificación independiente → revisión final.
// En modo equipo (por defecto) varios agentes trabajan a la vez: lectores antes del plan, lección y práctica de cada habilidad en
// paralelo, verificación en cuanto cada habilidad está escrita, y glosario y fórmulas a la vez; `AgentGate` limita cuántos.
// Todo lo que la IA crea se guarda mediante herramientas que validan; esta clase decide el orden, reintenta y registra. El
// registro (`runs/<run>.json`) se guarda en cada cambio: si se cierra la app, la ejecución se reanuda donde quedó.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { CourseLanguages } from '@engine/base/language'
import { LiveCalculator } from '@engine/math'
import {
  addUsage, auditSkill, adjudicatorPrompt, courseContext, courseDigest, crossCuttingPartPrompt, crossCuttingPrompt, DEPTHS, encodeRunState, extendPrompt, fallbackBlueprint,
  gatherPrompt, gatherSystem, goalKindIsSure, goalKindOf, isExtend, knownExamOf, linkPractice, materialsMap, MAX_AGENTS, missingCrossCutting, newRunID, newRunState, planPrompt, prepareForResume,
  readerPrompt, readerSystem, readingGroups, runProgress, skillPartPrompt, skillPrompt, solverPrompt, splitSharedContext, systemPrompt, uiRoleFor, usesTeam, usuallyHasExam, decodeRunState,
  countContent, type AuditProblem, type ContentCounts, type CrossPart, type GenerationRequest, type GenerationRunState, type GenerationStage, type LaneRecord, type PipelineRole, type PromptCourse, type SkillPart,
  type SkillRunState, type StageStatus
} from '@engine/pipeline'
import type { AgentEvent, AgentResult } from '@shared/ai/types'
import { aiLocale, tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import type { PageRasterizer } from '@shared/ingest'
import type { Pack, Skill } from '@shared/schema'
import { AIError, BudgetError, withAIUse } from '../ai'
import { classificationText } from '../ai/errors'
import type { AIUseScope } from '../costs'
import { QuestionBroker, NO_ANSWER } from '../agents/questions'
import { log } from '../log'
import { ChangeContext, type Library, type PackStore } from '../store'
import { boundValidator } from '../study/assets'
import { courseDuplicateExercises, duplicateToDrop } from '@engine/content/duplicates'
import {
  applyVerification, findingsBrief, loadFindings, isVerifiable, loadDigests, makeTools, requestTextForGate, RunWebGate, VerificationStore, type CampusProviding, type PlatformAccess, type SourceImporting,
  type SourceSearching, type ToolContext, type ToolSet, type WebAccess, type Calculating
} from '../tools'
import type { ChangeActor } from '@shared/schema/history'
import type { AgentTask, PipelineAgents } from './agents'
import { AgentGate, Countdown, forEachLimited, type GatePriority } from './gate'
import { briefToolResult, describeTool } from './labels'
import { countWebCall, researchNote, WEB_TOOLS } from './report'
import { isUnreachable, retryDecision, waitingText } from './retry'

/** Servicios que usan las herramientas durante la generación (se inyectan: así se prueba sin red). */
export interface PipelineServices {
  search?: (store: PackStore) => SourceSearching
  web?: WebAccess
  calc?: Calculating
  campus?: CampusProviding
  importer?: (store: PackStore) => SourceImporting
  /** El navegador de plataformas para «Reunir materiales» y «Pedir cambios» (undefined = no hay). */
  browser?: (request: GenerationRequest) => PlatformAccess | undefined
  rasterizer?: PageRasterizer
}

export interface PipelineOptions {
  library: Library
  request: GenerationRequest
  agents: PipelineAgents
  services?: PipelineServices
  /** Id de una ejecución anterior (interrumpida) para continuarla donde quedó. */
  resumeRunID?: string
  /** Cada cambio del registro (ya guardado) y de las preguntas pendientes. */
  onChange?: (p: GenerationPipeline) => void
  now?: () => Date
}

/** Un fallo que para la ejecución entera (los demás agentes no empiezan); queda para reanudar. */
class FatalStop extends Error {}

/** Se paró por un límite de uso (tope de gasto o límite del proveedor): se reanuda más tarde. */
export class LimitStop extends Error {
  constructor(message: string, readonly resumeAt?: Date, readonly code = 'ai_rate_limit') {
    super(message)
    this.name = 'LimitStop'
  }
}

const FATAL_KINDS = new Set(['missingKey', 'notInstalled', 'notLoggedIn', 'unsupported'])

function isCancelled(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof AIError && err.kind === 'cancelled') || (err instanceof Error && err.name === 'AbortError')
}

/** Sin red (tras su reintento rápido) vale para todos los agentes: se para la ejecución entera en vez de dejar que cada uno espere. */
function isOffline(err: unknown): boolean {
  return err instanceof AIError && err.kind === 'network' && isUnreachable(classificationText(err))
}

function isFatal(err: unknown): boolean {
  return err instanceof BudgetError || err instanceof LimitStop || err instanceof FatalStop || (err instanceof AIError && FATAL_KINDS.has(err.kind)) || isOffline(err)
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export class GenerationPipeline {
  readonly runID: string
  readonly store: PackStore
  readonly broker = new QuestionBroker()
  private state: GenerationRunState
  private readonly agents: PipelineAgents
  private readonly services: PipelineServices
  private readonly gate: AgentGate
  private readonly controller = new AbortController()
  private readonly onChange?: (p: GenerationPipeline) => void
  private readonly now: () => Date
  private fatal: Error | undefined
  private runningAgents = 0
  private verifyStarted = false
  private verifyDone = 0
  private browserCache: PlatformAccess | null | undefined
  /** Qué direcciones puede abrir el equipo en esta ejecución (A2-P1-1): una para todos los agentes. */
  private webGateCache: RunWebGate | undefined
  private lanesDirty = false
  private laneTimer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<GenerationRunState> | undefined

  constructor(o: PipelineOptions) {
    const store = o.library.openPack(o.request.packID)
    if (!store) throw new AIError('other', tr(`No encuentro el curso «${o.request.packID}».`, `I can't find the course “${o.request.packID}”.`))
    this.store = store
    this.agents = o.agents
    this.services = o.services ?? {}
    this.onChange = o.onChange
    this.now = o.now ?? (() => new Date())
    const saved = o.resumeRunID ? GenerationPipeline.loadRun(store, o.resumeRunID) : undefined
    if (saved) {
      this.state = prepareForResume(saved)
      this.runID = saved.runID
    } else {
      this.runID = newRunID(this.now(), IDs.short(3))
      this.state = newRunState(this.runID, o.request, this.now())
    }
    this.gate = new AgentGate(Math.min(this.state.request.maxParallel, this.agents.maxConcurrency ?? MAX_AGENTS))
    this.broker.onChange(() => this.changed())
    this.save()
  }

  // MARK: Registros

  static loadRun(store: PackStore, runID: string): GenerationRunState | undefined {
    return store.loadJSON('runs', runID, decodeRunState)
  }

  /** Ejecuciones anteriores de un curso, la más reciente primero (para «Reanudar»). */
  static previousRuns(store: PackStore): GenerationRunState[] {
    return store.listNames('runs').filter((n) => n.startsWith('run-') && !n.includes('.'))
      .map((n) => GenerationPipeline.loadRun(store, n)).filter((s): s is GenerationRunState => !!s)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  get currentState(): GenerationRunState {
    return this.state
  }

  get request(): GenerationRequest {
    return this.state.request
  }

  get isRunning(): boolean {
    return this.running !== undefined && !this.state.finishedAt
  }

  /** Habilidades ya verificadas (para el avance de la etapa de verificación). */
  get verifiedSkills(): number {
    return this.verifyDone
  }

  get peakAgents(): number {
    return this.gate.peak
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Guarda el mayor avance mostrado (detener, reanudar o una verificación que se repite no lo hacen retroceder). */
  private trackProgress(): void {
    const p = Math.round(runProgress(this.state, false, this.verifyDone) * 1000) / 1000
    if (p > (this.state.aula2.progress ?? 0)) this.state.aula2.progress = p
  }

  private save(): void {
    this.trackProgress()
    try { this.store.saveJSON(encodeRunState(this.state), 'runs', this.runID) } catch (err) { log.warn('[pipeline] no se pudo guardar el registro', err) }
  }

  private changed(): void {
    this.trackProgress()
    try { this.onChange?.(this) } catch (err) { log.warn('[pipeline] aviso de cambio', err) }
  }

  private mutate(body: (s: GenerationRunState) => void): void {
    body(this.state)
    this.save()
    this.changed()
  }

  /** Los carriles cambian a cada herramienta: se avisa al momento y se guardan, como mucho, cada segundo. */
  private laneChanged(): void {
    this.lanesDirty = true
    this.changed()
    if (this.laneTimer) return
    this.laneTimer = setTimeout(() => {
      this.laneTimer = undefined
      if (this.lanesDirty) { this.lanesDirty = false; this.save() }
    }, 1000)
    this.laneTimer.unref?.()
  }

  private stage(s: GenerationStage, status: StageStatus, detail: string): void {
    this.mutate((st) => { st.stages[s] = status; if (status === 'done' || status === 'skipped' || status === 'failed') st.summaries[s] = detail; else if (detail) st.summaries[s] = detail })
  }

  private updateSkill(id: string, body: (s: SkillRunState) => void): void {
    this.mutate((st) => { const s = st.skills.find((k) => k.id === id); if (s) body(s) })
  }

  private setFatal(e: Error): void {
    if (!this.fatal) this.fatal = e
  }

  private checkCancelled(): void {
    if (this.controller.signal.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
  }

  /** Añade datos al registro (el evento del calendario, la petición que recogió) y lo guarda. */
  annotate(body: (s: GenerationRunState) => void): void {
    this.mutate(body)
  }

  // MARK: Control

  /** Detiene la ejecución (queda guardada para reanudarla). */
  cancel(): void {
    this.controller.abort()
  }

  /** El estudiante responde una pregunta de la IA. */
  answer(questionID: string, text: string): boolean {
    return this.broker.answer(questionID, text)
  }

  /** Quién firma lo que escribe esta ejecución en el historial (el mismo grupo al reanudarla). */
  get changeActor(): ChangeActor {
    const r = this.state.request
    const label = r.mode.kind === 'create' ? tr(`Crear el curso «${r.title}»`, `Create the course “${r.title}”`) : tr(`Pedir cambios: ${r.mode.instruction}`, `Requested changes: ${r.mode.instruction}`)
    return { kind: 'pipeline', group: `pipeline-${this.runID}`, label: Array.from(label).slice(0, 300).join(''), courseID: r.packID }
  }

  private get aiScope(): AIUseScope {
    return { purpose: 'course', courseID: this.state.request.packID, label: this.changeActor.label }
  }

  /** Dentro del contexto de la ejecución: el historial de cambios y el coste del curso. */
  private within<T>(fn: () => T): T {
    return ChangeContext.run(this.changeActor, () => withAIUse(this.aiScope, fn))
  }

  /** Arranca la generación. La promesa no falla: el resultado queda en el registro (`aula2.state`). */
  run(): Promise<GenerationRunState> {
    if (!this.running) this.running = this.within(() => this.execute())
    return this.running
  }

  private async execute(): Promise<GenerationRunState> {
    this.mutate((s) => { s.aula2.state = 'running' })
    try {
      this.checkCancelled()
      if (isExtend(this.state.request)) {
        // lo que había antes de los cambios (al reanudar se conserva el de la primera vez)
        if (!this.state.aula2.baseline) { const b = this.contentCounts(); this.mutate((s) => { s.aula2.baseline = b }) }
        await this.prepare()
        this.checkSpending(); await this.extendStage(this.state.request.mode.instruction, this.state.request.mode.skill)
        this.checkSpending(); await this.verifyStage(true)
        this.checkSpending(); await this.polishStage()
      } else {
        await this.prepare()
        this.checkSpending(); await this.gatherStage()
        this.checkSpending(); await this.planStage()
        if (usesTeam(this.state.request)) {
          this.checkSpending(); await this.teamBuildStage()
        } else {
          this.checkSpending(); await this.authorStage()
          this.checkSpending(); await this.crossCuttingStage(false)
          this.checkSpending(); await this.verifyStage(false)
        }
        this.checkSpending(); await this.polishStage()
      }
      const research = this.researchNote()
      this.mutate((s) => {
        s.finishedAt = this.now().toISOString(); s.aula2.state = 'done'; s.aula2.notes = this.reportNotes(research)
        if (research) s.aula2.researchNote = research; else delete s.aula2.researchNote
      })
    } catch (err) {
      this.finishWithError(err)
    } finally {
      if (this.laneTimer) { clearTimeout(this.laneTimer); this.laneTimer = undefined }
      this.closeLanes()
      this.save()
      this.changed()
    }
    return this.state
  }

  private finishWithError(err: unknown): void {
    const at = this.now().toISOString()
    if (isCancelled(err, this.controller.signal) && !(err instanceof LimitStop) && !(err instanceof BudgetError)) {
      // «Detener»: una creación queda en pausa (se reanuda o se queda con lo que hay); una ampliación, detenida
      this.mutate((s) => { s.cancelled = true; s.finishedAt = at; s.aula2.state = isExtend(s.request) ? 'cancelled' : 'paused' })
      return
    }
    if (err instanceof BudgetError || err instanceof LimitStop) {
      const resume = err instanceof BudgetError ? (err.resumesAt !== undefined ? new Date(err.resumesAt) : undefined) : err.resumeAt
      this.mutate((s) => {
        s.failure = err.message; s.finishedAt = at; s.aula2.state = 'limit'; s.aula2.errorCode = err instanceof BudgetError ? 'ai_budget' : err.code
        if (resume) s.aula2.resumeAt = resume.toISOString()
      })
      return
    }
    log.warn(`[pipeline] ${this.runID} falló`, err)
    this.mutate((s) => {
      s.failure = errorText(err); s.finishedAt = at; s.aula2.state = 'failed'
      if (err instanceof AIError) s.aula2.errorCode = err.code
    })
  }

  /** Los carriles que quedaron trabajando (al parar) se cierran. */
  private closeLanes(): void {
    const at = this.now().toISOString()
    for (const l of this.state.aula2.lanes) if (l.status === 'working') { l.status = 'done'; l.finishedAt = at }
  }

  /** ¿Se llegó al tope de gasto de hoy? Se para entre etapas en vez de dejar trabajo a medias. */
  private checkSpending(): void {
    this.checkCancelled()
    try { this.agents.checkBudget?.() } catch (err) { if (err instanceof Error) this.setFatal(err); throw err }
  }

  private loadPack(): Pack {
    return this.store.loadPack()
  }

  private loadSkill(id: string): Skill | undefined {
    if (!this.store.hasSkill(id)) return undefined
    try { return this.store.loadSkill(id) } catch { return undefined }
  }

  private promptCourse(pack: Pack = this.loadPack()): PromptCourse {
    return { pack, firstChunk: (id) => this.store.loadChunks(id)[0]?.text, digests: loadDigests(this.store, pack) }
  }

  private lang(): 'es' | 'en' {
    return tr('es', 'en') === 'en' ? 'en' : 'es'
  }

  // MARK: Etapas

  private async prepare(): Promise<void> {
    if (this.state.stages.prepare === 'done') return
    const r = this.state.request
    this.stage('prepare', 'running', tr('Revisando materiales', 'Checking materials'))
    this.checkCancelled()
    const pack = this.loadPack()
    const hasSources = pack.sources.length > 0
    if (!hasSources && !r.gather && !r.topics.trim() && !r.allowWeb && !pack.skills.length) {
      this.stage('prepare', 'failed', tr('Sin material', 'No material'))
      throw new AIError('other', tr('No tengo de dónde sacar el contenido: añade materiales, escribe el temario o permite la búsqueda en internet.',
        "I have nothing to build the content from: add materials, write the topics or allow web search."))
    }
    this.store.updatePack((p) => {
      if (!p.title || p.title === 'Nuevo curso') p.title = r.title
      if (!p.subject) p.subject = r.subject
      p.language = r.language
      const goal = { title: r.title, subject: r.subject, topics: r.topics, examDate: r.examDate, examNotes: r.examNotes, goalKind: r.goalKind }
      // un tema nuevo, código o una habilidad sin fecha ni formato de examen va a su ritmo
      if (r.mode.kind === 'create' && p.selfPaced === undefined && !r.examDate && !r.examNotes && !knownExamOf(goal) && !usuallyHasExam(goalKindOf(goal))) p.selfPaced = true
      // la clase de meta elegida (o deducida sin dudas) queda en el curso: la corrección la usa (idiomas: huecos exactos)
      if (r.mode.kind === 'create' && p.goalKind === undefined && goalKindIsSure(goal)) p.goalKind = goalKindOf(goal)
      if (r.examDate || r.examNotes) {
        const e = p.exam ? { ...p.exam } : { title: r.goal || CourseLanguages.examTitle(CourseLanguages.of(r.language)) }
        if (r.examDate) e.date = r.examDate
        if (r.examNotes && e.notes === undefined) e.notes = r.examNotes
        p.exam = e
      }
    })
    if (r.mode.kind === 'create') {
      try { this.store.updateProgress((p) => { p.settings.lessonMode = r.lessonMode }) } catch { /* sin progreso aún */ }
    }
    const noTopics = !r.topics.trim()
    this.stage('prepare', 'done', hasSources ? tr(`${pack.sources.length} material(es)`, `${pack.sources.length} material(s)`)
      : r.gather ? tr('Sin materiales todavía: los buscaré', 'No materials yet: I will look for them')
        : noTopics && r.allowWeb ? tr('Sin materiales: investigaré en fuentes oficiales y abiertas', 'No materials: I will research official and open sources')
          : tr('Sin materiales: usaré el temario', 'No materials: I will use the topic list'))
  }

  private seedSkillStates(pack: Pack): void {
    this.mutate((st) => {
      for (const ref of pack.skills) if (!st.skills.some((s) => s.id === ref.id)) st.skills.push({ id: ref.id, title: ref.title, status: 'pending', attempts: 0, note: '', openIssues: 0 })
      st.skills = st.skills.filter((s) => pack.skills.some((r) => r.id === s.id))
      for (const s of st.skills) { const r = pack.skills.find((x) => x.id === s.id); if (r) s.title = r.title }
    })
  }

  private async planStage(): Promise<void> {
    if (this.state.stages.plan === 'done') {
      const p = this.loadPack()
      if (p.skills.length) { this.seedSkillStates(p); this.stage('plan', 'done', this.state.summaries.plan || tr('Plan ya hecho', 'Plan already done')); return }
    }
    if (usesTeam(this.state.request)) await this.readStep()
    this.stage('plan', 'running', tr('Leyendo tus materiales y diseñando el curso', 'Reading your materials and designing the course'))
    for (let attempt = 1; ; attempt++) {
      let prompt = planPrompt(this.state.request, this.promptCourse())
      if (attempt > 1) prompt += '\n\nIMPORTANT: your previous attempt ended without a saved plan. Read quickly and call `set_course_plan` NOW.'
      await this.runAgent({ role: 'planner', set: { kind: 'planner' }, stage: 'plan', prompt, maxSteps: 45, timeoutSec: 1500 })
      if (this.loadPack().skills.length) break
      if (attempt >= 2) {
        this.stage('plan', 'failed', tr('Sin plan', 'No plan'))
        throw new AIError('badResponse', tr('La IA no llegó a guardar un plan del curso. Prueba con otro modelo o añade más detalle al temario.', "The AI didn't manage to save a course plan. Try another model or add more detail to the topics."))
      }
    }
    const pack = this.loadPack()
    this.seedSkillStates(pack)
    this.stage('plan', 'done', tr(`${pack.skills.length} habilidades en ${pack.units.length} unidades`, `${pack.skills.length} skills in ${pack.units.length} units`))
  }

  /** Reunir materiales de la plataforma de estudio antes de planificar. */
  private async gatherStage(): Promise<void> {
    const g = this.state.request.gather
    if (!g) { this.stage('gather', 'skipped', ''); return }
    if (this.state.stages.gather !== 'done') await this.runGather()
    const pack = this.loadPack()
    const r = this.state.request
    if (!pack.sources.length && !r.topics.trim() && !r.allowWeb && !pack.skills.length) {
      throw new AIError('other', tr('No encontré materiales que usar. Revisa tu plataforma de estudio (o añade los archivos tú), o escribe el temario.', "I didn't find any materials to use. Check your study platform (or add the files yourself), or write the topics."))
    }
  }

  private browser(): PlatformAccess | undefined {
    if (this.browserCache === undefined) this.browserCache = this.services.browser?.(this.state.request) ?? null
    return this.browserCache ?? undefined
  }

  private async runGather(): Promise<void> {
    const g = this.state.request.gather
    if (!g) return
    const browser = this.browser()
    const campus = this.services.campus
    if (!browser && !campus) {
      const why = tr(`No hay ninguna plataforma de estudio conectada: añádela en ${settingsPath('platforms', 'es')}.`, `No study platform is connected: add it in ${settingsPath('platforms', 'en')}.`)
      this.stage('gather', 'skipped', why)
      return
    }
    const places = browser?.places ?? []
    const place = places.length ? places.map((p) => p.name).slice(0, 3).join(', ') : tr('tu plataforma de estudio', 'your study platform')
    this.stage('gather', 'running', tr(`Buscando tus materiales en ${place}`, `Looking for your materials in ${place}`))
    const before = new Set(this.loadPack().sources.map((s) => s.id))
    const prompt = gatherPrompt(this.state.request, g, this.promptCourse(), places, { browser: !!browser, campus: !!campus, canvas: !!campus?.canvas })
    try {
      await this.runAgent({ role: 'gatherer', set: { kind: 'gatherer' }, stage: 'gather', prompt, maxSteps: 90, timeoutSec: 2400, system: gatherSystem(this.state.request), lane: tr(`Buscador en ${place}`, `Searcher in ${place}`), computer: true })
    } catch (err) {
      if (isFatal(err) || isCancelled(err, this.controller.signal)) { if (!isCancelled(err, this.controller.signal)) this.stage('gather', 'failed', errorText(err)); throw err }
      log.warn('[pipeline] la búsqueda de materiales se cortó', err)
    }
    const f = loadFindings(this.store, this.runID)
    const brief = f ? findingsBrief(f) : ''
    if (brief) this.mutate((s) => { s.request = { ...s.request, gatherFindings: brief } })
    const added = this.loadPack().sources.filter((s) => !before.has(s.id))
    if (added.length && this.state.request.sourceIDs.length) {
      // si el estudiante eligió materiales concretos, lo traído se suma a esa lista
      this.mutate((s) => { s.request = { ...s.request, sourceIDs: [...s.request.sourceIDs, ...added.map((a) => a.id)] } })
    }
    const names = added.slice(0, 3).map((a) => a.title).join(', ') + (added.length > 3 ? '…' : '')
    this.stage('gather', 'done', added.length ? tr(`${added.length} material(es) nuevo(s): ${names}`, `${added.length} new material(s): ${names}`) : tr('No encontré materiales nuevos', "I didn't find new materials"))
  }

  /** Equipo: varios lectores hacen a la vez la ficha de los materiales; el planificador parte de ellas. */
  private async readStep(): Promise<void> {
    let pack: Pack
    try { pack = this.loadPack() } catch { return }
    const r = this.state.request
    const allowed = new Set([...r.sourceIDs, ...r.exampleSourceIDs])
    const have = new Set(loadDigests(this.store, pack).map((d) => d.sourceID))
    const todo = pack.sources.filter((s) => (allowed.size === 0 || allowed.has(s.id)) && s.status === 'ready' && s.characters > 0 && !have.has(s.id))
    const groups = readingGroups(todo.map((s) => ({ id: s.id, characters: s.characters })), r.maxParallel)
    // solo merece la pena si hay bastante que leer (al menos dos lectores) o si quedaron fichas a medias
    if (!(groups.length >= 2 || (groups.length > 0 && have.size > 0))) return
    this.stage('plan', 'running', tr(`${groups.length} lectores leen tus materiales a la vez`, `${groups.length} readers read your materials at the same time`))
    const course = this.promptCourse(pack)
    await Promise.all(groups.map(async (ids) => {
      const titles = pack.sources.filter((s) => ids.includes(s.id)).map((s) => s.title)
      const lane = titles.length === 1 ? tr(`Lector · ${titles[0]}`, `Reader · ${titles[0]}`) : tr(`Lector · ${titles.length} materiales`, `Reader · ${titles.length} materials`)
      try {
        await this.runAgent({ role: 'reader', set: { kind: 'reader', sources: ids }, stage: 'plan', prompt: readerPrompt(r, ids, course), maxSteps: 10 + ids.length * 10, timeoutSec: 1200, system: readerSystem(r), lane })
      } catch (err) {
        if (isFatal(err) || isCancelled(err, this.controller.signal)) throw err
        log.info(`[pipeline] un lector no terminó (${errorText(err)}); el planificador leerá esos materiales`)
      }
    }))
  }

  private async authorStage(): Promise<void> {
    const todo = this.state.skills.filter((s) => s.status !== 'done' && s.status !== 'needsReview')
    if (!todo.length) { this.stage('author', 'done', tr('Todas las habilidades ya estaban listas', 'All skills were already ready')); return }
    this.stage('author', 'running', tr(`${todo.length} habilidad(es) por escribir`, `${todo.length} skill(s) to write`))
    await forEachLimited(todo.map((s) => s.id), this.state.request.maxParallel, (id) => this.authorSkill(id))
    this.checkCancelled()
    if (this.fatal) { this.stage('author', 'failed', this.fatal.message); throw this.fatal }
    const e = this.finishAuthorStage()
    if (e) throw e
  }

  private async authorSkill(id: string): Promise<void> {
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.controller.signal.aborted || this.fatal) return
      this.updateSkill(id, (s) => { s.status = attempt === 1 ? 'running' : 'repairing'; s.attempts = attempt })
      try {
        const pack = this.loadPack()
        const ref = pack.skills.find((s) => s.id === id)
        if (!ref) return
        if (attempt === 1 && usesTeam(this.state.request) && !this.hasContent(id)) {
          await this.writeSkillAsTeam(ref.id, ref.title, pack)
        } else {
          const issues = attempt === 1 ? [] : this.problems(id)
          const prompt = skillPrompt(this.state.request, this.promptCourse(pack), ref, issues, attempt)
          await this.runAgent({
            role: 'author', set: { kind: 'skillAuthor', skill: id }, stage: 'author', skill: id, prompt, maxSteps: DEPTHS[this.state.request.depth].maxSteps, timeoutSec: 1800,
            shared: this.sharedCourseContext(pack), lane: attempt === 1 ? tr(`Autor · ${ref.title}`, `Author · ${ref.title}`) : tr(`Repaso · ${ref.title}`, `Review · ${ref.title}`),
            priority: attempt === 1 ? 'normal' : 'high'
          })
        }
      } catch (err) {
        if (isCancelled(err, this.controller.signal)) return
        if (isFatal(err)) { if (err instanceof Error) this.setFatal(err); return }
        this.updateSkill(id, (s) => { s.note = `Error: ${errorText(err)}` })
        if (attempt === maxAttempts) { this.updateSkill(id, (s) => { s.status = this.loadSkill(id)?.lesson.length ? 'needsReview' : 'failed' }); return }
        continue
      }
      if (usesTeam(this.state.request)) this.linkPractice(id)
      const remaining = this.audit(id)
      this.persistAudit(id)
      if (!remaining.length) { this.updateSkill(id, (s) => { s.status = 'done'; s.openIssues = 0; s.note = '' }); return }
      this.updateSkill(id, (s) => { s.openIssues = remaining.length; s.note = remaining[0]?.forUser ?? '' })
    }
    // agotados los intentos: se deja con lo que hay y se marca para revisión
    const left = this.audit(id)
    this.updateSkill(id, (s) => { s.status = this.loadSkill(id)?.lesson.length ? 'needsReview' : 'failed'; s.openIssues = left.length; s.note = left[0]?.forUser ?? '' })
  }

  private hasContent(id: string): boolean {
    const s = this.loadSkill(id)
    return !!s && (s.lesson.length > 0 || s.exercises.length > 0)
  }

  /** Equipo: la lección y la práctica de una habilidad las escriben dos agentes a la vez. */
  private async writeSkillAsTeam(id: string, title: string, pack: Pack): Promise<void> {
    await Promise.all((['lesson', 'practice'] as SkillPart[]).map((part) => this.writePart(part, id, title, pack)))
  }

  private async writePart(part: SkillPart, id: string, title: string, pack: Pack): Promise<void> {
    const ref = pack.skills.find((s) => s.id === id)
    if (!ref) return
    const set: ToolSet = part === 'lesson' ? { kind: 'lessonAuthor', skill: id } : { kind: 'practiceAuthor', skill: id }
    const lane = part === 'lesson' ? tr(`Lección · ${title}`, `Lesson · ${title}`) : tr(`Ejercicios · ${title}`, `Exercises · ${title}`)
    try {
      await this.runAgent({
        role: 'author', set, stage: 'author', skill: id, prompt: skillPartPrompt(part, this.state.request, this.promptCourse(pack), ref),
        maxSteps: Math.max(24, Math.floor((DEPTHS[this.state.request.depth].maxSteps * 3) / 4)), timeoutSec: 1500, shared: this.sharedCourseContext(pack), lane, part
      })
    } catch (err) {
      if (isFatal(err) || isCancelled(err, this.controller.signal)) throw err
      // la otra mitad sigue; lo que falte lo completa el intento de reparación
      log.info(`[pipeline] ${lane}: ${errorText(err)}`)
    }
  }

  /** Equipo: los «Pruébalo» se enlazan con los ejercicios reales del compañero. */
  private linkPractice(id: string): void {
    if (!this.store.hasSkill(id)) return
    try {
      this.store.updateSkill(id, (s) => { const linked = linkPractice(s, this.state.request.language); s.lesson = linked.lesson })
    } catch (err) { log.warn('[pipeline] no se pudo enlazar la práctica', err) }
  }

  /** Auditoría independiente de la IA: errores del validador + mínimos de cobertura. Lista vacía = habilidad lista. */
  audit(id: string): AuditProblem[] {
    const skill = this.loadSkill(id)
    let pack: Pack | undefined
    try { pack = this.loadPack() } catch { pack = undefined }
    const issues = skill ? boundValidator(this.store).checkSkill(skill, pack) : []
    return auditSkill(skill, this.state.request.depth, issues, this.lang())
  }

  problems(id: string): string[] {
    return this.audit(id).map((p) => p.forAI)
  }

  private persistAudit(id: string): void {
    const skill = this.loadSkill(id)
    if (!skill) return
    let pack: Pack | undefined
    try { pack = this.loadPack() } catch { pack = undefined }
    const issues = boundValidator(this.store).checkSkill(skill, pack)
    const ok = this.problems(id).length === 0
    try { this.store.updateSkill(id, (s) => { s.issues = issues; s.status = ok ? 'ready' : 'needsReview' }) } catch { /* sin escribir */ }
  }

  private finishAuthorStage(): Error | undefined {
    const st = this.state.skills
    const ok = st.filter((s) => s.status === 'done' || s.status === 'verifying').length
    const review = st.filter((s) => s.status === 'needsReview').length
    const failed = st.filter((s) => s.status === 'failed').length
    if (ok + review === 0) {
      this.stage('author', 'failed', tr('Ninguna habilidad se completó', 'No skill was completed'))
      return new AIError('badResponse', tr('La IA no consiguió escribir ninguna habilidad. Revisa el modelo elegido o inténtalo de nuevo.', "The AI couldn't write any skill. Check the chosen model or try again."))
    }
    const parts = [tr(`${ok} lista(s)`, `${ok} ready`)]
    if (review) parts.push(tr(`${review} por revisar`, `${review} to review`))
    if (failed) parts.push(tr(`${failed} fallida(s)`, `${failed} failed`))
    this.stage('author', 'done', parts.join(', '))
    return undefined
  }

  private async crossCuttingStage(team: boolean): Promise<void> {
    if (this.state.stages.crossCutting === 'done') return
    this.stage('crossCutting', 'running', team ? tr('Glosario, fórmulas y simulacro · 2 agentes a la vez', 'Glossary, formulas and mock exam · 2 agents at once') : tr('Glosario, hoja de fórmulas y simulacro', 'Glossary, formula sheet and mock exam'))
    const skillsOf = (p: Pack): Skill[] => p.skills.map((r) => this.loadSkill(r.id)).filter((s): s is Skill => !!s)
    if (team) {
      // el glosario por un lado; fórmulas y simulacro por otro
      const pack = this.loadPack()
      const digest = courseDigest(pack, (id) => this.loadSkill(id))
      const course = this.promptCourse(pack)
      const errors: unknown[] = []
      await Promise.all((['glossary', 'formulasAndBlueprint'] as CrossPart[]).map(async (part) => {
        try {
          await this.runAgent({
            role: 'crossCutting', set: { kind: 'crossCutting' }, stage: 'crossCutting', prompt: crossCuttingPartPrompt(part, this.state.request, course, digest), maxSteps: 28, timeoutSec: 1200,
            lane: part === 'glossary' ? tr('Glosario', 'Glossary') : tr('Fórmulas y simulacro', 'Formulas and mock exam'), priority: 'high', cross: part
          })
        } catch (err) { errors.push(err) }
      }))
      this.checkCancelled()
      for (const e of errors) {
        if (isFatal(e) || isCancelled(e, this.controller.signal)) throw e
        log.info(`[pipeline] glosario/fórmulas: ${errorText(e)}`)
      }
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const pack = this.loadPack()
      const missing = missingCrossCutting(pack, skillsOf(pack))
      if (team && !missing.length) break
      const digest = courseDigest(pack, (id) => this.loadSkill(id))
      let prompt = crossCuttingPrompt(this.state.request, this.promptCourse(pack), digest)
      if (attempt > 1 || team) prompt += `\n\nStill missing: ${missing.join(', ')}. Do them now.`
      try {
        await this.runAgent({ role: 'crossCutting', set: { kind: 'crossCutting' }, stage: 'crossCutting', prompt, maxSteps: 40, timeoutSec: 1500, priority: 'high', cross: 'glossary' })
      } catch (err) {
        if (isFatal(err) || isCancelled(err, this.controller.signal)) throw err
        log.info(`[pipeline] contenido transversal: ${errorText(err)}`)
      }
      const after = this.loadPack()
      if (!missingCrossCutting(after, skillsOf(after)).length) break
    }
    if (!this.loadPack().blueprint) {
      this.store.updatePack((p) => { p.blueprint = fallbackBlueprint(p) })
      log.info('[pipeline] no se definió el simulacro: se usa uno estándar según los pesos')
    }
    const p = this.loadPack()
    this.stage('crossCutting', 'done', p.blueprint
      ? tr(`${p.glossary.length} términos · ${p.formulaSheet.length} grupos de fórmulas · simulacro`, `${p.glossary.length} terms · ${p.formulaSheet.length} formula groups · mock exam`)
      : tr(`${p.glossary.length} términos · ${p.formulaSheet.length} grupos de fórmulas`, `${p.glossary.length} terms · ${p.formulaSheet.length} formula groups`))
  }

  private needsVerification(id: string): boolean {
    return this.loadSkill(id)?.exercises.some((e) => e.review === undefined && isVerifiable(e)) ?? false
  }

  private verifySummary(): string {
    const t = this.state.aula2.verify
    return tr(`${t.verified} verificados`, `${t.verified} verified`) + (t.fixed ? tr(` · ${t.fixed} corregidos`, ` · ${t.fixed} fixed`) : '') + (t.flagged ? tr(` · ${t.flagged} para revisar`, ` · ${t.flagged} to review`) : '')
  }

  private async verifyStage(onlyChanged: boolean): Promise<void> {
    if (!this.state.request.verifyAnswers) { this.stage('verify', 'skipped', tr('Desactivada', 'Turned off')); return }
    if (this.state.stages.verify === 'done' && !onlyChanged) return
    let ids = this.loadPack().skills.map((s) => s.id).filter((id) => this.needsVerification(id))
    if (onlyChanged) { const changed = this.changedSkills(); ids = ids.filter((id) => changed.has(id)) }
    if (!ids.length) { this.stage('verify', 'skipped', tr('Nada que verificar', 'Nothing to verify')); return }
    this.stage('verify', 'running', tr('Un solucionador independiente resuelve los ejercicios sin ver las claves', 'An independent solver works the exercises without seeing the keys'))
    await forEachLimited(ids, this.state.request.maxParallel, (id) => this.verifySkill(id, 'normal'))
    this.checkCancelled()
    if (this.fatal) { this.stage('verify', 'failed', this.fatal.message); throw this.fatal }
    this.stage('verify', 'done', this.verifySummary())
  }

  private async verifySkill(id: string, priority: GatePriority): Promise<void> {
    const ref = this.loadPack().skills.find((s) => s.id === id)
    const skill = this.loadSkill(id)
    if (!ref || !skill) return
    this.updateSkill(id, (s) => { s.status = 'verifying' })
    const r = this.state.request
    try {
      await this.runAgent({ role: 'verifier', set: { kind: 'solver', skill: id }, stage: 'verify', skill: id, prompt: solverPrompt(r, ref), maxSteps: Math.min(100, 8 + skill.exercises.length * 3), timeoutSec: 1500, priority, lane: tr(`Verificador · ${ref.title}`, `Verifier · ${ref.title}`) })
      // algunos modelos paran tras resolver unos pocos: una segunda pasada solo con los que faltan
      const first = VerificationStore.load(this.store, this.runID, id)
      const missing = first.presented.filter((x) => first.records[x] === undefined)
      if (missing.length) {
        await this.runAgent({ role: 'verifier', set: { kind: 'solver', skill: id }, stage: 'verify', skill: id, prompt: solverPrompt(r, ref, missing), maxSteps: Math.min(80, 6 + missing.length * 3), timeoutSec: 1200, priority: 'high', lane: tr(`Verificador · ${ref.title}`, `Verifier · ${ref.title}`) })
      }
      const open = Object.values(VerificationStore.load(this.store, this.runID, id).records).filter((x) => x.outcome !== 'match' && !x.resolved)
      if (open.length) {
        await this.runAgent({ role: 'adjudicator', set: { kind: 'adjudicator', skill: id }, stage: 'verify', skill: id, prompt: adjudicatorPrompt(r, ref), maxSteps: 12 + open.length * 8, timeoutSec: 1500, priority: 'high', lane: tr(`Árbitro · ${ref.title}`, `Referee · ${ref.title}`) })
      }
    } catch (err) {
      if (isCancelled(err, this.controller.signal)) return
      if (isFatal(err)) { if (err instanceof Error) this.setFatal(err); return }
      log.info(`[pipeline] verificación incompleta de ${id}: ${errorText(err)}`)
    }
    const sum = applyVerification(this.store, this.runID, id, this.now())
    this.verifyDone += 1
    const finalProblems = this.problems(id)
    this.mutate((st) => {
      const t = st.aula2.verify
      t.verified += sum.verified; t.fixed += sum.fixed; t.flagged += sum.flagged; t.disagreements += sum.disagreements; t.skipped += sum.skipped
      const s = st.skills.find((k) => k.id === id)
      if (s) { if (s.status === 'verifying') s.status = finalProblems.length ? 'needsReview' : 'done'; s.openIssues = finalProblems.length + sum.flagged }
    })
  }

  // MARK: Equipo de agentes

  /**
   * Equipo: cada habilidad se escribe (lección y práctica a la vez) y se verifica en cuanto está escrita; el glosario y las fórmulas
   * empiezan cuando todas están escritas, mientras terminan las verificaciones. `gate` limita cuántos agentes trabajan.
   */
  private async teamBuildStage(): Promise<void> {
    const skills = [...this.state.skills]
    const toWrite = new Set(skills.filter((s) => s.status !== 'done' && s.status !== 'needsReview').map((s) => s.id))
    const verify = this.state.request.verifyAnswers
    const verifyWasDone = this.state.stages.verify === 'done'
    if (!toWrite.size) this.stage('author', 'done', this.state.summaries.author || tr('Todas las habilidades ya estaban listas', 'All skills were already ready'))
    else this.stage('author', 'running', tr(`${toWrite.size} habilidad(es) · equipo de hasta ${this.gate.limit} agentes`, `${toWrite.size} skill(s) · team of up to ${this.gate.limit} agents`))
    const written = new Countdown(toWrite.size)
    const work: Array<Promise<void>> = skills.map(async (s) => {
      if (toWrite.has(s.id)) { await this.authorSkill(s.id); written.done() }
      if (!verify || this.controller.signal.aborted || this.fatal || !this.needsVerification(s.id)) return
      this.markVerifyStarted()
      await this.verifySkill(s.id, 'high')
    })
    work.push((async () => {
      await written.wait()
      if (this.controller.signal.aborted || this.fatal) return
      if (toWrite.size) { const e = this.finishAuthorStage(); if (e) { this.setFatal(e); return } }
      try { await this.crossCuttingStage(true) } catch (err) { if (!isCancelled(err, this.controller.signal) && err instanceof Error) this.setFatal(err) }
    })())
    await Promise.all(work)
    this.checkCancelled()
    if (this.fatal) {
      for (const g of ['author', 'crossCutting', 'verify'] as GenerationStage[]) if (this.state.stages[g] === 'running') this.stage(g, 'failed', this.fatal.message)
      throw this.fatal
    }
    if (!verify) this.stage('verify', 'skipped', tr('Desactivada', 'Turned off'))
    else if (!this.verifyStarted) { if (!verifyWasDone) this.stage('verify', 'skipped', tr('Nada que verificar', 'Nothing to verify')) }
    else this.stage('verify', 'done', this.verifySummary())
  }

  private markVerifyStarted(): void {
    if (this.verifyStarted) return
    this.verifyStarted = true
    this.stage('verify', 'running', tr('Un solucionador independiente resuelve los ejercicios sin ver las claves', 'An independent solver works the exercises without seeing the keys'))
  }

  private changedSkills(): Set<string> {
    return new Set(this.state.skills.filter((s) => ['repairing', 'running', 'done', 'needsReview'].includes(s.status)).map((s) => s.id))
  }

  private async polishStage(): Promise<void> {
    this.stage('polish', 'running', tr('Última revisión', 'Final review'))
    if (this.state.request.mode.kind === 'create') {
      this.store.updatePack((p) => {
        p.skills.forEach((s, i) => { s.order = i })
        // cada habilidad pertenece a una unidad que exista
        const unitIDs = new Set(p.units.map((u) => u.id))
        for (const s of p.skills) {
          if (s.unit !== undefined && unitIDs.has(s.unit)) continue
          const u = p.units.find((x) => x.skillIDs.includes(s.id))
          if (u) s.unit = u.id
        }
      })
    }
    if (this.state.request.mode.kind === 'create') this.dropCourseDuplicates()
    for (const sk of this.state.skills) {
      if (this.state.request.mode.kind === 'extend' && sk.status === 'pending') continue
      const s = this.loadSkill(sk.id)
      if (s) this.persistFinalStatus(s)
    }
    this.stage('polish', 'done', '')
  }

  /**
   * Ejercicios repetidos entre habilidades (mismo enunciado y misma respuesta, `courseDuplicateExercises`): se quita la copia
   * que no usa ningún «Pruébalo» (`duplicateToDrop`) si su habilidad sigue con los ejercicios mínimos.
   */
  private dropCourseDuplicates(): void {
    const skills = this.loadPack().skills.map((r) => this.loadSkill(r.id)).filter((s): s is Skill => s !== undefined)
    const min = DEPTHS[this.state.request.depth].minExercises
    const drop = new Map<string, Set<string>>()
    for (const d of courseDuplicateExercises(skills)) {
      const target = duplicateToDrop(d)
      if (!target) continue
      const s = skills.find((k) => k.id === target.skill)
      const ids = drop.get(target.skill) ?? new Set<string>()
      if (!s || ids.has(target.exercise) || s.exercises.length + s.templates.length - ids.size - 1 < min) continue
      ids.add(target.exercise)
      drop.set(target.skill, ids)
    }
    for (const [id, ids] of drop) {
      try {
        this.store.updateSkill(id, (s) => { s.exercises = s.exercises.filter((e) => !ids.has(e.id)) })
        log.info(`[pipeline] ${id}: quitados ${ids.size} ejercicio(s) que repetían otra habilidad (${[...ids].join(', ')})`)
      } catch (err) { log.warn('[pipeline] no se pudieron quitar los ejercicios repetidos', err) }
    }
  }

  private persistFinalStatus(s: Skill): void {
    const ok = this.problems(s.id).length === 0 && !s.exercises.some((e) => e.review?.state === 'flagged')
    try { this.store.updateSkill(s.id, (k) => { k.status = ok ? 'ready' : 'needsReview' }) } catch { /* sin escribir */ }
  }

  // MARK: Ampliar

  private async extendStage(instruction: string, skill: string | undefined): Promise<void> {
    this.stage('author', 'running', tr('Aplicando tu petición', 'Applying your request'))
    const before = this.revisions()
    const pack = this.loadPack()
    const browser = this.browser()
    const prompt = extendPrompt(this.state.request, this.promptCourse(pack), instruction, skill, courseDigest(pack, (id) => this.loadSkill(id)), !!browser)
    const set: ToolSet = skill ? { kind: 'skillAuthor', skill } : { kind: 'all' }
    await this.runAgent({ role: 'extender', set, stage: 'author', skill, prompt, maxSteps: DEPTHS[this.state.request.depth].maxSteps, timeoutSec: 1800, lane: tr('Cambios que pediste', 'The changes you asked for'), computer: !skill })
    const after = this.revisions()
    const changed = [...after.entries()].filter(([id, rev]) => before.get(id) !== rev).map(([id]) => id)
    this.seedSkillStates(this.loadPack())
    for (const id of changed) {
      this.persistAudit(id)
      const n = this.problems(id).length
      this.updateSkill(id, (s) => { s.openIssues = n; s.status = n === 0 ? 'done' : 'needsReview' })
    }
    this.stage('author', 'done', changed.length ? tr(`${changed.length} habilidad(es) modificada(s)`, `${changed.length} skill(s) changed`) : tr('No cambió nada', 'Nothing changed'))
  }

  /** Temas, ejercicios, tarjetas y bloques de lección del curso ahora mismo. */
  private contentCounts(): ContentCounts {
    let pack: Pack
    try { pack = this.loadPack() } catch { return { skills: 0, exercises: 0, cards: 0, lessonBlocks: 0 } }
    return countContent(pack, (id) => this.loadSkill(id))
  }

  private revisions(): Map<string, number> {
    const r = new Map<string, number>()
    for (const id of this.store.skillIDs()) { const s = this.loadSkill(id); if (s) r.set(id, s.revision) }
    return r
  }

  // MARK: Ejecutar un agente

  private toolContext(skill: string | undefined, computer: boolean): ToolContext {
    const r = this.state.request
    return {
      store: this.store,
      validator: () => boundValidator(this.store),
      assignedSkill: skill,
      search: this.services.search?.(this.store),
      web: r.allowWeb ? this.services.web : undefined,
      webGate: r.allowWeb ? (this.webGateCache ??= new RunWebGate(requestTextForGate(r), this.store)) : undefined,
      calc: this.services.calc ?? LiveCalculator,
      runID: this.runID,
      notify: (e) => { if (e.kind === 'planSet') this.changed() },
      askUser: (text, options, signal) => this.broker.ask(text, options, { signal: signal ?? this.controller.signal, timeoutMs: 900_000 }),
      campus: this.services.campus,
      importer: this.services.importer?.(this.store),
      browser: computer ? this.browser() : undefined,
      rasterizer: this.services.rasterizer,
      bind: (fn) => this.within(fn)
    }
  }

  /** El contexto del curso que repiten todos los autores (con el mapa de materiales si va justo detrás). */
  private sharedCourseContext(pack: Pack): string[] {
    const course = this.promptCourse(pack)
    const context = courseContext(this.state.request, course)
    return [context + '\n' + materialsMap(this.state.request, course), context]
  }

  private laneTitle(role: PipelineRole, skill: string | undefined): string {
    let name = ''
    if (skill) { try { name = this.loadPack().skills.find((s) => s.id === skill)?.title ?? skill } catch { name = skill } }
    switch (role) {
      case 'planner': return tr('Planificador', 'Planner')
      case 'author': return tr(`Autor · ${name}`, `Author · ${name}`)
      case 'crossCutting': return tr('Glosario, fórmulas y simulacro', 'Glossary, formulas and mock exam')
      case 'verifier': return tr(`Verificador · ${name}`, `Verifier · ${name}`)
      case 'adjudicator': return tr(`Árbitro · ${name}`, `Referee · ${name}`)
      case 'extender': return tr('Cambios que pediste', 'The changes you asked for')
      case 'tutor': return tr('Tutor', 'Tutor')
      case 'gatherer': return tr('Buscador de materiales', 'Materials searcher')
      case 'reader': return tr('Lector', 'Reader')
    }
  }

  /** Lanza un agente ocupando un puesto del equipo (`gate`) y lo muestra como un carril. */
  private async runAgent(o: {
    role: PipelineRole; set: ToolSet; stage: GenerationStage; skill?: string; prompt: string; maxSteps: number; timeoutSec: number; system?: string; shared?: string[]
    lane?: string; priority?: GatePriority; part?: SkillPart; cross?: CrossPart; computer?: boolean
  }): Promise<AgentResult> {
    this.checkCancelled()
    if (this.fatal) throw this.fatal
    return this.gate.run(o.priority ?? 'normal', async () => {
      this.checkCancelled()
      if (this.fatal) throw this.fatal
      const instruction = this.state.request.mode.kind === 'extend' ? this.state.request.mode.instruction : undefined
      const lane: LaneRecord = {
        id: IDs.short(8), role: o.role, uiRole: uiRoleFor(o.role, { part: o.part, cross: o.cross, instruction }), stage: o.stage, title: o.lane ?? this.laneTitle(o.role, o.skill),
        current: '', status: 'working', steps: 0, provider: this.agents.provider(), startedAt: this.now().toISOString()
      }
      if (o.skill) lane.skill = o.skill
      this.runningAgents += 1
      this.mutate((s) => {
        s.aula2.lanes.push(lane); s.aula2.agents += 1; s.aula2.peakAgents = Math.max(s.aula2.peakAgents, this.runningAgents)
        s.providerNames[o.role] = lane.provider
      })
      try {
        const r = await this.runAgentNow(o, lane)
        // lo último que dijo el agente («Plan listo.»), en una línea; si el curso va en otro idioma que la interfaz (el agente
        // escribe en el del curso), un «Listo» en el idioma de la interfaz
        const said = r.text.trim().split('\n')[0] ?? ''
        const sameLanguage = (this.state.request.language || '').toLowerCase().startsWith(aiLocale())
        lane.status = 'done'; lane.finishedAt = this.now().toISOString()
        lane.current = !said || !sameLanguage ? tr('Listo', 'Done') : Array.from(said).length > 140 ? Array.from(said).slice(0, 139).join('') + '…' : said
        this.laneChanged()
        return r
      } catch (err) {
        lane.status = 'failed'; lane.finishedAt = this.now().toISOString()
        lane.current = isCancelled(err, this.controller.signal) ? tr('Detenido', 'Stopped') : errorText(err)
        this.laneChanged()
        // el tope de gasto vale para TODA la ejecución (los demás agentes no empiezan); queda para reanudar
        if (err instanceof BudgetError || err instanceof LimitStop) this.setFatal(err)
        throw err
      } finally {
        this.runningAgents -= 1
      }
    })
  }

  private async runAgentNow(o: { role: PipelineRole; set: ToolSet; stage: GenerationStage; skill?: string; prompt: string; maxSteps: number; timeoutSec: number; system?: string; shared?: string[]; computer?: boolean }, lane: LaneRecord): Promise<AgentResult> {
    const split = splitSharedContext(o.prompt, o.shared ?? [])
    const system = o.system ?? systemPrompt(o.role, this.state.request)
    for (let attempt = 1; ; attempt++) {
      this.checkCancelled()
      const tools = makeTools(o.set, this.toolContext(o.skill, !!o.computer), this.state.request.allowWeb)
      const started = new Map<string, string>()
      const task: AgentTask = {
        role: o.role, system, prompt: split.prompt, sharedContext: split.shared || undefined, tools, maxSteps: o.maxSteps, timeoutSec: o.timeoutSec, signal: this.controller.signal,
        onEvent: (e) => this.onAgentEvent(e, lane, o, started)
      }
      try {
        const result = await this.agents.run(task)
        this.mutate((s) => { s.usage = addUsage(s.usage, result.usage) })
        return result
      } catch (err) {
        if (isCancelled(err, this.controller.signal) || !(err instanceof AIError)) throw err
        const decision = retryDecision({ kind: err.kind, status: err.status, retryAfter: err.retryAfter, text: classificationText(err) }, attempt)
        if (decision.action === 'limit') {
          const at = decision.resumeAfterSec !== undefined ? new Date(this.now().getTime() + decision.resumeAfterSec * 1000) : undefined
          if (!decision.long) throw new LimitStop(err.message, at)
          // un límite que tarda en renovarse: se para y queda para reanudar
          const mins = Math.round((decision.resumeAfterSec ?? 0) / 60)
          throw new LimitStop(tr(`${err.message} (el límite se renueva en unos ${mins} min; la ejecución queda guardada para reanudarla).`, `${err.message} (the limit renews in about ${mins} min; the run is saved so you can resume it).`), at)
        }
        if (decision.action === 'fail') throw err
        // el monitor dice por qué espera y cuándo vuelve a probar
        lane.current = waitingText(decision.reason, decision.waitSec, err.status)
        this.laneChanged()
        await this.sleep(decision.waitSec * 1000)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal
      if (signal.aborted) return reject(new AIError('cancelled', 'Cancelado.', { code: 'cancelled' }))
      const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
      const onAbort = (): void => { clearTimeout(t); reject(new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })) }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private onAgentEvent(e: AgentEvent, lane: LaneRecord, o: { stage: GenerationStage; skill?: string }, started: Map<string, string>): void {
    switch (e.type) {
      case 'toolStarted': {
        started.set(e.id, e.summary)
        lane.current = describeTool(e.name, e.summary.replace(/^\S+\s/, ''))
        this.laneChanged()
        break
      }
      case 'notice': {
        // «Reintentando la conexión con Claude (intento 2 de 10)…»: el monitor dice qué pasa en vez de quedarse quieto
        lane.current = Array.from(e.text).length > 160 ? Array.from(e.text).slice(0, 159).join('') + '…' : e.text
        this.laneChanged()
        break
      }
      case 'toolFinished': {
        // las búsquedas en internet se cuentan: si fallan todas, el informe lo dice
        if (WEB_TOOLS.has(e.name)) this.state.aula2.web = countWebCall(this.state.aula2.web, e.ok, e.summary)
        if (!e.ok) {
          this.logToolError(o.stage, o.skill, e.name, started.get(e.id) ?? '', e.summary)
          lane.current = briefToolResult(e.name, false, e.summary)
        }
        started.delete(e.id)
        lane.steps += 1
        this.laneChanged()
        break
      }
      default:
        break
    }
  }

  /** Registro técnico (no se muestra en la app) de las llamadas que fallaron: `runs/<ejecución>.errores.log`. */
  private logToolError(stage: GenerationStage, skill: string | undefined, tool: string, args: string, error: string): void {
    const line = `[${this.now().toISOString()}] ${stage}${skill ? `/${skill}` : ''} ${tool}\n  args: ${args.slice(0, 1200)}\n  error: ${error.slice(0, 600)}\n`
    try { appendFileSync(join(this.store.runsDirectory, `${this.runID}.errores.log`), line) } catch { /* solo depuración */ }
  }

  /** Notas del informe final: lo de la investigación en internet y, de cada habilidad, lo que falta. */
  private reportNotes(research: string | undefined): string[] {
    const skills = this.state.skills.filter((s) => s.note && s.status !== 'done').map((s) => `${s.title}: ${s.note}`)
    return research ? [research, ...skills] : skills
  }

  /** ¿Se investigó en internet como se esperaba? (ver `researchNote`). */
  private researchNote(): string | undefined {
    const r = this.state.request
    let pack: Pack
    try { pack = this.loadPack() } catch { return undefined }
    return researchNote({ allowWeb: r.allowWeb, mode: r.mode.kind, sources: pack.sources.length, webSources: pack.sources.filter((m) => m.kind === 'web').length, web: this.state.aula2.web })
  }
}

export { NO_ANSWER }
