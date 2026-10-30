// La película V6 de Aula (GitHub, 16:9): la app DENTRO DE UN PORTÁTIL (siempre entera y nítida), la cámara gira a su
// alrededor y se acerca a la pantalla; titulares en el hueco que deja el portátil; cartelas, día y noche y cierre del v3;
// música: el sintetizador ORIGINAL del v3 (sound-v3) a 100 BPM, desde la hoja de este montaje. Guion:
// scratchpad/aula2/video/v6/GUION.md. 100 BPM (compás 2,4 s), compás 1 en t = 0; ≈ 2:12.
// Solo compone sobre las tomas de 60 fps ya capturadas (las de la V5, clonadas con cp -c en work/aula-v6-film/takes):
//   AULA_VIDEO_NO_WORLDS=1 AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-v6-film.ts --reuse --only cues
//   node scripts/video/sound-v3/render.ts scripts/video/work/aula-v6-film/cuesheet.json scripts/video/work/aula-v6-film/soundtrack.wav
//   AULA_VIDEO_NO_WORLDS=1 AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-v6-film.ts --reuse --draft
import { LID_OPEN, laptopView } from './laptop.ts'
import { drawGroup } from './draw.ts'
import { naclTake } from './v6-hfr.ts'
import type { Clip, LaptopKey, Montage, Ramp, Section, SfxCue, Title } from './types.ts'

// solo se compone: importar la V5 (definiciones de las tomas) no reescribe las plantillas de work/worlds
process.env.AULA_VIDEO_NO_WORLDS = '1'
const v5 = await import('./aula-v5-film.ts')
const film5 = v5.default
const { learn: L, see: S, ask: A, always: W, docs: D, every: E } = v5.TAKE_AT

// ——— rejilla: 100 BPM, compás 2,4 s, pulso 0,6 s; compás 1 en t = 0 ———
export const BPM = 100
export const BEAT = 0.6
export const BAR = 2.4
/** Segundo del vídeo del compás `bar` (1…), pulso `beat` (1…4) y fracción de pulso. */
export const V = (bar: number, beat = 1, frac = 0): number => +((bar - 1) * BAR + (beat - 1 + frac) * BEAT).toFixed(4)
/** Un fotograma a 60 fps: separa dos claves de cámara en un corte seco. */
const EPS = 1 / 60
const FPS = Number(process.env.AULA_VIDEO_FPS ?? 60)
const NAME = 'aula-v6-film'
const NIGHT = '#15110F'
const DAY = '#F6EFE4'

type View = '3/4-right' | '3/4-left' | 'front' | 'screen'

