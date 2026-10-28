// Historias pixel-art de los iconos generales (estudio, examen, conducir, oposiciones, cronómetro, graduación, idea, cuaderno).
import type { AnimSpec, CelSpec } from '../anim'
import { celebrate } from '../fx'
import { band } from './arts'

// Agujas del cronómetro (rejilla 6×5 desde x5, y6; el eje en la columna 3, fila 3).
const FACE = Array(5).fill('WWWWWW')
const hand = (rows: string[]): CelSpec => ({ at: [5, 6], rows: FACE.map((f, y) => Array.from(f).map((c, x) => (rows[y]?.[x] === 'k' ? 'k' : c)).join('')) })
const HANDS: Record<string, CelSpec> = {
  hN: hand(['...k', '...k', '...k', '...k']),
  hNE: hand(['', '.....k', '....k', '...k']),
  hE: hand(['', '', '', '...kkk']),
  hSE: hand(['', '', '', '...k', '....kk']),
  hS: hand(['', '', '', '...k', '...k']),
  hSW: hand(['', '', '', '...k', '.kk']),
  hW: hand(['', '', '', 'kkkk']),
  hNW: hand(['', '.k', '..k', '...k'])
}
const TURN = ['hN', 'hNE', 'hE', 'hSE', 'hS', 'hSW', 'hW', 'hNW']

// Rayos de la bombilla encendida.
const RAYS = 'rV@7,-3 rV@8,-3 rD2@12,-2 rD1@2,-2 rH@-3,4 rH@15,4'

