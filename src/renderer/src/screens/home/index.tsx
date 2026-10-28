// Inicio: un tablero tipo bento que llena la ventana — saludo y meta de hoy, racha, exámenes que flotan, plan, semana, cursos y herramientas.
import { useTranslation } from 'react-i18next'
import { Stagger } from '@renderer/design'
import { useRpc } from '@renderer/lib/useRpc'
import { useScreenTitle } from '@renderer/app/title'
import { Hero } from './Hero'
import { StreakCard } from './Streak'
import { TodayStats } from './Today'
import { ExamCards } from './Exams'
import { PlanCard } from './Plan'
import { WeekCard } from './Week'
import { CourseCards } from './Courses'
import { ToolsStrip } from './Tools'
import { mockHome } from './mock'
import type { HomeSummary } from '@shared/ipc/home'

export default function Home() {
  const { t } = useTranslation('home')
  useScreenTitle(t('title'))
  const { data, error } = useRpc('home.summary', undefined, { events: ['courses.changed', 'settings.changed', 'calendar.changed'] as never })
  const summary: HomeSummary | undefined = data ?? (error && (import.meta.env.DEV || new URLSearchParams(location.search).has('demo')) ? mockHome() : undefined)
  if (!summary) return <HomeSkeleton />
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-1 pb-24">
      <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
        <div className="col-span-12 @5xl:col-span-8">
          <Hero data={summary} />
        </div>
        <div className="col-span-12 @5xl:col-span-4 grid gap-4 grid-rows-[auto_1fr]">
          <StreakCard data={summary} />
          <TodayStats data={summary} />
        </div>
        {summary.exams.length > 0 && (
          <div className="col-span-12">
            <ExamCards exams={summary.exams} />
          </div>
        )}
        {summary.courses.length > 0 && (
          <>
            <div className="col-span-12 @5xl:col-span-7">
              <PlanCard plan={summary.plan} minutesDone={summary.today.minutesDone} minutesGoal={summary.today.minutesGoal} />
            </div>
            <div className="col-span-12 @5xl:col-span-5">
              <WeekCard events={summary.upcoming} />
            </div>
          </>
        )}
        <div className="col-span-12 mt-2">
          <CourseCards courses={summary.courses} />
        </div>
        <div className="col-span-12 mt-2">
          <ToolsStrip />
        </div>
      </Stagger>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="flex-1 grid grid-cols-12 gap-4 px-6 pt-1">
      <div className="col-span-8 h-[280px] skeleton rounded-[22px]" />
      <div className="col-span-4 h-[280px] skeleton rounded-[22px]" />
      <div className="col-span-12 h-[120px] skeleton rounded-[22px]" />
    </div>
  )
}
