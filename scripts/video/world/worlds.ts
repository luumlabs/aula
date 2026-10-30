// Mundos del vídeo «Un día de luz» (montage/aula-film.ts): plantillas de AULA_HOME, todo en inglés, con fechas calculadas desde
// HOY (el día en que se renderiza). La app siembra al arrancar (AULA_SEED=demo) seis semanas de estudio en los cursos sin
// progreso, con la fecha real del sistema; por eso las fechas de aquí también salen del día real, y las tomas usan ese
// mismo día como reloj (montage/aula-film.ts → FILM_DAY). Nada de datos reales: Maya, MATH 101, canvas.example.edu.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const TRIG = join(ROOT, 'resources/demo-course/Packs/exam-2-math112')
/** Sube este número si cambia el contenido de las plantillas: la ruta entra en la huella de las tomas (caché). */
export const WORLD_VERSION = 14

// ——— fechas ———
/** Medianoche local de hoy (el día de la película). */
export function filmDay(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
const at = (days: number, h = 0, m = 0): Date => {
  const d = filmDay()
  d.setDate(d.getDate() + days)
  d.setHours(h, m, 0, 0)
  return d
}
/** Días hasta el viernes de la semana que viene (el Examen #2). */
function nextWeekThursday(): number {
  const dow = filmDay().getDay() // 0 = domingo
  const toFri = (5 - dow + 7) % 7 || 7
  return toFri + 7
}
export const EXAM_IN_DAYS = nextWeekThursday()
export const examDate = (): Date => at(EXAM_IN_DAYS, 9)
/** Hora local de la película como ISO para `take.clock` (día 0 = hoy, +1 = mañana). */
export function clockAt(day: number, h: number, m = 0): string {
  const d = at(day, h, m)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(h)}:${p(m)}:00`
}
export const weekday = (day: number): string => at(day).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()

// ——— cursos sintéticos (en inglés, con lección mínima, ejercicios y tarjetas para que la siembra tenga con qué) ———
interface SkillSpec {
  title: string
  summary: string
  ex: [string, string][]
  cards: [string, string][]
}
interface CourseSpec {
  id: string
  title: string
  subject: string
  code?: string
  icon: string
  hue: number
  examTitle?: string
  examIn?: number
  selfPaced?: boolean
  skills: SkillSpec[]
}

const COURSES: Record<string, CourseSpec> = {
  chem: {
    id: 'chem-110-midterm', title: 'General Chemistry', subject: 'Chemistry', code: 'CHEM 110', icon: 'chemistry', hue: 0.38,
    examTitle: 'Chemistry midterm', examIn: 9,
    skills: [
      { title: 'Moles and molar mass', summary: 'Count particles by weighing them.', ex: [['Molar mass of H₂O in g/mol?', '18'], ['Moles in 36 g of water?', '2'], ['Avogadro\'s number (×10²³)?', '6.022']], cards: [['What is a mole?', '6.022 × 10²³ particles'], ['Molar mass of carbon?', '12.011 g/mol']] },
      { title: 'Balancing equations', summary: 'Same atoms on both sides.', ex: [['Coefficient of O₂ in CH₄ + _O₂ → CO₂ + 2H₂O?', '2'], ['H₂ + O₂ → H₂O: coefficient of H₂O?', '2']], cards: [['Why balance an equation?', 'Mass is conserved']] },
      { title: 'Stoichiometry', summary: 'From grams of reactant to grams of product.', ex: [['Grams of H₂O from 2 mol H₂?', '36'], ['Mole ratio H₂ : O₂ in water synthesis?', '2:1']], cards: [['First step in a stoichiometry problem?', 'Convert grams to moles']] },
      { title: 'Gas laws', summary: 'Pressure, volume and temperature.', ex: [['R in L·atm/(mol·K)?', '0.0821'], ['Volume of 1 mol at STP in L?', '22.4']], cards: [['Ideal gas law?', 'PV = nRT']] }
    ]
  },
  anat: {
    id: 'anatomy-heart', title: 'Human Anatomy', subject: 'Anatomy', code: 'BIO 214', icon: 'medicine', hue: 0.02,
    examTitle: 'Practical exam', examIn: 12,
    skills: [
      { title: 'Chambers and valves', summary: 'Four chambers, four valves.', ex: [['How many chambers does the heart have?', '4'], ['Valve between left atrium and ventricle?', 'mitral']], cards: [['Which side pumps to the body?', 'The left side']] },
      { title: 'The cardiac cycle', summary: 'Systole and diastole.', ex: [['Contraction phase?', 'systole'], ['Relaxation phase?', 'diastole']], cards: [['What makes the "lub" sound?', 'AV valves closing']] },
      { title: 'Blood flow', summary: 'From the body to the lungs and back.', ex: [['Vessel leaving the left ventricle?', 'aorta']], cards: [['Where does the pulmonary vein go?', 'Left atrium']] }
    ]
  },
  aws: {
    id: 'aws-cloud-practitioner', title: 'AWS Cloud Practitioner', subject: 'Certification', icon: 'programming', hue: 0.09,
    examTitle: 'CLF-C02 exam', examIn: 21,
    skills: [
      { title: 'Cloud concepts', summary: 'Elasticity, scalability and the shared responsibility model.', ex: [['Who patches the guest OS on EC2?', 'customer'], ['Pay-as-you-go is which benefit?', 'agility']], cards: [['Region vs. Availability Zone?', 'A Region has several AZs']] },
      { title: 'Security and compliance', summary: 'IAM, MFA and least privilege.', ex: [['Service to manage users and permissions?', 'IAM']], cards: [['Root account best practice?', 'Enable MFA, don\'t use it daily']] },
      { title: 'Billing and pricing', summary: 'Free tier, budgets and pricing models.', ex: [['Cheapest model for steady workloads?', 'reserved']], cards: [['Tool to forecast costs?', 'AWS Cost Explorer']] }
    ]
  },
  span: {
    id: 'spanish-b1', title: 'Spanish · B1', subject: 'Languages', code: 'SPAN 201', icon: 'spanish', hue: 0.12,
    examTitle: 'Oral exam', examIn: 16,
    skills: [
      { title: 'Preterite vs. imperfect', summary: 'Finished actions and backgrounds.', ex: [['Yo ___ (ir) al cine ayer.', 'fui'], ['Cuando era niño, ___ (vivir) en Lima.', 'vivía']], cards: [['"I used to read"', 'Leía']] },
      { title: 'The subjunctive', summary: 'Wishes, doubts and emotions.', ex: [['Quiero que tú ___ (venir).', 'vengas']], cards: [['Ojalá + ?', 'Subjunctive']] },
      { title: 'Ser and estar', summary: 'Two verbs for "to be".', ex: [['La sopa ___ fría.', 'está']], cards: [['Location of an event?', 'Ser']] }
    ]
  },
  ai: {
    id: 'ai-from-zero', title: 'AI, from zero', subject: 'Computer science', icon: 'robotics', hue: 0.5, selfPaced: true,
    skills: [
      { title: 'What a model learns', summary: 'Data in, patterns out.', ex: [['Data used to fit a model?', 'training set'], ['Data used to check it?', 'test set']], cards: [['Overfitting?', 'Memorizing instead of generalizing']] },
      { title: 'Neural networks', summary: 'Layers of weighted sums.', ex: [['Function that adds non-linearity?', 'activation']], cards: [['What does gradient descent do?', 'Lowers the loss step by step']] },
      { title: 'Language models', summary: 'Predicting the next token.', ex: [['A piece of text a model reads?', 'token']], cards: [['What is a prompt?', 'The input you give the model']] }
    ]
  }
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
const ISO0 = '2026-09-01T12:00:00.000Z'

function writeCourse(home: string, c: CourseSpec): void {
  const dir = join(home, 'Packs', c.id)
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const skillIds = c.skills.map((s) => slug(s.title))
  const units = [{ id: 'u1', title: c.subject, summary: '', skillIDs: skillIds }]
  const skills = c.skills.map((s, i) => ({
    id: skillIds[i], unit: 'u1', title: s.title, summary: s.summary, objectives: [s.summary], prerequisites: [], weight: 10,
    minutes: 20, order: i, status: 'ready', counts: { lessonBlocks: 1, exercises: s.ex.length, templates: 0, cards: s.cards.length, decks: 0 }
  }))
  const pack: Record<string, unknown> = {
    schema: 1, id: c.id, title: c.title, subject: c.subject, ...(c.code ? { courseCode: c.code } : {}), language: 'en', icon: c.icon, hue: c.hue,
    created: ISO0, updated: ISO0, units, skills, glossary: [], formulaSheet: [], sources: [], generation: [],
    ...(c.selfPaced ? { selfPaced: true } : {}),
    ...(c.examTitle ? { exam: { title: c.examTitle, date: at(c.examIn ?? 14, 9).toISOString(), durationMinutes: 90, totalPoints: 100 } } : {})
  }
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 1))
  writeFileSync(join(dir, 'progress.json'), JSON.stringify({ schema: 1, settings: { lessonMode: 'explore' } }, null, 1))
  c.skills.forEach((s, i) => {
    const id = skillIds[i]
    const skill = {
      id, title: s.title, summary: s.summary, objectives: [s.summary], prerequisites: [],
      lesson: [{ id: `${id}-b1`, type: 'text', md: `# ${s.title}\n\n${s.summary}` }],
      exercises: s.ex.map(([q, a], k) => ({
        id: `${id}-e${k + 1}`, skill: id, level: 1 + (k % 3), prompt: [{ id: `${id}-e${k + 1}-q`, type: 'text', md: q }],
        answer: { kind: 'short', accepted: [a] }, hints: [], solution: [{ id: `${id}-e${k + 1}-s`, type: 'text', md: a }], wrongs: [], points: 1, tags: []
      })),
      templates: [],
      cards: s.cards.map(([f, b], k) => ({ id: `${id}-c${k + 1}`, skill: id, kind: 'basic', front: f, back: b, tags: [] })),
      decks: [], mistakes: [], sources: [], status: 'ready', issues: [], revision: 1, updated: ISO0
    }
    writeFileSync(join(dir, 'skills', `${id}.json`), JSON.stringify(skill, null, 1))
  })
}

