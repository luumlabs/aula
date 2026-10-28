// Páginas de un PDF con pdf.js: cada una se dibuja en un lienzo (nítido en pantallas retina) cuando se acerca a la vista y se
// suelta cuando se aleja; encima, la capa de texto (seleccionar, copiar, buscar) y las marcas guardadas (resaltar, subrayar,
// tachar y los globos de las notas en el margen). Las marcas están en puntos del PDF, como en la app Swift.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PageViewport, RenderTask } from 'pdfjs-dist'
import { useTranslation } from 'react-i18next'
import type { DocumentAnnotation, DocumentEntry } from '@shared/documents'
import { markCSS } from '@shared/documents'
import { EmptyState, Icon, Spinner, cx } from '@renderer/design'
import { openEntryPdf, pdfOutline, pdfjs } from '../pdf'
import { boxToPdfRect, mergeLineBoxes, pdfRectToBox, type Box } from './geometry'
import { findRanges, paint } from './highlights'
import { hideBar, useReader } from './store'

const PAD = 28

/** Las capas de texto ya dibujadas (para la búsqueda) y los viewports de cada página (para pasar a puntos del PDF). */
const textLayers = new Map<number, HTMLElement>()
const viewports = new Map<number, PageViewport>()
const listeners = new Set<() => void>()
const notifyLayers = (): void => { for (const l of listeners) l() }

export function viewportFor(page: number): PageViewport | undefined {
  return viewports.get(page)
}

export function PdfView({ entry }: { entry: DocumentEntry }) {
  const { t } = useTranslation('documents')
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 612, h: 792 })
  const [failed, setFailed] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [fitted, setFitted] = useState(false)
  const zoom = useReader((s) => s.zoom)
  const scale = useReader((s) => s.scale)
  const jump = useReader((s) => s.jump)
  const set = useReader((s) => s.set)

  useEffect(() => {
    let alive = true
    textLayers.clear()
    viewports.clear()
    setPdf(null)
    setFailed(null)
    setFitted(false)
    openEntryPdf(entry).then(async (d) => {
      const p1 = await d.getPage(1)
      const vp = p1.getViewport({ scale: 1 })
      if (!alive) return
      setSize({ w: vp.width, h: vp.height })
      setPdf(d)
      set({ pageCount: d.numPages })
      // el índice del PDF (marcadores) para la barra lateral y «Resume este capítulo»
      const outline = await pdfOutline(d)
      if (alive && outline.length) set({ outline })
    }).catch((e: unknown) => alive && setFailed(String((e as Error)?.message ?? e)))
    return () => { alive = false }
  }, [entry, set])

  // ancho disponible → zoom «al ancho»
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [pdf])
  useEffect(() => {
    if (!width) return
    const fit = Math.min(2.4, Math.max(0.4, (Math.min(width, 1100) - PAD * 2) / size.w))
    const next = zoom === 'fit' ? fit : zoom
    if (Math.abs(next - useReader.getState().scale) > 0.001) set({ scale: next })
    setFitted(true)
  }, [width, zoom, size.w, set])

  // al cambiar el zoom, la página que se leía sigue arriba (y la barra de lo seleccionado ya no está en su sitio)
  useEffect(() => { hideBar() }, [scale])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !pdf) return
    const target = el.querySelector<HTMLElement>(`[data-page="${useReader.getState().page}"]`)
    if (target) el.scrollTop = target.offsetTop - 16
  }, [scale, pdf, fitted])

  // ir a una página (miniaturas, citas de Aula, índice, búsqueda…)
  useEffect(() => {
    const el = scroller.current
    if (!jump || !el || !pdf || !fitted) return
    const target = el.querySelector<HTMLElement>(`[data-page="${jump.page}"]`)
    if (target) el.scrollTo({ top: target.offsetTop - 16, behavior: Math.abs(target.offsetTop - el.scrollTop) > 4000 ? 'auto' : 'smooth' })
  }, [jump, pdf, fitted])

  // la página que se está leyendo
  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    hideBar()
    const line = el.scrollTop + el.clientHeight * 0.35
    const pages = el.querySelectorAll<HTMLElement>('[data-page]')
    let current = 1
    for (const p of pages) { if (p.offsetTop <= line) current = Number(p.dataset.page); else break }
    if (current !== useReader.getState().page) set({ page: current })
  }

  useFindHighlights()

  if (failed) return <div className="grid h-full place-items-center p-8"><EmptyState title={t('reader.openFailed')} body={failed} /></div>
  if (!pdf) return <div className="grid h-full place-items-center text-text3"><span className="flex items-center gap-2 t-callout"><Spinner size={14} /> {t('reader.opening')}</span></div>

  return (
    <div ref={scroller} onScroll={onScroll} onMouseUp={(e) => onPdfMouseUp(e)} className="relative h-full overflow-auto" style={{ padding: `${PAD}px ${PAD}px 120px` }}>
      <div className="mx-auto flex w-max flex-col items-center gap-5">
        {fitted && Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={i + 1} pdf={pdf} n={i + 1} scale={scale} base={size} scroller={scroller} />
        ))}
      </div>
    </div>
  )
}

