// «Inténtalo tú» dentro de la lección (explorar): los ejercicios del bloque uno tras otro, corregidos al instante.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { Exercise, Skill } from '@shared/schema'
import type { BlockContext } from '@renderer/blocks/types'
import { Button, Icon } from '@renderer/design'
import { ExerciseCard } from '@renderer/exercises'
import { recordResult } from '../kit'
import { gradeOpenWithAI } from '../ai'

export function TryItPanel({ packId, skill, ids, ctx, onDone, onClose }: { packId: string; skill: Skill; ids: string[]; ctx: BlockContext; onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation('study')
  const exercises = useMemo(() => {
    const inline = skill.lesson.flatMap((b) => (b.type === 'tryit' ? b.inline : []))
    return ids.map((id) => skill.exercises.find((e) => e.id === id) ?? inline.find((e) => e.id === id)).filter((e): e is Exercise => !!e).map((e) => (e.skill ? e : { ...e, skill: skill.id }))
  }, [ids, skill])
  const [index, setIndex] = useState(0)
  const ex = exercises[index]
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-8 flex w-full max-w-[720px] flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon name="practice" size={16} className="text-text2" />
        <span className="t-headline">{t('learn.tryIt')}</span>
        {exercises.length > 1 && <span className="t-ui tabular text-text3">{t('common.nOfM', { n: Math.min(index + 1, exercises.length), m: exercises.length })}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>{t('learn.closeTry')}</Button>
      </div>
      {!ex ? (
        <div className="t-callout text-text2">{t('learn.noTry')}</div>
      ) : (
        <ExerciseCard
          key={ex.id}
          exercise={ex}
          ctx={ctx}
          mode="lesson"
          continueLabel={index < exercises.length - 1 ? t('learn.nextExercise') : t('learn.doneTry')}
          exactText={ctx.exactText}
          onFirstResult={(r, run) => recordResult(packId, ex, r, run, 'lesson')}
          gradeOpen={(e, text) => gradeOpenWithAI(packId, e, text)}
          onContinue={() => (index < exercises.length - 1 ? setIndex(index + 1) : onDone())}
        />
      )}
    </motion.section>
  )
}
