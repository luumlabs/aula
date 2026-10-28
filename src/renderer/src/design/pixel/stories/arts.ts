// Historias pixel-art de los iconos de artes (pintura, música, deporte, fotografía).
import type { AnimSpec, CelSpec } from '../anim'
import { celebrate } from '../fx'
import { SPRITES } from '../sprites'

const rowsOf = (id: string) => SPRITES.find((s) => s.id === id)?.rows ?? []
/** Una franja del sprite (filas y0…y1) como parche, para mover un trozo del dibujo por delante o por detrás. */
export function band(id: string, y0: number, y1: number): CelSpec {
  return { at: [0, y0], rows: rowsOf(id).slice(y0, y1 + 1) }
}

const brush = (tip: string): CelSpec => ({ at: [0, 0], legend: `w:wood2 d:wood3 x:${tip} k:stone3`, rows: ['....d', '...w.', '..w..', '.k...', 'x....'] })

export const ARTS: Record<string, AnimSpec> = {
  // La paleta: el pincel moja en cada color y pinta un corazón.
  art: {
    cels: { brR: brush('red2'), brB: brush('blue2'), brY: brush('gold2'), brP: brush('pink2') },
    idle: { ms: 150, frames: ['brR@6,0', 'brR@7,-1', ''] },
    hover: {
      ms: 120,
      still: 9,
      frames: [
        'brY@12,-3', 'brY@9,0', 'brY@9,1 @0,1', 'brB@3,0', 'brB@2,1', 'brR@6,-1', 'brR@5,0', 'brP@2,6', 'brP@1,7',
        'brR@13,-3 heart@14,-2', 'brR@14,-3 heart@14,-2 tw1@13,-3 *3', 'heart@14,-2', ''
      ]
    },
    celebrate: { ms: 100, frames: ['brB@3,0', 'brR@6,-1', ...celebrate(16, 'heart@14,-2', 'brR@13,-3')] }
  },

  // Las notas: rebotan al compás y van soltando notitas.
  music: {
    idle: { ms: 140, frames: ['@0,-1', '', 'note@-2,0', ''] },
    hover: {
      ms: 110,
      still: 3,
      frames: [
        '@0,-2', '@0,-1', '%Ph note2@-3,4', '@0,-2 note2@-3,2', '@0,-1 note2@-3,0', '%Ph note@15,3 note2@-2,-2', '@0,-2 note@15,1', '@0,-1 note@16,-1',
        '%Ph note2@-3,4 note@16,-3', '@0,-2 note2@-2,2', '', 'tw1@0,6', ''
      ]
    },
    celebrate: { ms: 100, frames: ['@0,-2 note2@-3,4', '@0,-1 note@15,2', '%Ph', ...celebrate(16, '%Ph note2@-3,1', 'note@15,1')] }
  },

  // El balón: bota, gira y sale disparado.
  sports: {
    idle: { ms: 130, frames: ['@0,-1', '@0,-2 <>', '@0,-1', ''] },
    hover: {
      ms: 90,
      still: 3,
      frames: [
        '@0,-1', '@0,-2 <>', '@0,-3', '@0,-2 <>', '@0,-1', 'dust@3,15 dust@10,15', '@0,-2 <>', '@0,-3', '@0,-1 <>', 'dust@6,15',
        '@2,0 <> whooshL@-3,6', '@3,-1 whooshL@-1,6', '@2,0 <>', '@1,0', '', 'tw3@14,-2', ''
      ]
    },
    celebrate: { ms: 90, frames: ['@0,-2', '@0,-3 <>', '@0,-1', ...celebrate(16, '<>', '')] }
  },

  // La cámara: enfoca, ¡flash!, y sale la foto por arriba.
  photography: {
    legend: 'G:green2',
    cels: {
      sh1: { at: [6, 6], rows: ['dddd', 'dbBd', 'dBBd', 'dddd'] },
      sh: { at: [6, 6], rows: ['dddd', 'dddd', 'dddd', 'dddd'] },
      pic: { at: [0, 0], rows: ['oooooo', 'obbbjo', 'obGGbo', 'oGGGGo', 'oWWWWo', 'oooooo'] },
      cam: band('photography', 2, 12)
    },
    idle: { ms: 140, frames: ['%jW', '', '%bB', ''] },
    hover: {
      ms: 100,
      still: 5,
      frames: [
        '%bB', '', 'sh1', 'sh', 'sh1 zap@11,-2', '%jW tw5@11,-3', '', '- pic@5,2 cam', '- pic@5,0 cam', '- pic@5,-2 cam', '- pic@5,-3 cam tw1@12,-2 *3',
        '- pic@5,-2 cam', '- pic@5,1 cam', ''
      ]
    },
    celebrate: { ms: 100, frames: ['sh1', 'sh', '%jW zap@11,-2', ...celebrate(16, '- pic@5,-3 cam', '- pic@5,-2 cam')] }
  }
}
