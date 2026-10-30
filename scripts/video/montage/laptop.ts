// V6 · el portátil: medidas (cm), puntos de la tapa y la pantalla según su apertura, la cámara por claves (un canal por
// cosa: giro, altura, distancia, punto, encuadre y tapa), la proyección (con desplazamiento de objetivo) y el hueco libre
// para los titulares. Geometría pura, sin three ni lienzo: la usan el compositor (compose/laptop.ts), el lint, la hoja de
// efectos y las pruebas. Unidades: cm; y hacia arriba; el frente del portátil mira a +z; la bisagra está detrás.
import type { Laptop, LaptopKey, Montage } from './types.ts'
import { warp } from './ramp.ts'
import type { Rect } from './v5.ts'

export type Vec3 = [number, number, number]

/** Apertura de la tapa abierta (grados desde cerrada). */
export const LID_OPEN = 108
/** px de la textura de la pantalla por pt de la toma (la captura es a 2 px/pt: la pantalla la muestra a su resolución). */
export const SCREEN_PX = 2

/** Medidas del portátil (cm): un 14" genérico. La pantalla tiene la proporción de la captura y un marco fino. */
export interface LaptopDims {
  baseW: number
  baseD: number
  baseT: number
  lidT: number
  lidH: number
  /** Marco: lados, arriba y abajo (la barbilla). */
  bezel: { side: number; top: number; bottom: number }
  screenW: number
  screenH: number
  /** Eje de la tapa: altura y fondo. */
  hinge: { y: number; z: number }
}

export function laptopDims(aspect = 1.6): LaptopDims {
  const baseW = 31
  const baseD = 21.4
  const baseT = 1.3
  const bezel = { side: 0.7, top: 0.9, bottom: 1.25 }
  const screenW = baseW - 2 * bezel.side
  const screenH = screenW / aspect
  return {
    baseW,
    baseD,
    baseT,
    lidT: 0.48,
    lidH: screenH + bezel.top + bezel.bottom,
    bezel,
    screenW,
    screenH,
    hinge: { y: baseT + 0.12, z: -baseD / 2 + 0.55 }
  }
}

const RAD = Math.PI / 180

/** Giro de la tapa sobre el eje x (radianes): 0 con la tapa vertical, positivo hacia delante (cerrándose). */
export function lidRotation(lid: number): number {
  return (90 - lid) * RAD
}

/** Un punto del sistema de la tapa (x a lo ancho, y hacia arriba de la tapa desde la bisagra, z hacia fuera de la
 *  pantalla) en el mundo, con la tapa abierta `lid` grados (0 = cerrada sobre la base; 90 = vertical). */
export function lidToWorld(d: LaptopDims, lid: number, p: Vec3): Vec3 {
  const th = lidRotation(lid)
  const [x, y, z] = p
  return [x, d.hinge.y + y * Math.cos(th) - z * Math.sin(th), d.hinge.z + y * Math.sin(th) + z * Math.cos(th)]
}

/** Punto de la pantalla: (u, v) en fracciones de la ventana, (0, 0) arriba a la izquierda. */
export function screenPoint(d: LaptopDims, lid: number, u: number, v: number): Vec3 {
  return lidToWorld(d, lid, [(u - 0.5) * d.screenW, d.bezel.bottom + (1 - v) * d.screenH, 0])
}

/** Normal de la pantalla (hacia fuera). */
export function screenNormal(lid: number): Vec3 {
  const th = lidRotation(lid)
  return [0, -Math.sin(th), Math.cos(th)]
}

/** Las esquinas de la base y de la tapa (el casco del portátil, para encuadrar). */
export function laptopPoints(d: LaptopDims, lid: number): Vec3[] {
  const out: Vec3[] = []
  for (const x of [-d.baseW / 2, d.baseW / 2]) {
    for (const y of [0, d.baseT]) for (const z of [-d.baseD / 2, d.baseD / 2]) out.push([x, y, z])
    for (const y of [0, d.lidH]) for (const z of [0, -d.lidT]) out.push(lidToWorld(d, lid, [x, y, z]))
  }
  return out
}

