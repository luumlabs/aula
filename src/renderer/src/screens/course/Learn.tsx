// Aprender: las unidades y sus temas como tarjetas, con objetivos, minutos, contenido y el dominio en un anillo. Mientras Aula
// crea el curso (o escribe un tema con «Escribir este tema ahora»), los temas que aún no están listos dicen «Escribiéndose…» o
// «En cola» y no se abren (antes se abrían vacíos o a medias).
import { useTranslation } from 'react-i18next'
import { Button, Card, Chip, Icon, ProgressRing, SectionTitle, Spinner, Stagger, toneForHue, useTheme } from '@renderer/design'
import type { Pack } from '@shared/schema/pack'
import type { CourseOverview } from '@shared/ipc/course-view'
import { topicAvailability, topicOpens, type CreationPhase, type TopicAvailability } from '@engine/study/topics'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'

/** La marca de un tema que no está listo para abrir como lección. */
function TopicState({ state }: { state: Exclude<TopicAvailability, 'ready'> }) {
  const { t } = useTranslation('course')
  const icon = state === 'writing' ? <Spinner size={11} /> : <Icon name={state === 'queued' ? 'clock' : 'edit'} size={12} />
  return <Chip icon={icon}>{t(`learn.${state}`)}</Chip>
}

/** `writing`: el tema que escribe ahora una ampliación en marcha. */
export function LearnTab({ pack, ov, phase = 'none', writing }: { pack: Pack; ov: CourseOverview | null; phase?: CreationPhase; writing?: string }) {
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
              const state = topicAvailability(s, phase, sid === writing)
              // sin lección y sin creación pendiente se abre igual: allí se puede pedir que Aula lo escriba ahora
              const opens = topicOpens(state)
              return (
                <Card
                  key={sid}
                  enterAnim
                  interactive={opens}
                  padded="lg"
                  onClick={opens ? () => navigate({ name: 'study', id: pack.id, mode: 'learn', skill: sid }) : undefined}
                  className="flex flex-col"
                  data-topic-state={state}
                >
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
                    <span className="flex items-center gap-2">
                      {state !== 'ready' && <TopicState state={state} />}
                      {opens && (
                        <Button size="sm" variant="secondary">
                          {t('learnSkill')}
                        </Button>
                      )}
                    </span>
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
