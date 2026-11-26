// El tutor del curso en un panel a la derecha, sin salir del estudio: sabe el curso, el tema, el ejercicio y lo que
// respondiste (TutorContext). Usa la conversación del tutor de ese curso (chat.tutorThread) y lo mismo que el chat: sus mensajes,
// la caja con «@» (las lecciones de este curso primero), la cola de lo que se escribe mientras responde y los cuestionarios.
// En una ventana ancha es una columna al lado: empuja el ejercicio a la izquierda y no tapa nada («Intentar de nuevo» sigue a
// la vista). En una estrecha no cabe al lado: se abre encima, como un cajón. Bajo el título, una línea dice qué está mirando
// («Mirando: ejercicio 1 de 10»). Vacío, Aula habla primero y propone preguntas rápidas (como el chat vacío).
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { studentTextOf } from '@engine/assistant/trust'
import type { TutorContext } from '@shared/assistant/types'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Drawer, AulaMark, Icon, IconButton, toast, useMarkPhase, useTheme } from '@renderer/design'
import { useScreenActive } from '@renderer/app/router'
import { api } from '@renderer/lib/api'
import { RichText } from '@renderer/lib/RichText'
import { Conversation } from '../chat/Conversation'
import { Composer, type ComposerHandle } from '../chat/Composer'
import { draftContext, useConversation, type Draft } from '../chat/data'
import { ChatActionsContext, type ChatActions } from '../chat/actions'
import { IdeaList } from '../chat/IdeaList'
import { useStudyStore } from './data'
import { tutorLooking, tutorQuickIdeas, tutorVisibleFor, useTutor, type TutorLooking } from './tutorStore'
import { exerciseTarget, focusBackTarget, shouldMoveFocus } from './tutorFocus'
import { tabbables } from '@renderer/design/focusTrap'

export { useTutor } from './tutorStore'

/** Ancho del panel y desde qué ventana va al lado del ejercicio (y no encima). */
const PANEL_W = 440
const SIDE_QUERY = '(min-width: 1180px)'

