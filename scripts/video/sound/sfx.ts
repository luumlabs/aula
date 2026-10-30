// Los efectos de la hoja: cada cosa que se mueve suena, afinada a la armonía de su compás y a tempo (se encaja en la
// semicorchea si cae a −30/+60 ms). También añade lo que la forma de canción pide aunque el montaje no lo marque: el golpe
// del drop, la subida que lleva a él, la campana de cada cartela y el logo del final.
import { chordTones, harmonyAt, safeScale, type BarHarmony } from './harmony.ts'
import { snap16, type EventType, type Sheet } from './sheet.ts'
import { bell, boom, brushStroke, crash, glock, hitTransient, keyTick, lightSweep, marimba, reverseSwell, riser, uiClick, whoosh, type Ctx, type WhooshStyle } from './voices.ts'
import { db, rng } from './dsp.ts'

export type ResolvedEvent = Sheet['events'][number] & { auto?: boolean }

/** Nivel de cada tipo de efecto (dB), calibrado para que todos se oigan sobre la música (ver analysis.ts: relación
 *  efecto/música en su banda) sin que las palabras, que son muchas, la tapen. */
export const TYPE_DB: Record<EventType, number> = { click: 3, whoosh: -2, word: -3, underline: -3, card: -1, light: -2, rise: -1, impact: 2, flash: -5, arp: 3, icon: 2, keys: 2, type: 2, count: 11, logo: 0 }

/** Lo que se colocó por cada evento (para el informe y las pruebas de tiempos). */
export interface Placement {
  type: EventType
  /** t de la hoja. */
  t: number
  /** Donde cae el golpe que se oye (s): el ataque, la cresta del aire o el final de la subida. */
  hit: number
  /** Desplazamiento por encaje a tempo (ms). */
  snapMs: number
  /** Intervalo que ocupa el sonido [desde, hasta] (s). */
  span: [number, number]
  /** Notas MIDI que suenan. */
  notes: number[]
  auto: boolean
  label?: string
}

/** Eventos que pide la forma de canción y el montaje no trae. */
export function autoEvents(sh: Sheet, H: BarHarmony[]): ResolvedEvent[] {
  const ev = sh.events
  const near = (types: EventType[], a: number, b: number) => ev.some((e) => types.includes(e.type) && e.t >= a && e.t <= b)
  const riseEndsAt = (t: number) => ev.some((e) => e.type === 'rise' && Math.abs(e.t + e.dur - t) < 0.12)
  const out: ResolvedEvent[] = []
  const add = (e: Omit<ResolvedEvent, 'intensity' | 'pan' | 'dur'> & Partial<ResolvedEvent>) => out.push({ intensity: 0.75, pan: 0, dur: 0, ...e, auto: true })
  for (const h of H) {
    if (h.pos !== 0 || h.t >= sh.duration) continue
    const prev = H[h.bar - 2]
    if (h.kind === 'drop') {
      if (!near(['impact', 'flash', 'logo'], h.t - 0.1, h.t + 0.15)) add({ t: h.t, type: 'impact', intensity: 0.85 })
      if (!riseEndsAt(h.t) && h.bar > 1) {
        const len = Math.min(sh.bar, (prev ? prev.len : 1) * sh.bar)
        add({ t: h.t - len, type: 'rise', dur: len, intensity: 0.7 })
      }
    }
    if (h.kind === 'end') {
      if (!near(['logo'], h.t - 0.15, h.t + sh.bar)) add({ t: h.t, type: 'logo', intensity: 0.9 })
      if (prev?.kind === 'rise' && !riseEndsAt(h.t)) {
        const len = Math.min(2 * sh.bar, prev.len * sh.bar)
        add({ t: h.t - len, type: 'rise', dur: len, intensity: 0.8 })
      }
    }
    if (h.kind === 'card' && !near(['card'], h.t - 0.1, h.t + sh.bar)) add({ t: h.t + sh.beat * 0, type: 'card', intensity: 0.7 })
  }
  return out
}

/** La nota de `scale` más cercana a la posición `i` que no está sonando ya en la música (ni a un semitono) en [t, t+0.15]:
 *  el efecto se oye porque no se esconde detrás de una nota igual. */
