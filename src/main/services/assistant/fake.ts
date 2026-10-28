// La IA simulada del chat (`AULA_FAKE_AI=1`, pruebas de extremo a extremo y demostraciones): envuelve a la de toda la app y responde
// como lo haría Aula, poco a poco y con las herramientas REALES (así se ven los pasos y las tarjetas de verdad):
// - «I have an English test on Monday at 10»: mira el calendario, propone el evento (tarjeta con tu OK) y ofrece preparar el curso;
// - «Make me a course on…»: crea el curso (tarjeta con tu OK);
// - un test o unas tarjetas («quiz», «test», «tarjetas»…): `make_quiz` / `make_flashcards`, de trigonometría si se habla de ella;
// - una pista en el tutor: lee el ejercicio y da su primera pista, sin la respuesta;
// - una pregunta de trigonometría: busca en los materiales del curso y responde citándolos, con una gráfica;
// - lo demás: mira tus cursos, busca en tu Aula, comprueba una cuenta y explica con un ejemplo y una gráfica.
// Los textos salen en el idioma de la interfaz (`tr`). Lo que no es el chat (aprender de la conversación, JSON) recibe lo mínimo.
import type { ChatEvent, ChatRequest, ChatResponse } from '@shared/ai/types'
import { emptyUsage, messageText } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { responseFromEvents } from '../ai/core/toolCalls'
import { cancelledError } from '../ai/errors'
import { FAKE_PROVIDER_ID } from '../ai/fake'
import type { ChatModel, CompleteOptions } from '../ai/model'
import {
  fakeAnswer, fakeCitedAnswer, fakeCourseTitle, fakeCourseWrapUp, fakeEvent, fakeEventWrapUp, fakeFlashcardsArgs, fakeHint, fakeIntent, fakeIntro, fakeMistake,
  fakeQuizArgs, isTrig, type FakePassage
} from './fakeScripts'

export { fakeAnswer, fakeFlashcardsArgs, fakeIntent, fakeIntro, fakeQuizArgs, type FakeIntent } from './fakeScripts'

export const isFakeModel = (m: ChatModel | undefined): boolean => m?.providerId === FAKE_PROVIDER_ID

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(cancelledError()); return }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
  const onAbort = (): void => { clearTimeout(t); reject(cancelledError()) }
  signal?.addEventListener('abort', onAbort, { once: true })
})

/** El mensaje del turno (con el contexto) y, dentro, el mensaje nuevo del estudiante. */
function turnMessage(request: ChatRequest): string {
  const user = [...request.messages].reverse().find((m) => m.role === 'user')
  return user ? messageText(user) : ''
}

