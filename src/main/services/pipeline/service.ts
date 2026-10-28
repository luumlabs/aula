// El servicio de «Crear curso» y «Pedir cambios a Aula» (lo que llama el IPC): crea el curso al momento, lanza el equipo en
// segundo plano, lleva las ejecuciones activas (como mucho unas pocas a la vez), traduce su registro a la vista del monitor
// (`RunView`, con avisos agrupados) y permite detener, reanudar, quedarse con lo que hay y responder preguntas.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  currentStage, DEPTHS, encodeRunState, inferredRunState, makeRequest, shownProgress, type GatherSpec, type GenerationRequest, type GenerationRunState
} from '@engine/pipeline'
import { auditSkill } from '@engine/pipeline'
import { tr } from '@shared/ai/i18n'
import { GENERATION_STAGES, type AgentLaneView, type CreateRequest, type GenerationStage, type RunReport, type RunState, type RunSummary, type RunView } from '@shared/generation/types'
import { CourseIconCatalog, LESSON_LEARNING_MODES, courseHueForTitle, makePack, type LessonLearningMode, type Pack } from '@shared/schema'
import { AIError } from '../ai'
import { keepAsIs } from '../calendar/preparation'
import { AulaError } from '../errors'
import { log } from '../log'
import { tryReadJSONFile, writeJSONFile, type Library, type PackStore } from '../store'
import { boundValidator } from '../study/assets'
import { loadFindings, type GatherFindings } from '../tools'
import type { PipelineAgents } from './agents'
import { draftInInstruction, DraftStore } from './drafts'
import { GenerationPipeline, type PipelineServices } from './runner'

export interface GenerationServiceOptions {
  library: () => Library
  /** Los agentes para una petición (con el modelo de IA activo). Lanza si no hay IA. */
  agents: (request: GenerationRequest) => Promise<PipelineAgents>
  services?: PipelineServices
  drafts?: DraftStore
  /** Cada cambio visible de una ejecución (ya agrupado). */
  emit?: (view: RunView) => void
  /** Vincula el evento del calendario («Preparar este examen») con el curso nuevo. */
  linkEvent?: (eventId: string, packId: string) => void
  /** Agentes a la vez (Ajustes → IA). */
  maxParallel?: () => number
  /** Búsqueda en internet permitida por defecto (Ajustes → Datos). */
  webSearch?: () => boolean
  /** Idioma de la interfaz (el del curso si la petición no dice otro). */
  language?: () => string
  /** Ejecuciones a la vez (las demás esperan turno). */
  maxRuns?: number
  throttleMs?: number
  now?: () => Date
}

interface Active {
  pipeline: GenerationPipeline
  packId: string
  started: boolean
  done?: Promise<GenerationRunState>
  timer?: ReturnType<typeof setTimeout>
  lastEmit: number
}

const MAX_TITLE = 200
const MAX_TEXT = 20_000

function badArgs(es: string, en: string): AulaError {
  return new AulaError('invalid_args', tr(es, en))
}

function text(v: unknown, max = MAX_TEXT): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw badArgs('Hay un campo de texto no válido.', 'A text field is not valid.')
  const t = v.trim()
  return t ? Array.from(t).slice(0, max).join('') : undefined
}

function ids(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badArgs('La lista de materiales no es válida.', 'The list of materials is not valid.')
  return [...new Set(v as string[])].slice(0, 500)
}

/** Tono del icono del curso a partir del título (estable, para que cada curso tenga su color; uno de los diez tonos, nunca violeta). */
export function hueFor(title: string): number {
  return courseHueForTitle(title)
}

function lessonModeOf(m: unknown): LessonLearningMode {
  if (m === 'stepByStep') return 'guided'
  if (m === 'read') return 'reading'
  return (LESSON_LEARNING_MODES as readonly string[]).includes(m as string) ? (m as LessonLearningMode) : 'guided'
}

