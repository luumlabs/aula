// Lo que se le pide a la IA al crear o ampliar un curso y el registro de cada ejecución (port de
// StudyEngine/Pipeline/GenerationTypes.swift y Team.swift). El registro se guarda en `Packs/<id>/runs/<run>.json` con las claves
// de la app Swift (así «Reanudar» funciona con las ejecuciones que ya existen); lo nuevo de esta versión (carriles, estado para la
// interfaz) va en `aula2`, que Swift ignora. Puro e isomorfo.
import type { AgentRole as UIRole, GenerationDepth, GenerationStage, RunState, SkillRunStatus, StageStatus } from '@shared/generation/types'
import { GENERATION_STAGES } from '@shared/generation/types'
import { LESSON_LEARNING_MODES, type LessonLearningMode } from '@shared/schema'
import { STUDY_GOAL_KINDS, type StudyGoalKind } from './goal'

export type { GenerationDepth, GenerationStage, StageStatus, SkillRunStatus, RunState }

// MARK: Profundidad

export interface DepthSpec {
  skillRange: [number, number]
  exerciseTarget: [number, number]
  cardTarget: [number, number]
  lessonBlocks: [number, number]
  wantsDecks: boolean
  maxSteps: number
  /** Mínimos que la tubería exige antes de dar una habilidad por terminada. */
  minExercises: number
  minCards: number
  minLessonBlocks: number
}

export const DEPTHS: Readonly<Record<GenerationDepth, DepthSpec>> = {
  quick: { skillRange: [3, 7], exerciseTarget: [6, 10], cardTarget: [5, 8], lessonBlocks: [8, 12], wantsDecks: false, maxSteps: 40, minExercises: 6, minCards: 4, minLessonBlocks: 6 },
  standard: { skillRange: [6, 14], exerciseTarget: [10, 16], cardTarget: [8, 14], lessonBlocks: [12, 18], wantsDecks: false, maxSteps: 70, minExercises: 9, minCards: 6, minLessonBlocks: 9 },
  deep: { skillRange: [10, 24], exerciseTarget: [16, 30], cardTarget: [12, 20], lessonBlocks: [14, 24], wantsDecks: true, maxSteps: 110, minExercises: 14, minCards: 10, minLessonBlocks: 12 }
}

const DEPTH_KEYS: readonly GenerationDepth[] = ['quick', 'standard', 'deep']

/** Máximo de agentes trabajando a la vez. */
export const MAX_AGENTS = 8

// MARK: Papeles de los agentes

/** Papel de un agente en la tubería (mismos nombres que `AgentRole` de Swift). */
export const PIPELINE_ROLES = ['planner', 'author', 'crossCutting', 'verifier', 'adjudicator', 'extender', 'tutor', 'gatherer', 'reader'] as const
export type PipelineRole = (typeof PIPELINE_ROLES)[number]

/** Qué parte de una habilidad escribe un autor del equipo. */
export type SkillPart = 'lesson' | 'practice'
export type CrossPart = 'glossary' | 'formulasAndBlueprint'

/** El compañero pixel-art que lo representa en el monitor. */
export function uiRoleFor(role: PipelineRole, detail: { part?: SkillPart; cross?: CrossPart; instruction?: string } = {}): UIRole {
  switch (role) {
    case 'planner': return 'planner'
    case 'reader': return 'reader'
    case 'gatherer': return 'gatherer'
    case 'verifier': return 'verifier'
    case 'adjudicator': return 'arbiter'
    case 'crossCutting': return detail.cross === 'formulasAndBlueprint' ? 'formulas' : 'glossary'
    case 'author': return detail.part === 'practice' ? 'exercises' : 'lesson'
    case 'extender': {
      const t = (detail.instruction ?? '').toLowerCase()
      if (/ejercicio|exercise|práctica|practica|practice|pregunta|question/.test(t)) return 'exercises'
      if (/tarjeta|flashcard|card/.test(t)) return 'cards'
      return 'lesson'
    }
    case 'tutor': return 'polish'
  }
}

