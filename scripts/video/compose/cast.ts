// Los dibujos REALES de la app para el vídeo: los 58 iconos de curso y los compañeros, pintados a mano con el mismo
// motor que la app (design/pixel/brush: rigs del reparto, painter), en el compositor (sin capturar la galería).
// Solo lo carga la página del compositor (el kit de la app usa importaciones sin extensión).
import { SPRITES } from '../../../src/renderer/src/design/pixel/sprites.ts'
import { COMPANIONS } from '../../../src/renderer/src/design/pixel/companions.ts'
import { TONES } from '../../../src/renderer/src/design/pixel/tones.ts'
import { companionAnim, iconAnim } from '../../../src/renderer/src/design/pixel/characters.ts'
import { paintFrame } from '../../../src/renderer/src/design/pixel/brush/frames.ts'
import type { CompiledAnim, Px } from '../../../src/renderer/src/design/pixel/anim.ts'

export interface Cast {
  /** Los iconos de curso pintados (el dibujo de su historia «hover» en reposo), cada uno con un tono de curso. */
  icons: ImageBitmap[]
  /** Los compañeros pintados. */
  companions: ImageBitmap[]
}

async function paint(anim: CompiledAnim, px: number, dark: boolean): Promise<ImageBitmap> {
  const hover = anim.clips.hover
  const board: Px[] = hover ? hover.frames[hover.still].px : anim.base
  const p = paintFrame(anim, board, px, dark, 0, 2)
  return createImageBitmap(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height))
}

const cache = new Map<string, Promise<Cast>>()

/** El reparto pintado a `px` px de lado (papel claro u oscuro). Se hace una vez por tamaño. */
export function loadCast(px = 160, dark = false): Promise<Cast> {
  const key = `${px}:${dark}`
  let c = cache.get(key)
  if (!c) {
    c = (async () => ({
      icons: await Promise.all(SPRITES.map((s, i) => paint(iconAnim(s.id, TONES[(i * 3) % TONES.length]), px, dark))),
      companions: await Promise.all(COMPANIONS.map((co) => paint(companionAnim(co.id), px, dark)))
    }))()
    cache.set(key, c)
  }
  return c
}
