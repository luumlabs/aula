// Muñecos dibujados a mano (tercera tanda): zorro, búho, fantasma, seta, estrella, gota, pez, árbol, cactus, caracol,
// corazón, hoja, libro, llama, mariposa, nota, ola, pájaro, sobre, rana y murciélago.
import type { Rig } from '../rigs'
import { heartPts } from '../rigs'
import { arc, ellipse, move, rot, roundRect, star, tube, wave } from './geo'

type P = [number, number]

/** El zorro: orejas grandes con punta oscura, hocico y pecho claros, cola espesa con punta blanca. */
const zorro: Rig = {
  id: 'zorro',
  draw(k, s) {
    // la cola
    const tail: P[] = s.pose ? [[16.4, 19], [20, 17.6], [22.4, 13.8], [21.6, 10.4]] : [[16.4, 19.6], [20.4, 19.2], [22.6, 16.6], [22.8, 13.6]]
    const tl = tube(tail, 3.6, 3)
    k.fill('#f5914a', tl).fill('#fffaf0', tube(tail.slice(-2), 2.6, 3), { alpha: 0.95 }).edge(tl)
    k.layer()
    // cuerpo
    const body = ellipse(12, 17.6, 6.2, 5, 0, 18)
    k.fill('#f5914a', body).fill('#cf632c', [...arc(12, 17.6, 6.2, 5, -0.4, 1.6, 8), ...arc(13.2, 17.4, 4.8, 4.4, 1.5, -0.3, 8)], { alpha: 0.85 })
    k.fill('#fffaf0', ellipse(12, 18.4, 2.8, 3.4, 0, 12)).edge(body)
    k.oval(9, 22, 1.6, 0.9, '#5a3526').oval(15, 22, 1.6, 0.9, '#5a3526')
    k.layer()
    // cabeza con orejas
    const head: P[] = [[3.8, 11], [3.6, 6], [5.4, 0.8], [9.4, 4.4], [14.6, 4.4], [18.6, 0.8], [20.4, 6], [20.2, 11], [17.4, 14.4], [12, 15.6], [6.6, 14.4]]
    k.fill('#f5914a', head)
    k.fill('#ffc896', [[4.2, 6.4], [5.4, 2.4], [6.6, 5.6], [5.2, 10.6]], { alpha: 0.9 })
    k.fill('#3b241b', [[4.6, 3], [5.4, 0.8], [7, 2.2]], { sharp: true }).fill('#3b241b', [[19.4, 3], [18.6, 0.8], [17, 2.2]], { sharp: true })
    // máscara clara del hocico
    k.fill('#f5e6c8', [[6, 12.4], [8.6, 10.6], [12, 12], [15.4, 10.6], [18, 12.4], [16, 14.6], [12, 15.4], [8, 14.6]])
    k.edge(head)
    k.oval(12, 12.6, 0.9, 0.7, 'ink', { exact: true, n: 8 })
    k.face(s, { l: [8, 9.6], r: [16, 9.6], size: 1.05, cheeks: [[5.8, 11.6], [18.2, 11.6]], mouth: [12, 13.8], w: 1.8, kind: 'cat', happyKind: 'grin' })
  }
}

/** El búho: penachos, disco claro alrededor de los ojos, pico, panza con plumas en V y patas. */
const buho: Rig = {
  id: 'buho',
  draw(k, s) {
    const open = s.pose ? 0.35 : 0
    // alas
    const wl = rot([[5.4, 9.6], [2.4, 13], [2.6, 18.4], [5.8, 20]], 5.4, 9.6, open)
    const wr = rot([[18.6, 9.6], [21.6, 13], [21.4, 18.4], [18.2, 20]], 18.6, 9.6, -open)
    k.body('#8f5d3a', wl, { w: 0.85 }).body('#8f5d3a', wr, { w: 0.85 })
    k.oval(9.4, 22.4, 1.5, 0.8, '#d9943b').oval(14.6, 22.4, 1.5, 0.8, '#d9943b')
    k.layer()
    const bodyPts: P[] = [[4.4, 8], [5, 2.2], [8.6, 4.4], [15.4, 4.4], [19, 2.2], [19.6, 8], [19.8, 15], [17.6, 20.4], [12, 22], [6.4, 20.4], [4.2, 15]]
    k.fill('#c0885a', bodyPts).fill('#8f5d3a', [[17.6, 6], [19.6, 8], [19.8, 15], [17.6, 20.4], [16.4, 14]], { alpha: 0.8 }).edge(bodyPts)
    // panza con plumas
    const belly = ellipse(12, 16.6, 4.6, 4.8, 0, 16)
    k.fill('#f5e6c8', belly)
    for (const [x, y] of [[10, 15], [14, 15], [12, 17.4], [10, 19.6], [14, 19.6]] as P[]) k.line([[x - 1, y - 0.4], [x, y + 0.4], [x + 1, y - 0.4]], { color: '#c0885a', w: 0.55 })
    k.layer()
    // disco de la cara
    k.oval(8.6, 10.4, 3.4, 3.2, '#f5e6c8').oval(15.4, 10.4, 3.4, 3.2, '#f5e6c8')
    k.line(arc(8.6, 10.4, 3.4, 3.2, Math.PI * 0.9, Math.PI * 2.1, 10), { w: 0.6, color: '#8f5d3a' }).line(arc(15.4, 10.4, 3.4, 3.2, Math.PI * 0.9, Math.PI * 2.1, 10), { w: 0.6, color: '#8f5d3a' })
    k.fill('#f6c060', [[11, 12.2], [13, 12.2], [12, 14.4]], { exact: true }).line([[11, 12.2], [13, 12.2], [12, 14.4], [11, 12.2]], { w: 0.5 })
    k.eyes(s, [8.6, 10.4], [15.4, 10.4], 1.3)
  }
}