/** Valida la petición de la interfaz (los argumentos del IPC no se dan por buenos). */
export function validateCreateRequest(raw: unknown): CreateRequest {
  if (typeof raw !== 'object' || raw === null) throw badArgs('Falta la petición.', 'The request is missing.')
  const r = raw as Record<string, unknown>
  const title = text(r.title, MAX_TITLE)
  if (!title) throw badArgs('Ponle un título al curso.', 'Give the course a title.')
  const depth = r.depth === 'quick' || r.depth === 'deep' ? r.depth : 'standard'
  const examDate = text(r.examDate, 64)
  if (examDate && Number.isNaN(Date.parse(examDate))) throw badArgs('La fecha del examen no es válida.', 'The exam date is not valid.')
  let gather: CreateRequest['gather']
  if (r.gather !== undefined && r.gather !== null) {
    if (typeof r.gather !== 'object') throw badArgs('La plataforma no es válida.', 'The platform is not valid.')
    const g = r.gather as Record<string, unknown>
    gather = { accountId: text(g.accountId, 200) ?? '' }
    const course = text(g.courseId, 200); if (course) gather.courseId = course
    const focus = text(g.focus, 2000); if (focus) gather.focus = focus
  }
  const out: CreateRequest = {
    title, materialIds: ids(r.materialIds), officialIds: ids(r.officialIds), depth, lessonMode: r.lessonMode === 'explore' || r.lessonMode === 'read' ? r.lessonMode : 'stepByStep',
    allowWeb: r.allowWeb !== false, verify: r.verify !== false
  }
  const opt = (k: 'subject' | 'level' | 'language' | 'goal' | 'topics' | 'examNotes' | 'userNotes' | 'eventId', max?: number): void => { const v = text(r[k], max); if (v) out[k] = v }
  opt('subject', 200); opt('level', 200); opt('language', 20); opt('goal', 500); opt('topics'); opt('examNotes'); opt('userNotes'); opt('eventId', 200)
  if (examDate) out.examDate = new Date(examDate).toISOString()
  if (gather) out.gather = gather
  return out
}

/** Una petición de «Preparar más ejercicios» pendiente para esa habilidad (de `study.prepareMore`). */
interface PracticeRequest { id: string; file: string; notes: string; instruction: string }

function pendingPracticeRequest(store: PackStore, skillId: string, instruction: string): PracticeRequest | undefined {
  let names: string[] = []
  try { names = readdirSync(store.runsDirectory).filter((n) => n.endsWith('.practice-request.json')).sort().reverse() } catch { return undefined }
  const pending: PracticeRequest[] = []
  for (const n of names) {
    const file = join(store.runsDirectory, n)
    const raw = tryReadJSONFile(file)
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    if (r.kind !== 'practice-request' || r.status !== 'pending' || r.skillId !== skillId || typeof r.notes !== 'string') continue
    pending.push({ id: typeof r.id === 'string' ? r.id : n.replace(/\.practice-request\.json$/, ''), file, notes: r.notes, instruction: typeof r.instruction === 'string' ? r.instruction : '' })
  }
  // la que tiene exactamente esta instrucción o, si no, la más reciente de esa habilidad
  return pending.find((p) => p.instruction === instruction) ?? pending[0]
}

function markPracticeRequest(p: PracticeRequest, runID: string): void {
  const raw = tryReadJSONFile(p.file)
  if (typeof raw !== 'object' || raw === null) return
  try { writeJSONFile(p.file, { ...(raw as Record<string, unknown>), status: 'consumed', runId: runID }) } catch { /* sin permiso: se volvería a usar */ }
}

const STAGE_LABEL: Record<GenerationStage, [string, string]> = {
  prepare: ['Preparando', 'Preparing'], gather: ['Buscando tus materiales', 'Finding your materials'], plan: ['Diseñando el curso', 'Designing the course'],
  author: ['Escribiendo las habilidades', 'Writing the skills'], crossCutting: ['Glosario, fórmulas y simulacro', 'Glossary, formulas and mock exam'],
  verify: ['Verificando las respuestas', 'Checking the answers'], polish: ['Última revisión', 'Final review']
}

