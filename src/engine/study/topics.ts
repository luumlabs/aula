// Qué temas de un curso se pueden estudiar ya mientras Aula lo crea (puro). Un tema está «listo» cuando la tubería ya lo
// auditó ('ready' o 'needsReview') y tiene contenido; un borrador ('draft') con contenido aún se está escribiendo (o se quedó
// a medias si la creación se paró: entonces cuenta como «escrito»).
import type { SkillRef } from '@shared/schema'

export type TopicRef = Pick<SkillRef, 'status' | 'counts'>

export const topicHasLesson = (r: TopicRef): boolean => r.counts.lessonBlocks > 0

export const topicHasContent = (r: TopicRef): boolean => r.counts.lessonBlocks + r.counts.exercises + r.counts.templates > 0

/** ¿Se puede estudiar ya? Auditado por la tubería y con algo dentro. */
export const topicIsReady = (r: TopicRef): boolean => (r.status === 'ready' || r.status === 'needsReview') && topicHasContent(r)

/** Cuántos temas están listos para estudiar (no los planificados: esos pueden estar aún vacíos). */
export function readyTopicCount(skills: readonly TopicRef[]): number {
  let n = 0
  for (const s of skills) if (topicIsReady(s)) n++
  return n
}

/** Cuántos temas tienen ya algo escrito, auditado o no (un borrador que se quedó a medias al pararse la creación cuenta). */
export function writtenTopicCount(skills: readonly TopicRef[]): number {
  let n = 0
  for (const s of skills) if (topicHasContent(s)) n++
  return n
}

/** Lo que lleva un curso: temas listos (auditados) y escritos (con algo dentro, aunque sea un borrador). */
export interface TopicCounts {
  ready: number
  written: number
}

export function topicCounts(skills: readonly TopicRef[]): TopicCounts {
  return { ready: readyTopicCount(skills), written: writtenTopicCount(skills) }
}

/** Cómo va la creación del curso: escribiéndose, parada a medias (límite, pausa, error) o sin nada pendiente. */
export type CreationPhase = 'building' | 'stopped' | 'none'

/** Qué enseña Aprender de un tema: se abre, se está escribiendo, espera su turno o no tiene lección. */
export type TopicAvailability = 'ready' | 'writing' | 'queued' | 'unwritten'

/** `writingNow`: una ampliación en marcha está escribiendo este tema («Escribir este tema ahora»). */
export function topicAvailability(r: TopicRef, phase: CreationPhase, writingNow = false): TopicAvailability {
  // lo que escribe ahora una ampliación no se abre a medias: hasta que la tubería lo audite con su lección
  if (writingNow) return topicIsReady(r) && topicHasLesson(r) ? 'ready' : 'writing'
  // sin creación pendiente lo escrito se abre siempre (también lo que escribió Aula en el chat, que queda en borrador)
  if (phase === 'none') return topicHasLesson(r) ? 'ready' : 'unwritten'
  // parada: nadie está escribiendo, así que una lección a medias se puede leer; lo demás espera a «Reanudar»
  if (phase === 'stopped') return topicHasLesson(r) ? 'ready' : 'queued'
  if (topicIsReady(r) && topicHasLesson(r)) return 'ready'
  return r.status === 'draft' || topicHasContent(r) ? 'writing' : 'queued'
}

/** ¿Aprender abre este tema? Lo listo y, sin creación pendiente, lo que no tiene lección (allí se puede pedir que se escriba). */
export const topicOpens = (state: TopicAvailability): boolean => state === 'ready' || state === 'unwritten'
