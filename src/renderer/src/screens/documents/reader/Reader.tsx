// El lector de documentos: PDF (páginas dibujadas con pdf.js, texto seleccionable), texto (Word, Markdown, web…) con la letra
// de lectura, y fotos. Barra lateral (páginas, índice, marcas, buscar), zoom, ir a una página, subrayados y notas que se guardan
// aparte (el original no cambia) y Aula al lado con acciones de un clic sobre lo que se lee.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { DocumentRef } from '@shared/documents'
import { docKey } from '@shared/documents'
import { AulaMark, Button, Card, EmptyState, Icon, IconButton, Menu, Spinner, cx, spring, toast, toneForHue, useTheme, type MenuItem } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { useRpc } from '@renderer/lib/useRpc'
import { percentSuffix } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { ExportDialog } from '../export/ExportDialog'
import { kindLabel } from '../lib'
import { AulaPanel } from './AulaPanel'
import { markSelection } from './marks'
import { PdfView } from './PdfView'
import { NoteDialog, SelectionBar } from './SelectionBar'
import { ReaderSidebar } from './Sidebar'
import { useReader } from './store'
import { TextView } from './TextView'
import './reader.css'

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const PT = 96 / 72

export function Reader({ docRef, initialPage }: { docRef: DocumentRef; initialPage?: number }) {
  const { t } = useTranslation('documents')
  const key = docKey(docRef)
  const reset = useReader((s) => s.reset)
  const set = useReader((s) => s.set)
  const view = useReader((s) => s.view)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const ai = useRpc('documents.aiStatus', undefined, { events: ['settings.changed'] })
  const hasAI = ai.data ? ai.data.available : null

  useScreenTitle(view ? <span className="font-serif text-[17px]">{view.entry.title}</span> : t('title'), null, [view?.entry.title])

  // abrir el documento y sus marcas
  useEffect(() => {
    reset(key, docRef)
    setError(null)
    let alive = true
    void (async () => {
      try {
        const [v, marks] = await Promise.all([api.invoke('documents.open', { ref: docRef }), api.invoke('documents.annotations', { ref: docRef })])
        if (!alive) return
        const start = initialPage ?? v.entry.lastPage ?? 1
        set({ view: v, marks, pageCount: v.pages.length })
        useReader.getState().goTo(start)
      } catch (e) {
        if (alive) setError({ message: e instanceof Error ? e.message : String(e), code: (e as { code?: string }).code })
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // otra página del mismo documento (una cita, un resultado de la búsqueda)
  useEffect(() => {
    if (initialPage && useReader.getState().view) useReader.getState().goTo(initialPage)
  }, [initialPage])

  // recordar la página (para «Recientes» y para volver donde se dejó)
  const page = useReader((s) => s.page)
  useEffect(() => {
    if (!view) return
    const id = setTimeout(() => void api.invoke('documents.setPage', { ref: docRef, page }).catch(() => undefined), 900)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, view?.entry.key])

  useKeyboard()

  if (error) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <EmptyState title={error.code === 'not_found' ? t('reader.gone') : t('reader.openFailed')} body={error.message} action={<Button onClick={() => navigate({ name: 'documents' })}>{t('reader.back')}</Button>} />
      </div>
    )
  }
  if (!view || view.entry.key !== key) {
    return <div className="grid flex-1 place-items-center text-text3"><span className="flex items-center gap-2 t-callout"><Spinner size={14} /> {t('reader.opening')}</span></div>
  }
  return <ReaderLayout hasAI={hasAI} />
}

function ReaderLayout({ hasAI }: { hasAI: boolean | null }) {
  const view = useReader((s) => s.view)!
  const showSidebar = useReader((s) => s.showSidebar)
  const aula = useReader((s) => s.aula)
  const set = useReader((s) => s.set)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // con poco sitio, Aula y la barra lateral no caben a la vez: Aula manda
  const sidebar = showSidebar && !(aula && width < 1080)
  const sideW = width < 900 ? 200 : 236
  const aulaW = width < 900 ? 320 : 360
  const [exportOpen, setExportOpen] = useState(false)
  const lib = useRpc('documents.library', undefined, { skip: !exportOpen })
  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col px-4 pb-4">
      <Toolbar hasAI={hasAI} onExport={() => setExportOpen(true)} />
      <div className="flex min-h-0 flex-1 gap-3 pt-3">
        <AnimatePresence initial={false}>
          {sidebar && (
            <motion.div key="side" initial={{ width: 0, opacity: 0 }} animate={{ width: sideW, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={spring.smooth} className="shrink-0 overflow-hidden">
              <Card padded={false} className="h-full overflow-hidden" style={{ width: sideW }}>
                <ReaderSidebar view={view} />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[22px] bg-sunken border-[0.5px] border-line-soft">
          {view.entry.mode === 'pdf' ? <PdfView entry={view.entry} /> : <TextView entry={view.entry} pages={view.pages} />}
          <PageBadge />
        </div>
        <AnimatePresence initial={false}>
          {aula && (
            <motion.div key="aula" initial={{ width: 0, opacity: 0 }} animate={{ width: aulaW, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={spring.smooth} className="shrink-0 overflow-hidden">
              {/* termina por encima del botón flotante de Aula (abajo a la derecha) */}
              <Card padded={false} className="h-[calc(100%-60px)] overflow-hidden bg-paper!" style={{ width: aulaW }}>
                <AulaPanel hasAI={hasAI} onClose={() => set({ aula: false })} />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <SelectionBar hasAI={hasAI === true} />
      <NoteDialog />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} courses={lib.data?.courses ?? []} courseId={view.entry.courseId} />
    </div>
  )
}

/** «12 / 40» flotando abajo, sobre el papel. */
function PageBadge() {
  const page = useReader((s) => s.page)
  const count = useReader((s) => s.pageCount)
  if (count <= 1) return null
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-raised/90 px-3 py-1 t-caption font-medium tabular text-text2 shadow-[var(--e2)] border-[0.5px] border-line">
      {page} / {count}
    </div>
  )
}

function Toolbar({ hasAI, onExport }: { hasAI: boolean | null; onExport: () => void }) {
  const { t } = useTranslation('documents')
  const { dark } = useTheme()
  const view = useReader((s) => s.view)!
  const page = useReader((s) => s.page)
  const count = useReader((s) => s.pageCount)
  const zoom = useReader((s) => s.zoom)
  const scale = useReader((s) => s.scale)
  const showSidebar = useReader((s) => s.showSidebar)
  const aula = useReader((s) => s.aula)
  const items = useReader((s) => s.items)
  const selection = useReader((s) => s.selection)
  const set = useReader((s) => s.set)
  const goTo = useReader((s) => s.goTo)
  const entry = view.entry
  const pdf = entry.mode === 'pdf'
  const percent = Math.round((pdf ? scale / PT : typeof zoom === 'number' ? zoom : 1) * 100)
  const step = (dir: 1 | -1): void => {
    const cur = pdf ? scale / PT : typeof zoom === 'number' ? zoom : 1
    const list = ZOOMS
    const next = dir > 0 ? list.find((z) => z > cur + 0.01) ?? list[list.length - 1] : [...list].reverse().find((z) => z < cur - 0.01) ?? list[0]
    set({ zoom: pdf ? next * PT : next })
  }
  const tone = toneForHue(entry.courseHue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const busy = items.some((i) => !i.done)
  const menu: MenuItem[] = [
    ...(entry.courseId ? [{ label: t('reader.makeDocument'), icon: <Icon name="file-text" size={14} />, onSelect: onExport }] : []),
    ...(entry.courseId ? [{ label: t('reader.toCourse'), icon: <Icon name="course" size={14} />, onSelect: () => navigate({ name: 'course', id: entry.courseId as string, tab: 'materials' }) }] : []),
    ...(entry.hasFile ? [{ label: t('reader.reveal'), icon: <Icon name="folder-open" size={14} />, onSelect: () => void api.invoke('documents.reveal', { ref: entry.ref }).catch(() => toast.warning(t('reader.revealFailed'))) }] : []),
    ...(entry.origin !== 'source' ? [{ label: t('library.remove'), icon: <Icon name="trash" size={14} />, danger: true, separatorBefore: true, onSelect: () => void api.invoke('documents.remove', { ref: entry.ref }).then(() => { toast.success(t('library.removed')); navigate({ name: 'documents' }, { replace: true }) }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))) }] : [])
  ]
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 rounded-[16px] bg-surface border-[0.5px] border-line px-1.5 shadow-[var(--e1)]">
      <IconButton label={t('reader.sidebar')} size="sm" active={showSidebar} onClick={() => set({ showSidebar: !showSidebar })}><Icon name="inspector" size={16} /></IconButton>
      <IconButton label={t('reader.library')} size="sm" onClick={() => navigate({ name: 'documents' })}><Icon name="folder" size={15} /></IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      {entry.courseTitle && (
        <span className="hidden min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 t-caption font-medium lg:inline-flex" style={{ color: ink, background: `color-mix(in oklab, ${ink} 10%, transparent)` }}>
          <span className="max-w-[160px] truncate">{entry.courseTitle}</span>
        </span>
      )}
      <span className="t-caption text-text3 hidden xl:inline">{kindLabel(entry.kind)}</span>
      <span className="flex-1" />
      {count > 1 && (
        <div className="flex items-center gap-0.5">
          <IconButton label={t('reader.prev')} size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}><Icon name="chevron-up" size={15} /></IconButton>
          <PageInput page={page} count={count} onGo={goTo} />
          <IconButton label={t('reader.next')} size="sm" disabled={page >= count} onClick={() => goTo(page + 1)}><Icon name="chevron-down" size={15} /></IconButton>
        </div>
      )}
      <span className="mx-1 h-5 w-px bg-line" />
      <div className="flex items-center gap-0.5">
        <IconButton label={t('reader.zoomOut')} size="sm" onClick={() => step(-1)}><Icon name="minus" size={14} /></IconButton>
        <button onClick={() => set({ zoom: 'fit' })} title={t('reader.fit')} className={cx('h-7 min-w-[52px] rounded-[8px] px-1.5 t-ui tabular font-medium transition-colors hover:bg-fill1', zoom === 'fit' ? 'text-text' : 'text-text2')}>{percent}{percentSuffix()}</button>
        <IconButton label={t('reader.zoomIn')} size="sm" onClick={() => step(1)}><Icon name="plus" size={14} /></IconButton>
      </div>
      <span className="mx-1 h-5 w-px bg-line" />
      <IconButton label={t('reader.find')} size="sm" onClick={() => { set({ showSidebar: true, sidebar: 'search' }); setTimeout(() => document.querySelector<HTMLInputElement>('[data-doc-find]')?.focus(), 60) }}><Icon name="search" size={15} /></IconButton>
      <IconButton label={t('reader.highlight')} size="sm" disabled={!selection} onClick={() => void markSelection('highlight', 'yellow')}><span className="grid h-4 w-4 place-items-center rounded-[4px]" style={{ background: 'rgb(250 214 89)' }}><Icon name="edit" size={11} className="text-[#3a2e10]" /></span></IconButton>
      <IconButton label={t('reader.addNote')} size="sm" onClick={() => set({ noteFor: selection ? { page: selection.page, text: selection.text, rects: selection.rects } : 'page' })}><Icon name="note" size={15} /></IconButton>
      <Menu items={menu} trigger={(open) => <IconButton label={t('reader.more')} size="sm" onClick={open}><Icon name="more" size={15} /></IconButton>} />
      <button
        onClick={() => set({ aula: !aula })}
        className={cx('ml-1 flex h-8 items-center gap-1.5 rounded-[10px] pl-1.5 pr-3 t-ui font-medium transition-colors', aula ? 'bg-accent-wash text-accent-text' : 'hover:bg-fill1 text-text')}
        title={hasAI === false ? t('aula.noAI') : t('aula.toggle')}
      >
        <AulaMark size={20} state={busy ? 'working' : hasAI === false ? 'offline' : 'idle'} />
        Aula
      </button>
    </div>
  )
}

function PageInput({ page, count, onGo }: { page: number; count: number; onGo: (p: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <span className="flex items-center gap-1 t-ui tabular text-text2">
      <input
        aria-label="page"
        value={draft ?? String(page)}
        onFocus={(e) => { setDraft(String(page)); e.currentTarget.select() }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') { const n = Number(draft); if (n >= 1) onGo(n); (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
        className="selectable h-7 w-11 rounded-[8px] bg-fill1 text-center font-medium text-text outline-none focus:bg-field focus:ring-1 focus:ring-accent-line"
      />
      <span>/ {count}</span>
    </span>
  )
}

/** Atajos: ←/→ y AvPág/RePág para cambiar de página, ⌘F buscar, ⌘⇧H resaltar, ⌘± zoom, Esc quita la selección. */
function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useReader.getState()
      if (!st.view) return
      const typing = e.target instanceof Element ? e.target.closest('input, textarea, [contenteditable="true"]') : null
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        st.set({ showSidebar: true, sidebar: 'search' })
        setTimeout(() => document.querySelector<HTMLInputElement>('[data-doc-find]')?.focus(), 60)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); void markSelection('highlight', 'yellow'); return }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); st.set({ zoom: Math.min(4, st.scale * 1.15) }); return }
      if (mod && e.key === '-') { e.preventDefault(); st.set({ zoom: Math.max(0.35, st.scale / 1.15) }); return }
      if (mod && e.key === '0') { e.preventDefault(); st.set({ zoom: 'fit' }); return }
      if (typing) return
      if (e.key === 'Escape' && st.selection) { window.getSelection()?.removeAllRanges(); st.set({ selection: null }); return }
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !mod)) { e.preventDefault(); st.goTo(st.page + 1) }
      if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !mod)) { e.preventDefault(); st.goTo(st.page - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
