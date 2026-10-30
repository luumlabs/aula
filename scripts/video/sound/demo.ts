// Hojas de efectos de ejemplo: una película de ~42 s a 104 BPM con toda la forma (intro con tensión → drop → cartela →
// día → cartela al anochecer → noche → amanecer → ola de iconos → subida → logo y acordes de cierre) y un corto de ~23 s
// a 120 BPM. Son lo que exportaría el montaje: tiempos en segundos del vídeo, en la rejilla y fuera de ella.
import type { CueSheet, SheetEvent } from './sheet.ts'

function grid(bpm: number, downbeat = 0) {
  const beat = 60 / bpm
  /** Segundos del compás `bar` (1…), pulso `b` (1…, admite fracciones). */
  return { beat, bar: beat * 4, V: (bar: number, b = 1) => +(downbeat + (bar - 1) * beat * 4 + (b - 1) * beat).toFixed(4) }
}

/** Un titular keynote: un único acento cuando empieza el subrayado de su palabra en cursiva (0,46 s tras la última). */
function keynote(t: number, text: string, stagger = 0.075, pan = -0.45): SheetEvent[] {
  const n = text.split(/\s+/).length
  return [{ t: +(t + (n - 1) * stagger + 0.46).toFixed(4), type: 'underline', pan, intensity: 0.6, label: text }]
}

/** Las palabras de un rótulo a pantalla completa (style 'type') que entran escalonadas (`stagger` s): un evento 'word'
 *  por palabra con su índice. */
function words(t: number, text: string, stagger = 0.04, pan = 0): SheetEvent[] {
  return text.split(/\s+/).map((w, i) => ({ t: +(t + i * stagger).toFixed(4), type: 'word', i, pan, intensity: 0.6, label: w }))
}

export function demoFilm(): CueSheet {
  const { V, beat } = grid(104)
  const ev: SheetEvent[] = [
    // intro: los materiales flotan y convergen; las palabras del problema
    { t: V(1, 1), type: 'whoosh', dur: 1.6, size: 0.5, peak: 0.6, pan: -0.2, dir: 1, label: 'materiales' },
    ...words(V(1, 2), 'Notes.'),
    ...words(V(1, 3), 'Slides.'),
    ...words(V(1, 4), 'PDFs.'),
    ...words(V(2, 1), 'And an exam in nine days.', 0.16),
    // drop: el icono entra con muelle; «Meet Aula.»
    { t: V(3, 1), type: 'whoosh', dur: 0.5, size: 0.75, peak: 0.25, label: 'icono' },
    ...words(V(3, 2), 'Meet Aula.', 0.2),
    // cartela 01 · Plan
    { t: V(4, 1), type: 'card', n: 1, label: '01 · Plan' },
    // día: calendario → clic → curso que se rellena → agentes → números que cuentan
    { t: V(5, 1), type: 'whoosh', dur: 0, size: 0.3, label: 'corte' },
    ...keynote(V(5, 1), 'It already knows your exams.'),
    { t: V(5, 3) + 0.02, type: 'click', pan: 0.3, label: 'Prepare for this exam' },
    { t: V(6, 1), type: 'whoosh', dur: 0.6, size: 0.6, dir: 1, pan: 0.1, label: 'ventana' },
    { t: V(6, 2), type: 'keys', dur: 1.25, n: 17, pan: 0.15, label: 'escribe' },
    { t: V(6, 4) + 0.03, type: 'click', pan: 0.25 },
    { t: V(7, 1), type: 'whoosh', dur: 0, size: 0.25, label: 'corte' },
    ...keynote(V(7, 1), 'Every answer, double-checked.'),
    { t: V(7, 2), type: 'count', dur: 1.4, n: 10, pan: 0.2, label: '104 ejercicios' },
    // cartela 02 · Learn, y anochece
    { t: V(8, 1), type: 'light', dur: 2 * beat, to: 'dark', label: 'anochecer' },
    { t: V(8, 1) + 0.05, type: 'card', n: 2, dark: true, label: '02 · Learn' },
    // noche: lección, ejercicio con el error, tarjetas
    { t: V(9, 1), type: 'whoosh', dur: 0, size: 0.3 },
    ...keynote(V(9, 1), 'Lessons that make it click.'),
    { t: V(9, 3.5), type: 'click', pan: -0.2 },
    { t: V(10, 1), type: 'whoosh', dur: 0.9, size: 0.45, peak: 0.5, dir: -1, label: 'empuje de cámara' },
    ...keynote(V(10, 1), 'Exercises that explain your mistake.'),
    { t: V(10, 3), type: 'click', pan: 0.2, intensity: 0.6 },
    { t: V(11, 1), type: 'whoosh', dur: 0, size: 0.35 },
    ...keynote(V(11, 1), 'Flashcards and mock exams.'),
    { t: V(11, 2.5), type: 'whoosh', dur: 0.45, size: 0.5, dir: 1, pan: 0.3, label: 'simulacro entra' },
    // cartela 03 · See it, amanece desde el sol
    { t: V(12, 1), type: 'light', dur: 2 * beat, to: 'light', label: 'amanecer' },
    { t: V(12, 1) + 0.05, type: 'card', n: 3, label: '03 · See it' },
    // día: la ola de iconos pintados
    { t: V(13, 1), type: 'arp', dur: 1.15, n: 14, label: 'ola de iconos' },
    ...keynote(V(13, 1), 'Made for every subject.'),
    // subida
    ...keynote(V(14, 1), 'Speaks your language.'),
    { t: V(14, 3), type: 'click', pan: -0.1 },
    { t: V(15, 1), type: 'whoosh', dur: 0, size: 0.4 },
    { t: V(15, 1), type: 'whoosh', dur: 1.8, size: 0.85, peak: 0.7, label: 'ventana → icono' },
    // final: logo y «Your study companion»
    { t: V(16, 1), type: 'logo', intensity: 0.9, label: 'logo' },
    ...words(V(17, 1), 'Your study companion', 0.12),
    ...words(V(18, 1), 'github.com/luumlabs/aula', 0)
  ]
  return {
    version: 1,
    name: 'demo-film',
    duration: +(V(19, 1) + 2.2).toFixed(3),
    bpm: 104,
    key: 'D',
    mode: 'film',
    seed: 7,
    sections: [
      { bar: 1, kind: 'intro' },
      { bar: 3, kind: 'drop' },
      { bar: 4, kind: 'card' },
      { bar: 5, kind: 'day' },
      { bar: 8, kind: 'card' },
      { bar: 9, kind: 'night' },
      { bar: 12, kind: 'card' },
      { bar: 13, kind: 'day' },
      { bar: 14, kind: 'rise' },
      { bar: 16, kind: 'end' }
    ],
    events: ev
  }
}

