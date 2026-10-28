import { describe, expect, it, vi } from 'vitest'
import { emptyProgress } from '@shared/schema'
import { coalesceOps, sendOps, type SyncOp } from './sync'

describe('operaciones de estudio', () => {
  it('junta los «learning» por habilidad y deja un solo «save» en el sitio del último', () => {
    const ops: SyncOp[] = [
      { kind: 'learning', skillId: 'a' },
      { kind: 'save' },
      { kind: 'time', seconds: 5 },
      { kind: 'learning', skillId: 'b' },
      { kind: 'learning', skillId: 'a' },
      { kind: 'save' },
      { kind: 'review', cardId: 'c1', rating: 3 }
    ]
    expect(coalesceOps(ops)).toEqual([
      { kind: 'time', seconds: 5 },
      { kind: 'learning', skillId: 'b' },
      { kind: 'learning', skillId: 'a' },
      { kind: 'save' },
      { kind: 'review', cardId: 'c1', rating: 3 }
    ])
  })

  it('manda cada operación a su método, en orden', async () => {
    const invoke = vi.fn(async (_method: string, _args?: unknown): Promise<unknown> => undefined)
    const progress = emptyProgress()
    await sendOps('p1', [{ kind: 'review', cardId: 'c1', rating: 4, seconds: 3 }, { kind: 'time', seconds: 12.6 }, { kind: 'completeLesson', skillId: 's' }], () => progress, invoke)
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(['study.reviewCard', 'study.recordTime', 'study.completeLesson'])
    expect(invoke.mock.calls[1][1]).toEqual({ packId: 'p1', seconds: 13 })
  })

  it('si el proceso principal rechaza una, guarda todo el progreso al final', async () => {
    const invoke = vi.fn(async (method: string, _args?: unknown): Promise<unknown> => {
      if (method === 'study.reviewCard') throw Object.assign(new Error('no'), { code: 'invalid_args' })
      return undefined
    })
    const progress = emptyProgress()
    await sendOps('p1', [{ kind: 'review', cardId: 'c1', rating: 1 }, { kind: 'time', seconds: 1 }], () => progress, invoke)
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(['study.reviewCard', 'study.recordTime', 'progress.save'])
    expect(invoke.mock.calls[2][1]).toEqual({ id: 'p1', progress })
  })
})
