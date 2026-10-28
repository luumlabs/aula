// Practicar: la práctica mezclada (lo más flojo, intercalado) con la precisión reciente en una cifra que cuenta, cada tema
// con su dominio en un anillo y su precisión, y los últimos ejercicios hechos.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { Pack } from '@shared/schema'
import { skillMastery } from '@engine/study'
import { AnimatedNumber, Button, Card, cx, EmptyState, Floating, Group, Icon, PixelFlame, ProgressRing, Row, SectionTitle, Spinner, Stagger, StaggerItem } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtPercent, percentSuffix, relativeDay } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { useCourseData } from '@renderer/screens/study/data'
import { useInk } from '@renderer/screens/study/kit'
import { attemptStats, promptText } from '@renderer/screens/study/tabs'

export function PracticeTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation('study')
  const { data, status } = useCourseData(pack.id)
  const ink = useInk(pack)
  const now = useMemo(() => new Date(), [])
  if (!data) return status === 'loading' ? <div className="grid place-items-center py-16 text-text3"><Spinner size={18} /></div> : <EmptyState title={t('common.loadError')} />
  const { progress, skills } = data
  const recent = attemptStats(progress.attempts.filter((a) => a.mode !== 'exam').slice(-40))
  const bySkill = new Map(skills.map((s) => [s.id, attemptStats(progress.attempts.filter((a) => a.skill === s.id).slice(-20))]))
  const exercisesOf = (id: string): number => {
    const s = skills.find((x) => x.id === id)
    return s ? s.exercises.length + s.templates.length : 0
  }
  const last = [...progress.attempts].reverse().slice(0, 8)
  const exerciseById = (id: string, skill: string) => skills.find((s) => s.id === skill)?.exercises.find((e) => e.id === id)
  const start = (skill?: string): void => navigate({ name: 'study', id: pack.id, mode: 'practice', skill })
  // los temas más flojos (los no practicados primero): por ahí empieza la práctica mezclada
  const focus = skills
    .filter((s) => s.exercises.length + s.templates.length > 0)
    .map((s) => ({ id: s.id, title: s.title, mastery: skillMastery(progress.skills[s.id], now) }))
    .sort((a, b) => (a.mastery ?? -1) - (b.mastery ?? -1))
    .slice(0, 3)

  return (
    <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
      <StaggerItem className="col-span-12 @5xl:col-span-5">
        <Floating amplitude={2} duration={10} className="h-full">
          <Card padded="lg" mark={ink} elevation={2} className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="t-title2">{t('tab.practice.mixedTitle')}</h2>
                <p className="t-callout text-text2 mt-1 max-w-[360px]">{t('tab.practice.mixedBody')}</p>
              </div>
              <PixelFlame size={30} lit={recent.count > 0} />
            </div>
            <div className="mt-6 flex items-end gap-6">
              <div>
                <span className="font-serif text-[56px] leading-[56px] tracking-[-0.02em] tabular">
                  {recent.count ? <AnimatedNumber value={Math.round(recent.accuracy * 100)} /> : <span className="text-text3">–</span>}
                  <span className="text-[28px] text-text2">{percentSuffix()}</span>
                </span>
                <div className="t-caption mt-1">{recent.count ? t('tab.practice.recentAccuracy', { count: recent.count }) : t('tab.practice.noAttempts')}</div>
              </div>
              <div className="mb-1">
                <span className="t-number text-[26px] leading-[30px]"><AnimatedNumber value={progress.attempts.length} /></span>
                <div className="t-caption">{t('tab.practice.attempts', { count: progress.attempts.length })}</div>
              </div>
            </div>
            <RecentStrip credits={progress.attempts.filter((a) => a.mode !== 'exam').slice(-10).map((a) => a.credit)} ink={ink} />
            {focus.length > 0 && (
              <div className="mt-6 border-t-[0.5px] border-line-soft pt-4">
                <div className="t-ui font-semibold text-text2">{t('tab.practice.focus')}</div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {focus.map((f) => (
                    <li key={f.id} className="flex items-center gap-2.5 t-callout">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ink }} />
                      <span className="min-w-0 flex-1 truncate"><RichText text={f.title} inline /></span>
                      <span className="shrink-0 t-footnote tabular">{f.mastery === undefined ? t('tab.practice.notYet') : fmtPercent(f.mastery)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              <Button variant="primary" size="lg" icon={<Icon name="practice" size={16} />} onClick={() => start()}>{t('tab.practice.start')}</Button>
              {progress.mistakes.some((m) => !m.resolved) && (
                <Button variant="secondary" size="lg" icon={<Icon name="mistakes" size={15} />} onClick={() => navigate({ name: 'study', id: pack.id, mode: 'mistakes' })}>{t('tab.practice.mistakes')}</Button>
              )}
            </div>
          </Card>
        </Floating>
      </StaggerItem>

      <StaggerItem className="col-span-12 @5xl:col-span-7">
        <Card padded="lg" className="h-full">
          <SectionTitle title={t('tab.practice.byTopic')} detail={t('tab.practice.byTopicDetail')} />
          <Group inset={64} className="mt-2 shadow-none!">
            {skills.map((s, i) => {
              const m = skillMastery(progress.skills[s.id], now)
              const st = bySkill.get(s.id)
              return (
                <Row
                  key={s.id}
                  index={i}
                  onClick={() => start(s.id)}
                  leading={
                    <ProgressRing value={m ?? 0} size={34} stroke={3.5} color={ink}>
                      <span className="text-[10.5px] font-semibold tabular text-text2">{m === undefined ? '–' : Math.round(m * 100)}</span>
                    </ProgressRing>
                  }
                  title={<RichText text={s.title} inline />}
                  subtitle={[t('tab.practice.exercises', { count: exercisesOf(s.id) }), st?.count ? t('tab.practice.skillAccuracy', { pct: fmtPercent(st.accuracy) }) : t('tab.practice.notYet')].join(' · ')}
                  chevron
                />
              )
            })}
          </Group>
        </Card>
      </StaggerItem>

      {last.length > 0 && (
        <StaggerItem className="col-span-12">
          <Card padded="lg">
            <SectionTitle title={t('tab.practice.recent')} />
            <div className="mt-1 flex flex-col">
              {last.map((a) => {
                const ex = exerciseById(a.exerciseID, a.skill)
                const ok = a.credit >= 0.999
                return (
                  <div key={a.id} className="flex items-center gap-3 border-t-[0.5px] border-line-soft py-2.5 first:border-t-0">
                    <Icon name={ok ? 'check-circle' : a.credit > 0 ? 'alert' : 'alert-circle'} size={16} className={ok ? 'text-success' : a.credit > 0 ? 'text-warning' : 'text-danger'} />
                    <span className="min-w-0 flex-1 t-callout truncate"><RichText text={ex ? promptText(ex) : a.exerciseID} inline /></span>
                    <span className="hidden t-ui text-text3 @3xl:inline truncate max-w-[220px]"><RichText text={skills.find((s) => s.id === a.skill)?.title ?? ''} inline /></span>
                    <span className="w-12 text-right t-ui tabular text-text2">{fmtPercent(a.credit)}</span>
                    <span className="w-24 text-right t-footnote">{relativeDay(a.date)}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        </StaggerItem>
      )}
    </Stagger>
  )
}

/** Los últimos diez ejercicios como casillas que se encienden (acierto: tinta; parcial: media tinta; fallo: gris; sin hacer: hueco). */
function RecentStrip({ credits, ink }: { credits: number[]; ink: string }) {
  const { t } = useTranslation('study')
  return (
    <div className="mt-6">
      <div className="t-caption">{t('tab.practice.lastTen')}</div>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => {
          const c = credits[i]
          const bg = c === undefined ? undefined : c >= 0.999 ? ink : c > 0 ? `color-mix(in oklab, ${ink} 45%, transparent)` : 'var(--fill3)'
          return (
            <motion.span
              key={i}
              className={cx('h-[22px] flex-1 max-w-[26px] rounded-[6px]', c === undefined && 'border border-dashed border-line-strong/50')}
              style={{ background: bg }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.15 + i * 0.04 }}
            />
          )
        })}
      </div>
    </div>
  )
}
