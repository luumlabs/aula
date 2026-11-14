// Aprender: la lección de un tema en una de sus tres formas («Aprender paso a paso», «Explorar la lección», «Solo leer»),
// con el final de la lección (medalla) y lo que viene después. Mientras Aula crea el curso solo se abren los temas listos; uno
// que aún no lo está dice que Aula lo está escribiendo (con el progreso). Con la creación en pausa se ofrece «Reanudar» (una
// ampliación la escondería); con Aula trabajando en el curso, se espera; sin nada pendiente, se puede escribir ahora.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LessonLearningMode, Skill } from '@shared/schema'
import { topicCounts } from '@engine/study/topics'
import { Button, EmptyState, Icon, Menu, Tooltip, toast } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { creationPhase, extendingTopic, runIsActive } from '../../course/failure'
import { useCourseRun } from '../../course/runs'
import { StudyFrame, TopCapsule } from '../Chrome'
import { updateProgress, type CourseData } from '../data'
import { exitTo, useBlockCtx, useInk } from '../kit'
import { SessionSummary } from '../Summary'
import { GuidedPlayer, type LearnFinish } from './GuidedPlayer'
import { PagePlayer } from './PagePlayer'
import { lessonGate, openableLessons, pickLesson } from './lessonGate'

const MODES: LessonLearningMode[] = ['guided', 'explore', 'reading']

export function LearnMode({ data, skillId }: { data: CourseData; skillId?: string }) {
  const { t } = useTranslation('study')
  const lastRun = useCourseRun(data.pack.id)
  const phase = creationPhase(lastRun, topicCounts(data.pack.skills))
  // el tema que escribe ahora «Escribir este tema ahora» (o «Pedir cambios» de un tema): no se abre a medias
  const writingTopic = extendingTopic(lastRun)
  const skill = pickLesson(data, skillId, phase, writingTopic)
  const [starting, setStarting] = useState(false)
  const [resuming, setResuming] = useState(false)
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

  // con la misma tubería que «Preparar más»: una ampliación del curso solo para este tema (se sigue en su monitor). Si ya
  // tiene sus ejercicios (el escritor de la lección falló), solo se pide la lección: rehacerlos los duplicaría
  const writeNow = async (target: Skill, lessonOnly: boolean): Promise<void> => {
    setStarting(true)
    try {
      const instruction = lessonOnly ? t('learn.writeLessonInstruction', { topic: target.title }) : t('learn.writeInstruction', { topic: target.title })
      const r = await api.invoke('generation.extend', { packId: data.pack.id, instruction, skillId: target.id })
      navigate({ name: 'run', id: r.runId })
    } catch (e) {
      toast.error(t('learn.writeFailed'), e instanceof Error ? e.message : undefined)
    } finally {
      setStarting(false)
    }
  }

  // la creación en pausa sigue donde se quedó (con la IA activa) y escribe también este tema
  const resume = async (runId: string): Promise<void> => {
    setResuming(true)
    try {
      await api.invoke('generation.resume', { id: runId })
      navigate({ name: 'run', id: runId })
    } catch (e) {
      toast.error(t('learn.resumeFailed'), e instanceof Error ? e.message : undefined)
    } finally {
      setResuming(false)
    }
  }

  const ref = skill ? data.pack.skills.find((r) => r.id === skill.id) : undefined
  const gate = lessonGate({ skill, ref, phase, writing: writingTopic, active: runIsActive(lastRun) })
  if (gate !== 'open' || !skill) {
    const capsule = <TopCapsule icon="learn" label={skill ? <RichText text={skill.title} inline /> : t('learn.title')} onExit={onExit} />
    // Aula lo está escribiendo: no se manda al chat (gastaría más), se dice y se enseña el progreso
    if (gate === 'writing' && lastRun)
      return (
        <StudyFrame capsule={capsule} onExit={onExit}>
          <EmptyState
            art="pencil"
            title={skill ? t('learn.writingTitle') : t('learn.writingFirstTitle')}
            body={t('learn.writingBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<Icon name="activity" size={15} />} onClick={() => navigate({ name: 'run', id: lastRun.id })}>{t('learn.seeProgress')}</Button>
                <Button variant="ghost" onClick={onExit}>{t('common.backToCourse')}</Button>
              </div>
            }
          />
        </StudyFrame>
      )
    // la creación se paró antes de llegar a este tema: «Escribir este tema ahora» lanzaría una ampliación que escondería la
    // creación a medias (sin «Reanudar» ni «Quedarme con lo que hay»); se ofrece reanudarla
    if (gate === 'paused' && lastRun)
      return (
        <StudyFrame capsule={capsule} onExit={onExit}>
          <EmptyState
            art="books"
            title={t('learn.pausedTitle')}
            body={t('learn.pausedBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<Icon name="refresh" size={15} />} loading={resuming} onClick={() => void resume(lastRun.id)}>{t('learn.resume')}</Button>
                <Button variant="secondary" icon={<Icon name="activity" size={15} />} onClick={() => navigate({ name: 'run', id: lastRun.id })}>{t('learn.openLog')}</Button>
                <Button variant="ghost" onClick={onExit}>{t('common.backToCourse')}</Button>
              </div>
            }
          />
        </StudyFrame>
      )
    // Aula ya trabaja en el curso (otra ampliación): una más daría «ocupado»; se espera a que termine
    if (gate === 'busy' && lastRun)
      return (
        <StudyFrame capsule={capsule} onExit={onExit}>
          <EmptyState
            art="pencil"
            title={t('learn.busyTitle')}
            body={t('learn.busyBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<Icon name="activity" size={15} />} onClick={() => navigate({ name: 'run', id: lastRun.id })}>{t('learn.seeProgress')}</Button>
                <Button variant="ghost" onClick={onExit}>{t('common.backToCourse')}</Button>
              </div>
            }
          />
        </StudyFrame>
      )
    return (
      <StudyFrame capsule={capsule} onExit={onExit}>
        <EmptyState
          art="books"
          title={t('learn.noLessonTitle')}
          body={skill ? (gate === 'writeLesson' ? t('learn.writeLessonBody') : t('learn.writeNowBody')) : t('learn.noLessonBody')}
          action={
            skill ? (
              <Button variant="primary" icon={<Icon name="create" size={15} />} loading={starting} onClick={() => void writeNow(skill, gate === 'writeLesson')}>{t('learn.writeNow')}</Button>
            ) : (
              <Button variant="primary" onClick={() => navigate({ name: 'chat', prompt: t('learn.askWrite', { topic: '' }) })}>{t('learn.askAula')}</Button>
            )
          }
        />
      </StudyFrame>
    )
  }

  if (done) {
    const lessons = openableLessons(data, phase, writingTopic)
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
