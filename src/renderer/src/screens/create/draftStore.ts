// El formulario de «Nuevo curso» como borrador que no se pierde (A3-P1-3): antes vivía en el estado de la pantalla y, al ir a
// Inicio o al calendario mientras se leían los PDF (el OCR tarda), el título, los materiales y las notas desaparecían. Ahora
// vive en un store que sobrevive a la navegación y se guarda en este ordenador (localStorage) para que sobreviva también a
// cerrar Aula; los materiales ya leídos siguen en el borrador del proceso principal (`Drafts/<id>`) y se piden al volver.
import { create } from 'zustand'
import type { CreateRequest, GenerationDepth, MaterialView } from '@shared/generation/types'

export type LessonMode = CreateRequest['lessonMode']
/** Texto pegado o enlace escrito que aún no se ha añadido a los materiales. */
export interface PendingMaterial { mode: 'none' | 'text' | 'url'; value: string }

export interface CreateForm {
  title: string
  /** AAAA-MM-DD o vacío. */
  date: string
  level: string | null
  topics: string
  examNotes: string
  more: boolean
  depth: GenerationDepth
  /** null: lo que digan los ajustes (buscar en la web). */
  web: boolean | null
  verify: boolean
  lessonMode: LessonMode
  /** null: el idioma de la interfaz. */
  pickedLanguage: string | null
  draftId?: string
  official: string[]
  gather: string | null
  pending: PendingMaterial
  /** El evento del calendario del que salió (si vino de «Preparar este examen»). */
  eventId?: string
  /** La propuesta de la ruta ya aplicada (así volver atrás no la aplica otra vez). */
  prefillKey?: string
}

export const EMPTY_FORM: CreateForm = {
  title: '', date: '', level: null, topics: '', examNotes: '', more: false, depth: 'standard', web: null, verify: true,
  lessonMode: 'stepByStep', pickedLanguage: null, official: [], gather: null, pending: { mode: 'none', value: '' }
}

const STORAGE_KEY = 'aula.create.draft.v1'
const DEPTHS: readonly GenerationDepth[] = ['quick', 'standard', 'deep']
const MODES: readonly LessonMode[] = ['stepByStep', 'explore', 'read']

const text = (v: unknown, max = 20_000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const optText = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined)
const nullableText = (v: unknown, max = 200): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null)

/** Lo guardado en este ordenador, validado campo a campo (puede venir de otra versión o estar roto). Puro. */
export function restoreForm(raw: unknown): CreateForm {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_FORM }
  const o = raw as Record<string, unknown>
  const pending = typeof o.pending === 'object' && o.pending !== null ? (o.pending as Record<string, unknown>) : {}
  const mode = pending.mode === 'text' || pending.mode === 'url' ? pending.mode : 'none'
  const form: CreateForm = {
    title: text(o.title, 500),
    date: typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : '',
    level: nullableText(o.level, 40),
    topics: text(o.topics),
    examNotes: text(o.examNotes),
    more: o.more === true,
    depth: DEPTHS.includes(o.depth as GenerationDepth) ? (o.depth as GenerationDepth) : 'standard',
    web: typeof o.web === 'boolean' ? o.web : null,
    verify: o.verify !== false,
    lessonMode: MODES.includes(o.lessonMode as LessonMode) ? (o.lessonMode as LessonMode) : 'stepByStep',
    pickedLanguage: nullableText(o.pickedLanguage, 20),
    official: Array.isArray(o.official) ? o.official.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
    gather: nullableText(o.gather, 200),
    pending: { mode, value: mode === 'none' ? '' : text(pending.value, 2_000_000) }
  }
  const draftId = optText(o.draftId, 64)
  if (draftId && /^[a-z0-9-]{4,40}$/.test(draftId)) form.draftId = draftId
  const eventId = optText(o.eventId, 600)
  if (eventId) form.eventId = eventId
  const prefillKey = optText(o.prefillKey, 4000)
  if (prefillKey) form.prefillKey = prefillKey
  return form
}

/** ¿Hay algo que perder? (título, materiales, texto pegado, temas o notas). Puro. */
export function hasDraftContent(form: Pick<CreateForm, 'title' | 'topics' | 'examNotes' | 'pending'>, materials: readonly unknown[]): boolean {
  return !!(form.title.trim() || materials.length || form.pending.value.trim() || form.topics.trim() || form.examNotes.trim())
}

/** El formulario que deja una propuesta de la ruta (desde el calendario, el chat o una plataforma). Puro. */
export function formFromPrefill(prefill: { title?: string; examDate?: string; topics?: string; eventId?: string; fromPlatform?: boolean }, key: string): CreateForm {
  const f: CreateForm = { ...EMPTY_FORM, title: prefill.title ?? '', date: prefill.examDate ? prefill.examDate.slice(0, 10) : '', topics: prefill.topics ?? '', more: !!prefill.topics, gather: prefill.fromPlatform ? 'auto' : null, prefillKey: key }
  if (prefill.eventId) f.eventId = prefill.eventId
  return f
}

function load(): CreateForm {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return raw ? restoreForm(JSON.parse(raw)) : { ...EMPTY_FORM }
  } catch {
    return { ...EMPTY_FORM }
  }
}

function persist(form: CreateForm): void {
  try {
    if (hasDraftContent(form, form.draftId ? [form.draftId] : [])) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(form))
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* sin almacenamiento: el borrador sigue en memoria */
  }
}

interface CreateDraftState extends CreateForm {
  materials: MaterialView[]
  set: (patch: Partial<CreateForm> & { materials?: MaterialView[] }) => void
  /** Empieza de cero (o con `form`). */
  reset: (form?: CreateForm) => void
}

const formOf = (s: CreateDraftState): CreateForm => {
  const { materials: _m, set: _s, reset: _r, ...form } = s
  return form
}

export const useCreateDraft = create<CreateDraftState>((set, get) => ({
  ...load(),
  materials: [],
  set: (patch) => {
    set(patch)
    persist(formOf(get()))
  },
  reset: (form) => {
    set({ ...EMPTY_FORM, draftId: undefined, eventId: undefined, prefillKey: undefined, ...(form ?? {}), materials: [] })
    persist(formOf(get()))
  }
}))
