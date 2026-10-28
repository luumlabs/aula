// La película de Aula (v2.1): sobre «South Waves» (Eugenio Mininni, Mixkit; la pista NO va en el repo: se lee de
// AULA_FILM_MUSIC o de la carpeta local por defecto, ver audio/track.ts). Montaje revisado plano a plano antes del máster.
// Estructura MEDIDA de la pista montada (compases de vídeo): 1–40 cuerpo · 41–47 respiro · 48–63 cuerpo · 64–70 cierre.
// Reglas: cada cambio de pantalla lo causa un clic visible; la toma se corta EN el clic y la pantalla nueva entra ya asentada
// con un fundido de contenido (≤ 0,25 s) dentro de la ventana quieta; un acontecimiento por pulso; ≤ 7 rótulos, en el papel
// bajo la ventana (con rótulo, la cámara se queda en la ventana entera); ≤ 18 movimientos de cámara (ida y vuelta solo
// donde ayuda a leer); claro ↔ oscuro con ⌘K de la app y un fundido de 2 pulsos en un tiempo fuerte.
//   Animática: AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-film.ts --app tree --draft --soft --jobs 2
//   Final:     node scripts/video/render.ts scripts/video/montage/aula-film.ts --app HEAD --jobs 1
import grid from '../music/south-waves.grid.json' with { type: 'json' }
import { filmGrid, type GridJson } from './grid.ts'
import { defineMontage, type CameraKey, type Clip, type Take, type Target, type TimedAction, type Title } from './types.ts'
import { answerPractice, markWhere, MARK_FIND_TARGET, PIXEL_IDLE_OFF, scrollToHeading, typeInto } from './aula-film-js.ts'
import { buildWorld, clockAt } from '../world/worlds.ts'

// ——— rejilla (VIDEO-TEC: scripts/video/music/south-waves.grid.json, 115,0 BPM; se quitan los compases [57, 73) de la pista) ———
const CUTS: [number, number][] = [[57, 73]]
const START = grid.downbeat - grid.beat
const G = filmGrid(grid as GridJson, CUTS, START)
const BEAT = G.beat
const BAR = G.barDur
/** Instante (s del vídeo) del compás `bar` (1…) y el pulso `beat` (1…4), más una fracción de pulso. */
const V = (bar: number, beat = 1, frac = 0): number => +G.V(bar, beat, frac).toFixed(4)
const DURATION = +G.duration.toFixed(2)
const FPS = Number(process.env.AULA_VIDEO_FPS ?? 60)
const COURSE = 'exam-2-math112'

const W = { morning: buildWorld('morning'), course: buildWorld('course') }

