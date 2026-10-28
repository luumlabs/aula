// Tarjeta principal de Hoy: la fecha, el saludo en serif, una frase con lo que toca y la acción principal.
// A la derecha, el curso del momento: su icono pixel-art se enciende píxel a píxel dentro del anillo de la meta de hoy.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Card, Floating, ProgressRing, AnimatedNumber, CourseIcon, Chip, Icon, PixelSky, BrushUnderline } from '@renderer/design'
import type { HomeSummary } from '@shared/ipc/home'
import { capitalize, fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { startPlanItem } from './actions'

function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 20 ? 'afternoon' : 'evening'
}

export function Hero({ data }: { data: HomeSummary }) {
  const { t } = useTranslation(['home', 'common'])
  const g = t(`common:greeting.${greetingKey()}`)
  const pending = data.plan.filter((p) => !p.done)
  const minutes = pending.reduce((a, p) => a + p.minutes, 0)
  const first = pending[0]
  const focus = first ? { icon: first.icon, hue: first.hue, title: first.courseTitle } : data.courses[0] ? { icon: data.courses[0].icon, hue: data.courses[0].hue, title: data.courses[0].title } : null
  const empty = data.courses.length === 0
  const goal = data.today.minutesGoal || 30
  const ratio = Math.min(1, data.today.minutesDone / goal)

  return (
    <Card enterAnim padded={false} className="h-full min-h-[280px] overflow-hidden">
      {/* la única luz: el sol, muy tenue, en la esquina */}
      <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(60% 80% at 100% 100%, var(--sun-glow), transparent 70%)' }} />
      <div className="relative grid h-full grid-cols-1 @3xl:grid-cols-[1fr_auto] gap-6 p-7 @3xl:p-8">
        <div className="flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <PixelSky size={18} />
              <span className="t-eyebrow">{capitalize(fmtDate(new Date()))}</span>
            </div>
            <motion.h1 className="t-display mt-2.5 text-text" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }}>
              {/* el saludo, subrayado a pincel: lo primero que se lee del día */}
              <BrushUnderline seed="greeting" delay={550}>{data.name ? t('common:greeting.withName', { greeting: g, name: data.name }) : g}</BrushUnderline>
            </motion.h1>
            <p className="t-body text-text2 mt-3 max-w-[540px]">
              {empty ? t('subtitleEmpty') : pending.length ? t('subtitle', { count: pending.length, minutes }) : t('subtitleDone')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-6">
            {empty ? (
              <Button variant="primary" size="lg" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>
                {t('createFirst')}
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => (first ? startPlanItem(first) : navigate({ name: 'course', id: data.courses[0].id }))}>
                {t('continue')}
              </Button>
            )}
            <Button variant="secondary" size="lg" onClick={() => navigate({ name: 'chat' })}>
              {t('ask')}
            </Button>
          </div>
          {empty && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {(['chem', 'english', 'calc', 'history'] as const).map((k) => (
                <Chip key={k} onClick={() => navigate({ name: 'create', prefill: { title: t(`suggestions.${k}`) } })}>
                  {t(`suggestions.${k}`)}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {focus && (
          <div className="relative hidden @3xl:grid place-items-center w-[236px]">
            <Floating amplitude={4} duration={7}>
              <ProgressRing value={ratio} size={196} stroke={6} color="var(--accent)" track="var(--fill2)">
                <CourseIcon icon={focus.icon} hue={focus.hue} size={112} title={focus.title} animation="dissolve" radius={30} />
              </ProgressRing>
            </Floating>
            <div className="mt-3 t-ui text-text2 text-center">
              <span className="text-text3">{t('todayGoal')} · </span>
              <span className="tabular text-text font-medium">
                <AnimatedNumber value={data.today.minutesDone} /> / {goal} min
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
