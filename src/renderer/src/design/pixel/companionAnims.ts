// Historias de los compañeros (24×24), en ./stories/companions-*.ts. Formato en ./README.md.
import type { AnimSpec } from './anim'
import { COMPANIONS_A } from './stories/companions-a'
import { COMPANIONS_B } from './stories/companions-b'

export const COMPANION_ANIMS: Record<string, AnimSpec> = { ...COMPANIONS_A, ...COMPANIONS_B }
