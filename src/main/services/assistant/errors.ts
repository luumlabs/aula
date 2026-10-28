// Errores de un turno contados para el estudiante (port de AssistantErrors.swift): breves, con qué hacer, y si conviene reintentar
// solo (un fallo pasajero antes de que llegara nada se reintenta una vez).
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import { AIError, isContextLengthError } from '../ai/errors'
import { BudgetError } from '../costs'

export interface ExplainedError {
  /** Lo que ve el estudiante. */
  message: string
  /** Un fallo pasajero (red, servicio ocupado): se puede reintentar solo una vez si aún no había llegado nada. */
  transient: boolean
  /** La conversación no cabe en el modelo. */
  contextTooLong: boolean
  /** Código estable (para la interfaz y los registros). */
  code: string
}

function network(timeout: boolean, who: string): ExplainedError {
  return {
    message: timeout ? tr(`${who} tardó demasiado en responder. Pulsa Reintentar.`, `${who} took too long to answer. Press Retry.`)
      : tr(`No pude conectar con ${who}. Revisa tu conexión a internet y pulsa Reintentar.`, `I couldn't reach ${who}. Check your internet connection and press Retry.`),
    transient: true, contextTooLong: false, code: timeout ? 'ai_timeout' : 'ai_network'
  }
}

export function explainError(error: unknown, provider?: string): ExplainedError {
  const who = provider && provider.trim() ? provider : tr('tu proveedor de IA', 'your AI provider')
  if (error instanceof BudgetError) return { message: error.message, transient: false, contextTooLong: false, code: 'ai_budget' }
  if (!(error instanceof AIError)) {
    const e = error as { code?: unknown; name?: unknown; message?: unknown }
    const code = typeof e?.code === 'string' ? e.code : ''
    if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)) return network(false, who)
    if (code === 'ETIMEDOUT') return network(true, who)
    return { message: error instanceof Error ? error.message : String(error), transient: false, contextTooLong: false, code: 'internal' }
  }
  if (isContextLengthError(error)) {
    return {
      message: tr(`Esta conversación ya es demasiado larga para ${who}. Empieza una nueva o elige un modelo con más contexto en ${settingsPath('ai', 'es')}.`,
        `This conversation is already too long for ${who}. Start a new one or pick a model with more context in ${settingsPath('ai', 'en')}.`),
      transient: false, contextTooLong: true, code: 'ai_context'
    }
  }
  switch (error.kind) {
    case 'rateLimited': {
      const ra = error.retryAfter
      const wait = ra === undefined ? tr('un momento', 'a moment') : ra >= 90 ? tr(`unos ${Math.round(ra / 60)} min`, `about ${Math.round(ra / 60)} min`) : tr('unos segundos', 'a few seconds')
      return {
        message: tr(`Llegaste al límite de uso de ${who}. Espera ${wait} y pulsa Reintentar, o elige otro proveedor en ${settingsPath('ai', 'es')}.`,
          `You reached the usage limit of ${who}. Wait ${wait} and press Retry, or pick another provider in ${settingsPath('ai', 'en')}.`),
        transient: false, contextTooLong: false, code: 'ai_rate_limit'
      }
    }
    case 'network': return network(false, who)
    case 'timeout': return network(true, who)
    case 'missingKey': case 'notLoggedIn':
      return { message: tr(`Falta la clave de ${who} o no es válida. Revísala en ${settingsPath('ai', 'es')}.`, `The key for ${who} is missing or invalid. Check it in ${settingsPath('ai', 'en')}.`), transient: false, contextTooLong: false, code: 'ai_auth' }
    default: break
  }
  const status = error.status ?? 0
  if (error.code === 'ai_auth') {
    return { message: tr(`${who} rechazó la clave. Revísala en ${settingsPath('ai', 'es')}.`, `${who} rejected the key. Check it in ${settingsPath('ai', 'en')}.`), transient: false, contextTooLong: false, code: 'ai_auth' }
  }
  if (status >= 500) {
    return { message: tr(`${who} tiene problemas ahora mismo (error ${status}). Pulsa Reintentar en un momento.`, `${who} is having trouble right now (error ${status}). Press Retry in a moment.`), transient: true, contextTooLong: false, code: 'ai_server' }
  }
  return { message: error.message, transient: false, contextTooLong: false, code: error.code }
}

/** El motivo, dentro de la misma burbuja, cuando una respuesta se corta a mitad por la red o el servicio (A3-P1-4): lo que llegó
 * se queda y «Continuar» sigue desde ahí. */
export function cutOffNotice(explained: ExplainedError): string {
  if (explained.code === 'ai_timeout') return tr('La respuesta dejó de llegar a mitad. Pulsa Continuar para seguir desde aquí.', 'The reply stopped coming partway through. Press Continue to pick up from here.')
  if (explained.code === 'ai_server') return tr('El servicio de IA falló a mitad de la respuesta. Pulsa Continuar para seguir desde aquí.', 'The AI service failed partway through the reply. Press Continue to pick up from here.')
  return tr('Se cortó la conexión a mitad de la respuesta. Pulsa Continuar para seguir desde aquí.', 'The connection dropped partway through the reply. Press Continue to pick up from here.')
}
