// Cada orden del navegador en vivo dice quién la da: la ventana del ordenador o un dispositivo (que solo llega a sus
// plataformas: engine/live/reach.ts). Mirar o pasarle el turno a Aula no es manejar.
import { beforeAll, describe, expect, it, vi } from 'vitest'

type Handler = (args: unknown, ctx?: unknown) => unknown
const handlers = new Map<string, Handler>()
const spies = vi.hoisted(() => ({
  open: vi.fn(async () => ({})), frame: vi.fn(async () => null), input: vi.fn(async () => ({ applied: 0 })), navigate: vi.fn(async () => ({})),
  viewport: vi.fn(() => ({})), hold: vi.fn(() => ({})), state: vi.fn(() => null), list: vi.fn(() => []), close: vi.fn(), shutdown: vi.fn()
}))

vi.mock('electron', () => ({ app: { on: vi.fn() } }))
vi.mock('../rpc', () => ({ handle: (m: string, fn: Handler) => handlers.set(m, fn), emit: vi.fn() }))
vi.mock('../browser', () => ({ platformBrowser: () => ({ confirmSignIn: vi.fn() }) }))
vi.mock('../browser/live', () => ({
  LiveBrowser: class {
    open = spies.open; frame = spies.frame; input = spies.input; navigate = spies.navigate; viewport = spies.viewport
    hold = spies.hold; state = spies.state; list = spies.list; close = spies.close; shutdown = spies.shutdown
  }
}))

beforeAll(async () => { (await import('./live')).register() })

const DEVICE = { sender: undefined, remote: { deviceId: 'd1' } }
const WINDOW = { sender: {} }
const call = (method: string, args: unknown, ctx: unknown) => handlers.get(method)!(args, ctx)
const id = 'live-m1'

describe('quién maneja el navegador en vivo', () => {
  for (const [ctx, via] of [[DEVICE, 'device'], [WINDOW, 'window']] as const) {
    it(`desde ${via === 'device' ? 'un dispositivo' : 'la ventana'}: '${via}'`, async () => {
      await call('live.open', { accountId: 'm1', url: 'https://campus.uni.es/' }, ctx)
      expect(spies.open).toHaveBeenLastCalledWith({ accountId: 'm1', url: 'https://campus.uni.es/', purpose: undefined, holder: 'student', via })
      await call('live.frame', { id, after: 3, maxWidth: 800 }, ctx)
      expect(spies.frame).toHaveBeenLastCalledWith(id, 3, 800, via)
      await call('live.input', { id, controlId: 'c', events: [] }, ctx)
      expect(spies.input).toHaveBeenLastCalledWith(id, 'c', [], via)
      await call('live.navigate', { id, controlId: 'c', action: 'home' }, ctx)
      expect(spies.navigate).toHaveBeenLastCalledWith(id, 'c', 'home', undefined, via)
      await call('live.take', { id }, ctx)
      expect(spies.hold).toHaveBeenLastCalledWith(id, 'student', undefined, via)
    })
  }

  it('pasar el turno a Aula y ajustar el tamaño no cambian quién conduce', async () => {
    await call('live.give', { id }, DEVICE)
    expect(spies.hold).toHaveBeenLastCalledWith(id, 'aula')
    await call('live.viewport', { id, width: 390, height: 700 }, DEVICE)
    expect(spies.viewport).toHaveBeenLastCalledWith(id, 390, 700)
  })
})