/** Al soltar el ratón: lo seleccionado (con sus rectángulos en puntos del PDF) o, con un clic, la marca que hay debajo. */
function onPdfMouseUp(e: React.MouseEvent): void {
  const st = useReader.getState()
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.isCollapsed || text.length < 2) {
    if (st.selection) st.set({ selection: null })
    hitTestMark(e)
    return
  }
  const range = sel.getRangeAt(0)
  const startNode = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement
  const pageEl = startNode?.closest<HTMLElement>('[data-page]')
  if (!pageEl) return
  const page = Number(pageEl.dataset.page)
  const vp = viewports.get(page)
  const box = pageEl.getBoundingClientRect()
  const boxes: Box[] = [...range.getClientRects()]
    .filter((r) => r.top >= box.top - 2 && r.bottom <= box.bottom + 2)
    .map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }))
  const lines = mergeLineBoxes(boxes)
  const rects = vp ? lines.map((b) => boxToPdfRect(b, vp)) : []
  const first = lines[0]
  const anchor = first ? { x: box.left + first.x + Math.min(first.w, 260) / 2, y: box.top + first.y } : { x: e.clientX, y: e.clientY }
  st.set({ selection: { text, page, rects, anchor } })
}

function hitTestMark(e: React.MouseEvent): void {
  const target = e.target as HTMLElement
  const pageEl = target.closest<HTMLElement>('[data-page]')
  if (!pageEl) return
  const page = Number(pageEl.dataset.page)
  const vp = viewports.get(page)
  if (!vp) return
  const box = pageEl.getBoundingClientRect()
  const x = e.clientX - box.left, y = e.clientY - box.top
  const st = useReader.getState()
  const hit = st.marks.find((m) => m.page === page && m.rects.some((r) => { const b = pdfRectToBox(r, vp); return x >= b.x && x <= b.x + b.w && y >= b.y - 2 && y <= b.y + b.h + 2 }))
  if (hit) st.set({ selectedMark: hit.id, showSidebar: true, sidebar: 'marks' })
}

