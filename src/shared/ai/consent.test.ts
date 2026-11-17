// El aviso de la IA de terceros: qué llamadas mandan algo a la IA y cómo se apunta y se comprueba lo aceptado.
import { describe, expect, it } from 'vitest'
import { asConsentState, cleanConsentIds, consentNeeded, mergeAccepted, sameIds, sendsToAI } from './consent'
import type { AIRecipient } from './recipient'

const R = (id: string): AIRecipient => ({ id, name: id, uses: ['answers'] })

describe('sendsToAI', () => {
  it('lo que siempre manda algo a la IA', () => {
    for (const m of ['chat.send', 'chat.retry', 'chat.continue', 'chat.answerCard', 'create.addFiles', 'create.addText', 'create.addURL', 'create.start',
      'generation.extend', 'generation.resume', 'generation.answer', 'study.gradeOpen', 'documents.aiStart', 'documents.import', 'live.give',
      'automations.runNow', 'automations.save', 'ai.chatStream']) expect(sendsToAI(m, undefined), m).toBe(true)
  })

  it('lo que no', () => {
    for (const m of ['chat.suggestions', 'calendar.quickAdd', 'search.query', 'study.prepareMore', 'study.submitExam', 'memory.add', 'documents.open', 'courses.list']) {
      expect(sendsToAI(m, {}), m).toBe(false)
    }
  })

  it('encender una automatización o «Aula siempre activa», sí; apagarla o lo demás, no', () => {
    expect(sendsToAI('settings.update', { persistent: { enabled: true } })).toBe(true)
    expect(sendsToAI('settings.update', { persistent: { enabled: false } })).toBe(false)
    expect(sendsToAI('settings.update', { persistent: { quietHours: null } })).toBe(false)
    expect(sendsToAI('settings.update', { general: { theme: 'dark' } })).toBe(false)
    expect(sendsToAI('automations.setEnabled', { id: 'a', enabled: true })).toBe(true)
    expect(sendsToAI('automations.setEnabled', { id: 'a', enabled: false })).toBe(false)
    expect(sendsToAI('automations.setProactive', { patch: { enabled: true } })).toBe(true)
    expect(sendsToAI('automations.setProactive', { patch: { enabled: false } })).toBe(false)
    expect(sendsToAI('automations.setProactive', null)).toBe(false)
  })

  it('encender una rutina con IA o los seguimientos, sí; las ligeras, apagarlas o ajustar horas, no', () => {
    for (const k of ['morningBrief', 'platformCheck', 'prepareAhead', 'weeklySummary', 'followups']) {
      expect(sendsToAI('automations.setProactive', { patch: { [k]: true } }), k).toBe(true)
      expect(sendsToAI('automations.setProactive', { patch: { [k]: false } }), k).toBe(false)
    }
    for (const k of ['deadlineReminders', 'examOffers', 'notifications', 'dockBadge']) expect(sendsToAI('automations.setProactive', { patch: { [k]: true } }), k).toBe(false)
    expect(sendsToAI('automations.setProactive', { patch: { morningTime: '07:45', dailyTokenLimit: 200_000 } })).toBe(false)
    expect(sendsToAI('automations.setProactive', { patch: { examOffers: true, weeklySummary: true } })).toBe(true)
    expect(sendsToAI('automations.setProactive', { patch: ['enabled'] })).toBe(false)
  })

  it('reanudar «Aula siempre activa» tras una pausa, sí; pausarla, no', () => {
    expect(sendsToAI('automations.pause', { until: null })).toBe(true)
    expect(sendsToAI('automations.pause', { until: '2026-11-18T07:00:00.000Z' })).toBe(false)
    expect(sendsToAI('automations.pause', {})).toBe(false)
    expect(sendsToAI('automations.pause', undefined)).toBe(false)
  })
})

describe('lo aceptado', () => {
  it('falta aceptar a alguno', () => {
    expect(consentNeeded([R('anthropic')], [])).toBe(true)
    expect(consentNeeded([R('anthropic')], ['anthropic'])).toBe(false)
    expect(consentNeeded([R('anthropic'), R('openai')], ['anthropic'])).toBe(true)
    expect(consentNeeded([R('anthropic')], ['openai', 'anthropic'])).toBe(false)
    expect(consentNeeded([], [])).toBe(false)
  })

  it('se une sin repetir y con tope', () => {
    expect(mergeAccepted(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(mergeAccepted(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd'])
    expect(mergeAccepted([], ['x'])).toEqual(['x'])
  })

  it('sameIds compara como conjuntos', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameIds(['a'], ['a', 'b'])).toBe(false)
    expect(sameIds([], [])).toBe(true)
  })
})

describe('cleanConsentIds', () => {
  it('acepta exactamente { ids } con identificadores razonables', () => {
    expect(cleanConsentIds({ ids: ['anthropic', 'host:ai.example.com', 'provider:custom-1', 'host:[fd00::1]'] })).toEqual(['anthropic', 'host:ai.example.com', 'provider:custom-1', 'host:[fd00::1]'])
  })

  it('rechaza lo demás', () => {
    for (const bad of [null, [], 'anthropic', { ids: [] }, { ids: ['a'], extra: 1 }, { ids: Array.from({ length: 11 }, (_, i) => `a${i}`) }, { ids: ['a b'] },
      { ids: ['<script>'] }, { ids: ['x'.repeat(121)] }, { ids: ['a', 'a'] }, { ids: [3] }, { ids: 'a' }]) {
      expect(cleanConsentIds(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('asConsentState', () => {
  it('lee el estado de los detalles de un error', () => {
    expect(asConsentState({ needed: true, recipients: [{ id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers', 'otro'] }] })).toEqual({
      needed: true, recipients: [{ id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] }]
    })
    expect(asConsentState({ needed: false, recipients: [] })).toEqual({ needed: false, recipients: [] })
  })

  it('una forma rara es null', () => {
    for (const bad of [null, undefined, 'x', { needed: 'yes', recipients: [] }, { needed: true }, { needed: true, recipients: [{ id: 3 }] }]) expect(asConsentState(bad)).toBeNull()
  })
})
