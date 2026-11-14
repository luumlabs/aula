// El estado de «la creación falló y el curso no tiene temas» (home-f4 del juez: «Fotosíntesis · 0 temas · Estudiar ahora»).
import { describe, expect, it } from 'vitest'
import type { RunSummary } from '@shared/generation/types'
import { makeSkillRef, type ContentStatus } from '@shared/schema'
import {
  courseBuilding, courseRunIssue, coursePartial, creationPhase, extendingTopic, failureReason, latestByCourse, planAvailability, renewalWhen, studyableCount
} from './failure'

const run = (o: Partial<RunSummary>): RunSummary => ({ id: 'run-1', packId: 'p', title: 'T', icon: 'biology', hue: 0.3, state: 'done', progress: 1, stageLabel: '', updated: '2026-10-26T21:59:03Z', ...o })
/** Temas listos y escritos (sin decir otra cosa, todo lo escrito está auditado). */
const n = (ready: number, written = ready): { ready: number; written: number } => ({ ready, written })

describe('courseRunIssue', () => {
  it('un curso sin temas cuya creación falló, se detuvo o topó con un límite', () => {
    expect(courseRunIssue(run({ state: 'failed' }), n(0))).toBe('failed')
    expect(courseRunIssue(run({ state: 'cancelled' }), n(0))).toBe('stopped')
    expect(courseRunIssue(run({ state: 'paused' }), n(0))).toBe('stopped')
    expect(courseRunIssue(run({ state: 'limit' }), n(0))).toBe('limit')
    expect(courseRunIssue(run({ state: 'running' }), n(0))).toBe('building')
  })

  it('con temas, sin ejecuciones o con la creación terminada no hay nada que avisar', () => {
    expect(courseRunIssue(run({ state: 'failed' }), n(3))).toBeUndefined()
    expect(courseRunIssue(undefined, n(0))).toBeUndefined()
    expect(courseRunIssue(run({ state: 'done' }), n(0))).toBeUndefined()
  })

  it('se cuentan los temas LISTOS: con el plan hecho pero nada escrito todavía no hay nada que estudiar', () => {
    // 8 temas planificados y ninguno listo: «Todavía no hay temas», no «ya puedes empezar» con 0 temas escritos
    expect(courseRunIssue(run({ state: 'running' }), n(0))).toBe('building')
    expect(courseBuilding(run({ state: 'running' }), n(0))).toBe(false)
    expect(courseRunIssue(run({ state: 'limit' }), n(0))).toBe('limit')
    expect(coursePartial(run({ state: 'limit' }), n(0))).toBeUndefined()
  })

  it('una ampliación no deja el curso vacío ni a medias (trabaja sobre un curso que ya existía)', () => {
    expect(courseRunIssue(run({ state: 'failed', mode: 'extend' }), n(0))).toBeUndefined()
    expect(courseBuilding(run({ state: 'running', mode: 'extend' }), n(3))).toBe(false)
    expect(coursePartial(run({ state: 'limit', mode: 'extend' }), n(3))).toBeUndefined()
    // sin dato del modo, como antes: una creación
    expect(courseBuilding(run({ state: 'running' }), n(3))).toBe(true)
  })

  it('creándose con temas ya escritos: se puede estudiar, pero no está terminado', () => {
    expect(courseBuilding(run({ state: 'running' }), n(2))).toBe(true)
    expect(courseBuilding(run({ state: 'waiting' }), n(1))).toBe(true)
    // sin temas lo explica la pantalla de «Todavía no hay temas» (courseRunIssue = 'building')
    expect(courseBuilding(run({ state: 'running' }), n(0))).toBe(false)
    expect(courseBuilding(run({ state: 'done' }), n(5))).toBe(false)
    expect(courseBuilding(run({ state: 'paused' }), n(5))).toBe(false)
    expect(courseBuilding(undefined, n(5))).toBe(false)
  })

  it('la última ejecución de cada curso', () => {
    const latest = latestByCourse([
      run({ id: 'run-a', packId: 'p', state: 'failed', updated: '2026-10-26T22:00:00Z' }),
      run({ id: 'run-b', packId: 'p', state: 'done', updated: '2026-10-26T21:00:00Z' }),
      run({ id: 'run-c', packId: 'q', state: 'paused' })
    ])
    expect(latest.p.id).toBe('run-a')
    expect(latest.q.id).toBe('run-c')
  })

  it('el motivo en llano a partir del código del error', () => {
    expect(failureReason('ai_auth', 'failed')).toBe('auth')
    expect(failureReason('ai_network', 'failed')).toBe('network')
    expect(failureReason('ai_not_installed', 'failed')).toBe('notInstalled')
    expect(failureReason('ai_budget', 'limit')).toBe('limit')
    expect(failureReason('ai_rate_limit', 'limit')).toBe('limit')
    // sin saldo o sin cuota no se renueva solo: su propio motivo (recargar o cambiar de proveedor)
    expect(failureReason('ai_quota', 'limit')).toBe('quota')
    expect(failureReason('ai_quota', 'failed')).toBe('quota')
    expect(failureReason(undefined, 'failed')).toBe('other')
    // detenida por el estudiante o al cerrar: no es «algo salió mal» (J2-13)
    expect(failureReason(undefined, 'paused')).toBe('stopped')
    expect(failureReason(undefined, 'cancelled')).toBe('stopped')
    expect(failureReason('ai_network', 'paused')).toBe('network')
  })
})