const STATE_LABEL: Partial<Record<RunState, [string, string]>> = {
  waiting: ['Esperando tu respuesta', 'Waiting for your answer'], paused: ['En pausa', 'Paused'], limit: ['Límite de uso alcanzado', 'Usage limit reached'],
  done: ['Terminado', 'Finished'], failed: ['Se detuvo por un error', 'Stopped by an error'], cancelled: ['Detenido', 'Stopped']
}

export class GenerationService {
  private readonly active = new Map<string, Active>()
  private readonly queue: string[] = []
  /** runID → curso (para encontrar las ejecuciones guardadas sin recorrer todos los cursos cada vez). */
  private readonly where = new Map<string, string>()
  readonly drafts: DraftStore
  private readonly maxRuns: number
  private readonly throttleMs: number
  private readonly now: () => Date

  constructor(private readonly o: GenerationServiceOptions) {
    this.drafts = o.drafts ?? new DraftStore()
    this.maxRuns = Math.max(1, o.maxRuns ?? 2)
    this.throttleMs = o.throttleMs ?? 250
    this.now = o.now ?? (() => new Date())
  }

  private get library(): Library {
    return this.o.library()
  }

  private maxParallel(): number {
    return Math.max(1, Math.min(8, Math.round(this.o.maxParallel?.() ?? 4)))
  }

  // MARK: Crear

  async start(draftId: string | undefined, raw: unknown): Promise<{ runId: string; packId: string }> {
    const req = validateCreateRequest(raw)
    if (draftId !== undefined && !this.drafts.isDraftID(draftId)) throw badArgs('Borrador no válido.', 'Invalid draft.')
    const language = req.language ?? this.o.language?.() ?? 'es'
    const hasMaterials = req.materialIds.length > 0
    if (!hasMaterials && !req.topics && !req.gather && !req.allowWeb) {
      throw new AulaError('generation_no_material', tr('No tengo de dónde sacar el contenido: añade materiales, escribe el temario o permite la búsqueda en internet.',
        'I have nothing to build the content from: add materials, write the topics or allow web search.'))
    }
    const subject = req.subject ?? ''
    // la IA tiene que estar lista ANTES de crear el curso (sin IA no queda un curso vacío «en preparación»)
    const probe = this.buildCreateRequest('probe', req, language)
    const agents = await this.agentsFor(probe)
    const store = this.library.createPack(makePack({ id: '', title: req.title, subject, language, icon: CourseIconCatalog.resolve('', subject, req.title), hue: hueFor(req.title) }))
    // la fecha Y la hora del examen que eligió el estudiante quedan ya en el curso: el plan suele mandar solo el día y no la pisa
    // (antes 9:00 acababa en 8:00: J2-12)
    if (req.examDate) {
      const date = req.examDate
      try { store.updatePack((p) => { p.exam = { ...(p.exam ?? { title: language === 'en' ? 'Exam' : 'Examen' }), date } }) } catch (err) { log.warn('[generation] fecha del examen', err) }
    }
    if (draftId && hasMaterials) {
      await this.drafts.idle(draftId)
      this.drafts.moveToPack(draftId, store, { only: req.materialIds, official: req.officialIds })
    }
    const request = this.buildCreateRequest(store.id, req, language)
    const pipeline = this.makePipeline(request, agents)
    if (req.eventId) {
      pipeline.annotate((s) => { s.aula2.eventId = req.eventId })
      try { this.o.linkEvent?.(req.eventId, store.id) } catch (err) { log.warn('[generation] no se pudo vincular el evento', err) }
    }
    this.launch(pipeline, store.id)
    return { runId: pipeline.runID, packId: store.id }
  }

  private buildCreateRequest(packID: string, req: CreateRequest, language: string): GenerationRequest {
    let gather: GatherSpec | undefined
    if (req.gather) {
      gather = { courseHint: req.title, focus: req.gather.focus ?? '', useComputer: true, scanDownloads: false }
      if (req.gather.accountId) gather.accountId = req.gather.accountId
      if (req.gather.courseId) gather.courseId = req.gather.courseId
    }
    const r = makeRequest({
      packID, title: req.title, subject: req.subject ?? '', level: req.level ?? '', language, goal: req.goal ?? '', topics: req.topics ?? '', examNotes: req.examNotes ?? '',
      userNotes: req.userNotes ?? '', depth: req.depth, lessonMode: lessonModeOf(req.lessonMode), allowWeb: req.allowWeb, verifyAnswers: req.verify, maxParallel: this.maxParallel(),
      includeDecks: DEPTHS[req.depth].wantsDecks
    })
    if (req.examDate) r.examDate = req.examDate
    if (gather) r.gather = gather
    return r
  }

