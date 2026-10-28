// Errores de Canvas con código estable para la interfaz y mensaje en el idioma de la interfaz (sin tokens ni enlaces privados).
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'

export type CanvasErrorCode =
  | 'needs_sign_in' // la sesión se cerró (401, página de acceso, redirección al SSO)
  | 'canvas_token_invalid' // modo token: el token no vale
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'canvas_server'
  | 'canvas_http'
  | 'canvas_unexpected'
  | 'not_canvas'
  | 'network'
  | 'too_large'
  | 'invalid_args'

export class CanvasError extends AulaError {
  constructor(code: CanvasErrorCode, message: string, details?: unknown) {
    super(code, message, details)
    this.name = 'CanvasError'
  }
}

/** Mensaje de error que trae Canvas en el cuerpo (`{"errors":[{"message":"…"}]}` o `{"message":"…"}`), recortado. */
export function canvasErrorMessage(body: string): string | null {
  try {
    const data = JSON.parse(body.replace(/^\s*while\(1\);/, '')) as unknown
    if (!data || typeof data !== 'object') return null
    const o = data as Record<string, unknown>
    if (Array.isArray(o.errors)) {
      const first = o.errors[0] as Record<string, unknown> | undefined
      if (first && typeof first.message === 'string') return first.message.slice(0, 300)
    }
    if (o.errors && typeof o.errors === 'object') {
      const vals = Object.values(o.errors as Record<string, unknown>).flat() as unknown[]
      const m = vals.find((v) => v && typeof v === 'object' && typeof (v as Record<string, unknown>).message === 'string') as Record<string, unknown> | undefined
      if (m) return String(m.message).slice(0, 300)
    }
    if (typeof o.message === 'string') return o.message.slice(0, 300)
  } catch { /* no es JSON */ }
  return null
}

/** Traduce un estado HTTP de error en un CanvasError accionable. */
export function errorForStatus(status: number, body: string, tokenMode: boolean): CanvasError {
  const message = canvasErrorMessage(body)
  switch (status) {
    case 401:
      // Canvas también usa 401 para «no tienes permiso para esa acción» (con la sesión o el token válidos)
      if ((message ?? '').toLowerCase().includes('not authorized to perform')) return new CanvasError('forbidden', tr('Canvas no te deja ver eso.', 'Canvas won’t let you see that.'))
      return tokenMode
        ? new CanvasError('canvas_token_invalid', tr('Canvas rechazó el token de acceso (caducó o se revocó). Crea uno nuevo o usa la sesión.', 'Canvas rejected the access token (it expired or was revoked). Create a new one or use your session.'))
        : new CanvasError('needs_sign_in', tr('Tu sesión de Canvas se cerró: inicia sesión de nuevo.', 'Your Canvas session ended: sign in again.'))
    case 403: return new CanvasError('forbidden', message ? `${tr('Canvas no te deja ver eso', 'Canvas won’t let you see that')}: ${message}` : tr('Canvas no te deja ver eso.', 'Canvas won’t let you see that.'))
    case 404: return new CanvasError('not_found', tr('Canvas no encuentra eso (puede estar oculto o borrado).', 'Canvas can’t find that (it may be hidden or deleted).'))
    default:
      if (status >= 500) return new CanvasError('canvas_server', tr(`Canvas tuvo un problema interno (error ${status}). Inténtalo de nuevo en unos minutos.`, `Canvas had an internal problem (error ${status}). Try again in a few minutes.`), { status })
      return new CanvasError('canvas_http', message
        ? tr(`Canvas respondió con el error ${status}: ${message}`, `Canvas answered with error ${status}: ${message}`)
        : tr(`Canvas respondió con el error ${status}.`, `Canvas answered with error ${status}.`), { status })
  }
}