// ——— saltos: la toma se corta en el clic y la pantalla nueva entra asentada (fundido de contenido, ventana quieta) ———
const FADE = 0.2
type Skip = number | [number, number]
function skipTimeline(t0: number, skips: Skip[], defaultAmount = 1.0) {
  const list = skips.map((s) => (Array.isArray(s) ? s : [s, defaultAmount])).sort((a, b) => a[0] - b[0])
  const shiftAt = (v: number, inclusive: boolean) => list.filter(([s]) => (inclusive ? s <= v + 1e-6 : s < v - 1e-6)).reduce((a, [, amt]) => a + amt, 0)
  const toTake = (v: number): number => +(v - t0 + shiftAt(v, false)).toFixed(4)
  /** `hidden`: la acción ocurre dentro del salto que empieza en a.at, `hidden` s después (el fundido la tapa). */
  const actions = (acts: (TimedAction & { hidden?: number })[]): TimedAction[] => acts.map(({ hidden, ...a }) => {
    if (hidden !== undefined) return { ...a, at: +(a.at - t0 + shiftAt(a.at, false) + hidden).toFixed(4) } as TimedAction
    const end = a.at + (a.do === 'click' || a.do === 'move' ? (a.dur ?? 0.7) : 0)
    return { ...a, at: +(a.at - t0 + shiftAt(end, false)).toFixed(4) } as TimedAction
  })
  const clips = (take: string, start: number, end: number, first?: Partial<Clip>, enterFor?: (t: number) => Clip['enter']): Clip[] => {
    const cuts = [start, ...list.map(([s]) => s).filter((s) => s > start + 1e-6 && s < end - 1e-6), end]
    return cuts.slice(0, -1).map((a, i) => ({
      take, start: +a.toFixed(4), dur: +(cuts[i + 1] - a).toFixed(4),
      from: +(a - t0 + shiftAt(a, true)).toFixed(4),
      ...(i === 0 ? first : { enter: enterFor?.(a) ?? { kind: 'content' as const, dur: FADE } })
    }))
  }
  return { toTake, actions, clips }
}
const clickAt = (t: number, to: Target, dur = 0.5): TimedAction => ({ at: +(t - dur).toFixed(4), do: 'click', to, dur })
const moveAt = (t: number, to: Target, dur = 0.6): TimedAction => ({ at: +(t - dur).toFixed(4), do: 'move', to, dur })
const soft = (a: TimedAction): TimedAction => ({ ...a, soft: true })
const ENV_AI = { AULA_FAKE_AI: '1' }
/** Cambio de tema (⌘K → Dark/Light mode): transición propia del motor en el tiempo fuerte (la ventana cambia de golpe y el
 *  papel en 2 pulsos). */
const THEME_FADE: Clip['enter'] = { kind: 'theme', dur: 2 * BEAT }

// ════════════════════════════ TOMA 1 · la mañana (compases 2.3–20, mundo W1) ════════════════════════════
const T1_0 = V(2, 3) - 0.3
const T1_SKIPS: Skip[] = [V(5), V(9), V(13), [V(15), 1.0], [V(17), 1.0], [V(17, 4), 0.9]] // V(17,4): salta la recolocación de «Your course is ready» (entra ya asentada)
const T1 = skipTimeline(T1_0, T1_SKIPS)
const takeMorning: Take = {
  duration: +(T1.toTake(V(21)) + 0.6).toFixed(2),
  lang: 'en', theme: 'light', viewport: [1440, 900], home: W.morning, clock: clockAt(0, 8, 10), mainClock: true,
  env: { ...ENV_AI, AULA_FAKE_TEAM_DELAY_MS: '1850' },
  setup: [{ do: 'navigate', route: { name: 'home' } }, { do: 'eval', js: PIXEL_IDLE_OFF }],
  marks: { title: 'h1' },
  actions: T1.actions([
    // Hoy
    moveAt(V(3, 2), [470, 640], 0.9),
    moveAt(V(4, 2), [1200, 600], 0.9),
    clickAt(V(5), 'text:Open calendar', 0.9),
    // calendario: alta en palabras, noviembre, el día del examen
    clickAt(V(5, 2), 'input[placeholder^="Add an exam"]', 0.4),
    { at: V(5, 2, 0.3), do: 'type', text: 'Physics lab Thursday at 4pm', cps: 22 },
    { at: V(6, 3), do: 'key', key: 'Enter' },
    clickAt(V(7, 1), 'button[aria-label="Next"]', 0.6),
    clickAt(V(7, 4), '[role="button"]:has(button[title*="Exam #2"]) span.tabular', 0.7),
    moveAt(V(8, 3), 'text:Prepare for this exam', 0.6),
    clickAt(V(9), 'text:Prepare for this exam', 0.3),
    // el curso nuevo, ya relleno
    clickAt(V(9, 3), 'text:More details (optional)', 0.6),
    { at: V(10, 1), do: 'eval', js: typeInto('textarea[placeholder^="Units 3 and 4"]', 'Reference angles, exact values, the unit circle, graphs of sine and cosine', 45) },
    { at: V(11, 3), do: 'scroll', to: [835, 560], dy: 420, dur: 0.6 },
    moveAt(V(12, 3), 'text:Create course', 0.8),
    clickAt(V(13), 'text:Create course', 0.3),
    // el equipo trabaja (saltos de tiempo en 15, 17 y 19)
    moveAt(V(14, 2), [620, 520], 1.0),
    moveAt(V(16, 2), [1000, 600], 1.0),
    moveAt(V(18, 2), [700, 380], 1.0),
    moveAt(V(19, 3), [1010, 300], 1.0),
    moveAt(V(20, 3), 'text:Start studying', 0.8),
    soft(clickAt(V(21), 'text:Start studying', 0.3))
  ])
}

