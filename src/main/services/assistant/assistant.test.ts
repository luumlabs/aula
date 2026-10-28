// Chat con Aula y tutor (port de Tests/StudyEngineTests/AssistantTests.swift, AssistantHarnessTests.swift y TutorTests.swift):
// formato de las conversaciones (el de la app Swift), recuperación de respuestas interrumpidas, herramientas con permiso, y turnos
// enteros con una IA falsa en una carpeta de datos temporal: lo que se emite mientras llega, los pasos, las tarjetas, la cola,
// detener, reintentar, los errores contados, «Novedades de Aula» y los cambios del curso que se pueden deshacer.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTurnTrust, AssistantTurns, buildCatalog, extractCitations, linkCitations, messageParts, parseCitation, plainText, redactSecrets, titleFrom } from '@engine/assistant'
import { ContentValidator } from '@engine/content/validator'
import type { ChatRequest } from '@shared/ai/types'
import { messageText } from '@shared/ai/types'
import type { JSONObject } from '@shared/ai/json'
import type { AssistantCard, AssistantMessage } from '@shared/assistant/types'
import { AIError } from '../ai/errors'
import { MockChatModel, reply, type Step } from '../ai/testing/mocks'
import type { ChatModel } from '../ai/model'
import { Library } from '../store/library'
import { installSampleCourses } from '../store/samples'
import { Answer, AssistantBroker } from './broker'
import { explainError } from './errors'
import { fakeAnswer, fakeChunks, fakeIntent, streamingFake } from './fake'
import { autoApproveIO, type AssistantCourseSpec, type CourseTeam, type PlatformReader, type ToolEnv, type TurnIO } from './host'
import { expirePending, newCard, newMessage, newThread } from './models'
import { cardTimeoutMs, runTurn, type TurnEvents } from './session'
import { AssistantService, UPDATES_THREAD, type AssistantSink } from './service'
import { AssistantStore } from './store'
import { assistantTools, catalogCourses, registerAssistantTools } from './tools'
import { budgetForWindow, CITATION_RULE, conversationBlock, STANDARD_BUDGET, systemPrompt } from './prompts'
import { withCitations } from './tools/read'
import { makePack } from '@shared/schema'
import { outputText } from './toolkit'
import { toolLabel } from './labels'
import { createFakeModel } from '../ai/fake'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function setup(): { root: string; lib: Library; store: AssistantStore } {
  const root = mkdtempSync(join(tmpdir(), 'aula-chat-'))
  dirs.push(root)
  const lib = new Library(root)
  installSampleCourses(lib, { onlyIfEmpty: false })
  return { root, lib, store: new AssistantStore(join(root, 'Assistant')) }
}

function env(lib: Library, store: AssistantStore, io: TurnIO = autoApproveIO, extra: Partial<ToolEnv> = {}): ToolEnv {
  return {
    library: lib, files: () => store.files('t1'), filesHandle: () => store.filesHandle('t1'), io, validator: ContentValidator.withMath(), dailyMinutes: 45, allowWeb: false,
    threadID: 't1', studySets: () => undefined, trust: new AssistantTurnTrust([], false), ...extra
  }
}

async function call(env: ToolEnv, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t = assistantTools(env).find((x) => x.name === name)
  if (!t) throw new Error(`falta ${name}`)
  return JSON.parse(outputText(await t.run(args as JSONObject, { signal: new AbortController().signal } as never))) as Record<string, unknown>
}

async function waitFor<T>(fn: () => T | undefined | false, ms = 4000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - start > ms) throw new Error('tiempo agotado')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Lo que la interfaz recibiría por IPC. */
class RecordingSink implements AssistantSink {
  messages: Array<{ threadId: string; message: AssistantMessage }> = []
  statuses: Array<{ threadId: string; busy: boolean; label?: string }> = []
  threadsChanged = 0
  queues: Array<{ threadId: string; queued: string[]; sent?: AssistantMessage }> = []
  message(threadId: string, message: AssistantMessage): void { this.messages.push({ threadId, message: structuredClone(message) }) }
  queue(threadId: string, queued: AssistantMessage[], sent?: AssistantMessage): void { this.queues.push({ threadId, queued: queued.map((m) => m.text), ...(sent ? { sent: structuredClone(sent) } : {}) }) }
  threads(): void { this.threadsChanged++ }
  status(threadId: string, busy: boolean, label?: string): void { this.statuses.push({ threadId, busy, ...(label ? { label } : {}) }) }
  last(id?: string): AssistantMessage | undefined { return [...this.messages].reverse().find((m) => !id || m.message.id === id)?.message }
  pendingCard(kind: AssistantCard['kind']): { message: AssistantMessage; card: AssistantCard } | undefined {
    for (const m of [...this.messages].reverse()) {
      const c = m.message.cards.find((x) => x.kind === kind && x.state === 'pending')
      if (c) return { message: m.message, card: c }
    }
    return undefined
  }
}

function service(root: string, lib: Library, model: ChatModel, sink = new RecordingSink(), extra: Partial<ConstructorParameters<typeof AssistantService>[0]> = {}): { chat: AssistantService; sink: RecordingSink } {
  const chat = new AssistantService({
    root, library: () => lib, sink, model: async () => model, memory: () => undefined, settings: () => ({ appLanguage: 'es', dailyMinutes: 45, allowWeb: false }),
    throttleMs: 5, partialMs: 20, retryDelayMs: 1, ...extra
  })
  return { chat, sink }
}

const lastUser = (r: ChatRequest): string => messageText([...r.messages].reverse().find((m) => m.role === 'user')!)

// MARK: Mensajes, bloques y citas

describe('mensajes', () => {
  it('lee bloques y diapositivas (también con el nombre de antes)', () => {
    const text = 'Resumen:\n\n```aula-block\n{"type":"table","headers":["A","B"],"rows":[["1","2"]]}\n```\n¿Lo ves?\n\n```estudio-block\n{"type":"math","tex":"x^2"}\n```'
    const parts = messageParts(text)
    expect(parts.map((p) => p.kind)).toEqual(['markdown', 'block', 'markdown', 'block'])
    expect(plainText(text)).not.toContain('headers')
    // flujo cortado: se queda como texto
    const cut = messageParts('Hola\n```aula-slides\n{"title":')
    expect(cut).toHaveLength(1)
    expect(cut[0].kind).toBe('markdown')
  })

  it('quita claves y titula', () => {
    const r = redactSecrets('mi clave es sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX y nada más')
    expect(r.redacted).toBe(true)
    expect(r.text).not.toContain('sk-ant')
    expect(redactSecrets('el lunes tengo prueba de inglés a las 9').redacted).toBe(false)
    expect(titleFrom('El lunes tengo prueba de inglés y no sé por dónde empezar con los tiempos verbales')).toBe('El lunes tengo prueba de inglés y no sé por…')
  })

  it('las citas se leen, se enlazan y se encuentran', () => {
    const text = 'El vértice está en $(h, k)$ (Fuente: Apuntes del tema 3, p. 12). Y más (Fuente: Guía del parcial).'
    const cites = extractCitations(text)
    expect(cites.map((c) => [c.title, c.page])).toEqual([['Apuntes del tema 3', 12], ['Guía del parcial', undefined]])
    expect(linkCitations(text)).toContain('aula-cita')
    expect(parseCitation('Apuntes, p. 4')?.page).toBe(4)
  })

  it('el índice de «@» encuentra cursos, lecciones y ejercicios', () => {
    const { lib } = setup()
    const cat = buildCatalog(catalogCourses({ library: lib }, true))
    const vertex = cat.search('parabola grafica')
    expect(vertex[0]?.kind).toBe('lesson')
    expect(vertex[0]?.itemID).toBe('parabola')
    expect(cat.search('cuadráticas', { kinds: new Set(['course']) })[0]?.courseID).toBe('demo-cuadraticas')
    expect(cat.search('')[0]?.kind).toBe('course')
    expect(cat.search('xqzw jjkkv')).toEqual([])
  })

  it('los turnos viejos no cuentan y la cola nunca pierde mensajes', () => {
    const t = new AssistantTurns()
    const a = t.begin()
    t.invalidate()
    expect(t.isCurrent(a)).toBe(false)
    t.enqueue(newMessage('user', 'uno'))
    t.enqueue(newMessage('user', 'dos'))
    expect(t.takeMerged()?.text).toBe('uno\n\ndos')
    expect(t.queued).toHaveLength(0)
  })

  it('los errores se cuentan para el estudiante', () => {
    expect(explainError(new AIError('network', 'x')).transient).toBe(true)
    expect(explainError(new AIError('missingKey', 'x'), 'OpenAI').message).toContain('OpenAI')
    expect(explainError(new AIError('rateLimited', 'x', { retryAfter: 120 })).message).toContain('2 min')
  })
})

