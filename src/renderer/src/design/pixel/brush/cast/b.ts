// Muñecos dibujados a mano (segunda tanda): farol, robot, abeja, nube, rayo, sol, pluma, dragón, erizo, montaña y cohete.
import type { Rig } from '../rigs'
import { arc, band, ellipse, rot, roundRect, tube, wave } from './geo'

type P = [number, number]

/** El farol: asa, sombrerete, cristal con la llama dentro y su luz; brilla más con `%5A`/`%85`. */
const farol: Rig = {
  id: 'farol',
  draw(k, s) {
    const bright = s.recolor.has('%5A')
    const hot = s.recolor.has('%85')
    // la luz alrededor
    k.oval(12, 12.6, bright ? 9.6 : 8.4, bright ? 10 : 8.8, '#ffe2a0', { alpha: bright ? 0.42 : 0.26, exact: true, n: 18 })
    const sp: [P, P] = s.pose ? [[3.6, 9.4], [20.6, 15.6]] : [[3.8, 14.6], [20.2, 9.4]]
    k.sparkle(sp[0][0], sp[0][1], 1.1, '#ffd98a').sparkle(sp[1][0], sp[1][1], 1.1, '#ffd98a')
    // el asa
    k.line(arc(12, 3.4, 2.4, 2.8, Math.PI, Math.PI * 2, 10), { w: 1, edge: true })
    k.layer()
    // el cristal con la luz
    const glass = roundRect(7.4, 6.4, 16.6, 19.4, 1.6)
    k.fill(bright ? '#ffe2a0' : '#ffd98a', glass)
    k.fill('#fff4d2', roundRect(8.4, 7.4, 12, 18.4, 1.2), { alpha: 0.75 })
    // la llama
    const fl: P[] = [[12, 6.9], [13.3, 9], [13.2, 10.6], [12, 11.4], [10.8, 10.6], [10.7, 9]]
    k.fill(hot ? '#ffd98a' : '#f3b25a', fl, { exact: true }).fill('#fff4d2', ellipse(12, 10, 0.6, 0.9, 0, 8), { exact: true })
    k.edge(glass, { w: 0.9 })
    // el armazón
    k.layer()
    const cap: P[] = [[6.4, 6.8], [8.2, 4.2], [15.8, 4.2], [17.6, 6.8]]
    k.body('#8fa1b4', cap, { sharp: true, w: 0.9 })
    const foot = roundRect(6.2, 19, 17.8, 21.4, 0.9)
    k.body('#627588', foot, { w: 0.9 })
    k.line([[7.4, 7], [7.4, 19]], { color: '#627588', w: 1 }).line([[16.6, 7], [16.6, 19]], { color: '#627588', w: 1 })
    k.face(s, { l: [10, 12.6], r: [14, 12.6], size: 0.85, cheeks: [[8.8, 14.4], [15.2, 14.4]], mouth: [12, 14.8], w: 1.5, happyKind: 'grin' })
  }
}

