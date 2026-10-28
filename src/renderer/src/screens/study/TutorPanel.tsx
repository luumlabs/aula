// El tutor del curso en un panel a la derecha, sin salir del estudio: sabe el curso, el tema, el ejercicio y lo que
// respondiste (TutorContext). Usa la conversación del tutor de ese curso (chat.tutorThread) y lo mismo que el chat: sus mensajes,
// la caja con «@» (las lecciones de este curso primero), la cola de lo que se escribe mientras responde y los cuestionarios.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer, AulaMark, Chip, toast, useMarkPhase } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { Conversation } from '../chat/Conversation'
import { Composer, type ComposerHandle } from '../chat/Composer'
import { useConversation, type Draft } from '../chat/data'
import { ChatActionsContext, type ChatActions } from '../chat/actions'
import { tutorVisibleFor, useTutor } from './tutorStore'

export { useTutor } from './tutorStore'

/** `screenKey`: la clave de ruta de la pantalla que lo pinta (solo se enseña en la que lo abrió). */
export function TutorPanel({ screenKey }: { screenKey: string }) {
  const { t, i18n } = useTranslation('chat')
  const open = useTutor((s) => tutorVisibleFor(s, screenKey))
  const context = useTutor((s) => s.context)
  const prompt = useTutor((s) => s.prompt)
  const close = useTutor((s) => s.close)
  const courseID = context?.courseID
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
      if (!ok) composer.current?.restore(draft.text, draft.mentions, draft.files)
    })
  }
  const ask = (text: string) => send({ text, files: [], mentions: [] })
  const actions = useMemo<ChatActions>(() => ({ ask }), [thread?.id, context])
  const cancel = async (id: string) => {
    const m = await conv.cancel(id)
    if (m) composer.current?.restore(m.text, m.mentions)
  }

  // la pregunta con la que se abrió: se saca del store al enviarla, así que ni otra pantalla ni otro montaje la repiten
  useEffect(() => {
    if (!open || !thread || thread.id !== threadId || !prompt) return
    const p = useTutor.getState().takePrompt()
    if (p) ask(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, thread?.id, threadId, prompt])

  const quick = t('tutorQuick', { returnObjects: true }) as string[]
  const emptyMark = useMarkPhase(busy.busy)
  const emptyView = (
    <div className="flex flex-col items-center text-center pt-10">
      <AulaMark size={48} state={emptyMark} hover />
      <p className="t-body text-text2 mt-3 max-w-[320px]">{t('tutorEmpty')}</p>
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        {quick.map((q) => (
          <Chip key={q} onClick={() => ask(q)}>
            {q}
          </Chip>
        ))}
      </div>
    </div>
  )
  return (
    <Drawer open={open} onClose={close} width={460} title={t('tutorTitle')}>
      <ChatActionsContext.Provider value={actions}>
        <div className="flex h-full min-h-0 flex-col">
          <Conversation
            conv={conv}
            language={i18n.language}
            onSend={send}
            onCancelQueued={(id) => void cancel(id)}
            empty={emptyView}
            contentClassName="px-5 py-2"
            gapClassName="gap-6"
          />
          <div className="px-4 pt-3 pb-4">
            <Composer ref={composer} busy={busy.busy} awaiting={conv.awaiting} courseID={courseID} autoFocus onSend={send} onStop={conv.stop} />
          </div>
        </div>
      </ChatActionsContext.Provider>
    </Drawer>
  )
}