// MARK: Disco (formato de la app Swift)

describe('conversaciones en disco', () => {
  it('lee y escribe el formato de la app Swift; una pregunta a medias ya no espera', () => {
    const { root, store } = setup()
    mkdirSync(store.threadsDirectory, { recursive: true })
    const swift = {
      id: 'A1B2C3', title: 'Inglés', created: '2026-10-12T09:15:02.123Z', updated: '2026-10-12T09:16:40.500Z', pinned: true,
      messages: [
        { id: 'm1', role: 'user', text: 'hola', date: '2026-10-12T09:15:02.123Z', mentions: [{ kind: 'course', courseID: 'demo-cuadraticas', title: 'Funciones cuadráticas' }], attachments: [], cards: [], steps: [], notices: [], failed: false, interrupted: false },
        { id: 'm2', role: 'assistant', text: '¡Hola!', date: '2026-10-12T09:15:05.000Z', mentions: [], attachments: [], notices: [], failed: false, interrupted: false, provider: 'Claude',
          steps: [{ id: 's1', tool: 'list_courses', label: 'Mirando tus cursos', ok: true }],
          cards: [{ id: 'c1', kind: 'question', title: '¿A qué hora?', options: [{ id: 'o1', label: '9:00' }], allowsOther: true, items: [], facts: [], state: 'pending', actions: [] }] }
      ]
    }
    // la app Swift nombra el archivo con el id en minúsculas («IDs.slug»)
    writeFileSync(join(store.threadsDirectory, 'a1b2c3.json'), JSON.stringify(swift))
    const t = store.thread('A1B2C3')!
    expect(t.pinned).toBe(true)
    expect(t.messages[0].mentions[0].courseID).toBe('demo-cuadraticas')
    expect(t.messages[1].cards[0].state).toBe('expired')
    expect(t.messages[1].steps[0].ok).toBe(true)
    store.save(t, false)
    const back = JSON.parse(readFileSync(join(store.threadsDirectory, 'a1b2c3.json'), 'utf8')) as typeof swift
    expect(back.created).toBe('2026-10-12T09:15:02.123Z')
    expect(back.messages[1].provider).toBe('Claude')
    expect(Object.keys(back.messages[0]).sort()).toEqual(Object.keys(swift.messages[0]).sort())
    // los adjuntos son un «curso» oculto en Assistant/Packs; borrar la conversación los borra
    const files = store.files('A1B2C3')
    expect(files.directory).toContain(join(root, 'Assistant', 'Packs'))
    store.delete('A1B2C3')
    expect(store.thread('A1B2C3')).toBeUndefined()
    expect(existsSync(files.directory)).toBe(false)
  })

  it('una respuesta interrumpida se recupera una vez y sin duplicarse', () => {
    const { store } = setup()
    const t = newThread({ messages: [newMessage('user', 'explícame la parábola')] })
    store.save(t)
    const live = newMessage('assistant', 'La parábola es…', { cards: [newCard('question', '¿Sigo?')] })
    store.savePartial(t.id, t.messages[0].id, live)
    expect(store.recoverInterrupted()).toEqual([t.id])
    expect(store.recoverInterrupted()).toEqual([])
    const back = store.thread(t.id)!
    expect(back.messages).toHaveLength(2)
    expect(back.messages[1].interrupted).toBe(true)
    expect(back.messages[1].cards[0].state).toBe('expired')
  })

  it('las conversaciones del tutor de antes se leen y se listan con su curso', () => {
    const { root, lib } = setup()
    const chats = lib.openPack('demo-cuadraticas')!.chatsDirectory
    mkdirSync(chats, { recursive: true })
    writeFileSync(join(chats, 'old.json'), JSON.stringify({
      id: 'old', title: 'Dudas', created: '2026-10-01T10:00:00.000Z', updated: '2026-10-01T10:05:00.000Z',
      messages: [{ id: 'a', role: 'student', text: '¿Qué es el vértice?', date: '2026-10-01T10:00:00.000Z' }, { id: 'b', role: 'tutor', text: 'El punto más alto o más bajo.', sources: ['Apuntes'], date: '2026-10-01T10:01:00.000Z' }]
    }))
    const { chat } = service(root, lib, new MockChatModel([]))
    const list = chat.threads()
    const old = list.find((x) => x.id === 'old')!
    expect(old.courseID).toBe('demo-cuadraticas')
    expect(old.courseTitle).toBe('Funciones cuadráticas')
    const t = chat.thread('old')!
    expect(t.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(t.messages[1].text).toContain('Basado en: Apuntes')
    expect(chat.latestTutorThread('demo-cuadraticas').id).toBe('old')
  })
})

// MARK: Herramientas

describe('herramientas', () => {
  it('leen cursos, lecciones, progreso y ejercicios', async () => {
    const { lib, store } = setup()
    const e = env(lib, store)
    const names = assistantTools(e).map((t) => t.name)
    for (const n of ['list_courses', 'find_items', 'get_course', 'get_lesson', 'get_skill', 'get_exercise', 'study_overview', 'student_status', 'search_course_materials', 'ask_user',
      'show_items', 'open_screen', 'create_course', 'extend_course', 'add_calendar_event', 'set_exam_date', 'add_flashcard', 'list_sources', 'search_sources', 'read_source', 'calculate',
      'make_quiz', 'make_flashcards', 'graph_function']) expect(names).toContain(n)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('web_search')
    const list = await call(e, 'list_courses', {})
    expect(JSON.stringify(list)).toContain('demo-cuadraticas')
    const course = await call(e, 'get_course', { course_id: 'Funciones cuadráticas' })
    expect(course.course_id).toBe('demo-cuadraticas')
    const lesson = await call(e, 'get_lesson', { skill_id: 'La parábola y su gráfica' })
    expect(lesson.skill_id).toBe('parabola')
    const bad = await call(e, 'get_course', { course_id: 'no-existe' })
    expect(bad.ok).toBe(false)
    const overall = await call(e, 'study_overview', {})
    expect(overall.daily_goal_minutes).toBe(45)
  })

  it('cambiar algo pide permiso; negarse o escribir otra cosa no hace nada', async () => {
    const { lib, store } = setup()
    const shown: AssistantCard[] = []
    const created: AssistantCourseSpec[] = []
    const team: CourseTeam = {
      create: async (spec) => { created.push(spec); return { courseID: 'nuevo', title: spec.title, phase: 'running', fraction: 0, status: '', searchesPlatform: false, isExtend: false } },
      extend: async (id) => ({ courseID: id, title: 'x', phase: 'running', fraction: 0, status: '', searchesPlatform: false, isExtend: true })
    }
    const approve: TurnIO = { ask: async (c) => { shown.push(c); return c.kind === 'approval' ? Answer.approved : Answer.option(1) }, show: (c) => { shown.push(c) } }
    const before = lib.openPack('demo-cuadraticas')!.loadSkill('parabola').cards.length
    const saved = await call(env(lib, store, approve), 'add_flashcard', { course_id: 'demo-cuadraticas', skill_id: 'parabola', front: '¿Qué es el vértice?', back: 'El punto más alto o más bajo.' })
    expect(saved.ok).toBe(true)
    expect(shown[0].kind).toBe('approval')
    expect(lib.openPack('demo-cuadraticas')!.loadSkill('parabola').cards.length).toBe(before + 1)
    const c = await call(env(lib, store, approve, { team }), 'create_course', { title: 'Inglés · prueba del lunes', depth: 'rápido', exam_date: '2026-10-19T10:30' })
    expect(c.ok).toBe(true)
    expect(created[0].depth).toBe('quick')
    expect(shown.some((x) => x.kind === 'course')).toBe(true)
    // escribió en vez de aprobar
    const typed: TurnIO = { ask: async () => Answer.typed('mejor a las 10'), show: () => undefined }
    const r = await call(env(lib, store, typed, { team }), 'create_course', { title: 'Química' })
    expect(r.approved).toBe(false)
    expect(r.student_wrote).toBe('mejor a las 10')
    expect(created).toHaveLength(1)
    const denied: TurnIO = { ask: async () => Answer.denied, show: () => undefined }
    const d = await call(env(lib, store, denied), 'add_flashcard', { course_id: 'demo-cuadraticas', skill_id: 'parabola', front: 'x', back: 'y' })
    expect(d.approved).toBe(false)
    expect(lib.openPack('demo-cuadraticas')!.loadSkill('parabola').cards.length).toBe(before + 1)
    // sin el equipo que crea cursos: una tarjeta para abrir «Crear curso»
    const shown2: AssistantCard[] = []
    const noTeam = await call(env(lib, store, { ask: async () => Answer.approved, show: (x) => { shown2.push(x) } }), 'create_course', { title: 'Historia' })
    expect(JSON.stringify(noTeam)).not.toContain('"ok":true,"started"')
    expect(shown2.some((x) => x.kind === 'actions' && x.actions.some((a) => a.kind === 'prepareCourse'))).toBe(true)
  })

  it('gráficas exactas y unidades (port de AssistantHarnessTests)', async () => {
    const { lib, store } = setup()
    const e = env(lib, store)
    const r = await call(e, 'graph_function', { functions: ['x^2-4x+3'], x_min: '-1', x_max: '5' }) as { functions: Array<{ zeros: string[]; extrema: Array<{ kind: string; x: string; y: string }>; y_intercept: string }>; plot_block: { type: string; points: Array<{ label?: string }> } }
    expect(r.functions[0].zeros).toEqual(['1', '3'])
    expect(r.functions[0].extrema[0]).toMatchObject({ kind: 'minimum', x: '2', y: '-1' })
    expect(r.functions[0].y_intercept).toBe('3')
    expect(r.plot_block.type).toBe('plot')
    expect(r.plot_block.points.some((p) => p.label === '(2, -1)')).toBe(true)
    const trig = await call(e, 'graph_function', { functions: ['sin(x)'] }) as { functions: Array<{ zeros: string[] }>; plot_block: { xPi: boolean } }
    expect(trig.functions[0].zeros.some((z) => z.startsWith('π '))).toBe(true)
    expect(trig.plot_block.xPi).toBe(true)
    const hyp = await call(e, 'graph_function', { functions: ['1/(x-2)'], x_min: '-4', x_max: '6' }) as { functions: Array<{ zeros: string[] }> }
    expect(hyp.functions[0].zeros).toHaveLength(0)
    const dbl = await call(e, 'graph_function', { functions: ['(x-1)^2'], x_min: '-3', x_max: '3' }) as { functions: Array<{ zeros: string[] }> }
    expect(dbl.functions[0].zeros).toEqual(['1'])
    expect((await call(e, 'graph_function', { functions: ['y^2+1'] })).ok).toBe(false)
    const v = await call(e, 'convert_units', { value: '36', from: 'km/h', to: 'm/s' })
    expect(v.result as number).toBeCloseTo(10, 9)
    const t = await call(e, 'convert_units', { value: '98.6', from: '°F', to: '°C' })
    expect(t.result as number).toBeCloseTo(37, 6)
    expect((await call(e, 'convert_units', { value: '1', from: 'kg', to: 'm' })).ok).toBe(false)
  })

  it('en el tutor: abrir una lección en un paso, citar materiales y leer los adjuntos aparte', async () => {
    const { lib, store } = setup()
    const opened: Array<{ screen: string; courseID?: string; step?: number }> = []
    const e = env(lib, store, autoApproveIO, { defaultCourseID: 'demo-cuadraticas', control: { open: async (t) => { opened.push(t); return undefined }, appInfo: async () => ({ platforms: [], computerUseEnabled: false, platformDatesConnected: false, dailyMinutes: 30, courseLanguage: 'es', provider: '', webSearch: false }) } })
    await call(e, 'open_screen', { screen: 'lesson', skill_id: 'parabola', step: 3 })
    expect(opened[0]).toMatchObject({ screen: 'lesson', courseID: 'demo-cuadraticas', step: 2 })
    const course = lib.openPack('demo-cuadraticas')!
    course.saveSource({ id: 'apuntes', title: 'Apuntes de la parábola', kind: 'pdf', addedAt: new Date().toISOString(), pages: 4, characters: 120, status: 'ready', trust: 'notes', warnings: [] },
      [{ id: 'a1', sourceID: 'apuntes', ordinal: 0, page: 3, text: 'El vértice de la parábola está en x = -b/(2a).' }])
    const found = await call(e, 'search_course_materials', { query: 'vértice' }) as { results: Array<{ cite?: string }> }
    expect(found.results[0]?.cite).toBe('Apuntes de la parábola, p. 3')
    const sources = await call(e, 'list_sources', {}) as { sources: Array<{ id: string }> }
    expect(sources.sources[0]?.id).toBe('apuntes')
    expect(assistantTools(e).some((t) => t.name === 'read_attachment')).toBe(true)
  })

  it('otras áreas añaden herramientas al chat y el sistema las nombra', () => {
    const { lib, store } = setup()
    registerAssistantTools('docs-test', () => [{ name: 'create_pdf_test', description: 'x', inputSchema: { type: 'object', properties: {} }, run: async () => '{"ok":true}' }])
    try {
      expect(assistantTools(env(lib, store)).some((t) => t.name === 'create_pdf_test')).toBe(true)
      expect(systemPrompt({ appLanguage: 'es', available: new Set(['create_pdf_test', 'calculate']) })).toContain('`create_pdf_test`')
    } finally {
      registerAssistantTools('docs-test', null)
    }
  })

  it('las reglas: una pregunta se responde primero (las tarjetas son un extra), citas en el idioma de la respuesta y lo ajeno se redirige', () => {
    for (const course of [undefined, makePack({ id: 'historia', title: 'La Transición', language: 'en' })]) {
      const sys = systemPrompt({ appLanguage: 'en', course })
      const work = sys.slice(sys.indexOf('## How you work'), sys.indexOf('## How to write your replies'))
      // la respuesta va antes que cualquier tarjeta o ejercicio
      expect(work).toMatch(/Questions come first: when the student asks something, your reply IS the answer/)
      expect(work).toMatch(/Never answer a question with only cards, an exercise or a quiz/)
      expect(work).toMatch(/come only AFTER the answer, as an optional extra/)
      // buscar cosas es para abrirlas o actuar sobre ellas, no para contestar
      expect(work).toMatch(/A QUESTION about a topic .* is not a request for items/)
      expect(work.indexOf('Questions come first')).toBeGreaterThan(-1)
      expect(work).not.toMatch(/Things described in words \("la lección del círculo unidad", "el examen de química"\) → `find_items`/)
      // la cita no es siempre «Fuente:»: depende del idioma de la respuesta
      expect(work).toContain(CITATION_RULE)
      expect(CITATION_RULE).toMatch(/\(Source: title, p\. 12\) in English/)
      expect(CITATION_RULE).toMatch(/\(Fuente: título, p\. 12\) in Spanish/)
      expect(sys).not.toMatch(/cite them like \(Fuente:/)
      // lo que no es de estudiar se redirige en una frase (no se contesta)
      expect(work).toMatch(/off-topic requests \(sports results, trivia, series or film recommendations/)
      expect(work).toMatch(/do NOT answer them/)
      expect(sys).toMatch(/`show_items` \(cards with an Open button — an extra after your answer, never a replacement for it\)/)
    }
    // las citas en inglés se enlazan igual que las de «Fuente:»
    expect(extractCitations('The king defended it (Source: Notes on the Transition, p. 1).')).toEqual([{ title: 'Notes on the Transition', page: 1 }])
  })

  it('search_course_materials pide citar en el idioma de la respuesta', () => {
    const tip = String(withCitations({ results: [] }).tip)
    expect(tip).toContain('(Source: <cite>) in English')
    expect(tip).toContain('(Fuente: <cite>) in Spanish')
  })

  it('el historial cabe en el contexto (también con ventanas pequeñas)', () => {
    const msgs = Array.from({ length: 300 }, (_, i) => newMessage(i % 2 === 0 ? 'user' : 'assistant', `Pregunta número ${i} ` + 'texto '.repeat(300)))
    const normal = conversationBlock(msgs, STANDARD_BUDGET)
    expect(normal.length).toBeLessThan(46_000)
    expect(normal).toContain('Earlier in this conversation')
    expect(normal).toContain('Pregunta número 298')
    const small = budgetForWindow(8_000)
    expect(small.compact).toBe(true)
    expect(conversationBlock(msgs, small).length).toBeLessThan(8_000)
    expect(systemPrompt({ appLanguage: 'es', compact: true })).not.toContain('## 5. Block catalog (JSON')
    expect(budgetForWindow(undefined)).toEqual(STANDARD_BUDGET)
  })

  it('la plataforma: solo lectura y permiso por sitio', async () => {
    const { lib, store } = setup()
    let asked = 0
    const opened: string[] = []
    const reader: PlatformReader = {
      ready: () => true, siteName: () => 'Canvas', accountFor: () => 'acc1',
      open: async (url) => { opened.push(url); return { url, title: 'Anuncios', summary: 'ok' } },
      read: async () => ({ page: { url: 'https://school.instructure.com/x', title: 'x', summary: '' }, text: 'hola' }),
      links: async () => ({ page: { url: 'https://school.instructure.com/x', title: 'x', summary: '' }, links: [] }),
      click: async () => ({ url: 'https://school.instructure.com/x', title: 'x', summary: '' })
    }
    const io: TurnIO = { ask: async () => { asked++; return Answer.approved }, show: () => undefined }
    const e = env(lib, store, io, { platform: reader })
    const tools = assistantTools(e)
    const open = tools.find((t) => t.name === 'platform_open')!
    const ctx = { signal: new AbortController().signal } as never
    await open.run({ url: 'https://school.instructure.com/courses/1' }, ctx)
    await open.run({ url: 'https://school.instructure.com/courses/2' }, ctx)
    expect(asked).toBe(1)
    await open.run({ url: 'https://otro.edu/courses/2' }, ctx)
    expect(asked).toBe(2)
    expect(opened).toHaveLength(3)
    const blocked = JSON.parse(outputText(await tools.find((t) => t.name === 'platform_click')!.run({ target: 'Entregar tarea' }, ctx))) as { ok: boolean }
    expect(blocked.ok).toBe(false)
  })

  it('plazos de las tarjetas y sesiones sin interfaz', async () => {
    const api = new MockChatModel([])
    expect(cardTimeoutMs(api)).toBe(600_000)
    const codex = Object.assign(new MockChatModel([]), { kind: 'codex-cli' as const, runAgent: async () => ({ text: '', steps: 0, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }, stopReason: 'stop' }) })
    expect(cardTimeoutMs(codex as unknown as ChatModel)).toBe(270_000)
    // sin nadie: la pregunta caduca y el permiso se deniega al momento
    const { root, lib } = setup()
    const model = new MockChatModel((req, i) => i === 0
      ? { events: reply({ calls: [{ id: 'c1', name: 'add_flashcard', args: JSON.stringify({ course_id: 'demo-cuadraticas', skill_id: 'parabola', front: 'a', back: 'b' }) }] }) }
      : { events: reply({ text: req.messages.some((m) => m.role === 'tool' && messageText(m).includes('"approved":false')) ? 'No la guardé.' : '¿?' }) })
    const thread = newThread({ messages: [newMessage('user', 'guárdame una tarjeta')] })
    const events: TurnEvents = { status: () => undefined, step: () => undefined, text: () => undefined, card: () => undefined, notice: () => undefined, provider: () => undefined, attachments: () => undefined, segmentBreak: () => undefined }
    const last = await runTurn({ thread, message: thread.messages[0], broker: new AssistantBroker(), signal: new AbortController().signal }, {
      library: lib, store: new AssistantStore(join(root, 'Assistant')), model, validator: ContentValidator.withMath(), appLanguage: 'es', dailyMinutes: 30, allowWeb: false, interactive: false
    }, events)
    expect(last.text).toBe('No la guardé.')
    expect(last.cards[0].state).toBe('denied')
  })
})

// MARK: Turnos enteros

describe('turnos', () => {
  it('emite la respuesta mientras llega, con pasos y permiso; el cambio del curso se puede deshacer', async () => {
    const { root, lib } = setup()
    const flash = JSON.stringify({ course_id: 'demo-cuadraticas', skill_id: 'parabola', front: '¿Qué es el vértice?', back: 'El punto más alto o más bajo de la parábola.' })
    const model = new MockChatModel([
      { events: reply({ text: 'Vale, la preparo. ', calls: [{ id: 'k1', name: 'add_flashcard', args: flash }] }) },
      { events: reply({ text: 'Guardada en **La parábola y su gráfica** (Fuente: Apuntes del tema 3, p. 2).', chunk: 4 }) }
    ])
    const { chat, sink } = service(root, lib, model)
    const t = chat.newThread()
    const before = lib.openPack('demo-cuadraticas')!.loadSkill('parabola').cards.length
    const sent = chat.send({ threadId: t.id, text: 'Guárdame una tarjeta sobre el vértice', messageId: 'local-1' })
    expect(sent.messageId).toBe('local-1')
    expect(chat.isBusy(t.id)).toBe(true)
    // la tarjeta de permiso llega con la respuesta en vivo
    const pending = await waitFor(() => sink.pendingCard('approval'))
    expect(pending.message.text.trim()).toBe('Vale, la preparo.')
    expect(pending.message.steps[0]).toMatchObject({ tool: 'add_flashcard', label: toolLabel('add_flashcard') })
    expect(sink.statuses.some((s) => s.busy && s.label === 'Pensando…')).toBe(true)
    chat.answerCard({ threadId: t.id, messageId: pending.message.id, cardId: pending.card.id, approve: true })
    await chat.idle(t.id)
    expect(chat.isBusy(t.id)).toBe(false)
    // la respuesta final sustituye a la que estaba en vivo (mismo id) y lleva sus citas
    const final = sink.last(pending.message.id)!
    expect(final.text).toContain('Guardada en **La parábola y su gráfica**')
    expect(final.cards[0].state).toBe('approved')
    expect(final.steps[0].ok).toBe(true)
    expect(final.citations?.[0]).toMatchObject({ title: 'Apuntes del tema 3', page: 2 })
    // el texto fue llegando por partes
    const texts = sink.messages.filter((m) => m.message.id === final.id).map((m) => m.message.text)
    expect(new Set(texts).size).toBeGreaterThan(2)
    expect(sink.statuses.at(-1)).toEqual({ threadId: t.id, busy: false })
    // en disco: la conversación con la pregunta y la respuesta
    const disk = new AssistantStore(join(root, 'Assistant')).thread(t.id)!
    expect(disk.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(disk.messages[0].id).toBe('local-1')
    expect(disk.title).toBe('Guárdame una tarjeta sobre el vértice')
    // el mensaje del turno lleva el contexto y lo que dijo el estudiante
    expect(lastUser(model.requests[0])).toContain("## Student's new message\nGuárdame una tarjeta sobre el vértice")
    // «Cambios de Aula»: un grupo del chat con la tarjeta, que se deshace entero
    expect(lib.openPack('demo-cuadraticas')!.loadSkill('parabola').cards.length).toBe(before + 1)
    const groups = lib.history!.groups()
    const g = groups.find((x) => x.kind === 'chat')!
    expect(g.id.startsWith('chat-') && g.id.endsWith('-local-1')).toBe(true)
    expect(g.label).toBe('Guárdame una tarjeta sobre el vértice')
    lib.history!.undo(g.id)
    expect(lib.openPack('demo-cuadraticas')!.loadSkill('parabola').cards.length).toBe(before)
  })

  it('una pregunta a mitad de turno: lo contestado aparece como mensaje del estudiante y la respuesta sigue debajo', async () => {
    const { root, lib } = setup()
    const model = new MockChatModel((req, i) => {
      if (i === 0) return { events: reply({ text: 'Vale. ', calls: [{ id: 'q1', name: 'ask_user', args: JSON.stringify({ question: '¿A qué hora es?', options: ['9:00', 'Todo el día'] }) }] }) }
      const tool = req.messages.filter((m) => m.role === 'tool').map(messageText).join('')
      return { events: reply({ text: tool.includes('9:00') ? 'Apuntado a las 9:00.' : '¿?' }) }
    })
    const { chat, sink } = service(root, lib, model)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'El lunes tengo prueba de inglés' })
    const q = await waitFor(() => sink.pendingCard('question'))
    chat.answerCard({ threadId: t.id, messageId: q.message.id, cardId: q.card.id, optionId: q.card.options[0].id })
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'El lunes tengo prueba de inglés'], ['assistant', 'Vale.'], ['user', '9:00'], ['assistant', 'Apuntado a las 9:00.']
    ])
    expect(th.messages[1].cards[0].state).toBe('answered')
    // la respuesta elegida se emitió como mensaje del estudiante (la interfaz no la tenía)
    expect(sink.messages.some((m) => m.message.role === 'user' && m.message.text === '9:00')).toBe(true)
  })

  it('escribir mientras pregunta contesta a la tarjeta; escribir mientras responde espera en cola', async () => {
    const { root, lib } = setup()
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => { release = r })
    const model = new MockChatModel((req, i) => {
      if (i === 0) return { events: reply({ calls: [{ id: 'q1', name: 'ask_user', args: JSON.stringify({ question: '¿Qué tema?', options: ['Vértice'] }) }] }) }
      return { events: reply({ text: `ok: ${lastUser(req).split('\n').at(-2)}` }) }
    })
    const slow: ChatModel = { ...model, complete: async (r, o) => { if (model.callCount === 2) await gate; return model.complete(r, o) } }
    const { chat, sink } = service(root, lib, slow)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Ayúdame' })
    await waitFor(() => sink.pendingCard('question'))
    const typed = chat.send({ threadId: t.id, text: 'el discriminante', messageId: 'local-typed' })
    expect(typed.messageId).toBe('local-typed')
    await waitFor(() => model.callCount === 2)
    // mientras sigue respondiendo, otro mensaje va a la cola
    chat.send({ threadId: t.id, text: 'y otra cosa' })
    release?.()
    await chat.idle(t.id)
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['Ayúdame', 'el discriminante', 'y otra cosa'])
    expect(th.messages.find((m) => m.text === 'el discriminante')?.id).toBe('local-typed')
    expect(th.messages.at(-1)?.role).toBe('assistant')
    expect(th.messages[1].cards[0]).toMatchObject({ state: 'answered', answer: 'el discriminante' })
  })

  it('detener deja lo que llegó; «Continuar» sigue donde se cortó', async () => {
    const { root, lib } = setup()
    const model = new MockChatModel((req, i) => (i === 0 ? { eventsThenFail: [], error: new Error('nunca') } as Step : { events: reply({ text: 'Sigo: el vértice…' }) }))
    const hanging: ChatModel = {
      ...model,
      complete: async (r, o) => {
        if (model.callCount === 0) {
          model.requests.push(r)
          o?.onDelta?.({ type: 'text', text: 'Empiezo por' })
          await new Promise((_, reject) => o?.signal?.addEventListener('abort', () => reject(new AIError('cancelled', 'x', { code: 'cancelled' })), { once: true }))
        }
        return model.complete(r, o)
      }
    }
    const { chat, sink } = service(root, lib, hanging)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Explícame la parábola' })
    await waitFor(() => sink.messages.some((m) => m.message.text === 'Empiezo por'))
    chat.stop(t.id)
    expect(chat.isBusy(t.id)).toBe(false)
    let th = chat.thread(t.id)!
    expect(th.messages.map((m) => m.text)).toEqual(['Explícame la parábola', 'Empiezo por'])
    // J2-3: lo cortado con «Detener» queda como «Respuesta interrumpida» (en disco y en la interfaz), con «Continuar»
    expect(th.messages[1].interrupted).toBe(true)
    expect(new AssistantStore(join(root, 'Assistant')).thread(t.id)?.messages[1].interrupted).toBe(true)
    expect(sink.last(th.messages[1].id)?.interrupted).toBe(true)
    chat.continue(t.id, th.messages[1].id)
    await chat.idle(t.id)
    th = chat.thread(t.id)!
    expect(th.messages[1].interrupted).toBe(false)
    expect(th.messages.slice(2).map((m) => m.text)).toEqual(['Sigue donde lo dejaste.', 'Sigo: el vértice…'])
  })

  it('un fallo pasajero se reintenta solo una vez; otro error queda contado en la conversación', async () => {
    const { root, lib } = setup()
    const flaky = new MockChatModel([{ fail: new AIError('http', 'ocupado', { status: 503 }) }, { events: reply({ text: 'Ya está.' }) }])
    const a = service(root, lib, flaky)
    const t = a.chat.newThread()
    a.chat.send({ threadId: t.id, text: 'hola' })
    await waitFor(() => !a.chat.isBusy(t.id) && a.chat.thread(t.id)!.messages.length === 2)
    expect(a.chat.thread(t.id)!.messages.map((m) => [m.text, m.failed])).toEqual([['hola', false], ['Ya está.', false]])
    expect(a.sink.statuses.some((s) => s.label === 'Reintentando…')).toBe(true)
    // J2-10: el reintento sigue en la misma burbuja (la interfaz no se queda con una «Aula» vacía por intento)
    const replies = new Set(a.sink.messages.filter((m) => m.message.role === 'assistant').map((m) => m.message.id))
    expect(replies.size).toBe(1)
    const noKey = new MockChatModel([{ fail: new AIError('missingKey', 'no key') }])
    const b = service(root, lib, noKey)
    const t2 = b.chat.newThread()
    b.chat.send({ threadId: t2.id, text: 'hola' })
    await b.chat.idle(t2.id)
    const failed = b.chat.thread(t2.id)!.messages[1]
    expect(failed.failed).toBe(true)
    expect(failed.text).toContain('Falta la clave')
  })

  it('sin red (la capa HTTP ya reintentó): el error sale al momento y ocupa la burbuja vacía (J2-10)', async () => {
    const { root, lib } = setup()
    const down = new MockChatModel([{ fail: new AIError('network', 'fetch failed') }, { events: reply({ text: 'no debería llegar' }) }])
    const { chat, sink } = service(root, lib, down)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'hola' })
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages.map((m) => [m.role, m.failed])).toEqual([['user', false], ['assistant', true]])
    expect(down.callCount).toBe(1)
    expect(sink.statuses.some((s) => s.label === 'Reintentando…')).toBe(false)
    const ids = new Set(sink.messages.filter((m) => m.message.role === 'assistant').map((m) => m.message.id))
    expect([...ids]).toEqual([th.messages[1].id])
  })

  it('A3-P2-6: un permiso rechazado deja su paso como no hecho (también en disco y tras cortarse con el permiso pendiente)', async () => {
    const { root, lib } = setup()
    const flash = JSON.stringify({ course_id: 'demo-cuadraticas', skill_id: 'parabola', front: 'a', back: 'b' })
    const model = new MockChatModel([
      { events: reply({ calls: [{ id: 'k1', name: 'add_flashcard', args: flash }] }) },
      { events: reply({ text: 'Vale, no la guardo.' }) }
    ])
    const { chat, sink } = service(root, lib, model)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Guárdame una tarjeta' })
    const pending = await waitFor(() => sink.pendingCard('approval'))
    chat.answerCard({ threadId: t.id, messageId: pending.message.id, cardId: pending.card.id, approve: false })
    await chat.idle(t.id)
    const final = chat.thread(t.id)!.messages[1]
    expect(final.cards[0].state).toBe('denied')
    expect(final.steps[0]).toMatchObject({ tool: 'add_flashcard', declined: true })
    expect(new AssistantStore(join(root, 'Assistant')).thread(t.id)!.messages[1].steps[0].declined).toBe(true)
    // cortada con el permiso pendiente (Detener / cerrar la app): caduca y el paso tampoco cuenta como hecho
    const m = newMessage('assistant', '', { steps: [{ id: 's1', tool: 'add_calendar_event', label: 'Apuntar' }, { id: 's0', tool: 'list_courses', label: 'Cursos', ok: true }], cards: [newCard('approval', '¿Lo apunto?')] })
    expirePending(m)
    expect(m.cards[0].state).toBe('expired')
    expect(m.steps.map((s) => s.declined)).toEqual([true, undefined])
  })

  it('A3-P1-4: si la red se corta a mitad, la misma burbuja queda interrumpida con el motivo y «Continuar» sigue', async () => {
    const { root, lib } = setup()
    const cut = new MockChatModel([
      { eventsThenFail: [{ type: 'text', text: 'Un ángulo de ' }, { type: 'text', text: 'referencia' }], error: new AIError('network', 'fetch failed. The response was incomplete; try again.') },
      { events: reply({ text: ' es el ángulo agudo con el eje x.' }) }
    ])
    const { chat, sink } = service(root, lib, cut)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: '¿Qué es un ángulo de referencia?' })
    await chat.idle(t.id)
    let th = chat.thread(t.id)!
    // una sola respuesta: lo que llegó, marcado como interrumpido, con el motivo dentro (no otra burbuja de error)
    expect(th.messages.map((m) => [m.role, m.text, m.failed, m.interrupted])).toEqual([
      ['user', '¿Qué es un ángulo de referencia?', false, false],
      ['assistant', 'Un ángulo de referencia', false, true]
    ])
    expect(th.messages[1].notices.at(-1)).toContain('Se cortó la conexión a mitad')
    expect(new AssistantStore(join(root, 'Assistant')).thread(t.id)?.messages[1].interrupted).toBe(true)
    expect(sink.last(th.messages[1].id)?.interrupted).toBe(true)
    expect(new Set(sink.messages.filter((m) => m.message.role === 'assistant').map((m) => m.message.id)).size).toBe(1)
    // «Continuar» sigue desde ahí
    chat.continue(t.id, th.messages[1].id)
    await chat.idle(t.id)
    th = chat.thread(t.id)!
    expect(th.messages[1].interrupted).toBe(false)
    expect(th.messages.slice(2).map((m) => m.text)).toEqual(['Sigue donde lo dejaste.', 'es el ángulo agudo con el eje x.'])
    expect(cut.callCount).toBe(2)
  })

  it('A3-P1-4: un error que no es de red tras un trozo deja el trozo interrumpido y el error aparte', async () => {
    const { root, lib } = setup()
    const auth = new MockChatModel([{ eventsThenFail: [{ type: 'text', text: 'Empiezo' }], error: new AIError('missingKey', 'no key') }])
    const { chat } = service(root, lib, auth)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'hola' })
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages.map((m) => [m.text.slice(0, 7), m.failed, m.interrupted])).toEqual([['hola', false, false], ['Empiezo', false, true], ['Falta l', true, false]])
  })

  it('cerrar la app a mitad de respuesta la deja como interrumpida, con «Continuar» (J2-3)', async () => {
    const { root, lib } = setup()
    const hanging: ChatModel = {
      ...new MockChatModel([]),
      complete: async (_r, o) => {
        o?.onDelta?.({ type: 'text', text: 'A medias' })
        return new Promise((_, reject) => o?.signal?.addEventListener('abort', () => reject(new AIError('cancelled', 'x', { code: 'cancelled' })), { once: true }))
      }
    }
    const { chat, sink } = service(root, lib, hanging)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Explícame el seno' })
    await waitFor(() => sink.messages.some((m) => m.message.text === 'A medias'))
    chat.shutdown()
    const saved = new AssistantStore(join(root, 'Assistant')).thread(t.id)!
    expect(saved.messages.map((m) => [m.text, m.interrupted])).toEqual([['Explícame el seno', false], ['A medias', true]])
  })

  it('«Novedades de Aula»: se crea fijada y lo que llega mientras responde espera al final', async () => {
    const { root, lib } = setup()
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => { release = r })
    const model = new MockChatModel([{ events: reply({ text: 'Respuesta.' }) }])
    const slow: ChatModel = { ...model, complete: async (r, o) => { await gate; return model.complete(r, o) } }
    const { chat, sink } = service(root, lib, slow)
    const notice = newMessage('assistant', '1 asignación nueva: «Tarea 3»', { origin: { kind: 'automation', title: 'Revisar Canvas' } })
    const id = chat.postSystemMessage(UPDATES_THREAD, notice)
    expect(id).toBe(notice.id)
    const list = chat.threads()
    expect(list[0]).toMatchObject({ id: UPDATES_THREAD, title: 'Novedades de Aula', pinned: true })
    // otra conversación que no existe: va también a Novedades
    chat.postSystemMessage('no-existe', newMessage('assistant', 'otro'))
    expect(chat.thread(UPDATES_THREAD)!.messages).toHaveLength(2)
    // mientras responde en Novedades, el mensaje espera
    chat.send({ threadId: UPDATES_THREAD, text: '¿Qué tarea?' })
    chat.postSystemMessage(UPDATES_THREAD, newMessage('assistant', 'tercero'))
    expect(chat.thread(UPDATES_THREAD)!.messages.some((m) => m.text === 'tercero')).toBe(false)
    release?.()
    await chat.idle(UPDATES_THREAD)
    expect(chat.thread(UPDATES_THREAD)!.messages.map((m) => m.text).slice(-3)).toEqual(['¿Qué tarea?', 'Respuesta.', 'tercero'])
    expect(sink.messages.some((m) => m.message.text === 'tercero')).toBe(true)
  })

  it('el tutor: la conversación es del curso, lo cambiado es del tutor y las sugerencias siguen el contexto', async () => {
    const { root, lib } = setup()
    const model = new MockChatModel([{ events: reply({ text: 'Pista: mira el signo de $a$.' }) }])
    const { chat } = service(root, lib, model)
    const t = chat.newThread({ courseID: 'demo-cuadraticas', skillID: 'parabola' })
    expect(t.courseID).toBe('demo-cuadraticas')
    chat.send({ threadId: t.id, text: 'Dame una pista', context: { courseID: 'demo-cuadraticas', skillID: 'parabola', exerciseID: 'p-1', lastInput: 'x = 3' } })
    await chat.idle(t.id)
    const prompt = lastUser(model.requests[0])
    expect(prompt).toContain('## This course (you are its tutor)')
    expect(prompt).toContain('Their last answer: x = 3')
    expect(existsSync(join(lib.openPack('demo-cuadraticas')!.chatsDirectory, `${t.id}.json`))).toBe(true)
    expect(chat.threads().find((x) => x.id === t.id)?.courseID).toBe('demo-cuadraticas')
    expect(chat.suggestions({ courseID: 'demo-cuadraticas', exerciseID: 'x' })[0]).toBe('Dame una pista sin darme la respuesta')
    expect(chat.suggestions({ courseID: 'demo-cuadraticas', skillID: 'parabola' })[0]).toContain('La parábola y su gráfica')
    expect(chat.suggestions()[1]).toContain('Funciones cuadráticas')
    // un chat nuevo con un curso en el contexto pasa a ser del tutor
    const g = chat.newThread()
    chat.send({ threadId: g.id, text: 'hola', context: { courseID: 'demo-cuadraticas' } })
    await chat.idle(g.id)
    expect(chat.thread(g.id)!.courseID).toBe('demo-cuadraticas')
  })

  it('renombrar, fijar, borrar, menciones y citas', async () => {
    const { root, lib } = setup()
    const { chat } = service(root, lib, new MockChatModel([{ events: reply({ text: 'ok' }) }]))
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'hola' })
    await chat.idle(t.id)
    chat.rename(t.id, 'Mi conversación')
    chat.pin(t.id, true)
    expect(chat.threads().find((x) => x.id === t.id)).toMatchObject({ title: 'Mi conversación', pinned: true })
    const refs = await chat.mentionSearch('fórmula general')
    expect(refs[0]).toMatchObject({ kind: 'lesson', itemID: 'formula-general' })
    expect(chat.resolveCitation({ title: 'algo que no existe en ningún material' })).toBeNull()
    chat.delete(t.id)
    expect(chat.thread(t.id)).toBeNull()
    expect(chat.threads().some((x) => x.id === t.id)).toBe(false)
  })

  it('lo escrito mientras responde espera en cola: se ve, se puede quitar y lo que queda se envía junto al terminar', async () => {
    const { root, lib } = setup()
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => { release = r })
    const model = new MockChatModel((req) => ({ events: reply({ text: `ok: ${lastUser(req).split('\n').at(-2)}` }) }))
    const slow: ChatModel = { ...model, complete: async (r, o) => { if (model.callCount === 0) await gate; return model.complete(r, o) } }
    const { chat, sink } = service(root, lib, slow)
    const t = chat.newThread()
    expect(chat.send({ threadId: t.id, text: 'primero' }).queued).toBe(false)
    expect(chat.send({ threadId: t.id, text: 'segundo', messageId: 'local-2' })).toEqual({ messageId: 'local-2', queued: true })
    chat.send({ threadId: t.id, text: 'me arrepiento', messageId: 'local-3' })
    chat.send({ threadId: t.id, text: 'tercero', messageId: 'local-4' })
    expect(sink.queues.at(-1)?.queued).toEqual(['segundo', 'me arrepiento', 'tercero'])
    expect(chat.runState(t.id)?.queued.map((m) => m.id)).toEqual(['local-2', 'local-3', 'local-4'])
    // el «×» de la burbuja
    expect(chat.cancelQueued(t.id, 'local-3')).toBe(true)
    expect(chat.cancelQueued(t.id, 'local-3')).toBe(false)
    expect(sink.queues.at(-1)?.queued).toEqual(['segundo', 'tercero'])
    release?.()
    await chat.idle(t.id)
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['primero', 'segundo\n\ntercero'])
    expect(th.messages.at(-1)?.text).toBe('ok: tercero')
    // la interfaz recibe lo enviado en el mismo aviso que vacía la cola (con el id de su primera burbuja)
    const sent = sink.queues.find((q) => q.sent)
    expect(sent?.queued).toEqual([])
    expect(sent?.sent).toMatchObject({ id: 'local-2', text: 'segundo\n\ntercero' })
    expect(chat.runState(t.id)).toBeUndefined()
  })

  it('«Detener» para solo la respuesta en curso: lo que esperaba en cola se envía después; borrar la conversación lo descarta', async () => {
    const { root, lib } = setup()
    const model = new MockChatModel((req) => ({ events: reply({ text: `ok: ${lastUser(req).split('\n').at(-2)}` }) }))
    const hanging: ChatModel = {
      ...model,
      complete: async (r, o) => {
        if (model.callCount === 0) {
          model.requests.push(r)
          o?.onDelta?.({ type: 'text', text: 'Empiezo por' })
          await new Promise((_, reject) => o?.signal?.addEventListener('abort', () => reject(new AIError('cancelled', 'x', { code: 'cancelled' })), { once: true }))
        }
        return model.complete(r, o)
      }
    }
    const { chat, sink } = service(root, lib, hanging)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Explícame la parábola' })
    await waitFor(() => sink.messages.some((m) => m.message.text === 'Empiezo por'))
    chat.send({ threadId: t.id, text: 'mejor el vértice', messageId: 'local-q' })
    chat.stop(t.id)
    expect(chat.isBusy(t.id)).toBe(true)
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages.map((m) => [m.role, m.text])).toEqual([['user', 'Explícame la parábola'], ['assistant', 'Empiezo por'], ['user', 'mejor el vértice'], ['assistant', 'ok: mejor el vértice']])
    expect(th.messages[2].id).toBe('local-q')
    // borrar mientras responde: la cola no se envía
    const { chat: chat2, sink: sink2 } = service(root, lib, { ...hanging, complete: async (_r, o) => new Promise((_, reject) => o?.signal?.addEventListener('abort', () => reject(new AIError('cancelled', 'x', { code: 'cancelled' })), { once: true })) })
    const t2 = chat2.newThread()
    chat2.send({ threadId: t2.id, text: 'hola' })
    chat2.send({ threadId: t2.id, text: 'y adiós' })
    chat2.delete(t2.id)
    expect(chat2.isBusy(t2.id)).toBe(false)
    expect(sink2.queues.at(-1)?.queued).toEqual([])
  })

  it('un cuestionario guarda las respuestas y se guarda en el curso al pulsar', async () => {
    const { root, lib } = setup()
    const quiz = JSON.stringify({ title: 'Vértice', exercises: [{
      prompt: '¿Cuál es la coordenada $x$ del vértice de $f(x) = x^2 - 4x$?', answer: { kind: 'numeric', value: '2' }, level: 1,
      hints: ['Usa $x_v = -b/(2a)$.', 'Aquí $a = 1$ y $b = -4$.'], solution: '$x_v = -(-4)/(2 \\cdot 1) = 2$.'
    }] })
    const model = new MockChatModel((req, i) => (i === 0 ? { events: reply({ calls: [{ id: 'z1', name: 'make_quiz', args: quiz }] }) } : { events: reply({ text: 'Ahí lo tienes.' }) }))
    const { chat, sink } = service(root, lib, model)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Ponme un test' })
    await chat.idle(t.id)
    const m = chat.thread(t.id)!.messages[1]
    const card = m.cards.find((c) => c.kind === 'quiz')
    expect(card?.studySet?.exercises).toHaveLength(1)
    const eid = card!.studySet!.exercises[0].id
    chat.answerCard({ threadId: t.id, messageId: m.id, cardId: card!.id, answer: JSON.stringify({ results: { [eid]: true }, inputs: { [eid]: '2' }, save: { courseID: 'demo-cuadraticas', skillID: 'parabola' } }) })
    const saved = chat.thread(t.id)!.messages[1].cards.find((c) => c.id === card!.id)!.studySet!
    expect(saved.results[eid]).toBe(true)
    expect(saved.savedTo).toBeTruthy()
    expect(sink.last(m.id)?.cards.find((c) => c.id === card!.id)?.studySet?.savedTo).toBe(saved.savedTo)
    expect(lib.openPack('demo-cuadraticas')!.loadSkill('parabola').exercises.some((e) => e.id.startsWith('parabola-aula-'))).toBe(true)
    expect(lib.history!.groups().some((g) => g.kind === 'chat' && g.courseID === 'demo-cuadraticas')).toBe(true)
  })

  it('la IA simulada (AULA_FAKE_AI) responde como Aula: mira tus cursos y escribe con un bloque visual', async () => {
    const { root, lib } = setup()
    const { chat, sink } = service(root, lib, streamingFake(createFakeModel(), 1))
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: '¿Qué es una parábola?' })
    await chat.idle(t.id)
    const answer = chat.thread(t.id)!.messages[1]
    expect(answer.steps[0]).toMatchObject({ tool: 'list_courses', ok: true })
    // cada paso lleva lo que buscó o calculó (de los argumentos de la herramienta)
    expect(answer.steps.find((s) => s.tool === 'find_items')).toMatchObject({ detail: '¿Qué es una parábola?', ok: true })
    expect(answer.steps.find((s) => s.tool === 'calculate')).toMatchObject({ detail: '2^2 - 4', ok: true })
    expect(answer.text).toContain('```aula-block')
    expect(answer.text).toContain('tienes 2 cursos')
    expect(messageParts(answer.text).some((p) => p.kind === 'block')).toBe(true)
    expect(sink.messages.filter((m) => m.message.id === answer.id).length).toBeGreaterThan(3)
    expect(fakeChunks(fakeAnswer('x', 1)).join('')).toBe(fakeAnswer('x', 1))
  })

  it('la IA simulada crea un test o unas tarjetas de verdad cuando se le piden, y nombra lo mencionado con «@»', async () => {
    expect(fakeIntent('Ponme un test rápido')).toBe('quiz')
    expect(fakeIntent('Hazme unas TARJETAS')).toBe('flashcards')
    expect(fakeIntent('¿Qué es una parábola?')).toBe('answer')
    const { root, lib } = setup()
    const { chat } = service(root, lib, streamingFake(createFakeModel(), 1))
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Ponme un test rápido' })
    await chat.idle(t.id)
    const quiz = chat.thread(t.id)!.messages[1]
    const card = quiz.cards.find((c) => c.kind === 'quiz')
    expect(card?.studySet?.exercises.map((e) => e.answer.kind)).toEqual(['choice', 'numeric'])
    expect(quiz.text).not.toContain('```')
    chat.send({ threadId: t.id, text: 'Y ahora unas tarjetas' })
    await chat.idle(t.id)
    const cards = chat.thread(t.id)!.messages[3].cards.find((c) => c.kind === 'flashcards')
    expect(cards?.studySet?.cards.map((c) => c.kind)).toEqual(['basic', 'cloze', 'basic'])
    chat.send({ threadId: t.id, text: 'Explícame esto', mentions: [{ kind: 'lesson', courseID: 'demo-cuadraticas', itemID: 'parabola', title: 'La parábola' }] })
    await chat.idle(t.id)
    const th = chat.thread(t.id)!
    expect(th.messages[4].mentions[0]).toMatchObject({ kind: 'lesson', itemID: 'parabola' })
    expect(th.messages[5].text).toMatch(/Lo que mencionaste: «[^»]+»/)
  })
})