export function freeNote(ctx: Ctx, scale: number[], i: number, t: number): number {
  const busy = (m: number) => (ctx.notes ?? []).some((n) => n.t <= t + 0.15 && n.end >= t && Math.abs(n.midi - m) <= 1)
  const at = Math.max(0, Math.min(scale.length - 1, i))
  for (const d of [0, 1, -1, 2, -2, 3]) {
    const m = scale[at + d]
    if (m !== undefined && !busy(m)) return m
  }
  return scale[at]
}

/** Un evento ya ordenado: índice, ordinal en su tipo, desplazamiento a tempo y posición en su grupo (las palabras de
 *  un rótulo, los golpes de una ola de iconos). */
export type Scheduled = ResolvedEvent & { k: number; ord: number; shift: number; gi: number; gn: number }

/** Los eventos de la hoja más los automáticos, en orden, con su índice y su ordinal dentro de su tipo. */
export function resolveEvents(sh: Sheet, H: BarHarmony[]): Scheduled[] {
  const raw: ResolvedEvent[] = [...sh.events, ...autoEvents(sh, H)].sort((a, b) => a.t - b.t)
  // dos subidas hacia el mismo golpe suenan como una (la más larga)
  const all = raw.filter((e) => e.type !== 'rise' || !raw.some((x) => x !== e && x.type === 'rise' && Math.abs(x.t + x.dur - (e.t + e.dur)) < 0.12 && (x.dur > e.dur || (x.dur === e.dur && x.t < e.t))))
  const count: Record<string, number> = {}
  // las palabras seguidas (menos de 0,3 s entre una y otra) son un rótulo: se encaja la primera y las demás se mueven
  // lo mismo, para que el escalonado de la imagen no se rompa (dos palabras en la misma semicorchea serían un acorde)
  const shift = new Map<ResolvedEvent, number>()
  const group = new Map<ResolvedEvent, [number, ResolvedEvent[]]>()
  for (const [type, gap] of [['word', 0.6], ['icon', 0.4]] as const) {
    let cur: ResolvedEvent[] = []
    let groupShift = 0
    let last = -Infinity
    for (const e of all) {
      if (e.type !== type) continue
      if (e.t - last > gap) {
        cur = []
        groupShift = snap16(sh, e.t) - e.t
      }
      cur.push(e)
      group.set(e, [cur.length - 1, cur])
      if (type === 'word') shift.set(e, groupShift)
      last = e.t
    }
  }
  return all.map((e, k) => ({ ...e, k, ord: (count[e.type] = (count[e.type] ?? -1) + 1), shift: shift.get(e) ?? 0, gi: group.get(e)?.[0] ?? 0, gn: group.get(e)?.[1].length ?? 1 }))
}

export function renderEvents(ctx: Ctx, sh: Sheet, H: BarHarmony[]): Placement[] {
  return resolveEvents(sh, H).map((e) => renderEvent(ctx, sh, H, e))
}

/** Un evento: escribe su sonido y devuelve dónde quedó. Su azar depende solo de su índice, así que se puede volver a
 *  sintetizar aislado (para medir dónde cae). */
