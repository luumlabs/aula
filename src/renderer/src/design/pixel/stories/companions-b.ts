// Historias pixel-art de los compañeros (24×24), segunda mitad. Parches automáticos: blink, pose, happy, wink.
import type { AnimSpec } from '../anim'
import { celebrate } from '../fx'

const cheer = (pose = 'happy', mid = pose) => ({ ms: 100, frames: celebrate(24, pose, mid) })

export const COMPANIONS_B: Record<string, AnimSpec> = {
  // El libro: agita el marcapáginas y le salen letras volando.
  libro: {
    cels: {
      lt: { at: [0, 0], legend: 'k:ink', rows: ['.k.', 'k.k', 'kkk', 'k.k'] },
      lt2: { at: [0, 0], legend: 'k:ink', rows: ['kk.', 'k.k', 'kk.', 'k.k', 'kk.'] }
    },
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 8,
      frames: ['pose', '', 'pose', '@0,-1', 'lt@8,0', 'lt@7,-2 lt2@12,0', 'lt@6,-3 lt2@13,-2', 'lt2@14,-3 pose', 'happy', 'happy tw3@-2,4', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy lt@6,-3', 'happy')
  },

  // La llama: chisporrotea y suelta chispas.
  llama: {
    idle: { ms: 140, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 8,
      frames: ['pose', '', 'pose', '', 'pose c2@8,0 @0,-1', 'c2@9,-2 c2@14,1', 'pose c2@10,-3 c2@15,-1', 'c2@16,-3', 'happy', 'happy pose tw3@-2,4', 'happy', 'happy pose', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // La mariposa: bate las alas y revolotea.
  mariposa: {
    idle: { ms: 140, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 9,
      frames: ['pose', '', 'pose', '@1,-1', 'pose @2,-2', '@1,-3', 'pose @-1,-2', '@-2,-1', 'pose', 'happy heart3@20,-2', 'happy pose heart3@20,-3', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // La montaña: nieva, ondea su banderita y sale el sol.
  montana: {
    cels: { sn: { at: [0, 0], legend: 'w:stone1', rows: ['w'] } },
    idle: { ms: 200, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 130,
      still: 6,
      frames: [
        'pose', 'sn@3,-2 sn@20,0', 'pose sn@4,1 sn@19,3 sn@10,-3', 'sn@3,4 sn@20,6 sn@11,0', 'pose sn@4,7 sn@11,3', 'sn@12,6', 'happy tw5@20,-3', 'happy pose tw5@20,-3',
        'happy *2', ''
      ]
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // La nota: rebota al compás y canta.
  nota: {
    idle: { ms: 160, frames: ['@0,-1', '', 'note@20,8', ''] },
    hover: {
      ms: 110,
      still: 7,
      frames: ['@0,-2', '@0,-1', 'note@20,8', 'note@21,6 @0,-2', 'note@22,4 note2@-3,10 @0,-1', 'note2@-3,8', 'note2@-3,6 @0,-2', 'happy', 'happy tw3@20,2 @0,-1', 'happy', 'happy pose', '']
    },
    celebrate: cheer('happy note@20,6', 'happy')
  },

  // La ola: rompe y salpica.
  ola: {
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: ['@1,0', 'pose @2,0', '@1,0 drop@20,6 drop@18,3', 'pose drop@21,4 drop@17,1', 'drop@22,7 drop@16,0', '@-1,0', 'happy', 'happy pose tw3@-2,4', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El pájaro: canta, aletea y da un saltito.
  pajaro: {
    idle: { ms: 180, frames: ['pose', '', 'note@-2,6', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: ['pose', '', 'note@-2,6', 'note@-3,4 pose', 'note@-3,2', '@0,-2', 'pose @0,-3', '@0,-1', 'dust@6,22 dust@13,22', 'happy', 'happy note@-2,4', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El planeta: su anillo gira y la luna le da la vuelta.
  planeta: {
    legend: 'X:stone3',
    idle: { ms: 200, frames: ['%6X %76 %X7', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 7,
      frames: ['%6X %76 %X7', '', '%6X %76 %X7', '', 'pose', 'tw1@20,2', 'pose tw3@19,1', 'happy', 'happy %6X %76 %X7', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy %6X %76 %X7', 'happy')
  },

  // La pluma: sale del tintero y escribe una línea con florituras.
  pluma: {
    cels: {
      sq1: { at: [3, 23], legend: 'k:blue3', rows: ['.kk.....', 'k..k....'] },
      sq2: { at: [3, 23], legend: 'k:blue3', rows: ['.kk..kk.', 'k..kk..k'] },
      sq3: { at: [3, 23], legend: 'k:blue3', rows: ['.kk..kk..kk.', 'k..kk..kk..k'] }
    },
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 6,
      frames: ['pose', '', 'pose sq1', 'sq2', 'pose sq3', 'sq3 tw1@16,22', 'happy sq3', 'happy sq3 tw3@-2,4', 'happy pose sq3', 'happy', '']
    },
    celebrate: cheer('happy sq3', 'happy')
  },

  // El rayo: destella y suelta descargas.
  rayo: {
    idle: { ms: 140, frames: ['pose', '', '%25', ''] },
    hover: {
      ms: 90,
      still: 7,
      frames: ['%25', '', '%25 zap@-3,4', 'zap@20,12', '%25 bolt@-2,8 boltL@19,2', '', 'pose', 'happy', 'happy %25 tw3@-2,0', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy %25', 'happy')
  },

  // El despertador: ¡riiing! Tiembla, suenan las campanas y se queda tan pancho.
  reloj: {
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 80,
      still: 9,
      frames: ['pose @1,0', '@-1,0', 'pose @1,0 bang@22,-2', '@-1,0 bang@22,-2', 'pose @1,0 bolt@-3,2 boltL@22,2', '@-1,0', 'pose @1,0', '', '*3', 'happy', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El robot: parpadea la antena, baila un poco y se enamora.
  robot: {
    idle: { ms: 180, frames: ['%78', '', '%78', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: ['%78', '', '%78', 'pose', '@1,0', '@-1,0 pose', '@1,0', '@-1,0 pose', '', 'happy %78', 'happy', 'happy %78 heart3@20,0', 'happy heart3@20,-2', '']
    },
    celebrate: cheer('happy %78', 'happy')
  },

  // La semilla: la riegan y le crecen las hojas.
  semilla: {
    idle: { ms: 200, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 130,
      still: 6,
      frames: ['drop@9,-3', 'drop@9,-1 drop@14,-3', 'drop@14,-1', 'pose', 'pose @0,-1', 'pose', 'happy pose', 'happy pose tw3@19,0', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El sobre: da un saltito y le sale un corazón.
  sobre: {
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: ['@0,-1', '', 'heart@9,4', 'heart@9,1 @0,1', 'heart@9,-2', 'heart@9,-3 tw3@15,-3', 'happy', 'happy heart3@3,0', 'happy heart3@3,-2 heart3@18,0', 'happy', '']
    },
    celebrate: cheer('happy heart@9,-3', 'happy')
  },

  // El sol: giran sus rayos y se pone las gafas de sol.
  sol: {
    cels: { sh: { at: [7, 10], legend: 'k:ink w:white', rows: ['kkwkkkkwkk', '.kkk..kkk.'] } },
    idle: { ms: 200, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 7,
      frames: ['pose', '', 'pose', '', 'sh@0,-3', 'sh@0,-1', 'sh', 'sh pose tw1@9,9', 'sh tw3@8,8', 'sh pose', 'sh *3', 'sh@0,-2', '']
    },
    celebrate: cheer('sh pose', 'sh')
  },

  // La medusa: sube latiendo entre burbujas.
  medusa: {
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 120,
      still: 7,
      frames: ['pose', '@0,-1', 'pose @0,-3', 'bub1@20,6 @0,-4', 'pose bub1@20,4 @0,-3', 'bub1@21,2 @0,-1', '', 'happy', 'happy pose', 'happy heart3@20,0', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El pulpo: mueve los tentáculos, suelta tinta y se esconde… y vuelve.
  pulpo: {
    cels: { pk: { at: [0, 0], legend: 'k:ink K:stone4', rows: ['.kk.', 'kKKk', '.kk.'] } },
    idle: { ms: 180, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: ['pose', '', 'pose', '@1,0 pk@-3,14', '@3,0 pk@-3,13 pk@-2,16', '@3,0 pk@-3,14', '@2,0', 'pose @1,0', '', 'happy', 'happy pose', 'happy heart3@20,0', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // La rana: se acerca una mosca… ¡lengüetazo!
  rana: {
    cels: { fly: { at: [0, 0], legend: 'k:ink w:white', rows: ['w.w', '.k.'] } },
    idle: { ms: 180, frames: ['blink', '', 'pose', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: ['fly@24,2', 'fly@22,5', 'fly@21,8', 'fly@19,10', 'pose fly@19,11', 'pose', 'happy @0,-1', 'happy', 'happy @0,-2', 'happy @0,-1', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // El murciélago: despliega las alas y revolotea.
  murcielago: {
    idle: { ms: 160, frames: ['pose', '', 'pose', ''] },
    hover: {
      ms: 100,
      still: 9,
      frames: ['pose', '', 'pose @0,-1', '@0,-2', 'pose @1,-2', '@2,-1', 'pose @1,0', '', 'happy', 'happy pose', 'happy heart3@20,0', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  },

  // La luciérnaga: se le enciende la luz y revolotea.
  luciernaga: {
    cels: { g: { at: [0, 0], rows: ['C'] } },
    idle: { ms: 180, frames: ['%AC %9A', '', '%AC %9A', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: [
        '%AC %9A', '', '%AC %9A g@5,14 g@18,14', 'pose %AC %9A g@4,16 g@19,16 g@11,21', '%AC %9A g@3,18 g@20,18', 'pose', '@0,-1', 'pose @0,-2', '@0,-1', 'happy %AC %9A',
        'happy pose', 'happy', ''
      ]
    },
    celebrate: cheer('happy %AC %9A', 'happy')
  },

  // El dragón: toma aire… ¡y echa fuego!
  dragon: {
    legend: 'f:orange2 g:gold2 h:gold1 r:red2',
    cels: {
      f1: { at: [13, 12], rows: ['fg', 'gf'] },
      f2: { at: [14, 11], rows: ['.gff.', 'ghhfr', '.gff.'] },
      f3: { at: [16, 10], rows: ['..ggfr.r', '.ghhhffr', 'ghhhhgfr', '.ghhhffr', '..ggfr.r'] }
    },
    idle: { ms: 180, frames: ['pose', '', 'blink', ''] },
    hover: {
      ms: 100,
      still: 6,
      frames: ['pose', '', '@0,1', 'f1', 'f2', 'f3', 'f3 *2', 'f2 puff@20,7', 'puff5@19,5', 'puff@21,3', 'happy', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy f2', 'happy')
  },

  // El erizo: se hace una bola, rueda y se despereza.
  erizo: {
    idle: { ms: 180, frames: ['pose', '', 'blink', ''] },
    hover: {
      ms: 90,
      still: 10,
      frames: ['@0,1', '<> @1,1', '@2,1', '<> @3,1', '@4,1', '<> @3,1', '@2,1', '<> @1,1', '', 'dust@4,22 dust@15,22', 'happy', 'happy pose', 'happy', '']
    },
    celebrate: cheer('happy pose', 'happy')
  }
}