/** El fantasma: sábana blanca con bajo ondulado; se vuelve transparente (`%23…`), desaparece y hace ¡BU! (`boo`). */
const fantasma: Rig = {
  id: 'fantasma',
  light: true,
  draw(k, s) {
    const fade = s.recolor.has('%2_') ? 0.12 : s.recolor.has('%23') ? 0.55 : 1
    const ph = s.pose ? Math.PI : 0
    const hem: P[] = []
    for (let i = 0; i <= 10; i++) {
      const x = 19.6 - i * 1.52
      hem.push([x, 20.6 + Math.sin(i * 1.6 + ph) * 1.3])
    }
    const sheet: P[] = [...arc(12, 9.6, 7.6, 7.8, Math.PI, Math.PI * 2, 14), [19.6, 12], ...hem, [4.4, 12]]
    k.fill('#f2eef9', sheet, { alpha: fade })
    k.fill('#d4cbc3', [[16.6, 4.4], [19.6, 9.6], [19.6, 20], [17.4, 21], [17.6, 12]], { alpha: 0.8 * fade })
    k.line(sheet, { closed: true, edge: true, alpha: Math.max(0.35, fade) })
    if (fade < 0.2) return
    const boo = s.cels.has('boo')
    k.face(s, { l: [9, 9.6], r: [15, 9.6], size: 1.1, cheeks: [[7.2, 12], [16.8, 12]], mouth: [12, 12.6], w: boo ? 3.4 : 1.8, kind: boo ? 'yawn' : 'smile', happyKind: 'grin' })
  }
}

/** La seta: sombrero rojo con lunares blancos, pie claro con su cara y esporas doradas. */
const seta: Rig = {
  id: 'seta',
  draw(k, s) {
    const sp: P[] = s.pose ? [[2.2, 14.4], [21.6, 2.8], [20.4, 15.6]] : [[2.6, 15.6], [22, 1.8], [21.4, 14.4]]
    for (const [x, y] of sp) k.oval(x, y, 0.7, 0.7, '#ffe7a6', { exact: true, n: 8 })
    // pie
    const stem: P[] = [[7.6, 12], [16.4, 12], [17.4, 18.4], [16, 21.6], [8, 21.6], [6.6, 18.4]]
    k.fill('#efe0c4', stem).fill('#e2cfab', [[14.6, 12.4], [16.4, 12], [17.4, 18.4], [16, 21.6], [14.4, 21.4]], { alpha: 0.9 }).edge(stem)
    k.face(s, { l: [10, 16], r: [14, 16], size: 0.9, cheeks: [[8.4, 17.8], [15.6, 17.8]], mouth: [12, 18.2], w: 1.5, happyKind: 'grin' })
    k.layer()
    // sombrero
    const cap: P[] = [...arc(12, 11.4, 10.4, 9.4, Math.PI * 1.02, Math.PI * 1.98, 16), [22.2, 12.6], [12, 13.8], [1.8, 12.6]]
    k.fill('#ea5b5b', cap).fill('#c03b4a', [[17.6, 4.4], [21.6, 9], [22.2, 12.6], [17.4, 13.2], [19.4, 9.4]], { alpha: 0.8 })
    for (const [x, y, r] of [[8, 5.4, 1.6], [13.6, 4, 1.3], [17.8, 8.2, 1.2], [5, 10, 1], [11, 9.6, 1.1]] as [number, number, number][]) k.oval(x, y, r, r * 0.85, '#fff3ea', { n: 12 })
    k.edge(cap)
  },
  props: {
    sp: (k, x, y) => void k.oval(x + 0.5, y + 0.5, 0.7, 0.7, '#ffd45e', { exact: true, n: 8 })
  }
}

/** La estrella: cinco puntas doradas con su cara; con la pose aparece un destello abajo. */
const estrella: Rig = {
  id: 'estrella',
  draw(k, s) {
    k.sparkle(3.2, 4.6, 1.4, '#fff9bc')
    if (s.pose) k.sparkle(21, 20.4, 1.4, '#ffe16b')
    const st = star(12, 12.6, 10.8, 5, 5)
    k.fill('#ffe16b', st)
    k.fill('#f2bb3c', [[12.4, 12.6], [16.8, 9], [22.4, 9.2], [17, 14.6], [19, 21.6], [12.6, 17.6]], { alpha: 0.8 })
    k.fill('#fff9bc', [[11.6, 3.6], [10.4, 8.2], [8.2, 8.8]], { alpha: 0.8 })
    k.line(st, { closed: true, edge: true })
    k.face(s, { l: [10, 12.2], r: [14, 12.2], size: 0.95, cheeks: [[8.4, 14], [15.6, 14]], mouth: [12, 14.4], w: 1.6, happyKind: 'grin' })
  }
}

