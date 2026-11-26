// Habla con Aula: conversaciones a la izquierda (en ventanas estrechas, en un panel que se abre con «Conversaciones»), la
// conversación en el centro (ancho de lectura cómodo) y la cápsula para escribir abajo. Lo que se escribe mientras Aula responde
// espera debajo de la respuesta y se envía al terminar. Vacío: Aula habla primero, en serif y con los datos del estudiante
// (su examen, lo pendiente), con la lámpara a tinta al lado y tres sugerencias sacadas de sus cursos, en lista con filetes.
// La conversación en sí (pensando, pasos, texto que fluye, desplazamiento) está en Conversation.
import { useEffect, useMemo, useRef, useState } from 'react'
import { studentTextOf } from '@engine/assistant/trust'
import type { TutorContext } from '@shared/assistant/types'
import { Trans, useTranslation } from 'react-i18next'
import { LayoutGroup, motion } from 'motion/react'
import { AulaMark, Button, Drawer, Icon, InkSpot, cx, toast, useMarkPhase } from '@renderer/design'
import { useRoute } from '@renderer/app/router'
import { useRpc } from '@renderer/lib/useRpc'
import { useScreenTitle } from '@renderer/app/title'
import { api } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { showsAsSample } from '@renderer/lib/sample'
import { useConversation, useThreads, type Draft } from './data'
import { usePendingDeletes } from './deletion'
import { ThreadList } from './ThreadList'
import { Conversation } from './Conversation'
import { Composer, type ComposerHandle } from './Composer'
import { ChatActionsContext, type ChatActions } from './actions'
import { keepWhole, openingFor, type OpeningSuggestion } from './opening'
import { IdeaList } from './IdeaList'

export default function ChatScreen() {
  const { t, i18n } = useTranslation('chat')
  const route = useRoute()
  const { threads, reload } = useThreads()
  const [activeId, setActiveId] = useState<string | null>(route.name === 'chat' ? route.conversation ?? null : null)
  const conv = useConversation(activeId)
  const { thread, setThread, busy } = conv
  const [listOpen, setListOpen] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const prompt = route.name === 'chat' ? route.prompt : undefined
  useScreenTitle(thread?.title || t('title'), null, [thread?.title])

  const routeConversation = route.name === 'chat' ? route.conversation : undefined
  useEffect(() => {
    if (routeConversation) setActiveId(routeConversation)
  }, [routeConversation])
  // en demostración se abre la primera conversación al entrar, solo una vez (después «Nueva conversación» debe quedarse vacía)
  const demoPicked = useRef(false)
  useEffect(() => {
    if (demoPicked.current || !threads.length) return
    demoPicked.current = true
    if (!activeId && !prompt && isDemo()) setActiveId(threads[0].id)
  }, [threads, activeId, prompt])
  // la conversación pedida no existe (p. ej. «Responder» desde Novedades): una nueva, con lo escrito en la caja (J2-5)
  const missing = conv.missing && !thread
  useEffect(() => {
    if (missing) setActiveId(null)
  }, [missing])
  // la que se acaba de borrar deja de estar abierta (si se deshace, vuelve a la lista)
  const pendingDeletes = usePendingDeletes((s) => s.ids)
  useEffect(() => {
    if (activeId && pendingDeletes.includes(activeId)) {
      setActiveId(null)
      setThread(null)
    }
  }, [pendingDeletes, activeId, setThread])
  const send = async (draft: Draft) => {
    try {
      let id = activeId
      if (!id || missing) {
        const th = await api.invoke('chat.newThread', undefined)
        id = th.id
        setActiveId(id)
        setThread(th)
      }
      const ok = await conv.send(id, draft)
      if (!ok) composer.current?.restore(studentTextOf(draft), draft.mentions, draft.files)
      void reload()
    } catch (e) {
      toast.error((e as Error).message)
      composer.current?.restore(studentTextOf(draft), draft.mentions, draft.files)
    }
  }
  const ask = (text: string, context?: TutorContext) => void send({ text, files: [], mentions: [], ...(context ? { context } : {}) })
  const actions = useMemo<ChatActions>(() => ({ ask }), [activeId, conv.send])
  const cancel = async (id: string) => {
    const m = await conv.cancel(id)
    if (m) composer.current?.restore(studentTextOf(m), m.mentions)
  }
  const open = (id: string) => {
    setActiveId(id)
    setListOpen(false)
  }
  const startNew = () => {
    setActiveId(null)
    setThread(null)
    setListOpen(false)
    requestAnimationFrame(() => composer.current?.focus())
  }

  const emptyView = <EmptyOpening busy={busy.busy} onAsk={ask} />
  // «puede equivocarse»: cuando ya hay algo que comprobar, no antes (sin mover la caja de sitio)
  const spoken = (thread?.messages.length ?? 0) > 0
  return (
    <ChatActionsContext.Provider value={actions}>
      <div className="aula-chat-paper @container flex min-h-0 flex-1 gap-4 px-4 pb-4 @lg:px-6">
        {/* las conversaciones, sobre el papel y separadas por un filete (no es un objeto: no va en tarjeta) */}
        <div className="hidden @4xl:flex w-[268px] shrink-0 flex-col border-r border-rule pr-4 pt-1">
          <ThreadList threads={threads} active={activeId} onOpen={open} onNew={startNew} />
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* ventana estrecha: la lista no cabe al lado; se abre en un panel */}
          <div className="@4xl:hidden flex items-center gap-1.5 pt-1">
            <Button size="sm" variant="secondary" icon={<Icon name="chat" size={14} />} onClick={() => setListOpen(true)} aria-haspopup="dialog">
              {t('threads')}
              {threads.length > 0 && <span className="ml-1 tabular text-text3">{threads.length}</span>}
            </Button>
            <Button size="sm" variant="ghost" icon={<Icon name="new-chat" size={14} />} onClick={startNew}>
              {t('newShort')}
            </Button>
          </div>
          <Conversation
            conv={conv}
            language={i18n.language}
            onCancelQueued={(id) => void cancel(id)}
            empty={emptyView}
            contentClassName="mx-auto max-w-[760px] px-2 pt-5 pb-6"
            jumpClassName="max-w-[780px] px-2"
          />
          <div className="mx-auto w-full max-w-[780px] px-2">
            <Composer ref={composer} key={prompt ?? 'composer'} initial={prompt ?? ''} busy={busy.busy} awaiting={conv.awaiting} autoFocus onSend={(d) => void send(d)} onStop={conv.stop} />
            <div className={cx('t-caption text-center mt-2', !spoken && 'invisible')} aria-hidden={!spoken || undefined}>{t('disclaimer')}</div>
          </div>
        </div>
        <Drawer open={listOpen} onClose={() => setListOpen(false)} side="left" width={320}>
          <div className="h-full p-4">
            {/* la selección que se desliza no salta desde la lista escondida */}
            <LayoutGroup id="chat-threads-drawer">
              <ThreadList threads={threads} active={activeId} onOpen={open} onNew={startNew} />
            </LayoutGroup>
          </div>
        </Drawer>
      </div>
    </ChatActionsContext.Provider>
  )
}

