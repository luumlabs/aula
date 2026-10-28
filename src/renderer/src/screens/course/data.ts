// Datos de la pantalla del curso: el curso (pack) y su vista de progreso, con respaldo de demostración.
import { useEffect, useState } from 'react'
import type { Pack } from '@shared/schema/pack'
import type { CourseOverview } from '@shared/ipc/course-view'
import { api } from '@renderer/lib/api'
import { demoPacks, demoText as L, isDemo } from '@renderer/lib/demo'

const invoke = api.invoke as unknown as (m: string, a?: unknown) => Promise<unknown>

/** El último curso leído de cada id: al volver a un curso se pinta en el acto (y se refresca detrás), sin indicador. */
const packCache = new Map<string, Pack>()
const inflight = new Map<string, Promise<Pack | null>>()

/** Lee un curso (comparte la petición si ya hay una en marcha) y lo deja en la caché. null si no existe. */
function fetchPack(id: string): Promise<Pack | null> {
  const running = inflight.get(id)
  if (running) return running
  const p = (invoke('courses.get', { id }) as Promise<Pack | null>)
    .catch(async () => (isDemo() ? (await demoPacks()).find((x) => x.id === id) ?? null : Promise.reject(new Error('courses.get'))))
    .then((pack) => {
      if (pack) packCache.set(id, pack)
      else packCache.delete(id)
      return pack
    })
    .finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

/** Para la navegación: trae el curso antes de cambiar de pantalla (la anterior se queda hasta tenerlo). */
export function prefetchCoursePack(id: string): Promise<unknown> | undefined {
  if (!id || packCache.has(id)) return undefined
  return fetchPack(id).catch(() => undefined)
}

type PackState = { pack: Pack | null; loading: boolean; missing: boolean }

export function useCoursePack(id: string): PackState {
  const initial = (): PackState => {
    const cached = packCache.get(id)
    return cached ? { pack: cached, loading: false, missing: false } : { pack: null, loading: true, missing: false }
  }
  const [state, setState] = useState<PackState>(initial)
  useEffect(() => {
    let alive = true
    setState(initial())
    const load = () =>
      fetchPack(id).then(
        (p) => alive && setState({ pack: p, loading: false, missing: !p }),
        () => alive && setState({ pack: null, loading: false, missing: true })
      )
    void load()
    const off = (api.on as (e: string, f: (p: unknown) => void) => () => void)('courses.changed', (p) => {
      const changed = (p as { packId?: string } | undefined)?.packId
      if (!changed || changed === id) {
        packCache.delete(id)
        void fetchPack(id).then((x) => alive && x && setState({ pack: x, loading: false, missing: false })).catch(() => {})
      }
    })
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return state
}

export function useOverview(pack: Pack | null): CourseOverview | null {
  const [ov, setOv] = useState<CourseOverview | null>(null)
  useEffect(() => {
    if (!pack) return
    let alive = true
    api
      .invoke('course.overview', { id: pack.id })
      .then((v) => alive && setOv(v))
      .catch(() => alive && isDemo() && setOv(demoOverview(pack)))
    return () => {
      alive = false
    }
  }, [pack])
  return ov
}

/** Progreso inventado pero coherente para el modo demostración. */
function demoOverview(pack: Pack): CourseOverview {
  const seed = (s: string) => Array.from(s).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7) / 997
  const skills = pack.skills.map((s, i) => {
    const m = Math.max(0, Math.min(1, 0.95 - i * 0.12 + seed(s.id) * 0.2))
    return { id: s.id, mastery: i > 5 ? 0 : m, seen: i <= 5, dueCards: i < 3 ? 2 + i : 0, mistakes: i === 1 ? 2 : 0 }
  })
  const readiness = skills.reduce((a, s) => a + s.mastery, 0) / Math.max(1, skills.length)
  const first = pack.skills[0]
  const third = pack.skills[Math.min(5, pack.skills.length - 1)]
  return {
    id: pack.id,
    readiness,
    readinessLow: Math.max(0, readiness - 0.08),
    readinessHigh: Math.min(1, readiness + 0.07),
    coverage: skills.filter((s) => s.seen).length / Math.max(1, skills.length),
    label: readiness > 0.85 ? 'ready' : readiness > 0.7 ? 'almostReady' : readiness > 0.45 ? 'gettingThere' : readiness > 0 ? 'early' : 'notStarted',
    plan: [
      { id: 'c1', courseId: pack.id, courseTitle: pack.title, icon: pack.icon, hue: pack.hue, kind: 'cards', title: L('Repaso de tarjetas', 'Flashcard review'), detail: L('Tienes 7 tarjetas vencidas: repasarlas ahora fija lo aprendido', 'You have 7 cards due: reviewing them now locks in what you learned'), minutes: 4 },
      { id: 'c2', courseId: pack.id, courseTitle: pack.title, icon: pack.icon, hue: pack.hue, kind: 'mistakes', title: L('Repaso de errores', 'Mistake review'), detail: L('2 errores por repasar: corregirlos hoy evita repetirlos', '2 mistakes to review: fixing them today keeps you from repeating them'), minutes: 3 },
      { id: 'c3', courseId: pack.id, courseTitle: pack.title, icon: pack.icon, hue: pack.hue, kind: 'learn', title: L(`Aprende: ${third?.title ?? ''}`, `Learn: ${third?.title ?? ''}`), detail: L(`Vale ${third?.weight ?? 10} puntos y aún no lo has visto`, `Worth ${third?.weight ?? 10} points and you haven't seen it yet`), minutes: third?.minutes ?? 20, skillId: third?.id },
      { id: 'c4', courseId: pack.id, courseTitle: pack.title, icon: pack.icon, hue: pack.hue, kind: 'practice', title: L(`Practica: ${first?.title ?? ''}`, `Practice: ${first?.title ?? ''}`), detail: L('Práctica mezclada para afianzar', 'Mixed practice to consolidate'), minutes: 8, skillId: first?.id }
    ],
    minutesToday: 12,
    minutesGoal: 45,
    dueCards: 7,
    mistakes: 2,
    skills,
    attempts: 64,
    accuracy: 0.81
  }
}
