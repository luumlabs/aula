// Logros: la estantería de Estadísticas (los conseguidos encendidos, los que faltan en gris con lo que llevas) y el dibujo
// pixel-art de cada uno, que también usa el aviso al conseguirlo.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { AchievementId, AchievementView } from '@shared/ipc/achievements'
import { Card, DrawnBorder, PixelFlame, PixelIcon, PixelMedal, ProgressBar, SectionTitle, cx, type PixelAnimation } from '@renderer/design'
import { useRpc } from '@renderer/lib/useRpc'
import { fmtDate } from '@renderer/lib/format'

/** El color de la luz de Aula (ladrillo) para los iconos de logro. */
const BRICK_HUE = 0.04

const ICONS: Partial<Record<AchievementId, string>> = {
  firstAnswer: 'ecology', creator: 'notebook', hour1: 'timer', hours10: 'timer', correct100: 'exam', correct1000: 'exam',
  cards100: 'languages', cards1000: 'languages', firstMastered: 'idea', mastered10: 'idea', mistakes10: 'pharmacy', courseReady: 'graduation'
}

/** El dibujo de un logro; apagado (gris) mientras no se consigue. */
export function AchievementArt({ id, size = 40, lit = true, animation = 'none' }: { id: AchievementId; size?: number; lit?: boolean; animation?: PixelAnimation }) {
  const off = lit ? undefined : { filter: 'grayscale(1)', opacity: 0.32 }
  if (id === 'streak3' || id === 'streak7' || id === 'streak30')
    return <span className="grid place-items-center" style={{ width: size, height: size }}><PixelFlame size={size * 0.78} lit={lit} /></span>
  if (id === 'mockPassed') return <span className="grid place-items-center" style={{ width: size, height: size, ...off }}><PixelMedal size={size * 0.9} /></span>
  return <span style={off}><PixelIcon icon={ICONS[id] ?? 'idea'} hue={BRICK_HUE} size={size} animation={lit ? animation : 'none'} /></span>
}

/** La estantería de logros (al final de Estadísticas). */
export function AchievementsCard() {
  const { t } = useTranslation('stats')
  const { data } = useRpc('achievements.list', undefined, { events: ['achievements.earned', 'progress.changed'] as never })
  if (!data?.length) return null
  const earned = data.filter((a) => a.earned).length
  return (
    <Card padded="lg">
      <SectionTitle title={t('achievements.title')} detail={t('achievements.count', { earned, total: data.length })} />
      <div className="mt-4 grid gap-2.5 grid-cols-2 @2xl:grid-cols-4 @5xl:grid-cols-8">
        {data.map((a, i) => (
          <Badge key={a.id} a={a} index={i} />
        ))}
      </div>
    </Card>
  )
}

function Badge({ a, index }: { a: AchievementView; index: number }) {
  const { t } = useTranslation('stats')
  const name = t(`achievements.items.${a.id}.name`)
  const how = t(`achievements.items.${a.id}.how`)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.05 + index * 0.025 }}
      title={a.earned && a.earnedAt ? `${how} · ${fmtDate(a.earnedAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : how}
      className={cx('relative isolate flex flex-col items-center text-center rounded-[16px] px-2 pt-3.5 pb-3', a.earned ? 'bg-accent-wash' : 'bg-fill1')}
    >
      {/* conseguido: su borde, dibujado a mano a pincel ladrillo (cada logro, su trazo); los que faltan, lisos y en gris */}
      {a.earned && <DrawnBorder seed={a.id} color="var(--pigment-brick)" alpha={0.7} radius={16} line={1.4} delay={index * 110} />}
      <AchievementArt id={a.id} size={38} lit={a.earned} animation="drop" />
      <div className={cx('t-ui font-semibold mt-2 leading-tight', a.earned ? 'text-text' : 'text-text2')}>{name}</div>
      {a.earned ? (
        <div className="t-caption mt-0.5">{a.earnedAt ? fmtDate(a.earnedAt, { day: 'numeric', month: 'short' }) : t('achievements.done')}</div>
      ) : (
        <div className="w-full mt-1.5 px-1">
          <ProgressBar value={a.goal ? a.value / a.goal : 0} height={3} color="var(--text3)" />
          <div className="t-caption mt-1 tabular">{t('achievements.progress', { value: a.value, goal: a.goal })}</div>
        </div>
      )}
    </motion.div>
  )
}
