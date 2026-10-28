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
export function auditSkill(skill: Skill | undefined, depth: GenerationDepth, validatorIssues: readonly ContentIssue[], lang: Lang = 'es'): AuditProblem[] {
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
