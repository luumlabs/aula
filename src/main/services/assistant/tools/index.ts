// Herramientas del chat global de Aula y del tutor (port de AssistantTools.all): las propias, leer materiales (los adjuntos en el
// chat; en el tutor, los materiales del curso y los adjuntos aparte), calculadora y química, practicar, objetivo de la sesión,
// plataforma (solo lectura) y las que añaden otras áreas. Todas pasan por `guarded`: lo que viene de fuera es dato, no orden.
import { tr } from '@shared/ai/i18n'
import type { AgentTool } from '../../ai/model'
import type { ToolEnv } from '../host'
import { newCard } from '../models'
import { isApproval } from '../broker'
import { outJSON, uniqueTools } from '../toolkit'
import { goalTools } from '../goals'
import { fact, findCourse } from './common'
import { addCalendarEventTool, addFlashcardTool, askUserTool, completeTaskTool, createCourseTool, deleteCalendarEventTool, extendCourseTool, openScreenTool, setExamDateTool, showItemsTool, updateCalendarEventTool } from './act'
import { calendarEventsTool, findItemsTool, getCourseTool, getExerciseTool, getLessonTool, listCoursesTool, readCourseMaterialTool, searchCourseMaterialsTool, studyOverviewTool } from './read'
import { calculateTool, chemistryTool, listSourcesTool, readSourceTool, searchSourcesTool } from './research'
import { blockReferenceTool, convertUnitsTool, graphFunctionTool, makeFlashcardsTool, makeQuizTool, saveStudySetTool } from './study'
import { platformTools } from './platform'
import { fetchURL, webSearch, type ToolContext } from '../../tools'

/** Herramientas que añaden otras áreas al chat y al tutor (documentos, automatizaciones…). Se registran una vez al arrancar. */
export type AssistantToolProvider = (env: ToolEnv) => AgentTool[]
const providers = new Map<string, AssistantToolProvider>()

export function registerAssistantTools(area: string, provider: AssistantToolProvider | null): void {
  if (provider) providers.set(area, provider)
  else providers.delete(area)
}

export function registeredToolAreas(): string[] {
  return [...providers.keys()]
}

/** Las propias del chat (sin leer materiales, calculadora ni plataforma). */
export function ownTools(env: ToolEnv): AgentTool[] {
  return [
    listCoursesTool(env), findItemsTool(env), getCourseTool(env), getLessonTool(env, 'get_lesson'), getLessonTool(env, 'get_skill'), getExerciseTool(env),
    studyOverviewTool(env, 'study_overview'), studyOverviewTool(env, 'student_status'), searchCourseMaterialsTool(env), readCourseMaterialTool(env), calendarEventsTool(env),
    askUserTool(env), showItemsTool(env), openScreenTool(env), createCourseTool(env), extendCourseTool(env), addCalendarEventTool(env), updateCalendarEventTool(env),
    deleteCalendarEventTool(env), completeTaskTool(env), setExamDateTool(env), addFlashcardTool(env),
    makeQuizTool(env), makeFlashcardsTool(env), saveStudySetTool(env), graphFunctionTool(env), convertUnitsTool(), blockReferenceTool()
  ]
}

/** Lo que leen `list_sources`/`search_sources`/`read_source`: los adjuntos en el chat; los materiales del curso en el tutor. */
function researchTools(env: ToolEnv): AgentTool[] {
  const course = env.defaultCourseID ? findCourse(env, env.defaultCourseID) : undefined
  const store = course ? () => course.store : env.filesHandle
  const out = [listSourcesTool(store), searchSourcesTool(store, env.vectors), readSourceTool(store), calculateTool(), chemistryTool()]
  // internet: buscar y leer páginas públicas (lo que traen es dato; `guarded` pide permiso para direcciones que no salen de aquí)
  if (env.allowWeb && env.web) {
    const ctx: ToolContext = { store: store(), validator: () => env.validator, web: env.web, notify: () => undefined }
    out.push(webSearch(ctx), fetchURL(ctx))
  }
  if (course) {
    // en el tutor, lo que el estudiante adjunta en la conversación se lee con estas
    out.push(
      listSourcesTool(env.filesHandle, 'list_attachments', 'Files the student attached to THIS conversation (documents, photos, audio/video transcripts). For the course materials use list_sources.'),
      searchSourcesTool(env.filesHandle, undefined, 'search_attachments', 'Search the files attached to this conversation (returns passages with page). For the course materials use search_sources.'),
      readSourceTool(env.filesHandle, 'read_attachment', 'Read text of a file attached to this conversation (source_id from list_attachments).')
    )
  }
  return out
}