/** La gota: agua azul con su brillo; al caer salpica (`spl`). */
const gota: Rig = {
  id: 'gota',
  draw(k, s) {
    const drop: P[] = [[12, 1.4], [14.6, 6], [17.6, 11], [18.6, 15.4], [17, 19.6], [12, 21.8], [7, 19.6], [5.4, 15.4], [6.4, 11], [9.4, 6]]
    k.fill('#91d1f6', drop).fill('#5ca4d8', [[14.6, 6], [17.6, 11], [18.6, 15.4], [17, 19.6], [13.6, 21.4], [16.2, 15.6]], { alpha: 0.85 })
    const hl: P = s.pose ? [9, 10.8] : [8.6, 12]
    k.fill('#d4f1ff', ellipse(hl[0], hl[1], 1, 2.2, 0.4, 10), { alpha: 0.95 })
    k.edge(drop)
    k.face(s, { l: [10, 15.4], r: [14, 15.4], size: 0.95, cheeks: [[8.4, 17.2], [15.6, 17.2]], mouth: [12, 17.6], w: 1.6, happyKind: 'grin' })
  },
  props: {
    spl: (k, x, y) => {
      k.line([[x, y], [x - 1, y - 1.6]], { color: '#91d1f6', w: 0.8 }).line([[x + 13, y], [x + 14, y - 1.6]], { color: '#91d1f6', w: 0.8 })
      k.fill('#b4def7', ellipse(x + 7, y + 1.2, 6.4, 0.9, 0, 14), { alpha: 0.9 })
    }
  }
}

/** El pez: cuerpo de coral mirando a la izquierda, aleta, cola que se agita (pose), panza clara y burbujas. */
const pez: Rig = {
  id: 'pez',
  draw(k, s) {
    const flick = s.pose ? 0.35 : 0
    const tail = rot([[17.6, 12], [22.6, 7], [21.4, 12.4], [22.6, 17.4]], 17.6, 12, flick)
    k.body('#d05553', tail, { w: 0.85 })
    k.fill('#f5836f', [[9, 6.4], [12, 2.4], [14.4, 6.6]]).edge([[9, 6.4], [12, 2.4], [14.4, 6.6]], { w: 0.75 })
    k.layer()
    const body = ellipse(11.4, 12, 8.4, 6.2, 0, 22)
    k.fill('#f5836f', body).fill('#d05553', [...arc(11.4, 12, 8.4, 6.2, -0.6, 0.9, 8), ...arc(12.6, 12, 6.6, 5.2, 0.8, -0.5, 8)], { alpha: 0.75 })
    k.fill('#f5e6c8', [[5, 14], [9, 15.6], [14, 15.4], [16, 14.6], [14.4, 17.4], [9, 18], [5.6, 16.4]])
    k.fill('#ffc2b3', ellipse(9, 8.4, 2.4, 1, -0.2, 10), { alpha: 0.9 })
    k.edge(body)
    k.line(arc(13.6, 12, 2.6, 3.6, -1.2, 1.2, 8), { w: 0.55, color: '#b04449' })
    // un solo ojo (va de perfil)
    if (s.eyes === 'open' || s.eyes === 'wink') k.oval(7, 10.6, 1, 1.2, 'ink', { exact: true }).oval(6.6, 10.1, 0.4, 0.4, '#fffbf2', { exact: true, n: 8 })
    else k.line([[5.9, 10.9], [7, 10], [8.1, 10.9]], { w: 0.8 })
    k.oval(5.2, 12.6, 1, 0.55, '#ff8fb1', { alpha: 0.85, exact: true, n: 8 })
    k.line([[3.6, 13.2], [4.4, 13.8], [5.2, 13.4]], { w: 0.7 })
  },
  props: {
    bb: (k, x, y) => void k.ovalLine(x + 1.5, y + 1.5, 1.1, 1.1, { color: '#d4f1ff', w: 0.6 }),
    b1: (k, x, y) => void k.oval(x + 0.5, y + 0.5, 0.6, 0.6, '#d4f1ff', { exact: true, n: 8 })
  }
}

/** El árbol: copa redonda con manzanas, tronco; una manzana cae (`ap`, y `noap` la quita de la copa). */
const arbol: Rig = {
  id: 'arbol',
  draw(k, s) {
    const trunk: P[] = [[10.4, 14], [13.6, 14], [14, 20.4], [15.6, 22.2], [8.4, 22.2], [10, 20.4]]
    k.fill('#a8754b', trunk).fill('#7a5034', [[12.4, 14], [13.6, 14], [14, 20.4], [15.6, 22.2], [12.6, 22.2]], { alpha: 0.85 }).edge(trunk)
    const leaf: P = s.pose ? [2.6, 17.6] : [3.6, 15.6]
    k.fill('#9dd462', ellipse(leaf[0], leaf[1], 1.3, 0.6, -0.4, 8))
    k.layer()
    const crown: P[] = [
      ...arc(6.4, 10.6, 4.2, 4.4, Math.PI * 0.6, Math.PI * 1.5, 6),
      ...arc(12, 6.6, 5.6, 5, Math.PI * 1.15, Math.PI * 1.85, 6),
      ...arc(17.6, 10.6, 4.2, 4.4, Math.PI * 1.5, Math.PI * 2.4, 6),
      [17, 15.6],
      [12, 16.2],
      [7, 15.6]
    ]
    k.fill('#9dd462', crown).fill('#60a246', [[14.6, 3.6], [19.6, 7], [21.6, 11], [19.6, 14.4], [17, 15.6], [17.6, 10]], { alpha: 0.8 })
    k.fill('#def6a6', ellipse(8.6, 5.6, 2.2, 1, -0.5, 10), { alpha: 0.9 })
    k.edge(crown)
    const apples: P[] = [[13.4, 3.8], [18.4, 9.4]]
    if (!s.cels.has('noap')) apples.push([5.4, 11.4])
    for (const [x, y] of apples) k.oval(x, y, 0.95, 0.95, '#ea5b5b', { exact: true, n: 10 })
    k.face(s, { l: [10, 10.2], r: [14, 10.2], size: 0.9, cheeks: [[8.4, 12], [15.6, 12]], mouth: [12, 12.4], w: 1.5, happyKind: 'grin' })
  },
  props: {
    ap: (k, x, y) => {
      k.oval(x + 1, y + 2, 1.3, 1.2, '#ea5b5b').ovalLine(x + 1, y + 2, 1.3, 1.2, { w: 0.6 }).fill('#4f9a4e', [[x + 1.2, y + 0.9], [x + 2.4, y], [x + 2, y + 1]], { exact: true })
    }
  }
}

