// Presentaciones (port de StudyUI/Blocks/Slides/{SlideCanvas,DeckPlayer}.swift): los cinco temas de la app original con la
// paleta nueva, qué hace cada tecla, la transición y el ajuste de la letra para que el contenido quepa (las diapositivas no se
// desplazan). Lógica pura.
import { canonicalDeckTheme } from '@shared/schema/cards'

export type DeckThemeName = 'aula' | 'minimal' | 'academic' | 'midnight' | 'chalk'

export interface SlideTheme {
  name: DeckThemeName
  /** Fija el claro u oscuro de la diapositiva (aunque la app vaya en el otro). */
  dark: boolean
  /** Letra de los títulos y del cuerpo. */
  titleFont: 'serif' | 'sans' | 'rounded'
  bodyFont: 'serif' | 'sans' | 'rounded'
  /** Color de identidad del tema (rayas, viñetas, encabezados): el ladrillo en «aula», un tono de curso en los demás. */
  tone: string
  /** Fondo (token del tema). */
  background: 'paper' | 'surface' | 'sunken' | 'canvas'
  /** El detalle fino que distingue al tema. */
  detail: 'none' | 'topBar' | 'doubleRule' | 'frame'
}

/** Tonos de curso (relleno claro / oscuro): pizarra, azul noche, turquesa y salvia (sin violeta). */
const TONES = { slate: ['#3f6797', '#5079aa'], navy: ['#2e4d7b', '#426496'], teal: ['#22767a', '#3a9ca0'], sage: ['#3f7a5a', '#6aa985'] } as const

export function slideTheme(raw: string | undefined): SlideTheme {
  switch (canonicalDeckTheme(raw)) {
    case 'minimal': return { name: 'minimal', dark: false, titleFont: 'sans', bodyFont: 'sans', tone: TONES.slate[0], background: 'surface', detail: 'topBar' }
    case 'academic': return { name: 'academic', dark: false, titleFont: 'serif', bodyFont: 'serif', tone: TONES.navy[0], background: 'sunken', detail: 'doubleRule' }
    case 'midnight': return { name: 'midnight', dark: true, titleFont: 'sans', bodyFont: 'sans', tone: TONES.teal[1], background: 'canvas', detail: 'topBar' }
    case 'chalk': return { name: 'chalk', dark: true, titleFont: 'rounded', bodyFont: 'rounded', tone: TONES.sage[1], background: 'canvas', detail: 'frame' }
    default: return { name: 'aula', dark: false, titleFont: 'serif', bodyFont: 'sans', tone: 'var(--accent)', background: 'paper', detail: 'none' }
  }
}

export const FONT_STACK: Record<SlideTheme['titleFont'], string> = {
  serif: 'var(--font-serif)',
  sans: 'var(--font-sans)',
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', var(--font-sans)"
}

/** Lienzo de diseño de cada diapositiva (16:9): se escala entero para caber donde se muestre. */
export const SLIDE_W = 1024
export const SLIDE_H = 576

export type KeyAction = 'next' | 'previous' | 'first' | 'last' | 'notes' | 'present' | 'presenter' | 'close'

/** Qué hace cada tecla (también los mandos de presentación, que envían RePág/AvPág). */
export function keyAction(key: string): KeyAction | undefined {
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': return 'next'
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': return 'previous'
    case 'Home': return 'first'
    case 'End': return 'last'
    case 'n': case 'N': return 'notes'
    case 'f': case 'F': return 'present'
    case 'p': case 'P': return 'presenter'
    case 'Escape': return 'close'
    default: return undefined
  }
}

/** Transición entre diapositivas: "fade" (por defecto) | "slide" | "none". */
export function deckTransition(raw: string | undefined): 'fade' | 'slide' | 'none' {
  switch ((raw ?? 'fade').toLowerCase()) {
    case 'none': return 'none'
    case 'slide': case 'push': case 'move': return 'slide'
    default: return 'fade'
  }
}

/**
 * Elección del tamaño de letra para que el contenido quepa, sin oscilar: un tamaño que no cupo no se vuelve a probar mientras
 * el hueco sea el mismo (port de FitStep).
 */
export const FIT_FACTORS = [1, 0.86, 0.74, 0.64, 0.55] as const

export interface FitState { step: number; overflowed: number; available: number; natural: number }

export const initialFit = (): FitState => ({ step: 0, overflowed: -1, available: 0, natural: 0 })

export function updateFit(s: FitState, natural: number | undefined, available: number): FitState {
  let { step, overflowed, available: avail, natural: nat } = s
  if (Math.abs(available - avail) > 1) { avail = available; overflowed = -1 }
  if (natural !== undefined) nat = natural
  if (!(avail > 1) || !(nat > 0)) return { step, overflowed, available: avail, natural: nat }
  const f = FIT_FACTORS
  if (nat > avail + 0.5) {
    // no cabe: directo al tamaño que debería caber (el alto crece más o menos con la letra)
    overflowed = Math.max(overflowed, step)
    if (step < f.length - 1) {
      const want = (f[step] * avail) / nat
      const next = f.findIndex((x, i) => i > step && x <= want)
      step = next === -1 ? f.length - 1 : next
    }
  } else if (step > 0 && step - 1 > overflowed && (nat * f[step - 1]) / f[step] < avail * 0.97) {
    // sobra sitio (el contenido encogió): un tamaño más grande
    step -= 1
  }
  return { step, overflowed, available: avail, natural: nat }
}
