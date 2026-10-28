// Simulacro: el modelo del examen (preguntas, duración, puntos y secciones), los simulacros hechos con su nota (barras que
// se llenan y la evolución) y empezar uno (o continuar el que está a medias).
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { Pack } from '@shared/schema'
import { examPercent } from '@shared/schema'
import { examBlueprint } from '@engine/study'
import { AnimatedNumber, Button, Card, Companion, EmptyState, Floating, Icon, ProgressBar, SectionTitle, Spinner, Stagger, StaggerItem } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtDate, fmtPercent, percentSuffix } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { useCourseData } from '@renderer/screens/study/data'
import { useInk } from '@renderer/screens/study/kit'

export function ExamTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation('study')
  const { data, status } = useCourseData(pack.id)
  const ink = useInk(pack)
  if (!data) return status === 'loading' ? <div className="grid place-items-center py-16 text-text3"><Spinner size={18} /></div> : <EmptyState title={t('common.loadError')} />
  const bp = examBlueprint(pack)
  const questions = bp.sections.reduce((a, s) => a + s.count, 0)
  const points = bp.sections.reduce((a, s) => a + s.count * s.pointsEach, 0)
  const past = data.progress.exams.filter((e) => e.kind !== 'diagnostic').sort((a, b) => (a.date < b.date ? -1 : 1))
  const best = past.reduce((m, e) => Math.max(m, examPercent(e)), 0)
  const lastPct = past.length ? examPercent(past[past.length - 1]) : null
  const pending = data.progress.examRun
  const title = (id: string): string => data.skills.find((s) => s.id === id)?.title ?? pack.skills.find((s) => s.id === id)?.title ?? id
  const go = (): void => navigate({ name: 'study', id: pack.id, mode: 'exam' })

  return (
    <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
      <StaggerItem className="col-span-12 @5xl:col-span-7">
        <Card padded="lg" className="flex h-full flex-col">
          <div className="t-eyebrow">{pack.exam?.title ?? t('exam.title')}</div>
          <h2 className="t-title1 mt-1">{t('exam.mockTitle')}</h2>
          <p className="t-callout text-text2 mt-1 max-w-[520px]">{t('exam.lead')}</p>
          <div className="mt-5 grid grid-cols-3 gap-4 border-t-[0.5px] border-line-soft pt-5">
            {[
              { v: questions, l: t('exam.questions', { count: questions }) },
              { v: bp.durationMinutes, l: t('exam.minutes') },
              { v: Math.round(points), l: t('exam.points') }
            ].map((x, i) => (
              <div key={i}>
                <span className="t-number text-[30px] leading-[34px]"><AnimatedNumber value={x.v} /></span>
                <div className="t-caption">{x.l}</div>
              </div>
            ))}
          </div>
          {pending && (
            <div className="mt-5 flex items-center gap-3 rounded-[16px] bg-accent-wash px-4 py-3">
              <Icon name="clock" size={17} className="text-accent-text" />
              <span className="min-w-0 flex-1 t-callout">{t('tab.exam.pending', { answered: pending.items.filter((i) => i.answer !== undefined && i.answer !== null).length, total: pending.items.length })}</span>
            </div>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <Button variant="primary" size="lg" icon={<Icon name="play" size={15} />} disabled={!questions} onClick={go}>{pending ? t('exam.resume') : t('exam.start')}</Button>
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem className="col-span-12 @5xl:col-span-5">
        <Floating amplitude={2} duration={10} className="h-full">
          <Card padded="lg" mark={ink} elevation={2} className="flex h-full flex-col">
            <SectionTitle title={t('tab.exam.results')} />
            {past.length === 0 ? (
              <>
                <p className="t-callout text-text2 mt-1">{t('exam.noPast')}</p>
                {/* sin simulacros: barras en blanco que esperan nota y un compañero que cronometra */}
                <div className="mt-auto flex items-end gap-4 pt-6">
                  <div className="flex h-[64px] flex-1 items-end gap-1.5" aria-hidden>
                    {[0.35, 0.5, 0.42, 0.62, 0.55, 0.74, 0.68, 0.86].map((h, i) => (
                      <motion.span key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.4, delay: 0.15 + i * 0.04, ease: [0.2, 0.7, 0.2, 1] }}
                        className="flex-1 origin-bottom rounded-[4px] border border-dashed border-line-strong/60" style={{ height: `${h * 100}%` }} />
                    ))}
                  </div>
                  <Companion role="formulas" size={56} />
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 flex items-end gap-6">
                  <div>
                    <span className="font-serif text-[52px] leading-[52px] tabular"><AnimatedNumber value={Math.round((lastPct ?? 0) * 100)} /><span className="text-[26px] text-text2"> %</span></span>
                    <div className="t-caption">{t('tab.exam.last')}</div>
                  </div>
                  <div className="mb-1">
                    <span className="t-number text-[24px] leading-[28px]"><AnimatedNumber value={Math.round(best * 100)} suffix={percentSuffix()} /></span>
                    <div className="t-caption">{t('tab.exam.best')}</div>
                  </div>
                </div>
                <ScoreBars scores={past.slice(-12).map((e) => examPercent(e))} ink={ink} pass={bp.passPercent} />
                <div className="mt-3 flex flex-col">
                  {[...past].reverse().slice(0, 4).map((e) => (
                    <div key={e.id} className="flex items-center gap-3 border-t-[0.5px] border-line-soft py-2 first:border-t-0">
                      <span className="w-[140px] t-footnote">{fmtDate(e.date, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                      <ProgressBar value={examPercent(e)} color={ink} height={5} />
                      <span className="w-12 text-right t-ui tabular">{fmtPercent(examPercent(e))}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </Floating>
      </StaggerItem>

      <StaggerItem className="col-span-12">
        <Card padded="lg">
          <SectionTitle title={t('exam.sections')} />
          <div className="mt-2 grid grid-cols-1 gap-3 @3xl:grid-cols-2">
            {bp.sections.map((s, i) => (
              <div key={i} className="rounded-[16px] bg-sunken px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-headline"><RichText text={s.title} inline /></span>
                  <span className="shrink-0 t-ui tabular text-text2">{t('exam.sectionMeta', { count: s.count, points: s.pointsEach })}</span>
                </div>
                <div className="t-footnote mt-1">{s.skillIDs.map(title).join(' · ')}</div>
              </div>
            ))}
          </div>
          {bp.instructions && <div className="mt-4 t-callout text-text2"><RichText text={bp.instructions} /></div>}
        </Card>
      </StaggerItem>
    </Stagger>
  )
}

/** Notas de los simulacros como barras que crecen (la última con la tinta del curso; la nota de corte, una línea). */
function ScoreBars({ scores, ink, pass }: { scores: number[]; ink: string; pass?: number }) {
  return (
    <div className="relative mt-5 flex h-[84px] items-end gap-1.5" aria-hidden>
      {pass !== undefined && <span className="absolute inset-x-0 border-t border-dashed border-line-strong/50" style={{ bottom: `${pass * 100}%` }} />}
      {scores.map((s, i) => (
        <motion.span
          key={i}
          className="flex-1 rounded-t-[5px]"
          style={{ background: i === scores.length - 1 ? ink : `color-mix(in oklab, ${ink} 35%, transparent)`, maxWidth: 28 }}
          initial={{ height: 0 }}
          animate={{ height: `${Math.max(4, s * 100)}%` }}
          transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: [0.2, 0.7, 0.2, 1] }}
        />
      ))}
    </div>
  )
}
