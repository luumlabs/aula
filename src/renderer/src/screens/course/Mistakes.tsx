// Errores: el cuaderno de errores. Cada ejercicio fallado con lo que escribiste, la respuesta correcta y por qué; vuelve a
// los 1, 3, 7, 16 y 35 días y, si lo aciertas en todos esos repasos, queda resuelto. Repasar los de hoy o todos, por tema.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Pack } from '@shared/schema'
import { mistakesNotebook, type MistakeView } from '@engine/study'
import { AnimatedNumber, Button, Card, cx, EmptyState, Floating, Icon, SegmentedTabs, Spinner, Stagger, StaggerItem, toast } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { correctAnswer } from '@renderer/exercises'
import i18n from '@renderer/i18n'
import { updateProgress, useCourseData } from '@renderer/screens/study/data'
import { useInk } from '@renderer/screens/study/kit'
import { promptText } from '@renderer/screens/study/tabs'

export function MistakesTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation('study')
  const { data, status } = useCourseData(pack.id)
  const ink = useInk(pack)
  const [filter, setFilter] = useState<'due' | 'all'>('all')
  const now = useMemo(() => new Date(), [])
  const list = useMemo(() => {
    if (!data) return []
    try {
      return mistakesNotebook(data.progress, data.skills, now)
    } catch {
      return []
    }
  }, [data, now])
  if (!data) return status === 'loading' ? <div className="grid place-items-center py-16 text-text3"><Spinner size={18} /></div> : <EmptyState title={t('common.loadError')} />
  const due = list.filter((m) => m.due)
  const resolved = data.progress.mistakes.filter((m) => m.resolved).length
  if (!list.length)
    return <EmptyState title={t('tab.mistakes.emptyTitle')} body={resolved ? t('tab.mistakes.emptyResolved', { count: resolved }) : t('mistakes.nothingBody')} />
  const shown = filter === 'due' ? due : list
  const groups = data.skills.map((s) => ({ skill: s, items: shown.filter((m) => m.entry.skill === s.id) })).filter((g) => g.items.length)
  const resolve = (m: MistakeView): void => {
    updateProgress(pack.id, (p) => ({ ...p, mistakes: p.mistakes.map((x) => (x.id === m.entry.id ? { ...x, resolved: true } : x)) }), { kind: 'save' })
    toast.success(t('tab.mistakes.resolved'), t('tab.mistakes.resolvedBody'))
  }

  return (
    <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
      {/* el resumen no se estira junto a un cuaderno largo: se queda a la vista mientras bajas */}
      <StaggerItem className="col-span-12 @5xl:col-span-5 @5xl:self-start @5xl:sticky @5xl:top-2 z-[1]">
        <Floating amplitude={2} duration={10}>
          <Card padded="lg" mark={ink} elevation={2} className="flex flex-col">
            <div className="t-ui font-semibold text-text2">{t('tab.mistakes.today')}</div>
            <div className="mt-1 flex items-end gap-3">
              <span className="font-serif text-[64px] leading-[64px] tracking-[-0.03em] tabular"><AnimatedNumber value={due.length} /></span>
              <span className="mb-2 t-callout text-text2">{t('tab.mistakes.toReview', { count: due.length })}</span>
            </div>
            <p className="t-callout text-text2 mt-3">{t('tab.mistakes.how')}</p>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t-[0.5px] border-line-soft pt-4">
              {[
                { v: list.length, l: t('tab.mistakes.open') },
                { v: due.length, l: t('tab.mistakes.forToday') },
                { v: resolved, l: t('tab.mistakes.resolvedN') }
              ].map((x, i) => (
                <div key={i}>
                  <span className="t-number text-[24px] leading-[28px]"><AnimatedNumber value={x.v} /></span>
                  <div className="t-caption">{x.l}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-6">
              <Button variant="primary" size="lg" icon={<Icon name="mistakes" size={15} />} disabled={!due.length} onClick={() => navigate({ name: 'study', id: pack.id, mode: 'mistakes' })}>{t('tab.mistakes.reviewToday', { count: due.length })}</Button>
            </div>
          </Card>
        </Floating>
      </StaggerItem>

      <StaggerItem className="col-span-12 @5xl:col-span-7">
        <Card padded="lg" className="h-full">
          <div className="flex items-center justify-between gap-3">
            <h2 className="t-title2">{t('tab.mistakes.notebook')}</h2>
            <SegmentedTabs size="sm" value={filter} onChange={setFilter} items={[{ id: 'all', label: t('tab.mistakes.all'), badge: list.length }, { id: 'due', label: t('tab.mistakes.dueOnly'), badge: due.length }]} />
          </div>
          {groups.length === 0 ? (
            <p className="t-callout text-text2 mt-4">{t('tab.mistakes.noneDue')}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-5">
              {groups.map((g) => (
                <section key={g.skill.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="t-ui font-semibold text-text2 truncate"><RichText text={g.skill.title} inline /></span>
                    <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'study', id: pack.id, mode: 'mistakes', skill: g.skill.id })}>{t('tab.mistakes.practiceThese')}</Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {g.items.map((m, i) => <MistakeRow key={m.entry.id} m={m} index={i} onResolve={() => resolve(m)} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Card>
      </StaggerItem>
    </Stagger>
  )
}

function MistakeRow({ m, index, onResolve }: { m: MistakeView; index: number; onResolve: () => void }) {
  const { t } = useTranslation('study')
  const [open, setOpen] = useState(false)
  const ex = m.exercise
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 10) * 0.03 }} className="rounded-[16px] border-[0.5px] border-line bg-surface" style={{ boxShadow: 'var(--e1)' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', m.due ? 'bg-accent' : 'bg-fill4')} />
        <span className="min-w-0 flex-1">
          <span className="block t-callout line-clamp-2">{ex ? <RichText text={promptText(ex)} inline /> : <span className="text-text3">{t('tab.mistakes.gone')}</span>}</span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 t-footnote">
            <span>{t('mistakes.failedTimes', { count: m.entry.count })}</span>
            <span>{t('mistakes.stage', { n: Math.min(m.entry.stage + 1, 5), m: 5 })}</span>
            <span className={m.due ? 'text-accent-text font-semibold' : ''}>{m.due ? t('tab.mistakes.dueNow') : t('tab.mistakes.inDays', { count: m.inDays })}</span>
          </span>
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="mt-1 text-text3" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-2 border-t-[0.5px] border-line-soft px-4 py-3 t-callout">
              {m.entry.lastInput && (
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <span className="text-text3">{t('tab.mistakes.wrote')}</span>
                  <span className="text-danger"><RichText text={m.entry.lastInput} inline /></span>
                </div>
              )}
              {ex && (
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <span className="text-text3">{t('tab.mistakes.correct')}</span>
                  <span className="text-success"><RichText text={correctAnswer(ex, i18n.language)} inline /></span>
                </div>
              )}
              {m.entry.why && <div className="rounded-[12px] bg-fill1 px-3 py-2 text-text2"><RichText text={m.entry.why} /></div>}
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" icon={<Icon name="check" size={13} />} onClick={onResolve} title={t('tab.mistakes.resolveHelp')}>{t('tab.mistakes.resolve')}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
