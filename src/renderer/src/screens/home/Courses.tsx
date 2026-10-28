// Tus cursos: tarjetas con el tono del curso (plano y suave), su icono pixel-art grande y la nota estimada.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, CoverBand, DrawnBorder, PixelIcon, ProgressBar, SectionTitle, toneForHue, Chip, Spinner, Icon, cx, useTheme } from '@renderer/design'
import type { HomeCourse } from '@shared/ipc/home'
import { daysUntil, fmtPercent } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { courseRunIssue, coursePartial } from '../course/failure'
import { useLatestRunsMap } from '../course/runs'
import { showsAsSample } from '@renderer/lib/sample'

export function CourseCards({ courses }: { courses: HomeCourse[] }) {
  const { t } = useTranslation(['home', 'common', 'course'])
  const { dark } = useTheme()
  const runs = useLatestRunsMap()
  return (
    <section>
      <SectionTitle title={t('courses')} />
      <div className="grid gap-4 mt-3 grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        {courses.map((c, i) => {
          const tone = toneForHue(c.hue)
          const fill = dark ? tone.fillDark : tone.fillLight
          const ink = dark ? tone.inkDark : tone.inkLight
          // el curso de ejemplo lleva «Ejemplo» en vez de la cuenta atrás de un examen que no es del estudiante (A4-P1-1)
          const sample = showsAsSample(c.id)
          const n = c.examDate && !sample ? daysUntil(c.examDate) : null
          // la creación falló o se detuvo sin temas: se dice en la tarjeta en vez de enseñar «0 %»
          const issue = courseRunIssue(runs[c.id], c.skillCount)
          const problem = issue === 'failed' || issue === 'stopped' || issue === 'limit' ? issue : coursePartial(runs[c.id], c.skillCount) ? 'partial' : undefined
          return (
            <Card key={c.id} enterAnim interactive padded={false} onClick={() => navigate({ name: 'course', id: c.id })} className="h-full border-transparent!" data-pixel-hover>
              {/* su borde, dibujado a mano (cada curso, su trazo) */}
              <DrawnBorder seed={c.id} radius={22} />
              <div className="relative isolate h-[104px] overflow-hidden rounded-t-[22px]">
                {/* la portada, dibujada a mano: relleno plano del tono cortado a mano y su línea de tinta (el mismo dibujo para cada curso) */}
                <CoverBand seed={c.id} fill={`color-mix(in oklab, ${fill} ${dark ? 24 : 15}%, var(--surface))`} ink={ink} inkAlpha={dark ? 0.85 : 0.8} />
                {/* sin el icono gigante girado de fondo: recortado por la franja parecía un fallo de dibujo (J1-17) */}
                <div className="absolute left-5 top-5">
                  <PixelIcon icon={c.icon} hue={c.hue} size={52} title={c.title} animation="drop" delay={0.1 + i * 0.05} />
                </div>
                {sample && (
                  <span title={t('common:sample.hint')} className="absolute top-4 right-4 rounded-full bg-surface/90 px-2.5 py-0.5 t-ui font-medium text-text2">
                    {t('common:sample.tag')}
                  </span>
                )}
                {n != null && n >= 0 && (
                  <span className="absolute top-4 right-4 rounded-full bg-surface/90 px-2.5 py-0.5 t-ui font-medium" style={{ color: n <= 3 ? 'var(--accent-text)' : ink }}>
                    {n === 0 ? t('common:time.today') : n === 1 ? t('common:time.tomorrow') : t('common:time.inDays', { count: n })}
                  </span>
                )}
              </div>
              <div className="px-5 pt-4 pb-5">
                <div className="font-serif text-[20px] leading-[26px] tracking-[-0.2px] truncate">{c.title}</div>
                <div className="t-ui text-text3 truncate">{c.subject}</div>
                {problem ? (
                  <div className={cx('flex items-center gap-2 mt-4 t-ui font-medium', problem === 'failed' ? 'text-danger' : 'text-warning')}>
                    <Icon name="alert-circle" size={13} /> {t(`course:failure.marker.${problem}`)}
                  </div>
                ) : c.generating ? (
                  <div className="flex items-center gap-2 mt-4 t-ui font-medium text-accent-text">
                    <Spinner size={12} /> {t('generating')}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mt-4 t-ui">
                      <span className="text-text3">{t('readiness')}</span>
                      {/* sin practicar, «0 %» no dice nada */}
                      <span className={c.started ? 'tabular font-medium' : 'text-text3'}>{c.started ? fmtPercent(c.readiness) : t('notStarted')}</span>
                    </div>
                    <ProgressBar value={c.started ? c.readiness : 0} color={ink} className="mt-1.5" />
                    {(c.dueCards > 0 || c.mistakes > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {c.dueCards > 0 && <Chip icon={<Icon name="cards" size={12} />}>{t('dueCards', { count: c.dueCards })}</Chip>}
                        {c.mistakes > 0 && <Chip icon={<Icon name="mistakes" size={12} />}>{t('mistakes', { count: c.mistakes })}</Chip>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          )
        })}
        <Card enterAnim interactive padded={false} onClick={() => navigate({ name: 'create' })} className="min-h-[220px] bg-transparent! border-dashed! border-line-strong/50! shadow-none!">
          <div className="h-full min-h-[220px] grid place-items-center text-center p-6">
            <div className="flex flex-col items-center">
              <motion.div className="grid place-items-center w-12 h-12 rounded-full bg-accent-wash text-accent-text" whileHover={{ rotate: 90 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
                <Icon name="plus" size={20} />
              </motion.div>
              <div className="t-headline mt-3">{t('newCourse')}</div>
              <div className="t-ui text-text3 mt-0.5">{t('newCourseHint')}</div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}