  private async agentsFor(request: GenerationRequest): Promise<PipelineAgents> {
    try {
      return await this.o.agents(request)
    } catch (err) {
      if (err instanceof AIError) throw new AulaError(err.code ?? 'ai_no_provider', err.message)
      throw err
    }
  }

  private makePipeline(request: GenerationRequest, agents: PipelineAgents, resumeRunID?: string): GenerationPipeline {
    return new GenerationPipeline({ library: this.library, request, agents, services: this.o.services, resumeRunID, onChange: (p) => this.changed(p), now: this.now })
  }

  // MARK: Pedir cambios

  /** «Materiales» del curso: lo que ya se leyó del borrador pasa al curso en el acto (sus fuentes y su índice: el tutor lo
   * cita ya), sin esperar a «Ampliar el curso». Lo que aún se lee pasa en cuanto termina, aunque el estudiante ya se haya ido
   * de la pestaña (J2-7). Devuelve cuántos pasaron ya. */
  attachMaterials(packId: unknown, draftId: unknown): { moved: number } {
    if (typeof packId !== 'string' || !packId) throw badArgs('Falta el curso.', 'The course is missing.')
    if (!this.drafts.isDraftID(draftId)) throw badArgs('Borrador no válido.', 'Invalid draft.')
    const store = this.library.openPack(packId)
    if (!store) throw new AulaError('not_found', tr('Ese curso no existe.', "That course doesn't exist."))
    const moved = this.drafts.moveToPack(draftId, store).length
    void this.drafts.idle(draftId).then(() => {
      const again = this.library.openPack(packId)
      if (again) this.drafts.moveToPack(draftId, again)
    }).catch((err) => log.warn('[generation] materiales del curso', err))
    return { moved }
  }

  async extend(packId: unknown, instructionRaw: unknown, skillRaw?: unknown): Promise<{ runId: string }> {
    if (typeof packId !== 'string' || !packId) throw badArgs('Falta el curso.', 'The course is missing.')
    const store = this.library.openPack(packId)
    if (!store) throw new AulaError('not_found', tr('Ese curso no existe.', "That course doesn't exist."))
    const instruction = text(instructionRaw, 4000)
    if (!instruction) throw badArgs('Escribe qué quieres cambiar.', 'Write what you want to change.')
    const skill = text(skillRaw, 200)
    const pack = store.loadPack()
    if (skill && !pack.skills.some((s) => s.id === skill)) throw new AulaError('not_found', tr('Esa habilidad no existe en el curso.', "That skill doesn't exist in the course."))
    if (this.activeOn(packId)) throw new AulaError('generation_busy', tr('Aula ya está trabajando en este curso: espera a que termine o detenlo.', 'Aula is already working on this course: wait for it to finish or stop it.'))
    const practice = skill ? pendingPracticeRequest(store, skill, instruction) : undefined
    const last = GenerationPipeline.previousRuns(store).find((r) => r.request.mode.kind === 'create')
    const request = makeRequest({
      packID: packId, title: pack.title, subject: pack.subject, language: pack.language, goal: pack.exam?.title ?? '', examNotes: pack.exam?.notes ?? '',
      depth: practice ? 'quick' : last?.request.depth ?? 'standard', lessonMode: practice ? 'guided' : last?.request.lessonMode ?? 'guided',
      allowWeb: practice ? false : this.o.webSearch?.() ?? true, includeDecks: false, verifyAnswers: true, maxParallel: this.maxParallel(), userNotes: practice?.notes ?? '',
      mode: skill ? { kind: 'extend', instruction, skill } : { kind: 'extend', instruction }
    })
    if (pack.exam?.date) request.examDate = pack.exam.date
    const agents = await this.agentsFor(request)
    // «Materiales» del curso: los que se añadieron al borrador pasan ahora al curso
    const draft = draftInInstruction(instruction)
    if (draft && this.drafts.isDraftID(draft)) {
      await this.drafts.idle(draft)
      this.drafts.moveToPack(draft, store)
    }
    const pipeline = this.makePipeline(request, agents)
    if (practice) {
      pipeline.annotate((s) => { s.aula2.practiceRequest = practice.id })
      markPracticeRequest(practice, pipeline.runID)
    }
    this.launch(pipeline, packId)
    return { runId: pipeline.runID }
  }

