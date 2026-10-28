// Acierto por tema: lista con medidores del color del curso (los temas con más ejercicios primero) que lleva al tema.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, SectionTitle, Group, Row, Button, ProgressBar, toneForHue, useTheme, cx } from '@renderer/design'
import { fmtPercent } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import type { StatsTopic } from '@shared/ipc/stats'

const FIRST = 6

export function TopicsCard({ topics, showCourse }: { topics: StatsTopic[]; showCourse: boolean }) {
  const { t } = useTranslation('stats')
  const { dark } = useTheme()
  const [all, setAll] = useState(false)
  const list = all ? topics : topics.slice(0, FIRST)
  return (
    <Card enterAnim className="h-full flex flex-col">
      <SectionTitle title={t('topics.title')} detail={t('topics.detail')} />
      {topics.length === 0 ? (
        <p className="t-body text-text2 py-4">{t('topics.empty')}</p>
      ) : (
        <>
          <Group inset={16}>
            {list.map((tp, i) => {
              const tone = toneForHue(tp.hue)
              const ink = dark ? tone.inkDark : tone.inkLight
              const weak = tp.accuracy < 0.6 && tp.attempts >= 5
              return (
                <Row
                  key={tp.id}
                  index={i}
                  title={tp.title}
                  subtitle={[showCourse ? tp.courseTitle : '', t('topics.exercises', { count: tp.attempts })].filter(Boolean).join(' · ')}
                  onClick={() => navigate({ name: 'course', id: tp.courseId, tab: 'learn', skill: tp.skillId })}
                  trailing={
                    <div className="flex items-center gap-3 w-[150px] justify-end">
                      <ProgressBar value={tp.accuracy} height={5} color={ink} className="w-[84px]" label={tp.title} />
                      <span className={cx('t-number-inline w-11 text-right', weak ? 'text-warning' : 'text-text')}>{fmtPercent(tp.accuracy)}</span>
                    </div>
                  }
                />
              )
            })}
          </Group>
          {topics.length > FIRST && (
            <div className="mt-2">
              <Button variant="plain" size="sm" onClick={() => setAll((v) => !v)}>
                {all ? t('topics.showLess') : t('topics.showAll', { count: topics.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
