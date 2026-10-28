// Tarjetas dentro de un mensaje de Aula: preguntas con opciones, permisos, el curso que se está creando, acciones, y los
// cuestionarios y tarjetas que se resuelven ahí mismo (StudySetCards).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { AulaMark, Button, Card, CourseIcon, Icon, ProgressBar, TextField, cx, pixelBurst, spring, toast } from '@renderer/design'
import type { AssistantCard, AssistantCardAction } from '@shared/assistant/types'
import { api } from '@renderer/lib/api'
import { useCourses } from '@renderer/lib/courses'
import { navigate } from '@renderer/app/router'
import { useCourseRun } from '../course/runs'
import { StudySetCard } from './StudySetCards'
import { courseCardStatus } from './courseCard'

export function MessageCards({ cards, threadId, messageId, packId = null }: { cards: AssistantCard[]; threadId: string; messageId: string; packId?: string | null }) {
  return (
    <div className="flex flex-col gap-2.5 mt-3">
      {cards.map((c, i) => (
        // cada tarjeta entra subiendo un poco (las de una misma respuesta, escalonadas)
        <motion.div key={c.id} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...spring.smooth, delay: Math.min(i, 3) * 0.06 }}>
          {(c.kind === 'quiz' || c.kind === 'flashcards') && c.studySet ? (
            <StudySetCard card={c} threadId={threadId} messageId={messageId} packId={c.studySet.courseID ?? packId} />
          ) : (
            <CardView card={c} threadId={threadId} messageId={messageId} />
          )}
        </motion.div>
      ))}
    </div>
  )
}