  // MARK: Ejecuciones

  private activeOn(packId: string): Active | undefined {
    for (const a of this.active.values()) if (a.packId === packId && !a.pipeline.currentState.finishedAt) return a
    return undefined
  }

  private launch(pipeline: GenerationPipeline, packId: string): void {
    const entry: Active = { pipeline, packId, started: false, lastEmit: 0 }
    this.active.set(pipeline.runID, entry)
    this.where.set(pipeline.runID, packId)
    this.queue.push(pipeline.runID)
    this.pump()
    this.emitNow(entry)
  }

  private runningCount(): number {
    let n = 0
    for (const a of this.active.values()) if (a.started && !a.pipeline.currentState.finishedAt) n++
    return n
  }

  /** Empieza las que esperan turno (como mucho `maxRuns` a la vez). */
  private pump(): void {
    while (this.queue.length && this.runningCount() < this.maxRuns) {
      const id = this.queue.shift() as string
      const a = this.active.get(id)
      if (!a || a.started) continue
      a.started = true
      a.done = a.pipeline.run().then((s) => {
        this.finished(a)
        return s
      }, (err: unknown) => {
        log.warn('[generation] la ejecución terminó con un error inesperado', err)
        this.finished(a)
        return a.pipeline.currentState
      })
    }
  }

  private finished(a: Active): void {
    if (a.timer) { clearTimeout(a.timer); a.timer = undefined }
    this.emitNow(a)
    this.active.delete(a.pipeline.runID)
    this.pump()
  }

  private changed(p: GenerationPipeline): void {
    const a = this.active.get(p.runID)
    if (!a) return
    const wait = this.throttleMs - (Date.now() - a.lastEmit)
    if (wait <= 0) { this.emitNow(a); return }
    if (a.timer) return
    a.timer = setTimeout(() => { a.timer = undefined; this.emitNow(a) }, wait)
    a.timer.unref?.()
  }

  private emitNow(a: Active): void {
    a.lastEmit = Date.now()
    if (!this.o.emit) return
    try { this.o.emit(this.view(a.pipeline.currentState, a)) } catch (err) { log.warn('[generation] aviso al monitor', err) }
  }

  /** Espera a que termine una ejecución activa (pruebas y cierre de la app). */
  async whenFinished(id: string): Promise<GenerationRunState | undefined> {
    const a = this.active.get(id)
    if (!a) return this.load(id)?.state
    if (!a.started) await new Promise<void>((resolve) => { const t = setInterval(() => { if (a.started || !this.active.has(id)) { clearInterval(t); resolve() } }, 20) })
    return a.done ? await a.done : this.load(id)?.state
  }

  /** La ejecución en curso (para las pruebas y el handler). */
  pipeline(id: string): GenerationPipeline | undefined {
    return this.active.get(id)?.pipeline
  }

  /** Detiene todas (al cerrar la app): quedan en pausa para reanudarlas. */
  async shutdown(): Promise<void> {
    this.queue.length = 0
    const all = [...this.active.values()]
    for (const a of all) a.pipeline.cancel()
    await Promise.all(all.map((a) => a.done?.catch(() => undefined)))
  }

