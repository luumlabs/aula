// Qué enseña Aprender de un tema según cómo va la creación (o la ampliación) del curso.
import { describe, expect, it } from 'vitest'
import { emptyProgress, makePack, makeSkill, makeSkillRef, skillCounts, type ContentStatus, type Skill } from '@shared/schema'
import type { CreationPhase } from '@engine/study/topics'
import { exercise, text } from '@engine/study/testutil'
import type { CourseData } from '../data'
import { lessonGate, openableLessons, pickLesson } from './lessonGate'

function topic(id: string, status: ContentStatus, o: { lesson?: boolean; exercises?: number } = {}): Skill {
  const s = makeSkill({ id, title: id, status })
  if (o.lesson) s.lesson = [text('Una idea.')]
  s.exercises = Array.from({ length: o.exercises ?? 0 }, (_, i) => exercise(`${id}-e${i}`, i, ['suma'], id))
  return s
}

function course(skills: Skill[]): CourseData {
  const pack = makePack({ id: 'p', title: 'P' })
  pack.skills = skills.map((s, i) => makeSkillRef({ id: s.id, title: s.title, order: i, status: s.status, counts: skillCounts(s) }))
  return { pack, skills, progress: emptyProgress(), demo: false }
}

/** La puerta para un tema del curso. */
function gate(data: CourseData, id: string, phase: CreationPhase, o: { writing?: string; active?: boolean } = {}) {
  const skill = data.skills.find((s) => s.id === id)
  const ref = data.pack.skills.find((r) => r.id === id)
  return lessonGate({ skill, ref, phase, writing: o.writing, active: o.active ?? phase === 'building' })
}

describe('Aprender con la creación en pausa', () => {
  const data = course([topic('a', 'draft', { lesson: true, exercises: 4 }), topic('b', 'empty')])

  it('lo escrito se lee; lo que falta ofrece reanudar la creación, no «Escribir este tema ahora» (la escondería)', () => {
    expect(gate(data, 'a', 'stopped')).toBe('open')
    expect(gate(data, 'b', 'stopped')).toBe('paused')
    // sin tema que abrir, igual
    expect(lessonGate({ skill: undefined, ref: undefined, phase: 'stopped', active: false })).toBe('paused')
  })
})

describe('Aprender mientras una ampliación escribe un tema («Escribir este tema ahora»)', () => {
  it('el tema que se escribe no se abre a medias, aunque ya tenga el primer bloque de la lección', () => {
    const data = course([topic('a', 'ready', { lesson: true, exercises: 6 }), topic('b', 'draft', { lesson: true })])
    expect(gate(data, 'b', 'none', { writing: 'b', active: true })).toBe('writing')
    expect(openableLessons(data, 'none', 'b').map((s) => s.id)).toEqual(['a'])
    expect(pickLesson(data, undefined, 'none', 'b')?.id).toBe('a')
    // ya auditado con su lección: se abre
    const ready = course([topic('b', 'needsReview', { lesson: true, exercises: 2 })])
    expect(gate(ready, 'b', 'none', { writing: 'b', active: true })).toBe('open')
  })

  it('otro tema sin escribir espera (pedirlo ahora daría «ocupado»); los listos se abren', () => {
    const data = course([topic('a', 'ready', { lesson: true, exercises: 6 }), topic('b', 'draft'), topic('c', 'empty')])
    expect(gate(data, 'c', 'none', { writing: 'b', active: true })).toBe('busy')
    expect(gate(data, 'a', 'none', { writing: 'b', active: true })).toBe('open')
    // una ampliación de todo el curso («Pedir cambios» sin tema) también ocupa
    expect(gate(data, 'c', 'none', { active: true })).toBe('busy')
  })
})

describe('Aprender sin nada pendiente', () => {
  it('sin lección se ofrece escribirla; si ya tiene ejercicios, solo la lección (no duplicarlos)', () => {
    const data = course([topic('a', 'empty'), topic('b', 'needsReview', { exercises: 6 })])
    expect(gate(data, 'a', 'none')).toBe('writeNow')
    expect(gate(data, 'b', 'none')).toBe('writeLesson')
    expect(lessonGate({ skill: undefined, ref: undefined, phase: 'none', active: false })).toBe('ask')
  })
})

describe('Aprender mientras se crea el curso', () => {
  it('lo listo se abre; lo demás se está escribiendo (o espera su turno)', () => {
    const data = course([topic('a', 'ready', { lesson: true, exercises: 6 }), topic('b', 'draft', { lesson: true }), topic('c', 'empty')])
    expect(gate(data, 'a', 'building')).toBe('open')
    expect(gate(data, 'b', 'building')).toBe('writing')
    expect(gate(data, 'c', 'building')).toBe('writing')
    expect(pickLesson(data, undefined, 'building')?.id).toBe('a')
  })
})
