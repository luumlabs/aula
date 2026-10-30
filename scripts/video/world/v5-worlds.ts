// Mundo de la película V5 (montage/aula-v5-*.ts): el mundo «course» de worlds.ts y, además, los bloques visuales en inglés
// que enseña el capítulo «See it» (un bloque por tema, para abrir cada uno por su ruta), en cursos de asignaturas
// distintas. Todo en inglés; ningún color violeta (sin «plum»). No toca las plantillas de la película anterior.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, WORLD_VERSION } from './worlds.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Sube este número si cambian los bloques: la ruta entra en la huella de las tomas. */
export const V5_WORLD_VERSION = 2
const ISO0 = '2026-09-01T12:00:00.000Z'

interface Lesson {
  id: string
  title: string
  summary: string
  blocks: unknown[]
}

/** Añade temas (uno por bloque) a un curso que ya existe en el mundo. */
function addSkills(home: string, packId: string, lessons: Lesson[]): void {
  const dir = join(home, 'Packs', packId)
  const file = join(dir, 'pack.json')
  const pack = JSON.parse(readFileSync(file, 'utf8'))
  const base = pack.skills.length
  for (const [i, l] of lessons.entries()) {
    pack.skills.push({
      id: l.id, unit: pack.units[0].id, title: l.title, summary: l.summary, objectives: [l.summary], prerequisites: [], weight: 10,
      minutes: 15, order: base + i, status: 'ready', counts: { lessonBlocks: l.blocks.length, exercises: 0, templates: 0, cards: 0, decks: 0 }
    })
    pack.units[0].skillIDs.push(l.id)
    writeSkill(dir, l)
  }
  writeFileSync(file, JSON.stringify(pack, null, 1))
}

/** Un curso nuevo con sus temas visuales (sin ejercicios: solo se abre su lección). */
function addCourse(home: string, c: { id: string; title: string; subject: string; code?: string; icon: string; hue: number; lessons: Lesson[] }): void {
  const dir = join(home, 'Packs', c.id)
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const pack = {
    schema: 1, id: c.id, title: c.title, subject: c.subject, ...(c.code ? { courseCode: c.code } : {}), language: 'en', icon: c.icon, hue: c.hue,
    created: ISO0, updated: ISO0, selfPaced: true, glossary: [], formulaSheet: [], sources: [], generation: [],
    units: [{ id: 'u1', title: c.subject, summary: '', skillIDs: c.lessons.map((l) => l.id) }],
    skills: c.lessons.map((l, i) => ({
      id: l.id, unit: 'u1', title: l.title, summary: l.summary, objectives: [l.summary], prerequisites: [], weight: 10, minutes: 15, order: i,
      status: 'ready', counts: { lessonBlocks: l.blocks.length, exercises: 0, templates: 0, cards: 0, decks: 0 }
    }))
  }
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 1))
  writeFileSync(join(dir, 'progress.json'), JSON.stringify({ schema: 1, settings: { lessonMode: 'explore' } }, null, 1))
  for (const l of c.lessons) writeSkill(dir, l)
}

function writeSkill(dir: string, l: Lesson): void {
  const skill = {
    id: l.id, title: l.title, summary: l.summary, objectives: [l.summary], prerequisites: [], lesson: l.blocks, exercises: [], templates: [],
    cards: [], decks: [], mistakes: [], sources: [], status: 'ready', issues: [], revision: 1, updated: ISO0
  }
  writeFileSync(join(dir, 'skills', `${l.id}.json`), JSON.stringify(skill, null, 1))
}