/** El robot: antena con luz (cambia de color con `%78`), cabeza con pantalla y ojos de luz, cuerpo con botones. */
const robot: Rig = {
  id: 'robot',
  draw(k, s) {
    const lamp = s.recolor.has('%78') ? '#ffe16b' : '#ff6b6b'
    // antena
    k.line([[12, 3.4], [12, 1.4]], { w: 0.9 })
    k.oval(12, 1, 1.25, 1.25, '#ffd9a0', { alpha: 0.55, exact: true }).oval(12, 1, 0.85, 0.85, lamp).ovalLine(12, 1, 0.85, 0.85, { w: 0.6 })
    // brazos (uno se levanta con la pose)
    const armL = s.pose ? tube([[5.6, 14.4], [3.4, 11.4], [3, 9.4]], 2.4, 2.2) : tube([[5.6, 14.4], [3.8, 16.6], [3.8, 18.6]], 2.4, 2.2)
    k.body('#cbd1db', armL, { w: 0.85 }).body('#cbd1db', tube([[18.4, 14.4], [20.2, 16.6], [20.2, 18.6]], 2.4, 2.2), { w: 0.85 })
    // pies
    k.body('#627588', roundRect(8, 19.8, 11, 22.2, 0.8), { w: 0.8 }).body('#627588', roundRect(13, 19.8, 16, 22.2, 0.8), { w: 0.8 })
    k.layer()
    // cuerpo
    const torso = roundRect(6, 12.6, 18, 20.6, 1.6)
    k.fill('#cbd1db', torso).fill('#979fb0', roundRect(15.4, 12.8, 18, 20.4, 1.2), { alpha: 0.7 }).edge(torso)
    k.fill('#f6f7fa', roundRect(8.2, 14.6, 15.8, 19.4, 1), { alpha: 0.95 })
    k.oval(10.2, 17, 0.75, 0.75, '#ff6b6b').oval(12, 17, 0.75, 0.75, '#ffe16b').oval(13.8, 17, 0.75, 0.75, '#7be0a0')
    k.layer()
    // cabeza con su pantalla
    const head = roundRect(3.6, 3.2, 20.4, 13.4, 2.6)
    k.fill('#cbd1db', head).fill('#f6f7fa', roundRect(4.4, 3.8, 7, 12.6, 1.6), { alpha: 0.9 }).edge(head)
    const screen = roundRect(6.4, 4.8, 17.6, 11.4, 1.8)
    k.fill('#1f2a3a', screen, { exact: true })
    // la cara es de luz: ojos y boquita en cian
    const eye = (x: number, y: number, st: 'open' | 'closed' | 'happy') => {
      if (st === 'open') k.fill('#7ff6ff', roundRect(x - 1.1, y - 1.3, x + 1.1, y + 1.3, 0.8), { exact: true })
      else if (st === 'closed') k.line([[x - 1.1, y + 0.3], [x + 1.1, y + 0.3]], { color: '#7ff6ff', w: 0.8 })
      else k.line([[x - 1.1, y + 0.6], [x, y - 0.6], [x + 1.1, y + 0.6]], { color: '#7ff6ff', w: 0.8 })
    }
    const e = s.eyes
    eye(9.8, 8, e === 'wink' ? 'open' : e)
    eye(14.2, 8, e === 'wink' ? 'happy' : e)
    k.line([[11, 10.2], [12, 10.7], [13, 10.2]], { color: '#7ff6ff', w: 0.6 })
  }
}

/** La abeja: cuerpo redondo con rayas, alas claras que baten (pose), antenas y aguijón. */
const abeja: Rig = {
  id: 'abeja',
  draw(k, s) {
    // alas detrás
    const lift = s.pose ? -0.5 : 0
    const wl = rot(ellipse(5.4, 7.6, 4, 2.6, -0.5, 16), 9, 10, lift)
    const wr = rot(ellipse(18.6, 7.6, 4, 2.6, 0.5, 16), 15, 10, -lift)
    k.fill('#d6ecfb', wl, { alpha: 0.92 }).line(wl, { closed: true, w: 0.7 }).fill('#d6ecfb', wr, { alpha: 0.92 }).line(wr, { closed: true, w: 0.7 })
    k.line(rot([[3.4, 7.4], [6.6, 8.6]], 9, 10, lift), { color: '#a9cde8', w: 0.5 }).line(rot([[20.6, 7.4], [17.4, 8.6]], 15, 10, -lift), { color: '#a9cde8', w: 0.5 })
    // antenas
    k.line([[9.6, 6], [8.6, 3], [7, 1.6]], { w: 0.8 }).line([[14.4, 6], [15.4, 3], [17, 1.6]], { w: 0.8 })
    k.oval(6.8, 1.5, 0.75, 0.75, 'ink', { exact: true }).oval(17.2, 1.5, 0.75, 0.75, 'ink', { exact: true })
    // aguijón
    k.fill('#3a2a22', [[11, 20.4], [13, 20.4], [12, 22.6]], { sharp: true })
    k.layer()
    // el cuerpo con sus rayas
    const cx = 12
    const cy = 13.4
    const rx = 8
    const ry = 7
    const bodyPts = ellipse(cx, cy, rx, ry, 0, 24)
    k.fill('#ffe16b', bodyPts)
    k.fill('#f2bb3c', [...arc(cx, cy, rx, ry, -0.4, 1.9, 10), ...arc(cx + 1.4, cy, rx - 1.6, ry - 0.8, 1.8, -0.3, 10)], { alpha: 0.75 })
    k.fill('#3a2a22', band(cx, cy, rx, ry, 15.6, 17.4))
    k.fill('#3a2a22', band(cx, cy, rx, ry, 18.8, 20.6 > cy + ry ? cy + ry : 20.4))
    k.fill('#fff9bc', ellipse(8.4, 8.6, 2.4, 1.1, -0.4, 10), { alpha: 0.95 })
    k.edge(bodyPts)
    k.face(s, { l: [9.2, 11.6], r: [14.8, 11.6], size: 1, cheeks: [[7.2, 13.4], [16.8, 13.4]], mouth: [12, 13.6], w: 1.8, happyKind: 'grin' })
  }
}

