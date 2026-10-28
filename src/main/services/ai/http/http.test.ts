// Port de Tests/AIKitTests/HTTPSupportTests.swift: direcciones, Retry-After, errores de los proveedores, redactor, reintentos,
// plazos, opciones locales, utilidades JSON y reparación del historial de herramientas.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { msg, type ChatMessage, type ToolCall } from '@shared/ai/types'
import { AIError, isCancellation, isContextLengthError, looksLikeToolRejection } from '../errors'
import { anthropicMessagesURL, anthropicModelsURL, hostOf, openAIChatURL, openAIModelsURL, openAIResponsesURL, isLocalOrPrivateHost } from './endpoints'
import { durationSeconds, retryAfterSeconds } from './retryAfter'
import { fromHTTP, fromStreamError, fromTransport, parseErrorBody, type ErrorContext } from './providerErrors'
import { scrubSecrets } from './redactor'
import { backoffDelay, defaultHTTPOptions, RetryableFailure, startIdleWatch, withRetry, ActivityTracker } from './options'
import { LocalFlags, sanitizedExtraHeaders, LEGACY_FLAG_PREFIX } from './localFlags'
import { applyExtraBody, argumentsString, canonicalJSON, deepMergeJSON, objectSchema } from '../core/json'
import { repairToolPairing } from '../providers/common'
import { withDeadline } from '../providers/base'
import { detectQuirks } from '../providers/openaiRequest'
import { Fixtures } from '../testing/fixtures'
import { looksSpanish, netError } from '../testing/mocks'

const TEST_KEY = 'sk-test-1234567890abcdefXYZ'

beforeEach(() => setAILocale('es'))

