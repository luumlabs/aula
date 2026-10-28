// Efectos pixel-art compartidos (chispas, corazones, burbujas, humo, notas…) que cualquier personaje puede pegar en sus
// fotogramas por su nombre (`tw3@-2,-1`). Cada uno trae su leyenda, así no choca con las letras del sprite.
// Y unas ayudas para escribir pistas típicas (saltito, celebración) sin repetir fotogramas a mano.
import type { CelSpec } from './anim'

const SP = 'W:white Y:gold1 y:gold2'
export const FX: Record<string, CelSpec> = {
  // destellos
  tw1: { at: [0, 0], legend: SP, rows: ['W'] },
  tw2: { at: [0, 0], legend: SP, rows: ['.Y.', 'YWY', '.Y.'] },
  tw3: { at: [0, 0], legend: SP, rows: ['.y.', 'yWy', '.y.'] },
  tw5: { at: [0, 0], legend: SP, rows: ['..y..', '..Y..', 'yYWYy', '..Y..', '..y..'] },
  twx: { at: [0, 0], legend: SP, rows: ['Y.Y', '.W.', 'Y.Y'] },
  // corazón pequeño (5×4) y diminuto (3×3)
  heart: { at: [0, 0], legend: 'r:red2 h:pink1 d:red3', rows: ['.r.r.', 'rhrrr', '.rrd.', '..d..'] },
  heart3: { at: [0, 0], legend: 'r:pink2 d:pink3', rows: ['r.r', 'rrd', '.d.'] },
  // nota musical
  note: { at: [0, 0], legend: 'k:ink', rows: ['.kk', '.k.', 'kk.', 'kk.'] },
  note2: { at: [0, 0], legend: 'k:teal3', rows: ['.kkk', '.k.k', 'kk.k', 'kkkk', '..kk'] },
  // agua y burbujas
  drop: { at: [0, 0], legend: 'b:blue1 B:blue2', rows: ['b', 'B'] },
  drop3: { at: [0, 0], legend: 'b:blue1 B:blue2 d:blue3', rows: ['.b.', 'bBB', '.d.'] },
  bub: { at: [0, 0], legend: 'w:white', rows: ['.w.', 'w.w', '.w.'] },
  bub1: { at: [0, 0], legend: 'w:white', rows: ['w'] },
  bub2: { at: [0, 0], legend: 'w:white t:teal1', rows: ['wt', 'tt'] },
  // humo y polvo
  puff: { at: [0, 0], legend: 's:stone1 w:white', rows: ['.s.', 'sws', '.s.'] },
  puff5: { at: [0, 0], legend: 's:stone1 w:white S:stone2', rows: ['.ss..', 'swwss', 'swwwS', '.SSS.'] },
  dust: { at: [0, 0], legend: 's:stone1', rows: ['s.s'] },
  // electricidad
  bolt: { at: [0, 0], legend: 'Y:gold1 y:gold2', rows: ['..Y', '.Y.', 'YyY', '.Y.', 'Y..'] },
  boltL: { at: [0, 0], legend: 'Y:gold1 y:gold2', rows: ['Y..', '.Y.', 'YyY', '.Y.', '..Y'] },
  zap: { at: [0, 0], legend: 'W:white Y:gold1', rows: ['Y.W.Y', '.YWY.', 'WW.WW', '.YWY.', 'Y.W.Y'] },
  // sueño, sorpresa y duda
  zz: { at: [0, 0], legend: 'k:stone3', rows: ['kkk', '.k.', 'kkk'] },
  bang: { at: [0, 0], legend: 'R:red2', rows: ['R', 'R', '.', 'R'] },
  ask: { at: [0, 0], legend: 'k:ink', rows: ['kk.', '..k', '.k.', '...', '.k.'] },
  // confeti (un píxel de cada color)
  c1: { at: [0, 0], legend: 'x:red2', rows: ['x'] },
  c2: { at: [0, 0], legend: 'x:gold2', rows: ['x'] },
  c3: { at: [0, 0], legend: 'x:blue2', rows: ['x'] },
  c4: { at: [0, 0], legend: 'x:green2', rows: ['x'] },
  c5: { at: [0, 0], legend: 'x:teal2', rows: ['x'] },
  // estrella y moneda
  star: { at: [0, 0], legend: 'Y:gold1 y:gold2 g:gold3', rows: ['..Y..', '.YyY.', 'YyyyY', '.ygy.', 'Y...Y'] },
  coin: { at: [0, 0], legend: 'Y:gold1 y:gold2 g:gold3 o:ink', rows: ['.ooo.', 'oYyyo', 'oYgyo', 'oyyyo', '.ooo.'] },
  // velocidad (rayitas a los lados)
  whooshL: { at: [0, 0], legend: 's:stone2', rows: ['ss', '..', 'ss'] },
  whooshR: { at: [0, 0], legend: 's:stone2', rows: ['ss', '..', 'ss'] }
}

/** Saltito: sube dos píxeles y aterriza (con lo que se le añada a cada fotograma). */
export function hop(extra = '', height = 2): string[] {
  const up = Array.from({ length: height }, (_, i) => `${extra} @0,-${i + 1}`)
  return [...up, `${extra} @0,-${height} *2`, ...up.slice(0, -1).reverse(), extra]
}

/** Corona de destellos alrededor de un sprite de `size` (cuatro fotogramas que se encienden en orden). */
export function sparkleRing(size: number): string[] {
  const s = size
  return [
    `tw1@-2,-2 tw1@${s + 1},${s - 3}`,
    `tw3@-3,-3 tw1@${s + 1},-1 tw1@-2,${s - 1}`,
    `tw5@-3,-3 tw3@${s - 1},-3 tw3@-3,${s - 4} tw1@${s + 1},${s - 2}`,
    `tw3@-3,-3 tw5@${s - 2},-3 tw1@-2,${s - 3} tw3@${s - 1},${s - 4}`,
    `tw1@-2,-2 tw3@${s - 1},-3 tw1@${s},${s - 3}`,
    `tw1@${s},-2`
  ]
}

/**
 * Celebración típica: salto con destellos, confeti y la pose especial del personaje (`pose`: operaciones de su fotograma
 * cumbre, p. ej. 'smile'), que se queda un momento al final.
 */
export function celebrate(size: number, pose: string, mid = pose): string[] {
  const ring = sparkleRing(size)
  const s = size
  return [
    `${mid} ${ring[0]}`,
    `${mid} @0,-1 ${ring[1]}`,
    `${mid} @0,-2 ${ring[2]} c1@2,-3 c2@${s - 3},-2`,
    `${mid} @0,-2 ${ring[3]} c3@5,-2 c4@${s - 6},-3 c1@1,0`,
    `${pose} @0,-1 ${ring[4]} c2@3,-1 c5@${s - 4},0 c3@-1,3`,
    `${pose} ${ring[5]} c4@4,1 c1@${s - 3},2 c2@-2,6`,
    `${pose} c5@3,4 c3@${s - 2},5 *2`,
    `${pose} *6`,
    ''
  ]
}
