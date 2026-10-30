import { describe, expect, it } from 'vitest'
import {
  LID_OPEN,
  laptopCameraAt,
  laptopDims,
  laptopFov,
  laptopSweptBox,
  laptopTitleRect,
  laptopView,
  lidToWorld,
  makeCamera,
  monotone,
  project,
  projectionMatrix,
  screenCornersPx,
  screenFacing,
  screenFill,
  screenInside,
  screenNormal,
  screenPoint,
  screenPower,
  type LaptopCamera,
  type Vec3
} from './laptop.ts'
import type { Laptop, LaptopKey, Montage } from './types.ts'
import { laptopTest } from './v6-laptop.ts'

const H: Montage = {
  name: 'h',
  fps: 60,
  size: [1920, 1080],
  theme: 'light',
  duration: 10,
  takes: {},
  clips: []
}
const V: Montage = { ...H, name: 'v', size: [1080, 1920] }
const S: Montage = { ...H, name: 's', size: [1080, 1080] }
const d = laptopDims(1.6)
const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], -Math.log10(eps)))

/** Multiplica un punto por la vista (lookAt) y la proyección por columnas: lo que hará three en el compositor. */
function viaMatrices(cam: LaptopCamera, p: Vec3): [number, number] {
  const f = [cam.target[0] - cam.position[0], cam.target[1] - cam.position[1], cam.target[2] - cam.position[2]]
  const fl = Math.hypot(...f)
  const fz = f.map((x) => x / fl)
  const r = [fz[1] * 0 - fz[2] * 1, fz[2] * 0 - fz[0] * 0, fz[0] * 1 - fz[1] * 0]
  const rl = Math.hypot(...r)
  const rx = r.map((x) => x / rl)
  const u = [rx[1] * fz[2] - rx[2] * fz[1], rx[2] * fz[0] - rx[0] * fz[2], rx[0] * fz[1] - rx[1] * fz[0]]
  const q = [p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]]
  const view = [q[0] * rx[0] + q[1] * rx[1] + q[2] * rx[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2], -(q[0] * fz[0] + q[1] * fz[1] + q[2] * fz[2]), 1]
  const P = projectionMatrix(cam, 1, 1000)
  const clip = [0, 1, 2, 3].map((row) => P[row] * view[0] + P[4 + row] * view[1] + P[8 + row] * view[2] + P[12 + row] * view[3])
  return [clip[0] / clip[3], clip[1] / clip[3]]
}

describe('portátil · geometría de la tapa', () => {
  it('con la tapa vertical, la pantalla mira al frente y arriba queda la tapa entera', () => {
    close(lidToWorld(d, 90, [0, d.lidH, 0]), [0, d.hinge.y + d.lidH, d.hinge.z])
    close(screenNormal(90), [0, 0, 1])
  })
  it('cerrada, la tapa descansa sobre la base y la pantalla mira hacia abajo', () => {
    close(screenNormal(0), [0, -1, 0])
    const c = screenPoint(d, 0, 0.5, 0.5)
    expect(c[1]).toBeGreaterThan(d.baseT)
    expect(c[2]).toBeGreaterThan(-d.baseD / 2)
    expect(c[2]).toBeLessThan(d.baseD / 2)
    // el borde de arriba de la tapa no se sale por delante de la base
    expect(lidToWorld(d, 0, [0, d.lidH, 0])[2]).toBeLessThanOrEqual(d.baseD / 2 + 1e-9)
  })
  it('abierta, la tapa se inclina hacia atrás y la pantalla tiene la proporción de la captura', () => {
    expect(lidToWorld(d, LID_OPEN, [0, d.lidH, 0])[2]).toBeLessThan(d.hinge.z)
    expect(d.screenW / d.screenH).toBeCloseTo(1.6, 9)
    expect(d.lidH).toBeLessThan(d.baseD)
  })
  it('la pantalla se enciende mientras se abre la tapa', () => {
    expect(screenPower(0)).toBe(0)
    expect(screenPower(70)).toBe(0)
    expect(screenPower(85)).toBeCloseTo(0.5, 9)
    expect(screenPower(LID_OPEN)).toBe(1)
  })
})