// MARK: La petición

export type GenerationMode = { kind: 'create' } | { kind: 'extend'; instruction: string; skill?: string }

/** Reunir materiales de la plataforma de estudio (campos de `GatherRequest` de Swift + la cuenta de la plataforma). */
export interface GatherSpec {
  courseHint: string
  focus: string
  useComputer: boolean
  scanDownloads: boolean
  canvasURL?: string
  /** La cuenta de la plataforma (navegador de Aula) y el curso dentro de ella. */
  accountId?: string
  courseId?: string
}

export interface GenerationRequest {
  packID: string
  title: string
  subject: string
  level: string
  language: string
  goal: string
  topics: string
  examNotes: string
  /** ISO-8601. */
  examDate?: string
  sourceIDs: string[]
  exampleSourceIDs: string[]
  userNotes: string
  depth: GenerationDepth
  lessonMode: LessonLearningMode
  allowWeb: boolean
  includeDecks: boolean
  verifyAnswers: boolean
  maxParallel: number
  mode: GenerationMode
  gather?: GatherSpec
  gatherFindings?: string
  /** Equipo de agentes (por defecto activado). */
  team?: boolean
  goalKind?: StudyGoalKind
}

export const usesTeam = (r: GenerationRequest): boolean => r.team ?? true
export const isExtend = (r: GenerationRequest): r is GenerationRequest & { mode: { kind: 'extend'; instruction: string; skill?: string } } => r.mode.kind === 'extend'
export const clampParallel = (n: number): number => Math.max(1, Math.min(MAX_AGENTS, Number.isFinite(n) ? Math.round(n) : 3))

