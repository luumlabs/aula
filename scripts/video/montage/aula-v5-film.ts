// La película V5 de Aula (GitHub, 16:9): tráiler de keynote con la interfaz real grande, una función por plano, un sonido
// por movimiento y la banda sonora compuesta para la imagen (SOUND, scripts/video/sound). Guion plano a plano:
// scratchpad/aula2/video/v5/GUION.md. 104 BPM, compás 1 en t = 0; ≈ 2:12 (versión 2, tras CRITIC-V5-1).
//   Animática: AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-v5-film.ts --app tree --reuse --soft --jobs 3
//   (las tomas `morning` y `main` son las de la película v2: se copian con `cp -c` a work/aula-v5-film/takes y se reutilizan)
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bpmGrid } from './grid.ts'
import film from './aula-film.ts'
import { answerPractice, markText, markWhere, typeInto } from './aula-film-js.ts'
import { markRange, markSel, NEW_CHAT, uiLanguage } from './aula-v5-js.ts'
import { defineMontage, type CameraKey, type Clip, type Route, type Section, type SfxCue, type Take, type TimedAction, type Title } from './types.ts'
import { buildV5World } from '../world/v5-worlds.ts'
import { clockAt } from '../world/worlds.ts'

// ——— rejilla: 104 BPM, 4/4, compás 1 en t = 0 ———
export const BPM = 104
const BARS = 59
const G0 = bpmGrid(BPM, (BARS * 4 * 60) / BPM, 0)
const BEAT = G0.beat
const BAR = G0.barDur
/** Segundo del vídeo del compás `bar` (1…), pulso `beat` (1…4) y fracción de pulso. */
const V = (bar: number, beat = 1, frac = 0): number => +G0.V(bar, beat, frac).toFixed(4)
const FPS = Number(process.env.AULA_VIDEO_FPS ?? 60)
const TRIG = 'exam-2-math112'
const BIO = 'biology-physics-visuals'
const HOME = buildV5World()
/** La banda sonora de SOUND (scripts/video/sound/render.ts sobre la hoja de efectos de este montaje), si ya existe. */
const WAV = join(dirname(fileURLToPath(import.meta.url)), '..', 'work', 'aula-v5-film', 'soundtrack.wav')
const ENV_AI = { AULA_FAKE_AI: '1', AULA_FAKE_AI_DELAY_MS: '25' }
const MEMORIES = ['Prefers a worked example before the theory', 'Mixes up radians and degrees under time pressure', 'Studies best in short blocks after dinner', 'Wants exact answers, no decimals']

// ——— acciones ———
const clickAt = (t: number, to: string | [number, number], dur = 0.5): TimedAction => ({ at: +(t - dur).toFixed(3), do: 'click', to, dur, soft: true })
const moveAt = (t: number, to: string | [number, number], dur = 0.6): TimedAction => ({ at: +(t - dur).toFixed(3), do: 'move', to, dur, soft: true })
const evalAt = (t: number, js: string): TimedAction => ({ at: +t.toFixed(3), do: 'eval', js })
const keyAt = (t: number, key: string): TimedAction => ({ at: +t.toFixed(3), do: 'key', key })

/** Una toma nueva por tramos: cada tramo navega (si tiene ruta), espera `lead` s a que la pantalla se asiente y deja
 *  `dur` s de material para el plano; `at[key]` es el segundo de la toma en el que empieza ese material. */
interface Seg {
  key: string
  route?: Route
  js?: string
  lead: number
  dur: number
  gap?: number
  acts?: (t: number) => TimedAction[]
}
function sequence(segs: Seg[]): { actions: TimedAction[]; at: Record<string, number>; duration: number } {
  const at: Record<string, number> = {}
  const actions: TimedAction[] = []
  let cur = 0.3
  for (const s of segs) {
    if (s.route) actions.push({ at: +cur.toFixed(3), do: 'navigate', route: s.route })
    if (s.js) actions.push(evalAt(cur, s.js))
    const t = cur + s.lead
    at[s.key] = +t.toFixed(3)
    actions.push(...(s.acts?.(t) ?? []))
    cur = t + s.dur + (s.gap ?? 0.3)
  }
  return { actions: actions.sort((a, b) => a.at - b.at), at, duration: +(cur + 0.6).toFixed(2) }
}
const take = (o: Partial<Take> & { seq: ReturnType<typeof sequence>; theme: 'light' | 'dark'; clock: string }): Take => ({
  duration: o.seq.duration, lang: 'en', theme: o.theme, viewport: [1440, 900], home: HOME, clock: o.clock, mainClock: true, env: ENV_AI,
  setup: [{ do: 'navigate', route: { name: 'home' } }, ...(o.setup ?? [])], actions: o.seq.actions, marks: o.marks
})

