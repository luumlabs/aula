// Cursos de ejemplo que vienen con la app (port de StudyEngine/Samples/SampleCourses.swift): sirven de visita guiada y de
// material de prueba. El contenido se escribe con la forma del JSON de los cursos y se lee con los mismos decodificadores
// tolerantes que un `pack.json` o un `skills/<id>.json` (así siempre sale un curso válido, con sus valores por defecto).
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePack, decodeSkill, type ItemID, type Pack, type Skill } from '@shared/schema'
import { DEMO_MATH_COURSE_ID, WELCOME_COURSE_IDS } from '@shared/samples'
import type { Library } from './library'

type Raw = Record<string, unknown>

/** Ids del curso de bienvenida (en español, en inglés y el que usaban las versiones anteriores). */
export const WELCOME_IDS: readonly string[] = WELCOME_COURSE_IDS
/** Tono del curso de bienvenida: ámbar, como su bombilla. */
export const WELCOME_HUE = 0.09
/** El tono que tenía la bienvenida en versiones anteriores (ciruela, violeta: el dueño no quiere nada violeta). */
const OLD_WELCOME_HUE = 0.78

/** Id del curso de ejemplo de matemáticas. */
export const DEMO_MATH_ID = DEMO_MATH_COURSE_ID

export interface InstallSamplesOptions {
  /** Solo si la biblioteca está vacía (primer arranque). Por defecto, sí. */
  onlyIfEmpty?: boolean
  now?: Date
  /** Idioma de la interfaz ('es', 'en-US'…): en español, los cursos de ejemplo en español; si no, en inglés. */
  language?: string
  /** Carpeta de un curso que viene con la app (`pack.json` + `skills/`): el ejemplo de matemáticas en inglés. */
  bundledCourseDir?: string
}

/** Crea (si no existen) los cursos de ejemplo en la biblioteca. Devuelve los ids instalados. */
export function installSampleCourses(library: Library, opts: InstallSamplesOptions = {}): ItemID[] {
  if ((opts.onlyIfEmpty ?? true) && library.packIDs().length > 0) return []
  const ids: ItemID[] = []
  const spanish = (opts.language ?? 'es').toLowerCase().startsWith('es')
  // en inglés, el curso de trigonometría que viene con la app (con sus materiales); si no está, el de funciones
  const bundled = !spanish && opts.bundledCourseDir ? installBundledCourse(library, opts.bundledCourseDir, opts.now) : null
  if (bundled) ids.push(bundled)
  const courses: Array<[Pack, Skill[]]> = spanish ? [functionsCourse(opts.now), welcomeCourse()] : [...(bundled ? [] : [functionsCourse(opts.now)]), welcomeCourseEn()]
  for (const [pack, skills] of courses) {
    if (library.openPack(pack.id)) continue
    // la bienvenida instalada por versiones anteriores (o en el otro idioma) no se duplica
    if (WELCOME_IDS.includes(pack.id) && WELCOME_IDS.some((id) => library.openPack(id))) continue
    try {
      const store = library.createPack(pack)
      for (const s of skills) store.saveSkill(s)
      ids.push(store.id)
    } catch {
      // un curso de ejemplo que no se puede escribir no impide instalar el otro
    }
  }
  return ids
}

/**
 * La bienvenida instalada por versiones anteriores llevaba el tono ciruela (0,78): pasa a ámbar. Solo si sigue con ese
 * valor exacto (nadie le eligió otro color; el selector de tonos guarda 0,8, nunca 0,78). Devuelve los ids cambiados.
 */
export function migrateWelcomeTone(library: Library): ItemID[] {
  const changed: ItemID[] = []
  for (const id of WELCOME_IDS) {
    const store = library.openPack(id)
    if (!store) continue
    try {
      if (Math.abs(store.loadPack().hue - OLD_WELCOME_HUE) > 1e-9) continue
      store.updatePack((p) => {
        p.hue = WELCOME_HUE
      })
      changed.push(id)
    } catch {
      // un curso que no se puede leer o escribir se queda como estaba
    }
  }
  return changed
}

/** Copia a la biblioteca un curso que viene con la app (sin progreso ni ejecuciones) y le pone el examen en unos días. */
function installBundledCourse(library: Library, dir: string, now?: Date): ItemID | null {
  const read = readBundledCourse(dir)
  if (!read) return null
  const id = read[0].id
  if (!id || library.openPack(id)) return null
  try {
    cpSync(dir, library.packDirectory(id), { recursive: true, filter: (src) => !/[\\/](progress\.json|runs|chats)$/.test(src) })
    const store = library.openPack(id)
    if (!store) return null
    store.updatePack((p) => {
      if (p.exam && !p.exam.date) p.exam = { ...p.exam, date: sampleExamDate(now) }
    })
    return id
  } catch {
    return null
  }
}

/** Un curso guardado con el formato de siempre (pack.json y skills/<id>.json), leído con los decodificadores tolerantes. */
export function readBundledCourse(dir: string): [Pack, Skill[]] | null {
  try {
    if (!existsSync(join(dir, 'pack.json'))) return null
    const pack = decodePack(JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as unknown)
    const skillsDir = join(dir, 'skills')
    const skills = existsSync(skillsDir)
      ? readdirSync(skillsDir).filter((f) => f.endsWith('.json')).sort().map((f) => decodeSkill(JSON.parse(readFileSync(join(skillsDir, f), 'utf8')) as unknown))
      : []
    return [pack, skills]
  } catch {
    return null
  }
}

