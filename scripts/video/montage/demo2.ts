// Segunda demostración (≈13 s) de las capas nuevas del motor: prólogo con el icono que amanece y la PUERTA que se abre
// al primer plano, aviso del sistema de macOS, la historia del corazón de medicina con sus sonidos (latidos, descarga,
// risa), marcos de Windows 11 y GNOME, y el final «ventana → icono» con el sol que vuela a la puerta y sale.
//   npm run build && node scripts/video/render.ts scripts/video/montage/demo2.ts --app out
import { defineMontage } from './types.ts'

const BAR = 2.4 // 100 BPM
const ICONS = '.flex.flex-wrap.gap-2.mt-3'

export default defineMontage({
  name: 'demo2',
  fps: 60,
  size: [1920, 1080],
  bitrate: 14e6,
  theme: 'light',
  duration: 13.2,
  takes: {
    home: {
      duration: 4,
      lang: 'en',
      theme: 'light',
      setup: [{ do: 'navigate', route: { name: 'home' } }]
    },
    gallery: {
      duration: 4.4,
      lang: 'en',
      theme: 'light',
      setup: [
        { do: 'navigate', route: { name: 'gallery' } },
        { do: 'eval', js: `document.querySelector('${ICONS}')?.scrollIntoView({ block: 'center' })` }
      ],
      // el corazón de medicina (undécimo icono de la galería): el cursor entra y su historia empieza
      actions: [{ at: 0.9, do: 'move', to: `${ICONS} > :nth-child(11)`, dur: 0.6 }],
      marks: { heart: `${ICONS} > :nth-child(11)` }
    },
    stats: {
      duration: 4.4,
      lang: 'en',
      theme: 'dark',
      setup: [{ do: 'navigate', route: { name: 'home' } }],
      actions: [{ at: 0.1, do: 'navigate', route: { name: 'stats' } }]
    }
  },
  prologue: { start: 0, end: 3.4, size: 360, rise: [0.5, 2.3] },
  clips: [
    { take: 'home', start: BAR, dur: 3.6, enter: { kind: 'door', dur: 0.9 }, camera: [{ t: 0, zoom: 'fit' }, { t: 3.6, zoom: 1.05, ease: 'inOut' }] },
    {
      take: 'gallery',
      start: 5.6,
      dur: 3.8,
      enter: { kind: 'rise', dur: 0.6 },
      camera: [
        { t: 0, zoom: 1.2, focus: 'mark:heart', screen: [0.5, 0.5] },
        { t: 1.0, zoom: 1.9, focus: 'mark:heart', screen: [0.5, 0.5], ease: 'inOut' },
        { t: 3.8, zoom: 1.9, focus: 'mark:heart', screen: [0.5, 0.5] }
      ]
    },
    { take: 'stats', start: 9.0, dur: 4.2, enter: { kind: 'sunrise', dur: 1.0 }, camera: [{ t: 0, zoom: 1.05 }, { t: 4.2, zoom: 'fit', ease: 'out' }] }
  ],
  titles: [{ start: 6.6, dur: 2.4, text: 'Every icon has a *story*', style: 'caption' }],
  notices: [{ start: 3.6, dur: 2.2, title: 'New assignment: “Homework 4: Trigonometric identities”', body: 'MATH 101 · canvas.example.edu', time: 'now', theme: 'light' }],
  // si la app no avisa (evento aula:pixel), la historia se coloca a mano: el cursor entra en el icono hacia 1,4 s de la toma
  pixelSfx: [{ t: 5.6 + 1.42, story: 'medicine' }],
  frames: [
    { t: 0, frame: 'mac' },
    { t: 9.9, frame: 'windows' },
    { t: 10.6, frame: 'linux' }
  ],
  finale: { start: 11.2, dur: 1.6, rise: [12.0, 12.9], sunFrom: [960, 980], title: 'Aula', sub: 'Study anything.' },
  stamps: [{ t: 2.6, text: 'Monday · 8:10 AM' }],
  cursor: 'sun',
  music: {
    bpm: 100,
    root: 62,
    chords: ['Dsus2', 'D', 'A/C#', 'Bm', 'G', 'Dadd9'],
    sections: [
      { bar: 1, style: 'dawn' },
      { bar: 2, style: 'day', claps: true },
      { bar: 4, style: 'night' }
    ],
    seed: 27,
    cues: [
      { t: 0.6, kind: 'motif', voice: 'marimba' },
      { t: BAR, kind: 'hit' },
      { t: 9.0, kind: 'swell' },
      { t: 12.0, kind: 'motif', voice: 'bell' },
      { t: 12.4, kind: 'end' }
    ]
  }
})
