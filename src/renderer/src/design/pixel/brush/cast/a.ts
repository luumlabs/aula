// Muñecos dibujados a mano (primera tanda): luna, gato, reloj, pulpo, medusa, planeta, cometa, cristal, luciérnaga,
// semilla, taza y bombilla. Diseños originales a pincel que conservan lo que hace reconocible a cada uno en pixel art.
import type { Rig, RigState } from '../rigs'
import { arc, ellipse, rot, roundRect, tube, wave } from './geo'

type P = [number, number]

/** La luna dormilona con su gorro de dormir: duerme (ojos cerrados), se despierta (`awake`), bosteza (`yawn`). */
const luna: Rig = {
  id: 'luna',
  light: true,
  draw(k, s) {
    const face = ellipse(12, 14, 8.1, 7.9, 0, 22)
    k.fill('#f8e7b0', face)
    // sombra suave de la luna (cuarto creciente a la derecha)
    k.fill('#e3c67c', [...arc(12, 14, 8.1, 7.9, -1.2, 1.25, 10), ...arc(13.6, 14.2, 6.2, 7.4, 1.15, -1.1, 10)], { alpha: 0.85 })
    k.oval(9.2, 18.6, 1.1, 0.8, '#e3c67c', { alpha: 0.7 })
    k.edge(face)
    k.layer()
    // el gorro: cae hacia la derecha y acaba en una borla
    const cap: P[] = [[3.6, 9.4], [4.4, 5.6], [7.4, 2.8], [12, 1.8], [16.4, 2.6], [19.6, 4.6], [21.4, 7.2], [20.4, 8.4], [17.6, 7.6], [13, 8.2], [8, 9.2]]
    k.fill('#6590bc', cap)
    k.fill('#3e6892', [[14.5, 2.4], [19.6, 4.6], [21.4, 7.2], [20.4, 8.4], [17.6, 7.6], [16.2, 5]], { alpha: 0.9 })
    k.fill('#aac8e7', [[6.5, 4.4], [9.6, 2.7], [11, 3.6], [8, 5.6]], { alpha: 0.9 })
    k.edge(cap)
    // la banda del gorro
    const brim: P[] = [[3.4, 9.6], [8, 8.6], [13, 7.8], [17.8, 7.4], [18.2, 9.2], [13, 9.8], [8, 10.6], [3.8, 11.2]]
    k.body('#fffaf0', brim, { w: 0.8 })
    k.oval(21.3, 9.1, 1.7, 1.7, '#fffaf0').ovalLine(21.3, 9.1, 1.7, 1.7, { w: 0.8, edge: true })
    // la «z» del sueño
    const z = s.pose ? [2.6, 1.8] : [1.2, 4.6]
    k.line([[z[0], z[1]], [z[0] + 2, z[1] - 0.1], [z[0] + 0.1, z[1] + 2.2], [z[0] + 2.2, z[1] + 2.1]], { color: '#aac8e7', w: 0.9 })
    k.layer()
    // la cara: dormida salvo que la despierten
    const awake = s.cels.has('awake') || s.eyes === 'happy' || s.eyes === 'wink'
    const st: RigState = { ...s, eyes: s.eyes === 'happy' ? 'happy' : awake ? 'open' : 'closed' }
    k.face(st, { l: [8.6, 15], r: [15.6, 15], size: 1, sleepy: true, cheeks: [[6.8, 17.4], [17.4, 17.4]], mouth: [12.1, 18.2], w: 2.2, kind: s.cels.has('yawn') ? 'yawn' : 'smile', happyKind: 'grin' })
  }
}