/** El cactus en su maceta: brazos (uno saluda con la pose), espinitas y una flor rosa; se le cae un pétalo (`pet`). */
const cactus: Rig = {
  id: 'cactus',
  draw(k, s) {
    const armL = tube([[7.2, 13.4], [4.4, 13], [3.8, 10.4], [3.8, 8.6]], 3, 2.8)
    const armR = s.pose ? tube([[16.8, 11.4], [19.6, 11], [20.2, 7.6], [20.2, 5.4]], 3, 2.8) : tube([[16.8, 13.4], [19.6, 13.4], [20.2, 15.6]], 3, 2.8)
    k.body('#7bb860', armL, { w: 0.85 }).body('#7bb860', armR, { w: 0.85 })
    k.layer()
    const body = roundRect(7, 3.6, 17, 17.6, 4.6)
    k.fill('#7bb860', body).fill('#4f884b', roundRect(14.2, 4.4, 17, 17.6, 2.6), { alpha: 0.8 }).fill('#c6e69d', roundRect(8, 5, 9.8, 15.6, 1), { alpha: 0.8 }).edge(body)
    for (const [x, y] of [[8.6, 13.6], [15.6, 6.4], [15.4, 13], [12, 5.2]] as P[]) k.line([[x - 0.4, y], [x + 0.4, y]], { color: '#f4f8e0', w: 0.45 })
    // la flor
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      k.oval(12 + Math.cos(a) * 1.3, 2.6 + Math.sin(a) * 1.2, 1, 0.8, '#f79bb8', { rot: a, n: 8 })
    }
    k.oval(12, 2.6, 0.7, 0.7, '#ffe16b', { exact: true, n: 8 })
    k.face(s, { l: [10, 10], r: [14, 10], size: 0.9, cheeks: [[8.6, 11.8], [15.4, 11.8]], mouth: [12, 12.2], w: 1.5, happyKind: 'grin' })
    k.layer()
    // la maceta
    const pot: P[] = [[5.4, 16.8], [18.6, 16.8], [17.2, 22.6], [6.8, 22.6]]
    k.fill('#dc7c4c', pot, { sharp: true }).fill('#b45c36', [[15.4, 16.8], [18.6, 16.8], [17.2, 22.6], [15, 22.6]], { sharp: true, alpha: 0.8 })
    k.fill('#f6b088', roundRect(4.8, 15.8, 19.2, 18, 0.7)).edge(roundRect(4.8, 15.8, 19.2, 18, 0.7), { w: 0.85 }).edge(pot, { corners: true })
  },
  props: {
    pet: (k, x, y) => void k.oval(x + 0.5, y + 0.5, 0.9, 0.6, '#f79bb8', { rot: 0.6, n: 8 })
  }
}

/** El caracol: concha en espiral dorada, cuerpo rosado con antenas (se estira con la pose) y su rastro (`sl`). */
const caracol: Rig = {
  id: 'caracol',
  draw(k, s) {
    const st = s.pose ? 0.8 : 0
    // cuerpo (pie) y cabeza
    const foot: P[] = [[1.8, 20], [2.6, 11.4], [4.6, 8.4], [7.6, 8.6], [9, 12.4], [9.4, 17.4], [20, 17.4], [22.6, 19.4], [21, 21.4], [3.4, 21.4]]
    k.fill('#f9caba', foot).fill('#e09378', [[9.4, 18.6], [20, 18.4], [22.6, 19.4], [21, 21.4], [8, 21.4]], { alpha: 0.8 }).edge(foot)
    k.line([[3.8, 9], [2.8 - st, 5.6], [2.2 - st, 4.4]], { w: 0.8 }).line([[6.6, 8.8], [7.2 + st * 0.5, 5], [7.4 + st * 0.5, 3.8]], { w: 0.8 })
    k.oval(2.1 - st, 4, 0.8, 0.8, '#f9caba').ovalLine(2.1 - st, 4, 0.8, 0.8, { w: 0.6 }).oval(7.5 + st * 0.5, 3.4, 0.8, 0.8, '#f9caba').ovalLine(7.5 + st * 0.5, 3.4, 0.8, 0.8, { w: 0.6 })
    k.face(s, { l: [4.2, 11.6], r: [7.4, 11.6], size: 0.8, cheeks: [[3.2, 13.6], [8.4, 13.6]], mouth: [5.8, 13.8], w: 1.3, happyKind: 'grin' })
    k.layer()
    // la concha con su espiral
    const shell = ellipse(15, 11.6, 6.8, 6.4, 0, 22)
    k.fill('#f6c060', shell).fill('#d9943b', [...arc(15, 11.6, 6.8, 6.4, -0.4, 1.8, 10), ...arc(16.2, 11.4, 5.4, 5.6, 1.7, -0.3, 10)], { alpha: 0.8 })
    k.fill('#ffe3a3', ellipse(12.4, 7.2, 2, 1, -0.5, 10), { alpha: 0.9 }).edge(shell)
    const spiral: P[] = []
    for (let i = 0; i <= 40; i++) {
      const t = i / 40
      const a = t * Math.PI * 4.2
      const r = 0.4 + t * 4.6
      spiral.push([15 + Math.cos(a) * r, 11.6 + Math.sin(a) * r * 0.95])
    }
    k.line(spiral, { color: '#9a5d26', w: 0.8 })
  },
  props: {
    sl: (k, x, y) => void k.line([[x, y + 0.5], [x + 2, y + 0.4]], { color: '#e4ded8', w: 1 })
  }
}

