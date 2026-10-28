import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlatformApprovalRequest, PlatformApprovalResolution } from '@shared/platforms/types'
import { ApprovalBroker, type ApprovalAsk } from './approvals'

const ask: ApprovalAsk = { accountId: 'a1', action: 'click', label: 'Guardar', category: 'modify', reason: 'Cambiaría datos.' }

describe('ApprovalBroker', () => {
  afterEach(() => vi.useRealTimers())

  it('sin respuesta a tiempo = denegado', async () => {
    vi.useFakeTimers()
    const b = new ApprovalBroker({ timeoutMs: 1000 })
    const resolved: PlatformApprovalResolution[] = []
    b.onResolved((r) => resolved.push(r))
    const p = b.request(ask)
    expect(b.list()).toHaveLength(1)
    vi.advanceTimersByTime(1001)
    await expect(p).resolves.toBe(false)
    expect(resolved[0]).toMatchObject({ allowed: false, by: 'timeout' })
    expect(b.list()).toHaveLength(0)
  })

  it('el estudiante permite o deniega (una sola vez)', async () => {
    const b = new ApprovalBroker()
    const requests: PlatformApprovalRequest[] = []
    b.onRequest((r) => requests.push(r))
    const p = b.request(ask)
    expect(requests[0]).toMatchObject({ accountId: 'a1', action: 'click', label: 'Guardar', category: 'modify' })
    expect(Date.parse(requests[0].expiresAt) - Date.parse(requests[0].createdAt)).toBe(120_000)
    expect(b.respond(requests[0].id, true)).toBe(true)
    expect(b.respond(requests[0].id, false)).toBe(false)
    await expect(p).resolves.toBe(true)
    const p2 = b.request(ask)
    b.respond(requests[1].id, false)
    await expect(p2).resolves.toBe(false)
  })

  it('cancelar (al cerrar sesión o salir) deniega lo pendiente de esa cuenta', async () => {
    const b = new ApprovalBroker()
    const mine = b.request(ask)
    const other = b.request({ ...ask, accountId: 'a2' })
    b.cancelAll('a1')
    await expect(mine).resolves.toBe(false)
    expect(b.list().map((r) => r.accountId)).toEqual(['a2'])
    b.cancelAll()
    await expect(other).resolves.toBe(false)
  })

  it('tope de pendientes y señal de cancelación', async () => {
    const b = new ApprovalBroker({ maxPending: 1 })
    const first = b.request(ask)
    await expect(b.request(ask)).resolves.toBe(false)
    const ctl = new AbortController()
    ctl.abort()
    await expect(b.request(ask, 1000, ctl.signal)).resolves.toBe(false)
    b.cancelAll()
    await expect(first).resolves.toBe(false)
    const ctl2 = new AbortController()
    const p = new ApprovalBroker().request(ask, 10_000, ctl2.signal)
    ctl2.abort()
    await expect(p).resolves.toBe(false)
  })

  it('recorta etiquetas y direcciones enormes', async () => {
    const b = new ApprovalBroker()
    const p = b.request({ ...ask, label: 'x'.repeat(1000), url: 'https://a.edu/' + 'y'.repeat(5000) })
    const r = b.list()[0]
    expect(r.label.length).toBe(300)
    expect(r.url?.length).toBe(2048)
    b.cancelAll()
    await p
  })
})
