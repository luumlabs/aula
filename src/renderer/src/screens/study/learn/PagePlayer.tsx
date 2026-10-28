// «Explorar la lección» y «Solo leer»: la lección en páginas cómodas, con transición entre ellas, ← → y espacio. Al
// explorar, las preguntas y los «Inténtalo tú» se pueden hacer o saltar; al leer, las preguntas se convierten en
// explicaciones. Se vuelve a la página donde se dejó. Terminar la lectura no cuenta como haber dominado el tema.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Skill, SkillProgress } from '@shared/schema'
import { makeSkillProgress } from '@shared/schema'
import { completeLesson, withSkillProgress } from '@engine/study'
import { BlockList } from '@renderer/blocks/BlockView'
import type { BlockContext } from '@renderer/blocks/types'
import { Button, cx, Icon, IconButton, Menu, Tooltip, useTheme } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { isTypingTarget } from '@renderer/exercises/normalize'
import { StudyFrame, GlassCapsule, ProgressDots, TopCapsule, CapsuleDivider, type DotState } from '../Chrome'
import { updateProgress, useStudyStore, type CourseData } from '../data'
import { recordTime } from '../kit'
import { blocksSpeech, canSpeak, useSpeech } from '../speech'
import { lessonPages, readingBlocks, type TitleWords } from './steps'
import { TryItPanel } from './TryItPanel'
import type { LearnFinish } from './GuidedPlayer'

const page = { initial: { opacity: 0, x: 28 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -28 }, transition: { duration: 0.32, ease: [0.2, 0.7, 0.2, 1] as const } }

export function useTitleWords(): TitleWords {
  const { t } = useTranslation('study')
  return useMemo(() => ({
    step: (n: number) => t('learn.step', { n }), example: t('learn.example'), predict: t('learn.predict'), spot: t('learn.spot'), tryit: t('learn.tryIt'),
    recap: t('learn.recap'), explore: t('learn.explore'), formulas: t('learn.formulas'), plot: t('learn.plot')
  }), [t])
}

