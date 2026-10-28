// Habla con Aula: conversaciones a la izquierda (en ventanas estrechas, en un panel que se abre con «Conversaciones»), la
// conversación en el centro (ancho de lectura cómodo) y la cápsula para escribir abajo. Lo que se escribe mientras Aula responde
// espera debajo de la respuesta y se envía al terminar. Vacío: la marca de Aula, una frase y sugerencias para empezar.
// La conversación en sí (pensando, pasos, texto que fluye, desplazamiento) está en Conversation.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutGroup, motion } from 'motion/react'
import { AulaMark, Button, Card, Chip, Companion, Drawer, Icon, toast, useMarkPhase } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import { useRoute } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { api } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { useConversation, useThreads, type Draft } from './data'
import { usePendingDeletes } from './deletion'
import { ThreadList } from './ThreadList'
import { Conversation } from './Conversation'
import { Composer, type ComposerHandle } from './Composer'
import { ChatActionsContext, type ChatActions } from './actions'

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
      if (!ok) composer.current?.restore(draft.text, draft.mentions, draft.files)
      void reload()
    } catch (e) {
      toast.error((e as Error).message)
      composer.current?.restore(draft.text, draft.mentions, draft.files)
    }
  }
  const ask = (text: string) => void send({ text, files: [], mentions: [] })
  const actions = useMemo<ChatActions>(() => ({ ask }), [activeId, conv.send])
  const cancel = async (id: string) => {
    const m = await conv.cancel(id)
    if (m) composer.current?.restore(m.text, m.mentions)
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

  const suggestions = t('suggestions', { returnObjects: true }) as string[]
  const emptyMark = useMarkPhase(busy.busy)
  // los compañeros del chat vacío son adorno: se mueven solo mientras alguien usa la app (design/ambient.ts)
  const moving = useAmbient()
  const emptyView = (
    <div className="flex flex-col items-center text-center pt-[12vh]">
      <div className="text-text">
        <AulaMark size={72} state={emptyMark} hover />
      </div>
      <h1 className="t-display text-[36px] mt-5">{t('emptyTitle')}</h1>
      <p className="t-body text-text2 mt-2 max-w-[480px]">{t('emptyBody')}</p>
      <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-[620px]">
        {suggestions.map((s, i) => (
          <motion.div key={s} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
            <Chip onClick={() => ask(s)}>{s}</Chip>
          </motion.div>
        ))}
      </div>
      <div className="flex gap-2 mt-10 opacity-80">
        {['luna', 'buho', 'libro', 'pluma'].map((id, i) => (
          <motion.div key={id} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.08 }}>
            <Companion id={id} size={34} working={moving} />
          </motion.div>
        ))}
      </div>
    </div>
  )
  return (
    <ChatActionsContext.Provider value={actions}>
      <div className="@container flex min-h-0 flex-1 gap-4 px-6 pb-4">
        <Card padded="sm" className="hidden @4xl:flex w-[280px] shrink-0 flex-col">
          <ThreadList threads={threads} active={activeId} onOpen={open} onNew={startNew} />
        </Card>
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
            onSend={(d) => void send(d)}
            onCancelQueued={(id) => void cancel(id)}
            empty={emptyView}
            contentClassName="mx-auto max-w-[760px] px-2 pt-4 pb-6"
          />
          <div className="mx-auto w-full max-w-[780px] px-2">
            <Composer ref={composer} key={prompt ?? 'composer'} initial={prompt ?? ''} busy={busy.busy} awaiting={conv.awaiting} autoFocus onSend={(d) => void send(d)} onStop={conv.stop} />
            <div className="t-caption text-center mt-2">{t('disclaimer')}</div>
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
