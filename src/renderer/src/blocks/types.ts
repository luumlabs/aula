// Contrato común de los bloques de lección (lo usan la lección, el tutor, el chat y la vista de impresión).
import type { Block } from '@shared/schema/blocks'
import type { SourceRef } from '@shared/schema/common'

export interface BlockContext {
  /** Curso al que pertenecen los recursos (imágenes, modelos 3D). null en el chat sin curso. */
  packId: string | null
  skillId?: string
  /** Idioma del contenido (decimal con coma en «es»…). */
  language: string
  /** URL servible de un recurso del curso (aula-asset://pack/<id>/<ruta>). */
  assetUrl: (path: string) => string
  /** Dónde se dibuja: lección (interactivo y grande), chat (compacto), impresión (estático, sin animaciones). */
  mode: 'lesson' | 'chat' | 'print'
  /** Abre un ejercicio incrustado («Pruébalo»): lo resuelve la pantalla de estudio. */
  onTryIt?: (exerciseIds: string[]) => void
  /** Señala que el estudiante interactuó (para el registro de estudio). */
  onInteract?: (blockId: string, kind: string) => void
  /** Tono del curso (`pack.hue`): las gráficas y figuras usan su tinta. Sin él, el ladrillo de Aula. */
  hue?: number
  /** Título de un material del curso por id (para «Apuntes de clase · p. 12» en citas e imágenes). */
  sourceTitle?: (sourceId: string) => string | undefined
  /** Abre un material citado (en su página). Sin él, la cita no es un enlace. */
  onOpenSource?: (ref: SourceRef) => void
  /** Curso de idiomas: los ejercicios de texto se corrigen exactos (tildes y ortografía cuentan; ver `courseGradeOptions`). */
  exactText?: boolean
}

export interface BlockProps<B extends Block = Block> {
  block: B
  ctx: BlockContext
}

export function makeBlockContext(packId: string | null, language: string, extra: Partial<BlockContext> = {}): BlockContext {
  return {
    packId,
    language,
    mode: 'lesson',
    assetUrl: (path) => (packId ? `aula-asset://pack/${encodeURIComponent(packId)}/${path.split('/').map(encodeURIComponent).join('/')}` : path),
    ...extra
  }
}
