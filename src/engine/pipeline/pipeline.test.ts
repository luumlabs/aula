// Piezas puras de la generación: la auditoría de una habilidad, el enlace de «Pruébalo», los papeles de la interfaz y el
// avance de una ejecución.
import { describe, expect, it } from 'vitest'
import { makeSkill, type Block, type Exercise, type Skill } from '@shared/schema'
import { auditSkill, linkPractice } from './audit'
import { inferredRunState, makeRequest, newRunID, newRunState, prepareForResume, runProgress, uiRoleFor } from './model'

function ex(id: string, level: number): Exercise {
  return { id, skill: 's', level, prompt: [{ type: 'text', md: 'x' }], answer: { kind: 'numeric', value: '1' }, hints: [], solution: [], wrongs: [], tags: [] } as unknown as Exercise
}

function block(id: string, type: string): Block {
  switch (type) {
    case 'example': return { id, type: 'example', problem: 'p', steps: [], answer: 'a' } as unknown as Block
    case 'recap': return { id, type: 'recap', points: ['a'] } as unknown as Block
    case 'tryit': return { id, type: 'tryit', exerciseIDs: ['nope'], inline: [] } as unknown as Block
    default: return { id, type: 'text', md: 't' } as unknown as Block
  }
}

function skill(lesson: string[], exercises: Exercise[], cards = 0): Skill {
  const s = makeSkill({ id: 's', title: 'S' })
  return { ...s, lesson: lesson.map((t, i) => block(`b${i}`, t)), exercises, cards: Array.from({ length: cards }, (_, i) => ({ id: `c${i}`, kind: 'basic', front: 'f', back: 'b', tags: [] })) as unknown as Skill['cards'] }
}

describe('auditoría y práctica', () => {
  it('pide los mínimos de la profundidad y un ejemplo resuelto', () => {
    const p = auditSkill(skill(['text', 'text'], [ex('e1', 1)], 0), 'quick', [], 'es')
    const ai = p.map((x) => x.forAI).join('\n')
    expect(ai).toContain('only 2 blocks')
    expect(ai).toContain('worked `example`')
    expect(ai).toContain('write at least 6 exercises')
    expect(ai).toContain('write at least 4')
    expect(p[0].forUser).toMatch(/lección es corta/)
    expect(auditSkill(undefined, 'quick', [], 'en')[0].forUser).toBe('It has no content yet.')
  })

  it('una habilidad que cumple no tiene problemas; un error del validador sí', () => {
    const ok = skill(['text', 'text', 'example', 'text', 'text', 'recap'], Array.from({ length: 6 }, (_, i) => ex(`e${i}`, 1 + (i % 3))), 4)
    expect(auditSkill(ok, 'quick', [], 'es')).toEqual([])
    expect(auditSkill(ok, 'quick', [{ severity: 'error', path: 'lesson[0]', message: 'LaTeX roto' }], 'es')[0].forAI).toBe('lesson[0]: LaTeX roto')
  })

  it('«Pruébalo» tras el primer ejemplo y «Compruébalo» antes del resumen, con ejercicios reales', () => {
    const s = skill(['text', 'example', 'text', 'tryit', 'text', 'recap'], [ex('e1', 1), ex('e2', 1), ex('e3', 2), ex('e4', 2), ex('e5', 3), ex('e6', 3)])
    const linked = linkPractice(s, 'es')
    const types = linked.lesson.map((b) => b.type)
    // el «Pruébalo» que apuntaba a un ejercicio inexistente desaparece
    expect(types).toEqual(['text', 'example', 'tryit', 'text', 'text', 'tryit', 'recap'])
    const tries = linked.lesson.filter((b): b is Extract<Block, { type: 'tryit' }> => b.type === 'tryit')
    expect(tries[0].title).toBe('Pruébalo')
    expect(tries[0].exerciseIDs).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(tries[1].exerciseIDs).toEqual(['e5', 'e6'])
    // si ya hay uno válido no se toca
    expect(linkPractice(linked, 'es').lesson).toEqual(linked.lesson)
  })
})

describe('registro de la ejecución', () => {
  const now = new Date(2026, 9, 26, 9, 5, 7)

  it('ids con el formato de Swift', () => {
    expect(newRunID(now, 'abc')).toBe('run-20261026-090507-abc')
  })

  it('el avance pondera las etapas y nunca llega a 1 sin terminar', () => {
    const s = newRunState('run-x', makeRequest({ packID: 'p', title: 'T' }), now)
    expect(runProgress(s, false, 0)).toBe(0)
    s.stages.prepare = 'done'; s.stages.gather = 'skipped'; s.stages.plan = 'done'; s.stages.author = 'running'
    s.skills = [{ id: 'a', title: 'A', status: 'done', attempts: 1, note: '', openIssues: 0 }, { id: 'b', title: 'B', status: 'pending', attempts: 0, note: '', openIssues: 0 }]
    const mid = runProgress(s, false, 0)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.6)
    for (const g of ['author', 'crossCutting', 'verify', 'polish'] as const) s.stages[g] = 'done'
    expect(runProgress(s, false, 2)).toBe(0.99)
    expect(runProgress(s, true, 2)).toBe(1)
  })

  it('al reanudar, lo que estaba a medias vuelve a empezar; sin estado y sin terminar = en pausa', () => {
    const s = newRunState('run-x', makeRequest({ packID: 'p', title: 'T' }), now)
    s.stages.author = 'running'
    s.skills = [{ id: 'a', title: 'A', status: 'verifying', attempts: 1, note: '', openIssues: 0 }, { id: 'b', title: 'B', status: 'repairing', attempts: 2, note: '', openIssues: 1 }]
    s.aula2.lanes = [{ id: 'l', role: 'author', uiRole: 'lesson', stage: 'author', title: 'x', current: '', status: 'working', steps: 1, provider: 'p', startedAt: now.toISOString() }]
    s.failure = 'x'; s.finishedAt = now.toISOString(); s.aula2.state = 'failed'
    const r = prepareForResume(s)
    expect(r.stages.author).toBe('pending')
    expect(r.skills.map((k) => k.status)).toEqual(['done', 'pending'])
    expect(r.aula2.lanes[0].status).toBe('done')
    expect(r.failure).toBeUndefined()
    expect(inferredRunState(r, false)).toBe('paused')
    expect(inferredRunState(r, true)).toBe('running')
    expect(inferredRunState({ ...r, aula2: { ...r.aula2, state: 'running' } }, false)).toBe('paused')
  })

  it('papeles de la interfaz', () => {
    expect(uiRoleFor('author', { part: 'practice' })).toBe('exercises')
    expect(uiRoleFor('author', { part: 'lesson' })).toBe('lesson')
    expect(uiRoleFor('crossCutting', { cross: 'formulasAndBlueprint' })).toBe('formulas')
    expect(uiRoleFor('adjudicator')).toBe('arbiter')
    expect(uiRoleFor('extender', { instruction: 'Más tarjetas' })).toBe('cards')
    expect(uiRoleFor('extender', { instruction: 'Prepara ejercicios nuevos' })).toBe('exercises')
  })
})
