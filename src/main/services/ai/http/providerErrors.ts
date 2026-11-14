// Traduce errores HTTP, de red y de flujo a AIError con mensajes claros (port de ProviderErrors.swift).
import type { JSONValue } from '@shared/ai/json'
import { aiLocale, tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import { reasoningLevelName } from '@shared/ai/reasoning'
import { AIError, type AIErrorKind } from '../errors'
import { asText, canonicalJSON, obj, str, tryParseJSON } from '../core/json'
import { scrubSecrets } from './redactor'
import { durationSeconds, MAX_WAIT_SEC, retryAfterSeconds } from './retryAfter'

/** Datos para redactar los mensajes de error de un proveedor. */
export interface ErrorContext {
  /** Nombre visible del proveedor («DeepSeek»). */
  provider: string
  model: string
  /** Host de la URL base (solo para pistas: «¿está Ollama abierto?»). */
  host?: string
  /** Claves que no deben aparecer nunca en un mensaje. */
  secrets?: string[]
  /** Pista extra para un 401 (la clave de MiMo es de otro plan que la dirección…). */
  unauthorizedHint?: string
}

export interface ParsedBody {
  message?: string
  type?: string
  code?: string
  /** Segundos que pide esperar el cuerpo (Google: `details[].retryDelay` de `google.rpc.RetryInfo`). */
  retryDelay?: number
  /** Google: el límite superado es el DIARIO (`google.rpc.QuotaFailure` con un `quotaId` «…PerDay…»). */
  dailyQuota?: boolean
}

const decoder = new TextDecoder('utf-8')

/** Mensaje, tipo y código de un cuerpo de error en los formatos habituales (OpenAI, Anthropic, OpenRouter, FastAPI, HTML…). */
export function parseErrorBody(data: Uint8Array | string): ParsedBody {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  if (bytes.length === 0) return {}
  const text = decoder.decode(bytes.subarray(0, 64 * 1024))
  const json = tryParseJSON(decoder.decode(bytes.subarray(0, 1_000_000)))
  if (json === undefined) return { message: plainText(text) }
  // Google (Gemini, API compatible con OpenAI) envuelve el error en una lista: [{"error":{…}}]
  return parseErrorJSON(Array.isArray(json) && json.length === 1 ? json[0] : json)
}

export function parseErrorJSON(json: JSONValue): ParsedBody {
  const parsed: ParsedBody = {}
  const codeOf = (v: JSONValue | undefined): string | undefined => {
    if (v === undefined || v === null) return undefined
    const t = asText(v)
    return t ? t : undefined
  }
  const o = obj(json)
  const err = o?.error
  if (err !== undefined) {
    const e = obj(err)
    if (e) {
      parsed.message = str(e.message) ?? str(e.msg) ?? str(e.detail)
      parsed.type = str(e.type)
      parsed.code = codeOf(e.code)
      // OpenRouter: el mensaje genérico («Provider returned error») oculta el detalle en metadata.raw
      const raw = obj(e.metadata)?.raw
      if (raw !== undefined) {
        const rawText = typeof raw === 'string' ? raw : canonicalJSON(raw)
        if (parsed.message && rawText) parsed.message = parsed.message + ' — ' + rawText
        else if (!parsed.message) parsed.message = rawText
      }
      if (parsed.message === undefined) {
        const inner = obj(e.error)
        if (inner) parsed.message = str(inner.message)
      }
      const delay = googleRetryDelay(e.details)
      if (delay !== undefined) parsed.retryDelay = delay
      if (googleDailyQuota(e.details)) parsed.dailyQuota = true
    } else if (typeof err === 'string') parsed.message = err
  }
  if (parsed.message === undefined && o) {
    if (typeof o.message === 'string') parsed.message = o.message
    else if (o.detail !== undefined) {
      if (typeof o.detail === 'string') parsed.message = o.detail
      else if (Array.isArray(o.detail)) parsed.message = o.detail.map((d) => str(obj(d)?.msg) ?? str(d)).filter((x): x is string => !!x).join('; ')
    } else if (Array.isArray(o.errors)) {
      parsed.message = o.errors.map((d) => str(obj(d)?.message) ?? str(d)).filter((x): x is string => !!x).join('; ')
    } else if (typeof o.error_description === 'string') parsed.message = o.error_description
  }
  if (parsed.type === undefined && o) parsed.type = o.type === 'error' ? undefined : str(o.type)
  if (parsed.code === undefined && o) parsed.code = codeOf(o.code)
  if (parsed.message === '') parsed.message = undefined
  return parsed
}

/** Google pone la espera en `details`: `{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "39s"}`. */
function googleRetryDelay(details: JSONValue | undefined): number | undefined {
  if (!Array.isArray(details)) return undefined
  for (const d of details) {
    const o = obj(d)
    if (!o || !(str(o['@type']) ?? '').endsWith('RetryInfo')) continue
    const s = durationSeconds((str(o.retryDelay) ?? '').trim())
    if (s !== null && s >= 0) return Math.min(s, MAX_WAIT_SEC)
  }
  return undefined
}

/**
 * ¿Google dice que se superó un límite DIARIO? Va en `details`: `{"@type": "…google.rpc.QuotaFailure", "violations":
 * [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier", …}]}`. Ese error trae TAMBIÉN un RetryInfo corto.
 */
function googleDailyQuota(details: JSONValue | undefined): boolean {
  if (!Array.isArray(details)) return false
  return details.some((d) => {
    const o = obj(d)
    if (!o || !(str(o['@type']) ?? '').endsWith('QuotaFailure') || !Array.isArray(o.violations)) return false
    return o.violations.some((v) => {
      const q = obj(v)
      return !!q && /per_?day/i.test(`${str(q.quotaId) ?? ''} ${str(q.quotaMetric) ?? ''}`)
    })
  })
}

/** Zona horaria en la que Google renueva los límites diarios de Gemini (a medianoche). */
export const GOOGLE_QUOTA_TIME_ZONE = 'America/Los_Angeles'

/** Desfase (ms) de una zona horaria en un instante: la hora de reloj de allí leída como UTC, menos el instante. */
function zoneOffsetMs(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(ms))
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'))
  return wall - Math.floor(ms / 1000) * 1000
}

