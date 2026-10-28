// Datos de estudio de un curso en la interfaz: el curso, sus habilidades y el progreso, con una copia local que se
// actualiza al instante (con las funciones puras del motor) y se guarda en el proceso principal por lotes.
// En modo demostración (sin proceso principal) se leen los JSON del curso de ejemplo y el progreso vive en memoria.
import { useEffect } from 'react'
import { create } from 'zustand'
import { decodeProgress, decodeSkill, emptyProgress, orderedSkills, type Pack, type Skill, type StudyProgress } from '@shared/schema'
import { api } from '@renderer/lib/api'
import { demoPacks, isDemo } from '@renderer/lib/demo'
import { coalesceOps, sendOps, type SyncOp } from './sync'

export type { SyncOp }

const invoke = api.invoke as unknown as (m: string, a?: unknown) => Promise<unknown>
const on = api.on as unknown as (e: string, fn: (p: unknown) => void) => () => void

// MARK: Curso de ejemplo

const demoSkillFiles = import.meta.glob<unknown>('../../../../../resources/demo-course/Packs/*/skills/*.json', { import: 'default' })
const demoProgressFiles = import.meta.glob<unknown>('../../../../../resources/demo-course/Packs/*/progress.json', { import: 'default' })

async function demoCourse(id: string): Promise<CourseData | null> {
  const pack = (await demoPacks()).find((p) => p.id === id)
  if (!pack) return null
  const files = Object.entries(demoSkillFiles).filter(([path]) => path.includes(`/Packs/${id}/skills/`))
  const skills = (await Promise.all(files.map(async ([, load]) => {
    try {
      return decodeSkill(await load())
    } catch {
      return null
    }
  }))).filter((s): s is Skill => !!s)
  const prog = Object.entries(demoProgressFiles).find(([path]) => path.includes(`/Packs/${id}/`))
  let progress = emptyProgress()
  if (prog) {
    try {
      progress = decodeProgress(await prog[1]())
    } catch {
      /* progreso vacío */
    }
  }
  return { pack, skills: sortSkills(pack, skills), progress, demo: true }
}

// MARK: Almacén

export interface CourseData {
  pack: Pack
  /** En el orden del curso (unidades). */
  skills: Skill[]
  progress: StudyProgress
  demo: boolean
}

type Status = 'loading' | 'ready' | 'missing' | 'error'

interface StudyStore {
  courses: Record<string, CourseData>
  status: Record<string, Status>
}

export const useStudyStore = create<StudyStore>(() => ({ courses: {}, status: {} }))

function sortSkills(pack: Pack, skills: Skill[]): Skill[] {
  const order = new Map(orderedSkills(pack).map((s, i) => [s.id, i]))
  return [...skills].sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6))
}

const loading = new Map<string, Promise<void>>()

async function fetchCourse(id: string): Promise<CourseData | null> {
  try {
    const [pack, skills, progress] = await Promise.all([invoke('courses.get', { id }), invoke('courses.getSkills', { id }), invoke('progress.get', { id })])
    if (!pack) return null
    const p = pack as Pack
    return { pack: p, skills: sortSkills(p, (skills as Skill[]) ?? []), progress: (progress as StudyProgress) ?? emptyProgress(), demo: false }
  } catch (e) {
    if (isDemo()) return demoCourse(id)
    throw e
  }
}

export function loadCourse(id: string, force = false): Promise<void> {
  const st = useStudyStore.getState()
  if (!force && st.courses[id]) return Promise.resolve()
  const running = loading.get(id)
  if (running && !force) return running
  if (!st.courses[id]) useStudyStore.setState((s) => ({ status: { ...s.status, [id]: 'loading' } }))
  const p = fetchCourse(id)
    .then((data) => {
      useStudyStore.setState((s) => {
        if (!data) return { status: { ...s.status, [id]: 'missing' } }
        // lo que aún no se ha guardado gana a lo que llega del disco
        const keep = busy(id) && s.courses[id] ? s.courses[id].progress : data.progress
        return { courses: { ...s.courses, [id]: { ...data, progress: keep } }, status: { ...s.status, [id]: 'ready' } }
      })
    })
    .catch(() => useStudyStore.setState((s) => ({ status: { ...s.status, [id]: s.courses[id] ? 'ready' : 'error' } })))
    .finally(() => loading.delete(id))
  loading.set(id, p)
  return p
}