export function makeRequest(p: Partial<GenerationRequest> & { packID: string; title: string }): GenerationRequest {
  const depth = p.depth ?? 'standard'
  const r: GenerationRequest = {
    subject: '', level: '', language: 'es', goal: '', topics: '', examNotes: '', sourceIDs: [], exampleSourceIDs: [], userNotes: '', lessonMode: 'guided',
    allowWeb: true, verifyAnswers: true, mode: { kind: 'create' }, ...p, depth, includeDecks: p.includeDecks ?? DEPTHS[depth].wantsDecks, maxParallel: clampParallel(p.maxParallel ?? 3)
  }
  return r
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function decodeMode(raw: unknown): GenerationMode | undefined {
  if (raw === 'create') return { kind: 'create' }
  if (!isObj(raw)) return undefined
  if ('create' in raw) return { kind: 'create' }
  if (isObj(raw.extend)) {
    const e = raw.extend
    const m: GenerationMode = { kind: 'extend', instruction: str(e.instruction) }
    const skill = optStr(e.skill)
    if (skill) m.skill = skill
    return m
  }
  return undefined
}

function encodeMode(m: GenerationMode): Obj {
  if (m.kind === 'create') return { create: {} }
  const e: Obj = { instruction: m.instruction }
  if (m.skill) e.skill = m.skill
  return { extend: e }
}

function decodeGather(raw: unknown): GatherSpec | undefined {
  if (!isObj(raw)) return undefined
  const g: GatherSpec = { courseHint: str(raw.courseHint), focus: str(raw.focus), useComputer: bool(raw.useComputer, true), scanDownloads: bool(raw.scanDownloads, true) }
  const canvas = optStr(raw.canvasURL); if (canvas) g.canvasURL = canvas
  const acc = optStr(raw.accountId); if (acc) g.accountId = acc
  const course = optStr(raw.courseId); if (course) g.courseId = course
  return g
}

/** Lectura tolerante (como Swift): solo el curso y el modo son imprescindibles; lo demás toma su valor por defecto. */
export function decodeRequest(raw: unknown): GenerationRequest | undefined {
  if (!isObj(raw) || typeof raw.packID !== 'string') return undefined
  const mode = decodeMode(raw.mode)
  if (!mode) return undefined
  const depth = DEPTH_KEYS.includes(raw.depth as GenerationDepth) ? (raw.depth as GenerationDepth) : 'standard'
  const lessonMode = (LESSON_LEARNING_MODES as readonly string[]).includes(raw.lessonMode as string) ? (raw.lessonMode as LessonLearningMode) : 'guided'
  const r = makeRequest({
    packID: raw.packID, title: str(raw.title), subject: str(raw.subject), level: str(raw.level), language: str(raw.language, 'es'), goal: str(raw.goal),
    topics: str(raw.topics), examNotes: str(raw.examNotes), sourceIDs: strings(raw.sourceIDs), exampleSourceIDs: strings(raw.exampleSourceIDs),
    userNotes: str(raw.userNotes), depth, lessonMode, allowWeb: bool(raw.allowWeb, true), includeDecks: bool(raw.includeDecks, DEPTHS[depth].wantsDecks),
    verifyAnswers: bool(raw.verifyAnswers, true), maxParallel: num(raw.maxParallel) ?? 3, mode
  })
  const exam = optStr(raw.examDate)
  if (exam && !Number.isNaN(Date.parse(exam))) r.examDate = new Date(exam).toISOString()
  const gather = decodeGather(raw.gather); if (gather) r.gather = gather
  const findings = optStr(raw.gatherFindings); if (findings) r.gatherFindings = findings
  if (typeof raw.team === 'boolean') r.team = raw.team
  if ((STUDY_GOAL_KINDS as readonly string[]).includes(raw.goalKind as string)) r.goalKind = raw.goalKind as StudyGoalKind
  return r
}

export function encodeRequest(r: GenerationRequest): Obj {
  const o: Obj = {
    packID: r.packID, title: r.title, subject: r.subject, level: r.level, language: r.language, goal: r.goal, topics: r.topics, examNotes: r.examNotes,
    sourceIDs: r.sourceIDs, exampleSourceIDs: r.exampleSourceIDs, userNotes: r.userNotes, depth: r.depth, lessonMode: r.lessonMode, allowWeb: r.allowWeb,
    includeDecks: r.includeDecks, verifyAnswers: r.verifyAnswers, maxParallel: r.maxParallel, mode: encodeMode(r.mode)
  }
  if (r.examDate) o.examDate = r.examDate
  if (r.gather) o.gather = { ...r.gather }
  if (r.gatherFindings) o.gatherFindings = r.gatherFindings
  if (r.team !== undefined) o.team = r.team
  if (r.goalKind) o.goalKind = r.goalKind
  return o
}

// MARK: El registro de una ejecución

export interface SkillRunState {
  id: string
  title: string
  status: SkillRunStatus
  attempts: number
  note: string
  openIssues: number
}

/** Un agente del equipo (un carril del monitor). Se reemite con el mismo id en cada cambio. */
export interface LaneRecord {
  id: string
  role: PipelineRole
  uiRole: UIRole
  stage: GenerationStage
  skill?: string
  title: string
  current: string
  status: 'working' | 'done' | 'failed'
  steps: number
  provider: string
  startedAt: string
  finishedAt?: string
}

export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheWriteTokens: number
}

export interface VerifyTotals { verified: number; fixed: number; flagged: number; disagreements: number; skipped: number }

export const emptyVerifyTotals = (): VerifyTotals => ({ verified: 0, fixed: 0, flagged: 0, disagreements: 0, skipped: 0 })

