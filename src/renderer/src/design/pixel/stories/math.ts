// Historias pixel-art de los iconos de matemáticas (ábaco, pizarra, integral, compás, triángulo, gráfico de barras).
import type { AnimSpec, CelSpec } from '../anim'
import { celebrate } from '../fx'

// Ábaco: cuentas de 2×3 que se deslizan por su varilla (y su hueco vacío, con la varilla).
const bead = (c: string, d: string, e: string): CelSpec => ({ at: [0, 0], rows: [c, d, e] })
const ABACUS_DONE = 'rE@7,4 rB@11,4 gE@3,7 gB@7,7 tE@11,10 tB@7,10'

/** Gráfico de barras dibujado con las alturas dadas (fila del borde superior de cada barra), con el estilo del sprite. */
function chart(tops: number[]): CelSpec {
  const g = Array.from({ length: 19 }, () => Array<string>(16).fill('_'))
  const put = (x: number, y: number, c: string) => {
    if (y >= -3 && y < 16) g[y + 3][x] = c
  }
  tops.forEach((t, i) => {
    const x = i * 3
    const accent = i === 2
    for (let y = t; y <= 13; y++) {
      put(x, y, 'o')
      put(x + 3, y, 'o')
      if (y === t) {
        put(x + 1, y, 'o')
        put(x + 2, y, 'o')
      } else if (y === t + 1) {
        put(x + 1, y, accent ? 'a' : 'H')
        put(x + 2, y, accent ? 'a' : 'H')
      } else {
        put(x + 1, y, accent ? 'A' : 'L')
        put(x + 2, y, accent ? 'B' : 'M')
      }
    }
  })
  for (let x = 0; x < 16; x++) put(x, 14, 'o')
  return { at: [0, -3], rows: g.map((r) => r.join('')) }
}
const CHARTS: Record<string, number[]> = {
  ch0: [9, 6, 2, 6, 9],
  ch1: [8, 7, 4, 5, 10],
  ch2: [10, 5, 6, 3, 8],
  ch3: [7, 8, 3, 6, 6],
  ch4: [9, 6, 0, 7, 8],
  ch5: [10, 7, -2, 8, 10]
}

