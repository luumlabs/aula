// Armonía de la banda sonora: un acorde por compás según el carácter de cada sección (escrito en re mayor, como el v3, y
// transportado a la tonalidad de la hoja), voces del colchón con conducción de voces, bajo, notas del arpegio y las
// notas «seguras» de la escala para los efectos (que nunca rozan un semitono por encima de una nota del acorde).
import { bassNote, parseChord, voice, type Chord } from '../audio/chords.ts'
import { barTime, sectionAt, type SectionKind, type Sheet } from './sheet.ts'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Transporta un cifrado (fundamental y bajo) `semis` semitonos. */
export function transpose(symbol: string, semis: number): string {
  const shift = (note: string) => {
    const m = /^([A-G])([#♯b♭]*)(.*)$/.exec(note)
    if (!m) throw new Error(`acorde no válido: ${symbol}`)
    let p = PITCH[m[1]]
    for (const c of m[2]) p += c === '#' || c === '♯' ? 1 : -1
    return NAMES[(((p + semis) % 12) + 12) % 12] + m[3]
  }
  const [main, slash] = symbol.trim().split('/')
  return slash ? `${shift(main)}/${shift(slash)}` : shift(main)
}

/** Variantes por capítulo (la 1.ª, 2.ª, 3.ª… sección de día o de noche): la canción no repite el mismo bucle. */
const DAY = [
  ['Dadd9', 'A/C#', 'Bm7', 'Gadd9'], // A: I–V6–vi–IV, el himno
  ['Bm7', 'Gadd9', 'Dadd9', 'A'], // B: vi–IV–I–V, más brillo
  ['Gmaj7', 'D/F#', 'Em7', 'Asus4'], // C: calmado, IV–I6–ii–Vsus
  ['Dadd9', 'A/C#', 'Bm7', 'Gadd9'] // D: vuelve el himno, en subida
]
const NIGHT = [
  ['Bm9', 'Gmaj7', 'D/F#', 'A'], // A
  ['Em9', 'Bm9', 'Gmaj7', 'A'], // B
  ['Bm9', 'Em9', 'Gmaj7', 'Asus4'] // C
]
/** La cartela prepara el primer acorde de lo que viene (en suspenso, como el v3): sol antes de re, mi menor antes de si
 *  menor o de sol, la sus4 antes de mi menor y re antes de la. */
const CARD_BEFORE: Record<string, string> = { D: 'Gmaj7', B: 'Em9', G: 'Em9', E: 'Asus4', A: 'Dadd9', F: 'Bm7', C: 'Gmaj7' }

/** Progresión (en re) de una sección de `len` compases según su carácter, el de la siguiente y su variante. */
export function progression(kind: SectionKind, len: number, next?: SectionKind, variant = 0): string[] {
  const cycle = (xs: string[]) => Array.from({ length: len }, (_, i) => xs[i % xs.length])
  switch (kind) {
    case 'intro': {
      // tensión que pide resolver: acaba siempre en la dominante (A) y el drop cae en re
      if (len === 1) return ['Asus4']
      const xs = cycle(['Bm', 'G', 'Em7', 'A'])
      xs[len - 1] = 'A'
      if (len >= 4) xs[len - 2] = 'Em7'
      return xs
    }
    case 'drop':
      return cycle(DAY[0])
    case 'day':
      return cycle(DAY[Math.min(variant, DAY.length - 1)])
    case 'night':
      return cycle(NIGHT[Math.min(variant, NIGHT.length - 1)])
    case 'card': {
      // en suspenso: mi menor si viene la noche, sol si viene el día (como el v3)
      const first = next === 'night' ? 'Em9' : 'Gmaj7'
      return cycle([first, 'Asus4'])
    }
    case 'break':
      return cycle(['Gmaj7', 'D/F#', 'Em7', 'Asus4'])
    case 'rise': {
      if (len === 1) return ['A']
      if (len === 2) return ['G', 'A']
      if (len === 3) return ['Em7', 'G', 'A']
      // larga: el día (re – la/do# – si m – sol) y al final sol – la, que pide el re del final
      const xs = cycle(['Dadd9', 'A/C#', 'Bm7', 'Gadd9'])
      xs[len - 2] = 'Gadd9'
      xs[len - 1] = 'A'
      return xs
    }
    case 'end':
      return Array.from({ length: len }, (_, i) => (i === 1 ? 'Gadd9/D' : 'Dadd9'))
  }
}

export interface BarHarmony {
  /** Compás (1…). */
  bar: number
  t: number
  symbol: string
  chord: Chord
  kind: SectionKind
  energy: number
  /** Índice de la sección y posición del compás dentro de ella. */
  section: number
  pos: number
  len: number
  /** Carácter de la sección siguiente (para preparar cadencias y respiros). */
  next?: SectionKind
  /** Cuántas secciones de su mismo carácter hubo antes (0 = la primera): cambia el arreglo de cada capítulo. */
  variant: number
  /** Colchón (MIDI, alrededor de la tónica 4). */
  pad: number[]
  /** Bajo (MIDI, la1–sol#2). */
  bass: number
  /** Cinco notas del acorde de la fundamental hacia arriba (para la marimba). */
  arp: number[]
  /** Clases de altura del acorde (con extensiones). */
  pcs: number[]
}

/** Un acorde por compás para toda la hoja (índice 0 = compás 1). */
export function harmonize(sh: Sheet): BarHarmony[] {
  const semis = sh.key - 2
  const out: BarHarmony[] = []
  let prev: number[] | undefined
  const total = sh.bars + 1
  const symbols: { symbol: string; section: number; pos: number; len: number; variant: number }[] = []
  // primero en re (para elegir el acorde de cada cartela según lo que viene) y luego transportado
  // la variante cuenta «tandas» de un mismo carácter: dos secciones de día seguidas (aunque haya una cartela en medio)
  // son el mismo capítulo musical; la siguiente tanda de día, tras una noche, es la variante siguiente
  const seen: Partial<Record<SectionKind, number>> = {}
  let prevKind: SectionKind | undefined
  const variants = sh.sections.map((sec) => {
    if (sec.kind === 'card') return 0
    if (sec.kind !== prevKind) seen[sec.kind] = (seen[sec.kind] ?? -1) + 1
    prevKind = sec.kind
    return seen[sec.kind]!
  })
  const lens = sh.sections.map((sec, k) => Math.max(0, Math.min(total + 1, sh.sections[k + 1]?.bar ?? total + 1) - sec.bar))
  const inD = sh.sections.map((sec, k) => (sec.chords?.length || !lens[k] ? null : progression(sec.kind, lens[k], sh.sections[k + 1]?.kind, variants[k])))
  sh.sections.forEach((sec, k) => {
    const xs = inD[k]
    const nextFirst = inD[k + 1]?.[0]
    if (sec.kind === 'card' && xs && nextFirst) xs[0] = CARD_BEFORE[nextFirst[0]] ?? xs[0]
  })
  sh.sections.forEach((sec, k) => {
    const len = lens[k]
    if (!len) return
    const xs = sec.chords?.length ? Array.from({ length: len }, (_, i) => sec.chords![i % sec.chords!.length]) : inD[k]!.map((c) => transpose(c, semis))
    xs.forEach((symbol, pos) => (symbols[sec.bar - 1 + pos] = { symbol, section: k, pos, len, variant: variants[k] }))
  })
  for (let b = 1; b <= total; b++) {
    const sec = sectionAt(sh, b)
    const idx = sh.sections.indexOf(sec)
    // compases antes de la primera sección: su primer acorde
    // antes de la primera sección, su primer acorde; si algo quedara sin acorde, el del compás anterior
    const s = symbols[b - 1] ?? (b > 1 ? symbols.slice(0, b - 1).reverse().find(Boolean) : undefined) ?? symbols.find(Boolean) ?? { symbol: transpose('D', semis), section: 0, pos: 0, len: 1, variant: 0 }
    const chord = parseChord(s.symbol)
    const pad = voice(chord, 62 + ((semis + 6 + 12) % 12) - 6, prev)
    prev = pad
    const pcs = [...new Set(chord.intervals.map((iv) => (chord.root + iv) % 12))]
    out.push({
      bar: b,
      t: barTime(sh, b),
      symbol: s.symbol,
      chord,
      kind: sec.kind,
      energy: sec.energy,
      section: idx,
      pos: s.pos,
      len: s.len,
      next: sh.sections[idx + 1]?.kind,
      variant: s.variant,
      pad,
      bass: bassNote(chord, 33),
      arp: arpNotes(chord),
      pcs
    })
  }
  return out
}

/** Las notas del acorde desde la fundamental (octava 4) hacia arriba: cinco, cíclicas por octavas. */
export function arpNotes(chord: Chord): number[] {
  const rels = [...new Set(chord.intervals.map((iv) => iv % 12))].sort((a, b) => a - b)
  const root = 60 + chord.root
  const out: number[] = []
  for (let k = 0; out.length < 5; k++) out.push(root + rels[k % rels.length] + 12 * Math.floor(k / rels.length))
  return out
}

/** Pentatónica mayor de la tonalidad sin las notas que quedan un semitono por encima de una nota del acorde
 *  (las que «rozan»): lo que suena encima de cualquier acorde sin chocar. MIDI en [lo, hi]. */
export function safeScale(key: number, pcs: number[], lo: number, hi: number): number[] {
  const penta = [0, 2, 4, 7, 9].map((x) => (x + key) % 12)
  const ok = penta.filter((p) => !pcs.includes((p + 11) % 12))
  const out: number[] = []
  for (let m = lo; m <= hi; m++) if (ok.includes(((m % 12) + 12) % 12)) out.push(m)
  return out
}

/** Notas del acorde (con extensiones) en [lo, hi]. */
export function chordTones(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = []
  for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m)
  return out
}

/** La armonía que suena en t. */
export function harmonyAt(sh: Sheet, H: BarHarmony[], t: number): BarHarmony {
  const b = t < sh.downbeat ? 1 : Math.floor((t - sh.downbeat) / sh.bar + 1e-9) + 1
  return H[Math.max(0, Math.min(H.length - 1, b - 1))]
}
