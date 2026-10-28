// Historias pixel-art de los iconos de sociedad (economía, contabilidad, empresa, periodismo, derecho, marketing, política).
import type { AnimSpec, CelSpec } from '../anim'
import { celebrate } from '../fx'
import { SPRITES } from '../sprites'

const rowsOf = (id: string) => SPRITES.find((s) => s.id === id)?.rows ?? []

/** La balanza inclinada: los platillos bajan/suben 2·d píxeles y el brazo hace escalón (dibujado desde el sprite). */
function scales(d: number): CelSpec {
  const src = rowsOf('law')
  const at = (x: number, y: number) => (y >= 0 && y < 16 ? src[y][x] : '.')
  const dy = (x: number) => (x <= 4 ? 2 * d : x === 5 ? d : x === 10 ? -d : x >= 11 ? -2 * d : 0)
  const rows = Array.from({ length: 19 }, (_, j) => {
    const y = j - 3
    return Array.from({ length: 16 }, (_, x) => (y >= 10 ? at(x, y) : at(x, y - dy(x)))).join('')
  })
  return { at: [0, -3], rows }
}

/** La urna por delante (desde la ranura hacia abajo), para que la papeleta se esconda al entrar. */
function boxFront(): CelSpec {
  return { at: [0, 5], rows: rowsOf('politics').slice(5) }
}