/** El gato: la cola que se levanta (pose), bosteza y ronronea corazones. */
const gato: Rig = {
  id: 'gato',
  draw(k, s) {
    // la cola, detrás
    const tail: P[] = s.pose ? [[17, 18.5], [20.5, 17.6], [22, 14.2], [21.2, 11.4]] : [[17, 19.5], [20.6, 19.4], [22.2, 17.4], [22.4, 15.2]]
    const tl = tube(tail, 2.6, 1.9)
    k.body('#a4bad1', tl)
    k.fill('#728eac', tube(tail.slice(-2), 2.2, 1.8), { alpha: 0.9 })
    k.layer()
    // el cuerpo sentado y la cabeza
    const bodyPts = ellipse(12, 17.6, 6.4, 5, 0, 18)
    k.body('#a4bad1', bodyPts)
    k.fill('#f5e6c8', ellipse(12, 18.4, 3.2, 3.7, 0, 14))
    // patitas
    k.oval(9.4, 22, 1.7, 1, '#e6e9f7').ovalLine(9.4, 22, 1.7, 1, { w: 0.7 }).oval(14.6, 22, 1.7, 1, '#e6e9f7').ovalLine(14.6, 22, 1.7, 1, { w: 0.7 })
    k.layer()
    const head: P[] = [[4.2, 9], [5, 1.6], [9.4, 4.6], [14.6, 4.6], [19, 1.6], [19.8, 9], [19.2, 12.6], [16, 15], [8, 15], [4.8, 12.6]]
    k.fill('#a4bad1', head)
    k.fill('#e6e9f7', [[5, 4], [5.4, 8.5], [5.6, 12], [7.4, 14], [6, 9]], { alpha: 0.9 })
    k.fill('#728eac', [[18.8, 5], [19.6, 9.4], [19, 12.6], [16.6, 14.6], [18.2, 10]], { alpha: 0.8 })
    k.edge(head)
    // orejas por dentro
    k.fill('#f79bb8', [[6, 3.6], [8.4, 5.2], [6.4, 6.6]], { exact: true }).fill('#f79bb8', [[18, 3.6], [15.6, 5.2], [17.6, 6.6]], { exact: true })
    // la cara: ojos grandes, naricita rosa y boca de gato (abierta si bosteza)
    k.eyes(s, [9, 10.4], [15, 10.4], 1.15)
    k.cheeks([7.2, 12.6], [16.8, 12.6], 0.9)
    k.oval(12, 12, 0.7, 0.5, '#f79bb8', { exact: true, n: 8 })
    if (s.cels.has('yawn')) k.mouth('yawn', 12, 12.6, 2.4)
    else k.mouth('cat', 12, 12.9, 2.2)
    // bigotes
    k.line([[3.2, 11.6], [6, 12]], { w: 0.45, color: '#26374a' }).line([[3.4, 13.4], [6.1, 12.9]], { w: 0.45, color: '#26374a' })
    k.line([[20.8, 11.6], [18, 12]], { w: 0.45, color: '#26374a' }).line([[20.6, 13.4], [17.9, 12.9]], { w: 0.45, color: '#26374a' })
  }
}

/** El despertador: campanas, martillo, manecillas y patas; con la pose, las campanas tiemblan y las agujas saltan. */
const reloj: Rig = {
  id: 'reloj',
  draw(k, s) {
    const shake = s.pose ? 0.28 : 0
    // patas
    k.body('#7c2338', tube([[8.6, 19.2], [7, 22.6]], 1.6, 1.3), { w: 0.8 }).body('#7c2338', tube([[15.4, 19.2], [17, 22.6]], 1.6, 1.3), { w: 0.8 })
    // martillo entre las campanas
    k.line([[12, 5.6], [12, 2.6]], { w: 0.9 }).oval(12, 2.2, 1.1, 0.9, '#c03b4a').ovalLine(12, 2.2, 1.1, 0.9, { w: 0.7 })
    // las campanas
    const bell = (cx: number, a: number) => {
      const dome: P[] = [...arc(cx, 5.4, 3.2, 3.2, Math.PI, Math.PI * 2, 10), [cx + 3.4, 5.8], [cx - 3.4, 5.8]]
      const d = rot(dome, cx, 5.8, a)
      k.fill('#f6c060', d)
      k.fill('#ffe3a3', rot(ellipse(cx - 1.2, 3.8, 0.9, 0.6, -0.5, 8), cx, 5.8, a), { alpha: 0.9 })
      k.edge(d)
      k.line(rot([[cx, 2.2], [cx, 1.2]], cx, 5.8, a), { w: 0.8 })
    }
    bell(5.6, -0.35 - shake)
    bell(18.4, 0.35 + shake)
    k.layer()
    // el cuerpo y la esfera
    const body = ellipse(12, 13.2, 8.6, 8.4, 0, 24)
    k.fill('#ea5b5b', body)
    k.fill('#c03b4a', [...arc(12, 13.2, 8.6, 8.4, -0.9, 1.6, 10), ...arc(13.4, 13, 7, 7.6, 1.5, -0.8, 10)], { alpha: 0.9 })
    k.edge(body)
    k.layer()
    const dial = ellipse(12, 13.2, 6.4, 6.2, 0, 20)
    k.fill('#fffaf0', dial).line(dial, { closed: true, w: 0.7 })
    // marcas de las horas
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) k.line([[12 + Math.cos(a) * 5.4, 13.2 + Math.sin(a) * 5.3], [12 + Math.cos(a) * 4.6, 13.2 + Math.sin(a) * 4.5]], { w: 0.55, color: '#c03b4a' })
    // las manecillas (arriba, entre los ojos)
    const hA = s.pose ? -2.2 : -1.57
    const mA = s.pose ? -0.6 : -2.45
    k.line([[12, 12.6], [12 + Math.cos(hA) * 3.2, 12.6 + Math.sin(hA) * 3.2]], { w: 0.85 })
    k.line([[12, 12.6], [12 + Math.cos(mA) * 4.2, 12.6 + Math.sin(mA) * 4.2]], { w: 0.65 })
    k.oval(12, 12.6, 0.55, 0.55, 'ink', { exact: true, n: 8 })
    k.face(s, { l: [8.7, 13.2], r: [15.3, 13.2], size: 0.9, cheeks: [[7.4, 15.4], [16.6, 15.4]], mouth: [12, 15.8], w: 1.8, happyKind: 'grin' })
  }
}