/** El parcial de ejemplo: dentro de 9 días a las 9:00 (hora local; no a la hora en que se instaló Aula). */
export function sampleExamDate(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 9, 9, 0, 0, 0)
  return d.toISOString()
}

// MARK: Piezas

const text = (md: string): Raw => ({ type: 'text', md })
const block = (type: string, fields: Raw): Raw => ({ type, ...fields })
const callout = (kind: string, md: string, title?: string): Raw => block('callout', title === undefined ? { kind, md } : { kind, title, md })

interface ExerciseExtras {
  hints?: string[]
  solution?: string
  wrongs?: Array<[string, string]>
  points?: number
}

function ex(id: string, skill: string, level: number, prompt: string, answer: Raw, more: ExerciseExtras = {}): Raw {
  return {
    id, skill, level, prompt: [text(prompt)], answer, hints: more.hints ?? [], solution: more.solution ? [text(more.solution)] : [],
    wrongs: (more.wrongs ?? []).map(([input, why]) => ({ input, why })), points: more.points ?? 1, tags: []
  }
}

const choice = (options: Array<[string, string, boolean, string?]>): Raw =>
  ({ kind: 'choice', options: options.map(([id, md, correct, why]) => (why === undefined ? { id, md, correct } : { id, md, correct, why })) })
const numeric = (value: string, more: Raw = {}): Raw => ({ kind: 'numeric', value, ...more })
const card = (skill: string, front: string, back: string, kind = 'basic'): Raw => ({ skill, kind, front, back })
const predictOption = (md: string, correct: boolean, why?: string): Raw => (why === undefined ? { md, correct } : { md, correct, why })

function skillRef(id: string, unit: string, title: string, summary: string, objectives: string[], weight: number, minutes: number, order: number, prerequisites: string[] = []): Raw {
  return { id, unit, title, summary, objectives, prerequisites, weight, minutes, order }
}

// MARK: Demo de matemáticas: la parábola y la ecuación cuadrática

export function functionsCourse(now: Date = new Date()): [Pack, Skill[]] {
  const pack = decodePack({
    id: DEMO_MATH_ID, title: 'Funciones cuadráticas', subject: 'Matemáticas', courseCode: 'ÁLG-101', language: 'es', icon: 'algebra', hue: 0.62,
    exam: {
      title: 'Parcial 2 · Funciones y ecuaciones cuadráticas', date: sampleExamDate(now), durationMinutes: 60, totalPoints: 100,
      aids: 'Calculadora científica; sin apuntes.', notes: 'El profesor pide mostrar el procedimiento y simplificar las respuestas.'
    },
    units: [
      { id: 'u1', title: 'La parábola', summary: 'Cómo se ve y cómo se lee una función cuadrática', skillIDs: ['parabola'] },
      { id: 'u2', title: 'Ecuaciones cuadráticas', summary: 'Resolverlas con la fórmula general', skillIDs: ['formula-general'] }
    ],
    skills: [
      skillRef('parabola', 'u1', 'La parábola y su gráfica', 'Concavidad, vértice, eje de simetría e intersecciones.',
        ['Predecir hacia dónde abre una parábola', 'Calcular el vértice', 'Leer las intersecciones'], 45, 30, 0),
      skillRef('formula-general', 'u2', 'Fórmula general y discriminante', 'Resolver $ax^2+bx+c=0$ con seguridad.',
        ['Calcular el discriminante', 'Aplicar la fórmula general', 'Interpretar el número de soluciones'], 55, 35, 1, ['parabola'])
    ],
    blueprint: {
      durationMinutes: 60, totalPoints: 100, sections: [
        { title: 'Parte A · Parábola', skillIDs: ['parabola'], count: 4, minLevel: 1, maxLevel: 3, pointsEach: 10 },
        { title: 'Parte B · Ecuaciones', skillIDs: ['formula-general'], count: 5, minLevel: 1, maxLevel: 3, pointsEach: 12 }
      ]
    },
    glossary: [
      { term: 'Vértice', definition: 'El punto más alto o más bajo de la parábola. Está sobre el eje de simetría.', aliases: ['vertex'], skill: 'parabola' },
      { term: 'Discriminante', definition: 'El número $\\Delta=b^2-4ac$. Su signo dice cuántas soluciones reales tiene la ecuación.', aliases: [], skill: 'formula-general' },
      { term: 'Concavidad', definition: 'Hacia dónde abre la parábola: arriba si $a>0$, abajo si $a<0$.', aliases: [], skill: 'parabola' }
    ],
    formulaSheet: [
      {
        title: 'Parábola', items: [{
          name: 'Vértice (coordenada x)', tex: String.raw`x_v=-\dfrac{b}{2a}`, when: 'Para $y=ax^2+bx+c$.',
          vars: [{ symbol: 'a', meaning: 'coeficiente de $x^2$' }, { symbol: 'b', meaning: 'coeficiente de $x$' }]
        }]
      },
      {
        title: 'Ecuación cuadrática', items: [
          { name: 'Fórmula general', tex: String.raw`x=\dfrac{-b\pm\sqrt{b^2-4ac}}{2a}`, vars: [] },
          { name: 'Discriminante', tex: String.raw`\Delta=b^2-4ac`, when: '$\\Delta>0$: dos soluciones · $\\Delta=0$: una · $\\Delta<0$: ninguna real.', vars: [] }
        ]
      }
    ]
  })
  return [pack, [parabolaSkill(), formulaSkill()]]
}

