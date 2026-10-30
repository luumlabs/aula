// V6 · el puente con el motor de pintura de la app para los personajes que se dibujan a pincel: quién es cada uno
// (`companion:<id>` o `icon:<id>`), sus piezas en el orden en que se pintan (para el plan de trazos) y su dibujo a medio
// hacer. Lo empaqueta esbuild: en la página del compositor (pinta) y en Node para la hoja de efectos (solo las piezas;
// el kit de la app usa importaciones sin extensión).
import { companionAnim, iconAnim } from '../../../src/renderer/src/design/pixel/characters.ts'
import { TONES } from '../../../src/renderer/src/design/pixel/tones.ts'
import { SPRITES } from '../../../src/renderer/src/design/pixel/sprites.ts'
import { inkInfoOf, paintFrame } from '../../../src/renderer/src/design/pixel/brush/frames.ts'
import { Kit, paintRigFrame, readOps, rigOf } from '../../../src/renderer/src/design/pixel/brush/rigs.ts'
import { boardPieces, paintBoard, scenePieces, type Painting, type Piece } from '../../../src/renderer/src/design/pixel/brush/painter.ts'
import { frameAt, type CompiledAnim, type Px } from '../../../src/renderer/src/design/pixel/anim.ts'

export interface Subject {
  who: string
  anim: CompiledAnim
  /** Compañero redibujado a mano (muñeco) o icono de curso (su pixel art leído a pincel). */
  rig: boolean
  /** El dibujo en reposo (icono: el fotograma quieto de su historia «hover»). */
  board: Px[]
  pieces: Piece[]
}

const subjects = new Map<string, Subject>()

/** El personaje `companion:<id>` o `icon:<id>` (con el tono del curso `tone`, índice de TONES). */
export function subjectOf(who: string, tone?: number): Subject {
  const key = `${who}:${tone ?? ''}`
  let s = subjects.get(key)
  if (s) return s
  const [kind, id] = who.split(':')
  if (kind === 'companion') {
    const anim = companionAnim(id)
    const rig = rigOf(id)
    if (rig) {
      const k = new Kit()
      rig.draw(k, readOps(rig, '').state)
      const groups = k.groups({ dx: 0, dy: 0, flip: false, light: rig.light })
      s = { who, anim, rig: true, board: anim.base, pieces: scenePieces(groups, { size: 24, margin: Math.round((anim.stride - 24) / 2) }) }
    } else s = { who, anim, rig: false, board: anim.base, pieces: boardPieces(anim.base, inkInfoOf(anim), anim.stride) }
  } else {
    const i = Math.max(0, SPRITES.findIndex((sp) => sp.id === id))
    const anim = iconAnim(SPRITES[i].id, TONES[tone ?? (i * 3) % TONES.length])
    const hover = anim.clips.hover
    const board = hover ? hover.frames[hover.still].px : anim.base
    s = { who, anim, rig: false, board, pieces: boardPieces(board, inkInfoOf(anim), anim.stride) }
  }
  subjects.set(key, s)
  return s
}

/** Píxeles de dispositivo por px «de la app» del dibujo: así la línea y el grano tienen el peso de la app a cualquier
 *  tamaño (un personaje grande no se ve con línea de alambre). */
export const drawnDpr = (W: number) => Math.max(2, W / 72)

/** El dibujo a `W` px, entero o a medio hacer (`progress` por pieza, en el orden de `pieces`). */
export function paintSubject(s: Subject, W: number, dark: boolean, variant: number, progress?: number[]): Painting {
  const t = { W, stride: s.anim.stride, dark, variant, dpr: drawnDpr(W), reveal: progress ? { progress } : undefined }
  if (s.rig) return paintRigFrame(rigOf(s.anim.look!.id)!, '', t)
  return paintBoard(s.board, inkInfoOf(s.anim), t)
}

/** «Cobra vida»: el fotograma de su historia «hover» (en bucle) a `seconds` s de empezar, o null si no tiene. */
export function aliveBoard(s: Subject, seconds: number): Px[] | null {
  const clip = s.anim.clips.hover
  if (!clip || !clip.frames.length) return null
  const total = clip.frames.reduce((a, f) => a + f.ticks, 0)
  const tick = Math.floor((seconds * 1000) / clip.ms) % Math.max(1, total)
  const i = frameAt(clip, tick) ?? 0
  return clip.frames[i].px
}

/** Un fotograma de su historia, dibujado. */
export function paintAlive(s: Subject, px: Px[], W: number, dark: boolean, variant: number): Painting {
  return paintFrame(s.anim, px, W, dark, variant, drawnDpr(W))
}
