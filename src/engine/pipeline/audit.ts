// Lo que la tubería comprueba y arregla por su cuenta, sin IA (port de partes de GenerationPipeline.swift): la auditoría de cada
// habilidad (errores del validador + mínimos de cobertura), el enlace de los «Pruébalo» con los ejercicios del equipo, el
// simulacro estándar cuando la IA no definió uno y el resumen del curso para el glosario y las ampliaciones. Puro.
import { IDs } from '@engine/base/ids'
import { CourseLanguages } from '@engine/base/language'
import type { Block, BlockOf, BlueprintSection, ContentIssue, ExamBlueprint, Pack, Skill } from '@shared/schema'
import { blockTypeName } from '@shared/schema'
import { DEPTHS, type GenerationDepth } from './model'

/** Un hallazgo de la auditoría: texto para la IA (inglés, con instrucciones) y para la persona (idioma de la interfaz). */
export interface AuditProblem { forAI: string; forUser: string }

export type Lang = 'es' | 'en'
const L = (lang: Lang, es: string, en: string): string => (lang === 'en' ? en : es)

/**
 * Auditoría independiente de la IA: errores del validador + mínimos de cobertura. Lista vacía = habilidad lista.
 * `validatorIssues` son los del validador ligado al curso (`checkSkill`).
 */
export function auditSkill(skill: Skill | undefined, depth: GenerationDepth, validatorIssues: readonly ContentIssue[], lang: Lang = 'es', options: { teaching?: boolean; realPictures?: boolean } = {}): AuditProblem[] {
  if (!skill) return [{ forAI: 'The skill has no content yet.', forUser: L(lang, 'Aún no tiene contenido.', 'It has no content yet.') }]
  const out: AuditProblem[] = []
  for (const i of validatorIssues) {
    if (i.severity !== 'error') continue
    out.push({ forAI: `${i.path}: ${i.message}`, // el mensaje del validador va en español (es para el modelo): al estudiante, una frase en su idioma
      forUser: L(lang, 'Hay contenido que Aula aún tiene que corregir.', 'Some content still needs fixing.') })
  }
  const d = DEPTHS[depth]
  if (skill.lesson.length < d.minLessonBlocks) {
    out.push({
      forAI: `lesson: only ${skill.lesson.length} blocks; write at least ${d.minLessonBlocks} (see the lesson rhythm in the guide).`,
      forUser: L(lang, `La lección es corta (${skill.lesson.length} bloques; se piden al menos ${d.minLessonBlocks}).`, `The lesson is short (${skill.lesson.length} blocks; at least ${d.minLessonBlocks} are required).`)
    })
  }
  const kinds = new Set(skill.lesson.map(blockTypeName))
  if (!kinds.has('example') && skill.lesson.length) {
    out.push({ forAI: 'lesson: it needs at least one worked `example` block.', forUser: L(lang, 'A la lección le falta un ejemplo resuelto.', 'The lesson needs a worked example.') })
  }
  if (skill.exercises.length + skill.templates.length < d.minExercises) {
    out.push({
      forAI: `exercises: ${skill.exercises.length} exercises + ${skill.templates.length} templates; write at least ${d.minExercises} exercises (levels 1–3).`,
      forUser: L(lang, `Faltan ejercicios: tiene ${skill.exercises.length} y se piden al menos ${d.minExercises}.`, `Exercises are missing: it has ${skill.exercises.length} and at least ${d.minExercises} are required.`)
    })
  }
  if (skill.cards.length < d.minCards) {
    out.push({
      forAI: `cards: ${skill.cards.length} flashcards; write at least ${d.minCards}.`,
      forUser: L(lang, `Faltan tarjetas: tiene ${skill.cards.length} y se piden al menos ${d.minCards}.`, `Flashcards are missing: it has ${skill.cards.length} and at least ${d.minCards} are required.`)
    })
  }
  // solo al crear o ampliar un curso: un curso ya hecho no pasa a «pendiente de corregir» por reglas nuevas
  if (options.teaching) out.push(...teachingProblems(skill.lesson, d.minVisuals, lang), ...showItProblems(skill.lesson, { realPictures: options.realPictures === true }, lang))
  const known = new Set(skill.exercises.map((e) => e.id))
  for (const b of skill.lesson) {
    if (b.type !== 'tryit') continue
    for (const t of b.exerciseIDs) {
      if (known.has(t)) continue
      out.push({
        forAI: `lesson: a \`tryit\` block references exercise '${t}' which does not exist.`,
        forUser: L(lang, `Un bloque de práctica apunta a un ejercicio que no existe («${t}»).`, `A practice block points to an exercise that doesn't exist (“${t}”).`)
      })
    }
  }
  return out
}

