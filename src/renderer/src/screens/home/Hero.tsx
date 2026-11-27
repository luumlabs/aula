// El umbral de Hoy: cabecera abierta sobre el papel con luz cálida desde el arco, el saludo en serif subrayado a pincel,
// la marca «El umbral» viva, la racha, la única acción en ladrillo y un enlace sereno para hablar con Aula.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Chip, Icon, AulaMark, BrushUnderline } from '@renderer/design'
import type { HomeSummary } from '@shared/ipc/home'
import { capitalize, fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { StreakLine } from './Streak'
import { planLeft } from './derive'

function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 20 ? 'afternoon' : 'evening'
}

/** Lo que dice el saludo y adónde lleva su botón: sin cursos, crear uno; con solo cursos de ejemplo, crear el tuyo (o probar
 *  el ejemplo); con cursos, la sesión guiada del plan de hoy. */
export type HeroMode = 'empty' | 'firstRun' | 'study'

export function Hero({ data, mode }: { data: HomeSummary; mode: HeroMode }) {
  const { t } = useTranslation(['home', 'common'])
  const g = t(`common:greeting.${greetingKey()}`)
  const left = planLeft(data.plan)
  const courseId = left.courseId ?? data.plan[0]?.courseId ?? data.courses[0]?.id
  const startPlan = () => courseId && navigate({ name: 'study', id: courseId, mode: 'plan', start: true })
  const subtitle = mode === 'empty' ? t('subtitleEmpty') : mode === 'firstRun' ? t('firstRun.subtitle') : left.steps ? t('subtitle', { count: left.steps, minutes: left.minutes }) : t('subtitleDone')

  return (
    <header className="aula-threshold relative border-b border-rule">
      <div className="relative grid grid-cols-1 gap-6 px-1 pt-4 pb-6 @3xl:grid-cols-[1fr_auto] @3xl:items-end @3xl:pt-6 @3xl:pb-7">
        <div className="flex min-w-0 flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="t-eyebrow">{capitalize(fmtDate(new Date()))}</span>
              <span className="ml-auto @3xl:hidden">
                <AulaMark size={44} />
              </span>
            </div>
            <motion.h1 className="t-display mt-2 text-text" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, delay: 0.02 }}>
              <BrushUnderline seed="greeting" delay={260}>
                {data.name ? t('common:greeting.withName', { greeting: g, name: data.name }) : g}
              </BrushUnderline>
            </motion.h1>
            <p className="mt-3 max-w-[540px] font-serif text-[calc(17rem/15)] leading-[1.5] text-text2 text-pretty">{subtitle}</p>
            {mode === 'study' && <StreakLine streak={data.streak} />}
          </div>
          <div className="mt-5">
            {mode === 'empty' ? (
              <>
                <Button variant="primary" size="lg" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>
                  {t('createFirst')}
                </Button>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(['chem', 'english', 'calc', 'history'] as const).map((k) => (
                    <Chip key={k} onClick={() => navigate({ name: 'create', prefill: { title: t(`suggestions.${k}`) } })}>
                      {t(`suggestions.${k}`)}
                    </Chip>
                  ))}
                </div>
              </>
            ) : mode === 'firstRun' ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Button variant="primary" size="lg" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>
                  {t('firstRun.create')}
                </Button>
                <button type="button" className="touch-target relative t-callout font-medium text-accent-text hover:underline underline-offset-4 outline-none focus-visible:underline" onClick={startPlan}>
                  {t('firstRun.tryExample')}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {left.steps > 0 && (
                  <Button variant="primary" size="lg" onClick={() => (courseId ? startPlan() : navigate({ name: 'create' }))}>
                    {t('continue')}
                  </Button>
                )}
                <GoalLine done={data.today.minutesDone} goal={data.today.minutesGoal} />
                <button
                  type="button"
                  onClick={() => navigate({ name: 'chat' })}
                  className="touch-target relative inline-flex items-center gap-1.5 t-ui font-medium text-text hover:text-accent-text transition-colors outline-none focus-visible:underline underline-offset-4"
                >
                  <AulaMark size={17} />
                  <span>{t('talkToAula')}</span>
                  <Icon name="chevron-right" size={13} className="text-text3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* El umbral, vivo sobre la luz cálida del papel (sin nubes ni pájaros) */}
        <div className="hidden @3xl:flex w-[224px] items-center justify-center pb-1">
          <AulaMark size={146} alive />
        </div>
      </div>
    </header>
  )
}

/** La meta de hoy en una línea: «Meta de hoy: 60 min» antes de empezar y «12 de 60 min hoy» después (nunca «0 / 60»). */
function GoalLine({ done, goal }: { done: number; goal: number }) {
  const { t } = useTranslation('home')
  const target = goal > 0 ? goal : 30
  const minutes = Math.round(done)
  return <span className="t-callout text-text2 tabular">{minutes > 0 ? t('goalProgress', { done: minutes, goal: target }) : t('goal', { goal: target })}</span>
}
