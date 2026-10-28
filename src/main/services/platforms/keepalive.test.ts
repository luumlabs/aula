import { describe, expect, it } from 'vitest'
import type { PlatformAccount } from '@shared/settings/platforms'
import { KeepAliveScheduler, type CheckVerdict } from './keepalive'

const acc = (id: string, lastState: PlatformAccount['lastState'] = 'signedIn'): PlatformAccount => ({ id, kind: 'canvas', label: id, baseURL: `https://${id}.instructure.com/`, lastState })

/** Reloj y temporizadores a mano. */
function harness(accounts: PlatformAccount[], verdicts: Record<string, CheckVerdict> = {}, opts: { maxConcurrent?: number; enabled?: boolean } = {}) {
  let now = 1_800_000_000_000
  const timers: { at: number; fn: () => void; id: number }[] = []
  let seq = 0
  const checked: string[] = []
  const pending = new Map<string, () => void>()
  const signingIn = new Set<string>()
  const s = new KeepAliveScheduler({
    accounts: () => accounts,
    check: (a) => {
      checked.push(a.id)
      return new Promise<CheckVerdict>((resolve) => pending.set(a.id, () => resolve(verdicts[a.id] ?? 'signedIn')))
    },
    isSigningIn: (id) => signingIn.has(id),
    options: () => ({ intervalMinutes: 25, enabled: opts.enabled ?? true }),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h)
      if (i >= 0) timers.splice(i, 1)
    },
    maxConcurrent: opts.maxConcurrent
  })
  const finish = async (id: string): Promise<void> => {
    pending.get(id)?.()
    pending.delete(id)
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  const advance = (ms: number): void => {
    now += ms
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= now) {
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
    }
  }
  return { s, checked, finish, advance, signingIn, timers, nowRef: () => now }
}

describe('KeepAliveScheduler', () => {
  it('al arrancar comprueba todas las cuentas una vez (como mucho 2 a la vez)', async () => {
    const h = harness([acc('a'), acc('b'), acc('c', 'needsSignIn')])
    h.s.start()
    expect(h.checked).toEqual(['a', 'b'])
    await h.finish('a')
    // al terminar una, entra la siguiente (también la que estaba cerrada: las cookies repuestas podrían bastar)
    expect(h.checked).toEqual(['a', 'b', 'c'])
  })

  it('tras comprobar, duerme hasta el siguiente intervalo', async () => {
    const h = harness([acc('a')])
    h.s.start()
    await h.finish('a')
    expect(h.timers).toHaveLength(1)
    const wake = h.timers[0].at - h.nowRef()
    expect(wake).toBeGreaterThanOrEqual(25 * 60_000)
    expect(wake).toBeLessThanOrEqual(27.5 * 60_000)
    h.advance(wake)
    expect(h.checked).toEqual(['a', 'a'])
  })

  it('una sesión cerrada deja de comprobarse; un fallo de red reintenta pronto', async () => {
    const h = harness([acc('closed'), acc('flaky')], { closed: 'signedOut', flaky: 'error' })
    h.s.start()
    await h.finish('closed')
    await h.finish('flaky')
    const state = Object.fromEntries(h.s.snapshot().map((x) => [x.id, x]))
    expect(state.closed.status).toBe('needsSignIn')
    expect(state.flaky).toMatchObject({ status: 'signedIn', failures: 1 })
    h.advance(60_000)
    expect(h.checked.filter((x) => x === 'flaky')).toHaveLength(2)
    expect(h.checked.filter((x) => x === 'closed')).toHaveLength(1)
  })

  it('no molesta mientras hay una ventana de inicio de sesión abierta', () => {
    const h = harness([acc('a')])
    h.signingIn.add('a')
    h.s.start()
    expect(h.checked).toEqual([])
  })

  it('apagado en Ajustes: no comprueba', () => {
    const h = harness([acc('a')], {}, { enabled: false })
    h.s.start()
    expect(h.checked).toEqual([])
  })

  it('markChecked (tras iniciar sesión) reinicia el intervalo; resume comprueba lo atrasado', async () => {
    const h = harness([acc('a')])
    h.s.start()
    await h.finish('a')
    h.s.markChecked('a', 'signedIn')
    h.advance(60 * 60_000)
    expect(h.checked).toEqual(['a', 'a'])
    await h.finish('a')
    h.s.stop()
    h.advance(60 * 60_000)
    expect(h.checked).toHaveLength(2)
  })
})