/** El pulpo: cabeza redonda con lunares y cinco tentáculos que se enroscan (con la pose, al otro lado). */
const pulpo: Rig = {
  id: 'pulpo',
  draw(k, s) {
    const c = s.pose ? -1 : 1
    const legs: P[][] = [
      [[6.4, 15], [4.6, 18.4], [3.4, 20.8], [4.8 + c * 0.4, 22.2]],
      [[9, 16], [8.4, 19.4], [8, 22], [9.6 + c * 0.6, 22.6]],
      [[12, 16.2], [12.2, 19.6], [11.8 + c, 22.6]],
      [[15, 16], [15.6, 19.4], [16, 22], [14.4 - c * 0.6, 22.6]],
      [[17.6, 15], [19.4, 18.4], [20.6, 20.8], [19.2 - c * 0.4, 22.2]]
    ]
    for (const l of legs) {
      const t = tube(l, 3.1, 1.6)
      k.body('#f08ccf', t, { w: 0.85 })
    }
    // ventosas
    for (const [x, y] of [[4.6, 19.2], [8.4, 20.4], [15.6, 20.4], [19.4, 19.2]] as P[]) k.oval(x, y, 0.45, 0.45, '#fdcce0', { exact: true, n: 8 })
    k.layer()
    const head: P[] = [...arc(12, 9.4, 7.6, 7.4, Math.PI, Math.PI * 2, 14), [19.6, 12], [18.6, 15.4], [15, 17], [9, 17], [5.4, 15.4], [4.4, 12]]
    k.fill('#f08ccf', head)
    k.fill('#c95ba8', [[16.6, 3.6], [19.4, 7.6], [19.6, 12], [18.6, 15.4], [16, 16.6], [17.8, 11]], { alpha: 0.75 })
    k.fill('#fdcce0', ellipse(8.4, 5.4, 1.8, 1.1, -0.6, 10), { alpha: 0.9 })
    k.oval(16, 6.4, 0.9, 0.9, '#fdcce0', { alpha: 0.9, n: 10 }).oval(6.4, 9.4, 0.7, 0.7, '#fdcce0', { alpha: 0.9, n: 8 })
    k.edge(head)
    k.face(s, { l: [9, 10.6], r: [15, 10.6], size: 1.1, cheeks: [[7, 13.2], [17, 13.2]], mouth: [12, 13.6], w: 1.4, kind: 'o', happyKind: 'grin' })
  },
  props: {
    // la nube de tinta que suelta
    pk: (k, x, y) => {
      k.oval(x + 1.4, y + 1.4, 1.6, 1.2, '#4a4044', { alpha: 0.9 }).oval(x + 2.6, y + 1, 1.1, 0.9, '#4a4044', { alpha: 0.9 }).oval(x + 1.2, y + 1.1, 0.5, 0.4, '#857a7d', { exact: true, n: 8 })
    }
  }
}