/** La nube: algodón con su panza gris y gotas de lluvia debajo (la pose las cambia); el arcoíris es `rb`. */
const nube: Rig = {
  id: 'nube',
  light: true,
  draw(k, s) {
    const drops: P[] = s.pose ? [[7.4, 21.6], [12.4, 22.6], [17.2, 21.4]] : [[8.8, 22], [15.6, 22.4]]
    for (const [x, y] of drops) {
      const d: P[] = [[x, y - 1.6], [x + 0.85, y], ...arc(x, y + 0.3, 0.85, 0.85, 0, Math.PI, 6).slice(1, -1), [x - 0.85, y]]
      k.fill('#8fd0f5', d, { exact: true })
    }
    k.layer()
    const cloud: P[] = [
      [3.4, 19.4],
      ...arc(4.6, 15.2, 3, 3.2, Math.PI * 0.55, Math.PI * 1.55, 6),
      ...arc(8.6, 10.6, 3.8, 3.8, Math.PI * 1.05, Math.PI * 1.75, 6),
      ...arc(12.6, 9.4, 4.4, 4.2, Math.PI * 1.15, Math.PI * 1.9, 6),
      ...arc(17.2, 11, 3.8, 3.8, Math.PI * 1.3, Math.PI * 2.05, 6),
      ...arc(19.6, 15.4, 3, 3.4, -Math.PI * 0.3, Math.PI * 0.5, 6),
      [19.4, 19.4],
      [12, 19.8]
    ]
    k.fill('#f2eef9', cloud)
    k.fill('#c2ced9', [[3.6, 17.6], [8, 18], [12, 18.2], [16.4, 18], [20.6, 17.4], [19.4, 19.4], [12, 19.8], [3.4, 19.4]], { alpha: 0.9 })
    k.fill('#ffffff', ellipse(10, 9.4, 2.8, 1.3, -0.3, 12), { alpha: 0.9 })
    k.edge(cloud)
    k.face(s, { l: [9, 12.6], r: [15, 12.6], size: 1.05, cheeks: [[7, 14.8], [17, 14.8]], mouth: [12, 14.8], w: 1.8, happyKind: 'grin' })
  },
  props: {
    // el arcoíris que sale debajo
    rb: (k, x, y) => {
      const cx = x + 6
      const cy = y + 6
      const bands: [number, string][] = [[5.6, '#e85a48'], [4.6, '#ffd45e'], [3.6, '#8dc860'], [2.6, '#67aeea']]
      for (const [r, c] of bands) k.line(arc(cx, cy, r, r * 0.95, Math.PI * 1.05, Math.PI * 1.95, 12), { color: c, w: 1.4 })
    }
  }
}

