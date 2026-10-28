// Cifrado de acordes → notas MIDI, con conducción de voces (cada acorde elige la inversión más cercana al anterior).
// «D», «A/C#», «Bm», «F#m», «Dsus2», «Dadd9», «G6», «Em7», «Cmaj7», «Bb», «A7sus4»…

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export interface Chord {
  /** Clase de la fundamental (0 = do). */
  root: number
  /** Clase del bajo (la de la barra, o la fundamental). */
  bass: number
  /** Intervalos sobre la fundamental. */
  intervals: number[]
  minor: boolean
}

function pitchClass(s: string): [number, number] {
  const letter = PITCH[s[0]?.toUpperCase()]
  if (letter === undefined) throw new Error(`acorde no válido: ${s}`)
  let n = letter
  let used = 1
  while (s[used] === '#' || s[used] === '♯' || s[used] === 'b' || s[used] === '♭') {
    n += s[used] === '#' || s[used] === '♯' ? 1 : -1
    used++
  }
  return [((n % 12) + 12) % 12, used]
}

export function parseChord(symbol: string): Chord {
  const [main, slash] = symbol.trim().split('/')
  const [root, used] = pitchClass(main)
  let q = main.slice(used)
  const minor = /^m(?!aj)/.test(q)
  if (minor) q = q.slice(1)
  let intervals = minor ? [0, 3, 7] : [0, 4, 7]
  if (/sus2/.test(q)) intervals = [0, 2, 7]
  if (/sus4|sus(?!2)/.test(q)) intervals = [0, 5, 7]
  if (/dim/.test(q)) intervals = [0, 3, 6]
  if (/maj7/.test(q)) intervals.push(11)
  else if (/7/.test(q)) intervals.push(10)
  if (/6/.test(q)) intervals.push(9)
  if (/add9|9/.test(q)) intervals.push(14)
  const bass = slash ? pitchClass(slash)[0] : root
  return { root, bass, intervals, minor }
}

/** Voces del acorde cerca de `center` (MIDI), lo más pegadas posible a las del acorde anterior. */
export function voice(chord: Chord, center: number, previous?: number[]): number[] {
  const base = center - ((center - chord.root) % 12 + 12) % 12
  const candidates: number[][] = []
  for (let shift = -12; shift <= 12; shift += 12)
    for (let inv = 0; inv < chord.intervals.length; inv++) {
      const notes = chord.intervals.map((iv, i) => base + shift + iv + (i < inv ? 12 : 0)).sort((a, b) => a - b)
      if (Math.abs((notes[0] + notes[notes.length - 1]) / 2 - center) <= 9) candidates.push(notes)
    }
  if (!candidates.length) return chord.intervals.map((iv) => base + iv)
  const cost = (notes: number[]) =>
    previous?.length
      ? notes.reduce((s, n) => s + Math.min(...previous.map((p) => Math.abs(p - n))), 0)
      : Math.abs((notes[0] + notes[notes.length - 1]) / 2 - center)
  return candidates.sort((a, b) => cost(a) - cost(b))[0]
}

/** Nota MIDI del bajo en la octava de `low` o por encima. */
export function bassNote(chord: Chord, low: number): number {
  return low + ((((chord.bass - low) % 12) + 12) % 12)
}