/** El corazón: rojo con su brillo; late (la pose lo hace un poco más grande). */
const corazon: Rig = {
  id: 'corazon',
  draw(k, s) {
    const sc = s.pose ? 1.07 : 1
    const h = move(heartPts(0, 0, 20), 12, 11.4, sc)
    k.fill('#ea5b5b', h).fill('#c03b4a', move([[0.4, -6.6], [4.4, -7.6], [9, -6.8], [9.8, -2.4], [8.4, 2], [0.4, 8.4], [5, 1]], 12, 11.4, sc * 0.98), { alpha: 0.8 })
    k.fill('#ffa49a', ellipse(12 - 5.6 * sc, 11.4 - 4.6 * sc, 1.8, 1, -0.6, 10), { alpha: 0.95 })
    k.edge(h)
    k.face(s, { l: [10, 11], r: [14, 11], size: 0.95, cheeks: [[8.2, 12.8], [15.8, 12.8]], mouth: [12, 13.2], w: 1.6, happyKind: 'grin' })
  }
}

/** La hoja: verde con su nervio y su rabito; se mece (la pose la inclina). */
const hoja: Rig = {
  id: 'hoja',
  draw(k, s) {
    const a = s.pose ? 0.12 : 0
    const leaf = rot([[12, 1.6], [16, 4.4], [18.6, 9], [18.4, 14.4], [15.6, 18.6], [12, 20.6], [8.4, 18.6], [5.6, 14.4], [5.4, 9], [8, 4.4]], 12, 21, a)
    k.line(rot([[12, 20.4], [12.4, 23.2]], 12, 21, a), { color: '#a8754b', w: 1.1 })
    k.fill('#9dd462', leaf).fill('#60a246', rot([[12.2, 1.8], [16, 4.4], [18.6, 9], [18.4, 14.4], [15.6, 18.6], [12.2, 20.4]], 12, 21, a), { alpha: 0.75 })
    k.fill('#def6a6', rot(ellipse(8.4, 7, 1.6, 0.8, -0.8, 8), 12, 21, a), { alpha: 0.9 }).edge(leaf)
    k.line(rot([[12, 3.4], [12, 7.6]], 12, 21, a), { color: '#60a246', w: 0.6 }).line(rot([[12, 17], [12, 20.2]], 12, 21, a), { color: '#60a246', w: 0.6 })
    k.line(rot([[12, 18], [9, 15.6]], 12, 21, a), { color: '#60a246', w: 0.45 }).line(rot([[12, 18], [15, 15.6]], 12, 21, a), { color: '#60a246', w: 0.45 })
    k.face(s, { l: [10, 11], r: [14, 11], size: 0.9, cheeks: [[8.4, 12.8], [15.6, 12.8]], mouth: [12, 13.2], w: 1.5, happyKind: 'grin' })
  }
}

/** El libro: tapa azul con esquinas doradas, cantos de las hojas y marcapáginas rojo (se agita con la pose); le salen letras. */
const libro: Rig = {
  id: 'libro',
  draw(k, s) {
    const tip = s.pose ? 1 : 0
    k.fill('#ea5b5b', [[13.6, 2.4], [15.4, 2.4], [15.4 + tip, 0.2], [14.5 + tip * 0.5, 1], [13.6 + tip, 0.2]], { sharp: true })
    // las hojas (canto)
    const pages = roundRect(6, 3.4, 20, 21.6, 1)
    k.fill('#f5e6c8', pages).edge(pages, { w: 0.8 })
    for (const y of [6, 9, 12, 15, 18]) k.line([[17.6, y], [19.4, y]], { color: '#dcc39b', w: 0.45 })
    k.layer()
    const cover = roundRect(3.6, 2.6, 17.6, 21.2, 1.4)
    k.fill('#6298ce', cover).fill('#366da3', roundRect(3.6, 2.6, 6, 21.2, 1.2), { alpha: 0.9 }).fill('#b3d0ef', roundRect(7, 3.6, 8.4, 6.4, 0.6), { alpha: 0.6 }).edge(cover)
    for (const [x, y] of [[7.2, 4.2], [16.4, 4.2], [7.2, 19.8], [16.4, 19.8]] as P[]) k.oval(x, y, 0.65, 0.65, '#f6c060', { exact: true, n: 8 })
    k.face(s, { l: [10, 10.6], r: [14, 10.6], size: 1.1, cheeks: [[8.2, 12.8], [15.8, 12.8]], mouth: [12, 13.2], w: 1.6, happyKind: 'grin' })
  },
  props: {
    lt: (k, x, y) => void k.line([[x, y + 4], [x + 1.5, y], [x + 3, y + 4]], { w: 0.7 }).line([[x + 0.6, y + 2.6], [x + 2.4, y + 2.6]], { w: 0.6 }),
    lt2: (k, x, y) => void k.line([[x, y + 5], [x, y], [x + 1.6, y + 0.4], [x + 1.6, y + 2.2], [x, y + 2.5], [x + 2, y + 3], [x + 2, y + 4.6], [x, y + 5]], { w: 0.7 })
  }
}

