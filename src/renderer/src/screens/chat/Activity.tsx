// Lo que Aula está haciendo, a la vista: la línea de «pensando» (una ola de luz recorre la frase, que cambia según la fase) y una
// fila por cada herramienta (icono propio que hace lo suyo, lo que busca o crea, una barra que progresa y un visto al terminar).
// Al acabar, las filas se pliegan en un resumen («Consultó 3 materiales · creó 5 tarjetas») que se puede volver a abrir.
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Calculator } from 'lucide-react'
import { Icon, cx, spring, useTheme, type IconName } from '@renderer/design'
import type { AssistantStep } from '@shared/assistant/types'
import { ACTIVITY_MOTION, activityKind, isGenericStatus, quizQuestions, summarize, thinkingKey, type ActivityKind } from './activityKinds'
import './chat.css'

const ICON: Record<ActivityKind, IconName | 'calc'> = {
  materials: 'sources', search: 'search', web: 'globe', page: 'browser', courses: 'course', calendar: 'calendar', calendarEdit: 'calendar',
  cards: 'cards', quiz: 'exam', course: 'create', calc: 'calc', chart: 'chart', image: 'image', memory: 'memory', platform: 'plug',
  files: 'file-text', save: 'folder', ui: 'chat', other: 'activity'
}

export function ActivityIcon({ kind, size = 14 }: { kind: ActivityKind; size?: number }) {
  const name = ICON[kind]
  return name === 'calc' ? <Calculator size={size} strokeWidth={1.9} aria-hidden /> : <Icon name={name} size={size} />
}

/** Un reloj que avanza cada medio segundo (solo mientras está montado). */
function useElapsed(since: string | undefined): number {
  const start = useMemo(() => (since ? new Date(since).getTime() : Date.now()), [since])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, now - start)
}

/** Una frase con una ola de luz que la recorre letra a letra (con «Reducir movimiento», quieta). */
export const WaveText = memo(function WaveText({ text, className }: { text: string; className?: string }) {
  const { reducedMotion } = useTheme()
  if (reducedMotion) return <span className={className}>{text}</span>
  const chars = Array.from(text)
  return (
    <span className={cx('chat-wave', className)} aria-label={text}>
      {chars.map((c, i) => (
        <span key={i} aria-hidden style={{ ['--i' as string]: i }}>
          {c}
        </span>
      ))}
    </span>
  )
})

/** «Leyendo tu pregunta…» → «Pensando…» → «Pensando con calma…»: o lo que diga el proceso principal si es más concreto. */
export function ThinkingLine({ since, label, afterTools }: { since?: string; label?: string; afterTools: boolean }) {
  const { t } = useTranslation('chat')
  const elapsed = useElapsed(since)
  const text = !isGenericStatus(label) ? label! : t(`think.${thinkingKey(elapsed, afterTools)}`)
  const seconds = Math.floor(elapsed / 1000)
  return (
    <motion.div
      className="flex items-center gap-2 min-h-[26px] t-callout text-text"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={spring.smooth}
      role="status"
      aria-live="polite"
      data-testid="chat-thinking"
    >
      <span className="relative inline-grid overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={text} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.14, ease: 'easeIn' } }} transition={spring.smooth}>
            <WaveText text={text} />
          </motion.span>
        </AnimatePresence>
      </span>
      {seconds >= 4 && (
        <motion.span className="t-footnote text-text3 tabular" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          · {t('think.elapsed', { s: seconds })}
        </motion.span>
      )}
    </motion.div>
  )
}

