// Aprender: la lección de un tema en una de sus tres formas («Aprender paso a paso», «Explorar la lección», «Solo leer»),
// con el final de la lección (medalla) y lo que viene después.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LessonLearningMode, Skill } from '@shared/schema'
import { isSkillMasteredGuided } from '@engine/study'
import { Button, EmptyState, Icon, Menu, Tooltip } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { StudyFrame, TopCapsule } from '../Chrome'
import { updateProgress, type CourseData } from '../data'
import { exitTo, useBlockCtx, useInk } from '../kit'
import { SessionSummary } from '../Summary'
import { GuidedPlayer, type LearnFinish } from './GuidedPlayer'
import { PagePlayer } from './PagePlayer'

const MODES: LessonLearningMode[] = ['guided', 'explore', 'reading']

/** El tema que se abre: el pedido o, en el modo guiado, la primera lección sin dominar (en el orden del curso). */
export function pickLesson(data: CourseData, requested?: string): Skill | undefined {
  const lessons = data.skills.filter((s) => s.lesson.length > 0)
  if (requested) return data.skills.find((s) => s.id === requested)
  return lessons.find((s) => !isSkillMasteredGuided(s, data.progress.skills[s.id])) ?? lessons[0]
}

export function LearnMode({ data, skillId }: { data: CourseData; skillId?: string }) {
  const { t } = useTranslation('study')
  const skill = pickLesson(data, skillId)
  const ctx = useBlockCtx(data.pack, skill?.id)
  const ink = useInk(data.pack)
  const [done, setDone] = useState<LearnFinish | null>(null)
  const [run, setRun] = useState(0)
  const mode = data.progress.settings.lessonMode
  const onExit = (): void => exitTo(data.pack.id, 'learn')

  const setMode = (m: LessonLearningMode): void => {
    if (m === mode) return
    updateProgress(data.pack.id, (p) => ({ ...p, settings: { ...p.settings, lessonMode: m } }), { kind: 'save' })
    setRun((x) => x + 1)
  }

  const modeMenu = (
    <Menu
      align="end"
      trigger={(open) => (
        <Tooltip label={t(`learn.modeHelp.${mode}`)} side="bottom">
          <button type="button" onClick={open} className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 t-ui font-medium text-text2 hover:bg-fill1 hover:text-text">
            {t(`learn.modeShort.${mode}`)}
            <Icon name="chevron-down" size={11} />
          </button>
        </Tooltip>
      )}
      items={MODES.map((m) => ({
        label: (
          <span className="flex max-w-[300px] flex-col py-0.5">
            <span className="font-semibold">{t(`learn.mode.${m}`)}</span>
            <span className="t-footnote whitespace-normal text-text3">{t(`learn.modeHelp.${m}`)}</span>
          </span>
        ),
        icon: m === mode ? <Icon name="check" size={14} className="text-accent-text" /> : undefined,
        onSelect: () => setMode(m)
      }))}
    />
  )

  if (!skill || skill.lesson.length === 0)
    return (
      <StudyFrame capsule={<TopCapsule icon="learn" label={skill ? <RichText text={skill.title} inline /> : t('learn.title')} onExit={onExit} />} onExit={onExit}>
        <EmptyState
          title={t('learn.noLessonTitle')}
          body={t('learn.noLessonBody')}
          action={<Button variant="primary" onClick={() => navigate({ name: 'chat', prompt: t('learn.askWrite', { topic: skill?.title ?? '' }) })}>{t('learn.askAula')}</Button>}
        />
      </StudyFrame>
    )

  if (done) {
    const lessons = data.skills.filter((s) => s.lesson.length > 0)
    const nextSkill = lessons[lessons.findIndex((s) => s.id === skill.id) + 1]
    const guided = mode === 'guided'
    return (
      <StudyFrame capsule={<TopCapsule icon="learn" label={<RichText text={skill.title} inline />} onExit={onExit} />} onExit={onExit}>
        <SessionSummary
          packId={data.pack.id}
          title={guided ? (done.unchecked ? t('learn.doneUncheckedTitle') : t('learn.doneTitle')) : t('learn.doneReadingTitle')}
          body={guided ? (done.unchecked ? t('learn.doneUnchecked', { count: done.unchecked }) : t('learn.doneBody')) : t('learn.doneReading')}
          stats={[
            { value: done.concepts, label: guided ? t('learn.statConcepts', { count: done.concepts }) : t('learn.statPages', { count: done.concepts }) },
            ...(done.answered > 0 ? [{ value: done.correct, text: t('common.aOfB', { a: done.correct, b: done.answered }), label: t('learn.statFirstTry') }] : [])
          ]}
          actions={
            <>
              <Button variant="primary" size="lg" onClick={() => navigate({ name: 'study', id: data.pack.id, mode: 'practice', skill: skill.id }, { replace: true })}>{t('learn.practiceTopic')}</Button>
              {nextSkill && (
                <Button variant="secondary" size="lg" iconRight={<Icon name="arrow-right" size={15} />} onClick={() => navigate({ name: 'study', id: data.pack.id, mode: 'learn', skill: nextSkill.id }, { replace: true })}>
                  {t('learn.nextLesson')}
                </Button>
              )}
              <Button variant="ghost" size="lg" onClick={onExit}>{t('common.backToCourse')}</Button>
            </>
          }
        />
      </StudyFrame>
    )
  }

  const common = { data, skill, ctx, ink, modeMenu, onExit, onFinish: setDone }
  return mode === 'guided' ? <GuidedPlayer key={`g-${skill.id}-${run}`} {...common} /> : <PagePlayer key={`p-${skill.id}-${mode}-${run}`} {...common} reading={mode === 'reading'} />
}