/** La llama: fuego naranja con lenguas que tiemblan (pose) y un corazón amarillo donde va la cara. */
const llama: Rig = {
  id: 'llama',
  draw(k, s) {
    const f = s.pose ? 1 : 0
    const outer: P[] = [[12 + f * 0.6, 1.2], [14.4, 5], [16.6 - f * 0.4, 3.6 + f], [17.8, 7.6], [20.4 + f * 0.6, 6.4], [20.6, 11.6], [19.4, 17.6], [16, 21.4], [12, 22.4], [8, 21.4], [4.6, 17.6], [3.4, 11.6], [3.8 - f * 0.6, 6.6], [6.4, 7.8], [7.8 + f * 0.4, 3.8], [9.8, 5.4]]
    k.fill('#f5914a', outer).fill('#e0592f', [[17.8, 7.6], [20.4, 6.4], [20.6, 11.6], [19.4, 17.6], [16, 21.4], [17.4, 13]], { alpha: 0.85 }).edge(outer)
    const inner: P[] = [[12, 9.4], [15.4, 13], [16.4, 16.6], [14.6, 20], [12, 20.8], [9.4, 20], [7.6, 16.6], [8.6, 13]]
    k.fill('#ffe16b', inner).fill('#f2bb3c', [[15.4, 13], [16.4, 16.6], [14.6, 20], [13, 20.6], [14.6, 16]], { alpha: 0.8 })
    k.face(s, { l: [10, 15.2], r: [14, 15.2], size: 0.9, cheeks: [[8.6, 17], [15.4, 17]], mouth: [12, 17.4], w: 1.5, happyKind: 'grin' })
  }
}

/** La mariposa: alas rosas con lunares blancos arriba y turquesa abajo (se cierran con la pose), cuerpo y antenas. */
const mariposa: Rig = {
  id: 'mariposa',
  draw(k, s) {
    const sx = s.pose ? 0.72 : 1
    const wing = (side: 1 | -1) => {
      const up = move(ellipse(0, 0, 5.4, 4.4, side * -0.25, 16), 12 + side * 5.6 * sx, 8, 1)
      const upS = up.map(([x, y]) => [12 + (x - 12) * sx, y] as P)
      const lo = ellipse(12 + side * 4.6 * sx, 16.6, 3.8 * sx, 3.6, side * 0.3, 14)
      k.fill('#58b9cf', lo).fill('#07b3d0', ellipse(12 + side * 4.6 * sx, 17, 2.2 * sx, 2, 0, 10), { alpha: 0.8 }).edge(lo, { w: 0.85 })
      k.fill('#f79bb8', upS).fill('#d66790', ellipse(12 + side * 6.4 * sx, 10.2, 2.4 * sx, 1.6, 0, 10), { alpha: 0.6 }).edge(upS, { w: 0.85 })
      k.oval(12 + side * 6.4 * sx, 6.8, 1.3 * sx, 1.1, '#fff4f8', { exact: true, n: 10 })
    }
    wing(-1)
    wing(1)
    k.layer()
    const bodyPts = roundRect(10.4, 9, 13.6, 21, 1.6)
    k.fill('#328395', bodyPts).edge(bodyPts, { w: 0.85 })
    k.line([[11, 3.4], [9.6, 1.2]], { w: 0.7 }).line([[13, 3.4], [14.4, 1.2]], { w: 0.7 }).oval(9.4, 1, 0.6, 0.6, 'ink', { exact: true, n: 8 }).oval(14.6, 1, 0.6, 0.6, 'ink', { exact: true, n: 8 })
    const head = ellipse(12, 6, 3.2, 3, 0, 14)
    k.fill('#ade0ed', head).edge(head, { w: 0.85 })
    k.eyes(s, [10.6, 5.8], [13.4, 5.8], 0.75)
    k.line([[11.4, 7.6], [12, 8], [12.6, 7.6]], { w: 0.55 })
  }
}

/** La nota musical: cabeza turquesa con cara, plica y corchete; canta (las notitas cambian con la pose). */
const nota: Rig = {
  id: 'nota',
  draw(k, s) {
    const sp: P = s.pose ? [19.8, 13.6] : [20.6, 11.4]
    k.oval(sp[0], sp[1], 0.9, 0.7, '#9fe1e0', { rot: -0.4, exact: true, n: 8 }).line([[sp[0] + 0.7, sp[1]], [sp[0] + 0.7, sp[1] - 2.2]], { color: '#9fe1e0', w: 0.6 })
    // plica y corchete
    const stem: P[] = [[13.4, 15.6], [13.4, 2], [15.6, 1.4], [19.6, 5.2], [19.2, 8.6], [16.4, 6.2], [15.6, 6.4], [15.6, 15]]
    k.fill('#15b6b7', stem).fill('#108586', [[15.6, 1.6], [19.6, 5.2], [19.2, 8.6], [17.6, 6.4]], { alpha: 0.8 }).edge(stem)
    k.layer()
    const head = ellipse(9.4, 17, 6.4, 4.6, -0.3, 20)
    k.fill('#15b6b7', head).fill('#108586', [...arc(9.4, 17, 6.4, 4.6, -0.2, 1.8, 8), ...arc(10, 17.2, 5, 3.6, 1.7, -0.1, 8)], { alpha: 0.8 })
    k.fill('#a2e6e5', ellipse(6.6, 14.6, 1.8, 0.8, -0.4, 8), { alpha: 0.9 }).edge(head)
    k.face(s, { l: [7.2, 16.4], r: [11.2, 16.4], size: 0.9, cheeks: [[5.6, 18.2], [12.8, 18.2]], mouth: [9.2, 18.6], w: 1.5, happyKind: 'grin' })
  }
}

