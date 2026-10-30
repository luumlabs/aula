// La hoja de efectos (cue sheet) de la banda sonora: tipos, validación y la rejilla de compases. Pura: la usan el
// generador, las pruebas y quien la exporte desde el montaje. Formato v1, acordado en scratchpad/aula2/coord.md.

export type SectionKind = 'intro' | 'drop' | 'day' | 'night' | 'card' | 'rise' | 'end' | 'break'
export const SECTION_KINDS: SectionKind[] = ['intro', 'drop', 'day', 'night', 'card', 'rise', 'end', 'break']

export type EventType = 'click' | 'whoosh' | 'word' | 'underline' | 'card' | 'light' | 'rise' | 'impact' | 'flash' | 'arp' | 'icon' | 'keys' | 'type' | 'count' | 'logo'
export const EVENT_TYPES: EventType[] = ['click', 'whoosh', 'word', 'underline', 'card', 'light', 'rise', 'impact', 'flash', 'arp', 'icon', 'keys', 'type', 'count', 'logo']

export interface SheetSection {
  /** Compás donde empieza (1 = el del `downbeat`). */
  bar: number
  kind: SectionKind
  /** Un acorde por compás en cifrado («D», «A/C#», «Bm7»…); si falta, la progresión de su carácter. */
  chords?: string[]
  /** 0–1: densidad e intensidad del arreglo (por defecto, la de su carácter). */
  energy?: number
}

export interface SheetEvent {
  /** Segundos del vídeo: el INICIO de lo que se ve (la pulsación, la palabra que aparece, el movimiento que empieza…). */
  t: number
  type: EventType
  /** 0–1 (por defecto 0,7). */
  intensity?: number
  /** −1 (izquierda) … 1 (derecha). Por defecto 0. */
  pan?: number
  /** Duración de lo que se ve (whoosh, light, rise, arp, keys, count). */
  dur?: number
  /** whoosh: 0–1, fracción del cuadro que recorre o cuánto cambia de escala. */
  size?: number
  /** whoosh: fracción de `dur` donde el movimiento va más rápido (0,5; 0,25 con la curva 'out'). */
  peak?: number
  /** whoosh: hacia dónde va el movimiento (−1 izquierda, 1 derecha); el aire cruza el estéreo. */
  dir?: number
  /** word: índice de la palabra en su rótulo (las notas suben por la escala). */
  i?: number
  /** arp, keys, count: cuántas notas, pulsaciones o ticks. card: número del capítulo. */
  n?: number
  /** card: cartela en tema oscuro. */
  dark?: boolean
  /** light: a qué luz se va. */
  to?: 'dark' | 'light'
  /** Texto libre (para el informe). */
  label?: string
}

export interface CueSheet {
  version: 1
  name?: string
  /** Duración del WAV (s): la del vídeo. */
  duration: number
  bpm: number
  beatsPerBar?: number
  /** Segundos del vídeo donde empieza el compás 1 (por defecto 0). Lo anterior es anacrusa (cuenta como intro). */
  downbeat?: number
  /** Tónica: «D», «C#», «Bb»… (mayor). Por defecto «D», como el v3. */
  key?: string
  /** 'film' (la película, ~100–108 BPM) o 'short' (redes, ~120 BPM, batería con más pulso). */
  mode?: 'film' | 'short'
  seed?: number
  sections: SheetSection[]
  events: SheetEvent[]
}

