// A3-P2-5: la tarjeta del curso del chat sigue la creación (no se queda en «Empezando»).
import { describe, expect, it } from 'vitest'
import { courseCardStatus } from './courseCard'

describe('courseCardStatus (A3-P2-5)', () => {
  it('de la última ejecución del curso a lo que dice la tarjeta', () => {
    expect(courseCardStatus({ id: 'r1', state: 'running', progress: 0.4 })).toEqual({ kind: 'building', percent: 40, runId: 'r1' })
    expect(courseCardStatus({ id: 'r1', state: 'waiting', progress: 1 })).toMatchObject({ kind: 'building', percent: 99 })
    expect(courseCardStatus({ id: 'r1', state: 'done', progress: 1 })).toEqual({ kind: 'ready' })
    expect(courseCardStatus({ id: 'r1', state: 'failed', progress: 0.3 })).toEqual({ kind: 'failed', runId: 'r1' })
    expect(courseCardStatus({ id: 'r1', state: 'paused', progress: 0.3 })).toEqual({ kind: 'paused', runId: 'r1' })
    expect(courseCardStatus({ id: 'r1', state: 'cancelled', progress: 0.3 })).toEqual({ kind: 'paused', runId: 'r1' })
    expect(courseCardStatus({ id: 'r1', state: 'limit', progress: 0.3 })).toEqual({ kind: 'limit', runId: 'r1' })
  })
  it('sin ejecución conocida no inventa nada', () => {
    expect(courseCardStatus(undefined)).toBeUndefined()
  })
})
