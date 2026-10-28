// Nota estimada de cada curso: la cifra grande en serif con su intervalo y la evolución (línea que se dibuja, banda del
// intervalo, raya de «Aprobado» y, si el examen está cerca, la del examen).
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, CourseIcon, AnimatedNumber, Chip, toneForHue, useTheme } from '@renderer/design'
import { daysUntil, fmtDate, fmtPercent } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import type { StatsCourse } from '@shared/ipc/stats'
import { bandPath, monotonePath } from './chart'
import { keyToDate } from './derive'

const PASS = 0.6
const H = 200
const PAD = { left: 38, right: 14, top: 16, bottom: 24 }

export function ScoreCard({ course, index }: { course: StatsCourse; index: number }) {
  const { t } = useTranslation('stats')
  const { dark } = useTheme()
  const tone = toneForHue(course.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const e = course.expected
  return (
    <Card enterAnim interactive className="h-full flex flex-col" onClick={() => navigate({ name: 'course', id: course.id })} aria-label={t('score.open', { course: course.title })}>
      <div className="flex items-center gap-3">
        <CourseIcon icon={course.icon} hue={course.hue} size={36} animation="drop" />
        <div className="min-w-0 flex-1">
          <div className="t-headline text-text truncate">{course.title}</div>
          <div className="t-footnote text-text3">{t('score.title')}</div>
        </div>
        <Chip>{t(`score.labels.${course.label}`)}</Chip>
      </div>
      {e != null ? (
        <div className="mt-4 flex items-baseline gap-3 flex-wrap">
          <span className="font-serif text-[48px] leading-[50px] tracking-[-0.02em] tabular" style={{ color: ink }}>
            <AnimatedNumber value={Math.round(e * 100)} />
            <span className="text-[0.5em] ml-0.5">%</span>
          </span>
          <span className="t-callout text-text2">
            {t('score.between', { low: fmtPercent(course.low), high: fmtPercent(course.high) })} · {t('score.covered', { percent: fmtPercent(course.coverage) })}
          </span>
        </div>
      ) : (
        <p className="t-body text-text2 mt-4">{t('score.noEstimate')}</p>
      )}
      <div className="mt-3 flex-1">
        {course.history.length >= 2 ? <ScoreChart course={course} ink={ink} delay={0.2 + index * 0.12} /> : e != null ? <p className="t-footnote text-text3">{t('score.needTwoDays')}</p> : null}
      </div>
    </Card>
  )
}

function ScoreChart({ course, ink, delay }: { course: StatsCourse; ink: string; delay: number }) {
  const { t } = useTranslation('stats')
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setW(Math.max(200, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const hist = course.history
  const t0 = keyToDate(hist[0].date).getTime()
  const tLast = keyToDate(hist[hist.length - 1].date).getTime()
  const examIn = course.examDate ? daysUntil(course.examDate) : null
  const exam = course.examDate && examIn != null && examIn >= 0 && examIn <= 60 ? new Date(course.examDate).getTime() : null
  const t1 = Math.max(tLast, exam ?? 0, t0 + 86400000)
  const x = (ms: number) => PAD.left + ((ms - t0) / (t1 - t0)) * (w - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - Math.max(0, Math.min(1, v))) * (H - PAD.top - PAD.bottom)
  const pts = hist.map((p) => ({ x: x(keyToDate(p.date).getTime()), y: y(p.expected) }))
  const up = hist.map((p) => ({ x: x(keyToDate(p.date).getTime()), y: y(p.high) }))
  const lo = hist.map((p) => ({ x: x(keyToDate(p.date).getTime()), y: y(p.low) }))
  const last = pts[pts.length - 1]
  const ticks = xTicks(t0, t1, w)
  return (
    <div ref={box} className="w-full">
      <svg width={w} height={H} className="block overflow-visible" role="img" aria-label={`${t('score.title')}: ${fmtPercent(hist[hist.length - 1].expected)}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="t-caption" fill="var(--chart-label)" fontSize={11}>
              {fmtPercent(v)}
            </text>
          </g>
        ))}
        {ticks.map((ms) => (
          <text key={ms} x={x(ms)} y={H - 6} textAnchor="middle" fill="var(--chart-label)" fontSize={11}>
            {fmtDate(new Date(ms), { day: 'numeric', month: 'short' }).replace('.', '')}
          </text>
        ))}
        <line x1={PAD.left} x2={w - PAD.right} y1={y(PASS)} y2={y(PASS)} stroke="var(--line-strong)" strokeDasharray="3 4" />
        <text x={PAD.left + 4} y={y(PASS) - 5} fill="var(--text3)" fontSize={11}>
          {t('score.pass')}
        </text>
        {exam != null && (
          <g>
            <line x1={x(exam)} x2={x(exam)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--warning)" strokeDasharray="4 3" />
            <text x={x(exam) - 4} y={PAD.top - 4} textAnchor="end" fill="var(--warning)" fontSize={11} fontWeight={600}>
              {t('score.exam')}
            </text>
          </g>
        )}
        <motion.path d={bandPath(up, lo)} fill={ink} fillOpacity={0.14} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.5, duration: 0.6 }} />
        <motion.path
          d={monotonePath(pts)}
          fill="none"
          stroke={ink}
          strokeWidth={2}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay, duration: 1.2, ease: [0.2, 0.7, 0.2, 1] }}
        />
        <motion.g initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: delay + 1.1, type: 'spring', stiffness: 420, damping: 18 }} style={{ transformOrigin: `${last.x}px ${last.y}px` }}>
          {/* el punto de hoy, cuadrado como un píxel */}
          <rect x={last.x - 4.5} y={last.y - 4.5} width={9} height={9} rx={2} fill={ink} stroke="var(--surface)" strokeWidth={2} />
          <text x={last.x} y={last.y - 10} textAnchor="middle" fill="var(--text)" fontSize={11} fontWeight={600}>
            {fmtPercent(hist[hist.length - 1].expected)}
          </text>
        </motion.g>
      </svg>
      <p className="t-caption text-text3 mt-1">{t('score.footnote')}</p>
    </div>
  )
}

/** Unas cinco fechas repartidas (a medianoche local), sin pisarse. */
function xTicks(t0: number, t1: number, width: number): number[] {
  const n = Math.max(2, Math.min(6, Math.floor(width / 110)))
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 + ((t1 - t0) * (i + 0.5)) / n)
    d.setHours(12, 0, 0, 0)
    out.push(d.getTime())
  }
  return out
}