// ——— los bloques de «See it», en inglés ———
const KREBS = {
  id: 'v5-krebs', type: 'diagram', kind: 'cycle', title: 'The Krebs cycle (simplified)',
  nodes: [
    { id: 'cit', label: 'Citrate', detail: '6 C' }, { id: 'iso', label: 'Isocitrate', detail: '6 C' },
    { id: 'akg', label: '$\\alpha$-ketoglutarate', detail: '5 C' }, { id: 'suc', label: 'Succinyl-CoA', detail: '4 C' },
    { id: 'sca', label: 'Succinate', detail: '4 C' }, { id: 'fum', label: 'Fumarate', detail: '4 C' },
    { id: 'mal', label: 'Malate', detail: '4 C' }, { id: 'oaa', label: 'Oxaloacetate', detail: '4 C', color: 'teal' }
  ],
  steps: [
    { title: 'Acetyl-CoA comes in', md: 'Acetyl-CoA (2 C) joins **oxaloacetate** (4 C) to make **citrate** (6 C).', nodes: ['oaa', 'cit'] },
    { title: 'Isomerization', md: 'Citrate is rearranged into isocitrate.', nodes: ['iso'] },
    { title: 'First decarboxylation', md: 'One $\\ce{CO2}$ leaves and one $\\ce{NADH}$ forms.', nodes: ['akg'] },
    { title: 'Second decarboxylation', md: 'Another $\\ce{CO2}$ and another $\\ce{NADH}$.', nodes: ['suc'] },
    { title: 'Substrate-level phosphorylation', md: 'One GTP (or ATP) is made.', nodes: ['sca'] },
    { title: 'Oxidation', md: '$\\ce{FADH2}$ forms.', nodes: ['fum'] },
    { title: 'Hydration', md: 'Water is added.', nodes: ['mal'] },
    { title: 'Oxaloacetate is back', md: 'One last $\\ce{NADH}$: the cycle starts again.', nodes: ['oaa'] }
  ]
}
const NACL = { id: 'v5-nacl', type: 'model3d', title: 'Sodium chloride: a cubic ionic lattice', formula: 'NaCl', atomLabels: false, autoRotate: true, caption: 'Each ion is surrounded by six of the other kind.' }
const WATER = { id: 'v5-water', type: 'molecule', title: 'Water, H₂O: a bent molecule (104.5°)', formula: 'H2O', lonePairs: true, autoRotate: true, caption: 'The two lone pairs on oxygen squeeze the angle down to 104.5°.' }
const SLIDES = {
  id: 'v5-slides', type: 'slides', title: 'Projectile motion', summary: 'Unit 2 · Physics', theme: 'aula', transition: 'fade',
  slides: [
    { layout: 'title', title: 'Projectile motion', subtitle: 'Two motions at once' },
    { layout: 'content', title: 'The key idea', blocks: [{ type: 'text', md: '- Horizontally: **constant speed**.\n- Vertically: **constant acceleration**, $g$.\n- Together they draw a parabola:' }, { type: 'math', tex: 'y = x\\tan\\theta - \\frac{g\\,x^2}{2v_0^2\\cos^2\\theta}' }] },
    { layout: 'formula', title: 'How far does it go?', blocks: [{ type: 'math', tex: 'R = \\frac{v_0^2 \\sin 2\\theta}{g}' }] },
    { layout: 'section', title: 'Try it', subtitle: 'Which angle goes farthest?' }
  ]
}
const TIMELINE = {
  id: 'v5-timeline', type: 'timeline', title: 'From the Revolution to Waterloo', layout: 'horizontal',
  periods: [{ from: '1789', to: '1799', title: 'Revolution' }, { from: '1799', to: '1804', title: 'Consulate' }, { from: '1804', to: '1815', title: 'Empire' }],
  events: [
    { when: '1789-07-14', title: 'Storming of the Bastille', md: 'Paris takes the fortress: the Revolution begins.', category: 'Politics' },
    { when: '1793', title: 'Execution of Louis XVI', category: 'Politics' },
    { when: '1799', title: 'Coup of 18 Brumaire', md: 'Napoleon takes power.', category: 'Politics' },
    { when: '1804', title: 'Civil Code', category: 'Law' },
    { when: '1805', title: 'Austerlitz', category: 'War' },
    { when: '1812', end: '1813', title: 'Russian campaign', category: 'War' },
    { when: '1815', title: 'Waterloo', md: 'Napoleon’s final defeat.', category: 'War' }
  ]
}
const BEAGLE = {
  id: 'v5-beagle', type: 'map', title: 'The voyage of the Beagle (1831–1836)',
  markers: [
    { title: 'Plymouth', lat: 50.37, lon: -4.14, md: 'Sets sail on **27 December 1831**.' },
    { title: 'Cape Verde', lat: 14.93, lon: -23.51, md: 'Darwin’s first geology on volcanic rock.' },
    { title: 'Bahia', lat: -12.97, lon: -38.5, md: 'His first rainforest.' },
    { title: 'Galápagos', lat: -0.9, lon: -89.6, md: 'Finches and tortoises, island by island.' },
    { title: 'Sydney', lat: -33.87, lon: 151.21, md: 'January 1836.' },
    { title: 'Cape Town', lat: -33.92, lon: 18.42, md: 'Homeward, around Africa.' }
  ],
  routes: [{ label: 'The voyage', color: 'terracotta', points: [[50.37, -4.14], [14.93, -23.51], [-12.97, -38.5], [-34.6, -58.4], [-54.8, -68.3], [-33.0, -71.6], [-0.9, -89.6], [-17.5, -149.6], [-36.8, 174.8], [-33.87, 151.21], [-12.2, 96.8], [-20.2, 57.5], [-33.92, 18.42], [-15.9, -5.7], [-12.97, -38.5], [38.7, -27.2], [50.37, -4.14]] }]
}
const sim = (id: string, preset: string, title: string) => ({ id, type: 'simulation', preset, title })