function studentMessage(request: ChatRequest): string {
  const all = turnMessage(request)
  const at = all.lastIndexOf("## Student's new message\n")
  return (at >= 0 ? all.slice(at + 25) : all).trim()
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** El resultado (JSON) de la última llamada a una herramienta en este turno. */
function toolResult(request: ChatRequest, name: string): Obj | undefined {
  const tool = [...request.messages].reverse().find((m) => m.role === 'tool' && m.name === name)
  if (!tool) return undefined
  try {
    const v = JSON.parse(messageText(tool)) as unknown
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

function coursesFrom(request: ChatRequest): number | undefined {
  const v = toolResult(request, 'list_courses')
  if (!v) return undefined
  return typeof v.count === 'number' ? v.count : Array.isArray(v.courses) ? v.courses.length : undefined
}

/** El curso del que se habla: el de trigonometría si lo hay (o el primero). */
function courseFrom(request: ChatRequest): { id: string; title: string } | undefined {
  const v = toolResult(request, 'list_courses')
  const list = Array.isArray(v?.courses) ? v.courses.filter(isObj) : []
  const pick = list.find((c) => /trig|math|calcul|matem/i.test(`${String(c.title)} ${String(c.subject ?? '')}`)) ?? list[0]
  return pick && typeof pick.course_id === 'string' ? { id: pick.course_id, title: String(pick.title ?? pick.course_id) } : undefined
}

function passageFrom(request: ChatRequest): FakePassage | undefined {
  const v = toolResult(request, 'search_course_materials')
  const hit = (Array.isArray(v?.results) ? v.results : []).find((r): r is Obj => isObj(r) && typeof r.cite === 'string' && typeof r.snippet === 'string')
  return hit ? { cite: String(hit.cite), snippet: String(hit.snippet) } : undefined
}

/** Los títulos de lo que el estudiante mencionó con «@» (la sección «Mentioned items» del mensaje del turno). */
export function mentionedTitles(request: ChatRequest): string[] {
  const all = turnMessage(request)
  const at = all.indexOf('## Mentioned items')
  if (at < 0) return []
  const section = all.slice(at).split('\n## ')[0]
  return section.split('\n').flatMap((l) => {
    const t = /^- [^«\n]*«([^»]+)»/.exec(l)
    return t ? [t[1]] : []
  })
}

/** Trozos del tamaño de lo que manda un proveedor real (palabras sueltas, con los bloques enteros). */
export function fakeChunks(text: string): string[] {
  const out: string[] = []
  const re = /```[\s\S]*?```|\S+\s*|\s+/g
  let m: RegExpExecArray | null
  let buf = ''
  while ((m = re.exec(text))) {
    buf += m[0]
    if (buf.length >= 12 || m[0].startsWith('```')) { out.push(buf); buf = '' }
  }
  if (buf) out.push(buf)
  return out
}

/** ¿Cómo acabó `create_course`? (creado, tarjeta para terminarlo en «Nuevo curso», el estudiante dijo que no o error). */
function courseOutcome(r: Obj | undefined): 'created' | 'card' | 'declined' | 'failed' {
  if (!r) return 'failed'
  if (r.ok === true) return 'created'
  if (r.card_shown === true) return 'card'
  if (r.approved === false) return 'declined'
  return 'failed'
}

/** Envuelve la IA simulada de la app para que el chat responda como Aula. `delayMs` = pausa entre trozos. */
export function streamingFake(base: ChatModel, delayMs = 35): ChatModel {
  return {
    ...base,
    providerName: base.providerName,
    async complete(request: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> {
      if (opts.signal?.aborted) throw cancelledError()
      const system = request.messages.filter((m) => m.role === 'system').map(messageText).join('\n')
      // aprender de la conversación y demás peticiones sin herramientas: lo mínimo válido
      if (!request.tools?.length) {
        if (/memor/i.test(system) || request.jsonMode) return responseFromEvents([{ type: 'text', text: '{"memories":[],"outdated":[]}' }, { type: 'finished', finish: 'stop' }])
        return base.complete(request, opts)
      }
      const events: ChatEvent[] = []
      const emit = (e: ChatEvent): void => { events.push(e); opts.onDelta?.(e) }
      const usedTools = request.messages.some((m) => m.role === 'tool')
      const has = (name: string): boolean => request.tools!.some((t) => t.name === name)
      const used = (name: string): boolean => request.messages.some((m) => m.role === 'tool' && m.name === name)
      const can = (name: string): boolean => has(name) && !used(name)
      const call = async (id: string, name: string, args: unknown, pause: number): Promise<ChatResponse> => {
        await sleep(pause, opts.signal)
        emit({ type: 'tool_call', index: 0, id, name, argumentsFragment: typeof args === 'string' ? args : JSON.stringify(args) })
        emit({ type: 'finished', finish: 'toolCalls' })
        return responseFromEvents(events)
      }
      const say = async (text: string): Promise<ChatResponse> => {
        for (const chunk of fakeChunks(text)) {
          await sleep(delayMs, opts.signal)
          emit({ type: 'text', text: chunk })
        }
        emit({ type: 'usage', usage: { ...emptyUsage(), promptTokens: request.messages.map(messageText).join('').length, completionTokens: text.length } })
        emit({ type: 'finished', finish: 'stop' })
        return responseFromEvents(events)
      }
      // primero piensa un momento y mira tus cursos
      if (!usedTools && has('list_courses')) return call('fake-1', 'list_courses', '{}', delayMs * 12)
      const asked = studentMessage(request)
      const exerciseID = /Exercise id: `([^`]+)`/.exec(turnMessage(request))?.[1]
      // «explícame mi error» solo tiene sentido con un ejercicio delante; si no, es una pregunta normal
      const wanted = fakeIntent(asked)
      const intent = wanted === 'mistake' && !exerciseID ? 'answer' : wanted
      const trig = isTrig(asked)

      // un examen con fecha: mirar el calendario → el evento (con tu OK) → ofrecer el curso
      const event = intent === 'event' ? fakeEvent(asked) : undefined
      if (event && has('add_calendar_event')) {
        if (can('calendar_events') && !used('add_calendar_event')) return call('fake-cal', 'calendar_events', { days_ahead: 14 }, delayMs * 8)
        if (!used('add_calendar_event')) {
          return call('fake-ev', 'add_calendar_event', { title: event.title, start: event.start, all_day: event.allDay, kind: event.kind, reminders: [24 * 60] }, delayMs * 8)
        }
        const added = toolResult(request, 'add_calendar_event')?.ok === true
        if (added && can('ask_user') && has('create_course')) {
          return call('fake-ask', 'ask_user', {
            question: tr(`¿Te preparo un curso para «${event.title}»?`, `Shall I prepare a course for “${event.title}”?`),
            options: [{ label: tr('Sí, prepáralo', 'Yes, prepare it'), detail: tr('Lecciones, práctica y un simulacro', 'Lessons, practice and a mock exam') }, { label: tr('Ahora no', 'Not now') }],
            allow_other: false
          }, delayMs * 6)
        }
        const ans = toolResult(request, 'ask_user')
        const yes = !!ans && (ans.option_index === 0 || /^(yes|si|sí|ok|vale|claro)/i.test(String(ans.answer ?? '')))
        if (added && yes && can('create_course')) {
          return call('fake-course', 'create_course', {
            title: event.title, ...(event.subject ? { subject: event.subject } : {}), depth: 'quick', exam_title: event.title, exam_date: event.start,
            goal: tr(`Aprobar «${event.title}»`, `Pass “${event.title}”`)
          }, delayMs * 6)
        }
        const course = used('create_course') ? courseOutcome(toolResult(request, 'create_course')) : ans ? 'declined' : undefined
        return say(fakeEventWrapUp({ added, title: event.title, ...(course ? { course } : {}) }))
      }

      // crear un curso de lo que pida (la herramienta enseña la tarjeta con tu OK)
      if (intent === 'course' && has('create_course')) {
        const title = fakeCourseTitle(asked)
        if (can('create_course')) return call('fake-course', 'create_course', { title, depth: 'standard' }, delayMs * 8)
        return say(fakeCourseWrapUp(title, courseOutcome(toolResult(request, 'create_course'))))
      }

      // una pista en el tutor: lee el ejercicio en el que está y da la primera pista
      if (intent === 'hint') {
        if (exerciseID && can('get_exercise')) return call('fake-ex', 'get_exercise', { exercise_id: exerciseID }, delayMs * 8)
        const ex = toolResult(request, 'get_exercise')?.exercise
        const hints = isObj(ex) && Array.isArray(ex.hints) ? ex.hints.filter((h): h is string => typeof h === 'string') : []
        return say(fakeHint(hints))
      }

      // su error en el tutor: lee el ejercicio y explica el porqué de lo que respondió, sin la solución
      if (intent === 'mistake') {
        if (exerciseID && can('get_exercise')) return call('fake-ex', 'get_exercise', { exercise_id: exerciseID }, delayMs * 8)
        const ex = toolResult(request, 'get_exercise')?.exercise
        const turn = turnMessage(request)
        const input = /^- Their last answer: (.+)$/m.exec(turn)?.[1]?.trim()
        const why = /^- Result: \w+: (.+)$/m.exec(turn)?.[1]?.trim()
        return say(fakeMistake(isObj(ex) ? ex : {}, input, why))
      }

      // trigonometría: busca en los materiales del curso y responde citándolos
      if (intent === 'answer' && trig && has('search_course_materials')) {
        const course = courseFrom(request)
        if (course && can('search_course_materials')) return call('fake-mat', 'search_course_materials', { course_id: course.id, query: asked.split('\n')[0].slice(0, 80) }, delayMs * 8)
        const passage = passageFrom(request)
        if (course && passage) return say(fakeCitedAnswer(asked, passage, course.title))
      }

      // una respuesta normal: busca en tu Aula y comprueba la cuenta (así se ven varios pasos, como con una IA de verdad)
      if (intent === 'answer' && can('find_items')) return call('fake-3', 'find_items', JSON.stringify({ query: asked.split('\n')[0].slice(0, 60) }), delayMs * 6)
      if (intent === 'answer' && can('calculate')) return call('fake-4', 'calculate', JSON.stringify({ expression: '2^2 - 4' }), delayMs * 6)

      // un test o unas tarjetas: primero la herramienta de verdad (la tarjeta sale en el chat), después una línea
      const study = intent === 'quiz' || intent === 'flashcards' ? intent : undefined
      const made = used('make_quiz') || used('make_flashcards')
      if (study && !made && has(study === 'quiz' ? 'make_quiz' : 'make_flashcards')) {
        return call('fake-2', study === 'quiz' ? 'make_quiz' : 'make_flashcards', study === 'quiz' ? fakeQuizArgs(trig) : fakeFlashcardsArgs(trig), delayMs * 4)
      }
      return say(study && made ? fakeIntro(study) : fakeAnswer(asked, coursesFrom(request), mentionedTitles(request)))
    }
  }
}
