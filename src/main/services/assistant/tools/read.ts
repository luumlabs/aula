// Herramientas para leer la app (port de AssistantTools.swift): cursos, elementos, lecciones, ejercicios, progreso y plan de hoy,
// materiales de un curso (con citas listas) y el calendario.
import { buildCatalog, clip, daysUntil, isoLocal, dayLocal, parseDate, refJSON, REF_KINDS, textOfBlocks, type CatalogCourse } from '@engine/assistant'
import { dailyPlan, dueCardCount, dueMistakes, readiness, skillMastery } from '@engine/study'
import type { AssistantCalendarEvent } from '@engine/calendar'
import type { AssistantRefKind } from '@shared/assistant/types'
import type { JSONObject, JSONValue } from '@shared/ai/json'
import { encodeExercise, orderedSkills, type Pack, type Skill, type SkillRef, type StudyProgress } from '@shared/schema'
import type { AgentTool } from '../../ai/model'
import type { PackStore } from '../../store/packStore'
import type { ToolEnv } from '../host'
import { outError, outJSON, Schema, tool } from '../toolkit'
import { courseArg, findCourse, findSkill, pct, unknownCourse } from './common'
import { readMaterial, searchMaterials } from './research'

const hasAttempts = (pack: Pack, p: StudyProgress): boolean => pack.skills.some((s) => (p.skills[s.id]?.attempts ?? 0) > 0)
const skillMap = (store: PackStore, pack: Pack): Record<string, Skill> => Object.fromEntries(store.loadSkills(pack.skills.map((s) => s.id)).map((s) => [s.id, s]))

function examJSON(pack: Pack, now: Date, notes = false): JSONObject | undefined {
  const e = pack.exam
  if (!e) return undefined
  const d = e.date ? new Date(e.date) : undefined
  const o: JSONObject = { title: e.title, date: d ? isoLocal(d) : null, days_left: d ? daysUntil(d, now) : null }
  if (notes) o.notes = e.notes ? clip(e.notes, 600) : null
  return o
}

export function listCoursesTool(env: ToolEnv): AgentTool {
  return tool('list_courses',
    "All the student's courses in Aula (id, title, subject, exam date and days left, lessons, how ready they are) and the courses being created or changed right now. Start here when they talk about their courses.",
    Schema.object([]), async () => {
      const now = new Date()
      const runs = (await env.control?.runs?.().catch(() => [])) ?? []
      const items: JSONObject[] = []
      for (const sum of env.library.listPacks()) {
        const c = findCourse(env, sum.id)
        if (!c) continue
        const prog = c.store.loadProgress()
        const ready = readiness(c.pack, prog, now)
        const o: JSONObject = { course_id: c.pack.id, title: c.pack.title, subject: c.pack.subject, lessons: c.pack.skills.length, readiness: ready.label,
          expected_score_pct: hasAttempts(c.pack, prog) ? pct(ready.expectedScore) : null }
        const exam = examJSON(c.pack, now)
        if (exam) o.exam = exam
        const r = runs.find((x) => x.courseID === c.pack.id && x.phase === 'running')
        if (r) o.being_created = { status: r.status, progress_pct: pct(r.fraction), is_change: r.isExtend }
        items.push(o)
      }
      const pending = runs.filter((r) => r.phase === 'running' && !items.some((i) => i.course_id === r.courseID))
        .map((r) => ({ course_id: r.courseID, title: r.title, status: r.status, progress_pct: pct(r.fraction) }))
      return outJSON({ ok: true, count: items.length, courses: items, being_created: pending })
    })
}

/** Cursos para el índice de menciones y `find_items` (con sus lecciones completas si se quieren los ejercicios). */
export function catalogCourses(env: { library: ToolEnv['library'] }, withExercises: boolean): CatalogCourse[] {
  const out: CatalogCourse[] = []
  for (const id of env.library.packIDs()) {
    const store = env.library.openPack(id)
    if (!store) continue
    let pack: Pack
    try { pack = store.loadPack() } catch { continue }
    out.push(withExercises ? { pack, skills: skillMap(store, pack) } : { pack })
  }
  return out
}