/** Lo nuevo que Swift no conoce (lo ignora al leer). */
export interface RunExtra {
  /** Estado para la interfaz; sin valor = se deduce del registro. */
  state?: RunState
  lanes: LaneRecord[]
  /** Cuándo se puede reanudar si se paró por un límite de uso. */
  resumeAt?: string
  errorCode?: string
  verify: VerifyTotals
  agents: number
  peakAgents: number
  /** Notas del informe final («Habilidad: lo que falta»). */
  notes: string[]
  /** Petición de «Preparar más ejercicios» que recogió esta ampliación. */
  practiceRequest?: string
  /** Evento del calendario del que salió el curso. */
  eventId?: string
  /** El mayor avance (0…1) que se ha mostrado: el monitor nunca va hacia atrás (al detener o reanudar se recalcula más bajo). */
  progress?: number
  /** Llamadas a las herramientas de internet (buscar, leer, guardar páginas): cuántas salieron bien y cuántas fallaron. */
  web?: WebToolTotals
  /** Aviso del informe sobre la investigación en internet («no se guardó ninguna fuente…»), también para Materiales. */
  researchNote?: string
  /** «Pedir cambios»: lo que tenía el curso al empezar (para decir qué se añadió). */
  baseline?: ContentCounts
}

export interface ContentCounts { skills: number; exercises: number; cards: number; lessonBlocks: number }

export interface WebToolTotals {
  ok: number
  failed: number
  /** El primer error, en una línea («Could not save the page: … fetch failed»). */
  firstError?: string
}

export interface GenerationRunState {
  runID: string
  request: GenerationRequest
  stages: Record<GenerationStage, StageStatus>
  skills: SkillRunState[]
  startedAt: string
  finishedAt?: string
  usage: UsageTotals
  providerNames: Record<string, string>
  failure?: string
  summaries: Record<string, string>
  cancelled: boolean
  aula2: RunExtra
}

const STAGE_STATUSES: readonly StageStatus[] = ['pending', 'running', 'done', 'skipped', 'failed']
const SKILL_STATUSES: readonly SkillRunStatus[] = ['pending', 'running', 'repairing', 'verifying', 'done', 'needsReview', 'failed']
const RUN_STATES: readonly RunState[] = ['running', 'waiting', 'paused', 'limit', 'done', 'failed', 'cancelled']

export const emptyUsage = (): UsageTotals => ({ promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 })

export function addUsage(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals {
  const n = (x: number | undefined): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    promptTokens: a.promptTokens + n(b.promptTokens), completionTokens: a.completionTokens + n(b.completionTokens), reasoningTokens: a.reasoningTokens + n(b.reasoningTokens),
    cachedTokens: a.cachedTokens + n(b.cachedTokens), cacheWriteTokens: a.cacheWriteTokens + n(b.cacheWriteTokens)
  }
}

export function pendingStages(): Record<GenerationStage, StageStatus> {
  return Object.fromEntries(GENERATION_STAGES.map((s) => [s, 'pending'])) as Record<GenerationStage, StageStatus>
}

/** «run-20261026-101500-k3f»: el formato de los nombres de Swift (hora local). */
export function newRunID(now: Date, random: string): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `run-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${random}`
}

export function newRunState(runID: string, request: GenerationRequest, now: Date): GenerationRunState {
  return {
    runID, request, stages: pendingStages(), skills: [], startedAt: now.toISOString(), usage: emptyUsage(), providerNames: {}, summaries: {}, cancelled: false,
    aula2: { lanes: [], verify: emptyVerifyTotals(), agents: 0, peakAgents: 0, notes: [] }
  }
}

function decodeSkillRun(raw: unknown): SkillRunState | undefined {
  if (!isObj(raw) || typeof raw.id !== 'string') return undefined
  return {
    id: raw.id, title: str(raw.title, raw.id), status: SKILL_STATUSES.includes(raw.status as SkillRunStatus) ? (raw.status as SkillRunStatus) : 'pending',
    attempts: Math.max(0, Math.trunc(num(raw.attempts) ?? 0)), note: str(raw.note), openIssues: Math.max(0, Math.trunc(num(raw.openIssues) ?? 0))
  }
}

