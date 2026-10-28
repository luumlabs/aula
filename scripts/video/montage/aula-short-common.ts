// La versión corta y movida de la película de Aula para redes (Reddit, X, TikTok/Reels/Shorts): ~35 s sobre el tramo más
// enérgico de «South Waves», con transiciones de pincel, rótulos pintados y trazos al ritmo. Reutiliza las tomas de la
// película larga (aula-film.ts: mismas tomas → misma huella, sin recapturar) y elige trozos de ellas por su tiempo en la
// película. Un solo guion para los dos formatos: aula-short.ts (16:9) y aula-short-vertical.ts (9:16).
import grid from '../music/south-waves.grid.json' with { type: 'json' }
import film from './aula-film.ts'
import { filmGrid, type GridJson } from './grid.ts'
import { defineMontage, type CameraKey, type Clip, type Montage, type Title } from './types.ts'

// ——— música: compás 1 (gancho) · 2–13 = la vuelta enérgica de la pista (48–59) · 14–17 = el cierre real (84–87) ———
const CUTS: [number, number][] = [[2, 48], [60, 84]]
const START = grid.downbeat - grid.beat
const G = filmGrid(grid as GridJson, CUTS, START)
const BEAT = G.beat
const BAR = G.barDur
const V = (bar: number, beat = 1, frac = 0): number => +G.V(bar, beat, frac).toFixed(4)

/** Tiempo de una toma de la película a partir de un instante de la película larga (sus planos dicen qué parte de qué toma
 *  se ve en cada momento). */
function fromFilm(t: number): { take: string; from: number } {
  const c = film.clips.find((x) => t >= x.start - 1e-6 && t < x.start + x.dur - 1e-6)
  if (!c) throw new Error(`la película no tiene plano en ${t}`)
  return { take: c.take, from: +((c.from ?? 0) + (t - c.start)).toFixed(4) }
}

/** Una escena del corto: de `from` a `to` (s del corto), tomada de la película desde `filmT`. `h` y `v` son los encuadres
 *  de 16:9 y de vertical/cuadrado: punto de la ventana (pt) que importa y zoom (16:9: px de vídeo por pt; vertical y
 *  cuadrado: relativo al hueco entre bandas, 1 = la altura del hueco), con un paneo opcional. */
interface Scene {
  from: number
  to: number
  filmT: number
  h: { focus: [number, number]; zoom: number; panTo?: [number, number] }
  v: { focus: [number, number]; zoom: number; panTo?: [number, number] }
}

// fin del gancho: la losa ya es la ventana y la app está en marcha (≈ 1,5 s)
const HOOK_END = V(1, 3)
const SCENES: Scene[] = [
  // el día del examen: el cursor va a «Prepare for this exam» y lo pulsa (se ve tras el gesto losa → ventana)
  { from: V(1), to: V(2), filmT: +(17.22 - (V(2) - V(1))).toFixed(4), h: { focus: [1180, 430], zoom: 1.3 }, v: { focus: [1230, 400], zoom: 1.75 } },
  // el curso nuevo ya relleno: los temas se escriben
  { from: V(2), to: V(3), filmT: 20.0, h: { focus: [1100, 700], zoom: 1.2 }, v: { focus: [1180, 790], zoom: 1.8 } },
  // el equipo de agentes trabaja
  { from: V(3), to: V(5), filmT: 29.7, h: { focus: [620, 420], zoom: 1.25, panTo: [760, 460] }, v: { focus: [560, 330], zoom: 1.6, panTo: [700, 470] } },
  // «Not yet» con su porqué
  { from: V(5), to: V(6), filmT: 47.6, h: { focus: [700, 330], zoom: 1.35 }, v: { focus: [690, 320], zoom: 1.8 } },
  // el tutor lo explica
  { from: V(6), to: V(7), filmT: 57.6, h: { focus: [1150, 400], zoom: 1.35 }, v: { focus: [1150, 390], zoom: 1.75 } },
  // la tarjeta gira (repaso espaciado)
  { from: V(7), to: V(8), filmT: 70.1, h: { focus: [840, 400], zoom: 1.3 }, v: { focus: [835, 360], zoom: 1.6 } },
  // la figura: «Find it» y «Nice!»
  { from: V(8), to: V(9), filmT: 79.4, h: { focus: [840, 420], zoom: 1.3 }, v: { focus: [830, 380], zoom: 1.6 } },
  // el chat actúa (de noche): «I have an English test…» → al calendario
  { from: V(9), to: V(11), filmT: 100.6, h: { focus: [980, 520], zoom: 1.3, panTo: [980, 440] }, v: { focus: [1045, 470], zoom: 1.45, panTo: [1045, 400] } },
  // cuestionario en el chat: Correct
  { from: V(11), to: V(12), filmT: 112.0, h: { focus: [980, 520], zoom: 1.35 }, v: { focus: [990, 500], zoom: 1.55 } },
  // el desfile de cursos dibujados a mano
  { from: V(12), to: V(14, 3), filmT: 124.2, h: { focus: [700, 300], zoom: 1.25, panTo: [960, 520] }, v: { focus: [560, 300], zoom: 1.4, panTo: [990, 560] } }
]

