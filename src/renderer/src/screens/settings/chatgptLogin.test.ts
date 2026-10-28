// A3-P1-2: «Conectar con ChatGPT» enseña en qué va (descarga, página, código), se puede cancelar y su estado sobrevive a la tarjeta.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDLE_LOGIN, applyLoginEvent, downloadFraction, useChatGPTLogin } from './chatgptLogin'

type Listener = (p: unknown) => void

/** Un puente falso (window.aula): `codexLogin` espera a que la prueba lo resuelva o lo cancele. */
function fakeBridge() {
  const listeners = new Map<string, Set<Listener>>()
  const calls: Array<{ method: string; args: unknown }> = []
  let settle: ((r: { ok: true; value: unknown } | { ok: false; error: { message: string; code: string } }) => void) | undefined
  const bridge = {
    platform: 'darwin',
    pathForFile: () => '',
    on: (event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
      return () => listeners.get(event)!.delete(fn)
    },
    invoke: (method: string, args: unknown) => {
      calls.push({ method, args })
      if (method === 'agents.codexLogin') return new Promise((r) => { settle = r })
      if (method === 'agents.codexLoginCancel') {
        settle?.({ ok: false, error: { message: 'Cancelled', code: 'cancelled' } })
        return Promise.resolve({ ok: true, value: undefined })
      }
      return Promise.resolve({ ok: true, value: {} })
    }
  }
  return {
    bridge,
    calls,
    emit: (event: string, payload: unknown) => listeners.get(event)?.forEach((fn) => fn(payload)),
    listening: (event: string) => listeners.get(event)?.size ?? 0,
    finish: () => settle?.({ ok: true, value: { connected: true, managedHome: true } }),
    fail: (message: string, code = 'internal') => settle?.({ ok: false, error: { message, code } })
  }
}

const g = globalThis as unknown as { window?: { aula?: unknown } }
let fake: ReturnType<typeof fakeBridge>

beforeEach(() => {
  fake = fakeBridge()
  g.window = { aula: fake.bridge }
  useChatGPTLogin.setState({ ...IDLE_LOGIN, connected: 0 })
})
afterEach(() => {
  delete g.window
})

describe('applyLoginEvent', () => {
  const busy = { ...IDLE_LOGIN, phase: 'starting' as const }
  it('descarga, página y código', () => {
    const d = applyLoginEvent(busy, { type: 'downloading', bytesDone: 5e6, bytesTotal: 20e6 })
    expect(d.phase).toBe('downloading')
    expect(downloadFraction(d)).toBeCloseTo(0.25)
    const b = applyLoginEvent(d, { type: 'waitingForBrowser', url: 'https://auth.openai.com/oauth/authorize?x=1' })
    expect(b).toMatchObject({ phase: 'browser', url: 'https://auth.openai.com/oauth/authorize?x=1' })
    // sin dirección en el aviso: se queda la que había
    expect(applyLoginEvent(b, { type: 'waitingForBrowser' }).url).toBe(b.url)
    expect(applyLoginEvent(b, { type: 'deviceCode', url: 'https://auth.openai.com/codex/device', code: 'ABCD-1234' })).toMatchObject({ phase: 'device', code: 'ABCD-1234' })
  })
  it('sin conexión en marcha, los avisos no cambian nada', () => {
    expect(applyLoginEvent(IDLE_LOGIN, { type: 'waitingForBrowser', url: 'https://x' })).toBe(IDLE_LOGIN)
    expect(downloadFraction(IDLE_LOGIN)).toBeNull()
  })
})

describe('store (A3-P1-2)', () => {
  it('sigue los avisos, conecta y deja ChatGPT en uso', async () => {
    const run = useChatGPTLogin.getState().start()
    expect(useChatGPTLogin.getState().phase).toBe('starting')
    fake.emit('agents.codexLogin', { type: 'downloading', bytesDone: 1, bytesTotal: 4 })
    expect(useChatGPTLogin.getState().phase).toBe('downloading')
    fake.emit('agents.codexLogin', { type: 'waitingForBrowser', url: 'https://auth.openai.com/a' })
    expect(useChatGPTLogin.getState()).toMatchObject({ phase: 'browser', url: 'https://auth.openai.com/a' })
    fake.finish()
    expect(await run).toBe(true)
    expect(fake.calls.map((c) => c.method)).toEqual(['agents.codexLogin', 'ai.configure'])
    expect(fake.calls[1].args).toEqual({ providerId: 'codex-cli' })
    expect(useChatGPTLogin.getState()).toMatchObject({ phase: 'idle', connected: 1 })
    expect(fake.listening('agents.codexLogin')).toBe(0)
  })

  it('«Cancelar» corta el codex login y no avisa de ningún error', async () => {
    const errors: string[] = []
    const run = useChatGPTLogin.getState().start({ onError: (m) => errors.push(m) })
    fake.emit('agents.codexLogin', { type: 'waitingForBrowser', url: 'https://auth.openai.com/a' })
    useChatGPTLogin.getState().cancel()
    expect(useChatGPTLogin.getState().phase).toBe('idle')
    expect(await run).toBe(false)
    expect(fake.calls.map((c) => c.method)).toContain('agents.codexLoginCancel')
    expect(errors).toEqual([])
  })

  it('un fallo de verdad se cuenta y la tarjeta vuelve a estar libre', async () => {
    const errors: string[] = []
    const run = useChatGPTLogin.getState().start({ onError: (m) => errors.push(m) })
    fake.fail('Codex login timed out')
    expect(await run).toBe(false)
    expect(errors).toEqual(['Codex login timed out'])
    expect(useChatGPTLogin.getState().phase).toBe('idle')
  })

  it('«Entrar con un código» sustituye al intento anterior sin que este lo pise', async () => {
    const first = useChatGPTLogin.getState().start()
    const second = useChatGPTLogin.getState().start({ deviceAuth: true })
    expect(fake.calls.at(-1)).toEqual({ method: 'agents.codexLogin', args: { deviceAuth: true } })
    fake.emit('agents.codexLogin', { type: 'deviceCode', url: 'https://auth.openai.com/codex/device', code: 'WXYZ-9876' })
    expect(useChatGPTLogin.getState()).toMatchObject({ phase: 'device', code: 'WXYZ-9876' })
    fake.finish()
    expect(await second).toBe(true)
    expect(await Promise.race([first, Promise.resolve('pending')])).toBe('pending')
    expect(useChatGPTLogin.getState().phase).toBe('idle')
  })
})
