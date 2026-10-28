// «Preparar más ejercicios» para un concepto agotado (port de StudyEngine/Pipeline/LearningContentRequest.swift): la petición
// que recoge la generación (`generation.extend`) para ampliar SOLO ese concepto, conservando el resto del curso y sus intentos.
import type { ItemID, Pack, Skill } from '@shared/schema'
import { L } from '@engine/grading/messages'
import type { LearningConcept, StudyLang } from './types'

/** Lo que se guarda en `runs/<id>.practice-request.json` para la generación. */
export interface LearningContentRequest {
  id: string
  kind: 'practice-request'
  /** Siempre «extend»: se amplía el curso, no se crea otro. */
  mode: 'extend'
  packId: ItemID
  skillId: ItemID
  conceptId?: string
  conceptTitle?: string
  /** Bloques de la lección que forman el concepto (para que la IA sepa dónde enlazar). */
  blockIDs: string[]
  /** La instrucción para `generation.extend` (en el idioma de la interfaz). */
  instruction: string
  /** Notas para el equipo de generación (en inglés, como la app Swift). */
  notes: string
  title: string
  subject: string
  language: string
  goal: string
  examDate?: string
  depth: 'quick'
  lessonMode: 'guided'
  allowWeb: false
  includeDecks: false
  verifyAnswers: true
  createdAt: string
  status: 'pending'
}

export function learningContentRequest(pack: Pack, skill: Skill, concept: LearningConcept | undefined, id: string, now: Date, lang?: StudyLang): LearningContentRequest {
  const title = concept?.title ?? skill.title
  const blockIDs = concept ? [...concept.teachingBlocks, ...concept.checkpointBlocks].map((b) => b.id) : []
  const instruction = L(lang, `Prepara otra explicación y ejercicios nuevos para «${title}».`, `Prepare another explanation and new exercises for “${title}”.`)
  const notes = `Guided learning needs fresh, independent checks for one concept. This is a targeted content request, not a new course.
Target concept title (data): ${title}
Target lesson block IDs (data): ${JSON.stringify(blockIDs)}
First call get_skill and read the complete existing lesson and exercise bank.
Add at least eight genuinely different exercises that assess ONLY this concept, with progressive hints, complete worked solutions and specific misconception feedback. Do not merely rename IDs or paraphrase an existing question with the same answer.
These checkpoints need objectively gradable answer keys. Use the answer kind that fits the concept: numeric/expression, choice with meaningful reasoning alternatives, ordering, matching, or short answers with accepted equivalents. For humanities assess interpretation, causes, distinctions and evidence with such checks, not trivial word recognition. Do not use essay/self-rated answers for compulsory checkpoints; open writing can remain optional practice.
For procedures add a relevant parametric template with different usable values, and tag its generated checks and the target checkpoint's exercises consistently so the reader can associate them.
Link the new exercises to the existing target tryit checkpoint. If there is no checkpoint, add one immediately after this concept's explanation and worked example. Preserve the IDs, order, teaching and answer keys of all existing blocks and exercises unless the target concept genuinely lacks teaching or contains a proven error. Do not replace the course or create a separate unrelated lesson.
If explanation is missing, add clear definitions and a worked example before the checkpoint. New exercise solutions must explain a different representation or method that the reader can use after a mistake.
Verify numerical answers with calculate and validate_skill. Use the course's saved materials. No browsing, computer use, downloading or new materials are needed for this request.`
  const out: LearningContentRequest = {
    id, kind: 'practice-request', mode: 'extend', packId: pack.id, skillId: skill.id, blockIDs, instruction, notes,
    title: pack.title, subject: pack.subject, language: pack.language, goal: pack.exam?.title ?? '', depth: 'quick', lessonMode: 'guided',
    allowWeb: false, includeDecks: false, verifyAnswers: true, createdAt: now.toISOString(), status: 'pending'
  }
  if (concept) { out.conceptId = concept.id; out.conceptTitle = concept.title }
  if (pack.exam?.date) out.examDate = pack.exam.date
  return out
}