export function PagePlayer({ data, skill, ctx: baseCtx, ink, reading, modeMenu, onExit, onFinish }: {
  data: CourseData
  skill: Skill
  ctx: BlockContext
  ink: string
  reading: boolean
  modeMenu: ReactNode
  onExit: () => void
  onFinish: (f: LearnFinish) => void
}) {
  const { t } = useTranslation('study')
  const { reducedMotion } = useTheme()
  const words = useTitleWords()
  const packId = data.pack.id
  const pages = useMemo(() => lessonPages(reading ? readingBlocks(skill.lesson) : skill.lesson, words), [skill, reading, words])
  const saved = data.progress.skills[skill.id]?.lessonStep ?? 0
  const [index, setIndex] = useState(() => Math.max(0, Math.min(saved, pages.length - 1)))
  const [gates, setGates] = useState<Set<number>>(() => new Set())
  const [tryIt, setTryIt] = useState<string[] | null>(null)
  const [tally, setTally] = useState({ answered: 0, correct: 0 })
  const speech = useSpeech()
  const pg = pages[index]
  const isLast = index >= pages.length - 1

  const ctx: BlockContext = useMemo(() => ({
    ...baseCtx,
    onTryIt: reading ? undefined : (ids: string[]) => setTryIt(ids),
    onInteract: (_id: string, kind: string) => {
      setGates((g) => new Set(g).add(index))
      if (kind.includes('correct')) setTally((x) => ({ answered: x.answered + 1, correct: x.correct + 1 }))
      else if (kind.includes('answer') || kind.includes('pick')) setTally((x) => ({ ...x, answered: x.answered + 1 }))
    }
  }), [baseCtx, reading, index])

  // tiempo de lectura (los ejercicios ya guardan el suyo)
  const since = useRef(Date.now())
  useEffect(() => () => recordTime(packId, (Date.now() - since.current) / 1000), [packId])

  const saveStep = (i: number): void =>
    updateProgress(packId, (p) => withSkillProgress(p, skill.id, { ...(p.skills[skill.id] ?? makeSkillProgress()), lessonStep: i } as SkillProgress), { kind: 'learning', skillId: skill.id })

  const go = (i: number): void => {
    if (i < 0 || i >= pages.length || i === index) return
    speech.stop()
    setTryIt(null)
    setIndex(i)
    saveStep(i)
  }
  const finish = (): void => {
    const already = useStudyStore.getState().courses[packId]?.progress.skills[skill.id]?.lessonDone
    if (!already) updateProgress(packId, (p) => completeLesson(p, skill.id, new Date()), { kind: 'completeLesson', skillId: skill.id })
    onFinish({ concepts: pages.length, unchecked: 0, answered: tally.answered, correct: tally.correct })
  }
  const next = (): void => {
    if (isLast) finish()
    else {
      setGates((g) => new Set(g).add(index))
      go(index + 1)
    }
  }

  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(document.activeElement as HTMLElement | null) || tryIt) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(index - 1)
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        nextRef.current()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  })

  const states: DotState[] = pages.map((_, i) => (i < index || gates.has(i) ? 'done' : 'todo'))
  const minutesLeft = Math.max(1, Math.round(pages.slice(index).reduce((a, p) => a + p.minutes, 0)))
  const pendingGate = !reading && pg && pg.gate !== 'none' && !gates.has(index)

  const pagesMenu = (
    <Menu
      align="end"
      trigger={(open) => (
        <Tooltip label={t('learn.contents')} side="bottom">
          <IconButton label={t('learn.contents')} size="sm" onClick={open} className="rounded-full!">
            <Icon name="checklist" size={15} />
          </IconButton>
        </Tooltip>
      )}
      items={pages.map((p, i) => ({
        label: (
          <span className="flex min-w-0 max-w-[340px] items-center gap-2">
            <span className="w-5 shrink-0 text-right tabular text-text3">{i + 1}</span>
            <span className={cx('truncate', i === index && 'text-accent-text')}><RichText text={p.title} inline /></span>
            <span className="ml-auto shrink-0 pl-2 t-footnote tabular text-text3">{t('learn.min', { count: Math.max(1, Math.round(p.minutes)) })}</span>
          </span>
        ),
        onSelect: () => go(i)
      }))}
    />
  )

  const capsule = (
    <TopCapsule
      icon={reading ? 'book' : 'learn'}
      label={<RichText text={skill.title} inline />}
      onExit={onExit}
      trailing={
        <>
          {canSpeak() && (
            <Tooltip label={speech.speaking ? t('learn.stopReading') : t('learn.readAloud')} side="bottom">
              <IconButton label={speech.speaking ? t('learn.stopReading') : t('learn.readAloud')} size="sm" active={speech.speaking} className="rounded-full!" onClick={() => (speech.speaking ? speech.stop() : speech.speak(blocksSpeech(pg?.blocks ?? []), data.pack.language))}>
                <Icon name="audio" size={15} />
              </IconButton>
            </Tooltip>
          )}
          {pagesMenu}
          {modeMenu}
        </>
      }
    >
      <ProgressDots states={states} current={index} ink={ink} onPick={go} />
      <span className="t-ui tabular text-text2 whitespace-nowrap">{t('learn.stepOf', { n: index + 1, m: pages.length })} · {t('learn.min', { count: minutesLeft })}</span>
    </TopCapsule>
  )

  const bottom = (
    <GlassCapsule>
      <Tooltip label={t('learn.prev')}>
        <IconButton label={t('learn.prev')} disabled={index === 0} onClick={() => go(index - 1)} className="rounded-full!">
          <Icon name="chevron-left" size={16} />
        </IconButton>
      </Tooltip>
      {pendingGate && (
        <span className="flex items-center gap-1 px-2 t-ui text-text2">
          {pg.gate === 'tryit' ? t('learn.gateTry') : pg.gate === 'spot' ? t('learn.gateSpot') : t('learn.gatePredict')}
        </span>
      )}
      <CapsuleDivider />
      <Button variant="primary" size="md" className="rounded-full! px-4" onClick={next} iconRight={!isLast ? <Icon name="arrow-right" size={14} /> : undefined}>
        {isLast ? t('learn.finishReading') : pendingGate ? t('learn.skip') : t('learn.continue')}
      </Button>
    </GlassCapsule>
  )

  if (!pg)
    return (
      <StudyFrame capsule={capsule} onExit={onExit}>
        <div className="t-body text-text2">{t('learn.empty')}</div>
      </StudyFrame>
    )

  return (
    <StudyFrame capsule={capsule} bottom={bottom} onExit={onExit} scrollKey={index}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={index} {...(reducedMotion ? {} : page)}>
          <BlockList blocks={pg.blocks} ctx={ctx} />
          {tryIt && (
            <TryItPanel
              packId={packId}
              skill={skill}
              ids={tryIt}
              ctx={ctx}
              onClose={() => setTryIt(null)}
              onDone={() => {
                setTryIt(null)
                setGates((g) => new Set(g).add(index))
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </StudyFrame>
  )
}
