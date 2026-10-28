// Cuentas pequeñas que comparten las pestañas del curso (Practicar, Tarjetas, Errores): precisión reciente, el enunciado
// de un ejercicio en una línea y el estado de una tarjeta.
import type { Attempt, CardProgress, Exercise } from '@shared/schema'

export interface AttemptStats {
  count: number
  /** Crédito medio (0…1; 0 sin intentos). */
  accuracy: number
}

export function attemptStats(attempts: readonly Attempt[]): AttemptStats {
  const n = attempts.length
  return { count: n, accuracy: n ? attempts.reduce((a, x) => a + (Number.isFinite(x.credit) ? x.credit : 0), 0) / n : 0 }
}

/** El enunciado en una línea (Markdown con fórmulas), para listas. */
export function promptText(ex: Pick<Exercise, 'prompt' | 'id'>): string {
  const t = ex.prompt
    .map((b) => (b.type === 'text' ? b.md : b.type === 'math' ? `$${b.tex}$` : ''))
    .join(' ')
    .replace(/^#+\s*/gm, '')
    .replace(/\[\[(\d+)\]\]/g, '___')
    .replace(/\s+/g, ' ')
    .trim()
  return t || ex.id
}

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

/** Fase de una tarjeta y cuántos días faltan para que vuelva (0 = hoy o ya vencida). */
export function cardState(p: CardProgress | undefined, now: Date): { state: CardState; inDays: number } {
  if (!p || p.reps === 0) return { state: 'new', inDays: 0 }
  const due = new Date(p.due).getTime()
  const days = Number.isFinite(due) ? Math.max(0, Math.ceil((due - now.getTime()) / 86_400_000)) : 0
  const state: CardState = p.phase === 'learning' || p.phase === 'relearning' || p.phase === 'review' ? p.phase : 'review'
  return { state, inDays: days }
}

/** Texto plano de Markdown (para buscar). */
export function plainText(md: string): string {
  return md.replace(/[$*_`#>]/g, ' ').replace(/\\[a-zA-Z]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Normaliza para buscar (sin tildes ni mayúsculas). */
export function searchKey(s: string): string {
  return plainText(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}
