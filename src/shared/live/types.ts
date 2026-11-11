// El navegador de Aula «en vivo»: la misma ventana del Mac donde el estudiante tiene abiertas sus plataformas, vista y
// manejada desde la app (también desde su iPad o su iPhone). Sirve para iniciar sesión estando fuera de casa y para hacer
// una tarea con Aula al lado: el estudiante la hace, le pasa el turno a Aula para que la revise y la envía él.
// Aula aquí solo mira: no pulsa, no escribe y no envía nada.

/** Quién maneja la ventana ahora mismo. */
export type LiveHolder = 'student' | 'aula'

/** Para qué se abrió: iniciar sesión en una plataforma, hacer una tarea o simplemente mirar una página. */
export type LivePurpose = 'signin' | 'task' | 'browse'

export interface LiveState {
  id: string
  /** La cuenta de plataforma cuya sesión usa (null: sin sesión de ninguna plataforma). */
  accountId: string | null
  url: string
  title: string
  holder: LiveHolder
  /** Cambia cada vez que cambia quien maneja: una orden con el anterior ya no vale. */
  controlId: string
  purpose: LivePurpose
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Tamaño de la página (px de CSS). */
  width: number
  height: number
  /** Lo que Aula le dice al estudiante al pasarle el turno («Inicia sesión y dime cuando estés»). */
  note?: string
}

export interface LiveFrame {
  /** Sube con cada imagen distinta. */
  seq: number
  mime: 'image/jpeg'
  /** La imagen en base64. */
  data: string
  /** Tamaño de la imagen (px). */
  w: number
  h: number
}

/** Lo que hace el estudiante sobre la imagen. Las posiciones son fracciones (0–1) de la página. */
export type LiveInput =
  | { type: 'tap'; x: number; y: number; count?: number }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string; shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean }

/** El campo en el que quedó el cursor tras un toque (para que el dispositivo saque el teclado adecuado). */
export interface LiveFocus {
  id: string
  editable: boolean
  kind: 'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search' | 'code'
}

/** Dónde están los campos de escribir de la página (x, y, ancho, alto en fracciones): tocar uno saca el teclado del dispositivo. */
export interface LiveFields {
  id: string
  rects: [number, number, number, number][]
}

/** Lo que Aula puede leer cuando el estudiante le pasa el turno: el texto de la página y lo que él ha escrito o elegido. */
export interface LiveReading {
  url: string
  title: string
  text: string
  /** Sus respuestas: cada campo con su etiqueta y su valor (nunca contraseñas ni datos de pago). */
  fields: { label: string; kind: string; value: string }[]
  truncated: boolean
}
