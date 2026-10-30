// V5 · la hoja de efectos: todo lo que se mueve en el montaje, con su instante, tipo, intensidad y paneo, para que SOUND
// le ponga sonido (y la banda sonora sus secciones y su rejilla). Pura: la escribe render.ts en work/<montaje>/cuesheet.json.
import { clickCues } from './cues.ts'
import { bpmGrid } from './grid.ts'
import { titleWordInfo, underlineTime, wordTimes } from './v5.ts'
import type { CueType, Montage, Section } from './types.ts'
import { clipLocalOf } from './ramp.ts'
import { DRAW_DUR, drawPlan, drawingPlace, drawingStrokes, type PieceLike } from './draw.ts'

export interface Cue {
  t: number
  type: CueType
  /** 0…1 */
  intensity: number
  /** −1 (izquierda) … 1 (derecha) */
  pan: number
  note?: string
  /** `word`/`underline`: estilo del rótulo (type, keynote, paint, caption…). */
  style?: string
  /** `word`: si es la palabra en cursiva (la clave, en ladrillo). */
  italic?: boolean
  /** Lo que dura el gesto (s): los movimientos del portátil y los trazos de pincel. */
  dur?: number
  /** `brush`: el primer trazo y el final de un dibujo (la banda del v3 les pone un destello de marimba). */
  accent?: boolean
}

export interface CueSheet {
  name: string
  duration: number
  fps: number
  bpm: number
  /** Segundo del primer tiempo fuerte. */
  offset: number
  beat: number
  bar: number
  sections: Section[]
  events: Cue[]
}

