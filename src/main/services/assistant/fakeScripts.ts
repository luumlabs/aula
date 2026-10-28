// Guiones de la IA simulada (`AULA_FAKE_AI=1`: pruebas y modo demostración): qué pide el estudiante y lo que Aula contesta,
// en el idioma de la interfaz y con los datos que de verdad hay (cursos, materiales, ejercicios). Lógica pura, sin E/S.
import { foldPlain } from '@engine/assistant'
import { tr } from '@shared/ai/i18n'

/** Lo que se pide: apuntar un examen, crear un curso, un test, unas tarjetas, una pista, que explique un error o una respuesta normal. */
export type FakeIntent = 'event' | 'course' | 'quiz' | 'flashcards' | 'hint' | 'mistake' | 'answer'

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(sunday|domingo)\b/, 0], [/\b(monday|lunes)\b/, 1], [/\b(tuesday|martes)\b/, 2], [/\b(wednesday|miercoles)\b/, 3],
  [/\b(thursday|jueves)\b/, 4], [/\b(friday|viernes)\b/, 5], [/\b(saturday|sabado)\b/, 6]
]
const EXAM_WORDS = /\b(test|exam|quiz|midterm|final|examen|prueba|parcial|control)\b/
// «Explícame mi error» (práctica) y «explícame este concepto de otra forma» (lección), tras fallar un ejercicio
const MISTAKE = /\b(my mistake|my error|why my answer|where did i go wrong|concept another way|mi error|por que mi respuesta|en que me equivoque|concepto de otra forma)\b/
const COURSE_ASK = /\b(make|create|build|prepare|set up)\b.*\bcourse\b|\b(crea|creame|haz|hazme|prepara|preparame|monta|montame)\b.*\bcurso\b/
// «sin» y «tan» también son palabras españolas: solo cuentan seguidas de un ángulo o una variable
const TRIG = /\b(trig\w*|sine|cosine|tangent|(?:sin|cos|tan)\s*(?:\d|\(|θ|[xt]\b)|cos|unit circle|reference angles?|exact values?|radians?|quadrants?|seno|coseno|tangente|circulo unidad|circunferencia unidad|angulos? de referencia|valores exactos|radianes|cuadrantes?)\b|°/

/** ¿Se habla de trigonometría? (el curso de ejemplo es «Exam #2 · MATH 101»). */
export function isTrig(message: string): boolean {
  return TRIG.test(foldPlain(message))
}

/** ¿Cuándo? «on Monday», «tomorrow», «el lunes», «mañana»… (sin día no hay evento que apuntar). */
function dayOffset(m: string, now: Date): number | undefined {
  if (/\b(today|hoy)\b/.test(m)) return 0
  // «mañana» es el día de después, salvo «por la mañana» / «de la mañana»
  if (/\btomorrow\b/.test(m) || (/\bmanana\b/.test(m) && !/\b(por|de) la manana\b/.test(m))) return 1
  for (const [re, day] of WEEKDAYS) {
    if (re.test(m)) {
      const d = (day - now.getDay() + 7) % 7
      return d === 0 ? 7 : d
    }
  }
  return undefined
}

export function fakeIntent(message: string): FakeIntent {
  const m = foldPlain(message)
  if (COURSE_ASK.test(m)) return 'course'
  if (EXAM_WORDS.test(m) && dayOffset(m, new Date()) !== undefined && !/\b(quiz me|ponme|hazme)\b/.test(m)) return 'event'
  if (/\b(flashcards?|tarjetas?)\b/.test(m)) return 'flashcards'
  if (/\b(quiz|test|cuestionario)\b/.test(m)) return 'quiz'
  if (/\b(hint|clue|pista)\b/.test(m)) return 'hint'
  if (MISTAKE.test(m)) return 'mistake'
  return 'answer'
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const pad = (n: number): string => String(n).padStart(2, '0')

export interface FakeEvent {
  title: string
  subject: string
  kind: 'exam' | 'quiz'
  /** ISO local («2026-11-02T10:00» o «2026-11-02» si es todo el día). */
  start: string
  allDay: boolean
}

/** El examen del mensaje («I have an English test on Monday at 10» → «English test», el lunes que viene a las 10:00). */
export function fakeEvent(message: string, now = new Date()): FakeEvent | undefined {
  const m = foldPlain(message)
  const offset = dayOffset(m, now)
  if (offset === undefined) return undefined
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const time = /\b(?:at|a las|a la)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(m) ?? /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(m)
  let start = date
  if (time) {
    let h = Number(time[1])
    const pm = time[3]?.startsWith('p')
    if (pm && h < 12) h += 12
    else if (!time[3] && h >= 1 && h <= 6) h += 12 // «at 3» = por la tarde
    if (time[3]?.startsWith('a') && h === 12) h = 0
    if (h <= 23) start = `${date}T${pad(h)}:${time[2] ?? '00'}`
  }
  const raw = message.replace(/\s+/g, ' ')
  const kindWord = (EXAM_WORDS.exec(m)?.[1] ?? 'exam')
  const kind: FakeEvent['kind'] = kindWord === 'quiz' ? 'quiz' : 'exam'
  // «an English test» / «my chemistry midterm»
  const en = /\b(?:an?|my|the|our)\s+((?:[A-Za-zÀ-ÿ]+\s+){0,2}?)(test|exam|quiz|midterm|final)\b/i.exec(raw)
  // «prueba de inglés» / «examen del parcial»
  const es = /\b(examen|prueba|parcial|control)\s+(?:de|del)\s+([A-Za-zÀ-ÿ]+)/i.exec(raw)
  let title: string
  let subject = ''
  if (es) {
    title = cap(`${es[1].toLowerCase()} de ${es[2].toLowerCase()}`)
    subject = cap(es[2].toLowerCase())
  } else if (en) {
    subject = en[1].trim()
    title = cap(`${subject ? subject + ' ' : ''}${en[2].toLowerCase()}`)
  } else {
    title = tr('Examen', 'Exam')
  }
  return { title, subject, kind, start, allDay: start === date }
}

/** Lo que el estudiante quiere estudiar («Make me a course on organic chemistry» → «Organic chemistry»). */
export function fakeCourseTitle(message: string): string {
  const raw = message.replace(/\s+/g, ' ').trim()
  const t = /\b(?:on|about|for|of|de|sobre|para)\s+(.+?)[.?!]*$/i.exec(raw)?.[1]?.replace(/^(?:my|mi|el|la|los|las|the)\s+/i, '').trim()
  return cap(t && t.length > 1 ? t.slice(0, 80) : tr('Mi curso', 'My course'))
}

// MARK: Tests y tarjetas

/** El test de la IA simulada: de trigonometría (valores exactos, con el porqué de cada error) o, si no, de parábolas. */
export function fakeQuizArgs(trig = false): string {
  if (trig) {
    return JSON.stringify({
      title: tr('Valores exactos · 3 preguntas', 'Exact values · 3 questions'),
      exercises: [
        {
          prompt: tr('¿Cuál es el valor exacto de $\\cos 210^\\circ$?', 'What is the exact value of $\\cos 210^\\circ$?'), level: 1,
          answer: { kind: 'choice', options: [
            { id: 'a', md: '$\\dfrac{\\sqrt3}{2}$', correct: false, why: tr('Tamaño correcto, signo equivocado: $210^\\circ$ está en el tercer cuadrante, donde el coseno es negativo.', 'Right size, wrong sign: $210^\\circ$ is in Quadrant III, where cosine is negative.') },
            { id: 'b', md: '$-\\dfrac{\\sqrt3}{2}$', correct: true, why: tr('Ángulo de referencia $30^\\circ$ y coseno negativo en el tercer cuadrante: $\\cos 210^\\circ = -\\cos 30^\\circ = -\\frac{\\sqrt3}{2}$.', 'Reference angle $30^\\circ$ and cosine is negative in Quadrant III: $\\cos 210^\\circ = -\\cos 30^\\circ = -\\frac{\\sqrt3}{2}$.') },
            { id: 'c', md: '$-\\dfrac12$', correct: false, why: tr('Ese es $\\sin 210^\\circ$: con referencia $30^\\circ$, el coseno va con $\\frac{\\sqrt3}{2}$.', 'That is $\\sin 210^\\circ$: with a $30^\\circ$ reference angle, cosine goes with $\\frac{\\sqrt3}{2}$.') }
          ] },
          hints: [tr('¿En qué cuadrante está $210^\\circ$?', 'Which quadrant is $210^\\circ$ in?'), tr('Su ángulo de referencia es $30^\\circ$.', 'Its reference angle is $30^\\circ$.')],
          solution: tr('$210^\\circ = 180^\\circ + 30^\\circ$: tercer cuadrante, coseno negativo. $\\cos 210^\\circ = -\\frac{\\sqrt3}{2}$.', '$210^\\circ = 180^\\circ + 30^\\circ$: Quadrant III, cosine negative. $\\cos 210^\\circ = -\\frac{\\sqrt3}{2}$.')
        },
        {
          prompt: tr('¿Cuánto vale $\\sin 150^\\circ$?', 'What is $\\sin 150^\\circ$?'), level: 1,
          answer: { kind: 'choice', options: [
            { id: 'a', md: '$\\dfrac12$', correct: true, why: tr('Referencia $30^\\circ$ y el seno es positivo en el segundo cuadrante.', 'Reference angle $30^\\circ$, and sine is positive in Quadrant II.') },
            { id: 'b', md: '$-\\dfrac12$', correct: false, why: tr('En el segundo cuadrante $y > 0$: el seno es positivo.', 'In Quadrant II $y > 0$: sine is positive.') },
            { id: 'c', md: '$\\dfrac{\\sqrt3}{2}$', correct: false, why: tr('Ese es $\\cos 30^\\circ$; el seno de $30^\\circ$ es $\\frac12$.', 'That is $\\cos 30^\\circ$; the sine of $30^\\circ$ is $\\frac12$.') }
          ] },
          hints: [tr('$150^\\circ = 180^\\circ - 30^\\circ$.', '$150^\\circ = 180^\\circ - 30^\\circ$.')],
          solution: tr('$\\sin 150^\\circ = \\sin 30^\\circ = \\frac12$.', '$\\sin 150^\\circ = \\sin 30^\\circ = \\frac12$.')
        },
        {
          prompt: tr('¿Cuánto vale $\\tan 225^\\circ$?', 'What is $\\tan 225^\\circ$?'), level: 2,
          answer: { kind: 'numeric', value: '1' },
          hints: [tr('Referencia $45^\\circ$.', 'Reference angle $45^\\circ$.'), tr('En el tercer cuadrante la tangente es positiva.', 'In Quadrant III tangent is positive.')],
          solution: tr('$\\tan 225^\\circ = \\tan 45^\\circ = 1$ (seno y coseno son negativos, su cociente es positivo).', '$\\tan 225^\\circ = \\tan 45^\\circ = 1$ (sine and cosine are both negative, so their ratio is positive).'),
          wrongs: [{ input: '-1', why: tr('En el tercer cuadrante seno y coseno son negativos: la tangente es positiva.', 'In Quadrant III sine and cosine are both negative: tangent is positive.') }]
        }
      ]
    })
  }
  return JSON.stringify({
    title: tr('Raíces de una parábola · 2 preguntas', 'Roots of a parabola · 2 questions'),
    exercises: [
      {
        prompt: tr('¿Dónde corta $f(x) = x^2 - 4$ al eje $x$?', 'Where does $f(x) = x^2 - 4$ cross the $x$ axis?'), level: 1,
        answer: { kind: 'choice', options: [
          { id: 'a', md: '$x = \\pm 2$', correct: true, why: tr('$x^2 = 4$ tiene dos soluciones: $2$ y $-2$.', '$x^2 = 4$ has two solutions: $2$ and $-2$.') },
          { id: 'b', md: '$x = \\pm 4$', correct: false, why: tr('$4$ es el valor de $x^2$, no el de $x$: falta la raíz cuadrada.', '$4$ is the value of $x^2$, not of $x$: take the square root.') },
          { id: 'c', md: tr('Solo en $x = 2$', 'Only at $x = 2$'), correct: false, why: tr('También $(-2)^2 = 4$: no olvides la raíz negativa.', 'Also $(-2)^2 = 4$: don\'t forget the negative root.') }
        ] },
        hints: [tr('Iguala $f(x)$ a cero.', 'Set $f(x)$ equal to zero.'), tr('$x^2 = 4$ tiene dos soluciones.', '$x^2 = 4$ has two solutions.')],
        solution: tr('$x^2 - 4 = 0 \\Rightarrow x^2 = 4 \\Rightarrow x = \\pm 2$.', '$x^2 - 4 = 0 \\Rightarrow x^2 = 4 \\Rightarrow x = \\pm 2$.')
      },
      {
        prompt: tr('¿Cuánto vale $f(3)$ si $f(x) = x^2 - 4$?', 'What is $f(3)$ if $f(x) = x^2 - 4$?'), level: 1,
        answer: { kind: 'numeric', value: '5' },
        hints: [tr('Sustituye $x = 3$.', 'Substitute $x = 3$.'), tr('$3^2 = 9$.', '$3^2 = 9$.')],
        solution: tr('$f(3) = 3^2 - 4 = 9 - 4 = 5$.', '$f(3) = 3^2 - 4 = 9 - 4 = 5$.'),
        wrongs: [{ input: '13', why: tr('Sumaste $4$ en lugar de restarlo.', 'You added $4$ instead of subtracting it.') }]
      }
    ]
  })
}

/** Las tarjetas de la IA simulada (una de huecos incluida): de trigonometría o de parábolas. */
export function fakeFlashcardsArgs(trig = false): string {
  if (trig) {
    return JSON.stringify({
      title: tr('Círculo unidad · 3 tarjetas', 'Unit circle · 3 cards'),
      cards: [
        { front: tr('¿Qué es un ángulo de referencia?', 'What is a reference angle?'), back: tr('El ángulo agudo entre el lado final y el eje $x$.', 'The acute angle between the terminal side and the $x$-axis.') },
        { kind: 'cloze', front: tr('En el tercer cuadrante, seno y coseno son {{c1::negativos}}.', 'In Quadrant III, sine and cosine are both {{c1::negative}}.'), back: '' },
        { front: '$\\cos 210^\\circ$', back: '$-\\dfrac{\\sqrt3}{2}$' }
      ]
    })
  }
  return JSON.stringify({
    title: tr('Parábolas · 3 tarjetas', 'Parabolas · 3 cards'),
    cards: [
      { front: tr('¿Qué es el vértice de una parábola?', 'What is the vertex of a parabola?'), back: tr('Su punto más alto o más bajo: en $f(x) = ax^2 + bx + c$ está en $x = -\\frac{b}{2a}$.', 'Its highest or lowest point: for $f(x) = ax^2 + bx + c$ it is at $x = -\\frac{b}{2a}$.') },
      { kind: 'cloze', front: tr('Las raíces de $x^2 - 4$ son {{c1::$\\pm 2$}}.', 'The roots of $x^2 - 4$ are {{c1::$\\pm 2$}}.'), back: '' },
      { front: tr('Discriminante', 'Discriminant'), back: tr('$\\Delta = b^2 - 4ac$: si es negativo, no hay raíces reales.', '$\\Delta = b^2 - 4ac$: if it is negative there are no real roots.') }
    ]
  })
}

/** La línea con la que Aula presenta lo que acaba de crear (sin repetir las preguntas, como pide la herramienta). */
export function fakeIntro(intent: 'quiz' | 'flashcards'): string {
  return intent === 'quiz'
    ? tr('Aquí tienes un test rápido: se corrige al momento y te explico cada error.', "Here's a quick quiz: it's graded instantly and I explain every mistake.")
    : tr('Aquí tienes unas tarjetas: gíralas con un clic o con la barra espaciadora.', 'Here are some cards: flip them with a click or the space bar.')
}

// MARK: Respuestas

function seenLine(courses: number | undefined): string {
  if (courses === undefined) return ''
  return courses === 0
    ? tr('He mirado tu Aula: aún no tienes cursos. ', "I've looked at your Aula: you have no courses yet. ")
    : tr(`He mirado tu Aula: tienes ${courses} ${courses === 1 ? 'curso' : 'cursos'}. `, `I've looked at your Aula: you have ${courses} ${courses === 1 ? 'course' : 'courses'}. `)
}

/** La respuesta de Aula simulada (con un bloque visual de verdad, para que se vea cómo se dibuja). */
export function fakeAnswer(message: string, courses: number | undefined, mentioned: readonly string[] = []): string {
  const asked = message.split('\n')[0].slice(0, 120)
  const seen = seenLine(courses)
  const about = mentioned.length
    ? tr(`Lo que mencionaste: ${mentioned.map((t) => `«${t}»`).join(', ')}. `, `What you mentioned: ${mentioned.map((t) => `“${t}”`).join(', ')}. `)
    : ''
  const plot = '{"type":"plot","title":"f(x) = x² − 4","xMin":-4,"xMax":4,"yMin":-5,"yMax":6,"curves":[{"expr":"x^2-4","label":"f","color":"accent"}],"points":[{"x":"-2","y":"0","label":"(-2, 0)"},{"x":"2","y":"0","label":"(2, 0)"}]}'
  return tr(
    `${seen}${about}Sobre «${asked}»: te lo explico con un ejemplo sencillo.\n\nUna función cuadrática como $f(x) = x^2 - 4$ corta el eje $x$ donde $f(x) = 0$, es decir, en $x = \\pm 2$:\n\n\`\`\`aula-block\n${plot}\n\`\`\`\n\n**Idea clave:** el vértice está en $(0, -4)$ y la parábola se abre hacia arriba porque el coeficiente de $x^2$ es positivo.\n\n¿Quieres que te ponga un test rápido para comprobarlo?`,
    `${seen}${about}About “${asked}”: let me explain it with a simple example.\n\nA quadratic function such as $f(x) = x^2 - 4$ crosses the $x$ axis where $f(x) = 0$, that is, at $x = \\pm 2$:\n\n\`\`\`aula-block\n${plot}\n\`\`\`\n\n**Key idea:** the vertex is at $(0, -4)$ and the parabola opens upwards because the coefficient of $x^2$ is positive.\n\nWould you like a quick quiz to check it?`
  )
}

/** Un pasaje de los materiales del curso (de `search_course_materials`). */
export interface FakePassage {
  cite: string
  snippet: string
}

/** La gráfica de la función de la que se habla (seno por defecto), en grados, con el ángulo de la pregunta marcado. */
function trigPlot(message: string): string {
  const m = foldPlain(message)
  const fn = /\b(cos|cosine|coseno)\b/.test(m) ? 'cos' : /\b(tangent|tangente)\b|\btan\s*[\d(θx]/.test(m) ? 'tan' : 'sin'
  const deg = Number(/\b(\d{1,3})\s*(?:°|deg|degrees|grados)/.exec(message)?.[1] ?? NaN)
  const value = (d: number): number => Math[fn]((d * Math.PI) / 180)
  const pts = Number.isFinite(deg) && deg <= 360 && fn !== 'tan' ? [{ x: String(deg), y: value(deg).toFixed(3), label: `${deg}°` }] : []
  const yr = fn === 'tan' ? [-4, 4] : [-1.4, 1.4]
  return JSON.stringify({ type: 'plot', title: `y = ${fn} x`, xMin: 0, xMax: 360, yMin: yr[0], yMax: yr[1],
    curves: [{ expr: `${fn}(x*pi/180)`, label: `${fn} x`, color: 'accent' }], points: pts })
}

/** El pasaje sin la frase cortada del principio (los fragmentos empiezan donde está la palabra buscada). */
function cleanPassage(snippet: string): string {
  let q = snippet.replace(/\s+/g, ' ').trim()
  if (q.startsWith('…')) {
    const next = q.search(/[.!?]\s+[A-ZÁÉÍÓÚ¿¡]/)
    q = next > 0 && q.length - next > 40 ? q.slice(next + 1).trim() : q.slice(1).trim()
  }
  return q.length > 240 ? q.slice(0, 240).replace(/\s+\S*$/, '') + '…' : q
}

/** Respuesta con lo que dicen los materiales del curso: la cita (que abre el lector) y la gráfica que se dibuja. */
export function fakeCitedAnswer(message: string, passage: FakePassage, courseTitle: string): string {
  const quote = cleanPassage(passage.snippet)
  const plot = trigPlot(message)
  return tr(
    `Lo he buscado en tus materiales de «${courseTitle}». Esto dicen:\n\n> ${quote}\n\n(Fuente: ${passage.cite})\n\nEn la gráfica se ve: el **tamaño** sale del ángulo de referencia y el **signo**, del cuadrante.\n\n\`\`\`aula-block\n${plot}\n\`\`\`\n\n¿Te pongo un test rápido de valores exactos?`,
    `I looked it up in your materials for “${courseTitle}”. Here's what they say:\n\n> ${quote}\n\n(Source: ${passage.cite})\n\nYou can see it on the graph: the **size** comes from the reference angle and the **sign** from the quadrant.\n\n\`\`\`aula-block\n${plot}\n\`\`\`\n\nWant a quick quiz on exact values?`
  )
}

/** La pista del tutor: la primera del ejercicio, sin dar la respuesta. */
export function fakeHint(hints: readonly string[]): string {
  if (!hints.length) {
    return tr('Una pista: empieza por escribir lo que sabes y lo que te piden, y busca qué los une. Dime qué te sale y lo vemos juntos.',
      "A hint: start by writing down what you know and what you're asked for, and look for what connects them. Tell me what you get and we'll check it together.")
  }
  return tr(`Una pista, sin darte la respuesta: ${hints[0]}\n\nPruébalo y dime qué te sale.`, `A hint, without giving it away: ${hints[0]}\n\nTry it and tell me what you get.`)
}

/** «Explícame mi error»: el porqué del error que reconoció el corrector (o el error típico que coincide con su respuesta)
 *  y la primera pista, sin la solución completa. */
export function fakeMistake(ex: { wrongs?: unknown; hints?: unknown }, input?: string, why?: string): string {
  const norm = (v: string): string => v.replace(/\s+|\$/g, '').toLowerCase()
  const wrongs = Array.isArray(ex.wrongs) ? ex.wrongs : []
  const typical = input ? wrongs.find((w) => typeof w?.input === 'string' && typeof w?.why === 'string' && norm(w.input) === norm(input))?.why : undefined
  const reason = (why?.trim() || typical)?.trim()
  const hint = Array.isArray(ex.hints) ? ex.hints.find((h): h is string => typeof h === 'string' && h.trim() !== '') : undefined
  const yours = input ? (/[\\^_{}]/.test(input) && !input.includes('$') ? `$${input}$` : `**${input}**`) : undefined
  const nudge = hint ? tr(`\n\n**Una pista para el siguiente intento:** ${hint}`, `\n\n**A nudge for your next try:** ${hint}`) : ''
  if (reason) {
    return tr(
      `${yours ? `Respondiste ${yours}. ` : ''}Es un error muy típico, y tiene arreglo:\n\n> ${reason}${nudge}\n\nCorrige ese detalle y vuelve a intentarlo: todavía no te doy la solución completa.`,
      `${yours ? `You answered ${yours}. ` : ''}That's a really common slip, and an easy one to fix:\n\n> ${reason}${nudge}\n\nFix that one detail and try again. I won't spoil the full solution yet.`
    )
  }
  return tr(
    `${yours ? `Respondiste ${yours}, y todavía no es lo que pide el enunciado. ` : ''}Vuelve a leer qué te piden y repasa cada paso.${nudge}\n\nDime qué te sale y lo vemos juntos.`,
    `${yours ? `You answered ${yours}, which isn't quite what the question asks for yet. ` : ''}Reread what it's asking and check each step.${nudge}\n\nTell me what you get and we'll check it together.`
  )
}

/** Lo que Aula dice tras apuntar (o no) el examen y crear (o no) el curso. */
export function fakeEventWrapUp(e: { added: boolean; title: string; course?: 'created' | 'card' | 'declined' | 'failed' }): string {
  if (!e.added) return tr('Vale, no lo apunto. Si cambias de idea, dímelo.', "Okay, I won't add it. If you change your mind, just tell me.")
  switch (e.course) {
    case 'created': return tr(`Listo: «${e.title}» está en tu calendario y ya estoy preparando el curso. Lo verás en la barra lateral; mientras, podemos seguir hablando.`,
      `Done: “${e.title}” is in your calendar and I'm already preparing the course. You'll see it in the sidebar; we can keep talking meanwhile.`)
    case 'card': return tr(`«${e.title}» ya está en tu calendario. Te he dejado una tarjeta para preparar el curso cuando quieras.`, `“${e.title}” is in your calendar. I've left you a card to prepare the course whenever you like.`)
    case 'failed': return tr(`«${e.title}» ya está en tu calendario, pero no pude empezar el curso. Pruébalo desde «Nuevo curso».`, `“${e.title}” is in your calendar, but I couldn't start the course. Try it from “New course”.`)
    default: return tr(`«${e.title}» ya está en tu calendario. Si quieres prepararlo más adelante, pídemelo.`, `“${e.title}” is in your calendar. If you want to prepare for it later, just ask.`)
  }
}

/** Lo que Aula dice tras pedir crear un curso. */
export function fakeCourseWrapUp(title: string, outcome: 'created' | 'card' | 'declined' | 'failed'): string {
  switch (outcome) {
    case 'created': return tr(`Estoy preparando «${title}»: lecciones, práctica, tarjetas y un simulacro, con las respuestas comprobadas. Lo verás en la barra lateral.`,
      `I'm preparing “${title}”: lessons, practice, flashcards and a mock exam, with every answer checked. You'll see it in the sidebar.`)
    case 'card': return tr(`Te he dejado una tarjeta para abrir «${title}» en «Nuevo curso», ya relleno.`, `I've left you a card to open “${title}” in “New course”, already filled in.`)
    case 'declined': return tr('Vale, no lo creo. Si cambias de idea, dímelo.', "Okay, I won't create it. If you change your mind, just tell me.")
    default: return tr('No pude empezar el curso. Pruébalo desde «Nuevo curso».', "I couldn't start the course. Try it from “New course”.")
  }
}
