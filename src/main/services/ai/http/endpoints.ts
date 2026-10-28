// Direcciones de cada API a partir de la «URL base» que escribe la persona (port de Endpoints.swift).
import { defaultScheme } from '@shared/ai/urlScheme'
import { tr } from '@shared/ai/i18n'
import { AIError } from '../errors'

/** URL base ya limpia: con esquema, sin barras finales, sin fragmento ni usuario (la consulta `?api-version=…` se conserva). */
export interface BaseURLParts {
  scheme: 'http' | 'https'
  /** Host tal como va en la URL (IPv6 entre corchetes). */
  host: string
  /** Host en minúsculas y sin corchetes. */
  hostname: string
  port: string
  /** Ruta sin barras finales ('' = solo el host). */
  path: string
  /** '' o '?…'. */
  search: string
}

const QUOTES = '"\'“”‘’'

function trimChars(s: string, chars: string): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

export function baseURLParts(baseURL: string | undefined | null): BaseURLParts {
  let s = trimChars((baseURL ?? '').trim(), QUOTES)
  if (!s) {
    throw new AIError('other', tr(
      'Falta la dirección (URL base) del proveedor. Escríbela en los ajustes de IA, por ejemplo https://api.openai.com/v1.',
      "Missing the provider's address (base URL). Enter it in the AI settings, for example https://api.openai.com/v1."
    ), { code: 'ai_bad_url' })
  }
  if (!s.includes('://')) s = defaultScheme(s) + '://' + s
  const invalid = () => new AIError('other', tr(
    `La dirección «${s}» no es una URL válida. Debe parecerse a https://api.ejemplo.com/v1.`,
    `The address “${s}” isn’t a valid URL. It should look like https://api.example.com/v1.`
  ), { code: 'ai_bad_url' })
  let url: URL
  try {
    url = new URL(s)
  } catch {
    throw invalid()
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if ((scheme !== 'http' && scheme !== 'https') || !url.hostname) throw invalid()
  let path = url.pathname
  while (path.endsWith('/')) path = path.slice(0, -1)
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return { scheme, host: url.hostname, hostname, port: url.port, path, search: url.search }
}

export function buildURL(p: BaseURLParts, path: string, search = p.search): string {
  return `${p.scheme}://${p.host}${p.port ? ':' + p.port : ''}${path}${search}`
}

function invalidBaseURL(): AIError {
  return new AIError('other', tr('La URL base del proveedor no es válida.', "The provider's base URL isn't valid."), { code: 'ai_bad_url' })
}

/** Host de la URL base en minúsculas (o `undefined` si no es válida). */
export function hostOf(baseURL: string | undefined | null): string | undefined {
  try {
    return baseURLParts(baseURL).hostname
  } catch {
    return undefined
  }
}

const CHAT_SUFFIX = '/chat/completions'

/** `POST …/chat/completions`. Sin ruta (solo el host) se asume `/v1`; si ya acaba en `/chat/completions` se respeta. */
export function openAIChatURL(baseURL: string | undefined | null): string {
  const c = baseURLParts(baseURL)
  let path = c.path
  if (!path.toLowerCase().endsWith(CHAT_SUFFIX)) path = (path || '/v1') + CHAT_SUFFIX
  return buildURL(c, path)
}

/** `POST …/responses` (Responses API de OpenAI), derivada de la misma URL base. */
export function openAIResponsesURL(baseURL: string | undefined | null): string {
  const c = baseURLParts(baseURL)
  let path = c.path
  if (path.toLowerCase().endsWith(CHAT_SUFFIX)) path = path.slice(0, -CHAT_SUFFIX.length)
  if (!path.toLowerCase().endsWith('/responses')) path = (path || '/v1') + '/responses'
  return buildURL(c, path)
}

/** `GET …/models`, derivada de la misma URL base. */
export function openAIModelsURL(baseURL: string | undefined | null): string {
  const c = baseURLParts(baseURL)
  let path = c.path
  if (path.toLowerCase().endsWith(CHAT_SUFFIX)) path = path.slice(0, -CHAT_SUFFIX.length)
  else if (!path) path = '/v1'
  return buildURL(c, path + '/models')
}

/** `POST …/v1/messages`. Acepta la base con o sin `/v1`, o ya completa. */
export function anthropicMessagesURL(baseURL: string | undefined | null): string {
  const c = baseURLParts(baseURL)
  const lower = c.path.toLowerCase()
  let path = c.path
  if (lower.endsWith('/v1/messages')) { /* completa */ } else if (lower.endsWith('/v1')) path += '/messages'
  else path += '/v1/messages'
  return buildURL(c, path)
}

/** `GET …/v1/models?limit=…&after_id=…`. */
export function anthropicModelsURL(baseURL: string | undefined | null, limit = 1000, afterID?: string): string {
  const c = baseURLParts(baseURL)
  const lower = c.path.toLowerCase()
  let path = c.path
  if (lower.endsWith('/v1/messages')) path = path.slice(0, -'/messages'.length) + '/models'
  else if (lower.endsWith('/v1')) path += '/models'
  else path += '/v1/models'
  const params = new URLSearchParams(c.search)
  params.delete('limit')
  params.delete('after_id')
  params.append('limit', String(limit))
  if (afterID) params.append('after_id', afterID)
  const q = params.toString()
  if (!c.host) throw invalidBaseURL()
  return buildURL(c, path, q ? '?' + q : '')
}

/** ¿El host es de este ordenador o de una red privada (`localhost`, `127.x`, `::1`, `10.x`, `192.168.x`, `172.16–31.x`, `*.local`)? */
export function isLocalOrPrivateHost(host: string | undefined | null): boolean {
  if (!host) return false
  let h = host.toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost')) return true
  const labels = h.split('.')
  if (labels.length !== 4 || !labels.every((l) => /^[0-9]+$/.test(l))) return false
  const [a, b] = labels.map(Number)
  if (a === 127 || a === 10 || (a === 192 && b === 168)) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}