/** La ola: se curva y rompe a la derecha con su espuma; salpica gotas (la pose las mueve). */
const ola: Rig = {
  id: 'ola',
  draw(k, s) {
    const dr: P[] = s.pose ? [[21.6, 3.4], [19.4, 1.4]] : [[22.4, 1.8], [20.6, 0.6]]
    for (const [x, y] of dr) k.oval(x, y, 0.6, 0.6, '#bfe6ff', { exact: true, n: 8 })
    const crest: P[] = [[0.8, 22], [0.8, 13.6], [2.4, 8.4], [6, 4.4], [11, 2.6], [16.6, 3.4], [20.4, 6.2], [21.6, 9.4], [19.6, 11.2], [16.6, 9.8], [13.4, 9.4], [11.4, 11.6], [12.4, 14.4], [16.2, 15.4], [20.6, 15.4], [23, 17.4], [23, 22]]
    k.fill('#6fbcf0', crest).fill('#3f8ccc', [[11.4, 11.6], [12.4, 14.4], [16.2, 15.4], [20.6, 15.4], [23, 17.4], [23, 22], [12, 22], [9, 17]], { alpha: 0.75 })
    // la espuma de la cresta
    k.fill('#eaf7ff', [[4.2, 6], [6, 4.4], [11, 2.6], [16.6, 3.4], [20.4, 6.2], [21.6, 9.4], [19.6, 11.2], [19.4, 8], [16.4, 5.4], [11.4, 4.6], [6.6, 6.2]], { alpha: 0.95 })
    k.edge(crest)
    k.line(wave(1.6, 20.6, 22.6, 20.6, 0.35, 3, 0, 20), { color: '#bfe6ff', w: 0.6, alpha: 0.9 })
    k.face(s, { l: [5, 14.4], r: [10, 14.4], size: 1.05, cheeks: [[3.4, 16.6], [11.4, 16.6]], mouth: [7.4, 16.8], w: 1.8, happyKind: 'grin' })
  }
}

/** El pájaro: bola azul con penacho, panza clara, pico naranja, alas (se levantan con la pose) y patitas. */
const pajaro: Rig = {
  id: 'pajaro',
  draw(k, s) {
    const up = s.pose ? -0.6 : 0
    const wl = rot([[6, 12], [1.8, 13.6], [2.6, 17.4], [6.4, 17]], 6, 12, up)
    const wr = rot([[18, 12], [22.2, 13.6], [21.4, 17.4], [17.6, 17]], 18, 12, -up)
    k.body('#5583cc', wl, { w: 0.85 }).body('#5583cc', wr, { w: 0.85 })
    k.line([[10, 20.4], [9.6, 22.6]], { color: '#d9943b', w: 0.8 }).line([[14, 20.4], [14.4, 22.6]], { color: '#d9943b', w: 0.8 })
    k.layer()
    // penacho
    k.fill('#7fb0f0', [[11, 4.6], [12.4, 1.2], [13.8, 4.6]]).edge([[11, 4.6], [12.4, 1.2], [13.8, 4.6]], { w: 0.7 })
    const bodyPts = ellipse(12, 13, 7.4, 7.6, 0, 22)
    k.fill('#7fb0f0', bodyPts).fill('#5583cc', [...arc(12, 13, 7.4, 7.6, -0.6, 1.4, 8), ...arc(13.2, 13, 6, 6.6, 1.3, -0.5, 8)], { alpha: 0.75 })
    k.fill('#f5e6c8', ellipse(12, 16.4, 4.2, 4, 0, 14)).fill('#cfe3ff', ellipse(9, 8.4, 2, 1, -0.5, 8), { alpha: 0.9 }).edge(bodyPts)
    k.face(s, { l: [9.6, 11], r: [14.4, 11], size: 0.95, cheeks: [[7.8, 13], [16.2, 13]] })
    k.fill('#f6c060', [[10.8, 12.6], [13.2, 12.6], [12, 14.4]], { exact: true }).line([[10.8, 12.6], [13.2, 12.6], [12, 14.4], [10.8, 12.6]], { w: 0.5 })
  }
}

/** El sobre: carta crema con su solapa, un sello de corazón y un corazoncito que flota (la pose lo sube). */
const sobre: Rig = {
  id: 'sobre',
  light: true,
  draw(k, s) {
    const hy = s.pose ? 1.2 : 2.4
    k.fill('#ff9fbf', heartPts(19, hy, 4.4), { exact: true })
    const env = roundRect(2.4, 5.4, 21.6, 20.6, 1)
    k.fill('#f5e6c8', env).fill('#dcc39b', [[2.6, 20.2], [12, 13.4], [21.4, 20.2]], { alpha: 0.6 }).edge(env)
    k.line([[2.8, 6], [12, 13.6], [21.2, 6]], { w: 0.85 }).line([[2.8, 20], [9.6, 14.6]], { w: 0.55, color: '#a5875f' }).line([[21.2, 20], [14.4, 14.6]], { w: 0.55, color: '#a5875f' })
    const seal = heartPts(12, 13, 5.4)
    k.fill('#ea5b5b', seal).line(seal, { closed: true, w: 0.6 })
    k.face(s, { l: [7, 15.4], r: [17, 15.4], size: 0.9, cheeks: [[5.6, 17.2], [18.4, 17.2]] })
  }
}