function parabolaSkill(): Skill {
  return decodeSkill({
    id: 'parabola', title: 'La parábola y su gráfica', summary: 'Concavidad, vértice, eje de simetría e intersecciones.',
    objectives: ['Predecir hacia dónde abre una parábola', 'Calcular el vértice', 'Leer las intersecciones'], status: 'ready',
    lesson: [
      text('# La parábola\n\nCada vez que lanzas un balón, la trayectoria dibuja una **parábola**. En matemáticas, la parábola es la gráfica de una función cuadrática $y=ax^2+bx+c$ con $a\\neq 0$.'),
      block('predict', {
        question: 'Si cambias $a$ de $+1$ a $-1$ en $y=ax^2$, ¿qué le pasa a la gráfica?',
        options: [
          predictOption('Se vuelve más ancha', false, 'El ancho depende del tamaño de $|a|$, no de su signo.'),
          predictOption('Se voltea hacia abajo', true, 'El signo de $a$ decide hacia dónde abre.'),
          predictOption('Se desplaza a la derecha', false, 'Los desplazamientos los controlan $b$ y $c$ (y el vértice).')
        ],
        explanation: 'Compruébalo tú mismo con los deslizadores de abajo.'
      }),
      block('explore', {
        title: 'Juega con los coeficientes',
        plot: { title: 'y = ax² + bx + c', xMin: -6, xMax: 6, yMin: -8, yMax: 8, curves: [{ expr: 'a*x^2+b*x+c', label: 'y' }] },
        params: [
          { name: 'a', label: 'a', min: -3, max: 3, step: 0.5, value: 1 },
          { name: 'b', label: 'b', min: -6, max: 6, step: 1, value: 0 },
          { name: 'c', label: 'c', min: -6, max: 6, step: 1, value: -2 }
        ],
        prompts: ['¿Qué hace $a$ con la forma de la parábola?', '¿Qué punto de la gráfica es siempre $(0,c)$?', '¿Cuándo corta al eje $x$ en dos puntos?']
      }),
      callout('definition', 'El **vértice** es el punto más alto o más bajo. El **eje de simetría** es la recta vertical $x=x_v$ que pasa por él y divide la parábola en dos mitades iguales.', 'Vértice y eje de simetría'),
      block('math', { tex: String.raw`x_v=-\frac{b}{2a}\qquad y_v=f(x_v)`, label: 'Coordenadas del vértice' }),
      block('example', {
        title: 'Vértice de $y=x^2-4x+3$', problem: 'Encuentra el vértice y decide si es un máximo o un mínimo.',
        steps: [
          { md: 'Lee los coeficientes: $a=1$, $b=-4$, $c=3$.' },
          { md: 'Calcula $x_v=-\\dfrac{b}{2a}=-\\dfrac{-4}{2(1)}=2$.' },
          { md: 'Sustituye: $y_v=2^2-4(2)+3=-1$.', note: 'Siempre sustituye en la función original, no en la fórmula del vértice.' },
          { md: 'Como $a=1>0$ la parábola abre hacia arriba, así que el vértice es un **mínimo**.' }
        ],
        answer: 'Vértice $(2,-1)$, un mínimo.'
      }),
      callout('mistake', 'Olvidar el signo menos de $-\\frac{b}{2a}$. Si $b=-4$, el resultado es $+2$, no $-2$.'),
      block('spot', {
        intro: 'Una estudiante calculó el vértice de $y=2x^2+8x+1$. ¿Dónde se equivocó?',
        lines: ['$a=2,\\; b=8$', '$x_v=-\\dfrac{8}{2(2)}=-2$', '$y_v=2(-2)^2+8(-2)+1=8-16+1=-7$', 'Vértice: $(2,-7)$'], wrongIndex: 3,
        explanation: 'La coordenada $x$ del vértice es $-2$ (línea 2), pero en la respuesta final escribió $+2$.'
      }),
      block('tryit', { title: 'Compruébalo', exerciseIDs: ['p-e1', 'p-e2'] }),
      block('table', {
        headers: ['Si…', 'La parábola…'],
        rows: [['$a>0$', 'abre hacia arriba: el vértice es un **mínimo**'], ['$a<0$', 'abre hacia abajo: el vértice es un **máximo**'], ['$|a|$ grande', 'es más **estrecha**'], ['$c$', 'es la altura donde corta al eje $y$']]
      }),
      block('recap', { points: ['$a$ decide hacia dónde abre y qué tan ancha es.', 'El vértice está en $x_v=-\\frac{b}{2a}$.', '$c$ es la intersección con el eje $y$.'] })
    ],
    exercises: [
      ex('p-e1', 'parabola', 1, '¿Hacia dónde abre la parábola $y=-2x^2+3x-1$?', choice([
        ['a', 'Hacia arriba', false, 'Eso ocurre si $a>0$; aquí $a=-2$.'],
        ['b', 'Hacia abajo', true, '$a=-2<0$.'],
        ['c', 'Depende de $b$', false, 'La concavidad solo depende del signo de $a$.']
      ]), { hints: ['Fíjate solo en el coeficiente de $x^2$.'], solution: 'El coeficiente de $x^2$ es $a=-2<0$, así que abre hacia **abajo**.' }),
      ex('p-e2', 'parabola', 1, 'El vértice de $y=x^2-6x+5$ tiene coordenada $x$ igual a…', numeric('3', { prefix: '$x_v =$' }), {
        hints: ['Usa $x_v=-\\frac{b}{2a}$.', 'Aquí $a=1$ y $b=-6$.'], solution: '$x_v=-\\dfrac{-6}{2(1)}=3$.',
        wrongs: [['-3', 'Perdiste el signo: $-\\frac{b}{2a}$ con $b=-6$ da $+3$.']]
      }),
      ex('p-e3', 'parabola', 2, 'Calcula la coordenada $y$ del vértice de $y=x^2-4x+3$.', numeric('-1', { prefix: '$y_v =$' }), {
        hints: ['Primero encuentra $x_v$.', 'Luego sustituye $x_v$ en la función.'], solution: '$x_v=2$ y $y_v=2^2-4(2)+3=-1$.',
        wrongs: [['2', 'Esa es la coordenada $x$ del vértice; la pregunta pide la $y$.']]
      }),
      ex('p-e4', 'parabola', 2, '¿Cuál es la intersección con el eje $y$ de $y=3x^2-5x+7$?', { kind: 'point', expected: ['0', '7'] }, {
        hints: ['El eje $y$ es donde $x=0$.'], solution: 'Con $x=0$: $y=7$. El punto es $(0,7)$.'
      }),
      ex('p-e5', 'parabola', 2, 'Escribe, separadas por comas, las soluciones de $x^2-5x+6=0$.', { kind: 'set', expected: ['2', '3'] }, {
        hints: ['Busca dos números que sumen 5 y multipliquen 6.'], solution: '$x^2-5x+6=(x-2)(x-3)$, así que $x=2$ o $x=3$.'
      }),
      ex('p-e6', 'parabola', 2, 'Completa: el vértice de una parábola que abre hacia [[1]] es un punto [[2]].',
        { kind: 'cloze', text: '', blanks: [{ accepted: ['arriba'] }, { accepted: ['mínimo', 'minimo', 'más bajo'] }] }),
      ex('p-e7', 'parabola', 1, 'Verdadero o falso: la parábola $y=x^2+1$ corta al eje $x$.', { kind: 'truefalse', value: false }, {
        solution: 'No: $x^2+1\\ge 1>0$, nunca vale cero.'
      }),
      ex('p-e8', 'parabola', 3, 'Ordena los pasos para graficar $y=x^2-4x+3$.', {
        kind: 'ordering', items: ['Identifica $a$, $b$ y $c$', 'Calcula $x_v=-\\frac{b}{2a}$', 'Calcula $y_v$ sustituyendo $x_v$', 'Marca la intersección con el eje $y$', 'Traza la curva simétrica']
      }),
      ex('p-e9', 'parabola', 3, 'Relaciona cada situación con su gráfica.', {
        kind: 'matching', pairs: [{ left: '$a>0$', right: 'abre hacia arriba' }, { left: '$a<0$', right: 'abre hacia abajo' }, { left: '$|a|$ grande', right: 'parábola estrecha' }],
        extraRights: ['se desplaza a la derecha']
      }),
      ex('p-e10', 'parabola', 3, 'Una pelota sigue $h(t)=-5t^2+20t$ (metros, segundos). ¿Cuál es la altura máxima?',
        numeric('20', { unit: 'm', unitMode: 'optional', suffix: 'm' }), {
          hints: ['La altura máxima es la coordenada $y$ del vértice.', '$t_v=-\\frac{20}{2(-5)}=2$.'], solution: '$t_v=2$ s y $h(2)=-5(4)+40=20$ m.',
          wrongs: [['2', 'Esa es la hora a la que ocurre el máximo (2 s), no la altura.']], points: 2
        })
    ],
    templates: [{
      id: 'p-t1', skill: 'parabola', level: 2,
      vars: [{ name: 'a', kind: 'int', min: 1, max: 4 }, { name: 'h', kind: 'int', min: -5, max: 5 }, { name: 'b', kind: 'expr', expr: '-2*a*h' }, { name: 'c', kind: 'int', min: -9, max: 9 }],
      constraints: ['h != 0'],
      prompt: [text('Halla la coordenada $x$ del vértice de $y={{tex:a}}x^2{{signed:b}}x{{signed:c}}$.')],
      answer: numeric('h', { prefix: '$x_v =$' }),
      hints: ['$x_v=-\\frac{b}{2a}$ con $a={{a}}$ y $b={{b}}$.'], solution: [text('$x_v=-\\dfrac{{{b}}}{2({{a}})}={{h}}$.')],
      wrongs: [{ input: '-h', why: 'Cuidado con el signo de $b$ al aplicar $-\\frac{b}{2a}$.' }], points: 1, tags: ['vértice']
    }],
    cards: [
      card('parabola', '¿Qué decide el signo de $a$ en $y=ax^2+bx+c$?', 'Hacia dónde abre: arriba si $a>0$, abajo si $a<0$.'),
      card('parabola', 'Coordenada $x$ del vértice', '$x_v=-\\dfrac{b}{2a}$'),
      card('parabola', 'La parábola $y=ax^2+bx+c$ corta al eje $y$ en el punto {{c1::$(0,c)$}}.', '', 'cloze'),
      card('parabola', '¿Cómo se halla $y_v$?', 'Sustituyendo $x_v$ en la función original.')
    ],
    mistakes: [{
      title: 'Signo del vértice', wrong: '$x_v=\\frac{b}{2a}$ (sin el menos)', right: '$x_v=-\\frac{b}{2a}$',
      why: 'La fórmula lleva un signo menos delante; se pierde fácil cuando $b$ ya es negativo.'
    }]
  })
}

