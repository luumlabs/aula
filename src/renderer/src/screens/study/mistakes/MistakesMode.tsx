// Repaso de errores: los ejercicios que fallaste vuelven a los 1, 3, 7, 16 y 35 días; si los aciertas en todos esos
// repasos, quedan resueltos. Encima de cada uno, lo que escribiste la otra vez y por qué no era.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Exercise, MistakeEntry } from '@shared/schema'
import { buildPractice, mistakesNotebook } from '@engine/study'
import { Button, EmptyState, Icon } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { StudyFrame, TopCapsule } from '../Chrome'
import type { CourseData } from '../data'
import { exitTo } from '../kit'
import { PracticeMode } from '../practice/PracticeMode'

export function MistakesMode({ data, skillId }: { data: CourseData; skillId?: string }) {
  const { t } = useTranslation('study')
  const onExit = (): void => exitTo(data.pack.id, 'mistakes')
  const [all, setAll] = useState(false)
  const entries = useMemo(() => {
    try {
      return mistakesNotebook(data.progress, data.skills, new Date())
    } catch {
      return []
    }
  }, [data.progress, data.skills])
  const byExercise = useMemo(() => new Map(entries.map((m) => [m.entry.exerciseID, m.entry])), [entries])
  const [queue] = useState<Exercise[]>(() => {
    try {
      const due = buildPractice(data.pack, data.skills, data.progress, { kind: 'mistakes' }, { count: 30, now: new Date() })
      return skillId ? due.filter((e) => e.skill === skillId) : due
    } catch {
      return []
    }
  })
  const open = entries.filter((m) => m.exercise && (!skillId || m.entry.skill === skillId)).map((m) => m.exercise!)
  const list = all ? open : queue

  if (!list.length)
    return (
      <StudyFrame capsule={<TopCapsule icon="mistakes" label={t('mistakes.title')} onExit={onExit} />} onExit={onExit}>
        <EmptyState
          title={t('mistakes.nothingTitle')}
          body={open.length ? t('mistakes.nothingDue', { count: open.length }) : t('mistakes.nothingBody')}
          action={
            <div className="flex gap-2">
              {open.length > 0 && <Button variant="primary" onClick={() => setAll(true)}>{t('mistakes.practiceAll', { count: open.length })}</Button>}
              <Button onClick={onExit}>{t('common.backToCourse')}</Button>
            </div>
          }
        />
      </StudyFrame>
    )

  return (
    <PracticeMode
      key={all ? 'all' : 'due'}
      data={data}
      initial={list}
      title={t('mistakes.title')}
      options={{ attemptMode: 'review', exitTab: 'mistakes', icon: 'mistakes', before: (ex) => <PastAttempt entry={byExercise.get(ex.id)} /> }}
    />
  )
}

/** Lo que pasó la otra vez: cuántas veces se falló, la etapa de repaso y lo que se escribió. */
export function PastAttempt({ entry }: { entry?: MistakeEntry }) {
  const { t } = useTranslation('study')
  if (!entry) return null
  return (
    <div className="mb-4 flex flex-col gap-1.5 rounded-[16px] bg-fill1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-ui text-text2">
        <span className="inline-flex items-center gap-1.5"><Icon name="mistakes" size={14} />{t('mistakes.failedTimes', { count: entry.count })}</span>
        <span className="text-text3">·</span>
        <span>{t('mistakes.stage', { n: Math.min(entry.stage + 1, 5), m: 5 })}</span>
      </div>
      {entry.lastInput && (
        <div className="t-callout">
          <span className="text-text3">{t('mistakes.youWrote')} </span>
          <span className="text-text line-through decoration-danger/60"><RichText text={entry.lastInput} inline /></span>
        </div>
      )}
    </div>
  )
}