describe('portátil · cámara y proyección', () => {
  it('la proyección pura coincide con la de las matrices de three (también con desplazamiento de objetivo)', () => {
    for (const m of [H, V]) {
      const cam = makeCamera(m, {
        yaw: -31,
        pitch: 13,
        dist: 70,
        target: [1, 9, -3],
        lid: LID_OPEN,
        screen: [0.37, 0.55]
      })
      for (const p of [screenPoint(d, LID_OPEN, 0, 0), screenPoint(d, LID_OPEN, 1, 1), [10, 0, 10] as Vec3]) {
        const a = project(cam, p)
        close(viaMatrices(cam, p), [a[0], a[1]], 1e-9)
      }
    }
  })
  it('el punto mirado cae donde dice `screen`', () => {
    const cam = makeCamera(H, {
      yaw: 20,
      pitch: 10,
      dist: 60,
      target: [0, 8, -2],
      lid: LID_OPEN,
      screen: [0.3, 0.6]
    })
    close(project(cam, [0, 8, -2]).slice(0, 2), [-0.4, -0.2], 1e-9)
  })
  it('la vista «screen»: de frente a la pantalla, que llena el cuadro en su lado justo (16:9 de alto, 9:16 de ancho)', () => {
    for (const [m, fill] of [
      [H, 0.962],
      [V, 0.975],
      [S, 0.975]
    ] as const) {
      const lap: Laptop = { keys: [{ t: 0, ...laptopView(m, 'screen') }] }
      const cam = laptopCameraAt(m, lap, 0)
      expect(cam.guarded).toBe(false)
      expect(screenFill(cam, d)).toBeCloseTo(fill, 4)
      const [tl, tr, br, bl] = screenCornersPx(m, cam)
      // un rectángulo derecho (de frente, sin trapecio) y centrado
      expect(Math.abs(tl[0] - bl[0])).toBeLessThan(0.01)
      expect(Math.abs(tl[1] - tr[1])).toBeLessThan(0.01)
      expect(Math.abs(tl[0] + tr[0] - m.size[0])).toBeLessThan(0.01)
      const w = tr[0] - tl[0]
      const h = br[1] - tr[1]
      expect(w / h).toBeCloseTo(1.6, 3)
      if (m === H) expect(h / m.size[1]).toBeCloseTo(fill, 3)
      else expect(w / m.size[0]).toBeCloseTo(fill, 3)
    }
  })
  it('las vistas 3/4 dejan el portátil a un lado, girado hacia el hueco del otro', () => {
    const r = laptopCameraAt(H, { keys: [{ t: 0, ...laptopView(H, '3/4-right') }] }, 0)
    const l = laptopCameraAt(H, { keys: [{ t: 0, ...laptopView(H, '3/4-left') }] }, 0)
    const br = laptopSweptBox(H, { keys: [{ t: 0, ...laptopView(H, '3/4-right') }] }, 0, 0)
    expect(br.x + br.w / 2).toBeLessThan(H.size[0] * 0.45)
    expect(br.w / H.size[0]).toBeCloseTo(0.56, 2)
    // la pantalla mira a la derecha del cuadro: su borde derecho se ve más corto (más lejos) que el izquierdo
    const [tl, tr, bR, bl] = screenCornersPx(H, r)
    expect(bR[1] - tr[1]).toBeLessThan(bl[1] - tl[1])
    const [ltl, ltr, lbr, lbl] = screenCornersPx(H, l)
    expect(lbr[1] - ltr[1]).toBeGreaterThan(lbl[1] - ltl[1])
  })
  it('cada canal va por su cuenta: una clave que solo abre la tapa no para la órbita', () => {
    const lap: Laptop = {
      keys: [
        { t: 0, yaw: -40, lid: 0, frame: 0.5 },
        { t: 1, lid: LID_OPEN },
        { t: 2, yaw: -20 }
      ]
    }
    const yaw = (t: number) => laptopCameraAt(H, lap, t).yaw
    const v1 = (yaw(1.01) - yaw(0.99)) / 0.02
    expect(v1).toBeGreaterThan(5)
    expect(laptopCameraAt(H, lap, 1.5).lid).toBe(LID_OPEN)
  })
  it('la guarda aleja la cámara si una clave pide más de lo que cabe: la ventana nunca se corta', () => {
    const lap: Laptop = {
      keys: [{ t: 0, ...laptopView(H, 'screen'), fill: 1.3 }]
    }
    const cam = laptopCameraAt(H, lap, 0)
    expect(cam.guarded).toBe(true)
    expect(screenInside(H, cam, d)).toBe(true)
    expect(screenFill(cam, d)).toBeGreaterThan(0.99)
  })
  it('curva monótona: pasa por las claves, no rebota y una clave repetida es quieta', () => {
    const ts = [0, 1, 2, 3]
    const vs = [0, 10, 10, 30]
    for (let t = 0; t <= 3; t += 0.01) {
      const v = monotone(ts, vs, t)
      expect(v).toBeGreaterThanOrEqual(-1e-9)
      expect(v).toBeLessThanOrEqual(30 + 1e-9)
      if (t > 1 && t < 2) expect(v).toBeCloseTo(10, 9)
    }
    expect(monotone(ts, vs, 3)).toBe(30)
  })
  it('campo de visión: 50 mm en apaisado, algo más abierto en vertical', () => {
    expect(laptopFov(H)).toBe(26)
    expect(laptopFov(V)).toBe(30)
  })
})

