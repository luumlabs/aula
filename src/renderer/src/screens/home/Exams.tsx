// Próximos exámenes: tarjetas que flotan despacio, con la cuenta atrás en serif y la nota estimada.
import { useTranslation } from 'react-i18next'
import { Card, Floating, ProgressBar, ProgressRing, CourseIcon, toneForHue, AnimatedNumber, LiveDot, useTheme, cx } from '@renderer/design'
import type { HomeExam } from '@shared/ipc/home'
import { daysUntil, fmtDate, fmtPercent, fmtTime } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { SampleTag, showsAsSample } from '@renderer/lib/sample'

export function ExamCards({ exams }: { exams: HomeExam[] }) {
  const { t } = useTranslation('home')
  const { dark } = useTheme()
  if (!exams.length) return null
  // las tarjetas reparten la fila: un examen solo la ocupa entera y enseña también cuánto temario llevas
  const wide = exams.length === 1
  return (
    <div className={cx('grid gap-4 grid-cols-1', exams.length === 2 && '@2xl:grid-cols-2', exams.length >= 3 && '@2xl:grid-cols-2 @5xl:grid-cols-3')}>
      {exams.slice(0, 3).map((e, i) => {
        const tone = toneForHue(e.hue)
        const ink = dark ? tone.inkDark : tone.inkLight
        const n = daysUntil(e.date)
        // el examen del curso de ejemplo se ve, pero marcado: no es del estudiante (A4-P1-1)
        const sample = showsAsSample(e.courseId)
        const urgent = n <= 3 && !sample
        return (
          <Floating key={e.courseId + e.date} amplitude={3} duration={7 + i * 1.5} phase={i * 1.1}>
            <Card enterAnim interactive padded={false} mark={ink} onClick={() => navigate({ name: 'course', id: e.courseId })} className="h-full">
              <div className="flex items-center gap-4 p-5 pl-6">
                <div className="flex flex-col items-center justify-center w-[64px] shrink-0">
                  {n <= 0 ? (
                    <span className="font-serif text-[24px] leading-7 text-accent-text">{t('examToday')}</span>
                  ) : n === 1 ? (
                    <span className="font-serif text-[22px] leading-7 text-accent-text">{t('examTomorrow')}</span>
                  ) : (
                    <>
                      <span className="font-serif text-[46px] leading-[46px] tracking-[-0.02em] tabular" style={{ color: urgent ? 'var(--accent-text)' : ink }}>
                        <AnimatedNumber value={n} />
                      </span>
                      <span className="t-caption mt-0.5">{t('examIn')}</span>
                    </>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <CourseIcon icon={e.icon} hue={e.hue} size={20} radius={6} title={e.courseTitle} />
                    <span className="t-ui text-text2 truncate">{e.courseTitle}</span>
                    {sample && <SampleTag />}
                    {urgent && <LiveDot color="var(--accent)" size={6} />}
                  </div>
                  <div className="t-headline mt-1 truncate">{e.title}</div>
                  <div className="t-ui text-text3 mt-0.5 truncate">
                    {fmtDate(e.date, wide ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' })}, {fmtTime(e.date)}
                  </div>
                </div>
                {wide && (
                  <div className="hidden @3xl:block w-[34%] shrink-0 pr-4">
                    <div className="flex items-baseline justify-between t-ui">
                      <span className="text-text2">{t('examCoverage')}</span>
                      <span className="tabular text-text3">{fmtPercent(e.coverage)}</span>
                    </div>
                    <ProgressBar value={e.coverage} color={ink} height={5} className="mt-1.5" />
                    <div className="t-footnote text-text3 mt-1.5">{e.started ? t('examRange', { low: fmtPercent(e.readinessLow), high: fmtPercent(e.readinessHigh) }) : t('examNotStarted')}</div>
                  </div>
                )}
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <ProgressRing value={e.started ? e.readiness : 0} ghost={e.started ? e.readinessHigh : undefined} size={46} stroke={4} color={ink}>
                    <span className="t-ui font-semibold tabular">
                      {e.started ? <AnimatedNumber value={Math.round(e.readiness * 100)} /> : <span className="text-text3">—</span>}
                    </span>
                  </ProgressRing>
                  <span className="t-caption">{t('readinessShort')}</span>
                </div>
              </div>
            </Card>
          </Floating>
        )
      })}
    </div>
  )
}
