// El estado de «la creación falló y el curso no tiene temas» (home-f4 del juez: «Fotosíntesis · 0 temas · Estudiar ahora»).
import { describe, expect, it } from 'vitest'
import type { RunSummary } from '@shared/generation/types'
import { courseRunIssue, coursePartial, failureReason, latestByCourse } from './failure'

const run = (o: Partial<RunSummary>): RunSummary => ({ id: 'run-1', packId: 'p', title: 'T', icon: 'biology', hue: 0.3, state: 'done', progress: 1, stageLabel: '', updated: '2026-10-26T21:59:03Z', ...o })

describe('courseRunIssue', () => {
  it('un curso sin temas cuya creación falló, se detuvo o topó con un límite', () => {
    expect(courseRunIssue(run({ state: 'failed' }), 0)).toBe('failed')
    expect(courseRunIssue(run({ state: 'cancelled' }), 0)).toBe('stopped')
    expect(courseRunIssue(run({ state: 'paused' }), 0)).toBe('stopped')
    expect(courseRunIssue(run({ state: 'limit' }), 0)).toBe('limit')
    expect(courseRunIssue(run({ state: 'running' }), 0)).toBe('building')
  })

  it('con temas, sin ejecuciones o con la creación terminada no hay nada que avisar', () => {
    expect(courseRunIssue(run({ state: 'failed' }), 3)).toBeUndefined()
    expect(courseRunIssue(undefined, 0)).toBeUndefined()
    expect(courseRunIssue(run({ state: 'done' }), 0)).toBeUndefined()
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
    expect(failureReason(undefined, 'failed')).toBe('other')
    // detenida por el estudiante o al cerrar: no es «algo salió mal» (J2-13)
    expect(failureReason(undefined, 'paused')).toBe('stopped')
    expect(failureReason(undefined, 'cancelled')).toBe('stopped')
    expect(failureReason('ai_network', 'paused')).toBe('network')
  })
})

describe('coursePartial (J2-2)', () => {
  it('un curso con temas cuya creación se cortó está a medias y se puede reanudar', () => {
    expect(coursePartial(run({ state: 'paused' }), 2)).toBe('paused')
    expect(coursePartial(run({ state: 'cancelled' }), 2)).toBe('paused')
    expect(coursePartial(run({ state: 'failed' }), 5)).toBe('failed')
    expect(coursePartial(run({ state: 'limit' }), 1)).toBe('limit')
  })

  it('terminado, en marcha, sin ejecuciones o sin temas (eso lo cuenta courseRunIssue): nada', () => {
    expect(coursePartial(run({ state: 'done' }), 4)).toBeUndefined()
    expect(coursePartial(run({ state: 'running' }), 4)).toBeUndefined()
    expect(coursePartial(undefined, 4)).toBeUndefined()
    expect(coursePartial(run({ state: 'paused' }), 0)).toBeUndefined()
  })
})
