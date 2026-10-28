// Estado del lector abierto: página, zoom, selección, marcas, la barra lateral, la búsqueda y las respuestas de Aula. Un solo
// lector a la vez (la pantalla de Documentos): se reinicia al abrir otro documento.
import { create } from 'zustand'
import type { DocumentAIAction, DocumentAnnotation, DocumentCardDraft, DocumentHit, DocumentRef, DocumentView } from '@shared/documents'

export type SidebarTab = 'pages' | 'outline' | 'marks' | 'search'

/** Lo seleccionado en la página: texto, página y (en PDF) sus rectángulos en puntos del PDF. */
export interface ReaderSelection {
  text: string
  page: number
  rects: number[][]
  /** Dónde mostrar la barra de la selección (píxeles de la ventana). */
  anchor?: { x: number; y: number }
}

/** Una respuesta de Aula en el panel. */
export interface AulaItem {
  id: string
  jobId?: string
  action: DocumentAIAction
  title: string
  page: number
  text: string
  done: boolean
  error?: string
  cards: DocumentCardDraft[]
  cited: number[]
  saved?: string
}

export interface OutlineItem { title: string; page: number; endPage: number; level: number }

interface ReaderState {
  key: string
  ref: DocumentRef | null
  view: DocumentView | null
  page: number
  pageCount: number
  /** Zoom: 'fit' = al ancho; un número = factor de pdf.js (1 = 1 punto por píxel). */
  zoom: 'fit' | number
  /** El factor que se está usando de verdad (el de «al ancho» ya calculado). */
  scale: number
  jump: { page: number; seq: number } | null
  selection: ReaderSelection | null
  marks: DocumentAnnotation[]
  selectedMark: string | null
  sidebar: SidebarTab
  showSidebar: boolean
  aula: boolean
  find: string
  hits: DocumentHit[]
  hitIndex: number
  outline: OutlineItem[]
  items: AulaItem[]
  noteFor: { page: number; text: string; rects: number[][] } | 'page' | null
  editMark: string | null
  reset: (key: string, ref: DocumentRef) => void
  set: (p: Partial<ReaderState>) => void
  goTo: (page: number) => void
  updateItem: (id: string, change: Partial<AulaItem>) => void
}

export const useReader = create<ReaderState>((set, get) => ({
  key: '',
  ref: null,
  view: null,
  page: 1,
  pageCount: 0,
  zoom: 'fit',
  scale: 1,
  jump: null,
  selection: null,
  marks: [],
  selectedMark: null,
  sidebar: 'pages',
  showSidebar: true,
  aula: false,
  find: '',
  hits: [],
  hitIndex: 0,
  outline: [],
  items: [],
  noteFor: null,
  editMark: null,
  reset: (key, ref) => {
    if (get().key === key) return
    set({ key, ref, view: null, page: 1, pageCount: 0, jump: null, selection: null, marks: [], selectedMark: null, find: '', hits: [], hitIndex: 0, outline: [], items: [], noteFor: null, editMark: null })
  },
  set: (p) => set(p),
  goTo: (page) => {
    const n = Math.max(1, Math.min(get().pageCount || 1, Math.round(page)))
    set({ page: n, jump: { page: n, seq: (get().jump?.seq ?? 0) + 1 } })
  },
  updateItem: (id, change) => set({ items: get().items.map((i) => (i.id === id ? { ...i, ...change } : i)) })
}))

/** Id corto para las marcas nuevas. */
export function shortId(): string {
  const a = new Uint32Array(2)
  crypto.getRandomValues(a)
  return (a[0].toString(36) + a[1].toString(36)).slice(0, 8)
}

/** Oculta la barra de lo seleccionado sin olvidarlo (Aula sigue ofreciendo acciones sobre ello en su panel). */
export function hideBar(): void {
  const st = useReader.getState()
  if (st.selection?.anchor) st.set({ selection: { ...st.selection, anchor: undefined } })
}