// ════════════ TOMAS NUEVAS ════════════
// 02 · Learn (oscuro): lección (pregunta → respuesta → por qué), práctica con el error típico, el tutor, tarjetas, simulacro
const LEARN = sequence([
  {
    key: 'lesson', route: { name: 'study', id: TRIG, mode: 'learn', skill: 'reference-angles' }, lead: 2.0, dur: BAR,
    acts: (t) => [evalAt(t - 0.8, markSel('vt-a', '[data-predict-open] button, [data-predict-open] [role="button"]', 0)), moveAt(t + 0.9, '#vt-a', 0.6), clickAt(t + 2 * BEAT, '#vt-a', 0.2)]
  },
  {
    key: 'practice', route: { name: 'study', id: TRIG, mode: 'practice', skill: 'exact-trig-values' }, lead: 2.0, dur: 2 * BAR, gap: 0,
    acts: (t) => [moveAt(t + 0.4, 'input[placeholder="Your answer"]', 0.5), evalAt(t + 0.5, answerPractice('wrong', 10)), moveAt(t + BAR + 2 * BEAT, 'text:Explain my mistake', 0.7), clickAt(t + 2 * BAR, 'text:Explain my mistake', 0.25)]
  },
  { key: 'tutor', lead: 3.2, dur: BAR },
  {
    key: 'cards', route: { name: 'course', id: TRIG, tab: 'cards' }, lead: 2.2, dur: BAR,
    acts: (t) => [clickAt(t - 0.4, 'text:Review now', 0.5), keyAt(t + 2 * BEAT, 'Space'), evalAt(t + 2 * BEAT + 0.1, markWhere('vt-good', 'button', 'Good')), clickAt(t + 3.5 * BEAT, '#vt-good', 0.4)]
  },
  {
    key: 'exam', route: { name: 'study', id: TRIG, mode: 'exam' }, lead: 2.0, dur: BAR,
    acts: (t) => [moveAt(t + 0.5, 'text:Start the mock exam', 0.5), clickAt(t + 2 * BEAT, 'text:Start the mock exam', 0.2)]
  }
])
const takeLearn = take({ seq: LEARN, theme: 'dark', clock: clockAt(0, 21, 30) })

// 03 · See it (claro): 3D, simulaciones con el deslizador que se mueve, línea de tiempo, mapa, Krebs paso a paso, diapositivas
const lesson = (id: string, skill: string): Route => ({ name: 'study', id, mode: 'learn', skill })
const slide = (t: number, idx: number, a: number, b: number, dur: number): TimedAction[] => [
  evalAt(t - 0.7, markRange(`vt-r${idx}`, idx, a, b)), moveAt(t, `#vt-r${idx}-a`, 0.45),
  { at: +(t + 0.05).toFixed(3), do: 'drag', from: `#vt-r${idx}-a`, to: `#vt-r${idx}-b`, dur, soft: true }
]
const SEE = sequence([
  { key: 'nacl', route: lesson(BIO, 'salt-crystal'), lead: 2.6, dur: 3.4 },
  { key: 'proj', route: lesson(BIO, 'projectile'), lead: 2.0, dur: BAR, acts: (t) => slide(t + 0.5, 0, 0.25, 0.85, 1.3) },
  { key: 'pk', route: lesson('anatomy-heart', 'drug-dosing'), lead: 2.0, dur: 2 * BEAT, acts: (t) => slide(t + 0.1, 0, 0.3, 0.8, 0.9) },
  { key: 'sd', route: lesson('economics-101', 'supply-demand'), lead: 2.0, dur: 2 * BEAT, acts: (t) => slide(t + 0.1, 0, 0.3, 0.8, 0.9) },
  { key: 'timeline', route: lesson('world-history', 'revolution-to-waterloo'), lead: 2.0, dur: 2 * BEAT, acts: (t) => [moveAt(t + 0.3, 'text:Austerlitz', 0.5), clickAt(t + 0.9, 'text:Austerlitz', 0.2)] },
  { key: 'map', route: lesson('world-history', 'voyage-of-the-beagle'), lead: 2.4, dur: 2 * BEAT, acts: (t) => [moveAt(t + 0.9, [700, 520], 0.8)] },
  {
    key: 'krebs', route: lesson(BIO, 'krebs-cycle'), lead: 2.0, dur: BAR,
    acts: (t) => [moveAt(t - 0.1, 'button[aria-label="Next step"]', 0.5), ...[0, 1, 2, 3].map((k) => clickAt(t + k * BEAT + 0.05, 'button[aria-label="Next step"]', 0.12))]
  },
  // (nunca «Present»: pide pantalla completa al sistema y la ventana oculta podría verse) — la presentación pasa de diapositiva
  { key: 'slides', route: lesson(BIO, 'projectile-slides'), lead: 2.0, dur: BAR, acts: (t) => [clickAt(t - 0.3, [960, 300], 0.4), keyAt(t + BEAT, 'ArrowRight'), keyAt(t + 3 * BEAT, 'ArrowRight')] }
])
const takeSee = take({ seq: SEE, theme: 'light', clock: clockAt(0, 10, 0) })

// 04 · Ask (oscuro): pregunta con respuesta y gráfica, la memoria, «Ask Aula for changes»
const ASK = sequence([
  {
    key: 'graph', route: { name: 'chat' }, lead: 6.2, dur: BAR,
    acts: (t) => [evalAt(t - 5.8, NEW_CHAT), clickAt(t - 4.8, 'textarea', 0.4), evalAt(t - 4.6, typeInto('textarea', 'Why is sin 150° positive?', 24, true))]
  },
  { key: 'memory', route: { name: 'settings', section: 'memory' }, lead: 2.2, dur: BAR, acts: (t) => [moveAt(t + 0.9, [700, 420], 0.9)] },
  {
    key: 'changes', route: { name: 'course', id: TRIG }, lead: 1.8, dur: BAR,
    acts: (t) => [moveAt(t + 0.1, 'text:Ask Aula for changes', 0.5), clickAt(t + BEAT, 'text:Ask Aula for changes', 0.2), moveAt(t + 2.5 * BEAT, 'text:Worked example', 0.5), clickAt(t + 3 * BEAT, 'text:Worked example', 0.15)]
  }
])
const takeAsk = take({
  seq: ASK, theme: 'dark', clock: clockAt(0, 20, 15),
  setup: [{ do: 'eval', js: `(async () => { for (const text of ${JSON.stringify(MEMORIES)}) await window.aula.invoke('memory.add', { text }) })()` }]
})