function useSideBySide(): boolean {
  const [side, setSide] = useState(() => typeof window !== 'undefined' && window.matchMedia(SIDE_QUERY).matches)
  useEffect(() => {
    const m = window.matchMedia(SIDE_QUERY)
    const on = (): void => setSide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return side
}

/** `screenKey`: la clave de ruta de la pantalla que lo pinta (solo se enseña en la que lo abrió). */
export function TutorPanel({ screenKey }: { screenKey: string }) {
  const { t, i18n } = useTranslation('chat')
  const open = useTutor((s) => tutorVisibleFor(s, screenKey))
  const context = useTutor((s) => s.context)
  const position = useTutor((s) => s.position)
  const prompt = useTutor((s) => s.prompt)
  const close = useTutor((s) => s.close)
  const courseID = context?.courseID
  // el título del tema, del curso que ya cargó el estudio
  const skillTitle = useStudyStore((s) => (courseID && context?.skillID ? s.courses[courseID]?.skills.find((k) => k.id === context.skillID)?.title : undefined))
  const looking = lookingText(tutorLooking(context, position, skillTitle), t)
  // la conversación y el curso al que pertenece (la pregunta nunca va al hilo de otro curso)
  const [tutorThread, setTutorThread] = useState<{ id: string; courseID: string } | null>(null)
  const threadId = tutorThread && tutorThread.courseID === courseID ? tutorThread.id : null
  const conv = useConversation(threadId)
  const { thread, busy, adopt } = conv
  const composer = useRef<ComposerHandle>(null)

  // la conversación del tutor de este curso
  useEffect(() => {
    if (!open || !courseID) return
    let alive = true
    api
      .invoke('chat.tutorThread', { courseID })
      .then((th) => {
        if (!alive) return
        setTutorThread({ id: th.id, courseID })
        adopt(th)
      })
      .catch((e: unknown) => toast.error((e as Error).message))
    return () => {
      alive = false
    }
  }, [open, courseID, adopt])

  const send = (draft: Draft) => {
    if (!thread || (!draft.text.trim() && !draft.files.length)) return
    void conv.send(thread.id, draft, context ?? undefined).then((ok) => {
      if (!ok) composer.current?.restore(studentTextOf({ text: draft.text, context: draftContext(draft, context ?? undefined) }), draft.mentions, draft.files)
    })
  }
  const ask = (text: string, extraContext?: TutorContext) =>
    send({ text, files: [], mentions: [], ...(extraContext ? { context: { ...(context ?? {}), ...extraContext, screen: extraContext.screen ?? context?.screen } } : {}) })
  const actions = useMemo<ChatActions>(() => ({ ask }), [thread?.id, context])
  const cancel = async (id: string) => {
    const m = await conv.cancel(id)
    if (m) composer.current?.restore(studentTextOf(m), m.mentions)
  }

  // la pregunta con la que se abrió: se saca del store al enviarla, así que ni otra pantalla ni otro montaje la repiten
  useEffect(() => {
    if (!open || !thread || thread.id !== threadId || !prompt) return
    const p = useTutor.getState().takePrompt()
    if (p) ask(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, thread?.id, threadId, prompt])

  // «¿Dónde me equivoqué?» solo después de fallar (antes de responder no hay nada en que equivocarse)
  const quick = tutorQuickIdeas(t('tutorQuick', { returnObjects: true }) as string[], t('tutorQuickWrong'), context?.lastResult)
  const emptyMark = useMarkPhase(busy.busy)
  // vacío: Aula habla primero (como en el chat) y propone preguntas rápidas en filas con filete
  const emptyView = (
    <div className="pt-3">
      <div className="mb-1 flex items-center gap-2 text-text">
        <AulaMark size={24} state={emptyMark} hover />
        <span className="font-serif text-[calc(16rem/15)] font-medium">Aula</span>
      </div>
      <p className="pl-[32px] font-serif text-[calc(15.5rem/15)] leading-[1.55] text-text2">{t('tutorEmpty')}</p>
      <IdeaList ideas={quick} onPick={ask} className="mt-5 ml-[32px]" />
    </div>
  )
  const body = (
    <ChatActionsContext.Provider value={actions}>
      <div className="flex h-full min-h-0 flex-col">
        <Conversation
          conv={conv}
          language={i18n.language}
          onCancelQueued={(id) => void cancel(id)}
          empty={emptyView}
          contentClassName="px-5 py-2 tutor-notes"
          gapClassName="gap-6"
        />
        <div className="px-4 pt-3 pb-4">
          <Composer ref={composer} busy={busy.busy} awaiting={conv.awaiting} courseID={courseID} autoFocus onSend={send} onStop={conv.stop} />
        </div>
      </div>
    </ChatActionsContext.Provider>
  )
  return (
    <TutorShell open={open} onClose={close} title={t('tutorTitle')}>
      <TutorHeader title={t('tutorTitle')} looking={looking} closeLabel={t('tutorClose')} onClose={close} />
      <div className="min-h-0 flex-1">{body}</div>
    </TutorShell>
  )
}

/** «Mirando: ejercicio 1 de 10», «Mirando: Ángulos de referencia, paso 2»… */
function lookingText(l: TutorLooking | null, t: TFunction<'chat'>): string | null {
  if (!l) return null
  switch (l.kind) {
    case 'exercise': return t('tutorLooking.exercise', { n: l.n, m: l.m })
    case 'lesson': return t('tutorLooking.lesson', { skill: l.skill, n: l.step })
    case 'topicExercise': return t('tutorLooking.topicExercise', { skill: l.skill })
    case 'topic': return t('tutorLooking.topic', { skill: l.skill })
  }
}

/** El título, lo que está mirando y cerrar (igual en la columna y en el cajón). */
function TutorHeader({ title, looking, closeLabel, onClose }: { title: string; looking: string | null; closeLabel: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-2">
      <div className="min-w-0">
        <h2 className="t-title2">{title}</h2>
        {looking && (
          <p data-tutor-looking className="mt-0.5 truncate t-footnote text-text2" title={looking}>
            <RichText text={looking} inline ui />
          </p>
        )}
      </div>
      <IconButton label={closeLabel} size="sm" data-close onClick={onClose} className="-mr-1 shrink-0">
        <Icon name="close" size={15} />
      </IconButton>
    </div>
  )
}

/** Al cerrar el tutor, el foco vuelve a lo que lo abrió (si ya no está, al botón del tutor o al ejercicio): en la columna se
 *  quedaba en <body>, y el cajón lo devolvía a su propia caja, que se había enfocado sola al abrirse. */
function useFocusBack(open: boolean, panel: RefObject<HTMLElement | null>): void {
  const screenActive = useScreenActive()
  const opener = useRef<HTMLElement | null>(null)
  // se apunta al abrirse, aún dentro del clic o la tecla que lo abre: después, la caja (autoFocus) ya tiene el foco
  useEffect(
    () =>
      useTutor.subscribe((s, prev) => {
        if (s.open && !prev.open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }),
    []
  )
  const wasOpen = useRef(open)
  useEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    // al irse a otra pantalla también se cierra, pero ahí el foco es cosa de la pantalla nueva
    if (!closed || !screenActive) return
    const active = document.activeElement
    if (!shouldMoveFocus(active, document.body, !!active && !!panel.current?.contains(active))) return
    const screen: ParentNode = document.querySelector('[data-screen][data-active="true"]') ?? document
    const study = screen.querySelector<HTMLElement>('[data-study-main]')
    const button = screen.querySelector<HTMLElement>('[data-tutor-button]') ?? document.querySelector<HTMLElement>('[data-tutor-button]')
    const target = focusBackTarget([opener.current, button, study ? exerciseTarget(tabbables(study)) : null])
    opener.current = null
    target?.focus({ preventScroll: true })
  }, [open, screenActive, panel])
}

/** El marco del panel: columna al lado (ventana ancha) o cajón encima (estrecha). Sobre `surface`, no `raised`: en oscuro, la
 *  burbuja de lo que escribe el estudiante se perdía en el fondo. */
function TutorShell({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const side = useSideBySide()
  const { reducedMotion } = useTheme()
  const panel = useRef<HTMLDivElement>(null)
  useFocusBack(open, panel)
  // Esc cierra el tutor antes que el modo de estudio (salvo un menú o la lista de «@» abiertos, que se cierran ellos)
  useEffect(() => {
    if (!open || !side) return
    const fn = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const own = (e.target as HTMLElement | null)?.closest?.('[data-own-escape="true"]')
      const popup = document.querySelector('[role="menu"][data-aula-menu], [role="listbox"][data-aula-select]')
      if (own || popup || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [open, side, onClose])
  if (!side)
    return (
      <Drawer open={open} onClose={onClose} width={460} className="bg-surface!">
        <div ref={panel} className="flex h-full min-h-0 flex-col">{children}</div>
      </Drawer>
    )
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="tutor"
          aria-label={title}
          className="relative shrink-0 overflow-hidden"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: PANEL_W + 12, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <div ref={panel} className="absolute inset-y-0 right-3 flex flex-col pb-3 pt-1" style={{ width: PANEL_W }}>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border-[0.5px] border-line bg-surface shadow-[var(--e2)]">{children}</div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
