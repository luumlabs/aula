// Qué lección abre Aprender y, si no puede abrirla, qué dice en su lugar (puro). Mientras Aula escribe (la creación del curso o
// una ampliación de un solo tema) solo se abren los temas listos; con la creación en pausa se ofrece reanudarla (una ampliación
// la escondería); con Aula trabajando en el curso se espera; sin nada pendiente se puede pedir que escriba el tema ahora.
import type { Skill } from '@shared/schema'
import { isSkillMasteredGuided } from '@engine/study'
import { topicAvailability, type CreationPhase, type TopicRef } from '@engine/study/topics'
import type { CourseData } from '../data'

/** Las lecciones que se pueden abrir: con contenido y, mientras se escriben (la creación o una ampliación de un tema), solo
 * las listas. `writing`: el tema que escribe ahora una ampliación. */
export function openableLessons(data: CourseData, phase: CreationPhase = 'none', writing?: string): Skill[] {
  const refs = new Map(data.pack.skills.map((r) => [r.id, r]))
  return data.skills.filter((s) => {
    const ref = refs.get(s.id)
    return s.lesson.length > 0 && (!ref || (phase === 'none' && s.id !== writing) || topicAvailability(ref, phase, s.id === writing) === 'ready')
  })
}

/** El tema que se abre: el pedido o, en el modo guiado, la primera lección lista sin dominar (en el orden del curso). */
export function pickLesson(data: CourseData, requested?: string, phase: CreationPhase = 'none', writing?: string): Skill | undefined {
  if (requested) return data.skills.find((s) => s.id === requested)
  const lessons = openableLessons(data, phase, writing)
  return lessons.find((s) => !isSkillMasteredGuided(s, data.progress.skills[s.id])) ?? lessons[0]
}

/** Lo que enseña Aprender: la lección, «Aula lo está escribiendo», «creación en pausa» (Reanudar), «Aula está trabajando en
 * el curso», «Escribir este tema ahora» (todo, o solo la lección si ya tiene ejercicios) o «Pedírselo a Aula» (sin tema). */
export type LessonGate = 'open' | 'writing' | 'paused' | 'busy' | 'writeNow' | 'writeLesson' | 'ask'

export interface LessonGateInput {
  skill: Skill | undefined
  ref: TopicRef | undefined
  phase: CreationPhase
  /** El tema que escribe ahora una ampliación en marcha. */
  writing?: string
  /** ¿Aula trabaja ahora en el curso (cualquier ejecución)? */
  active: boolean
}

export function lessonGate({ skill, ref, phase, writing, active }: LessonGateInput): LessonGate {
  // el tema que escribe una ampliación no se abre a medias (en cuanto se escribe el primer bloque ya «tiene lección»)
  if (skill && ref && skill.id === writing) {
    if (topicAvailability(ref, phase, true) !== 'ready') return 'writing'
  } else if (phase === 'building' && (!skill || !ref || topicAvailability(ref, phase) !== 'ready')) return 'writing'
  if (skill && skill.lesson.length > 0) return 'open'
  // parada a medias: «Escribir este tema ahora» lanzaría una ampliación que escondería la creación (sin «Reanudar»)
  if (phase === 'stopped') return 'paused'
  // Aula ya trabaja en el curso (otra ampliación): una más daría «ocupado»
  if (active) return 'busy'
  if (!skill) return 'ask'
  // con sus ejercicios ya escritos solo falta la lección: pedirlo todo los duplicaría
  return skill.exercises.length + skill.templates.length > 0 ? 'writeLesson' : 'writeNow'
}