/** Segundos hasta la próxima medianoche en `timeZone` (con el cambio de hora: un día de 23 o 25 h cuenta bien). */
export function secondsUntilMidnight(timeZone: string, nowMs: number = Date.now()): number {
  const offset = zoneOffsetMs(timeZone, nowMs)
  const wall = new Date(nowMs + offset)
  const nextMidnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1)
  // el desfase que vale es el de la medianoche (puede cambiar de hora entre medias): se corrige con él
  const guess = nextMidnight - offset
  const target = nextMidnight - zoneOffsetMs(timeZone, guess)
  return Math.max(0, (target - nowMs) / 1000)
}

/** La espera escrita en el mensaje: «Please retry in 39.58s» (Gemini), «Please try again in 20s» o «in 14m24s» (OpenAI, Groq). */
export function retryDelayInText(text: string): number | undefined {
  const m = /\b(?:retry|try again)\s+in\s+((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i.exec(text)
  if (!m) return undefined
  const s = durationSeconds(m[1].toLowerCase())
  return s !== null && s >= 0 ? Math.min(s, MAX_WAIT_SEC) : undefined
}

/** Un 429 con una espera de hasta esto (s) es un límite por minuto u hora (p. ej. de un nivel gratuito), no saldo agotado. */
export const SHORT_LIMIT_SEC = 3600

/** Texto legible de un cuerpo que no es JSON (quita etiquetas HTML y comprime espacios). */
export function plainText(raw: string): string | undefined {
  let s = raw
  if (s.includes('<')) {
    const t = /<title>([\s\S]*?)<\/title>/i.exec(s)
    if (t) s = t[1]
    else {
      s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      s = s.replace(/<[^>]+>/g, ' ')
    }
  }
  s = s.replace(/\s+/g, ' ').trim()
  return s || undefined
}

export function truncate(s: string, n: number): string {
  const t = s.trim()
  const chars = Array.from(t)
  return chars.length <= n ? t : chars.slice(0, n).join('') + '…'
}

/** Segundos como entero, sin desbordar con valores enormes o no finitos. */
export function wholeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return seconds > 0 ? 999_999_999 : 0
  return Math.min(Math.max(0, Math.round(seconds)), 999_999_999)
}

/** Espera legible, redondeada hacia arriba: «30 s», «5 min», «2 h» (en inglés «30 sec», «5 min», «2 hr»). */
export function waitText(seconds: number): string {
  const en = aiLocale() === 'en'
  if (seconds < 90) return `${wholeSeconds(Math.ceil(seconds))} ${en ? 'sec' : 's'}`
  if (seconds < 5400) return `${wholeSeconds(Math.ceil(seconds / 60))} min`
  return `${wholeSeconds(Math.ceil(seconds / 3600))} ${en ? 'hr' : 'h'}`
}

/** «<mensaje> Detalle del proveedor: «<texto del proveedor>»». */
export function withProviderDetail(base: string, detail: string): string {
  return tr(`${base} Detalle del proveedor: «${detail}»`, `${base} Provider detail: “${detail}”`)
}

export interface HTTPResult {
  error: AIError
  retryable: boolean
  retryAfter?: number
}

/**
 * Convierte una respuesta HTTP no exitosa en un AIError y decide si merece un reintento automático (408, 409, 425 y 5xx;
 * NO el 429, que se devuelve como `rateLimited` para que quien llama espere).
 */
export function fromHTTP(status: number, body: Uint8Array | string, headers: Headers | undefined, ctx: ErrorContext, nowMs = Date.now()): HTTPResult {
  const parsed = parseErrorBody(body)
  const detailRaw = parsed.message ?? ''
  const detailLower = detailRaw.toLowerCase()
  // Gemini: el límite DIARIO trae un RetryInfo corto, como si fuera por minuto; se renueva a medianoche, hora del Pacífico
  const dailyWait = status === 429 && parsed.dailyQuota ? Math.min(secondsUntilMidnight(GOOGLE_QUOTA_TIME_ZONE, nowMs), MAX_WAIT_SEC) : undefined
  // la espera: la de las cabeceras o, si no hay, la del cuerpo (RetryInfo de Google) o la escrita en el mensaje
  const retryAfter = dailyWait ?? (headers ? retryAfterSeconds((n) => headers.get(n), nowMs) : undefined) ?? parsed.retryDelay ?? retryDelayInText(detailRaw)
  // OpenAI marca el saldo agotado con códigos propios (`credit_balance_exhausted`, `*_spend_limit_exceeded`, `insufficient_quota`…)
  const codes = ((parsed.code ?? '') + ' ' + (parsed.type ?? '')).toLowerCase()
  // las palabras se buscan fuera de las direcciones: Groq enlaza «…/settings/billing» en un límite por minuto
  const words = detailLower.replace(/https?:\/\/\S+/g, ' ')
  const quotaCode = ['quota', 'credit', 'spend_limit', 'usage_limit', 'billing', 'balance'].some((w) => codes.includes(w))
  const quotaWords = ['quota', 'billing', 'credit', 'balance', 'insufficient', 'exceeded your current', 'spend limit', 'usage limit'].some((w) => words.includes(w))
  // Gemini gratis dice «You exceeded your current quota» también en los límites por minuto, con una espera corta: eso se espera
  const shortWait = retryAfter !== undefined && retryAfter <= SHORT_LIMIT_SEC
  // el límite diario de Gemini se renueva solo: es un límite que se espera (o se reanuda), no saldo agotado
  const quotaProblem = status === 429 && dailyWait === undefined && (quotaCode || (quotaWords && !shortWait))
  // Anthropic contesta 400 cuando la cuenta se queda sin saldo («Your credit balance is too low…»)
  const lowCredit = (status === 400 || status === 403) && /credit balance is too low|credit balance too low/.test(words)
  // …y cuando llega al tope de gasto que puso la persona («You have reached your specified API usage limits. You will regain…»)
  const spendLimit = (status === 400 || status === 403) && /reached your specified (?:[\w-]+ )?api usage limit/.test(words)
  const p = ctx.provider
  const model = ctx.model
  const code = String(status)
  let kind: AIErrorKind = 'http'
  let base: string
  // Google (Gemini) contesta 400 a una clave que no vale («API key not valid. Please pass a valid API key.»), no 401
  const badKey = (status === 400 || status === 403) && (/api key not valid|pass a valid api key|invalid api key/.test(detailLower) || codes.includes('api_key_invalid') || (status === 400 && /invalid_argument/.test(codes) && detailLower.includes('api key')))
  switch (true) {
    case spendLimit:
      base = tr(`Has llegado al tope de gasto que pusiste en tu cuenta de ${p} (${code}). Súbelo en su consola o cambia de proveedor.`,
        `You've reached the spend limit you set on your ${p} account (${code}). Raise it in its console or switch provider.`)
      break
    case lowCredit:
      base = tr(`${p} indica que no tienes saldo suficiente (${code}). Recarga tu cuenta en su panel o cambia de proveedor.`,
        `${p} says you don't have enough credit (${code}). Top up your account in its dashboard or switch provider.`)
      break
    case status === 401 || badKey:
      kind = 'missingKey'
      base = tr(
        `La clave de API de ${p} no es válida, ha caducado o no tiene permiso (${code}). Revísala en los ajustes de IA de Aula y vuelve a pegarla.`,
        `The API key for ${p} isn't valid, has expired, or lacks permission (${code}). Check it in Aula's AI settings and paste it again.`
      ) + (ctx.unauthorizedHint ? ' ' + ctx.unauthorizedHint : '')
      break
    case status === 402:
      base = tr(`${p} indica que no tienes saldo suficiente (402). Recarga tu cuenta en su panel y vuelve a intentarlo.`,
        `${p} says you don't have enough credit (402). Top up your account in its dashboard and try again.`)
      break
    case status === 403:
      base = tr(`${p} denegó el acceso (403). Puede que tu clave no tenga permiso para el modelo «${model}», que la cuenta no esté activa o que el servicio no esté disponible en tu país.`,
        `${p} denied access (403). Your key may not have permission for the “${model}” model, your account may not be active, or the service may not be available in your country.`)
      break
    case status === 404:
      base = tr(`${p} no encontró el modelo «${model}» o la dirección del servicio (404). Revisa el nombre del modelo (puedes pulsar «Actualizar modelos») y la URL base en los ajustes de IA.`,
        `${p} couldn’t find the model “${model}” or the service endpoint (404). Check the model name (you can click “Update models”) and the base URL in AI settings.`)
      break
    case status === 408:
      base = tr(`${p} tardó demasiado en recibir la petición (408).`, `${p} took too long to receive the request (408).`)
      break
    case status === 409:
      base = tr(`${p} tuvo un conflicto temporal al procesar la petición (409).`, `${p} had a temporary conflict while processing the request (409).`)
      break
    case status === 413:
      base = tr(`La petición es demasiado grande para ${p} (413). Reduce el texto o las imágenes que envías.`,
        `The request is too large for ${p} (413). Reduce the text or images you send.`)
      break
    case status === 422:
      base = tr(`${p} no aceptó algún parámetro de la petición (422).`, `${p} rejected one of the request parameters (422).`)
      break
    case status === 429:
      if (quotaProblem) {
        base = tr(`Se agotó la cuota o el saldo de tu cuenta de ${p} (429). Revisa tu plan y tu facturación en su panel.`,
          `Your ${p} account has run out of quota or balance (429). Check your plan and billing in its dashboard.`)
      } else {
        kind = 'rateLimited'
        base = dailyWait !== undefined
          ? tr(`Has alcanzado el límite diario de ${p} (429). Se renueva a medianoche, hora del Pacífico (en unos ${waitText(dailyWait)}).`,
            `You’ve reached the daily limit for ${p} (429). It renews at midnight Pacific time (in about ${waitText(dailyWait)}).`)
          : retryAfter !== undefined && retryAfter > 0
          ? tr(`Has alcanzado el límite de uso de ${p} (429). Espera unos ${waitText(retryAfter)} y vuelve a intentarlo.`,
            `You’ve reached the usage limit for ${p} (429). Wait about ${waitText(retryAfter)} and try again.`)
          : tr(`Has alcanzado el límite de uso de ${p} (429). Espera un momento y vuelve a intentarlo.`,
            `You’ve reached the usage limit for ${p} (429). Wait a moment and try again.`)
      }
      break
    case status === 400:
      base = tr(`${p} rechazó la petición (400).`, `${p} rejected the request (400).`)
      break
    case status >= 500 && status <= 599:
      if (status === 529) base = tr(`${p} está saturado en este momento (529). Suele ser temporal.`, `${p} is overloaded right now (529). This is usually temporary.`)
      else if (status === 503) base = tr(`${p} no está disponible ahora mismo (503). Suele ser temporal.`, `${p} isn’t available right now (503). This is usually temporary.`)
      else base = tr(`${p} tuvo un fallo interno (${code}). Suele ser temporal.`, `${p} had an internal error (${code}). This is usually temporary.`)
      break
    default:
      base = tr(`${p} respondió con un error inesperado (${code}).`, `${p} responded with an unexpected error (${code}).`)
  }
  let text = base
  let detail = ''
  if (detailRaw) {
    detail = scrubSecrets(truncate(detailRaw, 600), ctx.secrets)
    text = withProviderDetail(base, detail)
  }
  let retryable = [408, 409, 425].includes(status) || (status >= 500 && status <= 599)
  // OpenAI y Anthropic avisan con `x-should-retry: false` cuando repetir la petición no servirá de nada
  if (headers?.get('x-should-retry')?.toLowerCase() === 'false') retryable = false
  const error = new AIError(kind, text, { status, retryAfter, providerMessage: detail, code: lowCredit || spendLimit ? 'ai_quota' : undefined })
  return { error, retryable, retryAfter }
}

/** «Error de red con <proveedor>: <explicación>». */
export function networkErrorText(p: string, reason: string): string {
  return tr(`Error de red con ${p}: ${reason}`, `Network error with ${p}: ${reason}`)
}

/** «<proveedor> tardó demasiado en responder.» */
export function slowResponseText(p: string): string {
  return tr(`${p} tardó demasiado en responder.`, `${p} took too long to respond.`)
}

/** Código de sistema de un error de `fetch` (undici lo pone en `cause.code`). */
function transportCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown; cause?: { code?: unknown } } }
  const c = e?.cause?.code ?? e?.code ?? e?.cause?.cause?.code
  return typeof c === 'string' ? c : ''
}