function formulaSkill(): Skill {
  return decodeSkill({
    id: 'formula-general', title: 'Fórmula general y discriminante', summary: 'Resolver $ax^2+bx+c=0$ con seguridad.',
    objectives: ['Calcular el discriminante', 'Aplicar la fórmula general', 'Interpretar el número de soluciones'], prerequisites: ['parabola'], status: 'ready',
    lesson: [
      text('# Resolver $ax^2+bx+c=0$\n\nA veces no se puede factorizar con facilidad. La **fórmula general** funciona siempre.'),
      block('math', { tex: String.raw`x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}`, label: 'Fórmula general' }),
      callout('definition', 'El número $\\Delta=b^2-4ac$ (lo que hay dentro de la raíz). Si $\\Delta>0$ hay dos soluciones reales; si $\\Delta=0$, una; si $\\Delta<0$, ninguna real.', 'Discriminante'),
      block('example', {
        title: 'Resolver $2x^2-3x-5=0$', problem: 'Calcula las soluciones reales.',
        steps: [
          { md: 'Identifica $a=2$, $b=-3$, $c=-5$.' }, { md: 'Calcula $\\Delta=(-3)^2-4(2)(-5)=9+40=49$.', note: 'Es positivo: habrá dos soluciones.' },
          { md: 'Aplica la fórmula: $x=\\dfrac{3\\pm 7}{4}$.' }, { md: 'Separa: $x=\\dfrac{10}{4}=\\dfrac{5}{2}$ o $x=\\dfrac{-4}{4}=-1$.' }
        ],
        answer: '$x=\\frac{5}{2}$ o $x=-1$'
      }),
      block('predict', {
        question: '¿Cuántas soluciones reales tiene $x^2+4=0$?',
        options: [predictOption('Dos', false), predictOption('Ninguna', true, '$\\Delta=0-16<0$.'), predictOption('Una', false)],
        explanation: 'Un cuadrado nunca es negativo, así que $x^2=-4$ no tiene solución real.'
      }),
      block('tryit', { exerciseIDs: ['f-e1', 'f-e2'] }),
      block('recap', { points: ['Siempre se puede usar la fórmula general.', 'El signo de $\\Delta$ cuenta las soluciones.', 'Revisa los signos de $b$ y $c$ antes de sustituir.'] })
    ],
    exercises: [
      ex('f-e1', 'formula-general', 1, 'Calcula el discriminante de $x^2-6x+5=0$.', numeric('16', { prefix: '$\\Delta =$' }), {
        hints: ['$\\Delta=b^2-4ac$ con $a=1$, $b=-6$, $c=5$.'], solution: '$\\Delta=36-20=16$.',
        wrongs: [['-16', '$(-6)^2=+36$: el cuadrado de un negativo es positivo.']]
      }),
      ex('f-e2', 'formula-general', 2, 'Resuelve $x^2-6x+5=0$ (escribe las soluciones separadas por coma).', { kind: 'set', expected: ['1', '5'] }, {
        hints: ['$\\Delta=16$, así que $\\sqrt{\\Delta}=4$.'], solution: '$x=\\dfrac{6\\pm4}{2}$, es decir $x=5$ o $x=1$.'
      }),
      ex('f-e3', 'formula-general', 2, '¿Cuántas soluciones reales tiene $3x^2+2x+5=0$?', numeric('0'), {
        hints: ['Calcula $\\Delta$.'], solution: '$\\Delta=4-60=-56<0$: ninguna.', wrongs: [['2', 'Solo ocurre con $\\Delta>0$; aquí $\\Delta<0$.']]
      }),
      ex('f-e4', 'formula-general', 3, 'Resuelve $2x^2-3x-5=0$. Escribe las dos soluciones separadas por coma.', { kind: 'set', expected: ['5/2', '-1'] }, {
        hints: ['$\\Delta=49$.'], solution: '$x=\\dfrac{3\\pm7}{4}$: $x=\\frac52$ o $x=-1$.', points: 2
      }),
      ex('f-e5', 'formula-general', 3, 'Si $\\Delta=0$, la ecuación tiene…', choice([
        ['a', 'dos soluciones reales distintas', false], ['b', 'una solución real (doble)', true, '$\\pm\\sqrt{0}=0$: las dos soluciones coinciden.'], ['c', 'ninguna solución real', false]
      ]))
    ],
    templates: [{
      id: 'f-t1', skill: 'formula-general', level: 2,
      vars: [
        { name: 'p', kind: 'int', min: -6, max: 6, exclude: [0] }, { name: 'q', kind: 'int', min: -6, max: 6, exclude: [0] },
        { name: 'b', kind: 'expr', expr: '-(p+q)' }, { name: 'c', kind: 'expr', expr: 'p*q' }
      ],
      constraints: ['p != q'],
      prompt: [text('Resuelve $x^2{{signed:b}}x{{signed:c}}=0$ (soluciones separadas por coma).')],
      answer: { kind: 'set', expected: ['p', 'q'] },
      hints: ['Busca dos números que sumen {{-b}} y multipliquen {{c}}.', '$\\Delta=b^2-4c=({{b}})^2-4({{c}})$.'],
      solution: [text('Las soluciones son $x={{p}}$ y $x={{q}}$.')], wrongs: [], points: 1, tags: []
    }],
    cards: [
      card('formula-general', 'Fórmula general', '$x=\\dfrac{-b\\pm\\sqrt{b^2-4ac}}{2a}$'),
      card('formula-general', 'Si $\\Delta<0$…', 'No hay soluciones reales.')
    ]
  })
}