describe('coursePartial (J2-2)', () => {
  it('un curso con temas cuya creación se cortó está a medias y se puede reanudar', () => {
    expect(coursePartial(run({ state: 'paused' }), n(2))).toBe('paused')
    expect(coursePartial(run({ state: 'cancelled' }), n(2))).toBe('paused')
    expect(coursePartial(run({ state: 'failed' }), n(5))).toBe('failed')
    expect(coursePartial(run({ state: 'limit' }), n(1))).toBe('limit')
  })

  it('terminado, en marcha, sin ejecuciones o sin temas (eso lo cuenta courseRunIssue): nada', () => {
    expect(coursePartial(run({ state: 'done' }), n(4))).toBeUndefined()
    expect(coursePartial(run({ state: 'running' }), n(4))).toBeUndefined()
    expect(coursePartial(undefined, n(4))).toBeUndefined()
    expect(coursePartial(run({ state: 'paused' }), n(0))).toBeUndefined()
  })
})

describe('creationPhase', () => {
  it('escribiéndose, parada a medias con temas listos o nada pendiente', () => {
    expect(creationPhase(run({ state: 'running' }), n(0))).toBe('building')
    expect(creationPhase(run({ state: 'waiting' }), n(2))).toBe('building')
    expect(creationPhase(run({ state: 'limit' }), n(2))).toBe('stopped')
    expect(creationPhase(run({ state: 'paused' }), n(1))).toBe('stopped')
    expect(creationPhase(run({ state: 'done' }), n(5))).toBe('none')
    expect(creationPhase(run({ state: 'running', mode: 'extend' }), n(5))).toBe('none')
    expect(creationPhase(undefined, n(5))).toBe('none')
  })
})

