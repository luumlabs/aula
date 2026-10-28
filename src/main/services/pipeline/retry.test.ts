// Política de reintentos de los agentes de la tubería: sin red se para enseguida (un reintento rápido), lo demás espera.
import { describe, expect, it } from 'vitest'
import { connectionFailureMessage, slowConnectionMessage } from '../agents/claude'
import { CLIErrorClassifier } from '../agents/errors'
import { isUnreachable, RETRY_ATTEMPTS, retryDecision, retryReason, waitingText } from './retry'

const refused = 'Claude Code no pudo conectarse a internet. Revisa tu conexión e inténtalo de nuevo. Detalle: API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)'

describe('retryDecision', () => {
  it('sin red (conexión rechazada, DNS): un solo reintento rápido y luego falla', () => {
    const e = { kind: 'network', text: refused }
    expect(retryReason(e)).toBe('unreachable')
    expect(retryDecision(e, 1)).toEqual({ action: 'retry', waitSec: 5, reason: 'unreachable' })
    expect(retryDecision(e, 2)).toEqual({ action: 'fail' })
    expect(RETRY_ATTEMPTS.unreachable).toBe(2)
    for (const text of ['getaddrinfo ENOTFOUND api.anthropic.com', 'connect ENETUNREACH 1.2.3.4:443', 'No internet connection. Check your network and try again.',
      'No hay conexión a internet. Comprueba tu red y vuelve a intentarlo.', 'No se pudo conectar con Anthropic. Revisa tu conexión y la URL base.',
      "The OpenAI server couldn't be found. Check the base URL in your AI settings and your connection.", 'getaddrinfo EAI_AGAIN api.openai.com']) {
      expect(isUnreachable(text), text).toBe(true)
    }
  })

  it('el fallo que detecta el analizador de Claude (sin esperar a la CLI) cuenta como «sin red»', () => {
    const err = CLIErrorClassifier.claude.classify(connectionFailureMessage(4), 'network')
    expect(err.kind).toBe('network')
    expect(retryReason({ kind: err.kind, text: err.message })).toBe('unreachable')
    // si cada intento tardaba minutos, es una espera agotada (un reintento, y no para toda la ejecución)
    const slow = CLIErrorClassifier.claude.classify(slowConnectionMessage(4, 6), 'timeout')
    expect(retryReason({ kind: slow.kind, text: slow.message })).toBe('timeout')
    expect(isUnreachable(slow.message)).toBe(false)
  })

  it('un corte de conexión a medias o un 5xx se reintentan con esperas crecientes (5, 20, 45 s)', () => {
    const cut = { kind: 'network', text: 'Se perdió la conexión con Anthropic. (ECONNRESET)' }
    expect(isUnreachable(cut.text)).toBe(false)
    expect([1, 2, 3].map((a) => retryDecision(cut, a))).toEqual([5, 20, 45].map((waitSec) => ({ action: 'retry', waitSec, reason: 'network' })))
    expect(retryDecision(cut, 4)).toEqual({ action: 'fail' })
    expect(retryDecision({ kind: 'http', status: 529, text: 'overloaded' }, 1)).toEqual({ action: 'retry', waitSec: 5, reason: 'server' })
    expect(retryDecision({ kind: 'http', status: 400, text: 'bad request' }, 1)).toEqual({ action: 'fail' })
  })

  it('un agente que agotó su tiempo se reintenta una sola vez (cada intento puede tardar media hora)', () => {
    const t = { kind: 'timeout', text: 'Claude Code tardó más de 25 min y se detuvo.' }
    expect(retryDecision(t, 1).action).toBe('retry')
    expect(retryDecision(t, 2)).toEqual({ action: 'fail' })
  })

  it('los límites: espera lo que pide el proveedor, o se para si tarda mucho o se repite', () => {
    expect(retryDecision({ kind: 'rateLimited', retryAfter: 30, text: '429' }, 1)).toEqual({ action: 'retry', waitSec: 30, reason: 'rateLimited' })
    expect(retryDecision({ kind: 'rateLimited', retryAfter: 3600, text: '429' }, 1)).toEqual({ action: 'limit', resumeAfterSec: 3600, long: true })
    expect(retryDecision({ kind: 'rateLimited', text: '429' }, 4)).toEqual({ action: 'limit', resumeAfterSec: undefined, long: false })
    expect(retryDecision({ kind: 'notLoggedIn', text: 'Not logged in' }, 1)).toEqual({ action: 'fail' })
  })

  it('el monitor dice el motivo de la espera', () => {
    expect(waitingText('unreachable', 5)).toBe('Sin conexión con la IA. Pruebo otra vez en 5 s…')
    expect(waitingText('server', 20, 529)).toContain('529')
    expect(waitingText('rateLimited', 30)).toContain('30 s')
  })
})