export const SOCIETY: Record<string, AnimSpec> = {
  // Las monedas: cae una moneda, la flecha se dispara hacia arriba.
  economics: {
    cels: {
      noArrow: { at: [7, 0], rows: ['_________', '_________', '_________', '_________', '_________', '_________', 'oo_______', 'jjo______'] },
      arr: { at: [7, 0], rows: ['..oooooo.', '.oaAAAAAo', '..oaAAAAo', '...oaAAAo', '..oaAsAAo', '.oaAsosAo', '.aAso.oo.', 'aAso.....'] }
    },
    idle: { ms: 140, frames: ['noArrow arr@1,-1', '', 'tw1@3,6', ''] },
    hover: {
      ms: 110,
      still: 6,
      frames: [
        'coin@2,-5', 'coin@2,-3', 'coin@2,-1', 'coin@2,1', 'tw3@1,4 dust@1,6', 'noArrow arr@1,-1', 'noArrow arr@2,-2 whooshL@6,6', 'noArrow arr@3,-3 tw3@15,-3 *2',
        'noArrow arr@2,-2', 'noArrow arr@1,-1', '', 'coin@2,-4', 'coin@2,0', 'tw1@3,5', ''
      ]
    },
    celebrate: { ms: 100, frames: ['coin@2,-3', 'coin@2,1', 'noArrow arr@2,-2', ...celebrate(16, 'noArrow arr@1,-1', 'noArrow arr@2,-2')] }
  },

  // La calculadora: se pulsan teclas, la pantalla cuenta y el «=» da el resultado.
  accounting: {
    cels: {
      k: { at: [0, 0], rows: ['BB'] },
      d1: { at: [3, 3], rows: ['ssssssssxs'] },
      d2: { at: [3, 3], rows: ['sssssssxxs'] },
      d3: { at: [3, 3], rows: ['ssssxsxxxs'] },
      d4: { at: [3, 3], rows: ['sxxsxxsxxs'] }
    },
    idle: { ms: 150, frames: ['k@4,6 d1', 'd1', ''] },
    hover: {
      ms: 110,
      still: 9,
      frames: ['k@4,6 d1', 'd1', 'k@7,8 d2', 'd2', 'k@10,6 d3', 'd3', 'k@4,10 d3', 'd3', 'k@10,12 d4', '%sS d4', 'd4', '%sS d4', 'd4 tw3@13,-2', 'd4 tw1@14,-1 *3', '']
    },
    celebrate: { ms: 100, frames: ['k@4,6 d1', 'k@7,8 d2', 'k@10,12 d4', ...celebrate(16, 'd4', '%sS d4')] }
  },

  // El maletín: se abre de golpe y sale una moneda.
  business: {
    legend: 'P:paper1 p:paper2 j:gold1',
    cels: {
      open: {
        at: [0, 0],
        rows: [
          '................', '......oooo......', '.....oHHHHo.....', '.ooooHooooHoooo.', 'oLLLLLLLLLLLLLLo', 'oLMMMMMMMMMMMMDo', 'oDDDDDDDDDDDDDDo',
          'ooPPoPpPoPPpPooo', 'oMMMMMMGGMMMMMDo', 'oMMMMMMggMMMMMDo', 'oMMMMMMMMMMMMMDo', 'oMMMMMMMMMMMMMDo', 'oDDDDDDDDDDDDDDo', '.oooooooooooooo.'
        ]
      }
    },
    idle: { ms: 140, frames: ['@0,-1', '', '%Gj', ''] },
    hover: {
      ms: 110,
      still: 4,
      frames: ['@0,-1', '', '@0,-1', '- open', '- open coin@5,3', '- open coin@5,0', '- open coin@5,-3 tw3@11,-2', '- open tw1@12,-1', '- open *2', '', '@0,-1', '']
    },
    celebrate: { ms: 100, frames: ['- open', '- open coin@5,2', '- open coin@5,-2', ...celebrate(16, '- open', '- open')] }
  },

  // El periódico: ¡última hora! Cambian titular y foto.
  journalism: {
    legend: 'Y:gold2 G:green3 b:blue1',
    cels: {
      h1: { at: [3, 3], rows: ['kkPkkkkPkk'] },
      h2: { at: [3, 3], rows: ['kkkkPkkkkk'] },
      ph: { at: [3, 5], rows: ['bYb', 'bbb', 'GGG'] },
      ph2: { at: [3, 5], rows: ['Ybb', 'bbG', 'GGG'] }
    },
    idle: { ms: 150, frames: ['h1', '', 'h2', ''] },
    hover: {
      ms: 110,
      still: 7,
      frames: ['@1,0', '@-1,0', '@1,0', '', 'bang@15,-3', 'h1 bang@15,-3', 'h2 ph', 'h2 ph tw3@-2,-2', 'h1 ph2', 'h2 ph2 tw1@-1,-1', 'h2 ph *3', '']
    },
    celebrate: { ms: 100, frames: ['h1', 'h2 ph', ...celebrate(16, 'h2 ph', 'h1 ph2')] }
  },

  // La balanza: duda a un lado y a otro hasta quedar en equilibrio.
  law: {
    cels: { tl: scales(1), tr: scales(-1) },
    idle: { ms: 220, frames: ['- tl', '', '- tr', ''] },
    hover: {
      ms: 160,
      still: 6,
      frames: ['- tl', '- tl *2', '', '- tr', '- tr *2', '', '- tl', '', '- tr', '', 'tw3@6,-3', 'tw1@7,-2 *2', '']
    },
    celebrate: { ms: 120, frames: ['- tl', '', '- tr', ...celebrate(16, 'tw1@7,-2')] }
  },

  // El megáfono: retrocede y lanza ondas de sonido.
  marketing: {
    cels: {
      clr: { at: [13, 3], rows: Array(9).fill('___') },
      a1: { at: [13, 5], rows: ['o.', '.o', '.o', '.o', 'o.'] },
      a2: { at: [15, 4], rows: ['o.', '.o', '.o', '.o', '.o', '.o', 'o.'] },
      a3: { at: [17, 3], rows: ['o.', '.o', '.o', '.o', '.o', '.o', '.o', '.o', 'o.'] }
    },
    idle: { ms: 150, frames: ['clr a1', 'clr a1 a2', 'clr a2 a3', ''] },
    hover: {
      ms: 100,
      still: 4,
      frames: ['@-1,0 clr', 'clr a1', 'clr a1 a2', 'clr a2 a3 bang@16,-3', 'clr a1 a3', 'clr a1 a2', 'clr a2 a3', 'clr a3 @-1,0', 'clr a1', 'clr a1 a2 tw1@2,1', 'clr a2 a3', 'clr a3', '']
    },
    celebrate: { ms: 100, frames: ['clr a1', 'clr a1 a2', 'clr a2 a3', ...celebrate(16, 'clr a1 a3', 'clr a1 a2')] }
  },

  // La urna: la papeleta entra por la ranura… y sale otra nueva.
  politics: {
    cels: {
      noB: { at: [4, 0], rows: ['_______', '_______', '_______', '_______', '.ooooo.'] },
      bal: { at: [4, 0], rows: ['.ooooo.', 'oPPPPPo', 'oPPPPco', 'oPcPcPo', '.PPcPP.'] },
      front: boxFront()
    },
    idle: { ms: 150, frames: ['noB bal@0,-1', '', 'noB bal@0,-1', ''] },
    hover: {
      ms: 110,
      still: 8,
      frames: [
        'noB bal@0,-2', 'noB bal@0,-3', 'noB bal@0,-1', 'noB bal@0,1 front', 'noB bal@0,3 front', 'noB bal@0,5 front', 'noB @1,0', 'noB @-1,0', 'noB tw3@6,-1 *2',
        'noB star@5,-4 *3', 'noB bal@0,-3', 'noB bal@0,-1', ''
      ]
    },
    celebrate: { ms: 100, frames: ['noB bal@0,1 front', 'noB bal@0,5 front', 'noB', ...celebrate(16, 'noB star@5,-4', 'noB')] }
  }
}