function decodeLane(raw: unknown): LaneRecord | undefined {
  if (!isObj(raw) || typeof raw.id !== 'string') return undefined
  const role = (PIPELINE_ROLES as readonly string[]).includes(raw.role as string) ? (raw.role as PipelineRole) : 'author'
  const stage = (GENERATION_STAGES as readonly string[]).includes(raw.stage as string) ? (raw.stage as GenerationStage) : 'author'
  const status = raw.status === 'done' || raw.status === 'failed' ? raw.status : 'working'
  const lane: LaneRecord = {
    id: raw.id, role, uiRole: typeof raw.uiRole === 'string' ? (raw.uiRole as UIRole) : uiRoleFor(role), stage, title: str(raw.title), current: str(raw.current), status,
    steps: Math.max(0, Math.trunc(num(raw.steps) ?? 0)), provider: str(raw.provider), startedAt: str(raw.startedAt, new Date(0).toISOString())
  }
  const skill = optStr(raw.skill); if (skill) lane.skill = skill
  const fin = optStr(raw.finishedAt); if (fin) lane.finishedAt = fin
  return lane
}

function decodeExtra(raw: unknown): RunExtra {
  const o = isObj(raw) ? raw : {}
  const v = isObj(o.verify) ? o.verify : {}
  const n = (x: unknown): number => Math.max(0, Math.trunc(num(x) ?? 0))
  const extra: RunExtra = {
    lanes: Array.isArray(o.lanes) ? o.lanes.map(decodeLane).filter((l): l is LaneRecord => !!l) : [],
    verify: { verified: n(v.verified), fixed: n(v.fixed), flagged: n(v.flagged), disagreements: n(v.disagreements), skipped: n(v.skipped) },
    agents: n(o.agents), peakAgents: n(o.peakAgents), notes: strings(o.notes)
  }
  if (RUN_STATES.includes(o.state as RunState)) extra.state = o.state as RunState
  const resume = optStr(o.resumeAt); if (resume) extra.resumeAt = resume
  const code = optStr(o.errorCode); if (code) extra.errorCode = code
  const pr = optStr(o.practiceRequest); if (pr) extra.practiceRequest = pr
  const ev = optStr(o.eventId); if (ev) extra.eventId = ev
  const pg = num(o.progress); if (pg !== undefined && pg >= 0 && pg <= 1) extra.progress = pg
  if (isObj(o.web)) {
    const web: WebToolTotals = { ok: n(o.web.ok), failed: n(o.web.failed) }
    const first = optStr(o.web.firstError); if (first) web.firstError = first
    extra.web = web
  }
  const rn = optStr(o.researchNote); if (rn) extra.researchNote = rn
  if (isObj(o.baseline)) extra.baseline = { skills: n(o.baseline.skills), exercises: n(o.baseline.exercises), cards: n(o.baseline.cards), lessonBlocks: n(o.baseline.lessonBlocks) }
  return extra
}

/** Lectura tolerante (ver `GenerationRunState.init(from:)`): solo el id y la petición son imprescindibles. */
export function decodeRunState(raw: unknown): GenerationRunState | undefined {
  if (!isObj(raw) || typeof raw.runID !== 'string') return undefined
  const request = decodeRequest(raw.request)
  if (!request) return undefined
  const stages = pendingStages()
  if (isObj(raw.stages)) {
    // una etapa con un estado desconocido cuenta como pendiente (se repite) en vez de perder todo el registro
    for (const s of GENERATION_STAGES) { const v = raw.stages[s]; stages[s] = STAGE_STATUSES.includes(v as StageStatus) ? (v as StageStatus) : 'pending' }
  }
  const usage = isObj(raw.usage) ? addUsage(emptyUsage(), raw.usage as Partial<UsageTotals>) : emptyUsage()
  const started = optStr(raw.startedAt)
  const state: GenerationRunState = {
    runID: raw.runID, request, stages,
    skills: Array.isArray(raw.skills) ? raw.skills.map(decodeSkillRun).filter((s): s is SkillRunState => !!s) : [],
    startedAt: started && !Number.isNaN(Date.parse(started)) ? started : new Date().toISOString(), usage,
    providerNames: isObj(raw.providerNames) ? Object.fromEntries(Object.entries(raw.providerNames).filter((e): e is [string, string] => typeof e[1] === 'string')) : {},
    summaries: isObj(raw.summaries) ? Object.fromEntries(Object.entries(raw.summaries).filter((e): e is [string, string] => typeof e[1] === 'string')) : {},
    cancelled: raw.cancelled === true, aula2: decodeExtra(raw.aula2)
  }
  const fin = optStr(raw.finishedAt); if (fin && !Number.isNaN(Date.parse(fin))) state.finishedAt = fin
  const failure = optStr(raw.failure); if (failure) state.failure = failure
  return state
}

