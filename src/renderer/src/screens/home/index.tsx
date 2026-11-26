// Hoy: el umbral abierto arriba con su luz, el plan de hoy a la izquierda sobre el papel, el examen y la semana en el
// margen derecho, y las portadas con iconos vivos de tus cursos al pie.
import { useTranslation } from 'react-i18next'
import { Stagger } from '@renderer/design'
import { useRpc } from '@renderer/lib/useRpc'
import { showsAsSample } from '@renderer/lib/sample'
import { useScreenTitle } from '@renderer/app/title'
import { Hero, type HeroMode } from './Hero'
import { ExamCard } from './Exams'
import { ownExams } from './derive'
import { PlanCard } from './Plan'
import { WeekCard } from './Week'
import { CourseCards } from './Courses'
import { mockHome } from './mock'
import type { HomeSummary } from '@shared/ipc/home'

export default function Home() {
  const { t } = useTranslation('home')
  useScreenTitle(t('title'))
  const { data, error } = useRpc('home.summary', undefined, { events: ['courses.changed', 'settings.changed', 'calendar.changed'] as never })
  const summary: HomeSummary | undefined = data ?? (error && (import.meta.env.DEV || new URLSearchParams(location.search).has('demo')) ? mockHome() : undefined)
  if (!summary) return <HomeSkeleton />
  const hasCourses = summary.courses.length > 0
  const mode: HeroMode = !hasCourses ? 'empty' : summary.courses.every((c) => showsAsSample(c.id)) ? 'firstRun' : 'study'
  const exams = mode === 'study' ? ownExams(summary.exams, showsAsSample) : []
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pt-1 pb-10 @lg:px-6">
      <Stagger className="mx-auto grid max-w-[70rem] grid-cols-12 gap-x-7 gap-y-5" gap={0.05}>
        <div className="col-span-12">
          <Hero data={summary} mode={mode} />
        </div>
        {hasCourses && (
          <>
            <div className="col-span-12 @5xl:col-span-7">
              <PlanCard plan={summary.plan} />
            </div>
            <aside className="col-span-12 flex flex-col gap-4 @5xl:col-span-5">
              {exams.length > 0 && <ExamCard exams={exams} />}
              <WeekCard events={summary.upcoming} courses={summary.courses} />
            </aside>
          </>
        )}
        <div className="col-span-12 mt-2">
          <CourseCards courses={summary.courses} />
        </div>
      </Stagger>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="mx-auto flex-1 w-full max-w-[70rem] grid grid-cols-12 gap-6 px-6 pt-4">
      <div className="col-span-12 h-[220px] skeleton rounded-[22px]" />
      <div className="col-span-7 h-[260px] skeleton rounded-[22px]" />
      <div className="col-span-5 h-[260px] skeleton rounded-[22px]" />
    </div>
  )
}