describe('direcciones', () => {
  it('con /v1 y barras finales', () => {
    expect(openAIChatURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openAIChatURL('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openAIChatURL('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1/chat/completions')
  })
  it('solo el host recibe /v1', () => {
    expect(openAIChatURL('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(openAIChatURL('https://api.deepseek.com/')).toBe('https://api.deepseek.com/v1/chat/completions')
  })
  it('otras rutas con versión se respetan', () => {
    expect(openAIChatURL('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(openAIChatURL('https://api.z.ai/api/paas/v4')).toBe('https://api.z.ai/api/paas/v4/chat/completions')
    expect(openAIChatURL('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(openAIChatURL('https://token-plan-sgp.xiaomimimo.com/v1')).toBe('https://token-plan-sgp.xiaomimimo.com/v1/chat/completions')
  })
  it('una URL de chat completa se usa tal cual', () => {
    expect(openAIChatURL('https://api.perplexity.ai/chat/completions')).toBe('https://api.perplexity.ai/chat/completions')
    expect(openAIChatURL('https://x.test/custom/chat/completions/')).toBe('https://x.test/custom/chat/completions')
    expect(openAIChatURL('https://x.test/V1/Chat/Completions')).toBe('https://x.test/V1/Chat/Completions')
  })
  it('localhost y puertos', () => {
    expect(openAIChatURL('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions')
    expect(openAIChatURL('http://localhost:11434')).toBe('http://localhost:11434/v1/chat/completions')
    expect(openAIChatURL('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1/chat/completions')
  })
  it('sin esquema: https, o http si es local', () => {
    expect(openAIChatURL('api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(openAIChatURL('localhost:11434')).toBe('http://localhost:11434/v1/chat/completions')
    expect(openAIChatURL('127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1/chat/completions')
    expect(openAIChatURL('mi-mac.local:1234/v1')).toBe('http://mi-mac.local:1234/v1/chat/completions')
  })
  it('espacios, comillas y fragmento', () => {
    expect(openAIChatURL('  https://api.openai.com/v1  \n')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openAIChatURL('"https://api.openai.com/v1"')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openAIChatURL('https://x.test/v1#frag')).toBe('https://x.test/v1/chat/completions')
  })
  it('la consulta se conserva (Azure)', () => {
    expect(openAIChatURL('https://acme.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2025-01-01'))
      .toBe('https://acme.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2025-01-01')
    expect(openAIChatURL('https://x.test/v1?foo=bar')).toBe('https://x.test/v1/chat/completions?foo=bar')
    expect(openAIModelsURL('https://x.test/v1/chat/completions?api-version=2')).toBe('https://x.test/v1/models?api-version=2')
    expect(anthropicModelsURL('https://x.test?beta=1', 5)).toBe('https://x.test/v1/models?beta=1&limit=5')
    expect(anthropicMessagesURL('https://x.test/v1?beta=1')).toBe('https://x.test/v1/messages?beta=1')
  })
  it('URLs no válidas', () => {
    for (const bad of [null, '', '   ', 'ftp://x.test/v1', 'https://', 'http://']) {
      let err: unknown
      try {
        openAIChatURL(bad)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(AIError)
      expect((err as AIError).kind).toBe('other')
      expect((err as AIError).code).toBe('ai_bad_url')
      expect((err as AIError).message).toContain('URL')
    }
  })
  it('modelos y Responses', () => {
    expect(openAIModelsURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models')
    expect(openAIModelsURL('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/models')
    expect(openAIModelsURL('https://api.perplexity.ai/chat/completions')).toBe('https://api.perplexity.ai/models')
    expect(openAIModelsURL('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/models')
    expect(openAIResponsesURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/responses')
    expect(openAIResponsesURL('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/responses')
  })
  it('Anthropic', () => {
    expect(anthropicMessagesURL('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicMessagesURL('https://api.anthropic.com/')).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicMessagesURL('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicMessagesURL('https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicMessagesURL('https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(anthropicModelsURL('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(anthropicModelsURL('https://api.anthropic.com/v1/messages', 50, 'm_1')).toBe('https://api.anthropic.com/v1/models?limit=50&after_id=m_1')
  })
  it('host y redes locales', () => {
    expect(hostOf('https://API.OpenAI.com/v1')).toBe('api.openai.com')
    expect(hostOf('')).toBeUndefined()
    for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', '10.0.0.5', '192.168.1.2', '172.20.0.1', 'mi-mac.local']) expect(isLocalOrPrivateHost(h)).toBe(true)
    for (const h of ['api.openai.com', '172.32.0.1', '8.8.8.8', '']) expect(isLocalOrPrivateHost(h)).toBe(false)
  })
})

describe('Retry-After y cabeceras de límites', () => {
  const now = 1_790_000_000_000
  const ra = (h: Record<string, string>, at = now) => {
    const headers = new Headers(h)
    return retryAfterSeconds((n) => headers.get(n), at)
  }
  it('segundos, decimales, mayúsculas y milisegundos', () => {
    expect(ra({ 'Retry-After': '7' })).toBe(7)
    expect(ra({ 'Retry-After': '2.5' })).toBe(2.5)
    expect(ra({ 'rEtRy-aFtEr': '3' })).toBe(3)
    expect(ra({ 'retry-after-ms': '1500' })).toBe(1.5)
    expect(ra({ 'retry-after-ms': '250', 'retry-after': '9' })).toBe(0.25)
  })
  it('fecha HTTP', () => {
    const date = 'Tue, 24 Oct 2026 09:30:30 GMT'
    expect(ra({ 'Retry-After': date }, Date.parse(date) - 42_000)).toBeCloseTo(42, 0)
    expect(ra({ 'Retry-After': 'Tue, 24 Oct 2000 09:30:30 GMT' })).toBe(0)
  })
  it('duraciones de OpenAI', () => {
    expect(ra({ 'x-ratelimit-reset-requests': '20s' })).toBe(20)
    expect(ra({ 'x-ratelimit-reset-tokens': '1m30s' })).toBe(90)
    expect(ra({ 'x-ratelimit-reset-requests': '250ms' })).toBe(0.25)
    expect(ra({ 'x-ratelimit-reset-requests': '6m0s' })).toBe(360)
    expect(ra({ 'x-ratelimit-reset-requests': '1h2m3.5s' })).toBe(3723.5)
    expect(ra({ 'x-ratelimit-reset-requests': '20s', 'x-ratelimit-reset-tokens': '6m0s' })).toBe(20)
  })
  it('RFC 3339 de Anthropic y marcas Unix de OpenRouter', () => {
    expect(ra({ 'anthropic-ratelimit-tokens-reset': new Date(now + 33_000).toISOString() })).toBeCloseTo(33, 0)
    expect(ra({ 'x-ratelimit-reset': String(now + 12_000) })).toBeCloseTo(12, 2)
    expect(ra({ 'x-ratelimit-reset': String(Math.floor(now / 1000) + 9) })).toBeCloseTo(9, 2)
  })
  it('Retry-After manda sobre las de reinicio', () => {
    expect(ra({ 'Retry-After': '5', 'x-ratelimit-reset-requests': '1s' })).toBe(5)
  })
  it('nada o basura = sin valor; los enormes se acotan', () => {
    expect(ra({})).toBeUndefined()
    const bad: Record<string, string>[] = [{ 'Retry-After': 'pronto' }, { 'Retry-After': '-5' }, { 'x-ratelimit-reset-requests': 'abc' }, { 'x-ratelimit-reset-requests': '5x' }]
    for (const h of bad) {
      expect(ra(h)).toBeUndefined()
    }
    expect(ra({ 'Retry-After': '99999999' })).toBe(86_400)
  })
  it('analizador de duraciones', () => {
    expect(durationSeconds('1.5s')).toBe(1.5)
    expect(durationSeconds('2h')).toBe(7200)
    expect(durationSeconds('5m')).toBe(300)
    expect(durationSeconds('20')).toBeNull()
    expect(durationSeconds('')).toBeNull()
    expect(durationSeconds('s')).toBeNull()
  })
})

describe('errores de los proveedores', () => {
  const ctx: ErrorContext = { provider: 'DeepSeek', model: 'deepseek-flash', host: 'api.deepseek.com', secrets: [TEST_KEY] }
  const map = (status: number, body: string, headers: Record<string, string> = {}) => fromHTTP(status, body, new Headers(headers), ctx)

  it('lee los cuerpos de OpenAI, OpenRouter, MiMo y Anthropic', () => {
    const p = parseErrorBody(Fixtures.openAI404Model)
    expect(p.type).toBe('invalid_request_error')
    expect(p.code).toBe('model_not_found')
    expect(p.message).toContain('does not exist')
    expect(parseErrorBody(Fixtures.openRouter402).code).toBe('402')
    expect(parseErrorBody(Fixtures.mimo401).code).toBe('401')
    expect(parseErrorBody(Fixtures.mimo401).message).toBe('Invalid API Key')
    const a = parseErrorBody(Fixtures.anthropic401)
    expect(a.message).toBe('invalid x-api-key')
    expect(a.type).toBe('authentication_error')
    const r = parseErrorBody(Fixtures.openRouterProvider400)
    expect(r.message).toContain('Provider returned error')
    expect(r.message).toContain('tool_call_ids did not have response messages')
  })
  it('lee cadenas, FastAPI, message, HTML, texto y vacío', () => {
    expect(parseErrorBody('{"error":"model not loaded"}').message).toBe('model not loaded')
    expect(parseErrorBody('{"detail":[{"loc":["body","messages"],"msg":"field required","type":"missing"}]}').message).toBe('field required')
    expect(parseErrorBody('{"detail":"Not Found"}').message).toBe('Not Found')
    expect(parseErrorBody('{"message":"Forbidden"}').message).toBe('Forbidden')
    expect(parseErrorBody('<html><head><title>502 Bad Gateway</title></head><body><center>nginx</center></body></html>').message).toBe('502 Bad Gateway')
    expect(parseErrorBody('<html><body><h1>Oops</h1><script>var x=1</script><p>algo   falló</p></body></html>').message).toBe('Oops algo falló')
    expect(parseErrorBody('  Service Unavailable \n').message).toBe('Service Unavailable')
    expect(parseErrorBody(new Uint8Array()).message).toBeUndefined()
    expect(() => parseErrorBody(new Uint8Array([0xff, 0xfe, 0x00, 0x01]))).not.toThrow()
  })
  it('401: falta la clave, sin enseñarla', () => {
    const r = map(401, Fixtures.openAI401)
    expect(r.error.kind).toBe('missingKey')
    expect(r.error.code).toBe('ai_auth')
    expect(r.error.status).toBe(401)
    expect(r.retryable).toBe(false)
    expect(r.error.message).not.toContain(TEST_KEY)
    expect(r.error.message).toContain('clave')
    expect(looksSpanish(r.error.message)).toBe(true)
  })
  it('402: saldo', () => {
    const r = map(402, Fixtures.deepseek402)
    expect(r.error.kind).toBe('http')
    expect(r.error.code).toBe('ai_quota')
    expect(r.error.message).toContain('saldo')
    expect(r.error.message).toContain('Insufficient Balance')
  })
  it('403 y 404 nombran el modelo', () => {
    const f = map(403, '{"error":{"message":"forbidden"}}')
    expect(f.error.code).toBe('ai_forbidden')
    expect(f.error.message).toContain('deepseek-flash')
    expect(f.retryable).toBe(false)
    const n = map(404, Fixtures.openAI404Model)
    expect(n.error.code).toBe('ai_not_found')
    expect(n.error.message).toContain('deepseek-flash')
    expect(n.error.message).toContain('Actualizar modelos')
  })
  it('429: límite de uso con espera (no se reintenta solo)', () => {
    const r = map(429, Fixtures.openAI429, { 'Retry-After': '20' })
    expect(r.error.kind).toBe('rateLimited')
    expect(r.error.code).toBe('ai_rate_limit')
    expect(r.error.retryAfter).toBe(20)
    expect(r.retryAfter).toBe(20)
    expect(r.retryable).toBe(false)
    expect(r.error.message).toContain('20 s')
    expect(map(429, '{}').error.retryAfter).toBeUndefined()
  })
  it('429 de cuota no es un límite de uso', () => {
    const r = map(429, Fixtures.openAIQuota429)
    expect(r.error.kind).toBe('http')
    expect(r.error.code).toBe('ai_quota')
    expect(r.error.message).toContain('cuota')
  })
  it('5xx, 408 y 409 se reintentan; 4xx no; x-should-retry: false manda', () => {
    for (const s of [500, 502, 503, 504, 520, 529, 408, 409]) {
      expect(map(s, '').retryable).toBe(true)
      expect(map(s, '').error.code).toBe('ai_server')
    }
    for (const s of [400, 401, 402, 403, 404, 413, 422]) expect(map(s, '').retryable).toBe(false)
    expect(map(500, '{}', { 'x-should-retry': 'false' }).retryable).toBe(false)
    expect(map(529, '{}', { 'X-Should-Retry': 'FALSE' }).retryable).toBe(false)
    expect(map(500, '{}', { 'x-should-retry': 'true' }).retryable).toBe(true)
    expect(map(400, '{}', { 'x-should-retry': 'true' }).retryable).toBe(false)
  })
  it('el texto del proveedor se incluye sin claves y recortado', () => {
    const r = map(400, '{"error":{"message":"bad param near sk-test-1234567890abcdefXYZ and Bearer abcdefghijklmnop"}}')
    expect(r.error.message).toContain('bad param')
    expect(r.error.message).not.toContain(TEST_KEY)
    expect(r.error.message).not.toContain('abcdefghijklmnop')
    expect(r.error.message).toContain('«clave»')
    expect(map(400, `{"error":{"message":"${'x'.repeat(5000)}"}}`).error.message.length).toBeLessThan(1000)
  })
  it('contexto demasiado largo: código propio', () => {
    expect(map(400, Fixtures.deepseekContext400).error.code).toBe('ai_context_length')
    expect(map(400, Fixtures.anthropicTooLong400).error.code).toBe('ai_context_length')
    expect(map(400, '{"error":{"message":"Invalid JSON"}}').error.code).toBe('ai_invalid_request')
  })
  it('todos los mensajes HTTP en español (y en inglés si se cambia el idioma)', () => {
    for (const s of [400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 503, 529, 418]) expect(looksSpanish(map(s, '').error.message)).toBe(true)
    setAILocale('en')
    expect(map(401, '').error.message).toContain('API key')
    expect(map(503, '').error.message).toContain('temporary')
  })

  it('errores de red', () => {
    const cases: [string, boolean, string][] = [
      ['ENETUNREACH', true, 'internet'], ['ETIMEDOUT', true, 'tardó'], ['ENOTFOUND', true, 'servidor'], ['EAI_AGAIN', true, 'servidor'],
      ['ECONNRESET', true, 'conexión'], ['ECONNREFUSED', true, 'conectar'], ['ERR_SSL_WRONG_VERSION_NUMBER', false, 'TLS'],
      ['CERT_HAS_EXPIRED', false, 'TLS'], ['ERR_INVALID_URL', false, 'URL'], ['HPE_INVALID_CONSTANT', true, 'respuesta']
    ]
    for (const [code, retryable, word] of cases) {
      const r = fromTransport(netError(code), ctx)
      expect(r.retryable, code).toBe(retryable)
      expect(r.error.message, code).toContain(word)
      expect(looksSpanish(r.error.message)).toBe(true)
    }
    expect(fromTransport(netError('ETIMEDOUT'), ctx).error.kind).toBe('timeout')
    expect(fromTransport(netError('ECONNRESET'), ctx).error.code).toBe('ai_network')
  })
  it('una conexión local rechazada sugiere Ollama y no se reintenta (el servidor no está abierto)', () => {
    const r = fromTransport(netError('ECONNREFUSED'), { provider: 'Ollama', model: 'm', host: 'localhost' })
    expect(r.error.message).toContain('Ollama')
    expect(r.retryable).toBe(false)
    expect(fromTransport(netError('ECONNREFUSED'), { provider: 'X', model: 'm', host: '127.0.0.1:9' }).retryable).toBe(false)
  })
  it('un AIError pasa tal cual', () => {
    expect(fromTransport(new AIError('badResponse', 'x'), ctx).error.kind).toBe('badResponse')
  })
  it('errores dentro del flujo', () => {
    const err = (json: string) => fromStreamError(JSON.parse(json), ctx)
    expect(err('{"code":"server_error","message":"Provider disconnected unexpectedly"}').kind).toBe('badResponse')
    expect(err('{"code":429,"message":"slow down"}').kind).toBe('rateLimited')
    expect(err('{"code":401,"message":"no auth"}').kind).toBe('missingKey')
    expect(err('{"type":"overloaded_error","message":"Overloaded"}').status).toBe(529)
    expect(err('{"type":"rate_limit_error","message":"x"}').kind).toBe('rateLimited')
    expect(err('{"type":"authentication_error","message":"x"}').kind).toBe('missingKey')
    expect(err('"solo texto"').kind).toBe('badResponse')
    expect(err('{"message":"boom"}').message).toContain('boom')
  })
  it('detecta «el contexto no cabe»', () => {
    const e = (status: number, m: string) => new AIError('http', m, { status })
    expect(isContextLengthError(e(400, "This model's maximum context length is 65536 tokens"))).toBe(true)
    expect(isContextLengthError(e(400, 'prompt is too long: 213462 tokens > 200000 maximum'))).toBe(true)
    expect(isContextLengthError(e(400, 'context_length_exceeded'))).toBe(true)
    expect(isContextLengthError(e(413, 'Request too large'))).toBe(true)
    expect(isContextLengthError(e(400, 'Please reduce the length of the messages'))).toBe(true)
    expect(isContextLengthError(e(400, 'Invalid JSON'))).toBe(false)
    expect(isContextLengthError(e(500, 'context length'))).toBe(false)
    expect(isContextLengthError(e(401, 'context length'))).toBe(false)
  })
  it('detecta el rechazo de las herramientas', () => {
    const e = (status: number, m: string) => new AIError('http', m, { status })
    expect(looksLikeToolRejection(e(400, 'deepseek-reasoner does not support Function Calling'))).toBe(true)
    expect(looksLikeToolRejection(e(404, 'No endpoints found that support tool use'))).toBe(true)
    expect(looksLikeToolRejection(e(400, 'gemma3:4b does not support tools'))).toBe(true)
    expect(looksLikeToolRejection(e(422, 'tools: extra fields not permitted'))).toBe(true)
    expect(looksLikeToolRejection(e(401, 'tool'))).toBe(false)
    expect(looksLikeToolRejection(e(500, 'tool'))).toBe(false)
    expect(looksLikeToolRejection(e(400, 'maximum context length exceeded by tool results'))).toBe(false)
    expect(looksLikeToolRejection(e(400, 'temperature must be between 0 and 2'))).toBe(false)
  })
})

describe('redactor', () => {
  it('quita la clave exacta (si mide 6+)', () => {
    expect(scrubSecrets('clave=abcdef123456 fin', ['abcdef123456'])).toBe('clave=«clave» fin')
    expect(scrubSecrets('abc', ['abc'])).toBe('abc')
  })
  it('reconoce las formas habituales de clave', () => {
    for (const k of ['sk-proj-abcdef1234567890', 'sk-ant-api03-AbCdEf_123-456', 'sk-or-v1-0123456789abcdef', 'sk-test-****abcd', 'xai-AbCdEfGhIjKlMn',
      'gsk-AbCdEfGh1234', 'AIzaSyA-1234567890abcdefghijk', 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def']) {
      const out = scrubSecrets(`Error con ${k} al llamar`)
      expect(out).not.toContain(k)
      expect(out).toContain('«clave»')
    }
  })
  it('el texto normal no se toca', () => {
    const t = 'El modelo sk-learn no existe; usa el task-runner con tokens y bearer de papel.'
    expect(scrubSecrets(t)).toBe(t)
  })
})

describe('reintentos y plazos', () => {
  const fast = (delays: number[]) => defaultHTTPOptions({ sleep: async (s) => void delays.push(s), random: () => 0.5 })

  it('retroceso exponencial con jitter', () => {
    const o = { baseBackoffSec: 1, maxBackoffSec: 20, jitter: 0.25, random: () => 0.5 }
    expect([0, 1, 2, 3, 10].map((a) => backoffDelay(o, a))).toEqual([1, 2, 4, 8, 20])
    expect(backoffDelay({ ...o, random: () => 0 }, 2)).toBeCloseTo(3)
    expect(backoffDelay({ ...o, random: () => 1 }, 2)).toBeCloseTo(5)
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay({ ...o, random: Math.random }, 1)
      expect(d >= 1.5 && d <= 2.5).toBe(true)
    }
  })
  it('valores por defecto del contrato', () => {
    const d = defaultHTTPOptions()
    expect(d.idleTimeoutSec).toBe(90)
    expect(d.maxRetries).toBe(4)
  })
  it('repite hasta que sale bien', async () => {
    const delays: number[] = []
    let calls = 0
    const v = await withRetry(fast(delays), 't', async (attempt) => {
      calls++
      if (attempt < 2) throw new RetryableFailure(new AIError('http', 'x', { status: 503 }))
      return 42
    })
    expect(v).toBe(42)
    expect(calls).toBe(3)
    expect(delays).toEqual([1, 2])
  })
  it('se rinde tras el máximo y lanza el último error', async () => {
    const delays: number[] = []
    let calls = 0
    await expect(withRetry(fast(delays), 't', async () => {
      calls++
      throw new RetryableFailure(new AIError('http', 'caído', { status: 503 }))
    })).rejects.toThrow('caído')
    expect(calls).toBe(5)
    expect(delays).toEqual([1, 2, 4, 8])
  })
  it('respeta Retry-After con tope', async () => {
    const delays: number[] = []
    await withRetry(fast(delays), 't', async (attempt) => {
      if (attempt === 0) throw new RetryableFailure(new AIError('http', 'x'), 7)
      if (attempt === 1) throw new RetryableFailure(new AIError('http', 'x'), 500)
      return 1
    })
    expect(delays).toEqual([7, 30])
  })
  it('un error no reintentable sale enseguida', async () => {
    let calls = 0
    await expect(withRetry(fast([]), 't', async () => {
      calls++
      throw new AIError('http', 'no', { status: 400 })
    })).rejects.toMatchObject({ status: 400 })
    expect(calls).toBe(1)
  })
  it('cancelar durante la espera para los reintentos', async () => {
    const ctl = new AbortController()
    const p = withRetry(defaultHTTPOptions({ baseBackoffSec: 30, maxBackoffSec: 30 }), 't', async () => {
      throw new RetryableFailure(new AIError('http', 'x'))
    }, ctl.signal)
    setTimeout(() => ctl.abort(), 30)
    const err = await p.catch((e) => e)
    expect(isCancellation(err)).toBe(true)
  })
  it('plazo total: gana la operación si termina antes', async () => {
    expect(await withDeadline(5, () => new AIError('timeout', 'tarde'), undefined, async () => 7)).toBe(7)
    expect(await withDeadline(0, () => new AIError('timeout', 'x'), undefined, async () => 1)).toBe(1)
    expect(await withDeadline(Infinity, () => new AIError('timeout', 'x'), undefined, async () => 2)).toBe(2)
  })
  it('plazo total: al vencer se cancela la operación', async () => {
    let cancelled = false
    const err = await withDeadline(0.1, () => new AIError('timeout', 'se acabó'), undefined, (signal) => new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        cancelled = true
        reject(new Error('abortada'))
      })
    })).catch((e: AIError) => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.kind).toBe('timeout')
    expect(cancelled).toBe(true)
  })
  it('plazo total: los errores de la operación pasan', async () => {
    await expect(withDeadline(5, () => new AIError('timeout', 'x'), undefined, async () => {
      throw new AIError('http', 'falló', { status: 500 })
    })).rejects.toMatchObject({ status: 500 })
  })
  it('vigilancia de inactividad: salta sin actividad y no salta con ella', async () => {
    const tracker = new ActivityTracker()
    let fired = false
    const stop = startIdleWatch(0.1, tracker, () => (fired = true))
    await new Promise((r) => setTimeout(r, 250))
    stop()
    expect(fired).toBe(true)
    const t2 = new ActivityTracker()
    let fired2 = false
    const stop2 = startIdleWatch(0.3, t2, () => (fired2 = true))
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 80))
      t2.touch()
    }
    stop2()
    expect(fired2).toBe(false)
  })
})

describe('opciones locales y particularidades', () => {
  const quirks = (base: string, headers: Record<string, string> = {}) => detectQuirks({ baseURL: base, extraHeaders: headers })

  it('las claves reservadas no son cabeceras HTTP', () => {
    const f = new LocalFlags({ useMaxCompletionTokens: 'true', 'X-Aula-Idle-Timeout': '240', 'HTTP-Referer': 'https://aula.local', 'X-Title': 'Aula' })
    expect(f.httpHeaders).toEqual({ 'HTTP-Referer': 'https://aula.local', 'X-Title': 'Aula' })
    expect(f.bool('usemaxcompletiontokens')).toBe(true)
    expect(f.number('x-aula-idle-timeout')).toBe(240)
    expect(sanitizedExtraHeaders({ 'X-Ok': '1', 'Bad Header': 'x', 'X-Inject': 'a\r\nb' })).toEqual({ 'X-Ok': '1' })
  })
  it('booleanos', () => {
    const f = new LocalFlags({ 'x-aula-a': 'Sí', 'x-aula-b': 'off', 'x-aula-c': 'quizá' })
    expect(f.bool('x-aula-a')).toBe(true)
    expect(f.bool('x-aula-b')).toBe(false)
    expect(f.bool('x-aula-c')).toBeUndefined()
    expect(f.bool('x-aula-zzz')).toBeUndefined()
  })
  it('el prefijo antiguo sigue siendo local', () => {
    const p = LEGACY_FLAG_PREFIX
    const f = new LocalFlags({ [p + 'idle-timeout']: '240', [p.toUpperCase() + 'AUTH-HEADER']: 'api-key', 'X-Real': '1' })
    expect(f.httpHeaders).toEqual({ 'X-Real': '1' })
    expect(f.number('x-aula-idle-timeout')).toBe(240)
    expect(f.string('x-aula-auth-header')).toBe('api-key')
    expect(new LocalFlags({ [p + 'idle-timeout']: '240', 'x-aula-idle-timeout': '900' }).number('x-aula-idle-timeout')).toBe(900)
    expect(quirks('https://x.test/v1', { [p + 'idle-timeout']: '240' }).idleTimeoutSec).toBe(240)
  })
  it('max_completion_tokens en OpenAI, Azure y MiMo', () => {
    expect(quirks('https://api.openai.com/v1').useMaxCompletionTokens).toBe(true)
    expect(quirks('https://acme.openai.azure.com/openai/v1').useMaxCompletionTokens).toBe(true)
    expect(quirks('https://api.deepseek.com').useMaxCompletionTokens).toBe(false)
    expect(quirks('https://api.deepseek.com', { useMaxCompletionTokens: 'true' }).useMaxCompletionTokens).toBe(true)
    expect(quirks('https://api.openai.com/v1', { useMaxCompletionTokens: 'false' }).useMaxCompletionTokens).toBe(false)
  })
  it('reenvío del razonamiento por host', () => {
    expect(quirks('https://api.deepseek.com').reasoningEcho).toBe('reasoningContent')
    expect(quirks('https://token-plan-sgp.xiaomimimo.com/v1').reasoningEcho).toBe('reasoningContent')
    expect(quirks('https://opencode.ai/inference/v1').reasoningEcho).toBe('reasoningContent')
    expect(quirks('https://openrouter.ai/api/v1').reasoningEcho).toBe('reasoning')
    expect(quirks('https://api.openai.com/v1').reasoningEcho).toBe('none')
    expect(quirks('http://localhost:11434/v1').reasoningEcho).toBe('none')
    expect(quirks('https://api.openai.com/v1', { 'x-aula-echo-reasoning': 'reasoning_content' }).reasoningEcho).toBe('reasoningContent')
    expect(quirks('https://api.deepseek.com', { 'x-aula-echo-reasoning': 'none' }).reasoningEcho).toBe('none')
    expect(quirks('https://x.test/v1', { 'x-aula-echo-reasoning': 'reasoning' }).reasoningEcho).toBe('reasoning')
  })
  it('cabecera de la clave, objeto de razonamiento, stream_options, inactividad y Responses', () => {
    expect(quirks('https://x.test/v1', { 'x-aula-auth-header': 'api-key' }).authHeader).toBe('api-key')
    expect(quirks('https://x.test/v1').authHeader).toBeUndefined()
    expect(quirks('https://openrouter.ai/api/v1').reasoningAsObject).toBe(true)
    expect(quirks('https://api.deepseek.com').reasoningAsObject).toBe(false)
    expect(quirks('https://x.test/v1', { 'x-aula-stream-usage': 'false' }).sendStreamOptions).toBe(false)
    expect(quirks('https://x.test/v1').sendStreamOptions).toBe(true)
    expect(quirks('https://x.test/v1', { 'x-aula-idle-timeout': '240' }).idleTimeoutSec).toBe(240)
    expect(quirks('https://api.openai.com/v1').useResponsesAPI).toBe(true)
    expect(quirks('https://api.openai.com/v1', { 'x-aula-openai-api': 'chat' }).useResponsesAPI).toBe(false)
    expect(quirks('https://x.test/v1', { 'x-aula-openai-api': 'responses' }).useResponsesAPI).toBe(true)
  })
})

describe('utilidades JSON', () => {
  it('fusión profunda; null quita la clave', () => {
    expect(deepMergeJSON({ a: 1, o: { x: 1, y: 2 }, arr: [1, 2] }, { a: 9, o: { y: 20, z: 30 }, arr: [3], new: true }))
      .toEqual({ a: 9, o: { x: 1, y: 20, z: 30 }, arr: [3], new: true })
    expect(deepMergeJSON({ stream_options: { include_usage: true }, keep: 1 }, { stream_options: null })).toEqual({ keep: 1 })
    expect(deepMergeJSON({ o: { x: 1, y: 2 } }, { o: { x: null } })).toEqual({ o: { y: 2 } })
    expect(applyExtraBody({ a: 1 }, undefined)).toEqual({ a: 1 })
  })
  it('esquema de objeto por defecto', () => {
    expect(objectSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(objectSchema({})).toEqual({ type: 'object', properties: {} })
    expect(objectSchema({ properties: { a: { type: 'string' } } }).type).toBe('object')
    const ok = { type: 'object', properties: { a: { type: 'string' } } }
    expect(objectSchema(ok)).toEqual(ok)
  })
  it('los argumentos siempre son JSON válido', () => {
    const call: ToolCall = { id: '1', name: 't', arguments: { tex: '\\frac{1}{2}', n: 3 }, rawArguments: '{"tex": "\\frac' }
    expect(JSON.parse(argumentsString(call))).toEqual(call.arguments)
    expect(argumentsString({ id: '1', name: 't', arguments: null })).toBe('{}')
  })
  it('JSON determinista y con barras', () => {
    expect(canonicalJSON({ b: 1, a: 'https://x.test/a/b' })).toBe('{"a":"https://x.test/a/b","b":1}')
  })
})

describe('reparación del historial de herramientas', () => {
  const call = (id: string, name = 't'): ToolCall => ({ id, name, arguments: {} })
  it('los pares completos no se tocan', () => {
    const m: ChatMessage[] = [msg.user('hola'), msg.assistant('', [call('1'), call('2')]), msg.toolResult('1', 't', 'a'), msg.toolResult('2', 't', 'b'), msg.assistant('fin')]
    expect(repairToolPairing(m)).toEqual(m)
  })
  it('a un resultado que falta se le pone uno de error', () => {
    const r = repairToolPairing([msg.user('hola'), msg.assistant('', [call('1'), call('2')]), msg.toolResult('2', 't', 'b')])
    expect(r).toHaveLength(4)
    expect(r[2].toolCallID).toBe('1')
    expect((r[2].content[0] as { text: string }).text.startsWith('Error:')).toBe(true)
    expect(r[3].toolCallID).toBe('2')
  })
  it('se reordenan, se quitan los huérfanos y vale el primero repetido', () => {
    expect(repairToolPairing([msg.assistant('', [call('1'), call('2')]), msg.toolResult('2', 't', 'b'), msg.toolResult('1', 't', 'a')]).map((m) => m.toolCallID).filter(Boolean)).toEqual(['1', '2'])
    expect(repairToolPairing([msg.toolResult('x', 't', 'huérfano'), msg.user('hola'), msg.assistant('', [call('1')]), msg.toolResult('1', 't', 'a'), msg.toolResult('zzz', 't', 'ajeno')]).map((m) => m.role))
      .toEqual(['user', 'assistant', 'tool'])
    const dup = repairToolPairing([msg.assistant('', [call('1')]), msg.toolResult('1', 't', 'primero'), msg.toolResult('1', 't', 'segundo')])
    expect((dup[dup.length - 1].content[0] as { text: string }).text).toBe('primero')
    const lonely = repairToolPairing([msg.user('a'), msg.assistant('', [call('1')])])
    expect(lonely).toHaveLength(3)
    expect(lonely[2].role).toBe('tool')
  })
})
