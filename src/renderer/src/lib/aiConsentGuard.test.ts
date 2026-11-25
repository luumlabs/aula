// El aviso de la IA de terceros en la interfaz de un dispositivo: pregunta una vez, antes de mandar nada a la IA.
import { describe, expect, it, vi } from 'vitest'
import type { AIConsentState } from '@shared/ipc/ai'
import type { AIRecipient } from '@shared/ai/recipient'
import type { AulaClientError } from './api'
import { createAIConsentGuard, type AIConsentGuardDeps } from './aiConsentGuard'

const ANTHROPIC: AIRecipient = { id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] }
const DEEPSEEK: AIRecipient = { id: 'deepseek', name: 'DeepSeek', uses: ['answers'] }
const needed = (r: AIRecipient[]): AIConsentState => ({ needed: true, recipients: r })
const done = (r: AIRecipient[]): AIConsentState => ({ needed: false, recipients: r })
const aulaError = (code: string, details?: unknown): AulaClientError => Object.assign(new Error(code), { name: 'AulaError', code, details })

function deps(over: Partial<AIConsentGuardDeps> = {}) {
  const d = {
    demo: vi.fn(() => false),
    fetch: vi.fn(async () => needed([ANTHROPIC])),
    accept: vi.fn(async (ids: string[]) => done(ids.map((id) => ({ id, name: id, uses: ['answers' as const] })))),
    ask: vi.fn(async () => true),
    declined: () => aulaError('ai_consent_declined'),
    ...over
  }
  return d
}

describe('el vigilante de las llamadas', () => {
  it('lo que no va a la IA ni pregunta ni mira', async () => {
    const d = deps()
    await createAIConsentGuard(d).before('courses.list', undefined)
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('encender una rutina con IA o reanudar «Aula siempre activa» pregunta antes; pausar o una rutina ligera, no', async () => {
    for (const [method, args] of [['automations.setProactive', { patch: { morningBrief: true } }], ['automations.pause', { until: null }]] as const) {
      const d = deps()
      await createAIConsentGuard(d).before(method, args)
      expect(d.ask, method).toHaveBeenCalledWith(needed([ANTHROPIC]), false)
    }
    const d = deps()
    const g = createAIConsentGuard(d)
    await g.before('automations.setProactive', { patch: { examOffers: true } })
    await g.before('automations.pause', { until: '2026-11-18T07:00:00.000Z' })
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('ya aceptado (o sin nadie a quien mandar): no pregunta', async () => {
    const d = deps({ fetch: vi.fn(async () => done([])) })
    await createAIConsentGuard(d).before('chat.send', {})
    expect(d.ask).not.toHaveBeenCalled()
  })

  it('pregunta, acepta los nombres que enseñó y la siguiente ya no pregunta', async () => {
    const d = deps()
    const g = createAIConsentGuard(d)
    await g.before('chat.send', {})
    expect(d.ask).toHaveBeenCalledWith(needed([ANTHROPIC]), false)
    expect(d.accept).toHaveBeenCalledWith(['anthropic'])
    await g.before('study.gradeOpen', {})
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })

  it('cancelar no manda nada; la siguiente vuelve a preguntar', async () => {
    const d = deps({ ask: vi.fn(async () => false) })
    const g = createAIConsentGuard(d)
    await expect(g.before('chat.send', {})).rejects.toMatchObject({ code: 'ai_consent_declined' })
    expect(d.accept).not.toHaveBeenCalled()
    await expect(g.before('chat.send', {})).rejects.toMatchObject({ code: 'ai_consent_declined' })
    expect(d.ask).toHaveBeenCalledTimes(2)
  })

  it('dos llamadas a la vez: una sola hoja', async () => {
    let answer: (ok: boolean) => void = () => {}
    const d = deps({ ask: vi.fn(() => new Promise<boolean>((r) => { answer = r })) })
    const g = createAIConsentGuard(d)
    const a = g.before('chat.send', {})
    const b = g.before('create.start', {})
    await vi.waitFor(() => expect(d.ask).toHaveBeenCalled())
    answer(true)
    await Promise.all([a, b])
    expect(d.ask).toHaveBeenCalledTimes(1)
  })

  it('si la IA cambia mientras se lee, vuelve a preguntar con los nombres nuevos', async () => {
    const ask = vi.fn(async (_s: AIConsentState, _demo: boolean) => true)
    const d = deps({
      ask,
      accept: vi.fn(async (ids: string[]) => {
        if (ids.includes('anthropic')) throw aulaError('ai_consent', needed([DEEPSEEK]))
        return done([DEEPSEEK])
      })
    })
    await createAIConsentGuard(d).before('chat.send', {})
    expect(ask.mock.calls.map(([state]) => state.recipients[0].id)).toEqual(['anthropic', 'deepseek'])
  })

  it('si el Mac lo rechaza, pregunta y se reintenta; otro error no', async () => {
    const d = deps({ fetch: vi.fn(async () => done([])) })
    const g = createAIConsentGuard(d)
    await g.before('chat.send', {})
    expect(await g.recover('chat.send', {}, aulaError('ai_consent', needed([ANTHROPIC])))).toBe(true)
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(await g.recover('chat.send', {}, aulaError('not_found'))).toBe(false)
    // ni lo que no va a la IA (acceptConsent tampoco: no se pregunta en bucle)
    expect(await g.recover('ai.acceptConsent', { ids: ['x'] }, aulaError('ai_consent', needed([ANTHROPIC])))).toBe(false)
  })

  it('forget vuelve a mirar en el Mac', async () => {
    const d = deps({ fetch: vi.fn(async () => done([])) })
    const g = createAIConsentGuard(d)
    await g.before('chat.send', {})
    g.forget()
    await g.before('chat.send', {})
    expect(d.fetch).toHaveBeenCalledTimes(2)
  })

  it('en la demostración: el aviso propio, sin pedir ni guardar nada en el Mac, y recordado en memoria', async () => {
    const d = deps({ demo: vi.fn(() => true) })
    const g = createAIConsentGuard(d)
    await g.before('chat.send', {})
    await g.before('chat.send', {})
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.ask).toHaveBeenCalledWith({ needed: true, recipients: [] }, true)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.accept).not.toHaveBeenCalled()
    expect(await g.recover('chat.send', {}, aulaError('ai_consent'))).toBe(false)
  })

  it('en la demostración de las capturas del App Store: el aviso ya visto, sin hoja', async () => {
    const d = deps({ demo: vi.fn(() => true), demoSeen: vi.fn(() => true) })
    await createAIConsentGuard(d).before('chat.send', {})
    expect(d.ask).not.toHaveBeenCalled()
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('«ya visto» no vale fuera de la demostración: con el Mac se pregunta igual', async () => {
    const d = deps({ demoSeen: vi.fn(() => true) })
    await createAIConsentGuard(d).before('chat.send', {})
    expect(d.ask).toHaveBeenCalledTimes(1)
  })

  it('si el Mac no contesta, deja pasar (decide su guardia)', async () => {
    const d = deps({ fetch: vi.fn(async () => { throw new Error('sin red') }) })
    await createAIConsentGuard(d).before('chat.send', {})
    expect(d.ask).not.toHaveBeenCalled()
  })
})
