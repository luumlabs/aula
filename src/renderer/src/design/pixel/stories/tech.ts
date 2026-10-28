// Historias pixel-art de los iconos de tecnología (programación, electricidad, ingeniería, robótica, arquitectura).
import type { AnimSpec } from '../anim'
import { celebrate } from '../fx'

export const TECH: Record<string, AnimSpec> = {
  // La pantalla: el cursor parpadea, escribe una línea, se ejecuta… ✓.
  programming: {
    legend: 'k:green3',
    cels: {
      off: { at: [4, 8], rows: ['S'] },
      t1: { at: [4, 8], rows: ['ggW'] },
      t2: { at: [4, 8], rows: ['ggSyW'] },
      t3: { at: [4, 8], rows: ['ggSyyyW'] },
      t4: { at: [4, 8], rows: ['ggSyyySpW'] },
      t4o: { at: [4, 8], rows: ['ggSyyySpS'] },
      ok: { at: [2, 2], rows: ['SSSSSSSSSSSS', 'SSSSSSSSSgSS', 'SSSSSSSSgkSS', 'SSSgSSSgkSSS', 'SSSkgSgkSSSS', 'SSSSkgkSSSSS', 'SSSSSkSSSSSS', 'SSSSSSSSSSSS'] }
    },
    idle: { ms: 380, frames: ['off', '', 'off', ''] },
    hover: {
      ms: 110,
      still: 13,
      frames: ['off *2', '*2', 'off *2', '', 't1', 't2', 't2 *2', 't3', 't4', 't4o *2', 't4 *2', 't4o', '%SF t4o', 'ok', 'ok tw3@13,-2', 'ok tw1@14,-1 *4', 'ok', '']
    },
    celebrate: { ms: 100, frames: ['t1', 't2', 't3', 't4', ...celebrate(16, 'ok')] }
  },

  // El rayo: se carga, chisporrotea y suelta descargas.
  electricity: {
    legend: 'W:white',
    idle: { ms: 110, frames: ['%Yj', '', '%Yj', ''] },
    hover: {
      ms: 90,
      still: 6,
      frames: [
        '%Yj', '', '%Yj %gY', '', '%Yj %gY tw1@2,5', '%YW %jW %gj zap@0,2 *2', '%Yj bolt@12,7 boltL@1,0', '@1,0 bolt@13,8 boltL@0,-1',
        '@-1,0 %YW %jW zap@11,9', '%Yj tw3@-1,8 tw3@12,-2', 'tw1@0,9 tw1@13,-1', '', '%Yj', ''
      ]
    },
    celebrate: { ms: 90, frames: ['%Yj', '%YW %jW zap@0,2', '%Yj bolt@12,7', ...celebrate(16, '%Yj', '%YW %jW')] }
  },

  // El casco: se levanta, asoma una carita curiosa y gira un engranaje.
  engineering: {
    legend: 's:stone3 S:stone2 k:ink f:skin1 F:skin2',
    cels: {
      eyes: { at: [4, 11], rows: ['ofkffkfo', 'offkkffo', '.oooooo.'] },
      blink: { at: [6, 11], rows: ['F..F'] },
      gr1: { at: [0, 0], rows: ['.s.s.', 'sSSSs', '.SkS.', 'sSSSs', '.s.s.'] },
      gr2: { at: [0, 0], rows: ['s.s.s', '.SSS.', 'sSkSs', '.SSS.', 's.s.s'] }
    },
    idle: { ms: 140, frames: ['@0,-1', '', '%Yj', ''] },
    hover: {
      ms: 120,
      still: 6,
      frames: [
        '@0,-1', '@0,-2 eyes', '@0,-2 eyes *2', '@0,-2 eyes blink', '@0,-2 eyes', '@0,-2 eyes gr1@13,12', '@0,-2 eyes gr2@13,12',
        '@0,-2 eyes gr1@13,12', '@0,-2 eyes gr2@13,12', '@0,-2 eyes gr1@13,12 tw1@12,9', '@0,-1 gr2@13,12', 'gr1@13,12', 'gr2@14,13', ''
      ]
    },
    celebrate: { ms: 100, frames: ['@0,-2 eyes', '@0,-2 eyes gr1@13,12', '@0,-2 eyes gr2@13,12', ...celebrate(16, 'gr1@13,12', 'gr2@13,12')] }
  },

  // El robot: pita la antena, mira a un lado y a otro, habla… y se enamora.
  robotics: {
    legend: 'Y:gold1',
    cels: {
      lookL: { at: [3, 6], rows: ['ttW...ttW', 'TtW...TtW'] },
      lookR: { at: [4, 6], rows: ['Wtt...Wtt', 'WTt...WTt'] },
      blink: { at: [4, 6], rows: ['WW....WW', 'TT....TT'] },
      mo: { at: [5, 9], rows: ['kRRRk', '.kkk.'] },
      love: { at: [3, 5], rows: ['R.R...R.R', 'RRR...RRR', '.R.....R.'] }
    },
    idle: { ms: 150, frames: ['%RY tw1@8,-1', '', 'blink', ''] },
    hover: {
      ms: 120,
      still: 13,
      frames: [
        '%RY tw1@8,-1', '', '%RY tw1@8,-1', 'lookL *3', 'lookR *3', 'blink', '', 'mo', '', 'mo', 'mo', '', 'love', 'love mo heart3@-2,-1', 'love heart3@-2,-2 heart3@14,0',
        'love mo heart3@14,-1', 'love *2', 'blink', ''
      ]
    },
    celebrate: { ms: 100, frames: ['%RY', 'lookL', 'lookR', ...celebrate(16, 'love mo', 'love')] }
  },

  // La casa: se encienden las ventanas, se abre la puerta y sale humo del tejado.
  architecture: {
    legend: 'k:ink j:gold1',
    cels: {
      open: { at: [8, 8], rows: ['kD', 'kD', 'kd', 'kd', 'kd'] }
    },
    idle: { ms: 150, frames: ['%gj %GY', '', '%gj %GY', ''] },
    hover: {
      ms: 120,
      still: 5,
      frames: ['%gj %GY', '%gj %GY *2', '%gj %GY open', '%gj %GY open heart3@10,9', '%gj %GY open heart3@11,7 puff@6,-2', '%gj %GY open puff@6,-3 tw1@1,9', '%gj %GY puff@7,-4', '%gj %GY', '']
    },
    celebrate: { ms: 100, frames: ['%gj %GY', '%gj %GY open', ...celebrate(16, '%gj %GY open', '%gj %GY')] }
  }
}
