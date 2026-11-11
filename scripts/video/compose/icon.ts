// El icono de Aula («Tinta A · Arco a tinta», scripts/dev/icon/ink-art.mjs) para el prólogo, el final y los avisos del
// vídeo: el mismo dibujo que build/icon.png, en dos versiones (entero y sin el sol, idéntico fuera de él), el sol como
// sprite recortado por la línea del suelo para hacerlo salir, y la geometría de la puerta.
import { archPath, iconSvg } from '../../dev/icon/icon-art.mjs'
import { INK_ARCH, inkArch } from '../../dev/icon/ink-art.mjs'

type Canvas = OffscreenCanvas | HTMLCanvasElement
// los módulos del icono son JS sin tipos: su API, tal como la usa el vídeo
const svgOf = iconSvg as (id: string, o: { size: number; platform: 'mac' | 'plain'; detail?: 'full' | 'mid' | 'small'; art?: string }) => string
const archArt = inkArch as (detail: 'full' | 'mid' | 'small', o?: { sun?: boolean }) => string
const M = INK_ARCH as { cx: number; ground: number; top: number; width: number; band: number; sun: number; line: [number, number] }
/** Del lienzo de 1024 del dibujo a la caja del arte (824, que empieza en 100). */
const U = (v: number): number => v - 100

export const ICON_ID = 'inkA'

/** Trazos del icono para descubrir la tinta (unidades del arte): el eje del arco (se posa abajo a la izquierda, sube,
 *  gira por la clave y baja por la derecha hasta pasar el suelo) y la línea del suelo (de izquierda a derecha). `w`:
 *  ancho de la máscara (la banda de ladrillo, sus dos líneas de tinta y el temblor). */
export const STROKES = {
  arch: { w: 150, pts: () => archAxis() },
  horizon: { w: 72, pts: () => [[U(M.line[0]) - 12, ARCH.horizon + 6], [U(M.line[1]) + 12, ARCH.horizon + 2]] as [number, number][] }
}

function archAxis(): [number, number][] {
  const { R, top, w, horizon } = ARCH
  const cx = U(M.cx)
  const cy = top + R
  const pts: [number, number][] = [[cx - R, horizon + w * 0.12]]
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI + (i / 48) * Math.PI
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)])
  }
  pts.push([cx + R, horizon + w * 0.55 + 18])
  return pts
}

/** Largo de una polilínea. */
export function pathLength(pts: [number, number][]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return L
}

/** El arco (ink-art.mjs, INK_ARCH) en unidades del arte: el eje de la banda de ladrillo (radio y clave), su ancho y el
 *  suelo. La puerta es lo de dentro de la banda. */
const ARCH = { R: M.width / 2 - M.band / 2, top: U(M.top) + M.band / 2, w: M.band, horizon: U(M.ground) }

/** Caja del arte (824) dentro del lienzo `plain` de 1024: squircle en (32, 32) de 960. */
export const ICON = {
  canvas: 1024,
  boxAt: 32,
  boxSize: 960,
  art: 824,
  /** Radio de la squircle en unidades del arte. */
  radius: 185.4,
  cx: U(M.cx),
  /** La puerta: el hueco por dentro de la banda del arco, hasta el suelo. */
  door: { top: ARCH.top + ARCH.w / 2, w: 2 * (ARCH.R - ARCH.w / 2), bottom: ARCH.horizon },
  /** El medio sol ámbar que sale sobre el horizonte (centro y radio, unidades del arte). */
  sun: { x: U(M.cx), y: ARCH.horizon, r: M.sun }
}

/** Puerta del arco (en unidades del arte), para recortar el sol. */
export function doorPath(): string {
  return archPath(ICON.cx, ICON.door.top, ICON.door.w, ICON.door.bottom)
}

/** El sol del icono, recortado del cuadro: color y alfa (diferencia entre el cuadro con sol y sin él) y, por columna,
 *  la máscara de lo que queda por encima del horizonte pintado (el sol que sube no puede pisar el pincelazo). */
export interface SunSprite {
  /** El sol con transparencia, en px del lienzo de 1024. */
  image: ImageBitmap
  /** Lo que se ve por encima del horizonte (mismo tamaño y sitio que `image`). */
  mask: ImageBitmap
  /** Esquina del recorte en px del lienzo de 1024. */
  x: number
  y: number
  /** Radio del sol en px del lienzo de 1024 (cuánto hay que bajarlo para esconderlo). */
  r: number
}

export interface IconAssets {
  icon: ImageBitmap
  iconNoSun: ImageBitmap
  /** Solo la tinta del cuadro sin sol (arco y horizonte) con transparencia, en el lienzo de 1024: se descubre a lo largo
   *  del trazo para que el arco se pinte (final) o se despinte (prólogo) encima de la ventana. */
  ink: ImageBitmap
  sun: SunSprite
  /** Color medio del papel del icono: la losa del prólogo y del final. */
  slab: string
}

const toCanvas = (u: number) => ICON.boxAt + (u * ICON.boxSize) / ICON.art