// MARK: Bienvenida: cómo estudiar con Aula

export function welcomeCourse(): [Pack, Skill[]] {
  const pack = decodePack({
    id: WELCOME_IDS[0], title: 'Bienvenida a Aula', subject: 'Aprender a aprender', language: 'es', icon: 'idea', hue: WELCOME_HUE,
    units: [{ id: 'u1', title: 'Estudiar de forma que funcione', summary: 'Las técnicas con más evidencia, y cómo las usa Aula', skillIDs: ['memoria', 'recuperacion'] }],
    skills: [
      skillRef('memoria', 'u1', 'La curva del olvido y el repaso espaciado', 'Por qué olvidas y cómo evitarlo.', ['Explicar la curva del olvido', 'Programar repasos espaciados'], 50, 12, 0),
      skillRef('recuperacion', 'u1', 'Práctica de recuperación', 'Responder sin mirar aprende más que releer.', ['Distinguir releer de recordar', 'Usar la práctica de recuperación'], 50, 12, 1, ['memoria'])
    ]
  })
  return [pack, [memorySkill(), retrievalSkill()]]
}

function memorySkill(): Skill {
  return decodeSkill({
    id: 'memoria', title: 'La curva del olvido y el repaso espaciado', summary: 'Por qué olvidas y cómo evitarlo.',
    objectives: ['Explicar la curva del olvido', 'Programar repasos espaciados'], status: 'ready',
    lesson: [
      text('# Por qué olvidamos\n\nEn 1885 Hermann Ebbinghaus midió cuánto recordaba de listas de sílabas sin sentido. Descubrió algo incómodo: **olvidamos muy rápido al principio** y luego más despacio.'),
      block('predict', {
        question: 'Si estudias algo una vez y no lo vuelves a ver, ¿cuánto crees que recordarás al cabo de **una semana**?',
        options: [predictOption('Más de la mitad', false), predictOption('Menos de una cuarta parte', true, 'En los experimentos clásicos queda alrededor del 20–25 %.'), predictOption('Casi todo', false)],
        explanation: 'Por eso releer la noche anterior da una falsa sensación de dominio.'
      }),
      block('chart', {
        kind: 'line', title: 'Lo que recuerdas sin repasar (%)', xLabel: 'Días', yLabel: 'Recuerdo',
        series: [{ name: 'Sin repaso', points: [{ label: '0', x: 0, y: 100 }, { label: '1', x: 1, y: 40 }, { label: '2', x: 2, y: 30 }, { label: '7', x: 7, y: 22 }, { label: '30', x: 30, y: 15 }] }],
        unit: '%', caption: 'Valores aproximados de la curva clásica de Ebbinghaus.'
      }),
      callout('definition', 'Volver a ver la información **justo antes de olvidarla**, con intervalos cada vez más largos (1 día, 3 días, 1 semana, 1 mes…). Cada repaso exitoso hace la memoria más duradera.', 'Repaso espaciado'),
      block('timeline', {
        title: 'Un calendario de repasos típico',
        events: [
          { when: 'Día 0', title: 'Estudias' }, { when: 'Día 1', title: '1.er repaso', md: 'Lo ves otra vez, intentando recordarlo primero.' },
          { when: 'Día 3', title: '2.º repaso' }, { when: 'Día 8', title: '3.er repaso' }, { when: 'Día 30', title: '4.º repaso', md: 'Ya es memoria a largo plazo.' }
        ]
      }),
      callout('tip', 'Las **tarjetas** y tu **cuaderno de errores** usan un algoritmo de repaso espaciado (FSRS). Tú solo contestas «Otra vez», «Difícil», «Bien» o «Fácil»: Aula decide cuándo volver a preguntarte.', 'Cómo lo hace Aula'),
      block('recap', { points: ['Sin repasar, se olvida rápido al principio.', 'Repasar antes de olvidar fortalece más que releer.', 'Los intervalos crecen con cada acierto.'] })
    ],
    exercises: [
      ex('m-e1', 'memoria', 1, '¿Cuándo es más eficaz repasar un tema?', choice([
        ['a', 'Justo después de estudiarlo, muchas veces seguidas', false, 'Repetir de golpe (amontonar) da una ilusión de dominio, no memoria duradera.'],
        ['b', 'Poco antes de que lo olvides, con intervalos crecientes', true],
        ['c', 'Solo la noche anterior al examen', false, 'Funciona para el día siguiente, pero se olvida enseguida.']
      ])),
      ex('m-e2', 'memoria', 1, 'Verdadero o falso: olvidamos al mismo ritmo todo el tiempo.', { kind: 'truefalse', value: false }, {
        solution: 'Olvidamos muy rápido al principio y más despacio después.'
      }),
      ex('m-e3', 'memoria', 2, 'Completa: el [[1]] espaciado consiste en volver a ver la información con intervalos cada vez [[2]].',
        { kind: 'cloze', text: '', blanks: [{ accepted: ['repaso'] }, { accepted: ['más largos', 'mayores', 'más grandes', 'largos'] }] }),
      ex('m-e4', 'memoria', 2, 'Ordena de menor a mayor intervalo un calendario de repasos.', { kind: 'ordering', items: ['1 día', '3 días', '1 semana', '1 mes'] })
    ],
    cards: [
      card('memoria', '¿Qué dice la curva del olvido?', 'Que se olvida muy rápido al principio y más despacio después.'),
      card('memoria', 'Repaso espaciado', 'Volver a ver la información justo antes de olvidarla, con intervalos cada vez más largos.')
    ]
  })
}