describe('borradores sin auditar cuando la creación se para', () => {
  // Aula se cerró (o topó con un límite) mientras escribía el primer lote: 2 temas escritos, ninguno auditado todavía
  const drafts = n(0, 2)

  it('parada con temas escritos: el curso está a medias (se abre con «Reanudar»), no «se quedó sin temas»', () => {
    expect(coursePartial(run({ state: 'limit' }), drafts)).toBe('limit')
    expect(coursePartial(run({ state: 'paused' }), drafts)).toBe('paused')
    expect(coursePartial(run({ state: 'cancelled' }), drafts)).toBe('paused')
    expect(coursePartial(run({ state: 'failed' }), drafts)).toBe('failed')
    expect(courseRunIssue(run({ state: 'limit' }), drafts)).toBeUndefined()
    expect(courseRunIssue(run({ state: 'paused' }), drafts)).toBeUndefined()
    expect(courseRunIssue(run({ state: 'failed' }), drafts)).toBeUndefined()
    expect(creationPhase(run({ state: 'limit' }), drafts)).toBe('stopped')
    expect(creationPhase(run({ state: 'paused' }), drafts)).toBe('stopped')
    // lo que se puede estudiar es lo escrito
    expect(studyableCount(run({ state: 'limit' }), drafts)).toBe(2)
  })

  it('en marcha, un borrador aún cambia: cuentan los listos', () => {
    expect(courseRunIssue(run({ state: 'running' }), drafts)).toBe('building')
    expect(courseBuilding(run({ state: 'running' }), drafts)).toBe(false)
    expect(creationPhase(run({ state: 'running' }), drafts)).toBe('building')
    expect(studyableCount(run({ state: 'running' }), n(1, 3))).toBe(1)
    expect(courseBuilding(run({ state: 'waiting' }), n(1, 3))).toBe(true)
  })

  it('sin nada escrito sigue siendo un fallo (nada que estudiar)', () => {
    expect(courseRunIssue(run({ state: 'limit' }), n(0, 0))).toBe('limit')
    expect(coursePartial(run({ state: 'limit' }), n(0, 0))).toBeUndefined()
    expect(creationPhase(run({ state: 'limit' }), n(0, 0))).toBe('none')
  })
})

describe('una ampliación de un solo tema («Escribir este tema ahora»)', () => {
  const ref = (id: string, status: ContentStatus, lessonBlocks: number) => makeSkillRef({ id, title: id, status, counts: { lessonBlocks, exercises: 0, templates: 0, cards: 0, decks: 0 } })

  it('el tema que escribe mientras está en marcha (no antes ni después, ni el de una creación)', () => {
    expect(extendingTopic(run({ state: 'running', mode: 'extend', skill: 'a' }))).toBe('a')
    expect(extendingTopic(run({ state: 'waiting', mode: 'extend', skill: 'a' }))).toBe('a')
    expect(extendingTopic(run({ state: 'done', mode: 'extend', skill: 'a' }))).toBeUndefined()
    expect(extendingTopic(run({ state: 'running', mode: 'extend' }))).toBeUndefined()
    expect(extendingTopic(run({ state: 'running', skill: 'a' }))).toBeUndefined()
    expect(extendingTopic(undefined)).toBeUndefined()
  })

  it('el plan no propone ese tema hasta que esté listo; mientras se crea el curso, solo los listos; si no, todos', () => {
    const extend = planAvailability(run({ state: 'running', mode: 'extend', skill: 'a' }), n(3))
    expect(extend?.(ref('a', 'draft', 2))).toBe(false)
    expect(extend?.(ref('a', 'ready', 4))).toBe(true)
    expect(extend?.(ref('b', 'draft', 2))).toBe(true)
    const building = planAvailability(run({ state: 'running' }), n(1, 2))
    expect(building?.(ref('b', 'draft', 2))).toBe(false)
    expect(building?.(ref('c', 'ready', 2))).toBe(true)
    expect(planAvailability(run({ state: 'limit' }), n(0, 2))).toBeUndefined()
    expect(planAvailability(run({ state: 'done' }), n(3))).toBeUndefined()
    expect(planAvailability(undefined, n(3))).toBeUndefined()
  })
})

describe('renewalWhen', () => {
  const now = new Date(2026, 10, 13, 15, 0)
  it('hoy a una hora, otro día, ya pasó o sin dato', () => {
    expect(renewalWhen(new Date(2026, 10, 13, 18, 30).toISOString(), now)).toEqual({ kind: 'today', at: new Date(2026, 10, 13, 18, 30) })
    expect(renewalWhen(new Date(2026, 10, 14, 9, 0).toISOString(), now)?.kind).toBe('later')
    expect(renewalWhen(new Date(2026, 10, 13, 14, 0).toISOString(), now)).toEqual({ kind: 'passed' })
    expect(renewalWhen(undefined, now)).toBeUndefined()
    expect(renewalWhen('no es una fecha', now)).toBeUndefined()
  })
})
