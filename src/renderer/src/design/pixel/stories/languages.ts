// Historias pixel-art de los iconos de idiomas: el bocadillo escribe («…»), habla, da un saltito y ondea su bandera.
import type { AnimSpec, CelSpec } from '../anim'
import { celebrate } from '../fx'

const FLAG_LEGEND = 'R:red2 Y:gold2 B:blue3 W:white G:green3 k:ink'

/** Banderita con mástil (el mástil a la izquierda, 5 de alto) y su variante ondeando (la punta suelta un píxel abajo). */
function flag(rows: string[]): { a: CelSpec; b: CelSpec } {
  const w = rows[0].length
  const a = [...rows.map((r) => 'k' + r), 'k' + '.'.repeat(w), 'k' + '.'.repeat(w)]
  const half = Math.ceil(w / 2)
  const b = Array.from({ length: 5 }, (_, y) =>
    'k' + Array.from({ length: w }, (_, x) => (x >= half ? (y >= 1 && y <= 3 ? rows[y - 1][x] : '.') : y <= 2 ? rows[y][x] : '.')).join('')
  )
  return { a: { at: [13, -3], legend: FLAG_LEGEND, rows: a }, b: { at: [13, -3], legend: FLAG_LEGEND, rows: b } }
}

// El bocadillo: limpiar el texto y los tres puntos de «escribiendo…».
const BUBBLE_CELS: Record<string, CelSpec> = {
  blank: { at: [4, 3], rows: Array(7).fill('AAAAAAAAA') },
  dt: { at: [0, 0], rows: ['WW', 'WW'] }
}
const TYPING = ['blank dt@5,6', 'blank dt@5,5 dt@8,6', 'blank dt@5,6 dt@8,5 dt@11,6', 'blank dt@5,6 dt@8,6 dt@11,5', 'blank dt@5,6 dt@8,6 dt@11,6']

function bubble(flagRows: string[] | null, extra: Record<string, CelSpec> = {}, finale = 'tw3@13,-3'): AnimSpec {
  const f = flagRows ? flag(flagRows) : null
  const cels: Record<string, CelSpec> = { ...BUBBLE_CELS, ...extra }
  if (f) {
    cels.flagA = f.a
    cels.flagB = f.b
  }
  const wave = f ? ['flagA', 'flagB', 'flagA', 'flagB', 'flagA', 'flagB'] : [finale, `${finale} *2`, 'tw1@14,-2']
  return {
    cels,
    idle: { ms: 160, frames: [...TYPING.slice(0, 4), ''] },
    hover: { ms: 120, still: 7, frames: [...TYPING, ...TYPING.slice(1), '@0,-1', '', '@0,-1 tw1@1,0', '', ...wave, ''] },
    celebrate: { ms: 100, frames: [...TYPING.slice(0, 3), ...celebrate(16, f ? 'flagA' : finale, f ? 'flagB' : finale)] }
  }
}

// Inglés, español, francés, alemán, italiano, portugués y chino: bocadillo + su bandera (simplificada a 5×3).
export const LANGUAGES: Record<string, AnimSpec> = {
  english: bubble(['BBRBB', 'RRRRR', 'BBRBB']),
  spanish: bubble(['RRRRR', 'YYYYY', 'RRRRR']),
  french: bubble(['BBWRR', 'BBWRR', 'BBWRR']),
  german: bubble(['kkkkk', 'RRRRR', 'YYYYY']),
  italian: bubble(['GGWRR', 'GGWRR', 'GGWRR']),
  portuguese: bubble(['GGRRR', 'GYRRR', 'GGRRR']),
  chinese: bubble(['RYRRR', 'YRRRR', 'RRRRR']),
  // El examen de idiomas: escribe… y le ponen una estrella dorada.
  'language-exam': bubble(null, {}, 'star@12,-4'),

  // Los dos bocadillos: uno pregunta, el otro traduce.
  languages: {
    cels: {
      blankL: { at: [3, 2], rows: ['AAAAA', 'AAAAA', 'AAAAA', 'AAAAA', 'AAAA'] },
      blankR: { at: [8, 7], rows: ['PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'pPPPPPp'] },
      w: { at: [0, 0], rows: ['W'] },
      k: { at: [0, 0], rows: ['k'] }
    },
    idle: { ms: 160, frames: ['blankL w@3,4', 'blankL w@3,4 w@5,4', 'blankL w@3,4 w@5,4 w@7,4', ''] },
    hover: {
      ms: 120,
      still: 11,
      frames: [
        'blankL w@3,4', 'blankL w@3,4 w@5,4', 'blankL w@3,4 w@5,4 w@7,4', 'blankL w@3,3 w@5,4 w@7,4', 'blankL w@3,4 w@5,3 w@7,4', '@0,-1', '',
        'blankR k@9,9', 'blankR k@9,9 k@11,9', 'blankR k@9,9 k@11,9 k@13,9', 'blankR k@9,9 k@11,8 k@13,9', '%kA tw3@13,4', '%kA tw1@14,5 *2', '', 'tw1@1,-1', ''
      ]
    },
    celebrate: { ms: 100, frames: ['blankL w@3,4 w@5,4', 'blankR k@9,9 k@11,9', ...celebrate(16, '%kA', '%kA')] }
  },

  // La hoja de gramática: el boli rojo rodea una palabra y pone un ✓.
  grammar: {
    legend: 'r:red3 w:wood1',
    cels: {
      ring: { at: [9, 3], rows: ['.RRRR.', 'R....R', 'R....R', 'R....R', 'R....R', '.RRRR.'] },
      ring1: { at: [9, 3], rows: ['.RRRR.', 'R.....', 'R.....'] },
      ring2: { at: [9, 3], rows: ['.RRRR.', 'R....R', 'R....R', 'R....R', 'R.....', '.R....'] },
      check: { at: [11, 10], rows: ['...R', '..R.', 'R.R.', '.R..'] },
      pen: { at: [0, 0], rows: ['..w', '.Rr', 'Rr.', 'k..'] }
    },
    idle: { ms: 150, frames: ['pen@14,1', 'pen@14,0', 'pen@14,1', ''] },
    hover: {
      ms: 110,
      still: 8,
      frames: [
        'pen@15,-1', 'ring1 pen@11,0', 'ring2 pen@14,3', 'ring pen@11,6', 'ring pen@13,8', 'ring check pen@14,7', 'ring check pen@15,5', 'ring check tw3@13,-2',
        'ring check tw1@14,-1 *4', 'check', ''
      ]
    },
    celebrate: { ms: 100, frames: ['ring1', 'ring2', 'ring', ...celebrate(16, 'ring check', 'ring check')] }
  }
}