function retrievalSkill(): Skill {
  return decodeSkill({
    id: 'recuperacion', title: 'Práctica de recuperación', summary: 'Responder sin mirar aprende más que releer.',
    objectives: ['Distinguir releer de recordar', 'Usar la práctica de recuperación'], prerequisites: ['memoria'], status: 'ready',
    lesson: [
      text('# Recordar fortalece\n\nIntentar **sacar la respuesta de tu cabeza** (aunque falles) construye memoria mucho más que releer el mismo texto. Se llama *práctica de recuperación* o *efecto de prueba*.'),
      block('compare', {
        title: 'Dos formas de estudiar', leftTitle: 'Releer', rightTitle: 'Recuperar',
        rows: [
          { label: 'Se siente', left: 'Fácil y cómodo', right: 'Difícil (y eso es bueno)' },
          { label: 'Resultado a una semana', left: 'Se olvida mucho', right: 'Se recuerda mucho más' },
          { label: 'Ejemplo', left: 'Subrayar el libro', right: 'Hacer un ejercicio sin mirar la solución' }
        ]
      }),
      callout('remember', 'Si un ejercicio te cuesta, **no es una señal de fracaso**: ese esfuerzo es lo que fortalece la memoria. Fallar y ver la explicación enseña más que acertar por casualidad.'),
      block('steps', {
        title: 'Cómo practicar con Aula',
        steps: [
          { title: 'Aprende', md: 'Haz la lección de la habilidad.' }, { title: 'Practica', md: 'Resuelve ejercicios *sin mirar* la teoría.' },
          { title: 'Revisa tus errores', md: 'Lee el «¿Qué pasó?» de cada fallo.' },
          { title: 'Repite espaciado', md: 'Las tarjetas y el cuaderno de errores te devuelven lo que está por olvidarse.' }
        ]
      }),
      block('recap', { points: ['Recuperar > releer.', 'El esfuerzo deseable fortalece la memoria.', 'Los errores son información.'] })
    ],
    exercises: [
      ex('r-e1', 'recuperacion', 1, '¿Qué técnica se basa en intentar recordar la respuesta antes de mirarla?', {
        kind: 'short', accepted: ['práctica de recuperación', 'recuperación', 'efecto de prueba', 'retrieval practice'], keywords: ['recuperación|prueba|recordar']
      }, { solution: 'Se llama **práctica de recuperación** (o efecto de prueba).' }),
      ex('r-e2', 'recuperacion', 2, 'Explica con tus palabras por qué releer no es tan eficaz como hacer ejercicios.', {
        kind: 'open',
        modelAnswer: 'Releer da una sensación de familiaridad (todo parece conocido) pero no obliga a recuperar la información; recordar activamente fortalece la memoria.',
        rubric: [
          { text: 'Menciona que releer da una falsa sensación de dominio / familiaridad', points: 1 },
          { text: 'Dice que recuperar o recordar activamente fortalece la memoria', points: 1 }
        ]
      })
    ],
    cards: [card('recuperacion', 'Práctica de recuperación', 'Intentar recordar la respuesta antes de mirarla; fortalece la memoria más que releer.')]
  })
}