/** El rayo: amarillo vivo con su cara, cara de sombra y destellos; destella (`%25`). */
const rayo: Rig = {
  id: 'rayo',
  draw(k, s) {
    const flash = s.recolor.has('%25')
    if (flash) k.oval(13, 11.6, 9.6, 11.4, '#fff9bc', { alpha: 0.55, exact: true, n: 18 })
    const sp: [P, P] = s.pose ? [[4.6, 16.4], [20.8, 3.6]] : [[4, 3.6], [20.6, 17.2]]
    k.sparkle(sp[0][0], sp[0][1], 1.6, '#fff2a8').sparkle(sp[1][0], sp[1][1], 1.2, '#ffd45e')
    k.layer()
    const bolt: P[] = [[13.8, 0.6], [19.4, 0.6], [15.6, 7.6], [20.4, 7.6], [9.8, 23], [12.2, 13.6], [6.6, 13.6]]
    k.fill(flash ? '#fff9bc' : '#ffe16b', bolt, { sharp: true })
    k.fill(flash ? '#ffe16b' : '#f2bb3c', [[15.6, 7.6], [20.4, 7.6], [9.8, 23], [12.2, 13.6], [14.6, 13.4], [17.4, 9.4]], { sharp: true, alpha: 0.85 })
    k.fill('#fff9bc', [[14.4, 1.6], [16.6, 1.6], [12.4, 7.2], [11, 7.2]], { sharp: true, alpha: 0.9 })
    k.edge(bolt, { corners: true })
    k.face(s, { l: [10.4, 10.8], r: [14.4, 10.8], size: 0.85, cheeks: [[9.4, 12.6], [15.2, 12.4]], mouth: [12.4, 12.6], w: 1.5, happyKind: 'grin' })
  }
}

/** El sol con gafas de sol: disco dorado y rayos que giran (la pose los alterna); `sh` mueve las gafas. */
const sol: Rig = {
  id: 'sol',
  draw(k, s) {
    // rayos: unos largos y otros cortos, que se alternan
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2
      const long = (i % 2 === 0) !== s.pose
      const r0 = 8.4
      const r1 = long ? 11.4 : 10
      const w = long ? 1.6 : 1.1
      const pts = tube([[12 + Math.cos(a) * r0, 12 + Math.sin(a) * r0], [12 + Math.cos(a) * r1, 12 + Math.sin(a) * r1]], w * 1.6, w)
      k.fill('#ffd84a', pts).line(pts, { closed: true, w: 0.6 })
    }
    k.layer()
    const disc = ellipse(12, 12, 7.4, 7.4, 0, 24)
    k.fill('#ffd84a', disc)
    k.fill('#f4a93a', [...arc(12, 12, 7.4, 7.4, -0.3, 2.2, 10), ...arc(13.4, 12, 5.8, 6.6, 2.1, -0.2, 10)], { alpha: 0.85 })
    k.fill('#fff6b0', ellipse(9, 7.6, 2.4, 1.2, -0.6, 10), { alpha: 0.95 })
    k.edge(disc)
    k.cheeks([8.2, 14.2], [15.8, 14.2], 0.95)
    k.mouth(s.eyes === 'happy' ? 'grin' : 'smile', 12, 15, 2)
    // las gafas de sol (o, si se las está poniendo, más arriba)
    const g = s.cels.get('sh') ?? [0, 0]
    const gy = 10.6 + g[1]
    k.fill('#2b2433', roundRect(6.6, gy - 1.6, 11.4, gy + 1.6, 1.2), { exact: true }).fill('#2b2433', roundRect(12.6, gy - 1.6, 17.4, gy + 1.6, 1.2), { exact: true })
    k.line([[11.2, gy - 0.6], [12.8, gy - 0.6]], { w: 0.7 })
    k.fill('#6690bb', ellipse(8, gy - 0.6, 0.8, 0.45, -0.3, 8), { exact: true, alpha: 0.95 }).fill('#6690bb', ellipse(14, gy - 0.6, 0.8, 0.45, -0.3, 8), { exact: true, alpha: 0.95 })
  }
}

