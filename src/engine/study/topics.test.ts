// Temas listos para estudiar mientras se crea el curso (lo escrito, no lo planificado).
import { describe, expect, it } from 'vitest'
import type { ContentStatus, SkillRef } from '@shared/schema'
import { readyTopicCount, topicAvailability, topicCounts, topicIsReady, topicOpens, writtenTopicCount } from './topics'

const ref = (status: ContentStatus, lessonBlocks = 0, exercises = 0): Pick<SkillRef, 'status' | 'counts'> => ({
  status, counts: { lessonBlocks, exercises, templates: 0, cards: 0, decks: 0 }
})

describe('temas listos', () => {
  it('cuenta los auditados con contenido, no los planificados ni los borradores', () => {
    const skills = [ref('ready', 6, 8), ref('needsReview', 4, 0), ref('draft', 3, 0), ref('empty'), ref('ready')]
    expect(readyTopicCount(skills)).toBe(2)
    expect(topicIsReady(ref('needsReview', 0, 5))).toBe(true)
    expect(topicIsReady(ref('draft', 9, 9))).toBe(false)
    expect(readyTopicCount([])).toBe(0)
  })

  it('los escritos cuentan también los borradores con contenido (lo que quedó al pararse la creación sin auditar)', () => {
    const skills = [ref('ready', 6, 8), ref('draft', 3, 0), ref('draft', 0, 4), ref('draft'), ref('empty'), ref('needsReview')]
    expect(writtenTopicCount(skills)).toBe(3)
    expect(topicCounts(skills)).toEqual({ ready: 1, written: 3 })
    // nada auditado todavía (Aula se cerró mientras escribía el primer lote): 0 listos, pero 2 escritos
    expect(topicCounts([ref('draft', 5, 6), ref('draft', 4, 0), ref('empty')])).toEqual({ ready: 0, written: 2 })
  })
})

describe('qué enseña Aprender de cada tema', () => {
  it('mientras se crea: lo listo se abre, el borrador se está escribiendo y lo vacío espera', () => {
    expect(topicAvailability(ref('ready', 5, 3), 'building')).toBe('ready')
    expect(topicAvailability(ref('needsReview', 5), 'building')).toBe('ready')
    expect(topicAvailability(ref('draft', 2), 'building')).toBe('writing')
    expect(topicAvailability(ref('draft'), 'building')).toBe('writing')
    // la práctica ya está pero la lección aún no
    expect(topicAvailability(ref('ready', 0, 6), 'building')).toBe('writing')
    expect(topicAvailability(ref('empty'), 'building')).toBe('queued')
  })

  it('parada a medias: nadie escribe, así que una lección a medias se lee y lo vacío queda en cola', () => {
    expect(topicAvailability(ref('draft', 2), 'stopped')).toBe('ready')
    expect(topicAvailability(ref('empty'), 'stopped')).toBe('queued')
    expect(topicAvailability(ref('ready', 0, 4), 'stopped')).toBe('queued')
  })

  it('sin creación pendiente: con lección se abre (aunque sea un borrador del chat); sin ella, «sin escribir»', () => {
    expect(topicAvailability(ref('draft', 3), 'none')).toBe('ready')
    expect(topicAvailability(ref('ready', 3), 'none')).toBe('ready')
    expect(topicAvailability(ref('empty'), 'none')).toBe('unwritten')
  })

  it('el tema que escribe ahora una ampliación no se abre a medias: hasta que la tubería lo audite con su lección', () => {
    // «Escribir este tema ahora»: el agente acaba de escribir el primer bloque de la lección
    expect(topicAvailability(ref('draft', 1), 'none', true)).toBe('writing')
    expect(topicAvailability(ref('empty'), 'none', true)).toBe('writing')
    // auditado, pero solo con ejercicios: aún le falta la lección
    expect(topicAvailability(ref('needsReview', 0, 6), 'none', true)).toBe('writing')
    // ya auditado con su lección (o «Pedir cambios» de un tema que ya estaba listo): se abre
    expect(topicAvailability(ref('needsReview', 7, 6), 'none', true)).toBe('ready')
    expect(topicAvailability(ref('ready', 7, 6), 'building', true)).toBe('ready')
  })

  it('Aprender abre lo listo y lo que no tiene lección sin nada pendiente; lo que se escribe o espera, no', () => {
    expect(topicOpens('ready')).toBe(true)
    expect(topicOpens('unwritten')).toBe(true)
    expect(topicOpens('writing')).toBe(false)
    expect(topicOpens('queued')).toBe(false)
  })
})
