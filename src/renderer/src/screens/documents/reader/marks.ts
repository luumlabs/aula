// Marcas del lector: crear una desde la selección (resaltar, subrayar, tachar o con nota), una nota suelta en la página,
// cambiar su color o su nota y borrarla. Se guardan en el proceso principal (el archivo original no se toca).
import type { DocumentAnnotation, DocumentMarkColor, DocumentMarkKind } from '@shared/documents'
import { toast } from '@renderer/design'
import i18n from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { shortId, useReader } from './store'

function now(): string {
  return new Date().toISOString()
}

async function save(a: DocumentAnnotation): Promise<void> {
  const { ref } = useReader.getState()
  if (!ref) return
  try {
    const marks = await api.invoke('documents.annotate', { ref, annotation: a })
    useReader.getState().set({ marks, selectedMark: a.id })
  } catch (e) {
    toast.error(i18n.t('documents:marks.saveFailed'), e instanceof Error ? e.message : String(e))
  }
}

/** Marca lo seleccionado. */
export async function markSelection(kind: DocumentMarkKind, color: DocumentMarkColor, note?: string): Promise<void> {
  const sel = useReader.getState().selection
  if (!sel || !sel.text.trim()) return
  const a: DocumentAnnotation = { id: shortId(), page: sel.page, kind, color, rects: sel.rects, text: Array.from(sel.text.trim()).slice(0, 2000).join(''), author: 'student', created: now(), updated: now() }
  if (note?.trim()) a.note = note.trim()
  window.getSelection()?.removeAllRanges()
  useReader.getState().set({ selection: null })
  await save(a)
}

/** Nota suelta en una página (sin texto marcado). */
export async function addPageNote(page: number, note: string, rects: number[][]): Promise<void> {
  if (!note.trim()) return
  await save({ id: shortId(), page, kind: 'note', color: 'yellow', rects, text: '', note: note.trim(), author: 'student', created: now(), updated: now() })
}

export async function updateMark(id: string, change: Partial<DocumentAnnotation>): Promise<void> {
  const m = useReader.getState().marks.find((x) => x.id === id)
  if (!m) return
  const next: DocumentAnnotation = { ...m, ...change, updated: now() }
  if (change.note !== undefined && !change.note.trim()) delete next.note
  await save(next)
}

export async function removeMark(id: string): Promise<void> {
  const { ref } = useReader.getState()
  if (!ref) return
  try {
    const marks = await api.invoke('documents.unannotate', { ref, id })
    useReader.getState().set({ marks, selectedMark: null })
  } catch (e) {
    toast.error(i18n.t('documents:marks.saveFailed'), e instanceof Error ? e.message : String(e))
  }
}

/** Copia lo seleccionado. */
export async function copySelection(): Promise<void> {
  const sel = useReader.getState().selection
  if (!sel) return
  try {
    await navigator.clipboard.writeText(sel.text)
    toast.success(i18n.t('documents:reader.copied'))
  } catch {
    document.execCommand('copy')
  }
}
