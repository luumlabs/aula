// Historias pixel-art de los iconos de ciencias (química, física, biología, tierra, geografía, astronomía, ecología).
import type { AnimSpec } from '../anim'

import { celebrate } from '../fx'

// Reacción en el matraz: el líquido verde pasa a morado (L/l/d → q/P/p).
const PURPLE = '%lP %Lq %dp'
const TEAL = '%lt %Lu %dv'

// Los electrones del átomo, en tres órbitas (A horizontal, B y C las inclinadas): fotogramas de una vuelta.
const ORBIT = [
  'blk@0,7 ehor@4,1 ehor@10,14',
  'ehor@2,6 evert@4,3 evert@11,11',
  'ehor@12,6 evert@4,10 evert@11,3',
  'blk@14,7 ehor@4,14 ehor@10,1',
  'ehor@12,9 ehor@6,12 ehor@8,3',
  'ehor@2,9 evert@6,10 evert@9,4'
].map((f) => `%EO %eO ${f}`)

// La doble hélice girando: hebras de frente → de canto → cambiadas de lado.
const EDGE = '%Ah %ah %Bk %bk'
const SWAP = '%AX %aZ %BA %ba %XB %Zb'

export const SCIENCE: Record<string, AnimSpec> = {
  // El matraz: el líquido se vierte de un lado a otro, la pipeta deja caer una gota… ¡y reacciona!
  chemistry: {
    legend: 'R:red2 r:red3 P:pink2 p:pink3 q:pink1 k:ink t:teal2 u:teal1 v:teal3',
    cels: {
      slL: { at: [3, 7], rows: ['..LLL', '.lll...gs', '.......LL'] },
      slR: { at: [3, 7], rows: ['.....LLL', '.Wg...lll', '.LL'] },
      pip: { at: [6, -3], rows: ['.RR.', 'RRRr', '.kk.', '.WP.', '.WP.', '.WP.', '.WP.', '..P.'] },
      pipS: { at: [6, -3], rows: ['....', 'rRRr', '.kk.', '.Wg.', '.WP.', '.WP.', '.WP.', '..P.'] },
      pipE: { at: [6, -3], rows: ['.RR.', 'RRRr', '.kk.', '.Wg.', '.Wg.', '.Wg.', '.Wg.', '..g.'] },
      dp: { at: [8, 5], rows: ['P'] },
      spl: { at: [6, 7], rows: ['P...P', '.qqq.'] }
    },
    idle: { ms: 140, frames: ['bub1@6,12', 'bub1@7,11', 'bub1@6,10', 'bub1@7,9', 'tw1@7,7', 'slL', '', 'slR', ''] },
    hover: {
      ms: 110,
      still: 17,
      frames: [
        // se vierte de un lado a otro
        'slL @-1,0', '', 'slR @1,0', '', 'slL @-1,0 *2', '', 'slR @1,0 *2', '',
        // entra la pipeta
        'pip@0,-6', 'pip@0,-4', 'pip@0,-2', 'pip *2', 'pipS dp', 'pipE dp@0,1', 'pipE dp@0,2',
        // la gota cae… ¡y reacciona!
        `${PURPLE} pipE spl`, `${PURPLE} pipE@0,-2 bub1@7,7 bub1@9,10`, `${PURPLE} pipE@0,-4 bub1@8,5 bub1@6,9 bub1@10,11`,
        `${PURPLE} bub1@7,3 bub1@8,7 bub1@5,10`, `${PURPLE} bub1@8,1 bub1@7,5 slL`, `${PURPLE} puff@6,-3 bub1@8,3 slR`,
        `${PURPLE} puff5@5,-5 bub1@7,1`, `${TEAL} puff5@5,-6 tw3@12,-2`, `${TEAL} puff@6,-6 tw1@13,-1 *2`, 'tw3@1,4', '*2'
      ]
    },
    celebrate: {
      ms: 100,
      frames: ['bub1@7,7 bub1@9,10', 'bub1@8,5 bub1@6,9', `${PURPLE} bub1@7,3 bub1@8,6`, `${PURPLE} puff@6,-3 bub1@8,1`, `${TEAL} puff5@5,-4`, ...celebrate(16, `${TEAL} puff@6,-3`, TEAL)]
    }
  },

  // El átomo: los electrones dan vueltas, cada vez más deprisa, y el núcleo suelta un fotón.
  physics: {
    legend: 'W:white Y:gold1 y:gold2',
    cels: {
      ehor: { at: [0, 0], rows: ['eE'] },
      evert: { at: [0, 0], rows: ['e', 'E'] },
      blk: { at: [0, 0], rows: ['EE', 'EE'] },
      glow: { at: [6, 6], rows: ['.WW.', 'WWWW', 'WWWW', '.WW.'] },
      wave: { at: [0, 0], rows: ['.Y..Y', 'Y.YY.', '....'] }
    },
    idle: { ms: 150, frames: ORBIT.slice(0, 4).concat(['']) },
    hover: {
      ms: 130,
      still: 13,
      frames: [
        ...ORBIT, ...ORBIT.map((f) => f.replace('%EO', '%EO')),
        // el núcleo se carga y suelta un fotón
        `${ORBIT[0]} glow`, `${ORBIT[1]} glow twx@6,6`, `${ORBIT[2]} wave@11,6`, `${ORBIT[3]} wave@14,5`, `${ORBIT[4]} wave@17,4`, ORBIT[5], ''
      ]
    },
    celebrate: { ms: 90, frames: [...ORBIT, ...ORBIT, 'glow', ...celebrate(16, 'glow', ORBIT[0])] }
  },

  // La doble hélice: gira sobre sí misma y sus peldaños se encienden.
  biology: {
    legend: 'h:pink1 k:blue1 X:teal2 Z:teal3 Y:gold1',
    idle: { ms: 150, frames: [EDGE, SWAP, EDGE, ''] },
    hover: {
      ms: 120,
      still: 8,
      frames: [EDGE, SWAP, EDGE, '', EDGE, SWAP, EDGE, '', '%rY tw3@-2,-2', `${EDGE} %rY tw1@15,2`, `${SWAP} %rY tw3@15,12`, `${EDGE} tw1@-1,13`, '', EDGE, SWAP, EDGE, '']
    },
    celebrate: { ms: 100, frames: [EDGE, SWAP, EDGE, '', ...celebrate(16, '%rY', EDGE)] }
  },

  // El volcán: retumba, echa humo y entra en erupción.
  earth: {
    legend: 'R:red2 W:white',
    cels: {
      e1: { at: [6, 0], rows: ['.jj.', '.lL.', 'oLLo'] },
      e2: { at: [5, -3], rows: ['..j...', '.jlj..', '..lL.j', '.lLLl.', '..LL..', '.oLLo.'] },
      e3: { at: [2, -3], rows: ['j......L..', '...l..l...', '..L.jj..j.', '....lL....', '....LL....', '...oLLo...'] },
      fall: { at: [0, 0], rows: ['L'] },
      flowL: { at: [4, 6], rows: ['L..', '.L.', '..L', '...'] },
      flowR: { at: [10, 8], rows: ['.L', 'L.', 'L.', '.L'] }
    },
    idle: { ms: 160, frames: ['puff@6,-1', 'puff@7,-2', 'puff@7,-3', ''] },
    hover: {
      ms: 100,
      still: 9,
      frames: [
        '@1,0', '@-1,0', '@1,0 puff@6,-1', '@-1,0 puff@7,-2', '@1,0 puff5@5,-3', '',
        'e1', 'e2', 'e3 puff5@5,-5', 'e3 fall@1,2 fall@14,1 puff5@6,-6 *2', 'e2 flowL fall@0,6 fall@15,5', 'e1 flowL flowR fall@-1,10',
        'flowL flowR puff@6,-3', 'flowL flowR puff@6,-4 *2', 'flowR puff@7,-5', '*2'
      ]
    },
    celebrate: { ms: 100, frames: ['e1', 'e2', 'e3', 'e2', ...celebrate(16, 'e1', 'e1')] }
  },

  // El mapa: la chincheta salta, viaja por el mapa dejando un camino y vuelve a su sitio.
  geography: {
    legend: 'k:ink',
    cels: {
      nopin: { at: [9, 0], rows: ['______', '______', '______', '______', '.oooo_', '.PPPPo', '..P'] },
      pin: { at: [9, 0], rows: ['..oo..', '.ohRo.', 'ohRRRo', 'oRRRro', 'oRRrro', '.oRro.', '..R...'] },
      route: { at: [2, 6], rows: ['.......R', '......R.', '.....R..', 'R.R.R...'] },
      shadow: { at: [0, 0], rows: ['kk'] }
    },
    idle: { ms: 140, frames: ['nopin pin@0,-1', '', 'nopin pin@0,-1', ''] },
    hover: {
      ms: 110,
      still: 7,
      frames: [
        'nopin pin@0,-1', 'nopin pin@0,-3', 'nopin pin@-3,-3', 'nopin pin@-6,-1', 'nopin pin@-8,3', 'nopin pin@-8,4 route *2',
        'nopin pin@-8,3 route', 'nopin pin@-8,4 route tw3@-1,4 *3', 'nopin pin@-6,0 route', 'nopin pin@-3,-3', 'nopin pin@0,-3', 'nopin pin@0,-1', '', 'tw1@14,-1', ''
      ]
    },
    celebrate: { ms: 100, frames: ['nopin pin@0,-2', 'nopin pin@0,-3', 'nopin pin@0,-1', '', ...celebrate(16, 'route')] }
  },

  // El planeta: gira (las manchas cruzan su cara), una luna le da la vuelta y la estrella titila.
  astronomy: {
    legend: 'S:stone1 s:stone2 W:white',
    cels: {
      sp: { at: [0, 0], rows: ['pp'] },
      sp1: { at: [0, 0], rows: ['p'] },
      moon: { at: [0, 0], rows: ['SS', 'Ss'] }
    },
    idle: { ms: 160, frames: ['%Yj', '', '%jY', ''] },
    hover: {
      ms: 130,
      still: 4,
      frames: [
        'sp@4,4 sp1@5,7 moon@-2,2', 'sp@6,4 sp1@6,7 sp1@4,6 moon@0,0', 'sp@8,4 sp1@8,7 sp@4,6 moon@3,-2 %jY', 'sp@9,5 sp1@9,7 sp@5,6 moon@7,-3',
        'sp1@10,5 sp@6,6 sp1@4,8 moon@11,-3 %Yj', 'sp@8,6 sp@5,8 sp1@4,4 moon@14,-1', 'sp@9,6 sp1@7,8 sp@5,4', 'sp1@10,7 sp@8,8 sp@6,4 moon@16,13',
        'sp@9,8 sp@7,4 sp1@5,6 moon@12,15 %jY', 'sp@9,4 sp1@6,6 moon@7,16', 'sp1@10,4 sp@7,6 moon@2,15', 'sp1@9,6 moon@-2,11', 'moon@-3,6', ''
      ]
    },
    celebrate: { ms: 100, frames: ['moon@-2,2', 'moon@3,-2', 'moon@11,-3', 'moon@16,8', 'moon@7,16', 'moon@-3,6', ...celebrate(16, 'tw5@12,-3', '%Yj')] }
  },

  // El brote: llueve, crece un tallo y se abre una flor.
  ecology: {
    legend: 'P:pink2 p:pink3 Y:gold2',
    cels: {
      g1: { at: [7, 3], rows: ['s', 's'] },
      g2: { at: [7, 1], rows: ['s', 's', 's', 's'] },
      bud: { at: [6, -1], rows: ['.P.', '.p.', '.s.', '.s.', '.s.', '.s.'] },
      bloom: { at: [5, -3], rows: ['.P.P.', 'PPYPP', '.PPP.', '..s..', '..s..', '..s..', '..s..', '..s..'] }
    },
    idle: { ms: 150, frames: ['@0,0 drop@12,-3', 'drop@12,-1', 'drop@12,1 tw1@12,0', ''] },
    hover: {
      ms: 120,
      still: 10,
      frames: [
        'drop@3,-3 drop@11,-2', 'drop@3,-1 drop@11,0 drop@7,-3', 'drop@7,-1 tw1@3,1', 'drop@7,1',
        'g1', 'g2', 'bud', 'bud @0,0', 'bloom', 'bloom tw1@1,-2', 'bloom tw3@11,-3 *3', 'bloom heart3@12,-3', 'bloom heart3@13,-4', 'bloom *2', 'bud', 'g2', ''
      ]
    },
    celebrate: { ms: 100, frames: ['g1', 'g2', 'bud', ...celebrate(16, 'bloom', 'bud')] }
  }
}