/** Opciones que dan las tomas capturadas: dónde está el cursor (px del vídeo) en cada instante, para el paneo. */
export interface CueOptions {
  cursorX?: (t: number) => number | null
  /** Las piezas del dibujo de un personaje (del pintor de la app), para los trazos de `montage.drawings`. */
  drawingPieces?: (who: string, tone?: number) => PieceLike[]
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const r3 = (v: number) => +v.toFixed(3)

/** Intensidad del «whoosh» de cada entrada de plano. */
const ENTER: Record<string, number> = { cut: 0.35, fade: 0.3, content: 0.25, match: 0.6, theme: 0.5, focus: 0.55, light: 0.85, shape: 0.7, icon: 0.7, brush: 0.8, rise: 0.5, iris: 0.6, door: 0.7, sunrise: 0.6 }

export function cueSheet5(m: Montage, opts: CueOptions = {}): CueSheet {
  const [W] = m.size
  const bpm = m.music?.bpm ?? 100
  const offset = m.music?.offset ?? 0
  const g = bpmGrid(bpm, m.duration, offset)
  const ev: Cue[] = []
  const panX = (x: number | null | undefined) => (x === null || x === undefined ? 0 : r3(clamp((x / W) * 2 - 1, -1, 1)))
  const push = (c: Cue) => {
    if (c.t >= 0 && c.t <= m.duration) ev.push({ ...c, t: r3(c.t), intensity: r3(clamp(c.intensity, 0, 1)) })
  }
  // clics de las tomas
  for (const c of clickCues(m)) push({ t: c.t, type: 'click', intensity: c.kind === 'key' ? 0.4 : 0.6, pan: panX(opts.cursorX?.(c.t)) })
  // escribir: un tic por carácter (como lo teclea el capturador, 14 por segundo por defecto)
  for (const c of m.clips)
    for (const a of m.takes[c.take]?.actions ?? []) {
      if (a.do !== 'type') continue
      const cps = a.cps ?? 14
      for (let i = 0; i < a.text.length; i++) {
        const t = c.start + clipLocalOf(c, a.at + i / cps)
        if (t >= c.start && t < c.start + c.dur && a.text[i] !== ' ') push({ t, type: 'type', intensity: 0.3, pan: panX(opts.cursorX?.(t)) })
      }
    }
  // entradas de plano: «whoosh» proporcional al gesto; las de luz, además, su barrido
  const sorted = [...m.clips].sort((a, b) => a.start - b.start)
  sorted.forEach((c, i) => {
    if (i === 0 && !c.enter) return
    const kind = c.enter?.kind ?? 'cut'
    const side = c.layout?.kind === 'keynote' ? (c.layout.side === 'right' ? 0.4 : -0.4) : 0
    push({ t: c.start, type: 'whoosh', intensity: ENTER[kind] ?? 0.4, pan: side, note: kind })
    if (kind === 'light') push({ t: c.start, type: 'light', intensity: 0.9, pan: 0, note: c.enter?.style ?? 'dusk' })
  })
  // movimientos de cámara dentro de un plano: un «whoosh» suave al empezar cada uno, según cuánto se mueve
  for (const c of sorted) {
    const keys = c.camera ?? []
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1]
      const b = keys[i]
      const za = typeof a.zoom === 'number' ? a.zoom : 1
      const zb = typeof b.zoom === 'number' ? b.zoom : 1
      const moved = Math.abs(Math.log(zb / za)) * 2 + (Array.isArray(a.focus) && Array.isArray(b.focus) ? Math.hypot(b.focus[0] - a.focus[0], b.focus[1] - a.focus[1]) / 600 : 0)
      if (moved > 0.08) push({ t: c.start + a.t, type: 'whoosh', intensity: Math.min(0.6, 0.15 + moved * 0.5), pan: 0, note: 'camera' })
    }
  }
  // V6 · el portátil: la tapa que se abre y cada movimiento grande de cámara (empujón, vuelta, giro), con lo que dura
  if (m.laptop) {
    const ks = [...m.laptop.keys].sort((a, b) => a.t - b.t)
    const lid = ks.filter((k) => k.lid !== undefined)
    for (let i = 1; i < lid.length; i++) {
      const [a, b] = [lid[i - 1], lid[i]]
      if (Math.abs(b.lid! - a.lid!) > 30) push({ t: a.t, type: 'whoosh', intensity: 0.4, pan: 0, note: b.lid! > a.lid! ? 'lid open' : 'lid close', dur: r3(b.t - a.t) })
    }
    const far = (k: (typeof ks)[number]) => (k.fill !== undefined ? 'screen' : k.frame !== undefined || k.dist !== undefined ? 'room' : null)
    const moves = ks.filter((k) => far(k) && k.t >= 0)
    for (let i = 1; i < moves.length; i++) {
      const [a, b] = [moves[i - 1], moves[i]]
      const yaw = Math.abs((b.yaw ?? 0) - (a.yaw ?? 0))
      // una órbita lenta no suena: solo los empujones, las vueltas y los giros rápidos
      if (far(a) === far(b) && (yaw < 12 || yaw / Math.max(0.1, b.t - a.t) < 8)) continue
      const note = far(a) === 'room' && far(b) === 'screen' ? 'push' : far(a) === 'screen' && far(b) === 'room' ? 'pull' : 'camera'
      push({ t: a.t, type: 'whoosh', intensity: note === 'camera' ? 0.35 : 0.55, pan: 0, note: 'camera', dur: r3(b.t - a.t), style: note })
    }
  }
  // V6 · personajes que se dibujan: un evento de pincel por trazo (contorno, aguada o detalle) y acentos al empezar y acabar
  for (const d of m.drawings ?? []) {
    const pieces = opts.drawingPieces?.(d.who, d.tone)
    if (!pieces?.length) continue
    const pan = r3(clamp((drawingPlace(m, d).x / W) * 2 - 1, -1, 1))
    for (const s of drawingStrokes(drawPlan(pieces, d.dur ?? DRAW_DUR), d)) {
      const intensity = s.phase === 'done' ? 0.6 : s.phase === 'outline' ? 0.45 : s.phase === 'fill' ? 0.3 : 0.25
      push({ t: s.t, type: 'brush', intensity, pan, note: s.phase, dur: r3(s.dur), accent: s.accent || undefined, style: d.who })
    }
  }
  // cada palabra de cada rótulo (con el paneo del lado en que está, su estilo y si es la de cursiva) y su subrayado
  for (const t of m.titles ?? []) {
    const words = titleWordInfo(t.text)
    const v5 = t.style === 'keynote' || t.style === 'type'
    const times = v5 ? wordTimes(t, m) : words.map((_, i) => t.start + i * (t.stagger ?? 0.16))
    const pan = t.style === 'keynote' ? (t.side === 'right' ? 0.45 : -0.45) : 0
    times.forEach((tt, i) => push({ t: tt, type: 'word', intensity: (t.style === 'type' ? 0.65 : 0.45) + (words[i].italic ? 0.1 : 0), pan, note: words[i].text, style: t.style, italic: words[i].italic }))
    const ut = v5 ? underlineTime(t, m) : null
    if (ut !== null && ut < t.start + t.dur) push({ t: ut, type: 'underline', intensity: 0.5, pan, note: words.find((w) => w.italic)?.text, style: t.style })
  }
  // cartelas de capítulo
  for (const c of m.chapters?.cards ?? []) push({ t: c.t, type: 'card', intensity: 0.9, pan: 0, note: `${String(c.n).padStart(2, '0')} · ${m.chapters!.names[c.n - 1] ?? ''}` })
  // destellos, icono del prólogo, logo del final
  for (const f of m.flashes ?? []) {
    push({ t: f - 1.2, type: 'rise', intensity: 0.8, pan: 0, note: 'riser to flash' })
    push({ t: f, type: 'flash', intensity: 1, pan: 0 })
  }
  if (m.prologue) push({ t: Math.max(0, m.prologue.rise[0]), type: 'icon', intensity: 0.8, pan: 0, note: 'icon + sun rise' })
  if (m.finale) push({ t: m.finale.rise?.[0] ?? m.finale.start + m.finale.dur * 0.55, type: 'logo', intensity: 1, pan: 0 })
  // la ola de iconos: un golpe de arpegio por diagonal
  if (m.iconWave) {
    const steps = 10
    for (let k = 0; k < steps; k++) push({ t: m.iconWave.t + (k / steps) * (m.iconWave.dur ?? 1.2), type: 'icon', intensity: 0.35, pan: r3(-0.8 + (1.6 * k) / (steps - 1)), note: `wave ${k + 1}/${steps}` })
  }
  // lo que el montaje marca a mano
  for (const s of m.sfx ?? []) push({ t: s.t, type: s.type, intensity: s.intensity ?? 0.7, pan: s.pan ?? 0, note: s.note })
  ev.sort((a, b) => a.t - b.t || a.type.localeCompare(b.type))
  return { name: m.name, duration: m.duration, fps: m.fps, bpm, offset, beat: r3(g.beat), bar: r3(g.barDur), sections: m.sections ?? [], events: ev }
}
