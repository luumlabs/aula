// Demo de 90 segundos para la portada del README (docs/media/demo/aula-demo-90s.mp4):
// creación de un curso a partir de cuatro archivos (acelerada), lección paso a paso con figura matemática y ejemplo
// resuelto, ejercicio que detecta un error típico, cuaderno de errores, tarjetas con repaso espaciado, simulacro,
// Cursos y Hoy con la nueva interfaz editorial y el icono «El umbral».
//   npm run build && node scripts/video/render.ts scripts/video/montage/demo-90s.ts --app out --jobs 1
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineMontage, type TimedAction } from './types.ts'
import { markWhere, PIXEL_IDLE_OFF, typeInto } from './aula-film-js.ts'
import { markSel } from './aula-v5-js.ts'
import { clockAt } from '../world/worlds.ts'

const COURSE = 'exam-2-math112'
const ENV_AI = { AULA_FAKE_AI: '1', AULA_FAKE_AI_DELAY_MS: '25', AULA_FAKE_TEAM_DELAY_MS: '650' }

/** Cuatro apuntes reales en disco temporal para la toma de creación del curso (deterministas). */
function demoMaterials(): string[] {
  const dir = join(tmpdir(), 'aula-demo90-materials')
  mkdirSync(dir, { recursive: true })
  const files: [string, string][] = [
    [
      'PSY 210 Lecture notes, weeks 1-6.txt',
      'PSY 210 — Statistics for Psychology (Weeks 1–6)\n\nDescriptive statistics: mean, median, standard deviation, z-scores and sampling distributions. Central limit theorem and confidence intervals for the population mean.\nHypothesis testing: null and alternative hypotheses, p-values, Type I and Type II errors, statistical power, and effect size (Cohen d).\n'
    ],
    [
      'Week 7 slides - t-tests.txt',
      'Week 7 Slides — One-sample, independent-samples and paired-samples t-tests.\nDegrees of freedom: df = n - 1 for one-sample and paired t-tests; Welch correction when variances are unequal.\n'
    ],
    [
      'Whiteboard - paired t-test.txt',
      'Whiteboard notes: Paired t-test formula t = (d_bar - 0) / (s_d / sqrt(n)). Use when the same participants are measured before and after an intervention.\n'
    ],
    [
      'Lecture 8 - ANOVA.txt',
      'Lecture 8 — One-way ANOVA: partitioning variance into between-groups (MS_between) and within-groups (MS_within). F-ratio = MS_between / MS_within, post-hoc Tukey HSD comparisons.\n'
    ]
  ]
  return files.map(([name, body]) => {
    const p = join(dir, name)
    writeFileSync(p, body)
    return p
  })
}

const MATERIALS = demoMaterials()
const clickAt = (t: number, to: string | [number, number], dur = 0.45): TimedAction => ({ at: +(t - dur).toFixed(3), do: 'click', to, dur, soft: true })
const moveAt = (t: number, to: string | [number, number], dur = 0.55): TimedAction => ({ at: +(t - dur).toFixed(3), do: 'move', to, dur, soft: true })
const evalAt = (t: number, js: string): TimedAction => ({ at: +t.toFixed(3), do: 'eval', js })

