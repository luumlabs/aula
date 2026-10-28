// Un mensaje: el del estudiante en burbuja a la derecha (con las fichas de lo que mencionó con «@», que lo abren); el de Aula a la
// izquierda con su marca, que cuenta lo que pasa: piensa (el sol respira y una frase cambia según la fase), trabaja (el atardecer:
// el sol cruza el arco, y una fila por cada herramienta), escribe (el texto fluye párrafo a párrafo con un punto de sol al final) y
// termina (el sol salta: listo; los pasos se pliegan en un resumen). Si falla, una tarjeta clara con «Reintentar».
// Lo que se escribió mientras respondía espera debajo, más tenue, con «×» para quitarlo.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { AulaMark, Button, Icon, Spinner, cx, spring, useMarkPhase, useTheme } from '@renderer/design'
import type { AssistantMessage } from '@shared/assistant/types'
import { RichText } from '@renderer/lib/RichText'
import { openCourseSource } from '@renderer/screens/documents/lib'
import { fmtTime } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { splitSegments } from './data'
import { InlineBlock } from './InlineBlock'
import { MessageCards } from './Cards'
import { MentionChip, refKey } from './Mentions'
import { ActivityBlock, ThinkingLine } from './Activity'
import { replyPhase } from './activityKinds'
import { nextReveal, safeCut, splitParagraphs, tidyStreamingTail } from './smoothText'
import { api } from '@renderer/lib/api'
import './chat.css'

export interface MessageProps {
  m: AssistantMessage
  threadId: string
  streaming: boolean
  /** Lo que dice el proceso principal que hace («Leyendo lo que adjuntaste…»). */
  label?: string
  language: string
  /** Volver a preguntar lo mismo (tras un fallo). */
  onRetry?: () => void
}

export function Message({ m, threadId, streaming, label, language, onRetry }: MessageProps) {
  if (m.role === 'user') return <UserMessage m={m} />
  return <AssistantReply m={m} threadId={threadId} streaming={streaming} label={label} language={language} onRetry={onRetry} />
}

