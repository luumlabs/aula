// Los textos y las medidas del App Store de Aula para iPhone y iPad (capturas y vista previa), en inglés y en español.
// Los usan store-art.mjs (dibuja) y preview-music.mjs (los tiempos del guion). Reglas de los titulares: de 3 a 6
// palabras, sin exclamaciones, sin mayúsculas enteras, sin «AI», «free» ni «gratis», sin precios ni fechas.

/** Las 7 capturas, en el mismo orden en todos los tamaños. `ink`: la palabra que lleva el subrayado a pincel (el
 *  ladrillo sale una sola vez por imagen: en las dos primeras ya está en la interfaz). `dark`: captura en oscuro. */
export const SHOTS = [
  {
    n: 1,
    name: 'today',
    en: { title: 'Your notes, turned into a course.', sub: 'Aula builds it on your Mac or server. You study it here.' },
    es: { title: 'Tus apuntes, ahora un curso.', sub: 'Aula lo crea en tu Mac o servidor. Tú lo estudias aquí.' }
  },
  {
    n: 2,
    name: 'red-pen',
    en: { title: 'Mistakes, marked in red pen.', sub: 'And a note in the margin on what to fix.' },
    es: { title: 'Los fallos, en boli rojo.', sub: 'Y al margen, qué cambiar.' }
  },
  {
    n: 3,
    name: 'tutor',
    en: { title: 'A nudge, not the answer.', sub: 'Your tutor sees the exercise you’re on.', ink: 'nudge' },
    es: { title: 'Una pista, no la solución.', sub: 'Tu tutor ve el ejercicio que tienes delante.', ink: 'pista' }
  },
  {
    n: 4,
    name: 'lesson',
    en: { title: 'See it before you solve it.', sub: 'Lessons with figures and worked examples.', ink: 'See' },
    es: { title: 'Míralo antes de resolverlo.', sub: 'Lecciones con figuras y ejemplos resueltos.', ink: 'Míralo' }
  },
  {
    n: 5,
    name: 'cards',
    en: { title: 'Cards return just before you forget.', sub: 'Flashcards and mistakes, in one queue.', ink: 'forget' },
    es: { title: 'Repasa justo antes de olvidar.', sub: 'Tarjetas y fallos, en una sola cola.', ink: 'olvidar' }
  },
  {
    n: 6,
    name: 'grade',
    en: { title: 'Know where you stand.', sub: 'An estimated grade, and a mock exam to check it.', ink: 'stand' },
    es: { title: 'Sabrás cómo vas.', sub: 'Una nota estimada y un simulacro para comprobarla.', ink: 'cómo vas' }
  },
  {
    n: 7,
    name: 'speaks-first',
    dark: true,
    en: { title: 'Aula speaks first.', sub: 'Open the chat: it already knows what’s next.', ink: 'first' },
    es: { title: 'Aula habla primero.', sub: 'Abre el chat: ya sabe qué te toca.', ink: 'primero' }
  }
]

/** De dónde salen las capturas: el simulador, en puntos, con la barra de estado que se quita arriba. */
export const SOURCES = {
  iphone: { pt: [440, 956], scale: 3, statusBar: 62 }, // iPhone 18 Pro Max (1320×2868)
  ipad: { pt: [1376, 1032], scale: 2, statusBar: 24 } // iPad Pro 13″ (M5) en horizontal (2752×2064)
}

/** Las ranuras de capturas: la página en puntos × la escala da los píxeles exactos que pide Apple. */
export const SLOTS = {
  'iphone-6.9': { device: 'iphone', page: [440, 956], scale: 3, card: { x: 28, y: 152, w: 384, h: 780, r: 22 } },
  'iphone-6.3': { device: 'iphone', page: [402, 874], scale: 3, card: { x: 28, y: 152, w: 346, h: 703, r: 22 } },
  'ipad-13': { device: 'ipad', page: [1376, 1032], scale: 2, card: { x: 112, y: 160, w: 1152, h: 844, r: 16 } }
}