/** Hoja ya validada y con los valores por defecto puestos. */
export interface Sheet {
  name: string
  duration: number
  bpm: number
  beatsPerBar: number
  downbeat: number
  key: number
  mode: 'film' | 'short'
  seed: number
  sections: (SheetSection & { energy: number })[]
  events: (SheetEvent & { intensity: number; pan: number; dur: number })[]
  beat: number
  bar: number
  bars: number
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function keyPitch(key: string): number {
  const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(key.trim())
  if (!m) throw new Error(`tonalidad no válida: «${key}» (usa «D», «F#», «Bb»…)`)
  let p = PITCH[m[1].toUpperCase()]
  if (m[2] === '#' || m[2] === '♯') p++
  if (m[2] === 'b' || m[2] === '♭') p--
  return (p + 12) % 12
}

const DEFAULT_ENERGY: Record<SectionKind, number> = { intro: 0.45, drop: 1, day: 0.8, night: 0.65, card: 0.35, rise: 0.9, end: 0.7, break: 0.3 }

function fail(msg: string): never {
  throw new Error(`hoja de efectos: ${msg}`)
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Valida una hoja (JSON ya leído) y pone los valores por defecto. Los errores dicen qué campo y qué evento. Acepta
 *  también la hoja que exporta el montaje (cueSheet5 en montage/cuesheet.ts) y la traduce (`fromMontage`). */
export function parseSheet(raw: unknown): Sheet {
  if (!raw || typeof raw !== 'object') fail('no es un objeto')
  if (isMontageSheet(raw)) raw = fromMontage(raw)
  const s = raw as Partial<CueSheet>
  if (s.version !== 1) fail(`version debe ser 1 (es ${String(s.version)})`)
  if (!num(s.duration) || s.duration <= 0 || s.duration > 900) fail('duration (s) debe estar entre 0 y 900')
  if (!num(s.bpm) || s.bpm < 50 || s.bpm > 200) fail('bpm debe estar entre 50 y 200')
  const beatsPerBar = s.beatsPerBar ?? 4
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 2 || beatsPerBar > 7) fail('beatsPerBar debe ser un entero entre 2 y 7')
  const downbeat = s.downbeat ?? 0
  if (!num(downbeat) || downbeat < 0 || downbeat > s.duration) fail('downbeat (s) fuera del vídeo')
  const mode = s.mode ?? 'film'
  if (mode !== 'film' && mode !== 'short') fail(`mode «${String(mode)}» no válido ('film' o 'short')`)
  const beat = 60 / s.bpm
  const bar = beat * beatsPerBar
  const bars = Math.ceil((s.duration - downbeat) / bar - 1e-9)
  if (!Array.isArray(s.sections) || !s.sections.length) fail('sections: hace falta al menos una sección')
  const sections = [...s.sections].map((x, k) => {
    if (!x || !Number.isInteger(x.bar) || x.bar < 1) fail(`sections[${k}].bar debe ser un entero ≥ 1`)
    if (!SECTION_KINDS.includes(x.kind)) fail(`sections[${k}].kind «${String(x.kind)}» no válido (${SECTION_KINDS.join(', ')})`)
    if (x.energy !== undefined && (!num(x.energy) || x.energy < 0 || x.energy > 1)) fail(`sections[${k}].energy debe estar en 0–1`)
    if (x.chords !== undefined && (!Array.isArray(x.chords) || x.chords.some((c) => typeof c !== 'string'))) fail(`sections[${k}].chords debe ser una lista de cifrados`)
    return { ...x, energy: x.energy ?? DEFAULT_ENERGY[x.kind] }
  })
  sections.sort((a, b) => a.bar - b.bar)
  for (let k = 1; k < sections.length; k++) if (sections[k].bar === sections[k - 1].bar) fail(`dos secciones empiezan en el compás ${sections[k].bar}`)
  if (!Array.isArray(s.events)) fail('events debe ser una lista (puede estar vacía)')
  const events = s.events.map((e, k) => {
    const where = `events[${k}] (${(e as SheetEvent)?.type ?? '?'} @ ${(e as SheetEvent)?.t ?? '?'})`
    if (!e || !num(e.t)) fail(`${where}: t (s) no es un número`)
    if (!EVENT_TYPES.includes(e.type)) fail(`${where}: type no válido (${EVENT_TYPES.join(', ')})`)
    if (e.t < -0.5 || e.t > s.duration!) fail(`${where}: fuera del vídeo (0–${s.duration})`)
    if (e.intensity !== undefined && (!num(e.intensity) || e.intensity < 0 || e.intensity > 1)) fail(`${where}: intensity debe estar en 0–1`)
    if (e.pan !== undefined && (!num(e.pan) || e.pan < -1 || e.pan > 1)) fail(`${where}: pan debe estar en −1…1`)
    if (e.dur !== undefined && (!num(e.dur) || e.dur < 0 || e.dur > 30)) fail(`${where}: dur (s) debe estar en 0–30`)
    if (e.size !== undefined && (!num(e.size) || e.size < 0 || e.size > 1)) fail(`${where}: size debe estar en 0–1`)
    if (e.peak !== undefined && (!num(e.peak) || e.peak < 0 || e.peak > 1)) fail(`${where}: peak debe estar en 0–1`)
    if (e.n !== undefined && (!Number.isInteger(e.n) || e.n < 0 || e.n > 400)) fail(`${where}: n debe ser un entero 0–400`)
    if (e.type === 'light' && e.to !== 'dark' && e.to !== 'light') fail(`${where}: light necesita to: 'dark' | 'light'`)
    const needsDur = e.type === 'light' || e.type === 'rise' || e.type === 'arp' || e.type === 'keys' || e.type === 'count'
    if (needsDur && !(num(e.dur) && e.dur > 0)) fail(`${where}: necesita dur > 0`)
    return { ...e, intensity: e.intensity ?? 0.7, pan: e.pan ?? 0, dur: e.dur ?? 0 }
  })
  events.sort((a, b) => a.t - b.t)
  return {
    name: s.name ?? 'soundtrack',
    duration: s.duration,
    bpm: s.bpm,
    beatsPerBar,
    downbeat,
    key: keyPitch(s.key ?? 'D'),
    mode,
    seed: s.seed ?? 7,
    sections,
    events,
    beat,
    bar,
    bars
  }
}

/** Segundos del inicio del compás `b` (1…), pulso `beat` (1…) y fracción. */
export function barTime(s: Pick<Sheet, 'downbeat' | 'bar' | 'beat'>, b: number, beat = 1, frac = 0): number {
  return s.downbeat + (b - 1) * s.bar + (beat - 1 + frac) * s.beat
}

/** Compás (1…) que suena en t (lo anterior al compás 1 da 0). */
export function barAt(s: Pick<Sheet, 'downbeat' | 'bar'>, t: number): number {
  return t < s.downbeat ? 0 : Math.floor((t - s.downbeat) / s.bar + 1e-9) + 1
}

/** La sección que manda en el compás b (antes de la primera: la primera). */
export function sectionAt(s: Pick<Sheet, 'sections'>, b: number): Sheet['sections'][number] {
  let cur = s.sections[0]
  for (const x of s.sections) if (x.bar <= b) cur = x
  return cur
}

/** Ventana de encaje a tempo: un sonido puede adelantarse como mucho 30 ms o retrasarse 60 ms respecto a la imagen
 *  (dentro de lo que no se nota según EBU R37: −40 / +60 ms). */
export const SNAP_EARLY = 0.03
export const SNAP_LATE = 0.06

/** Encaja t en la semicorchea más cercana si cae dentro de la ventana; si no, lo deja donde está. */
export function snap16(s: Pick<Sheet, 'downbeat' | 'beat'>, t: number): number {
  const unit = s.beat / 4
  const g = s.downbeat + Math.round((t - s.downbeat) / unit) * unit
  const d = g - t
  return d >= -SNAP_EARLY && d <= SNAP_LATE ? g : t
}

// ───────────── la hoja del montaje (work/<montaje>/cuesheet.json, de montage/cuesheet.ts) ─────────────

export interface MontageSheet {
  name?: string
  duration: number
  bpm: number
  /** Segundo del primer tiempo fuerte. */
  offset?: number
  sections: { t: number; name?: string; mood: string }[]
  events: { t: number; type: string; intensity?: number; pan?: number; note?: string; dur?: number; size?: number; n?: number; to?: 'dark' | 'light'; peak?: number; style?: string; italic?: boolean; emph?: boolean }[]
}

export function isMontageSheet(raw: unknown): raw is MontageSheet {
  const r = raw as Partial<MontageSheet> & { version?: unknown }
  return r.version === undefined && typeof r.bpm === 'number' && Array.isArray(r.sections) && Array.isArray(r.events) && r.sections.every((x) => typeof x?.mood === 'string')
}

const MOOD: Record<string, SectionKind> = { intro: 'intro', drop: 'drop', day: 'day', night: 'night', build: 'rise', outro: 'end', card: 'card', break: 'break' }

/** Traduce la hoja del montaje a la v1: moods → carácter de sección (build = subida, outro = final), cada cartela
 *  convierte su compás en compás de cartela, y a los eventos sin duración se les da la que pide su gesto. */
export function fromMontage(m: MontageSheet): CueSheet {
  const beat = 60 / m.bpm
  const bar = beat * 4
  const off = m.offset ?? 0
  // el compás que empieza en t (un poco antes o después por el redondeo a milésimas)
  const barOf = (t: number) => Math.floor((t - off) / bar + 0.02) + 1
  // una sección que empieza a mitad de compás manda desde el compás siguiente (el drop del compás 2 no lo pisa un
  // «day» que empieza en su tercer pulso)
  const sectionBar = (t: number) => {
    const b = barOf(t)
    return t - (off + (b - 1) * bar) > 0.1 * bar ? b + 1 : b
  }
  const byBar = new Map<number, SectionKind>()
  for (const s of [...m.sections].sort((a, b) => a.t - b.t)) {
    const b = Math.max(1, sectionBar(s.t))
    if (!byBar.has(b)) byBar.set(b, MOOD[s.mood] ?? 'day')
  }
  if (!byBar.size) byBar.set(1, 'day')
  const kindAt = (b: number) => {
    let k: SectionKind = 'day'
    for (const [x, v] of [...byBar].sort((p, q) => p[0] - q[0])) if (x <= b) k = v
    return k
  }
  // cartelas: su compás pasa a ser de cartela y el siguiente vuelve al mood que tocaba
  const cards = m.events.filter((e) => e.type === 'card').map((e) => barOf(e.t))
  const moods = new Map(byBar)
  for (const b of cards) {
    const after = kindAt(b + 1)
    moods.set(b, 'card')
    if (!byBar.has(b + 1)) moods.set(b + 1, after === 'card' ? 'day' : after)
  }
  const sections: SheetSection[] = [...moods].sort((a, b) => a[0] - b[0]).map(([b, kind]) => ({ bar: b, kind }))
  const moodAfter = (t: number) => {
    const b = barOf(t) + 1
    let k: SectionKind = 'day'
    for (const s of sections) if (s.bar <= b && s.kind !== 'card') k = s.kind
    return k
  }
  const strong = m.events.filter((e) => e.type === 'impact' || e.type === 'flash' || e.type === 'logo').map((e) => e.t)
  const drops = sections.filter((s) => s.kind === 'drop' || s.kind === 'end').map((s) => off + (s.bar - 1) * bar)
  const events: SheetEvent[] = []
  // palabras: un tic por palabra solo en los rótulos a pantalla completa (style 'type'); en los demás (keynote), un
  // único acento cuando empieza el subrayado de la cursiva (el evento 'underline' del montaje, con su instante exacto;
  // el de un rótulo 'type' no suena: sus palabras ya llevan tic). Las hojas viejas sin estilo ni subrayado se adivinan:
  // intensidad ≥ 0,6 = 'type', y el subrayado empieza 0,46 s después de la última palabra.
  const hasUnderline = m.events.some((e) => e.type === 'underline')
  const isType = (e: MontageSheet['events'][number]) => (e.style ? e.style === 'type' : (e.intensity ?? 0) >= 0.6)
  let group: MontageSheet['events'] = []
  const flush = () => {
    if (group.length && !hasUnderline) {
      const last = group[group.length - 1]
      const emph = group.find((w) => w.italic || w.emph) ?? last
      events.push({ t: +(last.t + 0.46).toFixed(4), type: 'underline', intensity: 0.6, pan: last.pan, label: emph.note })
    }
    group = []
  }
  for (const e of m.events.filter((x) => x.type === 'word' && !isType(x)).sort((a, b) => a.t - b.t)) {
    if (group.length && e.t - group[group.length - 1].t > 0.6) flush()
    group.push(e)
  }
  flush()
  const lightAt = (t: number) => m.events.some((x) => x.type === 'light' && Math.abs(x.t - t) < 0.05)
  for (const e of m.events) {
    const base = { t: e.t, intensity: e.intensity === undefined ? undefined : Math.max(0, Math.min(1, e.intensity)), pan: e.pan === undefined ? undefined : Math.max(-1, Math.min(1, e.pan)), label: e.note }
    switch (e.type) {
      case 'word':
        if (isType(e)) events.push({ ...base, type: 'word' })
        break
      case 'underline':
        if (e.style !== 'type') events.push({ ...base, type: 'underline' })
        break
      case 'click':
      case 'impact':
      case 'flash':
      case 'icon':
      case 'type':
      case 'logo':
        events.push({ ...base, type: e.type })
        break
      case 'whoosh': {
        // como el v3: los movimientos de cámara pequeños no suenan, y la entrada con luz la cubre su barrido
        if (e.note === 'camera' && (e.size ?? e.intensity ?? 0) < 0.45) break
        if (e.note === 'light' && lightAt(e.t)) break
        const cut = e.note === 'cut' || e.dur === 0
        events.push({ ...base, type: 'whoosh', dur: cut ? 0 : (e.dur ?? (e.note === 'camera' ? 0.6 : 0.5)), size: e.size ?? Math.max(0.15, Math.min(1, e.intensity ?? 0.4)), peak: e.peak })
        break
      }
      case 'card': {
        const n = Number(/^\s*(\d+)/.exec(e.note ?? '')?.[1])
        events.push({ ...base, type: 'card', n: Number.isFinite(n) ? n : undefined, dark: moodAfter(e.t) === 'night' })
        break
      }
      case 'light': {
        const to = e.to ?? (e.note === 'dusk' ? 'dark' : e.note === 'dawn' ? 'light' : moodAfter(e.t) === 'night' ? 'dark' : 'light')
        events.push({ ...base, type: 'light', dur: e.dur ?? 2 * beat, to })
        break
      }
      case 'rise': {
        const next = [...strong, ...drops].filter((x) => x > e.t + 0.1 && x <= e.t + 3).sort((a, b) => a - b)[0]
        events.push({ ...base, type: 'rise', dur: e.dur ?? (next !== undefined ? next - e.t : 1.2) })
        break
      }
      case 'count':
        events.push({ ...base, type: 'count', dur: e.dur ?? 1.0, n: e.n })
        break
      case 'arp':
      case 'keys':
        events.push({ ...base, type: e.type, dur: e.dur ?? 1.0, n: e.n })
        break
      default:
        // tipos que aún no conozco: no rompen la hoja
        break
    }
  }
  return {
    version: 1,
    name: m.name,
    duration: m.duration,
    bpm: m.bpm,
    downbeat: off,
    key: 'D',
    mode: m.bpm >= 114 || /short/i.test(m.name ?? '') ? 'short' : 'film',
    sections,
    events: thin(events.filter((e) => e.t <= m.duration), bar)
  }
}

/** Densidad como la del v3 (~28 instantes con efecto por minuto; el V5 tiene el doble de planos): se quedan todos los
 *  clics, cartelas, luces, golpes, iconos, conteos, teclas y el logo, y el aire de los planos se aclara.
 *  - Los empujones de cámara solo suenan si son grandes (size ≥ 0,6) y no caen con otra entrada.
 *  - El aire de una entrada (corte, rack focus, contenido…) que coincide con otro efecto se queda: es el mismo instante.
 *  - Si va solo, como mucho uno cada dos compases (salvo los grandes, size ≥ 0,6, y la coincidencia de forma). */
export function thin(events: SheetEvent[], bar: number): SheetEvent[] {
  const keep = new Set(['click', 'card', 'light', 'impact', 'flash', 'logo', 'icon', 'count', 'type', 'keys', 'arp', 'underline', 'rise'])
  const anchors = events.filter((e) => keep.has(e.type)).map((e) => e.t)
  const entries = events.filter((e) => e.type === 'whoosh' && e.label !== 'camera').map((e) => e.t)
  let lastAlone = -Infinity
  return events.filter((e) => {
    if (e.type !== 'whoosh') return true
    const big = (e.size ?? 0) >= 0.6
    if (e.label === 'camera') return big && !entries.some((t) => Math.abs(t - e.t) < 0.3)
    if (big || e.label === 'shape' || anchors.some((t) => Math.abs(t - e.t) < 0.15)) return true
    if (e.t - lastAlone < 2 * bar - 1e-3) return false
    lastAlone = e.t
    return true
  })
}
