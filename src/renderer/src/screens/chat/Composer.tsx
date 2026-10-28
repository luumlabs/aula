// La caja de escribir (cápsula flotante): adjuntar arrastrando o con +, mencionar con «@» (selector encima, ↑↓ ↩ Tab Esc; lo
// elegido queda como ficha), Enter envía, Mayús+Enter salto de línea. Mientras Aula responde se puede seguir escribiendo: Enter deja
// el mensaje en cola (se envía al terminar) y «Detener» para solo la respuesta en curso. Si Aula espera una respuesta (una
// pregunta o un permiso), lo que se escribe la contesta.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { MAX_MESSAGE_CHARS, type AssistantRef } from '@shared/assistant/types'
import { Icon, IconButton, Tooltip, cx, spring, useTheme } from '@renderer/design'
import { api } from '@renderer/lib/api'
import type { Draft } from './data'
import { MentionChip, MentionPicker, refKey, useMentionResults } from './Mentions'
import { insertAt, mentionQueryAt, removeMentionQuery } from './mentionText'
import './chat.css'

export interface ComposerHandle {
  /** Devuelve a la caja lo que se quitó de la cola o no se pudo enviar (solo si está vacía: nunca pisa lo que se está escribiendo). */
  restore: (text: string, mentions: AssistantRef[], files?: string[]) => void
  focus: () => void
}