// 05 · Always on (claro): Inbox, «Shall we prepare it together?», «Aula always on» y las rutinas, una automatización nueva
const ALWAYS = sequence([
  { key: 'inbox', route: { name: 'inbox' }, lead: 2.0, dur: BAR, acts: (t) => [moveAt(t + 1.2, [560, 300], 1.0)] },
  { key: 'together', lead: 0.2, dur: 6 * BEAT, acts: (t) => [moveAt(t + 1.0, [640, 520], 0.8)] },
  {
    key: 'alwayson', lead: 0.6, dur: BAR,
    acts: (t) => [evalAt(t - 0.5, markSel('vt-sw0', 'button[role="switch"]', 0)), evalAt(t - 0.5, markSel('vt-sw1', 'button[role="switch"]', 1)), moveAt(t + 0.4, '#vt-sw0', 0.4), clickAt(t + BEAT, '#vt-sw0', 0.15), moveAt(t + 2.7 * BEAT, '#vt-sw1', 0.4), clickAt(t + 3 * BEAT, '#vt-sw1', 0.15)]
  },
  {
    // la automatización se pide en palabras y se programa (el plano acaba con ella en la lista)
    key: 'auto', lead: 1.4, dur: 6 * BEAT, gap: 0.6,
    acts: (t) => [
      clickAt(t - 1.0, 'text:Automations', 0.4), moveAt(t + 0.2, 'text:New automation', 0.35), clickAt(t + 0.55, 'text:New automation', 0.15),
      evalAt(t + 0.95, typeInto('textarea', 'Every morning at 8, check my platform and tell me what’s new', 40)),
      moveAt(t + 2.6, 'text:Schedule', 0.4), clickAt(t + 2.95, 'text:Schedule', 0.15)
    ]
  }
])
const takeAlways = take({ seq: ALWAYS, theme: 'light', clock: clockAt(0, 8, 5) })

// 06 · Documents (oscuro): «Create document» del curso de trigonometría → el simulacro en PDF con su hoja de respuestas y la
// chuleta; el lector con Aula al lado («Summarize this page» con citas de la página)
const NEXT_PAGE = 'button[aria-label="Next page"]'
const DOCS = sequence([
  {
    key: 'export', route: { name: 'documents' }, lead: 5.6, dur: BAR, gap: 0,
    acts: (t) => [
      clickAt(t - 4.6, 'text:Create document', 0.3), evalAt(t - 4.0, markSel('vt-cs', '[data-aula-select]', 0)), clickAt(t - 3.5, '#vt-cs', 0.3),
      evalAt(t - 3.3, markWhere('vt-co', '[role="option"], li, button', 'Exam #2')), clickAt(t - 2.8, '#vt-co', 0.3),
      moveAt(t - 2.3, 'text:Practice exam', 0.3), clickAt(t - 2.0, 'text:Practice exam', 0.15), moveAt(t + 1.4, NEXT_PAGE, 0.5)
    ]
  },
  ...[2, 3].map((k): Seg => ({ key: `page${k}`, lead: 1.5, dur: 2 * BEAT + 0.2, gap: 0, acts: (t) => [clickAt(t - 1.45, NEXT_PAGE, 0.12)] })),
  { key: 'cheat', lead: 1.9, dur: 2 * BEAT + 0.2, gap: 0, acts: (t) => [clickAt(t - 1.8, 'text:Cheat sheet', 0.3)] },
  {
    key: 'reader', lead: 4.0, dur: 6 * BEAT,
    acts: (t) => [
      keyAt(t - 3.9, 'Escape'), evalAt(t - 3.5, markWhere('vt-doc', 'button, a, [role="button"], [role="link"]', 'Exam 2 review')), clickAt(t - 2.6, '#vt-doc', 0.5),
      moveAt(t - 1.0, 'button[title="Ask Aula about this document"]', 0.4), clickAt(t - 0.6, 'button[title="Ask Aula about this document"]', 0.15),
      moveAt(t + 0.2, 'text:Summarize this page', 0.4), clickAt(t + 0.45, 'text:Summarize this page', 0.15)
    ]
  }
])
const takeDocs = take({ seq: DOCS, theme: 'dark', clock: clockAt(0, 19, 40) })

// 07 · Everywhere (claro): la misma lección en cuatro idiomas de curso y la app entera en español
const EVERY = sequence([
  ...(['ja', 'ru', 'ar', 'es'] as const).map((l): Seg => ({ key: `lang-${l}`, route: lesson(`unit-circle-${l}`, 'unit-circle'), lead: 2.2, dur: BEAT + 0.5 })),
  { key: 'spanish', route: { name: 'home' }, js: uiLanguage('es'), lead: 2.2, dur: 2 * BEAT + 0.4, acts: (t) => [moveAt(t + 0.6, [760, 330], 0.6)] }
])
const takeEvery = take({ seq: EVERY, theme: 'light', clock: clockAt(0, 15, 20) })