// ════════════════════════════ TOMA 2 · el curso, la noche, el chat y el desfile (compases 21–63, mundo W2) ═══════════════
const T2_0 = V(21) - 2.0 // la pantalla del curso ya está asentada cuando se ve
const T2_SKIPS: Skip[] = [V(22), V(22, 3), V(33), V(33, 3), V(34), V(37), V(38), [V(40), 1.2], [V(41), 0.6], V(42), V(45), V(48), [V(56), 0.6], V(57), [V(60), 2.4]]
const T2 = skipTimeline(T2_0, T2_SKIPS)
const MEMORIES = ['Prefers a worked example before the theory', 'Mixes up radians and degrees under time pressure', 'Studies best in short blocks after dinner', 'Wants exact answers, no decimals']
const palette = (enter: number, query: string): TimedAction[] => [
  { at: +(enter - 2 * BEAT).toFixed(4), do: 'key', key: 'Meta+k' },
  { at: +(enter - 2 * BEAT + 0.25).toFixed(4), do: 'type', text: query, cps: 14 },
  { at: enter, do: 'key', key: 'Enter' }
]
// el desfile: orden de «Your courses» en W2 tras crear «English test» (AI, Anatomy, AWS, Biology / Chemistry, English, Trig, Spanish)
const PARADE: { at: [number, number]; story: string; t: number }[] = [
  { at: [406, 238], story: 'robotics', t: V(60, 2) },
  { at: [691, 238], story: 'medicine', t: V(60, 4) },
  { at: [977, 238], story: 'programming', t: V(61, 2) },
  { at: [406, 512], story: 'chemistry', t: V(61, 4) },
  { at: [977, 512], story: 'trigonometry', t: V(62, 2) },
  { at: [1262, 512], story: 'spanish', t: V(62, 4) }
]
const takeMain: Take = {
  duration: +(T2.toTake(V(64)) + 0.6).toFixed(2),
  lang: 'en', theme: 'light', viewport: [1440, 900], home: W.course, clock: clockAt(0, 12, 30), mainClock: true,
  env: { ...ENV_AI, AULA_FAKE_AI_DELAY_MS: '25' },
  setup: [
    { do: 'eval', js: `(async () => { for (const text of ${JSON.stringify(MEMORIES)}) await window.aula.invoke('memory.add', { text }) })()` },
    { do: 'navigate', route: { name: 'course', id: COURSE } },
    { do: 'eval', js: PIXEL_IDLE_OFF },
    // el capturador fija el tema con el gancho de desarrollo; se quita para que mande el ajuste de la app (⌘K → Dark/Light mode)
    { do: 'eval', js: `window.__aula.setTheme(null)` },
    // coherencia: Ajustes no tiene plataformas («No platforms»), así que Inbox no enseña nada de Canvas (se archiva)
    { do: 'eval', js: `(async () => { const r = await window.aula.invoke('automations.inbox'); const ids = (r.value?.entries ?? []).filter((e) => /Canvas/.test(JSON.stringify(e))).map((e) => e.id); if (ids.length) await window.aula.invoke('automations.archive', { ids, archived: true }); return ids })()` }
  ],
  marks: { title: 'h1' },
  actions: T2.actions([
    // 21 · el resumen (la nota cuenta) y la luz tras el cristal; 22 · Practice → «Exact values»
    moveAt(V(21, 3), [1010, 330], 0.9),
    clickAt(V(22), 'text:Practice', 0.6),
    // la fila «Exact values» de «By topic» (la pestaña también lo nombra en «It will start with», sin enlace)
    { at: V(22), do: 'eval', js: markWhere('vt-ev', '[role="button"], button, a', 'Exact values'), hidden: 0.9 },
    moveAt(V(22, 2), '#vt-ev', 0.5),
    clickAt(V(22, 3), '#vt-ev', 0.2),
    // 23–24 · el error típico y «Not yet» con su porqué
    moveAt(V(22, 4), [620, 266], 0.4),
    { at: V(23, 1), do: 'eval', js: answerPractice('wrong', 10) },
    // 26 · «Explain my mistake»; 27–30 · la respuesta del tutor, de cerca
    moveAt(V(25, 4), 'text:Explain my mistake', 0.8),
    soft(clickAt(V(26, 1), 'text:Explain my mistake', 0.2)),
    // 31–32 · ahora bien
    { at: V(30, 4), do: 'key', key: 'Escape' },
    soft(clickAt(V(31, 1), 'text:Try again', 0.4)),
    { at: V(31, 1, 0.3), do: 'eval', js: answerPractice('right', 16) },
    // 33–36 · tarjetas con repaso espaciado
    clickAt(V(33), 'button[aria-label="Exit (esc)"]', 0.6),
    moveAt(V(33, 2), 'text:Flashcards', 0.5),
    clickAt(V(33, 3), 'text:Flashcards', 0.2),
    moveAt(V(33, 4), 'text:Review now', 0.5),
    clickAt(V(34), 'text:Review now', 0.2),
    { at: V(34, 3), do: 'key', key: 'Space' },
    clickAt(V(35, 2), [890, 842], 0.6),
    { at: V(36, 2), do: 'key', key: 'Space' },
    // 37–40 · la figura del curso de biología: explorar y «Find it»; la molécula en 3D
    moveAt(V(36, 4), 'text:Biology & Physics', 0.8),
    clickAt(V(37), 'text:Biology & Physics', 0.2),
    moveAt(V(37, 4), 'text:Learn: Cells, molecules and motion', 0.8),
    clickAt(V(38), 'text:Learn: Cells, molecules and motion', 0.2),
    moveAt(V(38, 2), 'text:Nucleus', 0.4),
    moveAt(V(38, 3), 'text:Mitochondrion', 0.4),
    moveAt(V(38, 4), [1104, 164], 0.4),
    { at: V(38, 4), do: 'eval', js: `[...document.querySelectorAll('[role="tab"]')].find((b) => /^(Point|Find it)$/.test(b.textContent.trim()))?.click()` },
    { at: V(38, 4, 0.4), do: 'eval', js: MARK_FIND_TARGET },
    soft(clickAt(V(39, 2), '#vt-find', 0.5)),
    moveAt(V(39, 4), 'text:Continue', 0.6),
    clickAt(V(40), 'text:Continue', 0.2),
    moveAt(V(40, 2), [835, 420], 0.6),
    // 41 · ⌘K → Dark mode en el tiempo fuerte
    ...palette(V(41), 'dark'),
    // 41–47 · el respiro: estadísticas con un desplazamiento lento, Aula siempre activa
    moveAt(V(41, 4), 'text:Statistics', 0.8),
    clickAt(V(42), 'text:Statistics', 0.2),
    { at: V(42, 3), do: 'scroll', to: [835, 500], dy: 1600, dur: 5.0 }, // despacio (320 px/s) hasta los logros dibujados a mano
    moveAt(V(44, 4), 'text:Inbox', 0.8),
    clickAt(V(45), 'text:Inbox', 0.2),
    clickAt(V(45, 3), 'button[role="switch"]', 0.8),
    moveAt(V(46, 3), [640, 300], 1.0),
    moveAt(V(47, 4), 'text:Aula', 0.8),
    clickAt(V(48), 'text:Aula', 0.2),
    // en demo el chat reabre «Aula updates» (y «New conversation» no la deja; avisado): dentro del salto se crea una
    // conversación nueva vacía y se abre, así en V(48) ya está el «How can I help?»
    { at: V(48), do: 'eval', js: `(async () => { const r = await window.aula.invoke('chat.newThread', undefined); window.__aula.navigate({ name: 'chat', conversation: r.value.id }) })()`, hidden: 0.15 },
    // 48–55 · la vuelta del tema: el chat actúa
    clickAt(V(48, 2), 'textarea', 0.4),
    { at: V(48, 3), do: 'eval', js: typeInto('textarea', 'I have an English test on Monday at 10', 24, true) },
    soft(clickAt(V(50, 3), 'text:Add', 0.6)),
    soft(clickAt(V(51, 2), 'text:Yes, prepare it', 0.6)),
    soft(clickAt(V(51, 4), 'text:Create the course', 0.5)),
    clickAt(V(52, 2), 'textarea', 0.5),
    { at: V(52, 2, 0.3), do: 'eval', js: typeInto('textarea', 'Quiz me on exact values', 28, true) },
    soft(clickAt(V(53, 3), '[data-studyset="quiz"] button', 0.6)),
    { at: V(53, 4), do: 'eval', js: markWhere('vt-opt', '[data-studyset="quiz"] [role="radio"]', '-\\dfrac{\\sqrt3}{2}') },
    soft(clickAt(V(54, 2), '#vt-opt', 0.6)),
    { at: V(54, 3), do: 'eval', js: markWhere('vt-check', '[data-studyset="quiz"] button', 'Check') },
    soft(clickAt(V(54, 4), '#vt-check', 0.5)),
    // 56 · ⌘K → Light mode en el tiempo fuerte; Tu IA y las plataformas
    ...palette(V(56), 'light'),
    moveAt(V(56, 4), 'button[aria-label="Settings"]', 0.8),
    clickAt(V(57), 'button[aria-label="Settings"]', 0.2),
    moveAt(V(57, 2), [544, 310], 0.5),
    moveAt(V(57, 3), [470, 498], 0.5),
    moveAt(V(57, 4), [1010, 244], 0.5),
    moveAt(V(59, 3), 'text:Today', 0.8),
    clickAt(V(60), 'text:Today', 0.2),
    { at: V(60), do: 'eval', js: scrollToHeading('Your courses'), hidden: 1.2 },
    // 60–63 · el desfile: cada personaje cuenta su historia cuando el cursor entra en su tarjeta
    ...PARADE.map((p) => moveAt(p.t, p.at, 0.45)),
    moveAt(V(63, 3), [1120, 640], 1.0)
  ])
}