/** La medusa: campana translúcida con lunares y tentáculos ondulados (la pose cambia la onda). */
const medusa: Rig = {
  id: 'medusa',
  light: true,
  draw(k, s) {
    const ph = s.pose ? Math.PI : 0
    const xs = [6, 9, 12, 15, 18]
    xs.forEach((x, i) => k.line(wave(x, 12.4, x + (i - 2) * 0.6, 22.6, 0.9, 1.25, ph + i * 0.9), { color: i % 2 ? '#de86b5' : '#e187af', w: 0.95 }))
    k.layer()
    const bell: P[] = [...arc(12, 10, 8.6, 7.6, Math.PI, Math.PI * 2, 16), [20.6, 11.4], [18.4, 12.6], [16.2, 11.8], [14, 12.8], [12, 11.8], [10, 12.8], [7.8, 11.8], [5.6, 12.6], [3.4, 11.4]]
    k.fill('#f7b6d6', bell)
    k.fill('#de86b5', [[17.8, 4.4], [20.4, 8], [20.6, 11.4], [18.4, 12.6], [18.6, 9]], { alpha: 0.7 })
    k.fill('#ffe6f2', ellipse(8.6, 5.4, 2.4, 1.2, -0.5, 12), { alpha: 0.95 })
    k.oval(15.6, 4.6, 0.8, 0.7, '#ffe6f2', { n: 8 }).oval(17.2, 7.6, 0.6, 0.6, '#ffe6f2', { n: 8 })
    k.edge(bell)
    k.face(s, { l: [9.6, 8.4], r: [14.4, 8.4], size: 0.95, cheeks: [[7.8, 10.2], [16.2, 10.2]], mouth: [12, 10.4], w: 1.5, happyKind: 'grin' })
  }
}

/** El planeta con su anillo inclinado (detrás y delante) y su lunita; el anillo gira (`%6X…`). */
const planeta: Rig = {
  id: 'planeta',
  draw(k, s) {
    const tilt = -0.14
    const cx = 12
    const cy = 12.2
    const ringBand = (a0: number, a1: number): P[] => rot([...arc(cx, cy, 11.4, 3.4, a0, a1, 14), ...arc(cx, cy, 8.4, 2, a1, a0, 14)], cx, cy, tilt)
    const turned = [...s.recolor].some((r) => r.startsWith('%6'))
    // la mitad de atrás del anillo
    k.fill(turned ? '#d9a64a' : '#f6d27a', ringBand(Math.PI, Math.PI * 2))
    k.line(rot(arc(cx, cy, 11.4, 3.4, Math.PI, Math.PI * 2, 14), cx, cy, tilt), { w: 0.8 })
    k.layer()
    // la bola
    const ball = ellipse(12, 10.6, 7, 6.8, 0, 22)
    k.fill('#f2a96b', ball)
    k.fill('#d27b47', [...arc(12, 10.6, 7, 6.8, -1, 1.4, 10), ...arc(13.4, 10.4, 5.6, 6.2, 1.3, -0.9, 10)], { alpha: 0.85 })
    k.fill('#ffd9b0', ellipse(9.2, 6.4, 2.4, 1.2, -0.5, 10), { alpha: 0.9 })
    k.line(wave(6, 8.8, 9, 8.6, 0.25, 1, 0, 6), { color: '#d27b47', w: 0.55, alpha: 0.8 })
    k.edge(ball)
    k.face(s, { l: [9.8, 9.8], r: [14.2, 9.8], size: 0.85, cheeks: [[8.2, 11.4], [15.8, 11.4]], mouth: [12, 11.6], w: 1.4, happyKind: 'grin' })
    k.layer()
    // la mitad de delante del anillo (tapa la parte de abajo de la bola)
    k.fill(turned ? '#f6d27a' : '#d9a64a', ringBand(0, Math.PI))
    k.fill(turned ? '#d9a64a' : '#f6d27a', rot([...arc(cx, cy, 11, 3.1, 0.25, 2.9, 12), ...arc(cx, cy, 9.6, 2.5, 2.9, 0.25, 12)], cx, cy, tilt), { alpha: 0.9 })
    k.line(rot(arc(cx, cy, 11.4, 3.4, 0, Math.PI, 14), cx, cy, tilt), { w: 0.85, edge: true }).line(rot(arc(cx, cy, 8.4, 2, 0.15, Math.PI - 0.15, 12), cx, cy, tilt), { w: 0.6 })
    // la lunita que da vueltas
    const m: P = s.pose ? [21.4, 4.4] : [20.4, 2.4]
    k.oval(m[0], m[1], 1.1, 1.1, '#eef0f6').ovalLine(m[0], m[1], 1.1, 1.1, { w: 0.6 })
  }
}