// ════════════ PLANOS ════════════
// Duraciones variadas (1 pulso, 2, 3, 4, 6), cortes secos en los tiempos fuertes, empujones, primeros planos de detalle y
// pocos rack focus (≈ 1 de cada 5); la cámara siempre se mueve dentro del plano.
type Side = 'left' | 'right'
interface ShotOpt {
  take: string
  /** Inicio: [compás, pulso]. */
  at: [number, number]
  /** Duración en pulsos. */
  beats: number
  from: number
  /** Lado de la interfaz (el titular va al otro) o `detail` (la interfaz llena el cuadro: sin titular). */
  ui: Side | 'detail'
  size?: number
  height?: number
  zoom: number
  focus: [number, number]
  zoom2?: number
  focus2?: [number, number]
  /** Empujón: el plano entra un 18 % más abierto y llega al encuadre en el primer 35 % (luego sigue despacio). */
  push?: boolean
  title?: string
  sub?: string
  /** Duración del rótulo en pulsos si no coincide con la del plano (un rótulo para varios planos seguidos). */
  titleBeats?: number
  titleSize?: number
  /** Pulsos que espera el titular (tras la luz de una cartela, para no pisar su texto). */
  titleDelay?: number
  /** Subrayado a pincel en la palabra en cursiva: solo en los ~10 rótulos clave. */
  underline?: boolean
  enter?: Clip['enter']
}
const clips: Clip[] = []
const titles: Title[] = []
const Vb = ([bar, beat]: [number, number]): number => V(bar, beat)
function shot(o: ShotOpt): void {
  const start = Vb(o.at)
  const dur = +(o.beats * BEAT).toFixed(4)
  const z2 = o.zoom2 ?? +(o.zoom * 1.04).toFixed(3)
  const f2 = o.focus2 ?? o.focus
  const camera: CameraKey[] = o.push
    ? [{ t: 0, zoom: +(o.zoom * 0.82).toFixed(3), focus: o.focus }, { t: +(dur * 0.35).toFixed(4), zoom: o.zoom, focus: o.focus }, { t: dur, zoom: z2, focus: f2 }]
    : [{ t: 0, zoom: o.zoom, focus: o.focus }, { t: dur, zoom: z2, focus: f2 }]
  clips.push({
    take: o.take, start, dur, from: +o.from.toFixed(3), camera,
    layout: o.ui === 'detail' ? { kind: 'detail' } : { kind: 'keynote', side: o.ui, size: o.size ?? 0.62, ...(o.height ? { height: o.height } : {}) },
    enter: o.enter ?? CUT
  })
  if (o.title) {
    const td = (o.titleDelay ?? 0) * BEAT
    const tb = (o.titleBeats ?? o.beats) * BEAT
    titles.push({
      start: +(start + td).toFixed(4), dur: +(tb - td - 0.002).toFixed(4), text: o.title, ...(o.sub ? { sub: o.sub } : {}),
      ...(o.titleSize ? { size: o.titleSize } : {}), underline: o.underline ? {} : false, style: 'keynote', side: o.ui === 'left' ? 'right' : 'left'
    })
  }
}
/** Tipografía sola a pantalla completa, de `at` durante `beats` pulsos. */
const typeTitle = (at: [number, number], beats: number, text: string, extra: Partial<Title> = {}): void => {
  titles.push({ start: Vb(at), dur: +(beats * BEAT - 0.002).toFixed(4), text, style: 'type', underline: false, ...extra })
}
const CUT: Clip['enter'] = { kind: 'cut', dur: 0 }
const FOCUS: Clip['enter'] = { kind: 'focus', dur: 0.45 }
const CONTENT: Clip['enter'] = { kind: 'content', dur: 0.2 }
const light = (style: 'dusk' | 'dawn' | 'arch' | 'horizon' | 'diagonal'): Clip['enter'] => ({ kind: 'light', style, dur: BEAT, ...(style === 'dawn' ? { at: [0.5, 0.47] as [number, number] } : {}) })
const L = LEARN.at, S = SEE.at, A = ASK.at, W = ALWAYS.at, D = DOCS.at, E = EVERY.at

// ——— gancho (1–2): «Notes. Slides. PDFs. Whiteboard photos.» (en redonda) y «And an exam in *nine days.*» ———
titles.push({ start: -0.42, dur: +(BAR + 0.42 - 0.002).toFixed(4), text: 'Notes. Slides. PDFs. Whiteboard photos.', style: 'type', stagger: +(BEAT * 0.8).toFixed(4) })
typeTitle([2, 1], 4, 'And an exam in *nine days.*', { stagger: BEAT / 2, underline: {} })

// ——— drop (3): destello, el icono con muelle y su sol; la losa se hace ventana (el curso entero, plano heroico) ———
shot({ take: 'main', at: [3, 3], beats: 2, from: 0.3, ui: 'right', size: 0.56, zoom: 0.71, focus: [760, 440], zoom2: 0.74 })
titles.push({ start: V(3, 2), dur: +(3 * BEAT - 0.002).toFixed(4), text: 'Meet *Aula.*', sub: 'Your study companion.', style: 'keynote', side: 'left', underline: {} })

