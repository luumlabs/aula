// Aprendizaje guiado sin conexión (port de StudyEngine/Learning/LearningController.swift): la lección se parte en conceptos
// (explicación + preguntas que la certifican); cada concepto pide DOS aciertos independientes al primer intento (uno si solo
// tiene preguntas abiertas), y un error, una pista o ver la solución llevan a una reexplicación y a una pregunta nueva.
// La interfaz manda en la navegación y guarda el `SkillProgress` que devuelve cada paso.
import { RawNumber, type JSONObject, type JSONValue } from '@engine/base/json'
import {
  encodeAnswer, encodeBlock, encodeTemplate, hasOwnKey, isReviewUsable, makeLearningConcept, makeSkillProgress, ownValue, setOwn,
  type Answer, type Attempt, type Block, type Exercise, type ExerciseTemplate, type LearningConceptProgress, type LearningPhase, type Skill, type SkillProgress
} from '@shared/schema'
import { canonicalInput, correctAnswerMarkdown, grade, type AnswerInput, type GradeResult } from '@engine/grading'
import { L } from '@engine/grading/messages'
import type { CheckKind, CheckOptions, CheckUse, ConceptView, LearningConcept, LearningStep, StudyLang } from './types'
import { PracticeQueue } from './practice'
import { canonicalJSON, fnv1a64, normalizeText, StudyMix, u64, unique } from './util'

const REQUIRED = 2
const GOLDEN = 0x9e3779b97f4a7c15n

// MARK: JSON canónico y huellas

const STRIPPED_KEYS = new Set(['id', 'why', 'source', 'help', 'shuffle', 'prefix', 'suffix', 'placeholder'])

function stripped(v: JSONValue): JSONValue {
  if (Array.isArray(v)) return v.map(stripped)
  if (v !== null && typeof v === 'object' && !(v instanceof RawNumber)) {
    const clean: JSONObject = {}
    for (const [k, x] of Object.entries(v)) if (!STRIPPED_KEYS.has(k) && x !== undefined) setOwn(clean, k, stripped(x))
    if (Array.isArray(clean.options)) clean.options = [...clean.options].sort((a, b) => { const x = canonicalJSON(a), y = canonicalJSON(b); return x < y ? -1 : x > y ? 1 : 0 })
    return clean
  }
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim()
  return v
}

function blocksValue(blocks: readonly Block[]): JSONValue {
  return blocks.map((b) => {
    const o: JSONObject = { ...encodeBlock(b) }
    delete o.id
    return stripped(o)
  })
}

const answerValue = (a: Answer): JSONValue => stripped(encodeAnswer(a))

/** Ignora ids y metadatos del feedback: copiar una pregunta no fabrica evidencia independiente. */
export function fingerprint(e: Exercise): string {
  return fnv1a64(canonicalJSON({ prompt: blocksValue(e.prompt), answer: answerValue(e.answer) }))
}

function templateRevision(t: ExerciseTemplate): string {
  const enc = encodeTemplate(t)
  const value: JSONObject = { vars: enc.vars ?? null, constraints: [...t.constraints], prompt: blocksValue(t.prompt), answer: answerValue(t.answer) }
  return fnv1a64(canonicalJSON(stripped(value)))
}

// MARK: Ayudas

const isText = (b: Block): b is Extract<Block, { type: 'text' }> => b.type === 'text'
const isHeading = (b: Block): boolean => isText(b) && b.md.trim().startsWith('#')
const containsHeading = (blocks: readonly Block[]): boolean => blocks.some(isHeading)

const RECAP_TITLES = ['resumen', 'repaso', 'recap', 'summary', 'recuerda', 'remember', 'key points', 'errores comunes', 'common mistakes', 'consejos', 'exam tips']