/** El cometa: cabeza dorada con cara y una cola de fuego que se estrecha, con chispas (la pose las cambia de sitio). */
const cometa: Rig = {
  id: 'cometa',
  draw(k, s) {
    // la cola de fuego, de la cabeza hacia abajo a la izquierda, en tres llamas
    const tailOut: P[] = [[11.2, 6.6], [9.4, 9.6], [6.8, 12.8], [4.6, 16], [2.4, 19.6], [1.6, 22.4], [4.4, 21.4], [7.4, 19], [10.6, 16.2], [13.8, 14.2], [16.6, 12.6]]
    k.fill('#f9bd5c', tailOut)
    k.fill('#f0925f', [[9.8, 10.6], [7.4, 13.6], [5, 17], [3.2, 20.6], [6.2, 19], [9.2, 16.4], [12.4, 14]])
    k.fill('#dd6f73', [[6.6, 15.8], [4.4, 18.6], [3, 21.2], [5.6, 19.8], [8, 17.6]])
    k.line([[11.2, 6.6], [9.4, 9.6], [6.8, 12.8], [4.6, 16], [2.4, 19.6], [1.6, 22.4]], { w: 0.85, edge: true }).line([[1.6, 22.4], [4.4, 21.4], [7.4, 19], [10.6, 16.2], [13.8, 14.2], [16.6, 12.6]], { w: 0.85, edge: true })
    // chispas en la estela
    const sp: P[] = s.pose ? [[2.6, 13.4], [7.6, 21.6], [0.8, 17.6]] : [[3.8, 11.8], [9, 20.8], [1.2, 15.4]]
    k.sparkle(sp[0][0], sp[0][1], 1.2, '#fff2a8').sparkle(sp[1][0], sp[1][1], 1, '#fff2a8').sparkle(sp[2][0], sp[2][1], 0.8, '#ffd45e')
    k.layer()
    // la cabeza
    const head = ellipse(15.6, 8.6, 6, 5.8, 0, 20)
    k.fill('#ffe16b', head)
    k.fill('#f2bb3c', [...arc(15.6, 8.6, 6, 5.8, -0.6, 1.9, 10), ...arc(16.8, 8.2, 4.6, 5.2, 1.8, -0.5, 10)], { alpha: 0.85 })
    k.fill('#fff9bc', ellipse(13.2, 5, 1.8, 1, -0.5, 10), { alpha: 0.95 })
    k.edge(head)
    k.face(s, { l: [14, 8.2], r: [18.2, 8.2], size: 0.85, cheeks: [[12.6, 10.2], [19.6, 10.2]], mouth: [16.1, 10.4], w: 1.6, happyKind: 'grin' })
  }
}

/** El cristal: una punta de cuarzo de ámbar con sus caras de luz y de sombra, dos puntas pequeñas y su roca; brilla por dentro (`%26…`) y destella. */
const cristal: Rig = {
  id: 'cristal',
  draw(k, s) {
    const glow = s.recolor.size > 0
    // la roca
    const rock: P[] = [[2.4, 22.4], [3.6, 19.6], [7, 18.4], [12, 18.2], [17, 18.4], [20.4, 19.6], [21.6, 22.4]]
    k.fill('#b09b82', rock).fill('#846e54', [[2.4, 22.4], [3.8, 21], [12, 20.6], [20.2, 21], [21.6, 22.4]], { alpha: 0.9 }).edge(rock)
    k.layer()
    // una punta de cristal: dos caras (luz a la izquierda, sombra a la derecha) y su remate en pico
    const point = (cx: number, top: number, w: number, bottom: number, lean: number, light: string, mid: string, dark: string, ridge = true) => {
      const sh = top + w * 0.9
      const tip: P = [cx + lean, top]
      const L: P = [cx - w + lean * 0.4, sh]
      const R: P = [cx + w + lean * 0.4, sh]
      const C: P = [cx + lean * 0.3, sh + w * 0.5]
      const BL: P = [cx - w, bottom]
      const BR: P = [cx + w, bottom]
      const BC: P = [cx, bottom + 0.6]
      k.fill(mid, [tip, R, BR, BC, BL, L], { sharp: true })
      k.fill(light, [tip, L, C], { sharp: true })
      k.fill(light, [L, C, BC, BL], { sharp: true, alpha: 0.75 })
      k.fill(dark, [C, R, BR, BC], { sharp: true, alpha: 0.85 })
      k.line([tip, R, BR, BC, BL, L, tip], { edge: true, corners: true })
      if (ridge) k.line([L, C, R], { w: 0.5, alpha: 0.85 }).line([C, BC], { w: 0.45, alpha: 0.7 })
    }
    point(5.2, 8.6, 2.6, 19, -1.6, '#fbe0c0', '#f1d0a8', '#d59d53', false)
    point(18.8, 8, 2.6, 19, 1.8, '#fbe0c0', '#f1d0a8', '#d59d53', false)
    k.layer()
    point(12, 0.6, 5, 19.4, 0, glow ? '#fffaf0' : '#f9cf9d', glow ? '#f9cf9d' : '#e3a24a', glow ? '#ebb675' : '#b06f12')
    // la luz que corre por la cara de luz
    k.fill('#ffffff', [[8.4, 6.6], [9.4, 6.9], [9.4, 16.6], [8.4, 16.2]], { sharp: true, alpha: glow ? 0.9 : 0.6, exact: true })
    if (glow) k.oval(12, 11, 3.2, 4.4, '#fffaf0', { alpha: 0.45 })
    k.face(s, { l: [10.2, 12.4], r: [13.8, 12.4], size: 0.85, cheeks: [[8.8, 14.2], [15.2, 14.2]], mouth: [12, 14.6], w: 1.4, happyKind: 'grin' })
    // el destello
    const sp: P = s.pose ? [3.6, 3.6] : [19.8, 2.8]
    k.sparkle(sp[0], sp[1], 2.1, '#ffffff').sparkle(sp[0], sp[1], 1.2, '#ffd45e')
  }
}

