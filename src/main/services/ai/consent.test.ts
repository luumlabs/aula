import { afterEach, describe, expect, it, vi } from 'vitest'
import { msg } from '@shared/ai/types'
import { AIConsentGate, installAIConsentPrompt, revokeAIConsent } from './consent'
import { AIError } from './errors'
import { defaultHTTPOptions } from './http/options'
import { configFromPreset, presetById } from './presets'
import { AnthropicModel } from './providers/anthropic'
import { streamingAttempt } from './providers/base'
import { OpenAICompatibleModel } from './providers/openai'
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
    expect(prompt).toHaveBeenCalledWith({ provider: 'Example AI', origin: 'https://example.org' })
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