/** El curso real de trigonometría, con la fecha del examen fijada (la misma que el evento del mundo de la mañana) y con la
 *  MISMA forma que el curso que se crea en pantalla por la mañana (4 temas con esos títulos, 36 ejercicios, 24 tarjetas):
 *  así el paso del curso recién creado al curso estudiado no se contradice (solo cambia el progreso). */
const CREATED: [string, string, number][] = [
  ['reference-angles', 'Reference angles', 10],
  ['exact-trig-values', 'Exact values', 7],
  ['unit-circle-coordinates', 'The unit circle', 10],
  ['sine-cosine-graphs', 'Graphs of sine and cosine', 9]
]
function writeTrig(home: string): void {
  const dir = join(home, 'Packs', 'exam-2-math112')
  cpSync(TRIG, dir, { recursive: true })
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
  pack.title = 'Exam #2 — Trigonometry'
  // barra lateral igual que en el mundo de la mañana: justo detrás de «AI, from zero» (que la siembra toca al arrancar)
  pack.updated = new Date(Date.now() - 60_000).toISOString()
  pack.exam = { ...pack.exam, date: examDate().toISOString(), location: 'Building C · room 104' }
  const keep = new Set(CREATED.map(([id]) => id))
  pack.skills = pack.skills.filter((sk: { id: string }) => keep.has(sk.id)).map((sk: { id: string; title: string }, i: number) => {
    const [, title, ex] = CREATED.find(([id]) => id === sk.id)!
    return { ...sk, title, order: i, counts: { ...(sk as { counts?: object }).counts, exercises: ex, cards: 6, templates: 0 } }
  })
  pack.units = [{ id: 'u1', title: 'Trigonometry', summary: 'Angles, exact values, the unit circle and graphs', skillIDs: CREATED.map(([id]) => id) }]
  if (pack.blueprint) pack.blueprint.sections = [{ title: 'Exam #2', skillIDs: CREATED.map(([id]) => id), count: 12, minLevel: 1, maxLevel: 3, pointsEach: 8 }]
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 1))
  for (const f of ['degree-radian-conversion', 'arc-length-sector-area', 'inverse-trig-calculator', 'amplitude-period-phase']) rmSync(join(dir, 'skills', `${f}.json`), { force: true })
  for (const [id, title, n] of CREATED) {
    const f = join(dir, 'skills', `${id}.json`)
    const sk = JSON.parse(readFileSync(f, 'utf8'))
    sk.title = title
    // la práctica de «Exact values» solo con ejercicios numéricos con error típico (el guion los contesta: aula-film-js.ts)
    if (id === 'exact-trig-values') sk.exercises = sk.exercises.filter((e: { answer: { kind: string }; wrongs?: unknown[] }) => e.answer.kind === 'numeric' && (e.wrongs?.length ?? 0) > 0)
    sk.exercises = sk.exercises.slice(0, n)
    sk.cards = sk.cards.slice(0, 6)
    sk.templates = []
    writeFileSync(f, JSON.stringify(sk, null, 1))
  }
}

