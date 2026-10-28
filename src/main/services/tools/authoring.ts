// Herramientas que crean y modifican el curso (port de StudyEngine/Tools/AuthoringTools.swift). Cada una valida lo que recibe y
// devuelve los problemas para que la IA los corrija; lo válido se guarda dentro del cerrojo del curso (así varios agentes
// escriben a la vez sin pisarse).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { compactJSON, isJSONObject, Schema, type JSONObject, type JSONValue } from '@engine/base/json'
import { CourseLanguages } from '@engine/base/language'
import { makeInstant, wallTime, localTimeZone } from '@engine/calendar/time'
import { ContentNormalizer, ContentValidator, enrichBlock, enrichCard, enrichDeck, enrichExercise } from '@engine/content'
import { describeAnswer, instantiateTemplateOrThrow, MathKitChecker } from '@engine/grading'
import { ExamBuilder } from '@engine/study/exam'
import {
  blockTypeName, canonicalCourseHue, CourseIconCatalog, decodeBlock, encodeBlock, encodeDeck, encodeExercise, encodeFlashcard, encodeTemplate, decodeCommonMistake, decodeDeck, decodeExercise, decodeFlashcard, decodeFormulaGroup, decodeGlossaryEntry,
  decodeTemplate, makeSkill, updateSkillTryIts, type Block, type BlueprintSection, type CommonMistake, type ContentIssue, type ExamInfo, type Exercise,
  type ExerciseTemplate, type Flashcard, type FormulaGroup, type GlossaryEntry, type Pack, type Skill
} from '@shared/schema'
import { tr } from '@shared/ai/i18n'
import type { AgentTool, ToolOutput } from '../ai'
import { log } from '../log'
import type { PackStore } from '../store'
import { readJSONFile } from '../store/jsonFile'
import { assetLookup } from '../study/assets'
import { defineTool, ToolOut, type ToolArgs, type ToolContext } from './context'

const issue = (severity: ContentIssue['severity'], path: string, message: string): ContentIssue => ({ severity, path, message })

/** Si el modelo corta la llamada por su límite de salida, los argumentos llegan vacíos o rotos: que la parta. */
export const SPLIT_HINT = 'If your call was long, it was probably cut off by your output limit: send smaller batches (at most 4–5 blocks/exercises/cards per call; write_lesson with mode "append" for the rest).'
const RENAMED_HINT = 'Some ids were changed so nothing gets overwritten (see renamed_from): use the new ids from now on, e.g. in tryit exerciseIDs.'

const BLOCK_SCHEMA = Schema.freeObject('A block object: {"type": "text|math|callout|example|plot|explore|table|chart|numberline|diagram|drawing|timeline|image|steps|compare|formulas|predict|spot|tryit|recap|code|quote|labeled|model3d|simulation|map", ...fields}. See the authoring guide; call block_reference for the exact schema and examples of a type.')

/**
 * El arreglo no llegó o no se pudo leer: le dice al modelo exactamente qué pasó y guarda lo recibido para depurar
 * (`runs/<ejecución>.args/`).
 */
function badArray(ctx: ToolContext, tool: string, key: string, a: ToolArgs, what: string): ToolOutput {
  if (ctx.runID) {
    try {
      const dir = join(ctx.store.runsDirectory, `${ctx.runID}.args`)
      mkdirSync(dir, { recursive: true })
      const t = new Date()
      const p = (n: number, w = 2): string => String(n).padStart(w, '0')
      writeFileSync(join(dir, `${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${p(t.getMilliseconds(), 3)}-${tool}.json`), compactJSON(a.v))
    } catch { /* solo depuración */ }
  }
  return ToolOut.error(`Missing required argument '${key}' (${what}). ${a.diagnoseArray(key)}`, SPLIT_HINT)
}

// MARK: Fechas del examen

/**
 * Fecha del examen: los días y horas sin zona son civiles gregorianos en la zona dada (YYYY-MM-DD = las 08:00 locales); con
 * zona explícita se respeta el instante. Una fecha imposible no se normaliza ni se adivina: undefined.
 */
export function parseExamDate(s: string, timeZone: string = localTimeZone()): Date | undefined {
  const dayOnly = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)
  const localTime = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(:[0-9]{2})?$/.test(s)
  if (dayOnly || localTime) {
    const n = (a: number, b: number): number => Number(s.slice(a, b))
    const year = n(0, 4), month = n(5, 7), day = n(8, 10)
    const hour = dayOnly ? 8 : n(11, 13), minute = dayOnly ? 0 : n(14, 16)
    const second = s.length >= 19 ? n(17, 19) : 0
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined
    const ms = makeInstant(year, month, day, hour, minute, second, timeZone)
    const w = wallTime(ms, timeZone)
    if (w.year !== year || w.month !== month || w.day !== day || w.hour !== hour || w.minute !== minute || w.second !== second) return undefined
    return new Date(ms)
  }
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(s)
  if (!m) return undefined
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return undefined
  // el día debe existir en ese mes (sin normalizar el 30 de febrero)
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > dim) return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : new Date(t)
}

/** «2026-11-08» (solo el día) para un examen que ya estaba ese mismo día a una hora (la que eligió el estudiante al crear el
 * curso): se conserva su hora en vez de pasar a las 08:00 por defecto (J2-12). */