function UserMessage({ m }: { m: AssistantMessage }) {
  return (
    <motion.div
      data-role="user"
      className="flex justify-end"
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.smooth}
      style={{ transformOrigin: '100% 100%' }}
    >
      <div className="max-w-[78%] rounded-[20px] rounded-br-[8px] bg-bubble px-4 py-2.5 t-body selectable">
        {m.text && <RichText text={m.text} />}
        {m.mentions.length > 0 && (
          <div className={cx('flex flex-wrap gap-1.5', m.text && 'mt-2')}>
            {m.mentions.map((r) => (
              <MentionChip key={refKey(r)} r={r} tone="surface" />
            ))}
          </div>
        )}
        {m.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-[8px] bg-surface px-2 py-1 t-ui">
                {a.status === 'processing' ? <Spinner size={11} /> : <Icon name={a.kind === 'image' ? 'image' : 'file-text'} size={13} />}
                {a.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** La respuesta que aún no existe (se acaba de enviar y el proceso principal aún no la ha creado): igual que una que piensa. */
export function PendingReply({ since, label }: { since?: string; label?: string }) {
  return (
    <motion.div data-role="pending" className="flex flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}>
      <ReplyHeader mark="thinking" />
      <div className="pl-[32px]">
        <ThinkingLine since={since} label={label} afterTools={false} />
      </div>
    </motion.div>
  )
}

function ReplyHeader({ mark, date }: { mark: Parameters<typeof AulaMark>[0]['state']; date?: string }) {
  return (
    <div className="flex items-center gap-2 mb-1 text-text">
      <AulaMark size={24} state={mark} />
      <span className="font-serif text-[16px] font-medium">Aula</span>
      {date && <span className="t-caption">{fmtTime(date)}</span>}
    </div>
  )
}

function AssistantReply({ m, threadId, streaming, label, language, onRetry }: Omit<MessageProps, 'm'> & { m: AssistantMessage }) {
  const { t } = useTranslation('chat')
  const phase = replyPhase(m.steps, !!m.text.trim(), streaming)
  const mark = useMarkPhase(streaming, { thinking: phase === 'thinking', rest: m.failed ? 'offline' : 'idle' })
  const waiting = streaming && m.cards.some((c) => c.state === 'pending' && (c.kind === 'question' || c.kind === 'approval'))
  const thinking = streaming && !waiting && (phase === 'thinking' || (phase === 'tools' && !m.steps.some((s) => s.ok === undefined)))
  // el estado del proceso principal se queda en el último paso aunque haya terminado: ese ya se ve en su fila
  const fresh = label && !m.steps.some((s) => s.label === label) ? label : undefined
  return (
    // una respuesta que empieza vacía no hace su entrada: la línea de «pensando» ya estaba (sin parpadeo)
    <motion.div
      data-role="assistant"
      data-streaming={streaming ? 'true' : 'false'}
      data-phase={phase}
      className="flex flex-col"
      initial={streaming && !m.text && !m.steps.length ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.smooth}
    >
      <ReplyHeader mark={waiting ? 'waiting' : mark} date={m.date} />
      <div className="pl-[32px] t-body selectable">
        {m.steps.length > 0 && <ActivityBlock steps={m.steps} working={phase === 'tools'} />}
        <AnimatePresence initial={false}>
          {thinking && <ThinkingLine key="thinking" since={m.date} label={fresh} afterTools={m.steps.length > 0} />}
        </AnimatePresence>
        {m.failed && !m.interrupted ? (
          <ErrorCard text={m.text} onRetry={onRetry} />
        ) : (
          <StreamText text={m.text} live={streaming && !waiting} packId={m.context?.courseID ?? null} language={language} />
        )}
        {m.citations && m.citations.length > 0 && <Citations citations={m.citations} />}
        {m.cards.length > 0 && <MessageCards cards={m.cards} threadId={threadId} messageId={m.id} packId={m.context?.courseID ?? null} />}
        {m.notices.map((n, i) => (
          <motion.div key={i} className="mt-2 flex items-start gap-1.5 t-ui text-text3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Icon name="info" size={13} className="mt-[2px] shrink-0" />
            {n}
          </motion.div>
        ))}
        {m.interrupted && (
          <div className="mt-3 flex items-center gap-3 t-ui text-warning">
            {t('interrupted')}
            <Button size="sm" onClick={() => void api.invoke('chat.continue', { threadId, messageId: m.id }).catch(() => {})}>
              {t('continue')}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** El fallo, claro: qué pasó (lo explica el proceso principal), reintentar y, si es cosa del proveedor, sus ajustes. */
function ErrorCard({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useTranslation('chat')
  return (
    <motion.div
      role="alert"
      className="mt-1 rounded-[16px] border-[0.5px] border-line bg-danger-soft px-4 py-3"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.smooth}
    >
      <div className="flex items-center gap-2 t-headline text-danger">
        <Icon name="alert-circle" size={16} />
        {t('failed')}
      </div>
      {text && <div className="mt-1 t-callout text-text2"><RichText text={text} /></div>}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {onRetry && (
          <Button size="sm" variant="secondary" icon={<Icon name="refresh" size={13} />} onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Icon name="settings" size={13} />} onClick={() => navigate({ name: 'settings', section: 'ai' })}>
          {t('error.settings')}
        </Button>
      </div>
    </motion.div>
  )
}

/** Cuántos caracteres del texto se enseñan: todos si no llega en vivo; si llega, a un ritmo suave que nunca se queda atrás. */
function useReveal(text: string, live: boolean): number {
  const { reducedMotion } = useTheme()
  const [shown, setShown] = useState(() => (live && !reducedMotion ? 0 : text.length))
  const ref = useRef(shown)
  ref.current = Math.min(ref.current, text.length)
  useEffect(() => {
    if (reducedMotion || ref.current >= text.length) {
      ref.current = text.length
      setShown(text.length)
      return
    }
    let raf = 0
    let last = performance.now()
    let painted = last
    const tick = (now: number) => {
      const next = nextReveal(ref.current, text.length, Math.min(64, now - last))
      last = now
      ref.current = next
      // como mucho ~40 veces por segundo: el Markdown del último párrafo se vuelve a dibujar en cada paso
      if (next >= text.length || now - painted >= 24) {
        painted = now
        setShown(next)
      }
      if (next < text.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, reducedMotion])
  return Math.min(shown, text.length)
}

/** El texto de Aula: prosa por párrafos (los cerrados no se redibujan) y bloques visuales; en vivo, con la cola limpia y el cursor. */
const StreamText = memo(function StreamText({ text, live, packId, language }: { text: string; live: boolean; packId: string | null; language: string }) {
  const { t } = useTranslation('chat')
  const n = useReveal(text, live)
  const revealing = live || n < text.length
  const { segs, pendingBlock } = useMemo(() => {
    const visible = text.slice(0, safeCut(text, n))
    const tidy = revealing ? tidyStreamingTail(visible) : { text: visible, pendingBlock: false }
    return { segs: splitSegments(tidy.text), pendingBlock: tidy.pendingBlock }
  }, [text, n, revealing])
  if (!segs.length && !pendingBlock) return null
  return (
    <div className={cx(revealing && 'chat-live', revealing && !pendingBlock && segs.at(-1)?.kind === 'text' && 'chat-caret')}>
      {segs.map((s, i) =>
        s.kind === 'text' ? (
          splitParagraphs(s.text).map((p, k) => (
            <div key={`${i}-${k}`} className="chat-para">
              <RichText text={p} />
            </div>
          ))
        ) : (
          <div key={`${i}-b`} className="chat-para">
            <InlineBlock raw={s.raw} packId={packId} language={language} />
          </div>
        )
      )}
      <AnimatePresence>
        {pendingBlock && (
          <motion.div
            key="pending-block"
            className="chat-para my-3 flex h-24 items-center justify-center gap-2.5 rounded-[18px] border-[0.5px] border-dashed border-line bg-sunken t-ui text-text3"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.smooth}
          >
            <AulaMark size={22} state="working" />
            {t('block.pending')}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

/** Un mensaje que espera a que Aula termine: la burbuja más tenue, «Se enviará cuando Aula termine» y «×» para quitarlo. */
export function QueuedMessage({ m, onCancel }: { m: AssistantMessage; onCancel: () => void }) {
  const { t } = useTranslation('chat')
  const text = m.text || m.attachments.map((a) => a.name).join(', ')
  return (
    <motion.div
      data-role="queued"
      className="flex flex-col items-end gap-1"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25 }}
      aria-label={t('queue.label', { text })}
    >
      <div className="max-w-[78%] rounded-[20px] rounded-br-[8px] border-[0.5px] border-dashed border-line bg-bubble/60 px-4 py-2.5 t-body text-text2">
        <RichText text={text} />
        {m.mentions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 opacity-80">
            {m.mentions.map((r) => (
              <MentionChip key={refKey(r)} r={r} tone="surface" />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 pr-1 t-footnote text-text3">
        <Icon name="clock" size={12} />
        {t('queue.waiting')}
        <button type="button" onClick={onCancel} className="ml-0.5 grid h-5 w-5 place-items-center rounded-full hover:bg-fill2 hover:text-text" aria-label={t('queue.cancel')} title={t('queue.cancel')}>
          <Icon name="close" size={10} />
        </button>
      </div>
    </motion.div>
  )
}

/** Las fuentes citadas («Apuntes del tema 3 · p. 12»): abren el material en el lector, en esa página. */
function Citations({ citations }: { citations: NonNullable<AssistantMessage['citations']> }) {
  const { t } = useTranslation('chat')
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {citations.map((c, i) => {
        const open = c.courseID && c.sourceID ? () => openCourseSource(c.courseID!, c.sourceID!, c.page) : undefined
        return (
          <motion.button
            key={i}
            disabled={!open}
            onClick={open}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.smooth, delay: i * 0.04 }}
            className="inline-flex items-center gap-1.5 rounded-full border-[0.5px] border-line bg-surface px-2.5 py-1 t-footnote text-text2 enabled:hover:bg-fill1 enabled:hover:text-text disabled:cursor-default"
            title={open ? t('openSource') : undefined}
          >
            <Icon name="file-text" size={12} />
            <span className="max-w-[260px] truncate">{c.title}</span>
            {c.page ? <span className="text-text3 tabular">· {t('page', { n: c.page })}</span> : null}
          </motion.button>
        )
      })}
    </div>
  )
}
