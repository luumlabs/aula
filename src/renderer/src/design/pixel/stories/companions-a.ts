// Historias pixel-art de los compañeros (24×24), primera mitad. Además de sus parches, cada compañero tiene parches
// automáticos: `blink` (ojos cerrados), `pose` (su otra pose), `happy` (ojos felices ^ ^) y `wink` (guiño).
import type { AnimSpec } from '../anim'
import { celebrate } from '../fx'

/** Celebración de un compañero: salto con destellos y confeti, con su pose feliz. */
const cheer = (pose = 'happy', mid = pose) => ({ ms: 100, frames: celebrate(24, pose, mid) })

export const COMPANIONS_A: Record<string, AnimSpec> = {
  // La luna dormilona: ronca, se despierta con un bostezo, sonríe… y vuelve a dormirse.
  luna: {
    cels: {
      awake: { at: [7, 14], rows: ['A67....A67', 'AA7....AA7'] },
      yawn: { at: [10, 17], rows: ['AAAA', 'ABBA', '.AA.'] },
      happy: { at: [7, 14], rows: ['7A7....7A7', 'A7A....A7A'] }
    },
    idle: { ms: 300, frames: ['zz@19,2', 'zz@20,0', 'zz@21,-2', ''] },
    hover: {
      ms: 120,
      still: 10,
      frames: [
        'zz@19,2', 'zz@20,0 pose', 'zz@21,-2', 'pose', 'awake bang@20,2', 'awake *2', 'awake yawn', 'awake yawn *2', 'awake', 'happy tw3@-2,0',
        'happy tw1@-1,1 tw3@20,-1', 'happy pose tw5@19,-3', 'happy *2', 'pose', 'zz@19,2', 'zz@20,0', ''
      ]
    },
    celebrate: cheer('happy', 'happy pose')
  },

  // El gato: bosteza, mueve la cola y ronronea corazones.
  gato: {
    cels: { yawn: { at: [9, 13], rows: ['466664', '465564', '246642'] } },
    idle: { ms: 200, frames: ['pose', '', 'blink', ''] },
    hover: {
      ms: 120,
      still: 10,
      frames: [
        'blink', 'blink yawn', 'blink yawn *3', 'blink', '', 'pose', '', 'pose', '', 'happy heart3@19,6', 'happy heart3@19,4', 'happy pose heart3@20,2',
        'happy heart3@20,0 heart3@1,4', 'happy pose heart3@1,2', 'happy *2', ''
      ]
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El zorro: tiesas las orejas, se agacha… ¡y salta!
  zorro: {
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 11,
      frames: ['pose', '', 'pose', '', '@0,1', '@0,1 *2', '@-1,-2', '@-2,-4', '@-3,-3', '@-4,-1', '@-4,0 dust@-4,22 dust@3,22', '@-4,0 happy', '@-3,0 happy pose', '@-2,0 happy', '@-1,0 happy', 'happy *2', '']
    },
    celebrate: cheer()
  },

  // El búho: gira la cabeza a un lado y a otro, da un saltito y ulula.
  buho: {
    idle: { ms: 160, frames: ['blink', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 9,
      frames: ['pose', '<>', '<> blink', '', '<>', '', '@0,-1', '@0,-2 pose', '@0,-1', 'note@20,4', 'happy note@21,2', 'happy note@22,0', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El fantasma: se vuelve transparente, desaparece… ¡y BU!
  fantasma: {
    cels: { boo: { at: [9, 12], rows: ['444444', '466664', '466664', '.4444.'] } },
    idle: { ms: 200, frames: ['%23 %12', '', '%23 %12', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: [
        '%23 %12', '%2_ %3_ %1_', '%2_ %3_ %1_ *3', '%23 %12', '', 'boo @0,-1 bang@20,0', 'boo @0,-2 bang@20,-1', 'boo @0,-1 *2', '', 'happy', 'happy @0,-1 tw3@-2,2', 'happy',
        'happy pose', ''
      ]
    },
    celebrate: cheer('happy boo', 'happy')
  },

  // La seta: da saltitos y suelta esporas doradas.
  seta: {
    cels: { sp: { at: [0, 0], legend: 'y:gold2', rows: ['y'] } },
    idle: { ms: 160, frames: ['pose', '', 'sp@4,2', 'sp@4,0', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: [
        '@0,1', 'sp@4,2 sp@19,1 @0,-1', 'sp@3,0 sp@20,-1 sp@11,-2 @0,-2', 'sp@2,-2 sp@21,-3 sp@12,-3 @0,-1', 'sp@1,-3 sp@13,-3', 'pose', '', 'pose',
        'happy', 'happy tw3@-2,8', 'happy pose tw3@21,7', 'happy', ''
      ]
    },
    celebrate: cheer('happy sp@4,2 sp@19,1', 'happy')
  },

  // La taza: el vapor sube haciendo eses y sale un corazón.
  taza: {
    cels: {
      nost: { at: [8, 4], rows: ['______', '______', '______', '______'] },
      st1: { at: [8, 4], rows: ['.C..C.', 'C....C', '.C..C.', 'C....C'] },
      st2: { at: [8, 4], rows: ['C....C', '.C..C.', 'C....C', '.C..C.'] }
    },
    idle: { ms: 220, frames: ['nost st2', '', 'nost st2', ''] },
    hover: {
      ms: 140,
      still: 8,
      frames: [
        'nost st2', 'nost st1@0,-1', 'nost st2@0,-2', 'nost st1@0,-3', 'nost heart3@9,4', 'nost heart3@9,2', 'nost heart3@10,0 st2@0,2', 'nost heart3@10,-2 st1@0,1',
        'happy', 'happy @0,-1', 'happy', ''
      ]
    },
    celebrate: cheer('happy nost heart3@9,2', 'happy')
  },

  // El cohete: chisporrotea, despega entre humo y vuelve a posarse.
  cohete: {
    legend: 'f:orange2 g:gold2 h:gold1',
    cels: {
      fl2: { at: [10, 22], rows: ['GFFG', '.HH.'] },
      big: { at: [9, 22], rows: ['.fggf.', 'fghhgf', '.ghhg.', '..hh..'] }
    },
    idle: { ms: 120, frames: ['fl2', '', 'fl2', ''] },
    hover: {
      ms: 90,
      still: 7,
      frames: [
        'fl2', '', 'fl2', 'big', 'big @0,-1 puff5@1,19 puff5@16,19', 'big @0,-3 puff5@0,20 puff5@18,20', 'big @0,-5 puff@2,21 puff@19,21', 'big @0,-7', 'big @0,-7',
        'big @0,-5', 'big @0,-3', 'fl2 @0,-1', '', 'happy', 'happy tw3@19,2', 'happy fl2', ''
      ]
    },
    celebrate: cheer('happy big', 'happy fl2')
  },

  // La estrella: gira sobre sí misma, guiña un ojo y brilla.
  estrella: {
    idle: { ms: 160, frames: ['pose', '', 'tw1@20,2', ''] },
    hover: {
      ms: 100,
      still: 8,
      frames: ['<>', '', '<> tw1@0,0', '', '<>', 'tw3@-2,1 tw1@21,3', 'wink', 'wink', 'happy tw3@20,-2', 'happy tw5@-3,-3 @0,-1', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy tw1@20,2', 'happy')
  },

  // La nube: llueve, sale el sol… y un arcoíris.
  nube: {
    cels: { rb: { at: [6, 20], legend: 'r:red2 y:gold2 g:green2 b:blue2', rows: ['...rrrrrr...', '.rryyyyyyrr.', 'ryyggggggyyr', 'ygg......ggy', 'g..........g'] } },
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 8,
      frames: [
        'drop@6,20', 'drop@6,22 drop@12,20', 'drop@6,24 drop@12,22 drop@17,20', 'drop@12,24 drop@17,22 drop@8,20', 'drop@17,24 drop@8,22', 'drop@8,24', 'tw5@19,-1',
        'happy rb', 'happy rb tw3@-2,2', 'happy rb *3', 'happy', ''
      ]
    },
    celebrate: cheer('happy rb', 'happy')
  },

  // La gota: cae, salpica y rebota.
  gota: {
    cels: { spl: { at: [5, 23], legend: 'b:blue1 B:blue2', rows: ['b............b', '.bBBBBBBBBBBb.'] } },
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 6,
      frames: ['@0,1', '@0,2 spl', '@0,2 spl drop@2,17 drop@20,17', '@0,-2 drop@1,14 drop@21,14', '@0,-3 happy', '@0,-1 happy', 'happy', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy', 'happy pose')
  },

  // El pez: echa burbujas, mueve la cola y se lanza hacia delante.
  pez: {
    cels: { bb: { at: [0, 0], rows: ['.B.', 'B.B', '.B.'] }, b1: { at: [0, 0], rows: ['B'] } },
    idle: { ms: 160, frames: ['pose', '', 'b1@1,12', 'b1@1,10', ''] },
    hover: {
      ms: 110,
      still: 10,
      frames: [
        'b1@1,12', 'b1@1,10 bb@0,7', 'bb@-1,4 b1@2,9', 'bb@0,1 pose', 'pose', '@-1,0', '@-2,0 whooshL@22,9', 'pose @-3,0 whooshL@21,9', '@-2,0', '@-1,0', 'happy',
        'happy b1@1,10', 'happy pose bb@0,6', 'happy', ''
      ]
    },
    celebrate: cheer('happy bb@0,6', 'happy pose')
  },

  // La abeja: zumba, da una vuelta y vuelve con corazones.
  abeja: {
    idle: { ms: 90, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 90,
      still: 12,
      frames: [
        'pose', '', 'pose', '', 'pose @-1,-1', '@-2,-2', 'pose @-1,-3', '@1,-3', 'pose @2,-2', '@2,0', 'pose @1,1', '', 'happy heart3@19,0', 'happy pose heart3@19,-2',
        'happy heart3@20,-3', 'happy', ''
      ]
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El árbol: se mece, se le cae una manzana… y la recoge contento.
  arbol: {
    cels: { noap: { at: [5, 11], rows: ['2'] }, ap: { at: [0, 0], legend: 'r:red2 g:green3', rows: ['.g', 'rr', 'rr'] } },
    idle: { ms: 200, frames: ['@1,0', '', '@-1,0', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: [
        '@1,0', '@-1,0', '@1,0', 'noap ap@4,11', 'noap ap@4,14', 'noap ap@4,18', 'noap ap@4,21 dust@3,23', 'noap ap@4,19', 'noap ap@4,21', 'noap ap@4,21 happy',
        'noap ap@4,21 happy tw3@1,17', 'happy', 'happy @0,-1', ''
      ]
    },
    celebrate: cheer('happy noap ap@4,21', 'happy')
  },

  // La bombilla: parpadea, se apaga, duda… ¡y se enciende de golpe!
  bombilla: {
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 9,
      frames: [
        '%17 %27 %47 %B_', '', '%17 %27 %47 %B_ *2', '', '%17 %27 %47 %B_ *2', '%17 %27 %47 %B_ ask@20,0 *2', '%23', 'happy pose twx@-2,6 twx@23,6',
        'happy tw5@-3,-3 tw5@21,-3', 'happy pose', 'happy', ''
      ]
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El cactus: saluda con los brazos y se le cae un pétalo.
  cactus: {
    cels: { pet: { at: [0, 0], rows: ['1'] } },
    idle: { ms: 200, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 4,
      frames: ['pose', '', 'pose', '', 'happy pose', 'happy', 'pet@12,4', 'pet@14,7', 'pet@16,10', 'pet@18,13', 'pet@20,15 happy', 'happy pose tw3@-2,2', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El caracol: avanza despacito dejando su rastro, mira… y sonríe.
  caracol: {
    cels: { sl: { at: [0, 0], legend: 'w:stone1', rows: ['ww'] }, happy: { at: [1, 5], rows: ['.22..22.', '2__22__2'] } },
    idle: { ms: 260, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 160,
      still: 9,
      frames: [
        'pose', '', 'pose @1,0', '@1,0 sl@1,21', 'pose @1,0 sl@1,21', '@2,0 sl@1,21 sl@3,21', 'pose @2,0 sl@1,21 sl@3,21', '@2,0 sl@1,21 sl@3,21 blink',
        '@2,0 sl@3,21 happy', '@2,0 happy tw3@-1,3', '@1,0 happy pose', 'happy', ''
      ]
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El cometa: sale disparado dejando chispas y vuelve.
  cometa: {
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 90,
      still: 8,
      frames: ['@1,-1 tw1@-2,22', '@2,-2 tw3@-3,20 tw1@2,22', '@3,-3 tw1@-2,18 tw3@1,21', '@2,-2 tw1@3,22', '@1,-1', '', 'pose', 'happy', 'happy tw5@20,-3', 'happy pose tw3@-2,16', 'happy', '']
    },
    celebrate: cheer('happy tw1@-2,22', 'happy pose')
  },

  // El corazón: late, se acelera… y se ríe.
  corazon: {
    idle: { ms: 140, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 11,
      frames: [
        'pose *2', '*2', 'pose *2', '*2', 'pose', '', 'pose', '', 'pose', '', 'happy pose heart3@-2,2', 'happy heart3@-2,0 heart3@21,3', 'happy pose heart3@21,1',
        'happy @0,-1', 'happy', 'happy pose', ''
      ]
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El cristal: brilla por dentro y le salen destellos.
  cristal: {
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 8,
      frames: ['%26', '%16 %26', '%46', '', 'pose', 'tw3@-2,6', 'tw5@20,10', 'pose tw1@-1,7', 'happy %26', 'happy tw3@19,-2', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy %26', 'happy')
  },

  // El farol: se balancea y su llama brilla más fuerte.
  farol: {
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 9,
      frames: ['@1,0', '', '@-1,0', '', '%5A', '%5A pose', '%5A %85', '%5A %85 pose tw3@-2,8 tw3@21,8', '%5A', 'happy', 'happy pose', 'happy @0,-1', 'happy', '']
    },
    celebrate: cheer('happy %5A pose', 'happy %5A')
  },

  // La hoja: cae meciéndose y el viento la sube otra vez.
  hoja: {
    idle: { ms: 180, frames: ['pose', '', '@1,0', ''] },
    hover: {
      ms: 110,
      still: 7,
      frames: ['@-1,1', '@-2,2', '@-1,3', '@1,3', '@2,2', '@1,1 whooshL@-3,8', '@0,-1 whooshL@-2,6', 'happy', 'happy pose', 'happy tw3@20,2', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  }
}