export function catalogEvents(events: readonly AssistantCalendarEvent[]) {
  return events.map((e) => ({ id: e.id, title: e.title, start: e.start, allDay: e.allDay, kind: e.kind, ...(e.notes ? { notes: e.notes } : {}), ...(e.courseID ? { courseID: e.courseID } : {}) }))
}

export function findItemsTool(env: ToolEnv): AgentTool {
  return tool('find_items',
    'Find things in the student\'s Aula by description: courses, lessons (skills), exercises, study materials and calendar events. Use it whenever they describe something instead of naming it exactly ("the lesson about the unit circle", "that exercise with the parabola"). If more than one result could fit, ask with ask_user giving each candidate as an option with its `ref`, so they can confirm ("¿Te refieres a esto?").',
    Schema.object([
      ['query', Schema.string("words to look for, in the student's language")], ['kinds', Schema.array(Schema.string(undefined, REF_KINDS), 'restrict to these kinds')],
      ['course_id', Schema.string('restrict to one course')], ['limit', Schema.integer('default 8, max 20', 1, 20)]
    ], ['query']),
    async (a) => {
      const q = a.string('query') ?? ''
      const kindsRaw = a.strings('kinds')
      const kinds = kindsRaw ? new Set(kindsRaw.map((k) => k.toLowerCase()).filter((k): k is AssistantRefKind => (REF_KINDS as readonly string[]).includes(k))) : undefined
      const useKinds = kinds && kinds.size ? kinds : undefined
      let events: AssistantCalendarEvent[] = []
      if ((!useKinds || useKinds.has('event')) && env.calendar) {
        try { events = await env.calendar.events(new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() + 180 * 86_400_000)) } catch { events = [] }
      }
      const catalog = buildCatalog(catalogCourses(env, !useKinds || useKinds.has('exercise')), catalogEvents(events))
      const courseID = a.string('course_id') ? findCourse(env, a.string('course_id'))?.pack.id ?? a.string('course_id') : undefined
      const found = catalog.search(q, { kinds: useKinds, courseID, limit: Math.min(20, Math.max(1, a.int('limit') ?? 8)) })
      const external = new Set(events.filter(isExternalEvent).map((e) => e.id))
      const results: JSONValue[] = found.map((ref) => {
        const j = refJSON(ref)
        if (ref.kind === 'event' && ref.itemID && external.has(ref.itemID)) {
          env.trust.noteExternalContent()
          j.content_untrusted = true
        }
        return j
      })
      return outJSON({ ok: true, query: q, count: found.length, results, tip: 'Pass a result as `ref` in ask_user options or show_items. If nothing fits, ask the student for more detail.' })
    })
}

function lessonSummary(s: SkillRef, prog: StudyProgress, now: Date): JSONObject {
  const sp = prog.skills[s.id]
  return { skill_id: s.id, title: s.title, status: s.status, exercises: s.counts.exercises + s.counts.templates, cards: s.counts.cards, mastery_pct: pct(skillMastery(sp, now)), lesson_done: sp?.lessonDone ?? false }
}

export function getCourseTool(env: ToolEnv): AgentTool {
  return tool('get_course',
    "Outline of one course: units and lessons (with status, content counts and the student's mastery), exam info, materials and glossary/formula sheet sizes.",
    Schema.object([['course_id', Schema.string()]], env.defaultCourseID ? [] : ['course_id']),
    (a) => {
      const id = courseArg(env, a, ['id', 'course'])
      const c = findCourse(env, id)
      if (!c) return unknownCourse(env, a.string('course_id'))
      // un curso importado lo escribió otro: lo que dice es dato, no orden (A2-P2-9)
      if (c.store.wasImported) env.trust.noteExternalContent()
      const now = new Date()
      const prog = c.store.loadProgress()
      const pack = c.pack
      const units = pack.units.map((u) => ({ unit: u.title, lessons: u.skillIDs.flatMap((sid) => { const s = pack.skills.find((x) => x.id === sid); return s ? [lessonSummary(s, prog, now)] : [] }) }))
      const loose = pack.skills.filter((s) => !pack.units.some((u) => u.skillIDs.includes(s.id))).map((s) => lessonSummary(s, prog, now))
      const o: JSONObject = {
        ok: true, course_id: pack.id, title: pack.title, subject: pack.subject, language: pack.language, units, lessons_without_unit: loose,
        materials: pack.sources.slice(0, 40).map((m) => ({ source_id: m.id, title: m.title, kind: m.kind, pages: m.pages })), glossary_terms: pack.glossary.length, formula_groups: pack.formulaSheet.length
      }
      const exam = examJSON(pack, now, true)
      if (exam) o.exam = exam
      if (pack.guidance) o.guidance = clip(pack.guidance, 500)
      return outJSON(o)
    })
}

