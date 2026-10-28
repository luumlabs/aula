import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS } from '@main/services/ai/presets'
import { BRAND_LOGOS } from './logos'
import { isBrandLogo, logoForBaseURL, logoForModel, logoForProvider, logoForText } from './resolve'

describe('logoForProvider', () => {
  it('da un logo propio a cada preset (solo «Personalizado» lleva el genérico)', () => {
    for (const p of PROVIDER_PRESETS) {
      const logo = logoForProvider({ id: p.id, kind: p.kind, baseURL: p.baseURL, label: p.label.es })
      if (p.id === 'custom') expect(logo).toBe('custom')
      else expect(logo, p.id).not.toBe('custom')
    }
  })

  it('separa la suscripción de la API y cada marca de su servicio', () => {
    expect(logoForProvider({ id: 'claude-cli' })).toBe('claude')
    expect(logoForProvider({ id: 'anthropic' })).toBe('anthropic')
    expect(logoForProvider({ id: 'codex-cli' })).toBe('chatgpt')
    expect(logoForProvider({ id: 'openai' })).toBe('openai')
    expect(logoForProvider({ id: 'mimo' })).toBe('xiaomi')
    expect(logoForProvider({ id: 'xai' })).toBe('grok')
    expect(logoForProvider({ id: 'opencode-zen' })).toBe('opencode')
    expect(logoForProvider({ id: 'aula-local' })).toBe('aula')
  })

  it('un servicio propio con la URL de un proveedor conocido lleva su logo; si no, el genérico', () => {
    expect(logoForProvider({ id: 'custom', kind: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1' })).toBe('deepseek')
    expect(logoForProvider({ id: 'custom', kind: 'openai-compatible', baseURL: 'https://api.together.xyz/v1', label: 'Groq clon' })).toBe('custom')
    expect(logoForProvider({ id: 'custom-abc', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1' })).toBe('ollama')
    expect(logoForProvider({ id: 'otro', kind: 'openai-compatible', label: 'Mistral (mi pasarela)' })).toBe('mistral')
    expect(logoForProvider({})).toBe('custom')
  })

  it('el tipo manda cuando el id no es de un preset', () => {
    expect(logoForProvider({ id: 'x', kind: 'claude-cli' })).toBe('claude')
    expect(logoForProvider({ id: 'x', kind: 'lmstudio' })).toBe('lmstudio')
  })
})

describe('logoForBaseURL', () => {
  it('reconoce hosts y subdominios, no hosts que solo se parecen', () => {
    expect(logoForBaseURL('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('gemini')
    expect(logoForBaseURL('https://token-plan-sgp.xiaomimimo.com/v1')).toBe('xiaomi')
    expect(logoForBaseURL('https://api.x.ai/v1')).toBe('grok')
    expect(logoForBaseURL('https://notopenai.com/v1')).toBeNull()
    expect(logoForBaseURL('http://127.0.0.1:1234/v1')).toBe('lmstudio')
    expect(logoForBaseURL('http://localhost:8080/v1')).toBeNull()
    expect(logoForBaseURL('no es una url')).toBeNull()
    expect(logoForBaseURL(undefined)).toBeNull()
  })
})

describe('logoForText', () => {
  it('lee el nombre que guarda una creación de curso', () => {
    expect(logoForText('Claude (suscripción) · modelo predeterminado')).toBe('claude')
    expect(logoForText('ChatGPT (Codex) · gpt-6-sol')).toBe('chatgpt')
    expect(logoForText('OpenAI · gpt-6-sol')).toBe('openai')
    expect(logoForText('Modelo de Aula (en este ordenador)')).toBe('aula')
    expect(logoForText('LM Studio (on this computer)')).toBe('lmstudio')
    expect(logoForText('Falso · fake-1')).toBeNull()
    expect(logoForText('')).toBeNull()
  })
})

describe('logoForModel', () => {
  it('usa el creador del prefijo o la familia del modelo', () => {
    expect(logoForModel('deepseek/deepseek-v4.1-flash')).toBe('deepseek')
    expect(logoForModel('anthropic/claude-sonnet-5.5')).toBe('claude')
    expect(logoForModel('openai/gpt-oss-120b')).toBe('openai')
    expect(logoForModel('moonshotai/kimi-k3')).toBe('kimi')
    expect(logoForModel('qwen3.5:9b')).toBe('qwen')
    expect(logoForModel('gpt-oss:20b')).toBe('openai')
    expect(logoForModel('claude-opus-5-5')).toBe('claude')
    expect(logoForModel('gemini-flash-latest')).toBe('gemini')
    expect(logoForModel('mimo-v2.6-flash-free')).toBe('xiaomi')
    expect(logoForModel('glm-5.3')).toBe('zai')
    expect(logoForModel('o4-mini')).toBe('openai')
    expect(logoForModel('magistral-medium-latest')).toBe('mistral')
    expect(logoForModel('vendor/rare-model')).toBeNull()
    expect(logoForModel('')).toBeNull()
  })
})

describe('BRAND_LOGOS', () => {
  it('son trazos limpios con su caja, nombre y fuente', () => {
    for (const [id, l] of Object.entries(BRAND_LOGOS)) {
      expect(isBrandLogo(id as keyof typeof BRAND_LOGOS)).toBe(true)
      expect(l.name.length, id).toBeGreaterThan(1)
      expect(l.source.length, id).toBeGreaterThan(5)
      expect(l.viewBox.split(' ').map(Number).every(Number.isFinite), id).toBe(true)
      expect(l.paths.length, id).toBeGreaterThan(0)
      for (const d of l.paths) expect(d, id).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/)
      if (l.color) expect(l.color, id).toMatch(/^#[0-9A-F]{6}$/)
    }
    expect(isBrandLogo('aula')).toBe(false)
    expect(isBrandLogo('custom')).toBe(false)
  })
})
