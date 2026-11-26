// Cursos («Cuadernos de estudio»): catálogo sereno de asignaturas con filtros, portada mate CoverBand e iconos vivos.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, Icon, Spinner } from '@renderer/design'
import { navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { useRpc } from '@renderer/lib/useRpc'
import { showsAsSample } from '@renderer/lib/sample'
import { CourseCards } from '../home/Courses'
import { mockHome } from '../home/mock'

type Filter = 'all' | 'exam' | 'review'

export default function Courses() {
  const { t } = useTranslation(['home', 'common'])
  const [filter, setFilter] = useState<Filter>('all')
  useScreenTitle(t('courses'))
  const { data, error } = useRpc('home.summary', undefined, { events: ['courses.changed', 'calendar.changed'] as never })
  const summary = data ?? (error && (import.meta.env.DEV || new URLSearchParams(location.search).has('demo')) ? mockHome() : undefined)
  const courses = summary?.courses ?? []
  const withExam = courses.filter((c) => !!c.examDate && !showsAsSample(c.id))
  const withReview = courses.filter((c) => c.dueCards > 0 || c.mistakes > 0)
  const visible = filter === 'exam' ? withExam : filter === 'review' ? withReview : courses

  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto px-4 pb-12 @lg:px-6">
      <div className="mx-auto w-full max-w-[70rem]">
        <header className="border-b border-rule py-5 @lg:py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="t-eyebrow">{t('coursesEyebrow')}</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h1 className="t-display text-text">{t('courses')}</h1>
                <p className="font-serif text-[calc(16rem/15)] text-text2">{t('coursesSubtitle')}</p>
              </div>
            </div>
            <Button variant="primary" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>
              {t('common:nav.newCourse')}
            </Button>
          </div>
          {courses.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label={t('courses')}>
              <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
                {t('filterAll')} · {courses.length}
              </Chip>
              {withExam.length > 0 && (
                <Chip active={filter === 'exam'} onClick={() => setFilter('exam')}>
                  {t('filterExam')} · {withExam.length}
                </Chip>
              )}
              {withReview.length > 0 && (
                <Chip active={filter === 'review'} onClick={() => setFilter('review')}>
                  {t('filterReview')} · {withReview.length}
                </Chip>
              )}
            </div>
          )}
        </header>

        <div className="mt-5">
          {summary ? (
            visible.length === 0 && courses.length > 0 ? (
              <p className="t-body py-8 text-text3">{t('coursesEmptyFilter')}</p>
            ) : (
              <CourseCards courses={visible} catalog />
            )
          ) : (
            <div className="grid min-h-24 place-items-center text-text3">
              {error ? <p role="status">{t('common:errors.generic')}</p> : <Spinner size={18} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
