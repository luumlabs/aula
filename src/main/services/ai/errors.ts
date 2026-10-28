// Error de la capa de IA (port de AICore `AIError`): tipo, código HTTP, espera sugerida y el texto original del proveedor.
// `message` es para la persona (traducido); las decisiones automáticas miran `providerMessage` (ver `classificationText`).
import { AulaError } from '../errors'
import type { AIErrorCode } from '@shared/ai/errors'
import { tr } from '@shared/ai/i18n'

export type AIErrorKind =
  | 'missingKey'
  | 'network'
  | 'http'
  | 'rateLimited'
  | 'badResponse'
  | 'cancelled'
  | 'timeout'
  | 'notInstalled'
  | 'notLoggedIn'
  | 'unsupported'
  | 'other'

export interface AIErrorOptions {
  status?: number
  /** Segundos que pide esperar el proveedor (Retry-After y similares). */
  retryAfter?: number
  /** Texto original del proveedor (sin traducir y sin claves). */
  providerMessage?: string
  /** Código estable explícito (si no, se deduce del tipo y del estado). */
  code?: AIErrorCode
}

const CONTEXT_NEEDLES = [
  'context length', 'context_length', 'context window', 'maximum context', 'context size', 'too many tokens', 'prompt is too long',
  'input is too long', 'input too long', 'reduce the length', 'request_too_large', 'request too large', 'exceeds the model',
  'token limit', 'tokens exceeds', 'maximum number of tokens', 'model_context_window_exceeded', 'longer than the model',
  'exceeds the maximum', 'input length'
]

function looksLikeContext(status: number | undefined, text: string): boolean {
  if (status !== undefined && ![400, 413, 422].includes(status)) return false
  const m = text.toLowerCase()
  return CONTEXT_NEEDLES.some((n) => m.includes(n))
}

function deriveCode(kind: AIErrorKind, status: number | undefined, text: string): AIErrorCode {
  switch (kind) {
    case 'missingKey':
      return status === 401 ? 'ai_auth' : 'ai_missing_key'
    case 'rateLimited':
      return 'ai_rate_limit'
    case 'network':
      return 'ai_network'
    case 'timeout':
      return 'ai_timeout'
    case 'badResponse':
      return status !== undefined && status >= 500 ? 'ai_server' : 'ai_bad_response'
    case 'cancelled':
      return 'cancelled'
    case 'unsupported':
      return 'ai_unsupported'
    case 'notInstalled':
      return 'ai_not_installed'
    case 'notLoggedIn':
      return 'ai_auth'
    case 'http':
      if (status === undefined) return 'ai_error'
      if (status === 401) return 'ai_auth'
      if (status === 402) return 'ai_quota'
      if (status === 403) return 'ai_forbidden'
      if (status === 404) return 'ai_not_found'
      if (status === 429) return 'ai_quota' // 429 de tipo .http = cuota o saldo agotado (los de espera son .rateLimited)
      if ([400, 413, 422].includes(status)) return looksLikeContext(status, text) ? 'ai_context_length' : 'ai_invalid_request'
      if ([408, 409, 425].includes(status) || status >= 500) return 'ai_server'
      return 'ai_error'
    default:
      return 'ai_error'
  }
}

export class AIError extends AulaError {
  readonly kind: AIErrorKind
  readonly status?: number
  readonly retryAfter?: number
  readonly providerMessage?: string

  constructor(kind: AIErrorKind, message: string, opts: AIErrorOptions = {}) {
    const code = opts.code ?? deriveCode(kind, opts.status, opts.providerMessage ?? message)
    const details: Record<string, unknown> = { kind }
    if (opts.status !== undefined) details.status = opts.status
    if (opts.retryAfter !== undefined) details.retryAfter = opts.retryAfter
    super(code, message, details)
    this.name = 'AIError'
    this.kind = kind
    this.status = opts.status
    this.retryAfter = opts.retryAfter
    this.providerMessage = opts.providerMessage
  }

  /** Copia con otro mensaje (y lo demás igual). */
  withMessage(message: string, extra: Partial<AIErrorOptions> = {}): AIError {
    return new AIError(this.kind, message, {
      status: this.status,
      retryAfter: this.retryAfter,
      providerMessage: this.providerMessage,
      ...extra
    })
  }

  override toString(): string {
    return `${this.kind}: ${this.message}`
  }
}

/** El error de cancelación que usan el transporte y el bucle (la interfaz lo trata como «sin error»). */
export function cancelledError(): AIError {
  return new AIError('cancelled', tr('Cancelado.', 'Cancelled.'), { code: 'cancelled' })
}

/** ¿El error es una cancelación (de la persona o de un AbortController)? */
export function isCancellation(err: unknown): boolean {
  if (err instanceof AIError) return err.kind === 'cancelled'
  if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'AbortError') return true
  return false
}

/** Texto en el que se buscan las pistas de clasificación: el del proveedor si lo hay (no la traducción). */
export function classificationText(e: AIError): string {
  return e.providerMessage ?? e.message
}

/** ¿El error significa «el contexto no cabe»? */
export function isContextLengthError(e: AIError): boolean {
  return looksLikeContext(e.status, classificationText(e))
}

/** ¿El proveedor rechaza el parámetro `tools`? (400/404/422 cuyo mensaje habla de herramientas o funciones). */
export function looksLikeToolRejection(e: AIError): boolean {
  if (e.status === undefined || ![400, 404, 422].includes(e.status)) return false
  if (isContextLengthError(e)) return false
  const m = classificationText(e).toLowerCase()
  return m.includes('tool') || m.includes('function')
}
