// Contrato del IPC entre la interfaz y el proceso principal.
// Cada dominio amplía estas interfaces en su propio archivo (`src/shared/ipc/<dominio>.ts`) con:
//   declare module './contract' { interface RpcMethods { 'courses.list': { args: void; result: CourseSummary[] } } }

import type { LegalDoc } from '../legal'

/* eslint-disable @typescript-eslint/no-empty-object-type */
export interface RpcMethods {
  'app.info': { args: void; result: AppInfo }
  'app.openExternal': { args: { url: string }; result: void }
  'app.showItemInFolder': { args: { path: string }; result: void }
  /** Abre un aviso legal que va dentro de la app: la licencia de Aula (LICENSE.md) o la de terceros (THIRD_PARTY_LICENSES.txt). */
  'app.openLicenses': { args: { which: LegalDoc }; result: void }
  /** La interfaz avisa del tema que pinta (la barra de título del sistema y el fondo de la ventana lo siguen). */
  'app.setTheme': { args: { dark: boolean }; result: void }
  /** Aviso del sistema de la propia interfaz (el temporizador): por el proceso principal, la página no tiene ese permiso.
   *  `whenAway`: solo si la ventana no está a la vista y con el foco (lo decide el proceso principal: en macOS la página
   *  nunca se ve «oculta», ni minimizada: A5-P1-2). */
  'app.notify': { args: { body: string; whenAway?: boolean }; result: void }
}

export interface RpcEvents {
  'app.focus': { focused: boolean }
  /** Un comando del menú de la app o de la bandeja (la interfaz navega o actúa). */
  'app.command': { command: AppCommand }
}

/** Comandos del menú nativo. */
export type AppCommand =
  | 'newCourse'
  | 'importCourse'
  | 'settings'
  | 'search'
  | 'askAula'
  | 'studyNow'
  | 'goHome'
  | 'goChat'
  | 'goCalendar'
  | 'goTools'
  | 'goDocuments'
  | 'goInbox'
  | 'goStats'
  | 'back'
  | 'forward'
  | 'toggleSidebar'

export type RpcMethod = keyof RpcMethods
export type RpcArgs<M extends RpcMethod> = RpcMethods[M]['args']
export type RpcResult<M extends RpcMethod> = RpcMethods[M]['result']
export type RpcEvent = keyof RpcEvents
export type RpcPayload<E extends RpcEvent> = RpcEvents[E]

/** Respuesta envuelta del canal genérico: así los errores llegan limpios a la interfaz. */
export type RpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: RpcErrorInfo }

export interface RpcErrorInfo {
  message: string
  /** Código estable para la interfaz (p. ej. 'not_found', 'ai_auth', 'ai_rate_limit', 'cancelled', 'invalid_args'). */
  code: string
  details?: unknown
}

export interface AppInfo {
  name: string
  version: string
  platform: 'darwin' | 'win32' | 'linux' | string
  arch: string
  dataPath: string
  locale: string
  isPackaged: boolean
  electron: string
  /** 'basic' = los secretos no tienen cifrado del sistema (Linux sin llavero): se avisa en Ajustes. */
  secretProtection: 'os' | 'basic'
}

export const RPC_CHANNEL = 'aula:rpc'
export const EVENT_CHANNEL = 'aula:event'
/** El preload apunta aquí cada ruta que sale de un archivo soltado o elegido (las únicas que el proceso principal lee). */
export const FILE_GRANT_CHANNEL = 'aula:file-grant'