function transportReason(err: unknown): string {
  const e = err as { message?: unknown; cause?: { message?: unknown } }
  const m = typeof e?.cause?.message === 'string' ? e.cause.message : typeof e?.message === 'string' ? e.message : String(err)
  return m
}

/** Errores de transporte (`fetch failed`, ECONNREFUSED…) → AIError. `retryable`: si merece reintento antes del primer byte. */
export function fromTransport(err: unknown, ctx: ErrorContext): { error: AIError; retryable: boolean } {
  if (err instanceof AIError) return { error: err, retryable: false }
  const p = ctx.provider
  const code = transportCode(err).toUpperCase()
  const host = ctx.host ?? ''
  const local = host.startsWith('localhost') || host.startsWith('127.') || host === '::1'
  const net = (message: string, retryable: boolean, kind: AIErrorKind = 'network') => ({ error: new AIError(kind, message), retryable })
  const reasonText = scrubSecrets(transportReason(err), ctx.secrets)
  if (['ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'ENOTCONNECTED'].includes(code)) {
    return net(tr('No hay conexión a internet. Comprueba tu red y vuelve a intentarlo.', 'No internet connection. Check your network and try again.'), true)
  }
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ESOCKETTIMEDOUT'].includes(code)) {
    return net(slowResponseText(p), true, 'timeout')
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL'].includes(code)) {
    return net(tr(`No se encuentra el servidor de ${p}. Revisa la URL base en los ajustes de IA y tu conexión.`,
      `The ${p} server couldn't be found. Check the base URL in your AI settings and your connection.`), true)
  }
  if (code === 'ECONNREFUSED') {
    // un servidor de este ordenador que rechaza la conexión no está abierto: reintentar solo retrasa el aviso (J2-10)
    if (local) {
      return net(tr(`No se pudo conectar con ${p} en este ordenador. ¿Está abierto el servidor (por ejemplo Ollama o LM Studio)?`,
        `Couldn’t connect to ${p} on this computer. Is the server running (for example, Ollama or LM Studio)?`), false)
    }
    return net(tr(`No se pudo conectar con ${p}. Revisa tu conexión y la URL base.`, `Couldn’t connect to ${p}. Check your connection and the base URL.`), true)
  }
  if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'ECONNABORTED'].includes(code) || /terminated|other side closed|socket hang up/i.test(reasonText)) {
    return net(tr(`Se perdió la conexión con ${p}.`, `The connection to ${p} was lost.`), true)
  }
  if (/CERT|SSL|TLS|EPROTO|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) {
    return net(tr(`Falló la conexión segura (TLS) con ${p}. Revisa la URL base, la fecha del ordenador y si una VPN o un proxy intercepta el tráfico.`,
      `The secure connection (TLS) to ${p} failed. Check the base URL, your computer's date, and whether a VPN or proxy is intercepting the traffic.`), false)
  }
  if (code === 'ERR_INVALID_URL' || /invalid url/i.test(reasonText)) {
    return { error: new AIError('other', tr(`La URL base de ${p} no es válida. Revísala en los ajustes de IA.`, `The base URL for ${p} isn't valid. Check it in AI settings.`), { code: 'ai_bad_url' }), retryable: false }
  }
  if (['UND_ERR_INVALID_ARG', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH', 'HPE_INVALID_CONSTANT', 'HPE_INVALID_HEADER_TOKEN'].includes(code) || code.startsWith('HPE_')) {
    return net(tr(`${p} envió una respuesta que no se pudo leer.`, `${p} sent a response that couldn't be read.`), true)
  }
  return net(networkErrorText(p, reasonText), false)
}