export const MATH: Record<string, AnimSpec> = {
  // El ábaco: las cuentas cuentan, una a una, y se recolocan.
  math: {
    cels: {
      rB: bead('hR', 'RR', 'rr'),
      rE: bead('__', '--', '__'),
      gB: bead('jG', 'GG', 'gg'),
      gE: bead('__', '--', '__'),
      tB: bead('kT', 'TT', 'tt'),
      tE: bead('__', '--', '__')
    },
    idle: { ms: 140, frames: ['rE@7,4 rB@8,4', 'rE@7,4 rB@9,4', 'rE@7,4 rB@8,4', ''] },
    hover: {
      ms: 110,
      still: 7,
      frames: [
        'rE@7,4 rB@9,4', 'rE@7,4 rB@11,4', 'rE@7,4 rB@11,4 gE@3,7 gB@5,7', 'rE@7,4 rB@11,4 gE@3,7 gB@7,7',
        'rE@7,4 rB@11,4 gE@3,7 gB@7,7 tE@11,10 tB@9,10', `${ABACUS_DONE}`, `${ABACUS_DONE} tw3@13,-2`, `${ABACUS_DONE} tw1@14,-1 *4`,
        'rE@7,4 rB@9,4 gE@3,7 gB@5,7 tE@11,10 tB@9,10', '', '@0,-1', ''
      ]
    },
    celebrate: { ms: 100, frames: ['rE@7,4 rB@11,4', `rE@7,4 rB@11,4 gE@3,7 gB@7,7`, ABACUS_DONE, ...celebrate(16, ABACUS_DONE)] }
  },

  // La pizarra: el borrador limpia y la tiza escribe «x=1».
  algebra: {
    legend: 'S:stone2 Y:gold1',
    cels: {
      w3: { at: [3, 5], rows: Array(7).fill('bbb') },
      w6: { at: [3, 5], rows: Array(7).fill('bbbbbb') },
      w10: { at: [3, 5], rows: Array(7).fill('bbbbbbbbbb') },
      er: { at: [0, 6], rows: ['LL', 'MM', 'SS'] },
      eqA: { at: [3, 5], rows: ['bbbbbbbbbb', 'bWbWbbbbbb', 'bbWbbbbbbb', 'bWbWbbbbbb', 'bbbbbbbbbb', 'bbbbbbbbbb', 'bbbbbbbbbb'] },
      eqB: { at: [3, 5], rows: ['bbbbbbbbbb', 'bWbWbbbbbb', 'bbWbbWWbbb', 'bWbWbbbbbb', 'bbbbbWWbbb', 'bbbbbbbbbb', 'bbbbbbbbbb'] },
      eq: { at: [3, 5], rows: ['bbbbbbbbbb', 'bWbWbbbbWb', 'bbWbbWWWWb', 'bWbWbbbbWb', 'bbbbbWWbWb', 'bbbbbbbWWW', 'bbbbbbbbbb'] },
      chalk: { at: [0, 0], rows: ['W', 'S'] }
    },
    idle: { ms: 150, frames: ['chalk@13,9', 'chalk@13,8', 'chalk@13,9', ''] },
    hover: {
      ms: 110,
      still: 10,
      frames: [
        'er@4,0', 'w3 er@6,0', 'w6 er@8,0', 'w10 er@11,0', 'w10 er@13,0 dust@11,13', 'w10 *2',
        'eqA chalk@6,4', 'eqB chalk@9,6', 'eq chalk@12,5', 'eq', 'eq tw3@12,-1', 'eq tw1@13,0 *5', 'eq', ''
      ]
    },
    celebrate: { ms: 100, frames: ['w10', 'eqA', 'eqB', ...celebrate(16, 'eq')] }
  },

  // La integral: una chispa recorre el trazo y aparece «dx».
  calculus: {
    legend: 'W:white',
    cels: {
      dx: { at: [9, 10], rows: ['..o....', '.oo.o.o', 'o.o..o.', '.oo.o.o'] },
      w: { at: [0, 0], rows: ['W'] }
    },
    idle: { ms: 120, frames: ['w@10,2', 'w@8,6', 'w@4,12', ''] },
    hover: {
      ms: 90,
      still: 9,
      frames: [
        'w@11,1 tw1@12,-1', 'w@10,2', 'w@9,4', 'w@8,6', 'w@8,8', 'w@7,10', 'w@6,11', 'w@4,12', 'w@3,13 tw3@1,12',
        'dx tw1@15,9 *2', 'dx @0,-1', 'dx', 'dx tw3@14,8 *4', 'dx *3', ''
      ]
    },
    celebrate: { ms: 100, frames: ['w@10,2', 'w@8,6', 'w@4,12', ...celebrate(16, 'dx')] }
  },

  // El compás: se balancea y dibuja un arco.
  geometry: {
    legend: 'z:blue3',
    cels: {
      a1: { at: [2, 14], rows: ['...........z', '...........z', '.........zz.'] },
      a2: { at: [2, 14], rows: ['...........z', '...........z', '.........zz.', '......zzz...'] },
      a3: { at: [2, 14], rows: ['...........z', 'z..........z', '.zz......zz.', '...zzzzzz...'] }
    },
    idle: { ms: 150, frames: ['@1,0', '', '@-1,0', ''] },
    hover: {
      ms: 120,
      still: 6,
      frames: ['@1,0', '', '@1,0 a1', 'a1', '@-1,0 a2', 'a2', 'a3 *2', 'a3 tw3@14,10', 'a3 tw1@15,11 *3', '@-1,0 a3', 'a3', '']
    },
    celebrate: { ms: 100, frames: ['a1', 'a2', 'a3', ...celebrate(16, 'a3')] }
  },

  // El triángulo: una bolita sube por la hipotenusa… y baja rodando.
  trigonometry: {
    legend: 'R:red1 r:red2 d:red3',
    cels: { ball: { at: [0, 0], rows: ['Rr', 'rd'] } },
    idle: { ms: 150, frames: ['%YW', '', '%YW', ''] },
    hover: {
      ms: 120,
      still: 7,
      frames: [
        'ball@0,12', 'ball@2,10', 'ball@3,9 *2', 'ball@5,7', 'ball@6,6 *2', 'ball@8,4', 'ball@9,3 *2', 'ball@11,1', 'ball@12,0 tw3@13,-3 *3',
        'ball@10,2', 'ball@7,5', 'ball@4,8', 'ball@1,11', 'ball@-2,12 dust@-2,14', 'ball@-3,12', '%YW', ''
      ]
    },
    celebrate: { ms: 100, frames: ['ball@2,10', 'ball@6,6', 'ball@10,2', ...celebrate(16, 'ball@12,0', 'ball@12,0')] }
  },

  // Las barras: suben y bajan como datos en vivo, y la del centro se lleva la estrella.
  statistics: {
    cels: Object.fromEntries(Object.entries(CHARTS).map(([k, v]) => [k, chart(v)])),
    idle: { ms: 150, frames: ['- ch1', '- ch3', ''] },
    hover: {
      ms: 120,
      still: 7,
      frames: ['- ch1', '- ch2', '- ch3', '- ch1', '- ch2', '- ch4', '- ch5 tw3@6,-3', '- ch5 star@5,-4 *4', '- ch4', '- ch3', '']
    },
    celebrate: { ms: 100, frames: ['- ch1', '- ch2', '- ch4', ...celebrate(16, '- ch5 tw1@7,-3', '- ch4')] }
  }
}
