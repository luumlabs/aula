// Aula al lado del documento: su marca (el sol se mueve mientras lee), lo que se le puede pedir escrito como frases, las
// respuestas como prosa con las citas «(p. N)» que llevan a la página, las tarjetas propuestas para guardarlas en una lección y
// la caja de escribir abajo.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { DocumentAIAction, DocumentCardTarget } from '@shared/documents'
import { citedPages } from '@shared/documents'
import { AulaMark, Button, EmptyState, Icon, IconButton, Menu, Spinner, cx, toast, type MenuItem } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { PixelCheck } from '@renderer/design'
import { askAula, chapterAction, clearAula, stopAula } from './aula'
import { useReader, type AulaItem } from './store'

export function AulaPanel({ hasAI, onClose }: { hasAI: boolean | null; onClose: () => void }) {
  const { t } = useTranslation('documents')
  const items = useReader((s) => s.items)
  const busy = items.some((i) => !i.done)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [items.length, items[items.length - 1]?.text.length])
  const more: MenuItem[] = [{ label: t('aula.clear'), icon: <Icon name="trash" size={14} />, danger: true, onSelect: clearAula }]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
        <AulaMark size={22} state={busy ? 'working' : 'idle'} />
        <span className="font-serif text-[19px] leading-none">Aula</span>
        <span className="flex-1" />
        {items.length > 0 && <Menu items={more} trigger={(open) => <IconButton label={t('aula.more')} size="sm" onClick={open}><Icon name="more" size={15} /></IconButton>} />}
        <IconButton label={t('aula.close')} size="sm" onClick={onClose}><Icon name="close" size={14} /></IconButton>
      </div>
      <div className="h-px bg-line-soft mx-4" />
      {hasAI === false ? (
        <div className="flex-1 grid place-items-center px-5">
          <EmptyState title={t('aula.noAI')} body={t('aula.noAIBody')} mark="offline" action={<Button onClick={() => navigate({ name: 'settings', section: 'ai' })}>{t('aula.openSettings')}</Button>} />
        </div>
      ) : (
        <>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-6">
              <AnimatePresence initial={false}>
                {items.map((it) => <Answer key={it.id} item={it} />)}
              </AnimatePresence>
              {!busy && <Suggestions first={items.length === 0} />}
            </div>
          </div>
          <AskField busy={busy} onStop={() => { const last = items.find((i) => !i.done); if (last) void stopAula(last.id) }} />
        </>
      )}
    </div>
  )
}

function Suggestions({ first }: { first: boolean }) {
  const { t } = useTranslation('documents')
  const page = useReader((s) => s.page)
  const selection = useReader((s) => s.selection)
  const view = useReader((s) => s.view)
  const options: { title: string; action: DocumentAIAction }[] = [
    { title: t('aula.suggest.page'), action: { type: 'summarizePage', page } },
    { title: t('aula.suggest.chapter'), action: chapterAction(page) },
    { title: t('aula.suggest.document'), action: { type: 'summarizeDocument' } },
    { title: t('aula.suggest.exam'), action: { type: 'examFocus' } }
  ]
  if (selection?.text) {
    options.unshift(
      { title: t('aula.suggest.explain'), action: { type: 'explain', selection: selection.text, page: selection.page } },
      { title: t('aula.suggest.cards'), action: { type: 'cards', selection: selection.text, page: selection.page } },
      { title: t('aula.suggest.practice'), action: { type: 'practice', selection: selection.text, page: selection.page } }
    )
  }
  return (
    <div>
      {first && (
        <div className="mb-4">
          <p className="font-serif text-[17px] leading-[24px] text-text">{t('aula.hello')}</p>
          <p className="t-footnote mt-1">{t('aula.helloBody', { title: view?.entry.title ?? '' })}</p>
        </div>
      )}
      <div className="t-footnote font-semibold text-text2 mb-1.5">{t('aula.ask')}</div>
      <div className="flex flex-col">
        {options.map((o, i) => (
          <motion.button key={o.title} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
            onClick={() => void askAula(o.action)}
            className="group flex items-center gap-2 border-t-[0.5px] border-line-soft first:border-t-0 py-2 text-left t-callout text-text hover:text-accent-text transition-colors">
            <span className="flex-1">{o.title}</span>
            <Icon name="arrow-right" size={13} className="text-text3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </motion.button>
        ))}
      </div>
    </div>
  )
}

/** Las citas «(p. N)» y «[p. N]» como enlaces que llevan a la página (se pulsan dentro de la respuesta). */
function withPageLinks(text: string, maxPage: number): string {
  return text.replace(/([([])?\b(pp?\.)\s*(\d{1,4})((?:\s*[–-]\s*\d{1,4})?)([)\]])?/g, (m, open: string | undefined, p: string, n: string, range: string, close: string | undefined) => {
    const page = Number(n)
    if (!(page >= 1 && page <= maxPage)) return m
    return `${open ?? ''}[${p} ${n}${range}](#aula-page-${page})${close ?? ''}`
  })
}