/** Estado HTTP equivalente a un `type` de error de Anthropic (u OpenAI). */
function httpStatusForErrorType(type: string | undefined): number | undefined {
  switch ((type ?? '').toLowerCase()) {
    case 'authentication_error':
      return 401
    case 'permission_error':
      return 403
    case 'not_found_error':
      return 404
    case 'rate_limit_error':
      return 429
    case 'overloaded_error':
      return 529
    case 'invalid_request_error':
      return 400
    case 'api_error':
      return 500
    default:
      return undefined
  }
}

/** «<proveedor> devolvió un error mientras respondía: «<texto>»». */
export function streamErrorText(p: string, detail: string): string {
  return tr(`${p} devolvió un error mientras respondía: «${detail}»`, `${p} returned an error while responding: “${detail}”`)
}

/** Error que llega como un evento más del flujo (`data: {"error":…}`), ya con HTTP 200. Si trae un código HTTP, se trata como tal. */
export function fromStreamError(error: JSONValue, ctx: ErrorContext): AIError {
  const parsed = parseErrorJSON({ error })
  const msgText = scrubSecrets(truncate(parsed.message ?? asText(error), 600), ctx.secrets)
  const p = ctx.provider
  const codeNum = parsed.code !== undefined && /^-?\d+$/.test(parsed.code) ? Number(parsed.code) : undefined
  const status = codeNum ?? httpStatusForErrorType(parsed.type)
  const overloaded = (parsed.type ?? '').toLowerCase().includes('overloaded')
  const make = (kind: AIErrorKind, text: string, s: number | undefined) => new AIError(kind, text, { status: s, providerMessage: msgText })
  if (status === 401) {
    return make('missingKey', withProviderDetail(tr(`La clave de API de ${p} no es válida o ha caducado (401). Revísala en los ajustes de IA de Aula.`,
      `The API key for ${p} isn't valid or has expired (401). Check it in Aula's AI settings.`), msgText), 401)
  }
  if (status === 429) {
    return make('rateLimited', withProviderDetail(tr(`Has alcanzado el límite de uso de ${p} (429). Espera un momento y vuelve a intentarlo.`,
      `You’ve reached the usage limit for ${p} (429). Wait a moment and try again.`), msgText), 429)
  }
  if (overloaded) {
    return make('http', withProviderDetail(tr(`${p} está saturado en este momento. Suele ser temporal; inténtalo de nuevo.`,
      `${p} is overloaded right now. This is usually temporary; try again.`), msgText), 529)
  }
  return make('badResponse', streamErrorText(p, msgText), status)
}

/**
 * El proveedor rechazó (400) el esfuerzo de razonamiento que eligió la persona. No se reintenta en silencio con otro nivel:
 * se dice qué pasa y dónde cambiarlo. Conserva el código y el texto original del proveedor.
 */
export function effortRejected(original: AIError, p: string, model: string, effort: string): AIError {
  const level = reasoningLevelName(effort)
  const base = tr(`${p} no admite el razonamiento «${level}» con ${model}. Cámbialo en ${settingsPath('ai', 'es')} → ${p} o en el selector del chat (o elige «Automático»).`,
    `${p} doesn’t support the “${level}” reasoning with ${model}. Change it in ${settingsPath('ai', 'en')} → ${p} or in the chat selector (or choose “Automatic”).`)
  const detail = original.providerMessage ?? ''
  return new AIError(original.kind, detail ? withProviderDetail(base, detail) : base, { status: original.status, providerMessage: original.providerMessage })
}