/** La luciérnaga: cabeza con antenas, alas claras que aletean y un abdomen que brilla (más con `%AC…`). */
const luciernaga: Rig = {
  id: 'luciernaga',
  draw(k, s) {
    const lit = s.recolor.size > 0
    // el resplandor del abdomen
    k.oval(12, 16.6, lit ? 8.4 : 7, lit ? 7.6 : 6.4, '#f6ffc2', { alpha: lit ? 0.55 : 0.38, exact: true, n: 18 })
    if (lit) k.oval(12, 16.6, 6, 5.6, '#f3ffb0', { alpha: 0.5, exact: true, n: 16 })
    // alas
    const up = s.pose ? -0.45 : 0
    const wingL = rot(ellipse(6.4, 11.2, 3.6, 2.1, -0.35, 14), 9.4, 11.6, up)
    const wingR = rot(ellipse(17.6, 11.2, 3.6, 2.1, 0.35, 14), 14.6, 11.6, -up)
    k.fill('#d6ecfb', wingL, { alpha: 0.9 }).line(wingL, { closed: true, w: 0.6 }).fill('#d6ecfb', wingR, { alpha: 0.9 }).line(wingR, { closed: true, w: 0.6 })
    k.layer()
    // abdomen
    const tail = ellipse(12, 16.8, 4.6, 4.9, 0, 18)
    k.fill(lit ? '#f3ffb0' : '#e9ff7a', tail)
    k.fill('#c7e04a', [...arc(12, 16.8, 4.6, 4.9, -0.3, 2.2, 8), ...arc(13, 16.6, 3.4, 4.2, 2.1, -0.2, 8)], { alpha: lit ? 0.5 : 0.85 })
    k.oval(10.6, 15, 1.3, 1.1, '#ffffff', { alpha: lit ? 0.9 : 0.6, exact: true, n: 10 })
    k.edge(tail)
    k.layer()
    // cabeza y antenas
    k.line([[10.4, 4.2], [9.4, 1.8], [7.8, 0.8]], { w: 0.75 }).line([[13.6, 4.2], [14.6, 1.8], [16.2, 0.8]], { w: 0.75 })
    k.oval(7.6, 0.8, 0.7, 0.7, '#7c9a6a').oval(16.4, 0.8, 0.7, 0.7, '#7c9a6a')
    const head = ellipse(12, 8.2, 4.9, 4.6, 0, 18)
    k.fill('#7c9a6a', head).fill('#5a7650', [...arc(12, 8.2, 4.9, 4.6, -0.5, 1.8, 8), ...arc(12.8, 8, 3.8, 4, 1.7, -0.4, 8)], { alpha: 0.85 })
    k.fill('#b6c9a8', ellipse(10.2, 5.6, 1.4, 0.8, -0.5, 8), { alpha: 0.9 }).edge(head)
    k.face(s, { l: [10.1, 8.2], r: [13.9, 8.2], size: 0.85, cheeks: [[8.7, 10], [15.3, 10]], mouth: [12, 10.2], w: 1.3, happyKind: 'grin' })
  },
  props: {
    // una chispa de luz que suelta
    g: (k, x, y) => void k.oval(x + 0.5, y + 0.5, 1.1, 1.1, '#f6ffc2', { alpha: 0.6, exact: true, n: 10 }).oval(x + 0.5, y + 0.5, 0.5, 0.5, '#ffffff', { exact: true, n: 8 })
  }
}

