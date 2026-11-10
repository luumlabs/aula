import { describe, expect, it, vi } from 'vitest'
import type { Automation, PrepareCandidate } from '@shared/automations'
import type { PackSummary } from '@shared/schema/library'
import type { AutomationStudio } from './env'
import type { RoutineEvent } from './routines'
import { automationTools, RunLog } from './tools'

const pack = { id: 'calculo', title: 'Cálculo I', icon: 'math', hue: 0.6 } as unknown as PackSummary
const quiz: RoutineEvent = { id: 'ev-prueba', title: 'Prueba de límites', kind: 'quiz', start: new Date('2026-11-11T15:00:00Z'), allDay: false, packID: 'calculo' }
const task: RoutineEvent = { id: 'ev-entrega', title: 'Práctica 3', kind: 'assignment', start: new Date('2026-11-13T23:00:00Z'), allDay: false, url: 'https://canvas.example/a/3', course: 'FIS 101' }
const candidates: PrepareCandidate<RoutineEvent>[] = [{ event: quiz, kind: 'review', packID: 'calculo', hoursLeft: 23 }, { event: task, kind: 'guide', hoursLeft: 79 }]
const automation = { id: 'routine-prepareAhead', title: 'Adelantar trabajo', capabilities: ['calendar', 'courses', 'study', 'prepare'], routine: 'prepareAhead' } as unknown as Automation
const GUIDE = '## Qué piden\n' + 'Resolver los problemas del tema de dinámica explicando cada paso. '.repeat(6)

function setup(studio: AutomationStudio | null, list = candidates) {
  const log = new RunLog()
  const tools = automationTools({ automation, log, events: [quiz, task], study: null, packs: [pack], platforms: null, accounts: [], tab: 't', now: new Date('2026-11-10T16:00:00Z'), studio, candidates: list })
  const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const tool = tools.find((t) => t.name === name)!
    const r = await tool.run(args as never, { signal: new AbortController().signal } as never)
    return JSON.parse(typeof r === 'string' ? r : (r as { text: string }).text) as Record<string, unknown>
  }
  return { log, tools, call }
}

describe('herramientas para adelantar trabajo', () => {
  it('solo existen en la rutina que adelanta y cuando hay algo cerca', () => {
    expect(setup({ createReview: vi.fn(), saveGuide: vi.fn() }).tools.map((t) => t.name)).toEqual(expect.arrayContaining(['prepare_review', 'save_guide']))
    expect(setup({ createReview: vi.fn(), saveGuide: vi.fn() }, []).tools.map((t) => t.name)).not.toContain('prepare_review')
  })

  it('prepare_review lanza el repaso en el curso del evento, una sola vez, y deja la tarjeta para abrirlo', async () => {
    const createReview = vi.fn(async () => ({ runID: 'run-1' }))
    const { log, call } = setup({ createReview, saveGuide: vi.fn() })
    expect((await call('prepare_review', { event_id: 'otro', title: 'x', instruction: 'y' })).ok).toBe(false)
    expect((await call('prepare_review', { event_id: 'ev-entrega', title: 'x', instruction: 'y' })).ok).toBe(false)
    const ok = await call('prepare_review', { event_id: 'ev-prueba', title: 'Repaso para la prueba de mañana', instruction: 'Límites laterales y continuidad; 8 ejercicios tipo examen.', why: 'la prueba es mañana' })
    expect(ok.ok).toBe(true)
    expect(createReview).toHaveBeenCalledWith({ courseID: 'calculo', instruction: expect.stringContaining('Límites laterales') })
    expect(log.prepared).toEqual(['ev-prueba'])
    expect(log.created[0]).toContain('Cálculo I')
    expect(log.cards[0].actions[0]).toMatchObject({ kind: 'open', prominent: true, ref: { courseID: 'calculo' } })
    expect((await call('prepare_review', { event_id: 'ev-prueba', title: 'otra vez', instruction: 'x' })).ok).toBe(false)
    expect(createReview).toHaveBeenCalledTimes(1)
  })

  it('si la tubería falla, no se da por preparado', async () => {
    const { log, call } = setup({ createReview: vi.fn(async () => { throw new Error('sin IA') }), saveGuide: vi.fn() })
    expect(await call('prepare_review', { event_id: 'ev-prueba', title: 't', instruction: 'i' })).toMatchObject({ ok: false, error: 'sin IA' })
    expect(log.prepared).toEqual([])
  })

  it('save_guide exige una guía de verdad; sin curso de Aula la entrega entera en el mensaje', async () => {
    const saveGuide = vi.fn(async () => ({ docKey: 'saved:calculo:abc' }))
    const { log, call } = setup({ createReview: vi.fn(), saveGuide })
    expect((await call('save_guide', { event_id: 'ev-entrega', title: 'Guía', markdown: 'muy corta' })).ok).toBe(false)
    const r = await call('save_guide', { event_id: 'ev-entrega', title: 'Guía para la Práctica 3', markdown: GUIDE })
    expect(r).toMatchObject({ ok: true, saved: false })
    expect(saveGuide).not.toHaveBeenCalled()
    expect(log.guides).toEqual([{ title: 'Guía para la Práctica 3', markdown: GUIDE.trim() }])
    expect(log.prepared).toEqual(['ev-entrega'])
    expect(log.cards[0].actions.map((a) => a.kind)).toEqual(['openURL', 'ask'])
  })

  it('con curso, la guía se guarda en sus documentos y la tarjeta la abre', async () => {
    const saveGuide = vi.fn(async () => ({ docKey: 'saved:calculo:abc' }))
    const withCourse: PrepareCandidate<RoutineEvent>[] = [{ event: { ...task, packID: 'calculo' }, kind: 'guide', packID: 'calculo', hoursLeft: 79 }]
    const { log, call } = setup({ createReview: vi.fn(), saveGuide }, withCourse)
    expect(await call('save_guide', { event_id: 'ev-entrega', title: 'Guía', markdown: GUIDE })).toMatchObject({ ok: true, saved: true })
    expect(saveGuide).toHaveBeenCalledWith({ courseID: 'calculo', title: 'Guía', markdown: GUIDE.trim() })
    expect(log.guides).toEqual([])
    expect(log.cards[0].actions[0]).toMatchObject({ kind: 'openDocument', value: 'saved:calculo:abc', prominent: true })
  })
})