// ——— ráfaga (4): una imagen por pulso, cortes secos ———
shot({ take: 'morning', at: [4, 1], beats: 1, from: 30.2, ui: 'detail', zoom: 1.6, focus: [700, 450] })
shot({ take: 'main', at: [4, 2], beats: 1, from: 45.3, ui: 'detail', zoom: 1.8, focus: [840, 330] })
shot({ take: 'see', at: [4, 3], beats: 1, from: S.nacl + 2.4, ui: 'detail', zoom: 2.0, focus: [844, 350] })
shot({ take: 'main', at: [4, 4], beats: 1, from: 103.0, ui: 'detail', zoom: 1.7, focus: [760, 320] })

// ——— 01 · Plan (cartela de 1 pulso en 5.1; a los 10 s ya hay producto) ———
shot({ take: 'morning', at: [5, 2], beats: 3, from: 0.6, ui: 'right', zoom: 1.45, focus: [700, 300], focus2: [700, 380], title: 'Your day at a *glance.*', sub: 'Classes, deadlines, what to study.', enter: CUT })
shot({ take: 'morning', at: [6, 1], beats: 4, from: 9.65 - 3 * BEAT, ui: 'left', zoom: 1.65, focus: [900, 660], focus2: [1000, 640], push: true, title: 'Add it in plain *words.*', sub: '“Physics lab Thursday at 4pm.”' })
shot({ take: 'morning', at: [7, 1], beats: 6, from: 14.87 - 6 * BEAT, ui: 'right', zoom: 1.3, focus: [900, 420], zoom2: 1.75, focus2: [1150, 330], title: 'It knows your *exams.*', sub: 'Straight from your calendar.', enter: { kind: 'whip', dur: 0.35, dir: 'left' } })
shot({ take: 'morning', at: [8, 3], beats: 4, from: 16.9, ui: 'left', zoom: 1.4, focus: [880, 470], focus2: [900, 660], zoom2: 1.55, title: 'One click. *Filled in.*', enter: CONTENT })
shot({ take: 'morning', at: [9, 3], beats: 6, from: 27.6, ui: 'right', zoom: 1.35, focus: [620, 430], focus2: [950, 500], title: 'Agents build it *for you.*', sub: 'Lessons, exercises, flashcards, a mock exam.' })
shot({ take: 'morning', at: [11, 1], beats: 2, from: 36.6, ui: 'detail', zoom: 2.0, focus: [1150, 350], focus2: [1180, 330] })
shot({ take: 'morning', at: [11, 3], beats: 6, from: 38.3, ui: 'left', zoom: 1.5, focus: [820, 340], zoom2: 1.7, focus2: [760, 320], push: true, title: 'Every answer, *verified.*', sub: '36 of 36, checked before you start.', underline: true })

// ——— 02 · Learn (13–20, noche) ———
shot({ take: 'learn', at: [13, 3], beats: 8, from: L.lesson - 0.6 - 2 * BEAT, ui: 'right', zoom: 1.5, focus: [835, 470], zoom2: 1.62, title: 'Lessons that make it *click.*', sub: 'Think first. Then see why.', enter: light('dusk') })
shot({ take: 'learn', at: [15, 3], beats: 2, from: L.lesson + 1.5, ui: 'detail', zoom: 2.0, focus: [840, 520], focus2: [840, 560] })
shot({ take: 'learn', at: [16, 1], beats: 4, from: L.practice - 0.2, ui: 'left', zoom: 1.5, focus: [830, 330], zoom2: 1.6, title: 'Mistakes, *explained.*', sub: 'Not just “wrong”: why, and how to fix it.', underline: true })
shot({ take: 'learn', at: [17, 1], beats: 2, from: L.practice + 1.6, ui: 'detail', zoom: 2.0, focus: [800, 300], focus2: [860, 320] })
shot({ take: 'learn', at: [17, 3], beats: 6, from: L.tutor - 1.0, ui: 'right', zoom: 1.9, focus: [1150, 260], focus2: [1150, 420], title: 'A tutor at your *side.*', sub: 'Step by step, never just the answer.', enter: CONTENT })
shot({ take: 'learn', at: [19, 1], beats: 4, from: L.cards, ui: 'left', zoom: 1.55, focus: [866, 400], push: true, title: 'Flashcards that *stick.*', sub: 'Spaced repetition, done for you.' })
shot({ take: 'learn', at: [20, 1], beats: 2, from: L.exam - 1.95, ui: 'detail', zoom: 2.0, focus: [500, 300], focus2: [520, 300] })
shot({ take: 'learn', at: [20, 3], beats: 2, from: L.exam + 1.5, ui: 'right', zoom: 1.6, focus: [835, 280], zoom2: 1.8, title: 'Mock exams, *timed.*' })

