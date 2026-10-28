// Port de Tests/AIKitTests/ModelCatalogTests.swift (y la caché con caducidad): listas de modelos con el formato oficial de cada API.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setAILocale } from '@shared/ai/i18n'
import { prettyModelName } from '@shared/ai/models'
import { setDataRoot } from '../../paths'
import { configFromPreset, presetById, PROVIDER_PRESETS } from '../presets'
import type { ProviderConfig } from '../providers/config'
import { jsonReply, mockFetch, testDeps, type MockReply, type RecordedRequest } from '../testing/mocks'
import { fetchModelCatalog, KNOWN_MODELS, parseModelInfos } from './catalogs'
import { cachedCatalog, clearCatalogMemory, providerCatalog } from './cache'

const TEST_KEY = 'sk-test-1234567890abcdefXYZ'
const preset = (id: string): ProviderConfig => configFromPreset(presetById(id)!, presetById(id)!.label.es)
const deps = (cfg: ProviderConfig, script: MockReply[] | ((r: RecordedRequest, i: number) => MockReply), withKey = true) => {
  const mf = mockFetch(script)
  return { mf, deps: testDeps(mf.fetch, withKey && cfg.secretRef ? { [cfg.secretRef]: TEST_KEY } : {}) }
}

let root: string
beforeEach(() => {
  setAILocale('es')
  root = mkdtempSync(join(tmpdir(), 'aula-catalog-'))
  setDataRoot(root)
  clearCatalogMemory()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('formatos de cada API', () => {
  it('niveles de razonamiento publicados (también el razonamiento obligatorio)', () => {
    const models = parseModelInfos(JSON.parse('{"data":[{"id":"vendor/one","reasoning":{"supported_efforts":["max","high","low","none"],"default_effort":"high","mandatory":true}},{"id":"vendor/two","reasoning":{"supported_efforts":null}},{"id":"deepseek-flash","effort":{"supported_levels":["low","high","max"],"default_level":"high"}}]}'))
    expect(models[0].reasoningCapabilities).toEqual({ efforts: ['max', 'high', 'low'], defaultEffort: 'high' })
    expect(models[1].reasoningCapabilities?.efforts).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(models[2].reasoningCapabilities?.efforts).toEqual(['none', 'low', 'high', 'max'])
  })
  it('OpenAI: quita lo que no es de chat y pone el recomendado primero', async () => {
    const cfg = preset('openai')
    const { mf, deps: d } = deps(cfg, [jsonReply('{"object":"list","data":[{"id":"gpt-6-luna","object":"model","created":1758499200,"owned_by":"openai"},{"id":"text-embedding-3-small","object":"model","created":1,"owned_by":"system"},{"id":"gpt-6-sol","object":"model","created":1758499200,"owned_by":"openai"},{"id":"gpt-image-1","object":"model","created":1,"owned_by":"system"},{"id":"gpt-6-astra","object":"model","created":1756857600,"owned_by":"openai"}]}')])
    const c = await fetchModelCatalog(cfg, d)
    expect(c.source).toBe('api')
    expect(c.models.map((m) => m.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'])
    expect(c.models[0].created).toBeDefined()
    expect(mf.requests[0].url).toBe('https://api.openai.com/v1/models')
    expect(mf.requests[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`)
  })
  it('Anthropic: nombres, contexto e imágenes', async () => {
    const cfg = preset('anthropic')
    const { mf, deps: d } = deps(cfg, [jsonReply('{"data":[{"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5","created_at":"2026-09-21T00:00:00Z","max_input_tokens":1000000,"max_tokens":128000,"capabilities":{"image_input":{"supported":true}}},{"type":"model","id":"claude-sonnet-5-5","display_name":"Claude Sonnet 5.5","created_at":"2026-09-01T00:00:00Z","max_input_tokens":1000000,"max_tokens":128000,"capabilities":{"image_input":{"supported":true}}}],"has_more":false,"first_id":"claude-opus-5-5","last_id":"claude-sonnet-5-5"}')])
    const c = await fetchModelCatalog(cfg, d)
    expect(c.models.map((m) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
    expect(c.models[0]).toMatchObject({ displayName: 'Claude Sonnet 5.5', contextLength: 1_000_000, maxOutputTokens: 128_000, supportsVision: true })
    expect(mf.requests[0].headers['x-api-key']).toBe(TEST_KEY)
    expect(mf.requests[0].url).toContain('limit=1000')
    // sin niveles publicados se usan los conocidos de la documentación
    expect(c.models[0].reasoningCapabilities?.efforts).toContain('xhigh')
  })
  it('DeepSeek: contexto y modalidades', async () => {
    const cfg = preset('deepseek')
    const { mf, deps: d } = deps(cfg, [jsonReply('{"object":"list","data":[{"id":"deepseek-flash","object":"model","owned_by":"deepseek","name":"DeepSeek-V4.1-Flash","context_window":1048576,"max_output_tokens":393216,"input_modalities":["text","image"]},{"id":"deepseek-v4-pro","object":"model","owned_by":"deepseek","name":"DeepSeek-V4-Pro","context_window":1048576,"input_modalities":["text"]}]}')])
    const c = await fetchModelCatalog(cfg, d)
    expect(c.models[0]).toMatchObject({ id: 'deepseek-flash', displayName: 'DeepSeek-V4.1-Flash', contextLength: 1_048_576, supportsVision: true })
    expect(c.models.at(-1)!.supportsVision).toBe(false)
    expect(mf.requests[0].url).toBe('https://api.deepseek.com/v1/models')
  })
  it('OpenRouter: precios y los dos Top 10', async () => {
    const cfg = preset('openrouter')
    const model = (id: string, prompt: string, completion: string, tools: boolean, image = false) =>
      `{"id":"${id}","name":"${id}","context_length":262144,"pricing":{"prompt":"${prompt}","completion":"${completion}"},"architecture":{"input_modalities":["text"${image ? ',"image"' : ''}],"output_modalities":["text"]},"supported_parameters":[${tools ? '"tools","tool_choice"' : '"temperature"'}],"top_provider":{"max_completion_tokens":65536}}`
    const all = [model('anthropic/claude-sonnet-5.5', '0.000002', '0.00001', true, true), model('deepseek/deepseek-v4.1-flash', '0.00000015', '0.0000006', true),
      model('meta/llama-free-chat:free', '0', '0', false), model('xiaomi/mimo-v2.6-flash:free', '0', '0', true), model('openrouter/auto', '-1', '-1', true)]
    const ranked = [all[1], all[2], all[3], all[0]]
    const { mf, deps: d } = deps(cfg, (r) => jsonReply(`{"data":[${(r.url.includes('sort=top-weekly') ? ranked : all).join(',')}]}`))
    const c = await fetchModelCatalog(cfg, d)
    expect(c.popular.map((m) => m.id)).toEqual(['deepseek/deepseek-v4.1-flash', 'anthropic/claude-sonnet-5.5'])
    expect(c.free.map((m) => m.id)).toEqual(['xiaomi/mimo-v2.6-flash:free', 'meta/llama-free-chat:free'])
    const claude = c.models.find((m) => m.id === 'anthropic/claude-sonnet-5.5')!
    expect(claude.inputPricePerMillion).toBeCloseTo(2, 9)
    expect(claude.outputPricePerMillion).toBeCloseTo(10, 9)
    expect(claude).toMatchObject({ supportsTools: true, supportsVision: true, maxOutputTokens: 65_536 })
    const auto = c.models.find((m) => m.id === 'openrouter/auto')!
    expect(auto.inputPricePerMillion).toBeUndefined()
    expect(auto.isFree).toBe(false)
    expect(c.models[0].id).toBe('deepseek/deepseek-v4.1-flash')
    expect(c.models.at(-1)!.supportsTools).toBe(false)
    expect(mf.requests.some((r) => r.url === 'https://openrouter.ai/api/v1/models?sort=top-weekly')).toBe(true)
  })
  it('OpenRouter sin la clasificación sigue dando los gratuitos', async () => {
    const cfg = preset('openrouter')
    const { deps: d } = deps(cfg, (r) => (r.url.includes('sort=') ? jsonReply('{"error":{"message":"boom"}}', 500)
      : jsonReply('{"data":[{"id":"a/b:free","pricing":{"prompt":"0","completion":"0"},"supported_parameters":["tools"]},{"id":"c/d","pricing":{"prompt":"0.000001","completion":"0.000002"}}]}')))
    const c = await fetchModelCatalog(cfg, d)
    expect(c.popular).toEqual([])
    expect(c.free.map((m) => m.id)).toEqual(['a/b:free'])
    expect(c.source).toBe('api')
  })
  it('sin respuesta, los modelos conocidos con el motivo (y sin clave no se llama)', async () => {
    const cfg = preset('mimo')
    const { mf, deps: d } = deps(cfg, [jsonReply('{"error":{"message":"Invalid API Key"}}', 401)])
    const c = await fetchModelCatalog(cfg, d)
    expect(c.source).toBe('known')
    expect(c.models.map((m) => m.id)).toEqual(['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'])
    expect(c.problem).toContain('401')
    const none = deps(cfg, [jsonReply('{}')], false)
    expect((await fetchModelCatalog(cfg, none.deps)).source).toBe('known')
    expect(none.mf.requests).toHaveLength(0)
    expect(mf.requests).toHaveLength(1)
  })
  it('LM Studio, Ollama nativo y los conocidos de cada preset de API', async () => {
    const lm: ProviderConfig = { ...preset('lmstudio'), model: '' }
    const { deps: d } = deps(lm, [jsonReply('{"data":[{"id":"qwen/qwen3.5-9b","object":"model","owned_by":"organization_owner"},{"id":"text-embedding-nomic-embed-text-v1.5","object":"model"}]}')], false)
    expect((await fetchModelCatalog(lm, d)).models.map((m) => m.id)).toEqual(['qwen/qwen3.5-9b'])
    expect(parseModelInfos(JSON.parse('{"models":[{"name":"gemma4","model":"gemma4","size":9608350245,"details":{"family":"gemma4","parameter_size":"8.0B"}}]}')).map((m) => m.id)).toEqual(['gemma4'])
    for (const p of PROVIDER_PRESETS) {
      if (!['openai-compatible', 'anthropic', 'ollama'].includes(p.kind) || p.id === 'custom' || !p.model) continue
      expect(KNOWN_MODELS[p.id]?.[0]?.id, p.id).toBe(p.model)
    }
  })
  it('nombres para personas', () => {
    expect(prettyModelName('gpt-6-sol')).toBe('GPT-6 Sol')
    expect(prettyModelName('gpt-6.1-sol')).toBe('GPT-6.1 Sol')
    expect(prettyModelName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5')
    expect(prettyModelName('deepseek/deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash')
    expect(prettyModelName('mimo-v2.6-flash')).toBe('MiMo V2.6 Flash')
    expect(prettyModelName('qwen3.5:9b')).toBe('Qwen3.5 9B')
    expect(prettyModelName('gpt-oss:20b')).toBe('gpt-oss 20B')
    expect(prettyModelName('llama3.2:latest')).toBe('Llama3.2')
  })
})

describe('caché con caducidad (<datos>/Cache/ai-models)', () => {
  const list = '{"data":[{"id":"deepseek-flash"},{"id":"deepseek-v4-pro"}]}'
  it('la copia vale 6 h; refresh la vuelve a pedir; si la API falla, la copia vieja con el motivo', async () => {
    const cfg = preset('deepseek')
    const { mf, deps: d } = deps(cfg, [jsonReply(list), jsonReply(list), jsonReply('{"error":{"message":"caído"}}', 401)])
    const now = Date.now()
    const a = await providerCatalog(cfg, { deps: d, now })
    expect(a.source).toBe('api')
    await providerCatalog(cfg, { deps: d, now: now + 60_000 })
    expect(mf.requests).toHaveLength(1)
    await providerCatalog(cfg, { deps: d, now: now + 7 * 3600_000 })
    expect(mf.requests).toHaveLength(2)
    const stale = await providerCatalog(cfg, { deps: d, now: now + 20 * 3600_000, refresh: true })
    expect(stale.source).toBe('api')
    expect(stale.problem).toBeDefined()
    // la copia sobrevive a la memoria (está en disco)
    clearCatalogMemory()
    expect(cachedCatalog(cfg)?.models.map((m) => m.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    // otra dirección: la copia no vale
    expect(cachedCatalog({ ...cfg, baseURL: 'https://otra.example.com/v1' })).toBeNull()
  })
})