export default defineMontage({
  name: 'aula-demo-90s',
  fps: 30,
  size: [1920, 1080],
  bitrate: 720_000,
  maxMB: 10,
  theme: 'light',
  duration: 90.0,
  cameraEase: 'smooth',
  cursor: 'sun',
  captionBand: 956,
  paper: [{ t: 0, color: '#FAF8F3' }],
  frames: [{ t: 0, frame: 'mac' }],
  takes: {
    create: {
      duration: 27.0,
      lang: 'en',
      theme: 'light',
      viewport: [1440, 900],
      clock: clockAt(0, 9, 30),
      mainClock: true,
      env: ENV_AI,
      setup: [{ do: 'navigate', route: { name: 'create' } }, { do: 'eval', js: PIXEL_IDLE_OFF }],
      actions: [
        clickAt(1.0, 'input[placeholder^="Calculus"]', 0.45),
        evalAt(1.15, typeInto('input[placeholder^="Calculus"]', 'Statistics for psychology, final in May', 24)),
        clickAt(3.4, 'text:University', 0.45),
        moveAt(4.4, 'text:Choose files', 0.55),
        { at: 4.55, do: 'files', selector: 'input[type="file"]', paths: MATERIALS },
        { at: 6.7, do: 'scroll', to: [720, 520], dy: 280, dur: 0.6 },
        moveAt(7.6, 'text:Create course', 0.5),
        clickAt(8.15, 'text:Create course', 0.25),
        moveAt(13.0, [560, 420], 0.9),
        moveAt(19.0, [960, 420], 0.9),
        moveAt(24.5, 'text:Start studying', 0.7)
      ]
    },
    learn: {
      duration: 28.5,
      lang: 'en',
      theme: 'light',
      viewport: [1440, 900],
      clock: clockAt(0, 10, 15),
      mainClock: true,
      env: ENV_AI,
      setup: [{ do: 'navigate', route: { name: 'study', id: COURSE, mode: 'learn', skill: 'reference-angles' } }, { do: 'eval', js: PIXEL_IDLE_OFF }],
      actions: [
        evalAt(0.5, markSel('vt-a', '[data-predict-open] button, [data-predict-open] [role="button"], [data-predict-open] [role="radio"]', 0)),
        moveAt(2.2, '#vt-a', 0.65),
        clickAt(2.7, '#vt-a', 0.25),
        moveAt(4.9, 'text:Continue', 0.55),
        clickAt(5.45, 'text:Continue', 0.25),
        moveAt(9.8, 'text:Continue', 0.55),
        clickAt(10.35, 'text:Continue', 0.25),
        moveAt(12.6, 'text:Show the first step', 0.55),
        clickAt(13.15, 'text:Show the first step', 0.25),
        { at: 15.8, do: 'navigate', route: { name: 'study', id: COURSE, mode: 'practice', skill: 'exact-trig-values' } },
        evalAt(17.2, markSel('vt-p0', '[role="radio"]', 0)),
        moveAt(18.0, '#vt-p0', 0.65),
        clickAt(18.5, '#vt-p0', 0.25),
        evalAt(19.0, markWhere('vt-chk', 'button', 'Check')),
        moveAt(19.6, '#vt-chk', 0.5),
        clickAt(20.0, '#vt-chk', 0.25),
        moveAt(23.2, [740, 560], 0.8)
      ]
    },
    review: {
      duration: 33.5,
      lang: 'en',
      theme: 'light',
      viewport: [1440, 900],
      clock: clockAt(0, 11, 0),
      mainClock: true,
      env: ENV_AI,
      setup: [{ do: 'navigate', route: { name: 'course', id: COURSE, tab: 'mistakes' } }, { do: 'eval', js: PIXEL_IDLE_OFF }],
      actions: [
        moveAt(2.2, [820, 320], 0.8),
        moveAt(5.2, [820, 480], 0.8),
        { at: 7.4, do: 'navigate', route: { name: 'study', id: COURSE, mode: 'cards' } },
        moveAt(9.8, [720, 420], 0.6),
        { at: 10.6, do: 'key', key: 'Space' },
        evalAt(11.1, markWhere('vt-good', 'button', 'Good')),
        clickAt(12.8, '#vt-good', 0.55),
        { at: 15.2, do: 'navigate', route: { name: 'study', id: COURSE, mode: 'exam' } },
        moveAt(17.8, 'text:Start the mock exam', 0.6),
        clickAt(19.0, 'text:Start the mock exam', 0.25),
        { at: 22.0, do: 'navigate', route: { name: 'courses' } },
        moveAt(23.5, [340, 360], 0.7),
        clickAt(25.2, 'text:Today', 0.55),
        moveAt(28.0, 'text:Start the plan', 0.7),
        moveAt(30.6, [520, 560], 0.8)
      ]
    }
  },
  // Prólogo: el icono «El umbral» se dibuja, sale el sol ladrillo y se abre en la ventana
  prologue: {
    start: 0,
    end: 3.6,
    size: 300,
    at: [0.5, 0.39],
    draw: [0.15, 1.1],
    rise: [1.1, 1.85],
    title: 'Aula',
    sub: 'Your notes become a course. Then Aula studies it with you.',
    titleAt: 1.65,
    morph: 0.75
  },
  clips: [
    // 1 · Crear curso (parte 1: título y 4 archivos, velocidad real)
    {
      take: 'create',
      start: 2.85,
      dur: 8.4,
      from: 0.2,
      camera: [
        { t: 0, zoom: 'fit' },
        { t: 3.4, zoom: 1.07, focus: [680, 440] },
        { t: 5.0, zoom: 1.07, focus: [680, 440] },
        { t: 8.4, zoom: 1.09, focus: [680, 510] }
      ]
    },
    // 2 · Creación del curso por el equipo de agentes (repartido hasta «Your course is ready»)
    {
      take: 'create',
      start: 11.25,
      dur: 9.25,
      from: 8.2,
      speed: 0.72,
      enter: { kind: 'content', dur: 0.2 },
      camera: [
        { t: 0, zoom: 1.04, focus: [720, 440] },
        { t: 9.25, zoom: 'fit' }
      ]
    },
    // 3 · Lección paso a paso (pregunta de intuición, figura trazada y ejemplo resuelto)
    {
      take: 'learn',
      start: 20.5,
      dur: 15.3,
      from: 0.3,
      enter: { kind: 'content', dur: 0.25 },
      camera: [
        { t: 0, zoom: 1.08, focus: [720, 430] },
        { t: 6.0, zoom: 1.12, focus: [720, 460] },
        { t: 9.0, zoom: 1.12, focus: [720, 460] },
        { t: 15.3, zoom: 1.08, focus: [720, 430] }
      ]
    },
    // 4 · Ejercicio con corrección instantánea y error típico
    {
      take: 'learn',
      start: 35.8,
      dur: 12.2,
      from: 16.4,
      enter: { kind: 'content', dur: 0.25 },
      camera: [
        { t: 0, zoom: 1.1, focus: [720, 450] },
        { t: 12.2, zoom: 1.14, focus: [720, 480] }
      ]
    },
    // 5 · Cuaderno de errores
    {
      take: 'review',
      start: 48.0,
      dur: 7.2,
      from: 0.2,
      enter: { kind: 'content', dur: 0.25 },
      camera: [
        { t: 0, zoom: 1.06, focus: [720, 430] },
        { t: 7.2, zoom: 'fit' }
      ]
    },
    // 6 · Tarjetas con repaso espaciado
    {
      take: 'review',
      start: 55.2,
      dur: 7.6,
      from: 7.9,
      enter: { kind: 'content', dur: 0.25 },
      camera: [
        { t: 0, zoom: 1.08, focus: [720, 440] },
        { t: 7.6, zoom: 1.04, focus: [720, 440] }
      ]
    },
    // 7 · Simulacro con la estructura del examen real
    {
      take: 'review',
      start: 62.8,
      dur: 6.6,
      from: 15.6,
      enter: { kind: 'content', dur: 0.25 },
      camera: [
        { t: 0, zoom: 1.06, focus: [720, 430] },
        { t: 6.6, zoom: 'fit' }
      ]
    },
    // 8 · Tus cursos y la pantalla Hoy editorial
    {
      take: 'review',
      start: 69.4,
      dur: 12.4,
      from: 22.3,
      enter: { kind: 'content', dur: 0.25 },
      camera: [
        { t: 0, zoom: 'fit' },
        { t: 5.5, zoom: 'fit' },
        { t: 9.0, zoom: 1.06, focus: [700, 420] },
        { t: 10.4, zoom: 1.06, focus: [700, 420] },
        { t: 12.4, zoom: 'fit' }
      ]
    }
  ],
  titles: [
    { start: 6.6, dur: 4.5, text: 'Drop in whatever you *have.*', sub: 'Lecture notes, slides, whiteboard photos, class recordings', style: 'caption' },
    { start: 11.8, dur: 8.2, text: 'It builds the *course* from them.', sub: 'Course creation shown sped up', style: 'caption' },
    { start: 21.2, dur: 5.0, text: 'Intuition first: *guess,* then see why.', style: 'caption' },
    { start: 26.6, dur: 4.6, text: 'Figures plotted from the *real math.*', style: 'caption' },
    { start: 31.6, dur: 4.0, text: 'A worked *example* before you try one.', style: 'caption' },
    { start: 36.4, dur: 4.8, text: 'Then it’s *your turn.*', sub: 'Checked the moment you answer', style: 'caption' },
    { start: 41.6, dur: 6.2, text: 'It spots the *common mistake.*', sub: 'and explains why', style: 'caption' },
    { start: 48.6, dur: 6.2, text: 'Every mistake goes into your *notebook.*', sub: 'and comes back after 1, 3, 7, 16 and 35 days', style: 'caption' },
    { start: 55.8, dur: 6.6, text: 'Flashcards on *spaced repetition.*', sub: 'each one scheduled by how well you remember it', style: 'caption' },
    { start: 63.4, dur: 5.6, text: 'A mock exam shaped like the *real one.*', sub: 'same minutes, points and topics', style: 'caption' },
    { start: 70.2, dur: 11.0, text: 'Every day: your *plan,* your streak, the countdown.', style: 'caption' },
    { start: 84.8, dur: 4.9, text: 'Free · AGPL-3.0 · No account · No tracking', sub: 'macOS · Windows · Linux, plus iPad and iPhone', style: 'caption' }
  ],
  finale: {
    start: 81.8,
    dur: 3.8,
    morph: 1.5,
    rise: [83.3, 84.5],
    sunFrom: 'cursor',
    size: 300,
    at: [0.5, 0.36],
    title: 'Aula',
    sub: 'github.com/luumlabs/aula'
  },
  music: {
    bpm: 100,
    root: 62,
    chords: ['Dsus2', 'D', 'A/C#', 'Bm', 'G', 'Dadd9', 'A', 'Bm', 'G', 'Dadd9'],
    sections: [
      { bar: 1, style: 'dawn' },
      { bar: 5, style: 'day', claps: false },
      { bar: 24, style: 'piano' },
      { bar: 30, style: 'day', claps: false },
      { bar: 35, style: 'end' }
    ],
    seed: 90,
    clicks: -18,
    sfx: -16,
    cues: [
      { t: 1.2, kind: 'motif', voice: 'marimba' },
      { t: 20.5, kind: 'swell' },
      { t: 48.0, kind: 'motif', voice: 'piano' },
      { t: 69.4, kind: 'swell' },
      { t: 83.3, kind: 'motif', voice: 'bell' },
      { t: 88.2, kind: 'end' }
    ]
  },
  outputs: [{ name: 'aula-demo-90s-web', bitrate: 740_000, audioBitrate: 96000, maxMB: 10, stills: [2.7] }]
})
