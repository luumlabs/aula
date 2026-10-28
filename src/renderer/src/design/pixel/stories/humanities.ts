// Historias pixel-art de los iconos de humanidades (historia, literatura, filosofía, psicología, religión, sociología).
import type { AnimSpec } from '../anim'
import { celebrate } from '../fx'

// Página que pasa (de derecha a izquierda): levantada, de pie sobre el lomo y cayendo a la izquierda.
const PAGE_UP = ['....oo.', '...oPPo', '..oPlPo', '..oPPo.', '.oPlPo.', '.oPPo..', 'oPlPo..', 'oPPo...', 'oPPo...', 'oPo....', 'oPo....', 'oo.....']
const PAGE_DOWN = PAGE_UP.map((r) => Array.from(r).reverse().join(''))
const PAGE_MID = ['ooo', ...Array(11).fill('oPo'), 'ooo']

// Llama de la vela: inclinada a cada lado y crecida.
const FLAME_L = ['_o_____', '_oYo___', 'oYYYo__', '_oYOYo_', 'oYjOOYo', '_oYYYo_']
const FLAME_R = ['_____o_', '___oYo_', '__oYYYo', '_oYOYo_', 'oYjOOYo', '_oYYYo_']
const FLAME_BIG = ['___o___', '__oYo__', '__oYo__', '_oYjYo_', '_oYOYo_', 'oYjOOYo', 'oYjOOYo', '_oYYYo_']

