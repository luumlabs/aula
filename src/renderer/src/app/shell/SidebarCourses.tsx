// Cursos en la barra lateral: icono pixel-art (cae en su sitio al aparecer), título y la cuenta atrás del examen.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { CourseIcon, Tooltip, cx, spring } from '@renderer/design'
import { useNav, navigate } from '../router'
import { useCourses } from '@renderer/lib/courses'
import { daysUntil } from '@renderer/lib/format'
import { courseRunIssue, coursePartial } from '@renderer/screens/course/failure'
import { useLatestRunsMap } from '@renderer/screens/course/runs'
import { showsAsSample } from '@renderer/lib/sample'

export function SidebarCourses({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const { courses } = useCourses()
  const runs = useLatestRunsMap()
  const route = useNav((s) => s.route)
  const activeId = route.name === 'course' || route.name === 'study' ? route.id : null

  if (!courses.length) return <div className={cx('px-2.5 py-1 t-ui text-text3', collapsed && 'hidden')}>{t('nav.noCourses')}</div>

  return (
    <div className="flex flex-col gap-px">
      {courses.map((c, i) => {
        const active = c.id === activeId
        // un curso de ejemplo dice que lo es, no la cuenta atrás de un examen que no es del estudiante (A4-P1-1)
        const sample = showsAsSample(c.id)
        const n = c.examDate && !sample ? daysUntil(c.examDate) : null
        const soon = n != null && n >= 0 && n <= 3
        // la creación falló o se detuvo sin ningún tema: se marca para que no pase desapercibido
        const issue = courseRunIssue(runs[c.id], c.skillCount)
        // o se cortó a medias, con temas ya escritos: «Creación en pausa» (J2-2)
        const partial = coursePartial(runs[c.id], c.skillCount)
        const problem = issue === 'failed' || issue === 'stopped' || issue === 'limit' || !!partial
        const row = (
          <motion.button
            key={c.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.03 * i }}
            onClick={() => navigate({ name: 'course', id: c.id })}
            aria-label={collapsed ? c.title : undefined}
            aria-current={active ? 'page' : undefined}
            className={cx('no-drag relative flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left transition-colors', !active && 'hover:bg-fill1', collapsed && 'justify-center')}
          >
            {active && <motion.span layoutId="sidebar-selection" transition={spring.snappy} className="absolute inset-0 rounded-[10px] bg-selected" />}
            <span className="relative">
              <CourseIcon icon={c.icon} hue={c.hue} size={30} title={c.title} animation="drop" radius={8} />
              {problem && <span aria-hidden className={cx('absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full', issue === 'failed' ? 'bg-danger' : 'bg-warning')} />}
            </span>
            {!collapsed && (
              <span className="relative min-w-0 flex-1">
                <span className="block truncate t-ui font-medium text-text">{c.title}</span>
                {issue ? (
                  <span className={cx('block truncate text-[12px] leading-4', issue === 'failed' ? 'text-danger' : issue === 'building' ? 'text-accent-text' : 'text-warning')}>{t(`course:failure.marker.${issue}`)}</span>
                ) : partial ? (
                  <span className="block truncate text-[12px] leading-4 text-warning">{t('course:failure.marker.partial')}</span>
                ) : (
                  <span className={cx('block truncate text-[12px] leading-4', soon ? 'text-accent-text' : 'text-text3')}>
                    {sample ? t('nav.sampleCourse') : n != null && n >= 0 ? (n === 0 ? t('nav.examToday') : n === 1 ? t('nav.examTomorrow') : t('nav.examInDays', { count: n })) : c.subject}
                  </span>
                )}
              </span>
            )}
          </motion.button>
        )
        return collapsed ? (
          <Tooltip key={c.id} label={issue ? `${c.title} · ${t(`course:failure.marker.${issue}`)}` : sample ? `${c.title} · ${t('nav.sampleCourse')}` : c.title} side="right">
            {row}
          </Tooltip>
        ) : (
          row
        )
      })}
    </div>
  )
}
