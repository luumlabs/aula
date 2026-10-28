// Barra lateral del lector: miniaturas de las páginas, índice, mis marcas (con su color, su nota y quién la propuso) y buscar
// en el documento (cada resultado con su página y la línea donde aparece).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentAnnotation, DocumentView } from '@shared/documents'
import { MARK_COLORS, markCSS } from '@shared/documents'
import { ConfirmDialog, EmptyState, Icon, IconButton, Menu, SegmentedTabs, Spinner, TextField, cx, type MenuItem } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { openEntryPdf, pageThumbnail, pdfKey } from '../pdf'
import { boldParts, foldKeep } from '../lib'
import { removeMark, updateMark } from './marks'
import { useReader, type SidebarTab } from './store'

export function ReaderSidebar({ view }: { view: DocumentView }) {
  const { t } = useTranslation('documents')
  const tab = useReader((s) => s.sidebar)
  const set = useReader((s) => s.set)
  const marks = useReader((s) => s.marks)
  const items: { id: SidebarTab; label: React.ReactNode }[] = [
    { id: 'pages', label: <Icon name="layers" size={14} title={t('sidebar.pages')} /> },
    { id: 'outline', label: <Icon name="checklist" size={14} title={t('sidebar.outline')} /> },
    { id: 'marks', label: <span className="flex items-center gap-1"><Icon name="edit" size={14} title={t('sidebar.marks')} />{marks.length > 0 && <span className="tabular text-[11px]">{marks.length}</span>}</span> },
    { id: 'search', label: <Icon name="search" size={14} title={t('sidebar.search')} /> }
  ]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3 pb-2">
        <SegmentedTabs size="sm" fill items={items} value={tab} onChange={(v) => set({ sidebar: v })} />
        <div className="mt-2 px-1 t-caption font-semibold uppercase tracking-[0.06em] text-text3">{t(`sidebar.${tab}`)}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {tab === 'pages' && <PagesList view={view} />}
        {tab === 'outline' && <Outline view={view} />}
        {tab === 'marks' && <MarksList />}
        {tab === 'search' && <SearchPane />}
      </div>
    </div>
  )
}

// MARK: Páginas

function PagesList({ view }: { view: DocumentView }) {
  const page = useReader((s) => s.page)
  const goTo = useReader((s) => s.goTo)
  const marks = useReader((s) => s.marks)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const entry = view.entry
  useEffect(() => {
    if (entry.mode !== 'pdf') return
    let alive = true
    void openEntryPdf(entry).then((d) => alive && setPdf(d)).catch(() => undefined)
    return () => { alive = false }
  }, [entry])
  // la página actual, siempre a la vista
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-thumb="${page}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [page])
  const count = entry.mode === 'pdf' ? pdf?.numPages ?? 0 : entry.mode === 'image' ? 1 : view.pages.length
  if (entry.mode === 'pdf' && !pdf) return <div className="grid place-items-center py-10 text-text3"><Spinner size={14} /></div>
  return (
    <div ref={list} className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const marked = marks.some((m) => m.page === n)
        return (
          <button key={n} data-thumb={n} onClick={() => goTo(n)} className={cx('group flex items-center gap-3 rounded-[12px] p-2 text-left transition-colors', n === page ? 'bg-accent-wash' : 'hover:bg-fill1')}>
            {pdf ? <PdfThumb pdf={pdf} url={pdfKey(entry)} n={n} active={n === page} /> : <TextThumb text={view.pages[n - 1]?.heading ?? view.pages[n - 1]?.text ?? ''} active={n === page} />}
            <span className="min-w-0 flex-1">
              <span className={cx('block t-ui tabular', n === page ? 'font-semibold text-accent-text' : 'text-text2')}>{n}</span>
              {view.pages[n - 1]?.heading && <span className="block t-caption text-text3 line-clamp-2">{view.pages[n - 1].heading}</span>}
            </span>
            {marked && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: markCSS('yellow') }} />}
          </button>
        )
      })}
    </div>
  )
}

