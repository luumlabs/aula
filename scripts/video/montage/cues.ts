// La cinta de cues del montaje (cortes, clics, titulares, música), en segundos del vídeo. La usan render.ts (cues.json)
// y la página del compositor (los «tic» de los clics en la música).
import type { Montage, TakeMeta } from './types.ts'

export interface ClickCue {
  t: number
  take: string
  kind: 'click' | 'drag' | 'key'
  target: unknown
}

/** Momentos de pulsación visibles en el vídeo (el clic cae al final del movimiento del cursor). */
export function clickCues(m: Montage): ClickCue[] {
  const out: ClickCue[] = []
  for (const c of m.clips) {
    for (const a of m.takes[c.take]?.actions ?? []) {
      if (a.do !== 'click' && a.do !== 'drag' && a.do !== 'key') continue
      const press = a.do === 'click' ? (a.dur ?? 0.7) : a.do === 'drag' ? 0.1 : 0
      const t = c.start + a.at - (c.from ?? 0) + press
      if (t >= c.start && t < c.start + c.dur) out.push({ t: +t.toFixed(3), take: c.take, kind: a.do, target: a.do === 'click' ? a.to : a.do === 'drag' ? [a.from, a.to] : a.key })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

export function cueSheet(m: Montage, takes: Record<string, TakeMeta> = {}): unknown {
  const beat = m.music ? 60 / m.music.bpm : null
  const onBeat = (t: number) => (beat ? +(((t / beat) % 1) * beat * m.fps).toFixed(1) : null)
  return {
    name: m.name,
    fps: m.fps,
    duration: m.duration,
    bpm: m.music?.bpm,
    note: 'offBeatFrames = fotogramas de desfase respecto a la negra anterior',
    cuts: m.clips.map((c) => ({ t: c.start, end: +(c.start + c.dur).toFixed(3), take: c.take, enter: c.enter ?? { kind: 'cut', dur: 0 }, offBeatFrames: onBeat(c.start) })),
    clicks: clickCues(m).map((c) => ({ ...c, offBeatFrames: onBeat(c.t) })),
    titles: (m.titles ?? []).map((t) => ({ t: t.start, end: +(t.start + t.dur).toFixed(3), text: t.text, style: t.style, offBeatFrames: onBeat(t.start) })),
    music: m.music?.cues ?? [],
    pixel: pixelCues(m, takes)
  }
}

export interface PixelCue {
  t: number
  story: string
  clip: 'hover' | 'celebrate' | 'idle'
}

/** Historias pixel art que se ven en el vídeo: las que registró cada toma (en su tramo visible) y las puestas a mano. */
export function pixelCues(m: Montage, takes: Record<string, TakeMeta>): PixelCue[] {
  const out: PixelCue[] = []
  for (const c of m.clips) {
    const meta = takes[c.take]
    for (const ev of meta?.pixel ?? []) {
      const t = c.start + ev.frame / meta.fps - (c.from ?? 0)
      if (t >= c.start && t < c.start + c.dur && (ev.clip === 'hover' || ev.clip === 'celebrate' || ev.clip === 'idle')) out.push({ t: +t.toFixed(4), story: ev.story, clip: ev.clip })
    }
  }
  // las puestas a mano no se suman a una que la toma ya registró (misma historia, ±0,3 s)
  for (const p of m.pixelSfx ?? []) if (!out.some((o) => o.story === p.story && Math.abs(o.t - p.t) < 0.3)) out.push({ t: p.t, story: p.story, clip: p.clip ?? 'hover' })
  return out.sort((a, b) => a.t - b.t)
}
