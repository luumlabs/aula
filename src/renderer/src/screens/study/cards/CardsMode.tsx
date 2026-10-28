// Tarjetas: repaso espaciado (FSRS). La tarjeta gira en 3D (espacio); se califica con Otra vez · Difícil · Bien · Fácil
// (1–4) y cada botón dice cuándo volverá. «Otra vez» la devuelve al final de la sesión. Deshacer la última (⌘Z),
// «Escuchar» en los cursos de idiomas y, al terminar, la medalla con lo repasado y lo que espera mañana.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Flashcard, StudyProgress } from '@shared/schema'
import { cardIntervals, clozeText, dueCards, reviewCard, type DueCard } from '@engine/study'
import type { Rating } from '@engine/learn'
import { Button, cx, EmptyState, GlassLight, Icon, IconButton, Tooltip, useTheme } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { isTypingTarget } from '@renderer/exercises/normalize'
import { gradeLang, KeyCap } from '@renderer/exercises'
import i18n from '@renderer/i18n'
import { CapsuleProgress, GlassCapsule, StudyFrame, TopCapsule } from '../Chrome'
import { updateProgress, useStudyStore, type CourseData } from '../data'
import { exitTo, useInk } from '../kit'
import { SessionSummary } from '../Summary'
import { canSpeak, speakable, useSpeech } from '../speech'

const RATINGS: Rating[] = [1, 2, 3, 4]
const RATING_KEY = ['again', 'hard', 'good', 'easy'] as const

/** ¿Curso de idiomas? (entonces «Escuchar» lee la tarjeta con la voz de ese idioma) */
export function isLanguageCourse(subject: string, title: string, examLanguage?: string): boolean {
  return !!examLanguage || /idiom|lengua|language|ingl[eé]s|english|franc[eé]s|french|alem[aá]n|german|italian|portugu|japon|japanese|chin|coreano|korean|B1|B2|C1|C2/i.test(`${subject} ${title}`)
}

/** Idioma de la voz de un curso de idiomas (por el título si no lo dice el curso). */
export function speechLang(subject: string, title: string, examLanguage: string | undefined, fallback: string): string {
  if (examLanguage) return examLanguage
  const s = `${subject} ${title}`.toLowerCase()
  if (/ingl[eé]s|english/.test(s)) return 'en'
  if (/franc[eé]s|french/.test(s)) return 'fr'
  if (/alem[aá]n|german/.test(s)) return 'de'
  if (/italian/.test(s)) return 'it'
  if (/portugu/.test(s)) return 'pt'
  if (/japon|japanese/.test(s)) return 'ja'
  return fallback
}

interface Tally { reviewed: number; again: number; hard: number; good: number; easy: number }

