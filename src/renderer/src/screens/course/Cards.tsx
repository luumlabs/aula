// Tarjetas: las que tocan hoy (una cifra serif que cuenta y «Repasar ahora»), los mazos por tema con sus vencidas y
// nuevas, y todas las tarjetas para hojear y buscar (pulsar una la gira).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { Flashcard, Pack } from '@shared/schema'
import { clozeText, dueCardCount, dueCards } from '@engine/study'
import { AnimatedNumber, Button, Card, cx, EmptyState, Floating, GlassLight, Icon, SectionTitle, Spinner, Stagger, StaggerItem, TextField, useTheme } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { useCourseData } from '@renderer/screens/study/data'
import { useInk } from '@renderer/screens/study/kit'
import { cardState, searchKey } from '@renderer/screens/study/tabs'

export function CardsTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation('study')
  const { data, status } = useCourseData(pack.id)
  const ink = useInk(pack)
  const [q, setQ] = useState('')
  const now = useMemo(() => new Date(), [])
  const counts = useMemo(() => {
    if (!data) return null
    try {
      const queue = dueCards(data.pack, data.skills, data.progress, { now })
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(23, 0, 0, 0)
      return { due: dueCardCount(data.pack, data.skills, data.progress, now), fresh: queue.filter((c) => c.isNew).length, tomorrow: dueCardCount(data.pack, data.skills, data.progress, tomorrow) }
    } catch {
      return { due: 0, fresh: 0, tomorrow: 0 }
    }
  }, [data, now])
  if (!data || !counts) return status === 'loading' ? <div className="grid place-items-center py-16 text-text3"><Spinner size={18} /></div> : <EmptyState title={t('common.loadError')} />
  const all = data.skills.flatMap((s) => s.cards.map((c) => ({ card: c, skill: s })))
  if (!all.length) return <EmptyState title={t('tab.cards.emptyTitle')} body={t('tab.cards.emptyBody')} />
  const key = searchKey(q.trim())
  const shown = key ? all.filter(({ card }) => searchKey(`${card.front} ${card.back}`).includes(key)) : all
  const study = (skill?: string): void => navigate({ name: 'study', id: pack.id, mode: 'cards', skill })
  const total = counts.due + counts.fresh

  return (
    <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
      <StaggerItem className="col-span-12 @5xl:col-span-5">
        <Floating amplitude={2} duration={10} className="h-full">
          <Card padded="lg" mark={ink} elevation={2} className="flex h-full flex-col">
            <div className="t-ui font-semibold text-text2">{t('tab.cards.today')}</div>
            <div className="mt-1 flex items-end gap-3">
              <span className="font-serif text-[64px] leading-[64px] tracking-[-0.03em] tabular"><AnimatedNumber value={total} /></span>
              <span className="mb-2 t-callout text-text2">{t('tab.cards.toReview', { count: total })}</span>
            </div>
            <div className="t-callout text-text2 mt-2">{`${t('tab.cards.dueN', { count: counts.due })} · ${t('tab.cards.newN', { count: counts.fresh })}`}</div>
            <FannedDeck ink={ink} count={Math.min(5, Math.max(1, total))} />
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
              <Button variant="primary" size="lg" icon={<Icon name="cards" size={16} />} disabled={total === 0} onClick={() => study()}>{t('tab.cards.reviewNow')}</Button>
              <span className="t-footnote">{counts.tomorrow ? t('tab.cards.tomorrow', { count: counts.tomorrow }) : t('tab.cards.tomorrowNone')}</span>
            </div>
          </Card>
        </Floating>
      </StaggerItem>

      <StaggerItem className="col-span-12 @5xl:col-span-7">
        <Card padded="lg" className="h-full">
          <SectionTitle title={t('tab.cards.decks')} detail={t('tab.cards.decksDetail', { count: all.length })} />
          <div className="mt-2 grid grid-cols-1 gap-2 @3xl:grid-cols-2">
            {data.skills.filter((s) => s.cards.length).map((s) => {
              const seen = s.cards.filter((c) => (data.progress.cards[c.id]?.reps ?? 0) > 0)
              const due = seen.filter((c) => cardState(data.progress.cards[c.id], now).inDays === 0).length
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  whileHover={{ y: -2 }}
                  onClick={() => study(s.id)}
                  className="flex flex-col gap-2 rounded-[16px] border-[0.5px] border-line bg-sunken px-4 py-3 text-left transition-colors hover:bg-fill1"
                >
                  <span className="t-callout font-medium line-clamp-2"><RichText text={s.title} inline /></span>
                  <span className="flex items-center gap-3 t-footnote">
                    <span>{t('tab.cards.cards', { count: s.cards.length })}</span>
                    {due > 0 && <span className="text-accent-text font-semibold">{t('tab.cards.dueN', { count: due })}</span>}
                    {s.cards.length - seen.length > 0 && <span>{t('tab.cards.newN', { count: s.cards.length - seen.length })}</span>}
                  </span>
                  <span className="relative h-[4px] w-full overflow-hidden rounded-full bg-fill2">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(seen.length / s.cards.length) * 100}%`, background: ink }} />
                  </span>
                </motion.button>
              )
            })}
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem className="col-span-12">
        <Card padded="lg">
          <SectionTitle
            title={t('tab.cards.all')}
            detail={key ? t('tab.cards.found', { count: shown.length }) : undefined}
            action={<div className="w-[260px]"><TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tab.cards.search')} icon={<Icon name="search" size={15} />} /></div>}
          />
          <div className="mt-3 grid grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
            {shown.slice(0, 120).map(({ card, skill }) => (
              <MiniCard key={card.id} card={card} skillTitle={skill.title} state={cardState(data.progress.cards[card.id], now)} ink={ink} />
            ))}
          </div>
          {shown.length > 120 && <p className="t-footnote mt-3 text-center">{t('tab.cards.more', { count: shown.length - 120 })}</p>}
        </Card>
      </StaggerItem>
    </Stagger>
  )
}

/** Un mazo pixel-plano en abanico (decoración de la tarjeta de hoy). */
function FannedDeck({ ink, count }: { ink: string; count: number }) {
  const { reducedMotion } = useTheme()
  return (
    <div className="relative mx-auto mt-6 h-[92px] w-[200px]" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const mid = (count - 1) / 2
        const rot = (i - mid) * 7
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-2 h-[78px] w-[58px] rounded-[10px] border-[0.5px] border-line bg-raised"
            style={{ boxShadow: 'var(--e2)', marginLeft: -29, transformOrigin: '50% 140%' }}
            initial={reducedMotion ? false : { rotate: 0, y: 10, opacity: 0 }}
            animate={{ rotate: rot, y: Math.abs(i - mid) * 3, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 18, delay: 0.15 + i * 0.05 }}
          >
            <span className="absolute left-2 right-2 top-3 h-[3px] rounded-full" style={{ background: i === count - 1 ? ink : 'var(--fill3)' }} />
            <span className="absolute left-2 right-5 top-[22px] h-[3px] rounded-full bg-fill3" />
            <span className="absolute left-2 right-8 top-[31px] h-[3px] rounded-full bg-fill3" />
          </motion.div>
        )
      })}
    </div>
  )
}

function MiniCard({ card, skillTitle, state, ink }: { card: Flashcard; skillTitle: string; state: ReturnType<typeof cardState>; ink: string }) {
  const { t } = useTranslation('study')
  const [flip, setFlip] = useState(false)
  const front = card.kind === 'cloze' ? clozeText(card.front, false) : card.front
  const back = card.kind === 'cloze' ? clozeText(card.front, true) : card.back
  const label = state.state === 'new' ? t('tab.cards.stateNew') : state.inDays === 0 ? t('tab.cards.stateDue') : t('tab.cards.stateIn', { count: state.inDays })
  return (
    <button
      type="button"
      onClick={() => setFlip((f) => !f)}
      aria-pressed={flip}
      className="group relative isolate overflow-hidden flex min-h-[132px] flex-col gap-2 rounded-[18px] border-[0.5px] border-line bg-surface px-4 py-3.5 text-left transition-shadow hover:shadow-[var(--e2)]"
      style={{ boxShadow: 'var(--e1)' }}
    >
      <span className="flex items-center gap-2 t-footnote">
        <span className="min-w-0 flex-1 truncate"><RichText text={skillTitle} inline /></span>
        <span className={cx('shrink-0 rounded-full px-2 py-0.5 t-caption font-semibold', state.state === 'new' ? 'bg-accent-wash text-accent-text' : state.inDays === 0 ? 'bg-warning-soft text-warning' : 'bg-fill2 text-text2')}>{label}</span>
      </span>
      <motion.span key={flip ? 'b' : 'f'} initial={{ opacity: 0, rotateX: -20 }} animate={{ opacity: 1, rotateX: 0 }} transition={{ duration: 0.25 }} className="block font-serif text-[16px] leading-[24px] text-text line-clamp-4">
        <RichText text={flip ? back : front} inline />
      </motion.span>
      <span className="mt-auto flex items-center gap-1.5 t-caption text-text3 opacity-0 transition-opacity group-hover:opacity-100">
        <Icon name="repeat" size={11} />
        {flip ? t('tab.cards.showFront') : t('tab.cards.showBack')}
      </span>
      {/* dada la vuelta, la luz del curso asoma tras la ficha */}
      {flip && <GlassLight color={ink} size="sm" still />}
    </button>
  )
}
