// Port de Tests/AIKitTests/ProviderPresetsTests.swift y ProviderURLSchemeTests.swift: los proveedores preconfigurados y el
// esquema implícito de las URL base.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { defaultScheme } from '@shared/ai/urlScheme'
import { baseURLParts, openAIChatURL, openAIModelsURL, anthropicMessagesURL, openAIResponsesURL, anthropicModelsURL } from './http/endpoints'
import { configFromPreset, modernized, presetById, PROVIDER_PRESETS } from './presets'
import { looksSpanish } from './testing/mocks'

beforeEach(() => setAILocale('es'))

const p = (id: string) => {
  const preset = presetById(id)
  if (!preset) throw new Error(`falta el preset «${id}»`)
  return preset
}

describe('presets', () => {
  it('ids estables y sin repetir; búsqueda exacta', () => {
    const ids = PROVIDER_PRESETS.map((x) => x.id)
    expect(new Set(ids)).toEqual(new Set(['claude-cli', 'codex-cli', 'opencode-cli', 'anthropic', 'openai', 'openrouter', 'deepseek', 'mimo', 'gemini', 'mistral',
      'groq', 'xai', 'opencode-zen', 'aula-local', 'ollama', 'lmstudio', 'custom']))
    expect(ids.length).toBe(new Set(ids).size)
    expect(presetById('no-existe')).toBeUndefined()
    expect(presetById('')).toBeUndefined()
    expect(presetById('DeepSeek')).toBeUndefined()
  })
  it('DeepSeek, MiMo, OpenRouter, OpenAI, Anthropic, Zen y Ollama', () => {
    expect(p('deepseek')).toMatchObject({ kind: 'openai-compatible', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', usesKey: true, supportsTools: true })
    expect(p('deepseek').help.es).toContain('deepseek-chat')
    expect(p('mimo')).toMatchObject({ baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', usesKey: true })
    expect(p('openrouter').baseURL).toBe('https://openrouter.ai/api/v1')
    expect(p('openrouter').extraHeaders).toEqual({ 'HTTP-Referer': 'https://aula.local', 'X-OpenRouter-Title': 'Aula', 'X-Title': 'Aula' })
    expect(p('openrouter').model).toContain('/')
    expect(p('openai')).toMatchObject({ baseURL: 'https://api.openai.com/v1', kind: 'openai-compatible' })
    expect(p('anthropic')).toMatchObject({ kind: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' })
    expect(p('opencode-zen').baseURL).toBe('https://opencode.ai/inference/v1')
    expect(p('ollama')).toMatchObject({ baseURL: 'http://localhost:11434/v1', usesKey: false })
    expect(p('ollama').model).not.toBe('')
    expect(p('custom')).toMatchObject({ kind: 'openai-compatible', baseURL: '', model: '' })
  })
  it('las CLIs: modelo vacío, sin clave ni dirección', () => {
    for (const id of ['claude-cli', 'codex-cli', 'opencode-cli']) {
      expect(p(id)).toMatchObject({ kind: id, model: '', usesKey: false, group: 'subscription' })
      expect(p(id).baseURL).toBeUndefined()
    }
  })
  it('cada preset tiene ayuda en los dos idiomas; las APIs dicen dónde está la clave y qué modelo conviene', () => {
    for (const c of PROVIDER_PRESETS) {
      expect(c.help.es.length, c.id).toBeGreaterThan(80)
      expect(looksSpanish(c.help.es), c.id).toBe(true)
      expect(c.help.en.length, c.id).toBeGreaterThan(80)
      expect(c.help.es).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    }
    for (const id of ['deepseek', 'mimo', 'openrouter', 'openai', 'anthropic', 'opencode-zen', 'gemini', 'mistral', 'groq']) {
      const h = p(id).help.es
      expect(h.includes('.com') || h.includes('.ai'), id).toBe(true)
      expect(h, id).toContain('«')
      expect(p(id).keyURL, id).toMatch(/^https:\/\//)
    }
  })
  it('direcciones válidas y normalizables; sin barra final', () => {
    for (const c of PROVIDER_PRESETS) {
      if (!c.baseURL) continue
      if (c.kind === 'anthropic') expect(() => anthropicMessagesURL(c.baseURL)).not.toThrow()
      else {
        expect(() => openAIChatURL(c.baseURL), c.id).not.toThrow()
        expect(() => openAIModelsURL(c.baseURL), c.id).not.toThrow()
      }
      expect(c.baseURL.endsWith('/'), c.id).toBe(false)
    }
  })
  it('las APIs remotas necesitan clave y las locales no; ventanas sensatas', () => {
    for (const c of PROVIDER_PRESETS) {
      if (c.group === 'api') expect(c.usesKey, c.id).toBe(true)
      if (c.kind === 'ollama' || c.kind === 'aula-local' || c.group === 'subscription') expect(c.usesKey, c.id).toBe(false)
      if (c.contextWindow !== undefined) {
        expect(c.contextWindow).toBeGreaterThanOrEqual(8192)
        expect(c.contextWindow).toBeLessThanOrEqual(1_000_000)
      }
      if (c.maxOutputTokens !== undefined) expect(c.maxOutputTokens).toBeGreaterThan(1000)
    }
  })
  it('configuración del preset: activado, con streaming y su referencia de clave', () => {
    for (const c of PROVIDER_PRESETS) {
      const cfg = configFromPreset(c, c.label.es)
      expect(cfg.enabled).toBe(true)
      expect(cfg.supportsStreaming).toBe(true)
      expect(cfg.secretRef).toBe(c.usesKey ? `ai.key.${c.id}` : null)
    }
    expect(p('openai').extraHeaders).toEqual({ 'x-aula-idle-timeout': '240' })
  })
  it('modelos retirados al día (también en personalizados que apuntan a DeepSeek)', () => {
    const c = configFromPreset(p('deepseek'), 'DeepSeek')
    for (const old of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash']) expect(modernized({ ...c, model: old }).model).toBe('deepseek-flash')
    expect(modernized({ ...c, model: 'deepseek-v4-pro' }).model).toBe('deepseek-v4-pro')
    expect(modernized({ ...c, id: 'mi-deepseek', model: 'deepseek-chat' }).model).toBe('deepseek-flash')
    expect(modernized({ ...c, id: 'otro', baseURL: 'https://api.openai.com/v1', model: 'deepseek-chat' }).model).toBe('deepseek-chat')
    const oa = configFromPreset(p('openai'), 'OpenAI')
    expect(modernized(oa)).toEqual(oa)
  })
})

describe('esquema implícito de la URL base', () => {
  const scheme = (input: string) => baseURLParts(input).scheme
  it('prefijos de hosts remotos van por https en todas las direcciones', () => {
    for (const input of ['localhost.attacker.example/v1', '127.0.0.1.attacker.example/v1', '0.0.0.0.attacker.example/v1', 'localhost-other.invalid/v1']) {
      for (const url of [openAIChatURL(input), openAIResponsesURL(input), openAIModelsURL(input), anthropicMessagesURL(input), anthropicModelsURL(input)]) {
        expect(url.startsWith('https://'), input).toBe(true)
      }
    }
  })
  it('el usuario, el fragmento o la ruta no eligen el esquema', () => {
    for (const input of ['localhost@remote.invalid/v1', 'printer.local:8443@remote.invalid/v1', 'user:password.local@remote.invalid/v1']) {
      const c = baseURLParts(input)
      expect(c.scheme, input).toBe('https')
      expect(c.hostname).toBe('remote.invalid')
    }
    expect(scheme('user@localhost:11434/v1?api-version=2')).toBe('http')
    for (const input of ['remote.invalid#printer.local', 'remote.invalid#printer.local:8443', 'remote.invalid/printer.local:8443/v1']) {
      expect(scheme(input), input).toBe('https')
      expect(baseURLParts(input).hostname).toBe('remote.invalid')
    }
  })
  it('IPv4 no válidas, ambiguas o con ceros iniciales no son locales', () => {
    for (const input of ['127.256.0.1/v1', '127.0.0.999/v1', '127.-1.0.1/v1', '127.0.0.1x/v1', '0127.0.0.1/v1', '00127.0.0.1/v1', '127.00.0.1/v1', '127.0.0.01/v1', '127.1/v1', '127.0.1/v1', '2130706433/v1', '0x7f.0.0.1/v1']) {
      expect(defaultScheme(input), input).toBe('https')
    }
  })
  it('hosts locales válidos mantienen http; las redes privadas no lo ganan', () => {
    for (const input of ['localhost:11434/v1', 'LOCALHOST:1234/v1', 'localhost./v1', '127.0.0.1:8000/v1', '127.9.8.7/v1', '0.0.0.0:8080/v1', '[::1]:11434/v1', 'mi-mac.local:1234/v1', 'OTHER.LOCAL/v1']) {
      expect(defaultScheme(input), input).toBe('http')
    }
    for (const input of ['10.0.0.5:8000/v1', '172.20.1.1/v1', '192.168.1.20/v1', '[2001:db8::1]:8443/v1', 'service.local.attacker.example/v1']) {
      expect(defaultScheme(input), input).toBe('https')
    }
  })
  it('un esquema explícito se respeta; la consulta y el puerto van con su host', () => {
    expect(scheme('http://remote.invalid/v1')).toBe('http')
    expect(scheme('https://localhost:11434/v1')).toBe('https')
    // (`http://127.256.0.1` no es una URL válida para WHATWG URL: a diferencia de Swift, se rechaza)
    expect(scheme('HTTPS://localhost.attacker.example/v1?api-version=2#x')).toBe('https')
    const remote = baseURLParts('remote.invalid:8443/v1?server=localhost&next=printer.local:1234')
    expect(remote).toMatchObject({ scheme: 'https', hostname: 'remote.invalid', port: '8443', search: '?server=localhost&next=printer.local:1234' })
    const local = baseURLParts('mi-mac.local:1234/v1?api-version=2#fragment')
    expect(local).toMatchObject({ scheme: 'http', port: '1234', search: '?api-version=2' })
  })
  it('entradas no válidas se rechazan', () => {
    for (const input of ['', 'http://', 'https://', 'ftp://remote.invalid/v1']) expect(() => baseURLParts(input), input).toThrow()
    expect(openAIChatURL('  "api.example/v1" \n').startsWith('https://')).toBe(true)
  })
})
