// La hoja de efectos del montaje (work/<montaje>/cuesheet.json, de montage/cuesheet.ts) traducida a la línea de tiempo
// que entiende el Audio.swift del v3 (Timeline.swift): compases y su tipo, «Meet Aula», logo, cartelas, cambios de luz,
// acentos, cortes, clics, campanitas del arranque, olas de iconos y notas del cierre. Pura (la prueban las pruebas).

export type BarKind = 'intro' | 'meet' | 'card' | 'day' | 'night' | 'dusk' | 'outro'

export interface V3Timeline {
  source?: string
  bpm: number
  duration: number
  bars: number
  musicBars: number
  meetBar: number
  meet: number
  logo: number
  accentsFrom: number
  introSwell: number
  kinds: BarKind[]
  chapters: { n: number; bar: number; dark: boolean; textAt: number }[]
  changes: { t0: number; t1: number; toDark: boolean }[]
  accents: number[]
  cuts: number[]
  clicks: number[]
  hookWords: [number, number][]
  iconWaves: number[]
  outroMallets: [number, number][]
  levelWindow: [number, number]
  fadeOut: [number, number]
}

/** La hoja del montaje (lo que usa este traductor). */
export interface MontageCues {
  name?: string
  duration: number
  bpm: number
  offset?: number
  sections: { t: number; name?: string; mood: string }[]
  events: { t: number; type: string; intensity?: number; pan?: number; note?: string; dur?: number; style?: string; to?: 'dark' | 'light'; accent?: boolean }[]
}

/** Las notas de las campanitas del arranque del v3, en su orden (fa#5 sol#5 la5 do#6 · do#5 fa#5… en re mayor). */
const HOOK_NOTES = [76, 78, 81, 85, 73, 78]
/** Las notas del cierre del v3, en segundos tras el golpe del logo. */
const OUTRO: [number, number][] = [[1.2, 81], [1.5, 78], [2.4, 85], [3.6, 81], [4.8, 86]]

const r3 = (x: number) => Math.round(x * 1000) / 1000

function fail(m: string): never {
  throw new Error(`línea de tiempo del v3: ${m}`)
}