export const GENERAL: Record<string, AnimSpec> = {
  // Los libros apilados: el de arriba salta, el del medio se escapa… y vuelven a su sitio.
  study: {
    cels: { bG: band('study', 0, 4), bA: band('study', 5, 8), bB: band('study', 9, 15) },
    idle: { ms: 140, frames: ['- bB bA bG@0,-1', '', '- bB bA bG@0,-1', ''] },
    hover: {
      ms: 110,
      still: 4,
      frames: [
        '- bB bA bG@0,-1', '- bB bA bG@1,-3', '- bB bA@-1,0 bG@3,-3', '- bB bA@-2,0 bG@4,-2', '- bB bA@-2,0 bG@3,-2 tw1@14,-3 *2', '- bB bA@-1,0 bG@2,-2',
        '- bB bA bG@1,-1', '- bB bA bG', '@0,-1', '', 'tw3@13,-3', ''
      ]
    },
    celebrate: { ms: 100, frames: ['- bB bA bG@0,-2', '- bB bA@0,-1 bG@0,-3', '- bB bA bG@0,-1', ...celebrate(16, '')] }
  },

  // El examen: el lápiz corrige la marca roja, añade otra ✓… y estrella.
  exam: {
    legend: 'Y:gold1 k:ink',
    cels: {
      nw: { at: [5, 11], rows: ['.G', 'G.'] },
      pen: { at: [0, 0], rows: ['..h', '.B.', 'k..'] }
    },
    idle: { ms: 150, frames: ['pen@9,4', 'pen@9,3', ''] },
    hover: {
      ms: 120,
      still: 8,
      frames: ['pen@12,4', 'pen@8,7', 'pen@7,8 %RG', '%RG pen@8,9', '%RG pen@7,10', '%RG nw pen@6,10', '%RG nw pen@9,9', '%RG nw tw3@13,-2', '%RG nw star@11,-4 *4', '%RG nw', '']
    },
    celebrate: { ms: 100, frames: ['%RG', '%RG nw', ...celebrate(16, '%RG nw star@11,-4', '%RG nw')] }
  },

  // El coche: ruedas que giran, faro que destella, arranca y vuelve.
  driving: {
    legend: 'Q:stone3',
    cels: { beam: { at: [16, 6], rows: ['Y..', '.YY', 'Y..'] } },
    idle: { ms: 120, frames: ['%sQ %ks %Qk', '', '%sQ %ks %Qk', ''] },
    hover: {
      ms: 90,
      still: 4,
      frames: [
        '@0,-1 beam', 'beam', '@0,-1', '', '%sQ %ks %Qk puff@-3,8', 'puff@-3,7 @1,0', '%sQ %ks %Qk @2,0 whooshL@-1,6', '@2,0 whooshL@-2,6', '%sQ %ks %Qk @1,0', '', '%sQ %ks %Qk', '', 'beam', '%YW beam', ''
      ]
    },
    celebrate: { ms: 90, frames: ['beam', '%sQ %ks %Qk @0,-1', '@0,-1', ...celebrate(16, 'beam', '%sQ %ks %Qk')] }
  },

  // Las oposiciones: un sello baja, estampa la hoja y deja su marca.
  'civil-service': {
    legend: 'w:wood2 W:wood3',
    cels: {
      stamp: { at: [0, 0], rows: ['.ww.', '.ww.', 'WWWW', 'RRRR'] },
      mark: { at: [3, 3], rows: ['.rrr.', 'r.r.r', 'rrrrr', 'r.r.r', '.rrr.'] }
    },
    idle: { ms: 150, frames: ['%Rh', '', '%Rh', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: ['stamp@4,-6', 'stamp@4,-3', 'stamp@4,0', 'stamp@4,2 @0,1', 'mark stamp@4,-1', 'mark stamp@4,-4', 'mark tw3@-2,1', 'mark tw1@-1,2 *3', 'mark %Rh', 'mark', '']
    },
    celebrate: { ms: 100, frames: ['stamp@4,-3', 'stamp@4,2', 'mark stamp@4,-3', ...celebrate(16, 'mark', 'mark %Rh')] }
  },

  // El cronómetro: la aguja da la vuelta, se acelera… ¡y suena!
  timer: {
    cels: { ...HANDS, btn: { at: [7, 1], rows: ['__', 'oo'] } },
    idle: { ms: 260, frames: ['hNE', 'hE', 'hSE', ''] },
    hover: {
      ms: 120,
      still: 13,
      frames: [
        'btn hN', ...TURN.slice(1), ...TURN.map((h) => `${h}`), ...TURN.slice(0, 4),
        'hN @1,0 bang@15,-3', 'hN @-1,0 bang@15,-3', 'hN @1,0 bolt@-3,-1 boltL@16,1', 'hN @-1,0', 'hN @1,0 bang@15,-3', 'hN', '*2'
      ]
    },
    celebrate: { ms: 80, frames: [...TURN, ...celebrate(16, 'hN', 'hNE')] }
  },

  // El birrete: sale volando, da una vuelta en el aire y cae entre confeti.
  graduation: {
    legend: 'W:white',
    idle: { ms: 150, frames: ['%YW', '', '@0,-1', ''] },
    hover: {
      ms: 100,
      still: 4,
      frames: ['@0,1', '@0,-1', '@0,-2', '@0,-3 <>', '@0,-3 <> c1@1,-2 c3@13,-1', '@0,-3 c2@2,0 c4@12,1', '@0,-2 <> c5@0,3 c1@14,4', '@0,-1 c2@1,6 c3@13,8', 'c4@0,10 c5@15,11', '@0,1 dust@3,15', '', 'tw3@1,-1', '']
    },
    celebrate: { ms: 100, frames: ['@0,-2', '@0,-3 <>', '@0,-2', ...celebrate(16, '%YW', '<>')] }
  },

  // La bombilla: parpadea, duda… ¡y se enciende de golpe!
  idea: {
    legend: 'F:stone1 E:stone2 Z:stone3',
    cels: {
      rH: { at: [0, 0], legend: 'Y:gold1', rows: ['YY'] },
      rV: { at: [0, 0], legend: 'Y:gold1', rows: ['Y', 'Y'] },
      rD1: { at: [0, 0], legend: 'Y:gold1', rows: ['Y.', '.Y'] },
      rD2: { at: [0, 0], legend: 'Y:gold1', rows: ['.Y', 'Y.'] }
    },
    idle: { ms: 140, frames: ['%jF %YE %gZ', '', 'tw1@6,2', ''] },
    hover: {
      ms: 100,
      still: 8,
      frames: [
        '%jF %YE %gZ %WF', '', '%jF %YE %gZ %WF *2', '', '%jF %YE %gZ %WF', 'ask@13,-3', 'ask@13,-3 *2', '%jW', `${RAYS}`, `${RAYS} tw3@-2,-2 tw3@15,-2`, `${RAYS} tw1@-1,-1 tw1@16,-1 *4`, 'rH@-3,4 rH@15,4', ''
      ]
    },
    celebrate: { ms: 100, frames: ['%jF %YE %gZ %WF', '', `${RAYS}`, ...celebrate(16, RAYS, '%jW')] }
  },

  // El cuaderno: el lápiz escribe en la etiqueta y las anillas tintinean.
  notebook: {
    legend: 'k:ink w:wood1 R:red2',
    cels: {
      s1: { at: [6, 5], rows: ['kWk', 'WkW'] },
      s2: { at: [6, 5], rows: ['kWkWk', 'WkWkW'] },
      pen: { at: [0, 0], rows: ['..R', '.w.', 'k..'] }
    },
    idle: { ms: 140, frames: ['%SW', '', '%SW', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: ['pen@9,1', 'pen@7,3', 's1 pen@8,3', 's1 pen@9,4', 's2 pen@10,3', 's2 pen@12,2', 's2 tw3@13,-2', 's2 %SW', 's2', 's2 %SW', 's2 @0,-1', 's2', '']
    },
    celebrate: { ms: 100, frames: ['s1', 's2', ...celebrate(16, 's2', 's2 %SW')] }
  }
}