async function reloadProgress(id: string): Promise<void> {
  if (busy(id) || useStudyStore.getState().courses[id]?.demo) return
  try {
    const progress = (await invoke('progress.get', { id })) as StudyProgress
    if (busy(id)) return
    useStudyStore.setState((s) => (s.courses[id] ? { courses: { ...s.courses, [id]: { ...s.courses[id], progress } } } : s))
  } catch {
    /* se queda la copia local */
  }
}

/** El curso con sus habilidades y progreso; se refresca cuando cambia en disco. */
export function useCourseData(id: string): { data: CourseData | undefined; status: Status } {
  const data = useStudyStore((s) => s.courses[id])
  const status = useStudyStore((s) => s.status[id] ?? 'loading')
  useEffect(() => {
    void loadCourse(id)
    let t: ReturnType<typeof setTimeout> | null = null
    const offCourse = on('courses.changed', (p) => {
      const changed = (p as { packId?: string } | undefined)?.packId
      if (changed && changed !== id) return
      if (t) clearTimeout(t)
      t = setTimeout(() => void loadCourse(id, true), 200)
    })
    const offProgress = on('progress.changed', (p) => {
      const changed = (p as { packId?: string; id?: string } | undefined)
      if (changed && (changed.packId ?? changed.id) && (changed.packId ?? changed.id) !== id) return
      void reloadProgress(id)
    })
    return () => {
      if (t) clearTimeout(t)
      offCourse()
      offProgress()
    }
  }, [id])
  return { data, status }
}

// MARK: Cambios del progreso

const pending = new Map<string, { ops: SyncOp[]; timer: ReturnType<typeof setTimeout> | null }>()
const inflight = new Set<string>()
const busy = (id: string): boolean => pending.has(id) || inflight.has(id)

/**
 * Cambia la copia local del progreso al instante (con las mismas funciones puras del motor que usa el proceso principal)
 * y programa mandar las operaciones (por lotes, en orden).
 */
export function updateProgress(packId: string, fn: (p: StudyProgress) => StudyProgress, ops?: SyncOp | SyncOp[]): void {
  const cur = useStudyStore.getState().courses[packId]
  if (!cur) return
  let next: StudyProgress
  try {
    next = fn(cur.progress)
  } catch (e) {
    console.warn('[aula] progreso:', e)
    return
  }
  useStudyStore.setState((s) => ({ courses: { ...s.courses, [packId]: { ...s.courses[packId], progress: next } } }))
  if (cur.demo) return
  const q = pending.get(packId) ?? { ops: [], timer: null }
  q.ops.push(...(Array.isArray(ops) ? ops : [ops ?? { kind: 'save' as const }]))
  if (q.timer) clearTimeout(q.timer)
  q.timer = setTimeout(() => void flushProgress(packId), 600)
  pending.set(packId, q)
}

/** Cambia solo la copia local (lo que el proceso principal ya escribió por su cuenta: simulacro empezado o entregado). */
export function patchLocalProgress(packId: string, fn: (p: StudyProgress) => StudyProgress): void {
  const cur = useStudyStore.getState().courses[packId]
  if (!cur) return
  try {
    const next = fn(cur.progress)
    useStudyStore.setState((s) => ({ courses: { ...s.courses, [packId]: { ...s.courses[packId], progress: next } } }))
  } catch (e) {
    console.warn('[aula] progreso:', e)
  }
}

/** Llamada directa al proceso principal (simulacros: los arma y los corrige él). */
export const invokeMain = invoke

/** Manda ya lo pendiente (al salir de una sesión o antes de entregar un simulacro). */
export async function flushProgress(packId: string): Promise<void> {
  const q = pending.get(packId)
  if (!q) return
  if (q.timer) clearTimeout(q.timer)
  pending.delete(packId)
  const data = useStudyStore.getState().courses[packId]
  if (!data || data.demo) return
  inflight.add(packId)
  try {
    await sendOps(packId, coalesceOps(q.ops), () => useStudyStore.getState().courses[packId]?.progress ?? data.progress, invoke)
  } catch (e) {
    console.warn('[aula] no se pudo guardar el progreso:', e)
  } finally {
    inflight.delete(packId)
  }
  // lo que quedó en disco (con los ids y fechas del proceso principal) sustituye a la copia local
  if (!busy(packId)) void reloadProgress(packId)
}

/** Guarda todo lo pendiente al cerrar la ventana. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const id of [...pending.keys()]) void flushProgress(id)
  })
}

// MARK: Ayudas

export function skillTitle(data: CourseData, id: string): string {
  return data.skills.find((s) => s.id === id)?.title ?? data.pack.skills.find((s) => s.id === id)?.title ?? id
}