/** La semilla: un grano en su montón de tierra con un brote de dos hojas (con la pose, crece). */
const semilla: Rig = {
  id: 'semilla',
  draw(k, s) {
    // la tierra
    const soil: P[] = [[2, 22.6], [3.2, 20], [7, 18.6], [12, 18.2], [17, 18.6], [20.8, 20], [22, 22.6]]
    k.fill('#7a5034', soil).fill('#a8754b', [[4, 20.4], [8, 19.2], [12, 18.8], [16, 19.2], [20, 20.4], [16, 20.4], [12, 20], [8, 20.4]], { alpha: 0.9 }).edge(soil)
    k.layer()
    // el brote
    const g = s.pose ? 1.25 : 1
    const top = 10.6 - 3.4 * g
    k.line([[12, 10.4], [12.2, top + 0.4]], { color: '#60a246', w: 1.1 })
    const leafL: P[] = [[12, top + 0.6], ...arc(12 - 3.2 * g, top - 0.2, 3.2 * g, 1.9 * g, 0.2, Math.PI * 1.85, 10)]
    const leafR: P[] = [[12.2, top + 0.4], ...arc(12.2 + 3.4 * g, top - 0.6, 3.4 * g, 2 * g, Math.PI - 0.2, -Math.PI * 0.85, 10)]
    k.fill('#9dd462', leafL).fill('#60a246', leafR).edge(leafL, { w: 0.8 }).edge(leafR, { w: 0.8 })
    k.line([[12 - 0.4, top + 0.2], [12 - 3.6 * g, top - 0.4]], { color: '#60a246', w: 0.45 }).line([[12.6, top], [12.2 + 4 * g, top - 0.9]], { color: '#def6a6', w: 0.45 })
    k.layer()
    // el grano
    const seed = ellipse(12, 15, 6, 5.4, 0, 20)
    k.fill('#c0885a', seed)
    k.fill('#8f5d3a', [...arc(12, 15, 6, 5.4, -0.6, 1.7, 10), ...arc(13.2, 14.8, 4.6, 4.8, 1.6, -0.5, 10)], { alpha: 0.8 })
    k.fill('#ebc294', ellipse(9.4, 11.6, 2, 1, -0.5, 10), { alpha: 0.95 })
    k.edge(seed)
    k.face(s, { l: [10, 15], r: [14, 15], size: 0.9, cheeks: [[8.4, 16.8], [15.6, 16.8]], mouth: [12, 17.2], w: 1.5, happyKind: 'grin' })
  }
}

/** La taza: café con su vapor en eses, asa, platito; el vapor se mueve (`st1`/`st2`) o se va (`nost`). */
const taza: Rig = {
  id: 'taza',
  draw(k, s) {
    // vapor
    const steam = (dy: number, ph: number) => {
      k.line(wave(9, 6 + dy, 9.4, 1 + dy, 0.8, 1, ph, 10), { color: '#c9bfb6', w: 0.9, alpha: 0.9 })
      k.line(wave(13.4, 6 + dy, 13.8, 0.6 + dy, 0.8, 1, ph + Math.PI, 10), { color: '#c9bfb6', w: 0.9, alpha: 0.9 })
    }
    const st1 = s.cels.get('st1')
    const st2 = s.cels.get('st2')
    if (st1) steam(st1[1], 0)
    else if (st2) steam(st2[1], Math.PI)
    else if (!s.cels.has('nost')) steam(0, s.pose ? Math.PI : 0)
    // el platito
    const saucer = ellipse(11.8, 21.4, 10.6, 1.8, 0, 18)
    k.fill('#f5e6c8', saucer).fill('#dcc39b', [...arc(11.8, 21.4, 10.6, 1.8, 0.1, Math.PI - 0.1, 10), ...arc(11.8, 21, 9.6, 1, Math.PI - 0.2, 0.2, 10)], { alpha: 0.9 }).edge(saucer)
    k.layer()
    // el asa
    const handle = tube([[16.8, 10.6], [20.6, 10.8], [21.2, 14.4], [17.6, 16.4]], 2.2, 2)
    k.body('#31a295', handle, { w: 0.85 })
    k.layer()
    // la taza
    const cup: P[] = [[4, 7.6], [17.6, 7.6], [17.4, 15.6], [15.6, 19.4], [12, 20.4], [8, 20.4], [5.4, 19.2], [4.2, 15.6]]
    k.fill('#61d3bf', cup)
    k.fill('#31a295', [[15, 7.8], [17.6, 7.6], [17.4, 15.6], [15.6, 19.4], [13.2, 20.2], [15.6, 15]], { alpha: 0.8 })
    k.fill('#bdf6ea', [[5, 9.4], [6.4, 9.4], [6.2, 16], [5.4, 15.6]], { alpha: 0.9 })
    k.edge(cup)
    // el café
    const coffee = ellipse(10.8, 8.1, 6.6, 1.3, 0, 14)
    k.fill('#6b4430', coffee).fill('#8d5f45', ellipse(9, 7.9, 2.4, 0.5, 0, 8), { alpha: 0.9 }).line(coffee, { closed: true, w: 0.7 })
    k.face(s, { l: [8, 14], r: [14, 14], size: 1, cheeks: [[6.4, 16], [15.6, 16]], mouth: [11, 16.6], w: 1.8, happyKind: 'grin' })
  }
}