export function toV3Timeline(m: MontageCues): V3Timeline {
  const bpm = m.bpm
  const bar = 240 / bpm
  if (Math.abs(m.offset ?? 0) > 0.001) fail(`el compás 1 tiene que empezar en t = 0 (offset ${m.offset}); el Audio.swift del v3 cuenta los compases desde 0`)
  const barOf = (t: number) => Math.floor(t / bar + 1e-6)
  const sections = [...m.sections].sort((a, b) => a.t - b.t)
  const moodAt = (b: number) => {
    let mood = sections[0]?.mood ?? 'day'
    for (const s of sections) if (barOf(s.t + 0.1 * bar) <= b) mood = s.mood
    return mood
  }
  // «Meet Aula»: el compás del drop (como el compás 3 del v3)
  const drop = sections.find((s) => s.mood === 'drop')
  if (!drop) fail('falta la sección del drop (mood «drop»): es el «Meet Aula» del v3')
  const meetBar = barOf(drop.t + 0.05 * bar)
  if (meetBar < 1 || meetBar > 3) fail(`el drop cae en el compás ${meetBar + 1}; la intro del v3 tiene de 1 a 3 compases (Bm – G – A): pon el drop en el compás 2, 3 o 4 (${r3(bar)}, ${r3(2 * bar)} o ${r3(3 * bar)} s)`)
  const meet = r3(meetBar * bar)
  // el logo del final (el golpe grave + campanas); la música rítmica acaba en el compás anterior
  const logoEv = m.events.filter((e) => e.type === 'logo').sort((a, b) => a.t - b.t)[0]
  const logo = r3(logoEv ? logoEv.t : Math.min(m.duration - 6, m.duration * 0.92))
  const musicBars = Math.max(meetBar + 3, barOf(logo + 0.01))
  const bars = Math.max(musicBars + 4, Math.ceil(m.duration / bar) + 1)
  // cartelas: su compás es de cartela; la luz de la cartela es la de lo que viene
  const cards = m.events.filter((e) => e.type === 'card').sort((a, b) => a.t - b.t)
  const cardBars = new Set(cards.map((c) => barOf(c.t + 0.01)))
  const nightAfter = (t: number) => moodAt(barOf(t) + 1) === 'night'
  const kinds: BarKind[] = []
  for (let b = 0; b < bars; b++) {
    if (b < meetBar) kinds.push('intro')
    else if (b === meetBar) kinds.push('meet')
    else if (b >= musicBars) kinds.push('outro')
    else if (cardBars.has(b)) kinds.push('card')
    else kinds.push(moodAt(b) === 'night' ? 'night' : 'day')
  }
  // cambios de luz (dusk = anochecer, dawn = amanecer; las demás formas van hacia el mood que viene)
  const changes = m.events
    .filter((e) => e.type === 'light')
    .sort((a, b) => a.t - b.t)
    .map((e) => ({ t0: r3(e.t), t1: r3(e.t + (e.dur ?? 1.2)), toDark: e.to ? e.to === 'dark' : e.note === 'dusk' ? true : e.note === 'dawn' ? false : nightAfter(e.t) }))
  // un anochecer en un compás de día que da paso a la noche es el compás «dusk» del v3 (casi sin marimba, bajo largo)
  for (const c of changes) {
    const b = barOf(c.t0)
    if (c.toDark && kinds[b] === 'day' && kinds[b + 1] === 'night') kinds[b] = 'dusk'
  }
  const chapters = cards.map((c, k) => {
    const n = Number(/(\d+)/.exec(c.note ?? '')?.[1] ?? k + 1)
    const b = barOf(c.t + 0.01)
    return { n, bar: b, dark: nightAfter(c.t), textAt: r3(c.t - b * bar) }
  })
  const times = (type: string, from = 0) => m.events.filter((e) => e.type === type && e.t >= from && e.t < m.duration).map((e) => r3(e.t)).sort((a, b) => a - b)
  // acentos (destellos agudos de marimba): los subrayados de los rótulos y los números que cuentan, como las etiquetas y
  // los mensajes del v3; los clics llevan su propio tic
  // V6: y los personajes que se dibujan (su primer trazo y el final del dibujo, no cada trazo)
  const brushAccents = m.events.filter((e) => e.type === 'brush' && e.accent && e.t < m.duration).map((e) => r3(e.t))
  const accents = [...times('underline'), ...times('count'), ...brushAccents].filter((t) => t >= meet + 0.3).sort((a, b) => a - b)
  // cortes: cada entrada de plano (el aire que crece hasta el corte); los empujones de cámara y las luces no
  const cuts = m.events
    .filter((e) => e.type === 'whoosh' && e.note !== 'camera' && e.note !== 'light' && e.t > meet + 0.5 && e.t < logo - 0.5)
    .map((e) => r3(e.t))
    .sort((a, b) => a - b)
    .filter((t, i, xs) => i === 0 || t - xs[i - 1] > 0.3)
  // campanitas del arranque: una por palabra antes de «Meet Aula», con las notas del v3
  const hookWords = times('word')
    .filter((t) => t < meet - 0.05)
    .filter((t, i, xs) => i === 0 || t - xs[i - 1] > 0.12)
    .map((t, i) => [t, HOOK_NOTES[i % HOOK_NOTES.length]] as [number, number])
  // olas de iconos: tres o más iconos seguidos (menos de 0,4 s entre uno y otro) → el arpegio de 14 notas del v3
  const icons = times('icon')
  const iconWaves: number[] = []
  let run: number[] = []
  for (const t of [...icons, Infinity]) {
    if (run.length && t - run[run.length - 1] > 0.4) {
      if (run.length >= 3) iconWaves.push(run[0])
      run = []
    }
    if (Number.isFinite(t)) run.push(t)
  }
  const outroMallets = OUTRO.map(([dt, note]) => [r3(logo + dt), note] as [number, number]).filter(([t]) => t < m.duration - 1)
  // el tramo con ritmo en el que el v3 nivela su mezcla (24–140 s en su película): del compás meet + 7 a 4 s antes del logo
  let lv0 = Math.min(r3((meetBar + 7) * bar), Math.max(meet + bar, logo - 12))
  let lv1 = r3(logo - 4)
  if (lv1 - lv0 < 4) {
    lv0 = r3(meet + bar)
    lv1 = r3(Math.min(m.duration - 1, Math.max(lv0 + 4, logo - 1)))
  }
  return {
    source: `hoja de efectos ${m.name ?? ''}`.trim(),
    bpm,
    duration: r3(m.duration),
    bars,
    musicBars,
    meetBar,
    meet,
    logo,
    accentsFrom: r3(meet + 0.3),
    introSwell: r3(meet - 1.4),
    kinds,
    chapters,
    changes,
    accents,
    cuts,
    clicks: times('click', meet),
    hookWords,
    iconWaves,
    outroMallets,
    levelWindow: [lv0, lv1],
    fadeOut: [r3(m.duration - 3.6), r3(m.duration - 0.2)]
  }
}