  private load(id: string): { state: GenerationRunState; store: PackStore } | undefined {
    if (typeof id !== 'string' || !/^run-[a-z0-9-]{4,60}$/.test(id)) return undefined
    const lib = this.library
    const known = this.where.get(id)
    const tryPack = (packId: string): { state: GenerationRunState; store: PackStore } | undefined => {
      const store = lib.openPack(packId)
      if (!store || !existsSync(join(store.runsDirectory, `${id}.json`))) return undefined
      const state = GenerationPipeline.loadRun(store, id)
      return state ? { state, store } : undefined
    }
    if (known) { const r = tryPack(known); if (r) return r }
    for (const packId of lib.packIDs()) {
      const r = tryPack(packId)
      if (r) { this.where.set(id, packId); return r }
    }
    return undefined
  }

  run(id: unknown): RunView | null {
    if (typeof id !== 'string') return null
    const a = this.active.get(id)
    if (a) return this.view(a.pipeline.currentState, a)
    const r = this.load(id)
    return r ? this.view(r.state, undefined, r.store) : null
  }

  /** Las ejecuciones activas y las recientes de todos los cursos (las más nuevas primero). */
  runs(limit = 40): RunSummary[] {
    const out: RunSummary[] = []
    const seen = new Set<string>()
    for (const a of this.active.values()) {
      out.push(this.summary(this.view(a.pipeline.currentState, a)))
      seen.add(a.pipeline.runID)
    }
    const lib = this.library
    for (const packId of lib.packIDs()) {
      const store = lib.openPack(packId)
      if (!store) continue
      for (const s of GenerationPipeline.previousRuns(store).slice(0, 5)) {
        if (seen.has(s.runID)) continue
        seen.add(s.runID)
        this.where.set(s.runID, packId)
        out.push(this.summary(this.view(s, undefined, store)))
      }
    }
    return out.sort((x, y) => y.updated.localeCompare(x.updated)).slice(0, limit)
  }

  private summary(v: RunView): RunSummary {
    const label = v.state === 'running' ? STAGE_LABEL[v.stage] : STATE_LABEL[v.state] ?? STAGE_LABEL[v.stage]
    const last = v.lanes.reduce((m, l) => (l.finishedAt && l.finishedAt > m ? l.finishedAt : l.startedAt > m ? l.startedAt : m), v.startedAt)
    return { id: v.id, packId: v.packId, title: v.title, icon: v.icon, hue: v.hue, state: v.state, progress: v.progress, stageLabel: tr(label[0], label[1]), updated: v.finishedAt ?? last }
  }

  cancel(id: unknown): void {
    if (typeof id !== 'string') return
    const a = this.active.get(id)
    if (!a) return
    if (!a.started) {
      // aún esperaba turno: queda en pausa sin haber empezado
      const i = this.queue.indexOf(id)
      if (i >= 0) this.queue.splice(i, 1)
      a.pipeline.annotate((s) => { s.cancelled = true; s.finishedAt = this.now().toISOString(); s.aula2.state = s.request.mode.kind === 'extend' ? 'cancelled' : 'paused' })
      this.finished(a)
      return
    }
    a.pipeline.cancel()
  }

  async resume(id: unknown): Promise<void> {
    if (typeof id !== 'string') throw badArgs('Falta la ejecución.', 'The run is missing.')
    if (this.active.has(id)) return
    const r = this.load(id)
    if (!r) throw new AulaError('not_found', tr('No encuentro esa ejecución.', "I can't find that run."))
    const st = inferredRunState(r.state, false)
    if (st === 'done') return
    if (this.activeOn(r.store.id)) throw new AulaError('generation_busy', tr('Aula ya está trabajando en este curso.', 'Aula is already working on this course.'))
    const request = { ...r.state.request, maxParallel: this.maxParallel() }
    const agents = await this.agentsFor(request)
    const pipeline = this.makePipeline(request, agents, id)
    this.launch(pipeline, r.store.id)
  }