export function encodeRunState(s: GenerationRunState): Obj {
  const o: Obj = {
    runID: s.runID, request: encodeRequest(s.request), stages: { ...s.stages }, skills: s.skills.map((k) => ({ ...k })), startedAt: s.startedAt, usage: { ...s.usage },
    providerNames: { ...s.providerNames }, summaries: { ...s.summaries }, cancelled: s.cancelled,
    aula2: { ...s.aula2, lanes: s.aula2.lanes.map((l) => ({ ...l })), ...(s.aula2.web ? { web: { ...s.aula2.web } } : {}) }
  }
  if (s.finishedAt) o.finishedAt = s.finishedAt
  if (s.failure) o.failure = s.failure
  return o
}

/**
 * Al reanudar: lo que se cortó a medio escribir se vuelve a escribir, pero lo que se cortó durante la verificación ya estaba
 * escrito (solo se vuelve a verificar), y la etapa que estaba en marcha vuelve a empezar.
 */
export function prepareForResume(saved: GenerationRunState): GenerationRunState {
  const st: GenerationRunState = { ...saved, stages: { ...saved.stages }, skills: saved.skills.map((s) => ({ ...s })), aula2: { ...saved.aula2 } }
  for (const s of st.skills) {
    if (s.status === 'verifying') s.status = 'done'
    else if (s.status === 'running' || s.status === 'repairing') s.status = 'pending'
  }
  for (const k of GENERATION_STAGES) if (st.stages[k] === 'running') st.stages[k] = 'pending'
  delete st.failure
  delete st.finishedAt
  st.cancelled = false
  delete st.aula2.state
  delete st.aula2.resumeAt
  delete st.aula2.errorCode
  // los carriles que quedaron «trabajando» ya no trabajan
  st.aula2.lanes = st.aula2.lanes.map((l) => (l.status === 'working' ? { ...l, status: 'done' } : l))
  return st
}

/** Estado para la interfaz cuando el registro no lo dice (ejecuciones de Swift o cortadas al cerrar la app). */
export function inferredRunState(s: GenerationRunState, active: boolean): RunState {
  if (s.aula2.state && (active || !['running', 'waiting'].includes(s.aula2.state))) return s.aula2.state
  if (active) return 'running'
  if (s.finishedAt && !s.cancelled && !s.failure) return 'done'
  if (s.failure) return 'failed'
  return 'paused'
}

// MARK: Avance

const SKILL_WEIGHT: Record<SkillRunStatus, number> = { pending: 0, running: 0.3, repairing: 0.7, verifying: 1, done: 1, needsReview: 1, failed: 1 }

/** Avance global 0…1 (pesos aproximados de cada etapa; varias pueden ir a la vez). Las etapas omitidas no cuentan. */
export function runProgress(s: GenerationRunState, finished: boolean, verifyDone: number): number {
  if (finished) return 1
  const extend = s.request.mode.kind === 'extend'
  const weights: Record<GenerationStage, number> = {
    prepare: 0.02, gather: s.request.gather && !extend ? 0.1 : 0, plan: extend ? 0 : 0.08, author: 0.52, crossCutting: extend ? 0 : 0.08, verify: 0.22, polish: 0.02
  }
  const stageProgress = (g: GenerationStage): number => {
    if (!s.skills.length) return 0.3
    if (g === 'author') return s.skills.reduce((a, k) => a + SKILL_WEIGHT[k.status], 0) / s.skills.length
    if (g === 'verify') return Math.min(1, verifyDone / s.skills.length)
    return 0.4
  }
  let total = 0
  let sum = 0
  for (const g of GENERATION_STAGES) {
    const st = s.stages[g]
    if (st === 'skipped') continue
    const w = weights[g]
    sum += w
    if (st === 'done') total += w
    else if (st === 'running') total += w * stageProgress(g)
  }
  return sum > 0 ? Math.min(0.99, total / sum) : 0
}

