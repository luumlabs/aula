import { afterEach, describe, expect, it, vi } from 'vitest'
import { msg } from '@shared/ai/types'
import { AIConsentGate, authorizeAIRequest, consentFetchInit, installAIConsentPrompt, revokeAIConsent } from './consent'
import { AIError } from './errors'
import { defaultHTTPOptions } from './http/options'
import { configFromPreset, presetById } from './presets'
import { AnthropicModel } from './providers/anthropic'
import { streamingAttempt } from './providers/base'
import { OpenAICompatibleModel, openAIListModels } from './providers/openai'
import { testDeps } from './testing/mocks'

const originalMas = Object.getOwnPropertyDescriptor(process, 'mas')
afterEach(() => {
  revokeAIConsent()
  installAIConsentPrompt(async () => false)
  if (originalMas) Object.defineProperty(process, 'mas', originalMas)
  else Reflect.deleteProperty(process, 'mas')
})

describe('session AI consent', () => {
  it('asks for each provider and origin, never exposes URL secrets, and permits revocation', async () => {
    const prompt = vi.fn(async () => true)
    const gate = new AIConsentGate(prompt)
    expect(await gate.authorize('file:///private', 'Example')).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
    expect(await gate.authorize('https://user:secret@example.org/v1?token=secret', 'Example\nAI')).toBe(true)
    expect(prompt).toHaveBeenCalledWith({ provider: 'Example AI', origin: 'https://example.org' }, expect.any(AbortSignal))
    expect(await gate.authorize('https://example.org/another', 'Example AI')).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(await gate.authorize('https://different.example/v1', 'Example AI')).toBe(true)
    expect(await gate.authorize('https://example.org/v1', 'Other AI')).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(3)
    gate.revokeAll()
    expect(await gate.authorize('https://example.org/v1', 'Example AI')).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(4)
  })

  it('deduplicates simultaneous prompts and does not restore a revoked pending grant', async () => {
    let answer!: (value: boolean) => void
    const prompt = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve }))
    const gate = new AIConsentGate(prompt)
    const first = gate.authorize('https://example.org/v1', 'Example')
    const second = gate.authorize('https://example.org/v1', 'Example')
    await Promise.resolve()
    expect(prompt).toHaveBeenCalledTimes(1)
    gate.revokeAll()
    answer(true)
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    const again = gate.authorize('https://example.org/v1', 'Example')
    await Promise.resolve()
    expect(prompt).toHaveBeenCalledTimes(2)
    answer(false)
    expect(await again).toBe(false)
  })

  it('remembers a “Not now” for a while, but not a prompt that could not be shown or that nobody waited for', async () => {
    let time = 1_000
    const prompt = vi.fn<(d: unknown, s: AbortSignal) => Promise<boolean | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(false).mockResolvedValue(true)
    const gate = new AIConsentGate(prompt, { now: () => time, declineMs: 60_000 })
    // sin ventana a la vista no hay respuesta: la siguiente petición vuelve a preguntar
    expect(await gate.authorize('https://example.org/v1', 'Example')).toBe(false)
    expect(await gate.authorize('https://example.org/v1', 'Example')).toBe(false)
    expect(prompt).toHaveBeenCalledTimes(2)
    // «Ahora no»: no se insiste durante el plazo, ni siquiera a otra ruta del mismo destino
    expect(await gate.authorize('https://example.org/other', 'Example')).toBe(false)
    expect(prompt).toHaveBeenCalledTimes(2)
    // otro destino sí se pregunta
    expect(await gate.authorize('https://other.example/v1', 'Example')).toBe(true)
    time += 60_001
    expect(await gate.authorize('https://example.org/v1', 'Example')).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(4)
  })

  it('restablecer los permisos olvida también la negativa', async () => {
    const prompt = vi.fn<(d: unknown, s: AbortSignal) => Promise<boolean | null>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    const gate = new AIConsentGate(prompt)
    expect(await gate.authorize('https://example.org/v1', 'Example')).toBe(false)
    gate.revokeAll()
    expect(await gate.authorize('https://example.org/v1', 'Example')).toBe(true)
  })

  it('closes the prompt when the last request waiting for it is cancelled, without recording a refusal', async () => {
    let closed: AbortSignal | undefined
    let answer!: (value: boolean) => void
    const prompt = vi.fn((_d: unknown, signal: AbortSignal) => new Promise<boolean>(resolve => {
      closed = signal
      answer = resolve
      signal.addEventListener('abort', () => resolve(false))
    }))
    const gate = new AIConsentGate(prompt)
    const first = new AbortController()
    const second = new AbortController()
    const a = gate.authorize('https://example.org/v1', 'Example', first.signal)
    const b = gate.authorize('https://example.org/v1', 'Example', second.signal)
    await Promise.resolve()
    first.abort()
    await expect(a).rejects.toThrow()
    expect(closed?.aborted).toBe(false)
    second.abort()
    await expect(b).rejects.toThrow()
    expect(closed?.aborted).toBe(true)
    // el diálogo se cerró solo: no cuenta como «Ahora no» y se vuelve a preguntar
    const again = gate.authorize('https://example.org/v1', 'Example')
    await Promise.resolve()
    await Promise.resolve()
    expect(prompt).toHaveBeenCalledTimes(2)
    answer(true)
    expect(await again).toBe(true)
  })

  it('gives up on an unanswered prompt instead of hanging, and cuts requests in flight when permission is revoked', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    let closed = false
    installAIConsentPrompt((_d, signal) => new Promise<boolean>(resolve => signal.addEventListener('abort', () => { closed = true; resolve(false) })))
    await expect(authorizeAIRequest('https://slow.example/v1', 'Example', new AbortController().signal, 20)).rejects.toThrow(/unanswered|sin responder/)
    expect(closed).toBe(true)

    installAIConsentPrompt(async () => true)
    let sent!: () => void
    const reached = new Promise<void>(resolve => { sent = resolve })
    const fetch = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      sent()
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    }))
    const pending = streamingAttempt({
      url: 'https://flight.example/v1', headers: new Headers(), body: { message: 'private' },
      http: defaultHTTPOptions({ fetch }), idleSec: 0, idleError: () => new AIError('timeout', 'idle'),
      context: { provider: 'Example', model: 'example' }, signal: new AbortController().signal, emit: () => {},
      decoder: { handle: () => [], handleJSONBody: () => [], finishStream: () => [] }
    })
    await reached
    revokeAIConsent()
    await expect(pending).rejects.toThrow(/revoked|Retiraste/)
  })

  it('never follows redirects with a key or data, also when listing models', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    expect(consentFetchInit()).toEqual({ redirect: 'error' })
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } }))
    const preset = presetById('openai')!
    const config = configFromPreset(preset, 'openai')
    await openAIListModels(config, testDeps(fetch, { [config.secretRef!]: 'test-key' })).catch(() => undefined)
    expect(fetch).toHaveBeenCalled()
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ redirect: 'error' })
    Reflect.deleteProperty(process, 'mas')
    expect(consentFetchInit()).toEqual({})
  })

  it('does not contact either supported API provider if consent is denied', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    installAIConsentPrompt(async () => false)
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}', { headers: { 'content-type': 'application/json' } }))
    for (const id of ['openai', 'anthropic']) {
      const preset = presetById(id)!
      const config = configFromPreset(preset, id)
      const deps = testDeps(fetch, { [config.secretRef!]: 'test-key' })
      const model = id === 'anthropic' ? new AnthropicModel(config, deps) : new OpenAICompatibleModel(config, deps)
      await expect(model.complete({ messages: [msg.user('private study information')] })).rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends only after permission and prevents automatic redirects; revocation blocks the next request', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    const prompt = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    installAIConsentPrompt(prompt)
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const args = {
      url: 'https://example.org/v1/chat', headers: new Headers(), body: { message: 'private' },
      http: defaultHTTPOptions({ fetch }), idleSec: 0, idleError: () => new AIError('timeout', 'idle'),
      context: { provider: 'Example', model: 'example' }, signal: new AbortController().signal, emit: () => {},
      decoder: { handle: () => [], handleJSONBody: () => [], finishStream: () => [] }
    }
    await streamingAttempt(args)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' })
    revokeAIConsent()
    await expect(streamingAttempt(args)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  it('does not send when the request is cancelled while a consent prompt is open', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    let answer!: (value: boolean) => void
    installAIConsentPrompt(() => new Promise<boolean>(resolve => { answer = resolve }))
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}'))
    const controller = new AbortController()
    const pending = streamingAttempt({
      url: 'https://cancel.example/v1', headers: new Headers(), body: { message: 'private' },
      http: defaultHTTPOptions({ fetch }), idleSec: 0, idleError: () => new AIError('timeout', 'idle'),
      context: { provider: 'Example', model: 'example' }, signal: controller.signal, emit: () => {},
      decoder: { handle: () => [], handleJSONBody: () => [], finishStream: () => [] }
    })
    await Promise.resolve()
    controller.abort()
    answer(true)
    await expect(pending).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