/** Bloques que enseñan con una figura (no cuentan las tablas ni las fórmulas: son texto ordenado). */
export const VISUAL_BLOCK_TYPES: readonly string[] = ['plot', 'explore', 'chart', 'diagram', 'drawing', 'image', 'labeled', 'model3d', 'simulation', 'map', 'timeline', 'numberline']
/** Bloques que piden algo al estudiante o le enseñan a hacerlo paso a paso: antes tiene que venir la explicación. */
const PRACTICE_BLOCK_TYPES: readonly string[] = ['example', 'tryit', 'predict', 'spot']
/** Texto seguido que una lección aguanta sin nada que mirar o hacer. */
export const MAX_TEXT_RUN = 4
/** Explicación mínima (caracteres) antes del primer ejemplo o pregunta. */
export const MIN_EXPLANATION_CHARS = 280

const explanationOf = (b: Block): string => (b.type === 'text' || b.type === 'callout' ? b.md : b.type === 'math' ? b.tex : '') ?? ''

/**
 * Lo que hace que una lección enseñe y no sea solo texto: figuras, ningún muro de párrafos y la explicación ANTES de pedir
 * nada. Cada hallazgo le dice al modelo cómo arreglarlo (vuelve en el siguiente intento de la habilidad).
 */
export function teachingProblems(lesson: readonly Block[], minVisuals: number, lang: Lang = 'es'): AuditProblem[] {
  if (!lesson.length) return []
  const out: AuditProblem[] = []
  const types = lesson.map(blockTypeName)
  const visuals = types.filter((t) => VISUAL_BLOCK_TYPES.includes(t)).length
  if (visuals < minVisuals) {
    out.push({
      forAI: `lesson: only ${visuals} visual block${visuals === 1 ? '' : 's'}; it needs at least ${minVisuals}. A lesson that is only text does not teach. Add the figure that makes THIS idea visible, right where the text explains it: \`plot\`/\`explore\` (a relationship between quantities; \`explore\` lets the student move a parameter), \`model3d\` (a solid, a molecule, a surface z = f(x, y), vectors or a curve in space), \`diagram\` with \`steps\` (a process or a method), \`chart\` (data), \`numberline\`, \`drawing\` (a geometric figure), \`timeline\`, \`map\`, \`simulation\`, or — for anything that exists in the world — a real picture: \`find_image\` then \`add_image\`, placed as an \`image\` or \`labeled\` block. Say in the text or the caption what to look at. Tables and formulas do not count as visuals.`,
      forUser: L(lang, `A la lección le faltan figuras (tiene ${visuals}; se piden al menos ${minVisuals}).`, `The lesson needs more figures (it has ${visuals}; at least ${minVisuals} are required).`)
    })
  }
  let run = 0
  let longest = 0
  for (const t of types) {
    run = t === 'text' ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  if (longest > MAX_TEXT_RUN) {
    out.push({
      forAI: `lesson: ${longest} \`text\` blocks in a row. Never more than ${MAX_TEXT_RUN}: after a couple of paragraphs give the student something to look at or do (a visual block, a \`callout\`, an \`example\`, a \`predict\`). Turn a description into a figure and a list of cases into a \`table\` or \`compare\`.`,
      forUser: L(lang, `La lección tiene ${longest} párrafos seguidos sin nada que mirar o hacer.`, `The lesson has ${longest} paragraphs in a row with nothing to look at or do.`)
    })
  }
  const first = types.findIndex((t) => PRACTICE_BLOCK_TYPES.includes(t))
  if (first >= 0) {
    const before = lesson.slice(0, first)
    const explained = before.reduce((n, b) => n + explanationOf(b).replace(/^#+ .*$/gm, '').trim().length, 0)
    // un solo párrafo (aunque sea largo) y directo al ejemplo no es explicar: hace falta al menos otro bloque (la figura,
    // la definición, la fórmula) entre el arranque y la primera práctica
    if (explained < MIN_EXPLANATION_CHARS || before.length < 2) {
      out.push({
        forAI: `lesson: the first \`${types[first]}\` (block ${first + 1}) comes before the idea has been explained. Teach first: say in plain words what the idea is and why it works, show it (a concrete case or a figure), define every term and symbol, and only then give the worked \`example\` and the questions. Move or add that explanation before block ${first + 1}.`,
        forUser: L(lang, 'La lección pregunta o pone un ejemplo antes de explicar la idea.', 'The lesson asks a question or shows an example before explaining the idea.')
      })
    }
  }
  const example = types.indexOf('example')
  const tryit = types.indexOf('tryit')
  if (tryit >= 0 && (example < 0 || tryit < example)) {
    out.push({
      forAI: 'lesson: a `tryit` comes before any worked `example`. Show the method fully worked (every step with its reason) before asking the student to do it alone.',
      forUser: L(lang, 'La lección pide practicar antes de mostrar un ejemplo resuelto.', 'The lesson asks for practice before showing a worked example.')
    })
  }
  for (const [i, b] of lesson.entries()) {
    if (b.type !== 'example' || b.steps.length >= 2) continue
    out.push({
      forAI: `lesson: the \`example\` at block ${i + 1} has ${b.steps.length} step${b.steps.length === 1 ? '' : 's'}. A worked example shows the reasoning: break it into small steps and give each one a \`note\` with the rule or reason used.`,
      forUser: L(lang, 'Un ejemplo resuelto no muestra sus pasos.', 'A worked example does not show its steps.')
    })
  }
  return out
}

const isTryIt = (b: Block): b is BlockOf<'tryit'> => b.type === 'tryit'

/**
 * Equipo: la lección se escribe a la vez que los ejercicios, así que aquí se enlazan los «Pruébalo» con ejercicios reales (después
 * del primer ejemplo y antes del resumen) y se quitan referencias a ejercicios que no existen. Devuelve la habilidad cambiada (o
 * la misma si no hacía falta nada).
 */
export function linkPractice(skill: Skill, language: string): Skill {
  const lang = CourseLanguages.find(language) ?? CourseLanguages.all[0]
  const known = new Set(skill.exercises.map((e) => e.id))
  let lesson: Block[] = skill.lesson.map((b) => (isTryIt(b) && b.exerciseIDs.some((id) => !known.has(id)) ? { ...b, exerciseIDs: b.exerciseIDs.filter((id) => known.has(id)) } : b))
  lesson = lesson.filter((b) => !(isTryIt(b) && b.exerciseIDs.length === 0 && b.inline.length === 0))
  const hasTry = lesson.some(isTryIt)
  if (hasTry || !lesson.length || !skill.exercises.length) return { ...skill, lesson }
  // Dos aciertos independientes también tras un error: la fallada no vuelve y después hacen falta dos nuevas (más una de
  // margen), así que al menos cuatro.
  const bank = skill.exercises.filter((e) => e.review === undefined || e.review.state !== 'flagged')
  const warm = [...bank.filter((e) => e.level <= 1), ...bank.filter((e) => e.level > 1)]
  const first = warm.slice(0, 4).map((e) => e.id)
  if (!first.length) return { ...skill, lesson }
  const harder = bank.filter((e) => e.level >= 2 && !first.includes(e.id)).slice(0, 3).map((e) => e.id)
  const exampleAt = lesson.findIndex((b) => b.type === 'example')
  const afterExample = exampleAt >= 0 ? exampleAt + 1 : Math.max(1, Math.floor(lesson.length / 2))
  const tryIt = (title: string, ids: string[]): Block => ({ id: `${skill.id}-try-${IDs.short(4)}`, type: 'tryit', title, exerciseIDs: ids, inline: [] })
  lesson.splice(Math.min(afterExample, lesson.length), 0, tryIt(lang.tryIt, first))
  if (harder.length) {
    let recap = -1
    for (let i = lesson.length - 1; i >= 0; i--) if (lesson[i].type === 'recap') { recap = i; break }
    if (recap < 0) recap = lesson.length
    if (recap > afterExample + 1) lesson.splice(recap, 0, tryIt(lang.checkYourself, harder))
  }
  return { ...skill, lesson }
}

/** Simulacro estándar cuando la IA no definió uno: una sección por unidad según el peso de sus habilidades. */
export function fallbackBlueprint(pack: Pack): ExamBlueprint {
  const total = Math.max(1, pack.skills.reduce((n, s) => n + s.weight, 0))
  let sections: BlueprintSection[] = []
  for (const u of pack.units) {
    const skills = pack.skills.filter((s) => u.skillIDs.includes(s.id))
    if (!skills.length) continue
    const w = skills.reduce((n, s) => n + s.weight, 0)
    sections.push({ title: u.title, skillIDs: skills.map((s) => s.id), count: Math.max(1, Math.round((w / total) * 12)), minLevel: 1, maxLevel: 3, pointsEach: 5 })
  }
  if (!sections.length) {
    const lang = CourseLanguages.of(pack.language)
    sections = [{ title: CourseLanguages.problemsTitle(lang), skillIDs: pack.skills.map((s) => s.id), count: Math.min(10, Math.max(3, pack.skills.length)), minLevel: 1, maxLevel: 3, pointsEach: 5 }]
  }
  return { durationMinutes: pack.exam?.durationMinutes ?? 75, totalPoints: sections.reduce((n, s) => n + s.count * s.pointsEach, 0), sections }
}

/** ¿Alguna lección tiene fórmulas (bloques de matemáticas o de fórmulas)? */
export function lessonsHaveFormulas(skills: readonly Skill[]): boolean {
  return skills.some((s) => s.lesson.some((b) => b.type === 'math' || b.type === 'formulas'))
}

/** Lo que falta del contenido transversal (en inglés, para la IA). */
export function missingCrossCutting(pack: Pack, skills: readonly Skill[]): string[] {
  const m: string[] = []
  if (!pack.glossary.length) m.push('the glossary (set_glossary)')
  // la hoja de fórmulas solo se exige si las lecciones tienen fórmulas
  if (!pack.formulaSheet.length && lessonsHaveFormulas(skills)) m.push('the formula sheet (set_formula_sheet)')
  if (!pack.blueprint) m.push('the exam blueprint (set_exam_blueprint)')
  return m
}

const clip = (s: string, n: number): string => (Array.from(s).length <= n ? s : Array.from(s).slice(0, n).join('') + '…')

/** Resumen del curso (definiciones y fórmulas de cada lección) para el glosario, las fórmulas y las ampliaciones. */
export function courseDigest(pack: Pack, skillOf: (id: string) => Skill | undefined, maxChars = 14_000): string {
  let out = ''
  for (const ref of pack.skills) {
    const s = skillOf(ref.id)
    if (!s) { out += `- \`${ref.id}\` ${ref.title}: (no content)\n`; continue }
    out += `### \`${ref.id}\` — ${ref.title}  [exercises ${s.exercises.length}, templates ${s.templates.length}, cards ${s.cards.length}]\n`
    const defs: string[] = []
    const formulas: string[] = []
    for (const b of s.lesson) {
      if (b.type === 'callout' && (b.kind === 'definition' || b.kind === 'theorem' || b.kind === 'remember')) defs.push(clip(b.md.replace(/\n/g, ' '), 170))
      else if (b.type === 'math') formulas.push((b.label !== undefined ? `${b.label}: ` : '') + b.tex)
      else if (b.type === 'formulas') for (const it of b.items.slice(0, 6)) formulas.push(`${it.name}: ${it.tex}`)
    }
    for (const x of defs.slice(0, 6)) out += `  - def: ${x}\n`
    for (const f of formulas.slice(0, 8)) out += `  - formula: ${f}\n`
    if (out.length > maxChars) { out += '… (digest truncated)\n'; break }
  }
  return out
}

/** Señales de que la lección trabaja con una función de dos variables: `f(x, y)` y `z = …x…y…`. */
const SURFACE_MATH = [/f\s*\(\s*x\s*,\s*y\s*\)/g, /\bz\s*=\s*[^$\n]{0,40}?x[^$\n]{0,40}?y/g]
/** Puntos o vectores con tres coordenadas: solo cuentan si además hay una función de dos variables (una terna suelta puede ser cualquier cosa). */
const TRIPLE = /\(\s*-?[\w.]+\s*,\s*-?[\w.]+\s*,\s*-?[\w.]+\s*\)/g

/** Todo lo que la lección dice con palabras o fórmulas (para buscar de qué habla). */
function lessonText(lesson: readonly Block[]): string {
  const parts: string[] = []
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === 'string') { if (v.length > 2) parts.push(v) } else if (depth < 5 && v && typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1)
  }
  for (const b of lesson) if (b.type !== 'model3d' && b.type !== 'image') walk(b, 0)
  return parts.join('\n')
}

/**
 * Lo que la lección tiene que ENSEÑAR A LA VISTA según de qué hable: una gráfica en 3D cuando trabaja con funciones de dos
 * variables (el modelo siempre puede dibujarla), y una foto real cuando el curso trata de cosas que existen y hay acceso
 * a la web. Son fallos como los demás: vuelven al modelo en cada repaso y, si no se arreglan, la lección queda «por revisar»
 * con su motivo a la vista.
 */
export function showItProblems(lesson: readonly Block[], options: { realPictures: boolean }, lang: Lang = 'es'): AuditProblem[] {
  if (!lesson.length) return []
  const out: AuditProblem[] = []
  const types = lesson.map(blockTypeName)
  if (!types.includes('model3d')) {
    const text = lessonText(lesson)
    const surface = SURFACE_MATH.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0)
    const hits = surface + (surface ? text.match(TRIPLE)?.length ?? 0 : 0)
    if (surface >= 2 && hits >= 3) {
      out.push({
        forAI: 'lesson: it works with a function of two variables or with points and vectors in space, but shows nothing in 3D. The student has to SEE the surface, not imagine it: add a `model3d` block with `graph` (for example `{"type":"model3d","title":"…","alt":"…","graph":{"surfaces":[{"expr":"x^2 - y^2"}],"xMin":-2,"xMax":2,"yMin":-2,"yMax":2,"points":[{"x":0,"y":0,"z":0,"label":"…"}],"vectors":[…]}}`) for the surface, point, tangent plane, gradient or vectors this lesson is about, right where the text explains it, and tell the student what to look for when turning it. Keep the 2D figures (level curves, sections) next to it.',
        forUser: L(lang, 'La lección habla de superficies o del espacio y no enseña ninguna gráfica en 3D.', 'The lesson is about surfaces or space and shows no 3D graph.')
      })
    }
  }
  if (options.realPictures) {
    const real = lesson.some((b) => (b.type === 'image' && !!b.asset) || (b.type === 'labeled' && !!b.asset))
    if (!real) {
      out.push({
        forAI: 'lesson: this course is about real things and the web tools are available, but the lesson shows no real picture (only drawings or diagrams). Show the real thing next to the diagram that explains it: call `find_image` with the specific thing this lesson is about (in English it finds more: "mitochondrion electron micrograph", "onion cells microscope", "Colosseum Rome", "Rosetta Stone"), pick a result that clearly shows it, call `add_image`, and place the returned block (`image`, or `labeled` with that `asset` and the parts marked) right after the paragraph that describes it, with a caption that says what to look at. Try at least three different searches (the organism or object by its scientific or English name, a more general one, a related structure) before giving up: almost every real thing has a picture on Wikimedia Commons.',
        forUser: L(lang, 'La lección no enseña ninguna imagen real de lo que explica.', 'The lesson shows no real picture of what it explains.')
      })
    }
  }
  return out
}