describe('portátil · la prueba de 12 s (16:9 y 9:16)', () => {
  const films: Montage[] = [H, V].map((base) => {
    const c = laptopTest(base.size)
    return { ...base, name: base === H ? 'v6-laptop-h' : 'v6-laptop-v', duration: c.duration, laptop: { keys: c.keys }, titles: c.titles }
  })
  for (const m of films) {
    it(`${m.name}: la pantalla siempre entera dentro del cuadro y sin guarda`, () => {
      const lap = m.laptop!
      for (let i = 0; i <= m.duration * m.fps; i++) {
        const cam = laptopCameraAt(m, lap, i / m.fps)
        expect(cam.guarded, `guarda en ${(i / m.fps).toFixed(3)} s`).toBe(false)
        if (screenFacing(cam, d)) expect(screenInside(m, cam, d), `pantalla cortada en ${(i / m.fps).toFixed(3)} s`).toBe(true)
      }
    })
    it(`${m.name}: el empujón acaba con la pantalla llenando el cuadro`, () => {
      const cam = laptopCameraAt(m, m.laptop!, 6.6)
      expect(screenFill(cam, d)).toBeGreaterThan(0.95)
      expect(screenFill(cam, d)).toBeLessThanOrEqual(1)
    })
    it(`${m.name}: movimiento continuo, sin saltos ni tirones`, () => {
      const lap = m.laptop!
      const pos = (t: number) => laptopCameraAt(m, lap, t).position
      const at = (t: number) => {
        const c = laptopCameraAt(m, lap, t)
        return toPx(m, c)
      }
      let worstAcc = 0
      let worstStep = 0
      for (let i = 1; i < m.duration * m.fps; i++) {
        const t = i / m.fps
        const a = pos(t - 1 / m.fps)
        const b = pos(t)
        const c = pos(t + 1 / m.fps)
        const step = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
        const acc = Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2])
        worstStep = Math.max(worstStep, step)
        worstAcc = Math.max(worstAcc, acc)
        // en el cuadro: el centro de la pantalla no salta más de 40 px entre fotogramas
        const p0 = at(t - 1 / m.fps)
        const p1 = at(t)
        expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), `salto en ${t.toFixed(3)} s`).toBeLessThan(40)
      }
      // a 60 fps: menos de 1,5 cm por fotograma y sin cambios bruscos de velocidad
      expect(worstStep).toBeLessThan(1.5)
      expect(worstAcc).toBeLessThan(0.05)
    })
    it(`${m.name}: los titulares van en el hueco libre, nunca encima del portátil`, () => {
      for (const t of m.titles ?? []) {
        const R = laptopTitleRect(m, m.laptop!, t.start, t.start + t.dur, t.side ?? 'left')
        const box = laptopSweptBox(m, m.laptop!, t.start, t.start + t.dur)
        const overlapX = Math.min(R.x + R.w, box.x + box.w) - Math.max(R.x, box.x)
        const overlapY = Math.min(R.y + R.h, box.y + box.h) - Math.max(R.y, box.y)
        expect(overlapX <= 0 || overlapY <= 0, `«${t.text}» pisa el portátil`).toBe(true)
        if (m.size[0] > m.size[1]) expect(R.w / m.size[0]).toBeGreaterThan(0.2)
        else expect(R.h / m.size[1]).toBeGreaterThan(0.12)
      }
    })
  }
})

function toPx(m: Montage, cam: LaptopCamera): [number, number] {
  const p = project(cam, screenPoint(d, cam.lid, 0.5, 0.5))
  return [((p[0] + 1) / 2) * m.size[0], ((1 - p[1]) / 2) * m.size[1]]
}

export type { LaptopKey }

describe('portátil · revelación y cierre (icono ↔ pantalla)', () => {
  const lap: Laptop = { reveal: { t: 2, dur: 2 }, close: { t: 8, dur: 2 }, keys: [{ t: 2, ...laptopView(H, 'screen'), fill: 2.1 }, { t: 4, ...laptopView(H, '3/4-right') }, { t: 8, ...laptopView(H, '3/4-right') }, { t: 10, ...laptopView(H, 'screen'), fill: 2.1 }] }
  it('la pantalla enseña el icono al empezar la revelación y la app al acabar; en el cierre, al revés', async () => {
    const { iconWindow } = await import('./laptop.ts')
    expect(iconWindow(lap, 1.9)).toBeNull()
    expect(iconWindow(lap, 2)!.icon).toBe(1)
    expect(iconWindow(lap, 2.9)!.icon).toBe(1)
    expect(iconWindow(lap, 3.99)!.icon).toBeLessThan(0.01)
    expect(iconWindow(lap, 5)).toBeNull()
    expect(iconWindow(lap, 8)!.icon).toBe(0)
    expect(iconWindow(lap, 9)!.icon).toBe(1)
    expect(iconWindow(lap, 9)!.anchor).toBe(10)
  })
  it('en el anclaje la pantalla es mayor que el cuadro y de frente (la guarda no actúa ahí)', () => {
    const cam = laptopCameraAt(H, lap, 2)
    expect(cam.guarded).toBe(false)
    expect(screenFill(cam, d)).toBeCloseTo(2.1, 3)
    const [tl, , br, bl] = screenCornersPx(H, cam)
    expect(Math.abs(tl[0] - bl[0])).toBeLessThan(0.01)
    expect(tl[0]).toBeLessThan(0)
    expect(br[1]).toBeGreaterThan(H.size[1])
  })
})