/** Recorta el sol: alfa por el canal azul (el ámbar casi no tiene azul y el papel sí), color sin el papel de debajo. */
export interface Px {
  width: number
  height: number
  data: Uint8ClampedArray
}
const blank = (w: number, h: number): Px => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })

export function extractSun(full: Px, noSun: Px, amberBlue = 0x3e, inkEdge = false): { sprite: Px; mask: Px } {
  const { width: w, height: h } = full
  const sprite = blank(w, h)
  const mask = blank(w, h)
  const bottom = new Int32Array(w).fill(-1)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const base = noSun.data[i + 2] - amberBlue
      const a = base > 8 ? Math.min(1, Math.max(0, (noSun.data[i + 2] - full.data[i + 2]) / base)) : 0
      if (a < 0.02) continue
      for (let c = 0; c < 3; c++) sprite.data[i + c] = Math.max(0, Math.min(255, (full.data[i + c] - (1 - a) * noSun.data[i + c]) / a))
      sprite.data[i + 3] = Math.round(a * 255)
      if (a > 0.5) bottom[x] = y
    }
  // por encima del horizonte: en cada columna con sol, hasta donde empieza la pintura del horizonte en el cuadro SIN sol
  // (su borde es translúcido: si el sol que sube lo pisara, el pincelazo se vería cortado)
  for (let x = 0; x < w; x++) {
    let edge = h
    if (bottom[x] >= 0) {
      const paper = noSun.data[x * 4 + 2]
      edge = bottom[x] + 1
      for (let y = 0; y <= bottom[x]; y++) {
        const i = (y * w + x) * 4
        // con `inkEdge` el suelo es una línea de tinta sobre aguadas: se busca lo oscuro, no «más oscuro que el papel»
        if (inkEdge ? noSun.data[i] < 0x80 && noSun.data[i + 2] < 0x70 : noSun.data[i + 2] < paper - 12) {
          edge = y
          break
        }
      }
    }
    for (let y = 0; y < h; y++) mask.data[(y * w + x) * 4 + 3] = y < edge ? 255 : 0
  }
  return { sprite, mask }
}

/** La tinta sobre el papel con transparencia: alfa por el canal azul (el ladrillo casi no tiene azul y el papel sí),
 *  color sin el papel de debajo. Lo transparente del lienzo (fuera de la squircle) queda transparente. */
export function extractInk(art: Px, paper: [number, number, number], inkBlue = 0x36): Px {
  const out = blank(art.width, art.height)
  const base = paper[2] - inkBlue
  for (let i = 0; i < art.data.length; i += 4) {
    if (art.data[i + 3] < 250) continue
    const a = Math.min(1, Math.max(0, (paper[2] - art.data[i + 2]) / base))
    if (a < 0.06) continue
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.max(0, Math.min(255, (art.data[i + c] - (1 - a) * paper[c]) / a))
    out.data[i + 3] = Math.round(a * 255)
  }
  return out
}

const bitmap = (p: Px) => createImageBitmap(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height))

function pixels(c: Canvas, x: number, y: number, w: number, h: number): ImageData {
  return (c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(x, y, w, h)
}

/** Rasteriza un SVG (con sus filtros) en un lienzo cuadrado. */
async function rasterSvg(svg: string, size: number): Promise<OffscreenCanvas> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const c = new OffscreenCanvas(size, size)
  c.getContext('2d')!.drawImage(img, 0, 0, size, size)
  return c
}

export async function loadIconAssets(): Promise<IconAssets> {
  // el mismo dibujo que build/icon.png, en el lienzo «plain» (la squircle casi a sangre)
  const full = await rasterSvg(svgOf(ICON_ID, { size: ICON.canvas, platform: 'plain', detail: 'full' }), ICON.canvas)
  const noSun = await rasterSvg(svgOf(ICON_ID, { size: ICON.canvas, platform: 'plain', detail: 'full', art: archArt('full', { sun: false }) }), ICON.canvas)
  const s = ICON.sun
  const k = ICON.boxSize / ICON.art
  const x = Math.floor(toCanvas(s.x - s.r - 14))
  const y = Math.floor(toCanvas(s.y - s.r - 14))
  const w = Math.ceil(toCanvas(s.x + s.r + 14)) - x
  const h = Math.ceil(toCanvas(s.y + 30)) - y
  const { sprite, mask } = extractSun(pixels(full, x, y, w, h), pixels(noSun, x, y, w, h), 0x3a, true)
  // papel: la media de un trozo sin pintar (arriba en el centro, por encima de las aguadas)
  const p = pixels(noSun, Math.round(toCanvas(ICON.cx - 26)), Math.round(toCanvas(12)), 50, 30).data
  const avg = [0, 1, 2].map((c) => {
    let sum = 0
    for (let i = c; i < p.length; i += 4) sum += p[i]
    return Math.round(sum / (p.length / 4))
  })
  return {
    icon: await createImageBitmap(full),
    iconNoSun: await createImageBitmap(noSun),
    ink: await bitmap(extractInk(pixels(noSun, 0, 0, ICON.canvas, ICON.canvas), avg as [number, number, number])),
    sun: { image: await bitmap(sprite), mask: await bitmap(mask), x, y, r: s.r * k },
    slab: '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('')
  }
}
