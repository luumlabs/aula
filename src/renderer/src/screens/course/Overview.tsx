// Resumen del curso: nota estimada (cifra serif que cuenta), el examen (tarjeta que flota), lo que toca ahora y el mapa del curso.
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AnimatedNumber, Button, Card, Companion, Floating, Group, Icon, ProgressBar, Row, SectionTitle, Stagger, toneForHue, useTheme, type IconName } from '@renderer/design'
import { COURSE_EDIT_EVENT } from './Actions'
import type { Pack } from '@shared/schema/pack'
import type { CourseOverview } from '@shared/ipc/course-view'
import type { PlanKind } from '@shared/ipc/home'
import { capitalize, fmtDate, fmtPercent, fmtTime, percentSuffix } from '@renderer/lib/format'
import { examStatus } from './examStatus'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { startPlanItem } from '../home/actions'

const KIND_ICON: Record<PlanKind, IconName> = { cards: 'cards', mistakes: 'mistakes', learn: 'learn', practice: 'practice', exam: 'exam', review: 'repeat' }
const LABEL_COLOR = { notStarted: 'var(--text3)', early: 'var(--warning)', gettingThere: 'var(--text)', almostReady: 'var(--success)', ready: 'var(--success)' }

export function Overview({ pack, ov }: { pack: Pack; ov: CourseOverview | null }) {
  const { t } = useTranslation(['course', 'common'])
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const planMinutes = ov?.plan.reduce((a, p) => a + p.minutes, 0) ?? 0
  // sin nada practicado aún, «0 %» no dice nada: se explica cuándo aparecerá la nota
  const fresh = !!ov && ov.attempts === 0 && ov.label === 'notStarted'
  return (
    <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
      <div className="col-span-12 @5xl:col-span-7">
        {/* si el examen de al lado es más alto, las cifras bajan al pie (sin hueco vacío al final) */}
        <Card enterAnim padded="lg" className="h-full flex flex-col">
          <div className="t-ui font-semibold text-text2">{t('readiness')}</div>
          <div className="flex items-end gap-3 mt-1">
            {fresh ? (
              <span className="font-serif text-[64px] leading-[64px] tracking-[-0.03em] text-text3">—</span>
            ) : (
              <span className="font-serif text-[64px] leading-[64px] tracking-[-0.03em] tabular">
                <AnimatedNumber value={Math.round((ov?.readiness ?? 0) * 100)} />
                <span className="text-[34px] text-text2"> %</span>
              </span>
            )}
            {ov && (
              <span className="mb-2 t-callout font-semibold" style={{ color: LABEL_COLOR[ov.label] }}>
                {t(`labels.${ov.label}`)}
              </span>
            )}
          </div>
          {ov && (
            <>
              {fresh ? (
                <div className="t-callout text-text2 mt-4">{t('freshReadiness')}</div>
              ) : (
                <>
                  <ProgressBar value={ov.readinessHigh} color={`color-mix(in oklab, ${ink} 30%, transparent)`} className="mt-4" height={6} />
                  <div className="-mt-[6px]">
                    <ProgressBar value={ov.readiness} color={ink} height={6} className="bg-transparent!" />
                  </div>
                  <div className="t-callout text-text2 mt-3">
                    {t('range', { low: fmtPercent(ov.readinessLow), high: fmtPercent(ov.readinessHigh) })} · {t('coverage', { pct: fmtPercent(ov.coverage) })}
                  </div>
                </>
              )}
              <TopicPixels pack={pack} ov={ov} />
              <div className="mt-auto" />
              <div className="grid grid-cols-4 mt-6 pt-5 border-t-[0.5px] border-line-soft">
                {[
                  { icon: 'cards' as IconName, v: ov.dueCards, l: t('statCards') },
                  { icon: 'mistakes' as IconName, v: ov.mistakes, l: t('statMistakes') },
                  { icon: 'check-circle' as IconName, v: Math.round(ov.accuracy * 100), l: t('statAccuracy'), suffix: percentSuffix() },
                  { icon: 'clock' as IconName, v: ov.minutesToday, l: t('statMinutes') }
                ].map((x, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <Icon name={x.icon} size={16} className="text-text3" />
                    <span className="t-number text-[24px] leading-7">
                      <AnimatedNumber value={x.v} suffix={x.suffix ?? ''} />
                    </span>
                    <span className="t-caption">{x.l}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="col-span-12 @5xl:col-span-5">
        <ExamCard pack={pack} ink={ink} />
      </div>

      <div className="col-span-12 @5xl:col-span-7">
        <Card enterAnim padded="lg" className="h-full flex flex-col">
          <SectionTitle title={t('now')} detail={ov?.plan.length ? t('nowDetail', { minutes: planMinutes }) : undefined} />
          {ov && !ov.plan.length ? (
            <p className="t-callout text-text2 mt-3">{t('nowEmpty')}</p>
          ) : (
            <Group inset={56} className="mt-3 shadow-none!">
              {(ov?.plan ?? []).map((p, i) => (
                <Row key={p.id} index={i} onClick={() => startPlanItem(p)} leading={<Icon name={KIND_ICON[p.kind]} size={18} />} title={p.title} subtitle={p.detail} trailing={t('minutes', { count: p.minutes })} chevron />
              ))}
            </Group>
          )}
          {/* al pie: empezar por lo primero, sin elegir */}
          {ov?.plan[0] && (
            <div className="mt-auto pt-5 flex items-center justify-between gap-3">
              <span className="t-footnote text-text3">{t('nowHint')}</span>
              <Button icon={<Icon name="play" size={14} />} onClick={() => startPlanItem(ov.plan[0])}>{t('studyNow')}</Button>
            </div>
          )}
        </Card>
      </div>

      <div className="col-span-12 @5xl:col-span-5">
        <CourseMap pack={pack} ov={ov} ink={ink} />
      </div>
    </Stagger>
  )
}

/** Nivel de dominio de un tema (0 sin ver … 4 dominado), con la rampa de ladrillo de Estadísticas. */
function topicLevel(s: { mastery: number; seen: boolean } | undefined): number {
  if (!s?.seen) return 0
  return s.mastery < 0.35 ? 1 : s.mastery < 0.6 ? 2 : s.mastery < 0.85 ? 3 : 4
}

/** Un píxel por tema, en el orden del curso: se encienden uno a uno con su nivel de dominio. */
function TopicPixels({ pack, ov }: { pack: Pack; ov: CourseOverview }) {
  const { t } = useTranslation('course')
  const byId = new Map(ov.skills.map((s) => [s.id, s]))
  const ids = pack.units.length ? pack.units.flatMap((u) => u.skillIDs) : pack.skills.map((s) => s.id)
  const topics = ids.map((id) => pack.skills.find((s) => s.id === id)).filter((s): s is Pack['skills'][number] => !!s)
  if (!topics.length) return null
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-ui font-semibold text-text2">{t('topicPixels')}</span>
        <span className="flex items-center gap-1.5 t-caption" aria-hidden>
          {t('pixelsFrom')}
          {[0, 1, 2, 3, 4].map((l) => <span key={l} className="w-2.5 h-2.5 rounded-[3px]" style={{ background: `var(--level-${l})` }} />)}
          {t('pixelsTo')}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {topics.map((s, i) => {
          const level = topicLevel(byId.get(s.id))
          return (
            <motion.button
              key={s.id}
              title={s.title}
              aria-label={`${s.title}: ${t(`pixelLevel.${level}`)}`}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.22, delay: 0.25 + i * 0.045, ease: [0.2, 0.7, 0.2, 1] }}
              whileHover={{ y: -2 }}
              onClick={() => navigate({ name: 'study', id: pack.id, mode: 'learn', skill: s.id })}
              className="w-7 h-7 rounded-[6px] outline-offset-2"
              style={{ background: `var(--level-${level})` }}
            />
          )
        })}
      </div>
    </div>
  )
}

function ExamCard({ pack, ink }: { pack: Pack; ink: string }) {
  const { t } = useTranslation(['course', 'common'])
  const exam = pack.exam
  const status = examStatus(exam?.date)
  const past = status?.phase === 'past'
  // un examen que ya pasó no flota ni pide atención: se queda quieto y propone seguir repasando o poner el siguiente
  const Wrap = past ? StillWrap : FloatWrap
  return (
    <Wrap>
      <Card enterAnim padded="lg" elevation={past ? 1 : 2} mark={past ? undefined : ink} className="h-full">
        <SectionTitle title={t('exam')} />
        {status?.phase === 'upcoming' ? (
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-serif text-[52px] leading-[52px] tracking-[-0.02em] tabular" style={{ color: status.days <= 3 ? 'var(--accent-text)' : ink }}>
              <AnimatedNumber value={status.days} />
            </span>
            <span className="t-callout text-text2">
              {t('days', { count: status.days })} {t('untilExam')}
            </span>
          </div>
        ) : status?.phase === 'today' ? (
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-serif text-[44px] leading-[52px] tracking-[-0.02em] text-accent-text">{t('common:time.today')}</span>
            {exam?.date && <span className="t-callout text-text2">{t('examTodayAt', { time: fmtTime(exam.date) })}</span>}
          </div>
        ) : status?.phase === 'past' ? (
          <div className="mt-2">
            <div className="font-serif text-[26px] leading-[32px] tracking-[-0.01em] text-text">
              {status.daysAgo === 0 ? t('examWasToday') : t('examWasAgo', { count: status.daysAgo })}
            </div>
            <p className="t-callout text-text2 mt-1.5 max-w-[440px]">{t('examPastBody')}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button size="sm" variant="secondary" icon={<Icon name="cards" size={14} />} onClick={() => navigate({ name: 'study', id: pack.id, mode: 'cards' })}>
                {t('keepReviewing')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Icon name="calendar" size={14} />} onClick={() => window.dispatchEvent(new Event(COURSE_EDIT_EVENT))}>
                {t('addNextExam')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <div className="t-callout text-text2">{pack.selfPaced || !exam ? t('selfPaced') : t('noExam')}</div>
            <Button size="sm" variant="secondary" className="mt-3" icon={<Icon name="calendar" size={14} />} onClick={() => window.dispatchEvent(new Event(COURSE_EDIT_EVENT))}>
              {t('addExamDate')}
            </Button>
            {/* sin examen: un compañero pixel-art que lee tranquilo, sin prisa */}
            <div className="flex justify-end mt-6 opacity-90">
              <Companion id="buho" size={64} />
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-[110px_1fr] gap-y-2 t-callout">
          {exam?.title && (
            <>
              <span className="text-text3">{t('exam')}</span>
              <span className="text-text">{exam.title}</span>
            </>
          )}
          {exam?.date && (
            <>
              <span className="text-text3">{t('date')}</span>
              <span>{capitalize(fmtDate(exam.date, { weekday: 'long', day: 'numeric', month: 'long' }))}, {fmtTime(exam.date)}</span>
            </>
          )}
          {exam?.durationMinutes ? (
            <>
              <span className="text-text3">{t('duration')}</span>
              <span>{exam.durationMinutes} min</span>
            </>
          ) : null}
          {exam?.totalPoints ? (
            <>
              <span className="text-text3">{t('points')}</span>
              <span className="tabular">{exam.totalPoints}</span>
            </>
          ) : null}
          {exam?.aids && (
            <>
              <span className="text-text3">{t('aids')}</span>
              <span>{exam.aids}</span>
            </>
          )}
        </div>
        {exam?.notes && (
          <div className="mt-4 rounded-[14px] bg-sunken p-3.5 t-callout text-text2">
            <div className="t-caption mb-1">{t('notes')}</div>
            <RichText text={exam.notes} />
          </div>
        )}
      </Card>
    </Wrap>
  )
}

function FloatWrap({ children }: { children: ReactNode }) {
  return (
    <Floating amplitude={3} duration={9} className="h-full">
      {children}
    </Floating>
  )
}

function StillWrap({ children }: { children: ReactNode }) {
  return <div className="h-full">{children}</div>
}

function CourseMap({ pack, ov, ink }: { pack: Pack; ov: CourseOverview | null; ink: string }) {
  const { t } = useTranslation('course')
  const mastery = new Map((ov?.skills ?? []).map((s) => [s.id, s.mastery]))
  return (
    <Card enterAnim padded="lg" className="h-full">
      <SectionTitle title={t('map')} />
      <div className="mt-2 flex flex-col gap-4">
        {pack.units.map((u, ui) => (
          <div key={u.id}>
            <div className="t-ui font-semibold text-text2 mb-1.5">
              {ui + 1}. {u.title}
            </div>
            <div className="flex flex-col gap-1">
              {u.skillIDs.map((sid, i) => {
                const s = pack.skills.find((x) => x.id === sid)
                if (!s) return null
                const m = mastery.get(sid) ?? 0
                return (
                  <motion.button
                    key={sid}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 + (ui * 3 + i) * 0.03 }}
                    onClick={() => navigate({ name: 'study', id: pack.id, mode: 'learn', skill: sid })}
                    className="group grid grid-cols-[1fr_88px] items-center gap-3 rounded-[10px] px-2 py-1.5 text-left hover:bg-fill1"
                  >
                    <span className="t-callout truncate">
                      <RichText text={s.title} inline />
                    </span>
                    <span className="flex items-center gap-2">
                      <ProgressBar value={m} color={ink} />
                      {m >= 0.85 && <Icon name="check" size={13} className="text-success shrink-0" />}
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