// ════════════════════════════ MONTAJE ════════════════════════════
const themeFadeAt = new Set([V(41), V(56)])
const clips: Clip[] = [
  ...T1.clips('morning', V(2, 3), V(21)),
  // el curso recién creado → el curso estudiado: misma forma (4 temas, 36 ejercicios), la pantalla ya asentada
  ...T2.clips('main', V(21), V(64), { enter: { kind: 'content', dur: 0.25 } }, (t) => (themeFadeAt.has(+t.toFixed(4)) ? THEME_FADE : undefined))
]

// ——— cámara: ventana entera (alta, deja el papel de abajo a los rótulos) y pocos acercamientos, solo para leer ———
const WIN_C: [number, number] = [720, 450]
const WHOLE = { zoom: 0.96, focus: WIN_C, screen: [0.5, 0.428] as [number, number] }
type Shot = { t: number; zoom: number; focus?: [number, number]; screen?: [number, number]; beats?: number }
function clampFocus(zoom: number, [x, y]: [number, number]): [number, number] {
  const hw = 960 / zoom, hh = 540 / zoom
  const cx = hw >= 720 ? 720 : Math.min(1440 - hw, Math.max(hw, x))
  const cy = hh >= 450 ? 450 : Math.min(900 - hh, Math.max(hh, y))
  return [Math.round(cx), Math.round(cy)]
}
function cameraFrom(shots: Shot[]): CameraKey[] {
  const keys: CameraKey[] = []
  const key = (t: number, s: Shot): CameraKey => ({ t: +t.toFixed(4), zoom: s.zoom, focus: s.screen ? (s.focus ?? WIN_C) : clampFocus(s.zoom, s.focus ?? WIN_C), ...(s.screen ? { screen: s.screen } : {}) })
  shots.forEach((s, i) => {
    const prev = shots[i - 1]
    if (!prev) return keys.push(key(s.t, s))
    keys.push(key(s.t, prev))
    keys.push(key(s.t + (s.beats ?? 2) * BEAT, s))
  })
  for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) throw new Error(`cámara: claves desordenadas en ${keys[i].t}`)
  return keys
}
const whole = (t: number, beats = 2): Shot => ({ t, ...WHOLE, beats })
const push = (t: number, focus: [number, number], zoom = 1.2, beats = 2): Shot => ({ t, zoom, focus, beats })
/** Respiración: empuje lento desde la ventana entera (≤ 2 % por compás) durante una espera larga. */
const breathe = (t: number, zoom: number, beats: number): Shot => ({ t, zoom, focus: WIN_C, screen: WHOLE.screen, beats })
const camera = cameraFrom([
  whole(V(2, 3)),
  breathe(V(3, 2), 1.0, 5), // Hoy: la ventana respira con el ritmo
  push(V(5, 3), [850, 780], 1.25), whole(V(8, 1)), // el calendario y el alta en palabras
  breathe(V(10, 1), 1.0, 6), // el curso nuevo se rellena
  push(V(13, 3), [700, 420], 1.15), push(V(16, 2), [760, 380], 1.15, 6), whole(V(19, 3)), // el equipo, despacio por las filas
  push(V(23, 2), [700, 330], 1.15), whole(V(25, 4)), // «Not yet» con su porqué (con rótulo: ≤ 1,15)
  push(V(27, 1), [1180, 400], 1.25), push(V(28, 1), [1180, 420], 1.32, 8), whole(V(30, 3)), // la respuesta del tutor, con un empuje lento
  push(V(34, 2), [840, 450]), whole(V(36, 3)), // la tarjeta
  push(V(38, 2), [840, 420]), whole(V(39, 3)), // la figura; la molécula se ve entera
  push(V(42, 3), [760, 420], 1.1, 4), push(V(43, 4), [760, 560], 1.15, 3), whole(V(44, 4)), // estadísticas, despacio; los logros de cerca
  breathe(V(45, 3), 1.0, 8), // Aula siempre activa
  push(V(49, 1), [1000, 420], 1.15, 4), whole(V(51, 4)), // las tarjetas del chat (con rótulo: ≤ 1,15)
  push(V(52, 3), [1000, 520]), whole(V(55, 1)), // el cuestionario
  breathe(V(57, 2), 1.0, 6), // Tu IA
  push(V(60, 2), [700, 300], 1.2), push(V(61, 3), [980, 540], 1.26, 4), whole(V(63, 1), 4) // el desfile: fila de arriba, paneo a la de abajo
])