/** Centro del portátil ABIERTO (el centro de su caja): la cámara lo mira aunque la tapa aún esté cerrada, como una
 *  cámara quieta que ve la tapa subir. */
export function laptopCenter(d: LaptopDims): Vec3 {
  const ps = laptopPoints(d, LID_OPEN)
  const lo = [0, 1, 2].map((c) => Math.min(...ps.map((p) => p[c])))
  const hi = [0, 1, 2].map((c) => Math.max(...ps.map((p) => p[c])))
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
}

const portrait = (m: Montage) => m.size[1] >= m.size[0] * 0.95

/** Campo de visión vertical (grados): un 50 mm en apaisado; algo más abierto en vertical y cuadrado. */
export function laptopFov(m: Montage): number {
  return m.laptop?.fov ?? (portrait(m) ? 30 : 26)
}

/** Brillo de la pantalla según la tapa: se enciende mientras se abre (de 70° a 100°), con curva suave. */
export function screenPower(lid: number): number {
  const x = Math.min(1, Math.max(0, (lid - 70) / 30))
  return x * x * (3 - 2 * x)
}

/** Interpolación cúbica monótona (Fritsch–Carlson): pasa por las claves, sin rebote, con velocidad continua y nula en
 *  la primera y la última (una clave repetida = el valor quieto entre las dos). */
export function monotone(ts: number[], vs: number[], t: number): number {
  const n = ts.length
  if (n === 0) return 0
  if (t <= ts[0] || n === 1) return vs[0]
  if (t >= ts[n - 1]) return vs[n - 1]
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) delta.push((vs[i + 1] - vs[i]) / Math.max(1e-9, ts[i + 1] - ts[i]))
  const mk: number[] = [0]
  for (let i = 1; i < n - 1; i++) mk.push(delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2)
  mk.push(0)
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      mk[i] = 0
      mk[i + 1] = 0
      continue
    }
    const a = mk[i] / delta[i]
    const b = mk[i + 1] / delta[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      mk[i] = k * a * delta[i]
      mk[i + 1] = k * b * delta[i]
    }
  }
  let i = 0
  while (i < n - 2 && t > ts[i + 1]) i++
  const h = ts[i + 1] - ts[i]
  const x = (t - ts[i]) / h
  const h00 = 2 * x ** 3 - 3 * x ** 2 + 1
  const h10 = x ** 3 - 2 * x ** 2 + x
  const h01 = -2 * x ** 3 + 3 * x ** 2
  const h11 = x ** 3 - x ** 2
  return h00 * vs[i] + h10 * h * mk[i] + h01 * vs[i + 1] + h11 * h * mk[i + 1]
}

// ───────────── cámara ─────────────

export interface LaptopCamera {
  position: Vec3
  target: Vec3
  /** Campo de visión vertical (grados) y proporción del cuadro. */
  fov: number
  aspect: number
  /** Desplazamiento de objetivo en coordenadas normalizadas (dónde cae el punto mirado: 0 = centro, ±1 = bordes). */
  shift: [number, number]
  lid: number
  yaw: number
  pitch: number
  dist: number
  /** La guarda tuvo que alejar la cámara para que la pantalla no se cortara (no debería pasar en un buen guion). */
  guarded: boolean
}

