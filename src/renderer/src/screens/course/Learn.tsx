// Aprender: las unidades y sus temas como tarjetas, con objetivos, minutos, contenido y el dominio en un anillo.
import { useTranslation } from 'react-i18next'
import { Button, Card, Icon, ProgressRing, SectionTitle, Stagger, toneForHue, useTheme } from '@renderer/design'
import type { Pack } from '@shared/schema/pack'
import type { CourseOverview } from '@shared/ipc/course-view'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'

export function LearnTab({ pack, ov }: { pack: Pack; ov: CourseOverview | null }) {
  const { t } = useTranslation('course')
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const mastery = new Map((ov?.skills ?? []).map((s) => [s.id, s.mastery]))
  return (
    <div className="flex flex-col gap-7">
      {pack.units.map((u, ui) => (
        <section key={u.id}>
          <SectionTitle title={`${ui + 1}. ${u.title}`} detail={u.summary} />
          <Stagger className="grid gap-4 mt-3 grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3" gap={0.04}>
            {u.skillIDs.map((sid) => {
              const s = pack.skills.find((x) => x.id === sid)
              if (!s) return null
              const m = mastery.get(sid) ?? 0
              return (
                <Card key={sid} enterAnim interactive padded="lg" onClick={() => navigate({ name: 'study', id: pack.id, mode: 'learn', skill: sid })} className="flex flex-col">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="t-headline">
                        <RichText text={s.title} inline />
                      </div>
                      {s.summary && (
                        <div className="t-callout text-text2 mt-1 line-clamp-2">
                          <RichText text={s.summary} inline />
                        </div>
                      )}
                    </div>
                    <ProgressRing value={m} size={40} stroke={4} color={ink}>
                      <span className="t-caption tabular text-text">{Math.round(m * 100)}</span>
                    </ProgressRing>
                  </div>
                  {s.objectives.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1">
                      {s.objectives.slice(0, 3).map((o, i) => (
                        <li key={i} className="t-ui text-text2 flex gap-2">
                          <Icon name="check" size={13} className="text-text3 mt-0.5 shrink-0" />
                          <span>
                            <RichText text={o} inline />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between mt-auto pt-4">
                    <span className="t-ui text-text3 flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="clock" size={13} /> {t('minutes', { count: s.minutes })}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Icon name="practice" size={13} /> {s.counts.exercises + s.counts.templates}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Icon name="cards" size={13} /> {s.counts.cards}
                      </span>
                    </span>
                    <Button size="sm" variant="secondary">
                      {t('learnSkill')}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </Stagger>
        </section>
      ))}
    </div>
  )
}