// ——— rótulos: siete, en el papel bajo la ventana, mientras la cámara está en la ventana entera ———
const cap = (bar: number, bars: number, text: string, sub?: string, beat = 1): Title => ({
  start: G.V(bar, beat), dur: G.V(bar + bars, beat) - G.V(bar, beat), text, ...(sub ? { sub } : {}), style: 'caption', at: [0.5, 0.925]
})
/** Rótulo de `start` a `end` (pulsos de vídeo), en la banda del papel. */
const capAt = (start: number, end: number, text: string, sub?: string): Title => ({ start, dur: end - start, text, ...(sub ? { sub } : {}), style: 'caption', at: [0.5, 0.925] })
const titles: Title[] = [
  capAt(G.V(3), G.V(5), 'Meet *Aula*.', 'Your study companion.'),
  capAt(G.V(9, 2), G.V(12, 4), 'From an exam date to a full *course*.'),
  capAt(G.V(15, 2), G.V(18, 4), 'A *team* of agents builds it —', 'and checks every answer.'),
  capAt(G.V(24, 2), G.V(26, 4), 'Get it wrong. Know *why*.'),
  capAt(G.V(48, 2), G.V(51, 4), 'Just talk to *Aula*.', 'It acts — with your OK.'),
  capAt(G.V(57, 2), G.V(59, 3), 'Your AI plan, an API key —', 'or free on your computer.'),
  capAt(G.V(60, 2), G.V(63, 3), 'Study *anything*.', 'A subject, a certification, a language — or something new.'),
  // el último compás: la dirección del proyecto bajo el icono
  { start: G.V(69), dur: DURATION - G.V(69), text: 'github.com/luumlabs/aula', sub: 'Free · macOS, Windows and Linux · Early access', style: 'caption', at: [0.5, 0.86] }
]