// ——— calendario (si calendar.json tiene eventos, la siembra no añade los suyos) ———
let seq = 0
function ev(e: Record<string, unknown>): Record<string, unknown> {
  seq++
  return { allDay: false, created: ISO0, createdBy: 'student', id: `own:video${String(seq).padStart(4, '0')}`, origin: 'own', updated: ISO0, ...e }
}
function lectureStart(): Date {
  // la clase: martes y jueves a las 10:00 desde hace cinco semanas
  const d = at(-35, 10)
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1)
  return d
}
function calendar(trigPack: boolean): Record<string, unknown> {
  seq = 0
  const L = lectureStart()
  const link = trigPack ? { packID: 'exam-2-math112' } : {}
  const events = [
    ev({ title: 'Trigonometry lecture', kind: 'lecture', start: L.toISOString(), end: new Date(L.getTime() + 80 * 60000).toISOString(), location: 'Room 214', course: 'MATH 101', recurrence: `FREQ=WEEKLY;UNTIL=${at(EXAM_IN_DAYS + 20).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')};BYDAY=TU,TH`, ...link }),
    ev({ title: 'Problem set 4', kind: 'assignment', start: at(2, 23, 59).toISOString(), task: { done: false, doneOccurrences: {} }, course: 'MATH 101', ...link }),
    ev({ title: 'Study group', kind: 'event', start: at(4, 17).toISOString(), end: at(4, 18, 30).toISOString(), location: 'Library, 2nd floor' }),
    ev({ title: 'Office hours', kind: 'event', start: at(-3, 12).toISOString(), end: at(-3, 13).toISOString(), location: 'Building C · 305' })
  ]
  // por la mañana el examen aún no tiene curso: es un evento suelto que Aula ofrece preparar
  if (!trigPack) events.push(ev({ title: 'Exam #2 — Trigonometry', kind: 'exam', start: examDate().toISOString(), end: new Date(examDate().getTime() + 75 * 60000).toISOString(), location: 'Building C · room 104', course: 'MATH 101', notes: 'Covers chapters 3 and 4. Graphing calculator permitted.' }))
  return { schema: 1, events, completed: {}, links: {} }
}

