// El navegador de Aula en vivo (ver shared/live/types.ts): abrirlo, verlo imagen a imagen, manejarlo y pasar el turno.
import type { LiveFields, LiveFocus, LiveFrame, LiveInput, LivePurpose, LiveState } from '../live/types'
import type { PlatformAccountView } from '../platforms/types'

declare module './contract' {
  interface RpcMethods {
    /** Abre (o trae) la ventana en vivo de una cuenta. Sin dirección, la de la plataforma. */
    'live.open': { args: { accountId?: string | null; url?: string; purpose?: LivePurpose }; result: LiveState }
    'live.state': { args: { id: string }; result: LiveState | null }
    'live.list': { args: void; result: LiveState[] }
    /** La siguiente imagen distinta de la de `after` (espera un poco; null si la página no cambió). */
    'live.frame': { args: { id: string; after?: number; maxWidth?: number }; result: LiveFrame | null }
    /** Toques, rueda, texto y teclas del estudiante (solo con su turno y su `controlId`). */
    'live.input': { args: { id: string; controlId: string; events: LiveInput[] }; result: { applied: number } }
    'live.navigate': { args: { id: string; controlId: string; action?: 'back' | 'forward' | 'reload'; url?: string }; result: LiveState }
    /** Ajusta la página al tamaño de quien la mira (un teléfono, una tableta). */
    'live.viewport': { args: { id: string; width: number; height: number }; result: LiveState }
    /** El estudiante toma el turno. */
    'live.take': { args: { id: string }; result: LiveState }
    /** El estudiante le pasa el turno a Aula («revísalo»). */
    'live.give': { args: { id: string }; result: LiveState }
    'live.close': { args: { id: string }; result: void }
    /** «Ya he iniciado sesión»: Aula lo comprueba con la sesión de la cuenta. */
    'live.confirmSignIn': { args: { id: string }; result: { signedIn: boolean; account: PlatformAccountView | null } }
  }
  interface RpcEvents {
    'live.changed': LiveState
    'live.closed': { id: string }
    'live.focus': LiveFocus
    'live.fields': LiveFields
  }
}
export {}