export function getLessonTool(env: ToolEnv, name: 'get_lesson' | 'get_skill'): AgentTool {
  return tool(name,
    "One lesson (skill) of a course: summary, objectives, an outline of the lesson blocks, its exercises (ids and statements, without answers), flashcards and the student's progress in it.",
    Schema.object([['course_id', Schema.string('the course (optional: if omitted all courses are searched)')], ['skill_id', Schema.string()]], ['skill_id']),
    (a) => {
      const sid = a.string('skill_id', ['lesson_id', 'id'])
      if (!sid) return outError("Missing 'skill_id'.")
      const found = findSkill(env, a.string('course_id'), sid)
      if (!found) return outError(`No lesson '${sid}'. Use find_items or get_course.`)
      const { store, pack, skill } = found
      if (store.wasImported) env.trust.noteExternalContent()
      const sp = store.loadProgress().skills[skill.id]
      const outline = skill.lesson.slice(0, 40).map((b) => {
        const o: JSONObject = { type: b.type }
        const t = textOfBlocks([b])
        if (t) o.text = clip(t, 220)
        return o
      })
      const ex = skill.exercises.slice(0, 40).map((e) => ({ exercise_id: e.id, level: e.level, statement: clip(textOfBlocks(e.prompt), 200) }))
      return outJSON({
        ok: true, course_id: pack.id, course: pack.title, skill_id: skill.id, title: skill.title, summary: skill.summary ?? null, objectives: skill.objectives,
        lesson_outline: outline, exercises: ex, templates: skill.templates.length, flashcards: skill.cards.length, common_mistakes: skill.mistakes.slice(0, 8).map((m) => clip(m.title, 160)),
        mastery_pct: pct(skillMastery(sp, new Date())), lesson_done: sp?.lessonDone ?? false, attempts: sp?.attempts ?? 0
      })
    })
}

export function getExerciseTool(env: ToolEnv): AgentTool {
  return tool('get_exercise',
    "Read one exercise in full: statement, answer key, hints, worked solution and typical wrong answers. For YOUR eyes: don't reveal the final answer unless the student asks for it or has already tried.",
    Schema.object([['exercise_id', Schema.string()], ['course_id', Schema.string('optional')], ['skill_id', Schema.string('optional')]], ['exercise_id']),
    (a) => {
      const eid = a.string('exercise_id', ['id'])
      if (!eid) return outError("Missing 'exercise_id'.")
      let stores: PackStore[]
      const cid = a.string('course_id')
      if (cid) {
        const c = findCourse(env, cid)
        stores = c ? [c.store] : []
      } else {
        stores = env.library.packIDs().flatMap((id) => { const s = env.library.openPack(id); return s ? [s] : [] })
        const d = env.defaultCourseID
        const i = d ? stores.findIndex((s) => s.id === d) : -1
        if (i > 0) stores.unshift(...stores.splice(i, 1))
      }
      for (const store of stores) {
        const ids = a.string('skill_id') ? [a.string('skill_id')!] : store.skillIDs()
        for (const sid of ids) {
          let skill: Skill
          try { skill = store.loadSkill(sid) } catch { continue }
          const e = skill.exercises.find((x) => x.id === eid)
          if (e) {
            if (store.wasImported) env.trust.noteExternalContent()
            return outJSON({ ok: true, course_id: store.id, skill_id: sid, exercise: encodeExercise(e) })
          }
        }
      }
      return outError(`No exercise '${eid}'. Use find_items with kinds ["exercise"].`)
    })
}