function settings(): Record<string, unknown> {
  return { version: 2, onboarded: true, general: { language: 'en', name: 'Maya', theme: 'light' } }
}

export type WorldName = 'morning' | 'course' | 'visuals' | 'dawn'

/** Escribe la plantilla del mundo y devuelve su carpeta. */
export function buildWorld(name: WorldName, workDir = join(HERE, '..', 'work', 'worlds')): string {
  const home = join(workDir, `v${WORLD_VERSION}-${filmDay().toISOString().slice(0, 10)}`, name)
  // solo componer (tomas ya capturadas, p. ej. comprobaciones sobre clones): no se toca la plantilla, que puede estar
  // usándola la captura de otro proceso
  if (process.env.AULA_VIDEO_NO_WORLDS === '1') return home
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, 'Packs'), { recursive: true })
  writeFileSync(join(home, 'settings.json'), JSON.stringify(settings()))
  const add = (k: keyof typeof COURSES) => writeCourse(home, COURSES[k])
  switch (name) {
    case 'morning': // los mismos cursos que el mundo del curso, menos trigonometría (se crea en la toma)
      add('chem'), add('span'), writeVisuals(home), add('anat'), add('aws'), add('ai')
      writeFileSync(join(home, 'calendar.json'), JSON.stringify(calendar(false)))
      break
    case 'course': // el curso real, química y español, y el curso de visuales (para no cambiar de toma en la película)
      writeTrig(home), add('chem'), add('span'), writeVisuals(home), add('anat'), add('aws'), add('ai')
      writeFileSync(join(home, 'calendar.json'), JSON.stringify(calendar(true)))
      break
    case 'visuals':
      writeTrig(home), writeVisuals(home)
      writeFileSync(join(home, 'calendar.json'), JSON.stringify(calendar(true)))
      break
    case 'dawn': // el desfile: seis cursos de asignaturas muy distintas
      add('chem'), add('anat'), add('aws'), add('span'), add('ai'), writeTrig(home)
      writeFileSync(join(home, 'calendar.json'), JSON.stringify(calendar(true)))
      break
  }
  return home
}

// ——— visuales en inglés (traducidos de blocks/visual/preview/samples.ts) ———
function writeVisuals(home: string): void {
  const c: CourseSpec = { id: 'biology-physics-visuals', title: 'Biology & Physics', subject: 'Science', icon: 'biology', hue: 0.33, examTitle: 'Final exam', examIn: 30, skills: [{ title: 'Cells, molecules and motion', summary: 'See it, touch it, move it.', ex: [['Organelle that makes ATP?', 'mitochondrion']], cards: [['Bond angle of water?', '104.5°']] }] }
  writeCourse(home, c)
  const id = slug(c.skills[0].title)
  const file = join(home, 'Packs', c.id, 'skills', `${id}.json`)
  const skill = JSON.parse(readFileSync(file, 'utf8'))
  skill.lesson = VISUAL_BLOCKS
  writeFileSync(file, JSON.stringify(skill, null, 1))
}