export function renderEvent(base: Ctx, sh: Sheet, H: BarHarmony[], e: Scheduled): Placement {
  // en el corto, con la batería a tope, el aire de los cortes y los golpes van 3 dB más arriba
  const ctx: Ctx = { ...base, gain: (base.gain ?? 1) * db(TYPE_DB[e.type] + (sh.mode === 'short' && (e.type === 'whoosh' || e.type === 'impact') ? 3 : 0)) }
  const rand = rng(sh.seed * 7 + 3 + e.k * 7919)
  const beat = sh.beat
  const e16 = beat / 4
  const v = e.intensity
  const h = harmonyAt(sh, H, Math.max(0, e.t))
  let out: Placement = { type: e.type, t: e.t, hit: e.t, snapMs: 0, span: [e.t, e.t], notes: [], auto: !!e.auto, label: e.label }
  // snapMs: cuánto se movió el golpe al encajarlo a tempo (respecto a t, o al final pedido en la subida)
  const place = (hit: number, span: [number, number], notes: number[]) => {
    const ref = e.type === 'rise' || e.type === 'whoosh' ? hit : e.t
    out = { type: e.type, t: e.t, hit, snapMs: +((hit - ref) * 1000).toFixed(1), span, notes, auto: !!e.auto, label: e.label }
  }
  switch (e.type) {
    case 'click': {
      const t = snap16(sh, e.t)
      // los clics recorren las notas del acorde en la octava 6 (≈1,2–1,9 kHz)
      const tones = chordTones(h.pcs, 84, 95)
      const m = tones.length ? freeNote(ctx, tones, e.ord % tones.length, t) : 86
      uiClick(ctx, t, m, 0.5 + 0.5 * v, e.pan)
      place(t, [t, t + 0.12], [m])
      break
    }
    case 'word': {
      const t = e.t + e.shift
      const scale = safeScale(sh.key, h.pcs, 79, 98)
      const i = e.i ?? e.gi
      // las «campanitas» del v3: marimba aguda con su sala (el corto suma un poco de glock)
      const m = freeNote(ctx, scale, (i % 6) + (h.bar % 2), t)
      marimba(ctx, t, m, 0.35 + 0.35 * v, e.pan * 0.6 + (i % 2 ? 0.15 : -0.15), { bus: 'fx', decay: 0.9, bright: 1.1, sends: { hall: 0.55, echo: 0.25 } })
      if (sh.mode === 'short') glock(ctx, t, m + 12, 0.1 + 0.12 * v, e.pan * 0.6, { decay: 0.5 })
      place(t, [t, t + 0.9], [m])
      break
    }
    case 'underline': {
      // el subrayado a pincel de la palabra en cursiva: el roce del pincel y una sola nota suave
      const t = snap16(sh, e.t)
      const tones = chordTones(h.pcs, 76, 88)
      const m = tones.length ? freeNote(ctx, tones, e.ord % tones.length, t) : 79
      brushStroke(ctx, t, 0.38, 0.25 + 0.2 * v, e.pan)
      marimba(ctx, t, m, 0.3 + 0.3 * v, e.pan * 0.5, { bus: 'fx', decay: 0.9, bright: 1.0, sends: { hall: 0.6, echo: 0.3 } })
      place(t, [t, t + 0.9], [m])
      break
    }
    case 'card': {
      const t = snap16(sh, e.t)
      // en el registro del v3 (fa#5–do#6 de día, si4–fa#5 de noche), una nota del acorde que la música no esté tocando
      const tones = chordTones(h.pcs, e.dark ? 71 : 77, e.dark ? 86 : 92)
      const a = tones.length ? freeNote(ctx, tones, 0, t) : 74
      const b = tones.find((x) => x - a >= 7) ?? a + 12
      // dos campanas, como el v3 (el corto les suma aire al revés y un destello)
      bell(ctx, t, a, 0.45 + 0.2 * v, 0.1, { bus: 'fx', decay: 1.9, sends: { hall: 0.65, echo: 0.2 } })
      bell(ctx, t + 0.02, b, 0.22 + 0.12 * v, -0.15, { bus: 'fx', decay: 1.9, sends: { hall: 0.65, echo: 0.2 } })
      if (sh.mode === 'short') {
        reverseSwell(ctx, t, 0.45, 0.3 * v, e.dark ? 1600 : 2600)
        glock(ctx, t + 0.01, b + 12, 0.25 * v, 0.2, { decay: 1.2 })
      }
      place(t, [t - 0.45, t + 3], [a, b])
      break
    }
    case 'whoosh': {
      const size = e.size ?? 0.4
      const dur = e.dur
      const dir = e.dir ?? (e.pan >= 0 ? 1 : -1)
      const cut = dur < 0.08
      // corte seco: el aire culmina en el corte; movimiento: en su punto de máxima velocidad
      // (la cresta de un movimiento es suave: se acerca a la semicorchea si está a menos de 45 ms)
      const free = e.t + (e.peak ?? 0.5) * dur
      const grid = sh.downbeat + Math.round((free - sh.downbeat) / e16) * e16
      const crestAt = cut ? snap16(sh, e.t) : Math.abs(grid - free) <= 0.045 ? grid : free
      const pre = cut ? 0.16 + 0.24 * size : Math.max(0.1, crestAt - e.t + 0.05)
      const tail = 0.12 + 0.3 * size
      const start = crestAt - pre
      const wt = chordTones(h.pcs, 72, 84)
      const m = (wt.length ? freeNote(ctx, wt, Math.floor(rand() * 3), crestAt - 0.1) : 76) + (size > 0.6 ? -12 : 0)
      const spread = 0.35 + 0.4 * size
      // el carácter según el gesto que lo provoca (la nota de la hoja del montaje): corte, rack focus, barrido, empujón…
      const g = e.label ?? ''
      const style: WhooshStyle = g === 'focus' || g === 'shape' || g === 'match' || g === 'icon' ? 'focus' : g === 'whip' ? 'whip' : g === 'camera' ? 'push' : g === 'content' || g === 'fade' ? 'paper' : 'air'
      whoosh(ctx, start, pre + tail + (cut ? 0 : Math.max(0, e.t + dur - crestAt)), pre, size, m, (0.35 + 0.65 * v) * (0.3 + 0.7 * size), e.pan - dir * spread, e.pan + dir * spread, style)
      place(crestAt, [start, crestAt + tail], [m])
      break
    }
    case 'light': {
      const toLight = e.to === 'light'
      lightSweep(ctx, e.t, e.dur, toLight, 0.5 + 0.5 * v)
      // en el corto, destellos de glock a lo largo del cambio (suben al amanecer, bajan al anochecer); la película
      // se queda con el barrido, como el v3
      const tones = chordTones(h.pcs, 76, 96)
      const n = sh.mode === 'short' ? Math.max(3, Math.min(10, Math.round(e.dur / e16))) : 0
      const notes: number[] = []
      for (let k = 0; k < n; k++) {
        const tk = e.t + (k / n) * e.dur
        const m = toLight ? tones[Math.min(tones.length - 1, k)] : tones[Math.max(0, tones.length - 1 - k)]
        glock(ctx, tk, m, (0.12 + 0.14 * (toLight ? k / n : 1 - k / n)) * v, (k / n - 0.5) * (toLight ? 1.2 : -1.2), { decay: 0.7 })
        notes.push(m)
      }
      if (!toLight) bell(ctx, e.t + e.dur * 0.6, (tones[0] ?? 76) - 12, 0.22 * v, 0, { bus: 'fx', decay: 2.2 })
      place(e.t + e.dur, [e.t, e.t + e.dur + 0.5], notes)
      break
    }
    case 'rise': {
      // sube hasta una semicorchea antes del golpe y ahí calla: el hueco hace que el golpe suba (también en un móvil)
      const end = snap16(sh, e.t + e.dur)
      // hacia un drop (o un destello) el hueco es de una corchea, como el de la música; hacia otro golpe, una semicorchea
      const toDrop = H.some((x) => x.kind === 'drop' && x.pos === 0 && Math.abs(x.t - end) < 0.03) || sh.events.some((x) => x.type === 'flash' && Math.abs(x.t - end) < 0.08)
      const cut = e.dur > 0.4 ? end - (toDrop ? 2 * e16 : e16) : end
      const len = Math.max(0.1, cut - e.t)
      const hEnd = harmonyAt(sh, H, Math.max(0, end - 0.01))
      const root = 48 + ((hEnd.chord.root - 0 + 12) % 12)
      riser(ctx, e.t, len, root, 0.4 + 0.5 * v)
      place(e.t + len, [e.t, e.t + len], [root])
      break
    }
    case 'impact': {
      const t = snap16(sh, e.t)
      // golpes seguidos (una ráfaga, «Mac · Windows · Linux»): el primero entero, los demás más cortos y sin plato
      const cluster = sh.events.some((x) => x.type === 'impact' && x.t < e.t - 0.05 && x.t > e.t - 1.3)
      // el golpe grave pesa de verdad en el drop, la subida y el corto; en el resto de la película, más ligero
      // (también la ráfaga que sigue al drop, dos compases)
      const heavy = sh.mode === 'short' || h.kind === 'drop' || h.kind === 'rise' || harmonyAt(sh, H, t + 0.01).kind === 'drop' || H.some((x) => x.kind === 'drop' && t >= x.t && t < x.t + 3 * sh.bar)
      // el grave, moderado: un subgrave grande no se oye en un móvil y hace que el limitador hunda todo lo demás
      // (en una tanda, sin grave: el bombo ya lo da, y un pico grave en cada golpe haría que el limitador los hundiera)
      if (!cluster) boom(ctx, t, (0.6 + 0.4 * v) * 0.5 * (heavy ? 1 : 0.6), { len: 1.8 })
      if (!cluster) crash(ctx, t, (0.4 + 0.35 * v) * (heavy ? 1.4 : 1), { bus: 'fx', decay: 1.6 })
      // lo que se oye en un móvil: palmada, caja y metal corto (el grave solo no sube por encima de 300 Hz)
      hitTransient(ctx, t, (0.8 + 0.5 * v) * (heavy ? 1 : 0.9) * (cluster ? 1.15 : 1), e.pan)
      const ht = harmonyAt(sh, H, t + 0.01)
      const tones = chordTones(ht.pcs, 74, 91)
      const m = tones.length ? freeNote(ctx, tones, 0, t) : 74
      // en una tanda, campana corta: las colas no se amontonan y cada golpe sube sobre el anterior
      bell(ctx, t, m, 0.3 * v, -0.2, { bus: 'fx', decay: cluster ? 0.7 : 2.0 })
      place(t, [t, t + 2.4], [m])
      break
    }
    case 'arp': {
      // la ola de iconos: n notas de la pentatónica segura que suben, repartidas en dur, de izquierda a derecha
      const t = snap16(sh, e.t)
      const n = Math.max(2, e.n ?? Math.round(e.dur / (beat / 6)))
      const scale = safeScale(sh.key, h.pcs, 67, 103)
      const notes: number[] = []
      for (let k = 0; k < n; k++) {
        const tk = t + (k / n) * e.dur
        const m = scale[Math.min(scale.length - 1, k)]
        const pan = -0.7 + (1.4 * k) / Math.max(1, n - 1)
        marimba(ctx, tk, m, 0.3 + 0.25 * v, pan, { bus: 'fx', decay: 0.35, bright: 1.3, sends: { hall: 0.45, echo: 0.3 } })
        if (k % 2 === 0) glock(ctx, tk, m + 12, 0.08 + 0.1 * v, pan, { decay: 0.45 })
        notes.push(m)
      }
      bell(ctx, t + e.dur, notes[notes.length - 1], 0.25 * v, 0.6, { bus: 'fx', decay: 1.8 })
      place(t, [t, t + e.dur + 1], notes)
      break
    }
    case 'keys': {
      const n = Math.max(1, e.n ?? Math.round(e.dur * 14))
      const scale = safeScale(sh.key, h.pcs, 91, 103)
      const notes: number[] = []
      for (let k = 0; k < n; k++) {
        const jitter = k === 0 ? 0 : (rand() - 0.5) * 0.012
        const tk = e.t + (k / n) * e.dur + jitter
        const m = scale[Math.floor(rand() * scale.length)] ?? 98
        keyTick(ctx, tk, m, (0.55 + 0.45 * v) * (0.75 + 0.25 * rand()), e.pan + (rand() - 0.5) * 0.2, k % 6 === 5)
        notes.push(m)
      }
      place(e.t, [e.t, e.t + e.dur + 0.05], notes)
      break
    }
    case 'type': {
      // una tecla (el montaje manda una por carácter)
      const scale = safeScale(sh.key, h.pcs, 91, 103)
      const m = scale[Math.floor(rand() * scale.length)] ?? 98
      keyTick(ctx, e.t, m, (0.55 + 0.45 * v) * (0.8 + 0.2 * rand()), e.pan, e.ord % 6 === 5)
      place(e.t, [e.t, e.t + 0.06], [m])
      break
    }
    case 'icon': {
      const t = snap16(sh, e.t)
      if (e.gn === 1) {
        // un icono solo: el sol que sale en el arco (campana y un destello de glock que sube)
        const tones = chordTones(h.pcs, 74, 93)
        bell(ctx, t, tones[0] ?? 74, 0.4 + 0.3 * v, -0.1, { bus: 'fx', decay: 2.4, sends: { hall: 0.6, echo: 0.2 } })
        tones.slice(1, 4).forEach((m, k) => glock(ctx, t + (k + 1) * e16 * 0.5, m + 12, (0.16 + 0.06 * k) * v, -0.3 + 0.3 * k, { decay: 0.9 }))
        place(t, [t, t + 2.4], tones.slice(0, 4))
      } else {
        // la ola: cada icono, una nota más arriba en la pentatónica segura; el último, con campana
        const scale = safeScale(sh.key, h.pcs, 67, 103)
        const m = scale[Math.min(scale.length - 1, e.gi + 2)]
        marimba(ctx, t, m, 0.3 + 0.3 * v, e.pan, { bus: 'fx', decay: 0.4, bright: 1.3, sends: { hall: 0.45, echo: 0.3 } })
        glock(ctx, t, m + 12, 0.08 + 0.12 * v, e.pan, { decay: 0.45 })
        if (e.gi === e.gn - 1) bell(ctx, t, m, 0.3 * v + 0.15, e.pan, { bus: 'fx', decay: 1.8 })
        place(t, [t, t + 0.5], [m])
      }
      break
    }
    case 'flash': {
      // el destello del drop: golpe grave más ligero, plato, aire brillante y un acorde agudo de glock
      const t = snap16(sh, e.t)
      const ht = harmonyAt(sh, H, t + 0.01)
      // sin aire al revés: el hueco antes del destello es lo que lo hace grande
      boom(ctx, t, (0.45 + 0.35 * v) * 0.45, { len: 1.8 })
      crash(ctx, t, 0.45 + 0.35 * v, { bus: 'fx', decay: 1.3 })
      hitTransient(ctx, t, 0.9 + 0.3 * v, 0)
      const tones = chordTones(ht.pcs, 86, 100)
      tones.slice(0, 4).forEach((m, k) => glock(ctx, t + k * 0.012, m, (0.42 - 0.06 * k) * v, -0.45 + 0.3 * k, { decay: 1.4 }))
      chordTones(ht.pcs, 69, 86).slice(0, 4).forEach((m, k) => bell(ctx, t + k * 0.01, m, (0.4 - 0.06 * k) * v, -0.3 + 0.2 * k, { bus: 'fx', decay: 1.6 }))
      place(t, [t - 0.5, t + 2.2], tones.slice(0, 4))
      break
    }
    case 'count': {
      // ticks que suben de tono con la cuenta (ease-out: deprisa al principio) y un «ding» al llegar
      const t = snap16(sh, e.t)
      const n = Math.max(3, e.n ?? Math.min(16, Math.round(e.dur / e16)))
      const scale = safeScale(sh.key, h.pcs, 79, 100)
      const notes: number[] = []
      for (let k = 0; k < n; k++) {
        const q = k / n
        const tk = t + e.dur * (1 - (1 - q) * (1 - q))
        const m = scale[Math.min(scale.length - 1, k)]
        glock(ctx, tk, m, (0.22 + 0.22 * q) * (0.6 + 0.6 * v), (q - 0.5) * 0.6, { decay: 0.2, bright: 1, sends: { hall: 0.1 } })
        notes.push(m)
      }
      const end = t + e.dur
      const top = chordTones(harmonyAt(sh, H, end).pcs, 86, 98)
      const ding = top[top.length - 1] ?? 93
      bell(ctx, end, ding, 0.28 + 0.2 * v, 0.1, { bus: 'fx', decay: 1.4 })
      glock(ctx, end, ding, 0.25 * v, 0.1, { decay: 0.9 })
      notes.push(ding)
      place(t, [t, end + 1.2], notes)
      break
    }
    case 'logo': {
      const t = snap16(sh, e.t)
      const ht = harmonyAt(sh, H, t + 0.01)
      // el aire al revés calla una semicorchea antes del golpe
      reverseSwell(ctx, t - e16, 0.75, 0.45 * v, 2000)
      boom(ctx, t, (0.75 + 0.25 * v) * 0.6, { len: 2.6 })
      hitTransient(ctx, t, 0.6 + 0.3 * v, 0)
      crash(ctx, t, 0.28 * v, { bus: 'fx', decay: 2.6 })
      // acorde de campanas (como el v3: re – la – re, ahora con la novena)
      const tones = chordTones(ht.pcs, 74, 90)
      const pick = [tones[0], tones.find((x) => x >= tones[0] + 7), tones.find((x) => x >= tones[0] + 12), tones[tones.length - 1]].filter((x): x is number => x !== undefined)
      pick.forEach((m, k) => bell(ctx, t + k * 0.015, m, (0.75 - 0.15 * k) * v, (k - 1.5) * 0.25, { bus: 'fx', decay: 2.4, sends: { hall: 0.7, echo: 0.2 } }))
      glock(ctx, t + 0.03, pick[pick.length - 1] + 12, 0.25 * v, 0.3, { decay: 1.6 })
      place(t, [t - 0.9, t + 4], pick)
      break
    }
  }
  return out
}
