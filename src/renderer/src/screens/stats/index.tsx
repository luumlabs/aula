// Estadísticas: las cifras en frases, la constancia en un mapa de 12 semanas que se enciende píxel a píxel, tu ritmo,
// el dominio por semana, el acierto por tema y la nota estimada de cada curso con su intervalo. Nada se inventa: todo sale
// del progreso guardado (ver src/shared/ipc/stats.ts).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Stagger, StaggerItem, Select, EmptyState, Button, CourseIcon, PageHeader } from '@renderer/design'
import { useRpc } from '@renderer/lib/useRpc'
import { isDemo } from '@renderer/lib/demo'
import { useScreenTitle } from '@renderer/app/title'
import { navigate } from '@renderer/app/router'
import type { StatsData } from '@shared/ipc/stats'
import { nothingToMeasure, pickCourses, sortedTopics, sumDays, sumLevels } from './derive'
import { demoStats } from './demo'
import { SummaryCard } from './Summary'
import { HeatmapCard } from './Heatmap'
import { RhythmCard } from './Rhythm'
import { LevelsCard } from './Levels'
import { TopicsCard } from './Topics'
import { ScoreCard } from './Score'
import { AchievementsCard } from './Achievements'

export default function StatsScreen() {
  const { t } = useTranslation(['stats', 'common'])
  const { data, error, reload } = useRpc('stats.get', undefined, { events: ['progress.changed', 'courses.changed'] as never })
  const stats: StatsData | undefined = data ?? (error && (import.meta.env.DEV || isDemo()) ? demoStats() : undefined)
  const [filter, setFilter] = useState<string>('')
  const courses = useMemo(() => (stats ? pickCourses(stats, filter || null) : []), [stats, filter])
  const chosen = stats?.courses.find((c) => c.id === filter)
  const many = (stats?.courses.length ?? 0) > 1

  useScreenTitle(
    t('title'),
    many && stats ? (
      <div className="w-[220px]" title={t('pickCourse')}>
        <Select
          value={chosen ? chosen.id : ''}
          onChange={(v) => setFilter(v)}
          options={[{ value: '', label: t('allCourses') }, ...stats.courses.map((c) => ({ value: c.id, label: c.title, icon: <CourseIcon icon={c.icon} hue={c.hue} size={18} /> }))]}
        />
      </div>
    ) : null,
    [many, stats, chosen?.id]
  )

  if (!stats) {
    if (error)
      return (
        <EmptyState
          title={t('error')}
          body={t('common:errors.retry')}
          action={
            <Button variant="primary" onClick={() => reload()}>
              {t('common:actions.retry')}
            </Button>
          }
        />
      )
    return <StatsSkeleton label={t('loading')} />
  }
  if (stats.courses.length === 0)
    return (
      <EmptyState
        title={t('empty.noCourses')}
        body={t('empty.noCoursesBody')}
        action={
          <Button variant="primary" onClick={() => navigate({ name: 'create' })}>
            {t('empty.create')}
          </Button>
        }
      />
    )
  if (nothingToMeasure(courses))
    return (
      <EmptyState
        title={t('empty.nothing')}
        body={t('empty.nothingBody')}
        action={
          <Button variant="primary" onClick={() => navigate({ name: 'home' })}>
            {t('empty.goToday')}
          </Button>
        }
      />
    )
  return <StatsBody key={filter} stats={stats} filterTitle={chosen?.title ?? null} courses={courses} />
}

function StatsBody({ stats, courses, filterTitle }: { stats: StatsData; courses: StatsData['courses']; filterTitle: string | null }) {
  const { t } = useTranslation('stats')
  const days = useMemo(() => sumDays(courses), [courses])
  const topics = useMemo(() => sortedTopics(courses), [courses])
  const levels = useMemo(() => sumLevels(courses), [courses])
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-1 pb-24">
      <PageHeader title={t('title')} subtitle={filterTitle ? t('subtitleOne', { course: filterTitle }) : t('subtitleAll')} className="mb-5" />
      <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
        <StaggerItem className="col-span-12">
          <SummaryCard days={days} today={stats.today} />
        </StaggerItem>
        <StaggerItem className="col-span-12 @5xl:col-span-8">
          <HeatmapCard days={days} today={stats.today} />
        </StaggerItem>
        <StaggerItem className="col-span-12 @5xl:col-span-4">
          <RhythmCard days={days} />
        </StaggerItem>
        <StaggerItem className="col-span-12 @5xl:col-span-7">
          <LevelsCard points={levels} />
        </StaggerItem>
        <StaggerItem className="col-span-12 @5xl:col-span-5">
          <TopicsCard topics={topics} showCourse={courses.length > 1} />
        </StaggerItem>
        {courses.map((c, i) => (
          // con un número impar de cursos, el último ocupa toda la fila
          <StaggerItem key={c.id} className={courses.length % 2 === 1 && i === courses.length - 1 ? 'col-span-12' : 'col-span-12 @4xl:col-span-6'}>
            <ScoreCard course={c} index={i} />
          </StaggerItem>
        ))}
        {/* los logros son de todo tu estudio (no se filtran por curso) */}
        {!filterTitle && (
          <StaggerItem className="col-span-12">
            <AchievementsCard />
          </StaggerItem>
        )}
      </Stagger>
    </div>
  )
}

function StatsSkeleton({ label }: { label: string }) {
  return (
    <div className="flex-1 grid grid-cols-12 gap-4 px-6 pt-1" aria-label={label} aria-busy>
      <div className="col-span-12 h-[150px] skeleton rounded-[22px]" />
      <div className="col-span-8 h-[300px] skeleton rounded-[22px]" />
      <div className="col-span-4 h-[300px] skeleton rounded-[22px]" />
    </div>
  )
}