function CardView({ card, threadId, messageId }: { card: AssistantCard; threadId: string; messageId: string }) {
  const { t } = useTranslation('chat')
  const [other, setOther] = useState('')
  const [local, setLocal] = useState<AssistantCard>(card)
  const c = local.state === card.state ? card : local
  const answer = async (patch: { optionId?: string; answer?: string; approve?: boolean }, el?: HTMLElement) => {
    const label = patch.optionId ? c.options.find((o) => o.id === patch.optionId)?.label : patch.answer
    setLocal({ ...c, state: patch.approve === undefined ? 'answered' : patch.approve ? 'approved' : 'denied', answer: label })
    if (el && patch.approve !== false) pixelBurst(el, { count: 8 })
    try {
      await api.invoke('chat.answerCard', { threadId, messageId, cardId: c.id, ...patch })
    } catch {
      /* modo demostración */
    }
  }

  if (c.kind === 'question') {
    const done = c.state !== 'pending'
    return (
      <Card padded="sm" className={cx('pl-4', !done && 'bg-accent-wash! border-accent-line!')}>
        <div className="flex items-center gap-2 t-headline">
          {done ? <Icon name="help" size={15} className="text-accent-text" /> : <AulaMark size={18} state="waiting" />}
          {c.title}
        </div>
        <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" className="mt-1.5 flex items-center gap-1.5 t-callout text-text2" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
            <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring.bouncy} className="inline-grid"><Icon name="check" size={14} className="text-success" /></motion.span> {c.answer}
          </motion.div>
        ) : (
          <motion.div key="ask" className="mt-2.5 flex flex-wrap gap-2" exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}>
            {c.options.map((o) => (
              <Button key={o.id} size="md" variant="secondary" onClick={(e) => void answer({ optionId: o.id }, e.currentTarget)}>
                {o.label}
              </Button>
            ))}
            {c.allowsOther && (
              <div className="flex items-center gap-2 min-w-[220px] flex-1">
                <div className="flex-1">
                  <TextField value={other} onChange={(e) => setOther(e.target.value)} placeholder={t('other')} onKeyDown={(e) => e.key === 'Enter' && other.trim() && void answer({ answer: other.trim() })} />
                </div>
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </Card>
    )
  }

  if (c.kind === 'approval') {
    const done = c.state !== 'pending'
    return (
      <Card padded="sm" className={cx(!done && 'bg-accent-wash! border-accent-line!')}>
        <div className="flex items-start gap-3">
          <Icon name="shield" size={18} className="text-accent-text mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="t-headline">{c.title}</div>
            {c.detail && <div className="t-callout text-text2 mt-0.5">{c.detail}</div>}
            {c.facts.length > 0 && (
              <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 t-ui">
                {c.facts.map((f, i) => (
                  <span key={i} className="contents">
                    <span className="text-text3">{f.label}</span>
                    <span className="text-text2 break-all">{f.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" className={cx('mt-2 flex items-center gap-1.5 t-ui font-medium', c.state === 'approved' ? 'text-success' : 'text-text3')} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
            <Icon name={c.state === 'approved' ? 'check-circle' : c.state === 'expired' ? 'clock' : 'close'} size={14} />
            {/* sin responder (p. ej. tras reiniciar): caducada, no «denegada» (J2-19) */}
            {c.state === 'approved' ? t('approved') : c.state === 'expired' ? t('expired') : t('denied')}
          </motion.div>
        ) : (
          <motion.div key="ask" className="mt-3 flex justify-end gap-2" exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}>
            <Button size="md" variant="ghost" onClick={() => void answer({ approve: false })}>
              {t('deny')}
            </Button>
            <Button size="md" variant="primary" onClick={(e) => void answer({ approve: true }, e.currentTarget)}>
              {c.actionLabel ?? t('allow')}
            </Button>
          </motion.div>
        )}
        </AnimatePresence>
      </Card>
    )
  }

  if (c.kind === 'course') return <CourseCard card={c} />
  return (
    <Card padded="sm">
      <div className="t-headline">{c.title}</div>
      {c.detail && <div className="t-callout text-text2 mt-0.5">{c.detail}</div>}
      {c.items.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {c.items.map((r, i) => (
            <button key={i} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-fill1 text-left" onClick={() => r.courseID && navigate({ name: 'course', id: r.courseID })}>
              {r.icon && <CourseIcon icon={r.icon} hue={r.hue} size={24} radius={7} title={r.title} />}
              <span className="t-callout">{r.title}</span>
              {r.subtitle && <span className="t-ui text-text3">· {r.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
      <Actions actions={c.actions} />
    </Card>
  )
}

function CourseCard({ card }: { card: AssistantCard }) {
  const { t } = useTranslation('chat')
  const course = useCourses((s) => s.courses.find((x) => x.id === card.packID))
  // lo que pasa de verdad con su creación (A3-P2-5), no el «Empezando» con el que se enseñó
  const status = courseCardStatus(useCourseRun(card.packID ?? ''))
  const building = status ? status.kind === 'building' : card.state === 'pending'
  const detail = !status
    ? card.detail
    : status.kind === 'building'
      ? t('courseCard.building', { percent: status.percent })
      : t(`courseCard.${status.kind}`)
  const tone = status?.kind === 'failed' ? 'text-danger' : status?.kind === 'paused' || status?.kind === 'limit' ? 'text-warning' : 'text-accent-text'
  const open = () => card.packID && navigate({ name: 'course', id: card.packID })
  const resume = (runId: string) => void api.invoke('generation.resume', { id: runId }).catch((e: unknown) => toast.error((e as Error).message))
  const action = !status ? null : status.kind === 'ready' ? (
    <Button size="sm" variant="primary" onClick={open}>{t('courseCard.open')}</Button>
  ) : status.kind === 'building' ? (
    <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'run', id: status.runId })}>{t('courseCard.progress')}</Button>
  ) : (
    <Button size="sm" variant="primary" icon={<Icon name="refresh" size={13} />} onClick={() => resume(status.runId)}>
      {t(status.kind === 'failed' ? 'courseCard.retry' : 'courseCard.resume')}
    </Button>
  )
  return (
    <Card padded="sm" data-testid="chat-course-card" data-status={status?.kind ?? 'unknown'}>
      <div className="flex items-center gap-3">
        <CourseIcon icon={course?.icon ?? 'study'} hue={course?.hue} size={44} radius={12} title={card.title} animation="drop" />
        <div className="min-w-0 flex-1">
          <div className="t-headline truncate">{course?.title ?? card.title}</div>
          <div className={cx('t-ui flex items-center gap-1.5 mt-0.5', tone)}>
            {building && <AulaMark size={15} state="working" />}
            {detail}
          </div>
          {building && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 w-[60%]">
              <ProgressBar value={status?.kind === 'building' ? Math.max(0.04, status.percent / 100) : 0.08} />
            </motion.div>
          )}
        </div>
        {action ?? <Actions actions={card.actions} inline />}
      </div>
    </Card>
  )
}

function Actions({ actions, inline }: { actions: AssistantCardAction[]; inline?: boolean }) {
  if (!actions.length) return null
  const run = (a: AssistantCardAction) => {
    if ((a.kind === 'open' || a.kind === 'adjustCourse' || a.kind === 'extendCourse') && a.courseID) navigate({ name: 'course', id: a.courseID })
    else if (a.kind === 'openCalendar') navigate({ name: 'calendar' })
    else if (a.kind === 'openToday') navigate({ name: 'home' })
    else if (a.kind === 'openSettings') navigate({ name: 'settings' })
    else if (a.kind === 'prepareCourse') navigate({ name: 'create', prefill: { title: a.value } })
    else if (a.kind === 'openURL' && a.value) void api.invoke('app.openExternal', { url: a.value })
  }
  return (
    <div className={cx('flex flex-wrap gap-2', inline ? '' : 'mt-3')}>
      {actions.map((a) => (
        <Button key={a.id} size="md" variant={a.prominent ? 'secondary' : 'ghost'} onClick={() => run(a)}>
          {a.label}
        </Button>
      ))}
    </div>
  )
}