// MARK: Bienvenida en inglés (el mismo curso, para quien usa Aula en inglés)

export function welcomeCourseEn(): [Pack, Skill[]] {
  const pack = decodePack({
    id: WELCOME_IDS[1], title: 'Welcome to Aula', subject: 'Learning how to learn', language: 'en', icon: 'idea', hue: WELCOME_HUE,
    units: [{ id: 'u1', title: 'Studying in a way that works', summary: 'The techniques with the most evidence, and how Aula uses them', skillIDs: ['memory', 'retrieval'] }],
    skills: [
      skillRef('memory', 'u1', 'The forgetting curve and spaced review', 'Why you forget and how to stop it.', ['Explain the forgetting curve', 'Schedule spaced reviews'], 50, 12, 0),
      skillRef('retrieval', 'u1', 'Retrieval practice', 'Answering without looking teaches more than rereading.', ['Tell rereading from recalling', 'Use retrieval practice'], 50, 12, 1, ['memory'])
    ]
  })
  return [pack, [memorySkillEn(), retrievalSkillEn()]]
}

function memorySkillEn(): Skill {
  return decodeSkill({
    id: 'memory', title: 'The forgetting curve and spaced review', summary: 'Why you forget and how to stop it.',
    objectives: ['Explain the forgetting curve', 'Schedule spaced reviews'], status: 'ready',
    lesson: [
      text('# Why we forget\n\nIn 1885 Hermann Ebbinghaus measured how much he remembered of lists of nonsense syllables. He found something uncomfortable: **we forget very fast at first**, and then more slowly.'),
      block('predict', {
        question: 'If you study something once and never see it again, how much do you think you will remember **a week** later?',
        options: [predictOption('More than half', false), predictOption('Less than a quarter', true, 'In the classic experiments about 20–25% is left.'), predictOption('Almost everything', false)],
        explanation: 'That is why rereading the night before gives a false feeling of mastery.'
      }),
      block('chart', {
        kind: 'line', title: 'What you remember without reviewing (%)', xLabel: 'Days', yLabel: 'Recall',
        series: [{ name: 'No review', points: [{ label: '0', x: 0, y: 100 }, { label: '1', x: 1, y: 40 }, { label: '2', x: 2, y: 30 }, { label: '7', x: 7, y: 22 }, { label: '30', x: 30, y: 15 }] }],
        unit: '%', caption: 'Approximate values from the classic Ebbinghaus curve.'
      }),
      callout('definition', 'Seeing the information again **just before you forget it**, at longer and longer intervals (1 day, 3 days, 1 week, 1 month…). Each successful review makes the memory last longer.', 'Spaced review'),
      block('timeline', {
        title: 'A typical review schedule',
        events: [
          { when: 'Day 0', title: 'You study' }, { when: 'Day 1', title: '1st review', md: 'You see it again, trying to recall it first.' },
          { when: 'Day 3', title: '2nd review' }, { when: 'Day 8', title: '3rd review' }, { when: 'Day 30', title: '4th review', md: 'Now it is long-term memory.' }
        ]
      }),
      callout('tip', 'Your **flashcards** and your **mistakes notebook** use a spaced-repetition algorithm (FSRS). You just answer “Again”, “Hard”, “Good” or “Easy”: Aula decides when to ask you again.', 'How Aula does it'),
      block('recap', { points: ['Without reviewing, you forget fast at first.', 'Reviewing before you forget strengthens more than rereading.', 'Intervals grow with every correct answer.'] })
    ],
    exercises: [
      ex('m-e1', 'memory', 1, 'When is reviewing a topic most effective?', choice([
        ['a', 'Right after studying it, many times in a row', false, 'Cramming gives an illusion of mastery, not lasting memory.'],
        ['b', 'Shortly before you would forget it, at growing intervals', true],
        ['c', 'Only the night before the exam', false, 'It works for the next day, but it is forgotten right away.']
      ])),
      ex('m-e2', 'memory', 1, 'True or false: we forget at the same rate all the time.', { kind: 'truefalse', value: false }, {
        solution: 'We forget very fast at first and more slowly afterwards.'
      }),
      ex('m-e3', 'memory', 2, 'Fill in: spaced [[1]] means seeing the information again at [[2]] and longer intervals.',
        { kind: 'cloze', text: '', blanks: [{ accepted: ['review', 'repetition', 'reviewing'] }, { accepted: ['longer', 'growing', 'increasing'] }] }),
      ex('m-e4', 'memory', 2, 'Order a review schedule from the shortest to the longest interval.', { kind: 'ordering', items: ['1 day', '3 days', '1 week', '1 month'] })
    ],
    cards: [
      card('memory', 'What does the forgetting curve say?', 'That we forget very fast at first and more slowly afterwards.'),
      card('memory', 'Spaced review', 'Seeing the information again just before you forget it, at longer and longer intervals.')
    ]
  })
}