/** Resalta las coincidencias de la búsqueda en las capas de texto ya dibujadas. */
function useFindHighlights(): void {
  const find = useReader((s) => s.find)
  const hits = useReader((s) => s.hits)
  const hitIndex = useReader((s) => s.hitIndex)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const fn = (): void => setTick((n) => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  useEffect(() => {
    const q = find.trim()
    if (q.length < 2) { paint('aula-find', []); paint('aula-find-current', []); return }
    const all: Range[] = []
    let current: Range[] = []
    const currentPage = hits[hitIndex]?.page
    for (const [page, layer] of textLayers) {
      const rs = findRanges(layer, q)
      all.push(...rs)
      if (page === currentPage && rs.length) current = [rs[0]]
    }
    paint('aula-find', all, 1)
    paint('aula-find-current', current, 2)
  }, [find, hits, hitIndex, tick])
  useEffect(() => () => { paint('aula-find', []); paint('aula-find-current', []) }, [])
}

// MARK: - Una página

const PdfPage = memo(function PdfPage({ pdf, n, scale, base, scroller }: { pdf: PDFDocumentProxy; n: number; scale: number; base: { w: number; h: number }; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(n <= 2)
  const [size, setSize] = useState(base)
  const [vp, setVp] = useState<PageViewport | null>(null)
  const [drawn, setDrawn] = useState(false)
  const marks = useReader((s) => s.marks)
  const selectedMark = useReader((s) => s.selectedMark)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => { for (const e of es) setNear(e.isIntersecting) }, { root: scroller.current, rootMargin: '1400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [scroller])

  // Cada dibujo va a un lienzo nuevo que sustituye al anterior cuando está listo (mientras, se ve el anterior escalado, sin
  // parpadeo). Con el zoom, el dibujo anterior se cancela justo antes de empezar el nuevo (pdf.js sigue leyendo la página);
  // al alejarse no se corta nada: si pdf.js deja a medias una fuente Type 3, se queda sin glifos para todo el documento.
  const drawing = useRef<RenderTask | null>(null)
  useEffect(() => {
    let stale = false
    void (async () => {
      const holder = holderRef.current
      if (!near) {
        // lejos: se suelta el lienzo (un libro de 400 páginas no puede tenerlas todas en memoria)
        await drawing.current?.promise.catch(() => undefined)
        if (stale) return
        if (holder) releaseCanvases(holder)
        textRef.current?.replaceChildren()
        textLayers.delete(n)
        setDrawn(false)
        return
      }
      // si ya hay algo dibujado, se espera a que el zoom se asiente (los paneles que se abren lo cambian varias veces)
      if (holder?.firstChild) await sleep(140)
      if (stale) return
      const page = await pdf.getPage(n)
      if (stale) return
      drawing.current?.cancel()
      const viewport = page.getViewport({ scale })
      viewports.set(n, viewport)
      setVp(viewport)
      setSize({ w: viewport.width / scale, h: viewport.height / scale })
      if (!holder) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const canvas = document.createElement('canvas')
      canvas.className = 'absolute inset-0 h-full w-full'
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      const task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      drawing.current = task
      try {
        await task.promise
      } finally {
        if (drawing.current === task) drawing.current = null
      }
      // si ya llega tarde (otro zoom), solo se usa cuando la página aún está en blanco
      if (stale && holder.firstChild) { canvas.width = 0; canvas.height = 0; return }
      releaseCanvases(holder)
      holder.replaceChildren(canvas)
      setDrawn(true)
      if (stale) return
      const layer = textRef.current
      if (!layer) return
      const { TextLayer } = await pdfjs()
      const fresh = document.createElement('div')
      await new TextLayer({ textContentSource: page.streamTextContent(), container: fresh, viewport }).render()
      if (stale) return
      layer.replaceChildren(...fresh.childNodes)
      textLayers.set(n, layer)
      notifyLayers()
    })().catch(() => undefined) // cancelado por otro zoom o documento cerrado
    return () => { stale = true }
  }, [near, scale, pdf, n])

  const w = size.w * scale, h = size.h * scale
  const mine = marks.filter((m) => m.page === n)
  return (
    <div
      ref={ref}
      data-page={n}
      className="pdf-page relative shrink-0 bg-white"
      style={{ width: w, height: h, ['--scale-factor' as string]: scale, ['--total-scale-factor' as string]: scale, ['--user-unit' as string]: 1, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}
    >
      <div ref={holderRef} className="absolute inset-0" />
      {!drawn && <div className="absolute inset-0 grid place-items-center"><span className="font-serif text-[40px] text-black/[0.07] tabular">{n}</span></div>}
      {vp && <MarksLayer marks={mine} vp={vp} selected={selectedMark} />}
      <div ref={textRef} className="textLayer selectable" />
      {vp && <NotePins marks={mine} vp={vp} width={w} />}
    </div>
  )
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Suelta la memoria de los lienzos de una página (poner su tamaño a cero la libera al momento). */
function releaseCanvases(holder: HTMLElement): void {
  for (const c of holder.querySelectorAll('canvas')) { c.width = 0; c.height = 0 }
  holder.replaceChildren()
}

/** Resaltados, subrayados y tachados (debajo de la capa de texto: no estorban al seleccionar). */
function MarksLayer({ marks, vp, selected }: { marks: DocumentAnnotation[]; vp: PageViewport; selected: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {marks.filter((m) => m.kind !== 'note').flatMap((m) => m.rects.map((r, i) => {
        const b = pdfRectToBox(r, vp)
        const sel = m.id === selected
        if (m.kind === 'highlight') {
          return <div key={`${m.id}-${i}`} className={cx('absolute rounded-[2px] transition-shadow', sel && 'ring-2 ring-accent/60')} style={{ left: b.x - 1, top: b.y - 1, width: b.w + 2, height: b.h + 2, background: markCSS(m.color, 0.42), mixBlendMode: 'multiply' }} />
        }
        const y = m.kind === 'underline' ? b.y + b.h - 1 : b.y + b.h / 2 - 1
        return <div key={`${m.id}-${i}`} className="absolute rounded-full" style={{ left: b.x, top: y, width: b.w, height: 2, background: markCSS(m.color, 0.95) }} />
      }))}
    </div>
  )
}

/** Globos de las notas: en el margen derecho, a la altura de su línea. */
function NotePins({ marks, vp, width }: { marks: DocumentAnnotation[]; vp: PageViewport; width: number }) {
  const set = useReader((s) => s.set)
  return (
    <>
      {marks.filter((m) => (m.note ?? '').trim() || m.kind === 'note').map((m) => {
        const first = m.rects[0]
        const b = first ? pdfRectToBox(first, vp) : { x: width - 30, y: 14, w: 16, h: 16 }
        const top = Math.max(4, b.y + b.h / 2 - 11)
        return (
          <button
            key={m.id}
            title={m.note}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={() => set({ selectedMark: m.id, showSidebar: true, sidebar: 'marks' })}
            className="absolute z-[2] grid h-[22px] w-[22px] place-items-center rounded-full shadow-[var(--e2)] text-[#3a2e10] hover:scale-110 transition-transform"
            style={{ left: Math.min(width - 26, Math.max(width - 30, b.x + b.w + 6)), top, background: markCSS(m.color, 1) }}
          >
            <Icon name="note" size={12} />
          </button>
        )
      })}
    </>
  )
}
