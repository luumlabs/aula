// Aula en el lector: pide una acción sobre lo que se lee (con la página como imagen si la IA ve), recibe la respuesta a trozos
// y la cancela. Una petición nueva no corta la anterior salvo que siga en marcha (como en Swift: «Detener» la para).
import type { DocumentAIAction } from '@shared/documents'
import i18n from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { openEntryPdf, pageJPEG } from '../pdf'
import { shortId, useReader } from './store'

let wired = false
let vision: boolean | null = null

function wire(): void {
  if (wired) return
  wired = true
  api.on('documents.ai', (u) => {
    const st = useReader.getState()
    const item = st.items.find((i) => i.jobId === u.jobId)
    if (!item) return
    st.updateItem(item.id, { text: u.text, done: u.done, ...(u.error ? { error: u.error.message } : {}), ...(u.cards ? { cards: u.cards } : {}), ...(u.cited ? { cited: u.cited } : {}) })
  })
}

/** El texto con que se muestra la petición (la «burbuja» del estudiante). */
export function actionTitle(a: DocumentAIAction): string {
  const t = (k: string, o?: Record<string, unknown>): string => i18n.t(`documents:aula.actions.${k}`, o ?? {})
  switch (a.type) {
    case 'summarizePage': return t('summarizePage', { n: a.page })
    case 'summarizeChapter': return t('summarizeChapter')
    case 'summarizeDocument': return t('summarizeDocument')
    case 'explain': return t('explain')
    case 'ask': return a.question
    case 'cards': return t('cards')
    case 'practice': return t('practice')
    case 'examFocus': return t('examFocus')
  }
}

async function wantsVision(): Promise<boolean> {
  if (vision !== null) return vision
  try { vision = (await api.invoke('documents.aiStatus')).vision } catch { vision = false }
  return vision
}

/** Pide a Aula la acción; la respuesta aparece en el panel. */
export async function askAula(action: DocumentAIAction): Promise<void> {
  wire()
  const st = useReader.getState()
  const { ref, view } = st
  if (!ref || !view) return
  // una petición nueva sustituye a la que siguiera en marcha
  for (const i of st.items) if (!i.done && i.jobId) void stopAula(i.id)
  const id = shortId()
  const page = 'page' in action ? action.page : st.page
  st.set({ aula: true, items: [...useReader.getState().items, { id, action, title: actionTitle(action), page, text: '', done: false, cards: [], cited: [] }] })
  let pageImage: string | undefined
  if ((action.type === 'summarizePage' || action.type === 'explain') && view.entry.mode === 'pdf' && (await wantsVision())) {
    try {
      const pdf = await openEntryPdf(view.entry)
      pageImage = await pageJPEG(await pdf.getPage(Math.min(page, pdf.numPages)))
    } catch { pageImage = undefined }
  }
  try {
    const { jobId } = await api.invoke('documents.aiStart', { ref, action, language: i18n.language, ...(pageImage ? { pageImage } : {}) })
    useReader.getState().updateItem(id, { jobId })
  } catch (e) {
    useReader.getState().updateItem(id, { done: true, error: e instanceof Error ? e.message : String(e) })
  }
}

export async function stopAula(id: string): Promise<void> {
  const item = useReader.getState().items.find((i) => i.id === id)
  useReader.getState().updateItem(id, { done: true })
  if (item?.jobId) await api.invoke('documents.aiCancel', { jobId: item.jobId }).catch(() => undefined)
}

export function clearAula(): void {
  for (const i of useReader.getState().items) if (!i.done) void stopAula(i.id)
  useReader.getState().set({ items: [] })
}

/** El capítulo de una página según el índice del PDF (si lo hay), para «Resume este capítulo». */
export function chapterAction(page: number): DocumentAIAction {
  const outline = useReader.getState().outline
  let best: (typeof outline)[number] | undefined
  for (const e of outline) if (e.page <= page && page <= e.endPage && (!best || e.level > best.level || (e.level === best.level && e.page > best.page))) best = e
  return best ? { type: 'summarizeChapter', page, from: best.page, to: best.endPage, title: best.title } : { type: 'summarizeChapter', page }
}