/** La pluma en su tintero: la pluma blanca sale del bote (la pose la inclina); escribe garabatos (`sq1`–`sq3`). */
const pluma: Rig = {
  id: 'pluma',
  draw(k, s) {
    const a = s.pose ? 0.16 : 0
    // la pluma
    const vane: P[] = rot([[12.6, 9.6], [15, 6.4], [18.2, 2.8], [21.6, 0.6], [20.4, 3.6], [17.8, 7.4], [14.4, 10.4]], 13, 10, a)
    k.fill('#ddceba', vane).fill('#f4ecff', rot([[13.6, 9], [16.6, 5.4], [20.4, 1.4], [18.2, 5.6], [15, 9.4]], 13, 10, a), { alpha: 0.9 })
    k.edge(vane, { w: 0.8 })
    k.line(rot([[12.8, 10.6], [16.4, 6.2], [21, 1]], 13, 10, a), { w: 0.6 })
    for (const t of [0.3, 0.5, 0.7]) {
      const x = 12.8 + (21 - 12.8) * t
      const y = 10.6 + (1 - 10.6) * t
      k.line(rot([[x, y], [x + 1.6, y + 0.4]], 13, 10, a), { color: '#cfb38c', w: 0.4 })
    }
    k.layer()
    // el tintero: una botella baja y panzuda con su cuello
    const neck = roundRect(8.6, 8, 15.4, 12.4, 1)
    k.fill('#98723a', neck).edge(neck, { w: 0.85 })
    k.fill('#352610', ellipse(12, 8.6, 2.6, 0.6, 0, 10), { exact: true })
    k.layer()
    const belly: P[] = [...arc(12, 16.2, 8.4, 6, Math.PI * 1.08, Math.PI * 1.92, 12), [20.2, 18.4], [18.8, 21.6], [12, 22.4], [5.2, 21.6], [3.8, 18.4]]
    k.fill('#98723a', belly)
    k.fill('#725222', [[17.4, 11.4], [20.2, 14.4], [20.2, 18.4], [18.8, 21.6], [15.6, 22.2], [17.6, 17]], { alpha: 0.85 })
    k.fill('#cfb38c', ellipse(6.8, 14.4, 1.1, 2.2, 0.35, 10), { alpha: 0.7 })
    k.edge(belly)
    k.face(s, { l: [10, 16.2], r: [14, 16.2], size: 0.95, cheeks: [[8.2, 18], [15.8, 18]], mouth: [12, 18.4], w: 1.6, happyKind: 'grin' })
  },
  props: {
    sq1: (k, x, y) => void k.line(wave(x, y + 1, x + 4, y + 1, 0.6, 1, 0, 10), { color: '#3f73c4', w: 0.75 }),
    sq2: (k, x, y) => void k.line(wave(x, y + 1, x + 8, y + 1, 0.6, 2, 0, 18), { color: '#3f73c4', w: 0.75 }),
    sq3: (k, x, y) => void k.line(wave(x, y + 1, x + 12, y + 1, 0.6, 3, 0, 26), { color: '#3f73c4', w: 0.75 })
  }
}