export interface Pose {
  yaw: number
  pitch: number
  dist: number
  target: Vec3
  lid: number
  screen: [number, number]
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export function makeCamera(m: Montage, p: Pose, guarded = false): LaptopCamera {
  const cp = Math.cos(p.pitch * RAD)
  const position: Vec3 = [p.target[0] + p.dist * cp * Math.sin(p.yaw * RAD), p.target[1] + p.dist * Math.sin(p.pitch * RAD), p.target[2] + p.dist * cp * Math.cos(p.yaw * RAD)]
  const [W, H] = m.size
  return {
    position,
    target: p.target,
    fov: laptopFov(m),
    aspect: W / H,
    shift: [2 * p.screen[0] - 1, 1 - 2 * p.screen[1]],
    lid: p.lid,
    yaw: p.yaw,
    pitch: p.pitch,
    dist: p.dist,
    guarded
  }
}

/** Ejes de la cámara (derecha, arriba, adelante), como los de lookAt de three con el arriba del mundo. */
export function cameraBasis(cam: LaptopCamera): { r: Vec3; u: Vec3; f: Vec3 } {
  const f = norm(sub(cam.target, cam.position))
  const r = norm(cross(f, [0, 1, 0]))
  return { r, u: cross(r, f), f }
}

/** Proyecta un punto del mundo a coordenadas normalizadas del cuadro (−1…1; y hacia arriba) y su profundidad (cm). */
export function project(cam: LaptopCamera, p: Vec3): [number, number, number] {
  const { r, u, f } = cameraBasis(cam)
  const q = sub(p, cam.position)
  const z = dot(q, f)
  const ty = Math.tan((cam.fov * RAD) / 2)
  return [dot(q, r) / (z * ty * cam.aspect) + cam.shift[0], dot(q, u) / (z * ty) + cam.shift[1], z]
}

/** Coordenadas normalizadas → px del cuadro. */
export function toFrame(m: Montage, [x, y]: [number, number] | [number, number, number]): [number, number] {
  return [((x + 1) / 2) * m.size[0], ((1 - y) / 2) * m.size[1]]
}

/** Matriz de proyección (por columnas, como la de three) con el desplazamiento de objetivo. */
export function projectionMatrix(cam: LaptopCamera, near: number, far: number): number[] {
  const f = 1 / Math.tan((cam.fov * RAD) / 2)
  return [f / cam.aspect, 0, 0, 0, 0, f, 0, 0, -cam.shift[0], -cam.shift[1], (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
}

/** Caja (normalizada) que ocupan unos puntos; null si alguno queda detrás de la cámara. */
function ndcBox(cam: LaptopCamera, ps: Vec3[]): { x0: number; x1: number; y0: number; y1: number } | null {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of ps) {
    const [x, y, z] = project(cam, p)
    if (z <= 0.5) return null
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  return { x0, x1, y0, y1 }
}

/** Distancia (cm) con la que `measure` (decreciente con la distancia) vale `goal`: bisección en logaritmo. */
function solveDist(goal: number, measure: (dist: number) => number): number {
  let lo = Math.log(2)
  let hi = Math.log(20000)
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2
    if (measure(Math.exp(mid)) > goal) lo = mid
    else hi = mid
  }
  return Math.exp((lo + hi) / 2)
}

/** Fracción del cuadro que ocupa la pantalla en su lado más justo (1 = la llena de borde a borde). */
export function screenFill(cam: LaptopCamera, d: LaptopDims): number {
  const b = ndcBox(cam, screenQuad(d, cam.lid))
  return b ? Math.max((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2) : Infinity
}

/** Fracción del ancho del cuadro que ocupa el portátil abierto. */
export function laptopFrame(cam: LaptopCamera, d: LaptopDims): number {
  const b = ndcBox(cam, laptopPoints(d, LID_OPEN))
  return b ? (b.x1 - b.x0) / 2 : Infinity
}

const screenQuad = (d: LaptopDims, lid: number): Vec3[] =>
  (
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ] as const
  ).map(([u, v]) => screenPoint(d, lid, u, v))

const DEFAULTS = {
  yaw: 0,
  pitch: 14,
  lid: LID_OPEN,
  screen: [0.5, 0.5] as [number, number]
}

interface Track {
  ts: number[]
  vs: number[]
}
/** Un canal: los instantes y valores de las claves que lo dan (ordenadas). */
function track(keys: LaptopKey[], pick: (k: LaptopKey) => number | undefined): Track {
  const ts: number[] = []
  const vs: number[] = []
  for (const k of keys) {
    const v = pick(k)
    if (v === undefined) continue
    ts.push(k.t)
    vs.push(v)
  }
  return { ts, vs }
}
const at = (tr: Track, t: number, fallback: number) => (tr.ts.length ? monotone(tr.ts, tr.vs, t) : fallback)

interface Resolved {
  sorted: LaptopKey[]
  yaw: Track
  pitch: Track
  lid: Track
  sx: Track
  sy: Track
  /** Claves de punto mirado: null = centro del portátil, [u, v] = punto de la pantalla. */
  aim: { ts: number[]; at: ([number, number] | null)[] }
  /** log(distancia) por clave de distancia. */
  dist: Track
}

const cache = new WeakMap<Laptop, Map<string, Resolved>>()

/** Las claves resueltas (las distancias de `fill` y `frame` con la pose de su instante). Con caché por portátil y cuadro. */
export function resolveLaptop(m: Montage, laptop: Laptop, aspectScreen = 1.6): Resolved {
  const id = `${m.size[0]}x${m.size[1]}:${aspectScreen}:${laptopFov(m)}`
  let byId = cache.get(laptop)
  if (!byId) cache.set(laptop, (byId = new Map()))
  const hit = byId.get(id)
  if (hit) return hit
  const sorted = [...laptop.keys].sort((a, b) => a.t - b.t)
  const aimKeys = sorted.filter((k) => k.at !== undefined)
  const r: Resolved = {
    sorted,
    yaw: track(sorted, (k) => k.yaw),
    pitch: track(sorted, (k) => k.pitch),
    lid: track(sorted, (k) => k.lid),
    sx: track(sorted, (k) => k.screen?.[0]),
    sy: track(sorted, (k) => k.screen?.[1]),
    aim: { ts: aimKeys.map((k) => k.t), at: aimKeys.map((k) => k.at ?? null) },
    dist: { ts: [], vs: [] }
  }
  const d = laptopDims(aspectScreen)
  for (const k of sorted) {
    if (k.fill === undefined && k.frame === undefined && k.dist === undefined) continue
    const base = poseAt(m, r, d, k.t, 1)
    let dist = k.dist ?? 0
    if (k.fill !== undefined) dist = solveDist(k.fill, (x) => screenFill(makeCamera(m, { ...base, dist: x }), d))
    else if (k.frame !== undefined) dist = solveDist(k.frame, (x) => laptopFrame(makeCamera(m, { ...base, dist: x }), d))
    r.dist.ts.push(k.t)
    r.dist.vs.push(Math.log(dist))
  }
  byId.set(id, r)
  return r
}

/** La pose en t (sin la guarda); la distancia sale de su canal o vale `dist`. */
function poseAt(m: Montage, r: Resolved, d: LaptopDims, t: number, dist?: number): Pose {
  const lid = at(r.lid, t, DEFAULTS.lid)
  // el punto mirado: el de cada clave con la tapa de AHORA (si la tapa se mueve, el punto de la pantalla va con ella)
  const pts = r.aim.at.map((a) => (a ? screenPoint(d, lid, a[0], a[1]) : laptopCenter(d)))
  const target: Vec3 = pts.length
    ? ([0, 1, 2].map((c) =>
        monotone(
          r.aim.ts,
          pts.map((p) => p[c]),
          t
        )
      ) as Vec3)
    : laptopCenter(d)
  return {
    yaw: at(r.yaw, t, DEFAULTS.yaw),
    pitch: at(r.pitch, t, DEFAULTS.pitch),
    lid,
    target,
    screen: [at(r.sx, t, DEFAULTS.screen[0]), at(r.sy, t, DEFAULTS.screen[1])],
    dist: dist ?? (r.dist.ts.length ? Math.exp(monotone(r.dist.ts, r.dist.vs, t)) : 80)
  }
}

/** Margen (px) que la guarda deja entre la pantalla y el borde del cuadro. */
const GUARD_PX = 1

/** ¿Las cuatro esquinas de la pantalla caen dentro del cuadro (con `px` de margen)? */
export function screenInside(m: Montage, cam: LaptopCamera, d: LaptopDims, px = 0): boolean {
  const b = ndcBox(cam, screenQuad(d, cam.lid))
  if (!b) return false
  const mx = (2 * px) / m.size[0]
  const my = (2 * px) / m.size[1]
  return b.x0 >= -1 + mx - 1e-9 && b.x1 <= 1 - mx + 1e-9 && b.y0 >= -1 + my - 1e-9 && b.y1 <= 1 - my + 1e-9
}

/** ¿La pantalla mira hacia la cámara (se ve su cara)? */
export function screenFacing(cam: LaptopCamera, d: LaptopDims): boolean {
  const c = screenPoint(d, cam.lid, 0.5, 0.5)
  return cam.lid > 30 && dot(screenNormal(cam.lid), sub(cam.position, c)) > 0
}

/** La cámara del portátil en el instante t (pura y determinista). Guarda: si la pantalla se cortara, la cámara se aleja
 *  lo justo (la ventana de Aula se ve siempre entera). */
export function laptopCameraAt(m: Montage, laptop: Laptop, t: number, aspectScreen = 1.6): LaptopCamera {
  const d = laptopDims(aspectScreen)
  const r = resolveLaptop(m, laptop, aspectScreen)
  // cámara lenta con rampa: las claves van en el tiempo de la cámara
  const pose = poseAt(m, r, d, warp(laptop.ramps, t))
  const cam = makeCamera(m, pose)
  // en la revelación y el cierre la pantalla enseña el icono y la cámara empieza (o acaba) dentro de ella: sin guarda
  if (iconWindow(laptop, t) !== null || !screenFacing(cam, d) || screenInside(m, cam, d, GUARD_PX)) return cam
  let lo = Math.log(pose.dist)
  let hi = Math.log(pose.dist * 8)
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (screenInside(m, makeCamera(m, { ...pose, dist: Math.exp(mid) }), d, GUARD_PX)) hi = mid
    else lo = mid
  }
  return makeCamera(m, { ...pose, dist: Math.exp(hi) }, true)
}

/** Revelación o cierre en curso: cuánto de icono hay en la pantalla (0–1) y el instante de anclaje (en el que la
 *  pantalla es el cuadro: el final del prólogo o el comienzo del final). null fuera de esos tramos. */
export function iconWindow(laptop: Laptop, t: number): { icon: number; anchor: number; kind: 'reveal' | 'close' } | null {
  const sm = (x: number) => {
    const u = Math.min(1, Math.max(0, x))
    return u * u * u * (u * (u * 6 - 15) + 10)
  }
  const rv = laptop.reveal
  if (rv && t >= rv.t && t < rv.t + rv.dur) return { icon: 1 - sm(((t - rv.t) / rv.dur - 0.55) / 0.45), anchor: rv.t, kind: 'reveal' }
  const cl = laptop.close
  if (cl && t >= cl.t) return { icon: sm((t - cl.t) / (cl.dur * 0.45)), anchor: cl.t + cl.dur, kind: 'close' }
  return null
}

// ───────────── en el cuadro ─────────────

/** Esquinas de la pantalla en px del cuadro (arriba izquierda, arriba derecha, abajo derecha, abajo izquierda). */
export function screenCornersPx(m: Montage, cam: LaptopCamera, aspectScreen = 1.6): [number, number][] {
  return screenQuad(laptopDims(aspectScreen), cam.lid).map((p) => toFrame(m, project(cam, p)))
}

/** Un punto de la ventana (pt de la toma) en px del cuadro: para el cursor (lint, paneo de los clics). */
export function screenToFrame(m: Montage, laptop: Laptop, t: number, pt: [number, number], viewport: [number, number]): [number, number] {
  const d = laptopDims(viewport[0] / viewport[1])
  const cam = laptopCameraAt(m, laptop, t, viewport[0] / viewport[1])
  return toFrame(m, project(cam, screenPoint(d, cam.lid, pt[0] / viewport[0], pt[1] / viewport[1])))
}

/** Caja (px) que ocupa el portátil entero en el cuadro. */
export function laptopBoxPx(m: Montage, cam: LaptopCamera, aspectScreen = 1.6): Rect {
  const ps = laptopPoints(laptopDims(aspectScreen), cam.lid).map((p) => toFrame(m, project(cam, p)))
  const xs = ps.map((p) => p[0])
  const ys = ps.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Unión de las cajas del portátil entre t0 y t1 (cada 1/30 s). */
export function laptopSweptBox(m: Montage, laptop: Laptop, t0: number, t1: number, aspectScreen = 1.6): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const n = Math.max(1, Math.ceil((t1 - t0) * 30))
  for (let i = 0; i <= n; i++) {
    const b = laptopBoxPx(m, laptopCameraAt(m, laptop, t0 + ((t1 - t0) * i) / n, aspectScreen), aspectScreen)
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** El hueco libre para un titular junto al portátil, durante todo el titular: en apaisado, la columna entre el portátil
 *  y el borde de su lado (con aire); en vertical y cuadrado, la banda de arriba hasta el portátil. Nunca encima. */
export function laptopTitleRect(m: Montage, laptop: Laptop, t0: number, t1: number, side: 'left' | 'right', aspectScreen = 1.6): Rect {
  const [W, H] = m.size
  const box = laptopSweptBox(m, laptop, t0, t1, aspectScreen)
  if (portrait(m)) {
    const top = H * (m.size[1] < m.size[0] * 1.15 ? 0.05 : 0.1)
    return {
      x: W * 0.07,
      y: top,
      w: W * 0.86,
      h: Math.max(H * 0.08, box.y - H * 0.03 - top)
    }
  }
  const air = W * 0.035
  const x0 = side === 'left' ? W * 0.05 : box.x + box.w + air
  const x1 = side === 'left' ? box.x - air : W - W * 0.05
  return { x: x0, y: H * 0.12, w: Math.max(W * 0.12, x1 - x0), h: H * 0.76 }
}

// ───────────── vistas del guion ─────────────

export type LaptopView = '3/4-right' | '3/4-left' | 'front' | 'screen'

/** Las vistas del guion como claves (sin `t`): 3/4 a la derecha o a la izquierda (el portátil a un lado, girado hacia
 *  el hueco del titular), de frente algo bajo (titular encima) y la pantalla llenando el cuadro (de frente a ella). En
 *  vertical y cuadrado el portátil va abajo, a lo ancho, y el titular arriba. */
export function laptopView(m: Montage, view: LaptopView, over: Partial<LaptopKey> = {}): Omit<LaptopKey, 't'> {
  const tall = portrait(m)
  const sq = tall && m.size[1] < m.size[0] * 1.15
  const lid = over.lid ?? LID_OPEN
  let k: Omit<LaptopKey, 't'>
  if (view === 'screen')
    k = {
      yaw: 0,
      pitch: lid - 90,
      fill: tall ? 0.975 : 0.962,
      at: [0.5, 0.5],
      screen: [0.5, 0.5]
    }
  else if (view === 'front')
    k = {
      yaw: 0,
      pitch: 9,
      frame: tall ? 0.97 : 0.6,
      at: null,
      screen: [0.5, tall ? (sq ? 0.63 : 0.6) : 0.6]
    }
  else {
    const s = view === '3/4-right' ? -1 : 1
    k = tall
      ? {
          yaw: 28 * s,
          pitch: 15,
          frame: sq ? 0.86 : 1.0,
          at: null,
          screen: [0.5, sq ? 0.62 : 0.6]
        }
      : {
          yaw: 30 * s,
          pitch: 14,
          frame: 0.56,
          at: null,
          screen: [s < 0 ? 0.37 : 0.63, 0.54]
        }
  }
  return { ...k, ...over }
}
