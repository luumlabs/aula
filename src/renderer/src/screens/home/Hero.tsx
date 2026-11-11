// Tarjeta principal de Hoy: la fecha, el saludo en serif, una frase con lo que toca y la acción principal.
// A la derecha, el arco de Aula con la luz de la hora que es (tinta y acuarela) y, debajo, el curso del momento y la meta de hoy.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Card, AnimatedNumber, CourseIcon, Chip, Icon, PixelSky, BrushUnderline, ArchLight, archLightFor, ProgressBar } from '@renderer/design'
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
    <Card enterAnim padded={false} className="relative h-full min-h-[280px] overflow-hidden">
      <div className="relative grid h-full grid-cols-1 @3xl:grid-cols-[1fr_auto] gap-6 p-7 @3xl:p-8">
        <div className="flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <PixelSky size={18} />
              <span className="t-eyebrow">{capitalize(fmtDate(new Date()))}</span>
              {/* en pantallas estrechas (el teléfono), el arco en pequeño a la derecha de la fecha: en su sitio, sin tapar nada */}
              <ArchLight scene={archLightFor(new Date().getHours())} className="@3xl:hidden ml-auto -my-1 -mr-1 h-[60px] w-[72px]" />
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

        {/* el arco de Aula: dentro, la luz de la hora que es (amanece, mediodía, atardece, noche); con el ratón encima, se mueve despacio */}
        <div className="hidden @3xl:flex w-[272px] flex-col items-center justify-center">
          <ArchLight live scene={archLightFor(new Date().getHours())} className="h-[190px] w-[228px]" />
          <div className="mt-2 flex items-center gap-2.5">
            {focus && <CourseIcon icon={focus.icon} hue={focus.hue} size={30} title={focus.title} radius={9} />}
            <div className="min-w-0">
              <div className="t-ui text-text2">
                <span className="text-text3">{t('todayGoal')} · </span>
                <span className="tabular text-text font-medium">
                  <AnimatedNumber value={data.today.minutesDone} /> / {goal} min
                </span>
              </div>
              <ProgressBar value={ratio} className="mt-1.5 w-[150px]" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