function Answer({ item }: { item: AulaItem }) {
  const { t } = useTranslation('documents')
  const goTo = useReader((s) => s.goTo)
  const pageCount = useReader((s) => s.pageCount)
  const text = useMemo(() => withPageLinks(item.text, pageCount), [item.text, pageCount])
  const cited = item.cited.length ? item.cited : item.done ? citedPages(item.text, pageCount) : []
  const showCards = item.action.type === 'cards' && item.done && item.cards.length > 0
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2.5">
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-[18px] rounded-br-[7px] bg-bubble px-3.5 py-2 t-callout">{item.title}</div>
      </div>
      {item.error ? (
        <div className="rounded-[14px] bg-danger-soft px-3.5 py-3">
          <div className="t-ui font-semibold text-danger">{t('aula.failed')}</div>
          <div className="t-footnote text-text2 mt-0.5">{item.error}</div>
          <button className="mt-2 t-ui font-medium text-accent-text hover:underline" onClick={() => void askAula(item.action)}>{t('retry')}</button>
        </div>
      ) : !item.text ? (
        <div className="flex items-center gap-2 t-callout text-text3"><Spinner size={12} /> {t('aula.reading')}</div>
      ) : showCards ? (
        <CardsProposal item={item} />
      ) : (
        <>
          <div
            className="aula-answer selectable t-callout text-text [&_p]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_h1]:font-serif [&_h2]:font-serif [&_h3]:font-serif [&_h1]:text-[18px] [&_h2]:text-[17px] [&_h3]:text-[16px] [&_h1,&_h2,&_h3]:mt-3 [&_h1,&_h2,&_h3]:mb-1.5 [&_a[href^='#aula-page']]:text-accent-text [&_a[href^='#aula-page']]:no-underline [&_a[href^='#aula-page']]:font-medium [&_a[href^='#aula-page']]:tabular-nums"
            onClickCapture={(e) => {
              const a = (e.target as HTMLElement).closest('a')
              const m = a?.getAttribute('href')?.match(/^#aula-page-(\d+)$/)
              if (m) { e.preventDefault(); e.stopPropagation(); goTo(Number(m[1])) }
            }}
          >
            <RichText text={text} />
            {!item.done && <span className="inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-accent/70" />}
          </div>
          {item.done && cited.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 t-footnote">
              <span className="text-text3">{t('aula.goTo')}</span>
              {cited.map((p) => <button key={p} onClick={() => goTo(p)} className="font-medium text-accent-text underline-offset-2 hover:underline tabular">{t('reader.pageShort', { n: p })}</button>)}
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

function CardsProposal({ item }: { item: AulaItem }) {
  const { t } = useTranslation('documents')
  const ref = useReader((s) => s.ref)
  const updateItem = useReader((s) => s.updateItem)
  const [targets, setTargets] = useState<DocumentCardTarget[] | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    void api.invoke('documents.cardTargets', ref ? { ref } : {}).then(setTargets).catch(() => setTargets([]))
  }, [ref])
  const save = async (courseId: string, skillId: string, skillTitle: string): Promise<void> => {
    setSaving(true)
    try {
      const r = await api.invoke('documents.saveCards', { courseId, skillId, cards: item.cards, page: item.page, ...(ref ? { ref } : {}) })
      updateItem(item.id, { saved: skillTitle })
      toast.success(t('aula.cardsSaved', { count: r.saved, lesson: skillTitle }))
    } catch (e) {
      toast.error(t('aula.cardsFailed'), e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const first = targets?.[0]
  const sameCourse = first && ref && ref.kind !== 'import' && first.courseId === ref.packId
  const menu: MenuItem[] = (sameCourse ? [first] : targets ?? []).flatMap((c, ci) => [
    ...(sameCourse ? [] : [{ label: <span className="t-caption font-semibold uppercase tracking-wide text-text3">{c.courseTitle}</span>, onSelect: () => undefined, disabled: true, separatorBefore: ci > 0 } as MenuItem]),
    ...c.skills.slice(0, 30).map((s): MenuItem => ({ label: <span className="truncate max-w-[260px] inline-block align-bottom">{s.title}</span>, onSelect: () => void save(c.courseId, s.id, s.title) }))
  ])
  return (
    <div className="flex flex-col gap-2">
      {item.cards.map((c, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 6, rotate: -0.6 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: i * 0.06 }} className="rounded-[14px] bg-sunken border-[0.5px] border-line-soft px-3.5 py-2.5">
          <div className="t-callout text-text"><RichText text={c.front} inline /></div>
          <div className="my-1.5 h-px bg-line-soft" />
          <div className="t-footnote text-text2"><RichText text={c.back} inline /></div>
        </motion.div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        {item.saved ? (
          <span className="flex items-center gap-1.5 t-ui font-medium text-success"><PixelCheck size={16} /> {t('aula.savedIn', { lesson: item.saved })}</span>
        ) : targets && targets.length === 0 ? (
          <span className="t-footnote">{t('aula.noCourses')}</span>
        ) : (
          <Menu align="start" items={menu} trigger={(open) => (
            <Button size="sm" variant="secondary" loading={saving || !targets} onClick={open} icon={<Icon name="cards" size={13} />}>{sameCourse ? t('aula.saveInLesson') : t('aula.saveInCourse')}</Button>
          )} />
        )}
      </div>
    </div>
  )
}

function AskField({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  const { t } = useTranslation('documents')
  const [q, setQ] = useState('')
  const send = (): void => {
    const text = q.trim()
    if (!text || busy) return
    setQ('')
    void askAula({ type: 'ask', question: text })
  }
  return (
    <div className="p-3">
      <div className={cx('flex items-end gap-2 rounded-[18px] border-[0.5px] border-line bg-field px-3 py-2 shadow-[var(--e1)] focus-within:border-accent-line transition-colors')}>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          placeholder={t('aula.placeholder')}
          className="selectable max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent py-1 t-callout outline-none placeholder:text-text3"
        />
        {busy ? (
          <IconButton label={t('aula.stop')} size="sm" variant="filled" onClick={onStop}><Icon name="stop" size={13} /></IconButton>
        ) : (
          <IconButton label={t('aula.send')} size="sm" variant="filled" disabled={!q.trim()} onClick={send} className={cx(q.trim() && 'bg-accent! text-on-accent!')}><Icon name="arrow-up" size={14} /></IconButton>
        )}
      </div>
    </div>
  )
}