export function CardsMode({ data, skillId }: { data: CourseData; skillId?: string }) {
  const { t } = useTranslation('study')
  const packId = data.pack.id
  const [queue, setQueue] = useState<DueCard[]>(() => {
    try {
      return dueCards(data.pack, data.skills, data.progress, { now: new Date(), skillId })
    } catch {
      return []
    }
  })
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [hint, setHint] = useState(false)
  const [tally, setTally] = useState<Tally>({ reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 })
  const [undo, setUndo] = useState<{ progress: StudyProgress; queue: DueCard[]; index: number; tally: Tally; rating: Rating } | null>(null)
  const shownAt = useRef(Date.now())
  const speech = useSpeech()
  const ink = useInk(data.pack)
  const progress = useStudyStore((s) => s.courses[packId]?.progress) ?? data.progress
  const lang = gradeLang(i18n.language)
  const language = isLanguageCourse(data.pack.subject, data.pack.title, data.pack.examLanguage)
  const voice = speechLang(data.pack.subject, data.pack.title, data.pack.examLanguage, data.pack.language)
  const onExit = (): void => exitTo(packId, 'cards')
  const due = queue[index]
  const done = !due && queue.length > 0
  const skillName = skillId ? data.skills.find((s) => s.id === skillId)?.title : undefined
  const intervals = useMemo(() => (due ? cardIntervals(progress, due.card.id, new Date(), lang) : null), [due, progress, lang])

  useEffect(() => {
    shownAt.current = Date.now()
    setFlipped(false)
    setHint(false)
    speech.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, due?.card.id])

  const rate = (r: Rating): void => {
    if (!due || !flipped) return
    const seconds = Math.min(120, (Date.now() - shownAt.current) / 1000)
    const before = useStudyStore.getState().courses[packId]?.progress ?? data.progress
    setUndo({ progress: before, queue, index, tally, rating: r })
    updateProgress(packId, (p) => reviewCard(p, due.card.id, r, new Date(), { skillId: due.skillId, skills: data.skills, seconds }), { kind: 'review', cardId: due.card.id, rating: r, seconds })
    setTally((x) => ({ ...x, reviewed: x.reviewed + 1, [RATING_KEY[r - 1]]: x[RATING_KEY[r - 1]] + 1 }))
    // «Otra vez» vuelve al final de esta sesión
    if (r === 1 && queue.filter((q) => q.card.id === due.card.id).length < 3) setQueue((q) => [...q, { ...due, isNew: false }])
    setIndex((i) => i + 1)
  }
  const undoLast = (): void => {
    if (!undo) return
    updateProgress(packId, () => undo.progress, { kind: 'save' })
    setQueue(undo.queue)
    setIndex(undo.index)
    setTally(undo.tally)
    setUndo(null)
  }

  const keyRef = useRef({ rate, undoLast, flipped, due })
  keyRef.current = { rate, undoLast, flipped, due }
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (isTypingTarget(document.activeElement as HTMLElement | null)) return
      const k = keyRef.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        k.undoLast()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || !k.due) return
      if (e.key === ' ' || (e.key === 'Enter' && !k.flipped)) {
        e.preventDefault()
        if (!k.flipped) setFlipped(true)
        else k.rate(3)
      } else if (['1', '2', '3', '4'].includes(e.key) && k.flipped) {
        e.preventDefault()
        k.rate(Number(e.key) as Rating)
      } else if (e.key.toLowerCase() === 'h') setHint(true)
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const label = skillName ? <RichText text={skillName} inline /> : t('cards.title')

  if (!queue.length)
    return (
      <StudyFrame capsule={<TopCapsule icon="cards" label={label} onExit={onExit} />} onExit={onExit}>
        <EmptyState
          title={t('cards.nothingTitle')}
          body={t('cards.nothingBody')}
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => navigate({ name: 'study', id: packId, mode: 'practice' }, { replace: true })}>{t('cards.practiceInstead')}</Button>
              <Button onClick={onExit}>{t('common.backToCourse')}</Button>
            </div>
          }
        />
      </StudyFrame>
    )

  if (done) {
    const tomorrow = (() => {
      try {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(23, 0, 0, 0)
        return dueCards(data.pack, data.skills, progress, { now: d, includeNew: false, skillId }).length
      } catch {
        return 0
      }
    })()
    return (
      <StudyFrame capsule={<TopCapsule icon="cards" label={label} onExit={onExit} />} onExit={onExit}>
        <SessionSummary
          packId={data.pack.id}
          title={t('cards.doneTitle')}
          body={tally.again > 0 ? t('cards.doneAgain') : t('cards.doneBody')}
          stats={[
            { value: tally.reviewed, label: t('cards.statReviewed', { count: tally.reviewed }) },
            { value: tally.good + tally.easy, label: t('cards.statGood') },
            { value: tally.hard, label: t('cards.statHard') },
            { value: tally.again, label: t('cards.statAgain') }
          ]}
          actions={
            <>
              <Button variant="primary" size="lg" onClick={onExit}>{t('common.backToCourse')}</Button>
              {undo && <Button variant="ghost" size="lg" icon={<Icon name="undo" size={15} />} onClick={undoLast}>{t('cards.undo', { rating: t(`cards.rating.${RATING_KEY[undo.rating - 1]}`) })}</Button>}
            </>
          }
        >
          <p className="text-center t-callout text-text2">{tomorrow > 0 ? t('cards.tomorrow', { count: tomorrow }) : t('cards.tomorrowNone')}</p>
        </SessionSummary>
      </StudyFrame>
    )
  }

  const card = due.card
  const skill = data.skills.find((s) => s.id === due.skillId)
  return (
    <StudyFrame
      onExit={onExit}
      capsule={
        <TopCapsule
          icon="cards"
          label={label}
          onExit={onExit}
          trailing={
            undo ? (
              <Tooltip label={t('cards.undoHelp')} side="bottom">
                <IconButton label={t('cards.undoHelp')} size="sm" onClick={undoLast} className="rounded-full!">
                  <Icon name="undo" size={15} />
                </IconButton>
              </Tooltip>
            ) : undefined
          }
        >
          <CapsuleProgress value={index} total={queue.length} label={t('common.nOfM', { n: Math.min(index + 1, queue.length), m: queue.length })} />
        </TopCapsule>
      }
      bottom={
        <GlassCapsule className="px-2">
          {!flipped ? (
            <>
              <span className="px-2 t-ui text-text2">{t('cards.recallFirst')}</span>
              <Button variant="primary" size="md" className="rounded-full! px-4" onClick={() => setFlipped(true)} iconRight={<KeyCap className="bg-white/20! text-on-accent!">{t('cards.space')}</KeyCap>}>
                {t('cards.flip')}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-1">
              {RATINGS.map((r) => (
                <RatingButton key={r} rating={r} interval={intervals?.[r] ?? ''} onClick={() => rate(r)} />
              ))}
            </div>
          )}
        </GlassCapsule>
      }
    >
      <div className="flex flex-col items-center gap-4 pt-4">
        <div className="flex items-center gap-2 t-ui text-text2">
          {skill && <span className="truncate"><RichText text={skill.title} inline /></span>}
          {due.isNew && <span className="rounded-full bg-accent-wash px-2 py-0.5 t-caption font-semibold text-accent-text">{t('cards.new')}</span>}
        </div>
        <FlipCard
          key={`${card.id}-${index}`}
          card={card}
          flipped={flipped}
          onFlip={() => setFlipped((f) => !f)}
          ink={ink}
          assetUrl={(a) => `aula-asset://pack/${encodeURIComponent(packId)}/${a.split('/').map(encodeURIComponent).join('/')}`}
        />
        <div className="flex items-center gap-2">
          {card.hint && !flipped && (
            <Button variant="ghost" size="sm" icon={<Icon name="lightbulb" size={14} />} onClick={() => setHint(true)} disabled={hint}>
              {t('cards.hint')}
            </Button>
          )}
          {canSpeak() && language && (
            <Button variant="ghost" size="sm" icon={<Icon name="audio" size={14} />} onClick={() => (speech.speaking ? speech.stop() : speech.speak(speakable(flipped ? card.back : card.kind === 'cloze' ? clozeText(card.front, true) : card.front), voice))}>
              {speech.speaking ? t('cards.stop') : t('cards.listen')}
            </Button>
          )}
        </div>
        <AnimatePresence>
          {hint && card.hint && !flipped && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="max-w-[560px] rounded-[14px] bg-fill1 px-4 py-3 t-callout text-text2">
              <RichText text={card.hint} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StudyFrame>
  )
}

