// Códigos estables de los errores de IA (llegan a la interfaz en `RpcErrorInfo.code`). Los mensajes ya vienen traducidos;
// la interfaz decide qué botón enseñar («Pegar clave», «Reintentar», «Cambiar modelo»…) según el código.
export const AI_ERROR_CODES = [
  /** No hay ninguna clave guardada (o tiene caracteres no válidos). */
  'ai_missing_key',
  /** El proveedor rechazó la clave (401) o la sesión de la CLI. */
  'ai_auth',
  /** Acceso denegado al modelo o la cuenta (403). */
  'ai_forbidden',
  /** Límite de uso por minuto/hora (429): esperar y reintentar (`details.retryAfter`, en segundos). */
  'ai_rate_limit',
  /** Sin saldo o cuota agotada (402, o 429 de facturación): no se arregla esperando. */
  'ai_quota',
  /** El contexto no cabe en el modelo. */
  'ai_context_length',
  /** El modelo o la dirección no existen (404). */
  'ai_not_found',
  /** Petición rechazada (400/422) por otro motivo. */
  'ai_invalid_request',
  /** Fallo del servidor del proveedor (5xx, 408, 409, saturado). */
  'ai_server',
  /** Sin conexión, DNS, TLS, conexión cortada. */
  'ai_network',
  /** La petición tardó demasiado (o el proveedor dejó de enviar datos). */
  'ai_timeout',
  /** Respuesta ilegible, vacía o cortada. */
  'ai_bad_response',
  /** El proveedor o el modelo no admite lo pedido (imágenes, herramientas, una CLI sin API…). */
  'ai_unsupported',
  /** La URL base no es válida o falta. */
  'ai_bad_url',
  /** No hay modelo elegido. */
  'ai_no_model',
  /** No hay ningún proveedor de IA disponible. */
  'ai_no_provider',
  /** La CLI no está instalada. */
  'ai_not_installed',
  /** Se llegó al tope de gasto diario (o el precio no se sabe con el tope puesto). */
  'ai_budget',
  /** El almacén de claves no se pudo leer. */
  'ai_secrets',
  /** Cancelado por la persona. */
  'cancelled',
  /** Otro error. */
  'ai_error'
] as const

export type AIErrorCode = (typeof AI_ERROR_CODES)[number]