/** La película para un cuadro (la usan también las pruebas de geometría sin componer). */
export function buildFilm(size: [number, number] = [1920, 1080]): Montage {
  const shape = { size } as Montage
  const view = (v: View, over: Partial<LaptopKey> = {}) => laptopView(shape, v, over)
  const R = view('3/4-right')
  const Lf = view('3/4-left')
  const SCR = view('screen')

  // ——— la cámara del portátil: una sola, en tiempo del vídeo ———
  const keys: LaptopKey[] = []
  const k = (t: number, key: Omit<LaptopKey, 't'>) => keys.push({ t: +t.toFixed(4), ...key })
  /** 3/4 con una órbita lenta (`deg` grados de giro a lo largo del plano). */
  const side = (v: '3/4-right' | '3/4-left', dyaw: number, grow = 1): Omit<LaptopKey, 't'> => {
    const b = v === '3/4-right' ? R : Lf
    return { ...b, yaw: b.yaw! + dyaw, frame: +(b.frame! * grow).toFixed(4) }
  }
  const screen = (drift = 0): Omit<LaptopKey, 't'> => ({ ...SCR, fill: +Math.min(0.99, SCR.fill! + drift).toFixed(4) })
  const front = (over: Partial<LaptopKey> = {}): Omit<LaptopKey, 't'> => view('front', over)

  // C4–C5 · la revelación: el icono del prólogo ES la pantalla; la cámara empieza dentro de ella y se aleja hasta 3/4
  k(V(4), { ...SCR, fill: 2.1, lid: LID_OPEN })
  k(V(5), side('3/4-right', -5))
  k(V(6) - EPS, side('3/4-right', 3, 1.03))
  // C6.3–C10 · el calendario: 3/4 izquierda → empujón → la pantalla (clic en «Prepare for this exam») → vuelta a la derecha
  k(V(6, 3), side('3/4-left', 5))
  k(V(7, 3), side('3/4-left', -1, 1.03))
  k(V(8), screen())
  k(V(9), screen(0.012))
  k(V(9, 2), side('3/4-right', -3))
  k(V(10) - EPS, side('3/4-right', 1))
  // C10 · el equipo de agentes (izquierda: el titular y los compañeros que se dibujan en el hueco) · C11 «Every answer, verified»
  k(V(10), side('3/4-left', 5))
  k(V(11) - EPS, side('3/4-left', -2, 1.03))
  k(V(11), side('3/4-right', -5))
  k(V(12), side('3/4-right', 2, 1.03))
  // C13 · lección (derecha) · C14–C16 práctica (izquierda → empujón) y el tutor en la pantalla · C17 tarjetas · C18 simulacro
  k(V(13), side('3/4-right', -5))
  k(V(14) - EPS, side('3/4-right', 2, 1.03))
  k(V(14), side('3/4-left', 5))
  k(V(15), side('3/4-left', 0, 1.03))
  k(V(15, 3), screen())
  k(V(17), screen(0.016))
  k(V(17, 2), side('3/4-right', -3))
  k(V(18) - EPS, side('3/4-right', 2))
  k(V(18), side('3/4-left', 5))
  k(V(19), side('3/4-left', -2, 1.03))
  // C20–C21 · la célula (derecha) y el empujón al «Find it» · C22 NaCl · C23–C24 simulaciones · C25 tiempo y mapa · C26 Krebs · C27 diapositivas
  k(V(20), side('3/4-right', -5))
  k(V(21), side('3/4-right', 0, 1.02))
  k(V(21, 2), screen())
  k(V(22) - EPS, screen(0.01))
  k(V(22), side('3/4-left', 5))
  k(V(23) - EPS, side('3/4-left', -2, 1.03))
  k(V(23), side('3/4-right', -5))
  k(V(24), side('3/4-right', 1, 1.03))
  k(V(24, 3), screen())
  k(V(25), screen(0.008))
  k(V(25, 2), side('3/4-left', 3))
  k(V(26) - EPS, side('3/4-left', -1))
  k(V(26), side('3/4-right', -5))
  k(V(27) - EPS, side('3/4-right', 2, 1.03))
  k(V(27), side('3/4-left', 5))
  k(V(28), side('3/4-left', -2, 1.03))
  // C29–C31 · el chat (derecha → empujón → vuelta a la izquierda) · C32 la gráfica · C33 el quiz en la pantalla · C34 memoria
  k(V(29), side('3/4-right', -5))
  k(V(30), side('3/4-right', 1, 1.03))
  k(V(30, 3), screen())
  k(V(31), screen(0.008))
  k(V(31, 2), side('3/4-left', 3))
  k(V(32) - EPS, side('3/4-left', -2))
  k(V(32), side('3/4-right', -5))
  k(V(33), side('3/4-right', 0, 1.02))
  k(V(33, 3), screen())
  k(V(34), screen(0.008))
  k(V(34, 2), side('3/4-left', 3))
  k(V(35), side('3/4-left', -1, 1.02))
  // C36 Inbox · C37 juntos · C38 siempre activa · C39 automatización en la pantalla
  k(V(36), side('3/4-right', -5))
  k(V(37) - EPS, side('3/4-right', 2, 1.03))
  k(V(37), side('3/4-left', 5))
  k(V(38) - EPS, side('3/4-left', -2, 1.03))
  k(V(38), side('3/4-right', -5))
  k(V(39), side('3/4-right', 0, 1.02))
  k(V(39, 3), screen())
  k(V(40), screen(0.008))
  // C41 el simulacro en PDF · C42–C43 el lector (izquierda → empujón: la respuesta en la pantalla)
  k(V(41), side('3/4-right', -5))
  k(V(42) - EPS, side('3/4-right', 2, 1.03))
  k(V(42), side('3/4-left', 5))
  k(V(43), side('3/4-left', 0, 1.03))
  k(V(43, 3), screen())
  k(V(44), screen(0.01))
  // C45 plataformas · C46 tu IA · C48 idiomas · C49 Mac/Windows/Linux
  k(V(45), side('3/4-right', -5))
  k(V(46) - EPS, side('3/4-right', 2, 1.03))
  k(V(46), side('3/4-left', 5))
  k(V(47), side('3/4-left', -2, 1.03))
  k(V(48), side('3/4-right', -5))
  k(V(49) - EPS, side('3/4-right', 2, 1.03))
  k(V(49), side('3/4-left', 5))
  k(V(50), side('3/4-left', -2, 1.03))
  // C52 · el cierre: de frente; la cámara entra en la pantalla, que se hace el icono del final (laptop.close)
  k(V(52), front({ pitch: 8 }))
  k(V(52, 3), screen(-0.08))
  k(V(53), { ...SCR, fill: 2.1 })

  // ——— planos ———
  const clips: Clip[] = []
  const CUT: Clip['enter'] = { kind: 'cut', dur: 0 }
  const CONTENT: Clip['enter'] = { kind: 'content', dur: 0.2 }
  const light = (style: 'dusk' | 'dawn' | 'arch' | 'horizon' | 'diagonal'): Clip['enter'] => ({ kind: 'light', style, dur: BEAT })
  const shot = (take: string, from: number, t0: number, t1: number, enter: Clip['enter'] = CUT, ramps?: Ramp[]) =>
    clips.push({ take, start: +t0.toFixed(4), dur: +(t1 - t0).toFixed(4), from: +from.toFixed(3), layout: { kind: 'laptop' }, enter, ...(ramps ? { ramps } : {}) })
  // 01 · Plan
  shot('morning', 0.3, V(4), V(6))
  shot('morning', 8.6, V(6, 3), V(10))
  shot('morning', 27.6, V(10), V(11))
  shot('morning', 38.3, V(11), V(12))
  // 02 · Learn (noche)
  shot('learn', L.lesson - 0.3, V(13), V(14), light('dusk'))
  shot('learn', L.practice, V(14), V(16))
  shot('learn', L.tutor - 0.2, V(16), V(17), CONTENT)
  shot('learn', L.cards - 0.1, V(17), V(18), CONTENT)
  shot('learn', L.exam - 0.3, V(18), V(19))
  // 03 · See it (día)
  shot('main', 44.0, V(20), V(22), light('dawn'), [{ from: 2.6, to: 4.4, at: 3.2, slow: 0.25 }])
  // el NaCl a cámara lenta con la toma a 250 fps (sin fotogramas repetidos)
  shot('nacl', 3.2, V(22), V(23), CUT, [{ from: 0.2, to: 2.2, at: 1.2, slow: 0.3 }])
  shot('see', S.proj - 0.2, V(23), V(24))
  shot('see', S.pk - 0.2, V(24), V(24, 3), CONTENT)
  shot('see', S.sd - 0.2, V(24, 3), V(25), CONTENT)
  shot('see', S.timeline - 0.1, V(25), V(25, 3), CONTENT)
  shot('see', S.map - 0.1, V(25, 3), V(26), CONTENT)
  shot('see', S.krebs - 0.2, V(26), V(27))
  shot('see', S.slides - 0.2, V(27), V(28))
  // 04 · Ask (noche)
  shot('main', 72.8, V(29), V(32), light('arch'))
  shot('ask', A.graph - 1.6, V(32), V(33))
  shot('main', 82.0, V(33), V(34))
  shot('ask', A.memory - 0.2, V(34), V(35), CONTENT)
  // 05 · Always on (día)
  shot('always', W.inbox, V(36), V(37), light('horizon'))
  shot('always', W.together, V(37), V(38))
  shot('always', W.alwayson - 0.2, V(38), V(39))
  shot('always', W.auto - 0.1, V(39), V(40), CONTENT)
  // 06 · Documents (noche)
  shot('docs', D.export, V(41), V(41, 3), light('diagonal'))
  shot('docs', D.page2, V(41, 3), V(42), CONTENT)
  shot('docs', D.reader - 0.2, V(42), V(44))
  // 07 · Everywhere (día)
  shot('main', 90.0, V(45), V(46), light('arch'))
  shot('main', 92.4, V(46), V(47))
  shot('every', E['lang-ja'] + 0.3, V(48), V(48, 2))
  shot('every', E['lang-ru'] + 0.3, V(48, 2), V(48, 3), CONTENT)
  shot('every', E['lang-ar'] + 0.3, V(48, 3), V(48, 4), CONTENT)
  shot('every', E.spanish, V(48, 4), V(49), CONTENT)
  shot('main', 101.8, V(49), V(50))
  // el cierre: Today de frente, empujón y la pantalla se hace el icono
  shot('main', 101.8, V(52), V(53))

  // ——— titulares (en el hueco que deja el portátil; nunca encima de la pantalla) ———
  const titles: Title[] = []
  const kn = (text: string, sideT: 'left' | 'right', t0: number, t1: number, extra: Partial<Title> = {}) =>
    titles.push({ start: +t0.toFixed(4), dur: +(t1 - t0 - 0.05).toFixed(4), text, style: 'keynote', side: sideT, underline: false, ...extra })
  const ty = (text: string, t0: number, t1: number, extra: Partial<Title> = {}) =>
    titles.push({ start: +t0.toFixed(4), dur: +(t1 - t0 - 0.05).toFixed(4), text, style: 'type', underline: false, ...extra })
  const UL = { underline: {} }
  // el gancho: «Notes.» ya entero en el fotograma 0
  titles.push({ start: -0.42, dur: +(BAR + 0.42 - 0.05).toFixed(4), text: 'Notes. Slides. PDFs. Whiteboard photos.', style: 'type', underline: false, stagger: 0.48 })
  ty('And an exam in *nine days.*', V(2), V(3), { stagger: BEAT / 2, ...UL })
  ty('Meet *Aula.*', V(3, 2), V(4), { size: 140, at: [0.5, 0.74], ...UL })
  kn('Your day at a *glance.*', 'right', V(5), V(6))
  kn('It knows your *exams.*', 'left', V(6, 3), V(7, 3))
  kn('One click. *Filled in.*', 'right', V(9, 2), V(10))
  kn('A team builds it *for you.*', 'left', V(10), V(11))
  kn('Every answer, *verified.*', 'right', V(11), V(12), UL)
  kn('Lessons that make it *click.*', 'right', V(13), V(14))
  kn('Mistakes, *explained.*', 'left', V(14), V(15), UL)
  kn('Flashcards that *stick.*', 'right', V(17, 2), V(18))
  kn('Mock exams, *timed.*', 'left', V(18), V(19))
  kn('Diagrams you can *explore.*', 'right', V(20), V(21))
  kn('Molecules in *3D.*', 'left', V(22), V(23))
  kn('Simulations you can *play* with.', 'right', V(23), V(24))
  kn('Timelines and *maps.*', 'left', V(25, 2), V(26))
  kn('Processes, step by *step.*', 'right', V(26), V(27))
  kn('Slides, ready to *present.*', 'left', V(27), V(28))
  kn('Just ask *Aula.*', 'right', V(29), V(30), UL)
  kn('It acts. You *approve.*', 'left', V(31, 2), V(32))
  kn('Answers you can *see.*', 'right', V(32), V(33))
  kn('It remembers how you *learn.*', 'left', V(34, 2), V(35))
  kn('Done while you were *away.*', 'right', V(36), V(37))
  kn('New homework? Do it *together.*', 'left', V(37), V(38))
  kn('As quiet as you *like.*', 'right', V(38), V(39))
  kn('Practice exams, *printed.*', 'right', V(41), V(42))
  kn('Read with Aula *beside you.*', 'left', V(42), V(43))
  kn('Connects to where you *study.*', 'right', V(45), V(46))
  kn('Any AI. Even *offline.*', 'left', V(46), V(47))
  kn('Study *anything.*', 'left', V(47), V(48), UL)
  kn('Speaks your *language.*', 'right', V(48), V(49), UL)
  kn('Mac. Windows. *Linux.*', 'left', V(49), V(50))
  ty('Free.', V(50), V(50, 3))
  ty('Open source.', V(50, 3), V(51))
  ty('*Yours.*', V(51), V(52), UL)
  const DURATION = +V(56).toFixed(2)
  titles.push({ start: V(54), dur: +(DURATION - V(54)).toFixed(4), text: 'github.com/luumlabs/aula', sub: 'Free & open source · macOS, Windows and Linux', style: 'caption', at: [0.5, 0.86] })

  // ——— cartelas, luz y papel ———
  const CARDS: [number, number, number, string, ('dusk' | 'dawn' | 'arch' | 'horizon' | 'diagonal')?][] = [
    [6, 1, 2, 'From a date on your calendar to a finished course.'],
    [12, 1, 4, 'Lessons, practice and review that adapt to you.', 'dusk'],
    [19, 1, 4, 'Visuals you can touch, for every subject.', 'dawn'],
    [28, 1, 4, 'Just talk to Aula.', 'arch'],
    [35, 1, 4, 'Like a tutor who never leaves.', 'horizon'],
    [40, 1, 4, 'Print your course. Read with Aula.', 'diagonal'],
    [44, 1, 4, 'Your platform, your AI, your language.', 'arch']
  ]
  const chapters = {
    names: ['Plan', 'Learn', 'See it', 'Ask', 'Always on', 'Documents', 'Everywhere'],
    cards: CARDS.map(([bar, beat, beats, sub], i) => ({ t: V(bar, beat), dur: +(beats * BEAT).toFixed(4), n: i + 1, sub }))
  }
  // la cartela va sobre el papel del capítulo anterior; el primer plano del capítulo entra con su luz y cambia el cuarto
  const paper: { t: number; color: string }[] = [{ t: 0, color: NIGHT }, { t: V(3) - 0.01, color: NIGHT }, { t: +(V(3) + 0.45).toFixed(4), color: DAY }]
  let cur = DAY
  for (const [bar, , beats, , l] of CARDS) {
    if (!l) continue
    const next = cur === DAY ? NIGHT : DAY
    const t = V(bar) + beats * BEAT
    paper.push({ t: +(t - 0.01).toFixed(4), color: cur }, { t: +(t + BEAT).toFixed(4), color: next })
    cur = next
  }
  // «Study anything.» (C47) va sin portátil: el papel ya es de día

  const sections: Section[] = [
    { t: 0, name: 'Hook', mood: 'intro' }, { t: V(3), name: 'Meet Aula', mood: 'drop' }, { t: V(4), name: 'Plan', mood: 'day' },
    { t: V(13), name: 'Learn', mood: 'night' }, { t: V(20), name: 'See it', mood: 'day' }, { t: V(29), name: 'Ask', mood: 'night' },
    { t: V(36), name: 'Always on', mood: 'day' }, { t: V(41), name: 'Documents', mood: 'night' }, { t: V(45), name: 'Everywhere', mood: 'day' },
    { t: V(53), name: 'Outro', mood: 'outro' }
  ]
  const sfx: SfxCue[] = [
    { t: V(10), type: 'count', intensity: 0.5, note: 'el equipo avanza' },
    { t: V(18, 3), type: 'count', intensity: 0.5, note: 'el simulacro empieza' },
    ...[2, 3, 4].map((b): SfxCue => ({ t: V(49, b), type: 'impact', intensity: 0.55, note: 'Mac · Windows · Linux' })),
    { t: V(50), type: 'impact', intensity: 0.6, note: 'Free.' },
    { t: V(50, 3), type: 'impact', intensity: 0.6, note: 'Open source.' },
    { t: V(51), type: 'impact', intensity: 0.8, note: 'Yours.' }
  ]

  return {
    name: NAME,
    fps: FPS,
    size,
    bitrate: 14e6,
    minTitle: 1.0,
    theme: 'light',
    duration: DURATION,
    takes: { ...film5.takes, nacl: naclTake },
    clips,
    titles,
    cursor: 'sun',
    drift: 0,
    cameraEase: 'smooth',
    laptop: {
      keys,
      reveal: { t: V(4), dur: BAR },
      close: { t: V(52, 3), dur: 2 * BEAT },
      // la cámara afloja con la toma en los momentos lentos (el acierto de «Find it» y el NaCl)
      ramps: [
        { from: V(20) + 2.6, to: V(20) + 4.4, at: V(20) + 3.2, slow: 0.25 },
        { from: V(22) + 0.2, to: V(22) + 2.2, at: V(22) + 1.2, slow: 0.3 }
      ]
    },
    // los compañeros de la app que se dibujan a pincel, trazo a trazo
    drawings: [
      // el equipo de agentes: uno por pulso bajo el titular, en el hueco izquierdo
      ...drawGroup({ t: V(10, 1, 0.5), who: ['companion:robot', 'companion:buho', 'companion:libro'], at: [[0.1, 0.8], [0.2, 0.8], [0.3, 0.8]], size: 150, stagger: 0.45, dur: 0.8, until: V(11) }),
      // de noche, junto al simulacro: el reloj se dibuja bajo «Mock exams, timed.»
      { who: 'companion:reloj', t: V(18, 2), dur: 1.2, until: V(19), at: [0.16, 0.76], size: 170 },
      // la cartela «Always on»: el farol junto al título (si el motor la dibuja encima de la cartela)
      { who: 'companion:farol', t: V(35), dur: 1.4, until: V(36), at: [0.3, 0.33], size: 170 },
      // el cierre: la luna y el gato a los lados del icono
      ...drawGroup({ t: V(53, 3), who: ['companion:luna', 'companion:gato'], at: [[0.33, 0.4], [0.67, 0.4]], size: 170, stagger: BEAT, dur: 1.2, after: 'alive' })
    ],
    // la ola de iconos pintados a cámara lenta en su centro
    slowmo: [{ from: V(47, 2), to: V(48), at: V(47, 3), slow: 0.35 }],
    hook: { start: 0, end: V(3), converge: [V(2, 3), V(3)], seed: 9, count: 36 },
    iconWave: { t: V(47, 2), end: V(48), dur: 1.2, area: [0.37, 0.08, 0.59, 0.84] },
    flashes: [V(3)],
    prologue: { start: V(3), end: V(4), size: 320, at: [0.5, 0.38], spring: true, rise: [V(3), V(3, 2)] },
    chapters,
    finale: { start: V(53), dur: 2 * BAR, size: 320, at: [0.5, 0.4], rise: [V(53), V(53, 2)], title: 'Aula', sub: 'Your study companion.', titleAt: V(53) },
    frames: [{ t: 0, frame: 'mac' }, { t: V(49, 2), frame: 'windows' }, { t: V(49, 3), frame: 'linux' }, { t: V(50), frame: 'mac' }],
    notices: [{ start: V(37, 1, 0.5), dur: 1.8, title: 'New assignment', body: 'Problem set 4 · MATH 101 · due Thursday', time: 'now', theme: 'light' }],
    paper,
    sections,
    sfx,
    pixelSfx: [],
    music: { bpm: BPM, offset: 0, root: 62, cues: [], wav: `work/${NAME}/soundtrack.wav`, asIs: true },
    outputs: [{ name: `${NAME}-web`, size: [1280, 720], fps: 30, bitrate: 1.35e6, maxMB: 27, audioBitrate: 128000 }]
  }
}

export default buildFilm()