export const HUMANITIES: Record<string, AnimSpec> = {
  // El templo: una columna se tambalea, se cae… y se reconstruye sola.
  history: {
    legend: 'Y:gold1',
    cels: {
      gone: { at: [11, 8], rows: ['oo', 'oo', 'oo', 'oo'] },
      tilt: { at: [11, 8], rows: ['oW', 'Ws', 'Wo', 'so'] },
      lying: { at: [0, 0], rows: ['oooo', 'WWWW', 'ssss'] }
    },
    idle: { ms: 150, frames: ['%GY', '', '%GY tw1@7,0', ''] },
    hover: {
      ms: 110,
      still: 4,
      frames: [
        'tilt', '', 'tilt', 'tilt *2', 'gone lying@13,10', 'gone lying@14,13 dust@14,15 puff@16,12', 'gone lying@14,13 puff@17,11 *3', 'gone lying@14,13 tw1@12,9',
        'gone tw3@10,9', 'tw5@9,8', 'tw1@11,8', '%GY tw1@7,0', '%GY', ''
      ]
    },
    celebrate: { ms: 100, frames: ['%GY', '', '%GY', ...celebrate(16, '%GY')] }
  },

  // El libro: pasa páginas.
  literature: {
    cels: {
      up: { at: [8, 0], rows: PAGE_UP },
      mid: { at: [7, -1], rows: PAGE_MID },
      down: { at: [2, 0], rows: PAGE_DOWN }
    },
    idle: { ms: 130, frames: ['up', 'mid', 'down', '<> *4', 'up', 'mid', 'down', ''] },
    hover: {
      ms: 100,
      still: 4,
      frames: ['up', 'mid', 'down', '<>', '<> *2', 'up', 'mid', 'down', '', '*2', 'up', 'mid', 'down', '<> tw1@14,-1', '<> tw3@13,-2 *3', 'up', 'mid', 'down', '']
    },
    celebrate: { ms: 80, frames: ['up', 'mid', 'down', '<>', 'up', 'mid', 'down', ...celebrate(16, 'tw1@15,-1')] }
  },

  // El búho: parpadea, mira a los lados, se lo piensa… ¡y tiene una idea!
  philosophy: {
    cels: {
      blink: { at: [3, 4], rows: ['BBB....BBB', 'kkk....kkk', 'BBB....BBB'] },
      lookL: { at: [3, 5], rows: ['kWW....kWW'] },
      lookR: { at: [3, 5], rows: ['WWk....WWk'] },
      wide: { at: [3, 4], rows: ['BkB....BkB', 'kBk....kBk', 'BBB....BBB'] },
      hoot: { at: [7, 6], rows: ['YY', 'oo'] }
    },
    idle: { ms: 120, frames: ['blink', '', '*8', 'blink', ''] },
    hover: {
      ms: 120,
      still: 10,
      frames: ['blink', '', 'lookL *3', 'lookR *3', '', 'ask@13,-3 *3', 'lookL ask@13,-3 *2', 'blink ask@13,-3', 'tw5@12,-3', 'wide tw3@12,-2', 'wide hoot @0,-1', 'wide', 'wide hoot @0,-1', 'wide *2', 'blink', '']
    },
    celebrate: { ms: 100, frames: ['blink', 'wide', ...celebrate(16, 'wide hoot', 'wide')] }
  },

  // El cerebro: las neuronas se encienden de un lado a otro y se le ocurre algo.
  psychology: {
    legend: 'Y:gold1 y:gold2',
    cels: { n: { at: [0, 0], rows: ['Y'] }, n2: { at: [0, 0], rows: ['.y.', 'yYy', '.y.'] } },
    idle: { ms: 140, frames: ['n@4,5', 'n@7,6', 'n@11,5', ''] },
    hover: {
      ms: 100,
      still: 9,
      frames: [
        'n@3,6', 'n2@3,5 n@6,4', 'n2@6,3 n@9,6', 'n2@9,5 n@12,4', 'n2@11,3 n@5,8', 'n2@4,7 n@8,8', 'n2@7,7 n@11,8', '%pd n2@10,7',
        '%pd tw3@12,-3', '%pd tw5@11,-3 *3', 'tw3@12,-2', '@0,-1', '', 'n@7,4', ''
      ]
    },
    celebrate: { ms: 100, frames: ['n2@3,5', 'n2@6,3', 'n2@9,5', 'n2@11,3', ...celebrate(16, '%pd', '%pd')] }
  },

  // La vela: la llama baila, crece y la cera gotea.
  religion: {
    legend: 'W:white',
    cels: {
      fl: { at: [4, 0], rows: FLAME_L },
      fr: { at: [4, 0], rows: FLAME_R },
      big: { at: [4, -2], rows: FLAME_BIG },
      drip: { at: [0, 0], rows: ['w', 'p'] }
    },
    idle: { ms: 150, frames: ['fl', '', 'fr', ''] },
    hover: {
      ms: 120,
      still: 6,
      frames: ['fl', '', 'fr', '', 'fl', 'big', 'big tw1@1,1 tw1@12,0', 'big tw3@0,0 tw3@11,-1', 'big tw1@1,1 tw1@12,0 drip@10,8', 'fr drip@10,9', 'fl drip@10,10', '', 'fr', '']
    },
    celebrate: { ms: 100, frames: ['fl', 'fr', 'big', ...celebrate(16, 'big', 'big')] }
  },

  // Las personas: charlan por turnos y acaban todas de acuerdo.
  sociology: {
    legend: 'W:white k:ink R:red2',
    cels: {
      sb: { at: [0, 0], rows: ['.ooooo.', 'oWkWkWo', '.ooooo.', '..o....'] },
      sbr: { at: [0, 0], rows: ['.ooooo.', 'oWkWkWo', '.ooooo.', '....o..'] },
      sbh: { at: [0, 0], rows: ['.ooooo.', 'oWRWRWo', 'oWWRWWo', '.ooooo.', '...o...'] }
    },
    idle: { ms: 150, frames: ['sb@0,-2', 'sb@0,-2', ''] },
    hover: {
      ms: 120,
      still: 7,
      frames: ['sb@0,-1 *3', '', 'sbr@9,-1 *3', '', 'sbh@5,-3 *3', '', 'sb@0,-1 sbr@9,-1 *2', 'sbh@5,-3 heart3@-1,0 heart3@14,0', 'heart3@-1,-1 heart3@14,-1 @0,-1', 'heart3@-1,-2 heart3@14,-2', '']
    },
    celebrate: { ms: 100, frames: ['sb@0,-1', 'sbr@9,-1', 'sbh@5,-3', ...celebrate(16, 'heart3@6,-1')] }
  }
}