  /** «Quedarme con lo que hay»: el curso pasa a ser normal con lo que ya está escrito. */
  async keep(id: unknown): Promise<void> {
    if (typeof id !== 'string') throw badArgs('Falta la ejecución.', 'The run is missing.')
    const a = this.active.get(id)
    if (a) {
      this.cancel(id)
      await a.done?.catch(() => undefined)
    }
    const r = this.load(id)
    if (!r) throw new AulaError('not_found', tr('No encuentro esa ejecución.', "I can't find that run."))
    // sin ningún tema escrito, «quedarse con lo que hay» dejaba un curso «listo» con 0 temas y un simulacro que no arranca (A3-P2-8)
    if (!hasWrittenSkill(r.store)) {
      throw new AulaError('generation_nothing_to_keep', tr(
        'Aún no hay ningún tema escrito con el que quedarse. Reanuda la creación o borra el curso.',
        'There’s no topic written yet to keep. Resume the creation or delete the course.'
      ))
    }
    keepAsIs(r.store, id)
    const s = r.state
    // cada habilidad con contenido queda lista o por revisar (la auditoría de siempre)
    let pack: Pack | undefined
    try { pack = r.store.loadPack() } catch { pack = undefined }
    for (const ref of pack?.skills ?? []) {
      if (!r.store.hasSkill(ref.id)) continue
      try {
        const skill = r.store.loadSkill(ref.id)
        if (!skill.lesson.length && !skill.exercises.length) continue
        const ok = auditSkill(skill, s.request.depth, boundValidator(r.store).checkSkill(skill, pack), tr('es', 'en') === 'en' ? 'en' : 'es').length === 0 && !skill.exercises.some((e) => e.review?.state === 'flagged')
        r.store.updateSkill(ref.id, (k) => { k.status = ok ? 'ready' : 'needsReview' })
      } catch { /* sigue con las demás */ }
    }
    s.finishedAt = s.finishedAt ?? this.now().toISOString()
    s.aula2.state = 'done'
    s.aula2.notes = [...s.aula2.notes, tr('Terminado con lo que ya había.', 'Finished with what was already there.')]
    try { r.store.saveJSON(encodeRunState(s), 'runs', id) } catch { /* sin permiso */ }
    this.o.emit?.(this.view(s, undefined, r.store))
  }

  answer(id: unknown, questionId: unknown, answer: unknown): void {
    if (typeof id !== 'string' || typeof questionId !== 'string' || typeof answer !== 'string') throw badArgs('Respuesta no válida.', 'Invalid answer.')
    const a = this.active.get(id)
    if (!a || !a.pipeline.answer(questionId, Array.from(answer.trim()).slice(0, 4000).join(''))) {
      throw new AulaError('not_found', tr('Esa pregunta ya no está pendiente.', 'That question is no longer pending.'))
    }
  }

  // MARK: Vista del monitor

  view(s: GenerationRunState, a?: Active, storeIn?: PackStore): RunView {
    const store = a?.pipeline.store ?? storeIn ?? this.library.openPack(s.request.packID)
    let pack: Pack | undefined
    try { pack = store?.loadPack() } catch { pack = undefined }
    const isActive = !!a && !s.finishedAt
    const question = a?.pipeline.broker.pending()[0]
    let state = inferredRunState(s, isActive)
    if (isActive && question) state = 'waiting'
    const finished = state === 'done'
    const lanes: AgentLaneView[] = s.aula2.lanes.map((l) => {
      const v: AgentLaneView = {
        id: l.id, role: l.uiRole, stage: l.stage, title: l.title, current: l.current, status: l.status === 'working' && !isActive ? 'done' : l.status, steps: l.steps, provider: l.provider, startedAt: l.startedAt
      }
      if (l.skill) v.skillId = l.skill
      if (l.finishedAt) v.finishedAt = l.finishedAt
      return v
    })
    const view: RunView = {
      id: s.runID, packId: s.request.packID, title: pack?.title ?? s.request.title, icon: pack?.icon ?? CourseIconCatalog.fallback, hue: pack?.hue ?? 0.6,
      mode: s.request.mode.kind, state, stage: currentStage(s), stages: Object.fromEntries(GENERATION_STAGES.map((g) => [g, s.stages[g]])) as RunView['stages'],
      progress: Math.round(shownProgress(s, finished, a?.pipeline.verifiedSkills ?? 0) * 1000) / 1000,
      lanes, skills: s.skills.map((k) => ({ ...k })), startedAt: s.startedAt, provider: Object.values(s.providerNames)[0] ?? a?.pipeline.currentState.providerNames.planner ?? ''
    }
    if (!view.provider && lanes.length) view.provider = lanes[lanes.length - 1].provider
    if (question) view.question = { id: question.id, text: question.text, options: question.options, allowsOther: true }
    if (s.finishedAt) view.finishedAt = s.finishedAt
    if (s.aula2.resumeAt) view.resumeAt = s.aula2.resumeAt
    if (s.failure && state !== 'done') view.error = s.failure
    if (s.aula2.errorCode && state !== 'done') view.errorCode = s.aula2.errorCode
    const findings = store ? loadFindings(store, s.runID) : undefined
    const brief = findings ? findingsMarkdown(findings) : ''
    if (brief) view.findings = brief
    if (store && pack && (finished || state === 'failed' || state === 'limit' || state === 'paused' || state === 'cancelled')) view.report = this.report(s, store, pack)
    return view
  }