/** El chat vacío: Aula habla primero, en serif, con el examen más cercano y lo pendiente de hoy, y propone tres ideas sacadas de
 *  sus cursos. Sin cursos propios (o solo el de ejemplo), una pregunta y las ideas de siempre. Mientras llega el resumen no se
 *  enseña nada (sin saltos). */
function EmptyOpening({ busy, onAsk }: { busy: boolean; onAsk: (text: string) => void }) {
  const { t } = useTranslation('chat')
  const mark = useMarkPhase(busy)
  const { data: summary, error } = useRpc('home.summary', undefined, { events: ['courses.changed', 'calendar.changed'] as never })
  const ready = summary !== undefined || error !== null
  const opening = summary ? openingFor(summary, new Date(), showsAsSample) : null
  const ideas = opening ? opening.suggestions.map((s) => suggestionText(s, t)) : (t('suggestions', { returnObjects: true }) as string[]).slice(0, 3)
  const pending: string[] = []
  if (opening?.mistakes) pending.push(t('opening.mistakes', { count: opening.mistakes }))
  if (opening?.dueCards) pending.push(t('opening.cards', { count: opening.dueCards }))
  const exam = opening?.exam
  // el nombre del examen, entero en su línea si es corto (y en español, con su «para»): el título no se parte por la mitad.
  // En el teléfono no: no cabe en la línea y se cortaba en el borde («Exam #2 — Trigonor»)
  const keep = <span className={exam && keepWhole(exam.title) ? 'whitespace-nowrap phone:whitespace-normal' : undefined} />
  const title = exam ? (
    exam.days === 0
      ? <Trans t={t} i18nKey="opening.examToday" values={{ exam: exam.title }} components={{ keep }} />
      : <Trans t={t} i18nKey="opening.exam" count={exam.days} values={{ exam: exam.title, count: exam.days }} components={{ keep }} />
  ) : t('emptyTitle')
  return (
    // en el teléfono, una sola columna: el flexo, más pequeño, encima de lo que dice Aula (al lado le dejaba 250 px al título)
    <div data-chat-opening className="mx-auto grid w-full max-w-[700px] grid-cols-[100px_minmax(0,1fr)] gap-x-6 pt-[9vh] text-left phone:grid-cols-1 phone:gap-y-2 phone:pt-[4vh]">
      {/* el flexo encendido sobre la mesa, pequeño, en el margen de lo que dice Aula (mientras piensa, su marca) */}
      <div className="pt-1">
        {busy ? <div className="grid h-[84px] w-[100px] place-items-center text-text phone:h-[56px] phone:w-[66px]"><AulaMark size={48} state={mark} hover /></div> : <InkSpot name="lamp" className="h-[84px] w-[100px] phone:h-[56px] phone:w-[66px]" />}
      </div>
      <motion.div className="min-w-0" initial={false} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.25 }} aria-busy={!ready || undefined}>
        <h1 className="font-serif text-[2rem] leading-[calc(38rem/15)] tracking-[-0.3px] text-text text-balance phone:text-[1.6rem] phone:leading-[1.25]">{ready ? title : '\u00a0'}</h1>
        <p className="mt-2 font-serif text-[calc(18rem/15)] leading-[calc(27rem/15)] text-text2 text-pretty">
          {ready ? (pending.length ? t('opening.pending', { list: pending.join(t('opening.and')) }) : opening ? t('opening.ready') : t('emptyBody')) : '\u00a0'}
        </p>
        {/* tres ideas sacadas de sus cursos, como una lista con filetes (no chips) */}
        {ready && <IdeaList ideas={ideas} onPick={onAsk} label={opening ? t('opening.ideas') : undefined} className="mt-7" />}
      </motion.div>
    </div>
  )
}

function suggestionText(s: OpeningSuggestion, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (s.kind) {
    case 'topic': return t('opening.ideaTopic', { topic: s.topic })
    case 'mistakes': return t('opening.ideaMistakes', { count: s.count })
    case 'cards': return t('opening.ideaCards', { count: s.count })
    case 'exam': return t('opening.ideaExam', { exam: s.title })
  }
}