/** La etapa que se ve como «actual»: la primera en marcha o, si no, la última hecha. */
/** Cuánto contenido tiene un curso (para el informe de «Pedir cambios»). */
export function countContent(pack: { skills: ReadonlyArray<{ id: string }> }, load: (id: string) => { exercises: unknown[]; cards: unknown[]; lesson: unknown[] } | undefined): ContentCounts {
  const c: ContentCounts = { skills: pack.skills.length, exercises: 0, cards: 0, lessonBlocks: 0 }
  for (const ref of pack.skills) {
    const k = load(ref.id)
    if (!k) continue
    c.exercises += k.exercises.length; c.cards += k.cards.length; c.lessonBlocks += k.lesson.length
  }
  return c
}

/** El avance que se muestra: el calculado, pero nunca por debajo del mayor ya mostrado en esta ejecución. */
export function shownProgress(s: GenerationRunState, finished: boolean, verifyDone: number): number {
  if (finished) return 1
  return Math.max(runProgress(s, false, verifyDone), s.aula2.progress ?? 0)
}

export function currentStage(s: GenerationRunState): GenerationStage {
  const running = GENERATION_STAGES.find((g) => s.stages[g] === 'running')
  if (running) return running
  const failed = GENERATION_STAGES.find((g) => s.stages[g] === 'failed')
  if (failed) return failed
  const done = [...GENERATION_STAGES].reverse().find((g) => s.stages[g] === 'done')
  return done ?? 'prepare'
}

// MARK: Equipo: reparto del trabajo

/**
 * Reparto de los materiales entre lectores: grupos equilibrados por tamaño (un material enorme va solo).
 * `budget`: caracteres que un lector puede repasar con calma.
 */
export function readingGroups(sources: Array<{ id: string; characters: number }>, maxGroups: number, budget = 90_000): string[][] {
  if (!sources.length || maxGroups <= 0) return []
  const sorted = [...sources].sort((a, b) => b.characters - a.characters)
  const total = sorted.reduce((n, s) => n + Math.max(1, s.characters), 0)
  const wanted = Math.min(maxGroups, sorted.length, Math.max(1, Math.ceil(total / budget)))
  const bins = Array.from({ length: wanted }, () => ({ ids: [] as string[], size: 0 }))
  for (const s of sorted) {
    // al grupo más ligero (equilibra la carga de cada lector)
    let i = 0
    for (let k = 1; k < bins.length; k++) if (bins[k].size < bins[i].size) i = k
    bins[i].ids.push(s.id)
    bins[i].size += Math.max(1, s.characters)
  }
  return bins.map((b) => b.ids).filter((g) => g.length > 0)
}

/**
 * Caché de prompts: el contexto del curso es idéntico para todos los autores; se saca de la tarea y va delante como contexto
 * compartido (el modelo ve lo mismo, en otro orden). Si el texto no aparece tal cual, la tarea queda como estaba.
 */
export function splitSharedContext(prompt: string, candidates: readonly string[]): { shared: string; prompt: string } {
  for (const c of candidates) {
    if (Array.from(c).length < 200) continue
    const i = prompt.indexOf(c)
    if (i < 0) continue
    return { shared: c, prompt: prompt.slice(0, i) + prompt.slice(i + c.length) }
  }
  return { shared: '', prompt }
}
