// Dominio por semana: barras apiladas de un solo tono («Dominado» abajo, «Sin ver» arriba) que crecen al aparecer; al
// señalar una semana, la leyenda cuenta los temas de ese momento (hoy si no se señala ninguna).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, SectionTitle, cx } from '@renderer/design'
import { fmtDate } from '@renderer/lib/format'
import { MASTERY_LEVELS, type MasteryLevelName, type StatsLevelPoint } from '@shared/ipc/stats'
import { keyToDate } from './derive'

const STACK: MasteryLevelName[] = ['mastered', 'solid', 'practicing', 'learning', 'unseen']
const HEIGHT = 176

export function LevelsCard({ points }: { points: StatsLevelPoint[] }) {
  const { t } = useTranslation('stats')
  const [hover, setHover] = useState<number | null>(null)
  const idx = hover ?? points.length - 1
  const shown = points[idx]
  const max = Math.max(1, ...points.map((p) => MASTERY_LEVELS.reduce((s, l) => s + p.counts[l], 0)))
  const isToday = idx === points.length - 1
  return (
    <Card enterAnim className="h-full flex flex-col">
      <SectionTitle
        title={t('levels.title')}
        detail={t('levels.detail')}
        action={shown && <span className="t-footnote text-text2">{isToday ? t('levels.today') : t('levels.weekOf', { date: fmtDate(keyToDate(shown.date), { day: 'numeric', month: 'short' }) })}</span>}
      />
      {points.length === 0 ? (
        <div className="flex-1 grid place-items-center text-center py-8">
          <div>
            <div className="t-headline text-text">{t('levels.empty')}</div>
            <p className="t-body text-text2 mt-1 max-w-[360px]">{t('levels.emptyBody')}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 flex items-end gap-[6px] pt-3" style={{ minHeight: HEIGHT }} onMouseLeave={() => setHover(null)} role="img" aria-label={t('levels.detail')}>
            {points.map((p, i) => {
              const total = MASTERY_LEVELS.reduce((s, l) => s + p.counts[l], 0)
              const active = i === idx
              return (
                <button
                  key={p.date}
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  className="group flex-1 min-w-0 h-full flex flex-col justify-end items-stretch outline-none"
                  aria-label={fmtDate(keyToDate(p.date), { day: 'numeric', month: 'short' })}
                >
                  <motion.div
                    className={cx('w-full max-w-[34px] mx-auto flex flex-col-reverse rounded-[7px] overflow-hidden transition-opacity', hover != null && !active && 'opacity-55')}
                    style={{ height: `${(total / max) * 100}%`, transformOrigin: 'bottom' }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.15 + i * 0.04 }}
                  >
                    {STACK.map((l) =>
                      p.counts[l] > 0 ? <div key={l} style={{ flexGrow: p.counts[l], background: `var(--level-${MASTERY_LEVELS.indexOf(l)})` }} className="w-full min-h-[3px] border-t-[1.5px] border-surface first:border-t-0" /> : null
                    )}
                  </motion.div>
                  <div className={cx('mt-1.5 h-[3px] w-3 mx-auto rounded-full transition-colors', active ? 'bg-text2' : 'bg-transparent')} />
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4">
            {MASTERY_LEVELS.map((l, i) => (
              <div key={l} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: `var(--level-${i})` }} />
                <span className="t-footnote text-text2">
                  {t(`levels.names.${l}`)} <span className="tabular text-text">· {shown?.counts[l] ?? 0}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