  private report(s: GenerationRunState, store: PackStore, pack: Pack): RunReport {
    let lessonBlocks = 0, exercises = 0, cards = 0, decks = 0
    for (const ref of pack.skills) {
      if (!store.hasSkill(ref.id)) continue
      try {
        const k = store.loadSkill(ref.id)
        lessonBlocks += k.lesson.length; exercises += k.exercises.length; cards += k.cards.length; decks += k.decks.length
      } catch { /* sin leer */ }
    }
    const touched = s.request.mode.kind === 'extend' ? new Set(s.skills.filter((k) => k.status !== 'pending').map((k) => k.id)) : undefined
    const refs = touched ? pack.skills.filter((r) => touched.has(r.id)) : pack.skills
    const end = s.finishedAt ? Date.parse(s.finishedAt) : this.now().getTime()
    // «Pedir cambios»: lo nuevo respecto a lo que había al empezar (no el curso entero como si fuera nuevo)
    const b = s.aula2.baseline
    const extend: Partial<RunReport> = !touched ? {} : {
      changedSkills: touched.size,
      ...(b ? { added: { skills: Math.max(0, pack.skills.length - b.skills), exercises: Math.max(0, exercises - b.exercises), cards: Math.max(0, cards - b.cards), lessonBlocks: Math.max(0, lessonBlocks - b.lessonBlocks) } } : {})
    }
    return {
      ...extend,
      skillsReady: refs.filter((r) => r.status === 'ready').length,
      skillsNeedingReview: refs.filter((r) => r.status === 'needsReview').length,
      skillsFailed: s.skills.filter((k) => k.status === 'failed').length,
      lessonBlocks, exercises, cards, decks,
      verified: s.aula2.verify.verified, fixed: s.aula2.verify.fixed, flagged: s.aula2.verify.flagged,
      minutes: Math.max(0, Math.round((end - Date.parse(s.startedAt)) / 60000)),
      notes: s.aula2.notes,
      ...(s.aula2.researchNote ? { researchNote: s.aula2.researchNote } : {})
    }
  }
}

/** Lo que averiguó «Reunir materiales», en Markdown para el monitor. */
export function findingsMarkdown(f: GatherFindings): string {
  const rows: Array<[string, string, string | undefined]> = [
    ['Examen', 'Exam', f.examTitle], ['Fecha', 'Date', f.examDate], ['Qué entra', 'What it covers', f.covers], ['Formato', 'Format', f.format], ['Notas', 'Notes', f.notes]
  ]
  return rows.filter((r) => r[2]).map(([es, en, v]) => `**${tr(es, en)}:** ${v}`).join('\n\n')
}

/** ¿Hay al menos un tema con lección o ejercicios? */
export function hasWrittenSkill(store: PackStore): boolean {
  let pack: Pack | undefined
  try { pack = store.loadPack() } catch { return false }
  for (const ref of pack.skills) {
    if (!store.hasSkill(ref.id)) continue
    try {
      const skill = store.loadSkill(ref.id)
      if (skill.lesson.length || skill.exercises.length) return true
    } catch { /* ilegible: no cuenta */ }
  }
  return false
}
