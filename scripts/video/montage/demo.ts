// Demostración de la cadena (≈13 s): tres pantallas reales de Aula en modo demostración (Hoy, un curso que se enciende
// píxel a píxel y donde se pulsa una pestaña, y Estadísticas en oscuro), con cámara, cursor-sol, el sol guía, titulares
// serif, sello de hora, papel por horas, marcos mac/windows/linux, iris, amanecer y música propia con sus secciones.
//   node scripts/video/render.ts scripts/video/montage/demo.ts --app HEAD
import { defineMontage } from './types.ts'

const COURSE = 'exam-2-math112'
const BAR = 2.4 // 100 BPM, 4/4

export default defineMontage({
  name: 'demo',
  fps: 60,
  size: [1920, 1080],
  bitrate: 14e6,
  theme: 'light',
  duration: 13.2,
  takes: {
    home: {
      duration: 5,
      lang: 'en',
      theme: 'light',
      viewport: [1600, 1000],
      setup: [{ do: 'navigate', route: { name: 'home' } }],
      actions: [
        { at: 1.6, do: 'move', to: 'text:Start the plan', dur: 1.1 },
        { at: 3.4, do: 'move', to: 'text:Open calendar', dur: 0.9 }
      ],
      marks: { plan: 'text:Start the plan' }
    },
    course: {
      duration: 4.4,
      lang: 'en',
      theme: 'light',
      viewport: [1600, 1000],
      setup: [{ do: 'navigate', route: { name: 'home' } }],
      actions: [
        { at: 0.15, do: 'navigate', route: { name: 'course', id: COURSE } },
        { at: 2.0, do: 'click', to: 'text:Learn', dur: 0.9 }
      ]
    },
    stats: {
      duration: 4.2,
      lang: 'en',
      theme: 'dark',
      viewport: [1600, 1000],
      setup: [{ do: 'navigate', route: { name: 'home' } }],
      actions: [{ at: 0.1, do: 'navigate', route: { name: 'stats' } }]
    }
  },
  clips: [
    {
      take: 'home',
      start: 0,
      dur: 5.8,
      from: 0,
      camera: [
        { t: 0, zoom: 'fit' },
        { t: 2.0, zoom: 'fit' },
        { t: 3.6, zoom: 1.45, focus: 'mark:plan', screen: [0.42, 0.52], ease: 'inOut' },
        { t: 5.8, zoom: 1.3, focus: 'mark:plan', screen: [0.46, 0.5], ease: 'inOut' }
      ]
    },
    {
      take: 'course',
      start: 5.4,
      dur: 4.0,
      from: 0.2,
      enter: { kind: 'iris', dur: 0.9, at: [330, 105] },
      camera: [
        // de cerca mientras el icono se enciende píxel a píxel; luego se abre al curso entero
        { t: 0, zoom: 1.7, focus: [330, 105], screen: [0.36, 0.38] },
        { t: 1.3, zoom: 1.7, focus: [330, 105], screen: [0.36, 0.38] },
        { t: 3.4, zoom: 'fit', ease: 'inOut' }
      ]
    },
    {
      take: 'stats',
      start: 8.6,
      dur: 4.6,
      from: 0,
      enter: { kind: 'sunrise', dur: 1.2 },
      camera: [
        { t: 0, zoom: 1.12 },
        { t: 4.6, zoom: 'fit', ease: 'out' }
      ]
    }
  ],
  titles: [
    { start: 0, dur: 2.3, text: 'Study by your *own* light', sub: 'Aula · captured from the real app', style: 'hero' },
    { start: 3.9, dur: 1.8, text: 'Today’s plan, made for you', style: 'caption' },
    { start: 6.6, dur: 1.9, text: 'Every course *lights up*', sub: 'pixel art that comes alive', style: 'caption' },
    { start: 11.0, dur: 2.2, text: 'Aula', sub: 'macOS · Windows · Linux', style: 'hero' }
  ],
  sun: [
    { t: 2.0, at: [1100, 1180], r: 0 },
    { t: 2.8, at: 'mark:plan', r: 0, style: 'halo' },
    { t: 3.6, at: 'mark:plan', r: 14, style: 'halo', ease: 'inOut' },
    { t: 5.0, at: 'mark:plan', r: 14, style: 'halo' },
    { t: 5.6, at: 'mark:plan', r: 0, style: 'halo' }
  ],
  cursor: 'sun',
  drift: 0.01,
  stamps: [
    { t: 2.3, text: 'Monday · 8:10 AM' },
    { t: 9.2, text: 'Monday · 10:30 PM' }
  ],
  paper: [
    { t: 0, color: '#F6EFE4' },
    { t: 8.6, color: '#F3E6D3' },
    { t: 9.4, color: '#15110F' }
  ],
  frames: [
    { t: 0, frame: 'mac' },
    { t: 10.0, frame: 'windows' },
    { t: 10.6, frame: 'linux' }
  ],
  music: {
    bpm: 100,
    root: 62,
    chords: ['Dsus2', 'D', 'A/C#', 'Bm', 'Bm', 'G', 'Dadd9'],
    sections: [
      { bar: 1, style: 'dawn' },
      { bar: 2, style: 'day', claps: true },
      { bar: 5, style: 'night' }
    ],
    seed: 26,
    cues: [
      { t: BAR, kind: 'motif', voice: 'marimba' },
      { t: 5.4, kind: 'hit' },
      { t: 9.2, kind: 'swell' },
      { t: 9.8, kind: 'motif', voice: 'pluck', minor: true, octave: -1 },
      { t: 12.0, kind: 'end' }
    ]
  },
  outputs: [{ name: 'demo-720', size: [1280, 720], fps: 30, bitrate: 2.4e6, audioBitrate: 96000, maxMB: 5, fadeIn: 0.3, fadeOut: 0.5 }]
})
