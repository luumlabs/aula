import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushDeletes, scheduleDelete, setDeleteCommitter, undoDelete, usePendingDeletes } from './deletion'

describe('borrar una conversación con «Deshacer» (J2-4)', () => {
  const deleted: string[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    deleted.length = 0
    setDeleteCommitter(async (id) => void deleted.push(id))
  })
  afterEach(() => vi.useRealTimers())

  it('se esconde al momento y solo se borra cuando pasa el aviso', async () => {
    scheduleDelete('a', 8000)
    expect(usePendingDeletes.getState().ids).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(7900)
    expect(deleted).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(deleted).toEqual(['a'])
    expect(usePendingDeletes.getState().ids).toEqual([])
  })

  it('«Deshacer» la devuelve y no borra nada', async () => {
    scheduleDelete('b', 8000)
    expect(undoDelete('b')).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(deleted).toEqual([])
    expect(usePendingDeletes.getState().ids).toEqual([])
    expect(undoDelete('b')).toBe(false)
  })

  it('al cerrar la ventana se borra lo pendiente; dos clics no la borran dos veces', async () => {
    scheduleDelete('c', 8000)
    scheduleDelete('c', 8000)
    flushDeletes()
    await vi.runAllTimersAsync()
    expect(deleted).toEqual(['c'])
  })
})