function RatingButton({ rating, interval, onClick }: { rating: Rating; interval: string; onClick: () => void }) {
  const { t } = useTranslation('study')
  const key = RATING_KEY[rating - 1]
  // sin arcoíris: «Otra vez» en ladrillo (la única luz) y el resto en tinta
  const tone = rating === 1 ? 'var(--accent-text)' : 'var(--text)'
  return (
    <Tooltip label={t('cards.comesBack', { interval, key: rating })}>
      <motion.button
        type="button"
        onClick={onClick}
        whileTap={{ scale: 0.95 }}
        className={cx('flex min-w-[96px] flex-col items-center rounded-[16px] px-3 py-1.5 transition-colors hover:bg-fill1')}
      >
        <span className="flex items-center gap-1.5 t-ui font-semibold" style={{ color: tone }}>
          <KeyCap className="h-[18px] min-w-[18px] text-[11px]">{rating}</KeyCap>
          {t(`cards.rating.${key}`)}
        </span>
        <span className="t-footnote tabular text-text3">{interval}</span>
      </motion.button>
    </Tooltip>
  )
}

/** La tarjeta: gira sobre su eje vertical con perspectiva; cara y reverso en serif de lectura. */
function FlipCard({ card, flipped, onFlip, ink, assetUrl }: { card: Flashcard; flipped: boolean; onFlip: () => void; ink: string; assetUrl: (a: string) => string }) {
  const { t } = useTranslation('study')
  const { reducedMotion } = useTheme()
  const front = card.kind === 'cloze' ? clozeText(card.front, false) : card.front
  const revealedFront = card.kind === 'cloze' ? clozeText(card.front, true) : card.front
  const face = 'absolute inset-0 isolate overflow-hidden flex flex-col items-center justify-center gap-4 rounded-[28px] border-[0.5px] border-line bg-surface px-10 py-10 text-center [backface-visibility:hidden]'
  const figure = card.figure?.asset ? (
    <div className="relative w-full max-w-[420px] overflow-hidden rounded-[16px] bg-sunken" style={{ aspectRatio: String(card.figure.aspect ?? 4 / 3) }}>
      <img src={assetUrl(card.figure.asset)} alt={card.figure.alt} className="absolute inset-0 h-full w-full object-contain" />
      {card.figure.parts.filter((p) => p.id === card.figure!.target).map((p) => (
        <span key={p.id} className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, borderColor: 'var(--accent)', boxShadow: '0 0 0 4px var(--accent-wash)' }} />
      ))}
    </div>
  ) : null
  return (
    <div className="w-full max-w-[640px] [perspective:1600px]">
      <motion.div
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        aria-label={flipped ? t('cards.back') : t('cards.front')}
        onClick={onFlip}
        initial={reducedMotion ? false : { opacity: 0, y: 16, rotateX: -6 }}
        animate={{ opacity: 1, y: 0, rotateX: 0, rotateY: flipped ? 180 : 0 }}
        transition={{ rotateY: reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 20 }, default: { duration: 0.35, ease: [0.2, 0.7, 0.2, 1] } }}
        className="relative min-h-[340px] w-full cursor-pointer outline-none [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-accent-line rounded-[28px]"
        style={{ boxShadow: 'var(--e3)' }}
      >
        <div className={face}>
          <GlassLight color={ink} />
          <span className="t-eyebrow">{t('cards.front')}</span>
          {figure}
          <div className="t-reading text-[22px] leading-[32px] text-text"><RichText text={front} /></div>
        </div>
        <div className={face} style={{ transform: 'rotateY(180deg)' }}>
          <GlassLight color={ink} />
          <span className="t-eyebrow">{t('cards.back')}</span>
          {card.kind === 'cloze' ? (
            <div className="t-reading text-[22px] leading-[32px] text-text"><RichText text={revealedFront} /></div>
          ) : (
            <>
              <div className="t-callout text-text3 line-clamp-2"><RichText text={front} inline /></div>
              <div className="h-px w-16 bg-line" />
              <div className="t-reading text-[22px] leading-[32px] text-text"><RichText text={card.back} /></div>
            </>
          )}
          {card.kind === 'cloze' && card.back && <div className="t-callout text-text2"><RichText text={card.back} /></div>}
        </div>
      </motion.div>
    </div>
  )
}