function retrievalSkillEn(): Skill {
  return decodeSkill({
    id: 'retrieval', title: 'Retrieval practice', summary: 'Answering without looking teaches more than rereading.',
    objectives: ['Tell rereading from recalling', 'Use retrieval practice'], prerequisites: ['memory'], status: 'ready',
    lesson: [
      text('# Recalling makes memory stronger\n\nTrying to **pull the answer out of your head** (even if you get it wrong) builds memory far more than rereading the same text. It is called *retrieval practice* or the *testing effect*.'),
      block('compare', {
        title: 'Two ways to study', leftTitle: 'Rereading', rightTitle: 'Retrieving',
        rows: [
          { label: 'It feels', left: 'Easy and comfortable', right: 'Hard (and that is good)' },
          { label: 'A week later', left: 'Much is forgotten', right: 'Much more is remembered' },
          { label: 'Example', left: 'Highlighting the book', right: 'Doing an exercise without looking at the solution' }
        ]
      }),
      callout('remember', 'If an exercise is hard, **it is not a sign of failure**: that effort is what strengthens memory. Getting it wrong and reading the explanation teaches more than getting it right by chance.'),
      block('steps', {
        title: 'How to practise with Aula',
        steps: [
          { title: 'Learn', md: 'Do the lesson for the skill.' }, { title: 'Practise', md: 'Solve exercises *without looking* at the theory.' },
          { title: 'Review your mistakes', md: 'Read the “What happened?” of each miss.' },
          { title: 'Repeat, spaced out', md: 'Flashcards and the mistakes notebook bring back what you are about to forget.' }
        ]
      }),
      block('recap', { points: ['Retrieving > rereading.', 'Desirable difficulty strengthens memory.', 'Mistakes are information.'] })
    ],
    exercises: [
      ex('r-e1', 'retrieval', 1, 'Which technique is based on trying to recall the answer before looking at it?', {
        kind: 'short', accepted: ['retrieval practice', 'retrieval', 'testing effect', 'practice testing'], keywords: ['retriev|test|recall']
      }, { solution: 'It is called **retrieval practice** (or the testing effect).' }),
      ex('r-e2', 'retrieval', 2, 'Explain in your own words why rereading is less effective than doing exercises.', {
        kind: 'open',
        modelAnswer: 'Rereading gives a feeling of familiarity (everything looks known) but does not force you to retrieve the information; actively recalling it strengthens memory.',
        rubric: [
          { text: 'Mentions that rereading gives a false feeling of mastery / familiarity', points: 1 },
          { text: 'Says that retrieving or actively recalling strengthens memory', points: 1 }
        ]
      })
    ],
    cards: [card('retrieval', 'Retrieval practice', 'Trying to recall the answer before looking at it; it strengthens memory more than rereading.')]
  })
}