/** h = 16:9 (Reddit, X, YouTube) · v = 9:16 (TikTok, Reels, Shorts) · s = 1:1. */
export function buildShort(format: 'h' | 'v' | 's'): Montage {
  const vertical = format === 'v'
  const square = format === 's'
  const banded = vertical || square
  const size: [number, number] = vertical ? [1080, 1920] : square ? [1080, 1080] : [1920, 1080]
  // vertical: la banda de arriba deja los rótulos a y ≈ 375 (por debajo de la interfaz de TikTok/Reels/Shorts)
  const bands = vertical ? { top: 480, bottom: 360, fill: true } : square ? { top: 190, bottom: 150, fill: true } : undefined
  const BAND = 950 // 16:9: la banda de rótulos bajo la ventana

  /** 16:9 con zoom: la ventana se apoya en la banda (su borde de abajo en 950 px) y se recorta solo por arriba; en x, sin
   *  salirse de la ventana. Así nunca queda papel vacío entre la ventana y el rótulo. */
  const frameH = (zoom: number, [x, y]: [number, number]): [number, number] => {
    const hw = 960 / zoom
    const cx = hw >= 720 ? 720 : Math.min(1440 - hw, Math.max(hw, x))
    const anchored = 900 - (BAND - 540) / zoom // foco con el borde de abajo de la ventana en la banda
    const top = anchored - 540 / zoom
    return [Math.round(cx), Math.round(top > 0 ? anchored : Math.max(y, 540 / zoom))]
  }
  const shot = (s: Scene) => (banded ? { ...s.v, zoom: square ? +Math.min(1.15, s.v.zoom * 0.7).toFixed(3) : s.v.zoom } : s.h)
  // 16:9: el motor apoya la ventana en la banda en los primeros planos (captionPin); aquí solo se limita x
  const frame = (zoom: number, p: [number, number]): [number, number] => (banded ? p : [frameH(zoom, p)[0], p[1]])

  const dirs = ['right', 'down', 'left', 'up'] as const
  const clips: Clip[] = SCENES.map((s, i): Clip => {
    const src = fromFilm(s.filmT)
    const dur = +(s.to - s.from).toFixed(4)
    const k = shot(s)
    const camera: CameraKey[] = []
    if (i === 0) {
      // durante el gesto losa → ventana la cámara no se mueve (la ventana entera); después UN solo movimiento al encuadre
      const settle = +(HOOK_END - s.from).toFixed(4)
      camera.push({ t: 0, zoom: banded ? 1 : 'fit' }, { t: settle, zoom: banded ? 1 : 'fit' })
      camera.push({ t: dur, zoom: k.zoom, focus: frame(k.zoom, k.focus) })
    } else {
      // quieta durante la pincelada; luego un empuje lento (o un paneo) hasta el final de la escena
      camera.push({ t: 0, zoom: k.zoom, focus: frame(k.zoom, k.focus) }, { t: +BEAT.toFixed(4), zoom: k.zoom, focus: frame(k.zoom, k.focus) })
      const z2 = +(k.zoom * 1.03).toFixed(3)
      camera.push({ t: dur, zoom: z2, focus: frame(z2, k.panTo ?? k.focus) })
    }
    return { take: src.take, start: s.from, dur, from: src.from, camera, ...(i === 0 ? {} : i === 1 ? { enter: { kind: 'content' as const, dur: 0.25 } } : { enter: { kind: 'brush' as const, dur: +(2 * BEAT).toFixed(4), dir: dirs[i % 4], seed: i } }) }
  })

  // rótulos pintados: grandes, en el papel. 16:9: banda de abajo · vertical: y ≈ 375 · cuadrado: banda de arriba.
  // La pincelada cae en el tiempo fuerte; el rótulo empieza a escribirse en el pulso 2 (no los dos a la vez).
  const where = (): Partial<Title> => (vertical ? { at: [0.5, 0.195] } : square ? { band: 'top' } : { at: [0.5, 0.93] })
  const capAt = (start: number, end: number, text: string): Title => ({
    start, dur: +(end - start).toFixed(4), text, style: 'paint', gesture: 'brush', stagger: 0.1, ...(/\*/.test(text) ? { underline: {} } : {}), ...where()
  })
  const titles: Title[] = [
    // el gancho, desde el primer fotograma
    { ...capAt(0, V(3), 'Got an *exam*?'), instant: true },
    capAt(V(3, 3), V(5), 'Aula builds the *course*.'),
    { ...capAt(V(5, 3), V(7), 'Get it wrong. Know *why*.'), ...(vertical ? { size: 66 } : {}) },
    capAt(V(7, 3), V(9), 'Practice that *sticks*.'),
    capAt(V(9, 3), V(12), 'Just talk to *Aula*.'),
    capAt(V(12, 3), V(14, 3), 'Study *anything*.'),
    // el cierre: «Free & open source.» a tamaño de rótulo y la dirección con tiempo para una captura de pantalla
    {
      start: V(15), dur: +(G.duration - V(15)).toFixed(4), text: 'Free & *open source*.', style: 'paint', gesture: 'brush', stagger: 0.1, underline: {},
      at: vertical ? [0.5, 0.64] : square ? [0.5, 0.72] : [0.5, 0.76]
    },
    {
      start: V(15, 3), dur: +(G.duration - V(15, 3)).toFixed(4), text: 'github.com/luumlabs/aula', style: 'paint', gesture: 'brush', stagger: 0.06,
      at: vertical ? [0.5, 0.7] : square ? [0.5, 0.85] : [0.5, 0.89], ...(square ? { size: 66 } : vertical ? { size: 70 } : {})
    }
  ]

  // adornos de pintura en los tiempos fuertes (con mesura), siempre en el papel
  const paint = [
    { t: V(3), kind: 'splash' as const, at: (vertical ? [0.86, 0.1] : [0.9, 0.12]) as [number, number], seed: 1 },
    { t: V(6), kind: 'stroke' as const, at: [0.06, 0.82] as [number, number], to: [0.22, 0.78] as [number, number], seed: 2 },
    { t: V(9), kind: 'splash' as const, at: (vertical ? [0.12, 0.1] : [0.08, 0.14]) as [number, number], seed: 3 },
    { t: V(12), kind: 'splash' as const, at: (vertical ? [0.88, 0.9] : [0.92, 0.86]) as [number, number], seed: 4 }
  ]

  // papel: noche durante el chat; el motor cambia el papel DENTRO de la pincelada (sin fundido)
  const paper = [
    { t: 0, color: '#F6EFE4' },
    { t: V(9) - 0.01, color: '#F6EFE4' }, { t: +(V(9) + 2 * BEAT).toFixed(4), color: '#15110F' },
    { t: V(12) - 0.01, color: '#15110F' }, { t: +(V(12) + 2 * BEAT).toFixed(4), color: '#F6EFE4' }
  ]

  const iconSize = vertical ? 680 : square ? 650 : 560
  return defineMontage({
    name: vertical ? 'aula-short-vertical' : square ? 'aula-short-square' : 'aula-short',
    fps: Number(process.env.AULA_VIDEO_FPS ?? 60),
    size,
    maxMB: 30,
    minTitle: 1.2,
    theme: 'light',
    duration: +G.duration.toFixed(2),
    takes: { morning: film.takes.morning, main: film.takes.main },
    clips,
    titles,
    paper,
    cursor: 'sun',
    drift: 0,
    cameraEase: 'smooth',
    ...(bands ? { bands } : { captionBand: BAND, captionPin: true }),
    ...(vertical ? { safe: { top: 220, bottom: 480, right: 140 } } : {}),
    paint,
    // el gancho: el arco grande ya medio pintado en el primer fotograma, se acaba de pintar, sale el sol y la losa se hace
    // ventana hacia 1,5 s
    prologue: {
      start: -0.6, end: HOOK_END, size: iconSize, draw: [-0.45, 0.6], rise: [0.6, V(1, 1, 0.5)], fadeIn: 0, grow: 0.96, morph: 2 * BEAT,
      ...(vertical ? { at: [0.5, 0.52] as [number, number] } : square ? { at: [0.5, 0.55] as [number, number] } : { at: [0.5, 0.45] as [number, number] })
    },
    // el cierre (más corto): la ventana vuelve al icono, «Aula» y la plataforma; luego el rótulo y la dirección
    finale: {
      start: V(14, 3), dur: 2 * BAR, morph: 2 * BEAT, rise: [V(15), V(15, 2)], sunFrom: 'cursor', title: 'Aula', sub: 'macOS · Windows · Linux',
      size: vertical ? 520 : square ? 300 : 340, ...(vertical ? { at: [0.5, 0.36] as [number, number] } : square ? { at: [0.5, 0.33] as [number, number] } : { at: [0.5, 0.33] as [number, number] })
    },
    notices: [],
    pixelSfx: [],
    music: {
      track: { grid: grid as GridJson, cuts: CUTS, start: START },
      bpm: G.bpm, root: 62, seed: 2026,
      chords: ['D', 'A', 'Bm', 'G'],
      sections: [{ bar: 1, style: 'day', light: 0.9 }, { bar: 14, style: 'end' }],
      cues: [{ t: V(15), kind: 'end' }],
      clicks: -22,
      sfx: -24
    },
    outputs: []
  })
}

export { BAR, BEAT, G, V }