function PdfThumb({ pdf, url, n, active }: { pdf: PDFDocumentProxy; url: string; n: number; active: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect()
        void pageThumbnail(pdf, url, n, 72).then((s) => alive && setSrc(s)).catch(() => undefined)
      }
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [pdf, url, n])
  return (
    <span ref={ref} className={cx('block w-[60px] shrink-0 overflow-hidden rounded-[3px] bg-white shadow-[var(--e1)] transition-shadow', active && 'ring-2 ring-accent')}>
      {src ? <img src={src} alt="" className="block w-full" draggable={false} /> : <span className="block aspect-[0.77] w-full" />}
    </span>
  )
}

function TextThumb({ text, active }: { text: string; active: boolean }) {
  return (
    <span className={cx('block h-[72px] w-[56px] shrink-0 overflow-hidden rounded-[3px] bg-surface border-[0.5px] border-line p-1.5 shadow-[var(--e1)]', active && 'ring-2 ring-accent')}>
      <span className="block font-serif text-[5px] leading-[7px] text-text2 line-clamp-[9] break-words">{text.slice(0, 260)}</span>
    </span>
  )
}

// MARK: Índice

function Outline({ view }: { view: DocumentView }) {
  const { t } = useTranslation('documents')
  const pdfOutline = useReader((s) => s.outline)
  const goTo = useReader((s) => s.goTo)
  const page = useReader((s) => s.page)
  const outline = pdfOutline.length ? pdfOutline : view.outline
  if (!outline.length) return <div className="px-2 pt-6"><EmptyState title={t('sidebar.noOutline')} body={t('sidebar.noOutlineBody')} /></div>
  return (
    <div className="flex flex-col">
      {outline.map((e, i) => {
        const here = e.page <= page && page <= e.endPage
        return (
          <button key={i} onClick={() => goTo(e.page)} className={cx('flex items-baseline gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors hover:bg-fill1', here && 'bg-fill1')} style={{ paddingLeft: 10 + e.level * 12 }}>
            <span className={cx('min-w-0 flex-1 t-ui line-clamp-2', e.level === 0 ? 'font-medium text-text' : 'text-text2')}>{e.title}</span>
            <span className="t-caption tabular text-text3">{e.page}</span>
          </button>
        )
      })}
    </div>
  )
}

// MARK: Mis marcas

function MarksList() {
  const { t } = useTranslation('documents')
  const marks = useReader((s) => s.marks)
  if (!marks.length) return <div className="px-2 pt-6"><EmptyState title={t('marks.empty')} body={t('marks.emptyBody')} /></div>
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <AnimatePresence initial={false}>
        {marks.map((m) => <MarkRow key={m.id} mark={m} />)}
      </AnimatePresence>
    </div>
  )
}

function MarkRow({ mark }: { mark: DocumentAnnotation }) {
  const { t } = useTranslation('documents')
  const selected = useReader((s) => s.selectedMark === mark.id)
  const set = useReader((s) => s.set)
  const goTo = useReader((s) => s.goTo)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(mark.note ?? '')
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [selected])
  const items: MenuItem[] = [
    ...MARK_COLORS.map((c): MenuItem => ({ label: t(`colors.${c}`), icon: <span className="h-3 w-3 rounded-full" style={{ background: markCSS(c) }} />, onSelect: () => void updateMark(mark.id, { color: c }) })),
    { label: t('marks.editNote'), icon: <Icon name="edit" size={14} />, separatorBefore: true, onSelect: () => { setDraft(mark.note ?? ''); setEditing(true) } },
    { label: t('marks.delete'), icon: <Icon name="trash" size={14} />, danger: true, onSelect: () => setConfirm(true) }
  ]
  const save = (): void => { void updateMark(mark.id, { note: draft }); setEditing(false) }
  return (
    <motion.div ref={ref} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      onClick={() => { set({ selectedMark: mark.id }); goTo(mark.page) }}
      className={cx('rounded-[12px] p-2.5 transition-colors cursor-default', selected ? 'bg-accent-wash' : 'bg-fill1 hover:bg-fill2')}>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: markCSS(mark.color) }} />
        <span className="t-caption font-semibold text-text2 tabular">{t('reader.pageShort', { n: mark.page })}</span>
        <span className="t-caption text-text3">{t(`marks.kind.${mark.kind}`)}</span>
        {mark.author === 'aula' && <span title={t('marks.byAula')} className="text-text3"><Icon name="aula" size={12} /></span>}
        <span className="flex-1" />
        <span onClick={(e) => e.stopPropagation()}>
          <Menu items={items} trigger={(open) => <IconButton label={t('marks.options')} size="sm" onClick={open}><Icon name="more" size={14} /></IconButton>} />
        </span>
      </div>
      {mark.text && <p className="mt-1 font-serif text-[14px] leading-[20px] text-text line-clamp-4">{mark.text}</p>}
      {editing ? (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <TextField autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('marks.note')} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
          <div className="mt-1.5 flex justify-end"><button className="t-ui font-medium text-accent-text hover:underline" onClick={save}>{t('save')}</button></div>
        </div>
      ) : mark.note ? <p className="mt-1 t-footnote text-text2 whitespace-pre-wrap">{mark.note}</p> : null}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void removeMark(mark.id) }} title={t('marks.deleteTitle')} description={t('marks.deleteBody')} confirmLabel={t('marks.delete')} cancelLabel={t('cancel')} danger />
    </motion.div>
  )
}