const VISUAL_BLOCKS: unknown[] = [
  {
    id: 'l-cell', type: 'labeled', title: 'The animal cell', alt: 'Diagram of an animal cell', labels: 'auto', practice: true,
    drawing: {
      width: 600, height: 400,
      items: [
        { kind: 'ellipse', cx: 300, cy: 200, rx: 272, ry: 176, stroke: 'brown', fill: 'amber', opacity: 0.08, width: 2.5 },
        { kind: 'curve', points: [[190, 250], [215, 330], [290, 310]], stroke: 'teal', width: 1.6 },
        { kind: 'curve', points: [[180, 236], [200, 345], [300, 330]], stroke: 'teal', width: 1.6 },
        { kind: 'circle', cx: 300, cy: 190, r: 72, stroke: 'plum', fill: 'plum', opacity: 0.14, width: 2 },
        { kind: 'circle', cx: 318, cy: 178, r: 20, stroke: 'plum', fill: 'plum', opacity: 0.45, width: 1 },
        { kind: 'ellipse', cx: 140, cy: 160, rx: 46, ry: 20, stroke: 'terracotta', fill: 'terracotta', opacity: 0.18, width: 1.8 },
        { kind: 'polyline', points: [[104, 160], [116, 150], [128, 168], [140, 150], [152, 168], [164, 150], [176, 160]], stroke: 'terracotta', width: 1.2 },
        { kind: 'ellipse', cx: 470, cy: 285, rx: 38, ry: 17, stroke: 'terracotta', fill: 'terracotta', opacity: 0.18, width: 1.8 },
        { kind: 'arc', cx: 470, cy: 170, r: 34, start: 200, end: 320, stroke: 'blue', width: 3 },
        { kind: 'arc', cx: 470, cy: 170, r: 44, start: 205, end: 315, stroke: 'blue', width: 3 },
        { kind: 'arc', cx: 470, cy: 170, r: 54, start: 210, end: 310, stroke: 'blue', width: 3 },
        { kind: 'circle', cx: 180, cy: 292, r: 16, stroke: 'green', fill: 'green', opacity: 0.22, width: 1.6 },
        { kind: 'dot', cx: 400, cy: 330, r: 3, fill: 'gray' }, { kind: 'dot', cx: 420, cy: 120, r: 3, fill: 'gray' }, { kind: 'dot', cx: 230, cy: 110, r: 3, fill: 'gray' }
      ]
    },
    parts: [
      { id: 'mem', name: 'Cell membrane', x: 0.06, y: 0.62, detail: 'A lipid bilayer that controls what goes in and out.' },
      { id: 'nuc', name: 'Nucleus', x: 0.43, y: 0.38, r: 0.12, detail: 'Holds the **DNA** and runs the cell.' },
      { id: 'nuo', name: 'Nucleolus', x: 0.53, y: 0.445, r: 0.034, detail: 'Makes ribosomes.' },
      { id: 'mit', name: 'Mitochondrion', aliases: ['mitochondria'], x: 0.233, y: 0.4, rect: [0.155, 0.34, 0.156, 0.12], detail: 'Cellular respiration: $\\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}$ + ATP.' },
      { id: 'gol', name: 'Golgi apparatus', x: 0.75, y: 0.36, polygon: [[0.68, 0.33], [0.79, 0.24], [0.87, 0.33], [0.8, 0.43], [0.7, 0.42]], detail: 'Packs and ships proteins.' },
      { id: 'lis', name: 'Lysosome', x: 0.3, y: 0.73, r: 0.03, detail: 'Digests what the cell no longer needs.' },
      { id: 'ret', name: 'Endoplasmic reticulum', x: 0.4, y: 0.79, polygon: [[0.3, 0.6], [0.36, 0.85], [0.5, 0.84], [0.48, 0.76], [0.36, 0.74]], detail: 'Membranes where proteins and lipids are made.' },
      { id: 'cit', name: 'Cytoplasm', x: 0.66, y: 0.66, detail: 'The watery medium the organelles float in.' }
    ],
    caption: 'Hover over each part, then try Find it and Drag.'
  },
  { id: 'x-water', type: 'molecule', title: 'Water molecule', formula: 'H2O', lonePairs: true, caption: 'The two lone pairs on oxygen squeeze the angle down to 104.5°.' },
  { id: 's-proj', type: 'simulation', preset: 'projectile', title: 'Projectile motion' }
]