// ——— papel: día → noche (⌘K, 41) → día (⌘K, 56), en el mismo fundido de 2 pulsos que el tema ———
const paper = [
  { t: 0, color: '#F6EFE4' },
  { t: V(41), color: '#F6EFE4' }, { t: V(41, 3), color: '#15110F' },
  { t: V(56), color: '#15110F' }, { t: V(56, 3), color: '#F6EFE4' }
]

export default defineMontage({
  name: 'aula-film',
  fps: FPS,
  size: [1920, 1080],
  bitrate: 14e6,
  theme: 'light',
  duration: DURATION,
  takes: { morning: takeMorning, main: takeMain },
  clips,
  camera,
  titles,
  cursor: 'sun',
  drift: 0,
  captionBand: 950,
  cameraEase: 'smooth',
  // el icono desde el primer compás; el sol sale mientras la música arranca; la app entra en V(2,3)
  prologue: { start: -0.25, end: V(3), size: 360, rise: [V(1), V(2, 3)], fadeIn: 0.5, grow: 0.94, morph: 2 * BEAT },
  // el cierre del tema: la ventana se reduce al icono en un compás, el sol sale, «Aula», y la dirección en el compás 69
  finale: { start: V(64), dur: 3 * BAR, morph: BAR, rise: [V(65), V(66, 3)], sunFrom: 'cursor', title: 'Aula', sub: 'Your study companion.' },
  notices: [],
  pixelSfx: PARADE.map((p) => ({ t: +(p.t - 0.05).toFixed(4), story: p.story })),
  paper,
  music: {
    track: { grid: grid as GridJson, cuts: CUTS, start: START },
    bpm: G.bpm, root: 62, seed: 2026,
    chords: ['D', 'A', 'Bm', 'G'],
    sections: [{ bar: 1, style: 'day', light: 0.8 }, { bar: 41, style: 'night', light: 0.3 }, { bar: 48, style: 'day', light: 0.9 }, { bar: 64, style: 'end' }],
    cues: [{ t: V(66), kind: 'end' }],
    clicks: -22,
    sfx: -24
  },
  outputs: [
    { name: 'aula-tour-1', range: [0, V(25)], size: [1280, 720], fps: 30, bitrate: 1.25e6, audioBitrate: 96000, fadeIn: 0, fadeOut: 0.4, maxMB: 9.5 },
    { name: 'aula-tour-2', range: [V(25), V(48)], size: [1280, 720], fps: 30, bitrate: 1.25e6, audioBitrate: 96000, fadeIn: 0.3, fadeOut: 0.4, maxMB: 9.5 },
    { name: 'aula-tour-3', range: [V(48), DURATION], size: [1280, 720], fps: 30, bitrate: 1.25e6, audioBitrate: 96000, fadeIn: 0.3, fadeOut: 0.6, maxMB: 9.5 },
    { name: 'aula-poster', range: [V(69, 3), V(69, 3) + 0.1], size: [1920, 1080], fps: 30, stills: [V(69, 3)] }
  ]
})
