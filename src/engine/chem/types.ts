// Tipos de resultado compartidos (datos simples, aptos para JSON e IPC).

export type ChemCheckStatus = 'correct' | 'partial' | 'incorrect' | 'invalid'

/** Resultado de corregir una respuesta química. `feedback` va en el idioma de la interfaz: lo ve el alumno. */
export interface ChemCheck {
  status: ChemCheckStatus
  feedback: string
}

/**
 * Resultado de una herramienta de química para la IA: respuesta con pasos en español y, si procede, valor numérico.
 * No se localiza (es salida para la IA); solo los mensajes de error que reenvía al fallar salen en el idioma de la interfaz.
 */
export interface ChemToolResult {
  /** `false` si no se pudo responder (el texto explica por qué y cómo escribirlo bien). */
  ok: boolean
  /** Respuesta y pasos, en español. */
  text: string
  /** Valor principal sin redondear (masa molar, pH, gramos…). */
  value?: number
  /** Unidad de `value`. */
  unit?: string
  /** LaTeX del resultado (KaTeX). */
  latex?: string
}