function courseStatus(store: PackStore, pack: Pack, minutes: number, detailed: boolean, now: Date): JSONObject {
  const prog = store.loadProgress()
  const skills = skillMap(store, pack)
  const ready = readiness(pack, prog, now)
  const plan = dailyPlan(pack, skills, prog, minutes, now)
  const o: JSONObject = {
    course_id: pack.id, title: pack.title, readiness: ready.label, expected_score_pct: hasAttempts(pack, prog) ? pct(ready.expectedScore) : null,
    cards_due: dueCardCount(pack, skills, prog, now), mistakes_due: dueMistakes(prog, now, skills).length,
    lessons_done: pack.skills.filter((s) => prog.skills[s.id]?.lessonDone === true).length, lessons: pack.skills.length,
    today_plan: plan.filter((p) => p.kind !== 'rest').slice(0, detailed ? 8 : 3).map((p) => {
      const x: JSONObject = { what: p.title, minutes: p.minutes, why: p.reason, kind: p.kind }
      if (p.skillID) x.skill_id = p.skillID
      return x
    })
  }
  if (pack.exam?.date) {
    const d = new Date(pack.exam.date)
    o.exam_date = isoLocal(d)
    o.days_left = daysUntil(d, now)
  }
  if (detailed) {
    o.ok = true
    o.mastery = orderedSkills(pack).map((s) => ({ skill_id: s.id, title: s.title, mastery_pct: pct(skillMastery(prog.skills[s.id], now)), attempts: prog.skills[s.id]?.attempts ?? 0 }))
    o.weakest = ready.weakest.slice(0, 4).map((id) => pack.skills.find((s) => s.id === id)?.title ?? id)
    o.recent_mistakes = prog.mistakes.filter((m) => !m.resolved).sort((x, y) => y.lastSeen.localeCompare(x.lastSeen)).slice(0, 8).map((m) => ({
      exercise_id: m.exerciseID, skill: pack.skills.find((s) => s.id === m.skill)?.title ?? m.skill, times: m.count, they_wrote: m.lastInput ?? null, why_wrong: m.why ? clip(m.why, 240) : null
    }))
  }
  return o
}

export function studyOverviewTool(env: ToolEnv, name: 'study_overview' | 'student_status'): AgentTool {
  return tool(name,
    'How the student is doing and what to study today. With course_id: readiness for the exam, mastery per lesson, weakest lessons, recent mistakes (what they typed and why it was wrong), flashcards and mistakes due, and today\'s plan. Without course_id: a summary of every course and today\'s plan across them.',
    Schema.object([['course_id', Schema.string('optional')]]),
    (a) => {
      const minutes = Math.max(10, env.dailyMinutes)
      const now = new Date()
      const cid = courseArg(env, a, ['id'])
      if (cid) {
        const c = findCourse(env, cid)
        if (!c) return unknownCourse(env, cid)
        return outJSON(courseStatus(c.store, c.pack, minutes, true, now))
      }
      const courses: JSONObject[] = []
      let dueCards = 0, dueMist = 0
      for (const id of env.library.packIDs()) {
        const c = findCourse(env, id)
        if (!c) continue
        const o = courseStatus(c.store, c.pack, minutes, false, now)
        dueCards += Number(o.cards_due) || 0
        dueMist += Number(o.mistakes_due) || 0
        courses.push(o)
      }
      return outJSON({ ok: true, daily_goal_minutes: minutes, cards_due_total: dueCards, mistakes_due_total: dueMist, courses })
    })
}

/** Añade a cada pasaje una cita lista («Apuntes del tema 3, p. 12») para que la IA cite sin inventar páginas. */
export function withCitations(o: JSONObject): JSONObject {
  const results = Array.isArray(o.results) ? o.results : []
  return {
    ...o,
    results: results.map((r) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return r
      const x = r as JSONObject
      const title = typeof x.source_title === 'string' ? x.source_title : undefined
      if (!title) return x
      return { ...x, cite: typeof x.page === 'number' ? `${title.replace(/\.(pdf|docx?|pptx?|txt|md)$/i, '')}, p. ${x.page}` : title.replace(/\.(pdf|docx?|pptx?|txt|md)$/i, '') }
    }),
    tip: 'Answer the question in your own words from these passages and cite what you use with <cite>, labelled in the language of your reply: (Fuente: <cite>) in Spanish, (Source: <cite>) in English. Never invent a page.'
  }
}

