// El aviso de la IA de terceros, del lado del Mac: sin aceptarlo, un dispositivo no manda nada a la IA.
import { describe, expect, it } from 'vitest'
import type { AIRecipient } from '@shared/ai/recipient'
import { acceptConsent, consentRefusal, consentState, type AIConsentDeps } from './ai-consent'

const ANTHROPIC: AIRecipient = { id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] }
const DEEPSEEK: AIRecipient = { id: 'deepseek', name: 'DeepSeek', uses: ['answers'] }

function fake(recipients: AIRecipient[]): AIConsentDeps & { now: AIRecipient[]; store: Map<string, string[]> } {
  const store = new Map<string, string[]>()
  const d = {
    now: recipients,
    store,
    recipients: async () => d.now,
    accepted: (id: string) => store.get(id) ?? [],
    accept: (id: string, ids: string[]) => { store.set(id, [...new Set([...(store.get(id) ?? []), ...ids])]); return true }
  }
  return d
}

describe('aviso de la IA de terceros (Mac)', () => {
  it('sin destinatarios no hace falta', async () => {
    expect(await consentState(fake([]), 'd1')).toEqual({ needed: false, recipients: [] })
    expect(await consentRefusal(fake([]), 'd1', 'chat.send', {})).toBeNull()
  })

  it('aceptar con otros destinatarios que los de ahora se rechaza con el estado nuevo', async () => {
    const d = fake([ANTHROPIC])
    await expect(acceptConsent(d, 'd1', { ids: ['openai'] })).rejects.toMatchObject({ code: 'ai_consent', details: { needed: true, recipients: [ANTHROPIC] } })
    await expect(acceptConsent(d, 'd1', { ids: ['anthropic'], extra: true })).rejects.toMatchObject({ code: 'invalid_args' })
    expect(d.store.size).toBe(0)
  })

  it('con los de ahora queda apuntado y deja de pedirse; al cambiar de IA, se vuelve a pedir', async () => {
    const d = fake([ANTHROPIC])
    expect(await consentRefusal(d, 'd1', 'chat.send', {})).toMatchObject({ code: 'ai_consent', details: { needed: true } })
    expect(await acceptConsent(d, 'd1', { ids: ['anthropic'] })).toEqual({ needed: false, recipients: [ANTHROPIC] })
    expect(await consentRefusal(d, 'd1', 'chat.send', {})).toBeNull()
    // otro dispositivo, aparte
    expect(await consentRefusal(d, 'd2', 'chat.send', {})).not.toBeNull()
    d.now = [DEEPSEEK]
    expect(await consentRefusal(d, 'd1', 'chat.send', {})).toMatchObject({ details: { recipients: [DEEPSEEK] } })
  })

  it('importar a Documentos pide el aviso: una grabación se transcribe con un servicio de terceros', async () => {
    const whisper: AIRecipient = { id: 'openai', name: 'OpenAI', uses: ['recordings'] }
    const args = { paths: ['aula-upload://u1/clase.m4a'] }
    expect(await consentRefusal(fake([whisper]), 'd1', 'documents.import', args)).toMatchObject({ code: 'ai_consent', details: { recipients: [whisper] } })
    // sin nadie que transcriba ni responda, pasa
    expect(await consentRefusal(fake([]), 'd1', 'documents.import', args)).toBeNull()
  })

  it('lo que no manda nada a la IA nunca se para', async () => {
    expect(await consentRefusal(fake([ANTHROPIC]), 'd1', 'courses.list', undefined)).toBeNull()
    expect(await consentRefusal(fake([ANTHROPIC]), 'd1', 'settings.update', { general: { theme: 'dark' } })).toBeNull()
    expect(await consentRefusal(fake([ANTHROPIC]), 'd1', 'settings.update', { persistent: { enabled: true } })).not.toBeNull()
  })

  it('encender una rutina con IA o reanudar «Aula siempre activa» se para sin el aviso; pausar o una rutina ligera, no', async () => {
    const d = fake([ANTHROPIC])
    expect(await consentRefusal(d, 'd1', 'automations.setProactive', { patch: { platformCheck: true } })).toMatchObject({ code: 'ai_consent', details: { needed: true } })
    expect(await consentRefusal(d, 'd1', 'automations.setProactive', { patch: { followups: true } })).toMatchObject({ code: 'ai_consent' })
    expect(await consentRefusal(d, 'd1', 'automations.pause', { until: null })).toMatchObject({ code: 'ai_consent' })
    expect(await consentRefusal(d, 'd1', 'automations.setProactive', { patch: { deadlineReminders: true } })).toBeNull()
    expect(await consentRefusal(d, 'd1', 'automations.pause', { until: '2026-11-18T07:00:00.000Z' })).toBeNull()
    await acceptConsent(d, 'd1', { ids: ['anthropic'] })
    expect(await consentRefusal(d, 'd1', 'automations.pause', { until: null })).toBeNull()
  })
})