/** El dragoncito: cuernos, alas que se levantan (pose), panza, cola con punta; echa fuego (`f1`–`f3`). */
const dragon: Rig = {
  id: 'dragon',
  draw(k, s) {
    const up = s.pose ? -0.45 : 0
    // alas y cola, detrás
    const wing = (side: 1 | -1) => {
      const cx = side > 0 ? 17.6 : 6.4
      const w: P[] = [[cx, 9.6], [cx + side * 4.6, 6.2], [cx + side * 5.2, 9.4], [cx + side * 4.4, 11.6], [cx + side * 2.8, 11], [cx + side * 1.6, 12.8]]
      const ww = rot(w, cx, 10.4, side * up)
      k.fill('#f6c060', ww).fill('#d9943b', rot([[cx + side * 2.6, 8], [cx + side * 4.6, 6.2], [cx + side * 4.2, 10.6]], cx, 10.4, side * up), { alpha: 0.8 })
      k.edge(ww, { w: 0.85 })
    }
    wing(-1)
    wing(1)
    const tailPts: P[] = [[16.6, 19.4], [19.8, 20.6], [21.6, 19], [22, 17]]
    k.body('#62c19a', tube(tailPts, 2.4, 1.2), { w: 0.85 })
    k.fill('#d9943b', [[21, 16.6], [23.2, 15.6], [22.8, 18]], { sharp: true }).edge([[21, 16.6], [23.2, 15.6], [22.8, 18]], { w: 0.6 })
    k.layer()
    // cuerpo y cabeza
    const bodyPts = ellipse(12, 16.6, 6.2, 5.6, 0, 20)
    k.fill('#a2edca', bodyPts).fill('#f5e6c8', ellipse(12, 17.6, 3.6, 3.8, 0, 14)).edge(bodyPts)
    k.oval(9, 22, 1.6, 0.9, '#62c19a').ovalLine(9, 22, 1.6, 0.9, { w: 0.7 }).oval(15, 22, 1.6, 0.9, '#62c19a').ovalLine(15, 22, 1.6, 0.9, { w: 0.7 })
    k.layer()
    // cuernos
    k.fill('#dcc39b', [[6.8, 4.4], [5.8, 0.8], [8.8, 3.2]]).edge([[6.8, 4.4], [5.8, 0.8], [8.8, 3.2]], { w: 0.7 })
    k.fill('#dcc39b', [[17.2, 4.4], [18.2, 0.8], [15.2, 3.2]]).edge([[17.2, 4.4], [18.2, 0.8], [15.2, 3.2]], { w: 0.7 })
    const head = ellipse(12, 8.6, 7, 6, 0, 22)
    k.fill('#a2edca', head)
    k.fill('#62c19a', [...arc(12, 8.6, 7, 6, -0.4, 1.6, 10), ...arc(13.4, 8.4, 5.4, 5.2, 1.5, -0.3, 10)], { alpha: 0.75 })
    k.fill('#defff0', ellipse(9, 4.8, 2, 0.9, -0.4, 10), { alpha: 0.9 })
    k.edge(head)
    // nariz
    k.oval(11, 11.4, 0.35, 0.3, 'ink', { exact: true, n: 6 }).oval(13, 11.4, 0.35, 0.3, 'ink', { exact: true, n: 6 })
    k.face(s, { l: [9, 8.4], r: [15, 8.4], size: 1.05, cheeks: [[7, 10.6], [17, 10.6]], mouth: [12, 12.4], w: 1.8, happyKind: 'grin' })
  },
  props: {
    f1: (k, x, y) => void k.oval(x + 1, y + 1, 1.3, 1, '#ffb347').oval(x + 1, y + 1, 0.6, 0.5, '#ffe066', { exact: true, n: 8 }),
    f2: (k, x, y) => {
      const f: P[] = [[x, y + 1.5], [x + 2, y + 0.2], [x + 4.6, y], [x + 5.4, y + 1.5], [x + 4.6, y + 3], [x + 2, y + 2.8]]
      k.fill('#ffb347', f).fill('#ffe066', [[x + 1, y + 1.5], [x + 2.6, y + 0.9], [x + 4.2, y + 1.5], [x + 2.6, y + 2.1]])
    },
    f3: (k, x, y) => {
      const f: P[] = [[x, y + 2.5], [x + 2.4, y + 0.6], [x + 5, y - 0.4], [x + 8.4, y + 0.6], [x + 7, y + 2.5], [x + 8.4, y + 4.4], [x + 5, y + 5.4], [x + 2.4, y + 4.4]]
      k.fill('#ea5b5b', f, { alpha: 0.9 }).fill('#ffb347', [[x + 0.6, y + 2.5], [x + 2.6, y + 1.2], [x + 5.4, y + 0.8], [x + 6.4, y + 2.5], [x + 5.4, y + 4.2], [x + 2.6, y + 3.8]]).fill('#ffe066', [[x + 1.4, y + 2.5], [x + 3, y + 1.8], [x + 4.6, y + 2.5], [x + 3, y + 3.2]])
    }
  }
}

