// Historias de los iconos de curso (16×16), agrupadas por categoría en ./stories. Formato en ./README.md.
import type { AnimSpec } from './anim'
import { ARTS } from './stories/arts'
import { GENERAL } from './stories/general'
import { HEALTH } from './stories/health'
import { HUMANITIES } from './stories/humanities'
import { LANGUAGES } from './stories/languages'
import { MATH } from './stories/math'
import { SCIENCE } from './stories/science'
import { SOCIETY } from './stories/society'
import { TECH } from './stories/tech'

export const ICON_ANIMS: Record<string, AnimSpec> = { ...GENERAL, ...MATH, ...SCIENCE, ...HEALTH, ...HUMANITIES, ...LANGUAGES, ...SOCIETY, ...TECH, ...ARTS }