export function searchCourseMaterialsTool(env: ToolEnv): AgentTool {
  return tool('search_course_materials',
    'Search the study materials of one course (its PDFs, notes, slides, review sheets…). Returns passages with source id, page and snippet; then read_course_material for more. (For files attached to THIS chat use search_sources instead.)',
    Schema.object([['course_id', Schema.string()], ['query', Schema.string()], ['limit', Schema.integer('default 6, max 12', 1, 12)]], env.defaultCourseID ? ['query'] : ['course_id', 'query']),
    async (a) => {
      const c = findCourse(env, courseArg(env, a))
      if (!c) return unknownCourse(env, a.string('course_id'))
      const r = await searchMaterials(c.store, a, env.vectors?.(c.store.directory))
      return typeof r === 'string' ? outError(r) : outJSON(withCitations(r))
    })
}

export function readCourseMaterialTool(env: ToolEnv): AgentTool {
  return tool('read_course_material',
    'Read text from one material of a course: give a chunk_id (from search_course_materials) or a page range. Long texts are paginated with next_offset.',
    Schema.object([
      ['course_id', Schema.string()], ['source_id', Schema.string()], ['chunk_id', Schema.string()], ['page_from', Schema.integer()], ['page_to', Schema.integer()],
      ['offset', Schema.integer()], ['max_chars', Schema.integer('default 6000, max 12000', 500, 12000)]
    ], env.defaultCourseID ? ['source_id'] : ['course_id', 'source_id']),
    (a) => {
      const c = findCourse(env, courseArg(env, a))
      if (!c) return unknownCourse(env, a.string('course_id'))
      const r = readMaterial(c.store, a)
      return typeof r === 'string' ? outError(r) : outJSON(r)
    })
}

export function eventJSON(e: AssistantCalendarEvent): JSONObject {
  const o: JSONObject = { event_id: e.id, title: e.title, start: e.allDay ? dayLocal(e.start) : isoLocal(e.start), all_day: e.allDay, kind: e.kind, source: e.source, editable: e.editable }
  if (isExternalEvent(e)) o.content_untrusted = true
  if (e.end) o.end = isoLocal(e.end)
  if (e.courseID) o.course_id = e.courseID
  if (e.course) o.course = clip(e.course, 120)
  if (e.notes) o.notes = clip(e.notes, 300)
  if (e.location) o.location = e.location
  if (e.recurrence) o.repeat = e.recurrence
  if (e.isTask) { o.task = true; o.done = e.done }
  if (e.reminders.length) o.reminders = e.reminders
  return o
}

/** Lo que escribió otro: las fechas de la plataforma y los eventos importados de un .ics («own:ics-…»), aunque ya sean propios
 * (A2-P2-9: sus notas pueden traer instrucciones). */
function isExternalEvent(e: { source: string; id: string }): boolean {
  return e.source === 'platform' || e.id.startsWith('own:ics-')
}

export function calendarEventsTool(env: ToolEnv): AgentTool {
  return tool('calendar_events',
    "The student's calendar in Aula: exams and dates of their courses, events they added and (if connected) the dates of their study platform. Default: from today to 30 days ahead.",
    Schema.object([['from', Schema.string('ISO date, default today')], ['to', Schema.string('ISO date')], ['days_ahead', Schema.integer('instead of `to` (default 30, max 180)', 1, 180)]]),
    async (a) => {
      const cal = env.calendar
      if (!cal) return outError('The calendar is not available.')
      const today = new Date()
      const from = (a.string('from') ? parseDate(a.string('from')!) : undefined) ?? new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const to = (a.string('to') ? parseDate(a.string('to')!) : undefined) ?? new Date(from.getTime() + Math.min(180, Math.max(1, a.int('days_ahead') ?? 30)) * 86_400_000)
      const evs = await cal.events(from, to)
      const shown = evs.slice(0, 120)
      if (shown.some(isExternalEvent)) env.trust.noteExternalContent()
      return outJSON({ ok: true, from: isoLocal(from), to: isoLocal(to), count: evs.length, events: shown.map(eventJSON) })
    })
}
