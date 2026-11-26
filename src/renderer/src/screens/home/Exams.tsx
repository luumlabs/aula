// El examen más cercano, en una tarjeta serena que flota despacio: la cuenta atrás en serif con la tinta del curso (en
// ladrillo si faltan 3 días o menos), el icono vivo de la asignatura arriba a la derecha, la fecha y la nota probable.
import { useTranslation } from 'react-i18next'
import { AnimatedNumber, Card, Floating, PixelIcon, toneForHue, useTheme } from '@renderer/design'
import type { HomeExam } from '@shared/ipc/home'
import { capitalize, daysUntil, fmtDate, fmtPercent, fmtTime } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'

export function ExamCard({ exams }: { exams: HomeExam[] }) {
  const { t } = useTranslation('home')
  const { dark } = useTheme()
  const e = exams[0]
  if (!e) return null
  const tone = toneForHue(e.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const n = daysUntil(e.date)
  const more = exams.length - 1
  return (
    <div className="flex flex-col gap-2">
      <Floating amplitude={3} duration={7.5}>
        <Card enterAnim interactive padded={false} data-pixel-hover onClick={() => navigate({ name: 'course', id: e.courseId })} className="flex flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {n <= 1 ? (
                <span className="block font-serif text-[calc(30rem/15)] leading-[calc(36rem/15)] text-accent-text">{n <= 0 ? t('examToday') : t('examTomorrow')}</span>
              ) : (
                <span className="flex items-baseline gap-2">
                  <span className="font-serif text-[calc(44rem/15)] leading-[calc(46rem/15)] tracking-[-0.02em] tabular" style={{ color: n <= 3 ? 'var(--accent-text)' : ink }}>
                    <AnimatedNumber value={n} />
                  </span>
                  <span className="t-callout text-text2">{t('examDaysUntil', { count: n })}</span>
                </span>
              )}
            </div>
            <div className="-mt-1 -mr-1 shrink-0">
              <PixelIcon icon={e.icon} hue={e.hue} size={46} animation="drop" />
            </div>
          </div>
          <div className="mt-2 font-serif text-[calc(19rem/15)] leading-[calc(25rem/15)] text-text text-pretty">{e.title}</div>
          <div className="mt-1 t-ui text-text2">
            {capitalize(fmtDate(e.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · {fmtTime(e.date)}
          </div>
          <p className="t-marginal mt-3">{e.started ? t('examLikely', { low: fmtPercent(e.readinessLow), high: fmtPercent(e.readinessHigh) }) : t('examNotStarted')}</p>
        </Card>
      </Floating>
      {more > 0 && (
        <button type="button" className="self-start px-1 t-ui font-medium text-accent-text hover:underline underline-offset-2 outline-none focus-visible:underline" onClick={() => navigate({ name: 'calendar', view: 'agenda' })}>
          {t('examMore', { count: more })}
        </button>
      )}
    </div>
  )
}