/** La misma lección (la circunferencia unidad) en cuatro idiomas de curso, con la misma figura: «Speaks your language». */
const UNIT_CIRCLE_PLOT = {
  type: 'plot', xMin: -1.5, xMax: 1.5, yMin: -1.25, yMax: 1.25, equalAspect: true, grid: false, xTickStep: 0.5, yTickStep: 0.5,
  parametric: [{ x: 'cos(t)', y: 'sin(t)', tMin: 0, tMax: 6.2832, color: 'accent' }],
  lines: [{ kind: 'segment', x1: '0', y1: '0', x2: '0.866', y2: '0.5', color: 'gray' }],
  points: [{ x: '0.866', y: '0.5', label: '(cos θ, sin θ)' }]
}
const LANG_LESSONS: { lang: string; id: string; title: string; subject: string; icon: string; lesson: string; md: string }[] = [
  { lang: 'es', id: 'unit-circle-es', title: 'Trigonometría', subject: 'Matemáticas', icon: 'trigonometry', lesson: 'La circunferencia unidad', md: '# La circunferencia unidad\n\nCada punto de la circunferencia unidad tiene coordenadas $(\\cos\\theta, \\sin\\theta)$. Por eso $\\sin^2\\theta + \\cos^2\\theta = 1$.' },
  { lang: 'ja', id: 'unit-circle-ja', title: '三角関数', subject: '数学', icon: 'trigonometry', lesson: '単位円', md: '# 単位円\n\n単位円上の点の座標は $(\\cos\\theta, \\sin\\theta)$ です。だから $\\sin^2\\theta + \\cos^2\\theta = 1$ が成り立ちます。' },
  { lang: 'ru', id: 'unit-circle-ru', title: 'Тригонометрия', subject: 'Математика', icon: 'trigonometry', lesson: 'Единичная окружность', md: '# Единичная окружность\n\nКаждая точка единичной окружности имеет координаты $(\\cos\\theta, \\sin\\theta)$. Поэтому $\\sin^2\\theta + \\cos^2\\theta = 1$.' },
  { lang: 'ar', id: 'unit-circle-ar', title: 'حساب المثلثات', subject: 'الرياضيات', icon: 'trigonometry', lesson: 'دائرة الوحدة', md: '# دائرة الوحدة\n\nلكل نقطة على دائرة الوحدة الإحداثيات $(\\cos\\theta, \\sin\\theta)$، ولذلك $\\sin^2\\theta + \\cos^2\\theta = 1$.' }
]

/** Escribe el mundo de la V5 (el de la película + los bloques de «See it») y devuelve su carpeta. */
export function buildV5World(workDir = join(HERE, '..', 'work', 'worlds-v5')): string {
  const home = buildWorld('course', join(workDir, `v${V5_WORLD_VERSION}-w${WORLD_VERSION}`))
  if (process.env.AULA_VIDEO_NO_WORLDS === '1') return home // solo componer: no se escribe nada (ver buildWorld)
  // biología y física (ya tiene la célula, el agua y el tiro parabólico en un tema): un tema por bloque
  addSkills(home, 'biology-physics-visuals', [
    { id: 'salt-crystal', title: 'Ionic crystals', summary: 'Sodium chloride in 3D.', blocks: [NACL] },
    { id: 'water-molecule', title: 'Water', summary: 'A bent molecule.', blocks: [WATER] },
    { id: 'projectile', title: 'Projectile motion', summary: 'Launch angle and range.', blocks: [sim('v5-proj', 'projectile', 'Projectile motion')] },
    { id: 'krebs-cycle', title: 'The Krebs cycle', summary: 'Step by step.', blocks: [KREBS] },
    { id: 'projectile-slides', title: 'Projectile motion · slides', summary: 'The class deck.', blocks: [SLIDES] }
  ])
  addSkills(home, 'anatomy-heart', [
    { id: 'drug-dosing', title: 'Repeated drug doses', summary: 'Concentration over time.', blocks: [sim('v5-pk', 'pharmacokinetics', 'Repeated doses of a drug')] }
  ])
  addCourse(home, {
    id: 'economics-101', title: 'Economics 101', subject: 'Economics', code: 'ECON 101', icon: 'economics', hue: 0.11,
    lessons: [{ id: 'supply-demand', title: 'Supply and demand', summary: 'Where the curves meet.', blocks: [sim('v5-sd', 'supply-demand', 'Supply and demand')] }]
  })
  addCourse(home, {
    id: 'world-history', title: 'World History', subject: 'History', code: 'HIST 120', icon: 'history', hue: 0.08,
    lessons: [
      { id: 'revolution-to-waterloo', title: 'From the Revolution to Waterloo', summary: 'France, 1789–1815.', blocks: [TIMELINE] },
      { id: 'voyage-of-the-beagle', title: 'The voyage of the Beagle', summary: 'Darwin around the world.', blocks: [BEAGLE] }
    ]
  })
  for (const l of LANG_LESSONS) {
    addCourse(home, { id: l.id, title: l.title, subject: l.subject, icon: l.icon, hue: 0.6, lessons: [{ id: 'unit-circle', title: l.lesson, summary: l.lesson, blocks: [{ id: `${l.id}-t`, type: 'text', md: l.md }, { id: `${l.id}-p`, ...UNIT_CIRCLE_PLOT }] }] })
    const f = join(home, 'Packs', l.id, 'pack.json')
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), language: l.lang }, null, 1))
  }
  return home
}