// ——— 03 · See it (21–29, día) ———
shot({ take: 'main', at: [21, 3], beats: 2, from: 44.85, ui: 'detail', zoom: 2.0, focus: [820, 300], focus2: [860, 310], enter: light('dawn') })
shot({ take: 'main', at: [22, 1], beats: 4, from: 44.4, ui: 'right', zoom: 1.75, focus: [840, 330], zoom2: 1.9, title: 'Diagrams you can *explore.*' })
shot({ take: 'main', at: [23, 1], beats: 2, from: 46.55, ui: 'detail', zoom: 2.0, focus: [840, 330], focus2: [820, 360] })
shot({ take: 'see', at: [23, 3], beats: 2, from: S.nacl + 0.6, ui: 'left', zoom: 1.9, focus: [844, 350], title: 'Molecules in *3D.*', titleBeats: 4, enter: { kind: 'shape', shape: 'circle', dur: 0.4, from: [0.5, 0.5], to: [0.28, 0.5] } })
shot({ take: 'see', at: [24, 1], beats: 2, from: S.nacl + 1.8, ui: 'left', zoom: 2.0, focus: [844, 350], zoom2: 2.0 })
shot({ take: 'see', at: [24, 3], beats: 6, from: S.proj - 0.1, ui: 'right', zoom: 1.5, focus: [855, 430], zoom2: 1.95, focus2: [850, 520], title: 'Simulations you can *play* with.', sub: 'Move a slider. Watch it change.', titleSize: 100, enter: { kind: 'whip', dur: 0.35, dir: 'right' } })
shot({ take: 'see', at: [26, 1], beats: 2, from: S.pk, ui: 'left', zoom: 1.6, focus: [845, 450], title: 'Physics. Medicine. *Economics.*', titleBeats: 4, titleSize: 100 })
shot({ take: 'see', at: [26, 3], beats: 2, from: S.sd, ui: 'left', zoom: 1.6, focus: [840, 470] })
shot({ take: 'see', at: [27, 1], beats: 2, from: S.timeline, ui: 'right', zoom: 1.65, focus: [835, 262], focus2: [900, 262], title: 'Timelines and *maps.*', titleBeats: 4 })
shot({ take: 'see', at: [27, 3], beats: 2, from: S.map, ui: 'right', zoom: 1.6, focus: [838, 380], zoom2: 1.75 })
shot({ take: 'see', at: [28, 1], beats: 4, from: S.krebs, ui: 'left', zoom: 1.5, focus: [838, 360], push: true, title: 'Processes, step by *step.*', titleSize: 104 })
shot({ take: 'see', at: [29, 1], beats: 4, from: S.slides, ui: 'right', zoom: 1.5, focus: [838, 340], zoom2: 1.62, title: 'Slides, ready to *present.*', enter: FOCUS })

// ——— 04 · Ask (30–37, noche) ———
shot({ take: 'main', at: [30, 3], beats: 6, from: 72.8, ui: 'right', zoom: 1.45, focus: [1000, 260], zoom2: 1.65, focus2: [1000, 360], title: 'Just ask *Aula.*', sub: 'It plans, schedules and builds for you.', enter: light('arch'), underline: true })
shot({ take: 'main', at: [32, 1], beats: 6, from: 76.2, ui: 'left', zoom: 1.5, focus: [1000, 560], push: true, title: 'It acts. You *approve.*' })
shot({ take: 'ask', at: [33, 3], beats: 6, from: A.graph - 1.6, ui: 'right', zoom: 1.5, focus: [1000, 470], focus2: [1000, 520], zoom2: 1.62, title: 'Answers you can *see.*', enter: { kind: 'whip', dur: 0.35, dir: 'left' } })
shot({ take: 'main', at: [35, 1], beats: 2, from: 83.24 - 0.35, ui: 'left', zoom: 1.7, focus: [1000, 480], title: 'Quizzes, right in the *chat.*', titleBeats: 4 })
shot({ take: 'main', at: [35, 3], beats: 2, from: 84.4, ui: 'left', zoom: 2.0, focus: [1010, 560], zoom2: 2.0 })
shot({ take: 'ask', at: [36, 1], beats: 4, from: A.memory, ui: 'right', zoom: 1.55, focus: [560, 380], focus2: [560, 460], title: 'It remembers how you *learn.*', enter: FOCUS })
shot({ take: 'ask', at: [37, 1], beats: 4, from: A.changes, ui: 'left', zoom: 1.6, focus: [720, 420], push: true, title: 'Ask for *changes.*', sub: 'The team does it in the background.' })

// ——— 05 · Always on (38–43, día) ———
shot({ take: 'always', at: [38, 3], beats: 6, from: W.inbox - 2 * BEAT, ui: 'right', zoom: 1.45, focus: [660, 300], focus2: [660, 400], title: 'Done while you were *away.*', sub: 'Your Inbox, every morning.', enter: light('horizon') })
shot({ take: 'always', at: [40, 1], beats: 6, from: W.together, ui: 'left', zoom: 1.45, focus: [640, 380], zoom2: 1.8, focus2: [640, 520], title: 'New homework? Do it *together.*' })
shot({ take: 'always', at: [41, 3], beats: 4, from: W.alwayson, ui: 'right', zoom: 1.75, focus: [1100, 390], push: true, title: 'As quiet as you *like.*', sub: 'Or as attentive.', enter: FOCUS })
shot({ take: 'always', at: [42, 3], beats: 6, from: W.auto, ui: 'left', zoom: 1.55, focus: [720, 330], focus2: [720, 420], title: 'Automations, just by *asking.*', titleSize: 92, enter: { kind: 'whip', dur: 0.35, dir: 'up' } })

// ——— 06 · Documents (44–47, noche) ———
shot({ take: 'docs', at: [44, 3], beats: 2, from: 0.45, ui: 'right', zoom: 1.5, focus: [700, 330], zoom2: 1.6, enter: light('diagonal') })
shot({ take: 'docs', at: [45, 1], beats: 4, from: D.export, ui: 'right', zoom: 1.4, focus: [720, 430], zoom2: 1.6, focus2: [880, 430], title: 'Your course, on *paper.*', sub: 'Guides, cheat sheets, practice exams.' })
shot({ take: 'docs', at: [46, 1], beats: 2, from: D.page2, ui: 'left', zoom: 1.85, focus: [928, 415], title: 'Practice exams, *printed.*', sub: 'With a separate answer key.', titleBeats: 6 })
shot({ take: 'docs', at: [46, 3], beats: 2, from: D.page3, ui: 'left', zoom: 1.85, focus: [928, 415] })
shot({ take: 'docs', at: [47, 1], beats: 2, from: D.cheat + 0.35, ui: 'left', zoom: 2.0, focus: [928, 380], focus2: [928, 430] })
shot({ take: 'docs', at: [47, 3], beats: 6, from: D.reader, ui: 'right', zoom: 1.35, focus: [900, 400], zoom2: 1.75, focus2: [1180, 330], title: 'Read with Aula *beside you.*', sub: 'Summaries that cite the page.', enter: FOCUS })