/** La rana: ojos saltones arriba, boca de oreja a oreja, panza clara; caza una mosca (`fly`). */
const rana: Rig = {
  id: 'rana',
  draw(k, s) {
    const bodyPts: P[] = [[2.4, 15.6], [3.4, 10.6], [6.6, 7.6], [12, 6.6], [17.4, 7.6], [20.6, 10.6], [21.6, 15.6], [19.8, 20.6], [12, 22.4], [4.2, 20.6]]
    k.fill('#6fd39a', bodyPts).fill('#3ea072', [[17.4, 7.8], [20.6, 10.6], [21.6, 15.6], [19.8, 20.6], [16, 21.6], [18.4, 14]], { alpha: 0.75 })
    k.fill('#eef7d8', ellipse(12, 17.2, 5.6, 4, 0, 16)).edge(bodyPts)
    k.layer()
    // los ojos saltones
    for (const x of [7.6, 16.4]) {
      const ball = ellipse(x, 7.4, 3, 2.8, 0, 14)
      k.fill('#6fd39a', ball).edge(ball, { w: 0.85 }).oval(x, 7.4, 2, 1.9, '#ffffff', { exact: true, n: 12 })
    }
    const e = s.eyes
    const pupil = (x: number, st: 'open' | 'closed' | 'happy') => {
      if (st === 'open') k.oval(x + 0.3, 7.6, 1, 1.15, 'ink', { exact: true, n: 10 })
      else if (st === 'closed') k.line([[x - 1.3, 7.6], [x + 1.3, 7.6]], { w: 0.8 })
      else k.line([[x - 1.3, 8.2], [x, 6.8], [x + 1.3, 8.2]], { w: 0.8 })
    }
    pupil(7.6, e === 'wink' ? 'open' : e)
    pupil(16.4, e === 'wink' ? 'happy' : e)
    k.cheeks([5, 13.4], [19, 13.4], 1)
    const open = s.pose
    if (open) k.mouth('grin', 12, 12.8, 6)
    else k.line([[6.6, 12.4], [9, 13.6], [12, 13.9], [15, 13.6], [17.4, 12.4]], { w: 0.85 })
  },
  props: {
    fly: (k, x, y) => {
      k.oval(x + 0.6, y + 0.4, 0.8, 0.5, '#dbe9f9', { rot: -0.5, exact: true, n: 8 }).oval(x + 2.4, y + 0.4, 0.8, 0.5, '#dbe9f9', { rot: 0.5, exact: true, n: 8 })
      k.oval(x + 1.5, y + 1.4, 0.7, 0.6, 'ink', { exact: true, n: 8 })
    }
  }
}

/** El murciélago: alas desplegadas (suben y bajan con la pose), orejas puntiagudas, colmillito. */
const murcielago: Rig = {
  id: 'murcielago',
  draw(k, s) {
    const lift = s.pose ? -2.4 : 0
    const wing = (side: 1 | -1) => {
      const x0 = 12 + side * 4.6
      const w: P[] = [[x0, 9.6], [12 + side * 9, 6.4 + lift], [12 + side * 11.4, 8.6 + lift], [12 + side * 11, 14 + lift * 0.4], [12 + side * 9.2, 13 + lift * 0.4], [12 + side * 8, 15.6], [12 + side * 6.4, 14.4], [x0, 16.4]]
      k.fill('#7f553e', w).fill('#a7795f', [[x0, 10.4], [12 + side * 9, 7.6 + lift], [12 + side * 7.6, 13.6]], { alpha: 0.6 }).edge(w)
      k.line([[x0 + side * 0.4, 10.6], [12 + side * 9.2, 13 + lift * 0.4]], { w: 0.5, color: '#3f2516' })
    }
    wing(-1)
    wing(1)
    k.layer()
    const head: P[] = [[7, 12], [7.2, 6.6], [7.8, 2.6], [10.4, 5.6], [13.6, 5.6], [16.2, 2.6], [16.8, 6.6], [17, 12], [15.6, 16.6], [12, 18], [8.4, 16.6]]
    k.fill('#a7795f', head).fill('#dcbba9', [[8.4, 4.6], [8.6, 7], [9.8, 6.6]], { exact: true }).fill('#dcbba9', [[15.6, 4.6], [15.4, 7], [14.2, 6.6]], { exact: true })
    k.fill('#dcbba9', ellipse(12, 14.4, 3, 2.4, 0, 12), { alpha: 0.85 }).edge(head)
    k.face(s, { l: [10, 11.4], r: [14, 11.4], size: 0.95, cheeks: [[8.6, 13.4], [15.4, 13.4]], mouth: [12, 14], w: 1.6, happyKind: 'grin' })
    k.fill('#ffffff', [[12.4, 14.3], [13.2, 14.3], [12.8, 15.4]], { exact: true })
  }
}

export const CAST_C: Rig[] = [zorro, buho, fantasma, seta, estrella, gota, pez, arbol, cactus, caracol, corazon, hoja, libro, llama, mariposa, nota, ola, pajaro, sobre, rana, murcielago]