/** La bombilla: cristal con filamento y rayos de luz; se apaga (`%17…`) y se enciende de golpe (`%23`). */
const bombilla: Rig = {
  id: 'bombilla',
  light: true,
  draw(k, s) {
    const off = [...s.recolor].some((r) => r === '%17')
    const flash = s.recolor.has('%23')
    // rayos
    if (!off) {
      const long = s.pose ? 1 : 0
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.0 + (i / 6) * 1.0)
        const r0 = 8.8
        const r1 = r0 + (i % 2 === long ? 2.4 : 1.5) + (flash ? 0.8 : 0)
        k.line([[12 + Math.cos(a) * r0, 8.6 + Math.sin(a) * r0], [12 + Math.cos(a) * r1, 8.6 + Math.sin(a) * r1]], { color: '#f2d36e', w: 0.9 })
      }
    }
    if (!off) k.oval(12, 8.6, flash ? 9 : 8.2, flash ? 8.6 : 7.8, '#fff3b0', { alpha: flash ? 0.6 : 0.35, exact: true, n: 18 })
    // la rosca
    const screw = roundRect(8.6, 15.2, 15.4, 20.2, 1)
    k.fill('#cbd1db', screw).fill('#979fb0', roundRect(8.6, 17, 15.4, 18.2, 0.4), { alpha: 0.9 }).edge(screw, { w: 0.85 })
    k.fill('#627588', [[10.2, 20.2], [13.8, 20.2], [12.8, 22.2], [11.2, 22.2]]).edge([[10.2, 20.2], [13.8, 20.2], [12.8, 22.2], [11.2, 22.2]], { w: 0.75 })
    k.layer()
    // el cristal
    const glass: P[] = [...arc(12, 8.4, 7, 6.9, Math.PI * 0.78, Math.PI * 2.22, 20), [14.8, 13.4], [14.6, 15.4], [9.4, 15.4], [9.2, 13.4]]
    k.fill(off ? '#efe8d8' : flash ? '#fffbe0' : '#fff1a8', glass)
    k.fill(off ? '#d8d2c6' : '#f2d36e', [...arc(12, 8.4, 7, 6.9, -0.3, 1.9, 8), [14.6, 15.4], [13.8, 13.2], ...arc(12.6, 8.4, 5.6, 6, 1.6, -0.3, 8)], { alpha: off ? 0.6 : 0.7 })
    k.fill('#ffffff', ellipse(8.6, 5, 1.6, 0.9, -0.6, 10), { alpha: 0.95 })
    k.edge(glass)
    // el filamento
    k.line([[10.4, 15.2], [10.6, 13], [11.4, 12.2], [12, 13], [12.6, 12.2], [13.4, 13], [13.6, 15.2]], { color: off ? '#979fb0' : '#e89e34', w: 0.6 })
    k.face(s, { l: [10, 8.8], r: [14, 8.8], size: 0.85, cheeks: [[8.6, 10.6], [15.4, 10.6]], mouth: [12, 10.8], w: 1.5, happyKind: 'grin' })
  }
}

export const CAST_A: Rig[] = [luna, gato, reloj, pulpo, medusa, planeta, cometa, cristal, luciernaga, semilla, taza, bombilla]
