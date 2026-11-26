import { useTranslation } from 'react-i18next'
import { Button, Icon, Spinner } from '@renderer/design'
import { navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { useRpc } from '@renderer/lib/useRpc'
import { CourseCards } from '../home/Courses'
import { mockHome } from '../home/mock'

export default function Courses() {
  const { t } = useTranslation(['home', 'common'])
  useScreenTitle(t('courses'))
  const { data, error } = useRpc('home.summary', undefined, { events: ['courses.changed', 'calendar.changed'] as never })
  const summary = data ?? (error && (import.meta.env.DEV || new URLSearchParams(location.search).has('demo')) ? mockHome() : undefined)
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto px-4 pb-10 @lg:px-6">
      <div className="mx-auto w-full max-w-[70rem]">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule py-5 @lg:py-7">
          <h1 className="t-display">{t('courses')}</h1>
          <Button variant="primary" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>{t('common:nav.newCourse')}</Button>
        </header>
        {summary ? <CourseCards courses={summary.courses} catalog /> : (
          <div className="grid min-h-24 place-items-center text-text3">
            {error ? <p role="status">{t('common:errors.generic')}</p> : <Spinner size={18} />}
          </div>
        )}
      </div>
    </div>
  )
}