// MARK: Buscar

function SearchPane() {
  const { t } = useTranslation('documents')
  const find = useReader((s) => s.find)
  const hits = useReader((s) => s.hits)
  const hitIndex = useReader((s) => s.hitIndex)
  const set = useReader((s) => s.set)
  const goTo = useReader((s) => s.goTo)
  const ref = useReader((s) => s.ref)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const q = find.trim()
    if (!ref || q.length < 2) { set({ hits: [], hitIndex: 0 }); return }
    setBusy(true)
    const id = setTimeout(() => {
      void api.invoke('documents.find', { ref, query: q }).then((h) => set({ hits: h, hitIndex: 0 })).catch(() => set({ hits: [] })).finally(() => setBusy(false))
    }, 280)
    return () => clearTimeout(id)
  }, [find, ref, set])
  const show = (i: number): void => {
    const h = hits[i]
    if (!h) return
    set({ hitIndex: i })
    goTo(h.page)
  }
  return (
    <div className="flex flex-col gap-2 px-1">
      <TextField data-doc-find autoFocus value={find} onChange={(e) => set({ find: e.target.value })} placeholder={t('sidebar.searchPlaceholder')} icon={<Icon name="search" size={14} />}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits.length) show(e.shiftKey ? (hitIndex - 1 + hits.length) % hits.length : (hitIndex + 1) % hits.length) }} />
      {find.trim().length >= 2 && (
        <div className="flex items-center justify-between px-1 t-footnote">
          <span>{busy ? t('search.searching') : t('sidebar.results', { count: hits.length })}</span>
          {hits.length > 1 && (
            <span className="flex gap-0.5">
              <IconButton label={t('sidebar.prev')} size="sm" onClick={() => show((hitIndex - 1 + hits.length) % hits.length)}><Icon name="chevron-up" size={13} /></IconButton>
              <IconButton label={t('sidebar.next')} size="sm" onClick={() => show((hitIndex + 1) % hits.length)}><Icon name="chevron-down" size={13} /></IconButton>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col">
        {hits.map((h, i) => (
          <button key={`${h.page}-${i}`} onClick={() => show(i)} className={cx('rounded-[10px] px-2.5 py-2 text-left transition-colors', i === hitIndex ? 'bg-accent-wash' : 'hover:bg-fill1')}>
            <span className="block t-caption font-semibold text-accent-text tabular">{t('reader.pageShort', { n: h.page })}</span>
            <span className="block t-footnote text-text2 line-clamp-3">{highlightQuery(h.snippet, find)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** El trozo con la búsqueda en negrita. */
function highlightQuery(snippet: string, q: string): React.ReactNode {
  const needle = q.trim()
  if (!needle) return snippet
  const i = foldKeep(snippet).indexOf(foldKeep(needle))
  if (i < 0) return boldParts(snippet).map((p, k) => <span key={k}>{p.text}</span>)
  return <>{snippet.slice(0, i)}<mark className="bg-[rgba(250,214,89,0.55)] text-text rounded-[3px]">{snippet.slice(i, i + needle.length)}</mark>{snippet.slice(i + needle.length)}</>
}
