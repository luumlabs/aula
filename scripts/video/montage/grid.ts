// La rejilla de la película: compases y pulsos de la pista real, después de quitar secciones enteras (`cuts`, en compases
// de la pista). Puro: lo usan el montaje (tiempos por compás y pulso), el compositor (qué trozos de la pista suenan) y
// las pruebas. Como se quitan compases enteros y el tempo es constante, el compás k del vídeo empieza siempre en
// downbeat + (k − 1) · compás; lo que cambia es qué compás de la pista suena en él.

/** La rejilla analizada de la pista (scripts/video/music/<pista>.grid.json, sin audio). */
export interface GridJson {
  track: string
  bpm: number
  beat: number
  beatsPerBar: number
  downbeat: number
  firstSound?: number
  lastSound?: number
  duration: number
  confidence: number
  sections: number[]
  bars: { bar: number; t: number; rmsDb: number; lowDb: number; novelty: number }[]
}

export interface Segment {
  /** Inicio en el vídeo (s). */
  video: number
  /** Tramo de la pista que suena [desde, hasta) (s). */
  from: number
  to: number
}

export interface FilmGrid {
  bpm: number
  beat: number
  barDur: number
  beatsPerBar: number
  /** Segundos del vídeo en el compás `bar` (1 = primer tiempo fuerte), pulso `beat` (1…4) y fracción de pulso. */
  V(bar: number, beat?: number, frac?: number): number
  /** El pulso fuerte más cercano a t (para encajar algo en la rejilla). */
  snap(t: number, to?: 'beat' | 'bar'): number
  /** Compás de la pista que suena en el compás `bar` del vídeo. */
  trackBar(bar: number): number
  /** Tiempo de la pista que suena en el instante t del vídeo. */
  toTrack(t: number): number
  /** Duración del vídeo con la música recortada: acaba `tail` s después de la última nota (no en el silencio del archivo). */
  duration: number
  /** Compases del VÍDEO donde empieza una sección de la música (los de la pista que siguen sonando tras los cortes). */
  sections: number[]
  segments: Segment[]
  /** Instantes del vídeo donde hay un corte de la pista. */
  cuts: number[]
  /** Compases del vídeo (1…) con la información del compás de la pista que suena. */
  bars: { bar: number; t: number; trackBar: number; rmsDb: number; lowDb: number; novelty: number }[]
}

/** `cuts`: compases de la pista que se quitan, como [desde, hasta) (p. ej. [[57, 65]] quita 8 compases; [1, 49) hace
 *  que el vídeo empiece en el compás 49).
 *  `start`: segundo de la pista en el que empieza el vídeo (p. ej. g.downbeat − un pulso, para saltar el silencio). */
export function filmGrid(g: GridJson, cuts: [number, number][] = [], start = 0, tail = 0.8): FilmGrid {
  const barDur = g.beat * g.beatsPerBar
  const tb = (b: number) => g.downbeat + (b - 1) * barDur
  if (start < 0 || start >= g.downbeat + barDur) throw new Error('start debe caer antes del final del compás 1')
  const sorted = [...cuts].sort((a, b) => a[0] - b[0])
  for (const [a, b] of sorted) {
    if (!(Number.isInteger(a) && Number.isInteger(b) && b > a && a >= 1)) throw new Error(`corte no válido [${a}, ${b}): compases enteros, desde el 1`)
  }
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) throw new Error('cortes solapados')
  // un corte desde el compás 1 ([1, b)) hace que el vídeo empiece en el compás b de la pista (con el mismo `start` antes
  // del tiempo fuerte): para una versión corta que arranca en lo más enérgico
  const lead = sorted[0]?.[0] === 1 ? sorted.shift()![1] - 1 : 0
  const segments: Segment[] = []
  let from = start + lead * barDur
  let video = 0
  for (const [a, b] of sorted) {
    const to = tb(a)
    segments.push({ video, from, to })
    video += to - from
    from = tb(b)
  }
  const end = Math.min(g.duration, (g.lastSound ?? g.duration) + tail)
  segments.push({ video, from, to: end })
  const duration = video + (end - from)
  const trackBar = (bar: number) => {
    let tbar = bar + lead
    for (const [a, b] of sorted) if (tbar >= a) tbar += b - a
    return tbar
  }
  const toTrack = (t: number) => {
    let seg = segments[0]
    for (const s of segments) if (t >= s.video) seg = s
    return seg.from + (t - seg.video)
  }
  const info = new Map(g.bars.map((b) => [b.bar, b]))
  const bars: FilmGrid['bars'] = []
  const d0 = g.downbeat - start
  for (let bar = 1; d0 + (bar - 1) * barDur < duration - 1e-6; bar++) {
    const src = info.get(trackBar(bar))
    bars.push({ bar, t: d0 + (bar - 1) * barDur, trackBar: trackBar(bar), rmsDb: src?.rmsDb ?? -120, lowDb: src?.lowDb ?? -120, novelty: src?.novelty ?? 0 })
  }
  return {
    bpm: g.bpm,
    beat: g.beat,
    barDur,
    beatsPerBar: g.beatsPerBar,
    V: (bar, beat = 1, frac = 0) => d0 + (bar - 1) * barDur + (beat - 1 + frac) * g.beat,
    snap: (t, to = 'beat') => {
      const unit = to === 'bar' ? barDur : g.beat
      return d0 + Math.round((t - d0) / unit) * unit
    },
    trackBar,
    toTrack,
    duration,
    segments,
    cuts: segments.slice(1).map((s) => s.video),
    bars,
    sections: bars.filter((b) => g.sections.includes(b.trackBar) && (b.bar === 1 || bars[b.bar - 2].trackBar === b.trackBar - 1)).map((b) => b.bar)
  }
}

/** Cortes para una versión corta: `bars` compases desde el compás `from` de la pista y, sin saltos de frase, el final
 *  real del tema desde el compás `ending` (hasta su última nota). Con `filmGrid(g, shortCuts(…), g.downbeat − g.beat)`. */
export function shortCuts(from: number, bars: number, ending: number): [number, number][] {
  if (from < 2 || bars < 1 || from + bars > ending) throw new Error('shortCuts: tramo no válido')
  return from + bars === ending ? [[1, from]] : [[1, from], [from + bars, ending]]
}
