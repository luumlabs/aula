import { describe, expect, it } from 'vitest'
import type { AssistantStep } from '@shared/assistant/types'
import { activityKind, isGenericStatus, quizQuestions, replyPhase, summarize, thinkingKey } from './activityKinds'

const step = (tool: string, more: Partial<AssistantStep> = {}): AssistantStep => ({ id: Math.random().toString(36), tool, label: tool, ok: true, ...more })

describe('activity', () => {
  it('clasifica las herramientas', () => {
    expect(activityKind('search_course_materials')).toBe('materials')
    expect(activityKind('mcp__aula__make_flashcards')).toBe('cards')
    expect(activityKind('memory_search')).toBe('memory')
    expect(activityKind('platform_read')).toBe('platform')
    expect(activityKind('algo_nuevo')).toBe('other')
  })

  it('resume por clases en el orden en que empezaron', () => {
    const { parts, failed } = summarize([
      step('read_course_material', { detail: 'Tema 3' }), step('search_course_materials', { detail: 'vértice' }), step('read_course_material', { detail: 'Tema 3' }),
      step('make_flashcards', { count: 5 }), step('ask_user'), step('calculate', { ok: false })
    ])
    expect(parts).toEqual([{ kind: 'materials', count: 2 }, { kind: 'cards', count: 5 }])
    expect(failed).toBe(1)
  })

  it('A3-P2-6: lo rechazado no cuenta como hecho ni como fallo', () => {
    const { parts, failed } = summarize([step('list_courses'), step('calendar_events'), step('add_calendar_event', { declined: true })])
    expect(parts).toEqual([{ kind: 'courses', count: 1 }, { kind: 'calendar', count: 1 }])
    expect(failed).toBe(0)
    expect(summarize([step('add_calendar_event', { ok: undefined, declined: true })]).parts).toEqual([])
    expect(replyPhase([step('add_calendar_event', { ok: undefined, declined: true })], true, true)).toBe('writing')
  })

  it('cuenta las preguntas de un cuestionario', () => {
    expect(quizQuestions([step('make_quiz', { count: 4 })])).toBe(4)
    expect(quizQuestions([step('make_quiz', { count: 4 }), step('make_quiz')])).toBeUndefined()
  })

  it('sabe en qué fase está la respuesta', () => {
    expect(replyPhase([], false, true)).toBe('thinking')
    expect(replyPhase([step('x', { ok: undefined })], true, true)).toBe('tools')
    expect(replyPhase([step('x')], false, true)).toBe('tools')
    expect(replyPhase([step('x')], true, true)).toBe('writing')
    expect(replyPhase([], true, false)).toBe('done')
  })

  it('elige la frase de «pensando» por el tiempo', () => {
    expect(thinkingKey(200, false)).toBe('reading')
    expect(thinkingKey(3000, false)).toBe('thinking')
    expect(thinkingKey(9000, false)).toBe('deeper')
    expect(thinkingKey(30_000, false)).toBe('long')
    expect(thinkingKey(1000, true)).toBe('composing')
    expect(isGenericStatus('Pensando…')).toBe(true)
    expect(isGenericStatus('Thinking...')).toBe(true)
    expect(isGenericStatus('Leyendo lo que adjuntaste…')).toBe(false)
  })
})
