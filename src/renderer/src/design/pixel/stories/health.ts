// Historias pixel-art de los iconos de salud (anatomía, medicina, farmacia, nutrición, veterinaria).
import type { AnimSpec } from '../anim'
import { rep } from '../anim'
import { celebrate } from '../fx'

// El corazón contraído (un píxel más pequeño por cada lado): late pasando de este al dibujo base.
const HEART_SMALL = [
  '______________',
  '___oo____oo___',
  '__ohho__oRRo__',
  '_ohWhRooRRRro_',
  '_ohRRRRWRRRro_',
  '_oRRRRWRWRRro_',
  '_oWWWWRRRWWWo_',
  '__oRRRRRRRRo__',
  '___oRRRRRRo___',
  '____oRRrro____',
  '_____orro_____',
  '______oo______',
  '______________'
]

// Palas del desfibrilador (entran desde los lados).
const PAD_L = ['..Ss', '..Ss', 'kkSs', 'kkSs', '..ss']
const PAD_R = ['sS..', 'sS..', 'sSkk', 'sSkk', 'ss..']

export const HEALTH: Record<string, AnimSpec> = {
  // El corazón: late, se acelera, se para del susto, electrochoque… y se ríe.
  anatomy: {
    legend: 'S:stone1 s:stone2 k:stone4 Y:gold1 y:gold2 m:red4 t:pink2 c:pink1 q:pink1',
    cels: {
      small: { at: [1, 2], rows: HEART_SMALL },
      flat: { at: [3, 6], rows: ['.....R', '....R.R', 'WWWWWWWWWW'] },
      padL: { at: [-3, 5], rows: PAD_L },
      padR: { at: [15, 5], rows: PAD_R },
      eyes: { at: [5, 5], rows: ['o....o', 'o....o'] },
      dizzy: { at: [4, 4], rows: ['o.o..o.o', '.o....o.', 'o.o..o.o'] },
      happy: { at: [4, 5], rows: ['.o....o.', 'o.o..o.o'] },
      smile: { at: [3, 8], rows: ['c.o....o.c', '...oooo...'] },
      laugh: { at: [3, 8], rows: ['c.oooooo.c', '..omttmo..', '...oooo...'] }
    },
    idle: { ms: 120, frames: ['small', '', 'small', '*2'] },
    hover: {
      ms: 95,
      still: 34,
      frames: [
        // late tranquilo
        'small *2', '*3', 'small *2', '*3',
        // se acelera
        'small', '', 'small', '', 'small', '', 'small', '',
        // ¡se para! (la línea del electro se aplana)
        'small flat %Rq %hq bang@7,-3 *4',
        // llegan las palas y… ¡zas!
        'small flat %Rq %hq padL@-2,0 padR@2,0', 'small flat %Rq %hq padL padR *2',
        'padL padR %RY %hY %rY bolt@-3,0 boltL@16,0 @1,0',
        'padL padR zap@-3,1 zap@14,1 %RW %hW',
        'padL padR %RY %hY %rY bolt@-3,1 boltL@16,1 @-1,0',
        'padL padR @1,0', 'padL@-2,0 padR@2,0',
        // aturdido, humeando
        '%WR dizzy puff@3,-2', '%WR dizzy puff@4,-3 puff@10,-2', '%WR dizzy puff@10,-3', '%WR eyes *2',
        // vuelve a latir… y se ríe
        'small', '%WR eyes', 'small', '%WR eyes smile *2',
        '%WR happy laugh @0,-1 heart3@-2,1', '%WR happy smile heart3@-2,0', '%WR happy laugh @0,-1 heart3@-2,-1 heart3@15,1', '%WR happy smile heart3@15,0',
        '%WR happy laugh @0,-1 heart3@15,-1', '%WR happy smile', '%WR happy laugh @0,-1', '%WR happy smile *3', '*2'
      ]
    },
    celebrate: { ms: 100, frames: ['small', '', 'small', '', ...celebrate(16, '%WR happy laugh', '%WR happy smile')] }
  },

  // El botiquín: la cruz se vuelve corazón, late, recibe una descarga y se ríe.
  medicine: {
    legend: 'Y:gold1 y:gold2 m:red4',
    cels: {
      kh: { at: [4, 5], rows: ['RWWRRWWR', 'WWWWWWWW', 'WWWWWWWW', 'RWWWWWWR', 'RRWWWWRR', 'RRRWWRRR'] },
      khS: { at: [4, 5], rows: ['RRRRRRRR', 'RWWRRWWR', 'RWWWWWWR', 'RRWWWWRR', 'RRRWWRRR', 'RRRRRRRR'] },
      face: { at: [4, 5], rows: ['RWWRRWWR', 'WoWWWWoW', 'WWWWWWWW', 'RWooooWR', 'RRWmmWRR', 'RRRWWRRR'] },
      grin: { at: [4, 5], rows: ['RWWRRWWR', 'WoWWWWoW', 'WWWWWWWW', 'RWoWWoWR', 'RRWooWRR', 'RRRWWRRR'] },
      lid: { at: [1, 3], rows: ['_oooooooooooo_'] },
      lidUp: { at: [1, 2], rows: ['.oooooooooooo.', 'ohRRRRRRRRRRo.'] }
    },
    idle: { ms: 130, frames: ['kh', 'khS', 'kh', ''] },
    hover: {
      ms: 100,
      still: 22,
      frames: [
        'kh *2', 'khS *2', 'kh *2', 'khS *2',
        'kh', 'khS', 'kh', 'khS', 'kh', 'khS',
        'kh bolt@-3,4 boltL@16,4 %RY @1,0', 'kh zap@-3,5 zap@14,5 @-1,0', 'kh bolt@-3,5 boltL@16,5 %RY @1,0', 'kh',
        'khS puff@2,-1', 'kh puff@3,-2', 'face *2',
        'face @0,-1 heart3@-2,3', 'grin heart3@-2,2', 'face @0,-1 heart3@-2,1 heart3@15,3', 'grin heart3@15,2', 'face @0,-1 heart3@15,1', 'grin *3', '*2'
      ]
    },
    celebrate: { ms: 100, frames: ['kh', 'khS', 'kh', ...celebrate(16, 'face', 'grin')] }
  },

  // La cápsula: se abre por la mitad, saltan granitos de colores y se vuelve a cerrar.
  pharmacy: {
    legend: 'y:gold2 g:green2 b:blue2 p:pink2',
    cels: {
      cap: { at: [6, 1], rows: ['....ooo..', '...ohRRo.', '..ohRRRro', '.ohRRRRro', 'ohRRRRRro', '.oRRRRro.', '..oRRro..', '...oro...'] },
      body: { at: [2, 6], rows: ['...oWWo....', '..oWWWWo...', '.oWWWWWWo..', 'oWWWWWWwso.', 'oWWWWWwso..', 'oWWWWwso...', '.owwsso....', '..oooo.....'] },
      grains: { at: [8, 4], rows: ['y.', '.g'] },
      grains2: { at: [6, 1], rows: ['b..y', '..p.', 'g...'] },
      grains3: { at: [4, -2], rows: ['y....b', '..g...', 'p...y.'] }
    },
    idle: { ms: 130, frames: ['tw1@11,3', 'tw3@10,2', 'tw1@11,3', ''] },
    hover: {
      ms: 100,
      still: 5,
      frames: [
        '@1,0', '@-1,0', '@1,0', '',
        '- body cap@1,-1 grains', '- body cap@2,-2 grains2', '- body cap@3,-3 grains3 *2', '- body cap@3,-3 grains3@0,-1 tw1@0,2',
        '- body cap@2,-2 grains3@1,-2', '- body cap@1,-1', '', '@0,1', '', 'tw3@11,1', 'tw1@12,2', ''
      ]
    },
    celebrate: { ms: 100, frames: ['- body cap@1,-1', '- body cap@2,-2 grains2', ...celebrate(16, 'tw1@11,3')] }
  },

  // La manzana: le sale una hojita nueva, alguien le da un mordisco… y se recompone.
  nutrition: {
    legend: 'p:paper1 L:green2 l:green3',
    cels: {
      leaf: { at: [8, -1], rows: ['...LL', '..LLl', '.oLlo', '..oo.'] },
      biteA: { at: [11, 5], rows: ['_o', 'op', 'op', '_o'] },
      biteB: { at: [10, 5], rows: ['_oo', 'opp', 'opp', 'opp', '_oo'] },
      crumbs: { at: [13, 4], rows: ['p..', '..p', '.p.'] }
    },
    idle: { ms: 140, frames: ['@0,-1', '', 'tw1@4,5', ''] },
    hover: {
      ms: 110,
      still: 7,
      frames: ['leaf@-1,1', 'leaf@0,0', 'leaf *2', 'biteA crumbs@1,-1', 'biteA crumbs@1,1', 'biteB crumbs@1,0', 'biteB crumbs@2,3 *2', 'biteB *3', 'biteB @0,-1', 'biteA', 'tw3@11,4', 'tw1@12,5', '']
    },
    celebrate: { ms: 100, frames: celebrate(16, 'leaf') }
  },

  // La huella: deja huellitas que se alejan andando.
  veterinary: {
    legend: 'k:wood2 K:wood3',
    cels: {
      print: { at: [0, 0], rows: ['.k.k.', 'k...k', '.kkk.', '.kKk.'] },
      wiggle: { at: [1, 4], rows: ['_ohBBo', 'oBBBo_'] }
    },
    idle: { ms: 130, frames: ['@0,-1', '', '@0,-1', ''] },
    hover: {
      ms: 110,
      still: 4,
      frames: ['@0,-1', '', 'print@-3,13', 'print@-3,13 print@1,15', 'print@1,15 print@6,13', 'print@6,13 print@11,15', 'print@11,15 print@15,13', 'print@15,13', '@0,-1', '', '@0,-1 heart3@14,0', 'heart3@14,-1', '']
    },
    celebrate: { ms: 100, frames: [...rep(2, '@0,-1', ''), ...celebrate(16, 'heart3@13,0')] }
  }
}