// ——— 07 · Everywhere (48–55, día, en subida) ———
shot({ take: 'main', at: [49, 3], beats: 6, from: 92.0 - 2 * BEAT, ui: 'right', height: 0.5, zoom: 1.75, focus: [600, 765], zoom2: 1.9, title: 'Connects to where you *study.*', sub: 'Canvas, Moodle, Blackboard and more.', enter: light('arch') })
shot({ take: 'main', at: [51, 1], beats: 2, from: 90.0, ui: 'left', zoom: 1.5, focus: [640, 300], title: 'The AI you *already have.*', sub: 'Claude, ChatGPT or an API key.', enter: { kind: 'whip', dur: 0.35, dir: 'right' } })
shot({ take: 'main', at: [51, 3], beats: 2, from: 93.4, ui: 'right', zoom: 1.95, focus: [560, 500], title: 'Or free, on your *computer.*', sub: 'No key. No internet.' })
typeTitle([52, 1], 2, 'Study *anything.*', { underline: {} })
titles.push({ start: V(52, 3), dur: +(4 * BEAT - 0.002).toFixed(4), text: 'A drawing for every *course.*', sub: '58 hand-painted icons.', style: 'keynote', side: 'left', underline: {} })
shot({ take: 'every', at: [53, 3], beats: 1, from: E['lang-ja'] + 0.3, ui: 'right', zoom: 1.7, focus: [835, 330], title: 'Speaks your *language.*', sub: '12 course languages.', titleBeats: 4, underline: true })
shot({ take: 'every', at: [53, 4], beats: 1, from: E['lang-ru'], ui: 'right', zoom: 1.7, focus: [835, 330] })
shot({ take: 'every', at: [54, 1], beats: 1, from: E['lang-ar'], ui: 'right', zoom: 1.7, focus: [835, 330] })
shot({ take: 'every', at: [54, 2], beats: 1, from: E.spanish, ui: 'right', zoom: 1.45, focus: [700, 300] })
typeTitle([54, 3], 1, 'Free.')
typeTitle([54, 4], 1, 'Open source.')
typeTitle([55, 1], 2, '*Yours.*', { underline: {} })
shot({ take: 'main', at: [55, 3], beats: 4, from: 101.8, ui: 'left', zoom: 0.85, focus: [720, 450], zoom2: 0.9, title: 'Mac. Windows. *Linux.*' })

// ——— cierre (55.3–57): la ventana vuelve al icono, «Aula» letra a letra en el golpe, el lema y la dirección ———
const END = V(59, 1)
titles.push({ start: V(58, 1), dur: +(END + 0.6 - V(58, 1)).toFixed(4), text: 'github.com/luumlabs/aula', sub: 'Free & open source · macOS, Windows and Linux', style: 'caption', at: [0.5, 0.86] })
const DURATION = +(END + 0.6).toFixed(2)

// ——— cartelas, luz y papel ———
const NIGHT = '#15110F'
const DAY = '#F6EFE4'
// [compás, pulsos, subtítulo, luz del primer plano del capítulo]
const CARDS: [number, number, string, ('dusk' | 'dawn' | 'arch' | 'horizon' | 'diagonal')?][] = [
  [5, 1, 'From a date on your calendar to a finished course.'],
  [13, 2, 'Lessons, practice and review that adapt to you.', 'dusk'],
  [21, 2, 'Visuals you can touch, for every subject.', 'dawn'],
  [30, 2, 'Just talk to Aula.', 'arch'],
  [38, 2, 'Like a tutor who never leaves.', 'horizon'],
  [44, 2, 'Print your course. Read with Aula.', 'diagonal'],
  [49, 2, 'Your platform, your AI, your language.', 'arch']
]
const chapters = {
  names: ['Plan', 'Learn', 'See it', 'Ask', 'Always on', 'Documents', 'Everywhere'],
  cards: CARDS.map(([bar, beats, sub], i) => ({ t: V(bar), dur: +(beats * BEAT).toFixed(4), n: i + 1, sub }))
}
// papel: noche en el gancho, amanecer en el drop; la cartela va sobre el papel del capítulo anterior y el primer plano del
// capítulo nuevo entra con su luz (1 pulso): el papel cambia en ese pulso
const paper: { t: number; color: string }[] = [{ t: 0, color: NIGHT }, { t: V(3) - 0.01, color: NIGHT }, { t: +(V(3) + 0.45).toFixed(4), color: DAY }]
let side = DAY
for (const [bar, , , l] of CARDS) {
  if (!l) continue
  const next = side === DAY ? NIGHT : DAY
  paper.push({ t: V(bar, 3) - 0.01, color: side }, { t: V(bar, 4), color: next })
  side = next
}

