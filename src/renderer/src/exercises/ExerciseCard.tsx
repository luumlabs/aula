// Un ejercicio con su propio flujo (para listas: «Pruébalo» de la lección, repaso de errores, revisión del simulacro).
import type { Block } from '@shared/schema/blocks'
import type { Exercise } from '@shared/schema/exercises'
import type { BlockContext } from '@renderer/blocks/types'
import { ExerciseView } from './ExerciseView'
import { useExercise, type ExerciseOptions } from './useExercise'

export function ExerciseCard({ exercise, ctx, skillTitle, continueLabel, active, autoFocus, alternate, onAskTutor, bare, number, ...opts }: ExerciseOptions & {
  exercise: Exercise
  ctx: BlockContext
  skillTitle?: string
  continueLabel?: string
  active?: boolean
  autoFocus?: boolean
  alternate?: Block[]
  onAskTutor?: () => void
  bare?: boolean
  number?: number
}) {
  const c = useExercise(exercise, opts)
  return <ExerciseView controller={c} ctx={ctx} skillTitle={skillTitle} continueLabel={continueLabel} active={active} autoFocus={autoFocus} alternate={alternate} onAskTutor={onAskTutor} bare={bare} number={number} />
}