/** El erizo: lomo de púas (la pose las eriza), carita clara con hocico y una manzanita en las púas. */
const erizo: Rig = {
  id: 'erizo',
  draw(k, s) {
    // el lomo de púas: radio que sube y baja alrededor del centro del lomo
    const spikes: P[] = []
    const n = 15
    const ph = s.pose ? 0.5 : 0
    for (let i = 0; i <= n * 2; i++) {
      const a = Math.PI * 0.95 + (i / (n * 2)) * Math.PI * 1.45
      const r = i % 2 ? 7 : 9.6 + (Math.sin(i * 1.7 + ph * 6) * 0.5)
      spikes.push([13.4 + Math.cos(a) * r, 13 + Math.sin(a) * r * 0.92])
    }
    const back: P[] = [...spikes, [19.6, 20.6], [14, 21.6], [7.4, 21], [4.6, 17.6]]
    k.fill('#a8754b', back, { sharp: true })
    k.fill('#7a5034', [...spikes.slice(n + 2), [19.6, 20.6], [15.6, 20.6], [17.8, 14.6]], { sharp: true, alpha: 0.85 })
    k.edge(back)
    // patitas
    k.oval(8.6, 21.8, 1.4, 0.8, '#7a5034').ovalLine(8.6, 21.8, 1.4, 0.8, { w: 0.65 }).oval(15.4, 21.8, 1.4, 0.8, '#7a5034').ovalLine(15.4, 21.8, 1.4, 0.8, { w: 0.65 })
    k.layer()
    // la cara y la panza claras
    const face: P[] = [[2.6, 16.4], [4.4, 12.6], [8.4, 11.4], [12.4, 12.8], [13.6, 16.6], [12, 20.2], [7.2, 21], [3.6, 19.4]]
    k.fill('#f5e6c8', face).fill('#dcc39b', [[8, 20.6], [12, 20.2], [13.6, 16.6], [12.6, 18.6]], { alpha: 0.7 }).edge(face, { w: 0.9 })
    k.oval(2.8, 16.6, 1, 0.85, 'ink', { exact: true, n: 10 })
    k.face(s, { l: [6.8, 14.6], r: [10.8, 14.6], size: 0.85, cheeks: [[5.4, 16.6], [12, 16.6]], mouth: [7.6, 17.6], w: 1.5, happyKind: 'grin' })
    // la manzanita prendida en las púas
    k.layer()
    k.oval(16.6, 4.8, 1.8, 1.7, '#ea5b5b').oval(16, 4.2, 0.5, 0.4, '#ffa49a', { exact: true, n: 8 }).ovalLine(16.6, 4.8, 1.8, 1.7, { w: 0.7 })
    k.fill('#9dd462', [[16.8, 3.2], [18.4, 1.8], [17.6, 3.4]], { exact: true }).line([[16.6, 3.2], [16.8, 2.2]], { w: 0.5 })
  }
}

/** La montaña: cima nevada con su borde en zigzag, banderín que ondea (pose) y nieve que cae (`sn`). */
const montana: Rig = {
  id: 'montana',
  draw(k, s) {
    // banderín
    k.line([[13.4, 4.6], [13.4, 0.6]], { w: 0.85 })
    const flag: P[] = s.pose ? [[13.6, 0.6], [17.4, 1.4], [13.6, 2.6]] : [[13.6, 0.5], [16.6, 0.4], [17.6, 1.8], [13.6, 2.4]]
    k.fill('#ea5b5b', flag).edge(flag, { w: 0.6 })
    k.layer()
    const mount: P[] = [[1.4, 22], [6.6, 12], [10.6, 5.4], [12.6, 4], [14.6, 5.6], [17.6, 10.8], [22.6, 22]]
    k.fill('#8fa1b4', mount)
    k.fill('#627588', [[12.6, 4], [14.6, 5.6], [17.6, 10.8], [22.6, 22], [16, 22], [15.6, 14]], { alpha: 0.8 })
    // la nieve de la cima
    const snow: P[] = [[8.6, 8.8], [10.6, 5.4], [12.6, 4], [14.6, 5.6], [16.4, 8.8], [15, 8.2], [13.8, 9.6], [12.4, 8.2], [10.8, 9.8]]
    k.fill('#f2eef9', snow).fill('#cdd4e6', [[14.6, 5.6], [16.4, 8.8], [15, 8.2], [14.4, 6.8]], { alpha: 0.8 })
    k.line([[8.6, 8.8], [10.8, 9.8], [12.4, 8.2], [13.8, 9.6], [15, 8.2], [16.4, 8.8]], { w: 0.55 })
    k.fill('#3c4a59', roundRect(1.4, 21.2, 22.6, 22.6, 0.6), { alpha: 0.9 })
    k.edge(mount, { corners: true })
    k.face(s, { l: [10, 15], r: [14, 15], size: 0.95, cheeks: [[8.4, 16.8], [15.6, 16.8]], mouth: [12, 17.2], w: 1.6, happyKind: 'grin' })
  },
  props: {
    sn: (k, x, y) => void k.sparkle(x + 0.5, y + 0.5, 0.9, '#f2eef9')
  }
}