export interface ComposerProps {
  busy: boolean
  /** Aula espera la respuesta a una pregunta o un permiso. */
  awaiting?: boolean
  onSend: (draft: Draft) => void
  onStop: () => void
  autoFocus?: boolean
  initial?: string
  /** El curso del tutor: sus lecciones salen primero al mencionar. */
  courseID?: string
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ busy, awaiting = false, onSend, onStop, autoFocus, initial = '', courseID }, ref) {
  const { t, i18n } = useTranslation('chat')
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(initial.length)
  const [files, setFiles] = useState<{ name: string; path: string }[]>([])
  const [mentions, setMentions] = useState<AssistantRef[]>([])
  const [highlighted, setHighlighted] = useState(0)
  /** La «@» cuyo selector se cerró con Esc (no vuelve a abrirse hasta escribir otra). */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  /** Cuántas veces se ha enviado (cambia la flecha: sale volando). */
  const [sent, setSent] = useState(0)
  const { reducedMotion } = useTheme()
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  const mention = useMemo(() => {
    const m = mentionQueryAt(text, caret)
    return m && m.at !== dismissedAt ? m : null
  }, [text, caret, dismissedAt])
  const { results, loading } = useMentionResults(mention ? mention.query : null, mentions, courseID)
  const open = mention !== null
  const active = Math.min(highlighted, Math.max(0, results.length - 1))

  const grow = () => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
    // la barra de desplazamiento solo cuando de verdad no cabe (si no, asoma una raya al lado del botón)
    el.style.overflowY = el.scrollHeight > 220 ? 'auto' : 'hidden'
  }
  const setValue = (value: string, at: number) => {
    setText(value)
    setCaret(at)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.setSelectionRange(at, at)
      grow()
    })
  }

  useImperativeHandle(ref, () => ({
    restore: (value, refs, paths) => {
      if (text.trim() || files.length) return
      setValue(value, value.length)
      setMentions(refs)
      if (paths?.length) setFiles(paths.map((p) => ({ name: p.split(/[\\/]/).pop() || p, path: p })))
      area.current?.focus()
    },
    focus: () => area.current?.focus()
  }))

  // A3-P2-7: más de 100 000 caracteres no se envía (antes la caja se vaciaba y el mensaje se perdía); se avisa antes
  const tooLong = text.length > MAX_MESSAGE_CHARS
  const nearLimit = text.length > MAX_MESSAGE_CHARS * 0.9
  const hasContent = (!!text.trim() || files.length > 0) && !tooLong
  const send = () => {
    if ((!text.trim() && !files.length) || tooLong) return
    onSend({ text: text.trim(), files: files.map((f) => f.path), mentions })
    setSent((n) => n + 1)
    setMentions([])
    setFiles([])
    setDismissedAt(null)
    setValue('', 0)
  }
  const pick = (r: AssistantRef) => {
    if (!mention) return
    const next = removeMentionQuery(text, mention.at, caret)
    setMentions((cur) => (cur.some((x) => refKey(x) === refKey(r)) ? cur : [...cur, r]))
    setHighlighted(0)
    setValue(next.text, next.caret)
  }
  const beginMention = () => {
    const el = area.current
    const at = el ? el.selectionStart : text.length
    const next = insertAt(text, at)
    setDismissedAt(null)
    setValue(next.text, next.caret)
    el?.focus()
  }
  const addFiles = (list: FileList | null) => {
    if (!list) return
    const next = Array.from(list).map((f) => ({ name: f.name, path: safePath(f) })).filter((f) => f.path)
    setFiles((cur) => [...cur, ...next].slice(0, 10))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    addFiles(e.dataTransfer.files)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissedAt(mention.at)
        return
      }
      if (results.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const n = results.length
        setHighlighted((active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (results.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
        e.preventDefault()
        pick(results[active])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const placeholder = awaiting ? t('placeholderAnswer') : busy ? t('placeholderQueue') : t('placeholder')
  const chips = mentions.length > 0 || files.length > 0
  return (
    <motion.div
      className="relative w-full"
      // el selector abierto se cierra con Esc sin cerrar el panel del tutor que lo contiene
      data-own-escape={open ? 'true' : undefined}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={spring.smooth}
    >
      <AnimatePresence>
        {open && <MentionPicker key="mentions" query={mention.query} results={results} loading={loading} highlighted={active} onPick={pick} onHover={setHighlighted} />}
      </AnimatePresence>
      <div
        // el mismo papel de los menús, pero SIN backdrop-filter: el desenfoque (casi invisible con --menu al 97 %) obligaba a
        // componer dos capas de ventana entera más: 135–180 MB de memoria de GPU solo en el chat (A5-P2-4)
        className={cx('w-full rounded-[24px] bg-[var(--menu)] border-[0.5px] border-line shadow-[var(--e3)] px-3 py-2.5 transition-shadow duration-300', drag && 'ring-2 ring-accent', busy && !drag && 'ring-1 ring-[var(--sun-glow)]')}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <AnimatePresence>
          {chips && (
            <motion.div className="flex flex-wrap gap-1.5 px-1 pb-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              {mentions.map((r) => (
                <MentionChip key={refKey(r)} r={r} onRemove={() => setMentions((c) => c.filter((x) => refKey(x) !== refKey(r)))} />
              ))}
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-[8px] bg-fill2 pl-2 pr-1 py-1 t-ui">
                  <Icon name="file-text" size={13} />
                  {f.name}
                  <button className="grid place-items-center w-4 h-4 rounded hover:bg-fill3" onClick={() => setFiles((c) => c.filter((_, k) => k !== i))} aria-label={t('removeFile', { name: f.name })}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-1.5">
          <IconButton label={t('attach')} onClick={() => picker.current?.click()}>
            <Icon name="plus" size={18} />
          </IconButton>
          <IconButton label={t('mention.button')} onClick={beginMention}>
            <span className="text-[17px] font-medium leading-none" aria-hidden>@</span>
          </IconButton>
          <input ref={picker} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <textarea
            ref={area}
            rows={1}
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart)
              setHighlighted(0)
              // la «@» que se cerró con Esc ya no está: la próxima vuelve a abrir el selector
              if (dismissedAt !== null && e.target.value[dismissedAt] !== '@') setDismissedAt(null)
              grow()
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setDismissedAt(mention ? mention.at : null)}
            onFocus={() => setDismissedAt(null)}
            placeholder={placeholder}
            className="flex-1 resize-none overflow-y-hidden bg-transparent outline-none t-body py-1.5 max-h-[220px] placeholder:text-text3"
            aria-label={t('placeholder')}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? 'aula-mention-list' : undefined}
            aria-activedescendant={open && results.length ? `aula-mention-${active}` : undefined}
          />
          <AnimatePresence initial={false}>
            {busy && (
              <motion.button
                key="stop"
                type="button"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={spring.snappy}
                whileTap={{ scale: 0.9 }}
                onClick={onStop}
                aria-label={t('stop')}
                title={t('stopHelp')}
                data-testid="chat-stop"
                className="relative grid place-items-center w-9 h-9 rounded-full shrink-0 bg-fill3 text-text hover:bg-fill4 transition-colors"
              >
                {/* un arco de sol gira alrededor mientras Aula trabaja */}
                {!reducedMotion && (
                  <svg className="chat-stop-ring absolute inset-0" viewBox="0 0 36 36" aria-hidden>
                    <circle cx="18" cy="18" r="16.5" fill="none" stroke="var(--sun)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="22 82" />
                  </svg>
                )}
                <span className="w-3 h-3 rounded-[3px] bg-current" />
              </motion.button>
            )}
            {(!busy || hasContent) && (
              <motion.div key="send" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} transition={spring.snappy}>
                <Tooltip label={busy && !awaiting ? t('queueHelp') : t('sendHelp')}>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={send}
                    aria-disabled={tooLong || undefined}
                    aria-label={busy && !awaiting ? t('queueSend') : t('send')}
                    className={cx('relative grid place-items-center w-9 h-9 overflow-hidden rounded-full shrink-0 transition-colors duration-200', hasContent ? 'bg-accent text-on-accent' : 'bg-fill2 text-text3')}
                  >
                    {/* al enviar, la flecha sale volando hacia arriba y vuelve otra */}
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={sent}
                        className="grid place-items-center"
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -18, opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
                        transition={spring.snappy}
                      >
                        <Icon name={busy && !awaiting ? 'clock' : 'arrow-up'} size={17} />
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </Tooltip>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {nearLimit && (
          <motion.p
            key="limit"
            role="status"
            data-testid="chat-too-long"
            className={cx('t-footnote mt-1.5 px-3 tabular', tooLong ? 'text-warning' : 'text-text3')}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {t(tooLong ? 'tooLong' : 'nearLimit', { chars: new Intl.NumberFormat(i18n.language).format(text.length), max: new Intl.NumberFormat(i18n.language).format(MAX_MESSAGE_CHARS) })}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

function safePath(f: File): string {
  try {
    return api.pathForFile(f)
  } catch {
    return ''
  }
}
