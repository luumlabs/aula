// Formas ya hechas de los diagramas (pirámide, embudo, Venn, mapa mental) y los matices del bloque «comparar» (filas clave o
// iguales, modo analogía). Campos opcionales: una versión anterior de la app dibuja la forma con su `kind` de base (capas,
// mapa conceptual o árbol) y lee la comparación como siempre.
// Idea de las formas: Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/types.ts TemplateKind.
import type { DiagramKind } from './blocks'
import { ownValue } from './coding'

export const DIAGRAM_FORMS = ['pyramid', 'funnel', 'venn', 'mindmap'] as const
export type DiagramForm = (typeof DIAGRAM_FORMS)[number]

/** El tipo de diagrama que dibuja una versión que no conoce la forma (y el que se guarda en `kind`). */
export const FORM_BASE: Readonly<Record<DiagramForm, DiagramKind>> = { pyramid: 'layers', funnel: 'layers', venn: 'concept', mindmap: 'tree' }

const clean = (s: string): string => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\- ]/g, '')

// Solo nombres que dicen la forma: «hierarchy» o «jerarquía» suelen ser un árbol o un organigrama (con ramas y flechas) y
// siguen leyéndose como antes, como flujo.
const FORM_ALIASES: Readonly<Record<string, DiagramForm>> = {
  pyramid: 'pyramid', piramide: 'pyramid', pyramide: 'pyramid',
  funnel: 'funnel', embudo: 'funnel', invertedpyramid: 'funnel', piramideinvertida: 'funnel',
  venn: 'venn', venndiagram: 'venn', diagramadevenn: 'venn', conjuntos: 'venn', sets: 'venn', euler: 'venn',
  mindmap: 'mindmap', mapamental: 'mindmap', mentalmap: 'mindmap', brainstorm: 'mindmap'
}

/** La forma que nombra un texto («pirámide», «mind-map», «Venn»…); undefined si no es una forma. */
export function parseDiagramForm(raw: string | undefined): DiagramForm | undefined {
  return raw === undefined ? undefined : ownValue(FORM_ALIASES, clean(raw))
}

// MARK: Comparar

export const COMPARE_TONES = ['key', 'same'] as const
/** «key»: la diferencia decisiva (se destaca); «same»: lo que comparten (se apaga). */
export type CompareTone = (typeof COMPARE_TONES)[number]

const TONE_ALIASES: Readonly<Record<string, CompareTone>> = {
  key: 'key', accent: 'key', important: 'key', clave: 'key', importante: 'key', difference: 'key', diferencia: 'key', main: 'key',
  same: 'same', muted: 'same', shared: 'same', equal: 'same', igual: 'same', iguales: 'same', comun: 'same', common: 'same', both: 'same'
}

export function parseCompareTone(raw: string | undefined): CompareTone | undefined {
  return raw === undefined ? undefined : ownValue(TONE_ALIASES, clean(raw))
}

export const COMPARE_MODES = ['analogy'] as const
/** «analogy»: a la izquierda el concepto real, a la derecha lo cotidiano que se le parece. */
export type CompareMode = (typeof COMPARE_MODES)[number]

const MODE_ALIASES: ReadonlySet<string> = new Set(['analogy', 'analogia', 'metaphor', 'metafora', 'likea', 'islike', 'escomo'])

export function parseCompareMode(raw: string | undefined): CompareMode | undefined {
  return raw !== undefined && MODE_ALIASES.has(clean(raw)) ? 'analogy' : undefined
}