function sameDayAsBefore(date: string, before: string | undefined, timeZone: string = localTimeZone()): boolean {
  if (!before || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false
  const t = Date.parse(before)
  if (!Number.isFinite(t)) return false
  const w = wallTime(t, timeZone)
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}` === date
}

export function parseExam(v: JSONObject, old: ExamInfo | undefined, language?: string, timeZone?: string): ExamInfo {
  const title = typeof v.title === 'string' ? v.title : undefined
  const e: ExamInfo = old ? { ...old } : { title: title ?? CourseLanguages.examTitle(CourseLanguages.of(language)) }
  if (title !== undefined) e.title = title
  if (typeof v.date === 'string' && !sameDayAsBefore(v.date, old?.date, timeZone)) { const d = parseExamDate(v.date, timeZone); if (d) e.date = d.toISOString() }
  const dur = v.duration_minutes ?? v.durationMinutes
  if (typeof dur === 'number' && Number.isFinite(dur)) e.durationMinutes = Math.round(dur)
  const pts = v.total_points ?? v.totalPoints
  if (typeof pts === 'number' && Number.isFinite(pts)) e.totalPoints = pts
  if (typeof v.aids === 'string') e.aids = v.aids
  if (typeof v.notes === 'string') e.notes = v.notes
  if (typeof v.location === 'string') e.location = v.location
  return e
}

/** «Cómo es el examen» se muestra como texto plano: sin las marcas de Markdown que algunos modelos ponen. */
export function plainInstructions(s: string | undefined): string | undefined {
  const t = s?.trim()
  if (!t) return undefined
  return t.split('**').join('').split('__').join('').replace(/^#{1,6}\s+/gm, '')
}

// MARK: Ids de lo que se guarda (siempre dentro del cerrojo de `updateSkill`)

/**
 * Ids que ya usan las OTRAS habilidades del curso: ejercicios y plantillas (comparten espacio: las variantes de una plantilla son
 * «plantilla#semilla») y tarjetas. El progreso los indexa por id en todo el curso, así que no se pueden repetir entre habilidades.
 */
export function idsElsewhere(store: PackStore, except: string): { exercises: Set<string>; cards: Set<string> } {
  const exercises = new Set<string>()
  const cards = new Set<string>()
  let ids: string[] = []
  try { ids = [...new Set(store.loadPack().skills.map((s) => s.id))] } catch { ids = [] }
  for (const id of ids) {
    if (id === except) continue
    let raw: unknown
    try { raw = readJSONFile(store.skillPath(id)) } catch { continue }
    if (!isJSONObject(raw)) continue
    const collect = (k: string, into: Set<string>): void => {
      const list = raw && isJSONObject(raw) ? raw[k] : undefined
      if (Array.isArray(list)) for (const it of list) if (isJSONObject(it) && typeof it.id === 'string') into.add(it.id)
    }
    collect('exercises', exercises)
    collect('templates', exercises)
    collect('cards', cards)
  }
  return { exercises, cards }
}

/**
 * Reparte los ids de un lote dentro del cerrojo, sin pisar nunca otro elemento:
 * - sin id: el primer «<prefijo><n>» libre desde el recuento;
 * - repetido en el mismo lote: «<id>-2», «<id>-3»…;
 * - el de uno de esta habilidad y de su tipo: lo sustituye («upsert by id»);
 * - el de OTRA habilidad del curso: «<habilidad>-<id>»;
 * - el de otro tipo de esta habilidad (un ejercicio con el id de una plantilla): «<id>-2».
 */
export class IDAssigner {
  private readonly own: Set<string>
  private readonly elsewhere: Set<string>
  private readonly blocked: Set<string>
  private readonly used = new Set<string>()
  private next: number

  constructor(private readonly sid: string, private readonly prefix: string, own: readonly string[], otherKinds: readonly string[], elsewhere: Set<string>) {
    this.own = new Set(own)
    this.elsewhere = elsewhere
    this.blocked = new Set([...elsewhere, ...otherKinds])
    this.next = own.length + 1
  }

  private taken(): Set<string> {
    return new Set([...this.own, ...this.blocked, ...this.used])
  }

  /** El id con que se guarda; si no es el pedido, el pedido; y si cambió porque lo usa otra habilidad. */
  assign(requested: string): { id: string; renamedFrom?: string; otherSkill: boolean } {
    let id = requested
    let from: string | undefined
    let otherSkill = false
    const taken = this.taken()
    if (requested === '') {
      let n = Math.max(1, this.next)
      while (taken.has(`${this.prefix}${n}`)) n += 1
      id = `${this.prefix}${n}`
      this.next = n + 1
    } else if (this.used.has(requested)) {
      id = IDs.unique(requested, taken)
      from = requested
    } else if (this.own.has(requested)) {
      id = requested
    } else if (this.elsewhere.has(requested)) {
      const spaced = `${this.sid}-${requested}`
      id = taken.has(spaced) ? IDs.unique(spaced, taken) : spaced
      from = requested
      otherSkill = true
    } else if (this.blocked.has(requested)) {
      id = IDs.unique(requested, taken)
      from = requested
    }
    this.used.add(id)
    return { id, renamedFrom: from, otherSkill }
  }
}

/** Resultado de un elemento del lote para la IA (con el id con que quedó guardado). */
function itemReport(index: number, o: { id: string; saved: boolean; replaced?: boolean; renamedFrom?: string; issues: readonly ContentIssue[]; limit: number; samples?: unknown[] }): Record<string, unknown> {
  const out: Record<string, unknown> = { index, saved: o.saved, issues: ToolOut.issues(o.issues, o.limit) }
  if (o.id) out.id = o.id
  if (o.replaced) out.replaced = true
  if (o.renamedFrom) {
    out.renamed_from = o.renamedFrom
    out.note = `The id '${o.renamedFrom}' was already used (by another skill, another item of this call or another kind of item), so it was saved as '${o.id}'. Use '${o.id}' from now on.`
  }
  if (o.samples) out.samples = o.samples
  return out
}

// MARK: Comprobaciones comunes

function guardSkill(ctx: ToolContext, id: string): ToolOutput | undefined {
  if (ctx.assignedSkill && ctx.assignedSkill !== id) return ToolOut.error(`You are only allowed to modify skill '${ctx.assignedSkill}' in this task (you tried '${id}').`)
  let pack: Pack | undefined
  try { pack = ctx.store.loadPack() } catch { pack = undefined }
  if (!pack?.skills.some((s) => s.id === id)) {
    return ToolOut.error(`Unknown skill '${id}'. Create it first with set_course_plan.`, `Existing skill ids: ${(pack?.skills.map((s) => s.id) ?? []).join(', ')}`)
  }
  return undefined
}

function skillIDOf(a: ToolArgs, ctx: ToolContext): string | undefined {
  return a.string('skill_id', ['skill', 'skillId']) ?? ctx.assignedSkill
}

function loadSkillOrUndefined(store: PackStore, id: string): Skill | undefined {
  if (!store.hasSkill(id)) return undefined
  try { return store.loadSkill(id) } catch { return undefined }
}

/** ¿Trae el objeto un id propio? (si no, el que pone la herramienta: «b3», «<habilidad>-d2»…) */
const rawHasID = (v: JSONValue): boolean => isJSONObject(v) && typeof v.id === 'string' && v.id.trim() !== ''

// MARK: Estado del curso

export function getCourse(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'get_course', 'Overview of the course as it is now: metadata, exam info, units, skills (with status, content counts and open issues), materials, glossary/formula/blueprint presence. Call this first and whenever you need to re-orient.',
    Schema.object([]), () => {
      let p: Pack
      try { p = ctx.store.loadPack() } catch { return ToolOut.error('Could not read the course.') }
      const skills = p.skills.map((s) => {
        const issues = loadSkillOrUndefined(ctx.store, s.id)?.issues ?? []
        return {
          id: s.id, title: s.title, summary: s.summary ?? null, unit: s.unit ?? null, objectives: s.objectives, prerequisites: s.prerequisites, weight: s.weight, minutes: s.minutes,
          status: s.status, counts: { lesson_blocks: s.counts.lessonBlocks, exercises: s.counts.exercises, templates: s.counts.templates, cards: s.counts.cards, decks: s.counts.decks },
          open_errors: issues.filter((i) => i.severity === 'error').length
        }
      })
      const o: Record<string, unknown> = {
        ok: true, id: p.id, title: p.title, subject: p.subject, course_code: p.courseCode ?? null, language: p.language, exam_language: p.examLanguage ?? null, guidance: p.guidance ?? null,
        units: p.units.map((u) => ({ id: u.id, title: u.title, summary: u.summary ?? null, skills: u.skillIDs })), skills,
        sources: p.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, pages: s.pages, trust: s.trust })),
        glossary_entries: p.glossary.length, formula_groups: p.formulaSheet.length, has_blueprint: p.blueprint !== undefined
      }
      if (p.exam) o.exam = { title: p.exam.title, date: p.exam.date ?? null, duration_minutes: p.exam.durationMinutes ?? null, total_points: p.exam.totalPoints ?? null, aids: p.exam.aids ?? null, notes: p.exam.notes ?? null }
      return ToolOut.json(o)
    })
}

const ID_RE = /^(?=.{1,48}$)[a-z0-9]+(-[a-z0-9]+)*$/

export function setCoursePlan(ctx: ToolContext): AgentTool {
  const skillSchema = Schema.object([['id', Schema.string('short-slug id, lowercase letters/digits/hyphens, unique')], ['title', Schema.string()], ['summary', Schema.string('one sentence')],
    ['objectives', Schema.array(Schema.string(), '3–5 measurable objectives starting with an action verb')], ['prerequisites', Schema.array(Schema.string(), 'ids of skills that should come first')],
    ['weight', Schema.number('relative importance / exam points')], ['minutes', Schema.integer('estimated study minutes')]], { required: ['id', 'title'] })
  const unitSchema = Schema.object([['id', Schema.string()], ['title', Schema.string()], ['summary', Schema.string()], ['skills', Schema.array(skillSchema)]], { required: ['id', 'title', 'skills'] })
  return defineTool(ctx, 'set_course_plan', 'Create or update the course structure: units → skills (a skill = one coherent exam-sized topic the student must be able to do). Merges by id with what exists (use replace=true only to rebuild from scratch). Also sets course metadata, exam info and the instructor\'s conventions.',
    Schema.object([['title', Schema.string()], ['subject', Schema.string()], ['course_code', Schema.string()], ['language', Schema.string('language of the explanations: es, en…')],
      ['exam_language', Schema.string('language of the real exam\'s wording if different')],
      ['icon', Schema.string('pixel-art course icon: the one that best matches the subject or the kind of test (e.g. chemistry, english, driving, civil-service, language-exam); study = general', [...CourseIconCatalog.ids])],
      ['hue', Schema.number('0–1 colour hue')], ['guidance', Schema.string('standing instructions for all content (style, conventions, what the instructor said)')],
      ['exam', Schema.any('{title, date (ISO-8601 or YYYY-MM-DD), duration_minutes, total_points, aids, notes, location}')], ['units', Schema.array(unitSchema)],
      ['replace', Schema.boolean('drop skills/units not mentioned (default false)')]]),
    (a) => {
      const problems: ContentIssue[] = []
      const unitsIn = (a.array('units') ?? []).filter(isJSONObject) as JSONObject[]
      const seenSkills = new Set<string>()
      const seenUnits = new Set<string>()
      unitsIn.forEach((u, ui) => {
        const uid = typeof u.id === 'string' ? u.id : ''
        if (!ID_RE.test(uid)) problems.push(issue('error', `units[${ui}].id`, `Unit id '${uid}' must be a lowercase slug (a-z, 0-9, hyphens).`))
        if (seenUnits.has(uid)) problems.push(issue('error', `units[${ui}].id`, `Duplicate unit id '${uid}'.`))
        seenUnits.add(uid)
        if (typeof u.title !== 'string' || !u.title) problems.push(issue('error', `units[${ui}].title`, 'Missing title.'))
        const skills = Array.isArray(u.skills) ? u.skills : []
        skills.forEach((s, si) => {
          const so = isJSONObject(s) ? s : {}
          const sid = typeof so.id === 'string' ? so.id : ''
          if (!ID_RE.test(sid)) problems.push(issue('error', `units[${ui}].skills[${si}].id`, `Skill id '${sid}' must be a lowercase slug (a-z, 0-9, hyphens).`))
          if (seenSkills.has(sid)) problems.push(issue('error', `units[${ui}].skills[${si}].id`, `Duplicate skill id '${sid}'.`))
          seenSkills.add(sid)
          if (typeof so.title !== 'string' || !so.title) problems.push(issue('error', `units[${ui}].skills[${si}].title`, 'Missing title.'))
        })
      })
      if (problems.some((p) => p.severity === 'error')) return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(problems), hint: 'Fix the errors and send the whole plan again.' })
      const replace = a.bool('replace') ?? false
      let counts: [number, number]
      try {
        counts = ctx.store.updatePack((p) => {
          const t = a.string('title'); if (t !== undefined) p.title = t
          const sub = a.string('subject'); if (sub !== undefined) p.subject = sub
          const code = a.string('course_code', ['courseCode']); if (code !== undefined) p.courseCode = code
          const lang = a.string('language'); if (lang !== undefined) p.language = lang
          const el = a.string('exam_language', ['examLanguage']); if (el !== undefined) p.examLanguage = el
          const icon = a.string('icon'); if (icon !== undefined) p.icon = CourseIconCatalog.resolve(icon, p.subject, p.title)
          const hue = a.number('hue'); if (hue !== undefined && hue >= 0 && hue <= 1) p.hue = canonicalCourseHue(hue)
          const g = a.string('guidance'); if (g !== undefined) p.guidance = g
          const exam = a.value('exam')
          if (isJSONObject(exam)) {
            p.exam = parseExam(exam, p.exam, p.language)
            // una fecha que no se entiende no se guarda en silencio: se avisa para que la IA la mande bien
            if (typeof exam.date === 'string' && exam.date && !parseExamDate(exam.date)) {
              problems.push(issue('warning', 'exam.date', `Could not understand the exam date '${exam.date}': it was NOT saved. Send it as 2026-12-15 or 2026-12-15T09:00 (local time) or with a time zone.`))
            }
          }
          if (replace) {
            p.units = []
            const keep = new Set(unitsIn.flatMap((u) => (Array.isArray(u.skills) ? u.skills : []).map((s) => (isJSONObject(s) && typeof s.id === 'string' ? s.id : ''))))
            p.skills = p.skills.filter((s) => keep.has(s.id))
          }
          for (const u of unitsIn) {
            const uid = u.id as string
            const skillIDs: string[] = []
            for (const raw of Array.isArray(u.skills) ? u.skills : []) {
              const s = raw as JSONObject
              const sid = s.id as string
              skillIDs.push(sid)
              const weight = typeof s.weight === 'number' ? s.weight : 1
              const minutes = typeof s.minutes === 'number' ? Math.round(s.minutes) : 20
              const objectives = Array.isArray(s.objectives) ? s.objectives.filter((x): x is string => typeof x === 'string') : []
              const prereq = Array.isArray(s.prerequisites) ? s.prerequisites.filter((x): x is string => typeof x === 'string') : []
              const existing = p.skills.find((x) => x.id === sid)
              if (existing) {
                existing.title = s.title as string
                existing.unit = uid
                if (typeof s.summary === 'string') existing.summary = s.summary
                if (objectives.length) existing.objectives = objectives
                if (s.prerequisites !== undefined) existing.prerequisites = prereq
                if (s.weight !== undefined) existing.weight = weight
                if (s.minutes !== undefined) existing.minutes = minutes
              } else {
                const ref = { id: sid, unit: uid, title: s.title as string, objectives, prerequisites: prereq, weight, minutes, order: p.skills.length, status: 'empty' as const, counts: { lessonBlocks: 0, exercises: 0, templates: 0, cards: 0, decks: 0 } }
                p.skills.push(typeof s.summary === 'string' ? { ...ref, summary: s.summary } : ref)
              }
            }
            const unit = p.units.find((x) => x.id === uid)
            if (unit) {
              unit.title = u.title as string
              if (typeof u.summary === 'string') unit.summary = u.summary
              unit.skillIDs = skillIDs
            } else {
              p.units.push(typeof u.summary === 'string' ? { id: uid, title: u.title as string, summary: u.summary, skillIDs } : { id: uid, title: u.title as string, skillIDs })
            }
          }
          p.skills.forEach((s, i) => { s.order = i })
          return [p.units.length, p.skills.length] as [number, number]
        })
      } catch (err) {
        return ToolOut.error(`Could not save the plan: ${err instanceof Error ? err.message : String(err)}`)
      }
      // prerrequisitos inexistentes → aviso
      try {
        const p = ctx.store.loadPack()
        const ids = new Set(p.skills.map((s) => s.id))
        for (const s of p.skills) for (const q of s.prerequisites) if (!ids.has(q)) problems.push(issue('warning', `skills.${s.id}.prerequisites`, `Prerequisite '${q}' does not exist.`))
      } catch { /* curso ilegible */ }
      ctx.notify({ kind: 'planSet', units: counts[0], skills: counts[1] })
      return ToolOut.json({ ok: true, saved: true, units: counts[0], skills: counts[1], issues: ToolOut.issues(problems) })
    })
}

// MARK: Contenido de una habilidad

const plainTextOf = (blocks: readonly Block[]): string =>
  ToolOut.clip(blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.md).join(' ').replace(/\n/g, ' '), 90)

function blockPreview(b: Block): string {
  const t = b.type === 'text' ? b.md : b.type === 'callout' ? b.md : b.type === 'example' ? b.problem : ''
  return ToolOut.clip(t.replace(/\n/g, ' '), 70)
}

export function getSkill(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'get_skill', 'Read what a skill currently contains. By default returns a compact outline (block types and first words, exercise ids/levels/kinds/prompts). Use full=true for the complete JSON of the lesson or of specific items.',
    Schema.object([['skill_id', Schema.string()], ['part', Schema.string('outline (default) | lesson | exercises | templates | cards | decks | mistakes | issues', ['outline', 'lesson', 'exercises', 'templates', 'cards', 'decks', 'mistakes', 'issues'])],
      ['ids', Schema.array(Schema.string(), 'with part=exercises/templates/cards: only these ids')]]),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const s = loadSkillOrUndefined(ctx.store, sid)
      if (!s) return ToolOut.json({ ok: true, skill_id: sid, empty: true, note: 'No content yet.' })
      const ids = a.strings('ids')
      const only = <T extends { id: string }>(xs: T[]): T[] => (ids ? xs.filter((x) => ids.includes(x.id)) : xs)
      switch (a.string('part') ?? 'outline') {
        case 'lesson': return ToolOut.json({ ok: true, lesson: s.lesson.map(encodeBlock) })
        case 'exercises': return ToolOut.json({ ok: true, exercises: only(s.exercises).map(encodeExercise) })
        case 'templates': return ToolOut.json({ ok: true, templates: only(s.templates).map(encodeTemplate) })
        case 'cards': return ToolOut.json({ ok: true, cards: only(s.cards).map(encodeFlashcard) })
        case 'decks': return ToolOut.json({ ok: true, decks: s.decks.map(encodeDeck) })
        case 'mistakes': return ToolOut.json({ ok: true, mistakes: s.mistakes })
        case 'issues': return ToolOut.json({ ok: true, issues: ToolOut.issues(s.issues, 60) })
        default:
          return ToolOut.json({
            ok: true, skill_id: s.id, title: s.title, status: s.status, revision: s.revision,
            lesson: s.lesson.map((b, i) => ({ i, type: blockTypeName(b), preview: blockPreview(b) })),
            exercises: s.exercises.map((e) => ({ id: e.id, level: e.level, kind: e.answer.kind === 'unknown' ? e.answer.rawKind : e.answer.kind, prompt: plainTextOf(e.prompt) })),
            templates: s.templates.map((t) => ({ id: t.id, level: t.level, kind: t.answer.kind === 'unknown' ? t.answer.rawKind : t.answer.kind, prompt: plainTextOf(t.prompt) })),
            cards: s.cards.length, decks: s.decks.map((d) => ({ id: d.id, title: d.title, slides: d.slides.length })), mistakes: s.mistakes.length, open_issues: s.issues.length
          })
      }
    })
}

export function writeLesson(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'write_lesson', 'Write the lesson of a skill as an ordered list of blocks (the student reads it step by step). All blocks are validated first: if any block has an ERROR nothing is saved and you get every issue so you can resend the corrected lesson. Warnings are saved. mode=replace (default) overwrites the lesson; mode=append adds blocks at the end (use it to send long lessons in parts).',
    Schema.object([['skill_id', Schema.string()], ['blocks', Schema.array(BLOCK_SCHEMA, 'Ordered blocks. 12–20 for a full lesson.')], ['mode', Schema.string('replace | append', ['replace', 'append'])]], { required: ['blocks'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const raw = a.array('blocks')
      if (!raw) return badArray(ctx, 'write_lesson', 'blocks', a, 'an array of block objects')
      const normalized = ContentNormalizer.blocks(raw)
      const lookup = assetLookup(ctx.store)
      const seen = new Set<string>()
      const fixed: Block[] = normalized.map((v, i) => {
        let b: Block = decodeBlock(v) ?? { id: '', type: 'unknown', rawType: isJSONObject(v) && typeof v.type === 'string' ? v.type : '?', raw: isJSONObject(v) ? v : {} }
        if (!rawHasID(v)) b = { ...b, id: `b${i + 1}` }
        // ids únicos y legibles
        if (Array.from(b.id).length < 2 || seen.has(b.id)) b = { ...b, id: `${sid}-b${i + 1}-${IDs.short(3)}` }
        seen.add(b.id)
        // los ejercicios incrustados de un «Pruébalo» son de esta habilidad (sin ella, su progreso y sus errores se perdían)
        if (b.type === 'tryit') b = { ...b, inline: b.inline.map((e) => ({ ...e, skill: sid })) }
        return enrichBlock(b, lookup)
      })
      const validator = ctx.validator()
      const append = a.string('mode') === 'append'
      const existing = loadSkillOrUndefined(ctx.store, sid) ?? makeSkill({ id: sid, title: sid })
      const probe: Skill = { ...existing, lesson: append ? [...existing.lesson, ...fixed] : fixed }
      let issues: ContentIssue[] = []
      fixed.forEach((b, i) => { issues.push(...validator.checkBlock(b, `blocks[${append ? existing.lesson.length + i : i}]`, probe)) })
      // los ejercicios referenciados por tryit pueden agregarse después: se avisa pero no se rechaza
      issues = issues.map((x) => (x.message.includes('no existe en esta habilidad') ? { ...x, severity: 'warning' as const } : x))
      if (issues.some((x) => x.severity === 'error')) {
        return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(issues, 40), hint: 'Nothing was saved. Fix the errors and resend the lesson (blocks may be sent in several calls with mode=append).' })
      }
      try {
        // leer, unir y guardar dentro del cerrojo: dos partes en paralelo («append») no se pisan ni vuelve la lección vieja
        const r = ctx.store.updateSkill(sid, (s) => {
          let add = fixed.map((b) => ({ ...b })) as Block[]
          if (append) {
            const used = new Set(s.lesson.map((b) => b.id))
            add = add.map((b, k) => {
              if (!used.has(b.id)) { used.add(b.id); return b }
              const id = `${sid}-b${s.lesson.length + k + 1}-${IDs.short(3)}`
              used.add(id)
              return { ...b, id }
            })
          }
          // un «Pruébalo» que nombra un ejercicio por el id que pidió la IA y que se guardó con el de la habilidad delante
          const known = new Set(s.exercises.map((e) => e.id))
          add = add.map((b) => (b.type === 'tryit' && b.exerciseIDs.some((id) => !known.has(id) && known.has(`${sid}-${id}`))
            ? { ...b, exerciseIDs: b.exerciseIDs.map((id) => (!known.has(id) && known.has(`${sid}-${id}`) ? `${sid}-${id}` : id)) } : b))
          s.lesson = append ? [...s.lesson, ...add] : add
          if (s.status === 'empty') s.status = 'draft'
          return { total: s.lesson.length, types: s.lesson.map(blockTypeName) }
        })
        ctx.notify({ kind: 'skillWritten', skill: sid, what: 'lesson', count: r.total })
        return ToolOut.json({ ok: true, saved: true, blocks_saved: fixed.length, lesson_blocks_total: r.total, types: r.types, issues: ToolOut.issues(issues) })
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function addExercises(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'add_exercises', 'Add or replace exercises of a skill (upsert by id). Each exercise is validated independently: valid ones are saved, invalid ones are returned with their errors so you can fix and resend only those. Every exercise needs: prompt, answer {kind,…}, level 1–3, hints, solution (worked steps) and 1–3 `wrongs` (typical wrong inputs with the reason). An answer key you are unsure about must be checked with `calculate` first. Exercises without id get a new one; ids must be unique in the whole course (the result tells you the final id of each).',
    Schema.object([['skill_id', Schema.string()], ['exercises', Schema.array(Schema.freeObject("Exercise object: {id?, level, prompt, answer:{kind:'choice|numeric|expression|equation|set|interval|point|short|cloze|ordering|matching|truefalse|label|locate|draglabel|open|multi|chem', …}, hints:[…], solution, wrongs:[{input,why}], points?, tags?}"))]], { required: ['exercises'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const raw = a.array('exercises', ['items', 'exercise', 'questions', 'problems'])
      if (!raw) return badArray(ctx, 'add_exercises', 'exercises', a, 'an array')
      // 1) normalizar y validar (no depende de lo guardado). Sin id, el id se da después, dentro del cerrojo
      const good: Array<{ index: number; ex: Exercise; issues: ContentIssue[] }> = []
      const report = new Map<number, Record<string, unknown>>()
      const validator = ctx.validator()
      const lookup = assetLookup(ctx.store)
      raw.forEach((r, i) => {
        const norm = ContentNormalizer.exercise(r, sid, '')
        const decoded = isJSONObject(norm) ? decodeExercise(norm) : undefined
        if (!decoded) { report.set(i, { index: i, saved: false, issues: [{ severity: 'error', path: '', message: 'Not a valid exercise object.' }] }); return }
        let ex: Exercise = { ...decoded, skill: sid, id: isJSONObject(norm) && typeof norm.id === 'string' ? norm.id : '' }
        delete ex.review
        ex = enrichExercise(ex, lookup)
        const issues = validator.checkExercise(ex, `exercises[${ex.id ? ex.id : `#${i}`}]`)
        if (issues.some((x) => x.severity === 'error')) report.set(i, itemReport(i, { id: ex.id, saved: false, issues, limit: 12 }))
        else good.push({ index: i, ex, issues })
      })
      try {
        let total = 0, added = 0, replaced = 0, renamed = false
        let byLevel: Record<number, number> = {}
        if (good.length) {
          ctx.store.updateSkill(sid, (s) => {
            const ids = new IDAssigner(sid, `${sid}-e`, s.exercises.map((e) => e.id), s.templates.map((t) => t.id), idsElsewhere(ctx.store, sid).exercises)
            const moved = new Map<string, string>()
            for (const g of good) {
              const { id, renamedFrom, otherSkill } = ids.assign(g.ex.id)
              // otra habilidad tenía ese id: los «Pruébalo» de esta que lo nombraban (no era suyo) apuntan al nuevo
              if (otherSkill && renamedFrom) moved.set(renamedFrom, id)
              const ex = { ...g.ex, id }
              const k = s.exercises.findIndex((e) => e.id === id)
              if (k >= 0) { s.exercises[k] = ex; replaced++ } else { s.exercises.push(ex); added++ }
              renamed = renamed || renamedFrom !== undefined
              report.set(g.index, itemReport(g.index, { id, saved: true, replaced: k >= 0, renamedFrom, issues: g.issues, limit: 12 }))
            }
            if (moved.size) updateSkillTryIts(s, (t) => { t.exerciseIDs = t.exerciseIDs.map((x) => moved.get(x) ?? x) })
            if (s.status === 'empty') s.status = 'draft'
            total = s.exercises.length
            byLevel = countLevels(s.exercises)
          })
          ctx.notify({ kind: 'skillWritten', skill: sid, what: 'exercises', count: good.length })
        } else {
          const s = loadSkillOrUndefined(ctx.store, sid)
          total = s?.exercises.length ?? 0
          byLevel = countLevels(s?.exercises ?? [])
        }
        const out: Record<string, unknown> = {
          ok: good.length > 0 || raw.length === 0, saved: added + replaced, added, replaced, rejected: raw.length - good.length, exercises_total: total,
          by_level: { 1: byLevel[1] ?? 0, 2: byLevel[2] ?? 0, 3: byLevel[3] ?? 0 }, results: raw.map((_, i) => report.get(i)).filter((x) => x !== undefined)
        }
        if (renamed) out.hint = RENAMED_HINT
        return ToolOut.json(out)
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

function countLevels(xs: readonly { level: number }[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const x of xs) out[x.level] = (out[x.level] ?? 0) + 1
  return out
}

/** Tres muestras de una plantilla (enunciado y respuesta esperada), o el error con esa semilla. */
export function templatePreviews(t: ExerciseTemplate, seeds: readonly number[] = [1, 2, 3]): Array<{ seed: number; prompt: string; answer: string; error?: string }> {
  return seeds.map((seed) => {
    try {
      const ex = instantiateTemplateOrThrow(t, seed)
      const prompt = ex.prompt.map((b) => (b.type === 'text' ? b.md : b.type === 'math' ? `$$${b.tex}$$` : undefined)).filter((x): x is string => !!x).join(' ')
      const problems = MathKitChecker.selfCheck(ex).filter((p) => p.severity === 'error')
      const answer = describeAnswer(ex.answer)
      if (problems.length) return { seed, prompt, answer, error: `Con la semilla ${seed}: ${problems[0].message}` }
      return { seed, prompt, answer }
    } catch (err) {
      return { seed, prompt: '', answer: '', error: err instanceof Error ? err.message : String(err) }
    }
  })
}

export function addTemplates(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'add_templates', 'Add parametric exercise templates (infinite variations with exact answers) for computational skills. `vars` define random values (int/real/pick/fraction/expr), `constraints` filter them, and texts use {{expr}}, {{tex:expr}}, {{frac:expr}}, {{signed:expr}}, {{dec(2):expr}} placeholders. Answer fields may use placeholders too (e.g. value: "-b/a"). The tool instantiates 3 samples and returns them so you can check that problems read well and answers are right; templates that fail to instantiate are rejected.',
    Schema.object([['skill_id', Schema.string()], ['templates', Schema.array(Schema.freeObject("Template: {id?, level, vars:[{name, kind:'int'|'real'|'pick'|'fraction'|'expr', min,max,exclude,decimals,values,expr…}], constraints:['a != b'], prompt, answer, hints, solution, wrongs}"))]], { required: ['templates'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const raw = a.array('templates')
      if (!raw) return ToolOut.error("Missing required argument 'templates' (an array).", SPLIT_HINT)
      const good: Array<{ index: number; t: ExerciseTemplate; issues: ContentIssue[]; samples: unknown[] }> = []
      const report = new Map<number, Record<string, unknown>>()
      const validator = ctx.validator()
      raw.forEach((r, i) => {
        const norm = ContentNormalizer.template(r, sid, '')
        const decoded = isJSONObject(norm) ? decodeTemplate(norm) : undefined
        if (!decoded) { report.set(i, { index: i, saved: false, issues: [{ severity: 'error', path: '', message: 'Not a valid template object.' }] }); return }
        const t: ExerciseTemplate = { ...decoded, skill: sid, id: isJSONObject(norm) && typeof norm.id === 'string' ? norm.id : '' }
        const path = `templates[${t.id ? t.id : `#${i}`}]`
        const issues = validator.checkTemplate(t, path)
        const samples: unknown[] = []
        if (!issues.some((x) => x.severity === 'error')) {
          for (const p of templatePreviews({ ...t, id: t.id || `${sid}-preview` })) {
            if (p.error) issues.push(issue('error', path, `Seed ${p.seed}: ${p.error}`))
            else samples.push({ seed: p.seed, problem: p.prompt, expected_answer: p.answer })
          }
        }
        if (issues.some((x) => x.severity === 'error')) report.set(i, itemReport(i, { id: t.id, saved: false, issues, limit: 10, samples }))
        else good.push({ index: i, t, issues, samples })
      })
      try {
        let added = 0, replaced = 0, renamed = false
        if (good.length) {
          ctx.store.updateSkill(sid, (s) => {
            const ids = new IDAssigner(sid, `${sid}-t`, s.templates.map((t) => t.id), s.exercises.map((e) => e.id), idsElsewhere(ctx.store, sid).exercises)
            for (const g of good) {
              const { id, renamedFrom } = ids.assign(g.t.id)
              const t = { ...g.t, id }
              const k = s.templates.findIndex((x) => x.id === id)
              if (k >= 0) { s.templates[k] = t; replaced++ } else { s.templates.push(t); added++ }
              renamed = renamed || renamedFrom !== undefined
              report.set(g.index, itemReport(g.index, { id, saved: true, replaced: k >= 0, renamedFrom, issues: g.issues, limit: 10, samples: g.samples }))
            }
            if (s.status === 'empty') s.status = 'draft'
          })
          ctx.notify({ kind: 'skillWritten', skill: sid, what: 'templates', count: good.length })
        }
        const out: Record<string, unknown> = { ok: good.length > 0, saved: added + replaced, added, replaced, rejected: raw.length - good.length, results: raw.map((_, i) => report.get(i)).filter((x) => x !== undefined) }
        if (renamed) out.hint = RENAMED_HINT
        return ToolOut.json(out)
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function addCards(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'add_cards', 'Add flashcards for spaced repetition (upsert by id). One idea per card. kind=basic (front/back), cloze (front contains {{c1::answer}}), reversible. Good cards test recall of definitions, formulas with WHEN to use them, distinctions, and typical mistakes — not trivia. Markdown + $LaTeX$ allowed.',
    Schema.object([['skill_id', Schema.string()], ['cards', Schema.array(Schema.freeObject("{id?, kind:'basic'|'cloze'|'reversible', front, back, hint?, tags?, figure?:{asset|drawing, parts:[{id,name,x,y,r?}], target:'part id'} (image-occlusion card: the front shows the figure with the target part highlighted)}"))]], { required: ['cards'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const raw = a.array('cards')
      if (!raw) return ToolOut.error("Missing required argument 'cards' (an array).", SPLIT_HINT)
      const good: Array<{ index: number; card: Flashcard; issues: ContentIssue[] }> = []
      const report = new Map<number, Record<string, unknown>>()
      const validator = ctx.validator()
      const lookup = assetLookup(ctx.store)
      raw.forEach((r, i) => {
        const norm = ContentNormalizer.card(r, sid, '')
        const decoded = isJSONObject(norm) ? decodeFlashcard(norm) : undefined
        if (!decoded) { report.set(i, { index: i, saved: false }); return }
        const c = enrichCard({ ...decoded, id: isJSONObject(norm) && typeof norm.id === 'string' ? norm.id : '' }, lookup)
        const issues = validator.checkCard(c, `cards[${c.id ? c.id : `#${i}`}]`)
        if (issues.some((x) => x.severity === 'error')) report.set(i, itemReport(i, { id: c.id, saved: false, issues, limit: 6 }))
        else good.push({ index: i, card: c, issues })
      })
      try {
        let total = 0, added = 0, replaced = 0, renamed = false
        if (good.length) {
          ctx.store.updateSkill(sid, (s) => {
            const ids = new IDAssigner(sid, `${sid}-c`, s.cards.map((c) => c.id), [], idsElsewhere(ctx.store, sid).cards)
            for (const g of good) {
              const { id, renamedFrom } = ids.assign(g.card.id)
              const c = { ...g.card, id }
              const k = s.cards.findIndex((x) => x.id === id)
              if (k >= 0) { s.cards[k] = c; replaced++ } else { s.cards.push(c); added++ }
              renamed = renamed || renamedFrom !== undefined
              // solo se informa de las tarjetas con algo que contar
              if (g.issues.length || renamedFrom) report.set(g.index, itemReport(g.index, { id, saved: true, replaced: k >= 0, renamedFrom, issues: g.issues, limit: 6 }))
            }
            total = s.cards.length
            if (s.status === 'empty') s.status = 'draft'
          })
          ctx.notify({ kind: 'skillWritten', skill: sid, what: 'cards', count: good.length })
        } else total = loadSkillOrUndefined(ctx.store, sid)?.cards.length ?? 0
        const out: Record<string, unknown> = {
          ok: good.length > 0 || raw.length === 0, saved: added + replaced, added, replaced, rejected: raw.length - good.length, cards_total: total,
          problems: raw.map((_, i) => report.get(i)).filter((x) => x !== undefined)
        }
        if (renamed) out.hint = RENAMED_HINT
        return ToolOut.json(out)
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function addDeck(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'add_deck', 'Add a slide deck (presentation) for a skill: a visual summary the student can page through or present full screen. Slide layouts: title, section, content (blocks; optional `image` asset on the right), twoColumn (blocks | right), comparison (leftTitle/rightTitle + blocks | right), image (a big `image` asset with title and short caption), focus (one big block: formula, plot, 3D model…), quote (title = the quote, subtitle = author). Deck `theme`: aula | minimal | academic | midnight | chalk; `transition`: fade | slide | none. Put what you would say in `notes`. Keep slides sparse: one idea each, ≤ 40 words.',
    Schema.object([['skill_id', Schema.string()], ['deck', Schema.any('{id?, title, summary?, theme?, transition?, slides:[{layout, title?, subtitle?, blocks:[…], right?:[…], image?, credit?, leftTitle?, rightTitle?, notes?}]}')]], { required: ['deck'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const raw = a.value('deck')
      if (raw === undefined) return ToolOut.error("Missing required argument 'deck'.")
      const norm = ContentNormalizer.deck(raw)
      const decoded = isJSONObject(norm) ? decodeDeck(norm) : undefined
      if (!decoded) return ToolOut.error('Not a valid deck object.')
      const deck = enrichDeck({ ...decoded, id: rawHasID(norm) ? decoded.id : '' }, assetLookup(ctx.store))
      const skill = loadSkillOrUndefined(ctx.store, sid)
      const issues = ctx.validator().checkDeck(deck, `decks[${deck.id || 'new'}]`, skill)
      if (issues.some((x) => x.severity === 'error')) return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(issues, 30) })
      try {
        const id = ctx.store.updateSkill(sid, (s) => {
          // sin id, el primero libre (una segunda presentación no sustituye a la primera)
          let did = deck.id
          if (!did) { let n = s.decks.length + 1; while (s.decks.some((d) => d.id === `${sid}-d${n}`)) n += 1; did = `${sid}-d${n}` }
          const d = { ...deck, id: did }
          const k = s.decks.findIndex((x) => x.id === did)
          if (k >= 0) s.decks[k] = d; else s.decks.push(d)
          return did
        })
        ctx.notify({ kind: 'skillWritten', skill: sid, what: 'deck', count: deck.slides.length })
        return ToolOut.json({ ok: true, saved: true, deck_id: id, slides: deck.slides.length, issues: ToolOut.issues(issues) })
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function setCommonMistakes(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'set_common_mistakes', 'Set the list of typical mistakes for a skill (replaces the previous list). Each: title, wrong (how it is usually done wrong), right (the correct way), why (why students make it). These feed the \'common mistakes\' reference and explanations.',
    Schema.object([['skill_id', Schema.string()], ['mistakes', Schema.array(Schema.freeObject('{title, wrong, right, why}  (markdown + $LaTeX$)'))]], { required: ['mistakes'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const raw = a.array('mistakes')
      if (!raw) return ToolOut.error("Missing required argument 'mistakes'.")
      const list = raw.map((m) => decodeCommonMistake(m)).filter((m): m is CommonMistake => !!m && !!m.title && !!m.wrong && !!m.right)
      const validator = ctx.validator()
      const issues: ContentIssue[] = []
      list.forEach((m, i) => issues.push(...validator.latexIssues(`${m.wrong} ${m.right} ${m.why}`, `mistakes[${i}]`)))
      if (issues.some((x) => x.severity === 'error')) return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(issues) })
      try {
        ctx.store.updateSkill(sid, (s) => { s.mistakes = list })
        return ToolOut.json({ ok: true, saved: list.length, dropped: raw.length - list.length })
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function validateSkill(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'validate_skill', 'Run the full quality audit on a skill (structure, LaTeX, expressions, every exercise graded against its own answer key, duplicates, coverage). Returns errors/warnings and a checklist. Sets the skill status to ready (no errors) or needsReview. Call it before finish and fix every error. When you write only part of the skill (team mode), pass `scope` to see only your part.',
    Schema.object([['skill_id', Schema.string()], ['scope', Schema.string('all (default) | lesson (lesson, cards, mistakes, decks) | practice (exercises, templates)', ['all', 'lesson', 'practice'])]]),
    (a) => {
      const sid = skillIDOf(a, ctx)
      if (!sid) return ToolOut.error("Missing required argument 'skill_id'.")
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const s = loadSkillOrUndefined(ctx.store, sid)
      if (!s) return ToolOut.error('The skill has no content yet.')
      let pack: Pack | undefined
      try { pack = ctx.store.loadPack() } catch { pack = undefined }
      const all = ctx.validator().checkSkill(s, pack)
      // ids que también usa otra habilidad: el progreso, los errores y los simulacros los mezclarían
      const elsewhere = idsElsewhere(ctx.store, sid)
      all.push(...ContentValidator.crossSkillDuplicates(s, elsewhere.exercises, elsewhere.cards))
      const allErrors = all.filter((x) => x.severity === 'error')
      try {
        ctx.store.updateSkill(sid, (k) => { k.issues = all.filter((x) => x.severity !== 'info'); k.status = allErrors.length ? 'needsReview' : 'ready' })
      } catch (err) { log.warn('[tools] no se pudo guardar la auditoría', err) }
      const scope = a.string('scope') ?? 'all'
      const practicePath = (p: string): boolean => p.startsWith('exercises') || p.startsWith('templates')
      const issues = all.filter((x) => (scope === 'lesson' ? !practicePath(x.path) : scope === 'practice' ? practicePath(x.path) : true))
      const errors = issues.filter((x) => x.severity === 'error')
      const warns = issues.filter((x) => x.severity === 'warning')
      const kinds = new Set(s.lesson.map(blockTypeName))
      const levels = countLevels(s.exercises)
      const checklist: Array<{ item: string; pass: boolean }> = []
      const item = (text: string, pass: boolean): void => { checklist.push({ item: text, pass }) }
      if (scope !== 'practice') {
        item('Lesson has 10+ blocks', s.lesson.length >= 10)
        item('Has predict/spot (activates prior knowledge)', kinds.has('predict') || kinds.has('spot'))
        item('Has 2+ worked examples', s.lesson.filter((b) => b.type === 'example').length >= 2)
        if (scope === 'all') item('Has embedded tryit checkpoint', kinds.has('tryit'))
        item('Has a recap', kinds.has('recap'))
      }
      if (scope !== 'lesson') {
        item('10+ exercises/templates', s.exercises.length + s.templates.length >= 10)
        item('Exercises cover levels 1, 2 and 3', (levels[1] ?? 0) > 0 && (levels[2] ?? 0) > 0 && (levels[3] ?? 0) > 0)
      }
      if (scope !== 'practice') {
        item('8+ flashcards', s.cards.length >= 8)
        item('Common mistakes listed', s.mistakes.length > 0)
      }
      ctx.notify({ kind: 'skillWritten', skill: sid, what: 'validation', count: errors.length })
      return ToolOut.json({
        ok: errors.length === 0, errors: errors.length, warnings: warns.length, status: errors.length ? 'needsReview' : 'ready', issues: ToolOut.issues(issues, 40), checklist,
        counts: { lesson_blocks: s.lesson.length, exercises: s.exercises.length, templates: s.templates.length, cards: s.cards.length, decks: s.decks.length }
      })
    })
}

export function deleteItems(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'delete_items', 'Delete exercises, templates, cards, decks or lesson blocks from a skill by id (or by index for lesson blocks).',
    Schema.object([['skill_id', Schema.string()], ['kind', Schema.string('exercises | templates | cards | decks | lesson_blocks', ['exercises', 'templates', 'cards', 'decks', 'lesson_blocks'])],
      ['ids', Schema.array(Schema.string(), 'ids; for lesson_blocks use block ids or indices as strings')]], { required: ['kind', 'ids'] }),
    (a) => {
      const sid = skillIDOf(a, ctx)
      const kind = a.string('kind')
      const ids = (a.array('ids') ?? []).map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '')).filter(Boolean)
      if (!sid || !kind || !a.array('ids')) return ToolOut.error('Missing arguments (skill_id, kind, ids).')
      const denied = guardSkill(ctx, sid); if (denied) return denied
      const set = new Set(ids)
      try {
        const removed = ctx.store.updateSkill(sid, (s) => {
          const drop = <T extends { id: string }>(xs: T[]): [T[], number] => { const kept = xs.filter((x) => !set.has(x.id)); return [kept, xs.length - kept.length] }
          switch (kind) {
            case 'exercises': { const [k, n] = drop(s.exercises); s.exercises = k; return n }
            case 'templates': { const [k, n] = drop(s.templates); s.templates = k; return n }
            case 'cards': { const [k, n] = drop(s.cards); s.cards = k; return n }
            case 'decks': { const [k, n] = drop(s.decks); s.decks = k; return n }
            case 'lesson_blocks': {
              const idx = new Set(ids.map((x) => Number(x)).filter((n) => Number.isInteger(n)))
              const before = s.lesson.length
              s.lesson = s.lesson.filter((b, i) => !(set.has(b.id) || idx.has(i)))
              return before - s.lesson.length
            }
            default: return 0
          }
        })
        return ToolOut.json({ ok: true, removed })
      } catch (err) {
        return ToolOut.error(`Could not delete: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

// MARK: Contenido transversal

export function setGlossary(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'set_glossary', 'Add glossary entries for the whole course (merged by term; merge=false replaces the glossary). Short, precise definitions in the course language; add `aliases` for English/other names; `skill` links to a skill id.',
    Schema.object([['entries', Schema.array(Schema.freeObject('{term, definition, aliases?, skill?}'))], ['merge', Schema.boolean('default true')]], { required: ['entries'] }),
    (a) => {
      const raw = a.array('entries')
      if (!raw) return ToolOut.error("Missing required argument 'entries'.")
      const list = raw.map((e) => decodeGlossaryEntry(e)).filter((e): e is GlossaryEntry => !!e && !!e.term && !!e.definition)
      const validator = ctx.validator()
      const issues: ContentIssue[] = []
      for (const e of list) issues.push(...validator.latexIssues(e.definition, `glossary[${e.term}]`))
      if (issues.some((x) => x.severity === 'error')) return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(issues) })
      try {
        const total = ctx.store.updatePack((p) => {
          if (a.bool('merge') === false) p.glossary = []
          for (const e of list) {
            const i = p.glossary.findIndex((g) => g.term.toLowerCase() === e.term.toLowerCase())
            if (i >= 0) p.glossary[i] = e; else p.glossary.push(e)
          }
          p.glossary.sort((x, y) => x.term.localeCompare(y.term, undefined, { sensitivity: 'base' }))
          return p.glossary.length
        })
        ctx.notify({ kind: 'note', text: tr(`Glosario: ${list.length} términos`, `Glossary: ${list.length} terms`) })
        return ToolOut.json({ ok: true, saved: list.length, dropped: raw.length - list.length, glossary_total: total })
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function setFormulaSheet(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'set_formula_sheet', 'Set the course formula sheet / cheat sheet: groups of formulas with name, LaTeX, when to use it and a legend of variables. If the instructor provides an official formula sheet, mirror it exactly.',
    Schema.object([['groups', Schema.array(Schema.freeObject('{title, items:[{name, tex, when?, vars?:[{symbol, meaning, unit?}]}]}'))], ['merge', Schema.boolean('default false')]], { required: ['groups'] }),
    (a) => {
      const raw = a.array('groups')
      if (!raw) return ToolOut.error("Missing required argument 'groups'.")
      const groups = raw.map((g) => decodeFormulaGroup(g)).filter((g): g is FormulaGroup => !!g && g.items.length > 0)
      const validator = ctx.validator()
      const issues: ContentIssue[] = []
      for (const g of groups) g.items.forEach((it, i) => issues.push(...validator.checkBlock({ id: 'f', type: 'formulas', items: [it] }, `groups[${g.title}].items[${i}]`)))
      if (issues.some((x) => x.severity === 'error')) return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(issues) })
      try {
        ctx.store.updatePack((p) => {
          if (a.bool('merge') === true) {
            for (const g of groups) { const i = p.formulaSheet.findIndex((x) => x.title === g.title); if (i >= 0) p.formulaSheet[i] = g; else p.formulaSheet.push(g) }
          } else p.formulaSheet = groups
        })
        const n = groups.reduce((k, g) => k + g.items.length, 0)
        ctx.notify({ kind: 'note', text: tr(`Hoja de fórmulas: ${n} fórmulas`, `Formula sheet: ${n} formulas`) })
        return ToolOut.json({ ok: true, groups: groups.length, formulas: n })
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function setExamBlueprint(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'set_exam_blueprint', 'Define how a mock exam is built: duration, total points and sections. Each section draws `count` exercises from the listed skills within a difficulty range. Mirror the real exam\'s structure and point split when the materials say it (e.g. \'first problem: unit circle, 5 minutes\'). If the real exam has an official passing score, give it as `pass_percent` (e.g. 70 for 700/1000, 85 for 85 %).',
    Schema.object([['duration_minutes', Schema.integer()], ['total_points', Schema.number()], ['instructions', Schema.string()], ['pass_percent', Schema.number()],
      ['sections', Schema.array(Schema.freeObject('{title, skill_ids:[…], count, min_level?, max_level?, points_each, instructions?}'))]], { required: ['sections'] }),
    (a) => {
      const raw = (a.array('sections') ?? []).filter(isJSONObject) as JSONObject[]
      if (!raw.length) return ToolOut.error("Missing required argument 'sections'.")
      let pack: Pack
      try { pack = ctx.store.loadPack() } catch { return ToolOut.error('Could not read the course.') }
      const known = new Set(pack.skills.map((s) => s.id))
      const issues: ContentIssue[] = []
      const lang = CourseLanguages.of(pack.language)
      const numberOf = (v: JSONValue | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
      const sections: BlueprintSection[] = raw.map((r, i) => {
        const idsRaw = Array.isArray(r.skill_ids) ? r.skill_ids : Array.isArray(r.skills) ? r.skills : []
        const ids = idsRaw.filter((x): x is string => typeof x === 'string')
        for (const id of ids) if (!known.has(id)) issues.push(issue('error', `sections[${i}].skill_ids`, `Unknown skill '${id}'.`))
        const count = Math.round(numberOf(r.count) ?? 1)
        if (count < 1) issues.push(issue('error', `sections[${i}].count`, 'count must be ≥ 1.'))
        const sec: BlueprintSection = {
          title: typeof r.title === 'string' ? r.title : CourseLanguages.sectionTitle(lang, i + 1), skillIDs: ids, count: Math.max(1, count),
          minLevel: Math.round(numberOf(r.min_level) ?? 1), maxLevel: Math.round(numberOf(r.max_level) ?? 3), pointsEach: numberOf(r.points_each ?? r.pointsEach) ?? 1
        }
        if (typeof r.instructions === 'string') sec.instructions = r.instructions
        return sec
      })
      if (issues.some((x) => x.severity === 'error')) return ToolOut.json({ ok: false, saved: false, issues: ToolOut.issues(issues) })
      // ¿hay ejercicios para tanto? Un simulacro de 65 preguntas con un banco de 30 sale con 30 (y el tiempo entero)
      const bank = new Map<string, number>()
      for (const ref of pack.skills) {
        const s = loadSkillOrUndefined(ctx.store, ref.id)
        if (!s) continue
        bank.set(ref.id, s.exercises.filter((e) => !ExamBuilder.needsSeparateGrading(e.answer)).length + s.templates.filter((t) => !ExamBuilder.needsSeparateGrading(t.answer)).length * 4)
      }
      const available = [...bank.values()].reduce((n, x) => n + x, 0)
      const asked = sections.reduce((n, s) => n + s.count, 0)
      if (available > 0 && asked > available) {
        issues.push(issue('warning', 'sections', `The sections ask for ${asked} questions but the course has only about ${available} auto-gradable exercises: the mock exam will be shorter than planned. Scale the counts down (keep the real minutes-per-question ratio) or add exercises.`))
      }
      sections.forEach((sec, i) => {
        if (!sec.skillIDs.length) return
        const have = sec.skillIDs.reduce((n, id) => n + (bank.get(id) ?? 0), 0)
        if (have > 0 && sec.count > have) issues.push(issue('warning', `sections[${i}].count`, `'${sec.title}' asks for ${sec.count} questions but its skills have about ${have}.`))
      })
      const sum = sections.reduce((n, s) => n + s.count * s.pointsEach, 0)
      const total = a.number('total_points') ?? sum
      if (Math.abs(sum - total) > 0.01) issues.push(issue('warning', 'sections', `Sections add up to ${sum} points but total_points is ${total}.`))
      try {
        ctx.store.updatePack((p) => {
          const pass = a.number('pass_percent')
          const bp: Pack['blueprint'] = { durationMinutes: a.int('duration_minutes') ?? p.exam?.durationMinutes ?? 60, totalPoints: total, sections }
          const instr = plainInstructions(a.string('instructions'))
          if (instr) bp.instructions = instr
          if (pass !== undefined) { const v = pass > 1 ? pass / 100 : pass; if (v > 0 && v <= 1) bp.passPercent = v }
          p.blueprint = bp
        })
        ctx.notify({ kind: 'note', text: tr(`Plano del simulacro: ${sections.length} secciones`, `Mock exam blueprint: ${sections.length} sections`) })
        return ToolOut.json({ ok: true, saved: true, sections: sections.length, points: total, issues: ToolOut.issues(issues) })
      } catch (err) {
        return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

// MARK: Control

export function noteProgress(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'note_progress', 'Tell the student what you are doing right now (one short sentence in the course language). It appears in the live timeline.',
    Schema.object([['message', Schema.string()]], { required: ['message'] }),
    (a) => {
      const m = a.string('message')
      if (m) ctx.notify({ kind: 'note', text: ToolOut.clip(m, 300) })
      return ToolOut.json({ ok: true })
    })
}

export function finish(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'finish', 'Call when your task is complete, with a 1–3 sentence summary of what you did and anything the student should double-check. Do not call it before validate_skill passes (when authoring a skill).',
    Schema.object([['summary', Schema.string()]], { required: ['summary'] }),
    (a) => {
      ctx.notify({ kind: 'finished', summary: a.string('summary') ?? 'Listo.' })
      return ToolOut.json({ ok: true, message: 'Finished. You may stop now.' })
    })
}

export function askUser(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'ask_user', 'Ask the student a question when something essential is ambiguous and cannot be found in the materials (e.g. which chapters the exam covers). Prefer to decide yourself and state your assumption. Offer 2–4 `options` when possible.',
    Schema.object([['question', Schema.string()], ['options', Schema.array(Schema.string())]], { required: ['question'] }),
    async (a, signal) => {
      const q = a.string('question')
      if (!q) return ToolOut.error("Missing required argument 'question'.")
      if (!ctx.askUser) return ToolOut.json({ ok: true, answer: '', note: 'No student is available right now. Proceed with your best judgment and record your assumption with note_progress.' })
      const answer = await ctx.askUser(ToolOut.clip(q, 600), (a.strings('options') ?? []).slice(0, 6).map((o) => ToolOut.clip(o, 120)), signal)
      return ToolOut.json({ ok: true, answer })
    })
}
