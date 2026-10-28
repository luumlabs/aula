// Documentos de texto (Word, Markdown, páginas web, apuntes pegados…) y fotos: cada página es una hoja de papel con la letra de
// lectura (serif 18/28) y su número en el margen. Los subrayados se pintan sobre el texto con la API de resaltados de CSS (se
// guardan por su cita, sin rectángulos).
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentAnnotation, DocumentEntry, DocumentPageText } from '@shared/documents'
import { MARK_COLORS, markCSS } from '@shared/documents'
import { Icon } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { findRanges, MARK_HIGHLIGHT, paint, quoteRange } from './highlights'
import { hideBar, useReader } from './store'

export function TextView({ entry, pages }: { entry: DocumentEntry; pages: DocumentPageText[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  const jump = useReader((s) => s.jump)
  const zoom = useReader((s) => s.zoom)
  const set = useReader((s) => s.set)
  const marks = useReader((s) => s.marks)
  const find = useReader((s) => s.find)
  const hits = useReader((s) => s.hits)
  const hitIndex = useReader((s) => s.hitIndex)

  useEffect(() => { set({ pageCount: entry.mode === 'image' ? 1 : pages.length, scale: typeof zoom === 'number' ? zoom : 1 }) }, [pages.length, entry.mode, zoom, set])
  useEffect(() => { hideBar() }, [zoom])

  useEffect(() => {
    const el = scroller.current
    if (!jump || !el) return
    const target = el.querySelector<HTMLElement>(`[data-page="${jump.page}"]`)
    if (target) el.scrollTo({ top: target.offsetTop - 16, behavior: Math.abs(target.offsetTop - el.scrollTop) > 4000 ? 'auto' : 'smooth' })
  }, [jump])

  // subrayados guardados (por su cita) y coincidencias de la búsqueda
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const groups = new Map<string, Range[]>()
    for (const m of marks) {
      if (!m.text || m.kind === 'note') continue
      const el = root.querySelector(`[data-page="${m.page}"] .doc-text`)
      const r = el ? quoteRange(el, m.text) : undefined
      if (!r) continue
      const name = MARK_HIGHLIGHT(m.kind, m.color)
      groups.set(name, [...(groups.get(name) ?? []), r])
    }
    for (const kind of ['highlight', 'underline', 'strike'] as const) for (const c of MARK_COLORS) paint(MARK_HIGHLIGHT(kind, c), groups.get(MARK_HIGHLIGHT(kind, c)) ?? [])
  }, [marks, pages])
  useEffect(() => {
    const root = scroller.current
    const q = find.trim()
    if (!root || q.length < 2) { paint('aula-find', []); paint('aula-find-current', []); return }
    const all: Range[] = []
    let current: Range[] = []
    const page = hits[hitIndex]?.page
    for (const el of root.querySelectorAll<HTMLElement>('[data-page]')) {
      const rs = findRanges(el.querySelector('.doc-text') ?? el, q)
      all.push(...rs)
      if (Number(el.dataset.page) === page && rs.length) current = [rs[0]]
    }
    paint('aula-find', all, 1)
    paint('aula-find-current', current, 2)
  }, [find, hits, hitIndex, pages])
  useEffect(() => () => {
    paint('aula-find', [])
    paint('aula-find-current', [])
    for (const kind of ['highlight', 'underline', 'strike'] as const) for (const c of MARK_COLORS) paint(MARK_HIGHLIGHT(kind, c), [])
  }, [])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    hideBar()
    const line = el.scrollTop + el.clientHeight * 0.35
    let current = 1
    for (const p of el.querySelectorAll<HTMLElement>('[data-page]')) { if (p.offsetTop <= line) current = Number(p.dataset.page); else break }
    if (current !== useReader.getState().page) set({ page: current })
  }

  const onMouseUp = (): void => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!sel || sel.isCollapsed || text.length < 2) { if (useReader.getState().selection) set({ selection: null }); return }
    const range = sel.getRangeAt(0)
    const node = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement
    const pageEl = node?.closest<HTMLElement>('[data-page]')
    if (!pageEl) return
    const r = range.getClientRects()[0] ?? range.getBoundingClientRect()
    set({ selection: { text, page: Number(pageEl.dataset.page), rects: [], anchor: { x: r.left + Math.min(r.width, 260) / 2, y: r.top } } })
  }

  const fontScale = typeof zoom === 'number' ? zoom : 1
  if (entry.mode === 'image' && entry.fileUrl) {
    return (
      <div ref={scroller} className="h-full overflow-auto p-7">
        <div data-page={1} className="mx-auto w-fit rounded-[6px] bg-white p-2 shadow-[var(--e2)]">
          <img src={entry.fileUrl} alt={entry.title} className="block max-w-full" style={{ maxHeight: `${Math.round(78 * fontScale)}vh` }} draggable={false} />
        </div>
        {pages[0]?.text.trim() && <div className="mx-auto mt-5 max-w-[760px]"><TextPage page={pages[0]} marks={marks.filter((m) => m.page === 1)} fontScale={fontScale} /></div>}
      </div>
    )
  }
  return (
    <div ref={scroller} onScroll={onScroll} onMouseUp={onMouseUp} className="h-full overflow-auto px-5 pt-6 pb-[140px]">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5">
        {pages.map((p) => <TextPage key={p.number} page={p} marks={marks.filter((m) => m.page === p.number)} fontScale={fontScale} />)}
      </div>
    </div>
  )
}

const TextPage = memo(function TextPage({ page, marks, fontScale }: { page: DocumentPageText; marks: DocumentAnnotation[]; fontScale: number }) {
  const { t } = useTranslation('documents')
  const set = useReader((s) => s.set)
  const notes = marks.filter((m) => m.kind === 'note' || (m.note ?? '').trim())
  return (
    <article data-page={page.number} className="relative rounded-[8px] bg-surface border-[0.5px] border-line shadow-[var(--e1)] py-10" style={{ paddingInline: 'clamp(30px, 7%, 56px)' }}>
      <span className="absolute left-3 top-10 t-caption tabular text-text3">{page.number}</span>
      {notes.length > 0 && (
        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          {notes.map((m) => (
            <button key={m.id} title={m.note} onClick={() => set({ selectedMark: m.id, showSidebar: true, sidebar: 'marks' })}
              className="grid h-[22px] w-[22px] place-items-center rounded-full shadow-[var(--e2)] text-[#3a2e10] hover:scale-110 transition-transform" style={{ background: markCSS(m.color) }}>
              <Icon name="note" size={12} />
            </button>
          ))}
        </div>
      )}
      {page.ocr && <div className="mb-3 t-caption text-text3">{t('reader.ocr')}</div>}
      <div className="doc-text selectable font-serif text-text" style={{ fontSize: `${18 * fontScale}px`, lineHeight: `${28 * fontScale}px` }}>
        {page.text.trim() ? <RichText text={page.text} /> : <p className="text-text3 italic">{t('reader.emptyPage')}</p>}
      </div>
    </article>
  )
})
