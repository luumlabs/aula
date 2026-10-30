// Una hoja de efectos de ejemplo con el formato del montaje (cuesheet.json de montage/cuesheet.ts), a 100 BPM como el
// v3: gancho de 3 compases con sus palabras, «Meet Aula» en el compás 4, cartela, día con clics, palabras y cortes,
// cartela y anochecer, noche, amanecer, día con la ola de iconos, el logo y el cierre. ~41 s.
import type { MontageCues } from './timeline.ts'

export function demoCues(): MontageCues {
  const bar = 2.4
  const beat = 0.6
  const V = (b: number, p = 1) => +((b - 1) * bar + (p - 1) * beat).toFixed(3)
  const ev: MontageCues['events'] = [
    // gancho: «Notes. Slides. PDFs.» · «And an exam in nine days.»
    { t: V(1, 2), type: 'word', style: 'type', note: 'Notes.' },
    { t: V(1, 3), type: 'word', style: 'type', note: 'Slides.' },
    { t: V(1, 4), type: 'word', style: 'type', note: 'PDFs.' },
    { t: V(2, 2), type: 'word', style: 'type', note: 'And an exam' },
    { t: V(3, 1), type: 'word', style: 'type', note: 'in nine' },
    { t: V(3, 2), type: 'word', style: 'type', note: 'days.' },
    // «Meet Aula»
    { t: V(4, 1), type: 'flash', intensity: 1 },
    { t: V(4, 1), type: 'icon', note: 'icon + sun rise' },
    // cartela 01 · Plan
    { t: V(5, 1) + 0.3, type: 'card', note: '01 · Plan' },
    // día
    { t: V(6, 1), type: 'whoosh', note: 'focus' },
    { t: V(6, 1) + 0.46, type: 'underline', note: 'glance.' },
    { t: V(6, 3) + 0.1, type: 'click' },
    { t: V(7, 1), type: 'whoosh', note: 'cut' },
    { t: V(7, 2), type: 'count', dur: 1 },
    { t: V(7, 4), type: 'click' },
    { t: V(8, 1), type: 'whoosh', note: 'cut' },
    { t: V(8, 1) + 0.46, type: 'underline', note: 'verified.' },
    // cartela 02 · Learn y anochece
    { t: V(9, 1) + 0.3, type: 'card', note: '02 · Learn' },
    { t: V(9, 1) + 0.4, type: 'light', note: 'dusk', dur: 1.2 },
    // noche
    { t: V(10, 1), type: 'whoosh', note: 'focus' },
    { t: V(10, 1) + 0.46, type: 'underline', note: 'click.' },
    { t: V(10, 3), type: 'click' },
    { t: V(11, 1), type: 'whoosh', note: 'cut' },
    { t: V(11, 3) + 0.2, type: 'click' },
    // cartela 03 · See it y amanece
    { t: V(12, 1) + 0.3, type: 'card', note: '03 · See it' },
    { t: V(12, 1) + 0.4, type: 'light', note: 'dawn', dur: 1.0 },
    // día: la ola de iconos
    { t: V(13, 1), type: 'whoosh', note: 'cut' },
    ...Array.from({ length: 10 }, (_, k) => ({ t: +(V(13, 2) + k * 0.12).toFixed(3), type: 'icon', note: `wave ${k + 1}/10` })),
    { t: V(14, 1), type: 'whoosh', note: 'cut' },
    { t: V(14, 2), type: 'click' },
    // logo y cierre
    { t: V(15, 1), type: 'logo', intensity: 1 }
  ]
  return {
    name: 'sound-v6-demo',
    duration: +(V(15, 1) + 7.0).toFixed(3),
    bpm: 100,
    offset: 0,
    sections: [
      { t: 0, name: 'Hook', mood: 'intro' },
      { t: V(4), name: 'Meet Aula', mood: 'drop' },
      { t: V(5), name: 'Plan', mood: 'day' },
      { t: V(9), name: 'Learn', mood: 'night' },
      { t: V(12), name: 'See it', mood: 'day' },
      { t: V(15), name: 'Outro', mood: 'outro' }
    ],
    events: ev
  }
}