function isRecap(blocks: readonly Block[]): boolean {
  if (blocks.some((b) => b.type === 'recap')) return true
  return blocks.some((b) => {
    if (!isText(b)) return false
    const first = b.md.trim().split('\n')[0] ?? ''
    if (!first.startsWith('#')) return false
    const title = normalizeText(first.replace(/^[#\s]+/, ''))
    return RECAP_TITLES.some((t) => title === t || title.startsWith(t + ':'))
  })
}

function conceptTitle(blocks: readonly Block[], fallback: string): string {
  for (const b of blocks) {
    if (isText(b)) for (const line of b.md.split('\n')) if (line.startsWith('#')) return line.replace(/^[#\s]+/, '')
    if (b.type === 'example' && b.title) return b.title
  }
  return fallback
}

const IGNORED_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'find', 'calculate', 'solve', 'what', 'which', 'write',
  'los', 'las', 'una', 'uno', 'del', 'con', 'por', 'que', 'para', 'cual', 'calcula', 'halla', 'resuelve', 'escribe', 'tiene', 'igual'])
const GENERIC_TAGS = new Set(['math', 'mathematics', 'matematicas', 'science', 'ciencia', 'basic', 'basico', 'practice', 'practica', 'exam', 'examen',
  'lesson', 'leccion', 'numeric', 'choice', 'text', 'standard', 'estandar'])

function words(blocks: readonly Block[]): Set<string> {
  const prose = blocks.filter(isText).map((b) => b.md).join(' ')
  const clean = normalizeText(prose.replace(/\{\{.*?\}\}|\\[a-zA-Z]+/g, ' '))
  return new Set(clean.split(/[^\p{L}]+/u).filter((w) => Array.from(w).length >= 3 && !IGNORED_WORDS.has(w)))
}

function related(tags: readonly string[], prompt: readonly Block[], answer: Answer, bound: readonly Exercise[], conceptTags: ReadonlySet<string>, teaching: string): boolean {
  const normalized = tags.map(normalizeText).filter((t) => Array.from(t).length >= 3 && !GENERIC_TAGS.has(t))
  if (normalized.some((t) => conceptTags.has(t) || teaching.includes(t))) return true
  // los bancos sin etiquetas usan el mismo enunciado con otros números: todas las palabras con sentido y el mismo tipo de respuesta
  const target = words(prompt)
  if (target.size < 2) return false
  return bound.some((b) => b.answer.kind === answer.kind && [...target].every((w) => words(b.prompt).has(w)))
}

const findExercise = (skill: Skill, id: string): Exercise | undefined => skill.exercises.find((e) => e.id === id)

/** Una pregunta abierta con enunciado (y respuesta modelo o rúbrica): la corrige Aula o el estudiante se autoevalúa. */
function selfAssessable(e: Exercise): boolean {
  if (!isReviewUsable(e.review) || !e.prompt.length || e.answer.kind !== 'open') return false
  return e.answer.modelAnswer.trim() !== '' || e.answer.rubric.length > 0
}

function canonicalFor(a: Answer): AnswerInput | undefined {
  if (a.kind === 'multi') {
    const parts = a.parts.map((p) => canonicalFor(p.answer))
    return parts.length && parts.every((p) => p !== undefined) ? { kind: 'parts', parts: parts as AnswerInput[] } : undefined
  }
  return canonicalInput(a)
}

const usableCache = new WeakMap<Exercise, boolean>()

/** Solo certifica una respuesta que el corrector sin conexión puede verificar de verdad. */
function usable(e: Exercise): boolean {
  const hit = usableCache.get(e)
  if (hit !== undefined) return hit
  let ok = false
  if (isReviewUsable(e.review) && e.prompt.length) {
    const input = canonicalFor(e.answer)
    if (input) { const r = grade(e, input); ok = r.status === 'correct' && !r.needsReview && r.credit >= 0.999 }
  }
  usableCache.set(e, ok)
  return ok
}

function hasExplanation(e: Exercise): boolean {
  return e.hints.length > 0 || e.solution.length > 0 || (e.answer.kind === 'choice' && e.answer.options.some((o) => o.correct && !!o.why))
}

const textBlock = (id: string, md: string): Block => ({ id, type: 'text', md })
const promptText = (e: Exercise): string => e.prompt.filter(isText).map((b) => b.md).join('\n')

// MARK: Estado de un concepto

/** Estado guardado del concepto, o uno nuevo. Si cambió la explicación o una pregunta, la evidencia vieja no vale. */
function conceptState(concept: LearningConcept, progress: SkillProgress | undefined): LearningConceptProgress {
  const saved = ownValue(progress?.learning, concept.id)
  if (!saved) return makeLearningConcept({ revision: concept.revision })
  const s: LearningConceptProgress = { ...saved, successfulChecks: [...saved.successfulChecks], attemptedChecks: [...saved.attemptedChecks], successfulSources: { ...saved.successfulSources }, remediation: [...saved.remediation] }
  const changedSource = Object.entries(s.successfulSources).some(([k, v]) => ownValue(concept.questionRevisions, k) !== v)
  const active = s.activeExercise
  const changedActive = active ? ownValue(concept.questionRevisions, active.templateID ?? active.id) !== s.activeSourceRevision : false
  if (s.revision !== concept.revision || changedSource || changedActive || (s.successfulChecks.length > 0 && Object.keys(s.successfulSources).length === 0)) {
    // se conservan las huellas intentadas y el historial del curso, pero no un dominio obsoleto
    s.revision = concept.revision; s.phase = 'explanation'; s.successfulChecks = []; s.successfulSources = {}
    s.remediation = []
    delete s.lastExercise; delete s.activeExercise; delete s.activeSourceRevision; delete s.activeInput; delete s.passedWithout
  }
  return s
}

function clearActive(s: LearningConceptProgress): void {
  delete s.activeExercise; delete s.activeSourceRevision; delete s.activeInput
}

/** Copia del progreso de la habilidad con el estado de un concepto sustituido. */
function withConcept(progress: SkillProgress | undefined, id: string, state: LearningConceptProgress): SkillProgress {
  const base = progress ?? makeSkillProgress()
  return { ...base, learning: { ...base.learning, [id]: state } }
}

const allUsed = (p: SkillProgress | undefined): Set<string> => new Set(Object.values(p?.learning ?? {}).flatMap((s) => [...s.attemptedChecks, ...s.successfulChecks]))

function hasObjectiveSource(c: LearningConcept): boolean {
  if (c.templateIDs.length) return true
  return Object.values(c.questionRevisions).some((v) => v.endsWith(':usable'))
}

function belongs(e: Exercise, c: LearningConcept): boolean {
  return c.exerciseIDs.includes(e.id) || c.inlineExercises.some((x) => x.id === e.id) || (e.templateID !== undefined && c.templateIDs.includes(e.templateID))
}

const conceptCache = new WeakMap<Skill, LearningConcept[]>()

export const LearningController = {
  requiredSuccesses: REQUIRED,
  fingerprint,

  concepts(skill: Skill): LearningConcept[] {
    const hit = conceptCache.get(skill)
    if (hit) return hit
    const out = buildConcepts(skill)
    conceptCache.set(skill, out)
    return out
  },

  status(concept: LearningConcept, progress: SkillProgress | undefined): LearningPhase {
    const s = conceptState(concept, progress)
    if (s.phase === 'mastered' && new Set(s.successfulChecks).size < LearningController.requiredSuccessesFor(concept)) {
      // superado sin dos aciertos solo si no había ninguna pregunta o el estudiante eligió seguir al acabarse
      if (s.passedWithout === 'explanation' && !hasObjectiveSource(concept)) return 'mastered'
      if (s.passedWithout === 'unchecked') return 'mastered'
      return 'check'
    }
    return s.phase
  },

  /** Dos con preguntas que Aula corrige sola; uno (con la nota completa) si el concepto solo tiene preguntas abiertas. */
  requiredSuccessesFor(concept: LearningConcept): number {
    return hasObjectiveSource(concept) ? REQUIRED : 1
  },

  checkKind(concept: LearningConcept, skill: Skill): CheckKind {
    if (concept.templateIDs.length) return 'objective'
    const all = [...concept.exerciseIDs.map((id) => findExercise(skill, id)).filter((e): e is Exercise => !!e), ...concept.inlineExercises]
    if (all.some(usable)) return 'objective'
    if (all.some(selfAssessable)) return 'selfAssessed'
    return 'none'
  },

  /** Preguntas distintas que Aula puede corregir sola (con plantillas, `Infinity`). */
  objectiveCheckCount(concept: LearningConcept, skill: Skill): number {
    if (concept.templateIDs.length) return Number.POSITIVE_INFINITY
    const seen = new Set<string>()
    return [...concept.exerciseIDs.map((id) => findExercise(skill, id)).filter((e): e is Exercise => !!e), ...concept.inlineExercises]
      .filter((e) => { if (!usable(e)) return false; const f = fingerprint(e); if (seen.has(f)) return false; seen.add(f); return true }).length
  },

  isUnchecked(concept: LearningConcept, progress: SkillProgress | undefined): boolean {
    const s = conceptState(concept, progress)
    return s.phase === 'mastered' && s.passedWithout === 'unchecked' && new Set(s.successfulChecks).size < LearningController.requiredSuccessesFor(concept)
  },

  canAdvance(concept: LearningConcept, progress: SkillProgress | undefined): boolean {
    return LearningController.status(concept, progress) === 'mastered'
  },

  successfulCheckCount(concept: LearningConcept, progress: SkillProgress | undefined): number {
    return new Set(conceptState(concept, progress).successfulChecks).size
  },

  isMastered(skill: Skill, progress: SkillProgress | undefined): boolean {
    const cs = LearningController.concepts(skill)
    return cs.length > 0 && cs.every((c) => LearningController.canAdvance(c, progress))
  },

  unlocked(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined): boolean {
    const cs = LearningController.concepts(skill)
    const index = cs.findIndex((c) => c.id === concept.id && c.revision === concept.revision)
    if (index < 0) return false
    return cs.slice(0, index).every((c) => LearningController.canAdvance(c, progress))
  },

  overview(skill: Skill, progress: SkillProgress | undefined): ConceptView[] {
    let unlocked = true
    return LearningController.concepts(skill).map((c) => {
      const phase = LearningController.status(c, progress)
      const view: ConceptView = {
        id: c.id, title: c.title, phase, successes: LearningController.successfulCheckCount(c, progress), required: LearningController.requiredSuccessesFor(c),
        checkKind: LearningController.checkKind(c, skill), objectiveChecks: LearningController.objectiveCheckCount(c, skill), unlocked,
        canAdvance: phase === 'mastered', unchecked: LearningController.isUnchecked(c, progress), prepareMore: phase === 'needsPractice'
      }
      unlocked = unlocked && view.canAdvance
      return view
    })
  },

  step(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, exercise: Exercise | undefined, lang?: StudyLang, attempts: readonly Attempt[] = []): LearningStep {
    const phase = LearningController.status(concept, progress)
    const out: LearningStep = { progress: progress ?? makeSkillProgress(), phase, remediation: [], prepareMore: phase === 'needsPractice' }
    if (exercise) out.exercise = exercise
    if (phase === 'reteach') out.remediation = LearningController.remediationBlocks(concept, skill, progress, attempts, lang)
    return out
  },

  /** Sin preguntas y sin poder preparar más: el concepto queda «sin comprobar» y la lección sigue. */
  continueWithoutChecks(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined): LearningStep & { applied: boolean } {
    if (!LearningController.unlocked(concept, skill, progress) || LearningController.status(concept, progress) !== 'needsPractice') {
      return { ...LearningController.step(concept, skill, progress, undefined), applied: false }
    }
    const s = conceptState(concept, progress)
    s.phase = 'mastered'; s.passedWithout = 'unchecked'
    clearActive(s)
    return { ...LearningController.step(concept, skill, withConcept(progress, concept.id, s), undefined), applied: true }
  },

  /** También da por leída la reexplicación tras un error. Leer nunca cuenta como respuesta. */
  acknowledgeExplanation(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, opts: CheckOptions = {}): LearningStep {
    if (!LearningController.unlocked(concept, skill, progress) || LearningController.canAdvance(concept, progress)) return LearningController.step(concept, skill, progress, undefined, opts.lang)
    const s = conceptState(concept, progress)
    // sin ninguna pregunta posible (una sección final de consejos, un resumen) leer la explicación basta
    if (LearningController.checkKind(concept, skill) === 'none') {
      s.phase = 'mastered'; s.passedWithout = 'explanation'
      clearActive(s)
      return LearningController.step(concept, skill, withConcept(progress, concept.id, s), undefined, opts.lang)
    }
    if (s.phase === 'reteach' || s.lastExercise) {
      // la reexplicación es la pista y la solución de la pregunta fallada: se sigue con una pregunta nueva
      const teaching = remediation(concept, skill, progress, opts.attempts ?? [], opts.lang)
      // un ejemplo resuelto enseñado nunca cuenta luego como respuesta independiente
      if (teaching.exercise) s.attemptedChecks.push(fingerprint(teaching.exercise))
      s.remediation = teaching.blocks
      delete s.lastExercise
    }
    s.phase = 'check'
    return LearningController.prepareCheck(concept, skill, withConcept(progress, concept.id, s), opts)
  },

  /** Guarda una pregunta nueva como activa, o conserva la que quedó sin responder al reabrir. */
  prepareCheck(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, opts: CheckOptions = {}): LearningStep {
    if (!LearningController.unlocked(concept, skill, progress) || LearningController.status(concept, progress) !== 'check') return LearningController.step(concept, skill, progress, undefined, opts.lang)
    const exercise = LearningController.nextCheck(concept, skill, progress, opts)
    if (!exercise) return LearningController.step(concept, skill, LearningController.markNeedsPractice(concept, progress), undefined, opts.lang)
    const s = conceptState(concept, progress)
    if (!s.activeExercise || fingerprint(s.activeExercise) !== fingerprint(exercise)) delete s.activeInput
    s.activeExercise = exercise
    const rev = ownValue(concept.questionRevisions, exercise.templateID ?? exercise.id)
    if (rev !== undefined) s.activeSourceRevision = rev; else delete s.activeSourceRevision
    return LearningController.step(concept, skill, withConcept(progress, concept.id, s), exercise, opts.lang)
  },

  /** Solo los ejercicios del concepto, sus incrustados y las plantillas asociadas. */
  nextCheck(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, opts: CheckOptions = {}): Exercise | undefined {
    if (LearningController.status(concept, progress) !== 'check') return undefined
    const attempts = opts.attempts ?? []
    const used = usedFingerprints(skill, progress, attempts)
    const past = new Set(attempts.filter((a) => a.skill === skill.id).map((a) => a.exerciseID))
    const eligible = LearningController.checkKind(concept, skill) === 'selfAssessed' ? selfAssessable : usable
    const active = conceptState(concept, progress).activeExercise
    if (active && belongs(active, concept) && eligible(active) && !used.has(fingerprint(active))) return active
    for (const e of concept.inlineExercises) if (past.has(e.id)) used.add(fingerprint(e))
    const seen = new Set<string>()
    const candidates = [...concept.exerciseIDs.map((id) => findExercise(skill, id)).filter((e): e is Exercise => !!e), ...concept.inlineExercises]
      .filter((e) => { if (!eligible(e)) return false; const f = fingerprint(e); if (seen.has(f)) return false; seen.add(f); return true })
    const fresh = candidates.find((e) => !used.has(fingerprint(e)))
    if (fresh) return fresh
    // el punto de partida se mueve con la evidencia: llamadas repetidas no agotan las 32 primeras variantes
    const seed = typeof opts.seed === 'bigint' ? opts.seed : BigInt(Math.trunc(Math.max(0, opts.seed ?? 0)))
    const rng = new StudyMix(u64(seed + u64(BigInt(used.size) * GOLDEN)))
    for (const t of skill.templates) {
      if (!concept.templateIDs.includes(t.id)) continue
      // pools finitos y variables sin usar pueden dar la misma pregunta varias veces
      for (let k = 0; k < 32; k++) {
        const e = PracticeQueue.defaultInstantiate(t, rng.next())
        if (!e || !usable(e) || past.has(e.id) || used.has(fingerprint(e))) continue
        return e
      }
    }
    return undefined
  },

  recordCheck(concept: LearningConcept, skill: Skill, exercise: Exercise, result: GradeResult, use: CheckUse, progress: SkillProgress | undefined): LearningStep {
    const unchanged = (): LearningStep => LearningController.step(concept, skill, progress, undefined, use.lang)
    if (LearningController.status(concept, progress) !== 'check') return unchanged()
    const objective = usable(exercise)
    // una pregunta abierta solo certifica en un concepto que no tiene ninguna objetiva
    if (!belongs(exercise, concept) || !(objective || (selfAssessable(exercise) && !hasObjectiveSource(concept)))) return unchanged()
    // una entrada ilegible o una respuesta abierta sin corregir no son prueba de un error de concepto
    if (result.status === 'invalid' || result.needsReview) return unchanged()
    const s = conceptState(concept, progress)
    const key = fingerprint(exercise)
    if (!s.activeExercise || fingerprint(s.activeExercise) !== key || s.activeSourceRevision !== ownValue(concept.questionRevisions, exercise.templateID ?? exercise.id)) return unchanged()
    if (allUsed(progress).has(key)) return unchanged()
    s.attemptedChecks.push(key)
    clearActive(s)
    // autoevaluar una respuesta abierta enseña la respuesta modelo DESPUÉS de contestar: eso no es ayuda
    const first = use.firstAttempt ?? true
    const independent = first && (!use.revealed || !objective) && use.hints === 0 && result.status === 'correct' && Number.isFinite(result.credit) && result.credit >= 0.999
    if (independent) {
      s.successfulChecks.push(key)
      const source = exercise.templateID ?? exercise.id
      const revision = ownValue(concept.questionRevisions, source)
      if (revision === undefined) return unchanged()
      setOwn(s.successfulSources, source, revision)
      s.phase = new Set(s.successfulChecks).size >= LearningController.requiredSuccessesFor(concept) ? 'mastered' : 'check'
      s.remediation = []
      delete s.lastExercise
    } else {
      s.successfulChecks = []; s.successfulSources = {}; s.phase = 'reteach'; s.lastExercise = exercise
      s.remediation = result.feedback.filter((f) => f.markdown !== '').map((f, i) => textBlock(`${concept.id}-feedback-${i}`, f.markdown))
    }
    // tras un acierto que aún no certifica, la siguiente pregunta la prepara quien llama (`prepareCheck`), como en Swift
    return LearningController.step(concept, skill, withConcept(progress, concept.id, s), undefined, use.lang)
  },

  /** Pedir una pista o ver la solución invalida la pregunta en el acto, incluso antes de responder. */
  recordAssistance(concept: LearningConcept, skill: Skill, exercise: Exercise, use: Pick<CheckUse, 'hints' | 'revealed'>, progress: SkillProgress | undefined): LearningStep {
    // en una pregunta abierta, ver la respuesta modelo es parte de autoevaluarse: solo las pistas cuentan como ayuda
    const revealed = use.revealed && !selfAssessable(exercise)
    if (!(use.hints > 0 || revealed) || LearningController.status(concept, progress) !== 'check' || !belongs(exercise, concept)) return LearningController.step(concept, skill, progress, undefined)
    const s = conceptState(concept, progress)
    const key = fingerprint(exercise)
    if (!s.activeExercise || fingerprint(s.activeExercise) !== key || allUsed(progress).has(key)) return LearningController.step(concept, skill, progress, undefined)
    s.attemptedChecks.push(key); s.successfulChecks = []; s.successfulSources = {}
    s.phase = 'reteach'; s.lastExercise = exercise; s.remediation = []
    clearActive(s)
    return LearningController.step(concept, skill, withConcept(progress, concept.id, s), undefined)
  },

  markNeedsPractice(concept: LearningConcept, progress: SkillProgress | undefined): SkillProgress {
    if (LearningController.canAdvance(concept, progress)) return progress ?? makeSkillProgress()
    const s = conceptState(concept, progress)
    s.phase = 'needsPractice'
    clearActive(s)
    return withConcept(progress, concept.id, s)
  },

  /** Feedback verificado, pistas, solución comprobada y luego otro ejemplo resuelto de este concepto. */
  remediationBlocks(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, attempts: readonly Attempt[] = [], lang?: StudyLang): Block[] {
    return remediation(concept, skill, progress, attempts, lang).blocks
  }
}

// MARK: Construcción de los conceptos

function buildConcepts(skill: Skill): LearningConcept[] {
  const groups: Array<{ teaching: Block[]; checks: Block[] }> = []
  let teaching: Block[] = [], checks: Block[] = []
  const close = (): void => {
    if (!teaching.length && !checks.length) return
    groups.push({ teaching, checks }); teaching = []; checks = []
  }
  const last = (): { teaching: Block[]; checks: Block[] } => groups[groups.length - 1]
  for (const block of skill.lesson) {
    if (block.type === 'tryit') {
      // los ejercicios seguidos certifican la misma explicación (no crean una puerta de solo preguntas)
      if (!teaching.length && groups.length) { last().checks.push(...checks, block); checks = [] }
      else { checks.push(block); close() }
    } else if (block.type === 'predict' || block.type === 'spot') {
      // las preguntas de entrada se conservan como comprobaciones opcionales, tras la explicación
      checks.push(block)
    } else if (isHeading(block)) {
      // los encabezados introductorios antes de la primera comprobación son un concepto enseñado, no una puerta sin preguntas
      if (groups.length && teaching.length && !containsHeading(teaching)) {
        last().teaching.push(...teaching); last().checks.push(...checks); teaching = []; checks = []
      }
      teaching.push(block)
    } else teaching.push(block)
  }
  // un resumen, consejo de examen o error común al final pertenece al concepto anterior
  if (groups.length && (teaching.length || checks.length)) {
    if (!containsHeading(teaching) || isRecap(teaching)) {
      last().teaching.push(...teaching); last().checks.push(...checks); teaching = []; checks = []
    }
  }
  close()
  const tryIts = (blocks: readonly Block[]): Array<Extract<Block, { type: 'tryit' }>> => blocks.filter((b): b is Extract<Block, { type: 'tryit' }> => b.type === 'tryit')
  const explicitlyAssigned = new Set(groups.flatMap((g) => tryIts(g.checks).flatMap((t) => [...t.exerciseIDs, ...t.inline.map((e) => e.id)])))
  return groups.map((group, index): LearningConcept => {
    const references = tryIts(group.checks)
    const referenceIDs = unique(references.flatMap((t) => t.exerciseIDs))
    const inline = references.flatMap((t) => t.inline).map((e) => ({ ...e, skill: skill.id }))
    const bound = [...referenceIDs.map((id) => findExercise(skill, id)).filter((e): e is Exercise => !!e), ...inline]
    const tags = new Set(bound.flatMap((e) => e.tags).map(normalizeText))
    const prose = normalizeText(canonicalJSON(blocksValue(group.teaching)))
    // un banco del autor solo se usa donde sus etiquetas o su enunciado lo asocian a este concepto
    const associated = skill.exercises.filter((e) => referenceIDs.includes(e.id) || (!explicitlyAssigned.has(e.id) && related(e.tags, e.prompt, e.answer, bound, tags, prose)))
    const ids = unique([...referenceIDs, ...associated.map((e) => e.id)])
    const templates = skill.templates.filter((t) => ids.includes(t.id) || bound.some((b) => b.templateID === t.id)
      || (!explicitlyAssigned.has(t.id) && related(t.tags, t.prompt, t.answer, bound, tags, prose)))
    const id = (group.teaching[0] ?? group.checks[0])?.id ?? `${skill.id}-concept-${index}`
    const checkpoints = group.checks.filter((b) => b.type !== 'tryit')
    const revision = fnv1a64(canonicalJSON({ teaching: blocksValue(group.teaching), checks: blocksValue(checkpoints) }))
    const sources: Record<string, string> = {}
    for (const e of [...associated, ...inline]) if (!hasOwnKey(sources, e.id)) setOwn(sources, e.id, fingerprint(e) + (usable(e) ? ':usable' : ':unusable'))
    for (const t of templates) setOwn(sources, t.id, templateRevision(t))
    return {
      id, revision, title: conceptTitle(group.teaching, skill.title), teachingBlocks: group.teaching, checkpointBlocks: group.checks,
      exerciseIDs: ids, inlineExercises: inline, templateIDs: templates.map((t) => t.id), questionRevisions: sources
    }
  })
}

function usedFingerprints(skill: Skill, progress: SkillProgress | undefined, attempts: readonly Attempt[]): Set<string> {
  const used = allUsed(progress)
  const recent = attempts.filter((a) => a.skill === skill.id)
  const ids = new Set(recent.map((a) => a.exerciseID))
  for (const e of skill.exercises) if (ids.has(e.id)) used.add(fingerprint(e))
  // el historial antiguo guarda plantilla#semilla: se reconstruye su pregunta, no solo el id
  for (const a of recent) {
    const i = a.exerciseID.lastIndexOf('#')
    if (i < 0) continue
    const seedText = a.exerciseID.slice(i + 1)
    if (!/^\d+$/.test(seedText)) continue
    const t = skill.templates.find((x) => x.id === a.exerciseID.slice(0, i))
    const e = t ? PracticeQueue.defaultInstantiate(t, BigInt.asUintN(64, BigInt(seedText))) : undefined
    if (e) used.add(fingerprint(e))
  }
  return used
}

function remediation(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, attempts: readonly Attempt[], lang?: StudyLang): { blocks: Block[]; exercise?: Exercise; hasAlternative: boolean } {
  const saved = conceptState(concept, progress)
  const failed = saved.lastExercise
  const hintsAndSolution = (e: Exercise): Block[] => [...e.hints.slice(0, 2).map((h, i) => textBlock(`${concept.id}-hint-${i}`, h)), ...e.solution]
  if (failed && selfAssessable(failed) && !usable(failed)) {
    // pregunta abierta: la respuesta modelo y la solución son la reexplicación
    const blocks = [...saved.remediation, ...hintsAndSolution(failed)]
    if (failed.answer.kind === 'open' && failed.answer.modelAnswer) blocks.push(textBlock(`${concept.id}-model-answer`, L(lang, `Respuesta modelo: ${failed.answer.modelAnswer}`, `Model answer: ${failed.answer.modelAnswer}`)))
    return { blocks, hasAlternative: false }
  }
  if (!failed || !usable(failed)) return { blocks: [...saved.remediation], hasAlternative: false }
  const blocks = [...saved.remediation, ...hintsAndSolution(failed)]
  // la respuesta se comprueba con el mismo corrector sin conexión, aunque falte la solución del autor
  blocks.push(textBlock(`${concept.id}-checked-answer`, L(lang, `Respuesta comprobada: ${correctAnswerMarkdown(failed, lang)}`, `Checked answer: ${correctAnswerMarkdown(failed, lang)}`)))
  const checkState: LearningConceptProgress = { ...saved, phase: 'check', attemptedChecks: [...saved.attemptedChecks, fingerprint(failed)] }
  clearActive(checkState)
  let temporary = withConcept(progress, concept.id, checkState)
  // un ejemplo resuelto con una pregunta del banco la gasta: solo si después quedan las dos que hacen falta (y una de margen)
  let spare = 0
  let probe = temporary
  for (let k = 0; k < REQUIRED + 1; k++) {
    const candidate = LearningController.nextCheck(concept, skill, probe, { attempts })
    if (!candidate) break
    spare += 1
    const st = ownValue(probe.learning, concept.id)!
    probe = withConcept(probe, concept.id, { ...st, attemptedChecks: [...st.attemptedChecks, fingerprint(candidate)] })
  }
  let worked: Exercise | undefined
  for (let k = 0; k < 64 && spare > REQUIRED; k++) {
    const candidate = LearningController.nextCheck(concept, skill, temporary, { attempts })
    if (!candidate) break
    if (hasExplanation(candidate)) { worked = candidate; break }
    const st = ownValue(temporary.learning, concept.id)!
    temporary = withConcept(temporary, concept.id, { ...st, attemptedChecks: [...st.attemptedChecks, fingerprint(candidate)] })
  }
  if (worked) {
    const explanation = [...worked.hints, ...worked.solution.filter(isText).map((b) => b.md)]
    if (worked.answer.kind === 'choice') explanation.push(...worked.answer.options.filter((o) => o.correct && o.why).map((o) => o.why!))
    blocks.push({
      id: `${concept.id}-alternate-example`, type: 'example', title: L(lang, 'Otro ejemplo resuelto', 'Another worked example'), problem: promptText(worked),
      steps: explanation.map((md) => ({ md })), answer: correctAnswerMarkdown(worked, lang)
    })
    return { blocks, exercise: worked, hasAlternative: true }
  }
  const failedProblem = normalizeText(promptText(failed))
  const alternative = [...concept.teachingBlocks].reverse().find((b) => b.type === 'example' && b.steps.length > 0 && normalizeText(b.problem) !== failedProblem)
  if (alternative) { blocks.push(alternative); return { blocks, hasAlternative: true } }
  return { blocks, hasAlternative: false }
}