/** La letra de los titulares de las capturas (CSS): Newsreader 500 y la sublínea en cursiva 400. */
export const SHOT_TYPE = {
  iphone: { title: [28, 31], tracking: -0.2, titleLines: 2, sub: [15.5, 20], subMin: 13.5 },
  ipad: { title: [40, 44], tracking: -0.3, titleLines: 1, sub: [18, 24], subMin: 16 }
}

// ── La vista previa (27,0 s) ─────────────────────────────────────────────────────────────────────────────────────

export const PREVIEW_DURATION = 27

/** El vídeo: página CSS × 2 = el tamaño que acepta Apple. La franja de papel tapa la barra de estado y la de título. */
export const VIDEO = {
  iphone: {
    page: [443, 960],
    scale: 2,
    band: 111,
    veil: 16,
    caption: { size: 30, line: 34, maxWidth: 379, top: 14, bottom: 108, lines: 2 },
    short: 11,
    tap: 14,
    end: { icon: 96, name: 44, line1: 17, line2: 14 }
  },
  ipad: {
    page: [800, 600],
    scale: 2,
    band: 42,
    veil: 4,
    caption: { size: 24, line: 28, maxWidth: 720, top: 0, bottom: 42, lines: 1 },
    short: 10,
    tap: 12,
    end: { icon: 88, name: 40, line1: 16, line2: 13 }
  }
}

/** Los cinco rótulos, con su tramo en la salida (s). El primero ya está en el fotograma 0. */
export const CAPTIONS = [
  { n: 1, start: 0, end: 4.35, en: 'Your notes, turned into a course.', es: 'Tus apuntes, ahora un curso.' },
  { n: 2, start: 4.7, end: 8.35, en: 'See it before you solve it.', es: 'Míralo antes de resolverlo.' },
  { n: 3, start: 8.7, end: 13.55, en: 'Mistakes, marked in red pen.', es: 'Los fallos, en boli rojo.' },
  { n: 4, start: 13.9, end: 19.45, en: 'A nudge, not the answer.', es: 'Una pista, no la solución.' },
  { n: 5, start: 19.8, end: 24.25, en: 'Cards return just before you forget.', es: 'Repasa justo antes de olvidar.' }
]
export const CAPTION_FADE = 0.25

/** Donde se acorta la espera de la IA (plano del tutor). Con el plan B (la pista del ejercicio) no hace falta. */
export const SHORTENED = { start: 15.1, end: 19.6, fade: 0.2, en: 'Sequence shortened', es: 'Secuencia acortada' }

/** La cartela final: aviso del Mac o servidor y del inicio de sesión (Apple lo pide), sin «free» ni proveedores. */
export const END_CARD = {
  start: 24.2,
  fade: 0.4,
  en: { line1: 'Needs Aula on your Mac or your own server.', line2: 'Sign-in required · sample course built in' },
  es: { line1: 'Necesita Aula en tu Mac o en tu propio servidor.', line2: 'Requiere iniciar sesión · curso de ejemplo incluido' }
}

/** Los toques que se enseñan (una mancha de tinta): instante del toque; entra 0,1 s antes y se va 0,43 s después. */
export const TAPS = [
  { name: 'check', t: 10.1 },
  { name: 'explain', t: 13.75 },
  { name: 'card', t: 20.9 },
  { name: 'good', t: 22.6 }
]

/** Las tomas del guion (§2.2 del plan): dónde empieza cada una en la salida y su fundido con la anterior. */
export const CLIPS = [
  { take: 'A-today', at: 0 },
  { take: 'B-lesson', at: 4.3, dissolveIn: 0.4 },
  { take: 'C-mistake', at: 8.3, dissolveIn: 0.4 },
  { take: 'C-mistake', at: 15.0, dissolveIn: 0.2 },
  { take: 'D-cards', at: 19.4, dissolveIn: 0.4 }
]
