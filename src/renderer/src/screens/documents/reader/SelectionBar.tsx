// La barra que flota sobre lo seleccionado: resaltar en cuatro colores, subrayar, nota, copiar y, si hay IA, «Explícame esto»
// y «Tarjetas». Es la única pieza de vidrio del lector (el papel sigue siendo papel).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { quoted } from '@renderer/lib/format'
import { AnimatePresence, motion } from 'motion/react'
import { MARK_COLORS, markCSS } from '@shared/documents'
import { Button, Dialog, Icon, TextArea, Tooltip, cx, spring } from '@renderer/design'
import { askAula } from './aula'
import { addPageNote, copySelection, markSelection } from './marks'
import { hideBar, useReader } from './store'
import { viewportFor } from './PdfView'
import { pageNoteRect } from './geometry'

export function SelectionBar({ hasAI }: { hasAI: boolean }) {
  const { t } = useTranslation('documents')
  const selection = useReader((s) => s.selection)
  const set = useReader((s) => s.set)
  const anchor = selection?.anchor
  const x = anchor ? Math.min(window.innerWidth - 220, Math.max(220, anchor.x)) : 0
  const y = anchor ? Math.max(64, anchor.y - 54) : 0
  return createPortal(
    <AnimatePresence>
      {selection && anchor && (
        <motion.div
          key="selbar"
          role="toolbar"
          aria-label={t('selection.label')}
          onMouseDown={(e) => e.preventDefault()}
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={spring.snappy}
          className="material-menu fixed z-[70] flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1"
          style={{ left: x, top: y }}
        >
          {MARK_COLORS.map((c) => (
            <Tooltip key={c} label={t(`selection.highlight.${c}`)}>
              <button aria-label={t(`selection.highlight.${c}`)} onClick={() => void markSelection('highlight', c)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-fill2 transition-colors">
                <span className="h-4 w-4 rounded-full border-[0.5px] border-black/15" style={{ background: markCSS(c) }} />
              </button>
            </Tooltip>
          ))}
          <Divider />
          <BarIcon label={t('selection.underline')} onClick={() => void markSelection('underline', 'blue')}><span className="text-[14px] font-semibold underline decoration-2 underline-offset-2 decoration-[rgb(80,140,220)]">U</span></BarIcon>
          <BarIcon label={t('selection.strike')} onClick={() => void markSelection('strike', 'pink')}><span className="text-[14px] font-semibold line-through decoration-2 decoration-[rgb(220,110,150)]">S</span></BarIcon>
          <BarIcon label={t('selection.note')} onClick={() => set({ noteFor: { page: selection.page, text: selection.text, rects: selection.rects } })}><Icon name="note" size={15} /></BarIcon>
          <BarIcon label={t('selection.copy')} onClick={() => void copySelection()}><Icon name="copy" size={15} /></BarIcon>
          {hasAI && (
            <>
              <Divider />
              <button onClick={() => { hideBar(); void askAula({ type: 'explain', selection: selection.text, page: selection.page }) }} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 t-ui font-medium hover:bg-fill2 transition-colors">
                <Icon name="tutor" size={15} className="text-accent-text" />{t('selection.explain')}
              </button>
              <button onClick={() => { hideBar(); void askAula({ type: 'cards', selection: selection.text, page: selection.page }) }} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 t-ui font-medium hover:bg-fill2 transition-colors">
                <Icon name="cards" size={15} className="text-accent-text" />{t('selection.cards')}
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" />
}

function BarIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <button aria-label={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-full text-text2 hover:text-text hover:bg-fill2 transition-colors">{children}</button>
    </Tooltip>
  )
}

/** La nota: de lo seleccionado (se resalta con la nota) o suelta en la página. */
export function NoteDialog() {
  const { t } = useTranslation('documents')
  const noteFor = useReader((s) => s.noteFor)
  const page = useReader((s) => s.page)
  const view = useReader((s) => s.view)
  const set = useReader((s) => s.set)
  const [draft, setDraft] = useState('')
  useEffect(() => { if (noteFor) setDraft('') }, [noteFor])
  const close = (): void => set({ noteFor: null })
  const save = (): void => {
    const n = draft.trim()
    if (noteFor === 'page') {
      if (n) {
        const vp = viewportFor(page)
        const rects = view?.entry.mode === 'pdf' && vp ? [pageNoteRect(vp.viewBox[2] - vp.viewBox[0], vp.viewBox[3] - vp.viewBox[1])] : []
        void addPageNote(page, n, rects)
      }
    } else if (noteFor) {
      useReader.getState().set({ selection: { text: noteFor.text, page: noteFor.page, rects: noteFor.rects } })
      void markSelection('highlight', 'yellow', n || undefined)
    }
    close()
  }
  const subtitle = noteFor === 'page' ? t('note.onPage', { n: page }) : noteFor ? quoted(`${Array.from(noteFor.text).slice(0, 140).join('')}${noteFor.text.length > 140 ? '…' : ''}`) : ''
  return (
    <Dialog open={!!noteFor} onClose={close} title={t('note.title')} description={subtitle} size="sm"
      footer={<><Button variant="secondary" onClick={close}>{t('cancel')}</Button><Button variant="primary" onClick={save}>{t('save')}</Button></>}>
      <TextArea autoFocus autoGrow value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('note.placeholder')} rows={4}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }} className={cx('min-h-[110px]')} />
    </Dialog>
  )
}