// ——— secciones de la banda sonora y efectos que el motor no ve ———
const sections: Section[] = [
  { t: 0, name: 'Hook', mood: 'intro' }, { t: V(3), name: 'Meet Aula', mood: 'drop' }, { t: V(4), name: 'Burst', mood: 'day' },
  { t: V(5), name: 'Plan', mood: 'day' }, { t: V(13), name: 'Learn', mood: 'night' }, { t: V(21), name: 'See it', mood: 'day' },
  { t: V(30), name: 'Ask', mood: 'night' }, { t: V(38), name: 'Always on', mood: 'day' }, { t: V(44), name: 'Documents', mood: 'night' },
  { t: V(49), name: 'Everywhere', mood: 'day' }, { t: V(52), name: 'Build', mood: 'build' }, { t: V(56, 3), name: 'Outro', mood: 'outro' }
]
const sfx: SfxCue[] = [
  { t: V(2), type: 'rise', intensity: 1, note: 'subida hasta el drop (C3.1)' },
  { t: V(3), type: 'impact', intensity: 1, note: 'drop: amanecer' },
  ...[1, 2, 3, 4].map((b, i): SfxCue => ({ t: V(4, b), type: 'impact', intensity: 0.75, pan: [-0.4, 0.4, -0.2, 0.2][i], note: 'ráfaga' })),
  { t: V(11), type: 'count', intensity: 0.55, note: 'los temas se ponen «Ready»' },
  { t: V(20), type: 'count', intensity: 0.6, note: 'los números del simulacro cuentan' },
  { t: V(52), type: 'impact', intensity: 0.8, note: 'Study anything.' },
  ...[3, 4].map((b): SfxCue => ({ t: V(54, b), type: 'impact', intensity: 0.6, note: 'Free. · Open source.' })),
  { t: V(55), type: 'impact', intensity: 0.85, note: 'Yours.' },
  ...[3, 4].map((b): SfxCue => ({ t: V(55, b), type: 'impact', intensity: 0.6, note: 'Mac · Windows' })),
  { t: V(56), type: 'impact', intensity: 0.6, note: 'Linux' },
  { t: V(56, 2), type: 'rise', intensity: 0.8, note: 'hacia el logo (C55.3–C56.1)' },
  { t: V(58), type: 'impact', intensity: 0.45, note: 'entra github.com/luumlabs/aula' }
]

export default defineMontage({
  name: 'aula-v5-film',
  fps: FPS,
  size: [1920, 1080],
  bitrate: 14e6,
  minTitle: 0.5,
  theme: 'light',
  duration: DURATION,
  takes: { morning: film.takes.morning, main: film.takes.main, learn: takeLearn, see: takeSee, ask: takeAsk, always: takeAlways, docs: takeDocs, every: takeEvery },
  clips,
  titles,
  cursor: 'sun',
  drift: 0,
  cameraEase: 'smooth',
  hook: { start: 0, end: V(3), converge: [V(2, 3), V(3)], seed: 9, count: 36 },
  // la ola de los iconos de curso pintados (y sus compañeros), a la derecha del titular
  iconWave: { t: V(52, 3), end: V(53, 3), dur: 1.0, area: [0.37, 0.08, 0.59, 0.84] },
  flashes: [V(3)],
  // el icono entra con muelle en el drop, sale el sol y la losa se hace la ventana del curso (en 2 pulsos)
  prologue: { start: V(3), end: V(4), size: 300, at: [0.66, 0.46], spring: true, rise: [V(3), V(3, 2)], morph: 2 * BEAT },
  chapters,
  finale: { start: V(56, 3), dur: 2 * BAR, morph: 2 * BEAT, rise: [V(57), V(57, 2)], sunFrom: 'cursor', title: 'Aula', sub: 'Your study companion.' },
  frames: [{ t: 0, frame: 'mac' }, { t: V(55, 4), frame: 'windows' }, { t: V(56), frame: 'linux' }, { t: V(56, 3), frame: 'mac' }],
  notices: [{ start: V(40, 2), dur: 2.4, title: 'New assignment', body: 'Problem set 4 · MATH 101 · due Thursday', time: 'now', theme: 'light' }],
  paper,
  sections,
  sfx,
  pixelSfx: [],
  music: {
    bpm: BPM, offset: 0, root: 62, seed: 2026, ...(existsSync(WAV) ? { wav: WAV } : {}),
    chords: ['Bm', 'G', 'D', 'D', 'D', 'Bm', 'G', 'A'],
    sections: [{ bar: 1, style: 'dawn', light: 0.2 }, { bar: 3, style: 'day', light: 0.9 }, { bar: 56, style: 'end' }],
    cues: [{ t: V(58), kind: 'end' }],
    // con el WAV de SOUND los clics ya van en la mezcla
    clicks: existsSync(WAV) ? null : -20,
    sfx: -24
  },
  // la versión web (README de GitHub): 720p30 dentro de 27 MB (la tasa la calcula el motor)
  outputs: [{ name: 'aula-v5-film-web', size: [1280, 720], fps: 30, bitrate: 1.35e6, maxMB: 27, audioBitrate: 128000, fadeIn: 0, fadeOut: 0 }]
})

export { BAR, BEAT, V }
/** Dónde empieza cada tramo de las tomas nuevas (s de la toma), para los cortos. */
export const TAKE_AT = { learn: LEARN.at, see: SEE.at, ask: ASK.at, always: ALWAYS.at, docs: DOCS.at, every: EVERY.at }
