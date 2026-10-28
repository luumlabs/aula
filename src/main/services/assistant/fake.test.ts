// La IA simulada (`AULA_FAKE_AI=1`, pruebas y modo demostración) hace lo que haría Aula: con «I have an English test on Monday at
// 10» mira el calendario, propone el evento con tu OK y ofrece el curso; con trigonometría busca en los materiales y los cita; en el
// tutor da la primera pista del ejercicio sin la respuesta. Y todo en el idioma de la interfaz.
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AssistantCalendar, AssistantCalendarEvent, AssistantEventDraft } from '@engine/calendar'
import { setAILocale } from '@shared/ai/i18n'
import type { AssistantCard, AssistantMessage } from '@shared/assistant/types'
import { createFakeModel } from '../ai/fake'
import { Library } from '../store/library'
import { streamingFake } from './fake'
import { fakeCourseTitle, fakeEvent, fakeIntent, fakeMistake, isTrig } from './fakeScripts'
import type { AssistantCourseSpec, CourseTeam } from './host'
import { AssistantService, type AssistantSink } from './service'

const dirs: string[] = []
beforeEach(() => setAILocale('en'))
afterEach(() => {
  setAILocale('es')
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

class Sink implements AssistantSink {
  messages: AssistantMessage[] = []
  message(_t: string, m: AssistantMessage): void { this.messages.push(structuredClone(m)) }
  threads(): void {}
  status(): void {}
  pending(kind: AssistantCard['kind'], title?: RegExp): { message: AssistantMessage; card: AssistantCard } | undefined {
    for (const m of [...this.messages].reverse()) {
      const c = m.cards.find((x) => x.kind === kind && x.state === 'pending' && (!title || title.test(x.title)))
      if (c) return { message: m, card: c }
    }
    return undefined
  }
}

async function waitFor<T>(fn: () => T | undefined, ms = 5000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - start > ms) throw new Error('tiempo agotado')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Una carpeta de datos con el curso de ejemplo real («Exam #2 · MATH 101», con sus tres materiales). */
function setup(): { root: string; lib: Library } {
  const root = mkdtempSync(join(tmpdir(), 'aula-fake-'))
  dirs.push(root)
  cpSync(resolve(__dirname, '../../../../resources/demo-course/Packs'), join(root, 'Packs'), { recursive: true })
  return { root, lib: new Library(root) }
}

function memoryCalendar(): AssistantCalendar & { added: AssistantCalendarEvent[] } {
  const added: AssistantCalendarEvent[] = []
  return {
    added,
    events: async () => added,
    addEvent: async (d: AssistantEventDraft) => {
      const e: AssistantCalendarEvent = { id: `e${added.length + 1}`, title: d.title, start: d.start, allDay: d.allDay ?? false, kind: d.kind ?? 'other', source: 'aula', editable: true, isTask: false, done: false, reminders: d.reminders ?? [] }
      added.push(e)
      return e
    },
    updateEvent: async () => { throw new Error('no') },
    deleteEvent: async () => undefined,
    setTaskDone: async () => undefined
  }
}

function service(root: string, lib: Library, extra: Partial<ConstructorParameters<typeof AssistantService>[0]> = {}): { chat: AssistantService; sink: Sink } {
  const sink = new Sink()
  const chat = new AssistantService({
    root, library: () => lib, sink, model: async () => streamingFake(createFakeModel(), 1), memory: () => undefined,
    settings: () => ({ appLanguage: 'en', dailyMinutes: 45, allowWeb: false }), throttleMs: 5, partialMs: 20, retryDelayMs: 1, ...extra
  })
  return { chat, sink }
}

describe('guiones de la IA simulada', () => {
  it('distingue un examen con fecha, un curso, un test, una pista y una pregunta', () => {
    expect(fakeIntent('I have an English test on Monday at 10')).toBe('event')
    expect(fakeIntent('El lunes tengo prueba de inglés a las 10')).toBe('event')
    expect(fakeIntent('Make me a course on organic chemistry')).toBe('course')
    expect(fakeIntent('Quiz me on exact values')).toBe('quiz')
    expect(fakeIntent('Ponme un test rápido')).toBe('quiz')
    expect(fakeIntent('Give me a hint, not the answer')).toBe('hint')
    expect(fakeIntent('Explain why my answer isn’t right. Don’t give me the full solution yet.')).toBe('mistake')
    expect(fakeIntent('Explícame por qué mi respuesta no es correcta.')).toBe('mistake')
    expect(fakeIntent('Explain my mistake')).toBe('mistake')
    expect(fakeIntent('Why is cos 210° negative?')).toBe('answer')
    expect(isTrig('Why is cos 210° negative?')).toBe(true)
    expect(isTrig('Quiz me on exact values')).toBe(true)
    expect(isTrig('Hazlo sin prisa, tan fácil como puedas')).toBe(false)
    expect(fakeCourseTitle('Make me a course on organic chemistry')).toBe('Organic chemistry')
  })

  it('lee el examen: título, el próximo lunes (no hoy) y la hora', () => {
    const monday = new Date(2026, 9, 26, 19, 40)
    expect(fakeEvent('I have an English test on Monday at 10', monday)).toEqual({ title: 'English test', subject: 'English', kind: 'exam', start: '2026-11-02T10:00', allDay: false })
    expect(fakeEvent('Tengo prueba de inglés el jueves a las 9:30', monday)).toMatchObject({ title: 'Prueba de inglés', subject: 'Inglés', start: '2026-10-29T09:30' })
    expect(fakeEvent('my chemistry quiz is tomorrow at 3', monday)).toMatchObject({ title: 'Chemistry quiz', kind: 'quiz', start: '2026-10-27T15:00' })
    expect(fakeEvent('the final is on Friday', monday)).toMatchObject({ start: '2026-10-30', allDay: true })
    expect(fakeEvent('what is a sine?', monday)).toBeUndefined()
  })
})

describe('la IA simulada en el chat', () => {
  it('«I have an English test on Monday at 10»: calendario → evento con tu OK → «¿te preparo un curso?» → el curso', async () => {
    const { root, lib } = setup()
    const calendar = memoryCalendar()
    const specs: AssistantCourseSpec[] = []
    const team: CourseTeam = {
      create: async (spec) => { specs.push(spec); return { courseID: 'english-test', title: spec.title, phase: 'running', fraction: 0, status: 'Preparing', searchesPlatform: false, isExtend: false } },
      extend: async () => { throw new Error('no') }
    }
    const { chat, sink } = service(root, lib, { calendar: () => calendar, team: () => team })
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'I have an English test on Monday at 10' })
    const ev = await waitFor(() => sink.pending('approval', /calendar/i))
    expect(ev.card.facts.map((f) => f.value)).toContain('English test')
    expect(ev.message.steps.map((s) => s.tool)).toEqual(['list_courses', 'calendar_events', 'add_calendar_event'])
    chat.answerCard({ threadId: t.id, messageId: ev.message.id, cardId: ev.card.id, approve: true })
    const q = await waitFor(() => sink.pending('question'))
    expect(q.card.title).toBe('Shall I prepare a course for “English test”?')
    chat.answerCard({ threadId: t.id, messageId: q.message.id, cardId: q.card.id, optionId: q.card.options[0].id })
    const create = await waitFor(() => sink.pending('approval', /course/i))
    chat.answerCard({ threadId: t.id, messageId: create.message.id, cardId: create.card.id, approve: true })
    await chat.idle(t.id)
    expect(calendar.added).toHaveLength(1)
    expect(calendar.added[0]).toMatchObject({ title: 'English test', kind: 'exam', allDay: false })
    expect(calendar.added[0].start.getDay()).toBe(1)
    expect(calendar.added[0].start.getHours()).toBe(10)
    expect(specs[0]).toMatchObject({ title: 'English test', subject: 'English', depth: 'quick' })
    const last = chat.thread(t.id)!.messages.at(-1)!
    expect(last.text).toMatch(/is in your calendar and I'm already preparing the course/)
    // nada en español con la interfaz en inglés
    expect(sink.messages.map((m) => m.text + m.cards.map((c) => c.title + c.facts.map((f) => f.label + f.value).join('')).join('')).join('\n')).not.toMatch(/[¿¡]|\b(curso|calendario|examen|prepáralo)\b/i)
  })

  it('con «Not now» se queda en el calendario sin curso', async () => {
    const { root, lib } = setup()
    const calendar = memoryCalendar()
    const team: CourseTeam = { create: async () => { throw new Error('no debía crear') }, extend: async () => { throw new Error('no') } }
    const { chat, sink } = service(root, lib, { calendar: () => calendar, team: () => team })
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'I have an English test on Monday at 10' })
    const ev = await waitFor(() => sink.pending('approval'))
    chat.answerCard({ threadId: t.id, messageId: ev.message.id, cardId: ev.card.id, approve: true })
    const q = await waitFor(() => sink.pending('question'))
    chat.answerCard({ threadId: t.id, messageId: q.message.id, cardId: q.card.id, optionId: q.card.options[1].id })
    await chat.idle(t.id)
    expect(calendar.added).toHaveLength(1)
    expect(chat.thread(t.id)!.messages.at(-1)!.text).toMatch(/is in your calendar\. If you want to prepare for it later/)
  })

  it('una pregunta de trigonometría: busca en los materiales del curso, los cita y dibuja la gráfica', async () => {
    const { root, lib } = setup()
    const { chat } = service(root, lib)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Why is cos 210° negative?' })
    await chat.idle(t.id)
    const answer = chat.thread(t.id)!.messages[1]
    expect(answer.steps.map((s) => s.tool)).toEqual(['list_courses', 'search_course_materials'])
    expect(answer.text).toContain('```aula-block')
    expect(answer.text).toMatch(/\(Source: (Unit 3 lecture notes|Exam 2 review sheet|Textbook · Section 4\.2 The unit circle), p\. \d\)/)
    expect(answer.citations?.length).toBeGreaterThan(0)
  })

  it('«Quiz me on exact values»: un test de trigonometría (cos 210°)', async () => {
    const { root, lib } = setup()
    const { chat } = service(root, lib)
    const t = chat.newThread()
    chat.send({ threadId: t.id, text: 'Quiz me on exact values' })
    await chat.idle(t.id)
    const quiz = chat.thread(t.id)!.messages[1].cards.find((c) => c.kind === 'quiz')
    expect(quiz?.title).toBe('Exact values · 3 questions')
    expect(JSON.stringify(quiz?.studySet)).toContain('cos 210')
  })

  it('en el tutor, «Give me a hint» da la primera pista del ejercicio y no la respuesta', async () => {
    const { root, lib } = setup()
    const { chat } = service(root, lib)
    const context = { courseID: 'exam-2-math112', skillID: 'exact-trig-values', exerciseID: 'etv-e5', screen: 'practice' }
    const t = chat.newThread(context)
    chat.send({ threadId: t.id, text: 'Give me a hint, not the answer', context })
    await chat.idle(t.id)
    const answer = chat.thread(t.id)!.messages[1]
    expect(answer.steps.map((s) => s.tool)).toContain('get_exercise')
    expect(answer.text).toContain('In which quadrant is')
    expect(answer.text).not.toMatch(/sqrt|√3/)
  })

  it('en el tutor, «Explain my mistake» lee el ejercicio y explica el porqué de lo que respondió', async () => {
    const { root, lib } = setup()
    const { chat } = service(root, lib)
    const context = { courseID: 'exam-2-math112', skillID: 'exact-trig-values', exerciseID: 'etv-e3', screen: 'practice', lastInput: '√3/2', lastResult: 'wrong' }
    const t = chat.newThread(context)
    chat.send({ threadId: t.id, text: 'Explain why my answer isn’t right. Don’t give me the full solution yet.', context })
    await chat.idle(t.id)
    const answer = chat.thread(t.id)!.messages[1]
    expect(answer.steps.map((s) => s.tool)).toContain('get_exercise')
    expect(answer.text).toContain('You answered **√3/2**')
    expect(answer.text).toContain('Right size, wrong sign')
    expect(answer.text).toContain('A nudge for your next try')
  })

  it('sin un ejercicio delante, «explain my mistake» es una pregunta normal', () => {
    expect(fakeMistake({}, undefined, undefined)).toContain("Reread what it's asking")
    expect(fakeMistake({ wrongs: [{ input: '-4', why: 'Amplitude is $|A|$.' }], hints: ['A distance.'] }, ' -4 ')).toContain('> Amplitude is $|A|$.')
  })
})

describe('equipo simulado', () => {
  it('pone una asignatura creíble (no «Mathematics» a todo) y vacía si no se sabe', async () => {
    const { fakeSubject } = await import('../pipeline/fakeTeam')
    expect(fakeSubject({ title: 'AWS Cloud Practitioner', topics: '', language: 'en' })).toBe('Computing')
    expect(fakeSubject({ title: 'Exam #2 · MATH 101', topics: 'Reference angles, Exact values', language: 'en' })).toBe('Mathematics')
    expect(fakeSubject({ title: 'Parcial de Química', topics: '', language: 'es' })).toBe('Química')
    expect(fakeSubject({ title: 'Mi curso', topics: '', language: 'es' })).toBe('')
  })
})