/** Una fila: el icono de su clase (animado mientras corre), qué hace, sobre qué, y su estado. */
const ActivityRow = memo(function ActivityRow({ step, index }: { step: AssistantStep; index: number }) {
  const { t } = useTranslation('chat')
  const { reducedMotion } = useTheme()
  const kind = activityKind(step.tool)
  // rechazado (o caducado): ni corre ni falló; no se hizo
  const declined = !!step.declined
  const running = step.ok === undefined && !declined
  const failed = step.ok === false && !declined
  return (
    <motion.li
      className="relative flex items-center gap-2.5 py-[5px]"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.smooth, delay: Math.min(index, 4) * 0.03 }}
      data-state={running ? 'running' : failed ? 'failed' : declined ? 'declined' : 'done'}
    >
      <span
        className={cx(
          'chat-act relative grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] transition-colors duration-300',
          running ? 'bg-accent-wash text-accent-text' : failed ? 'bg-danger-soft text-danger' : 'bg-fill1 text-text2'
        )}
        data-motion={running && !reducedMotion ? ACTIVITY_MOTION[kind] : undefined}
      >
        <ActivityIcon kind={kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className={cx('t-callout shrink-0 transition-colors', running ? 'text-text' : 'text-text2')}>{step.label}</span>
          {step.detail && <span className="t-footnote text-text3 truncate">«{step.detail}»</span>}
          {step.count && !step.detail ? <span className="t-footnote text-text3 tabular">· {step.count}</span> : null}
        </span>
        {/* la barra que progresa (sin cambiar la altura de la fila) */}
        <AnimatePresence>
          {running && !reducedMotion && (
            <motion.span
              key="bar"
              className="chat-bar absolute bottom-0 left-[36px] h-[2px] w-[min(160px,40%)] overflow-hidden rounded-full bg-fill2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.35 } }}
              aria-hidden
            >
              {/* las barras de varios pasos a la vez, desfasadas */}
              <i style={{ animationDelay: `${index * -0.37}s` }} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="grid h-5 w-5 shrink-0 place-items-center" aria-label={running ? t('activity.running') : failed ? t('activity.error') : declined ? t('activity.declined') : t('activity.ok')}>
        <AnimatePresence initial={false}>
          {!running && (
            <motion.span key="end" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy} className={failed ? 'text-danger' : declined ? 'text-text3' : 'text-success'}>
              <Icon name={failed ? 'alert-circle' : declined ? 'minus' : 'check'} size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.li>
  )
})

/** Las clases de lo que hizo, como un ramillete de iconos que se juntan. */
function KindCluster({ kinds }: { kinds: ActivityKind[] }) {
  return (
    <span className="flex items-center" aria-hidden>
      {kinds.slice(0, 4).map((k, i) => (
        <motion.span
          key={k}
          className="grid h-[22px] w-[22px] place-items-center rounded-full border-[0.5px] border-line bg-surface text-text2"
          style={{ marginLeft: i ? -6 : 0, zIndex: 4 - i }}
          initial={{ scale: 0.5, opacity: 0, x: -6 }}
          animate={{ scale: 1, opacity: 1, x: 0 }}
          transition={{ ...spring.snappy, delay: i * 0.05 }}
        >
          <ActivityIcon kind={k} size={12} />
        </motion.span>
      ))}
    </span>
  )
}

/** El resumen en una frase: «Consultó 3 materiales · creó 5 tarjetas». */
export function useActivitySummary(steps: readonly AssistantStep[]): { text: string; kinds: ActivityKind[]; failed: number } {
  const { t, i18n } = useTranslation('chat')
  return useMemo(() => {
    const { parts, failed } = summarize(steps)
    const questions = quizQuestions(steps)
    const shown = parts.slice(0, 3).map((p) => (p.kind === 'quiz' && questions ? t('activity.done.quizQuestions', { count: questions }) : t(`activity.done.${p.kind}`, { count: p.count })))
    if (parts.length > 3) shown.push(t('activity.more', { count: parts.length - 3 }))
    if (failed) shown.push(t('activity.failed', { count: failed }))
    const joined = shown.join(' · ') || t('activity.steps', { count: steps.length })
    const text = joined.charAt(0).toLocaleUpperCase(i18n.language) + joined.slice(1)
    return { text, kinds: parts.map((p) => p.kind), failed }
  }, [steps, t, i18n.language])
}

/** Los pasos de una respuesta: abiertos mientras trabaja, plegados en el resumen cuando termina (se abren con un clic). */
export function ActivityBlock({ steps, working }: { steps: AssistantStep[]; working: boolean }) {
  const { t } = useTranslation('chat')
  const [manual, setManual] = useState<boolean | null>(null)
  const summary = useActivitySummary(steps)
  const visible = steps.filter((s) => activityKind(s.tool) !== 'ui' || s.ok === undefined)
  if (!visible.length) return null
  const open = manual ?? working
  return (
    <div className="mb-2" data-testid="chat-activity" data-open={open ? 'true' : 'false'}>
      <AnimatePresence initial={false}>
        {!working && (
          <motion.button
            key="summary"
            type="button"
            className="group -ml-1 inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-left hover:bg-fill1 transition-colors"
            onClick={() => setManual(!open)}
            aria-expanded={open}
            title={open ? t('activity.hide') : t('activity.show')}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring.smooth}
          >
            <KindCluster kinds={summary.kinds} />
            <span className={cx('t-ui truncate', summary.failed ? 'text-text2' : 'text-text3 group-hover:text-text2')} data-testid="chat-activity-summary">
              {summary.text}
            </span>
            <Icon name="chevron-right" size={12} className={cx('shrink-0 text-text3 transition-transform duration-200', open && 'rotate-90')} />
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.smooth}
          >
            <ul className="flex flex-col pt-0.5" aria-label={t('activity.list')}>
              {visible.map((s, i) => (
                <ActivityRow key={s.id} step={s} index={i} />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