/** El cohete: morro rojo, ventanilla redonda, aletas y su llama (pequeña con `fl2`, grande con `big`). */
const cohete: Rig = {
  id: 'cohete',
  draw(k, s) {
    // la llama
    const big = s.cels.has('big')
    const small = s.cels.has('fl2') || s.pose
    const fl: P[] = big ? [[9.2, 20.2], [14.8, 20.2], [14.4, 23.2], [12, 26.4], [9.6, 23.2]] : small ? [[10, 20.2], [14, 20.2], [13.4, 22.4], [12, 24], [10.6, 22.4]] : [[10.4, 20.2], [13.6, 20.2], [13, 21.8], [12, 22.8], [11, 21.8]]
    k.fill('#ffb347', fl).fill('#ffe066', [[11, 20.4], [13, 20.4], [12.6, 21.6 + (big ? 1.4 : 0)], [12, 22.4 + (big ? 2 : 0)], [11.4, 21.6 + (big ? 1.4 : 0)]])
    // aletas
    const finL: P[] = [[7.4, 13.4], [3.6, 17.4], [3.4, 20.6], [7.6, 18.6]]
    const finR: P[] = [[16.6, 13.4], [20.4, 17.4], [20.6, 20.6], [16.4, 18.6]]
    k.body('#ea5b5b', finL, { w: 0.85 }).body('#ea5b5b', finR, { w: 0.85 })
    k.layer()
    // el cuerpo
    const hull: P[] = [[12, 1.6], [15.4, 4.6], [16.8, 9.6], [16.8, 17.2], [15.6, 20.2], [8.4, 20.2], [7.2, 17.2], [7.2, 9.6], [8.6, 4.6]]
    k.fill('#f6f7fa', hull)
    k.fill('#cbd1db', [[15.4, 4.6], [16.8, 9.6], [16.8, 17.2], [15.6, 20.2], [14, 20.2], [15.2, 12]], { alpha: 0.85 })
    k.fill('#ea5b5b', [[12, 1.6], [15.4, 4.6], [15.8, 6.2], [8.2, 6.2], [8.6, 4.6]])
    k.fill('#979fb0', roundRect(8.2, 18.8, 15.8, 20.4, 0.6), { alpha: 0.9 })
    k.edge(hull)
    k.line([[8.2, 6.2], [15.8, 6.2]], { w: 0.6 })
    // ventanilla
    k.oval(12, 9.6, 2.3, 2.3, '#cdd4e6').oval(12, 9.6, 1.6, 1.6, '#91d1f6').oval(11.4, 9, 0.5, 0.4, '#d4f1ff', { exact: true, n: 8 }).ovalLine(12, 9.6, 2.3, 2.3, { w: 0.7 })
    k.face(s, { l: [10, 14], r: [14, 14], size: 0.85, cheeks: [[8.8, 15.6], [15.2, 15.6]], mouth: [12, 15.8], w: 1.5, happyKind: 'grin' })
  }
}

export const CAST_B: Rig[] = [farol, robot, abeja, nube, rayo, sol, pluma, dragon, erizo, montana, cohete]

