// Los tiempos del epílogo (las pantallas de la app y el final), compartidos por la imagen y la música.
/** Empieza la primera pantalla de la app. */
export const S0 = 54.4
/** Lo que dura cada pantalla. */
export const LEN = 2.5
/** Cuántas pantallas hay (scenes/aula.ts → SHOTS). */
export const N_SHOTS = 12
/** Acaban las pantallas y empieza el final. */
export const END = S0 + N_SHOTS * LEN
export const DURATION = END + 5.8
