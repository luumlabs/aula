// Cabecera del curso: su icono pixel-art se enciende píxel a píxel, el título en serif y la acción principal.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, DrawnTile, Icon, IconButton, Menu, LiveDot, PixelIcon, toneForHue, useTheme } from '@renderer/design'
import type { Pack } from '@shared/schema/pack'
import { daysUntil, fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { CourseActions, COURSE_EDIT_EVENT, type CourseAction } from './Actions'
import { RequestChangesDialog } from './RequestChanges'
import { SampleTag, showsAsSample } from '@renderer/lib/sample'

export function CourseHeader({ pack }: { pack: Pack }) {
  const { t } = useTranslation(['course', 'common'])
  const exams = pack.exam?.date ? daysUntil(pack.exam.date) : null
  const counts = pack.skills.reduce((a, s) => ({ ex: a.ex + (s.counts?.exercises ?? 0) + (s.counts?.templates ?? 0), cards: a.cards + (s.counts?.cards ?? 0) }), { ex: 0, cards: 0 })
  const meta = [pack.subject, pack.courseCode].filter(Boolean).join(' · ')
  const [action, setAction] = useState<CourseAction>(null)
  const [changes, setChanges] = useState(false)
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  // «Añadir fecha de examen» desde el resumen abre el mismo diálogo de editar
  useEffect(() => {
    const open = () => setAction('edit')
    window.addEventListener(COURSE_EDIT_EVENT, open)
    return () => window.removeEventListener(COURSE_EDIT_EVENT, open)
  }, [])
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {/* el icono, sobre una losa dibujada a mano: relleno plano del tono y su contorno de tinta, algo fuera de registro */}
      <motion.div whileHover={{ y: -1.5 }} transition={{ type: 'spring', stiffness: 439, damping: 20 }}>
        <DrawnTile seed={pack.id} size={84} radius={24} fill={`color-mix(in oklab, ${dark ? tone.fillDark : tone.fillLight} ${dark ? 24 : 16}%, var(--paper))`} ink={dark ? tone.inkDark : tone.inkLight} inkAlpha={dark ? 0.8 : 0.75}>
          <PixelIcon icon={pack.icon} hue={pack.hue} size={55} title={pack.title} animation="dissolve" celebrate />
        </DrawnTile>
      </motion.div>
      <div className="min-w-0 flex-1">
        <motion.h1 className="t-title1 text-[32px] leading-[38px] line-clamp-2 break-words" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
          {pack.title}
        </motion.h1>
        <div className="t-callout text-text2 mt-1 flex items-center gap-1.5 flex-wrap">
          {/* un curso de ejemplo lo dice (A4-P1-1) */}
          {showsAsSample(pack.id) && <SampleTag />}
          <span>{meta}</span>
          {pack.exam?.date && exams != null && exams >= 0 && (
            <>
              <span className="text-text3">·</span>
              <span className={exams <= 3 ? 'text-accent-text inline-flex items-center gap-1.5' : 'inline-flex items-center gap-1.5'}>
                {exams <= 3 && <LiveDot color="var(--accent)" size={6} />}
                {t('examOn', { date: fmtDate(pack.exam.date, { weekday: 'long', day: 'numeric', month: 'long' }) })} · {exams === 0 ? t('common:time.today') : exams === 1 ? t('common:time.tomorrow') : t('common:time.inDays', { count: exams })}
              </span>
            </>
          )}
        </div>
        <div className="t-ui text-text3 mt-0.5">{[t('run:summary.topics', { count: pack.skills.length }), t('run:summary.exercises', { count: counts.ex }), t('run:summary.cards', { count: counts.cards })].join(' · ')}</div>
      </div>
      <div className="flex items-center gap-2 w-full @3xl:w-auto">
        <Button variant="primary" size="lg" onClick={() => navigate({ name: 'study', id: pack.id, mode: 'plan' })}>
          {t('studyNow')}
        </Button>
        <Button variant="ghost" size="lg" icon={<Icon name="refine" size={16} />} onClick={() => setChanges(true)}>
          {t('refine')}
        </Button>
        <Menu
          trigger={(open) => (
            <IconButton label={t('common:actions.more')} variant="filled" onClick={open}>
              <Icon name="more" size={16} />
            </IconButton>
          )}
          items={[
            { label: t('common:actions.edit'), icon: <Icon name="edit" size={15} />, onSelect: () => setAction('edit') },
            { label: t('export'), icon: <Icon name="share" size={15} />, onSelect: () => setAction('export') },
            { label: t('history.title'), icon: <Icon name="history" size={15} />, onSelect: () => setAction('history') },
            { label: t('common:actions.delete'), icon: <Icon name="trash" size={15} />, danger: true, separatorBefore: true, onSelect: () => setAction('delete') }
          ]}
        />
        <CourseActions pack={pack} action={action} onClose={() => setAction(null)} />
        <RequestChangesDialog pack={pack} open={changes} onClose={() => setChanges(false)} />
      </div>
    </div>
  )
}
