// Contrato IPC de la capa de IA (proveedores, claves, modelos, costes y un chat sencillo con streaming).
// Las claves solo viajan de la interfaz al proceso principal (`ai.setKey`); de vuelta, solo `hasKey` y una pista enmascarada.
import type { RpcErrorInfo } from './contract'
import type { AIChatDone, AICostsView, AIProviderView, AIStatus, AITestResult, ModelCatalogView } from '../ai/views'
import type { ChatMessage } from '../ai/types'

/** Para qué se usa (atribución del coste). */
export type AIChatPurpose = 'chat' | 'tutor' | 'course' | 'automation' | 'grading' | 'memory' | 'documents' | 'other'

export interface AIConfigureArgs {
  /** `null` = automático (Aula elige el mejor disponible). */
  providerId: string | null
  /** '' = el recomendado del proveedor. */
  model?: string
  /** 'auto' o un nivel de `AIProviderView.reasoningOptions`. */
  reasoning?: string
  /** Dirección propia (proveedores personalizados `custom-…`, o para cambiar la de un preset; '' = la del preset). Siempre
   *  https (http solo en este ordenador). Si cambia de servidor, la clave guardada se borra: la nueva va en `key`. */
  baseURL?: string
  /** La clave para la dirección nueva (se guarda en el almacén de secretos en la misma llamada). */
  key?: string
  label?: string
  enabled?: boolean
  /** Usarlo desde ahora (por defecto, sí). */
  activate?: boolean
}

export interface AIChatStreamArgs {
  /** Lo elige la interfaz; identifica los eventos `ai.delta`/`ai.done`/`ai.error`. */
  requestId: string
  /** Mensajes de texto e imágenes (`user`, `assistant`, `system`). */
  messages: ChatMessage[]
  system?: string
  /** Otro proveedor o modelo que el activo (opcional). */
  providerId?: string
  model?: string
  reasoning?: string
  purpose?: AIChatPurpose
  courseID?: string
}

export interface AIDeltaEvent {
  requestId: string
  text?: string
  reasoning?: string
}

export interface AIErrorEvent {
  requestId: string
  error: RpcErrorInfo
}

declare module './contract' {
  interface RpcMethods {
    /** Proveedor y modelo que se usan ahora, y si hay alguna IA lista. */
    'ai.status': { args: { refresh?: boolean } | void; result: AIStatus }
    /** Presets y proveedores configurados, con disponibilidad y `hasKey` (nunca la clave). */
    'ai.providers': { args: { refresh?: boolean } | void; result: AIProviderView[] }
    /** Guarda la clave (limpia y validada) en el almacén de secretos. Devuelve la lista actualizada. */
    'ai.setKey': { args: { providerId: string; key: string }; result: AIProviderView[] }
    'ai.removeKey': { args: { providerId: string }; result: AIProviderView[] }
    /** Elige el proveedor (o automático) y, si se dan, su modelo y razonamiento. */
    'ai.configure': { args: AIConfigureArgs; result: AIStatus }
    /** Lista de modelos del proveedor (en vivo, con caché de 6 h; `refresh` la vuelve a pedir). */
    'ai.models': { args: { providerId: string; refresh?: boolean }; result: ModelCatalogView }
    /** «Probar conexión» con una petición mínima. Nunca falla: el resultado trae el mensaje. */
    'ai.test': { args: { providerId: string }; result: AITestResult }
    /** Gasto de hoy y del mes, tope diario y reparto por uso y curso. */
    'ai.costs': { args: void; result: AICostsView }
    /** Empieza una respuesta con streaming (los errores de configuración rechazan aquí; los demás llegan por 'ai.error'). */
    'ai.chatStream': { args: AIChatStreamArgs; result: { requestId: string } }
    /** Cancela una respuesta en curso (llega 'ai.done' con `cancelled: true`). */
    'ai.cancel': { args: { requestId: string }; result: { cancelled: boolean } }
  }
  interface RpcEvents {
    'ai.delta': AIDeltaEvent
    'ai.done': AIChatDone
    'ai.error': AIErrorEvent
    /** Cambió la configuración de IA (proveedor, clave, modelo): la interfaz vuelve a pedir `ai.status`. */
    'ai.changed': { reason: 'configure' | 'key' | 'settings' }
  }
}
export {}