export function demoShort(): CueSheet {
  const { V } = grid(120)
  const ev: SheetEvent[] = [
    { t: V(1, 1), type: 'whoosh', dur: 1.2, size: 0.6, peak: 0.5, label: 'materiales' },
    ...words(V(1, 1), 'Exam in nine days.', 0.16),
    { t: V(2, 1), type: 'whoosh', dur: 0.4, size: 0.8, peak: 0.25, label: 'icono' },
    ...words(V(2, 2), 'Meet Aula.', 0.16),
    { t: V(3, 1), type: 'whoosh', dur: 0, size: 0.3 },
    ...words(V(3, 1), 'One click.', 0.16),
    { t: V(3, 3), type: 'click', pan: 0.3 },
    { t: V(3, 4), type: 'whoosh', dur: 0, size: 0.25 },
    ...words(V(3, 4), 'A whole course.', 0.16),
    { t: V(4, 1), type: 'count', dur: 1.0, n: 8, label: '104' },
    { t: V(4, 3), type: 'whoosh', dur: 0, size: 0.3 },
    ...words(V(4, 3), 'Molecules in 3D.', 0.16),
    { t: V(5, 1), type: 'whoosh', dur: 0.6, size: 0.55, dir: -1 },
    ...words(V(5, 1), 'Your heart, explained.', 0.16),
    { t: V(5, 3), type: 'click', pan: -0.2 },
    { t: V(6, 1), type: 'light', dur: 1.0, to: 'dark' },
    { t: V(6, 1), type: 'whoosh', dur: 0, size: 0.35 },
    ...words(V(6, 1), 'Just ask.', 0.16),
    { t: V(6, 2), type: 'keys', dur: 0.9, n: 13 },
    { t: V(6, 4), type: 'click', pan: 0.25 },
    { t: V(7, 1), type: 'whoosh', dur: 0, size: 0.3 },
    ...words(V(7, 1), 'Get it wrong. Know why.', 0.16),
    { t: V(7, 3), type: 'click', pan: 0.1 },
    { t: V(8, 1), type: 'light', dur: 1.0, to: 'light' },
    { t: V(8, 1), type: 'whoosh', dur: 0, size: 0.35 },
    { t: V(8, 1), type: 'arp', dur: 1.0, n: 12 },
    ...words(V(8, 1), 'Every subject.', 0.16),
    { t: V(9, 1), type: 'whoosh', dur: 0, size: 0.3 },
    ...words(V(9, 1), 'Every language.', 0.16),
    { t: V(9, 3), type: 'whoosh', dur: 0, size: 0.3 },
    ...words(V(10, 1), 'Free & open source.', 0.16),
    { t: V(10, 3), type: 'whoosh', dur: 0.9, size: 0.85, peak: 0.7 },
    { t: V(11, 1), type: 'logo' },
    ...words(V(11, 3), 'github.com/luumlabs/aula', 0)
  ]
  return {
    version: 1,
    name: 'demo-short',
    duration: +(V(13, 1) + 1.4).toFixed(3),
    bpm: 120,
    key: 'D',
    mode: 'short',
    seed: 11,
    sections: [
      { bar: 1, kind: 'intro' },
      { bar: 2, kind: 'drop' },
      { bar: 3, kind: 'day' },
      { bar: 6, kind: 'night' },
      { bar: 8, kind: 'day' },
      { bar: 10, kind: 'rise' },
      { bar: 11, kind: 'end' }
    ],
    events: ev
  }
}
