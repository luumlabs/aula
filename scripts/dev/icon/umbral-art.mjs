// El dibujo de Aula: «El umbral» (un arco de un solo trazo, el suelo y el sol que sale por la puerta).
// Tinta plana, trazos sueltos con aire entre ellos y un único gesto de color ladrillo.
import { arc, brush, dab } from './umbral-brush.mjs'

/**
 * Las líneas centrales del umbral en el lienzo de 1024: la bóveda de un solo trazo (apoya abajo a la izquierda, sube,
 * cruza, baja a la derecha y sale con cola hacia fuera), el suelo que se estira a la derecha y el sol.
 */
function geometry({ lift = 0 } = {}) {
  const arch = [
    [328, 796],
    [332, 716],
    [336, 630],
    [340, 552],
    ...arc(523, 496, 184, 178, 2, 20, 174).slice(1, -1),
    [706, 552],
    [708, 632],
    [710, 712],
    [714, 762],
    [725, 791],
    [746, 806]
  ]
  const ground = [
    [252, 851],
    [404, 840],
    [566, 836],
    [728, 842],
    [872, 856]
  ]
  return { arch, ground, sun: { cx: 523, cy: 814 - lift } }
}

/** Un fotograma del umbral: `seed` cambia el carácter de cada trazo (dibujado otra vez a mano). */
export function cel({ seed = 3, lift = 0, open = 0, jitter = 0, rays = 0, weight = 1 } = {}) {
  const g = geometry({ lift })
  const common = { jitter, wobble: 1.4, edge: 0.025, swell: 0.12 }
  const arch = brush(g.arch, {
    ...common,
    w: 38 * weight,
    seed: seed + 1,
    startBlob: 1.22,
    endBlob: 0.9,
    profile: [
      [0, 1.16],
      [0.05, 0.99],
      [0.24, 0.95],
      [0.4, 0.86],
      [0.5, 0.8],
      [0.62, 0.9],
      [0.78, 1.03],
      [0.92, 0.96],
      [1, 0.56]
    ]
  })
  const ground = brush(g.ground, {
    ...common,
    w: 30 * weight,
    seed: seed + 4,
    startBlob: 1.25,
    endBlob: 1.0,
    profile: [
      [0, 1.04],
      [0.08, 0.95],
      [0.42, 1.0],
      [0.8, 0.82],
      [1, 0.46]
    ]
  })
  const sun = dab(g.sun.cx, g.sun.cy, 110 + open, { seed: seed + 5, edge: 0.014, base: 0.035, squash: 0.95 })
  const rayPaths = []
  if (rays > 0) {
    for (const [a, len] of [
      [138, 1],
      [90, 1.15],
      [42, 1]
    ]) {
      const rad = (a * Math.PI) / 180
      const r0 = 110 + 34
      const r1 = r0 + 34 * len * rays
      rayPaths.push(
        brush(
          [
            [g.sun.cx + Math.cos(rad) * r0, g.sun.cy - Math.sin(rad) * r0],
            [g.sun.cx + Math.cos(rad) * r1, g.sun.cy - Math.sin(rad) * r1]
          ],
          { w: 22, seed: seed + 9 + a, wobble: 0.2, edge: 0.03, swell: 0.05, startBlob: 1.1, profile: [[0, 1.05], [1, 0.7]] }
        )
      )
    }
  }
  return { ink: [arch, ground], sun: [sun, ...rayPaths] }
}

/** El dibujo base y sus fotogramas: 4 en reposo (respira) y 6 trabajando (el sol sube y suelta tres rayos). */
export const HERO = cel({ seed: 3 })
export const IDLE = [3, 11, 19, 27].map((seed, i) => cel({ seed, jitter: i === 0 ? 0 : 3, open: [0, 2.5, 1, 3][i] }))
export const WORK = [0, 12, 26, 38, 26, 12].map((lift, i) => cel({ seed: 40 + i * 7, jitter: 2.6, lift, rays: lift > 20 ? (lift - 18) / 20 : 0 }))

/** Caja del dibujo (para centrarlo) y vista recortada de la interfaz. */
export const BOX = { x: 232, y: 290, w: 660, h: 590, cx: 556, cy: 568 }
export const UI_VIEWBOX = '200 236 720 680'

const LOOKS = {
  light: { paper: '#FDFCF9', ink: '#181614', sun: '#B8502D' },
  dark: { paper: null, ink: '#F3F0EA', sun: '#E89266' },
  tinted: { paper: '#000000', ink: '#FFFFFF', sun: '#FFFFFF' }
}

/** El arte de «El umbral» en la caja local de 824 px del generador multiplataforma. */
export function umbralIcon(detail, { look = 'light', sun = true } = {}) {
  const c = LOOKS[look]
  const k = ((700 / Math.max(BOX.w, BOX.h)) * 824) / 1024
  const frame = detail === 'small' ? cel({ seed: 3, weight: 1.45 }) : HERO
  const path = (d, color) => `<path d="${d}" fill="${color}"/>`
  return `${c.paper ? `<rect width="824" height="824" fill="${c.paper}"/>` : ''}<g transform="translate(412 412) scale(${k}) translate(${-BOX.cx} ${-BOX.cy})">${frame.ink.map((d) => path(d, c.ink)).join('')}${sun ? frame.sun.map((d) => path(d, c.sun)).join('') : ''}</g>`
}