/** Lo que viene de fuera es dato, no orden (AI-02): cada herramienta apunta en `env.trust` si trae texto ajeno; `web_search` apunta
 * las direcciones que devuelve; `fetch_url` solo abre sin tarjeta lo que dio el estudiante o salió de `web_search` en este turno. */
export function guarded(env: ToolEnv, tools: AgentTool[]): AgentTool[] {
  const trust = env.trust
  return tools.map((t): AgentTool => {
    if (t.name === 'web_search') {
      return { ...t, run: async (args, ctx) => {
        trust.noteTool(t.name)
        const out = await t.run(args, ctx)
        const text = typeof out === 'string' ? out : out.text
        try {
          const v = JSON.parse(text) as { results?: Array<{ url?: unknown }> }
          trust.noteSearchResults((v.results ?? []).flatMap((r) => (typeof r.url === 'string' ? [r.url] : [])))
        } catch { /* sin resultados legibles */ }
        return out
      } }
    }
    if (t.name === 'fetch_url') {
      return { ...t, run: async (args, ctx) => {
        trust.noteTool(t.name)
        const raw = typeof (args as Record<string, unknown>).url === 'string' ? ((args as Record<string, unknown>).url as string).trim() : ''
        let host = ''
        try { host = new URL(raw).hostname } catch { host = '' }
        if (host && !trust.isTrusted(raw)) {
          const card = newCard('approval', tr('Abrir una página web', 'Open a web page'), {
            detail: tr('Aula quiere leer una dirección que no escribiste tú ni salió de una búsqueda. Mírala antes: si lleva datos tuyos, irían a ese sitio.', 'Aula wants to read an address you did not write and that did not come from a search. Check it first: if it carries your data, it would go to that site.'),
            facts: [fact(tr('Sitio', 'Site'), host), fact(tr('Dirección', 'Address'), raw.slice(0, 300))], actionLabel: tr('Abrir', 'Open'), icon: 'globe'
          })
          const ans = await env.io.ask(card)
          if (!isApproval(ans)) {
            if (ans.kind === 'typed') return outJSON({ ok: false, approved: false, student_wrote: ans.text, note: 'The student answered in writing instead of allowing it. Act on what they wrote.' })
            return outJSON({ ok: false, approved: false, note: 'Not opened: only pages the student gave or that came from web_search in this turn open without asking, and the student did not allow this one. Use web_search and open one of its results, or continue without it.' })
          }
        }
        return t.run(args, ctx)
      } }
    }
    return { ...t, run: (args, ctx) => { trust.noteTool(t.name); return t.run(args, ctx) } }
  })
}

/** Todas las herramientas de un turno (sin las de memoria, que añade la sesión). */
export function assistantTools(env: ToolEnv): AgentTool[] {
  const extra = [...providers.values()].flatMap((p) => {
    try { return p(env) } catch { return [] }
  })
  const goals = env.goals
    ? goalTools({
      store: env.goals, threadID: env.threadID, library: env.library, defaultCourseID: env.defaultCourseID, untrusted: () => env.trust.sawUntrusted,
      resolveCourse: (id) => findCourse(env, id)?.pack,
      approve: async (title, facts, action, detail) => {
        const ans = await env.io.ask(newCard('approval', title, { facts: facts.map(([l, v]) => fact(l, v)), actionLabel: action, icon: 'target', detail }))
        if (isApproval(ans)) return undefined
        if (ans.kind === 'typed') return outJSON({ ok: false, approved: false, student_wrote: ans.text, note: 'The student answered in writing instead of approving. Read what they wrote and act on it.' })
        return outJSON({ ok: false, approved: false, note: "The student said no. Ask briefly what they would like instead (don't insist)." })
      }
    })
    : []
  return guarded(env, uniqueTools([...ownTools(env), ...researchTools(env), ...platformTools(env), ...goals, ...extra]))
}

export { saveStudySet, EXERCISE_CHEAT_SHEET } from './study'
export { attachmentSources } from './act'
export { catalogCourses, catalogEvents, withCitations } from './read'
