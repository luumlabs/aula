// Ejercicios repetidos entre habilidades del mismo curso (mismo enunciado y misma respuesta): cada autor escribe su habilidad a
// la vez que los demás y a veces dos preguntan lo mismo («¿Cuál es la capital de Paraguay?» en «Cono Sur» y en «Repaso global»).
// La revisión final de la tubería quita la copia que no usa ninguna lección. Puro.
import { encodeBlock, type Block, type Exercise, type Skill } from '@shared/schema'
import { describeAnswer } from '@engine/grading/describe'

/** Un ejercicio de una habilidad (y si lo usa un «Pruébalo» de su lección: entonces no se quita sin más). */
export interface ExerciseRef { skill: string; exercise: string; inLesson: boolean }

/** Un ejercicio que repite otro de una habilidad anterior del curso. */
export interface ExerciseDuplicate extends ExerciseRef {
  /** El primero, en el orden del curso. */
  of: ExerciseRef
}

/**
 * Cuál de los dos se quita: la copia posterior si ninguna lección la usa; si la usa su lección y el primero no, el primero
 * («Repaso global» enlaza la pregunta en su «Pruébalo» y la de «Cono Sur» solo estaba en el banco). undefined si las dos están
 * en lecciones.
 */
export function duplicateToDrop(d: ExerciseDuplicate): ExerciseRef | undefined {
  if (!d.inLesson) return { skill: d.skill, exercise: d.exercise, inLesson: false }
  return d.of.inLesson ? undefined : d.of
}

/** Texto comparable: sin acentos, mayúsculas, marcas de Markdown ni espacios de más. */
export function normalizedText(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[*_`#>~]+/g, '').replace(/\s+/g, ' ').replace(/[\s.:;,!?¿¡]+$/u, '').trim()
}

/** El enunciado comparable: el texto, y los bloques que no son texto (una figura, una tabla) tal cual, sin sus ids. */
function promptKey(blocks: readonly Block[]): { text: string; rest: string } {
  const text: string[] = []
  const rest: string[] = []
  for (const b of blocks) {
    if (b.type === 'text') { text.push(b.md); continue }
    const { id: _id, ...json } = encodeBlock(b) as Record<string, unknown>
    rest.push(JSON.stringify(json))
  }
  return { text: normalizedText(text.join(' ')), rest: rest.join('|') }
}

/** Huella de un ejercicio (enunciado + respuesta correcta); undefined si el enunciado es demasiado corto para compararlo. */
export function exerciseFingerprint(e: Exercise): string | undefined {
  const p = promptKey(e.prompt)
  const parts = e.answer.kind === 'multi' ? e.answer.parts.map((x) => `${promptKey(x.prompt).text}=${normalizedText(describeAnswer(x.answer))}`).join(';') : ''
  // «Calcula:» con una figura distinta no es el mismo ejercicio; un enunciado de pocas letras sin nada más, tampoco se compara
  if (Array.from(p.text).length < 12 && !p.rest && !parts) return undefined
  return [p.text, p.rest, parts, normalizedText(describeAnswer(e.answer))].join('\u0001')
}

/** Ejercicios de una habilidad que repiten (enunciado y respuesta) los de una habilidad anterior del curso. */
export function courseDuplicateExercises(skills: readonly Skill[]): ExerciseDuplicate[] {
  const first = new Map<string, ExerciseRef>()
  const out: ExerciseDuplicate[] = []
  for (const s of skills) {
    const linked = new Set(s.lesson.flatMap((b) => (b.type === 'tryit' ? b.exerciseIDs : [])))
    const here = new Map<string, ExerciseRef>()
    for (const e of s.exercises) {
      const k = exerciseFingerprint(e)
      if (k === undefined) continue
      const of = first.get(k)
      const ref = { skill: s.id, exercise: e.id, inLesson: linked.has(e.id) }
      if (of && of.skill !== s.id) out.push({ ...ref, of })
      else if (!here.has(k)) here.set(k, ref)
    }
    for (const [k, v] of here) if (!first.has(k)) first.set(k, v)
  }
  return out
}
